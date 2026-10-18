import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID } from '@/content/fixtures';
import { toKana } from '@/content/ruby';
import type { StoryItem, StoryLine } from '@/content/types';
import { moraCount, normalizeJa } from '@/shared/jp';
import { NATURAL_SLOW_RATE, activeToken, clauseKana, clauseSpans, clauseText, isSlowCue, speechMoraCount, tokenMoraSpans, type MoraSpan } from './karaoke';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const LINES: StoryLine[] = [...DIALOGUE.lines, ...STORY.lines];
const PUNCT = /^[、。！？「」…・\s]+$/;

describe('tokenMoraSpans (design 08 §9)', () => {
  it('spans of a ruby’d line are contiguous from 0 and sum to the mora count of line.kana (punctuation is not a beat)', () => {
    for (const line of LINES) {
      const spans = tokenMoraSpans(line);
      expect(spans).toHaveLength(line.tokens.length);
      let k = 0;
      for (const [s, e] of spans) {
        expect(s).toBe(k);
        expect(e).toBeGreaterThanOrEqual(s);
        k = e;
      }
      // the engine drops pause morae, so the total is the kana's morae without 、。 (= moraCount(line.kana) minus its punctuation)
      expect(k).toBe(speechMoraCount(line.kana));
      expect(k).toBe(moraCount(normalizeJa(line.kana)));
      const punct = Array.from(line.kana).filter((ch) => PUNCT.test(ch)).length;
      expect(k).toBe(moraCount(line.kana) - punct);
      // V13: the token readings concatenate to the kana, so the spans partition exactly that string
      expect(toKana(line.ja).length).toBeGreaterThan(0);
    }
  });

  it('punctuation tokens own zero morae; every word token owns at least one', () => {
    const line = DIALOGUE.lines[3] as StoryLine; // はい、のみます。 → ['はい', '、', '飲みます', '。']
    const spans = tokenMoraSpans(line);
    expect(spans).toEqual([
      [0, 2],
      [2, 2],
      [2, 6],
      [6, 6],
    ]);
    for (const l of LINES) {
      tokenMoraSpans(l).forEach(([s, e], i) => {
        const tok = l.tokens[i] as string;
        if (PUNCT.test(tok)) expect(e - s).toBe(0);
        else expect(e - s).toBeGreaterThan(0);
      });
    }
  });

  it('a kanji ruby that straddles tokens is counted by its reading, never by its base length', () => {
    const line = DIALOGUE.lines[9] as StoryLine; // {犬|いぬ}は{水|みず}を{飲|の}みますか。
    const spans = tokenMoraSpans(line);
    expect(spans[0]).toEqual([0, 2]); // 犬 → いぬ (2 morae for 1 kanji)
    expect(spans[2]).toEqual([3, 5]); // 水 → みず
    expect(spans[4]).toEqual([6, 10]); // 飲みます → のみます
  });

  it('a line without tokens has no spans', () => {
    expect(tokenMoraSpans({ ja: 'パンを{食|た}べます。', tokens: [] })).toEqual([]);
  });
});

describe('activeToken', () => {
  it('is monotone in the mora index, skips punctuation tokens and stays on the last word past the end', () => {
    for (const line of LINES) {
      const spans = tokenMoraSpans(line);
      const total = speechMoraCount(line.kana);
      let prev = -1;
      for (let m = 0; m <= total + 2; m++) {
        const a = activeToken(spans, m);
        expect(a).toBeGreaterThanOrEqual(prev);
        expect(a).toBeGreaterThanOrEqual(0);
        const [s, e] = spans[a] as MoraSpan;
        expect(e).toBeGreaterThan(s); // never a punctuation token
        if (m < total) {
          expect(s).toBeLessThanOrEqual(m);
          // the owner of mora m, or the last word before a pause
          expect(m < e || spans.slice(a + 1).every(([s2, e2]) => e2 <= s2 || s2 > m)).toBe(true);
        }
        prev = a;
      }
      expect(activeToken(spans, total + 10)).toBe(prev);
    }
  });

  it('returns -1 before anything has started', () => {
    expect(activeToken([], 0)).toBe(-1);
    expect(activeToken([[0, 2]], -1)).toBe(-1);
    expect(
      activeToken(
        [
          [0, 0],
          [0, 3],
        ],
        0,
      ),
    ).toBe(1);
  });
});

describe('clauses', () => {
  it('clauseSpans implies 0 and the end, ignores duplicates and out-of-range cuts, and is one clause without boundaries', () => {
    expect(clauseSpans([5, 12], 20)).toEqual([
      [0, 5],
      [5, 12],
      [12, 20],
    ]);
    expect(clauseSpans([0, 5, 5, 12, 20, 25], 20)).toEqual([
      [0, 5],
      [5, 12],
      [12, 20],
    ]);
    expect(clauseSpans([12, 5], 20)).toEqual([
      [0, 5],
      [5, 12],
      [12, 20],
    ]);
    expect(clauseSpans(undefined, 7)).toEqual([[0, 7]]);
    expect(clauseSpans([], 7)).toEqual([[0, 7]]);
    expect(clauseSpans([3], 0)).toEqual([]);
  });

  it('clauseKana cuts the speech morae of the kana, so punctuation never shifts the clause', () => {
    const line = DIALOGUE.lines[10] as StoryLine; // はい、のみます。ひともいぬもみずをのみます。
    expect(clauseKana(line.kana, [0, 6])).toBe('はいのみます');
    expect(clauseKana(line.kana, [6, 11])).toBe('ひともいぬ');
    expect(clauseKana(line.kana, [11, speechMoraCount(line.kana)])).toBe('もみずをのみます');
  });

  it('clauseText gives the written surface of a clause that falls on token boundaries, with inner punctuation, and null when it cuts a word', () => {
    const line = DIALOGUE.lines[10] as StoryLine;
    expect(clauseText(line, [0, 6])).toBe('はい、飲みます');
    expect(clauseText(line, [6, 11])).toBe('人も犬');
    expect(clauseText(line, [7, 11])).toBeNull(); // cuts 人 → も犬
    expect(clauseText({ ja: 'パンを{食|た}べます。', tokens: [] }, [0, 3])).toBeNull();
  });

  it('isSlowCue names the natural-slow take only', () => {
    expect(NATURAL_SLOW_RATE).toBe(0.85);
    expect(isSlowCue({ rate: 0.85 })).toBe(true);
    expect(isSlowCue({ rate: 1 })).toBe(false);
    expect(isSlowCue(undefined)).toBe(false);
  });
});
