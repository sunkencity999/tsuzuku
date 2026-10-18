import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { MeaningRecall, acceptEn, meta } from './MeaningRecall';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock });
  installServices({ audio: { ...nullAudio, speak } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NOMU = FIXTURE.items[V.飲む] as VocabItem; // meanings ['to drink'], collocations, pitch 1 (high)
const WATASHI = FIXTURE.items[V.私] as VocabItem; // meanings ['I', 'me']

function step(item: VocabItem, over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'meaning-recall',
    itemId: item.id,
    cardKey: `${item.id}#rec`,
    params: { answer: item.meanings[0], accept: item.meanings },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 4,
    estMs: 7000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };

function props(item: VocabItem | null = NOMU, over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(item ?? NOMU),
    item,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 4,
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

function mount(p: ExerciseProps, framed = false): HTMLInputElement {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<MeaningRecall {...p} />, p.step) : <MeaningRecall {...p} />, root));
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

function key(target: EventTarget, k: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers meaning-recall on the rec facet with text keys and no speed pressure', () => {
    expect(meta).toMatchObject({ id: 'meaning-recall', facet: 'rec', keys: 'text', timeable: false, selfGraded: false });
  });
});

describe('<MeaningRecall>', () => {
  it('accepts any meanings entry, fuzzily, and shows collocations and the pitch line after the answer', () => {
    const p = props(WATASHI, { step: step(WATASHI) });
    const input = mount(p);
    expect(q('.vocab__collocations')).toBeNull();
    clock += 2200;
    type(input, 'me');
    key(input, 'Enter');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'me', ms: 2200, hintUsed: false, replays: 0 });
    expect(result(p).selfRating).toBeUndefined();
    expect(q('.pitch-line')?.getAttribute('data-type')).toBe('heiban');

    const n = props();
    const input2 = mount(n);
    type(input2, 'drink'); // "to" stripped
    key(input2, 'Enter');
    expect(result(n)).toMatchObject({ correct: true });
    expect(Array.from(root.querySelectorAll('.vocab__collocation')).map((li) => li.textContent)).toEqual(['お茶を飲む', '薬を飲む']);
    expect(q('.pitch-line')?.getAttribute('data-type')).toBe('atamadaka');

    const f = props();
    const input3 = mount(f);
    type(input3, 'to drnk'); // one edit on ≥ 5 chars
    key(input3, 'Enter');
    expect(result(f)).toMatchObject({ correct: true });
  });

  it('a miss opens the confirm step; "No. Mark it." grades Again tagged word-choice', () => {
    const p = props();
    const input = mount(p);
    type(input, 'to eat');
    key(input, 'Enter');
    expect(p.onResult).not.toHaveBeenCalled();
    expect(q('.text-answer')?.getAttribute('data-phase')).toBe('confirm');
    act(() => (q('.text-answer__decline') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, nearMiss: false, errorTags: ['word-choice'], answer: 'to eat' });
    expect(result(p).selfRating).toBeUndefined();
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('false');
    expect(q('.text-answer__reveal .text-answer__form')?.textContent).toBe('to drink');
  });

  it('"I meant that" reports correct with selfRating 3 so the writer logs it for the Judge', () => {
    const p = props();
    const input = mount(p);
    type(input, 'to swallow');
    key(input, 'Enter');
    act(() => (q('.text-answer__override') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: true, selfRating: 3, errorTags: [], answer: 'to swallow' });
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('near');
    expect(q('.text-answer__why')?.textContent).toBe('Noted. The inspector may ask about this one.');
  });

  it('speaks the word on mount, Space replays through the frame, Enter outside the field submits', () => {
    const p = props();
    const input = mount(p, true);
    expect(speak).toHaveBeenCalledWith('飲む', { kana: 'のむ', clip: NOMU.id });
    key(document.body, ' ');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(p.onReplay).toHaveBeenCalledTimes(1);
    type(input, 'to drink');
    input.blur();
    key(document.body, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, replays: 1 });
  });

  it('a fog reveal is a hint carried into the result', () => {
    const p = props(NOMU, { furigana: 'tap' });
    const input = mount(p);
    const fogged = q('.ruby__seg--fog');
    expect(fogged).not.toBeNull();
    act(() => fogged?.click());
    expect(p.onHint).toHaveBeenCalledTimes(1);
    type(input, 'to drink');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, hintUsed: true });
  });

  it('from Station 34 the reveal is J-J with English behind a tap; the widget keeps its own English reveal off', () => {
    const item: VocabItem = { ...NOMU, definitionJa: { ja: '{水|みず}やお{茶|ちゃ}を{口|くち}に{入|い}れる。', kana: 'みずやおちゃをくちにいれる。' } };
    const p = props(item, { jj: true, step: step(item) });
    const input = mount(p);
    type(input, 'to eat');
    key(input, 'Enter');
    act(() => (q('.text-answer__decline') as HTMLButtonElement).click());
    expect(q('.text-answer__reveal')).toBeNull();
    expect(q('.vocab__definition')?.textContent).toContain('水');
    expect(q('.vocab__meaning-en')).toBeNull();
    act(() => (Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show English') as HTMLButtonElement).click());
    expect(q('.vocab__meaning-en')?.textContent).toBe('to drink');
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props(null, { step: step(NOMU) });
    mount(p);
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});

describe('acceptEn', () => {
  it('orders params.answer, params.accept, then meanings, deduped and trimmed', () => {
    expect(acceptEn(['to drink'], { answer: 'to drink', accept: ['drink', ' to drink '] })).toEqual(['to drink', 'drink']);
    expect(acceptEn(['I', 'me'], {})).toEqual(['I', 'me']);
    expect(acceptEn([], { answer: '' })).toEqual([]);
  });
});
