/**
 * TSUZUKU — derived read-model (group B, contract tier; ARCHITECTURE §0).
 *
 * UI groups (A, E, F, G) import this file directly. It is NOT re-exported by
 * `src/store/index.ts` because it imports the pure learning core `@/learn`
 * (retrievability, item belts, known set, review caps). Every function reads
 * the live `store`; `peraperaNow` / `projectedArrival` (re-exported from
 * `./perapera` and `./projection`, which own the formulas) take explicit data
 * so Records can recompute on open and tests can run without the singleton.
 *
 * `dueCount` counts due REVIEWS (state ≠ 0, not archived/Kaiden — `./due`),
 * not every card whose due day has passed, so the end card and the forecast
 * agree with what a session serves.
 *
 * Module-plan API: dueCount, isBacklog, beltEligibility, stationProgress,
 * forecastCounts, knownVocabCount, projectedArrival, peraperaNow. Extras:
 * currentBelt, currentStation, knownCounts, itemBeltOf, peraperaIndex,
 * projection, projectRoad, snapshotMonth, startPerapera, xpToNextLevel,
 * streakState.
 */
import { BELT_ORDER, baseFacet, capFor, cardRetrievability, itemBelt, kindOfCards, knownSet } from '@/learn';
import { BELTS, type Belt, type Facet, type StationBundle } from '../content/types';
import { tryKindOfId } from '../shared/ids';
import type { CardTuple, CardsApi, EpochDay, ItemBelt, ItemKind, Streak } from '../shared/store-types';
import { effectiveNewPerDay, newPerDayTotal } from './defaults';
import { isDueReview } from './due';
import { store } from './store';
import { peraperaNow, type PeraperaResult } from './perapera';
import { ARRIVAL_STATION, SHINSA_STATIONS, beltOfStation, bundleItemIds, projectedArrival, type Projection } from './projection';
import { flameState } from './streak';

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** `kana`/`vocab`/`kanji`/`grammar`/`component` from an item id (chunks read as vocab). */
export function kindOfItem(itemId: string): ItemKind | null {
  const k = tryKindOfId(itemId);
  return k === 'kana' || k === 'vocab' || k === 'kanji' || k === 'grammar' || k === 'component' ? k : null;
}

function beltRank(b: ItemBelt): number {
  return BELT_ORDER.indexOf(b);
}

const GREEN = beltRank('green');
const BROWN = beltRank('brown');

/**
 * Item kind from an id and the facets it holds (`learn/known.kindOfCards`): a
 * vocab id with a `prod` card and no `rec` card is a chunk.
 */
export function kindFor(itemId: string, facets: Partial<Record<Facet, CardTuple>>): ItemKind | null {
  return kindOfCards(itemId, Object.keys(facets) as Facet[]) ?? null;
}

/** Item belt of `itemId` from its facet cards (White when it has no cards). */
export function itemBeltOf(itemId: string, kind?: ItemKind | null, cards: CardsApi = store.cards): ItemBelt {
  const facets = cards.byItem(itemId);
  const k = kind ?? kindFor(itemId, facets);
  if (!k) return 'white';
  return itemBelt(k, facets);
}

export { cardRetrievability };

/** Stations of a belt (inclusive range). */
export function beltStations(belt: Belt): [number, number] {
  const def = BELTS.find((b) => b.id === belt);
  return def ? def.stations : [1, 3];
}

/** Road geometry shared with `./projection` (one definition each; design 02 §1). */
export { beltOfStation, bundleItemIds, SHINSA_STATIONS };

/* ────────────────────────────────────────────────────────────────────────── */
/* Selectors (live store)                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export function currentBelt(): Belt {
  return store.profile.value.belt;
}

export function currentStation(): number {
  return store.progress.value.station;
}

/** Review cap for today (belt-scaled, `learn/governors.capFor`). */
export function reviewCap(): number {
  const s = store.settings.value;
  return capFor(s.intensity, currentBelt(), s.maxReviews);
}

/**
 * Due reviews on `day` (`./due.isDueReview`: never-reviewed state-0 cards,
 * archived and Kaiden excluded), the same set a session will actually serve.
 */
export function dueCount(day: EpochDay = store.today()): number {
  let n = 0;
  store.cards.forEach((_k, t) => {
    if (isDueReview(t, day)) n++;
  });
  return n;
}

/** Backlog mode: due > 2 × the belt-scaled cap (design 03 §5). */
export function isBacklog(): boolean {
  return dueCount() > 2 * reviewCap();
}

export interface BeltEligibility {
  /** Share of the belt's items at item belt ≥ Green. */
  coverageRec: number;
  /** Share at ≥ Brown. */
  coverageProd: number;
  gatesDone: boolean;
  eligible: boolean;
  total: number;
}

/** Design 02 §2: every Gatekeeper passed, ≥ 85 % Green and ≥ 50 % Brown of the belt's items. */
export function beltEligibility(belt: Belt, bundles: StationBundle[]): BeltEligibility {
  const [from, to] = beltStations(belt);
  const ids: string[] = [];
  for (const b of bundles) if (b.number >= from && b.number <= to) ids.push(...bundleItemIds(b));
  let green = 0;
  let brown = 0;
  for (const id of ids) {
    const r = beltRank(itemBeltOf(id));
    if (r >= GREEN) green++;
    if (r >= BROWN) brown++;
  }
  const total = ids.length;
  const coverageRec = total ? green / total : 0;
  const coverageProd = total ? brown / total : 0;
  const cleared = new Set(store.progress.value.stationsCleared);
  let gatesDone = true;
  for (let n = from; n <= to; n++) if (!cleared.has(n)) gatesDone = false;
  return { coverageRec, coverageProd, gatesDone, eligible: total > 0 && gatesDone && coverageRec >= 0.85 && coverageProd >= 0.5, total };
}

export interface StationProgress {
  introduced: number;
  total: number;
  green: number;
  /** Every item introduced and ≥ 80 % Green. */
  gateReady: boolean;
  cleared: boolean;
}

export function stationProgress(n: number, b: StationBundle): StationProgress {
  const ids = bundleItemIds(b);
  let introduced = 0;
  let green = 0;
  for (const id of ids) {
    const facets = store.cards.byItem(id);
    if (Object.keys(facets).length > 0) introduced++;
    const kind = kindFor(id, facets);
    if (kind && beltRank(itemBelt(kind, facets)) >= GREEN) green++;
  }
  const total = ids.length;
  return {
    introduced,
    total,
    green,
    gateReady: total > 0 && introduced === total && green >= Math.ceil(0.8 * total),
    cleared: store.progress.value.stationsCleared.includes(n),
  };
}

/** Median of the per-drill medians, seconds per rep (design 02 §6.1 budgets 8 s). */
export function medianRepSeconds(): number {
  const vals = Object.values(store.medianMs.value).filter((v): v is number => typeof v === 'number' && v > 0);
  if (vals.length === 0) return 8;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const ms = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return clamp(ms / 1000, 3, 15);
}

export interface ForecastCounts {
  due: number;
  newItems: number;
  minutes: { kata: number; kumite: number; shugyo: number };
}

/** Design 03 §2–§3: due counts × median latency + fixed block estimates (new-item mix via `defaults.effectiveNewPerDay`). */
export function forecastCounts(): ForecastCounts {
  const due = dueCount();
  const s = store.settings.value;
  const belt = currentBelt();
  const newItems = Math.round(newPerDayTotal(effectiveNewPerDay(s, belt)));
  const rep = medianRepSeconds();
  const cap = reviewCap();
  const inputMin = belt === 'white' || belt === 'yellow' || belt === 'orange' ? 5 : belt === 'green' ? 7 : belt === 'blue' || belt === 'purple' ? 9 : 12;
  const outputMin = belt === 'white' || belt === 'yellow' || belt === 'orange' ? 3 : belt === 'green' ? 4 : belt === 'blue' || belt === 'purple' ? 5 : 7;
  const kata = (Math.min(due, 25) * rep) / 60 + 0.5;
  const kumite = (Math.min(due, 20) * rep) / 60 + (newItems > 0 ? 5 : 0) + (15 * rep) / 60 + 1.5 + 0.5;
  const shugyo = 1.5 + (Math.min(due, cap) * rep) / 60 + (newItems > 0 ? 10 : 0) + inputMin + outputMin + 1;
  return { due, newItems, minutes: { kata: Math.round(kata), kumite: Math.round(kumite), shugyo: Math.round(shugyo) } };
}

/** Known = base-facet retrievability ≥ 0.85 now (`learn/known`). */
export function knownIds(today: EpochDay = store.today()): Set<string> {
  return knownSet(store.cards, today);
}

export function knownVocabCount(): number {
  let n = 0;
  for (const id of knownIds()) if (id.startsWith('v-')) n++;
  return n;
}

export type KnownCounts = Record<'kana' | 'vocab' | 'kanji' | 'grammar' | 'component', number>;

export function knownCounts(): KnownCounts {
  const out: KnownCounts = { kana: 0, vocab: 0, kanji: 0, grammar: 0, component: 0 };
  for (const id of knownIds()) {
    const k = kindOfItem(id);
    if (k && k !== 'chunk') out[k]++;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* XP and streak                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Design 02 §5: cumulative XP at which level `L` is reached. */
export function xpAtLevel(level: number): number {
  return 60 * level * level + 100 * level;
}

/** XP needed to go from `level` to `level + 1` (`160 + 120·L`). */
export function xpToNext(level: number): number {
  return 160 + 120 * level;
}

/** Level for a cumulative XP total, clamped to 1–99. */
export function levelFor(xp: number): number {
  let lo = 1;
  let hi = 99;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (xpAtLevel(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface XpProgress {
  level: number;
  xp: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level spans (0 at Lv 99). */
  needed: number;
  /** XP still missing for the next level. */
  remaining: number;
  /** 0–1. */
  progress: number;
}

export function xpToNextLevel(xp: number = store.profile.value.xp): XpProgress {
  const level = levelFor(xp);
  if (level >= 99) return { level, xp, into: xp - xpAtLevel(99), needed: 0, remaining: 0, progress: 1 };
  const floor = xpAtLevel(level);
  const needed = xpToNext(level);
  const into = clamp(xp - floor, 0, needed);
  return { level, xp, into, needed, remaining: needed - into, progress: needed ? into / needed : 1 };
}

export type FlameState = 'lit' | 'gold' | 'ember' | 'frozen' | 'rest' | 'broken';

/**
 * Flame state from the streak slice (design 03 §7). `store/streak.ts`
 * (`flameState`) owns the full state machine; this mirrors its visible states.
 */
export function streakStateOf(s: Streak, today: EpochDay, restDay: number | null, fullDay = false): FlameState {
  return flameState(s, today, restDay, fullDay);
}

export function streakState(): FlameState {
  const q = store.quests.value;
  const today = store.today();
  const fullDay = q.day === today && q.ids.length > 0 && q.ids.every((id) => q.done.includes(id));
  return streakStateOf(store.streak.value, today, store.settings.value.restDay, fullDay);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Perapera Index (design 05 §11) — `./perapera` owns the formula             */
/* ────────────────────────────────────────────────────────────────────────── */

export {
  PERAPERA_LABELS,
  PERAPERA_LABELS_EN,
  EAR_CAP_STEP_HOURS,
  EAR_CAP_STEPS,
  EAR_GOAL_HOURS,
  REACHABLE_IN_APP_HOURS,
  DISTINCT_AUTHENTIC_HOURS,
  authenticListeningHours,
  appAuthenticHours,
  externalListeningHours,
  peraperaHistory,
  peraperaNow,
  snapshotMonth,
  startPerapera,
} from './perapera';
export type { PeraperaResult, PeraperaMonth } from './perapera';

/** `peraperaNow` over the live store. */
export function peraperaIndex(): PeraperaResult {
  return peraperaNow(store.meta(), store.cards, store.now());
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Projected Arrival (design 02 §6.2) — `./projection` owns the formula       */
/* ────────────────────────────────────────────────────────────────────────── */

export {
  MIN_ACTIVE_DAYS,
  ARRIVAL_STATION,
  ROAD_BELTS,
  activeDaysIn,
  lifetimeActiveDays,
  itemsIntroducedIn,
  projectedArrival,
  projectRoad,
  onboardingEstimate,
} from './projection';
export type { Projection, RoadProjection, BeltEta, OnboardingEstimate } from './projection';

/** `projectedArrival` over the live store (target defaults to Sanjō Ōhashi = 53). */
export function projection(bundles: StationBundle[], target: number = ARRIVAL_STATION): Projection | null {
  return projectedArrival(store.meta(), store.cards, bundles, target, store.today(), store.log.recent(5000));
}
