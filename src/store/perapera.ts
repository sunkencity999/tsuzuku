/**
 * TSUZUKU — the Perapera Index (ぺらぺら指数), design 05 §11.
 *
 * Five axes, 0–100 each, computed on demand from the cards, the stats
 * counters and the ledger — no nightly job on a static site:
 *
 *  語彙  0.6 · ΣR(rec) / 10,000 + 0.4 · ΣR(prod) / 6,000, × 100, capped
 *  耳    design 08 §12 (replaces 05 §11's row):
 *          tier      = min(settings.speedTier, max(1, stats.bestCleanTier))
 *          base      = 20 · tier · clamp(dictationAcc / 0.9, 0.5, 1)
 *          comp      = coldSets ≥ 10 ? clamp(coldPassRate / 0.8, 0.5, 1) : 1
 *          authentic = outside listen + watch hours + listeningAuthenticMinutes / 60
 *          cap       = authentic < 7.5 ? 70 : authentic < 15 ? 85 : 100   (EAR_CAP_STEP_HOURS)
 *          ear       = min(cap, base · comp)
 *        The radar reads the tier the learner has SHOWN (a clean set), never
 *        only the dial; comp is comprehension on first hearing, either
 *        surface. Always "(synthetic)": every in-app voice is a VOICEVOX
 *        character voice; the ledger's outside hours are real people. The
 *        explain line names both hour components and REACHABLE_IN_APP_HOURS,
 *        the figure the dojo alone can carry a learner to — pinned from the
 *        corpus inventory (DISTINCT_AUTHENTIC_HOURS × (one Arena set ≈ 2.5×
 *        the speech + two Radio re-hearings)); `perapera.test.ts` walks
 *        `public/content` so the sentence cannot drift from the content.
 *  読    best Speed Read cpm / 500 × 100, capped (the save holds no per-episode
 *        cpm history, so the best stands in for the design's rolling median
 *        and the explanation says so)
 *  口    recognition: 50 · shadowPassRate + 50 · min(1, monologueWpm / 100)
 *        self-assessment: 70 · shadowPassRate + 30 · min(1, monologues / 30), "(estimated)"
 *        voice off: no reading, "(no voice)"
 *  場    50 · rolePlayBestRate + 50 · threeWaysAccuracy; "—" before Station 21
 *
 * Composite = mean of the axes with data. `snapshotMonth` stores the vector
 * under `perapera.months[YYYY-MM]` for the radar-over-time view (day roll).
 * The rates use the lifetime `stats` counters because SaveMeta carries no
 * rolling windows for them; `explain` tells the learner what each number is.
 */
import { cardRetrievability } from '@/learn';
import type { CardKey } from '../content/types';
import { SPEED_TIER_RATES } from '../shared/audio';
import { bus } from '../shared/events';
import type { CardTuple, EpochDay, SaveMeta, SpeedTier, Store } from '../shared/store-types';
import { epochDay, monthKey } from '../shared/time';
import { S, fill } from './defs-strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export type Axes = [number, number, number, number, number];

export const PERAPERA_LABELS: readonly [string, string, string, string, string] = [S.peraperaVocab, S.peraperaEar, S.peraperaRead, S.peraperaMouth, S.peraperaRegister];
export const PERAPERA_LABELS_EN: readonly [string, string, string, string, string] = [S.peraperaVocabEn, S.peraperaEarEn, S.peraperaReadEn, S.peraperaMouthEn, S.peraperaRegisterEn];

export const VOCAB_REC_TARGET = 10_000;
export const VOCAB_PROD_TARGET = 6_000;
/**
 * 耳 cap steps (design 08 §12, lead decision in the CHANGELOG): 70 below
 * `EAR_CAP_STEP_HOURS[0]` h of authentic listening, 85 below `[1]`, 100 from
 * there. `EAR_GOAL_HOURS` is the top step, the `{goal}` of `S.explainEarCap`.
 */
export const EAR_CAP_STEP_HOURS: readonly [number, number] = [7.5, 15];
export const EAR_CAP_STEPS: readonly [number, number, number] = [70, 85, 100];
/** The floor cap (no authentic listening yet). */
export const EAR_CAP = EAR_CAP_STEPS[0];
export const EAR_GOAL_HOURS = EAR_CAP_STEP_HOURS[1];
/** First hearings before comprehension on first hearing enters the 耳 axis, and the pass rate that reads as full. */
export const COLD_SETS_MIN = 10;
export const COLD_PASS_TARGET = 0.8;
/**
 * How far the dojo alone carries authentic listening (design 08 §12): an
 * Arena set runs ≈ `ARENA_SET_FACTOR` × the speech it holds, and two Radio
 * re-hearings at ≥ 1.0× with the gist question (`RADIO_REHEARINGS`) add the
 * speech length each. `DISTINCT_AUTHENTIC_HOURS` is the corpus inventory —
 * bridge texts + casual non-bridge dialogues + `AUTHENTIC_GENRES` pieces,
 * each rendered once — under the app's own speech estimate (`learn/pool.ts`:
 * morae ÷ 7 per second + 0.5 s a line): the shipped bridge 25 ≈ 0.96 h +
 * casual 29 ≈ 0.63 h, plus ≈ 2.4 h for the ≈ 48 authentic-genre pieces of
 * the §3 program (Orange `casual-talk`, Blue–Black `interview` / `news` /
 * `drama` / `debate` / `lecture` / `casual-talk`) at ≈ 86 % of their §3
 * length caps, between the ≈ 78 % the Yellow–Green pieces fill and the cap
 * itself. (§12's "4.8 h" quoted a looser estimator: 1.1 + 0.7 h for the same
 * bridge + casual texts.) `perapera.test.ts` walks `public/content`: the
 * walked figure never exceeds `REACHABLE_IN_APP_HOURS` (the `{reach}` of
 * `S.explainEarCap`), and once every quota piece exists it must equal it —
 * so the sentence cannot drift from the content; the failing title names the
 * figure to write here.
 */
export const ARENA_SET_FACTOR = 2.5;
export const RADIO_REHEARINGS = 2;
export const DISTINCT_AUTHENTIC_HOURS = 4.0;
/** Hours of authentic listening the dojo yields from `distinctHours` of authentic texts, rounded. */
export function reachableInAppHours(distinctHours: number): number {
  return Math.round(distinctHours * (ARENA_SET_FACTOR + RADIO_REHEARINGS));
}
export const REACHABLE_IN_APP_HOURS = reachableInAppHours(DISTINCT_AUTHENTIC_HOURS);
export const DICTATION_TARGET = 0.9;
export const READ_TARGET_CPM = 500;
export const MONOLOGUE_TARGET_WPM = 100;
export const MONOLOGUE_TARGET_COUNT = 30;
export const REGISTER_FROM_STATION = 21;

export interface PeraperaResult {
  /** 0–100 each; an unavailable axis reads 0. */
  axes: Axes;
  /** `語彙 耳 読 口 場`; `—` replaces an axis without data. */
  labels: string[];
  /** Mean of the available axes, rounded. */
  composite: number;
  /** `(synthetic)` always; `(estimated)` on the self-assessment path; `(no voice)` with voice off. */
  flags: string[];
  /** One sentence per axis saying what the number is made of. */
  explain: [string, string, string, string, string];
  available: [boolean, boolean, boolean, boolean, boolean];
}

export interface CardWalker {
  forEach(fn: (k: CardKey, t: CardTuple) => void): void;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pieces                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function ratio(num: number, den: number): number {
  return den > 0 ? clamp(num / den, 0, 1) : 0;
}

function pct(x: number): number {
  return Math.round(x * 100);
}

function tenth(x: number): number {
  return Math.round(x * 10) / 10;
}

function dayIn(ms: number, tz: string): EpochDay {
  try {
    return epochDay(ms, tz);
  } catch {
    return epochDay(ms);
  }
}

/** Hours of external `listen` + `watch` minutes in the ledger (real people; one input of the 耳 cap). */
export function externalListeningHours(m: SaveMeta): number {
  let minutes = 0;
  for (const e of m.ledger.entries) if (e[3] === 1 && (e[2] === 0 || e[2] === 2)) minutes += e[1];
  return minutes / 60;
}

/** Hours of authentic-style listening heard in the dojo (`stats.listeningAuthenticMinutes`, design 08 §12). */
export function appAuthenticHours(m: SaveMeta): number {
  const mins = m.stats.listeningAuthenticMinutes;
  return Number.isFinite(mins) && mins > 0 ? mins / 60 : 0;
}

/** The 耳 cap input: outside listen + watch hours + the dojo's authentic minutes / 60 (design 08 §12). */
export function authenticListeningHours(m: SaveMeta): number {
  return externalListeningHours(m) + appAuthenticHours(m);
}

/** ΣR over vocab (`v-`) `rec` and `prod` cards today. Chunks count through `prod`. */
export function vocabRetrievability(cards: CardWalker, today: EpochDay): { rec: number; prod: number; recCards: number; prodCards: number } {
  let rec = 0;
  let prod = 0;
  let recCards = 0;
  let prodCards = 0;
  cards.forEach((k, t) => {
    if (!k.startsWith('v-')) return;
    const facet = k.slice(k.lastIndexOf('#') + 1);
    if (facet === 'rec') {
      rec += cardRetrievability(t, today);
      recCards++;
    } else if (facet === 'prod') {
      prod += cardRetrievability(t, today);
      prodCards++;
    }
  });
  return { rec, prod, recCards, prodCards };
}

export function vocabAxis(sumRec: number, sumProd: number): number {
  return clamp((0.6 * sumRec) / VOCAB_REC_TARGET + (0.4 * sumProd) / VOCAB_PROD_TARGET, 0, 1) * 100;
}

export interface EarInput {
  /** `settings.speedTier` — the dial. */
  speedTier: number;
  /** `stats.bestCleanTier` — the fastest set with every question right (`total ≥ 3`). */
  bestCleanTier: number;
  /** `dictation95at1x / dictationLines`; null = no dictation evidence yet (the 0.5 floor applies). */
  dictationAcc: number | null;
  /** `authenticListeningHours(m)`. */
  authenticHours: number;
  /** `coldSetsPassed / coldSets`; ignored below `COLD_SETS_MIN` first hearings. */
  coldPassRate: number;
  coldSets: number;
}

/** The tier the radar reads: the dial, capped by the tier the learner has shown (never below 1). */
export function earTier(speedTier: number, bestCleanTier: number): SpeedTier {
  const shown = Number.isFinite(bestCleanTier) ? Math.max(1, Math.floor(bestCleanTier)) : 1;
  const dial = Number.isFinite(speedTier) ? speedTier : 1;
  return clamp(Math.min(dial, shown), 1, 5) as SpeedTier;
}

/** 20 · tier · clamp(acc / 0.9, 0.5, 1). */
export function earBase(tier: number, dictationAcc: number | null): number {
  const factor = dictationAcc === null ? 0.5 : clamp(dictationAcc / DICTATION_TARGET, 0.5, 1);
  return 20 * clamp(tier, 1, 5) * factor;
}

/** Comprehension on first hearing: 1 until `COLD_SETS_MIN` first hearings, then clamp(rate / 0.8, 0.5, 1). */
export function earComp(coldSets: number, coldPassRate: number): number {
  if (!(coldSets >= COLD_SETS_MIN)) return 1;
  return clamp((Number.isFinite(coldPassRate) ? coldPassRate : 0) / COLD_PASS_TARGET, 0.5, 1);
}

/** 70 / 85 / 100 at the `EAR_CAP_STEP_HOURS` steps of authentic listening. */
export function earCap(authenticHours: number): number {
  const h = Number.isFinite(authenticHours) ? authenticHours : 0;
  return h < EAR_CAP_STEP_HOURS[0] ? EAR_CAP_STEPS[0] : h < EAR_CAP_STEP_HOURS[1] ? EAR_CAP_STEPS[1] : EAR_CAP_STEPS[2];
}

/** The 耳 axis, design 08 §12: `min(cap, base · comp)`, to six decimals so `100 · (0.6 / 0.8)` reads 75, not 74.999…. */
export function earAxis(i: EarInput): number {
  const tier = earTier(i.speedTier, i.bestCleanTier);
  const ear = earBase(tier, i.dictationAcc) * earComp(i.coldSets, i.coldPassRate);
  return Math.round(clamp(Math.min(earCap(i.authenticHours), ear), 0, 100) * 1e6) / 1e6;
}

export function readAxis(bestCpm: number): number {
  return clamp(bestCpm / READ_TARGET_CPM, 0, 1) * 100;
}

export function mouthAxis(recognition: boolean, shadowRate: number, monologueWpm: number, monologues: number): number {
  const v = recognition
    ? 50 * shadowRate + 50 * Math.min(1, monologueWpm / MONOLOGUE_TARGET_WPM)
    : 70 * shadowRate + 30 * Math.min(1, monologues / MONOLOGUE_TARGET_COUNT);
  return clamp(v, 0, 100);
}

export function registerAxis(rolePlayBestRate: number, threeWaysAccuracy: number): number {
  return clamp(50 * rolePlayBestRate + 50 * threeWaysAccuracy, 0, 100);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* peraperaNow                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function peraperaNow(m: SaveMeta, cards: CardWalker, now: number): PeraperaResult {
  const today = dayIn(now, m.profile.tz);
  const st = m.stats;

  // 語彙
  const v = vocabRetrievability(cards, today);
  const vocab = vocabAxis(v.rec, v.prod);
  const explainVocab = fill(S.explainVocab, { rec: v.recCards, prod: v.prodCards });

  // 耳 (synthetic) — design 08 §12
  const ext = externalListeningHours(m);
  const app = appAuthenticHours(m);
  const authentic = ext + app;
  const dictationAcc = st.dictationLines > 0 ? ratio(st.dictation95at1x, st.dictationLines) : null;
  const coldSets = Number.isFinite(st.coldSets) ? st.coldSets : 0;
  const coldPassRate = ratio(st.coldSetsPassed, coldSets);
  const tier = earTier(m.settings.speedTier, st.bestCleanTier);
  const ear = earAxis({ speedTier: m.settings.speedTier, bestCleanTier: st.bestCleanTier, dictationAcc, authenticHours: authentic, coldPassRate, coldSets });
  const earLines: string[] = [dictationAcc === null ? fill(S.explainEarNoData, { tier }) : fill(S.explainEar, { tier, acc: pct(dictationAcc) })];
  // The dial sits above the tier shown: name the fastest clean set so the lower reading is explained.
  if (tier < m.settings.speedTier) earLines.push(fill(S.explainEarTier, { tier, rate: SPEED_TIER_RATES[tier] }));
  // Comprehension on first hearing, once there is any (the factor itself waits for COLD_SETS_MIN).
  if (coldSets > 0) earLines.push(fill(S.explainEarComp, { passed: st.coldSetsPassed, sets: coldSets, rate: pct(coldPassRate) }));
  // Below the top step: both hour components and how far the dojo alone can carry it.
  if (authentic < EAR_GOAL_HOURS) earLines.push(fill(S.explainEarCap, { cap: earCap(authentic), goal: EAR_GOAL_HOURS, app: tenth(app), ext: tenth(ext), reach: REACHABLE_IN_APP_HOURS }));
  const explainEar = earLines.join(' ');

  // 読
  const read = readAxis(st.speedReadBestCpm);
  const explainRead = st.speedReadBestCpm > 0 ? fill(S.explainRead, { cpm: Math.round(st.speedReadBestCpm) }) : S.explainReadNoData;

  // 口
  const speaking = m.settings.speaking;
  const voiceOff = speaking === 'off';
  const recognition = speaking === 'recognition' || speaking === 'auto';
  const shadowRate = ratio(st.shadowPass, st.shadowLines);
  const mouth = voiceOff ? 0 : mouthAxis(recognition, shadowRate, st.monologueBestWords, st.monologues);
  const explainMouth = voiceOff
    ? S.explainMouthOff
    : recognition
      ? fill(S.explainMouthRecognition, { rate: pct(shadowRate), wpm: Math.round(st.monologueBestWords) })
      : fill(S.explainMouthSelf, { rate: pct(shadowRate), n: Math.min(MONOLOGUE_TARGET_COUNT, st.monologues) });

  // 場
  const registerAvailable = m.progress.station >= REGISTER_FROM_STATION;
  const bestRate = ratio(st.rolePlaysAllBest, st.rolePlays);
  const threeWaysAcc = ratio(st.threeWaysCorrect, st.threeWays);
  const register = registerAvailable ? registerAxis(bestRate, threeWaysAcc) : 0;
  const explainRegister = registerAvailable ? fill(S.explainRegister, { best: pct(bestRate), acc: pct(threeWaysAcc) }) : S.explainRegisterUnavailable;

  const axes: Axes = [Math.round(vocab), Math.round(ear), Math.round(read), Math.round(mouth), Math.round(register)];
  const available: PeraperaResult['available'] = [true, true, true, !voiceOff, registerAvailable];
  const used = axes.filter((_, i) => available[i]);
  const composite = used.length ? Math.round(used.reduce((a, b) => a + b, 0) / used.length) : 0;

  const labels = [...PERAPERA_LABELS];
  if (voiceOff) labels[3] = S.peraperaUnavailable;
  if (!registerAvailable) labels[4] = S.peraperaUnavailable;

  const flags: string[] = [S.flagSynthetic];
  if (voiceOff) flags.push(S.flagNoVoice);
  else if (!recognition) flags.push(S.flagEstimated);

  return { axes, labels, composite, flags, explain: [explainVocab, explainEar, explainRead, explainMouth, explainRegister], available };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Monthly history                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PeraperaMonth {
  /** `YYYY-MM`. */
  month: string;
  axes: Axes;
}

/** Stored monthly vectors, oldest first. */
export function peraperaHistory(m: SaveMeta): PeraperaMonth[] {
  return Object.entries(m.perapera.months)
    .map(([month, axes]) => ({ month, axes: [...axes] as Axes }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/**
 * Write this month's vector (`perapera.months[YYYY-MM]`), replacing an
 * earlier snapshot of the same month. Called by the day roll; idempotent.
 */
export function snapshotMonth(store: Store): Axes {
  const axes = peraperaNow(store.meta(), store.cards, store.now()).axes;
  const key = monthKey(store.today());
  store.patch('perapera', (p) => {
    const prev = p.months[key];
    if (prev && prev.every((x, i) => x === axes[i])) return p;
    return { ...p, months: { ...p.months, [key]: axes } };
  });
  return axes;
}

/**
 * Keeps the monthly history: snapshots once at start (so the current month
 * always has a row) and again on every `day:rolled` (`store/day.ts` leaves the
 * snapshot to this module because it needs `@/learn`, which the store barrel
 * may not import). Wire it from the app shell after `initStore`.
 */
export function startPerapera(store: Store): () => void {
  try {
    snapshotMonth(store);
  } catch (err) {
    console.error('[perapera] snapshot failed', err);
  }
  return bus.on('day:rolled', () => {
    try {
      snapshotMonth(store);
    } catch (err) {
      console.error('[perapera] snapshot failed', err);
    }
  });
}
