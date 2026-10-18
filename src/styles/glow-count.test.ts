import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The glow census of design 09 §1 rule 2 / §10 D1 (owner D1): a STATIC CSS
 * parse — jsdom resolves no custom-property cascade and no test in src uses
 * getComputedStyle — over the arcade and ceremony stylesheets. At most six
 * selectors set a `box-shadow` through `var(--glow-*)`, and none of them
 * applies outside a `data-feel="arcade"` / dark-theme / `data-color-scheme="dark"`
 * scope — except the one drawn flame: motion.css's `.lantern` light source
 * (§5.10), whose glow is Night-only by TOKEN (`--glow-*` is `none` on `:root`,
 * asserted below), not by selector. Every other glow is named here as the
 * selector string it must carry.
 */

const ROOT = process.cwd();
const FILES = [
  'src/session/KageView.css',
  'src/styles/arcade.css',
  'src/styles/motion.css',
  'src/exercises/fluency/RapidFire.css',
  'src/exercises/kana/kana.css',
  'src/session/GateView.css',
  'src/session/ShinsaView.css',
  ...readdirSync(resolve(ROOT, 'src/art/ceremony'))
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => `src/art/ceremony/${f}`),
];

interface Rule {
  file: string;
  selector: string;
  body: string;
  media: string | null;
}

function parse(file: string, text: string, media: string | null = null, out: Rule[] = []): Rule[] {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(selector)) parse(file, body, selector, out);
    else if (!selector.startsWith('@keyframes')) out.push({ file, selector, body, media });
    i = j;
  }
  return out;
}

/** Splits a selector list on top-level commas only. */
function selectors(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const rules = FILES.flatMap((f) => parse(f, readFileSync(resolve(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
/** Every (file, selector) that sets box-shadow with a --glow-* token. */
const glows = rules.filter((r) => /box-shadow:[^;]*var\(--glow-/.test(r.body)).flatMap((r) => selectors(r.selector).map((selector) => ({ file: r.file, selector, media: r.media })));

const SCOPED = /data-feel="arcade"|\.feel-arcade|data-color-scheme="dark"|data-theme="dark"/;
/** The one drawn flame (design 09 §5.10): its twin glows by the Night-only token, never by selector. */
const LIGHT_SOURCE = /^\.lantern(\[data-state="[a-z]+"\])?::before$/;

describe('the glow census (design 09 §1 rule 2, §10 D1)', () => {
  it('reads every arcade and ceremony stylesheet', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(12);
    expect(rules.length).toBeGreaterThan(100);
  });

  it('at most six selectors set a box-shadow through --glow-*', () => {
    expect(glows.length, glows.map((g) => `${g.file}: ${g.selector}`).join('\n')).toBeLessThanOrEqual(6);
    expect(glows.length).toBeGreaterThan(0);
  });

  it('none of them applies outside a data-feel=arcade / dark-theme / data-color-scheme=dark scope (the lantern light source excepted, by token)', () => {
    for (const g of glows) {
      const scoped = SCOPED.test(g.selector) || (g.media !== null && /prefers-color-scheme:\s*dark/.test(g.media));
      const flame = g.file === 'src/styles/motion.css' && LIGHT_SOURCE.test(g.selector);
      expect(scoped || flame, `${g.file}: ${g.selector}`).toBe(true);
    }
    // the token itself is `none` in Morning: nothing glows in Dojo Morning whatever the selector
    const tokens = readFileSync(resolve(ROOT, 'src/styles/tokens.css'), 'utf8');
    const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
    expect(rootBlock).toMatch(/--glow-kin:\s*none;/);
    expect(rootBlock).toMatch(/--glow-shu:\s*none;/);
  });

  it('no literal glow anywhere in these files: every outer blur comes from a --glow-* token, and text-shadow never blurs', () => {
    for (const r of rules) {
      for (const m of r.body.matchAll(/(box-shadow|text-shadow):\s*([^;]+)/g)) {
        for (const layer of m[2]!.split(/,(?![^(]*\))/)) {
          const l = layer.trim();
          if (l.startsWith('inset') || l.startsWith('var(--glow-') || l === 'none') continue;
          const blur = /^-?[\d.]+(px|em)\s+-?[\d.]+(px|em)\s+([\d.]+)(px|em)/.exec(l);
          expect(blur ? Number(blur[3]) : 0, `${r.file} ${r.selector}: ${l}`).toBe(0);
        }
      }
    }
  });
});
