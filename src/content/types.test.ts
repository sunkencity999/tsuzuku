/**
 * Contract pins for the listening additions to `src/content/types.ts` (design 08 §5):
 * genres and their first stations, the `quota.listening` column, the `pool` content kind
 * and `isAuthenticText`. Everything here is data another owner builds on, so a change is
 * a CHANGELOG line, not a test fix.
 */
import {
  AUTHENTIC_GENRES,
  CONTENT_KINDS,
  GENRE_FROM_STATION,
  ID_PATTERNS,
  LINE_EMOTIONS,
  LISTENING_GENRES,
  QUESTION_KINDS,
  STATIONS,
  isAuthenticText,
} from './types';
import type { ListeningGenre, StoryItem } from './types';

describe('listening genres (design 08 §3, §5)', () => {
  it('LISTENING_GENRES has the 15 belt-table genres, each with a first station between 4 and 47', () => {
    expect(LISTENING_GENRES.length).toBe(15);
    expect(new Set(LISTENING_GENRES).size).toBe(15);
    expect(Object.keys(GENRE_FROM_STATION).sort()).toEqual([...LISTENING_GENRES].sort());
    for (const g of LISTENING_GENRES) {
      const n = GENRE_FROM_STATION[g];
      expect(Number.isInteger(n), g).toBe(true);
      expect(n, g).toBeGreaterThanOrEqual(4);
      expect(n, g).toBeLessThanOrEqual(47);
    }
    // the belt table's first stations
    expect(GENRE_FROM_STATION.exchange).toBe(4);
    expect(GENRE_FROM_STATION.phone).toBe(8);
    expect(GENRE_FROM_STATION.narrative).toBe(16);
    expect(GENRE_FROM_STATION.interview).toBe(25);
    expect(GENRE_FROM_STATION.news).toBe(32);
    expect(GENRE_FROM_STATION.debate).toBe(39);
    expect(GENRE_FROM_STATION.essay).toBe(47);
  });

  it('AUTHENTIC_GENRES is the §12 set and a subset of LISTENING_GENRES', () => {
    expect([...AUTHENTIC_GENRES].sort()).toEqual(['casual-talk', 'debate', 'drama', 'interview', 'lecture', 'news']);
    for (const g of AUTHENTIC_GENRES) expect((LISTENING_GENRES as readonly string[]).includes(g)).toBe(true);
  });

  it('LINE_EMOTIONS and QUESTION_KINDS are the §5 unions', () => {
    expect([...LINE_EMOTIONS]).toEqual(['neutral', 'warm', 'annoyed', 'sad', 'glad', 'whisper']);
    expect([...QUESTION_KINDS]).toEqual(['gist', 'detail', 'number', 'speaker', 'inference']);
  });
});

describe('STATIONS quota.listening (design 08 §3)', () => {
  it('is 0 for Stations 1–3 and 2 for 4–53, summing to 100 pieces beside the 137 texts', () => {
    expect(STATIONS.length).toBe(53);
    let pieces = 0;
    let stories = 0;
    for (const st of STATIONS) {
      expect(st.quota.listening, st.id).toBe(st.number <= 3 ? 0 : 2);
      pieces += st.quota.listening;
      stories += st.quota.stories;
    }
    expect(pieces).toBe(100);
    expect(stories).toBe(137);
  });

  it('keeps the id sequence room for the pieces: stories + listening ≤ 9 everywhere (the s-NN-<1..9> grammar)', () => {
    for (const st of STATIONS) expect(st.quota.stories + st.quota.listening, st.id).toBeLessThanOrEqual(9);
  });
});

describe("the 'pool' content kind (design 08 §4–§5)", () => {
  it('CONTENT_KINDS includes pool and ID_PATTERNS covers every kind', () => {
    expect(CONTENT_KINDS).toContain('pool');
    expect(Object.keys(ID_PATTERNS).sort()).toEqual([...CONTENT_KINDS].sort());
  });

  it('ID_PATTERNS.pool accepts pool-01 … pool-53 and nothing else', () => {
    expect(ID_PATTERNS.pool.test('pool-07')).toBe(true);
    expect(ID_PATTERNS.pool.test('pool-01')).toBe(true);
    expect(ID_PATTERNS.pool.test('pool-53')).toBe(true);
    for (const bad of ['pool-54', 'pool-00', 'pool-7', 'pool-071', 'listening/pool-07.json', 'st-07']) expect(ID_PATTERNS.pool.test(bad), bad).toBe(false);
  });
});

describe('isAuthenticText (design 08 §12)', () => {
  const text = (over: Partial<Pick<StoryItem, 'bridge' | 'genre' | 'kind' | 'register'>>): Pick<StoryItem, 'bridge' | 'genre' | 'kind' | 'register'> => ({
    kind: 'story',
    register: 'polite',
    ...over,
  });

  it('is true for a bridge story, an authentic-genre piece and a casual dialogue', () => {
    expect(isAuthenticText(text({ bridge: true }))).toBe(true);
    expect(isAuthenticText(text({ genre: 'news' }))).toBe(true);
    expect(isAuthenticText(text({ kind: 'dialogue', register: 'casual' }))).toBe(true);
    for (const g of AUTHENTIC_GENRES) expect(isAuthenticText(text({ genre: g })), g).toBe(true);
  });

  it('is false for a polite dialogue, a non-genre story and a non-authentic genre', () => {
    expect(isAuthenticText(text({ kind: 'dialogue', register: 'polite' }))).toBe(false);
    expect(isAuthenticText(text({}))).toBe(false);
    expect(isAuthenticText(text({ bridge: false }))).toBe(false);
    for (const g of LISTENING_GENRES.filter((x): x is ListeningGenre => !AUTHENTIC_GENRES.has(x))) {
      expect(isAuthenticText(text({ genre: g })), g).toBe(false);
    }
    // a casual story (narration) is not a casual dialogue
    expect(isAuthenticText(text({ kind: 'story', register: 'casual' }))).toBe(false);
  });
});
