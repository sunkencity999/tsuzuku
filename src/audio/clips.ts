/**
 * TSUZUKU — the pre-rendered voice pack player (design 08 §8; the `ClipPlayer`
 * contract lives in `shared/audio.ts`). Zero dependencies; every browser
 * surface is injectable so the module runs under jsdom.
 *
 * What it does
 *  - **Readiness.** `./audio/manifest.json` (`tsuzuku.audio/1`) is fetched once
 *    behind first paint. A 404, a malformed manifest or a browser that cannot
 *    play Opus/WebM (`canPlayType('audio/webm; codecs="opus"') === ''`) makes
 *    `ready` `'absent'`; nothing on the boot path ever throws, and `speak()`
 *    falls back to the device voice per clip.
 *  - **Indexes.** `audio/<audioVersion>/<level>/{words,sentences,ear}.json`,
 *    `audio/<audioVersion>/sNN/stories.json` and `audio/<audioVersion>/kana/tracks.json`
 *    are small, versioned and loaded on demand (`loadLevel`, `loadStation`,
 *    `kanaTracks`); a cache miss in `cueFor()` kicks the matching load off in
 *    the background so the next call hits. Parsers are tolerant: unknown
 *    fields are ignored, a missing index file means that level simply misses.
 *  - **Cues.** `cueFor(key, { rate, speaker })` picks the variant whose native
 *    rate is nearest the requested one (a natural-slow take is a second cue at
 *    0.85) and, given a speaker, prefers the cast voice the manifest maps it
 *    to. `cueForText()` is the `byText` fallback for SENTENCES only — never for
 *    a bare word, since a kana key would collapse homophones.
 *  - **Playback (iOS-safe).** WebKit unlocks autoplay per media element, so
 *    `unlock()` — called synchronously inside the first gesture — builds the
 *    fixed pool of `POOL_SIZE` (6) `Audio` elements once, plays a tiny silent
 *    Opus blob on each and pauses it. Afterwards only `src` swaps (LRU; a blob
 *    URL from the fetched bytes re-wrapped as `audio/webm; codecs=opus`,
 *    because Pages serves `.webm` as `video/webm`) — `new Audio()` is never
 *    called again. `play()` before `unlock()` resolves at once with
 *    `source: 'none'` so callers fall back instead of hanging. A gesture the
 *    engine does not count as activation (a touch's `pointerdown` on WebKit)
 *    rejects the silent plays with `NotAllowedError`: the pool is dropped and
 *    the next `unlock()` rebuilds it, so `unlocked()` means "built AND
 *    accepted". An `absent` pack builds no pool at all. Two live playbacks
 *    never share an element: a sprite held by a busy slot is re-wrapped onto
 *    a free one from the bytes the slot keeps (no second fetch).
 *  - **Timing from media events only.** Played seconds are media seconds: the
 *    positive `currentTime` deltas accumulated on `timeupdate` (fires with the
 *    screen off), reconciled on `pause` / `ended` / `visibilitychange` — a
 *    30 s stretch the OS throttled arrives as one delta and counts whole; a
 *    programmatic seek (`seeking`) only moves the reference. No division by
 *    the playback rate: `listen:played.seconds` and Radio's `cue.end − cue.start`
 *    count the same unit. The stop at `cue.end` is detected on `timeupdate`; a
 *    `(end − start) / rate + 1 s` timer is a foreground backstop only
 *    (cleared by `pause()`, re-armed by `resume()`; a `pause()` that lands
 *    while the sprite is still arriving sets the element up silent and
 *    `resume()` starts it). A `wholeTrack` cue (Radio)
 *    schedules no timer and ends on `ended`. `requestAnimationFrame` drives
 *    `onProgress` (karaoke) and nothing else.
 *  - **Cache.** The Cache API bucket `tsuzuku-audio-v1` is read first for every
 *    sprite but written ONLY by `prefetchStation()` (the station's sprites, up
 *    to `PREFETCH_BUDGET_BYTES`; under data saver — `prefetchAllowed()` false,
 *    default `navigator.connection.saveData` — only the small indexes load and
 *    no sprite is stored) and `download(belt)` (rejects `CACHE_UNAVAILABLE`
 *    without a Cache API, so Settings never shows a finished download of
 *    nothing); a plain `play()` never stores. `prune()` deletes cached sprite URLs absent from
 *    `manifest.files[].path` — a set difference, never a version prefix, so an
 *    unchanged sprite survives every release. The service worker passes
 *    `audio/sprites/` through and serves the indexes stale-while-revalidate.
 *
 * Index shapes (docs/AUDIO_PACK.md §3, `tsuzuku.audio-index/1`): compact cues
 * `{ f, s, e, v, r, k, pv, m, c }` index into the file's `files` / `voices`
 * tables; a `CueIndex` holds them under `cues[key]` (an array, one per native
 * rate), a `StoriesIndex` under `texts[storyId] = { f, whole: { s, e } | null,
 * lines: CompactCue[][] }` (→ `<storyId>#L<i>` line cues plus the `<storyId>`
 * whole track; `whole: null` — a line was skipped — or an absent `whole` means
 * NO Radio track, never one synthesised from the lines' min / max, and a
 * skipped line `[]` yields no cue, so the device voice covers it; AUDIO_PACK
 * §3.2) and `misc[key]`, a `TracksIndex` under `tracks` (full `TrackCue` rows
 * with `segments`). `byText` maps the hex8 `fnv1a32` of the spoken text to a
 * key. The parser also accepts the verbose spelling (`file / start / end /
 * voice / rate / morae / clauses / pitchVerified`, a plain-text `byText` key)
 * so a hand-written fixture pack works. Sprite paths are relative to
 * `public/audio/` (`sprites/...`); `audio/...` and bare `sNN/...` are completed.
 */
import { signal, type Signal } from '@preact/signals';
import { BELTS, BELT_IDS, type Belt, type Level } from '../content/types';
import { saveDataRequested, type AudioPackBelt, type AudioPackInfo, type ClipCue, type ClipPlayOptions, type ClipPlayback, type ClipPlayer, type ClipReady, type TrackCue } from '../shared/audio';
import { fnv1a32 } from '../shared/hash';
import { levelOfId, stationOfId } from '../shared/ids';
import { WORD_MAX_CHARS, textToSpeak } from '../shared/speak-text';

/* ────────────────────────────────────────────────────────────────────────── */
/* Tunables                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** The Cache API bucket this module owns; stable, never cleared by the service worker. */
export const AUDIO_CACHE = 'tsuzuku-audio-v1';
/** Media elements built once in `unlock()` (design 08 §14: ≤ 6 decoded sprites). */
export const POOL_SIZE = 6;
/** The type every fetched sprite is re-wrapped as (Pages serves `.webm` as `video/webm`). */
export const OPUS_BLOB_TYPE = 'audio/webm; codecs=opus';
/** The capability probe (design 08 §8). */
export const OPUS_PROBE_TYPE = 'audio/webm; codecs="opus"';
/** Idle prefetch ceiling per station (design 08 §14: 1–3 MB). */
export const PREFETCH_BUDGET_BYTES = 3 * 1024 * 1024;
/** Grace on the foreground stop backstop beyond the cue's own length. */
export const STOP_BACKSTOP_MS = 1000;
/** A `timeupdate` this close to `cue.end` (seconds) stops the clip. */
export const END_EPSILON_S = 0.02;
/** `download()` rejects with this message when the browser has no Cache API (nothing could be kept). */
export const CACHE_UNAVAILABLE = 'audio cache unavailable';
/** The manifest schema this player reads. */
export const MANIFEST_SCHEMA = 'tsuzuku.audio/1';
/** Where the pack lives, relative to the site root. */
export const AUDIO_ROOT = 'audio/';
/** Native rate of the natural-slow take (design 08 §7 #4). */
export const SLOW_RATE = 0.85;

/**
 * A 20 ms silent mono Opus/WebM clip (517 bytes; `ffmpeg -f lavfi -i
 * anullsrc=r=24000:cl=mono -t 0.02 -c:a libopus -b:a 6k`), played and paused on
 * each pool element inside the first gesture so WebKit unlocks them all.
 */
export const SILENT_OPUS_BASE64 =
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAHVEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggE8TbuMU6uEHFO7a1OsggG/7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiEA8AAAAAAAAFlSua/GuAQAAAAAAAGjXgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhkFfT1BVU1aqg2MuoFa7hATEtACDgQIj44OEATEtAOGRn4EBtYhA13AAAAAAAGJkgRBV7oEAY6KTT3B1c0hlYWQBATgBwF0AAAAAABJUw2fRc3POY8CLY8WIAAAAAAAAAAFnyJlFo4dFTkNPREVSRIeMTGF2YyBsaWJvcHVzZ8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4wMjgwMDAwMDAAH0O2dajngQCji4EAAIAIC+Y7I6tgoJahioEAFQAICKyzDsabgQd1ooQAzf5gHFO7a5G7j7OBALeK94EB8YIBkvCBAw==';

/* ────────────────────────────────────────────────────────────────────────── */
/* Injectable surfaces                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/** The subset of `HTMLMediaElement` the pool uses (tests pass a plain fake). */
export interface MediaLike {
  src: string;
  currentTime: number;
  playbackRate: number;
  volume: number;
  preservesPitch?: boolean;
  /** Old Safari. */
  webkitPreservesPitch?: boolean;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  canPlayType?(type: string): string;
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
  removeEventListener(type: string, fn: (ev?: unknown) => void): void;
}

export type MediaCtor = new () => MediaLike;

/** One Cache API bucket, by URL string. */
export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
  keys(): Promise<ReadonlyArray<{ url: string }>>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

export interface RafLike {
  request(cb: (t: number) => void): number;
  cancel(id: number): void;
}

/** `URL.createObjectURL` / `revokeObjectURL` (absent under jsdom, so injectable). */
export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

/** `document`: hidden state and `visibilitychange`. */
export interface DocLike {
  readonly hidden: boolean;
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
  removeEventListener(type: string, fn: (ev?: unknown) => void): void;
}

export type FetchLike = (url: string) => Promise<Response>;

export interface ClipPlayerOptions {
  /** Default `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Default `globalThis.Audio`; `null` = no media playback (ready stays `absent`). */
  audioCtor?: MediaCtor | null;
  /** Default `globalThis.caches`; `null` = no cache (play still works from the network). */
  caches?: CacheStorageLike | null;
  /** Default `requestAnimationFrame`; `null` disables `onProgress`. */
  raf?: RafLike | null;
  /** Site root the `audio/` paths hang off; default `./` resolved against the document. */
  base?: string;
  /** Clock for the LRU tie-break; default a constant (the sequence number orders the pool — the wall clock stays in `main.tsx` per the architecture lint). */
  now?: () => number;
  /** Default `URL.createObjectURL` / `revokeObjectURL`; `null` = cannot play (resolves `none`). */
  urls?: ObjectUrls | null;
  /** Default `globalThis.document`; `null` = never hidden, no visibility reconcile. */
  doc?: DocLike | null;
  /** Capability probe; default `new audioCtor().canPlayType(type)`. */
  canPlay?: (type: string) => string;
  /** Default `POOL_SIZE`. */
  poolSize?: number;
  /** Default `PREFETCH_BUDGET_BYTES`. */
  prefetchBudgetBytes?: number;
  /**
   * Whether idle sprite prefetch may store bytes right now (design 08 §13 data
   * saver); default `navigator.connection.saveData !== true`. `main.tsx` passes
   * a predicate that reads the learner's `settings.dataSaver` too.
   */
  prefetchAllowed?: () => boolean;
}

/**
 * `ClipPlayback` plus the controls Radio needs (Space pause, seek-free resume).
 * Additive to the contract. `pause()` clears the stop backstop and `resume()`
 * re-arms it, so a paused sentence clip is never finished by the timer.
 */
export interface ClipPlaybackEx extends ClipPlayback {
  pause(): void;
  resume(): void;
  /**
   * Media seconds played so far — the unit of `done.seconds` (the `ClipPlayback` contract), counted like `onPlayed`
   * with the delta since the last `timeupdate` added; 0 before the element is ready. A clause sub-range starts at 0,
   * not at the clause offset: a progress bar over the cue uses `onProgress`'s `t` instead.
   */
  position(): number;
  /** True once `play()` was accepted by the element and until `done` settles. */
  playing(): boolean;
}

/** `ClipPlayer` plus the additive members this implementation exposes. */
export interface ClipPlayerEx extends ClipPlayer {
  play(cue: ClipCue, o: ClipPlayOptions): ClipPlaybackEx;
  /** The kana tracks with their `segments` (what is said when, for the Radio transcript). */
  kanaTracks(): Promise<KanaTrackCue[]>;
  /** Deletes cached sprite URLs absent from the manifest (set difference); a no-op without a manifest. */
  prune(): Promise<number>;
  /** True once the pool is built AND the gesture was accepted (a silent play resolved); false again after a `NotAllowedError` dropped it, until the next `unlock()`. */
  unlocked(): boolean;
  /** Keys currently indexed (tests, diagnostics). */
  indexedKeys(): number;
  /** The site-root URL the player resolves `audio/...` against. */
  rootUrl(): string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const SENTENCE_PUNCT_RE = /[。！？!?．.]/;
const WS_RE = /[\s　]+/g;
const STATION_SEG_RE = /(?:^|\/)s(\d{2})\//;
const KANA_SEG_RE = /(?:^|\/)kana\//;
const META_KEYS = new Set([
  'schema',
  'audioVersion',
  'contentVersion',
  'level',
  'station',
  'scope',
  'kind',
  'byText',
  'files',
  'voices',
  'engine',
  'generatedAt',
  'tier',
  'tiers',
  'totals',
  'credits',
  'belts',
  'indexes',
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function str(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : d;
}

function numArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const x of v) if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
  return out.length > 0 ? out : undefined;
}

/** `sNN/x.webm` → `audio/sprites/sNN/x.webm`; `sprites/...` → `audio/sprites/...`; `audio/...` as is. */
export function spritePath(file: string): string {
  const f = file.replace(/^\.?\//, '');
  if (f.startsWith(AUDIO_ROOT)) return f;
  if (f.startsWith('sprites/')) return AUDIO_ROOT + f;
  return `${AUDIO_ROOT}sprites/${f}`;
}

/** Design 08 §8: text lookup serves sentences only; a bare word (no sentence punctuation, ≤ `WORD_MAX_CHARS`) is refused. */
export function isSentenceText(spoken: string): boolean {
  if (spoken.length === 0) return false;
  if (SENTENCE_PUNCT_RE.test(spoken)) return true;
  return Array.from(spoken.replace(WS_RE, '')).length > WORD_MAX_CHARS;
}

/** Belt of a station (inclusive ranges from `BELTS`); 0 and below → white, past the road → black. */
export function beltOfStation(n: number): Belt {
  for (const b of BELTS) if (n >= b.stations[0] && n <= b.stations[1]) return b.id;
  return n < 1 ? 'white' : 'black';
}

/** Curriculum level the station's indexes live under. */
export function levelOfStation(n: number): Level {
  for (const b of BELTS) if (n >= b.stations[0] && n <= b.stations[1]) return b.level;
  return n < 1 ? 'kana' : 'n1';
}

/** Belt a sprite path belongs to: an explicit `belt` wins, else the `sNN/` segment, `kana/` → white. */
export function beltOfPath(path: string, explicit?: unknown): Belt | undefined {
  if (typeof explicit === 'string' && (BELT_IDS as readonly string[]).includes(explicit)) return explicit as Belt;
  const m = STATION_SEG_RE.exec(path);
  if (m) return beltOfStation(Number(m[1]));
  if (KANA_SEG_RE.test(path)) return 'white';
  return undefined;
}

/** Station number of a sprite path (`sNN/` segment), or undefined. */
export function stationOfPath(path: string): number | undefined {
  const m = STATION_SEG_RE.exec(path);
  return m ? Number(m[1]) : undefined;
}

/** The cue whose native rate is nearest `rate` (ties → the faster take). */
export function nearestRate<T extends { rate: number }>(variants: readonly T[], rate: number): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const v of variants) {
    const d = Math.abs((v.rate || 1) - rate);
    if (d < bestD || (d === bestD && best && v.rate > best.rate)) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

/** Whether a cue's `voice` credit names the cast voice `want` (either direction, case-insensitive). */
export function voiceMatches(cueVoice: string, want: string): boolean {
  const a = cueVoice.toLowerCase();
  const b = want.toLowerCase();
  return a.length > 0 && b.length > 0 && (a === b || a.includes(b) || b.includes(a));
}

/**
 * Seconds `[from, to]` inside the sprite for a clause `[fromMora, toMora)` over
 * the cue's cumulative mora boundaries (ms from the clip start). Without mora
 * data, or with an empty range, the whole cue.
 */
export function clauseRange(cue: ClipCue, clause?: [number, number]): [number, number] {
  const whole: [number, number] = [cue.start, cue.end];
  const m = cue.morae;
  if (!clause || !m || m.length === 0) return whole;
  const n = m.length;
  const from = Math.max(0, Math.floor(clause[0]));
  const to = Math.max(0, Math.floor(clause[1]));
  const fromMs = from <= 0 ? 0 : (m[Math.min(from, n) - 1] as number);
  const toMs = to <= 0 ? 0 : (m[Math.min(to, n) - 1] as number);
  if (!(fromMs < toMs)) return whole;
  return [cue.start + fromMs / 1000, Math.min(cue.end, cue.start + toMs / 1000)];
}

/** Karaoke position: the mora sounding at `t` seconds into the clip, and the clause it falls in. */
export function karaokeAt(cue: ClipCue, t: number): { mora: number; clause: number } {
  const m = cue.morae;
  if (!m || m.length === 0) return { mora: 0, clause: 0 };
  const ms = t * 1000;
  let lo = 0;
  let hi = m.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((m[mid] as number) <= ms) lo = mid + 1;
    else hi = mid;
  }
  const mora = Math.min(lo, m.length - 1);
  let clause = 0;
  for (const c of cue.clauses ?? []) if (c <= mora) clause++;
  return { mora, clause };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Plain base64 → bytes (no `atob` / `Buffer` dependency, so the module runs anywhere); `ArrayBuffer`-backed so it is a `BlobPart`. */
export function decodeBase64(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 3) / 4)));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return n === out.length ? out : out.subarray(0, n);
}

/** Decodes the silent unlock clip. */
export function silentOpusBytes(): Uint8Array<ArrayBuffer> {
  return decodeBase64(SILENT_OPUS_BASE64);
}

/* ── manifest ───────────────────────────────────────────────────────────── */

export interface PackFile {
  path: string;
  bytes: number;
  seconds: number;
  clips: number;
  belt: Belt | undefined;
}

export interface PackManifest {
  info: AudioPackInfo;
  files: PackFile[];
  /** `files[].path`, normalised. */
  paths: Set<string>;
  bytesByPath: Map<string, number>;
  /** Speaker label → the cue `voice` credit the cast gives it. */
  speakerVoice: Map<string, string>;
  /** `indexes[].path` normalised to `audio/<v>/...` — the index files that exist; empty = unknown, fetch and see. */
  indexPaths: Set<string>;
}

function beltRow(v: unknown): AudioPackBelt | undefined {
  if (!isObj(v)) return undefined;
  return { bytes: num(v.bytes), seconds: num(v.seconds), files: num(v.files) };
}

function voiceOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!isObj(v)) return '';
  return str(v.voice) || str(v.credit) || str(v.character) || str(v.name);
}

function creditOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!isObj(v)) return '';
  const credit = str(v.credit) || str(v.text);
  if (credit) return credit;
  const character = str(v.character);
  return character ? `VOICEVOX:${character}` : '';
}

/** Tolerant manifest parse; `null` when the shape is not a `tsuzuku.audio/1` pack. */
export function parseManifest(json: unknown): PackManifest | null {
  if (!isObj(json)) return null;
  const schema = str(json.schema);
  if (!schema.startsWith('tsuzuku.audio/')) return null;
  const audioVersion = str(json.audioVersion);
  if (!audioVersion) return null;

  const files: PackFile[] = [];
  if (Array.isArray(json.files)) {
    for (const row of json.files) {
      if (!isObj(row) || typeof row.path !== 'string' || row.path.length === 0) continue;
      const path = spritePath(row.path);
      files.push({ path, bytes: num(row.bytes), seconds: num(row.seconds), clips: num(row.clips), belt: beltOfPath(path, row.belt) });
    }
  }
  const paths = new Set(files.map((f) => f.path));
  const bytesByPath = new Map(files.map((f) => [f.path, f.bytes] as const));

  const belts: Partial<Record<Belt, AudioPackBelt>> = {};
  if (isObj(json.belts)) {
    for (const b of BELT_IDS) {
      const row = beltRow(json.belts[b]);
      if (row) belts[b] = row;
    }
  } else {
    for (const f of files) {
      if (!f.belt) continue;
      const row = (belts[f.belt] ??= { bytes: 0, seconds: 0, files: 0 });
      row.bytes += f.bytes;
      row.seconds += f.seconds;
      row.files += 1;
    }
  }
  const totals =
    beltRow(json.totals) ??
    files.reduce<AudioPackBelt>((acc, f) => ({ bytes: acc.bytes + f.bytes, seconds: acc.seconds + f.seconds, files: acc.files + 1 }), { bytes: 0, seconds: 0, files: 0 });

  const speakerVoice = new Map<string, string>();
  if (isObj(json.voices)) {
    for (const [speaker, v] of Object.entries(json.voices)) {
      const voice = voiceOf(v);
      if (voice) speakerVoice.set(speaker, voice);
    }
  } else if (Array.isArray(json.voices)) {
    for (const v of json.voices) {
      if (!isObj(v)) continue;
      const voice = voiceOf(v);
      const names = [v.speaker, v.name, ...(Array.isArray(v.speakers) ? v.speakers : [])];
      for (const n of names) if (typeof n === 'string' && voice) speakerVoice.set(n, voice);
    }
  }

  const credits: string[] = [];
  const seen = new Set<string>();
  const pushCredit = (c: string): void => {
    if (c && !seen.has(c)) {
      seen.add(c);
      credits.push(c);
    }
  };
  if (Array.isArray(json.credits)) for (const c of json.credits) pushCredit(creditOf(c));
  if (credits.length === 0) {
    const voices = isObj(json.voices) ? Object.values(json.voices) : Array.isArray(json.voices) ? json.voices : [];
    for (const v of voices) pushCredit(creditOf(v));
  }

  const indexPaths = new Set<string>();
  if (Array.isArray(json.indexes)) {
    for (const row of json.indexes) {
      const p = isObj(row) ? str(row.path) : typeof row === 'string' ? row : '';
      if (p) indexPaths.add(p.startsWith(AUDIO_ROOT) ? p : AUDIO_ROOT + p.replace(/^\.?\//, ''));
    }
  }

  return {
    info: { audioVersion, contentVersion: str(json.contentVersion), engine: str(json.engine), belts, totals, credits },
    files,
    paths,
    bytesByPath,
    speakerVoice,
    indexPaths,
  };
}

/* ── indexes ────────────────────────────────────────────────────────────── */

export interface ParsedIndex {
  cues: Map<string, ClipCue[]>;
  /** `byText` hash (hex8 of the spoken text) → clip keys. */
  byText: Map<string, string[]>;
  tracks: KanaTrackCue[];
}

/** A kana track row (`kana/tracks.json`, AUDIO_PACK §3.3): the contract `TrackCue` plus what is said when. */
export interface KanaTrackCue extends TrackCue {
  segments?: { s: number; e: number; text: string; en?: string }[];
}

/** The `files` / `voices` tables of a compact index (AUDIO_PACK §3). */
interface Tables {
  files: string[];
  voices: string[];
}

interface Inherit {
  file?: string;
  voice?: string;
  rate?: number;
}

const HEX8_RE = /^[0-9a-f]{8}$/;

function tablesOf(json: Record<string, unknown>): Tables {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : []);
  return { files: strings(json.files), voices: strings(json.voices) };
}

/** A file reference: a table index (`f: 0`) or a path (`f` / `file` as a string). */
function fileOf(v: Record<string, unknown>, t: Tables): string | undefined {
  const raw = v.f ?? v.file;
  if (typeof raw === 'number') return t.files[raw];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return undefined;
}

/** A voice reference: a table index (`v: 0`) or the credit string (`v` / `voice`). */
function voiceRef(v: Record<string, unknown>, t: Tables): string | undefined {
  const raw = v.v ?? v.voice;
  if (typeof raw === 'number') return t.voices[raw];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return undefined;
}

/**
 * One cue from a compact (`{ f, s, e, v, r, k, pv, m, c }`) or verbose
 * (`{ file, start, end, voice, rate, morae, clauses, pitchVerified }`) record;
 * `null` when the span or the file is missing.
 */
function cueFrom(key: string, v: Record<string, unknown>, inherit: Inherit, t: Tables): ClipCue | null {
  const file = fileOf(v, t) ?? inherit.file;
  if (!file) return null;
  const start = num(v.s ?? v.start, NaN);
  const end = num(v.e ?? v.end, NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const cue: ClipCue = {
    key,
    file: spritePath(file),
    start,
    end,
    voice: voiceRef(v, t) ?? inherit.voice ?? '',
    rate: num(v.r ?? v.rate, inherit.rate ?? 1) || 1,
  };
  const morae = numArray(v.m) ?? numArray(v.morae);
  if (morae) cue.morae = morae;
  const clauses = numArray(v.c) ?? numArray(v.clauses);
  if (clauses) cue.clauses = clauses;
  const pv = v.pv ?? v.pitchVerified;
  if (typeof pv === 'boolean') cue.pitchVerified = pv;
  return cue;
}

function sameCue(a: ClipCue, b: ClipCue): boolean {
  return a.file === b.file && a.start === b.start && a.rate === b.rate;
}

function pushCue(out: ParsedIndex, cue: ClipCue): void {
  const list = out.cues.get(cue.key);
  if (list) {
    if (!list.some((c) => sameCue(c, cue))) list.push(cue);
  } else out.cues.set(cue.key, [cue]);
}

function withTitle(cue: ClipCue, title: string, titleEn: string): TrackCue {
  const track: TrackCue = { ...cue, title };
  if (titleEn) track.titleEn = titleEn;
  return track;
}

/** One index entry (`cues[key]`, `texts[storyId]`, `misc[key]`): an array of rate variants, a story entry or a single cue. */
function entryCues(out: ParsedIndex, key: string, v: unknown, inherit: Inherit, t: Tables): void {
  if (Array.isArray(v)) {
    for (const x of v) entryCues(out, key, x, inherit, t);
    return;
  }
  if (!isObj(v)) return;
  if (Array.isArray(v.lines) || isObj(v.whole)) {
    storyEntry(out, key, v, inherit, t);
    return;
  }
  const cue = cueFrom(key, v, inherit, t);
  if (cue) {
    const title = str(v.title) || str(v.titleJa);
    pushCue(out, title ? withTitle(cue, title, str(v.titleEn)) : cue);
  }
  if (isObj(v.slow)) {
    const slow = cueFrom(key, v.slow, { file: fileOf(v, t) ?? inherit.file, voice: voiceRef(v, t) ?? inherit.voice, rate: SLOW_RATE }, t);
    if (slow) pushCue(out, slow);
  }
}

/**
 * A story entry (AUDIO_PACK §3.2): one sprite per text (`f` on the entry, the
 * line cues carry none), `lines[i]` = the cues of line `i` (an array of rate
 * variants, or one cue object with an optional `slow`; `[]` for a line the
 * render ladder skipped → no cue, the device voice covers it), `whole` = the
 * Radio track (`r: 1` lines edge to edge). The whole track exists ONLY when the
 * index says so: an explicit `whole: null` (a line was skipped, the sprite
 * would jump it) and an absent `whole` alike mean no track — it is never
 * synthesised from the line cues' min / max, so Radio skips the text while its
 * present lines still play by key. The whole track's voice is the first line's;
 * its title is the entry's `title` when present, else the text id.
 */
function storyEntry(out: ParsedIndex, key: string, v: Record<string, unknown>, inherit: Inherit, t: Tables): void {
  const file = fileOf(v, t) ?? inherit.file;
  const voice = voiceRef(v, t) ?? (str(v.narratorVoice) || inherit.voice);
  const rate = num(v.r ?? v.rate, inherit.rate ?? 1) || 1;
  const lines = Array.isArray(v.lines) ? v.lines : [];
  let firstVoice: string | undefined;
  lines.forEach((line, i) => {
    const lineKey = `${key}#L${i}`;
    const variants = Array.isArray(line) ? line : [line];
    for (const x of variants) {
      if (!isObj(x)) continue;
      const cue = cueFrom(lineKey, x, { file, voice, rate }, t);
      if (!cue) continue;
      pushCue(out, cue);
      if (cue.rate === rate) firstVoice ??= cue.voice;
      if (isObj(x.slow)) {
        const slow = cueFrom(lineKey, x.slow, { file, voice: cue.voice || voice, rate: SLOW_RATE }, t);
        if (slow) pushCue(out, slow);
      }
    }
  });
  if (!isObj(v.whole)) return; // `null` or absent: no Radio track (AUDIO_PACK §3.2 runtime rule)
  const whole = cueFrom(key, v.whole, { file, voice: firstVoice ?? voice ?? t.voices[0], rate }, t);
  if (whole) pushCue(out, withTitle(whole, str(v.title) || str(v.titleJa) || key, str(v.titleEn)));
}

function trackRow(out: ParsedIndex, row: unknown, i: number, t: Tables): void {
  if (!isObj(row)) return;
  const file = fileOf(row, t);
  const stem = file ? (file.split('/').pop() ?? '').replace(/-[0-9a-f]{8}\.webm$/i, '').replace(/\.webm$/i, '') : '';
  const name = str(row.name) || str(row.id) || stem || `${i}`;
  const key = str(row.key) || `track:${name}`;
  const cue = cueFrom(key, row, {}, t);
  if (!cue) return;
  const track: KanaTrackCue = withTitle(cue, str(row.title) || str(row.titleJa) || name, str(row.titleEn));
  if (Array.isArray(row.segments)) {
    const segments: { s: number; e: number; text: string; en?: string }[] = [];
    for (const seg of row.segments) {
      if (!isObj(seg)) continue;
      const s = num(seg.s ?? seg.start, NaN);
      const e = num(seg.e ?? seg.end, NaN);
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      const item: { s: number; e: number; text: string; en?: string } = { s, e, text: str(seg.text) };
      const en = str(seg.en);
      if (en) item.en = en;
      segments.push(item);
    }
    track.segments = segments;
  }
  pushCue(out, track);
  out.tracks.push(track);
}

/** The `byText` key of a spoken sentence: `fnv1a32` hex8, as `scripts/audio/indexes.ts textKey` writes it. */
export function byTextKey(spoken: string): string {
  return fnv1a32(spoken).toString(16).padStart(8, '0');
}

/**
 * Tolerant index parse (AUDIO_PACK §3): a `CueIndex` (`cues`), a
 * `StoriesIndex` (`texts` + `misc`), a `TracksIndex` (`tracks`), or a bare map
 * of key → cue(s); compact and verbose cue records alike; `byText` keyed by the
 * hex8 hash of the spoken text (a plain-text key is hashed on the way in).
 */
export function parseIndex(json: unknown): ParsedIndex {
  const out: ParsedIndex = { cues: new Map(), byText: new Map(), tracks: [] };
  const none: Tables = { files: [], voices: [] };
  if (Array.isArray(json)) {
    json.forEach((row, i) => trackRow(out, row, i, none));
    return out;
  }
  if (!isObj(json)) return out;
  const t = tablesOf(json);
  let sawNested = false;
  for (const group of [json.cues, json.clips, json.items, json.texts, json.stories, json.misc]) {
    if (!isObj(group)) continue;
    sawNested = true;
    for (const [key, v] of Object.entries(group)) entryCues(out, key, v, {}, t);
  }
  if (Array.isArray(json.tracks)) {
    sawNested = true;
    json.tracks.forEach((row, i) => trackRow(out, row, i, t));
  }
  if (!sawNested) {
    for (const [key, v] of Object.entries(json)) {
      if (META_KEYS.has(key)) continue;
      entryCues(out, key, v, {}, t);
    }
  }
  if (isObj(json.byText)) {
    for (const [rawKey, v] of Object.entries(json.byText)) {
      const k = HEX8_RE.test(rawKey) ? rawKey : byTextKey(rawKey);
      const keys: string[] = [];
      if (typeof v === 'string') keys.push(v);
      else if (Array.isArray(v)) {
        v.forEach((x, i) => {
          if (typeof x === 'string') keys.push(x);
          else if (isObj(x)) {
            const synth = `text:${k}:${i}`;
            entryCues(out, synth, x, {}, t);
            if (out.cues.has(synth)) keys.push(synth);
          }
        });
      } else if (isObj(v)) {
        const synth = `text:${k}`;
        entryCues(out, synth, v, {}, t);
        if (out.cues.has(synth)) keys.push(synth);
      }
      if (keys.length > 0) {
        const have = out.byText.get(k);
        if (have) {
          for (const x of keys) if (!have.includes(x)) have.push(x);
        } else {
          out.byText.set(k, keys);
        }
      }
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Defaults                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function defaultFetch(): FetchLike | null {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  return typeof f === 'function' ? (url) => f(url) : null;
}

function defaultAudioCtor(): MediaCtor | null {
  const g = globalThis as { Audio?: MediaCtor };
  return typeof g.Audio === 'function' ? g.Audio : null;
}

function defaultCaches(): CacheStorageLike | null {
  const c = (globalThis as { caches?: unknown }).caches;
  return c && typeof (c as CacheStorageLike).open === 'function' ? (c as CacheStorageLike) : null;
}

function defaultRaf(): RafLike | null {
  const g = globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number; cancelAnimationFrame?: (id: number) => void };
  if (typeof g.requestAnimationFrame !== 'function') return null;
  return { request: (cb) => g.requestAnimationFrame!(cb), cancel: (id) => g.cancelAnimationFrame?.(id) };
}

function defaultUrls(): ObjectUrls | null {
  const u = (globalThis as { URL?: { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (s: string) => void } }).URL;
  if (!u || typeof u.createObjectURL !== 'function') return null;
  return { create: (b) => u.createObjectURL!(b), revoke: (s) => u.revokeObjectURL?.(s) };
}

function defaultDoc(): DocLike | null {
  const d = (globalThis as { document?: DocLike }).document;
  return d && typeof d.addEventListener === 'function' ? d : null;
}

function resolveBase(base: string): string {
  let root = base;
  try {
    const g = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
    const href = g.document?.baseURI ?? g.location?.href;
    if (href) root = new URL(base, href).href;
  } catch {
    /* keep the relative base */
  }
  return root.endsWith('/') ? root : `${root}/`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The player                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

interface Slot {
  el: MediaLike;
  file: string | null;
  url: string | null;
  /** The sprite bytes behind `url`, kept so a second live playback of the same sprite can take another element without a fetch. */
  blob: Blob | null;
  /** LRU order: the injected clock, then a sequence number (the default clock stands still). */
  used: number;
  seq: number;
  busy: boolean;
  /** The live playback holding the slot. */
  owner: Playback | null;
}

interface Playback {
  /** Ends the playback with the seconds heard (`source: 'clips'` once started). */
  stop(): void;
  /** The pool was dropped under it: `none` when nothing was heard yet, so the caller falls back. */
  abort(): void;
}

type PoolState = 'none' | 'pending' | 'ok';

/** `NotAllowedError`: the engine did not count the gesture as activation (the DOMException name, or a message naming it). */
function refusedByEngine(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  return e?.name === 'NotAllowedError' || (typeof e?.message === 'string' && e.message.includes('NotAllowedError'));
}

/**
 * The browser's own data saver (design 08 §13; Chrome Android's
 * `navigator.connection.saveData`): true only when the API is present and set,
 * false wherever it is absent, `nav` injectable for tests. The body is the
 * contract-tier one in `shared/audio.ts`, re-exported here so `./data-saver.ts`
 * and the `@/audio` barrel keep one identity; `dataSaverOn()` in
 * `./data-saver.ts` ORs it with the learner's `settings.dataSaver`.
 */
export { saveDataRequested };

/** Prefetch is allowed wherever the browser's data saver is off or the API is absent. */
function defaultPrefetchAllowed(): boolean {
  return !saveDataRequested();
}

const NONE = { source: 'none' as const, seconds: 0 };

export function createClipPlayer(o: ClipPlayerOptions = {}): ClipPlayerEx {
  const fetchImpl = o.fetch === undefined ? defaultFetch() : o.fetch;
  const Ctor = o.audioCtor === undefined ? defaultAudioCtor() : o.audioCtor;
  const cacheStorage = o.caches === undefined ? defaultCaches() : o.caches;
  const raf = o.raf === undefined ? defaultRaf() : o.raf;
  const urls = o.urls === undefined ? defaultUrls() : o.urls;
  const doc = o.doc === undefined ? defaultDoc() : o.doc;
  const now = o.now ?? ((): number => 0);
  const prefetchOk = o.prefetchAllowed ?? defaultPrefetchAllowed;
  const poolSize = Math.max(1, Math.floor(o.poolSize ?? POOL_SIZE));
  const prefetchBudget = o.prefetchBudgetBytes ?? PREFETCH_BUDGET_BYTES;
  const root = resolveBase(o.base ?? './');

  const ready: Signal<ClipReady> = signal<ClipReady>('unknown');
  const info: Signal<AudioPackInfo | null> = signal<AudioPackInfo | null>(null);

  let manifest: PackManifest | null = null;
  let disposed = false;
  let pool: PoolState = 'none';
  /** Bumped per pool build, so a late rejection from a dropped pool never touches the next one. */
  let poolGen = 0;
  const slots: Slot[] = [];
  let silentUrl: string | null = null;
  const cues = new Map<string, ClipCue[]>();
  const byText = new Map<string, string[]>();
  const tracks: KanaTrackCue[] = [];
  const inflight = new Map<string, Promise<Blob | null>>();
  const levelLoads = new Map<Level, Promise<void>>();
  const stationLoads = new Map<number, Promise<void>>();
  let tracksLoad: Promise<KanaTrackCue[]> | null = null;
  const prefetching = new Set<number>();
  const live = new Set<Playback>();
  let seq = 0;
  const touch = (s: Slot): void => {
    s.used = now();
    s.seq = ++seq;
  };
  const older = (a: Slot, b: Slot): boolean => a.used < b.used || (a.used === b.used && a.seq < b.seq);

  const urlOf = (path: string): string => root + path.replace(/^\.?\//, '');
  const relOf = (url: string): string => {
    const clean = url.split('#')[0]!.split('?')[0]!;
    return clean.startsWith(root) ? clean.slice(root.length) : clean;
  };

  /* ── readiness ──────────────────────────────────────────────────────── */

  let settleReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    settleReady = resolve;
  });

  const supportsOpus = (): boolean => {
    try {
      if (o.canPlay) return o.canPlay(OPUS_PROBE_TYPE) !== '';
      if (!Ctor) return false;
      const probe = new Ctor();
      return typeof probe.canPlayType === 'function' ? probe.canPlayType(OPUS_PROBE_TYPE) !== '' : false;
    } catch {
      return false;
    }
  };

  const absent = (): void => {
    ready.value = 'absent';
    settleReady();
    if (pool !== 'none') dropPool(); // no pack: six idle elements have nothing to play
  };

  const init = async (): Promise<void> => {
    try {
      if (!fetchImpl || !Ctor || !supportsOpus()) {
        absent();
        return;
      }
      ready.value = 'loading';
      const res = await fetchImpl(urlOf(`${AUDIO_ROOT}manifest.json`));
      if (!res || !res.ok) {
        absent();
        return;
      }
      const parsed = parseManifest(await res.json());
      if (!parsed || disposed) {
        absent();
        return;
      }
      manifest = parsed;
      info.value = parsed.info;
      ready.value = 'ready';
      settleReady();
      void prune();
    } catch {
      absent();
    }
  };
  void init();

  /* ── cache ──────────────────────────────────────────────────────────── */

  let cacheOpen: Promise<CacheLike | null> | null = null;
  const openCache = (): Promise<CacheLike | null> => {
    if (!cacheStorage) return Promise.resolve(null);
    if (!cacheOpen) {
      cacheOpen = cacheStorage.open(AUDIO_CACHE).catch(() => null);
    }
    return cacheOpen;
  };

  const cachedResponse = async (url: string): Promise<Response | undefined> => {
    try {
      const cache = await openCache();
      return cache ? await cache.match(url) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Fetches a sprite into the cache (used by prefetch and download only); true when it is cached afterwards. */
  const fetchIntoCache = async (path: string): Promise<boolean> => {
    if (!fetchImpl) return false;
    const url = urlOf(path);
    try {
      const cache = await openCache();
      if (!cache) return false;
      if (await cache.match(url)) return true;
      const res = await fetchImpl(url);
      if (!res || !res.ok) return false;
      await cache.put(url, res);
      return true;
    } catch {
      return false;
    }
  };

  const prune = async (): Promise<number> => {
    if (!manifest || manifest.paths.size === 0) return 0;
    const cache = await openCache();
    if (!cache) return 0;
    let removed = 0;
    try {
      const keys = await cache.keys();
      const version = `${AUDIO_ROOT}${manifest.info.audioVersion}/`;
      for (const k of keys) {
        const rel = relOf(k.url);
        const stale =
          (rel.startsWith(`${AUDIO_ROOT}sprites/`) && !manifest.paths.has(rel)) ||
          (rel.startsWith(AUDIO_ROOT) && rel.endsWith('.json') && rel !== `${AUDIO_ROOT}manifest.json` && !rel.startsWith(version) && !rel.startsWith(`${AUDIO_ROOT}sprites/`));
        if (stale && (await cache.delete(k.url))) removed++;
      }
    } catch {
      /* best effort */
    }
    return removed;
  };

  /* ── sprites ────────────────────────────────────────────────────────── */

  const spriteBlob = (file: string): Promise<Blob | null> => {
    const path = spritePath(file);
    const pending = inflight.get(path);
    if (pending) return pending;
    const p = (async (): Promise<Blob | null> => {
      const url = urlOf(path);
      try {
        let buf: ArrayBuffer | null = null;
        const hit = await cachedResponse(url);
        if (hit) buf = await hit.arrayBuffer();
        else if (fetchImpl) {
          const res = await fetchImpl(url);
          if (!res || !res.ok) return null;
          buf = await res.arrayBuffer();
        }
        return buf ? new Blob([buf], { type: OPUS_BLOB_TYPE }) : null;
      } catch {
        return null;
      } finally {
        inflight.delete(path);
      }
    })();
    inflight.set(path, p);
    return p;
  };

  /* ── pool ───────────────────────────────────────────────────────────── */

  /** Drops the pool (a refused gesture, an absent pack, dispose): live playbacks end, URLs are revoked, the next `unlock()` rebuilds. */
  const dropPool = (): void => {
    pool = 'none';
    for (const p of Array.from(live)) p.abort();
    live.clear();
    for (const s of slots) {
      try {
        s.el.pause();
      } catch {
        /* ignore */
      }
      if (s.url && urls) {
        try {
          urls.revoke(s.url);
        } catch {
          /* ignore */
        }
      }
      s.url = null;
      s.file = null;
      s.blob = null;
      s.owner = null;
    }
    slots.length = 0;
    if (silentUrl && urls) {
      try {
        urls.revoke(silentUrl);
      } catch {
        /* ignore */
      }
    }
    silentUrl = null;
  };

  const unlock = (): void => {
    if (pool !== 'none' || disposed || !Ctor || !urls || ready.value === 'absent') return;
    pool = 'pending';
    const gen = ++poolGen;
    try {
      const bytes = silentOpusBytes();
      silentUrl = urls.create(new Blob([bytes], { type: OPUS_BLOB_TYPE }));
    } catch {
      silentUrl = null;
    }
    const accepted = (): void => {
      if (gen === poolGen && pool === 'pending') pool = 'ok';
    };
    const rejected = (err: unknown): void => {
      // The gesture did not count (a touch's pointerdown on WebKit): drop the pool so the next gesture rebuilds it.
      if (gen === poolGen && pool === 'pending' && refusedByEngine(err)) dropPool();
    };
    for (let i = 0; i < poolSize; i++) {
      let el: MediaLike;
      try {
        el = new Ctor();
      } catch {
        break;
      }
      try {
        el.preservesPitch = true;
        el.webkitPreservesPitch = true;
        el.volume = 0;
        if (silentUrl) el.src = silentUrl;
        const p = el.play();
        if (p && typeof (p as Promise<void>).then === 'function') {
          (p as Promise<void>).then(() => {
            el.pause();
            accepted();
          }, rejected);
        } else {
          el.pause();
          accepted();
        }
      } catch {
        /* an element that refuses the silent clip still joins the pool */
      }
      slots.push({ el, file: null, url: null, blob: null, used: now(), seq: ++seq, busy: false, owner: null });
    }
  };

  /**
   * The element for `file`: the free slot already holding it, else the least
   * recently used free slot loaded from `blob` — or, when another live playback
   * holds the sprite, from the bytes that slot keeps (never a shared element).
   * With every slot busy the least recently used playback is stopped first.
   */
  const slotFor = (file: string, blob: Blob | null): Slot | null => {
    const path = spritePath(file);
    const free = slots.find((s) => s.file === path && !s.busy);
    if (free) {
      touch(free);
      return free;
    }
    const bytes = blob ?? slots.find((s) => s.file === path)?.blob ?? null;
    if (!bytes || !urls) return null;
    let victim: Slot | null = null;
    for (const s of slots) {
      if (s.busy) continue;
      if (!victim || older(s, victim)) victim = s;
    }
    if (!victim) {
      for (const s of slots) if (!victim || older(s, victim)) victim = s;
      victim?.owner?.stop(); // ends that playback with the seconds it heard; the slot is free afterwards
    }
    if (!victim) return null;
    if (victim.url) {
      try {
        urls.revoke(victim.url);
      } catch {
        /* ignore */
      }
    }
    victim.blob = bytes;
    victim.url = urls.create(bytes);
    victim.file = path;
    touch(victim);
    victim.el.src = victim.url;
    return victim;
  };

  /* ── playback ───────────────────────────────────────────────────────── */

  const play = (cue: ClipCue, opt: ClipPlayOptions): ClipPlaybackEx => {
    if (pool === 'none' || disposed || !urls) {
      return {
        done: Promise.resolve(NONE),
        stop() {},
        pause() {},
        resume() {},
        position: () => 0,
        playing: () => false,
      };
    }
    let resolveDone: (r: { source: 'clips' | 'none'; seconds: number }) => void = () => undefined;
    const done = new Promise<{ source: 'clips' | 'none'; seconds: number }>((resolve) => {
      resolveDone = resolve;
    });
    const [startS, endS] = clauseRange(cue, opt.clause);
    const nativeRate = cue.rate || 1;
    const rate = Math.max(0.25, Math.min(4, (opt.rate || 1) / nativeRate));
    let slot: Slot | null = null;
    let settled = false;
    let stopped = false;
    let started = false;
    let played = 0;
    let lastT: number | null = null;
    let backstop: ReturnType<typeof setTimeout> | null = null;
    let fineStop: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    /** `currentTime` when the backstop was last armed: no progress since → the element stalled, finish. */
    let backstopT = 0;

    /** Media seconds: every positive `currentTime` delta since the last reference (a hidden stretch arrives as one delta and counts whole). */
    const reconcile = (): void => {
      if (!slot) return;
      const t = slot.el.currentTime;
      if (lastT !== null && t > lastT) played += t - lastT;
      lastT = t;
      if (started && !settled) opt.onPlayed?.(played);
    };
    /** A programmatic seek moves the reference without counting the jump. */
    const onSeeking = (): void => {
      if (slot) lastT = slot.el.currentTime;
    };

    const clearTimers = (): void => {
      if (backstop) clearTimeout(backstop);
      backstop = null;
      if (fineStop) clearTimeout(fineStop);
      fineStop = null;
      if (rafId !== null && raf) raf.cancel(rafId);
      rafId = null;
    };

    const onTimeUpdate = (): void => {
      reconcile();
      if (opt.wholeTrack || !slot) return;
      const t = slot.el.currentTime;
      if (t >= endS - END_EPSILON_S) {
        finish('clips');
        return;
      }
      // Foreground precision: a one-shot for the last stretch; `timeupdate` still owns the stop in the background.
      const remainingMs = ((endS - t) / (slot.el.playbackRate || rate)) * 1000;
      if (remainingMs < 400 && !fineStop) {
        fineStop = setTimeout(() => {
          fineStop = null;
          if (!settled && slot && slot.el.currentTime >= endS - END_EPSILON_S - 0.05) finish('clips');
        }, Math.max(0, remainingMs));
      }
    };
    const onEnded = (): void => {
      reconcile();
      finish('clips');
    };
    const onPause = (): void => {
      reconcile();
    };
    const onError = (): void => {
      finish(started && played > 0 ? 'clips' : 'none');
    };
    const onVisibility = (): void => {
      reconcile();
    };

    const detach = (): void => {
      if (slot) {
        slot.el.removeEventListener('timeupdate', onTimeUpdate);
        slot.el.removeEventListener('ended', onEnded);
        slot.el.removeEventListener('pause', onPause);
        slot.el.removeEventListener('seeking', onSeeking);
        slot.el.removeEventListener('error', onError);
      }
      doc?.removeEventListener('visibilitychange', onVisibility);
    };

    const finish = (source: 'clips' | 'none'): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      detach();
      if (slot) {
        try {
          if (!slot.el.paused) slot.el.pause();
        } catch {
          /* ignore */
        }
        slot.busy = false;
        if (slot.owner === rec) slot.owner = null;
      }
      live.delete(rec);
      const seconds = Math.round(played * 1000) / 1000;
      if (started) opt.onPlayed?.(seconds);
      resolveDone(source === 'clips' ? { source, seconds } : { source: 'none', seconds: 0 });
    };

    const armBackstop = (): void => {
      if (opt.wholeTrack || !slot) return;
      const t = slot.el.currentTime;
      backstopT = t;
      const remainingMs = Math.max(0, ((endS - t) / (slot.el.playbackRate || rate)) * 1000);
      backstop = setTimeout(() => {
        backstop = null;
        if (settled || !slot) return;
        reconcile();
        const at = slot.el.currentTime;
        // Still moving and short of the end (a buffering stall caught up late): wait for the rest; otherwise stop.
        if (slot.el.paused || at >= endS - 0.25 || at <= backstopT) finish('clips');
        else armBackstop();
      }, remainingMs + STOP_BACKSTOP_MS);
    };

    const tick = (): void => {
      rafId = null;
      if (settled || !slot || !opt.onProgress) return;
      if (!doc?.hidden) {
        const t = Math.max(0, slot.el.currentTime - cue.start);
        const { mora, clause } = karaokeAt(cue, t);
        try {
          opt.onProgress(t, mora, clause);
        } catch {
          /* a karaoke bug never stops the audio */
        }
      }
      if (raf) rafId = raf.request(tick);
    };

    /** `pause()` arrived before the element was ready: it is set up silent and `resume()` starts it. */
    let wantPaused = false;

    /**
     * A `play()` promise rejected before anything was heard. Our own `pause()` rejects a pending `play()` with an
     * `AbortError` (HTML spec: "interrupted by a call to pause()") — the clip is paused, not failed, and `resume()`
     * plays it. Anything else (`NotAllowedError`, a decode failure) is a start that never happened → 'none'.
     */
    const onPlayRejected = (err: unknown): void => {
      if (settled || played > 0) return;
      if (wantPaused || (err as { name?: unknown } | null)?.name === 'AbortError') return;
      finish('none');
    };
    const watchPlay = (p: Promise<void> | void): void => {
      if (p && typeof (p as Promise<void>).then === 'function') (p as Promise<void>).catch(onPlayRejected);
    };

    /** Starts the element (the first play, or the deferred one after a pause-before-start) and arms the timers. */
    const begin = (): void => {
      if (!slot || settled || started) return;
      const el = slot.el;
      lastT = el.currentTime;
      let p: Promise<void> | void;
      try {
        p = el.play();
      } catch {
        finish('none');
        return;
      }
      started = true;
      watchPlay(p);
      armBackstop();
      if (opt.onProgress && raf && rafId === null) rafId = raf.request(tick);
    };

    const handle: ClipPlaybackEx = {
      done,
      stop() {
        stopped = true;
        if (!started) finish('none');
        else {
          reconcile();
          finish('clips');
        }
      },
      pause() {
        if (settled) return;
        wantPaused = true;
        if (!slot || !started) return; // the sprite is still arriving: `begin()` waits for resume()
        // A paused clip is not a stalled one: the stop backstop waits for resume(); so does the karaoke sweep.
        if (backstop) clearTimeout(backstop);
        backstop = null;
        if (fineStop) clearTimeout(fineStop);
        fineStop = null;
        if (rafId !== null && raf) raf.cancel(rafId);
        rafId = null;
        try {
          slot.el.pause();
        } catch {
          /* ignore */
        }
        reconcile();
      },
      resume() {
        if (settled) return;
        wantPaused = false;
        if (!slot) return;
        if (!started) {
          begin();
          return;
        }
        // Continues from the media position the pause left: the reference moves, no second is counted twice.
        lastT = slot.el.currentTime;
        try {
          watchPlay(slot.el.play());
        } catch {
          /* ignore */
        }
        if (!backstop) armBackstop();
        if (opt.onProgress && raf && rafId === null) rafId = raf.request(tick);
      },
      // The seconds `reconcile()` would report right now, without the `onPlayed` side effect (a read, not an event).
      position: () => {
        if (!slot) return 0;
        const t = slot.el.currentTime;
        const pending = lastT !== null && t > lastT ? t - lastT : 0;
        return Math.round((played + pending) * 1000) / 1000;
      },
      playing: () => started && !settled,
    };
    const rec: Playback = {
      stop: () => handle.stop(),
      abort: () => finish(started && played > 0 ? 'clips' : 'none'),
    };
    live.add(rec);

    void (async (): Promise<void> => {
      // Bytes already in the pool (a free or a busy slot) need no fetch; `slotFor` re-wraps a busy slot's bytes onto a free element.
      const held = slots.some((s) => s.file === spritePath(cue.file));
      const blob = held ? null : await spriteBlob(cue.file);
      if (stopped || settled || disposed) {
        finish('none');
        return;
      }
      slot = slotFor(cue.file, blob);
      if (!slot) {
        finish('none');
        return;
      }
      slot.busy = true;
      slot.owner = rec;
      touch(slot);
      const el = slot.el;
      try {
        el.preservesPitch = true;
        el.webkitPreservesPitch = true;
        el.playbackRate = rate;
        el.volume = Math.max(0, Math.min(1, Number.isFinite(opt.volume) ? opt.volume : 1));
        el.currentTime = startS;
      } catch {
        finish('none');
        return;
      }
      lastT = startS;
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('ended', onEnded);
      el.addEventListener('pause', onPause);
      el.addEventListener('seeking', onSeeking);
      el.addEventListener('error', onError);
      doc?.addEventListener('visibilitychange', onVisibility);
      // A pause() that landed while the sprite was arriving leaves the element set up and silent until resume().
      if (!wantPaused) begin();
    })();

    return handle;
  };

  /* ── indexes ────────────────────────────────────────────────────────── */

  const fetchIndex = async (path: string): Promise<unknown | null> => {
    if (!fetchImpl) return null;
    // The manifest lists the index files that exist (AUDIO_PACK §4): a listed set spares the 404s.
    if (manifest && manifest.indexPaths.size > 0 && !manifest.indexPaths.has(path)) return null;
    try {
      const res = await fetchImpl(urlOf(path));
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const absorb = (parsed: ParsedIndex): void => {
    for (const [key, list] of parsed.cues) {
      const have = cues.get(key);
      if (!have) cues.set(key, list.slice());
      else for (const c of list) if (!have.some((h) => h.file === c.file && h.start === c.start && h.rate === c.rate)) have.push(c);
    }
    for (const [text, keys] of parsed.byText) {
      const have = byText.get(text);
      if (!have) byText.set(text, keys.slice());
      else for (const k of keys) if (!have.includes(k)) have.push(k);
    }
    if (parsed.tracks.length > 0) {
      const seen = new Set(tracks.map((t) => t.key));
      for (const t of parsed.tracks) if (!seen.has(t.key)) tracks.push(t);
    }
  };

  const loadLevel = (level: Level): Promise<void> => {
    const pending = levelLoads.get(level);
    if (pending) return pending;
    const p = (async (): Promise<void> => {
      await readyPromise;
      if (!manifest || disposed) return;
      const v = manifest.info.audioVersion;
      const files = ['words', 'sentences', 'ear'].map((n) => `${AUDIO_ROOT}${v}/${level}/${n}.json`);
      const results = await Promise.all(files.map((f) => fetchIndex(f)));
      for (const json of results) if (json !== null) absorb(parseIndex(json));
    })().catch(() => undefined);
    levelLoads.set(level, p);
    return p;
  };

  const loadStation = (n: number): Promise<void> => {
    const station = Math.floor(n);
    const pending = stationLoads.get(station);
    if (pending) return pending;
    const p = (async (): Promise<void> => {
      await readyPromise;
      if (!manifest || disposed) return;
      const v = manifest.info.audioVersion;
      const level = loadLevel(levelOfStation(station));
      if (station >= 1) {
        const json = await fetchIndex(`${AUDIO_ROOT}${v}/s${String(station).padStart(2, '0')}/stories.json`);
        if (json !== null) absorb(parseIndex(json));
      }
      await level;
    })().catch(() => undefined);
    stationLoads.set(station, p);
    return p;
  };

  const kanaTracks = (): Promise<KanaTrackCue[]> => {
    if (tracksLoad) return tracksLoad;
    tracksLoad = (async (): Promise<KanaTrackCue[]> => {
      await readyPromise;
      if (!manifest || disposed) return [];
      const json = await fetchIndex(`${AUDIO_ROOT}${manifest.info.audioVersion}/kana/tracks.json`);
      if (json !== null) absorb(parseIndex(json));
      return tracks.slice();
    })().catch(() => [] as KanaTrackCue[]);
    return tracksLoad;
  };

  /** On a `cueFor` miss: kick off the load that would hold the key, so the next call hits. */
  const ensureLoadedFor = (key: string): void => {
    if (ready.value !== 'ready') return;
    if (key.startsWith('track:')) {
      void kanaTracks();
      return;
    }
    const id = key.split('#')[0] ?? key;
    const station = stationOfId(id);
    if (station !== undefined) {
      void loadStation(station);
      return;
    }
    const level = levelOfId(id);
    if (level) void loadLevel(level);
  };

  /* ── cues ───────────────────────────────────────────────────────────── */

  const pick = (variants: ClipCue[] | undefined, o?: { rate?: number; speaker?: string }): ClipCue | undefined => {
    if (!variants || variants.length === 0) return undefined;
    let pool = variants;
    if (o?.speaker && manifest) {
      const want = manifest.speakerVoice.get(o.speaker);
      if (want) {
        const matching = variants.filter((c) => voiceMatches(c.voice, want));
        if (matching.length > 0) pool = matching;
      }
    }
    return nearestRate(pool, o?.rate ?? 1);
  };

  const cueFor = (key: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined => {
    const variants = cues.get(key);
    if (!variants) {
      ensureLoadedFor(key);
      return undefined;
    }
    return pick(variants, o);
  };

  const cueForText = (text: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined => {
    const spoken = textToSpeak(text);
    if (!isSentenceText(spoken)) return undefined;
    // The index hashes exactly `textToSpeak(toPlain(ja))`; the whitespace-free form is a second chance for a caller's spacing.
    const keys = byText.get(byTextKey(spoken)) ?? byText.get(byTextKey(spoken.replace(WS_RE, '')));
    if (!keys || keys.length === 0) return undefined;
    const variants: ClipCue[] = [];
    for (const k of keys) for (const c of cues.get(k) ?? []) variants.push(c);
    return pick(variants, o);
  };

  /* ── prefetch / download ────────────────────────────────────────────── */

  const stationFiles = (n: number): PackFile[] => {
    if (!manifest) return [];
    const prefix = `${AUDIO_ROOT}sprites/s${String(n).padStart(2, '0')}/`;
    const rows = manifest.files.filter((f) => f.path.startsWith(prefix));
    if (rows.length > 0) {
      // Story sprites first (Radio, Arena, Read-along), then words, grammar, examples, misc.
      const rank = (p: string): number => {
        const name = p.slice(prefix.length);
        if (/^s-\d{2}-\d/.test(name)) return 0;
        if (name.startsWith('words-')) return 1;
        if (name.startsWith('grammar-')) return 2;
        if (name.startsWith('examples-')) return 3;
        return 4;
      };
      return rows.slice().sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
    }
    // No file list: the sprites the loaded cues of this station reference.
    const seen = new Set<string>();
    const out: PackFile[] = [];
    for (const [key, list] of cues) {
      if (stationOfId(key.split('#')[0] ?? key) !== n) continue;
      for (const c of list) {
        if (seen.has(c.file)) continue;
        seen.add(c.file);
        out.push({ path: c.file, bytes: 0, seconds: 0, clips: 0, belt: beltOfPath(c.file) });
      }
    }
    return out;
  };

  const prefetchStation = (n: number): void => {
    const station = Math.max(1, Math.floor(n));
    if (disposed || prefetching.has(station)) return;
    let allowed = true;
    try {
      allowed = prefetchOk();
    } catch {
      allowed = true;
    }
    if (!allowed) {
      // Data saver (design 08 §13): the small indexes still load so the first speak() hits; no sprite is stored.
      void loadStation(station);
      return;
    }
    prefetching.add(station);
    void (async (): Promise<void> => {
      try {
        await loadStation(station);
        if (disposed || !manifest) return;
        let spent = 0;
        for (const f of stationFiles(station)) {
          const cost = f.bytes > 0 ? f.bytes : 512 * 1024;
          if (spent + cost > prefetchBudget && spent > 0) break;
          if (disposed) return;
          if (await fetchIntoCache(f.path)) spent += cost;
          if (spent >= prefetchBudget) break;
        }
      } catch {
        /* idle work never surfaces */
      }
    })();
  };

  const beltFiles = (belt: Belt): PackFile[] => (manifest ? manifest.files.filter((f) => f.belt === belt) : []);

  const download = async (belt: Belt, onProgress?: (doneBytes: number, totalBytes: number) => void): Promise<void> => {
    await readyPromise;
    if (!manifest) return;
    if (!(await openCache())) throw new Error(CACHE_UNAVAILABLE); // nothing could be kept: Settings must not show a finished download
    const files = beltFiles(belt);
    const total = files.reduce((s, f) => s + f.bytes, 0);
    let doneBytes = 0;
    let failed = 0;
    onProgress?.(0, total);
    for (const f of files) {
      if (disposed) return;
      if (await fetchIntoCache(f.path)) doneBytes += f.bytes;
      else failed++;
      onProgress?.(doneBytes, total);
    }
    if (failed > 0) throw new Error(`audio download incomplete: ${failed} of ${files.length} files`);
  };

  const remove = async (belt: Belt): Promise<void> => {
    await readyPromise;
    if (!manifest) return;
    const cache = await openCache();
    if (!cache) return;
    for (const f of beltFiles(belt)) {
      try {
        await cache.delete(urlOf(f.path));
      } catch {
        /* ignore */
      }
    }
  };

  const cacheUsage = async (): Promise<{ bytes: number; files: number }> => {
    const cache = await openCache();
    if (!cache) return { bytes: 0, files: 0 };
    let bytes = 0;
    let files = 0;
    try {
      for (const k of await cache.keys()) {
        const rel = relOf(k.url);
        if (!rel.startsWith(AUDIO_ROOT)) continue;
        files++;
        const known = manifest?.bytesByPath.get(rel);
        if (known !== undefined && known > 0) {
          bytes += known;
          continue;
        }
        const res = await cache.match(k.url);
        if (!res) continue;
        const len = Number(res.headers?.get?.('content-length') ?? NaN);
        if (Number.isFinite(len) && len > 0) bytes += len;
        else bytes += (await res.blob()).size;
      }
    } catch {
      /* partial figure is better than none */
    }
    return { bytes, files };
  };

  /* ── lifecycle ──────────────────────────────────────────────────────── */

  const dispose = (): void => {
    disposed = true;
    for (const p of Array.from(live)) p.stop();
    dropPool();
    settleReady();
  };

  return {
    ready,
    info,
    loadLevel,
    loadStation,
    prefetchStation,
    cueFor,
    cueForText,
    kanaTracks,
    play,
    unlock,
    dispose,
    cacheUsage,
    download,
    remove,
    prune,
    unlocked: () => pool === 'ok',
    indexedKeys: () => cues.size,
    rootUrl: () => root,
  };
}
