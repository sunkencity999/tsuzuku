/**
 * TSUZUKU — 茶屋ラジオ Teahouse Radio player (design 08 §10.2, §8, §12).
 *
 * A non-session listening surface: it never starts a session, never pays XP,
 * never lights the flame. It plays one track at a time from
 * `buildPlaylist()` (`./radio-playlist.ts`) through the audio slot:
 *
 *  - **pack mode** (`services.audio.clips` ready and `settings.audioSource`
 *    `'pack'`): a whole-text track is `clips.cueFor(storyId)` played with
 *    `wholeTrack: true` — no stop timer, the sprite plays edge to edge and
 *    `ended` advances, so it survives the screen turning off; kana tracks
 *    are `clips.kanaTracks()` cues played the same way; sentence tracks go
 *    through `speak(text, { clip, speaker, rate })` and stay foreground.
 *    Lock-screen controls through `./media-session.ts`.
 *  - **device mode** (no pack, or the learner chose the device voice): every
 *    track plays line by line through `speak()` in the foreground; the chip
 *    says "device voice", there is no Media Session, and the copy says why
 *    background play is unavailable.
 *  - **text only** (volume 0 or no voice at all): the transcript shows, nothing
 *    plays, nothing is counted.
 *
 * With `document.hidden` only whole-text pack tracks continue; a line-by-line
 * track waits at the line boundary until the page is visible again.
 *
 * Per track it emits `listen:played { source: 'radio', refs, seconds, rate,
 * cold, authentic, gistCorrect }` — `seconds` is the pack player's
 * `timeupdate`-derived count (`onPlayed` / `done.seconds`), never a wall clock
 * or `requestAnimationFrame`; on the `speak()` path it is the clip's length
 * scaled to the rate it played at (or the §2 speech estimate) for the lines
 * that actually finished audibly. A pause, a skip (← →), a speed change or
 * leaving the page logs the seconds played so far as a partial row; a gist
 * question left open by any of those still logs its track with
 * `gistCorrect: null`. `authentic` is `isAuthenticText && rate ≥ 1.0 &&
 * gistCorrect === true`; `gistCorrect` is `null` when no question was asked
 * or it was skipped (a question that ends while the screen is off is
 * skipped). Heard text ids go to `progress.listened`: a first hearing is
 * appended, a re-hearing moves its id to the back, so the array stays a
 * heard-set for `includes` callers and a least-recently-heard order for the
 * playlist. Texts the Arena passed within `ARENA_RECENT_DAYS`
 * (`progress.arenaAt`, the Arena's field; `arenaRecentIds()`) are never cold
 * and lead the re-hearings (design 08 §10.2 "worked on recently");
 * `loadRadioInputs()` fetches them ahead of the least-recently-heard cut, so
 * a text passed yesterday reaches the playlist however long `listened` is.
 *
 * Pause: when the pack playback exposes `pause()` / `resume()` (optional in
 * the contract) a whole-text track pauses IN PLACE — Space or the button
 * logs the seconds played so far (`position()`, else the `onPlayed` count)
 * as a partial row and resume continues the same playback from the same
 * position; the completed row is `done.seconds` minus what the partials
 * already logged, so no second is counted twice. A playback without them
 * stops, logs what played and starts over on play. A line-by-line track
 * resumes at the line it was on. A speed change while paused in place drops
 * the position (a playback has no rate change): the track starts over at
 * the new speed on play. The transcript is karaoke-timed in pack
 * mode through the player's `onProgress` over the per-line cues (foreground
 * only; never used for counting).
 *
 * Keys: Space play / pause · ← → track · L loop track · [ ] speed (this
 * sitting only; the preset in Settings never changes silently, design 01 §6)
 * · T transcript · G gloss · ? "didn't catch that" (Hard on the sentence's
 * `listen` cards due within 3 days through `recordImplicit`, transcript for
 * 3 s). ← → and L act on whole tracks: the contract plays a whole-text cue
 * edge to edge and offers no line seek inside it.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dataSaverOn } from '@/audio';
import { content, type ContentLoader } from '@/content/loader';
import { toPlain } from '@/content/ruby';
import { BELTS, type ContentItem, type Level, type PoolRef, type StoryItem, type StoryLine, type VocabItem } from '@/content/types';
import { IMPLICIT_WINDOW_DAYS, knownSet } from '@/learn';
import { recordImplicit } from '@/learn/apply';
import { SPEED_TIER_RATES, audioSourceOf, services, servicesVersion, speak, voiceAudible, type ClipCue, type ClipPlayback, type ClipPlayer, type SpeedTier, type TrackCue } from '@/shared/audio';
import { bus } from '@/shared/events';
import { containsJapanese } from '@/shared/jp';
import { cardKey, stationOfId, tryKindOfId } from '@/shared/ids';
import { Ruby } from '@/shared/ui/Ruby';
import { TeachOnce, markTeachSeen } from '@/shared/ui/TeachOnce';
import { store } from '@/store';
import { setHandlers, setMetadata, setPlaybackState, type MediaSessionLike } from './media-session';
import { PIECES_FROM_STATION, arenaRecentIds, buildPlaylist, lineMorae, radioEligible, speechSeconds, type Playlist, type Track } from './radio-playlist';
import { S, fill } from './radio-strings';
import './Radio.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** `TeachOnce` id (lowercase ASCII, `TEACH_ID_RE`). */
export const RADIO_TEACH_ID = 'radio-first';
/** How long the transcript stays open after "didn't catch that" (design 08 §10.2). UI only, never counting. */
export const TRANSCRIPT_FLASH_MS = 3000;
/** Pools loaded for the playlist: this station and the ones just below it (older pools are all known and all heard). */
export const POOL_STATION_WINDOW = 8;
/** Unheard Radio-eligible texts loaded as cold candidates (nearest stations first) and heard ids loaded for re-hearings (Arena-recent ids first, up to the same cap, then the least recently heard). */
export const COLD_LOAD_MAX = 12;
export const REHEAR_LOAD_MAX = 12;
/** The drill id the `?` key writes its Hard grade under (Radio is not a drill; the Arena's id keeps the log honest about the facet). */
export const RADIO_IMPLICIT_EXERCISE = 'listening-set' as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Inputs                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RadioInputs {
  stories: StoryItem[];
  pools: PoolRef[];
  kanaTracks: TrackCue[];
}

export function isStory(x: ContentItem | null | undefined): x is StoryItem {
  return !!x && 'lines' in x && 'comprehension' in x && Array.isArray((x as StoryItem).lines);
}

/** The JLPT level of a station (`BELTS` rows); `'kana'` for Stations 1–3. */
export function levelOfStation(n: number): Level {
  const belt = BELTS.find((b) => n >= b.stations[0] && n <= b.stations[1]);
  return belt ? belt.level : n < PIECES_FROM_STATION ? 'kana' : 'n1';
}

/**
 * Gathers the playlist inputs from the loader: the station bundles `<= station`
 * (a station the manifest lacks contributes nothing), the nearest unheard
 * Radio-eligible texts, the texts the Arena passed recently (`arenaRecent`,
 * `arenaRecentIds(progress.arenaAt, today)`) and the least recently heard
 * texts as candidates, the pools of the last `POOL_STATION_WINDOW` stations
 * (`missing-pool` → empty) and, at Stations 1–3 with a pack, the kana
 * tracks. Never throws on a missing file.
 *
 * Re-hearing candidates: the Arena-recent ids first (they are never cold and
 * lead the re-hearings, design 08 §10.2 "worked on recently" — a first Arena
 * pass appends its id at the END of `listened`, so the least-recently-heard
 * cut alone would drop it once `REHEAR_LOAD_MAX` other texts are heard),
 * then the least recently heard ids, each list capped at `REHEAR_LOAD_MAX`.
 *
 * Cold candidates come from a walk down the stations, one at a time: a
 * station whose texts are all heard costs nothing, a station with unheard ids
 * loads them and keeps those `radioEligible` lets Radio play (a diary is
 * reading material from Station 4), and the walk stops at `COLD_LOAD_MAX`
 * eligible unheard texts. So the player says "nothing new" only when no
 * station up to the learner's holds an unheard piece or dialogue.
 */
export async function loadRadioInputs(
  loader: ContentLoader,
  o: { station: number; listened: readonly string[]; arenaRecent?: ReadonlySet<string>; clips?: ClipPlayer | null },
): Promise<RadioInputs> {
  const station = Math.max(1, Math.floor(o.station));
  const numbers: number[] = [];
  for (let n = 1; n <= station; n++) numbers.push(n);
  const bundles = await Promise.all(numbers.map((n) => loader.station(n).then((b) => ({ n, ids: b.storyIds }), () => ({ n, ids: [] as string[] }))));
  const idSet = new Set(bundles.flatMap((b) => b.ids));
  const arenaRecent = o.arenaRecent ?? new Set<string>();
  // An Arena-recent text is never cold (even when the capped heard-set forgot it), so the cold walk skips it and the re-hearing load below fetches it.
  const listened = new Set([...o.listened, ...arenaRecent]);
  const safeLoad = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      await loader.load(ids);
    } catch {
      // a file that failed stays unloaded; `get` below skips it
    }
  };

  const cold: StoryItem[] = [];
  for (const b of bundles.slice().sort((a, c) => c.n - a.n)) {
    if (cold.length >= COLD_LOAD_MAX) break;
    const unheard = b.ids.filter((id) => !listened.has(id));
    if (unheard.length === 0) continue;
    await safeLoad(unheard);
    for (const id of unheard) {
      const item = loader.get(id);
      if (isStory(item) && radioEligible(item, station) && item.lines.length > 0) cold.push(item);
    }
  }

  const arenaIds = Array.from(arenaRecent).filter((id) => idSet.has(id)).slice(0, REHEAR_LOAD_MAX);
  const arenaSet = new Set(arenaIds);
  const heardIds = o.listened.filter((id) => idSet.has(id) && !arenaSet.has(id)).slice(0, REHEAR_LOAD_MAX);
  const rehearIds = [...arenaIds, ...heardIds];
  await safeLoad(rehearIds);
  const stories = [...cold.slice(0, COLD_LOAD_MAX), ...rehearIds.map((id) => loader.get(id)).filter(isStory)];

  const from = Math.max(1, station - POOL_STATION_WINDOW + 1);
  const poolNumbers: number[] = [];
  for (let n = from; n <= station; n++) poolNumbers.push(n);
  const pools = (
    await Promise.all(
      poolNumbers.map((n) =>
        loader.pool(n).then(
          (p) => p.refs,
          () => [] as PoolRef[],
        ),
      ),
    )
  ).flat();

  let kanaTracks: TrackCue[] = [];
  if (station < PIECES_FROM_STATION && o.clips && o.clips.ready.value === 'ready') {
    try {
      kanaTracks = await o.clips.kanaTracks();
    } catch {
      kanaTracks = [];
    }
  }
  return { stories, pools, kanaTracks };
}

/** `{ ja, en }` of a pool ref from the loaded item (`v-…#ex<k>`, `g-…#ex<k>`, `s-NN-k#L<i>`), or `null` when it is not in memory. */
export function refSurface(ref: string, loader: Pick<ContentLoader, 'get'>): { ja: string; en: string } | null {
  const m = /^(.+)#(ex|L)(\d+)$/.exec(ref);
  if (!m) return null;
  const item = loader.get(m[1] as string);
  if (!item) return null;
  const k = Number(m[3]);
  if (m[2] === 'L') {
    const line = isStory(item) ? item.lines[k] : undefined;
    return line ? { ja: line.ja, en: line.en } : null;
  }
  if ('examples' in item && Array.isArray(item.examples)) {
    const ex = item.examples[k];
    // Kanji items carry `WordExample`s (word / kana / en), which no pool ref points at.
    return ex && 'ja' in ex ? { ja: ex.ja, en: ex.en } : null;
  }
  return null;
}

function isVocab(x: ContentItem | undefined): x is VocabItem {
  return !!x && 'meanings' in x && 'word' in x && 'kana' in x;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RadioProps {
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: ContentLoader;
  /** The pack player; `undefined` → `services.audio.clips`, `null` → none (device mode). */
  clips?: ClipPlayer | null;
  /** Ready-made inputs (tests, or a page that loaded them); default `loadRadioInputs()`. */
  inputs?: RadioInputs;
  /** Text ids whose last passed Arena set is within `ARENA_RECENT_DAYS` (tests); default `arenaRecentIds(progress.arenaAt, today)`. */
  arenaRecent?: ReadonlySet<string>;
  /** Media Session target (tests); default `navigator`. */
  nav?: { mediaSession?: MediaSessionLike } | null;
}

type Mode = 'clips' | 'device' | 'text';
type Status = 'loading' | 'unavailable' | 'idle' | 'playing' | 'paused' | 'question' | 'done';

interface PendingGist {
  track: Track;
  seconds: number;
  rate: number;
}

const TIER_MIN = 1;
const TIER_MAX = 5;

function clampTier(t: number): SpeedTier {
  return Math.max(TIER_MIN, Math.min(TIER_MAX, Math.round(t))) as SpeedTier;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function kindLabel(t: Track): string {
  if (t.kind === 'kana') return S.kindKana;
  if (t.kind === 'sentence') return S.kindSentence;
  if (t.story?.audioFirst) return S.kindPiece;
  return t.story?.kind === 'dialogue' ? S.kindDialogue : S.kindStory;
}

export function Radio(p: RadioProps): JSX.Element {
  const loader = p.loader ?? content;
  const settings = store.settings.value;
  const progress = store.progress.value;
  const station = Math.max(1, progress.station);
  const baseTier = settings.speedTier;
  const volume = Math.max(0, Math.min(1, Number.isFinite(settings.sound) ? settings.sound : 1));
  // Re-render when the real audio service lands after first paint (`#/radio` at boot): mode and chip read `services.audio`.
  servicesVersion.value;
  const clips = p.clips === undefined ? services.audio.clips : (p.clips ?? undefined);
  const packReady = !!clips && clips.ready.value === 'ready';
  const packOn = packReady && settings.audioSource === 'pack';
  const synthOk = voiceAudible(services.audio);
  const mode: Mode = volume <= 0 ? 'text' : packOn ? 'clips' : synthOk || packReady ? 'device' : 'text';

  const [inputs, setInputs] = useState<RadioInputs | null>(p.inputs ?? null);
  const [status, setStatus] = useState<Status>(p.inputs ? 'idle' : 'loading');
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loop, setLoop] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const [showEn, setShowEn] = useState(true);
  const [lineIdx, setLineIdx] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gist, setGist] = useState<PendingGist | null>(null);
  const [heard, setHeard] = useState(0);
  const [surfaces, setSurfaces] = useState<Record<string, { ja: string; en: string }>>({});
  /** Pack mode, but this text or kana track has no whole-track cue: its lines play in the foreground and the card says so. */
  const [fellBack, setFellBack] = useState(false);

  const run = useRef(0);
  const playback = useRef<ClipPlayback | null>(null);
  /** Seconds of the current track counted so far: the pack player's cumulative `onPlayed` figure, or the lines `speak()` finished. */
  const played = useRef(0);
  /** Seconds of the current track already emitted as partial rows (a pause, a skip, a speed change); the completed row is `done.seconds` minus this, so no second is counted twice. Reset per track start. */
  const logged = useRef(0);
  /** The whole-track playback is paused in place (`ClipPlayback.pause()`): play resumes it instead of restarting the track. */
  const pausedInPlace = useRef(false);
  /** The line a paused line-by-line track resumes at (`speak()` path); a whole track resumes in place when its playback can pause, else restarts from the top. */
  const lineAt = useRef(0);
  const indexRef = useRef(0);
  const loopRef = useRef(false);
  const offsetRef = useRef(0);
  const statusRef = useRef<Status>(status);
  /** The question waiting for an answer; a ref so ← →, the lock screen and unmount can log the track without re-rendering first. */
  const gistRef = useRef<PendingGist | null>(null);
  const lineIdxRef = useRef<number | null>(null);
  const visibleWaiters = useRef<(() => void)[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  statusRef.current = status;
  loopRef.current = loop;
  offsetRef.current = offset;

  /* ── inputs ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (p.inputs) {
      setInputs(p.inputs);
      setStatus('idle');
      return;
    }
    let alive = true;
    setStatus('loading');
    // design 08 §10.2 "worked on recently": the Arena-recent ids ride along so the loader fetches them ahead of the LRU cut
    loadRadioInputs(loader, { station, listened: progress.listened ?? [], arenaRecent: p.arenaRecent ?? arenaRecentIds(progress.arenaAt, store.today()), clips })
      .then((inp) => {
        if (!alive) return;
        setInputs(inp);
        setStatus('idle');
      })
      .catch(() => {
        if (alive) setStatus('unavailable');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.inputs, loader, station]);

  /* ── playlist (built once per inputs; `listened` is read at build time, so a heard track never reorders the rest) ── */

  const playlist = useMemo<Playlist | null>(() => {
    if (!inputs) return null;
    const today = store.today();
    const prog = store.progress.peek();
    return buildPlaylist({
      seed: store.seed(),
      day: today,
      station,
      known: knownSet(store.cards, today),
      cards: store.cards,
      listened: prog.listened ?? [],
      pools: inputs.pools,
      stories: inputs.stories,
      tier: baseTier,
      kanaTracks: inputs.kanaTracks,
      // design 08 §10.2 "worked on recently": the Arena's `arenaAt` stamps within ARENA_RECENT_DAYS of today
      arenaRecent: p.arenaRecent ?? arenaRecentIds(prog.arenaAt, today),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, station, baseTier]);
  const playlistRef = useRef<Playlist | null>(null);
  playlistRef.current = playlist;

  // Sentence surfaces (`ja` / `en`) for the transcript: resolve what is in memory, fetch the rest once.
  useEffect(() => {
    if (!playlist) return;
    const next: Record<string, { ja: string; en: string }> = {};
    const missing: string[] = [];
    for (const t of playlist.tracks) {
      if (t.kind !== 'sentence') continue;
      const s = refSurface(t.id, loader);
      if (s) next[t.id] = s;
      else missing.push(t.id.split('#')[0] as string);
    }
    setSurfaces(next);
    if (missing.length === 0) return;
    let alive = true;
    loader
      .load(Array.from(new Set(missing)))
      .then(() => {
        if (!alive) return;
        setSurfaces((cur) => {
          const out = { ...cur };
          for (const t of playlist.tracks) {
            if (t.kind === 'sentence' && !out[t.id]) {
              const s = refSurface(t.id, loader);
              if (s) out[t.id] = s;
            }
          }
          return out;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [playlist, loader]);

  /* ── helpers ────────────────────────────────────────────────────────── */

  const rateOf = (t: Track): number => (t.tier === null ? t.rate : SPEED_TIER_RATES[clampTier(t.tier + offsetRef.current)]);

  const stopPlayback = (): void => {
    run.current++;
    pausedInPlace.current = false;
    const pb = playback.current;
    playback.current = null;
    if (pb) pb.stop();
    services.audio.cancel();
    for (const w of visibleWaiters.current.splice(0)) w();
  };

  const emitPlayed = (t: Track, seconds: number, rate: number, gistCorrect: boolean | null): void => {
    const s = round1(Math.max(0, seconds));
    if (s <= 0) return;
    bus.emit('listen:played', {
      source: 'radio',
      refs: t.refs.slice(),
      seconds: s,
      rate,
      cold: t.cold,
      authentic: t.authenticStyle && rate >= 1 && gistCorrect === true,
      gistCorrect,
    });
    setHeard((h) => h + s);
  };

  /** Appends a first hearing; a re-hearing moves its id to the back, so `listened` stays a heard-set for `includes` and a least-recently-heard order for the playlist (and the builder's round-robin). */
  const markListened = (t: Track): void => {
    if (t.kind !== 'text' || !t.story) return;
    const id = t.story.id;
    store.patch('progress', (pr) => {
      const cur = pr.listened ?? [];
      if (cur[cur.length - 1] === id) return pr;
      return { ...pr, listened: [...cur.filter((x) => x !== id), id] };
    });
  };

  const setLine = (i: number | null): void => {
    if (lineIdxRef.current === i) return;
    lineIdxRef.current = i;
    setLineIdx(i);
  };

  const waitVisible = (id: number): Promise<void> =>
    new Promise((resolve) => {
      if (typeof document === 'undefined' || !document.hidden || run.current !== id) {
        resolve();
        return;
      }
      visibleWaiters.current.push(resolve);
    });

  /**
   * Seconds a `speak()` of `clipKey` counts for: the pack clip's length scaled
   * to the rate it played at (the player sets `playbackRate = rate / cue.rate`,
   * so a 10 s clip at 1.25× is 8 s of hearing), else the §2 estimate.
   */
  const spokenSeconds = (clipKey: string, morae: number, rate: number): number => {
    if (audioSourceOf(services.audio) === 'none') return 0;
    const cue = services.audio.clipFor?.(clipKey, { rate });
    if (cue) {
      const native = Math.max(0, cue.end - cue.start);
      return native * ((cue.rate > 0 ? cue.rate : 1) / (rate > 0 ? rate : 1));
    }
    return speechSeconds(morae, rate);
  };

  /**
   * Logs what the current track played and has not logged yet (a pause, a skip,
   * a speed change, leaving the page): the playback's `position()` when it has
   * one, else the `onPlayed` / spoken-lines count, minus the partials already
   * logged. Call it BEFORE `stopPlayback()`, while the playback is still there.
   */
  const flushPartial = (t: Track | undefined): void => {
    const pb = playback.current;
    const cur = pb?.position ? pb.position() : played.current;
    const partial = cur - logged.current;
    logged.current = Math.max(logged.current, cur);
    if (t && partial > 0) emitPlayed(t, partial, rateOf(t), null);
  };

  /** A question left open (← →, the lock screen's next, leaving the page) still logs its track, with `gistCorrect: null`. */
  const flushPendingGist = (): void => {
    const g = gistRef.current;
    if (!g) return;
    gistRef.current = null;
    setGist(null);
    emitPlayed(g.track, g.seconds, g.rate, null);
  };

  /* ── the engine ─────────────────────────────────────────────────────── */

  const finishPlaylist = (): void => {
    setStatus('done');
    setLine(null);
    if (modeRef.current === 'clips') setPlaybackState('none', { nav: p.nav });
  };

  const advance = (from: number): void => {
    const pl = playlistRef.current;
    if (!pl) return;
    if (loopRef.current) {
      void startTrack(from);
      return;
    }
    if (from + 1 < pl.tracks.length) void startTrack(from + 1);
    else finishPlaylist();
  };

  const endTrack = (t: Track, i: number, seconds: number, rate: number): void => {
    markListened(t);
    // `seconds` is what the track played beyond the partials already logged; nothing is left to log.
    played.current = 0;
    logged.current = 0;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (t.gist && !hidden) {
      const pending: PendingGist = { track: t, seconds, rate };
      gistRef.current = pending;
      setGist(pending);
      setStatus('question');
      setLine(null);
      return;
    }
    emitPlayed(t, seconds, rate, null);
    advance(i);
  };

  /**
   * Line-by-line through `speak()` (sentence tracks, and every track in device
   * mode); foreground only. Each finished line adds to `played.current`, so a
   * pause or skip can log what was heard; `fromLine` resumes a paused text at
   * the line it was on. Returns the seconds counted since this start.
   */
  const speakTrack = async (t: Track, id: number, rate: number, fromLine: number): Promise<number | null> => {
    if (t.kind === 'sentence' && t.ref) {
      const surface = surfaces[t.id] ?? refSurface(t.id, loader);
      const text = surface ? toPlain(surface.ja) : t.ref.kana;
      await waitVisible(id);
      if (run.current !== id) return null;
      setLine(0);
      await speak(text, { clip: t.clipKey, kana: t.ref.kana, rate, interrupt: true });
      if (run.current !== id) return null;
      played.current += spokenSeconds(t.clipKey, t.ref.morae, rate);
      return played.current;
    }
    if (t.kind === 'kana' && t.cue) {
      await waitVisible(id);
      if (run.current !== id) return null;
      await speak(t.cue.title, { clip: t.clipKey, rate, interrupt: true });
      if (run.current !== id) return null;
      played.current += audioSourceOf(services.audio) === 'none' ? 0 : t.seconds;
      return played.current;
    }
    const story = t.story;
    if (!story) return 0;
    const start = Math.max(0, Math.min(fromLine, story.lines.length - 1));
    for (let i = start; i < story.lines.length; i++) {
      await waitVisible(id);
      if (run.current !== id) return null;
      const line = story.lines[i] as StoryLine;
      lineAt.current = i;
      setLine(i);
      await speak(toPlain(line.ja), { clip: `${story.id}#L${i}`, speaker: line.speaker ?? story.narrator, kana: line.kana, rate, interrupt: i === start });
      if (run.current !== id) return null;
      played.current += spokenSeconds(`${story.id}#L${i}`, lineMorae(line), rate);
    }
    return played.current;
  };

  /** A whole-track pack cue: edge to edge, `ended` advances; `null` = superseded, `undefined` = fall back to `speak()`. */
  const playCue = async (t: Track, id: number, rate: number): Promise<number | null | undefined> => {
    if (!clips) return undefined;
    let cue: ClipCue | undefined = t.cue;
    if (!cue && t.kind === 'text' && t.station !== null) {
      try {
        await clips.loadStation(t.station);
      } catch {
        // the station index may be missing from this pack: cueFor below misses and we fall back
      }
      if (run.current !== id) return null;
      cue = clips.cueFor(t.clipKey, { rate, speaker: t.speaker ?? undefined });
    }
    if (!cue) return undefined;
    const whole = cue;
    setMetadata({ title: t.title, speaker: t.speaker, voice: whole.voice, station: t.station }, { nav: p.nav });
    setPlaybackState('playing', { nav: p.nav });
    // Karaoke-timed transcript (design 08 §10.2): the per-line cues of the same sprite say which line `sec` seconds in falls on.
    // Foreground only — the player drives it from requestAnimationFrame — and never used for counting.
    const story = t.story;
    const lineCues: (ClipCue | undefined)[] = story ? story.lines.map((_, i) => clips.cueFor(`${story.id}#L${i}`)) : [];
    const lineAtTime = (sec: number): number | null => {
      const pos = whole.start + sec;
      for (let i = 0; i < lineCues.length; i++) {
        const c = lineCues[i];
        if (c && c.file === whole.file && c.start <= pos && pos < c.end) return i;
      }
      return null;
    };
    played.current = 0;
    const pb = clips.play(whole, {
      rate,
      volume,
      wholeTrack: true,
      onPlayed: (s) => {
        played.current = s;
      },
      ...(lineCues.some((c) => c !== undefined)
        ? {
            onProgress: (sec: number) => {
              if (run.current === id) setLine(lineAtTime(sec));
            },
          }
        : {}),
    });
    playback.current = pb;
    const r = await pb.done;
    if (playback.current === pb) playback.current = null;
    if (run.current !== id) return null;
    if (r.source === 'none') return undefined;
    played.current = r.seconds;
    return r.seconds;
  };

  const startTrack = async (i: number, o: { fromLine?: number } = {}): Promise<void> => {
    const pl = playlistRef.current;
    const t = pl?.tracks[i];
    if (!pl || !t) {
      finishPlaylist();
      return;
    }
    stopPlayback();
    const id = run.current;
    indexRef.current = i;
    setIndex(i);
    gistRef.current = null;
    setGist(null);
    setLine(null);
    setFellBack(false);
    played.current = 0;
    logged.current = 0;
    const fromLine = o.fromLine ?? 0;
    lineAt.current = fromLine;
    setStatus('playing');
    const rate = rateOf(t);
    if (modeRef.current === 'text') {
      setStatus('paused');
      return;
    }
    let fromCue: number | null | undefined;
    if (modeRef.current === 'clips' && t.kind !== 'sentence') {
      fromCue = await playCue(t, id, rate);
      if (fromCue === null) return;
    }
    let seconds: number;
    if (fromCue === undefined) {
      if (modeRef.current === 'clips') {
        // A foreground track in pack mode (a sentence, or a text the pack has no whole track for): the lock-screen card still names it,
        // and the card says why this one will not run with the screen off.
        if (t.kind !== 'sentence') setFellBack(true);
        const lineCue = services.audio.clipFor?.(t.clipKey, { rate, speaker: t.speaker ?? undefined });
        setMetadata({ title: t.title, speaker: t.speaker, voice: lineCue?.voice ?? '', station: t.station }, { nav: p.nav });
        setPlaybackState('playing', { nav: p.nav });
      }
      const spoken = await speakTrack(t, id, rate, fromLine);
      if (spoken === null) return;
      seconds = spoken;
    } else if (fromCue === null) return;
    else seconds = fromCue;
    if (run.current !== id) return;
    // a pause in place already logged `logged.current` of these seconds as a partial row
    endTrack(t, i, Math.max(0, seconds - logged.current), rate);
  };

  /* ── controls ───────────────────────────────────────────────────────── */

  const currentTrack = (): Track | undefined => playlistRef.current?.tracks[indexRef.current];

  const play = (): void => {
    const pl = playlistRef.current;
    if (!pl || pl.tracks.length === 0) return;
    services.audio.warmUp();
    clips?.unlock();
    if (clips && modeRef.current === 'clips') {
      // Sentence clips resolve inside `speak()` from the level index; warm it here, in the gesture.
      clips.loadLevel(levelOfStation(station)).catch(() => undefined);
      // design 08 §13: no idle prefetch under data saver — the learner's toggle OR the browser's saveData, one gate for every reader
      if (!dataSaverOn(settings)) clips.prefetchStation(station);
    }
    const st = statusRef.current;
    if (st === 'question') {
      skipGist();
      return;
    }
    if (st === 'done') {
      setHeard(0);
      void startTrack(0);
      return;
    }
    if (st === 'paused') {
      const pb = playback.current;
      if (pausedInPlace.current && pb?.resume) {
        // the whole-track playback paused in place: continue the same playback from the same position (design 08 §10.2)
        pausedInPlace.current = false;
        pb.resume();
        setStatus('playing');
        setNote(null); // the "Paused…" line would contradict data-status="playing"
        if (modeRef.current === 'clips') setPlaybackState('playing', { nav: p.nav });
        return;
      }
      // a line-by-line track picks up at its line; a whole-track playback without pause() starts over
      void startTrack(indexRef.current, { fromLine: lineAt.current });
      return;
    }
    void startTrack(st === 'idle' ? 0 : indexRef.current);
  };

  const pause = (): void => {
    if (statusRef.current !== 'playing') return;
    const t = currentTrack();
    const pb = playback.current;
    if (pb?.pause && pb.resume) {
      // In place: the playback keeps its position; the seconds so far go to the ledger now, the rest arrive with `done`.
      pb.pause();
      pausedInPlace.current = true;
      flushPartial(t);
      setStatus('paused');
      setNote(S.pauseNoteInPlace);
      if (modeRef.current === 'clips') setPlaybackState('paused', { nav: p.nav });
      return;
    }
    const wholeTrack = pb !== null;
    flushPartial(t);
    stopPlayback();
    setStatus('paused');
    setLine(null);
    setNote(wholeTrack ? S.pauseNote : S.pauseNoteLines);
    if (modeRef.current === 'clips') setPlaybackState('paused', { nav: p.nav });
  };

  const togglePlay = (): void => {
    if (statusRef.current === 'playing') pause();
    else play();
  };

  const jump = (delta: number): void => {
    const pl = playlistRef.current;
    if (!pl || pl.tracks.length === 0) return;
    const t = currentTrack();
    const st = statusRef.current;
    // what played so far is logged first (a pausable playback's position()), then the playback goes
    if (st === 'playing') flushPartial(t);
    stopPlayback();
    // moving on from an open question skips it, but the track it followed is still logged
    flushPendingGist();
    if (st !== 'playing') {
      // paused: the partial was logged at the pause
      played.current = 0;
      logged.current = 0;
    }
    lineAt.current = 0;
    const next = Math.max(0, Math.min(pl.tracks.length - 1, indexRef.current + delta));
    indexRef.current = next;
    setIndex(next);
    if (st === 'playing' || st === 'question') void startTrack(next);
    else {
      setStatus('paused');
      setLine(null);
    }
  };

  const changeSpeed = (delta: number): void => {
    const next = Math.max(TIER_MIN - baseTier, Math.min(TIER_MAX - baseTier, offsetRef.current + delta));
    if (next === offsetRef.current) return;
    const t = currentTrack();
    const playing = statusRef.current === 'playing';
    if (playing) {
      // what played so far is logged at the rate it played at, before the offset moves
      flushPartial(t);
      stopPlayback();
    } else if (pausedInPlace.current) {
      // a playback has no rate change: the paused position is dropped (its seconds were logged at the pause) and play starts the track over at the new speed
      stopPlayback();
    }
    offsetRef.current = next;
    setOffset(next);
    setNote(S.speedNote);
    if (playing) void startTrack(indexRef.current, { fromLine: lineAt.current });
  };

  const flashTranscript = (): void => {
    setFlashOpen(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlashOpen(false);
    }, TRANSCRIPT_FLASH_MS);
  };

  /** The line the learner is hearing: the spoken line in device mode, else the pack position over the per-line cues. */
  const currentLine = (t: Track): StoryLine | null => {
    if (!t.story) return null;
    if (lineIdx !== null) return t.story.lines[lineIdx] ?? null;
    if (clips && modeRef.current === 'clips') {
      const whole = clips.cueFor(t.clipKey, { rate: rateOf(t) });
      if (whole) {
        const pos = whole.start + played.current;
        for (let i = 0; i < t.story.lines.length; i++) {
          const c = clips.cueFor(`${t.story.id}#L${i}`);
          if (c && c.file === whole.file && c.start <= pos && pos < c.end) return t.story.lines[i] ?? null;
        }
      }
    }
    return null;
  };

  const didntCatch = (): void => {
    const t = currentTrack();
    if (!t) return;
    let ids: string[] = [];
    if (t.kind === 'sentence' && t.ref) ids = t.ref.ids;
    else if (t.kind === 'text') {
      const line = currentLine(t);
      ids = (line?.tokenIds ?? []).filter((x): x is string => !!x);
    }
    const today = store.today();
    let written = 0;
    const seenKeys = new Set<string>();
    for (const id of ids) {
      if (tryKindOfId(id) !== 'vocab') continue;
      const key = cardKey(id, 'listen');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const card = store.cards.get(key);
      if (!card || card[0] > today + IMPLICIT_WINDOW_DAYS) continue;
      const out = recordImplicit({ cardKey: key, rating: 2, exercise: RADIO_IMPLICIT_EXERCISE, sessionId: 'radio', dueWithin: IMPLICIT_WINDOW_DAYS });
      if (out) written++;
    }
    setNote(written > 0 ? fill(S.didntCatchNote, { n: written }) : S.didntCatchNone);
    flashTranscript();
  };

  const glossWord = (): void => {
    const t = currentTrack();
    if (!t) return;
    let id: string | null = t.glossId;
    if (t.kind === 'text') {
      const line = currentLine(t);
      id = line?.plusOne?.[0] ?? null;
    }
    if (!id) {
      setNote(S.glossNone);
      return;
    }
    const show = (item: ContentItem | undefined): void => {
      if (isVocab(item)) setNote(fill(S.glossLine, { word: item.word, kana: item.kana, en: item.meanings[0] ?? '' }));
      else setNote(S.glossNone);
    };
    const item = loader.get(id);
    if (item) show(item);
    else
      loader
        .getAsync(id)
        .then(show)
        .catch(() => setNote(S.glossNone));
  };

  const answerGist = (choice: number | null): void => {
    const g = gistRef.current;
    if (!g) return;
    const q = g.track.gist;
    const correct = choice === null || !q ? null : choice === q.answer;
    gistRef.current = null;
    setGist(null);
    emitPlayed(g.track, g.seconds, g.rate, correct);
    setNote(correct === null ? S.gistSkipped : correct ? S.gistCorrect : fill(S.gistWrong, { answer: q ? q.choices[q.answer] : '' }));
    advance(indexRef.current);
  };
  const skipGist = (): void => answerGist(null);

  /* ── effects: keys, visibility, media session, unmount ─────────────── */

  const actions = useRef({ togglePlay, play, pause, jump, changeSpeed, didntCatch, glossWord, answerGist });
  actions.current = { togglePlay, play, pause, jump, changeSpeed, didntCatch, glossWord, answerGist };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Space on a focused button is that button's own activation (a gist choice answers, Play toggles once); the shortcut is for the page.
      if (e.key === ' ' && tag === 'BUTTON') return;
      const a = actions.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          a.togglePlay();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          a.jump(-1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          a.jump(1);
          return;
        case 'l':
        case 'L':
          setLoop((v) => !v);
          return;
        case '[':
          a.changeSpeed(-1);
          return;
        case ']':
          a.changeSpeed(1);
          return;
        case 't':
        case 'T':
          setTranscriptOpen((v) => !v);
          return;
        case 'g':
        case 'G':
          a.glossWord();
          return;
        case '?':
          e.preventDefault();
          a.didntCatch();
          return;
        case '1':
        case '2':
        case '3':
        case '4':
          if (statusRef.current === 'question') a.answerGist(Number(e.key) - 1);
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = (): void => {
      if (!document.hidden) for (const w of visibleWaiters.current.splice(0)) w();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (mode !== 'clips') return;
    const h = setHandlers(
      {
        play: () => actions.current.play(),
        pause: () => actions.current.pause(),
        previoustrack: () => actions.current.jump(-1),
        nexttrack: () => actions.current.jump(1),
        seekbackward: () => actions.current.jump(0),
      },
      { nav: p.nav },
    );
    return () => h.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(
    () => () => {
      // Leaving the page is a pause: what played is logged, and a question left open still logs its track.
      const t = playlistRef.current?.tracks[indexRef.current];
      const playing = statusRef.current === 'playing';
      if (playing) flushPartial(t);
      stopPlayback();
      flushPendingGist();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ── render ─────────────────────────────────────────────────────────── */

  const chip = mode === 'clips' ? S.chipSynthetic : mode === 'device' ? S.chipDevice : S.chipTextOnly;
  const sourceNotice = mode === 'clips' ? S.noticePack : mode === 'device' ? (packReady ? S.noticeDeviceChosen : S.noticeDevice) : volume <= 0 ? S.noticeVolumeOff : S.noticeNoVoice;
  const track = playlist?.tracks[index];
  const rate = track ? rateOf(track) : SPEED_TIER_RATES[clampTier(baseTier + offset)];
  const minutesReady = playlist ? Math.round(playlist.seconds / 60) : 0;
  const transcriptShown = transcriptOpen || flashOpen;
  const furigana = settings.furigana;

  const header = (
    <header class="radio__head">
      <span class="radio__band" aria-hidden="true" title={chip} />
      <h2 class="radio__title">
        <span lang="ja" class="radio__title-ja">
          {S.titleJa}
        </span>
        <span>{S.title}</span>
      </h2>
      <div class="radio__meta">
        <span class="chip radio__chip-source" data-mode={mode}>
          {chip}
        </span>
        <span class="chip">{fill(S.chipSpeed, { rate })}</span>
        <span class="chip">{fill(S.chipStation, { n: station })}</span>
        {playlist ? <span class="chip">{fill(S.chipMinutes, { n: minutesReady })}</span> : null}
      </div>
    </header>
  );

  const teach = (
    <TeachOnce
      id={RADIO_TEACH_ID}
      title={S.teachTitle}
      body={S.teachBody}
      seen={progress.teachSeen}
      onDismiss={(id) => store.patch('progress', (pr) => markTeachSeen(pr, id))}
      class="radio__teach"
    />
  );

  if (status === 'loading' || status === 'unavailable' || !playlist) {
    return (
      <section class="radio" data-status={status} aria-label={S.title}>
        {header}
        <p class="radio__state" role="status">
          {status === 'unavailable' ? S.loadError : S.loading}
        </p>
      </section>
    );
  }

  const noticeText =
    playlist.notice === 'empty' ? S.noticeEmpty : playlist.notice === 'no-pieces-yet' ? S.noticeNoPieces : playlist.notice === 'nothing-new' ? fill(S.noticeNothingNew, { n: station }) : null;

  const lines: StoryLine[] = track?.story?.lines ?? [];
  const sentence = track?.kind === 'sentence' ? (surfaces[track.id] ?? null) : null;
  const gistQ = gist?.track.gist ?? null;
  const gistJa = gistQ ? containsJapanese(gistQ.q) : false;

  return (
    <section class="radio" data-status={status} data-mode={mode} aria-label={S.title}>
      {header}
      {teach}
      <p class="radio__tagline">{S.tagline}</p>
      <div class={`notice radio__notice${mode === 'clips' ? '' : ' notice--warn'}`} role="status">
        {sourceNotice}
      </div>
      {noticeText ? (
        <p class="radio__playlist-notice" role="status">
          {noticeText}
        </p>
      ) : null}

      {status === 'done' ? (
        <div class="radio__done status-window" role="status">
          <h3 class="radio__subtitle">{S.doneTitle}</h3>
          <p>{fill(S.doneLine, { n: round1(heard / 60) })}</p>
          {note ? (
            <p class="radio__note" lang={containsJapanese(note) ? 'ja' : undefined}>
              {note}
            </p>
          ) : null}
          <button type="button" class="hanko" onClick={play}>
            {S.playAgain}
          </button>
        </div>
      ) : track ? (
        <div class="radio__track status-window" aria-live="polite">
          <p class="radio__track-of">{fill(S.trackOf, { i: index + 1, n: playlist.tracks.length })}</p>
          <div class="radio__track-head">
            <span class="chip chip--tag">{kindLabel(track)}</span>
            {track.cold ? <span class="chip chip--accent">{S.coldLabel}</span> : null}
          </div>
          <h3 class="radio__track-title">
            <span lang="ja">{containsJapanese(track.title) ? <Ruby ja={track.title} mode={furigana} /> : track.title}</span>
            {track.titleEn ? <span class="radio__track-en">{track.titleEn}</span> : sentence ? <span class="radio__track-en">{sentence.en}</span> : null}
          </h3>
          {track.rehearing ? <p class="radio__again">{fill(S.againAt, { rate })}</p> : null}
          {fellBack ? (
            <p class="radio__track-notice" role="status">
              {S.noticeNoWholeTrack}
            </p>
          ) : null}
          <p class="radio__status">
            {status === 'playing' ? (lineIdx !== null && lines.length > 0 ? fill(S.lineOf, { i: lineIdx + 1, n: lines.length }) : S.playing) : status === 'paused' ? S.paused : status === 'question' ? S.gistTitle : S.readyLine}
          </p>
          {note ? (
            <p class="radio__note" role="status" lang={containsJapanese(note) ? 'ja' : undefined}>
              {note}
            </p>
          ) : null}
        </div>
      ) : null}

      {status === 'question' && gist && gistQ ? (
        <div class="radio__gist status-window" role="group" aria-label={S.gistTitle}>
          <p class="radio__gist-prompt">{S.gistTitle}</p>
          <p class="radio__gist-q" lang={gistJa ? 'ja' : undefined}>
            {gistJa ? <Ruby ja={gistQ.q} mode={furigana} /> : gistQ.q}
          </p>
          <ol class="radio__choices">
            {gistQ.choices.map((c, i) => (
              <li key={i}>
                <button type="button" class="radio__choice" aria-label={fill(S.gistChoice, { n: i + 1 })} aria-keyshortcuts={String(i + 1)} onClick={() => answerGist(i)}>
                  <kbd aria-hidden="true">{i + 1}</kbd>
                  <span lang={containsJapanese(c) ? 'ja' : undefined}>{containsJapanese(c) ? <Ruby ja={c} mode={furigana} /> : c}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" class="btn btn--ghost" onClick={skipGist}>
            {S.gistSkip}
          </button>
        </div>
      ) : null}

      {status !== 'done' ? (
        <div class="radio__controls" role="toolbar" aria-label={S.title}>
          <button type="button" class="btn" onClick={() => jump(-1)} disabled={playlist.tracks.length === 0} aria-keyshortcuts="ArrowLeft">
            {S.previous}
          </button>
          <button type="button" class="hanko radio__play" onClick={togglePlay} disabled={playlist.tracks.length === 0 || mode === 'text'} aria-keyshortcuts="Space">
            {status === 'playing' ? S.pause : status === 'paused' ? S.resume : S.play}
          </button>
          <button type="button" class="btn" onClick={() => jump(1)} disabled={playlist.tracks.length === 0} aria-keyshortcuts="ArrowRight">
            {S.next}
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => setLoop((v) => !v)} aria-pressed={loop} aria-keyshortcuts="L">
            {loop ? S.loopOn : S.loop}
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => changeSpeed(-1)} aria-keyshortcuts="[">
            {S.slower}
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => changeSpeed(1)} aria-keyshortcuts="]">
            {S.faster}
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => setTranscriptOpen((v) => !v)} aria-pressed={transcriptShown} aria-keyshortcuts="T">
            {S.transcript}
          </button>
          <button type="button" class="btn btn--ghost" onClick={glossWord} aria-keyshortcuts="G">
            {S.gloss}
          </button>
          <button type="button" class="btn btn--ghost" onClick={didntCatch} aria-keyshortcuts="?">
            {S.didntCatch}
          </button>
        </div>
      ) : null}
      <p class="radio__keys">{S.keysHelp}</p>

      {track && (transcriptShown || mode === 'text') && status !== 'done' ? (
        <div class="radio__transcript" data-flash={flashOpen && !transcriptOpen ? 'true' : undefined}>
          <div class="radio__transcript-head">
            <h3 class="radio__subtitle">{S.transcriptTitle}</h3>
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => setShowEn((v) => !v)} aria-pressed={showEn}>
              {showEn ? S.hideEnglish : S.showEnglish}
            </button>
          </div>
          {track.kind === 'text' ? (
            <ol class="radio__lines" aria-live="off">
              {lines.map((l, i) => (
                <li key={i} class="radio__line" data-speaking={lineIdx === i ? 'true' : undefined} aria-current={lineIdx === i ? 'true' : undefined}>
                  {l.speaker ? (
                    <span class="radio__speaker" lang="ja" aria-label={fill(S.speakerLabel, { name: l.speaker })}>
                      {l.speaker}
                    </span>
                  ) : null}
                  <span class="radio__line-ja">
                    <Ruby ja={l.ja} mode={furigana} />
                  </span>
                  {showEn ? <span class="radio__line-en">{l.en}</span> : null}
                  {lineIdx === i ? <span class="sr-only">{S.nowSpeaking}</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p class="radio__line radio__line--one">
              <span class="radio__line-ja" lang="ja">
                {sentence ? <Ruby ja={sentence.ja} mode={furigana} /> : track.title}
              </span>
              {showEn && (sentence?.en || track.titleEn) ? <span class="radio__line-en">{sentence?.en ?? track.titleEn}</span> : null}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
