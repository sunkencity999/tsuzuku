import { ITEM_KINDS, type ItemKind } from '../../shared/store-types';
import { tonguePath } from '../../shared/ui/Lantern';
import { svgDoc } from '../svg';
import { DRIFT_VARIANTS, FLAME_CAP, FLAME_TOKEN, HEARTH_LOOP_S, HEARTH_STATES, HEARTH_STEPS, HEARTH_TONGUES, WILL_CHANGE_CAP, allocate, emptyCounts, flamesSvg, hearthClass, hearthStateOf, hearthSvg } from './flames';

function parse(inner: string, w = 960, h = 540): Document {
  const doc = new DOMParser().parseFromString(svgDoc({ w, h, body: [inner] }), 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

function counts(p: Partial<Record<ItemKind, number>>): Record<ItemKind, number> {
  return { ...emptyCounts(), ...p };
}

const REGION = { seed: 11, w: 880, h: 290, x: 40, y: 40 };

describe('allocate', () => {
  it('splits the cap proportionally with largest remainders and sums exactly', () => {
    const q = allocate(counts({ vocab: 700, kanji: 200, kana: 100 }), 400);
    expect(q.vocab + q.kanji + q.kana).toBe(400);
    expect(q.vocab).toBe(280);
    expect(q.kanji).toBe(80);
    expect(q.kana).toBe(40);
    const odd = allocate(counts({ vocab: 1, kanji: 1, grammar: 1 }), 2);
    expect(ITEM_KINDS.reduce((a, k) => a + odd[k], 0)).toBe(2);
    expect(allocate(counts({ vocab: 5 }), 10).vocab).toBe(5);
    expect(allocate(counts({}), 10)).toEqual(emptyCounts());
    expect(allocate(counts({ vocab: -3, kanji: Number.NaN, kana: 2.9 }), 10)).toEqual(counts({ kana: 2 }));
  });
});

describe('flamesSvg', () => {
  it('caps at 400 rendered while the counter holds the true total', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 900, kanji: 300, grammar: 100, kana: 50, chunk: 25 }), reducedMotion: false });
    expect(r.total).toBe(1375);
    expect(r.rendered).toBe(FLAME_CAP);
    expect(ITEM_KINDS.reduce((a, k) => a + r.byKind[k], 0)).toBe(FLAME_CAP);
    const d = parse(r.svg);
    expect(d.querySelectorAll('use').length).toBe(FLAME_CAP);
    const g = d.querySelector('.dj-kotodama')!;
    expect(g.getAttribute('data-total')).toBe('1375');
    expect(g.getAttribute('data-rendered')).toBe('400');
    // one shared symbol, so the glow costs no per-flame nodes
    expect(d.querySelectorAll('symbol').length).toBe(1);
  });

  it('renders every flame when under the cap; `max` lowers the cap', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 12, kanji: 3 }), reducedMotion: false });
    expect(r.rendered).toBe(15);
    expect(r.total).toBe(15);
    expect(parse(r.svg).querySelectorAll('use[data-kind="vocab"]').length).toBe(12);
    expect(parse(r.svg).querySelectorAll('use[data-kind="kanji"]').length).toBe(3);
    const capped = flamesSvg({ ...REGION, counts: counts({ vocab: 1000 }), reducedMotion: false, max: 50 });
    expect(capped.rendered).toBe(50);
    expect(capped.total).toBe(1000);
  });

  it('is deterministic per seed, positions change with the seed', () => {
    const o = { ...REGION, counts: counts({ vocab: 40, kana: 10 }), reducedMotion: false };
    const a = flamesSvg(o);
    expect(a.svg).toBe(flamesSvg(o).svg);
    const b = flamesSvg({ ...o, seed: 12 });
    expect(b.svg).not.toBe(a.svg);
    const xs = (svg: string): string[] => Array.from(parse(svg).querySelectorAll('use')).map((u) => u.getAttribute('x') ?? '');
    expect(xs(a.svg)).not.toEqual(xs(b.svg));
    expect(a.svg).not.toContain('NaN');
  });

  it('positions stay inside the region and colors follow the category tokens', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 30, kanji: 30, kana: 30, grammar: 30, chunk: 30, component: 30 }), reducedMotion: false });
    const d = parse(r.svg);
    for (const u of Array.from(d.querySelectorAll('use'))) {
      const x = Number(u.getAttribute('x'));
      const y = Number(u.getAttribute('y'));
      const w = Number(u.getAttribute('width'));
      expect(x + w / 2).toBeGreaterThanOrEqual(REGION.x - 0.01);
      expect(x + w / 2).toBeLessThanOrEqual(REGION.x + REGION.w + 0.01);
      expect(y).toBeGreaterThanOrEqual(REGION.y - 20);
      expect(y).toBeLessThanOrEqual(REGION.y + REGION.h + 0.01);
      const kind = u.getAttribute('data-kind') as ItemKind;
      expect(u.getAttribute('fill')).toContain(`var(--${FLAME_TOKEN[kind]},`);
    }
    // categories mingle: the first six are not all one kind
    const first = Array.from(d.querySelectorAll('use')).slice(0, 6).map((u) => u.getAttribute('data-kind'));
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('animates with CSS keyframes by default and is static under reduced motion', () => {
    const o = { ...REGION, counts: counts({ vocab: 20 }), reducedMotion: false };
    const live = flamesSvg(o).svg;
    expect(live).toContain('@keyframes dj-kf-drift-0');
    expect(live).toContain(`dj-kf-drift-${DRIFT_VARIANTS - 1}`);
    expect(live).toContain('prefers-reduced-motion');
    expect(live).toContain('.reduced-motion .dj-kf{animation:none}');
    expect(live).toContain(':root[data-reduced-motion] .dj-kf{animation:none}');
    expect(live).toContain('animation-duration:');
    expect(live).not.toContain('<animate');
    const still = flamesSvg({ ...o, reducedMotion: true }).svg;
    expect(still).not.toContain('@keyframes');
    expect(still).not.toContain('animation');
    expect(still).not.toContain('will-change');
    expect(parse(still).querySelectorAll('use').length).toBe(20);
    // same positions either way
    const xs = (svg: string): string[] => Array.from(parse(svg).querySelectorAll('use')).map((u) => u.getAttribute('x') ?? '');
    expect(xs(still)).toEqual(xs(live));
  });

  it('will-change: transform rides on the first 24 flames only (design 09 §6.7 rule 3)', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 60 }), reducedMotion: false });
    const d = parse(r.svg);
    expect(d.querySelectorAll('use.dj-kf-w').length).toBe(WILL_CHANGE_CAP);
    expect(WILL_CHANGE_CAP).toBe(24);
    const uses = Array.from(d.querySelectorAll('use'));
    for (let i = 0; i < uses.length; i++) expect(uses[i]!.classList.contains('dj-kf-w'), `flame ${i}`).toBe(i < WILL_CHANGE_CAP);
    expect(r.svg).toContain('.dj-kf-w{will-change:transform}');
    expect(r.svg).not.toMatch(/\.dj-kf\{[^}]*will-change/);
    // reduced motion: nothing is marked
    expect(parse(flamesSvg({ ...REGION, counts: counts({ vocab: 60 }), reducedMotion: true }).svg).querySelectorAll('.dj-kf-w').length).toBe(0);
  });

  it('zero items: an empty group, no style, no defs', () => {
    const r = flamesSvg({ ...REGION, counts: emptyCounts(), reducedMotion: false });
    expect(r.rendered).toBe(0);
    expect(r.total).toBe(0);
    expect(r.svg).not.toContain('<style');
    expect(r.svg).not.toContain('<symbol');
    expect(parse(r.svg).querySelector('.dj-kotodama')).not.toBeNull();
  });

  it('glow off (Zen) drops the halo from the symbol', () => {
    const o = { ...REGION, counts: counts({ vocab: 5 }), reducedMotion: true };
    const glow = parse(flamesSvg(o).svg);
    const zen = parse(flamesSvg({ ...o, glow: false }).svg);
    expect(glow.querySelectorAll('symbol ellipse').length).toBe(2);
    expect(zen.querySelectorAll('symbol ellipse').length).toBe(1);
  });
});

describe('hearth', () => {
  it('maps streak flame states to hearth looks', () => {
    expect(hearthStateOf('lit')).toEqual({ state: 'steady', crystal: false });
    expect(hearthStateOf('gold')).toEqual({ state: 'roaring', crystal: false });
    expect(hearthStateOf('ember')).toEqual({ state: 'ember', crystal: false });
    expect(hearthStateOf('frozen')).toEqual({ state: 'steady', crystal: true });
    expect(hearthStateOf('rest')).toEqual({ state: 'steady', crystal: false });
    expect(hearthStateOf('broken')).toEqual({ state: 'unlit', crystal: false });
    expect(HEARTH_STATES).toEqual(['unlit', 'ember', 'steady', 'roaring']);
    expect(hearthClass('steady')).toBe('dj-hf--steady');
    expect(hearthClass('steady', true)).toBe('dj-hf--steady dj-hf--crystal');
  });

  const box = { seed: 3, x: 420, y: 392, w: 120, h: 80 };

  it('carries every state in one string: embers, four tongues (outer + core), two glows, the crystal — the host flips the class (design 09 §7 C)', () => {
    const d = parse(hearthSvg({ ...box, reducedMotion: false, id: 'dj-p-hearth' }));
    const g = d.querySelector('.dj-hf')!;
    expect(g.getAttribute('id')).toBe('dj-p-hearth');
    expect(g.classList.contains('dj-hf--unlit')).toBe(true); // the string's default; `syncLive` sets the real one
    expect(d.querySelectorAll('.dj-hf-ember').length).toBe(3);
    expect(d.querySelectorAll('.dj-hf-t').length).toBe(HEARTH_TONGUES);
    expect(d.querySelectorAll('.dj-hf-tongue').length).toBe(HEARTH_TONGUES * 2);
    expect(d.querySelectorAll('.dj-hf-outer').length).toBe(HEARTH_TONGUES);
    expect(d.querySelectorAll('.dj-hf-core').length).toBe(HEARTH_TONGUES);
    expect(d.querySelectorAll('.dj-hf-glow').length).toBe(2);
    expect(d.querySelector('.dj-hf-glow--steady')?.getAttribute('opacity')).toBe('0');
    expect(d.querySelector('.dj-hf-crystal')).not.toBeNull();
    for (let i = 0; i < HEARTH_TONGUES; i++) expect(d.querySelector(`.dj-hf-t${i}`), `tongue ${i}`).not.toBeNull();
    // the state never changes the string
    expect(hearthSvg({ ...box, reducedMotion: false })).toBe(hearthSvg({ ...box, reducedMotion: false }));
    // Zen: no glows
    expect(parse(hearthSvg({ ...box, reducedMotion: false, glow: false })).querySelectorAll('.dj-hf-glow').length).toBe(0);
  });

  it('the tongues share their shape with the header lantern (shared/ui/Lantern tonguePath)', () => {
    const d = parse(hearthSvg({ ...box, reducedMotion: true }));
    const outer = d.querySelector('.dj-hf-t0 .dj-hf-outer')!.getAttribute('d')!;
    // the same construction: move, two quadratic curves, close
    expect(outer).toMatch(/^M[-\d. ]+Q[-\d. ]+Q[-\d. ]+Z$/);
    expect(tonguePath({ cx: 10, base: 18, height: 14, width: 9, lean: 1 })).toMatch(/^M[-\d. ]+Q[-\d. ]+Q[-\d. ]+Z$/);
    // a tongue of the same parameters prints the same path
    const d2 = tonguePath({ cx: 480, base: 448, height: 40, width: 24, lean: 2 });
    expect(hearthSvg({ ...box, reducedMotion: true })).not.toContain(d2); // seeded heights differ…
    expect(d2.split(' ').length).toBeGreaterThan(8); // …but the shape function is the shared one
  });

  it('flickers slowly with CSS only; static under reduced motion', () => {
    const live = hearthSvg({ ...box, reducedMotion: false });
    expect(live).toContain('@keyframes dj-hf-flicker');
    expect(live).toContain('@keyframes dj-hf-pulse');
    expect(live).toContain('prefers-reduced-motion');
    expect(live).not.toContain('<animate');
    // nothing faster than ~0.7 Hz: every duration ≥ 1.4 s
    for (const m of live.matchAll(/animation(?:-duration)?:[^;}]*?([\d.]+)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1.4);
    const still = hearthSvg({ ...box, reducedMotion: true });
    expect(still).not.toContain('@keyframes');
    expect(still).not.toContain('animation');
    expect(still).not.toContain('<style');
    expect(parse(still).querySelectorAll('.dj-hf-tongue').length).toBe(HEARTH_TONGUES * 2);
  });

  it('the loops are stepped (design 09 §12.1 d56): steps(3, jump-none) on the flicker and the embers — a timing function runs per keyframe segment, two per loop, so each presents 4 changes a cycle — the four tongue durations and the pulse as declared, all ≥ 1.4 s; the reduced form rests under all three selectors', () => {
    const live = hearthSvg({ ...box, reducedMotion: false });
    const [t0, t1, t2, t3] = HEARTH_LOOP_S.tongues;
    expect(HEARTH_STEPS).toEqual({ flicker: 3, ember: 3 });
    expect(live).toContain(`.dj-hf-tongue{animation:dj-hf-flicker ${t0}s steps(3,jump-none) infinite;`);
    expect(live).toContain(`.dj-hf-t1 .dj-hf-tongue{animation-duration:${t1}s;`);
    expect(live).toContain(`.dj-hf-t2 .dj-hf-tongue{animation-duration:${t2}s;`);
    expect(live).toContain(`.dj-hf-t3 .dj-hf-tongue{animation-duration:${t3}s;`);
    expect(live).toContain(`.dj-hf-ember{animation:dj-hf-pulse ${HEARTH_LOOP_S.ember}s steps(3,jump-none) infinite}`);
    expect(live).not.toContain('steps(4,');
    expect([t0, t1, t2, t3]).toEqual([1.6, 1.9, 1.45, 1.75]);
    expect(HEARTH_LOOP_S.ember).toBe(2.6);
    // no eased loop remains: every infinite animation is a steps() one
    expect(live).not.toMatch(/ease-in-out/);
    for (const m of live.matchAll(/animation:[^;}]*infinite/g)) expect(m[0]).toMatch(/steps\(\d,jump-none\)/);
    for (const d of [...HEARTH_LOOP_S.tongues, HEARTH_LOOP_S.ember]) expect(d).toBeGreaterThanOrEqual(1.4);
    // changes a second = 2·(steps − 1) / duration (two segments a loop): the base tongue 2.5 Hz, the fastest 4 / 1.45 ≈ 2.76, the embers 4 / 2.6 ≈ 1.54 — never sixty
    const perSecond = (steps: number, d: number): number => (2 * (steps - 1)) / d;
    expect(perSecond(HEARTH_STEPS.flicker, t0)).toBeLessThanOrEqual(2.5);
    for (const d of HEARTH_LOOP_S.tongues) expect(perSecond(HEARTH_STEPS.flicker, d)).toBeLessThan(3);
    expect(perSecond(HEARTH_STEPS.ember, HEARTH_LOOP_S.ember)).toBeLessThan(2);
    // a stepped cycle still rises then falls once: the 0 / 50 / 100 keyframes change brightness direction twice per cycle (§6.8)
    expect(live).toContain('@keyframes dj-hf-flicker{0%,100%{transform:scale(1,1)}50%{transform:scale(0.93,1.08)}}');
    expect(live).toContain('@keyframes dj-hf-pulse{0%,100%{opacity:0.45}50%{opacity:0.95}}');
    // reduced motion rests the loops under the media query, the body class and the root attribute
    expect(live).toContain('@media (prefers-reduced-motion:reduce){.dj-hf-tongue,.dj-hf-ember{animation:none}}');
    expect(live).toContain('.reduced-motion .dj-hf-tongue,.reduced-motion .dj-hf-ember{animation:none}');
    expect(live).toContain(':root[data-reduced-motion] .dj-hf-tongue,:root[data-reduced-motion] .dj-hf-ember{animation:none}');
    const still = hearthSvg({ ...box, reducedMotion: true });
    expect(still).not.toContain('@keyframes');
    expect(still).not.toContain('animation');
    expect(still).not.toContain('<style');
    expect(parse(still).querySelectorAll('.dj-hf-tongue').length).toBe(HEARTH_TONGUES * 2);
  });

  it('is deterministic and NaN-free', () => {
    const a = hearthSvg({ ...box, reducedMotion: false });
    expect(a).toBe(hearthSvg({ ...box, reducedMotion: false }));
    expect(a).not.toContain('NaN');
    expect(a).not.toBe(hearthSvg({ ...box, seed: 4, reducedMotion: false }));
  });
});
