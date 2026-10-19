import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AudioQuery,
  engineMorae,
  expectedAccent,
  foldMorae,
  kanaNameFoldDiffers,
  kanaPatch,
  kanaText,
  lenientMorae,
  LADDER,
  pauseMoraIndexes,
  queryDuration,
  queryMorae,
  synthesizeMinimalPair,
  toAquesTalk,
  verifyAccent,
  verifyMorae,
  withAccent,
  withAccentPhrases,
} from './verify.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  name: string;
  text: string;
  kana: string;
  styleId: number;
  query: AudioQuery;
}

const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(here, '__fixtures__', 'queries', `${name}.json`), 'utf8')) as Fixture;

/** A one-phrase query the engine would return for `moras` (katakana), with its own AquesTalk kana. */
const queryOf = (moras: string[], kana: string): AudioQuery =>
  ({
    accent_phrases: [{ moras: moras.map((text) => ({ text, consonant: null, consonant_length: null, vowel: 'a', vowel_length: 0.1, pitch: 5 })), accent: 1, pause_mora: null, is_interrogative: false }],
    speedScale: 1,
    pitchScale: 0,
    intonationScale: 1,
    volumeScale: 1,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.1,
    outputSamplingRate: 24000,
    outputStereo: false,
    kana,
  }) as AudioQuery;

describe('verify — strict fold for kana-name clips (the は / へ misread shipped in a-3467889b1f)', () => {
  it('the engine read the lone は as the particle ワ: lenient accepts it, strict refuses it and the kana patch forces ハ', () => {
    const ha = queryOf(['ワ'], "ワ'");
    expect(verifyMorae(ha, 'は').ok).toBe(true); // the fold that let the clip ship
    const strict = verifyMorae(ha, 'は', true);
    expect(strict.ok).toBe(false);
    expect(strict.got).toEqual(['わ']);
    expect(strict.want).toEqual(['は']);
    expect(kanaPatch(ha, 'は')).toBeNull();
    expect(kanaPatch(ha, 'は', true)).toBe("ハ'");
    const he = queryOf(['エ'], "エ'");
    expect(verifyMorae(he, 'へ', true).ok).toBe(false);
    expect(kanaPatch(he, 'へ', true)).toBe("ヘ'");
    // the forced reading verifies under both folds
    expect(verifyMorae(queryOf(['ハ'], "ハ'"), 'は', true).ok).toBe(true);
    expect(verifyMorae(queryOf(['ハ'], "ハ'"), 'は').ok).toBe(true);
  });

  it('を / ぢ / づ still fold under strict: お / じ / ず are their readings and what the content teaches', () => {
    expect(verifyMorae(queryOf(['オ'], "オ'"), 'を', true).ok).toBe(true);
    expect(verifyMorae(queryOf(['ジ'], "ジ'"), 'ぢ', true).ok).toBe(true);
    expect(verifyMorae(queryOf(['ズ'], "ズ'"), 'づ', true).ok).toBe(true);
    expect(verifyMorae(queryOf(['オ'], "オ'"), 'ヲ', true).ok).toBe(true);
    expect(foldMorae(['ハ', 'ヘ', 'ヲ'], true)).toEqual(['は', 'へ', 'お']);
    expect(lenientMorae('はなぢ', true)).toEqual(['は', 'な', 'じ']);
  });

  it('kanaNameFoldDiffers names exactly the kana whose strict reading differs: は and へ (and words carrying them), nothing else', () => {
    expect(kanaNameFoldDiffers('は')).toBe(true);
    expect(kanaNameFoldDiffers('へ')).toBe(true);
    expect(kanaNameFoldDiffers('ハ')).toBe(true);
    for (const k of ['あ', 'を', 'ぢ', 'づ', 'ん', 'きゃ', 'ば', 'ぱ', 'ヲ', 'わ', 'え']) expect(kanaNameFoldDiffers(k), k).toBe(false);
    expect(kanaNameFoldDiffers('はな')).toBe(true);
  });

  it('strict keeps the long-vowel canon and the 1:1 alignment the kana patch relies on', () => {
    for (const k of ['コーヒー', 'とうきょう', 'おねえさん', 'へや', 'はは', 'ラーメンをたべる。']) {
      expect(foldMorae(engineMorae(k), true), k).toEqual(lenientMorae(k, true));
      expect(engineMorae(k).length, k).toBe(lenientMorae(k, true).length);
    }
  });
});

describe('verify — lenient mora fold', () => {
  it('accepts は/わ, を/お, へ/え, ヅ/ズ, ヂ/ジ and katakana against hiragana', () => {
    expect(lenientMorae('こんにちは')).toEqual(lenientMorae('コンニチワ'));
    expect(lenientMorae('ほんをよむ')).toEqual(lenientMorae('ホンオヨム'));
    expect(lenientMorae('えきへいく')).toEqual(lenientMorae('エキエイク'));
    expect(lenientMorae('つづく')).toEqual(lenientMorae('ツズク'));
    expect(lenientMorae('はなぢ')).toEqual(lenientMorae('ハナジ'));
  });

  it('folds long vowels canonically: おう ≡ おお ≡ オー, えい ≡ ええ ≡ エー, いい ≡ イー; とおい keeps its い', () => {
    expect(lenientMorae('とうきょう')).toEqual(lenientMorae('トオキョオ'));
    expect(lenientMorae('こうこう')).toEqual(lenientMorae('コーコー'));
    expect(lenientMorae('せんせい')).toEqual(lenientMorae('センセエ'));
    expect(lenientMorae('おねえさん')).toEqual(lenientMorae('オネーサン'));
    expect(lenientMorae('いい')).toEqual(['い', 'ー']);
    expect(lenientMorae('とおい')).toEqual(['と', 'ー', 'い']);
    expect(lenientMorae('あおい')).toEqual(['あ', 'お', 'い']);
  });

  it('keeps one entry per mora (digraphs, っ, ん, ー) and drops punctuation and spaces', () => {
    expect(lenientMorae('きゃく')).toEqual(['きゃ', 'く']);
    expect(lenientMorae('きって、ください。')).toEqual(['き', 'っ', 'て', 'く', 'だ', 'さ', 'い']);
    expect(foldMorae(['コ', 'ー', 'ヒ', 'ー'])).toEqual(['こ', 'ー', 'ひ', 'ー']);
  });

  it('a pause_mora is dropped from the engine side and 、 from the content side', () => {
    const f = fixture('line-pause');
    expect(f.query.accent_phrases[0]?.pause_mora).not.toBeNull();
    expect(verifyMorae(f.query, f.kana).ok).toBe(true);
    expect(pauseMoraIndexes(f.query)).toEqual([2]);
  });

  it('every clean fixture verifies: words, lines, a long interrogative line, a grammar example, a michikusa quote', () => {
    for (const name of ['ame', 'candy', 'hai', 'nichiyobi', 'mainichi', 'line-ken', 'line-long', 'kana-a', 'asa', 'gakusei', 'gontazaka']) {
      const f = fixture(name);
      const v = verifyMorae(f.query, f.kana);
      expect(v.ok, `${name}: got ${v.got.join('')} want ${v.want.join('')}`).toBe(true);
    }
  });
});

describe('verify — the ladder on a misread (design 08 §7 step 3)', () => {
  it('何でも→ナニデモ fails step 0 and the step-2 patch keeps the phrasing: ナ\'ンデモ/タベ\'ル', () => {
    const f = fixture('nandemo');
    const v = verifyMorae(f.query, f.kana);
    expect(v.ok).toBe(false);
    expect(v.got.join('')).toBe('なにでもたべる');
    expect(v.want.join('')).toBe('なんでもたべる');
    expect(kanaPatch(f.query, f.kana)).toBe("ナ'ンデモ/タベ'ル");
  });

  it('二分→ニブン fails step 0 and the patch replaces only ブ: ニフンデ\'/ツキマ\'ス', () => {
    const f = fixture('nifun');
    expect(verifyMorae(f.query, f.kana).ok).toBe(false);
    expect(queryMorae(f.query).join('')).toBe('にぶんでつきます');
    expect(kanaPatch(f.query, f.kana)).toBe("ニフンデ'/ツキマ'ス");
  });

  it('a verified query has no patch; the step-3 text is the content kana without spaces', () => {
    const f = fixture('hai');
    expect(kanaPatch(f.query, f.kana)).toBeNull();
    expect(kanaText('にっさかへの さか　は')).toBe('にっさかへのさかは');
    expect(LADDER).toEqual(['surface', 'user-dict', 'kana-patch', 'kana-text']);
  });

  it('a patch across a phrase boundary merges the covered phrases and keeps the pause and the question mark', () => {
    const f = fixture('line-long');
    // Pretend the content kana wanted とおきょお read as たあきょお: only the differing morae move.
    const patched = kanaPatch(f.query, 'すみません、このでんしゃはたあきょうにいきますか。');
    expect(patched).toBe("スミマセ'ン、コノ'/デンシャワ'/タアキョオニ'/イキマ'スカ");
    expect(toAquesTalk(f.query)).toBe("スミマセ'ン、コノ'/デンシャワ'/トオキョオニ'/イキマ'スカ");
  });

  it('a misread span holding ー is patched in the engine notation (ー expanded): クォーツ → クォオ\'ツ, never a ー the is_kana parser rejects', () => {
    const f = fixture('quartz'); // the engine reads クォーツ as クオオツ (live 0.25.2: クォー'ツ → HTTP 400, クォオ'ツ → 200)
    const v = verifyMorae(f.query, f.kana);
    expect(v.ok).toBe(false);
    expect(v.got.join('')).toBe('くおーつ');
    expect(v.want.join('')).toBe('くぉーつ');
    const patch = kanaPatch(f.query, f.kana);
    expect(patch).toBe("クォオ'ツ");
    expect(patch).not.toMatch(/ー/);
    // The same rule for every ー: expansion follows the preceding vowel, as the engine writes it.
    expect(engineMorae('コーヒー')).toEqual(['コ', 'オ', 'ヒ', 'イ']);
    expect(engineMorae('スーパー')).toEqual(['ス', 'ウ', 'パ', 'ア']);
    expect(engineMorae('クォーツ')).toEqual(['クォ', 'オ', 'ツ']);
    expect(engineMorae('きゃーっ、ねえ。')).toEqual(['キャ', 'ア', 'ッ', 'ネ', 'エ']);
    // A patch built from a ー kana carries none, wherever the span sits.
    const long = fixture('line-long');
    expect(kanaPatch(long.query, 'すみません、このでんしゃはとーきょーにいきますか。')).toBeNull(); // ー ≡ the engine's オ under the fold: nothing to patch
    expect(kanaPatch(long.query, 'すみません、このでんしゃはたーきょうにいきますか。')).toBe("スミマセ'ン、コノ'/デンシャワ'/タアキョオニ'/イキマ'スカ");
  });

  it('engineMorae folds to exactly lenientMorae (a ー and its expansion are the same mora under the fold), so pre / suf alignment holds', () => {
    for (const k of ['コーヒー', 'スーパー', 'クォーツ', 'とうきょう', 'おねえさん', 'セーター', 'きゃー', 'んー', 'ラーメンをたべる。', 'かわいいですねー！']) {
      expect(foldMorae(engineMorae(k)), k).toEqual(lenientMorae(k));
      expect(engineMorae(k).length, k).toBe(lenientMorae(k).length);
    }
    for (const name of ['ame', 'hai', 'nichiyobi', 'line-ken', 'line-long', 'gakusei', 'gontazaka', 'quartz', 'nandemo', 'nifun']) {
      const f = fixture(name);
      expect(foldMorae(engineMorae(f.kana)), name).toEqual(lenientMorae(f.kana));
    }
  });

  it('withAccentPhrases keeps speed and pauses and regenerates the kana notation', () => {
    const f = fixture('nandemo');
    const q = { ...f.query, speedScale: 0.85, pauseLengthScale: 1.3 };
    const next = withAccentPhrases(q, fixture('hai').query.accent_phrases);
    expect(next.speedScale).toBe(0.85);
    expect(next.pauseLengthScale).toBe(1.3);
    expect(next.kana).toBe("ハ'イ");
    expect(q.accent_phrases).toBe(f.query.accent_phrases); // the input is not mutated
  });
});

describe('verify — accent (pitchConfidence: high words)', () => {
  it('雨 pitch 1 against the engine accent 1 verifies', () => {
    const f = fixture('ame');
    expect(verifyAccent(f.query, 1)).toEqual({ ok: true, got: 1, want: 1 });
  });

  it('a 雨 query with accent 2 against pitch 1 is flagged and the override query carries accent 1', () => {
    const probe = fixture('candy'); // 飴: accent 2 on the same morae あめ
    expect(verifyAccent(probe.query, 1)).toEqual({ ok: false, got: 2, want: 1 });
    const fixed = withAccent(probe.query, 1);
    expect(fixed.accent_phrases[0]?.accent).toBe(1);
    expect(fixed.kana).toBe("ア'メ");
    expect(verifyAccent(fixed, 1).ok).toBe(true);
    expect(probe.query.accent_phrases[0]?.accent).toBe(2); // immutable input
  });

  it('heiban 0 maps to the mora count: 飴 pitch 0 ↔ accent 2, 日曜日 pitch 3 stays 3', () => {
    expect(expectedAccent(0, 2)).toBe(2);
    expect(expectedAccent(0, 5)).toBe(5);
    expect(expectedAccent(3, 5)).toBe(3);
    expect(verifyAccent(fixture('candy').query, 0).ok).toBe(true);
    expect(verifyAccent(fixture('nichiyobi').query, 3).ok).toBe(true);
    expect(withAccent(fixture('candy').query, 0).accent_phrases[0]?.accent).toBe(1); // clamp: 0 is never a VOICEVOX accent
  });
});

describe('verify — the synthesized minimal-pair partner (#pair clips)', () => {
  it('toggles っ, a long vowel or voicing on the first eligible mora and always differs from the input', () => {
    expect(synthesizeMinimalPair('きって')).toBe('きて'); // drop っ
    expect(synthesizeMinimalPair('きて')).toBe('きって'); // insert っ before the first mora (index ≥ 1) a っ can precede — never before ー or ん (src/learn/distractors.ts, re-exported here)
    expect(synthesizeMinimalPair('おばさん')).toBe('おっばさん');
    expect(synthesizeMinimalPair('か')).toBe('かあ'); // single mora: long vowel
    expect(synthesizeMinimalPair('ん')).toBe('んー'); // nothing else to toggle
    expect(synthesizeMinimalPair('キテ')).toBe('きって'); // hiragana out
    for (const k of ['あめ', 'はい', 'がくせい', 'コーヒー', 'きゃく', 'っ']) expect(synthesizeMinimalPair(k)).not.toBe(k);
  });
});

describe('verify — timing', () => {
  it('queryDuration scales every length by speedScale and counts the pause', () => {
    const f = fixture('line-pause');
    const d1 = queryDuration(f.query);
    const d2 = queryDuration({ ...f.query, speedScale: 0.85 });
    expect(d1).toBeGreaterThan(1);
    expect(d2).toBeCloseTo(d1 / 0.85, 6);
    expect(queryDuration({ ...f.query, accent_phrases: f.query.accent_phrases.map((p) => ({ ...p, pause_mora: null })) })).toBeLessThan(d1);
  });
});
