/**
 * TSUZUKU — 茶屋ラジオ playlist builder (design 08 §10.2). Pure.
 *
 * `buildPlaylist()` lays out up to `RADIO_MAX_SECONDS` (45 min) of listening
 * from three sources, deterministic per `(seed, day)` through
 * `rngFor(seed, day, 'radio')`:
 *
 *  1. **kana tracks** (Stations 1–3 only, `kana/tracks.json`), then
 *  2. **cold texts** — pieces and dialogues `<= station` the learner has not
 *     heard on either surface (`progress.listened`) and that no Arena set
 *     passed within `ARENA_RECENT_DAYS` (`arenaRecent`, from
 *     `progress.arenaAt` through `arenaRecentIds()`); nearest station
 *     first, at the learner's speed tier, each followed by a gist question;
 *     at Stations 1–3 every White story counts (there are no pieces yet);
 *  3. **i+0 pool sentences** (`selectPool`, every word known) sampled without
 *     replacement, weighted by `1 − R(listen)` so the sentences whose words
 *     FSRS is about to forget on the listening facet come up first;
 *  4. **re-hearings** — texts the Arena passed within `ARENA_RECENT_DAYS`
 *     first (design 08 §10.2 "worked on recently": Radio consolidates what
 *     the learner just earned, one tier up), then the other heard texts
 *     least recently heard first (the order of `progress.listened`: Radio
 *     moves a re-heard id to the back, so the array stays a heard-set for
 *     `includes` callers and an LRU order here), all one speed tier above
 *     the learner's preset ("Here it is again at 1.1×"), with a gist
 *     question when the text is
 *     authentic-style (`isAuthenticText`) and the rate is ≥ 1.0 so the
 *     minutes can count as authentic (design 08 §12).
 *
 * Seconds are the §2 speech estimate (morae ÷ 7 + 0.5 s per clip) divided by
 * the rate, so a 45-minute playlist is 45 minutes at the speed it plays.
 * `notice` carries the honest copy key when fresh material is short: no
 * pieces exist before Station 4, or every piece up to the station is heard.
 * Nothing here reads the store or the clock: `day`, `known`, `cards`,
 * `listened` and the content are injected.
 */
import { isAuthenticText, type ComprehensionQuestion, type PoolRef, type StoryItem, type StoryLine } from '@/content/types';
import { ARENA_RECENT_DAYS, CLIP_PAD_SECONDS, MORAE_PER_SECOND, cardRetrievability, plusOneId, selectPool } from '@/learn';
import { SPEED_TIER_RATES, type SpeedTier, type TrackCue } from '@/shared/audio';
import { rngFor, shuffle, weighted, type Rng } from '@/shared/hash';
import { cardKey, stationOfId } from '@/shared/ids';
import { moraCount, normalizeJa } from '@/shared/jp';
import type { CardsApi, EpochDay } from '@/shared/store-types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** The playlist ceiling (design 08 §10.2 "up to 45 min"). */
export const RADIO_MAX_SECONDS = 45 * 60;
/** Cold texts per playlist: at most this many, inside this many seconds, so sentences and re-hearings keep their share. */
export const COLD_MAX_TRACKS = 4;
export const COLD_MAX_SECONDS = 15 * 60;
/** First pass of i+0 sentences; what is left of the budget after re-hearings is topped up with more. */
export const SENTENCE_MAX_SECONDS = 15 * 60;
/**
 * Design 08 §10.2 "worked on recently": a text whose last PASSED Arena set
 * (`progress.arenaAt`, written by the Arena only) is at most this many days
 * old is never served cold and leads the re-hearings. The one constant lives
 * in `@/learn` (`pool.ts`; `session/builder.ts` closes its dialogue slot over
 * the same window), re-exported here for the playlist's importers.
 */
export { ARENA_RECENT_DAYS };
/**
 * How far AHEAD of today an `arenaAt` stamp may sit and still count as recent
 * (a day of clock drift, a backup restored across a date line). Beyond it the
 * stamp is junk (a clock set years ahead, a hand-edited backup) and must not
 * pin the text as "worked on recently" for good.
 */
export const ARENA_FUTURE_SLACK_DAYS = 1;
/** Floor weight for an i+0 sentence whose words carry no `listen` card yet (1 − R would be 0). */
export const MIN_SENTENCE_WEIGHT = 0.05;
/** Pieces exist from this station (design 08 §3); below it every story is Radio material. */
export const PIECES_FROM_STATION = 4;
/** The rng salt, so Radio never shares a stream with the Arena's `rngFor(seed, day, storyId)`. */
export const RADIO_RNG_SALT = 'radio';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type TrackKind = 'text' | 'sentence' | 'kana';

export interface Track {
  /** Unique within the playlist: the text id, the pool ref, or the kana track key. */
  id: string;
  kind: TrackKind;
  /** `listen:played.refs`: `[storyId]`, `[poolRef]` or `['track:<name>']`. */
  refs: string[];
  /** Clip key for the pack: `<storyId>` (whole text), `<itemId>#ex<k>` / `<storyId>#L<i>` (sentence), `track:<name>` (kana). */
  clipKey: string;
  /** `titleJa` of a text, the kana of a sentence, the kana track's title. */
  title: string;
  titleEn: string;
  /** Speed tier the track plays at; `null` = the clip's native rate (kana tracks). */
  tier: SpeedTier | null;
  /** Playback rate at `tier` (the preset table) or the native rate. */
  rate: number;
  /** Speech estimate at `rate`, seconds. */
  seconds: number;
  /** First hearing of a text on either surface (design 08 §10.4). */
  cold: boolean;
  rehearing: boolean;
  /** `isAuthenticText(story)`: the minutes may count as authentic after a correct gist answer at ≥ 1.0×. */
  authenticStyle: boolean;
  /** The gist question offered after the track, or `null` (sentences, kana, polite re-hearings). */
  gist: ComprehensionQuestion | null;
  /** Narrator or first speaker (the Media Session artist); `null` falls back to the default voice. */
  speaker: string | null;
  station: number | null;
  story?: StoryItem;
  ref?: PoolRef;
  cue?: TrackCue;
  /** The word the G key glosses: the i+1 word when one exists, else the word with the lowest `listen` retention; `null` when nothing stands out. */
  glossId: string | null;
}

export type PlaylistNotice = 'no-pieces-yet' | 'nothing-new' | 'empty' | null;

export interface Playlist {
  tracks: Track[];
  /** Σ `tracks[].seconds`. */
  seconds: number;
  /** Unheard eligible texts left over after this playlist. */
  coldLeft: number;
  notice: PlaylistNotice;
}

export interface PlaylistInput {
  /** `store.seed()`. */
  seed: string;
  /** Today (`store.today()`); also the day `selectPool` grades the cards against. */
  day: EpochDay;
  /** The learner's station (`progress.station`). */
  station: number;
  /** `knownSet(store.cards, today)`. */
  known: ReadonlySet<string>;
  cards: Pick<CardsApi, 'get'>;
  /** `progress.listened`: text ids heard on either surface, least recently heard first (Radio re-appends a re-heard id). */
  listened: readonly string[];
  /** Pool refs of the stations `<= station` the caller loaded (concatenated). */
  pools: readonly PoolRef[];
  /** Texts `<= station` the caller loaded (pieces included); texts above the station are ignored. */
  stories: readonly StoryItem[];
  /** The learner's speed tier (`settings.speedTier`). */
  tier: SpeedTier;
  /** Kana tracks (Stations 1–3; `clips.kanaTracks()`), `[]` without a pack. */
  kanaTracks?: readonly TrackCue[];
  /** Text ids whose last passed Arena set is within `ARENA_RECENT_DAYS` (`arenaRecentIds(progress.arenaAt, day)`): never cold, first among the re-hearings. */
  arenaRecent?: ReadonlySet<string>;
  /** Budget override (tests). */
  maxSeconds?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The ids in `arenaAt` (text id → epoch day of the last passed Arena set)
 * whose day is within `days` of `today` (`today − day ≤ days`; a day up to
 * `ARENA_FUTURE_SLACK_DAYS` in the future — a restored backup, a moved clock —
 * counts as recent too, anything further ahead is junk and does not). Pure;
 * `undefined` → empty.
 */
export function arenaRecentIds(arenaAt: Readonly<Record<string, EpochDay>> | undefined, today: EpochDay, days: number = ARENA_RECENT_DAYS): Set<string> {
  const out = new Set<string>();
  if (!arenaAt) return out;
  for (const [id, day] of Object.entries(arenaAt)) {
    if (typeof day !== 'number' || !Number.isFinite(day)) continue;
    const age = today - day;
    if (age <= days && age >= -ARENA_FUTURE_SLACK_DAYS) out.add(id);
  }
  return out;
}

/** Seconds of speech in `morae` morae at `rate` (design 08 §2 estimate). */
export function speechSeconds(morae: number, rate: number): number {
  const r = rate > 0 ? rate : 1;
  return (morae / MORAE_PER_SECOND + CLIP_PAD_SECONDS) / r;
}

/** Morae of a line's kana reading (`moraCount` over the normalised kana: small ゃゅょ merge, punctuation drops). Radio's device-mode count uses the same figure. */
export function lineMorae(line: Pick<StoryLine, 'kana'>): number {
  return moraCount(normalizeJa(line.kana, { foldKatakana: true }));
}

/** Σ over the lines of `speechSeconds` (one clip per line). */
export function textSeconds(story: Pick<StoryItem, 'lines'>, rate: number): number {
  let s = 0;
  for (const l of story.lines) s += speechSeconds(lineMorae(l), rate);
  return s;
}

/** Radio material at `station`: pieces and dialogues from Station 4, every story before it (design 08 §10.2, §10.5). */
export function radioEligible(story: Pick<StoryItem, 'kind' | 'audioFirst'>, station: number): boolean {
  if (station < PIECES_FROM_STATION) return true;
  return story.audioFirst === true || story.kind === 'dialogue';
}

/** The gist question of a text: the first `kind: 'gist'`, else the first question (the Arena's order too). */
export function gistQuestion(story: Pick<StoryItem, 'comprehension'>): ComprehensionQuestion | null {
  return story.comprehension.find((q) => q.kind === 'gist') ?? story.comprehension[0] ?? null;
}

/** One tier above `tier`, capped at 5 (design 08 §10.2 "one tier faster than last time"). */
export function rehearingTier(tier: SpeedTier): SpeedTier {
  return Math.min(5, tier + 1) as SpeedTier;
}

/** Whether a re-hearing at `rate` of `story` carries a gist question (design 08 §10.2 / §12). */
export function rehearingAsksGist(story: Pick<StoryItem, 'bridge' | 'genre' | 'kind' | 'register'>, rate: number): boolean {
  return isAuthenticText(story) && rate >= 1;
}

/** Narrator, else the first speaker label, else `null`. */
export function speakerOf(story: Pick<StoryItem, 'narrator' | 'lines'>): string | null {
  if (story.narrator) return story.narrator;
  for (const l of story.lines) if (l.speaker) return l.speaker;
  return null;
}

/**
 * Listening retention of a sentence: the lowest `R` over its words' existing
 * `listen` cards (the word most likely to be missed decides), `1` when no
 * word has one; `weakest` is that word's id.
 */
export function listenRetention(ref: PoolRef, cards: Pick<CardsApi, 'get'>, today: EpochDay): { r: number; weakest: string | null } {
  let r = 1;
  let weakest: string | null = null;
  for (const id of ref.ids) {
    const card = cards.get(cardKey(id, 'listen'));
    if (!card) continue;
    const cr = cardRetrievability(card, today);
    if (weakest === null || cr < r) {
      r = cr;
      weakest = id;
    }
  }
  return { r, weakest };
}

/** The clip key of a kana track cue: its `key` (`track:<name>`). */
function kanaTrack(cue: TrackCue): Track {
  const seconds = Math.max(0, cue.end - cue.start);
  return {
    id: cue.key,
    kind: 'kana',
    refs: [cue.key],
    clipKey: cue.key,
    title: cue.title,
    titleEn: cue.titleEn ?? '',
    tier: null,
    rate: cue.rate > 0 ? cue.rate : 1,
    seconds,
    cold: false,
    rehearing: false,
    authenticStyle: false,
    gist: null,
    speaker: null,
    station: null,
    cue,
    glossId: null,
  };
}

function textTrack(story: StoryItem, tier: SpeedTier, o: { cold: boolean }): Track {
  const rate = SPEED_TIER_RATES[tier];
  const authenticStyle = isAuthenticText(story);
  const gist = o.cold ? gistQuestion(story) : rehearingAsksGist(story, rate) ? gistQuestion(story) : null;
  return {
    id: story.id,
    kind: 'text',
    refs: [story.id],
    clipKey: story.id,
    title: story.titleJa,
    titleEn: story.titleEn,
    tier,
    rate,
    seconds: textSeconds(story, rate),
    cold: o.cold,
    rehearing: !o.cold,
    authenticStyle,
    gist,
    speaker: speakerOf(story),
    station: stationOfId(story.id) ?? null,
    story,
    glossId: null,
  };
}

function sentenceTrack(ref: PoolRef, tier: SpeedTier, known: ReadonlySet<string>, weakest: string | null): Track {
  const rate = SPEED_TIER_RATES[tier];
  const itemId = ref.ref.split('#')[0] ?? ref.ref;
  return {
    id: ref.ref,
    kind: 'sentence',
    refs: [ref.ref],
    clipKey: ref.ref,
    title: ref.kana,
    titleEn: '',
    tier,
    rate,
    seconds: speechSeconds(ref.morae, rate),
    cold: false,
    rehearing: false,
    authenticStyle: false,
    gist: null,
    speaker: null,
    station: stationOfId(itemId) ?? null,
    ref,
    glossId: plusOneId(ref, known) ?? weakest,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Builder                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Stable sort by station descending (the learner's current material first); `rng` has already shuffled ties. */
function byStationDesc(a: StoryItem, b: StoryItem): number {
  return (stationOfId(b.id) ?? 0) - (stationOfId(a.id) ?? 0);
}

/** Weighted sampling without replacement over `refs`, stopping when `accept` refuses or the pool is empty. */
function sampleSentences(rng: Rng, refs: PoolRef[], weights: number[], accept: (ref: PoolRef) => boolean): PoolRef[] {
  const out: PoolRef[] = [];
  const pool = refs.slice();
  const w = weights.slice();
  let misses = 0;
  while (pool.length > 0 && misses < 8) {
    const i = weighted(rng, w);
    const ref = pool[i] as PoolRef;
    pool.splice(i, 1);
    w.splice(i, 1);
    if (accept(ref)) {
      out.push(ref);
      misses = 0;
    } else misses++;
  }
  return out;
}

export function buildPlaylist(input: PlaylistInput): Playlist {
  const rng = rngFor(input.seed, input.day, RADIO_RNG_SALT);
  const budget = input.maxSeconds ?? RADIO_MAX_SECONDS;
  const station = input.station;
  const listened = new Set(input.listened);
  const arenaRecent = input.arenaRecent ?? new Set<string>();
  const tracks: Track[] = [];
  let total = 0;
  const fits = (s: number): boolean => total + s <= budget;
  const push = (t: Track): void => {
    tracks.push(t);
    total += t.seconds;
  };

  /* 1. kana tracks (Stations 1–3) */
  if (station < PIECES_FROM_STATION && input.kanaTracks && input.kanaTracks.length > 0) {
    for (const cue of shuffle(rng, input.kanaTracks)) {
      const t = kanaTrack(cue);
      if (t.seconds > 0 && fits(t.seconds)) push(t);
    }
  }

  /* texts the radio may play */
  const eligible = input.stories.filter((s) => {
    const st = stationOfId(s.id);
    return st !== undefined && st <= station && radioEligible(s, station) && s.lines.length > 0;
  });
  const seen = new Set<string>();
  const unique = eligible.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  /* 2. cold texts: unheard, outside the Arena window, nearest station first */
  const cold = shuffle(
    rng,
    unique.filter((s) => !listened.has(s.id) && !arenaRecent.has(s.id)),
  ).sort(byStationDesc);
  let coldAdded = 0;
  let coldSeconds = 0;
  for (const s of cold) {
    if (coldAdded >= COLD_MAX_TRACKS) break;
    const t = textTrack(s, input.tier, { cold: true });
    if (coldSeconds + t.seconds > COLD_MAX_SECONDS || !fits(t.seconds)) continue;
    push(t);
    coldAdded++;
    coldSeconds += t.seconds;
  }

  /* 3. i+0 sentences weighted by 1 − R(listen) */
  const i0 = selectPool(input.pools, input.known, input.cards, input.day, { mode: 'i+0' });
  const refSeen = new Set<string>();
  const refs: PoolRef[] = [];
  const weights: number[] = [];
  const weakestOf = new Map<string, string | null>();
  for (const ref of i0) {
    if (refSeen.has(ref.ref)) continue;
    refSeen.add(ref.ref);
    const { r, weakest } = listenRetention(ref, input.cards, input.day);
    refs.push(ref);
    weights.push(Math.max(MIN_SENTENCE_WEIGHT, 1 - r));
    weakestOf.set(ref.ref, weakest);
  }
  // The sampled refs are pushed after sampling, so the accept callbacks carry their own running total.
  let sentenceSeconds = 0;
  const firstPass = sampleSentences(rng, refs, weights, (ref) => {
    const s = speechSeconds(ref.morae, SPEED_TIER_RATES[input.tier]);
    if (sentenceSeconds + s > SENTENCE_MAX_SECONDS || !fits(sentenceSeconds + s)) return false;
    sentenceSeconds += s;
    return true;
  });
  const taken = new Set<string>();
  for (const ref of firstPass) {
    taken.add(ref.ref);
    push(sentenceTrack(ref, input.tier, input.known, weakestOf.get(ref.ref) ?? null));
  }

  /* 4. re-hearings: texts the Arena passed within ARENA_RECENT_DAYS first (in heard order), then the rest least recently heard first, one tier up */
  const heardOrder: StoryItem[] = [];
  const byId = new Map(unique.map((s) => [s.id, s]));
  const lru: StoryItem[] = [];
  for (const id of input.listened) {
    const s = byId.get(id);
    if (s && !lru.includes(s)) lru.push(s);
  }
  for (const s of lru) if (arenaRecent.has(s.id)) heardOrder.push(s);
  for (const s of unique) if (arenaRecent.has(s.id) && !heardOrder.includes(s)) heardOrder.push(s);
  for (const s of lru) if (!heardOrder.includes(s)) heardOrder.push(s);
  const upTier = rehearingTier(input.tier);
  for (const s of heardOrder) {
    const t = textTrack(s, upTier, { cold: false });
    if (fits(t.seconds)) push(t);
  }

  /* 5. top up with more i+0 sentences while the budget allows */
  const rest: PoolRef[] = [];
  const restW: number[] = [];
  refs.forEach((ref, i) => {
    if (taken.has(ref.ref)) return;
    rest.push(ref);
    restW.push(weights[i] as number);
  });
  let extra = 0;
  const topUp = sampleSentences(rng, rest, restW, (r) => {
    const s = speechSeconds(r.morae, SPEED_TIER_RATES[input.tier]);
    if (!fits(extra + s)) return false;
    extra += s;
    return true;
  });
  for (const ref of topUp) push(sentenceTrack(ref, input.tier, input.known, weakestOf.get(ref.ref) ?? null));

  const notice: PlaylistNotice = tracks.length === 0 ? 'empty' : station < PIECES_FROM_STATION ? 'no-pieces-yet' : coldAdded === 0 ? 'nothing-new' : null;
  return { tracks, seconds: total, coldLeft: cold.length - coldAdded, notice };
}
