/**
 * TSUZUKU — kakejiku 'festival' (祭り Festival Night, design 06 §3).
 *
 * A summer-festival night: fireworks bursting over a taiko yagura, strings
 * of chōchin lanterns hung on catenaries from its roof, yatai stalls lit
 * from inside, a crowd in happi coats silhouetted against the warm pool of
 * lantern light, and nobori banners at the edges carrying casual words the
 * learner has mastered. The great lantern on the tower reads 祭. Grain pass.
 * Palette: sumi, shu, kin bursts. Unlock: 三段 Sandan.
 *
 * Seed → burst count/colour/place, string sag, lantern mix, crowd, stalls,
 * banner cloth. Text is `TextLayer`s only (banner words, 祭).
 */
import { chance, mulberry32, pick, range, uniform } from '../../shared/hash';
import { INK, PALETTE, SUMI, WARM, WASHI, mix } from '../color';
import { catenary, polar, pointAt, rays, type Pt } from '../geom';
import { FONTS, columnHeight, fitSize, glyphCount, type TextLayer } from '../jtext';
import { circle, el, ellipse, glowTwin, line, linearGradient, path, polygon, polyline, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'festival';
const SHU = PALETTE.dark.shu;
const SHU_DEEP = PALETTE.light.shu;
const KIN = PALETTE.dark.kin;
const SAKURA = PALETTE.dark.sakura;
const KON = PALETTE.light.ai;
const BURST_COLORS = [KIN, SHU, WARM, SAKURA, KIN];

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Parts                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Radial burst: faint rays, three rings of particles drooping with gravity, a rising trail. */
function burst(cx: number, cy: number, r: number, color: string, rng: () => number): string {
  const n = range(rng, 18, 30);
  const rot = uniform(rng, 0, Math.PI);
  const parts: string[] = [path(rays(cx, cy, r * 0.18, r * 0.92, n, rot), { fill: color, opacity: 0.16 })];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    for (const [k, sz] of [[0.52, 1.3], [0.78, 1], [1, 0.75]] as const) {
      const rr = r * k * uniform(rng, 0.92, 1.05);
      const [px, py] = polar(cx, cy, rr, a);
      const droop = (rr / r) ** 2 * r * 0.09;
      parts.push(circle(px, py + droop, r * 0.016 * sz, { fill: k === 1 ? mix(color, WASHI, 0.4) : color }));
    }
  }
  parts.push(line(cx, cy + r * 0.3, cx + r * 0.05, cy + r * 1.8, { stroke: color, 'stroke-width': 1.5, opacity: 0.25, 'stroke-dasharray': '3 9' }));
  return el('g', undefined, parts);
}

/** One chōchin on its cord. */
export function lantern(x: number, y: number, s: number, white: boolean): string {
  const body = white ? WASHI : SHU;
  return el('g', undefined, [
    line(x, y, x, y + s * 0.5, { stroke: INK, 'stroke-width': Math.max(1, s * 0.06) }),
    circle(x, y + s * 1.35, s * 2.4, { fill: url('fs-lglow'), opacity: white ? 0.5 : 0.65 }),
    rect(x - s * 0.35, y + s * 0.45, s * 0.7, s * 0.22, { fill: SUMI }),
    ellipse(x, y + s * 1.35, s * 0.75, s * 0.78, { fill: body }),
    ellipse(x, y + s * 1.35, s * 0.75, s * 0.4, { fill: 'none', stroke: white ? SHU_DEEP : SUMI, 'stroke-width': Math.max(1, s * 0.06), opacity: 0.45 }),
    line(x - s * 0.72, y + s * 1.35, x + s * 0.72, y + s * 1.35, { stroke: white ? SHU_DEEP : SUMI, 'stroke-width': Math.max(1, s * 0.06), opacity: 0.45 }),
    rect(x - s * 0.35, y + s * 2.05, s * 0.7, s * 0.2, { fill: SUMI }),
  ]);
}

/** A festival-goer in a happi coat (silhouette); some raise a fan. */
function person(x: number, y: number, s: number, rng: () => number): string {
  const lean = uniform(rng, -0.06, 0.06) * s;
  const parts: string[] = [
    circle(x + lean, y - s * 1.02, s * 0.15, { fill: SUMI }),
    polygon(
      [
        [x - s * 0.32 + lean, y - s * 0.8],
        [x + s * 0.32 + lean, y - s * 0.8],
        [x + s * 0.42, y - s * 0.3],
        [x - s * 0.42, y - s * 0.3],
      ],
      { fill: SUMI },
    ),
    rect(x - s * 0.22, y - s * 0.32, s * 0.18, s * 0.32, { fill: SUMI }),
    rect(x + s * 0.04, y - s * 0.32, s * 0.18, s * 0.32, { fill: SUMI }),
  ];
  if (chance(rng, 0.35)) {
    const hx = x + s * 0.55;
    const hy = y - s * 1.25;
    parts.push(polyline([[x + s * 0.3 + lean, y - s * 0.78], [x + s * 0.5, y - s * 1.0], [hx, hy]], { fill: 'none', stroke: SUMI, 'stroke-width': s * 0.11, 'stroke-linecap': 'round' }));
    parts.push(ellipse(hx + s * 0.05, hy - s * 0.12, s * 0.17, s * 0.13, { fill: chance(rng, 0.5) ? WARM : WASHI, opacity: 0.9 }));
  } else if (chance(rng, 0.4)) {
    parts.push(polyline([[x - s * 0.3 + lean, y - s * 0.78], [x - s * 0.52, y - s * 0.55]], { fill: 'none', stroke: SUMI, 'stroke-width': s * 0.11, 'stroke-linecap': 'round' }));
  }
  return el('g', undefined, parts);
}

/** A yatai stall: dark frame, striped awning, warm lit interior. */
function stall(x: number, groundY: number, wdt: number, hgt: number, flip: boolean): string {
  const d = flip ? -1 : 1;
  const x0 = x;
  const x1 = x + wdt * d;
  const top = groundY - hgt;
  const xl = Math.min(x0, x1);
  return el('g', undefined, [
    rect(xl, top + hgt * 0.22, wdt, hgt * 0.78, { fill: '#17120F' }),
    rect(xl + wdt * 0.08, top + hgt * 0.3, wdt * 0.84, hgt * 0.36, { fill: WARM, opacity: 0.55 }),
    rect(xl + wdt * 0.08, top + hgt * 0.66, wdt * 0.84, hgt * 0.34, { fill: '#0E0B09' }),
    polygon([[xl - wdt * 0.08, top + hgt * 0.24], [xl + wdt * 1.08, top + hgt * 0.24], [xl + wdt * 0.96, top], [xl + wdt * 0.04, top]], { fill: SHU_DEEP }),
    ...[0.2, 0.44, 0.68].map((t) => rect(xl + wdt * t, top + hgt * 0.02, wdt * 0.12, hgt * 0.2, { fill: WASHI, opacity: 0.85 })),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const safe = safeRect(size, Math.round(Math.min(w, h) * 0.05));
  const rng = mulberry32(seed);
  const groundY = h * (phone ? 0.72 : 0.78);

  const defs: string[] = [
    linearGradient('fs-sky', [[0, SUMI], [0.55, '#110F1D'], [1, '#2B1A20']], 90),
    linearGradient('fs-ground', [[0, '#3A2318'], [0.45, '#1B1411'], [1, SUMI]], 90),
    linearGradient('fs-band', [[0, WARM, 0], [1, WARM, 0.32]], 90),
    radialGradient('fs-lglow', [[0, WARM, 0.7], [0.5, WARM, 0.18], [1, WARM, 0]]),
    radialGradient('fs-pool', [[0, WARM, 0.28], [1, WARM, 0]], { cy: 0.5, r: 0.5 }),
    glowTwin('fs-glow', phone ? 5 : 6, { opacity: 0.8 }),
    glowTwin('fs-soft', phone ? 10 : 12, { opacity: 0.6 }),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('fs-sky') })];

  /* ── stars ────────────────────────────────────────────────────────────── */
  const stars: string[] = [];
  const starN = range(rng, phone ? 60 : 50, phone ? 110 : 90);
  for (let i = 0; i < starN; i++) {
    stars.push(circle(uniform(rng, 0, w), uniform(rng, 0, groundY * 0.7), uniform(rng, 0.7, 1.9), { fill: WASHI, opacity: uniform(rng, 0.25, 0.8) }));
  }
  body.push(el('g', undefined, stars));

  /* ── fireworks ────────────────────────────────────────────────────────── */
  const bursts = range(rng, 2, phone ? 3 : 4);
  const burstG: string[] = [];
  for (let i = 0; i < bursts; i++) {
    const r = Math.min(w, h) * uniform(rng, 0.1, 0.17) * (phone ? 1.35 : 1);
    const cx = w * uniform(rng, 0.14, 0.86);
    const cy = h * uniform(rng, phone ? 0.1 : 0.12, phone ? 0.3 : 0.4);
    burstG.push(burst(cx, cy, r, pick(rng, BURST_COLORS), rng));
  }
  body.push(el('g', { filter: url('fs-glow') }, burstG));

  /* ── ground, light band ───────────────────────────────────────────────── */
  body.push(rect(0, groundY, w, h - groundY, { fill: url('fs-ground') }));
  body.push(rect(0, groundY - h * 0.07, w, h * 0.07, { fill: url('fs-band') }));

  /* ── stalls ───────────────────────────────────────────────────────────── */
  const stallW = w * (phone ? 0.3 : 0.15);
  const stallH = h * (phone ? 0.11 : 0.19);
  body.push(stall(w * uniform(rng, -0.02, 0.04), groundY + 2, stallW, stallH, false));
  if (!phone || chance(rng, 0.5)) body.push(stall(w * uniform(rng, 0.96, 1.02), groundY + 2, stallW, stallH, true));

  /* ── yagura ───────────────────────────────────────────────────────────── */
  const yx = w * 0.5 + w * uniform(rng, -0.04, 0.04);
  const bw = w * (phone ? 0.44 : 0.2);
  const platY = groundY - h * (phone ? 0.15 : 0.26);
  const roofY = platY - bw * 0.42;
  const yag: string[] = [];
  const leg = Math.max(4, bw * 0.03);
  for (const d of [-1, 1]) {
    yag.push(line(yx + d * bw * 0.5, groundY + 4, yx + d * bw * 0.36, platY, { stroke: SUMI, 'stroke-width': leg }));
    yag.push(line(yx + d * bw * 0.5, groundY + 4, yx - d * bw * 0.36, platY, { stroke: SUMI, 'stroke-width': leg * 0.6, opacity: 0.9 }));
  }
  yag.push(rect(yx - bw * 0.42, platY - bw * 0.04, bw * 0.84, bw * 0.06, { fill: SUMI }));
  // railing
  for (let i = 0; i <= 6; i++) {
    const px = yx - bw * 0.4 + (bw * 0.8 * i) / 6;
    yag.push(line(px, platY - bw * 0.04, px, platY - bw * 0.2, { stroke: SUMI, 'stroke-width': leg * 0.5 }));
  }
  yag.push(line(yx - bw * 0.4, platY - bw * 0.19, yx + bw * 0.4, platY - bw * 0.19, { stroke: SUMI, 'stroke-width': leg * 0.6 }));
  // roof: four posts and a wide eave
  for (const d of [-1, 1]) yag.push(line(yx + d * bw * 0.3, platY - bw * 0.04, yx + d * bw * 0.3, roofY + bw * 0.08, { stroke: SUMI, 'stroke-width': leg * 0.7 }));
  yag.push(polygon([[yx - bw * 0.55, roofY + bw * 0.1], [yx + bw * 0.55, roofY + bw * 0.1], [yx + bw * 0.36, roofY - bw * 0.04], [yx - bw * 0.36, roofY - bw * 0.04]], { fill: SUMI }));
  yag.push(polygon([[yx - bw * 0.36, roofY - bw * 0.04], [yx + bw * 0.36, roofY - bw * 0.04], [yx, roofY - bw * 0.16]], { fill: SUMI }));
  // the drum and the drummer
  const dy = platY - bw * 0.14;
  yag.push(rect(yx + bw * 0.02, dy - bw * 0.05, bw * 0.22, bw * 0.03, { fill: SUMI }));
  yag.push(ellipse(yx + bw * 0.13, dy - bw * 0.16, bw * 0.13, bw * 0.11, { fill: SHU_DEEP, stroke: KIN, 'stroke-width': leg * 0.5 }));
  yag.push(ellipse(yx + bw * 0.13, dy - bw * 0.16, bw * 0.08, bw * 0.065, { fill: WASHI, opacity: 0.85 }));
  const dr = bw * 0.1;
  yag.push(circle(yx - bw * 0.12, dy - dr * 2.6, dr * 0.42, { fill: SUMI }));
  yag.push(polygon([[yx - bw * 0.22, dy - dr * 2.1], [yx - bw * 0.02, dy - dr * 2.1], [yx - bw * 0.04, dy - dr * 0.2], [yx - bw * 0.2, dy - dr * 0.2]], { fill: SUMI }));
  yag.push(polyline([[yx - bw * 0.05, dy - dr * 2.0], [yx + bw * 0.04, dy - dr * 3.2], [yx + bw * 0.1, dy - dr * 3.9]], { fill: 'none', stroke: SUMI, 'stroke-width': leg * 0.7, 'stroke-linecap': 'round' }));
  body.push(el('g', undefined, yag));
  // warm pool of light under the tower
  body.push(ellipse(yx, groundY + (h - groundY) * 0.12, bw * 0.9, (h - groundY) * 0.18, { fill: url('fs-pool') }));

  /* ── lantern strings ──────────────────────────────────────────────────── */
  const ls = Math.min(w, h) * (phone ? 0.022 : 0.016);
  const strings: string[] = [];
  const lanterns: string[] = [];
  const hang = (pts: Pt[], spacing: number): void => {
    strings.push(polyline(pts, { fill: 'none', stroke: INK, 'stroke-width': Math.max(1.2, ls * 0.08) }));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const count = Math.max(2, Math.floor(len / spacing));
    for (let i = 0; i < count; i++) {
      const { p } = pointAt(pts, (i + 0.5) / count);
      lanterns.push(lantern(p[0], p[1], ls, chance(rng, 0.2)));
    }
  };
  const apex: Pt = [yx, roofY - bw * 0.14];
  const spacing = ls * uniform(rng, 5.2, 6.4);
  for (const side of [-1, 1]) {
    const endX = side < 0 ? -ls : w + ls;
    const drop = h * uniform(rng, 0.04, 0.1);
    const sag = Math.abs(endX - apex[0]) * uniform(rng, 0.08, 0.14);
    const pts = catenary(apex[0], endX, apex[1], sag, 32).map(([x, y], i, arr) => [x, y + (drop * i) / (arr.length - 1)] as Pt);
    hang(pts, spacing);
  }
  const frontN = phone ? 2 : 2;
  for (let i = 0; i < frontN; i++) {
    const y = roofY + bw * (0.55 + i * 0.5) * (phone ? 1.1 : 1) + h * uniform(rng, -0.02, 0.02);
    const sag = w * uniform(rng, 0.05, 0.09);
    hang(catenary(-ls, w + ls, y, sag, 40), spacing * uniform(rng, 1, 1.25));
  }
  body.push(el('g', undefined, strings));
  body.push(el('g', undefined, lanterns));

  /* ── crowd ────────────────────────────────────────────────────────────── */
  const crowd: string[] = [];
  const people = range(rng, phone ? 11 : 20, phone ? 17 : 32);
  const ps = phone ? w * 0.085 : h * 0.062;
  for (let i = 0; i < people; i++) {
    const x = w * ((i + uniform(rng, 0.2, 0.8)) / people);
    const depth = uniform(rng, 0, 1);
    crowd.push(person(x, groundY + depth * (phone ? h * 0.02 : h * 0.03), ps * (0.8 + depth * 0.4), rng));
  }
  body.push(el('g', undefined, crowd));

  /* ── banners ──────────────────────────────────────────────────────────── */
  const texts: TextLayer[] = [];
  const shortWords = data.mastered.vocab.map((v) => v.word).filter((wd) => glyphCount(wd) >= 1 && glyphCount(wd) <= 5);
  const words = shortWords.length > 0 ? shortWords : [...S.festival.fallbackWords];
  const slots = phone ? [0.07, 0.78] : [0.045, 0.165, 0.76, 0.88];
  const bh = h * (phone ? 0.4 : 0.5);
  const bwid = w * (phone ? 0.15 : 0.072);
  const banners: string[] = [];
  slots.forEach((sx, i) => {
    const px = w * sx + w * uniform(rng, -0.01, 0.01);
    const top = groundY - bh * uniform(rng, 0.92, 1.05);
    const cloth = pick(rng, [SHU_DEEP, '#8F2420', KON, '#15151D', WASHI]);
    const clothTop = top + ls * 0.6;
    const clothH = bh * 0.74;
    banners.push(line(px, groundY + 6, px, top, { stroke: INK, 'stroke-width': Math.max(2, bwid * 0.05) }));
    banners.push(line(px, top, px + bwid * 1.1, top, { stroke: INK, 'stroke-width': Math.max(2, bwid * 0.04) }));
    banners.push(rect(px + bwid * 0.06, clothTop, bwid, clothH, { fill: cloth }));
    banners.push(rect(px + bwid * 0.06, clothTop, bwid, clothH * 0.06, { fill: cloth === WASHI ? SHU_DEEP : WASHI, opacity: 0.9 }));
    banners.push(rect(px + bwid * 0.06, clothTop, bwid, clothH, { fill: 'none', stroke: INK, 'stroke-width': 1.5, opacity: 0.6 }));
    const word = words[i % words.length]!;
    const sizeV = fitSize(word, bwid * 0.72, clothH * 0.8, { vertical: true, max: bwid * 0.72 });
    const colH = columnHeight(word, sizeV);
    const y0 = Math.max(safe.y, clothTop + (clothH - colH) / 2);
    texts.push({ text: word, x: px + bwid * 0.56, y: Math.min(y0, safe.y + safe.h - colH), size: sizeV, font: FONTS.brush, fill: cloth === WASHI ? SUMI : WASHI, vertical: true, lang: 'ja' });
  });
  body.push(el('g', undefined, banners));

  /* ── the great lantern: 祭 ────────────────────────────────────────────── */
  const gx = yx;
  const gy = roofY + bw * 0.3;
  const gr = bw * 0.14;
  body.push(
    el('g', { filter: url('fs-soft') }, [
      rect(gx - gr * 0.3, gy - gr * 1.3, gr * 0.6, gr * 0.16, { fill: SUMI }),
      ellipse(gx, gy, gr, gr * 1.15, { fill: WASHI }),
      ...[-0.6, -0.2, 0.2, 0.6].map((k) => line(gx - gr * Math.sqrt(1 - k * k), gy + gr * 1.15 * k, gx + gr * Math.sqrt(1 - k * k), gy + gr * 1.15 * k, { stroke: SHU_DEEP, 'stroke-width': Math.max(1, gr * 0.03), opacity: 0.35 })),
      rect(gx - gr * 0.3, gy + gr * 1.14, gr * 0.6, gr * 0.16, { fill: SUMI }),
    ]),
  );
  const glyphSize = gr * 1.15;
  const gyText = Math.min(Math.max(gy + glyphSize * 0.35, safe.y + glyphSize * 0.9), safe.y + safe.h - glyphSize * 0.25);
  texts.push({ text: S.festival.matsuri, x: gx, y: gyText, size: glyphSize, font: FONTS.brush, fill: SHU_DEEP, anchor: 'middle', weight: 700, lang: 'ja' });

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'grain' };
}
