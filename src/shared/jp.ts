/**
 * TSUZUKU — Japanese / English text utilities (design 04 §0 normalization).
 *
 * Pure string functions. wanakana only for script conversion.
 */
import { toHiragana as wkToHiragana, toKatakana as wkToKatakana } from 'wanakana';

/* ────────────────────────────────────────────────────────────────────────── */
/* Character classes                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

const HIRAGANA = 'ぁ-ゖゝゞ';
const KATAKANA = 'ァ-ヺヽヾ';
const LONG = 'ー'; // ー
const KANJI = '㐀-䶿一-鿿々〆';

const RE_HIRAGANA = new RegExp(`^[${HIRAGANA}${LONG}]+$`);
const RE_KATAKANA = new RegExp(`^[${KATAKANA}${LONG}]+$`);
const RE_KANA = new RegExp(`^[${HIRAGANA}${KATAKANA}${LONG}・]+$`);
const RE_KANJI = new RegExp(`^[${KANJI}]+$`);
const RE_HAS_KANJI = new RegExp(`[${KANJI}]`);
const RE_HAS_KATAKANA = new RegExp(`[${KATAKANA}]`);
const RE_HAS_HIRAGANA = new RegExp(`[${HIRAGANA}]`);
const RE_JAPANESE_CHAR = new RegExp(`[${HIRAGANA}${KATAKANA}${LONG}${KANJI}　-〿！-｠]`);

/** Punctuation and symbols removed before comparing answers (ー is kept: it is a long vowel). */
const RE_PUNCT = /[\s　、。，．！？!?「」『』（）()［］[\]【】〈〉《》〔〕・:;：；'"“”‘’~〜～…‥—–\-_,.*/\\<>|#@&%^$+=`]/g;

/** Every character is hiragana (ー allowed). */
export function isHiragana(s: string): boolean {
  return RE_HIRAGANA.test(s);
}
/** Every character is katakana (ー allowed). */
export function isKatakana(s: string): boolean {
  return RE_KATAKANA.test(s);
}
/** Every character is kana (hiragana, katakana, ー, ・). */
export function isKana(s: string): boolean {
  return RE_KANA.test(s);
}
/** Every character is a kanji (or 々/〆). */
export function isKanji(s: string): boolean {
  return RE_KANJI.test(s);
}
export function containsKanji(s: string): boolean {
  return RE_HAS_KANJI.test(s);
}
export function containsKatakana(s: string): boolean {
  return RE_HAS_KATAKANA.test(s);
}
export function containsHiragana(s: string): boolean {
  return RE_HAS_HIRAGANA.test(s);
}
export function containsJapanese(s: string): boolean {
  return RE_JAPANESE_CHAR.test(s);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Conversion and normalization                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Katakana → hiragana, keeping ー as ー (wanakana would expand it). */
export function toHiragana(s: string): string {
  return wkToHiragana(s, { convertLongVowelMark: false, passRomaji: true });
}

/** Hiragana → katakana. */
export function toKatakana(s: string): string {
  return wkToKatakana(s, { passRomaji: true });
}

/** NFKC: full-width Latin/digits → ASCII, half-width katakana → full-width. */
export function foldWidth(s: string): string {
  return s.normalize('NFKC');
}

export function stripPunctuation(s: string): string {
  return s.replace(RE_PUNCT, '');
}

/** NFKC → strip whitespace and punctuation → optional katakana→hiragana fold. */
export function normalizeJa(s: string, o: { foldKatakana?: boolean } = {}): string {
  let out = stripPunctuation(foldWidth(s));
  if (o.foldKatakana) out = toHiragana(out);
  return out;
}

const VOWEL_OF: Record<string, string> = {};
{
  const rows: [string, string][] = [
    ['あかさたなはまやらわがざだばぱぁゃゎ', 'あ'],
    ['いきしちにひみりゐぎじぢびぴぃ', 'い'],
    ['うくすつぬふむゆるぐずづぶぷぅゅゔ', 'う'],
    ['えけせてねへめれゑげぜでべぺぇ', 'え'],
    ['おこそとのほもよろをごぞどぼぽぉょ', 'お'],
  ];
  for (const [chars, v] of rows) for (const ch of chars) VOWEL_OF[ch] = v;
}

/** Replaces each ー by the vowel of the preceding mora (こーひー → こおひい). Hiragana input. */
export function expandLongVowelMark(hira: string): string {
  let out = '';
  for (const ch of hira) {
    if (ch === 'ー') {
      const prev = out.length ? (out[out.length - 1] as string) : '';
      out += VOWEL_OF[prev] ?? ch;
    } else out += ch;
  }
  return out;
}

const RE_OU = /([おこそとのほもよろをごぞどぼぽぉょ])う/g;
const RE_EI = /([えけせてねへめれゑげぜでべぺぇ])い/g;

/**
 * Comparison key for a typed Japanese answer: NFKC, no whitespace/punctuation,
 * katakana folded to hiragana, ぢ/づ ≡ じ/ず, and long vowels canonical
 * (おう ≡ おお ≡ おー, えい ≡ ええ ≡ えー, きい ≡ きー). Small っ is kept —
 * きて vs きって is a near miss, not a match (`nearMissKind`).
 */
export function normalizeAnswer(s: string): string {
  let out = normalizeJa(s, { foldKatakana: true });
  out = out.replace(/ぢ/g, 'じ').replace(/づ/g, 'ず');
  out = expandLongVowelMark(out);
  out = out.replace(RE_OU, '$1お').replace(RE_EI, '$1え');
  return out;
}

/** `normalizeAnswer(a) === normalizeAnswer(b)`. */
export function equivalentJa(a: string, b: string): boolean {
  return normalizeAnswer(a) === normalizeAnswer(b);
}

const RE_EN_PAREN = /\([^)]*\)|（[^）]*）/g;
const RE_EN_NONWORD = /[^a-z0-9' ]+/g;
const EN_STOP = new Set(['a', 'an', 'the']);

function normalizeEnWords(s: string, dropParens: boolean): string[] {
  const lower = foldWidth(s).toLowerCase();
  const words = (dropParens ? lower.replace(RE_EN_PAREN, ' ') : lower)
    .replace(RE_EN_NONWORD, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !EN_STOP.has(w));
  if (words[0] === 'to' && words.length > 1) words.shift();
  return words;
}

/**
 * Lowercase, parentheticals and punctuation removed, articles and a leading "to"
 * stripped. A gloss that is only a parenthetical ("(topic marker)") keeps its words.
 */
export function normalizeEn(s: string): string {
  const words = normalizeEnWords(s, true);
  return (words.length > 0 ? words : normalizeEnWords(s, false)).join(' ');
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Morae                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const SMALL_FOLLOWERS = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゎ', 'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ']);

/** Splits kana into morae: きゃ = 1, っ = 1, ん = 1, ー = 1; a leading small kana is its own mora. */
export function moraSplit(kana: string): string[] {
  const out: string[] = [];
  for (const ch of kana) {
    if (SMALL_FOLLOWERS.has(ch) && out.length > 0) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** Mora count (for pitch nucleus bounds and the shadow checklist). */
export function moraCount(kana: string): number {
  return moraSplit(kana).length;
}

/** Characters that are written but never spoken: punctuation, brackets, the ellipsis, the wave dash and whitespace. */
export const RE_NOT_MORA = /[、。！？「」『』〜…・\s　]/gu;

/**
 * The SPOKEN morae of a kana line: `moraSplit` of the kana with `RE_NOT_MORA`
 * removed. One body for the clip cues' `m` / `c` indexes (design 08 §7), the
 * validator's line-length rule, the planner's `StepParams.clause` and the
 * drills' clause cut — all index speech morae, never written characters.
 */
export function speechMorae(kana: string): string[] {
  return moraSplit(kana.replace(RE_NOT_MORA, ''));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Distance and similarity                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function lev<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] as number;
}

/** Levenshtein distance over code points (strings) or elements (arrays). */
export function levenshtein(a: string | readonly string[], b: string | readonly string[]): number {
  const aa = typeof a === 'string' ? Array.from(a) : a;
  const bb = typeof b === 'string' ? Array.from(b) : b;
  return lev(aa, bb);
}

/** 1 − mora edit distance / longer length, on katakana-folded, punctuation-free input. */
export function moraSimilarity(a: string, b: string): number {
  const ma = moraSplit(normalizeJa(a, { foldKatakana: true }));
  const mb = moraSplit(normalizeJa(b, { foldKatakana: true }));
  const n = Math.max(ma.length, mb.length);
  if (n === 0) return 1;
  return 1 - lev(ma, mb) / n;
}

const SMALL_TO_BIG: Record<string, string> = {
  っ: 'つ',
  ゃ: 'や',
  ゅ: 'ゆ',
  ょ: 'よ',
  ぁ: 'あ',
  ぃ: 'い',
  ぅ: 'う',
  ぇ: 'え',
  ぉ: 'お',
  ゎ: 'わ',
};

function bigSmall(s: string): string {
  let out = '';
  for (const ch of s) out += SMALL_TO_BIG[ch] ?? ch;
  return out;
}

/** Collapses every long vowel so きって/きて-style differences stay but length slips vanish. */
function foldLong(hira: string): string {
  const expanded = expandLongVowelMark(hira).replace(RE_OU, '$1お').replace(RE_EI, '$1え');
  let out = '';
  for (const ch of expanded) {
    const prev = out.length ? (out[out.length - 1] as string) : '';
    if (prev && 'あいうえお'.includes(ch) && VOWEL_OF[prev] === ch) continue;
    out += ch;
  }
  return out;
}

export type NearMissKind = 'small-kana' | 'vowel-length' | 'transcription';

/**
 * Classifies a wrong-but-close answer (design 04 §0 "Block"):
 *  small-kana    っ/つ, ゃ/や … swapped, or a small っ dropped/added (きて ↔ きって)
 *  vowel-length  a long vowel too short or too long (とうきょう ↔ ときょう, おばさん ↔ おばあさん)
 *  transcription Levenshtein ≤ 1 on an expected answer of ≥ 5 characters
 * Returns `null` for a match (incl. `normalizeAnswer` equivalents) or a plain miss.
 */
export function nearMissKind(given: string, expected: string): NearMissKind | null {
  const g = normalizeJa(given, { foldKatakana: true });
  const e = normalizeJa(expected, { foldKatakana: true });
  if (g.length === 0 || g === e || normalizeAnswer(g) === normalizeAnswer(e)) return null;
  if (bigSmall(g) === bigSmall(e)) return 'small-kana';
  if (g.replace(/っ/g, '') === e.replace(/っ/g, '')) return 'small-kana';
  if (foldLong(g) === foldLong(e)) return 'vowel-length';
  if (e.length >= 5 && lev(Array.from(g), Array.from(e)) <= 1) return 'transcription';
  return null;
}

/**
 * English fuzzy match (design 04 §2): articles and a leading "to" stripped;
 * exact, or Levenshtein ≤ 1 for ≥ 5 chars, ≤ 2 for ≥ 9 chars, against any accepted gloss.
 */
export function fuzzyEn(given: string, accept: readonly string[]): boolean {
  const g = normalizeEn(given);
  if (g.length === 0) return false;
  for (const a of accept) {
    const n = normalizeEn(a);
    if (n.length === 0) continue;
    if (g === n) return true;
    const d = lev(Array.from(g), Array.from(n));
    if (n.length >= 9 && d <= 2) return true;
    if (n.length >= 5 && d <= 1) return true;
  }
  return false;
}

/**
 * Character diff for the Feedback panel: `[char, 0]` matches, `[char, 1]` is
 * extra/wrong in `given`, `[char, 2]` is missing from `given` (present in `expected`).
 */
export function diffChars(given: string, expected: string): [string, 0 | 1 | 2][] {
  const a = Array.from(given);
  const b = Array.from(expected);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: [string, 0 | 1 | 2][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([a[i] as string, 0]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push([a[i] as string, 1]);
      i++;
    } else {
      out.push([b[j] as string, 2]);
      j++;
    }
  }
  while (i < n) out.push([a[i++] as string, 1]);
  while (j < m) out.push([b[j++] as string, 2]);
  return out;
}

/** `s` cut to at most `max` Unicode code points (surrogate pairs never split); the input itself when already within the cap. */
export function clampGlyphs(s: string, max: number): string {
  const glyphs = Array.from(s);
  return glyphs.length > max ? glyphs.slice(0, max).join('') : s;
}
