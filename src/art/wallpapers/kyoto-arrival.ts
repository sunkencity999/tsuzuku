/**
 * TSUZUKU — kakejiku 'kyoto-arrival' (京の橋 Kyoto Arrival, design 06 §3).
 *
 * The end of the road: a great wooden bridge at dusk, its deck a gentle arch
 * with giboshi-capped posts, lanterns along the railing and their
 * reflections trembling in the river; a five-storey pagoda on the hills,
 * the sun half set, geese crossing in a V. The water mirrors the sky and the
 * bridge through a displacement filter. Lower on the piece: the learner's
 * full title (name, belt title, 初段) and the arrival date in the era format.
 * Palette: kon, shu, kin. Unlock: Shodan Shinsa.
 *
 * Seed → sun and pagoda placement, ridges, geese flocks, ripples, travellers.
 */
import { chance, mulberry32, range, uniform } from '../../shared/hash';
import { BELTS } from '../../content/types';
import { sealFrame } from '../brush';
import { PALETTE, SUMI, WARM, WASHI, mix } from '../color';
import { type Pt } from '../geom';
import { FONTS, eraDate, fitSize, textWidth, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { L, M, Q, Z, circle, displace, el, ellipse, fmt, glowTwin, line, linearGradient, path, polygon, polyline, radialGradient, rect, svgDoc, url, use } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'kyoto-arrival';
const KON = PALETTE.light.kon;
const AI = PALETTE.light.ai;
const SHU = PALETTE.light.shu;
const KIN = PALETTE.dark.kin;
const DEEP = '#101535';
const PLUM = '#5A3F7A';

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Parts                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Five-storey pagoda silhouette standing on `baseY`, `s` tall-ish. */
export function pagoda(cx: number, baseY: number, s: number): string {
  const parts: string[] = [];
  const tiers = 5;
  const pitch = s * 0.17;
  for (let i = 0; i < tiers; i++) {
    const y = baseY - i * pitch;
    const wi = s * (0.5 - i * 0.065);
    const roof =
      M(cx - wi, y - s * 0.035) +
      Q(cx - wi * 0.5, y + s * 0.012, cx, y) +
      Q(cx + wi * 0.5, y + s * 0.012, cx + wi, y - s * 0.035) +
      L(cx + wi * 0.78, y - s * 0.075) +
      L(cx - wi * 0.78, y - s * 0.075) +
      Z;
    parts.push(path(roof, { fill: DEEP }));
    parts.push(rect(cx - wi * 0.52, y - pitch, wi * 1.04, pitch - s * 0.07, { fill: DEEP }));
  }
  const top = baseY - tiers * pitch + s * 0.03;
  parts.push(polygon([[cx - s * 0.3, top + s * 0.07], [cx + s * 0.3, top + s * 0.07], [cx, top - s * 0.06]], { fill: DEEP }));
  parts.push(line(cx, top - s * 0.05, cx, top - s * 0.3, { stroke: DEEP, 'stroke-width': s * 0.018 }));
  for (let r = 0; r < 5; r++) parts.push(ellipse(cx, top - s * 0.1 - r * s * 0.035, s * (0.045 - r * 0.005), s * 0.012, { fill: DEEP }));
  parts.push(circle(cx, top - s * 0.31, s * 0.014, { fill: DEEP }));
  return el('g', undefined, parts);
}

/** A goose in flight: three points, wings up. */
function goose(x: number, y: number, s: number): string {
  return polyline([[x - s, y - s * 0.45], [x - s * 0.35, y - s * 0.1], [x, y], [x + s * 0.35, y - s * 0.1], [x + s, y - s * 0.45]], { fill: 'none', stroke: DEEP, 'stroke-width': Math.max(1.2, s * 0.16), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}

/** A traveller on the deck: sedge hat, head, coat. */
function traveller(x: number, y: number, s: number, dir: 1 | -1): string {
  return el('g', undefined, [
    polygon([[x - s * 0.34, y - s * 0.82], [x + s * 0.34, y - s * 0.82], [x, y - s * 1.08]], { fill: DEEP }),
    circle(x, y - s * 0.72, s * 0.12, { fill: DEEP }),
    polygon([[x - s * 0.22, y - s * 0.6], [x + s * 0.22, y - s * 0.6], [x + s * 0.2 * dir + s * 0.1, y], [x - s * 0.26, y]], { fill: DEEP }),
    line(x + s * 0.3 * dir, y - s * 0.95, x + s * 0.3 * dir, y, { stroke: DEEP, 'stroke-width': s * 0.05 }),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const safe = safeRect(size, Math.round(Math.min(w, h) * 0.06));
  const rng = mulberry32(seed);
  const horizon = h * (phone ? 0.5 : 0.56);

  const defs: string[] = [
    linearGradient('ka-sky', [[0, AI], [0.35, PLUM], [0.68, mix(SHU, PLUM, 0.35)], [0.88, mix(KIN, SHU, 0.25)], [1, mix(KIN, WASHI, 0.35)]], 90),
    linearGradient('ka-water', [[0, mix(KIN, WASHI, 0.3)], [0.12, mix(SHU, PLUM, 0.5)], [0.45, PLUM], [1, DEEP]], 90),
    radialGradient('ka-sun', [[0, mix(KIN, WASHI, 0.5), 0.9], [0.4, KIN, 0.35], [1, KIN, 0]]),
    linearGradient('ka-refl', [[0, WARM, 0.55], [1, WARM, 0]], 90),
    glowTwin('ka-glow', phone ? 5 : 6, { opacity: 0.9 }),
    displace('ka-ripple', { baseFrequency: [0.015, 0.09], scale: phone ? 10 : 14, seed, octaves: 2 }),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('ka-sky') })];

  /* ── sun ──────────────────────────────────────────────────────────────── */
  const sunR = Math.min(w, h) * (phone ? 0.11 : 0.075);
  const sunX = w * uniform(rng, 0.3, 0.7);
  const sunY = horizon - sunR * uniform(rng, 0.1, 0.5);
  body.push(circle(sunX, sunY, sunR * 3.2, { fill: url('ka-sun'), opacity: 0.55 }));
  body.push(circle(sunX, sunY, sunR, { fill: mix(KIN, WASHI, 0.35) }));

  /* ── mountains ────────────────────────────────────────────────────────── */
  const ridgeN = phone ? 40 : 72;
  const tones = [mix(PLUM, AI, 0.35), mix(KON, PLUM, 0.5), '#1A2350'];
  const amps = [h * 0.11, h * 0.14, h * 0.095];
  const lifts = [h * 0.05, h * 0.02, 0];
  const nearRidge: Pt[] = [];
  tones.forEach((tone, i) => {
    const pts = ridge(seed ^ (0x1111 * (i + 1)), ridgeN, amps[i]!);
    const poly: Pt[] = pts.map((v, k) => [(k / (pts.length - 1)) * w, horizon - lifts[i]! - v]);
    if (i === 2) nearRidge.push(...poly);
    body.push(polygon([[0, horizon + 1], ...poly, [w, horizon + 1]], { fill: tone }));
  });

  /* ── pagoda on the near hill ──────────────────────────────────────────── */
  const side = chance(rng, 0.5) ? 0.2 : 0.8;
  const px = w * (side + uniform(rng, -0.05, 0.05));
  const idx = Math.min(nearRidge.length - 1, Math.max(0, Math.round((px / w) * (nearRidge.length - 1))));
  const pBase = nearRidge[idx]![1] + h * 0.01;
  const pS = phone ? w * 0.34 : h * 0.26;
  body.push(pagoda(px, pBase, pS));

  /* ── geese ────────────────────────────────────────────────────────────── */
  const geese: string[] = [];
  const flocks = range(rng, 1, 2);
  for (let f = 0; f < flocks; f++) {
    const n = range(rng, 5, 9);
    const gx = w * uniform(rng, 0.15, 0.85);
    const gy = h * uniform(rng, 0.1, 0.3);
    const gs = Math.min(w, h) * uniform(rng, 0.012, 0.02);
    const dir = chance(rng, 0.5) ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const k = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
      geese.push(goose(gx + k * gs * 2.6 * dir + (k !== 0 ? uniform(rng, -gs * 0.3, gs * 0.3) : 0), gy + Math.abs(k) * gs * 1.4 + uniform(rng, -gs * 0.2, gs * 0.2), gs * uniform(rng, 0.85, 1.1)));
    }
  }
  body.push(el('g', undefined, geese));

  /* ── water ────────────────────────────────────────────────────────────── */
  body.push(rect(0, horizon, w, h - horizon, { fill: url('ka-water') }));
  body.push(ellipse(sunX, horizon + sunR * 0.4, sunR * 1.1, sunR * 0.5, { fill: KIN, opacity: 0.35, filter: url('ka-ripple') }));

  /* ── bridge ───────────────────────────────────────────────────────────── */
  const bx0 = phone ? -w * 0.04 : w * 0.04;
  const bx1 = phone ? w * 1.04 : w * 0.96;
  const bw = bx1 - bx0;
  const deckY = horizon - h * (phone ? 0.035 : 0.05);
  const rise = h * (phone ? 0.03 : 0.045);
  const deckAt = (x: number): number => {
    const t = (x - bx0) / bw;
    return deckY - rise * 4 * t * (1 - t);
  };
  const thick = h * 0.018;
  const railH = h * (phone ? 0.032 : 0.045);
  const bridge: string[] = [];
  const deck = M(bx0, deckAt(bx0)) + Q((bx0 + bx1) / 2, deckY - rise * 2, bx1, deckAt(bx1)) + L(bx1, deckAt(bx1) + thick) + Q((bx0 + bx1) / 2, deckY - rise * 2 + thick, bx0, deckAt(bx0) + thick) + Z;
  bridge.push(path(deck, { fill: DEEP }));
  const postN = phone ? 13 : 23;
  const lanternsX: number[] = [];
  for (let i = 0; i <= postN; i++) {
    const x = bx0 + (bw * i) / postN;
    const y = deckAt(x);
    const big = i % 3 === 0;
    bridge.push(rect(x - thick * 0.14, y - railH, thick * 0.28, railH, { fill: DEEP }));
    if (big) {
      bridge.push(circle(x, y - railH - thick * 0.22, thick * 0.26, { fill: DEEP }));
      bridge.push(polygon([[x - thick * 0.2, y - railH - thick * 0.3], [x + thick * 0.2, y - railH - thick * 0.3], [x, y - railH - thick * 0.75]], { fill: DEEP }));
      lanternsX.push(x);
    }
    if (i % 2 === 0 && i > 0 && i < postN) {
      // pier: two legs and a crossbeam into the water
      bridge.push(rect(x - thick * 0.7, y + thick, thick * 0.3, horizon - y - thick + h * 0.012, { fill: DEEP }));
      bridge.push(rect(x + thick * 0.4, y + thick, thick * 0.3, horizon - y - thick + h * 0.012, { fill: DEEP }));
      bridge.push(rect(x - thick * 0.9, y + thick * 1.6, thick * 1.8, thick * 0.22, { fill: DEEP }));
    }
  }
  const railTop = M(bx0, deckAt(bx0) - railH) + Q((bx0 + bx1) / 2, deckY - rise * 2 - railH, bx1, deckAt(bx1) - railH);
  bridge.push(path(railTop, { fill: 'none', stroke: DEEP, 'stroke-width': thick * 0.3 }));
  bridge.push(path(M(bx0, deckAt(bx0) - railH * 0.5) + Q((bx0 + bx1) / 2, deckY - rise * 2 - railH * 0.5, bx1, deckAt(bx1) - railH * 0.5), { fill: 'none', stroke: DEEP, 'stroke-width': thick * 0.14 }));
  // travellers
  const walkers = range(rng, 2, 5);
  for (let i = 0; i < walkers; i++) {
    const x = bx0 + bw * uniform(rng, 0.1, 0.9);
    bridge.push(traveller(x, deckAt(x) + 1, railH * 1.05, chance(rng, 0.6) ? 1 : -1));
  }
  body.push(el('g', { id: 'ka-bridge' }, bridge));
  // reflection of the bridge, mirrored about the waterline and rippled
  body.push(el('g', { opacity: 0.38, filter: url('ka-ripple') }, use('ka-bridge', { transform: `translate(0 ${fmt(horizon * 2)}) scale(1 -1)` })));

  /* ── lanterns and their reflections ───────────────────────────────────── */
  const lan: string[] = [];
  const refl: string[] = [];
  for (const x of lanternsX) {
    const y = deckAt(x) - railH - thick * 0.22;
    lan.push(circle(x, y, thick * 0.2, { fill: WARM }));
    refl.push(rect(x - thick * 0.35, horizon, thick * 0.7, h * uniform(rng, 0.12, 0.2), { fill: url('ka-refl') }));
  }
  body.push(el('g', { filter: url('ka-ripple') }, refl));
  body.push(el('g', { filter: url('ka-glow') }, lan));

  /* ── ripples ──────────────────────────────────────────────────────────── */
  const ripples: string[] = [];
  const rippleN = range(rng, 36, 60);
  for (let i = 0; i < rippleN; i++) {
    const t = uniform(rng, 0, 1) ** 1.6;
    const y = horizon + (h - horizon) * (0.02 + t * 0.9);
    const len = w * uniform(rng, 0.02, 0.12) * (0.4 + t);
    const x = uniform(rng, 0, w - len);
    ripples.push(line(x, y, x + len, y, { stroke: t < 0.3 ? mix(KIN, WASHI, 0.4) : WASHI, 'stroke-width': 1 + t * 1.5, opacity: 0.08 + (1 - t) * 0.16 }));
  }
  body.push(el('g', undefined, ripples));

  /* ── text: the full title and the arrival date ───────────────────────── */
  const belt = BELTS.find((b) => b.id === data.belt);
  const title = `${belt?.titleJa ?? ''}　${S.kyotoArrival.shodan}`.trim();
  const dateLine = `${eraDate(data.date)}　${S.kyotoArrival.arrived}`;
  const texts: TextLayer[] = [];
  const nameSize = phone ? fitSize(data.nameKana, safe.w * 0.8, h * 0.07, { max: h * 0.055 }) : fitSize(data.nameKana, w * 0.4, h * 0.11, { max: h * 0.085 });
  const titleSize = Math.round(nameSize * 0.46);
  const dateSize = Math.round(nameSize * 0.34);
  if (phone) {
    const cx = w / 2;
    const y1 = safe.y + safe.h * 0.78;
    texts.push({ text: data.nameKana, x: cx, y: y1, size: nameSize, font: FONTS.mincho, fill: WASHI, anchor: 'middle', weight: 600, letterSpacing: nameSize * 0.12, lang: 'ja' });
    texts.push({ text: title, x: cx, y: y1 + titleSize * 1.9, size: titleSize, font: FONTS.mincho, fill: mix(KIN, WASHI, 0.3), anchor: 'middle', letterSpacing: titleSize * 0.15, lang: 'ja' });
    texts.push({ text: dateLine, x: cx, y: y1 + titleSize * 1.9 + dateSize * 2.1, size: dateSize, font: FONTS.mincho, fill: WASHI, anchor: 'middle', opacity: 0.85, lang: 'ja' });
  } else {
    const x = w * 0.07;
    const y1 = h * 0.8;
    texts.push({ text: data.nameKana, x, y: y1, size: nameSize, font: FONTS.mincho, fill: WASHI, anchor: 'start', weight: 600, letterSpacing: nameSize * 0.12, lang: 'ja' });
    texts.push({ text: title, x, y: y1 + titleSize * 1.8, size: titleSize, font: FONTS.mincho, fill: mix(KIN, WASHI, 0.3), anchor: 'start', letterSpacing: titleSize * 0.15, lang: 'ja' });
    texts.push({ text: dateLine, x, y: y1 + titleSize * 1.8 + dateSize * 2.1, size: dateSize, font: FONTS.mincho, fill: WASHI, anchor: 'start', opacity: 0.85, lang: 'ja' });
  }
  // the seal with the chosen kanji, set after the title
  const titleLayer = texts[1]!;
  const sealSize = titleSize * 1.5;
  const sealX = phone ? w / 2 + textWidth(title, titleSize, { letterSpacing: titleSize * 0.15 }) / 2 + titleSize * 0.6 : w * 0.07 + textWidth(title, titleSize, { letterSpacing: titleSize * 0.15 }) + titleSize * 0.6;
  const sealY = titleLayer.y - sealSize * 0.78;
  body.push(path(sealFrame({ x: sealX, y: sealY, size: sealSize, round: false, seed: seed ^ 0x3b3b, stroke: sealSize * 0.08, erode: 0.012 }), { fill: SHU, 'fill-rule': 'evenodd', opacity: 0.95 }));
  const glyph = data.chosenKanji ?? Array.from(data.nameKana)[0] ?? '京';
  texts.push({ text: glyph, x: sealX + sealSize / 2, y: sealY + sealSize * 0.5 + sealSize * 0.22, size: sealSize * 0.6, font: FONTS.brush, fill: SHU, anchor: 'middle', lang: 'ja' });

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'none' };
}
