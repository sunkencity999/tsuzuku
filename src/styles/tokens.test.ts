import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEKKI } from '@/shared/koyomi';

// import.meta.url is an http URL under the jsdom environment; vitest runs from the project root.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const COLOR_TOKENS = ['--bg', '--surface', '--raised', '--fg', '--fg-muted', '--line', '--shu', '--kin', '--ai', '--sakura', '--matcha', '--neon-c', '--neon-m', '--kon', '--hai', '--focus'];
const INVARIANT = ['--belt-white', '--belt-yellow', '--belt-orange', '--belt-green', '--belt-blue', '--belt-purple', '--belt-brown', '--belt-black', '--bronze', '--silver'];
const FONTS = ['--font-ui', '--font-ja', '--font-pixel', '--font-brush', '--font-mincho', '--font-neon'];
const SIZES = ['--fs-1', '--fs-2', '--fs-3', '--fs-4', '--fs-5', '--fs-6', '--fs-7', '--fs-8'];
const MOTION = ['--ease', '--dur-1', '--dur-2'];
const LAYOUT = ['--gutter', '--touch', '--radius', '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6'];

const TEXT_TOKENS = ['--kin-text', '--shu-text', '--ink'];

/* ── design 09 §4.1 ────────────────────────────────────────────────────── */
/** themed: declared in :root AND both dark blocks */
const THEMED_09 = ['--paper-opacity', '--neon-c-text', '--neon-m-text', '--glow-kin', '--glow-shu'];
/** invariant: :root only, never redefined in dark */
const INVARIANT_09 = [
  '--dur-3', '--dur-4', '--dur-5', '--dur-fade', '--stagger',
  '--ease-out', '--ease-in', '--ease-draw', '--ease-press', '--spring',
  '--paper', '--stage-bg', '--stage-fg', '--stage-muted', '--stage-line', '--stage-raised',
  '--sky-top', '--sky-mid', '--sky-horizon', '--lamp-alpha', '--sekki-pigment', '--sekki-mix',
  '--bg-paper', '--surface-paper', '--raised-paper', '--belt-color', '--road',
  '--wood', '--wood-light', '--ai-dye', '--kintsugi', '--radius-paper', '--radius-seal', '--lh-mincho', '--measure-ja',
];
const LIGHT_09: Record<string, string> = { '--paper-opacity': '0.055', '--neon-c-text': '#0B6660', '--neon-m-text': '#A8206F', '--glow-kin': 'none', '--glow-shu': 'none' };
const DARK_09: Record<string, string> = { '--paper-opacity': '0.04', '--neon-c-text': '#2EE6D6', '--neon-m-text': '#FF3DA6' };
const STAGE = { bg: '#0B0B10', fg: '#F4EDE0', muted: '#A9A49A', line: '#2C2C3A', raised: '#1F1F2A' };
const BELTS: Record<string, string> = {
  white: '#F4EDE0', yellow: '#F2D54A', orange: '#F08A24', green: '#3E9B4F', blue: '#2F6FD6', purple: '#7A3FB5', brown: '#6B3F23', black: '#0B0B10',
};

/**
 * The 24 sekki pigments (design 09 §4.3) come from A3's table — `SEKKI` in
 * src/shared/koyomi.ts — so the 4.5:1 floors below enforce the real values
 * (romaji ids only; every mix ≤ SEKKI_MIX_MAX = 3 %).
 */
const SEKKI_PIGMENTS: readonly { id: string; pigment: string; mix: number }[] = SEKKI.map((s) => ({ id: s.id, pigment: `--${s.pigment}`, mix: s.mix }));

const LIGHT: Record<string, string> = {
  '--kin-text': '#7A5A05', '--shu-text': '#B0241F', '--ink': '#1A1A1F',
  '--bg': '#F4EDE0', '--surface': '#FFFBF3', '--raised': '#EADFCB', '--fg': '#1A1A1F', '--fg-muted': '#5E5A52', '--line': '#D9CDB6',
  '--shu': '#C9302C', '--kin': '#B8860B', '--ai': '#1F2A6B', '--sakura': '#C9718A', '--matcha': '#4E8A3C', '--neon-c': '#0E8F86',
  '--neon-m': '#B8257A', '--kon': '#1F3A93', '--hai': '#8A8578', '--focus': '#1F2A6B',
};
const DARK: Record<string, string> = {
  '--kin-text': '#E0B341', '--shu-text': '#FF6A5E', '--ink': '#1A1A1F',
  '--bg': '#0B0B10', '--surface': '#15151D', '--raised': '#1F1F2A', '--fg': '#F4EDE0', '--fg-muted': '#A9A49A', '--line': '#2C2C3A',
  '--shu': '#E63B2E', '--kin': '#E0B341', '--ai': '#6C7BD9', '--sakura': '#F7B2C4', '--matcha': '#7BB661', '--neon-c': '#2EE6D6',
  '--neon-m': '#FF3DA6', '--kon': '#4F6FD6', '--hai': '#6E6A61', '--focus': '#2EE6D6',
};

/** Returns the body of the first block whose selector line matches. */
function block(selector: string): string {
  const i = css.indexOf(selector);
  expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  throw new Error('unbalanced');
}

function tokensOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // a value may hold a quoted string with its own semicolons (the --paper data URI)
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*((?:"[^"]*"|[^;"])+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/* ── colour math for the tint loops ───────────────────────────────────── */
type RGB = [number, number, number];
const toRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: RGB): string => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** `color-mix(in srgb, a (100-p)%, b p%)` — gamma-encoded sRGB, as CSS does it. */
function mixSrgb(a: string, b: string, p: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => x[i]! * (1 - p) + y[i]! * p) as RGB);
}
const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const gam = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
/** sRGB hex → OKLab (Björn Ottosson). */
function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toHex([
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}
/** `color-mix(in oklab, a p%, b)` */
function mixOklab(a: string, b: string, p: number): string {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab([0, 1, 2].map((i) => x[i]! * p + y[i]! * (1 - p)) as [number, number, number]);
}

describe('tokens.css', () => {
  const root = tokensOf(block(':root {'));
  const darkAuto = tokensOf(block(':root:not([data-theme="light"])'));
  const darkForced = tokensOf(block(':root[data-theme="dark"]'));

  it('defines every ARCHITECTURE §7 token on :root', () => {
    for (const t of [...COLOR_TOKENS, ...INVARIANT, ...FONTS, ...SIZES, ...MOTION, ...LAYOUT]) expect(root[t], t).toBeTruthy();
    expect(root['--gutter']).toBe('16px');
    expect(root['--touch']).toBe('44px');
    expect(root['--fs-8']).toBe('7.5rem');
    expect(root['--ease']).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('redefines every color token in both dark blocks with the design 01 §4.3 values', () => {
    for (const t of COLOR_TOKENS) {
      expect(root[t]?.toUpperCase(), `light ${t}`).toBe(LIGHT[t]);
      expect(darkAuto[t]?.toUpperCase(), `dark auto ${t}`).toBe(DARK[t]);
      expect(darkForced[t]?.toUpperCase(), `dark forced ${t}`).toBe(DARK[t]);
    }
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  });

  it('belt colors match types.ts and are not redefined in dark', () => {
    expect(root['--belt-black']).toBe('#0B0B10');
    expect(root['--belt-yellow']).toBe('#F2D54A');
    expect(root['--bronze']).toBe('#B87333');
    expect(root['--silver']).toBe('#C9CED6');
    for (const t of INVARIANT) {
      expect(darkAuto[t]).toBeUndefined();
      expect(darkForced[t]).toBeUndefined();
    }
  });

  it('meets contrast: fg/bg ≥ 12:1 and fg-muted/bg ≥ 4.5:1 in both themes', () => {
    for (const theme of [LIGHT, DARK]) {
      expect(contrast(theme['--fg']!, theme['--bg']!)).toBeGreaterThanOrEqual(12);
      expect(contrast(theme['--fg-muted']!, theme['--bg']!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text-safe accent variants exist in both themes and meet 4.5:1 on every surface they are used on', () => {
    for (const t of TEXT_TOKENS) expect(root[t]?.toUpperCase(), t).toBe(LIGHT[t]);
    for (const t of ['--kin-text', '--shu-text']) {
      expect(darkAuto[t]?.toUpperCase(), `dark auto ${t}`).toBe(DARK[t]);
      expect(darkForced[t]?.toUpperCase(), `dark forced ${t}`).toBe(DARK[t]);
    }
    // --ink is theme-invariant (text on the gold --kin background)
    expect(darkAuto['--ink']).toBeUndefined();
    expect(darkForced['--ink']).toBeUndefined();
    for (const theme of [LIGHT, DARK]) {
      for (const bg of ['--bg', '--surface', '--raised']) {
        expect(contrast(theme['--kin-text']!, theme[bg]!), `kin-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme['--shu-text']!, theme[bg]!), `shu-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(theme['--ink']!, theme['--kin']!), 'ink on kin').toBeGreaterThanOrEqual(4.5);
    }
  });

  it('font stacks use system fallbacks and body has an explicit background (the sekki-tinted paper)', () => {
    for (const f of FONTS) expect(root[f]).toMatch(/(sans-serif|serif|monospace)$/);
    expect(block('body {')).toMatch(/background:\s*var\(--bg-paper\)/);
  });

  /* ── design 09 §4.1 ──────────────────────────────────────────────────── */

  it('declares every design 09 themed token in all three blocks with the §4.1 values', () => {
    for (const t of THEMED_09) {
      expect(root[t], `light ${t}`).toBe(LIGHT_09[t]);
      expect(darkAuto[t], `dark auto ${t}`).toBeTruthy();
      expect(darkForced[t], `dark forced ${t}`).toBe(darkAuto[t]);
    }
    for (const t of Object.keys(DARK_09)) expect(darkAuto[t]?.toUpperCase(), t).toBe(DARK_09[t]);
    // glows: Night-only light sources, shaped as two soft rings of the token (never animated)
    for (const [t, c] of [['--glow-kin', '--kin'], ['--glow-shu', '--shu']] as const) {
      expect(darkAuto[t]).toMatch(new RegExp(`^0 0 6px color-mix\\(in srgb, var\\(${c}\\) 55%, transparent\\), 0 0 18px color-mix\\(in srgb, var\\(${c}\\) 22%, transparent\\)$`));
    }
  });

  it('declares every design 09 invariant token on :root only, with the §4.1 values, and never in dark', () => {
    for (const t of INVARIANT_09) {
      expect(root[t], t).toBeTruthy();
      expect(darkAuto[t], `dark auto ${t}`).toBeUndefined();
      expect(darkForced[t], `dark forced ${t}`).toBeUndefined();
    }
    expect(root['--dur-3']).toBe('400ms');
    expect(root['--dur-4']).toBe('900ms');
    expect(root['--dur-5']).toBe('2400ms');
    expect(root['--dur-fade']).toBe('150ms');
    expect(root['--stagger']).toBe('40ms');
    expect(root['--ease-out']).toBe('cubic-bezier(0, 0, 0.2, 1)');
    expect(root['--ease-in']).toBe('cubic-bezier(0.7, 0, 0.84, 0)');
    expect(root['--ease-draw']).toBe('cubic-bezier(0.3, 0, 0.1, 1)');
    expect(root['--ease-press']).toBe('cubic-bezier(0.2, 0.9, 0.2, 1.15)');
    expect(root['--spring']).toMatch(/^linear\(0, \.006, \.025 2\.8%, .*1\.001\)$/);
    expect(css).toMatch(/@supports not \(animation-timing-function: linear\(0, 1\)\)\s*\{\s*:root\s*\{\s*--spring: var\(--ease-press\);/);
    for (const [k, v] of Object.entries(STAGE)) expect(root[`--stage-${k}`]).toBe(v);
    expect(root['--sky-top']).toBe('#4F6FD6');
    expect(root['--sky-mid']).toBe('#9FC4F0');
    expect(root['--sky-horizon']).toBe('#F4EDE0');
    expect(root['--lamp-alpha']).toBe('0');
    expect(root['--sekki-pigment']).toBe('var(--bg)');
    expect(root['--sekki-mix']).toBe('0%');
    for (const s of ['bg', 'surface', 'raised']) expect(root[`--${s}-paper`]).toBe(`color-mix(in srgb, var(--${s}) calc(100% - var(--sekki-mix)), var(--sekki-pigment))`);
    expect(root['--belt-color']).toBe('var(--belt-white)');
    // 10 %, not §4.1's 12 %: at 12 % the Morning black-belt road fails AA for --fg-muted (4.39:1)
    expect(root['--road']).toBe('color-mix(in oklab, var(--belt-color) 10%, var(--bg))');
    expect(root['--wood']).toBe('#5C3A21');
    expect(root['--wood-light']).toBe('#8B5A2B');
    expect(root['--radius-paper']).toBe('2px');
    expect(root['--radius-seal']).toBe('4px');
    expect(root['--lh-mincho']).toBe('2');
    expect(root['--measure-ja']).toBe('36em');
    expect(root['--kintsugi']).toMatch(/^linear-gradient\(90deg, var\(--kin\), #F2DC8A 50%, var\(--kin\)\)$/);
    expect(root['--ai-dye']).toBe('linear-gradient(180deg, var(--kon), var(--ai))');
  });

  it('reduced motion zeroes --dur-1…5 and --stagger under the media query and :root[data-reduced-motion] / .reduced-motion, never --dur-fade', () => {
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const attr = block(':root[data-reduced-motion],');
    expect(css).toMatch(/:root\[data-reduced-motion\],\s*\.reduced-motion\s*\{/);
    for (const body of [media, attr]) {
      const t = tokensOf(body);
      for (const d of ['--dur-1', '--dur-2', '--dur-3', '--dur-4', '--dur-5', '--stagger']) expect(t[d], d).toBe('0ms');
      expect(t['--dur-fade']).toBeUndefined();
    }
  });

  it('the --paper tile is one static 128 px stitched feTurbulence SVG, ≤ 1 KB, written by scripts/paper-tile.ts', () => {
    const url = root['--paper']!;
    expect(url).toMatch(/^url\("data:image\/svg\+xml/);
    expect(url.length).toBeLessThanOrEqual(1024);
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1, -2));
    expect(svg).toMatch(/<svg [^>]*width="128" height="128"/);
    expect(svg).toMatch(/<feTurbulence [^>]*type="fractalNoise"/);
    expect(svg).toMatch(/baseFrequency="0\.9"/);
    expect(svg).toMatch(/stitchTiles="stitch"/);
    expect(svg).toMatch(/<feColorMatrix /);
    expect(svg).not.toMatch(/<animate/);
    expect(css).toMatch(/paper-tile: grey \d+ at mean alpha 0\.\d+ \(scripts\/paper-tile\.ts/);
  });

  it('the arcade inks as text meet 4.5:1 on --bg / --surface / --raised in both themes; the stage holds its own floors', () => {
    for (const theme of [{ ...LIGHT, ...LIGHT_09 }, { ...DARK, ...DARK_09 }]) {
      for (const bg of ['--bg', '--surface', '--raised']) {
        expect(contrast(theme['--neon-c-text']!, theme[bg]!), `neon-c-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme['--neon-m-text']!, theme[bg]!), `neon-m-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(STAGE.fg, STAGE.bg)).toBeGreaterThanOrEqual(12);
    expect(contrast(STAGE.muted, STAGE.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(STAGE.muted, STAGE.raised)).toBeGreaterThanOrEqual(4.5);
  });

  it('the sekki tint: 24 pigments × 3 surfaces × 2 themes keep --fg-muted, --kin-text and --shu-text ≥ 4.5:1 (§4.2)', () => {
    expect(SEKKI_PIGMENTS).toHaveLength(24);
    expect(new Set(SEKKI_PIGMENTS.map((s) => s.id)).size).toBe(24);
    let checked = 0;
    for (const row of SEKKI_PIGMENTS) {
      expect(row.mix, row.id).toBeLessThanOrEqual(3);
      for (const theme of [LIGHT, DARK]) {
        const pigment = theme[row.pigment];
        expect(pigment, `${row.id}: ${row.pigment} is a themed pigment`).toBeTruthy();
        for (const surface of ['--bg', '--surface', '--raised']) {
          const tinted = mixSrgb(theme[surface]!, pigment!, row.mix / 100);
          for (const text of ['--fg-muted', '--kin-text', '--shu-text']) {
            expect(contrast(theme[text]!, tinted), `${row.id} ${text} on tinted ${surface}`).toBeGreaterThanOrEqual(4.5);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(24 * 3 * 2 * 3);
  });

  it('the road band: 8 belts × 2 themes at the oklab mix in --road keep --fg-muted and --fg ≥ 4.5:1 (§4.1)', () => {
    const mix = Number(/var\(--belt-color\) (\d+)%/.exec(root['--road']!)![1]) / 100;
    expect(mix).toBeGreaterThan(0);
    for (const [belt, hex] of Object.entries(BELTS)) {
      expect(root[`--belt-${belt}`]).toBe(hex);
      for (const theme of [LIGHT, DARK]) {
        const road = mixOklab(hex, theme['--bg']!, mix);
        expect(contrast(theme['--fg-muted']!, road), `fg-muted on ${belt} road`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme['--fg']!, road), `fg on ${belt} road`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the grain shifts --fg-muted on --bg by < 0.1 at --paper-opacity (§2.3), from the mean the tile script wrote', () => {
    const m = /paper-tile: grey (\d+) at mean alpha (0\.\d+)/.exec(css);
    expect(m).toBeTruthy();
    const grey = Number(m![1]);
    const meanAlpha = Number(m![2]);
    expect(grey).toBe(128);
    expect(meanAlpha).toBeGreaterThan(0.05);
    expect(meanAlpha).toBeLessThan(0.3);
    const greyHex = toHex([grey, grey, grey]);
    for (const [theme, extra] of [[LIGHT, LIGHT_09], [DARK, DARK_09]] as const) {
      const opacity = Number(extra['--paper-opacity']);
      const base = contrast(theme['--fg-muted']!, theme['--bg']!);
      const textured = contrast(theme['--fg-muted']!, mixSrgb(theme['--bg']!, greyHex, opacity * meanAlpha));
      expect(Math.abs(base - textured), `grain shift at ${opacity}`).toBeLessThan(0.1);
    }
  });

  it('documents --kin / --shu as fill-only', () => {
    expect(css).toMatch(/--kin \/ --shu are FILL-ONLY/);
  });
});
