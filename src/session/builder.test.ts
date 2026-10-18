/**
 * builder.ts — plans over the fixture corpus and a test store (design 03 §2.4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, Facet, ListeningPool, PoolRef, StoryItem } from '../content/types';
import { DIALOGUE, FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_IDS, FIXTURE_STORY_ID, G, STATION_1, STATION_4, STORY, V, createFakeLoader, type Fixture } from '../content/fixtures';
import { moraCount } from '../shared/jp';
import { bus } from '../shared/events';
import type { SessionPlan, Step } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { createLoader } from '../content/loader';
import { fixtureFetch } from '../content/fixtures';
import { toKana, toPlain } from '../content/ruby';
import { CardFlag } from '../shared/store-types';
import { effectiveNewPerDay as storeNewPerDay, newPerDayFor } from '../store';
import { ARENA_RECENT_DAYS, interleaveViolations, type QueueCard } from '../learn';
import { isIntroCheck, isPretestStep } from './scroll';
import { MICHIKUSA_AFTER_REP } from './blocks';
import { SessionRunner } from './runner';
import {
  LISTENING_SLOTS,
  REHEAR_DAYS,
  WALK_I1_MAX,
  WALK_REFS_MAX,
  WALK_REFS_MIN,
  accuracy7,
  buildPlan,
  byLastHearing,
  effectiveNewPerDay,
  inputBlockSteps,
  introducedToday,
  isSpeakable,
  itemKindOf,
  lastHeardGenre,
  listeningInputSteps,
  listeningSlot,
  loadPlanContext,
  michikusaFor,
  nextToHear,
  outputBlockSteps,
  pickStories,
  pitchPattern,
  resolveParams,
  splitBunsetsu,
  stepForCard,
  storyCoverage,
  walkRefs,
  withPools,
  type ListeningSlot,
} from './builder';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

/** A reviewed card due today (R ≈ 0.98 after one day at S 5). */
function due(s = 5, extra: Partial<{ reps: number; last: number; due: number; flags: number }> = {}): CardTuple {
  return card({ due: extra.due ?? TODAY, s, d: 5, reps: extra.reps ?? 6, lapses: 0, state: 2, last: extra.last ?? TODAY - 1, flags: extra.flags ?? 0 });
}

/** Base-facet cards for every fixture item (vocab rec, chunk prod, kanji comp, grammar cloze, component rec, kana rec). */
function allCards(o: { kana?: boolean; s?: number } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const s = o.s ?? 5;
  for (const id of FIXTURE_IDS.vocab) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = due(s);
  for (const id of FIXTURE_IDS.kanji) out[`${id}#comp`] = due(s);
  for (const id of FIXTURE_IDS.grammar) out[`${id}#cloze`] = due(s);
  for (const id of FIXTURE_IDS.component) out[`${id}#rec`] = due(s);
  if (o.kana) for (const id of FIXTURE_IDS.kana) out[`${id}#rec`] = due(s);
  return out;
}

function toQueue(steps: Step[]): QueueCard[] {
  return steps
    .filter((s) => s.cardKey !== null)
    .map((s) => {
      const [itemId, facet] = (s.cardKey as string).split('#') as [string, Facet];
      const qc: QueueCard = { cardKey: s.cardKey as CardKey, itemId, kind: itemKindOf(itemId, loader.get(itemId)) ?? 'vocab', facet, r: 0, mature: false, exposures: s.exposures, exercise: s.exercise };
      if (s.stepTag) qc.tag = s.stepTag;
      return qc;
    });
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('buildPlan — Kata', () => {
  it('reviews only, one Michikusa between reps 8 and 9, all ids unique', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('kata', { loader, available: all });
    expect(plan.mode).toBe('kata');
    expect(plan.station).toBe(4);
    const kinds = new Set(plan.blocks.map((b) => b.kind));
    expect(kinds).toEqual(new Set(['reviews']));
    const michikusa = plan.steps.filter((s) => s.block === 'michikusa');
    expect(michikusa).toHaveLength(1);
    expect(plan.steps.indexOf(michikusa[0]!)).toBe(MICHIKUSA_AFTER_REP);
    expect(plan.meta.michikusaId).toBe(michikusa[0]!.params.michikusaId);
    expect(FIXTURE_IDS.michikusa).toContain(plan.meta.michikusaId);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(plan.steps.length);
    expect(plan.steps.filter((s) => s.block === 'reviews').length).toBeGreaterThanOrEqual(15);
    expect(plan.steps.filter((s) => s.block === 'reviews').every((s) => !s.isNew && s.stepTag === null)).toBe(true);
    expect(michikusa[0]!.isNew).toBe(true);
  });

  it('satisfies the composer invariants: no item within 4 reps, ≤ 3 same type, wave opens easy', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards({ kana: true }) });
    const plan = await buildPlan('kata', { loader, available: all });
    const reviews = plan.steps.filter((s) => s.block === 'reviews');
    expect(interleaveViolations(toQueue(reviews))).toBe(0);
    expect(reviews.length).toBe(25);
    expect(plan.meta.dueTaken).toBe(25);
    expect(plan.meta.dueTotal).toBe(Object.keys(allCards({ kana: true })).length);
  });

  it('is deterministic: the same store yields the same plan', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const a = await buildPlan('kata', { loader, available: all });
    const b = await buildPlan('kata', { loader, available: all });
    expect(JSON.stringify(a.steps)).toBe(JSON.stringify(b.steps));
    expect(a.id).toBe(b.id);
    const c = await buildPlan('kata', { loader, available: all, seed: 7 });
    expect(c.id).not.toBe(a.id);
  });

  it('skips cards whose drill (and fallbacks) are not registered', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('kata', { loader, available: (id) => id !== 'meaning-recall' && id !== 'meaning-guard' && id !== 'meaning-judge' });
    expect(plan.steps.some((s) => s.cardKey?.endsWith('#rec') && s.cardKey.startsWith('v-'))).toBe(false);
    expect(plan.steps.some((s) => s.exercise === 'component-assembly')).toBe(true);
    const none = await buildPlan('kata', { loader, available: () => false });
    expect(none.steps.filter((s) => s.block === 'reviews')).toHaveLength(0);
  });

  it('backlog mode caps reviews at the belt cap and sets meta.backlog', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, settings: { intensity: 'custom', maxReviews: 4 } }, cards: allCards() });
    const plan = await buildPlan('kata', { loader, available: all });
    expect(plan.meta.backlog).toBe(true);
    expect(plan.meta.dueTaken).toBeLessThanOrEqual(4);
    expect(plan.steps.filter((s) => s.block === 'reviews')).toHaveLength(4);
    expect(plan.meta.dueTotal).toBe(Object.keys(allCards()).length);
  });

  it('resolves typed params for mature cards and choices for first exposures', async () => {
    const cards = allCards();
    cards[`${V.水}#rec`] = due(5, { reps: 0 });
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kata', { loader, available: all });
    const mizu = plan.steps.find((s) => s.cardKey === `${V.水}#rec`)!;
    expect(mizu.exercise).toBe('meaning-guard');
    expect(mizu.params.choices).toHaveLength(4);
    expect(mizu.params.choices).toContain('water');
    const inu = plan.steps.find((s) => s.cardKey === `${V.犬}#rec`)!;
    expect(inu.exercise).toBe('meaning-recall');
    expect(inu.params.answer).toBe('dog');
    const grammar = plan.steps.find((s) => s.cardKey === `${G.です}#cloze`)!;
    expect(grammar.exercise).toBe('pattern-cloze');
    expect(grammar.params.answer).toBe('です');
    expect(grammar.params.sentence).toContain('です');
    expect(grammar.params.blank![1]! - grammar.params.blank![0]!).toBe(2);
    const kanji = plan.steps.find((s) => s.cardKey === 'j-飲#comp')!;
    // the drill builds its tiles from the component definitions; the builder seeds the distractors by id
    expect(kanji.params.answer).toBe('飲');
    expect(kanji.params.distractorIds).toEqual(expect.arrayContaining(['c-person', 'c-sun']));
    expect(kanji.params.distractorIds).not.toContain('c-eat');
    expect(kanji.params.tiles).toBeUndefined();
  });

  it('includes an untimed recheck step for an arcade miss and clears nothing else', async () => {
    const cards = allCards();
    cards[`${V.人}#rec`] = due(20, { due: TODAY + 30, flags: 16 });
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kata', { loader, available: all });
    const re = plan.steps.find((s) => s.cardKey === `${V.人}#rec`)!;
    expect(re.params.recheck).toBe(true);
    expect(re.timed).toBe(false);
  });
});

describe('buildPlan — Kumite and Shugyō', () => {
  it('Kumite: warm-up, Scrolls with pretests and intro checks, sparring with ≥ 2 listen, output, cooldown', async () => {
    const cards = allCards();
    for (const id of FIXTURE_IDS.grammar) delete cards[`${id}#cloze`];
    for (const id of FIXTURE_IDS.component) delete cards[`${id}#rec`];
    for (const id of STATION_4.vocabIds) cards[`${id}#listen`] = due(3);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kumite', { loader, available: all });
    const kinds = plan.blocks.map((b) => b.kind);
    expect(kinds[0]).toBe('warmup');
    expect(kinds).toContain('scroll');
    expect(kinds).toContain('sparring');
    expect(kinds).toContain('michikusa');
    expect(kinds).toContain('cooldown');
    expect(plan.meta.scrollIds.length).toBeGreaterThanOrEqual(1);
    expect(plan.meta.scrollIds.length).toBeLessThanOrEqual(2);
    const scrollSteps = plan.steps.filter((s) => s.block === 'scroll');
    const pre = scrollSteps.filter(isPretestStep);
    const checks = scrollSteps.filter(isIntroCheck);
    expect(checks.length).toBe(plan.meta.newCount);
    expect(checks.every((s) => s.isNew && s.stepTag === 'intro' && s.exposures === 0)).toBe(true);
    expect(pre.length).toBeLessThanOrEqual(3 * plan.meta.scrollIds.length);
    expect(pre.every((s) => s.isNew && s.stepTag === null)).toBe(true);
    for (const id of plan.meta.scrollIds) expect(checks.some((s) => s.params.scrollId === id)).toBe(true);
    const sparring = plan.steps.filter((s) => s.block === 'sparring');
    expect(sparring.length).toBeGreaterThanOrEqual(5);
    expect(sparring.filter((s) => s.cardKey?.endsWith('#listen')).length).toBeGreaterThanOrEqual(2);
    expect(interleaveViolations(toQueue(sparring))).toBe(0);
    const taken = new Set(plan.steps.filter((s) => s.cardKey && !s.isNew).map((s) => s.cardKey));
    expect(taken.size).toBe(plan.steps.filter((s) => s.cardKey && !s.isNew).length);
  });

  it('Kumite output is a shadow set over known sentences when stories are covered', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('kumite', { loader, available: all });
    const output = plan.steps.filter((s) => s.block === 'output');
    expect(output.length).toBeGreaterThan(0);
    expect(output.every((s) => s.exercise === 'shadow')).toBe(true);
    expect(output[0]!.params.sentence).toBeTruthy();
    expect(output[0]!.params.rate).toBeGreaterThan(0);
  });

  it('Shugyō: input picks a covered story, output rotates, no block repeats a due card', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('shugyo', { loader, available: all });
    const input = plan.steps.filter((s) => s.block === 'input');
    expect(input).toHaveLength(1);
    expect(['story-read', 'listening-set']).toContain(input[0]!.exercise);
    expect(input[0]!.params.storyId).toBe(plan.meta.storyId);
    const keys = plan.steps.filter((s) => s.cardKey && !s.isNew && s.stepTag === null).map((s) => s.cardKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.blocks.every((b) => b.stepIds.length > 0)).toBe(true);
  });

  it('Shugyō with an active Weak Point tag inserts a weak block over tagged cards', async () => {
    await makeTestStore({
      save: { progress: { station: 4 }, weakPoints: { particle: { n: 20, ewma: 0.3, active: true, peak: 0.3 } } },
      cards: allCards(),
    });
    const bit = 1 << 0; // 'particle' is ERROR_TAGS[0]
    store.log.push([DEFAULT_TEST_NOW - 1000, `${G.は}#cloze`, 1, 4000, 15, bit]);
    store.log.push([DEFAULT_TEST_NOW - 2000, `${G.です}#cloze`, 1, 4000, 15, bit]);
    const plan = await buildPlan('shugyo', { loader, available: all });
    const weak = plan.steps.filter((s) => s.block === 'weak');
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.every((s) => s.params.tag === 'particle')).toBe(true);
    expect(new Set(weak.map((s) => s.cardKey))).toEqual(new Set([`${G.は}#cloze`, `${G.です}#cloze`]));
  });
});

describe('buildPlan — other modes', () => {
  it('weak mode builds a set for the tag', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    store.log.push([DEFAULT_TEST_NOW - 1000, `${V.犬}#rec`, 1, 4000, 5, 1 << 7]); // word-choice
    const plan = await buildPlan('weak', { loader, available: all, tag: 'word-choice' });
    expect(plan.mode).toBe('weak');
    expect(plan.steps.map((s) => s.cardKey)).toEqual([`${V.犬}#rec`]);
    expect(plan.steps[0]!.params.tag).toBe('word-choice');
  });

  it('welcome mode picks the 20 best-known cards', async () => {
    await makeTestStore({ save: { progress: { station: 4, welcomeBackDue: true } }, cards: allCards({ kana: true, s: 40 }) });
    const plan = await buildPlan('welcome', { loader, available: all });
    expect(plan.steps.filter((s) => s.block === 'reviews')).toHaveLength(20);
    expect(plan.steps.some((s) => s.block === 'michikusa')).toBe(true);
  });

  it('rapid / gojuon are single arcade steps with pools', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards({ kana: true, s: 20 }) });
    const rapid = await buildPlan('rapid', { loader, available: all });
    expect(rapid.steps).toHaveLength(1);
    expect(rapid.steps[0]!.exercise).toBe('rapid-fire');
    expect(rapid.steps[0]!.params.pool!.length).toBeGreaterThan(0);
    const gojuon = await buildPlan('gojuon', { loader, available: all });
    expect(gojuon.steps[0]!.exercise).toBe('gojuon-fighter');
    expect(gojuon.steps[0]!.params.pool!.every((k) => k.startsWith('k-'))).toBe(true);
  });

  it('rejects boss / exam / Kage / Dan modes with the right builder’s name', async () => {
    await makeTestStore();
    await expect(buildPlan('gate', { loader })).rejects.toThrow(/buildGate/);
    await expect(buildPlan('shinsa', { loader })).rejects.toThrow(/buildShinsa/);
    await expect(buildPlan('kage', { loader })).rejects.toThrow(/buildKage/);
    await expect(buildPlan('dan', { loader })).rejects.toThrow(/buildGauntlet/);
  });

  it('a missing station yields an honest empty plan', async () => {
    await makeTestStore({ save: { progress: { station: 9 } } });
    const plan = await buildPlan('kata', { loader, available: all });
    expect(plan.steps).toHaveLength(0);
    expect(plan.station).toBe(9);
  });
});

describe('helpers', () => {
  it('michikusa pool is stations ≤ current + 1, un-collected first, then a collected one flagged again', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, collections: { michikusa: ['m-04-1'] } } });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(michikusaFor(ctx)).toEqual({ id: 'm-04-2', isNew: true });
    store.patch('collections', (c) => ({ ...c, michikusa: ['m-04-1', 'm-04-2'] }));
    const again = michikusaFor(ctx);
    expect(again?.isNew).toBe(false);
    expect(FIXTURE_IDS.michikusa).toContain(again?.id);
  });

  it('story coverage counts resolved tokens against the known set', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const story = loader.get(FIXTURE_IDS.story[0]!)!;
    expect(storyCoverage(story as never, ctx.known)).toBe(1);
    expect(pickStories(ctx, { kind: 'story' }).map((s) => s.id)).toEqual([FIXTURE_IDS.story[0]]);
    expect(storyCoverage(story as never, new Set())).toBe(0);
  });

  it('pickStories serves unread episodes first (progress.storiesRead), then best coverage; a read story is kept, not dropped', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const [story, dialogue] = FIXTURE_IDS.story;
    expect(pickStories(ctx).map((s) => s.id)).toEqual([story, dialogue]);
    store.patch('progress', (p) => ({ ...p, storiesRead: [story!] }));
    expect(pickStories(ctx).map((s) => s.id)).toEqual([dialogue, story]);
    expect(pickStories(ctx, { kind: 'story' }).map((s) => s.id)).toEqual([story]);
    store.patch('progress', (p) => ({ ...p, storiesRead: [story!, dialogue!] }));
    expect(pickStories(ctx).map((s) => s.id)).toEqual([story, dialogue]);
  });

  it('pitch patterns and production-forge params', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(pitchPattern(0, 'みず')).toBe('平板');
    expect(pitchPattern(1, 'のむ')).toBe('頭高');
    expect(pitchPattern(2, 'いぬ')).toBe('尾高');
    expect(pitchPattern(2, 'たべる')).toBe('中高');
    const p = resolveParams(ctx, 'production-forge', loader.get(V.飲む)!, { rep: 0 });
    expect(p.answer).toBe('飲む');
    expect(p.accept).toContain('のむ');
    expect(p.candidates![0]).toBe('飲む');
    expect(p.kanaOnlyPolicy).toBe('good');
    expect(p.sentence).toContain('コーヒー');
    const ff = resolveParams(ctx, 'form-forge', loader.get(G.ます)!, { rep: 0 });
    expect(ff.targetForm).toBe('masu');
    expect(ff.answer).toMatch(/ます$/);
    const chain = resolveParams(ctx, 'form-chain', loader.get(G.ます)!, { rep: 0 });
    // the point's own forms lead; the chain is padded to 5 links (design 04 §4 "5 target forms")
    expect(chain.forms!.slice(0, 3)).toEqual(['masu', 'masen', 'mashita']);
    expect(chain.forms).toHaveLength(5);
    expect(chain.answers).toHaveLength(5);
    const pd = resolveParams(ctx, 'particle-duel', loader.get(G.は)!, { rep: 0 });
    expect(pd.answers![0]).toBe('は');
    expect(pd.blanks!.length).toBeGreaterThanOrEqual(1);
    const sc = resolveParams(ctx, 'scramble', loader.get(G.です)!, { rep: 0 });
    expect(sc.tiles!.length).toBeGreaterThan(1);
    expect(Array.from(sc.tiles!.join('')).sort().join('')).toBe(Array.from(sc.answer!).sort().join(''));
  });

  it('7-day accuracy comes from the daily rows', () => {
    expect(accuracy7({}, TODAY)).toEqual({ acc7: 1, n: 0 });
    expect(accuracy7({ [TODAY]: { reps: 10, ok: 8, minutes: 5, xp: 10, input: 0 }, [TODAY - 6]: { reps: 10, ok: 6, minutes: 5, xp: 10, input: 0 }, [TODAY - 7]: { reps: 10, ok: 0, minutes: 5, xp: 10, input: 0 } }, TODAY)).toEqual({ acc7: 0.7, n: 20 });
  });

  it('plan ids and createdAt come from the store clock, not the wall clock', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan: SessionPlan = await buildPlan('kata', { loader, available: all });
    expect(plan.createdAt).toBe(DEFAULT_TEST_NOW);
    expect(plan.day).toBe(TODAY);
    expect(plan.id.startsWith('kata-')).toBe(true);
  });
});

/* ── regressions ─────────────────────────────────────────────────────── */

const ok = { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2500, errorTags: [] as never[] };

/** Runs a plan to the end through the real runner, answering every graded step correctly. */
function runToEnd(plan: SessionPlan): SessionRunner {
  const r = new SessionRunner(plan, { loader });
  let guard = 0;
  while (!r.done.value && guard++ < 400) {
    r.submit({ ...ok, answer: r.step.value?.params.answer ?? 'x' });
    r.next();
  }
  return r;
}

describe('new-item budget (design 03 §5 cramming cap, 02 §6.1)', () => {
  it('introducedToday keeps counting after the +3 / +10 graduations, so a second Kumite does not re-offer the budget', async () => {
    const cards = allCards();
    for (const id of STATION_4.vocabIds) delete cards[`${id}#rec`];
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const before = await loadPlanContext({ loader, mode: 'kumite', available: all });
    const plan = await buildPlan('kumite', { loader, available: all });
    expect(plan.meta.newCount).toBeGreaterThan(0);
    runToEnd(plan);
    const intro = introducedToday(TODAY);
    expect(intro.vocab + intro.kanji + intro.grammar + intro.kana + intro.component).toBe(plan.meta.newCount);
    const after = await loadPlanContext({ loader, mode: 'kumite', available: all });
    expect(after.newAllowed).toBe(Math.max(0, before.newAllowed - plan.meta.newCount));
    expect(after.newTarget).toBe(Math.max(0, before.newTarget - plan.meta.newCount));
  });

  it('the budget follows the belt table at every preset; the stored mix is the custom override only — one rule, shared with the store', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, settings: { intensity: 'standard', newPerDay: { vocab: 4, kanji: 0, grammar: 0 } } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const table = newPerDayFor(ctx.belt, 'standard');
    expect(effectiveNewPerDay).toBe(storeNewPerDay);
    expect(effectiveNewPerDay(ctx.settings, ctx.belt)).toEqual(table);
    expect(ctx.newTarget).toBe(Math.round(table.vocab + table.kanji + table.grammar));
    expect(ctx.newTarget).not.toBe(4);
    expect(effectiveNewPerDay({ intensity: 'custom', newPerDay: { vocab: 4, kanji: 0, grammar: 0 } }, 'blue')).toEqual({ vocab: 4, kanji: 0, grammar: 0 });
  });
});

describe('Nemesis inside a Kumite (design 04 §9)', () => {
  const nemesisCard = (daysAgo: number): CardTuple => card({ due: TODAY, s: 1.5, d: 8, reps: 20, lapses: 9, state: 2, last: TODAY - daysAgo, flags: CardFlag.nemesis });

  it('a duel-ready item gets exactly one nemesis-duel step and is held out of the review draws', async () => {
    const cards = allCards();
    cards[`${V.飲む}#prod`] = nemesisCard(20);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kumite', { loader, available: all });
    const duels = plan.steps.filter((s) => s.exercise === 'nemesis-duel');
    expect(duels).toHaveLength(1);
    expect(duels[0]!.cardKey).toBe(`${V.飲む}#prod`);
    expect(duels[0]!.params.phase).toBe(3);
    expect(duels[0]!.params.answer).toBe('飲む');
    expect(plan.steps.filter((s) => s.cardKey === `${V.飲む}#prod`)).toHaveLength(1);
    const block = plan.blocks.find((b) => b.stepIds.includes(duels[0]!.id))!;
    expect(block.kind).toBe('weak');
    expect(plan.blocks.indexOf(block)).toBeLessThan(plan.blocks.findIndex((b) => b.kind === 'sparring'));
  });

  it('a Kata never carries the duel and the context window yields none', async () => {
    const cards = allCards();
    cards[`${V.飲む}#prod`] = nemesisCard(5);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    expect((await buildPlan('kumite', { loader, available: all })).steps.some((s) => s.exercise === 'nemesis-duel')).toBe(false);
    cards[`${V.飲む}#prod`] = nemesisCard(20);
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    expect((await buildPlan('kata', { loader, available: all })).steps.some((s) => s.exercise === 'nemesis-duel')).toBe(false);
  });
});

describe('particles and bunsetsu (design 04 §4)', () => {
  it('Particle Duel blanks only the point’s particle hints, never で inside です', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const wa = resolveParams(ctx, 'particle-duel', loader.get(G.は)!, { rep: 0 });
    const plain = toPlain(wa.sentence!);
    expect(wa.blanks!.length).toBeGreaterThanOrEqual(1);
    for (const [a, b] of wa.blanks!) expect(plain.slice(a, b)).toBe('は');
    expect(wa.answers!.every((x) => x === 'は')).toBe(true);
    const desu = resolveParams(ctx, 'particle-duel', loader.get(G.です)!, { rep: 2 });
    expect(toPlain(desu.sentence!)).toContain('です');
    expect(desu.blanks).toEqual([]);
  });

  it('splitBunsetsu keeps です・でした・ので・こと whole and still splits on real particles', () => {
    expect(splitBunsetsu('私は毎朝コーヒーを飲みます。')).toEqual(['私は', '毎朝コーヒーを', '飲みます', '。']);
    const tiles = splitBunsetsu('本日に限り、全品二割引です。');
    expect(tiles).not.toContain('す');
    expect(tiles.join('')).toBe('本日に限り、全品二割引です。');
    for (const s of ['個人情報ですので、お教えしかねます。', '皆さんにまたお会いできて、嬉しい限りです。', 'これは私のものではない。']) {
      const t = splitBunsetsu(s);
      expect(t.join('')).toBe(s);
      expect(t.some((x) => /^(す|した|しょう|の|もの|こと)$/.test(x))).toBe(false);
    }
  });

  it('a particle point’s cloze card becomes Particle Duel from Station 5 after the two choice exposures', async () => {
    const cards = allCards();
    cards[`${G.は}#cloze`] = due(5, { reps: 6 });
    await makeTestStore({ save: { progress: { station: 5 } }, cards });
    const ctx = await loadPlanContext({ loader, station: 5, available: all });
    const qc: QueueCard = { cardKey: `${G.は}#cloze`, itemId: G.は, kind: 'grammar', facet: 'cloze', r: 0.9, mature: false, exposures: 6 };
    expect(stepForCard(ctx, qc, 'reviews')!.exercise).toBe('particle-duel');
    expect(stepForCard(ctx, { ...qc, exposures: 1 }, 'reviews')!.exercise).toBe('pattern-cloze');
    const desu: QueueCard = { ...qc, cardKey: `${G.です}#cloze`, itemId: G.です };
    expect(stepForCard(ctx, desu, 'reviews')!.exercise).toBe('pattern-cloze');
    const four = await loadPlanContext({ loader, station: 4, available: all });
    expect(stepForCard(four, qc, 'reviews')!.exercise).toBe('pattern-cloze');
  });
});

describe('Form Forge gate (design 04 §4 unlocksForms)', () => {
  it('a point without unlocksForms keeps its cloze shape at Station 10; a declaring point drills only its forms', async () => {
    const cards = allCards();
    cards[`${G.です}#prod`] = due(5, { reps: 6 });
    cards[`${G.ます}#prod`] = due(5, { reps: 6 });
    await makeTestStore({ save: { progress: { station: 10 } }, cards });
    const ctx = await loadPlanContext({ loader, station: 10, available: all });
    const desu: QueueCard = { cardKey: `${G.です}#prod`, itemId: G.です, kind: 'grammar', facet: 'prod', r: 0.9, mature: false, exposures: 6 };
    expect(stepForCard(ctx, desu, 'reviews')!.exercise).toBe('pattern-cloze');
    expect(resolveParams(ctx, 'form-forge', loader.get(G.です)!, { rep: 3 })).toEqual({});
    const masu = stepForCard(ctx, { ...desu, cardKey: `${G.ます}#prod`, itemId: G.ます }, 'reviews')!;
    expect(masu.exercise).toBe('form-forge');
    expect(['masu', 'masen', 'mashita']).toContain(masu.params.targetForm);
  });
});

describe('sentence params carry ruby (design 04 §3, §5, §7)', () => {
  it('dictation and shadow grade against the kana of the sentence; sentence drills keep furigana with plain offsets', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const nomu = loader.get(V.飲む)! as { examples: { ja: string; kana: string }[] };
    for (const drill of ['sentence-listen', 'shadow'] as const) {
      const p = resolveParams(ctx, drill, loader.get(V.飲む)!, { rep: 0 });
      expect(toKana(p.sentence!)).toBe(nomu.examples[0]!.kana);
      expect(p.answer).toBe(nomu.examples[0]!.kana);
      expect(p.accept).toContain(toPlain(nomu.examples[0]!.ja));
    }
    const word = resolveParams(ctx, 'sentence-listen', { ...(loader.get(V.飲む)! as object), examples: [] } as never, { rep: 0 });
    expect(toKana(word.sentence!)).toBe('のむ');
    expect(toPlain(word.sentence!)).toBe('飲む');
    const cloze = resolveParams(ctx, 'pattern-cloze', loader.get(G.です)!, { rep: 0 });
    expect(cloze.sentence).toContain('{');
    expect(toPlain(cloze.sentence!).slice(cloze.blank![0], cloze.blank![1])).toBe('です');
    const read = resolveParams(ctx, 'kanji-read', loader.get('j-人')!, { rep: 0 });
    expect(read.sentence).toContain('{');
    expect(toPlain(read.sentence!).slice(read.blank![0], read.blank![1])).toBe('人');
    expect(read.answer).toBe('ひと');
    const scramble = resolveParams(ctx, 'scramble', loader.get(G.です)!, { rep: 0 });
    expect(scramble.sentence).toContain('{');
    expect(scramble.answer).toBe(toPlain(scramble.sentence!));
    const forge = resolveParams(ctx, 'production-forge', loader.get(V.飲む)!, { rep: 0 });
    expect(forge.sentence).not.toContain('{');
  });
});

describe('station entry stays light (design 07 §6, §9)', () => {
  it('the Dojo loads no due-card files; a plan loads only the due queue it can draw; the next station is prefetched', async () => {
    const cards: Record<CardKey, CardTuple> = { [`${V.私}#rec`]: due(5) };
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const dojoFetch = fixtureFetch();
    await loadPlanContext({ loader: createLoader(dojoFetch as unknown as typeof fetch), station: 4, mode: 'dojo' });
    expect(dojoFetch.calls.some((c) => c.endsWith('vocab-n5-001.json'))).toBe(false);
    expect(dojoFetch.calls.some((c) => c.endsWith('vocab-n5-002.json'))).toBe(true);
    const kataFetch = fixtureFetch();
    await loadPlanContext({ loader: createLoader(kataFetch as unknown as typeof fetch), station: 4, mode: 'kata' });
    expect(kataFetch.calls.some((c) => c.endsWith('vocab-n5-001.json'))).toBe(true);
    const prefetch: number[] = [];
    const spy = { ...loader, prefetchStation: (n: number) => prefetch.push(n) };
    await loadPlanContext({ loader: spy, station: 4 });
    expect(prefetch).toEqual([5]);
  });
});

const STATION_1_KANA_COUNT = 10;

describe('first session after Nihonbashi (BUILD_STATUS first-run walk)', () => {
  it('Station 1 with no cards: Kata is honestly empty, Kumite is the two kana Scrolls', async () => {
    await makeTestStore({ save: { progress: { station: 1 }, profile: { onboardedAt: 1 } } });
    const kata = await buildPlan('kata', { loader, available: all });
    expect(kata.steps).toHaveLength(0);
    const k = await buildPlan('kumite', { loader, available: all });
    expect(k.steps.length).toBeGreaterThan(0);
    expect(k.blocks.map((b) => b.kind)).toEqual(['scroll']);
    expect(k.meta.scrollIds).toEqual(['1-1', '1-2']);
    // one intro check per item on its base facet, plus a second one on the kana `prod` facet (Kana Ear), so the
    // prod card created at introduction is served and leaves state 0
    const intros = k.steps.filter(isIntroCheck);
    expect(intros.filter((s) => !s.id.includes('#')).length).toBe(k.meta.newCount); // base facet (rec; prod for the two chunks)
    const prod = intros.filter((s) => s.id.endsWith('#prod'));
    expect(prod.length).toBe(STATION_1_KANA_COUNT);
    expect(prod.every((s) => s.itemId?.startsWith('k-') && (s.exercise === 'kana-ear' || s.exercise === 'kana-forge'))).toBe(true);
    expect(k.steps.every((s) => s.isNew && s.block === 'scroll')).toBe(true);
  });
});


/* ── listening (design 08 §4, §10.4, §11) ────────────────────────────── */

const { learnerSpeaker: _noPart, ...DIALOGUE_NO_PART } = DIALOGUE;
void _noPart;
/** An audio-first dialogue piece with no part for the learner (a counter exchange): never a role-play. */
const PIECE: StoryItem = { ...DIALOGUE_NO_PART, id: 's-04-4', titleEn: 'At the counter', audioFirst: true, genre: 'exchange' };
/** An audio-first told piece (`kind: 'story'`, narrated). */
const PIECE_2: StoryItem = { ...STORY, id: 's-04-5', titleEn: 'Hana introduces herself', audioFirst: true, genre: 'self-intro', narrator: 'ハナ' };

const exRef = (itemId: string, k: number, ids: string[], kana: string): PoolRef => ({ ref: `${itemId}#ex${k}`, ids, kana, morae: moraCount(kana) });
function lineRefs(story: StoryItem): PoolRef[] {
  return story.lines.map((l, i) => ({ ref: `${story.id}#L${i}`, ids: (l.tokenIds ?? []).filter((x): x is string => x !== null), kana: l.kana, morae: moraCount(l.kana) })).filter((r) => r.ids.length > 0);
}
/** The Station-4 pool as `content:assign` would write it: every fixture sentence whose words all link, with their ids. */
const POOL_4: ListeningPool = {
  schema: 'tsuzuku.pool/1',
  station: 4,
  refs: [
    exRef(V.犬, 0, [V.犬, V.水, V.飲む], 'いぬがみずをのみます。'),
    exRef(V.水, 0, [V.水], 'みずをください。'),
    exRef(V.食べる, 0, [V.パン, V.食べる], 'パンをたべます。'),
    exRef(V.飲む, 0, [V.コーヒー, V.飲む], 'まいあさコーヒーをのみます。'),
    exRef(V.人, 0, [V.人, G.は, G.です], 'あのひとはケンです。'),
    exRef(V.コーヒー, 0, [V.コーヒー, G.は, V.おいしい, G.です], 'コーヒーはおいしいです。'),
    exRef(V.パン, 0, [V.パン, V.食べる], 'パンをたべますか。'),
    exRef(V.おいしい, 0, [V.水, G.は, V.おいしい, G.です], 'このみずはおいしいです。'),
    exRef(G.です, 1, [G.は, V.水, G.です], 'これはみずです。'),
    exRef(G.ます, 1, [V.水, V.飲む, G.ます], 'みずをのみます。'),
    ...lineRefs(STORY),
    ...lineRefs(DIALOGUE),
  ],
};

/** The fixture with audio-first pieces at Station 4 and (unless `pools: false`) its listening pool. */
function listeningFixture(o: { pieces?: StoryItem[]; pools?: boolean } = {}): Fixture {
  const pieces = o.pieces ?? [PIECE, PIECE_2];
  return {
    ...FIXTURE,
    items: { ...FIXTURE.items, ...Object.fromEntries(pieces.map((p) => [p.id, p])) },
    stations: [STATION_1, { ...STATION_4, storyIds: [...STATION_4.storyIds, ...pieces.map((p) => p.id)] }],
    ...(o.pools === false ? {} : { pools: { 4: POOL_4 } }),
  };
}

describe('listening Input block (design 08 §11)', () => {
  const L = createFakeLoader(listeningFixture());
  const ctxFor = async () => withPools(await loadPlanContext({ loader: L, station: 4, available: all }));
  /** The first day at or after TODAY that opens with `slot` (consecutive listening days walk the slots). */
  const dayOf = (slot: ListeningSlot): number => {
    let d = TODAY;
    while (listeningSlot(d) !== slot) d++;
    return d;
  };

  it('rotates: an unheard audio-first piece, a dialogue the next listening day, an Ear Walk the day after', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await ctxFor();
    expect(ctx.pools?.map((p) => p.station)).toEqual([4]);
    const d0 = dayOf('piece');
    expect(listeningSlot(d0 + 2)).toBe('dialogue');
    expect(listeningSlot(d0 + 4)).toBe('walk');
    const piece = listeningInputSteps({ ...ctx, today: d0 });
    expect(piece.slot).toBe('piece');
    expect([PIECE.id, PIECE_2.id]).toContain(piece.storyId);
    expect(piece.steps[0]!.exercise).toBe('listening-set');
    expect(piece.steps[0]!.block).toBe('input');
    expect(piece.steps[0]!.params.storyId).toBe(piece.storyId);
    expect(piece.steps[0]!.params.refs).toBeUndefined();
    const dialogue = listeningInputSteps({ ...ctx, today: d0 + 2 });
    expect(dialogue.slot).toBe('dialogue');
    expect(dialogue.storyId).toBe(FIXTURE_DIALOGUE_ID);
    const walk = listeningInputSteps({ ...ctx, today: d0 + 4 });
    expect(walk.slot).toBe('walk');
    expect(walk.storyId).toBeUndefined();
    expect(walk.steps).toHaveLength(1);
    const refs = walk.steps[0]!.params.refs!;
    expect(refs.length).toBeGreaterThanOrEqual(WALK_REFS_MIN);
    expect(refs.length).toBeLessThanOrEqual(WALK_REFS_MAX);
    expect(walk.steps[0]!.params.storyId).toBeUndefined();
    expect(walk.steps[0]!.itemId).toBeNull();
    expect(new Set(refs).size).toBe(refs.length);
    // every ref is i+0 / i+1 for the fixture known set (here every item is known, so all i+0)
    const byRef = new Map(POOL_4.refs.map((r) => [r.ref, r]));
    for (const ref of refs) {
      const r = byRef.get(ref);
      expect(r, ref).toBeDefined();
      expect(r!.ids.filter((id) => !ctx.known.has(id)).length, ref).toBeLessThanOrEqual(1);
    }
  });

  it('never serves the same genre twice in a row (from progress.listened), and a heard piece is skipped while an unheard one exists', async () => {
    await makeTestStore({ save: { progress: { station: 4, listened: [PIECE.id] } }, cards: allCards() });
    const ctx = await ctxFor();
    const d0 = dayOf('piece');
    // the last text heard was an `exchange` piece → the other genre's piece is served
    expect(listeningInputSteps({ ...ctx, today: d0 }).storyId).toBe(PIECE_2.id);
    store.patch('progress', (p) => ({ ...p, listened: [PIECE_2.id] }));
    expect(listeningInputSteps({ ...ctx, today: d0 }).storyId).toBe(PIECE.id);
    // both heard → nothing unheard → the slot falls through to the dialogue
    store.patch('progress', (p) => ({ ...p, listened: [PIECE.id, PIECE_2.id] }));
    const fell = listeningInputSteps({ ...ctx, today: d0 });
    expect(fell.slot).toBe('dialogue');
    expect(fell.storyId).toBe(FIXTURE_DIALOGUE_ID);
    // an unheard piece of the same genre as the last hearing is skipped too: the dialogue takes the day
    const sameGenre = createFakeLoader(listeningFixture({ pieces: [PIECE, { ...PIECE_2, genre: 'exchange' }] }));
    const ctx2 = await withPools(await loadPlanContext({ loader: sameGenre, station: 4, available: all }));
    store.patch('progress', (p) => ({ ...p, listened: [PIECE.id] }));
    const r = listeningInputSteps({ ...ctx2, today: d0 });
    expect(r.slot).toBe('dialogue');
    expect(r.storyId).toBe(FIXTURE_DIALOGUE_ID);
  });

  it('re-serves heard texts by last hearing: a heard text waits behind every unheard one, and once everything is heard the last-hearing order (oldest first) is walked by listening day', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await ctxFor();
    const d1 = dayOf('dialogue');
    // unheard plain dialogue first, before the unheard pieces
    expect(listeningInputSteps({ ...ctx, today: d1 }).storyId).toBe(FIXTURE_DIALOGUE_ID);
    // the dialogue heard ten listening days ago: an unheard piece comes before re-serving it
    store.patch('progress', (p) => ({ ...p, listened: [FIXTURE_DIALOGUE_ID] }));
    expect(listeningInputSteps({ ...ctx, today: d1 }).storyId).toBe(PIECE.id);
    // everything heard: the day walks the last-hearing order (`nextToHear`), whichever order the texts were last heard in
    const k = Math.floor(Math.abs(d1) / 2); // the listening-day index `nextToHear` reduces modulo the candidates
    for (const order of [
      [PIECE.id, FIXTURE_DIALOGUE_ID, PIECE_2.id],
      [PIECE_2.id, PIECE.id, FIXTURE_DIALOGUE_ID],
      [FIXTURE_DIALOGUE_ID, PIECE_2.id, PIECE.id],
    ]) {
      store.patch('progress', (p) => ({ ...p, listened: order }));
      // the text heard last has no genre to avoid when it is the dialogue; a piece's genre bars itself, so the rotation runs over the rest
      const avoid = order[2] === FIXTURE_DIALOGUE_ID ? null : order[2];
      const cands = order.filter((id) => id !== avoid);
      expect(listeningInputSteps({ ...ctx, today: d1 }).storyId).toBe(cands[k % cands.length]);
    }
    expect(byLastHearing([PIECE, PIECE_2, DIALOGUE], [DIALOGUE.id, PIECE.id]).map((s) => s.id)).toEqual([PIECE_2.id, DIALOGUE.id, PIECE.id]);
    expect(byLastHearing([PIECE, DIALOGUE, PIECE_2], []).map((s) => s.id)).toEqual([DIALOGUE.id, PIECE.id, PIECE_2.id]);
    // Radio moves a re-heard id to the back (`progress.listened` is a least-recently-heard order): the dialogue heard
    // first and then re-heard on the Radio now waits behind the piece
    expect(byLastHearing([PIECE, PIECE_2, DIALOGUE], [PIECE.id, DIALOGUE.id]).map((s) => s.id)).toEqual([PIECE_2.id, PIECE.id, DIALOGUE.id]);
  });

  it('once every text is heard the slot rotates by listening day: N heard texts come round every N listening days, never the least-recently-heard one on every day', async () => {
    // every text heard, the dialogue last (no genre to avoid); no pools, so every slot falls through to the dialogue slot
    await makeTestStore({ save: { progress: { station: 4, listened: [PIECE.id, PIECE_2.id, FIXTURE_DIALOGUE_ID] } }, cards: allCards() });
    const ctx = { ...(await ctxFor()), pools: [] as ListeningPool[] };
    const d0 = dayOf('piece');
    // a pass appends nothing to progress.listened (append-once), so three consecutive listening days must still differ
    const served = [d0, d0 + 2, d0 + 4].map((day) => listeningInputSteps({ ...ctx, today: day }).storyId);
    expect(new Set(served).size).toBe(3);
    expect([...served].sort()).toEqual([FIXTURE_DIALOGUE_ID, PIECE.id, PIECE_2.id].sort());
    // the fourth listening day starts the round again
    expect(listeningInputSteps({ ...ctx, today: d0 + 6 }).storyId).toBe(served[0]);
    // seven heard texts: a text returns after seven listening days — fourteen calendar days
    const seven: StoryItem[] = Array.from({ length: 7 }, (_, i) => ({ ...DIALOGUE, id: `s-04-${i + 10}` }));
    const all7 = seven.map((s) => s.id);
    const round = Array.from({ length: 7 }, (_, i) => nextToHear(seven, all7, d0 + 2 * i)!.id);
    expect(new Set(round).size).toBe(7);
    expect(nextToHear(seven, all7, d0 + 14)!.id).toBe(round[0]);
    // while any candidate is unheard, the unheard one is served whatever the day
    for (const day of [d0, d0 + 2, d0 + 4]) expect(nextToHear(seven, all7.slice(1), day)!.id).toBe(all7[0]);
    expect(nextToHear([], all7, d0)).toBeUndefined();
  });

  it('a text the Arena passed within 14 days (progress.arenaAt) is closed to the day walk while another candidate is open: a Radio re-hearing between two listening days no longer brings yesterday\'s text back', async () => {
    const A: StoryItem = { ...DIALOGUE, id: 's-04-20' };
    const B: StoryItem = { ...DIALOGUE, id: 's-04-21' };
    const C: StoryItem = { ...DIALOGUE, id: 's-04-22' };
    const xs = [A, B, C];
    const d = 3; // listening-day index floor(3 / 2) = 1 → the second of the walked order
    const listened = [A.id, B.id, C.id];
    expect(nextToHear(xs, listened, d)!.id).toBe(B.id);
    // the Arena passes B (stamps arenaAt[B] = d, `listened` unchanged); the Radio then re-hears B (moved to the back, no stamp)
    const afterRadio = [A.id, C.id, B.id];
    expect(byLastHearing(xs, afterRadio).map((s) => s.id)).toEqual([A.id, C.id, B.id]);
    // without the stamp the shifted walk lands on B again on the very next listening day…
    expect(nextToHear(xs, afterRadio, d + 2)!.id).toBe(B.id);
    // …with it B stays closed through day + 13 and the walk picks among A and C
    const stamped = { [B.id]: d };
    expect(REHEAR_DAYS).toBe(ARENA_RECENT_DAYS); // the one 14-day window (@/learn pool.ts), shared with the Radio
    expect(REHEAR_DAYS).toBe(14);
    for (let day = d + 1; day < d + REHEAR_DAYS; day++) expect(nextToHear(xs, afterRadio, day, stamped)!.id, `day ${day}`).not.toBe(B.id);
    expect(new Set([d + 2, d + 4].map((day) => nextToHear(xs, afterRadio, day, stamped)!.id))).toEqual(new Set([A.id, C.id]));
    // open again from day + 14 (walk index floor(17 / 2) % 3 = 2 → the last of [A, C, B])
    expect(nextToHear(xs, afterRadio, d + REHEAR_DAYS, stamped)!.id).toBe(B.id);
    // every candidate closed: the walk runs over all of them, as without stamps
    const allClosed = { [A.id]: d, [B.id]: d, [C.id]: d };
    expect(nextToHear(xs, afterRadio, d + 2, allClosed)!.id).toBe(nextToHear(xs, afterRadio, d + 2)!.id);
    // an unheard candidate comes first whatever the stamps say
    expect(nextToHear(xs, [A.id, B.id], d + 2, { [C.id]: d })!.id).toBe(C.id);
    // seven heard texts, one passed per listening day: each returns exactly 14 days after its pass
    const seven: StoryItem[] = Array.from({ length: 7 }, (_, i) => ({ ...DIALOGUE, id: `s-04-${i + 30}` }));
    const all7 = seven.map((s) => s.id);
    const arenaAt: Record<string, number> = {};
    const served: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = d + 2 * i;
      const t = nextToHear(seven, all7, day, arenaAt)!;
      served.push(t.id);
      arenaAt[t.id] = day;
    }
    expect(new Set(served).size).toBe(7);
    expect(nextToHear(seven, all7, d + 14, arenaAt)!.id).toBe(served[0]);
    arenaAt[served[0]!] = d + 14;
    expect(nextToHear(seven, all7, d + 16, arenaAt)!.id).toBe(served[1]);
    // through the block: the text the dialogue slot served and the Arena passed today is not served again on the next listening day
    await makeTestStore({ save: { progress: { station: 4, listened: [PIECE.id, PIECE_2.id, FIXTURE_DIALOGUE_ID] } }, cards: allCards() });
    const ctx = { ...(await ctxFor()), pools: [] as ListeningPool[] };
    const d0 = dayOf('piece');
    const first = listeningInputSteps({ ...ctx, today: d0 }).storyId!;
    store.patch('progress', (p) => ({ ...p, arenaAt: { [first]: d0 } })); // what ListeningArena writes on a passed set
    for (let day = d0 + 1; day < d0 + REHEAR_DAYS; day++) expect(listeningInputSteps({ ...ctx, today: day }).storyId, `day ${day}`).not.toBe(first);
    // open again from day + 14: the walk over all three comes round to it within the next three listening days
    expect(Array.from({ length: 6 }, (_, i) => listeningInputSteps({ ...ctx, today: d0 + REHEAR_DAYS + i }).storyId)).toContain(first);
  });

  it('a kana track in progress.listened (the Radio) does not lift the genre rule: the last TEXT heard still bars a same-genre piece; a plain dialogue heard last does lift it', async () => {
    const sameGenre = createFakeLoader(listeningFixture({ pieces: [PIECE, { ...PIECE_2, genre: 'exchange' }] }));
    await makeTestStore({ save: { progress: { station: 4, listened: [PIECE.id, 'morae-beats'] } }, cards: allCards() });
    const ctx = await withPools(await loadPlanContext({ loader: sameGenre, station: 4, available: all }));
    expect(lastHeardGenre(ctx)).toBe('exchange');
    const r = listeningInputSteps({ ...ctx, today: dayOf('piece') });
    expect(r.slot).toBe('dialogue');
    expect(r.storyId).toBe(FIXTURE_DIALOGUE_ID);
    // a plain dialogue heard last has no genre: the unheard same-genre piece is served
    store.patch('progress', (p) => ({ ...p, listened: [PIECE.id, FIXTURE_DIALOGUE_ID, 'morae-beats'] }));
    expect(lastHeardGenre(ctx)).toBeUndefined();
    expect(listeningInputSteps({ ...ctx, today: dayOf('piece') }).storyId).toBe(PIECE_2.id);
    // only kana tracks heard: nothing to avoid
    store.patch('progress', (p) => ({ ...p, listened: ['morae-beats'] }));
    expect(lastHeardGenre(ctx)).toBeUndefined();
  });

  it('an Ear Walk keeps room for i+1 sentences: with a rehearsable unknown word the walk carries two sentences with that one unknown, after the i+0 ones', async () => {
    const cards = allCards();
    delete cards[`${V.犬}#rec`]; // 犬 unknown…
    cards[`${V.犬}#listen`] = due(); // …with a listen card due today: the word FSRS wants rehearsed
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const ctx = await ctxFor();
    expect(ctx.known.has(V.犬)).toBe(false);
    const byRef = new Map(POOL_4.refs.map((r) => [r.ref, r]));
    expect(POOL_4.refs.filter((r) => r.ids.includes(V.犬)).length).toBeGreaterThanOrEqual(WALK_I1_MAX);
    const refs = walkRefs(ctx);
    expect(refs).toHaveLength(WALK_REFS_MAX);
    const unknowns = refs.map((ref) => byRef.get(ref)!.ids.filter((id) => !ctx.known.has(id)));
    expect(unknowns.filter((u) => u.length === 1 && u[0] === V.犬)).toHaveLength(WALK_I1_MAX);
    expect(unknowns.filter((u) => u.length === 0)).toHaveLength(WALK_REFS_MAX - WALK_I1_MAX);
    expect(unknowns.map((u) => u.length)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    // the walk step carries them
    const walk = listeningInputSteps({ ...ctx, today: dayOf('walk') });
    expect(walk.slot).toBe('walk');
    expect(walk.steps[0]!.params.refs!.some((ref) => byRef.get(ref)!.ids.includes(V.犬))).toBe(true);
    // without a listen card the unknown word is not rehearsable: the walk is all i+0
    delete cards[`${V.犬}#listen`];
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const ctx2 = await ctxFor();
    const refs2 = walkRefs(ctx2);
    expect(refs2).toHaveLength(WALK_REFS_MAX);
    expect(refs2.every((ref) => byRef.get(ref)!.ids.every((id) => ctx2.known.has(id)))).toBe(true);
  });

  it('without pieces and without pools the block still listens: the dialogue in every slot, and a covered story as the last resort', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plain = createFakeLoader(listeningFixture({ pieces: [], pools: false }));
    const ctx = await withPools(await loadPlanContext({ loader: plain, station: 4, available: all }));
    expect(ctx.pools).toEqual([]);
    for (const slot of LISTENING_SLOTS) {
      const r = listeningInputSteps({ ...ctx, today: dayOf(slot) });
      expect(r.steps, slot).toHaveLength(1);
      expect(r.storyId, slot).toBe(FIXTURE_DIALOGUE_ID);
      expect(r.steps[0]!.params.refs).toBeUndefined();
    }
    // a station with no dialogue at all: a covered story is heard as a set rather than an empty block
    const r = listeningInputSteps({ ...ctx, stories: ctx.stories.filter((s) => s.kind === 'story') });
    expect(r.slot).toBe('story');
    expect(r.storyId).toBe(FIXTURE_STORY_ID);
    // and with nothing covered the block is honestly empty
    expect(listeningInputSteps({ ...ctx, known: new Set<string>() }).steps).toHaveLength(0);
  });

  it('a Shugyō on a listening day carries the block from the rotation (end to end through buildPlan)', async () => {
    // the Shugyō listens on odd days (blocks.ts): move the clock to one
    const day = TODAY % 2 === 1 ? TODAY : TODAY + 1;
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards(), now: () => DEFAULT_TEST_NOW + (day - TODAY) * 86_400_000 });
    const plan = await buildPlan('shugyo', { loader: L, available: all });
    const input = plan.steps.filter((s) => s.block === 'input');
    expect(input).toHaveLength(1);
    expect(input[0]!.exercise).toBe('listening-set');
    if (listeningSlot(day) === 'walk') {
      expect(input[0]!.params.refs!.length).toBeGreaterThanOrEqual(WALK_REFS_MIN);
      expect(plan.meta.storyId).toBeUndefined();
    } else {
      expect(input[0]!.params.storyId).toBe(plan.meta.storyId);
    }
  });

  it('the role-play Output block never picks an audio-first dialogue without learnerSpeaker, and does pick one with it', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await ctxFor();
    expect(isSpeakable(PIECE)).toBe(false);
    expect(pickStories({ ...ctx, stories: [PIECE, STORY] }, { speakable: true })).toEqual([]);
    const none = outputBlockSteps({ ...ctx, stories: [PIECE, STORY] }, 'role-play', 1);
    expect(none.some((s) => s.exercise === 'role-play')).toBe(false);
    const withPart: StoryItem = { ...PIECE, learnerSpeaker: 'ケン' };
    expect(isSpeakable(withPart)).toBe(true);
    const rp = outputBlockSteps({ ...ctx, stories: [withPart, STORY] }, 'role-play', 1);
    expect(rp).toHaveLength(1);
    expect(rp[0]!.exercise).toBe('role-play');
    expect(rp[0]!.params.storyId).toBe(withPart.id);
    // the reading Input block's dialogue fallback takes the same speakable dialogue, never a part-less piece
    expect(inputBlockSteps({ ...ctx, stories: [PIECE] }, 'story').steps).toHaveLength(0);
    expect(inputBlockSteps({ ...ctx, stories: [withPart] }, 'story').storyId).toBe(withPart.id);
    // and never reads an unheard piece as an episode: pieces are heard before they are read
    expect(inputBlockSteps({ ...ctx, stories: [PIECE_2, STORY] }, 'story').storyId).toBe(FIXTURE_STORY_ID);
    expect(inputBlockSteps({ ...ctx, stories: [PIECE_2] }, 'story').steps).toHaveLength(0);
    // a heard piece reads as an ordinary first read (design 08 §10.3)
    store.patch('progress', (p) => ({ ...p, listened: [PIECE_2.id], storiesRead: [FIXTURE_STORY_ID] }));
    expect(inputBlockSteps({ ...ctx, stories: [PIECE_2, STORY] }, 'story').storyId).toBe(PIECE_2.id);
    expect(inputBlockSteps({ ...ctx, stories: [PIECE_2] }, 'story').storyId).toBe(PIECE_2.id);
  });
});
