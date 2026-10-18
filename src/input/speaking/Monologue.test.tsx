import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE_STORY_ID, createFakeLoader } from '@/content/fixtures';
import { STT_STATE_LABEL } from '@/audio';
import { installServices, nullStt, resetServices, type SttResult, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { AttemptResult, Step } from '@/shared/session-types';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore, type TestStoreOptions } from '@/store/testing';
import { S } from '../strings';
import { Monologue, REDUCE_EXPAND_SECONDS, countFillers, countWords, defaultSeconds, meta, roundsFor, wordsPerMinute } from './Monologue';

const loader = createFakeLoader();
let root: HTMLDivElement;
let clock: number;

async function setup(o: { stt?: SttService; store?: TestStoreOptions } = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, ...o.store });
  bus.reset();
  installServices({ stt: o.stt ?? nullStt });
}

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  vi.useRealTimers();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'mono-1',
    block: 'output',
    exercise: 'monologue',
    itemId: null,
    cardKey: null,
    params: { seconds: 60, promptEn: 'Sixty seconds. Tell the room about your morning.' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 75000,
    ...over,
  };
}

async function mount(s: Step) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  await act(async () => {
    render(<Monologue step={s} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={() => undefined} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} loader={loader} />, root);
    await Promise.resolve();
  });
  return { onResult };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
const phase = (): string | null => q('.monologue')?.getAttribute('data-phase') ?? null;
async function click(sel: string): Promise<void> {
  const el = q<HTMLButtonElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    el!.click();
    await Promise.resolve();
  });
}
/** Advances the injected clock and the interval ticks together. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    clock += ms;
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}
function tick(sel: string): void {
  act(() => {
    q<HTMLInputElement>(sel)!.click();
  });
}

describe('monologue helpers', () => {
  it('meta: monologue, null facet, no keys, ungraded', () => {
    expect(meta).toEqual({ id: 'monologue', facet: null, needsTts: false, needsStt: false, selfGraded: false, timeable: false, keys: 'none' });
  });

  it('round lengths: params.seconds, else 60 (120 from Brown); reduce-expand is 60/45/30', () => {
    expect(defaultSeconds('green')).toBe(60);
    expect(defaultSeconds('brown')).toBe(120);
    expect(defaultSeconds('black')).toBe(120);
    expect(roundsFor({ seconds: 90 }, 'brown')).toEqual([90]);
    expect(roundsFor({}, 'brown')).toEqual([120]);
    expect(roundsFor({}, 'blue')).toEqual([60]);
    expect(roundsFor({ mode: 'reduce-expand', seconds: 60 }, 'purple')).toEqual([60, 45, 30]);
    expect(REDUCE_EXPAND_SECONDS).toEqual([60, 45, 30]);
  });

  it('countWords estimates words across scripts; particles are not words', () => {
    expect(countWords('わたしはまいあさコーヒーをのみます。')).toBe(4);
    expect(countWords('私は毎朝コーヒーを飲みます。')).toBe(4);
    expect(countWords('パンを食べる')).toBe(2);
    expect(countWords('はい、そうです。')).toBe(2);
    expect(countWords('')).toBe(0);
    expect(countWords('。、')).toBe(0);
    expect(countWords('えっと、犬が三匹います')).toBeGreaterThanOrEqual(3);
  });

  it('countFillers counts recognizer fillers; wordsPerMinute scales', () => {
    expect(countFillers('えっと、わたしは、あのー、学生です。えーと。')).toBe(3);
    expect(countFillers('あの人はその本を読みました。')).toBe(0);
    expect(wordsPerMinute(30, 60)).toBe(30);
    expect(wordsPerMinute(30, 30)).toBe(60);
    expect(wordsPerMinute(10, 0)).toBe(0);
  });
});

describe('<Monologue> self path (timer + report)', () => {
  it('runs for params.seconds, then asks for the report, then emits output:done with the seconds', async () => {
    await setup();
    const cap = captureEvents();
    const { onResult } = await mount(step());
    expect(phase()).toBe('intro');
    expect(q('.monologue')?.getAttribute('data-path')).toBe('self');
    expect(q('.speak__note')?.textContent).toBe(S.monologueIntroSelf.replace('{n}', '60'));
    await click('[data-action="start"]');
    expect(phase()).toBe('running');
    await elapse(59_000);
    expect(phase()).toBe('running');
    expect(q('.monologue__seconds')?.textContent).toBe('1');
    await elapse(1_000);
    expect(phase()).toBe('report');
    expect(onResult).not.toHaveBeenCalled();
    tick('[data-rubric="kept"]');
    tick('[data-rubric="topic"]');
    await click('[data-action="report"]');
    expect(phase()).toBe('done');
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(true);
    expect(r.ms).toBe(60_000);
    expect(r.answer).toBeUndefined();
    const out = cap.events.filter(([n]) => n === 'output:done');
    expect(out).toEqual([['output:done', { kind: 'monologue', seconds: 60, path: 'self' }]]);
    expect(q('.speak__verdict')?.textContent).toBe('Done. 60 seconds of your own Japanese.');
    cap.stop();
  });

  it('reduce-expand runs 60 → 45 → 30 with the passage shown, emitting once at the end', async () => {
    await setup();
    const cap = captureEvents();
    const { onResult } = await mount(step({ params: { mode: 'reduce-expand', seconds: 60, storyId: FIXTURE_STORY_ID, promptEn: 'Retell the passage you just read in 60 seconds.' } }));
    expect(q('.monologue')?.getAttribute('data-mode')).toBe('reduce-expand');
    expect(q('.monologue__passage')).not.toBeNull();
    expect(root.querySelectorAll('.monologue__passage p').length).toBe(12);
    expect(root.querySelectorAll('.monologue__round').length).toBe(3);
    for (const [i, s] of [60, 45, 30].entries()) {
      expect(q('.monologue')?.getAttribute('data-round')).toBe(String(i));
      expect(q('.monologue__round[aria-current="step"]')?.textContent).toContain(`${s} seconds`);
      await click('[data-action="start"]');
      await elapse(s * 1000 - 500);
      expect(phase()).toBe('running');
      await elapse(500);
      expect(phase()).toBe('report');
      await click('[data-action="report"]');
      expect(onResult).toHaveBeenCalledTimes(i === 2 ? 1 : 0);
    }
    expect(phase()).toBe('done');
    expect(root.querySelectorAll('.monologue__round[data-done="true"]').length).toBe(3);
    const out = cap.events.filter(([n]) => n === 'output:done');
    expect(out).toEqual([['output:done', { kind: 'reduce-expand', seconds: 135, path: 'self' }]]);
    expect(q('.speak__verdict')?.textContent).toBe(S.reduceExpandDone);
    cap.stop();
  });

  it('a missing passage says so and still runs', async () => {
    await setup();
    await mount(step({ params: { mode: 'reduce-expand', storyId: 's-99-9' } }));
    expect(q('.monologue__passage')).toBeNull();
    expect(root.textContent).toContain(S.monologueStoryMissing);
    await click('[data-action="start"]');
    expect(phase()).toBe('running');
  });
});

describe('<Monologue> recognition path', () => {
  function deferredStt(): SttService & { resolve: (r: SttResult | null) => void; recognize: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> } {
    let resolve: (r: SttResult | null) => void = () => undefined;
    const recognize = vi.fn(
      () =>
        new Promise<SttResult | null>((res) => {
          resolve = res;
        }),
    );
    const abort = vi.fn();
    return { available: true, recognize, abort, resolve: (r) => resolve(r) };
  }

  it('listens continuously for the round, then shows the transcript, the estimated words and emits them', async () => {
    const stt = deferredStt();
    await setup({ stt, store: { save: { settings: { speaking: 'recognition' } } } });
    const cap = captureEvents();
    const { onResult } = await mount(step());
    expect(q('.monologue')?.getAttribute('data-path')).toBe('recognition');
    await click('[data-action="start"]');
    expect(stt.recognize).toHaveBeenCalledWith({ maxMs: 60_000, continuous: true });
    await elapse(60_000);
    expect(phase()).toBe('waiting');
    await act(async () => {
      stt.resolve({ alternatives: ['えっとわたしはまいあさコーヒーをのみます。パンもたべます。'] });
      await Promise.resolve();
    });
    expect(phase()).toBe('review');
    expect(q('[data-transcript="true"]')?.textContent).toContain('コーヒー');
    expect(root.textContent).toContain('1 fillers');
    const words = countWords('えっとわたしはまいあさコーヒーをのみます。パンもたべます。');
    expect(root.textContent).toContain(`${words} words (estimated)`);
    await click('[data-action="accept"]');
    expect(phase()).toBe('done');
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(true);
    expect(r.answer).toContain('コーヒー');
    const out = cap.events.filter(([n]) => n === 'output:done');
    expect(out).toEqual([['output:done', { kind: 'monologue', seconds: 60, words, path: 'recognition' }]]);
    cap.stop();
  });

  it('a transcript that arrives before the bell waits for the bell; an empty one falls back to the report', async () => {
    const stt = deferredStt();
    await setup({ stt, store: { save: { settings: { speaking: 'recognition' } } } });
    await mount(step({ params: { seconds: 30 } }));
    await click('[data-action="start"]');
    await act(async () => {
      stt.resolve(null);
      await Promise.resolve();
    });
    expect(phase()).toBe('running');
    await elapse(30_000);
    expect(phase()).toBe('review');
    expect(root.textContent).toContain(S.monologueNoTranscript);
    await click('[data-action="accept"]');
    expect(phase()).toBe('report');
  });

  it('a recognizer that gives up before the bell (microphone blocked) names it, switches the round to the self path and keeps the clock running', async () => {
    const stt = deferredStt();
    const denied = { ...stt, state: signal<'listening' | 'denied'>('listening') } as SttService & { state: { value: 'listening' | 'denied' } };
    await setup({ stt: denied, store: { save: { settings: { speaking: 'recognition' } } } });
    const cap = captureEvents();
    await mount(step({ params: { seconds: 30 } }));
    await click('[data-action="start"]');
    expect(q('.monologue')?.getAttribute('data-path')).toBe('recognition');
    await elapse(2_000);
    await act(async () => {
      denied.state.value = 'denied';
      stt.resolve(null);
      await Promise.resolve();
    });
    // still running, but on the self path with the reason under the clock
    expect(phase()).toBe('running');
    expect(q('.monologue')?.getAttribute('data-path')).toBe('self');
    expect(q('[data-field="stt-note"]')?.textContent).toBe(STT_STATE_LABEL.denied);
    expect(root.textContent).not.toContain(S.monologueNoTranscript);
    await elapse(28_000);
    expect(phase()).toBe('report');
    expect(q('[data-field="stt-note"]')?.textContent).toBe(STT_STATE_LABEL.denied);
    expect(root.textContent).not.toContain(S.monologueFinishEarlyNote);
    await click('[data-action="report"]');
    expect(phase()).toBe('done');
    expect(cap.events.filter(([n]) => n === 'output:done')[0]![1]).toEqual({ kind: 'monologue', seconds: 30, path: 'self' });
    cap.stop();
  });

  it('finishing early aborts the recognizer and reports the round by rubric', async () => {
    const stt = deferredStt();
    await setup({ stt, store: { save: { settings: { speaking: 'recognition' } } } });
    const cap = captureEvents();
    await mount(step());
    await click('[data-action="start"]');
    await elapse(10_000);
    await click('[data-action="finish-early"]');
    expect(stt.abort).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('report');
    expect(root.textContent).toContain(S.monologueFinishEarlyNote);
    await click('[data-action="report"]');
    expect(phase()).toBe('done');
    expect(cap.events.filter(([n]) => n === 'output:done')[0]![1]).toEqual({ kind: 'monologue', seconds: 60, path: 'self' });
    cap.stop();
  });
});

/* ── design 09 (C4): the clock bar is motion.css's .meter ───────────────────── */
describe('<Monologue> clock meter (design 09 §5.7)', () => {
  it('the running clock carries a .meter whose --value is the elapsed share; nothing writes a width', async () => {
    await setup();
    await mount(step());
    await click('[data-action="start"]');
    await elapse(30_000);
    const meter = q('.monologue__clock .meter');
    expect(meter).not.toBeNull();
    expect(Number(meter!.style.getPropertyValue('--value'))).toBeCloseTo(0.5, 1);
    expect(meter!.style.getPropertyValue('--meter-tone')).toBe('var(--ai)');
    expect(meter!.querySelector('.meter__fill')).not.toBeNull();
    expect(q('.monologue__track')).toBeNull();
    expect(root.querySelector('[style*="width"]')).toBeNull();
  });
});
