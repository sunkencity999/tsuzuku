import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/*
 * The motion guard of design 09 §6.7–§6.8 (owner A1): every @keyframes in
 * motion.css animates only composited properties; nothing loops; opacity never
 * reverses more than twice per second; every duration is a token; every
 * animated selector has its reduced form under BOTH selectors (or opts in with
 * .rm-fade); no colour literals. The width/height grep walks every src CSS
 * file with an explicit allow-list that each owner deletes from as they land —
 * an exact match, so a stale entry fails as loudly as a new offender.
 */

const ROOT = process.cwd();
const css = readFileSync(resolve(ROOT, 'src/styles/motion.css'), 'utf8');
const tokensCss = readFileSync(resolve(ROOT, 'src/styles/tokens.css'), 'utf8');
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
const keyframeRules = rules.filter((r) => r.selector.startsWith('@keyframes'));
const styleRules = rules.filter((r) => !r.selector.startsWith('@keyframes'));
const keyframeNames = keyframeRules.map((r) => r.selector.replace('@keyframes', '').trim());

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

/** Expands a top-level `:is(a, b)` (optionally prefixed) into its members; a plain selector passes through. */
function expandIs(sel: string): string[] {
  const m = /^(.*?):is\((.*)\)(.*)$/.exec(sel);
  if (!m) return [sel];
  const [, pre, inner, post] = m as unknown as [string, string, string, string];
  return selectors(inner).map((s) => `${pre}${s}${post}`.trim());
}

/** Strips the reduced-motion prefix and normalises view-transition pseudos to their `(*)` form. */
function core(sel: string): string {
  let s = sel.replace(/^:root\[data-reduced-motion\]\s*/, '').replace(/^(html)?:root(:root)?\s*/, '').trim();
  const vt = /::view-transition-(group|old|new)\([^)]*\)$/.exec(s);
  if (vt) s = `::view-transition-${vt[1]}(*)`;
  return s;
}

/** Declarations `prop: value` of a rule body (top-level semicolons). */
function declarations(body: string): [string, string][] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string];
    });
}

/** Properties a @keyframes block sets (every stop). */
function keyframeProps(body: string): Set<string> {
  const props = new Set<string>();
  for (const stop of parse(body)) for (const [p] of declarations(stop.body)) props.add(p);
  return props;
}

/** Resolves `var(--dur-N)` / `calc(var(--dur-N) * a / b)` to ms from tokens.css's :root. */
const tokenMs: Record<string, number> = {};
for (const m of tokensCss.matchAll(/(--dur-[a-z0-9-]+|--stagger)\s*:\s*(\d+)ms/g)) tokenMs[m[1]!] ??= Number(m[2]);
function durationMs(expr: string): number {
  const v = /var\((--[a-z0-9-]+)\)/.exec(expr)?.[1];
  expect(v, `token in ${expr}`).toBeTruthy();
  let ms = tokenMs[v!];
  expect(ms, `known duration token ${v}`).toBeGreaterThan(0);
  const mul = /\*\s*([\d.]+)/.exec(expr);
  const div = /\/\s*([\d.]+)/.exec(expr);
  if (mul) ms = ms! * Number(mul[1]);
  if (div) ms = ms! / Number(div[1]);
  return ms!;
}

/** `animation` shorthands and `animation-name` references: [name, duration expression]. */
function animationsOf(body: string): { name: string; duration: string | null; infinite: boolean }[] {
  const out: { name: string; duration: string | null; infinite: boolean }[] = [];
  for (const [p, v] of declarations(body)) {
    if (p === 'animation') {
      if (v === 'none') continue;
      const parts = v.split(/\s+(?![^()]*\))/);
      const name = parts.find((x) => keyframeNames.includes(x));
      const duration = parts.find((x) => /^(calc\(|var\(--dur)/.test(x)) ?? null;
      out.push({ name: name ?? parts[0]!, duration, infinite: /\binfinite\b/.test(v) });
    } else if (p === 'animation-name' && v !== 'none') out.push({ name: v, duration: null, infinite: false });
  }
  return out;
}

const ALLOWED = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate', 'clip-path', 'stroke-dashoffset']);
/** colour may transition on small text and fills for ≤ --dur-2 (design 09 §6.7 rule 1) */
const COLOUR_TRANSITION = new Set(['color', 'fill', 'stroke', 'background-color']);

const VERBS = ['ink-nijimi', 'ink-kasure', 'ink-hiku', 'ink-osu', 'ink-wet', 'ink-meku', 'ink-tomosu'];
const CLASSES = ['sheet', 'sheet--gutter', 'hairline', 'eyebrow', 'title-lockup', 'sign', 'meter', 'meter__fill', 'poster-title', 'tanzaku', 'shoji', 'lantern', 'seal-date', 'tategaki-column', 'rm-fade'];
const hasRule = (cls: string): boolean => styleRules.some((r) => new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r.selector));

/** Rules (outside the reduced blocks) that animate or that transition a travel property. */
const animated = styleRules.filter(
  (r) =>
    r.media === null &&
    !r.selector.startsWith(':root[data-reduced-motion]') &&
    (animationsOf(r.body).length > 0 ||
      declarations(r.body).some(([p, v]) => p === 'transition' && /\b(transform|translate|scale|rotate|clip-path)\b/.test(v))),
);

describe('motion.css', () => {
  it('parses, names the verbs and classes in its header, and declares a rule for each', () => {
    expect((noComments.match(/\{/g) ?? []).length).toBe((noComments.match(/\}/g) ?? []).length);
    for (const v of VERBS) {
      expect(header, `header names .${v}`).toContain(`.${v}`);
      expect(hasRule(v), `rule for .${v}`).toBe(true);
    }
    for (const c of CLASSES) expect(hasRule(c), `rule for .${c}`).toBe(true);
    expect(hasRule('ink-nijimi')).toBe(true);
    for (const a of animated) for (const k of animationsOf(a.body)) expect(keyframeNames, `keyframes for ${a.selector}`).toContain(k.name);
  });

  it('every @keyframes animates only opacity / transform (translate, scale) / clip-path / stroke-dashoffset', () => {
    expect(keyframeRules.length).toBeGreaterThan(10);
    for (const kf of keyframeRules) {
      for (const p of keyframeProps(kf.body)) expect(ALLOWED.has(p), `${kf.selector} animates ${p}`).toBe(true);
    }
    // the kawaku layer is filtered once and only its opacity moves
    for (const r of styleRules) {
      for (const [p, v] of declarations(r.body)) {
        if (p !== 'transition') continue;
        for (const part of v.split(',')) {
          const prop = part.trim().split(/\s+/)[0]!;
          if (prop === 'none') continue;
          const ok = ALLOWED.has(prop) || prop === 'opacity' || COLOUR_TRANSITION.has(prop);
          expect(ok, `${r.selector} transitions ${prop}`).toBe(true);
          if (COLOUR_TRANSITION.has(prop)) expect(durationMs(part), `colour transition ≤ --dur-2 in ${r.selector}`).toBeLessThanOrEqual(tokenMs['--dur-2']!);
        }
      }
    }
  });

  it('every duration is a token (no ms / s literals outside comments) and nothing is infinite under 1,400 ms', () => {
    expect(noComments).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    for (const r of styleRules) {
      for (const a of animationsOf(r.body)) {
        if (!a.infinite) continue;
        expect(durationMs(a.duration ?? ''), `infinite animation in ${r.selector}`).toBeGreaterThanOrEqual(1400);
      }
    }
    // the eight-item stagger cap (§6.3) is written once per entrance
    expect(noComments).toMatch(/animation-delay:\s*calc\(min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
  });

  it('no keyframe reverses opacity more than twice per 1,000 ms of its duration (§6.8)', () => {
    const reversals = (body: string): number => {
      const stops = parse(body)
        .map((s) => ({ at: s.selector === 'from' ? 0 : s.selector === 'to' ? 100 : Number.parseFloat(s.selector), op: declarations(s.body).find(([p]) => p === 'opacity')?.[1] }))
        .filter((s) => s.op !== undefined && /^[\d.]+$/.test(s.op))
        .sort((a, b) => a.at - b.at);
      let turns = 0;
      let dir = 0;
      for (let i = 1; i < stops.length; i++) {
        const d = Math.sign(Number(stops[i]!.op) - Number(stops[i - 1]!.op));
        if (d !== 0 && dir !== 0 && d !== dir) turns++;
        if (d !== 0) dir = d;
      }
      return turns;
    };
    let checked = 0;
    for (const r of styleRules) {
      for (const a of animationsOf(r.body)) {
        if (!a.duration) continue;
        const kf = keyframeRules.find((k) => k.selector === `@keyframes ${a.name}`);
        if (!kf) continue;
        const ms = durationMs(a.duration);
        expect(reversals(kf.body) / (ms / 1000), `${a.name} in ${r.selector}`).toBeLessThanOrEqual(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('every animated selector has its reduced-motion form under BOTH the media query and :root[data-reduced-motion] (or is .rm-fade)', () => {
    const mediaOverrides = new Set(
      styleRules
        .filter((r) => r.media?.includes('prefers-reduced-motion: reduce') && /animation(-name)?:|transition:/.test(r.body))
        .flatMap((r) => selectors(r.selector).flatMap(expandIs).map(core)),
    );
    const attrOverrides = new Set(
      styleRules
        .filter((r) => r.media === null && r.selector.startsWith(':root[data-reduced-motion]') && /animation(-name)?:|transition:/.test(r.body))
        .flatMap((r) => selectors(r.selector).flatMap(expandIs).map(core)),
    );
    expect(mediaOverrides.size).toBeGreaterThan(8);
    expect(attrOverrides.size).toBeGreaterThan(8);
    expect(animated.length).toBeGreaterThan(12);
    for (const r of animated) {
      for (const sel of selectors(r.selector).flatMap(expandIs).map(core)) {
        if (/\.rm-fade/.test(sel)) continue;
        expect(mediaOverrides, `media override for ${sel}`).toContain(sel);
        expect(attrOverrides, `[data-reduced-motion] override for ${sel}`).toContain(sel);
      }
    }
    // the reduced forms themselves keep only --dur-fade and never a longer token
    const reducedRules = styleRules.filter((x) => x.media?.includes('prefers-reduced-motion') || x.selector.startsWith(':root[data-reduced-motion]'));
    for (const r of reducedRules) {
      for (const m of r.body.matchAll(/var\((--dur-[a-z0-9]+|--stagger)\)/g)) expect(m[1], `reduced rule ${r.selector}`).toBe('--dur-fade');
    }
    // a reduced `transition` or `animation` that is meant to play must beat base.css's `*:not(.rm-fade)`
    // (0.01ms !important): it is `none`, or it carries its own `!important` --dur-fade duration
    for (const r of reducedRules) {
      if (/\.rm-fade/.test(r.selector) || /::view-transition/.test(r.selector)) continue;
      const decls = declarations(r.body);
      const transition = decls.find(([p]) => p === 'transition')?.[1];
      if (transition && transition !== 'none') {
        expect(decls.some(([p, v]) => p === 'transition-duration' && /var\(--dur-fade\)\s*!important/.test(v)), `reduced transition in ${r.selector} needs an !important --dur-fade duration`).toBe(true);
      }
      const name = decls.find(([p]) => p === 'animation-name')?.[1];
      if (name && name !== 'none') {
        expect(decls.some(([p, v]) => p === 'animation-duration' && /var\(--dur-fade\)\s*!important/.test(v)), `reduced animation in ${r.selector} needs an !important --dur-fade duration`).toBe(true);
      }
    }
    // .rm-fade exists under both selectors and only touches durations
    const rmFade = styleRules.filter((r) => /^(:root\[data-reduced-motion\] )?\.rm-fade$/.test(selectors(r.selector)[0] ?? ''));
    expect(rmFade.length).toBe(2);
    for (const r of rmFade) for (const [p] of declarations(r.body)) expect(p).toMatch(/^(animation|transition)-duration$/);
  });

  it('view transitions: every ::view-transition rule is attached to its originating root (`html[…]::view-transition-…`, never the descendant form, which matches nothing — §12.1 decision 12)', () => {
    for (const r of styleRules.filter((x) => /::view-transition-/.test(x.selector))) {
      for (const s of selectors(r.selector)) expect(s, 'attached form').not.toMatch(/\s::view-transition-/);
    }
  });

  it('view transitions: the wipe, its travel variants, the theme wipe and the reduced crossfade are all declared', () => {
    // the rule that animates a selector (the blend reset on main / root shares the selector, not the job)
    const sel = (s: string): Rule | undefined => styleRules.find((r) => selectors(r.selector).includes(s) && r.media === null && /animation|scroll-behavior/.test(r.body));
    expect(sel('::view-transition-old(main)')?.body).toMatch(/kasure var\(--dur-1\)/);
    expect(sel('::view-transition-new(main)')?.body).toMatch(/meku var\(--dur-3\)/);
    expect(sel('html[data-travel="back"]::view-transition-new(main)')?.body).toMatch(/meku-back/);
    expect(sel('html[data-travel="in"]::view-transition-new(main)')?.body).toMatch(/\bmat\b/);
    expect(sel('html[data-travel="home"]::view-transition-new(main)')?.body).toMatch(/nijimi/);
    expect(sel('html[data-vt="theme"]::view-transition-new(root)')?.body).toMatch(/meku-down/);
    expect(sel('html:active-view-transition')?.body).toMatch(/scroll-behavior:\s*auto/);
    expect(keyframeRules.find((k) => k.selector === '@keyframes meku')?.body).toMatch(/clip-path:\s*inset\(0 100% 0 0\)/);
    expect(keyframeRules.find((k) => k.selector === '@keyframes meku-down')?.body).toMatch(/clip-path:\s*inset\(0 0 100% 0\)/);
  });

  it('view transitions: the media-path reduced overrides are `:root:root` (0,2,1), above every `html[data-travel] …(main)` variant (0,1,2); plus-lighter is disabled only on main and root', () => {
    const mediaVt = styleRules.filter((r) => r.media?.includes('prefers-reduced-motion: reduce') && /::view-transition-/.test(r.selector));
    expect(mediaVt.length).toBe(3);
    for (const r of mediaVt) for (const s of selectors(r.selector)) expect(s, 'reduced VT override outranks the travel variants').toMatch(/^:root:root::view-transition-(group|old|new)\(\*\)$/);
    const attrVt = styleRules.filter((r) => r.media === null && /^:root\[data-reduced-motion\]::view-transition-/.test(r.selector));
    expect(attrVt.length).toBe(3);
    // the UA crossfade (plus-lighter under isolation: isolate) stays on the hero pairs
    for (const r of styleRules.filter((x) => /isolation:\s*auto|mix-blend-mode:\s*normal/.test(x.body))) {
      for (const s of selectors(r.selector)) expect(s, 'blend reset scoped to main / root').toMatch(/^::view-transition-(image-pair|old|new)\((main|root)\)$/);
    }
  });

  it('.sign places its four text lines in column 2 under the spanning number; the tanzaku backdrop leaves the way it arrived (§6.3)', () => {
    const body = (s: string): string => styleRules.find((r) => r.media === null && selectors(r.selector).includes(s))?.body ?? '';
    expect(body('.sign__number')).toMatch(/grid-column:\s*1/);
    expect(body('.sign__number')).toMatch(/grid-row:\s*1 \/ span 4/);
    for (const c of ['.sign__ordinal', '.sign__ja', '.sign__reading', '.sign__en']) expect(body(c), c).toMatch(/grid-column:\s*2/);
    expect(body('.tanzaku__backdrop')).toMatch(/animation:\s*mat var\(--dur-2\)/);
    expect(body('.tanzaku__backdrop[data-leaving]')).toMatch(/animation-name:\s*mat-out/);
    expect(body('.tanzaku__backdrop[data-leaving]')).toMatch(/animation-duration:\s*var\(--dur-1\)/);
    expect(body('.tanzaku[data-leaving]')).toMatch(/tanzaku-out var\(--dur-1\)/);
    // the shoji's reduced form fades the whole element at --dur-fade (its panels stop translating)
    const shojiReduced = styleRules.filter((r) => core(selectors(r.selector)[0] ?? '') === '.shoji' && (r.media !== null || r.selector.startsWith(':root[data-reduced-motion]')));
    expect(shojiReduced.length).toBe(2);
    for (const r of shojiReduced) expect(r.body).toMatch(/transition-duration:\s*var\(--dur-fade\) !important/);
  });

  it('uses no color literals (tokens only) and no kanji in comments or selectors', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/\bhsla?\(/);
    expect(css).not.toMatch(/[\u3400-\u9FFF]/);
  });

  it('glows never animate and never appear in Dojo Morning rules: box-shadow / text-shadow / filter are static, --glow-* only', () => {
    for (const kf of keyframeRules) for (const p of keyframeProps(kf.body)) expect(['box-shadow', 'text-shadow', 'filter']).not.toContain(p);
    const glows = styleRules.filter((r) => /box-shadow:\s*var\(--glow-/.test(r.body));
    expect(glows.length).toBeGreaterThan(0);
    expect(glows.length).toBeLessThanOrEqual(6);
  });
});

/* ── the width / height grep over every src CSS file (design 09 §6.7 rule 1) ── */

interface Offender {
  file: string;
  kind: 'transition' | 'keyframes';
  property: string;
  /** who deletes this entry (and the rule) — design 09 §10 */
  owner: string;
}

/**
 * Pre-existing offenders, by owner. Each owner deletes its lines in the same
 * change that fixes the CSS; the match is exact, so a stale line fails too.
 */
const ALLOW_LIST: Offender[] = [
  // until C4 lands (the four src/input sites named in §10 C1, plus ListeningArena's height tween)
  { file: 'src/input/reader/reader.css', kind: 'transition', property: 'width', owner: 'C4' },
  { file: 'src/input/taiwa/RolePlay.css', kind: 'transition', property: 'width', owner: 'C4' },
  { file: 'src/input/speaking/speaking.css', kind: 'transition', property: 'width', owner: 'C4' },
  { file: 'src/input/speaking/speaking.css', kind: 'keyframes', property: 'height', owner: 'C4' },
  { file: 'src/input/listening/ListeningArena.css', kind: 'transition', property: 'height', owner: 'C4' },
  // until C1 lands (ui.css:228 ki-bar fill; MichikusaStep's reading bar)
  { file: 'src/shared/ui/ui.css', kind: 'transition', property: 'width', owner: 'C1' },
  { file: 'src/session/MichikusaStep.css', kind: 'keyframes', property: 'width', owner: 'C1' },
  // until C3 lands (charts.css:276)
  { file: 'src/records/charts.css', kind: 'transition', property: 'width', owner: 'C3' },
  // until D1 lands (GateView.css:113; WallpaperUnlock's height tween → scaleY, §6.7)
  { file: 'src/session/GateView.css', kind: 'transition', property: 'width', owner: 'D1' },
  { file: 'src/art/ceremony/WallpaperUnlock.css', kind: 'transition', property: 'height', owner: 'D1' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const SIZE_PROP = /^(min-|max-)?(width|height)$/;

function offendersIn(file: string): Offender[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rel = relative(ROOT, file);
  const out: Offender[] = [];
  for (const r of parse(text)) {
    if (r.selector.startsWith('@keyframes')) {
      const props = [...keyframeProps(r.body)].filter((p) => SIZE_PROP.test(p));
      for (const p of props) out.push({ file: rel, kind: 'keyframes', property: p, owner: '' });
      continue;
    }
    for (const [p, v] of declarations(r.body)) {
      if (p === 'transition' || p === 'transition-property') {
        for (const part of v.split(',')) {
          const prop = part.trim().split(/\s+/)[0] ?? '';
          if (SIZE_PROP.test(prop)) out.push({ file: rel, kind: 'transition', property: prop, owner: '' });
        }
      }
    }
  }
  return out;
}

const key = (o: Offender): string => `${o.file} ${o.kind} ${o.property}`;

describe('src/**/*.css: width and height never tween (design 09 §6.7 rule 1)', () => {
  const files = walk(resolve(ROOT, 'src')).sort();

  it('walks the tree', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('the offenders are exactly the allow-list — a new tween fails, and so does a stale entry once its owner lands', () => {
    const found = files.flatMap(offendersIn).map(key).sort();
    const allowed = ALLOW_LIST.map(key).sort();
    expect(found).toEqual(allowed);
  });

  it('src/styles (A1) has none', () => {
    for (const f of files.filter((p) => p.includes('/src/styles/'))) expect(offendersIn(f), relative(ROOT, f)).toEqual([]);
  });
});

/* ── the whole-programme CSS budget (design 09 §10, re-based by §12.1 decision 11) ──
   §10 asked ≤ 403 KB (377,026 at 85d7606 + 26 KB gross) and under-counted motion.css: Phase A
   landed at 412.5 KB (A1 +23 KB net with every §10 A1 class, A2–A4's shell, settings and
   generated font-slice CSS). The ceiling is therefore 415,000 for Phase A and 425,000 for the
   whole programme: Phases B–D may add at most 12.5 KB net between them, and each must delete
   what it replaces (the 49 reduced-motion blocks, the bar and status-window clones, the 13
   result panels). Each phase's integrator raises this constant only up to CSS_CEILING_PROGRAMME.
   Phase B landed at 420,757 B (B1 Dojo home +5,982: pages.css, DojoScene.css; B2 End Card +856:
   EndCard.css, TrainPage.css; B3 shell +1,405: Layout.css, App.css), so the phase ceiling is
   421,000 — the smallest multiple of 1,000 above the measured tree — and the constant is renamed
   CSS_CEILING_PHASE (it was CSS_CEILING_PHASE_A = 415,000). Phases C–D have 4,243 B net left. */
const CSS_CEILING_PHASE = 421_000;
export const CSS_CEILING_PROGRAMME = 425_000;
describe('CSS budget', () => {
  it(`total src CSS ≤ ${CSS_CEILING_PHASE.toLocaleString('en-US')} bytes (phase ceiling, Phase B; the programme ends ≤ ${CSS_CEILING_PROGRAMME.toLocaleString('en-US')})`, () => {
    expect(CSS_CEILING_PHASE).toBeLessThanOrEqual(CSS_CEILING_PROGRAMME);
    const files = walk(resolve(ROOT, 'src'));
    const total = files.reduce((n, f) => n + statSync(f).size, 0);
    const byDir = new Map<string, number>();
    for (const f of files) {
      const dir = relative(ROOT, f).split('/').slice(0, 2).join('/');
      byDir.set(dir, (byDir.get(dir) ?? 0) + statSync(f).size);
    }
    const report = [...byDir.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', ');
    expect(total, `src CSS bytes (${report})`).toBeLessThanOrEqual(CSS_CEILING_PHASE);
  });
});
