/**
 * TSUZUKU — the Road row's pictures (design 09 §7 D beat 1,500; §10 C2).
 *
 *  rowMotif(n, maxNodes)   the vista's lightest motif within a node budget
 *  rowVignette(n, state)   inner markup of a row's `viewBox="0 0 48 40"`
 *                          vignette: one kit motif on the --road band; towns
 *                          ahead are an ink wash in --hai (no filter, never grey
 *                          "locked" — the row's English word says `ahead`)
 *  bandVignette(n)         the current row's 160 px bokashi band at ≥ 600 px:
 *                          a far ridge and the vista's first two motifs
 *  lanternMark(lit)        the current station's chōchin for a 32 × 32 marker;
 *                          gold when lit (Night), paper by day — the glow twin
 *                          is the host's `::before` (--glow-kin, Night only)
 * Every picture is a pure string of the station number: no seed changes value.
 */
import { hashSeed } from '../../shared/hash';
import { ridge } from '../noise';
import { MOTIFS, TOKEN_PALETTE, inkWash, motif, type MotifId, type MotifPalette } from '../motifs';
import { polygon } from '../svg';
import { END_MOTIF, vistaOf } from './vistas';

export type RowState = 'cleared' | 'current' | 'ahead';

/** A row's vignette never spends more than this on its motif (rows stay ≤ 40 nodes). */
export const ROW_MAX_NODES = 12;

/** The main motif of the vista within `maxNodes`, the next lighter one when the main is heavy, `pine-a` when none fits. */
export function rowMotif(station: number, maxNodes = ROW_MAX_NODES): MotifId {
  const v = vistaOf(station);
  if (!v) return END_MOTIF;
  return v.motifs.find((id) => MOTIFS[id].nodes <= maxNodes) ?? 'pine-a';
}

/** The page palette with the lamp lit or not. */
export function rowPalette(lit: boolean): MotifPalette {
  return { ...TOKEN_PALETTE, lamp: lit ? TOKEN_PALETTE.gold : TOKEN_PALETTE.paper };
}

export interface VignetteOptions {
  w?: number;
  h?: number;
  /** Lanterns lit (Arcade Night). */
  lit?: boolean;
  /** Node budget for the motif (the genkan strip asks for ≤ 6). */
  maxNodes?: number;
}

/** Inner markup for a `viewBox="0 0 w h"` vignette. */
export function rowVignette(station: number, state: RowState, o: VignetteOptions = {}): string {
  const w = o.w ?? 48;
  const h = o.h ?? 40;
  const id = rowMotif(station, o.maxNodes ?? ROW_MAX_NODES);
  const def = MOTIFS[id];
  const scale = Math.min(h * 0.78, (w * 0.92) / def.aspect);
  const m = motif(id, w / 2, h - 3, scale, station, rowPalette(o.lit ?? false));
  return state === 'ahead' ? inkWash(m, 'var(--hai)') : m;
}

/** The current row's band: `viewBox="0 0 w h"` (default 160 × 160). */
export function bandVignette(station: number, o: VignetteOptions = {}): string {
  const w = o.w ?? 160;
  const h = o.h ?? 160;
  const v = vistaOf(station);
  const motifs = v ? v.motifs : [END_MOTIF];
  const hs = ridge(hashSeed('band', station), 16, h * 0.14, { roughness: 0.3 });
  const horizon = h * 0.7;
  const far = polygon([[-2, horizon + 1], ...hs.map((y, i) => [(i / (hs.length - 1)) * w, horizon - y] as [number, number]), [w + 2, horizon + 1]], { fill: 'var(--kon)', opacity: 0.3 });
  const pal = rowPalette(o.lit ?? false);
  const main = motifs[0] ?? END_MOTIF;
  const mainScale = Math.min(h * 0.42, (w * 0.6) / MOTIFS[main].aspect);
  const parts = [far, motif(main, w * 0.56, h * 0.9, mainScale, station, pal)];
  const second = motifs[1];
  if (second) parts.push(motif(second, w * 0.2, h * 0.92, Math.min(h * 0.22, (w * 0.3) / MOTIFS[second].aspect), station + 1, pal));
  return parts.join('');
}

/**
 * The chōchin marker of the current station (chaya-lanterns' lantern, 10 nodes) for a 32 × 32 box. Without `lit` the
 * lamp reads the host's `--lamp` custom property (paper by default), so lighting it is a CSS change the host may
 * transition (fill, ≤ --dur-2, design 09 §6.7 rule 1) rather than a string swap.
 */
export function lanternMark(lit?: boolean): string {
  const pal = lit === undefined ? { ...TOKEN_PALETTE, lamp: 'var(--lamp, var(--surface))' } : rowPalette(lit);
  return motif('chochin-a', 16, 30, 27, 0, pal);
}
