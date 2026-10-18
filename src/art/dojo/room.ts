/**
 * TSUZUKU — the dojo room (design 06 §5; design 09 §7 A/H, §8): the save file made visible.
 *
 *  tatami count by belt (2 → 10)       the floor
 *  the belt on the wall rack           `belt` (+ gold dan ticks on black)
 *  kakejiku with the chosen kanji      `chosenKanji`, an ensō while none is chosen
 *  lanterns along the eaves            one per 10 levels; LIT BY THE HOST (class), never by the string
 *  Mon shelf                           one slot per badge category; earned ones carry the real crest
 *                                      as a `<symbol>` + `<use>` (ring tier, field shape, glyph)
 *  stamp rack                          the goshuin book open on the latest stamp, the seal frame a
 *                                      shared `<symbol>` (brush.ts sealFrame)
 *  Kage silhouette                     sits in the corner the week it was beaten; leaves on Monday
 *                                      (`kageLeaving`: translateX + kasure, DojoScene.css)
 *  shōji window                        FOUR sky gradients in the defs and two sky rects (--a current,
 *                                      --b the previous phase fading out), stars, the moon from
 *                                      `moonPhase(today)` (3 nodes), a dawn and a dusk sun, a cloud —
 *                                      every phase element is always present; the host's wrapper
 *                                      `data-phase` shows the right ones (opacity only)
 *  eaves ornament                      by month: tanzaku (July), koinobori (May), snow (winter) —
 *                                      drawn, and labelled by the host from `ornamentFor()`
 *  seasonal tree                       `month` → season
 *
 * Phase (hour), lanterns-lit and the hearth state LEFT the SVG string (design 09 §10 B1): the string
 * is deterministic from the options alone and the host flips attributes and classes. `skyPhase`,
 * `seasonOf` and `SKY_STOPS` are re-exported from `shared/koyomi` (byte-identical; koyomi.test
 * asserts parity). Interior colors are CSS custom properties with Dojo-Morning fallbacks (`tok()`);
 * the sky is real color because it is the time of day, not the theme.
 *
 * `roomSvg` returns paint-ordered layers; the LAST layer is the time-of-day light overlay
 * (`overlayIndex`, always present, opacity by the host), so a host inserts the hearth, bonsai and
 * kotodama flames before it. Every part a since-yesterday pulse may target carries a `dj-p-*` id
 * (`PART_ID`); `partBox()` gives the box the reduced-motion ring is drawn around.
 */
import type { Belt } from '../../content/types';
import { hashSeed, mulberry32 } from '../../shared/hash';
import { SKY_STOPS, moonPhase, seasonOf, skyPhase, type Season, type SkyPhase } from '../../shared/koyomi';
import type { EpochDay } from '../../shared/store-types';
import { enso, sealFrame } from '../brush';
import { BELT_HEX, INK, NIGHT, PALETTE, RING_HEX, SHOJI, SUMI, TANZAKU, WARM, WASHI, mix, type Token } from '../color';
import { clamp, lerp, type Box, type Pt } from '../geom';
import { FONTS, fitSize, tategaki } from '../jtext';
import type { MonSpec } from '../mon';
import { A, M, Q, Z, circle, clipPath, el, ellipse, g, glowTwin, line, linearGradient, path, pattern, polygon, rect, symbol, text, url, use } from '../svg';

export { SKY_STOPS, seasonOf, skyPhase };
export type { Season, SkyPhase };

/* ────────────────────────────────────────────────────────────────────────── */
/* Tables                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const PHASES: readonly SkyPhase[] = ['dawn', 'day', 'dusk', 'night'];

/** Tatami count per belt (design 06 §5: 2 → 10; the black-belt hall is the full ten). */
export const TATAMI_BY_BELT: Record<Belt, number> = {
  white: 2,
  yellow: 3,
  orange: 4,
  green: 5,
  blue: 6,
  purple: 7,
  brown: 8,
  black: 10,
};

/** One lantern per `LANTERN_PER_LEVELS` levels, at most `LANTERN_MAX`. */
export const LANTERN_PER_LEVELS = 10;
export const LANTERN_MAX = 10;
/** Badge categories (`store/badge-defs BADGE_CATEGORIES`), one shelf slot each. */
export const MON_SLOTS = 9;

export function tatamiCount(belt: Belt): number {
  return TATAMI_BY_BELT[belt] ?? 2;
}

export function lanternCount(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return clamp(Math.floor(level / LANTERN_PER_LEVELS), 0, LANTERN_MAX);
}

export function lanternsLit(phase: SkyPhase): boolean {
  return phase === 'dusk' || phase === 'night';
}

/** Indigo wash over the room by phase (0 = none); DojoScene.css mirrors it on `[data-phase]`. */
export const OVERLAY_OPACITY: Record<SkyPhase, number> = { dawn: 0.06, day: 0, dusk: 0.1, night: 0.2 };

/** Shōji paper over the garden: one static value now that the phase is a class (the night overlay thins it). */
const PAPER_OPACITY = 0.45;

/** Seasonal foliage of the garden tree (winter = bare branches with snow). */
export const TREE_FOLIAGE: Record<Season, string | null> = {
  spring: mix('#F7B2C4', '#C9718A', 0.3),
  summer: '#4E8A3C',
  autumn: mix('#C9302C', '#E0B341', 0.4),
  winter: null,
};

export const WOOD = '#5C3A21';
export const WOOD_LIGHT = '#8B5A2B';
/** Lit lantern paper (the host writes it as the body fill when `lanternsLit`). */
export const LANTERN_LIT = WARM;

/** `var(--token, light-hex)`: the inline scene follows the page theme; a standalone render falls back to Dojo Morning. */
export function tok(t: Token): string {
  return `var(--${t}, ${PALETTE.light[t]})`;
}

/* ── ornaments (design 09 §7 H): drawn by month, labelled by the host ───── */

export type OrnamentId = 'tanabata' | 'koinobori' | 'yuki';

/** The eaves ornament of a month, or null (the host adds the reading and English). */
export function ornamentFor(month: number): OrnamentId | null {
  if (!Number.isFinite(month)) return null;
  const m = ((((Math.round(month) - 1) % 12) + 12) % 12) + 1;
  if (m === 7) return 'tanabata';
  if (m === 5) return 'koinobori';
  if (m === 12 || m <= 2) return 'yuki';
  return null;
}

/* ── since-yesterday parts (design 09 §7 A beat 1,700) ───────────────────── */

export type ScenePart = 'lantern' | 'bonsai' | 'stamp' | 'mon' | 'hearth' | 'belt' | 'scroll' | 'kage' | 'station';
export const SCENE_PARTS: readonly ScenePart[] = ['lantern', 'bonsai', 'stamp', 'mon', 'hearth', 'belt', 'scroll', 'kage', 'station'];

/** The `id` of the group a pulse twin (`<use>`) references, per part. */
export const PART_ID: Record<ScenePart, string> = {
  lantern: 'dj-p-lantern',
  bonsai: 'dj-p-bonsai',
  stamp: 'dj-p-stamp',
  mon: 'dj-p-mon',
  hearth: 'dj-p-hearth',
  belt: 'dj-p-belt',
  scroll: 'dj-p-scroll',
  kage: 'dj-p-kage',
  station: 'dj-p-scroll',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Layout                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RoomLayout {
  w: number;
  h: number;
  /** Scale factors against the 960 × 540 reference. */
  sx: number;
  sy: number;
  /** Minimum of sx/sy, for stroke widths and glyph sizes. */
  s: number;
  floorTop: number;
  eaves: Box;
  window: Box;
  scroll: Box;
  rack: Box;
  shelf: Box;
  stamps: Box;
  hearth: Box;
  kage: Box;
  /** Where the kotodama flames drift. */
  hall: Box;
  /** Where the eaves ornament hangs. */
  ornament: Box;
  bonsai: { x: number; y: number; scale: number };
}

/** Reference composition 960 × 540, scaled proportionally to `w × h`. */
export function roomLayout(w: number, h: number): RoomLayout {
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const sx = W / 960;
  const sy = H / 540;
  const box = (x: number, y: number, bw: number, bh: number): Box => ({ x: x * sx, y: y * sy, w: bw * sx, h: bh * sy });
  return {
    w: W,
    h: H,
    sx,
    sy,
    s: Math.min(sx, sy),
    floorTop: 335 * sy,
    eaves: box(0, 0, 960, 34),
    window: box(50, 70, 280, 240),
    scroll: box(400, 56, 120, 268),
    rack: box(585, 92, 135, 100),
    shelf: box(585, 250, 335, 40),
    stamps: box(700, 380, 120, 90),
    hearth: box(420, 392, 120, 80),
    kage: box(850, 300, 90, 100),
    hall: box(40, 40, 880, 290),
    ornament: box(6, 34, 40, 70),
    bonsai: { x: 175 * sx, y: 500 * sy, scale: Math.min(sx, sy) },
  };
}

/** The box a part's reduced-motion ring is drawn around (and a pulse twin covers). */
export function partBox(L: RoomLayout, part: ScenePart): Box {
  switch (part) {
    case 'lantern':
      return { x: 0, y: 0, w: L.w, h: L.eaves.h + 60 * L.sy };
    case 'bonsai':
      return { x: L.bonsai.x - 60 * L.sx, y: L.bonsai.y - 150 * L.sy, w: 120 * L.sx, h: 150 * L.sy };
    case 'stamp':
      return L.stamps;
    case 'mon':
      return L.shelf;
    case 'hearth':
      return L.hearth;
    case 'belt':
      return L.rack;
    case 'kage':
      return L.kage;
    case 'scroll':
    case 'station':
      return L.scroll;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Options and result                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/** What the shelf needs of an earned crest (`mon.ts MonSpec`, minus the motif). */
export type CrestSpec = Pick<MonSpec, 'ring' | 'field' | 'glyph' | 'accent'>;

export interface RoomOptions {
  belt: Belt;
  level: number;
  chosenKanji?: string;
  /** Badge categories with at least one earned Mon (0 – `slots`). */
  badgeCategories: number;
  /** One earned crest per category, in slot order (missing entries draw a plain seal). */
  crests?: readonly CrestSpec[];
  /** Station name (Japanese) of the latest goshuin; undefined = closed book. */
  latestStamp?: string;
  kageBeaten: boolean;
  /** The Kage sat here yesterday and left: drawn once more with the leaving class (design 09 §8 the week). */
  kageLeaving?: boolean;
  /** Local month 1–12. */
  month: number;
  /** The learner day: the moon in the window (`moonPhase`). */
  today: EpochDay;
  seed: number;
  w: number;
  h: number;
  /** Dan rank; gold ticks on a black belt. */
  dan?: number;
  /** Shelf slots (default `MON_SLOTS`). */
  slots?: number;
  /** Parts that changed since yesterday, drawn with a static 1 px gold ring (reduced motion). */
  rings?: readonly ScenePart[];
}

export interface RoomSvg {
  defs: string[];
  /** Paint order; the last layer is the time-of-day overlay. */
  layers: string[];
  overlayIndex: number;
  layout: RoomLayout;
  season: Season;
  ornament: OrnamentId | null;
}

export const ID = {
  sky: 'dj-sky',
  tatami: 'dj-tatami',
  lattice: 'dj-lattice',
  glow: 'dj-lantern-glow',
  /** The ONE shared since-yesterday glow def (design 09 §6.7 rule 2). */
  pulse: 'dj-pulse',
  clip: 'dj-window-clip',
  mon: 'dj-mon',
  goshuin: 'dj-goshuin',
} as const;

/** `dj-sky-<phase>`: the gradient the host writes as the sky rect's fill. */
export function skyId(phase: SkyPhase): string {
  return `${ID.sky}-${phase}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Parts                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function wallLayer(L: RoomLayout): string {
  const wainscot = 22 * L.sy;
  return g({ class: 'room__wall' }, [
    rect(0, L.eaves.h, L.w, L.floorTop - L.eaves.h, { fill: tok('surface') }),
    rect(0, L.floorTop - wainscot, L.w, wainscot, { fill: WOOD_LIGHT, opacity: 0.55 }),
    line(0, L.floorTop - wainscot, L.w, L.floorTop - wainscot, { stroke: WOOD, 'stroke-width': 2 * L.s }),
  ]);
}

function gardenTree(L: RoomLayout, season: Season, rng: () => number): string {
  const win = L.window;
  const baseX = win.x + win.w * (0.22 + rng() * 0.1);
  const baseY = win.y + win.h;
  const topY = win.y + win.h * (0.3 + rng() * 0.1);
  const lean = (rng() - 0.5) * win.w * 0.16;
  const topX = baseX + lean;
  const midX = baseX + lean * 0.3 + (rng() - 0.5) * win.w * 0.08;
  const midY = lerp(baseY, topY, 0.5);
  const parts: string[] = [];
  const trunkW = Math.max(2, win.w * 0.035);
  parts.push(path(M(baseX, baseY) + Q(midX, midY, topX, topY), { stroke: INK, 'stroke-width': trunkW, 'stroke-linecap': 'round', fill: 'none' }));
  const ends: Pt[] = [[topX, topY]];
  for (let i = 0; i < 3; i++) {
    const t = 0.45 + i * 0.18;
    const sx = lerp(baseX, topX, t);
    const sy = lerp(baseY, topY, t);
    const dir = i % 2 === 0 ? 1 : -1;
    const ex = sx + dir * win.w * (0.16 + rng() * 0.12);
    const ey = sy - win.h * (0.08 + rng() * 0.12);
    const cx = (sx + ex) / 2 + dir * win.w * 0.03;
    const cy = sy - win.h * 0.02;
    parts.push(path(M(sx, sy) + Q(cx, cy, ex, ey), { stroke: INK, 'stroke-width': trunkW * 0.5, 'stroke-linecap': 'round', fill: 'none' }));
    ends.push([ex, ey]);
  }
  const foliage = TREE_FOLIAGE[season];
  if (foliage) {
    for (const [ex, ey] of ends) {
      const rx = win.w * (0.09 + rng() * 0.05);
      parts.push(ellipse(ex, ey - rx * 0.2, rx, rx * 0.6, { fill: foliage, opacity: 0.92 }));
    }
    const [tx, ty] = ends[0]!;
    parts.push(ellipse(tx + win.w * 0.05, ty - win.h * 0.06, win.w * 0.13, win.h * 0.07, { fill: foliage, opacity: 0.85 }));
  } else {
    for (const [ex, ey] of ends) parts.push(ellipse(ex, ey - trunkW * 0.3, win.w * 0.045, trunkW * 0.45, { fill: WASHI, opacity: 0.95 }));
  }
  return g({ class: `room__tree room__tree--${season}` }, parts);
}

/**
 * The dark part of the moon's disc for `fraction` (0 new → .5 full → 1): the far
 * semicircle plus the terminator, an elliptical arc whose x-radius is r·|cos θ|.
 * Waxing light sits on the right (northern-hemisphere view), waning on the left.
 */
export function moonShadowPath(cx: number, cy: number, r: number, fraction: number): string {
  const f = ((fraction % 1) + 1) % 1;
  const t = Math.cos(2 * Math.PI * f);
  const rx = Math.max(0.01, Math.abs(t) * r);
  const waxing = f < 0.5;
  const top: Pt = [cx, cy - r];
  const bottom: Pt = [cx, cy + r];
  // the far semicircle: via the left when waxing (sweep 0), via the right when waning (sweep 1)
  const far = A(r, r, 0, 0, waxing ? 0 : 1, bottom[0], bottom[1]);
  // the terminator bulges toward the light on a crescent (t > 0) and away on a gibbous (t < 0)
  const sweep: 0 | 1 = waxing ? (t > 0 ? 0 : 1) : t > 0 ? 1 : 0;
  const back = A(rx, r, 0, 0, sweep, top[0], top[1]);
  return M(top[0], top[1]) + far + back + Z;
}

function skyLayer(L: RoomLayout, season: Season, today: EpochDay, rng: () => number): string {
  const win = L.window;
  const parts: string[] = [
    rect(win.x, win.y, win.w, win.h, { fill: url(skyId('day')), class: 'room__sky room__sky--a' }),
    rect(win.x, win.y, win.w, win.h, { fill: url(skyId('day')), opacity: 0, class: 'room__sky room__sky--b' }),
  ];
  const stars: string[] = [];
  for (let i = 0; i < 7; i++) {
    stars.push(circle(win.x + rng() * win.w, win.y + rng() * win.h * 0.6, (0.8 + rng() * 0.8) * L.s, { fill: WASHI, opacity: 0.6 + rng() * 0.35 }));
  }
  parts.push(g({ class: 'room__stars' }, stars));
  const moon = moonPhase(today);
  const mcx = win.x + win.w * 0.74;
  const mcy = win.y + win.h * 0.24;
  const mr = win.w * 0.06;
  parts.push(
    g({ class: 'room__moon', 'data-moon': moon.name }, [
      circle(mcx, mcy, mr, { fill: WASHI, opacity: 0.95 }),
      path(moonShadowPath(mcx, mcy, mr, moon.fraction), { fill: NIGHT, opacity: 0.9 }),
    ]),
  );
  parts.push(circle(win.x + win.w * 0.7, win.y + win.h * 0.74, win.w * 0.07, { fill: mix(WARM, '#F7B2C4', 0.4), opacity: 0.9, class: 'room__sun room__sun--dawn' }));
  parts.push(circle(win.x + win.w * 0.3, win.y + win.h * 0.7, win.w * 0.075, { fill: WARM, opacity: 0.95, class: 'room__sun room__sun--dusk' }));
  parts.push(ellipse(win.x + win.w * 0.62, win.y + win.h * 0.22, win.w * 0.14, win.h * 0.045, { fill: WASHI, opacity: 0.55, class: 'room__cloud' }));
  parts.push(gardenTree(L, season, rng));
  // garden clipped to the opening; then paper, kumiko lattice, frame
  const garden = g({ 'clip-path': url(ID.clip) }, parts);
  const screen = [
    rect(win.x, win.y, win.w, win.h, { fill: SHOJI, opacity: PAPER_OPACITY, class: 'room__paper' }),
    rect(win.x, win.y, win.w, win.h, { fill: url(ID.lattice) }),
    rect(win.x, win.y, win.w, win.h, { fill: 'none', stroke: INK, 'stroke-width': 5 * L.s }),
  ];
  return g({ class: 'room__window' }, [garden, ...screen]);
}

function scrollLayer(L: RoomLayout, kanji: string | undefined, seed: number): string {
  const sc = L.scroll;
  const cx = sc.x + sc.w / 2;
  const paper: Box = { x: sc.x + sc.w * 0.12, y: sc.y + sc.h * 0.12, w: sc.w * 0.76, h: sc.h * 0.72 };
  const parts: string[] = [
    line(cx, L.eaves.h, cx, sc.y, { stroke: INK, 'stroke-width': 1.5 * L.s }),
    rect(sc.x, sc.y + 6 * L.sy, sc.w, sc.h - 12 * L.sy, { fill: tok('kon'), class: 'room__mount' }),
    rect(paper.x, paper.y, paper.w, paper.h, { fill: tok('surface'), class: 'room__paper-scroll' }),
    rect(sc.x - 6 * L.sx, sc.y, sc.w + 12 * L.sx, 8 * L.sy, { fill: INK, rx: 4 * L.s }),
    rect(sc.x - 8 * L.sx, sc.y + sc.h - 10 * L.sy, sc.w + 16 * L.sx, 10 * L.sy, { fill: INK, rx: 5 * L.s }),
  ];
  const txt = (kanji ?? '').trim();
  if (txt) {
    const size = fitSize(txt, paper.w * 0.78, paper.h * 0.82, { vertical: true, min: 8 });
    const colH = size * (1 + (Array.from(txt).length - 1) * 1.12);
    parts.push(el('g', { class: 'room__kanji' }, tategaki({ text: txt, x: cx, y: paper.y + (paper.h - colH) / 2, size, font: FONTS.brush, fill: tok('fg') })));
  } else {
    const r = Math.min(paper.w, paper.h * 0.5) * 0.36;
    parts.push(path(enso(cx, paper.y + paper.h * 0.45, r, seed, { width: r * 0.26 }), { fill: INK, opacity: 0.85, class: 'room__enso' }));
  }
  const seal = Math.max(4, paper.w * 0.11);
  parts.push(rect(paper.x + paper.w - seal * 1.5, paper.y + paper.h - seal * 1.6, seal, seal, { fill: tok('shu'), rx: 1, class: 'room__seal' }));
  return g({ class: 'room__scroll', id: PART_ID.scroll, 'data-empty': txt ? undefined : 'true' }, parts);
}

function rackLayer(L: RoomLayout, belt: Belt, dan: number): string {
  const r = L.rack;
  const barY = r.y + r.h * 0.2;
  const beltW = Math.max(4, 12 * L.s);
  const x0 = r.x + r.w * 0.3;
  const x1 = r.x + r.w * 0.62;
  const yLow = r.y + r.h * 0.92;
  const d = M(x0, barY) + Q(x0 - r.w * 0.06, yLow, x0 + r.w * 0.12, yLow) + Q(x1 - r.w * 0.04, yLow - r.h * 0.05, x1, barY);
  const parts: string[] = [
    rect(r.x, barY - 3 * L.sy, r.w, 6 * L.sy, { fill: WOOD, rx: 2 }),
    rect(r.x + r.w * 0.08, barY, 6 * L.sx, r.h * 0.12, { fill: WOOD_LIGHT }),
    rect(r.x + r.w * 0.92 - 6 * L.sx, barY, 6 * L.sx, r.h * 0.12, { fill: WOOD_LIGHT }),
    path(d, { stroke: tok('line'), 'stroke-width': beltW + 2 * L.s, fill: 'none', 'stroke-linecap': 'round' }),
    path(d, { stroke: BELT_HEX[belt], 'stroke-width': beltW, fill: 'none', 'stroke-linecap': 'round', class: `room__belt room__belt--${belt}` }),
  ];
  if (belt === 'black' && dan > 0) {
    const ticks: string[] = [];
    const n = clamp(Math.floor(dan), 1, 10);
    for (let i = 0; i < n; i++) {
      const y = barY + r.h * 0.18 + i * beltW * 0.9;
      if (y > yLow - beltW) break;
      ticks.push(line(x0 - beltW * 0.45, y, x0 + beltW * 0.45, y, { stroke: tok('kin'), 'stroke-width': Math.max(1, 2 * L.s) }));
    }
    parts.push(g({ class: 'room__dan' }, ticks));
  }
  return g({ class: 'room__rack', id: PART_ID.belt }, parts);
}

/* ── crest symbols: the real spec (ring tier, field shape, glyph) in a 64-unit box, 2 nodes each ── */

const CREST_VIEW = 64;

function crestFieldPath(field: CrestSpec['field']): string {
  const c = CREST_VIEW / 2;
  const r = 26;
  switch (field) {
    case 'hexagon': {
      const pts: Pt[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push([c + r * Math.cos(a), c + r * Math.sin(a)]);
      }
      return pts.map((p, i) => (i === 0 ? M(p[0], p[1]) : `L${p[0].toFixed(2)} ${p[1].toFixed(2)}`)).join('') + Z;
    }
    case 'square': {
      const s = r * 0.92;
      return M(c - s, c - s) + `L${(c + s).toFixed(2)} ${(c - s).toFixed(2)}L${(c + s).toFixed(2)} ${(c + s).toFixed(2)}L${(c - s).toFixed(2)} ${(c + s).toFixed(2)}` + Z;
    }
    case 'petal': {
      // five lobes: a scalloped circle
      let d = '';
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a0 = (2 * Math.PI * i) / n - Math.PI / 2;
        const a1 = (2 * Math.PI * (i + 1)) / n - Math.PI / 2;
        const am = (a0 + a1) / 2;
        const p0: Pt = [c + r * 0.82 * Math.cos(a0), c + r * 0.82 * Math.sin(a0)];
        const pm: Pt = [c + r * 1.18 * Math.cos(am), c + r * 1.18 * Math.sin(am)];
        const p1: Pt = [c + r * 0.82 * Math.cos(a1), c + r * 0.82 * Math.sin(a1)];
        d += (i === 0 ? M(p0[0], p0[1]) : '') + Q(pm[0], pm[1], p1[0], p1[1]);
      }
      return d + Z;
    }
    case 'circle':
    case 'tomoe':
    default:
      return M(c - r, c) + A(r, r, 0, 1, 1, c + r, c) + A(r, r, 0, 1, 1, c - r, c) + Z;
  }
}

function ringPaint(ring: CrestSpec['ring']): string {
  return ring === 'gold' ? tok('kin') : ring === 'silver' ? RING_HEX.silver : RING_HEX.bronze;
}

/** `<symbol id="dj-mon-<i>">` — field (fill accent, stroke ring) + glyph in the system face (no webfont fetch). */
export function crestSymbol(i: number, spec: CrestSpec): string {
  const c = CREST_VIEW / 2;
  return symbol(
    `${ID.mon}-${i}`,
    [
      path(crestFieldPath(spec.field), { fill: spec.accent ?? tok('surface'), stroke: ringPaint(spec.ring), 'stroke-width': 5, class: `room__crest room__crest--${spec.ring}` }),
      text(spec.glyph, { x: c, y: c + 9, 'text-anchor': 'middle', 'font-family': FONTS.ja, 'font-size': 26, fill: WASHI, lang: 'ja', class: 'room__crest-glyph' }),
    ],
    { viewBox: `0 0 ${CREST_VIEW} ${CREST_VIEW}` },
  );
}

function shelfLayer(L: RoomLayout, earned: number, slots: number, crests: readonly CrestSpec[]): string {
  const sh = L.shelf;
  const n = Math.max(1, Math.round(slots));
  const got = clamp(Math.floor(earned), 0, n);
  const slotW = sh.w / n;
  const r = Math.min(slotW * 0.36, sh.h * 0.38);
  const cy = sh.y + sh.h * 0.42;
  const parts: string[] = [rect(sh.x, sh.y + sh.h * 0.78, sh.w, sh.h * 0.22, { fill: WOOD, rx: 1 })];
  for (let i = 0; i < n; i++) {
    const cx = sh.x + slotW * (i + 0.5);
    if (i < got) {
      if (crests[i]) {
        parts.push(use(`${ID.mon}-${i}`, { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, class: 'room__mon room__mon--earned' }));
      } else {
        parts.push(circle(cx, cy, r, { fill: tok('shu'), stroke: tok('kin'), 'stroke-width': Math.max(1, 2 * L.s), class: 'room__mon room__mon--earned' }));
      }
    } else {
      parts.push(circle(cx, cy, r, { fill: 'none', stroke: tok('line'), 'stroke-width': Math.max(1, 1.5 * L.s), 'stroke-dasharray': '3 3', class: 'room__mon room__mon--empty' }));
    }
  }
  return g({ class: 'room__shelf', id: PART_ID.mon, 'data-earned': got }, parts);
}

function lanternLayer(L: RoomLayout, level: number): string {
  const n = lanternCount(level);
  const e = L.eaves;
  const parts: string[] = [rect(0, 0, L.w, e.h, { fill: WOOD }), line(0, e.h - 3 * L.sy, L.w, e.h - 3 * L.sy, { stroke: WOOD_LIGHT, 'stroke-width': 2 * L.sy })];
  const lanterns: string[] = [];
  const rx = 14 * L.s;
  const ry = 20 * L.s;
  for (let i = 0; i < n; i++) {
    const x = (L.w * (i + 1)) / (n + 1);
    const top = e.h;
    const cy = top + 12 * L.sy + ry;
    const ribs = [0.5, 0, -0.5].map((k) => M(x - rx * 0.97, cy + ry * k) + Q(x, cy + ry * k + ry * 0.12, x + rx * 0.97, cy + ry * k)).join('');
    lanterns.push(
      g({ class: 'room__lantern' }, [
        line(x, top, x, top + 12 * L.sy, { stroke: INK, 'stroke-width': Math.max(1, 1.2 * L.s) }),
        ellipse(x, cy, rx, ry, { fill: tok('surface'), stroke: tok('shu'), 'stroke-width': Math.max(1, 1.5 * L.s), class: 'room__lantern-body' }),
        path(ribs, { stroke: tok('shu'), 'stroke-width': Math.max(0.6, 0.9 * L.s), fill: 'none', opacity: 0.8 }),
      ]),
    );
  }
  if (lanterns.length) parts.push(g({ class: 'room__lanterns', id: PART_ID.lantern, 'data-count': n }, lanterns));
  return g({ class: 'room__eaves' }, parts);
}

function ornamentLayer(L: RoomLayout, id: OrnamentId | null, rng: () => number): string {
  if (!id) return '';
  const o = L.ornament;
  const parts: string[] = [];
  if (id === 'tanabata') {
    // five tanzaku slips on threads from the eaves
    for (let i = 0; i < 5; i++) {
      const x = o.x + (o.w * (i + 0.5)) / 5;
      const len = o.h * (0.35 + rng() * 0.3);
      const w = o.w * 0.13;
      const rot = ((rng() - 0.5) * 12).toFixed(1);
      parts.push(rect(x - w / 2, o.y + len, w, o.h * 0.36, { fill: TANZAKU[i % TANZAKU.length]!, rx: 0.5, transform: `rotate(${rot} ${x.toFixed(1)} ${(o.y + len).toFixed(1)})` }));
    }
  } else if (id === 'koinobori') {
    // a pole and two carp streaming right
    const px = o.x + o.w * 0.15;
    parts.push(line(px, o.y, px, o.y + o.h, { stroke: WOOD_LIGHT, 'stroke-width': Math.max(1, 1.5 * L.s) }));
    for (let i = 0; i < 2; i++) {
      const y = o.y + o.h * (0.25 + i * 0.4);
      const len = o.w * (1.6 - i * 0.4);
      const hh = o.h * (0.13 - i * 0.03);
      const body = M(px, y - hh) + Q(px + len * 0.6, y - hh * 1.4, px + len, y - hh * 0.5) + `L${(px + len * 0.86).toFixed(1)} ${y.toFixed(1)}` + `L${(px + len).toFixed(1)} ${(y + hh * 0.5).toFixed(1)}` + Q(px + len * 0.6, y + hh * 1.4, px, y + hh) + Z;
      parts.push(path(body, { fill: i === 0 ? SUMI : tok('shu'), opacity: 0.9 }));
      parts.push(circle(px + len * 0.14, y - hh * 0.2, Math.max(0.8, hh * 0.22), { fill: WASHI }));
    }
  } else {
    // snow on the eaves rail
    for (let i = 0; i < 3; i++) {
      const x = L.w * (0.12 + i * 0.36) + (rng() - 0.5) * L.w * 0.04;
      parts.push(ellipse(x, L.eaves.h - 2 * L.sy, L.w * (0.03 + rng() * 0.02), 3 * L.sy, { fill: WASHI, opacity: 0.95 }));
    }
  }
  return g({ class: `room__ornament room__ornament--${id}`, 'data-ornament': id }, parts);
}

/** Trapezoid floor: `u` across (0 left, 1 right), `v` depth (0 back wall, 1 front edge). */
function floorPoint(L: RoomLayout, u: number, v: number): Pt {
  const left = lerp(L.w * 0.08, -L.w * 0.02, v);
  const right = lerp(L.w * 0.92, L.w * 1.02, v);
  return [lerp(left, right, u), lerp(L.floorTop, L.h, v)];
}

function floorLayer(L: RoomLayout, belt: Belt): string {
  const n = tatamiCount(belt);
  const rows = n <= 5 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  const parts: string[] = [polygon([floorPoint(L, 0, 0), floorPoint(L, 1, 0), floorPoint(L, 1, 1), floorPoint(L, 0, 1)], { fill: tok('line') })];
  const mats: string[] = [];
  rows.forEach((count, row) => {
    const v0 = rows.length === 1 ? 0 : row / rows.length;
    const v1 = rows.length === 1 ? 1 : (row + 1) / rows.length;
    for (let i = 0; i < count; i++) {
      const u0 = i / count;
      const u1 = (i + 1) / count;
      const inset = 0.004;
      mats.push(
        polygon([floorPoint(L, u0 + inset, v0 + inset), floorPoint(L, u1 - inset, v0 + inset), floorPoint(L, u1 - inset, v1 - inset), floorPoint(L, u0 + inset, v1 - inset)], {
          fill: url(ID.tatami),
          stroke: INK,
          'stroke-opacity': 0.55,
          'stroke-width': Math.max(1.5, 3 * L.s),
          class: 'room__tatami',
        }),
      );
    }
  });
  parts.push(g({ class: 'room__mats', 'data-count': n }, mats));
  return g({ class: 'room__floor' }, parts);
}

const GOSHUIN_VIEW = 64;

/** `<symbol id="dj-goshuin">`: the seal frame of `brush.ts sealFrame` (round or square by seed), one node. */
export function goshuinSymbol(seed: number): string {
  const round = mulberry32(seed ^ 0x6f5a1d)() < 0.45;
  return symbol(ID.goshuin, path(sealFrame({ x: 4, y: 4, size: GOSHUIN_VIEW - 8, round, seed, stroke: 4.5, erode: 0.012, samples: 48 }), { fill: tok('shu'), 'fill-rule': 'evenodd', class: 'room__goshuin-frame' }), {
    viewBox: `0 0 ${GOSHUIN_VIEW} ${GOSHUIN_VIEW}`,
  });
}

function stampLayer(L: RoomLayout, latest: string | undefined, seed: number): string {
  const b = L.stamps;
  const standTop = b.y + b.h * 0.55;
  const parts: string[] = [
    polygon([[b.x + b.w * 0.1, standTop], [b.x + b.w * 0.9, standTop], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], { fill: WOOD }),
    rect(b.x + b.w * 0.18, standTop - 4 * L.sy, b.w * 0.64, 4 * L.sy, { fill: WOOD_LIGHT }),
  ];
  const name = (latest ?? '').trim();
  const pageW = b.w * 0.36;
  const pageH = b.h * 0.56;
  const pageY = standTop - pageH;
  if (name) {
    const leftX = b.x + b.w * 0.12;
    const rightX = b.x + b.w * 0.52;
    parts.push(rect(leftX, pageY, pageW, pageH, { fill: tok('surface'), stroke: tok('line'), 'stroke-width': 1, transform: `rotate(-4 ${leftX + pageW} ${pageY + pageH})` }));
    parts.push(rect(rightX, pageY, pageW, pageH, { fill: tok('surface'), stroke: tok('line'), 'stroke-width': 1, transform: `rotate(3 ${rightX} ${pageY + pageH})` }));
    const sealW = pageW * 0.7;
    const sealH = pageH * 0.78;
    const side = Math.min(sealW, sealH);
    const sx = rightX + (pageW - side) / 2;
    const sy = pageY + (pageH - side) / 2;
    const rot = ((mulberry32(seed)() - 0.5) * 10).toFixed(1);
    const size = fitSize(name, side * 0.6, side * 0.72, { vertical: true, min: 4 });
    const colH = size * (1 + (Array.from(name).length - 1) * 1.12);
    parts.push(
      g({ class: 'room__goshuin', transform: `rotate(${rot} ${sx + side / 2} ${sy + side / 2})` }, [
        use(ID.goshuin, { x: sx, y: sy, width: side, height: side, opacity: 0.92 }),
        tategaki({ text: name, x: sx + side / 2, y: sy + (side - colH) / 2, size, font: FONTS.brush, fill: tok('shu') }),
      ]),
    );
  } else {
    const coverX = b.x + b.w * 0.3;
    parts.push(rect(coverX, pageY + pageH * 0.15, pageW * 1.1, pageH * 0.85, { fill: tok('shu'), rx: 1.5, class: 'room__book--closed' }));
    parts.push(line(coverX + pageW * 0.55, pageY + pageH * 0.15, coverX + pageW * 0.55, pageY + pageH, { stroke: WASHI, 'stroke-width': 1, opacity: 0.7 }));
  }
  return g({ class: 'room__stamps', id: PART_ID.stamp, 'data-empty': name ? undefined : 'true' }, parts);
}

function kageLayer(L: RoomLayout, leaving: boolean): string {
  const k = L.kage;
  const cx = k.x + k.w / 2;
  const headR = k.w * 0.16;
  const headY = k.y + k.h * 0.26;
  const body = M(k.x + k.w * 0.1, k.y + k.h) + Q(k.x + k.w * 0.08, k.y + k.h * 0.5, cx - headR * 0.6, headY + headR) + Q(cx, headY + headR * 0.6, cx + headR * 0.6, headY + headR) + Q(k.x + k.w * 0.95, k.y + k.h * 0.5, k.x + k.w * 0.92, k.y + k.h) + Z;
  // leaving: `.rm-fade` keeps the --dur-fade swap under reduced motion (base.css zeroes every other animation)
  return g({ class: `room__kage${leaving ? ' room__kage--leaving rm-fade' : ''}`, id: PART_ID.kage, 'data-leaving': leaving ? 'true' : undefined }, [path(body, { fill: SUMI, opacity: 0.82 }), circle(cx, headY, headR, { fill: SUMI, opacity: 0.86 })]);
}

function ringLayer(L: RoomLayout, rings: readonly ScenePart[]): string {
  if (rings.length === 0) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of rings) {
    const b = partBox(L, part);
    const key = `${b.x},${b.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, { fill: 'none', stroke: tok('kin'), 'stroke-width': 1, rx: 2, class: 'room__ring', 'data-ring': part, 'pointer-events': 'none' }));
  }
  return g({ class: 'room__rings' }, out);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Composition                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function roomSvg(o: RoomOptions): RoomSvg {
  const L = roomLayout(o.w, o.h);
  const season = seasonOf(o.month);
  const rng = mulberry32(hashSeed(o.seed, 'room', season));
  const crests = o.crests ?? [];
  const got = clamp(Math.floor(o.badgeCategories), 0, Math.max(1, Math.round(o.slots ?? MON_SLOTS)));

  const defs: string[] = [
    ...PHASES.map((p) =>
      linearGradient(skyId(p), [
        [0, SKY_STOPS[p][0]],
        [0.55, SKY_STOPS[p][1]],
        [1, SKY_STOPS[p][2]],
      ]),
    ),
    pattern(ID.tatami, 8 * L.s, 8 * L.s, [
      rect(0, 0, 8 * L.s, 8 * L.s, { fill: tok('raised') }),
      rect(0, 0, 8 * L.s, 8 * L.s, { fill: tok('matcha'), opacity: 0.12 }),
      line(0, 4 * L.s, 8 * L.s, 4 * L.s, { stroke: tok('line'), 'stroke-width': 0.8 * L.s, opacity: 0.7 }),
    ]),
    pattern(ID.lattice, L.window.w / 6, L.window.h / 5, [
      line(L.window.w / 6, 0, L.window.w / 6, L.window.h / 5, { stroke: INK, 'stroke-width': 2.4 * L.s }),
      line(0, L.window.h / 5, L.window.w / 6, L.window.h / 5, { stroke: INK, 'stroke-width': 2.4 * L.s }),
    ], { x: L.window.x, y: L.window.y }),
    glowTwin(ID.glow, 6 * L.s, { opacity: 0.7 }),
    glowTwin(ID.pulse, 8 * L.s, { opacity: 0.9 }),
    clipPath(ID.clip, rect(L.window.x, L.window.y, L.window.w, L.window.h)),
    ...crests.slice(0, got).map((c, i) => crestSymbol(i, c)),
    o.latestStamp ? goshuinSymbol(o.seed) : '',
  ];

  const ornament = ornamentFor(o.month);
  const layers: string[] = [
    wallLayer(L),
    skyLayer(L, season, o.today, rng),
    scrollLayer(L, o.chosenKanji, o.seed),
    rackLayer(L, o.belt, o.dan ?? 0),
    shelfLayer(L, o.badgeCategories, o.slots ?? MON_SLOTS, crests),
    lanternLayer(L, o.level),
    ornamentLayer(L, ornament, rng),
    floorLayer(L, o.belt),
    stampLayer(L, o.latestStamp, o.seed),
    o.kageBeaten || o.kageLeaving ? kageLayer(L, !o.kageBeaten && Boolean(o.kageLeaving)) : '',
    ringLayer(L, o.rings ?? []),
  ];
  layers.push(rect(0, 0, L.w, L.h, { fill: tok('kon'), opacity: 0, class: 'room__light', 'pointer-events': 'none' }));

  return { defs, layers, overlayIndex: layers.length - 1, layout: L, season, ornament };
}
