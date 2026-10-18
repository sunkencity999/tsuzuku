/**
 * TSUZUKU — the 28 Kakejiku (掛け軸) unlock definitions (design 06 §3).
 *
 * `when(m, ev?, cards?)` is the unlock predicate; `progress(m, cards?)` (0–1)
 * exists for the pieces tied to a counter, which reveal in quadrants at
 * 25/50/75/100 % (`revealQuadrant`). `living` pieces re-render from current
 * state; `upgrade(m)` is the daruma's eye count (0 · left at Blue · both at
 * Shodan). Streak-tied pieces key on `streak.totalDays`; personalization
 * freezes streak data at `streak.longest` so a break never shrinks a piece.
 *
 * `buildData(store, get)` assembles the personalization record every
 * generator consumes (`WallpaperData`, the shape of `art/wallpapers/spec.ts`)
 * from the store alone, resolving item surfaces through the `get` the caller
 * supplies (`content.get`); unresolved items fall back to their kana/char or
 * are skipped. Re-exported by `src/store/index.ts`, so no learning-core import.
 */
import { DRILL_IDS, type ContentItem, type GrammarItem, type KanaItem, type VocabItem } from '../content/types';
import { BADGE_IDS, WALLPAPER_IDS, type BadgeId, type WallpaperId } from '../shared/catalog';
import type { EventName } from '../shared/events';
import { parseCardKey } from '../shared/ids';
import { romajiToKana } from '../shared/kana-ime';
import type { Belt, Facet } from '../content/types';
import type { CardTuple, EpochDay, LogEntry, SaveMeta, Store, WallpaperEntry } from '../shared/store-types';
import { epochDay, monthKey } from '../shared/time';
import { KANA_SETS, isBrown, kanaStable, type CardReader, type TriggerEvent } from './badge-defs';
import { S } from './defs-strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type Quadrant = 0 | 1 | 2 | 3 | 4;

export interface WallpaperDef {
  id: WallpaperId;
  nameEn: string;
  nameJa: string;
  /** Re-rendered from current state (position, words this month, minutes…). */
  living: boolean;
  /** The unlock condition in plain words. */
  describe: string;
  /** Events after which the condition or progress can change (evaluator index). */
  events: readonly EventName[];
  when(m: SaveMeta, ev?: TriggerEvent, cards?: CardReader): boolean;
  /** 0–1 toward the condition; only for counter-tied pieces (progressive reveal). */
  progress?(m: SaveMeta, cards?: CardReader): number;
  /** In-place upgrade stage (daruma eyes: 0, 1, 2). */
  upgrade?(m: SaveMeta): number;
}

/** Personalization record handed to every generator (mirrors `art/wallpapers/spec.ts`). */
export interface WallpaperData {
  nameKana: string;
  chosenKanji?: string;
  belt: Belt;
  /** Frozen at the longest streak (design 06 §3). */
  streak: number;
  totalDays: number;
  level: number;
  xp: number;
  mastered: { kana: string[]; kanji: string[]; vocab: { word: string; kana: string; reviews: number }[] };
  grammarBrown: string[];
  katakanaBrown: string[];
  badgesInOrder: BadgeId[];
  stamps: number[];
  station: number;
  /** Minutes per day over the last 90 days, oldest first. */
  minutes90: number[];
  writingSentences: string[];
  dictatedSentence?: string;
  /** Kana glyph → median Gojūon Fighter latency in ms. */
  gojuonMs: Record<string, number>;
  rapidBest: number;
  freezes: number;
  restDays: number;
  wordsThisMonth: number;
  arcGrammar: string[];
  sentenceOfChoice?: string;
  date: EpochDay;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function ratio(n: number, target: number): number {
  return clamp01(n / target);
}

/** The learner has reached station `n` (entered it, or cleared the one before). */
export function reachedStation(m: SaveMeta, n: number): boolean {
  return m.progress.station >= n || m.progress.stationsCleared.includes(n - 1);
}

function hiraganaGreen(cards: CardReader | undefined): number {
  const { done, total } = kanaStable(KANA_SETS.hiraganaAll, cards);
  return total ? done / total : 0;
}

function whiteCleared(m: SaveMeta): number {
  return [1, 2, 3].filter((n) => m.progress.stationsCleared.includes(n)).length;
}

function badgeCount(m: SaveMeta): number {
  return Object.keys(m.collections.badges).length;
}

/** An entry with `at > 0` is unlocked; `at === 0` with `revealed` 1–3 is a progressive-reveal stub. */
export function isUnlocked(e: WallpaperEntry | undefined): boolean {
  return e !== undefined && e.at > 0;
}

/** Quadrants earned toward a locked piece (0 when the piece has no counter). */
export function revealQuadrant(def: WallpaperDef, m: SaveMeta, cards?: CardReader): Quadrant {
  if (!def.progress) return 0;
  const q = Math.floor(clamp01(def.progress(m, cards)) * 4);
  return (q < 0 ? 0 : q > 4 ? 4 : q) as Quadrant;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Definitions                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

interface Spec {
  living: boolean;
  events: readonly EventName[];
  when: WallpaperDef['when'];
  progress?: WallpaperDef['progress'];
  upgrade?: WallpaperDef['upgrade'];
}

function def(id: WallpaperId, spec: Spec): WallpaperDef {
  const copy = S.wallpapers[id];
  const d: WallpaperDef = { id, nameEn: copy.en, nameJa: copy.ja, living: spec.living, describe: copy.describe, events: spec.events, when: spec.when };
  if (spec.progress) d.progress = spec.progress;
  if (spec.upgrade) d.upgrade = spec.upgrade;
  return d;
}

const REP: readonly EventName[] = ['attempt:graded', 'session:finished'];
const STREAK: readonly EventName[] = ['streak:changed', 'day:rolled', 'session:finished'];
const PROMO: readonly EventName[] = ['item:promoted'];
const GATE: readonly EventName[] = ['gate:result', 'stamp:earned'];
const SHINSA: readonly EventName[] = ['shinsa:result', 'belt:promoted'];

const totalDays = (target: number): Spec => ({
  living: false,
  events: STREAK,
  when: (m) => m.streak.totalDays >= target,
  progress: (m) => ratio(m.streak.totalDays, target),
});

const shinsa = (belt: Belt, living = false): Spec => ({ living, events: SHINSA, when: (m) => m.progress.shinsaPassed.includes(belt) });

const station = (n: number, living: boolean): Spec => ({
  living,
  events: [...GATE, 'scroll:completed', 'item:introduced'],
  when: (m) => reachedStation(m, n),
  progress: (m) => ratio(Math.max(m.progress.station, m.progress.stationsCleared.length ? Math.max(...m.progress.stationsCleared) + 1 : 0), n),
});

const dan = (n: number, living: boolean): Spec => ({ living, events: SHINSA, when: (m) => m.profile.dan >= n });

export const WALLPAPER_DEFS: readonly WallpaperDef[] = [
  def('torii-dawn', { living: false, events: REP, when: (m, _ev, cards) => hiraganaGreen(cards) >= 1, progress: (m, cards) => hiraganaGreen(cards) }),
  def('kana-grid', { living: true, events: GATE, when: (m) => whiteCleared(m) === 3, progress: (m) => whiteCleared(m) / 3 }),
  def('neon-alley', { living: true, events: PROMO, when: (m) => m.stats.vocabBrown >= 100, progress: (m) => ratio(m.stats.vocabBrown, 100) }),
  def('sakura-storm', { ...totalDays(30), living: true }),
  def('great-wave', { living: true, events: REP, when: (m) => m.stats.reviews >= 1000, progress: (m) => ratio(m.stats.reviews, 1000) }),
  def('kanji-stars', { living: true, events: PROMO, when: (m) => m.stats.kanjiBrown >= 100, progress: (m) => ratio(m.stats.kanjiBrown, 100) }),
  def('fifty-three', station(10, true)),
  def('lantern-river', { ...totalDays(100), living: true }),
  def('sumi-dragon', { ...totalDays(60), living: true }),
  def('okaeri', {
    living: true,
    events: [...STREAK, 'welcome-back:done'],
    when: (m, ev) => m.streak.emberRestores >= 1 || m.streak.repairs >= 1 || m.stats.comebacks >= 1 || ev?.name === 'welcome-back:done',
  }),
  def('vs-wall', station(25, false)),
  def('wall-broken', shinsa('brown', true)),
  def('tanabata', { ...totalDays(365), living: true }),
  def('hanko-garden', { living: true, events: ['badge:earned'], when: (m) => badgeCount(m) >= 25, progress: (m) => ratio(badgeCount(m), 25) }),
  def('fuji-ridge', shinsa('green', true)),
  def('koi-dragon', shinsa('purple', true)),
  def('shoji-light', { living: true, events: PROMO, when: (m) => m.stats.grammarBrown >= 100, progress: (m) => ratio(m.stats.grammarBrown, 100) }),
  def('insert-coin', {
    living: true,
    events: ['arcade:done'],
    when: (m, ev) => m.stats.rapidBest >= 50 || (ev?.name === 'arcade:done' && ev.payload.mode === 'rapid' && ev.payload.correct >= 50),
    progress: (m) => ratio(m.stats.rapidBest, 50),
  }),
  def('daruma', {
    ...shinsa('blue', true),
    upgrade: (m) => (m.progress.shinsaPassed.includes('black') || m.profile.dan >= 1 ? 2 : m.progress.shinsaPassed.includes('blue') ? 1 : 0),
  }),
  def('vending-night', { living: true, events: PROMO, when: (m) => m.stats.katakanaBrown >= 300, progress: (m) => ratio(m.stats.katakanaBrown, 300) }),
  def('onsen', { living: true, events: STREAK, when: (m) => m.streak.restDaysTaken >= 10, progress: (m) => ratio(m.streak.restDaysTaken, 10) }),
  def('waveform', {
    living: false,
    events: ['badge:earned', 'line:scored'],
    when: (m) => m.collections.badges['golden-ear'] !== undefined || m.stats.dictation95at1x >= 100,
    progress: (m) => ratio(m.stats.dictation95at1x, 100),
  }),
  def('golden-screen', dan(2, false)),
  def('festival', dan(3, false)),
  def('station-sign', { living: true, events: GATE, when: (m) => m.progress.stationsCleared.length >= 1 }),
  def('kyoto-arrival', { living: false, events: SHINSA, when: (m) => m.progress.shinsaPassed.includes('black') || m.profile.dan >= 1 }),
  def('road-continues', dan(10, true)),
  def('end-card', { living: true, events: ['session:finished'], when: (m) => m.stats.sessions >= 100, progress: (m) => ratio(m.stats.sessions, 100) }),
];

export const WALLPAPER_BY_ID: Readonly<Record<WallpaperId, WallpaperDef>> = Object.fromEntries(WALLPAPER_DEFS.map((d) => [d.id, d])) as Record<WallpaperId, WallpaperDef>;

export function wallpaperDef(id: WallpaperId): WallpaperDef {
  return WALLPAPER_BY_ID[id];
}

export const WALLPAPER_DEFS_COMPLETE: boolean = WALLPAPER_DEFS.length === WALLPAPER_IDS.length && WALLPAPER_IDS.every((id) => id in WALLPAPER_BY_ID);

/** Daruma eye copy for the gallery. */
export function darumaCopy(m: SaveMeta): string {
  const eyes = WALLPAPER_BY_ID.daruma.upgrade?.(m) ?? 0;
  return eyes >= 2 ? S.darumaBothEyes : eyes === 1 ? S.darumaLeftEye : S.darumaNoEyes;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* buildData                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export type ItemResolver = (id: string) => ContentItem | undefined;

type Facets = Partial<Record<Facet, CardTuple>>;

const KATAKANA_RE = /^[ァ-ヺー・]+$/;
const LATIN_RE = /[A-Za-z]/;
const GOJUON_IDX = DRILL_IDS.indexOf('gojuon-fighter');

function groupCards(cards: CardReader): Map<string, Facets> {
  const byItem = new Map<string, Facets>();
  cards.forEach((k, t) => {
    const { itemId, facet } = parseCardKey(k);
    let f = byItem.get(itemId);
    if (!f) {
      f = {};
      byItem.set(itemId, f);
    }
    f[facet] = t;
  });
  return byItem;
}

/** Brown by kind from the facets alone (design 02 §4 base/production facets). */
function brownOf(itemId: string, f: Facets): boolean {
  if (itemId.startsWith('j-')) return isBrown(f.comp, f.read);
  if (itemId.startsWith('g-')) return isBrown(f.cloze, f.prod);
  if (itemId.startsWith('v-') && !f.rec && f.prod) return isBrown(f.prod, f.prod); // chunk: prod is both
  if (itemId.startsWith('v-') || itemId.startsWith('k-')) return isBrown(f.rec, f.prod);
  return false;
}

function kanaGlyph(id: string, item: ContentItem | undefined): string | null {
  if (item && 'kana' in item && 'script' in item) return (item as KanaItem).kana;
  const parts = id.split('-');
  const romaji = parts.slice(2).join('-');
  const glyph = romajiToKana(romaji === 'n' ? 'nn' : romaji, { katakana: parts[1] === 'k' });
  return glyph && !LATIN_RE.test(glyph) ? glyph : null;
}

const LEVEL_ORDER = ['n5', 'n4', 'n3', 'n2', 'n1'];

/** Curriculum order: N5 before N1, then the id's sequence. */
function byCurriculum(a: { id: string }, b: { id: string }): number {
  const la = LEVEL_ORDER.indexOf(a.id.split('-')[1] ?? '');
  const lb = LEVEL_ORDER.indexOf(b.id.split('-')[1] ?? '');
  return la - lb || a.id.localeCompare(b.id);
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function dayIn(ms: number, tz: string): EpochDay {
  try {
    return epochDay(ms, tz);
  } catch {
    return epochDay(ms);
  }
}

function gojuonLatencies(log: LogEntry[], get: ItemResolver): Record<string, number> {
  const samples = new Map<string, number[]>();
  for (const e of log) {
    if (e[4] !== GOJUON_IDX || !e[1].startsWith('k-')) continue;
    const { itemId } = parseCardKey(e[1]);
    const arr = samples.get(itemId) ?? [];
    arr.push(e[3]);
    samples.set(itemId, arr);
  }
  const out: Record<string, number> = {};
  for (const [id, ms] of samples) {
    const glyph = kanaGlyph(id, get(id));
    if (glyph) out[glyph] = Math.round(median(ms));
  }
  return out;
}

function wordsIntroducedInMonth(log: LogEntry[], today: EpochDay, tz: string): number {
  const first = new Map<string, EpochDay>();
  for (const e of log) {
    if (!e[1].startsWith('v-')) continue;
    const { itemId } = parseCardKey(e[1]);
    const d = dayIn(e[0], tz);
    const f = first.get(itemId);
    if (f === undefined || d < f) first.set(itemId, d);
  }
  const month = monthKey(today);
  let n = 0;
  for (const d of first.values()) if (monthKey(d) === month) n++;
  return n;
}

export interface BuildDataOptions {
  sentenceOfChoice?: string;
  dictatedSentence?: string;
  /** Review-log window to mine (default the whole ring). */
  log?: LogEntry[];
}

/**
 * Personalization data from the store. `get` resolves item surfaces
 * (`content.get`); items it cannot resolve fall back to their glyph (kana,
 * kanji) or are left out (vocab, grammar), so the record is always complete
 * and deterministic (every list sorted).
 */
export function buildData(store: Store, get: ItemResolver, o: BuildDataOptions = {}): WallpaperData {
  const m = store.meta();
  const today = store.today();
  const log = o.log ?? store.log.recent(5000);
  const byItem = groupCards(store.cards);

  const kana: string[] = [];
  const kanji: string[] = [];
  const vocab: WallpaperData['mastered']['vocab'] = [];
  const grammar: { id: string; text: string }[] = [];
  const katakana: string[] = [];
  const arc: { id: string; text: string }[] = [];

  for (const [id, f] of byItem) {
    if (!brownOf(id, f)) continue;
    if (id.startsWith('k-')) {
      const g = kanaGlyph(id, get(id));
      if (g) kana.push(g);
    } else if (id.startsWith('j-')) {
      kanji.push(id.slice(2));
    } else if (id.startsWith('v-')) {
      const item = get(id) as VocabItem | undefined;
      if (!item || !('word' in item)) continue;
      const reviews = (f.rec?.[3] ?? 0) + (f.prod?.[3] ?? 0);
      vocab.push({ word: item.word, kana: item.kana, reviews });
      if (KATAKANA_RE.test(item.kana) || KATAKANA_RE.test(item.word)) katakana.push(item.word);
    } else if (id.startsWith('g-')) {
      const item = get(id) as GrammarItem | undefined;
      const text = item && 'pattern' in item ? item.pattern : id;
      grammar.push({ id, text });
      if (/^g-n[32]-/.test(id)) arc.push({ id, text });
    }
  }
  kana.sort();
  kanji.sort();
  vocab.sort((a, b) => b.reviews - a.reviews || a.word.localeCompare(b.word, 'ja'));
  katakana.sort((a, b) => a.localeCompare(b, 'ja'));
  grammar.sort(byCurriculum);
  arc.sort(byCurriculum);

  const badgesInOrder = (Object.entries(m.collections.badges) as [BadgeId, EpochDay | undefined][])
    .filter((e): e is [BadgeId, EpochDay] => e[1] !== undefined)
    .sort((a, b) => a[1] - b[1] || BADGE_IDS.indexOf(a[0]) - BADGE_IDS.indexOf(b[0]))
    .map((e) => e[0]);

  const stamps = Object.keys(m.collections.stamps)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const minutes90: number[] = [];
  for (let d = today - 89; d <= today; d++) minutes90.push(m.daily[d]?.minutes ?? 0);

  const data: WallpaperData = {
    nameKana: m.profile.nameKana || m.profile.name,
    belt: m.profile.belt,
    streak: Math.max(m.streak.longest, m.streak.current),
    totalDays: m.streak.totalDays,
    level: m.profile.level,
    xp: m.profile.xp,
    mastered: { kana, kanji, vocab },
    grammarBrown: grammar.map((g) => g.text),
    katakanaBrown: katakana,
    badgesInOrder,
    stamps,
    station: m.progress.station,
    minutes90,
    writingSentences: [],
    gojuonMs: gojuonLatencies(log, get),
    rapidBest: m.stats.rapidBest,
    freezes: m.streak.freezes,
    restDays: m.streak.restDaysTaken,
    wordsThisMonth: wordsIntroducedInMonth(log, today, m.profile.tz),
    arcGrammar: arc.map((g) => g.text),
    date: today,
  };
  if (m.profile.chosenKanji) data.chosenKanji = m.profile.chosenKanji;
  if (o.sentenceOfChoice) data.sentenceOfChoice = o.sentenceOfChoice;
  if (o.dictatedSentence) data.dictatedSentence = o.dictatedSentence;
  return data;
}
