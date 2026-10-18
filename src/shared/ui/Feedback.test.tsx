import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { FeedbackState } from '../exercise-types';
import { Feedback, feedbackAnnouncement } from './Feedback';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const base = (over: Partial<FeedbackState> = {}): FeedbackState => ({
  kind: 'correct',
  correct: 'おばあさん',
  errorTags: [],
  rating: 3,
  ippon: false,
  kiai: false,
  xpDelta: 2,
  ...over,
});

function mount(state: FeedbackState, onAgain?: () => void, feel?: 'zen' | 'dojo' | 'arcade'): void {
  act(() => render(<Feedback state={state} onAgain={onAgain} feel={feel} />, root));
}

describe('<Feedback>', () => {
  it('renders diff spans from state.diff with kind classes and lang="ja"', () => {
    mount(
      base({
        kind: 'near',
        given: 'おばさん',
        diff: [
          ['お', 0],
          ['ば', 0],
          ['あ', 2],
          ['さ', 0],
          ['ん', 0],
        ],
        errorTags: ['vowel-length'],
        rating: 2,
        xpDelta: 1,
      }),
    );
    const spans = Array.from(root.querySelectorAll('.diff'));
    expect(spans.length).toBe(5);
    expect(spans[2]?.classList.contains('diff--missing')).toBe(true);
    expect(spans[2]?.textContent).toBe('あ');
    expect(root.querySelector('.feedback__diff')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.chip--tag')?.textContent).toBe('vowel length');
    expect(root.querySelector('.feedback')?.getAttribute('data-kind')).toBe('near');
    // the card is THE result panel entering by the verb class (design 09 §7 I)
    const card = root.querySelector('.feedback')!;
    expect(card.classList.contains('reveal')).toBe(true);
    expect(card.classList.contains('ink-nijimi')).toBe(true);
    // a plain panel: the nijimi verb never rides a clipped .status-window (design 09 §6.7 rule 7)
    expect(card.classList.contains('status-window')).toBe(false);
    expect(card.querySelector('.eyebrow')).not.toBeNull();
    expect(card.querySelector('.feedback__label')).toBeNull();
  });

  it('computes the diff when only given/correct are present', () => {
    mount(base({ kind: 'wrong', given: 'ねご', correct: 'ねこ', rating: 1, xpDelta: 1 }));
    const kinds = Array.from(root.querySelectorAll('.diff')).map((s) => s.getAttribute('data-diff'));
    expect(kinds).toEqual(['0', '1', '2']);
  });

  it("near-miss shows 'almost'; wrong shows the Sensei miss line; guard its own line", () => {
    mount(base({ kind: 'near', rating: 2 }));
    expect(root.querySelector('.feedback__line')?.textContent).toMatch(/almost/i);
    mount(base({ kind: 'wrong', rating: 1 }));
    expect(root.querySelector('.feedback__line')?.textContent).toBe("Again. That's the training.");
    mount(base({ kind: 'guard', rating: 1 }));
    expect(root.querySelector('.feedback__line')?.textContent).toBe('Good. Now you know what to train.');
    mount(base({ kind: 'wrong', rating: 1, line: 'Custom line.' }));
    expect(root.querySelector('.feedback__line')?.textContent).toBe('Custom line.');
  });

  it('promotion shows the belt name (EN and JA)', () => {
    mount(base({ promotion: 'green' }));
    const flip = root.querySelector('.belt-flip');
    expect(flip?.getAttribute('data-belt')).toBe('green');
    expect(flip?.textContent).toContain('Green');
    expect(flip?.querySelector('[lang="ja"]')?.textContent).toBe('緑帯');
    expect(feedbackAnnouncement(base({ promotion: 'green' }))).toContain('Green');
  });

  it('もう一度 calls onAgain and is hidden without the callback or on a correct rep', () => {
    const onAgain = vi.fn();
    mount(base({ kind: 'wrong', given: 'x', rating: 1 }), onAgain);
    const btn = root.querySelector('.feedback__again') as HTMLButtonElement;
    expect(btn.textContent).toContain('もう一度');
    expect(btn.querySelector('[lang="ja"]')?.textContent).toBe('もう一度');
    btn.click();
    expect(onAgain).toHaveBeenCalledTimes(1);
    mount(base({ kind: 'wrong', rating: 1 }));
    expect(root.querySelector('.feedback__again')).toBeNull();
    mount(base({ kind: 'correct' }), onAgain);
    expect(root.querySelector('.feedback__again')).toBeNull();
  });

  it('Ippon / Kiai / XP / recovery / judge flourishes; Zen drops the Kiai ones', () => {
    mount(base({ ippon: true, kiai: true, xpDelta: 5, recovery: true, judge: 'pass' }), undefined, 'dojo');
    expect(root.querySelector('.ippon')?.textContent?.trim()).toBe('一本');
    expect(root.querySelector('.ippon')?.getAttribute('aria-label')).toBe('Ippon');
    // 一本 is written through a stroke mask (§3.4): the spine is an .ink-hiku[data-axis=stroke] inside the mask the text wears
    const stroke = root.querySelector('.ippon mask .ippon__stroke.ink-hiku[data-axis="stroke"]');
    expect(stroke).not.toBeNull();
    expect(root.querySelector('.ippon .ippon__text')?.getAttribute('mask')).toMatch(/^url\(#.+-ippon\)$/);
    expect(root.querySelector('.chip--kiai')).not.toBeNull();
    // the zero-Japanese rule: 気合 carries its English
    expect(root.querySelector('.chip--kiai')?.textContent).toContain('Kiai');
    // the XP delta ticks through <Ticker>: the final digits stand in the DOM and the label is honest
    expect(root.querySelector('.xp-delta .ticker__value')?.textContent).toBe('+5 XP');
    expect(root.querySelector('.xp-delta')?.getAttribute('aria-label')).toBe('+5 XP');
    expect(root.querySelector('.feedback__recovery')).not.toBeNull();
    expect(root.querySelector('.feedback__judge')?.getAttribute('data-judge')).toBe('pass');

    mount(base({ ippon: true, kiai: true, xpDelta: 0 }), undefined, 'zen');
    expect(root.querySelector('.ippon')).toBeNull();
    expect(root.querySelector('.chip--kiai')).toBeNull();
    expect(root.querySelector('.xp-delta')).toBeNull();
  });

  it('shows the correct form through <Ruby> for non-correct kinds only', () => {
    mount(base({ kind: 'timeout', correct: '{猫|ねこ}', rating: 1 }));
    expect(root.querySelector('.feedback__answer rt')?.textContent).toBe('ねこ');
    mount(base({ kind: 'correct', correct: '{猫|ねこ}' }));
    expect(root.querySelector('.feedback__answer')).toBeNull();
  });
});
