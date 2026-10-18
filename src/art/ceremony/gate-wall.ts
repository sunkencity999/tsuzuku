/**
 * TSUZUKU — the Gatekeeper's stone wall (design 09 §9 "Ceremonies, gates,
 * arcade", §10 D1): the wall is STONE — a Bayer dither tile from pixel.ts
 * rendered ONCE as a data URL (a static image, never a live filter) — and it
 * is chipped by `geom.shatter`: one Voronoi piece per clean rep, each piece a
 * `<polygon>` the view moves with transform / opacity only. Imported
 * statically by `src/session/GateView.tsx` (the art tier is open to every
 * group, design 09 §12.1 d44 / d49), so the wall is stone from its first frame.
 * The tile is a CSS `background-image` on the unscaled track — never on the
 * scaleX'd fill, where it would squash — and the pieces are flat polygons.
 */
import { STONE, STONE_DARK } from '../color';
import { centroid, shatter, type Pt } from '../geom';
import { ditherPattern } from '../pixel';
import { points, rect, svgDataUrl, svgDoc, url } from '../svg';

/** The wall's drawing space (stretched to the track with preserveAspectRatio none). */
export const WALL_W = 100;
export const WALL_H = 12;
/** ≤ 12 extra nodes for a full wall: one svg + 8 polygons = 9 (the stone tile is a CSS background, 0 nodes). */
export const WALL_MAX_PIECES = 8;

/** A 16 px stone tile: grey stone under an ordered dither, as a data URL for `background-image`. */
export function wallStoneUrl(theme: 'light' | 'dark' = 'light'): string {
  const t = 16;
  const id = 'gw-dither';
  return svgDataUrl(
    svgDoc({
      w: t,
      h: t,
      defs: [ditherPattern(id, 2, { n: 4, color: '#000', strength: theme === 'dark' ? 0.42 : 0.3 })],
      body: [rect(0, 0, t, t, { fill: theme === 'dark' ? STONE_DARK : STONE }), rect(0, 0, t, t, { fill: url(id) })],
      attrs: { 'aria-hidden': 'true' },
    }),
  );
}

/**
 * The wall shattered into `n` pieces (seeded, deterministic), as `points`
 * strings ordered right to left — the rightmost piece falls first, following
 * the meter's fill as it shrinks from the right.
 */
export function wallPieces(seed: number, n: number): string[] {
  const count = Math.max(1, Math.min(WALL_MAX_PIECES, Math.round(n)));
  const poly: Pt[] = [
    [0, 0],
    [WALL_W, 0],
    [WALL_W, WALL_H],
    [0, WALL_H],
  ];
  return shatter(seed >>> 0, poly, count)
    .map((cell) => ({ cell, x: centroid(cell)[0] }))
    .sort((a, b) => b.x - a.x)
    .map((c) => points(c.cell));
}
