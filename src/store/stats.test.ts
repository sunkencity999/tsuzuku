import { FIXTURE, V, createFakeLoader } from '../content/fixtures';
import { bus, type Events } from '../shared/events';
import { mulberry32 } from '../shared/hash';
import { epochDay } from '../shared/time';
import { STAT_KEYS as CONTRACT_KEYS } from '../shared/store-types';
import { CLEAN_SET_MIN_TOTAL, LISTENING_PASS_RATIO, STAT_KEYS, honesty, listeningSetPassed, rollingMean, setIsAuthentic, startStats, tierOfRate, updateMedian } from './stats';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function graded(o: Partial<Events['attempt:graded']> = {}): Events['attempt:graded'] {
  return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1500, errorTags: [], sessionId: 's', exercise: 'meaning-recall', itemId: V.水, kind: 'vocab', facet: 'rec', cardKey: `${V.水}#rec`, rating: 3, mature: false, ippon: false, kiai: false, combo: 1, recovery: false, firstProd: false, ...o };
}

function finished(o: Partial<Events['session:finished']> = {}): Events['session:finished'] {
  return { planId: 'p', mode: 'kumite', startedAt: DEFAULT_TEST_NOW - 600_000, endedAt: DEFAULT_TEST_NOW, steps: [], tally: { reps: 20, correct: 18, accuracy: 0.9, bestCombo: 12, ippon: 1, xp: 50, minutes: 10, promotions: [], questsDone: [], backlogWaiting: 0 }, zen: false, resumed: false, ...o };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('pure helpers', () => {
  it('STAT_KEYS is the contract list', () => {
    expect(STAT_KEYS).toBe(CONTRACT_KEYS);
    expect(STAT_KEYS).toContain('kanjiBrown');
    expect(STAT_KEYS).toContain('rapidBest');
  });

  it('updateMedian tracks the median of a skewed distribution within 10 %', () => {
    const rng = mulberry32(42);
    // Log-normal latencies: median e^8 ≈ 2981 ms.
    const sample = (): number => {
      let u = 0;
      while (u === 0) u = rng();
      const v = rng();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.exp(8 + 0.5 * z);
    };
    const trueMedian = Math.exp(8);
    let est: number | undefined;
    const tail: number[] = [];
    for (let i = 0; i < 600; i++) {
      est = updateMedian(est, sample());
      if (i >= 400) tail.push(est);
    }
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(Math.abs(mean - trueMedian) / trueMedian).toBeLessThan(0.1);
    expect(Math.abs((est as number) - trueMedian) / trueMedian).toBeLessThan(0.12);
    // Converges from a wrong start.
    let e2 = 500;
    for (let i = 0; i < 300; i++) e2 = updateMedian(e2, sample());
    expect(Math.abs(e2 - trueMedian) / trueMedian).toBeLessThan(0.12);
    expect(updateMedian(undefined, 1234)).toBe(1234);
    expect(updateMedian(1000, 0)).toBe(1000);
    expect(updateMedian(1000, Number.NaN)).toBe(1000);
  });

  it('rollingMean is exact inside the window and honesty reads the counters', () => {
    let h = 0;
    const seq = [1, 1, 0, 1];
    seq.forEach((x, i) => {
      h = rollingMean(h, x, i + 1);
    });
    expect(h).toBeCloseTo(0.75, 10);
    const m = store.meta();
    expect(honesty(m)).toBeNull();
    expect(honesty({ ...m, stats: { ...m.stats, judgeChecks: 4, honesty: 0.75 } })).toBe(0.75);
  });
});

describe('startStats reducer', () => {
  let stop: () => void = () => undefined;
  afterEach(() => stop());

  it('a daily row appears on the first rep of the day; reviews/ippon/recoveries count; arcade is excluded', async () => {
    await makeTestStore();
    stop = startStats(store);
    expect(store.daily.value[TODAY]).toBeUndefined();
    bus.emit('attempt:graded', graded({ combo: 3 }));
    expect(store.daily.value[TODAY]).toEqual({ reps: 1, ok: 1, minutes: 0, xp: 0, input: 0 });
    bus.emit('attempt:graded', graded({ correct: false, rating: 1, combo: 0 }));
    bus.emit('attempt:graded', graded({ ippon: true, mature: true, combo: 1 }));
    bus.emit('attempt:graded', graded({ recovery: true, combo: 4 }));
    bus.emit('attempt:graded', graded({ exercise: 'rapid-fire', rating: null, combo: 99 }));
    bus.emit('attempt:graded', graded({ exercise: 'minimal-pair', rating: null, combo: 2 }));
    const s = store.stats.value;
    expect(s.reviews).toBe(4);
    expect(s.ippon).toBe(1);
    expect(s.recoveries).toBe(1);
    expect(s.bestCombo).toBe(4);
    expect(s.minimalPairTrials).toBe(1);
    expect(s.minimalPairCorrect).toBe(1);
    expect(store.daily.value[TODAY].reps).toBe(5);
    expect(store.daily.value[TODAY].ok).toBe(4);
    bus.emit('xp:gained', { amount: 7, reason: 'review', total: 7 });
    expect(store.daily.value[TODAY].xp).toBe(7);
  });

  it('sessions, zen, minutes, unscathed kata, bestCombo from the tally (arcade modes excluded)', async () => {
    await makeTestStore();
    stop = startStats(store);
    const ok = { stepId: 'x', cardKey: null, rating: 3 as const, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 2, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1, errorTags: [] };
    bus.emit('session:finished', finished({ mode: 'kata', zen: true, steps: Array.from({ length: 15 }, () => ok) }));
    bus.emit('session:finished', finished({ mode: 'rapid', tally: { ...finished().tally, bestCombo: 70 } }));
    const s = store.stats.value;
    expect(s.sessions).toBe(2);
    expect(s.zenSessions).toBe(1);
    expect(s.minutes).toBe(20);
    expect(s.katasUnscathed).toBe(1);
    expect(s.bestCombo).toBe(12);
    expect(store.daily.value[TODAY].minutes).toBe(20);
  });

  it('session minutes come from the tally (active time), not the wall clock between startedAt and endedAt', async () => {
    await makeTestStore();
    stop = startStats(store);
    // A run resumed the next morning: ~1,440 wall-clock minutes, 12 active.
    bus.emit('session:finished', finished({ startedAt: DEFAULT_TEST_NOW - 1_440 * 60_000, endedAt: DEFAULT_TEST_NOW, resumed: true, tally: { ...finished().tally, minutes: 12.4 } }));
    expect(store.stats.value.minutes).toBe(12);
    expect(store.daily.value[TODAY].minutes).toBe(12);
    // A zero-minute tally adds nothing (no daily row is created by minutes alone).
    bus.emit('session:finished', finished({ tally: { ...finished().tally, minutes: 0 } }));
    expect(store.stats.value.minutes).toBe(12);
    expect(store.stats.value.sessions).toBe(2);
  });

  it('medianMs per drill, honesty window over Judge checks', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('attempt:graded', graded({ ms: 2000 }));
    expect(store.medianMs.value['meaning-recall']).toBe(2000);
    bus.emit('attempt:graded', graded({ ms: 4000 }));
    expect(store.medianMs.value['meaning-recall']).toBe(2100);
    bus.emit('attempt:graded', graded({ ms: 0 }));
    bus.emit('attempt:graded', graded({ ms: 9000, guard: true, correct: false, rating: 1 }));
    expect(store.medianMs.value['meaning-recall']).toBe(2100);
    bus.emit('attempt:graded', graded({ exercise: 'meaning-judge', judge: 'pass' }));
    bus.emit('attempt:graded', graded({ exercise: 'meaning-judge', judge: 'pass' }));
    bus.emit('attempt:graded', graded({ exercise: 'meaning-judge', judge: 'fail', correct: false, rating: 1 }));
    const s = store.stats.value;
    expect(s.judgeChecks).toBe(3);
    expect(s.judgePasses).toBe(2);
    expect(honesty(store.meta())).toBeCloseTo(2 / 3, 3);
  });

  it('item events: introduced, promoted to brown per kind (katakana via the loader), black', async () => {
    const fake = createFakeLoader();
    expect(fake.get(V.コーヒー)).toBeDefined();
    await makeTestStore();
    stop = startStats(store, { lookup: (id) => fake.get(id) });
    bus.emit('item:introduced', { itemId: V.水, kind: 'vocab', station: 1 });
    bus.emit('item:promoted', { itemId: V.水, kind: 'vocab', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: V.コーヒー, kind: 'vocab', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: 'j-食', kind: 'kanji', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: 'g-n5-001', kind: 'grammar', from: 'yellow', to: 'black' });
    bus.emit('item:promoted', { itemId: 'k-h-a', kind: 'kana', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: V.水, kind: 'vocab', from: 'brown', to: 'black' });
    bus.emit('item:promoted', { itemId: V.犬, kind: 'vocab', from: 'white', to: 'yellow' });
    const s = store.stats.value;
    expect(s.itemsIntroduced).toBe(1);
    expect(s.vocabBrown).toBe(2);
    expect(s.katakanaBrown).toBe(1);
    expect(s.kanjiBrown).toBe(1);
    expect(s.grammarBrown).toBe(1);
    expect(s.kanaBrown).toBe(1);
    expect(s.itemsBlack).toBe(2);
    expect(FIXTURE.items[V.コーヒー]).toBeDefined();
  });

  it('story:read records the episode in progress.storiesRead once, whatever the mode or score', async () => {
    await makeTestStore();
    stop = startStats(store);
    expect(store.progress.value.storiesRead).toEqual([]);
    bus.emit('story:read', { storyId: 's-04-1', mode: 'read', chars: 300, cpm: 100, correct: 0, total: 3, glossTaps: 9, minutes: 3, bridge: false });
    expect(store.progress.value.storiesRead).toEqual(['s-04-1']);
    const before = store.progress.value;
    bus.emit('story:read', { storyId: 's-04-1', mode: 'read', chars: 300, cpm: 100, correct: 3, total: 3, glossTaps: 0, minutes: 3, bridge: false });
    expect(store.progress.value).toBe(before);
    bus.emit('story:read', { storyId: 's-04-2', mode: 'speed', chars: 300, cpm: 400, correct: 1, total: 1, glossTaps: 0, minutes: 1, bridge: false });
    expect(store.progress.value.storiesRead).toEqual(['s-04-1', 's-04-2']);
  });

  it('input, output and arcade counters', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('scroll:completed', { scrollId: '4-1', itemIds: [], flawless: true });
    bus.emit('michikusa:read', { id: 'm-04-1' });
    bus.emit('story:read', { storyId: 's', mode: 'read', chars: 350, cpm: 120, correct: 3, total: 3, glossTaps: 1, minutes: 4, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'read', chars: 350, cpm: 120, correct: 1, total: 3, glossTaps: 5, minutes: 4, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'speed', chars: 350, cpm: 320, correct: 1, total: 1, glossTaps: 0, minutes: 1, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'speed', chars: 350, cpm: 900, correct: 0, total: 1, glossTaps: 0, minutes: 1, bridge: false });
    bus.emit('listening:set', { storyId: 's', correct: 3, total: 3, rate: 1.25, minutes: 5 });
    bus.emit('listening:set', { storyId: 's', correct: 1, total: 3, rate: 1.25, minutes: 5 });
    bus.emit('line:scored', { kind: 'dictation', score: 0.97, pass: true, tier: 3 });
    bus.emit('line:scored', { kind: 'dictation', score: 0.97, pass: true, tier: 1 });
    bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    bus.emit('line:scored', { kind: 'shadow', score: 0.3, pass: false });
    bus.emit('roleplay:done', { storyId: 's', best: 5, total: 5, aizuchiHit: 4, aizuchiTotal: 5, registerOk: true });
    bus.emit('output:done', { kind: 'three-ways', registersCorrect: 3 });
    bus.emit('output:done', { kind: 'monologue', seconds: 60, words: 85 });
    bus.emit('output:done', { kind: 'reduce-expand' });
    bus.emit('output:done', { kind: 'writing' });
    bus.emit('weak-point:set-done', { tag: 'particle' });
    bus.emit('arcade:done', { mode: 'rapid', correct: 33, misses: 2, ms: 60_000, recheck: [] });
    bus.emit('arcade:done', { mode: 'gojuon', correct: 46, misses: 0, ms: 55_000, recheck: [] });
    bus.emit('nemesis:defeated', { itemId: V.水 });
    bus.emit('kage:result', { week: 1, score: 1, beat: true });
    bus.emit('gate:result', { station: 4, outcome: 'revenge', score: 1, phases: [] });
    bus.emit('field-mission:done', { tier: 5, minutes: 15, conversation: true });
    bus.emit('welcome-back:done', {});
    bus.emit('quest:completed', { id: 'learn-scroll', allDone: true });
    bus.emit('ledger:entry', { minutes: 12, kind: 0, source: 1 });
    const s = store.stats.value;
    expect(s).toMatchObject({
      scrolls: 1,
      scrollsFlawless: 1,
      michikusaRead: 1,
      episodesRead: 1,
      episodesDictionaryFree: 1,
      speedReads: 2,
      speedReadBestCpm: 320,
      listeningSets: 2,
      listeningFastPasses: 1,
      dictationLines: 2,
      dictation95at1x: 1,
      shadowLines: 2,
      shadowPass: 1,
      rolePlays: 1,
      rolePlaysAllBest: 1,
      rolePlaysAizuchi: 1,
      threeWays: 1,
      threeWaysCorrect: 1,
      monologues: 1,
      monologueBestWords: 85,
      reduceExpand: 1,
      writings: 1,
      weakSetsCleared: 1,
      rapidRuns: 1,
      rapidBest: 33,
      gojuonRuns: 1,
      gojuonBest: 46,
      gojuonPerfects: 1,
      nemesisDefeated: 1,
      kageRuns: 1,
      revengeWins: 1,
      fieldMissions: 1,
      conversations: 1,
      comebacks: 1,
      fullDays: 1,
    });
    expect(store.daily.value[TODAY].input).toBe(12);
  });
});

describe('listening counters (design 08 §12)', () => {
  let stop: () => void = () => undefined;
  afterEach(() => stop());

  const set = (o: Partial<Events['listening:set']> = {}): Events['listening:set'] => ({ storyId: 's-10-1', correct: 3, total: 3, rate: 1, minutes: 5, ...o });
  const played = (o: Partial<Events['listen:played']> = {}): Events['listen:played'] => ({ source: 'radio', refs: ['s-04-1'], seconds: 600, rate: 1, cold: false, authentic: false, gistCorrect: null, ...o });

  it('tierOfRate picks the nearest SPEED_TIER_RATES entry; a tie goes to the slower tier; the Dan rate reads as 5', () => {
    expect([0.75, 0.9, 1, 1.1, 1.25].map(tierOfRate)).toEqual([1, 2, 3, 4, 5]);
    expect(tierOfRate(1.5)).toBe(5);
    expect(tierOfRate(0.5)).toBe(1);
    expect(tierOfRate(0.95)).toBe(2); // 0.9 and 1.0 are equally near
    expect(tierOfRate(1.05)).toBe(3); // 1.0 and 1.1 are equally near
    expect(tierOfRate(1.08)).toBe(4);
    expect(tierOfRate(Number.NaN)).toBe(1);
    expect(LISTENING_PASS_RATIO).toBe(2 / 3);
    expect(CLEAN_SET_MIN_TOTAL).toBe(3);
    expect(listeningSetPassed({ correct: 2, total: 3 })).toBe(true);
    expect(listeningSetPassed({ correct: 1, total: 3 })).toBe(false);
    expect(listeningSetPassed({ correct: 0, total: 0 })).toBe(false);
    expect(setIsAuthentic({ authentic: true })).toBe(true);
    expect(setIsAuthentic({ authentic: false, bridge: true })).toBe(true); // a disjunction: any one signal counts
    expect(setIsAuthentic({ authentic: false, genre: 'news' })).toBe(true);
    expect(setIsAuthentic({ genre: 'news' })).toBe(true);
    expect(setIsAuthentic({ bridge: true })).toBe(true);
    expect(setIsAuthentic({ authentic: false, bridge: false, genre: 'exchange' })).toBe(false);
    expect(setIsAuthentic({ genre: 'exchange' })).toBe(false);
    expect(setIsAuthentic({})).toBe(false);
  });

  it('an Arena set on a news piece at 0.9× adds no authentic minutes; at 1.0× passed it does; failed or non-authentic sets never do', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('listening:set', set({ genre: 'news', rate: 0.9, minutes: 5 }));
    expect(store.stats.value.listeningAuthenticMinutes).toBe(0);
    bus.emit('listening:set', set({ genre: 'news', rate: 1, minutes: 5 }));
    expect(store.stats.value.listeningAuthenticMinutes).toBe(5);
    bus.emit('listening:set', set({ genre: 'news', rate: 1, correct: 1, total: 3, minutes: 4 })); // failed
    expect(store.stats.value.listeningAuthenticMinutes).toBe(5);
    bus.emit('listening:set', set({ authentic: true, rate: 1.1, minutes: 2.5 })); // casual dialogue flagged by the emitter
    expect(store.stats.value.listeningAuthenticMinutes).toBe(7.5);
    bus.emit('listening:set', set({ authentic: false, genre: 'news', rate: 1.25, minutes: 5 })); // an authentic genre counts whatever the flag says (disjunction)
    expect(store.stats.value.listeningAuthenticMinutes).toBe(12.5);
    bus.emit('listening:set', set({ bridge: true, rate: 1, minutes: 3 }));
    expect(store.stats.value.listeningAuthenticMinutes).toBe(15.5);
    bus.emit('listening:set', set({ authentic: false, bridge: false, genre: 'exchange', rate: 1.25, minutes: 5 })); // no signal at all
    bus.emit('listening:set', set({ storyId: null, mode: 'walk', refs: ['v-n5-0249#ex0'], rate: 1.25, minutes: 2 })); // pool sentences, no text
    expect(store.stats.value.listeningAuthenticMinutes).toBe(15.5);
    expect(store.stats.value.listeningSets).toBe(8);
  });

  it('cold flag increments coldSets and coldSetsPassed on a pass; a warm set or a walk-mode set is never a first hearing', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('listening:set', set({ cold: true, correct: 3, total: 3 }));
    expect(store.stats.value).toMatchObject({ coldSets: 1, coldSetsPassed: 1 });
    bus.emit('listening:set', set({ cold: true, correct: 1, total: 3 }));
    expect(store.stats.value).toMatchObject({ coldSets: 2, coldSetsPassed: 1 });
    bus.emit('listening:set', set({ cold: false, correct: 3, total: 3 }));
    bus.emit('listening:set', set({ correct: 3, total: 3 })); // flag absent
    bus.emit('listening:set', set({ cold: true, storyId: null, mode: 'walk', refs: ['v-n5-0249#ex0'], correct: 6, total: 6 }));
    expect(store.stats.value).toMatchObject({ coldSets: 2, coldSetsPassed: 1, listeningSets: 5 });
  });

  it('Radio-first learner still accumulates coldSets: ten cold Radio tracks with gist answers reach coldSets 10 with no Arena set', async () => {
    await makeTestStore();
    stop = startStats(store);
    for (let i = 0; i < 10; i++) bus.emit('listen:played', played({ cold: true, gistCorrect: i < 8 }));
    expect(store.stats.value).toMatchObject({ coldSets: 10, coldSetsPassed: 8, listeningSets: 0 });
    bus.emit('listen:played', played({ cold: true, gistCorrect: null })); // question skipped: counts nothing
    bus.emit('listen:played', played({ cold: false, gistCorrect: true })); // a re-hearing is not a first hearing
    bus.emit('listen:played', played({ source: 'readalong', cold: true, gistCorrect: false })); // Read-along counts like Radio
    expect(store.stats.value).toMatchObject({ coldSets: 11, coldSetsPassed: 8 });
  });

  it('radioMinutes counts radio seconds / 60 only; a Radio re-hearing with authentic true adds authentic minutes; Read-along adds none to radioMinutes', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('listen:played', played({ source: 'radio', seconds: 600 }));
    expect(store.stats.value).toMatchObject({ radioMinutes: 10, listeningAuthenticMinutes: 0 });
    bus.emit('listen:played', played({ source: 'readalong', refs: ['s-27-1'], seconds: 300, authentic: true, gistCorrect: true }));
    expect(store.stats.value).toMatchObject({ radioMinutes: 10, listeningAuthenticMinutes: 5 });
    bus.emit('listen:played', played({ source: 'radio', seconds: 90, rate: 1.1, cold: false, authentic: true, gistCorrect: true })); // re-hearing at full speed, gist right
    expect(store.stats.value).toMatchObject({ radioMinutes: 11.5, listeningAuthenticMinutes: 6.5 });
    for (let i = 0; i < 3; i++) bus.emit('listen:played', played({ seconds: 40 })); // three 40 s kana tracks = 2 min, not 0 and not 3
    expect(store.stats.value.radioMinutes).toBeCloseTo(13.5, 9);
    bus.emit('listen:played', played({ seconds: Number.NaN }));
    bus.emit('listen:played', played({ seconds: -5 }));
    expect(store.stats.value.radioMinutes).toBeCloseTo(13.5, 9);
    expect(store.stats.value.listeningAuthenticMinutes).toBe(6.5);
  });

  it('bestCleanTier rises to 4 after a perfect set at 1.1× and not after a 2/3 set; needs total ≥ 3; never lowers; a walk-mode set counts', async () => {
    await makeTestStore();
    stop = startStats(store);
    expect(store.stats.value.bestCleanTier).toBe(1);
    bus.emit('listening:set', set({ correct: 2, total: 3, rate: 1.1 }));
    expect(store.stats.value.bestCleanTier).toBe(1);
    bus.emit('listening:set', set({ correct: 2, total: 2, rate: 1.25 })); // too small a set
    expect(store.stats.value.bestCleanTier).toBe(1);
    bus.emit('listening:set', set({ correct: 3, total: 3, rate: 1.1 }));
    expect(store.stats.value.bestCleanTier).toBe(4);
    bus.emit('listening:set', set({ correct: 3, total: 3, rate: 0.75 }));
    expect(store.stats.value.bestCleanTier).toBe(4);
    bus.emit('listening:set', set({ storyId: null, mode: 'walk', refs: ['v-n5-0249#ex0'], correct: 6, total: 6, rate: 1.5 }));
    expect(store.stats.value.bestCleanTier).toBe(5);
  });

  it('daily input keeps the tenth of a minute a Radio row carries', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('ledger:entry', { minutes: 0.7, kind: 0, source: 0 });
    bus.emit('ledger:entry', { minutes: 0.7, kind: 0, source: 0 });
    bus.emit('ledger:entry', { minutes: 12, kind: 0, source: 1 });
    bus.emit('ledger:entry', { minutes: 0, kind: 0, source: 0 });
    expect(store.daily.value[TODAY].input).toBe(13.4);
  });
});
