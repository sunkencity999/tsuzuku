import { render } from 'preact';
import { act } from 'preact/test-utils';
import { bus } from '@/shared/events';
import { href } from '@/shared/routes';
import type { DojoFeed, SessionSnapshot, Step } from '@/shared/session-types';
import { epochDay } from '@/shared/time';
import { resetStoreForTests, store } from '@/store';
import { forecastCounts } from '@/store/derived';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '@/store/testing';
// E's module, imported here only so the test can prove the injected fallback agrees with it (the page gets it through pages.ts).
import { SCROLL_BLOCK_MINUTES, gateForecast } from '@/session/dojo-feed';
import DojoPage, { dueLine, fallbackFeed, fallbackForecast, isFreshSave, stepsLeft, type Feed, type GateForecast } from './DojoPage';
import { S, fmt } from './strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROUTE = { name: 'dojo' } as const;

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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

/** A save that is clearly not a first run (one session, one day, some XP). */
const ACTIVE = { stats: { sessions: 3 }, streak: { totalDays: 12, current: 3, lastDay: TODAY }, profile: { xp: 500, level: 2 } };

function fullFeed(over: Partial<Feed> = {}): Feed {
  return {
    forecastLine: '42 reviews · 1 scroll · 1 episode · ~18 min',
    minutes: { kata: 3, kumite: 12, shugyo: 31 },
    nextMilestone: 'The Gatekeeper of Totsuka awaits in about 4 days.',
    welcome: 'none',
    due: 42,
    newItems: 8,
    scrolls: 1,
    episodes: 1,
    flame: 'lit',
    streak: { current: 3, totalDays: 12 },
    kage: { week: 2920, due: true, beatenThisWeek: false, best: 812, lastScore: 790, line: 'Your shadow runs the same set.' },
    nemesis: { count: 0, itemIds: [], line: null },
    gate: { station: 4, ready: true, cleared: false, introduced: 76, green: 70, total: 76 },
    shinsa: null,
    backlog: false,
    backlogLine: null,
    crammingCap: false,
    overtraining: false,
    proverb: '継続は力なり',
    sentenceOfDay: { ja: '水をください。', kana: 'みずをください。' },
    teaser: { sentence: { storyId: 's-04-1', ja: 'パンを???。', kana: 'ぱんをたべます。', maskedToken: 2 }, words: [{ itemId: 'v-n5-0001', kana: 'わたし' }], milestone: 'Totsuka in about 4 days.' },
    ...over,
  };
}

function step(i: number): Step {
  return { id: `s${i}`, block: 'reviews', exercise: 'meaning-guard', itemId: 'v-n5-0001', cardKey: 'v-n5-0001#rec', params: {}, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 8000 };
}

function snapshot(total: number, cursor: number): SessionSnapshot {
  const steps = Array.from({ length: total }, (_, i) => step(i));
  return {
    schema: 'tsuzuku.session/1',
    plan: { id: 'plan-1', mode: 'kumite', day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps, blocks: [], meta: { dueTotal: 10, dueTaken: 10, backlog: false, newCount: 0, scrollIds: [] } },
    cursor,
    results: [],
    kiai: { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] },
  };
}

async function mount(props: { feed?: (() => Promise<DojoFeed>) | null; Scene?: (() => null) | null; gate?: GateForecast | null } = {}): Promise<void> {
  await act(async () => {
    render(<DojoPage route={ROUTE} feed={props.feed ?? null} Scene={props.Scene ?? null} gate={props.gate ?? null} />, root);
    await tick();
    await tick();
  });
}

const text = (sel: string): string => root.querySelector(sel)?.textContent?.trim() ?? '';

describe('<DojoPage>', () => {
  it('renders the forecast line and the three quests from a test store', async () => {
    await makeTestStore({
      save: { ...ACTIVE, quests: { day: TODAY, ids: ['clear-due', 'learn-scroll', 'michikusa-one'], done: ['learn-scroll'] } },
    });
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    expect(text('[data-forecast]')).toBe('42 reviews · 1 scroll · 1 episode · ~18 min');
    const quests = Array.from(root.querySelectorAll('.dojo__quest'));
    expect(quests.length).toBe(3);
    expect(quests.map((q) => q.getAttribute('data-quest'))).toEqual(['clear-due', 'learn-scroll', 'michikusa-one']);
    expect(quests[0]?.textContent).toContain('Clear all due reviews');
    expect(quests[1]?.getAttribute('data-done')).toBe('true');
    expect(quests[1]?.textContent).toContain(S.dojoQuestDone);
    expect(quests[0]?.textContent).toContain(fmt(S.dojoQuestOf, { n: 0, target: 50 }));
    expect(root.querySelector('.dojo')?.getAttribute('data-feed')).toBe('ready');
  });

  it('Hanko buttons link to #/train/kata|kumite|shugyo with honest minute estimates', async () => {
    await makeTestStore({ save: ACTIVE });
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.dojo__session'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      href({ name: 'train', mode: 'kata' }),
      href({ name: 'train', mode: 'kumite' }),
      href({ name: 'train', mode: 'shugyo' }),
    ]);
    expect(links[0]?.textContent).toContain('~3 min');
    expect(links[1]?.textContent).toContain('~12 min');
    expect(links[2]?.textContent).toContain('~31 min');
    expect(links[0]?.textContent).toContain('42 due');
    expect(links[1]?.textContent).toContain(S.dojoScrollOne);
    expect(links[0]?.getAttribute('aria-label')).toBe(fmt(S.dojoStartSession, { name: S.dojoKata, n: 3 }));
  });

  it('shows Resume with the reps left when a snapshot exists, and Start fresh clears it', async () => {
    await makeTestStore({ save: ACTIVE });
    store.session.save(snapshot(10, 4));
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    const resume = root.querySelector<HTMLAnchorElement>('[data-resume]');
    expect(resume?.textContent).toBe(fmt(S.dojoResume, { n: 6 }));
    expect(resume?.getAttribute('href')).toBe(href({ name: 'train', mode: 'kumite' }));
    const fresh = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === S.dojoStartFresh);
    expect(fresh).toBeDefined();
    act(() => {
      fresh!.click();
    });
    expect(store.session.load()).toBeNull();
    expect(root.querySelector('[data-resume]')).toBeNull();
  });

  it('offers no Resume for a finished snapshot', async () => {
    await makeTestStore({ save: ACTIVE });
    store.session.save(snapshot(10, 10));
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('[data-resume]')).toBeNull();
    expect(stepsLeft(snapshot(10, 10))).toBe(0);
    expect(stepsLeft(null)).toBe(0);
  });

  it('shows the welcome-back banner when progress.welcomeBackDue', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { welcomeBackDue: true, awayDays: 40 } } });
    await mount({ feed: () => Promise.resolve(fullFeed({ welcome: 'comeback' })) });
    const banner = root.querySelector('[data-welcome="comeback"]');
    expect(banner?.textContent).toContain(S.dojoKept);
    expect(banner?.textContent).toContain(S.dojoWelcomeBack);
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'train', mode: 'welcome' }));
  });

  it('shows the mountain banner after a 7+ day absence without a Welcome Back set', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { welcomeBackDue: false, awayDays: 9 } } });
    await mount({ feed: () => Promise.resolve(fullFeed({ welcome: 'mountain' })) });
    const banner = root.querySelector('[data-welcome="mountain"]');
    expect(banner?.textContent).toContain(S.dojoMountain);
    expect(banner?.querySelector('a')).toBeNull();
  });

  it('renders the Kage strip, Gatekeeper banner, teaser, sentence of the day and proverb from the feed', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { station: 4 } } });
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    const kage = root.querySelector('.dojo__kage');
    expect(kage?.getAttribute('data-due')).toBe('true');
    expect(kage?.textContent).toContain(fmt(S.dojoKageBest, { n: '812' }));
    expect(kage?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'train', mode: 'kage' }));
    const gate = root.querySelector('[data-ready="true"]');
    expect(gate?.textContent).toContain('Hill Keeper');
    expect(gate?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'gate', n: 4 }));
    expect(text('.dojo__tategaki .tategaki')).toBe('水をください。');
    expect(root.querySelector('.dojo__word')?.textContent).toBe('わたし');
    expect(text('.dojo__proverb')).toBe('継続は力なり');
    expect(root.querySelector('[data-next-station]')?.getAttribute('href')).toBe(href({ name: 'station', n: 5 }));
  });

  it('degrades to the store forecast when the feed rejects, and the sessions still work', async () => {
    await makeTestStore({ save: ACTIVE, cards: { 'v-n5-0001#rec': card({ due: TODAY - 1, s: 3, state: 2 }), 'v-n5-0002#rec': card({ due: TODAY, s: 3, state: 2 }) } });
    await mount({ feed: () => Promise.reject(new Error('engine down')) });
    expect(root.querySelector('.dojo')?.getAttribute('data-feed')).toBe('failed');
    expect(text('[data-forecast]')).toBe(fallbackForecast(2, forecastCounts().minutes.kumite));
    expect(text('[data-forecast]')).toMatch(/^2 due · ~\d+ min$/);
    expect(root.textContent).toContain(S.dojoFeedFailed);
    expect(root.querySelectorAll('.dojo__session').length).toBe(3);
    expect(root.querySelector('.dojo__kage')).toBeNull();
  });

  it('with E’s gateForecast injected, the fallback forecast takes the Scroll block minutes off like the live feed does on a day without a Scroll', async () => {
    await makeTestStore({ save: ACTIVE, cards: { 'v-n5-0001#rec': card({ due: TODAY - 1, s: 3, state: 2 }), 'v-n5-0002#rec': card({ due: TODAY, s: 3, state: 2 }) } });
    const raw = forecastCounts();
    expect(raw.newItems).toBeGreaterThan(0); // a Standard-pace save has a new-item budget, so the raw estimate carries the Scroll block
    const gated = gateForecast(raw, 0);
    expect(gated.minutes.kumite).toBe(raw.minutes.kumite - SCROLL_BLOCK_MINUTES.kumite);
    expect(gated.minutes.shugyo).toBe(raw.minutes.shugyo - SCROLL_BLOCK_MINUTES.shugyo);
    expect(gated.minutes.kata).toBe(raw.minutes.kata);

    await mount({ feed: () => Promise.reject(new Error('engine down')), gate: gateForecast });
    expect(root.querySelector('.dojo')?.getAttribute('data-feed')).toBe('failed');
    expect(text('[data-forecast]')).toBe(fallbackForecast(2, gated.minutes.kumite));
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.dojo__session'));
    expect(links[1]?.textContent).toContain(fmt(S.dojoMinutes, { n: Math.max(1, Math.round(gated.minutes.kumite)) }));
    expect(links[2]?.textContent).toContain(fmt(S.dojoMinutes, { n: Math.max(1, Math.round(gated.minutes.shugyo)) }));
    expect(links[1]?.textContent).not.toContain(fmt(S.dojoMinutes, { n: raw.minutes.kumite }));

    // The pure helper says the same; without the gate the raw estimate stands (the session barrel is absent).
    expect(fallbackFeed(gateForecast).minutes).toEqual(gated.minutes);
    expect(fallbackFeed(null).minutes).toEqual(raw.minutes);
    expect(fallbackFeed(gateForecast).due).toBe(raw.due);
  });

  it('renders without a feed or scene at all', async () => {
    await makeTestStore({ save: ACTIVE });
    await mount();
    expect(root.querySelector('.dojo')?.getAttribute('data-feed')).toBe('none');
    expect(root.querySelectorAll('.dojo__session').length).toBe(3);
    expect(root.querySelector('.dojo__scene')).toBeNull();
  });

  it('mounts the injected scene', async () => {
    await makeTestStore({ save: ACTIVE });
    const Scene = (): null => null;
    await mount({ Scene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('.dojo__scene')).not.toBeNull();
  });

  it('first run: points to onboarding instead of the session buttons', async () => {
    await makeTestStore();
    expect(isFreshSave()).toBe(true);
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('[data-first-run]')?.getAttribute('href')).toBe(href({ name: 'onboarding' }));
    expect(root.querySelectorAll('.dojo__session').length).toBe(0);
  });

  it('flame line follows the streak state', async () => {
    await makeTestStore({ save: { ...ACTIVE, streak: { current: 0, totalDays: 12, lastDay: 0 } } });
    await mount();
    expect(root.querySelector('[data-flame]')?.getAttribute('data-flame')).toBe('broken');
    expect(root.textContent).toContain(S.flameBroken);
  });

  it('dueLine handles 0, 1 and many', () => {
    expect(dueLine(0)).toBe(S.dojoNoDue);
    expect(dueLine(1)).toBe(S.dojoDueOne);
    expect(dueLine(1234)).toBe('1,234 due');
  });
});

describe('<DojoPage> 茶屋ラジオ tile (design 08 §10.2)', () => {
  it('shows feed.radioMinutes under the session buttons, links to #/radio and says it is not a session', async () => {
    await makeTestStore({ save: ACTIVE });
    await mount({ feed: () => Promise.resolve(fullFeed({ radioMinutes: 23 })) });
    const tile = root.querySelector('[data-radio]');
    expect(tile).not.toBeNull();
    expect(tile?.querySelector('[data-radio-minutes]')?.textContent).toBe(fmt(S.dojoRadioMinutes, { n: 23 }));
    expect(tile?.textContent).toContain('23 min of material you can already follow');
    expect(tile?.querySelector('[data-radio-link]')?.getAttribute('href')).toBe(href({ name: 'radio' }));
    expect(tile?.textContent).toContain(S.dojoRadioNote);
    expect(S.dojoRadioNote).toBe('Not a session; it never counts as a training day.');
    expect(tile?.querySelector('h2 [lang="ja"]')?.textContent).toBe('茶屋ラジオ');
    expect(tile?.textContent).toContain(S.dojoRadioTitle);
    // Placed right after the session buttons, before the Three Kata.
    const sections = Array.from(root.querySelectorAll('section'));
    const sessionsAt = sections.findIndex((s) => s.getAttribute('aria-labelledby') === 'dojo-sessions');
    const radioAt = sections.findIndex((s) => s.hasAttribute('data-radio'));
    const questsAt = sections.findIndex((s) => s.getAttribute('aria-labelledby') === 'dojo-quests');
    expect(sessionsAt).toBeGreaterThanOrEqual(0);
    expect(radioAt).toBe(sessionsAt + 1);
    expect(questsAt).toBeGreaterThan(radioAt);
  });

  it('without a feed (or a feed without the count) the number is hidden but the link stays; a first run shows no tile', async () => {
    await makeTestStore({ save: ACTIVE });
    await mount();
    expect(root.querySelector('[data-radio]')).not.toBeNull();
    expect(root.querySelector('[data-radio-minutes]')).toBeNull();
    expect(root.querySelector('[data-radio-link]')?.getAttribute('href')).toBe('#/radio');
    expect(root.textContent).toContain(S.dojoRadioNote);

    render(null, root);
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('[data-radio-minutes]')).toBeNull();
    expect(root.querySelector('[data-radio-link]')).not.toBeNull();

    // E's feed says `null` when it cannot count (no pools loaded yet): same as no count.
    render(null, root);
    await mount({ feed: () => Promise.resolve(fullFeed({ radioMinutes: null })) });
    expect(root.querySelector('[data-radio-minutes]')).toBeNull();
    expect(root.querySelector('[data-radio-link]')).not.toBeNull();

    render(null, root);
    await mount({ feed: () => Promise.reject(new Error('engine down')) });
    expect(root.querySelector('[data-radio-minutes]')).toBeNull();
    expect(root.querySelector('[data-radio-link]')).not.toBeNull();

    render(null, root);
    resetStoreForTests();
    await makeTestStore();
    await mount({ feed: () => Promise.resolve(fullFeed({ radioMinutes: 5 })) });
    expect(root.querySelector('[data-first-run]')).not.toBeNull();
    expect(root.querySelector('[data-radio]')).toBeNull();
  });
});
