import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
const header = /\/\*[\s\S]*?\*\//.exec(css)?.[0] ?? '';
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

const rules = parse(noComments);
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasRule = (cls: string): boolean => rules.some((r) => new RegExp(`\\.${escape(cls)}(?![\\w-])`).test(r.selector));
const bodyOf = (sel: string): string =>
  rules
    .filter((r) => r.media === null && r.selector.split(',').some((s) => s.trim() === sel))
    .map((r) => r.body)
    .join('\n');

/** Class names listed after `CLASSES:` in the header comment. */
function headerClasses(): string[] {
  const start = header.indexOf('CLASSES:');
  expect(start).toBeGreaterThan(0);
  const rest = header.slice(start + 'CLASSES:'.length);
  const end = rest.search(/\n \*\s*\n/);
  const list = end >= 0 ? rest.slice(0, end) : rest;
  return Array.from(list.matchAll(/\.([a-z][a-z0-9_-]*)/g), (m) => m[1]!);
}

const CONTRACT = ['status-window', 'hanko', 'btn', 'chip', 'combo', 'tategaki', 'judge-card', 'forge-bar', 'scroll-card', 'road-nav', 'seal'];

describe('components.css', () => {
  it('every class named in the header comment has a rule', () => {
    const classes = headerClasses();
    expect(classes.length).toBeGreaterThan(30);
    const missing = classes.filter((c) => !hasRule(c));
    expect(missing).toEqual([]);
  });

  it('declares the shared class contract src/shared/ui/ui.css expects', () => {
    for (const c of CONTRACT) expect(hasRule(c), c).toBe(true);
    expect(hasRule('btn--ghost')).toBe(true);
    expect(hasRule('chip--kiai')).toBe(true);
    expect(hasRule('chip--tag')).toBe(true);
    expect(hasRule('hanko--lg')).toBe(true);
    expect(hasRule('forge-bar__fill')).toBe(true);
  });

  it('uses no color literals outside tokens.css', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/\bhsla?\(/);
  });

  it('motion stays within 60–240 ms and honors reduced motion', () => {
    const durations = Array.from(noComments.matchAll(/(\d+)ms/g), (m) => Number(m[1]));
    expect(durations.length).toBeGreaterThan(3);
    for (const d of durations) {
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(240);
    }
    const reducedMedia = rules.filter((r) => r.media?.includes('prefers-reduced-motion: reduce'));
    // the class path is `.reduced-motion …`, or — for the arcade-gated pop, whose gate sits on <html>/<body>
    // themselves — `body.reduced-motion.feel-arcade …` / `:root[data-reduced-motion] …`
    const CLASS_PREFIX = /^(\.reduced-motion|body\.reduced-motion\.feel-arcade|:root\[data-reduced-motion\])\s+/;
    const reducedClass = rules.filter((r) => CLASS_PREFIX.test(r.selector));
    expect(reducedMedia.length).toBeGreaterThan(0);
    expect(reducedClass.length).toBeGreaterThan(0);
    // every animated selector is covered by both override paths, except opacity-only fades,
    // which design 01 §4.5 keeps under reduced motion
    const keyframeProps = (name: string): Set<string> => {
      const kf = rules.find((r) => r.selector === `@keyframes ${name}`);
      return new Set(Array.from(kf?.body.matchAll(/([a-z-]+)\s*:/g) ?? [], (m) => m[1]!));
    };
    const opacityOnly = (name: string): boolean => {
      const props = keyframeProps(name);
      return props.size > 0 && [...props].every((p) => p === 'opacity');
    };
    /** Splits a selector list on top-level commas only (`:is(a, b) .x, .y` → 2 selectors). */
    const split = (sel: string): string[] => {
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
    };
    const GATE = ':is(:root[data-feel="arcade"], body.feel-arcade) ';
    /** The target without its arcade gate or reduced-motion prefix. */
    const core = (sel: string): string => sel.replace(CLASS_PREFIX, '').replace(GATE, '');
    const animated = rules
      .filter((r) => r.media === null && !CLASS_PREFIX.test(r.selector) && /animation:\s*[a-z-]+\s/.test(r.body))
      .filter((r) => !opacityOnly(/animation:\s*([a-z-]+)/.exec(r.body)![1]!))
      .flatMap((r) => split(r.selector).map(core));
    expect(animated.length).toBeGreaterThan(0);
    expect(opacityOnly('fade-in')).toBe(true);
    const mediaSel = reducedMedia.flatMap((r) => split(r.selector).map(core));
    const classSel = reducedClass.flatMap((r) => split(r.selector).map(core));
    for (const sel of animated) {
      expect(mediaSel, `media override for ${sel}`).toContain(sel);
      expect(classSel, `.reduced-motion override for ${sel}`).toContain(sel);
    }
    // the class-path pop override can match: it never nests <html>/<body> under body.reduced-motion
    for (const r of reducedClass) expect(r.selector, 'dead `.reduced-motion :is(:root…, body…)` selector').not.toMatch(/\.reduced-motion\s+:is\(:root/);
    expect(classSel).toContain('.combo[data-tier="2"]');
    expect(classSel.filter((s) => s === '.combo[data-tier="3"]').length).toBe(2);
  });

  it('small text on accent colours uses the text-safe tokens (design 01 §7 AA)', () => {
    expect(bodyOf('.btn--danger')).toMatch(/color:\s*var\(--shu-text\)/);
    expect(bodyOf('.chip--tag')).toMatch(/color:\s*var\(--shu-text\)/);
    expect(bodyOf('.chip--kiai')).toMatch(/color:\s*var\(--ink\)/);
    expect(bodyOf('.nav__item[aria-current="page"]')).toMatch(/color:\s*var\(--shu-text\)/);
    expect(bodyOf('.nav__item[aria-current="page"]')).toMatch(/border-top-color:\s*var\(--shu\)/);
  });

  it('Status Window: double border, notched corners, 92% raised; Night adds the lacquer-and-gold hairline (design 09 §5.5)', () => {
    const b = bodyOf('.status-window');
    expect(b).toMatch(/border:\s*2px double/);
    expect(b).toMatch(/clip-path:\s*polygon/);
    expect(b).toMatch(/color-mix\(in srgb, var\(--raised\) 92%/);
    expect(bodyOf(':root[data-color-scheme="dark"] .status-window')).toMatch(/inset 0 0 0 1px color-mix\(in srgb, var\(--kin\) 35%, var\(--line\)\)/);
  });

  it('Hanko Button: vermilion, press scale 0.96, ink-bleed keyframes as a ring (transform + opacity, never box-shadow)', () => {
    expect(bodyOf('.hanko')).toMatch(/background:\s*var\(--shu\)/);
    expect(bodyOf('.hanko')).not.toMatch(/transition:[^;]*box-shadow/);
    expect(bodyOf('.hanko:active')).toMatch(/scale\(0\.96\)/);
    const bleed = rules.find((r) => r.selector === '@keyframes ink-bleed');
    expect(bleed).toBeTruthy();
    expect(bleed!.body).not.toMatch(/box-shadow/);
    expect(bleed!.body).toMatch(/scale\(1\.25\)/);
    expect(bodyOf('.hanko.is-pressed::after')).toMatch(/animation:\s*ink-bleed/);
  });

  it('Combo scales by tier in text-safe colour (the one canonical definition); the arcade pop rides a token; Zen hides it', () => {
    expect(bodyOf('.combo[data-tier="2"]')).toMatch(/color:\s*var\(--kin-text\)/);
    expect(bodyOf('.combo[data-tier="3"]')).toMatch(/scale\(1\.3\)/);
    expect(bodyOf('.combo[data-tier="3"]')).toMatch(/color:\s*var\(--shu-text\)/);
    const pop = rules.find((r) => r.media === null && r.selector.includes('data-feel="arcade"') && r.selector.includes('.combo[data-tier="3"]') && /animation:/.test(r.body));
    expect(pop?.body).toMatch(/combo-pop var\(--dur-2\)/);
    expect(rules.some((r) => r.selector === '@keyframes combo-pop')).toBe(true);
    expect(rules.some((r) => r.selector === '@keyframes belt-flip')).toBe(true);
    expect(rules.some((r) => r.selector.includes('.feel-zen .combo'))).toBe(true);
  });

  it('bars never tween width (design 09 §6.7); --kin / --shu are fills, text uses the text-safe tokens', () => {
    expect(noComments).not.toMatch(/transition:[^;]*\bwidth\b/);
    expect(bodyOf('.flame[data-state="gold"]')).toMatch(/color:\s*var\(--kin-text\)/);
    expect(bodyOf('.flame[data-state="lit"]')).toMatch(/color:\s*var\(--shu-text\)/);
    // `color:` the text property, not border-color / border-left-color (fills may use the accents)
    expect(noComments).not.toMatch(/(?<![\w-])color:\s*var\(--kin\)/);
    expect(noComments).not.toMatch(/(?<![\w-])color:\s*var\(--shu\)/);
  });

  it('Tategaki is vertical; belts cover all eight colors; nav marks aria-current', () => {
    expect(bodyOf('.tategaki')).toMatch(/writing-mode:\s*vertical-rl/);
    for (const b of ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']) {
      expect(hasRule(`belt--${b}`), b).toBe(true);
      expect(noComments).toContain(`var(--belt-${b})`);
    }
    expect(rules.some((r) => r.selector.includes('.nav__item[aria-current="page"]'))).toBe(true);
  });

  it('touch targets: buttons (compact ones included) and nav items use the 44 px token', () => {
    expect(bodyOf('.btn')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(bodyOf('.btn--sm')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(bodyOf('.btn--sm')).not.toMatch(/min-height:\s*\d+px/);
    expect(bodyOf('.nav__item')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(bodyOf('.list__item')).toMatch(/min-height:\s*var\(--touch\)/);
  });
});
