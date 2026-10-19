/**
 * clips.ts — against a fake `Audio` (currentTime, playbackRate, preservesPitch,
 * play / pause spies, timeupdate / ended dispatch), a fake rAF, a fake Cache
 * API bucket and a fake fetch serving a small `tsuzuku.audio/1` pack, under
 * fake timers.
 */
import type { ClipCue } from '../shared/audio';
import { fnv1a32 } from '../shared/hash';
import {
  AUDIO_CACHE,
  CACHE_UNAVAILABLE,
  END_EPSILON_S,
  OPUS_BLOB_TYPE,
  OPUS_PROBE_TYPE,
  POOL_SIZE,
  STOP_BACKSTOP_MS,
  beltOfPath,
  byTextKey,
  clauseRange,
  createClipPlayer,
  isSentenceText,
  karaokeAt,
  nearestRate,
  parseIndex,
  parseManifest,
  spritePath,
  type CacheLike,
  type ClipPlayerEx,
  type ClipPlayerOptions,
  type DocLike,
  type MediaLike,
  type RafLike,
} from './clips';

/* ────────────────────────────────────────────────────────────────────────── */
/* Fakes                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

type Fn = (ev?: unknown) => void;

class FakeAudio implements MediaLike {
  static created = 0;
  static all: FakeAudio[] = [];
  private _src = '';
  srcHistory: string[] = [];
  currentTime = 0;
  playbackRate = 1;
  volume = 1;
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
  paused = true;
  plays = 0;
  pauses = 0;
  /** When true, `play()` returns a rejected promise (autoplay refused: a `NotAllowedError`). */
  rejectPlay = false;
  /** Elements constructed while this is true refuse their first play (the gesture did not count). */
  static refuseNext = false;
  /** Elements constructed while this is true keep every play() pending until `startPlaying()` (a real engine's latency). */
  static deferNext = false;
  private listeners = new Map<string, Set<Fn>>();
  constructor() {
    FakeAudio.created++;
    FakeAudio.all.push(this);
    this.rejectPlay = FakeAudio.refuseNext;
    this.deferPlay = FakeAudio.deferNext;
  }
  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.srcHistory.push(v);
  }
  /**
   * When true, `play()` stays pending until `startPlaying()` (the `playing` event: a fresh blob src still decoding)
   * and `pause()` rejects it with `AbortError`, as the HTML spec has browsers do.
   */
  deferPlay = false;
  /** Every pending play() promise (the HTML spec keeps a list: a second play() before `playing` joins it). */
  private pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  play(): Promise<void> | void {
    this.plays++;
    this.paused = false;
    if (this.rejectPlay) return Promise.reject(Object.assign(new Error("play() failed because the user didn't interact with the document first."), { name: 'NotAllowedError' }));
    if (!this.deferPlay) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }
  private takePending(): { resolve: () => void; reject: (e: unknown) => void }[] {
    const p = this.pending;
    this.pending = [];
    return p;
  }
  pause(): void {
    this.pauses++;
    this.paused = true;
    for (const p of this.takePending()) p.reject(Object.assign(new Error('The play() request was interrupted by a call to pause().'), { name: 'AbortError' }));
    this.dispatch('timeupdate'); // the HTML spec's internal pause steps fire timeupdate, then pause
    this.dispatch('pause');
  }
  /** The `playing` event: every deferred `play()` promise resolves. */
  startPlaying(): void {
    for (const p of this.takePending()) p.resolve();
  }
  /** The engine refuses the deferred `play()` (no gesture counted): `NotAllowedError`. */
  refusePlaying(): void {
    this.paused = true;
    for (const p of this.takePending()) p.reject(Object.assign(new Error("play() failed because the user didn't interact with the document first."), { name: 'NotAllowedError' }));
  }
  canPlayType(): string {
    return 'probably';
  }
  addEventListener(type: string, fn: Fn): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Fn): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn();
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** Media clock advances and `timeupdate` fires. */
  tick(t: number): void {
    this.currentTime = t;
    this.dispatch('timeupdate');
  }
  end(): void {
    this.paused = true;
    this.dispatch('ended');
  }
}

class FakeRaf implements RafLike {
  queue: ((t: number) => void)[] = [];
  id = 0;
  request(cb: (t: number) => void): number {
    this.queue.push(cb);
    return ++this.id;
  }
  cancel(): void {
    this.queue = [];
  }
  tick(t = 16): void {
    const q = this.queue.splice(0);
    for (const cb of q) cb(t);
  }
}

class FakeDoc implements DocLike {
  hidden = false;
  private listeners = new Map<string, Set<Fn>>();
  addEventListener(type: string, fn: Fn): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Fn): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn();
  }
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
}

function okJson(data: unknown): FakeResponse {
  const text = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => JSON.parse(text) as unknown,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
    blob: async () => new Blob([text]),
  };
}

function okBytes(n: number): FakeResponse {
  const bytes = new Uint8Array(n).fill(7);
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-length' ? String(n) : null) },
    json: async () => {
      throw new Error('not json');
    },
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
    blob: async () => new Blob([bytes]),
  };
}

const notFound = (): FakeResponse => ({
  ok: false,
  status: 404,
  headers: { get: () => null },
  json: async () => ({}),
  arrayBuffer: async () => new ArrayBuffer(0),
  blob: async () => new Blob([]),
});

class FakeCache implements CacheLike {
  store = new Map<string, Response>();
  puts = 0;
  async match(url: string): Promise<Response | undefined> {
    return this.store.get(url);
  }
  async put(url: string, res: Response): Promise<void> {
    this.puts++;
    this.store.set(url, res);
  }
  async delete(url: string): Promise<boolean> {
    return this.store.delete(url);
  }
  async keys(): Promise<{ url: string }[]> {
    return Array.from(this.store.keys(), (url) => ({ url }));
  }
}

class FakeCaches {
  opened: string[] = [];
  cache = new FakeCache();
  async open(name: string): Promise<CacheLike> {
    this.opened.push(name);
    return this.cache;
  }
}

class FakeUrls {
  created: Blob[] = [];
  revoked: string[] = [];
  create(blob: Blob): string {
    this.created.push(blob);
    return `blob:fake/${this.created.length}`;
  }
  revoke(url: string): void {
    this.revoked.push(url);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fixture pack                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const BASE = 'https://dojo.test/app/';
const V = 'a-0123456789';
const HANA = 'VOICEVOX:九州そら';
const KEN = 'VOICEVOX:玄野武宏';
/** `byText` key: hex8 of fnv1a32 over the spoken text (AUDIO_PACK §3.1). */
const h = (s: string): string => fnv1a32(s).toString(16).padStart(8, '0');
/** Paths as the pack writes them: relative to `public/audio/` (AUDIO_PACK §1). */
const REL = {
  story: 'sprites/s04/s-04-1-aaaaaaaa.webm',
  words: 'sprites/s04/words-01-bbbbbbbb.webm',
  examples: 'sprites/s04/examples-01-cccccccc.webm',
  misc: 'sprites/s04/misc-01-ffffffff.webm',
  kana: 'sprites/kana/row-a-dddddddd.webm',
  green: 'sprites/s16/s-16-1-eeeeeeee.webm',
};
/** The same paths as the runtime normalises them (`ClipCue.file`, cache keys under `./audio/`). */
const FILES = Object.fromEntries(Object.entries(REL).map(([k, p]) => [k, `audio/${p}`])) as Record<keyof typeof REL, string>;
const BYTES: Record<string, number> = { [FILES.story]: 1000, [FILES.words]: 1000, [FILES.examples]: 1000, [FILES.misc]: 1000, [FILES.kana]: 400, [FILES.green]: 2000 };
const INDEX_FILES = ['n5/words.json', 'n5/sentences.json', 's04/stories.json', 'kana/tracks.json'];

const MANIFEST = {
  schema: 'tsuzuku.audio/1',
  audioVersion: V,
  contentVersion: 'c-eda59d9655',
  engine: 'VOICEVOX 0.25.2',
  dictVersion: 'd-1',
  castSha: 'b7e4',
  tiers: ['core'],
  generatedAt: '2026-10-17T22:10:00.000Z',
  dryRun: false,
  voices: {
    ハナ: { character: '九州そら', style: 'ノーマル', styleId: 16, credit: HANA },
    ケン: { character: '玄野武宏', style: 'ノーマル', styleId: 11, credit: KEN },
  },
  belts: { white: { bytes: 400, seconds: 12, files: 1 }, yellow: { bytes: 4000, seconds: 40, files: 4 }, green: { bytes: 2000, seconds: 20, files: 1 } },
  files: Object.entries(REL).map(([, path]) => ({
    path,
    bytes: BYTES[`audio/${path}`]!,
    sha256: 'x'.repeat(64),
    seconds: 10,
    clips: 3,
    belt: beltOfPath(path),
    station: /s(\d{2})\//.exec(path) ? Number(/s(\d{2})\//.exec(path)![1]) : 1,
    tier: 'core',
  })),
  indexes: INDEX_FILES.map((p) => ({ path: `${V}/${p}`, bytes: 100, sha256: 'y'.repeat(64) })),
  totals: { bytes: 6400, seconds: 72, files: 6, clips: 40 },
  render: { rendered: 40, cached: 0, skipped: 0, reused: 0 },
  changedClipShare: 1,
  skipped: 0,
  credits: [HANA, KEN],
  reusedBytesShare: null,
  somethingNew: { ignored: true },
};

const WORDS_N5 = {
  schema: 'tsuzuku.audio-index/1',
  audioVersion: V,
  scope: 'n5',
  kind: 'words',
  files: [REL.words],
  voices: [HANA],
  cues: {
    'v-n5-0001': [{ f: 0, s: 0.3, e: 1.1, v: 0, r: 1, k: '5c3a9e01', pv: true, extra: 1 }],
    'v-n5-0001#ga': [{ f: 0, s: 1.4, e: 2.6, v: 0, r: 1, k: '5c3a9e01' }],
    'v-n5-0002': [{ f: 0, s: 3.0, e: 3.9, v: 0, r: 1, k: '00000002' }],
    'v-n5-0003': [{ f: 7, s: 4, e: 5, v: 0, r: 1, k: '00000003' }], // file index outside the table: dropped
    'j-日#ex0': [{ f: 0, s: 5.0, e: 5.8, v: 0, r: 1, k: '00000004' }],
  },
};

/** The kana level's word index: the lone kana (`k-*`) the drills' Listen button plays. */
const WORDS_KANA = {
  schema: 'tsuzuku.audio-index/1',
  audioVersion: V,
  scope: 'kana',
  kind: 'words',
  files: [REL.kana],
  voices: [HANA],
  cues: {
    'k-h-a': [{ f: 0, s: 0.3, e: 0.8, v: 0, r: 1, k: '0000000a' }],
    'k-h-a#ex0': [{ f: 0, s: 1.0, e: 1.9, v: 0, r: 1, k: '0000000b' }],
  },
};

const EX_MORAE = [150, 300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650, 1800];
const SENTENCES_N5 = {
  schema: 'tsuzuku.audio-index/1',
  audioVersion: V,
  scope: 'n5',
  kind: 'sentences',
  files: [REL.examples],
  voices: [HANA, KEN],
  cues: {
    'v-n5-0001#ex1': [
      { f: 0, s: 0.3, e: 3.0, v: 0, r: 1, k: 'aaaa0001', m: EX_MORAE, c: [3, 9, 12] },
      { f: 0, s: 3.6, e: 6.8, v: 0, r: 0.85, k: 'aaaa0001' },
    ],
    'g-n5-001#ex1': [
      { f: 0, s: 7.0, e: 9.0, v: 0, r: 1, k: 'aaaa0002' },
      { f: 0, s: 9.3, e: 11.3, v: 1, r: 1, k: 'aaaa0002' },
    ],
  },
  byText: {
    [h('私はコーヒーを飲みます。')]: 'v-n5-0001#ex1',
    '今日はいい天気ですね。': 'g-n5-001#ex1', // a plain-text key is tolerated (hashed on the way in)
    [h('コーヒー')]: 'v-n5-0001', // a word in byText: never served
    [h('v-n5-0001')]: 'v-n5-0002', // an id in byText: never served by cueFor
  },
};

const STORIES_04 = {
  schema: 'tsuzuku.audio-index/1',
  audioVersion: V,
  scope: 's04',
  kind: 'stories',
  files: [REL.story, REL.misc],
  voices: [HANA, KEN],
  texts: {
    's-04-1': {
      f: 0,
      whole: { s: 0, e: 10 },
      lines: [
        [
          { s: 0.3, e: 2.4, v: 1, r: 1, k: 'bbbb0001', m: [200, 400, 600, 800, 1000, 1200, 1400], c: [4, 7] },
          { s: 10.3, e: 13.0, v: 1, r: 0.85, k: 'bbbb0001', m: [240, 480, 720, 960, 1200, 1440, 1680], c: [4, 7] },
        ],
        [{ s: 3.0, e: 6.0, v: 0, r: 1, k: 'bbbb0002', m: [300, 600, 900, 1200, 1500], c: [5] }],
      ],
    },
  },
  misc: { 'm-04-1': [{ f: 1, s: 0.3, e: 1.1, v: 0, r: 1, k: 'cccc0001' }] },
  byText: { [h('おはよう、ハナ。')]: 's-04-1#L0', [h('おはよう、ケン。元気？')]: 's-04-1#L1' },
};

const TRACKS = {
  schema: 'tsuzuku.audio-index/1',
  audioVersion: V,
  kind: 'tracks',
  tracks: [
    {
      key: 'track:row-a',
      title: 'あ行',
      titleEn: 'The a row',
      file: REL.kana,
      start: 0,
      end: 12,
      voice: HANA,
      rate: 1,
      segments: [
        { s: 0.28, e: 1.02, text: 'あ' },
        { s: 1.32, e: 2.05, text: 'い', en: 'i' },
      ],
    },
  ],
};

/** The verbose spelling a hand-written fixture pack may use (tolerated beside the compact one). */
const VERBOSE_STORIES = {
  's-04-2': {
    file: FILES.story,
    title: '朝のコーヒー',
    titleEn: 'Morning coffee',
    whole: { start: 20, end: 30 },
    lines: [
      { start: 20.3, end: 22.4, voice: KEN, morae: [200, 400, 600], clauses: [3], slow: { start: 30.3, end: 33.0 } },
      { start: 23.0, end: 26.0, voice: HANA },
    ],
  },
  byText: { 'おはよう、ハナ。': 's-04-2#L0', 'おはよう、ケン。元気？': ['s-04-2#L1'] },
};

type PackFiles = Record<string, unknown>;

function packFiles(): PackFiles {
  return {
    'audio/manifest.json': MANIFEST,
    [`audio/${V}/n5/words.json`]: WORDS_N5,
    [`audio/${V}/n5/sentences.json`]: SENTENCES_N5,
    [`audio/${V}/s04/stories.json`]: STORIES_04,
    [`audio/${V}/kana/tracks.json`]: TRACKS,
    ...Object.fromEntries(Object.keys(BYTES).map((p) => [p, BYTES[p]])),
  };
}

/** The pack without its `indexes` list: the runtime then tries every index file and takes the 404s. */
function packFilesUnlisted(): PackFiles {
  const files = packFiles();
  const { indexes: _indexes, ...manifest } = MANIFEST;
  files['audio/manifest.json'] = manifest;
  return files;
}

interface Harness {
  player: ClipPlayerEx;
  fetch: ReturnType<typeof vi.fn>;
  calls: string[];
  caches: FakeCaches;
  raf: FakeRaf;
  urls: FakeUrls;
  doc: FakeDoc;
}

function make(o: { files?: PackFiles; fail?: boolean; canPlay?: string; options?: Partial<ClipPlayerOptions> } = {}): Harness {
  const files = o.files ?? packFiles();
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(url);
    if (o.fail) throw new TypeError('offline');
    const rel = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const v = files[rel];
    if (v === undefined) return notFound() as unknown as Response;
    if (typeof v === 'number') return okBytes(v) as unknown as Response;
    return okJson(v) as unknown as Response;
  });
  const caches = new FakeCaches();
  const raf = new FakeRaf();
  const urls = new FakeUrls();
  const doc = new FakeDoc();
  const player = createClipPlayer({
    fetch,
    audioCtor: FakeAudio,
    caches,
    raf,
    urls,
    doc,
    base: BASE,
    now: () => Date.now(),
    canPlay: () => o.canPlay ?? 'probably',
    ...o.options,
  });
  return { player, fetch, calls, caches, raf, urls, doc };
}

const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

async function readyPlayer(o: Parameters<typeof make>[0] = {}): Promise<Harness> {
  const h = make(o);
  await settle();
  expect(h.player.ready.value).toBe('ready');
  return h;
}

/** A plain cue inside the examples sprite. */
const cue = (over: Partial<ClipCue> = {}): ClipCue => ({ key: 'v-n5-0001#ex1', file: FILES.examples, start: 0.3, end: 3.0, voice: HANA, rate: 1, ...over });

const lastAudio = (): FakeAudio => FakeAudio.all[FakeAudio.all.length - 1]!;

/** The pool element that currently holds `file`. */
const slotEl = (file: string, urls: FakeUrls): FakeAudio => {
  const idx = urls.created.length; // the newest blob URL is `blob:fake/<n>`
  const el = FakeAudio.all.find((a) => a.src === `blob:fake/${idx}`);
  if (!el) throw new Error(`no element holds ${file}`);
  return el;
};

let players: ClipPlayerEx[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  FakeAudio.created = 0;
  FakeAudio.all = [];
  FakeAudio.refuseNext = false;
});
afterEach(() => {
  for (const p of players) p.dispose();
  players = [];
  vi.useRealTimers();
});

const track = (h: Harness): Harness => {
  players.push(h.player);
  return h;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe('pure helpers', () => {
  it('spritePath completes bare station / kana paths and leaves audio/ paths alone', () => {
    expect(spritePath('audio/sprites/s04/x.webm')).toBe('audio/sprites/s04/x.webm');
    expect(spritePath('sprites/s04/x.webm')).toBe('audio/sprites/s04/x.webm');
    expect(spritePath('s04/x.webm')).toBe('audio/sprites/s04/x.webm');
    expect(spritePath('./kana/row-a.webm')).toBe('audio/sprites/kana/row-a.webm');
  });

  it('beltOfPath reads the station segment, kana → white, an explicit belt wins', () => {
    expect(beltOfPath(FILES.story)).toBe('yellow');
    expect(beltOfPath(FILES.green)).toBe('green');
    expect(beltOfPath(FILES.kana)).toBe('white');
    expect(beltOfPath(FILES.story, 'black')).toBe('black');
    expect(beltOfPath('audio/sprites/misc.webm')).toBeUndefined();
  });

  it('nearestRate picks the native rate closest to the request (ties → the faster take)', () => {
    const v = [{ rate: 1 }, { rate: 0.85 }];
    expect(nearestRate(v, 0.75)?.rate).toBe(0.85);
    expect(nearestRate(v, 0.9)?.rate).toBe(0.85);
    expect(nearestRate(v, 0.925)?.rate).toBe(1);
    expect(nearestRate(v, 1.25)?.rate).toBe(1);
    expect(nearestRate([], 1)).toBeUndefined();
  });

  it('isSentenceText refuses bare words (no sentence punctuation, ≤ 8 chars)', () => {
    expect(isSentenceText('私はコーヒーを飲みます。')).toBe(true);
    expect(isSentenceText('はい。')).toBe(true);
    expect(isSentenceText('コーヒー')).toBe(false);
    expect(isSentenceText('おはよう')).toBe(false);
    expect(isSentenceText('あいうえおかきくけこ')).toBe(true);
    expect(isSentenceText('')).toBe(false);
  });

  it('clauseRange converts a mora span into sprite seconds; falls back to the whole cue', () => {
    const c = cue({ morae: EX_MORAE, clauses: [3, 9] });
    expect(clauseRange(c, [3, 9])).toEqual([0.3 + 0.45, 0.3 + 1.35]);
    expect(clauseRange(c, [0, 3])).toEqual([0.3, 0.3 + 0.45]);
    expect(clauseRange(c, [9, 12])).toEqual([0.3 + 1.35, 0.3 + 1.8]);
    expect(clauseRange(c, [9, 99])[1]).toBeCloseTo(0.3 + 1.8, 9);
    expect(clauseRange(c)).toEqual([0.3, 3.0]);
    expect(clauseRange(cue(), [0, 3])).toEqual([0.3, 3.0]);
    expect(clauseRange(c, [5, 5])).toEqual([0.3, 3.0]);
  });

  it('karaokeAt reports the sounding mora and its clause', () => {
    const c = cue({ morae: EX_MORAE, clauses: [3, 9] });
    expect(karaokeAt(c, 0)).toEqual({ mora: 0, clause: 0 });
    expect(karaokeAt(c, 0.2)).toEqual({ mora: 1, clause: 0 });
    expect(karaokeAt(c, 0.5)).toEqual({ mora: 3, clause: 1 });
    expect(karaokeAt(c, 1.4)).toEqual({ mora: 9, clause: 2 });
    expect(karaokeAt(c, 9)).toEqual({ mora: 11, clause: 2 });
    expect(karaokeAt(cue(), 1)).toEqual({ mora: 0, clause: 0 });
  });

  it('parseManifest (AUDIO_PACK §4) is tolerant: unknown fields ignored, paths normalised, credits / belts / indexes read, malformed → null', () => {
    const m = parseManifest(MANIFEST)!;
    expect(m.info.audioVersion).toBe(V);
    expect(m.info.contentVersion).toBe('c-eda59d9655');
    expect(m.info.credits).toEqual([HANA, KEN]);
    expect(m.info.belts.yellow).toEqual({ bytes: 4000, seconds: 40, files: 4 });
    expect(m.info.totals).toEqual({ bytes: 6400, seconds: 72, files: 6 });
    expect(m.paths.has(FILES.story)).toBe(true); // `sprites/...` → `audio/sprites/...`
    expect(m.files.find((f) => f.path === FILES.green)?.belt).toBe('green');
    expect(m.bytesByPath.get(FILES.kana)).toBe(400);
    expect(m.speakerVoice.get('ハナ')).toBe(HANA);
    expect(m.indexPaths).toEqual(new Set(INDEX_FILES.map((p) => `audio/${V}/${p}`)));
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ schema: 'other/1', audioVersion: V })).toBeNull();
    expect(parseManifest({ schema: 'tsuzuku.audio/1' })).toBeNull();
    // belts and credits derived when absent; no `indexes` → an empty set (fetch and see)
    const derived = parseManifest({ schema: 'tsuzuku.audio/1', audioVersion: V, files: MANIFEST.files, voices: MANIFEST.voices })!;
    expect(derived.info.belts.yellow?.files).toBe(4);
    expect(derived.info.belts.white?.bytes).toBe(400);
    expect(derived.info.credits).toEqual([HANA, KEN]);
    expect(derived.info.totals.bytes).toBe(6400);
    expect(derived.indexPaths.size).toBe(0);
  });

  it('parseIndex reads the compact CueIndex (AUDIO_PACK §3.1): files / voices tables, rate variants, pv, m / c, hashed byText', () => {
    const w = parseIndex(WORDS_N5);
    expect(w.cues.get('v-n5-0001')?.[0]).toEqual({ key: 'v-n5-0001', file: FILES.words, start: 0.3, end: 1.1, voice: HANA, rate: 1, pitchVerified: true });
    expect(w.cues.get('j-日#ex0')?.[0]?.start).toBe(5);
    expect(w.cues.has('v-n5-0003')).toBe(false);
    expect(w.cues.has('schema')).toBe(false);
    expect(w.cues.has('files')).toBe(false);
    const s = parseIndex(SENTENCES_N5);
    expect(s.cues.get('v-n5-0001#ex1')?.map((c) => c.rate)).toEqual([1, 0.85]);
    expect(s.cues.get('v-n5-0001#ex1')?.[0]?.morae).toEqual(EX_MORAE);
    expect(s.cues.get('v-n5-0001#ex1')?.[0]?.clauses).toEqual([3, 9, 12]);
    expect(s.cues.get('g-n5-001#ex1')?.map((c) => c.voice)).toEqual([HANA, KEN]);
    expect(s.byText.get(h('私はコーヒーを飲みます。'))).toEqual(['v-n5-0001#ex1']);
    expect(s.byText.get(h('今日はいい天気ですね。'))).toEqual(['g-n5-001#ex1']); // plain-text key hashed on the way in
    expect(byTextKey('私はコーヒーを飲みます。')).toBe(h('私はコーヒーを飲みます。'));
    expect(byTextKey('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('parseIndex reads the StoriesIndex (§3.2): texts with whole + lines[i][] inheriting the text file, misc, hashed byText', () => {
    const st = parseIndex(STORIES_04);
    expect(st.cues.get('s-04-1#L0')?.map((c) => c.rate)).toEqual([1, 0.85]);
    expect(st.cues.get('s-04-1#L0')?.[0]).toEqual({ key: 's-04-1#L0', file: FILES.story, start: 0.3, end: 2.4, voice: KEN, rate: 1, morae: [200, 400, 600, 800, 1000, 1200, 1400], clauses: [4, 7] });
    expect(st.cues.get('s-04-1#L0')?.[1]).toMatchObject({ file: FILES.story, start: 10.3, end: 13.0, voice: KEN, rate: 0.85 });
    expect(st.cues.get('s-04-1#L1')?.[0]).toMatchObject({ file: FILES.story, voice: HANA, morae: [300, 600, 900, 1200, 1500], clauses: [5] });
    expect(st.cues.get('s-04-1')?.[0]).toEqual({ key: 's-04-1', file: FILES.story, start: 0, end: 10, voice: KEN, rate: 1, title: 's-04-1' });
    expect(st.cues.get('m-04-1')?.[0]).toEqual({ key: 'm-04-1', file: FILES.misc, start: 0.3, end: 1.1, voice: HANA, rate: 1 });
    expect(st.byText.get(h('おはよう、ケン。元気？'))).toEqual(['s-04-1#L1']);
    expect(st.tracks).toEqual([]);
  });

  it('parseIndex reads the TracksIndex (§3.3): full TrackCue rows with segments; a bare track list and a bare cue map are accepted too', () => {
    const t = parseIndex(TRACKS);
    expect(t.tracks).toHaveLength(1);
    expect(t.tracks[0]).toMatchObject({ key: 'track:row-a', title: 'あ行', titleEn: 'The a row', file: FILES.kana, start: 0, end: 12, voice: HANA, rate: 1 });
    expect(t.tracks[0]?.segments).toEqual([
      { s: 0.28, e: 1.02, text: 'あ' },
      { s: 1.32, e: 2.05, text: 'い', en: 'i' },
    ]);
    expect(t.cues.get('track:row-a')?.[0]?.file).toBe(FILES.kana);
    expect(parseIndex([{ name: 'row-ka', file: REL.kana, start: 0, end: 1 }]).tracks[0]?.key).toBe('track:row-ka');
    expect(parseIndex({ 'k-h-a': { file: 'kana/x.webm', start: 0, end: 1, voice: HANA, rate: 1 } }).cues.get('k-h-a')?.[0]?.file).toBe('audio/sprites/kana/x.webm');
    expect(parseIndex(null).cues.size).toBe(0);
    expect(parseIndex('nonsense').cues.size).toBe(0);
    expect(parseIndex({ schema: 'tsuzuku.audio-index/1', cues: {} }).cues.size).toBe(0);
  });

  it('parseIndex tolerates the verbose spelling (file / start / end / voice / rate / morae / clauses, slow, title, plain byText)', () => {
    const st = parseIndex(VERBOSE_STORIES);
    expect(st.cues.get('s-04-2#L0')?.map((c) => c.rate)).toEqual([1, 0.85]);
    expect(st.cues.get('s-04-2#L0')?.[0]).toMatchObject({ file: FILES.story, start: 20.3, end: 22.4, voice: KEN, morae: [200, 400, 600], clauses: [3] });
    expect(st.cues.get('s-04-2#L0')?.[1]).toMatchObject({ start: 30.3, end: 33.0, voice: KEN, rate: 0.85 });
    expect(st.cues.get('s-04-2')?.[0]).toMatchObject({ start: 20, end: 30, title: '朝のコーヒー', titleEn: 'Morning coffee' });
    expect(st.byText.get(h('おはよう、ケン。元気？'))).toEqual(['s-04-2#L1']);
  });

  it("parseIndex honours `whole: null` (§3.2: a line was skipped → no Radio track) and a skipped line `[]`; an absent `whole` is never synthesised from the lines' min / max", () => {
    const skipped = {
      ...STORIES_04,
      texts: {
        's-04-2': { f: 0, whole: null, lines: [[{ s: 20.3, e: 22.4, v: 0, r: 1, m: [200, 400, 600], c: [3] }], []] },
        's-04-3': { f: 0, lines: [[{ s: 30.3, e: 32.4, v: 0, r: 1 }], [{ s: 33.0, e: 35.0, v: 1, r: 1 }]] },
      },
      byText: {},
    };
    const st = parseIndex(skipped);
    expect(st.cues.get('s-04-2')).toBeUndefined(); // explicit null: no whole track, never [20.3, 22.4]
    expect(st.cues.get('s-04-2#L0')?.[0]).toMatchObject({ file: FILES.story, start: 20.3, end: 22.4, voice: HANA, morae: [200, 400, 600], clauses: [3] });
    expect(st.cues.get('s-04-2#L1')).toBeUndefined(); // the skipped line: the device voice covers it
    expect(st.cues.get('s-04-3')).toBeUndefined(); // absent whole: no min / max synthesis either
    expect(st.cues.get('s-04-3#L1')?.[0]?.voice).toBe(KEN);
    expect(Array.from(st.cues.keys()).sort()).toEqual(['m-04-1', 's-04-2#L0', 's-04-3#L0', 's-04-3#L1']);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Readiness                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('ready', () => {
  it("'unknown' → 'loading' → 'ready' on a good manifest; info is the parsed summary", async () => {
    const h = track(make());
    expect(['unknown', 'loading']).toContain(h.player.ready.value);
    await settle();
    expect(h.player.ready.value).toBe('ready');
    expect(h.player.info.value).toMatchObject({ audioVersion: V, contentVersion: 'c-eda59d9655', engine: 'VOICEVOX 0.25.2', credits: [HANA, KEN] });
    expect(h.player.info.value?.belts.yellow).toEqual({ bytes: 4000, seconds: 40, files: 4 });
    expect(h.calls).toEqual([`${BASE}audio/manifest.json`]);
    expect(h.player.rootUrl()).toBe(BASE);
  });

  it("'absent' on a 404 manifest, and nothing else is fetched", async () => {
    const h = track(make({ files: {} }));
    await settle();
    expect(h.player.ready.value).toBe('absent');
    expect(h.player.info.value).toBeNull();
    await h.player.loadLevel('n5');
    await h.player.loadStation(4);
    expect(await h.player.kanaTracks()).toEqual([]);
    expect(h.calls).toHaveLength(1);
    expect(h.player.cueFor('v-n5-0001')).toBeUndefined();
  });

  it("'absent' when canPlayType('audio/webm; codecs=\"opus\"') is '' — before any fetch", async () => {
    const h = track(make({ canPlay: '' }));
    await settle();
    expect(h.player.ready.value).toBe('absent');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('the default probe asks the element: a fake whose canPlayType is empty makes the pack absent', async () => {
    class NoOpus extends FakeAudio {
      override canPlayType(): string {
        return '';
      }
    }
    const h = track(make({ options: { canPlay: undefined, audioCtor: NoOpus } }));
    await settle();
    expect(h.player.ready.value).toBe('absent');
    const probe = vi.fn(() => 'maybe');
    const h2 = track(make({ options: { canPlay: probe } }));
    await settle();
    expect(probe).toHaveBeenCalledWith(OPUS_PROBE_TYPE);
    expect(h2.player.ready.value).toBe('ready');
  });

  it("'absent' on a malformed manifest, a non-JSON body or a fetch that throws — never a throw on the boot path", async () => {
    const bad = track(make({ files: { 'audio/manifest.json': { schema: 'tsuzuku.audio/1' } } }));
    const other = track(make({ files: { 'audio/manifest.json': { hello: 'world' } } }));
    const text = track(make({ files: { 'audio/manifest.json': 1234 } })); // served as bytes → json() throws
    const offline = track(make({ fail: true }));
    await settle();
    expect(bad.player.ready.value).toBe('absent');
    expect(other.player.ready.value).toBe('absent');
    expect(text.player.ready.value).toBe('absent');
    expect(offline.player.ready.value).toBe('absent');
  });

  it("'absent' without fetch or Audio at all", async () => {
    const a = createClipPlayer({ fetch: undefined, audioCtor: null, caches: null, raf: null, urls: null, doc: null, base: BASE });
    players.push(a);
    await settle();
    expect(a.ready.value).toBe('absent');
    expect(await a.cacheUsage()).toEqual({ bytes: 0, files: 0 });
    const r = await a.play(cue(), { rate: 1, volume: 1 }).done;
    expect(r).toEqual({ source: 'none', seconds: 0 });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Indexes and cues                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

describe('indexes and cueFor / cueForText', () => {
  it('loadLevel fetches the index files the manifest lists (words / sentences here, no ear.json round trip) and dedupes', async () => {
    const hz = track(await readyPlayer());
    await hz.player.loadLevel('n5');
    expect(hz.calls.filter((u) => u.includes(`/${V}/n5/`))).toEqual([`${BASE}audio/${V}/n5/words.json`, `${BASE}audio/${V}/n5/sentences.json`]);
    expect(hz.player.cueFor('v-n5-0001')).toMatchObject({ file: FILES.words, start: 0.3, end: 1.1, pitchVerified: true });
    expect(hz.player.cueFor('v-n5-0001#ga')?.start).toBe(1.4);
    expect(hz.player.cueFor('j-日#ex0')?.file).toBe(FILES.words);
    expect(hz.player.indexedKeys()).toBe(6);
    // a second load is deduped
    await hz.player.loadLevel('n5');
    expect(hz.calls.filter((u) => u.includes('/words.json'))).toHaveLength(1);
  });

  it('without a manifest `indexes` list every index file is tried; a missing ear.json leaves the level loaded', async () => {
    const hz = track(await readyPlayer({ files: packFilesUnlisted() }));
    await hz.player.loadLevel('n5');
    expect(hz.calls.filter((u) => u.includes(`/${V}/n5/`))).toEqual([`${BASE}audio/${V}/n5/words.json`, `${BASE}audio/${V}/n5/sentences.json`, `${BASE}audio/${V}/n5/ear.json`]);
    expect(hz.player.cueFor('v-n5-0001')).toBeDefined();
    expect(hz.player.cueFor('v-n5-0001#ex1')).toBeDefined();
    await hz.player.loadLevel('n4'); // nothing for n4 in this pack: three 404s, no throw
    expect(hz.player.indexedKeys()).toBe(6);
  });

  it('cueFor picks the cue whose native rate is nearest the requested rate', async () => {
    const h = track(await readyPlayer());
    await h.player.loadLevel('n5');
    expect(h.player.cueFor('v-n5-0001#ex1', { rate: 0.75 })?.rate).toBe(0.85);
    expect(h.player.cueFor('v-n5-0001#ex1', { rate: 0.9 })?.rate).toBe(0.85);
    expect(h.player.cueFor('v-n5-0001#ex1', { rate: 1 })?.rate).toBe(1);
    expect(h.player.cueFor('v-n5-0001#ex1', { rate: 1.5 })?.rate).toBe(1);
    expect(h.player.cueFor('v-n5-0001#ex1')?.rate).toBe(1);
    expect(h.player.cueFor('v-n5-0001#ex1', { rate: 1 })?.morae).toEqual(EX_MORAE);
  });

  it('a cueFor miss kicks off the level / station load in the background so the next call hits', async () => {
    const h = track(await readyPlayer());
    expect(h.player.cueFor('v-n5-0001')).toBeUndefined();
    await settle();
    expect(h.calls.some((u) => u.endsWith(`/${V}/n5/words.json`))).toBe(true);
    expect(h.player.cueFor('v-n5-0001')).toBeDefined();
    expect(h.player.cueFor('s-04-1#L1')).toBeUndefined();
    await settle();
    expect(h.calls.some((u) => u.endsWith(`/${V}/s04/stories.json`))).toBe(true);
    expect(h.player.cueFor('s-04-1#L1')?.voice).toBe(HANA);
    expect(h.player.cueFor('m-04-1')?.file).toBe(FILES.misc);
    expect(h.player.cueFor('track:row-a')).toBeUndefined();
    await settle();
    expect(h.player.cueFor('track:row-a')).toMatchObject({ file: FILES.kana });
    // an unknown key shape loads nothing further
    const n = h.calls.length;
    expect(h.player.cueFor('nope')).toBeUndefined();
    await settle();
    expect(h.calls.length).toBe(n);
  });

  it("cueFor('v-n5-0001') never resolves through byText", async () => {
    const files = packFiles();
    delete files[`audio/${V}/n5/words.json`]; // only sentences.json, whose byText maps 'v-n5-0001' → 'v-n5-0002'
    const h = track(await readyPlayer({ files }));
    await h.player.loadLevel('n5');
    expect(h.player.cueFor('v-n5-0001')).toBeUndefined();
    expect(h.player.cueFor('v-n5-0002')).toBeUndefined();
    // with words.json present, the key resolves to its own cue, not byText's target
    const h2 = track(await readyPlayer());
    await h2.player.loadLevel('n5');
    expect(h2.player.cueFor('v-n5-0001')?.start).toBe(0.3);
    expect(h2.player.cueFor('v-n5-0001')?.key).toBe('v-n5-0001');
  });

  it('cueForText serves sentences only — ruby and whitespace tolerant — and refuses bare words even when byText lists them', async () => {
    const h = track(await readyPlayer());
    await h.player.loadLevel('n5');
    expect(h.player.cueForText('私はコーヒーを飲みます。')?.key).toBe('v-n5-0001#ex1');
    expect(h.player.cueForText('{私|わたし}は コーヒーを{飲|の}みます。')?.key).toBe('v-n5-0001#ex1');
    expect(h.player.cueForText('私はコーヒーを飲みます。', { rate: 0.75 })?.rate).toBe(0.85);
    expect(h.player.cueForText('コーヒー')).toBeUndefined();
    expect(h.player.cueForText('知らない文です。')).toBeUndefined();
    expect(h.player.cueForText('')).toBeUndefined();
  });

  it('speaker → cast voice: a speaker picks the variant in that voice; an unknown speaker falls back to the nearest rate', async () => {
    const h = track(await readyPlayer());
    await h.player.loadLevel('n5');
    expect(h.player.cueFor('g-n5-001#ex1', { speaker: 'ケン' })?.voice).toBe(KEN);
    expect(h.player.cueFor('g-n5-001#ex1', { speaker: 'ハナ' })?.voice).toBe(HANA);
    expect(h.player.cueFor('g-n5-001#ex1', { speaker: '森さん' })?.voice).toBe(HANA);
    expect(h.player.cueForText('今日はいい天気ですね。', { speaker: 'ケン' })?.voice).toBe(KEN);
    expect(h.player.cueForText('今日はいい天気ですね。', { speaker: 'ハナ' })?.voice).toBe(HANA);
  });

  it('loadStation loads sNN/stories.json (lines, whole track, misc) and the station level; kanaTracks lists the kana tracks once', async () => {
    const hz = track(await readyPlayer());
    await hz.player.loadStation(4);
    expect(hz.player.cueFor('s-04-1#L0')).toMatchObject({ file: FILES.story, start: 0.3, end: 2.4, voice: KEN, clauses: [4, 7] });
    expect(hz.player.cueFor('s-04-1#L0', { rate: 0.75 })).toMatchObject({ start: 10.3, rate: 0.85 });
    expect(hz.player.cueFor('s-04-1')).toMatchObject({ start: 0, end: 10, title: 's-04-1', voice: KEN });
    expect(hz.player.cueFor('m-04-1')).toMatchObject({ file: FILES.misc, start: 0.3, end: 1.1 });
    expect(hz.player.cueFor('v-n5-0001')).toBeDefined();
    expect(hz.player.cueForText('おはよう、ハナ。')?.key).toBe('s-04-1#L0');
    expect(hz.player.cueForText('おはよう、ケン。元気？')?.key).toBe('s-04-1#L1');
    const tracks = await hz.player.kanaTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ key: 'track:row-a', title: 'あ行', titleEn: 'The a row', file: FILES.kana });
    expect(tracks[0]?.segments).toHaveLength(2);
    await hz.player.kanaTracks();
    expect(hz.calls.filter((u) => u.endsWith('/kana/tracks.json'))).toHaveLength(1);
    // a station with no stories.json misses quietly
    await expect(hz.player.loadStation(9)).resolves.toBeUndefined();
    expect(hz.player.cueFor('s-09-1#L0')).toBeUndefined();
  });

  it('loadStation past the white belt also loads the kana index (the kana cards outlive the kana stations): the first kana cue after boot hits', async () => {
    const files = packFiles();
    files[`audio/${V}/kana/words.json`] = WORDS_KANA;
    const manifest = { ...MANIFEST, indexes: [...MANIFEST.indexes, { path: `${V}/kana/words.json`, bytes: 100, sha256: 'y'.repeat(64) }] };
    files['audio/manifest.json'] = manifest;
    const hz = track(await readyPlayer({ files }));
    await hz.player.loadStation(4); // yellow belt: level n5, and the kana level beside it
    expect(hz.player.cueFor('k-h-a')).toMatchObject({ file: FILES.kana, start: 0.3, end: 0.8 });
    expect(hz.player.cueFor('v-n5-0001')).toBeDefined();
    expect(hz.calls.filter((u) => u.endsWith(`/${V}/kana/words.json`))).toHaveLength(1);
    // a white-belt station loads the kana level as its own level: still one fetch
    await hz.player.loadStation(1);
    expect(hz.calls.filter((u) => u.endsWith(`/${V}/kana/words.json`))).toHaveLength(1);
  });

  it("a text with `whole: null` has no Radio track (cueFor(storyId) undefined) while its present lines play by key; a skipped line [] misses to the device voice", async () => {
    const files = packFiles();
    files[`audio/${V}/s04/stories.json`] = {
      ...STORIES_04,
      texts: { ...STORIES_04.texts, 's-04-2': { f: 0, whole: null, lines: [[{ s: 20.3, e: 22.4, v: 0, r: 1, m: [200, 400, 600], c: [3] }], []] } },
    };
    const hz = track(await readyPlayer({ files }));
    await hz.player.loadStation(4);
    expect(hz.player.cueFor('s-04-1')).toMatchObject({ start: 0, end: 10 }); // the untouched text keeps its track
    expect(hz.player.cueFor('s-04-2')).toBeUndefined();
    expect(hz.player.cueFor('s-04-2', { rate: 0.85 })).toBeUndefined();
    expect(hz.player.cueFor('s-04-2#L0')).toMatchObject({ file: FILES.story, start: 20.3, end: 22.4, voice: HANA });
    expect(hz.player.cueFor('s-04-2#L1')).toBeUndefined();
    expect(hz.player.cueFor('s-04-2#L1', { rate: 0.85, speaker: 'ハナ' })).toBeUndefined();
    // the misses never refetch the station index (the load is memoised)
    await settle();
    expect(hz.calls.filter((u) => u.endsWith('/s04/stories.json'))).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Pool and playback                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

describe('pool and playback', () => {
  it("play() before unlock() resolves { source: 'none', seconds: 0 } at once and constructs no element", async () => {
    const h = track(await readyPlayer());
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    let r: unknown;
    void pb.done.then((x) => {
      r = x;
    });
    await Promise.resolve();
    expect(r).toEqual({ source: 'none', seconds: 0 });
    expect(FakeAudio.created).toBe(0);
    expect(h.player.unlocked()).toBe(false);
    expect(h.fetch).toHaveBeenCalledTimes(1); // manifest only
  });

  it('unlock() builds the fixed pool once: six elements, each played then paused on a silent Opus blob inside the gesture', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    expect(FakeAudio.created).toBe(POOL_SIZE);
    expect(h.urls.created).toHaveLength(1);
    expect(h.urls.created[0]?.type).toBe(OPUS_BLOB_TYPE);
    expect(h.urls.created[0]?.size).toBe(517);
    for (const el of FakeAudio.all) {
      expect(el.src).toBe('blob:fake/1');
      expect(el.plays).toBe(1);
      expect(el.preservesPitch).toBe(true);
      expect(el.webkitPreservesPitch).toBe(true);
    }
    expect(h.player.unlocked()).toBe(false); // built, not yet accepted by the engine
    h.player.unlock(); // a second gesture while pending builds nothing
    expect(FakeAudio.created).toBe(POOL_SIZE);
    await settle();
    for (const el of FakeAudio.all) expect(el.pauses).toBe(1);
    h.player.unlock();
    expect(FakeAudio.created).toBe(POOL_SIZE);
    expect(h.player.unlocked()).toBe(true);
  });

  it("unlock() builds nothing while the pack is absent; a pool built before the manifest 404 arrives is dropped", async () => {
    const h = track(make({ files: {} }));
    await settle();
    expect(h.player.ready.value).toBe('absent');
    h.player.unlock();
    expect(FakeAudio.created).toBe(0);
    expect(h.urls.created).toHaveLength(0);
    expect(h.player.unlocked()).toBe(false);
    // the first gesture lands while the manifest is still loading: the pool is built, then dropped when the pack turns out absent
    const early = track(make({ files: {} }));
    early.player.unlock();
    expect(FakeAudio.created).toBe(POOL_SIZE);
    await settle();
    expect(early.player.ready.value).toBe('absent');
    expect(early.player.unlocked()).toBe(false);
    expect(early.urls.revoked).toContain('blob:fake/1');
    for (const el of FakeAudio.all) expect(el.paused).toBe(true);
    expect(await early.player.play(cue(), { rate: 1, volume: 1 }).done).toEqual({ source: 'none', seconds: 0 });
  });

  it('a pool whose silent play() is refused (NotAllowedError) is dropped and rebuilt on the next unlock(); play() in between resolves none', async () => {
    const h = track(await readyPlayer());
    // the first gesture is not an activation gesture for the engine (a touch's pointerdown on WebKit)
    FakeAudio.refuseNext = true;
    h.player.unlock();
    expect(FakeAudio.created).toBe(POOL_SIZE);
    await settle();
    expect(h.player.unlocked()).toBe(false);
    expect(h.urls.revoked).toContain('blob:fake/1'); // the silent URL
    for (const el of FakeAudio.all) expect(el.paused).toBe(true);
    expect(await h.player.play(cue(), { rate: 1, volume: 1 }).done).toEqual({ source: 'none', seconds: 0 });
    // the next gesture (touchend, the next tap) rebuilds the pool and is accepted
    FakeAudio.refuseNext = false;
    h.player.unlock();
    expect(FakeAudio.created).toBe(2 * POOL_SIZE);
    await settle();
    expect(h.player.unlocked()).toBe(true);
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    await settle();
    expect(slotEl(FILES.examples, h.urls).paused).toBe(false);
    pb.stop();
    expect((await pb.done).source).toBe('clips');
  });

  it("the silent unlock take settling late never pauses a real clip that took its element in the meantime", async () => {
    const h = track(await readyPlayer());
    FakeAudio.deferNext = true; // the engine answers the six silent play() calls only after the gesture returned
    h.player.unlock();
    FakeAudio.deferNext = false;
    expect(FakeAudio.created).toBe(POOL_SIZE);
    // the same gesture speaks: the clip takes a pool element (src swapped, play() pending behind the silent take)
    const pb = h.player.play(cue({ start: 0, end: 10 }), { rate: 1, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.paused).toBe(false);
    const pausesBefore = el.pauses;
    // now the engine starts playing: every pending play() on every element resolves, the silent one included
    for (const e of FakeAudio.all) e.startPlaying();
    await settle();
    expect(h.player.unlocked()).toBe(true);
    expect(el.pauses).toBe(pausesBefore); // the live clip was left alone
    expect(el.paused).toBe(false);
    expect(pb.playing()).toBe(true);
    // the untaken elements were paused as before
    for (const e of FakeAudio.all) if (e !== el) expect(e.paused).toBe(true);
    el.tick(3);
    pb.stop();
    expect((await pb.done).seconds).toBe(3);
  });

  it('two live playbacks of one sprite never share an element: the second re-wraps the held bytes onto a free slot without a fetch; with every slot busy the oldest playback is stopped first', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const a = h.player.play(cue({ start: 0, end: 10 }), { rate: 1, volume: 1 });
    await settle();
    const elA = slotEl(FILES.examples, h.urls);
    const n = h.fetch.mock.calls.length;
    const b = h.player.play(cue({ key: 'v-n5-0002', start: 20, end: 30 }), { rate: 1, volume: 1 });
    await settle();
    expect(h.fetch.mock.calls.length).toBe(n); // the bytes were already in the pool
    const elB = slotEl(FILES.examples, h.urls);
    expect(elB).not.toBe(elA);
    expect(elB.currentTime).toBe(20);
    expect(elA.paused).toBe(false);
    elA.tick(3);
    elB.tick(25);
    a.stop();
    b.stop();
    expect((await a.done).seconds).toBe(3);
    expect((await b.done).seconds).toBe(5);
    // six live playbacks fill the pool; a seventh steals the least recently used element, ending its playback with its seconds
    const many = Array.from({ length: POOL_SIZE }, (_, i) => h.player.play(cue({ key: `c${i}`, start: i, end: i + 1 }), { rate: 1, volume: 1 }));
    await settle();
    expect(FakeAudio.all.filter((el) => !el.paused)).toHaveLength(POOL_SIZE);
    const seventh = h.player.play(cue({ key: 'c7', start: 40, end: 41 }), { rate: 1, volume: 1 });
    await settle();
    expect((await many[0]!.done).source).toBe('clips');
    expect(seventh.playing()).toBe(true);
    expect(FakeAudio.created).toBe(POOL_SIZE);
    seventh.stop();
    for (const p of many) p.stop();
    await Promise.all(many.map((p) => p.done));
  });

  it('after unlock() zero further Audio constructor calls across 20 distinct sprites; the LRU swaps src and revokes blob URLs', async () => {
    const files = packFiles();
    const sprites = Array.from({ length: 20 }, (_, i) => `audio/sprites/s04/s-04-${i}-${String(i).padStart(8, '0')}.webm`);
    for (const s of sprites) files[s] = 100 + 1;
    const h = track(await readyPlayer({ files }));
    h.player.unlock();
    const created = FakeAudio.created;
    for (const [i, file] of sprites.entries()) {
      const pb = h.player.play(cue({ key: `k${i}`, file, start: 0, end: 1 }), { rate: 1, volume: 1 });
      await settle();
      const el = slotEl(file, h.urls);
      expect(el.paused).toBe(false);
      el.end();
      await expect(pb.done).resolves.toEqual({ source: 'clips', seconds: 0 });
    }
    expect(FakeAudio.created).toBe(created);
    expect(FakeAudio.created).toBe(POOL_SIZE);
    // 1 silent + 20 sprite blobs created; the first 14 sprite URLs were revoked when their slot was reused
    expect(h.urls.created).toHaveLength(21);
    for (const b of h.urls.created) expect(b.type).toBe(OPUS_BLOB_TYPE);
    expect(h.urls.revoked).toHaveLength(20 - POOL_SIZE);
    expect(h.urls.revoked[0]).toBe('blob:fake/2');
    // each element saw several sources
    for (const el of FakeAudio.all) expect(el.srcHistory.length).toBeGreaterThan(1);
    // a sprite still held in a slot is replayed without a fetch
    const n = h.fetch.mock.calls.length;
    const again = h.player.play(cue({ key: 'k19', file: sprites[19]!, start: 0, end: 1 }), { rate: 1, volume: 1 });
    await settle();
    expect(h.fetch.mock.calls.length).toBe(n);
    again.stop();
    await again.done;
  });

  it('a fetched sprite is re-wrapped as a Blob of type audio/webm; codecs=opus and never written to the cache by a plain play()', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    await settle();
    expect(h.fetch).toHaveBeenCalledWith(`${BASE}${FILES.examples}`);
    expect(h.urls.created[1]?.type).toBe(OPUS_BLOB_TYPE);
    expect(h.urls.created[1]?.size).toBe(BYTES[FILES.examples]);
    expect(h.caches.cache.puts).toBe(0);
    expect(h.caches.cache.store.size).toBe(0);
    pb.stop();
    await pb.done;
  });

  it('a cached sprite is served from tsuzuku-audio-v1 without a network fetch', async () => {
    const h = track(await readyPlayer());
    await h.caches.cache.put(`${BASE}${FILES.examples}`, okBytes(42) as unknown as Response);
    h.player.unlock();
    const n = h.fetch.mock.calls.length;
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    await settle();
    expect(h.fetch.mock.calls.length).toBe(n);
    expect(h.caches.opened).toContain(AUDIO_CACHE);
    expect(h.urls.created[1]?.size).toBe(42);
    pb.stop();
    await pb.done;
  });

  it('play sets playbackRate = rate / cue.rate with pitch preserved, the volume, and seeks to cue.start', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue({ rate: 0.85 }), { rate: 1.25, volume: 0.6 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.playbackRate).toBeCloseTo(1.25 / 0.85, 9);
    expect(el.preservesPitch).toBe(true);
    expect(el.webkitPreservesPitch).toBe(true);
    expect(el.volume).toBe(0.6);
    expect(el.currentTime).toBe(0.3);
    expect(el.plays).toBe(2); // the silent unlock play, then this
    expect(pb.playing()).toBe(true);
    pb.stop();
    await pb.done;
    expect(pb.playing()).toBe(false);
  });

  it('play stops within 20 ms of cue.end on timeupdate (no stop before)', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    const pausesBefore = el.pauses;
    el.tick(1.0);
    el.tick(2.0);
    el.tick(3.0 - 0.3); // 300 ms before the end: still playing
    expect(el.pauses).toBe(pausesBefore);
    el.tick(3.0 - END_EPSILON_S / 2); // inside the window
    expect(el.pauses).toBe(pausesBefore + 1);
    expect(el.paused).toBe(true);
    const r = await pb.done;
    expect(r.source).toBe('clips');
    expect(r.seconds).toBeCloseTo(3.0 - END_EPSILON_S / 2 - 0.3, 3);
    expect(el.listenerCount('timeupdate')).toBe(0);
    expect(el.listenerCount('ended')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the precise stop is armed at begin() and re-aimed from the media clock: a clip shorter than a timeupdate period stops on its cue with no timeupdate at all', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    // a lone kana: 0.4 s of media, shorter than the 250 ms timeupdate period can resolve
    const pb = h.player.play(cue({ start: 10, end: 10.4 }), { rate: 1, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.currentTime).toBe(10);
    expect(vi.getTimerCount()).toBe(2); // backstop + precise stop
    // the engine started 100 ms late: at the first aim (400 ms) the clock reads 10.3
    el.currentTime = 10.3;
    vi.advanceTimersByTime(400);
    expect(el.paused).toBe(false); // short of the cue: re-aimed, not stopped
    expect(vi.getTimerCount()).toBe(2);
    el.currentTime = 10.4;
    vi.advanceTimersByTime(100);
    expect(el.paused).toBe(true);
    const r = await pb.done;
    expect(r.source).toBe('clips');
    expect(r.seconds).toBeCloseTo(0.4, 3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a stalled element never spins the precise stop: with no progress since the last aim it stands down and leaves the stall to the backstop', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue({ start: 0, end: 0.5 }), { rate: 1, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(500); // the aim fires; the clock has not moved from 0
    expect(el.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1); // the backstop alone remains
    vi.advanceTimersByTime(STOP_BACKSTOP_MS + 1);
    await settle();
    expect(el.paused).toBe(true);
    expect((await pb.done).source).toBe('clips');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a wholeTrack cue sets no timer and ends on `ended`', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const whole = cue({ key: 's-04-1', file: FILES.story, start: 0, end: 10 });
    const pb = h.player.play(whole, { rate: 1, volume: 1, wholeTrack: true });
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    const el = slotEl(FILES.story, h.urls);
    el.tick(4);
    el.tick(8);
    el.tick(9.99); // past a sentence-style end: no stop for a whole track
    el.tick(10.5);
    expect(el.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    el.currentTime = 11;
    el.end();
    const r = await pb.done;
    expect(r).toEqual({ source: 'clips', seconds: 11 });
  });

  it('a sentence cue arms the (end − start) / rate + 1 s backstop; it only finishes a stalled or paused element', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue({ start: 0, end: 2 }), { rate: 2, volume: 1 });
    await settle();
    expect(vi.getTimerCount()).toBe(2); // the backstop and the precise stop, both armed at begin()
    const el = slotEl(FILES.examples, h.urls);
    let settled = false;
    void pb.done.then(() => {
      settled = true;
    });
    // progress keeps it alive past the first backstop
    el.tick(0.5);
    vi.advanceTimersByTime(1000 + STOP_BACKSTOP_MS - 1);
    await settle();
    expect(settled).toBe(false);
    // now frozen: the next backstop fire sees no progress and finishes
    vi.advanceTimersByTime(5000);
    await settle();
    expect(settled).toBe(true);
    expect(el.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('played seconds equal the sum of positive timeupdate deltas with document.hidden = true and no rAF ticks; a long hidden stretch counts whole', async () => {
    const h = track(await readyPlayer());
    h.doc.hidden = true;
    h.player.unlock();
    const onPlayed = vi.fn();
    const onProgress = vi.fn();
    const pb = h.player.play(cue({ start: 0, end: 60 }), { rate: 1, volume: 1, onPlayed, onProgress });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    el.tick(0.25);
    el.tick(0.5);
    el.tick(1.75);
    expect(onPlayed).toHaveBeenLastCalledWith(1.75);
    // the rAF loop is scheduled but no frame ever runs with the screen off
    expect(onProgress).not.toHaveBeenCalled();
    h.raf.tick(); // even a frame while hidden reports nothing
    expect(onProgress).not.toHaveBeenCalled();
    // visibilitychange reconciles the stretch the OS throttled while hidden — however long: 30 s with the screen off counts
    el.currentTime = 31.75;
    h.doc.dispatch('visibilitychange');
    expect(onPlayed).toHaveBeenLastCalledWith(31.75);
    // a backward move adds nothing; a programmatic seek (`seeking`) moves the reference without counting the jump
    el.tick(31.0);
    expect(onPlayed).toHaveBeenLastCalledWith(31.75);
    el.currentTime = 50;
    el.dispatch('seeking');
    el.tick(50.5);
    expect(onPlayed).toHaveBeenLastCalledWith(32.25);
    el.tick(59.99);
    const r = await pb.done;
    expect(r.source).toBe('clips');
    expect(r.seconds).toBeCloseTo(32.25 + 9.49, 3);
    expect(onPlayed).toHaveBeenLastCalledWith(r.seconds);
  });

  it('played seconds are media seconds, never divided by the playback rate (the unit `listen:played.seconds` and Radio’s cue.end − cue.start share)', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue({ start: 0, end: 10 }), { rate: 2, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.playbackRate).toBe(2);
    el.tick(4); // 4 media seconds at 2×: 4 s of material heard
    pb.stop();
    expect(await pb.done).toEqual({ source: 'clips', seconds: 4 });
  });

  it('a clause sub-range seeks to the clause start and stops at the clause end', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const c = cue({ morae: EX_MORAE, clauses: [3, 9] });
    const pb = h.player.play(c, { rate: 1, volume: 1, clause: [3, 9] });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.currentTime).toBeCloseTo(0.3 + 0.45, 9);
    el.tick(0.3 + 1.0);
    expect(el.paused).toBe(false);
    el.tick(0.3 + 1.35 - 0.01);
    expect(el.paused).toBe(true);
    const r = await pb.done;
    expect(r.seconds).toBeCloseTo(1.35 - 0.01 - 0.45, 3);
  });

  it('requestAnimationFrame drives onProgress (t, mora, clause) in the foreground only', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const onProgress = vi.fn();
    const c = cue({ morae: EX_MORAE, clauses: [3, 9] });
    const pb = h.player.play(c, { rate: 1, volume: 1, onProgress });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(h.raf.queue).toHaveLength(1);
    el.currentTime = 0.3 + 0.5;
    h.raf.tick();
    expect(onProgress).toHaveBeenLastCalledWith(0.5, 3, 1);
    el.currentTime = 0.3 + 1.4;
    h.raf.tick();
    expect(onProgress).toHaveBeenLastCalledWith(1.4, 9, 2);
    expect(h.raf.queue).toHaveLength(1); // re-armed
    h.doc.hidden = true;
    h.raf.tick();
    expect(onProgress).toHaveBeenCalledTimes(2);
    pb.stop();
    await pb.done;
    expect(h.raf.queue).toHaveLength(0);
    // no onProgress → no rAF at all
    const quiet = h.player.play(c, { rate: 1, volume: 1 });
    await settle();
    expect(h.raf.queue).toHaveLength(0);
    quiet.stop();
    await quiet.done;
  });

  it("a sprite that fails to load resolves { source: 'none' } so the caller falls back to the device voice", async () => {
    const files = packFiles();
    delete files[FILES.examples];
    const h = track(await readyPlayer({ files }));
    h.player.unlock();
    const r = await h.player.play(cue(), { rate: 1, volume: 1 }).done;
    expect(r).toEqual({ source: 'none', seconds: 0 });
    // element.play() rejecting (autoplay refused) also yields none
    for (const el of FakeAudio.all) el.rejectPlay = true;
    const r2 = await h.player.play(cue({ file: FILES.words }), { rate: 1, volume: 1 }).done;
    expect(r2).toEqual({ source: 'none', seconds: 0 });
  });

  it('stop() ends a clip early with the seconds heard so far; stop() before the sprite arrived resolves none', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const early = h.player.play(cue(), { rate: 1, volume: 1 });
    early.stop();
    expect(await early.done).toEqual({ source: 'none', seconds: 0 });
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    el.tick(1.3);
    pb.stop();
    expect(el.paused).toBe(true);
    expect(await pb.done).toEqual({ source: 'clips', seconds: 1 });
    pb.stop(); // idempotent
  });

  it('pause() / resume() / position() (Radio controls) reconcile without ending the clip', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const onPlayed = vi.fn();
    const pb = h.player.play(cue({ start: 1, end: 9 }), { rate: 1, volume: 1, wholeTrack: true, onPlayed });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    el.tick(3);
    pb.pause();
    expect(el.paused).toBe(true);
    expect(onPlayed).toHaveBeenLastCalledWith(2);
    expect(pb.position()).toBe(2);
    pb.resume();
    expect(el.paused).toBe(false);
    el.tick(4);
    expect(onPlayed).toHaveBeenLastCalledWith(3);
    el.end();
    expect((await pb.done).seconds).toBe(3);
  });

  it('pause() clears the stop backstop and resume() re-arms it: a paused sentence clip is never finished by the timer', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue({ start: 0, end: 2 }), { rate: 1, volume: 1 });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(vi.getTimerCount()).toBe(2); // the backstop and the precise stop
    el.tick(0.5);
    pb.pause();
    expect(el.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(pb.playing()).toBe(true);
    pb.resume();
    expect(el.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(2); // the backstop and the precise stop, both re-armed
    // frozen after resume: the re-armed backstop ((2 − 0.5) / 1 + 1 s) finishes it with the seconds heard
    vi.advanceTimersByTime(1500 + STOP_BACKSTOP_MS);
    await settle();
    expect(pb.playing()).toBe(false);
    expect(await pb.done).toEqual({ source: 'clips', seconds: 0.5 });
  });

  it('resume() continues from the media position the pause left; done.seconds counts both halves once in media seconds (no rate division); stop() while paused resolves', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const onPlayed = vi.fn();
    const pb = h.player.play(cue({ start: 0, end: 10 }), { rate: 2, volume: 1, onPlayed });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.playbackRate).toBe(2);
    el.tick(1.5);
    el.tick(3);
    pb.pause();
    expect(el.paused).toBe(true);
    expect(pb.position()).toBe(3);
    expect(onPlayed).toHaveBeenLastCalledWith(3);
    // paused for a long while: nothing counts, nothing finishes
    vi.advanceTimersByTime(30_000);
    await settle();
    expect(pb.playing()).toBe(true);
    expect(pb.position()).toBe(3);
    const plays = el.plays;
    pb.resume();
    expect(el.plays).toBe(plays + 1);
    expect(el.paused).toBe(false);
    expect(el.currentTime).toBe(3); // no seek: the element picks up where it stopped
    expect(pb.position()).toBe(3);
    el.tick(4); // the first delta after resume is 1 s, not 4
    expect(onPlayed).toHaveBeenLastCalledWith(4);
    el.tick(7);
    pb.pause();
    expect(pb.position()).toBe(7);
    pb.stop(); // stop() while paused resolves with the seconds heard
    expect(await pb.done).toEqual({ source: 'clips', seconds: 7 }); // 3 + 4 media seconds at 2×, never 3.5
    expect(pb.playing()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pause() before the sprite arrived keeps the element silent until resume(); the karaoke sweep pauses and resumes with the clip', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const onProgress = vi.fn();
    const pb = h.player.play(cue({ start: 0, end: 2, morae: [500, 1000, 1500, 2000] }), { rate: 1, volume: 1, onProgress });
    pb.pause(); // the fetch is still in flight
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.plays).toBe(1); // the silent unlock play only: the clip has not started
    expect(el.paused).toBe(true);
    expect(pb.playing()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.raf.queue).toHaveLength(0);
    pb.resume();
    expect(el.plays).toBe(2);
    expect(el.paused).toBe(false);
    expect(pb.playing()).toBe(true);
    expect(vi.getTimerCount()).toBe(2); // the stop backstop and the precise stop
    expect(h.raf.queue).toHaveLength(1);
    el.tick(0.6);
    h.raf.tick();
    expect(onProgress).toHaveBeenLastCalledWith(0.6, 1, 0);
    pb.pause();
    expect(h.raf.queue).toHaveLength(0); // the sweep stops with the clip
    h.raf.tick();
    expect(onProgress).toHaveBeenCalledTimes(1);
    pb.resume();
    expect(h.raf.queue).toHaveLength(1);
    el.tick(1.99);
    expect(await pb.done).toEqual({ source: 'clips', seconds: 1.99 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pause() while the element's play() promise is still pending (a fresh blob src decoding) is a pause, not a failed start: the AbortError the pause causes never resolves done 'none', and resume() picks the clip up", async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    await settle(); // the silent unlock plays settle first; from here every play() stays pending until `startPlaying()`
    for (const el of FakeAudio.all) el.deferPlay = true;
    const onPlayed = vi.fn();
    const pb = h.player.play(cue({ start: 0, end: 10 }), { rate: 1, volume: 1, wholeTrack: true, onPlayed });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.plays).toBe(2);
    expect(el.paused).toBe(false);
    let result: unknown = null;
    void pb.done.then((r) => {
      result = r;
    });
    pb.pause(); // the lock screen / Space, hundreds of ms into the startup window: the browser rejects the pending play()
    await settle();
    expect(el.paused).toBe(true);
    expect(result).toBeNull(); // not finished: a paused clip is not a failed one
    expect(pb.playing()).toBe(true);
    expect(pb.position()).toBe(0);
    pb.resume();
    expect(el.paused).toBe(false);
    el.startPlaying();
    await settle();
    el.tick(1);
    expect(onPlayed).toHaveBeenLastCalledWith(1);
    // pause() and resume() back to back: the rejection lands after the resume, still ours → ignored
    pb.pause();
    pb.resume();
    await settle();
    expect(result).toBeNull();
    expect(pb.playing()).toBe(true);
    el.startPlaying();
    el.tick(2);
    el.end();
    expect(await pb.done).toEqual({ source: 'clips', seconds: 2 });
  });

  it("a pending play() refused by the engine (NotAllowedError, no pause) still resolves done 'none' so the caller falls back to the device voice", async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    await settle();
    for (const el of FakeAudio.all) el.deferPlay = true;
    const pb = h.player.play(cue({ start: 0, end: 10 }), { rate: 1, volume: 1, wholeTrack: true });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(pb.playing()).toBe(true);
    el.refusePlaying();
    expect(await pb.done).toEqual({ source: 'none', seconds: 0 });
    expect(pb.playing()).toBe(false);
  });

  it('position() is the seconds played so far in the unit of done.seconds (ClipPlayback contract), not the media offset: a clause sub-range starts at 0 and the delta since the last timeupdate counts', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue({ start: 0, end: 10, morae: [500, 1000, 1500, 2000] }), { rate: 1, volume: 1, clause: [2, 4] });
    await settle();
    const el = slotEl(FILES.examples, h.urls);
    expect(el.currentTime).toBe(1); // the clause starts 1 s into the sprite
    expect(pb.position()).toBe(0);
    el.tick(1.5);
    expect(pb.position()).toBe(0.5);
    el.currentTime = 1.7; // between two timeupdates: the pending delta is read, not an onPlayed event
    expect(pb.position()).toBe(0.7);
    el.tick(1.7);
    pb.pause();
    expect(pb.position()).toBe(0.7);
    pb.stop();
    expect(await pb.done).toEqual({ source: 'clips', seconds: 0.7 });
  });

  it('dispose() stops live playback, pauses the pool and revokes every blob URL', async () => {
    const h = track(await readyPlayer());
    h.player.unlock();
    const pb = h.player.play(cue(), { rate: 1, volume: 1 });
    await settle();
    h.player.dispose();
    await expect(pb.done).resolves.toMatchObject({ source: 'clips' });
    expect(h.urls.revoked).toContain('blob:fake/1');
    expect(h.urls.revoked).toContain('blob:fake/2');
    for (const el of FakeAudio.all) expect(el.paused).toBe(true);
    const after = await h.player.play(cue(), { rate: 1, volume: 1 }).done;
    expect(after).toEqual({ source: 'none', seconds: 0 });
  });

  it('without URL.createObjectURL the player stays harmless: unlock is a no-op and play resolves none', async () => {
    const h = track(await readyPlayer({ options: { urls: null } }));
    h.player.unlock();
    expect(FakeAudio.created).toBe(0);
    expect(await h.player.play(cue(), { rate: 1, volume: 1 }).done).toEqual({ source: 'none', seconds: 0 });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Cache                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

describe('audio cache (tsuzuku-audio-v1)', () => {
  it('prefetchStation loads the station indexes and puts its sprites — stories first — within the budget; repeated calls are idle', async () => {
    const h = track(await readyPlayer());
    h.player.prefetchStation(4);
    await settle(200);
    expect(h.player.cueFor('s-04-1#L0')).toBeDefined();
    expect(h.caches.cache.puts).toBe(4);
    const keys = Array.from(h.caches.cache.store.keys());
    expect(keys).toEqual([`${BASE}${FILES.story}`, `${BASE}${FILES.words}`, `${BASE}${FILES.examples}`, `${BASE}${FILES.misc}`]);
    const n = h.fetch.mock.calls.length;
    h.player.prefetchStation(4);
    await settle(200);
    expect(h.fetch.mock.calls.length).toBe(n);
    expect(h.caches.cache.puts).toBe(4);
    // station 0 (onboarding) prefetches Station 1's material, which this pack lacks: nothing stored, nothing thrown
    h.player.prefetchStation(0);
    await settle(200);
    expect(h.caches.cache.puts).toBe(4);
  });

  it('prefetchStation under data saver (prefetchAllowed() false) loads the station indexes but stores no sprite; the default gate reads navigator.connection.saveData', async () => {
    let allowed = false;
    const h = track(await readyPlayer({ options: { prefetchAllowed: () => allowed } }));
    h.player.prefetchStation(4);
    await settle(200);
    expect(h.player.cueFor('s-04-1#L0')).toBeDefined();
    expect(h.caches.cache.puts).toBe(0);
    expect(h.fetch.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/sprites/'))).toEqual([]);
    allowed = true;
    h.player.prefetchStation(4);
    await settle(200);
    expect(h.caches.cache.puts).toBe(4);
    // the default predicate: the browser's data saver
    Object.defineProperty(globalThis.navigator, 'connection', { configurable: true, value: { saveData: true } });
    try {
      const saver = track(await readyPlayer({ options: { prefetchAllowed: undefined } }));
      saver.player.prefetchStation(4);
      await settle(200);
      expect(saver.caches.cache.puts).toBe(0);
      expect(saver.player.cueFor('s-04-1#L0')).toBeDefined();
    } finally {
      Object.defineProperty(globalThis.navigator, 'connection', { configurable: true, value: undefined });
    }
  });

  it('prefetchStation respects the byte budget and skips sprites already cached', async () => {
    const h = track(await readyPlayer({ options: { prefetchBudgetBytes: 1500 } }));
    await h.caches.cache.put(`${BASE}${FILES.story}`, okBytes(1000) as unknown as Response);
    h.player.prefetchStation(4);
    await settle(200);
    // the story sprite was already there (counted, not fetched); the next 1000 B would exceed 1500 → stop
    expect(h.caches.cache.puts).toBe(1);
    expect(h.fetch.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/sprites/'))).toEqual([]);
  });

  it('download(belt) stores the belt sprites with progress, skips cached ones, and rejects when a file is missing', async () => {
    const h = track(await readyPlayer());
    await h.caches.cache.put(`${BASE}${FILES.words}`, okBytes(1000) as unknown as Response);
    const progress: [number, number][] = [];
    await h.player.download('yellow', (d, t) => progress.push([d, t]));
    expect(progress[0]).toEqual([0, 4000]);
    expect(progress[progress.length - 1]).toEqual([4000, 4000]);
    expect(h.caches.cache.puts).toBe(4); // the seeded put + 3 downloads
    expect(h.fetch.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/sprites/'))).toEqual([`${BASE}${FILES.story}`, `${BASE}${FILES.examples}`, `${BASE}${FILES.misc}`]);
    await h.player.download('white');
    expect(h.caches.cache.store.has(`${BASE}${FILES.kana}`)).toBe(true);
    // a 404 sprite: the others are stored, the promise rejects
    const files = packFiles();
    delete files[FILES.green];
    const h2 = track(await readyPlayer({ files }));
    await expect(h2.player.download('green')).rejects.toThrow(/incomplete/);
  });

  it('remove(belt) deletes the belt sprites; cacheUsage() reports real bytes from the manifest (content-length for unknown files)', async () => {
    const h = track(await readyPlayer());
    await h.player.download('yellow');
    await h.player.download('white');
    await h.caches.cache.put(`${BASE}audio/other.webm`, okBytes(77) as unknown as Response);
    await h.caches.cache.put(`${BASE}content/x.json`, okBytes(5) as unknown as Response);
    expect(await h.player.cacheUsage()).toEqual({ bytes: 4400 + 77, files: 6 });
    await h.player.remove('yellow');
    expect(await h.player.cacheUsage()).toEqual({ bytes: 400 + 77, files: 2 });
    expect(h.caches.cache.store.has(`${BASE}${FILES.kana}`)).toBe(true);
    expect(h.caches.cache.store.has(`${BASE}${FILES.story}`)).toBe(false);
  });

  it('prune keeps only sprite paths present in the manifest (set difference, not a version prefix) and drops stale index files', async () => {
    const h = make();
    players.push(h.player);
    const c = h.caches.cache;
    await c.put(`${BASE}${FILES.story}`, okBytes(1) as unknown as Response);
    await c.put(`${BASE}audio/sprites/s04/s-04-1-00000000.webm`, okBytes(1) as unknown as Response); // the same text, an older render
    await c.put(`${BASE}audio/sprites/s99/gone-12345678.webm`, okBytes(1) as unknown as Response);
    await c.put(`${BASE}audio/a-oldversion/n5/words.json`, okBytes(1) as unknown as Response);
    await c.put(`${BASE}audio/${V}/n5/words.json`, okBytes(1) as unknown as Response);
    await c.put(`${BASE}audio/manifest.json`, okBytes(1) as unknown as Response);
    await c.put(`${BASE}content/manifest.json`, okBytes(1) as unknown as Response);
    await settle(40); // ready → prune ran in the background
    expect(h.player.ready.value).toBe('ready');
    const left = Array.from(c.store.keys()).sort();
    expect(left).toEqual([`${BASE}${FILES.story}`, `${BASE}audio/${V}/n5/words.json`, `${BASE}audio/manifest.json`, `${BASE}content/manifest.json`].sort());
    // explicit prune on a pruned cache removes nothing; a manifest without files prunes nothing
    expect(await h.player.prune()).toBe(0);
    const bare = track(make({ files: { 'audio/manifest.json': { schema: 'tsuzuku.audio/1', audioVersion: V } } }));
    await bare.caches.cache.put(`${BASE}audio/sprites/s04/x-00000000.webm`, okBytes(1) as unknown as Response);
    await settle(40);
    expect(bare.player.ready.value).toBe('ready');
    expect(await bare.player.prune()).toBe(0);
    expect(bare.caches.cache.store.size).toBe(1);
  });

  it('without a Cache API nothing is stored and nothing throws on the boot path; download() alone rejects, so Settings never shows a finished download of nothing', async () => {
    const h = track(await readyPlayer({ options: { caches: null } }));
    h.player.prefetchStation(4);
    await settle(200);
    const progress = vi.fn();
    await expect(h.player.download('yellow', progress)).rejects.toThrow(CACHE_UNAVAILABLE);
    expect(progress).not.toHaveBeenCalled();
    await expect(h.player.remove('yellow')).resolves.toBeUndefined();
    expect(await h.player.cacheUsage()).toEqual({ bytes: 0, files: 0 });
    expect(await h.player.prune()).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Sanity on the fakes                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

describe('fakes', () => {
  it('the last constructed element helper and the fetch fake behave', async () => {
    const h = track(make());
    await settle();
    expect(lastAudio).toBeTypeOf('function');
    expect((await h.fetch(`${BASE}nope.json`)).ok).toBe(false);
    expect((await h.fetch(`${BASE}${FILES.kana}`)).ok).toBe(true);
  });
});
