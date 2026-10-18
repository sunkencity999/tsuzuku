/**
 * TSUZUKU — generated kana tracks for Stations 1–3 (design 08 §10.5, docs/AUDIO_PACK.md §3.3).
 *
 * Stations 1–3 have no pieces and no chant StoryItems (V04 / V14 / V34 forbid
 * them), so the render script GENERATES the White belt's listening from the
 * `KanaItem` rows: gojūon row walks per script, base ↔ dakuten / handakuten
 * pairs, long-vowel / っ minimal pairs (both words in ONE voice at ONE rate, so
 * timbre never leaks the answer), counting 1–10, greetings, and the 238
 * `exampleWord`s grouped by row. Every track is ハナ's voice (九州そら) at rate 1;
 * Radio plays them at Stations 1–3 with the 140 White story lines.
 *
 * A track is a list of segments; each segment is one engine clip (its `text`
 * goes through `textToSpeak(text, kana)` like every other clip, so a short
 * word is handed as its kana). Segments that duplicate an item clip carry the
 * item's clip key (`k-h-a#ex0`), so the same clip id is rendered once and only
 * re-encoded into the track sprite. Pure: no I/O.
 */
import type { KanaItem, KanaRow, KanaScript, KanaType } from '../../src/content/types.ts';

export type KanaTrackKind = 'row' | 'pairs' | 'pair' | 'counting' | 'greetings' | 'words';

export interface TrackSegment {
  /** What the engine is handed (before `textToSpeak`). */
  text: string;
  /** Kana reading the clip is verified against. */
  kana: string;
  /** English gloss (shown beside the Japanese in the Radio transcript). */
  en?: string;
  /** Clip key of the item clip this segment duplicates (`k-h-a`, `k-h-a#ex0`). */
  clip?: string;
}

export interface KanaTrackSpec {
  /** `row-h-k`, `pairs-h-kg`, `pair-03`, `counting`, `greetings`, `words-k-s` — the sprite base name and `track:<name>` key. */
  name: string;
  kind: KanaTrackKind;
  /** Japanese title (Radio / Media Session). */
  title: string;
  /** English title beside it (the learner starts with zero Japanese). */
  titleEn: string;
  segments: TrackSegment[];
  /** Cast label of the voice; every kana track is ハナ. */
  voice: 'ハナ';
  rate: 1;
}

export const KANA_TRACK_VOICE = 'ハナ';

const SCRIPT_CODE: Record<KanaScript, 'h' | 'k'> = { hiragana: 'h', katakana: 'k' };
const SCRIPT_EN: Record<KanaScript, string> = { hiragana: 'hiragana', katakana: 'katakana' };

const ROW_JA: Record<KanaRow, string> = {
  a: 'あ行',
  k: 'か行',
  g: 'が行',
  s: 'さ行',
  z: 'ざ行',
  t: 'た行',
  d: 'だ行',
  n: 'な行',
  h: 'は行',
  b: 'ば行',
  p: 'ぱ行',
  m: 'ま行',
  y: 'や行',
  r: 'ら行',
  w: 'わ行',
  nn: 'ん',
  ext: 'ファ・ティ・ヴ',
};
const ROW_EN: Record<KanaRow, string> = {
  a: 'the vowel row',
  k: 'the k-row',
  g: 'the g-row',
  s: 'the s-row',
  z: 'the z-row',
  t: 'the t-row',
  d: 'the d-row',
  n: 'the n-row',
  h: 'the h-row',
  b: 'the b-row',
  p: 'the p-row',
  m: 'the m-row',
  y: 'the y-row',
  r: 'the r-row',
  w: 'the w-row',
  nn: 'the syllabic n',
  ext: 'extended katakana',
};

/** Base row of a voiced / semi-voiced row (か↔が, さ↔ざ, た↔だ, は↔ば, は↔ぱ). */
export const DAKUTEN_BASE: Partial<Record<KanaRow, KanaRow>> = { g: 'k', z: 's', d: 't', b: 'h', p: 'h' };

/** 1–10 (both readings where two exist), kana only so the engine reads nothing else into them. */
export const COUNTING: readonly TrackSegment[] = [
  { text: 'いち', kana: 'いち', en: 'one (1)' },
  { text: 'に', kana: 'に', en: 'two (2)' },
  { text: 'さん', kana: 'さん', en: 'three (3)' },
  { text: 'よん', kana: 'よん', en: 'four (4)' },
  { text: 'し', kana: 'し', en: 'four (4), the other reading' },
  { text: 'ご', kana: 'ご', en: 'five (5)' },
  { text: 'ろく', kana: 'ろく', en: 'six (6)' },
  { text: 'なな', kana: 'なな', en: 'seven (7)' },
  { text: 'しち', kana: 'しち', en: 'seven (7), the other reading' },
  { text: 'はち', kana: 'はち', en: 'eight (8)' },
  { text: 'きゅう', kana: 'きゅう', en: 'nine (9)' },
  { text: 'じゅう', kana: 'じゅう', en: 'ten (10)' },
];

export const GREETINGS: readonly TrackSegment[] = [
  { text: 'おはようございます', kana: 'おはようございます', en: 'good morning' },
  { text: 'こんにちは', kana: 'こんにちは', en: 'hello' },
  { text: 'こんばんは', kana: 'こんばんは', en: 'good evening' },
  { text: 'ありがとうございます', kana: 'ありがとうございます', en: 'thank you' },
  { text: 'すみません', kana: 'すみません', en: 'excuse me / sorry' },
  { text: 'はい', kana: 'はい', en: 'yes' },
  { text: 'いいえ', kana: 'いいえ', en: 'no' },
  { text: 'どうぞ', kana: 'どうぞ', en: 'here you are / please' },
  { text: 'おねがいします', kana: 'おねがいします', en: 'please (a request)' },
  { text: 'いただきます', kana: 'いただきます', en: 'said before a meal' },
  { text: 'ごちそうさまでした', kana: 'ごちそうさまでした', en: 'said after a meal' },
  { text: 'おやすみなさい', kana: 'おやすみなさい', en: 'good night' },
  { text: 'さようなら', kana: 'さようなら', en: 'goodbye' },
  { text: 'はじめまして', kana: 'はじめまして', en: 'nice to meet you' },
];

/** Long-vowel and っ minimal pairs (design 08 §10.5): both words, one voice, one rate. */
export const MINIMAL_PAIRS: readonly [a: TrackSegment, b: TrackSegment, titleEn: string][] = [
  [{ text: 'おばさん', kana: 'おばさん', en: 'aunt' }, { text: 'おばあさん', kana: 'おばあさん', en: 'grandmother' }, 'aunt / grandmother — the long あ'],
  [{ text: 'おじさん', kana: 'おじさん', en: 'uncle' }, { text: 'おじいさん', kana: 'おじいさん', en: 'grandfather' }, 'uncle / grandfather — the long い'],
  [{ text: 'きて', kana: 'きて', en: 'come (and…)' }, { text: 'きって', kana: 'きって', en: 'a stamp' }, 'come / stamp — the small っ'],
  [{ text: 'かた', kana: 'かた', en: 'shoulder' }, { text: 'かった', kana: 'かった', en: 'bought' }, 'shoulder / bought — the small っ'],
  [{ text: 'さか', kana: 'さか', en: 'slope' }, { text: 'さっか', kana: 'さっか', en: 'author' }, 'slope / author — the small っ'],
  [{ text: 'おと', kana: 'おと', en: 'sound' }, { text: 'おっと', kana: 'おっと', en: 'husband' }, 'sound / husband — the small っ'],
  [{ text: 'まち', kana: 'まち', en: 'town' }, { text: 'まっち', kana: 'まっち', en: 'a match' }, 'town / match — the small っ'],
  [{ text: 'ゆき', kana: 'ゆき', en: 'snow' }, { text: 'ゆうき', kana: 'ゆうき', en: 'courage' }, 'snow / courage — the long う'],
  [{ text: 'とる', kana: 'とる', en: 'to take' }, { text: 'とおる', kana: 'とおる', en: 'to pass through' }, 'take / pass through — the long お'],
  [{ text: 'いえ', kana: 'いえ', en: 'house' }, { text: 'いいえ', kana: 'いいえ', en: 'no' }, 'house / no — the long い'],
  [{ text: 'しゅじん', kana: 'しゅじん', en: 'husband' }, { text: 'しゅうじん', kana: 'しゅうじん', en: 'prisoner' }, 'husband / prisoner — the long う'],
  [{ text: 'びょういん', kana: 'びょういん', en: 'hospital' }, { text: 'びよういん', kana: 'びよういん', en: 'beauty salon' }, 'hospital / beauty salon — small ょ or big よ'],
  [{ text: 'きて', kana: 'きて', en: 'come (and…)' }, { text: 'きいて', kana: 'きいて', en: 'listen (and…)' }, 'come / listen — the long い'],
  [{ text: 'ここ', kana: 'ここ', en: 'here' }, { text: 'こうこう', kana: 'こうこう', en: 'high school' }, 'here / high school — two long お'],
];

interface Group {
  script: KanaScript;
  row: KanaRow;
  type: KanaType;
  items: KanaItem[];
}

/** Rows in file order, grouped by (script, row, type). */
function groups(items: readonly KanaItem[]): Group[] {
  const out: Group[] = [];
  const idx = new Map<string, Group>();
  for (const it of items) {
    const key = `${it.script}|${it.row}|${it.type}`;
    let g = idx.get(key);
    if (!g) {
      g = { script: it.script, row: it.row, type: it.type, items: [] };
      idx.set(key, g);
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

const suffix = (type: KanaType): string => (type === 'yoon' ? '-yoon' : '');
const joinKana = (items: readonly KanaItem[]): string => items.map((i) => i.kana).join('・');
const joinRomaji = (items: readonly KanaItem[]): string => items.map((i) => i.romaji).join(' ');

/** Every kana track for the given rows (design 08 §10.5); deterministic order. */
export function kanaTracks(items: readonly KanaItem[]): KanaTrackSpec[] {
  const out: KanaTrackSpec[] = [];
  const gs = groups(items);
  const byKey = new Map<string, Group>(gs.map((g) => [`${g.script}|${g.row}|${g.type}`, g]));

  // 1. Row walks.
  for (const g of gs) {
    const code = SCRIPT_CODE[g.script];
    const title = g.type === 'yoon' || g.row === 'ext' ? joinKana(g.items) : ROW_JA[g.row];
    out.push({
      name: `row-${code}-${g.row}${suffix(g.type)}`,
      kind: 'row',
      title,
      titleEn: `${ROW_EN[g.row]}${g.type === 'yoon' ? ' with small ya yu yo' : ''} (${SCRIPT_EN[g.script]}): ${joinRomaji(g.items)}`,
      segments: g.items.map((i) => ({ text: i.kana, kana: i.kana, en: i.romaji, clip: i.id })),
      voice: 'ハナ',
      rate: 1,
    });
  }

  // 2. Base ↔ dakuten / handakuten pairs, by position inside the row.
  for (const g of gs) {
    const base = DAKUTEN_BASE[g.row];
    if (!base) continue;
    const baseGroup = byKey.get(`${g.script}|${base}|${g.type === 'yoon' ? 'yoon' : 'basic'}`);
    if (!baseGroup) continue;
    const code = SCRIPT_CODE[g.script];
    const segments: TrackSegment[] = [];
    g.items.forEach((dak, i) => {
      const b = baseGroup.items[i];
      if (!b) return;
      segments.push({ text: b.kana, kana: b.kana, en: b.romaji, clip: b.id }, { text: dak.kana, kana: dak.kana, en: dak.romaji, clip: dak.id });
    });
    if (segments.length === 0) continue;
    out.push({
      name: `pairs-${code}-${base}${g.row}${suffix(g.type)}`,
      kind: 'pairs',
      title: `${(baseGroup.items[0] as KanaItem).kana}・${(g.items[0] as KanaItem).kana}`,
      titleEn: `${ROW_EN[base]} and ${ROW_EN[g.row]}${g.type === 'yoon' ? ' with small ya yu yo' : ''} (${SCRIPT_EN[g.script]}): ${g.type === 'handakuten' || g.row === 'p' ? 'the little circle' : 'the two dots'} changes the sound`,
      segments,
      voice: 'ハナ',
      rate: 1,
    });
  }

  // 3. Minimal pairs: long vowels and っ.
  MINIMAL_PAIRS.forEach(([a, b, titleEn], i) => {
    out.push({
      name: `pair-${String(i + 1).padStart(2, '0')}`,
      kind: 'pair',
      title: `${a.kana}・${b.kana}`,
      titleEn,
      segments: [a, b],
      voice: 'ハナ',
      rate: 1,
    });
  });

  // 4. Counting and greetings.
  out.push({ name: 'counting', kind: 'counting', title: '一から十まで', titleEn: 'Counting 1 to 10', segments: [...COUNTING], voice: 'ハナ', rate: 1 });
  out.push({ name: 'greetings', kind: 'greetings', title: 'あいさつ', titleEn: 'Greetings', segments: [...GREETINGS], voice: 'ハナ', rate: 1 });

  // 5. The example words, one track per row.
  for (const g of gs) {
    const code = SCRIPT_CODE[g.script];
    out.push({
      name: `words-${code}-${g.row}${suffix(g.type)}`,
      kind: 'words',
      title: `${g.type === 'yoon' || g.row === 'ext' ? joinKana(g.items) : ROW_JA[g.row]}のことば`,
      titleEn: `Words with ${ROW_EN[g.row]}${g.type === 'yoon' ? ' (small ya yu yo)' : ''} (${SCRIPT_EN[g.script]})`,
      segments: g.items.map((i) => ({ text: i.exampleWord.word, kana: i.exampleWord.kana, en: i.exampleWord.en, clip: `${i.id}#ex0` })),
      voice: 'ハナ',
      rate: 1,
    });
  }
  return out;
}

export interface TrackCoverage {
  /** Kana (by id) that appear in no row track. */
  kanaMissing: string[];
  /** Dakuten / handakuten kana (by id) that appear in no pairs track beside their base. */
  pairMissing: string[];
  /** Example words (by kana id) that appear in no words track. */
  wordsMissing: string[];
  /** Counting 1–10 glosses missing from the counting track. */
  countingMissing: number[];
}

/** What the generated tracks leave out (the test asserts every list is empty). */
export function trackCoverage(specs: readonly KanaTrackSpec[], items: readonly KanaItem[]): TrackCoverage {
  const inRows = new Set<string>();
  const inPairs = new Set<string>();
  const inWords = new Set<string>();
  const counted = new Set<number>();
  for (const t of specs) {
    for (const s of t.segments) {
      if (t.kind === 'row' && s.clip) inRows.add(s.clip);
      if (t.kind === 'pairs' && s.clip) inPairs.add(s.clip);
      if (t.kind === 'words' && s.clip) inWords.add(s.clip.replace(/#ex0$/, ''));
      if (t.kind === 'counting') {
        const m = /\((\d+)\)/.exec(s.en ?? '');
        if (m) counted.add(Number(m[1]));
      }
    }
  }
  const kanaMissing = items.filter((i) => !inRows.has(i.id)).map((i) => i.id);
  const pairMissing = items.filter((i) => (i.type === 'dakuten' || i.type === 'handakuten') && !inPairs.has(i.id)).map((i) => i.id);
  const wordsMissing = items.filter((i) => !inWords.has(i.id)).map((i) => i.id);
  const countingMissing = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => !counted.has(n));
  return { kanaMissing, pairMissing, wordsMissing, countingMissing };
}
