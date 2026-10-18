/**
 * KageView.tsx — versus header, factory + personal-best table, the Ghost Set run, result and free play; the Road strip.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE_IDS, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { SessionPlan, Step } from '../shared/session-types';
import { epochDay, weekOf } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import type { SessionRunner } from './runner';
import type { SessionViewComponent } from './ScrollView';
import { S as AS } from './arcade-strings';
import { fill } from './engine-strings';
import { HiScoreTable, KageStrip, KageView } from './KageView';
import { factoryRows, hiScoreTable } from './kage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const WEEK = weekOf(TODAY);
const loader = createFakeLoader();

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
});

const settle = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

const captured: { runner: SessionRunner | null } = { runner: null };
const Stub: SessionViewComponent = ({ runner }) => <div data-stub="view">{runner.step.value?.id ?? ''}</div>;
const text = (): string => root.textContent ?? '';
const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

function live(s: number): CardTuple {
  return card({ due: TODAY + 2, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

/** A hand-made Ghost Set over fixture vocab: 2 recent + 2 mature steps. */
function ghostPlan(): { plan: SessionPlan; cards: Record<CardKey, CardTuple> } {
  const ids = FIXTURE_IDS.vocab.filter((id) => id !== V.おはよう && id !== V.はい).slice(0, 4);
  const cards: Record<CardKey, CardTuple> = {};
  const steps: Step[] = ids.map((id, i) => {
    const mature = i >= 2;
    cards[`${id}#rec`] = live(mature ? 30 : 5);
    return {
      id: mature ? `kage:m:${i - 2}:meaning-recall` : `kage:r:${i}`,
      block: 'reviews',
      exercise: 'meaning-recall',
      itemId: id,
      cardKey: `${id}#rec`,
      params: { answer: 'x', accept: ['x'] },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 6,
      estMs: 6000,
    };
  });
  const plan: SessionPlan = {
    id: 'kage-test',
    mode: 'kage',
    day: TODAY,
    createdAt: DEFAULT_TEST_NOW,
    station: 4,
    steps,
    blocks: [{ kind: 'reviews', label: 'Kage Ghost Set', estMinutes: 1, stepIds: steps.map((s) => s.id) }],
    meta: { dueTotal: 0, dueTaken: 4, backlog: false, newCount: 0, scrollIds: [] },
  };
  return { plan, cards };
}

function answerAll(r: SessionRunner, correct = true): void {
  let guard = 0;
  while (!r.done.value && r.step.value && guard++ < 20) {
    act(() => {
      r.submit({ correct, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 4000, errorTags: [], answer: correct ? 'x' : 'nope' });
      r.next();
    });
  }
}

async function mount(plan?: SessionPlan): Promise<ReturnType<typeof vi.fn>> {
  const onExit = vi.fn();
  captured.runner = null;
  act(() =>
    render(
      <KageView
        onExit={onExit}
        loader={loader}
        available={() => true}
        view={Stub}
        plan={plan}
        onRunner={(r) => {
          captured.runner = r;
        }}
      />,
      root,
    ),
  );
  await settle();
  return onExit;
}

describe('<KageView> standing', () => {
  it('renders the versus header with your name, factory scores derived from the first run and the personal best', async () => {
    await makeTestStore({ save: { profile: { name: 'Hana' }, kage: { week: WEEK - 1, best4: [800, 950], wins: 1, history: [[WEEK - 2, 800], [WEEK - 1, 950]] } } });
    await mount();
    expect(root.querySelector('.kage-view')?.getAttribute('data-stage')).toBe('standing');
    // the poster (design 09 §5.6): a .poster-title head with the old title as its eyebrow; the digits roll (<Ticker roll>)
    const head = root.querySelector('.kage-view__title')!;
    expect(head.classList.contains('poster-title')).toBe(true);
    expect(head.textContent).toBe(AS.kagePoster);
    expect(root.querySelector('.kage-view__eyebrow')?.textContent).toBe('Versus your shadow');
    expect(root.querySelector('.kage-versus')?.classList.contains('halftone')).toBe(true);
    expect(root.querySelectorAll('.kage-digits .ticker[data-roll]').length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector('.kage-table')?.classList.contains('hiscore')).toBe(true);
    expect(root.querySelector('.kage-view__best')).toBeNull();
    expect(root.querySelector('.kage-versus__side--you .kage-versus__name')?.textContent).toBe('Hana');
    expect(root.querySelector('.kage-versus__side--kage .kage-digits--lg')?.textContent).toBe('950');
    expect(root.querySelector('.kage-versus__side--you .kage-digits--lg')?.textContent).toBe('950');
    const rows = Array.from(root.querySelectorAll('.kage-table tbody tr'));
    expect(rows.length).toBe(6);
    const real = rows.filter((r) => r.getAttribute('data-factory') === 'false');
    const factory = rows.filter((r) => r.getAttribute('data-factory') === 'true');
    expect(real).toHaveLength(2);
    expect(factory).toHaveLength(4);
    expect(real[0]?.textContent).toContain('YOU');
    expect(real[0]?.textContent).toContain('950');
    // factory rows are multiples of the first score (800): 880 カゲ leads, 800 ツヅ ties the first run
    expect(factory.some((r) => r.textContent?.includes('カゲ') && r.textContent?.includes('880'))).toBe(true);
    expect(factory.every((r) => r.textContent?.includes('Factory defaults'))).toBe(true);
    expect(text()).toContain('Your shadow runs the same set.');
    expect(root.querySelector('.hanko')?.textContent).toBe('Run the Ghost Set');
    expect(text()).not.toMatch(/hurry|last chance|\bbeat you\b/i);
  });

  it('before any run the table is empty and the shadow is introduced as you', async () => {
    await makeTestStore();
    await mount();
    expect(root.querySelectorAll('.kage-table tbody tr')).toHaveLength(0);
    expect(text()).toContain('First run. From here, the shadow is you.');
    expect(factoryRows(undefined)).toEqual([]);
  });

  it('after this week’s run the button is free play and says nothing is written', async () => {
    await makeTestStore({ save: { kage: { week: WEEK, best4: [700], wins: 0, history: [[WEEK, 700]] } } });
    await mount();
    expect(root.querySelector('.hanko')?.textContent).toBe('Free play');
    expect(text()).toContain('nothing is written');
  });
});

describe('<KageView> run', () => {
  it('runs the set, scores accuracy × speed, records the week and emits kage:result once', async () => {
    const { plan, cards } = ghostPlan();
    await makeTestStore({ save: { progress: { station: 4 }, medianMs: { 'meaning-recall': 4000 } }, cards });
    const cap = captureEvents();
    const onExit = await mount(plan);
    click(root.querySelector('.hanko'));
    await settle(2);
    expect(root.querySelector('.kage-view')?.getAttribute('data-stage')).toBe('run');
    expect(root.querySelector('[data-stub="view"]')).not.toBeNull();
    const r = captured.runner as SessionRunner;
    expect(r).not.toBeNull();
    answerAll(r, true);
    await settle(2);
    expect(root.querySelector('.kage-view')?.getAttribute('data-stage')).toBe('result');
    // 4/4 correct, mature median 4000 / observed 4000 → speed index 1 → 1000 points
    expect(root.querySelector('.kage-view__score .kage-digits')?.textContent).toBe('1,000');
    expect(root.querySelector('.kage-view__score .ticker[data-roll]')).not.toBeNull();
    expect(root.querySelector('.kage-view__title')?.classList.contains('poster-title')).toBe(true);
    // a first run has no own best to pass: no BEST eyebrow
    expect(root.querySelector('.kage-view__best')).toBeNull();
    expect(text()).toContain('Accuracy');
    expect(text()).toContain('100 percent');
    expect(text()).toContain('First run. From here, the shadow is you.');
    expect(text()).toContain('Counted for this week.');
    expect(store.kage.value.week).toBe(WEEK);
    expect(store.kage.value.history).toEqual([[WEEK, 1000]]);
    expect(cap.events.filter((e) => e[0] === 'kage:result')).toHaveLength(1);
    // the table now shows the run plus factory rows derived from it
    expect(root.querySelectorAll('.kage-table tbody tr[data-factory="false"]')).toHaveLength(1);
    expect(root.querySelectorAll('.kage-table tbody tr[data-factory="true"]').length).toBeGreaterThan(0);
    click(root.querySelector('.kage-view__actions .btn'));
    expect(onExit).toHaveBeenCalledTimes(1);
    cap.stop();
  });

  it('the BEST eyebrow names the learner’s OWN previous best when the run passes it, and never otherwise (footnote 5)', async () => {
    const { plan, cards } = ghostPlan();
    // own best of four weeks 600; a clean run scores 1000 → BEST · past your own 600
    await makeTestStore({ save: { progress: { station: 4 }, medianMs: { 'meaning-recall': 4000 }, kage: { week: WEEK - 1, best4: [600], wins: 0, history: [[WEEK - 1, 600]] } }, cards });
    await mount(plan);
    click(root.querySelector('.hanko'));
    await settle(2);
    answerAll(captured.runner as SessionRunner, true);
    await settle(2);
    expect(root.querySelector('.kage-view')?.getAttribute('data-beat')).toBe('true');
    expect(root.querySelector('.kage-view__best')?.textContent).toBe(fill(AS.kageBest, { n: 600 }));
    expect(text()).not.toContain('950');
    // a run below the own best: no eyebrow (never on a miss)
    act(() => render(null, root));
    await makeTestStore({ save: { progress: { station: 4 }, medianMs: { 'meaning-recall': 4000 }, kage: { week: WEEK - 1, best4: [900], wins: 0, history: [[WEEK - 1, 900]] } }, cards });
    await mount(plan);
    click(root.querySelector('.hanko'));
    await settle(2);
    answerAll(captured.runner as SessionRunner, false);
    await settle(2);
    expect(root.querySelector('.kage-view')?.getAttribute('data-stage')).toBe('result');
    expect(root.querySelector('.kage-view')?.getAttribute('data-beat')).toBe('false');
    expect(root.querySelector('.kage-view__best')).toBeNull();
  });

  it('a same-week second run is free play: nothing written, no event', async () => {
    const { plan, cards } = ghostPlan();
    await makeTestStore({ save: { progress: { station: 4 }, kage: { week: WEEK, best4: [600], wins: 0, history: [[WEEK, 600]] } }, cards });
    const cap = captureEvents();
    await mount(plan);
    click(root.querySelector('.hanko'));
    await settle(2);
    answerAll(captured.runner as SessionRunner, true);
    await settle(2);
    expect(text()).toContain('Free play; nothing written.');
    expect(store.kage.value.history).toEqual([[WEEK, 600]]);
    expect(cap.events.filter((e) => e[0] === 'kage:result')).toHaveLength(0);
    cap.stop();
  });
});

describe('<HiScoreTable> / <KageStrip>', () => {
  it('table rows carry rank, initials, score and label', async () => {
    await makeTestStore();
    const k = { week: WEEK - 1, best4: [500], wins: 0, history: [[WEEK - 1, 500] as [number, number]] };
    act(() => render(<HiScoreTable rows={hiScoreTable(k)} />, root));
    const first = root.querySelector('tbody tr');
    expect(first?.querySelectorAll('td')[0]?.textContent).toBe('1');
    expect(first?.textContent).toContain('550');
    expect(first?.textContent).toContain('カゲ');
    // below Green kana the katakana initials carry their romaji (design 09 §3.3)
    expect(first?.querySelector('.kage-table__romaji')?.textContent).toContain(AS.kageInitials['カゲ']);
    expect(first?.querySelector('[lang="ja"]')?.textContent).toBe('カゲ');
  });

  it('from Green kana the factory initials stand alone: no romaji in the table (design 09 §3.3)', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' } } });
    const k = { week: WEEK - 1, best4: [500], wins: 0, history: [[WEEK - 1, 500] as [number, number]] };
    act(() => render(<HiScoreTable rows={hiScoreTable(k)} />, root));
    expect(root.querySelector('.kage-table__romaji')).toBeNull();
    expect(root.textContent).toContain('カゲ');
    expect(root.textContent).not.toContain('Kage ');
  });

  it('the strip links to the kage session and shows due / best / last', async () => {
    await makeTestStore({ save: { kage: { week: WEEK - 1, best4: [900], wins: 0, history: [[WEEK - 1, 900]] } } });
    act(() => render(<KageStrip />, root));
    const a = root.querySelector('a.kage-strip') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('#/train/kage');
    expect(a.getAttribute('data-due')).toBe('true');
    expect(a.textContent).toContain('best 900');
    expect(a.textContent).toContain('last 900');
    // the lanes are .meters (design 09 §5.7): --value drives the fill, no width style
    const kage = a.querySelector('.kage-strip__lane--kage') as HTMLElement;
    expect(kage.classList.contains('meter')).toBe(true);
    expect(kage.style.getPropertyValue('--value')).toBe('1');
    expect(kage.querySelector('.meter__fill')).not.toBeNull();
    expect(a.querySelector('[style*="width"]')).toBeNull();
    expect(a.querySelectorAll('.kage-strip__lane-label')).toHaveLength(2);
  });
});
