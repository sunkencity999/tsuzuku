/**
 * sfx.ts — recipes against a recording fake AudioContext (jsdom has no
 * Web Audio, and no OfflineAudioContext either). The fake records every
 * scheduled AudioParam event, every connect() and every start()/stop(), so
 * the tests can measure each recipe's length and its summed envelope peak.
 */
import { SFX_NAMES, type SfxName } from '../shared/catalog';
import { BOWL_BEAT_HZ, BOWL_FUNDAMENTAL_HZ, BOWL_RATIOS, CEREMONY_TAIKO_AT_MS, GAIN_BUDGET, RECIPES, SFX_DURATION_MS, VIBRATION, createSfx, missingRecipes, noiseBuffer } from './sfx';

/* ────────────────────────────────────────────────────────────────────────── */
/* Fake Web Audio                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

type ParamEvent = { kind: 'set' | 'lin' | 'exp'; value: number; time: number };

class FakeParam {
  events: ParamEvent[] = [];
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'lin', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0)) throw new RangeError('exponentialRamp needs a positive value');
    this.events.push({ kind: 'exp', value, time });
    return this;
  }
  /** Value at `t` inside the scheduled window; `null` outside it. */
  at(t: number): number | null {
    const ev = this.events.slice().sort((a, b) => a.time - b.time);
    if (ev.length === 0) return null;
    const first = ev[0] as ParamEvent;
    const last = ev[ev.length - 1] as ParamEvent;
    if (t < first.time || t > last.time) return null;
    let prev = first;
    for (let i = 1; i < ev.length; i++) {
      const e = ev[i] as ParamEvent;
      if (t < e.time) {
        if (e.kind === 'set') return prev.value;
        const f = (t - prev.time) / Math.max(1e-9, e.time - prev.time);
        if (e.kind === 'lin') return prev.value + (e.value - prev.value) * f;
        return prev.value * Math.pow(e.value / prev.value, f);
      }
      prev = e;
    }
    return last.value;
  }
  window(): [number, number] | null {
    if (this.events.length === 0) return null;
    const times = this.events.map((e) => e.time);
    return [Math.min(...times), Math.max(...times)];
  }
  peak(): number {
    return Math.max(...this.events.map((e) => e.value));
  }
}

class FakeNode {
  readonly kind: string;
  readonly ctx: FakeContext;
  connections: FakeNode[] = [];
  connectedParams: FakeParam[] = [];
  startAt: number | null = null;
  stopAt: number | null = null;
  constructor(ctx: FakeContext, kind: string) {
    this.ctx = ctx;
    this.kind = kind;
    ctx.nodes.push(this);
  }
  connect(target: FakeNode | FakeParam): FakeNode | FakeParam {
    if (target instanceof FakeParam) this.connectedParams.push(target);
    else this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.connections = [];
  }
  start(t: number): void {
    this.startAt = t;
  }
  stop(t: number): void {
    this.stopAt = t;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super(ctx, 'gain');
  }
}
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  constructor(ctx: FakeContext) {
    super(ctx, 'osc');
  }
}
class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super(ctx, 'filter');
  }
}
class FakeDelay extends FakeNode {
  delayTime = new FakeParam(0);
  constructor(ctx: FakeContext) {
    super(ctx, 'delay');
  }
}
class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  constructor(ctx: FakeContext) {
    super(ctx, 'convolver');
  }
}
class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  constructor(ctx: FakeContext) {
    super(ctx, 'buffer');
  }
}
class FakeBuffer {
  readonly channels: Float32Array[];
  constructor(ch: number, length: number, public readonly sampleRate: number) {
    this.channels = Array.from({ length: ch }, () => new Float32Array(length));
  }
  getChannelData(i: number): Float32Array {
    return this.channels[i] as Float32Array;
  }
  get length(): number {
    return (this.channels[0] as Float32Array).length;
  }
}

class FakeContext {
  nodes: FakeNode[] = [];
  sampleRate = 8000; // small: keeps buffer generation fast
  currentTime = 1.5;
  state: 'suspended' | 'running' | 'closed' = 'running';
  destination: FakeNode;
  resumes = 0;
  closes = 0;
  constructor(state: 'suspended' | 'running' = 'running') {
    this.state = state;
    this.destination = new FakeNode(this, 'destination');
  }
  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOsc {
    return new FakeOsc(this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }
  createDelay(): FakeDelay {
    return new FakeDelay(this);
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createBuffer(ch: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(ch, length, rate);
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes++;
    this.state = 'closed';
    return Promise.resolve();
  }
}

const asCtx = (c: FakeContext): AudioContext => c as unknown as AudioContext;

/** Runs a recipe into a fresh fake and returns the context plus the `out` gain. */
function run(name: SfxName): { ctx: FakeContext; out: FakeGain; t: number } {
  const ctx = new FakeContext();
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const t = ctx.currentTime;
  RECIPES[name](asCtx(ctx), t, out as unknown as AudioNode);
  return { ctx, out, t };
}

/** Last scheduled moment of any node in the graph (source stop or envelope end). */
function lastMoment(ctx: FakeContext): number {
  let end = 0;
  for (const n of ctx.nodes) {
    if (n.stopAt !== null) end = Math.max(end, n.stopAt);
    if (n instanceof FakeGain) {
      const w = n.gain.window();
      if (w) end = Math.max(end, w[1]);
    }
  }
  return end;
}

/** Nodes connected straight into `out`. */
function feeders(ctx: FakeContext, out: FakeGain): FakeNode[] {
  return ctx.nodes.filter((n) => n !== out && n.connections.includes(out));
}

/** Max over time of the summed envelope of every gain feeding `out`. */
function summedPeak(ctx: FakeContext, out: FakeGain, from: number, to: number): number {
  const gains = feeders(ctx, out).filter((n): n is FakeGain => n instanceof FakeGain);
  let peak = 0;
  const step = Math.max(0.0005, (to - from) / 4000);
  for (let tau = from; tau <= to; tau += step) {
    let sum = 0;
    for (const g of gains) sum += g.gain.at(tau) ?? 0;
    if (sum > peak) peak = sum;
  }
  return peak;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tests                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

describe('RECIPES coverage', () => {
  it('every SfxName has a recipe and a nominal duration', () => {
    expect(missingRecipes()).toEqual([]);
    for (const n of SFX_NAMES) {
      expect(typeof RECIPES[n]).toBe('function');
      expect(SFX_DURATION_MS[n]).toBeGreaterThan(0);
    }
    expect(Object.keys(RECIPES).sort()).toEqual([...SFX_NAMES].sort());
  });

  it('the design table durations are pinned (01 §5)', () => {
    expect(SFX_DURATION_MS).toMatchObject({
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
      ceremony: 12000,
      wallpaper: 2500,
      tsuzuku: 2400, // 09 §12.1 d76: the struck bowl rings twice the old gliss
    });
  });
});

describe('recipe lengths and headroom', () => {
  it.each([...SFX_NAMES])('%s runs within ±20 % of its nominal length', (name) => {
    const { ctx, t } = run(name);
    const nominal = SFX_DURATION_MS[name] / 1000;
    const actual = lastMoment(ctx) - t;
    expect(actual).toBeGreaterThanOrEqual(nominal * 0.8 - 1e-9);
    expect(actual).toBeLessThanOrEqual(nominal * 1.2 + 1e-9);
  });

  it.each([...SFX_NAMES])('%s never exceeds 0 dBFS at the master bus', (name) => {
    const { ctx, out, t } = run(name);
    // Every feeder is a gain with a finite, non-negative envelope ≤ 1 …
    const feed = feeders(ctx, out);
    expect(feed.length).toBeGreaterThan(0);
    for (const n of feed) {
      expect(n).toBeInstanceOf(FakeGain);
      const g = n as FakeGain;
      expect(g.gain.events.length).toBeGreaterThan(0);
      expect(g.gain.peak()).toBeLessThanOrEqual(1);
      for (const e of g.gain.events) expect(e.value).toBeGreaterThanOrEqual(0);
    }
    // … and their sum over time stays ≤ 1 (0 dBFS) with a float epsilon.
    const peak = summedPeak(ctx, out, t, t + SFX_DURATION_MS[name] / 1000 + 0.05);
    expect(peak).toBeLessThanOrEqual(1 + 1e-6);
    expect(peak).toBeGreaterThan(0.05);
  });

  it.each([...SFX_NAMES])('%s schedules nothing before t and every source stops after it starts', (name) => {
    const { ctx, t } = run(name);
    for (const n of ctx.nodes) {
      if (n.startAt !== null) {
        expect(n.startAt).toBeGreaterThanOrEqual(t - 1e-9);
        expect(n.stopAt).not.toBeNull();
        expect(n.stopAt as number).toBeGreaterThan(n.startAt);
      }
      if (n instanceof FakeGain) for (const e of n.gain.events) expect(e.time).toBeGreaterThanOrEqual(t - 1e-9);
    }
  });

  it('GAIN_BUDGET entries are all within (0, 1]', () => {
    for (const v of Object.values(GAIN_BUDGET)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('tier 3 adds a hi-hat (filtered noise) that tier 1 lacks; wrong is a filtered triangle', () => {
    const tier1 = run('correct').ctx.nodes.filter((n) => n.kind === 'buffer');
    const tier3 = run('correct-tier3').ctx.nodes.filter((n) => n.kind === 'buffer');
    expect(tier1.length).toBe(0);
    expect(tier3.length).toBe(1);
    const wrong = run('wrong').ctx;
    const osc = wrong.nodes.find((n): n is FakeOsc => n instanceof FakeOsc) as FakeOsc;
    expect(osc.type).toBe('triangle');
    const filter = wrong.nodes.find((n): n is FakeFilter => n instanceof FakeFilter) as FakeFilter;
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.events[0]?.value).toBe(600);
  });

  it('promotion uses a Karplus–Strong loop (delay with feedback)', () => {
    const promo = run('promotion').ctx;
    const delays = promo.nodes.filter((n) => n instanceof FakeDelay);
    expect(delays.length).toBe(2);
    for (const d of delays) {
      // feedback: something connects back into the delay
      expect(promo.nodes.some((n) => n !== d && n.connections.includes(d) && n.kind === 'gain')).toBe(true);
    }
  });

  it('tsuzuku is a struck bowl (09 §12.1 d76): sine partials at the bowl ratios over a beating pair, one mallet tap, no pitch ramp, no convolver', () => {
    const { ctx, t } = run('tsuzuku');
    const end = t + SFX_DURATION_MS.tsuzuku / 1000;
    const oscs = ctx.nodes.filter((n): n is FakeOsc => n instanceof FakeOsc);
    // the old recipe was a rising triangle gliss (a "shriek" at the end of every scroll): every oscillator is now a
    // sine whose frequency is SET once and never ramped
    expect(oscs.length).toBe(BOWL_RATIOS.length + 1);
    for (const o of oscs) {
      expect(o.type).toBe('sine');
      expect(o.frequency.events.map((e) => e.kind)).toEqual(['set']);
    }
    const freqs = oscs.map((o) => o.frequency.events[0]?.value as number).sort((a, b) => a - b);
    const want = [BOWL_FUNDAMENTAL_HZ, BOWL_FUNDAMENTAL_HZ + BOWL_BEAT_HZ, ...BOWL_RATIOS.slice(1).map((r) => BOWL_FUNDAMENTAL_HZ * r)].sort((a, b) => a - b);
    for (let i = 0; i < want.length; i++) expect(freqs[i]).toBeCloseTo(want[i] as number, 6);
    // a bowl, not a string: the partials are inharmonic (none sits on an integer multiple of the fundamental)
    for (const r of BOWL_RATIOS.slice(1)) expect(Math.abs(r - Math.round(r))).toBeGreaterThan(0.05);
    // the fundamental pair rings to the end; each higher partial stops sooner than the one below it
    const oscOf = (f: number): FakeOsc => oscs.find((o) => o.frequency.events[0]?.value === f) as FakeOsc;
    const stopOf = (f: number): number => oscOf(f).stopAt as number;
    expect(stopOf(BOWL_FUNDAMENTAL_HZ)).toBeCloseTo(end, 6);
    expect(stopOf(BOWL_FUNDAMENTAL_HZ + BOWL_BEAT_HZ)).toBeCloseTo(end, 6);
    // the pair beats at UNEQUAL amplitudes (2 : 1): equal in-phase sines would cancel to silence every 1 / BOWL_BEAT_HZ s
    const peakOf = (o: FakeOsc): number => Math.max(...ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && o.connections.includes(n)).map((g) => g.gain.peak()));
    expect(peakOf(oscOf(BOWL_FUNDAMENTAL_HZ))).toBeCloseTo(GAIN_BUDGET.bowl, 9);
    expect(peakOf(oscOf(BOWL_FUNDAMENTAL_HZ + BOWL_BEAT_HZ))).toBeCloseTo(GAIN_BUDGET.bowlBeat, 9);
    expect(GAIN_BUDGET.bowl / GAIN_BUDGET.bowlBeat).toBeGreaterThanOrEqual(2);
    const partialStops = BOWL_RATIOS.slice(1).map((r) => stopOf(BOWL_FUNDAMENTAL_HZ * r));
    for (let i = 0; i < partialStops.length; i++) {
      expect(partialStops[i]).toBeLessThan(i === 0 ? end : (partialStops[i - 1] as number));
      expect(partialStops[i]).toBeGreaterThan(t + 0.5);
    }
    // one mallet tap: a single short filtered-noise burst at the strike, nothing else from a buffer
    const bursts = ctx.nodes.filter((n) => n.kind === 'buffer');
    expect(bursts.length).toBe(1);
    expect(bursts[0]?.startAt).toBeCloseTo(t, 9);
    expect((bursts[0]?.stopAt as number) - t).toBeLessThanOrEqual(0.1);
    expect(ctx.nodes.some((n) => n instanceof FakeConvolver)).toBe(false);
    expect(ctx.nodes.some((n) => n instanceof FakeDelay)).toBe(false);
  });

  it('ceremony: three taiko hits then a vibrato flute', () => {
    const { ctx, t } = run('ceremony');
    const oscs = ctx.nodes.filter((n): n is FakeOsc => n instanceof FakeOsc);
    const taiko = oscs.filter((o) => o.frequency.events[0]?.value === 55);
    expect(taiko.length).toBe(3);
    expect(taiko.map((o) => o.startAt)).toEqual([t, t + 0.7, t + 1.4]);
    // the exported table is what the recipe schedules (design 09 §10 D1: one table owns the hits)
    expect(CEREMONY_TAIKO_AT_MS.map((at) => t + at / 1000)).toEqual(taiko.map((o) => o.startAt));
    const lfo = oscs.find((o) => o.frequency.events[0]?.value === 5) as FakeOsc;
    expect(lfo.connectedParams.length + lfo.connections.length).toBeGreaterThan(0);
  });
});

describe('noise buffers', () => {
  it('noise is deterministic, normalised to peak 1 and within [-1, 1]', () => {
    const ctx = new FakeContext();
    const a = noiseBuffer(asCtx(ctx), 0.1);
    const b = noiseBuffer(asCtx(ctx), 0.1);
    expect(Array.from(a.getChannelData(0))).toEqual(Array.from(b.getChannelData(0)));
    let peak = 0;
    for (const v of a.getChannelData(0)) {
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(1, 5);
    const brown = noiseBuffer(asCtx(ctx), 0.1, 'brown');
    expect(Array.from(brown.getChannelData(0))).not.toEqual(Array.from(a.getChannelData(0)));
  });
});

describe('createSfx engine', () => {
  it('creates the context lazily, routes through a master gain at the given volume', () => {
    let made: FakeContext | null = null;
    const engine = createSfx(() => {
      made = new FakeContext();
      return asCtx(made);
    });
    expect(made).toBeNull();
    engine.play('correct', 0.6);
    expect(made).not.toBeNull();
    const ctx = made as unknown as FakeContext;
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.connections.includes(ctx.destination)) as FakeGain;
    expect(master.gain.events[0]?.value).toBe(0.6);
  });

  it('volume 0 plays nothing and never creates a context', () => {
    const factory = vi.fn(() => asCtx(new FakeContext()));
    const engine = createSfx(factory);
    engine.play('correct', 0);
    engine.play('wrong', -1);
    expect(factory).not.toHaveBeenCalled();
  });

  it('clamps volume above 1', () => {
    const ctx = new FakeContext();
    const engine = createSfx(() => asCtx(ctx));
    engine.play('submit', 4);
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.connections.includes(ctx.destination)) as FakeGain;
    expect(master.gain.events[0]?.value).toBe(1);
  });

  it('a throwing factory or an undefined context leaves the engine silent, never throwing', () => {
    const boom = createSfx(() => {
      throw new Error('no audio');
    });
    expect(() => boom.play('kiai', 1)).not.toThrow();
    expect(() => boom.unlock()).not.toThrow();
    expect(boom.ready()).toBe(false);
    const none = createSfx(() => undefined);
    expect(() => none.play('kiai', 1)).not.toThrow();
    expect(none.ready()).toBe(false);
  });

  it('unlock resumes a suspended context and plays a one-sample silent buffer', () => {
    const ctx = new FakeContext('suspended');
    const engine = createSfx(() => asCtx(ctx));
    engine.unlock();
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('running');
    const src = ctx.nodes.find((n): n is FakeBufferSource => n instanceof FakeBufferSource) as FakeBufferSource;
    expect(src.buffer?.length).toBe(1);
    expect(src.connections).toContain(ctx.destination);
    expect(engine.ready()).toBe(true);
  });

  it('play resumes a suspended context too', () => {
    const ctx = new FakeContext('suspended');
    const engine = createSfx(() => asCtx(ctx));
    engine.play('correct', 1);
    expect(ctx.resumes).toBe(1);
  });

  it('haptics follow the design table and are optional', () => {
    const vibrate = vi.fn();
    const engine = createSfx(() => asCtx(new FakeContext()), { vibrate });
    engine.play('correct', 1);
    expect(vibrate).toHaveBeenLastCalledWith(10);
    engine.play('wrong', 1);
    expect(vibrate).toHaveBeenLastCalledWith(30);
    engine.play('badge', 1);
    expect(vibrate).toHaveBeenLastCalledWith([10, 30, 10]);
    vibrate.mockClear();
    engine.play('scroll', 1);
    expect(vibrate).not.toHaveBeenCalled();
    expect(VIBRATION.submit).toBeUndefined();
    const silent = createSfx(() => asCtx(new FakeContext()));
    expect(() => silent.play('badge', 1)).not.toThrow();
  });

  it('a throwing vibrate hook is swallowed', () => {
    const engine = createSfx(() => asCtx(new FakeContext()), {
      vibrate: () => {
        throw new Error('nope');
      },
    });
    expect(() => engine.play('correct', 1)).not.toThrow();
  });

  it('dispose closes the context and a later play creates a fresh one', () => {
    const made: FakeContext[] = [];
    const engine = createSfx(() => {
      const c = new FakeContext();
      made.push(c);
      return asCtx(c);
    });
    engine.play('correct', 1);
    engine.dispose();
    expect(made[0]?.closes).toBe(1);
    engine.play('correct', 1);
    expect(made.length).toBe(2);
  });
});
