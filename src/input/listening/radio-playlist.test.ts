import { DIALOGUE, G, STORY, V } from '@/content/fixtures';
import type { CardKey, PoolRef, StoryItem } from '@/content/types';
import { ARENA_RECENT_DAYS as POOL_ARENA_RECENT_DAYS } from '@/learn';
import { SPEED_TIER_RATES, type SpeedTier, type TrackCue } from '@/shared/audio';
import { cardKey } from '@/shared/ids';
import type { CardTuple } from '@/shared/store-types';
import { card } from '@/store/testing';
import {
  ARENA_FUTURE_SLACK_DAYS,
  ARENA_RECENT_DAYS,
  COLD_MAX_TRACKS,
  RADIO_MAX_SECONDS,
  arenaRecentIds,
  buildPlaylist,
  gistQuestion,
  lineMorae,
  listenRetention,
  radioEligible,
  rehearingAsksGist,
  rehearingTier,
  speakerOf,
  speechSeconds,
  textSeconds,
  type PlaylistInput,
  type Track,
} from './radio-playlist';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const TODAY = 20_000;
const SEED = '0123456789abcdef';

function story(id: string, o: Partial<StoryItem> = {}): StoryItem {
  const base = o.kind === 'dialogue' ? DIALOGUE : STORY;
  return { ...base, id, stationId: `st-${id.slice(2, 4)}`, titleJa: `${base.titleJa}${id}`, titleEn: `${base.titleEn} ${id}`, ...o };
}

/** A Yellow piece (audio-first, `exchange`). */
const piece = (id: string, o: Partial<StoryItem> = {}): StoryItem => story(id, { kind: 'dialogue', audioFirst: true, genre: 'exchange', ...o });
/** A casual bridge dialogue (authentic-style). */
const bridge = (id: string): StoryItem => story(id, { kind: 'dialogue', register: 'casual', bridge: true });
/** A polite non-bridge dialogue (not authentic-style). */
const polite = (id: string): StoryItem => story(id, { kind: 'dialogue', register: 'polite' });

const VOCAB_IDS = Object.values(V);
const KNOWN = new Set<string>([...VOCAB_IDS, ...Object.values(G)]);

function refs(n: number): PoolRef[] {
  const out: PoolRef[] = [];
  for (let i = 0; i < n; i++) {
    const a = VOCAB_IDS[i % VOCAB_IDS.length] as string;
    const b = VOCAB_IDS[(i + 3) % VOCAB_IDS.length] as string;
    out.push({ ref: `${a}#ex${Math.floor(i / VOCAB_IDS.length)}`, ids: [a, b], kana: `れい${i}です。`, morae: 8 + (i % 12) });
  }
  return out;
}

function cardsOf(map: Record<string, CardTuple>): { get(k: CardKey): CardTuple | undefined } {
  return { get: (k) => map[k] };
}
const NO_CARDS = cardsOf({});

const kanaCue = (name: string, seconds: number): TrackCue => ({ key: `track:${name}`, file: `audio/sprites/kana/${name}-abcdef12.webm`, start: 0, end: seconds, voice: 'VOICEVOX:test', rate: 1, title: name, titleEn: `${name} row` });

function input(o: Partial<PlaylistInput> = {}): PlaylistInput {
  return { seed: SEED, day: TODAY, station: 4, known: KNOWN, cards: NO_CARDS, listened: [], pools: [], stories: [], tier: 2, ...o };
}

const ids = (tracks: Track[]): string[] => tracks.map((t) => t.id);
const kinds = (tracks: Track[]): string[] => tracks.map((t) => t.kind);

/* ── helpers ─────────────────────────────────────────────────────────────── */

describe('radio-playlist helpers', () => {
  it('speechSeconds is the design 08 §2 estimate (morae ÷ 7 + 0.5 s) divided by the rate', () => {
    expect(speechSeconds(7, 1)).toBeCloseTo(1.5);
    expect(speechSeconds(7, 1.5)).toBeCloseTo(1);
    expect(speechSeconds(14, 0)).toBeCloseTo(2.5); // a zero rate never divides by zero
    expect(textSeconds(STORY, 1)).toBeGreaterThan(STORY.lines.length * 0.5);
    expect(textSeconds(STORY, 1.25)).toBeCloseTo(textSeconds(STORY, 1) / 1.25);
  });

  it('lineMorae counts morae, not characters: small ゃゅょ merge, っ and long vowels count, punctuation drops; textSeconds is built on it', () => {
    expect(lineMorae({ kana: 'きょう、がっこうへ いきます。' })).toBe(11);
    expect(lineMorae({ kana: 'コーヒー' })).toBe(4);
    expect(lineMorae({ kana: 'ちょっと' })).toBe(3);
    expect(textSeconds({ lines: [{ kana: 'きょう、がっこうへ いきます。' }] as StoryItem['lines'] }, 1)).toBeCloseTo(speechSeconds(11, 1));
  });

  it('radioEligible: every story before Station 4, only pieces and dialogues from it', () => {
    expect(radioEligible(STORY, 1)).toBe(true);
    expect(radioEligible(STORY, 3)).toBe(true);
    expect(radioEligible(STORY, 4)).toBe(false);
    expect(radioEligible(DIALOGUE, 4)).toBe(true);
    expect(radioEligible({ kind: 'story', audioFirst: true }, 20)).toBe(true);
  });

  it('gistQuestion prefers a `gist` question and falls back to the first; rehearingTier caps at 5', () => {
    const s = story('s-04-3', { comprehension: [{ ...STORY.comprehension[0]!, kind: 'detail' }, { ...STORY.comprehension[1]!, kind: 'gist' }, STORY.comprehension[2]!] });
    expect(gistQuestion(s)).toBe(s.comprehension[1]);
    expect(gistQuestion(STORY)).toBe(STORY.comprehension[0]);
    expect(gistQuestion({ comprehension: [] })).toBeNull();
    expect(rehearingTier(1)).toBe(2);
    expect(rehearingTier(4)).toBe(5);
    expect(rehearingTier(5)).toBe(5);
  });

  it('rehearingAsksGist: authentic-style text at ≥ 1.0× only', () => {
    expect(rehearingAsksGist(bridge('s-10-1'), 1.0)).toBe(true);
    expect(rehearingAsksGist(bridge('s-10-1'), 0.9)).toBe(false);
    expect(rehearingAsksGist(polite('s-10-2'), 1.25)).toBe(false);
    expect(rehearingAsksGist(piece('s-32-4', { genre: 'news', kind: 'story', narrator: 'anchor' }), 1.1)).toBe(true);
  });

  it('speakerOf: narrator, else the first speaker, else null', () => {
    expect(speakerOf(STORY)).toBeNull();
    expect(speakerOf(DIALOGUE)).toBe('ケン');
    expect(speakerOf({ ...STORY, narrator: 'anchor' })).toBe('anchor');
  });

  it('listenRetention: the lowest R over existing listen cards names the weakest word; 1 / null without cards', () => {
    const strong = card({ due: TODAY + 30, s: 60, state: 2, reps: 5, last: TODAY - 1 });
    const weak = card({ due: TODAY - 5, s: 1, state: 2, reps: 3, last: TODAY - 40 });
    const cards = cardsOf({ [cardKey(V.水, 'listen')]: strong, [cardKey(V.飲む, 'listen')]: weak });
    const r = listenRetention({ ref: 'x#ex0', ids: [V.水, V.飲む, V.犬], kana: '', morae: 5 }, cards, TODAY);
    expect(r.weakest).toBe(V.飲む);
    expect(r.r).toBeLessThan(0.4);
    expect(listenRetention({ ref: 'y#ex0', ids: [V.犬], kana: '', morae: 5 }, cards, TODAY)).toEqual({ r: 1, weakest: null });
  });
});

/* ── buildPlaylist ───────────────────────────────────────────────────────── */

describe('buildPlaylist', () => {
  const yellow = [piece('s-04-4'), piece('s-04-5'), polite('s-04-2'), story('s-04-1')];

  it('is deterministic per (seed, day) and changes with the day', () => {
    const inp = input({ stories: yellow, pools: refs(40) });
    const a = buildPlaylist(inp);
    const b = buildPlaylist(inp);
    expect(a).toEqual(b);
    const c = buildPlaylist({ ...inp, day: TODAY + 1 });
    expect(ids(c.tracks)).not.toEqual(ids(a.tracks));
    expect(new Set(ids(c.tracks))).toEqual(new Set(ids(a.tracks))); // same material, another order
  });

  it('cold texts come first, at the learner’s tier, each with a gist question; sentences follow; the diary story is not Radio material at Station 4', () => {
    const pl = buildPlaylist(input({ stories: yellow, pools: refs(12), tier: 2 }));
    const k = kinds(pl.tracks);
    const lastText = k.lastIndexOf('text');
    const firstSentence = k.indexOf('sentence');
    expect(firstSentence).toBeGreaterThan(-1);
    expect(lastText).toBeLessThan(firstSentence);
    const cold = pl.tracks.filter((t) => t.cold);
    expect(cold.map((t) => t.id).sort()).toEqual(['s-04-2', 's-04-4', 's-04-5']);
    for (const t of cold) {
      expect(t.kind).toBe('text');
      expect(t.tier).toBe(2);
      expect(t.rate).toBe(SPEED_TIER_RATES[2]);
      expect(t.gist).not.toBeNull();
      expect(t.rehearing).toBe(false);
      expect(t.refs).toEqual([t.id]);
      expect(t.clipKey).toBe(t.id);
    }
    expect(ids(pl.tracks)).not.toContain('s-04-1');
    expect(pl.notice).toBeNull();
    expect(pl.coldLeft).toBe(0);
    for (const t of pl.tracks.filter((x) => x.kind === 'sentence')) {
      expect(t.cold).toBe(false);
      expect(t.gist).toBeNull();
      expect(t.refs).toEqual([t.id]);
      expect(t.rate).toBe(SPEED_TIER_RATES[2]);
    }
  });

  it('never exceeds 45 minutes, and respects a smaller budget', () => {
    const many: StoryItem[] = [];
    for (let st = 4; st <= 15; st++) for (const k of [4, 5]) many.push(piece(`s-${String(st).padStart(2, '0')}-${k}`));
    const inp = input({ station: 15, stories: many, pools: refs(2400), listened: many.slice(0, 10).map((s) => s.id) });
    const pl = buildPlaylist(inp);
    expect(pl.seconds).toBeLessThanOrEqual(RADIO_MAX_SECONDS);
    expect(pl.seconds).toBeGreaterThan(RADIO_MAX_SECONDS * 0.9);
    expect(pl.tracks.reduce((s, t) => s + t.seconds, 0)).toBeCloseTo(pl.seconds);
    expect(pl.tracks.filter((t) => t.cold).length).toBeLessThanOrEqual(COLD_MAX_TRACKS);
    const small = buildPlaylist({ ...inp, maxSeconds: 120 });
    expect(small.seconds).toBeLessThanOrEqual(120);
    expect(small.tracks.length).toBeGreaterThan(0);
  });

  it('cold texts of the nearest station come first', () => {
    const texts = [piece('s-04-4'), piece('s-07-4'), piece('s-09-4')];
    const pl = buildPlaylist(input({ station: 9, stories: texts }));
    expect(ids(pl.tracks.filter((t) => t.cold))).toEqual(['s-09-4', 's-07-4', 's-04-4']);
  });

  it('a Station-2 learner gets the kana tracks and the White lines, and the honest “no pieces yet” notice', () => {
    const white = [story('s-01-1'), story('s-01-2'), story('s-02-1')];
    const cues = [kanaCue('a-row', 30), kanaCue('ka-row', 32), kanaCue('counting', 25)];
    const pl = buildPlaylist(input({ station: 2, stories: [...white, piece('s-04-4')], kanaTracks: cues, tier: 1 }));
    const k = kinds(pl.tracks);
    expect(k.filter((x) => x === 'kana')).toHaveLength(3);
    expect(k.indexOf('text')).toBeGreaterThan(k.lastIndexOf('kana'));
    const kana = pl.tracks.filter((t) => t.kind === 'kana');
    for (const t of kana) {
      expect(t.tier).toBeNull();
      expect(t.rate).toBe(1);
      expect(t.cue).toBeDefined();
      expect(t.clipKey).toMatch(/^track:/);
      expect(t.refs).toEqual([t.clipKey]);
      expect(t.titleEn).toContain('row');
    }
    expect(ids(pl.tracks.filter((t) => t.kind === 'text')).sort()).toEqual(['s-01-1', 's-01-2', 's-02-1']); // Station 4 is above the learner
    expect(pl.notice).toBe('no-pieces-yet');
    // without a pack there are no kana tracks, and the notice still explains the station
    const noPack = buildPlaylist(input({ station: 2, stories: white, tier: 1 }));
    expect(kinds(noPack.tracks)).not.toContain('kana');
    expect(noPack.notice).toBe('no-pieces-yet');
  });

  it('re-hearings play one tier above the learner’s tier, least recently heard first, after the sentences', () => {
    const texts = [polite('s-04-2'), piece('s-04-4'), piece('s-04-5')];
    const pl = buildPlaylist(input({ stories: texts, pools: refs(6), listened: ['s-04-5', 's-04-2'], tier: 2 }));
    const again = pl.tracks.filter((t) => t.rehearing);
    expect(ids(again)).toEqual(['s-04-5', 's-04-2']);
    for (const t of again) {
      expect(t.cold).toBe(false);
      expect(t.tier).toBe(3);
      expect(t.rate).toBe(SPEED_TIER_RATES[3]);
    }
    const cold = pl.tracks.filter((t) => t.cold);
    expect(ids(cold)).toEqual(['s-04-4']);
    expect(cold[0]!.tier).toBe(2);
    const k = kinds(pl.tracks);
    expect(k.indexOf('sentence')).toBeLessThan(k.indexOf('text', k.indexOf('sentence')));
    // tier 5 stays tier 5
    const top = buildPlaylist(input({ stories: texts, listened: ['s-04-2'], tier: 5 }));
    expect(top.tracks.find((t) => t.rehearing)?.rate).toBe(SPEED_TIER_RATES[5]);
  });

  it('a re-hearing of a bridge text at 1.0× carries a gist question; a polite non-bridge dialogue does not; below 1.0× neither does', () => {
    const texts = [bridge('s-27-1'), polite('s-27-2')];
    const at1 = buildPlaylist(input({ station: 27, stories: texts, listened: ['s-27-1', 's-27-2'], tier: 2 }));
    const b = at1.tracks.find((t) => t.id === 's-27-1')!;
    const p = at1.tracks.find((t) => t.id === 's-27-2')!;
    expect(b.rate).toBe(1);
    expect(b.rehearing).toBe(true);
    expect(b.authenticStyle).toBe(true);
    expect(b.gist).not.toBeNull();
    expect(p.rate).toBe(1);
    expect(p.authenticStyle).toBe(false);
    expect(p.gist).toBeNull();
    const slow = buildPlaylist(input({ station: 27, stories: texts, listened: ['s-27-1'], tier: 1 }));
    const bs = slow.tracks.find((t) => t.id === 's-27-1')!;
    expect(bs.rate).toBe(SPEED_TIER_RATES[2]);
    expect(bs.gist).toBeNull();
    // a cold hearing of the same polite dialogue still offers its gist question
    const cold = buildPlaylist(input({ station: 27, stories: texts, tier: 1 }));
    expect(cold.tracks.find((t) => t.id === 's-27-2')!.gist).not.toBeNull();
  });

  it('arenaRecentIds: the ids whose last passed Arena set is within ARENA_RECENT_DAYS of today (a day of future slack counts; a far-future stamp, junk and undefined do not)', () => {
    expect(ARENA_RECENT_DAYS).toBe(14);
    expect(ARENA_RECENT_DAYS).toBe(POOL_ARENA_RECENT_DAYS); // the one 14-day window: @/learn's (pool.ts), shared with session/builder.ts
    expect(ARENA_FUTURE_SLACK_DAYS).toBe(1);
    const at = { 's-04-4': TODAY - 3, 's-04-5': TODAY - 20, 's-04-6': TODAY - 14, 's-04-7': TODAY + ARENA_FUTURE_SLACK_DAYS, 's-04-8': Number.NaN, 's-04-9': TODAY + ARENA_FUTURE_SLACK_DAYS + 1 };
    expect([...arenaRecentIds(at, TODAY)].sort()).toEqual(['s-04-4', 's-04-6', 's-04-7']);
    expect([...arenaRecentIds(at, TODAY, 2)]).toEqual(['s-04-7']);
    expect(arenaRecentIds({ 's-04-4': TODAY + 400 }, TODAY).size).toBe(0); // a clock set years ahead never pins a text as "worked on recently"
    expect(arenaRecentIds(undefined, TODAY).size).toBe(0);
    expect(arenaRecentIds({}, TODAY).size).toBe(0);
  });

  it('a text the Arena passed 3 days ago leads the re-hearings (worked on recently); one passed 20 days ago keeps its least-recently-heard place; a recent pass is never cold even when the heard-set forgot it', () => {
    const texts = [piece('s-04-4'), piece('s-04-5'), piece('s-04-6')];
    const listened = ['s-04-4', 's-04-5']; // s-04-4 is the least recently heard
    const plain = buildPlaylist(input({ stories: texts, listened }));
    expect(ids(plain.tracks.filter((t) => t.rehearing))).toEqual(['s-04-4', 's-04-5']);
    const recent = arenaRecentIds({ 's-04-5': TODAY - 3, 's-04-4': TODAY - 20 }, TODAY);
    expect([...recent]).toEqual(['s-04-5']);
    const pl = buildPlaylist(input({ stories: texts, listened, arenaRecent: recent }));
    expect(ids(pl.tracks.filter((t) => t.rehearing))).toEqual(['s-04-5', 's-04-4']);
    expect(ids(pl.tracks.filter((t) => t.cold))).toEqual(['s-04-6']);
    for (const t of pl.tracks) expect(t.tier).toBe(t.cold ? 2 : 3);
    // the heard-set is capped by the store: a recent Arena pass that fell out of it is still a re-hearing, an old one is cold again
    const capped = buildPlaylist(input({ stories: texts, listened: [], arenaRecent: recent }));
    expect(capped.tracks.find((t) => t.id === 's-04-5')!.cold).toBe(false);
    expect(capped.tracks.find((t) => t.id === 's-04-4')!.cold).toBe(true);
    expect(ids(capped.tracks.filter((t) => t.cold)).sort()).toEqual(['s-04-4', 's-04-6']);
  });

  it('no text within its 14-day Arena window is served as cold', () => {
    expect(ARENA_RECENT_DAYS).toBe(14);
    const texts = [piece('s-04-4'), piece('s-04-5')];
    const pl = buildPlaylist(input({ stories: texts, arenaRecent: new Set(['s-04-4']) }));
    const t4 = pl.tracks.find((t) => t.id === 's-04-4')!;
    expect(t4.cold).toBe(false);
    expect(t4.rehearing).toBe(true);
    expect(t4.tier).toBe(3);
    expect(pl.tracks.find((t) => t.id === 's-04-5')!.cold).toBe(true);
    expect(ids(pl.tracks)).toEqual(['s-04-5', 's-04-4']); // the Arena text comes after the cold one, as a re-hearing
  });

  it('says “nothing new” when every piece up to the station is heard, and “empty” when there is nothing at all', () => {
    const texts = [piece('s-04-4'), piece('s-04-5')];
    const heard = buildPlaylist(input({ stories: texts, listened: ['s-04-4', 's-04-5'], pools: refs(4) }));
    expect(heard.notice).toBe('nothing-new');
    expect(heard.tracks.filter((t) => t.cold)).toHaveLength(0);
    expect(heard.tracks.filter((t) => t.rehearing)).toHaveLength(2);
    expect(buildPlaylist(input()).notice).toBe('empty');
    expect(buildPlaylist(input()).tracks).toEqual([]);
  });

  it('i+0 sentences only: a ref with an unknown word is left out; weights favour low listen retention through `glossId`', () => {
    const known = new Set<string>([V.水, V.犬, V.飲む]);
    const pools: PoolRef[] = [
      { ref: 'v-n5-0003#ex0', ids: [V.水, V.犬], kana: 'みずといぬ。', morae: 6 },
      { ref: 'v-n5-0007#ex0', ids: [V.飲む, V.パン], kana: 'パンをのむ。', morae: 6 }, // パン unknown → not i+0
    ];
    const weak = card({ due: TODAY - 5, s: 2, state: 2, reps: 3, last: TODAY - 20 });
    const pl = buildPlaylist(input({ known, pools, cards: cardsOf({ [cardKey(V.犬, 'listen')]: weak }) }));
    expect(ids(pl.tracks)).toEqual(['v-n5-0003#ex0']);
    expect(pl.tracks[0]!.glossId).toBe(V.犬);
    expect(pl.tracks[0]!.station).toBeNull(); // a vocab id carries no station in its id (ids.stationOfId)
  });

  it('texts above the station and duplicates are ignored; the tier table drives every rate', () => {
    const texts = [piece('s-04-4'), piece('s-04-4'), piece('s-09-4')];
    for (const tier of [1, 2, 3, 4, 5] as SpeedTier[]) {
      const pl = buildPlaylist(input({ station: 4, stories: texts, tier }));
      expect(ids(pl.tracks)).toEqual(['s-04-4']);
      expect(pl.tracks[0]!.rate).toBe(SPEED_TIER_RATES[tier]);
    }
  });
});
