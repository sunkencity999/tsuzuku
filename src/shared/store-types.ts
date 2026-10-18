/**
 * TSUZUKU — save/store contracts (ARCHITECTURE §1, design 07 §3).
 *
 * Pure types + tiny constants. Group B implements the `Store` in
 * `src/store/index.ts`; pure engines type their inputs against these shapes
 * without importing the store. Nothing here touches storage.
 *
 * Imports: `content/types` (values + types) and type-only imports from
 * `./catalog` (id unions) and `./session-types` (the opaque session slot).
 */
import type { Signal } from '@preact/signals';
import type { Belt, CardKey, DrillId, ErrorTag, Facet, Level } from '../content/types';
import type { BadgeId, QuestId, WallpaperId } from './catalog';
import type { SessionSnapshot } from './session-types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Primitive unions                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/** Days since 1970-01-01 at the 04:00 local boundary (`shared/time.ts`). */
export type EpochDay = number;

/** FSRS rating: 1 Again · 2 Hard · 3 Good · 4 Easy. */
export type Rating = 1 | 2 | 3 | 4;

/** `chunk` = a set-phrase or aizuchi `VocabItem` (prod facet only). */
export type ItemKind = 'kana' | 'vocab' | 'kanji' | 'grammar' | 'component' | 'chunk';
export const ITEM_KINDS = ['kana', 'vocab', 'kanji', 'grammar', 'component', 'chunk'] as const;

/** Item belt (design 02 §4). */
export type ItemBelt = 'white' | 'yellow' | 'green' | 'brown' | 'black';
export const ITEM_BELTS = ['white', 'yellow', 'green', 'brown', 'black'] as const;

/** FSRS card state: 0 new · 1 learning · 2 review · 3 relearning. */
export type CardState = 0 | 1 | 2 | 3;

/** `CardTuple[7]` bitmask. */
export const CardFlag = {
  archived: 1,
  nemesis: 2,
  kaiden: 4,
  stepPending: 8,
  /** Arcade miss (Rapid Fire / Gojūon): re-test untimed next session; Again only if that fails. */
  recheck: 16,
} as const;
export type CardFlag = (typeof CardFlag)[keyof typeof CardFlag];

export function hasFlag(flags: number, flag: CardFlag): boolean {
  return (flags & flag) !== 0;
}
export function withFlag(flags: number, flag: CardFlag): number {
  return flags | flag;
}
export function withoutFlag(flags: number, flag: CardFlag): number {
  return flags & ~flag;
}

/**
 * One FSRS card. `s` stability (days, 2 decimals), `d` difficulty (1–10, 2 decimals).
 * flags: 1 archived · 2 nemesis · 4 kaiden · 8 step-pending · 16 recheck (`CardFlag`).
 */
export type CardTuple = [
  due: EpochDay,
  s: number,
  d: number,
  reps: number,
  lapses: number,
  state: CardState,
  last: EpochDay,
  flags: number,
];

/** Review-log row (ring of 5,000). `exerciseIdx` indexes `DRILL_IDS`; `tagsMask` indexes `ERROR_TAGS` bits. */
export type LogEntry = [t: number, cardKey: CardKey, rating: Rating, ms: number, exerciseIdx: number, tagsMask: number];

/* ────────────────────────────────────────────────────────────────────────── */
/* Slices                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Cap on `Profile.name` / `Profile.nameKana` in Unicode code points (the phone
 * safe zone of the name-bearing wallpapers, design 06). Onboarding clamps as
 * the learner types, `store/migrations.fillMeta` truncates imported or
 * hand-edited saves to it, and the art tier lays out at most this many glyphs;
 * `shared/jp.clampGlyphs` is the one cutter.
 */
export const NAME_MAX_GLYPHS = 24;

export interface Profile {
  /** Default 無名 Mumei. */
  name: string;
  nameKana: string;
  /** Picked at each belt from Brown kanji; the wall scroll. */
  chosenKanji?: string;
  belt: Belt;
  /** 0 = kyū road; 1 = 初段 … */
  dan: number;
  level: number;
  xp: number;
  startedAt: number;
  /** IANA zone, e.g. `America/Los_Angeles`. */
  tz: string;
  goals: string[];
  /** Kana item ids marked 既知 by the onboarding Kana Flash (design 05 §3). */
  kanaKnown: string[];
  /** ms when onboarding finished (absent = never; the shell's first-run check). */
  onboardedAt?: number;
  /** Latest sentence dictated perfectly (≥ 0.95 at 1×): the Waveform wallpaper's text (design 06 §wallpapers). */
  dictatedSentence?: string;
}

export type Intensity = 'casual' | 'standard' | 'intense' | 'custom';
export type Feel = 'zen' | 'dojo' | 'arcade';
export type Theme = 'auto' | 'light' | 'dark';
export type FuriganaMode = 'always' | 'fog' | 'tap' | 'off';
export type SpeakingMode = 'auto' | 'recognition' | 'self' | 'off';
export type SpeedTier = 1 | 2 | 3 | 4 | 5;
export type Retention = 0.85 | 0.9 | 0.95;

export interface Settings {
  intensity: Intensity;
  newPerDay: { vocab: number; kanji: number; grammar: number };
  /** White–Orange base review cap; belt-scaled by `learn/governors.ts`. */
  maxReviews: number;
  retention: Retention;
  feel: Feel;
  theme: Theme;
  /** Planned rest weekday 0 (Sun) – 6, or null. */
  restDay: number | null;
  furigana: FuriganaMode;
  /** J-J self-grading opt-in (Station 34+). */
  jj: boolean;
  classicGrading: boolean;
  ttsVoiceURI?: string;
  /** Second dialogue voice. */
  ttsVoiceURI2?: string;
  speedTier: SpeedTier;
  /** Defaults to `'self'` until the learner opts into recognition (design 06 §7 #10). */
  speaking: SpeakingMode;
  /** Writing Dojo / kanji-write opt-in. */
  writing: boolean;
  reducedMotion: boolean;
  /** Master volume 0–1. */
  sound: number;
  crt: boolean;
  /** Tategaki toggle (from Blue). */
  verticalText: boolean;
  /** "Speed affects grading": default off in Zen, on otherwise. */
  speedGrading: boolean;
  /**
   * Which voice `speak()` prefers (design 08 §13): `'pack'` (default) plays the
   * pre-rendered VOICEVOX clips when the pack has the key and falls back to
   * the device voice; `'device'` forces `speechSynthesis` even with a pack.
   */
  audioSource: 'pack' | 'device';
  /** No idle sprite prefetch, no Radio sprite beyond the current track (design 08 §13); auto-on under `navigator.connection.saveData`. */
  dataSaver: boolean;
}

export interface Streak {
  current: number;
  longest: number;
  lastDay: EpochDay;
  totalDays: number;
  /** 氷 freeze tokens held (≤ 3). */
  freezes: number;
  /** Day the flame turned to embers (48 h window). */
  ember?: EpochDay;
  repairs: number;
  /** 七転八起 window: practice 3 of the next 5 days from `start`. */
  repairWindow?: { start: EpochDay; done: number };
  restDaysTaken: number;
  /** Weekly Flame: weeks with ≥ 5 active days. */
  weekly: number;
  vacationUntil?: EpochDay;
  emberRestores: number;
  /** One repair per 30 days. */
  lastRepairDay?: EpochDay;
}

export interface ShinsaNotes {
  belt: Belt;
  items: CardKey[];
  tags: ErrorTag[];
}

export interface Progress {
  /** Current station 0–53. */
  station: number;
  stationsCleared: number[];
  perfectGates: number;
  /** Stations passed through the Assisted Gate (grey corner until Revenge). */
  assisted: number[];
  gateAttempts: Record<number, number>;
  /** Station → EpochDay of the latest Gatekeeper attempt (one attempt per day). */
  gateAttemptDay?: Record<number, EpochDay>;
  /** Station → ms the last LOST fight ended (Grudge reps count from here across reloads); cleared on a pass. */
  gateAttemptAt?: Record<number, number>;
  /** 遺恨帳 Grudge List. */
  grudge: CardKey[];
  shinsaPassed: Belt[];
  shinsaNotes?: ShinsaNotes;
  /** Days away detected at the last day roll. */
  awayDays: number;
  /** A Welcome Back set is owed (30+ days away). */
  welcomeBackDue: boolean;
  /** Story / Michikusa ids read to the end in the Reader (first read counts). */
  storiesRead?: string[];
  /**
   * Text ids heard on either listening surface (design 08 §10.2–§10.4): a
   * passed Arena set, a Radio track or a Read-along appends here. A set or
   * track is `cold` when its id is absent at start; Radio draws cold texts
   * from the complement. Never a read mark (that is `storiesRead`).
   */
  listened?: string[];
  /**
   * Text id → epoch day of the last PASSED Arena set on that text (design 08
   * §10.2: 茶屋ラジオ prefers re-hearings of texts the Arena touched within
   * `IMPLICIT_WINDOW_DAYS`… and the 14-day "worked on recently" rule). Written
   * by the Arena only; Radio and Read-along never write it. Capped by
   * migrations (`ARENA_AT_MAX`, oldest days dropped); backups keep the later day.
   */
  arenaAt?: Record<string, EpochDay>;
  /** Ids of first-contact teach cards the learner dismissed (`shared/ui/TeachOnce`, design 08 §11). */
  teachSeen?: string[];
}

export interface Quests {
  day: EpochDay;
  ids: QuestId[];
  done: QuestId[];
}

export interface WallpaperEntry {
  at: EpochDay;
  reforges: number;
  /** Progressive reveal quadrants. */
  revealed: 0 | 1 | 2 | 3 | 4;
  /** Day of the last reforge (one per day per piece). */
  lastReforgeDay?: EpochDay;
  /** Learner-picked sentence rendered on the piece (Studio). */
  sentenceOfChoice?: string;
  /** Learner-picked seal (hanko) kanji for the piece (Studio). */
  sealKanji?: string;
}

export interface StampEntry {
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
}

export interface Collections {
  badges: Partial<Record<BadgeId, EpochDay>>;
  wallpapers: Partial<Record<WallpaperId, WallpaperEntry>>;
  stamps: Record<number, StampEntry>;
  /** Collected Michikusa ids. */
  michikusa: string[];
}

export interface KageState {
  /** Absolute ISO-week index of the last Ghost Set (`time.weekOf`). */
  week: number;
  /** Best scores of the last 4 weeks. */
  best4: number[];
  wins: number;
  history: [week: number, score: number][];
  /** Week the Kage was last beaten (silhouette in the Dojo corner). */
  beatenWeek?: number;
}

export interface WeakPoint {
  /** Tagged-eligible attempts. */
  n: number;
  /** EWMA error rate, α = 0.2. */
  ewma: number;
  active: boolean;
  /** Highest EWMA seen while active (for 弱点克服: > 20 % → < 5 %). */
  peak: number;
}
export type WeakPoints = Record<ErrorTag, WeakPoint>;

/** `Ledger.entries[].kind` index. */
export const LEDGER_KINDS = ['listen', 'read', 'watch', 'speak'] as const;
export type LedgerKindName = (typeof LEDGER_KINDS)[number];
export type LedgerKind = 0 | 1 | 2 | 3;
/** `Ledger.entries[].source` index. */
export const LEDGER_SOURCES = ['app', 'external'] as const;
export type LedgerSource = 0 | 1;

/** `note` (5th column, optional) is the learner's free text for the row ("anime, episode 3"). */
export type LedgerEntry = [day: EpochDay, minutes: number, kind: LedgerKind, source: LedgerSource, note?: string];

export interface Ledger {
  entries: LedgerEntry[];
  /** `YYYY-MM` → minutes (rows older than 2 years aggregate here). */
  monthly: Record<string, number>;
  missions: { day: EpochDay; tier: 1 | 2 | 3 | 4 | 5; conversation: boolean }[];
}

/** Flat counters referenced by badge conditions (design 06 §2). */
export const STAT_KEYS = [
  'sessions',
  'zenSessions',
  'fullDays',
  'minutes',
  /** Graded reps; arcade (Rapid Fire, Gojūon Fighter) excluded. */
  'reviews',
  /** Arcade excluded. */
  'bestCombo',
  'ippon',
  'recoveries',
  'katasUnscathed',
  'itemsIntroduced',
  'itemsBlack',
  'kanaBrown',
  'vocabBrown',
  'katakanaBrown',
  'kanjiBrown',
  'grammarBrown',
  'scrolls',
  'scrollsFlawless',
  'michikusaRead',
  'episodesRead',
  'episodesDictionaryFree',
  'speedReads',
  'speedReadBestCpm',
  'listeningSets',
  'listeningFastPasses',
  'dictationLines',
  'dictation95at1x',
  'shadowLines',
  'shadowPass',
  'rolePlays',
  'rolePlaysAllBest',
  'rolePlaysAizuchi',
  'threeWays',
  'threeWaysCorrect',
  'monologues',
  'monologueBestWords',
  'reduceExpand',
  'writings',
  'weakSetsCleared',
  'formChains',
  'formChainsPerfect',
  'particleSlots',
  'particleSlotsCorrect',
  'minimalPairTrials',
  'minimalPairCorrect',
  'judgeChecks',
  'judgePasses',
  /** Judge passes / checks over the last 200, 0–1. */
  'honesty',
  'rapidRuns',
  'rapidBest',
  'gojuonRuns',
  'gojuonBest',
  'gojuonPerfects',
  'nemesisDefeated',
  'kageRuns',
  'revengeWins',
  'fieldMissions',
  'conversations',
  'comebacks',
  'exports',
  'imports',
  // design 08 §12 — listening counters
  /** Minutes of 茶屋ラジオ actually played (`listen:played` with `source: 'radio'`). */
  'radioMinutes',
  /** First hearings on either surface: an Arena set on a text not yet in `progress.listened`, or a cold Radio track whose gist question was answered. */
  'coldSets',
  /** Cold sets passed (Arena ≥ `PASS_RATIO`) or cold Radio gist questions answered correctly. */
  'coldSetsPassed',
  /** Authentic-style listening (bridge / `AUTHENTIC_GENRES` / casual dialogue) at ≥ 1.0×, understood; feeds the 耳 cap with the ledger's outside hours. */
  'listeningAuthenticMinutes',
  /** Highest speed tier at which a `listening:set` with every question right (`total ≥ 3`) was passed; seeded from `settings.speedTier` at migration. */
  'bestCleanTier',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export interface DailyRow {
  reps: number;
  ok: number;
  minutes: number;
  xp: number;
  /** Input minutes (stories, listening, ledger). */
  input: number;
}

export interface Perapera {
  /** `YYYY-MM` → [語彙, 耳, 読, 口, 場]. */
  months: Record<string, [number, number, number, number, number]>;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Documents                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const SAVE_SCHEMA = 'tsuzuku.save/1' as const;
export const CARDS_SCHEMA = 'tsuzuku.cards/1' as const;
export const LOG_SCHEMA = 'tsuzuku.log/1' as const;

export interface SaveMeta {
  schema: typeof SAVE_SCHEMA;
  seed: string;
  createdAt: number;
  updatedAt: number;
  contentVersion: string;
  profile: Profile;
  settings: Settings;
  streak: Streak;
  progress: Progress;
  quests: Quests;
  collections: Collections;
  kage: KageState;
  weakPoints: WeakPoints;
  ledger: Ledger;
  stats: Stats;
  /** Rolling median latency per drill, ms. */
  medianMs: Partial<Record<DrillId, number>>;
  /** Item ids captured while reading / on missions (new-item queue). */
  captured: string[];
  /** Free-text bookmarks ("two things you couldn't say"). */
  bookmarks: string[];
  perapera: Perapera;
  daily: Record<EpochDay, DailyRow>;
}

export const SLICE_KEYS = [
  'profile',
  'settings',
  'streak',
  'progress',
  'quests',
  'collections',
  'kage',
  'weakPoints',
  'ledger',
  'stats',
  'medianMs',
  'captured',
  'bookmarks',
  'perapera',
  'daily',
] as const;
export type SliceKey = (typeof SLICE_KEYS)[number];

export type ShardKind = 'kana' | 'vocab' | 'kanji' | 'grammar' | 'misc';
export const SHARD_KINDS = ['kana', 'vocab', 'kanji', 'grammar', 'misc'] as const;

/** `tsuzuku.cards.v1.<kind>.<level>` — sharded by kind AND level from day 0. */
export interface CardShard {
  schema: typeof CARDS_SCHEMA;
  kind: ShardKind;
  level: Level;
  cards: Record<CardKey, CardTuple>;
}

/** `tsuzuku.log.v1`. */
export interface ReviewLog {
  schema: typeof LOG_SCHEMA;
  entries: LogEntry[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Store interface (shape of `src/store/index.ts`)                            */
/* ────────────────────────────────────────────────────────────────────────── */

export type StorageLevel = 'ok' | 'warn' | 'ceiling';
export interface StorageState {
  bytes: number;
  level: StorageLevel;
}

export interface CardsApi {
  get(k: CardKey): CardTuple | undefined;
  set(k: CardKey, t: CardTuple): void;
  delete(k: CardKey): void;
  byItem(itemId: string): Partial<Record<Facet, CardTuple>>;
  dueOn(day: EpochDay): CardKey[];
  forEach(fn: (k: CardKey, t: CardTuple) => void): void;
  count(): number;
  /** Bumps on every write; UI reads it to recompute derived models. */
  version: Signal<number>;
}

export interface LogApi {
  push(e: LogEntry): void;
  recent(n: number): LogEntry[];
  forCard(k: CardKey): LogEntry[];
}

export interface SessionApi<S = SessionSnapshot> {
  load(): S | null;
  save(s: S): void;
  clear(): void;
}

export type StoreSlices = { readonly [K in SliceKey]: Signal<SaveMeta[K]> };

export interface Store<S = SessionSnapshot> extends StoreSlices {
  ready: Signal<boolean>;
  meta(): SaveMeta;
  seed(): string;
  now(): number;
  today(): EpochDay;
  /** Immutable update → signal → debounced persist. */
  patch<K extends SliceKey>(k: K, fn: (prev: SaveMeta[K]) => SaveMeta[K]): void;
  cards: CardsApi;
  log: LogApi;
  session: SessionApi<S>;
  storage: Signal<StorageState>;
  flush(): Promise<void>;
}

export interface InitStoreOptions {
  slot?: number;
  now?: () => number;
  storage?: Storage;
}
