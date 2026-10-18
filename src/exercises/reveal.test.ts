/**
 * The result-panel contract of design 09 §10 C1 (owner C1), asserted on the CSS
 * text (jsdom applies no stylesheet): `.reveal[data-kind]` in ui.css is THE
 * panel; none of the thirteen local panels keeps a rule in src/exercises; the
 * ui.css duplicates of A1's canonical classes (.sr-only, @keyframes belt-flip,
 * the combo tiers) and the two width tweens C1 owned are gone.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ui = read('src/shared/ui/ui.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The thirteen local result-panel selectors C1 deleted (design 09 §5, §10 C1), by file. */
export const DELETED_PANELS: Record<string, string[]> = {
  'src/exercises/TextAnswer.css': ['.text-answer__reveal', '.text-answer__confirm'],
  'src/exercises/grammar/grammar.css': ['.gr__reveal'],
  'src/exercises/kanji/kanji.css': ['.kj__reveal'],
  'src/exercises/grammar/Scramble.css': ['.scramble__result'],
  'src/exercises/grammar/JudgmentCall.css': ['.judgment__explain'],
  'src/exercises/grammar/Transform.css': ['.transform__missing', '.transform__hint'],
  'src/exercises/listening/SentenceListen.css': ['.listen__result', '.listen__hint'],
  'src/exercises/listening/MinimalPair.css': ['.pair__result'],
  'src/exercises/fluency/NemesisDossier.css': ['.nemesis__line', '.nemesis__hint'],
};

/** Does `css` still declare a rule whose selector list starts a selector with `sel` as the panel itself (not a descendant rule such as `.x__hint small`)? */
function declaresPanel(css: string, sel: string): boolean {
  const re = new RegExp(`(^|[\\n,])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\[[^\\]]*\\])?\\s*(,|\\{)`, 'm');
  return re.test(css);
}

describe('.reveal[data-kind] — the one result panel (ui.css)', () => {
  it('declares the panel and its five kinds, enters by the verb class and tweens nothing (the panel is wider than rule 1\'s 160 px; margins are base.css\'s reset)', () => {
    const rule = ui.match(/\.reveal \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/border-left: 4px solid var\(--reveal-tone\)/);
    for (const k of ['correct', 'wrong', 'partial', 'teach', 'info']) expect(ui, k).toMatch(new RegExp(`\\.reveal\\[data-kind='${k}'\\]`));
    expect(rule).not.toMatch(/transition/);
    expect(rule).not.toMatch(/margin/);
    expect(ui).not.toMatch(/\.reveal p \{/);
    expect(ui).not.toMatch(/\.reveal[^{]*\{[^}]*animation:/);
  });

  it('a .reveal panel is never a .status-window, and no clipped window carries the nijimi verb itself (§6.7 rule 7)', () => {
    const files = [...walk(resolve(process.cwd(), 'src/exercises')), ...['Feedback', 'JudgeCard', 'TeachOnce', 'ExerciseFrame'].map((n) => resolve(process.cwd(), `src/shared/ui/${n}.tsx`))].filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/class(Name)?=/.test(line)) return;
        expect(line.includes('ink-nijimi') && line.includes('status-window'), `${f}:${i + 1} transforms a clipped window`).toBe(false);
        expect(/\breveal\b/.test(line) && line.includes('status-window'), `${f}:${i + 1} .reveal on a .status-window`).toBe(false);
      });
    }
    // the windows sit inside the verb's wrapper
    expect(readFileSync(resolve(process.cwd(), 'src/shared/ui/JudgeCard.tsx'), 'utf8')).toMatch(/judge-card__wrap ink-nijimi/);
    expect(ui).toMatch(/\.teach-once__card\.status-window \{/);
    expect(ui.match(/\.teach-once \{([^}]*)\}/)?.[1]).not.toMatch(/display: grid/);
  });

  it('the thirteen local panels keep no rule in src/exercises', () => {
    expect(Object.values(DELETED_PANELS).flat()).toHaveLength(13);
    for (const [file, sels] of Object.entries(DELETED_PANELS)) {
      const css = read(file);
      for (const sel of sels) expect(declaresPanel(css, sel), `${file} still declares ${sel}`).toBe(false);
      expect(css).not.toMatch(/border-left: 4px solid var\(--line\)/);
    }
  });

  it('the exercise CSS and the session CSS carry no per-file reduced-motion block (base.css and the zeroed tokens cover them)', () => {
    const files = [...Object.keys(DELETED_PANELS), 'src/exercises/ChoiceGrid.css', 'src/exercises/PitchLine.css', 'src/exercises/vocab/vocab.css', 'src/session/Hud.css', 'src/session/MichikusaStep.css', 'src/shared/ui/ui.css'];
    for (const f of files) {
      const css = read(f);
      expect(css, f).not.toMatch(/prefers-reduced-motion/);
      expect(css, f).not.toMatch(/\.reduced-motion/);
    }
    // SessionView.css keeps exactly the ghost's --dur-fade crossfade (a reduced form that CHANGES, §6.6)
    const sv = read('src/session/SessionView.css');
    expect(sv.match(/prefers-reduced-motion/g)).toHaveLength(1);
    expect(sv).toMatch(/\.session__ghost \{\s*animation-name: mat-out/);
    expect(sv).toMatch(/:root\[data-reduced-motion\] \.session__ghost/);
  });
});

describe('ui.css drops its duplicates of the canonical classes (design 09 §6.5, §10 A1 / C1)', () => {
  it('no .sr-only, no belt-flip keyframes, no combo tier, no width transition', () => {
    expect(ui).not.toMatch(/\.sr-only/);
    expect(ui).not.toMatch(/@keyframes belt-flip/);
    expect(ui).not.toMatch(/\.combo\[data-tier/);
    expect(ui).not.toMatch(/\.combo\b[^{]*\{/);
    expect(ui).not.toMatch(/transition:[^;]*\bwidth\b/);
    expect(ui).not.toMatch(/@keyframes (fb-in|judge-in)/);
    // the belt chip still references A1's keyframes and keeps its static swatch colours
    expect(ui).toMatch(/\.belt-flip \{[^}]*animation: belt-flip var\(--dur-2\)/);
    expect(ui).toMatch(/\.belt-flip\[data-belt='green'\]::before/);
  });

  it('the ki track is a .meter; a full bar recolours it and charges the hanko statically — a kin ring in Morning, --glow-shu in Night', () => {
    expect(ui).not.toMatch(/\.ki-bar__fill/);
    expect(ui).toMatch(/\.ki-bar\[data-full='true'\] \.ki-bar__track \{\s*--meter-tone: var\(--shu\)/);
    expect(ui).toMatch(/\.exercise-frame \.hanko--charged \{[^}]*var\(--kin\)/);
    expect(ui).toMatch(/:root\[data-color-scheme='dark'\] \.exercise-frame \.hanko--charged \{[^}]*var\(--glow-shu\)/);
    expect(ui).not.toMatch(/\.hanko--charged[^{]*\{[^}]*(animation|transition)/);
  });

  it('MichikusaStep.css has no width keyframes; its read line is a .meter fill drawn with hiku over a --dur-5 multiple', () => {
    const css = read('src/session/MichikusaStep.css');
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/__read-fill \{[^}]*width/);
    expect(css).toMatch(/\.michikusa__read-fill \{[^}]*animation: hiku calc\(var\(--dur-5\) \* 4\)/);
  });

  it('ChoiceGrid.css: the strike replaced line-through; the dot is a static mask pressed over --dur-1, the strike drawn over --dur-2', () => {
    const css = read('src/exercises/ChoiceGrid.css');
    expect(css).not.toMatch(/line-through/);
    expect(css).toMatch(/\.choice__dot \{[^}]*mask: url\("data:image\/svg\+xml/);
    expect(css).toMatch(/\.choice__dot \{[^}]*animation: osu var\(--dur-1\)/);
    expect(css).not.toMatch(/filter:/);
    expect(css).toMatch(/\.choice \.choice__strike \.ink-hiku \{\s*animation-duration: var\(--dur-2\)/);
  });

  it('the exercise labels are the shared .eyebrow: no __label rule carries the eyebrow typography, ui.css has no .feedback__label', () => {
    const files = ['src/exercises/TextAnswer.css', 'src/exercises/grammar/grammar.css', 'src/exercises/grammar/Scramble.css', 'src/exercises/grammar/Transform.css', 'src/exercises/grammar/JudgmentCall.css', 'src/exercises/kanji/kanji.css', 'src/exercises/listening/SentenceListen.css', 'src/exercises/listening/MinimalPair.css', 'src/exercises/fluency/NemesisDossier.css', 'src/exercises/vocab/vocab.css'];
    for (const f of files) {
      const css = read(f);
      for (const m of css.matchAll(/([^{}]*__label[^{}]*)\{([^}]*)\}/g)) {
        expect(m[2], `${f}: ${m[1]?.trim()} still hand-rolls the eyebrow`).not.toMatch(/text-transform|letter-spacing|font-family: var\(--font-pixel\)/);
      }
    }
    expect(ui).not.toMatch(/\.feedback__label/);
    // the markup swapped to the class (a sample from each family)
    for (const f of ['src/exercises/TextAnswer.tsx', 'src/exercises/grammar/FormChain.tsx', 'src/exercises/kanji/KanjiRead.tsx', 'src/exercises/listening/SentenceListen.tsx', 'src/exercises/fluency/NemesisDossier.tsx', 'src/exercises/kana/KanaForge.tsx', 'src/exercises/vocab/MeaningGuard.tsx', 'src/shared/ui/Feedback.tsx']) {
      const tsx = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(tsx, f).toMatch(/class="eyebrow/);
      expect(tsx, f).not.toMatch(/class="(gr|kj|text-answer|drill|feedback|transform|scramble)__label"/);
    }
  });

  it('the strike is ink (--fg, never --shu), the state text is base.css\'s .sr-only, 一本 is written through a 300 ms stroke mask, kanji drills set no Mincho (§3.1 fence)', () => {
    const cg = read('src/exercises/ChoiceGrid.css');
    expect(cg.match(/\.choice__strike path \{([^}]*)\}/)?.[1]).toMatch(/stroke: var\(--fg\)/);
    expect(cg.match(/\.choice__strike path \{([^}]*)\}/)?.[1]).not.toMatch(/--shu/);
    expect(cg).not.toMatch(/\.choice__sr/);
    expect(ui).not.toMatch(/@keyframes ippon/);
    expect(ui).not.toMatch(/scale\(1\.4\)/);
    expect(ui).toMatch(/\.ippon \.ink-hiku \{\s*animation-duration: calc\(var\(--dur-3\) \* 0\.75\)/);
    expect(read('src/exercises/kanji/kanji.css')).not.toMatch(/--font-mincho/);
  });

  it('TextAnswer.css draws the ink rule by scaleX over --dur-2 and sets a vermilion caret; PitchLine draws its contour over --dur-3', () => {
    const ta = read('src/exercises/TextAnswer.css');
    expect(ta).toMatch(/\.text-answer__ink::after \{[^}]*transform: scaleX\(0\)[^}]*transition: transform var\(--dur-2\)/);
    expect(ta).toMatch(/\.text-answer__ink:focus-within::after \{\s*transform: scaleX\(1\)/);
    // d58/d63: the rule lifts --sp-1 off the border; KanaInput owns the ja field's rule, so the frame's is off there
    expect(ta).toMatch(/\.text-answer__ink::after \{[^}]*bottom: var\(--sp-1\)/);
    expect(ta).toMatch(/\.text-answer__ink\[data-mode='ja'\]::after \{\s*content: none;/);
    expect(ta).not.toMatch(/\[data-mode='ja'\]::after \{\s*bottom: calc\(/);
    expect(ta).toMatch(/caret-color: var\(--shu\)/);
    expect(ui).toMatch(/\.kana-input__field \{[^}]*caret-color: var\(--shu\)/);
    expect(read('src/exercises/PitchLine.css')).toMatch(/\.pitch-svg \.pitch-svg__line\.ink-hiku \{\s*animation-duration: var\(--dur-3\)/);
  });
});
