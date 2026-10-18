import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { KanaInput } from './KanaInput';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

interface HarnessProps {
  initial?: string;
  candidates?: string[];
  katakana?: boolean;
  clearOnSubmit?: boolean;
  maxLength?: number;
  onSubmit: (v: string) => void;
  log: string[];
}

function Harness(p: HarnessProps) {
  const [v, setV] = useState(p.initial ?? '');
  return (
    <KanaInput
      value={v}
      onChange={(x) => {
        p.log.push(x);
        setV(x);
      }}
      onSubmit={(x) => {
        p.onSubmit(x);
        if (p.clearOnSubmit) setV('');
      }}
      candidates={p.candidates}
      katakana={p.katakana}
      maxLength={p.maxLength}
    />
  );
}

function mount(p: Partial<HarnessProps> = {}) {
  const log: string[] = [];
  const onSubmit = vi.fn();
  act(() => render(<Harness {...p} log={log} onSubmit={onSubmit} />, root));
  const input = root.querySelector('input') as HTMLInputElement;
  return { log, onSubmit, input };
}

function type(input: HTMLInputElement, keys: string): void {
  for (const ch of keys) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function key(input: HTMLInputElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    input.dispatchEvent(e);
  });
  return e;
}

describe('<KanaInput>', () => {
  it("typing 'tsuduku' yields つづく with pending romaji shown along the way", () => {
    const { input, log } = mount();
    type(input, 'tsud');
    expect(input.value).toBe('つd');
    expect(root.querySelector('.kana-input')?.getAttribute('data-pending')).toBe('d');
    type(input, 'uku');
    expect(input.value).toBe('つづく');
    expect(log[log.length - 1]).toBe('つづく');
    expect(root.querySelector('.kana-input')?.getAttribute('data-pending')).toBeNull();
  });

  it("resolves Hepburn 'kanna' → かんな through the raw buffer", () => {
    const { input } = mount();
    type(input, 'kanna');
    expect(input.value).toBe('かんな');
  });

  it('backspace removes pending romaji before converted kana', () => {
    const { input } = mount();
    type(input, 'kak');
    expect(input.value).toBe('かk');
    act(() => {
      input.value = 'か';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('か');
    type(input, 'ki');
    expect(input.value).toBe('かき');
  });

  it('Caps Lock toggles katakana (and the カナ button reflects it)', () => {
    const { input } = mount();
    const btn = root.querySelector('.kana-input__kata') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    key(input, 'CapsLock');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    type(input, 'ka');
    expect(input.value).toBe('カ');
    key(input, 'CapsLock');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(input.value).toBe('か');
  });

  it('katakana prop presets the mode', () => {
    const { input } = mount({ katakana: true });
    type(input, 'tesuto');
    expect(input.value).toBe('テスト');
  });

  it('Space cycles candidates and returns to the typed kana', () => {
    const { input, log } = mount({ candidates: ['続く', '着く'] });
    type(input, 'tsuduku');
    expect(input.value).toBe('つづく');
    const e = key(input, ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(input.value).toBe('続く');
    key(input, ' ');
    expect(input.value).toBe('着く');
    key(input, ' ');
    expect(input.value).toBe('つづく');
    expect(log.slice(-3)).toEqual(['続く', '着く', 'つづく']);
  });

  it('Space is a plain character without candidates', () => {
    const { input } = mount();
    type(input, 'ka');
    const e = key(input, ' ');
    expect(e.defaultPrevented).toBe(false);
  });

  it('Enter calls onSubmit once with the finalized value (trailing n → ん)', () => {
    const { input, onSubmit, log } = mount();
    type(input, 'hon');
    expect(input.value).toBe('ほn');
    const e = key(input, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('ほん');
    expect(log[log.length - 1]).toBe('ほん');
    expect(input.value).toBe('ほん');
  });

  it('Shift+Enter is left to the frame (no submit)', () => {
    const { input, onSubmit } = mount();
    type(input, 'ka');
    const e = key(input, 'Enter', { shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a parent reset re-bases the buffer', () => {
    const { input, onSubmit } = mount({ clearOnSubmit: true });
    type(input, 'tsuduku');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('つづく');
    expect(input.value).toBe('');
    type(input, 'ka');
    expect(input.value).toBe('か');
  });

  it('native IME composition is not double-converted', () => {
    const { input, log } = mount();
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    act(() => {
      input.value = 'tsu';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // mid-composition text passes through untouched
    expect(input.value).toBe('tsu');
    act(() => {
      input.value = 'つづく';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'つづく' }));
    });
    expect(input.value).toBe('つづく');
    expect(log[log.length - 1]).toBe('つづく');
    // typing romaji afterwards appends and converts
    type(input, 'ka');
    expect(input.value).toBe('つづくか');
  });

  it('Enter during native IME composition never submits; Enter after compositionend submits the finalized value once', () => {
    const { input, onSubmit } = mount();
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    act(() => {
      input.value = 'つd';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // the IME's own Enter (candidate confirm) is flagged isComposing on modern browsers …
    const e1 = key(input, 'Enter', { isComposing: true });
    expect(e1.defaultPrevented).toBe(false);
    // … and only as keyCode 229 on older Android keyboards
    const e2 = key(input, 'Enter', { keyCode: 229 });
    expect(e2.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('つd');
    act(() => {
      input.value = 'つづく';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'つづく' }));
    });
    const e3 = key(input, 'Enter');
    expect(e3.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('つづく');
  });

  it('has a 44px-friendly field with aria label and lang="ja"', () => {
    const { input } = mount();
    expect(input.getAttribute('lang')).toBe('ja');
    expect(input.getAttribute('aria-label')).toBe('Answer');
    expect(input.classList.contains('kana-input__field')).toBe(true);
  });
});

describe('<KanaInput> hiku underline (design 09 §12.1 d58)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the field sits in a .kana-input__ink wrapper that takes .ink-hiku[data-axis="x"] on focus and drops it on blur', () => {
    const { input } = mount();
    const ink = input.parentElement!;
    expect(ink.classList.contains('kana-input__ink')).toBe(true);
    expect(ink.parentElement?.classList.contains('kana-input')).toBe(true);
    expect(ink.classList.contains('ink-hiku')).toBe(false);
    expect(ink.hasAttribute('data-axis')).toBe(false);
    act(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);
    expect(ink.classList.contains('ink-hiku')).toBe(true);
    expect(ink.getAttribute('data-axis')).toBe('x');
    // the field itself never carries the verb (the wrapper's pseudo-element draws; the input is not scaled)
    expect(input.classList.contains('ink-hiku')).toBe(false);
    act(() => {
      input.blur();
    });
    expect(ink.classList.contains('ink-hiku')).toBe(false);
    expect(ink.hasAttribute('data-axis')).toBe(false);
  });

  it('under reduced motion the wrapper stays and the verb class is never set (the line stands through :focus-within)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    const { input } = mount();
    act(() => {
      input.focus();
    });
    const ink = input.parentElement!;
    expect(ink.classList.contains('kana-input__ink')).toBe(true);
    expect(ink.classList.contains('ink-hiku')).toBe(false);
    expect(ink.hasAttribute('data-axis')).toBe(false);
    expect(root.querySelector('.ink-hiku')).toBeNull();
  });

  it('ui.css: the underline is a scaled pseudo-element (never width) drawn over --dur-2 by the verb and standing on :focus-within; the vermilion caret stays', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/shared/ui/ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const after = /\.kana-input__ink::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(after).toMatch(/scale:\s*0 1/);
    expect(after).toMatch(/background:\s*var\(--ai\)/); // the ink rule is indigo like the focus border and TextAnswer's; the caret alone is vermilion
    expect(after).toMatch(/transform-origin:\s*left/);
    // the rule sits 4 px above the field's foot, off the border that turns the same indigo on focus, so the draw reads
    expect(after).toMatch(/inset:\s*auto var\(--sp-3\) var\(--sp-1\)/);
    // the block names no other group's class (the brief's allowance is the .kana-input* rules alone)
    expect(css).not.toMatch(/text-answer/);
    expect(after).not.toMatch(/\bwidth\s*:/);
    expect(/\.kana-input__ink:focus-within::after\s*\{[^}]*scale:\s*1 1/.test(css)).toBe(true);
    expect(/\.kana-input__ink\.ink-hiku\[data-axis='x'\]\s*\{[^}]*animation:\s*none/.test(css)).toBe(true);
    expect(/\.kana-input__ink\.ink-hiku\[data-axis='x'\]::after\s*\{[^}]*animation:\s*hiku var\(--dur-2\) var\(--ease-draw\) both/.test(css)).toBe(true);
    expect(/\.kana-input__field\s*\{[^}]*caret-color:\s*var\(--shu\)/.test(css)).toBe(true);
    for (const rule of css.match(/\.kana-input[^{]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/transition:[^;]*\b(width|height)\b/);
      expect(rule).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    }
  });
});

describe('<KanaInput> maxLength', () => {
  const paste = (input: HTMLInputElement, v: string): void => {
    act(() => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('caps the resolved kana at maxLength code points while letting a syllable finish at the boundary', () => {
    const { input, log } = mount({ maxLength: 3 });
    type(input, 'kakish'); // か き + pending "sh": the letters may run past the cap while a syllable is spelled
    expect(input.value).toBe('かきsh');
    type(input, 'i');
    expect(input.value).toBe('かきし');
    type(input, 'ta'); // the 4th glyph is dropped once it resolves
    expect(input.value).toBe('かきし');
    expect(log[log.length - 1]).toBe('かきし');
    expect(root.querySelector('.kana-input')?.getAttribute('data-pending')).toBeNull();
    // the native attribute is deliberately absent (it would count UTF-16 units of kana + pending romaji)
    expect(input.hasAttribute('maxlength')).toBe(false);
  });

  it('caps a pasted value, a natively composed value and the Enter finalisation; astral glyphs count once', () => {
    const { input, onSubmit } = mount({ maxLength: 3 });
    paste(input, 'かきくけこ');
    expect(input.value).toBe('かきく');
    // a paste at the cap that changes nothing still leaves the DOM at the cap (no re-render comes from the parent)
    paste(input, 'かきくけ');
    expect(input.value).toBe('かきく');
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    paste(input, 'さしすせそ');
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'さしすせそ' }));
    });
    expect(input.value).toBe('さしす');
    paste(input, '');
    type(input, 'kakishin');
    expect(input.value).toBe('かきしn');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('かきし');
    expect(input.value).toBe('かきし');
    paste(input, '');
    paste(input, '😀😀😀😀');
    expect(input.value).toBe('😀😀😀');
  });

  it('without maxLength nothing is cut', () => {
    const { input } = mount();
    type(input, 'kakikukeko');
    expect(input.value).toBe('かきくけこ');
  });
});
