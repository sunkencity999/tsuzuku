/**
 * TSUZUKU — the 160 px Station headpiece (design 09 §7 D, §10 C2; §12.1
 * decision 6: the Hara snapshot is the go/no-go for any later emaki).
 *
 * One `<svg>` string per (station, width, theme, reduced):
 *   sky        the vista's pigment in print bands (rects, stepped opacity —
 *              fuji-ridge.ts's bokashi idea; Night bands are deeper)
 *   far ridge  `noise.ridge`, one polygon in --kon
 *   vista      the station's motifs from `vistas.ts` (the main one centred —
 *              Fuji for Hara), the second left, the third right at ≥ 560 px
 *   ahead      the next one or two towns, small on the horizon, through the
 *              page's ONE `sumiFilter` def (`hp-sumi`, spec.ts) applied to the
 *              group — a single live filter — titled with the word `ahead`
 *   keeper     a `dryBrush` silhouette (brush.ts) in two layers: the ink wash
 *              stays, the toned layer rises over it (`.headpiece__tone`:
 *              nijimi keyframes at --dur-4, opacity/translate only; reduced
 *              motion gets the final layer and no class)
 *   road       the surface in --road, an edge in --line
 * Colours are tokens (`var(--…)`) so the one picture follows both themes live;
 * `theme` decides what tokens cannot — the band depth, the lit lamps, and the
 * filter's ink/paper (filter tables need numbers: `PALETTE[theme]`).
 * No text (the HTML `.sign--head` beside it carries 第N宿 and the name), so
 * no font or kanji enters this file. ≤ 120 nodes (headpiece.test.ts).
 */
import { hashSeed } from '../../shared/hash';
import { PRESSURE, dryBrush } from '../brush';
import { PALETTE, type Theme } from '../color';
import { type Pt } from '../geom';
import { ridge } from '../noise';
import { MOTIFS, motif } from '../motifs';
import { circle, el, g, line, polygon, rect } from '../svg';
import { sumiFilter } from '../wallpapers/spec';
import { rowMotif, rowPalette } from './row';
import { S, fill } from './strings';
import { vistaOf, type PaletteHint } from './vistas';

export const HEADPIECE_HEIGHT = 160;
export const HEADPIECE_MIN_WIDTH = 280;
export const HEADPIECE_MAX_WIDTH = 720;
export const HEADPIECE_MAX_NODES = 120;
/** The page's one sumi filter def (design 09 §6.7 rule 2). */
export const SUMI_FILTER_ID = 'hp-sumi';
/** From this width the third motif and the second town ahead appear. */
export const HEADPIECE_WIDE = 560;

export interface HeadpieceOptions {
  station: number;
  /** Rendered width in CSS px; clamped to 280–720 and snapped to 40. */
  width: number;
  theme: Theme;
  reduced: boolean;
}

const PIGMENT: Record<PaletteHint, string> = {
  kon: 'var(--kon)',
  sakura: 'var(--sakura)',
  matcha: 'var(--matcha)',
  kin: 'var(--kin)',
  ai: 'var(--ai)',
  sumi: 'var(--fg-muted)',
};

/** Width the composition is drawn at for a measured box (0 = unknown → the widest). */
export function headpieceWidth(measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return HEADPIECE_MAX_WIDTH;
  const snapped = Math.round(measured / 40) * 40;
  return Math.max(HEADPIECE_MIN_WIDTH, Math.min(HEADPIECE_MAX_WIDTH, snapped));
}

/** The keeper: a brushed body, a head and a kasa — `tone` names the layer's class. */
function keeper(x: number, foot: number, fillColour: string, cls: string | undefined, seed: number, opacity: number): string {
  const spine: Pt[] = [
    [x, foot],
    [x + 0.8, foot - 22],
    [x - 0.6, foot - 44],
  ];
  const body = dryBrush(spine, { width: 15, pressure: PRESSURE.swell, seed, fill: fillColour, hairs: 5, hairWidth: 0.7, gap: 0.25 });
  const head = circle(x - 0.4, foot - 51, 5.2, { fill: fillColour });
  const kasa = polygon([[x - 13, foot - 52], [x + 12, foot - 52], [x - 0.5, foot - 61]], { fill: fillColour });
  return g({ class: cls, opacity: opacity === 1 ? undefined : opacity }, [body, head, kasa]);
}

/** The full `<svg>` of a station's headpiece. */
export function headpiece(o: HeadpieceOptions): string {
  const W = headpieceWidth(o.width);
  const H = HEADPIECE_HEIGHT;
  const night = o.theme === 'dark';
  const v = vistaOf(o.station);
  const pigment = PIGMENT[v?.palette ?? 'kon'];
  const horizon = 112;
  const roadTop = 132;
  const pal = rowPalette(night);
  const parts: string[] = [];

  /* sky: print bands */
  const bands: string[] = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) ** 1.3;
    const t1 = ((i + 1) / N) ** 1.3;
    const y0 = horizon * t0;
    const y1 = horizon * t1;
    const op = night ? 0.52 * (1 - i / N) + 0.1 : 0.24 * (1 - i / N) + 0.04;
    bands.push(rect(0, y0, W, y1 - y0 + 1, { fill: pigment, opacity: Math.round(op * 100) / 100 }));
  }
  parts.push(g({ 'shape-rendering': 'crispEdges' }, bands));

  /* the far ridge */
  const hs = ridge(hashSeed('hp', o.station), 28, 30, { roughness: 0.3 });
  parts.push(polygon([[-2, horizon + 1], ...hs.map((y, i) => [(i / (hs.length - 1)) * W, horizon - y] as Pt), [W + 2, horizon + 1]], { fill: 'var(--kon)', opacity: night ? 0.55 : 0.3 }));

  /* the vista */
  const motifs = v ? v.motifs : ['bridge' as const];
  const main = motifs[0]!;
  const mainScale = Math.min(main === 'fuji' ? 80 : 64, (W * 0.5) / MOTIFS[main].aspect);
  parts.push(motif(main, W * 0.5, horizon + 8, mainScale, o.station, pal));
  const second = motifs[1];
  if (second) parts.push(motif(second, W * 0.2, horizon + 16, Math.min(44, (W * 0.22) / MOTIFS[second].aspect), o.station + 100, pal));
  const third = motifs[2];
  if (third && W >= HEADPIECE_WIDE) parts.push(motif(third, W * 0.78, horizon + 14, Math.min(40, (W * 0.2) / MOTIFS[third].aspect), o.station + 200, pal));

  /* towns ahead on the horizon, through the one sumi filter */
  const ahead: string[] = [];
  const count = W >= 420 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const n = o.station + 1 + i;
    if (n > 53) break;
    const id = rowMotif(n, 8);
    ahead.push(motif(id, W - 34 - i * 52, horizon - 1, Math.min(22, 26 / MOTIFS[id].aspect), n, pal));
  }
  if (ahead.length > 0) parts.push(g({ class: 'headpiece__ahead', 'data-state': 'ahead', filter: `url(#${SUMI_FILTER_ID})` }, [el('title', undefined, S.ahead), ...ahead]));

  /* the road and the keeper on it */
  parts.push(rect(0, roadTop, W, H - roadTop, { fill: 'var(--road)' }));
  parts.push(line(0, roadTop, W, roadTop, { stroke: 'var(--line)', 'stroke-width': 1 }));
  const kx = main === 'fuji' || main === 'wave' ? W * 0.34 : W * 0.66;
  const seed = hashSeed('keeper', o.station);
  parts.push(keeper(kx, H - 8, 'var(--fg-muted)', 'headpiece__wash', seed, 0.4));
  parts.push(keeper(kx, H - 8, 'var(--fg)', o.reduced ? 'headpiece__keeper' : 'headpiece__keeper headpiece__tone', seed, 1));

  const defs = el('defs', undefined, sumiFilter(SUMI_FILTER_ID, { ink: PALETTE[o.theme]['fg-muted'], paper: PALETTE[o.theme].bg }));
  return el(
    'svg',
    {
      class: 'headpiece__svg',
      viewBox: `0 0 ${W} ${H}`,
      width: '100%',
      height: H,
      preserveAspectRatio: 'xMidYMid slice',
      'aria-hidden': 'true',
      focusable: 'false',
      'data-theme': o.theme,
      'data-reduced': o.reduced ? '' : undefined,
      xmlns: 'http://www.w3.org/2000/svg',
    },
    [defs, ...parts],
  );
}

/** The accessible description of a station's headpiece ("Fuji view. Fuji at its tallest…"), `''` off the road. */
export function headpieceLabel(station: number): string {
  const v = vistaOf(station);
  return v ? fill(S.headpieceLabel, { name: v.name, note: v.note }) : '';
}
