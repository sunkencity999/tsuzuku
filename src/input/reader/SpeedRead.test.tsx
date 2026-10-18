import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ContentLoader } from '@/content/loader';

const H = vi.hoisted(() => ({ loader: null as unknown }));
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  const content = new Proxy(orig.content, {
    get(target, key) {
      const l = (H.loader as Record<PropertyKey, unknown> | null) ?? (target as unknown as Record<PropertyKey, unknown>);
      const v = l[key as string];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(l) : v;
    },
  });
  return { ...orig, content };
});

import { FIXTURE, FIXTURE_STORY_ID, createFakeLoader } from '@/content/fixtures';
import type { StoryItem } from '@/content/types';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import type { Step } from '@/shared/session-types';
import { store } from '@/store';
import { captureEvents, makeTestStore } from '@/store/testing';
import { charCount, msPerLine, plainChars } from './cpm';
import { SpeedRead, SpeedReadView, meta, pickQuestionIndex, revealSchedule, toAttemptResult, type SpeedReadResult } from './SpeedRead';
import { S } from './strings';

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const RATE = 120;
const SCHEDULE = revealSchedule(STORY.lines, RATE);
const TOTAL_MS = SCHEDULE[SCHEDULE.length - 1] as number;

let root: HTMLDivElement;
let clock = 5_000_000;
let loader: ContentLoader;

beforeEach(async () => {
  vi.useFakeTimers();
  clock = 5_000_000;
  loader = createFakeLoader();
  H.loader = loader;
  await makeTestStore({ now: () => clock, save: { progress: { station: 6 } } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  bus.reset();
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const qa = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null | undefined): void => {
  act(() => (el as HTMLElement | null)?.click());
};
/** Advances the fake timers and the store clock together. */
function tick(ms: number): void {
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });
}

function mount(over: Partial<Parameters<typeof SpeedReadView>[0]> = {}): ReturnType<typeof vi.fn<(r: SpeedReadResult) => void>> {
  const onDone = vi.fn<(r: SpeedReadResult) => void>();
  act(() => render(<SpeedReadView storyId={FIXTURE_STORY_ID} loader={loader} rate={RATE} onDone={onDone} {...over} />, root));
  return onDone;
}

/** Answers the one question right (or wrong). */
function answer(right = true): void {
  const text = q('[data-field="question"]')?.textContent ?? '';
  const qq = STORY.comprehension.find((c) => c.q === text);
  expect(qq).toBeDefined();
  const want = qq?.choices[qq.answer] ?? '';
  const target = qa('[data-choice]').find((b) => (right ? b.textContent?.includes(want) : !b.textContent?.includes(want)));
  click(target);
  click(q('[data-action="advance"]'));
}

describe('SpeedRead helpers', () => {
  it('meta registers speed-read with no facet and choices keys', () => {
    expect(meta).toEqual({ id: 'speed-read', facet: null, needsTts: false, needsStt: false, selfGraded: false, timeable: false, keys: 'choices' });
  });

  it('revealSchedule accumulates msPerLine with the 600 ms floor', () => {
    expect(SCHEDULE.length).toBe(STORY.lines.length + 1);
    expect(SCHEDULE[0]).toBe(0);
    expect(SCHEDULE[1]).toBe(msPerLine(plainChars(STORY.lines[0]?.ja ?? ''), RATE));
    expect(SCHEDULE[1]).toBe(2000); // おはよう = 4 chars at 120 cpm
    expect(SCHEDULE[2]).toBe(2000 + 3000); // 私はハナです = 6 chars
    const fast = revealSchedule(STORY.lines, 100_000);
    expect(fast[1]).toBe(600);
  });

  it('pickQuestionIndex is seeded and in range', () => {
    expect(pickQuestionIndex(0, rngFor('a'))).toBe(-1);
    for (let s = 0; s < 20; s++) {
      const i = pickQuestionIndex(3, rngFor('seed', s));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(3);
      expect(pickQuestionIndex(3, rngFor('seed', s))).toBe(i);
    }
  });

  it('toAttemptResult maps the pass and the missing case', () => {
    const base: SpeedReadResult = { storyId: 's', correct: 1, total: 1, passed: true, cpm: 100, targetCpm: 80, band: 'at', chars: 60, ms: 30_000, minutes: 1, newBest: true, missing: false };
    expect(toAttemptResult(base)).toMatchObject({ correct: true, score: 1, ms: 30_000 });
    expect(toAttemptResult({ ...base, correct: 0, passed: false })).toMatchObject({ correct: false, score: 0 });
    expect(toAttemptResult({ ...base, missing: true, total: 0, correct: 0, passed: false })).toMatchObject({ correct: true });
  });
});

describe('<SpeedReadView>', () => {
  it('ready screen shows the pace, size and no personal best yet', () => {
    mount();
    expect(q('[data-state="ready"]')).not.toBeNull();
    expect(q('[data-field="pace"]')?.textContent).toBe('120 characters per minute');
    expect(q('[data-field="best"]')?.textContent).toBe(S.speedBestNone);
    expect(root.textContent).toContain(`${charCount(STORY.lines)} characters`);
    expect(q('.reader__title')?.getAttribute('lang')).toBe('ja');
  });

  it('shows the personal best from stats', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 6 }, stats: { speedReadBestCpm: 140 } } });
    mount();
    expect(q('[data-field="best"]')?.textContent).toBe('Personal best: 140');
  });

  it('defaults the pace to the station target when no rate is given', () => {
    mount({ rate: undefined, station: 17 }); // Green → N4 150
    expect(q('.speed')?.getAttribute('data-rate')).toBe('150');
    render(null, root);
    mount({ rate: undefined, station: 6 });
    expect(q('.speed')?.getAttribute('data-rate')).toBe('80');
  });

  it('line cadence matches the chosen cpm', () => {
    mount();
    click(q('[data-action="start"]'));
    expect(q('[data-state="reading"]')).not.toBeNull();
    expect(qa('li[data-line]').length).toBe(1);
    expect(q('[data-field="progress"]')?.textContent).toBe('Line 1 of 12');
    tick(1999);
    expect(qa('li[data-line]').length).toBe(1);
    tick(1);
    expect(qa('li[data-line]').length).toBe(2);
    expect(q('li[data-line="1"]')?.getAttribute('data-latest')).toBe('true');
    expect(q('li[data-line="0"]')?.getAttribute('data-latest')).toBeNull();
    tick(2999);
    expect(qa('li[data-line]').length).toBe(2);
    tick(1);
    expect(qa('li[data-line]').length).toBe(3);
    // run to the end: the text folds away and one question appears
    tick(TOTAL_MS - 5000 - 1);
    expect(q('[data-state="reading"]')).not.toBeNull();
    tick(1);
    expect(q('[data-state="question"]')).not.toBeNull();
    expect(qa('li[data-line]').length).toBe(0);
    expect(qa('[data-choice]').length).toBe(4);
    expect(q('.comp__meta')?.textContent).toContain('Question 1 of 1');
  });

  it('lines are never fogged and carry no gloss taps', () => {
    mount({ furigana: 'fog' });
    click(q('[data-action="start"]'));
    tick(TOTAL_MS - 1);
    expect(q('.ruby__seg--fog')).toBeNull();
    expect(q('.ruby__token--tap')).toBeNull();
    expect(qa('li[data-line] rt').length).toBeGreaterThan(0);
  });

  it('emits story:read with mode speed, the measured cpm and the question result', () => {
    const cap = captureEvents();
    const onDone = mount();
    click(q('[data-action="start"]'));
    tick(TOTAL_MS);
    answer(true);
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'story:read');
    expect(ev).toBeDefined();
    const p = ev?.[1] as { mode: string; cpm: number; chars: number; correct: number; total: number; glossTaps: number; minutes: number; storyId: string };
    expect(p.mode).toBe('speed');
    expect(p.storyId).toBe(FIXTURE_STORY_ID);
    expect(p.correct).toBe(1);
    expect(p.total).toBe(1);
    expect(p.glossTaps).toBe(0);
    expect(p.chars).toBe(charCount(STORY.lines));
    expect(p.cpm).toBe(Math.round((p.chars / TOTAL_MS) * 60_000));
    expect(p.cpm).toBeGreaterThan(0);
    expect(p.minutes).toBe(Math.round(TOTAL_MS / 60_000));
    expect(onDone).toHaveBeenCalledTimes(1);
    const r = onDone.mock.calls[0]?.[0] as SpeedReadResult;
    expect(r.passed).toBe(true);
    expect(r.targetCpm).toBe(RATE);
    expect(r.newBest).toBe(true);
    expect(r.ms).toBe(TOTAL_MS);
  });

  it('a wrong answer is not passed and sets no new best', () => {
    const onDone = mount();
    click(q('[data-action="start"]'));
    tick(TOTAL_MS);
    answer(false);
    const r = onDone.mock.calls[0]?.[0] as SpeedReadResult;
    expect(r.passed).toBe(false);
    expect(r.correct).toBe(0);
    expect(r.newBest).toBe(false);
  });

  it('newBest only when the measured cpm beats the stored best', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 6 }, stats: { speedReadBestCpm: 999 } } });
    const onDone = mount();
    click(q('[data-action="start"]'));
    tick(TOTAL_MS);
    answer(true);
    expect(onDone.mock.calls[0]?.[0].newBest).toBe(false);
  });

  it('with B reducers the stats reducer records the personal best', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 6 } }, reducers: true });
    const onDone = mount();
    click(q('[data-action="start"]'));
    tick(TOTAL_MS);
    answer(true);
    const r = onDone.mock.calls[0]?.[0] as SpeedReadResult;
    expect(store.stats.value.speedReads).toBe(1);
    expect(store.stats.value.speedReadBestCpm).toBe(r.cpm);
  });

  it('unmounting during the reveal clears the timers', () => {
    const onDone = mount();
    click(q('[data-action="start"]'));
    tick(2000);
    render(null, root);
    tick(TOTAL_MS);
    expect(onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a missing episode offers Continue and reports missing without emitting', async () => {
    const cap = captureEvents();
    const onDone = mount({ storyId: 's-09-9' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-state="missing"]')).not.toBeNull();
    click(q('[data-action="skip"]'));
    cap.stop();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ missing: true }));
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
  });

  it('an episode without questions finishes with 0 of 0', () => {
    const bare: StoryItem = { ...STORY, id: 's-04-3', comprehension: [] };
    const fx = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-04-3': bare } });
    const onDone = mount({ storyId: 's-04-3', loader: fx });
    click(q('[data-action="start"]'));
    tick(TOTAL_MS);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: 0, total: 0, passed: false }));
  });
});

describe('<SpeedRead> as the speed-read exercise', () => {
  function props(params: Step['params'] = { storyId: FIXTURE_STORY_ID, rate: 150 }): ExerciseProps {
    const step: Step = { id: 'sp-1', block: 'input', exercise: 'speed-read', itemId: FIXTURE_STORY_ID, cardKey: null, params, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 120_000 };
    return { step, item: STORY, feel: 'dojo', furigana: 'always', jj: false, speedTier: 3, exposures: 0, onResult: vi.fn(), onHint: vi.fn(), onReplay: vi.fn(), requestJudge: () => Promise.resolve(true) };
  }

  it('uses params.rate and reports onResult after the question', () => {
    const pr = props();
    act(() => render(<SpeedRead {...pr} />, root));
    expect(q('.speed')?.getAttribute('data-rate')).toBe('150');
    click(q('[data-action="start"]'));
    const total = revealSchedule(STORY.lines, 150).at(-1) as number;
    tick(total);
    answer(true);
    expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ correct: true, score: 1, ms: total, errorTags: [] }));
  });

  it('a miss reports correct: false', () => {
    const pr = props();
    act(() => render(<SpeedRead {...pr} />, root));
    click(q('[data-action="start"]'));
    tick(revealSchedule(STORY.lines, 150).at(-1) as number);
    answer(false);
    expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ correct: false, score: 0 }));
  });
});

/* ── design 09 (C4): the reveal bar is motion.css's .meter; reader.css is the Mincho body ── */
describe('design 09 (C4): speed-read meter and reader.css', () => {
  it('the progress bar is a .meter whose --value is lines shown / lines total; no width is written inline', () => {
    mount();
    click(q('[data-action="start"]'));
    const meter = q('.meter[role="progressbar"]');
    expect(meter).not.toBeNull();
    // the first line shows at start, the second at SCHEDULE[1]
    expect(meter!.getAttribute('aria-valuenow')).toBe('1');
    expect(Number(meter!.style.getPropertyValue('--value'))).toBeCloseTo(1 / STORY.lines.length, 6);
    tick(2100);
    expect(meter!.getAttribute('aria-valuenow')).toBe('2');
    expect(Number(meter!.style.getPropertyValue('--value'))).toBeCloseTo(2 / STORY.lines.length, 6);
    expect(meter!.style.getPropertyValue('--meter-tone')).toBe('var(--ai)');
    expect(meter!.querySelector('.meter__fill')).not.toBeNull();
    expect(q('.speed__bar')).toBeNull();
    expect(root.querySelector('[style*="width"]')).toBeNull();
  });

  it('reader.css: no width/height tween, no bar clone, the episode body is Mincho at --lh-mincho within --measure-ja with gothic ruby (§3.1–§3.3), labels come from .eyebrow', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/input/reader/reader.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/transition:[^;]*\b(width|height)\b/);
    expect(css).not.toMatch(/\.speed__bar|\.reader__result|\.reader__big/);
    const body = /\.ruby\.reader__ja\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toMatch(/font-family:\s*var\(--font-mincho\)/);
    expect(body).toMatch(/line-height:\s*var\(--lh-mincho\)/);
    expect(body).toMatch(/max-inline-size:\s*var\(--measure-ja\)/);
    expect(/\.reader__ja rt\s*\{[^}]*font-family:\s*var\(--font-ja\)/.test(css)).toBe(true);
    // the fence stops at the body: the title (shared with Speed Read, a tempo drill) is chrome and sets no face
    expect(css.match(/--font-mincho/g)).toHaveLength(1);
    expect(/\.reader__title\s*\{[^}]*font-family/.test(css)).toBe(false);
    // the gloss sheet shades inset (§2.2), never a blurred drop shadow
    expect(/\.gloss\s*\{[^}]*box-shadow:\s*inset /.test(css)).toBe(true);
    expect(css).not.toMatch(/\.gloss__body dt|__label|__eyebrow/);
    expect(/\.reader__mode\s*\{[^}]*(font-family|text-transform)/.test(css)).toBe(false);
    expect(css).not.toMatch(/prefers-reduced-motion|\.reduced-motion/);
  });
});
