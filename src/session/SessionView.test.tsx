/**
 * SessionView.tsx — a full session over the real runner, writer and a test store,
 * with a stub exercise registered in the shared registry.
 */
import { signal } from '@preact/signals';
import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardKey } from '../content/types';
import { V, createFakeLoader } from '../content/fixtures';
import { installServices, nullAudio, resetServices, type AudioService, type ClipCue, type SpeakOptions } from '../shared/audio';
import { SFX_NAMES, type SfxName } from '../shared/catalog';
import { bus } from '../shared/events';
import { registerExercise, resetRegistryForTests, type ExerciseProps } from '../shared/exercise-types';
import { useExerciseKeys } from '../shared/ui/ExerciseFrame';
import type { AttemptResult, SessionPlan, Step } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple, LogEntry } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { SessionRunner } from './runner';
import { checkStepId, resetScrollCompletions } from './scroll';
import { GHOST_FALLBACK_MS, HIT_STOP_MS, SessionView, comboTierOf, examFurigana, ghostOf, pageTurns, pairClipKeys, previousSessionErrorRate, sfxForGrade, type JudgeAsk } from './SessionView';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const ITEMS = [V.犬, V.水, V.人, V.日];

let root: HTMLDivElement;
let clock = DEFAULT_TEST_NOW;

beforeEach(() => {
  clock = DEFAULT_TEST_NOW;
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetRegistryForTests();
  resetStoreForTests();
  resetScrollCompletions();
  resetServices();
  bus.reset();
  vi.useRealTimers();
});

/* ── stub exercises ─────────────────────────────────────────────────── */

const ok = (o: Partial<AttemptResult> = {}): AttemptResult => ({ correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2500, errorTags: [], answer: 'x', ...o });

function Stub(p: ExerciseProps): JSX.Element {
  // A drill's own hint, reached by the frame's `?` / Hint button; it reports to the host like every drill.
  useExerciseKeys({ onHint: () => p.onHint() });
  return (
    <div class="stub" data-step={p.step.id} data-item={p.item ? 'yes' : 'no'} data-jj={p.jj ? 'true' : 'false'} data-tier={p.speedTier} data-furigana={p.furigana}>
      <button type="button" class="stub-answer" onClick={() => p.onResult(ok())}>
        answer
      </button>
      <button type="button" class="stub-miss" onClick={() => p.onResult(ok({ correct: false, answer: 'nope' }))}>
        miss
      </button>
    </div>
  );
}

function JudgeStub(p: ExerciseProps): JSX.Element {
  return (
    <div class="stub stub--judge" data-step={p.step.id}>
      <button
        type="button"
        class="stub-good"
        onClick={() => {
          void p.requestJudge({ correct: 'dog', distractors: ['cat', 'bird', 'fish'] }).then(() => p.onResult(ok({ selfRating: 3 })));
        }}
      >
        good
      </button>
    </div>
  );
}

function registerStubs(): void {
  registerExercise({ id: 'meaning-recall', facet: 'rec', needsTts: false, needsStt: false, selfGraded: false, timeable: true, keys: 'text' }, Stub);
  registerExercise({ id: 'meaning-judge', facet: 'rec', needsTts: false, needsStt: false, selfGraded: true, timeable: false, keys: 'none' }, JudgeStub);
}

/* ── plan / store helpers ───────────────────────────────────────────── */

function step(o: Partial<Step> & { id: string; cardKey: CardKey | null }): Step {
  const itemId = o.itemId ?? (o.cardKey ? o.cardKey.split('#')[0]! : null);
  return { block: 'reviews', exercise: 'meaning-recall', itemId, params: { answer: 'x', accept: ['x'] }, timed: false, isNew: false, stepTag: null, exposures: 6, estMs: 6000, ...o };
}

function plan(steps: Step[], o: Partial<SessionPlan['meta']> = {}, mode: SessionPlan['mode'] = 'kata'): SessionPlan {
  const reviews = steps.filter((s) => s.block !== 'michikusa');
  const blocks: SessionPlan['blocks'] = [{ kind: 'reviews', label: 'Reviews', estMinutes: 2, stepIds: reviews.map((s) => s.id) }];
  const m = steps.filter((s) => s.block === 'michikusa');
  if (m.length) blocks.push({ kind: 'michikusa', label: 'Michikusa', estMinutes: 0.2, stepIds: m.map((s) => s.id) });
  return { id: `${mode}-view-test`, mode, day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps, blocks, meta: { dueTotal: reviews.length, dueTaken: reviews.length, backlog: false, newCount: 0, scrollIds: [], ...o } };
}

function cards(ids: readonly string[], s = 5): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of ids) out[`${id}#rec`] = card({ due: TODAY, s, d: 5, reps: 6, lapses: 0, state: 2, last: TODAY - 1 });
  return out;
}

const kataSteps = (): Step[] => [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` }), step({ id: 's1', cardKey: `${ITEMS[1]}#rec` }), step({ id: 'mk', block: 'michikusa', exercise: 'story-read', cardKey: null, itemId: 'm-04-2', params: { michikusaId: 'm-04-2' } }), step({ id: 's2', cardKey: `${ITEMS[2]}#rec` })];

async function setup(o: { steps?: Step[]; feel?: 'zen' | 'dojo' | 'arcade'; reduced?: boolean; meta?: Partial<SessionPlan['meta']> } = {}): Promise<{ runner: SessionRunner; onExit: ReturnType<typeof vi.fn>; onAnother: ReturnType<typeof vi.fn> }> {
  await makeTestStore({ save: { progress: { station: 4 }, settings: { ...(o.feel ? { feel: o.feel } : {}), ...(o.reduced ? { reducedMotion: true } : {}) } }, cards: cards(ITEMS), now: () => clock });
  registerStubs();
  const runner = new SessionRunner(plan(o.steps ?? kataSteps(), o.meta), { loader });
  const onExit = vi.fn();
  const onAnother = vi.fn();
  act(() => render(<SessionView runner={runner} onExit={onExit} onAnother={onAnother} loader={loader} />, root));
  return { runner, onExit, onAnother };
}

const click = (sel: string): void => {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`no element ${sel}`);
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

const press = (key: string, init: KeyboardEventInit = {}): void => {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Lets chained async work (the 次回予告 loads a plan context and the vista lookup over several awaits) settle; 30 turns, so a loaded machine does not read as a failure. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
};

/** jsdom runs no animations, so every exit is instant there (nothing waits on decoration); these tests lend it an engine (`getAnimations`) and end the exits by hand. */
let restoreEngine: (() => void) | null = null;
const withAnimations = (): void => {
  const proto = Element.prototype as { getAnimations?: () => Animation[] };
  const had = proto.getAnimations;
  proto.getAnimations = () => [];
  restoreEngine = () => {
    if (had) proto.getAnimations = had;
    else delete proto.getAnimations;
    restoreEngine = null;
  };
};
afterEach(() => restoreEngine?.());
const endAnimation = (sel: string): void => {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`no element ${sel}`);
  act(() => {
    el.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
};


/* ── tests ──────────────────────────────────────────────────────────── */

describe('<SessionView>', () => {
  it('renders the step inside the frame with the Hud and the exercise props', async () => {
    const { runner } = await setup();
    expect(root.querySelector('.hud')).not.toBeNull();
    expect(root.querySelector('.exercise-frame')).not.toBeNull();
    const stub = root.querySelector('.stub')!;
    expect(stub.getAttribute('data-step')).toBe('s0');
    expect(stub.getAttribute('data-item')).toBe('yes');
    expect(stub.getAttribute('data-jj')).toBe('false');
    expect(stub.getAttribute('data-tier')).toBe(String(store.settings.value.speedTier));
    expect(root.querySelector('.exercise-frame__progress')?.textContent).toContain('1 / 4');
    expect(root.querySelector('.forge-bar')).not.toBeNull();
    expect(runner.index.value).toBe(0);
  });

  it('onResult drives the runner: feedback, Continue, next step; a Michikusa step shows the card; the end card follows the last step', async () => {
    const { runner } = await setup();
    const cap = captureEvents();
    click('.stub-answer');
    expect(runner.results).toHaveLength(1);
    expect(root.querySelector('.feedback[data-kind="correct"]')).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'attempt:graded')).toHaveLength(1);
    click('.exercise-frame__controls .hanko');
    expect(runner.index.value).toBe(1);
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s1');
    expect(root.querySelector('.feedback')).toBeNull();

    click('.stub-answer');
    press('Enter');
    expect(runner.index.value).toBe(2);
    expect(root.querySelector('.michikusa')).not.toBeNull();
    expect(root.querySelector('.exercise-frame')).toBeNull();
    expect(root.querySelector('.hud')).not.toBeNull();
    click('.michikusa__continue');
    expect(cap.events.filter((e) => e[0] === 'michikusa:read')).toHaveLength(1);
    expect(store.collections.value.michikusa).toEqual(['m-04-2']);
    expect(runner.index.value).toBe(3);
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s2');

    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(runner.done.value).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'session:finished')).toHaveLength(1);
    // jsdom runs no animations: the End Card mounts at once (the hold is tested under a stubbed engine below)
    expect(root.querySelector('.end-card')).not.toBeNull();
    expect(root.querySelector('.end-card__loading')).not.toBeNull();
    await settle();
    expect(root.querySelector('.end-card__loading')).toBeNull();
    expect(root.querySelector('.end-card__milestone')?.textContent?.length).toBeGreaterThan(0);
    expect(root.textContent).toContain('Reps');
    expect(root.querySelector('.end-card__tally')?.textContent).toContain('3');
    expect(store.session.load()).toBeNull();
    cap.stop();
  });

  it('a miss re-queues a Recovery rep and the Hud follows the live queue', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: cards(ITEMS, 20), now: () => clock });
    registerStubs();
    const steps = ITEMS.map((id, i) => step({ id: `r${i}`, cardKey: `${id}#rec` }));
    const runner = new SessionRunner(plan(steps), { loader });
    act(() => render(<SessionView runner={runner} onExit={() => undefined} loader={loader} />, root));
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    click('.stub-miss');
    expect(root.querySelector('.feedback[data-kind="wrong"]')).not.toBeNull();
    expect(runner.steps().length).toBeGreaterThan(steps.length);
    expect(root.querySelector('.exercise-frame__progress')?.textContent).toContain(`/ ${runner.steps().length}`);
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe(String(runner.steps().length));
  });

  it('pause saves a snapshot at the current rep and resume continues; the frame overlay shows', async () => {
    const { runner } = await setup();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    press('Escape');
    expect(runner.paused.value).toBe(true);
    expect(root.querySelector('.pause-overlay')).not.toBeNull();
    const snap = store.session.load();
    expect(snap?.cursor).toBe(1);
    expect(snap?.results).toHaveLength(1);
    press('Escape');
    expect(runner.paused.value).toBe(false);
    expect(root.querySelector('.pause-overlay')).toBeNull();
    // A resumed runner picks up at the same rep with the same results.
    render(null, root);
    const resumed = SessionRunner.resume({ loader })!;
    expect(resumed.resumed).toBe(true);
    expect(resumed.index.value).toBe(1);
    act(() => render(<SessionView runner={resumed} onExit={() => undefined} loader={loader} />, root));
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s1');
  });

  it('Leave asks first; keeping the place calls onExit and leaves the snapshot in the store', async () => {
    const { onExit } = await setup();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    click('.session__leave');
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    click('.session__leave-stay');
    expect(root.querySelector('.session__dialog')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    click('.session__leave');
    click('.session__leave-keep');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(store.session.load()?.cursor).toBe(1);
  });

  it('the Leave dialog manages focus: Stay is focused first, Escape stays without pausing the runner, focus returns to Leave', async () => {
    const { runner, onExit } = await setup();
    (root.querySelector('.session__leave') as HTMLButtonElement).focus();
    click('.session__leave');
    const stay = root.querySelector('.session__leave-stay') as HTMLButtonElement;
    expect(document.activeElement).toBe(stay);
    act(() => {
      stay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    expect(runner.paused.value).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('.session__leave'));
    // Tab from the last button wraps to the first
    click('.session__leave');
    const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(root.querySelector('.session__leave-keep'));
  });

  it('Shift+Enter guards through the frame and ? opens the drill\'s registered hint, which counts', async () => {
    const { runner } = await setup();
    const cap = captureEvents();
    expect(root.querySelector('.exercise-frame__hint')).not.toBeNull();
    press('?');
    press('Enter', { shiftKey: true });
    expect(runner.results[0]?.guard).toBe(true);
    expect(runner.results[0]?.hintUsed).toBe(true);
    expect(root.querySelector('.feedback[data-kind="guard"]')).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'attempt:graded')).toHaveLength(1);
    cap.stop();
  });

  it('an unregistered drill shows an honest panel: count as don’t know, or leave', async () => {
    const steps = [step({ id: 'k0', cardKey: `${ITEMS[0]}#rec`, exercise: 'kanji-read' }), step({ id: 's1', cardKey: `${ITEMS[1]}#rec` })];
    const { runner, onExit } = await setup({ steps });
    expect(root.querySelector('.stub')).toBeNull();
    expect(root.querySelector('.session__missing')).not.toBeNull();
    click('.session__missing-guard');
    expect(runner.results[0]?.guard).toBe(true);
    expect(root.querySelector('.session__missing-guard')).toBeNull();
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s1');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Judge protocol: a sampled self-rated Good shows the Judge Card and the verdict rides on the submit', async () => {
    const steps = [step({ id: 'j0', cardKey: `${ITEMS[0]}#rec`, exercise: 'meaning-judge', params: { answer: 'dog' } })];
    const { runner } = await setup({ steps });
    const cap = captureEvents();
    click('.stub-good');
    await flush();
    // Honesty has no history yet → every Good is checked (judgeRate 100).
    const judge = root.querySelector('.judge-card');
    expect(judge).not.toBeNull();
    expect(judge?.getAttribute('data-shape')).toBe('meaning');
    expect(root.querySelector('.session__exercise')?.getAttribute('aria-hidden')).toBe('true');
    // the card takes focus when it opens (the dialog itself, so title and prompt are read first), never left inside the hidden exercise
    expect(document.activeElement).toBe(judge);
    const options = Array.from(root.querySelectorAll('.judge-card__option'));
    expect(options).toHaveLength(4);
    const correct = options.find((b) => b.textContent?.includes('dog'))!;
    act(() => {
      (correct as HTMLButtonElement).click();
    });
    await flush();
    expect(root.querySelector('.judge-card')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('.session__exercise'));
    expect(runner.results).toHaveLength(1);
    const graded = cap.events.find((e) => e[0] === 'attempt:graded')![1] as { judge?: string; rating: number };
    expect(graded.judge).toBe('pass');
    expect(graded.rating).toBe(3);
    expect(root.querySelector('.feedback__judge')?.textContent).toContain('agrees');
    cap.stop();
  });

  it('Judge protocol: a wrong pick fails the check and the writer forces Again', async () => {
    const steps = [step({ id: 'j0', cardKey: `${ITEMS[0]}#rec`, exercise: 'meaning-judge', params: { answer: 'dog' } })];
    const { runner } = await setup({ steps });
    click('.stub-good');
    await flush();
    const wrong = Array.from(root.querySelectorAll('.judge-card__option')).find((b) => !b.textContent?.includes('dog'))!;
    act(() => {
      (wrong as HTMLButtonElement).click();
    });
    await flush();
    expect(runner.results[0]?.rating).toBe(1);
    expect(root.querySelector('.feedback__judge')?.getAttribute('data-judge')).toBe('fail');
  });

  it('the soft speed ring shows for an untimed step that carries a timer (mature card in Dojo)', async () => {
    const { runner } = await setup({ steps: [step({ id: 't0', cardKey: `${ITEMS[0]}#rec`, timerMs: 12000 }), step({ id: 't1', cardKey: `${ITEMS[1]}#rec` })] });
    expect(runner.step.value?.timed).toBe(false);
    expect(root.querySelector('.speed-ring')).not.toBeNull();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    // no timer on the step → no ring
    expect(root.querySelector('.speed-ring')).toBeNull();
  });

  it('Zen never shows the ring, even with a timer on the step', async () => {
    await setup({ feel: 'zen', steps: [step({ id: 't0', cardKey: `${ITEMS[0]}#rec`, timerMs: 12000 })] });
    expect(root.querySelector('.speed-ring')).toBeNull();
  });

  it('Shinsa from Orange runs with furigana off; Yellow keeps the learner’s setting (design 04 §12)', async () => {
    expect(examFurigana({ mode: 'shinsa', station: 9 })).toBe(false);
    expect(examFurigana({ mode: 'shinsa', station: 15 })).toBe(true);
    expect(examFurigana({ mode: 'shinsa', station: 53 })).toBe(true);
    expect(examFurigana({ mode: 'kata', station: 15 })).toBe(false);
    await makeTestStore({ save: { progress: { station: 15 }, settings: { furigana: 'always' } }, cards: cards(ITEMS), now: () => clock });
    registerStubs();
    const runner = new SessionRunner({ ...plan([step({ id: 'r0', cardKey: `${ITEMS[0]}#rec` })], {}, 'shinsa'), station: 15 }, { loader, persist: false });
    act(() => render(<SessionView runner={runner} onExit={vi.fn()} loader={loader} />, root));
    expect(root.querySelector('.stub')?.getAttribute('data-furigana')).toBe('off');
    render(null, root);
    const yellow = new SessionRunner({ ...plan([step({ id: 'y0', cardKey: `${ITEMS[1]}#rec` })], {}, 'shinsa'), station: 9 }, { loader, persist: false });
    act(() => render(<SessionView runner={yellow} onExit={vi.fn()} loader={loader} />, root));
    expect(root.querySelector('.stub')?.getAttribute('data-furigana')).toBe('always');
  });

  it('Zen: no ki bar or combo in the frame, progress-only Hud, end card without combo rows', async () => {
    const { runner } = await setup({ feel: 'zen', steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })] });
    expect(root.querySelector('.ki-bar')).toBeNull();
    expect(root.querySelector('.forge-bar')).toBeNull();
    click('.stub-answer');
    expect(root.querySelector('.combo')).toBeNull();
    click('.exercise-frame__controls .hanko');
    expect(runner.done.value?.zen).toBe(true);
    expect(root.querySelector('.end-card')).not.toBeNull();
    expect(root.textContent).not.toContain('Best combo');
  });

  it('the end card buttons: Another → onAnother, Rest → onExit', async () => {
    const { onExit, onAnother } = await setup({ steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })] });
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    await flush();
    // Three of the four fixture cards are still due → Another Kata is offered.
    click('.end-card__another');
    expect(onAnother).toHaveBeenCalledTimes(1);
    click('.end-card__rest');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('backlog plans show the honest count instead of the Forge Bar', async () => {
    await setup({ meta: { backlog: true, dueTotal: 310, dueTaken: 120 } });
    expect(root.querySelector('.forge-bar')).toBeNull();
    expect(root.querySelector('.hud__backlog')?.textContent).toContain('120 of your 310 reviews today');
  });

  it('comboTierOf follows the 10 / 25 / 50 thresholds', () => {
    expect([0, 9, 10, 24, 25, 49, 50, 120].map(comboTierOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('previousSessionErrorRate splits the log on a 10-minute gap and ignores entries after the start', () => {
    const t0 = 1_000_000;
    const e = (t: number, rating: 1 | 3): LogEntry => [t, 'v-n5-0001#rec', rating, 3000, 0, 0];
    const log: LogEntry[] = [e(t0, 1), e(t0 + 5_000, 1), e(t0 + 10_000, 3), e(t0 + 2_000_000, 3), e(t0 + 2_005_000, 1), e(t0 + 9_000_000, 1)];
    expect(previousSessionErrorRate(log, t0 + 8_000_000)).toBe(0.5);
    expect(previousSessionErrorRate(log, t0 + 1_000_000)).toBeCloseTo(2 / 3);
    expect(previousSessionErrorRate(log, t0)).toBeNull();
    expect(previousSessionErrorRate([], t0)).toBeNull();
  });
});

describe('<SessionView> Scroll teach phase (design 03 §2.2)', () => {
  const scrollSteps = (sid: string): Step[] => [
    step({ id: 'w0', cardKey: `${ITEMS[0]}#rec` }),
    ...[V.食べる, V.飲む].map((id) => step({ id: checkStepId(sid, id), cardKey: `${id}#rec`, isNew: true, stepTag: 'intro', exposures: 0, block: 'scroll', params: { scrollId: sid, answer: 'x', accept: ['x'] } })),
  ];

  it('pauses at the first intro check and unrolls one teach card per item of that Scroll; Begin the checks resumes', async () => {
    const { runner } = await setup({ steps: scrollSteps('4-1') });
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('w0');
    expect(root.querySelector('.session--teach')).toBeNull();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(runner.step.value?.id).toBe(checkStepId('4-1', V.食べる));
    expect(runner.paused.value).toBe(true);
    expect(root.querySelector('.session--teach')?.getAttribute('data-scroll')).toBe('4-1');
    expect(root.querySelectorAll('.teach-card')).toHaveLength(2);
    expect(root.textContent).toContain('飲む');
    expect(root.querySelector('.stub')).toBeNull();
    // "Begin the checks" is focused imperatively (a dynamic autofocus attribute is ignored by the browser)
    expect(document.activeElement).toBe(root.querySelector('.session__teach-begin'));
    click('.session__teach-begin');
    expect(runner.paused.value).toBe(false);
    expect(root.querySelector('.session--teach')).toBeNull();
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe(checkStepId('4-1', V.食べる));
    // the second check of the same Scroll does not teach again
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.session--teach')).toBeNull();
    expect(runner.paused.value).toBe(false);
  });

  it('a host that teaches itself passes teach={false} and the checks run straight away', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: cards(ITEMS), now: () => clock });
    registerStubs();
    const runner = new SessionRunner(plan(scrollSteps('4-2').slice(1)), { loader });
    act(() => render(<SessionView runner={runner} onExit={vi.fn()} loader={loader} teach={false} />, root));
    expect(root.querySelector('.session--teach')).toBeNull();
    expect(runner.paused.value).toBe(false);
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe(checkStepId('4-2', V.食べる));
  });
});

describe('perception Judge: one source for both words (design 08 §10.4)', () => {
  const PAIR: [string, string] = ['いぬ', 'いね'];
  const cue = (key: string): ClipCue => ({ key, file: 'audio/sprites/s04/words-01.webm', start: 0, end: 1, voice: 'VOICEVOX:九州そら', rate: 1 });
  function fakeAudio(o: { ready: boolean; has?: (key: string) => boolean }): { audio: AudioService; spoken: [string, SpeakOptions | undefined][] } {
    const spoken: [string, SpeakOptions | undefined][] = [];
    const audio: AudioService = {
      ...nullAudio,
      hasJaVoice: signal(true),
      packReady: signal(o.ready),
      clipFor: (key) => ((o.has ?? (() => true))(key) ? cue(key) : undefined),
      speak: (text, opts) => {
        spoken.push([text, opts]);
        return Promise.resolve();
      },
    };
    return { audio, spoken };
  }
  /** A self-graded drill whose Good asks for a perception Judge over PAIR, hearing side `heard`. */
  const pairStub = (heard: 0 | 1) =>
    function PairStub(p: ExerciseProps): JSX.Element {
      return (
        <div class="stub stub--pair" data-step={p.step.id}>
          <button
            type="button"
            class="stub-pair"
            onClick={() => {
              void (p.requestJudge as (o: JudgeAsk) => Promise<boolean>)({ minimalPair: PAIR, heard }).then(() => p.onResult(ok({ selfRating: 3 })));
            }}
          >
            good
          </button>
        </div>
      );
    };
  async function mountPair(heard: 0 | 1, audio: AudioService): Promise<void> {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: cards(ITEMS), now: () => clock });
    installServices({ audio });
    registerExercise({ id: 'shadow', facet: null, needsTts: true, needsStt: false, selfGraded: true, timeable: false, keys: 'none' }, pairStub(heard));
    const runner = new SessionRunner(plan([step({ id: 'p0', cardKey: `${V.犬}#rec`, exercise: 'shadow', params: { answer: 'いぬ' } })]), { loader });
    act(() => render(<SessionView runner={runner} onExit={vi.fn()} loader={loader} />, root));
  }
  const unmount = (): void => {
    render(null, root);
    resetRegistryForTests();
    resetStoreForTests();
    resetServices();
  };
  afterEach(() => resetServices());

  it('pairClipKeys: the item id, a pool partner id or `${id}#pair`, only when the pack is ready and holds both', () => {
    const inu = loader.get(V.犬)!;
    const lookup = (id: string) => loader.get(id);
    const ready = fakeAudio({ ready: true }).audio;
    expect(pairClipKeys(PAIR, inu, lookup, [], ready)).toEqual([V.犬, `${V.犬}#pair`]);
    expect(pairClipKeys(['いぬ', 'みず'], inu, lookup, [V.水], ready)).toEqual([V.犬, V.水]);
    expect(pairClipKeys(['みず', 'いぬ'], inu, lookup, [V.水], ready)).toEqual([V.水, V.犬]);
    expect(pairClipKeys(['犬', 'いね'], inu, lookup, [], ready)).toEqual([V.犬, `${V.犬}#pair`]);
    expect(pairClipKeys(PAIR, inu, lookup, [], fakeAudio({ ready: false }).audio)).toBeNull();
    expect(pairClipKeys(PAIR, inu, lookup, [], fakeAudio({ ready: true, has: (k) => !k.endsWith('#pair') }).audio)).toBeNull();
    expect(pairClipKeys(PAIR, inu, lookup, [], fakeAudio({ ready: true, has: (k) => k.endsWith('#pair') }).audio)).toBeNull();
    expect(pairClipKeys(PAIR, inu, lookup, [], nullAudio)).toBeNull();
    expect(pairClipKeys(PAIR, null, lookup, [], ready)).toBeNull();
  });

  it('speaks the heard word with its clip key when the pack holds both words — and the replay through the same source', async () => {
    for (const heard of [0, 1] as const) {
      const { audio, spoken } = fakeAudio({ ready: true });
      await mountPair(heard, audio);
      click('.stub-pair');
      await flush();
      const judge = root.querySelector('.judge-card');
      expect(judge?.getAttribute('data-shape')).toBe('perception');
      const key = heard === 0 ? V.犬 : `${V.犬}#pair`;
      expect(spoken).toEqual([[PAIR[heard], { clip: key }]]);
      click('.judge-card .btn--ghost');
      expect(spoken).toEqual([
        [PAIR[heard], { clip: key }],
        [PAIR[heard], { clip: key }],
      ]);
      unmount();
    }
  });

  it('speaks neither word with a clip key when the pack is not ready, or holds only one of the two', async () => {
    const off = fakeAudio({ ready: false });
    await mountPair(0, off.audio);
    click('.stub-pair');
    await flush();
    expect(off.spoken).toEqual([['いぬ', undefined]]);
    unmount();
    const half = fakeAudio({ ready: true, has: (k) => !k.endsWith('#pair') });
    await mountPair(0, half.audio);
    click('.stub-pair');
    await flush();
    expect(half.spoken).toEqual([['いぬ', undefined]]);
    click('.judge-card .btn--ghost');
    expect(half.spoken).toHaveLength(2);
    expect(half.spoken.every(([, o]) => o === undefined)).toBe(true);
    unmount();
  });
});

describe('<SessionView> motion (design 09 §7 F, I, J; d33)', () => {
  const recordingAudio = (): { audio: AudioService; played: SfxName[] } => {
    const played: SfxName[] = [];
    return { audio: { ...nullAudio, sfx: (n) => played.push(n) }, played };
  };

  it('without an animation engine (jsdom) nothing is ghosted or held: the next step and the End Card mount at once', async () => {
    const { runner } = await setup({ steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` }), step({ id: 's1', cardKey: `${ITEMS[1]}#rec` })] });
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.session__ghost')).toBeNull();
    expect(root.querySelector('.session__step.ink-nijimi .stub')?.getAttribute('data-step')).toBe('s1');
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(runner.done.value).not.toBeNull();
    expect(root.querySelector('.session--held')).toBeNull();
    expect(root.querySelector('.end-card')).not.toBeNull();
  });

  it('J · the incoming step mounts as .ink-nijimi and the outgoing one is a ghost under data-leaving, gone on animationend; the new step is live at once', async () => {
    const { runner } = await setup();
    withAnimations();
    expect(root.querySelector('.session__step.ink-nijimi .stub')?.getAttribute('data-step')).toBe('s0');
    expect(root.querySelector('.session__ghost')).toBeNull();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    const live = root.querySelector('.session__step.ink-nijimi:not([data-leaving]) .stub');
    expect(live?.getAttribute('data-step')).toBe('s1');
    const ghost = root.querySelector('.session__ghosts .session__ghost');
    expect(ghost).not.toBeNull();
    expect(ghost?.hasAttribute('data-leaving')).toBe(true);
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.hasAttribute('inert')).toBe(true);
    expect(ghost?.querySelector('.stub')?.getAttribute('data-step')).toBe('s0');
    expect(ghost?.querySelector('[id]')).toBeNull();
    // the live step answers while the ghost is still fading — nothing waits on decoration
    click('.session__step:not([data-leaving]) .stub-answer');
    expect(runner.results).toHaveLength(2);
    endAnimation('.session__ghost');
    expect(root.querySelector('.session__ghost')).toBeNull();
  });

  it('J · the ghost falls back to a timer when no animationend arrives (≤ 200 ms)', async () => {
    await setup();
    withAnimations();
    vi.useFakeTimers();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.session__ghost')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(GHOST_FALLBACK_MS);
    });
    expect(root.querySelector('.session__ghost')).toBeNull();
    expect(GHOST_FALLBACK_MS).toBeLessThanOrEqual(200);
  });

  it('ghostOf strips ids, roles and labels and marks the clone inert, hidden and leaving', () => {
    const el = document.createElement('div');
    el.className = 'x';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Training session');
    el.innerHTML = '<p id="a"><button id="b">x</button></p>';
    const g = ghostOf(el, 'ghost');
    expect(g.className).toBe('ghost');
    expect(g.hasAttribute('data-leaving')).toBe(true);
    expect(g.getAttribute('aria-hidden')).toBe('true');
    expect(g.hasAttribute('inert')).toBe(true);
    expect(g.hasAttribute('role')).toBe(false);
    expect(g.hasAttribute('aria-label')).toBe(false);
    expect(g.querySelector('[id]')).toBeNull();
    expect(g.querySelector('button')?.textContent).toBe('x');
    expect(el.querySelector('#b')).not.toBeNull();
  });

  it('ghostOf freezes every descendant at its drawn end state (a fresh node would restart its entrance) and carries typed values over', () => {
    const el = document.createElement('div');
    el.innerHTML = '<button class="choice ink-nijimi" style="--i:2"><svg class="choice__strike"><path class="ink-hiku" data-axis="stroke"></path></svg></button><input value=""><textarea></textarea>';
    (el.querySelector('input') as HTMLInputElement).value = 'typed';
    (el.querySelector('textarea') as HTMLTextAreaElement).value = 'more';
    const g = ghostOf(el, 'ghost');
    for (const n of Array.from(g.querySelectorAll<HTMLElement>('*'))) {
      expect(n.style.animation, n.tagName).toBe('none');
      expect(n.style.transition, n.tagName).toBe('none');
    }
    // the classes stay (layout reads them); only their animations are silenced
    expect(g.querySelector('.choice.ink-nijimi')).not.toBeNull();
    expect((g.querySelector('input') as HTMLInputElement).value).toBe('typed');
    expect((g.querySelector('textarea') as HTMLTextAreaElement).value).toBe('more');
    expect((el.querySelector('button') as HTMLElement).style.animation).toBe('');
  });

  it('F · Leave: a role="dialog" .tanzaku with the remaining-rep mark; Leave sets data-leaving on slip and backdrop before onExit; no second step', async () => {
    const { onExit } = await setup();
    withAnimations();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    click('.session__leave');
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.classList.contains('tanzaku')).toBe(true);
    expect(dialog.hasAttribute('data-shiori')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelector('.tanzaku__backdrop')).not.toBeNull();
    expect(root.querySelector('.tanzaku .status-window')).not.toBeNull();
    expect(root.querySelector('.session__dialog-copy')?.textContent).toBe('Your place is kept. Resume from the dojo whenever you like; a resumed session still earns its card.');
    // 4 steps (one a Michikusa card, not a rep), one answered → 2 reps left (a count, never a deadline)
    expect(root.querySelector('.session__dialog-left')?.textContent).toBe('2 reps left');
    expect(root.textContent).not.toMatch(/sure\?|hurry|only \d+/i);
    // the Stay hanko takes the ink-bleed ring on pointerdown (§5.3), delegated from the session root
    const stay = root.querySelector('.session__leave-stay')!;
    act(() => {
      stay.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(stay.classList.contains('is-pressed')).toBe(true);
    act(() => {
      stay.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    expect(stay.classList.contains('is-pressed')).toBe(false);
    click('.session__leave-keep');
    const slip = root.querySelector('.tanzaku')!;
    expect(slip.hasAttribute('data-leaving')).toBe(true);
    expect(root.querySelector('.tanzaku__backdrop')?.hasAttribute('data-leaving')).toBe(true);
    // while leaving the slip is no modal: inert, hidden from assistive tech, aria-modal gone
    expect(slip.hasAttribute('inert')).toBe(true);
    expect(slip.getAttribute('aria-hidden')).toBe('true');
    expect(slip.hasAttribute('aria-modal')).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    // a second Leave click while leaving does nothing twice
    click('.session__leave-keep');
    endAnimation('.tanzaku');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it('F · where a page turn will run (View Transitions, motion not reduced) Leave fires onExit at once and the slip stays whole for the shiori snapshot', async () => {
    const { onExit } = await setup();
    withAnimations();
    expect(pageTurns()).toBe(false);
    const doc = document as unknown as { startViewTransition?: unknown };
    doc.startViewTransition = () => ({ finished: Promise.resolve() });
    try {
      expect(pageTurns()).toBe(true);
      click('.session__leave');
      click('.session__leave-keep');
      expect(onExit).toHaveBeenCalledTimes(1);
      const slip = root.querySelector('.tanzaku[data-shiori]');
      expect(slip).not.toBeNull();
      expect(slip?.hasAttribute('data-leaving')).toBe(false);
      expect(slip?.hasAttribute('inert')).toBe(false);
      // nothing fires twice
      click('.session__leave-keep');
      expect(onExit).toHaveBeenCalledTimes(1);
    } finally {
      delete doc.startViewTransition;
    }
    expect(pageTurns()).toBe(false);
  });

  it('F · the runner pauses behind the slip (no ring runs out while it reads "Your place is kept.") and resumes on Stay; Leave plays one submit tap, none in Zen', async () => {
    const { audio, played } = recordingAudio();
    const a = await setup();
    installServices({ audio });
    expect(a.runner.paused.value).toBe(false);
    click('.session__leave');
    expect(a.runner.paused.value).toBe(true);
    expect(root.querySelector('.exercise-frame')?.getAttribute('data-paused')).toBeNull(); // the frame's own overlay is not up
    click('.session__leave-stay');
    expect(a.runner.paused.value).toBe(false);
    expect(played).toEqual([]);
    click('.session__leave');
    click('.session__leave-keep');
    expect(a.onExit).toHaveBeenCalledTimes(1);
    expect(played).toEqual(['submit']);
    render(null, root);
    resetStoreForTests();
    resetRegistryForTests();
    const b = await setup({ feel: 'zen' });
    installServices({ audio });
    click('.session__leave');
    click('.session__leave-keep');
    expect(b.onExit).toHaveBeenCalledTimes(1);
    expect(played).toEqual(['submit']);
  });

  it('F · the slip exits by the timer fallback too; under reduced motion it still leaves under data-leaving (motion.css: a --dur-fade fade) and onExit follows the fade', async () => {
    const a = await setup();
    withAnimations();
    vi.useFakeTimers();
    click('.session__leave');
    click('.session__leave-keep');
    expect(a.onExit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(GHOST_FALLBACK_MS);
    });
    expect(a.onExit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    render(null, root);
    resetStoreForTests();
    resetRegistryForTests();
    const b = await setup({ reduced: true });
    click('.session__leave');
    expect(root.querySelector('.session__dialog-left')?.textContent).toBe('3 reps left');
    click('.session__leave-keep');
    expect(root.querySelector('.tanzaku')?.hasAttribute('data-leaving')).toBe(true);
    expect(b.onExit).not.toHaveBeenCalled();
    endAnimation('.tanzaku');
    expect(b.onExit).toHaveBeenCalledTimes(1);
    // without an engine (plain jsdom) the slip is gone at once
    restoreEngine?.();
    render(null, root);
    resetStoreForTests();
    resetRegistryForTests();
    const c = await setup({ reduced: true });
    click('.session__leave');
    click('.session__leave-keep');
    expect(c.onExit).toHaveBeenCalledTimes(1);
  });

  it('d33 · when done flips the Hud and the frame are held under data-leaving and the End Card mounts after the hold (fake timers)', async () => {
    const { runner } = await setup({ steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })] });
    withAnimations();
    vi.useFakeTimers();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(runner.done.value).not.toBeNull();
    const held = root.querySelector('.session--ending .session--held');
    expect(held).not.toBeNull();
    expect(held?.hasAttribute('data-leaving')).toBe(true);
    expect(held?.querySelector('.hud')).not.toBeNull();
    expect(held?.querySelector('.exercise-frame')).not.toBeNull();
    expect(held?.hasAttribute('inert')).toBe(true);
    expect(root.querySelector('.end-card')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(GHOST_FALLBACK_MS);
    });
    expect(root.querySelector('.session--held')).toBeNull();
    expect(root.querySelector('.end-card')).not.toBeNull();
  });

  it('d33 · the hold ends on animationend as well, and is skipped under reduced motion', async () => {
    await setup({ steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })] });
    withAnimations();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.end-card')).toBeNull();
    endAnimation('.session--held');
    expect(root.querySelector('.end-card')).not.toBeNull();
    render(null, root);
    resetStoreForTests();
    resetRegistryForTests();
    await setup({ steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })], reduced: true });
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.session--held')).toBeNull();
    expect(root.querySelector('.end-card')).not.toBeNull();
  });

  it('I · one sfx per graded attempt, an existing SfxName by kind and tier; a miss is the soft donk; a Guard taps', async () => {
    const { audio, played } = recordingAudio();
    await setup();
    installServices({ audio });
    click('.stub-answer');
    expect(played).toEqual(['correct']);
    click('.exercise-frame__controls .hanko');
    click('.stub-miss');
    expect(played).toEqual(['correct', 'wrong']);
    click('.exercise-frame__controls .hanko');
    // the Michikusa card grades nothing
    click('.michikusa__continue');
    expect(played).toHaveLength(2);
    press('Enter', { shiftKey: true });
    expect(played).toEqual(['correct', 'wrong', 'submit']);
    for (const n of played) expect(SFX_NAMES).toContain(n);
  });

  it('I · Zen is silent', async () => {
    const { audio, played } = recordingAudio();
    await setup({ feel: 'zen' });
    installServices({ audio });
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    click('.stub-miss');
    expect(played).toEqual([]);
  });

  it('sfxForGrade: correct by tier (arpeggio, +G5, +C6), ippon, wrong / timeout donk, near / guard tap, info silent', () => {
    expect(sfxForGrade({ kind: 'correct', ippon: false }, 0)).toBe('correct');
    expect(sfxForGrade({ kind: 'correct', ippon: false }, 1)).toBe('correct');
    expect(sfxForGrade({ kind: 'correct', ippon: false }, 2)).toBe('correct-tier2');
    expect(sfxForGrade({ kind: 'correct', ippon: false }, 3)).toBe('correct-tier3');
    expect(sfxForGrade({ kind: 'correct', ippon: true }, 3)).toBe('ippon');
    expect(sfxForGrade({ kind: 'wrong', ippon: false }, 2)).toBe('wrong');
    expect(sfxForGrade({ kind: 'timeout', ippon: false }, 0)).toBe('wrong');
    expect(sfxForGrade({ kind: 'near', ippon: false }, 0)).toBe('submit');
    expect(sfxForGrade({ kind: 'guard', ippon: false }, 0)).toBe('submit');
    expect(sfxForGrade({ kind: 'info', ippon: false }, 0)).toBeNull();
  });

  it('I · the Arcade hit-stop: .is-hitstop on the session root for HIT_STOP_MS (33) after a grade; never under Dojo', async () => {
    await setup({ feel: 'arcade' });
    withAnimations();
    vi.useFakeTimers();
    click('.stub-answer');
    expect(root.querySelector('.session')?.classList.contains('is-hitstop')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(HIT_STOP_MS);
    });
    expect(root.querySelector('.session')?.classList.contains('is-hitstop')).toBe(false);
    expect(HIT_STOP_MS).toBe(33);
    vi.useRealTimers();
    render(null, root);
    resetStoreForTests();
    resetRegistryForTests();
    await setup({ feel: 'dojo' });
    click('.stub-answer');
    expect(root.querySelector('.session')?.classList.contains('is-hitstop')).toBe(false);
  });
});
