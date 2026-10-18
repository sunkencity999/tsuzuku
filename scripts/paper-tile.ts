/**
 * TSUZUKU — the `--paper` grain tile (design 09 §2.3, §4.1; owner A1).
 *
 *   node scripts/paper-tile.ts            prints the CSS to paste into tokens.css
 *   node scripts/paper-tile.ts --stats    also prints the alpha histogram
 *
 * One static 128 px `feTurbulence` tile (fractalNoise, baseFrequency .9,
 * 2 octaves, `stitchTiles="stitch"` so it repeats seamlessly), exported once
 * as an SVG data URI and pasted into `tokens.css` as `--paper`. It is a
 * background image, never a live filter: `body::before` and `.sheet::before`
 * paint it at `--paper-opacity`.
 *
 * The tile is mid-grey (#808080 in sRGB) at a noise-driven alpha, like
 * `src/art/pixel.ts grainFilter`. The colour matrix here differs from
 * grainFilter's in one row: alpha is `2·n − 0.9` instead of `0.9·n`, so the
 * noise reads as *specks* (a sparse alpha, mean ≈ .16, a third of the pixels
 * clear) rather than a grey veil. With grainFilter's row the mean alpha is
 * ≈ .45 and `--fg-muted` on `--bg` loses ≈ .14 of contrast at
 * `--paper-opacity: .055` — over the < .1 ceiling §2.3 sets; the speck row
 * keeps the visible texture (the alpha *variance*) and holds the shift at
 * ≈ .05 in both themes. `tokens.test.ts` reads the mean from the comment this
 * script writes beside the data URI, so the two never drift apart.
 *
 * The mean alpha is computed, not estimated: `fractalNoise` below is a port
 * of the SVG 1.1 reference implementation (the Perlin lattice, the LCG seed
 * sequence and the stitching adjustment), evaluated at every pixel of the
 * tile exactly as a renderer does.
 */
import { el, filter, rect, svgDataUrl } from '../src/art/svg.ts';

export const TILE = 128;
export const BASE_FREQUENCY = 0.9;
export const OCTAVES = 2;
export const SEED = 7;
/** sRGB grey of every speck (the colour matrix writes 0.5 into R, G and B). */
export const PAPER_GREY = 0x80;
/** Alpha row of the colour matrix: alpha' = ALPHA_GAIN · noise + ALPHA_OFFSET, clamped to [0, 1]. */
export const ALPHA_GAIN = 2;
export const ALPHA_OFFSET = -0.9;

/* ── SVG 1.1 feTurbulence reference implementation, ported ──────────────── */

const BSize = 0x100;
const BM = 0xff;
const PerlinN = 0x1000;
const RAND_m = 2147483647;
const RAND_a = 16807;
const RAND_q = 127773;
const RAND_r = 2836;

function setupSeed(seed: number): number {
  let s = Math.trunc(seed);
  if (s <= 0) s = -(s % (RAND_m - 1)) + 1;
  if (s > RAND_m - 1) s = RAND_m - 1;
  return s;
}
function nextRandom(seed: number): number {
  let result = RAND_a * (seed % RAND_q) - RAND_r * Math.trunc(seed / RAND_q);
  if (result <= 0) result += RAND_m;
  return result;
}

interface Lattice {
  selector: Int32Array;
  gradient: Float64Array[]; // [channel] → (BSize + BSize + 2) * 2
}

function initLattice(seedIn: number): Lattice {
  const selector = new Int32Array(BSize + BSize + 2);
  const gradient = [0, 1, 2, 3].map(() => new Float64Array((BSize + BSize + 2) * 2));
  let seed = setupSeed(seedIn);
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < BSize; i++) {
      selector[i] = i;
      for (let j = 0; j < 2; j++) {
        seed = nextRandom(seed);
        gradient[k]![i * 2 + j] = ((seed % (BSize + BSize)) - BSize) / BSize;
      }
      const gx = gradient[k]![i * 2]!;
      const gy = gradient[k]![i * 2 + 1]!;
      const s = Math.sqrt(gx * gx + gy * gy);
      gradient[k]![i * 2] = gx / s;
      gradient[k]![i * 2 + 1] = gy / s;
    }
  }
  for (let i = BSize - 1; i > 0; i--) {
    const k = selector[i]!;
    seed = nextRandom(seed);
    const j = seed % BSize;
    selector[i] = selector[j]!;
    selector[j] = k;
  }
  for (let i = 0; i < BSize + 2; i++) {
    selector[BSize + i] = selector[i]!;
    for (let k = 0; k < 4; k++) {
      gradient[k]![(BSize + i) * 2] = gradient[k]![i * 2]!;
      gradient[k]![(BSize + i) * 2 + 1] = gradient[k]![i * 2 + 1]!;
    }
  }
  return { selector, gradient };
}

interface Stitch {
  width: number;
  height: number;
  wrapX: number;
  wrapY: number;
}

const sCurve = (t: number): number => t * t * (3 - 2 * t);
const lerp = (t: number, a: number, b: number): number => a + t * (b - a);

function noise2(lat: Lattice, channel: number, vx: number, vy: number, st: Stitch | null): number {
  let t = vx + PerlinN;
  let bx0 = Math.trunc(t) & BM;
  let bx1 = (bx0 + 1) & BM;
  const rx0 = t - Math.trunc(t);
  const rx1 = rx0 - 1;
  t = vy + PerlinN;
  let by0 = Math.trunc(t) & BM;
  let by1 = (by0 + 1) & BM;
  const ry0 = t - Math.trunc(t);
  const ry1 = ry0 - 1;
  if (st) {
    if (bx0 >= st.wrapX) bx0 -= st.width;
    if (bx1 >= st.wrapX) bx1 -= st.width;
    if (by0 >= st.wrapY) by0 -= st.height;
    if (by1 >= st.wrapY) by1 -= st.height;
  }
  bx0 &= BM;
  bx1 &= BM;
  by0 &= BM;
  by1 &= BM;
  const i = lat.selector[bx0]!;
  const j = lat.selector[bx1]!;
  const b00 = lat.selector[i + by0]!;
  const b10 = lat.selector[j + by0]!;
  const b01 = lat.selector[i + by1]!;
  const b11 = lat.selector[j + by1]!;
  const sx = sCurve(rx0);
  const sy = sCurve(ry0);
  const g = lat.gradient[channel]!;
  let u = rx0 * g[b00 * 2]! + ry0 * g[b00 * 2 + 1]!;
  let v = rx1 * g[b10 * 2]! + ry0 * g[b10 * 2 + 1]!;
  const a = lerp(sx, u, v);
  u = rx0 * g[b01 * 2]! + ry1 * g[b01 * 2 + 1]!;
  v = rx1 * g[b11 * 2]! + ry1 * g[b11 * 2 + 1]!;
  const b = lerp(sx, u, v);
  return lerp(sy, a, b);
}

/** Stitch-adjusted base frequency: the nearest k / tile so the lattice wraps at the tile edge. */
export function stitchedFrequency(freq: number, tile: number): number {
  if (freq === 0) return 0;
  const lo = Math.floor(tile * freq) / tile;
  const hi = Math.ceil(tile * freq) / tile;
  return freq / lo < hi / freq ? lo : hi;
}

/**
 * `fractalNoise` for one channel at user-space `(x, y)` inside a `tile × tile`
 * primitive subregion at the origin, with `stitchTiles="stitch"`. Returns the
 * renderer's channel value in [0, 1] ((sum + 1) / 2, clamped).
 */
export function fractalNoise(lat: Lattice, channel: number, x: number, y: number, freq: number, octaves: number, tile: number): number {
  const f = stitchedFrequency(freq, tile);
  const st: Stitch = {
    width: Math.trunc(tile * f + 0.5),
    height: Math.trunc(tile * f + 0.5),
    wrapX: 0,
    wrapY: 0,
  };
  st.wrapX = 0 * f + PerlinN + st.width;
  st.wrapY = 0 * f + PerlinN + st.height;
  let vx = x * f;
  let vy = y * f;
  let ratio = 1;
  let sum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(lat, channel, vx, vy, st) / ratio;
    vx *= 2;
    vy *= 2;
    ratio *= 2;
    st.width *= 2;
    st.wrapX = 2 * st.wrapX - PerlinN;
    st.height *= 2;
    st.wrapY = 2 * st.wrapY - PerlinN;
  }
  const v = (sum + 1) / 2;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* ── the tile ───────────────────────────────────────────────────────────── */

export interface TileStats {
  /** Mean of the tile's final alpha (after the colour matrix), 0–1. */
  meanAlpha: number;
  /** Share of pixels whose alpha is exactly 0. */
  clearShare: number;
  maxAlpha: number;
  histogram: number[];
}

/** Evaluates the tile at pixel centres (channel 3 = alpha, as feColorMatrix reads it). */
export function tileStats(seed = SEED, gain = ALPHA_GAIN, offset = ALPHA_OFFSET): TileStats {
  const lat = initLattice(seed);
  const bins = 10;
  const histogram = new Array<number>(bins).fill(0);
  let sum = 0;
  let clear = 0;
  let max = 0;
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const n = fractalNoise(lat, 3, px + 0.5, py + 0.5, BASE_FREQUENCY, OCTAVES, TILE);
      let a = gain * n + offset;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      sum += a;
      if (a === 0) clear++;
      if (a > max) max = a;
      histogram[Math.min(bins - 1, Math.floor(a * bins))]!++;
    }
  }
  const count = TILE * TILE;
  return { meanAlpha: sum / count, clearShare: clear / count, maxAlpha: max, histogram };
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The SVG markup of the tile. */
export function paperTileSvg(): string {
  const grey = num(PAPER_GREY / 255);
  const matrix = `0 0 0 0 ${grey}  0 0 0 0 ${grey}  0 0 0 0 ${grey}  0 0 0 ${num(ALPHA_GAIN)} ${num(ALPHA_OFFSET)}`;
  const f = filter(
    'g',
    [
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: BASE_FREQUENCY, numOctaves: OCTAVES, seed: SEED, stitchTiles: 'stitch' }),
      el('feColorMatrix', { type: 'matrix', values: matrix }),
    ],
    { x: 0, y: 0, width: TILE, height: TILE, filterUnits: 'userSpaceOnUse' },
  );
  return el('svg', { xmlns: 'http://www.w3.org/2000/svg', width: TILE, height: TILE }, [f, rect(0, 0, TILE, TILE, { filter: 'url(#g)' })]);
}

/** The `--paper` value: `url("data:image/svg+xml,…")`. */
export function paperTileCss(): string {
  return `url("${svgDataUrl(paperTileSvg())}")`;
}

/** The two lines pasted into tokens.css (the comment is what tokens.test.ts parses). */
export function paperTileDeclaration(stats = tileStats()): string {
  return [
    `  /* paper-tile: grey ${PAPER_GREY} at mean alpha ${stats.meanAlpha.toFixed(4)} (scripts/paper-tile.ts, seed ${SEED}) */`,
    `  --paper: ${paperTileCss()};`,
  ].join('\n');
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const stats = tileStats();
  const css = paperTileCss();
  process.stdout.write(paperTileDeclaration(stats) + '\n');
  process.stdout.write(`/* data URI: ${css.length} bytes; max alpha ${stats.maxAlpha.toFixed(3)}; clear pixels ${(stats.clearShare * 100).toFixed(1)}% */\n`);
  if (process.argv.includes('--stats')) {
    stats.histogram.forEach((n, i) => process.stdout.write(`  alpha ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${n}\n`));
  }
}
