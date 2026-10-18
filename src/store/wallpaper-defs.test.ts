import type { CardKey, ContentItem } from '../content/types';
import { FIXTURE, FIXTURE_IDS, V } from '../content/fixtures';
import { WALLPAPER_IDS, type WallpaperId } from '../shared/catalog';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple, LogEntry, SaveMeta } from '../shared/store-types';
import { KANA_SETS, type CardReader, type TriggerEvent } from './badge-defs';
import { S } from './defs-strings';
import { resetStoreForTests } from './store';
import { DEFAULT_TEST_NOW, card, makeTestStore, testSave, type DeepPartial } from './testing';
import {
  CHAYA_LANTERNS_HOURS,
  WALLPAPER_BY_ID,
  WALLPAPER_DEFS,
  WALLPAPER_DEFS_COMPLETE,
  buildData,
  darumaCopy,
  isUnlocked,
  reachedStation,
  revealQuadrant,
} from './wallpaper-defs';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function reader(cards: Record<string, CardTuple>): CardReader {
  const map = new Map<string, CardTuple>(Object.entries(cards));
  return {
    get: (k) => map.get(k),
    forEach: (fn) => {
      for (const [k, t] of map) fn(k as CardKey, t);
    },
  };
}

function stable(s: number, reps = 5): CardTuple {
  return card({ s, state: 2, reps, due: TODAY + 1, last: TODAY });
}

function recCards(ids: readonly string[], s: number, upTo = ids.length): Record<string, CardTuple> {
  const out: Record<string, CardTuple> = {};
  ids.slice(0, upTo).forEach((id) => {
    out[`${id}#rec`] = stable(s);
  });
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

interface Case {
  save?: DeepPartial<SaveMeta>;
  cards?: Record<string, CardTuple>;
  ev?: TriggerEvent;
}

const CASES: Record<WallpaperId, { yes: Case; no: Case }> = {
  'torii-dawn': { yes: { cards: recCards(KANA_SETS.hiraganaAll, 7) }, no: { cards: recCards(KANA_SETS.hiraganaAll, 7, 103) } },
  'kana-grid': { yes: { save: { progress: { stationsCleared: [1, 2, 3] } } }, no: { save: { progress: { stationsCleared: [1, 2] } } } },
  'neon-alley': { yes: { save: { stats: { vocabBrown: 100 } } }, no: { save: { stats: { vocabBrown: 99 } } } },
  'sakura-storm': { yes: { save: { streak: { totalDays: 30 } } }, no: { save: { streak: { totalDays: 29, current: 29, longest: 29 } } } },
  'great-wave': { yes: { save: { stats: { reviews: 1000 } } }, no: { save: { stats: { reviews: 999 } } } },
  'kanji-stars': { yes: { save: { stats: { kanjiBrown: 100 } } }, no: { save: { stats: { kanjiBrown: 99 } } } },
  'fifty-three': { yes: { save: { progress: { station: 10 } } }, no: { save: { progress: { station: 9, stationsCleared: range(1, 8) } } } },
  'lantern-river': { yes: { save: { streak: { totalDays: 100 } } }, no: { save: { streak: { totalDays: 99, longest: 150 } } } },
  'sumi-dragon': { yes: { save: { streak: { totalDays: 60 } } }, no: { save: { streak: { totalDays: 59, longest: 90 } } } },
  okaeri: { yes: { save: { streak: { emberRestores: 1 } } }, no: { save: { streak: { emberRestores: 0, repairs: 0 }, stats: { comebacks: 0 } } } },
  'vs-wall': { yes: { save: { progress: { station: 24, stationsCleared: range(1, 24) } } }, no: { save: { progress: { station: 24, stationsCleared: range(1, 23) } } } },
  'wall-broken': { yes: { save: { progress: { shinsaPassed: ['brown'] } } }, no: { save: { progress: { shinsaPassed: ['purple'] } } } },
  tanabata: { yes: { save: { streak: { totalDays: 365 } } }, no: { save: { streak: { totalDays: 364 } } } },
  'hanko-garden': {
    yes: { save: { collections: { badges: Object.fromEntries(['first-step', 'gojuon', 'katakana', 'voiced', 'rain-candy', 'three-day', 'seven', 'thirty', 'hundred', 'year', 'rise-eight', 'ember', 'samurai-rest', 'thousand-cuts', 'ten-chain', 'unscathed', 'ippon', 'gatekeepers-respect', 'perfect-gate', 'halfway', 'bookworm', 'voice', 'zen', 'backup', 'field'].map((id) => [id, TODAY])) } } },
    no: { save: { collections: { badges: { 'first-step': TODAY } } } },
  },
  'fuji-ridge': { yes: { save: { progress: { shinsaPassed: ['yellow', 'orange', 'green'] } } }, no: { save: { progress: { shinsaPassed: ['yellow', 'orange'] } } } },
  'koi-dragon': { yes: { save: { progress: { shinsaPassed: ['purple'] } } }, no: { save: { progress: { shinsaPassed: ['blue'] } } } },
  'shoji-light': { yes: { save: { stats: { grammarBrown: 100 } } }, no: { save: { stats: { grammarBrown: 99 } } } },
  'insert-coin': {
    yes: { ev: { name: 'arcade:done', payload: { mode: 'rapid', correct: 50, misses: 3, ms: 60_000, recheck: [] } } },
    no: { ev: { name: 'arcade:done', payload: { mode: 'rapid', correct: 49, misses: 0, ms: 60_000, recheck: [] } }, save: { stats: { rapidBest: 49 } } },
  },
  daruma: { yes: { save: { progress: { shinsaPassed: ['blue'] } } }, no: { save: { progress: { shinsaPassed: ['green'] } } } },
  'vending-night': { yes: { save: { stats: { katakanaBrown: 300 } } }, no: { save: { stats: { katakanaBrown: 299 } } } },
  onsen: { yes: { save: { streak: { restDaysTaken: 10 } } }, no: { save: { streak: { restDaysTaken: 9 } } } },
  waveform: { yes: { save: { collections: { badges: { 'golden-ear': TODAY } } } }, no: { save: { stats: { dictation95at1x: 99 } } } },
  'golden-screen': { yes: { save: { profile: { dan: 2 } } }, no: { save: { profile: { dan: 1 } } } },
  festival: { yes: { save: { profile: { dan: 3 } } }, no: { save: { profile: { dan: 2 } } } },
  'station-sign': { yes: { save: { progress: { stationsCleared: [4] } } }, no: { save: { progress: { stationsCleared: [], station: 9 } } } },
  'kyoto-arrival': { yes: { save: { progress: { shinsaPassed: ['black'] } } }, no: { save: { progress: { shinsaPassed: ['brown'] }, profile: { dan: 0 } } } },
  'road-continues': { yes: { save: { profile: { dan: 10 } } }, no: { save: { profile: { dan: 9 } } } },
  'end-card': { yes: { save: { stats: { sessions: 100 } } }, no: { save: { stats: { sessions: 99 } } } },
  // design 08 §11: 100 h of listen rows, whichever source; read / watch hours do not count
  'chaya-lanterns': { yes: { save: { ledger: { entries: [[100, 60 * 60, 0, 0], [101, 40 * 60, 0, 1]] } } }, no: { save: { ledger: { entries: [[100, 99 * 60, 0, 1], [100, 600, 1, 1], [100, 600, 2, 1]] } } } },
};

const BANNED = [/you lost your streak/i, /don'?t let .* down/i, /only \d+ hours? left/i, /hurry/i, /last chance/i, /don'?t break/i, /streak at risk/i, /!/];

describe('WALLPAPER_DEFS', () => {
  it('covers WALLPAPER_IDS exactly, in catalog order', () => {
    expect(WALLPAPER_DEFS.map((d) => d.id)).toEqual([...WALLPAPER_IDS]);
    expect(WALLPAPER_DEFS).toHaveLength(29);
    expect(WALLPAPER_DEFS_COMPLETE).toBe(true);
  });

  it('design 08 §11 茶屋の灯: living, indexed on ledger rows and both listening events, progress 0.5 at 50 listen hours, quadrants at 25 / 50 / 75 / 100 h', () => {
    const d = WALLPAPER_BY_ID['chaya-lanterns'];
    expect(d.living).toBe(true);
    expect(d.nameJa).toBe('茶屋の灯');
    expect(d.events).toEqual(['ledger:entry', 'listen:played', 'listening:set']);
    expect(CHAYA_LANTERNS_HOURS).toBe(100);
    const at = (hours: number) => testSave({ save: { ledger: { entries: [[100, hours * 60, 0, 0]] } } });
    expect(d.progress?.(at(50))).toBe(0.5);
    expect(d.progress?.(at(0))).toBe(0);
    expect(revealQuadrant(d, at(24.9))).toBe(0);
    expect(revealQuadrant(d, at(25))).toBe(1);
    expect(revealQuadrant(d, at(50))).toBe(2);
    expect(revealQuadrant(d, at(75))).toBe(3);
    expect(revealQuadrant(d, at(100))).toBe(4);
    expect(d.when(at(99.9))).toBe(false);
    expect(d.when(at(100))).toBe(true);
    // dojo rows (source 0) and outside rows (source 1) count alike; read / watch rows do not
    expect(d.progress?.(testSave({ save: { ledger: { entries: [[100, 25 * 60, 0, 0], [100, 25 * 60, 0, 1], [100, 500 * 60, 1, 1]] } } }))).toBe(0.5);
  });

  it('every def has names, index events and clean copy', () => {
    for (const d of WALLPAPER_DEFS) {
      expect(d.nameEn.length).toBeGreaterThan(0);
      expect(d.nameJa.length).toBeGreaterThan(0);
      expect(d.events.length).toBeGreaterThan(0);
      expect(d.describe).toBe(S.wallpapers[d.id].describe);
      for (const re of BANNED) expect(d.describe).not.toMatch(re);
    }
    expect(WALLPAPER_BY_ID['fifty-three'].living).toBe(true);
    expect(WALLPAPER_BY_ID['torii-dawn'].living).toBe(false);
    expect(WALLPAPER_BY_ID.okaeri.living).toBe(true);
  });

  it('a fresh save unlocks nothing and reveals nothing', () => {
    const m = testSave();
    for (const d of WALLPAPER_DEFS) {
      expect(d.when(m, undefined, reader({}))).toBe(false);
      expect(revealQuadrant(d, m, reader({}))).toBe(0);
    }
  });

  describe.each(WALLPAPER_IDS)('%s', (id) => {
    const d = WALLPAPER_BY_ID[id];
    const c = CASES[id];
    it('unlocks from a constructed save', () => {
      expect(d.when(testSave({ save: c.yes.save }), c.yes.ev, reader(c.yes.cards ?? {}))).toBe(true);
    });
    it('stays locked on a near miss', () => {
      expect(d.when(testSave({ save: c.no.save }), c.no.ev, reader(c.no.cards ?? {}))).toBe(false);
    });
  });

  it('progress is monotone in its counter and hits 1 exactly at the condition', () => {
    const counters: [WallpaperId, (n: number) => DeepPartial<SaveMeta>, number][] = [
      ['neon-alley', (n) => ({ stats: { vocabBrown: n } }), 100],
      ['great-wave', (n) => ({ stats: { reviews: n } }), 1000],
      ['kanji-stars', (n) => ({ stats: { kanjiBrown: n } }), 100],
      ['sakura-storm', (n) => ({ streak: { totalDays: n } }), 30],
      ['lantern-river', (n) => ({ streak: { totalDays: n } }), 100],
      ['sumi-dragon', (n) => ({ streak: { totalDays: n } }), 60],
      ['tanabata', (n) => ({ streak: { totalDays: n } }), 365],
      ['shoji-light', (n) => ({ stats: { grammarBrown: n } }), 100],
      ['insert-coin', (n) => ({ stats: { rapidBest: n } }), 50],
      ['vending-night', (n) => ({ stats: { katakanaBrown: n } }), 300],
      ['onsen', (n) => ({ streak: { restDaysTaken: n } }), 10],
      ['waveform', (n) => ({ stats: { dictation95at1x: n } }), 100],
      ['end-card', (n) => ({ stats: { sessions: n } }), 100],
      ['chaya-lanterns', (n) => ({ ledger: { entries: [[100, n * 60, 0, 1]] } }), 100],
    ];
    for (const [id, patch, target] of counters) {
      const d = WALLPAPER_BY_ID[id];
      expect(d.progress).toBeDefined();
      let prev = -1;
      for (let i = 0; i <= 8; i++) {
        const n = Math.round((target * i) / 8);
        const p = d.progress?.(testSave({ save: patch(n) })) ?? 0;
        expect(p).toBeGreaterThanOrEqual(prev);
        expect(p).toBeLessThanOrEqual(1);
        prev = p;
      }
      expect(d.progress?.(testSave({ save: patch(target) }))).toBe(1);
      expect(d.progress?.(testSave({ save: patch(target * 3) }))).toBe(1);
      expect(d.progress?.(testSave({ save: patch(Math.floor(target / 2)) }))).toBeLessThan(1);
    }
  });

  it('reveal quadrants step at 25/50/75/100 %', () => {
    const d = WALLPAPER_BY_ID['great-wave'];
    const at = (reviews: number) => revealQuadrant(d, testSave({ save: { stats: { reviews } } }));
    expect(at(0)).toBe(0);
    expect(at(249)).toBe(0);
    expect(at(250)).toBe(1);
    expect(at(500)).toBe(2);
    expect(at(749)).toBe(2);
    expect(at(750)).toBe(3);
    expect(at(1000)).toBe(4);
    // Pieces without a counter never reveal early.
    expect(revealQuadrant(WALLPAPER_BY_ID.daruma, testSave())).toBe(0);
    // torii-dawn reveals by hiragana at Green.
    expect(revealQuadrant(WALLPAPER_BY_ID['torii-dawn'], testSave(), reader(recCards(KANA_SETS.hiraganaAll, 10, 52)))).toBe(2);
  });

  it('daruma upgrades in place: left eye at Blue, both at Shodan', () => {
    const up = WALLPAPER_BY_ID.daruma.upgrade as (m: SaveMeta) => number;
    expect(up(testSave())).toBe(0);
    expect(up(testSave({ save: { progress: { shinsaPassed: ['blue'] } } }))).toBe(1);
    expect(up(testSave({ save: { progress: { shinsaPassed: ['blue', 'black'] } } }))).toBe(2);
    expect(up(testSave({ save: { profile: { dan: 1 } } }))).toBe(2);
    expect(darumaCopy(testSave())).toBe(S.darumaNoEyes);
    expect(darumaCopy(testSave({ save: { progress: { shinsaPassed: ['blue'] } } }))).toBe(S.darumaLeftEye);
    expect(darumaCopy(testSave({ save: { profile: { dan: 1 } } }))).toBe(S.darumaBothEyes);
  });

  it('isUnlocked / reachedStation', () => {
    expect(isUnlocked(undefined)).toBe(false);
    expect(isUnlocked({ at: 0, reforges: 0, revealed: 2 })).toBe(false);
    expect(isUnlocked({ at: TODAY, reforges: 0, revealed: 4 })).toBe(true);
    expect(reachedStation(testSave({ save: { progress: { station: 10 } } }), 10)).toBe(true);
    expect(reachedStation(testSave({ save: { progress: { station: 9, stationsCleared: [9] } } }), 10)).toBe(true);
    expect(reachedStation(testSave({ save: { progress: { station: 9 } } }), 10)).toBe(false);
  });
});

describe('buildData', () => {
  afterEach(() => {
    resetStoreForTests();
    bus.reset();
  });

  const get = (id: string): ContentItem | undefined => FIXTURE.items[id];

  it('assembles the personalization record from a test store with fixture content', async () => {
    const kanjiId = FIXTURE_IDS.kanji[0] as string;
    const grammarId = FIXTURE_IDS.grammar[0] as string;
    const cards: Record<CardKey, CardTuple> = {
      // Brown vocab (私) with 12 reviews, Brown vocab (飲む) with 20 reviews, Green vocab (not mastered)
      [`${V.私}#rec`]: stable(40, 8),
      [`${V.私}#prod`]: stable(9, 4),
      [`${V.飲む}#rec`]: stable(60, 12),
      [`${V.飲む}#prod`]: stable(12, 8),
      'v-n5-0042#rec': stable(10, 3),
      // Brown kana (fixture あ) and a Brown kana the fixture does not hold (か → romaji fallback)
      'k-h-a#rec': stable(45),
      'k-h-a#prod': stable(8),
      'k-h-ka#rec': stable(45),
      'k-h-ka#prod': stable(8),
      // Brown katakana カ: not in the fixture → IME romaji fallback
      'k-k-ka#rec': stable(45),
      'k-k-ka#prod': stable(8),
      // Brown kanji, Brown grammar, Brown N3 grammar (Plateau Arc)
      [`${kanjiId}#comp`]: stable(40),
      [`${kanjiId}#read`]: stable(8),
      [`${grammarId}#cloze`]: stable(31),
      [`${grammarId}#prod`]: stable(7),
      'g-n3-005#cloze': stable(31),
      'g-n3-005#prod': stable(7),
    };
    const daily: Record<number, { reps: number; ok: number; minutes: number; xp: number; input: number }> = {};
    daily[TODAY] = { reps: 10, ok: 9, minutes: 12, xp: 40, input: 0 };
    daily[TODAY - 89] = { reps: 5, ok: 5, minutes: 7, xp: 20, input: 0 };
    daily[TODAY - 90] = { reps: 5, ok: 5, minutes: 99, xp: 20, input: 0 };
    const s = await makeTestStore({
      cards,
      save: {
        profile: { nameKana: 'ハナ', chosenKanji: '続', belt: 'yellow', level: 7, xp: 4000 },
        streak: { current: 3, longest: 21, totalDays: 40, freezes: 2, restDaysTaken: 4 },
        progress: { station: 5 },
        stats: { rapidBest: 33 },
        ledger: { entries: [[TODAY, 90, 0, 1], [TODAY, 30, 1, 1]] },
        collections: {
          badges: { seven: TODAY - 1, 'first-step': TODAY - 9, 'three-day': TODAY - 1 },
          stamps: { 4: { at: TODAY - 2, perfect: true, assisted: false }, 1: { at: TODAY - 20, perfect: false, assisted: false } },
        },
        daily,
      },
    });
    const gojuonIdx = 3; // DRILL_IDS.indexOf('gojuon-fighter')
    const log: LogEntry[] = [
      [DEFAULT_TEST_NOW - 1000, 'k-h-a#rec', 3, 900, gojuonIdx, 0],
      [DEFAULT_TEST_NOW - 2000, 'k-h-a#rec', 3, 1100, gojuonIdx, 0],
      [DEFAULT_TEST_NOW - 3000, 'k-h-a#rec', 3, 700, gojuonIdx, 0],
      [DEFAULT_TEST_NOW - 4000, 'k-h-ka#rec', 3, 1500, gojuonIdx, 0],
      [DEFAULT_TEST_NOW - 5000, 'k-h-ka#rec', 3, 500, 0, 0], // kana-flash, not Gojūon Fighter
      [DEFAULT_TEST_NOW - 6000, `${V.私}#rec`, 3, 1200, 5, 0],
      [DEFAULT_TEST_NOW - 40 * 86_400_000, `${V.飲む}#rec`, 3, 1200, 5, 0], // introduced last month
    ];
    const d = buildData(s, get, { log, sentenceOfChoice: '私はハナです。' });

    expect(d.nameKana).toBe('ハナ');
    expect(d.chosenKanji).toBe('続');
    expect(d.belt).toBe('yellow');
    expect(d.streak).toBe(21);
    expect(d.totalDays).toBe(40);
    expect(d.level).toBe(7);
    expect(d.xp).toBe(4000);
    expect(d.mastered.kana).toEqual(['あ', 'か', 'カ']);
    expect(d.mastered.kanji).toEqual([kanjiId.slice(2)]);
    expect(d.mastered.vocab).toEqual([
      { word: '飲む', kana: 'のむ', reviews: 20 },
      { word: '私', kana: 'わたし', reviews: 12 },
    ]);
    expect(d.grammarBrown).toEqual([(FIXTURE.items[grammarId] as { pattern: string }).pattern, 'g-n3-005']);
    expect(d.arcGrammar).toEqual(['g-n3-005']);
    expect(d.katakanaBrown).toEqual([]);
    expect(d.badgesInOrder).toEqual(['first-step', 'three-day', 'seven']);
    expect(d.stamps).toEqual([1, 4]);
    expect(d.station).toBe(5);
    expect(d.minutes90).toHaveLength(90);
    expect(d.minutes90[0]).toBe(7);
    expect(d.minutes90[89]).toBe(12);
    expect(d.minutes90.reduce((a, b) => a + b, 0)).toBe(19);
    expect(d.gojuonMs).toEqual({ あ: 900, か: 1500 });
    expect(d.rapidBest).toBe(33);
    expect(d.freezes).toBe(2);
    expect(d.restDays).toBe(4);
    expect(d.wordsThisMonth).toBe(1);
    expect(d.writingSentences).toEqual([]);
    expect(d.sentenceOfChoice).toBe('私はハナです。');
    expect(d.dictatedSentence).toBeUndefined();
    expect(d.date).toBe(TODAY);
    // design 08 §11: listen rows only (the 30-minute read row is not counted)
    expect(d.listenHours).toBe(1.5);
    // Deterministic: the same store yields an identical record.
    expect(buildData(s, get, { log, sentenceOfChoice: '私はハナです。' })).toEqual(d);
  });

  it('katakana words are listed when their reading is katakana; chunks count through prod', async () => {
    const coffee: ContentItem = { ...(FIXTURE.items[V.私] as object), id: 'v-n5-0777', word: 'コーヒー', kana: 'コーヒー' } as ContentItem;
    const resolve = (id: string): ContentItem | undefined => (id === 'v-n5-0777' ? coffee : FIXTURE.items[id]);
    const s = await makeTestStore({
      cards: {
        'v-n5-0777#rec': stable(40),
        'v-n5-0777#prod': stable(10),
        // chunk: prod only
        [`${V.おはよう}#prod`]: stable(40),
      },
    });
    const d = buildData(s, resolve, { log: [] });
    expect(d.katakanaBrown).toEqual(['コーヒー']);
    expect(d.mastered.vocab.map((v) => v.word)).toContain('コーヒー');
    expect(d.mastered.vocab.map((v) => v.word)).toContain((FIXTURE.items[V.おはよう] as { word: string }).word);
    expect(d.wordsThisMonth).toBe(0);
    expect(d.gojuonMs).toEqual({});
  });

  it('a fresh store yields an empty but complete record', async () => {
    const s = await makeTestStore();
    const d = buildData(s, () => undefined);
    expect(d.mastered).toEqual({ kana: [], kanji: [], vocab: [] });
    expect(d.badgesInOrder).toEqual([]);
    expect(d.stamps).toEqual([]);
    expect(d.minutes90.every((x) => x === 0)).toBe(true);
    expect(d.streak).toBe(0);
    expect(d.chosenKanji).toBeUndefined();
    expect(d.listenHours).toBe(0);
  });
});
