import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mulberry32, shuffle } from '../hash';
import type { Step } from '../session-types';
import { ExerciseFrame } from './ExerciseFrame';
import { JudgeCard, rubricMatches } from './JudgeCard';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const MEANING = { correct: 'cat', distractors: ['dog', 'bird', 'fish'] as [string, string, string] };

function optionTexts(): string[] {
  return Array.from(root.querySelectorAll('.judge-card__option span')).map((s) => s.textContent ?? '');
}

describe('<JudgeCard> focus', () => {
  it('is a tabIndex -1 dialog that takes focus on mount, so the 目付 title is read before the options', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    act(() => render(<JudgeCard {...MEANING} rng={mulberry32(1)} onPick={vi.fn()} />, root));
    const card = root.querySelector('.judge-card') as HTMLElement;
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(card);
    // the verb rides a plain wrapper; the clipped window itself is never transformed (design 09 §6.7 rule 7)
    expect(card.classList.contains('status-window')).toBe(true);
    expect(card.classList.contains('ink-nijimi')).toBe(false);
    expect(card.parentElement?.classList.contains('judge-card__wrap')).toBe(true);
    expect(card.parentElement?.classList.contains('ink-nijimi')).toBe(true);
    expect(card.parentElement?.getAttribute('style')).toContain('--from: 24px 0');
    act(() => render(<JudgeCard rubric="〜ている" regex="ている" answer="食べている" rng={mulberry32(1)} onPick={vi.fn()} />, root));
    expect(document.activeElement).toBe(root.querySelector('.judge-card[data-shape="rubric"]'));
    outside.remove();
  });
});

describe('<JudgeCard> meaning', () => {
  it('option order is seeded by rng and stable across re-renders', () => {
    const onPick = vi.fn();
    act(() => render(<JudgeCard {...MEANING} rng={mulberry32(7)} onPick={onPick} />, root));
    const expected = shuffle(mulberry32(7), [MEANING.correct, ...MEANING.distractors]);
    expect(optionTexts()).toEqual(expected);
    expect(optionTexts()).not.toEqual([MEANING.correct, ...MEANING.distractors]);
    act(() => render(<JudgeCard {...MEANING} rng={mulberry32(999)} onPick={onPick} />, root));
    expect(optionTexts()).toEqual(expected);
    expect(root.querySelector('.judge-card')?.getAttribute('data-shape')).toBe('meaning');
    expect(root.querySelector('.judge-card__title [lang="ja"]')?.textContent).toBe('目付');
  });

  it('picking a distractor → onPick(false); the correct meaning → onPick(true); fires once', () => {
    const onPick = vi.fn();
    act(() => render(<JudgeCard {...MEANING} rng={mulberry32(1)} onPick={onPick} />, root));
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.judge-card__option'));
    const wrong = buttons.find((b) => b.textContent?.includes('dog')) as HTMLButtonElement;
    act(() => wrong.click());
    expect(onPick).toHaveBeenCalledWith(false);
    const right = buttons.find((b) => b.textContent?.includes('cat')) as HTMLButtonElement;
    act(() => right.click());
    expect(onPick).toHaveBeenCalledTimes(1);

    act(() => render(null, root));
    const onPick2 = vi.fn();
    act(() => render(<JudgeCard {...MEANING} rng={mulberry32(1)} onPick={onPick2} />, root));
    const right2 = Array.from(root.querySelectorAll<HTMLButtonElement>('.judge-card__option')).find((b) =>
      b.textContent?.includes('cat'),
    ) as HTMLButtonElement;
    act(() => right2.click());
    expect(onPick2).toHaveBeenCalledWith(true);
  });

  it('digits pick options through the enclosing frame', () => {
    const onPick = vi.fn();
    const step: Step = {
      id: 's',
      block: 'reviews',
      exercise: 'meaning-judge',
      itemId: null,
      cardKey: null,
      params: {},
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 5,
      estMs: 1000,
    };
    const noop = (): void => undefined;
    act(() =>
      render(
        <ExerciseFrame
          step={step}
          index={0}
          total={1}
          ki={0}
          combo={0}
          comboTier={0}
          timer={null}
          feel="dojo"
          feedback={null}
          onGuard={noop}
          onHint={noop}
          onPause={noop}
          onContinue={noop}
        >
          <JudgeCard {...MEANING} rng={mulberry32(3)} onPick={onPick} />
        </ExerciseFrame>,
        root,
      ),
    );
    const texts = optionTexts();
    const idx = texts.indexOf('cat');
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(idx + 1), bubbles: true, cancelable: true }));
    });
    expect(onPick).toHaveBeenCalledWith(true);
  });
});

describe('<JudgeCard> rubric', () => {
  it('verifies with the regex: はい passes only when it matches; いいえ fails', () => {
    const onPick = vi.fn();
    act(() =>
      render(
        <JudgeCard rubric="〜てしまう" regex="てしま(う|っ|い)" answer="食べてしまった。" rng={mulberry32(1)} onPick={onPick} />,
        root,
      ),
    );
    expect(root.querySelector('.judge-card')?.getAttribute('data-shape')).toBe('rubric');
    expect(root.querySelector('.judge-card__answer mark')?.textContent).toBe('てしまっ');
    act(() => (root.querySelector('[data-verdict="yes"]') as HTMLButtonElement).click());
    expect(onPick).toHaveBeenCalledWith(true);

    act(() => render(null, root));
    const onPick2 = vi.fn();
    act(() =>
      render(<JudgeCard rubric="〜てしまう" regex="てしま(う|っ|い)" answer="食べた。" rng={mulberry32(1)} onPick={onPick2} />, root),
    );
    expect(root.querySelector('.judge-card__answer mark')).toBeNull();
    act(() => (root.querySelector('[data-verdict="yes"]') as HTMLButtonElement).click());
    expect(onPick2).toHaveBeenCalledWith(false);

    act(() => render(null, root));
    const onPick3 = vi.fn();
    act(() =>
      render(
        <JudgeCard rubric="〜てしまう" regex="てしま(う|っ|い)" answer="食べてしまった。" rng={mulberry32(1)} onPick={onPick3} />,
        root,
      ),
    );
    act(() => (root.querySelector('[data-verdict="no"]') as HTMLButtonElement).click());
    expect(onPick3).toHaveBeenCalledWith(false);
  });

  it('rubricMatches degrades to a literal test on an invalid pattern', () => {
    expect(rubricMatches('a(b', '(').ok).toBe(true);
    expect(rubricMatches('abc', '(')).toEqual({ ok: false, ranges: [] });
    expect(rubricMatches('ねこがいる', 'が').ranges).toEqual([[2, 3]]);
  });
});

describe('<JudgeCard> perception', () => {
  it('passes when the learner picks the pair member that was played; Space replays via the frame', () => {
    const onPick = vi.fn();
    const onReplay = vi.fn();
    act(() =>
      render(<JudgeCard minimalPair={['きて', 'きって']} heard={1} rng={mulberry32(5)} onPick={onPick} onReplay={onReplay} />, root),
    );
    expect(root.querySelector('.judge-card')?.getAttribute('data-shape')).toBe('perception');
    const opts = Array.from(root.querySelectorAll<HTMLButtonElement>('.judge-card__option'));
    expect(opts.length).toBe(2);
    expect(opts.every((b) => b.querySelector('span')?.getAttribute('lang') === 'ja')).toBe(true);
    const heard = opts.find((b) => b.textContent?.includes('きって')) as HTMLButtonElement;
    act(() => heard.click());
    expect(onPick).toHaveBeenCalledWith(true);

    act(() => render(null, root));
    const onPick2 = vi.fn();
    act(() => render(<JudgeCard minimalPair={['きて', 'きって']} heard={1} rng={mulberry32(5)} onPick={onPick2} />, root));
    const other = Array.from(root.querySelectorAll<HTMLButtonElement>('.judge-card__option')).find((b) =>
      b.textContent?.includes('きて') && !b.textContent.includes('きって'),
    ) as HTMLButtonElement;
    act(() => other.click());
    expect(onPick2).toHaveBeenCalledWith(false);
  });
});
