import {
  RE_NOT_MORA,
  containsHiragana,
  containsJapanese,
  containsKanji,
  containsKatakana,
  diffChars,
  equivalentJa,
  expandLongVowelMark,
  foldWidth,
  fuzzyEn,
  isHiragana,
  isKana,
  isKanji,
  isKatakana,
  levenshtein,
  moraCount,
  moraSimilarity,
  moraSplit,
  nearMissKind,
  normalizeAnswer,
  normalizeEn,
  normalizeJa,
  speechMorae,
  stripPunctuation,
  toHiragana,
  toKatakana,
} from './jp';

describe('character classes', () => {
  it.each([
    ['あいう', true],
    ['きゃ', true],
    ['こーひー', true],
    ['アイウ', false],
    ['漢', false],
    ['', false],
    ['abc', false],
  ])('isHiragana(%s) = %s', (s, v) => expect(isHiragana(s)).toBe(v));

  it.each([
    ['コーヒー', true],
    ['ヴァ', true],
    ['こーひー', false],
    ['カナka', false],
  ])('isKatakana(%s) = %s', (s, v) => expect(isKatakana(s)).toBe(v));

  it.each([
    ['ひらがなカタカナー・', true],
    ['あ', true],
    ['漢字', false],
    ['あ。', false],
    ['', false],
  ])('isKana(%s) = %s', (s, v) => expect(isKana(s)).toBe(v));

  it.each([
    ['食', true],
    ['食べ', false],
    ['々', true],
    ['〆', true],
    ['漢字', true],
    ['か', false],
    ['', false],
  ])('isKanji(%s) = %s', (s, v) => expect(isKanji(s)).toBe(v));

  it('contains*', () => {
    expect(containsKanji('飲みます')).toBe(true);
    expect(containsKanji('のみます')).toBe(false);
    expect(containsKatakana('コーヒーを飲む')).toBe(true);
    expect(containsKatakana('こーひー')).toBe(false);
    expect(containsHiragana('コーヒーを飲む')).toBe(true);
    expect(containsHiragana('コーヒー')).toBe(false);
    expect(containsJapanese('hello 世界')).toBe(true);
    expect(containsJapanese('hello')).toBe(false);
    expect(containsJapanese('。')).toBe(true);
  });
});

describe('conversion', () => {
  it('toHiragana keeps ー; toKatakana converts hiragana', () => {
    expect(toHiragana('コーヒー')).toBe('こーひー');
    expect(toHiragana('パーティー')).toBe('ぱーてぃー');
    expect(toHiragana('ヴ')).toBe('ゔ');
    expect(toKatakana('こーひー')).toBe('コーヒー');
    expect(toKatakana('きゃ')).toBe('キャ');
    expect(toHiragana('漢字とカナ')).toBe('漢字とかな');
  });
  it('foldWidth: full-width Latin and half-width kana', () => {
    expect(foldWidth('ＡＢＣ１２３')).toBe('ABC123');
    expect(foldWidth('ｶﾀｶﾅ')).toBe('カタカナ');
    expect(foldWidth('ｺｰﾋｰ')).toBe('コーヒー');
  });
  it('stripPunctuation keeps ー and kana', () => {
    expect(stripPunctuation('こんにちは。元気？「はい」')).toBe('こんにちは元気はい');
    expect(stripPunctuation('コーヒー、お茶・水')).toBe('コーヒーお茶水');
    expect(stripPunctuation(' a b ')).toBe('ab');
    expect(stripPunctuation('ko-hi-')).toBe('kohi');
  });
  it('expandLongVowelMark', () => {
    expect(expandLongVowelMark('こーひー')).toBe('こおひい');
    expect(expandLongVowelMark('きゃー')).toBe('きゃあ');
    expect(expandLongVowelMark('ー')).toBe('ー');
    expect(expandLongVowelMark('らーめん')).toBe('らあめん');
  });
});

describe('normalizeJa / normalizeAnswer', () => {
  it('normalizeJa strips and optionally folds', () => {
    expect(normalizeJa('　こんにちは。 ')).toBe('こんにちは');
    expect(normalizeJa('コーヒー')).toBe('コーヒー');
    expect(normalizeJa('コーヒー', { foldKatakana: true })).toBe('こーひー');
    expect(normalizeJa('ＡＢＣ')).toBe('ABC');
  });

  const EQUIV: [string, string][] = [
    ['コーヒー', 'こうひい'],
    ['コーヒー', 'こーひー'],
    ['とうきょう', 'トーキョー'],
    ['とうきょう', 'とおきょお'],
    ['せんせい', 'せんせえ'],
    ['せんせい', 'せんせー'],
    ['つづく', 'つずく'],
    ['はなぢ', 'はなじ'],
    ['こんにちは。', 'こんにちは'],
    ['おばあさん', 'おばーさん'],
    ['ＡＢＣ', 'ABC'],
    ['ゆうき', 'ゆーき'],
    ['おねえさん', 'おねーさん'],
    ['にい', 'にー'],
    ['ケーキ', 'けえき'],
    ['きょう', 'きょお'],
  ];
  it.each(EQUIV)('normalizeAnswer: %s ≡ %s', (a, b) => {
    expect(normalizeAnswer(a)).toBe(normalizeAnswer(b));
    expect(equivalentJa(a, b)).toBe(true);
  });

  const DISTINCT: [string, string][] = [
    ['きって', 'きて'],
    ['おばさん', 'おばあさん'],
    ['かき', 'かぎ'],
    ['きゃく', 'きやく'],
    ['いぬ', 'ねこ'],
    ['しゅじん', 'しゅうじん'],
  ];
  it.each(DISTINCT)('normalizeAnswer keeps %s ≠ %s', (a, b) => {
    expect(equivalentJa(a, b)).toBe(false);
  });
});

describe('normalizeEn / fuzzyEn', () => {
  it.each([
    ['To Eat', 'eat'],
    ['a station', 'station'],
    ['the  Station.', 'station'],
    ['to put on (lower body)', 'put on'],
    ['(topic marker)', 'topic marker'],
    ['to', 'to'],
    ['an apple', 'apple'],
    ["don't", "don't"],
    ['Ｔｏ ｅａｔ', 'eat'],
  ])('normalizeEn(%s) = %s', (s, v) => expect(normalizeEn(s)).toBe(v));

  const ACCEPT: [string, string[], boolean][] = [
    ['eat', ['to eat'], true],
    ['to eat', ['to eat'], true],
    ['eats', ['to eat'], false], // "eat" is only 3 chars: exact only
    ['drinks', ['to drink'], true], // 5+ chars: distance 1 ok
    ['station', ['a station'], true],
    ['staton', ['station'], true],
    ['sttion', ['station'], true],
    ['sation', ['station'], true],
    ['stashun', ['station'], false], // distance 3
    ['convenent', ['convenient'], true],
    ['convenint', ['convenient'], true],
    ['convnint', ['convenient'], true], // 10 chars → distance ≤ 2
    ['cnvnint', ['convenient'], false],
    ['univercity', ['university'], true],
    ['universiti', ['university'], true],
    ['dog', ['dot'], false],
    ['cat', ['dog'], false],
    ['dog', ['dog', 'hound'], true],
    ['hound', ['dog', 'hound'], true],
    ['put on', ['to put on (lower body)'], true],
    ['topic marker', ['(topic marker)'], true],
    ['', ['anything'], false],
    ['quiet', ['quiet', 'calm'], true],
    ['quite', ['quiet'], true], // distance 2 on 5 chars? no — "quite" vs "quiet" is a transposition = 2 edits
  ];
  it.each(ACCEPT)('fuzzyEn(%s, %j) = %s', (g, acc, v) => {
    if (g === 'quite') {
      expect(fuzzyEn(g, acc)).toBe(false);
      return;
    }
    expect(fuzzyEn(g, acc)).toBe(v);
  });
});

describe('moraSplit / moraCount', () => {
  it.each([
    ['きゃく', ['きゃ', 'く']],
    ['きって', ['き', 'っ', 'て']],
    ['しんぶん', ['し', 'ん', 'ぶ', 'ん']],
    ['コーヒー', ['コ', 'ー', 'ヒ', 'ー']],
    ['ティー', ['ティ', 'ー']],
    ['とうきょう', ['と', 'う', 'きょ', 'う']],
    ['ファ', ['ファ']],
    ['っ', ['っ']],
    ['ゃ', ['ゃ']],
    ['', []],
    ['にほんご', ['に', 'ほ', 'ん', 'ご']],
    ['りょこう', ['りょ', 'こ', 'う']],
  ])('moraSplit(%s)', (s, morae) => {
    expect(moraSplit(s)).toEqual(morae);
    expect(moraCount(s)).toBe(morae.length);
  });
});

describe('speechMorae / RE_NOT_MORA (the spoken morae of a kana line)', () => {
  it('RE_NOT_MORA removes what is written but never spoken: punctuation, brackets, the ellipsis, the wave dash and whitespace', () => {
    expect('、。！？「」『』〜…・ 　\t\n'.replace(RE_NOT_MORA, '')).toBe('');
    expect('あ、い。う！え？「お」『か』き〜く…け・こ さ　し'.replace(RE_NOT_MORA, '')).toBe('あいうえおかきくけこさし');
    expect('きょう'.replace(RE_NOT_MORA, '')).toBe('きょう'); // kana, small kana, ー and っ are never touched
    expect('コーヒー、きって'.replace(RE_NOT_MORA, '')).toBe('コーヒーきって');
  });
  it.each([
    ['いぬは、みずを のみます。', ['い', 'ぬ', 'は', 'み', 'ず', 'を', 'の', 'み', 'ま', 'す']],
    ['「はい」！　『いいえ』？', ['は', 'い', 'い', 'い', 'え']],
    ['えーと…そうですね〜', ['え', 'ー', 'と', 'そ', 'う', 'で', 'す', 'ね']],
    ['コーヒー・パン', ['コ', 'ー', 'ヒ', 'ー', 'パ', 'ン']],
    ['', []],
    ['、。', []],
  ])('speechMorae(%s) drops the pauses', (s, morae) => {
    expect(speechMorae(s)).toEqual(morae);
  });
  it.each([
    ['きょう、きって。', ['きょ', 'う', 'き', 'っ', 'て']],
    ['ティー！', ['ティ', 'ー']],
    ['しんぶん', ['し', 'ん', 'ぶ', 'ん']],
    ['りょこう　ファ', ['りょ', 'こ', 'う', 'ファ']],
    ['とうきょう…', ['と', 'う', 'きょ', 'う']],
  ])('speechMorae(%s): small kana fold into the preceding mora; ー and っ are one mora each', (s, morae) => {
    expect(speechMorae(s)).toEqual(morae);
    expect(speechMorae(s).length).toBe(moraCount(s.replace(RE_NOT_MORA, '')));
  });
  it('the global regex carries no state between calls (replace resets lastIndex), so repeated calls agree', () => {
    expect('。あ'.replace(RE_NOT_MORA, '')).toBe('あ');
    expect('。あ'.replace(RE_NOT_MORA, '')).toBe('あ');
    expect(speechMorae('あ。')).toEqual(['あ']);
    expect(speechMorae('あ。')).toEqual(['あ']);
  });
});

describe('levenshtein / moraSimilarity', () => {
  it.each([
    ['', '', 0],
    ['a', '', 1],
    ['', 'abc', 3],
    ['kitten', 'sitting', 3],
    ['きって', 'きて', 1],
    ['とうきょう', 'ときょう', 1],
    ['いぬ', 'ねこ', 2],
    ['同じ', '同じ', 0],
  ])('levenshtein(%s, %s) = %d', (a, b, d) => expect(levenshtein(a, b)).toBe(d));
  it('works over mora arrays', () => {
    expect(levenshtein(['きゃ', 'く'], ['きゃ', 'く'])).toBe(0);
    expect(levenshtein(['きゃ', 'く'], ['き', 'や', 'く'])).toBe(2);
  });
  it('moraSimilarity', () => {
    expect(moraSimilarity('きって', 'きって')).toBe(1);
    expect(moraSimilarity('コーヒー', 'こーひー')).toBe(1);
    expect(moraSimilarity('きって', 'きて')).toBeCloseTo(2 / 3);
    expect(moraSimilarity('', '')).toBe(1);
    expect(moraSimilarity('あ', 'い')).toBe(0);
  });
});

describe('nearMissKind', () => {
  const CASES: [given: string, expected: string, kind: ReturnType<typeof nearMissKind>][] = [
    ['きて', 'きって', 'small-kana'],
    ['きって', 'きて', 'small-kana'],
    ['きやく', 'きゃく', 'small-kana'],
    ['きゃく', 'きやく', 'small-kana'],
    ['がこう', 'がっこう', 'small-kana'],
    ['しゆう', 'しゅう', 'small-kana'],
    ['ときょう', 'とうきょう', 'vowel-length'],
    ['とおきょう', 'とうきょう', null], // canonical equivalents: this is a match, not a miss
    ['おばさん', 'おばあさん', 'vowel-length'],
    ['おばあさん', 'おばさん', 'vowel-length'],
    ['がっこ', 'がっこう', 'vowel-length'],
    ['こーひ', 'こーひー', 'vowel-length'],
    ['コーヒ', 'コーヒー', 'vowel-length'],
    ['ゆき', 'ゆうき', 'vowel-length'],
    ['たべまず', 'たべます', null], // 4 chars: too short for transcription
    ['たべました', 'たべまして', 'transcription'],
    ['たべましたよ', 'たべました', 'transcription'],
    ['しんぶん', 'しんぶん', null],
    ['いぬ', 'ねこ', null],
    ['ふじさん', 'ふじさま', null],
    ['', 'あ', null],
    ['コーヒー', 'こうひい', null], // accepted variant (おう/おー), so a match, not a miss
    ['あめ', 'あま', null],
    ['にほんこ', 'にほんご', null], // voicing is not a near miss (4 chars)
    ['がくせえ', 'がくせい', null], // えい ≡ ええ: accepted variant
    ['がくせ', 'がくせい', 'vowel-length'],
    ['べんきょ', 'べんきょう', 'vowel-length'],
  ];
  it.each(CASES)('nearMissKind(%s, %s) = %s', (g, e, k) => expect(nearMissKind(g, e)).toBe(k));
});

describe('diffChars', () => {
  it('marks matches, extras and missing characters', () => {
    expect(diffChars('きて', 'きって')).toEqual([
      ['き', 0],
      ['っ', 2],
      ['て', 0],
    ]);
    expect(diffChars('きって', 'きて')).toEqual([
      ['き', 0],
      ['っ', 1],
      ['て', 0],
    ]);
    expect(diffChars('abc', 'abc')).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ]);
    expect(diffChars('', 'ab')).toEqual([
      ['a', 2],
      ['b', 2],
    ]);
    expect(diffChars('ab', '')).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
    const d = diffChars('たべまず', 'たべます');
    expect(d.filter(([, k]) => k === 0).map(([c]) => c).join('')).toBe('たべま');
    expect(d.some(([c, k]) => c === 'ず' && k === 1)).toBe(true);
    expect(d.some(([c, k]) => c === 'す' && k === 2)).toBe(true);
  });
  it('reconstructs both strings', () => {
    for (const [g, e] of [
      ['おばさん', 'おばあさん'],
      ['とうきょう', 'ときょう'],
      ['いぬ', 'ねこ'],
      ['きょうと', 'きょうとし'],
    ] as const) {
      const d = diffChars(g, e);
      expect(d.filter(([, k]) => k !== 2).map(([c]) => c).join('')).toBe(g);
      expect(d.filter(([, k]) => k !== 1).map(([c]) => c).join('')).toBe(e);
    }
  });
});
