/**
 * TSUZUKU — kakejiku 'chaya-lanterns' 茶屋の灯 (design 08 §11).
 *
 * A roadside teahouse on the Tōkaidō at dusk. The sky runs ai → sakura → warm
 * over a noise ridge of hills; the road comes in from the near corner and bends
 * past the house toward a vanishing point just under the horizon. The teahouse
 * is a low timber frame under a thatched roof: open front, a noren in the
 * learner's belt colour, a bench with a red cloth and a seated traveller, a
 * kettle and its steam, and the warm glow of the room. One chōchin paper
 * lantern per `HOURS_PER_LANTERN` (10) hours of ledger listening — dojo rows
 * and outside rows alike — hangs first under the eaves, then from the rope
 * strung between the roadside posts, receding with the road, so the string
 * grows into the distance as the hours grow. Living piece; no per-speaker data
 * (design 08 §16).
 *
 * The hours come from `WallpaperData.listenHours` (`art/wallpapers/data.ts`
 * fills it from the ledger's `listen` rows, `store/wallpaper-defs buildData`
 * likewise); 0 → no lantern yet, the room still lit. Personal
 * text (name, hours heard, date) is returned as TextLayers inside the phone
 * safe zones; the SVG carries no personal text.
 *
 * Seed → horizon, stars, moon, hill ridges, road wobble, tree line, lantern
 * sway, steam, birds, grass.
 */
import { mulberry32, range, uniform, type Rng } from '../../shared/hash';
import { INK, PALETTE, SUMI, WARM, WASHI, beltColor, lighten, mix } from '../color';
import { clamp, lerp, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { M, Q, blur, circle, el, ellipse, fmt, g, line, linearGradient, path, polyPath, polyline, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';

const ID = 'chaya-lanterns';

/** One chōchin per this many hours of ledger listening (design 08 §11). */
export const HOURS_PER_LANTERN = 10;
/** Lanterns the eaves and the roadside rope can hold (600 h; past it the string is full). */
export const MAX_LANTERNS = 60;

/**
 * Fixed captions. ARCHITECTURE §8 keeps copy in a strings file; the group-5
 * strings file belongs to the art owner, so these sit here until it exists.
 */
const CAPTIONS = {
  title: '茶屋の灯',
  heard: '聴いた時間',
  hoursUnit: '時間',
  tea: '茶',
} as const;

const AI = PALETTE.light.ai;
const KON = PALETTE.light.kon;
const SAKURA = PALETTE.light.sakura;
const SHU = PALETTE.light.shu;
const TIMBER = '#2A1C12';
const TIMBER_DARK = '#1B120B';
const THATCH = '#5A4628';
const THATCH_LIGHT = '#7A6238';
const PAPER_EDGE = '#E58F2A';

/** Ledger listen hours the piece draws from (`WallpaperData.listenHours`, design 08 §11); a non-finite or negative value (hand-built data) reads as 0. */
export function listenHoursOf(data: WallpaperData): number {
  const h: unknown = data.listenHours;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : 0;
}

/** `floor(hours / HOURS_PER_LANTERN)`, never below 0 nor above `MAX_LANTERNS`. */
export function lanternCount(hours: number): number {
  return clamp(Math.floor(hours / HOURS_PER_LANTERN), 0, MAX_LANTERNS);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Road                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Road {
  /** Centreline from the near corner (index 0) to the vanishing point. */
  center: Pt[];
  /** Left and right verges, same indexing; `left[i][0] < right[i][0]`. */
  left: Pt[];
  right: Pt[];
  width: number[];
}

/** The Tōkaidō: a quadratic curve from the near corner to a point under the horizon, widths in perspective. Pure in (seed, canvas). */
export function roadGeometry(seed: number, w: number, h: number, horizon: number, phone: boolean): Road {
  const rng = mulberry32(seed ^ 0x726f6164);
  const p0: Pt = [w * (phone ? 0.3 : 0.22) + uniform(rng, -w * 0.03, w * 0.03), h + 4];
  const p2: Pt = [w * (phone ? 0.28 : 0.5) + uniform(rng, -w * 0.02, w * 0.02), horizon + 2];
  const c: Pt = [w * (phone ? 0.02 : 0.28), lerp(h, horizon, uniform(rng, 0.42, 0.5))];
  const n = 28;
  const center: Pt[] = [];
  const width: number[] = [];
  const wNear = w * (phone ? 0.36 : 0.3);
  const wFar = phone ? 5 : 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    center.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]]);
    width.push(lerp(wNear, wFar, Math.pow(t, 0.85)));
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = center[Math.max(0, i - 1)]!;
    const b = center[Math.min(n, i + 1)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // the road always climbs the canvas (dy < 0), so this normal points to the visual left
    const nx = -dy / len;
    const ny = dx / len;
    const half = width[i]! / 2;
    const p = center[i]!;
    left.push([p[0] - nx * half, p[1] - ny * half]);
    right.push([p[0] + nx * half, p[1] + ny * half]);
  }
  return { center, left, right, width };
}

/** A point on the road's left verge at parameter `t` (0 near → 1 far), pushed `extra` px further out. */
export function vergeAt(road: Road, t: number, extra: number): Pt {
  const n = road.center.length - 1;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  const lx = lerp(road.left[i]![0], road.left[i + 1]![0], k);
  const ly = lerp(road.left[i]![1], road.left[i + 1]![1], k);
  const cx = lerp(road.center[i]![0], road.center[i + 1]![0], k);
  const cy = lerp(road.center[i]![1], road.center[i + 1]![1], k);
  const dx = lx - cx;
  const dy = ly - cy;
  const len = Math.hypot(dx, dy) || 1;
  return [lx + (dx / len) * extra, ly + (dy / len) * extra];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Lanterns                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Lantern {
  x: number;
  /** Hang point: the top of the string. */
  y: number;
  /** Body radius in px. */
  s: number;
  where: 'eaves' | 'road';
  /** Road parameter for roadside lanterns (0 near → 1 far); 0 under the eaves. */
  t: number;
}

export interface LanternLayout {
  /** Hang points under the eaves, nearest the doorway first (the noren and its glyph stay clear); shared y and body radius. */
  eaves: { xs: readonly number[]; y: number; s: number };
  road: Road;
  phone: boolean;
}

/** `perSide` hang points either side of the doorway `[doorL, doorR]` across `[x0, x1]`, ordered nearest the door first. */
export function eavesSlots(x0: number, x1: number, doorL: number, doorR: number, perSide: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < perSide; i++) {
    xs.push(lerp(x0, doorL, (i + 0.5) / perSide));
    xs.push(lerp(doorR, x1, (i + 0.5) / perSide));
  }
  const door = (doorL + doorR) / 2;
  return xs.sort((a, b) => Math.abs(a - door) - Math.abs(b - door) || a - b);
}

/** Cumulative arc length along the left verge (post margin included) at the road's samples. */
function vergeArc(road: Road, phone: boolean): number[] {
  const n = road.center.length - 1;
  const cum = [0];
  let prev = vergeAt(road, 0, phone ? 26 : 22);
  for (let i = 1; i <= n; i++) {
    const p = vergeAt(road, i / n, lerp(phone ? 26 : 22, 3, i / n));
    cum.push(cum[i - 1]! + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  return cum;
}

/** Road parameter at arc length `d` from the near end (1 past the far end). */
function arcToT(cum: number[], d: number): number {
  const n = cum.length - 1;
  if (d <= 0) return 0;
  if (d >= cum[n]!) return 1;
  let i = 1;
  while (i < n && cum[i]! < d) i++;
  const seg = cum[i]! - cum[i - 1]!;
  return (i - 1 + (seg > 0 ? (d - cum[i - 1]!) / seg : 0)) / n;
}

/** The rope never quite reaches the vanishing point. */
const ROPE_FAR_T = 0.95;

/**
 * Eaves slots first (from the doorway outward), then the roadside rope from
 * the near end into the distance: each lantern hangs a body-width or so past
 * the last along the verge, and once the string reaches the far end the rest
 * close on the vanishing point in ever-smaller steps, a glowing line.
 */
export function placeLanterns(seed: number, count: number, layout: LanternLayout): Lantern[] {
  const rng = mulberry32(seed ^ 0x6c616e74);
  const n = clamp(Math.floor(count), 0, MAX_LANTERNS);
  const { eaves, road, phone } = layout;
  const out: Lantern[] = [];
  const onEaves = Math.min(n, eaves.xs.length);
  // the hang points come nearest the doorway first, so a short row flanks the noren
  for (let k = 0; k < onEaves; k++) out.push({ x: eaves.xs[k]!, y: eaves.y + uniform(rng, -2, 2), s: eaves.s, where: 'eaves', t: 0 });
  const onRoad = n - onEaves;
  if (onRoad <= 0) return out;
  const cum = vergeArc(road, phone);
  const sAt = (t: number): number => lerp(phone ? 30 : 26, 3.5, t);
  let d = cum[cum.length - 1]! * 0.04;
  let t = arcToT(cum, d);
  for (let i = 0; i < onRoad; i++) {
    if (i > 0) {
      d += 2.6 * sAt(t);
      const byArc = arcToT(cum, d);
      t = byArc < ROPE_FAR_T ? byArc : t + (ROPE_FAR_T - t) * 0.4;
    }
    const s = sAt(t);
    const postH = lerp(phone ? 170 : 130, 10, t);
    const [vx, vy] = vergeAt(road, t, lerp(phone ? 26 : 22, 3, t));
    out.push({ x: vx + uniform(rng, -1, 1), y: vy - postH * 0.92, s, where: 'road', t });
  }
  return out;
}

export function chochin(l: Lantern, sway: number): string {
  const { x, y, s } = l;
  const rx = s;
  const ry = s * 1.22;
  const cap = Math.max(1.2, s * 0.24);
  const cy = y + s * 0.45 + cap + ry;
  const ribs: string[] = [];
  for (let k = 1; k <= 3; k++) {
    const yy = cy - ry + (k * 2 * ry) / 4;
    const f = Math.sqrt(Math.max(0, 1 - ((yy - cy) / ry) ** 2));
    ribs.push(path(M(x - rx * f, yy) + Q(x, yy + rx * 0.22, x + rx * f, yy), { fill: 'none', stroke: '#B8692A', 'stroke-width': Math.max(0.5, s * 0.06), opacity: 0.55 }));
  }
  const transform = Math.abs(sway) > 0.05 ? `rotate(${fmt(sway)} ${fmt(x)} ${fmt(y)})` : undefined;
  return g({ class: 'chochin', transform }, [
    circle(x, cy, s * 2.6, { fill: url('cl-glow'), opacity: 0.6 }),
    line(x, y, x, cy - ry - cap, { stroke: TIMBER, 'stroke-width': Math.max(0.6, s * 0.08) }),
    rect(x - rx * 0.5, cy - ry - cap, rx, cap, { fill: TIMBER, rx: cap * 0.3 }),
    ellipse(x, cy, rx, ry, { fill: url('cl-paper') }),
    ...ribs,
    rect(x - rx * 0.5, cy + ry, rx, cap, { fill: TIMBER, rx: cap * 0.3 }),
    line(x, cy + ry + cap, x, cy + ry + cap + s * 0.5, { stroke: SHU, 'stroke-width': Math.max(0.6, s * 0.07), 'stroke-linecap': 'round' }),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scenery                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export function pine(x: number, base: number, size: number, fill: string): string {
  const trunk = rect(x - size * 0.06, base - size * 0.3, size * 0.12, size * 0.3, { fill });
  const tiers: string[] = [];
  for (let k = 0; k < 3; k++) {
    const y = base - size * 0.3 - k * size * 0.28;
    const half = size * (0.5 - k * 0.11);
    tiers.push(path(polyPath([[x - half, y], [x, y - size * 0.42], [x + half, y]], true), { fill }));
  }
  return g(undefined, [trunk, ...tiers]);
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng: Rng = mulberry32(seed);
  const horizon = Math.round(h * (phone ? uniform(rng, 0.49, 0.53) : uniform(rng, 0.56, 0.6)));
  const ground = h - horizon;
  const hours = listenHoursOf(data);
  const count = lanternCount(hours);
  const belt = beltColor(data.belt);

  const defs = [
    linearGradient('cl-sky', [[0, AI], [0.35, mix(AI, SAKURA, 0.5)], [0.7, SAKURA], [0.9, mix(SAKURA, WARM, 0.5)], [1, mix(WARM, WASHI, 0.3)]], 90),
    linearGradient('cl-ground', [[0, mix('#2F3D2B', KON, 0.35)], [1, '#0D120E']], 90),
    linearGradient('cl-road', [[0, mix('#7D6A50', SAKURA, 0.25)], [0.3, '#7D6A50'], [1, '#9A8260']], 90),
    radialGradient('cl-glow', [[0, WARM, 0.55], [0.4, WARM, 0.16], [1, WARM, 0]]),
    linearGradient('cl-paper', [[0, lighten(WARM, 0.55)], [0.5, WARM], [1, PAPER_EDGE]], 0),
    radialGradient('cl-room', [[0, lighten(WARM, 0.3), 0.95], [0.6, WARM, 0.55], [1, '#7A4A18', 0.2]], { cy: 0.6 }),
    linearGradient('cl-shore', [[0, SUMI, 0], [1, SUMI, 0.7]], 90),
    blur('cl-haze', 42),
    blur('cl-soft', 7),
  ];

  /* ── sky: stars, a moon more often than not, birds ─────────────────────── */
  const stars: string[] = [];
  const nStars = phone ? 70 : 55;
  for (let i = 0; i < nStars; i++) {
    const x = rng() * w;
    const y = Math.pow(rng(), 1.4) * horizon * 0.5;
    stars.push(circle(x, y, uniform(rng, 0.5, 1.5), { fill: WASHI, opacity: uniform(rng, 0.2, 0.7) }));
  }
  const moon: string[] = [];
  if (rng() < 0.55) {
    const mx = uniform(rng, 0.55, 0.82) * w;
    const my = uniform(rng, 0.1, 0.3) * horizon;
    const r = uniform(rng, 0.025, 0.04) * Math.min(w, h);
    moon.push(circle(mx, my, r * 2.4, { fill: WASHI, opacity: 0.08, filter: url('cl-haze') }));
    moon.push(circle(mx, my, r, { fill: '#F2E9D2', opacity: 0.92 }));
    if (rng() < 0.7) moon.push(circle(mx + r * 0.45, my - r * 0.2, r * 0.9, { fill: mix(AI, SAKURA, 0.5) }));
  }
  const birds: string[] = [];
  const birdN = range(rng, 2, 5);
  const bx = w * uniform(rng, 0.1, 0.6);
  const by = horizon * uniform(rng, 0.25, 0.5);
  for (let i = 0; i < birdN; i++) {
    const x = bx + i * w * 0.02 + uniform(rng, -8, 8);
    const y = by + i * h * 0.01 + uniform(rng, -6, 6);
    const s = uniform(rng, 5, 9);
    birds.push(polyline([[x - s, y], [x - s * 0.4, y - s * 0.5], [x, y], [x + s * 0.4, y - s * 0.5], [x + s, y]], { fill: 'none', stroke: INK, 'stroke-width': 1.3, opacity: 0.7 }));
  }

  /* ── hills, tree line, ground ──────────────────────────────────────────── */
  const hills: string[] = [];
  const farAmp = ground * (phone ? 0.16 : 0.24);
  const far = ridge(seed ^ 0x51a7, 44, farAmp);
  const farPts: Pt[] = far.map((v, i) => [(i / (far.length - 1)) * w, horizon - v * 0.7 - 8]);
  hills.push(path(polyPath([[0, horizon + 4], ...farPts, [w, horizon + 4]], true), { fill: mix(KON, SUMI, 0.55) }));
  const near = ridge(seed ^ 0x2b1d, 52, farAmp * 0.5);
  const nearPts: Pt[] = near.map((v, i) => [(i / (near.length - 1)) * w, horizon - v - 2]);
  hills.push(path(polyPath([[0, horizon + 4], ...nearPts, [w, horizon + 4]], true), { fill: '#15221C' }));
  const trees: string[] = [];
  const treeN = range(rng, 3, 5);
  for (let i = 0; i < treeN; i++) {
    const tx = uniform(rng, 0.02, 0.3) * w;
    const idx = Math.round((tx / w) * (near.length - 1));
    const base = horizon - (near[idx] ?? 0) + 2;
    trees.push(pine(tx, base, uniform(rng, 34, 64) * (phone ? 1.25 : 1), '#0D1A16'));
  }
  const groundRect = rect(0, horizon, w, ground, { fill: url('cl-ground') });

  /* ── road with ruts and a stone marker ────────────────────────────────── */
  const road = roadGeometry(seed, w, h, horizon, phone);
  const roadBody = path(polyPath([...road.left, ...road.right.slice().reverse()], true), { fill: url('cl-road') });
  const ruts: string[] = [];
  for (const side of [-0.28, 0.28]) {
    const pts: Pt[] = road.center.map((p, i) => {
      const l = road.left[i]!;
      const r = road.right[i]!;
      return [p[0] + (r[0] - l[0]) * side, p[1] + (r[1] - l[1]) * side];
    });
    ruts.push(polyline(pts, { fill: 'none', stroke: '#6B5944', 'stroke-width': phone ? 2.2 : 1.8, opacity: 0.55 }));
  }
  const [mkx, mky] = vergeAt(road, 0.3, phone ? 40 : 34);
  const mkH = phone ? 46 : 36;
  const marker = g(undefined, [rect(mkx - mkH * 0.18, mky - mkH, mkH * 0.36, mkH, { fill: '#5E5A52', rx: 2 }), rect(mkx - mkH * 0.22, mky - mkH * 1.08, mkH * 0.44, mkH * 0.12, { fill: '#4A463F', rx: 1 })]);
  const haze = ellipse(w / 2, horizon + 6, w * 0.6, phone ? 70 : 54, { fill: WARM, opacity: 0.18, filter: url('cl-haze') });

  /* ── the teahouse ──────────────────────────────────────────────────────── */
  const hcx = w * (phone ? 0.63 : 0.69);
  const base = horizon + ground * (phone ? 0.3 : 0.4);
  const hw = w * (phone ? 0.58 : 0.3);
  const hh = hw * 0.52;
  const eavesY = base - hh * 0.95;
  const ridgeY = base - hh * 1.7;
  const left = hcx - hw / 2;
  const right = hcx + hw / 2;
  const post = Math.max(3, hw * 0.022);
  const roofLines: string[] = [];
  for (let k = 1; k <= 5; k++) {
    const f = k / 6;
    roofLines.push(line(lerp(left + hw * 0.18, left - hw * 0.14, f), lerp(ridgeY, eavesY, f), lerp(right - hw * 0.18, right + hw * 0.14, f), lerp(ridgeY, eavesY, f), { stroke: '#3E2F1A', 'stroke-width': 1.5, opacity: 0.5 }));
  }
  const norenStrips: string[] = [];
  for (let k = 0; k < 3; k++) {
    const sw = hw * 0.1;
    const x = hcx - hw * 0.165 + k * (sw + hw * 0.0125);
    norenStrips.push(rect(x, eavesY + hh * 0.02, sw, hh * 0.42, { fill: belt, opacity: 0.95 }));
  }
  const house: string[] = [
    ellipse(hcx, base + hh * 0.03, hw * 0.62, hh * 0.1, { fill: SUMI, opacity: 0.4, filter: url('cl-soft') }),
    rect(left - hw * 0.04, base - hh * 0.12, hw * 1.08, hh * 0.12, { fill: '#3B2A1C' }),
    rect(left - hw * 0.04, base - hh * 0.12, hw * 1.08, hh * 0.02, { fill: '#5A4430' }),
    rect(left, base - hh, hw, hh - hh * 0.12, { fill: '#241A12' }),
    rect(hcx - hw * 0.32, base - hh * 0.9, hw * 0.64, hh * 0.78, { fill: url('cl-room') }),
    rect(left + hw * 0.05, base - hh * 0.88, hw * 0.18, hh * 0.5, { fill: '#4A3A26', opacity: 0.9 }),
    rect(right - hw * 0.23, base - hh * 0.88, hw * 0.18, hh * 0.5, { fill: '#4A3A26', opacity: 0.9 }),
    ...[left, hcx - hw * 0.17, hcx + hw * 0.17, right - post].map((px) => rect(px, eavesY, post, base - eavesY, { fill: TIMBER_DARK })),
    ...norenStrips,
    rect(hcx - hw * 0.18, eavesY + hh * 0.02, hw * 0.36, hh * 0.05, { fill: belt }),
    path(polyPath([[left - hw * 0.14, eavesY], [left + hw * 0.18, ridgeY], [right - hw * 0.18, ridgeY], [right + hw * 0.14, eavesY]], true), { fill: THATCH }),
    path(polyPath([[left + hw * 0.18, ridgeY], [right - hw * 0.18, ridgeY], [right - hw * 0.16, ridgeY + hh * 0.08], [left + hw * 0.16, ridgeY + hh * 0.08]], true), { fill: THATCH_LIGHT }),
    ...roofLines,
    rect(left - hw * 0.14, eavesY - hh * 0.02, hw * 1.28, hh * 0.035, { fill: TIMBER_DARK }),
  ];
  // bench with its red cloth on the platform, a seated traveller, the kettle and its steam
  const benchW = hw * 0.22;
  const benchH = hh * 0.045;
  const benchX = left + hw * 0.02;
  const benchY = base - hh * 0.26;
  const tx = benchX + benchW * 0.55;
  const ts = hh * 0.3;
  const kx = right - hw * 0.1;
  const ky = base - hh * 0.14;
  const steam: string[] = [];
  for (let k = 0; k < 3; k++) {
    steam.push(ellipse(kx + uniform(rng, -6, 6) + k * 3, ky - hh * 0.12 - k * hh * 0.11, hw * (0.03 + k * 0.012), hh * (0.05 + k * 0.02), { fill: WASHI, opacity: 0.22 - k * 0.05 }));
  }
  const front: string[] = [
    rect(benchX, benchY, benchW, benchH, { fill: '#3B2A1C' }),
    rect(benchX + benchW * 0.05, benchY - benchH * 0.5, benchW * 0.9, benchH * 0.8, { fill: SHU }),
    rect(benchX + benchW * 0.08, benchY + benchH, benchH * 0.5, hh * 0.14, { fill: '#3B2A1C' }),
    rect(benchX + benchW * 0.88, benchY + benchH, benchH * 0.5, hh * 0.14, { fill: '#3B2A1C' }),
    circle(tx, benchY - ts * 0.78, ts * 0.13, { fill: INK }),
    path(polyPath([[tx - ts * 0.22, benchY - ts * 0.6], [tx + ts * 0.22, ts * 0 + benchY - ts * 0.6], [tx + ts * 0.26, benchY - benchH * 0.5], [tx - ts * 0.26, benchY - benchH * 0.5]], true), { fill: INK }),
    line(kx - hh * 0.06, ky, kx, ky - hh * 0.16, { stroke: TIMBER_DARK, 'stroke-width': 2 }),
    line(kx + hh * 0.06, ky, kx, ky - hh * 0.16, { stroke: TIMBER_DARK, 'stroke-width': 2 }),
    ellipse(kx, ky - hh * 0.07, hh * 0.05, hh * 0.04, { fill: INK }),
    g({ filter: url('cl-soft') }, steam),
  ];

  /* ── lanterns: eaves first, then the roadside rope ─────────────────────── */
  const lanterns = placeLanterns(seed, count, {
    eaves: { xs: eavesSlots(hcx - hw * 0.58, hcx + hw * 0.58, hcx - hw * 0.22, hcx + hw * 0.22, phone ? 3 : 4), y: eavesY + hh * 0.025, s: hw * (phone ? 0.046 : 0.04) },
    road,
    phone,
  });
  const onRoad = lanterns.filter((l) => l.where === 'road');
  const onEaves = lanterns.filter((l) => l.where === 'eaves');
  const roadside: string[] = [];
  if (onRoad.length > 0) {
    roadside.push(polyline(onRoad.map((l): Pt => [l.x, l.y]), { fill: 'none', stroke: TIMBER, 'stroke-width': 1.4, opacity: 0.8 }));
    onRoad.forEach((l, i) => {
      if (i % 4 === 0 || i === onRoad.length - 1) {
        const [, vy] = vergeAt(road, l.t, lerp(phone ? 26 : 22, 3, l.t));
        const pw = Math.max(1.5, l.s * 0.28);
        roadside.push(rect(l.x - l.s * 0.9 - pw / 2, l.y - l.s * 0.2, pw, Math.max(2, vy - l.y + l.s * 0.2), { fill: TIMBER_DARK }));
      }
    });
    for (let i = onRoad.length - 1; i >= 0; i--) {
      const l = onRoad[i]!;
      roadside.push(chochin(l, uniform(rng, -2, 2) * (1 - l.t)));
    }
  }
  const eavesRow = onEaves.map((l) => chochin(l, uniform(rng, -3, 3)));

  /* ── foreground grass ──────────────────────────────────────────────────── */
  let grassD = '';
  const nGrass = range(rng, 24, 44);
  for (let i = 0; i < nGrass; i++) {
    const onLeft = rng() < 0.45;
    const x = onLeft ? uniform(rng, 0, 0.1) * w : uniform(rng, 0.62, 1) * w;
    const gy = uniform(rng, h - ground * 0.3, h);
    const len = uniform(rng, 30, 110) * (phone ? 1.2 : 1);
    const lean = uniform(rng, -24, 24);
    grassD += M(x, gy) + Q(x + lean * 0.35, gy - len * 0.6, x + lean, gy - len);
  }
  const grass = path(grassD, { stroke: '#06090B', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' });

  const body = [
    rect(0, 0, w, horizon + 2, { fill: url('cl-sky') }),
    g({ opacity: 0.9 }, stars),
    ...moon,
    g(undefined, birds),
    ...hills,
    g(undefined, trees),
    groundRect,
    roadBody,
    ...ruts,
    haze,
    marker,
    g({ class: 'teahouse' }, house),
    g({ class: 'roadside' }, roadside),
    g({ class: 'eaves' }, eavesRow),
    g(undefined, front),
    grass,
    rect(0, h - 120, w, 120, { fill: url('cl-shore') }),
  ];

  /* ── text layers (personal text lives here, never in the SVG) ──────────── */
  const safe = safeRect(size);
  const texts: TextLayer[] = [];
  const nameMaxW = phone ? w * 0.62 : w * 0.42;
  // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box.
  const nameSize = fitSize(data.nameKana, nameMaxW, phone ? 84 : 72, { max: phone ? 84 : 72 });
  const nameX = phone ? w * 0.08 : w * 0.06;
  const nameY = phone ? safe.y + 150 : h * 0.16;
  texts.push({ text: data.nameKana, x: nameX, y: nameY, size: nameSize, font: FONTS.brush, fill: WASHI, opacity: 0.94, lang: 'ja' });
  texts.push({ text: `${CAPTIONS.heard} ${Math.floor(hours)}${CAPTIONS.hoursUnit}`, x: nameX + 2, y: nameY + (phone ? 66 : 54), size: phone ? 32 : 26, font: FONTS.mincho, fill: WARM, opacity: 0.88, lang: 'ja' });
  texts.push({ text: CAPTIONS.title, x: phone ? w * 0.9 : w * 0.955, y: phone ? safe.y + 50 : h * 0.07, size: phone ? 30 : 26, font: FONTS.mincho, fill: WASHI, vertical: true, opacity: 0.65, lang: 'ja' });
  texts.push({ text: CAPTIONS.tea, x: hcx, y: eavesY + hh * 0.32, size: hw * 0.11, font: FONTS.brush, fill: WASHI, anchor: 'middle', opacity: 0.92, lang: 'ja' });
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

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: ID, living: true, compose };
