/**
 * TSUZUKU — Gatekeeper (関守) boss (design 04 §11, 02 §1).
 *
 *  Available when every station item is introduced and ≥ 80 % are Green.
 *  Four phases, sampled 70 % this station / 30 % cumulative, weighted toward
 *  low retrievability:
 *    1 閃 Flash   20 recognition reps, 4 s each   — timed ONLY when the tested
 *    2 打 Strike  20 production reps, 12 s each     facet is mature (S ≥ 14 d)
 *                                                   and the drill is not
 *                                                   self-graded (a chunk's
 *                                                   shadow rep is never timed);
 *                                                   younger cards are untimed
 *    3 耳 Ear     12 station sentences at belt speed, untimed, 2 replays —
 *                 only story lines whose resolved tokens the learner all
 *                 knows; short of 12, the station's own pool examples whose
 *                 every word is known (design 08 §4, `listening/pool-NN.json`,
 *                 with their clip keys), then the station's own words (bare
 *                 word → kana) fill in, never an example with untaught words
 *    4 型 Final Form 3 prompts over station grammar, rubric Judge
 *  Timeouts count as a miss in the score and Hard in FSRS (`boss` grading);
 *  Guard counts as a miss, Again in FSRS, no combo penalty (writer). No lives.
 *  Pass: overall ≥ 85 % and every phase ≥ 70 %. Misses feed the 遺恨帳 Grudge
 *  List; a same-day rematch needs ≥ 20 Grudge reps trained AFTER the lost
 *  fight (its own Again rows never count; the fight's end is saved as
 *  `progress.gateAttemptAt`, so the baseline survives a reload), a new day
 *  opens the rematch by itself (`progress.gateAttemptDay`); the third non-pass offers the Assisted
 *  Gate (no timers, Final Form → 3 cloze, 80 %, provisional stamp); the
 *  Revenge Match is the full fight again. `rematchAllowed` is the one
 *  predicate every screen (intro, result, Station page) reads. Grudge List
 *  keys are read through `grudgeKeys()` (`./pickers`, re-exported; the
 *  builder's Grudge block draws the same keys into the day's Kata / Kumite /
 *  Shugyō so the 20 reps are reachable): only `isCardKey` entries count, so a
 *  hand-edited or older save can neither crash the views (`parseCardKey`
 *  throws) nor lock the rematch behind reps nobody can train, and a lost fight
 *  rewrites the list from well-formed keys only.
 *  `finishGate` writes `progress` (attempts, attempt day and time, cleared,
 *  perfect, assisted, grudge, station advance — a pass at or past the current
 *  station moves `progress.station` to n + 1, so a save still at station 0
 *  advances too) and emits `gate:result`; B stamps.
 */
import { ERROR_TAGS, type Belt, type CardKey, type DrillId, type ErrorTag, type GrammarItem, type StationBundle, type StoryItem } from '../content/types';
import type { ContentLoader } from '../content/loader';
import { hasKanji, toPlain } from '../content/ruby';
import { bus, type Events } from '../shared/events';
import { weighted, type Rng } from '../shared/hash';
import { cardKey as makeKey, isCardKey, parseCardKey } from '../shared/ids';
import type { SessionPlan, Step, StepParams, StepResult } from '../shared/session-types';
import { dayStartMs } from '../shared/time';
import { CardFlag, hasFlag, type EpochDay, type Store } from '../shared/store-types';
import { store } from '../store';
import { bundleItemIds, kindFor } from '../store/derived';
import { BELT_ORDER, isMature, itemBelt, type QueueCard } from '../learn';
import { SELF_GRADED, templateFor } from './blocks';
import { S, fill } from './engine-strings';
import { exampleOfRef, finalizePlan, isGrammar, isVocab, knownExampleRefs, loadPlanContext, makeStep, parseExampleRef, pickDrill, queueCardOf, resolveParams, stepForCard, withPools, type PlanContext } from './builder';
import { dedupe } from './params';
import { grudgeKeys } from './pickers';

export { grudgeKeys };

export const GATE_PASS = 0.85;
export const GATE_PHASE_PASS = 0.7;
export const GATE_ASSISTED_PASS = 0.8;
export const GATE_GREEN_SHARE = 0.8;
export const GRUDGE_REPS_FOR_REMATCH = 20;
export const ASSISTED_AFTER_ATTEMPTS = 3;
export const FLASH_MS = 4000;
export const STRIKE_MS = 12000;
export const PHASE_SIZES = { flash: 20, strike: 20, ear: 12, finalForm: 3 } as const;
export const STATION_SHARE = 0.7;

/** Belt listening speed (design 04 §12; the Gatekeeper's Ear uses the same presets). */
export const BELT_RATE: Record<Belt, number> = { white: 0.9, yellow: 0.9, orange: 0.9, green: 1.0, blue: 1.1, purple: 1.1, brown: 1.25, black: 1.25 };

const GREEN = BELT_ORDER.indexOf('green');

/* ────────────────────────────────────────────────────────────────────────── */
/* Availability                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export function gateAvailable(n: number, b: StationBundle, cards: Store['cards'], today: EpochDay): { ready: boolean; introduced: number; green: number; total: number } {
  void today;
  const ids = bundleItemIds(b);
  let introduced = 0;
  let green = 0;
  for (const id of ids) {
    const facets = cards.byItem(id);
    if (Object.keys(facets).length === 0) continue;
    introduced++;
    const kind = kindFor(id, facets);
    if (kind && BELT_ORDER.indexOf(itemBelt(kind, facets)) >= GREEN) green++;
  }
  const total = ids.length;
  return { ready: total > 0 && introduced === total && green >= Math.ceil(GATE_GREEN_SHARE * total), introduced, green, total };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sampling                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

type PhaseKind = 'flash' | 'strike';

function candidatesFor(ctx: PlanContext, ids: readonly string[], phase: PhaseKind): QueueCard[] {
  const out: QueueCard[] = [];
  for (const id of ids) {
    const facets = store.cards.byItem(id);
    const kind = kindFor(id, facets);
    if (!kind) continue;
    const wanted = phase === 'flash' ? (kind === 'kanji' ? ['read', 'comp'] : ['rec']) : kind === 'grammar' ? ['prod', 'cloze'] : kind === 'kanji' ? [] : ['prod'];
    for (const f of wanted as QueueCard['facet'][]) {
      const t = facets[f];
      if (!t || t[5] === 0 || hasFlag(t[7], CardFlag.archived)) continue;
      const qc = queueCardOf(ctx, makeKey(id, f));
      if (qc) {
        out.push(qc);
        break;
      }
    }
  }
  return out.sort((a, b) => (a.cardKey < b.cardKey ? -1 : 1));
}

/** Items with at least one reviewed, unarchived card outside `exclude` (the cumulative pool needs no bundles). */
export function cumulativeItemIds(exclude: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  store.cards.forEach((k, t) => {
    if (t[5] === 0 || hasFlag(t[7], CardFlag.archived)) return;
    const { itemId } = parseCardKey(k);
    if (!exclude.has(itemId)) out.add(itemId);
  });
  return Array.from(out).sort();
}

/** `n` draws without replacement, weighted toward low retrievability (1 − R + 0.05). */
export function sampleLowR(rng: Rng, pool: QueueCard[], n: number): QueueCard[] {
  const left = pool.slice();
  const out: QueueCard[] = [];
  while (left.length > 0 && out.length < n) {
    const i = weighted(
      rng,
      left.map((c) => 1 - c.r + 0.05),
    );
    out.push(left.splice(i, 1)[0] as QueueCard);
  }
  return out;
}

/** 70 % station / 30 % cumulative, each weighted to low R; a short pool is filled from the other. */
export function samplePhase(rng: Rng, station: QueueCard[], cumulative: QueueCard[], n: number): QueueCard[] {
  const wantStation = Math.round(n * STATION_SHARE);
  const a = sampleLowR(rng, station, wantStation);
  const taken = new Set(a.map((c) => c.cardKey));
  const b = sampleLowR(
    rng,
    cumulative.filter((c) => !taken.has(c.cardKey)),
    n - a.length,
  );
  const rest = n - a.length - b.length;
  const more = rest > 0 ? sampleLowR(rng, station.filter((c) => !taken.has(c.cardKey) && !b.some((x) => x.cardKey === c.cardKey)), rest) : [];
  return [...a, ...b, ...more];
}

function flashDrill(ctx: PlanContext, qc: QueueCard): DrillId {
  switch (qc.kind) {
    case 'kana':
      return 'kana-flash';
    case 'component':
      return 'component-flash';
    case 'kanji':
      return qc.facet === 'read' ? 'kanji-read' : 'component-assembly';
    case 'grammar':
      return 'pattern-cloze';
    case 'chunk':
      return 'shadow';
    default:
      return ctx.station >= 16 ? 'meaning-recall' : 'meaning-guard';
  }
}

function strikeDrill(ctx: PlanContext, qc: QueueCard, item: GrammarItem | undefined): DrillId {
  switch (qc.kind) {
    case 'kana':
      return 'kana-forge';
    case 'grammar':
      if (qc.facet === 'cloze') return 'pattern-cloze';
      if (ctx.station >= 10 && item && item.unlocksForms && item.unlocksForms.length > 0) return 'form-forge';
      return ctx.station >= 16 ? 'transform' : 'pattern-cloze';
    case 'chunk':
      return 'shadow';
    default:
      return 'production-forge';
  }
}

/** Mature cards are typed (no multiple choice); the `exposures` floor keeps `resolveParams` from issuing tiles / choices. */
function typed(qc: QueueCard): QueueCard {
  return { ...qc, exposures: Math.max(qc.exposures, 2) };
}

export interface GateOptions {
  assisted: boolean;
  revenge: boolean;
  seed: number;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
}

export interface StationSentence {
  storyId?: string;
  lineIndex?: number;
  /** The id the step is keyed on: the sentence's first vocab word, or the word itself. */
  vocabId: string | null;
  sentence: string;
  /** The station word itself as the prompt (bare word → kana), used when too few story lines are fully known. */
  word?: boolean;
  /** An own-station pool example (design 08 §4): the item, its example index and the clip key (`v-…#ex<k>` / `g-…#ex<k>`). */
  ref?: { itemId: string; k: number; clip: string };
}

/**
 * Station sentences for the Ear phase: the station's story lines whose
 * resolved tokens the learner all knows (mirrors `knownSentences`; a line that
 * carries a word from a later station is not a test of this station), then,
 * short of 12, the station's own pool examples whose every word is known
 * (design 08 §4: `listening/pool-NN.json` holds the sentences that link
 * inside the allowlist ≤ this station; `selectPool` i+0 keeps those the
 * learner knows today), then the station's own words as bare prompts — known
 * ones first. An example outside the pool is never used: it may carry a word
 * assigned to a later station.
 */
export function stationSentences(ctx: PlanContext, bundle: StationBundle): StationSentence[] {
  const out: StationSentence[] = [];
  for (const sid of bundle.storyIds) {
    const story = ctx.loader.get<StoryItem>(sid);
    if (!story || !('lines' in story)) continue;
    story.lines.forEach((line, lineIndex) => {
      const ids = (line.tokenIds ?? []).filter((x): x is string => x !== null);
      if (ids.length === 0 || !ids.every((id) => ctx.known.has(id))) return;
      const vocabId = ids.find((x) => x.startsWith('v-')) ?? null;
      out.push({ storyId: story.id, lineIndex, vocabId, sentence: toPlain(line.ja) });
    });
  }
  if (out.length < PHASE_SIZES.ear) {
    for (const r of knownExampleRefs(ctx, { stations: (n) => n === bundle.number })) {
      if (out.length >= PHASE_SIZES.ear) break;
      const parsed = parseExampleRef(r.ref);
      const ex = exampleOfRef(ctx, r.ref);
      if (!parsed || !ex) continue;
      const vocabId = parsed.itemId.startsWith('v-') ? parsed.itemId : (r.ids.find((x) => x.startsWith('v-')) ?? null);
      out.push({ vocabId, sentence: toPlain(ex.ja), ref: { itemId: parsed.itemId, k: parsed.k, clip: r.ref } });
    }
  }
  if (out.length < PHASE_SIZES.ear) {
    const words = bundle.vocabIds.map((id) => ctx.loader.get(id)).filter(isVocab);
    for (const v of [...words.filter((v) => ctx.known.has(v.id)), ...words.filter((v) => !ctx.known.has(v.id))]) {
      if (out.length >= PHASE_SIZES.ear) break;
      out.push({ vocabId: v.id, sentence: v.word, word: true });
    }
  }
  return out;
}

export async function buildGate(n: number, o: GateOptions): Promise<SessionPlan> {
  // The station's listening pool rides on the context (design 08 §4): the Ear phase draws its examples from it.
  const ctx = await withPools(await loadPlanContext({ station: n, loader: o.loader, available: o.available, seed: o.seed, mode: o.assisted ? 'gate-assisted' : o.revenge ? 'gate-revenge' : 'gate' }));
  const bundle = ctx.bundle;
  const template = templateFor('gate', { belt: ctx.belt, station: n, backlog: false, dueCount: 0, weakTags: [], strandDeficit: null });
  const blocks: ReturnType<typeof templateFor> extends (infer T)[] ? (T & { stepIds: string[]; steps: Step[] })[] : never = [];
  if (!bundle) return finalizePlan(ctx, 'gate', [], { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] });

  const stationIds = bundleItemIds(bundle);
  // Cumulative pool: every item the learner holds cards for that is not this station's (earlier stations by construction).
  const stationSet = new Set(stationIds);
  const cumulativeIds = cumulativeItemIds(stationSet);
  const rng = ctx.rng;

  // Phase 1 — Flash / Phase 2 — Strike: sample, then make sure the sampled items are in memory.
  const flash = samplePhase(rng, candidatesFor(ctx, stationIds, 'flash'), candidatesFor(ctx, cumulativeIds, 'flash'), PHASE_SIZES.flash);
  const strike = samplePhase(rng, candidatesFor(ctx, stationIds, 'strike'), candidatesFor(ctx, cumulativeIds, 'strike'), PHASE_SIZES.strike);
  try {
    await ctx.loader.load(Array.from(new Set([...flash, ...strike].map((c) => c.itemId))).filter((id) => ctx.loader.get(id) === undefined));
  } catch {
    /* offline: unloaded items are skipped by stepForCard */
  }
  const flashSteps: Step[] = [];
  flash.forEach((qc, i) => {
    const mature = isMature(store.cards.get(qc.cardKey) ?? null);
    const drill = flashDrill(ctx, qc);
    // Timed only when the facet is mature and the drill can be cut off by a clock: a chunk's shadow rep is self-graded.
    const timed = mature && !o.assisted && !SELF_GRADED.has(drill);
    const s = stepForCard(ctx, typed(qc), 'phase', { exercise: drill, timed, ...(timed ? { timerMs: FLASH_MS } : {}), id: `gate:${n}:p1:${i}`, params: { phase: 1 } });
    if (s) {
      if (!timed) delete s.timerMs;
      flashSteps.push(s);
    }
  });

  // Phase 2 — Strike
  const strikeSteps: Step[] = [];
  strike.forEach((qc, i) => {
    const mature = isMature(store.cards.get(qc.cardKey) ?? null);
    const g = ctx.loader.get(qc.itemId);
    const drill = strikeDrill(ctx, qc, isGrammar(g) ? g : undefined);
    const timed = mature && !o.assisted && !SELF_GRADED.has(drill);
    const s = stepForCard(ctx, typed(qc), 'phase', { exercise: drill, timed, ...(timed ? { timerMs: STRIKE_MS } : {}), id: `gate:${n}:p2:${i}`, params: { phase: 2 } });
    if (s) {
      if (!timed) delete s.timerMs;
      strikeSteps.push(s);
    }
  });

  // Phase 3 — Ear
  const earSteps: Step[] = [];
  const listen = pickDrill(ctx, 'sentence-listen');
  if (listen === 'sentence-listen') {
    const sentences = stationSentences(ctx, bundle);
    const picked = sampleLowR(
      rng,
      sentences.map((s, i) => ({ cardKey: `x#rec` as CardKey, itemId: String(i), kind: 'vocab' as const, facet: 'rec' as const, r: 0.5, mature: false, exposures: 0 })),
      PHASE_SIZES.ear,
    ).map((q) => sentences[Number(q.itemId)]!);
    picked.forEach((sx, i) => {
      const vocab = sx.vocabId ? ctx.loader.get(sx.vocabId) ?? null : null;
      let params: StepParams;
      if (sx.word && isVocab(vocab)) {
        // The word itself, not its example sentence (whose other words may be untaught); the clip key is the word's own.
        params = { sentence: hasKanji(vocab.word) ? `{${vocab.word}|${vocab.kana}}` : vocab.word, answer: vocab.kana, accept: dedupe([vocab.word, vocab.kana]), promptEn: vocab.meanings[0] ?? '', clip: vocab.id, rate: BELT_RATE[ctx.belt] };
      } else if (sx.ref) {
        // An own-station pool example (design 08 §4), pinned to its index so the clip key names the sentence played.
        params = resolveParams(ctx, listen, ctx.loader.get(sx.ref.itemId) ?? null, { example: sx.ref.k, rep: i });
      } else {
        params = resolveParams(ctx, listen, vocab, { storyId: sx.storyId, lineIndex: sx.lineIndex, rep: i });
      }
      params.rate = BELT_RATE[ctx.belt];
      params.phase = 3;
      // The listen card when it exists, else the word's recognition card, so an Ear miss reaches the Grudge List.
      const keys: CardKey[] = sx.vocabId ? [makeKey(sx.vocabId, 'listen'), makeKey(sx.vocabId, 'rec')] : [];
      const cardKey = keys.find((k) => store.cards.get(k) !== undefined) ?? null;
      earSteps.push(makeStep(ctx, { block: 'phase', exercise: listen, itemId: sx.vocabId, cardKey, params, exposures: 5, id: `gate:${n}:p3:${i}` }));
    });
  }

  // Phase 4 — Final Form (assisted: 3 cloze)
  const finalSteps: Step[] = [];
  const grammar = bundle.grammarIds.map((id) => ctx.loader.get(id)).filter(isGrammar);
  const chosen = sampleLowR(
    rng,
    grammar.map((g, i) => ({ cardKey: makeKey(g.id, 'cloze'), itemId: String(i), kind: 'grammar' as const, facet: 'cloze' as const, r: 0.5, mature: false, exposures: 0 })),
    PHASE_SIZES.finalForm,
  ).map((q) => grammar[Number(q.itemId)]!);
  chosen.forEach((g, i) => {
    const prodKey = makeKey(g.id, 'prod');
    const clozeKey = makeKey(g.id, 'cloze');
    const key = store.cards.get(prodKey) ? prodKey : store.cards.get(clozeKey) ? clozeKey : null;
    if (o.assisted) {
      const qc = queueCardOf(ctx, clozeKey) ?? { cardKey: clozeKey, itemId: g.id, kind: 'grammar' as const, facet: 'cloze' as const, r: 0.5, mature: false, exposures: 2 };
      const s = stepForCard(ctx, typed(qc), 'phase', { exercise: 'pattern-cloze', id: `gate:${n}:p4:${i}`, params: { phase: 4 }, rep: i });
      if (s) {
        delete s.timerMs;
        finalSteps.push(s);
      }
      return;
    }
    const ex = pickDrill(ctx, 'writing-dojo');
    if (!ex) return;
    const model = g.examples[i % Math.max(1, g.examples.length)];
    const params = ex === 'writing-dojo' ? {} : resolveParams(ctx, ex, g, { qc: typed({ cardKey: clozeKey, itemId: g.id, kind: 'grammar', facet: 'cloze', r: 0.5, mature: false, exposures: 2 }), rep: i });
    params.patternIds = [g.id];
    params.promptEn = fill(S.gateFinalFormPrompt, { pattern: g.pattern, meaning: g.meaning });
    if (model) {
      params.sentence = toPlain(model.ja);
      if (ex === 'writing-dojo') {
        params.answer = toPlain(model.ja);
        params.accept = [toPlain(model.ja), model.kana];
      }
    }
    params.phase = 4;
    finalSteps.push(makeStep(ctx, { block: 'phase', exercise: ex, itemId: g.id, cardKey: key, params, exposures: 5, id: `gate:${n}:p4:${i}` }));
  });

  const stepsByPhase = [flashSteps, strikeSteps, earSteps, finalSteps];
  template.forEach((t, i) => {
    const steps = stepsByPhase[i] ?? [];
    blocks.push({ ...t, label: i === 3 && o.assisted ? S.phaseAssistedForm : t.label, stepIds: steps.map((s) => s.id), steps });
  });
  return finalizePlan(ctx, 'gate', blocks, { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scoring                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface GateScore {
  overall: number;
  /** One entry per non-empty phase, in order. */
  phases: number[];
  passed: boolean;
  perfect: boolean;
  misses: CardKey[];
  /** Additive: steps answered / planned. */
  answered: number;
  total: number;
}

/** A step counts as hit when correct and neither timed out nor guarded; Final Form self-grades count a Good or a ≥ 0.8 rubric score. */
export function stepHit(step: Step | undefined, r: StepResult | undefined): boolean {
  if (!r) return false;
  if (r.guard || (r.timedOut && !r.correct)) return false;
  if (step && step.params.phase === 4 && (r.selfRating !== undefined || r.score !== undefined)) return r.correct || r.selfRating === 3 || (r.score ?? 0) >= 0.8;
  return r.correct;
}

export function scoreGate(plan: SessionPlan, steps: StepResult[], o: { assisted?: boolean } = {}): GateScore {
  const byId = new Map(steps.map((r) => [r.stepId, r] as const));
  const stepById = new Map(plan.steps.map((s) => [s.id, s] as const));
  const phases: number[] = [];
  let hit = 0;
  let total = 0;
  let answered = 0;
  const misses: CardKey[] = [];
  for (const b of plan.blocks) {
    if (b.stepIds.length === 0) continue;
    let ph = 0;
    for (const id of b.stepIds) {
      const r = byId.get(id);
      const s = stepById.get(id);
      total++;
      if (r) answered++;
      if (stepHit(s, r)) {
        hit++;
        ph++;
      } else {
        const key = s?.cardKey ?? r?.cardKey ?? null;
        if (key && !misses.includes(key)) misses.push(key);
      }
    }
    phases.push(Math.round((ph / b.stepIds.length) * 1000) / 1000);
  }
  const overall = total > 0 ? Math.round((hit / total) * 1000) / 1000 : 0;
  const threshold = o.assisted ? GATE_ASSISTED_PASS : GATE_PASS;
  const passed = total > 0 && overall >= threshold && phases.every((p) => p >= GATE_PHASE_PASS);
  return { overall, phases, passed, perfect: passed && hit === total && !o.assisted, misses, answered, total };
}

export function gateOutcome(score: GateScore, o: { assisted: boolean; revenge: boolean }): Events['gate:result']['outcome'] {
  if (!score.passed) return 'fail';
  if (o.revenge) return 'revenge';
  if (o.assisted) return 'assisted';
  return score.perfect ? 'perfect' : 'pass';
}

/**
 * The moment the last lost fight at a station ended (ms), kept for the page
 * lifetime so `rematchAllowed` counts only Grudge reps trained after it. The
 * save holds the same moment (`progress.gateAttemptAt`, written by `finishGate`)
 * and the day (`gateAttemptDay`), so a reload keeps the baseline; a save from
 * before the field existed falls back to 04:00, which can only open a rematch
 * earlier, never lock it.
 */
const attemptEndedAt = new Map<number, number>();

/** Tests: forget the in-memory fight end times. */
export function resetGateAttemptsForTests(): void {
  attemptEndedAt.clear();
}

/** Writes the fight's consequences and emits `gate:result` (B emits `stamp:earned`). */
export function finishGate(n: number, score: GateScore, o: { assisted: boolean; revenge: boolean }): void {
  const outcome = gateOutcome(score, o);
  const today = store.today();
  const now = store.now();
  store.patch('progress', (p) => {
    const attempts = { ...p.gateAttempts, [n]: (p.gateAttempts[n] ?? 0) + 1 };
    if (!score.passed) {
      const grudge = p.grudge.filter(isCardKey);
      for (const k of score.misses) if (!grudge.includes(k)) grudge.push(k);
      return { ...p, gateAttempts: attempts, gateAttemptDay: { ...(p.gateAttemptDay ?? {}), [n]: today }, gateAttemptAt: { ...(p.gateAttemptAt ?? {}), [n]: now }, grudge };
    }
    const cleared = p.stationsCleared.includes(n) ? p.stationsCleared : [...p.stationsCleared, n].sort((a, b) => a - b);
    let assisted = p.assisted;
    if (outcome === 'assisted' && !assisted.includes(n)) assisted = [...assisted, n];
    if (outcome === 'revenge' || outcome === 'perfect' || outcome === 'pass') assisted = assisted.filter((x) => x !== n);
    // A pass closes the fight: its end time is no longer a rematch baseline.
    const gateAttemptAt = { ...(p.gateAttemptAt ?? {}) };
    delete gateAttemptAt[n];
    return {
      ...p,
      gateAttempts: attempts,
      gateAttemptAt,
      stationsCleared: cleared,
      perfectGates: p.perfectGates + (outcome === 'perfect' ? 1 : 0),
      assisted,
      // A pass settles the Grudge List: the fight is won, the misses are information.
      grudge: [],
      // The road moves on from the station just cleared; a save still at station 0 (onboarding) advances as well,
      // while replaying an earlier gate (Revenge Match) never moves it.
      station: n >= p.station ? Math.min(53, n + 1) : p.station,
    };
  });
  if (!score.passed) attemptEndedAt.set(n, now);
  else attemptEndedAt.delete(n);
  bus.emit('gate:result', { station: n, outcome, score: score.overall, phases: score.phases.slice() });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rematch                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Grudge reps answered today (log rows on Grudge List cards since 04:00, or since `after` when later). */
export function grudgeRepsToday(after = 0): number {
  const grudge = new Set(grudgeKeys());
  if (grudge.size === 0) return 0;
  const since = Math.max(after, dayStartMs(store.today(), store.profile.value.tz));
  let n = 0;
  for (const e of store.log.recent(5000)) if (e[0] >= since && e[0] > after && grudge.has(e[1])) n++;
  return n;
}

/**
 * Rematch rule (design 04 §11): a lost fight locks the station for the rest
 * of its day unless ≥ 20 Grudge reps are trained after it; the next day the
 * rematch is open. The Assisted Gate is offered from the third non-pass. A
 * cleared station stays open for a Revenge Match when it was passed assisted.
 */
export function rematchAllowed(n: number): { allowed: boolean; grudgeRepsNeeded: number; offerAssisted: boolean } {
  const p = store.progress.value;
  const attempts = p.gateAttempts[n] ?? 0;
  const cleared = p.stationsCleared.includes(n);
  const offerAssisted = attempts >= ASSISTED_AFTER_ATTEMPTS;
  if (cleared) return { allowed: p.assisted.includes(n), grudgeRepsNeeded: 0, offerAssisted: false };
  const lostDay = p.gateAttemptDay?.[n];
  if (attempts === 0 || lostDay === undefined || lostDay < store.today()) return { allowed: true, grudgeRepsNeeded: 0, offerAssisted };
  if (grudgeKeys().length === 0) return { allowed: true, grudgeRepsNeeded: 0, offerAssisted };
  const done = grudgeRepsToday(attemptEndedAt.get(n) ?? p.gateAttemptAt?.[n] ?? 0);
  const needed = Math.max(0, GRUDGE_REPS_FOR_REMATCH - done);
  return { allowed: needed === 0, grudgeRepsNeeded: needed, offerAssisted };
}

/** Dominant error tags among a result list (for the Grudge view). */
export function dominantTags(steps: readonly StepResult[]): ErrorTag[] {
  const counts = new Map<ErrorTag, number>();
  for (const r of steps) for (const t of r.errorTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || ERROR_TAGS.indexOf(a[0]) - ERROR_TAGS.indexOf(b[0]))
    .map(([t]) => t);
}

/** Items behind the Grudge List, for the view. */
export function grudgeItems(): string[] {
  return Array.from(new Set(grudgeKeys().map((k) => parseCardKey(k).itemId)));
}
