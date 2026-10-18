import { BELT_IDS } from '../content/types';
import { MISSIONS } from '../shared/catalog';
import { bus, type Events } from '../shared/events';
import { epochDay, weekOf } from '../shared/time';
import type { Ledger } from '../shared/store-types';
import {
  KIND_INDEX,
  LEDGER_GOAL_HOURS,
  MINUTE_DECIMALS,
  addLedgerEntry,
  appListeningHours,
  externalListeningHours,
  ledgerByWeek,
  ledgerHours,
  ledgerHoursBy,
  logMission,
  missionKind,
  playedMinutes,
  sanitizeMinutes,
  startLedger,
  weekAppMinutes,
  weekProgress,
  weeklyTargetHours,
  wholeMinutes,
  withCoalescedEntry,
  withEntry,
} from './ledger';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('weekly target (design 05 §9)', () => {
  it('rises by belt and is 8 h on the Dan road', () => {
    const expected: Record<(typeof BELT_IDS)[number], number> = { white: 0.5, yellow: 1, orange: 1, green: 3, blue: 5, purple: 5, brown: 7, black: 8 };
    for (const b of BELT_IDS) expect(weeklyTargetHours(b, 0)).toBe(expected[b]);
    expect(weeklyTargetHours('black', 1)).toBe(8);
    expect(weeklyTargetHours('white', 2)).toBe(8);
    expect(LEDGER_GOAL_HOURS).toBe(1500);
  });
});

describe('aggregation (pure)', () => {
  const ledger: Ledger = {
    entries: [
      [TODAY - 40, 60, 0, 1], // listen, external
      [TODAY - 3, 30, 1, 0], // read, app
      [TODAY - 2, 90, 2, 1], // watch, external
      [TODAY - 1, 15, 3, 1], // speak, external
      [TODAY, 45, 0, 0], // listen, app
    ],
    monthly: { '2024-01': 120 },
    missions: [],
  };

  it('ledgerHours by kind, total includes compacted months', () => {
    const m = { ...store.meta(), ledger };
    expect(ledgerHours(m)).toEqual({ total: 6, listen: 1.75, read: 0.5, watch: 1.5, speak: 0.25 });
    expect(ledgerHoursBy(m, { source: 1 })).toEqual({ total: 2.75, listen: 1, read: 0, watch: 1.5, speak: 0.25 });
    expect(ledgerHoursBy(m, { since: TODAY - 3, until: TODAY - 1 }).total).toBe(2.25);
    expect(externalListeningHours(m)).toBe(2.5);
  });

  it('ledgerByWeek groups the last N weeks oldest first', () => {
    const m = { ...store.meta(), ledger };
    const rows = ledgerByWeek(m, TODAY, 2);
    expect(rows.length).toBe(2);
    expect(rows[1].week).toBe(weekOf(TODAY));
    expect(rows[0].week).toBe(weekOf(TODAY) - 1);
    const sum = rows.reduce((a, r) => a + r.total, 0);
    const recent = ledger.entries.filter((e) => weekOf(e[0]) >= weekOf(TODAY) - 1).reduce((a, e) => a + e[1], 0);
    expect(sum).toBe(recent);
    for (const r of rows) expect(r.external + r.app).toBe(r.total);
  });

  it('weekProgress compares external minutes of this week with the belt target', () => {
    const m = { ...store.meta(), ledger: { ...ledger, entries: [[TODAY, 20, 0, 1], [TODAY, 10, 1, 0]] as Ledger['entries'] } };
    const p = weekProgress(m, TODAY);
    expect(p).toEqual({ minutes: 20, targetHours: 0.5, ratio: 20 / 30 });
    expect(weekProgress({ ...m, profile: { ...m.profile, belt: 'green' } }, TODAY).ratio).toBeCloseTo(20 / 180, 6);
  });

  it('withEntry keeps rows sorted by day, keeps a tenth of a minute (design 08 §12: Radio tracks are seconds long) and ignores empty minutes', () => {
    const l = withEntry({ entries: [[10, 5, 0, 1], [20, 5, 0, 1]], monthly: {}, missions: [] }, { day: 15, minutes: 7.4, kind: 1, source: 0 });
    expect(l.entries).toEqual([[10, 5, 0, 1], [15, 7.4, 1, 0], [20, 5, 0, 1]]);
    const same = { entries: [], monthly: {}, missions: [] };
    expect(withEntry(same, { day: 1, minutes: 0, kind: 1, source: 0 })).toBe(same);
    expect(withEntry(same, { day: 1, minutes: Number.NaN, kind: 1, source: 0 })).toBe(same);
    expect(withEntry(same, { day: 1, minutes: 0.04, kind: 0, source: 0 })).toBe(same); // under 3 s rounds to 0
    expect(MINUTE_DECIMALS).toBe(1);
    expect(sanitizeMinutes(7.449)).toBe(7.4);
    expect(sanitizeMinutes(7.45)).toBe(7.5);
    expect(sanitizeMinutes(-3)).toBe(0);
    expect(sanitizeMinutes(10_000)).toBe(24 * 60);
    expect(playedMinutes(600)).toBe(10);
    expect(playedMinutes(40)).toBe(0.7);
    expect(playedMinutes(2)).toBe(0);
  });
});

describe('addLedgerEntry / logMission', () => {
  it('adds the row first, then emits ledger:entry; a note fills the 5th column and goes to bookmarks', async () => {
    await makeTestStore();
    let seenRows = -1;
    const off = bus.on('ledger:entry', () => {
      seenRows = store.ledger.value.entries.length;
    });
    const cap = captureEvents();
    addLedgerEntry({ day: TODAY, minutes: 20, kind: KIND_INDEX.watch, source: 1, note: 'anime, episode 3' });
    addLedgerEntry({ day: TODAY, minutes: 0, kind: KIND_INDEX.watch, source: 1 });
    cap.stop();
    off();
    expect(seenRows).toBe(1);
    expect(store.ledger.value.entries).toEqual([[TODAY, 20, 2, 1, 'anime, episode 3']]);
    expect(store.bookmarks.value).toEqual([`${TODAY}: anime, episode 3`]);
    expect(cap.events.filter(([n]) => n === 'ledger:entry')).toEqual([['ledger:entry', { minutes: 20, kind: 2, source: 1 }]]);
  });

  it('logMission records the mission, the minutes and emits field-mission:done with the conversation flag', async () => {
    await makeTestStore();
    const cap = captureEvents();
    logMission('real-conversation', 18);
    logMission('read-aloud-sign', 0);
    logMission('not-a-mission', 10);
    cap.stop();
    const m = store.ledger.value;
    expect(m.missions).toEqual([
      { day: TODAY, tier: 5, conversation: true },
      { day: TODAY, tier: 1, conversation: false },
    ]);
    expect(m.entries).toEqual([
      [TODAY, 18, KIND_INDEX.speak, 1],
      [TODAY, 5, KIND_INDEX.read, 1],
    ]);
    expect(cap.events.filter(([n]) => n === 'field-mission:done')).toEqual([
      ['field-mission:done', { tier: 5, minutes: 18, conversation: true }],
      ['field-mission:done', { tier: 1, minutes: 5, conversation: false }],
    ]);
    const sub = MISSIONS.find((x) => x.id === 'subtitled-twenty')!;
    expect(missionKind(sub)).toBe(KIND_INDEX.watch);
  });
});

describe('startLedger reducer', () => {
  it('logs story and listening minutes automatically as app-source rows, at whole minutes as before (only listen:played rows carry tenths)', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    const cap = captureEvents();
    bus.emit('story:read', { storyId: 's-04-1', mode: 'read', chars: 400, cpm: 120, correct: 3, total: 3, glossTaps: 0, minutes: 4, bridge: false });
    bus.emit('listening:set', { storyId: 's-04-2', correct: 2, total: 3, rate: 1, minutes: 6 });
    bus.emit('story:read', { storyId: 's-04-1', mode: 'speed', chars: 400, cpm: 300, correct: 1, total: 1, glossTaps: 0, minutes: 0, bridge: false });
    bus.emit('listening:set', { storyId: null, mode: 'walk', refs: ['v-n5-0249#ex0'], correct: 5, total: 6, rate: 1, minutes: 2.5 }); // the Arena emits tenths; the row stays a whole minute
    bus.emit('story:read', { storyId: 's-04-3', mode: 'read', chars: 400, cpm: 120, correct: 3, total: 3, glossTaps: 0, minutes: 1.4, bridge: false });
    bus.emit('listening:set', { storyId: 's-04-2', correct: 3, total: 3, rate: 1, minutes: 0.4 }); // rounds to 0: no row, as before
    cap.stop();
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 4, KIND_INDEX.read, 0],
      [TODAY, 6, KIND_INDEX.listen, 0],
      [TODAY, 3, KIND_INDEX.listen, 0],
      [TODAY, 1, KIND_INDEX.read, 0],
    ]);
    expect(cap.events.filter(([n]) => n === 'ledger:entry').length).toBe(4);
    expect([2.5, 0.4, 7, Number.NaN].map(wholeMinutes)).toEqual([3, 0, 7, 0]);
    stop();
    bus.emit('listening:set', { storyId: 's-04-2', correct: 2, total: 3, rate: 1, minutes: 6 });
    expect(store.ledger.value.entries.length).toBe(4);
  });
});

describe('listen:played rows and the dojo-heard helpers (design 08 §10.2, §10.3, §12)', () => {
  const played = (o: Partial<Events['listen:played']> = {}): Events['listen:played'] => ({ source: 'radio', refs: ['s-04-1'], seconds: 600, rate: 1, cold: false, authentic: false, gistCorrect: null, ...o });

  it('a radio listen:played of 600 s and a readalong of 300 s on one day make ONE 15-minute listen/app row (coalesced); ledger:entry carries each track\'s own minutes; no note, no bookmark', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    const cap = captureEvents();
    bus.emit('listen:played', played({ source: 'radio', seconds: 600 }));
    bus.emit('listen:played', played({ source: 'readalong', refs: ['s-04-2'], seconds: 300, cold: true, authentic: true, gistCorrect: true }));
    cap.stop();
    expect(store.ledger.value.entries).toEqual([[TODAY, 15, KIND_INDEX.listen, 0]]);
    expect(store.ledger.value.entries.every((e) => e.length === 4)).toBe(true);
    expect(store.bookmarks.value).toEqual([]);
    expect(cap.events.filter(([n]) => n === 'ledger:entry')).toEqual([
      ['ledger:entry', { minutes: 10, kind: 0, source: 0 }],
      ['ledger:entry', { minutes: 5, kind: 0, source: 0 }],
    ]);
    stop();
    bus.emit('listen:played', played());
    expect(store.ledger.value.entries).toEqual([[TODAY, 15, KIND_INDEX.listen, 0]]);
  });

  it('a 40-second Radio track is a 0.7-minute row, not 0 and not 1; nothing under 3 s is logged', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    bus.emit('listen:played', played({ seconds: 40 }));
    bus.emit('listen:played', played({ seconds: 2 }));
    bus.emit('listen:played', played({ seconds: Number.NaN }));
    stop();
    expect(store.ledger.value.entries).toEqual([[TODAY, 0.7, KIND_INDEX.listen, 0]]);
    expect(ledgerHours(store.meta()).listen).toBe(0.01); // hours are reported to two decimals
  });

  it('weekProgress ignores app rows; appListeningHours sums only source-0 listen rows; weekAppMinutes is this week only', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    bus.emit('listen:played', played({ seconds: 1800 })); // 30 min heard in the dojo
    bus.emit('story:read', { storyId: 's-04-1', mode: 'read', chars: 400, cpm: 120, correct: 3, total: 3, glossTaps: 0, minutes: 12, bridge: false }); // read, app
    stop();
    // Outside rows: listen today, watch today, listen 60 days ago (outside this week).
    store.patch('ledger', (l) => ({ ...l, entries: [...l.entries, [TODAY, 20, 0, 1], [TODAY, 15, 2, 1], [TODAY - 60, 300, 0, 1]] }));
    const m = store.meta();
    const p = weekProgress(m, TODAY);
    expect(p.minutes).toBe(35); // external only: the 30 dojo minutes and the 12 read minutes never count toward the weekly target
    expect(appListeningHours(m)).toBe(0.5); // 30 min of app listen rows; the 12 read minutes and every outside row are excluded
    expect(weekAppMinutes(m, TODAY)).toBe(30);
    expect(weekAppMinutes(m, TODAY - 60)).toBe(0);
    store.patch('ledger', (l) => ({ ...l, entries: [...l.entries, [TODAY - 60, 90, 0, 0]] }));
    expect(appListeningHours(store.meta())).toBe(2); // lifetime: 30 + 90 min
    expect(weekAppMinutes(store.meta(), TODAY)).toBe(30);
    expect(externalListeningHours(store.meta())).toBe(5.58); // (20 + 15 + 300) / 60, two decimals
  });
});

describe('listen:played rows coalesce (design 08 §12: a Radio sitting writes a handful of rows a day, not one per track)', () => {
  const played = (o: Partial<Events['listen:played']> = {}): Events['listen:played'] => ({ source: 'radio', refs: ['s-04-1'], seconds: 600, rate: 1, cold: false, authentic: false, gistCorrect: null, ...o });
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('three tracks on one day → one row with the summed tenths; a track under 3 s adds nothing and announces nothing', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    const cap = captureEvents();
    bus.emit('listen:played', played({ seconds: 40 })); // 0.7
    bus.emit('listen:played', played({ seconds: 2 })); // dropped
    bus.emit('listen:played', played({ seconds: 50, source: 'readalong', refs: ['s-04-2'] })); // 0.8
    bus.emit('listen:played', played({ seconds: 70, rate: 1.1 })); // 1.2
    cap.stop();
    stop();
    expect(store.ledger.value.entries).toEqual([[TODAY, 2.7, KIND_INDEX.listen, 0]]);
    expect(cap.events.filter(([n]) => n === 'ledger:entry')).toEqual([
      ['ledger:entry', { minutes: 0.7, kind: 0, source: 0 }],
      ['ledger:entry', { minutes: 0.8, kind: 0, source: 0 }],
      ['ledger:entry', { minutes: 1.2, kind: 0, source: 0 }],
    ]);
    expect(ledgerHours(store.meta()).listen).toBe(0.05); // 2.7 min
  });

  it('an Arena set between two tracks: the set appends its whole-minute row as before and the next track merges INTO that row (same shape — intended: heard minutes per day, not per surface); a read row is never merged into', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    bus.emit('listen:played', played({ seconds: 600 })); // [10]
    bus.emit('listening:set', { storyId: 's-04-2', correct: 3, total: 3, rate: 1, minutes: 6 }); // sets never coalesce: a second row
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 10, KIND_INDEX.listen, 0],
      [TODAY, 6, KIND_INDEX.listen, 0],
    ]);
    bus.emit('listen:played', played({ seconds: 40 })); // folds into the Arena row → 6.7
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 10, KIND_INDEX.listen, 0],
      [TODAY, 6.7, KIND_INDEX.listen, 0],
    ]);
    bus.emit('story:read', { storyId: 's-04-1', mode: 'read', chars: 400, cpm: 120, correct: 3, total: 3, glossTaps: 0, minutes: 4, bridge: false }); // read row
    bus.emit('listen:played', played({ seconds: 30 })); // another kind last: a new listen row
    stop();
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 10, KIND_INDEX.listen, 0],
      [TODAY, 6.7, KIND_INDEX.listen, 0],
      [TODAY, 4, KIND_INDEX.read, 0],
      [TODAY, 0.5, KIND_INDEX.listen, 0],
    ]);
  });

  it('a track on a new day starts a new row; the days stay sorted', async () => {
    let now = DEFAULT_TEST_NOW;
    await makeTestStore({ now: () => now });
    const stop = startLedger(store);
    bus.emit('listen:played', played({ seconds: 600 }));
    bus.emit('listen:played', played({ seconds: 60 }));
    now += DAY_MS;
    bus.emit('listen:played', played({ seconds: 90 }));
    bus.emit('listen:played', played({ seconds: 90 }));
    stop();
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 11, KIND_INDEX.listen, 0],
      [TODAY + 1, 3, KIND_INDEX.listen, 0],
    ]);
  });

  it('a row with a note is never merged into, nor is an outside row: the track appends its own row', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    store.patch('ledger', (l) => ({ ...l, entries: [[TODAY, 20, KIND_INDEX.listen, 0, 'imported note']] }));
    bus.emit('listen:played', played({ seconds: 60 }));
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 20, KIND_INDEX.listen, 0, 'imported note'],
      [TODAY, 1, KIND_INDEX.listen, 0],
    ]);
    store.patch('ledger', (l) => ({ ...l, entries: [...l.entries, [TODAY, 30, KIND_INDEX.listen, 1]] })); // outside listen, same day
    bus.emit('listen:played', played({ seconds: 60 }));
    stop();
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 20, KIND_INDEX.listen, 0, 'imported note'],
      [TODAY, 1, KIND_INDEX.listen, 0],
      [TODAY, 30, KIND_INDEX.listen, 1],
      [TODAY, 1, KIND_INDEX.listen, 0],
    ]);
  });

  it('a row dated after today (a restored backup, a moved clock) does not hide today\'s row: the first track of the day sits before the later day and the next one folds into it although it is not the last row', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    store.patch('ledger', (l) => ({ ...l, entries: [[TODAY + 1, 3, KIND_INDEX.listen, 0]] }));
    bus.emit('listen:played', played({ seconds: 40 })); // 0.7: no row of today yet → sorted insert before the later day
    bus.emit('listen:played', played({ seconds: 40 })); // folds into today's row, not the later one
    stop();
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 1.4, KIND_INDEX.listen, 0],
      [TODAY + 1, 3, KIND_INDEX.listen, 0],
    ]);
  });

  it('withCoalescedEntry (pure): folds into the matching row a new row would follow, to a tenth, else behaves as withEntry (sorted insert, notes append, empty minutes ignored)', () => {
    const base: Ledger = { entries: [[10, 5, 0, 1], [20, 0.7, 0, 0]], monthly: {}, missions: [] };
    expect(withCoalescedEntry(base, { day: 20, minutes: 0.7, kind: 0, source: 0 }).entries).toEqual([[10, 5, 0, 1], [20, 1.4, 0, 0]]);
    expect(withCoalescedEntry({ ...base, entries: [[20, 0.1, 0, 0]] }, { day: 20, minutes: 0.2, kind: 0, source: 0 }).entries).toEqual([[20, 0.3, 0, 0]]); // no 0.30000000000000004
    expect(withCoalescedEntry(base, { day: 20, minutes: 0.7, kind: 0, source: 0, note: 'with a note' }).entries).toEqual([[10, 5, 0, 1], [20, 0.7, 0, 0], [20, 0.7, 0, 0, 'with a note']]);
    expect(withCoalescedEntry(base, { day: 20, minutes: 0.7, kind: 1, source: 0 }).entries).toEqual([[10, 5, 0, 1], [20, 0.7, 0, 0], [20, 0.7, 1, 0]]);
    expect(withCoalescedEntry(base, { day: 15, minutes: 2, kind: 0, source: 0 }).entries).toEqual([[10, 5, 0, 1], [15, 2, 0, 0], [20, 0.7, 0, 0]]); // older day: sorted insert, no merge
    expect(withCoalescedEntry(base, { day: 21, minutes: 2, kind: 0, source: 0 }).entries).toEqual([[10, 5, 0, 1], [20, 0.7, 0, 0], [21, 2, 0, 0]]);
    const ahead: Ledger = { entries: [[20, 0.7, 0, 0], [21, 3, 0, 0]], monthly: {}, missions: [] }; // a row dated after e.day (restored backup, moved clock)
    expect(withCoalescedEntry(ahead, { day: 20, minutes: 0.7, kind: 0, source: 0 }).entries).toEqual([[20, 1.4, 0, 0], [21, 3, 0, 0]]); // skipped, never merged into; day 20 still folds
    expect(withCoalescedEntry(ahead, { day: 20, minutes: 0.7, kind: 1, source: 0 }).entries).toEqual([[20, 0.7, 0, 0], [20, 0.7, 1, 0], [21, 3, 0, 0]]); // another kind: sorted insert before the later day
    expect(ahead.entries).toEqual([[20, 0.7, 0, 0], [21, 3, 0, 0]]);
    expect(withCoalescedEntry(base, { day: 20, minutes: 0.04, kind: 0, source: 0 })).toBe(base);
    expect(withCoalescedEntry(base, { day: 20, minutes: Number.NaN, kind: 0, source: 0 })).toBe(base);
    const empty: Ledger = { entries: [], monthly: {}, missions: [] };
    expect(withCoalescedEntry(empty, { day: 1, minutes: 0.7, kind: 0, source: 0 }).entries).toEqual([[1, 0.7, 0, 0]]);
    expect(base.entries).toEqual([[10, 5, 0, 1], [20, 0.7, 0, 0]]); // never mutated
  });
});
