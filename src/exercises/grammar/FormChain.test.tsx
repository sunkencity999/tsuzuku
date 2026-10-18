import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V } from '@/content/fixtures';
import type { ConjForm, GrammarItem, VocabItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { CHAIN_LENGTH, FormChain, buildChain, chainResult, headWordOf, inferHeadWord, meta, type LinkLog } from './FormChain';

const TABERU = FIXTURE.items[V.食べる] as VocabItem; // v1
const NOMU = FIXTURE.items[V.飲む] as VocabItem; // v5
const INU = FIXTURE.items[V.犬] as VocabItem; // noun
const FORMS = ['masu', 'te', 'nai', 'ta', 'potential'] as const;
/** 食べる: 食べます · 食べて · 食べない · 食べた · 食べられる */
const TYPED_RIGHT = ['tabemasu', 'tabete', 'tabenai', 'tabeta', 'taberareru'];

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 12_000 });
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
    id: 'fc-1',
    block: 'reviews',
    exercise: 'form-chain',
    itemId: TABERU.id,
    cardKey: 'g-n5-003#prod',
    params: { forms: [...FORMS] },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 5,
    estMs: 20000,
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
    exposures: 5,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };
}

function mount(pr: ExerciseProps): void {
  act(() => render(<FormChain {...pr} />, root));
}
const input = (): HTMLInputElement => root.querySelector('input') as HTMLInputElement;
function answer(text: string): void {
  const el = input();
  for (const ch of text) {
    act(() => {
      el.value = el.value + ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}
const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const rows = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.gr-chain__row'));
const states = (): (string | null)[] => rows().map((r) => r.getAttribute('data-state'));
const btn = (text: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) as HTMLButtonElement;

const logOf = (statesIn: ('right' | 'close' | 'miss')[]): LinkLog[] => statesIn.map((state, i) => ({ form: FORMS[i] ?? 'masu', given: 'x', expected: 'y', state }));

describe('FormChain helpers', () => {
  it('meta: form-chain on the prod facet, kana keys, not timeable', () => {
    expect(meta).toMatchObject({ id: 'form-chain', facet: 'prod', keys: 'kana', timeable: false });
    expect(CHAIN_LENGTH).toBe(5);
    expect(headWordOf(INU)).toBeNull();
  });

  it('buildChain merges step forms/answers with the engine, else takes the first five applicable forms', () => {
    const a = buildChain(headWordOf(TABERU), { forms: [...FORMS] });
    expect(a?.map((l) => l.form)).toEqual([...FORMS]);
    expect(a?.[0]?.accept).toEqual(['食べます', 'たべます']);
    expect(a?.[4]?.accept).toEqual(['食べられる', 'たべられる', '食べれる', 'たべれる']);
    const b = buildChain(headWordOf(TABERU), { forms: ['te'], answers: ['たべて'] });
    expect(b?.[0]?.accept).toEqual(['たべて', '食べて']);
    const c = buildChain(headWordOf(NOMU), {});
    expect(c?.map((l) => l.form)).toEqual(['masu', 'masen', 'mashita', 'masen-deshita', 'masho']);
    expect(c?.[0]?.accept).toEqual(['飲みます', 'のみます']);
    // step-only chain without a conjugable item
    const d = buildChain(null, { forms: ['te', 'ta'], answers: ['行って', '行った'] });
    expect(d?.map((l) => l.accept[0])).toEqual(['行って', '行った']);
    // a form without any answer is dropped
    expect(buildChain(null, { forms: ['te', 'ta'], answers: ['行って'] })?.length).toBe(1);
    expect(buildChain(null, {})).toBeNull();
    expect(buildChain(null, { forms: ['te'] })).toBeNull();
    // without a head word the planner's flat accept list is split by kana tail: のみません → 飲みません, not 飲みます
    const e = buildChain(null, { forms: ['masu', 'masen', 'ta'], answers: ['飲みます', '飲みません', '飲んだ'], accept: ['飲みます', 'のみます', '飲みません', 'のみません', '飲んだ', 'のんだ'] });
    expect(e?.map((l) => l.accept)).toEqual([
      ['飲みます', 'のみます'],
      ['飲みません', 'のみません'],
      ['飲んだ', 'のんだ'],
    ]);
    // the longest tail wins: いかなかった ends with った but belongs to 行かなかった
    const f = buildChain(null, { forms: ['ta', 'nakatta'], answers: ['行った', '行かなかった'], accept: ['いった', 'いかなかった'] });
    expect(f?.map((l) => l.accept)).toEqual([
      ['行った', 'いった'],
      ['行かなかった', 'いかなかった'],
    ]);
  });

  it('chainResult: aggregate grading bands 5/5 Good, 4/5 Hard (near miss), ≤ 3/5 Again, misses tagged conjugation', () => {
    const ctx = { ms: 1234, hintUsed: false };
    expect(chainResult(logOf(['right', 'right', 'right', 'right', 'right']), 5, ctx)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], hits: 5, ms: 1234 });
    expect(chainResult(logOf(['right', 'close', 'right', 'right', 'right']), 5, ctx)).toMatchObject({ correct: false, nearMiss: true, errorTags: ['conjugation'], hits: 4 });
    expect(chainResult(logOf(['right', 'miss', 'right', 'right', 'right']), 5, ctx)).toMatchObject({ correct: false, nearMiss: true, hits: 4 });
    expect(chainResult(logOf(['right', 'miss', 'miss', 'right', 'right']), 5, ctx)).toMatchObject({ correct: false, nearMiss: false, errorTags: ['conjugation'], hits: 3 });
    expect(chainResult(logOf(['miss', 'miss', 'miss', 'miss', 'miss']), 5, ctx)).toMatchObject({ correct: false, nearMiss: false, hits: 0 });
    // a one-link chain has no Hard band
    expect(chainResult(logOf(['miss']), 1, ctx)).toMatchObject({ correct: false, nearMiss: false });
    expect(chainResult(logOf(['right']), 1, { ms: 0, hintUsed: true })).toMatchObject({ correct: true, hintUsed: true });
  });
});

describe('<FormChain>', () => {
  it('walks five forms in turn: labels, progress, the log fills with marks, 5/5 → Good', () => {
    const pr = props();
    mount(pr);
    expect(root.textContent).toContain('One word, 5 forms.');
    expect(q('[data-dictionary="true"]')?.textContent).toBe('食べる');
    expect(states()).toEqual(['current', 'pending', 'pending', 'pending', 'pending']);
    expect(q('[data-progress="true"]')?.textContent).toBe('Form 1 of 5');
    expect(q('[data-target-form="true"]')?.textContent).toBe('polite present (〜ます)');
    answer(TYPED_RIGHT[0] as string);
    expect(states()).toEqual(['right', 'current', 'pending', 'pending', 'pending']);
    expect(q('[data-progress="true"]')?.textContent).toBe('Form 2 of 5');
    expect(q('[data-target-form="true"]')?.textContent).toBe('て-form');
    expect(pr.onResult).not.toHaveBeenCalled();
    for (const t of TYPED_RIGHT.slice(1)) answer(t);
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], hintUsed: false, ms: 0, answer: 'たべます / たべて / たべない / たべた / たべられる' });
    expect(states()).toEqual(['right', 'right', 'right', 'right', 'right']);
    expect(q('[data-tally="true"]')?.textContent).toBe('5 of 5 forms right.');
    expect(q('[data-band="true"]')?.textContent).toBe('Every form clean. Good.');
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('correct');
    expect(root.querySelector('input')).toBeNull();
  });

  it('on a grammar prod card (item = GrammarItem) the verb comes from params.sentence / promptEn and the chain runs to Good', () => {
    const MASU = FIXTURE.items[G.ます] as GrammarItem;
    // what the session builder sets for form-chain on g-n5-003 with 飲む picked
    const params = { forms: ['masu', 'masen', 'mashita'] as ConjForm[], answers: ['飲みます', '飲みません', '飲みました'], accept: ['飲みます', 'のみます', '飲みません', 'のみません', '飲みました', 'のみました'], sentence: '飲む', kana: 'のむ', promptEn: 'to drink' };
    const pr = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    mount(pr);
    expect(q('.gr-chain')?.getAttribute('data-state')).toBeNull();
    expect(q('[data-dictionary="true"]')?.textContent).toBe('飲む');
    expect(q('[data-gloss="true"]')?.textContent).toBe('to drink');
    expect(q('.gr__word-kana')?.textContent).toBe('のむ');
    expect(root.textContent).toContain('One word, 3 forms.');
    for (const t of ['nomimasu', 'nomimasen', 'nomimashita']) answer(t);
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, errorTags: [], answer: 'のみます / のみません / のみました' });
  });

  it('inferHeadWord recovers the verb group from the planner answers; null without a word or answers', () => {
    expect(inferHeadWord({ sentence: '食べる', kana: 'たべる', forms: ['masu', 'potential'], answers: ['食べます', '食べられる'] })).toEqual({ word: '食べる', kana: 'たべる', pos: 'v1' });
    expect(inferHeadWord({ sentence: '飲む', kana: 'のむ', forms: ['masu'], answers: ['飲みます'] })).toEqual({ word: '飲む', kana: 'のむ', pos: 'v5' });
    expect(inferHeadWord({ sentence: '飲む', kana: 'のむ', forms: ['masu'], answers: [''] })).toBeNull();
    expect(inferHeadWord({ forms: ['masu'], answers: ['飲みます'] })).toBeNull();
    expect(inferHeadWord({ sentence: '飲む', kana: 'のむ', forms: ['masu'], answers: ['食べます'] })).toBeNull();
  });

  it('on a grammar prod card the engine alternates (ら抜き potential) are right, not a Block; kana === word hides the reading span', () => {
    const MASU = FIXTURE.items[G.ます] as GrammarItem;
    // planner-shaped params for g-n5-003 with 食べる picked
    const params = {
      forms: ['masu', 'te', 'nai', 'ta', 'potential'] as ConjForm[],
      answers: ['食べます', '食べて', '食べない', '食べた', '食べられる'],
      accept: ['食べます', 'たべます', '食べて', 'たべて', '食べない', 'たべない', '食べた', 'たべた', '食べられる', 'たべられる', '食べれる', 'たべれる'],
      sentence: '食べる',
      kana: 'たべる',
      promptEn: 'to eat',
    };
    const chain = buildChain(null, params);
    expect(chain?.[4]?.accept).toEqual(expect.arrayContaining(['食べられる', 'たべられる', '食べれる', 'たべれる']));
    const pr = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    mount(pr);
    expect(q('.gr__word-kana')?.textContent).toBe('たべる');
    for (const t of TYPED_RIGHT.slice(0, 4)) answer(t);
    answer('tabereru');
    expect(states()).toEqual(['right', 'right', 'right', 'right', 'right']);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [] });

    act(() => render(null, root));
    mount(props({ item: MASU, step: step({ itemId: MASU.id, params: { forms: ['masu'] as ConjForm[], answers: ['あります'], accept: ['あります'], sentence: 'ある', kana: 'ある', promptEn: 'to exist' } }) }));
    expect(q('[data-dictionary="true"]')?.textContent).toBe('ある');
    expect(q('.gr__word-kana')).toBeNull();
  });

  it('4/5 → Hard: nearMiss with tag conjugation, the missed form shows given, expected and its rule', () => {
    const pr = props();
    mount(pr);
    answer(TYPED_RIGHT[0] as string);
    answer('tabemashite'); // wrong て-form
    expect(states()[1]).toBe('miss');
    expect(rows()[1]?.querySelector('.gr__given')?.textContent).toBe('たべまして');
    expect(rows()[1]?.querySelector('[data-expected="true"]')?.textContent).toBe('食べて');
    for (const t of TYPED_RIGHT.slice(2)) answer(t);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, errorTags: ['conjugation'] });
    expect(q('[data-tally="true"]')?.textContent).toBe('4 of 5 forms right.');
    expect(q('[data-band="true"]')?.textContent).toBe('One form slipped. Hard.');
    expect(q('[data-rule="te"]')?.textContent).toContain('Group 2: drop る, add て.');
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('partial');
  });

  it('3/5 → Again; a Block on one form counts as a slip and is marked close', () => {
    const pr = props();
    mount(pr);
    answer('tabemasuu'); // vowel-length slip → close
    expect(states()[0]).toBe('close');
    answer('tabete');
    answer('tabenaii'); // slip → close
    answer('tabeta');
    answer('taberareru');
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['conjugation'] });
    expect(q('[data-tally="true"]')?.textContent).toBe('3 of 5 forms right.');
    expect(q('[data-band="true"]')?.textContent).toContain('More than one slipped.');
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('wrong');
    expect(root.querySelectorAll('[data-rule]').length).toBe(2);
  });

  it('kanji, kana and engine alternates are all right; showing a rule is a hint for the whole chain', () => {
    const pr = props({ step: step({ params: { forms: ['potential', 'te'] } }) });
    mount(pr);
    act(() => btn('Show the rule').click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('られる');
    answer('tabereru'); // ら-dropped alternate
    expect(states()[0]).toBe('right');
    expect(q('[data-hint="true"]')).toBeNull(); // the hint closes with the step
    answer('tabete');
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true, answer: 'たべれる / たべて' });
  });

  it('builds the chain from the word when the step carries no forms; runner answers work on any vocab item', () => {
    const pr = props({ item: NOMU, step: step({ itemId: NOMU.id, params: {} }) });
    mount(pr);
    expect(q('.gr-chain')?.getAttribute('data-length')).toBe('5');
    expect(q('[data-target-form="true"]')?.textContent).toBe('polite present (〜ます)');
    answer('nomimasu');
    expect(states()[0]).toBe('right');

    act(() => render(null, root));
    const pr2 = props({ item: INU, step: step({ itemId: INU.id, params: { forms: ['te'], answers: ['いて'] } }) });
    mount(pr2);
    expect(q('.gr-chain')?.getAttribute('data-length')).toBe('1');
    expect(q('[data-dictionary="true"]')?.textContent).toBe('犬');
    answer('ite');
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });

    act(() => render(null, root));
    const pr3 = props({ item: null, step: step({ itemId: null, params: { forms: ['te'], answers: ['行って'] } }) });
    mount(pr3);
    expect(q('.gr-chain')?.getAttribute('data-state')).toBe('unavailable'); // no word to show
  });

  it('without a conjugable item and without step answers it degrades honestly', () => {
    const pr = props({ item: INU, step: step({ itemId: INU.id, params: {} }) });
    mount(pr);
    expect(q('.gr-chain')?.getAttribute('data-state')).toBe('unavailable');
    expect(root.textContent).toContain('犬');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});

describe('head word from the step (grammar prod cards: params.pos / params.accepts)', () => {
  const MASU = FIXTURE.items[G.ます] as GrammarItem;
  /** 帰る is godan despite its る-tail: 帰ります · 帰って · 帰らない · 帰った · 帰れる */
  const KAERU = ['帰ります', '帰って', '帰らない', '帰った', '帰れる'];

  it('inferHeadWord takes params.pos as given; without it the answers decide, uniquely (a godan る-verb is not read as ichidan; 〜ば alone is ambiguous; する is irregular)', () => {
    expect(inferHeadWord({ sentence: '帰る', kana: 'かえる', pos: 'v5', forms: ['masu'] })).toEqual({ word: '帰る', kana: 'かえる', pos: 'v5' });
    expect(inferHeadWord({ sentence: '帰る', kana: 'かえる', forms: ['masu'], answers: ['帰ります'] })).toEqual({ word: '帰る', kana: 'かえる', pos: 'v5' });
    expect(inferHeadWord({ sentence: '切る', kana: 'きる', forms: ['te'], answers: ['切って'] })?.pos).toBe('v5');
    expect(inferHeadWord({ sentence: '着る', kana: 'きる', forms: ['te'], answers: ['着て'] })?.pos).toBe('v1');
    expect(inferHeadWord({ sentence: '勉強する', kana: 'べんきょうする', forms: ['masu'], answers: ['勉強します'] })?.pos).toBe('v-irr');
    expect(inferHeadWord({ sentence: '食べる', kana: 'たべる', forms: ['ba'], answers: ['食べれば'] })).toBeNull(); // ichidan and godan agree: no guess
    expect(inferHeadWord({ sentence: '食べる', kana: 'たべる', forms: ['ba', 'masu'], answers: ['食べれば', '食べます'] })?.pos).toBe('v1');
  });

  it('buildChain conjugates every link from params.pos + kana, so 帰る / 切る are godan and 着る ichidan on the same kana; a params.accepts row is graded as given', () => {
    const kaeru = buildChain(null, { sentence: '帰る', kana: 'かえる', pos: 'v5', forms: [...FORMS] });
    expect(kaeru?.map((l) => l.accept[0])).toEqual(KAERU);
    expect(kaeru?.map((l) => l.accept[1])).toEqual(['かえります', 'かえって', 'かえらない', 'かえった', 'かえれる']);
    expect(kaeru?.[4]?.accept).not.toContain('帰られる');
    expect(buildChain(null, { sentence: '切る', kana: 'きる', pos: 'v5', forms: ['masu'] })?.[0]?.accept).toEqual(['切ります', 'きります']);
    expect(buildChain(null, { sentence: '着る', kana: 'きる', pos: 'v1', forms: ['masu'] })?.[0]?.accept).toEqual(['着ます', 'きます']);
    const rows = buildChain(null, { sentence: '帰る', kana: 'かえる', pos: 'v5', forms: ['masu', 'potential'], answers: ['帰ります', '帰れる'], accepts: [['帰ります', 'かえります'], ['帰れる', 'かえれる', '帰られる']] });
    expect(rows?.[1]?.accept).toEqual(['帰れる', 'かえれる', '帰られる']);
  });

  it('on a grammar prod card with params.pos the chain names the group and grades the kana of every link exactly (5/5 Good)', () => {
    const params = { forms: [...FORMS] as ConjForm[], answers: KAERU, pos: 'v5' as const, sentence: '帰る', kana: 'かえる', promptEn: 'to return', accepts: KAERU.map((a) => [a]) };
    const pr = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    mount(pr);
    expect(q('[data-dictionary="true"]')?.textContent).toBe('帰る');
    expect(root.textContent).toContain('Group 1 verb');
    for (const t of ['kaerimasu', 'kaette', 'kaeranai', 'kaetta', 'kaereru']) answer(t);
    expect(states()).toEqual(['right', 'right', 'right', 'right', 'right']);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'かえります / かえって / かえらない / かえった / かえれる' });
  });

  it('an adjective head word (adj-* point, params.pos adj-i) builds every link from the engine and runs to Good', () => {
    const ADJ_FORMS = ['adj-neg', 'adj-past', 'adj-past-neg', 'adj-te', 'adj-adv'] as ConjForm[];
    const params = { forms: ADJ_FORMS, answers: ['おいしくない', 'おいしかった', 'おいしくなかった', 'おいしくて', 'おいしく'], pos: 'adj-i' as const, sentence: 'おいしい', kana: 'おいしい', promptEn: 'delicious' };
    expect(inferHeadWord(params)).toEqual({ word: 'おいしい', kana: 'おいしい', pos: 'adj-i' });
    expect(buildChain(null, params)?.map((l) => l.accept[0])).toEqual(params.answers);
    const pr = props({ item: MASU, step: step({ itemId: MASU.id, params }) });
    mount(pr);
    expect(q('.gr-chain')?.getAttribute('data-state')).toBeNull();
    expect(q('[data-dictionary="true"]')?.textContent).toBe('おいしい');
    for (const t of ['oishikunai', 'oishikatta', 'oishikunakatta', 'oishikute', 'oishiku']) answer(t);
    expect(states()).toEqual(['right', 'right', 'right', 'right', 'right']);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [] });
  });

  it("the frame's ? key opens the current form's rule once (hintUsed), then the Hint button is withdrawn until the next form", () => {
    const pr = props();
    act(() =>
      render(
        <ExerciseFrame step={pr.step} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          <FormChain {...pr} />
        </ExerciseFrame>,
        root,
      ),
    );
    const press = (k: string): void => {
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      });
    };
    expect(q('.exercise-frame__hint')).not.toBeNull();
    press('?');
    expect(q('[data-hint="true"]')).not.toBeNull();
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('.exercise-frame__hint')).toBeNull();
    press('?');
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    answer('tabemasu');
    expect(q('[data-hint="true"]')).toBeNull();
    expect(q('.exercise-frame__hint')).not.toBeNull(); // the next form has its own rule to offer
  });
});
