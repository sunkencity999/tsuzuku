/**
 * TSUZUKU — WallpaperData: what the kakejiku know about the learner.
 *
 *  wallpaperData(overrides?, sources?)  gathers from the store + content
 *                                       loader (names of mastered items via
 *                                       `content.get`, loading the missing
 *                                       files once), sorted deterministically
 *  sampleData(seed, overrides?)         a full, deterministic fixture for
 *                                       tests, gallery previews and the
 *                                       generators' snapshot tests
 *  validateData / isWallpaperData /     field validators and a normaliser
 *  normalizeData                        that fills defaults and clamps
 *
 * "Mastered" = item belt Brown or Black (`learn/item-belt`). Lists are sorted
 * by base-facet stability (strongest first), ties by id, so the same save
 * always yields the same picture.
 *
 * Learner text: `nameKana` (or the display name it falls back to) is cut to
 * `NAME_MAX_GLYPHS` and every sentence to `SENTENCE_MAX_GLYPHS` in
 * `normalizeData`, so an imported save can never hand a generator more than
 * its boxes were drawn for. Writing Dojo pieces are read back from the
 * `作文: ` bookmarks (`shared/writing`) and a perfect dictation from
 * `profile.dictatedSentence`; the Studio's overrides still win
 * (review round 2, contract #15/#28).
 */
import { BELT_ORDER, baseFacet, groupByItem, itemBelt, kindOfCards } from '@/learn';
import { content as defaultContent, type ContentLoader } from '../../content/loader';
import {
  BELT_IDS,
  DRILL_IDS,
  type Belt,
  type ContentItem,
  type Facet,
  type GrammarItem,
  type KanaItem,
  type KanjiItem,
  type VocabItem,
} from '../../content/types';
import { BADGE_IDS, type BadgeId } from '../../shared/catalog';
import { mulberry32, range, uniform } from '../../shared/hash';
import { parseCardKey } from '../../shared/ids';
import { clampGlyphs, isKatakana } from '../../shared/jp';
import { LEDGER_KINDS, NAME_MAX_GLYPHS, type CardTuple, type EpochDay, type ItemKind, type LedgerEntry, type Store } from '../../shared/store-types';
import { epochDay, monthKey } from '../../shared/time';
import { writingSentencesFrom } from '../../shared/writing';
import { store as defaultStore } from '../../store';
import type { MasteredVocab, WallpaperData } from './spec';

/* ────────────────────────────────────────────────────────────────────────── */
/* Gathering                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DataSources {
  store?: Store;
  content?: ContentLoader;
  /** Defaults to `store.today()`. */
  today?: EpochDay;
}

interface Mastered {
  itemId: string;
  kind: ItemKind;
  stability: number;
  reviews: number;
}

const BROWN_RANK = BELT_ORDER.indexOf('brown');
const ARC: [number, number] = [25, 46];
const GOJUON_IDX = DRILL_IDS.indexOf('gojuon-fighter');

function byStability(a: Mastered, b: Mastered): number {
  return b.stability - a.stability || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
}

function isKatakanaWord(v: VocabItem): boolean {
  return v.tags.includes('loanword') || (v.word.length > 0 && isKatakana(v.word.replace(/[ー・]/g, '') || v.word));
}

/** Items whose belt is Brown or Black, grouped by kind and sorted strongest first. */
export function masteredItems(cards: Store['cards']): Record<ItemKind, Mastered[]> {
  const out: Record<ItemKind, Mastered[]> = { kana: [], vocab: [], kanji: [], grammar: [], component: [], chunk: [] };
  for (const [itemId, facets] of groupByItem(cards)) {
    const kind = kindOfCards(itemId, Object.keys(facets) as Facet[]);
    if (!kind) continue;
    const belt = itemBelt(kind, facets);
    if (BELT_ORDER.indexOf(belt) < BROWN_RANK) continue;
    const base = facets[baseFacet(kind)];
    let reviews = 0;
    for (const f of Object.values(facets) as (CardTuple | undefined)[]) if (f) reviews += f[3];
    out[kind].push({ itemId, kind, stability: base ? base[1] : 0, reviews });
  }
  for (const k of Object.keys(out) as ItemKind[]) out[k].sort(byStability);
  return out;
}

async function ensureLoaded(c: ContentLoader, ids: string[]): Promise<void> {
  const missing = ids.filter((id) => c.get(id) === undefined);
  if (missing.length === 0) return;
  try {
    await c.load(missing);
  } catch {
    /* offline or incomplete corpus: unresolved ids are skipped below */
  }
}

/** Index of `'listen'` in `LEDGER_KINDS` — the ledger row's kind slot (`LedgerEntry[2]`). */
const LISTEN_KIND = LEDGER_KINDS.indexOf('listen');

/**
 * Hours of `listen` rows in the Input Ledger, dojo rows (`source: app`) and outside rows alike
 * (design 08 §11: one chōchin per 10 h on 茶屋の灯). Mirrors `store/badge-defs ledgerHoursOf(m).listen`,
 * which the art tier may not import (contract tier only); compacted `ledger.monthly` rows carry no kind
 * and are not counted, exactly as there.
 */
export function listenHoursFrom(entries: readonly LedgerEntry[]): number {
  let minutes = 0;
  for (const e of entries) if (e[2] === LISTEN_KIND) minutes += e[1];
  return minutes / 60;
}

/** Gather everything the generators personalise with; `overrides` win (the Studio's sentence of choice, chosen kanji…). */
export async function wallpaperData(overrides: Partial<WallpaperData> = {}, src: DataSources = {}): Promise<WallpaperData> {
  const s = src.store ?? defaultStore;
  const c = src.content ?? defaultContent;
  const meta = s.meta();
  const today = src.today ?? s.today();
  const tz = meta.profile.tz;

  const mastered = masteredItems(s.cards);
  const vocabLike = [...mastered.vocab, ...mastered.chunk].sort(byStability);
  const wanted = [...mastered.kana, ...mastered.kanji, ...vocabLike, ...mastered.grammar].map((m) => m.itemId);
  await ensureLoaded(c, wanted);

  const kana: string[] = [];
  for (const m of mastered.kana) {
    const it = c.get<KanaItem>(m.itemId);
    if (it?.kana) kana.push(it.kana);
  }
  const kanji: string[] = [];
  for (const m of mastered.kanji) {
    const it = c.get<KanjiItem>(m.itemId);
    if (it?.char) kanji.push(it.char);
  }
  const vocab: MasteredVocab[] = [];
  const katakanaBrown: string[] = [];
  for (const m of vocabLike) {
    const it = c.get<VocabItem>(m.itemId);
    if (!it?.word) continue;
    vocab.push({ word: it.word, kana: it.kana, reviews: m.reviews });
    if (isKatakanaWord(it)) katakanaBrown.push(it.word);
  }
  const grammarBrown: string[] = [];
  const arcGrammar: string[] = [];
  for (const m of mastered.grammar) {
    const it = c.get<GrammarItem>(m.itemId);
    if (!it?.pattern) continue;
    grammarBrown.push(it.pattern);
    const station = it.station ?? c.stationOf(m.itemId);
    if (station !== undefined && station >= ARC[0] && station <= ARC[1]) arcGrammar.push(it.pattern);
  }

  const badgesInOrder = (Object.entries(meta.collections.badges) as [BadgeId, EpochDay | undefined][])
    .filter((e): e is [BadgeId, EpochDay] => typeof e[1] === 'number')
    .sort((a, b) => a[1] - b[1] || BADGE_IDS.indexOf(a[0]) - BADGE_IDS.indexOf(b[0]))
    .map((e) => e[0]);
  const stamps = Object.keys(meta.collections.stamps)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const minutes90: number[] = [];
  for (let d = today - 89; d <= today; d++) minutes90.push(Math.max(0, meta.daily[d]?.minutes ?? 0));

  // Gojūon Fighter reaction times (best per kana) and words first met this month, both from the review log.
  const log = s.log.recent(5000);
  const gojuonMs: Record<string, number> = {};
  const firstSeen = new Map<string, number>();
  for (const e of log) {
    const { itemId } = parseCardKey(e[1]);
    if (e[4] === GOJUON_IDX && itemId.startsWith('k-')) {
      const it = c.get<KanaItem>(itemId);
      if (it?.kana && e[3] > 0) gojuonMs[it.kana] = Math.min(gojuonMs[it.kana] ?? Infinity, e[3]);
    }
    if (itemId.startsWith('v-')) {
      const prev = firstSeen.get(itemId);
      if (prev === undefined || e[0] < prev) firstSeen.set(itemId, e[0]);
    }
  }
  const thisMonth = monthKey(today);
  let wordsThisMonth = 0;
  for (const t of firstSeen.values()) if (monthKey(epochDay(t, tz)) === thisMonth) wordsThisMonth++;

  const gathered: WallpaperData = {
    nameKana: meta.profile.nameKana || meta.profile.name,
    chosenKanji: meta.profile.chosenKanji,
    belt: meta.profile.belt,
    streak: Math.max(meta.streak.longest, meta.streak.current),
    totalDays: meta.streak.totalDays,
    level: meta.profile.level,
    xp: meta.profile.xp,
    mastered: { kana, kanji, vocab },
    grammarBrown,
    katakanaBrown,
    badgesInOrder,
    stamps,
    station: meta.progress.station,
    minutes90,
    // Writing Dojo pieces live under `作文: ` bookmarks (shared/writing); a perfect dictation sits on the profile. Overrides still win.
    writingSentences: writingSentencesFrom(meta.bookmarks),
    dictatedSentence: meta.profile.dictatedSentence,
    gojuonMs,
    rapidBest: meta.stats.rapidBest,
    freezes: meta.streak.freezes,
    restDays: meta.streak.restDaysTaken,
    wordsThisMonth,
    // design 08 §11: the ledger's listen hours light the teahouse lanterns (茶屋の灯).
    listenHours: listenHoursFrom(meta.ledger.entries),
    arcGrammar,
    sentenceOfChoice: undefined,
    date: today,
  };
  return normalizeData({ ...gathered, ...stripUndefined(overrides) });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sample data                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const SAMPLE_HIRAGANA = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん');
const SAMPLE_KANJI = Array.from('日本人月火水木金土山川田口目耳手足空雨電車駅学校先生友語言読書食飲見聞話歩走買売高安新古大小多少長短明暗朝昼夜今年時間週曜');
const SAMPLE_VOCAB: [string, string][] = [
  ['私', 'わたし'], ['犬', 'いぬ'], ['水', 'みず'], ['食べる', 'たべる'], ['飲む', 'のむ'], ['人', 'ひと'], ['日', 'ひ'], ['おいしい', 'おいしい'],
  ['学校', 'がっこう'], ['先生', 'せんせい'], ['友達', 'ともだち'], ['電車', 'でんしゃ'], ['駅', 'えき'], ['時間', 'じかん'], ['毎日', 'まいにち'], ['朝', 'あさ'],
  ['雨', 'あめ'], ['山', 'やま'], ['川', 'かわ'], ['本', 'ほん'], ['読む', 'よむ'], ['書く', 'かく'], ['聞く', 'きく'], ['話す', 'はなす'],
  ['見る', 'みる'], ['行く', 'いく'], ['来る', 'くる'], ['帰る', 'かえる'], ['大きい', 'おおきい'], ['小さい', 'ちいさい'], ['新しい', 'あたらしい'], ['古い', 'ふるい'],
  ['コーヒー', 'コーヒー'], ['パン', 'パン'], ['テレビ', 'テレビ'], ['バス', 'バス'], ['ホテル', 'ホテル'], ['カメラ', 'カメラ'], ['レストラン', 'レストラン'], ['ノート', 'ノート'],
];
const SAMPLE_GRAMMAR = ['〜です', '〜は', '〜ます', '〜ません', '〜ました', '〜てください', '〜たい', '〜ている', '〜から', '〜けど', '〜たことがある', '〜ながら', '〜ば', '〜たら', '〜なら', '〜ようにする', '〜ことにする', '〜わけだ', '〜はずだ', '〜べきだ'];
const SAMPLE_SENTENCES = [
  '毎朝、駅まで歩きます。',
  '雨の日は本を読むのが好きです。',
  '友達と新しいレストランに行きました。',
  '日本語の勉強は毎日続けています。',
  '週末に山へ行こうと思っています。',
  '先生の話を聞いてから質問しました。',
];

/**
 * A complete, deterministic `WallpaperData` for tests and previews: list
 * lengths are fixed, numbers are seeded. `overrides` win field by field.
 */
export function sampleData(seed: number, overrides: Partial<WallpaperData> = {}): WallpaperData {
  const rng = mulberry32(seed >>> 0);
  const gojuonMs: Record<string, number> = {};
  for (const k of SAMPLE_HIRAGANA) gojuonMs[k] = range(rng, 380, 1400);
  const vocab: MasteredVocab[] = SAMPLE_VOCAB.map(([word, kana]) => ({ word, kana, reviews: range(rng, 8, 120) }));
  vocab.sort((a, b) => b.reviews - a.reviews || (a.word < b.word ? -1 : 1));
  const minutes90: number[] = [];
  for (let i = 0; i < 90; i++) minutes90.push(rng() < 0.12 ? 0 : Math.round(uniform(rng, 8, 48)));
  const totalDays = range(rng, 120, 420);
  const base: WallpaperData = {
    nameKana: 'ハナ',
    chosenKanji: '続',
    belt: 'green',
    streak: range(rng, 30, 120),
    totalDays,
    level: range(rng, 12, 40),
    xp: range(rng, 20_000, 90_000),
    mastered: { kana: SAMPLE_HIRAGANA.slice(), kanji: SAMPLE_KANJI.slice(), vocab },
    grammarBrown: SAMPLE_GRAMMAR.slice(),
    katakanaBrown: SAMPLE_VOCAB.filter(([w]) => isKatakana(w)).map(([w]) => w),
    badgesInOrder: BADGE_IDS.slice(0, range(rng, 6, 20)),
    stamps: Array.from({ length: range(rng, 4, 16) }, (_, i) => i + 1),
    station: range(rng, 5, 17),
    minutes90,
    writingSentences: SAMPLE_SENTENCES.slice(),
    dictatedSentence: SAMPLE_SENTENCES[0],
    gojuonMs,
    rapidBest: range(rng, 20, 60),
    freezes: range(rng, 0, 3),
    restDays: range(rng, 0, 12),
    wordsThisMonth: range(rng, 10, 60),
    arcGrammar: SAMPLE_GRAMMAR.slice(10, 16),
    // 0 keeps every existing kakejiku snapshot (the rng sequence is untouched); the chaya-lanterns tests set their own hours.
    listenHours: 0,
    sentenceOfChoice: SAMPLE_SENTENCES[3],
    date: 20_470 + range(rng, 0, 365), // 2026-01-… onward
  };
  return normalizeData({ ...base, ...stripUndefined(overrides) });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Validation                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function isStrList(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === 'string');
}
function isNonNeg(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/** Glyph cap for every learner sentence a kakejiku may set (sentence of choice, dictation, Writing Dojo strips); the store itself allows 500. */
export const SENTENCE_MAX_GLYPHS = 96;

/** Trimmed text cut to `max` glyphs (code points, so a surrogate pair is never split), or undefined when nothing is left. */
function cappedText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = clampGlyphs(v.trim(), max).trim();
  return t || undefined;
}

/** Problems with a candidate `WallpaperData` (empty when valid). */
export function validateData(d: unknown): string[] {
  const out: string[] = [];
  if (typeof d !== 'object' || d === null) return ['not an object'];
  const x = d as Record<string, unknown>;
  if (typeof x.nameKana !== 'string') out.push('nameKana: string required');
  if (x.chosenKanji !== undefined && (typeof x.chosenKanji !== 'string' || Array.from(x.chosenKanji).length !== 1)) out.push('chosenKanji: one glyph or undefined');
  if (!(BELT_IDS as readonly string[]).includes(x.belt as string)) out.push('belt: not a Belt');
  for (const k of ['streak', 'totalDays', 'level', 'xp', 'station', 'rapidBest', 'freezes', 'restDays', 'wordsThisMonth'] as const) {
    if (!isNonNeg(x[k])) out.push(`${k}: non-negative number required`);
  }
  if (typeof x.station === 'number' && (x.station > 53 || !Number.isInteger(x.station))) out.push('station: integer 0–53');
  const m = x.mastered as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object') out.push('mastered: object required');
  else {
    if (!isStrList(m.kana)) out.push('mastered.kana: string[]');
    if (!isStrList(m.kanji)) out.push('mastered.kanji: string[]');
    if (!Array.isArray(m.vocab) || !m.vocab.every((v) => v && typeof v === 'object' && typeof (v as MasteredVocab).word === 'string' && typeof (v as MasteredVocab).kana === 'string' && isNonNeg((v as MasteredVocab).reviews)))
      out.push('mastered.vocab: {word,kana,reviews}[]');
  }
  for (const k of ['grammarBrown', 'katakanaBrown', 'writingSentences', 'arcGrammar'] as const) if (!isStrList(x[k])) out.push(`${k}: string[]`);
  if (!Array.isArray(x.badgesInOrder) || !x.badgesInOrder.every((b) => (BADGE_IDS as readonly string[]).includes(b as string))) out.push('badgesInOrder: BadgeId[]');
  if (!Array.isArray(x.stamps) || !x.stamps.every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 53)) out.push('stamps: station numbers 1–53');
  if (!Array.isArray(x.minutes90) || x.minutes90.length !== 90 || !x.minutes90.every(isNonNeg)) out.push('minutes90: exactly 90 non-negative numbers');
  if (x.dictatedSentence !== undefined && typeof x.dictatedSentence !== 'string') out.push('dictatedSentence: string or undefined');
  if (x.sentenceOfChoice !== undefined && typeof x.sentenceOfChoice !== 'string') out.push('sentenceOfChoice: string or undefined');
  if (typeof x.gojuonMs !== 'object' || x.gojuonMs === null || !Object.values(x.gojuonMs as Record<string, unknown>).every(isNonNeg)) out.push('gojuonMs: Record<string, ms>');
  if (x.listenHours !== undefined && !isNonNeg(x.listenHours)) out.push('listenHours: non-negative hours');
  if (!isNonNeg(x.date)) out.push('date: EpochDay required');
  return out;
}

export function isWallpaperData(d: unknown): d is WallpaperData {
  return validateData(d).length === 0;
}

/** Fill defaults, clamp ranges and text lengths (`NAME_MAX_GLYPHS`, `SENTENCE_MAX_GLYPHS`), trim lists; never throws. */
export function normalizeData(p: Partial<WallpaperData>): WallpaperData {
  const num = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : dflt);
  const strs = (v: unknown): string[] => (isStrList(v) ? v.filter((s) => s.length > 0) : []);
  const minutes = Array.isArray(p.minutes90) ? p.minutes90.map((v) => num(v)) : [];
  while (minutes.length < 90) minutes.unshift(0);
  const belt: Belt = (BELT_IDS as readonly string[]).includes(p.belt as string) ? (p.belt as Belt) : 'white';
  const chosen = typeof p.chosenKanji === 'string' && Array.from(p.chosenKanji).length === 1 ? p.chosenKanji : undefined;
  const vocab = Array.isArray(p.mastered?.vocab)
    ? p.mastered!.vocab.filter((v) => v && typeof v.word === 'string' && v.word.length > 0).map((v) => ({ word: v.word, kana: typeof v.kana === 'string' ? v.kana : v.word, reviews: num(v.reviews) }))
    : [];
  const gojuonMs: Record<string, number> = {};
  if (p.gojuonMs && typeof p.gojuonMs === 'object') for (const [k, v] of Object.entries(p.gojuonMs)) if (isNonNeg(v) && k) gojuonMs[k] = v;
  const name = cappedText(p.nameKana, NAME_MAX_GLYPHS) ?? '';
  const sentences = (v: unknown): string[] => (isStrList(v) ? v.map((s) => cappedText(s, SENTENCE_MAX_GLYPHS)).filter((s): s is string => s !== undefined) : []);
  return {
    nameKana: name || '無名',
    chosenKanji: chosen,
    belt,
    streak: Math.floor(num(p.streak)),
    totalDays: Math.floor(num(p.totalDays)),
    level: Math.floor(num(p.level)),
    xp: Math.floor(num(p.xp)),
    mastered: { kana: strs(p.mastered?.kana), kanji: strs(p.mastered?.kanji), vocab },
    grammarBrown: strs(p.grammarBrown),
    katakanaBrown: strs(p.katakanaBrown),
    badgesInOrder: Array.isArray(p.badgesInOrder) ? p.badgesInOrder.filter((b): b is BadgeId => (BADGE_IDS as readonly string[]).includes(b)) : [],
    stamps: Array.isArray(p.stamps) ? Array.from(new Set(p.stamps.filter((n) => Number.isInteger(n) && n >= 1 && n <= 53))).sort((a, b) => a - b) : [],
    station: Math.min(53, Math.floor(num(p.station))),
    minutes90: minutes.slice(-90),
    writingSentences: sentences(p.writingSentences),
    dictatedSentence: cappedText(p.dictatedSentence, SENTENCE_MAX_GLYPHS),
    gojuonMs,
    rapidBest: Math.floor(num(p.rapidBest)),
    freezes: Math.floor(num(p.freezes)),
    restDays: Math.floor(num(p.restDays)),
    wordsThisMonth: Math.floor(num(p.wordsThisMonth)),
    arcGrammar: strs(p.arcGrammar),
    sentenceOfChoice: cappedText(p.sentenceOfChoice, SENTENCE_MAX_GLYPHS),
    listenHours: num(p.listenHours),
    date: Math.floor(num(p.date)),
  };
}

/** Narrow a loaded item to the kind a generator expects (helper for authors who look items up themselves). */
export function itemAs<T extends ContentItem>(c: ContentLoader, id: string): T | undefined {
  return c.get<T>(id);
}
