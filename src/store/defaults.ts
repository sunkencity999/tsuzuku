/**
 * TSUZUKU — fresh-learner defaults (store group B).
 *
 * `freshSave(now, tz)` is the SaveMeta a brand-new learner starts from
 * (schema `tsuzuku.save/1`). `INTENSITY_PRESETS` is the design 03 §4 table;
 * `newPerDayFor(belt, intensity)` applies the Standard rates of design 02 §6.1
 * scaled by the preset; `effectiveNewPerDay(settings, belt)` is the one rule
 * for the mix a learner actually gets (own numbers when `custom`, else the
 * belt table) — the forecast, the projection, the Road page and the session
 * pickers all read it from here. Pure: `now` and `tz` are injected; the only
 * entropy is `randomSeed()` (shared/hash.ts), used once for `seed`.
 *
 * Listening (design 08 §11–§13): `settings.audioSource` starts at `'pack'` and
 * `dataSaver` off (the shell flips it on under `navigator.connection.saveData`;
 * the default stays pure), `progress.listened` / `teachSeen` start empty, and
 * the five listening counters start at 0 except `bestCleanTier`, which a NEW
 * save starts at `FRESH_BEST_CLEAN_TIER` (1); an existing save is seeded from
 * its `speedTier` by `migrations.fillMeta` so no 耳 radar drops on upgrade.
 */
import { BELTS, ERROR_TAGS, type Belt } from '../content/types';
import { randomSeed } from '../shared/hash';
import {
  SAVE_SCHEMA,
  STAT_KEYS,
  type Intensity,
  type Retention,
  type SaveMeta,
  type Settings,
  type Stats,
  type WeakPoints,
} from '../shared/store-types';

export type NewPerDay = Settings['newPerDay'];

export interface IntensityPreset {
  /** N5 (Yellow/Orange) new-item mix; other belts via `newPerDayFor`. */
  newPerDay: NewPerDay;
  /** White–Orange base review cap; belt-scaled by `learn/governors.capFor`. */
  maxReviews: number;
  retention: Retention;
}

/** Design 03 §4: Casual 5 · Standard 8.75 (7/1/0.75) · Intense 16 new items/day at N5. */
export const INTENSITY_PRESETS: Record<Exclude<Intensity, 'custom'>, IntensityPreset> = {
  casual: { newPerDay: { vocab: 4, kanji: 0.6, grammar: 0.4 }, maxReviews: 80, retention: 0.85 },
  standard: { newPerDay: { vocab: 7, kanji: 1, grammar: 0.75 }, maxReviews: 160, retention: 0.9 },
  intense: { newPerDay: { vocab: 13, kanji: 1.8, grammar: 1.2 }, maxReviews: 300, retention: 0.9 },
};

/** Kana introduced per day at White (design 02 §6.1: "20 kana + 4 words"). */
export const KANA_PER_DAY = 20;

/** Standard new-item rates per belt (design 02 §6.1). */
export const STANDARD_NEW_PER_DAY: Record<Belt, NewPerDay> = {
  white: { vocab: 4, kanji: 0, grammar: 0 },
  yellow: { vocab: 7, kanji: 1, grammar: 0.75 },
  orange: { vocab: 7, kanji: 1, grammar: 0.75 },
  green: { vocab: 8, kanji: 2.5, grammar: 1 },
  blue: { vocab: 12, kanji: 2.5, grammar: 0.8 },
  purple: { vocab: 12, kanji: 2.5, grammar: 0.8 },
  brown: { vocab: 14, kanji: 3, grammar: 0.8 },
  black: { vocab: 14, kanji: 0, grammar: 0.7 },
};

const STANDARD_TOTAL = 7 + 1 + 0.75;

/** Preset ÷ Standard at N5 (5 / 8.75 / 16 ÷ 8.75); `custom` keeps the learner's own numbers. */
export const INTENSITY_SCALE: Record<Exclude<Intensity, 'custom'>, number> = {
  casual: 5 / STANDARD_TOTAL,
  standard: 1,
  intense: 16 / STANDARD_TOTAL,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * New-item mix for `belt` at `intensity`. For `'custom'` the Standard belt
 * rates are returned; callers should prefer `settings.newPerDay` in that case.
 */
export function newPerDayFor(belt: Belt, intensity: Intensity): NewPerDay {
  const base = STANDARD_NEW_PER_DAY[belt];
  const k = intensity === 'custom' ? 1 : INTENSITY_SCALE[intensity];
  return { vocab: round2(base.vocab * k), kanji: round2(base.kanji * k), grammar: round2(base.grammar * k) };
}

/**
 * The new-item mix a learner actually gets at `belt`: `settings.newPerDay`
 * when the intensity is `'custom'` (the learner's own numbers), else the belt
 * table at the preset (`newPerDayFor`). Every preset follows the belt, so the
 * White mix frozen into `settings.newPerDay` at onboarding never leaks into
 * later belts.
 */
export function effectiveNewPerDay(settings: Pick<Settings, 'intensity' | 'newPerDay'>, belt: Belt): NewPerDay {
  return settings.intensity === 'custom' ? settings.newPerDay : newPerDayFor(belt, settings.intensity);
}

/** Total new items/day (vocab + kanji + grammar) for a belt at a preset. */
export function newPerDayTotal(n: NewPerDay): number {
  return n.vocab + n.kanji + n.grammar;
}

/** Curriculum level a station teaches (station 0 → White's level). */
export function beltForStation(station: number): Belt {
  for (const b of BELTS) if (station >= b.stations[0] && station <= b.stations[1]) return b.id;
  return station <= 0 ? 'white' : 'black';
}

/**
 * `stats.bestCleanTier` of a brand-new save (design 08 §12): the lowest speed
 * tier, since no clean listening set has been shown yet. An existing save is
 * seeded from its `settings.speedTier` by `migrations.fillMeta` instead.
 */
export const FRESH_BEST_CLEAN_TIER = 1;

export function freshStats(): Stats {
  const s = {} as Record<string, number>;
  for (const k of STAT_KEYS) s[k] = 0;
  s.bestCleanTier = FRESH_BEST_CLEAN_TIER;
  return s as Stats;
}

export function freshWeakPoints(): WeakPoints {
  const w = {} as Record<string, WeakPoints[keyof WeakPoints]>;
  for (const t of ERROR_TAGS) w[t] = { n: 0, ewma: 0, active: false, peak: 0 };
  return w as WeakPoints;
}

export function defaultSettings(): Settings {
  const p = INTENSITY_PRESETS.standard;
  return {
    intensity: 'standard',
    newPerDay: newPerDayFor('white', 'standard'),
    maxReviews: p.maxReviews,
    retention: p.retention,
    feel: 'dojo',
    theme: 'auto',
    restDay: null,
    furigana: 'fog',
    jj: false,
    classicGrading: false,
    speedTier: 2,
    speaking: 'self',
    writing: false,
    reducedMotion: false,
    sound: 0.8,
    crt: false,
    verticalText: false,
    // "Speed affects grading": default off in Zen, on otherwise; the default feel is Dojo.
    speedGrading: true,
    // design 08 §13: pre-rendered VOICEVOX clips when the build ships a pack (per-clip fallback to the
    // device voice); data saver off — the shell turns it on under `navigator.connection.saveData`.
    audioSource: 'pack',
    dataSaver: false,
  };
}

/**
 * A fresh SaveMeta. `streak.lastDay = 0` and `quests.day = 0` are the
 * "never" sentinels (EpochDay 0 = 1970-01-01, before any learner existed).
 */
export function freshSave(now: number, tz: string): SaveMeta {
  return {
    schema: SAVE_SCHEMA,
    seed: randomSeed().slice(0, 16),
    createdAt: now,
    updatedAt: now,
    contentVersion: '',
    profile: {
      name: '無名',
      nameKana: 'むめい',
      belt: 'white',
      dan: 0,
      level: 1,
      xp: 0,
      startedAt: now,
      tz,
      goals: [],
      kanaKnown: [],
    },
    settings: defaultSettings(),
    streak: {
      current: 0,
      longest: 0,
      lastDay: 0,
      totalDays: 0,
      freezes: 0,
      repairs: 0,
      restDaysTaken: 0,
      weekly: 0,
      emberRestores: 0,
    },
    progress: {
      station: 0,
      stationsCleared: [],
      perfectGates: 0,
      assisted: [],
      gateAttempts: {},
      gateAttemptDay: {},
      gateAttemptAt: {},
      grudge: [],
      shinsaPassed: [],
      awayDays: 0,
      welcomeBackDue: false,
      storiesRead: [],
      // design 08 §10–§11: text ids heard in the Arena, Radio or Read-along; teach cards dismissed.
      listened: [],
      teachSeen: [],
    },
    quests: { day: 0, ids: [], done: [] },
    collections: { badges: {}, wallpapers: {}, stamps: {}, michikusa: [] },
    kage: { week: 0, best4: [], wins: 0, history: [] },
    weakPoints: freshWeakPoints(),
    ledger: { entries: [], monthly: {}, missions: [] },
    stats: freshStats(),
    medianMs: {},
    captured: [],
    bookmarks: [],
    perapera: { months: {} },
    daily: {},
  };
}
