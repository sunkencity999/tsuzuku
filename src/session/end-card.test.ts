/**
 * end-card.ts — tally, 次回予告, notes, Omikuji, ceremonies.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE_IDS, FIXTURE_STORY_ID, V, G, createFakeLoader } from '../content/fixtures';
import type { StoryItem } from '../content/types';
import { bus } from '../shared/events';
import type { StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { S, fill } from './engine-strings';
import { endCardNotes, gateNameOf, jikaiYokoku, kanaOf, ledgerPromptDue, maskLine, omikuji, pickMaskedLine, tally, trackCeremonies } from './end-card';
import { ES } from './end-card-strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const story = loader.get<StoryItem>(FIXTURE_STORY_ID)!;

function res(o: Partial<StepResult> = {}): StepResult {
  return { stepId: 's', cardKey: `${V.犬}#rec`, rating: 3, ki: 8, combo: 1, ippon: false, kiai: false, xpDelta: 2, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [], ...o };
}

function live(s: number): CardTuple {
  return card({ due: TODAY, s, d: 5, reps: 6, lapses: 0, state: 2, last: TODAY - 1 });
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('tally', () => {
  it('counts reps, accuracy, best combo, Ippon, XP, promotions and minutes', () => {
    const steps = [
      res({ combo: 1 }),
      res({ combo: 2, ippon: true, xpDelta: 5 }),
      res({ correct: false, rating: 1, combo: 0, xpDelta: 1 }),
      res({ combo: 1, promotion: 'green', cardKey: `${V.水}#rec` }),
      res({ combo: 2, nearMiss: true, rating: 2, xpDelta: 1 }),
    ];
    const t = tally(steps, { startedAt: 0, endedAt: 150_000, questsDone: ['clear-due'], backlogWaiting: 7 });
    expect(t.reps).toBe(5);
    expect(t.correct).toBe(4);
    expect(t.accuracy).toBe(0.8);
    expect(t.bestCombo).toBe(2);
    expect(t.ippon).toBe(1);
    expect(t.xp).toBe(2 + 5 + 1 + 2 + 1);
    expect(t.promotions).toEqual([{ itemId: V.水, to: 'green' }]);
    expect(t.minutes).toBe(2.5);
    expect(t.questsDone).toEqual(['clear-due']);
    expect(t.backlogWaiting).toBe(7);
  });

  it('is empty-safe and excludes paused time', () => {
    const t = tally([], { startedAt: 0, endedAt: 600_000, questsDone: [], backlogWaiting: 0, pausedMs: 300_000 });
    expect(t).toMatchObject({ reps: 0, correct: 0, accuracy: 0, bestCombo: 0, ippon: 0, xp: 0, minutes: 5 });
  });
});

describe('masked sentence', () => {
  it('picks the line with the fewest unknown tokens and masks the first unknown as ???', () => {
    const introduced = new Set<string>([V.私, V.コーヒー, V.おいしい, V.パン, V.犬, V.水, V.人, V.日, V.はい, G.は, G.です]);
    const m = pickMaskedLine(story, (id) => introduced.has(id), () => false)!;
    // Lines with exactly one unknown: おはよう。 (1 unknown) is the first with the fewest.
    expect(m.unknownCount).toBe(1);
    expect(m.ja).toBe(`${S.maskToken}。`);
    expect(m.maskedToken).toBe(0);
    expect(m.kana).toBe('おはよう。');
    expect((m.ja.match(/\?\?\?/g) ?? []).length).toBe(1);
  });

  it('with no unknown tokens masks a word due by tomorrow, else the first content token', () => {
    const all = () => true;
    const due = pickMaskedLine(story, all, (id) => id === V.コーヒー)!;
    expect(due.unknownCount).toBe(0);
    expect(due.ja).toContain(S.maskToken);
    expect(story.lines[3]!.tokens[due.maskedToken]).toBe('コーヒー');
    const first = pickMaskedLine(story, all, () => false)!;
    expect(first.ja).toBe(`${S.maskToken}。`);
  });

  it('keeps ruby markup on the unmasked tokens', () => {
    const line = story.lines[1]!; // {私|わたし}はハナです。
    expect(maskLine(line, 2).ja).toBe(`{私|わたし}は${S.maskToken}です。`);
    expect(maskLine(line, 0).ja).toBe(`${S.maskToken}はハナです。`);
  });
});

describe('jikaiYokoku', () => {
  it('returns a masked next-episode sentence, three kana words from the next Scroll and a milestone with no countdown words', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of [V.私, V.コーヒー, V.おいしい, V.パン]) cards[`${id}#rec`] = live(5);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const y = await jikaiYokoku({ station: 4, today: TODAY, loader });
    expect(y.sentence?.storyId).toBe(FIXTURE_STORY_ID);
    expect(y.sentence?.ja).toContain(S.maskToken);
    expect(y.words).toHaveLength(3);
    for (const w of y.words) {
      expect(w.kana).toMatch(/^[ぁ-ゖァ-ヺー・]+$/u);
      expect(FIXTURE_IDS.vocab.concat(FIXTURE_IDS.kanji, FIXTURE_IDS.grammar, FIXTURE_IDS.component)).toContain(w.itemId);
    }
    expect(y.milestone.length).toBeGreaterThan(0);
    expect(y.milestone).not.toMatch(/only|left|hurry|last chance|don.t|!/i);
  });

  it('says the gate is ready when every item is Green', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) cards[`${id}#rec`] = live(30);
    cards[`${V.おはよう}#prod`] = live(30);
    cards[`${V.はい}#prod`] = live(30);
    for (const id of FIXTURE_IDS.kanji) cards[`${id}#comp`] = live(30);
    for (const id of FIXTURE_IDS.grammar) cards[`${id}#cloze`] = live(30);
    for (const id of FIXTURE_IDS.component) cards[`${id}#rec`] = live(30);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const y = await jikaiYokoku({ station: 4, today: TODAY, loader });
    expect(y.milestone).toContain('坂の関守');
    expect(y.milestone).toContain('ready');
  });

  it('line 3 carries the next-station vista INSIDE the Gatekeeper line when a lookup knows one — never a fourth line (design 09 §10 B2)', async () => {
    expect(gateNameOf(4)).toBe('坂の関守 Hill Keeper');
    expect(gateNameOf(4, () => null)).toBe('坂の関守 Hill Keeper');
    expect(gateNameOf(4, () => 'Fuji view')).toBe('坂の関守 Hill Keeper · Fuji view');
    expect(ES.gateWithVista).toBe('{gate} · {vista}');
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) cards[`${id}#rec`] = live(30);
    cards[`${V.おはよう}#prod`] = live(30);
    cards[`${V.はい}#prod`] = live(30);
    for (const id of FIXTURE_IDS.kanji) cards[`${id}#comp`] = live(30);
    for (const id of FIXTURE_IDS.grammar) cards[`${id}#cloze`] = live(30);
    for (const id of FIXTURE_IDS.component) cards[`${id}#rec`] = live(30);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const seen: number[] = [];
    const y = await jikaiYokoku({
      station: 4,
      today: TODAY,
      loader,
      vista: (n) => {
        seen.push(n);
        return 'Fuji view';
      },
    });
    expect(seen).toEqual([4]);
    expect(y.milestone).toBe(fill(S.milestoneGateReady, { gate: '坂の関守 Hill Keeper · Fuji view' }));
    expect(y.milestone).toContain('坂の関守 Hill Keeper · Fuji view');
    expect(y.milestone.split('\n')).toHaveLength(1);
    // without a lookup the line is exactly as before
    const plain = await jikaiYokoku({ station: 4, today: TODAY, loader });
    expect(plain.milestone).toBe(fill(S.milestoneGateReady, { gate: '坂の関守 Hill Keeper' }));
  });

  it('every milestone string in the catalog avoids countdown pressure', () => {
    for (const k of ['milestoneGateReady', 'milestoneGateSoon', 'milestoneGateIn', 'milestoneShinsa', 'milestoneShinsaReady', 'milestoneKageMonday', 'milestoneKageNow', 'milestoneDan', 'milestoneQuiet'] as const) {
      expect(S[k]).not.toMatch(/only|hurry|last chance|don.t|streak|!/i);
    }
  });
});

describe('endCardNotes', () => {
  it('nudges toward Dojo feel only after two Arcade sessions over 40 % error', () => {
    expect(endCardNotes({ minutesToday: 10, recentErrorRates: [0.5], feel: 'arcade' })).toEqual([]);
    expect(endCardNotes({ minutesToday: 10, recentErrorRates: [0.5, 0.3], feel: 'arcade' })).toEqual([]);
    expect(endCardNotes({ minutesToday: 10, recentErrorRates: [0.2, 0.5, 0.45], feel: 'arcade' })).toEqual([S.feelNudgeLine]);
    expect(endCardNotes({ minutesToday: 10, recentErrorRates: [0.5, 0.45], feel: 'dojo' })).toEqual([]);
  });

  it('adds the overtraining line at the threshold and the cramming / backlog lines when flagged', () => {
    expect(endCardNotes({ minutesToday: 59, recentErrorRates: [], feel: 'zen' })).toEqual([]);
    expect(endCardNotes({ minutesToday: 60, recentErrorRates: [], feel: 'zen' })).toEqual([S.overtrainingLine]);
    expect(endCardNotes({ minutesToday: 80, recentErrorRates: [], feel: 'zen', overtrainingAt: 90 })).toEqual([]);
    expect(endCardNotes({ minutesToday: 5, recentErrorRates: [], feel: 'zen', crammingCap: true, backlog: { shown: 120, due: 310 } })).toEqual(['190 waited today without penalty.', S.crammingLine]);
    for (const line of [S.overtrainingLine, S.crammingLine, S.feelNudgeLine, S.backlogWaiting]) expect(line).not.toMatch(/!/);
  });
});

describe('omikuji and ledger prompt', () => {
  it('is deterministic per (seed, day) and drawn from the proverb table', () => {
    const a = omikuji('seed', 100);
    expect(a).toBe(omikuji('seed', 100));
    expect(S.omikuji).toContain(a);
    const days = new Set([100, 101, 102, 103, 104, 105, 106].map((d) => omikuji('seed', d)));
    expect(days.size).toBeGreaterThan(1);
  });

  it('the ledger prompt shows until an external entry exists today', () => {
    expect(ledgerPromptDue({ entries: [], monthly: {}, missions: [] }, TODAY)).toBe(true);
    expect(ledgerPromptDue({ entries: [[TODAY, 20, 0, 0]], monthly: {}, missions: [] }, TODAY)).toBe(true);
    expect(ledgerPromptDue({ entries: [[TODAY, 20, 0, 1]], monthly: {}, missions: [] }, TODAY)).toBe(false);
    expect(ledgerPromptDue({ entries: [[TODAY - 1, 20, 0, 1]], monthly: {}, missions: [] }, TODAY)).toBe(true);
  });
});

describe('kanaOf and ceremonies', () => {
  it('gives kana for every item kind', () => {
    expect(kanaOf(loader.get(V.飲む))).toBe('のむ');
    expect(kanaOf(loader.get('k-h-a'))).toBe('あ');
    expect(kanaOf(loader.get('j-食'))).toBe('たべる');
    expect(kanaOf(loader.get(G.です))).toBe('です');
    expect(kanaOf(loader.get('c-eat'))).toBe('食');
    expect(kanaOf(undefined)).toBeNull();
  });

  it('trackCeremonies records reward events until stopped', () => {
    const t = trackCeremonies();
    bus.emit('badge:earned', { id: 'first-step' });
    bus.emit('attempt:graded', {} as never);
    bus.emit('stamp:earned', { station: 4, perfect: false, assisted: false });
    t.stop();
    bus.emit('badge:earned', { id: 'seven' });
    expect(t.events.map((e) => e.name)).toEqual(['badge:earned', 'stamp:earned']);
    expect(store.ready.value).toBe(false);
  });
});
