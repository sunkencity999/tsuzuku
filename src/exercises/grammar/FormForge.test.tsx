import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V } from '@/content/fixtures';
import type { GrammarItem, VocabItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { FormForge, forgeAccept, headWordOf, inferHeadWord, isVocabItem, meta } from './FormForge';

const TABERU = FIXTURE.items[V.食べる] as VocabItem; // v1
const NOMU = FIXTURE.items[V.飲む] as VocabItem; // v5
const OISHII = FIXTURE.items[V.おいしい] as VocabItem; // adj-i
const INU = FIXTURE.items[V.犬] as VocabItem; // noun
const ARU: VocabItem = { ...INU, id: 'v-n5-0099', word: 'ある', kana: 'ある', meanings: ['to exist'], pos: 'v5' };

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 6_000 });
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
    id: 'ff-1',
    block: 'reviews',
    exercise: 'form-forge',
    itemId: TABERU.id,
    cardKey: 'g-n5-003#prod',
    params: { targetForm: 'potential' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 4,
    estMs: 8000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: TABERU,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 4,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };
}

function mount(pr: ExerciseProps): HTMLInputElement {
  act(() => render(<FormForge {...pr} />, root));
  return root.querySelector('input') as HTMLInputElement;
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
const btn = (text: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) as HTMLButtonElement;

describe('FormForge helpers', () => {
  it('meta: form-forge on the prod facet with kana keys', () => {
    expect(meta).toMatchObject({ id: 'form-forge', facet: 'prod', keys: 'kana', needsTts: false });
    expect(isVocabItem(TABERU)).toBe(true);
    expect(isVocabItem(FIXTURE.items['j-食'])).toBe(false);
    expect(headWordOf(TABERU)).toEqual({ word: '食べる', kana: 'たべる', pos: 'v1' });
    expect(headWordOf(INU)).toBeNull();
    expect(headWordOf(null)).toBeNull();
  });

  it('forgeAccept merges the step answer with the engine surfaces, display form first, no duplicates', () => {
    const a = forgeAccept(headWordOf(TABERU), 'potential', {});
    expect(a).toEqual({ accept: ['食べられる', 'たべられる', '食べれる', 'たべれる'], defective: false });
    const b = forgeAccept(headWordOf(TABERU), 'potential', { answer: '食べられる', accept: ['たべられる'] });
    expect(b?.accept).toEqual(['食べられる', 'たべられる', '食べれる', 'たべれる']);
    const c = forgeAccept(headWordOf(NOMU), 'te', {});
    expect(c?.accept).toEqual(['飲んで', 'のんで']);
    const d = forgeAccept(headWordOf(OISHII), 'adj-neg', {});
    expect(d?.accept).toEqual(['おいしくない']);
    // step-only (no conjugable item)
    expect(forgeAccept(null, 'te', { answer: '行って', accept: ['いって'] })?.accept).toEqual(['行って', 'いって']);
    expect(forgeAccept(null, 'te', {})).toBeNull();
    expect(forgeAccept(headWordOf(TABERU), undefined, {})).toBeNull();
    // defective
    expect(forgeAccept(headWordOf(ARU), 'potential', {})).toEqual({ accept: [], defective: true });
    expect(forgeAccept(headWordOf(ARU), 'nai', {})?.accept).toEqual(['ない']);
  });
});

describe('<FormForge>', () => {
  it('shows the dictionary form, its kana, the group and the target form label', () => {
    mount(props());
    expect(q('[data-dictionary="true"]')?.textContent).toBe('食べる');
    expect(root.textContent).toContain('たべる');
    expect(root.textContent).toContain('Group 2 verb');
    expect(q('[data-target-form="true"]')?.textContent).toBe('potential (can do)');
    expect(root.textContent).toContain('Make the potential (can do).');
    expect(q('.text-answer')?.getAttribute('data-mode')).toBe('ja');
  });

  it('on a grammar prod card (item = GrammarItem) the verb comes from params.sentence / promptEn, and the drill is answerable', () => {
    const MASU = FIXTURE.items[G.ます] as GrammarItem;
    // what the session builder sets for form-forge on g-n5-003 with 飲む picked (rep 0)
    const params = { targetForm: 'masu' as const, answer: '飲みます', accept: ['飲みます', 'のみます'], sentence: '飲む', kana: 'のむ', promptEn: 'to drink: polite present (〜ます)' };
    const pr = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    const input = mount(pr);
    expect(q('.gr-forge')?.getAttribute('data-state')).toBeNull();
    expect(q('[data-dictionary="true"]')?.textContent).toBe('飲む');
    expect(root.textContent).not.toContain('—');
    expect(q('.gr__word-kana')?.textContent).toBe('のむ');
    expect(q('[data-gloss="true"]')?.textContent).toBe('to drink: polite present (〜ます)');
    expect(q('[data-target-form="true"]')?.textContent).toBe('polite present (〜ます)');
    type(input, 'nomimasu');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'のみます' });
  });

  it('on a grammar prod card the reading span is absent when params.kana equals the word, and the unavailable branch still shows the reading', () => {
    const MASU = FIXTURE.items[G.ます] as GrammarItem;
    mount(props({ item: MASU, step: step({ itemId: MASU.id, params: { targetForm: 'masu', answer: 'あります', accept: ['あります'], sentence: 'ある', kana: 'ある', promptEn: 'to exist' } }) }));
    expect(q('[data-dictionary="true"]')?.textContent).toBe('ある');
    expect(q('.gr__word-kana')).toBeNull();

    act(() => render(null, root));
    mount(props({ item: MASU, step: step({ itemId: MASU.id, params: { targetForm: 'potential', sentence: '書く', kana: 'かく', promptEn: 'to write' } }) }));
    expect(q('.gr-forge')?.getAttribute('data-state')).toBe('unavailable');
    expect(root.textContent).toContain('書く');
    expect(q('.gr__word-kana')?.textContent).toBe('かく');
  });

  it('the main form, its kana, and an alternate (ら-dropped) are all accepted', () => {
    const pr = props();
    const input = mount(pr);
    type(input, 'taberareru');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'たべられる', hintUsed: false, ms: 0 });
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('correct');

    act(() => render(null, root));
    const pr2 = props();
    const input2 = mount(pr2);
    type(input2, 'tabereru');
    enter(input2);
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: 'たべれる' });
  });

  it('a miss is tagged conjugation and shows the rule; a particle tail is not tolerated', () => {
    const pr = props();
    const input = mount(pr);
    type(input, 'tabemasu');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['conjugation'], answer: 'たべます' });
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('wrong');
    expect(q('[data-rule="true"]')?.textContent).toContain('え-row');
    expect(q('.text-answer__form')?.textContent).toBe('食べられる');

    act(() => render(null, root));
    const pr2 = props({ item: NOMU, step: step({ itemId: NOMU.id, params: { targetForm: 'te' } }) });
    const input2 = mount(pr2);
    type(input2, 'nondewo');
    enter(input2);
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, errorTags: ['conjugation'] });
  });

  it('a long-vowel slip is a Block, not a miss', () => {
    const pr = props({ item: NOMU, step: step({ itemId: NOMU.id, params: { targetForm: 'masu' } }) });
    const input = mount(pr);
    type(input, 'nomimasuu');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, errorTags: ['vowel-length'] });
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('partial');
  });

  it('runner-supplied answer/accept work without a conjugable item', () => {
    const pr = props({ item: null, step: step({ itemId: null, params: { targetForm: 'te', answer: '行って', accept: ['いって'] } }) });
    const input = mount(pr);
    expect(root.textContent).toContain('て-form');
    type(input, 'itte');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
  });

  it('an adjective form works and showing the rule first is a hint', () => {
    const pr = props({ item: OISHII, step: step({ itemId: OISHII.id, params: { targetForm: 'adj-past' } }) });
    const input = mount(pr);
    expect(root.textContent).toContain('い-adjective');
    act(() => btn('Show the rule').click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('かった');
    type(input, 'oishikatta');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('a form the word lacks is shown, not tested; no form or no answer degrades honestly', () => {
    const pr = props({ item: ARU, step: step({ itemId: ARU.id, params: { targetForm: 'potential' } }) });
    mount(pr);
    expect(q('.gr-forge')?.getAttribute('data-state')).toBe('defective');
    expect(root.textContent).toContain('does not exist for this word');
    expect(root.textContent).toContain('ある');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });

    act(() => render(null, root));
    const pr2 = props({ step: step({ params: {} }) });
    mount(pr2);
    expect(q('.gr-forge')?.getAttribute('data-state')).toBe('unavailable');
    expect(root.textContent).toContain('could not be built');
  });
});

describe('head word from the step (params.pos / params.accepts) and the frame hint key', () => {
  const MASU = FIXTURE.items[G.ます] as GrammarItem;
  const press = (k: string): void => {
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });
  };

  it("forgeAccept grades the target form's params.accepts row (the row parallel to params.forms when given); inferHeadWord reads the forge shape", () => {
    expect(forgeAccept(null, 'masu', { answer: '帰ります', accepts: [['帰ります', 'かえります']] })?.accept).toEqual(['帰ります', 'かえります']);
    expect(forgeAccept(null, 'masu', { forms: ['te', 'masu'], answer: '帰ります', accepts: [['帰って', 'かえって'], ['帰ります', 'かえります']] })?.accept).toEqual(['帰ります', 'かえります']);
    expect(inferHeadWord({ sentence: '帰る', kana: 'かえる', targetForm: 'potential', answer: '帰れる' })).toEqual({ word: '帰る', kana: 'かえる', pos: 'v5' });
    expect(inferHeadWord({ sentence: '帰る', kana: 'かえる', targetForm: 'potential' })).toBeNull();
  });

  it('on a grammar prod card params.pos names the group, so 帰る conjugates as godan: かえれる is right and the ichidan かえられる is a miss', () => {
    const params = { targetForm: 'potential' as const, pos: 'v5' as const, sentence: '帰る', kana: 'かえる', promptEn: 'to return: potential' };
    const pr = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    const input = mount(pr);
    expect(q('.gr-forge')?.getAttribute('data-state')).toBeNull();
    expect(root.textContent).toContain('Group 1 verb');
    type(input, 'kaereru');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, answer: 'かえれる' });

    act(() => render(null, root));
    const pr2 = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    const input2 = mount(pr2);
    type(input2, 'kaerareru');
    enter(input2);
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, errorTags: ['conjugation'] });
    expect(q('.text-answer__form')?.textContent).toBe('帰れる');
  });

  it("the frame's ? key opens the rule once (hintUsed), then the Hint button is withdrawn", () => {
    const pr = props();
    act(() =>
      render(
        <ExerciseFrame step={pr.step} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          <FormForge {...pr} />
        </ExerciseFrame>,
        root,
      ),
    );
    expect(q('.exercise-frame__hint')).not.toBeNull();
    expect(q('[data-hint="true"]')).toBeNull();
    press('?');
    expect(q('[data-hint="true"]')?.textContent).toContain('え-row');
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('.exercise-frame__hint')).toBeNull();
    press('?');
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'taberareru');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});
