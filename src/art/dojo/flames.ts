/**
 * TSUZUKU — flames of the dojo.
 *
 *  flamesSvg(o)   言霊 Kotodama: one spirit flame per Black-belt item, colored
 *                 by item category, drifting on a seeded noise field. At most
 *                 `max` (default `FLAME_CAP` = 400) are rendered; `total` is
 *                 the true count for the counter. Each flame is ONE `<use>` of
 *                 a shared `<symbol>` (halo + body + core live inside the
 *                 symbol, so glow costs no DOM nodes and no filter). Only the
 *                 first `WILL_CHANGE_CAP` (24) carry `will-change: transform`
 *                 (design 09 §6.7 rule 3).
 *  hearthSvg(o)   the Tsuzuku Flame as the dojo's hearth (irori). Since design
 *                 09 (§7 C, §10 B1) the string carries EVERY state's fire —
 *                 three embers, four tongues (outer + core), two glows, the
 *                 freeze crystal — and the host flips the state BY CLASS on the
 *                 `.dj-hf` group (`dj-hf--unlit | --ember | --steady | --roaring`,
 *                 `dj-hf--crystal`); DojoScene.css shows the right parts and
 *                 grows the tongues (scaleY 0 → 1 on --spring). The string
 *                 never changes with the state, so a relight is a class flip,
 *                 not an innerHTML swap. The tongue shape is `shared/ui/Lantern
 *                 tonguePath`, so hearth and header share one tongue.
 *
 * Motion is CSS only (transform keyframes in an inline `<style>`; no SMIL),
 * never faster than ~0.7 Hz, and absent altogether when `reducedMotion` is
 * set; the emitted CSS also obeys `prefers-reduced-motion` and the host's
 * `.reduced-motion` body class. Class and keyframe names are prefixed
 * `dj-` because an inline `<style>` is document-global.
 */
import { hashSeed, mulberry32 } from '../../shared/hash';
import { ITEM_KINDS, type ItemKind } from '../../shared/store-types';
import { tonguePath } from '../../shared/ui/Lantern';
import type { FlameState } from '../../store';
import { INK, PALETTE, SUMI, WASHI, mix, type Token } from '../color';
import { clamp, star } from '../geom';
import { noise2 } from '../noise';
import { M, Q, Z, circle, el, ellipse, fmt, g, path, polygon, rect, style, symbol, use } from '../svg';
import { WOOD, WOOD_LIGHT, tok } from './room';

/* ────────────────────────────────────────────────────────────────────────── */
/* Kotodama                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const FLAME_CAP = 400;
export const DRIFT_VARIANTS = 6;
/** Kotodama that carry `will-change: transform` (design 09 §6.7 rule 3). */
export const WILL_CHANGE_CAP = 24;

/** Category colors (design 01 §4.3): kana sakura · vocab neon-c · kanji kin · grammar matcha · speaking (chunks) neon-m · components hai. */
export const FLAME_TOKEN: Record<ItemKind, Token> = {
  kana: 'sakura',
  vocab: 'neon-c',
  kanji: 'kin',
  grammar: 'matcha',
  component: 'hai',
  chunk: 'neon-m',
};

export interface FlamesOptions {
  counts: Record<ItemKind, number>;
  seed: number;
  /** Region the flames drift in (user units); `x`/`y` default 0. */
  w: number;
  h: number;
  x?: number;
  y?: number;
  reducedMotion: boolean;
  /** Render cap (default `FLAME_CAP`). */
  max?: number;
  /** Halo around each flame (off in Zen). Default true. */
  glow?: boolean;
}

export interface FlamesResult {
  svg: string;
  rendered: number;
  total: number;
  /** Flames rendered per kind (sums to `rendered`). */
  byKind: Record<ItemKind, number>;
}

export function emptyCounts(): Record<ItemKind, number> {
  return { kana: 0, vocab: 0, kanji: 0, grammar: 0, component: 0, chunk: 0 };
}

function clean(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Largest-remainder split of `max` flames across kinds in proportion to `counts` (sum = min(total, max)). */
export function allocate(counts: Record<ItemKind, number>, max: number): Record<ItemKind, number> {
  const out = emptyCounts();
  let total = 0;
  for (const k of ITEM_KINDS) total += clean(counts[k]);
  const cap = Math.min(total, clean(max));
  if (cap === 0) return out;
  const rem: { k: ItemKind; frac: number }[] = [];
  let used = 0;
  for (const k of ITEM_KINDS) {
    const exact = (clean(counts[k]) * cap) / total;
    const base = Math.floor(exact);
    out[k] = base;
    used += base;
    rem.push({ k, frac: exact - base });
  }
  rem.sort((a, b) => b.frac - a.frac || ITEM_KINDS.indexOf(a.k) - ITEM_KINDS.indexOf(b.k));
  for (let i = 0; used < cap && i < rem.length; i++) {
    out[rem[i]!.k]++;
    used++;
  }
  return out;
}

const KF_ID = 'dj-kf';

function flameSymbol(glow: boolean): string {
  // 10 × 14 teardrop; fill comes from the <use>.
  const body = M(5, 0) + Q(9.2, 5, 8.6, 9.2) + Q(8, 13.6, 5, 14) + Q(2, 13.6, 1.4, 9.2) + Q(0.8, 5, 5, 0) + Z;
  const parts: string[] = [];
  if (glow) parts.push(ellipse(5, 8.5, 6.5, 7.5, { opacity: 0.22 }));
  parts.push(path(body));
  parts.push(ellipse(5, 10, 1.7, 2.6, { fill: WASHI, opacity: 0.75 }));
  return symbol(KF_ID, parts, { viewBox: '-2 -2 14 18', overflow: 'visible' });
}

function driftCss(): string {
  const rules: string[] = [
    `.${KF_ID}{animation:${KF_ID}-drift-0 8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}`,
    `.${KF_ID}-w{will-change:transform}`,
  ];
  for (let v = 0; v < DRIFT_VARIANTS; v++) {
    const a = (v / DRIFT_VARIANTS) * Math.PI * 2;
    const dx = Math.cos(a) * 10;
    const dy = Math.sin(a) * 5 - 9;
    if (v > 0) rules.push(`.${KF_ID}-${v}{animation-name:${KF_ID}-drift-${v}}`);
    rules.push(`@keyframes ${KF_ID}-drift-${v}{0%,100%{transform:translate(0,0)}50%{transform:translate(${fmt(dx)}px,${fmt(dy)}px)}}`);
  }
  rules.push(`@media (prefers-reduced-motion:reduce){.${KF_ID}{animation:none}}`);
  rules.push(`.reduced-motion .${KF_ID}{animation:none}`);
  return rules.join('');
}

/** Kotodama flames for the Black-belt item counts. */
export function flamesSvg(o: FlamesOptions): FlamesResult {
  const counts = { ...emptyCounts(), ...o.counts };
  let total = 0;
  for (const k of ITEM_KINDS) total += clean(counts[k]);
  const byKind = allocate(counts, o.max ?? FLAME_CAP);
  let rendered = 0;
  for (const k of ITEM_KINDS) rendered += byKind[k];
  const glow = o.glow ?? true;
  const ox = o.x ?? 0;
  const oy = o.y ?? 0;
  const w = Math.max(1, o.w);
  const h = Math.max(1, o.h);

  const kinds: ItemKind[] = [];
  for (const k of ITEM_KINDS) for (let i = 0; i < byKind[k]; i++) kinds.push(k);
  const rng = mulberry32(hashSeed(o.seed, 'kotodama'));
  // Fisher–Yates so categories mingle instead of banding
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = kinds[i]!;
    kinds[i] = kinds[j]!;
    kinds[j] = t;
  }
  const field = noise2(hashSeed(o.seed, 'kotodama', 'field'));
  const sizeScale = clamp(Math.sqrt((w * h) / Math.max(1, rendered) / 900), 0.55, 1);

  const uses: string[] = [];
  kinds.forEach((kind, i) => {
    const x = ox + rng() * w;
    const y = oy + rng() * h;
    const n = field(x / 90, y / 90);
    const variant = clamp(Math.floor(n * DRIFT_VARIANTS), 0, DRIFT_VARIANTS - 1);
    const size = (7 + rng() * 7) * sizeScale;
    const opacity = 0.5 + rng() * 0.45;
    const dur = 5 + rng() * 5;
    const delay = -rng() * 10;
    const cls = [KF_ID, variant === 0 ? '' : `${KF_ID}-${variant}`, i < WILL_CHANGE_CAP && !o.reducedMotion ? `${KF_ID}-w` : ''].filter(Boolean).join(' ');
    uses.push(
      use(KF_ID, {
        x: x - size / 2,
        y: y - size * 0.7,
        width: size,
        height: size * 1.4,
        fill: tok(FLAME_TOKEN[kind]),
        opacity,
        class: cls,
        'data-kind': kind,
        style: o.reducedMotion ? undefined : `animation-duration:${fmt(dur)}s;animation-delay:${fmt(delay)}s`,
      }),
    );
  });

  const svg = g({ class: 'dj-kotodama', 'data-total': total, 'data-rendered': rendered, 'aria-hidden': 'true' }, [
    o.reducedMotion || rendered === 0 ? '' : style(driftCss()),
    rendered === 0 ? '' : el('defs', undefined, flameSymbol(glow)),
    ...uses,
  ]);
  return { svg, rendered, total, byKind };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hearth — the Tsuzuku Flame                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export type HearthState = 'unlit' | 'ember' | 'steady' | 'roaring';
export const HEARTH_STATES: readonly HearthState[] = ['unlit', 'ember', 'steady', 'roaring'];

/** Streak flame state (design 03 §7) → hearth look. `frozen` = a freeze (or vacation) held the flame: steady with a crystal. */
export function hearthStateOf(flame: FlameState): { state: HearthState; crystal: boolean } {
  switch (flame) {
    case 'gold':
      return { state: 'roaring', crystal: false };
    case 'lit':
    case 'rest':
      return { state: 'steady', crystal: false };
    case 'frozen':
      return { state: 'steady', crystal: true };
    case 'ember':
      return { state: 'ember', crystal: false };
    case 'broken':
      return { state: 'unlit', crystal: false };
  }
}

export interface HearthOptions {
  seed: number;
  /** Box of the irori in user units. */
  x: number;
  y: number;
  w: number;
  h: number;
  reducedMotion: boolean;
  /** Halo (off in Zen). Default true. */
  glow?: boolean;
  /** `id` of the group (the since-yesterday pulse targets it). */
  id?: string;
}

export const HF = 'dj-hf';
const ASH = PALETTE.light.hai;
/** Tongues drawn (the roaring layout); steady shows the middle two by class. */
export const HEARTH_TONGUES = 4;

/** `.dj-hf--<state>` for a state, and the class list the host swaps. */
export function hearthClass(state: HearthState, crystal = false): string {
  return `${HF}--${state}${crystal ? ` ${HF}--crystal` : ''}`;
}

function hearthCss(): string {
  return [
    `.${HF}-tongue{animation:${HF}-flicker 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}`,
    `.${HF}-t1 .${HF}-tongue{animation-duration:1.9s;animation-delay:-0.7s}`,
    `.${HF}-t2 .${HF}-tongue{animation-duration:1.45s;animation-delay:-1.1s}`,
    `.${HF}-t3 .${HF}-tongue{animation-duration:1.75s;animation-delay:-0.4s}`,
    `.${HF}-ember{animation:${HF}-pulse 2.6s ease-in-out infinite}`,
    `.${HF}-ember-b{animation-delay:-0.9s}`,
    `.${HF}-ember-c{animation-delay:-1.7s}`,
    `@keyframes ${HF}-flicker{0%,100%{transform:scale(1,1)}50%{transform:scale(0.93,1.08)}}`,
    `@keyframes ${HF}-pulse{0%,100%{opacity:0.45}50%{opacity:0.95}}`,
    `@media (prefers-reduced-motion:reduce){.${HF}-tongue,.${HF}-ember{animation:none}}`,
    `.reduced-motion .${HF}-tongue,.reduced-motion .${HF}-ember{animation:none}`,
  ].join('');
}

/**
 * The irori with every state's fire in the string (hidden parts are shown by the
 * `.dj-hf--<state>` class the host sets; DojoScene.css). Deterministic per seed.
 */
export function hearthSvg(o: HearthOptions): string {
  const rng = mulberry32(hashSeed(o.seed, 'hearth'));
  const { x, y, w, h } = o;
  const glow = o.glow ?? true;
  const anim = !o.reducedMotion;
  const inset = w * 0.08;
  const pitTop = y + h * 0.3;
  const pitBottom = y + h;
  const parts: string[] = [
    // wooden frame and sunken pit (perspective trapezoids)
    polygon([[x + inset, pitTop - h * 0.08], [x + w - inset, pitTop - h * 0.08], [x + w, pitBottom], [x, pitBottom]], { fill: WOOD, class: `${HF}-frame` }),
    polygon([[x + inset * 1.8, pitTop], [x + w - inset * 1.8, pitTop], [x + w - inset * 0.9, pitBottom - h * 0.06], [x + inset * 0.9, pitBottom - h * 0.06]], { fill: mix(SUMI, INK, 0.5) }),
    ellipse(x + w / 2, pitBottom - h * 0.22, w * 0.3, h * 0.1, { fill: ASH, opacity: 0.8 }),
    rect(x + w * 0.3, pitBottom - h * 0.3, w * 0.42, h * 0.09, { fill: WOOD_LIGHT, rx: h * 0.04, transform: `rotate(-8 ${fmt(x + w / 2)} ${fmt(pitBottom - h * 0.26)})` }),
    rect(x + w * 0.28, pitBottom - h * 0.28, w * 0.42, h * 0.09, { fill: WOOD, rx: h * 0.04, transform: `rotate(10 ${fmt(x + w / 2)} ${fmt(pitBottom - h * 0.24)})` }),
  ];

  const cx = x + w / 2;
  const base = pitBottom - h * 0.3;
  const fire: string[] = [];
  if (glow) {
    fire.push(ellipse(cx, base - h * 0.2, w * 0.3, h * 0.35, { fill: tok('shu'), opacity: 0, class: `${HF}-glow ${HF}-glow--steady` }));
    fire.push(ellipse(cx, base - h * 0.2, w * 0.42, h * 0.5, { fill: tok('kin'), opacity: 0, class: `${HF}-glow ${HF}-glow--roaring` }));
  }
  // embers
  const emberCls = ['', ` ${HF}-ember-b`, ` ${HF}-ember-c`];
  for (let i = 0; i < 3; i++) {
    fire.push(circle(cx + (i - 1) * w * 0.12 + (rng() - 0.5) * w * 0.04, base - h * 0.02, h * 0.045, { fill: tok('shu'), opacity: 0.8, class: `${HF}-ember${emberCls[i]}` }));
  }
  // four tongues (outer + core), the middle two are the steady fire
  for (let i = 0; i < HEARTH_TONGUES; i++) {
    const off = (i - 1.5) * w * 0.13;
    const hgt = h * 0.85 * (0.85 + rng() * 0.3);
    const wdt = w * 0.2;
    const lean = (rng() - 0.5) * w * 0.08;
    fire.push(
      g({ class: `${HF}-t ${HF}-t${i}` }, [
        path(tonguePath({ cx: cx + off, base, height: hgt, width: wdt, lean }), { fill: tok('shu'), opacity: glow ? 0.92 : 1, class: `${HF}-tongue ${HF}-outer` }),
        path(tonguePath({ cx: cx + off, base, height: hgt * 0.55, width: wdt * 0.5, lean: lean * 0.5 }), { fill: tok('kin'), opacity: 0.9, class: `${HF}-tongue ${HF}-core` }),
      ]),
    );
  }
  parts.push(g({ class: `${HF}-fire` }, fire));

  // the freeze crystal (shown by `.dj-hf--crystal`)
  const r = h * 0.16;
  const ccx = x + w * 0.16;
  const ccy = pitTop - h * 0.1;
  parts.push(
    g({ class: `${HF}-crystal` }, [
      polygon(star(ccx, ccy, r, r * 0.45, 6), { fill: tok('neon-c'), opacity: 0.9 }),
      circle(ccx, ccy, r * 0.28, { fill: WASHI, opacity: 0.9 }),
    ]),
  );

  return g({ class: `${HF} ${hearthClass('unlit')}`, id: o.id, 'aria-hidden': 'true' }, [anim ? style(hearthCss()) : '', ...parts]);
}
