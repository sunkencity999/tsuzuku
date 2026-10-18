/**
 * TSUZUKU — Mon (紋) crest generator (design 06 §2).
 *
 * Every badge is a circular family-crest emblem rendered from a declarative
 * spec `{ring, field, glyph, accent, motif}`:
 *
 *  ring    Bronze single · Silver double · Gold double + 16 rays (tier)
 *  field   circle / hexagon / tomoe / square / petal, filled with the accent
 *  glyph   one kanji (or kana) in the brush face (Yuji Syuku stack)
 *  motif   a faint strand emblem inside the field: brush strokes (kana),
 *          flame (streak), sword cuts (training), torii gate (road), belt
 *          knot (belt), seigaiha waves (input), wind curls (output),
 *          component boxes (mastery), ensō (spirit)
 *
 * Symmetry order (ring dots, petal count, tomoe count, cut count) and the
 * small details (rotation, flat/pointy, ray phase) are drawn from the seed
 * (`monSeed(id) = hashString(id)`), so each of the 68 crests is a distinct,
 * stable emblem. Unearned crests render as embossed grey stone with no
 * accent at all. Output is a self-contained SVG string with a 256-unit
 * viewBox scaled to `size` px; `monParts` exposes the same art in 0–256
 * space for wallpapers (hanko-garden) and the Dojo shelf.
 *
 * Colours: hex from `./color` (never CSS vars) unless `cssVars` is set, in
 * which case theme tokens are written as inline `style="fill:var(--kin,
 * #…)"` so an inline crest follows the page theme while an `<img>`/PNG
 * render falls back to the hex.
 */
import { BELTS, type Belt } from '../content/types';
import { BADGE_IDS, type BadgeId, type BadgeTier } from '../shared/catalog';
import { hashString, mulberry32, type Rng } from '../shared/hash';
import { brushStroke, enso, PRESSURE } from './brush';
import { BELT_HEX, INK, PALETTE, STONE, TOKENS, WASHI, darken, lighten, normalizeHex, pickReadable, ringHex, type Theme, type Token } from './color';
import { polar, rays, regularPolygon, TAU, type Pt } from './geom';
import { FONTS, type TextLayer } from './jtext';
import { C, L, M, Q, Z, arcPath, circlePath, clipPath, defs, el, filter, fmt, g, path, points, polyPath, roundedRectPath, svgDataUrl, text, title, url, type Attrs } from './svg';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type MonRing = BadgeTier;
export type MonField = 'circle' | 'hexagon' | 'tomoe' | 'square' | 'petal';
export type MonMotif = 'brush' | 'flame' | 'cuts' | 'gate' | 'knot' | 'waves' | 'wind' | 'parts' | 'enso';
/** Dojo shelf categories (mirrors `store/badge-defs BadgeCategory`). */
export type MonCategory = 'kana' | 'streak' | 'training' | 'road' | 'belt' | 'input' | 'output' | 'mastery' | 'spirit';

export interface MonSpec {
  ring: MonRing;
  field: MonField;
  /** One glyph (code point). */
  glyph: string;
  /** Field colour, `#rrggbb`. Absent → a tint of the ring colour. */
  accent?: string;
  /** Inner strand emblem (default `enso`). */
  motif?: MonMotif;
}

export interface MonOptions {
  /** Rendered px (48–256 by design; clamped to 16–1024). */
  size: number;
  earned: boolean;
  seed: number;
  /** Theme the hex colours are resolved for (default light). */
  theme?: Theme;
  /** Emit theme tokens as `var(--token, hex)` inline styles (inline crests only). */
  cssVars?: boolean;
  /** `<title>` for a standalone SVG (`role="img"`); without it the SVG is `aria-hidden`. */
  label?: string;
  /** Prefix for the ids inside `<defs>` (default derived from the seed). */
  idPrefix?: string;
  /** Draw the glyph as `<text>` (default true); false leaves it to `glyphLayer` for a host that sets it in the page's own fonts. */
  glyphInSvg?: boolean;
}

export interface MonParts {
  defs: string[];
  body: string[];
  /** The glyph as a canvas-ready layer in 0–256 space (hex fill). */
  glyphLayer: TextLayer;
  /** Side of the square the parts are drawn in. */
  view: number;
}

export const MON_VIEW = 256;
export const MON_MIN_SIZE = 16;
export const MON_MAX_SIZE = 1024;
export const MON_RINGS: readonly MonRing[] = ['bronze', 'silver', 'gold'];
export const MON_FIELDS: readonly MonField[] = ['circle', 'hexagon', 'tomoe', 'square', 'petal'];
export const MON_MOTIFS: readonly MonMotif[] = ['brush', 'flame', 'cuts', 'gate', 'knot', 'waves', 'wind', 'parts', 'enso'];
export const MON_CATEGORIES: readonly MonCategory[] = ['kana', 'streak', 'training', 'road', 'belt', 'input', 'output', 'mastery', 'spirit'];
/** Gold crests carry sixteen rays (design 06 §2). */
export const GOLD_RAYS = 16;

const CX = 128;
const CY = 128;
const R_OUT = 120;
const R_FIELD = 92;
/** Symmetry orders a seed may pick. */
const ORDERS: readonly number[] = [3, 4, 5, 6, 8, 12];
const MOTIF_OPACITY = 0.22;
const MOTIF_OPACITY_LOCKED = 0.14;

/* ────────────────────────────────────────────────────────────────────────── */
/* Catalog: category → motif/accent, the 66 specs                             */
/* ────────────────────────────────────────────────────────────────────────── */

export const CATEGORY_MOTIF: Record<MonCategory, MonMotif> = {
  kana: 'brush',
  streak: 'flame',
  training: 'cuts',
  road: 'gate',
  belt: 'knot',
  input: 'waves',
  output: 'wind',
  mastery: 'parts',
  spirit: 'enso',
};

const CATEGORY_TOKEN: Record<Exclude<MonCategory, 'belt'>, Token> = {
  kana: 'sakura',
  streak: 'shu',
  training: 'neon-c',
  road: 'kon',
  input: 'ai',
  output: 'neon-m',
  mastery: 'kin',
  spirit: 'matcha',
};

/** The accent hex of a category (belt crests take the belt colour). */
export function accentFor(category: MonCategory, belt?: Belt): string {
  if (category === 'belt') return normalizeHex(BELT_HEX[belt ?? 'black']);
  return normalizeHex(PALETTE.light[CATEGORY_TOKEN[category]]);
}

type Row = readonly [id: BadgeId, glyph: string, field: MonField, ring: MonRing, category: MonCategory];

/** Design 06 §2 table (glyph · field · tier) with the Dojo shelf category of `store/badge-defs`. */
const ROWS: readonly Row[] = [
  ['first-step', '歩', 'circle', 'bronze', 'training'],
  ['gojuon', 'あ', 'petal', 'silver', 'kana'],
  ['katakana', 'カ', 'petal', 'silver', 'kana'],
  ['voiced', '゛', 'circle', 'bronze', 'kana'],
  ['rain-candy', '雨', 'hexagon', 'silver', 'kana'],
  ['gojuon-perfect', '星', 'tomoe', 'gold', 'kana'],
  ['three-day', '四', 'circle', 'bronze', 'streak'],
  ['seven', '七', 'circle', 'bronze', 'streak'],
  ['thirty', '月', 'circle', 'silver', 'streak'],
  ['hundred', '修', 'tomoe', 'gold', 'streak'],
  ['year', '年', 'tomoe', 'gold', 'streak'],
  ['rise-eight', '起', 'hexagon', 'silver', 'streak'],
  ['ember', '火', 'circle', 'bronze', 'streak'],
  ['samurai-rest', '休', 'circle', 'bronze', 'streak'],
  ['five-hundred-days', '日', 'tomoe', 'gold', 'streak'],
  ['thousand-cuts', '千', 'square', 'bronze', 'training'],
  ['ten-thousand', '万', 'square', 'silver', 'training'],
  ['hundred-thousand', '十', 'square', 'gold', 'training'],
  ['ten-chain', '連', 'hexagon', 'bronze', 'training'],
  ['fifty-chain', '連', 'hexagon', 'silver', 'training'],
  ['hundred-chain', '連', 'tomoe', 'gold', 'training'],
  ['unscathed', '無', 'circle', 'bronze', 'training'],
  ['ippon', '一', 'square', 'bronze', 'training'],
  ['hundred-ippon', '本', 'square', 'silver', 'training'],
  ['gatekeepers-respect', '関', 'hexagon', 'bronze', 'road'],
  ['perfect-gate', '門', 'hexagon', 'silver', 'road'],
  ['revenge', '雪', 'hexagon', 'silver', 'road'],
  ['halfway', '道', 'tomoe', 'silver', 'road'],
  ['kyoto', '京', 'tomoe', 'gold', 'road'],
  ['belt-yellow', '帯', 'square', 'bronze', 'belt'],
  ['belt-orange', '帯', 'square', 'bronze', 'belt'],
  ['belt-green', '帯', 'square', 'silver', 'belt'],
  ['belt-blue', '帯', 'square', 'silver', 'belt'],
  ['belt-purple', '帯', 'square', 'silver', 'belt'],
  ['belt-brown', '帯', 'square', 'gold', 'belt'],
  ['belt-black', '帯', 'square', 'gold', 'belt'],
  ['bookworm', '本', 'petal', 'silver', 'input'],
  ['dictionary-free', '辞', 'petal', 'silver', 'input'],
  ['speed-reader', '速', 'petal', 'silver', 'input'],
  ['golden-ear', '耳', 'circle', 'silver', 'input'],
  ['fast-ear', '倍', 'circle', 'gold', 'input'],
  // design 08 §11
  ['teahouse-regular', '常', 'circle', 'bronze', 'input'],
  ['first-hearing', '初', 'circle', 'silver', 'input'],
  ['voice', '声', 'circle', 'bronze', 'output'],
  ['shadow-warrior', '影', 'hexagon', 'gold', 'output'],
  ['aizuchi', '槌', 'hexagon', 'silver', 'output'],
  ['three-forms', '変', 'hexagon', 'silver', 'output'],
  ['one-minute-monologue', '独', 'hexagon', 'silver', 'output'],
  ['hundred-kanji', '字', 'square', 'silver', 'mastery'],
  ['thousand-kanji', '字', 'square', 'gold', 'mastery'],
  ['thousand-words', '語', 'square', 'silver', 'mastery'],
  ['five-thousand', '語', 'square', 'gold', 'mastery'],
  ['grammarian', '型', 'square', 'silver', 'mastery'],
  ['form-chain-20', '活', 'square', 'bronze', 'mastery'],
  ['particle-sage', '助', 'square', 'silver', 'mastery'],
  ['honest', '正', 'circle', 'gold', 'mastery'],
  ['weak-conquered', '克', 'hexagon', 'silver', 'mastery'],
  ['nemesis-slayer', '討', 'hexagon', 'silver', 'mastery'],
  ['shadow-breaker', '越', 'tomoe', 'gold', 'mastery'],
  ['beyond-the-wall', '壁', 'tomoe', 'gold', 'mastery'],
  ['hundred-hours', '聴', 'circle', 'silver', 'spirit'],
  ['thousand-hours', '時', 'tomoe', 'gold', 'spirit'],
  ['field', '現', 'circle', 'bronze', 'spirit'],
  ['first-convo', '話', 'circle', 'silver', 'spirit'],
  ['comeback', '復', 'circle', 'bronze', 'spirit'],
  ['zen', '禅', 'circle', 'silver', 'spirit'],
  ['backup', '備', 'circle', 'bronze', 'spirit'],
  ['tsuzuku', '続', 'tomoe', 'gold', 'spirit'],
];

function beltOfBadge(id: BadgeId): Belt | undefined {
  if (!id.startsWith('belt-')) return undefined;
  const b = id.slice(5);
  return BELTS.some((d) => d.id === b) ? (b as Belt) : undefined;
}

/** Shelf category of every badge (the Dojo's Mon shelf has one slot per category). */
export const MON_CATEGORY: Record<BadgeId, MonCategory> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]])) as Record<BadgeId, MonCategory>;

/** The 68 crest specs, keyed by badge id (covers `BADGE_IDS` exactly; mon.test.ts checks). */
export const MON_SPECS: Record<BadgeId, MonSpec> = Object.fromEntries(
  ROWS.map(([id, glyph, field, ring, category]) => [
    id,
    { ring, field, glyph, accent: accentFor(category, beltOfBadge(id)), motif: CATEGORY_MOTIF[category] } satisfies MonSpec,
  ]),
) as Record<BadgeId, MonSpec>;

export function monSpec(id: BadgeId): MonSpec {
  return MON_SPECS[id];
}

/** The crest seed: a fixed emblem per badge, not per learner. */
export function monSeed(id: BadgeId): number {
  return hashString(id);
}

/** Sanity flag for the catalog test. */
export const MON_SPECS_COMPLETE: boolean = ROWS.length === BADGE_IDS.length && BADGE_IDS.every((id) => id in MON_SPECS);

/* ────────────────────────────────────────────────────────────────────────── */
/* Paint: hex or var(--token, hex)                                            */
/* ────────────────────────────────────────────────────────────────────────── */

interface Paint {
  /** Resolved hex for the theme (what the canvas pass or a snapshot sees). */
  hex: string;
  /** What is written into the markup: the hex, or `var(--x, hex)`. */
  css: string;
}

interface TokenRef {
  name: string;
  dark?: string;
}

/** Reverse lookup: a light-theme token hex → its CSS variable (palette tokens first, then belts). */
function tokenOf(hex: string): TokenRef | undefined {
  const h = normalizeHex(hex);
  for (const t of TOKENS) if (normalizeHex(PALETTE.light[t]) === h) return { name: `--${t}`, dark: PALETTE.dark[t] };
  for (const b of BELTS) if (normalizeHex(b.color) === h) return { name: `--belt-${b.id}` };
  return undefined;
}

function paintOf(hex: string, o: { cssVars?: boolean; theme?: Theme }): Paint {
  const tok = tokenOf(hex);
  const resolved = normalizeHex(tok?.dark && o.theme === 'dark' ? tok.dark : hex);
  return { hex: resolved, css: o.cssVars && tok ? `var(${tok.name}, ${resolved})` : resolved };
}

function plain(hex: string): Paint {
  const h = normalizeHex(hex);
  return { hex: h, css: h };
}

/** `fill`/`stroke` attributes; `var()` paints go through `style` (presentation attributes do not accept var()). */
function paintAttrs(o: { fill?: Paint | 'none'; stroke?: Paint }): Attrs {
  const a: Attrs = {};
  const styles: string[] = [];
  if (o.fill === 'none') a.fill = 'none';
  else if (o.fill) {
    if (o.fill.css.startsWith('var(')) styles.push(`fill:${o.fill.css}`);
    else a.fill = o.fill.css;
  }
  if (o.stroke) {
    if (o.stroke.css.startsWith('var(')) styles.push(`stroke:${o.stroke.css}`);
    else a.stroke = o.stroke.css;
  }
  if (styles.length > 0) a.style = styles.join(';');
  return a;
}

interface Inks {
  ring: Paint;
  field: Paint;
  glyph: Paint;
  motif: Paint;
  /** Overlay colour (tomoe swirls, ring dots): washi, or light stone when locked. */
  over: Paint;
  hi: Paint;
  lo: Paint;
}

const STONE_RING = darken(STONE, 0.3);
const STONE_LIGHT = lighten(STONE, 0.42);

function inksFor(spec: MonSpec, o: MonOptions): Inks {
  if (!o.earned) {
    return {
      ring: plain(STONE_RING),
      field: plain(STONE),
      glyph: plain(STONE_LIGHT),
      motif: plain(STONE_LIGHT),
      over: plain(STONE_LIGHT),
      hi: plain('#ffffff'),
      lo: plain(INK),
    };
  }
  const ringLight = ringHex(spec.ring, 'light');
  const ring = paintOf(ringLight, o);
  const field = paintOf(spec.accent ?? lighten(ringLight, 0.55), o);
  const glyph = plain(pickReadable(field.hex, [WASHI, INK]));
  return { ring, field, glyph, motif: glyph, over: plain(WASHI), hi: plain('#ffffff'), lo: plain(INK) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rings                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function annulus(rOuter: number, rInner: number, inks: Inks, extra?: Attrs): string {
  return path(circlePath(CX, CY, rOuter) + circlePath(CX, CY, rInner), { class: 'mon__ring', 'fill-rule': 'evenodd', ...paintAttrs({ fill: inks.ring }), ...extra });
}

/** Metallic feel without gradients: a light arc upper-left, a shade arc lower-right. */
function sheen(r: number, width: number, inks: Inks): string {
  const d2r = Math.PI / 180;
  return (
    path(arcPath(CX, CY, r, -150 * d2r, -30 * d2r), { fill: 'none', 'stroke-width': width, 'stroke-linecap': 'round', opacity: 0.35, ...paintAttrs({ stroke: inks.hi }) }) +
    path(arcPath(CX, CY, r, 30 * d2r, 150 * d2r), { fill: 'none', 'stroke-width': width, 'stroke-linecap': 'round', opacity: 0.22, ...paintAttrs({ stroke: inks.lo }) })
  );
}

function ringDots(r: number, order: number, phase: boolean, inks: Inks): string {
  if (order > 12) return '';
  let d = '';
  for (let i = 0; i < order; i++) {
    const a = -Math.PI / 2 + (i + (phase ? 0.5 : 0)) * (TAU / order);
    const [x, y] = polar(CX, CY, r, a);
    d += circlePath(x, y, 2.4);
  }
  return path(d, { class: 'mon__dots', opacity: 0.9, ...paintAttrs({ fill: inks.over }) });
}

/** A hairline at the outer rim so a pale ring (silver on washi) keeps its edge. */
function rim(inks: Inks): string {
  return path(circlePath(CX, CY, R_OUT), { class: 'mon__rim', fill: 'none', 'stroke-width': 1, opacity: 0.22, ...paintAttrs({ stroke: inks.lo }) });
}

function ringMarkup(ring: MonRing, inks: Inks, order: number, dotPhase: boolean, rayShift: boolean): string {
  switch (ring) {
    case 'bronze':
      return annulus(R_OUT, 111, inks) + sheen(115.5, 2, inks) + ringDots(115.5, order, dotPhase, inks) + rim(inks);
    case 'silver':
      return annulus(R_OUT, 114, inks) + annulus(106.5, 103, inks) + sheen(117, 1.6, inks) + ringDots(110.2, order, dotPhase, inks) + rim(inks);
    case 'gold': {
      const raysD = rays(CX, CY, 104, 115, GOLD_RAYS, -Math.PI / 2 + (rayShift ? Math.PI / GOLD_RAYS : 0));
      return (
        annulus(R_OUT, 115, inks) +
        path(raysD, { class: 'mon__rays', 'data-rays': GOLD_RAYS, ...paintAttrs({ fill: inks.ring }) }) +
        annulus(104, 100, inks) +
        sheen(117.5, 1.6, inks) +
        rim(inks)
      );
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fields                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function petalCount(order: number): number {
  return order <= 4 ? 5 : order > 8 ? 8 : order;
}
function tomoeCount(order: number): number {
  return order === 4 ? 4 : order === 8 ? 2 : 3;
}

function petalPath(n: number): string {
  const h = Math.PI / n;
  let d = circlePath(CX, CY, 34);
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + k * (TAU / n);
    const [bx0, by0] = polar(CX, CY, 30, a - h);
    const [bx1, by1] = polar(CX, CY, 30, a + h);
    const [c0x, c0y] = polar(CX, CY, 88, a - h * 1.05);
    const [c1x, c1y] = polar(CX, CY, 88, a + h * 1.05);
    const [tx, ty] = polar(CX, CY, R_FIELD, a);
    d += M(bx0, by0) + Q(c0x, c0y, tx, ty) + Q(c1x, c1y, bx1, by1) + Z;
  }
  return d;
}

function fieldPath(field: MonField, flat: boolean, order: number): string {
  switch (field) {
    case 'circle':
    case 'tomoe':
      return circlePath(CX, CY, R_FIELD);
    case 'hexagon':
      return polyPath(regularPolygon(CX, CY, R_FIELD, 6, flat ? -Math.PI / 3 : -Math.PI / 2), true);
    case 'square':
      return flat ? roundedRectPath(CX - 80, CY - 80, 160, 160, 12) : polyPath(regularPolygon(CX, CY, R_FIELD, 4, -Math.PI / 2), true);
    case 'petal':
      return petalPath(petalCount(order));
  }
}

/** One tomoe (comma): a head disc near the centre and a tail sweeping clockwise along the rim. */
function tomoe(a: number): string {
  // head: disc of radius 20 at distance 58 (angular half-width ≈ 0.35 rad)
  const [hx, hy] = polar(CX, CY, 58, a);
  let d = circlePath(hx, hy, 20);
  // tail: leaves the head as wide as the head itself (radii 42–78), then both
  // edges drift to the rim and meet at the flicked tip
  const steps = 18;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = a + 0.3 + t * 1.65;
    outer.push(polar(CX, CY, 78 + 10 * Math.sqrt(t), th));
    inner.push(polar(CX, CY, 42 + 45 * t ** 0.75, th));
  }
  d += polyPath([...outer, ...inner.reverse()], true);
  return d;
}

function tomoeOverlay(order: number, inks: Inks, rot: number): string {
  const n = tomoeCount(order);
  let d = '';
  for (let k = 0; k < n; k++) d += tomoe(rot + k * (TAU / n));
  return path(d, { class: 'mon__tomoe', opacity: 0.92, ...paintAttrs({ fill: inks.over }) });
}

function glyphSize(field: MonField, flat: boolean, glyph: string): number {
  let s: number;
  switch (field) {
    case 'circle':
      s = 110;
      break;
    case 'hexagon':
      s = 104;
      break;
    case 'square':
      s = flat ? 104 : 90;
      break;
    case 'petal':
      s = 92;
      break;
    case 'tomoe':
      // the void inside the tomoe heads is r ≈ 38; a CJK ink box is ≈ 0.9 em,
      // so 68 keeps the glyph clear of the swirls yet legible at the 64–72 px grid
      s = 68;
      break;
  }
  // combining-style marks (゛) draw small and off-centre at natural size
  if (glyph === '゛' || glyph === '゜') s *= 1.3;
  return s;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Motifs                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function seedOf(rng: Rng): number {
  return Math.floor(rng() * 0xffffffff) >>> 0;
}

function motifBrush(rng: Rng, ink: Paint): string {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const a = -0.95 + i * 0.32 + (rng() - 0.5) * 0.2;
    const len = 150 + rng() * 30;
    const off = (i - 1) * 34;
    const c: Pt = [CX + Math.cos(a + Math.PI / 2) * off, CY + Math.sin(a + Math.PI / 2) * off];
    const p0 = polar(c[0], c[1], len / 2, a + Math.PI);
    const p1 = polar(c[0], c[1], len / 2, a);
    const bend = (rng() - 0.5) * 44;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const spine: Pt[] = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const b = Math.sin(t * Math.PI) * bend;
      spine.push([p0[0] + (p1[0] - p0[0]) * t + nx * b, p0[1] + (p1[1] - p0[1]) * t + ny * b]);
    }
    out.push(path(brushStroke(spine, { width: 16 + rng() * 8, pressure: PRESSURE.taper, seed: seedOf(rng), bristle: 0.25 }), paintAttrs({ fill: ink })));
  }
  return out.join('');
}

function motifFlame(rng: Rng, ink: Paint): string {
  const s = 1 + (rng() - 0.5) * 0.16;
  const d = M(128, 192) + C(86, 166, 78, 118, 110, 78) + C(104, 110, 122, 118, 128, 126) + C(138, 108, 134, 92, 126, 64) + C(168, 98, 178, 154, 128, 192) + Z;
  return path(d, { transform: `translate(128 128) scale(${fmt(s)}) translate(-128 -128)`, ...paintAttrs({ fill: ink }) });
}

function motifCuts(rng: Rng, ink: Paint, order: number): string {
  const n = Math.min(8, Math.max(3, order));
  const phase = rng() * TAU;
  const curl = rng() < 0.5 ? 0.25 : -0.25;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + i * (TAU / n);
    const spine: Pt[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      spine.push(polar(CX, CY, 24 + t * 64, a + t * t * curl));
    }
    out.push(path(brushStroke(spine, { width: 12, pressure: PRESSURE.taper, seed: seedOf(rng), bristle: 0.2 }), paintAttrs({ fill: ink })));
  }
  return out.join('');
}

function motifGate(ink: Paint): string {
  const d =
    M(54, 86) + Q(128, 70, 202, 86) + L(198, 98) + Q(128, 84, 58, 98) + Z +
    roundedRectPath(70, 100, 116, 8, 2) +
    roundedRectPath(74, 126, 108, 8, 2) +
    roundedRectPath(120, 108, 16, 18, 2) +
    polyPath([[86, 100], [98, 100], [102, 198], [88, 198]], true) +
    polyPath([[158, 100], [170, 100], [168, 198], [154, 198]], true);
  return path(d, paintAttrs({ fill: ink }));
}

function motifKnot(ink: Paint): string {
  return g(paintAttrs({ fill: ink }), [
    path(roundedRectPath(36, 118, 184, 26, 3)),
    el('ellipse', { cx: 106, cy: 131, rx: 22, ry: 14 }),
    el('ellipse', { cx: 150, cy: 131, rx: 22, ry: 14 }),
    path(roundedRectPath(118, 119, 20, 24, 3)),
    path(polyPath([[112, 142], [90, 196], [106, 198], [126, 146]], true)),
    path(polyPath([[144, 142], [166, 196], [150, 198], [130, 146]], true)),
  ]);
}

function motifWaves(ink: Paint): string {
  const radii = [26, 19, 12, 5];
  const parts: string[] = [];
  for (let row = 0; row < 6; row++) {
    const y = 48 + row * 26;
    const shift = row % 2 === 1 ? 26 : 0;
    for (let col = -1; col < 6; col++) {
      const x = 36 + col * 52 + shift;
      for (const r of radii) parts.push(path(arcPath(x, y, r, Math.PI, TAU)));
    }
  }
  return g({ fill: 'none', 'stroke-width': 3.2, 'stroke-linecap': 'round', ...paintAttrs({ stroke: ink }) }, parts);
}

function motifWind(rng: Rng, ink: Paint): string {
  const centres: Pt[] = [
    [100 + (rng() - 0.5) * 10, 112 + (rng() - 0.5) * 10],
    [164 + (rng() - 0.5) * 10, 152 + (rng() - 0.5) * 10],
  ];
  const curls = centres.map(([cx, cy]) => {
    const pts: Pt[] = [];
    const turns = 2.2 + rng() * 0.6;
    const dir = rng() < 0.5 ? 1 : -1;
    for (let k = 0; k <= 56; k++) {
      const t = k / 56;
      pts.push(polar(cx, cy, 2 + t * t * 30, dir * t * turns * TAU));
    }
    const last = pts[pts.length - 1]!;
    for (let k = 1; k <= 10; k++) pts.push([last[0] + dir * k * 7, last[1] - k * k * 0.4]);
    return el('polyline', { points: points(pts), fill: 'none', 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  });
  return g(paintAttrs({ stroke: ink }), curls);
}

function motifParts(ink: Paint, order: number): string {
  const rot = order === 4 || order === 8 ? 45 : 0;
  return g({ fill: 'none', 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...paintAttrs({ stroke: ink }) }, [
    path(roundedRectPath(66, 66, 124, 124, 8)),
    path(roundedRectPath(88, 88, 80, 80, 6), { transform: rot ? `rotate(${rot} 128 128)` : undefined }),
    path(M(66, 128) + L(52, 128) + M(190, 128) + L(204, 128) + M(128, 66) + L(128, 52) + M(128, 190) + L(128, 204)),
  ]);
}

function motifEnso(seed: number, ink: Paint): string {
  return path(enso(CX, CY, 70, seed ^ 0x9e3779b9, { width: 16, gap: 0.6 }), paintAttrs({ fill: ink }));
}

function motifMarkup(motif: MonMotif, rng: Rng, inks: Inks, order: number, seed: number): string {
  switch (motif) {
    case 'brush':
      return motifBrush(rng, inks.motif);
    case 'flame':
      return motifFlame(rng, inks.motif);
    case 'cuts':
      return motifCuts(rng, inks.motif, order);
    case 'gate':
      return motifGate(inks.motif);
    case 'knot':
      return motifKnot(inks.motif);
    case 'waves':
      return motifWaves(inks.motif);
    case 'wind':
      return motifWind(rng, inks.motif);
    case 'parts':
      return motifParts(inks.motif, order);
    case 'enso':
      return motifEnso(seed, inks.motif);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Stone (locked) emboss                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function embossFilter(id: string): string {
  return filter(id, [
    el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 1.4, result: 'b' }),
    el(
      'feSpecularLighting',
      { in: 'b', surfaceScale: 3, specularConstant: 0.5, specularExponent: 16, 'lighting-color': '#ffffff', result: 'spec' },
      el('feDistantLight', { azimuth: 315, elevation: 42 }),
    ),
    el('feComposite', { in: 'spec', in2: 'SourceAlpha', operator: 'in', result: 'specIn' }),
    el('feComposite', { in: 'SourceGraphic', in2: 'specIn', operator: 'arithmetic', k1: 0, k2: 1, k3: 0.7, k4: 0 }),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Assembly                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function clampMonSize(size: number): number {
  if (!Number.isFinite(size)) return 96;
  return Math.round(Math.min(MON_MAX_SIZE, Math.max(MON_MIN_SIZE, size)));
}

/** The crest in 0–256 space: defs, body layers and the glyph as a `TextLayer`. Pure for (spec, options). */
export function monParts(spec: MonSpec, o: MonOptions): MonParts {
  const seed = (o.seed ?? 0) >>> 0;
  const rng = mulberry32(seed);
  const order = ORDERS[Math.floor(rng() * ORDERS.length)]!;
  const flat = rng() < 0.5;
  const tilt = (rng() - 0.5) * 8;
  const rayShift = rng() < 0.5;
  const dotPhase = rng() < 0.5;
  const prefix = o.idPrefix ?? `mon-${seed.toString(36)}${o.earned ? '' : '-l'}`;
  const inks = inksFor(spec, o);
  const motif = spec.motif ?? 'enso';
  const field = fieldPath(spec.field, flat, order);
  const clipId = `${prefix}-clip`;
  const embossId = `${prefix}-emboss`;

  const defsOut: string[] = [clipPath(clipId, path(field))];
  if (!o.earned) defsOut.push(embossFilter(embossId));

  const layers: string[] = [];
  layers.push(g({ class: 'mon__ring-group' }, ringMarkup(spec.ring, inks, order, dotPhase, rayShift)));
  layers.push(path(field, { class: `mon__field mon__field--${spec.field}`, ...paintAttrs({ fill: inks.field }) }));
  if (spec.field === 'tomoe') {
    layers.push(tomoeOverlay(order, inks, (tilt * Math.PI) / 180 - Math.PI / 2));
  } else {
    layers.push(
      g(
        {
          class: `mon__motif mon__motif--${motif}`,
          'clip-path': url(clipId),
          opacity: o.earned ? MOTIF_OPACITY : MOTIF_OPACITY_LOCKED,
          transform: `rotate(${fmt(tilt)} 128 128)`,
        },
        motifMarkup(motif, rng, inks, order, seed),
      ),
    );
  }
  // a thin edge line keeps the field crisp against the gap
  layers.push(path(field, { class: 'mon__edge', fill: 'none', 'stroke-width': 1.5, opacity: 0.5, ...paintAttrs({ stroke: inks.ring }) }));

  const size = glyphSize(spec.field, flat, spec.glyph);
  // CJK glyphs centre ≈ 0.36 em above the baseline; the standalone dakuten sits
  // in the top of its box, so it is dropped to the field's centre
  const mark = spec.glyph === '゛' || spec.glyph === '゜';
  const baseline = CY + size * (mark ? 0.62 : 0.36);
  const glyphLayer: TextLayer = { text: spec.glyph, x: CX, y: baseline, size, font: FONTS.brush, fill: inks.glyph.hex, anchor: 'middle', lang: 'ja' };
  if (o.glyphInSvg ?? true) {
    layers.push(
      text(spec.glyph, {
        class: 'mon__glyph',
        x: CX,
        y: baseline,
        'text-anchor': 'middle',
        'font-family': FONTS.brush,
        'font-size': size,
        lang: 'ja',
        ...paintAttrs({ fill: inks.glyph }),
      }),
    );
  }

  const body = [g({ class: `mon__art mon__art--${o.earned ? 'earned' : 'locked'}`, filter: o.earned ? undefined : url(embossId) }, layers)];
  return { defs: defsOut, body, glyphLayer, view: MON_VIEW };
}

/** The `<svg>` wrapper around `parts` for (spec, o): `viewBox 0 0 256 256`, `width`/`height` = size px. */
function wrapMon(spec: MonSpec, o: MonOptions, parts: MonParts): string {
  const size = clampMonSize(o.size);
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      viewBox: `0 0 ${MON_VIEW} ${MON_VIEW}`,
      class: `mon-svg mon-svg--${spec.ring} mon-svg--${spec.field} mon-svg--${o.earned ? 'earned' : 'locked'}`,
      role: o.label ? 'img' : undefined,
      'aria-hidden': o.label ? undefined : 'true',
      focusable: 'false',
    },
    [o.label ? title(o.label) : '', defs(parts.defs), ...parts.body],
  );
}

/** A complete, self-contained crest SVG (`viewBox 0 0 256 256`, `width`/`height` = size px). */
export function monSvg(spec: MonSpec, o: MonOptions): string {
  return wrapMon(spec, o, monParts(spec, o));
}

/** Convenience: the crest of a badge id (spec and seed from the catalog). */
export function badgeMonSvg(id: BadgeId, o: Omit<MonOptions, 'seed'> & { seed?: number }): string {
  return monSvg(MON_SPECS[id], { ...o, seed: o.seed ?? monSeed(id) });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Stone as an image (design 09 §7 E, §6.7 rule 2)                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A locked crest as an `<img>`-ready data URL. The emboss filter is rasterised
 * once by the image decoder, so a grid of sixty stone crests holds no live SVG
 * filter (§6.7 rule 2); inline `monSvg` stays for the earned crests, whose
 * paints follow the theme through `cssVars`. Stone never depends on the theme,
 * so one URL per (spec, seed, size) serves both. Same markup as
 * `monSvg(spec, { earned: false, … })`, so the snapshot tests stand.
 */
export function monStoneDataUrl(spec: MonSpec, o: { size: number; seed: number; idPrefix?: string }): string {
  return svgDataUrl(monSvg(spec, { size: o.size, earned: false, seed: o.seed, idPrefix: o.idPrefix }));
}

export interface MonStoneImage {
  /** The stone art without its glyph, `<img>`-ready. */
  url: string;
  /** The glyph in 0–256 space (brush face, stone-light hex), for the host to set over the image in the page's own fonts. */
  glyph: TextLayer;
  view: number;
}

/**
 * The stone crest split for an `<img>` host: webfonts never resolve inside an
 * image (design 07 §8 — the Yuji brush face would fall back to a system
 * serif), so the glyph stays out of the data URL and comes back as a
 * `TextLayer` the host draws as inline `<text>` (`jtext.ts textEl`) over the
 * image. The emboss still rasterises once; the overlay carries no filter.
 */
export function monStoneImage(spec: MonSpec, o: { size: number; seed: number; idPrefix?: string }): MonStoneImage {
  const opts: MonOptions = { size: o.size, earned: false, seed: o.seed, idPrefix: o.idPrefix, glyphInSvg: false };
  const parts = monParts(spec, opts);
  return { url: svgDataUrl(wrapMon(spec, opts, parts)), glyph: parts.glyphLayer, view: MON_VIEW };
}
