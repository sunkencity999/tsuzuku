/**
 * TSUZUKU — the road motif kit (design 09 §7 D, §10 C2): pine ×3, torii ×4,
 * chōchin ×4, pagoda ×2, the Fuji profile, a wave crest, a bridge, a checkpoint
 * gate, a teahouse and an inn — small SVG pictures the Road rows, the Station
 * headpiece and the Dojo's genkan strip share.
 *
 * LIFTED, never redrawn: every motif that already existed as a private
 * function of a kakejiku generator is imported from it (the function was
 * exported in place — fifty-three.ts pine, golden-screen.ts pine,
 * chaya-lanterns.ts pine + chochin, lantern-river.ts torii + lanternMarkup,
 * sakura-storm.ts pagoda, kyoto-arrival.ts pagoda, festival.ts lantern,
 * fuji-ridge.ts fujiProfile, great-wave.ts wave) and the maths is theirs; the
 * wallpapers' snapshots are untouched. The generators paint with hex and with
 * `url(#…)` gradients of their own defs, so a lifted picture is re-palettised
 * by text substitution of exactly those tokens (`PALETTE_SUBST` below) — the
 * geometry is never edited. The bridge, the checkpoint gate, the teahouse, the
 * inn, the straight-lintel and curved-kasagi torii and the torii row exist
 * only inline in their generators, so they are composed here from the shared
 * primitives (`geom.catenary`, `svg.*`) at a few nodes each.
 *
 * Contract: `motif(id, x, y, scale, seed, palette)` → one SVG fragment whose
 * FOOT CENTRE is (x, y) and whose height is `scale` user units (widths vary by
 * motif, ≤ 2.6 × scale for Fuji). Pure: the same arguments give the same
 * string. `MOTIFS[id].nodes` is the exact element count of the fragment
 * (motifs.test.ts asserts it), so a host can budget a row (≤ 40 nodes) or a
 * headpiece (≤ 120) before drawing. `inkWash(markup, colour)` turns any
 * fragment into a one-colour sumi silhouette for towns ahead — no filter.
 */
import { mulberry32 } from '../shared/hash';
import { SUMI } from './color';
import { catenary, type Pt } from './geom';
import { simplex2 } from './noise';
import { L, M, Q, Z, fmt, g, line, path, polyPath, polygon, polyline, rect, url } from './svg';
import { chochin as chayaChochin, pine as chayaPine } from './wallpapers/chaya-lanterns';
import { lantern as festivalLantern } from './wallpapers/festival';
import { pine as fiftyThreePine } from './wallpapers/fifty-three';
import { fujiProfile } from './wallpapers/fuji-ridge';
import { pine as goldenPine } from './wallpapers/golden-screen';
import { wave } from './wallpapers/great-wave';
import { pagoda as kyotoPagoda } from './wallpapers/kyoto-arrival';
import { lanternMarkup, torii as riverTorii } from './wallpapers/lantern-river';
import { pagoda as sakuraPagoda } from './wallpapers/sakura-storm';

/* ────────────────────────────────────────────────────────────────────────── */
/* Palette                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Colours a motif may use. Any CSS colour string: hex in a wallpaper, `var(--kon)` inline on a page. */
export interface MotifPalette {
  /** Sumi — trunks, roofs, posts. */
  ink: string;
  /** Lighter ink — the far ridge, snow shade. */
  wash: string;
  /** Washi — snow, a paper lantern unlit, a plate. */
  paper: string;
  /** Shu — a torii, a noren. */
  accent: string;
  /** Kin — a lit lamp, gilt. */
  gold: string;
  /** Timber. */
  wood: string;
  /** What a lantern body shows: `gold` when lit (Night), `paper` by day. */
  lamp: string;
}

/** The wallpaper palette, for tests and the Studio. */
export const INK_PALETTE: MotifPalette = { ink: '#1A1A1F', wash: '#5E5A52', paper: '#F4EDE0', accent: '#C9302C', gold: '#B8860B', wood: '#5C3A21', lamp: '#F4EDE0' };

/** The page palette: tokens, so one picture follows both themes live (design 09 §2.4). */
export const TOKEN_PALETTE: MotifPalette = {
  ink: 'var(--fg)',
  wash: 'var(--fg-muted)',
  paper: 'var(--surface)',
  accent: 'var(--shu)',
  gold: 'var(--kin)',
  wood: 'var(--wood)',
  lamp: 'var(--surface)',
};

/** The tokens the lifted generators paint with, and the palette slot each becomes. */
const PALETTE_SUBST: readonly (readonly [token: string, slot: keyof MotifPalette | 'none'])[] = [
  [url('cl-glow'), 'none'], // chaya: the lantern's glow disc — the host draws a glow twin or nothing (§1 rule 2)
  [url('cl-paper'), 'lamp'],
  [url('fs-lglow'), 'none'], // festival: the same disc
  [url('glow'), 'none'], // lantern-river
  [url('paper'), 'lamp'],
  ['#101535', 'ink'], // kyoto-arrival DEEP
  [SUMI, 'ink'], // golden-screen trunk, chaya caps, festival caps
  ['#1A1A1F', 'ink'], // INK (festival string)
  ['#F4EDE0', 'paper'], // WASHI (festival white body)
  ['#E63B2E', 'accent'], // festival SHU (PALETTE.dark.shu, the red body)
  ['#C9302C', 'accent'], // festival SHU_DEEP (PALETTE.light.shu, the ribs)
  ['#2A1C12', 'wood'], // chaya TIMBER
  ['#B8692A', 'wood'], // chaya ribs
  ['#4a3320', 'wood'], // lantern-river frame
  ['#241a12', 'wood'],
  ['#3a2a1a', 'wood'],
];

function repaint(markup: string, p: MotifPalette): string {
  let out = markup;
  for (const [token, slot] of PALETTE_SUBST) {
    if (!out.includes(token)) continue;
    out = out.split(token).join(slot === 'none' ? 'none' : p[slot]);
  }
  return out;
}

/** One-colour sumi silhouette of any fragment (towns ahead): every fill and stroke that is not `none` becomes `colour`. */
export function inkWash(markup: string, colour: string): string {
  return markup.replace(/\b(fill|stroke)="(?!none")[^"]*"/g, `$1="${colour}"`);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The kit                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export type MotifId =
  | 'pine-a'
  | 'pine-b'
  | 'pine-c'
  | 'torii-a'
  | 'torii-b'
  | 'torii-c'
  | 'torii-d'
  | 'chochin-a'
  | 'chochin-b'
  | 'chochin-c'
  | 'chochin-d'
  | 'pagoda-a'
  | 'pagoda-b'
  | 'fuji'
  | 'wave'
  | 'bridge'
  | 'gate'
  | 'teahouse'
  | 'inn';

export type MotifFn = (x: number, y: number, scale: number, seed: number, palette: MotifPalette) => string;

export interface MotifDef {
  draw: MotifFn;
  /** Exact element count of one fragment (outer `<g>` included where there is one). */
  nodes: number;
  /** Where the maths lives. */
  source: string;
  /** Width as a multiple of `scale` (for a host laying motifs side by side). */
  aspect: number;
}

/* chaya chochin: string top → foot, in units of its body radius s (its own formula, used for placement only) */
function chayaChochinHeight(s: number): number {
  const cap = Math.max(1.2, s * 0.24);
  return s * 0.45 + cap + 2 * s * 1.22 + cap + s * 0.5;
}

const pineA: MotifFn = (x, y, h, _seed, p) => fiftyThreePine(x, y, h / 1.03, p.ink);
const pineB: MotifFn = (x, y, h, _seed, p) => chayaPine(x, y, h / 1.28, p.ink);
const pineC: MotifFn = (x, y, h, seed, p) => repaint(goldenPine(x - h * 0.2, y, h / 2.05, seed, mulberry32(seed)), p);

const toriiA: MotifFn = (x, y, h, _seed, p) => riverTorii(x, y, h / 1.2, p.accent);
/** Shinmei torii: straight kasagi, two posts, one nuki. */
const toriiB: MotifFn = (x, y, h, _seed, p) => {
  const w = h * 0.9;
  const post = h * 0.08;
  return g({ fill: p.accent }, [
    rect(x - w / 2, y - h * 0.9, post, h * 0.9),
    rect(x + w / 2 - post, y - h * 0.9, post, h * 0.9),
    rect(x - w / 2 - h * 0.1, y - h, w + h * 0.2, post),
    rect(x - w / 2, y - h * 0.68, w, post * 0.8),
  ]);
};
/** Myōjin torii with the upswept kasagi: two leaning posts, the nuki, the curved top. */
const toriiC: MotifFn = (x, y, h, _seed, p) => {
  const w = h * 0.86;
  const post = h * 0.075;
  const top = y - h * 0.86;
  const posts = [-1, 1].map((s) => {
    const xb = x + (s * w) / 2;
    const xt = x + (s * w * 0.94) / 2;
    return polygon([[xb - post / 2, y], [xb + post / 2, y], [xt + post / 2, top], [xt - post / 2, top]]);
  });
  const k0 = x - w / 2 - h * 0.18;
  const k1 = x + w / 2 + h * 0.18;
  const kasagi = path(M(k0, top - h * 0.1) + Q(x, top + h * 0.02, k1, top - h * 0.1) + L(k1, top - h * 0.02) + Q(x, top + h * 0.1, k0, top - h * 0.02) + Z);
  return g({ fill: p.accent }, [...posts, rect(x - w / 2 - h * 0.08, y - h * 0.62, w + h * 0.16, post * 0.9), kasagi]);
};
/** A row of three torii receding (Fushimi): the lifted torii at three scales. */
const toriiD: MotifFn = (x, y, h, _seed, p) =>
  g(undefined, [riverTorii(x - h * 0.42, y, h / 1.2, p.accent), riverTorii(x + h * 0.02, y - h * 0.06, h / 1.5, p.accent), riverTorii(x + h * 0.36, y - h * 0.1, h / 1.9, p.accent)]);

const chochinA: MotifFn = (x, y, h, _seed, p) => {
  const s0 = h / 3.9;
  const s = (s0 * h) / chayaChochinHeight(s0);
  return repaint(chayaChochin({ x, y: y - chayaChochinHeight(s), s, where: 'eaves', t: 0 }, 0), p);
};
const chochinB: MotifFn = (x, y, h, _seed, p) => repaint(festivalLantern(x, y - h, h / 2.25, false), p);
const chochinC: MotifFn = (x, y, h, _seed, p) => repaint(festivalLantern(x, y - h, h / 2.25, true), p);
const chochinD: MotifFn = (x, y, h, _seed, p) => {
  const s = h / 1.5;
  return repaint(lanternMarkup({ x, y: y - s * 0.18, s, u: 1 }, false, p.accent).front, p);
};

const pagodaA: MotifFn = (x, y, h, _seed, p) => sakuraPagoda(x, y, h / 1.02, 3, p.ink, p.gold);
const pagodaB: MotifFn = (x, y, h, _seed, p) => repaint(kyotoPagoda(x, y, h / 1.16), p);

/** Fuji: the fuji-ridge envelope sampled into one closed path, with its snow cap. */
const fuji: MotifFn = (x, y, h, _seed, p) => {
  const half = h * 1.3;
  const N = 32;
  const ridge: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * 2 - 1;
    ridge.push([x + u * half, y - h * fujiProfile(u)]);
  }
  const snow: Pt[] = ridge.filter(([, py]) => y - py > h * 0.72);
  const cap: Pt[] = snow.length > 1 ? [...snow, [snow[snow.length - 1]![0], y - h * 0.62], [x, y - h * 0.56], [snow[0]![0], y - h * 0.62]] : [];
  return g(undefined, [path(polyPath([...ridge, [x + half, y], [x - half, y]], true), { fill: p.ink }), cap.length ? path(polyPath(cap, true), { fill: p.paper }) : '']);
};

/** The great-wave crest: its outline in a local box, translated to the foot. */
const waveCrest: MotifFn = (x, y, h, seed, p) => {
  const w = h * 2.2;
  const wob = simplex2(seed);
  const out = wave([w * 0.42, h * 0.1], h * 0.32, h * 0.72, w * 0.02, w, h, (a, b) => wob(a, b));
  const pts = out.outline.filter(([, py]) => py <= h + 4).map(([px, py]) => [px, Math.min(py, h)] as Pt);
  return g({ transform: `translate(${fmt(x - w / 2)} ${fmt(y - h)})` }, path(polyPath(pts, true), { fill: p.ink }));
};

/** A wooden arch bridge: the `catenary` hung upside down is the deck, two piers, one rail. */
const bridge: MotifFn = (x, y, h, _seed, p) => {
  const w = h * 2.4;
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const deck = catenary(x0, x1, y - h * 0.3, -h * 0.35, 14);
  const rail = deck.map(([px, py]) => [px, py - h * 0.22] as Pt);
  return g(undefined, [
    polyline(deck, { fill: 'none', stroke: p.wood, 'stroke-width': h * 0.12, 'stroke-linecap': 'round' }),
    polyline(rail, { fill: 'none', stroke: p.wood, 'stroke-width': h * 0.04 }),
    rect(x - w * 0.22, y - h * 0.42, h * 0.08, h * 0.42, { fill: p.wood }),
    rect(x + w * 0.22 - h * 0.08, y - h * 0.42, h * 0.08, h * 0.42, { fill: p.wood }),
  ]);
};

/** A sekisho checkpoint gate: two posts, a lintel, a tiled roof, the barred door. */
const gate: MotifFn = (x, y, h, _seed, p) => {
  const w = h * 1.2;
  const post = h * 0.1;
  return g(undefined, [
    rect(x - w / 2, y - h * 0.78, post, h * 0.78, { fill: p.wood }),
    rect(x + w / 2 - post, y - h * 0.78, post, h * 0.78, { fill: p.wood }),
    rect(x - w / 2, y - h * 0.82, w, post * 0.7, { fill: p.wood }),
    polygon([[x - w * 0.62, y - h * 0.78], [x - w * 0.36, y - h], [x + w * 0.36, y - h], [x + w * 0.62, y - h * 0.78]], { fill: p.ink }),
    rect(x - w * 0.3, y - h * 0.7, w * 0.6, h * 0.7, { fill: p.wash, opacity: 0.6 }),
  ]);
};

/** A roadside teahouse: raised floor, posts, thatched roof, the noren in shu, a bench. */
const teahouse: MotifFn = (x, y, h, _seed, p) => {
  const w = h * 1.5;
  const eaves = y - h * 0.55;
  return g(undefined, [
    rect(x - w / 2, y - h * 0.1, w, h * 0.1, { fill: p.wood }),
    rect(x - w * 0.42, eaves, h * 0.05, h * 0.45, { fill: p.wood }),
    rect(x + w * 0.42 - h * 0.05, eaves, h * 0.05, h * 0.45, { fill: p.wood }),
    polygon([[x - w * 0.56, eaves], [x - w * 0.32, y - h], [x + w * 0.32, y - h], [x + w * 0.56, eaves]], { fill: p.ink }),
    rect(x - w * 0.18, eaves + h * 0.02, w * 0.36, h * 0.2, { fill: p.accent }),
    rect(x - w * 0.36, y - h * 0.22, w * 0.22, h * 0.04, { fill: p.wood }),
  ]);
};

/** A hatago inn: two storeys under a tiled roof, two lit windows and the sign board. */
const inn: MotifFn = (x, y, h, _seed, p) => {
  const w = h * 1.3;
  return g(undefined, [
    rect(x - w / 2, y - h * 0.8, w, h * 0.8, { fill: p.wood }),
    polygon([[x - w * 0.58, y - h * 0.78], [x - w * 0.44, y - h], [x + w * 0.44, y - h], [x + w * 0.58, y - h * 0.78]], { fill: p.ink }),
    rect(x - w * 0.34, y - h * 0.68, w * 0.22, h * 0.18, { fill: p.lamp }),
    rect(x + w * 0.12, y - h * 0.68, w * 0.22, h * 0.18, { fill: p.lamp }),
    rect(x - w * 0.1, y - h * 0.4, w * 0.2, h * 0.3, { fill: p.paper }),
  ]);
};

export const MOTIFS: Record<MotifId, MotifDef> = {
  'pine-a': { draw: pineA, nodes: 4, source: 'wallpapers/fifty-three.ts pine', aspect: 1.0 },
  'pine-b': { draw: pineB, nodes: 5, source: 'wallpapers/chaya-lanterns.ts pine', aspect: 0.8 },
  'pine-c': { draw: pineC, nodes: 43, source: 'wallpapers/golden-screen.ts pine', aspect: 1.1 },
  'torii-a': { draw: toriiA, nodes: 5, source: 'wallpapers/lantern-river.ts torii', aspect: 1.0 },
  'torii-b': { draw: toriiB, nodes: 5, source: 'motifs.ts (shinmei, svg primitives)', aspect: 1.1 },
  'torii-c': { draw: toriiC, nodes: 5, source: 'motifs.ts (myōjin kasagi, svg primitives)', aspect: 1.2 },
  'torii-d': { draw: toriiD, nodes: 16, source: 'wallpapers/lantern-river.ts torii ×3', aspect: 1.6 },
  'chochin-a': { draw: chochinA, nodes: 10, source: 'wallpapers/chaya-lanterns.ts chochin', aspect: 0.55 },
  'chochin-b': { draw: chochinB, nodes: 8, source: 'wallpapers/festival.ts lantern (shu)', aspect: 0.7 },
  'chochin-c': { draw: chochinC, nodes: 8, source: 'wallpapers/festival.ts lantern (washi)', aspect: 0.7 },
  'chochin-d': { draw: chochinD, nodes: 7, source: 'wallpapers/lantern-river.ts lanternMarkup', aspect: 0.9 },
  'pagoda-a': { draw: pagodaA, nodes: 25, source: 'wallpapers/sakura-storm.ts pagoda (3 tiers)', aspect: 0.7 },
  'pagoda-b': { draw: pagodaB, nodes: 19, source: 'wallpapers/kyoto-arrival.ts pagoda', aspect: 0.9 },
  fuji: { draw: fuji, nodes: 3, source: 'wallpapers/fuji-ridge.ts fujiProfile', aspect: 2.6 },
  wave: { draw: waveCrest, nodes: 2, source: 'wallpapers/great-wave.ts wave', aspect: 2.2 },
  bridge: { draw: bridge, nodes: 5, source: 'motifs.ts (geom.catenary)', aspect: 2.4 },
  gate: { draw: gate, nodes: 6, source: 'motifs.ts (svg primitives)', aspect: 1.3 },
  teahouse: { draw: teahouse, nodes: 7, source: 'motifs.ts (svg primitives)', aspect: 1.6 },
  inn: { draw: inn, nodes: 6, source: 'motifs.ts (svg primitives)', aspect: 1.3 },
};

export const MOTIF_IDS = Object.keys(MOTIFS) as MotifId[];

/** One motif, foot centre at (x, y), `scale` tall. */
export function motif(id: MotifId, x: number, y: number, scale: number, seed: number, palette: MotifPalette = TOKEN_PALETTE): string {
  return MOTIFS[id].draw(x, y, scale, seed, palette);
}

/** Documented node count of a motif (what `motifs.test.ts` pins). */
export function motifNodes(id: MotifId): number {
  return MOTIFS[id].nodes;
}

/** Element count of an SVG fragment without a parser (a quick budget check): opening tags. */
export function countNodes(markup: string): number {
  return (markup.match(/<[a-zA-Z]/g) ?? []).length;
}
