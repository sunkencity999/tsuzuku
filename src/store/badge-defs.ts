/**
 * TSUZUKU — the 68 Mon (紋) definitions (design 06 §2; 茶屋の常連 and 初耳 from
 * design 08 §11) as data. `BADGE_DEFS` is listed by strand below for reading
 * and exported in `BADGE_IDS` order, so the catalog is the one order.
 *
 * Every condition is deterministic and machine-checkable against the save:
 * `when(m, ev?, cards?)` reads SaveMeta paths, `STAT_KEYS` counters, the
 * ledger hours and — for the kana / grammar sets, which have no counter — the
 * learner's cards through the minimal `CardReader`. `ev` is the triggering
 * bus event; a handful of badges accept the event payload as evidence as
 * well, so they fire even when a counter lags. Streak badges above 30 days
 * key on `streak.totalDays`, never `streak.current` (design 06 §7 #4).
 *
 * This file is re-exported by `src/store/index.ts`, so it never imports the
 * learning core: the item-belt thresholds it needs (Green = base S ≥ 7 d,
 * Brown = base S ≥ 30 d and production S ≥ 7 d; design 02 §4) are restated
 * as constants here.
 */
import { BELT_IDS, type Belt, type CardKey } from '../content/types';
import { BADGE_IDS, type BadgeId, type BadgeTier } from '../shared/catalog';
import type { EventName, Events } from '../shared/events';
import type { CardTuple, SaveMeta } from '../shared/store-types';
import { S } from './defs-strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type BadgeField = 'circle' | 'hexagon' | 'tomoe' | 'square' | 'petal';

/** Dojo shelf categories (design 06 §5: "one slot per category"). */
export type BadgeCategory = 'kana' | 'streak' | 'training' | 'road' | 'belt' | 'input' | 'output' | 'mastery' | 'spirit';
export const BADGE_CATEGORIES: readonly BadgeCategory[] = ['kana', 'streak', 'training', 'road', 'belt', 'input', 'output', 'mastery', 'spirit'];

/** A bus event handed to a condition: `{name, payload}`, discriminated on `name`. */
export type TriggerEvent = { [K in EventName]: { name: K; payload: Events[K] } }[EventName];

/** The slice of the cards API conditions may read (`store.cards` satisfies it). */
export interface CardReader {
  get(k: CardKey): CardTuple | undefined;
  forEach(fn: (k: CardKey, t: CardTuple) => void): void;
}

export interface BadgeDef {
  id: BadgeId;
  nameEn: string;
  nameJa: string;
  /** One kanji (or kana) rendered in the crest. */
  glyph: string;
  field: BadgeField;
  tier: BadgeTier;
  category: BadgeCategory;
  /** Always false: every condition is visible from day one (design 06 §7 #2). */
  hidden: false;
  /** The condition in plain words. */
  describe: string;
  /** Events after which this condition can newly become true (the evaluator's index). */
  events: readonly EventName[];
  when(m: SaveMeta, ev?: TriggerEvent, cards?: CardReader): boolean;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana inventories (docs/CONTENT_GUIDE.md §3: IME-safe id romaji)            */
/* ────────────────────────────────────────────────────────────────────────── */

const BASIC = ['a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'shi', 'su', 'se', 'so', 'ta', 'chi', 'tsu', 'te', 'to', 'na', 'ni', 'nu', 'ne', 'no', 'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo', 'ya', 'yu', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo', 'n'];
const DAKUTEN = ['ga', 'gi', 'gu', 'ge', 'go', 'za', 'ji', 'zu', 'ze', 'zo', 'da', 'di', 'du', 'de', 'do', 'ba', 'bi', 'bu', 'be', 'bo'];
const HANDAKUTEN = ['pa', 'pi', 'pu', 'pe', 'po'];
const YOON = ['kya', 'kyu', 'kyo', 'sha', 'shu', 'sho', 'cha', 'chu', 'cho', 'nya', 'nyu', 'nyo', 'hya', 'hyu', 'hyo', 'mya', 'myu', 'myo', 'rya', 'ryu', 'ryo', 'gya', 'gyu', 'gyo', 'ja', 'ju', 'jo', 'bya', 'byu', 'byo', 'pya', 'pyu', 'pyo'];
const EXTENDED = ['fa', 'fi', 'fe', 'fo', 'fyu', 'va', 'vi', 'vu', 've', 'vo', 'vyu', 'she', 'je', 'che', 'tsa', 'tsi', 'tse', 'tso', 'thi', 'dhi', 'thu', 'dhu', 'twu', 'dwu', 'whi', 'whe', 'who', 'ye', 'kwa', 'kwo'];

function kanaIds(script: 'h' | 'k', romaji: readonly string[]): readonly string[] {
  return romaji.map((r) => `k-${script}-${r}`);
}

/** Item ids of the kana sets the kana badges and `torii-dawn` check. */
export const KANA_SETS = {
  /** 46 basic hiragana. */
  hiraganaBasic: kanaIds('h', BASIC),
  /** 20 dakuten + 5 handakuten + 33 yōon hiragana. */
  hiraganaVoiced: kanaIds('h', [...DAKUTEN, ...HANDAKUTEN, ...YOON]),
  /** All 104 hiragana. */
  hiraganaAll: kanaIds('h', [...BASIC, ...DAKUTEN, ...HANDAKUTEN, ...YOON]),
  /** All 134 katakana, extended set included. */
  katakanaAll: kanaIds('k', [...BASIC, ...DAKUTEN, ...HANDAKUTEN, ...YOON, ...EXTENDED]),
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers (exported for wallpaper-defs and tests)                            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Item-belt thresholds in days of stability (design 02 §4). */
export const GREEN_S = 7;
export const BROWN_BASE_S = 30;
export const BROWN_PROD_S = 7;

function stability(cards: CardReader, key: CardKey): number {
  const t = cards.get(key);
  return t ? t[1] : 0;
}

/** How many of `ids` hold a `rec` card with S ≥ `minS` (archived cards still count). */
export function kanaStable(ids: readonly string[], cards: CardReader | undefined, minS = GREEN_S): { done: number; total: number } {
  if (!cards) return { done: 0, total: ids.length };
  let done = 0;
  for (const id of ids) if (stability(cards, `${id}#rec`) >= minS) done++;
  return { done, total: ids.length };
}

function allKanaGreen(ids: readonly string[], cards: CardReader | undefined): boolean {
  const { done, total } = kanaStable(ids, cards);
  return total > 0 && done === total;
}

/** Brown ("Mastered") from a base card and a production card (design 02 §4). */
export function isBrown(base: CardTuple | undefined, prod: CardTuple | undefined): boolean {
  return !!base && !!prod && base[1] >= BROWN_BASE_S && prod[1] >= BROWN_PROD_S;
}

export interface LedgerHours {
  total: number;
  listen: number;
  read: number;
  watch: number;
  speak: number;
}

/**
 * Hours in the Input Ledger by kind. `ledger.monthly` rows (compacted, kind
 * unknown) count toward `total` only. Mirrors `store/ledger.ts ledgerHours`
 * so the definitions never wait on that module.
 */
export function ledgerHoursOf(m: SaveMeta): LedgerHours {
  const minutes = [0, 0, 0, 0];
  let total = 0;
  for (const e of m.ledger.entries) {
    const k = e[2];
    minutes[k] = (minutes[k] ?? 0) + e[1];
    total += e[1];
  }
  for (const v of Object.values(m.ledger.monthly)) total += v;
  return { total: total / 60, listen: (minutes[0] ?? 0) / 60, read: (minutes[1] ?? 0) / 60, watch: (minutes[2] ?? 0) / 60, speak: (minutes[3] ?? 0) / 60 };
}

/** The longest run the learner has ever held (`longest` is never below `current`). */
export function bestStreak(m: SaveMeta): number {
  return Math.max(m.streak.current, m.streak.longest);
}

function share(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export function beltRankOf(b: Belt): number {
  return BELT_IDS.indexOf(b);
}

/** Every station from `from` to `to` (inclusive) is in `stationsCleared`. */
export function stationsCleared(m: SaveMeta, from: number, to: number): boolean {
  const set = new Set(m.progress.stationsCleared);
  for (let n = from; n <= to; n++) if (!set.has(n)) return false;
  return true;
}

/**
 * 文法家: every N5 + N4 grammar item Mastered. "Every" is read as: Stations
 * 4–24 are all cleared (a Gatekeeper opens only once its station's items are
 * introduced, so all N5/N4 grammar has cards), every `g-n5-*` / `g-n4-*`
 * item with a cloze card is Brown, and at least one exists.
 */
export function grammarianMet(m: SaveMeta, cards: CardReader | undefined): boolean {
  if (!cards || !stationsCleared(m, 4, 24)) return false;
  let seen = 0;
  let failed = false;
  cards.forEach((k, t) => {
    if (failed) return;
    if (!(k.startsWith('g-n5-') || k.startsWith('g-n4-')) || !k.endsWith('#cloze')) return;
    seen++;
    const prod = cards.get(`${k.slice(0, -6)}#prod`);
    if (!isBrown(t, prod)) failed = true;
  });
  return seen > 0 && !failed;
}

/** 弱点克服: some tag peaked above 20 % while active and now sits under 5 % with real evidence. */
export function weakConqueredMet(m: SaveMeta): boolean {
  for (const w of Object.values(m.weakPoints)) {
    if (w.peak > 0.2 && w.ewma < 0.05 && w.n >= 15) return true;
  }
  return false;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Definitions                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

type When = BadgeDef['when'];

function def(id: BadgeId, glyph: string, field: BadgeField, tier: BadgeTier, category: BadgeCategory, events: readonly EventName[], when: When): BadgeDef {
  const copy = S.badges[id];
  return { id, nameEn: copy.en, nameJa: copy.ja, glyph, field, tier, category, hidden: false, describe: copy.describe, events, when };
}

const REP: readonly EventName[] = ['attempt:graded', 'session:finished'];
const STREAK: readonly EventName[] = ['streak:changed', 'day:rolled', 'session:finished'];
const PROMO: readonly EventName[] = ['item:promoted'];
const GATE: readonly EventName[] = ['gate:result', 'stamp:earned'];
const SHINSA: readonly EventName[] = ['shinsa:result', 'belt:promoted'];
/** design 08 §11: Radio tracks and Read-alongs (`listen:played`) and Arena / Ear Walk sets (`listening:set`) both move the first-hearing counters. */
const LISTEN: readonly EventName[] = ['listening:set', 'listen:played'];
/** design 08 §11: only a Radio track (`listen:played`, source radio) moves `stats.radioMinutes`. */
const PLAYED: readonly EventName[] = ['listen:played'];

/** 茶屋の常連 — minutes of Teahouse Radio heard (`stats.radioMinutes`), design 08 §11. */
export const TEAHOUSE_REGULAR_MINUTES = 600;
/** 初耳 — texts understood on their first hearing on either surface (`stats.coldSetsPassed`), design 08 §11. */
export const FIRST_HEARING_SETS = 20;

function beltBadge(belt: Exclude<Belt, 'white'>, tier: BadgeTier): BadgeDef {
  return def(`belt-${belt}`, '帯', 'square', tier, 'belt', SHINSA, (m) => m.progress.shinsaPassed.includes(belt));
}

const DEFS_BY_STRAND: readonly BadgeDef[] = [
  // ── kana ──────────────────────────────────────────────────────────────
  def('first-step', '歩', 'circle', 'bronze', 'training', ['session:finished'], (m) => m.stats.sessions >= 1),
  def('gojuon', 'あ', 'petal', 'silver', 'kana', REP, (m, _ev, cards) => allKanaGreen(KANA_SETS.hiraganaBasic, cards)),
  def('katakana', 'カ', 'petal', 'silver', 'kana', REP, (m, _ev, cards) => allKanaGreen(KANA_SETS.katakanaAll, cards)),
  def('voiced', '゛', 'circle', 'bronze', 'kana', REP, (m, _ev, cards) => allKanaGreen(KANA_SETS.hiraganaVoiced, cards)),
  def('rain-candy', '雨', 'hexagon', 'silver', 'kana', REP, (m) => m.stats.minimalPairTrials >= 200 && share(m.stats.minimalPairCorrect, m.stats.minimalPairTrials) >= 0.95),
  def('gojuon-perfect', '星', 'tomoe', 'gold', 'kana', ['arcade:done'], (m, ev) => {
    if (m.stats.gojuonPerfects >= 1) return true;
    return ev?.name === 'arcade:done' && ev.payload.mode === 'gojuon' && ev.payload.correct >= 46 && ev.payload.misses === 0 && ev.payload.ms < 60_000;
  }),

  // ── flame ─────────────────────────────────────────────────────────────
  def('three-day', '四', 'circle', 'bronze', 'streak', STREAK, (m) => bestStreak(m) >= 4),
  def('seven', '七', 'circle', 'bronze', 'streak', STREAK, (m) => bestStreak(m) >= 7),
  def('thirty', '月', 'circle', 'silver', 'streak', STREAK, (m) => bestStreak(m) >= 30),
  def('hundred', '修', 'tomoe', 'gold', 'streak', STREAK, (m) => m.streak.totalDays >= 100),
  def('year', '年', 'tomoe', 'gold', 'streak', STREAK, (m) => m.streak.totalDays >= 365),
  def('rise-eight', '起', 'hexagon', 'silver', 'streak', STREAK, (m) => m.streak.repairs >= 1),
  def('ember', '火', 'circle', 'bronze', 'streak', STREAK, (m) => m.streak.emberRestores >= 1),
  def('samurai-rest', '休', 'circle', 'bronze', 'streak', STREAK, (m) => m.streak.restDaysTaken >= 10),
  def('five-hundred-days', '日', 'tomoe', 'gold', 'streak', STREAK, (m) => m.streak.totalDays >= 500),

  // ── training ──────────────────────────────────────────────────────────
  def('thousand-cuts', '千', 'square', 'bronze', 'training', REP, (m) => m.stats.reviews >= 1000),
  def('ten-thousand', '万', 'square', 'silver', 'training', REP, (m) => m.stats.reviews >= 10_000),
  def('hundred-thousand', '十', 'square', 'gold', 'training', REP, (m) => m.stats.reviews >= 100_000),
  def('ten-chain', '連', 'hexagon', 'bronze', 'training', REP, (m) => m.stats.bestCombo >= 10),
  def('fifty-chain', '連', 'hexagon', 'silver', 'training', REP, (m) => m.stats.bestCombo >= 50),
  def('hundred-chain', '連', 'tomoe', 'gold', 'training', REP, (m) => m.stats.bestCombo >= 100),
  def('unscathed', '無', 'circle', 'bronze', 'training', ['session:finished'], (m, ev) => {
    if (m.stats.katasUnscathed >= 1) return true;
    if (ev?.name !== 'session:finished' || ev.payload.mode !== 'kata') return false;
    const t = ev.payload.tally;
    return t.reps >= 15 && t.correct >= t.reps;
  }),
  def('ippon', '一', 'square', 'bronze', 'training', REP, (m) => m.stats.ippon >= 1),
  def('hundred-ippon', '本', 'square', 'silver', 'training', REP, (m) => m.stats.ippon >= 100),

  // ── road ──────────────────────────────────────────────────────────────
  def('gatekeepers-respect', '関', 'hexagon', 'bronze', 'road', GATE, (m) => m.progress.stationsCleared.length >= 1),
  def('perfect-gate', '門', 'hexagon', 'silver', 'road', GATE, (m) => m.progress.perfectGates >= 1),
  def('revenge', '雪', 'hexagon', 'silver', 'road', GATE, (m, ev) => m.stats.revengeWins >= 1 || (ev?.name === 'gate:result' && ev.payload.outcome === 'revenge')),
  def('halfway', '道', 'tomoe', 'silver', 'road', GATE, (m) => m.progress.stationsCleared.includes(27)),
  def('kyoto', '京', 'tomoe', 'gold', 'road', GATE, (m) => m.progress.stationsCleared.includes(53)),

  // ── belts ─────────────────────────────────────────────────────────────
  beltBadge('yellow', 'bronze'),
  beltBadge('orange', 'bronze'),
  beltBadge('green', 'silver'),
  beltBadge('blue', 'silver'),
  beltBadge('purple', 'silver'),
  beltBadge('brown', 'gold'),
  beltBadge('black', 'gold'),

  // ── input ─────────────────────────────────────────────────────────────
  def('bookworm', '本', 'petal', 'silver', 'input', ['story:read'], (m) => m.stats.episodesRead >= 50),
  def('dictionary-free', '辞', 'petal', 'silver', 'input', ['story:read'], (m, ev) => {
    if (m.stats.episodesDictionaryFree >= 1) return true;
    if (ev?.name !== 'story:read' || ev.payload.mode !== 'read') return false;
    const p = ev.payload;
    return p.chars >= 300 && p.total > 0 && p.correct / p.total >= 2 / 3 && p.glossTaps <= 2;
  }),
  def('speed-reader', '速', 'petal', 'silver', 'input', ['story:read'], (m, ev) => {
    if (m.stats.speedReadBestCpm >= 300) return true;
    if (ev?.name !== 'story:read' || ev.payload.mode !== 'speed') return false;
    return ev.payload.cpm >= 300 && ev.payload.total > 0 && ev.payload.correct >= ev.payload.total;
  }),
  def('golden-ear', '耳', 'circle', 'silver', 'input', ['line:scored'], (m) => m.stats.dictation95at1x >= 100),
  def('fast-ear', '倍', 'circle', 'gold', 'input', ['listening:set'], (m) => m.stats.listeningFastPasses >= 20),
  // design 08 §11: 10 h of 茶屋ラジオ; 20 texts understood on the first hearing (Arena pass or Radio gist answer).
  def('teahouse-regular', '常', 'circle', 'bronze', 'input', PLAYED, (m) => m.stats.radioMinutes >= TEAHOUSE_REGULAR_MINUTES),
  def('first-hearing', '初', 'circle', 'silver', 'input', LISTEN, (m) => m.stats.coldSetsPassed >= FIRST_HEARING_SETS),

  // ── output ────────────────────────────────────────────────────────────
  def('voice', '声', 'circle', 'bronze', 'output', ['line:scored'], (m) => m.stats.shadowPass >= 1),
  def('shadow-warrior', '影', 'hexagon', 'gold', 'output', ['line:scored'], (m) => m.stats.shadowPass >= 500),
  def('aizuchi', '槌', 'hexagon', 'silver', 'output', ['roleplay:done'], (m) => m.stats.rolePlaysAizuchi >= 20),
  def('three-forms', '変', 'hexagon', 'silver', 'output', ['output:done'], (m) => m.stats.threeWays >= 100),
  def('one-minute-monologue', '独', 'hexagon', 'silver', 'output', ['output:done'], (m, ev) => {
    if (m.stats.monologueBestWords >= 80 || m.stats.monologues >= 30) return true;
    if (ev?.name !== 'output:done' || ev.payload.kind !== 'monologue') return false;
    return (ev.payload.seconds ?? 0) >= 60 && (ev.payload.words ?? 0) >= 80;
  }),

  // ── mastery ───────────────────────────────────────────────────────────
  def('hundred-kanji', '字', 'square', 'silver', 'mastery', PROMO, (m) => m.stats.kanjiBrown >= 100),
  def('thousand-kanji', '字', 'square', 'gold', 'mastery', PROMO, (m) => m.stats.kanjiBrown >= 1000),
  def('thousand-words', '語', 'square', 'silver', 'mastery', PROMO, (m) => m.stats.vocabBrown >= 1000),
  def('five-thousand', '語', 'square', 'gold', 'mastery', PROMO, (m) => m.stats.vocabBrown >= 5000),
  def('grammarian', '型', 'square', 'silver', 'mastery', [...PROMO, ...GATE], (m, _ev, cards) => grammarianMet(m, cards)),
  def('form-chain-20', '活', 'square', 'bronze', 'mastery', REP, (m) => m.stats.formChainsPerfect >= 20),
  def('particle-sage', '助', 'square', 'silver', 'mastery', REP, (m) => m.stats.particleSlots >= 500 && share(m.stats.particleSlotsCorrect, m.stats.particleSlots) >= 0.95),
  def('honest', '正', 'circle', 'gold', 'mastery', REP, (m) => m.stats.judgeChecks >= 200 && m.stats.honesty >= 0.95),
  def('weak-conquered', '克', 'hexagon', 'silver', 'mastery', ['attempt:graded', 'weak-point:cleared'], (m) => weakConqueredMet(m)),
  def('nemesis-slayer', '討', 'hexagon', 'silver', 'mastery', ['nemesis:defeated'], (m) => m.stats.nemesisDefeated >= 10),
  def('shadow-breaker', '越', 'tomoe', 'gold', 'mastery', ['kage:result'], (m) => m.kage.wins >= 10),
  def('beyond-the-wall', '壁', 'tomoe', 'gold', 'mastery', SHINSA, (m) => m.progress.shinsaPassed.includes('brown')),

  // ── spirit ────────────────────────────────────────────────────────────
  def('hundred-hours', '聴', 'circle', 'silver', 'spirit', ['ledger:entry', 'field-mission:done'], (m) => ledgerHoursOf(m).listen >= 100),
  def('thousand-hours', '時', 'tomoe', 'gold', 'spirit', ['ledger:entry', 'field-mission:done'], (m) => ledgerHoursOf(m).total >= 1000),
  def('field', '現', 'circle', 'bronze', 'spirit', ['field-mission:done'], (m) => m.stats.fieldMissions >= 10 || m.ledger.missions.length >= 10),
  def('first-convo', '話', 'circle', 'silver', 'spirit', ['field-mission:done'], (m, ev) => {
    if (m.stats.conversations >= 1 || m.ledger.missions.some((x) => x.conversation)) return true;
    return ev?.name === 'field-mission:done' && ev.payload.conversation;
  }),
  def('comeback', '復', 'circle', 'bronze', 'spirit', ['welcome-back:done'], (m, ev) => m.stats.comebacks >= 1 || ev?.name === 'welcome-back:done'),
  def('zen', '禅', 'circle', 'silver', 'spirit', ['session:finished'], (m) => m.stats.zenSessions >= 30),
  def('backup', '備', 'circle', 'bronze', 'spirit', ['backup:exported'], (m, ev) => m.stats.exports >= 1 || ev?.name === 'backup:exported'),
  def('tsuzuku', '続', 'tomoe', 'gold', 'spirit', ['session:finished'], (m) => m.stats.sessions >= 100),
];

/** Position in `BADGE_IDS`; an id the catalog does not list yet sorts last (stable), so the table never throws. */
function catalogIndex(id: BadgeId): number {
  const i = BADGE_IDS.indexOf(id);
  return i < 0 ? BADGE_IDS.length : i;
}

/** The 68 definitions in `BADGE_IDS` order (design 06 §2 + design 08 §11); the strands above are for reading. */
export const BADGE_DEFS: readonly BadgeDef[] = [...DEFS_BY_STRAND].sort((a, b) => catalogIndex(a.id) - catalogIndex(b.id));

export const BADGE_BY_ID: Readonly<Record<BadgeId, BadgeDef>> = Object.fromEntries(BADGE_DEFS.map((d) => [d.id, d])) as Record<BadgeId, BadgeDef>;

export function badgeDef(id: BadgeId): BadgeDef {
  return BADGE_BY_ID[id];
}

/** Sanity: the table above covers `BADGE_IDS` exactly (checked by the test file too). */
export const BADGE_DEFS_COMPLETE: boolean = BADGE_DEFS.length === BADGE_IDS.length && BADGE_IDS.every((id) => id in BADGE_BY_ID);
