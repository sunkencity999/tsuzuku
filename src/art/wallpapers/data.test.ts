import { createFakeLoader, G, V } from '../../content/fixtures';
import type { ContentLoader } from '../../content/loader';
import { DRILL_IDS, type CardKey, type GrammarItem } from '../../content/types';
import { BADGE_IDS } from '../../shared/catalog';
import { cardKey } from '../../shared/ids';
import { NAME_MAX_GLYPHS, type CardTuple } from '../../shared/store-types';
import { WRITING_PREFIX } from '../../shared/writing';
import { epochDay } from '../../shared/time';
import { card, DEFAULT_TEST_NOW, makeTestStore } from '../../store/testing';
import { isWallpaperData, listenHoursFrom, masteredItems, normalizeData, sampleData, SENTENCE_MAX_GLYPHS, validateData, wallpaperData } from './data';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const DAY_MS = 86_400_000;

/** Brown vocab: rec S ≥ 30, prod S ≥ 7. Black: every facet ≥ 120. */
function vocabCards(id: string, recS: number, prodS: number, reps = 10): Record<CardKey, CardTuple> {
  return {
    [cardKey(id, 'rec')]: card({ s: recS, reps, state: 2 }),
    [cardKey(id, 'prod')]: card({ s: prodS, reps: Math.floor(reps / 2), state: 2 }),
  };
}

const CARDS: Record<CardKey, CardTuple> = {
  // kana: ね strongest, あ, い; う only Green (rec 10, no prod)
  [cardKey('k-h-ne', 'rec')]: card({ s: 200, reps: 40, state: 2 }),
  [cardKey('k-h-ne', 'prod')]: card({ s: 150, reps: 20, state: 2 }),
  [cardKey('k-h-a', 'rec')]: card({ s: 90, reps: 30, state: 2 }),
  [cardKey('k-h-a', 'prod')]: card({ s: 20, reps: 10, state: 2 }),
  [cardKey('k-h-i', 'rec')]: card({ s: 45, reps: 12, state: 2 }),
  [cardKey('k-h-i', 'prod')]: card({ s: 8, reps: 4, state: 2 }),
  [cardKey('k-h-u', 'rec')]: card({ s: 10, reps: 3, state: 2 }),
  // vocab: 犬 brown (rec 60), コーヒー brown (rec 40, loanword), パン black-ish (rec 130/prod 125), 水 green (rec 20)
  ...vocabCards(V.犬, 60, 9, 22),
  ...vocabCards(V.コーヒー, 40, 12, 14),
  ...vocabCards(V.パン, 130, 125, 60),
  ...vocabCards(V.水, 20, 9, 6),
  // chunk: おはよう (prod only) brown
  [cardKey(V.おはよう, 'prod')]: card({ s: 35, reps: 9, state: 2 }),
  // kanji: 食 brown (comp 50, read 10); 人 green (comp 12)
  [cardKey('j-食', 'comp')]: card({ s: 50, reps: 15, state: 2 }),
  [cardKey('j-食', 'read')]: card({ s: 10, reps: 6, state: 2 }),
  [cardKey('j-人', 'comp')]: card({ s: 12, reps: 5, state: 2 }),
  // grammar: です brown (cloze 70, prod 8); ます brown (cloze 33, prod 7); は yellow
  [cardKey(G.です, 'cloze')]: card({ s: 70, reps: 20, state: 2 }),
  [cardKey(G.です, 'prod')]: card({ s: 8, reps: 5, state: 2 }),
  [cardKey(G.ます, 'cloze')]: card({ s: 33, reps: 11, state: 2 }),
  [cardKey(G.ます, 'prod')]: card({ s: 7, reps: 3, state: 2 }),
  [cardKey(G.は, 'cloze')]: card({ s: 3, reps: 2, state: 1 }),
  // a mastered id the fixture does not know → skipped, not thrown
  ...vocabCards('v-n5-0999', 80, 20, 5),
};

async function fullStore() {
  return makeTestStore({
    cards: CARDS,
    save: {
      profile: { name: 'Hana', nameKana: 'ハナ', chosenKanji: '続', belt: 'yellow', level: 7, xp: 3210 },
      streak: { current: 4, longest: 31, totalDays: 88, freezes: 2, restDaysTaken: 5 },
      progress: { station: 6 },
      stats: { rapidBest: 44 },
      collections: {
        badges: { seven: TODAY - 3, 'first-step': TODAY - 20, 'three-day': TODAY - 3 },
        stamps: { 4: { at: TODAY - 10, perfect: true, assisted: false }, 2: { at: TODAY - 30, perfect: false, assisted: false } },
      },
      daily: {
        [TODAY]: { reps: 10, ok: 9, minutes: 25, xp: 40, input: 0 },
        [TODAY - 1]: { reps: 10, ok: 9, minutes: 12, xp: 40, input: 0 },
        [TODAY - 89]: { reps: 1, ok: 1, minutes: 7, xp: 2, input: 0 },
        [TODAY - 90]: { reps: 1, ok: 1, minutes: 99, xp: 2, input: 0 },
      },
    },
  });
}

describe('wallpaperData', () => {
  it('mastered lists come sorted by stability and counts match the Brown+ items', async () => {
    const s = await fullStore();
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.mastered.kana).toEqual(['ね', 'あ', 'い']);
    expect(d.mastered.kanji).toEqual(['食']);
    expect(d.mastered.vocab.map((v) => v.word)).toEqual(['パン', '犬', 'コーヒー', 'おはよう']);
    expect(d.mastered.vocab[0]).toEqual({ word: 'パン', kana: 'パン', reviews: 90 });
    expect(d.mastered.vocab[1]!.reviews).toBe(33);
    expect(d.grammarBrown).toEqual(['〜です', '〜ます']);
    expect(d.katakanaBrown).toEqual(['パン', 'コーヒー']);
    expect(d.arcGrammar).toEqual([]);
    const m = masteredItems(s.cards);
    expect(m.kana.length).toBe(3);
    expect(m.vocab.length).toBe(4); // incl. the unknown id, dropped at name resolution
    expect(m.chunk.length).toBe(1);
    expect(m.grammar.length).toBe(2);
    expect(m.kanji.length).toBe(1);
    expect(isWallpaperData(d)).toBe(true);
  });
  it('profile, streak, badges, stamps, minutes90 and the date', async () => {
    const s = await fullStore();
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.nameKana).toBe('ハナ');
    expect(d.chosenKanji).toBe('続');
    expect(d.belt).toBe('yellow');
    expect(d.level).toBe(7);
    expect(d.xp).toBe(3210);
    expect(d.streak).toBe(31);
    expect(d.totalDays).toBe(88);
    expect(d.freezes).toBe(2);
    expect(d.restDays).toBe(5);
    expect(d.rapidBest).toBe(44);
    expect(d.station).toBe(6);
    expect(d.badgesInOrder).toEqual(['first-step', 'three-day', 'seven']);
    expect(d.stamps).toEqual([2, 4]);
    expect(d.minutes90.length).toBe(90);
    expect(d.minutes90[89]).toBe(25);
    expect(d.minutes90[88]).toBe(12);
    expect(d.minutes90[0]).toBe(7);
    expect(d.minutes90.reduce((a, b) => a + b, 0)).toBe(44);
    expect(d.date).toBe(TODAY);
    expect(d.writingSentences).toEqual([]);
    expect(d.dictatedSentence).toBeUndefined();
    expect(d.sentenceOfChoice).toBeUndefined();
  });

  it('listenHours = hours of the ledger’s listen rows, dojo and outside alike; other kinds do not count (design 08 §11, 茶屋の灯)', async () => {
    const s = await makeTestStore({
      cards: CARDS,
      save: {
        ledger: {
          entries: [
            [TODAY - 1, 90, 0, 0], // listen, in the dojo
            [TODAY - 2, 30, 0, 1], // listen, outside
            [TODAY - 3, 600, 1, 1], // read
            [TODAY - 4, 45, 2, 1], // watch
          ],
        },
      },
    });
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.listenHours).toBe(2);
    expect(listenHoursFrom([])).toBe(0);
    expect(listenHoursFrom(s.meta().ledger.entries)).toBe(2);
    // an override still wins and survives normalisation (the Studio passes its data through normalizeData)
    expect((await wallpaperData({ listenHours: 47 }, { store: s, content: createFakeLoader() })).listenHours).toBe(47);
    expect(normalizeData({ ...sampleData(1), listenHours: 47 }).listenHours).toBe(47);
  });
  it('Gojūon reaction times and words this month come from the log', async () => {
    const s = await fullStore();
    const gojuon = DRILL_IDS.indexOf('gojuon-fighter');
    const flash = DRILL_IDS.indexOf('kana-flash');
    s.log.push([DEFAULT_TEST_NOW - 3 * DAY_MS, cardKey('k-h-ne', 'rec'), 3, 900, gojuon, 0]);
    s.log.push([DEFAULT_TEST_NOW - 2 * DAY_MS, cardKey('k-h-ne', 'rec'), 3, 650, gojuon, 0]);
    s.log.push([DEFAULT_TEST_NOW - 2 * DAY_MS, cardKey('k-h-a', 'rec'), 3, 300, flash, 0]);
    s.log.push([DEFAULT_TEST_NOW - 1 * DAY_MS, cardKey(V.犬, 'rec'), 3, 1200, 4, 0]);
    s.log.push([DEFAULT_TEST_NOW - 40 * DAY_MS, cardKey(V.水, 'rec'), 3, 1200, 4, 0]);
    s.log.push([DEFAULT_TEST_NOW - 1 * DAY_MS, cardKey(V.水, 'prod'), 3, 1200, 8, 0]);
    s.log.push([DEFAULT_TEST_NOW - 5 * DAY_MS, cardKey(V.パン, 'rec'), 3, 1200, 4, 0]);
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.gojuonMs).toEqual({ ね: 650 });
    expect(d.wordsThisMonth).toBe(2); // 犬 and パン; 水 was first met 40 days ago
  });
  it('overrides win and are normalised; arc grammar uses the item station', async () => {
    const s = await fullStore();
    const fake = createFakeLoader();
    const content: ContentLoader = {
      ...fake,
      get: <T,>(id: string): T | undefined => {
        const it = fake.get(id);
        return (id === G.ます ? { ...(it as GrammarItem), station: 30 } : it) as T | undefined;
      },
    };
    const d = await wallpaperData({ sentenceOfChoice: ' 継続は力なり。 ', nameKana: 'ケン', minutes90: [1, 2, 3], chosenKanji: undefined }, { store: s, content });
    expect(d.sentenceOfChoice).toBe('継続は力なり。');
    expect(d.nameKana).toBe('ケン');
    expect(d.chosenKanji).toBe('続');
    expect(d.minutes90.length).toBe(90);
    expect(d.minutes90.slice(-3)).toEqual([1, 2, 3]);
    expect(d.arcGrammar).toEqual(['〜ます']);
  });
  it('falls back to the display name and 無名, and tolerates a loader that cannot load', async () => {
    const s = await makeTestStore({ save: { profile: { name: 'Mumei', nameKana: '' } } });
    const fake = createFakeLoader();
    const broken: ContentLoader = { ...fake, load: () => Promise.reject(new Error('offline')) };
    const d = await wallpaperData({}, { store: s, content: broken });
    expect(d.nameKana).toBe('Mumei');
    expect(d.mastered).toEqual({ kana: [], kanji: [], vocab: [] });
    expect(d.minutes90.every((m) => m === 0)).toBe(true);
    expect(normalizeData({ nameKana: '   ' }).nameKana).toBe('無名');
  });
  it('writing sentences come from the 作文: bookmarks (prefix stripped, other bookmarks ignored); a Studio override still wins', async () => {
    const s = await makeTestStore({
      save: { bookmarks: [`${WRITING_PREFIX}毎朝、駅まで歩きます。`, '二つの言えなかったこと', `${WRITING_PREFIX}雨の日は本を読みます。`, '作文のない栞', `${WRITING_PREFIX}   `] },
    });
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.writingSentences).toEqual(['毎朝、駅まで歩きます。', '雨の日は本を読みます。']);
    const o = await wallpaperData({ writingSentences: ['上書きの一文。'] }, { store: s, content: createFakeLoader() });
    expect(o.writingSentences).toEqual(['上書きの一文。']);
    const none = await wallpaperData({}, { store: await makeTestStore({ save: { bookmarks: ['栞だけ'] } }), content: createFakeLoader() });
    expect(none.writingSentences).toEqual([]);
  });
  it('a perfect dictation on the profile reaches the Waveform (trimmed); absent → undefined', async () => {
    const s = await makeTestStore({ save: { profile: { dictatedSentence: ' 継続は力なり。 ' } } });
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.dictatedSentence).toBe('継続は力なり。');
    const o = await wallpaperData({ dictatedSentence: '上書き。' }, { store: s, content: createFakeLoader() });
    expect(o.dictatedSentence).toBe('上書き。');
    expect((await wallpaperData({}, { store: await makeTestStore(), content: createFakeLoader() })).dictatedSentence).toBeUndefined();
  });
  it('an imported save with a 40-glyph name is cut to NAME_MAX_GLYPHS (code points, so a surrogate pair is never split)', async () => {
    const long = 'あいうえおかきくけこ'.repeat(4);
    expect(Array.from(long).length).toBe(40);
    const s = await makeTestStore({ save: { profile: { name: long, nameKana: '' } } });
    const d = await wallpaperData({}, { store: s, content: createFakeLoader() });
    expect(d.nameKana).toBe(Array.from(long).slice(0, NAME_MAX_GLYPHS).join(''));
    expect(Array.from(d.nameKana).length).toBe(NAME_MAX_GLYPHS);
    const astral = '𠮷'.repeat(40);
    const cut = normalizeData({ nameKana: `  ${astral}  ` }).nameKana;
    expect(cut).toBe('𠮷'.repeat(NAME_MAX_GLYPHS));
    expect(Array.from(cut).length).toBe(NAME_MAX_GLYPHS);
    expect(normalizeData({ nameKana: ' ハナ ' }).nameKana).toBe('ハナ');
  });
});

describe('sampleData', () => {
  it('is deterministic per seed, valid, and differs across seeds', () => {
    const a = sampleData(1);
    const b = sampleData(1);
    expect(a).toEqual(b);
    expect(validateData(a)).toEqual([]);
    expect(sampleData(2)).not.toEqual(a);
    expect(a.mastered.kana.length).toBe(46);
    expect(a.mastered.vocab.length).toBe(40);
    expect(a.minutes90.length).toBe(90);
    expect(Object.keys(a.gojuonMs).length).toBe(46);
    expect(a.katakanaBrown).toContain('コーヒー');
    expect(a.badgesInOrder.every((id) => (BADGE_IDS as readonly string[]).includes(id))).toBe(true);
    expect(a.stamps[0]).toBe(1);
  });
  it('applies overrides', () => {
    const d = sampleData(3, { belt: 'black', nameKana: 'タケシ', stamps: [53, 1, 1] });
    expect(d.belt).toBe('black');
    expect(d.nameKana).toBe('タケシ');
    expect(d.stamps).toEqual([1, 53]);
  });
});

describe('validateData / normalizeData', () => {
  it('reports every malformed field', () => {
    const problems = validateData({ ...sampleData(1), belt: 'gold', minutes90: [1], stamps: [0, 99], chosenKanji: '二つ', xp: -1, badgesInOrder: ['nope'] });
    expect(problems.some((p) => p.startsWith('belt'))).toBe(true);
    expect(problems.some((p) => p.startsWith('minutes90'))).toBe(true);
    expect(problems.some((p) => p.startsWith('stamps'))).toBe(true);
    expect(problems.some((p) => p.startsWith('chosenKanji'))).toBe(true);
    expect(problems.some((p) => p.startsWith('xp'))).toBe(true);
    expect(problems.some((p) => p.startsWith('badgesInOrder'))).toBe(true);
    expect(validateData({ ...sampleData(1), listenHours: -1 }).some((p) => p.startsWith('listenHours'))).toBe(true);
    expect(validateData({ ...sampleData(1), listenHours: 12.5 })).toEqual([]);
    expect(validateData(null)).toEqual(['not an object']);
    expect(validateData(42)).toEqual(['not an object']);
  });
  it('normalizeData repairs what validateData rejects', () => {
    const fixed = normalizeData({ belt: 'gold' as never, minutes90: [1, Number.NaN, -3], stamps: [0, 99, 7, 7], chosenKanji: '二つ', xp: -1, badgesInOrder: ['nope', 'seven'] as never, gojuonMs: { あ: 500, い: -1 }, station: 99 });
    expect(validateData(fixed)).toEqual([]);
    expect(fixed.belt).toBe('white');
    expect(fixed.minutes90.slice(-3)).toEqual([1, 0, 0]);
    expect(fixed.stamps).toEqual([7]);
    expect(fixed.chosenKanji).toBeUndefined();
    expect(fixed.xp).toBe(0);
    expect(fixed.badgesInOrder).toEqual(['seven']);
    expect(fixed.gojuonMs).toEqual({ あ: 500 });
    expect(fixed.station).toBe(53);
  });
  it('sentences are trimmed, emptied when blank and cut to SENTENCE_MAX_GLYPHS', () => {
    const long = 'あ'.repeat(SENTENCE_MAX_GLYPHS + 10);
    const n = normalizeData({ sentenceOfChoice: ` ${long} `, dictatedSentence: long, writingSentences: [long, '   ', ' 短い。 ', 42 as never] });
    expect(n.sentenceOfChoice).toBe('あ'.repeat(SENTENCE_MAX_GLYPHS));
    expect(n.dictatedSentence).toBe('あ'.repeat(SENTENCE_MAX_GLYPHS));
    expect(n.writingSentences).toEqual([]); // a non-string entry invalidates the list, as before
    const w = normalizeData({ writingSentences: [long, '   ', ' 短い。 '] }).writingSentences;
    expect(w).toEqual(['あ'.repeat(SENTENCE_MAX_GLYPHS), '短い。']);
    expect(normalizeData({ sentenceOfChoice: '   ', dictatedSentence: '' }).sentenceOfChoice).toBeUndefined();
    expect(normalizeData({ dictatedSentence: '  ' }).dictatedSentence).toBeUndefined();
    expect(validateData(n)).toEqual([]);
  });
});
