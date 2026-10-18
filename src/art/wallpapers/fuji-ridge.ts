/**
 * TSUZUKU — kakejiku 'fuji-ridge' 富士の線 (design 06 §3).
 *
 * A minimal Fuji in prussian kon on washi whose ridge IS the learner's last
 * 90 days of minutes: the classic concave cone is the envelope, each day's
 * minutes lift or notch it, and the result is smoothed into one clean line.
 *
 * Layers: banded bokashi sky → optional shu sun → Fuji with its snow cap and
 * the data line in the belt colour → far foothills → mist band → the lake
 * with a faint inverted Fuji (逆さ富士) and water lines → birds.
 * Personal text (name in tategaki, 90-day caption, era date, a hanko with
 * the chosen kanji) is returned as TextLayers inside the phone safe zone.
 * Pure: identical (seed, data, size) → byte-identical SVG.
 */
import { chance, hashSeed, mulberry32, range, uniform } from '../../shared/hash';
import { INK, INK_WASH, PALETTE, WASHI, WASHI_LIGHT, beltColor, darken, mix } from '../color';
import { clamp, resample, smooth, smoothstep, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, tategakiLayers, type TextLayer } from '../jtext';
import { noise1, ridge } from '../noise';
import { M, Q, blur, circle, el, g, linearGradient, path, polyPath, rect, safeRect, sizeOf, svgDoc, url } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const KON = PALETTE.light.kon;
const KON_DEEP = darken(KON, 0.42);
const SHU = PALETTE.light.shu;
const DAYS = 90;

/** Concave Fuji envelope over u ∈ [-1, 1] with a flat crater rim (|u| < 0.045). */
export function fujiProfile(u: number): number {
  const a = Math.min(1, Math.abs(u));
  const e = (1 - a) ** 1.7;
  const rim = (1 - 0.045) ** 1.7;
  return Math.min(1, e / rim);
}

/** 90 values in [0, 1]: minutes normalised to the busiest day, lightly smoothed. */
function normalizedMinutes(minutes: readonly number[]): number[] {
  const src: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    const v = minutes[minutes.length - DAYS + i];
    src.push(typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  }
  const max = Math.max(1, ...src);
  const pts: Pt[] = src.map((m, i) => [i, clamp(m / max, 0, 1)]);
  return smooth(pts, 2).map((p) => p[1]);
}

export const spec: WallpaperSpec = {
  id: 'fuji-ridge',
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const snowNoise = noise1(mulberry32(hashSeed(seed, 'snow')));
    const waterNoise = noise1(mulberry32(hashSeed(seed, 'water')));
    const belt = beltColor(data.belt);

    const horizon = Math.round(h * (phone ? 0.6 : 0.64));
    const peakH = h * (phone ? 0.3 : 0.5) * uniform(rng, 0.92, 1.08);
    const cx = w / 2 + (phone ? 0 : uniform(rng, -0.06, 0.06) * w);
    const halfW = phone ? w * uniform(rng, 0.8, 0.96) : w * uniform(rng, 0.56, 0.68);
    const phase = uniform(rng, 0, 10);

    const defs: string[] = [];
    const body: string[] = [];

    /* Sky: bokashi gradient plus hard-edged print bands */
    defs.push(linearGradient('fr-sky', [[0, KON_DEEP], [0.55, KON], [1, mix(KON, WASHI, 0.72)]], 90));
    body.push(rect(0, 0, w, horizon, { fill: url('fr-sky') }));
    const bands = range(rng, 5, 8);
    const bandParts: string[] = [];
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const t1 = (i + 1) / bands;
      const y0 = horizon * t0 ** 1.3;
      const y1 = horizon * t1 ** 1.3;
      const c = mix(KON_DEEP, WASHI, t0 ** 0.85 * 0.9);
      bandParts.push(rect(0, y0, w, y1 - y0 + 1, { fill: c, opacity: 0.42 }));
      if (i > 0) bandParts.push(rect(0, y0, w, 2, { fill: WASHI, opacity: 0.16 }));
    }
    body.push(g({ 'shape-rendering': 'crispEdges' }, bandParts));

    /* Sun (seeded): a shu disc with a soft twin */
    if (chance(rng, 0.62)) {
      const side = chance(rng, 0.5) ? -1 : 1;
      const sx = cx + side * uniform(rng, 0.2, 0.34) * w;
      const sy = horizon - peakH * uniform(rng, 0.78, 1.18);
      const sr = Math.min(w, h) * uniform(rng, 0.05, 0.08);
      defs.push(blur('fr-sun-glow', sr * 0.5));
      body.push(circle(sx, sy, sr * 1.25, { fill: SHU, opacity: 0.28, filter: url('fr-sun-glow') }));
      body.push(circle(sx, sy, sr, { fill: SHU }));
    }

    /* Fuji: ridge = data */
    const m = normalizedMinutes(data.minutes90);
    const ridgeRaw: Pt[] = m.map((v, i) => {
      const u = (i / (DAYS - 1)) * 2 - 1;
      return [cx + u * halfW, horizon - peakH * fujiProfile(u) * (0.8 + 0.2 * v)];
    });
    const ridgeLine = smooth(ridgeRaw, 1);
    const mountain: Pt[] = [...ridgeLine, [cx + halfW, horizon + 60], [cx - halfW, horizon + 60]];
    defs.push(linearGradient('fr-mtn', [[0, KON], [1, KON_DEEP]], 90));
    const mountainPath = polyPath(mountain, true);
    body.push(path(mountainPath, { fill: url('fr-mtn') }));

    // Snow cap: ridge on top, a noisy boundary with fine fingers below, pinched shut past |u| ≈ 0.6
    const fine = resample(ridgeLine, 181);
    const snowBottom: Pt[] = fine.map(([x, y], i) => {
      const u = (i / (fine.length - 1)) * 2 - 1;
      const au = Math.abs(u);
      const fall = smoothstep(0.6, 0.2, au);
      const finger = Math.max(0, Math.sin(au * 70 + phase)) ** 2.5 * (0.6 + 0.4 * snowNoise(au * 17 + 5));
      const depth = peakH * fujiProfile(u) * (0.1 + 0.07 * snowNoise(au * 9 + phase) + 0.13 * finger) * fall;
      return [x, y + depth];
    });
    body.push(path(polyPath([...fine, ...snowBottom.slice().reverse()], true), { fill: WASHI_LIGHT }));

    // The line itself: the learner's belt colour over a thin ink shadow so it reads on snow and on kon
    const lineD = polyPath(ridgeLine.map(([x, y]) => [x, y - 1.5]));
    body.push(path(lineD, { fill: 'none', stroke: INK, 'stroke-width': phone ? 6 : 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.32 }));
    body.push(path(lineD, { fill: 'none', stroke: belt, 'stroke-width': phone ? 3.2 : 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    /* Foothills in front of the base */
    for (let k = 0; k < 2; k++) {
      const amp = h * (k === 0 ? 0.075 : 0.045) * uniform(rng, 0.8, 1.2);
      const heights = ridge(hashSeed(seed, 'hill', k), 56, amp, { roughness: 0.3 });
      const pts: Pt[] = heights.map((v, i) => [(i / (heights.length - 1)) * w, horizon - v + k * 14]);
      const poly: Pt[] = [...pts, [w, horizon + 60], [0, horizon + 60]];
      body.push(path(polyPath(poly, true), { fill: mix(KON, WASHI, k === 0 ? 0.36 : 0.56) }));
    }

    /* Mist band over the feet */
    defs.push(linearGradient('fr-mist', [[0, WASHI, 0], [0.5, WASHI, 0.85], [1, WASHI, 0]], 90));
    body.push(rect(0, horizon - h * 0.07, w, h * 0.12, { fill: url('fr-mist') }));

    /* Lake: wash, inverted Fuji, water lines */
    defs.push(linearGradient('fr-lake', [[0, mix(KON, WASHI, 0.7)], [1, WASHI]], 90));
    body.push(rect(0, horizon, w, h - horizon, { fill: url('fr-lake') }));
    defs.push(blur('fr-reflect', 6));
    defs.push(linearGradient('fr-reflect-fade', [[0, KON, 0], [0.45, KON, 0.5], [1, KON, 1]], 90));
    body.push(g({ transform: `translate(0 ${horizon * 2}) scale(1 -1)`, opacity: 0.12, filter: url('fr-reflect') }, path(mountainPath, { fill: url('fr-reflect-fade') })));
    const waterLines: string[] = [];
    const lines = range(rng, 10, 16);
    for (let i = 0; i < lines; i++) {
      const y = horizon + 24 + ((i + 0.5) / lines) * (h - horizon - 48);
      const x0 = uniform(rng, -0.1, 0.35) * w;
      const x1 = x0 + uniform(rng, 0.4, 0.9) * w;
      const pts: Pt[] = [];
      for (let k = 0; k <= 24; k++) {
        const x = x0 + ((x1 - x0) * k) / 24;
        pts.push([x, y + (waterNoise(x / 90 + i * 7) - 0.5) * 6]);
      }
      waterLines.push(path(polyPath(pts), { fill: 'none', stroke: mix(KON, WASHI, 0.5), 'stroke-width': uniform(rng, 1, 2), 'stroke-linecap': 'round', opacity: 0.35 }));
    }
    body.push(g(undefined, waterLines));

    /* Birds */
    const birds = range(rng, 0, 6);
    const birdParts: string[] = [];
    for (let i = 0; i < birds; i++) {
      const bx = uniform(rng, 0.08, 0.92) * w;
      const by = uniform(rng, 0.08, 0.42) * horizon;
      const s = uniform(rng, 9, 18);
      birdParts.push(path(M(bx - s, by) + Q(bx - s / 2, by - s * 0.7, bx, by) + Q(bx + s / 2, by - s * 0.7, bx + s, by), { fill: 'none', stroke: INK, 'stroke-width': s * 0.14, 'stroke-linecap': 'round', opacity: 0.7 }));
    }
    if (birdParts.length) body.push(g(undefined, birdParts));

    /* Hanko with the chosen kanji (left, over the lake) */
    const texts: TextLayer[] = [];
    const safe = safeRect(size, 0);
    const margin = phone ? 84 : 72;
    const bottomY = safe.y + safe.h - (phone ? 56 : 48);
    const sealSize = phone ? 92 : 76;
    if (data.chosenKanji) {
      const sx = margin;
      const sy = bottomY - 64 - sealSize;
      const scx = sx + sealSize / 2;
      const scy = sy + sealSize / 2;
      body.push(el('rect', { x: sx, y: sy, width: sealSize, height: sealSize, rx: sealSize * 0.08, fill: SHU, transform: `rotate(-4 ${scx} ${scy})` }));
      texts.push({ text: data.chosenKanji, x: scx, y: scy + sealSize * 0.33, size: sealSize * 0.66, font: FONTS.brush, fill: WASHI, anchor: 'middle', rotate: -4, lang: 'ja' });
    }

    /* Name in tategaki on the right of the lake */
    const colTop = horizon + (phone ? 90 : 40);
    const colMaxH = bottomY - 70 - colTop;
    // long names wrap into a second column (tategaki flows right to left) so the column never leaves the lake
    const nameChars = Array.from(data.nameKana).length;
    const nameCols = nameChars > 9 ? 2 : 1;
    const perCol = 'ア'.repeat(Math.ceil(nameChars / nameCols));
    const nameSize = fitSize(perCol, phone ? 76 : 60, colMaxH, { vertical: true, min: 12, max: phone ? 64 : 50 });
    texts.push(...tategakiLayers({ text: data.nameKana, x: w - margin - nameSize / 2, y: colTop, size: nameSize, columns: nameCols, font: FONTS.mincho, fill: INK }));

    /* Caption with the 90-day total, and the era date */
    const total = Math.round(data.minutes90.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0));
    const small = phone ? 30 : 24;
    texts.push({ text: `${S.fujiCaption}　${total}${S.minutesUnit}`, x: margin, y: bottomY, size: small, font: FONTS.mincho, fill: INK_WASH, anchor: 'start', lang: 'ja' });
    texts.push({ text: eraDate(data.date), x: w - margin, y: bottomY, size: small, font: FONTS.mincho, fill: INK_WASH, anchor: 'end', lang: 'ja' });

    return { svg: svgDoc({ w, h, bg: WASHI, defs, body }), texts, post: 'grain' };
  },
};
