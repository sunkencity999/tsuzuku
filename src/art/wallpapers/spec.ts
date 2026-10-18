/**
 * TSUZUKU — wallpaper generator contract (design 06 §3).
 *
 * Every generator file `src/art/wallpapers/<kebab>.ts` exports
 * `export const spec: WallpaperSpec` and is imported by `./index.ts` as
 * `import { spec as toriiDawn } from './torii-dawn'`.
 *
 * `compose(seed, data, size)` must be PURE and deterministic: same inputs →
 * byte-identical SVG. It returns a `Composition`: a full SVG document from
 * `svg.svgDoc` at `SIZES[size]` (1920×1080 or 1080×2340), the personal text
 * as `TextLayer`s (drawn by the exporter with real webfonts; the SVG may also
 * carry decorative glyphs but no personal text), and the post pass it wants.
 * On the phone, every TextLayer stays inside `safeRect('phone')`
 * (`safeZone('phone')` = top 281 / bottom 300 px). Generators never read the
 * store; `index.ts` gathers `WallpaperData` and seeds them.
 *
 * The second half of this file is the render pipeline `index.ts` applies on
 * top of a composition: sumi silhouette for locked pieces, quadrant reveal
 * for counter pieces, the SVG-side post layer. It lives here so the pure
 * pipeline is testable before the 28 generators exist.
 */
import type { BadgeId, WallpaperId } from '../../shared/catalog';
import type { EpochDay } from '../../shared/store-types';
import type { Belt } from '../../content/types';
import { SUMI, WASHI, parseHex } from '../color';
import type { Box } from '../geom';
import { inSafeZone, layerBounds, type TextLayer } from '../jtext';
import { postLayer, type PostPass } from '../pixel';
import { SIZES, clipPath, el, fmt, innerOf, rect, safeRect, safeZone, sizeOf, svgDoc, url, use, viewBoxOf } from '../svg';

export type { TextLayer } from '../jtext';
export type { PostPass } from '../pixel';
export { SIZES, safeRect, safeZone, sizeOf };

export type WallpaperSize = 'desktop' | 'phone';
export const WALLPAPER_SIZES: readonly WallpaperSize[] = ['desktop', 'phone'];

/* ────────────────────────────────────────────────────────────────────────── */
/* Data and spec                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MasteredVocab {
  word: string;
  kana: string;
  reviews: number;
}

/** Personalisation tokens (design 06 §3), gathered by `data.ts`. Lists are sorted by stability, strongest first. */
export interface WallpaperData {
  nameKana: string;
  chosenKanji?: string;
  belt: Belt;
  /** Frozen at the longest streak so a break never shrinks a piece. */
  streak: number;
  totalDays: number;
  level: number;
  xp: number;
  mastered: { kana: string[]; kanji: string[]; vocab: MasteredVocab[] };
  grammarBrown: string[];
  katakanaBrown: string[];
  badgesInOrder: BadgeId[];
  /** Cleared station numbers, ascending. */
  stamps: number[];
  station: number;
  /** Minutes per day, oldest first, exactly 90 entries. */
  minutes90: number[];
  writingSentences: string[];
  dictatedSentence?: string;
  /** Kana glyph → best Gojūon Fighter reaction time in ms. */
  gojuonMs: Record<string, number>;
  rapidBest: number;
  freezes: number;
  restDays: number;
  wordsThisMonth: number;
  /** Grammar patterns mastered during the Plateau Arc (stations 25–46). */
  arcGrammar: string[];
  sentenceOfChoice?: string;
  /** Hours of `listen` rows in the Input Ledger, dojo and outside alike (design 08 §11: one chōchin per 10 h on 茶屋の灯). */
  listenHours: number;
  date: EpochDay;
}

export interface Composition {
  svg: string;
  texts: TextLayer[];
  post: PostPass;
}

export interface WallpaperSpec {
  id: WallpaperId;
  compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition;
  /** Optional hand-drawn locked variant; without it `index.ts` derives a sumi silhouette from `compose`. */
  silhouette?(seed: number, data: WallpaperData, size: WallpaperSize): Composition;
  /** Living pieces re-render from current state (fifty-three, daruma). */
  living?: boolean;
}

/** Runtime shape check for a composition (generator tests and the registry). */
export function isComposition(x: unknown): x is Composition {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Partial<Composition>;
  return typeof c.svg === 'string' && c.svg.startsWith('<svg') && Array.isArray(c.texts) && typeof c.post === 'string';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Quadrants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export type Quadrant = 1 | 2 | 3 | 4;
export type Revealed = 0 | 1 | 2 | 3 | 4;

/** Quadrant boxes in reading order: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right. */
export function quadrantBox(q: Quadrant, size: WallpaperSize): Box {
  const { w, h } = sizeOf(size);
  const hw = w / 2;
  const hh = h / 2;
  switch (q) {
    case 1:
      return { x: 0, y: 0, w: hw, h: hh };
    case 2:
      return { x: hw, y: 0, w: hw, h: hh };
    case 3:
      return { x: 0, y: hh, w: hw, h: hh };
    case 4:
      return { x: hw, y: hh, w: hw, h: hh };
  }
}

/** The quadrant holding a layer's centre. */
export function quadrantOf(layer: TextLayer, size: WallpaperSize): Quadrant {
  const b = layerBounds(layer);
  const { w, h } = sizeOf(size);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const right = cx >= w / 2;
  const bottom = cy >= h / 2;
  return bottom ? (right ? 4 : 3) : right ? 2 : 1;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pipeline                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const SCENE_ID = 'wp-scene';
const SUMI_FILTER_ID = 'wp-sumi';
const REVEAL_CLIP_ID = 'wp-reveal';

function channel(hex: string, i: 0 | 1 | 2): string {
  return fmt(parseHex(hex)[i] / 255);
}

/**
 * Filter that turns any scene into ink wash on paper: luminance → four ink
 * levels → tinted from `ink` (dark) to `paper` (light).
 */
export function sumiFilter(id: string, o: { ink?: string; paper?: string } = {}): string {
  const ink = o.ink ?? SUMI;
  const paper = o.paper ?? WASHI;
  const lum = '0.2126 0.7152 0.0722 0 0';
  const func = (ch: 'R' | 'G' | 'B', i: 0 | 1 | 2): string => el(`feFunc${ch}`, { type: 'table', tableValues: `${channel(ink, i)} ${channel(paper, i)}` });
  // Floor lifted off pure sumi so night scenes read as deep ink wash, not a black tile.
  const discrete = (ch: 'R' | 'G' | 'B'): string => el(`feFunc${ch}`, { type: 'discrete', tableValues: '0.2 0.45 0.7 1' });
  return el('filter', { id, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' }, [
    el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: `${lum}  ${lum}  ${lum}  0 0 0 1 0`, result: 'grey' }),
    el('feComponentTransfer', { in: 'grey', result: 'levels' }, [discrete('R'), discrete('G'), discrete('B')]),
    el('feComponentTransfer', { in: 'levels' }, [func('R', 0), func('G', 1), func('B', 2)]),
  ]);
}

export interface FinalizeOptions {
  size: WallpaperSize;
  /** Seed of the piece (also seeds the grain layer). */
  seed: number;
  locked: boolean;
  /** Quadrants revealed on a locked counter piece (ignored when unlocked). */
  revealed: Revealed;
  /**
   * `svg` (default) appends the post pass as an SVG layer and reports
   * `post: 'none'` so the exporter does not apply it twice; `raster` leaves
   * the SVG clean and reports the spec's choice for `exportPng`; `none`
   * drops the effect (thumbnails).
   */
  post?: 'svg' | 'raster' | 'none';
  /** Paper/ink of the silhouette (defaults washi/sumi). */
  paper?: string;
  ink?: string;
  /** `<title>` of the wrapped document when a silhouette/reveal is produced (the piece's English name). */
  title?: string;
}

export interface RenderedWallpaper {
  svg: string;
  texts: TextLayer[];
  /** What `exportPng` should still apply (`'none'` after an SVG-side pass). */
  post: PostPass;
  /** The generator's chosen effect, for labels. */
  effect: PostPass;
  locked: boolean;
  revealed: Revealed;
  seed: number;
  size: WallpaperSize;
  w: number;
  h: number;
}

/**
 * Wrap a scene so it can be reused twice: once through the sumi filter, once
 * clipped to the revealed quadrants. The scene keeps its own defs/ids; only
 * the three `wp-*` ids are added, so generators must not use that prefix.
 */
function embedScene(c: Composition, size: WallpaperSize, body: string[], extraDefs: string[], title?: string): string {
  const { w, h } = sizeOf(size);
  const vb = viewBoxOf(c.svg);
  const inner = innerOf(c.svg);
  // Scale a scene composed at another size into this canvas (defensive; specs compose at SIZES[size]).
  const scaled = vb && (vb.w !== w || vb.h !== h) ? el('g', { transform: `scale(${fmt(w / vb.w)} ${fmt(h / vb.h)})` }, inner) : inner;
  return svgDoc({
    w,
    h,
    title,
    defs: [el('g', { id: SCENE_ID }, scaled), ...extraDefs],
    body,
  });
}

/** Locked look: the whole scene as ink wash on paper, personal text dropped. */
export function sumiSilhouette(c: Composition, size: WallpaperSize, o: { paper?: string; ink?: string; title?: string } = {}): Composition {
  const { w, h } = sizeOf(size);
  const paper = o.paper ?? WASHI;
  const svg = embedScene(
    c,
    size,
    [rect(0, 0, w, h, { fill: paper }), use(SCENE_ID, { filter: url(SUMI_FILTER_ID) })],
    [sumiFilter(SUMI_FILTER_ID, { ink: o.ink, paper })],
    o.title,
  );
  return { svg, texts: [], post: c.post };
}

/**
 * Progressive reveal: silhouette underneath, the colour scene clipped to the
 * first `revealed` quadrants (reading order) on top; texts whose centre lies in
 * a revealed quadrant stay. `revealed = 4` returns the composition unchanged.
 */
export function revealQuadrants(c: Composition, revealed: Revealed, size: WallpaperSize, o: { paper?: string; ink?: string; title?: string } = {}): Composition {
  if (revealed >= 4) return c;
  if (revealed <= 0) return sumiSilhouette(c, size, o);
  const { w, h } = sizeOf(size);
  const paper = o.paper ?? WASHI;
  const shown: Quadrant[] = ([1, 2, 3, 4] as Quadrant[]).slice(0, revealed);
  const clip = clipPath(
    REVEAL_CLIP_ID,
    shown.map((q) => {
      const b = quadrantBox(q, size);
      return rect(b.x, b.y, b.w, b.h);
    }),
  );
  const svg = embedScene(
    c,
    size,
    [rect(0, 0, w, h, { fill: paper }), use(SCENE_ID, { filter: url(SUMI_FILTER_ID) }), el('g', { 'clip-path': url(REVEAL_CLIP_ID) }, use(SCENE_ID))],
    [sumiFilter(SUMI_FILTER_ID, { ink: o.ink, paper }), clip],
    o.title,
  );
  const texts = c.texts.filter((t) => shown.includes(quadrantOf(t, size)));
  return { svg, texts, post: c.post };
}

/** Append the SVG-side post layer (`pixel.postLayer`) just before `</svg>`. */
export function appendPostLayer(c: Composition, size: WallpaperSize, seed: number): Composition {
  if (c.post === 'none') return c;
  const { w, h } = sizeOf(size);
  const layer = postLayer(c.post, { id: 'wp-post', w, h, seed });
  const close = c.svg.lastIndexOf('</svg>');
  if (close < 0) return c;
  const svg = c.svg.slice(0, close) + el('defs', undefined, layer.defs) + layer.body + c.svg.slice(close);
  return { svg, texts: c.texts, post: c.post };
}

/** The full pipeline over a composed scene (pure; `index.ts` adds store access and the seed). */
export function finalize(c: Composition, o: FinalizeOptions): RenderedWallpaper {
  const { w, h } = sizeOf(o.size);
  const mode = o.post ?? 'svg';
  let out: Composition = c;
  if (o.locked) {
    out = revealQuadrants(c, o.revealed, o.size, { paper: o.paper, ink: o.ink, title: o.title });
  }
  let post: PostPass = out.post;
  if (mode === 'svg') {
    out = appendPostLayer(out, o.size, o.seed);
    post = 'none';
  } else if (mode === 'none') {
    post = 'none';
  }
  return {
    svg: out.svg,
    texts: out.texts,
    post,
    effect: c.post,
    locked: o.locked,
    revealed: o.locked ? o.revealed : 4,
    seed: o.seed,
    size: o.size,
    w,
    h,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Checks (generator tests)                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** Texts that leave the phone safe area (always empty on desktop). */
export function safeZoneViolations(c: Composition, size: WallpaperSize): TextLayer[] {
  return c.texts.filter((t) => !inSafeZone(t, size));
}

/** Texts whose estimated bounds (`layerBounds`) leave the canvas; rotated layers are skipped (their box depends on the angle). */
export function canvasViolations(c: Composition, size: WallpaperSize): TextLayer[] {
  const { w, h } = sizeOf(size);
  return c.texts.filter((t) => {
    if (t.rotate) return false;
    const b = layerBounds(t);
    return b.x < -0.01 || b.y < -0.01 || b.x + b.w > w + 0.01 || b.y + b.h > h + 0.01;
  });
}

/** The root element declares the expected canvas (`width`/`height`/`viewBox` = `SIZES[size]`). */
export function hasCanvasSize(c: Composition, size: WallpaperSize): boolean {
  const vb = viewBoxOf(c.svg);
  const { w, h } = sizeOf(size);
  return !!vb && vb.w === w && vb.h === h;
}

/** No raster images, no external references, no scripts, no foreignObject (design 07 §8 keeps the canvas untainted). */
export function isSelfContained(svg: string): boolean {
  if (/<image\b/i.test(svg)) return false;
  if (/<script\b/i.test(svg)) return false;
  if (/<foreignObject\b/i.test(svg)) return false;
  if (/href="(?!#)/i.test(svg)) return false;
  if (/url\((?!#)/i.test(svg)) return false;
  return true;
}

/** The ids reserved by the pipeline; a generator's own ids must not start with them. */
export const RESERVED_ID_PREFIX = 'wp-';
export function usesReservedIds(svg: string): boolean {
  return new RegExp(`id="${RESERVED_ID_PREFIX}`).test(svg);
}

export { SIZES as WALLPAPER_PX };
