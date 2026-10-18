import type { CardKey } from '../content/types';
import { BADGE_IDS, type BadgeId } from '../shared/catalog';
import type { CardTuple, SaveMeta } from '../shared/store-types';
import {
  BADGE_BY_ID,
  BADGE_CATEGORIES,
  BADGE_DEFS,
  BADGE_DEFS_COMPLETE,
  FIRST_HEARING_SETS,
  KANA_SETS,
  TEAHOUSE_REGULAR_MINUTES,
  bestStreak,
  grammarianMet,
  isBrown,
  kanaStable,
  ledgerHoursOf,
  stationsCleared,
  weakConqueredMet,
  type CardReader,
  type TriggerEvent,
} from './badge-defs';
import { S } from './defs-strings';
import { card, testSave, type DeepPartial } from './testing';

/* ────────────────────────────────────────────────────────────────────────── */
/* Fixtures                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function reader(cards: Record<string, CardTuple>): CardReader {
  const map = new Map<string, CardTuple>(Object.entries(cards));
  return {
    get: (k) => map.get(k),
    forEach: (fn) => {
      for (const [k, t] of map) fn(k as CardKey, t);
    },
  };
}

function stable(s: number): CardTuple {
  return card({ s, state: 2, reps: 5, due: 100, last: 50 });
}

function recCards(ids: readonly string[], s: number, except?: string): Record<string, CardTuple> {
  const out: Record<string, CardTuple> = {};
  for (const id of ids) out[`${id}#rec`] = stable(id === except ? 2 : s);
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function grammarCards(n: number, brown: boolean): Record<string, CardTuple> {
  const out: Record<string, CardTuple> = {};
  for (let i = 0; i < n; i++) {
    const id = `g-n${i % 2 ? 5 : 4}-${String(i + 1).padStart(3, '0')}`;
    out[`${id}#cloze`] = stable(40);
    out[`${id}#prod`] = stable(brown || i < n - 1 ? 10 : 2);
  }
  return out;
}

interface Case {
  save?: DeepPartial<SaveMeta>;
  cards?: Record<string, CardTuple>;
  ev?: TriggerEvent;
}

const tally = { reps: 20, correct: 20, accuracy: 1, bestCombo: 20, ippon: 0, xp: 0, minutes: 5, promotions: [], questsDone: [], backlogWaiting: 0 };
const session = (mode: 'kata' | 'kumite', reps: number, correct: number): TriggerEvent => ({
  name: 'session:finished',
  payload: { planId: 'p', mode, startedAt: 0, endedAt: 1, steps: [], tally: { ...tally, reps, correct }, zen: false, resumed: false },
});
const story = (mode: 'read' | 'speed', o: Partial<{ chars: number; cpm: number; correct: number; total: number; glossTaps: number }>): TriggerEvent => ({
  name: 'story:read',
  payload: { storyId: 's-04-1', mode, chars: 400, cpm: 200, correct: 3, total: 3, glossTaps: 0, minutes: 3, bridge: false, ...o },
});

/** One satisfying and one near-miss case per badge (design 06 §2 table). */
const CASES: Record<BadgeId, { yes: Case; no: Case }> = {
  'first-step': { yes: { save: { stats: { sessions: 1 } } }, no: { save: { stats: { sessions: 0 } } } },
  gojuon: { yes: { cards: recCards(KANA_SETS.hiraganaBasic, 7) }, no: { cards: recCards(KANA_SETS.hiraganaBasic, 7, 'k-h-wo') } },
  katakana: { yes: { cards: recCards(KANA_SETS.katakanaAll, 12) }, no: { cards: recCards(KANA_SETS.katakanaAll, 12, 'k-k-kwo') } },
  voiced: { yes: { cards: recCards(KANA_SETS.hiraganaVoiced, 9) }, no: { cards: recCards(KANA_SETS.hiraganaVoiced, 9, 'k-h-pyo') } },
  'rain-candy': { yes: { save: { stats: { minimalPairTrials: 200, minimalPairCorrect: 190 } } }, no: { save: { stats: { minimalPairTrials: 200, minimalPairCorrect: 189 } } } },
  'gojuon-perfect': {
    yes: { ev: { name: 'arcade:done', payload: { mode: 'gojuon', correct: 46, misses: 0, ms: 59_000, recheck: [] } } },
    no: { ev: { name: 'arcade:done', payload: { mode: 'gojuon', correct: 46, misses: 0, ms: 60_000, recheck: [] } } },
  },
  'three-day': { yes: { save: { streak: { current: 4 } } }, no: { save: { streak: { current: 3, longest: 3 } } } },
  seven: { yes: { save: { streak: { current: 2, longest: 7 } } }, no: { save: { streak: { current: 6, longest: 6 } } } },
  thirty: { yes: { save: { streak: { current: 30 } } }, no: { save: { streak: { current: 29, longest: 29, totalDays: 400 } } } },
  hundred: { yes: { save: { streak: { totalDays: 100, current: 1 } } }, no: { save: { streak: { totalDays: 99, current: 99, longest: 99 } } } },
  year: { yes: { save: { streak: { totalDays: 365 } } }, no: { save: { streak: { totalDays: 364, longest: 364 } } } },
  'rise-eight': { yes: { save: { streak: { repairs: 1 } } }, no: { save: { streak: { repairs: 0 } } } },
  ember: { yes: { save: { streak: { emberRestores: 1 } } }, no: { save: { streak: { emberRestores: 0 } } } },
  'samurai-rest': { yes: { save: { streak: { restDaysTaken: 10 } } }, no: { save: { streak: { restDaysTaken: 9 } } } },
  'five-hundred-days': { yes: { save: { streak: { totalDays: 500 } } }, no: { save: { streak: { totalDays: 499, longest: 499 } } } },
  'thousand-cuts': { yes: { save: { stats: { reviews: 1000 } } }, no: { save: { stats: { reviews: 999 } } } },
  'ten-thousand': { yes: { save: { stats: { reviews: 10_000 } } }, no: { save: { stats: { reviews: 9_999 } } } },
  'hundred-thousand': { yes: { save: { stats: { reviews: 100_000 } } }, no: { save: { stats: { reviews: 99_999 } } } },
  'ten-chain': { yes: { save: { stats: { bestCombo: 10 } } }, no: { save: { stats: { bestCombo: 9 } } } },
  'fifty-chain': { yes: { save: { stats: { bestCombo: 50 } } }, no: { save: { stats: { bestCombo: 49 } } } },
  'hundred-chain': { yes: { save: { stats: { bestCombo: 100 } } }, no: { save: { stats: { bestCombo: 99 } } } },
  unscathed: { yes: { ev: session('kata', 15, 15) }, no: { ev: session('kata', 15, 14) } },
  ippon: { yes: { save: { stats: { ippon: 1 } } }, no: { save: { stats: { ippon: 0 } } } },
  'hundred-ippon': { yes: { save: { stats: { ippon: 100 } } }, no: { save: { stats: { ippon: 99 } } } },
  'gatekeepers-respect': { yes: { save: { progress: { stationsCleared: [1] } } }, no: { save: { progress: { stationsCleared: [] } } } },
  'perfect-gate': { yes: { save: { progress: { perfectGates: 1 } } }, no: { save: { progress: { perfectGates: 0 } } } },
  revenge: {
    yes: { ev: { name: 'gate:result', payload: { station: 5, outcome: 'revenge', score: 0.9, phases: [] } } },
    no: { ev: { name: 'gate:result', payload: { station: 5, outcome: 'assisted', score: 0.9, phases: [] } } },
  },
  halfway: { yes: { save: { progress: { stationsCleared: range(1, 27) } } }, no: { save: { progress: { stationsCleared: range(1, 26) } } } },
  kyoto: { yes: { save: { progress: { stationsCleared: range(1, 53) } } }, no: { save: { progress: { stationsCleared: range(1, 52) } } } },
  'belt-yellow': { yes: { save: { progress: { shinsaPassed: ['yellow'] } } }, no: { save: { progress: { shinsaPassed: ['orange'] } } } },
  'belt-orange': { yes: { save: { progress: { shinsaPassed: ['yellow', 'orange'] } } }, no: { save: { progress: { shinsaPassed: ['yellow'] } } } },
  'belt-green': { yes: { save: { progress: { shinsaPassed: ['green'] } } }, no: { save: { progress: { shinsaPassed: [] } } } },
  'belt-blue': { yes: { save: { progress: { shinsaPassed: ['blue'] } } }, no: { save: { progress: { shinsaPassed: ['green'] } } } },
  'belt-purple': { yes: { save: { progress: { shinsaPassed: ['purple'] } } }, no: { save: { progress: { shinsaPassed: ['blue'] } } } },
  'belt-brown': { yes: { save: { progress: { shinsaPassed: ['brown'] } } }, no: { save: { progress: { shinsaPassed: ['purple'] } } } },
  'belt-black': { yes: { save: { progress: { shinsaPassed: ['black'] } } }, no: { save: { progress: { shinsaPassed: ['brown'] } } } },
  bookworm: { yes: { save: { stats: { episodesRead: 50 } } }, no: { save: { stats: { episodesRead: 49 } } } },
  'dictionary-free': { yes: { ev: story('read', { chars: 300, correct: 2, total: 3, glossTaps: 2 }) }, no: { ev: story('read', { chars: 300, correct: 2, total: 3, glossTaps: 3 }) } },
  'speed-reader': { yes: { ev: story('speed', { cpm: 300, correct: 1, total: 1 }) }, no: { ev: story('speed', { cpm: 300, correct: 0, total: 1 }) } },
  'golden-ear': { yes: { save: { stats: { dictation95at1x: 100 } } }, no: { save: { stats: { dictation95at1x: 99 } } } },
  'fast-ear': { yes: { save: { stats: { listeningFastPasses: 20 } } }, no: { save: { stats: { listeningFastPasses: 19 } } } },
  'teahouse-regular': { yes: { save: { stats: { radioMinutes: 600 } } }, no: { save: { stats: { radioMinutes: 599 } } } },
  'first-hearing': { yes: { save: { stats: { coldSetsPassed: 20 } } }, no: { save: { stats: { coldSetsPassed: 19, coldSets: 40 } } } },
  voice: { yes: { save: { stats: { shadowPass: 1 } } }, no: { save: { stats: { shadowPass: 0 } } } },
  'shadow-warrior': { yes: { save: { stats: { shadowPass: 500 } } }, no: { save: { stats: { shadowPass: 499 } } } },
  aizuchi: { yes: { save: { stats: { rolePlaysAizuchi: 20 } } }, no: { save: { stats: { rolePlaysAizuchi: 19 } } } },
  'three-forms': { yes: { save: { stats: { threeWays: 100 } } }, no: { save: { stats: { threeWays: 99 } } } },
  'one-minute-monologue': {
    yes: { ev: { name: 'output:done', payload: { kind: 'monologue', seconds: 60, words: 80 } } },
    no: { ev: { name: 'output:done', payload: { kind: 'monologue', seconds: 59, words: 80 } }, save: { stats: { monologues: 29 } } },
  },
  'hundred-kanji': { yes: { save: { stats: { kanjiBrown: 100 } } }, no: { save: { stats: { kanjiBrown: 99 } } } },
  'thousand-kanji': { yes: { save: { stats: { kanjiBrown: 1000 } } }, no: { save: { stats: { kanjiBrown: 999 } } } },
  'thousand-words': { yes: { save: { stats: { vocabBrown: 1000 } } }, no: { save: { stats: { vocabBrown: 999 } } } },
  'five-thousand': { yes: { save: { stats: { vocabBrown: 5000 } } }, no: { save: { stats: { vocabBrown: 4999 } } } },
  grammarian: {
    yes: { save: { progress: { stationsCleared: range(1, 24) } }, cards: grammarCards(6, true) },
    no: { save: { progress: { stationsCleared: range(1, 24) } }, cards: grammarCards(6, false) },
  },
  'form-chain-20': { yes: { save: { stats: { formChainsPerfect: 20 } } }, no: { save: { stats: { formChainsPerfect: 19 } } } },
  'particle-sage': { yes: { save: { stats: { particleSlots: 500, particleSlotsCorrect: 475 } } }, no: { save: { stats: { particleSlots: 499, particleSlotsCorrect: 499 } } } },
  honest: { yes: { save: { stats: { judgeChecks: 200, honesty: 0.95 } } }, no: { save: { stats: { judgeChecks: 199, honesty: 1 } } } },
  'weak-conquered': {
    yes: { save: { weakPoints: { particle: { n: 40, ewma: 0.04, peak: 0.25, active: false } } } },
    no: { save: { weakPoints: { particle: { n: 40, ewma: 0.06, peak: 0.25, active: false } } } },
  },
  'nemesis-slayer': { yes: { save: { stats: { nemesisDefeated: 10 } } }, no: { save: { stats: { nemesisDefeated: 9 } } } },
  'shadow-breaker': { yes: { save: { kage: { wins: 10 } } }, no: { save: { kage: { wins: 9 } } } },
  'beyond-the-wall': { yes: { save: { progress: { shinsaPassed: ['brown'] } } }, no: { save: { progress: { shinsaPassed: ['purple'] } } } },
  'hundred-hours': { yes: { save: { ledger: { entries: [[100, 100 * 60, 0, 1]] } } }, no: { save: { ledger: { entries: [[100, 99 * 60, 0, 1], [100, 600, 1, 1]] } } } },
  'thousand-hours': { yes: { save: { ledger: { entries: [[100, 500 * 60, 1, 1]], monthly: { '2025-01': 500 * 60 } } } }, no: { save: { ledger: { entries: [[100, 999 * 60, 2, 1]] } } } },
  field: { yes: { save: { stats: { fieldMissions: 10 } } }, no: { save: { stats: { fieldMissions: 9 } } } },
  'first-convo': {
    yes: { save: { ledger: { missions: [{ day: 100, tier: 5, conversation: true }] } } },
    no: { save: { ledger: { missions: [{ day: 100, tier: 4, conversation: false }] } } },
  },
  comeback: { yes: { ev: { name: 'welcome-back:done', payload: {} } }, no: { ev: { name: 'kiai:entered', payload: {} } } },
  zen: { yes: { save: { stats: { zenSessions: 30 } } }, no: { save: { stats: { zenSessions: 29 } } } },
  backup: { yes: { save: { stats: { exports: 1 } } }, no: { save: { stats: { exports: 0 } } } },
  tsuzuku: { yes: { save: { stats: { sessions: 100 } } }, no: { save: { stats: { sessions: 99 } } } },
};

/** Design 01 §3 banned phrases (mirrors `src/i18n/banned-phrases.ts`). */
const BANNED = [/you lost your streak/i, /don'?t let .* down/i, /only \d+ hours? left/i, /hurry/i, /last chance/i, /don'?t break/i, /streak at risk/i, /!/];

/* ────────────────────────────────────────────────────────────────────────── */
/* Tests                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

describe('BADGE_DEFS', () => {
  it('covers BADGE_IDS exactly, in catalog order', () => {
    expect(BADGE_DEFS.map((d) => d.id)).toEqual([...BADGE_IDS]);
    expect(BADGE_DEFS).toHaveLength(68);
    expect(BADGE_DEFS_COMPLETE).toBe(true);
    for (const id of BADGE_IDS) expect(BADGE_BY_ID[id].id).toBe(id);
  });

  it('design 08 §11 listening badges: 茶屋の常連 at 600 Radio minutes (Bronze 常, indexed on listen:played only), 初耳 at 20 first hearings (Silver 初, indexed on listening:set and listen:played)', () => {
    const regular = BADGE_BY_ID['teahouse-regular'];
    expect(regular).toMatchObject({ glyph: '常', field: 'circle', tier: 'bronze', category: 'input', nameJa: '茶屋の常連' });
    expect(TEAHOUSE_REGULAR_MINUTES).toBe(600);
    expect(regular.when(testSave({ save: { stats: { radioMinutes: 600 } } }))).toBe(true);
    expect(regular.when(testSave({ save: { stats: { radioMinutes: 599 } } }))).toBe(false);
    const first = BADGE_BY_ID['first-hearing'];
    expect(first).toMatchObject({ glyph: '初', field: 'circle', tier: 'silver', category: 'input', nameJa: '初耳' });
    expect(FIRST_HEARING_SETS).toBe(20);
    expect(first.when(testSave({ save: { stats: { coldSetsPassed: 20 } } }))).toBe(true);
    expect(first.when(testSave({ save: { stats: { coldSetsPassed: 19 } } }))).toBe(false);
    expect(regular.events).toEqual(['listen:played']); // radioMinutes moves on nothing else (listening-plan contracts)
    expect(first.events).toEqual(['listening:set', 'listen:played']); // first hearings on either surface
    for (const d of [regular, first]) expect(d.describe).not.toMatch(/recorded/i);
  });

  it('every def has names, a one-glyph crest, a tier, a category, index events and visible copy', () => {
    for (const d of BADGE_DEFS) {
      expect(d.nameEn.length).toBeGreaterThan(0);
      expect(d.nameJa.length).toBeGreaterThan(0);
      expect(Array.from(d.glyph)).toHaveLength(1);
      expect(['bronze', 'silver', 'gold']).toContain(d.tier);
      expect(['circle', 'hexagon', 'tomoe', 'square', 'petal']).toContain(d.field);
      expect(BADGE_CATEGORIES).toContain(d.category);
      expect(d.hidden).toBe(false);
      expect(d.events.length).toBeGreaterThan(0);
      expect(d.describe.length).toBeGreaterThan(0);
      for (const re of BANNED) expect(d.describe).not.toMatch(re);
      for (const re of BANNED) expect(d.nameEn).not.toMatch(re);
      expect(d.describe).toBe(S.badges[d.id].describe);
    }
  });

  it('matches the design 06 §2 tiers for the belts and the streak ladder', () => {
    expect(BADGE_BY_ID['belt-yellow'].tier).toBe('bronze');
    expect(BADGE_BY_ID['belt-orange'].tier).toBe('bronze');
    expect(BADGE_BY_ID['belt-green'].tier).toBe('silver');
    expect(BADGE_BY_ID['belt-purple'].tier).toBe('silver');
    expect(BADGE_BY_ID['belt-brown'].tier).toBe('gold');
    expect(BADGE_BY_ID['belt-black'].tier).toBe('gold');
    expect(BADGE_BY_ID.thirty.tier).toBe('silver');
    expect(BADGE_BY_ID.hundred.tier).toBe('gold');
    expect(BADGE_BY_ID.kyoto.glyph).toBe('京');
    expect(BADGE_BY_ID.gojuon.field).toBe('petal');
  });

  it('a fresh save earns nothing', () => {
    const m = testSave();
    for (const d of BADGE_DEFS) expect(d.when(m, undefined, reader({}))).toBe(false);
  });

  describe.each(BADGE_IDS)('%s', (id) => {
    const d = BADGE_BY_ID[id];
    const c = CASES[id];
    it('is reachable from a constructed save', () => {
      expect(d.when(testSave({ save: c.yes.save }), c.yes.ev, reader(c.yes.cards ?? {}))).toBe(true);
    });
    it('is not earned by a near miss', () => {
      expect(d.when(testSave({ save: c.no.save }), c.no.ev, reader(c.no.cards ?? {}))).toBe(false);
    });
  });

  it('streak badges above 30 days never read the current streak', () => {
    const m = testSave({ save: { streak: { current: 400, longest: 400, totalDays: 99 } } });
    expect(BADGE_BY_ID.hundred.when(m)).toBe(false);
    expect(BADGE_BY_ID.year.when(m)).toBe(false);
    expect(BADGE_BY_ID['five-hundred-days'].when(m)).toBe(false);
    expect(BADGE_BY_ID.thirty.when(m)).toBe(true);
  });

  it('kana conditions need the card reader; without it they stay false', () => {
    const m = testSave();
    expect(BADGE_BY_ID.gojuon.when(m)).toBe(false);
    expect(BADGE_BY_ID.grammarian.when(m)).toBe(false);
  });
});

describe('helpers', () => {
  it('KANA_SETS have the CONTENT_GUIDE §3 inventory sizes and no duplicates', () => {
    expect(KANA_SETS.hiraganaBasic).toHaveLength(46);
    expect(KANA_SETS.hiraganaVoiced).toHaveLength(58);
    expect(KANA_SETS.hiraganaAll).toHaveLength(104);
    expect(KANA_SETS.katakanaAll).toHaveLength(134);
    expect(new Set(KANA_SETS.katakanaAll).size).toBe(134);
    expect(KANA_SETS.hiraganaBasic).toContain('k-h-wo');
    expect(KANA_SETS.hiraganaVoiced).toContain('k-h-du');
    expect(KANA_SETS.katakanaAll).toContain('k-k-thi');
  });

  it('kanaStable counts cards at or above the threshold; archived cards still count', () => {
    const cards = recCards(KANA_SETS.hiraganaBasic, 10, 'k-h-a');
    cards['k-h-i#rec'] = card({ s: 50, state: 2, flags: 1 });
    expect(kanaStable(KANA_SETS.hiraganaBasic, reader(cards))).toEqual({ done: 45, total: 46 });
    expect(kanaStable(KANA_SETS.hiraganaBasic, undefined)).toEqual({ done: 0, total: 46 });
  });

  it('isBrown applies the design 02 §4 thresholds', () => {
    expect(isBrown(stable(30), stable(7))).toBe(true);
    expect(isBrown(stable(29.99), stable(7))).toBe(false);
    expect(isBrown(stable(30), stable(6.99))).toBe(false);
    expect(isBrown(stable(30), undefined)).toBe(false);
  });

  it('ledgerHoursOf splits by kind and folds monthly rows into the total', () => {
    const m = testSave({ save: { ledger: { entries: [[1, 60, 0, 1], [1, 30, 2, 1], [1, 90, 1, 0], [1, 15, 3, 1]], monthly: { '2024-12': 120 } } } });
    const h = ledgerHoursOf(m);
    expect(h.listen).toBe(1);
    expect(h.watch).toBe(0.5);
    expect(h.read).toBe(1.5);
    expect(h.speak).toBe(0.25);
    expect(h.total).toBe(5.25);
  });

  it('bestStreak, stationsCleared, weakConqueredMet, grammarianMet', () => {
    expect(bestStreak(testSave({ save: { streak: { current: 2, longest: 9 } } }))).toBe(9);
    expect(stationsCleared(testSave({ save: { progress: { stationsCleared: [1, 2, 3] } } }), 1, 3)).toBe(true);
    expect(stationsCleared(testSave({ save: { progress: { stationsCleared: [1, 3] } } }), 1, 3)).toBe(false);
    expect(weakConqueredMet(testSave({ save: { weakPoints: { voicing: { n: 14, ewma: 0.01, peak: 0.5, active: false } } } }))).toBe(false);
    expect(weakConqueredMet(testSave({ save: { weakPoints: { voicing: { n: 15, ewma: 0.01, peak: 0.5, active: false } } } }))).toBe(true);
    const cleared = testSave({ save: { progress: { stationsCleared: range(1, 24) } } });
    expect(grammarianMet(cleared, reader({}))).toBe(false);
    expect(grammarianMet(cleared, reader(grammarCards(4, true)))).toBe(true);
    expect(grammarianMet(testSave({ save: { progress: { stationsCleared: range(1, 23) } } }), reader(grammarCards(4, true)))).toBe(false);
    // An N3 pattern that is not Brown does not block 文法家.
    const withN3 = { ...grammarCards(4, true), 'g-n3-001#cloze': stable(40), 'g-n3-001#prod': stable(1) };
    expect(grammarianMet(cleared, reader(withN3))).toBe(true);
  });
});
