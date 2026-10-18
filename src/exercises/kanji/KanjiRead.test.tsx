import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { KanjiItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { makeTestStore } from '@/store/testing';
import { KanjiRead, buildReadPrompt, meta, splitRuby } from './KanjiRead';

const DRINK = FIXTURE.items['j-飲'] as KanjiItem; // examples: 飲む のむ · 飲み物 のみもの
const SENTENCE = '{犬|いぬ}が{水|みず}を{飲|の}みます。'; // plain: 犬が水を飲みます。

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 7_000 });
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
    id: 'kr-1',
    block: 'reviews',
    exercise: 'kanji-read',
    itemId: DRINK.id,
    cardKey: 'j-飲#read',
    params: { sentence: SENTENCE, blank: [4, 8], answer: 'のみます' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 2,
    estMs: 7000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: DRINK,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 2,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };
}

function mount(pr: ExerciseProps): HTMLInputElement {
  act(() => render(<KanjiRead {...pr} />, root));
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

describe('KanjiRead helpers', () => {
  it('meta: kanji-read on the read facet with kana keys', () => {
    expect(meta).toMatchObject({ id: 'kanji-read', facet: 'read', keys: 'kana', selfGraded: false });
  });

  it('splitRuby cuts at plain offsets and keeps ruby markup on each side', () => {
    expect(splitRuby(SENTENCE, 4, 8)).toEqual(['{犬|いぬ}が{水|みず}を', '{飲|の}みます', '。']);
    expect(splitRuby(SENTENCE, 0, 1)).toEqual(['', '{犬|いぬ}', 'が{水|みず}を{飲|の}みます。']);
    expect(splitRuby(SENTENCE, 50, 60)).toEqual([SENTENCE, '', '']);
  });

  it('buildReadPrompt uses params.blank, else finds an example word, else rotates examples by exposure', () => {
    const a = buildReadPrompt(DRINK, { sentence: SENTENCE, blank: [4, 8], answer: 'のみます' }, 0);
    expect(a).toMatchObject({ word: '飲みます', answer: 'のみます', gloss: null });
    expect(a?.sentence?.[1]).toBe('{飲|の}みます');

    const b = buildReadPrompt(DRINK, { sentence: '{飲|の}み{物|もの}をください。' }, 0);
    expect(b).toMatchObject({ word: '飲み物', answer: 'のみもの', gloss: 'drink' });
    expect(b?.sentence).toEqual(['', '{飲|の}み{物|もの}', 'をください。']);

    const c = buildReadPrompt(DRINK, {}, 0);
    expect(c).toMatchObject({ sentence: null, word: '飲む', answer: 'のむ', gloss: 'to drink' });
    const d = buildReadPrompt(DRINK, {}, 3);
    expect(d).toMatchObject({ sentence: null, word: '飲み物', answer: 'のみもの' });
    const e = buildReadPrompt(DRINK, { answer: 'のみもの' }, 0);
    expect(e?.word).toBe('飲み物');
    expect(buildReadPrompt(null, {}, 0)).toBeNull();
    expect(buildReadPrompt(null, { sentence: SENTENCE }, 0)).toBeNull();
    expect(buildReadPrompt(null, { sentence: SENTENCE, answer: 'のみます', blank: [4, 8] }, 0)?.word).toBe('飲みます');
  });

  it('blanks the occurrence the ruby names: a blank that cuts a compound or reads differently is re-located; without a blank the aligned occurrence beats the first', () => {
    const SUN = FIXTURE.items['j-日'] as KanjiItem; // examples: 日 ひ · 毎日 まいにち
    const JA = '{日本|にほん}の{日|ひ}は{日曜日|にちようび}です。'; // plain: 日本の日は日曜日です。
    // no blank: 日 first appears inside {日本|にほん} (cut) → the aligned 日/ひ at 3
    const a = buildReadPrompt(SUN, { sentence: JA }, 0);
    expect(a).toMatchObject({ word: '日', answer: 'ひ', gloss: 'day' });
    expect(a?.sentence).toEqual(['{日本|にほん}の', '{日|ひ}', 'は{日曜日|にちようび}です。']);
    // a blank cutting {日本} → re-located to the occurrence that reads ひ
    expect(buildReadPrompt(SUN, { sentence: JA, blank: [0, 1], answer: 'ひ' }, 0)?.sentence).toEqual(a?.sentence);
    // a blank cutting {日曜日} → the same
    expect(buildReadPrompt(SUN, { sentence: JA, blank: [7, 8], answer: 'ひ' }, 0)?.sentence).toEqual(a?.sentence);
    // the example's kana decides when the step has no answer
    expect(buildReadPrompt(SUN, { sentence: JA, blank: [0, 1] }, 0)?.sentence).toEqual(a?.sentence);
    // a blank whose ruby reads as the answer stays where the planner put it
    expect(buildReadPrompt(SUN, { sentence: JA, blank: [3, 4], answer: 'ひ' }, 0)?.sentence).toEqual(a?.sentence);
    expect(buildReadPrompt(SUN, { sentence: JA, blank: [5, 8], answer: 'にちようび' }, 0)).toMatchObject({ word: '日曜日', answer: 'にちようび' });
    expect(buildReadPrompt(SUN, { sentence: JA, blank: [0, 2], answer: 'にほん' }, 0)?.sentence).toEqual(['', '{日本|にほん}', 'の{日|ひ}は{日曜日|にちようび}です。']);
    // no aligned occurrence at all → the given blank is kept (bare kanji each side, as before)
    const NIHON = '{日本|にほん}は{広|ひろ}い。';
    expect(buildReadPrompt(SUN, { sentence: NIHON, blank: [0, 1], answer: 'ひ' }, 0)?.sentence).toEqual(['', '日', '本は{広|ひろ}い。']);
    // no blank, no aligned occurrence → the first plain hit, as before
    expect(buildReadPrompt(SUN, { sentence: NIHON }, 0)?.sentence).toEqual(['', '日', '本は{広|ひろ}い。']);
  });
});

describe('<KanjiRead>', () => {
  it('highlights the target without furigana while the rest of the sentence keeps its readings', () => {
    mount(props());
    const target = q('[data-target="true"]') as HTMLElement;
    expect(target.textContent).toBe('飲みます');
    expect(target.querySelector('rt')).toBeNull();
    const sentence = q('.kj__sentence') as HTMLElement;
    const rts = Array.from(sentence.querySelectorAll('rt')).map((r) => r.textContent);
    expect(rts).toEqual(['いぬ', 'みず']);
    expect(sentence.getAttribute('lang')).toBe('ja');
    expect(root.textContent).toContain('Type the reading of the highlighted word.');
    expect(q('.text-answer')?.getAttribute('data-mode')).toBe('ja');
  });

  it('the exact reading → correct; the target then shows its furigana and the kanji meaning', () => {
    const pr = props();
    const input = mount(pr);
    type(input, 'nomimasu');
    enter(input);
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, errorTags: [], answer: 'のみます', ms: 0 });
    expect(q('[data-target="true"] rt')?.textContent).toBe('の');
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('correct');
    expect(root.textContent).toContain('drink');
  });

  it('a wrong reading → Again tagged kanji-reading; a long-vowel slip → Block tagged vowel-length', () => {
    const pr = props();
    const input = mount(pr);
    type(input, 'tabemasu');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['kanji-reading'], answer: 'たべます' });
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('wrong');

    act(() => render(null, root));
    const pr2 = props({ step: step({ params: {} }) }); // word-only: 飲む → のむ (exposures 2 → index 0)
    const input2 = mount(pr2);
    expect(q('.kj-read')?.getAttribute('data-mode')).toBe('word');
    expect(q('[data-target="true"]')?.textContent).toBe('飲む');
    type(input2, 'nomuu');
    enter(input2);
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, errorTags: ['vowel-length'] });
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('partial');
  });

  it('a particle slip is not tolerated for a reading', () => {
    const pr = props();
    const input = mount(pr);
    type(input, 'nomimasuwo');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['kanji-reading'] });
  });

  it('showing the gloss first is a hint: onHint fires and hintUsed is set', () => {
    const pr = props({ step: step({ params: { sentence: SENTENCE, blank: [4, 8], answer: 'のみます', promptEn: 'to drink' } }) });
    const input = mount(pr);
    const hint = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Show the meaning') as HTMLButtonElement;
    act(() => hint.click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('to drink');
    type(input, 'nomimasu');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('word-only mode rotates through the examples by exposure and accepts params.accept alternates', () => {
    const pr = props({ step: step({ params: { accept: ['のみもん'] } }), exposures: 1 });
    const input = mount(pr);
    expect(q('[data-target="true"]')?.textContent).toBe('飲み物');
    type(input, 'nomimon');
    enter(input);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
  });

  it('without a kanji item or a sentence it degrades honestly', () => {
    const pr = props({ item: null, step: step({ itemId: null, cardKey: null, params: {} }) });
    mount(pr);
    expect(q('.kj-read')?.getAttribute('data-state')).toBe('unavailable');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});
