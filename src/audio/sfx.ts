/**
 * TSUZUKU — synthesized sound effects (design 01 §5: Web Audio, zero samples).
 *
 * Every `SfxName` has a recipe built from oscillators, filtered noise and a
 * Karplus–Strong delay line (koto); the つづく card ends on a struck bowl (rin:
 * inharmonic sine partials over a detuned pair that beats, 09 §12.1 d76). One
 * lazily created `AudioContext`, unlocked on the first gesture; master volume
 * per call; the caller (tts.ts) mutes in Zen.
 *
 * Headroom: every source passes through a gain whose peak is listed in
 * `GAIN_BUDGET`; the budgets of simultaneously sounding voices sum to ≤ 1,
 * so a recipe can never exceed 0 dBFS at the master bus (`sfx.test.ts`
 * verifies this against a recording fake, since jsdom has no audio).
 *
 * Noise is deterministic (`mulberry32` from `shared/hash`): the same seed
 * yields the same buffer; no unseeded randomness anywhere in this module.
 */
import { SFX_NAMES, type SfxName } from '../shared/catalog';
import { mulberry32 } from '../shared/hash';

/** Nominal length of each effect in ms (design 01 §5 table; `stamp` is the goshuin variant of the badge thump). */
export const SFX_DURATION_MS: Record<SfxName, number> = {
  correct: 90,
  'correct-tier2': 120,
  'correct-tier3': 120,
  wrong: 140,
  submit: 40,
  ippon: 300,
  kiai: 2000,
  promotion: 600,
  scroll: 900,
  badge: 300,
  stamp: 350,
  ceremony: 12000,
  wallpaper: 2500,
  tsuzuku: 2400,
};

/** Haptics (design 01 §5): 10 ms correct, 30 ms wrong, 10-30-10 badge. */
export const VIBRATION: Partial<Record<SfxName, number | number[]>> = {
  correct: 10,
  'correct-tier2': 10,
  'correct-tier3': 10,
  wrong: 30,
  badge: [10, 30, 10],
  stamp: [10, 30, 10],
  ippon: [10, 30, 10],
};

export type Recipe = (ctx: AudioContext, t: number, out: AudioNode) => void;

/* ────────────────────────────────────────────────────────────────────────── */
/* Building blocks                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const NOTE: Record<string, number> = {
  A2: 110,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  C6: 1046.5,
  D5: 587.33,
  A5: 880,
  E6: 1318.5,
};

const EPS = 0.0001;

/** Gain envelope: attack to `peak` over `attack` s, then decay to ~0 by `end` (exponential). */
function envelope(g: GainNode, t: number, peak: number, attack: number, end: number): void {
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(EPS, Math.max(t + attack + 0.001, end));
}

function osc(ctx: AudioContext, type: OscillatorType, freq: number, t: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  return o;
}

/** A voice = oscillator → gain → `out`, started at `t`, stopped at `end`. */
function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, freq: number, t: number, end: number, peak: number, attack = 0.008): OscillatorNode {
  const o = osc(ctx, type, freq, t);
  const g = ctx.createGain();
  envelope(g, t, peak, attack, end);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(end);
  return o;
}

/**
 * Deterministic noise buffer. `color` 'white' is flat; 'brown' is a leaky
 * integrator (deep rumble for taiko / ceremony). Peak normalised to 1.
 */
export function noiseBuffer(ctx: AudioContext, seconds: number, color: 'white' | 'brown' = 'white', seed = 0x5f3759df): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.max(1, Math.floor(seconds * rate));
  const buf = ctx.createBuffer(1, n, rate);
  const data = buf.getChannelData(0);
  const rng = mulberry32(seed);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    let v = w;
    if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      v = last;
    }
    data[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak > 0) for (let i = 0; i < n; i++) data[i] = (data[i] as number) / peak;
  return buf;
}

function noise(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  end: number,
  peak: number,
  o: { color?: 'white' | 'brown'; filter?: { type: BiquadFilterType; freq: number; q?: number; sweepTo?: number }; attack?: number } = {},
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, Math.max(0.05, end - t + 0.05), o.color ?? 'white');
  const g = ctx.createGain();
  envelope(g, t, peak, o.attack ?? 0.004, end);
  let head: AudioNode = src;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(o.filter.freq, t);
    if (o.filter.sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.sweepTo), end);
    if (o.filter.q !== undefined) f.Q.setValueAtTime(o.filter.q, t);
    head.connect(f);
    head = f;
  }
  head.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(end);
  return src;
}

/**
 * Karplus–Strong pluck: a short noise burst into a feedback delay line with a
 * low-pass in the loop. Decay time set by the loop gain. Output peak ≤ `peak`.
 */
function pluck(ctx: AudioContext, out: AudioNode, freq: number, t: number, end: number, peak: number): void {
  const burst = ctx.createBufferSource();
  burst.buffer = noiseBuffer(ctx, 0.02, 'white', 0x9e3779b9);
  const delay = ctx.createDelay(1);
  delay.delayTime.setValueAtTime(1 / freq, t);
  const feedback = ctx.createGain();
  feedback.gain.setValueAtTime(0.985, t);
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.setValueAtTime(Math.min(8000, freq * 6), t);
  const g = ctx.createGain();
  // The loop sums burst + feedback; the burst is ≤ 1 and loop gain < 1, so the
  // output of the loop stays ≤ 1 and `g` sets the headroom.
  envelope(g, t, peak, 0.002, end);
  burst.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  delay.connect(g);
  g.connect(out);
  burst.start(t);
  burst.stop(t + 0.02);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Recipes (design 01 §5)                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

const ms = (n: number): number => n / 1000;

/** Peak gain budget per simultaneous voice; sums per recipe ≤ 1 (see header). */
export const GAIN_BUDGET = {
  arpeggio: 0.22,
  hat: 0.08,
  donk: 0.5,
  click: 0.35,
  drum: 0.5,
  swish: 0.25,
  gongPartial: 0.11,
  koto: 0.4,
  fanfare: 0.16,
  bass: 0.2,
  thump: 0.55,
  slap: 0.3,
  ink: 0.1,
  taiko: 0.45,
  taikoNoise: 0.2,
  shakuhachi: 0.25,
  breath: 0.08,
  chime: 0.2,
  bowl: 0.24,
  bowlBeat: 0.12,
  bowlPartial: 0.16,
  mallet: 0.08,
} as const;

function correct(tier: 1 | 2 | 3): Recipe {
  return (ctx, t, out) => {
    const end = t + ms(tier === 1 ? SFX_DURATION_MS.correct : SFX_DURATION_MS['correct-tier2']);
    // square C5→E5 arpeggio, 8 ms attack, 60 ms decay
    tone(ctx, out, 'square', NOTE.C5 as number, t, Math.min(end, t + 0.068), GAIN_BUDGET.arpeggio);
    tone(ctx, out, 'square', NOTE.E5 as number, t + 0.03, Math.min(end, t + 0.098), GAIN_BUDGET.arpeggio);
    if (tier >= 2) tone(ctx, out, 'square', NOTE.G5 as number, t + 0.06, end, GAIN_BUDGET.arpeggio);
    if (tier >= 3) {
      tone(ctx, out, 'square', NOTE.C6 as number, t + 0.08, end, GAIN_BUDGET.arpeggio);
      noise(ctx, out, t + 0.06, end, GAIN_BUDGET.hat, { filter: { type: 'highpass', freq: 6000 } });
    }
  };
}

const wrong: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.wrong);
  // triangle A2 through a 600 Hz low-pass — a soft "donk", never a buzzer
  const o = osc(ctx, 'triangle', NOTE.A2 as number, t);
  o.frequency.exponentialRampToValueAtTime(90, end);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(600, t);
  const g = ctx.createGain();
  envelope(g, t, GAIN_BUDGET.donk, 0.006, end);
  o.connect(f);
  f.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(end);
};

const submit: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.submit);
  // band-passed noise click at 2 kHz (anvil tap)
  noise(ctx, out, t, end, GAIN_BUDGET.click, { filter: { type: 'bandpass', freq: 2000, q: 6 }, attack: 0.002 });
};

const ippon: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.ippon);
  // 55 Hz sine drum + brush-swish noise sweep
  const drum = osc(ctx, 'sine', 55, t);
  drum.frequency.exponentialRampToValueAtTime(38, end);
  const dg = ctx.createGain();
  envelope(dg, t, GAIN_BUDGET.drum, 0.005, end);
  drum.connect(dg);
  dg.connect(out);
  drum.start(t);
  drum.stop(end);
  noise(ctx, out, t + 0.02, end, GAIN_BUDGET.swish, { filter: { type: 'bandpass', freq: 1200, q: 1.2, sweepTo: 5000 }, attack: 0.04 });
};

/** Inharmonic gong partials (ratios from a measured tam-tam, rounded). */
const GONG_RATIOS = [1, 1.52, 2.21, 2.98, 3.76, 4.41, 5.33, 6.12] as const;

const kiai: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.kiai);
  const base = 98;
  GONG_RATIOS.forEach((r, i) => {
    const partialEnd = end - i * 0.08;
    tone(ctx, out, 'sine', base * r, t, Math.max(t + 0.3, partialEnd), GAIN_BUDGET.gongPartial * (1 - i * 0.07), 0.01);
  });
};

const promotion: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.promotion);
  // two koto plucks (Karplus–Strong delay line), a fourth apart
  pluck(ctx, out, NOTE.D5 as number, t, t + 0.42, GAIN_BUDGET.koto);
  pluck(ctx, out, NOTE.G5 as number, t + 0.18, end, GAIN_BUDGET.koto);
};

const scroll: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.scroll);
  // 5-note square fanfare G4 C5 E5 G5 C6 + triangle bass
  const notes = [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6] as number[];
  notes.forEach((f, i) => {
    const start = t + i * 0.12;
    const stop = i === notes.length - 1 ? end : start + 0.16;
    tone(ctx, out, 'square', f, start, stop, GAIN_BUDGET.fanfare, 0.006);
  });
  tone(ctx, out, 'triangle', (NOTE.G4 as number) / 2, t, end, GAIN_BUDGET.bass, 0.01);
};

const badge: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.badge);
  // hanko thump: 80 Hz sine + paper-slap noise
  const o = osc(ctx, 'sine', 80, t);
  o.frequency.exponentialRampToValueAtTime(50, end);
  const g = ctx.createGain();
  envelope(g, t, GAIN_BUDGET.thump, 0.004, end);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(end);
  noise(ctx, out, t, t + 0.06, GAIN_BUDGET.slap, { filter: { type: 'lowpass', freq: 3000 }, attack: 0.002 });
};

const stamp: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.stamp);
  // goshuin press: thump, paper slap, then a short ink-brush rustle
  const o = osc(ctx, 'sine', 72, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.3);
  const g = ctx.createGain();
  envelope(g, t, GAIN_BUDGET.thump, 0.004, t + 0.3);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + 0.3);
  noise(ctx, out, t, t + 0.05, GAIN_BUDGET.slap, { filter: { type: 'lowpass', freq: 2500 }, attack: 0.002 });
  noise(ctx, out, t + 0.12, end, GAIN_BUDGET.ink, { filter: { type: 'bandpass', freq: 4000, q: 2 }, attack: 0.03 });
};

/**
 * The three taiko hits of `ceremony`, in ms from its start (design 09 §7 E,
 * §10 D1): the ONE table the sound schedules its hits from. The belt ceremony's
 * `BELT_PHASE_AT` (src/art/ceremony/BeltCeremony.tsx) carries the same three
 * figures — the art tier may not import the audio group — and
 * BeltCeremony.test.tsx pins the equality by importing this export.
 */
export const CEREMONY_TAIKO_AT_MS: readonly number[] = [0, 700, 1400];

const ceremony: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.ceremony);
  // taiko ×3 (55 Hz sine pitch-drop + brown noise) at CEREMONY_TAIKO_AT_MS …
  for (const at of CEREMONY_TAIKO_AT_MS) {
    const hit = t + at / 1000;
    const hitEnd = hit + 0.6;
    const o = osc(ctx, 'sine', 55, hit);
    o.frequency.exponentialRampToValueAtTime(32, hitEnd);
    const g = ctx.createGain();
    envelope(g, hit, GAIN_BUDGET.taiko, 0.005, hitEnd);
    o.connect(g);
    g.connect(out);
    o.start(hit);
    o.stop(hitEnd);
    noise(ctx, out, hit, hit + 0.35, GAIN_BUDGET.taikoNoise, { color: 'brown', filter: { type: 'lowpass', freq: 400 }, attack: 0.003 });
  }
  // … then a shakuhachi-like sine with 5 Hz vibrato and breath noise
  const flute = osc(ctx, 'sine', NOTE.D5 as number, t + 2.4);
  const vib = osc(ctx, 'sine', 5, t + 2.4);
  const vibGain = ctx.createGain();
  vibGain.gain.setValueAtTime(6, t + 2.4);
  vib.connect(vibGain);
  vibGain.connect(flute.frequency);
  const fg = ctx.createGain();
  fg.gain.setValueAtTime(EPS, t + 2.4);
  fg.gain.linearRampToValueAtTime(GAIN_BUDGET.shakuhachi, t + 3.4);
  fg.gain.setValueAtTime(GAIN_BUDGET.shakuhachi, t + 9.5);
  fg.gain.exponentialRampToValueAtTime(EPS, end);
  flute.connect(fg);
  fg.connect(out);
  flute.start(t + 2.4);
  flute.stop(end);
  vib.start(t + 2.4);
  vib.stop(end);
  noise(ctx, out, t + 2.4, end, GAIN_BUDGET.breath, { filter: { type: 'bandpass', freq: 2400, q: 0.8 }, attack: 0.8 });
};

/** Pentatonic partials (yo scale over A5). */
const CHIME_FREQS = [880, 987.77, 1174.66, 1318.5] as const;

const wallpaper: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.wallpaper);
  CHIME_FREQS.forEach((f, i) => {
    const start = t + i * 0.22;
    tone(ctx, out, 'sine', f, start, i === CHIME_FREQS.length - 1 ? end : end - (CHIME_FREQS.length - 1 - i) * 0.3, GAIN_BUDGET.chime, 0.004);
  });
};

/**
 * Partials of a struck bowl (rin), as ratios to the fundamental: the first
 * four flexural modes of a singing bowl (measured ≈ 1 : 2.76 : 5.40 : 8.93 —
 * not a string's 1 : 2 : 3, which is why a bowl rings rather than sings a
 * note). Each mode of a real bowl is a doublet a hair apart, so the
 * fundamental is a detuned pair whose beat (`BOWL_BEAT_HZ`) is the slow
 * "wah" of the ring — at UNEQUAL amplitudes (`bowl` 0.24 against `bowlBeat`
 * 0.12): two in-phase sines of equal amplitude cancel to silence twice a
 * second, a tremolo with holes in it; 2 : 1 gives a wah of −9.5 dB.
 * `EndCard.tsx` writes つづく over the first 1,200 ms of it.
 */
export const BOWL_RATIOS = [1, 2.76, 5.4, 8.93] as const;
/** E4: low enough to be a "bong", high enough for a phone speaker to carry it. */
export const BOWL_FUNDAMENTAL_HZ = 329.63;
export const BOWL_BEAT_HZ = 1.5;

/**
 * A ringing voice: `tone()`'s envelope falls from `peak` to `EPS` (1e-4: −64 dB from the 0.16 partial budget) by `end`,
 * which is a pluck's decay — the 2.76 partial is −20 dB by ≈ 0.53 s, and the fundamental run that way over 2.4 s would be
 * −20 dB by ≈ 0.74 s. A bowl's fundamental falls only to `RING_FLOOR` × peak (−40 dB) over the ring — −20 dB near 1.2 s —
 * and is faded to `EPS` in the last 60 ms.
 */
const RING_FLOOR = 0.01;
function ring(ctx: AudioContext, out: AudioNode, freq: number, t: number, end: number, peak: number): void {
  const o = osc(ctx, 'sine', freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(peak * RING_FLOOR, end - 0.06);
  g.gain.exponentialRampToValueAtTime(EPS, end);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(end);
}

const tsuzuku: Recipe = (ctx, t, out) => {
  const end = t + ms(SFX_DURATION_MS.tsuzuku);
  // the mallet: one short band-passed tap (wood meeting the rim)
  noise(ctx, out, t, t + 0.07, GAIN_BUDGET.mallet, { filter: { type: 'bandpass', freq: 2600, q: 1.2 }, attack: 0.002 });
  // the bowl: four partials, each higher one quieter and shorter; the fundamental is a beating pair that rings to the end
  const decays = [end, t + 1.7, t + 1.1, t + 0.7] as const;
  BOWL_RATIOS.forEach((r, i) => {
    const f = BOWL_FUNDAMENTAL_HZ * r;
    const stop = decays[i] ?? end;
    if (i === 0) {
      ring(ctx, out, f, t, stop, GAIN_BUDGET.bowl);
      ring(ctx, out, f + BOWL_BEAT_HZ, t, stop, GAIN_BUDGET.bowlBeat);
    } else {
      tone(ctx, out, 'sine', f, t, stop, GAIN_BUDGET.bowlPartial * (1 - (i - 1) * 0.3), 0.004);
    }
  });
};

export const RECIPES: Record<SfxName, Recipe> = {
  correct: correct(1),
  'correct-tier2': correct(2),
  'correct-tier3': correct(3),
  wrong,
  submit,
  ippon,
  kiai,
  promotion,
  scroll,
  badge,
  stamp,
  ceremony,
  wallpaper,
  tsuzuku,
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Engine                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SfxEngine {
  /** Plays `name` at master `volume` (0–1); silent at 0 or without a context. Never throws. */
  play(name: SfxName, volume: number): void;
  /** Creates / resumes the context on a user gesture (also plays a silent tick to unlock iOS). */
  unlock(): void;
  /** The context exists and is running. */
  ready(): boolean;
  /** Closes the context (tests, teardown). */
  dispose(): void;
}

export interface SfxOptions {
  /** `navigator.vibrate`-shaped haptics hook; omitted → no haptics. */
  vibrate?: (pattern: number | number[]) => unknown;
}

/**
 * One lazily created `AudioContext`. `ctxFactory` may throw or return
 * `undefined` where Web Audio is missing; the engine then stays silent.
 */
export function createSfx(ctxFactory: () => AudioContext | undefined, o: SfxOptions = {}): SfxEngine {
  let ctx: AudioContext | undefined;
  let failed = false;

  const ensure = (): AudioContext | undefined => {
    if (ctx || failed) return ctx;
    try {
      ctx = ctxFactory();
      if (!ctx) failed = true;
    } catch {
      failed = true;
    }
    return ctx;
  };

  const resume = (c: AudioContext): void => {
    if (c.state === 'suspended' && typeof c.resume === 'function') {
      try {
        void c.resume().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  };

  return {
    play(name, volume) {
      const v = Math.max(0, Math.min(1, volume));
      if (v <= 0) return;
      const recipe = RECIPES[name];
      if (!recipe) return;
      const c = ensure();
      if (c) {
        resume(c);
        try {
          const master = c.createGain();
          master.gain.setValueAtTime(v, c.currentTime);
          master.connect(c.destination);
          recipe(c, c.currentTime, master);
        } catch {
          /* a broken context must never break a rep */
        }
      }
      const pattern = VIBRATION[name];
      if (pattern !== undefined && o.vibrate) {
        try {
          o.vibrate(pattern);
        } catch {
          /* ignore */
        }
      }
    },
    unlock() {
      const c = ensure();
      if (!c) return;
      resume(c);
      try {
        // A one-sample silent buffer: the canonical iOS unlock.
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, c.sampleRate);
        src.connect(c.destination);
        src.start(c.currentTime);
      } catch {
        /* ignore */
      }
    },
    ready() {
      return !!ctx && ctx.state === 'running';
    },
    dispose() {
      if (ctx && typeof ctx.close === 'function') {
        try {
          void ctx.close().catch(() => undefined);
        } catch {
          /* ignore */
        }
      }
      ctx = undefined;
      failed = false;
    },
  };
}

/** Every catalog name has a recipe and a duration (checked by tests and at import). */
export function missingRecipes(): SfxName[] {
  return SFX_NAMES.filter((n) => !(n in RECIPES) || !(n in SFX_DURATION_MS));
}
