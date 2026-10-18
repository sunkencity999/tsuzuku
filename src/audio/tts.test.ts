/**
 * tts.ts — against a fake SpeechSynthesis / SpeechSynthesisUtterance under
 * fake timers. Settings come from a signal so no store is needed.
 */
import { signal } from '@preact/signals';
import { SPEED_TIER_RATES, audioSourceOf, nullAudio, type AudioPackInfo, type ClipCue, type ClipPlayOptions, type ClipPlayer, type ClipReady } from '../shared/audio';
import { stripDisplayMarks as sharedStrip, textToSpeak as sharedTextToSpeak } from '../shared/speak-text';
import { nearestRate } from './clips';
import { S } from './strings';
import { PAIR_OFFSET, type VoiceLike } from './voices';
import {
  MAX_UTTERANCE_CHARS,
  SPEAK_TIMEOUT_GRACE_MS,
  VOICE_POLL_MS,
  VOICE_POLL_TOTAL_MS,
  createWebAudio,
  estimateMs,
  installAdvice,
  packChosenIn,
  splitUtterance,
  stripDisplayMarks,
  textToSpeak,
  voiceAudible,
  type SynthLike,
  type TtsSettings,
  type UtteranceLike,
  type WebAudioService,
} from './tts';

/* ────────────────────────────────────────────────────────────────────────── */
/* Fakes                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

class FakeUtterance implements UtteranceLike {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: VoiceLike | null = null;
  onend: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth implements SynthLike {
  voices: VoiceLike[];
  spoken: FakeUtterance[] = [];
  cancels = 0;
  resumes = 0;
  speaking = false;
  paused = false;
  pending = false;
  onvoiceschanged: ((ev?: unknown) => void) | null = null;
  private listeners = new Map<string, Set<(ev?: unknown) => void>>();
  /** When false, `addEventListener` is absent (old WebKit): the service falls back to `onvoiceschanged`. */
  constructor(voices: VoiceLike[] = [], o: { withEvents?: boolean } = {}) {
    this.voices = voices;
    if (o.withEvents === false) {
      // @ts-expect-error — simulate a synth without addEventListener
      this.addEventListener = undefined;
      // @ts-expect-error — and without removeEventListener
      this.removeEventListener = undefined;
    }
  }
  getVoices(): VoiceLike[] {
    return this.voices;
  }
  speak(u: UtteranceLike): void {
    this.spoken.push(u as FakeUtterance);
    this.speaking = true;
  }
  cancel(): void {
    this.cancels++;
    this.speaking = false;
  }
  resume(): void {
    this.resumes++;
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: (ev?: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
    if (type === 'voiceschanged') this.onvoiceschanged?.();
  }
  /** Finish the current utterance like a browser would. */
  end(i = this.spoken.length - 1): void {
    const u = this.spoken[i];
    this.speaking = false;
    u?.onend?.();
  }
  fail(i = this.spoken.length - 1): void {
    const u = this.spoken[i];
    this.speaking = false;
    u?.onerror?.({ error: 'synthesis-failed' });
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const ja = (name: string, o: Partial<VoiceLike> = {}): VoiceLike => ({ voiceURI: o.voiceURI ?? `uri:${name}`, name, lang: 'ja-JP', localService: o.localService ?? true, default: false });
const en = (name: string): VoiceLike => ({ voiceURI: `uri:${name}`, name, lang: 'en-US', localService: true, default: true });

const baseSettings = (): TtsSettings => ({ sound: 0.8, feel: 'dojo', speedTier: 3 });

let services: WebAudioService[] = [];
function make(synth: FakeSynth | null, settings = signal(baseSettings()), extra: Parameters<typeof createWebAudio>[0] = {}): WebAudioService {
  const svc = createWebAudio({ synth, utteranceCtor: FakeUtterance, ctxFactory: () => undefined, settings, doc: null, win: null, ...extra });
  services.push(svc);
  return svc;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const s of services) s.dispose();
  services = [];
  vi.useRealTimers();
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe('splitUtterance', () => {
  it('leaves a short sentence whole', () => {
    expect(splitUtterance('おはようございます。')).toEqual(['おはようございます。']);
  });

  it('splits long text at sentence punctuation into pieces ≤ 180 chars', () => {
    const sentence = 'わたしはまいあさコーヒーをのみます。'; // 18 chars
    const text = sentence.repeat(25); // 450 chars
    const parts = splitUtterance(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(MAX_UTTERANCE_CHARS);
      expect(p.endsWith('。')).toBe(true);
    }
    expect(parts.join('')).toBe(text);
  });

  it('a single sentence over the cap splits at commas, then hard', () => {
    const clause = 'あいうえおかきくけこ、'; // 11 chars
    const text = clause.repeat(20) + 'です。'; // 223 chars, one sentence
    const parts = splitUtterance(text);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_UTTERANCE_CHARS);
    expect(parts[0]?.endsWith('、')).toBe(true);
    const hard = 'あ'.repeat(400);
    const hardParts = splitUtterance(hard);
    expect(hardParts.map((p) => p.length)).toEqual([180, 180, 40]);
  });

  it('drops whitespace-only pieces and trims', () => {
    expect(splitUtterance('  ')).toEqual([]);
    expect(splitUtterance(' はい。 ')).toEqual(['はい。']);
  });
});

describe('estimateMs / textToSpeak', () => {
  it('estimate grows with length and shrinks with rate; kanji count double', () => {
    const a = estimateMs('あいうえお', 1);
    const b = estimateMs('あいうえおかきくけこ', 1);
    expect(b).toBeGreaterThan(a);
    expect(estimateMs('あいうえお', 2)).toBeLessThan(a);
    expect(estimateMs('飲む', 1)).toBeGreaterThan(estimateMs('のむ', 1));
  });

  it('stripDisplayMarks / textToSpeak ARE the shared/speak-text functions (one body; their cases live in speak-text.test.ts)', () => {
    expect(stripDisplayMarks).toBe(sharedStrip);
    expect(textToSpeak).toBe(sharedTextToSpeak);
    expect(textToSpeak('{飲|の}む', 'のむ')).toBe('のむ');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Voices                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

describe('voices', () => {
  it('hasJaVoice false when no ja voices and speak still resolves', async () => {
    const synth = new FakeSynth([en('Alex')]);
    const svc = make(synth);
    expect(svc.hasJaVoice.value).toBe(false);
    expect(svc.voices()).toEqual([]);
    const p = svc.speak('おはよう。');
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0]?.voice).toBeNull();
    expect(synth.spoken[0]?.lang).toBe('ja-JP');
    synth.end();
    await expect(p).resolves.toBeUndefined();
  });

  it('voices are refreshed on voiceschanged (addEventListener path)', () => {
    const synth = new FakeSynth([]);
    const svc = make(synth);
    expect(svc.hasJaVoice.value).toBe(false);
    synth.voices = [ja('Kyoko')];
    synth.fire('voiceschanged');
    expect(svc.hasJaVoice.value).toBe(true);
    expect(svc.voices()[0]?.name).toBe('Kyoko');
  });

  it('falls back to onvoiceschanged when addEventListener is missing', () => {
    const synth = new FakeSynth([], { withEvents: false });
    const svc = make(synth);
    expect(typeof synth.onvoiceschanged).toBe('function');
    synth.voices = [ja('O-Ren')];
    synth.onvoiceschanged?.();
    expect(svc.hasJaVoice.value).toBe(true);
  });

  it('voices are polled every 250 ms for 3 s when voiceschanged never fires', () => {
    const synth = new FakeSynth([]);
    const getVoices = vi.spyOn(synth, 'getVoices');
    const svc = make(synth);
    const initialCalls = getVoices.mock.calls.length;
    vi.advanceTimersByTime(VOICE_POLL_MS * 4);
    expect(getVoices.mock.calls.length).toBe(initialCalls + 4);
    synth.voices = [ja('Kyoko')];
    vi.advanceTimersByTime(VOICE_POLL_MS);
    expect(svc.hasJaVoice.value).toBe(true);
    const afterFound = getVoices.mock.calls.length;
    vi.advanceTimersByTime(VOICE_POLL_TOTAL_MS * 2);
    // polling stops once voices are found
    expect(getVoices.mock.calls.length).toBe(afterFound);
  });

  it('polling gives up after 3 s', () => {
    const synth = new FakeSynth([]);
    const getVoices = vi.spyOn(synth, 'getVoices');
    make(synth);
    vi.advanceTimersByTime(VOICE_POLL_TOTAL_MS + VOICE_POLL_MS * 10);
    const n = getVoices.mock.calls.length;
    vi.advanceTimersByTime(VOICE_POLL_TOTAL_MS);
    expect(getVoices.mock.calls.length).toBe(n);
    expect(n).toBeLessThanOrEqual(1 + VOICE_POLL_TOTAL_MS / VOICE_POLL_MS + 1);
  });

  it('voices() marks network voices and ranks by preference', () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('Google 日本語', { localService: false })]);
    const svc = make(synth);
    expect(svc.voices().map((v) => [v.name, v.network])).toEqual([
      ['Google 日本語', true],
      ['Kyoko', false],
    ]);
    expect(svc.rankedVoices()[0]?.tier).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* speak()                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

describe('speak', () => {
  it('display marks never reach the utterance; mark-only text makes no utterance and resolves at once', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('〜てはいけない');
    expect(synth.spoken.map((u) => u.text)).toEqual(['てはいけない']);
    void svc.speak('〜に至って(は)');
    expect(synth.spoken[1]?.text).toBe('に至っては');
    void svc.speak('〜放題', { kana: 'ほうだい' });
    expect(synth.spoken[2]?.text).toBe('ほうだい');
    const before = synth.spoken.length;
    await expect(svc.speak('「……」')).resolves.toBeUndefined();
    expect(synth.spoken.length).toBe(before);
  });

  it('rateForTier follows SPEED_TIER_RATES and the default rate is the settings tier', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal<TtsSettings>({ ...baseSettings(), speedTier: 1 });
    const svc = make(synth, settings);
    for (const t of [1, 2, 3, 4, 5] as const) expect(svc.rateForTier(t)).toBe(SPEED_TIER_RATES[t]);
    void svc.speak('はい。');
    expect(synth.spoken[0]?.rate).toBe(0.75);
    settings.value = { ...settings.value, speedTier: 5 };
    void svc.speak('はい。');
    expect(synth.spoken[1]?.rate).toBe(1.25);
    void svc.speak('はい。', { rate: 1.5 });
    expect(synth.spoken[2]?.rate).toBe(1.5);
  });

  it('long text is split into ≤180-char utterances spoken in order, resolving after the last onend', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const text = 'わたしはまいあさコーヒーをのみます。'.repeat(25);
    const p = svc.speak(text);
    let done = false;
    void p.then(() => {
      done = true;
    });
    expect(synth.spoken.length).toBe(1);
    synth.end(0);
    await Promise.resolve();
    expect(synth.spoken.length).toBe(2);
    expect(done).toBe(false);
    while (synth.speaking) {
      synth.end();
      await Promise.resolve();
    }
    await p;
    expect(done).toBe(true);
    expect(synth.spoken.map((u) => u.text).join('')).toBe(text);
    for (const u of synth.spoken) expect(u.text.length).toBeLessThanOrEqual(180);
  });

  it('cancel clears the queue, calls synth.cancel and resolves pending promises', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const text = 'わたしはまいあさコーヒーをのみます。'.repeat(25);
    const p = svc.speak(text);
    expect(svc.busy()).toBe(true);
    svc.cancel();
    expect(synth.cancels).toBe(2); // one from speak()'s interrupt, one explicit
    expect(svc.busy()).toBe(false);
    await expect(p).resolves.toBeUndefined();
    // nothing more is spoken after cancel
    vi.advanceTimersByTime(60_000);
    expect(synth.spoken.length).toBe(1);
  });

  it('interrupt (default) cancels what was playing; interrupt:false queues', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('いち。');
    void svc.speak('に。');
    expect(synth.cancels).toBe(2); // one per speak() call
    expect(synth.spoken.map((u) => u.text)).toEqual(['いち。', 'に。']);
    void svc.speak('さん。', { interrupt: false });
    expect(synth.cancels).toBe(2);
    expect(synth.spoken.length).toBe(2); // queued behind に。
    synth.end(1);
    expect(synth.spoken[2]?.text).toBe('さん。');
  });

  it('speak resolves via the timeout when onend never fires', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const text = 'おはようございます。';
    const p = svc.speak(text);
    let done = false;
    void p.then(() => {
      done = true;
    });
    const budget = estimateMs(text, 1) + SPEAK_TIMEOUT_GRACE_MS;
    vi.advanceTimersByTime(budget - 1);
    await Promise.resolve();
    expect(done).toBe(false);
    vi.advanceTimersByTime(2);
    await p;
    expect(done).toBe(true);
    expect(svc.busy()).toBe(false);
  });

  it('speak resolves on onerror and moves on to the next chunk', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const p = svc.speak('いち。に。'.repeat(40)); // > 180 chars → 2+ chunks
    synth.fail(0);
    await Promise.resolve();
    expect(synth.spoken.length).toBe(2);
    while (synth.speaking) {
      synth.end();
      await Promise.resolve();
    }
    await expect(p).resolves.toBeUndefined();
  });

  it('the kana reading is used for an isolated word, the plain surface for a sentence', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('日', { kana: 'ひ' });
    expect(synth.spoken[0]?.text).toBe('ひ');
    void svc.speak('{今日|きょう}はいい{日|ひ}ですね。', { kana: 'きょうはいいひですね。' });
    expect(synth.spoken[1]?.text).toBe('今日はいい日ですね。');
    // a short collocation without kana goes to the engine as written
    void svc.speak('日が暮れる');
    expect(synth.spoken[2]?.text).toBe('日が暮れる');
  });

  it('a synth that throws on speak() still resolves', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    synth.speak = () => {
      throw new Error('busy');
    };
    const svc = make(synth);
    await expect(svc.speak('はい。')).resolves.toBeUndefined();
  });

  it('resumes a paused engine before speaking and on the keep-alive tick', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    synth.paused = true;
    void svc.speak('あ'.repeat(40)); // long enough to outlive the first keep-alive tick
    expect(synth.resumes).toBe(1);
    synth.paused = true;
    vi.advanceTimersByTime(4000);
    expect(synth.resumes).toBe(2);
    synth.end();
    synth.paused = true;
    vi.advanceTimersByTime(4000);
    expect(synth.resumes).toBe(2); // idle: no nudge
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Voice slots                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe('dialogue voice slots', () => {
  it('slot a / b use distinct voices when two exist; the learner picks win', () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const svc = make(synth, signal({ ...baseSettings(), ttsVoiceURI: 'uri:O-Ren' }));
    void svc.speak('A。', { voice: 'a' });
    void svc.speak('B。', { voice: 'b' });
    expect(synth.spoken[0]?.voice?.name).toBe('O-Ren');
    expect(synth.spoken[1]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[1]?.pitch).toBe(1);
    expect(synth.spoken[1]?.rate).toBe(1);
  });

  it('with one voice slot b reuses it with the rate/pitch offset', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('A。', { voice: 'a' });
    void svc.speak('B。', { voice: 'b' });
    expect(synth.spoken[0]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[1]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[1]?.pitch).toBe(PAIR_OFFSET.pitch);
    expect(synth.spoken[1]?.rate).toBeCloseTo(PAIR_OFFSET.rate, 6);
  });

  it('an explicit voiceURI override wins over the slots', () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const svc = make(synth);
    void svc.speak('A。', { voice: 'b', voiceURI: 'uri:Kyoko' });
    expect(synth.spoken[0]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[0]?.pitch).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Volume, mute, sfx, warm-up                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

describe('volume and mute', () => {
  it('utterance volume follows settings.sound and setVolume', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal(baseSettings());
    const svc = make(synth, settings);
    void svc.speak('はい。');
    expect(synth.spoken[0]?.volume).toBe(0.8);
    svc.setVolume(0.3);
    void svc.speak('はい。');
    expect(synth.spoken[1]?.volume).toBe(0.3);
    settings.value = { ...settings.value, sound: 0.5 };
    void svc.speak('はい。');
    expect(synth.spoken[2]?.volume).toBe(0.5);
  });

  it('volume 0 mutes and skips speaking entirely but still resolves', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal({ ...baseSettings(), sound: 0 }));
    expect(svc.muted.value).toBe(true);
    await expect(svc.speak('はい。')).resolves.toBeUndefined();
    expect(synth.spoken.length).toBe(0);
  });

  it('canSpeak is false at volume 0 even with a voice, true again once audible; voiceAudible reads it (hasJaVoice for plain services)', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal({ ...baseSettings(), sound: 0 });
    const svc = make(synth, settings);
    expect(svc.hasJaVoice.value).toBe(true);
    expect(svc.canSpeak.value).toBe(false);
    expect(voiceAudible(svc)).toBe(false);
    settings.value = { ...settings.value, sound: 0.4 };
    expect(svc.canSpeak.value).toBe(true);
    expect(voiceAudible(svc)).toBe(true);
    svc.setVolume(0);
    expect(svc.canSpeak.value).toBe(false);
    svc.setVolume(1);
    expect(svc.canSpeak.value).toBe(true);
    // no Japanese voice: never speakable, whatever the volume
    const silent = make(new FakeSynth([en('Alex')]));
    expect(silent.canSpeak.value).toBe(false);
    // a service without `canSpeak` falls back to hasJaVoice
    expect(voiceAudible(nullAudio)).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true) })).toBe(true);
  });

  it('Zen mutes sfx but voices still speak', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal({ ...baseSettings(), feel: 'zen' }));
    expect(svc.muted.value).toBe(true);
    void svc.speak('はい。');
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0]?.volume).toBe(0.8);
  });

  it('sfx plays through the engine at the master volume and is silent when muted', () => {
    const ctxCalls: number[] = [];
    const fakeCtx = {
      sampleRate: 8000,
      currentTime: 0,
      state: 'running',
      destination: {},
      createGain: () => {
        ctxCalls.push(1);
        throw new Error('stop here'); // recipe aborts safely after the master gain
      },
    } as unknown as AudioContext;
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal(baseSettings());
    const svc = make(synth, settings, { ctxFactory: () => fakeCtx });
    svc.sfx('correct');
    expect(ctxCalls.length).toBe(1);
    settings.value = { ...settings.value, feel: 'zen' };
    svc.sfx('correct');
    expect(ctxCalls.length).toBe(1);
    settings.value = { ...settings.value, feel: 'dojo', sound: 0 };
    svc.sfx('correct');
    expect(ctxCalls.length).toBe(1);
  });

  it('warmUp speaks one silent ja utterance once', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    svc.warmUp();
    svc.warmUp();
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0]?.volume).toBe(0);
    expect(synth.spoken[0]?.lang).toBe('ja-JP');
  });

  it('the first gesture on the document warms up and the listener is removed', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal(baseSettings()), { doc: document });
    document.dispatchEvent(new Event('pointerdown'));
    expect(synth.spoken.length).toBe(1);
    document.dispatchEvent(new Event('keydown'));
    expect(synth.spoken.length).toBe(1);
    svc.dispose();
  });

  it('a hashchange (navigation) cancels speech', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal(baseSettings()), { win: window });
    void svc.speak('はい。');
    window.dispatchEvent(new Event('hashchange'));
    expect(synth.cancels).toBe(2);
    expect(svc.busy()).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* No speechSynthesis at all                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('no speechSynthesis', () => {
  it('behaves like nullAudio for voices and resolves speak immediately', async () => {
    const svc = make(null);
    expect(svc.hasJaVoice.value).toBe(false);
    expect(svc.voices()).toEqual([]);
    await expect(svc.speak('はい。')).resolves.toBeUndefined();
    expect(() => svc.cancel()).not.toThrow();
    expect(() => svc.warmUp()).not.toThrow();
    expect(() => svc.sfx('correct')).not.toThrow();
    expect(svc.rateForTier(3)).toBe(1);
  });

  it('dispose removes listeners and stops timers', () => {
    const synth = new FakeSynth([]);
    const svc = make(synth);
    expect(synth.listenerCount('voiceschanged')).toBe(1);
    svc.dispose();
    expect(synth.listenerCount('voiceschanged')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* The voice pack in front of the synth (design 08 §8)                        */
/* ────────────────────────────────────────────────────────────────────────── */

const HANA = 'VOICEVOX:九州そら';
const KEN = 'VOICEVOX:玄野武宏';
const SPRITE = 'audio/sprites/s04/examples-01-00000000.webm';
const cueOf = (key: string, voice = HANA, rate = 1): ClipCue => ({ key, file: SPRITE, start: 0.3, end: 2.4, voice, rate });

interface PlayRecord {
  cue: ClipCue;
  o: ClipPlayOptions;
  finish(r?: { source: 'clips' | 'none'; seconds: number }): void;
}

/** A `ClipPlayer` double: a cue table, a byText table, a cast map and recorded plays whose `done` the test settles. */
class FakeClips implements ClipPlayer {
  ready = signal<ClipReady>('ready');
  info = signal<AudioPackInfo | null>({ audioVersion: 'a-0123456789', contentVersion: 'c-x', engine: 'VOICEVOX', belts: {}, totals: { bytes: 0, seconds: 0, files: 0 }, credits: [HANA, KEN] });
  table: Record<string, ClipCue[]> = {
    'v-n5-0001': [cueOf('v-n5-0001')],
    'v-n5-0001#ga': [cueOf('v-n5-0001#ga')],
    'v-n5-0001#def': [cueOf('v-n5-0001#def')],
    'v-n5-0001#col1': [cueOf('v-n5-0001#col1')],
    'v-n5-0001#ex1': [cueOf('v-n5-0001#ex1'), cueOf('v-n5-0001#ex1', HANA, 0.85)],
    'g-n5-001#ex1': [cueOf('g-n5-001#ex1', HANA), cueOf('g-n5-001#ex1', KEN)],
    's-04-1#L0': [cueOf('s-04-1#L0', KEN)],
    's-04-1#L1': [cueOf('s-04-1#L1', HANA)],
    's-04-1': [cueOf('s-04-1', KEN)],
    'k-h-a': [cueOf('k-h-a')],
    'j-日': [cueOf('j-日')],
    'm-04-1': [cueOf('m-04-1')],
  };
  texts: Record<string, string> = {
    '私はコーヒーを飲みます。': 'v-n5-0001#ex1',
    'おはよう、ハナ。': 's-04-1#L0',
    'おはようございます。今日もよろしくお願いします。': 'g-n5-001#ex1',
    '今日はいい天気ですね。': 'g-n5-001#ex1',
    '石部は、昔、京都から一日で着く宿場町だったそうだ。': 'm-04-1',
  };
  cast: Record<string, string> = { ハナ: HANA, ケン: KEN };
  plays: PlayRecord[] = [];
  stops = 0;
  unlocks = 0;
  disposed = 0;
  prefetched: number[] = [];
  /** The real player's additive `unlocked()` (pool built AND accepted); a test sets it to watch the gesture listeners. */
  unlocked?: () => boolean;
  cueForCalls: [string, { rate?: number; speaker?: string } | undefined][] = [];
  textCalls: string[] = [];
  loadLevel = async (): Promise<void> => undefined;
  loadStation = async (): Promise<void> => undefined;
  prefetchStation(n: number): void {
    this.prefetched.push(n);
  }
  cueFor(key: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined {
    this.cueForCalls.push([key, o]);
    const v = this.table[key];
    if (!v) return undefined;
    let pool = v;
    if (o?.speaker) {
      const want = this.cast[o.speaker];
      const m = want ? v.filter((c) => c.voice === want) : [];
      if (m.length > 0) pool = m;
    }
    return nearestRate(pool, o?.rate ?? 1);
  }
  cueForText(text: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined {
    const spoken = textToSpeak(text);
    this.textCalls.push(spoken);
    // sentences only (the real player's rule): punctuation or more than 8 characters
    if (!/[。！？!?]/.test(spoken) && Array.from(spoken).length <= 8) return undefined;
    const key = this.texts[spoken.replace(/[\s　]+/g, '')];
    return key ? this.cueFor(key, o) : undefined;
  }
  kanaTracks = async (): Promise<never[]> => [];
  play(cue: ClipCue, o: ClipPlayOptions): { done: Promise<{ source: 'clips' | 'none'; seconds: number }>; stop(): void } {
    let resolve: (r: { source: 'clips' | 'none'; seconds: number }) => void = () => undefined;
    const done = new Promise<{ source: 'clips' | 'none'; seconds: number }>((r) => {
      resolve = r;
    });
    this.plays.push({ cue, o, finish: (r = { source: 'clips', seconds: 1.5 }) => resolve(r) });
    return {
      done,
      stop: () => {
        this.stops++;
        resolve({ source: 'clips', seconds: 0.5 });
      },
    };
  }
  unlock(): void {
    this.unlocks++;
  }
  dispose(): void {
    this.disposed++;
  }
  cacheUsage = async (): Promise<{ bytes: number; files: number }> => ({ bytes: 0, files: 0 });
  download = async (): Promise<void> => undefined;
  remove = async (): Promise<void> => undefined;
}

const packSettings = (over: Partial<TtsSettings> = {}): TtsSettings => ({ ...baseSettings(), audioSource: 'pack', ...over });

const settled = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('speak() with a voice pack', () => {
  it('a clip hit bypasses the synth and resolves on done; source reads clips', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips });
    let done = false;
    const p = svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' }).then(() => {
      done = true;
    });
    expect(synth.spoken).toHaveLength(0);
    expect(clips.plays).toHaveLength(1);
    expect(clips.plays[0]?.cue.key).toBe('v-n5-0001#ex1');
    expect(clips.plays[0]?.o).toMatchObject({ rate: 1, volume: 0.8 });
    expect(svc.source.value).toBe('clips');
    expect(audioSourceOf(svc)).toBe('clips');
    expect(svc.busy()).toBe(true);
    await settled();
    expect(done).toBe(false);
    clips.plays[0]!.finish();
    await p;
    expect(done).toBe(true);
    expect(svc.busy()).toBe(false);
    expect(synth.spoken).toHaveLength(0);
  });

  it('with synth undefined (no speechSynthesis) and a cue hit the clip still plays — the guard moved below the clip branch', async () => {
    const clips = new FakeClips();
    const svc = make(null, signal(packSettings()), { clips });
    expect(svc.hasJaVoice.value).toBe(false);
    expect(svc.canSpeak.value).toBe(true); // (hasJaVoice || packReady) && audible
    const p = svc.speak('おはよう、ハナ。', { clip: 's-04-1#L0' });
    expect(clips.plays).toHaveLength(1);
    expect(svc.source.value).toBe('clips');
    clips.plays[0]!.finish();
    await expect(p).resolves.toBeUndefined();
    // a miss without a synth resolves at once with source none
    await expect(svc.speak('飲む', { kana: 'のむ' })).resolves.toBeUndefined();
    expect(svc.source.value).toBe('none');
  });

  it("audioSource 'device' forces the synth even with a pack", async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const settings = signal(packSettings({ audioSource: 'device' }));
    const svc = make(synth, settings, { clips });
    void svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    expect(clips.plays).toHaveLength(0);
    expect(synth.spoken.map((u) => u.text)).toEqual(['私はコーヒーを飲みます。']);
    expect(svc.source.value).toBe('synth');
    settings.value = { ...settings.value, audioSource: 'pack' };
    void svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    expect(clips.plays).toHaveLength(1);
    expect(svc.source.value).toBe('clips');
  });

  it('cancel() stops a playing clip, resolves its promise and never falls through to the synth', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips });
    const p = svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    expect(svc.busy()).toBe(true);
    svc.cancel();
    expect(clips.stops).toBe(1);
    expect(svc.busy()).toBe(false);
    await expect(p).resolves.toBeUndefined();
    expect(synth.spoken).toHaveLength(0);
    // a new speak() interrupts the clip in flight the same way
    const q = svc.speak('おはよう、ハナ。', { clip: 's-04-1#L0' });
    void svc.speak('今日はいい天気ですね。', { clip: 'g-n5-001#ex1' });
    expect(clips.stops).toBe(2);
    await expect(q).resolves.toBeUndefined();
    expect(clips.plays).toHaveLength(3);
    // navigation cancels the clip too
    const nav = make(synth, signal(packSettings()), { clips, win: window });
    void nav.speak('おはよう、ハナ。', { clip: 's-04-1#L0' });
    window.dispatchEvent(new Event('hashchange'));
    expect(clips.stops).toBe(3);
  });

  it('a miss falls through to the utterance path with the a/b slot; a bare word never resolves through text', async () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings({ ttsVoiceURI: 'uri:O-Ren' })), { clips });
    void svc.speak('B。', { clip: 'nope#L9', voice: 'b' });
    expect(clips.plays).toHaveLength(0);
    expect(synth.spoken[0]?.text).toBe('B。');
    expect(synth.spoken[0]?.voice?.name).toBe('Kyoko');
    expect(svc.source.value).toBe('synth');
    void svc.speak('A。', { voice: 'a' });
    expect(synth.spoken[1]?.voice?.name).toBe('O-Ren');
    // a word with kana and no key: synth, kana reading
    void svc.speak('日', { kana: 'ひ' });
    expect(clips.plays).toHaveLength(0);
    expect(synth.spoken[2]?.text).toBe('ひ');
    expect(clips.textCalls).toContain('ひ');
  });

  it("speaker 'ハナ' resolves the cast voice on the clip path and voice 'a' on the synth path", async () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips });
    void svc.speak('今日はいい天気ですね。', { clip: 'g-n5-001#ex1', speaker: 'ハナ', voice: 'b' });
    expect(clips.plays[0]?.cue.voice).toBe(HANA);
    void svc.speak('今日はいい天気ですね。', { clip: 'g-n5-001#ex1', speaker: 'ケン', voice: 'a' });
    expect(clips.plays[1]?.cue.voice).toBe(KEN);
    // byText also honours the speaker
    void svc.speak('今日はいい天気ですね。', { speaker: 'ケン' });
    expect(clips.plays[2]?.cue.voice).toBe(KEN);
    expect(clips.cueForCalls.at(-1)).toEqual(['g-n5-001#ex1', { rate: 1, speaker: 'ケン' }]);
    // pack absent: the synth path keeps the slots, speaker is ignored
    clips.ready.value = 'absent';
    void svc.speak('今日はいい天気ですね。', { clip: 'g-n5-001#ex1', speaker: 'ハナ', voice: 'a' });
    expect(clips.plays).toHaveLength(3);
    expect(synth.spoken[0]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[0]?.pitch).toBe(1);
    void svc.speak('今日はいい天気ですね。', { speaker: 'ハナ', voice: 'b' });
    expect(synth.spoken[1]?.voice?.name).toBe('O-Ren');
  });

  it('the requested rate reaches the pack (nearest native take) and the element (rate / cue.rate is the player’s job)', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const settings = signal(packSettings({ speedTier: 1 }));
    const svc = make(synth, settings, { clips });
    void svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    expect(clips.plays[0]?.cue.rate).toBe(0.85);
    expect(clips.plays[0]?.o.rate).toBe(0.75);
    void svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1', rate: 1.5 });
    expect(clips.plays[1]?.cue.rate).toBe(1);
    expect(clips.plays[1]?.o.rate).toBe(1.5);
    // clause and onProgress ride along to the player
    const onProgress = vi.fn();
    void svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1', clause: [3, 9], onProgress });
    expect(clips.plays[2]?.o.clause).toEqual([3, 9]);
    expect(clips.plays[2]?.o.onProgress).toBe(onProgress);
    expect(clips.plays[2]?.o.wholeTrack).toBeUndefined();
  });

  it("a clip that cannot play (source 'none': pool not unlocked, sprite missing) falls through to the device voice", async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips });
    const p = svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    expect(svc.source.value).toBe('clips');
    clips.plays[0]!.finish({ source: 'none', seconds: 0 });
    await settled();
    expect(synth.spoken.map((u) => u.text)).toEqual(['私はコーヒーを飲みます。']);
    expect(svc.source.value).toBe('synth');
    synth.end();
    await expect(p).resolves.toBeUndefined();
    // without a synth the fall-through resolves quietly with source none
    const kiosk = make(null, signal(packSettings()), { clips });
    const q = kiosk.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    clips.plays[1]!.finish({ source: 'none', seconds: 0 });
    await expect(q).resolves.toBeUndefined();
    expect(kiosk.source.value).toBe('none');
  });

  it('volume 0 resolves at once on the clip path too; canSpeak = (hasJaVoice || packReady) && audible', async () => {
    const clips = new FakeClips();
    const settings = signal(packSettings({ sound: 0 }));
    const svc = make(new FakeSynth([en('Alex')]), settings, { clips });
    expect(svc.hasJaVoice.value).toBe(false);
    expect(svc.packReady.value).toBe(true);
    expect(svc.canSpeak.value).toBe(false);
    expect(voiceAudible(svc)).toBe(false);
    await expect(svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' })).resolves.toBeUndefined();
    expect(clips.plays).toHaveLength(0);
    expect(svc.source.value).toBe('none');
    settings.value = { ...settings.value, sound: 0.5 };
    expect(svc.canSpeak.value).toBe(true);
    clips.ready.value = 'loading';
    expect(svc.packReady.value).toBe(false);
    expect(svc.canSpeak.value).toBe(false);
    clips.ready.value = 'ready';
    expect(svc.canSpeak.value).toBe(true);
    // the pack counts only while chosen: 'device' with no Japanese voice cannot be heard
    settings.value = { ...settings.value, audioSource: 'device' };
    expect(svc.canSpeak.value).toBe(false);
    expect(voiceAudible(svc)).toBe(false);
    settings.value = { ...settings.value, audioSource: 'pack' };
    expect(svc.canSpeak.value).toBe(true);
    // without a pack the old rule holds
    const plain = make(new FakeSynth([ja('Kyoko')]), signal(baseSettings()));
    expect(plain.packReady.value).toBe(false);
    expect(plain.canSpeak.value).toBe(true);
    expect(plain.clips).toBeUndefined();
    expect(plain.clipFor?.('v-n5-0001')).toBeUndefined();
  });

  it('warmUp() unlocks the pack inside the first gesture; clipFor / clips / packReady are set on the service; dispose disposes the player', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips, doc: document });
    expect(svc.clips).toBe(clips);
    expect(svc.clipFor?.('v-n5-0001#ex1', { rate: 0.8 })?.rate).toBe(0.85);
    expect(svc.packReady.value).toBe(true);
    document.dispatchEvent(new Event('pointerdown'));
    expect(clips.unlocks).toBe(1);
    expect(synth.spoken).toHaveLength(1); // the warm-up utterance
    svc.warmUp();
    expect(clips.unlocks).toBe(2); // unlock is idempotent in the real player
    svc.dispose();
    expect(clips.disposed).toBe(1);
  });

  it('interrupt: false queues a clip behind the clip in flight', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips });
    const first = svc.speak('おはよう、ハナ。', { clip: 's-04-1#L0' });
    const second = svc.speak('今日はいい天気ですね。', { clip: 'g-n5-001#ex1', interrupt: false });
    await settled();
    expect(clips.plays).toHaveLength(1);
    expect(clips.stops).toBe(0);
    clips.plays[0]!.finish();
    await first;
    await settled();
    expect(clips.plays).toHaveLength(2);
    expect(clips.plays[1]?.cue.key).toBe('g-n5-001#ex1');
    clips.plays[1]!.finish();
    await expect(second).resolves.toBeUndefined();
  });

  it('source names the voice the next speak() would use before any call: clips with a ready pack, synth with a device voice, none otherwise', () => {
    const clips = new FakeClips();
    const settings = signal(packSettings());
    const packed = make(new FakeSynth([en('Alex')]), settings, { clips });
    expect(packed.source.value).toBe('clips');
    expect(audioSourceOf(packed)).toBe('clips');
    clips.ready.value = 'loading';
    expect(packed.source.value).toBe('none');
    clips.ready.value = 'ready';
    settings.value = { ...settings.value, audioSource: 'device' };
    expect(packed.source.value).toBe('none'); // no Japanese voice and the pack switched off
    const voiced = make(new FakeSynth([ja('Kyoko')]), signal(packSettings({ audioSource: 'device' })), { clips });
    expect(voiced.source.value).toBe('synth');
    const quiet = make(new FakeSynth([ja('Kyoko')]), signal(packSettings({ sound: 0 })), { clips });
    expect(quiet.source.value).toBe('none');
    const plain = make(new FakeSynth([ja('Kyoko')]));
    expect(plain.source.value).toBe('synth');
    expect(make(new FakeSynth([en('Alex')])).source.value).toBe('none');
    // a call pins the source it used
    void plain.speak('はい。');
    expect(plain.source.value).toBe('synth');
    void quiet.speak('はい。');
    expect(quiet.source.value).toBe('none');
  });

  it('the gesture listeners stay until the pack reports its pool accepted (a refused first gesture is retried on the next one); the synth warm-up stays one-shot', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    let accepted = false;
    clips.unlocked = () => accepted;
    const svc = make(synth, signal(packSettings()), { clips, doc: document });
    document.dispatchEvent(new Event('pointerdown'));
    expect(clips.unlocks).toBe(1);
    expect(synth.spoken).toHaveLength(1);
    document.dispatchEvent(new Event('touchend'));
    expect(clips.unlocks).toBe(2);
    expect(synth.spoken).toHaveLength(1);
    accepted = true;
    document.dispatchEvent(new Event('keydown'));
    expect(clips.unlocks).toBe(3);
    document.dispatchEvent(new Event('pointerdown'));
    expect(clips.unlocks).toBe(3); // the listeners went once the pool was accepted
    // an absent pack never keeps the listeners alive
    const gone = new FakeClips();
    gone.ready.value = 'absent';
    gone.unlocked = () => false;
    const synth2 = new FakeSynth([ja('Kyoko')]);
    make(synth2, signal(packSettings()), { clips: gone, doc: document });
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    expect(gone.unlocks).toBe(1);
    svc.dispose();
  });

  it('a pack that is not ready yet (unknown / loading) never delays speak(): the synth speaks', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const clips = new FakeClips();
    clips.ready.value = 'loading';
    const svc = make(synth, signal(packSettings()), { clips });
    void svc.speak('私はコーヒーを飲みます。', { clip: 'v-n5-0001#ex1' });
    expect(clips.plays).toHaveLength(0);
    expect(synth.spoken).toHaveLength(1);
    expect(svc.source.value).toBe('synth');
    expect(clips.cueForCalls).toHaveLength(0);
  });

  it("clipFor(key) applies the pack gate of speak(): undefined while the pack loads or audioSource is 'device', the cue once ready and chosen", () => {
    const clips = new FakeClips();
    clips.ready.value = 'loading';
    const settings = signal(packSettings());
    const svc = make(new FakeSynth([ja('Kyoko')]), settings, { clips });
    expect(svc.clipFor?.('v-n5-0001#ex1')).toBeUndefined();
    expect(clips.cueForCalls).toHaveLength(0); // the player is not even asked
    clips.ready.value = 'ready';
    expect(svc.clipFor?.('v-n5-0001#ex1', { rate: 0.8 })).toMatchObject({ key: 'v-n5-0001#ex1', rate: 0.85 });
    expect(clips.cueForCalls).toHaveLength(1);
    settings.value = { ...settings.value, audioSource: 'device' };
    expect(svc.clipFor?.('v-n5-0001#ex1')).toBeUndefined();
    expect(clips.cueForCalls).toHaveLength(1);
    settings.value = { ...settings.value, audioSource: 'pack' };
    expect(svc.clipFor?.('v-n5-0001#ex1')?.key).toBe('v-n5-0001#ex1');
    expect(svc.clipFor?.('nope')).toBeUndefined(); // a miss is still a miss
    clips.ready.value = 'absent';
    expect(svc.clipFor?.('v-n5-0001#ex1')).toBeUndefined();
    expect(packChosenIn({ audioSource: 'device' })).toBe(false);
    expect(packChosenIn({ audioSource: 'pack' })).toBe(true);
    expect(packChosenIn({})).toBe(true); // absent → 'pack'
  });

  it("the idle source follows state until the first speak(): a pack that becomes ready later flips none → clips; with audioSource 'device' it stays synth / none; voices arriving later flip none → synth", () => {
    // no Japanese voice, pack still loading → text only; the pack landing → synthetic voice
    const clips = new FakeClips();
    clips.ready.value = 'loading';
    const settings = signal(packSettings());
    const svc = make(new FakeSynth([en('Alex')]), settings, { clips });
    expect(audioSourceOf(svc)).toBe('none');
    expect(svc.canSpeak.value).toBe(false);
    clips.ready.value = 'ready';
    expect(audioSourceOf(svc)).toBe('clips');
    expect(svc.canSpeak.value).toBe(true);
    // the learner switches to the device voice: no Japanese voice → text only, and the pack landing changes nothing
    settings.value = { ...settings.value, audioSource: 'device' };
    expect(audioSourceOf(svc)).toBe('none');
    clips.ready.value = 'loading';
    clips.ready.value = 'ready';
    expect(audioSourceOf(svc)).toBe('none');
    // a device voice chosen on purpose stays synth whatever the pack does
    const loading = new FakeClips();
    loading.ready.value = 'loading';
    const voiced = make(new FakeSynth([ja('Kyoko')]), signal(packSettings({ audioSource: 'device' })), { clips: loading });
    expect(audioSourceOf(voiced)).toBe('synth');
    loading.ready.value = 'ready';
    expect(audioSourceOf(voiced)).toBe('synth');
    // voices loading: an empty getVoices() at construction, the Japanese voice arrives on voiceschanged
    const synth = new FakeSynth([]);
    const absent = new FakeClips();
    absent.ready.value = 'absent';
    const late = make(synth, signal(packSettings()), { clips: absent });
    expect(audioSourceOf(late)).toBe('none');
    synth.voices = [ja('Kyoko')];
    synth.fire('voiceschanged');
    expect(audioSourceOf(late)).toBe('synth');
    // the first speak() pins its source; the idle rule no longer applies
    void late.speak('はい。');
    expect(late.source.value).toBe('synth');
    absent.ready.value = 'ready';
    expect(late.source.value).toBe('synth');
  });

  it("with the function form of `settings`, canSpeak and the idle source read audioSource at every re-evaluation, not once at construction: a pack chosen → device switch made before the pack lands keeps it none", () => {
    const clips = new FakeClips();
    clips.ready.value = 'loading';
    const current: TtsSettings = packSettings();
    const svc = make(new FakeSynth([en('Alex')]), undefined, { clips, settings: () => current });
    expect(audioSourceOf(svc)).toBe('none');
    current.audioSource = 'device'; // the learner switches while the pack is still loading
    clips.ready.value = 'ready';
    expect(audioSourceOf(svc)).toBe('none'); // the construction-time 'pack' is not what counts
    expect(svc.canSpeak.value).toBe(false);
    expect(svc.clipFor?.('v-n5-0001#ex1')).toBeUndefined(); // the same gate as speak()
    // back to the pack: the next re-evaluation (a tracked dependency's VALUE changing — a computed never re-runs for a
    // plain-object mutation alone, so the pack's unload is observed before the reload) reads the fresh choice
    current.audioSource = 'pack';
    clips.ready.value = 'loading';
    expect(audioSourceOf(svc)).toBe('none');
    clips.ready.value = 'ready';
    expect(audioSourceOf(svc)).toBe('clips');
    expect(svc.canSpeak.value).toBe(true);
    expect(svc.clipFor?.('v-n5-0001#ex1')?.key).toBe('v-n5-0001#ex1');
  });
});

/**
 * The speak() call sites of the app as they stand (design 08 §8 acceptance): each
 * row mirrors one caller's exact arguments. A sentence reaches the pack through
 * `byText` with no edit; a bare word reaches it only through the clip key the
 * owning drill will pass (`withClip`) — never through its text (homophones).
 */
interface Site {
  site: string;
  text: string;
  opt?: Parameters<WebAudioService['speak']>[1];
  expect: 'clips' | 'synth';
  /** The key the caller will pass once its owner wires `clip`; the row then plays from the pack. */
  withClip?: string;
}

const HELLO = S.voiceTestLine;
const SITES: Site[] = [
  { site: 'SettingsPage voice test', text: HELLO, opt: { kana: HELLO, voiceURI: 'uri:Kyoko' }, expect: 'clips' },
  { site: 'OnboardingPage voice step', text: HELLO, opt: { kana: HELLO }, expect: 'clips' },
  { site: 'Gloss vocab word', text: '飲む', opt: { kana: 'のむ' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'Gloss kanji', text: '日', opt: { kana: 'ひ' }, expect: 'synth', withClip: 'j-日' },
  { site: 'Gloss token', text: 'コーヒー', opt: { kana: 'コーヒー' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'StoryReader line (slot b)', text: 'おはよう、ハナ。', opt: { kana: 'おはよう、ハナ。', voice: 'b' }, expect: 'clips', withClip: 's-04-1#L0' },
  { site: 'ListeningArena line', text: 'おはよう、ハナ。', opt: { voice: 'a', rate: 1.1, interrupt: true }, expect: 'clips', withClip: 's-04-1#L0' },
  { site: 'Recorder model', text: '私はコーヒーを飲みます。', opt: { kana: 'わたしはコーヒーをのみます。' }, expect: 'clips', withClip: 'v-n5-0001#ex1' },
  { site: 'Shadow line', text: '私はコーヒーを飲みます。', opt: { kana: undefined, rate: 1 }, expect: 'clips', withClip: 'v-n5-0001#ex1' },
  { site: 'Shadow isolated word', text: '飲む', opt: { kana: 'のむ', rate: 1 }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'RolePlay partner line', text: 'おはよう、ハナ。', opt: { voice: 'b', rate: 0.9, interrupt: true }, expect: 'clips', withClip: 's-04-1#L0' },
  { site: 'NemesisDossier prompt', text: '飲む', opt: { kana: 'のむ' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'LibraryPage Listen', text: '飲む', opt: { kana: 'のむ' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'KanaEar', text: 'あ', opt: { kana: 'あ' }, expect: 'synth', withClip: 'k-h-a' },
  { site: 'KanaFlash', text: 'あ', opt: { kana: 'あ' }, expect: 'synth', withClip: 'k-h-a' },
  { site: 'KanaForge', text: 'あ', opt: { kana: 'あ' }, expect: 'synth', withClip: 'k-h-a' },
  { site: 'PatternCloze prompt', text: '私はコーヒーを飲みます。', opt: { kana: 'わたしはコーヒーをのみます。' }, expect: 'clips', withClip: 'v-n5-0001#ex1' },
  { site: 'PatternCloze replay (no kana)', text: '私はコーヒーを飲みます。', expect: 'clips', withClip: 'v-n5-0001#ex1' },
  { site: 'ScrollView example line', text: '私はコーヒーを飲みます。', opt: { kana: 'わたしはコーヒーをのみます。' }, expect: 'clips', withClip: 'v-n5-0001#ex1' },
  { site: 'MeaningGuard speakWord', text: '飲む', opt: { kana: 'のむ' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'MeaningGuard speakWord collocation', text: '朝ご飯を食べる', expect: 'synth', withClip: 'v-n5-0001#col1' },
  { site: 'SessionView perception judge', text: '飲む', expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'SentenceListen', text: '私はコーヒーを飲みます。', opt: { kana: undefined, rate: 1.25 }, expect: 'clips', withClip: 'v-n5-0001#ex1' },
  { site: 'MinimalPair (homophones never collapse through text)', text: 'あめ', opt: { kana: 'あめ' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'MichikusaStep', text: '石部は、昔、京都から一日で着く宿場町だったそうだ。', opt: { kana: 'いしべは、むかし、きょうとからいちにちでつくしゅくばまちだったそうだ。' }, expect: 'clips', withClip: 'm-04-1' },
  { site: 'TeachCard head word', text: '飲む', opt: { kana: 'のむ' }, expect: 'synth', withClip: 'v-n5-0001' },
  { site: 'TeachCard example', text: '私はコーヒーを飲みます。', expect: 'clips', withClip: 'v-n5-0001#ex1' },
];

describe('every existing speak() call site plays pack audio with no edit (text) or through its clip key', () => {
  it.each(SITES)('$site', async (row) => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const clips = new FakeClips();
    const svc = make(synth, signal(packSettings()), { clips });
    const p = svc.speak(row.text, row.opt);
    if (row.expect === 'clips') {
      expect(clips.plays, 'played from the pack').toHaveLength(1);
      expect(synth.spoken).toHaveLength(0);
      expect(svc.source.value).toBe('clips');
      clips.plays[0]!.finish();
    } else {
      expect(clips.plays, 'device voice').toHaveLength(0);
      expect(synth.spoken).toHaveLength(1);
      expect(svc.source.value).toBe('synth');
      synth.end();
    }
    await expect(p).resolves.toBeUndefined();
    if (row.withClip) {
      const q = svc.speak(row.text, { ...row.opt, clip: row.withClip });
      expect(clips.plays.at(-1)?.cue.key, `clip ${row.withClip}`).toBe(row.withClip);
      expect(svc.source.value).toBe('clips');
      clips.plays.at(-1)!.finish();
      await expect(q).resolves.toBeUndefined();
    }
  });

  it('the table covers at least the 25 sites of the panel judgment', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(SITES.map((s) => s.site)).size).toBe(SITES.length);
  });
});

describe('installAdvice (the clip-aware install guide)', () => {
  const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  it('says the synthetic voices are playing when the pack is ready, nothing with a device voice, the OS guide otherwise', () => {
    const clips = new FakeClips();
    const packed = make(new FakeSynth([en('Alex')]), signal(packSettings()), { clips });
    expect(installAdvice(packed, UA_IOS)).toBe(S.installPackPlaying);
    expect(S.installPackPlaying).toBe('Synthetic voices (VOICEVOX) are playing; a device voice is optional.');
    clips.ready.value = 'absent';
    expect(installAdvice(packed, UA_IOS)).toBe(S.installIos);
    const voiced = make(new FakeSynth([ja('Kyoko')]), signal(baseSettings()));
    expect(installAdvice(voiced, UA_IOS)).toBe('');
    expect(installAdvice(nullAudio, UA_IOS)).toBe(S.installIos);
    expect(installAdvice({ ...nullAudio, hasJaVoice: signal(true) }, UA_IOS)).toBe('');
    // a service whose last speak() came from clips (source signal) counts as packed
    expect(installAdvice({ ...nullAudio, source: signal<'clips' | 'synth' | 'none'>('clips') }, UA_IOS)).toBe(S.installPackPlaying);
    // the learner's choice gates the pack (contract-tier `packWillSpeak`): a ready pack under audioSource 'device' is the device
    // voice, so with no Japanese voice the OS guide shows; the default settings are the store's ('pack')
    const readyPack = { ...nullAudio, packReady: signal(true) };
    expect(installAdvice(readyPack, UA_IOS, { audioSource: 'device' })).toBe(S.installIos);
    expect(installAdvice(readyPack, UA_IOS, { audioSource: 'pack' })).toBe(S.installPackPlaying);
    expect(installAdvice(readyPack, UA_IOS, {})).toBe(S.installPackPlaying); // absent → 'pack'
    expect(installAdvice(readyPack, UA_IOS)).toBe(S.installPackPlaying);
    expect(installAdvice({ ...readyPack, hasJaVoice: signal(true) }, UA_IOS, { audioSource: 'device' })).toBe('');
    clips.ready.value = 'ready';
    expect(installAdvice(packed, UA_IOS, { audioSource: 'device' })).toBe(S.installIos); // even while the service's own source still reads clips
    expect(installAdvice(packed, UA_IOS)).toBe(S.installPackPlaying);
  });

  it('the honesty vocabulary: no chip label says "recorded"', () => {
    for (const v of [S.sourceClips, S.sourceSynth, S.sourceNone, S.installPackPlaying, S.packAbsent, S.packExplain, S.packLoading]) {
      expect(v.toLowerCase()).not.toContain('recorded');
    }
    expect(S.sourceClips).toBe('synthetic voice (VOICEVOX)');
    expect(S.sourceSynth).toBe('device voice');
    expect(S.sourceNone).toBe('text only');
  });
});
