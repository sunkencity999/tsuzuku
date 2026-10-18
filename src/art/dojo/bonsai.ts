/**
 * TSUZUKU — the dojo bonsai (design 06 §5): an L-system pine that grows with
 * total training days.
 *
 *  depthFor(days)   3 at day 1 → 8 at day 365 on a log scale, then stays 8
 *  growBonsai(o)    the pure model: branches by level, foliage pads, blossoms
 *  bonsaiSvg(o)     the model as one `<g>` (pot, stand, branches, pads, blooms)
 *
 * Growth is monotone: level `k` is drawn from `rngFor(seed, 'bonsai', k)`, so
 * the tree at depth d is a prefix of the tree at depth d + 1 and a day never
 * removes a branch. Blossoms (sakura) appear while `blooming` (100 total
 * days). A long gap gives a pruned look (fewer, tighter pads) but the tree is
 * never dead: at least three pads, always green; `healing` (0 → 1 over the
 * seven days back, design 09 §8) interpolates the pruned pads back to the full
 * tree, 40 → 100 %. Seasons tint the needles; winter adds snow caps.
 */
import { hashSeed, mulberry32, type Rng } from '../../shared/hash';
import { INK, WASHI, lighten, mix } from '../color';
import { clamp, polar, rad, type Pt } from '../geom';
import { M, Q, el, ellipse, g, path, radialGradient, rect, roundedRectPath, url, circle } from '../svg';
import { WOOD, tok, type Season } from './room';

export const DEPTH_MIN = 3;
export const DEPTH_MAX = 8;
export const DEPTH_FULL_DAYS = 365;
/** Total training days at which the bonsai blooms (design 06 §5). */
export const BLOOM_DAYS = 100;
/** Hard ceiling on branch segments (DOM budget: branches render as one path per level). */
export const MAX_BRANCHES = 320;
export const MAX_PADS = 36;
/** A pruned tree keeps at most this share of `MAX_PADS`. */
export const PRUNED_PAD_SHARE = 0.6;
export const MIN_PADS = 3;
export const MAX_BLOOMS = 18;

/** 3 at day 1 → 8 at day 365 (log scale), clamped; monotone in `totalDays`. */
export function depthFor(totalDays: number): number {
  const d = clamp(Number.isFinite(totalDays) ? totalDays : 1, 1, DEPTH_FULL_DAYS);
  return Math.round(DEPTH_MIN + (DEPTH_MAX - DEPTH_MIN) * (Math.log(d) / Math.log(DEPTH_FULL_DAYS)));
}

/** Overall size factor 0.78 → 1 over the first year (monotone). */
export function sizeFor(totalDays: number): number {
  const d = clamp(Number.isFinite(totalDays) ? totalDays : 1, 1, DEPTH_FULL_DAYS);
  return 0.78 + 0.22 * (Math.log(d) / Math.log(DEPTH_FULL_DAYS));
}

/** Needle color by season (pine stays green; autumn warms, winter mutes). */
export const NEEDLE: Record<Season, string> = {
  spring: '#7BB661',
  summer: '#4E8A3C',
  autumn: mix('#4E8A3C', '#E0B341', 0.35),
  winter: mix('#4E8A3C', '#5E5A52', 0.35),
};
export const BARK = mix(WOOD, INK, 0.25);

export interface BonsaiOptions {
  totalDays: number;
  blooming: boolean;
  seed: number;
  /** Base point: the centre of the stand's foot. */
  x: number;
  y: number;
  scale: number;
  /** Default spring. */
  season?: Season;
  /** Current streak: denser foliage up to +20 % at 30 days. */
  streak?: number;
  /** Pruned look after a long gap (fewer, tighter pads; never dead). */
  pruned?: boolean;
  /** 0 → 1 over `returnedDaysAgo / 7` while pruned: pad density 40 → 100 %, pad size 80 → 100 %. */
  healing?: number;
  /** `id` of the group (the since-yesterday pulse targets it). */
  id?: string;
}

export interface Branch {
  a: Pt;
  /** Quadratic control point. */
  c: Pt;
  b: Pt;
  /** 0 = trunk. */
  level: number;
  /** Degrees, screen space (−90 = up). */
  angle: number;
  len: number;
}

export interface Pad {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface BonsaiModel {
  depth: number;
  size: number;
  branches: Branch[];
  tips: Pt[];
  pads: Pad[];
  blooms: Pt[];
  pruned: boolean;
  /** 0–1 while pruned (1 = fully healed, also when not pruned). */
  healing: number;
  season: Season;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Model                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function mkBranch(a: Pt, angle: number, len: number, level: number, bend: number): Branch {
  const b = polar(a[0], a[1], len, rad(angle));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const nx = -(b[1] - a[1]) / (len || 1);
  const ny = (b[0] - a[0]) / (len || 1);
  return { a, c: [mx + nx * bend, my + ny * bend], b, level, angle, len };
}

/** The tree in local space: origin at the soil, y up is negative. */
export function growBonsai(o: BonsaiOptions): BonsaiModel {
  const depth = depthFor(o.totalDays);
  const size = sizeFor(o.totalDays);
  const season = o.season ?? 'spring';
  const pruned = Boolean(o.pruned);
  const healing = pruned ? clamp(Number.isFinite(o.healing ?? 0) ? (o.healing ?? 0) : 0, 0, 1) : 1;
  const trunkRng = mulberry32(hashSeed(o.seed, 'bonsai', 'trunk'));
  const lean = (trunkRng() - 0.5) * 24;
  const trunkLen = 62 * size;
  const trunk = mkBranch([0, 0], -90 + lean, trunkLen, 0, (trunkRng() - 0.5) * trunkLen * 0.3);
  const branches: Branch[] = [trunk];
  let level: Branch[] = [trunk];

  for (let k = 1; k < depth; k++) {
    const rng = mulberry32(hashSeed(o.seed, 'bonsai', 'level', k));
    const next: Branch[] = [];
    for (const p of level) {
      let kids = 2;
      const roll = rng();
      if (k >= 2 && roll < 0.18) kids = 1;
      else if (k >= 2 && roll > 0.9) kids = 3;
      if (branches.length + kids > MAX_BRANCHES) kids = Math.max(0, MAX_BRANCHES - branches.length);
      const spread = 26 + rng() * 18;
      for (let j = 0; j < kids; j++) {
        const side = kids === 1 ? (rng() < 0.5 ? -1 : 1) : j === 0 ? -1 : j === 1 ? 1 : 0;
        let angle = p.angle + side * spread + (rng() - 0.5) * 14;
        // pine pads flatten toward the horizontal as the tree spreads
        const horizon = angle < -90 ? -180 : 0;
        angle += (horizon - angle) * 0.12;
        angle = clamp(angle, -172, -8);
        const len = p.len * (0.66 + rng() * 0.14);
        next.push(mkBranch(p.b, angle, len, k, (rng() - 0.5) * len * 0.35));
      }
    }
    branches.push(...next);
    level = next;
    if (next.length === 0) break;
  }

  const last = branches.filter((b) => b.level === depth - 1);
  const tipsFrom = last.length >= MIN_PADS ? last : branches.filter((b) => b.level >= Math.max(0, depth - 2));
  const tips: Pt[] = tipsFrom.map((b) => b.b);

  const padRng = mulberry32(hashSeed(o.seed, 'bonsai', 'pads'));
  const streakBonus = pruned ? 0 : Math.min(0.2, Math.max(0, o.streak ?? 0) / 150);
  // pruned: 40 % of the tips, healing toward the full 75 % over the week back (design 09 §8)
  const density = (pruned ? 0.4 + (0.75 - 0.4) * healing : 0.75) + streakBonus;
  const padCap = pruned ? Math.round(MAX_PADS * (PRUNED_PAD_SHARE + (1 - PRUNED_PAD_SHARE) * healing)) : MAX_PADS;
  const wanted = clamp(Math.round(tips.length * density), MIN_PADS, padCap);
  const count = Math.min(wanted, tips.length);
  const pads: Pad[] = [];
  const step = tips.length / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const t = tips[Math.min(tips.length - 1, Math.floor(i * step))]!;
    const rx = (8 + padRng() * 6) * size * (pruned ? 0.8 + 0.2 * healing : 1);
    pads.push({ x: t[0] + (padRng() - 0.5) * 4, y: t[1] - rx * 0.15, rx, ry: rx * 0.5 });
  }

  const blooms: Pt[] = [];
  if (o.blooming && pads.length > 0) {
    const bloomRng = mulberry32(hashSeed(o.seed, 'bonsai', 'bloom'));
    const n = Math.min(MAX_BLOOMS, pads.length * 2);
    for (let i = 0; i < n; i++) {
      const p = pads[i % pads.length]!;
      const a = bloomRng() * Math.PI * 2;
      blooms.push([p.x + Math.cos(a) * p.rx * 0.9, p.y + Math.sin(a) * p.ry * 0.9]);
    }
  }

  return { depth, size, branches, tips, pads, blooms, pruned, healing, season };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rendering                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const PAD_ID = 'dj-bonsai-pad';

/** Stroke width of level `k` (trunk 10 × size, × 0.72 per level, floor 0.8). */
export function branchWidth(level: number, size: number): number {
  return Math.max(0.8, 10 * size * 0.72 ** level);
}

/** `<g class="bonsai" transform="translate(x y) scale(s)">` — pot, stand, branches (one path per level), pads, blooms. */
export function bonsaiSvg(o: BonsaiOptions): string {
  const m = growBonsai(o);
  const needle = NEEDLE[m.season];
  const parts: string[] = [];

  parts.push(el('defs', undefined, radialGradient(PAD_ID, [[0, lighten(needle, 0.35)], [0.7, needle], [1, mix(needle, INK, 0.3)]], { cx: 0.4, cy: 0.35, r: 0.7 })));

  // stand and pot (origin = foot of the stand)
  parts.push(rect(-48, -4, 96, 4, { fill: mix(WOOD, INK, 0.35), rx: 1 }));
  parts.push(path(roundedRectPath(-34, -32, 68, 28, 5), { fill: tok('ai'), class: 'bonsai__pot' }));
  parts.push(rect(-38, -34, 76, 6, { fill: mix('#1F2A6B', WASHI, 0.25), rx: 2 }));
  parts.push(ellipse(0, -31, 32, 4, { fill: '#4A3B2A' }));

  // branches, one path per level
  const byLevel = new Map<number, string>();
  for (const b of m.branches) byLevel.set(b.level, (byLevel.get(b.level) ?? '') + M(b.a[0], b.a[1]) + Q(b.c[0], b.c[1], b.b[0], b.b[1]));
  const tree: string[] = [];
  for (const [level, d] of byLevel) {
    tree.push(path(d, { stroke: BARK, 'stroke-width': branchWidth(level, m.size), fill: 'none', 'stroke-linecap': 'round', class: 'bonsai__branch', 'data-level': level }));
  }

  // pads (+ snow caps in winter on up to 8 pads)
  for (const p of m.pads) tree.push(ellipse(p.x, p.y, p.rx, p.ry, { fill: url(PAD_ID), class: 'bonsai__pad' }));
  if (m.season === 'winter') {
    m.pads.slice(0, 8).forEach((p) => tree.push(ellipse(p.x, p.y - p.ry * 0.45, p.rx * 0.8, p.ry * 0.4, { fill: WASHI, opacity: 0.95, class: 'bonsai__snow' })));
  }
  for (const [x, y] of m.blooms) tree.push(circle(x, y, 2.2 * m.size, { fill: tok('sakura'), opacity: 0.95, class: 'bonsai__bloom' }));

  parts.push(g({ transform: 'translate(0 -31)' }, tree));

  return g(
    {
      class: `bonsai bonsai--${m.season}${m.pruned ? ' bonsai--pruned' : ''}${m.blooms.length ? ' bonsai--blooming' : ''}`,
      id: o.id,
      'data-healing': m.pruned ? fmtN(m.healing) : undefined,
      transform: `translate(${fmtN(o.x)} ${fmtN(o.y)}) scale(${fmtN(o.scale)})`,
      'data-depth': m.depth,
      'data-branches': m.branches.length,
      'data-pads': m.pads.length,
    },
    parts,
  );
}

function fmtN(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 100) / 100;
  return r === 0 ? '0' : String(r);
}

/** Convenience for hosts: a seeded `Rng` for bonsai-adjacent detail. */
export function bonsaiRng(seed: number, part: string): Rng {
  return mulberry32(hashSeed(seed, 'bonsai', part));
}
