/**
 * gatekeeper.ts — availability, phases, timers, scoring, Grudge List, Assisted Gate (design 04 §11).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE, FIXTURE_IDS, FIXTURE_STORY_ID, G, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { SessionPlan, StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { isMature } from '../learn';
import { knownIds } from '../store/derived';
import { SELF_GRADED } from './blocks';
import { toKana, toPlain } from '../content/ruby';
import type { GrammarItem, ListeningPool, StoryItem, VocabItem } from '../content/types';
import {
  ASSISTED_AFTER_ATTEMPTS,
  FLASH_MS,
  GATE_ASSISTED_PASS,
  GATE_PASS,
  GRUDGE_REPS_FOR_REMATCH,
  STRIKE_MS,
  buildGate,
  finishGate,
  gateAvailable,
  gateOutcome,
  grudgeItems,
  grudgeKeys,
  grudgeRepsToday,
  rematchAllowed,
  resetGateAttemptsForTests,
  sampleLowR,
  scoreGate,
} from './gatekeeper';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

function live(s: number, extra: Partial<{ reps: number; d: number }> = {}): CardTuple {
  return card({ due: TODAY + 3, s, d: extra.d ?? 5, reps: extra.reps ?? 8, lapses: 0, state: 2, last: TODAY - 1 });
}

/** The 14 station-4 items (7 vocab · 4 kanji · 3 grammar), all introduced; `greenCount` of them with S ≥ 7 d. Vocab also gets prod cards (mature where `matureProd`). */
function stationCards(o: { greenCount?: number; matureProd?: boolean; matureRec?: boolean } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const ids = [...STATION_4.vocabIds, ...STATION_4.kanjiIds, ...STATION_4.grammarIds];
  const greenCount = o.greenCount ?? ids.length;
  ids.forEach((id, i) => {
    const s = i < greenCount ? (o.matureRec ? 20 : 8) : 2;
    if (id.startsWith('v-')) {
      out[`${id}#rec`] = live(s);
      out[`${id}#prod`] = live(o.matureProd ? 15 : 3);
    } else if (id.startsWith('j-')) {
      out[`${id}#comp`] = live(s);
      out[`${id}#read`] = live(o.matureRec ? 16 : 4);
    } else {
      out[`${id}#cloze`] = live(s);
      out[`${id}#prod`] = live(o.matureProd ? 15 : 3);
    }
  });
  // station-1 vocab (cumulative pool)
  for (const id of [V.私, V.犬, V.水]) out[`${id}#rec`] = live(20);
  return out;
}

function res(stepId: string, cardKey: CardKey | null, o: Partial<StepResult> = {}): StepResult {
  return { stepId, cardKey, rating: 3, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 0, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2000, errorTags: [], ...o };
}

function answerAll(plan: SessionPlan, wrong: (i: number, stepId: string) => boolean = () => false): StepResult[] {
  return plan.steps.map((s, i) => res(s.id, s.cardKey, wrong(i, s.id) ? { correct: false, rating: 1 } : {}));
}

afterEach(() => {
  resetStoreForTests();
  resetGateAttemptsForTests();
  bus.reset();
});

describe('gateAvailable', () => {
  it('needs every item introduced and ≥ 80 % Green', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards() });
    const a = gateAvailable(4, STATION_4, store.cards, TODAY);
    expect(a).toEqual({ ready: true, introduced: 14, green: 14, total: 14 });
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ greenCount: 11 }) });
    const b = gateAvailable(4, STATION_4, store.cards, TODAY);
    expect(b.ready).toBe(false);
    expect(b.green).toBe(11);
    expect(b.green).toBeLessThan(Math.ceil(0.8 * 14));
    resetStoreForTests();
    const partial = stationCards();
    delete partial[`${V.人}#rec`];
    delete partial[`${V.人}#prod`];
    await makeTestStore({ save: { progress: { station: 4 } }, cards: partial });
    const c = gateAvailable(4, STATION_4, store.cards, TODAY);
    expect(c.ready).toBe(false);
    expect(c.introduced).toBe(13);
  });

  it('⌈80 %⌉ Green passes (12 of 14)', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ greenCount: 12 }) });
    expect(gateAvailable(4, STATION_4, store.cards, TODAY).ready).toBe(true);
  });
});

describe('buildGate', () => {
  it('four phases in order with the right sizes, caps and labels', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 1, loader, available: all });
    expect(plan.mode).toBe('gate');
    expect(plan.blocks.map((b) => b.kind)).toEqual(['phase', 'phase', 'phase', 'phase']);
    const sizes = plan.blocks.map((b) => b.stepIds.length);
    expect(sizes[0]).toBeLessThanOrEqual(20);
    expect(sizes[0]).toBeGreaterThanOrEqual(12);
    expect(sizes[1]).toBeLessThanOrEqual(20);
    expect(sizes[1]).toBeGreaterThanOrEqual(10);
    expect(sizes[2]).toBe(12);
    expect(sizes[3]).toBe(3);
    for (const [i, b] of plan.blocks.entries()) for (const id of b.stepIds) expect(plan.steps.find((s) => s.id === id)!.params.phase).toBe(i + 1);
    expect(plan.steps.filter((s) => s.params.phase === 3).every((s) => s.exercise === 'sentence-listen' && !s.timed && s.params.rate === 0.9)).toBe(true);
    expect(plan.steps.filter((s) => s.params.phase === 4).every((s) => s.exercise === 'writing-dojo' && s.params.patternIds?.length === 1 && !s.timed)).toBe(true);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(plan.steps.length);
  });

  it('no timed step has a card whose tested facet is younger than 14 d; mature cards get 4 s / 12 s', async () => {
    const cards = stationCards({ matureProd: false, matureRec: false });
    cards[`${V.飲む}#rec`] = live(30);
    cards[`${V.飲む}#prod`] = live(30);
    cards[`${G.です}#cloze`] = live(30);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 2, loader, available: all });
    for (const s of plan.steps) {
      if (!s.timed) {
        expect(s.timerMs).toBeUndefined();
        continue;
      }
      const c = store.cards.get(s.cardKey!)!;
      expect(isMature(c)).toBe(true);
      expect(s.timerMs).toBe(s.params.phase === 1 ? FLASH_MS : STRIKE_MS);
    }
    const timed = plan.steps.filter((s) => s.timed);
    expect(timed.length).toBeGreaterThan(0);
    const young = plan.steps.filter((s) => s.cardKey && !isMature(store.cards.get(s.cardKey)!) && (s.params.phase === 1 || s.params.phase === 2));
    expect(young.length).toBeGreaterThan(0);
    expect(young.every((s) => !s.timed)).toBe(true);
  });

  it('Flash is recognition (meaning-guard / kanji-read / component) and Strike is production (forge / cloze), mature cards typed', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 3, loader, available: all });
    const flash = plan.steps.filter((s) => s.params.phase === 1);
    expect(flash.every((s) => ['meaning-guard', 'kanji-read', 'component-flash', 'component-assembly'].includes(s.exercise))).toBe(true);
    expect(flash.filter((s) => s.exercise === 'meaning-guard').every((s) => s.params.choices?.length === 4)).toBe(true);
    const strike = plan.steps.filter((s) => s.params.phase === 2);
    expect(strike.every((s) => ['production-forge', 'pattern-cloze', 'form-forge', 'transform', 'kana-forge'].includes(s.exercise))).toBe(true);
    expect(strike.filter((s) => s.exercise === 'pattern-cloze').every((s) => s.params.tiles === undefined)).toBe(true);
    const stationShare = flash.filter((s) => STATION_4.vocabIds.includes(s.itemId!) || STATION_4.kanjiIds.includes(s.itemId!)).length / flash.length;
    expect(stationShare).toBeGreaterThanOrEqual(0.6);
  });

  it('the Assisted Gate has no timers and three cloze instead of Final Form', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: true, revenge: false, seed: 4, loader, available: all });
    expect(plan.steps.every((s) => !s.timed && s.timerMs === undefined)).toBe(true);
    const final = plan.steps.filter((s) => s.params.phase === 4);
    expect(final).toHaveLength(3);
    expect(final.every((s) => s.exercise === 'pattern-cloze')).toBe(true);
    expect(plan.blocks[3]!.label).toContain('assisted');
  });

  it('is deterministic per seed and skips unregistered drills', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true }) });
    const a = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: all });
    const b = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: all });
    expect(a.steps.map((s) => s.id + s.cardKey)).toEqual(b.steps.map((s) => s.id + s.cardKey));
    const c = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: (id) => id !== 'sentence-listen' && id !== 'writing-dojo' && id !== 'transform' && id !== 'pattern-cloze' });
    expect(c.steps.some((s) => s.params.phase === 3)).toBe(false);
    expect(c.steps.some((s) => s.params.phase === 4)).toBe(false);
  });
});

describe('scoreGate', () => {
  it('pass needs ≥ 85 % overall AND ≥ 70 % in every phase; perfect at 100 %', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 5, loader, available: all });
    const perfect = scoreGate(plan, answerAll(plan));
    expect(perfect).toMatchObject({ overall: 1, passed: true, perfect: true, misses: [] });
    expect(perfect.phases.every((p) => p === 1)).toBe(true);
    // 2 Flash misses out of ~39 → ≥ 85 % overall and every phase ≥ 70 %
    const two = scoreGate(plan, answerAll(plan, (i) => i === 0 || i === 1));
    expect(two.passed).toBe(true);
    expect(two.perfect).toBe(false);
    expect(two.misses).toHaveLength(2);
    // every Ear step wrong: overall may still be high but phase 3 fails
    const earIds = new Set(plan.blocks[2]!.stepIds);
    const earFail = scoreGate(plan, answerAll(plan, (_, id) => earIds.has(id)));
    expect(earFail.phases[2]).toBe(0);
    expect(earFail.passed).toBe(false);
    // timeouts and guards are misses
    const t = scoreGate(plan, plan.steps.map((s, i) => res(s.id, s.cardKey, i % 2 === 0 ? { timedOut: true, correct: false, rating: 2 } : { guard: true, correct: false, rating: 1 })));
    expect(t.overall).toBe(0);
    expect(t.passed).toBe(false);
    // unanswered steps count as misses
    expect(scoreGate(plan, []).overall).toBe(0);
    expect(scoreGate(plan, []).answered).toBe(0);
  });

  it('the Assisted Gate passes at 80 % and is never perfect', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: true, revenge: false, seed: 6, loader, available: all });
    const n = plan.steps.length;
    // Misses spread over Ear, Flash and Strike (each phase stays ≥ 70 %) until the overall score dips under 85 %.
    const candidates = [...plan.blocks[2]!.stepIds.slice(0, 3), ...plan.blocks[0]!.stepIds.slice(0, 4), ...plan.blocks[1]!.stepIds.slice(0, 3)];
    const wrong = new Set<string>();
    for (const id of candidates) {
      if ((n - wrong.size) / n < GATE_PASS) break;
      wrong.add(id);
    }
    const results = answerAll(plan, (_, id) => wrong.has(id));
    const s = scoreGate(plan, results, { assisted: true });
    expect(s.overall).toBeGreaterThanOrEqual(GATE_ASSISTED_PASS);
    expect(s.overall).toBeLessThan(GATE_PASS);
    expect(s.passed).toBe(true);
    expect(scoreGate(plan, results).passed).toBe(false);
    expect(scoreGate(plan, answerAll(plan), { assisted: true }).perfect).toBe(false);
    expect(n).toBeGreaterThan(20);
  });
});

describe('finishGate and rematch', () => {
  it('a fail fills the Grudge List, counts the attempt and emits gate:result fail; the third non-pass offers the Assisted Gate', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 7, loader, available: all });
    const cap = captureEvents();
    const fail = scoreGate(plan, answerAll(plan, (i) => i % 2 === 0));
    expect(fail.passed).toBe(false);
    finishGate(4, fail, { assisted: false, revenge: false });
    const p = store.progress.value;
    expect(p.gateAttempts[4]).toBe(1);
    expect(p.stationsCleared).toEqual([]);
    expect(p.station).toBe(4);
    expect(p.grudge.length).toBe(fail.misses.length);
    expect(fail.misses.every((k) => p.grudge.includes(k))).toBe(true);
    const ev = cap.events.filter((e) => e[0] === 'gate:result');
    expect(ev).toHaveLength(1);
    expect(ev[0]![1]).toMatchObject({ station: 4, outcome: 'fail', score: fail.overall });
    // rematch needs 20 Grudge reps today, trained AFTER the fight: its own rows (at the fight's clock) do not count
    for (let i = 0; i < 30; i++) store.log.push([DEFAULT_TEST_NOW, p.grudge[i % p.grudge.length]!, 1, 3000, 5, 0]);
    let r = rematchAllowed(4);
    expect(r.allowed).toBe(false);
    expect(r.grudgeRepsNeeded).toBe(GRUDGE_REPS_FOR_REMATCH);
    expect(r.offerAssisted).toBe(false);
    expect(p.gateAttemptDay?.[4]).toBe(TODAY);
    // the fight's end is saved too, so a reload (in-memory baseline gone) still ignores the fight's own rows
    expect(p.gateAttemptAt?.[4]).toBe(DEFAULT_TEST_NOW);
    resetGateAttemptsForTests();
    r = rematchAllowed(4);
    expect(r.allowed).toBe(false);
    expect(r.grudgeRepsNeeded).toBe(GRUDGE_REPS_FOR_REMATCH);
    for (let i = 0; i < GRUDGE_REPS_FOR_REMATCH; i++) store.log.push([DEFAULT_TEST_NOW + 1000 * (i + 1), p.grudge[i % p.grudge.length]!, 3, 3000, 5, 0]);
    r = rematchAllowed(4);
    expect(r.allowed).toBe(true);
    expect(r.grudgeRepsNeeded).toBe(0);
    finishGate(4, fail, { assisted: false, revenge: false });
    finishGate(4, fail, { assisted: false, revenge: false });
    expect(store.progress.value.gateAttempts[4]).toBe(ASSISTED_AFTER_ATTEMPTS);
    expect(rematchAllowed(4).offerAssisted).toBe(true);
    cap.stop();
  });

  it('a pass clears the station, advances progress.station, clears the Grudge List; perfect counts', async () => {
    await makeTestStore({ save: { progress: { station: 4, grudge: [`${V.人}#rec`] } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 8, loader, available: all });
    const cap = captureEvents();
    const score = scoreGate(plan, answerAll(plan));
    finishGate(4, score, { assisted: false, revenge: false });
    const p = store.progress.value;
    expect(p.stationsCleared).toEqual([4]);
    expect(p.station).toBe(5);
    expect(p.gateAttemptAt?.[4]).toBeUndefined();
    expect(p.perfectGates).toBe(1);
    expect(p.grudge).toEqual([]);
    expect(p.assisted).toEqual([]);
    expect(cap.events.filter((e) => e[0] === 'gate:result')[0]![1]).toMatchObject({ station: 4, outcome: 'perfect', score: 1 });
    cap.stop();
    expect(rematchAllowed(4)).toEqual({ allowed: false, grudgeRepsNeeded: 0, offerAssisted: false });
  });

  it('a pass advances a save whose station is still 0 (onboarding wrote none): the road moves to n + 1', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    store.patch('progress', (p) => ({ ...p, station: 0 }));
    expect(store.progress.value.station).toBe(0);
    const win = { overall: 1, phases: [1, 1, 1, 1], passed: true, perfect: true, misses: [], answered: 10, total: 10 };
    finishGate(1, win, { assisted: false, revenge: false });
    expect(store.progress.value.station).toBe(2);
    expect(store.progress.value.stationsCleared).toEqual([1]);
    // a loss at a later gate keeps the station where it is
    store.patch('progress', (p) => ({ ...p, station: 2 }));
    finishGate(2, { ...win, passed: false, perfect: false, overall: 0.5 }, { assisted: false, revenge: false });
    expect(store.progress.value.station).toBe(2);
    expect(store.progress.value.gateAttemptAt?.[2]).toBe(DEFAULT_TEST_NOW);
  });

  it('an assisted pass is provisional (grey corner) until the Revenge Match; replaying an old gate never moves the station', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: true, revenge: false, seed: 10, loader, available: all });
    const cap = captureEvents();
    const s = scoreGate(plan, answerAll(plan), { assisted: true });
    finishGate(4, s, { assisted: true, revenge: false });
    expect(store.progress.value.assisted).toEqual([4]);
    expect(store.progress.value.stationsCleared).toEqual([4]);
    expect(store.progress.value.perfectGates).toBe(0);
    expect(cap.events.filter((e) => e[0] === 'gate:result')[0]![1]).toMatchObject({ outcome: 'assisted' });
    expect(rematchAllowed(4).allowed).toBe(true);
    store.patch('progress', (p) => ({ ...p, station: 9 }));
    const full = await buildGate(4, { assisted: false, revenge: true, seed: 11, loader, available: all });
    finishGate(4, scoreGate(full, answerAll(full)), { assisted: false, revenge: true });
    expect(store.progress.value.assisted).toEqual([]);
    expect(store.progress.value.station).toBe(9);
    expect(cap.events.filter((e) => e[0] === 'gate:result')[1]![1]).toMatchObject({ outcome: 'revenge' });
    cap.stop();
  });

  it('gateOutcome maps scores and flags', () => {
    const base = { overall: 0.9, phases: [0.9], passed: true, perfect: false, misses: [], answered: 1, total: 1 };
    expect(gateOutcome(base, { assisted: false, revenge: false })).toBe('pass');
    expect(gateOutcome({ ...base, perfect: true }, { assisted: false, revenge: false })).toBe('perfect');
    expect(gateOutcome(base, { assisted: true, revenge: false })).toBe('assisted');
    expect(gateOutcome(base, { assisted: false, revenge: true })).toBe('revenge');
    expect(gateOutcome({ ...base, passed: false }, { assisted: true, revenge: true })).toBe('fail');
  });
});

describe('sampleLowR', () => {
  it('draws without replacement, favoring low retrievability, deterministically', () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ cardKey: `v-n5-00${i}#rec` as CardKey, itemId: `v-n5-00${i}`, kind: 'vocab' as const, facet: 'rec' as const, r: i / 10, mature: false, exposures: 3 }));
    const mk = () => {
      let x = 12345;
      return () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648;
      };
    };
    const a = sampleLowR(mk(), pool, 5);
    const b = sampleLowR(mk(), pool, 5);
    expect(a.map((c) => c.cardKey)).toEqual(b.map((c) => c.cardKey));
    expect(new Set(a.map((c) => c.cardKey)).size).toBe(5);
    expect(sampleLowR(mk(), pool, 50)).toHaveLength(10);
    const lowCount = a.filter((c) => c.r < 0.5).length;
    expect(lowCount).toBeGreaterThanOrEqual(3);
  });
});

describe('rematch gate regressions (design 04 §11)', () => {
  it('losing every rep locks the rematch for the day although the fight wrote 20+ Grudge rows; the next day opens it', async () => {
    let clock = DEFAULT_TEST_NOW;
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }), now: () => clock });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 5, loader, available: all });
    // the fight itself: one Again row per carded step, at the fight's clock
    for (const s of plan.steps) if (s.cardKey) store.log.push([clock, s.cardKey, 1, 3000, 5, 0]);
    const lost = scoreGate(plan, answerAll(plan, () => true));
    expect(lost.overall).toBe(0);
    finishGate(4, lost, { assisted: false, revenge: false });
    expect(store.progress.value.grudge.length).toBeGreaterThan(GRUDGE_REPS_FOR_REMATCH);
    expect(rematchAllowed(4)).toMatchObject({ allowed: false, grudgeRepsNeeded: GRUDGE_REPS_FOR_REMATCH });
    // five training reps later the count has moved; a new day frees the rematch without them
    for (let i = 0; i < 5; i++) store.log.push([clock + 60_000 + i, store.progress.value.grudge[i]!, 3, 3000, 5, 0]);
    expect(rematchAllowed(4).grudgeRepsNeeded).toBe(GRUDGE_REPS_FOR_REMATCH - 5);
    clock += 86_400_000;
    expect(rematchAllowed(4)).toMatchObject({ allowed: true, grudgeRepsNeeded: 0 });
  });

  it('a save without a recorded attempt day (older build) is never locked', async () => {
    await makeTestStore({ save: { progress: { station: 4, gateAttempts: { 4: 1 }, grudge: [`${V.人}#rec`] } }, cards: stationCards() });
    expect(rematchAllowed(4).allowed).toBe(true);
  });

  it('Grudge List entries that are not card keys (hand-edited or older save) are ignored, never lock the rematch, and leave the list when a lost fight rewrites it', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards() });
    const bad = 'v-n5-0001' as CardKey; // no facet
    const today = store.today();
    store.patch('progress', (p) => ({ ...p, grudge: [bad, 'x#nope' as CardKey, `${V.犬}#rec`], gateAttempts: { 4: 1 }, gateAttemptDay: { 4: today }, gateAttemptAt: { 4: DEFAULT_TEST_NOW - 60_000 } }));
    expect(grudgeKeys()).toEqual([`${V.犬}#rec`]);
    expect(grudgeItems()).toEqual([V.犬]);
    expect(() => grudgeRepsToday()).not.toThrow();
    // the one real key still locks the same-day rematch …
    expect(rematchAllowed(4)).toMatchObject({ allowed: false, grudgeRepsNeeded: GRUDGE_REPS_FOR_REMATCH });
    // … but a list holding nothing trainable cannot: no rep could ever count against it
    store.patch('progress', (p) => ({ ...p, grudge: [bad] }));
    expect(rematchAllowed(4)).toMatchObject({ allowed: true, grudgeRepsNeeded: 0 });
    // a lost fight rewrites the list from well-formed keys only
    store.patch('progress', (p) => ({ ...p, grudge: [bad, `${V.犬}#rec`] }));
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 2, loader, available: all });
    finishGate(4, scoreGate(plan, answerAll(plan, () => true)), { assisted: false, revenge: false });
    const grudge = store.progress.value.grudge;
    expect(grudge).not.toContain(bad);
    expect(grudge).toContain(`${V.犬}#rec`);
    expect(grudge.length).toBeGreaterThan(1);
    expect(grudge.every((k) => grudgeKeys().includes(k))).toBe(true);
  });
});

describe('Ear phase params (design 04 §5, §11)', () => {
  it('every sentence-listen step grades against the kana of its ruby sentence', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 2, loader, available: all });
    const ear = plan.steps.filter((s) => s.exercise === 'sentence-listen');
    expect(ear.length).toBeGreaterThan(0);
    for (const s of ear) {
      expect(s.params.answer).toBeTruthy();
      expect(toKana(s.params.sentence!)).toBe(s.params.answer);
      expect(s.params.sentence).toMatch(/[ぁ-ゖァ-ヺ]/);
    }
  });
});

describe('chunks in the boss phases (design 04 §11 Strike)', () => {
  it('a mature prod-only chunk gets an untimed shadow rep; no timed step uses a self-graded drill', async () => {
    const cards = stationCards({ matureProd: true, matureRec: true });
    for (const id of [V.おはよう, V.はい]) {
      delete cards[`${id}#rec`];
      cards[`${id}#prod`] = live(20);
    }
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 5, loader, available: all });
    const chunks = plan.steps.filter((s) => (s.itemId === V.おはよう || s.itemId === V.はい) && (s.params.phase === 1 || s.params.phase === 2));
    expect(chunks.length).toBeGreaterThan(0);
    for (const s of chunks) {
      expect(s.exercise).toBe('shadow');
      expect(s.timed).toBe(false);
      expect(s.timerMs).toBeUndefined();
    }
    expect(plan.steps.filter((s) => s.timed).every((s) => !SELF_GRADED.has(s.exercise))).toBe(true);
    expect(plan.steps.some((s) => s.timed)).toBe(true);
  });
});

describe('Ear phase sentences the learner can know (design 04 §11)', () => {
  it('every dictated story line has all its resolved tokens known; the station words fill the rest, each on a card', async () => {
    const cards = stationCards({ matureProd: true, matureRec: true });
    for (const id of [V.パン, V.コーヒー]) {
      delete cards[`${id}#rec`];
      delete cards[`${id}#prod`];
    }
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const known = knownIds(TODAY);
    expect(known.has(V.パン)).toBe(false);
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 6, loader, available: all });
    const ear = plan.steps.filter((s) => s.params.phase === 3);
    expect(ear).toHaveLength(12);
    let lines = 0;
    let words = 0;
    for (const s of ear) {
      if (s.params.storyId !== undefined) {
        lines++;
        const line = loader.get<StoryItem>(s.params.storyId)!.lines[s.params.lineIndex!]!;
        for (const id of line.tokenIds ?? []) if (id !== null) expect(known.has(id), `${s.id}: ${toPlain(line.ja)} uses ${id}`).toBe(true);
        expect(s.params.sentence).toBe(line.ja);
      } else {
        words++;
        expect(STATION_4.vocabIds).toContain(s.itemId);
        const v = loader.get(s.itemId!)! as { word: string; kana: string };
        expect(toPlain(s.params.sentence!)).toBe(v.word);
        expect(s.params.answer).toBe(v.kana);
      }
      if (s.itemId && store.cards.byItem(s.itemId).rec) expect(s.cardKey).not.toBeNull();
    }
    expect(lines).toBeGreaterThan(0);
    expect(words).toBeGreaterThan(0);
    expect(ear.some((s) => s.itemId === V.パン && s.params.storyId !== undefined)).toBe(false);
  });
});

describe('Ear phase draws own-station pool refs before bare words (design 08 §4)', () => {
  const POOL: ListeningPool = {
    schema: 'tsuzuku.pool/1',
    station: 4,
    refs: [
      { ref: `${V.人}#ex0`, ids: [V.人, G.は, G.です], kana: 'あのひとはケンです。', morae: 10 },
      { ref: `${V.おいしい}#ex0`, ids: [V.水, G.は, V.おいしい, G.です], kana: 'このみずはおいしいです。', morae: 12 },
      { ref: `${G.です}#ex1`, ids: [G.は, V.水, G.です], kana: 'これはみずです。', morae: 8 },
      { ref: `${V.飲む}#ex0`, ids: [V.コーヒー, V.飲む], kana: 'まいあさコーヒーをのみます。', morae: 14 },
      { ref: `${FIXTURE_STORY_ID}#L1`, ids: [V.私, G.は, G.です], kana: 'わたしはハナです。', morae: 9 },
    ],
  };
  /** Station cards with パン, コーヒー and 飲む never introduced, so most story lines carry an unknown id. */
  function gappedCards(): Record<CardKey, CardTuple> {
    const cards = stationCards({ matureProd: true, matureRec: true });
    for (const id of [V.パン, V.コーヒー, V.飲む]) {
      delete cards[`${id}#rec`];
      delete cards[`${id}#prod`];
    }
    return cards;
  }
  const split = (plan: SessionPlan) => {
    const ear = plan.steps.filter((s) => s.params.phase === 3);
    return {
      ear,
      lines: ear.filter((s) => s.params.storyId !== undefined),
      refs: ear.filter((s) => s.params.storyId === undefined && /#ex\d+$/.test(s.params.clip ?? '')),
      words: ear.filter((s) => s.params.storyId === undefined && s.params.clip !== undefined && !s.params.clip.includes('#')),
    };
  };

  it('known lines first, then the pool examples whose every word is known (with their clip keys), never a line or example with an unknown id', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: gappedCards() });
    const L = createFakeLoader({ ...FIXTURE, pools: { 4: POOL } });
    const known = knownIds(TODAY);
    for (const id of [V.パン, V.コーヒー, V.飲む]) expect(known.has(id)).toBe(false);
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 6, loader: L, available: all });
    const { ear, lines, refs, words } = split(plan);
    expect(ear).toHaveLength(12);
    expect(lines.length + refs.length + words.length).toBe(12);
    // 5 known lines (the station-1 chunks おはよう / はい hold no card here either) + 3 known pool examples, then 4 bare words
    expect(lines).toHaveLength(5);
    expect(refs.map((s) => s.params.clip).sort()).toEqual([`${G.です}#ex1`, `${V.おいしい}#ex0`, `${V.人}#ex0`].sort());
    expect(words).toHaveLength(4);
    // the words came only after every known line and known pool example: the four known station words, none unknown
    for (const s of words) expect(known.has(s.itemId!), `${s.itemId} should be a known word (known ones fill first)`).toBe(true);
    for (const s of lines) {
      const line = L.get<StoryItem>(s.params.storyId!)!.lines[s.params.lineIndex!]!;
      for (const id of line.tokenIds ?? []) if (id !== null) expect(known.has(id), `${s.id}: ${toPlain(line.ja)} uses ${id}`).toBe(true);
      expect(s.params.clip).toBe(`${s.params.storyId}#L${s.params.lineIndex}`);
    }
    for (const s of refs) {
      const [itemId, ex] = s.params.clip!.split('#ex') as [string, string];
      const item = L.get<VocabItem | GrammarItem>(itemId)!;
      const example = item.examples[Number(ex)]!;
      expect(s.params.sentence).toBe(example.ja);
      expect(s.params.answer).toBe(example.kana);
      expect(toKana(s.params.sentence!)).toBe(s.params.answer);
      expect(s.params.rate).toBe(0.9);
      expect(s.timed).toBe(false);
      for (const id of POOL.refs.find((r) => r.ref === s.params.clip)!.ids) expect(known.has(id)).toBe(true);
    }
    // a grammar example is keyed on a vocab word of the sentence (its listen or rec card reaches the Grudge List)
    const desu = refs.find((s) => s.params.clip === `${G.です}#ex1`)!;
    expect(desu.itemId).toBe(V.水);
    expect(desu.cardKey).toBe(`${V.水}#rec`);
    // the pool example with the untaught word (コーヒー) never appears
    expect(ear.some((s) => s.params.clip === `${V.飲む}#ex0`)).toBe(false);
  });

  it('bare words come only after the known lines and pool examples run out, known words first, each with its own clip key', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: gappedCards() });
    // one usable pool example: 5 lines + 1 example → six bare words top the phase up, the four known station words before the two unknown
    const L = createFakeLoader({ ...FIXTURE, pools: { 4: { ...POOL, refs: [POOL.refs[0]!, POOL.refs[3]!] } } });
    const known = knownIds(TODAY);
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 6, loader: L, available: all });
    const { lines, refs, words } = split(plan);
    expect(lines).toHaveLength(5);
    expect(refs.map((s) => s.params.clip)).toEqual([`${V.人}#ex0`]);
    expect(words).toHaveLength(6);
    const knownStationWords = STATION_4.vocabIds.filter((id) => known.has(id));
    expect(knownStationWords).toHaveLength(4);
    expect(words.filter((s) => known.has(s.itemId!)).map((s) => s.itemId).sort()).toEqual([...knownStationWords].sort());
    for (const s of words) {
      expect(s.params.clip).toBe(s.itemId);
      expect(STATION_4.vocabIds).toContain(s.itemId);
      const v = L.get<VocabItem>(s.itemId!)!;
      expect(toPlain(s.params.sentence!)).toBe(v.word);
      expect(s.params.answer).toBe(v.kana);
    }
    // without pools the phase is lines + words, as before
    const bare = await buildGate(4, { assisted: false, revenge: false, seed: 6, loader, available: all });
    const plain = split(bare);
    expect(plain.refs).toHaveLength(0);
    expect(plain.lines.length + plain.words.length).toBe(12);
  });
});
