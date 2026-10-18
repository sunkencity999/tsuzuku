import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/arcade.css'), 'utf8');
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  body: string;
  media: string | null;
}

function parse(text: string, media: string | null = null, out: Rule[] = []): Rule[] {
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
    if (/^@(media|supports)/.test(selector)) parse(body, selector, out);
    else out.push({ selector, body, media });
    i = j;
  }
  return out;
}

const GATE = ':is(:root[data-feel="arcade"], body.feel-arcade)';
const rules = parse(noComments);
const styleRules = rules.filter((r) => !r.selector.startsWith('@keyframes'));
const keyframes = rules.filter((r) => r.selector.startsWith('@keyframes')).map((r) => r.selector.replace('@keyframes', '').trim());

/** Splits a selector list on top-level commas only (`:is(a, b) .x, .y` → 2 selectors). */
function selectors(r: Rule): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of r.selector) {
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
const animatedRules = styleRules.filter((r) => r.media === null && !r.selector.startsWith('body.reduced-motion') && /animation(-name)?:\s*(?!none)[a-z-]/.test(r.body));

describe('arcade.css', () => {
  it('parses and defines keyframes for every animation it uses', () => {
    expect((noComments.match(/\{/g) ?? []).length).toBe((noComments.match(/\}/g) ?? []).length);
    for (const r of animatedRules) {
      const name = /animation:\s*([a-z-]+)/.exec(r.body)?.[1];
      expect(keyframes, `keyframes for ${r.selector}`).toContain(name);
    }
  });

  it('the arcade is a print (design 09 §2.5): nothing here animates — the arcade moves through motion.css verbs', () => {
    // The unmounted spectacle (edge glow, speed lines, Ippon flash, ki pulse) and the combo pop
    // left this file (A1). If an animation ever returns here, restore the rules this file carried
    // before: every duration ≥ 334 ms (the 3 Hz rule) and a reduced-motion override under BOTH
    // the media query and body.reduced-motion — motion.test.ts shows the shape.
    expect(animatedRules).toEqual([]);
    expect(keyframes).toEqual([]);
    expect(noComments).not.toMatch(/animation(-name)?:\s*(?!none)[a-z-]/);
  });

  it('everything is gated by the arcade feel (or is a reduced-motion override)', () => {
    for (const r of styleRules) {
      for (const sel of selectors(r)) {
        const gated = sel.startsWith(GATE) || sel.startsWith('body.reduced-motion');
        expect(gated, sel).toBe(true);
      }
    }
  });

  it('ships the documented classes: .crt .halftone .hiscore (D1 mounts them), and nothing that was deleted', () => {
    for (const c of ['crt', 'halftone', 'hiscore']) {
      expect(styleRules.some((r) => new RegExp(`\\.${c}(?![\\w-])`).test(r.selector)), c).toBe(true);
    }
    for (const c of ['glow-edge', 'speed-lines', 'ippon-flash', 'combo-pop', 'ki-glow', 'arcade-head']) {
      expect(styleRules.some((r) => new RegExp(`\\.${c}(?![\\w-])`).test(r.selector)), `${c} deleted`).toBe(false);
    }
    // the combo tiers have one canonical home (components.css); no tier rule here
    expect(styleRules.some((r) => /\.combo\[data-tier/.test(r.selector))).toBe(false);
    // CRT stays opt-in (design 09 §2.5): every .crt rule is gated by the arcade feel AND the CRT setting
    const CRT_GATE = `${GATE}:is([data-crt], .crt)`;
    const crtRules = styleRules.filter((r) => /\.crt(?![\w-])/.test(r.selector));
    expect(crtRules.length).toBeGreaterThanOrEqual(4);
    for (const r of crtRules) for (const sel of selectors(r)) expect(sel.startsWith(CRT_GATE), sel).toBe(true);
    const crt = styleRules.find((r) => r.selector === `${CRT_GATE} .crt::after`);
    expect(crt?.body).toMatch(/repeating-linear-gradient/);
    const offset = styleRules.find((r) => r.selector === `${CRT_GATE} .crt > *`);
    expect(offset?.body).toMatch(/text-shadow:\s*\n?\s*1px 0 0/);
  });

  it('nothing glows in Dojo Morning (design 09 §1 rule 2): glows come only from --glow-* tokens, and never from a literal blur', () => {
    for (const r of styleRules) {
      for (const m of r.body.matchAll(/box-shadow:\s*([^;]+)/g)) {
        // an outer blur is a glow; inset shading and 1 px rules are not
        for (const layer of m[1]!.split(/,(?![^(]*\))/)) {
          const l = layer.trim();
          if (l.startsWith('inset') || l.startsWith('var(--glow-')) continue;
          const blur = /^-?\d+px\s+-?\d+px\s+(\d+)px/.exec(l);
          expect(blur ? Number(blur[1]) : 0, `${r.selector}: ${l}`).toBe(0);
        }
      }
    }
    // text in the arcade inks uses the text-safe tokens (--neon-c measures 3.41:1 on washi)
    expect(noComments).not.toMatch(/color:\s*var\(--neon-c\)/);
    expect(noComments).not.toMatch(/color:\s*var\(--neon-m\)/);
  });

  it('uses no color literals (tokens only)', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/\bhsla?\(/);
  });
});
