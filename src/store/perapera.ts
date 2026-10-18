/**
 * TSUZUKU — the Perapera Index (ぺらぺら指数), design 05 §11.
 *
 * Five axes, 0–100 each, computed on demand from the cards, the stats
 * counters and the ledger — no nightly job on a static site:
 *
 *  語彙  0.6 · ΣR(rec) / 10,000 + 0.4 · ΣR(prod) / 6,000, × 100, capped
 *  耳    20 · speedTier · clamp(dictationAcc / 0.9, 0.5, 1); held at 70 until the
 *        ledger holds 20 h of outside listening (listen + watch); always
 *        "(synthetic)" because every in-app voice is TTS
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
import { bus } from '../shared/events';
import type { CardTuple, EpochDay, SaveMeta, Store } from '../shared/store-types';
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
export const EAR_CAP = 70;
export const EAR_CAP_HOURS = 20;
/**
 * Design 08 §12 interim — the hours the dojo alone can carry a learner to ("The dojo alone can carry
 * you to about {reach} h"), §12's "20 h is reachable in Black". Fills the `{reach}` slot of
 * `S.explainEarCap` until the store-listening owner replaces it with the corpus-walk figure
 * (beside `EAR_CAP_STEP_HOURS`; `perapera.test.ts` then walks the inventory).
 */
export const EAR_REACH_HOURS = 20;
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

function dayIn(ms: number, tz: string): EpochDay {
  try {
    return epochDay(ms, tz);
  } catch {
    return epochDay(ms);
  }
}

/** Hours of external `listen` + `watch` minutes in the ledger (the 耳 cap). */
export function externalListeningHours(m: SaveMeta): number {
  let minutes = 0;
  for (const e of m.ledger.entries) if (e[3] === 1 && (e[2] === 0 || e[2] === 2)) minutes += e[1];
  return minutes / 60;
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

/** `dictationAcc` null = no dictation evidence yet (the 0.5 floor applies). */
export function earAxis(speedTier: number, dictationAcc: number | null, externalHours: number): number {
  const factor = dictationAcc === null ? 0.5 : clamp(dictationAcc / DICTATION_TARGET, 0.5, 1);
  let ear = 20 * clamp(speedTier, 1, 5) * factor;
  if (externalHours < EAR_CAP_HOURS) ear = Math.min(ear, EAR_CAP);
  return clamp(ear, 0, 100);
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

  // 耳 (synthetic)
  const hours = externalListeningHours(m);
  const dictationAcc = st.dictationLines > 0 ? ratio(st.dictation95at1x, st.dictationLines) : null;
  const ear = earAxis(m.settings.speedTier, dictationAcc, hours);
  let explainEar = dictationAcc === null ? fill(S.explainEarNoData, { tier: m.settings.speedTier }) : fill(S.explainEar, { tier: m.settings.speedTier, acc: pct(dictationAcc) });
  // S.explainEarCap slots (design 08 §12, contract tier): {cap, goal, app, ext, reach}. `app` reads the new
  // listeningAuthenticMinutes counter (0 until the listening surfaces write it); the cap formula itself is unchanged here.
  if (hours < EAR_CAP_HOURS) {
    explainEar +=
      ' ' + fill(S.explainEarCap, { cap: EAR_CAP, goal: EAR_CAP_HOURS, app: Math.round((st.listeningAuthenticMinutes / 60) * 10) / 10, ext: Math.round(hours * 10) / 10, reach: EAR_REACH_HOURS });
  }

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
