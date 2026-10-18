/**
 * TSUZUKU — kakejiku 'golden-screen' (金屏風, design 06 §3).
 *
 * A six-panel byōbu standing in a dark room. Each panel is a grid of gold
 * leaf squares with luminance jitter (no two leaves the same), folded so the
 * alternate panels catch less light. Suyari-gasumi cloud bands drift across
 * the panels in paler gold, cranes built from six-point wings fly between
 * them, a pine stands in sumi at the foot of the first panels. Panel six
 * carries the formal greeting for the Nidan promotion with the learner's
 * name in tategaki (Shippori Mincho) and the era date.
 * Palette: kin jitter, sumi, washi. Unlock: 二段 Nidan.
 *
 * Seed → leaf jitter, cloud bands, crane flock, pine, hinge wear.
 */
import { chance, mulberry32, range, uniform } from '../../shared/hash';
import { PRESSURE, brushStroke } from '../brush';
import { INK, PALETTE, PRESETS, SUMI, WASHI, alpha, mix } from '../color';
import { polar, type Pt } from '../geom';
import { FONTS, columnHeight, eraDate, fitSize, type TextLayer } from '../jtext';
import { noise2 } from '../noise';
import { circle, el, ellipse, line, linearGradient, path, polygon, polyline, rect, roundedRectPath, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'golden-screen';
const GOLD = PRESETS.gold;
const LEAF_DARK = GOLD[0]!;
const LEAF = GOLD[1]!;
const LEAF_LIGHT = GOLD[2]!;
const SHU = PALETTE.light.shu;
const PANELS = 6;

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Parts                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Gold leaf grid of one panel: `cols` squares across, luminance from 2-D noise plus a sparkle of bright leaves. */
function leaf(p: Panel, cols: number, n: (x: number, y: number) => number, rng: () => number): string[] {
  const out: string[] = [];
  const s = p.w / cols;
  const rows = Math.ceil(p.h / s);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = n(p.i * 7.3 + c * 0.9, r * 0.9);
      let fill = v < 0.5 ? mix(LEAF_DARK, LEAF, v * 2) : mix(LEAF, LEAF_LIGHT, (v - 0.5) * 1.6);
      if (chance(rng, 0.04)) fill = mix(fill, WASHI, 0.25);
      const hh = Math.min(s, p.y + p.h - (p.y + r * s));
      out.push(rect(p.x + c * s, p.y + r * s, s, hh, { fill, stroke: alpha(LEAF_DARK, 0.45), 'stroke-width': 1 }));
    }
  }
  return out;
}

/** Suyari-gasumi: a stack of flat, round-ended rows in pale gold with a sumi shadow. */
function cloudBand(x: number, y: number, len: number, rowH: number, rows: number, rng: () => number, id: number): string {
  const parts: string[] = [];
  let cx = x;
  let width = len;
  for (let r = 0; r < rows; r++) {
    const d = roundedRectPath(cx, y + r * rowH * 0.92, width, rowH, rowH / 2);
    parts.push(path(d, { fill: SUMI, opacity: 0.16, transform: 'translate(3 5)' }));
    parts.push(path(d, { fill: url(`gs-cloud-${id % 2}`) }));
    const shift = width * uniform(rng, 0.18, 0.4);
    cx += chance(rng, 0.5) ? shift : -shift * 0.6;
    width *= uniform(rng, 0.55, 0.8);
  }
  return el('g', undefined, parts);
}

/** A crane in flight: six-point wings, washi body, sumi primaries, red crown; `dir` −1 flies left. */
function crane(cx: number, cy: number, s: number, dir: 1 | -1, lift: number): string {
  const P = (x: number, y: number): Pt => [cx + x * s * dir, cy + y * s];
  const upper: Pt[] = [P(-0.2, 0), P(-0.9, -0.55 - lift), P(-1.6, -0.9 - lift), P(-2.0, -0.7 - lift), P(-1.3, -0.3), P(-0.5, 0.1)];
  const lower: Pt[] = [P(0.2, 0.05), P(0.9, 0.5 + lift * 0.4), P(1.7, 0.85 + lift * 0.4), P(2.1, 0.6 + lift * 0.4), P(1.3, 0.3), P(0.5, 0.15)];
  const tips = (pts: Pt[]): Pt[] => [pts[1]!, pts[2]!, pts[3]!, pts[4]!];
  return el('g', undefined, [
    polygon(upper, { fill: WASHI, stroke: INK, 'stroke-width': s * 0.06, 'stroke-linejoin': 'round' }),
    polygon(lower, { fill: WASHI, stroke: INK, 'stroke-width': s * 0.06, 'stroke-linejoin': 'round' }),
    polygon(tips(upper), { fill: SUMI }),
    polygon(tips(lower), { fill: SUMI }),
    ellipse(cx, cy + s * 0.05, s * 0.75, s * 0.26, { fill: WASHI, stroke: INK, 'stroke-width': s * 0.05 }),
    polyline([P(0.6, -0.05), P(1.2, -0.3), P(1.75, -0.45)], { fill: 'none', stroke: INK, 'stroke-width': s * 0.12, 'stroke-linecap': 'round' }),
    circle(cx + 1.8 * s * dir, cy - 0.47 * s, s * 0.13, { fill: WASHI, stroke: INK, 'stroke-width': s * 0.04 }),
    circle(cx + 1.78 * s * dir, cy - 0.58 * s, s * 0.06, { fill: SHU }),
    polygon([P(1.9, -0.45), P(2.35, -0.4), P(1.9, -0.36)], { fill: INK }),
    polyline([P(-0.6, 0.15), P(-1.4, 0.3), P(-1.9, 0.32)], { fill: 'none', stroke: INK, 'stroke-width': s * 0.05, 'stroke-linecap': 'round' }),
    polyline([P(-0.6, 0.22), P(-1.35, 0.42), P(-1.85, 0.46)], { fill: 'none', stroke: INK, 'stroke-width': s * 0.05, 'stroke-linecap': 'round' }),
  ]);
}

/** A pine in sumi: brush trunk and flat needle clouds. */
export function pine(x: number, baseY: number, s: number, seed: number, rng: () => number): string {
  const trunk: Pt[] = [
    [x, baseY],
    [x + s * 0.1, baseY - s * 0.4],
    [x - s * 0.05, baseY - s * 0.8],
    [x + s * 0.25, baseY - s * 1.15],
    [x + s * 0.15, baseY - s * 1.5],
  ];
  const branch: Pt[] = [
    [x + s * 0.2, baseY - s * 1.05],
    [x + s * 0.7, baseY - s * 1.2],
    [x + s * 1.15, baseY - s * 1.18],
  ];
  const clouds: string[] = [];
  const spots: [number, number, number][] = [
    [x + s * 0.15, baseY - s * 1.55, 1],
    [x + s * 1.1, baseY - s * 1.3, 0.8],
    [x - s * 0.35, baseY - s * 1.2, 0.7],
    [x + s * 0.6, baseY - s * 1.85, 0.65],
  ];
  for (const [sx, sy, k] of spots) {
    const rx = s * 0.55 * k * uniform(rng, 0.9, 1.1);
    const ry = s * 0.17 * k;
    clouds.push(ellipse(sx, sy, rx, ry, { fill: SUMI }));
    clouds.push(ellipse(sx + rx * 0.3, sy - ry * 0.9, rx * 0.6, ry * 0.8, { fill: SUMI }));
    // needle fringe: short strokes along the top edge
    const n = Math.round(10 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI;
      // points on the ellipse edge and a little outside it, along the same angle
      const px = sx + rx * 0.98 * Math.cos(a);
      const py = sy + ry * 0.98 * Math.sin(a);
      const qx = sx + rx * 1.14 * Math.cos(a);
      const qy = sy + ry * 1.9 * Math.sin(a);
      clouds.push(line(px, py, qx, qy, { stroke: SUMI, 'stroke-width': s * 0.02, 'stroke-linecap': 'round' }));
    }
  }
  return el('g', undefined, [
    path(brushStroke(trunk, { width: s * 0.22, pressure: PRESSURE.flat, seed, bristle: 0.3, frequency: 5 }), { fill: SUMI }),
    path(brushStroke(branch, { width: s * 0.12, pressure: PRESSURE.taper, seed: seed ^ 0x33, bristle: 0.3 }), { fill: SUMI }),
    ...clouds,
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const safe = safeRect(size, Math.round(Math.min(w, h) * 0.05));
  const rng = mulberry32(seed);
  const n2 = noise2(seed ^ 0x6a09);

  /* ── room and screen box ──────────────────────────────────────────────── */
  const sx0 = w * (phone ? 0.03 : 0.045);
  const sx1 = w - sx0;
  const sy0 = phone ? h * 0.065 : h * 0.075;
  const sy1 = phone ? h * 0.935 : h * 0.905;
  const frame = Math.max(5, Math.round(Math.min(w, h) * 0.007));
  const panelW = (sx1 - sx0) / PANELS;
  const panels: Panel[] = [];
  for (let i = 0; i < PANELS; i++) panels.push({ x: sx0 + i * panelW, y: sy0, w: panelW, h: sy1 - sy0, i });

  const defs: string[] = [
    linearGradient('gs-room', [[0, '#141318'], [1, SUMI]], 90),
    linearGradient('gs-floor', [[0, '#1E1B16'], [1, '#0E0D0B']], 90),
    linearGradient('gs-fold-a', [[0, SUMI, 0.22], [0.5, SUMI, 0.02], [1, SUMI, 0]], 0),
    linearGradient('gs-fold-b', [[0, SUMI, 0], [0.5, SUMI, 0.05], [1, SUMI, 0.26]], 0),
    linearGradient('gs-sheen', [[0, WASHI, 0.09], [0.4, WASHI, 0], [1, SUMI, 0.1]], 90),
    linearGradient('gs-cloud-0', [[0, mix(LEAF_LIGHT, WASHI, 0.55)], [1, mix(LEAF_LIGHT, WASHI, 0.25)]], 90),
    linearGradient('gs-cloud-1', [[0, mix(LEAF_LIGHT, WASHI, 0.4)], [1, mix(LEAF, WASHI, 0.3)]], 90),
    linearGradient('gs-glow', [[0, LEAF, 0.18], [1, LEAF, 0]], 90),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('gs-room') }), rect(0, sy1, w, h - sy1, { fill: url('gs-floor') })];
  // the screen's light on the floor
  body.push(rect(sx0 - panelW * 0.2, sy1, sx1 - sx0 + panelW * 0.4, (h - sy1) * 0.8, { fill: url('gs-glow') }));

  /* ── panels: leaf, fold shading, frames ───────────────────────────────── */
  const cols = phone ? 4 : 6;
  const leafLayers: string[] = [];
  for (const p of panels) leafLayers.push(...leaf(p, cols, n2, rng));
  body.push(el('g', { 'shape-rendering': 'crispEdges' }, leafLayers));
  for (const p of panels) body.push(rect(p.x, p.y, p.w, p.h, { fill: url(p.i % 2 === 0 ? 'gs-fold-a' : 'gs-fold-b') }));
  body.push(rect(sx0, sy0, sx1 - sx0, sy1 - sy0, { fill: url('gs-sheen') }));

  /* ── suyari-gasumi ────────────────────────────────────────────────────── */
  const bands = range(rng, 3, 5);
  const clouds: string[] = [];
  for (let b = 0; b < bands; b++) {
    const rowH = (sy1 - sy0) * (phone ? 0.018 : 0.03) * uniform(rng, 0.8, 1.3);
    const y = sy0 + (sy1 - sy0) * uniform(rng, 0.06, 0.82);
    const len = panelW * uniform(rng, 1.6, phone ? 3.2 : 2.8);
    const x = sx0 - panelW * 0.3 + (sx1 - sx0 - len) * uniform(rng, 0, 1) + panelW * 0.15;
    clouds.push(cloudBand(x, y, len, rowH, range(rng, 2, 4), rng, b));
  }
  // clip the clouds to the screen so the bands never leave the gold
  defs.push(el('clipPath', { id: 'gs-screen' }, rect(sx0, sy0, sx1 - sx0, sy1 - sy0)));
  body.push(el('g', { 'clip-path': url('gs-screen') }, clouds));

  /* ── pine at the foot of the first panels ─────────────────────────────── */
  const pineS = (sy1 - sy0) * (phone ? 0.11 : 0.2);
  body.push(el('g', { 'clip-path': url('gs-screen') }, pine(sx0 + panelW * uniform(rng, 0.35, 0.9), sy1 - frame, pineS, seed ^ 0x51, rng)));

  /* ── cranes ───────────────────────────────────────────────────────────── */
  const flock = range(rng, 3, phone ? 6 : 7);
  const dir: 1 | -1 = chance(rng, 0.5) ? 1 : -1;
  const cranes: string[] = [];
  for (let i = 0; i < flock; i++) {
    const s = (sy1 - sy0) * (phone ? 0.03 : 0.055) * uniform(rng, 0.7, 1.3);
    // keep the flock to panels one to five so panel six stays for the greeting
    const cx = sx0 + panelW * uniform(rng, 0.5, PANELS - 1.4);
    const cy = sy0 + (sy1 - sy0) * uniform(rng, 0.1, phone ? 0.55 : 0.62);
    cranes.push(crane(cx, cy, s, dir, uniform(rng, -0.25, 0.35)));
  }
  body.push(el('g', { 'clip-path': url('gs-screen') }, cranes));

  /* ── lacquer frames and hinges ────────────────────────────────────────── */
  const frames: string[] = [];
  for (const p of panels) frames.push(rect(p.x, p.y, p.w, p.h, { fill: 'none', stroke: SUMI, 'stroke-width': frame }));
  frames.push(rect(sx0 - frame, sy0 - frame, sx1 - sx0 + 2 * frame, sy1 - sy0 + 2 * frame, { fill: 'none', stroke: '#050507', 'stroke-width': frame * 1.6 }));
  for (let i = 1; i < PANELS; i++) {
    const hx = sx0 + i * panelW;
    for (const t of [0.12, 0.5, 0.88]) {
      const hy = sy0 + (sy1 - sy0) * t;
      frames.push(rect(hx - frame * 1.3, hy - frame * 2.2, frame * 2.6, frame * 4.4, { fill: mix(LEAF_DARK, LEAF, uniform(rng, 0.2, 0.8)), rx: frame * 0.5 }));
    }
  }
  body.push(el('g', undefined, frames));

  /* ── panel six: the greeting ──────────────────────────────────────────── */
  const six = panels[PANELS - 1]!;
  const texts: TextLayer[] = [];
  const top = Math.max(six.y + frame * 4, safe.y);
  const bottom = Math.min(six.y + six.h - frame * 4, safe.y + safe.h);
  const colH = bottom - top;
  const name = `${data.nameKana}${S.goldenScreen.honorific}`;
  const nameSize = fitSize(name, six.w * 0.42, colH * 0.42, { vertical: true, max: phone ? 64 : 84 });
  const occasionSize = fitSize(S.goldenScreen.occasion, six.w * 0.3, colH * 0.5, { vertical: true, max: nameSize * 0.7 });
  const greetSize = fitSize(S.goldenScreen.greeting, six.w * 0.24, colH * 0.72, { vertical: true, max: nameSize * 0.52 });
  const dateSize = Math.max(14, Math.round(greetSize * 0.62));
  const colGap = six.w * 0.26;
  const nameX = six.x + six.w * 0.68;
  texts.push({ text: name, x: nameX, y: top + colH * 0.04, size: nameSize, font: FONTS.mincho, fill: SUMI, vertical: true, weight: 600, lang: 'ja' });
  texts.push({ text: S.goldenScreen.occasion, x: nameX - colGap, y: top + colH * 0.1, size: occasionSize, font: FONTS.mincho, fill: SUMI, vertical: true, lang: 'ja' });
  texts.push({ text: S.goldenScreen.greeting, x: nameX - colGap * 2, y: top + colH * 0.14, size: greetSize, font: FONTS.mincho, fill: INK, vertical: true, lang: 'ja' });
  const date = eraDate(data.date);
  const dateH = columnHeight(date, dateSize);
  // the date sits at the foot of the name column; the safe bottom wins over everything
  texts.push({ text: date, x: nameX, y: Math.max(top, bottom - dateH), size: dateSize, font: FONTS.mincho, fill: INK, vertical: true, lang: 'ja' });

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'none' };
}
