/**
 * TSUZUKU — `speechSynthesis` implementation of `AudioService` (design 07 §7).
 *
 *  - Voices: `getVoices()` on `voiceschanged` AND polled every 250 ms for 3 s
 *    (iOS Safari does not fire the event reliably); ranked by `voices.ts`.
 *  - `speak(text, {kana?})`: the PLAIN surface for sentences (kana-only text
 *    segments and accents badly); the kana reading only for an isolated word
 *    when the caller supplies it. Display-only marks never reach the engine
 *    (`stripDisplayMarks`, inside `textToSpeak` — both bodies live in the pure
 *    contract module `shared/speak-text.ts` since design 08 §7 and are
 *    re-exported here): leading / trailing 〜 ～ ~
 *    (〜てはいけない → てはいけない), an interior 〜 slot and … ‥ runs become a
 *    pause (、), 「」 around a bare pattern are unwrapped, a parenthetical is
 *    unwrapped when it is a 1–2 kana optional piece (〜なくして(は) → なくしては,
 *    (ら)れる → られる) and dropped otherwise ((N), (V), (imperative)), and a
 *    spaced / or ／ between alternatives becomes a pause. Ruby stripping and
 *    real sentence text are untouched. Utterances split at ≤ 180 chars on
 *    punctuation (Chromium's ~15 s cutoff). Resolves on `onend` OR `onerror`
 *    OR a timeout of the estimated duration + 2 s, so an awaited `speak()`
 *    can never hang a session.
 *  - Queue with cancel: `interrupt` (default) cancels everything first;
 *    `cancel()` also runs on `hashchange` (navigation) and resolves every
 *    pending promise.
 *  - Chrome quirks: a warm-up utterance on the first gesture (first-utterance
 *    delay); a 4 s keep-alive tick calls `resume()` whenever the engine
 *    reports `paused` mid-utterance (Chrome stalls after `cancel()`).
 *  - Two dialogue voice slots (`pickPair`): with a single Japanese voice slot
 *    B reuses it with a rate / pitch offset.
 *  - No `speechSynthesis` at all → silent service: `speak` resolves at once,
 *    `hasJaVoice` false, sfx still plays.
 *  - SFX via `sfx.ts`; master volume from `settings.sound`; muted in Zen or
 *    at volume 0 (voices still speak in Zen: listening drills need them).
 *  - `canSpeak` = a Japanese voice exists AND the master volume is above 0:
 *    at volume 0 `speak()` resolves at once without an utterance, so drills
 *    that gate their text fallback on audio read `canSpeak` (or the
 *    `voiceAudible()` helper, which falls back to `hasJaVoice` for services
 *    without it), not `hasJaVoice`.
 *
 * Everything browser-shaped is injectable so the module runs under jsdom.
 */
import { computed, effect, signal, type Signal } from '@preact/signals';
import { SPEED_TIER_RATES, type AudioService, type SpeakOptions, type SpeedTier, type VoiceInfo } from '../shared/audio';
import type { SfxName } from '../shared/catalog';
import { textToSpeak } from '../shared/speak-text';
import type { Settings } from '../shared/store-types';
import { store } from '../store';
import { createSfx, type SfxEngine } from './sfx';
import { pickPair, rankVoices, type RankedVoice, type VoiceLike } from './voices';

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

export type TtsSettings = Pick<Settings, 'sound' | 'feel' | 'speedTier' | 'ttsVoiceURI' | 'ttsVoiceURI2'>;

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
}

export interface WebAudioService extends AudioService {
  /** A Japanese voice exists and the master volume is above 0: `speak()` will be heard. */
  canSpeak: Signal<boolean>;
  /** Re-read `getVoices()` now. */
  refreshVoices(): void;
  /** Ranked Japanese voices with tier / default facts. */
  rankedVoices(): RankedVoice[];
  /** Currently speaking or queued. */
  busy(): boolean;
  /** Tear down timers and listeners (tests, hot reload). */
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

/* ────────────────────────────────────────────────────────────────────────── */
/* Service                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface Pending {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  utterance: UtteranceLike;
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

  const readSettings: () => TtsSettings =
    typeof o.settings === 'function' ? o.settings : o.settings ? () => (o.settings as Signal<TtsSettings>).value : () => store.settings.value;

  const muted = signal(false);
  const hasJaVoice = signal(false);
  const audible = signal(true);
  const canSpeak = computed(() => hasJaVoice.value && audible.value);
  let volume = 1;
  let ranked: RankedVoice[] = [];
  const queue: Pending[] = [];
  let current: Pending | null = null;
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

  const cancelAll = (): void => {
    const all = current ? [current, ...queue] : queue.slice();
    queue.length = 0;
    current = null;
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

  const warmUp = (): void => {
    sfxEngine.unlock();
    if (warmed || !synth || !Utterance) return;
    warmed = true;
    try {
      const u = new Utterance('あ'); // あ, inaudible at volume 0, primes Chrome's engine
      u.lang = 'ja-JP';
      u.volume = 0;
      u.rate = 1;
      u.pitch = 1;
      synth.speak(u);
    } catch {
      /* ignore */
    }
  };

  if (doc) {
    const once = (): void => {
      for (const g of GESTURES) doc.removeEventListener(g, once);
      warmUp();
    };
    for (const g of GESTURES) doc.addEventListener(g, once);
    cleanups.push(() => {
      for (const g of GESTURES) doc.removeEventListener(g, once);
    });
  }
  if (win) {
    const onNav = (): void => cancelAll();
    win.addEventListener('hashchange', onNav);
    cleanups.push(() => win.removeEventListener('hashchange', onNav));
  }

  /* ── public API ─────────────────────────────────────────────────────── */

  const speak = (text: string, opt: SpeakOptions = {}): Promise<void> => {
    if (disposed || !synth || !Utterance) return Promise.resolve();
    if (opt.interrupt !== false) cancelAll();
    const spoken = textToSpeak(text, opt.kana);
    const chunks = splitUtterance(spoken);
    if (chunks.length === 0 || volume <= 0) return Promise.resolve();
    const s = readSettings();
    const { voice, rateMul, pitch } = voiceFor(opt);
    const rate = (opt.rate ?? SPEED_TIER_RATES[s.speedTier] ?? 1) * rateMul;
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
      u.rate = Math.max(0.1, Math.min(10, rate));
      u.pitch = Math.max(0, Math.min(2, pitch));
      u.volume = volume;
      u.voice = raw;
      promises.push(
        new Promise<void>((resolve) => {
          queue.push({ resolve, timer: null, utterance: u });
        }),
      );
    }
    pump();
    return Promise.all(promises).then(() => undefined);
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
    voices: () => ranked.map((r) => ({ uri: r.uri, name: r.name, lang: r.lang, local: r.local, network: r.network })),
    rateForTier: (t: SpeedTier) => SPEED_TIER_RATES[t],
    refreshVoices,
    rankedVoices: () => ranked.slice(),
    busy: () => current !== null || queue.length > 0,
    dispose() {
      disposed = true;
      cancelAll();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const c of cleanups) c();
      cleanups.length = 0;
      sfxEngine.dispose();
    },
  };
  return service;
}
