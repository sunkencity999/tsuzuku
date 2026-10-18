import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_STORY_ID, G, V, createFakeLoader } from '@/content/fixtures';
import type { ContentItem, VocabItem } from '@/content/types';
import { installServices, nullAudio, nullStt, resetServices, type AudioService, type SpeakOptions, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { JudgeRequest } from '@/shared/exercise-types';
import type { AttemptResult, Step } from '@/shared/session-types';
import { epochDay } from '@/shared/time';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore, type TestStoreOptions } from '@/store/testing';
import { S } from '../strings';
import {
  Shadow,
  allGreen,
  contentIds,
  keyWord,
  meta,
  pitchCells,
  pitchHighs,
  recognitionAllowed,
  resolveShadowLine,
  shadowTags,
} from './Shadow';

const loader = createFakeLoader();
const get = (id: string): ContentItem | undefined => loader.get(id);
const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const NOMU = FIXTURE.items[V.飲む] as VocabItem;

let root: HTMLDivElement;
let spoken: { text: string; o?: SpeakOptions }[];
let clock: number;

function fakeAudio(voice = true): AudioService {
  return {
    ...nullAudio,
    hasJaVoice: signal(voice),
    speak: (text, o) => {
      spoken.push({ text, o });
      return Promise.resolve();
    },
  };
}

function fakeStt(alternatives: string[] | null): SttService & { recognize: ReturnType<typeof vi.fn> } {
  return {
    available: true,
    recognize: vi.fn(() => Promise.resolve(alternatives ? { alternatives } : null)),
    abort: () => undefined,
  };
}

async function setup(o: { stt?: SttService; store?: TestStoreOptions; voice?: boolean } = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, ...o.store });
  bus.reset();
  spoken = [];
  installServices({ audio: fakeAudio(o.voice ?? true), stt: o.stt ?? nullStt });
}

beforeEach(() => {
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
    id: 'sh-1',
    block: 'output',
    exercise: 'shadow',
    itemId: null,
    cardKey: null,
    params: { storyId: FIXTURE_STORY_ID, lineIndex: 3, rate: 0.9 },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 20000,
    ...over,
  };
}

async function mount(s: Step, o: { item?: ContentItem | null; judge?: boolean } = {}) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onReplay = vi.fn();
  const onHint = vi.fn();
  const requestJudge = vi.fn<(req: JudgeRequest) => Promise<boolean>>(() => Promise.resolve(o.judge ?? true));
  await act(async () => {
    render(
      <Shadow step={s} item={o.item ?? null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={onHint} onReplay={onReplay} requestJudge={requestJudge} loader={loader} />,
      root,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { onResult, onReplay, onHint, requestJudge };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
async function clickAsync(sel: string): Promise<void> {
  const el = q<HTMLButtonElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    el!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
/** Lets the first play (an awaited `speak()` behind the frame's deferred effects) finish. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
/** A frame key pressed outside any input (the frame listens on window, capture phase). */
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
function tick(sel: string): void {
  act(() => {
    q<HTMLInputElement>(sel)!.click();
  });
}

describe('Shadow helpers', () => {
  it('meta follows the export convention: shadow, null facet, TTS, no STT requirement, self-graded, no keys', () => {
    expect(meta).toEqual({ id: 'shadow', facet: null, needsTts: true, needsStt: false, selfGraded: true, timeable: false, keys: 'none' });
  });

  it('resolveShadowLine: a story line wins, then the matching example, then the params, then the word', () => {
    const fromStory = resolveShadowLine({ storyId: FIXTURE_STORY_ID, lineIndex: 3 }, null, get);
    expect(fromStory?.ja).toBe('{私|わたし}はコーヒーを{飲|の}みます。');
    expect(fromStory?.kana).toBe('わたしはコーヒーをのみます。');
    expect(contentIds(fromStory!)).toEqual([V.私, G.は, V.コーヒー, V.飲む]);

    const fromExample = resolveShadowLine({ sentence: '毎朝コーヒーを飲みます。', answer: 'まいあさコーヒーをのみます。' }, NOMU, get);
    expect(fromExample?.ja).toBe('{毎朝|まいあさ}コーヒーを{飲|の}みます。');
    expect(fromExample?.en).toBe('I drink coffee every morning.');
    expect(fromExample?.tokenIds).toEqual([V.飲む]);

    const fromParams = resolveShadowLine({ sentence: 'きょうはいいてんきですね。', promptEn: 'Nice weather.' }, null, get);
    expect(fromParams).toEqual({ ja: 'きょうはいいてんきですね。', kana: 'きょうはいいてんきですね。', en: 'Nice weather.' });

    const word = resolveShadowLine({ sentence: '飲む' }, NOMU, get);
    expect(word?.ja).toBe('{飲む|のむ}');
    expect(word?.word?.id).toBe(V.飲む);

    expect(resolveShadowLine({}, NOMU, get)?.kana).toBe('のむ');
    expect(resolveShadowLine({}, null, get)).toBeNull();
  });

  it('pitch: highs follow the nucleus and the strip draws tokens with matching mora counts', () => {
    expect(pitchHighs(0, 2)).toEqual([false, true]);
    expect(pitchHighs(1, 2)).toEqual([true, false]);
    expect(pitchHighs(2, 3)).toEqual([false, true, false]);
    expect(pitchHighs(3, 4)).toEqual([false, true, true, false]);
    const word = pitchCells(resolveShadowLine({}, NOMU, get)!, get);
    expect(word?.map((c) => c.mark)).toEqual(['high', 'low']);
    const line = pitchCells(resolveShadowLine({ storyId: FIXTURE_STORY_ID, lineIndex: 3 }, null, get)!, get);
    expect(line).not.toBeNull();
    expect(line!.map((c) => c.mora).join('')).toBe('わたしはコーヒーをのみます。');
    expect(line!.length).toBe(14);
    // 私 わたし (pitch 0): low high high · は: none · コーヒー (pitch 3, 4 morae): low high high low · を: none · 飲みます (inflected): none · 。: none
    expect(line!.slice(0, 3).map((c) => c.mark)).toEqual(['low', 'high', 'high']);
    expect(line![3]!.mark).toBeNull();
    expect(line!.slice(4, 8).map((c) => c.mark)).toEqual(['low', 'high', 'high', 'low']);
    expect(line!.slice(8, 14).every((c) => c.mark === null)).toBe(true);
    expect(pitchCells({ ja: 'きょうは', kana: 'きょうは' }, get)).toBeNull();
  });

  it('allGreen needs every content item at Green or better; recognitionAllowed needs opt-in and a recognizer', () => {
    const belts: Record<string, 'white' | 'green' | 'brown'> = { a: 'green', b: 'brown', c: 'white' };
    const beltOf = (id: string) => belts[id] ?? 'white';
    expect(allGreen(['a', 'b'], beltOf)).toBe(true);
    expect(allGreen(['a', 'c'], beltOf)).toBe(false);
    expect(allGreen([], beltOf)).toBe(false);
    expect(recognitionAllowed({ speaking: 'recognition' }, { available: true })).toBe(true);
    expect(recognitionAllowed({ speaking: 'auto' }, { available: true })).toBe(true);
    expect(recognitionAllowed({ speaking: 'self' }, { available: true })).toBe(false);
    expect(recognitionAllowed({ speaking: 'off' }, { available: true })).toBe(false);
    expect(recognitionAllowed({ speaking: 'recognition' }, { available: false })).toBe(false);
  });

  it('keyWord picks the longest content word with the line vocab as the pool; shadowTags marks vowel-length slips', () => {
    const kw = keyWord(resolveShadowLine({ storyId: FIXTURE_STORY_ID, lineIndex: 3 }, null, get)!, get);
    expect(kw?.word.id).toBe(V.コーヒー);
    expect(kw?.pool.map((w) => w.id)).toEqual([V.私, V.コーヒー, V.飲む]);
    expect(keyWord({ ja: 'きょう', kana: 'きょう' }, get)).toBeNull();
    expect(shadowTags('おばさん', 'おばあさん', 2)).toEqual(['vowel-length']);
    expect(shadowTags('おばさん', 'おばあさん', 3)).toEqual([]);
    expect(shadowTags('', 'おばあさん', 1)).toEqual([]);
  });
});

describe('<Shadow> recognition path', () => {
  it('plays the plain surface, scores the transcript, emits line:scored and implicit prod grades', async () => {
    const stt = fakeStt(['私はコーヒーを飲みます', '私はコーヒーを飲みました']);
    await setup({
      stt,
      store: {
        save: { settings: { speaking: 'recognition' } },
        cards: { [`${V.飲む}#prod`]: card({ due: TODAY + 1, s: 5, reps: 4, state: 2 }), [`${V.コーヒー}#prod`]: card({ due: TODAY + 30, s: 40, reps: 9, state: 2 }) },
      },
    });
    const cap = captureEvents();
    const { onResult } = await mount(step());
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toBe('私はコーヒーを飲みます。');
    expect(spoken[0]?.o).toMatchObject({ kana: undefined, rate: 0.9, clip: `${FIXTURE_STORY_ID}#L3` });
    expect(typeof spoken[0]?.o?.onProgress).toBe('function');
    expect(q('.shadow')?.getAttribute('data-path')).toBe('recognition');
    expect(q('.shadow')?.getAttribute('data-phase')).toBe('ready');
    expect(q('[data-line="true"]')).not.toBeNull();
    expect(root.querySelectorAll('.pitch-strip__mora').length).toBe(14);
    expect(q('.speak__en')?.textContent).toContain('I drink coffee.');

    clock += 3000;
    await clickAsync('[data-action="speak"]');
    expect(stt.recognize).toHaveBeenCalledWith({ maxMs: 8000 });
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(true);
    expect(r.nearMiss).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.answer).toBe('私はコーヒーを飲みます');
    expect(r.selfRating).toBeUndefined();
    expect(r.ms).toBe(3000);
    expect(r.implicit).toEqual([{ cardKey: `${V.飲む}#prod`, rating: 3 }]);
    const scored = cap.events.filter(([n]) => n === 'line:scored');
    expect(scored.length).toBe(1);
    expect(scored[0]![1]).toMatchObject({ kind: 'shadow', pass: true, path: 'recognition', replays: 0 });
    expect(q('.speak__result')?.getAttribute('data-kind')).toBe('correct');
    expect(q('.speak__verdict')?.textContent).toBe(S.shadowGood);
    expect(q('.speak__heard')?.textContent).toContain('私はコーヒーを飲みます');
    cap.stop();
  });

  it('a far-off transcript is Again with no implicit Good; a close one is Blocked (Hard) and writes nothing implicit', async () => {
    await setup({ stt: fakeStt(['きょうはいいてんきですね']), store: { save: { settings: { speaking: 'recognition' } }, cards: { [`${V.飲む}#prod`]: card({ due: TODAY, s: 5, reps: 4, state: 2 }) } } });
    const a = await mount(step());
    await clickAsync('[data-action="speak"]');
    const r1 = a.onResult.mock.calls[0]![0];
    expect(r1.correct).toBe(false);
    expect(r1.implicit).toEqual([{ cardKey: `${V.飲む}#prod`, rating: 1 }]);
    expect(q('.speak__result')?.getAttribute('data-kind')).toBe('wrong');

    render(null, root);
    // わたしはこーひーをのむ vs のみます: 3 of 13 morae off → 0.77, inside the Hard band
    await setup({ stt: fakeStt(['私はコーヒーを飲む']), store: { save: { settings: { speaking: 'recognition' } }, cards: { [`${V.飲む}#prod`]: card({ due: TODAY, s: 5, reps: 4, state: 2 }) } } });
    const b = await mount(step({ id: 'sh-2' }));
    await clickAsync('[data-action="speak"]');
    const r2 = b.onResult.mock.calls[0]![0];
    expect(r2.nearMiss).toBe(true);
    expect(r2.correct).toBe(true);
    expect(r2.implicit).toBeUndefined();
    expect(q('.speak__result')?.getAttribute('data-kind')).toBe('near');
  });

  it('nothing heard shows a nudge and offers the self path; replay counts and calls onReplay', async () => {
    await setup({ stt: fakeStt(null), store: { save: { settings: { speaking: 'recognition' } } } });
    const { onResult, onReplay } = await mount(step());
    await clickAsync('[data-action="play"]');
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(spoken.length).toBe(2);
    await clickAsync('[data-action="speak"]');
    expect(onResult).not.toHaveBeenCalled();
    expect(q('.speak__status')?.textContent).toBe(S.shadowNoSpeech);
    expect(q('.shadow')?.getAttribute('data-phase')).toBe('ready');
    await clickAsync('[data-action="self-instead"]');
    expect(q('.shadow')?.getAttribute('data-path')).toBe('self');
    expect(q('.recorder')).not.toBeNull();
  });

  it('hides the text after the first play when every content word is Green; showing it is a hint', async () => {
    const green = card({ due: TODAY + 20, s: 12, reps: 6, state: 2 });
    await setup({
      stt: fakeStt(['私はコーヒーを飲みます']),
      store: {
        save: { settings: { speaking: 'recognition' } },
        cards: { [`${V.私}#rec`]: green, [`${V.コーヒー}#rec`]: green, [`${V.飲む}#rec`]: green, [`${G.は}#cloze`]: green },
      },
    });
    const { onResult, onHint } = await mount(step());
    expect(q('.shadow')?.getAttribute('data-hidden')).toBe('true');
    expect(q('[data-line="true"]')).toBeNull();
    expect(q('.speak__prompt')?.textContent).toBe(S.shadowPromptHidden);
    const show = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === S.shadowShowText);
    expect(show).toBeDefined();
    act(() => show!.click());
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-line="true"]')).not.toBeNull();
    await clickAsync('[data-action="speak"]');
    expect(onResult.mock.calls[0]![0].hintUsed).toBe(true);
  });
});

describe('<Shadow> self path (no recognizer)', () => {
  it('renders the Recorder after the first play and passes a sampled Good through the perception Judge', async () => {
    await setup({ store: { cards: { [`${V.飲む}#prod`]: card({ due: TODAY, s: 5, reps: 4, state: 2 }) } } });
    const cap = captureEvents();
    const { onResult, requestJudge } = await mount(step(), { judge: true });
    expect(q('.shadow')?.getAttribute('data-path')).toBe('self');
    expect(q('[data-action="speak"]')).toBeNull();
    expect(q('.recorder')).not.toBeNull();
    tick('[data-check="mora"]');
    tick('[data-check="longVowels"]');
    tick('[data-check="pitch"]');
    await clickAsync('[data-action="grade"]');
    // honesty has no history → rate 100 → the inspector always asks
    expect(requestJudge).toHaveBeenCalledTimes(1);
    const req = requestJudge.mock.calls[0]![0] as { minimalPair: [string, string] };
    expect(req.minimalPair[0]).toBe('コーヒー');
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.selfRating).toBe(3);
    expect(r.correct).toBe(true);
    expect(r.implicit).toEqual([{ cardKey: `${V.飲む}#prod`, rating: 3 }]);
    const scored = cap.events.filter(([n]) => n === 'line:scored');
    expect(scored[0]![1]).toMatchObject({ kind: 'shadow', pass: true, path: 'self', score: 1 });
    expect(q('.speak__judge')?.getAttribute('data-judge')).toBe('pass');
    expect(q('.speak__verdict')?.textContent).toBe(S.shadowSelfGood);
    cap.stop();
  });

  it('a failed Judge forces Again; a two-of-three checklist is Hard and skips the Judge', async () => {
    await setup();
    const a = await mount(step(), { judge: false });
    tick('[data-check="mora"]');
    tick('[data-check="longVowels"]');
    tick('[data-check="pitch"]');
    await clickAsync('[data-action="grade"]');
    expect(a.onResult.mock.calls[0]![0].selfRating).toBe(1);
    expect(a.onResult.mock.calls[0]![0].correct).toBe(false);
    expect(q('.speak__judge')?.getAttribute('data-judge')).toBe('fail');

    render(null, root);
    await setup();
    const b = await mount(step({ id: 'sh-3' }));
    tick('[data-check="mora"]');
    tick('[data-check="pitch"]');
    await clickAsync('[data-action="grade"]');
    expect(b.requestJudge).not.toHaveBeenCalled();
    const r = b.onResult.mock.calls[0]![0];
    expect(r.selfRating).toBe(2);
    expect(r.nearMiss).toBe(true);
    expect(r.implicit).toBeUndefined();
    expect(q('.speak__verdict')?.textContent).toBe(S.shadowSelfHard);
  });

  it('without a Japanese voice the text is never hidden and the degrade note shows', async () => {
    const green = card({ due: TODAY + 20, s: 12, reps: 6, state: 2 });
    await setup({ voice: false, store: { cards: { [`${V.私}#rec`]: green, [`${V.コーヒー}#rec`]: green, [`${V.飲む}#rec`]: green, [`${G.は}#cloze`]: green } } });
    await mount(step());
    expect(q('.shadow')?.getAttribute('data-hidden')).toBeNull();
    expect(q('[data-line="true"]')).not.toBeNull();
    expect(root.textContent).toContain(S.shadowNoVoice);
  });

  it('with a voice but the master volume at 0 (canSpeak false) the text is never hidden and the muted note shows', async () => {
    const green = card({ due: TODAY + 20, s: 12, reps: 6, state: 2 });
    await setup({ store: { cards: { [`${V.私}#rec`]: green, [`${V.コーヒー}#rec`]: green, [`${V.飲む}#rec`]: green, [`${G.は}#cloze`]: green } } });
    installServices({ audio: { ...fakeAudio(true), canSpeak: signal(false) } as AudioService });
    await mount(step());
    expect(q('.shadow')?.getAttribute('data-hidden')).toBeNull();
    expect(q('[data-line="true"]')).not.toBeNull();
    expect(root.textContent).toContain(S.shadowMuted);
    expect(root.textContent).not.toContain(S.shadowNoVoice);
  });

  it('a missing line renders the calm note and never calls onResult', async () => {
    await setup();
    const { onResult } = await mount(step({ params: {} }));
    expect(q('.speak__note')?.textContent).toBe(S.shadowNoVoice);
    expect(onResult).not.toHaveBeenCalled();
    expect(store.ready.value).toBe(true);
  });
});

describe('<Shadow> inside the frame (contract #32: the hint key)', () => {
  it("the frame's ? key / Hint button is the same Show-the-text hint while the text is hidden, and goes away once shown", async () => {
    const green = card({ due: TODAY + 20, s: 12, reps: 6, state: 2 });
    await setup({
      stt: fakeStt(['私はコーヒーを飲みます']),
      store: {
        save: { settings: { speaking: 'recognition' } },
        cards: { [`${V.私}#rec`]: green, [`${V.コーヒー}#rec`]: green, [`${V.飲む}#rec`]: green, [`${G.は}#cloze`]: green },
      },
    });
    const onHint = vi.fn();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const s = step();
    await act(async () => {
      render(
        <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => clock} onGuard={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          <Shadow step={s} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={onHint} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} loader={loader} />
        </ExerciseFrame>,
        root,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    expect(q('.shadow')?.getAttribute('data-hidden')).toBe('true');
    expect(q('.exercise-frame__hint')).not.toBeNull();
    press('?');
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-line="true"]')).not.toBeNull();
    expect(q('.shadow')?.getAttribute('data-hidden')).toBeNull();
    // used: nothing left to reveal, so the frame hides its Hint button and ? is inert
    expect(q('.exercise-frame__hint')).toBeNull();
    press('?');
    expect(onHint).toHaveBeenCalledTimes(1);
    await clickAsync('[data-action="speak"]');
    expect(onResult.mock.calls[0]![0].hintUsed).toBe(true);
  });

  it('with the text on screen (not all Green) the frame offers no hint', async () => {
    await setup({ stt: fakeStt(['私はコーヒーを飲みます']), store: { save: { settings: { speaking: 'recognition' } } } });
    const s = step();
    await act(async () => {
      render(
        <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => clock} onGuard={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          <Shadow step={s} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={() => undefined} onHint={() => undefined} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} loader={loader} />
        </ExerciseFrame>,
        root,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    expect(q('[data-line="true"]')).not.toBeNull();
    expect(q('.exercise-frame__hint')).toBeNull();
  });
});

describe('<Shadow> clip timing (design 08 §8 / §9)', () => {
  it('speak receives params.clip when it is set, else the story line key; a dialogue line passes its speaker', async () => {
    await setup({ stt: fakeStt(['x']), store: { save: { settings: { speaking: 'recognition' } } } });
    await mount(step({ params: { storyId: FIXTURE_STORY_ID, lineIndex: 3, rate: 0.9, clip: `${V.飲む}#ex0` } }));
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.o).toMatchObject({ rate: 0.9, clip: `${V.飲む}#ex0` });
    expect(spoken[0]?.o).not.toHaveProperty('speaker');
    render(null, root);

    await setup({ stt: fakeStt(['x']), store: { save: { settings: { speaking: 'recognition' } } } });
    await mount(step({ id: 'sh-dlg', params: { storyId: 's-04-2', lineIndex: 0, rate: 1 } }));
    expect(spoken[0]?.o).toMatchObject({ clip: 's-04-2#L0', speaker: 'ケン' });
    // the pure resolver carries the same keys
    expect(resolveShadowLine({ storyId: FIXTURE_STORY_ID, lineIndex: 3 }, null, get)?.clip).toBe(`${FIXTURE_STORY_ID}#L3`);
    expect(resolveShadowLine({ storyId: FIXTURE_STORY_ID, lineIndex: 3, clip: 'k' }, null, get)?.clip).toBe('k');
    expect(resolveShadowLine({ sentence: '飲む', clip: V.飲む }, NOMU, get)?.clip).toBe(V.飲む);
    expect(resolveShadowLine({ sentence: '飲む' }, NOMU, get)).not.toHaveProperty('clip');
    expect(resolveShadowLine({ storyId: 's-04-2', lineIndex: 1 }, null, get)?.speaker).toBe('ハナ');
  });

  it('the pitch strip is labelled "dictionary pattern" and its timing sweeps with onProgress, clearing when the play ends', async () => {
    await setup({ stt: fakeStt(['x']), store: { save: { settings: { speaking: 'recognition' } } } });
    await mount(step());
    expect(q('[data-field="strip-label"]')?.textContent).toBe(S.shadowPitchDictionary);
    expect(root.textContent).toContain('dictionary pattern');
    expect(root.textContent).not.toContain('what you heard');
    expect(q('.pitch-strip')?.getAttribute('aria-label')).toContain(S.shadowPitchDictionary);
    expect(q('[data-field="strip-caption"]')?.getAttribute('title')).toBe(S.shadowPitchDictionaryHint);
    const onProgress = spoken[0]?.o?.onProgress;
    expect(typeof onProgress).toBe('function');
    act(() => onProgress?.(0.5, 2, 0));
    const cells = Array.from(root.querySelectorAll('.pitch-strip__mora'));
    expect(cells.slice(0, 2).map((c) => c.getAttribute('data-timing'))).toEqual(['past', 'past']);
    expect(cells[2]?.getAttribute('data-timing')).toBe('active');
    expect(cells[3]?.getAttribute('data-timing')).toBe('ahead');
    // a finished play clears the timing marks
    await clickAsync('[data-action="play"]');
    expect(root.querySelectorAll('.pitch-strip__mora[data-timing]').length).toBe(0);
  });

  it('the sweep skips punctuation cells: after a mid-line 、 the active cell still follows the cue mora', async () => {
    await setup({ stt: fakeStt(['x']), store: { save: { settings: { speaking: 'recognition' } } } });
    await mount(step({ id: 'sh-punct', params: { storyId: 's-04-2', lineIndex: 3, rate: 1 } })); // はい、飲みます。
    const cells = Array.from(root.querySelectorAll('.pitch-strip__mora'));
    expect(cells.map((c) => c.textContent)).toEqual(['は', 'い', '、', 'の', 'み', 'ま', 'す', '。']);
    expect(cells.map((c) => c.getAttribute('data-punct'))).toEqual([null, null, 'true', null, null, null, null, 'true']);
    const onProgress = spoken[0]?.o?.onProgress;
    expect(typeof onProgress).toBe('function');
    act(() => onProgress?.(0.6, 2, 0)); // cue mora 2 = の (the 、 owns no mora)
    expect(cells.map((c) => c.getAttribute('data-timing'))).toEqual(['past', 'past', 'past', 'active', 'ahead', 'ahead', 'ahead', 'ahead']);
    act(() => onProgress?.(1.4, 5, 0)); // す
    expect(cells.map((c) => c.getAttribute('data-timing'))).toEqual(['past', 'past', 'past', 'past', 'past', 'past', 'active', 'ahead']);
    act(() => onProgress?.(1.0, 1, 0)); // い: the 、 after it is still ahead
    expect(cells.slice(0, 4).map((c) => c.getAttribute('data-timing'))).toEqual(['past', 'active', 'ahead', 'ahead']);
  });

  it('with a pack and no device voice, sound off reads as muted, never as the install nag', async () => {
    await setup({ stt: fakeStt(['x']), store: { save: { settings: { speaking: 'recognition' } } } });
    installServices({ audio: { ...fakeAudio(false), packReady: signal(true), canSpeak: signal(false) }, stt: fakeStt(['x']) });
    await mount(step());
    expect(q('.speak__note[role="status"]')?.textContent).toBe(S.shadowMuted);
    render(null, root);
    // no pack and no voice: the install nag stands
    installServices({ audio: fakeAudio(false), stt: fakeStt(['x']) });
    await mount(step());
    expect(q('.speak__note[role="status"]')?.textContent).toBe(S.shadowNoVoice);
  });

  it('a ready pack the learner has not chosen (settings.audioSource device) is the device voice: sound off with no Japanese voice reads as the install nag, not muted', async () => {
    await setup({ stt: fakeStt(['x']), store: { save: { settings: { speaking: 'recognition', audioSource: 'device' } } } });
    installServices({ audio: { ...fakeAudio(false), packReady: signal(true), canSpeak: signal(false) }, stt: fakeStt(['x']) });
    await mount(step());
    expect(q('.speak__note[role="status"]')?.textContent).toBe(S.shadowNoVoice);
  });
});
