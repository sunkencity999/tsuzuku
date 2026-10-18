import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { ChoiceGrid, choiceState, type ChoiceGridProps } from './ChoiceGrid';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

const step: Step = {
  id: 's1',
  block: 'reviews',
  exercise: 'meaning-guard',
  itemId: 'v-n5-0001',
  cardKey: 'v-n5-0001#rec',
  params: {},
  timed: false,
  isNew: false,
  stepTag: null,
  exposures: 3,
  estMs: 6000,
};

function inFrame(children: preact.ComponentChildren): preact.JSX.Element {
  return (
    <ExerciseFrame
      step={step}
      index={0}
      total={5}
      ki={10}
      combo={0}
      comboTier={0}
      timer={null}
      feel="dojo"
      feedback={null}
      now={() => 0}
      onGuard={() => undefined}
      onHint={() => undefined}
      onPause={() => undefined}
      onContinue={() => undefined}
    >
      {children}
    </ExerciseFrame>
  );
}

function press(key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    document.body.dispatchEvent(e);
  });
  return e;
}

function buttons(): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
}

/** Drives `picked` from the pick like a real exercise does. */
function Harness(p: Omit<ChoiceGridProps, 'onPick' | 'picked'> & { onPick: (i: number) => void }) {
  const [picked, setPicked] = useState<number | undefined>(undefined);
  return (
    <ChoiceGrid
      {...p}
      picked={picked}
      onPick={(i) => {
        p.onPick(i);
        setPicked(i);
      }}
    />
  );
}

describe('<ChoiceGrid>', () => {
  it('renders one 44px-class button per choice with digit hints, group label and lang="ja" when asked', () => {
    act(() => render(<ChoiceGrid choices={['ねこ', 'いぬ', 'とり', 'うま']} onPick={() => undefined} ja />, root));
    const grid = root.querySelector('.choice-grid');
    expect(grid?.getAttribute('role')).toBe('group');
    expect(grid?.getAttribute('aria-label')).toBe('Choices');
    expect(grid?.getAttribute('data-columns')).toBe('2');
    const bs = buttons();
    expect(bs.length).toBe(4);
    expect(bs.map((b) => b.querySelector('kbd')?.textContent)).toEqual(['1', '2', '3', '4']);
    expect(bs[0]?.getAttribute('aria-keyshortcuts')).toBe('1');
    expect(bs[0]?.querySelector('[lang="ja"]')?.textContent).toBe('ねこ');
    expect(bs.every((b) => !b.disabled)).toBe(true);
    expect(bs.every((b) => b.getAttribute('data-state') === 'idle')).toBe(true);
  });

  it('uses 3 columns from five choices and honors an explicit columns prop', () => {
    act(() => render(<ChoiceGrid choices={['a', 'b', 'c', 'd', 'e', 'f']} onPick={() => undefined} />, root));
    expect(root.querySelector('.choice-grid')?.getAttribute('data-columns')).toBe('3');
    act(() => render(<ChoiceGrid choices={['a', 'b']} onPick={() => undefined} columns={3} />, root));
    expect(root.querySelector('.choice-grid')?.getAttribute('data-columns')).toBe('3');
  });

  it('keys 1–9 map to 0-based indices through the frame; digits past the last choice are ignored', () => {
    const onPick = vi.fn();
    act(() => render(inFrame(<ChoiceGrid choices={['a', 'b', 'c']} onPick={onPick} />), root));
    const e = press('3');
    expect(onPick).toHaveBeenCalledWith(2);
    expect(e.defaultPrevented).toBe(true);
    act(() => render(inFrame(<ChoiceGrid choices={['a', 'b', 'c']} onPick={onPick} />), root));
    press('4');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('fires onPick once: a tap locks the grid, later taps and digits do nothing', () => {
    const onPick = vi.fn();
    act(() => render(inFrame(<Harness choices={['a', 'b', 'c', 'd']} onPick={onPick} correct={1} />), root));
    act(() => buttons()[1]?.click());
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(1);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(root.querySelector('.choice-grid')?.getAttribute('data-locked')).toBe('true');
    act(() => buttons()[2]?.click());
    press('3');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when `picked` is set from outside, even before any click', () => {
    const onPick = vi.fn();
    act(() => render(<ChoiceGrid choices={['a', 'b']} onPick={onPick} picked={0} correct={0} />, root));
    expect(buttons().every((b) => b.disabled)).toBe(true);
    act(() => buttons()[1]?.click());
    expect(onPick).not.toHaveBeenCalled();
  });

  it('reveals correct / wrong / missed as state attributes, marks and screen-reader text', () => {
    act(() => render(<ChoiceGrid choices={['a', 'b', 'c']} onPick={() => undefined} picked={1} correct={1} />, root));
    expect(buttons().map((b) => b.getAttribute('data-state'))).toEqual(['idle', 'correct', 'idle']);
    expect(buttons()[1]?.querySelector('.choice__mark')?.textContent).toBe('○');
    expect(buttons()[1]?.textContent).toContain('(correct)');

    act(() => render(<ChoiceGrid choices={['a', 'b', 'c']} onPick={() => undefined} picked={0} correct={2} />, root));
    expect(buttons().map((b) => b.getAttribute('data-state'))).toEqual(['wrong', 'idle', 'missed']);
    expect(buttons()[0]?.querySelector('.choice__mark')?.textContent).toBe('×');
    expect(buttons()[0]?.textContent).toContain('(your answer)');
    expect(buttons()[2]?.textContent).toContain('(the answer)');
  });

  it('reveal without a pick (timeout / Guard) locks and shows only the missed answer', () => {
    act(() => render(<ChoiceGrid choices={['a', 'b']} onPick={() => undefined} reveal correct={1} />, root));
    expect(buttons().map((b) => b.getAttribute('data-state'))).toEqual(['idle', 'missed']);
    expect(buttons().every((b) => b.disabled)).toBe(true);
  });

  it('a pick with no correct index is a neutral "picked" state (ungraded grids)', () => {
    act(() => render(<ChoiceGrid choices={['○', '×']} onPick={() => undefined} picked={0} ja size="lg" />, root));
    expect(buttons().map((b) => b.getAttribute('data-state'))).toEqual(['picked', 'idle']);
    expect(root.querySelector('.choice-grid')?.getAttribute('data-size')).toBe('lg');
  });

  it('renders ruby markup through <Ruby> when a furigana mode is given', () => {
    act(() => render(<ChoiceGrid choices={['{食|た}べる', '{飲|の}む']} onPick={() => undefined} ruby="always" />, root));
    const rubies = root.querySelectorAll('ruby');
    expect(rubies.length).toBe(2);
    expect(rubies[0]?.querySelector('rt')?.textContent).toBe('た');
    expect(root.querySelector('.choice [lang="ja"]')).not.toBeNull();
  });

  it('re-arms when the same instance receives a new choice set (next step without a remount)', () => {
    const onPick = vi.fn();
    act(() => render(<ChoiceGrid choices={['a', 'b']} onPick={onPick} picked={0} correct={0} />, root));
    expect(buttons().every((b) => b.disabled)).toBe(true);
    act(() => render(<ChoiceGrid choices={['c', 'd']} onPick={onPick} correct={1} />, root));
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(buttons().map((b) => b.getAttribute('data-state'))).toEqual(['idle', 'idle']);
    act(() => buttons()[1]?.click());
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it('disabled prop locks without revealing', () => {
    const onPick = vi.fn();
    act(() => render(<ChoiceGrid choices={['a', 'b']} onPick={onPick} disabled correct={0} />, root));
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(buttons().map((b) => b.getAttribute('data-state'))).toEqual(['idle', 'idle']);
  });
});

describe('<ChoiceGrid> motion (design 09 §7 I Bokuten, §7 J)', () => {
  it('tiles mount as .ink-nijimi with a --i stagger index', () => {
    act(() => render(<ChoiceGrid choices={['a', 'b', 'c']} onPick={() => undefined} />, root));
    const bs = buttons();
    expect(bs.every((b) => b.classList.contains('ink-nijimi'))).toBe(true);
    expect(bs.map((b) => b.style.getPropertyValue('--i'))).toEqual(['0', '1', '2']);
  });

  it('the correct tile carries the splatter dot, the wrong tile the dry-brush strike (three hiku strokes), and ChoiceGrid.css has no line-through', () => {
    act(() => render(<ChoiceGrid choices={['a', 'b', 'c']} onPick={() => undefined} picked={0} correct={2} />, root));
    const [wrong, idle, missed] = buttons();
    const strike = wrong?.querySelector('.choice__text .choice__strike');
    expect(strike).not.toBeNull();
    expect(strike?.getAttribute('aria-hidden')).toBe('true');
    const strokes = Array.from(strike?.querySelectorAll('path') ?? []);
    expect(strokes).toHaveLength(3);
    for (const s of strokes) {
      expect(s.classList.contains('ink-hiku')).toBe(true);
      expect(s.getAttribute('data-axis')).toBe('stroke');
      expect(s.getAttribute('pathLength')).toBe('1');
    }
    expect(wrong?.querySelector('.choice__dot')).toBeNull();
    expect(idle?.querySelector('.choice__strike, .choice__dot')).toBeNull();
    expect(missed?.querySelector('.choice__strike, .choice__dot')).toBeNull();
    act(() => render(<ChoiceGrid choices={['a', 'b', 'c']} onPick={() => undefined} picked={2} correct={2} />, root));
    const correct = buttons()[2]!;
    const dot = correct.querySelector('.choice__dot')!;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(correct.querySelector('.choice__strike')).toBeNull();
    // the ○ paints over the ink: the mark follows the dot in the DOM
    const mark = correct.querySelector('.choice__mark')!;
    expect(mark.textContent).toBe('○');
    expect(dot.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the state text is base.css's .sr-only, not a local copy
    expect(correct.querySelector('.sr-only')?.textContent).toContain('(');
    expect(root.querySelector('.choice__sr')).toBeNull();
    const css = readFileSync(resolve(process.cwd(), 'src/exercises/ChoiceGrid.css'), 'utf8');
    expect(css).not.toContain('line-through');
    expect(css).not.toContain('.choice__sr');
    expect(css).toMatch(/\.choice__dot \{[^}]*mask: url\("data:image\/svg\+xml/);
    // the strike is ink, not red (§7 I ethical line)
    expect(css.match(/\.choice__strike path \{([^}]*)\}/)?.[1]).toMatch(/stroke: var\(--fg\)/);
  });

  it('under reduced motion no .ink-* class and no --i ride the tiles; the strike is drawn complete (no verb class)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    act(() => render(<ChoiceGrid choices={['a', 'b']} onPick={() => undefined} picked={0} correct={1} />, root));
    for (const b of buttons()) {
      expect(Array.from(b.classList).some((c) => c.startsWith('ink-'))).toBe(false);
      expect(b.style.getPropertyValue('--i')).toBe('');
      expect(b.querySelector('[class*="ink-"]')).toBeNull();
    }
    expect(buttons()[0]?.querySelectorAll('.choice__strike path')).toHaveLength(3);
  });
});

describe('choiceState', () => {
  it.each([
    [0, undefined, 1, false, 'idle'],
    [1, 1, 1, false, 'correct'],
    [0, 0, 1, false, 'wrong'],
    [1, 0, 1, false, 'missed'],
    [2, 0, 1, false, 'idle'],
    [1, undefined, 1, true, 'missed'],
    [0, undefined, 1, true, 'idle'],
    [0, 0, undefined, false, 'picked'],
    [1, 0, undefined, false, 'idle'],
  ] as const)('choiceState(%i, %s, %s, %s) = %s', (i, picked, correct, reveal, want) => {
    expect(choiceState(i, picked, correct, reveal)).toBe(want);
  });
});
