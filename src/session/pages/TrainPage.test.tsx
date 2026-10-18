/**
 * TrainPage.tsx — mode → plan mode; resume offered when a snapshot exists; redirects; empty plans.
 */
import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../../content/types';
import { FIXTURE_IDS, V, createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { registerExercise, resetRegistryForTests, type ExerciseProps } from '../../shared/exercise-types';
import { navigate, route } from '../../shared/routes';
import { SESSION_SCHEMA, type SessionSnapshot, type Step } from '../../shared/session-types';
import { epochDay } from '../../shared/time';
import type { CardTuple } from '../../shared/store-types';
import { resetStoreForTests, store } from '../../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../../store/testing';
import { kiaiInit } from '../../learn';
import { resetScrollCompletions } from '../scroll';
import TrainPage, { redirectFor, snapshotStepsLeft } from './TrainPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetRegistryForTests();
  resetStoreForTests();
  resetScrollCompletions();
  bus.reset();
  navigate({ name: 'dojo' }, { replace: true });
});

function Stub(p: ExerciseProps): JSX.Element {
  return (
    <button type="button" class="stub-answer" data-step={p.step.id} onClick={() => p.onResult({ correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2000, errorTags: [], answer: 'x' })}>
      answer
    </button>
  );
}

function dueCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) out[`${id}#rec`] = card({ due: TODAY, s: 5, d: 5, reps: 6, state: 2, last: TODAY - 1 });
  for (const id of FIXTURE_IDS.kanji) out[`${id}#comp`] = card({ due: TODAY, s: 5, d: 5, reps: 6, state: 2, last: TODAY - 1 });
  return out;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
};

const click = (sel: string): void => {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`no element ${sel}`);
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

function mount(mode: 'kata' | 'kumite' | 'shugyo' | 'kage' | 'gate' | 'shinsa' | 'dan' | 'rapid'): void {
  act(() => render(<TrainPage route={{ name: 'train', mode }} loader={loader} available={all} />, root));
}

function step(id: string, cardKey: CardKey): Step {
  return { id, block: 'reviews', exercise: 'meaning-recall', itemId: cardKey.split('#')[0]!, cardKey, params: { answer: 'x', accept: ['x'] }, timed: false, isNew: false, stepTag: null, exposures: 6, estMs: 6000 };
}

function snapshot(cursor: number): SessionSnapshot {
  const steps = [step('a', `${V.犬}#rec`), step('b', `${V.水}#rec`), step('c', `${V.人}#rec`)];
  return {
    schema: SESSION_SCHEMA,
    plan: { id: 'kumite-snap', mode: 'kumite', day: TODAY, createdAt: DEFAULT_TEST_NOW - 60_000, station: 4, steps, blocks: [{ kind: 'reviews', label: 'Reviews', estMinutes: 1, stepIds: steps.map((s) => s.id) }], meta: { dueTotal: 3, dueTaken: 3, backlog: false, newCount: 0, scrollIds: [] } },
    cursor,
    results: [],
    kiai: kiaiInit(),
  };
}

describe('<TrainPage>', () => {
  it('builds a plan for the route mode, shows the pre-roll, and Begin starts the session', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: dueCards() });
    registerExercise({ id: 'meaning-recall', facet: 'rec', needsTts: false, needsStt: false, selfGraded: false, timeable: true, keys: 'text' }, Stub);
    mount('kata');
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toMatch(/checking|building/);
    await settle();
    const page = root.querySelector('.train')!;
    expect(page.getAttribute('data-phase')).toBe('preroll');
    expect(page.getAttribute('data-mode')).toBe('kata');
    expect(root.querySelector('.train__title')?.textContent).toBe('型 Kata');
    expect(root.querySelectorAll('.train__block').length).toBeGreaterThan(0);
    expect(root.querySelector('.train__totals')?.textContent).toMatch(/reps/);
    expect(root.querySelector('.train__totals')?.textContent).toContain('one Michikusa');
    expect(root.querySelector('.train__back')?.getAttribute('href')).toBe('#/');
    // Begin has keyboard focus (focused imperatively: a dynamic autofocus attribute is ignored once anything was focused)
    expect(document.activeElement).toBe(root.querySelector('.train__begin'));

    const cap = captureEvents();
    click('.train__begin');
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('running');
    expect(root.querySelector('.session')).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'session:started')).toHaveLength(1);
    expect(store.session.load()?.plan.mode).toBe('kata');
    expect(root.querySelector('.stub-answer')).not.toBeNull();
    cap.stop();
  });

  it('offers to resume when a snapshot with reps left exists; Start fresh abandons it and builds anew', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: dueCards() });
    registerExercise({ id: 'meaning-recall', facet: 'rec', needsTts: false, needsStt: false, selfGraded: false, timeable: true, keys: 'text' }, Stub);
    store.session.save(snapshot(1));
    mount('kata');
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('resume');
    expect(root.querySelector('.train__resume-btn')?.textContent).toBe('Resume (2 reps left)');
    expect(root.querySelector('.train__line')?.textContent).toBe('組手 Kumite');
    expect(document.activeElement).toBe(root.querySelector('.train__resume-btn'));

    click('.train__resume-btn');
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('running');
    expect(root.querySelector('.stub-answer')?.getAttribute('data-step')).toBe('b');

    render(null, root);
    store.session.save(snapshot(1));
    const cap = captureEvents();
    mount('kata');
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('resume');
    click('.train__fresh-btn');
    expect(cap.events.filter((e) => e[0] === 'session:abandoned')).toHaveLength(1);
    expect(store.session.load()).toBeNull();
    await settle();
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('preroll');
    expect(root.querySelector('.train__title')?.textContent).toBe('型 Kata');
    cap.stop();
  });

  it('a spent snapshot is not offered', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: dueCards() });
    store.session.save(snapshot(3));
    expect(snapshotStepsLeft(snapshot(3))).toBe(0);
    expect(snapshotStepsLeft(null)).toBe(0);
    // ungraded steps (a michikusa, an output prompt) are not reps: the count matches the Leave slip (d37)
    const withPrompt = snapshot(0);
    withPrompt.plan.steps.push({ ...step('d', `${V.犬}#rec`), id: 'd', cardKey: null });
    expect(snapshotStepsLeft(withPrompt)).toBe(3);
    mount('kata');
    await settle();
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('preroll');
  });

  it('with nothing due the plan is empty and the page says so calmly', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    mount('kata');
    await settle();
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('empty');
    expect(root.querySelector('.train__status')?.textContent).toBe('Nothing to train in this set right now. The dojo is open all the same.');
    expect(root.querySelector('.train__back')).not.toBeNull();
  });

  it('gate / shinsa / dan walk to their own rooms', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    expect(redirectFor('gate', 4)).toEqual({ name: 'gate', n: 4 });
    expect(redirectFor('shinsa', 4)).toEqual({ name: 'shinsa', belt: 'yellow' });
    expect(redirectFor('dan', 50)).toEqual({ name: 'dan' });
    expect(redirectFor('kata', 4)).toBeNull();
    mount('gate');
    expect(root.querySelector('.train')?.getAttribute('data-phase')).toBe('redirect');
    expect(route.value).toEqual({ name: 'gate', n: 4 });
  });

  it('the Kage route builds through buildKage (empty before anything is introduced)', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    mount('kage');
    await settle();
    expect(root.querySelector('.train')?.getAttribute('data-mode')).toBe('kage');
    expect(['empty', 'preroll']).toContain(root.querySelector('.train')?.getAttribute('data-phase'));
    expect(root.querySelector('.train__title')?.textContent).toBe('影 Kage');
  });
});

describe('mode titles', () => {
  it('wrap the Japanese half in lang="ja" and keep the joined text', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: dueCards() });
    registerExercise({ id: 'meaning-recall', facet: 'rec', needsTts: false, needsStt: false, selfGraded: false, timeable: true, keys: 'text' }, Stub);
    mount('kata');
    await settle();
    const title = root.querySelector('.train__title')!;
    expect(title.textContent).toBe('型 Kata');
    const ja = title.querySelector('[lang="ja"]');
    expect(ja?.textContent).toBe('型');
  });
});
