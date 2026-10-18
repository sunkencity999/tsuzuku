import type { GrammarItem, VocabItem } from '../src/content/types.ts';
import { AUX_VERBS, buildMatchPool, FUNCTION_TOKENS, inflectedForms, matchToken } from './linker.ts';

function v(id: string, word: string, kana: string, pos: VocabItem['pos'], altForms?: string[]): VocabItem {
  const it: VocabItem = { id, word, kana, meanings: ['x'], pos, jlpt: 5, tags: ['objects'], examples: [{ ja: `${word}。`, kana: `${kana}。`, en: 'x.' }] };
  if (altForms) it.altForms = altForms;
  return it;
}

/** A corpus-shaped allowlist in introduction order (the real ids, so collisions resolve as they do in the corpus). */
const CORPUS: VocabItem[] = [
  v('v-n5-0132', 'です', 'です', 'aux'),
  v('v-n5-0149', '下', 'した', 'n'),
  v('v-n5-0160', '色', 'いろ', 'n'),
  v('v-n5-0271', 'する', 'する', 'v-irr'),
  v('v-n5-0272', 'ある', 'ある', 'v5', ['有る', '在る']),
  v('v-n5-0273', 'いる', 'いる', 'v1', ['居る']),
  v('v-n5-0274', '行く', 'いく', 'v5', ['ゆく']),
  v('v-n5-0275', '来る', 'くる', 'v-irr'),
  v('v-n5-0276', '見る', 'みる', 'v1'),
  v('v-n5-0277', '食べる', 'たべる', 'v1'),
  v('v-n5-0279', '言う', 'いう', 'v5'),
  v('v-n5-0270', '北', 'きた', 'n'),
  v('v-n5-0293', '出る', 'でる', 'v1'),
  v('v-n5-0298', '置く', 'おく', 'v5'),
  v('v-n5-0288', '起きる', 'おきる', 'v1'),
  v('v-n5-0304', '降りる', 'おりる', 'v1'),
  v('v-n5-0308', '開く', 'あく', 'v5'),
  v('v-n5-0309', '閉まる', 'しまる', 'v5'),
  v('v-n5-0311', '出す', 'だす', 'v5'),
  v('v-n5-0313', '着る', 'きる', 'v1'),
  v('v-n5-0330', '開ける', 'あける', 'v1'),
  v('v-n5-0331', 'かける', 'かける', 'v1'),
  v('v-n5-0335', '要る', 'いる', 'v5', ['いる']),
  v('v-n5-0340', '降る', 'ふる', 'v5'),
  v('v-n5-0341', 'あげる', 'あげる', 'v1', ['上げる']),
  v('v-n5-0342', 'もらう', 'もらう', 'v5', ['貰う']),
  v('v-n5-0343', 'くれる', 'くれる', 'v1'),
  v('v-n5-0500', '勉強', 'べんきょう', 'n-suru'),
  v('v-n4-0087', '生きる', 'いきる', 'v1'),
  v('v-n4-0137', '鳴る', 'なる', 'v5'),
  v('v-n4-0258', 'おる', 'おる', 'v5'),
  v('v-n3-0448', '揚げる', 'あげる', 'v1'),
  v('v-n3-0730', '以内', 'いない', 'n'),
  v('v-n3-0867', '使用', 'しよう', 'n-suru'),
  v('v-n3-0929', '愛する', 'あいする', 'v-irr'),
];
const NO_GRAMMAR: GrammarItem[] = [];
const pool = buildMatchPool(CORPUS, NO_GRAMMAR);
const id = (token: string, p = pool): string | null => matchToken(p, token).id;

describe('linker — inflectedForms', () => {
  it('する: し-row polite, negative, past, て (+ contracted てる/てた), volitional, すれば; bare し only inside a compound', () => {
    const f = inflectedForms('する', 'v-irr');
    expect(f).toEqual(expect.arrayContaining(['します', 'しません', 'しました', 'しませんでした', 'しましょう', 'しない', 'しなかった', 'した', 'して', 'してる', 'してた', 'しよう', 'すれば']));
    expect(f).not.toContain('し');
    expect(inflectedForms('勉強する', 'v-irr')).toEqual(expect.arrayContaining(['勉強し', '勉強します', '勉強して']));
  });

  it('来る: き-row for polite / た / て, こ-row for ない / よう, くれば; the kanji spelling relies on the 来 stem', () => {
    const f = inflectedForms('くる', 'v-irr');
    expect(f).toEqual(expect.arrayContaining(['きます', 'きません', 'きました', 'きた', 'きて', 'きてた', 'こない', 'こなかった', 'こよう', 'くれば']));
    expect(f).not.toContain('き');
    expect(inflectedForms('来る', 'v-irr')).toEqual([]);
    expect(inflectedForms('持ってくる', 'v-irr')).toContain('持ってきた');
  });

  it('godan onbin by final kana: って/った, いて/いた (行く・いく・ゆく → って), いで/いだ, して/した, んで/んだ', () => {
    expect(inflectedForms('いく', 'v5')).toEqual(expect.arrayContaining(['いって', 'いった', 'いってる']));
    expect(inflectedForms('いく', 'v5')).not.toContain('いいて');
    expect(inflectedForms('行く', 'v5')).toEqual(expect.arrayContaining(['行って', '行った']));
    expect(inflectedForms('ゆく', 'v5')).toContain('ゆった');
    expect(inflectedForms('かく', 'v5')).toEqual(expect.arrayContaining(['かいて', 'かいた']));
    expect(inflectedForms('およぐ', 'v5')).toEqual(expect.arrayContaining(['およいで', 'およいだ']));
    expect(inflectedForms('はなす', 'v5')).toEqual(expect.arrayContaining(['はなして', 'はなした']));
    expect(inflectedForms('まつ', 'v5')).toContain('まって');
    expect(inflectedForms('とる', 'v5')).toContain('とった');
    expect(inflectedForms('かう', 'v5')).toContain('かって');
    expect(inflectedForms('のむ', 'v5')).toEqual(expect.arrayContaining(['のんで', 'のんだ']));
    expect(inflectedForms('しぬ', 'v5')).toContain('しんで');
    expect(inflectedForms('とぶ', 'v5')).toContain('とんだ');
  });

  it('godan rows: polite i-row, negative a-row, ば e-row, volitional o-row, 〜たい; ある has no あらない', () => {
    expect(inflectedForms('かう', 'v5')).toEqual(expect.arrayContaining(['かいます', 'かいません', 'かいました', 'かいませんでした', 'かいましょう', 'かわない', 'かわなかった', 'かえば', 'かおう', 'かいたい', 'かいたかった', 'かいたくない']));
    const aru = inflectedForms('ある', 'v5');
    expect(aru).toEqual(expect.arrayContaining(['あります', 'ありません', 'あって', 'あった', 'あれば']));
    expect(aru).not.toContain('あらない');
    expect(aru).not.toContain('あらなかった');
    expect(inflectedForms('ちゃう', 'aux')).toEqual([]);
  });

  it('ichidan: polite, negative, past, て (+ てる/てた), よう, れば, られる — no 〜たい and no imperative', () => {
    const f = inflectedForms('たべる', 'v1');
    expect(f).toEqual(expect.arrayContaining(['たべます', 'たべません', 'たべました', 'たべませんでした', 'たべましょう', 'たべない', 'たべなかった', 'たべた', 'たべて', 'たべてる', 'たべてた', 'たべよう', 'たべれば', 'たべられる']));
    expect(f).not.toContain('たべたい');
    expect(f).not.toContain('たべろ');
    expect(inflectedForms('みる', 'v1')).not.toContain('みたい');
  });

  it('copula: an aux です / だ item gets the negative, polite-negative and でしょう forms; other aux and nouns get none', () => {
    expect(inflectedForms('です', 'aux')).toEqual(['ではない', 'じゃない', 'ではなかった', 'じゃなかった', 'ではありません', 'じゃありません', 'ではありませんでした', 'じゃありませんでした', 'でしょう']);
    expect(inflectedForms('だ', 'aux')).toContain('じゃなかった');
    expect(inflectedForms('ます', 'aux')).toEqual([]);
    expect(inflectedForms('本', 'n')).toEqual([]);
    expect(inflectedForms('大きい', 'adj-i')).toEqual([]);
  });
});

describe('linker — the kana reading of a kanji word is the last resort', () => {
  const nums = [v('v-n5-0032', '二', 'に', 'n'), v('v-n5-0033', '三', 'さん', 'n')];
  it('に / さん / し / こと / しか / くらい / そう / なく / あり / え / おや are function tokens even when 二 / 三 / 市 / 琴 / 鹿 / 暗い / 僧 / 鳴く / 蟻 / 絵 / 親 are allowlisted', () => {
    const pool = buildMatchPool([...nums, v('v-n4-0433', '市', 'し', 'n'), v('v-n3-1326', '琴', 'こと', 'n'), v('v-n3-0614', '鹿', 'しか', 'n'), v('v-n5-0643', '暗い', 'くらい', 'adj-i'), v('v-n2-1188', '僧', 'そう', 'n'), v('v-n5-0733', '鳴く', 'なく', 'v5'), v('v-n2-1251', '蟻', 'あり', 'n'), v('v-n5-0623', '絵', 'え', 'n'), v('v-n4-0012', '親', 'おや', 'n')], []);
    for (const tok of ['に', 'さん', 'し', 'こと', 'しか', 'くらい', 'そう', 'なく', 'あり', 'え', 'おや']) {
      const m = matchToken(pool, tok);
      expect(m.id, tok).toBeNull();
      expect(m.known, tok).toBe(true);
    }
    // the kanji spellings and real inflections still link
    expect(matchToken(pool, '暗かった').id).toBe('v-n5-0643');
    // the bare kana spelling of an auxiliary lexeme is a real surface, not a mere reading: いく / おく / みる / くる link once allowlisted
    const aux = buildMatchPool([v('v-n5-0274', '行く', 'いく', 'v5'), v('v-n5-0298', '置く', 'おく', 'v5'), v('v-n5-0276', '見る', 'みる', 'v1'), v('v-n5-0275', '来る', 'くる', 'v-irr')], []);
    expect(['いく', 'おく', 'みる', 'くる'].map((t) => matchToken(aux, t).id)).toEqual(['v-n5-0274', 'v-n5-0298', 'v-n5-0276', 'v-n5-0275']);
    expect(matchToken(pool, '鳴いた').id).toBe('v-n5-0733');
  });
  it('in the kana stage the reading wins right after the forms: いち、に、さん counts 二 and 三', () => {
    const pool = buildMatchPool(nums, [], [], { kanaStage: true });
    expect(matchToken(pool, 'に').id).toBe('v-n5-0032');
    expect(matchToken(pool, 'さん').id).toBe('v-n5-0033');
    // in the kana stage the first allowlisted item keeps the surface: 三 before the suffix 〜さん (outside it the kana word wins)
    const withSan = [...nums, v('v-n5-0067', '〜さん', 'さん', 'suf')];
    expect(matchToken(buildMatchPool(withSan, [], [], { kanaStage: true }), 'さん').id).toBe('v-n5-0033');
    expect(matchToken(buildMatchPool(withSan, []), 'さん').id).toBe('v-n5-0067');
    expect(buildMatchPool(nums, []).kanaStage).toBe(false);
  });
  it('a reading links when nothing else claims the token (わたし → 私, たぶん → 多分); a kana-written word beats an earlier reading (いや over 嫌, なる over 鳴る)', () => {
    const pool = buildMatchPool([v('v-n5-0041', '私', 'わたし', 'n'), v('v-n3-0993', '多分', 'たぶん', 'n'), v('v-n5-0641', '嫌', 'いや', 'adj-na'), v('v-n4-0137', '鳴る', 'なる', 'v5'), v('v-n5-0773', 'いや', 'いや', 'n'), v('v-n5-0806', 'なる', 'なる', 'v5', ['成る'])], []);
    expect(matchToken(pool, 'わたし').id).toBe('v-n5-0041');
    expect(matchToken(buildMatchPool([v('v-n5-0349', '渡す', 'わたす', 'v5'), v('v-n5-0041', '私', 'わたし', 'n')], []), 'わたし').id).toBe('v-n5-0041'); // not the わた stem of 渡す
    expect(matchToken(pool, 'たぶん').id).toBe('v-n3-0993');
    expect(matchToken(pool, 'いや').id).toBe('v-n5-0773');
    expect(matchToken(pool, 'なる').id).toBe('v-n5-0806');
    expect(matchToken(pool, 'なった').id).toBe('v-n5-0806');
    expect(matchToken(pool, '鳴った').id).toBe('v-n4-0137');
  });
  it('a kana altForm of an affix is a surface: たて → 〜立て, ahead of the たて stem of 建てる', () => {
    const pool = buildMatchPool([v('v-n4-0164', '建てる', 'たてる', 'v1'), v('v-n1-0340', '〜立て', 'たて', 'suf', ['〜たて'])], []);
    expect(matchToken(pool, 'たて').id).toBe('v-n1-0340');
    expect(matchToken(pool, '建てた').id).toBe('v-n4-0164');
  });
});

describe('linker — matchToken links inflected forms of allowlisted verbs', () => {
  it('する forms link to する, した beats the reading of 下, しよう beats the reading of 使用; bare し stays the particle', () => {
    for (const t of ['します', 'しない', 'して', 'した', 'してた', 'しよう', 'すれば', 'しなかった']) expect(id(t)).toBe('v-n5-0271');
    expect(matchToken(pool, 'し')).toEqual({ id: null, known: true, punct: false });
    expect(id('下')).toBe('v-n5-0149');
    expect(id('使用')).toBe('v-n3-0867');
    expect(id('愛します')).toBe('v-n3-0929');
    expect(id('愛して')).toBe('v-n3-0929');
  });

  it('来る forms link to 来る over 着る and over the reading of 北; 着る keeps its own forms', () => {
    for (const t of ['きます', 'きました', 'きた', 'きて', 'こない', 'こなかった']) expect(id(t)).toBe('v-n5-0275');
    expect(id('北')).toBe('v-n5-0270');
    expect(matchToken(pool, 'きない')).toEqual({ id: null, known: false, punct: false }); // 着る is written in kanji: its reading does not inflect
    expect(id('着ます')).toBe('v-n5-0313');
    expect(id('来ます')).toBe('v-n5-0275');
  });

  it('行く: いって / いった / いきます link to 行く, not 言う, 要る or the いき stem of 生きる', () => {
    for (const t of ['いって', 'いった', 'いきます', 'いきました', 'いけば', 'いこう', 'ゆく', '行って', '行きます']) expect(id(t)).toBe('v-n5-0274');
    expect(id('言って')).toBe('v-n5-0279');
    expect(id('生きます')).toBe('v-n4-0087');
    expect(id('いきる')).toBe('v-n4-0087'); // a reading with no competing form stays exact
    expect(id('要ります')).toBe('v-n5-0335');
  });

  it('ある / いる / 置く / 見る / あげる / もらう / くれる: the auxiliary spellings link to their lexeme', () => {
    for (const t of ['あって', 'あった', 'あります', 'ありません', 'ありました', 'あれば', '有った', '在りました']) expect(id(t)).toBe('v-n5-0272');
    expect(matchToken(pool, 'ない')).toEqual({ id: null, known: true, punct: false });
    for (const t of ['いる', 'います', 'いた', 'いて', 'いない', 'いません', 'いました', 'いなかった', 'いれば']) expect(id(t)).toBe('v-n5-0273');
    expect(id('以内')).toBe('v-n3-0730');
    for (const t of ['おきます', 'おきました', 'おいた', 'おいて', 'おこう']) expect(id(t)).toBe('v-n5-0298');
    expect(id('起きた')).toBe('v-n5-0288');
    for (const t of ['みて', 'みた', 'みれば']) expect(id(t)).toBe('v-n5-0276');
    for (const t of ['あげます', 'あげた', 'あげて']) expect(id(t)).toBe('v-n5-0341');
    expect(id('揚げた')).toBe('v-n3-0448');
    for (const t of ['もらった', 'もらって', 'もらいます']) expect(id(t)).toBe('v-n5-0342');
    expect(id('くれた')).toBe('v-n5-0343');
    expect(id('おりました')).toBe('v-n4-0258'); // humble auxiliary, not 降りる
    expect([...AUX_VERBS]).toEqual(expect.arrayContaining(['いく', 'くる', 'いる', 'おる', 'ある', 'おく', 'みる', 'しまう', 'くれる', 'もらう', 'あげる', 'する']));
  });

  it('copula forms link to the aux です item when the allowlist has one, and stay function tokens otherwise', () => {
    for (const t of ['ではない', 'じゃない', 'ではありません', 'じゃありません', 'じゃなかった', 'でしょう']) expect(id(t)).toBe('v-n5-0132');
    expect(matchToken(pool, 'でした')).toEqual({ id: null, known: true, punct: false });
    const without = buildMatchPool(CORPUS.filter((x) => x.id !== 'v-n5-0132'), NO_GRAMMAR);
    expect(matchToken(without, 'ではありません')).toEqual({ id: null, known: true, punct: false });
  });

  it('a whole-form match beats a shorter stem (出して → 出す, not the 出 of 出る); a kanji homograph goes to the longest stem', () => {
    for (const t of ['出して', '出した', '出さない', '出しました']) expect(id(t)).toBe('v-n5-0311');
    for (const t of ['出た', '出て', '出ます']) expect(id(t)).toBe('v-n5-0293');
    expect(id('降った')).toBe('v-n5-0340');
    expect(id('降りました')).toBe('v-n5-0304'); // 降る / 降りる both inflect to it: the longer stem, as every prefix match
    expect(id('開けば')).toBe('v-n5-0308'); // 開ける has no such form, so the 開く form wins over the 開け stem
    expect(id('開けた')).toBe('v-n5-0330');
  });

  it('the kana reading of a content verb does not inflect: なった is not 鳴る, しまった is not 閉まる; kana words and stems still work', () => {
    expect(matchToken(pool, 'なった')).toEqual({ id: null, known: false, punct: false });
    expect(id('鳴った')).toBe('v-n4-0137');
    expect(matchToken(pool, 'しまった')).toEqual({ id: null, known: true, punct: false });
    expect(id('閉まった')).toBe('v-n5-0309');
    expect(id('かける')).toBe('v-n5-0331');
    expect(id('かけた')).toBe('v-n5-0331');
    expect(id('たべました')).toBe('v-n5-0277');
    expect(id('食べ始めた')).toBe('v-n5-0277');
    expect(id('勉強します')).toBe('v-n5-0500');
    expect(id('勉強し')).toBe('v-n5-0500');
  });

  it('the kana reading of an affix never claims a bare token: そう is not 総〜, こう is not 高〜, せい is not 〜性; the kanji surface and a real kana word still link', () => {
    const affixes = [v('v-n3-1559', '総〜', 'そう〜', 'pref'), v('v-n2-1055', '高〜', 'こう〜', 'pref'), v('v-n3-1539', '〜性', '〜せい', 'suf')];
    const pool = buildMatchPool(affixes, []);
    for (const tok of ['そう', 'こう', 'せい']) expect(matchToken(pool, tok).id, tok).toBeNull();
    expect(matchToken(pool, '総').id).toBe('v-n3-1559');
    expect(matchToken(pool, '性').id).toBe('v-n3-1539');
    // a kana word spelled like the reading is unaffected
    const withWord = buildMatchPool([...affixes, v('v-n5-0900', 'そう', 'そう', 'adv')], []);
    expect(matchToken(withWord, 'そう').id).toBe('v-n5-0900');
  });

  it('before the verb is introduced, its forms stay function tokens (known, unlinked)', () => {
    const early = buildMatchPool([v('v-n5-0149', '下', 'した', 'n')], NO_GRAMMAR);
    for (const t of ['します', 'いった', 'あって', 'もらった', 'ではない']) {
      expect(FUNCTION_TOKENS.has(t)).toBe(true);
      expect(matchToken(early, t)).toEqual({ id: null, known: true, punct: false });
    }
    expect(matchToken(early, 'した')).toEqual({ id: null, known: true, punct: false }); // no する yet — and した is the function token, never the reading of 下: the reading is all there is
  });
});

/* ── design 08 §4: segmentSentence / linkSentence / pools ────────────────── */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPlain } from '../src/content/ruby.ts';
import type { StationBundle, StoryItem } from '../src/content/types.ts';
import { compareRefs, linkSentence, plusOneIdsOf, readPoolCorpus, segmentSentence, sentenceMorae, speechSecondsFor, stationPools, stringifyPool } from './linker.ts';
import type { MatchPool } from './linker.ts';

function g(id: string, pattern: string, clozeHints: string[]): GrammarItem {
  return { id, pattern, meaning: 'x', formation: ['x'], explanation: 'x', jlpt: 5, register: 'neutral', examples: [{ ja: 'x', kana: 'x', en: 'x' }], clozeHints, mistakes: [], related: [], tags: [] };
}

/** A small corpus-shaped allowlist for the segmenter (real ids where they exist). */
const SEG: VocabItem[] = [
  v('v-n5-0099', '本', 'ほん', 'n'),
  v('v-n5-0104', '〜冊', 'さつ', 'counter'),
  v('v-n5-0118', 'は', 'は', 'prt'),
  v('v-n5-0120', 'を', 'を', 'prt'),
  v('v-n5-0132', 'です', 'です', 'aux'),
  v('v-n5-0145', '家', 'いえ', 'n'),
  v('v-n5-0273', 'いる', 'いる', 'v1', ['居る']),
  v('v-n5-0275', '来る', 'くる', 'v-irr'),
  v('v-n5-0277', '食べる', 'たべる', 'v1'),
  v('v-n5-0281', '読む', 'よむ', 'v5'),
  v('v-n5-0356', 'いい', 'いい', 'adj-i'),
  v('v-n5-0369', '高い', 'たかい', 'adj-i'),
  v('v-n5-0400', '返す', 'かえす', 'v5'),
  v('v-n5-0406', '水', 'みず', 'n'),
  v('v-n5-0671', 'まだ', 'まだ', 'adv'),
  v('v-n5-0680', '静か', 'しずか', 'adj-na'),
];
const SEG_GRAMMAR: GrammarItem[] = [g('g-n5-017', 'Vます', ['ます', 'ました']), g('g-n4-044', '〜ように', ['ように'])];
const seg = buildMatchPool(SEG, SEG_GRAMMAR);

describe('linker — segmentSentence / linkSentence (design 08 §4)', () => {
  it('a compound verb segments into its known parts (読み返す → 読み + 返す, both linked) and is one token once it is a word itself', () => {
    expect(segmentSentence(seg, '本を読み返す。')).toEqual(['本', 'を', '読み', '返す', '。']);
    expect(linkSentence(seg, '本を読み返す。')).toMatchObject({ ids: ['v-n5-0099', 'v-n5-0120', 'v-n5-0281', 'v-n5-0400'], unknown: 0 });
    const compound = buildMatchPool([...SEG, v('v-n3-0001', '読み返す', 'よみかえす', 'v5')], SEG_GRAMMAR);
    expect(segmentSentence(compound, '本を読み返した。')).toEqual(['本', 'を', '読み返した', '。']);
    expect(linkSentence(compound, '本を読み返した。').ids).toEqual(['v-n5-0099', 'v-n5-0120', 'v-n3-0001']);
  });

  it('a numeral + counter is one token linked to the counter; a bare numeral run is known and unlinked; a word that starts with a numeral kanji stays a word', () => {
    expect(segmentSentence(seg, '本を三冊読みました。')).toEqual(['本', 'を', '三冊', '読みました', '。']);
    expect(linkSentence(seg, '本を三冊読みました。').ids).toEqual(['v-n5-0099', 'v-n5-0120', 'v-n5-0104', 'v-n5-0281']);
    expect(linkSentence(seg, '三十です。')).toMatchObject({ tokens: ['三十', 'です', '。'], ids: ['v-n5-0132'], unknown: 0 });
    const issho = buildMatchPool([...SEG, v('v-n5-0683', '一緒に', 'いっしょに', 'adv')], SEG_GRAMMAR);
    expect(segmentSentence(issho, '一緒に来ました。')).toEqual(['一緒に', '来ました', '。']);
    expect(linkSentence(issho, '一緒に来ました。').ids).toEqual(['v-n5-0683', 'v-n5-0275']);
  });

  it('names from StoryItem.names are known, with their suffix; the cast is always known; without the name the kanji is an unknown run', () => {
    const r = linkSentence(seg, '森さんはハナさんと来ました。', new Set(['森さん']));
    expect(r.tokens).toEqual(['森さん', 'は', 'ハナさん', 'と', '来ました', '。']);
    expect(r.unknown).toBe(0);
    expect(r.ids).toEqual(['v-n5-0118', 'v-n5-0275']);
    expect(linkSentence(seg, '森さんは来ました。')).toMatchObject({ tokens: ['森', 'さん', 'は', '来ました', '。'], unknownTokens: ['森'] });
  });

  it('an unknown run stays one token (りんご, コーヒー); inflections stay on the word and auxiliaries come off after て; the honorific prefix is tolerated', () => {
    expect(linkSentence(seg, 'りんごを食べました。')).toMatchObject({ tokens: ['りんご', 'を', '食べました', '。'], unknownTokens: ['りんご'], ids: ['v-n5-0120', 'v-n5-0277'] });
    expect(linkSentence(seg, 'コーヒーはまだです。').unknownTokens).toEqual(['コーヒー']);
    expect(segmentSentence(seg, '高くないですか。')).toEqual(['高くない', 'です', 'か', '。']);
    expect(segmentSentence(seg, '食べていました。')).toEqual(['食べて', 'いました', '。']);
    expect(linkSentence(seg, '食べていました。').ids).toEqual(['v-n5-0277', 'v-n5-0273']);
    expect(segmentSentence(seg, '静かな家です。')).toEqual(['静か', 'な', '家', 'です', '。']);
    expect(linkSentence(seg, 'お水をください。')).toMatchObject({ tokens: ['お', '水', 'を', 'ください', '。'], unknownTokens: ['ください'] });
    // the honorific before a known kana word is tolerated too (おみず in the kana stage, where みず is a word of its own)
    const kanaStage = buildMatchPool(SEG, SEG_GRAMMAR, [], { kanaStage: true });
    expect(linkSentence(kanaStage, 'おみずをください。')).toMatchObject({ tokens: ['お', 'みず', 'を', 'ください', '。'], unknownTokens: ['ください'] });
    // the stories' tokenisation: a hint stays whole when no word is behind it, a function-only hint splits
    expect(segmentSentence(seg, '読むように食べます。')).toEqual(['読む', 'ように', '食べます', '。']);
    expect(linkSentence(seg, '読むように食べます。').ids).toContain('g-n4-044');
  });

  it('a lone stray hiragana is NOT tolerated: an unknown kana word is never carved into function tokens + one character and passed as known (よく, まだ, かばん, かけ), while a lone unknown kanji still splits from its particle', () => {
    // よ is the particle, く is nothing: the whole word is one unknown run and the sentence is not all-known
    expect(linkSentence(seg, 'よく食べます。')).toMatchObject({ tokens: ['よく', '食べます', '。'], unknownTokens: ['よく'], unknown: 1 });
    // まだ is a word in SEG (v-n5-0671); without it the run stays whole instead of ま + だ (copula)
    const noMada = buildMatchPool(SEG.filter((x) => x.id !== 'v-n5-0671'), SEG_GRAMMAR);
    expect(linkSentence(seg, '本はまだです。')).toMatchObject({ tokens: ['本', 'は', 'まだ', 'です', '。'], unknown: 0 });
    expect(linkSentence(noMada, '本はまだです。')).toMatchObject({ tokens: ['本', 'は', 'まだ', 'です', '。'], unknownTokens: ['まだ'] });
    // か / ば are function tokens, ん is not: かばん is never か + ば + a tolerated ん — the verdict is unknown (the listing carves the particle か off the front, as it does for は + まだ)
    expect(linkSentence(seg, 'かばんです。')).toMatchObject({ ids: ['v-n5-0132'], unknownTokens: ['ばん'] });
    // かけました (かける not in SEG): か + け + ました would have passed the stray rule; now かけ is the unknown
    expect(linkSentence(seg, '水をかけました。').unknownTokens).toEqual(['かけ']);
    // a lone unknown KANJI is a plausible word and takes no surcharge: 犬 + が, not 犬が
    expect(linkSentence(seg, '犬がいます。')).toMatchObject({ tokens: ['犬', 'が', 'います', '。'], unknownTokens: ['犬'] });
  });

  it('sentenceMorae folds small kana and drops punctuation; speechSecondsFor is morae ÷ 7 + 0.5; pool order is stories → grammar → vocab by id then index', () => {
    expect(sentenceMorae('みずをのみます。')).toBe(7);
    expect(sentenceMorae('きょうはあついですね。')).toBe(9);
    expect(sentenceMorae('「コーヒー、ください。」')).toBe(8);
    expect(speechSecondsFor(7)).toBeCloseTo(1.5, 6);
    const refs = ['v-n5-0010#ex1', 's-04-2#L3', 'g-n5-001#ex0', 'v-n5-0010#ex0', 's-04-2#L10', 's-04-1#L0', 'g-n5-001#ex2'].map((ref) => ({ ref, ids: [], kana: '', morae: 0 }));
    expect([...refs].sort(compareRefs).map((r) => r.ref)).toEqual(['s-04-1#L0', 's-04-2#L3', 's-04-2#L10', 'g-n5-001#ex0', 'g-n5-001#ex2', 'v-n5-0010#ex0', 'v-n5-0010#ex1']);
    const text = stringifyPool({ schema: 'tsuzuku.pool/1', station: 4, refs: refs.slice(0, 2) });
    expect(text.split('\n').length).toBe(9);
    expect(JSON.parse(text)).toEqual({ schema: 'tsuzuku.pool/1', station: 4, refs: refs.slice(0, 2) });
    expect(stringifyPool({ schema: 'tsuzuku.pool/1', station: 1, refs: [] })).toBe('{\n  "schema": "tsuzuku.pool/1",\n  "station": 1,\n  "refs": []\n}\n');
  });

  it("20 story lines sampled across the shipped corpus (every ⌊N/20⌋-th linked line of the 137 texts, Stations 1–53) reproduce their tokens' all-known verdict with ≥ 90 % per-line agreement; the exact id set agrees on fewer lines because the writers tokenise grammar surfaces differently", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, '..', 'public', 'content');
    const bundles: StationBundle[] = [];
    for (let n = 1; n <= 53; n++) {
      const p = join(root, 'stations', `${String(n).padStart(2, '0')}.json`);
      if (existsSync(p)) bundles.push(JSON.parse(readFileSync(p, 'utf8')) as StationBundle);
    }
    expect(bundles.length).toBe(53);
    const corpus = readPoolCorpus(root);
    const poolFor = stationPools(bundles, corpus);
    // every linked line of the texts (pieces excluded), in corpus order, with the pool `linkStories` linked its text against
    const linked: { station: number; line: StoryItem['lines'][number]; names: ReadonlySet<string>; story: StoryItem }[] = [];
    for (const s of corpus.stories) {
      if (s.audioFirst) continue;
      const m = /^st-(\d{2})$/.exec(String(s.stationId));
      if (!m || !Array.isArray(s.lines)) continue;
      const names = new Set((s.names ?? []).filter((x): x is string => typeof x === 'string'));
      for (const line of s.lines) if (Array.isArray(line.tokenIds) && line.tokenIds.length === line.tokens.length) linked.push({ station: Number(m[1]), line, names, story: s });
    }
    expect(linked.length).toBeGreaterThan(3000);
    const step = Math.floor(linked.length / 20);
    const sample = Array.from({ length: 20 }, (_, i) => linked[i * step]!);
    expect(new Set(sample.map((x) => x.station)).size).toBeGreaterThanOrEqual(10);
    const pools = new Map<StoryItem, MatchPool>();
    let verdictAgree = 0;
    let idAgree = 0;
    for (const { station, line, names, story } of sample) {
      let pool = pools.get(story);
      if (!pool) {
        pool = poolFor(station, plusOneIdsOf(story));
        pools.set(story, pool);
      }
      const r = linkSentence(pool, toPlain(line.ja), names);
      // the writers' verdict: every token linked, or known to the matcher (function token, name, numeral, punctuation)
      const storyKnown = line.tokens.every((t, j) => line.tokenIds![j] !== null || matchToken(pool!, t, names).known);
      if (storyKnown === (r.unknown === 0)) verdictAgree++;
      const want = [...new Set(line.tokenIds!.filter((x): x is string => typeof x === 'string'))].sort().join(' ');
      if (want === [...r.ids].sort().join(' ')) idAgree++;
    }
    expect(verdictAgree).toBeGreaterThanOrEqual(18);
    expect(idAgree).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
