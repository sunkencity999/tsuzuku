import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_PAD_SECONDS, MORAE_PER_SECOND } from '@/learn';
import { AUTHENTIC_GENRES, STATIONS, isAuthenticText, type CardKey, type ContentFile, type StoryItem } from '../content/types';
import { SPEED_TIER_RATES } from '../shared/audio';
import { bus } from '../shared/events';
import { moraCount } from '../shared/jp';
import type { CardTuple } from '../shared/store-types';
import { epochDay } from '../shared/time';
import { S } from './defs-strings';
import {
  ARENA_SET_FACTOR,
  COLD_PASS_TARGET,
  COLD_SETS_MIN,
  DISTINCT_AUTHENTIC_HOURS,
  EAR_CAP,
  EAR_CAP_STEPS,
  EAR_CAP_STEP_HOURS,
  EAR_GOAL_HOURS,
  PERAPERA_LABELS,
  RADIO_REHEARINGS,
  REACHABLE_IN_APP_HOURS,
  appAuthenticHours,
  authenticListeningHours,
  earAxis,
  earCap,
  earComp,
  earTier,
  externalListeningHours,
  mouthAxis,
  peraperaHistory,
  peraperaNow,
  reachableInAppHours,
  readAxis,
  registerAxis,
  snapshotMonth,
  startPerapera,
  vocabAxis,
  vocabRetrievability,
  type EarInput,
} from './perapera';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

/** A reviewed card with stability `s`, last seen today (R ≈ 1). */
function live(s: number, last = TODAY): CardTuple {
  return card({ due: TODAY + 1, s, reps: 3, state: 2, last });
}

const SECTIONS_OK = { shadowLines: 10, shadowPass: 10 };

/** A tier-5 learner who has shown tier 5 and dictates perfectly: base 100, so only comp and the cap move the axis. */
const CLEAN_FIVE = { settings: { speedTier: 5 as const }, stats: { dictationLines: 100, dictation95at1x: 100, bestCleanTier: 5 } };

function ear(o: Partial<EarInput> = {}): number {
  return earAxis({ speedTier: 3, bestCleanTier: 3, dictationAcc: 0.9, authenticHours: 0, coldPassRate: 0, coldSets: 0, ...o });
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('peraperaNow (design 05 §11, 耳 per design 08 §12)', () => {
  it('a fresh learner: 耳 reads the tier shown (1), not the dial (2); 場 unavailable before Station 21', async () => {
    const s = await makeTestStore();
    const r = peraperaNow(s.meta(), s.cards, s.now());
    // 20 · min(speedTier 2, bestCleanTier 1) · 0.5 floor = 10
    expect(r.axes).toEqual([0, 10, 0, 0, 0]);
    expect(r.labels).toEqual(['語彙', '耳', '読', '口', '—']);
    expect(r.composite).toBe(3);
    expect(r.flags).toEqual([S.flagSynthetic, S.flagEstimated]);
    expect(r.available).toEqual([true, true, true, true, false]);
    expect(r.explain).toHaveLength(5);
    expect(r.explain[1]).toContain('Listening tier 1 of 5');
    expect(r.explain[1]).toContain('Tier 1 of 5: the fastest clean set so far ran at 0.75×'); // the dial sits higher
    expect(r.explain[1]).toContain(`${EAR_GOAL_HOURS} h of authentic-style listening`);
    expect(r.explain[1]).toContain(`about ${REACHABLE_IN_APP_HOURS} h`);
    expect(r.explain[1]).not.toContain('Understood on first hearing'); // no first hearing yet
    expect(r.explain[1]).not.toContain('{');
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

  it('耳: capped at 70 below 7.5 h of authentic listening, 85 below 15 h, 100 from 15 h — outside hours and dojo minutes add up', async () => {
    const s = await makeTestStore({ save: CLEAN_FIVE });
    let r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[1]).toBe(EAR_CAP);
    expect(r.explain[1]).toContain('100 %');
    expect(r.explain[1]).toContain(`Held at 70 until ${EAR_GOAL_HOURS} h`);
    expect(r.explain[1]).toContain('0 h in the dojo');
    expect(r.explain[1]).toContain('+ 0 h outside so far');
    expect(r.explain[1]).toContain(`about ${REACHABLE_IN_APP_HOURS} h`);
    expect(r.explain[1]).not.toContain('fastest clean set'); // the dial and the tier shown agree
    expect(r.explain[1]).not.toContain('{');
    // 7.4 h of listening and watching outside (a read row and an app row never count): still 70.
    store.patch('ledger', (l) => ({ ...l, entries: [[TODAY - 2, 7 * 60, 0, 1], [TODAY - 1, 24, 2, 1], [TODAY, 600, 1, 1], [TODAY, 600, 0, 0]] }));
    expect(externalListeningHours(store.meta())).toBeCloseTo(7.4);
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(70);
    // 6 more minutes outside → 7.5 h → the 85 step.
    store.patch('ledger', (l) => ({ ...l, entries: [...l.entries, [TODAY, 6, 2, 1]] }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(85);
    expect(r.explain[1]).toContain(`Held at 85 until ${EAR_GOAL_HOURS} h`);
    expect(r.explain[1]).toContain('+ 7.5 h outside so far');
    // 7.5 h of authentic-style listening in the dojo → 15 h → uncapped.
    store.patch('stats', (x) => ({ ...x, listeningAuthenticMinutes: 7.5 * 60 }));
    expect(appAuthenticHours(store.meta())).toBe(7.5);
    expect(authenticListeningHours(store.meta())).toBe(15);
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(100);
    expect(r.explain[1]).not.toContain('Held at');
    expect(r.flags).toContain(S.flagSynthetic);
    // The dojo alone: 15 h of authentic minutes and no outside row.
    store.patch('ledger', (l) => ({ ...l, entries: [] }));
    store.patch('stats', (x) => ({ ...x, listeningAuthenticMinutes: 14.9 * 60 }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(85);
    expect(r.explain[1]).toContain('14.9 h in the dojo');
    store.patch('stats', (x) => ({ ...x, listeningAuthenticMinutes: 15 * 60 }));
    expect(peraperaNow(store.meta(), store.cards, store.now()).axes[1]).toBe(100);
  });

  it('耳 reads the tier the learner has shown: a tier-5 preset with bestCleanTier 2 reads as tier 2 and the explain names the clean set', async () => {
    const s = await makeTestStore({ save: { settings: { speedTier: 5 }, stats: { dictationLines: 10, dictation95at1x: 10, bestCleanTier: 2 } } });
    const r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[1]).toBe(40);
    expect(r.explain[1]).toContain('Listening tier 2 of 5');
    expect(r.explain[1]).toContain(`Tier 2 of 5: the fastest clean set so far ran at ${SPEED_TIER_RATES[2]}×`);
    store.patch('stats', (x) => ({ ...x, bestCleanTier: 5 }));
    expect(peraperaNow(store.meta(), store.cards, store.now()).axes[1]).toBe(70);
  });

  it('耳 comp: comprehension on first hearing enters from ten first hearings (0 % reads as half, 80 % as full) and the explain names the count', async () => {
    const s = await makeTestStore({ save: { ...CLEAN_FIVE, stats: { ...CLEAN_FIVE.stats, coldSets: 4, coldSetsPassed: 4 } } });
    let r = peraperaNow(s.meta(), s.cards, s.now());
    expect(r.axes[1]).toBe(70); // fewer than ten: factor 1
    expect(r.explain[1]).toContain('Understood on first hearing: 4 of 4 texts (100 %)');
    store.patch('stats', (x) => ({ ...x, coldSets: 10, coldSetsPassed: 0 }));
    r = peraperaNow(store.meta(), store.cards, store.now());
    expect(r.axes[1]).toBe(50); // base 100 · 0.5 floor, under the 70 cap
    expect(r.explain[1]).toContain('0 of 10 texts (0 %)');
    store.patch('stats', (x) => ({ ...x, coldSets: 10, coldSetsPassed: 6 }));
    expect(peraperaNow(store.meta(), store.cards, store.now()).axes[1]).toBe(70); // 100 · 0.75 = 75 → cap 70
    store.patch('stats', (x) => ({ ...x, coldSets: 20, coldSetsPassed: 16, listeningAuthenticMinutes: 20 * 60 }));
    expect(peraperaNow(store.meta(), store.cards, store.now()).axes[1]).toBe(100); // 80 % reads as full, uncapped
  });

  it('耳 formula points (design 08 §12)', () => {
    expect(ear()).toBe(60); // tier 3 / clean 3 / acc 0.9 / 0 h → 60, below the 70 cap
    expect(ear({ speedTier: 5, bestCleanTier: 2, dictationAcc: 1, authenticHours: 100 })).toBe(40); // reads as tier 2
    expect(ear({ speedTier: 2, bestCleanTier: 5, dictationAcc: 1, authenticHours: 100 })).toBe(40); // never above the dial
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 0 })).toBe(70);
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 7.49 })).toBe(70);
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 7.5 })).toBe(85);
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 14.99 })).toBe(85);
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 15 })).toBe(100); // 100 only from 15 h
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 100, coldSets: 10, coldPassRate: 0 })).toBe(50); // comp floor 0.5
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 100, coldSets: 9, coldPassRate: 0 })).toBe(100); // fewer than ten: 1
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 100, coldSets: 10, coldPassRate: 0.8 })).toBe(100);
    expect(ear({ speedTier: 5, bestCleanTier: 5, dictationAcc: 1, authenticHours: 100, coldSets: 10, coldPassRate: 0.6 })).toBe(75);
    expect(ear({ dictationAcc: 0.45, authenticHours: 100 })).toBe(30); // acc factor floor 0.5
    expect(ear({ dictationAcc: null, authenticHours: 100 })).toBe(30); // no evidence → floor
    expect(ear({ speedTier: 2, bestCleanTier: 2, dictationAcc: 0.72 })).toBeCloseTo(32); // 20 · 2 · 0.8
    expect(ear({ speedTier: 9, bestCleanTier: 9, dictationAcc: 1, authenticHours: 100 })).toBe(100); // tier clamped to 5
    expect(ear({ bestCleanTier: 0, authenticHours: 100 })).toBe(20); // a missing clean tier reads as 1
    expect(ear({ bestCleanTier: Number.NaN, authenticHours: 100 })).toBe(20);
    expect(earTier(5, 2)).toBe(2);
    expect(earTier(2, 5)).toBe(2);
    expect(earTier(3, Number.NaN)).toBe(1);
    expect(earComp(10, 0)).toBe(0.5);
    expect(earComp(9, 0)).toBe(1);
    expect(earComp(10, COLD_PASS_TARGET)).toBe(1);
    expect(COLD_SETS_MIN).toBe(10);
    expect([0, 7.49, 7.5, 14.99, 15, 300].map(earCap)).toEqual([70, 70, 85, 85, 100, 100]);
    expect(earCap(Number.NaN)).toBe(70);
    expect(EAR_CAP_STEP_HOURS).toEqual([7.5, 15]);
    expect(EAR_CAP_STEPS).toEqual([70, 85, 100]);
    expect(EAR_CAP).toBe(70);
    expect(EAR_GOAL_HOURS).toBe(15);
  });

  it('authenticListeningHours = outside listen + watch + the dojo authentic minutes / 60', async () => {
    const s = await makeTestStore({ save: { ledger: { entries: [[TODAY, 60, 0, 1], [TODAY, 60, 2, 1], [TODAY, 60, 1, 1], [TODAY, 60, 0, 0]] }, stats: { listeningAuthenticMinutes: 90 } } });
    expect(externalListeningHours(s.meta())).toBe(2);
    expect(appAuthenticHours(s.meta())).toBe(1.5);
    expect(authenticListeningHours(s.meta())).toBe(3.5);
    store.patch('stats', (x) => ({ ...x, listeningAuthenticMinutes: Number.NaN }));
    expect(appAuthenticHours(store.meta())).toBe(0);
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
    // Composite skips the unavailable axis: (0 + 10 + 0) / 3 ≈ 3.
    expect(r.composite).toBe(3);

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
        stats: { bestCleanTier: 4, dictationLines: 40, dictation95at1x: 36, speedReadBestCpm: 400, shadowLines: 50, shadowPass: 40, monologueBestWords: 120, rolePlays: 20, rolePlaysAllBest: 16, threeWays: 30, threeWaysCorrect: 27 },
      },
    });
    const r = peraperaNow(s.meta(), s.cards, s.now());
    // 語彙 0.6·0.5 + 0.4·0.5 = 0.5 → 50; 耳 20·4·1 = 80 (25 h outside: uncapped); 読 80; 口 50·0.8 + 50·1 = 90; 場 50·0.8 + 50·0.9 = 85
    expect(r.axes).toEqual([50, 80, 80, 90, 85]);
    expect(r.composite).toBe(Math.round((50 + 80 + 80 + 90 + 85) / 5));
    expect(r.flags).toEqual([S.flagSynthetic]);
    expect(r.available.every(Boolean)).toBe(true);
    expect(r.explain[1]).not.toContain('Held at');
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
    expect(axes).toEqual([0, 10, 0, 0, 0]);
    expect(store.perapera.value.months['2026-01']).toEqual([0, 10, 0, 0, 0]);
    const before = store.perapera.value;
    expect(snapshotMonth(s)).toEqual(axes);
    expect(store.perapera.value).toBe(before);
    store.patch('stats', (x) => ({ ...x, speedReadBestCpm: 500 }));
    expect(snapshotMonth(s)).toEqual([0, 10, 100, 0, 0]);
    expect(store.perapera.value.months['2026-01']).toEqual([0, 10, 100, 0, 0]);
    expect(peraperaHistory(store.meta()).map((h) => h.month)).toEqual(['2025-09', '2025-11', '2026-01']);
    expect(peraperaHistory(store.meta())[1]?.axes).toEqual([1, 2, 3, 4, 5]);
  });

  it('startPerapera snapshots at start and on every day:rolled, and stops when unsubscribed', async () => {
    const s = await makeTestStore();
    expect(store.perapera.value.months['2026-01']).toBeUndefined();
    const stop = startPerapera(s);
    expect(store.perapera.value.months['2026-01']).toEqual([0, 10, 0, 0, 0]);
    store.patch('stats', (x) => ({ ...x, speedReadBestCpm: 250 }));
    bus.emit('day:rolled', { day: TODAY, awayDays: 0 });
    expect(store.perapera.value.months['2026-01']).toEqual([0, 10, 50, 0, 0]);
    stop();
    store.patch('stats', (x) => ({ ...x, speedReadBestCpm: 500 }));
    bus.emit('day:rolled', { day: TODAY, awayDays: 0 });
    expect(store.perapera.value.months['2026-01']).toEqual([0, 10, 50, 0, 0]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Corpus walk — design 08 §12: "the dojo alone can carry you to about N h"  */
/* ────────────────────────────────────────────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = resolve(here, '../../public/content/stories');

/**
 * Every StoryItem under public/content/stories (read from disk, never via the
 * loader; empty when the corpus is absent). Pieces are written while this
 * test runs, so a file that does not parse yet, or has no `items` array, is
 * skipped with a warning naming it — the validator owns the corpus's shape.
 */
function loadTexts(): StoryItem[] {
  if (!existsSync(STORIES_DIR)) return [];
  const out: StoryItem[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) {
        let file: Partial<ContentFile<StoryItem>> | undefined;
        try {
          file = JSON.parse(readFileSync(full, 'utf8')) as Partial<ContentFile<StoryItem>>;
        } catch (err) {
          console.warn(`[perapera.test] skipping ${full}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if (!file || !Array.isArray(file.items)) {
          console.warn(`[perapera.test] skipping ${full}: no items array`);
          continue;
        }
        for (const s of file.items) if (s && Array.isArray(s.lines)) out.push(s);
      }
    }
  };
  walk(STORIES_DIR);
  return out;
}

/** Morae of a line's reading: punctuation and spaces are not morae (the validator's V41 rule). */
function lineMorae(kana: string): number {
  return moraCount(kana.replace(/[、。！？「」『』〜…・\s　]/gu, ''));
}

/** Speech estimate of the texts, each rendered once: Σ lines (morae ÷ 7 s + 0.5 s), in hours (design 08 §2, `learn/pool.ts`). */
function speechHours(texts: readonly StoryItem[]): number {
  let seconds = 0;
  for (const t of texts) for (const l of t.lines) seconds += lineMorae(l.kana) / MORAE_PER_SECOND + CLIP_PAD_SECONDS;
  return seconds / 3600;
}

const TEXTS = loadTexts();
const AUTHENTIC = TEXTS.filter((t) => isAuthenticText(t));
const BRIDGE = AUTHENTIC.filter((t) => t.bridge === true);
const PIECES = AUTHENTIC.filter((t) => t.bridge !== true && t.genre !== undefined && AUTHENTIC_GENRES.has(t.genre));
const CASUAL = AUTHENTIC.filter((t) => !BRIDGE.includes(t) && !PIECES.includes(t));
const AUDIO_FIRST = TEXTS.filter((t) => t.audioFirst === true);
/** The pieces that move the inventory: authentic-genre or casual-register ones (a Yellow `exchange` piece adds nothing to DISTINCT). */
const AUTHENTIC_PIECES = AUTHENTIC.filter((t) => t.audioFirst === true);
const DISTINCT = speechHours(AUTHENTIC);
const WALKED = reachableInAppHours(DISTINCT);
const QUOTA_PIECES = STATIONS.reduce((a, s) => a + s.quota.listening, 0);

describe('corpus walk: REACHABLE_IN_APP_HOURS cannot drift from the content (design 08 §12)', () => {
  it(`the formula: round(distinct authentic hours × (one Arena set ≈ 2.5× the speech + two Radio re-hearings)); the ${TEXTS.length} texts on disk reach ${WALKED} h, never more than the pinned ${REACHABLE_IN_APP_HOURS} h`, () => {
    expect(ARENA_SET_FACTOR).toBe(2.5);
    expect(RADIO_REHEARINGS).toBe(2);
    expect(REACHABLE_IN_APP_HOURS).toBe(Math.round(DISTINCT_AUTHENTIC_HOURS * (2.5 + 2)));
    expect(WALKED).toBe(Math.round(DISTINCT * 4.5));
    expect(reachableInAppHours(4)).toBe(18); // the pinned inventory: 0.96 + 0.63 + ≈ 2.4 h
    expect(reachableInAppHours(4.8)).toBe(22); // §12's earlier estimate under a looser estimator
    expect(reachableInAppHours(0)).toBe(0);
    expect(Number.isInteger(REACHABLE_IN_APP_HOURS)).toBe(true);
    // The sentence never promises less than the content on disk already carries — with 0, some or all of the
    // pieces: the moment the shipped corpus outgrows the pinned figure this fails, before the complete-corpus case.
    expect(WALKED, `the content on disk reaches ${WALKED} h but the explain sentence says about ${REACHABLE_IN_APP_HOURS} h: raise DISTINCT_AUTHENTIC_HOURS to ${DISTINCT.toFixed(2)}`).toBeLessThanOrEqual(REACHABLE_IN_APP_HOURS);
  });

  it.skipIf(TEXTS.length === 0)(`the shipped texts (${TEXTS.length}): bridge ${BRIDGE.length} + casual non-bridge dialogues ${CASUAL.length} + authentic-genre pieces ${PIECES.length} = ${AUTHENTIC.length} distinct authentic texts ≈ ${DISTINCT.toFixed(2)} h`, () => {
    expect(BRIDGE.length).toBeGreaterThanOrEqual(20); // §12: 25 bridge texts
    expect(CASUAL.length).toBeGreaterThanOrEqual(20); // §12: 29 casual non-bridge dialogues from Station 10
    for (const t of CASUAL) expect([t.id, t.kind, t.register]).toEqual([t.id, 'dialogue', 'casual']);
    expect(BRIDGE.length + CASUAL.length + PIECES.length).toBe(AUTHENTIC.length); // counted once each
    expect(speechHours(BRIDGE) + speechHours(CASUAL)).toBeGreaterThan(1); // §12: ≈ 1.1 h + 0.7 h
    expect(speechHours(BRIDGE) + speechHours(CASUAL)).toBeLessThan(4);
    expect(DISTINCT).toBeCloseTo(speechHours(BRIDGE) + speechHours(CASUAL) + speechHours(PIECES), 9);
  });

  it.skipIf(AUDIO_FIRST.length === 0)(`with ${AUDIO_FIRST.length} audio-first piece(s) on disk the sentence promises the top step: REACHABLE_IN_APP_HOURS ≥ ${EAR_GOAL_HOURS} h (the walked figure, ${WALKED} h so far, is pinned exactly once all ${QUOTA_PIECES} pieces exist)`, () => {
    expect(REACHABLE_IN_APP_HOURS).toBeGreaterThanOrEqual(EAR_GOAL_HOURS);
  });

  it.skipIf(AUDIO_FIRST.length > 0)(`no audio-first piece on disk yet (writers in progress): the ≥ ${EAR_GOAL_HOURS} h assertion waits; bridge + casual alone reach about ${WALKED} h, under the pinned ${REACHABLE_IN_APP_HOURS} h`, () => {
    expect(WALKED).toBeLessThan(REACHABLE_IN_APP_HOURS);
  });

  it.skipIf(AUTHENTIC_PIECES.length === 0)(`${AUTHENTIC_PIECES.length} authentic piece(s) on disk (authentic genre or casual register) add speech beyond the bridge + casual texts`, () => {
    expect(DISTINCT).toBeGreaterThan(speechHours(BRIDGE) + speechHours(CASUAL));
    expect(speechHours(AUTHENTIC_PIECES)).toBeGreaterThan(0);
  });

  it.skipIf(AUDIO_FIRST.length < QUOTA_PIECES)(`the complete corpus (${AUDIO_FIRST.length} of ${QUOTA_PIECES} quota pieces) pins REACHABLE_IN_APP_HOURS exactly: ${REACHABLE_IN_APP_HOURS} must equal round(${DISTINCT.toFixed(2)} × 4.5) = ${WALKED} — when they differ, set DISTINCT_AUTHENTIC_HOURS = ${DISTINCT.toFixed(2)} in perapera.ts and tell the docs owner the §12 sentence reads "about ${WALKED} h"`, () => {
    expect(REACHABLE_IN_APP_HOURS).toBe(WALKED);
    // The inventory itself within the rounding step of the sentence (4.5 h of reach per distinct hour: ± 0.3 h ≈ ± 1 h of reach).
    expect(Math.abs(DISTINCT_AUTHENTIC_HOURS - DISTINCT)).toBeLessThan(0.3);
  });
});
