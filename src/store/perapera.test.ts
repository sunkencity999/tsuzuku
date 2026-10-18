import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { S } from './defs-strings';
import {
  EAR_CAP,
  PERAPERA_LABELS,
  earAxis,
  externalListeningHours,
  mouthAxis,
  peraperaHistory,
  peraperaNow,
  readAxis,
  registerAxis,
  snapshotMonth,
  startPerapera,
  vocabAxis,
  vocabRetrievability,
} from './perapera';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

/** A reviewed card with stability `s`, last seen today (R ≈ 1). */
function live(s: number, last = TODAY): CardTuple {
  return card({ due: TODAY + 1, s, reps: 3, state: 2, last });
}

const SECTIONS_OK = { shadowLines: 10, shadowPass: 10 };

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('peraperaNow (design 05 §11)', () => {
  it('a fresh learner: the synthetic 耳 floor only, 場 unavailable before Station 21', async () => {
    const s = await makeTestStore();
    const r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes).toEqual([0, 20, 0, 0, 0]);
    expect(r.labels).toEqual(['語彙', '耳', '読', '口', '—']);
    expect(r.composite).toBe(5);
    expect(r.flags).toEqual([S.flagSynthetic, S.flagEstimated]);
    expect(r.available).toEqual([true, true, true, true, false]);
    expect(r.explain).toHaveLength(5);
    expect(r.explain[1]).toContain('tier 2');
    expect(r.explain[1]).toContain('20 h of authentic-style listening');
    expect(r.explain[2]).toBe(S.explainReadNoData);
    expect(r.explain[4]).toBe(S.explainRegisterUnavailable);
    expect(PERAPERA_LABELS).toEqual(['語彙', '耳', '読', '口', '場']);
  });

  it('語彙 sums retrievability over vocab rec/prod cards (chunks through prod)', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (let i = 0; i < 2000; i++) cards[`v-n5-${String(i).padStart(4, '0')}#rec`] = live(500);
    for (let i = 0; i < 600; i++) cards[`v-n5-${String(i).padStart(4, '0')}#prod`] = live(500);
    // Non-vocab and other facets never count.
    cards['j-食#comp'] = live(500);
    cards['v-n5-3000#listen'] = live(500);
    const s = await makeTestStore({ cards });
    const v = vocabRetrievability(s.cards, TODAY);
    expect(v.recCards).toBe(2000);
    expect(v.prodCards).toBe(600);
    expect(v.rec).toBeCloseTo(2000, 0);
    // 0.6 · 2000/10000 + 0.4 · 600/6000 = 0.12 + 0.04 = 0.16 → 16
    const r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[0]).toBe(16);
    expect(r.explain[0]).toContain('2000');
    expect(r.explain[0]).toContain('600');
    // A forgotten card contributes its retrievability, not 1.
    expect(vocabAxis(5000, 3000)).toBeCloseTo(50);
    expect(vocabAxis(50_000, 50_000)).toBe(100);
  });

  it('耳: 20 · tier · clamp(acc / 0.9, 0.5, 1), capped at 70 until 20 h of outside listening', async () => {
    const s = await makeTestStore({
      save: { settings: { speedTier: 5 }, stats: { dictationLines: 100, dictation95at1x: 100 } },
    });
    let r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[1]).toBe(EAR_CAP);
    expect(r.explain[1]).toContain('100 %');
    expect(r.explain[1]).toContain('+ 0 h outside so far');
    expect(r.explain[1]).not.toContain('{');
    // 19.9 h of listening and watching: still capped.
    store.patch('ledger', (l) => ({ ...l, entries: [[TODAY - 2, 10 * 60, 0, 1], [TODAY - 1, 9 * 60 + 54, 2, 1], [TODAY, 600, 1, 1], [TODAY, 600, 0, 0]] }));
    expect(externalListeningHours(store.meta())).toBeCloseTo(19.9);
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(70);
    store.patch('ledger', (l) => ({ ...l, entries: [...l.entries, [TODAY, 6, 2, 1]] }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(100);
    expect(r.explain[1]).not.toContain(S.explainEarCap.slice(0, 10));
    expect(r.flags).toContain(S.flagSynthetic);
  });

  it('耳 formula points', () => {
    expect(earAxis(3, 0.9, 100)).toBe(60);
    expect(earAxis(3, 0.45, 100)).toBe(30); // factor floor 0.5
    expect(earAxis(3, null, 100)).toBe(30); // no evidence → floor
    expect(earAxis(5, 1, 100)).toBe(100);
    expect(earAxis(5, 1, 19)).toBe(70);
    expect(earAxis(2, 0.72, 0)).toBeCloseTo(32); // 20 · 2 · 0.8
    expect(earAxis(9, 1, 100)).toBe(100); // tier clamped to 5
  });

  it('読 reads the best Speed Read cpm against 500', async () => {
    const s = await makeTestStore({ save: { stats: { speedReadBestCpm: 250 } } });
    const r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[2]).toBe(50);
    expect(r.explain[2]).toContain('250 cpm');
    expect(readAxis(600)).toBe(100);
    expect(readAxis(0)).toBe(0);
  });

  it('口: recognition formula, self-assessment fallback "(estimated)", voice off "(no voice)"', async () => {
    const s = await makeTestStore({
      save: { settings: { speaking: 'recognition' }, stats: { ...SECTIONS_OK, monologueBestWords: 50, monologues: 15 } },
    });
    let r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[3]).toBe(75); // 50 · 1 + 50 · 0.5
    expect(r.flags).toEqual([S.flagSynthetic]);
    expect(r.explain[3]).toContain('100 %');
    expect(r.explain[3]).toContain('50 words');

    store.patch('settings', (x) => ({ ...x, speaking: 'auto' }));
    expect(peraperaNow(store.meta(), store.cards, store.now()).axes[3]).toBe(75);

    store.patch('settings', (x) => ({ ...x, speaking: 'self' }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[3]).toBe(85); // 70 · 1 + 30 · 15/30
    expect(r.flags).toEqual([S.flagSynthetic, S.flagEstimated]);
    expect(r.explain[3]).toContain('15 of 30');

    store.patch('settings', (x) => ({ ...x, speaking: 'off' }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[3]).toBe(0);
    expect(r.labels[3]).toBe('—');
    expect(r.available[3]).toBe(false);
    expect(r.flags).toEqual([S.flagSynthetic, S.flagNoVoice]);
    expect(r.explain[3]).toBe(S.explainMouthOff);
    // Composite skips the unavailable axis: (0 + 20 + 0) / 3 ≈ 7.
    expect(r.composite).toBe(7);

    expect(mouthAxis(true, 0.5, 200, 0)).toBe(75);
    expect(mouthAxis(false, 0.5, 0, 60)).toBe(65);
    expect(mouthAxis(false, 0, 0, 0)).toBe(0);
  });

  it('場 opens at Station 21 and mixes role-play best rate with Say It Three Ways accuracy', async () => {
    const s = await makeTestStore({
      save: { progress: { station: 20 }, stats: { rolePlays: 10, rolePlaysAllBest: 5, threeWays: 10, threeWaysCorrect: 10 } },
    });
    let r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[4]).toBe(0);
    expect(r.labels[4]).toBe('—');
    expect(r.available[4]).toBe(false);
    store.patch('progress', (p) => ({ ...p, station: 21 }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[4]).toBe(75);
    expect(r.labels[4]).toBe('場');
    expect(r.explain[4]).toContain('50 %');
    expect(r.explain[4]).toContain('100 %');
    expect(registerAxis(1, 1)).toBe(100);
    expect(registerAxis(0.2, 0.4)).toBe(30);
  });

  it('composite is the rounded mean of the available axes; a full synthetic save hits the formula values', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (let i = 0; i < 5000; i++) cards[`v-n4-${String(i).padStart(4, '0')}#rec`] = live(400);
    for (let i = 0; i < 3000; i++) cards[`v-n4-${String(i).padStart(4, '0')}#prod`] = live(400);
    const s = await makeTestStore({
      cards,
      save: {
        settings: { speedTier: 4, speaking: 'recognition' },
        progress: { station: 30 },
        ledger: { entries: [[TODAY - 1, 25 * 60, 0, 1]] },
        stats: { dictationLines: 40, dictation95at1x: 36, speedReadBestCpm: 400, shadowLines: 50, shadowPass: 40, monologueBestWords: 120, rolePlays: 20, rolePlaysAllBest: 16, threeWays: 30, threeWaysCorrect: 27 },
      },
    });
    const r = peraperaNow(s.meta(), s.cards, s.now());
    // 語彙 0.6·0.5 + 0.4·0.5 = 0.5 → 50; 耳 20·4·1 = 80; 読 80; 口 50·0.8 + 50·1 = 90; 場 50·0.8 + 50·0.9 = 85
    expect(r.axes).toEqual([50, 80, 80, 90, 85]);
    expect(r.composite).toBe(Math.round((50 + 80 + 80 + 90 + 85) / 5));
    expect(r.flags).toEqual([S.flagSynthetic]);
    expect(r.available.every(Boolean)).toBe(true);
  });

  it('uses the profile zone for "today" and tolerates a bad zone id', async () => {
    const s = await makeTestStore({ cards: { 'v-n5-0001#rec': live(1, TODAY - 30) }, save: { profile: { tz: 'Not/AZone' } } });
    const r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[0]).toBe(0);
  });
});

describe('monthly history', () => {
  it('snapshotMonth writes this month once, replaces it when the vector changes, and history sorts by month', async () => {
    const s = await makeTestStore({ save: { perapera: { months: { '2025-11': [1, 2, 3, 4, 5], '2025-09': [0, 0, 0, 0, 0] } } } });
    const axes = snapshotMonth(s);
    expect(axes).toEqual([0, 20, 0, 0, 0]);
    expect(store.perapera.value.months['2026-01']).toEqual([0, 20, 0, 0, 0]);
    const before = store.perapera.value;
    expect(snapshotMonth(s)).toEqual(axes);
    expect(store.perapera.value).toBe(before);
    store.patch('stats', (x) => ({ ...x, speedReadBestCpm: 500 }));
    expect(snapshotMonth(s)).toEqual([0, 20, 100, 0, 0]);
    expect(store.perapera.value.months['2026-01']).toEqual([0, 20, 100, 0, 0]);
    expect(peraperaHistory(store.meta()).map((h) => h.month)).toEqual(['2025-09', '2025-11', '2026-01']);
    expect(peraperaHistory(store.meta())[1]?.axes).toEqual([1, 2, 3, 4, 5]);
  });

  it('startPerapera snapshots at start and on every day:rolled, and stops when unsubscribed', async () => {
    const s = await makeTestStore();
    expect(store.perapera.value.months['2026-01']).toBeUndefined();
    const stop = startPerapera(s);
    expect(store.perapera.value.months['2026-01']).toEqual([0, 20, 0, 0, 0]);
    store.patch('stats', (x) => ({ ...x, speedReadBestCpm: 250 }));
    bus.emit('day:rolled', { day: TODAY, awayDays: 0 });
    expect(store.perapera.value.months['2026-01']).toEqual([0, 20, 50, 0, 0]);
    stop();
    store.patch('stats', (x) => ({ ...x, speedReadBestCpm: 500 }));
    bus.emit('day:rolled', { day: TODAY, awayDays: 0 });
    expect(store.perapera.value.months['2026-01']).toEqual([0, 20, 50, 0, 0]);
  });
});
