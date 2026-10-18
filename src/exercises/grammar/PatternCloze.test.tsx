import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G } from '@/content/fixtures';
import type { GrammarItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import { mulberry32 } from '@/shared/hash';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { PatternCloze, TILE_EXPOSURES, buildClozePrompt, clozeChoices, isGrammarItem, meta } from './PatternCloze';

const MASU = FIXTURE.items[G.ます] as GrammarItem; // examples: パンを食べます。· 水を飲みます。· 人がいます。
const DESU = FIXTURE.items[G.です] as GrammarItem;
const SENTENCE = '{毎朝|まいあさ}コーヒーを{飲|の}みます。'; // plain: 毎朝コーヒーを飲みます。 (飲みます at 7..11)

let root: HTMLDivElement;
let speakSpy: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  await makeTestStore({ now: 4_000 });
});
beforeEach(() => {
  speakSpy = vi.fn(() => Promise.resolve());
  installServices({ audio: { ...nullAudio, speak: speakSpy as unknown as typeof nullAudio.speak } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'pc-1',
    block: 'reviews',
    exercise: 'pattern-cloze',
    itemId: MASU.id,
    cardKey: 'g-n5-003#cloze',
    params: { sentence: SENTENCE, blank: [7, 11], answer: '飲みます', promptEn: 'I drink coffee every morning.' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 8000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: MASU,
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
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={3} ki={0} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(pr: ExerciseProps, framed = false): void {
  act(() => render(framed ? inFrame(<PatternCloze {...pr} />, pr.step) : <PatternCloze {...pr} />, root));
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
const input = (): HTMLInputElement => root.querySelector('input') as HTMLInputElement;
const btn = (text: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) as HTMLButtonElement;

describe('PatternCloze helpers', () => {
  it('meta: pattern-cloze on the cloze facet, needs TTS, kana keys', () => {
    expect(meta).toMatchObject({ id: 'pattern-cloze', facet: 'cloze', needsTts: true, keys: 'kana' });
    expect(TILE_EXPOSURES).toBe(1);
    expect(isGrammarItem(MASU)).toBe(true);
    expect(isGrammarItem(FIXTURE.items['v-n5-0001'])).toBe(false);
  });

  it('buildClozePrompt: blank from params.blank, answer from params or the sentence, gloss from params or the example', () => {
    const a = buildClozePrompt(MASU, { sentence: SENTENCE, blank: [7, 11], answer: '飲みます' }, 0);
    expect(a).toMatchObject({ pieces: ['{毎朝|まいあさ}コーヒーを', '{飲|の}みます', '。'], plain: '毎朝コーヒーを飲みます。', answer: '飲みます', answerKana: 'のみます', gloss: null, kana: null });
    const b = buildClozePrompt(MASU, { sentence: SENTENCE, blank: [7, 11] }, 0);
    expect(b?.answer).toBe('飲みます');
    const c = buildClozePrompt(MASU, { sentence: SENTENCE }, 0); // clozeHints ['ます'] → first occurrence
    expect(c?.pieces).toEqual(['{毎朝|まいあさ}コーヒーを{飲|の}み', 'ます', '。']);
    expect(c?.answer).toBe('ます');
    expect(c?.answerKana).toBeNull();
  });

  it('buildClozePrompt rotates the examples by exposure when the step carries no sentence', () => {
    const e0 = buildClozePrompt(MASU, {}, 0);
    expect(e0).toMatchObject({ plain: 'パンを食べます。', answer: 'ます', gloss: 'I eat bread.', kana: 'パンをたべます。' });
    expect(e0?.pieces).toEqual(['パンを{食|た}べ', 'ます', '。']);
    const e1 = buildClozePrompt(MASU, {}, 1);
    expect(e1?.plain).toBe('水を飲みます。');
    expect(buildClozePrompt(MASU, {}, 3)?.plain).toBe('パンを食べます。');
    expect(buildClozePrompt(null, {}, 0)).toBeNull();
    expect(buildClozePrompt(MASU, { sentence: 'おはよう。' }, 0)).toBeNull();
    expect(buildClozePrompt(null, { sentence: SENTENCE, answer: '飲みます' }, 0)?.answer).toBe('飲みます');
  });

  it('clozeChoices keeps given tiles (answer guaranteed), else draws seeded tiles containing the answer', () => {
    expect(clozeChoices(MASU, { tiles: ['ます', 'です', 'ません', 'ました'] }, 'ます', mulberry32(1))).toEqual(['ます', 'です', 'ません', 'ました']);
    expect(clozeChoices(MASU, { choices: ['です', 'ません'] }, 'ます', mulberry32(1))).toEqual(['ます', 'です', 'ません']);
    const drawn = clozeChoices(MASU, {}, 'ます', mulberry32(2));
    expect(drawn.length).toBe(4);
    expect(drawn).toContain('ます');
    expect(new Set(drawn).size).toBe(4);
    expect(clozeChoices(MASU, {}, 'ます', mulberry32(2))).toEqual(drawn);
    expect(clozeChoices(null, {}, 'ます', mulberry32(2))).toEqual([]);
  });
});

describe('<PatternCloze> typed', () => {
  it('renders the sentence with the blank from params, the gloss, speaks the whole sentence once, and replays on demand', () => {
    const pr = props();
    mount(pr);
    expect(q('.gr-cloze')?.getAttribute('data-mode')).toBe('typed');
    expect(q('[data-blank="true"]')?.textContent).toBe('＿＿');
    const rts = Array.from(root.querySelectorAll('.gr__sentence rt')).map((r) => r.textContent);
    expect(rts).toEqual(['まいあさ']);
    expect(root.textContent).toContain('I drink coffee every morning.');
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledWith('毎朝コーヒーを飲みます。', undefined);
    act(() => btn('Replay the sentence').click());
    expect(speakSpy).toHaveBeenCalledTimes(2);
    expect(pr.onReplay).toHaveBeenCalledTimes(1);
  });

  it('passes params.clip through to every play (design 08 §8), with the kana when the example carries one', () => {
    const pr = props({ step: step({ params: { sentence: SENTENCE, blank: [7, 11], answer: '飲みます', promptEn: 'I drink coffee every morning.', clip: 'g-n5-003#ex1' } }) });
    mount(pr);
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledWith('毎朝コーヒーを飲みます。', { clip: 'g-n5-003#ex1' });
    act(() => btn('Replay the sentence').click());
    expect(speakSpy).toHaveBeenLastCalledWith('毎朝コーヒーを飲みます。', { clip: 'g-n5-003#ex1' });
    expect(speakSpy).toHaveBeenCalledTimes(2);

    act(() => render(null, root));
    speakSpy.mockClear();
    const derived = props({ item: DESU, step: step({ itemId: DESU.id, cardKey: 'g-n5-001#cloze', params: { clip: 'g-n5-001#ex0' } }), exposures: 2 });
    mount(derived);
    expect(speakSpy).toHaveBeenCalledWith('コーヒーはおいしいです。', { kana: 'コーヒーはおいしいです。', clip: 'g-n5-001#ex0' });
  });

  it('kana-equivalent answers are accepted: のみます for 飲みます → Good, and the blank fills with the ruby form', () => {
    const pr = props();
    mount(pr);
    type(input(), 'nomimasu');
    enter(input());
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, errorTags: [], answer: 'のみます', replays: 0, ms: 0 });
    expect(q('[data-blank="true"]')?.getAttribute('data-state')).toBe('correct');
    expect(q('[data-blank="true"] rt')?.textContent).toBe('の');
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('correct');
    expect(root.textContent).toContain('〜ます');
  });

  it('a wrong piece → Again with a diff; a small-kana slip → Block; a particle slip → Block tagged particle', () => {
    const pr = props();
    mount(pr);
    type(input(), 'tabemasu');
    enter(input());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: [] });
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('wrong');
    expect(q('.gr__diff')).not.toBeNull();
    expect(q('[data-blank="true"]')?.getAttribute('data-state')).toBe('wrong');

    act(() => render(null, root));
    const pr2 = props({ step: step({ params: { sentence: SENTENCE, blank: [7, 11], answer: 'のみます' } }) });
    mount(pr2);
    type(input(), 'nomimasuu');
    enter(input());
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, errorTags: ['vowel-length'] });
    expect(q('.gr__reveal')?.getAttribute('data-kind')).toBe('near');

    act(() => render(null, root));
    const pr3 = props({ step: step({ params: { sentence: '{水|みず}をください。', blank: [0, 2], answer: '水を' } }) });
    mount(pr3);
    type(input(), 'mizuga');
    enter(input());
    expect(pr3.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, errorTags: ['particle'] });
  });

  it('params.accept alternates count; Enter through the frame submits; replays are reported', () => {
    const s = step({ params: { sentence: SENTENCE, blank: [7, 11], answer: '飲みます', accept: ['のみました'] } });
    const pr = props({ step: s });
    mount(pr, true);
    press(' ');
    press(' ');
    expect(speakSpy).toHaveBeenCalledTimes(3);
    expect(pr.onReplay).toHaveBeenCalledTimes(2);
    type(input(), 'nomimashita');
    press('Enter'); // outside the field: the frame's Enter reaches the registered onSubmit
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, replays: 2 });
  });

  it('an empty submit nudges instead of grading; showing the pattern is a hint', () => {
    const pr = props();
    mount(pr);
    enter(input());
    expect(pr.onResult).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Type something first.');
    act(() => btn('Show the pattern').click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('〜ます');
    type(input(), 'nomimasu');
    enter(input());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('derives sentence, blank and gloss from the grammar point when the step carries none', () => {
    const pr = props({ item: DESU, step: step({ itemId: DESU.id, cardKey: 'g-n5-001#cloze', params: {} }), exposures: 2 });
    mount(pr);
    expect(q('.gr__sentence')?.textContent).toBe('コーヒーはおいしい＿＿。');
    expect(root.textContent).toContain('Coffee is delicious.');
    expect(speakSpy).toHaveBeenCalledWith('コーヒーはおいしいです。', { kana: 'コーヒーはおいしいです。' });
    type(input(), 'desu');
    enter(input());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
  });
});

describe('<PatternCloze> tiles (first exposure)', () => {
  it('shows four tiles with the answer, digits pick through the frame, the right tile is correct', () => {
    const s = step({ params: { sentence: SENTENCE, blank: [7, 11], answer: '飲みます', tiles: ['飲みました', '飲みます', '飲みません', '飲む'] } });
    const pr = props({ step: s, exposures: 0 });
    mount(pr, true);
    expect(q('.gr-cloze')?.getAttribute('data-mode')).toBe('tiles');
    const texts = Array.from(root.querySelectorAll('.choice .choice__text')).map((t) => t.textContent);
    expect(texts).toEqual(['飲みました', '飲みます', '飲みません', '飲む']);
    press('2');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: '飲みます', errorTags: [] });
    press('1');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
  });

  it('a wrong tile → Again, the right one marked missed; without step tiles seeded tiles are drawn', () => {
    const s = step({ params: { sentence: SENTENCE, blank: [7, 11], answer: '飲みます', tiles: ['飲みました', '飲みます', '飲みません', '飲む'] } });
    const pr = props({ step: s, exposures: 0 });
    mount(pr);
    act(() => (root.querySelector('.choice[data-index="0"]') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, answer: '飲みました' });
    expect(root.querySelector('.choice[data-index="1"]')?.getAttribute('data-state')).toBe('missed');

    act(() => render(null, root));
    const pr2 = props({ step: step({ params: {} }), exposures: 0 });
    mount(pr2);
    expect(q('.gr-cloze')?.getAttribute('data-mode')).toBe('tiles');
    expect(root.querySelectorAll('.choice').length).toBe(4);
    expect(Array.from(root.querySelectorAll('.choice .choice__text')).some((t) => t.textContent === 'ます')).toBe(true);
  });

  it('without a grammar item or a usable sentence it degrades honestly', () => {
    const pr = props({ item: null, step: step({ itemId: null, cardKey: null, params: {} }) });
    mount(pr);
    expect(q('.gr-cloze')?.getAttribute('data-state')).toBe('unavailable');
    expect(speakSpy).not.toHaveBeenCalled();
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});
