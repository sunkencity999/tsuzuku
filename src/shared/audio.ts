/**
 * TSUZUKU — audio / speech service slot (ARCHITECTURE §3, design 07 §7).
 *
 * Interfaces plus the silent `nullAudio` / `nullStt`. Group F installs the
 * real implementations with `installServices()`; everyone else calls
 * `services.audio.speak(...)` (or the `speak` helper) and never touches
 * `speechSynthesis` directly.
 *
 * `speak(text, {kana?})` takes the PLAIN surface (`toPlain(ja)`) for sentences
 * and kana only for kana items. It resolves on `onend`, `onerror` or a timeout
 * of the estimated duration + 2 s, so an awaited `speak()` can never hang.
 */
import { signal, type Signal } from '@preact/signals';
import type { Belt, Level } from '../content/types';
import type { SfxName } from './catalog';

export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
  /** Sends text to the vendor's servers (marked in the picker, design 06 §7 #10). */
  network: boolean;
}

export type SpeedTier = 1 | 2 | 3 | 4 | 5;

/** Speed-tier presets (design 07 §7); Shinsa uses these only. */
export const SPEED_TIER_RATES: Record<SpeedTier, number> = { 1: 0.75, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.25 };
/** Dan-road listening rate. */
export const DAN_RATE = 1.5;

/**
 * Where the last `speak()` came from (design 08 §8): a pre-rendered pack clip,
 * the device's `speechSynthesis`, or nothing (no voice, volume 0, text only).
 * Status chips read this together with `voiceAudible()`.
 */
export type AudioSource = 'clips' | 'synth' | 'none';

/**
 * One clip inside a pack sprite (design 08 §8). `key` is the clip key
 * (`<itemId>`, `<itemId>#ex<k>`, `<storyId>#L<i>`, `<itemId>#def`,
 * `<itemId>#col<k>`, `<itemId>#ga`, `<itemId>#pair`; `<storyId>` alone is the
 * whole-text track of a story sprite and `track:<name>` a kana track of
 * `kana/tracks.json`, both for Radio); `file` the sprite path;
 * `start` / `end` seconds inside it; `voice` the VOICEVOX character credit;
 * `rate` the native speed the clip was rendered at (0.85 for a natural-slow
 * take, 1 otherwise). `morae` are cumulative mora boundaries in ms and
 * `clauses` clause boundaries as mora indexes (karaoke and clause dictation,
 * §9); `pitchVerified` says the accent matched the dictionary pitch (§7).
 */
export interface ClipCue {
  key: string;
  file: string;
  start: number;
  end: number;
  voice: string;
  rate: number;
  morae?: number[];
  clauses?: number[];
  pitchVerified?: boolean;
}

export interface SpeakOptions {
  /** Kana reading; used when the voice would misread the plain surface. */
  kana?: string;
  /** Playback rate (default: the current speed tier's preset). */
  rate?: number;
  /** Dialogue voice slot. */
  voice?: 'a' | 'b';
  /** Explicit voice override. */
  voiceURI?: string;
  /** Cancel anything queued first (default true). */
  interrupt?: boolean;
  /**
   * Clip key (design 08 §8): `<itemId>` for a word or kana, `<itemId>#ex<k>`
   * for an example, `<storyId>#L<i>` for a line, `#def` / `#col<k>` / `#ga`.
   * Every caller that holds the item passes it; the pack resolves it to a cue
   * and falls back to the device voice when it misses. Text lookup is a
   * fallback for sentences only, never for bare words (kana homophones).
   */
  clip?: string;
  /**
   * The line's `speaker` label or the text's `narrator` (design 08 §8): the
   * pack resolves it to the cast voice; the synth path keeps `voice: 'a' | 'b'`.
   */
  speaker?: string;
  /**
   * Karaoke progress on the clip path only (design 08 §9): `t` seconds into
   * the clip, the active mora index and clause index. Never fires on synth.
   */
  onProgress?: (t: number, mora: number, clause: number) => void;
  /** Play one clause of the clip, `[fromMora, toMora)` over `ClipCue.clauses` (design 08 §9 clause dictation). */
  clause?: [number, number];
}

/**
 * Pack load state (design 08 §8): `absent` when `./audio/manifest.json` is
 * missing (no pack in this build) or Opus/WebM cannot play here.
 */
export type ClipReady = 'unknown' | 'loading' | 'ready' | 'absent';

/** Options of `ClipPlayer.play()` (design 08 §8). */
export interface ClipPlayOptions {
  /** Requested rate; the player sets `playbackRate = rate / cue.rate` with pitch preserved. */
  rate: number;
  /** Element volume 0–1 (the master volume). */
  volume: number;
  /** Play one clause `[fromMora, toMora)` over `cue.clauses` (design 08 §9). */
  clause?: [number, number];
  /**
   * Whole-text Radio track: no stop timer, the sprite plays edge to edge and
   * `ended` finishes it, so playback survives the screen turning off.
   */
  wholeTrack?: boolean;
  /** Karaoke progress, driven by requestAnimationFrame (foreground only). */
  onProgress?: (t: number, mora: number, clause: number) => void;
  /**
   * Seconds actually played so far, accumulated from `timeupdate` deltas
   * (fires with the screen off); the final figure also arrives in `done`.
   */
  onPlayed?: (seconds: number) => void;
}

export interface ClipPlayback {
  done: Promise<{ source: 'clips' | 'none'; seconds: number }>;
  stop(): void;
  /**
   * In-place pause / resume of a whole-track playback (design 08 §10.2: a
   * paused Radio track picks up where it stopped instead of restarting).
   * Optional so test doubles keep compiling; a surface calls `pause?.()` and
   * falls back to `stop()` + replay when absent. `position()` is the media
   * seconds played so far (the same unit as `done.seconds`).
   */
  pause?(): void;
  resume?(): void;
  position?(): number;
}

/** One belt's share of the pack as the manifest reports it (design 08 §13). */
export interface AudioPackBelt {
  bytes: number;
  seconds: number;
  files: number;
}

/** Runtime summary of `public/audio/manifest.json` (`tsuzuku.audio/1`, design 08 §7). */
export interface AudioPackInfo {
  audioVersion: string;
  contentVersion: string;
  engine: string;
  belts: Partial<Record<Belt, AudioPackBelt>>;
  totals: AudioPackBelt;
  /** `VOICEVOX:<character>` credit strings, one per voice used (design 08 §6). */
  credits: string[];
}

/** A whole-track cue (kana track or whole text) with the title the Radio player and Media Session show. */
export interface TrackCue extends ClipCue {
  title: string;
  titleEn?: string;
}

/**
 * The pre-rendered voice pack player (design 08 §8; implemented in
 * `src/audio/clips.ts`, installed by Group F and reachable as
 * `services.audio.clips`). `speak()` resolves clips through it; Radio plays
 * whole-text tracks through `play()`; Settings reads `info` / `cacheUsage()`
 * and drives `download()` / `remove()`; About lists `info.credits`.
 */
export interface ClipPlayer {
  ready: Signal<ClipReady>;
  /** The manifest summary once `ready` is `'ready'`, else `null`. */
  info: Signal<AudioPackInfo | null>;
  loadLevel(level: Level): Promise<void>;
  loadStation(n: number): Promise<void>;
  /** Idle prefetch of the station's sprites into the audio cache (skipped under data saver). */
  prefetchStation(n: number): void;
  /** Cue for a clip key at the nearest native rate to `o.rate`; `undefined` when the pack misses. */
  cueFor(key: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined;
  /** Text fallback for SENTENCES only (`byText`, design 08 §8); never for bare words. */
  cueForText(text: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined;
  /** Kana tracks of `kana/tracks.json` (design 08 §10.5), loaded on demand; `[]` without a pack. */
  kanaTracks(): Promise<TrackCue[]>;
  play(cue: ClipCue, o: ClipPlayOptions): ClipPlayback;
  /** First-gesture unlock: builds the fixed pool of media elements once; before it `play()` resolves `source: 'none'`. */
  unlock(): void;
  dispose(): void;
  cacheUsage(): Promise<{ bytes: number; files: number }>;
  download(belt: Belt, onProgress?: (doneBytes: number, totalBytes: number) => void): Promise<void>;
  remove(belt: Belt): Promise<void>;
}

export interface AudioService {
  speak(text: string, o?: SpeakOptions): Promise<void>;
  cancel(): void;
  /** Warm-up utterance on first gesture (Chrome first-utterance delay). */
  warmUp(): void;
  sfx(name: SfxName): void;
  /** 0–1. */
  setVolume(v: number): void;
  muted: Signal<boolean>;
  hasJaVoice: Signal<boolean>;
  /**
   * `speak()` will actually be heard: a Japanese voice exists AND the master
   * volume is above 0. Set by the web service; `voiceAudible(audio)` (below;
   * `@/audio` re-exports it) falls back to `hasJaVoice` when it is absent. Deliberately
   * NOT set on `nullAudio`, so a test double `{ ...nullAudio, hasJaVoice:
   * signal(true) }` stays audible. Text fallbacks gate on this, not on
   * `hasJaVoice` (which only reports voice availability).
   */
  canSpeak?: Signal<boolean>;
  voices(): VoiceInfo[];
  rateForTier(t: SpeedTier): number;
  /**
   * Source of the most recent `speak()` (design 08 §8); before any `speak()`
   * it holds the source the next call would use (the idle default), so a chip
   * can be honest before anything is spoken. Optional like `canSpeak`, so
   * `{ ...nullAudio }` doubles keep compiling; read it through
   * `audioSourceOf()` below, which falls back to `voiceAudible()`.
   */
  source?: Signal<AudioSource>;
  /** The pack cue a clip key resolves to right now (nearest native rate), or `undefined` when the pack misses (design 08 §8). */
  clipFor?(key: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined;
  /**
   * The voice pack is loaded and playable (design 08 §8). Optional.
   * `canSpeak = (hasJaVoice || (packReady && settings.audioSource !== 'device')) && audible`:
   * a learner who chose the device voice is not told a silent pack can speak.
   */
  packReady?: Signal<boolean>;
  /**
   * The installed pack player (design 08 §8) for the surfaces that need more
   * than `speak()`: Radio (whole-track playback, kana tracks), Settings (pack
   * sizes, cache usage, belt downloads) and About (credits). Optional like
   * `canSpeak`; absent on `nullAudio` and on a build without a pack.
   */
  clips?: ClipPlayer;
}

export interface SttResult {
  /** Up to 5 alternatives, kanji-kana mixed as the recognizer emits them. */
  alternatives: string[];
}

export interface SttService {
  available: boolean;
  /** `continuous` restarts on `onend` until `maxMs` (Monologue). `null` = nothing heard / aborted. */
  recognize(o: { maxMs: number; continuous?: boolean }): Promise<SttResult | null>;
  abort(): void;
}

export const nullAudio: AudioService = {
  speak: () => Promise.resolve(),
  cancel() {},
  warmUp() {},
  sfx() {},
  setVolume() {},
  muted: signal(false),
  hasJaVoice: signal(false),
  voices: () => [],
  rateForTier: (t) => SPEED_TIER_RATES[t],
};

export const nullStt: SttService = {
  available: false,
  recognize: () => Promise.resolve(null),
  abort() {},
};

/**
 * Whether `speak()` on `a` will actually be heard: `canSpeak` when the service
 * exposes it (the web service: a Japanese voice AND master volume > 0), else
 * `hasJaVoice` (`nullAudio`, doubles such as `{ ...nullAudio, hasJaVoice:
 * signal(true) }`). Text fallbacks gate on this, never on `hasJaVoice` alone.
 * `@/audio` and `exercises/voice.ts` re-export it, so every group reads one body.
 */
export function voiceAudible(a: AudioService): boolean {
  return a.canSpeak ? a.canSpeak.value : a.hasJaVoice.value;
}

/**
 * The source a status chip should name (design 08 §8 / §10.1): the service's
 * `source` signal when it has one, else `'synth'` while `voiceAudible()` and
 * `'none'` otherwise (so `nullAudio` and the existing doubles read as text
 * only / device voice without exposing a pack).
 */
export function audioSourceOf(a: AudioService): AudioSource {
  if (a.source) return a.source.value;
  return voiceAudible(a) ? 'synth' : 'none';
}

/**
 * Design 08 §13: the pack will carry the next utterance — it is loaded and
 * playable AND the learner has not chosen the device voice (`packChosen` =
 * `settings.audioSource !== 'device'`, passed in because this leaf may not
 * read the store). The one body behind the install nag (Onboarding, Library),
 * Settings' voice picker hint, Shadow's muted note and `installAdvice`.
 */
export function packWillSpeak(a: AudioService, packChosen: boolean): boolean {
  return packChosen && (a.packReady?.value === true || audioSourceOf(a) === 'clips');
}

/**
 * `navigator.connection.saveData` (Chrome Android's Data Saver); false wherever
 * the API is absent or throws. Pure (`nav` injectable); the effective data-saver
 * state is `settings.dataSaver || saveDataRequested()` (design 08 §13) —
 * `@/audio` exports that as `dataSaverOn()`; `main.tsx` and the shell read this body.
 */
export function saveDataRequested(nav: unknown = (globalThis as { navigator?: unknown }).navigator): boolean {
  try {
    return (nav as { connection?: { saveData?: boolean } } | undefined)?.connection?.saveData === true;
  } catch {
    return false;
  }
}

export interface Services {
  audio: AudioService;
  stt: SttService;
}

/** The live slot. Properties are swapped in place so earlier importers see the change. */
export const services: Services = { audio: nullAudio, stt: nullStt };

/**
 * Bumped by every `installServices()` / `resetServices()`. A component that
 * reads `services.audio.*` during render subscribes to this signal (read
 * `.value` once in render) so it re-renders when the real audio lands after
 * first paint — no polling (design 08 §8; Settings / About pack card).
 */
export const servicesVersion: Signal<number> = signal(0);

export function installServices(p: Partial<Services>): void {
  if (p.audio) services.audio = p.audio;
  if (p.stt) services.stt = p.stt;
  servicesVersion.value += 1;
}

/** Tests: back to silence. */
export function resetServices(): void {
  services.audio = nullAudio;
  services.stt = nullStt;
  servicesVersion.value += 1;
}

/** `services.audio.speak` through the slot. */
export function speak(text: string, o?: SpeakOptions): Promise<void> {
  return services.audio.speak(text, o);
}

/** `services.audio.sfx` through the slot. */
export function sfx(name: SfxName): void {
  services.audio.sfx(name);
}
