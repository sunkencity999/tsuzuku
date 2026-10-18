import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G } from '@/content/fixtures';
import type { GrammarItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { MAX_SLOTS, PARTICLE_KEYS, ParticleDuel, buildDuelPrompt, duelKeyboard, meta, splitSlots } from './ParticleDuel';

const WA = FIXTURE.items[G.は] as GrammarItem; // clozeHints ['は']; examples[0] 犬は水を飲みます。
const DESU = FIXTURE.items[G.です] as GrammarItem; // clozeHints ['です'] — no particle hint
const SENTENCE = '{犬|いぬ}は{水|みず}を{飲|の}みます。'; // plain: 犬は水を飲みます。 (は at 1, を at 3)

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 9_000 });
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'pd-1',
    block: 'reviews',
    exercise: 'particle-duel',
    itemId: WA.id,
    cardKey: 'g-n5-002#cloze',
    params: { sentence: SENTENCE, blanks: [[1, 2], [3, 4]], promptEn: 'The dog drinks water.' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 8000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: WA,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 3,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={3} ki={0} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(pr: ExerciseProps, framed = false): void {
  act(() => render(framed ? inFrame(<ParticleDuel {...pr} />, pr.step) : <ParticleDuel {...pr} />, root));
}
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const slots = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.gr-slot'));
const keyBtn = (k: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('.gr-key')).find((b) => b.textContent?.replace(/^\d+/, '') === k) as HTMLButtonElement;
const check = (): HTMLButtonElement => root.querySelector('.hanko') as HTMLButtonElement;
const btn = (text: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) as HTMLButtonElement;
const slotText = (): string[] => slots().map((s) => s.textContent ?? '');

describe('ParticleDuel helpers', () => {
  it('meta: particle-duel on the cloze facet with choice keys; eleven particle keys', () => {
    expect(meta).toMatchObject({ id: 'particle-duel', facet: 'cloze', keys: 'choices' });
    expect(PARTICLE_KEYS).toEqual(['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の']);
    expect(MAX_SLOTS).toBe(3);
  });

  it('splitSlots cuts the ruby sentence around the blanks, in order, skipping overlaps', () => {
    expect(splitSlots(SENTENCE, [[3, 4], [1, 2]])).toEqual([{ ja: '{犬|いぬ}' }, { ja: 'は', slot: 0 }, { ja: '{水|みず}' }, { ja: 'を', slot: 1 }, { ja: '{飲|の}みます。' }]);
    expect(splitSlots(SENTENCE, [[1, 2], [1, 2]])).toEqual([{ ja: '{犬|いぬ}' }, { ja: 'は', slot: 0 }, { ja: '{水|みず}を{飲|の}みます。' }]);
    expect(splitSlots('はい。', [[0, 1]])).toEqual([{ ja: 'は', slot: 0 }, { ja: 'い。' }]);
  });

  it('buildDuelPrompt reads blanks + answers from the step, else blanks the particle clozeHints of a rotating example', () => {
    const a = buildDuelPrompt(WA, { sentence: SENTENCE, blanks: [[1, 2], [3, 4]] }, 0);
    expect(a).toMatchObject({ expected: ['は', 'を'], plain: '犬は水を飲みます。', gloss: 'The dog drinks water.' });
    const b = buildDuelPrompt(WA, { sentence: SENTENCE, blanks: [[3, 4]], answers: ['が'] }, 0);
    expect(b?.expected).toEqual(['が']);
    const c = buildDuelPrompt(WA, {}, 1); // ケンはパンを食べます。 → は
    expect(c).toMatchObject({ expected: ['は'], plain: 'ケンはパンを食べます。' });
    expect(buildDuelPrompt(WA, {}, 2)?.plain).toBe('コーヒーはおいしいですね。');
    expect(buildDuelPrompt(DESU, {}, 0)).toBeNull(); // no particle hint
    expect(buildDuelPrompt(null, {}, 0)).toBeNull();
    expect(buildDuelPrompt(null, { sentence: SENTENCE, blanks: [[1, 2]] }, 0)?.expected).toEqual(['は']);
    expect(buildDuelPrompt(WA, { sentence: SENTENCE, blanks: [[1, 2], [3, 4], [5, 6], [7, 8]] }, 0)?.expected.length).toBe(3);
  });

  it('duelKeyboard uses params.choices when given (expected particles guaranteed), else the eleven keys', () => {
    expect(duelKeyboard({}, ['は'])).toEqual(PARTICLE_KEYS);
    expect(duelKeyboard({ choices: ['は', 'が', 'を', 'に'] }, ['は', 'を'])).toEqual(['は', 'が', 'を', 'に']);
    expect(duelKeyboard({ choices: ['が', 'に'] }, ['は'])).toEqual(['が', 'に', 'は']);
  });
});

describe('<ParticleDuel>', () => {
  it('renders the sentence with two empty slots, the keyboard and a disabled Check', () => {
    mount(props());
    expect(q('.gr-duel')?.getAttribute('data-slots')).toBe('2');
    expect(slotText()).toEqual(['＿', '＿']);
    expect(slots()[0]?.getAttribute('data-active')).toBe('true');
    expect(root.querySelectorAll('.gr-key').length).toBe(11);
    expect(check().disabled).toBe(true);
    expect(root.textContent).toContain('The dog drinks water.');
    expect(Array.from(root.querySelectorAll('.gr__sentence rt')).map((r) => r.textContent)).toEqual(['いぬ', 'みず', 'の']);
  });

  it('all slots correct → correct, no tags; slots marked correct and the hit count shown', () => {
    const pr = props();
    mount(pr);
    act(() => keyBtn('は').click());
    expect(slots()[1]?.getAttribute('data-active')).toBe('true');
    act(() => keyBtn('を').click());
    expect(slotText()).toEqual(['は', 'を']);
    expect(check().disabled).toBe(false);
    act(() => check().click());
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], hintUsed: false, answer: 'は を', ms: 0 });
    expect(slots().map((s) => s.getAttribute('data-state'))).toEqual(['correct', 'correct']);
    expect(q('[data-hits="true"]')?.textContent).toBe('2 of 2 slots right.');
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('correct');
  });

  it('one wrong slot → nearMiss (Hard) tagged particle; the wrong slot shows the given struck and the expected', () => {
    const pr = props();
    mount(pr);
    act(() => keyBtn('は').click());
    act(() => keyBtn('が').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, errorTags: ['particle'], answer: 'は が' });
    expect(slots().map((s) => s.getAttribute('data-state'))).toEqual(['correct', 'wrong']);
    expect(slots()[1]?.querySelector('.gr__given')?.textContent).toBe('が');
    expect(slots()[1]?.textContent).toBe('がを');
    expect(q('[data-hits="true"]')?.textContent).toBe('1 of 2 slots right.');
    expect(root.textContent).toContain('The particle sets the role of the word before it.');
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('partial');
  });

  it('every slot wrong → Again tagged particle', () => {
    const pr = props();
    mount(pr);
    act(() => keyBtn('が').click());
    act(() => keyBtn('に').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['particle'] });
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('wrong');
  });

  it('digits press keys and Enter checks through the frame; a filled slot can be re-picked; Clear empties', () => {
    const pr = props();
    mount(pr, true);
    press('2'); // が → slot 1
    press('3'); // を → slot 2
    expect(slotText()).toEqual(['が', 'を']);
    act(() => (slots()[0] as HTMLButtonElement).click()); // re-pick slot 1
    expect(slots()[0]?.getAttribute('data-active')).toBe('true');
    press('1'); // は
    expect(slotText()).toEqual(['は', 'を']);
    act(() => btn('Clear').click());
    expect(slotText()).toEqual(['＿', '＿']);
    press('Enter');
    expect(pr.onResult).not.toHaveBeenCalled();
    press('1');
    press('3');
    press('Enter');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
    press('Enter');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
  });

  it('showing the pattern is a hint; a narrowed keyboard comes from params.choices', () => {
    const pr = props({ step: step({ params: { sentence: SENTENCE, blanks: [[1, 2]], choices: ['は', 'が', 'を', 'に'] } }) });
    mount(pr);
    expect(root.querySelectorAll('.gr-key').length).toBe(4);
    expect(root.textContent).toContain('Choose the particle.');
    act(() => btn('Show the pattern').click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('〜は');
    act(() => keyBtn('は').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it("the frame's ? key opens the pattern once (hintUsed) beside the particle keys, then the Hint button is withdrawn", () => {
    const pr = props();
    mount(pr, true);
    expect(q('.exercise-frame__hint')).not.toBeNull();
    press('?');
    expect(q('[data-hint="true"]')?.textContent).toContain('〜は');
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('.exercise-frame__hint')).toBeNull();
    press('?');
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    press('1'); // digits still reach the particle keyboard through the same keyed set
    press('3');
    press('Enter');
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('derives the slot from the point when the step carries none; a point without particle hints is shown, not tested', () => {
    const pr = props({ step: step({ params: {} }), exposures: 0, furigana: 'off' });
    mount(pr);
    expect(q('.gr-duel')?.getAttribute('data-slots')).toBe('1');
    expect(q('.gr__sentence')?.textContent).toBe('犬＿水を飲みます。');
    expect(root.querySelector('.gr__sentence rt')).toBeNull();
    act(() => keyBtn('は').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });

    act(() => render(null, root));
    const pr2 = props({ item: DESU, step: step({ itemId: DESU.id, params: {} }) });
    mount(pr2);
    expect(q('.gr-duel')?.getAttribute('data-state')).toBe('unavailable');
    expect(root.textContent).toContain('〜です');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});
