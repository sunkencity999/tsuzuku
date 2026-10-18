/**
 * TSUZUKU — kakejiku 'sakura-storm' 桜吹雪 (design 06 §3).
 *
 * A dusk sky from deep indigo to a sakura horizon, a five-storey pagoda in
 * silhouette, a blossoming tree on the other side, and a storm of petals
 * driven by a curl-noise flow field in three depth layers (far petals
 * blurred and dim, near petals large and soft). Streamlines trace the wind.
 * One tanzaku hangs on the belt-coloured cord and carries the longest
 * streak and the date in kanji numerals, set vertically.
 *
 * Seed → sky, moon, pagoda side and proportions, tree, the wind field,
 * every petal, the tanzaku paper. Streak and date are `TextLayer`s.
 */
import { hashSeed, mulberry32, gauss, pick, range, uniform } from '../../shared/hash';
import { brushStroke, PRESSURE } from '../brush';
import { INK, NIGHT, PALETTE, SUMI, TANZAKU, WASHI, WASHI_LIGHT, alpha, beltColor, lighten, mix, mixOklab, pickReadable } from '../color';
import { clamp, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, type TextLayer } from '../jtext';
import { curl, fbm, ridge, simplex2 } from '../noise';
import { L, M, Q, Z, blur, circle, ellipse, g, line, linearGradient, path, polygon, radialGradient, rect, svgDoc, url, use } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S, kanjiNumber, kanjiNumerals } from './strings-1';

const P = 'ss';
const PETAL = 'M0,-6 C3.5,-6 6,-3 5.5,0.5 C5,4 2,6 0,4.5 C-2,6 -5,4 -5.5,0.5 C-6,-3 -3.5,-6 0,-6 Z';

export function pagoda(x: number, ground: number, H: number, tiers: number, fill: string, glow: string): string {
  const parts: string[] = [];
  const tH = H / (tiers + 0.9);
  const W = H * 0.42;
  let topY = ground;
  for (let i = 0; i < tiers; i++) {
    const yb = ground - i * tH;
    const bw = W * (1 - 0.1 * i);
    const yr = yb - tH * 0.55;
    const rw = bw * 1.55;
    const rh = tH * 0.5;
    parts.push(rect(x - bw / 2, yr - 2, bw, yb - yr + 2, { fill }));
    parts.push(rect(x - bw / 2 - bw * 0.08, yb - tH * 0.1, bw * 1.16, tH * 0.05, { fill }));
    // swept roof: upturned tips, concave upper edges to a short ridge, sagging underside
    const d =
      M(x - rw / 2, yr - rh * 0.2) +
      Q(x - rw * 0.28, yr - rh * 0.3, x - bw * 0.26, yr - rh) +
      L(x + bw * 0.26, yr - rh) +
      Q(x + rw * 0.28, yr - rh * 0.3, x + rw / 2, yr - rh * 0.2) +
      Q(x, yr + rh * 0.45, x - rw / 2, yr - rh * 0.2) +
      Z;
    parts.push(path(d, { fill }));
    parts.push(rect(x - bw * 0.5, yr + tH * 0.3, bw, tH * 0.04, { fill: glow, opacity: 0.18 }));
    if (i < 3) parts.push(rect(x - bw * 0.07, yr + tH * 0.1, bw * 0.14, tH * 0.2, { fill: glow, opacity: 0.75 }));
    topY = yr - rh;
  }
  // sōrin: mast, rings, jewel
  const mast = H * 0.2;
  parts.push(rect(x - H * 0.006, topY - mast, H * 0.012, mast, { fill }));
  for (let r = 0; r < 7; r++) {
    const ry = topY - mast * 0.2 - (r / 7) * mast * 0.6;
    parts.push(ellipse(x, ry, H * (0.03 - r * 0.0022), H * 0.006, { fill }));
  }
  parts.push(circle(x, topY - mast - H * 0.01, H * 0.012, { fill }));
  return g(undefined, parts);
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 40 : 40);
  const sakura = PALETTE.dark.sakura;
  const dusk = PALETTE.light.ai;
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];

  /* Sky and moon */
  const top = mix(NIGHT, dusk, uniform(rng, 0.1, 0.5));
  defs.push(linearGradient(`${P}-sky`, [[0, top], [0.5, dusk], [0.82, mixOklab(dusk, sakura, 0.55)], [1, mixOklab(sakura, '#F08A24', 0.2)]]));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-sky`) }));
  const side = rng() < 0.5 ? -1 : 1;
  const mx = w * (0.5 - side * uniform(rng, 0.04, 0.18));
  const my = h * uniform(rng, 0.12, 0.26);
  const mr = Math.min(w, h) * uniform(rng, 0.05, 0.08);
  defs.push(radialGradient(`${P}-moon`, [[0, WASHI_LIGHT, 0.5], [0.4, sakura, 0.18], [1, sakura, 0]]));
  body.push(circle(mx, my, mr * 4, { fill: url(`${P}-moon`) }));
  body.push(circle(mx, my, mr, { fill: mix(WASHI_LIGHT, '#F2D54A', 0.25) }));

  /* Ground ridge */
  const ink = mix(NIGHT, SUMI, 0.55);
  const base = h * (phone ? 0.86 : 0.84);
  const ridgePts = 60;
  const hs = ridge(hashSeed(seed, 'ground'), ridgePts, h * 0.07);
  const groundAt = (x: number): number => {
    const u = clamp(x / w, 0, 1) * (ridgePts - 1);
    const i = Math.min(ridgePts - 2, Math.floor(u));
    const t = u - i;
    return base - (hs[i]! * (1 - t) + hs[i + 1]! * t);
  };
  const groundPoly: Pt[] = hs.map((v, i) => [(i / (ridgePts - 1)) * w, base - v]);
  groundPoly.push([w, h], [0, h]);

  /* Pagoda */
  const px = w * (0.5 + side * uniform(rng, 0.18, 0.3));
  const H = h * (phone ? uniform(rng, 0.3, 0.36) : uniform(rng, 0.5, 0.6));
  body.push(pagoda(px, groundAt(px) + 4, H, 5, ink, '#FFD166'));

  /* Tree on the other side */
  const tx = w * (0.5 - side * uniform(rng, 0.14, 0.26));
  const tg = groundAt(tx) + 6;
  const trunkH = h * (phone ? 0.22 : 0.34);
  const lean = -side * uniform(rng, 0.03, 0.08) * w;
  const trunk: Pt[] = [[tx - lean * 0.15, tg], [tx + lean * 0.15, tg - trunkH * 0.35], [tx + lean * 0.8, tg - trunkH * 0.7], [tx + lean * 1.3, tg - trunkH]];
  body.push(path(brushStroke(trunk, { width: trunkH * 0.15, pressure: PRESSURE.taper, seed: hashSeed(seed, 'trunk'), bristle: 0.25 }), { fill: ink }));
  const branches: Pt[] = [];
  for (let b = 0; b < 3; b++) {
    const t0 = 0.45 + b * 0.18;
    const from: Pt = [tx + lean * (t0 * 1.2 - 0.1), tg - trunkH * t0];
    const dir = b % 2 === 0 ? -1 : 1;
    const to: Pt = [from[0] + dir * trunkH * uniform(rng, 0.25, 0.45), from[1] - trunkH * uniform(rng, 0.15, 0.3)];
    body.push(path(brushStroke([from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - trunkH * 0.04], to], { width: trunkH * 0.035, pressure: PRESSURE.taper, seed: hashSeed(seed, 'br', b) }), { fill: ink }));
    branches.push(to);
  }
  branches.push(trunk[3]!);
  defs.push(blur(`${P}-soft`, phone ? 7 : 6));
  const canopy: string[] = [];
  for (const b of branches) {
    const n = range(rng, 9, 14);
    for (let i = 0; i < n; i++) {
      const r = trunkH * uniform(rng, 0.05, 0.13);
      canopy.push(circle(b[0] + gauss(rng, 0, trunkH * 0.1), b[1] + gauss(rng, 0, trunkH * 0.07), r, { fill: mix(sakura, WASHI_LIGHT, uniform(rng, 0, 0.5)), opacity: uniform(rng, 0.7, 0.95) }));
    }
  }
  body.push(g({ filter: url(`${P}-soft`) }, canopy));
  body.push(polygon(groundPoly, { fill: ink }));

  /* Wind: curl of fBm simplex; streamlines then petals */
  const field = curl(fbm(simplex2(hashSeed(seed, 'wind')), 3), 0.01);
  const flowAt = (x: number, y: number): Pt => {
    const [fx, fy] = field((x / w) * 3, (y / w) * 3);
    return [fx + 0.9 * -side, fy * 0.6 + 0.08];
  };
  let streams = '';
  const sRng = mulberry32(hashSeed(seed, 'streams'));
  for (let s = 0; s < (phone ? 16 : 20); s++) {
    let x = uniform(sRng, 0, w);
    let y = uniform(sRng, 0, h * 0.75);
    streams += M(x, y);
    for (let k = 0; k < 28; k++) {
      const [fx, fy] = flowAt(x, y);
      const len = Math.hypot(fx, fy) || 1;
      x += (fx / len) * 14;
      y += (fy / len) * 14;
      streams += L(x, y);
    }
  }
  body.push(path(streams, { fill: 'none', stroke: sakura, 'stroke-width': 1.4, opacity: 0.22, 'stroke-linecap': 'round' }));

  defs.push(path(PETAL, { id: `${P}-p` }));
  defs.push(blur(`${P}-far`, 1.6));
  defs.push(blur(`${P}-near`, phone ? 4 : 3.2));
  const pRng = mulberry32(hashSeed(seed, 'petals'));
  const bandY = h * uniform(pRng, 0.3, 0.55);
  const layer = (count: number, s0: number, s1: number, fill: string, opacity: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const x = uniform(pRng, -w * 0.05, w * 1.05);
      const y = clamp(gauss(pRng, bandY, h * 0.24), -h * 0.05, h * 0.95);
      const [fx, fy] = flowAt(x, y);
      const ang = (Math.atan2(fy, fx) * 180) / Math.PI + uniform(pRng, -25, 25);
      const sc = uniform(pRng, s0, s1) * (phone ? 1.25 : 1);
      out.push(use(`${P}-p`, { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${sc.toFixed(2)})`, fill, opacity }));
    }
    return out;
  };
  body.push(g({ filter: url(`${P}-far`) }, layer(phone ? 200 : 240, 0.55, 0.9, mix(sakura, dusk, 0.4), 0.6)));
  body.push(g(undefined, layer(phone ? 130 : 160, 1.1, 1.7, sakura, 0.95)));
  body.push(g({ filter: url(`${P}-near`) }, layer(phone ? 44 : 52, 2.3, 3.6, lighten(sakura, 0.25), 0.9)));

  /* Tanzaku with streak and date */
  const belt = beltColor(data.belt);
  const paper = pick(mulberry32(hashSeed(seed, 'paper')), TANZAKU);
  const tw = phone ? 150 : 128;
  const th = phone ? 560 : 470;
  const tcx = w * (0.5 - side * uniform(rng, phone ? 0.3 : 0.36, phone ? 0.36 : 0.43));
  const ty = phone ? safe.y + 52 : 60;
  const tilt = uniform(rng, -3, 3);
  body.push(line(tcx, phone ? safe.y - 40 : -4, tcx, ty, { stroke: belt, 'stroke-width': 3 }));
  body.push(circle(tcx, ty, 5, { fill: belt }));
  const T: string[] = [];
  T.push(rect(tcx - tw / 2, ty, tw, th, { fill: paper, stroke: alpha(INK, 0.35), 'stroke-width': 1.5 }));
  T.push(rect(tcx - tw / 2 + 8, ty + 8, tw - 16, th - 16, { fill: 'none', stroke: alpha(INK, 0.2), 'stroke-width': 1 }));
  T.push(circle(tcx, ty + 22, 5, { fill: 'none', stroke: INK, 'stroke-width': 1.5, opacity: 0.6 }));
  body.push(g({ transform: `rotate(${tilt.toFixed(1)} ${tcx.toFixed(1)} ${ty.toFixed(1)})` }, T));
  const inkOn = pickReadable(paper, [INK, WASHI]);
  const streakText = `${S.streakPrefix}${kanjiNumber(data.streak)}${S.daysSuffix}`;
  const dateText = kanjiNumerals(eraDate(data.date));
  const colH = th - 90;
  const sz1 = Math.min(phone ? 44 : 38, fitSize(streakText, tw * 0.4, colH, { vertical: true }));
  const sz2 = Math.min(phone ? 30 : 26, fitSize(dateText, tw * 0.34, colH, { vertical: true }));
  texts.push({ text: streakText, x: tcx + tw * 0.2, y: ty + 50, size: sz1, font: FONTS.mincho, fill: inkOn, vertical: true, weight: 600, rotate: tilt, lang: 'ja' });
  texts.push({ text: dateText, x: tcx - tw * 0.22, y: ty + 58, size: sz2, font: FONTS.mincho, fill: inkOn, vertical: true, opacity: 0.85, rotate: tilt, lang: 'ja' });

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['sakura-storm'].en, attrs: { 'data-piece': 'sakura-storm' } });
  return { svg, texts, post: 'none' };
}

export const spec: WallpaperSpec = { id: 'sakura-storm', compose };
