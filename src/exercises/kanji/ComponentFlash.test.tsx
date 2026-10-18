import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { ComponentDef } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { CHOICE_EXPOSURES, ComponentFlash, isComponentDef, judgeDistractors, meta } from './ComponentFlash';

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 10_000 });
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const EAT = FIXTURE.items['c-eat'] as ComponentDef;
const CHOICES = ['eat', 'yawn', 'person', 'sun'];

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'cf-1',
    block: 'reviews',
    exercise: 'component-flash',
    itemId: EAT.id,
    cardKey: 'c-eat#rec',
    params: {},
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 5000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn> } {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  return {
    step: step(),
    item: EAT,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 0,
    onResult,
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={3} ki={0} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function enter(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);

describe('ComponentFlash meta and helpers', () => {
  it('registers as component-flash on the rec facet with typed keys', () => {
    expect(meta).toMatchObject({ id: 'component-flash', facet: 'rec', keys: 'text', selfGraded: false, needsTts: false });
    expect(CHOICE_EXPOSURES).toBe(2);
  });

  it('isComponentDef tells a ComponentDef from a KanjiItem and a KanaItem', () => {
    expect(isComponentDef(EAT)).toBe(true);
    expect(isComponentDef(FIXTURE.items['j-食'])).toBe(false);
    expect(isComponentDef(FIXTURE.items['k-h-a'])).toBe(false);
    expect(isComponentDef(null)).toBe(false);
  });

  it('judgeDistractors takes three distinct non-answer choices or nothing', () => {
    expect(judgeDistractors('eat', CHOICES)).toEqual(['yawn', 'person', 'sun']);
    expect(judgeDistractors('eat', ['eat', 'Eat', 'yawn', 'yawn'])).toBeNull();
    expect(judgeDistractors('eat', undefined)).toBeNull();
  });
});

describe('<ComponentFlash> choices (first two exposures)', () => {
  it('renders the glyph, the variants and four numbered keyword choices; the right pick is correct', () => {
    const s = step({ params: { choices: CHOICES } });
    const pr = props({ step: s, exposures: 0 });
    act(() => render(inFrame(<ComponentFlash {...pr} />, s), root));
    expect(q('.kj__glyph')?.textContent).toBe('食');
    expect(q('.kj__glyph')?.getAttribute('lang')).toBe('ja');
    expect(root.textContent).toContain('飠');
    expect(q('.kj-flash')?.getAttribute('data-mode')).toBe('choices');
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
    expect(buttons.map((b) => b.querySelector('.choice__text')?.textContent)).toEqual(CHOICES);
    act(() => buttons[0]?.click());
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    const r = pr.onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, guard: false, errorTags: [], answer: 'eat' });
    expect(r.ms).toBe(0);
    // name and hint rendered after the answer
    expect(q('[data-keyword="true"]')?.textContent).toBe('eat');
    expect(q('.kj__reveal [data-hint="true"]')?.textContent).toContain(EAT.hint);
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('correct');
  });

  it('a wrong digit pick through the frame is tagged kanji-meaning and fires once', () => {
    const s = step({ params: { choices: CHOICES } });
    const pr = props({ step: s, exposures: 1 });
    act(() => render(inFrame(<ComponentFlash {...pr} />, s), root));
    press('3');
    press('1');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, errorTags: ['kanji-meaning'], answer: 'person' });
    expect(root.querySelector('.choice[data-index="0"]')?.getAttribute('data-state')).toBe('missed');
  });

  it('showing the visual hint before answering calls onHint and sets hintUsed', () => {
    const s = step({ params: { choices: CHOICES } });
    const pr = props({ step: s, exposures: 0 });
    act(() => render(<ComponentFlash {...pr} />, root));
    const hintBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Show the visual hint');
    expect(hintBtn).toBeDefined();
    act(() => hintBtn?.click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('lid over a bowl');
    act(() => (root.querySelector('.choice[data-index="0"]') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('falls back to typing when the choices do not contain the keyword or exposures are past two', () => {
    const s = step({ params: { choices: ['yawn', 'person', 'sun', 'moon'] } });
    act(() => render(<ComponentFlash {...props({ step: s, exposures: 0 })} />, root));
    expect(q('.kj-flash')?.getAttribute('data-mode')).toBe('typed');
    act(() => render(null, root));
    const s2 = step({ params: { choices: CHOICES } });
    act(() => render(<ComponentFlash {...props({ step: s2, exposures: 2 })} />, root));
    expect(q('.kj-flash')?.getAttribute('data-mode')).toBe('typed');
    expect(q('.text-answer')).not.toBeNull();
  });
});

describe('<ComponentFlash> typed (fuzzy)', () => {
  it('accepts a one-edit typo on a five-letter keyword and an exact short keyword', () => {
    const yawn = FIXTURE.items['c-yawn'] as ComponentDef;
    const s = step({ itemId: yawn.id, cardKey: 'c-yawn#rec' });
    const pr = props({ step: s, item: yawn, exposures: 5 });
    act(() => render(<ComponentFlash {...pr} />, root));
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'yawn');
    enter(input);
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: 'yawn', errorTags: [] });

    act(() => render(null, root));
    const person = FIXTURE.items['c-person'] as ComponentDef;
    const s2 = step({ itemId: person.id, cardKey: 'c-person#rec' });
    const pr2 = props({ step: s2, item: person, exposures: 5 });
    act(() => render(<ComponentFlash {...pr2} />, root));
    const input2 = root.querySelector('input') as HTMLInputElement;
    type(input2, 'persn');
    enter(input2);
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
    expect(q('[data-keyword="true"]')?.textContent).toBe('person');
  });

  it('accepts extra forms from params.accept and tags a declined miss kanji-meaning', () => {
    const s = step({ params: { accept: ['food'] } });
    const pr = props({ step: s, exposures: 3 });
    act(() => render(<ComponentFlash {...pr} />, root));
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'food');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });

    act(() => render(null, root));
    const pr2 = props({ step: step(), exposures: 3 });
    act(() => render(<ComponentFlash {...pr2} />, root));
    const input2 = root.querySelector('input') as HTMLInputElement;
    type(input2, 'moon');
    enter(input2);
    expect(pr2.onResult).not.toHaveBeenCalled(); // confirm step first
    act(() => (q('.text-answer__decline') as HTMLButtonElement).click());
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, errorTags: ['kanji-meaning'], answer: 'moon' });
  });

  it('an "I meant that" override reports selfRating 3 and asks the Judge when distractors exist', async () => {
    const s = step({ params: { choices: CHOICES } });
    const pr = props({ step: s, exposures: 4 });
    act(() => render(<ComponentFlash {...pr} />, root));
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'meal');
    enter(input);
    act(() => (q('.text-answer__override') as HTMLButtonElement).click());
    expect(pr.requestJudge).toHaveBeenCalledWith({ correct: 'eat', distractors: ['yawn', 'person', 'sun'] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, selfRating: 3, answer: 'meal' });
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('partial');

    act(() => render(null, root));
    const pr2 = props({ step: step(), exposures: 4 });
    act(() => render(<ComponentFlash {...pr2} />, root));
    const input2 = root.querySelector('input') as HTMLInputElement;
    type(input2, 'meal');
    enter(input2);
    act(() => (q('.text-answer__override') as HTMLButtonElement).click());
    expect(pr2.requestJudge).not.toHaveBeenCalled();
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, selfRating: 3 });
  });

  it('without a component item it shows an honest state and Continue emits a shown-not-tested result', () => {
    const pr = props({ item: null, step: step({ itemId: null, cardKey: null }) });
    act(() => render(<ComponentFlash {...pr} />, root));
    expect(q('.kj-flash')?.getAttribute('data-state')).toBe('unavailable');
    expect(root.textContent).toContain('could not be built');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});
