/**
 * pool.ts — the i+0 / i+1 selector and the minutes estimate (design 08 §4).
 */
import type { CardKey, PoolRef } from '../content/types';
import { cardKey } from '../shared/ids';
import type { CardTuple, CardsApi } from '../shared/store-types';
import { CLIP_PAD_SECONDS, IMPLICIT_WINDOW_DAYS, MORAE_PER_SECOND, plusOneId, poolMinutes, selectPool } from './pool';
import * as barrel from './index';

const TODAY = 20000;

/** A `listen` card: `due` days from today, in `state` (default review). */
const listen = (due: number, state: CardTuple[5] = 2): CardTuple => [TODAY + due, 5, 5, 3, 0, state, TODAY - 1, 0];

function fakeCards(init: Record<string, CardTuple>): Pick<CardsApi, 'get'> {
  const map = new Map<CardKey, CardTuple>(Object.entries(init) as [CardKey, CardTuple][]);
  return { get: (k) => map.get(k) };
}

const ref = (id: string, ids: string[], morae = 14): PoolRef => ({ ref: id, ids, kana: 'わたしはコーヒーをのみます', morae });

// Known: 私 (v-0001), コーヒー (v-0011), 飲む (v-0007), は (g-002), ます (g-003). Unknown: 犬 (v-0002), 水 (v-0003), パン (v-0012), 人 (v-0008), です (g-001).
const KNOWN = new Set(['v-n5-0001', 'v-n5-0011', 'v-n5-0007', 'g-n5-002', 'g-n5-003']);

const ALL_KNOWN = ref('v-n5-0001#ex0', ['v-n5-0001', 'g-n5-002', 'v-n5-0011', 'v-n5-0007', 'g-n5-003']);
const ONE_UNKNOWN_DUE = ref('v-n5-0002#ex0', ['v-n5-0002', 'g-n5-002', 'v-n5-0011']); // 犬: listen due in 2 d
const ONE_UNKNOWN_FAR = ref('v-n5-0003#ex1', ['v-n5-0003', 'g-n5-002', 'v-n5-0007']); // 水: listen due in 9 d, review
const ONE_UNKNOWN_LEARNING = ref('s-04-1#L2', ['v-n5-0012', 'g-n5-002', 'v-n5-0007']); // パン: listen due in 30 d but still learning
const ONE_UNKNOWN_NO_CARD = ref('v-n5-0008#ex0', ['v-n5-0008', 'g-n5-002', 'v-n5-0007']); // 人: no listen card yet
const GRAMMAR_UNKNOWN = ref('g-n5-001#ex0', ['v-n5-0001', 'g-n5-001']); // です: grammar never has a listen card
const TWO_UNKNOWN = ref('s-04-2#L5', ['v-n5-0002', 'v-n5-0003', 'g-n5-002']);

const CARDS = fakeCards({
  [cardKey('v-n5-0002', 'listen')]: listen(2),
  [cardKey('v-n5-0003', 'listen')]: listen(9),
  [cardKey('v-n5-0012', 'listen')]: listen(30, 1),
  // 人 has a rec card only: its listen card has not unlocked (rec S < 2 d)
  [cardKey('v-n5-0008', 'rec')]: listen(0),
  // a cloze card for です, never a listen card
  [cardKey('g-n5-001', 'cloze')]: listen(0),
});

const POOL: PoolRef[] = [ALL_KNOWN, ONE_UNKNOWN_DUE, ONE_UNKNOWN_FAR, ONE_UNKNOWN_LEARNING, ONE_UNKNOWN_NO_CARD, GRAMMAR_UNKNOWN, TWO_UNKNOWN];

describe('selectPool i+0', () => {
  it('returns only refs whose ids are all in known, in input order', () => {
    const out = selectPool(POOL, KNOWN, CARDS, TODAY, { mode: 'i+0' });
    expect(out).toEqual([ALL_KNOWN]);
    const more = selectPool([ONE_UNKNOWN_DUE, ALL_KNOWN, ref('g-n5-002#ex0', ['g-n5-002']), ALL_KNOWN], KNOWN, CARDS, TODAY, { mode: 'i+0' });
    expect(more.map((r) => r.ref)).toEqual(['v-n5-0001#ex0', 'g-n5-002#ex0', 'v-n5-0001#ex0']);
  });

  it('an empty known set admits only refs with no ids; an empty pool yields nothing', () => {
    expect(selectPool(POOL, new Set(), CARDS, TODAY, { mode: 'i+0' })).toEqual([]);
    expect(selectPool([ref('x#ex0', [])], new Set(), CARDS, TODAY, { mode: 'i+0' })).toHaveLength(1);
    expect(selectPool([], KNOWN, CARDS, TODAY, { mode: 'i+0' })).toEqual([]);
  });
});

describe('selectPool i+1', () => {
  it('keeps refs with exactly one unknown id whose listen card exists and is due within 3 days or not yet in review state', () => {
    const out = selectPool(POOL, KNOWN, CARDS, TODAY, { mode: 'i+1' });
    expect(out.map((r) => r.ref)).toEqual(['v-n5-0002#ex0', 's-04-1#L2']);
  });

  it('the window is inclusive at today + IMPLICIT_WINDOW_DAYS and excludes the day after', () => {
    expect(IMPLICIT_WINDOW_DAYS).toBe(3);
    const edge = fakeCards({ [cardKey('v-n5-0002', 'listen')]: listen(IMPLICIT_WINDOW_DAYS) });
    const past = fakeCards({ [cardKey('v-n5-0002', 'listen')]: listen(IMPLICIT_WINDOW_DAYS + 1) });
    const overdue = fakeCards({ [cardKey('v-n5-0002', 'listen')]: listen(-40) });
    expect(selectPool([ONE_UNKNOWN_DUE], KNOWN, edge, TODAY, { mode: 'i+1' })).toHaveLength(1);
    expect(selectPool([ONE_UNKNOWN_DUE], KNOWN, past, TODAY, { mode: 'i+1' })).toHaveLength(0);
    expect(selectPool([ONE_UNKNOWN_DUE], KNOWN, overdue, TODAY, { mode: 'i+1' })).toHaveLength(1);
  });

  it('a card not yet in review state (new or learning) is rehearsable whatever its due day; relearning is not unless due', () => {
    for (const state of [0, 1] as const) {
      const c = fakeCards({ [cardKey('v-n5-0002', 'listen')]: listen(60, state) });
      expect(selectPool([ONE_UNKNOWN_DUE], KNOWN, c, TODAY, { mode: 'i+1' })).toHaveLength(1);
    }
    const relearnFar = fakeCards({ [cardKey('v-n5-0002', 'listen')]: listen(10, 3) });
    const relearnSoon = fakeCards({ [cardKey('v-n5-0002', 'listen')]: listen(1, 3) });
    expect(selectPool([ONE_UNKNOWN_DUE], KNOWN, relearnFar, TODAY, { mode: 'i+1' })).toHaveLength(0);
    expect(selectPool([ONE_UNKNOWN_DUE], KNOWN, relearnSoon, TODAY, { mode: 'i+1' })).toHaveLength(1);
  });

  it('an unknown id with no listen card is not i+1, even when the item has other cards', () => {
    expect(selectPool([ONE_UNKNOWN_NO_CARD], KNOWN, CARDS, TODAY, { mode: 'i+1' })).toEqual([]);
    expect(selectPool([GRAMMAR_UNKNOWN], KNOWN, CARDS, TODAY, { mode: 'i+1' })).toEqual([]);
  });

  it('all-known refs and refs with two unknowns are never i+1', () => {
    expect(selectPool([ALL_KNOWN, TWO_UNKNOWN], KNOWN, CARDS, TODAY, { mode: 'i+1' })).toEqual([]);
  });

  it('limit cuts the tail in input order; the selection is deterministic across calls and never mutates the input', () => {
    const pool = [ONE_UNKNOWN_DUE, ONE_UNKNOWN_LEARNING, ONE_UNKNOWN_DUE, ONE_UNKNOWN_LEARNING];
    const snapshot = JSON.stringify(pool);
    const a = selectPool(pool, KNOWN, CARDS, TODAY, { mode: 'i+1', limit: 3 });
    const b = selectPool(pool, KNOWN, CARDS, TODAY, { mode: 'i+1', limit: 3 });
    expect(a.map((r) => r.ref)).toEqual(['v-n5-0002#ex0', 's-04-1#L2', 'v-n5-0002#ex0']);
    expect(b).toEqual(a);
    expect(JSON.stringify(pool)).toBe(snapshot);
    expect(selectPool(pool, KNOWN, CARDS, TODAY, { mode: 'i+1', limit: 0 })).toEqual([]);
    expect(selectPool(POOL, KNOWN, CARDS, TODAY, { mode: 'i+0', limit: 1 })).toEqual([ALL_KNOWN]);
  });
});

describe('plusOneId', () => {
  it('names the one unknown id, or null for i+0 material and for two or more unknowns', () => {
    expect(plusOneId(ONE_UNKNOWN_DUE, KNOWN)).toBe('v-n5-0002');
    expect(plusOneId(ONE_UNKNOWN_NO_CARD, KNOWN)).toBe('v-n5-0008');
    expect(plusOneId(ALL_KNOWN, KNOWN)).toBeNull();
    expect(plusOneId(TWO_UNKNOWN, KNOWN)).toBeNull();
  });
});

describe('poolMinutes', () => {
  it('is Σ(morae / 7 + 0.5) / 60', () => {
    expect(MORAE_PER_SECOND).toBe(7);
    expect(CLIP_PAD_SECONDS).toBe(0.5);
    expect(poolMinutes([])).toBe(0);
    expect(poolMinutes([ref('a', [], 14)])).toBeCloseTo((14 / 7 + 0.5) / 60, 12);
    expect(poolMinutes([ref('a', [], 14), ref('b', [], 21), ref('c', [], 7)])).toBeCloseTo((14 / 7 + 0.5 + (21 / 7 + 0.5) + (7 / 7 + 0.5)) / 60, 12);
    // a 28-minute pool: 240 refs of 42 morae ≈ 6.5 s each
    expect(poolMinutes(Array.from({ length: 240 }, (_, i) => ref(`r${i}`, [], 42)))).toBeCloseTo(26, 0);
  });
});

describe('barrel', () => {
  it('@/learn re-exports the pool selector (the Ear Walk, Radio, planner and Station page import one body)', () => {
    expect(barrel.selectPool).toBe(selectPool);
    expect(barrel.poolMinutes).toBe(poolMinutes);
    expect(barrel.plusOneId).toBe(plusOneId);
    expect(barrel.IMPLICIT_WINDOW_DAYS).toBe(IMPLICIT_WINDOW_DAYS);
  });
});
