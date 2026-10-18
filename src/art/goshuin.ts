/**
 * TSUZUKU — Goshuin (御朱印) stamp generator (design 06 §4).
 *
 * One vermilion seal per Gatekeeper, procedurally varied from a seed:
 *
 *  frame     square or round `sealFrame` (seeded), noise-eroded edges, ink bleed
 *  band      a border motif by belt — seigaiha (White–Orange), asanoha
 *            (Green–Purple), kikkō (Brown–Black) — as a `<pattern>`
 *  number    第七宿 — the post-station ordinal in kanji numerals, top band
 *  name      the station name in the brush face, 1–3 tategaki columns
 *  sumi      black calligraphy over the seal: 奉拝 top-right, the clear date
 *            in Japanese era format (kanji numerals) down the left, a dry
 *            brush flourish under the name
 *  pressed   a seeded impression mask (uneven ink), a tilt of a few degrees
 *  perfect   a gold outer frame (gate passed at 100 %)
 *  assisted  a grey corner tag (until the Revenge Match)
 *
 * `goshuinSvg` is the self-contained stamp (viewBox 0 0 320 320); `goshuinParts`
 * exposes the layers in 320-space plus the brush/mincho text as `TextLayer`s
 * for the canvas pass, and `bookStrip` lays the 53 pages out as one desktop
 * strip or a six-image phone set (design 06 §4). Everything is pure for its
 * inputs: same seed and data → byte-identical markup.
 */
import { STATIONS, type Belt, type StationDef } from '../content/types';
import { mulberry32 } from '../shared/hash';
import type { EpochDay } from '../shared/store-types';
import { formatEraDate } from '../shared/time';
import { PRESSURE, bristles, brushStroke, inkBleed, sealFrame } from './brush';
import { INK, PALETTE, STONE, WASHI, mix, normalizeHex, type Theme } from './color';
import type { Pt } from './geom';
import { FONTS, columnHeight, splitColumns, textEl, type TextLayer } from './jtext';
import { A, L, M, Z, circlePath, defs, el, filter, fmt, g, mask, path, pattern, polyPath, rect, roundedRectPath, safeRect, sizeOf, svgDataUrl, title, url, type Attrs } from './svg';
import { S } from './mon-strings';
import { fill as fillTemplate } from './strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types and tables                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export type MotifKind = 'seigaiha' | 'asanoha' | 'kikko';

/** Border motif by belt (design 06 §4): waves for the bay road, hemp leaf for the middle, tortoise shell for the last stretch. */
export const BELT_MOTIF: Record<Belt, MotifKind> = {
  white: 'seigaiha',
  yellow: 'seigaiha',
  orange: 'seigaiha',
  green: 'asanoha',
  blue: 'asanoha',
  purple: 'asanoha',
  brown: 'kikko',
  black: 'kikko',
};

export interface GoshuinOptions {
  station: StationDef;
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
  seed: number;
  /** Rendered px (square). */
  size: number;
  theme?: Theme;
  /** Emit shu/kin/hai/ink as `var(--token, hex)` inline styles (inline stamps only). */
  cssVars?: boolean;
  /** Draw a washi page behind the stamp (default transparent). */
  paper?: boolean;
  /** `<title>` for a standalone SVG (`role="img"`); without it the SVG is `aria-hidden`. */
  label?: string;
  /** Prefix for ids in `<defs>` (default from the seed). */
  idPrefix?: string;
  /** Write the brush/mincho text into the SVG (default true); false leaves it to `texts`. */
  textInSvg?: boolean;
}

export interface GoshuinParts {
  defs: string[];
  body: string[];
  /** Brush/mincho text in 320-space for the canvas pass (`png.drawTexts`). */
  texts: TextLayer[];
  view: number;
  round: boolean;
  motif: MotifKind;
  columns: number;
}

export const GOSHUIN_VIEW = 320;
export const GOSHUIN_MIN_SIZE = 24;
export const GOSHUIN_MAX_SIZE = 2048;

const CX = 160;
const CY = 160;
/** Outer seal frame: 236 user units. */
const FRAME = 236;
const FRAME_X = CX - FRAME / 2;

/* ────────────────────────────────────────────────────────────────────────── */
/* Kanji numerals and the era date                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
const UNITS = ['', '十', '百', '千'] as const;

/** 7 → 七, 10 → 十, 13 → 十三, 53 → 五十三, 2026 → 二千二十六 (0 → 〇; negatives/non-integers → their integer part). */
export function kanjiNumber(n: number): string {
  let v = Math.floor(Math.abs(Number.isFinite(n) ? n : 0));
  if (v === 0) return DIGITS[0];
  if (v >= 10_000) return String(v);
  let out = '';
  for (let u = 3; u >= 0; u--) {
    const p = 10 ** u;
    const d = Math.floor(v / p);
    v -= d * p;
    if (d === 0) continue;
    if (u === 0) out += DIGITS[d];
    else out += (d === 1 ? '' : DIGITS[d]) + UNITS[u];
  }
  return out;
}

/** `令和八年十月十七日` — `shared/time.formatEraDate` with kanji numerals, for vertical setting. 元年 is kept. */
export function eraDateKanji(day: EpochDay): string {
  return formatEraDate(day).replace(/\d+/g, (m) => kanjiNumber(Number(m)));
}

/** `第七宿` — the post-station ordinal printed in the seal's top band. */
export function stationOrdinal(n: number): string {
  return `${S.stationPrefix}${kanjiNumber(n)}${S.stationSuffix}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Paint                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

interface Paint {
  hex: string;
  css: string;
}

function tokenPaint(token: 'shu' | 'kin' | 'hai' | 'fg' | 'bg', fallback: string, o: { cssVars?: boolean; theme?: Theme }): Paint {
  const hex = normalizeHex(o.theme === 'dark' ? PALETTE.dark[token] : fallback);
  return { hex, css: o.cssVars ? `var(--${token}, ${hex})` : hex };
}
function plain(hex: string): Paint {
  const h = normalizeHex(hex);
  return { hex: h, css: h };
}
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

/* ────────────────────────────────────────────────────────────────────────── */
/* Motif patterns                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MotifOptions {
  /** Tile unit in user units (default 24). */
  cell?: number;
  /** Fan fill for seigaiha (the paper showing through); default washi. */
  paper?: string;
  /** Line width (default cell × 0.07). */
  stroke?: number;
}

/** Pointy-top hexagon outline points. */
function hex(cx: number, cy: number, r: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Asanoha inside one hexagon: six spokes, and in each of the six triangles lines from its centroid to its three corners. */
function asanohaCell(cx: number, cy: number, r: number): string {
  const v = hex(cx, cy, r);
  let d = polyPath(v, true);
  for (let i = 0; i < 6; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % 6]!;
    d += M(cx, cy) + L(a[0], a[1]);
    const gx = (cx + a[0] + b[0]) / 3;
    const gy = (cy + a[1] + b[1]) / 3;
    d += M(gx, gy) + L(cx, cy) + M(gx, gy) + L(a[0], a[1]) + M(gx, gy) + L(b[0], b[1]);
  }
  return d;
}

/** Kikkō cell: the hexagon and a nested one (子持亀甲). */
function kikkoCell(cx: number, cy: number, r: number): string {
  return polyPath(hex(cx, cy, r), true) + polyPath(hex(cx, cy, r * 0.62), true);
}

/**
 * `<pattern>` def (userSpaceOnUse) for a border motif in `color`. Seigaiha
 * fans are filled with `paper` so the rows overlap the right way; the
 * lattices are strokes only.
 */
export function motifPattern(id: string, kind: MotifKind, color: string, o: MotifOptions = {}): string {
  const cell = Math.max(4, o.cell ?? 24);
  const sw = o.stroke ?? cell * 0.07;
  const ink: Paint = { hex: color, css: color };
  const strokeAttrs: Attrs = { fill: 'none', 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...paintAttrs({ stroke: ink }) };
  if (kind === 'seigaiha') {
    const r = cell;
    const w = 2 * r;
    const h = r;
    const paper: Paint = { hex: o.paper ?? WASHI, css: o.paper ?? WASHI };
    const fan = (cx: number, cy: number): string => {
      const outer = M(cx - r, cy) + A(r, r, 0, 0, 1, cx + r, cy) + Z;
      let arcs = '';
      for (const k of [0.72, 0.45, 0.2]) arcs += M(cx - r * k, cy) + A(r * k, r * k, 0, 0, 1, cx + r * k, cy);
      return path(outer, { class: 'goshuin-motif__fan', 'stroke-width': sw, ...paintAttrs({ fill: paper, stroke: ink }) }) + path(arcs, strokeAttrs);
    };
    // rows top to bottom; the lower row is in front (see the tile derivation in goshuin.test.ts)
    return pattern(id, w, h, [fan(r, h / 2), fan(0, h), fan(w, h), fan(r, h * 1.5)], { class: `goshuin-motif goshuin-motif--${kind}` });
  }
  const r = cell / 2;
  const w = Math.sqrt(3) * r;
  const h = 3 * r;
  const centres: Pt[] = [
    [0, 0],
    [w, 0],
    [w / 2, h / 2],
    [0, h],
    [w, h],
  ];
  const cellFn = kind === 'asanoha' ? asanohaCell : kikkoCell;
  let d = '';
  for (const [cx, cy] of centres) d += cellFn(cx, cy, r);
  return pattern(id, w, h, path(d, strokeAttrs), { class: `goshuin-motif goshuin-motif--${kind}` });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The stamp                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function clampGoshuinSize(size: number): number {
  if (!Number.isFinite(size)) return 160;
  return Math.round(Math.min(GOSHUIN_MAX_SIZE, Math.max(GOSHUIN_MIN_SIZE, size)));
}

/** Columns for a station name: up to three glyphs in one, four or five in two, longer in three. */
export function nameColumns(name: string): number {
  const n = Array.from(name).length;
  return n <= 3 ? 1 : n <= 5 ? 2 : 3;
}

/** Band path (evenodd): the ring between the frame's inner edge and the text area. */
function bandPath(round: boolean, outerHalf: number, innerHalf: number): string {
  if (round) return circlePath(CX, CY, outerHalf) + circlePath(CX, CY, innerHalf);
  return roundedRectPath(CX - outerHalf, CY - outerHalf, outerHalf * 2, outerHalf * 2, 7) + roundedRectPath(CX - innerHalf, CY - innerHalf, innerHalf * 2, innerHalf * 2, 4);
}

/** Impression mask: a mostly-opaque fractal-noise field, so the ink reads pressed, not printed. */
function pressFilter(id: string, seed: number, freq: number): string {
  return filter(id, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: fmt(freq), numOctaves: 3, seed: seed >>> 0, result: 'n' }),
    // alpha = 1.6·R + 0.2: solid where the noise is mid/high, thinning only in its troughs
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 0.2' }),
  ]);
}

/** Vertical layer helper (x = column centre, y = column top). */
function column(text: string, x: number, y: number, size: number, font: string, fill: string, extra: Partial<TextLayer> = {}): TextLayer {
  return { text, x, y, size, font, fill, vertical: true, lang: 'ja', ...extra };
}

/** Rotate a point about the stamp centre and shift it: the seal's tilt applied to a text anchor. */
function tilted(x: number, y: number, tiltDeg: number, dx: number, dy: number): Pt {
  const a = (tiltDeg * Math.PI) / 180;
  const rx = CX + (x - CX) * Math.cos(a) - (y - CY) * Math.sin(a) + dx;
  const ry = CY + (x - CX) * Math.sin(a) + (y - CY) * Math.cos(a) + dy;
  return [rx, ry];
}

/** The stamp in 320-space. Pure for its inputs. */
export function goshuinParts(o: GoshuinOptions): GoshuinParts {
  const seed = (o.seed ?? 0) >>> 0;
  const rng = mulberry32(seed);
  const round = rng() < 0.45;
  const tilt = (rng() - 0.5) * 7;
  const dx = (rng() - 0.5) * 6;
  const dy = (rng() - 0.5) * 6;
  const erode = 0.011 + rng() * 0.008;
  const pressFreq = 0.045 + rng() * 0.03;
  const flourishBend = (rng() - 0.5) * 16;
  const prefix = o.idPrefix ?? `gs-${seed.toString(36)}`;
  const textInSvg = o.textInSvg ?? true;
  const motif = BELT_MOTIF[o.station.belt];

  const shu = tokenPaint('shu', PALETTE.light.shu, o);
  const kin = tokenPaint('kin', PALETTE.light.kin, o);
  const hai = tokenPaint('hai', PALETTE.light.hai, o);
  // sumi: ink on a washi page; on a transparent page the ink follows the text colour
  const sumi: Paint = o.paper ? plain(INK) : o.cssVars ? tokenPaint('fg', INK, o) : plain(o.theme === 'dark' ? WASHI : INK);
  const paper: Paint = o.paper ? plain(WASHI) : o.cssVars ? tokenPaint('bg', WASHI, o) : plain(o.theme === 'dark' ? PALETTE.dark.bg : WASHI);

  const ids = { bleed: `${prefix}-bleed`, press: `${prefix}-press`, pressMask: `${prefix}-pressmask`, motif: `${prefix}-motif-${motif}`, gold: `${prefix}-gold` };
  const defsOut: string[] = [
    inkBleed(ids.bleed, seed, { scale: 2.4, blur: 0.35, frequency: 0.05 }),
    pressFilter(ids.press, seed ^ 0x51ed27, pressFreq),
    mask(ids.pressMask, rect(0, 0, GOSHUIN_VIEW, GOSHUIN_VIEW, { fill: '#ffffff', filter: url(ids.press) })),
    motifPattern(ids.motif, motif, shu.css, { cell: 22, paper: paper.css, stroke: 1.5 }),
  ];

  const body: string[] = [];
  const texts: TextLayer[] = [];
  if (o.paper) body.push(rect(0, 0, GOSHUIN_VIEW, GOSHUIN_VIEW, { class: 'goshuin__paper', fill: WASHI }));

  /* ── red seal (tilted, pressed) ─────────────────────────────────────── */
  const seal: string[] = [];
  const frameStroke = FRAME * 0.07;
  if (o.perfect) {
    const goldSize = FRAME + 28;
    seal.push(
      path(sealFrame({ x: CX - goldSize / 2, y: CY - goldSize / 2, size: goldSize, round, seed: seed ^ 0xa5a5, stroke: 6.5, erode: 0.008 }), {
        class: 'goshuin__gold',
        'fill-rule': 'evenodd',
        ...paintAttrs({ fill: kin }),
      }),
    );
  }
  seal.push(
    path(sealFrame({ x: FRAME_X, y: FRAME_X, size: FRAME, round, seed, stroke: frameStroke, erode }), {
      class: `goshuin__frame goshuin__frame--${round ? 'round' : 'square'}`,
      'fill-rule': 'evenodd',
      ...paintAttrs({ fill: shu }),
    }),
  );
  const outerHalf = FRAME / 2 - frameStroke - 2;
  const innerHalf = outerHalf - 20;
  seal.push(path(bandPath(round, outerHalf, innerHalf), { class: `goshuin__band goshuin__band--${motif}`, 'fill-rule': 'evenodd', fill: url(ids.motif), opacity: 0.62 }));

  // top band: 第七宿 and a rule
  const ordinal = stationOrdinal(o.station.number);
  const ordinalLayer: TextLayer = { text: ordinal, x: CX, y: CY - 56, size: 15, font: FONTS.brush, fill: shu.hex, anchor: 'middle', letterSpacing: 1.5, lang: 'ja' };
  seal.push(path(M(CX - 46, CY - 46) + L(CX + 46, CY - 46), { class: 'goshuin__rule', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.85, ...paintAttrs({ stroke: shu }) }));

  // the name, 1–3 columns, right to left
  const name = o.station.nameJa;
  const columns = nameColumns(name);
  const cols = splitColumns(name, columns);
  const longest = cols.reduce((m, c) => Math.max(m, Array.from(c).length), 1);
  const areaH = 110;
  const areaW = innerHalf * 2 - 8;
  const colGap = 1.3;
  const byH = areaH / (1 + (longest - 1) * 1.12);
  const byW = areaW / (1 + (cols.length - 1) * colGap);
  let nameSize = Math.min(byH, byW, longest === 1 && cols.length === 1 ? 72 : 60);
  if (round) nameSize *= 0.92;
  nameSize = Math.floor(nameSize * 100) / 100;
  const pitch = colGap * nameSize;
  const nameTop = CY + 20 - columnHeight(cols[0] ?? '', nameSize) / 2;
  const firstX = CX + ((cols.length - 1) * pitch) / 2;
  const nameLayers = cols.map((t, i) => column(t, firstX - i * pitch, nameTop, nameSize, FONTS.brush, shu.hex, { weight: 700 }));

  const sealTexts = [ordinalLayer, ...nameLayers];
  if (textInSvg) seal.push(g({ class: 'goshuin__text', ...paintAttrs({ fill: shu }) }, sealTexts.map((l) => textEl({ ...l, fill: shu.css.startsWith('var(') ? 'currentColor' : l.fill }))));
  // the canvas pass needs the anchors in page space: rotate about the centre, then shift
  for (const l of sealTexts) {
    const [x, y] = tilted(l.x, l.y, tilt, dx, dy);
    texts.push({ ...l, x, y, rotate: tilt });
  }

  body.push(
    g(
      {
        class: 'goshuin__seal',
        transform: `translate(${fmt(dx)} ${fmt(dy)}) rotate(${fmt(tilt)} ${CX} ${CY})`,
        mask: url(ids.pressMask),
        filter: url(ids.bleed),
        ...(shu.css.startsWith('var(') ? { style: `color:${shu.css}` } : { color: shu.hex }),
      },
      seal,
    ),
  );

  /* ── sumi calligraphy (not tilted: written by hand over the seal) ─────── */
  const ink: string[] = [];
  const hohai = column(S.hohai, 296, 28, 18, FONTS.brush, sumi.hex, { weight: 700 });
  const date = column(eraDateKanji(o.at), 26, 150, 12, FONTS.mincho, sumi.hex);
  const sumiTexts = [hohai, date];
  // flourish under the name: a dry brush swoosh
  const spine: Pt[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    spine.push([96 + t * 128, 251 - Math.sin(t * Math.PI) * flourishBend + t * 4]);
  }
  ink.push(path(brushStroke(spine, { width: 5.5, pressure: PRESSURE.taper, seed: seed ^ 0x3c6e, bristle: 0.3 }), { class: 'goshuin__flourish', ...paintAttrs({ fill: sumi }) }));
  for (const d of bristles(spine, { width: 7, seed: seed ^ 0x3c6e, count: 4, gap: 0.45 })) {
    ink.push(path(d, { fill: 'none', 'stroke-width': 0.6, 'stroke-linecap': 'round', opacity: 0.8, ...paintAttrs({ stroke: sumi }) }));
  }
  if (textInSvg) ink.push(g({ class: 'goshuin__sumi-text', ...paintAttrs({ fill: sumi }) }, sumiTexts.map((l) => textEl({ ...l, fill: sumi.css.startsWith('var(') ? 'currentColor' : l.fill }))));
  texts.push(...sumiTexts);
  body.push(g({ class: 'goshuin__ink', ...(sumi.css.startsWith('var(') ? { style: `color:${sumi.css}` } : { color: sumi.hex }) }, ink));

  /* ── assisted: grey corner tag ───────────────────────────────────────── */
  if (o.assisted) {
    body.push(
      g({ class: 'goshuin__corner' }, [
        path(polyPath([[246, 42], [280, 42], [280, 76]], true), paintAttrs({ fill: hai })),
        path(M(246, 42) + L(280, 76), { 'stroke-width': 1.2, opacity: 0.5, ...paintAttrs({ stroke: plain(mix(STONE, INK, 0.5)) }) }),
      ]),
    );
  }

  return { defs: defsOut, body, texts, view: GOSHUIN_VIEW, round, motif, columns: cols.length };
}

/** The `<svg>` wrapper around `parts`: `viewBox 0 0 320 320`, `width`/`height` = size px. */
function wrapGoshuin(o: GoshuinOptions, parts: GoshuinParts): string {
  const size = clampGoshuinSize(o.size);
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      viewBox: `0 0 ${GOSHUIN_VIEW} ${GOSHUIN_VIEW}`,
      class: `goshuin-svg goshuin-svg--${parts.round ? 'round' : 'square'} goshuin-svg--${parts.motif}${o.perfect ? ' goshuin-svg--perfect' : ''}${o.assisted ? ' goshuin-svg--assisted' : ''}`,
      role: o.label ? 'img' : undefined,
      'aria-hidden': o.label ? undefined : 'true',
      focusable: 'false',
    },
    [o.label ? title(o.label) : '', defs(parts.defs), ...parts.body],
  );
}

/** A complete, self-contained stamp SVG (`viewBox 0 0 320 320`, `width`/`height` = size px). */
export function goshuinSvg(o: GoshuinOptions): string {
  return wrapGoshuin(o, goshuinParts(o));
}

/** Station lookup by number (1–53), or undefined. */
export function stationByNumber(n: number): StationDef | undefined {
  return STATIONS.find((s) => s.number === n);
}

/**
 * The stamp as an `<img>`-ready data URL (design 09 §5.3): hex paints resolved
 * for `theme` — no `var()` resolves inside an image — and the seal's turbulence
 * rasterised once by the decoder, so a book of fifty-three stamps holds no live
 * SVG filter (§6.7 rule 2). `cssVars` is forced off; everything else is
 * `goshuinSvg`'s.
 */
export function goshuinDataUrl(o: GoshuinOptions): string {
  return svgDataUrl(goshuinSvg({ ...o, cssVars: false }));
}

export interface GoshuinImage {
  /** The stamp without its text, `<img>`-ready (hex paints for `theme`). */
  url: string;
  /** Ordinal, name columns, 奉拝 and the era date in 320-space (tilt applied), for the host's inline `<text>` overlay. */
  texts: TextLayer[];
  view: number;
}

/**
 * The stamp split for an `<img>` host: webfonts never resolve inside an image
 * (design 07 §8), so the brush and Mincho text stays out of the data URL and
 * comes back as `TextLayer`s that the host sets as inline `<text>` over the
 * image (`jtext.ts textLayersSvg`) in the page's own Yuji / Shippori faces.
 * The seal's turbulence still rasterises once; the overlay carries no filter.
 */
export function goshuinImage(o: GoshuinOptions): GoshuinImage {
  const opts: GoshuinOptions = { ...o, cssVars: false, textInSvg: false };
  const parts = goshuinParts(opts);
  return { url: svgDataUrl(wrapGoshuin(opts, parts)), texts: parts.texts, view: GOSHUIN_VIEW };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The book: 53 pages + colophon                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BookStamp {
  station: StationDef;
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
}

export interface BookImage {
  svg: string;
  /** Text layers in the image's own space (the SVG carries no text when these are used). */
  texts: TextLayer[];
  w: number;
  h: number;
}

/** One accordion page in its own units. */
export const PAGE = { w: 240, h: 360 } as const;
export const BOOK_PAGES = STATIONS.length + 1;
export const PHONE_SET = 6;

function place(l: TextLayer, ox: number, oy: number, s: number): TextLayer {
  return { ...l, x: ox + l.x * s, y: oy + l.y * s, size: l.size * s, letterSpacing: l.letterSpacing === undefined ? undefined : l.letterSpacing * s };
}

interface PageOut {
  defs: string[];
  body: string;
  texts: TextLayer[];
}

/** Page `index` (0-based; 53 = colophon) drawn at `(ox, oy)` scaled by `s`. */
function page(index: number, stamp: BookStamp | undefined, cleared: number, seed: number, prefix: string, ox: number, oy: number, s: number, textInSvg: boolean): PageOut {
  const defsOut: string[] = [];
  const texts: TextLayer[] = [];
  const layers: string[] = [];
  const tone = index % 2 === 0 ? WASHI : mix(WASHI, INK, 0.035);
  layers.push(rect(0, 0, PAGE.w, PAGE.h, { class: 'goshuin-page__paper', fill: tone }));
  layers.push(path(M(0.5, 0) + L(0.5, PAGE.h), { stroke: mix(WASHI, INK, 0.18), 'stroke-width': 1 }));
  const station = index < STATIONS.length ? STATIONS[index] : undefined;
  const pageTexts: TextLayer[] = [];
  if (station) {
    if (stamp) {
      const sc = 0.7;
      const parts = goshuinParts({ station, at: stamp.at, perfect: stamp.perfect, assisted: stamp.assisted, seed, size: GOSHUIN_VIEW, idPrefix: `${prefix}-p${index}`, textInSvg });
      defsOut.push(...parts.defs);
      const px = (PAGE.w - GOSHUIN_VIEW * sc) / 2;
      const py = 40;
      layers.push(g({ class: 'goshuin-page__stamp', transform: `translate(${fmt(px)} ${fmt(py)}) scale(${fmt(sc)})` }, parts.body));
      for (const t of parts.texts) pageTexts.push(place(t, px, py, sc));
    } else {
      // not yet cleared: the name in grey stone, visible from day one
      const cols = splitColumns(station.nameJa, nameColumns(station.nameJa));
      const size = Math.min(40, 150 / (1 + (Math.max(...cols.map((c) => Array.from(c).length)) - 1) * 1.12));
      const pitch = size * 1.3;
      const top = 150 - columnHeight(cols[0] ?? '', size) / 2;
      cols.forEach((c, i) => pageTexts.push(column(c, PAGE.w / 2 + ((cols.length - 1) * pitch) / 2 - i * pitch, top, size, FONTS.brush, STONE, { opacity: 0.55 })));
    }
    pageTexts.push({ text: kanjiNumber(station.number), x: PAGE.w / 2, y: 318, size: 16, font: FONTS.mincho, fill: INK, anchor: 'middle', lang: 'ja', opacity: 0.8 });
    pageTexts.push({ text: `${station.number} · ${station.nameRomaji}`, x: PAGE.w / 2, y: 340, size: 11, font: FONTS.ui, fill: mix(INK, WASHI, 0.35), anchor: 'middle', lang: 'en' });
  } else {
    pageTexts.push(column(S.bookTitle, 150, 40, 22, FONTS.brush, INK, { weight: 700 }));
    pageTexts.push(column(S.bookSubtitle, 108, 48, 18, FONTS.brush, INK));
    pageTexts.push({ text: fillTemplate(S.bookCount, { n: cleared, total: STATIONS.length }), x: PAGE.w / 2, y: 300, size: 12, font: FONTS.ui, fill: mix(INK, WASHI, 0.35), anchor: 'middle', lang: 'en' });
    pageTexts.push({ text: S.bookEnd, x: PAGE.w / 2, y: 336, size: 20, font: FONTS.brush, fill: PALETTE.light.shu, anchor: 'middle', lang: 'ja' });
  }
  if (textInSvg) layers.push(g({ class: 'goshuin-page__text' }, pageTexts.map(textEl)));
  for (const t of pageTexts) texts.push(place(t, ox, oy, s));
  const cls = `goshuin-page${stamp ? ' goshuin-page--cleared' : station ? ' goshuin-page--locked' : ' goshuin-page--colophon'}`;
  const body = g({ class: cls, 'data-page': index + 1, 'data-x': fmt(ox), 'data-y': fmt(oy), 'data-w': fmt(PAGE.w * s), 'data-h': fmt(PAGE.h * s), transform: `translate(${fmt(ox)} ${fmt(oy)}) scale(${fmt(s)})` }, layers);
  return { defs: defsOut, body, texts };
}

function byStation(stamps: readonly BookStamp[]): Map<number, BookStamp> {
  const m = new Map<number, BookStamp>();
  for (const s of stamps) if (s.station && stationByNumber(s.station.number)) m.set(s.station.number, s);
  return m;
}

/**
 * The 53 pages plus a colophon as images: desktop → one strip (27 × 2 pages,
 * 6480 × 720); phone → six 1080 × 2340 images of nine pages inside the safe
 * zone. `textInSvg` false leaves every glyph to `texts` for the canvas pass.
 */
export function bookStripImages(stamps: readonly BookStamp[], seed: number, layout: 'desktop' | 'phone', o: { textInSvg?: boolean } = {}): BookImage[] {
  const textInSvg = o.textInSvg ?? true;
  const map = byStation(stamps);
  const cleared = map.size;
  const prefix = `gsb-${(seed >>> 0).toString(36)}`;
  const pageSeed = (n: number): number => (mulberry32((seed ^ (n * 0x9e3779b9)) >>> 0)() * 0xffffffff) >>> 0;
  const images: BookImage[] = [];
  if (layout === 'desktop') {
    const perRow = Math.ceil(BOOK_PAGES / 2);
    const w = perRow * PAGE.w;
    const h = 2 * PAGE.h;
    const d: string[] = [];
    const b: string[] = [];
    const texts: TextLayer[] = [];
    for (let i = 0; i < BOOK_PAGES; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const p = page(i, map.get(i + 1), cleared, pageSeed(i + 1), prefix, col * PAGE.w, row * PAGE.h, 1, textInSvg);
      d.push(...p.defs);
      b.push(p.body);
      texts.push(...p.texts);
    }
    images.push({ svg: doc(w, h, d, b, S.bookTitle), texts, w, h });
    return images;
  }
  const { w, h } = sizeOf('phone');
  const safe = safeRect('phone');
  const perImage = Math.ceil(BOOK_PAGES / PHONE_SET);
  const colsN = 3;
  const rowsN = Math.ceil(perImage / colsN);
  const gap = 24;
  const scale = Math.min((w - 2 * 30 - (colsN - 1) * gap) / (colsN * PAGE.w), (safe.h - 2 * 24 - (rowsN - 1) * gap) / (rowsN * PAGE.h));
  const pw = PAGE.w * scale;
  const ph = PAGE.h * scale;
  const gridW = colsN * pw + (colsN - 1) * gap;
  const gridH = rowsN * ph + (rowsN - 1) * gap;
  const x0 = (w - gridW) / 2;
  const y0 = safe.y + (safe.h - gridH) / 2;
  for (let img = 0; img < PHONE_SET; img++) {
    const d: string[] = [];
    const b: string[] = [];
    const texts: TextLayer[] = [];
    for (let k = 0; k < perImage; k++) {
      const i = img * perImage + k;
      if (i >= BOOK_PAGES) break;
      const col = k % colsN;
      const row = Math.floor(k / colsN);
      const p = page(i, map.get(i + 1), cleared, pageSeed(i + 1), `${prefix}-i${img}`, x0 + col * (pw + gap), y0 + row * (ph + gap), scale, textInSvg);
      d.push(...p.defs);
      b.push(p.body);
      texts.push(...p.texts);
    }
    images.push({ svg: doc(w, h, d, b, `${S.bookTitle} ${img + 1}/${PHONE_SET}`), texts, w, h });
  }
  return images;
}

function doc(w: number, h: number, d: string[], body: string[], label: string): string {
  return el(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'goshuin-book', role: 'img' },
    [title(label), defs(d), rect(0, 0, w, h, { class: 'goshuin-book__bg', fill: mix(WASHI, INK, 0.08) }), ...body],
  );
}

/** Module-plan signature: the book as SVG strings (text inside the SVG). */
export function bookStrip(stamps: readonly BookStamp[], seed: number, layout: 'desktop' | 'phone'): string[] {
  return bookStripImages(stamps, seed, layout).map((i) => i.svg);
}

/** Readable text of a stamp for labels: `Goshuin of Station 7, 平塚 (Hiratsuka), cleared 令和8年10月17日.` */
export function goshuinLabel(station: StationDef, at: EpochDay, perfect: boolean, assisted: boolean): string {
  const base = fillTemplate(S.stampAlt, { n: station.number, name: station.nameJa, romaji: station.nameRomaji, date: formatEraDate(at) });
  return [base, perfect ? S.stampPerfect : '', assisted ? S.stampAssisted : ''].filter(Boolean).join(' ');
}
