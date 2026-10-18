/**
 * TSUZUKU — Japanese text layout for SVG and the PNG text pass.
 *
 * Webfonts do not render inside an `<img>`-loaded SVG (design 07 §8), so a
 * wallpaper describes its personal text as `TextLayer`s that the exporter
 * draws with Canvas 2D after `document.fonts.load`. The same layers render
 * as `<text>` through `textEl()` for inline previews. Both renderers share
 * ONE geometry contract:
 *
 *  horizontal  `(x, y)` = anchor point on the alphabetic baseline
 *  vertical    `x` = column centre, `y` = top of the column; glyphs stack
 *              downward with a pitch of `size × VERTICAL_PITCH`; glyphs in
 *              `VERTICAL_ROTATE` (ー, brackets…) turn 90°
 *
 * Font tokens map to the CSS font-family stacks of `tokens.css`
 * (jtext.test.ts checks them against the file).
 */
import type { EpochDay } from '../shared/store-types';
import { formatEraDate } from '../shared/time';
import { toKatakana as wkToKatakana } from 'wanakana';
import { el, esc, fmt, safeRect, text as svgText, type Attrs, type SizeKey } from './svg';
import type { Box } from './geom';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types and fonts                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TextLayer {
  text: string;
  x: number;
  y: number;
  /** Font size in user units. */
  size: number;
  /** CSS font-family string (use `FONTS`). */
  font: string;
  fill: string;
  vertical?: boolean;
  /** Horizontal anchor (default `start`). Ignored for vertical layers. */
  anchor?: 'start' | 'middle' | 'end';
  /** CSS font-weight (default 400). */
  weight?: number | string;
  /** 0–1 (default 1). */
  opacity?: number;
  /** Rotation in degrees about `(x, y)`. */
  rotate?: number;
  /** Extra tracking in user units per glyph (horizontal only). */
  letterSpacing?: number;
  /** BCP-47 tag (default `ja`). */
  lang?: string;
}

export type FontToken = 'ui' | 'ja' | 'pixel' | 'brush' | 'mincho' | 'neon';

/** CSS font-family stacks, identical to `--font-*` in tokens.css. */
export const FONTS: Record<FontToken, string> = {
  ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, system-ui, sans-serif',
  ja: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", YuGothic, Meiryo, "Noto Sans CJK JP", "Noto Sans JP", "BIZ UDPGothic", sans-serif',
  pixel: '"DotGothic16", "Hiragino Sans", "Yu Gothic UI", "Noto Sans CJK JP", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  brush: '"Yuji Syuku", "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", "MS PMincho", serif',
  mincho: '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", "MS PMincho", serif',
  neon: '"Dela Gothic One", "Hiragino Sans", "Yu Gothic UI", "Arial Black", Impact, "Noto Sans CJK JP", sans-serif',
};

export function fontFamily(t: FontToken): string {
  return FONTS[t];
}

/** The webfont family a token leads with (what `document.fonts.load` must wait for), or null for system stacks. */
export function webfontOf(font: string): string | null {
  const m = /^"([^"]+)"/.exec(font.trim());
  if (!m) return null;
  const name = m[1]!;
  return ['DotGothic16', 'Yuji Syuku', 'Shippori Mincho B1', 'Dela Gothic One'].includes(name) ? name : null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Measurement                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Pitch between stacked glyphs in a vertical column, in em. */
export const VERTICAL_PITCH = 1.12;

/** Glyphs that rotate 90° when set vertically. */
export const VERTICAL_ROTATE: ReadonlySet<string> = new Set([
  'ー', '〜', '～', '…', '‥', '―', '－', '＝',
  '（', '）', '「', '」', '『', '』', '【', '】', '〈', '〉', '《', '》', '［', '］', '｛', '｝',
  '(', ')', '[', ']', '{', '}', '-', '–', '—', '=', '_', ':', ';', '<', '>', '~',
]);

export function needsRotation(ch: string): boolean {
  return VERTICAL_ROTATE.has(ch);
}

/** Full-width glyph: CJK ideographs, kana, full-width forms, CJK punctuation. */
export function isWide(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)
  );
}

/** Horizontal advance of one glyph in em: 1 for wide glyphs, ≈ 0.56 for Latin, 0.3 for a space. */
export function advanceEm(ch: string): number {
  if (ch === ' ' || ch === ' ') return 0.3;
  if (isWide(ch)) return 1;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[ijlt.,:;'!|]/.test(ch)) return 0.3;
  if (/[mwMW]/.test(ch)) return 0.85;
  return 0.56;
}

/** Estimated width of a horizontal run at `size` (fonts vary; wide glyphs are exact squares). */
export function textWidth(text: string, size: number, o: { letterSpacing?: number } = {}): number {
  const chars = Array.from(text);
  let em = 0;
  for (const ch of chars) em += advanceEm(ch);
  return em * size + Math.max(0, chars.length - 1) * (o.letterSpacing ?? 0);
}

/** Height of a vertical column of `text` at `size`. */
export function columnHeight(text: string, size: number): number {
  const n = Array.from(text).length;
  return n === 0 ? 0 : size * (1 + (n - 1) * VERTICAL_PITCH);
}

export interface FitOptions {
  vertical?: boolean;
  /** Lower bound (default 8). */
  min?: number;
  /** Upper bound (default 4096). */
  max?: number;
  letterSpacing?: number;
}

/**
 * Largest font size at which `text` fits a `maxW × maxH` box, as one
 * horizontal line (height ≤ maxH, width ≤ maxW) or one vertical column
 * (width ≤ maxW, height ≤ maxH). Empty text → `max`-bounded `maxH`.
 * `min` is a legibility floor: when it binds the text overruns its box, so
 * pass it only for fixed strings (titles, labels) — learner text such as the
 * name or a sentence must shrink to fit, or be split into columns/lines.
 */
export function fitSize(text: string, maxW: number, maxH: number, o: FitOptions = {}): number {
  const lo = o.min ?? 8;
  const hi = o.max ?? 4096;
  const chars = Array.from(text);
  let size: number;
  if (o.vertical) {
    const n = Math.max(1, chars.length);
    const byH = maxH / (1 + (n - 1) * VERTICAL_PITCH);
    size = Math.min(maxW, byH);
  } else {
    const em = chars.reduce((a, ch) => a + advanceEm(ch), 0);
    const ls = o.letterSpacing ?? 0;
    const byW = em > 0 ? (maxW - Math.max(0, chars.length - 1) * ls) / em : maxH;
    size = Math.min(maxH, byW);
  }
  if (!Number.isFinite(size)) size = lo;
  return Math.max(lo, Math.min(hi, Math.floor(size * 100) / 100));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Splitting                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const BREAK_AFTER = new Set(['。', '、', '！', '？', '!', '?', ',', '.', ' ', '　', '」', '』', '）', ')']);
const NO_START = new Set(['。', '、', '！', '？', 'ー', '々', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'っ', 'ゃ', 'ゅ', 'ょ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ッ', 'ャ', 'ュ', 'ョ', '」', '』', '）', ')']);

/**
 * Split `text` into `columns` runs of near-equal length, preferring to break
 * after punctuation and never starting a run with a small kana or closing
 * mark (kinsoku). Fewer runs come back when the text is too short.
 */
export function splitColumns(text: string, columns: number): string[] {
  const chars = Array.from(text.replace(/\s+/g, (m) => (m.includes('\n') ? '\n' : m)));
  const n = Math.max(1, Math.round(columns));
  if (chars.length === 0) return [];
  if (n === 1 || chars.length <= 1) return [chars.join('')];
  const explicit = chars.join('').split('\n');
  if (explicit.length > 1 && explicit.length <= n) return explicit.filter((s) => s.length > 0);
  const flat = chars.filter((c) => c !== '\n');
  const target = flat.length / n;
  const out: string[] = [];
  let start = 0;
  for (let k = 1; k < n && start < flat.length; k++) {
    const ideal = Math.round(target * k);
    let cut = Math.min(flat.length - 1, Math.max(start + 1, ideal));
    // search outward from the ideal cut for a nicer boundary
    let best = cut;
    let bestScore = -Infinity;
    for (let d = -3; d <= 3; d++) {
      const c = cut + d;
      if (c <= start || c >= flat.length) continue;
      let score = -Math.abs(d);
      if (BREAK_AFTER.has(flat[c - 1]!)) score += 4;
      if (NO_START.has(flat[c]!)) score -= 6;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    cut = best;
    out.push(flat.slice(start, cut).join(''));
    start = cut;
  }
  if (start < flat.length) out.push(flat.slice(start).join(''));
  return out.filter((s) => s.length > 0);
}

/** Columns needed so no column exceeds `maxChars`. */
export function columnsFor(text: string, maxChars: number): number {
  const n = Array.from(text).length;
  return Math.max(1, Math.ceil(n / Math.max(1, maxChars)));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tategaki                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TategakiOptions {
  text: string;
  /** Centre x of the FIRST (rightmost) column. */
  x: number;
  /** Top of the columns. */
  y: number;
  size: number;
  /** 1–3 (default 1). */
  columns?: number;
  font: string;
  fill: string;
  /** Column pitch in em (default 1.6). Columns flow right-to-left like real tategaki. */
  colGap?: number;
  opacity?: number;
  weight?: number | string;
}

/** One vertical `TextLayer` per column (rightmost first), for the canvas pass. */
export function tategakiLayers(o: TategakiOptions): TextLayer[] {
  const cols = splitColumns(o.text, Math.max(1, Math.min(3, Math.round(o.columns ?? 1))));
  const pitch = (o.colGap ?? 1.6) * o.size;
  return cols.map((text, i) => ({
    text,
    x: o.x - i * pitch,
    y: o.y,
    size: o.size,
    font: o.font,
    fill: o.fill,
    vertical: true,
    opacity: o.opacity,
    weight: o.weight,
    lang: 'ja',
  }));
}

/** Vertical text as SVG markup (glyphs stacked, rotation for ー and brackets), `lang="ja"`. */
export function tategaki(o: TategakiOptions): string {
  return el('g', { lang: 'ja' }, tategakiLayers(o).map(textEl));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rendering layers to SVG                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function layerAttrs(l: TextLayer): Attrs {
  return {
    'font-family': l.font,
    'font-size': l.size,
    'font-weight': l.weight,
    fill: l.fill,
    opacity: l.opacity !== undefined && l.opacity !== 1 ? l.opacity : undefined,
    lang: l.lang ?? 'ja',
  };
}

/** A `TextLayer` as SVG. Horizontal → one `<text>`; vertical → a `<g>` of stacked glyphs. */
export function textEl(l: TextLayer): string {
  const rot = l.rotate ? `rotate(${fmt(l.rotate)} ${fmt(l.x)} ${fmt(l.y)})` : undefined;
  if (!l.vertical) {
    return svgText(l.text, {
      x: l.x,
      y: l.y,
      'text-anchor': l.anchor ?? 'start',
      'letter-spacing': l.letterSpacing,
      transform: rot,
      ...layerAttrs(l),
    });
  }
  const chars = Array.from(l.text);
  const pitch = l.size * VERTICAL_PITCH;
  const glyphs = chars.map((ch, i) => {
    const cy = l.y + l.size / 2 + i * pitch;
    const a: Attrs = { x: l.x, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' };
    if (needsRotation(ch)) a.transform = `rotate(90 ${fmt(l.x)} ${fmt(cy)})`;
    return svgText(ch, a);
  });
  return el('g', { transform: rot, ...layerAttrs(l) }, glyphs);
}

export function textLayersSvg(layers: readonly TextLayer[]): string {
  return layers.map(textEl).join('');
}

/** Escape text for an SVG text node (alias of `svg.esc`, exported for generator authors). */
export function escapeText(s: string): string {
  return esc(s);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Bounds, boxes and fitting                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Approximate bounding box of a layer (rotation ignored). */
export function layerBounds(l: TextLayer): Box {
  if (l.vertical) {
    return { x: l.x - l.size / 2, y: l.y, w: l.size, h: columnHeight(l.text, l.size) };
  }
  const w = textWidth(l.text, l.size, { letterSpacing: l.letterSpacing });
  const x = l.anchor === 'middle' ? l.x - w / 2 : l.anchor === 'end' ? l.x - w : l.x;
  return { x, y: l.y - l.size * 0.88, w, h: l.size * 1.1 };
}

/** The text-safe box of a canvas size minus a margin. */
export function safeTextBox(size: SizeKey, margin = 48): Box {
  return safeRect(size, margin);
}

/** True when the layer lies inside the phone safe area (always true on desktop). */
export function inSafeZone(l: TextLayer, size: SizeKey): boolean {
  const safe = safeRect(size);
  const b = layerBounds(l);
  return b.y >= safe.y - 0.01 && b.y + b.h <= safe.y + safe.h + 0.01;
}

export interface LayoutOptions {
  font: string;
  fill: string;
  vertical?: boolean;
  /** Horizontal alignment inside the box (default `middle`); vertical text centres its column. */
  align?: 'start' | 'middle' | 'end';
  /** Vertical placement inside the box for horizontal text (default `middle`). */
  valign?: 'top' | 'middle' | 'bottom';
  min?: number;
  max?: number;
  weight?: number | string;
  opacity?: number;
  letterSpacing?: number;
}

/** A single fitted layer inside `box` (largest size that fits, clamped by `min`/`max`). */
export function layoutInBox(text: string, box: Box, o: LayoutOptions): TextLayer {
  const size = fitSize(text, box.w, box.h, { vertical: o.vertical, min: o.min, max: o.max, letterSpacing: o.letterSpacing });
  if (o.vertical) {
    const h = columnHeight(text, size);
    return { text, x: box.x + box.w / 2, y: box.y + (box.h - h) / 2, size, font: o.font, fill: o.fill, vertical: true, weight: o.weight, opacity: o.opacity, lang: 'ja' };
  }
  const align = o.align ?? 'middle';
  const x = align === 'start' ? box.x : align === 'end' ? box.x + box.w : box.x + box.w / 2;
  const valign = o.valign ?? 'middle';
  const baseline = valign === 'top' ? box.y + size * 0.88 : valign === 'bottom' ? box.y + box.h - size * 0.22 : box.y + box.h / 2 + size * 0.33;
  return { text, x, y: baseline, size, font: o.font, fill: o.fill, anchor: align, weight: o.weight, opacity: o.opacity, letterSpacing: o.letterSpacing, lang: 'ja' };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Japanese helpers                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/** `令和8年1月15日` (shared/time; year 1 prints 元年). */
export function eraDate(day: EpochDay): string {
  return formatEraDate(day);
}

/** Learner name in katakana (station signs, hi-score initials); kanji and existing katakana pass through, romaji converts. */
export function katakanaName(name: string): string {
  const t = name.trim();
  if (t === '') return '';
  const k = wkToKatakana(t);
  // Only a full conversion is a kana name: an English spelling that is not romaji (Christopher → chリsトpヘr)
  // stays as the learner wrote it, since Station 0 now keeps Latin names (profile.nameKana === '' → name).
  return /[A-Za-z]/.test(k) ? t : k;
}

/** Up to `n` katakana initials (first glyphs), the arcade hi-score way. */
export function initials(name: string, n = 3): string {
  const k = Array.from(katakanaName(name).replace(/[\s・]/g, ''));
  return k.slice(0, Math.max(1, n)).join('');
}

/** Glyph count (code points), the unit every fitting function uses. */
export function glyphCount(text: string): number {
  return Array.from(text).length;
}
