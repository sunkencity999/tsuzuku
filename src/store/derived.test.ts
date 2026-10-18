import type { CardKey, StationBundle } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import { CardFlag, type CardTuple, type LogEntry } from '../shared/store-types';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, card, makeTestStore, testSave } from './testing';
import * as d from './derived';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function bundle(n: number, o: { kana?: number; vocab?: number; kanji?: number; grammar?: number } = {}): StationBundle {
  const id = (p: string, i: number): string => `${p}-${String(n * 100 + i).padStart(4, '0')}`;
  return {
    schema: 'tsuzuku.station/1',
    number: n,
    kanaIds: Array.from({ length: o.kana ?? 0 }, (_, i) => `k-h-s${n}x${i}`),
    vocabIds: Array.from({ length: o.vocab ?? 0 }, (_, i) => id('v-n5', i)),
    kanjiIds: Array.from({ length: o.kanji ?? 0 }, (_, i) => `j-${String.fromCharCode(0x4e00 + n * 100 + i)}`),
    grammarIds: Array.from({ length: o.grammar ?? 0 }, (_, i) => `g-n5-${String(n * 10 + i).padStart(3, '0')}`),
    componentIds: [],
    storyIds: [],
    michikusaIds: [],
    files: [],
    surfaces: {},
  };
}

/** A reviewed card: state 2, last review today, stability `s`. */
function live(s: number, extra: Partial<{ due: number; reps: number; flags: number; last: number }> = {}): CardTuple {
  return card({ due: extra.due ?? TODAY + 1, s, reps: extra.reps ?? 3, state: 2, last: extra.last ?? TODAY, flags: extra.flags ?? 0 });
}

describe('derived read-model', () => {
  afterEach(() => {
    resetStoreForTests();
    bus.reset();
  });

  describe('dueCount / isBacklog', () => {
    it('counts due reviews excluding archived, kaiden and never-reviewed (state 0) cards', async () => {
      await makeTestStore({
        cards: {
          'v-n5-0001#rec': live(1, { due: TODAY - 2 }),
          'v-n5-0002#rec': live(1, { due: TODAY }),
          'v-n5-0003#rec': live(1, { due: TODAY + 1 }),
          'v-n5-0004#rec': live(1, { due: TODAY, flags: CardFlag.archived }),
          'v-n5-0005#rec': live(1, { due: TODAY, flags: CardFlag.kaiden }),
          'v-n5-0006#rec': card({ due: TODAY - 1, state: 0 }),
          'k-h-a#prod': card({ due: TODAY, state: 0 }),
        },
      });
      // The raw primitive and the read-model agree: state-0 cards are not due reviews.
      expect(store.cards.dueOn(TODAY)).toHaveLength(2);
      expect(d.dueCount()).toBe(2);
      expect(d.forecastCounts().due).toBe(2);
      expect(d.dueCount(TODAY - 1)).toBe(1);
      expect(d.isBacklog()).toBe(false);
    });

    it('backlog when due > 2 × the belt-scaled cap (White Standard cap 160)', async () => {
      const cards: Record<CardKey, CardTuple> = {};
      for (let i = 0; i < 321; i++) cards[`v-n5-${String(i).padStart(4, '0')}#rec`] = live(1, { due: TODAY });
      await makeTestStore({ cards });
      expect(d.reviewCap()).toBe(160);
      expect(d.isBacklog()).toBe(true);
      store.cards.delete('v-n5-0000#rec');
      expect(d.isBacklog()).toBe(false);
    });
  });

  describe('beltEligibility (design 02 §2)', () => {
    it('needs every gate, ≥ 85 % Green and ≥ 50 % Brown of the belt\'s items', async () => {
      const bundles = [bundle(1, { kana: 10, vocab: 10 }), bundle(2, { kana: 10, vocab: 10 }), bundle(3, { kana: 10, vocab: 10 })];
      const ids = bundles.flatMap((b) => [...b.kanaIds, ...b.vocabIds]);
      expect(ids).toHaveLength(60);
      const cards: Record<CardKey, CardTuple> = {};
      ids.forEach((id, i) => {
        if (i < 54) cards[`${id}#rec`] = live(i < 30 ? 40 : 10);
        if (i < 30) cards[`${id}#prod`] = live(8);
      });
      await makeTestStore({ cards, save: { progress: { stationsCleared: [1, 2] } } });
      const e = d.beltEligibility('white', bundles);
      expect(e.total).toBe(60);
      expect(e.coverageRec).toBeCloseTo(0.9);
      expect(e.coverageProd).toBeCloseTo(0.5);
      expect(e.gatesDone).toBe(false);
      expect(e.eligible).toBe(false);
      store.patch('progress', (p) => ({ ...p, stationsCleared: [1, 2, 3] }));
      expect(d.beltEligibility('white', bundles).eligible).toBe(true);
      // One fewer Brown item breaks the 50 % line.
      store.cards.delete(`${ids[0]}#prod`);
      expect(d.beltEligibility('white', bundles).eligible).toBe(false);
    });

    it('excludes kana above White', async () => {
      await makeTestStore();
      const e = d.beltEligibility('yellow', [bundle(4, { kana: 5, vocab: 3 })]);
      expect(e.total).toBe(3);
    });
  });

  describe('stationProgress', () => {
    it('gateReady when every item is introduced and ≥ 80 % are Green', async () => {
      const b = bundle(5, { vocab: 10 });
      const cards: Record<CardKey, CardTuple> = {};
      b.vocabIds.forEach((id, i) => {
        cards[`${id}#rec`] = live(i < 8 ? 10 : 2);
      });
      await makeTestStore({ cards });
      const p = d.stationProgress(5, b);
      expect(p).toEqual({ introduced: 10, total: 10, green: 8, gateReady: true, cleared: false });
      store.cards.set(`${b.vocabIds[7]}#rec`, live(2));
      expect(d.stationProgress(5, b).gateReady).toBe(false);
      store.cards.delete(`${b.vocabIds[9]}#rec`);
      expect(d.stationProgress(5, b).introduced).toBe(9);
      store.patch('progress', (x) => ({ ...x, stationsCleared: [5] }));
      expect(d.stationProgress(5, b).cleared).toBe(true);
    });
  });

  describe('forecastCounts', () => {
    it('estimates minutes from due counts × median latency plus block budgets', async () => {
      const cards: Record<CardKey, CardTuple> = {};
      for (let i = 0; i < 40; i++) cards[`v-n5-${String(i).padStart(4, '0')}#rec`] = live(1, { due: TODAY });
      await makeTestStore({ cards });
      const f = d.forecastCounts();
      expect(f.due).toBe(40);
      expect(f.newItems).toBe(4);
      expect(f.minutes.kata).toBe(Math.round((25 * 8) / 60 + 0.5));
      expect(f.minutes.kumite).toBeGreaterThan(f.minutes.kata);
      expect(f.minutes.shugyo).toBeGreaterThan(f.minutes.kumite);
      store.patch('medianMs', () => ({ 'meaning-recall': 4000, 'kana-forge': 6000 }));
      expect(d.medianRepSeconds()).toBe(5);
      expect(d.forecastCounts().minutes.kata).toBe(Math.round((25 * 5) / 60 + 0.5));
    });
  });

  describe('known counts', () => {
    it('known = base-facet retrievability ≥ 0.85 now', async () => {
      await makeTestStore({
        cards: {
          'v-n5-0001#rec': live(100),
          'v-n5-0002#rec': live(1, { last: TODAY - 10 }),
          'v-n5-0003#listen': live(100),
          'j-食#comp': live(50),
          'g-n5-001#cloze': live(50),
          'k-h-a#rec': live(200),
          'c-person#rec': live(200),
        },
      });
      // v-n5-0003 holds only a listen card → no base facet → never known.
      expect(d.knownVocabCount()).toBe(1);
      expect(d.knownCounts()).toEqual({ kana: 1, vocab: 1, kanji: 1, grammar: 1, component: 1 });
      expect(d.itemBeltOf('v-n5-0001')).toBe('green');
      expect(d.itemBeltOf('v-n5-0002')).toBe('yellow');
      expect(d.itemBeltOf('v-n5-0003')).toBe('white');
      expect(d.itemBeltOf('v-n5-0009')).toBe('white');
      // A vocab id holding only a prod card is a chunk (learn/known.kindOfCards).
      expect(d.kindFor('v-n5-0003', { prod: live(100) })).toBe('chunk');
      expect(d.kindFor('v-n5-0003', { rec: live(1), prod: live(100) })).toBe('vocab');
      expect(d.cardRetrievability(live(100), TODAY)).toBeCloseTo(1);
      expect(d.cardRetrievability(card(), TODAY)).toBe(0);
    });
  });

  describe('XP curve (design 02 §5)', () => {
    it('levels at the documented cumulative XP', () => {
      expect(d.levelFor(0)).toBe(1);
      expect(d.levelFor(2000)).toBe(5);
      expect(d.levelFor(1999)).toBe(4);
      expect(d.levelFor(7000)).toBe(10);
      expect(d.levelFor(26_000)).toBe(20);
      expect(d.levelFor(57_000)).toBe(30);
      expect(d.levelFor(155_000)).toBe(50);
      expect(d.levelFor(597_960)).toBe(99);
      expect(d.levelFor(10_000_000)).toBe(99);
      expect(d.xpToNext(5)).toBe(760);
      expect(d.xpAtLevel(6) - d.xpAtLevel(5)).toBe(d.xpToNext(5));
    });

    it('xpToNextLevel reports progress inside the level', async () => {
      await makeTestStore({ save: { profile: { xp: 2380 } } });
      expect(d.xpToNextLevel()).toEqual({ level: 5, xp: 2380, into: 380, needed: 760, remaining: 380, progress: 0.5 });
      expect(d.xpToNextLevel(600_000).progress).toBe(1);
    });
  });

  describe('streakState', () => {
    const base = { current: 3, longest: 5, lastDay: TODAY, totalDays: 10, freezes: 0, repairs: 0, restDaysTaken: 0, weekly: 1, emberRestores: 0 };

    it('mirrors the visible flame states', () => {
      expect(d.streakStateOf(base, TODAY, null)).toBe('lit');
      expect(d.streakStateOf(base, TODAY, null, true)).toBe('gold');
      expect(d.streakStateOf({ ...base, lastDay: TODAY - 1 }, TODAY, null)).toBe('lit');
      expect(d.streakStateOf({ ...base, lastDay: TODAY - 1, ember: TODAY }, TODAY, null)).toBe('ember');
      expect(d.streakStateOf({ ...base, vacationUntil: TODAY + 3 }, TODAY, null)).toBe('frozen');
      expect(d.streakStateOf({ ...base, current: 0, lastDay: TODAY - 9 }, TODAY, null)).toBe('broken');
      const weekday = (TODAY + 4) % 7;
      expect(d.streakStateOf({ ...base, lastDay: TODAY - 1 }, TODAY, weekday)).toBe('rest');
    });

    it('reads the live store (gold when all Three Kata are done today)', async () => {
      await makeTestStore({
        save: { streak: { current: 2, lastDay: TODAY }, quests: { day: TODAY, ids: ['clear-due', 'learn-scroll'], done: ['clear-due', 'learn-scroll'] } },
      });
      expect(d.streakState()).toBe('gold');
      store.patch('quests', (q) => ({ ...q, done: ['clear-due'] }));
      expect(d.streakState()).toBe('lit');
    });
  });

  describe('peraperaNow (design 05 §11)', () => {
    it('a fresh learner: only the synthetic 耳 floor, 場 unavailable before Station 21', async () => {
      const s = await makeTestStore();
      const r = d.peraperaNow(s.meta(), s.cards, s.now());
      expect(r.axes).toEqual([0, 10, 0, 0, 0]);
      expect(r.labels).toEqual(['語彙', '耳', '読', '口', '—']);
      expect(r.composite).toBe(3);
      expect(r.flags).toEqual(['(synthetic)', '(estimated)']);
      expect(d.peraperaIndex()).toEqual(r);
    });

    it('語彙 sums retrievability over vocab rec/prod cards', async () => {
      const cards: Record<CardKey, CardTuple> = {};
      for (let i = 0; i < 2000; i++) cards[`v-n5-${String(i).padStart(4, '0')}#rec`] = live(500);
      for (let i = 0; i < 600; i++) cards[`v-n5-${String(i).padStart(4, '0')}#prod`] = live(500);
      const s = await makeTestStore({ cards });
      const r = d.peraperaNow(s.meta(), s.cards, s.now());
      // 0.6 · 2000/10000 + 0.4 · 600/6000 = 0.12 + 0.04 = 0.16 → 16
      expect(r.axes[0]).toBe(16);
    });

    it('耳 is capped at 70 until 15 h of authentic listening; 場 and recognition flags', async () => {
      const s = await makeTestStore({
        save: {
          settings: { speedTier: 5, speaking: 'recognition' },
          progress: { station: 21 },
          stats: { bestCleanTier: 5, dictationLines: 100, dictation95at1x: 100, shadowLines: 10, shadowPass: 10, monologueBestWords: 50, rolePlays: 10, rolePlaysAllBest: 5, threeWays: 10, threeWaysCorrect: 10, speedReadBestCpm: 250 },
        },
      });
      let r = d.peraperaNow(s.meta(), s.cards, s.now());
      expect(r.axes).toEqual([0, 70, 50, 75, 75]);
      expect(r.labels[4]).toBe('場');
      expect(r.flags).toEqual(['(synthetic)']);
      expect(r.composite).toBe(Math.round((0 + 70 + 50 + 75 + 75) / 5));
      store.patch('ledger', (l) => ({ ...l, entries: [[TODAY - 1, 20 * 60, 0, 1]] }));
      r = d.peraperaNow(store.meta(), store.cards, store.now());
      expect(r.axes[1]).toBe(100);
      expect(d.externalListeningHours(store.meta())).toBe(20);
      store.patch('settings', (x) => ({ ...x, speaking: 'self' }));
      r = d.peraperaNow(store.meta(), store.cards, store.now());
      expect(r.axes[3]).toBe(70);
      expect(r.flags).toContain('(estimated)');
    });
  });

  describe('projectedArrival (design 02 §6.2)', () => {
    function activeSave(days = 28, totalDays = 30) {
      const daily: Record<number, { reps: number; ok: number; minutes: number; xp: number; input: number }> = {};
      for (let i = 0; i < days; i++) daily[TODAY - i] = { reps: 20, ok: 18, minutes: 10, xp: 50, input: 0 };
      return { daily, streak: { totalDays }, progress: { station: 1 } };
    }
    const bundles = [bundle(1, { kana: 10, vocab: 10 }), bundle(2, { kana: 10, vocab: 10 }), bundle(3, { kana: 10, vocab: 10 })];

    it('is null before 14 active days', async () => {
      const s = await makeTestStore();
      expect(d.projectedArrival(s.meta(), s.cards, bundles, 3, TODAY)).toBeNull();
      expect(d.projection(bundles, 3)).toBeNull();
    });

    it('with no realized introductions the 1-item/day floor applies; daily pace uses the full rate', async () => {
      const s = await makeTestStore({ save: activeSave() });
      const p = d.projectedArrival(s.meta(), s.cards, bundles, 3, TODAY);
      expect(p).not.toBeNull();
      // 3 stations × (20 items / 1 per day + 7-day gate wait) = 81 days at adherence 1.
      expect(p?.adherence).toBe(1);
      expect(p?.realizedRate).toBe(0);
      expect(p?.atPace).toBe(TODAY + 81);
      expect(p?.band).toEqual([TODAY + Math.ceil(81 * 0.8), TODAY + Math.ceil(81 * 1.2)]);
      // White full rate = 4 items/day + 20 kana/day (`projection.fullRateFor`) → 3 × (20 / 24 + 7) = 23.5 → 24.
      expect(p?.daily).toBe(TODAY + 24);
      expect(d.projection(bundles, 3)).toEqual(p);
    });

    it('realized pace from the log shortens the estimate; cleared stations drop out; shinsa adds 2 days', async () => {
      const cards: Record<CardKey, CardTuple> = {};
      const log: LogEntry[] = [];
      // 56 items introduced over the last 28 days → 2 per active day.
      for (let i = 0; i < 56; i++) {
        const id = `v-n4-${String(i).padStart(4, '0')}`;
        cards[`${id}#rec`] = live(1, { reps: 1, last: TODAY - (i % 28) });
        log.push([DEFAULT_TEST_NOW - (i % 28) * 86_400_000, `${id}#rec`, 3, 1000, 0, 0]);
      }
      // An old item whose history predates the ring must not count.
      cards['v-n4-9999#rec'] = live(30, { reps: 12 });
      log.push([DEFAULT_TEST_NOW, 'v-n4-9999#rec', 3, 1000, 0, 0]);
      const s = await makeTestStore({ save: activeSave(), cards });
      expect(d.itemsIntroducedIn(log, s.cards, TODAY, 'UTC')).toBe(56);
      const slow = d.projectedArrival(s.meta(), s.cards, bundles, 3, TODAY, []);
      const fast = d.projectedArrival(s.meta(), s.cards, bundles, 3, TODAY, log);
      expect(fast?.realizedRate).toBe(2);
      // rate clamps to 2 (< 4 full): 3 × (20 / 2 + 7) = 51.
      expect(fast?.atPace).toBe(TODAY + 51);
      expect((fast as NonNullable<typeof fast>).atPace).toBeLessThan((slow as NonNullable<typeof slow>).atPace);

      store.patch('progress', (p) => ({ ...p, stationsCleared: [1] }));
      const cleared = d.projectedArrival(store.meta(), store.cards, bundles, 3, TODAY, log);
      expect(cleared?.atPace).toBe(TODAY + 34);

      // Station 9 ends Yellow → +2 for the Shinsa; its 10 items at the Yellow Standard rate (8.75 → 2 realized) + 7.
      const nine = [bundle(9, { vocab: 10 })];
      const withShinsa = d.projectedArrival({ ...store.meta(), progress: { ...store.progress.value, station: 9, stationsCleared: [] } }, store.cards, nine, 9, TODAY, log);
      expect(withShinsa?.atPace).toBe(TODAY + Math.ceil(10 / 2 + 7 + 2));
    });

    it('gate wait shrinks as days since the last introduction grow; adherence is clamped to 0.3', async () => {
      const b = [bundle(2, { vocab: 10 })];
      const cards: Record<CardKey, CardTuple> = {};
      b[0].vocabIds.forEach((id, i) => {
        cards[`${id}#rec`] = live(5, { last: TODAY - 3, reps: 2 });
        if (i === 9) cards[`${id}#rec`] = live(5, { last: TODAY - 3, reps: 2 });
      });
      const s = await makeTestStore({ save: { ...activeSave(), progress: { station: 2 } }, cards });
      // Everything introduced, last intro 3 days ago → gateWait = max(1, 7 − 3) = 4; no remaining items.
      expect(d.projectedArrival(s.meta(), s.cards, b, 2, TODAY)?.atPace).toBe(TODAY + 4);
      // Only one active day in the window → adherence floor 0.3.
      const sparse = testSave({ save: { streak: { totalDays: 20 }, progress: { station: 2 }, daily: { [TODAY]: { reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 } } } });
      const p = d.projectedArrival(sparse, s.cards, b, 2, TODAY);
      expect(p?.adherence).toBe(0.3);
      expect(p?.atPace).toBe(TODAY + Math.ceil(4 / 0.3));
      expect(d.activeDaysIn(sparse, TODAY)).toBe(1);
      expect(d.lifetimeActiveDays(sparse)).toBe(20);
    });
  });
});
