/**
 * TSUZUKU — kakejiku 'lantern-river' 灯籠流し (design 06 §3).
 *
 * Floating lanterns on dark water at night: one lantern per word learned
 * this month (`wordsThisMonth`, at least your own, at most MAX_LANTERNS),
 * placed in perspective from the far bank to the near shore, each with a
 * point glow and a turbulence-displaced reflection. Behind them a noise
 * ridge of hills, reeds, a seeded moon and star field; the nearest lantern
 * carries a band in the learner's belt colour. Palette sumi + warm #FFD166.
 *
 * Personal text (name, this month's count, date) is returned as TextLayers
 * inside the phone safe zones; the SVG carries no personal text.
 */
import { mulberry32, range, uniform } from '../../shared/hash';
import { SUMI, WARM, WASHI, beltColor, lighten, mix } from '../color';
import { clamp, lerp, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { M, Q, blur, circle, displace, el, ellipse, g, line, linearGradient, path, polyPath, radialGradient, rect, svgDoc, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';

export const MAX_LANTERNS = 96;

interface Lantern {
  x: number;
  y: number;
  /** Body width in px. */
  s: number;
  /** Depth 0 = far bank, 1 = near shore. */
  u: number;
}

/** Perspective placement: more lanterns far away, larger ones near, no overlaps (rejection, seeded). */
export function placeLanterns(seed: number, count: number, w: number, horizon: number, h: number): Lantern[] {
  const rng = mulberry32(seed ^ 0x6c616e74);
  const out: Lantern[] = [];
  const waterH = h - horizon;
  const n = clamp(Math.floor(count), 0, MAX_LANTERNS);
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const u = Math.pow(rng(), 1.6);
      const y = horizon + 10 + u * (waterH - 90);
      const s = lerp(7, 46, u);
      const x = uniform(rng, s, w - s);
      let ok = true;
      for (const o of out) {
        const dx = o.x - x;
        const dy = (o.y - y) * 1.6;
        if (dx * dx + dy * dy < ((o.s + s) * 0.85) ** 2) {
          ok = false;
          break;
        }
      }
      if (ok) {
        out.push({ x, y, s, u });
        break;
      }
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

export function lanternMarkup(l: Lantern, mine: boolean, belt: string): { front: string; refl: string } {
  const { x, y, s } = l;
  const half = s / 2;
  const bodyH = s * 1.2;
  const top = y - bodyH;
  const frame = '#4a3320';
  const front = g({ class: 'lantern' }, [
    circle(x, y - bodyH * 0.55, s * 2.6, { fill: url('glow'), opacity: 0.55 + 0.35 * l.u }),
    path(polyPath([[x - half * 1.3, y], [x + half * 1.3, y], [x + half * 1.08, y + s * 0.18], [x - half * 1.08, y + s * 0.18]], true), { fill: '#241a12' }),
    rect(x - half, top, s, bodyH, { fill: url('paper'), rx: s * 0.05 }),
    line(x, top, x, y, { stroke: frame, 'stroke-width': Math.max(0.6, s * 0.035), opacity: 0.55 }),
    line(x - half, y - bodyH * 0.5, x + half, y - bodyH * 0.5, { stroke: frame, 'stroke-width': Math.max(0.6, s * 0.035), opacity: 0.55 }),
    rect(x - half * 1.1, top - s * 0.12, s * 1.1, s * 0.16, { fill: '#3a2a1a', rx: s * 0.03 }),
    mine ? rect(x - half, y - bodyH * 0.3, s, s * 0.16, { fill: belt }) : '',
  ]);
  const refl = g(undefined, [
    rect(x - half, y + s * 0.18, s, bodyH * 1.6, { fill: url('refl'), opacity: 0.4 + 0.2 * l.u }),
    line(x - s * 1.8, y + bodyH * 0.95, x + s * 1.8, y + bodyH * 0.95, { stroke: WARM, 'stroke-width': Math.max(0.8, s * 0.05), opacity: 0.14 }),
    line(x - s * 1.1, y + bodyH * 1.5, x + s * 1.1, y + bodyH * 1.5, { stroke: WARM, 'stroke-width': Math.max(0.6, s * 0.04), opacity: 0.1 }),
  ]);
  return { front, refl };
}

export function torii(x: number, base: number, size: number, fill: string): string {
  const post = size * 0.09;
  const hh = size * 1.15;
  return g({ fill }, [
    rect(x - size * 0.42, base - hh, post, hh),
    rect(x + size * 0.42 - post, base - hh, post, hh),
    rect(x - size * 0.6, base - hh - post * 0.6, size * 1.2, post * 1.1),
    rect(x - size * 0.46, base - hh + size * 0.22, size * 0.92, post * 0.8),
  ]);
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const horizon = Math.round(h * (phone ? uniform(rng, 0.4, 0.47) : uniform(rng, 0.36, 0.44)));
  const count = clamp(Math.floor(data.wordsThisMonth), 1, MAX_LANTERNS);
  const belt = beltColor(data.belt);

  const skyTop = '#04050b';
  const skyLow = mix(SUMI, '#1F2A6B', 0.42);
  const defs = [
    linearGradient('sky', [[0, skyTop], [0.7, mix(skyTop, skyLow, 0.5)], [1, skyLow]], 90),
    linearGradient('water', [[0, mix(SUMI, '#1F2A6B', 0.26)], [0.45, '#0a0b12'], [1, '#050507']], 90),
    radialGradient('glow', [[0, WARM, 0.5], [0.35, WARM, 0.16], [1, WARM, 0]]),
    linearGradient('paper', [[0, lighten(WARM, 0.6)], [0.5, WARM], [1, '#E58F2A']], 90),
    linearGradient('refl', [[0, WARM, 0.55], [1, WARM, 0]], 90),
    displace('ripple', { baseFrequency: [0.01, 0.08], scale: phone ? 20 : 16, seed: seed % 977, octaves: 2 }),
    blur('haze', 42),
    blur('soft', 6),
  ];

  // Stars: denser toward the top, a few brighter ones.
  const stars: string[] = [];
  const nStars = phone ? 120 : 95;
  for (let i = 0; i < nStars; i++) {
    const x = rng() * w;
    const y = Math.pow(rng(), 1.3) * horizon * 0.88;
    const r = rng() < 0.12 ? uniform(rng, 1.6, 2.4) : uniform(rng, 0.5, 1.3);
    stars.push(circle(x, y, r, { fill: WASHI, opacity: uniform(rng, 0.25, 0.9) }));
  }

  // Moon (seeded presence): a crescent made of a pale disc and a sky-coloured disc.
  const moon: string[] = [];
  if (rng() < 0.65) {
    const mx = uniform(rng, 0.58, 0.9) * w;
    const my = uniform(rng, 0.18, 0.45) * horizon;
    const r = uniform(rng, 0.03, 0.045) * Math.min(w, h);
    const full = rng() < 0.3;
    moon.push(circle(mx, my, r * 2.2, { fill: WASHI, opacity: 0.06, filter: url('haze') }));
    moon.push(circle(mx, my, r, { fill: '#E9E2CF', opacity: 0.9 }));
    if (!full) moon.push(circle(mx + r * 0.5, my - r * 0.22, r * 0.9, { fill: mix(skyTop, skyLow, my / horizon) }));
  }

  // Far bank: two noise ridges, the farther one lighter.
  const hills: string[] = [];
  const farAmp = h * (phone ? 0.07 : 0.12);
  const far = ridge(seed ^ 0x51a7, 44, farAmp);
  const farPts: Pt[] = far.map((v, i) => [(i / (far.length - 1)) * w, horizon - v * 0.6 - 10]);
  hills.push(path(polyPath([[0, horizon + 4], ...farPts, [w, horizon + 4]], true), { fill: '#141827' }));
  const near = ridge(seed ^ 0x2b1d, 52, farAmp * 0.55);
  const nearPts: Pt[] = near.map((v, i) => [(i / (near.length - 1)) * w, horizon - v - 2]);
  hills.push(path(polyPath([[0, horizon + 4], ...nearPts, [w, horizon + 4]], true), { fill: '#0c0e17' }));
  if (rng() < 0.7) {
    const tx = uniform(rng, 0.12, 0.88) * w;
    const idx = Math.round((tx / w) * (near.length - 1));
    const base = horizon - (near[idx] ?? 0) - 2;
    hills.push(torii(tx, base + 2, uniform(rng, 34, 62) * (phone ? 1.2 : 1), '#06070b'));
  }

  // Reeds at both shores.
  let reedD = '';
  const nReeds = range(rng, 22, 44);
  for (let i = 0; i < nReeds; i++) {
    const left = rng() < 0.5;
    const x = left ? uniform(rng, 0, 0.2) * w : uniform(rng, 0.8, 1) * w;
    const base = horizon + uniform(rng, -2, 36);
    const len = uniform(rng, 50, 150) * (phone ? 1.15 : 1);
    const lean = uniform(rng, -28, 28);
    reedD += M(x, base) + Q(x + lean * 0.35, base - len * 0.6, x + lean, base - len);
  }
  const reeds = path(reedD, { stroke: '#06070b', 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' });

  // Water, horizon haze, lanterns and their reflections.
  const water = rect(0, horizon, w, h - horizon, { fill: url('water') });
  const haze = ellipse(w / 2, horizon + 6, w * 0.55, phone ? 70 : 54, { fill: WARM, opacity: 0.16, filter: url('haze') });
  const lanterns = placeLanterns(seed, count, w, horizon, h);
  const mineIdx = lanterns.length - 1;
  const fronts: string[] = [];
  const refls: string[] = [];
  lanterns.forEach((l, i) => {
    const m = lanternMarkup(l, i === mineIdx, belt);
    fronts.push(m.front);
    refls.push(m.refl);
  });

  // Motes drifting above the water.
  const motes: string[] = [];
  const nMotes = range(rng, 22, 38);
  for (let i = 0; i < nMotes; i++) {
    const x = rng() * w;
    const y = horizon + Math.pow(rng(), 0.7) * (h - horizon) * 0.8 - uniform(rng, 10, 120);
    motes.push(circle(x, y, uniform(rng, 1, 2.4), { fill: WARM, opacity: uniform(rng, 0.2, 0.7) }));
  }

  const body = [
    rect(0, 0, w, horizon + 2, { fill: url('sky') }),
    g({ opacity: 0.9 }, stars),
    ...moon,
    ...hills,
    water,
    haze,
    g({ filter: url('ripple') }, refls),
    g(undefined, fronts),
    reeds,
    g({ filter: url('soft') }, motes),
    rect(0, h - 120, w, 120, { fill: url('shore') }),
  ];
  defs.push(linearGradient('shore', [[0, SUMI, 0], [1, SUMI, 0.75]], 90));

  // Text layers (personal text lives here, never in the SVG).
  const safe = safeRect(size);
  const texts: TextLayer[] = [];
  const nameMaxW = phone ? w * 0.62 : w * 0.45;
  // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box (review round 2).
  const nameSize = fitSize(data.nameKana, nameMaxW, phone ? 84 : 76, { max: phone ? 84 : 76 });
  const nameX = phone ? w * 0.08 : w * 0.06;
  const nameY = phone ? safe.y + 150 : h * 0.17;
  texts.push({ text: data.nameKana, x: nameX, y: nameY, size: nameSize, font: FONTS.brush, fill: WASHI, opacity: 0.94, lang: 'ja' });
  texts.push({ text: `${S.wordsThisMonth} ${count}`, x: nameX + 2, y: nameY + (phone ? 66 : 56), size: phone ? 32 : 28, font: FONTS.mincho, fill: WARM, opacity: 0.85, lang: 'ja' });
  const titleX = phone ? w * 0.9 : w * 0.955;
  texts.push({ text: S.lanternTitle, x: titleX, y: phone ? safe.y + 50 : h * 0.07, size: phone ? 30 : 26, font: FONTS.mincho, fill: WASHI, vertical: true, opacity: 0.6, lang: 'ja' });
  texts.push({
    text: eraDate(data.date),
    x: phone ? w * 0.92 : w * 0.95,
    y: phone ? safe.y + safe.h - 30 : h * 0.955,
    size: phone ? 24 : 22,
    font: FONTS.mincho,
    fill: WASHI,
    anchor: 'end',
    opacity: 0.6,
    lang: 'ja',
  });

  const svg = svgDoc({ w, h, bg: skyTop, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: 'lantern-river', living: true, compose };
