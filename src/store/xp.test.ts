import { bus, type Events } from '../shared/events';
import { epochDay } from '../shared/time';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from './testing';
import { COMBO_XP, XP_TABLE, comboXp, dictationXp, fieldMissionXp, levelFor, repXp, startXp, xpAtLevel, xpFor, xpToNext } from './xp';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const DAY_MS = 86_400_000;

function graded(o: Partial<Events['attempt:graded']> = {}): Events['attempt:graded'] {
  return {
    correct: true,
    nearMiss: false,
    hintUsed: false,
    guard: false,
    timedOut: false,
    ms: 1200,
    errorTags: [],
    sessionId: 's1',
    exercise: 'meaning-recall',
    itemId: 'v-n5-0001',
    kind: 'vocab',
    facet: 'rec',
    cardKey: 'v-n5-0001#rec',
    rating: 3,
    mature: false,
    ippon: false,
    kiai: false,
    combo: 1,
    recovery: false,
    firstProd: false,
    ...o,
  };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('level curve (design 02 §5)', () => {
  it('hits the published thresholds', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(1999)).toBe(4);
    expect(levelFor(2000)).toBe(5);
    expect(levelFor(7000)).toBe(10);
    expect(levelFor(26_000)).toBe(20);
    expect(levelFor(57_000)).toBe(30);
    expect(levelFor(155_000)).toBe(50);
    expect(levelFor(597_960)).toBe(99);
    expect(levelFor(10_000_000)).toBe(99);
    expect(levelFor(Number.NaN)).toBe(1);
  });

  it('xpToNext is the difference between consecutive cumulative levels', () => {
    for (let l = 1; l < 99; l++) expect(xpAtLevel(l + 1) - xpAtLevel(l)).toBe(xpToNext(l));
    expect(xpToNext(5)).toBe(760);
  });
});

describe('xpFor — design 06 §1 table', () => {
  const cases: [string, keyof Events, unknown, number][] = [
    ['review Good', 'attempt:graded', graded({ rating: 3 }), 2],
    ['review Hard', 'attempt:graded', graded({ rating: 2, correct: true, nearMiss: true }), 1],
    ['review Again', 'attempt:graded', graded({ rating: 1, correct: false }), 1],
    ['review Easy counts as Good', 'attempt:graded', graded({ rating: 4 }), 2],
    ['ungraded rep', 'attempt:graded', graded({ rating: null, exercise: 'minimal-pair' }), 0],
    ['arcade rep', 'attempt:graded', graded({ exercise: 'rapid-fire', rating: null }), 0],
    ['recovery success +2', 'attempt:graded', graded({ recovery: true }), 4],
    ['ippon +3', 'attempt:graded', graded({ ippon: true }), 5],
    ['first prod +10', 'attempt:graded', graded({ firstProd: true }), 12],
    ['new item introduced', 'item:introduced', { itemId: 'v-n5-0001', kind: 'vocab', station: 4 }, 5],
    ['promotion yellow', 'item:promoted', { itemId: 'v', kind: 'vocab', from: 'white', to: 'yellow' }, 5],
    ['promotion green', 'item:promoted', { itemId: 'v', kind: 'vocab', from: 'yellow', to: 'green' }, 10],
    ['promotion brown', 'item:promoted', { itemId: 'v', kind: 'vocab', from: 'green', to: 'brown' }, 20],
    ['promotion black', 'item:promoted', { itemId: 'v', kind: 'vocab', from: 'brown', to: 'black' }, 40],
    ['scroll', 'scroll:completed', { scrollId: '4-1', itemIds: [], flawless: false }, 30],
    ['scroll flawless', 'scroll:completed', { scrollId: '4-1', itemIds: [], flawless: true }, 40],
    ['episode 3/3', 'story:read', { storyId: 's', mode: 'read', chars: 400, cpm: 100, correct: 3, total: 3, glossTaps: 0, minutes: 4, bridge: false }, 40],
    ['episode 2/3', 'story:read', { storyId: 's', mode: 'read', chars: 400, cpm: 100, correct: 2, total: 3, glossTaps: 0, minutes: 4, bridge: false }, 35],
    ['episode 1/3 (questions only)', 'story:read', { storyId: 's', mode: 'read', chars: 400, cpm: 100, correct: 1, total: 3, glossTaps: 0, minutes: 4, bridge: false }, 5],
    ['speed read correct', 'story:read', { storyId: 's', mode: 'speed', chars: 400, cpm: 300, correct: 1, total: 1, glossTaps: 0, minutes: 2, bridge: false }, 15],
    ['speed read wrong', 'story:read', { storyId: 's', mode: 'speed', chars: 400, cpm: 300, correct: 0, total: 1, glossTaps: 0, minutes: 2, bridge: false }, 0],
    ['listening set 2/3', 'listening:set', { storyId: 's', correct: 2, total: 3, rate: 1, minutes: 5 }, 30],
    ['listening set, walk mode 5/6 (the Ear Walk pays like a set)', 'listening:set', { storyId: null, refs: ['v-n5-0249#ex0', 's-07-2#L3'], correct: 5, total: 6, rate: 1, minutes: 2.5, mode: 'walk', cold: false }, 45],
    ['listen:played radio (design 08 §10.2: passive hearing, 0 XP)', 'listen:played', { source: 'radio', refs: ['s-04-1'], seconds: 600, rate: 1, cold: true, authentic: true, gistCorrect: true }, 0],
    ['listen:played readalong (design 08 §10.3: 0 XP, never an episode)', 'listen:played', { source: 'readalong', refs: ['s-04-1'], seconds: 300, rate: 1, cold: true, authentic: false, gistCorrect: null }, 0],
    ['dictation pass tier 5 perfect', 'line:scored', { kind: 'dictation', score: 1, pass: true, tier: 5 }, 6],
    ['dictation pass tier 1', 'line:scored', { kind: 'dictation', score: 1, pass: true, tier: 1 }, 4],
    ['dictation fail', 'line:scored', { kind: 'dictation', score: 0.5, pass: false, tier: 3 }, 0],
    ['shadow pass', 'line:scored', { kind: 'shadow', score: 0.9, pass: true }, 3],
    ['shadow fail', 'line:scored', { kind: 'shadow', score: 0.4, pass: false }, 0],
    ['role-play', 'roleplay:done', { storyId: 's', best: 3, total: 5, aizuchiHit: 1, aizuchiTotal: 2, registerOk: true }, 25],
    ['role-play all best + aizuchi', 'roleplay:done', { storyId: 's', best: 5, total: 5, aizuchiHit: 2, aizuchiTotal: 2, registerOk: true }, 40],
    ['three ways', 'output:done', { kind: 'three-ways', registersCorrect: 3 }, 15],
    ['monologue', 'output:done', { kind: 'monologue', seconds: 60, words: 90 }, 15],
    ['reduce & expand', 'output:done', { kind: 'reduce-expand' }, 20],
    ['writing', 'output:done', { kind: 'writing', patternsHit: 2 }, 30],
    ['rapid fire ≤ 60', 'arcade:done', { mode: 'rapid', correct: 75, misses: 3, ms: 60_000, recheck: [] }, 60],
    ['rapid fire 1/correct', 'arcade:done', { mode: 'rapid', correct: 23, misses: 3, ms: 60_000, recheck: [] }, 23],
    ['gojūon (no XP)', 'arcade:done', { mode: 'gojuon', correct: 46, misses: 0, ms: 50_000, recheck: [] }, 0],
    ['weak point set', 'weak-point:set-done', { tag: 'particle' }, 15],
    ['weak point cleared (badge only)', 'weak-point:cleared', { tag: 'particle' }, 0],
    ['michikusa', 'michikusa:read', { id: 'm-04-1' }, 5],
    ['quest (not all)', 'quest:completed', { id: 'learn-scroll', allDone: false }, 0],
    ['full training day', 'quest:completed', { id: 'learn-scroll', allDone: true }, 50],
    ['gate pass', 'gate:result', { station: 4, outcome: 'pass', score: 0.9, phases: [] }, 300],
    ['gate perfect', 'gate:result', { station: 4, outcome: 'perfect', score: 1, phases: [] }, 400],
    ['gate assisted', 'gate:result', { station: 4, outcome: 'assisted', score: 0.7, phases: [] }, 150],
    ['gate revenge', 'gate:result', { station: 4, outcome: 'revenge', score: 0.9, phases: [] }, 450],
    ['gate fail', 'gate:result', { station: 4, outcome: 'fail', score: 0.5, phases: [] }, 0],
    ['shinsa pass', 'shinsa:result', { belt: 'yellow', passed: true, sections: { ear: 0.9, read: 0.9, form: 0.9, mouth: 0.9, write: 0.9 } }, 1000],
    ['shinsa fail', 'shinsa:result', { belt: 'yellow', passed: false, sections: { ear: 0.5, read: 0.9, form: 0.9, mouth: 0.9, write: 0.9 } }, 0],
    ['kage beaten', 'kage:result', { week: 2900, score: 0.9, beat: true }, 60],
    ['kage not beaten', 'kage:result', { week: 2900, score: 0.5, beat: false }, 0],
    ['nemesis', 'nemesis:defeated', { itemId: 'v-n5-0001' }, 40],
    ['field mission tier 5 full', 'field-mission:done', { tier: 5, minutes: 15, conversation: true }, 100],
    ['field mission tier 1', 'field-mission:done', { tier: 1, minutes: 5, conversation: false }, 30],
    ['external 30 min + entry', 'ledger:entry', { minutes: 30, kind: 0, source: 1 }, 35],
    ['external 90 min capped', 'ledger:entry', { minutes: 90, kind: 0, source: 1 }, 65],
    ['app source minutes', 'ledger:entry', { minutes: 30, kind: 1, source: 0 }, 0],
    ['session finished (reps already paid)', 'session:finished', { planId: 'p', mode: 'kata', startedAt: 0, endedAt: 1, steps: [], tally: { reps: 0, correct: 0, accuracy: 0, bestCombo: 0, ippon: 0, xp: 0, minutes: 0, promotions: [], questsDone: [], backlogWaiting: 0 }, zen: false, resumed: false }, 0],
  ];
  it.each(cases)('%s', (_label, name, payload, expected) => {
    expect(xpFor(name, payload as never)).toBe(expected);
  });

  it('Kiai multiplies rep XP by 1.5 (rounded), never item events', () => {
    expect(repXp(graded({ kiai: true }))).toBe(3);
    expect(repXp(graded({ kiai: true, rating: 2 }))).toBe(2);
    expect(repXp(graded({ kiai: true, ippon: true }))).toBe(8);
    expect(xpFor('attempt:graded', graded({ kiai: true, firstProd: true }))).toBe(13);
    expect(XP_TABLE.kiaiMultiplier).toBe(1.5);
  });

  it('dictation and field mission scale inside their ranges', () => {
    expect(dictationXp(0, 5)).toBe(3);
    expect(dictationXp(1, 5)).toBe(6);
    expect(dictationXp(0.8, 3)).toBe(4);
    expect(fieldMissionXp(2, 10)).toBe(50);
    expect(fieldMissionXp(2, 0)).toBe(40);
    expect(fieldMissionXp(3, 10)).toBe(55);
  });

  it('combo milestones pay once per crossing, highest when several are jumped', () => {
    expect(COMBO_XP.map(([c]) => c)).toEqual([10, 25, 50, 100]);
    expect(comboXp(9, 10)).toBe(10);
    expect(comboXp(10, 11)).toBe(0);
    expect(comboXp(0, 12)).toBe(10);
    expect(comboXp(24, 60)).toBe(60);
    expect(comboXp(99, 100)).toBe(150);
  });
});

describe('startXp reducer', () => {
  let stop: () => void;
  let clock = DEFAULT_TEST_NOW;

  beforeEach(async () => {
    clock = DEFAULT_TEST_NOW;
    await makeTestStore({ now: () => clock });
    stop = startXp(store);
  });
  afterEach(() => stop());

  it('emits xp:gained synchronously and writes profile.xp', () => {
    const cap = captureEvents();
    bus.emit('attempt:graded', graded());
    cap.stop();
    expect(store.profile.value.xp).toBe(2);
    expect(cap.events.filter(([n]) => n === 'xp:gained')).toEqual([['xp:gained', { amount: 2, reason: 'review', total: 2 }]]);
  });

  it('level:up fires when the cumulative threshold is crossed', () => {
    store.patch('profile', (p) => ({ ...p, xp: 439, level: 1 }));
    const cap = captureEvents();
    bus.emit('attempt:graded', graded());
    cap.stop();
    expect(store.profile.value.level).toBe(2);
    expect(cap.events.filter(([n]) => n === 'level:up')).toEqual([['level:up', { level: 2 }]]);
    bus.emit('attempt:graded', graded());
    expect(store.profile.value.level).toBe(2);
  });

  it('combo milestones use the previous combo of the same session', () => {
    const cap = captureEvents();
    bus.emit('attempt:graded', graded({ combo: 9 }));
    bus.emit('attempt:graded', graded({ combo: 10 }));
    bus.emit('attempt:graded', graded({ combo: 11 }));
    bus.emit('attempt:graded', graded({ combo: 0, correct: false, rating: 1 }));
    bus.emit('attempt:graded', graded({ combo: 12, recovery: true }));
    cap.stop();
    const reasons = cap.events.filter(([n]) => n === 'xp:gained').map(([, p]) => (p as { reason: string; amount: number }));
    expect(reasons).toEqual([
      { reason: 'review', amount: 2, total: 2 },
      { reason: 'review', amount: 2, total: 4 },
      { reason: 'combo', amount: 10, total: 14 },
      { reason: 'review', amount: 2, total: 16 },
      { reason: 'review', amount: 1, total: 17 },
      { reason: 'recovery', amount: 4, total: 21 },
      { reason: 'combo', amount: 10, total: 31 },
    ].map((x) => expect.objectContaining(x)));
  });

  it('arcade reps earn nothing; Rapid Fire pays the first run of the day only', () => {
    bus.emit('attempt:graded', graded({ exercise: 'rapid-fire', rating: null, combo: 30 }));
    expect(store.profile.value.xp).toBe(0);
    bus.emit('arcade:done', { mode: 'rapid', correct: 70, misses: 1, ms: 60_000, recheck: [] });
    expect(store.profile.value.xp).toBe(60);
    bus.emit('arcade:done', { mode: 'rapid', correct: 40, misses: 1, ms: 60_000, recheck: [] });
    expect(store.profile.value.xp).toBe(60);
    clock += DAY_MS;
    expect(store.today()).toBe(TODAY + 1);
    bus.emit('arcade:done', { mode: 'rapid', correct: 40, misses: 1, ms: 60_000, recheck: [] });
    expect(store.profile.value.xp).toBe(100);
  });

  it('external minutes cap at 60/day and ledger entries at 20/day, derived from the slice', () => {
    const entry = (minutes: number): void => {
      store.patch('ledger', (l) => ({ ...l, entries: [...l.entries, [TODAY, minutes, 0, 1]] }));
      bus.emit('ledger:entry', { minutes, kind: 0, source: 1 });
    };
    entry(40); // 40 + 5
    expect(store.profile.value.xp).toBe(45);
    entry(40); // 20 (cap) + 5
    expect(store.profile.value.xp).toBe(70);
    entry(10); // 0 + 5
    entry(10); // 0 + 5  (4th entry = 20 XP of entries)
    expect(store.profile.value.xp).toBe(80);
    entry(10); // nothing left today
    expect(store.profile.value.xp).toBe(80);
    bus.emit('ledger:entry', { minutes: 30, kind: 1, source: 0 });
    expect(store.profile.value.xp).toBe(80);
  });

  it('listen:played emits no xp:gained for radio or readalong; a walk-mode listening:set pays 20 + 5·correct', () => {
    const cap = captureEvents();
    bus.emit('listen:played', { source: 'radio', refs: ['s-04-1'], seconds: 2700, rate: 1.1, cold: true, authentic: true, gistCorrect: true });
    bus.emit('listen:played', { source: 'readalong', refs: ['s-04-2'], seconds: 300, rate: 1, cold: true, authentic: true, gistCorrect: true });
    expect(store.profile.value.xp).toBe(0);
    expect(cap.events.filter(([n]) => n === 'xp:gained')).toEqual([]);
    bus.emit('listening:set', { storyId: null, refs: ['v-n5-0249#ex0', 'g-n5-024#ex1', 's-07-2#L3'], correct: 4, total: 6, rate: 1, minutes: 3, mode: 'walk', cold: false });
    cap.stop();
    expect(store.profile.value.xp).toBe(40);
    expect(cap.events.filter(([n]) => n === 'xp:gained')).toEqual([['xp:gained', { amount: 40, reason: 'listening', total: 40 }]]);
  });

  it('shadow lines pay 3 each and +10 per set of five', () => {
    for (let i = 0; i < 5; i++) bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    expect(store.profile.value.xp).toBe(25);
    bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    expect(store.profile.value.xp).toBe(28);
  });

  it('weak point set → 15, full training day → 50, gate / shinsa / kage / nemesis amounts', () => {
    const cap = captureEvents();
    bus.emit('weak-point:set-done', { tag: 'particle' });
    bus.emit('quest:completed', { id: 'learn-scroll', allDone: false });
    bus.emit('quest:completed', { id: 'read-episode', allDone: true });
    bus.emit('gate:result', { station: 4, outcome: 'perfect', score: 1, phases: [] });
    bus.emit('shinsa:result', { belt: 'yellow', passed: true, sections: { ear: 1, read: 1, form: 1, mouth: 1, write: 1 } });
    bus.emit('kage:result', { week: 1, score: 1, beat: true });
    bus.emit('nemesis:defeated', { itemId: 'v-n5-0001' });
    cap.stop();
    const amounts = cap.events.filter(([n]) => n === 'xp:gained').map(([, p]) => (p as { amount: number }).amount);
    expect(amounts).toEqual([15, 50, 400, 1000, 60, 40]);
    expect(store.profile.value.xp).toBe(1565);
  });

  it('stops cleanly', () => {
    stop();
    bus.emit('attempt:graded', graded());
    expect(store.profile.value.xp).toBe(0);
    stop = () => undefined;
  });
});
