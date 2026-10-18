/**
 * Unit tests for the Listening Arena set helpers (`./set.ts`): the dictation
 * bounds, clause picking, clause grading and the choice builder. The Arena
 * tests exercise the same helpers through the component; these pin the edges.
 */
import { FIXTURE, FIXTURE_DIALOGUE_ID } from '@/content/fixtures';
import type { StoryItem, StoryLine } from '@/content/types';
import { rngFor } from '@/shared/hash';
import { normalizeJa } from '@/shared/jp';
import { clauseKana, speechMoraCount } from './karaoke';
import { CLAUSE_MIN_MORAE, DICTATION_MAX_MORAE, QUESTION_KIND_RANK, buildListeningSet, choiceItem, dictable, dictationTarget, gradeDictation, orderQuestions, pickClause } from './set';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;

/** 31 speech morae; the writer's clause cuts fall at 16 and 22. */
const LONG = 'わたしはまいあさコーヒーをのんで、パンをたべて、いぬとさんぽします。';
const LONG_LINE: StoryLine = { ja: LONG, kana: LONG, en: 'Every morning I drink coffee, eat bread and walk the dog.', tokens: [] };

describe('dictable', () => {
  it('a line of DICTATION_MAX_MORAE morae dictates whole, one more does not; punctuation is a pause, katakana folds', () => {
    expect(DICTATION_MAX_MORAE).toBe(22);
    expect(dictable('あ'.repeat(DICTATION_MAX_MORAE))).toBe(true);
    expect(dictable('あ'.repeat(DICTATION_MAX_MORAE + 1))).toBe(false);
    expect(dictable(`${'あ'.repeat(DICTATION_MAX_MORAE)}。`)).toBe(true);
    expect(dictable('ア'.repeat(DICTATION_MAX_MORAE))).toBe(true);
    expect(speechMoraCount(LONG)).toBe(31);
    expect(dictable(LONG)).toBe(false);
  });
});

describe('pickClause (design 08 §9)', () => {
  it('rejects a clause under CLAUSE_MIN_MORAE and one over DICTATION_MAX_MORAE; a clause of exactly 4 or 22 is accepted', () => {
    expect(CLAUSE_MIN_MORAE).toBe(4);
    // 27 morae cut at 3: [0, 3) is too short and [3, 27) too long → nothing to dictate
    expect(pickClause('あ'.repeat(27), [3], rngFor('x'))).toBeNull();
    // cut at 4: [0, 4) is the one clause that fits
    expect(pickClause('あ'.repeat(27), [4], rngFor('x'))).toEqual([0, 4]);
    // 30 morae cut at 23: [0, 23) is one over the cap, [23, 30) fits
    expect(pickClause('あ'.repeat(30), [23], rngFor('x'))).toEqual([23, 30]);
    // 25 morae cut at 22: [0, 22) fits exactly, [22, 25) is too short
    expect(pickClause('あ'.repeat(25), [22], rngFor('x'))).toEqual([0, 22]);
  });

  it('without boundaries a long line is one clause too long to dictate; a short line is its own clause', () => {
    expect(pickClause(LONG, undefined, rngFor('x'))).toBeNull();
    expect(pickClause(LONG, [], rngFor('x'))).toBeNull();
    expect(pickClause('あ'.repeat(10), undefined, rngFor('x'))).toEqual([0, 10]);
    expect(pickClause('', [2], rngFor('x'))).toBeNull();
  });

  it('0 and the end are implied, duplicates and out-of-range cuts are ignored, and the draw is deterministic per rng', () => {
    const a = pickClause(LONG, [0, 16, 16, 22, 31, 99, -4, 2.5], rngFor('same'));
    const b = pickClause(LONG, [16, 22], rngFor('same'));
    expect(a).toEqual(b);
    expect([
      [0, 16],
      [16, 22],
      [22, 31],
    ]).toContainEqual(a);
    // every candidate is reachable over enough draws, and none breaks the bounds
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = pickClause(LONG, [16, 22], rngFor(`draw-${i}`));
      expect(c).not.toBeNull();
      const [s, e] = c as [number, number];
      expect(e - s).toBeGreaterThanOrEqual(CLAUSE_MIN_MORAE);
      expect(e - s).toBeLessThanOrEqual(DICTATION_MAX_MORAE);
      seen.add(`${s}-${e}`);
    }
    expect(seen.size).toBe(3);
  });
});

describe('dictationTarget / gradeDictation against a clause', () => {
  it('the target is the clause kana; the clause is graded like a whole line, and the whole line is not a clause', () => {
    expect(dictationTarget(LONG_LINE)).toBe(LONG);
    expect(dictationTarget(LONG_LINE, [16, 22])).toBe('パンをたべて');
    expect(clauseKana(LONG, [16, 22])).toBe('パンをたべて');
    expect(clauseKana(LONG, [22, 31])).toBe('いぬとさんぽします');
    const good = gradeDictation('パンをたべて', LONG_LINE, [16, 22]);
    expect(good.score).toBe(1);
    expect(good.rating).toBe(3);
    expect(good.correct).toBe(true);
    expect(good.tags).toEqual([]);
    // one wrong mora of six: a right answer, but not a perfect one
    const near = gradeDictation('パンをたべで', LONG_LINE, [16, 22]);
    expect(near.correct).toBe(true);
    expect(near.rating).toBeLessThan(3);
    expect(near.rating).toBeGreaterThanOrEqual(2);
    expect(near.tags.length).toBe(1);
    // the whole line typed against one clause is not a match
    const whole = gradeDictation(normalizeJa(LONG), LONG_LINE, [16, 22]);
    expect(whole.correct).toBe(false);
    expect(whole.rating).toBe(1);
    expect(whole.score).toBeLessThan(0.5);
    // without a clause the whole line is the target
    expect(gradeDictation(normalizeJa(LONG), LONG_LINE).rating).toBe(3);
    expect(gradeDictation('パンをたべて', LONG_LINE).correct).toBe(false);
  });
});

describe('choiceItem', () => {
  const L = (en: string, ja: string): StoryLine => ({ ja, kana: ja, en, tokens: [] });

  it('draws three distractors from the other lines, deduped on the plain surface, with the answer index right', () => {
    const lines = [
      L('The dog drinks water.', 'いぬがみずをのみます。'),
      L('The dog drinks water.', 'いぬがみずをのみます。'),
      L('I eat bread.', 'パンをたべます。'),
      L('Hello.', 'こんにちは。'),
      L('Good morning.', 'おはよう。'),
      L('Coffee, please.', 'コーヒーをください。'),
    ];
    const item = choiceItem(lines, 0, false, rngFor('c'));
    if (item.kind !== 'choice') throw new Error('expected a choice item');
    expect(item.lineIndex).toBe(0);
    expect(item.ja).toBe(false);
    expect(item.choices).toHaveLength(4);
    expect(new Set(item.choices).size).toBe(4);
    expect(item.choices[item.answer]).toBe('The dog drinks water.');
    expect(item.choices.filter((c) => c === 'The dog drinks water.')).toHaveLength(1);
  });

  it('fewer distinct lines give fewer choices, still unique; from Green the Japanese line itself is the choice', () => {
    const lines = [L('A dog.', 'いぬ。'), L('A dog.', 'いぬ。'), L('Water.', 'みず。')];
    const en = choiceItem(lines, 2, false, rngFor('c'));
    if (en.kind !== 'choice') throw new Error('expected a choice item');
    expect(en.choices).toHaveLength(2);
    expect(new Set(en.choices)).toEqual(new Set(['A dog.', 'Water.']));
    expect(en.choices[en.answer]).toBe('Water.');
    const ja = choiceItem(lines, 2, true, rngFor('c'));
    if (ja.kind !== 'choice') throw new Error('expected a choice item');
    expect(ja.ja).toBe(true);
    expect(ja.choices).toHaveLength(2);
    expect(ja.choices[ja.answer]).toBe('みず。');
  });
});

describe('orderQuestions / buildListeningSet', () => {
  it('asks gist first, then by kind rank, keeping the writer’s order within a kind', () => {
    expect(QUESTION_KIND_RANK).toEqual({ gist: 0, detail: 1, number: 2, speaker: 3, inference: 4 });
    const qs = [{ kind: 'inference' as const, q: 'a' }, { kind: 'detail' as const, q: 'b' }, { q: 'c' }, { kind: 'detail' as const, q: 'd' }, { kind: 'gist' as const, q: 'e' }];
    expect(orderQuestions(qs).map((q) => q.q)).toEqual(['c', 'e', 'b', 'd', 'a']);
    expect(orderQuestions([])).toEqual([]);
  });

  it('a line over DICTATION_MAX_MORAE is a clause dictation only when the cue has usable cuts; otherwise a choice item', () => {
    const story: StoryItem = {
      ...DIALOGUE,
      id: 's-04-9',
      titleEn: 'Long mornings',
      comprehension: [],
      lines: Array.from({ length: 6 }, (_, i) => ({ ...LONG_LINE, en: `Every morning (${i}) I drink coffee, eat bread and walk the dog.` })),
    };
    const rng = () => rngFor('set-long');
    const withCuts = buildListeningSet(story, { rng: rng(), station: 4, clauses: () => [16, 22] });
    expect(withCuts).toHaveLength(6);
    withCuts.forEach((it, k) => {
      expect(it.kind).toBe(k % 2 === 1 ? 'dictation' : 'choice');
      if (it.kind === 'dictation') {
        expect(it.clause).toBeDefined();
        const [s, e] = it.clause as [number, number];
        expect(e - s).toBeGreaterThanOrEqual(CLAUSE_MIN_MORAE);
        expect(e - s).toBeLessThanOrEqual(DICTATION_MAX_MORAE);
      }
    });
    const useless = buildListeningSet(story, { rng: rng(), station: 4, clauses: () => [2] });
    expect(useless.every((it) => it.kind === 'choice')).toBe(true);
    const none = buildListeningSet(story, { rng: rng(), station: 4 });
    expect(none.every((it) => it.kind === 'choice')).toBe(true);
    // the same lines picked either way: clause dictation never changes which lines a set hears
    expect(none.map((it) => (it.kind === 'gist' ? -1 : it.lineIndex))).toEqual(withCuts.map((it) => (it.kind === 'gist' ? -1 : it.lineIndex)));
  });
});
