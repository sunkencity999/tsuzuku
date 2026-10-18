import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { vi } from 'vitest';
import { DojoScene, durableFieldsOf, sceneInputs } from '@/art/dojo/DojoScene';
import { S as DOJO_S } from '@/art/dojo/strings';
import { bus } from '@/shared/events';
import { MOON_NAMES, koOf, loadKoyomi, moonPhase, resetKoyomiForTests, sekkiOf } from '@/shared/koyomi';
import { href } from '@/shared/routes';
import type { DojoFeed, SessionSnapshot, Step } from '@/shared/session-types';
import type { DailyRow, SceneSeen } from '@/shared/store-types';
import { epochDay } from '@/shared/time';
import { awayStatus, resetStoreForTests, store } from '@/store';
import { forecastCounts } from '@/store/derived';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '@/store/testing';
import { SANJO_OHASHI } from '@/content/types';
// E's module, imported here only so the test can prove the injected fallback agrees with it (the page gets it through pages.ts).
import { SCROLL_BLOCK_MINUTES, gateForecast } from '@/session/dojo-feed';
import DojoPage, {
  PHASE_WORD,
  dateLabel,
  dueLine,
  eraGloss,
  fallbackFeed,
  fallbackForecast,
  isFreshSave,
  kanjiNumeral,
  mountainLine,
  recommendedMode,
  stepsLeft,
  townNumbers,
  type Feed,
  type GateForecast,
  type SceneProps,
} from './DojoPage';
import { S, fmt } from './strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROUTE = { name: 'dojo' } as const;
const MOTION_CSS = readFileSync(resolve(process.cwd(), 'src/styles/motion.css'), 'utf8');
const PAGES_CSS = readFileSync(resolve(process.cwd(), 'src/app/pages/pages.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the first rule whose selector list contains `sel` (comments stripped). */
const ruleOf = (css: string, sel: string): string => {
  const at = css.indexOf(sel);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};
const KOYOMI = JSON.parse(readFileSync(resolve(process.cwd(), 'public/calendar/koyomi.json'), 'utf8')) as unknown;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  // the page fetches koyomi.json once after mount: pending by default (the first paint is romaji + English)
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => undefined)));
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetKoyomiForTests();
  bus.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-travel');
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

type SceneComponent = (p: SceneProps) => preact.JSX.Element | null;

async function mount(props: { feed?: (() => Promise<DojoFeed>) | null; Scene?: SceneComponent | null; gate?: GateForecast | null } = {}): Promise<void> {
  await act(async () => {
    render(<DojoPage route={ROUTE} feed={props.feed ?? null} Scene={props.Scene ?? null} gate={props.gate ?? null} />, root);
    await tick();
    await tick();
  });
}

const text = (sel: string): string => root.querySelector(sel)?.textContent?.trim() ?? '';
const hankos = (): number => root.querySelectorAll('.hanko').length;
const ROW: DailyRow = { reps: 10, ok: 8, minutes: 5, xp: 20, input: 0 };

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

  it('the three sessions link to #/train/kata|kumite|shugyo with honest minute estimates; the recommended one is the page’s only hanko, the others paper sheets with a seal corner', async () => {
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
    // an episode waits: Shugyō is recommended — the hanko; Kata and Kumite are .sheet tiles with the seal corner (design 09 §5.3)
    expect(links[2]?.classList.contains('hanko')).toBe(true);
    expect(links[2]?.getAttribute('data-recommended')).toBe('true');
    expect(links[2]?.textContent).toContain(S.dojoRecommended);
    // the accessible name carries the tag too (an aria-label hides the tile's content from AT)
    expect(links[2]?.getAttribute('aria-label')).toBe(`${fmt(S.dojoStartSession, { name: S.dojoShugyo, n: 31 })}${S.separator}${S.dojoRecommended}`);
    expect(links[0]?.classList.contains('sheet')).toBe(true);
    expect(links[1]?.classList.contains('sheet')).toBe(true);
    expect(links[0]?.querySelector('.seal.dojo__session-seal')?.textContent).toBe(S.dojoKataJa);
    expect(hankos()).toBe(1);
    // Gatekeeper ready: its call is a .btn, never a second hanko
    expect(root.querySelector('[data-ready="true"] a')?.classList.contains('btn')).toBe(true);
  });

  it('recommendedMode: Shugyō when an episode waits, Kumite when a Scroll does, Kata otherwise', () => {
    expect(recommendedMode(fullFeed())).toBe('shugyo');
    expect(recommendedMode(fullFeed({ episodes: 0 }))).toBe('kumite');
    expect(recommendedMode(fullFeed({ episodes: 0, scrolls: 0 }))).toBe('kata');
    expect(recommendedMode(fallbackFeed(null))).toBe('kata');
  });

  it('shows Resume with the reps left when a snapshot exists — the Resume is then the one hanko — and Start fresh clears it', async () => {
    await makeTestStore({ save: ACTIVE });
    store.session.save(snapshot(10, 4));
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    const resume = root.querySelector<HTMLAnchorElement>('[data-resume]');
    expect(resume?.textContent).toBe(fmt(S.dojoResume, { n: 6 }));
    expect(resume?.getAttribute('href')).toBe(href({ name: 'train', mode: 'kumite' }));
    expect(resume?.classList.contains('hanko')).toBe(true);
    expect(hankos()).toBe(1);
    expect(root.querySelectorAll('.dojo__session.sheet').length).toBe(3);
    const fresh = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === S.dojoStartFresh);
    expect(fresh).toBeDefined();
    await act(async () => {
      fresh!.click();
      await tick();
    });
    expect(store.session.load()).toBeNull();
    expect(root.querySelector('[data-resume]')).toBeNull();
    // the hanko moved back to the recommended session
    expect(hankos()).toBe(1);
    expect(root.querySelector('.dojo__session.hanko')?.getAttribute('data-mode')).toBe('shugyo');
  });

  it('offers no Resume for a finished snapshot', async () => {
    await makeTestStore({ save: ACTIVE });
    store.session.save(snapshot(10, 10));
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('[data-resume]')).toBeNull();
    expect(stepsLeft(snapshot(10, 10))).toBe(0);
    expect(stepsLeft(null)).toBe(0);
  });

  it('shows the welcome-back banner when progress.welcomeBackDue; the Welcome Back set is the one hanko', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { welcomeBackDue: true, awayDays: 40 } } });
    await mount({ feed: () => Promise.resolve(fullFeed({ welcome: 'comeback' })) });
    const banner = root.querySelector('[data-welcome="comeback"]');
    expect(banner?.textContent).toContain(S.dojoKept);
    expect(banner?.textContent).toContain(S.dojoWelcomeBack);
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'train', mode: 'welcome' }));
    expect(banner?.querySelector('a')?.classList.contains('hanko')).toBe(true);
    expect(hankos()).toBe(1);
    expect(banner?.textContent).not.toContain('40');
  });

  it('the mountain card: the generic line when only the roll’s awayDays is known, the honest spread from awayStatus() when the rows show it — the absence length is never printed', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { welcomeBackDue: false, awayDays: 9 } } });
    await mount({ feed: () => Promise.resolve(fullFeed({ welcome: 'mountain' })) });
    const banner = root.querySelector('[data-welcome="mountain"]');
    expect(banner?.textContent).toContain(S.dojoMountain);
    expect(banner?.querySelector('a')).toBeNull();
    expect(banner?.textContent).not.toContain('9');

    // the design's line, verbatim (design 09 §8), from the status the task names
    expect(mountainLine({ awayDays: 9, returnedDaysAgo: 1, newPaused: true, spreadDaysLeft: 5 })).toBe('The dojo kept your place. Day 2 back · 5 spread days left · new items return tomorrow.');
    expect(mountainLine({ awayDays: 12, returnedDaysAgo: 0, newPaused: true, spreadDaysLeft: 7 })).toBe('The dojo kept your place. Day 1 back · 7 spread days left · new items pause for two days.');
    expect(mountainLine({ awayDays: 12, returnedDaysAgo: 6, newPaused: false, spreadDaysLeft: 1 })).toBe('The dojo kept your place. Day 7 back · 1 spread day left · new items are back.');

    // rendered from the rows: trained yesterday, seven missed days before that, trained before them
    render(null, root);
    resetStoreForTests();
    const daily: Record<number, DailyRow> = { [TODAY - 1]: ROW, [TODAY - 9]: ROW };
    await makeTestStore({ save: { ...ACTIVE, progress: { welcomeBackDue: false, awayDays: 7 }, daily } });
    const away = awayStatus(daily, TODAY);
    expect(away).toEqual({ awayDays: 7, returnedDaysAgo: 1, newPaused: true, spreadDaysLeft: 6 });
    await mount({ feed: () => Promise.resolve(fullFeed({ welcome: 'mountain' })) });
    const card2 = root.querySelector('[data-welcome="mountain"]')!;
    expect(card2.textContent?.trim()).toBe(mountainLine(away));
    expect(card2.textContent).toContain('Day 2 back');
    expect(card2.textContent).toContain('6 spread days left');
    expect(card2.textContent).toContain('new items return tomorrow');
    expect(card2.textContent).not.toMatch(/\b7\b/); // the seven missed days are never printed
  });

  it('renders the Kage strip, Gatekeeper banner, teaser, the sentence of the day in the column, the proverb off Mincho, and the next-station link to the station being walked', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { station: 4 } } });
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    const kage = root.querySelector('.dojo__kage');
    expect(kage?.getAttribute('data-due')).toBe('true');
    expect(kage?.textContent).toContain(fmt(S.dojoKageBest, { n: '812' }));
    expect(kage?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'train', mode: 'kage' }));
    const gate = root.querySelector('[data-ready="true"]');
    expect(gate?.textContent).toContain('Hill Keeper');
    expect(gate?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'gate', n: 4 }));
    expect(text('[data-col="sentence"] [lang="ja"]')).toBe('水をください。');
    expect(root.querySelector('[data-col="greeting"]')).toBeNull();
    expect(root.querySelector('.dojo__word')?.textContent).toBe('わたし');
    expect(text('.dojo__proverb')).toBe('継続は力なり');
    // the proverb's label is visible (an eyebrow), not an aria-label on a role-less element
    expect(root.querySelector('.dojo__proverb-line .eyebrow')?.textContent).toBe(S.dojoProverb);
    expect(root.querySelector('.dojo__proverb')?.hasAttribute('aria-label')).toBe(false);
    // the status line's station kanji carries its reading
    expect(root.querySelector('.dojo__status')?.textContent).toContain('Hodogaya');
    // the sentence's label is a hidden prefix, never an aria-label on a span
    expect(root.querySelector('[data-col="sentence"]')?.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector('[data-col="sentence"] .visually-hidden')?.textContent).toBe(S.dojoSentenceOfDay);
    // design 09 §10 B1: the off-by-one is fixed — Station 4 is the one ahead, not 5
    expect(root.querySelector('[data-next-station]')?.getAttribute('href')).toBe(href({ name: 'station', n: 4 }));
    expect(text('[data-next-station]')).toContain(fmt(S.dojoStationLink, { n: 4, name: 'Hodogaya' }));
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
    // no feed extras: Kata is the hanko; the column shows the greeting triple, never the teaser or the proverb
    expect(root.querySelector('.dojo__session.hanko')?.getAttribute('data-mode')).toBe('kata');
    expect(text('[data-col="greeting"] [lang="ja"]')).toBe(S.columnGreetingJa);
    expect(text('[data-col="greeting"]')).toContain(S.columnGreetingRomaji);
    expect(text('[data-col="greeting"]')).toContain(S.columnGreetingEn);
    expect(hankos()).toBe(1);
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
    expect(root.querySelector('.tategaki-column')).not.toBeNull();
  });

  it('mounts the injected scene with the compact and arrival props', async () => {
    await makeTestStore({ save: ACTIVE });
    const seen: SceneProps[] = [];
    const Scene: SceneComponent = (p) => {
      seen.push(p);
      return null;
    };
    await mount({ Scene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('.dojo__scene')).not.toBeNull();
    expect(seen[0]).toEqual({ compact: false, arrival: true });
  });

  it('first run: points to onboarding instead of the session tiles — the Begin hanko is the only one; no column, no arrival', async () => {
    await makeTestStore();
    expect(isFreshSave()).toBe(true);
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('[data-first-run]')?.getAttribute('href')).toBe(href({ name: 'onboarding' }));
    expect(root.querySelectorAll('.dojo__session').length).toBe(0);
    expect(hankos()).toBe(1);
    expect(root.querySelector('.tategaki-column')).toBeNull();
    expect(root.querySelector('.dojo')?.hasAttribute('data-arrival')).toBe(false);
    expect(root.querySelector('.shoji')).toBeNull();
    expect(store.progress.value.arrivedDay).toBeUndefined();
  });

  it('the flame line follows the streak state through one drawn lantern with its word; the never-lit hearth says Unlit (design 09 §7 A)', async () => {
    await makeTestStore({ save: { ...ACTIVE, streak: { current: 0, totalDays: 12, lastDay: 0 } } });
    await mount();
    expect(root.querySelector('[data-flame]')?.getAttribute('data-flame')).toBe('broken');
    expect(root.textContent).toContain(S.flameBroken);
    expect(root.querySelector('.dojo__status .lantern')?.getAttribute('data-state')).toBe('broken');
    expect(root.querySelector('.dojo__status .lantern__word')?.textContent).toBe(S.flameWordBroken);
    expect(root.querySelector('.dojo__status .flame__glyph')).toBeNull();
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { stats: { sessions: 1 }, profile: { xp: 10 }, streak: { current: 0, totalDays: 0, lastDay: 0 } } });
    await mount();
    expect(root.querySelector('.dojo__status .lantern')?.getAttribute('data-state')).toBe('unlit');
    expect(root.querySelector('.dojo__status .lantern__word')?.textContent).toBe(S.flameWordUnlit);
    expect(root.querySelector('[data-flame]')?.textContent).toBe(S.flameUnlit);
    expect(root.textContent).not.toContain(S.flameBroken);
  });

  it('dueLine handles 0, 1 and many', () => {
    expect(dueLine(0)).toBe(S.dojoNoDue);
    expect(dueLine(1)).toBe(S.dojoDueOne);
    expect(dueLine(1234)).toBe('1,234 due');
  });
});

describe('<DojoPage> Hiraku — the arrival (design 09 §7 A)', () => {
  /** A `sceneSeen` one lantern behind today's picture (level 20 → 2 lanterns; seen at 10 → 1). */
  async function storeOneLanternBehind(extra: Record<string, unknown> = {}): Promise<SceneSeen> {
    await makeTestStore({ save: { ...ACTIVE, profile: { ...ACTIVE.profile, level: 20 }, ...extra } });
    const seen: SceneSeen = { ...durableFieldsOf(sceneInputs()), level: 10 };
    store.patch('progress', (p) => ({ ...p, sceneSeen: seen }));
    return seen;
  }

  it('plays once a day: the shōji (aria-hidden, pointer-events: none), the phase word, since yesterday on the scene, arrivedDay written; a second render the same day plays nothing and patches nothing', async () => {
    await storeOneLanternBehind();
    expect(store.progress.value.arrivedDay).toBeUndefined();
    await mount({ Scene: DojoScene, feed: () => Promise.resolve(fullFeed()) });
    const page = root.querySelector('.dojo')!;
    expect(page.hasAttribute('data-arrival')).toBe(true);
    // the panels: aria-hidden, the class whose rule never blocks input
    const shoji = root.querySelector('.shoji')!;
    expect(shoji).not.toBeNull();
    expect(shoji.getAttribute('aria-hidden')).toBe('true');
    const rule = /\.shoji\s*\{([^}]*)\}/.exec(MOTION_CSS)?.[1] ?? '';
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).toMatch(/position:\s*fixed/);
    // the phase word: 12:00 UTC → day → 昼 hiru · day, reading and English visible
    const word = root.querySelector('.dojo__phase')!;
    expect(word.getAttribute('data-phase')).toBe('day');
    expect(word.querySelector('[lang="ja"]')?.textContent).toBe(PHASE_WORD.day.ja);
    expect(word.textContent).toContain(PHASE_WORD.day.reading);
    expect(word.textContent).toContain(PHASE_WORD.day.en);
    expect(word.classList.contains('ink-nijimi')).toBe(true);
    // since yesterday: the caption and data-since on the scene's wrapper
    expect(root.querySelector('.dojo-scene__art')?.getAttribute('data-since')).toBe('lantern');
    expect(text('.dojo-scene__since')).toBe(`${DOJO_S.sinceYesterday} ${DOJO_S.sinceLantern}`);
    // the arrival is recorded once, with the picture as seen
    expect(store.progress.value.arrivedDay).toBe(TODAY);
    expect(store.progress.value.sceneSeen?.level).toBe(20);
    // the forecast and the hanko bleed in
    expect(root.querySelector('.dojo__status')?.classList.contains('ink-nijimi')).toBe(true);
    expect(root.querySelector('.dojo__session.hanko')?.classList.contains('ink-nijimi')).toBe(true);
    expect(hankos()).toBe(1);
    // paper, then ink, then text (§6.3): every entrance is delayed past the panels' part (motion.css: --dur-4 × ⅔)
    expect(ruleOf(MOTION_CSS, '.shoji::after {')).toMatch(/transition:\s*translate calc\(var\(--dur-4\) \* 2 \/ 3\)/);
    // (the word's kasure exit is excluded: a delayed exit would outlive the safety unmount)
    const early = ruleOf(PAGES_CSS, '.dojo[data-arrival]:not([data-reduced]) :is(.dojo__phase.ink-nijimi:not([data-leaving]), .tategaki-column > *)');
    expect(early).toMatch(/animation-delay:\s*calc\(var\(--dur-4\) \* 2 \/ 3 \+ min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
    const late = ruleOf(PAGES_CSS, '.dojo[data-arrival]:not([data-reduced]) :is(.dojo__status, .dojo__session).ink-nijimi');
    expect(late).toMatch(/animation-delay:\s*calc\(var\(--dur-4\) \* 4 \/ 3 \+ min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
    // the word (--i 0) leads the column by one stagger; the forecast and hanko carry their own indices
    expect(root.querySelector<HTMLElement>('[data-col="sekki"]')?.style.getPropertyValue('--i')).toBe('1');
    expect(root.querySelector<HTMLElement>('.dojo__status')?.style.getPropertyValue('--i')).toBe('1');
    // the word is out of flow over the stage (nothing shifts when it leaves) and never a hit target
    expect(word.parentElement?.classList.contains('dojo__stage')).toBe(true);
    const phaseRule = ruleOf(PAGES_CSS, '.dojo__phase {');
    expect(phaseRule).toMatch(/position:\s*absolute/);
    expect(phaseRule).toMatch(/pointer-events:\s*none/);
    expect(phaseRule).toMatch(/transition:\s*opacity var\(--dur-fade\)/);
    expect(ruleOf(PAGES_CSS, '.dojo__stage {')).toMatch(/position:\s*relative/);
    // the wet seal rests while the scene's pulse twins hold the two live filters (≤ 2 per viewport, §6.7)
    expect(ruleOf(PAGES_CSS, '.dojo__stage:has([data-pulsing]) .ink-wet::after')).toMatch(/filter:\s*none/);

    // the same day again: no arrival, no panels, no phase word, and the progress slice is untouched
    render(null, root);
    const before = store.progress.value;
    await mount({ Scene: DojoScene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('.dojo')?.hasAttribute('data-arrival')).toBe(false);
    expect(root.querySelector('.shoji')).toBeNull();
    expect(root.querySelector('.dojo__phase')).toBeNull();
    expect(root.querySelector('.dojo-scene__art')?.hasAttribute('data-since')).toBe(false);
    expect(root.querySelector('.dojo-scene__since')).toBeNull();
    expect(store.progress.value).toBe(before);
    expect(root.querySelector('.ink-nijimi')).toBeNull();
  });

  it('reduced motion: no .ink-* class anywhere (a pressed seal and a done tick render dry), the changed part carries the static gold ring, the captions are identical', async () => {
    await storeOneLanternBehind({ settings: { reducedMotion: true }, daily: { [TODAY]: ROW }, quests: { day: TODAY, ids: ['clear-due', 'learn-scroll', 'michikusa-one'], done: ['clear-due'] } });
    await mount({ Scene: DojoScene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('.dojo')?.hasAttribute('data-arrival')).toBe(true);
    expect(root.querySelector('.dojo')?.hasAttribute('data-reduced')).toBe(true);
    expect(root.querySelector('[data-seal]')).not.toBeNull();
    expect(root.querySelector('[data-quest="clear-due"]')?.getAttribute('data-wet')).toBe('wet');
    expect(Array.from(root.querySelectorAll('[class]')).some((el) => /(^|\s)ink-/.test(el.getAttribute('class') ?? ''))).toBe(false);
    expect(root.innerHTML).not.toMatch(/class="[^"]*\bink-/);
    // the hearth is written at once (no held class), the word leaves under --dur-fade (.rm-fade)
    expect(root.querySelector('.dojo-scene__art')?.hasAttribute('data-hearth-held')).toBe(false);
    expect(root.querySelector('.dojo__phase')?.classList.contains('rm-fade')).toBe(true);
    expect(ruleOf(PAGES_CSS, '.dojo__phase.rm-fade[data-leaving]')).toMatch(/opacity:\s*0/);
    const ring = root.querySelector('.room__ring');
    expect(ring?.getAttribute('data-ring')).toBe('lantern');
    expect(ring?.getAttribute('stroke-width')).toBe('1');
    expect(root.querySelector('.dojo-scene__art')?.getAttribute('data-since')).toBe('lantern');
    expect(text('.dojo-scene__since')).toBe(`${DOJO_S.sinceYesterday} ${DOJO_S.sinceLantern}`);
    // the panels still mount (motion.css fades them at --dur-fade) and the phase word still shows
    expect(root.querySelector('.shoji')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.dojo__phase')?.classList.contains('ink-nijimi')).toBe(false);
    expect(text('.dojo__phase')).toContain(PHASE_WORD.day.reading);
  });

  it('the phase word waits for the panels: its two seconds start when the shōji is gone, and it stays behind the panels until then', async () => {
    vi.useFakeTimers();
    await makeTestStore({ save: ACTIVE });
    act(() => render(<DojoPage route={ROUTE} feed={null} Scene={null} gate={null} />, root));
    expect(root.querySelector('.shoji')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.dojo__phase')?.style.getPropertyValue('--i')).toBe('');
    // no transitionend in jsdom: the safety timer takes the panels down at 1 s, and only then do the word's two seconds start
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + 10);
    });
    expect(root.querySelector('.shoji')).toBeNull();
    expect(root.querySelector('.dojo__phase')).not.toBeNull();
    // 2.5 s after the mount — past a timer that had started at mount — the word is still there
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(root.querySelector('.dojo__phase')?.hasAttribute('data-leaving')).toBe(false);
    // two seconds after the panels went: it turns to leave
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(root.querySelector('.dojo__phase')?.hasAttribute('data-leaving')).toBe(true);
  });

  it('entered from a session (html[data-travel="out"], §7 C Kadode): no panels and no word — that return has its own shōji — but the arrival still records the day, the column enters, and today’s done ticks press once, 40 ms apart', async () => {
    document.documentElement.setAttribute('data-travel', 'out');
    await storeOneLanternBehind({ daily: { [TODAY]: ROW }, quests: { day: TODAY, ids: ['clear-due', 'learn-scroll', 'michikusa-one'], done: ['clear-due', 'learn-scroll'] } });
    await mount({ Scene: DojoScene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('.dojo')?.hasAttribute('data-arrival')).toBe(true);
    expect(root.querySelector('.shoji')).toBeNull();
    expect(root.querySelector('.dojo__phase')).toBeNull();
    expect(store.progress.value.arrivedDay).toBe(TODAY);
    expect(root.querySelector('.dojo-scene__art')?.getAttribute('data-since')).toBe('lantern');
    expect(root.querySelector('.dojo__status')?.classList.contains('ink-nijimi')).toBe(true);
    const pressed = Array.from(root.querySelectorAll<HTMLElement>('.dojo__quest .ink-osu'));
    expect(pressed.length).toBe(2);
    expect(pressed.map((el) => el.style.getPropertyValue('--i'))).toEqual(['0', '1']);
    expect(root.querySelector('[data-quest="michikusa-one"] .ink-osu')).toBeNull();
    expect(ruleOf(PAGES_CSS, '.dojo__quest-wet.ink-osu {')).toMatch(/animation-delay:\s*calc\(var\(--dur-4\) \+ min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
    // the latest tick is still the one wet layer
    expect(root.querySelectorAll('.dojo__quest .ink-wet').length).toBe(1);
    expect(root.querySelector('[data-quest="learn-scroll"] .ink-wet.ink-osu')).not.toBeNull();
    // a plain visit presses nothing
    render(null, root);
    document.documentElement.removeAttribute('data-travel');
    await mount({ Scene: DojoScene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelectorAll('.ink-osu').length).toBe(0);
  });

  it('any key or tap skips the shōji to its end state, and the phase word leaves after two seconds', async () => {
    vi.useFakeTimers();
    await makeTestStore({ save: ACTIVE });
    act(() => render(<DojoPage route={ROUTE} feed={null} Scene={null} gate={null} />, root));
    expect(root.querySelector('.shoji')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(root.querySelector('.shoji')).toBeNull();
    expect(root.querySelector('.dojo__phase')).not.toBeNull();
    // two seconds: the word turns to leave (kasure); act flushes the effect that arms the exit's safety timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 + 10);
    });
    expect(root.querySelector('.dojo__phase')?.hasAttribute('data-leaving')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400 + 10);
    });
    expect(root.querySelector('.dojo__phase')).toBeNull();
  });

  it('never names a gap on the arrival surface: no absent-day count, the hearth of a day-one save says Unlit', async () => {
    await makeTestStore({ save: { stats: { sessions: 1 }, profile: { xp: 10 }, streak: { totalDays: 0 }, progress: { awayDays: 0 } } });
    await mount({ Scene: DojoScene, feed: () => Promise.resolve(fullFeed()) });
    expect(root.querySelector('[data-hotspot="hearth"]')?.getAttribute('aria-label')).toContain(DOJO_S.hearthNeverLit);
    expect(root.querySelector('[data-flame]')?.textContent).toBe(S.flameUnlit);
    expect(root.querySelector('[data-welcome]')).toBeNull();
    for (const el of Array.from(root.querySelectorAll('.dojo-scene__since, .dojo__phase, [data-welcome]'))) expect(el.textContent).not.toMatch(/\d/);
  });
});

describe('<DojoPage> the tategaki column (design 09 §3.3, §5.9)', () => {
  it('shows romaji + English for the sekki, kō and moon before koyomi.json loads, and the Japanese after loadKoyomi(); the kō and the sekki carry dates, never "in N days"', async () => {
    await makeTestStore({ save: ACTIVE });
    await mount({ feed: () => Promise.resolve(fullFeed()) });
    const col = root.querySelector('.tategaki-column')!;
    expect(col.getAttribute('data-koyomi')).toBe('pending');
    const sekki = sekkiOf(TODAY);
    expect(sekki.id).toBe('shoukan');
    const sekkiEl = col.querySelector('[data-col="sekki"]')!;
    expect(sekkiEl.querySelector('[lang="ja"]')).toBeNull();
    expect(sekkiEl.textContent).toContain(sekki.romaji);
    expect(sekkiEl.textContent).toContain(sekki.en);
    expect(sekkiEl.textContent).toContain(fmt(S.dojoColumnFrom, { date: 'Jan 6' }));
    expect(sekkiEl.textContent).not.toMatch(/in \d+ days/);
    const koEl = col.querySelector('[data-col="ko"]')!;
    expect(koEl.querySelector('[lang="ja"]')).toBeNull();
    const ko = koOf(TODAY, null);
    expect(koEl.textContent).toContain(fmt(S.dojoColumnKoStep, { n: ko.step + 1 }));
    expect(koEl.textContent).toContain(fmt(S.dojoColumnFrom, { date: dateLabel(ko.fromDay) }));
    const moon = moonPhase(TODAY);
    const moonEl = col.querySelector('[data-col="moon"]')!;
    expect(moonEl.querySelector('[lang="ja"]')).toBeNull();
    expect(moonEl.textContent).toContain(MOON_NAMES[moon.name].romaji);
    expect(moonEl.textContent).toContain(MOON_NAMES[moon.name].en);
    // the page asked for the data once, after mount — never at boot
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0])).toContain('calendar/koyomi.json');

    // the data lands: the Japanese names appear, each still beside its romaji and English
    const data = loadKoyomi(KOYOMI);
    await act(async () => {
      store.patch('settings', (s) => ({ ...s }));
      await tick();
    });
    expect(col.getAttribute('data-koyomi')).toBe('loaded');
    expect(col.querySelector('[data-col="sekki"] [lang="ja"]')?.textContent).toBe(data.sekki.shoukan);
    expect(col.querySelector('[data-col="sekki"]')?.textContent).toContain(sekki.romaji);
    const named = koOf(TODAY, data);
    expect(col.querySelector('[data-col="ko"] [lang="ja"]')?.textContent).toBe(named.ja);
    expect(col.querySelector('[data-col="ko"] [lang="ja"]')?.classList.contains('dojo__col-ja--ko')).toBe(true);
    expect(col.querySelector('[data-col="ko"]')?.textContent).toContain(named.romaji!);
    expect(col.querySelector('[data-col="ko"]')?.textContent).toContain(named.en!);
    expect(col.querySelector('[data-col="moon"] [lang="ja"]')?.textContent).toBe(data.moon[moon.name]);
    expect(col.querySelector('[data-col="moon"]')?.textContent).toContain(MOON_NAMES[moon.name].romaji);
    // the foot: the era date with Arabic digits upright and its Latin gloss
    const era = col.querySelector('[data-col="era"]')!;
    expect(era.querySelector('[lang="ja"]')?.textContent).toBe('令和8年1月15日');
    expect(Array.from(era.querySelectorAll('.tategaki-column__tcy')).map((e) => e.textContent)).toEqual(['8', '1', '15']);
    expect(era.textContent).toContain('Reiwa 8 · Jan 15');
    expect(eraGloss(TODAY)).toBe('Reiwa 8 · Jan 15');
    // the honesty label is a visible line of the column (never a tooltip), and the kō fallback carries its English word
    const note = col.querySelector('[data-col="note"]')!;
    expect(note.textContent).toBe(S.dojoColumnNote);
    expect(note.classList.contains('visually-hidden')).toBe(false);
    expect(col.querySelector('[title]')).toBeNull();
    expect(S.dojoColumnKoStep).toContain('micro-season');
    // the column and the forecast window are two landmarks with two names
    expect(col.getAttribute('aria-label')).not.toBe(S.dojoForecast);
    expect(col.getAttribute('aria-label')).toBe(S.dojoColumnLabel);
  });

  it('the fetched data re-renders the column when it resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => KOYOMI })));
    await makeTestStore({ save: ACTIVE });
    await mount();
    // the mount effect fires at the end of act; the resolved fetch re-renders on the next tick
    await act(async () => {
      await tick();
    });
    expect(root.querySelector('.tategaki-column')?.getAttribute('data-koyomi')).toBe('loaded');
    expect(root.querySelector('[data-col="sekki"] [lang="ja"]')?.textContent).toBe('小寒');
  });

  it('today’s seal is pressed only when today has a session: kanji numerals with the "Jan 15" label, wet until the roll', async () => {
    await makeTestStore({ save: ACTIVE });
    await mount();
    expect(root.querySelector('[data-seal]')).toBeNull();
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { ...ACTIVE, daily: { [TODAY]: ROW } } });
    await mount();
    const seal = root.querySelector('[data-seal]')!;
    expect(seal.classList.contains('seal-date')).toBe(true);
    // the wet layer sits on the disc only: the pixel label beneath is outside it and stays legible
    const disc = seal.querySelector('.seal-date__day')!;
    expect(seal.classList.contains('ink-wet')).toBe(false);
    expect(disc.classList.contains('ink-wet')).toBe(true);
    expect(disc.classList.contains('is-dry')).toBe(false);
    expect(seal.querySelector('.seal-date__label')?.closest('.ink-wet')).toBeNull();
    expect(disc.textContent).toBe('十五日');
    expect(seal.querySelector('.seal-date__label')?.textContent).toBe('Jan 15');
    expect(seal.getAttribute('aria-label')).toBe(fmt(S.dojoSealLabel, { date: 'Jan 15' }));
    // the shared wet-ink def is on the page once
    expect(root.querySelectorAll('#ink-bleed-8').length).toBe(1);
    expect(root.querySelector('#ink-bleed-8 feDisplacementMap')?.getAttribute('scale')).toBe('8');
    // the roll dries it
    await act(async () => {
      bus.emit('day:rolled', { day: TODAY + 1, awayDays: 0 });
      await tick();
    });
    expect(root.querySelector('[data-seal] .seal-date__day')?.classList.contains('is-dry')).toBe(true);
  });

  it('kanji numerals, date labels and the station ordinal', () => {
    expect(kanjiNumeral(1)).toBe('一');
    expect(kanjiNumeral(10)).toBe('十');
    expect(kanjiNumeral(15)).toBe('十五');
    expect(kanjiNumeral(20)).toBe('二十');
    expect(kanjiNumeral(31)).toBe('三十一');
    expect(kanjiNumeral(53)).toBe('五十三');
    expect(kanjiNumeral(0)).toBe('〇');
    expect(dateLabel(TODAY)).toBe('Jan 15');
    expect(dateLabel(TODAY + 290)).toBe('Nov 1');
  });
});

describe('<DojoPage> quests, genkan and the road', () => {
  it('a done Kata tick is wet ink (the latest done one carries the bleed) until the roll; wet layers on the page never exceed two', async () => {
    await makeTestStore({ save: { ...ACTIVE, daily: { [TODAY]: ROW }, quests: { day: TODAY, ids: ['clear-due', 'learn-scroll', 'michikusa-one'], done: ['clear-due', 'learn-scroll'] } } });
    await mount();
    const wet = root.querySelectorAll('.dojo__quest .ink-wet');
    expect(wet.length).toBe(1);
    expect(root.querySelector('[data-quest="learn-scroll"]')?.getAttribute('data-wet')).toBe('wet');
    expect(root.querySelector('[data-quest="clear-due"]')?.hasAttribute('data-wet')).toBe(false);
    expect(root.querySelectorAll('.ink-wet').length).toBeLessThanOrEqual(2); // the seal and one tick: ≤ 2 live inkBleed filters (design 09 §5.3)
    await act(async () => {
      bus.emit('day:rolled', { day: TODAY + 1, awayDays: 0 });
      await tick();
    });
    expect(root.querySelector('[data-quest="learn-scroll"] .ink-wet')?.classList.contains('is-dry')).toBe(true);
    expect(root.querySelector('[data-quest="learn-scroll"]')?.getAttribute('data-wet')).toBe('dry');
  });

  it('the genkan strip: three .sign plates with the current station in the middle, every town with its reading and ordinal; towns ahead are "ahead", never locked', async () => {
    await makeTestStore({ save: { ...ACTIVE, progress: { station: 4 } } });
    await mount();
    const towns = Array.from(root.querySelectorAll('.dojo__town'));
    expect(towns.map((t) => t.getAttribute('data-town'))).toEqual(['3', '4', '5']);
    expect(towns.map((t) => t.getAttribute('data-state'))).toEqual(['passed', 'here', 'ahead']);
    expect(towns[1]?.getAttribute('aria-current')).toBe('step');
    expect(towns[0]?.hasAttribute('aria-current')).toBe(false);
    const here = towns[1]!;
    expect(here.querySelector('.sign')).not.toBeNull();
    expect(here.querySelector('.sign__number')?.textContent).toBe('4');
    expect(here.querySelector('.sign__ordinal')?.textContent).toBe('第四宿');
    expect(here.querySelector('.sign__ja')?.textContent).toBe('保土ヶ谷');
    expect(here.querySelector('.sign__reading')?.textContent).toBe('Hodogaya');
    expect(here.querySelector('.sign__en')?.textContent).toBe(S.dojoTownHere);
    expect(towns[2]?.querySelector('.sign__en')?.textContent).toBe(S.dojoTownAhead);
    expect(towns[2]?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'station', n: 5 }));
    expect(root.textContent?.toLowerCase()).not.toContain('locked');
    expect(townNumbers(4)).toEqual([3, 4, 5]);
    expect(townNumbers(0)).toEqual([0, 1]);
    expect(townNumbers(53)).toEqual([52, 53, 54]);
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { ...ACTIVE, progress: { station: 53 } } });
    await mount();
    const end = root.querySelectorAll('.dojo__town')[2]!;
    expect(end.getAttribute('data-town')).toBe('54');
    expect(end.querySelector('.sign__ja')?.textContent).toBe(SANJO_OHASHI.nameJa); // the content constant, no literal in the page
    expect(end.querySelector('.sign__reading')?.textContent).toBe(SANJO_OHASHI.nameRomaji);
    render(null, root);
    resetStoreForTests();
    await makeTestStore(); // a fresh save stands at Nihonbashi (station 0)
    expect(store.progress.value.station).toBe(0);
    await mount();
    const t0 = Array.from(root.querySelectorAll('.dojo__town'));
    expect(t0.map((t) => t.getAttribute('data-town'))).toEqual(['0', '1']);
    expect(t0[0]?.querySelector('.sign__ja')?.textContent).toBe(S.onbTitleJa);
    expect(t0[0]?.querySelector('.sign__ordinal')).toBeNull();
    expect(t0[0]?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'road' }));
    expect(root.querySelector('[data-next-station]')?.getAttribute('href')).toBe(href({ name: 'station', n: 1 }));
  });
});

describe('<DojoPage> 茶屋ラジオ tile (design 08 §10.2)', () => {
  it('shows feed.radioMinutes under the session tiles, links to #/radio and says it is not a session', async () => {
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
    // Placed right after the session tiles, before the Three Kata.
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
