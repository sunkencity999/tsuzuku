import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GrammarItem, KanaItem, KanjiItem, SentenceExample, StoryLine, VocabItem } from '../content/types';
import { mulberry32 } from '../shared/hash';
import { moraSplit, normalizeAnswer, normalizeEn, toHiragana } from '../shared/jp';
import {
  FALLBACK_GLOSSES,
  PARTICLES,
  clozeTiles,
  fillTiers,
  kanaDistance,
  kanaGrid,
  kanjiLookalikes,
  meaningChoices,
  meaningDistractors,
  minimalPairPartner,
  particleOptions,
  scrambleTiles,
  synthesizeMinimalPair,
} from './distractors';

function vocab(id: string, word: string, kana: string, meaning: string, pos: VocabItem['pos'] = 'n', extra: Partial<VocabItem> = {}): VocabItem {
  return { id, word, kana, meanings: [meaning], pos, jlpt: 5, tags: [], examples: [], ...extra };
}
function kana(id: string, ch: string, script: KanaItem['script'], row: KanaItem['row'], type: KanaItem['type'] = 'basic', extra: Partial<KanaItem> = {}): KanaItem {
  return { id, kana: ch, romaji: id.slice(4), script, type, row, mnemonic: '', exampleWord: { word: ch, kana: ch, en: '' }, ...extra };
}
function kanji(char: string, meaning: string, components: string[], strokes = 5, extra: Partial<KanjiItem> = {}): KanjiItem {
  return { id: `j-${char}`, char, meanings: [meaning], on: [], kun: [], strokes, jlpt: 5, components, mnemonic: '', examples: [], ...extra };
}
function grammar(id: string, pattern: string, hints: string[], extra: Partial<GrammarItem> = {}): GrammarItem {
  return { id, pattern, meaning: pattern, formation: [], explanation: '', jlpt: 5, register: 'neutral', examples: [], clozeHints: hints, mistakes: [], related: [], tags: [], ...extra };
}

const POOL: VocabItem[] = [
  vocab('v-n5-0001', '食べる', 'たべる', 'to eat', 'v1', { station: 4, confusables: ['v-n5-0002'] }),
  vocab('v-n5-0002', '飲む', 'のむ', 'to drink', 'v5', { station: 4 }),
  vocab('v-n5-0003', '見る', 'みる', 'to see', 'v1', { station: 4 }),
  vocab('v-n5-0004', '寝る', 'ねる', 'to sleep', 'v1', { station: 4 }),
  vocab('v-n5-0005', '起きる', 'おきる', 'to wake up', 'v1', { station: 5 }),
  vocab('v-n5-0006', '水', 'みず', 'water', 'n', { station: 4 }),
  vocab('v-n5-0007', '火', 'ひ', 'fire', 'n', { station: 4 }),
  vocab('v-n5-0008', '餌', 'えさ', 'eat', 'n', { station: 9 }),
  vocab('v-n5-0009', '食べ物', 'たべもの', 'food', 'n', { station: 4 }),
];

describe('fillTiers', () => {
  it('drains tiers in order, skipping taken keys and duplicates', () => {
    const out = fillTiers(mulberry32(1), [['a', 'b'], ['b', 'c', 'd']], 3, (s) => s, ['a']);
    expect(out).toHaveLength(3);
    expect(out).toEqual(expect.arrayContaining(['b', 'c', 'd']));
    expect(fillTiers(mulberry32(1), [['a']], 3, (s) => s, [])).toEqual(['a']);
  });
});

describe('meaningChoices', () => {
  it('returns 4 choices containing the answer once, never duplicates', () => {
    for (let seed = 0; seed < 30; seed++) {
      const c = meaningChoices(POOL[0]!, POOL, mulberry32(seed));
      expect(c).toHaveLength(4);
      expect(c.filter((x) => normalizeEn(x) === normalizeEn('to eat'))).toHaveLength(1);
      expect(new Set(c.map(normalizeEn)).size).toBe(4);
      expect(c).not.toContain('eat'); // normalizes to the answer
    }
  });
  it('prefers the confusable, then same POS + station', () => {
    for (let seed = 0; seed < 10; seed++) {
      const d = meaningDistractors(POOL[0]!, POOL, mulberry32(seed));
      expect(d).toContain('to drink');
      const rest = d.filter((x) => x !== 'to drink');
      expect(rest.every((x) => ['to see', 'to sleep'].includes(x))).toBe(true);
    }
  });
  it('uses a kana minimal-pair neighbour when there is no confusable', () => {
    const target = vocab('v-n5-0100', '来て', 'きて', 'come', 'expr');
    const pool = [target, vocab('v-n5-0101', '切手', 'きって', 'stamp'), vocab('v-n5-0102', '机', 'つくえ', 'desk'), vocab('v-n5-0103', '椅子', 'いす', 'chair'), vocab('v-n5-0104', '犬', 'いぬ', 'dog')];
    for (let seed = 0; seed < 10; seed++) expect(meaningDistractors(target, pool, mulberry32(seed))).toContain('stamp');
  });
  it('is deterministic with a seeded rng', () => {
    expect(meaningChoices(POOL[0]!, POOL, mulberry32(42))).toEqual(meaningChoices(POOL[0]!, POOL, mulberry32(42)));
    const a = meaningChoices(POOL[0]!, POOL, mulberry32(1));
    const b = meaningChoices(POOL[0]!, POOL, mulberry32(2));
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    expect(a).toContain('to eat');
    expect(b).toContain('to eat');
  });
  it('never offers a secondary meaning of the target, nor a word whose secondary meaning is the answer', () => {
    // 風情 [taste | charm | air]: same-POS words whose primary gloss is one of its other meanings.
    const target = vocab('v-n1-0024', '風情', 'ふぜい', 'taste', 'n', { meanings: ['taste', 'charm', 'air'], jlpt: 1, station: 47 });
    const pool = [
      target,
      vocab('v-n1-0100', '魅力', 'みりょく', 'charm', 'n', { jlpt: 1, station: 47 }),
      vocab('v-n1-0101', '空気', 'くうき', 'air', 'n', { jlpt: 1, station: 47 }),
      vocab('v-n1-0102', '強盗', 'ごうとう', 'robbery', 'n', { jlpt: 1, station: 47 }),
      vocab('v-n1-0103', '配慮', 'はいりょ', 'consideration', 'n', { jlpt: 1, station: 47 }),
      vocab('v-n1-0104', '味', 'あじ', 'flavour', 'n', { meanings: ['flavour', 'taste'], jlpt: 1, station: 47 }),
      vocab('v-n1-0105', '時間', 'じかん', 'time', 'n', { jlpt: 1, station: 47 }),
    ];
    for (let seed = 0; seed < 40; seed++) {
      const d = meaningDistractors(target, pool, mulberry32(seed));
      expect(d).toHaveLength(3);
      for (const x of d) expect(['charm', 'air', 'taste', 'flavour']).not.toContain(x);
      const c = meaningChoices(target, pool, mulberry32(seed));
      expect(c.filter((x) => ['taste', 'charm', 'air', 'flavour'].includes(x))).toEqual(['taste']);
    }
    // the unit shape from the report: target [instant, moment], a same-POS word glossed 'moment'
    const t2 = vocab('v-n3-0001', '瞬間', 'しゅんかん', 'instant', 'n', { meanings: ['instant', 'moment'] });
    const p2 = [t2, vocab('v-n3-0002', '一瞬', 'いっしゅん', 'moment', 'n'), vocab('v-n3-0003', '山', 'やま', 'mountain', 'n')];
    for (let seed = 0; seed < 20; seed++) expect(meaningDistractors(t2, p2, mulberry32(seed))).not.toContain('moment');
  });
  it('falls back when the pool is small', () => {
    const c = meaningChoices(POOL[0]!, [POOL[0]!, POOL[1]!], mulberry32(5));
    expect(c).toHaveLength(4);
    expect(c).toContain('to eat');
    expect(c).toContain('to drink');
    expect(c.filter((x) => FALLBACK_GLOSSES.includes(x))).toHaveLength(2);
    expect(new Set(c).size).toBe(4);
    const alone = meaningChoices(POOL[0]!, [], mulberry32(5));
    expect(alone).toHaveLength(4);
    expect(new Set(alone).size).toBe(4);
  });
});

describe('kanaGrid', () => {
  const ALL: KanaItem[] = [
    kana('k-h-ne', 'ね', 'hiragana', 'n', 'basic', { lookalikes: ['k-h-re', 'k-h-wa'] }),
    kana('k-h-re', 'れ', 'hiragana', 'r'),
    kana('k-h-wa', 'わ', 'hiragana', 'w'),
    kana('k-h-na', 'な', 'hiragana', 'n'),
    kana('k-h-nu', 'ぬ', 'hiragana', 'n'),
    kana('k-h-me', 'め', 'hiragana', 'm'),
    kana('k-h-a', 'あ', 'hiragana', 'a'),
    kana('k-h-o', 'お', 'hiragana', 'a'),
    kana('k-h-ki', 'き', 'hiragana', 'k'),
    kana('k-h-sa', 'さ', 'hiragana', 's'),
    kana('k-h-kya', 'きゃ', 'hiragana', 'k', 'yoon'),
    kana('k-k-shi', 'シ', 'katakana', 's', 'basic', { lookalikes: ['k-k-tsu'] }),
    kana('k-k-tsu', 'ツ', 'katakana', 't'),
    kana('k-k-so', 'ソ', 'katakana', 's'),
    kana('k-k-n', 'ン', 'katakana', 'nn'),
  ];
  it('always 9 distinct cells containing the target, lookalikes first', () => {
    for (let seed = 0; seed < 30; seed++) {
      const g = kanaGrid(ALL[0]!, ALL, mulberry32(seed));
      expect(g).toHaveLength(9);
      expect(new Set(g).size).toBe(9);
      expect(g).toContain('ね');
      expect(g).toContain('れ');
      expect(g).toContain('わ');
      // same script preferred: with 10 other hiragana available no katakana appears
      expect(g.some((c) => /[ァ-ヺ]/.test(c))).toBe(false);
    }
  });
  it('katakana target stays in katakana and pads from the gojūon when the pool is tiny', () => {
    const g = kanaGrid(ALL[11]!, ALL.slice(11), mulberry32(3));
    expect(g).toHaveLength(9);
    expect(new Set(g).size).toBe(9);
    expect(g).toContain('シ');
    expect(g).toContain('ツ');
    expect(g.every((c) => /^[ァ-ヺ]+$/.test(c))).toBe(true);
    const lone = kanaGrid(ALL[0]!, [], mulberry32(3));
    expect(lone).toHaveLength(9);
    expect(lone).toContain('ね');
    expect(new Set(lone).size).toBe(9);
  });
  it('deterministic', () => {
    expect(kanaGrid(ALL[0]!, ALL, mulberry32(8))).toEqual(kanaGrid(ALL[0]!, ALL, mulberry32(8)));
  });
  it('never seats a homophone of the target (を/お, づ/ず, ぢ/じ, ヲ/オ), from the pool or the gojūon padding', () => {
    // Real-corpus shape: を and お both carry romaji "o"; づ/ず and ぢ/じ differ only in spelling.
    const WO = kana('k-h-o', 'を', 'hiragana', 'w');
    const O = kana('k-h-o', 'お', 'hiragana', 'a', 'basic', { lookalikes: ['k-h-a'] });
    const DU = kana('k-h-zu', 'づ', 'hiragana', 'd', 'dakuten');
    const ZU = kana('k-h-zu', 'ず', 'hiragana', 'z', 'dakuten');
    const DI = kana('k-h-ji', 'ぢ', 'hiragana', 'd', 'dakuten');
    const JI = kana('k-h-ji', 'じ', 'hiragana', 'z', 'dakuten');
    const KWO = kana('k-k-o', 'ヲ', 'katakana', 'w', 'basic', { lookalikes: ['k-k-o'] });
    const KO = kana('k-k-o', 'オ', 'katakana', 'a');
    // Distinct ids as in the corpus (romaji stays the same).
    WO.id = 'k-h-wo'; DU.id = 'k-h-du'; DI.id = 'k-h-di'; KWO.id = 'k-k-wo';
    const pool = [...ALL.filter((k) => k.kana !== 'お'), WO, O, DU, ZU, DI, JI, KWO, KO];
    const cases: [KanaItem, string][] = [[WO, 'お'], [O, 'を'], [DU, 'ず'], [ZU, 'づ'], [DI, 'じ'], [JI, 'ぢ'], [KWO, 'オ'], [KO, 'ヲ']];
    for (const [target, twin] of cases) {
      for (let seed = 0; seed < 50; seed++) {
        const g = kanaGrid(target, pool, mulberry32(seed));
        expect(g).toHaveLength(9);
        expect(new Set(g).size).toBe(9);
        expect(g).toContain(target.kana);
        expect(g).not.toContain(twin);
        // A tiny pool pads from the gojūon, which also holds the twin.
        const padded = kanaGrid(target, [target], mulberry32(seed));
        expect(padded).toHaveLength(9);
        expect(padded).toContain(target.kana);
        expect(padded).not.toContain(twin);
      }
    }
  });
});

describe('kanjiLookalikes', () => {
  const POOL_K: KanjiItem[] = [
    kanji('未', 'not yet', ['tree', 'one'], 5, { lookalikes: ['j-末'] }),
    kanji('末', 'end', ['tree', 'one'], 5),
    kanji('木', 'tree', ['tree'], 4),
    kanji('本', 'book', ['tree', 'one'], 5),
    kanji('日', 'sun', ['sun'], 4),
    kanji('月', 'moon', ['moon'], 4),
    kanji('人', 'person', ['person'], 2),
  ];
  it('2–4 distinct chars containing the target; declared look-alike first; shared component next', () => {
    for (let seed = 0; seed < 20; seed++) {
      const l = kanjiLookalikes(POOL_K[0]!, POOL_K, mulberry32(seed));
      expect(l).toHaveLength(4);
      expect(new Set(l).size).toBe(4);
      expect(l).toContain('未');
      expect(l).toContain('末');
      expect(l.filter((c) => ['木', '本'].includes(c))).toHaveLength(2);
    }
  });
  it('resolves declared look-alikes from the id even without a pool', () => {
    const l = kanjiLookalikes(POOL_K[0]!, [], mulberry32(1));
    expect(l).toHaveLength(2);
    expect(l).toEqual(expect.arrayContaining(['末', '未']));
  });
  it('honours n', () => {
    expect(kanjiLookalikes(POOL_K[0]!, POOL_K, mulberry32(1), 2)).toHaveLength(2);
  });
});

describe('clozeTiles', () => {
  const G: GrammarItem[] = [
    grammar('g-n5-001', '〜てください', ['てください'], { related: ['g-n5-002'] }),
    grammar('g-n5-002', '〜ないでください', ['ないでください']),
    grammar('g-n5-003', '〜ましょう', ['ましょう']),
    grammar('g-n5-004', '〜たい', ['たい', 'たいです']),
    grammar('g-n5-005', '〜から', ['から']),
  ];
  it('4 tiles containing the answer once, related hint first', () => {
    for (let seed = 0; seed < 20; seed++) {
      const t = clozeTiles(G[0]!, G, mulberry32(seed));
      expect(t).toHaveLength(4);
      expect(new Set(t.map(normalizeAnswer)).size).toBe(4);
      expect(t).toContain('てください');
      expect(t).toContain('ないでください');
    }
  });
  it('accepts an explicit answer and pads from fallbacks on an empty pool', () => {
    const t = clozeTiles(G[3]!, [], mulberry32(2), 'たいです');
    expect(t).toHaveLength(4);
    expect(t).toContain('たいです');
    expect(new Set(t.map(normalizeAnswer)).size).toBe(4);
  });
});

describe('particleOptions', () => {
  it('n options containing the answer, from the particle keys', () => {
    const o = particleOptions('を', mulberry32(1));
    expect(o).toHaveLength(4);
    expect(o).toContain('を');
    expect(new Set(o).size).toBe(4);
    for (const p of o) expect(PARTICLES).toContain(p);
  });
});

describe('scrambleTiles', () => {
  const line: StoryLine = {
    ja: '{私|わたし}は{水|みず}を{飲|の}みます。',
    kana: 'わたしはみずをのみます。',
    en: 'I drink water.',
    tokens: ['私', 'は', '水', 'を', '飲みます', '。'],
  };
  it('keeps every tile, leaves trailing punctuation in place, never returns the original order', () => {
    for (let seed = 0; seed < 30; seed++) {
      const t = scrambleTiles(line, line.tokens, mulberry32(seed));
      expect(t).toHaveLength(line.tokens.length);
      expect(t.slice().sort()).toEqual(line.tokens.slice().sort());
      expect(t[t.length - 1]).toBe('。');
      expect(t.join('')).not.toBe(line.tokens.join(''));
    }
  });
  it('falls back to line.tokens, then to the plain sentence', () => {
    expect(scrambleTiles(line, [], mulberry32(1)).slice().sort()).toEqual(line.tokens.slice().sort());
    const ex: SentenceExample = { ja: '{猫|ねこ}', kana: 'ねこ', en: 'cat' };
    expect(scrambleTiles(ex, [], mulberry32(1))).toEqual(['猫']);
    expect(scrambleTiles(ex, ['a', 'a'], mulberry32(1))).toEqual(['a', 'a']);
  });
  it('is deterministic', () => {
    expect(scrambleTiles(line, line.tokens, mulberry32(4))).toEqual(scrambleTiles(line, line.tokens, mulberry32(4)));
  });
});

describe('kana similarity helpers', () => {
  it('kanaDistance is mora-based and script-folded', () => {
    expect(kanaDistance('きて', 'きって')).toBe(1);
    expect(kanaDistance('キテ', 'きて')).toBe(0);
    expect(kanaDistance('きゃく', 'きやく')).toBe(2);
  });
  it('synthesizeMinimalPair always differs', () => {
    for (const k of ['きて', 'きって', 'か', 'おばさん', 'コーヒー', 'ん']) expect(synthesizeMinimalPair(k)).not.toBe(k);
    expect(synthesizeMinimalPair('きって')).toBe('きて');
    expect(synthesizeMinimalPair('きて')).toBe('きって');
  });
  it('synthesizeMinimalPair: っ is removed when present, else inserted before the first mora (index ≥ 1) that is not ー / ん — never before ー or ん, never last', () => {
    // byte-stable where the second mora already took the っ
    expect(synthesizeMinimalPair('はい')).toBe('はっい');
    expect(synthesizeMinimalPair('おばさん')).toBe('おっばさん');
    expect(synthesizeMinimalPair('キテ')).toBe('きって'); // hiragana out
    expect(synthesizeMinimalPair('いぬ')).toBe('いっぬ');
    expect(synthesizeMinimalPair('きゃく')).toBe('きゃっく');
    // ー / ん at index 1 are skipped (っー is kana the engine refuses; っん is not Japanese)
    expect(synthesizeMinimalPair('アーカイブ')).toBe('あーっかいぶ');
    expect(synthesizeMinimalPair('コーヒー')).toBe('こーっひー');
    expect(synthesizeMinimalPair('かんがみる')).toBe('かんっがみる');
    expect(synthesizeMinimalPair('ヴィンテージ')).toBe('ゔぃんってーじ');
    expect(synthesizeMinimalPair('せんせい')).toBe('せんっせい');
    // an existing っ is still removed, wherever it sits
    expect(synthesizeMinimalPair('ざっし')).toBe('ざし');
    expect(synthesizeMinimalPair('あっ')).toBe('あ');
  });
  it('synthesizeMinimalPair: a word with nothing a っ can precede gets a same-length near miss — consonant toggle, then ん ↔ ー; the residual drops one ー', () => {
    // consonant toggle on the first mora (voicing, handakuten → dakuten, ら / れ / ろ → だ / で / ど), じ / ず spellings
    expect(synthesizeMinimalPair('ほん')).toBe('ぼん');
    expect(synthesizeMinimalPair('かん')).toBe('がん');
    expect(synthesizeMinimalPair('ぜん')).toBe('せん');
    expect(synthesizeMinimalPair('パン')).toBe('ばん');
    expect(synthesizeMinimalPair('ペン')).toBe('べん');
    expect(synthesizeMinimalPair('ちゃん')).toBe('じゃん');
    expect(synthesizeMinimalPair('じゅん')).toBe('しゅん');
    expect(synthesizeMinimalPair('ローン')).toBe('どーん'); // never ろお (a 2-mora word for a 3-mora input) and never ろっーん
    expect(synthesizeMinimalPair('れん')).toBe('でん');
    // no consonant partner: the last special mora swaps ん ↔ ー (り / る have no stop they are heard as, so they land here too)
    expect(synthesizeMinimalPair('えん')).toBe('えー');
    expect(synthesizeMinimalPair('もん')).toBe('もー');
    expect(synthesizeMinimalPair('ファン')).toBe('ふぁー');
    expect(synthesizeMinimalPair('のー')).toBe('のん');
    expect(synthesizeMinimalPair('りん')).toBe('りー'); // not じん
    expect(synthesizeMinimalPair('るん')).toBe('るー'); // not ずん
    // a swap that would write ーー / んん falls back to dropping one ー: the ONE step that shortens (3 → 2 morae; no corpus word reaches it)
    expect(synthesizeMinimalPair('あーん')).toBe('あん');
    for (const k of ['ほん', 'パン', 'ローン', 'れん', 'えん', 'ファン', 'ちゃん', 'りん', 'るん']) expect(moraSplit(synthesizeMinimalPair(k))).toHaveLength(moraSplit(toHiragana(k)).length);
    // single morae keep the long-vowel / toggle / ー ladder (the corpus' 68 single morae are byte-stable)
    expect(synthesizeMinimalPair('か')).toBe('かあ');
    expect(synthesizeMinimalPair('しゅ')).toBe('じゅ'); // a two-character mora skips the long-vowel step, as before
    expect(synthesizeMinimalPair('きゃ')).toBe('ぎゃ');
    expect(synthesizeMinimalPair('ん')).toBe('んー');
    // single morae outside the corpus, pinned so the pipeline's copy (scripts/audio/verify.ts) can be checked against them
    expect(synthesizeMinimalPair('ぴゃ')).toBe('びゃ'); // handakuten → dakuten (was ぴゃー)
    expect(synthesizeMinimalPair('りょ')).toBe('りょー'); // り has no toggle
    expect(synthesizeMinimalPair('ふぁ')).toBe('ふぁー'); // a small-vowel mora is never toggled (ぶぁ is not learner kana)
    expect(synthesizeMinimalPair('てぃ')).toBe('てぃー');
  });
  it('synthesizeMinimalPair never writes っー / っん / a trailing っ and never sounds like the input', () => {
    const words = ['きて', 'きって', 'か', 'ん', 'コーヒー', 'おばあさん', 'アーカイブ', 'きゃく', 'ゔ', 'ー', 'はい', 'ローン', 'ほん', 'パン', 'えん', 'ファン', 'ちゃん', 'ベンチャー', 'インターフェース', 'ノート', 'ボールペン', 'せんせい', 'おんなのこ', 'あーん', 'のー', 'キー', 'ゼロ', 'りんご', 'るーる', 'れんらく', 'ぴあの', 'ぷりん', 'ぽけっと'];
    for (const w of words) {
      const p = synthesizeMinimalPair(w);
      expect(p, w).not.toMatch(/っー|っん|っ$/u);
      expect(p, w).not.toBe(toHiragana(w));
      expect(normalizeAnswer(p), w).not.toBe(normalizeAnswer(w));
    }
  });
  it('minimalPairPartner prefers distance 1 and skips identical readings', () => {
    const w = { id: 'a', kana: 'おばさん' };
    const pool = [w, { id: 'b', kana: 'おばさん' }, { id: 'c', kana: 'おばあさん' }, { id: 'd', kana: 'おじいさん' }];
    expect(minimalPairPartner(w, pool)).toEqual(['おばさん', 'おばあさん']);
  });
});

describe('distractors stays importable under plain node (ARCHITECTURE §0: the audio pipeline imports synthesizeMinimalPair instead of copying it)', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('every relative import carries its .ts extension; no store, signals, DOM or alias import in the source', () => {
    const src = readFileSync(resolve(here, 'distractors.ts'), 'utf8');
    const imports = [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      if (spec.startsWith('.')) expect(spec, spec).toMatch(/\.ts$/);
      expect(spec, spec).not.toMatch(/^@\/|\/store|signals|preact/);
    }
    expect(src).not.toMatch(/\b(document|window|navigator|localStorage)\b/);
  });

  it('import() succeeds under node with type stripping and synthesizeMinimalPair gives the tested partners', () => {
    const moduleUrl = pathToFileURL(resolve(here, 'distractors.ts')).href;
    const script = [
      `const m = await import(${JSON.stringify(moduleUrl)});`,
      `if (typeof m.synthesizeMinimalPair !== 'function') { console.error('missing export'); process.exit(2); }`,
      `console.log(JSON.stringify(['コーヒー', 'ローン', 'きって', 'か', 'せんせい'].map((k) => m.synthesizeMinimalPair(k))));`,
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', script], { encoding: 'utf8', timeout: 30_000 });
    expect(r.error).toBeUndefined();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual(['こーっひー', 'どーん', 'きて', 'かあ', 'せんっせい']);
  });
});
