import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/app/pages/settings.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('settings.css (design 09 §7 G: the theme swatches)', () => {
  it('uses no color literals (tokens only) and brings no motion of its own (the theme change rides the View Transition)', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\b(animation|transition)\b/);
    expect(css).not.toMatch(/@keyframes/);
  });

  it('the swatch is 48 px square, holds a tiny status window, and has a variant for every theme radio', () => {
    const swatch = block('.theme-swatch');
    expect(swatch).toMatch(/inline-size:\s*48px/);
    expect(swatch).toMatch(/block-size:\s*48px/);
    expect(swatch).toMatch(/overflow:\s*hidden/);
    for (const kind of ['auto', 'light', 'dark', 'sky']) expect(css, kind).toContain(`.theme-swatch[data-swatch="${kind}"] {`);
    const frame = block(':root .theme-swatch .theme-swatch__frame.status-window');
    expect(frame).toMatch(/border:\s*2px double currentColor/);
    expect(frame).toMatch(/inline-size:\s*26px/);
    expect(frame).toMatch(/block-size:\s*16px/);
  });

  it('washi and lacquer come from the invariant stage tokens with the belt white / black as fallbacks; the sky swatch is painted from the runtime --sky-* tokens', () => {
    const swatch = block('.theme-swatch');
    expect(swatch).toMatch(/--swatch-washi:\s*var\(--stage-fg,\s*var\(--belt-white\)\)/);
    expect(swatch).toMatch(/--swatch-lacquer:\s*var\(--stage-bg,\s*var\(--belt-black\)\)/);
    const sky = block('.theme-swatch[data-swatch="sky"]');
    expect(sky).toMatch(/var\(--sky-top/);
    expect(sky).toMatch(/var\(--sky-mid/);
    expect(sky).toMatch(/var\(--sky-horizon/);
    expect(block('.theme-swatch[data-swatch="dark"]')).toMatch(/--swatch-paper:\s*var\(--swatch-lacquer\)/);
    expect(block('.theme-swatch[data-swatch="light"]')).toMatch(/--swatch-paper:\s*var\(--swatch-washi\)/);
  });

  it('the frame opts out of the Night hairline and the 6 px notches at (0,4,0) — above components.css\'s :root[data-color-scheme="dark"] .status-window (0,3,0) — and the radio gains block padding for the 48 px swatch', () => {
    const frame = block(':root .theme-swatch .theme-swatch__frame.status-window');
    expect(frame).toMatch(/box-shadow:\s*none/);
    expect(frame).toMatch(/clip-path:\s*polygon\(\s*3px 0,/);
    expect(frame).not.toMatch(/\b6px/); // 26px is the frame's width, 6px would be the big notch
    expect(block('.set__radio:has(.theme-swatch)')).toMatch(/padding-block:\s*var\(--sp-1\)/);
    expect(css).not.toMatch(/!important/);
  });
});
