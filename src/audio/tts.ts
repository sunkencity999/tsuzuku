/**
 * TSUZUKU — `speechSynthesis` implementation of `AudioService` (design 07 §7),
 * with the voice pack in front of it (design 08 §8).
 *
 *  - Voices: `getVoices()` on `voiceschanged` AND polled every 250 ms for 3 s
 *    (iOS Safari does not fire the event reliably); ranked by `voices.ts`.
 *  - `speak(text, {kana?, clip?, speaker?, …})` resolves the clip BEFORE the
 *    synth guard: `cancelAll` → resolve the cue (the clip key through
 *    `clips.cueFor`, the speaker → cast voice inside the pack, then `byText`
 *    for a sentence through `clips.cueForText`) → if `settings.audioSource`
 *    is `'pack'`, the pack is `ready` and the cue hits, the clip plays and the
 *    call returns; otherwise the utterance path below. A kiosk browser with a
 *    pack and no `speechSynthesis` therefore still speaks. A clip that cannot
 *    play (`source: 'none'`: pool not unlocked yet, sprite missing offline)
 *    falls through to the device voice. One `cancelAll` owns both: the clip
 *    in flight is stopped and every pending utterance promise resolves.
 *  - `speak(text, {kana?})` on the synth path: the PLAIN surface for sentences
 *    (kana-only text segments and accents badly); the kana reading only for an
 *    isolated word when the caller supplies it. Display-only marks never reach
 *    the engine (`stripDisplayMarks`, inside `textToSpeak` — both bodies live
 *    in the pure contract module `shared/speak-text.ts` since design 08 §7 and
 *    are re-exported here). Utterances split at ≤ 180 chars on punctuation
 *    (Chromium's ~15 s cutoff). Resolves on `onend` OR `onerror` OR a timeout
 *    of the estimated duration + 2 s, so an awaited `speak()` can never hang.
 *  - `source` (`'clips' | 'synth' | 'none'`) says where the most recent
 *    `speak()` came from — and, before any call, which source the next one
 *    would use (the pack when ready and chosen, else the device voice when
 *    audible, else text only), so a chip rendered at mount is never wrong;
 *    `packReady` mirrors `clips.ready === 'ready'`; `clipFor(key)` is the
 *    pack's `cueFor` behind the SAME gate as `speak()` (pack ready and not
 *    switched off), so a drill or a chip never holds a cue the next `speak()`
 *    would not play; `clips` is the player itself for Radio, Settings and
 *    About. `canSpeak = (hasJaVoice || (packReady && audioSource !== 'device')) && audible`:
 *    a pack the learner switched off cannot make `speak()` audible.
 *  - Queue with cancel: `interrupt` (default) cancels everything first;
 *    `cancel()` also runs on `hashchange` (navigation).
 *  - Chrome quirks: a silent warm-up utterance after the first gesture
 *    (first-utterance delay) — the gesture itself calls `sfxEngine.unlock()`
 *    and `clips.unlock()` synchronously so the pack's media pool is built
 *    inside it (WebKit unlocks media per element), while the warm-up leaves
 *    the gesture for `requestIdleCallback` (`setTimeout 0` without it): speech
 *    activation is sticky once a gesture has happened, and the tap's frame
 *    no longer pays for it (design 09 §12.1 d57). Each part is wrapped in
 *    `performance.mark` / `measure` (`audio:unlock:sfx` · `:clips` · `:synth`)
 *    so the frame protocol can attribute the first-tap cost. The gesture
 *    listeners stay until the player reports the pool accepted
 *    (`unlocked()`), since a touch's `pointerdown` is not an activation
 *    gesture on every engine and a refused pool is rebuilt on the next one;
 *    a 4 s keep-alive tick calls `resume()` whenever the engine reports
 *    `paused` mid-utterance.
 *  - Two dialogue voice slots (`pickPair`): with a single Japanese voice slot
 *    B reuses it with a rate / pitch offset. The pack ignores the slots and
 *    plays the cast voice of `speaker`.
 *  - No `speechSynthesis` at all → silent service unless a pack is ready:
 *    `speak` resolves at once, `hasJaVoice` false, sfx still plays.
 *  - SFX via `sfx.ts`; master volume from `settings.sound`; muted in Zen or
 *    at volume 0 (voices still speak in Zen: listening drills need them).
 *  - At volume 0 `speak()` resolves at once on both paths without playing, so
 *    drills that gate their text fallback on audio read `canSpeak` (or the
 *    `voiceAudible()` helper), not `hasJaVoice`.
 *
 * Everything browser-shaped is injectable so the module runs under jsdom.
 */
import { computed, effect, signal, type Signal } from '@preact/signals';
import {
  SPEED_TIER_RATES,
  packWillSpeak,
  type AudioService,
  type AudioSource,
  type ClipCue,
  type ClipPlayback,
  type ClipPlayer,
  type SpeakOptions,
  type SpeedTier,
  type VoiceInfo,
} from '../shared/audio';
import type { SfxName } from '../shared/catalog';
import { textToSpeak } from '../shared/speak-text';
import type { Settings } from '../shared/store-types';
import { store } from '../store';
import type { ClipPlayerEx } from './clips';
import { createSfx, type SfxEngine } from './sfx';
import { S } from './strings';
import { installGuide, pickPair, rankVoices, type RankedVoice, type VoiceLike } from './voices';

/* ────────────────────────────────────────────────────────────────────────── */
/* Tunables                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** Utterance length cap (Chromium cuts off around 15 s). */
export const MAX_UTTERANCE_CHARS = 180;
/** `getVoices()` polling (iOS Safari): every 250 ms for 3 s. */
export const VOICE_POLL_MS = 250;
export const VOICE_POLL_TOTAL_MS = 3000;
/** Grace added to the estimated duration before a stuck utterance is released. */
export const SPEAK_TIMEOUT_GRACE_MS = 2000;
/** Keep-alive tick: Chrome sometimes sits in `paused` after `cancel()`. */
export const KEEPALIVE_MS = 4000;
/** `requestIdleCallback` ceiling for the deferred synth warm-up (design 09 §12.1 d57). */
export const WARMUP_IDLE_TIMEOUT_MS = 1000;
/** The `performance.measure` names of the first-gesture unlock, one per part. */
export const UNLOCK_MARKS = { sfx: 'audio:unlock:sfx', clips: 'audio:unlock:clips', synth: 'audio:unlock:synth' } as const;

/**
 * Runs `fn` between `performance.mark(name + ':start' | ':end')` and a
 * `performance.measure(name)`, so DevTools and the frame-protocol stand-in
 * attribute the cost; silent wherever the User Timing API is missing (jsdom
 * carries `now` only) or throws. The buffer stays bounded: `warmUp` re-runs
 * the unlocks on every Radio play, so the marks are cleared once measured and
 * one measure per name lives (the latest; a trace keeps every event anyway).
 */
export function measured(name: string, fn: () => void): void {
  const perf = (globalThis as { performance?: Partial<Performance> }).performance;
  const mark = perf?.mark;
  const measure = perf?.measure;
  const timing = perf && typeof mark === 'function' && typeof measure === 'function' ? { perf, mark, measure } : null;
  const start = `${name}:start`;
  const end = `${name}:end`;
  if (timing) {
    try {
      timing.mark.call(timing.perf, start);
    } catch {
      /* ignore */
    }
  }
  try {
    fn();
  } finally {
    if (timing) {
      try {
        timing.mark.call(timing.perf, end);
        timing.perf.clearMeasures?.(name);
        timing.measure.call(timing.perf, name, start, end);
        timing.perf.clearMarks?.(start);
        timing.perf.clearMarks?.(end);
      } catch {
        /* ignore */
      }
    }
  }
}
/** Japanese TTS at rate 1 ≈ 7 morae/s; a char is ≈ one mora, kanji ≈ two. */
export const MS_PER_CHAR = 150;
export const MS_PER_KANJI = 300;
export const UTTERANCE_FIXED_MS = 400;
/**
 * `stripDisplayMarks` / `textToSpeak` / `WORD_MAX_CHARS` live in `shared/speak-text.ts`
 * (design 08 §7: pure, Node-importable, so the render pipeline hands VOICEVOX the
 * same string `speak()` hands the engine); re-exported so `@/audio` importers are
 * unchanged. One definition, no copy here.
 */
export { stripDisplayMarks, textToSpeak, WORD_MAX_CHARS } from '../shared/speak-text';

/* ────────────────────────────────────────────────────────────────────────── */
/* Injectable surfaces                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/** The subset of `SpeechSynthesisUtterance` we use (tests pass a plain fake). */
export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: VoiceLike | null;
  onend: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onstart?: ((ev?: unknown) => void) | null;
}

export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  resume(): void;
  pause(): void;
  readonly speaking: boolean;
  readonly paused: boolean;
  readonly pending: boolean;
  onvoiceschanged?: ((ev?: unknown) => void) | null;
  addEventListener?(type: string, fn: (ev?: unknown) => void): void;
  removeEventListener?(type: string, fn: (ev?: unknown) => void): void;
}

export type UtteranceCtor = new (text: string) => UtteranceLike;

/** The settings the service reads; `audioSource` is optional so older doubles keep compiling (absent → `'pack'`). */
export type TtsSettings = Pick<Settings, 'sound' | 'feel' | 'speedTier' | 'ttsVoiceURI' | 'ttsVoiceURI2'> & Partial<Pick<Settings, 'audioSource'>>;

export interface WebAudioOptions {
  /** Default `globalThis.speechSynthesis`; `null` forces the silent service. */
  synth?: SynthLike | null;
  /** Default `globalThis.SpeechSynthesisUtterance`. */
  utteranceCtor?: UtteranceCtor | null;
  /** Default: `new AudioContext()` where available. */
  ctxFactory?: () => AudioContext | undefined;
  /** Settings source; default the store's `settings` signal. */
  settings?: Signal<TtsSettings> | (() => TtsSettings);
  /** Gesture / navigation listeners; default `globalThis.document` / `window`. `null` disables. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener'> | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Haptics hook (`navigator.vibrate`). */
  vibrate?: (pattern: number | number[]) => unknown;
  /**
   * The voice pack player (design 08 §8; `createClipPlayer()` from `./clips`).
   * Absent → device voice only. The service owns its lifetime (`dispose()`).
   */
  clips?: ClipPlayer | null;
}

export interface WebAudioService extends AudioService {
  /** A Japanese voice or a ready pack (unless `audioSource` is `'device'`) exists and the master volume is above 0: `speak()` will be heard. */
  canSpeak: Signal<boolean>;
  /** Where the most recent `speak()` came from; before any call, the source the next one would use. */
  source: Signal<AudioSource>;
  /** The voice pack is loaded and playable. */
  packReady: Signal<boolean>;
  /** Re-read `getVoices()` now. */
  refreshVoices(): void;
  /** Ranked Japanese voices with tier / default facts. */
  rankedVoices(): RankedVoice[];
  /** Currently speaking or queued (a clip in flight counts). */
  busy(): boolean;
  /** Tear down timers and listeners (tests, hot reload); disposes the pack player too. */
  dispose(): void;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const KANJI_RE_G = /[㐀-䶿一-鿿々〆]/g;

/**
 * Splits `text` into utterances of ≤ `max` chars. Cuts after sentence
 * punctuation first (。！？!?), then after commas (、，,), then at whitespace,
 * then hard. Whitespace-only pieces are dropped.
 */
export function splitUtterance(text: string, max = MAX_UTTERANCE_CHARS): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length > 0) out.push(t);
  };
  const sentences = text.split(/(?<=[。！？!?])/);
  let buf = '';
  const flush = () => {
    push(buf);
    buf = '';
  };
  for (const s of sentences) {
    if (s.length === 0) continue;
    if (s.length > max) {
      flush();
      for (const piece of splitLong(s, max)) push(piece);
      continue;
    }
    if (buf.length + s.length > max) flush();
    buf += s;
  }
  flush();
  return out;
}

function splitLong(s: string, max: number): string[] {
  const parts: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('、'), window.lastIndexOf('，'), window.lastIndexOf(','));
    if (cut < max / 3) cut = Math.max(window.lastIndexOf(' '), window.lastIndexOf('　'));
    if (cut < max / 3) cut = max - 1;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** Estimated spoken length of one utterance at `rate`. */
export function estimateMs(text: string, rate: number): number {
  const kanji = (text.match(KANJI_RE_G) ?? []).length;
  const chars = Array.from(text.replace(/\s+/g, '')).length;
  const base = UTTERANCE_FIXED_MS + (chars - kanji) * MS_PER_CHAR + kanji * MS_PER_KANJI;
  return Math.round(base / Math.max(0.25, rate));
}

/**
 * The one-time "add a Japanese voice" line a surface shows (design 08 §8): with
 * the voice pack ready the synthetic voices already speak and a device voice is
 * optional; with a Japanese device voice there is nothing to install (`''`);
 * otherwise the OS guide from `voices.ts`. Reads the contract-tier
 * `packWillSpeak(a, packChosenIn(s))` first — `s` defaults to the store settings
 * the service itself reads, so a ready pack under `audioSource: 'device'` is the
 * device voice and gets the guide while a chosen pack with no Japanese voice gets
 * no nag; then `hasJaVoice` rather than `voiceAudible()` on purpose — the master
 * volume at 0 is not a missing voice, and the OS install guide would be the wrong
 * answer to it.
 */
export function installAdvice(a: AudioService, ua: string, s: Pick<TtsSettings, 'audioSource'> = store.settings.value): string {
  if (packWillSpeak(a, packChosenIn(s))) return S.installPackPlaying;
  if (a.hasJaVoice.value) return '';
  return installGuide(ua);
}

/**
 * Design 08 §13: the pack is chosen unless the learner picked the device voice
 * (`audioSource` absent → `'pack'`). The one body behind `canSpeak`, the idle
 * `source`, the clip branch of `speak()` and `clipFor()`.
 */
export function packChosenIn(s: Pick<TtsSettings, 'audioSource'>): boolean {
  return (s.audioSource ?? 'pack') !== 'device';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Service                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface Pending {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  utterance: UtteranceLike;
}

interface ClipPending {
  playback: ClipPlayback;
  cancelled: boolean;
}

function defaultSynth(): SynthLike | null {
  const g = globalThis as { speechSynthesis?: SynthLike };
  return g.speechSynthesis ?? null;
}

function defaultUtteranceCtor(): UtteranceCtor | null {
  const g = globalThis as { SpeechSynthesisUtterance?: UtteranceCtor };
  return g.SpeechSynthesisUtterance ?? null;
}

function defaultCtxFactory(): AudioContext | undefined {
  const g = globalThis as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : undefined;
}

function defaultVibrate(): ((pattern: number | number[]) => unknown) | undefined {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav || typeof nav.vibrate !== 'function') return undefined;
  return (p) => nav.vibrate(p);
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** Whether `speak()` on an audio service will actually be heard; the body lives in `shared/audio.ts` (ARCHITECTURE §3). */
export { voiceAudible } from '../shared/audio';

export function createWebAudio(o: WebAudioOptions = {}): WebAudioService {
  const synth = o.synth === undefined ? defaultSynth() : o.synth;
  const Utterance = o.utteranceCtor === undefined ? defaultUtteranceCtor() : o.utteranceCtor;
  const doc = o.doc === undefined ? ((globalThis as { document?: Document }).document ?? null) : o.doc;
  const win = o.win === undefined ? ((globalThis as { window?: Window }).window ?? null) : o.win;
  const sfxEngine: SfxEngine = createSfx(o.ctxFactory ?? defaultCtxFactory, { vibrate: o.vibrate ?? defaultVibrate() });
  const clips: ClipPlayer | undefined = o.clips ?? undefined;

  const readSettings: () => TtsSettings =
    typeof o.settings === 'function' ? o.settings : o.settings ? () => (o.settings as Signal<TtsSettings>).value : () => store.settings.value;

  const muted = signal(false);
  const hasJaVoice = signal(false);
  const audible = signal(true);
  const packReady = computed(() => (clips ? clips.ready.value === 'ready' : false));
  /**
   * The pack is ready AND chosen (`settings.audioSource !== 'device'`, design 08 §13): it counts toward `canSpeak`
   * and the idle `source` only while chosen. Settings are read inside the computed — the signal / store forms are
   * tracked through `.value`, and the function form is re-read on every re-evaluation (a pack, voice or volume
   * change) instead of frozen at construction; speak() / clipFor() read it fresh per call either way.
   */
  const packUsable = computed(() => packReady.value && packChosenIn(readSettings()));
  const canSpeak = computed(() => (hasJaVoice.value || packUsable.value) && audible.value);
  /** The source of the most recent `speak()`; `null` until the first call. */
  const lastSource = signal<AudioSource | null>(null);
  /** Idle: the source the next `speak()` would use, so a chip at mount reads right; after a call, that call's source. */
  const source = computed<AudioSource>(() => lastSource.value ?? (!audible.value ? 'none' : packUsable.value ? 'clips' : hasJaVoice.value ? 'synth' : 'none'));
  let volume = 1;
  let ranked: RankedVoice[] = [];
  const queue: Pending[] = [];
  let current: Pending | null = null;
  let clipCurrent: ClipPending | null = null;
  let clipChain: Promise<unknown> = Promise.resolve();
  let warmed = false;
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanups: (() => void)[] = [];

  /* ── settings ───────────────────────────────────────────────────────── */

  const applySettings = (s: TtsSettings): void => {
    volume = Math.max(0, Math.min(1, Number.isFinite(s.sound) ? s.sound : 1));
    audible.value = volume > 0;
    muted.value = volume <= 0 || s.feel === 'zen';
  };

  if (o.settings && typeof o.settings !== 'function') {
    const sig = o.settings;
    cleanups.push(effect(() => applySettings(sig.value)));
  } else if (!o.settings) {
    cleanups.push(effect(() => applySettings(store.settings.value)));
  } else {
    applySettings(readSettings());
  }

  /* ── voices ─────────────────────────────────────────────────────────── */

  const refreshVoices = (): void => {
    if (!synth) return;
    let list: VoiceLike[] = [];
    try {
      list = synth.getVoices() ?? [];
    } catch {
      list = [];
    }
    ranked = rankVoices(list);
    hasJaVoice.value = ranked.length > 0;
  };

  const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  if (synth) {
    refreshVoices();
    const onChanged = () => refreshVoices();
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', onChanged);
      cleanups.push(() => synth.removeEventListener?.('voiceschanged', onChanged));
    } else {
      synth.onvoiceschanged = onChanged;
      cleanups.push(() => {
        if (synth.onvoiceschanged === onChanged) synth.onvoiceschanged = null;
      });
    }
    // Poll as a fallback to the event (iOS Safari), stop once voices arrive.
    const polls = Math.ceil(VOICE_POLL_TOTAL_MS / VOICE_POLL_MS);
    let n = 0;
    const poll = (): void => {
      if (ranked.length > 0 || n >= polls) return;
      n++;
      refreshVoices();
      if (ranked.length === 0 && n < polls) later(poll, VOICE_POLL_MS);
    };
    later(poll, VOICE_POLL_MS);
  }

  /* ── queue ──────────────────────────────────────────────────────────── */

  const settle = (p: Pending): void => {
    if (p.timer) {
      clearTimeout(p.timer);
      timers.delete(p.timer);
      p.timer = null;
    }
    p.utterance.onend = null;
    p.utterance.onerror = null;
    p.resolve();
  };

  const pump = (): void => {
    if (current || disposed || !synth) return;
    const next = queue.shift();
    if (!next) return;
    current = next;
    const finish = (): void => {
      if (current !== next) return;
      current = null;
      settle(next);
      pump();
    };
    next.utterance.onend = finish;
    next.utterance.onerror = finish;
    const budget = estimateMs(next.utterance.text, next.utterance.rate) + SPEAK_TIMEOUT_GRACE_MS;
    next.timer = later(finish, budget);
    try {
      if (synth.paused) synth.resume();
      synth.speak(next.utterance);
    } catch {
      finish();
    }
  };

  /** One cancel owns both queues (design 08 §8): the clip in flight and every pending utterance. */
  const cancelAll = (): void => {
    const all = current ? [current, ...queue] : queue.slice();
    queue.length = 0;
    current = null;
    if (clipCurrent) {
      const c = clipCurrent;
      clipCurrent = null;
      c.cancelled = true;
      c.playback.stop();
    }
    if (synth) {
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
    }
    for (const p of all) settle(p);
  };

  // Keep-alive: nudge a paused engine while something is in flight.
  if (synth) {
    const tick = (): void => {
      if (disposed) return;
      if (current && synth.paused) {
        try {
          synth.resume();
        } catch {
          /* ignore */
        }
      }
      later(tick, KEEPALIVE_MS);
    };
    later(tick, KEEPALIVE_MS);
  }

  /* ── voice slots ────────────────────────────────────────────────────── */

  const voiceFor = (opt: SpeakOptions): { voice: VoiceInfo | undefined; rateMul: number; pitch: number } => {
    const s = readSettings();
    if (opt.voiceURI) {
      const v = ranked.find((r) => r.uri === opt.voiceURI);
      if (v) return { voice: v, rateMul: 1, pitch: 1 };
    }
    const pair = pickPair(ranked, s.ttsVoiceURI, s.ttsVoiceURI2);
    if (opt.voice === 'b') {
      return pair.offset ? { voice: pair.b, rateMul: pair.offset.rate, pitch: pair.offset.pitch } : { voice: pair.b, rateMul: 1, pitch: 1 };
    }
    return { voice: pair.a, rateMul: 1, pitch: 1 };
  };

  const rawVoice = (info: VoiceInfo | undefined): VoiceLike | null => {
    if (!info || !synth) return null;
    try {
      return synth.getVoices().find((v) => v.voiceURI === info.uri) ?? null;
    } catch {
      return null;
    }
  };

  /* ── gesture unlock ─────────────────────────────────────────────────── */

  /** Runs `fn` once the browser is idle (`requestIdleCallback`, `WARMUP_IDLE_TIMEOUT_MS` ceiling), else on the next macrotask; never after dispose. */
  const whenIdle = (fn: () => void): void => {
    const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (typeof g.requestIdleCallback === 'function') {
      const id = g.requestIdleCallback(() => {
        if (!disposed) fn();
      }, { timeout: WARMUP_IDLE_TIMEOUT_MS });
      cleanups.push(() => g.cancelIdleCallback?.(id));
      return;
    }
    later(fn, 0);
  };

  /** The silent utterance that primes Chrome's engine: あ at volume 0. */
  const primeSynth = (): void => {
    if (!synth || !Utterance) return;
    measured(UNLOCK_MARKS.synth, () => {
      try {
        const u = new Utterance('あ');
        u.lang = 'ja-JP';
        u.volume = 0;
        u.rate = 1;
        u.pitch = 1;
        synth.speak(u);
      } catch {
        /* ignore */
      }
    });
  };

  const warmUp = (): void => {
    // the two unlocks stay synchronous inside the gesture (WebKit unlocks media per element, design 08 §8)
    measured(UNLOCK_MARKS.sfx, () => sfxEngine.unlock());
    measured(UNLOCK_MARKS.clips, () => {
      try {
        clips?.unlock();
      } catch {
        /* the pack never blocks the device voice */
      }
    });
    if (warmed || !synth || !Utterance) return;
    warmed = true;
    // the warm-up utterance leaves the gesture (d57): speech activation is sticky once a gesture has happened
    whenIdle(primeSynth);
  };

  /** The pack's pool is built but not yet accepted by the engine (or the pack is still loading): keep listening for a gesture. */
  const poolPending = (): boolean => {
    if (!clips || clips.ready.value === 'absent') return false;
    const ex = clips as Partial<Pick<ClipPlayerEx, 'unlocked'>>;
    return typeof ex.unlocked === 'function' && !ex.unlocked();
  };

  if (doc) {
    const onGesture = (): void => {
      warmUp();
      // A touch's pointerdown is not an activation gesture on every engine: a refused pool is rebuilt on the next
      // gesture (touchend, the next tap), so the listeners go only once the player reports the pool accepted.
      if (!poolPending()) for (const g of GESTURES) doc.removeEventListener(g, onGesture);
    };
    for (const g of GESTURES) doc.addEventListener(g, onGesture);
    cleanups.push(() => {
      for (const g of GESTURES) doc.removeEventListener(g, onGesture);
    });
  }
  if (win) {
    const onNav = (): void => cancelAll();
    win.addEventListener('hashchange', onNav);
    cleanups.push(() => win.removeEventListener('hashchange', onNav));
  }

  /* ── clip path (design 08 §8) ───────────────────────────────────────── */

  /** The clip key first, then (inside the pack) the speaker's cast voice, then `byText` for a sentence. */
  const resolveCue = (text: string, opt: SpeakOptions, rate: number): ClipCue | undefined => {
    if (!clips) return undefined;
    if (opt.clip) {
      const hit = clips.cueFor(opt.clip, { rate, speaker: opt.speaker });
      if (hit) return hit;
    }
    const spoken = textToSpeak(text, opt.kana);
    return spoken.length > 0 ? clips.cueForText(spoken, { rate, speaker: opt.speaker }) : undefined;
  };

  /** Plays a cue; resolves `true` when the clip could not play and the synth should take over. */
  const playClip = (cue: ClipCue, opt: SpeakOptions, rate: number, interrupt: boolean): Promise<boolean> => {
    if (!clips) return Promise.resolve(true);
    const player = clips;
    const start = (): Promise<boolean> => {
      if (disposed) return Promise.resolve(false);
      lastSource.value = 'clips';
      const playback = player.play(cue, { rate, volume, clause: opt.clause, onProgress: opt.onProgress });
      const pending: ClipPending = { playback, cancelled: false };
      clipCurrent = pending;
      return playback.done.then((r) => {
        if (clipCurrent === pending) clipCurrent = null;
        if (pending.cancelled) return false;
        return r.source === 'none';
      });
    };
    // `interrupt: false` queues behind the clip in flight, as utterances queue behind each other.
    const p = interrupt ? start() : clipChain.then(start);
    clipChain = p.catch(() => undefined);
    return p;
  };

  /* ── synth path ─────────────────────────────────────────────────────── */

  const speakSynth = (text: string, opt: SpeakOptions, rate: number): Promise<void> => {
    if (disposed || !synth || !Utterance) {
      lastSource.value = 'none';
      return Promise.resolve();
    }
    const spoken = textToSpeak(text, opt.kana);
    const chunks = splitUtterance(spoken);
    if (chunks.length === 0 || volume <= 0) {
      lastSource.value = 'none';
      return Promise.resolve();
    }
    const { voice, rateMul, pitch } = voiceFor(opt);
    const raw = rawVoice(voice);
    const promises: Promise<void>[] = [];
    for (const chunk of chunks) {
      let u: UtteranceLike;
      try {
        u = new Utterance(chunk);
      } catch {
        continue;
      }
      u.text = chunk;
      u.lang = raw?.lang ?? 'ja-JP';
      u.rate = Math.max(0.1, Math.min(10, rate * rateMul));
      u.pitch = Math.max(0, Math.min(2, pitch));
      u.volume = volume;
      u.voice = raw;
      promises.push(
        new Promise<void>((resolve) => {
          queue.push({ resolve, timer: null, utterance: u });
        }),
      );
    }
    if (promises.length === 0) {
      lastSource.value = 'none';
      return Promise.resolve();
    }
    lastSource.value = 'synth';
    pump();
    return Promise.all(promises).then(() => undefined);
  };

  /* ── public API ─────────────────────────────────────────────────────── */

  const speak = (text: string, opt: SpeakOptions = {}): Promise<void> => {
    if (disposed) return Promise.resolve();
    const interrupt = opt.interrupt !== false;
    if (interrupt) cancelAll();
    const s = readSettings();
    const rate = opt.rate ?? SPEED_TIER_RATES[s.speedTier] ?? 1;
    // The clip resolves BEFORE the synth guard (design 08 §8): a pack speaks without speechSynthesis.
    if (clips && packChosenIn(s) && clips.ready.value === 'ready') {
      const cue = resolveCue(text, opt, rate);
      if (cue) {
        if (volume <= 0) {
          lastSource.value = 'none';
          return Promise.resolve();
        }
        return playClip(cue, opt, rate, interrupt).then((fallThrough) => (fallThrough && !disposed ? speakSynth(text, opt, rate) : undefined));
      }
    }
    return speakSynth(text, opt, rate);
  };

  const service: WebAudioService = {
    speak,
    cancel: cancelAll,
    warmUp,
    sfx(name: SfxName) {
      if (muted.value) return;
      sfxEngine.play(name, volume);
    },
    setVolume(v: number) {
      volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      audible.value = volume > 0;
      muted.value = volume <= 0 || readSettings().feel === 'zen';
    },
    muted,
    hasJaVoice,
    canSpeak,
    source,
    packReady,
    // The same pack gate as speak() (design 08 §8): undefined unless the pack is ready AND chosen, so a caller never
    // holds a cue the next speak() would not play.
    clipFor: (key, opt) => (clips && clips.ready.value === 'ready' && packChosenIn(readSettings()) ? clips.cueFor(key, opt) : undefined),
    ...(clips ? { clips } : {}),
    voices: () => ranked.map((r) => ({ uri: r.uri, name: r.name, lang: r.lang, local: r.local, network: r.network })),
    rateForTier: (t: SpeedTier) => SPEED_TIER_RATES[t],
    refreshVoices,
    rankedVoices: () => ranked.slice(),
    busy: () => current !== null || queue.length > 0 || clipCurrent !== null,
    dispose() {
      disposed = true;
      cancelAll();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const c of cleanups) c();
      cleanups.length = 0;
      sfxEngine.dispose();
      try {
        clips?.dispose();
      } catch {
        /* ignore */
      }
    },
  };
  return service;
}
