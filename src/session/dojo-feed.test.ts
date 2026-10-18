/**
 * dojo-feed.ts — the home screen's one line and its company.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, ListeningPool } from '../content/types';
import { FIXTURE, FIXTURE_IDS, G, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { SESSION_SCHEMA, type SessionPlan } from '../shared/session-types';
import { epochDay, weekOf } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { kiaiInit, poolMinutes, selectPool } from '../learn';
import { S } from './engine-strings';
import { loadPlanContext, withPools } from './builder';
import { forecastCounts, knownIds } from '../store/derived';
import { SCROLL_BLOCK_MINUTES, dojoFeed, forecastLine, gateForecast, radioMinutesFor, resumeInfo, sentenceOfDay, welcomeState } from './dojo-feed';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function live(s: number, due = TODAY): CardTuple {
  return card({ due, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

/** Station-4 vocab at Brown (rec S 40, prod S 10), kanji and grammar Green, due in the future. */
function brownVocab(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of STATION_4.vocabIds) {
    out[`${id}#rec`] = live(40, TODAY + 10);
    out[`${id}#prod`] = live(10, TODAY + 5);
  }
  for (const id of STATION_4.kanjiIds) out[`${id}#comp`] = live(8, TODAY + 5);
  for (const id of STATION_4.grammarIds) out[`${id}#cloze`] = live(8, TODAY + 5);
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('forecastLine', () => {
  it('reads like the design: "42 reviews · 1 scroll · 1 episode · ~18 min"', () => {
    expect(forecastLine(42, 1, 1, 18)).toBe('42 reviews · 1 scroll · 1 episode · ~18 min');
    expect(forecastLine(1, 2, 0, 3.4)).toBe('1 review · 2 scrolls · ~3 min');
    expect(forecastLine(0, 0, 1, 7)).toBe('0 reviews · 1 episode · ~7 min');
    expect(forecastLine(0, 0, 0, 0)).toBe(S.forecastRest);
    expect(forecastLine(5, 0, 0, 0.2)).toBe('5 reviews · ~1 min');
  });
});

describe('sentenceOfDay', () => {
  it('is deterministic per day and drawn from Brown items with examples', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: brownVocab() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const a = sentenceOfDay(ctx, TODAY)!;
    const b = sentenceOfDay(ctx, TODAY)!;
    expect(a).toEqual(b);
    const brownExamples = STATION_4.vocabIds.flatMap((id) => (loader.get(id) as { examples: { ja: string }[] }).examples.map((e) => e.ja));
    expect(brownExamples).toContain(a.ja);
    const week = new Set(Array.from({ length: 7 }, (_, i) => sentenceOfDay(ctx, TODAY + i)!.ja));
    expect(week.size).toBeGreaterThan(1);
  });

  it('falls back to Green items and to nothing', async () => {
    const cards: Record<CardKey, CardTuple> = { [`${V.犬}#rec`]: live(8, TODAY + 3) };
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(sentenceOfDay(ctx)!.ja).toBe((loader.get(V.犬) as { examples: { ja: string }[] }).examples[0]!.ja);
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } } });
    const empty = await loadPlanContext({ loader, station: 4 });
    expect(sentenceOfDay(empty)).toBeUndefined();
  });
});

describe('welcome and resume', () => {
  it('welcome is comeback when a Welcome Back set is owed, mountain after 7+ days away, else none', async () => {
    await makeTestStore({ save: { progress: { welcomeBackDue: true, awayDays: 40 } } });
    expect(welcomeState()).toBe('comeback');
    store.patch('progress', (p) => ({ ...p, welcomeBackDue: false }));
    expect(welcomeState()).toBe('mountain');
    store.patch('progress', (p) => ({ ...p, awayDays: 3 }));
    expect(welcomeState()).toBe('none');
  });

  it('resume reports the reps left of a saved session, nothing when it is spent', async () => {
    await makeTestStore();
    expect(resumeInfo()).toBeUndefined();
    const plan: SessionPlan = { id: 'p', mode: 'kata', day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, block: 'reviews', exercise: 'meaning-recall', itemId: null, cardKey: null, params: {}, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 0 })), blocks: [], meta: { dueTotal: 5, dueTaken: 5, backlog: false, newCount: 0, scrollIds: [] } };
    store.session.save({ schema: SESSION_SCHEMA, plan, cursor: 2, results: [], kiai: kiaiInit() });
    expect(resumeInfo()).toEqual({ stepsLeft: 3 });
    store.session.save({ schema: SESSION_SCHEMA, plan, cursor: 5, results: [], kiai: kiaiInit() });
    expect(resumeInfo()).toBeUndefined();
    // a snapshot whose step key is not a card key (hand-edited save) is never offered
    const garbage = { ...plan, steps: plan.steps.map((s, i) => (i === 0 ? { ...s, cardKey: 'v-n5-0001' as CardKey } : s)) };
    store.session.save({ schema: SESSION_SCHEMA, plan: garbage, cursor: 2, results: [], kiai: kiaiInit() });
    expect(resumeInfo()).toBeUndefined();
  });
});

describe('dojoFeed', () => {
  it('assembles the forecast, minutes, milestone, quests, flame, Kage, gate and teaser', async () => {
    const cards = brownVocab();
    for (const id of [V.人, V.日]) cards[`${id}#rec`] = live(40, TODAY);
    await makeTestStore({ save: { progress: { station: 4, welcomeBackDue: true }, quests: { day: TODAY, ids: ['clear-due', 'read-episode', 'shadow-five'], done: ['clear-due'] }, streak: { current: 3, totalDays: 12, lastDay: TODAY } }, cards });
    const feed = await dojoFeed({ loader });
    expect(feed.due).toBe(2);
    expect(feed.forecastLine.startsWith('2 reviews')).toBe(true);
    expect(feed.forecastLine).toContain('~');
    expect(feed.minutes.kata).toBeGreaterThanOrEqual(0);
    expect(feed.minutes.shugyo).toBeGreaterThan(feed.minutes.kata);
    expect(feed.welcome).toBe('comeback');
    expect(feed.quests).toEqual([
      { id: 'clear-due', done: true },
      { id: 'read-episode', done: false },
      { id: 'shadow-five', done: false },
    ]);
    expect(feed.flame).toBe('lit');
    expect(feed.streak).toEqual({ current: 3, totalDays: 12 });
    expect(feed.kage.due).toBe(true);
    expect(feed.kage.week).toBe(weekOf(TODAY));
    expect(feed.nemesis).toEqual({ count: 0, itemIds: [], line: null });
    expect(feed.gate).toMatchObject({ station: 4, cleared: false, total: 14, introduced: 14, green: 14, ready: true });
    expect(feed.nextMilestone).toContain('ready');
    expect(feed.shinsa).toBeNull();
    expect(feed.backlog).toBe(false);
    expect(feed.backlogLine).toBeNull();
    expect(feed.nextMilestone.length).toBeGreaterThan(0);
    expect(feed.sentenceOfDay?.ja).toBeTruthy();
    expect(feed.sentenceOfDay?.kana).toMatch(/^[ぁ-ゖァ-ヺー・、。！？「」]+$/u);
    expect(feed.teaser?.words.length).toBeGreaterThan(0);
    expect(S.omikuji).toContain(feed.proverb);
    expect(feed.episodes).toBe(0);
    expect(feed.resume).toBeUndefined();
  });

  it('with no Scroll to teach, the new-item count is 0 and the Scroll block minutes come off the Kumite / Shugyō estimate', async () => {
    const fc = { due: 3, newItems: 4, minutes: { kata: 1, kumite: 9, shugyo: 21 } };
    expect(gateForecast(fc, 1)).toEqual({ newItems: 4, minutes: fc.minutes });
    expect(gateForecast(fc, 0)).toEqual({ newItems: 0, minutes: { kata: 1, kumite: 9 - SCROLL_BLOCK_MINUTES.kumite, shugyo: 21 - SCROLL_BLOCK_MINUTES.shugyo } });
    expect(gateForecast({ ...fc, newItems: 0 }, 0)).toEqual({ newItems: 0, minutes: fc.minutes });

    // every station-4 item (components too) introduced: nothing left to teach today
    const cards = brownVocab();
    for (const id of STATION_4.componentIds) cards[`${id}#rec`] = live(8, TODAY + 5);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const raw = forecastCounts();
    expect(raw.newItems).toBeGreaterThan(0);
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.scrolls).toBe(0);
    expect(feed.newItems).toBe(0);
    expect(feed.minutes.kumite).toBe(raw.minutes.kumite - SCROLL_BLOCK_MINUTES.kumite);
    expect(feed.minutes.shugyo).toBe(raw.minutes.shugyo - SCROLL_BLOCK_MINUTES.shugyo);
    expect(feed.minutes.kata).toBe(raw.minutes.kata);
    expect(feed.forecastLine).toBe(S.forecastRest); // nothing due, no scroll, no episode

    // a Scroll available: the forecast stands and the budget shows
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } }, cards: brownVocab() });
    const withScroll = await dojoFeed({ loader, teaser: false });
    expect(withScroll.scrolls).toBeGreaterThan(0);
    expect(withScroll.newItems).toBeGreaterThan(0);
    expect(withScroll.minutes).toEqual(forecastCounts().minutes);
  });

  it('a Nemesis duel ready today is called out; a backlog day carries the honest line', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) cards[`${id}#rec`] = live(5);
    cards[`${V.飲む}#prod`] = card({ due: TODAY, s: 1, d: 8, reps: 20, lapses: 8, state: 2, last: TODAY - 20, flags: 2 });
    await makeTestStore({ save: { progress: { station: 4 }, settings: { intensity: 'custom', maxReviews: 4 } }, cards });
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.nemesis.count).toBe(1);
    expect(feed.nemesis.itemIds).toEqual([V.飲む]);
    expect(feed.nemesis.line).toBe('1 Nemesis duel ready');
    expect(feed.backlog).toBe(true);
    expect(feed.backlogLine).toBe(`The gatekeeper holds the line. 4 of your ${Object.keys(cards).length} reviews today; the rest wait without penalty.`);
    expect(feed.scrolls).toBe(0);
    expect(feed.teaser).toBeUndefined();
  });

  it('on a belt’s last station the Shinsa eligibility is reported', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4] } } });
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.shinsa?.belt).toBe('yellow');
    expect(feed.shinsa?.eligibility.eligible).toBe(false);
    expect(feed.shinsa?.eligibility.reasons.length).toBeGreaterThan(0);
    expect(feed.gate).toBeNull();
  });
});

describe('the forecast line prices the reviews it names (design 03 §3)', () => {
  it('a heavy due day: the minutes are the Shugyō’s, scaling with the count, not a Kumite’s', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of FIXTURE_IDS.vocab) for (const f of ['rec', 'prod', 'listen', 'pitch'] as const) cards[`${id}#${f}`] = live(5, TODAY);
    for (const id of FIXTURE_IDS.kana) for (const f of ['rec', 'prod'] as const) cards[`${id}#${f}`] = live(5, TODAY);
    for (const id of FIXTURE_IDS.kanji) for (const f of ['comp', 'read'] as const) cards[`${id}#${f}`] = live(5, TODAY);
    for (const id of FIXTURE_IDS.grammar) for (const f of ['cloze', 'prod'] as const) cards[`${id}#${f}`] = live(5, TODAY);
    for (const id of FIXTURE_IDS.component) cards[`${id}#rec`] = live(5, TODAY);
    expect(Object.keys(cards).length).toBeGreaterThan(60);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.due).toBeGreaterThanOrEqual(40);
    const minutes = Number(/~(\d+) min$/.exec(feed.forecastLine)![1]);
    expect(feed.forecastLine.startsWith(`${feed.due} reviews`)).toBe(true);
    expect(minutes).toBe(Math.max(1, Math.round(feed.minutes.shugyo)));
    expect(minutes).toBeGreaterThan(feed.minutes.kumite);
    // at the design's 4 s floor per rep the named reviews alone take this long
    expect(minutes).toBeGreaterThanOrEqual(Math.floor((feed.due * 4) / 60));
  });
});

describe('radioMinutes for the Dojo tile (design 08 §4, §10.2)', () => {
  it('is null without pools and the rounded i+0 minutes at the live known set with them — never the allowlist figure', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: brownVocab() });
    expect((await dojoFeed({ loader, teaser: false })).radioMinutes).toBeNull();
    const pool: ListeningPool = {
      schema: 'tsuzuku.pool/1',
      station: 4,
      refs: [
        { ref: `${V.人}#ex0`, ids: [V.人, G.は, G.です], kana: 'あのひとはケンです。', morae: 10 },
        { ref: `${V.飲む}#ex0`, ids: [V.コーヒー, V.飲む], kana: 'まいあさコーヒーをのみます。', morae: 14 },
        { ref: `${V.私}#ex0`, ids: [V.私, G.は, G.です], kana: 'わたしはハナです。', morae: 9 },
        // long enough that the allowlist figure and the live figure differ by whole minutes
        { ref: `${G.ます}#ex2`, ids: [V.私, V.人, G.ます], kana: 'ひとがいます。'.repeat(40), morae: 280 },
      ],
    };
    const L = createFakeLoader({ ...FIXTURE, pools: { 4: pool } });
    const feed = await dojoFeed({ loader: L, teaser: false });
    const known = knownIds(TODAY);
    expect(known.has(V.私)).toBe(false); // station-1 words are not in brownVocab
    expect(known.has(V.人)).toBe(true);
    const live = selectPool(pool.refs, known, store.cards, TODAY, { mode: 'i+0' });
    expect(live.map((r) => r.ref)).toEqual([`${V.人}#ex0`, `${V.飲む}#ex0`]);
    const expected = Math.round(poolMinutes(live));
    expect(feed.radioMinutes).toBe(expected);
    expect(feed.radioMinutes).not.toBe(Math.round(poolMinutes(pool.refs)));
    const ctx = await withPools(await loadPlanContext({ loader: L, station: 4 }));
    expect(radioMinutesFor(ctx)).toBe(expected);
    expect(radioMinutesFor({ ...ctx, pools: [] })).toBeNull();
    // with every word known the live figure is the whole pool
    expect(radioMinutesFor({ ...ctx, known: new Set(pool.refs.flatMap((r) => r.ids)) })).toBe(Math.round(poolMinutes(pool.refs)));
  });
});
