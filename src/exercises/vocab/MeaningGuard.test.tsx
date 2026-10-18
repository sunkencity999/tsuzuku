import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { card, makeTestStore } from '@/store/testing';
import { MeaningGuard, correctChoice, fogFor, meta, readingHidden, speakWord, wordClipKey, wordRuby } from './MeaningGuard';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock, cards: { 'j-水#read': card({ s: 12, reps: 5, state: 2 }), 'j-飲#read': card({ s: 2, reps: 2, state: 1 }) } });
  installServices({ audio: { ...nullAudio, speak } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const MIZU = FIXTURE.items[V.水] as VocabItem;
const NOMU = FIXTURE.items[V.飲む] as VocabItem;
const CHOICES = ['dog', 'water', 'bread', 'person'];

function step(over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'meaning-guard',
    itemId: MIZU.id,
    cardKey: `${MIZU.id}#rec`,
    params: { answer: 'water', accept: ['water'], choices: CHOICES },
    timed: false,
    isNew: true,
    stepTag: 'intro',
    exposures: 0,
    estMs: 5000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };

function props(over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(),
    item: MIZU,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 0,
    onResult: vi.fn(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as P;
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(p: ExerciseProps, framed = false): void {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<MeaningGuard {...p} />, p.step) : <MeaningGuard {...p} />, root));
}

function key(k: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const cells = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers meaning-guard on the rec facet with choice keys', () => {
    expect(meta).toMatchObject({ id: 'meaning-guard', facet: 'rec', keys: 'choices', selfGraded: false });
  });
});

describe('<MeaningGuard>', () => {
  it('a wrong pick grades Again tagged word-choice; the pitch line appears only after the answer', () => {
    const p = props();
    mount(p);
    expect(q('.pitch-line')).toBeNull();
    expect(cells().length).toBe(4);
    clock += 1800;
    act(() => cells()[0]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: false, nearMiss: false, errorTags: ['word-choice'], answer: 'dog', ms: 1800, hintUsed: false, replays: 0 });
    expect(cells()[0]?.getAttribute('data-state')).toBe('wrong');
    expect(cells()[1]?.getAttribute('data-state')).toBe('missed');
    const pitch = q('.pitch-line');
    expect(pitch).not.toBeNull();
    expect(pitch?.getAttribute('data-type')).toBe('heiban');
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('false');
    expect(q('.vocab__collocation')?.textContent).toBe('水を飲む');
    expect(q('.vocab__meaning-en')?.textContent).toContain('water');
  });

  it('the right pick grades Good through a frame digit', () => {
    const p = props();
    mount(p, true);
    key('2');
    expect(result(p)).toMatchObject({ correct: true, errorTags: [], answer: 'water' });
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('true');
    key('1');
    expect(p.onResult).toHaveBeenCalledTimes(1);
  });

  it('speaks the word on mount and on Space; replays are counted', () => {
    const p = props();
    mount(p, true);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('水', { kana: 'みず', clip: MIZU.id });
    key(' ');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(p.onReplay).toHaveBeenCalledTimes(1);
    act(() => cells()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true, replays: 1 });
  });

  it('renders the word with ruby in `always`, fogs a mature kanji reading in `fog`, and a fog tap is a hint', () => {
    mount(props());
    expect(q('.drill__word ruby rt')?.textContent).toBe('みず');
    expect(q('.ruby__seg--fog')).toBeNull();

    const p = props({ furigana: 'fog' });
    mount(p);
    const fogged = q('.ruby__seg--fog');
    expect(fogged).not.toBeNull();
    act(() => fogged?.click());
    expect(p.onHint).toHaveBeenCalledTimes(1);
    expect(q('.ruby__seg--fog')).toBeNull();
    act(() => cells()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true, hintUsed: true });

    // a young read card keeps its furigana
    const young = props({ furigana: 'fog', item: NOMU, step: step({ itemId: NOMU.id, cardKey: `${NOMU.id}#rec`, params: { answer: 'to drink', choices: ['to eat', 'to drink', 'dog', 'day'] } }) });
    mount(young);
    expect(q('.ruby__seg--fog')).toBeNull();
    expect(q('.drill__word ruby rt')?.textContent).toBe('の');
  });

  it('builds four choices containing the meaning when the planner gave none or an unwinnable set', () => {
    const p = props({ step: step({ params: { answer: 'water' } }) });
    mount(p);
    const texts = cells().map((b) => b.querySelector('.choice__text')?.textContent);
    expect(texts.length).toBe(4);
    expect(texts).toContain('water');
    expect(new Set(texts).size).toBe(4);
    const bad = props({ step: step({ params: { answer: 'water', choices: ['dog', 'cat', 'bird', 'fish'] } }) });
    mount(bad);
    expect(cells().map((b) => b.querySelector('.choice__text')?.textContent)).toContain('water');
  });

  it('from Station 34 (jj) the gloss is the J-J definition with English behind a tap', () => {
    const item: VocabItem = { ...MIZU, definitionJa: { ja: '{飲|の}むもの。', kana: 'のむもの。' } };
    const p = props({ jj: true, item });
    mount(p);
    act(() => cells()[1]?.click());
    expect(q('.vocab__definition')?.textContent).toContain('飲');
    expect(q('.vocab__meaning-en')).toBeNull();
    const toggle = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show English') as HTMLButtonElement;
    act(() => toggle.click());
    expect(q('.vocab__meaning-en')?.textContent).toBe('water');
    // no definition yet: honest fallback to English
    const q2 = props({ jj: true });
    mount(q2);
    act(() => cells()[1]?.click());
    expect(q('.vocab__meaning-en')?.textContent).toContain('water');
    expect(q('.vocab__meaning-en')?.textContent).toContain('No Japanese definition');
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props({ item: null });
    mount(p);
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});

describe('speakWord (design 08 §8 clip keys)', () => {
  it('passes clip item.id for the bare word (with its kana) and #col<k> for a collocation (spoken as written, no kana)', async () => {
    await speakWord(NOMU);
    expect(speak).toHaveBeenLastCalledWith('飲む', { kana: 'のむ', clip: NOMU.id });
    await speakWord(NOMU, '飲む');
    expect(speak).toHaveBeenLastCalledWith('飲む', { kana: 'のむ', clip: NOMU.id });
    await speakWord(NOMU, 'お茶を飲む');
    expect(speak).toHaveBeenLastCalledWith('お茶を飲む', { clip: `${NOMU.id}#col0` });
    await speakWord(NOMU, '薬を飲む');
    expect(speak).toHaveBeenLastCalledWith('薬を飲む', { clip: `${NOMU.id}#col1` });
    // text that is neither the word nor a listed collocation: no key, the device voice reads it as written
    await speakWord(NOMU, '水を飲む');
    expect(speak).toHaveBeenLastCalledWith('水を飲む', undefined);
    expect(speak).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kana: 'のむ', clip: expect.stringContaining('#col') }));
  });

  it('wordClipKey names the key without speaking', () => {
    expect(wordClipKey(NOMU)).toBe(NOMU.id);
    expect(wordClipKey(NOMU, '飲む')).toBe(NOMU.id);
    expect(wordClipKey(NOMU, '薬を飲む')).toBe(`${NOMU.id}#col1`);
    expect(wordClipKey(NOMU, 'ご飯')).toBeNull();
    expect(wordClipKey({ id: 'v-n5-0001', word: '犬' }, 'x')).toBeNull();
  });
});

describe('helpers', () => {
  it('wordRuby aligns the kanji core with its reading', () => {
    expect(wordRuby('食べる', 'たべる')).toBe('{食|た}べる');
    expect(wordRuby('お茶', 'おちゃ')).toBe('お{茶|ちゃ}');
    expect(wordRuby('水', 'みず')).toBe('{水|みず}');
    expect(wordRuby('食べ物', 'たべもの')).toBe('{食べ物|たべもの}');
    expect(wordRuby('美味しい', 'おいしい')).toBe('{美味|おい}しい');
    expect(wordRuby('おいしい', 'おいしい')).toBe('おいしい');
    expect(wordRuby('コーヒー', 'コーヒー')).toBe('コーヒー');
    expect(wordRuby('日本人', 'にほんじん')).toBe('{日本人|にほんじん}');
  });

  it('fogFor hides a reading only when every kanji has a read card with S ≥ 7 d', () => {
    expect(fogFor('水')).toBe(true);
    expect(fogFor('飲')).toBe(false);
    expect(fogFor('人')).toBe(false); // no card
    expect(fogFor('みず')).toBe(false);
  });

  it('correctChoice finds the meaning through normalizeEn and params', () => {
    expect(correctChoice(['Dog', 'The water', 'bread'], MIZU, {})).toBe(1);
    expect(correctChoice(['to eat', 'to drink'], NOMU, {})).toBe(1);
    expect(correctChoice(['a', 'b'], MIZU, { answer: 'b' })).toBe(1);
    expect(correctChoice(['a', 'b'], MIZU, {})).toBe(-1);
  });

  it('correctChoice prefers params.answer, then the primary gloss, over a secondary meaning that is also a choice', () => {
    const OISHII = FIXTURE.items[V.おいしい] as VocabItem; // meanings: delicious | tasty
    expect(correctChoice(['tasty', 'delicious', 'bitter', 'cold'], OISHII, {})).toBe(1);
    expect(correctChoice(['tasty', 'bitter'], OISHII, {})).toBe(0);
    expect(correctChoice(['tasty', 'delicious'], OISHII, { answer: 'tasty' })).toBe(0);
    expect(correctChoice(['Tasty', 'delicious'], OISHII, { accept: ['tasty'] })).toBe(1);
  });
});

describe('frame hint key', () => {
  it('readingHidden: a kana-only word has nothing to show; off / tap hide the reading; fog only when the kanji core is fogged', () => {
    expect(readingHidden(MIZU, 'always')).toBe(false);
    expect(readingHidden(MIZU, 'off')).toBe(true);
    expect(readingHidden(MIZU, 'tap')).toBe(true);
    expect(readingHidden(MIZU, 'fog')).toBe(true); // 水#read is mature in this store
    expect(readingHidden(NOMU, 'fog')).toBe(false); // 飲#read is young
    expect(readingHidden({ ...MIZU, word: 'みず' }, 'off')).toBe(false);
  });

  it("the frame's ? / Hint button shows the reading under the word while it is hidden (the same hint as a fog tap); nothing is on offer with furigana always", () => {
    const p = props({ furigana: 'off' });
    mount(p, true);
    expect(q('.vocab__kana')).toBeNull();
    expect(q('.exercise-frame__hint')).not.toBeNull();
    key('?');
    expect(q('.vocab__kana')?.textContent).toBe('みず');
    expect(p.onHint).toHaveBeenCalledTimes(1);
    expect(q('.exercise-frame__hint')).toBeNull();
    key('?');
    expect(p.onHint).toHaveBeenCalledTimes(1);
    act(() => cells()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true, hintUsed: true });

    const plain = props();
    mount(plain, true);
    expect(q('.exercise-frame__hint')).toBeNull();
    key('?');
    expect(plain.onHint).not.toHaveBeenCalled();
    expect(q('.vocab__kana')).toBeNull();
  });
});
