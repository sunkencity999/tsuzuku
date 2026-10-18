/**
 * TSUZUKU — session plan builder (design 03 §2, §4–§5; 04 §10, §13; 05 §3).
 *
 * `buildPlan(mode)` turns the block template for a mode into a `SessionPlan`:
 * due cards through `@/learn` (`dueCards` → wave → interleave), new Scrolls
 * through `intro-policy`, the load governor (backlog mode, cramming cap, away
 * spread), an exercise per card (`exerciseFor` + the registry; unregistered
 * drills are skipped), fully resolved `StepParams` (choices, tiles,
 * conjugations, sentences, story ids by live coverage), one Michikusa chosen by
 * `hash(seed, day)` from the un-collected pool of stations ≤ current + 1,
 * recheck steps for arcade misses, and `meta` (dueTotal / dueTaken / backlog).
 *
 * +3 / +10 / relearn / Recovery re-presentations are NOT pre-inserted: the
 * runner inserts them from `recordAttempt().stepOffsets` and the Kiai queue, so
 * a resumed session and a fresh one behave the same. The sparring block is
 * sized to leave room for them.
 *
 * A Kumite or Shugyō also carries today's Nemesis steps (dossier / duel,
 * `nemesisBlockSteps`) as a small block ahead of the sparring, their cards held
 * out of the review draws; on the day of a lost Gatekeeper fight every training
 * mode opens with a Grudge List block (`grudgeBlockSteps`, ≤ 20 reps) so the
 * same-day rematch is reachable. Grammar cloze on a particle point becomes
 * Particle Duel from Station 5; Form Forge / Form Chain run only on points that
 * declare `unlocksForms`, and `stepForCard` re-routes a form drill whose head
 * word realises none of them (or a Scramble with one movable tile) to cloze /
 * transform instead of emitting an untestable step. `makeStep` never puts a
 * hard timer on a self-graded drill (`SELF_GRADED`).
 *
 * `loadPlanContext` lives in `./context` (re-exported): it keeps station entry
 * light (design 07 §6/§9), loads the previous station's stories so the Input
 * block has readable episodes mid-station, and carries the shared White
 * allowlist for Stations 1–3. `finalizePlan` prices a Scroll block with the
 * +3 / +10 steps its intro checks owe and the teach cards (`plannedMs`).
 *
 * Listening (design 08 §4, §10.4, §11): `buildPlan` attaches the listening
 * pools ≤ station to the context (`withPools`); the listening Input block
 * (`listeningInputSteps`) rotates an unheard audio-first piece → a dialogue →
 * an Ear Walk (`listening-set` over 6–8 i+0 / i+1 pool refs) by listening
 * day, never the same genre twice in a row, never the most recently heard
 * text while another candidate exists (`byLastHearing`) and never a text the
 * Arena passed within the last 14 days (`progress.arenaAt`, `ARENA_RECENT_DAYS`
 * from `@/learn` — the Radio's window, exported here as `REHEAR_DAYS`),
 * falling through a slot that has nothing to serve; the speaking surfaces (`outputBlockSteps`
 * role-play, the reading block's dialogue fallback) take only `speakable`
 * dialogues — a piece needs `learnerSpeaker` to be spoken.
 *
 * `StepParams.sentence` carries ruby markup for every sentence drill that
 * renders through `<Ruby>` (pattern-cloze, particle-duel, kanji-read,
 * lookalike-duel, transform, judgment-call, scramble, sentence-listen, shadow);
 * `blank` / `blanks` are offsets into `toPlain(sentence)`, and `answer` /
 * `accept` hold plain surfaces. Production Forge keeps a plain sentence.
 *
 * The lower-level pieces (`loadPlanContext`, `stepForCard`, `resolveParams`,
 * `makeStep`, `finalizePlan`, pickers) are exported for the boss, exam, Kage
 * and Dan builders in this folder; `resolveParams` and the item helpers live
 * in `./params`, the pickers and day counters in `./pickers`, both re-exported
 * here. Everything is seeded from `store.seed()` +
 * `store.today()` + the mode; no clock or `Math.random`.
 *
 * Modes `gate`, `shinsa`, `kage` and `dan` have their own builders
 * (`buildGate`, `buildShinsa`, `buildKage`, `buildGauntlet`); `buildPlan`
 * rejects them with a `RangeError` naming the right function.
 */
import type { CardKey, DrillId, ErrorTag, ListeningGenre, StoryItem } from '../content/types';
import { toPlain } from '../content/ruby';
import { hashSeed } from '../shared/hash';
import { cardKey as makeKey, parseCardKey } from '../shared/ids';
import type { BlockKind, SessionMode, SessionPlan, SessionSnapshot, Step, StepParams, StepTag } from '../shared/session-types';
import type { CardTuple, EpochDay, ItemKind } from '../shared/store-types';
import { store } from '../store';
import { ARENA_RECENT_DAYS, cardRetrievability, exerciseFor, interleave, kindOfCards, orderWave, queueCardFor, recheckCards, weakPointSet, type QueueCard, type Scroll } from '../learn';
import { MICHIKUSA_AFTER_REP, MICHIKUSA_DRILL, MODE_MINUTES, SELF_GRADED, estimateStepMs, fitToTime, plannedMs, strandDeficitFor, templateFor, type OutputKind, type PlannedBlock, type TemplateCtx } from './blocks';
import { loadPlanContext, type PlanContext, type PlanOptions } from './context';
import { S } from './engine-strings';
import { duelsReady, nemesisItems, nemesisSteps } from './nemesis';
import { PARTICLE_DUEL_FROM, dedupe, hasParticleHint, isDrillId, isGrammar, knownSentences, movableTiles, pickStories, rateFor, resolveParams, walkRefs, withPools } from './params';
import { dueQueue, easiestCards, grudgeKeys, michikusaFor, scrollsForToday, weekStrandMinutes, welcomeSet } from './pickers';
import { scrollSteps } from './scroll';

// Re-exported from `./pickers` and `./params` (see the header).
export { DUE_LOAD_RESERVE, accuracy7, dueQueue, easiestCards, effectiveNewPerDay, grudgeKeys, introducedToday, michikusaFor, scrollsForToday, weekStrandMinutes, welcomeSet } from './pickers';
export {
  BUNSETSU_STARTERS,
  CUT_PARTICLES,
  FORM_LABEL,
  PARTICLES,
  PARTICLE_ATOMS,
  PARTICLE_DUEL_FROM,
  PITCH_PATTERNS,
  SPEED_READ_CPM,
  WALK_I1_MAX,
  WALK_REFS_MAX,
  WALK_REFS_MIN,
  alignedOccurrence,
  exampleOfRef,
  isComponent,
  isDrillId,
  isGrammar,
  isKana,
  isKanji,
  isListeningText,
  isSpeakable,
  isStory,
  isVocab,
  itemKindOf,
  knownExampleRefs,
  knownSentences,
  linesWith,
  loadPools,
  movableTiles,
  parseExampleRef,
  particleHints,
  pickStories,
  pitchHomophones,
  pitchPattern,
  poolRefs,
  rateFor,
  resolveParams,
  rubySpanReading,
  splitBunsetsu,
  storyCoverage,
  walkRefs,
  withPools,
  type KnownSentence,
  type PickStoriesOptions,
  type ResolveOpts,
} from './params';

/* ────────────────────────────────────────────────────────────────────────── */
/* Context (./context)                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export { SHARED_ALLOWLIST_TO, loadPlanContext, tryStation, type PlanContext, type PlanOptions } from './context';

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MakeStepInput {
  block: BlockKind;
  exercise: DrillId;
  itemId: string | null;
  cardKey: CardKey | null;
  params: StepParams;
  timed?: boolean;
  timerMs?: number;
  isNew?: boolean;
  stepTag?: StepTag | null;
  exposures?: number;
  id?: string;
  estMs?: number;
}

export function makeStep(ctx: PlanContext, o: MakeStepInput): Step {
  ctx.seq++;
  // A self-graded drill (shadow, meaning-judge, kanji-write, writing-dojo) has no answer a clock can cut off: a hard
  // timer there would score a listen-speak-rate rep as a timeout miss (design 04 §11 Strike / §12), so no builder gets one.
  const timeable = !SELF_GRADED.has(o.exercise);
  const step: Step = {
    id: o.id ?? `${ctx.planKey}:${ctx.seq}`,
    block: o.block,
    exercise: o.exercise,
    itemId: o.itemId,
    cardKey: o.cardKey,
    params: o.params,
    timed: timeable && (o.timed ?? false),
    isNew: o.isNew ?? false,
    stepTag: o.stepTag ?? null,
    exposures: o.exposures ?? 0,
    estMs: o.estMs ?? estimateStepMs(o.exercise, o.params, ctx.medianMs),
  };
  if (o.timerMs !== undefined && timeable) step.timerMs = o.timerMs;
  return step;
}

/** Replaces an unavailable drill by the nearest registered one; `null` when nothing fits (the step is skipped). */
export function pickDrill(ctx: PlanContext, wanted: DrillId): DrillId | null {
  const chain: Record<string, DrillId[]> = {
    'meaning-guard': ['meaning-recall'],
    'meaning-judge': ['meaning-recall', 'meaning-guard'],
    'meaning-recall': ['meaning-guard'],
    'kana-ear': ['kana-forge'],
    'kana-forge': ['kana-ear'],
    'lookalike-duel': ['kanji-read'],
    scramble: ['pattern-cloze'],
    'judgment-call': ['pattern-cloze'],
    transform: ['form-forge', 'pattern-cloze'],
    'form-forge': ['pattern-cloze'],
    'form-chain': ['form-forge', 'pattern-cloze'],
    'particle-duel': ['pattern-cloze'],
    'audio-flash': ['meaning-recall', 'meaning-guard'],
    'writing-dojo': ['transform', 'pattern-cloze'],
    'say-three-ways': ['transform', 'shadow'],
    monologue: ['shadow'],
    'role-play': ['shadow'],
    'speed-read': ['story-read'],
  };
  if (ctx.available(wanted)) return wanted;
  for (const alt of chain[wanted] ?? []) if (ctx.available(alt)) return alt;
  return null;
}

function speedRingMs(ctx: PlanContext, exercise: DrillId): number | undefined {
  if (ctx.settings.feel === 'zen') return undefined;
  const median = ctx.medianMs[exercise];
  return median !== undefined && median > 0 ? Math.round(3 * median) : 3 * 4000;
}

/**
 * A graded step for a due / pool card. `null` when the drill (and its
 * fallbacks) are not registered or the item's content is not in memory.
 */
export function stepForCard(
  ctx: PlanContext,
  qc: QueueCard,
  block: BlockKind,
  o: { exercise?: DrillId; timed?: boolean; timerMs?: number; stepTag?: StepTag | null; isNew?: boolean; rep?: number; id?: string; params?: StepParams } = {},
): Step | null {
  const item = ctx.loader.get(qc.itemId);
  if (!item) return null;
  let wantedRaw: string = o.exercise ?? exerciseFor(qc, ctx.station, ctx.settings);
  // Form Forge / Form Chain drill only the forms a point declares (design 04 §4 "unlocksForms"); a point
  // without them keeps its cloze / transform shape instead of cycling every form of a random verb.
  if ((wantedRaw === 'form-forge' || wantedRaw === 'form-chain') && !(isGrammar(item) && item.unlocksForms && item.unlocksForms.length > 0)) {
    wantedRaw = ctx.station >= 16 ? 'transform' : 'pattern-cloze';
  }
  // Particle Duel: grammar cloze on a particle point from Station 5, once the two multiple-choice exposures are past (design 04 §4).
  if (wantedRaw === 'pattern-cloze' && o.exercise === undefined && qc.facet === 'cloze' && ctx.station >= PARTICLE_DUEL_FROM && qc.exposures >= 2 && hasParticleHint(item)) wantedRaw = 'particle-duel';
  if (wantedRaw === 'particle-duel' && !hasParticleHint(item)) wantedRaw = exerciseFor(qc, ctx.station, ctx.settings);
  if (!isDrillId(wantedRaw)) return null;
  let exercise = pickDrill(ctx, wantedRaw);
  if (!exercise) return null;
  const rep = o.rep ?? qc.exposures;
  let resolved = resolveParams(ctx, exercise, item, { qc, rep });
  // A declared form no head word in the pool realises (ある for たい, a verb pool for adjective forms), or a
  // sentence Scramble cannot shuffle (one movable tile): the step would render "could not be built" or grade a
  // no-op. Re-route to the cloze / transform shape instead of emitting an untestable step.
  const empty = ((exercise === 'form-forge' && resolved.targetForm === undefined) || (exercise === 'form-chain' && (resolved.forms?.length ?? 0) === 0)) || (exercise === 'scramble' && movableTiles(resolved.tiles ?? []) < 2);
  if (empty) {
    const alt = pickDrill(ctx, ctx.station >= 16 && exercise !== 'scramble' ? 'transform' : 'pattern-cloze');
    if (!alt || alt === exercise) return null;
    exercise = alt;
    resolved = resolveParams(ctx, exercise, item, { qc, rep });
  }
  const params = { ...resolved, ...(o.params ?? {}) };
  const ring = qc.mature && !o.timed ? speedRingMs(ctx, exercise) : undefined;
  return makeStep(ctx, {
    block,
    exercise,
    itemId: qc.itemId,
    cardKey: qc.cardKey,
    params,
    timed: o.timed ?? false,
    timerMs: o.timerMs ?? ring,
    isNew: o.isNew ?? false,
    stepTag: o.stepTag ?? qc.tag ?? null,
    exposures: qc.exposures,
    id: o.id,
  });
}

/** `QueueCard` for a key read from the store (`undefined` when absent). */
export function queueCardOf(ctx: PlanContext, key: CardKey): QueueCard | undefined {
  return queueCardFor(store.cards, key, ctx.today);
}

/** A synthetic `QueueCard` for an item that has no card yet (scroll pretests / intros). */
export function freshQueueCard(itemId: string, kind: ItemKind, facet: QueueCard['facet']): QueueCard {
  return { cardKey: makeKey(itemId, facet), itemId, kind, facet, r: 0, mature: false, exposures: 0 };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pickers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */


export function michikusaStep(ctx: PlanContext): Step | null {
  const m = michikusaFor(ctx);
  if (!m) return null;
  return makeStep(ctx, { block: 'michikusa', exercise: MICHIKUSA_DRILL, itemId: m.id, cardKey: null, params: { michikusaId: m.id }, isNew: m.isNew, estMs: 10_000 });
}


/* ────────────────────────────────────────────────────────────────────────── */
/* Assembly                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PlanMeta {
  dueTotal: number;
  dueTaken: number;
  backlog: boolean;
  newCount: number;
  scrollIds: string[];
  storyId?: string;
  michikusaId?: string;
}

/**
 * Assembles the plan from filled blocks: steps in block order, minute
 * estimates from the steps (or the template's minutes with `templateMinutes`).
 * Empty blocks are dropped.
 */
export function finalizePlan(ctx: PlanContext, mode: SessionMode, blocks: (PlannedBlock & { steps: Step[] })[], meta: PlanMeta, o: { templateMinutes?: boolean } = {}): SessionPlan {
  const kept = blocks.filter((b) => b.steps.length > 0);
  const steps = kept.flatMap((b) => b.steps);
  return {
    id: ctx.planKey,
    mode,
    day: ctx.today,
    createdAt: ctx.now,
    station: ctx.station,
    steps,
    blocks: kept.map((b) => ({
      kind: b.kind,
      label: b.label,
      estMinutes: o.templateMinutes ? b.minutes : Math.round((plannedMs(b.steps, mode, ctx.medianMs) / 60_000) * 10) / 10,
      stepIds: b.steps.map((s) => s.id),
    })),
    meta,
  };
}

function toSteps(ctx: PlanContext, cards: QueueCard[], block: BlockKind, used: Set<CardKey>): Step[] {
  const out: Step[] = [];
  for (const c of cards) {
    const s = stepForCard(ctx, c, block);
    if (!s) continue;
    used.add(c.cardKey);
    out.push(s);
  }
  return out;
}

/** Wave + interleave over a card list. */
export function composeReviews(cards: QueueCard[]): QueueCard[] {
  return interleave(orderWave(cards));
}

function scrollBlockSteps(ctx: PlanContext, scrolls: Scroll[]): { steps: Step[]; itemIds: string[] } {
  const steps: Step[] = [];
  const itemIds: string[] = [];
  for (const sc of scrolls) {
    const parts = scrollSteps(sc, (id) => ctx.loader.get(id), ctx.rng, {
      station: ctx.station,
      settings: ctx.settings,
      available: ctx.available,
      resolve: (ex, item, qc) => resolveParams(ctx, ex, item, { qc, rep: 0 }),
      estMs: (ex, params) => estimateStepMs(ex, params, ctx.medianMs),
    });
    steps.push(...parts.pretest, ...parts.checks);
    itemIds.push(...sc.itemIds);
  }
  return { steps, itemIds };
}

/**
 * Output block steps: a shadow set over known sentences, one role-play turn,
 * one Say It Three Ways, one Monologue (Reduce & Expand over `storyId` from
 * Station 37), or one Writing Dojo piece. An unavailable drill falls back to
 * a 3-line shadow set; with nothing registered the block is empty.
 */
export function outputBlockSteps(ctx: PlanContext, kind: OutputKind | undefined, count: number, storyId?: string): Step[] {
  const out: Step[] = [];
  // Speaking surfaces take a dialogue the learner has a part in (design 08 §11): never an audio-first piece without `learnerSpeaker`.
  const dialogues = pickStories(ctx, { speakable: true });
  const h = hashSeed(ctx.seed, ctx.today, 'output');
  const fallback = (): Step[] => (kind === 'shadow' ? out : outputBlockSteps(ctx, 'shadow', 3));
  switch (kind) {
    case 'shadow': {
      const ex = pickDrill(ctx, 'shadow');
      if (ex !== 'shadow') return out;
      for (const s of knownSentences(ctx, count)) {
        const vocabId = s.storyId ? ctx.loader.get<StoryItem>(s.storyId)?.lines[s.lineIndex ?? 0]?.tokenIds?.find((x): x is string => x !== null && x.startsWith('v-')) : undefined;
        const params: StepParams =
          s.storyId !== undefined
            ? resolveParams(ctx, ex, null, { storyId: s.storyId, lineIndex: s.lineIndex })
            : { sentence: s.sentence, answer: s.kana, accept: dedupe([toPlain(s.sentence), s.kana]), promptEn: s.en, rate: rateFor(ctx), ...(s.clip ? { clip: s.clip } : {}) };
        out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: vocabId ?? null, cardKey: null, params }));
      }
      return out;
    }
    case 'role-play': {
      const ex = pickDrill(ctx, 'role-play');
      const story = dialogues[h % Math.max(1, dialogues.length)];
      if (ex !== 'role-play' || !story) return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: story.id, cardKey: null, params: resolveParams(ctx, ex, story, { storyId: story.id }) }));
      return out;
    }
    case 'three-ways': {
      const ex = pickDrill(ctx, 'say-three-ways');
      if (ex !== 'say-three-ways') return fallback();
      const grammar = ctx.grammarPool.filter((g) => ctx.known.has(g.id));
      const g = grammar[h % Math.max(1, grammar.length)] ?? ctx.grammarPool[0];
      if (!g) return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: g.id, cardKey: null, params: resolveParams(ctx, ex, g, { rep: h }) }));
      return out;
    }
    case 'monologue': {
      const ex = pickDrill(ctx, 'monologue');
      if (ex !== 'monologue') return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null, storyId ? { storyId } : {}) }));
      return out;
    }
    case 'writing': {
      const ex = pickDrill(ctx, 'writing-dojo');
      if (ex !== 'writing-dojo') return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null) }));
      return out;
    }
    default:
      return out;
  }
}

/** The listening Input block's rotation (design 08 §11): an unheard audio-first piece, a dialogue, an Ear Walk. */
export const LISTENING_SLOTS = ['piece', 'dialogue', 'walk'] as const;
export type ListeningSlot = (typeof LISTENING_SLOTS)[number];

/**
 * The slot a listening day opens with. The Shugyō listens on odd days
 * (`blocks.ts`: `rotation % 2 === 1`), so `floor(day / 2)` advances by one
 * from one listening day to the next and the three slots come round in turn;
 * a slot with nothing to serve falls through to the next (`listeningInputSteps`).
 */
export function listeningSlot(day: EpochDay): ListeningSlot {
  return LISTENING_SLOTS[Math.floor(Math.abs(day) / 2) % LISTENING_SLOTS.length] as ListeningSlot;
}

function textOf(ctx: PlanContext, id: string): StoryItem | undefined {
  const own = ctx.stories.find((s) => s.id === id);
  if (own) return own;
  const it = ctx.loader.get(id);
  return it && 'lines' in it && 'stationId' in it ? (it as StoryItem) : undefined;
}

/**
 * Genre of the text heard last on either surface (`progress.listened`, design
 * 08 §11 "never the same genre twice in a row, derived from progress.listened").
 * Ids in `listened` that are not texts (the Radio's kana tracks, `morae-beats`)
 * are skipped, so a kana track between two pieces does not lift the rule;
 * `undefined` when no text was heard or the last text has no genre (a plain
 * dialogue), when the next piece is unconstrained.
 */
export function lastHeardGenre(ctx: PlanContext): ListeningGenre | undefined {
  const listened = store.progress.value.listened ?? [];
  for (let i = listened.length - 1; i >= 0; i--) {
    const t = textOf(ctx, listened[i] as string);
    if (t) return t.genre;
  }
  return undefined;
}

/**
 * Texts in the order the Input block prefers them: never heard first (plain
 * dialogues before audio-first pieces, then `xs`'s own order — coverage), then
 * the heard ones by last hearing, oldest first — `progress.listened` is a
 * least-recently-heard order: a first hearing appends once (Arena pass,
 * Read-along), and the Radio MOVES a re-heard id to the back, so a text the
 * Radio played yesterday sits behind one not heard since its Arena set.
 * `nextToHear` serves from this order.
 */
export function byLastHearing(xs: readonly StoryItem[], listened: readonly string[]): StoryItem[] {
  return xs
    .map((s, i) => ({ s, i, rank: listened.indexOf(s.id), piece: s.audioFirst ? 1 : 0 }))
    .sort((a, b) => {
      const ah = a.rank < 0 ? 0 : 1;
      const bh = b.rank < 0 ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return ah === 0 ? a.piece - b.piece || a.i - b.i : a.rank - b.rank || a.i - b.i;
    })
    .map((x) => x.s);
}

/**
 * Design 08 §11 "a piece is not re-served within 14 days": a text whose last
 * PASSED Arena set (`progress.arenaAt[id]`, stamped by the Arena on every
 * pass) is younger than this many days is closed to `nextToHear` while any
 * other candidate is open. The one constant is `ARENA_RECENT_DAYS` in `@/learn`
 * (`pool.ts`): the Radio reads the same window the other way round (recently
 * passed → first among its re-hearings). `REHEAR_DAYS` is this module's name
 * for it, kept for its importers and tests.
 */
export const REHEAR_DAYS = ARENA_RECENT_DAYS;

/**
 * The text a slot serves from `xs` on `day` (design 08 §11 "never a text
 * served in the last 14 days"): the first of `byLastHearing` while any
 * candidate is unheard; once every candidate has been heard, the candidates
 * the Arena passed within `ARENA_RECENT_DAYS` of `day` (`arenaAt`, the day of the
 * last passed set, open again from day + 14) are dropped while at least one
 * stays open, and the listening day picks among the open ones —
 * `floor(day / 2)` advances by one from one listening day to the next
 * (`listeningSlot`). An Arena re-pass leaves `listened` as is and re-stamps
 * `arenaAt[id] = today`; a Radio re-hearing moves the id to the back of
 * `listened` and stamps nothing — that move alone shifts the walked index by
 * one text and would land on yesterday's text again, which the stamp closes.
 * Without stamps (a save the Arena has not passed anything on yet, Read-along
 * / Radio-only hearings, no `arenaAt` given) or with every candidate closed,
 * the walk runs over all of them, so N heard texts still come round every N
 * listening days.
 */
export function nextToHear(xs: readonly StoryItem[], listened: readonly string[], day: EpochDay, arenaAt?: Readonly<Record<string, EpochDay>>): StoryItem | undefined {
  const ordered = byLastHearing(xs, listened);
  if (ordered.length === 0) return undefined;
  const heard = new Set(listened);
  if (!ordered.every((s) => heard.has(s.id))) return ordered[0];
  const open = arenaAt
    ? ordered.filter((s) => {
        const at = arenaAt[s.id];
        return at === undefined || day - at >= ARENA_RECENT_DAYS;
      })
    : ordered;
  const pool = open.length > 0 ? open : ordered;
  return pool[Math.floor(Math.abs(day) / 2) % pool.length];
}

/**
 * The listening Input block (design 08 §11): from the day's slot, an unheard
 * audio-first piece whose genre differs from the last text heard, then a
 * dialogue (plain dialogues first, then any listening text, by last hearing
 * and — once all are heard — round-robin by listening day over the texts the
 * Arena has not passed within 14 days, `nextToHear` / `progress.arenaAt`),
 * then an Ear Walk (`listening-set` in pool mode over 6–8 i+0 / i+1 refs of
 * the pools ≤ station); an empty slot falls through to the next. When
 * no dialogue, piece or pool is on the road (a station without a dialogue,
 * before the pieces land) a covered story is heard as a set, so the block is
 * never empty while any text is readable.
 */
export function listeningInputSteps(ctx: PlanContext): { steps: Step[]; storyId?: string; slot?: ListeningSlot | 'story' } {
  const ex = pickDrill(ctx, 'listening-set');
  if (ex !== 'listening-set') return { steps: [] };
  const listened = store.progress.value.listened ?? [];
  const arenaAt = store.progress.value.arenaAt;
  const heard = new Set(listened);
  const avoid = lastHeardGenre(ctx);
  const genreOk = (s: StoryItem): boolean => avoid === undefined || s.genre !== avoid;
  const text = (story: StoryItem, slot: ListeningSlot | 'story'): { steps: Step[]; storyId: string; slot: ListeningSlot | 'story' } => ({
    steps: [makeStep(ctx, { block: 'input', exercise: ex, itemId: story.id, cardKey: null, params: resolveParams(ctx, ex, story, { storyId: story.id }) })],
    storyId: story.id,
    slot,
  });
  const start = LISTENING_SLOTS.indexOf(listeningSlot(ctx.today));
  for (let i = 0; i < LISTENING_SLOTS.length; i++) {
    const slot = LISTENING_SLOTS[(start + i) % LISTENING_SLOTS.length] as ListeningSlot;
    if (slot === 'piece') {
      const piece = pickStories(ctx, { audioFirst: true }).find((s) => !heard.has(s.id) && genreOk(s));
      if (piece) return text(piece, slot);
    } else if (slot === 'dialogue') {
      const d = nextToHear(pickStories(ctx, { listening: true }).filter(genreOk), listened, ctx.today, arenaAt);
      if (d) return text(d, slot);
    } else {
      const refs = walkRefs(ctx);
      if (refs.length > 0) return { steps: [makeStep(ctx, { block: 'input', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null, { refs }) })], slot };
    }
  }
  const story = nextToHear(pickStories(ctx, { kind: 'story', audioFirst: false }), listened, ctx.today, arenaAt);
  return story ? text(story, 'story') : { steps: [] };
}

/**
 * The Input block: a listening set (`listeningInputSteps`) or an episode to
 * read — a covered story that is not an audio-first piece, or a piece already
 * heard (pieces are heard before they are read, design 08 §3; a heard piece
 * reads as an ordinary first read, §10.3), else a dialogue the learner has a
 * part in (`speakable`, design 08 §11).
 */
export function inputBlockSteps(ctx: PlanContext, kind: PlannedBlock['spec']['inputKind']): { steps: Step[]; storyId?: string } {
  if (kind === 'listening') {
    const r = listeningInputSteps(ctx);
    return r.storyId !== undefined ? { steps: r.steps, storyId: r.storyId } : { steps: r.steps };
  }
  const ex = pickDrill(ctx, 'story-read');
  if (!ex) return { steps: [] };
  const heard = new Set(store.progress.value.listened ?? []);
  const story = pickStories(ctx, { kind: 'story' }).find((s) => !s.audioFirst || heard.has(s.id)) ?? pickStories(ctx, { speakable: true })[0];
  if (!story) return { steps: [] };
  return { steps: [makeStep(ctx, { block: 'input', exercise: ex, itemId: story.id, cardKey: null, params: resolveParams(ctx, ex, story, { storyId: story.id }) })], storyId: story.id };
}

function weakSteps(ctx: PlanContext, tag: ErrorTag | undefined, count: number, used: Set<CardKey>): Step[] {
  if (!tag) return [];
  const cards = weakPointSet(tag, store.cards, store.log.recent(5000), ctx.today).slice(0, count);
  const steps = toSteps(ctx, composeReviews(cards), 'weak', used);
  for (const s of steps) s.params.tag = tag;
  return steps;
}

function recheckSteps(ctx: PlanContext, used: Set<CardKey>, max: number): Step[] {
  const cards = recheckCards(store.cards).slice(0, max);
  const out: Step[] = [];
  for (const c of cards) {
    const s = stepForCard(ctx, c, 'reviews', { params: { recheck: true } });
    if (!s) continue;
    used.add(c.cardKey);
    out.push(s);
  }
  return out;
}


/** The context's template inputs. */
export function templateCtx(ctx: PlanContext, o: { tag?: ErrorTag; kageDue?: boolean } = {}): TemplateCtx {
  const weak = store.weakPoints.value;
  const tags = (Object.keys(weak) as ErrorTag[]).filter((t) => weak[t].active).sort((a, b) => weak[b].ewma - weak[a].ewma);
  const minutes = weekStrandMinutes(ctx.today);
  return {
    belt: ctx.belt,
    station: ctx.station,
    backlog: ctx.backlog,
    dueCount: ctx.showDue,
    weakTags: o.tag ? [o.tag, ...tags.filter((t) => t !== o.tag)] : tags,
    strandDeficit: strandDeficitFor(minutes, ctx.belt, store.profile.value.dan),
    kageDue: o.kageDue ?? false,
    newTarget: ctx.newTarget,
    day: ctx.today,
  };
}

/** Minutes a mode may fill before `fitToTime` trims: the design's upper bound (Kumite 10–14, Shugyō 30–45) plus the Michikusa's 10 s. */
export function fitBudgetMinutes(mode: SessionMode): number {
  const slack = mode === 'kata' ? 0.5 : mode === 'kumite' ? 4.5 : mode === 'shugyo' ? 15.5 : mode === 'welcome' ? 0.5 : 0;
  return MODE_MINUTES[mode] + slack;
}

/**
 * Today's Nemesis steps (design 04 §9): the day-0 dossier of every newly flagged
 * item and one duel per duel-ready item, with the builder's full params. They
 * ride inside a Kumite or larger as a small block ahead of the sparring.
 */
export function nemesisBlockSteps(ctx: PlanContext): Step[] {
  if (pickDrill(ctx, 'nemesis-duel') !== 'nemesis-duel') return [];
  const entries = [...nemesisItems(ctx.today).filter((e) => e.phase === 'dossier'), ...duelsReady(ctx.today)];
  const out: Step[] = [];
  for (const e of entries) out.push(...nemesisSteps(e.itemId, ctx.today, { loader: ctx.loader, resolve: (d, i, qc) => resolveParams(ctx, d, i, { qc, rep: ctx.today }) }));
  return out;
}

/** Grudge reps a training session carries on the day of a lost Gatekeeper fight (design 04 §11: ≥ 20 open the rematch). */
export const GRUDGE_BLOCK_REPS = 20;

/**
 * Grudge List steps (design 04 §11): on the day a Gatekeeper fight was lost
 * (`progress.gateAttemptDay[station] === today`) a Kata, Kumite or Shugyō
 * opens with up to 20 reps over the Grudge List cards, held out of the review
 * draws, so the same-day rematch the result screen promises is reachable; the
 * writer's +3 relearn copies ride in the runner as usual. Empty otherwise.
 */
export function grudgeBlockSteps(ctx: PlanContext, max = GRUDGE_BLOCK_REPS): Step[] {
  const p = store.progress.value;
  if (p.gateAttemptDay?.[ctx.station] !== ctx.today || p.stationsCleared.includes(ctx.station)) return [];
  const cards: QueueCard[] = [];
  for (const key of grudgeKeys()) {
    const qc = queueCardOf(ctx, key);
    if (qc) cards.push(qc);
  }
  const out: Step[] = [];
  for (const c of composeReviews(cards.sort((a, b) => a.r - b.r || (a.cardKey < b.cardKey ? -1 : 1)).slice(0, max))) {
    const s = stepForCard(ctx, c, 'weak');
    if (s) out.push(s);
  }
  return out;
}

/** `buildPlan` for the training modes; see the module header for the boss / exam / Kage / Dan builders. */
export async function buildPlan(mode: SessionMode, o: PlanOptions = {}): Promise<SessionPlan> {
  if (mode === 'gate' || mode === 'shinsa' || mode === 'kage' || mode === 'dan') {
    const fn = mode === 'gate' ? 'buildGate' : mode === 'shinsa' ? 'buildShinsa' : mode === 'kage' ? 'buildKage' : 'buildGauntlet';
    throw new RangeError(`buildPlan: mode "${mode}" is built by ${fn}() in src/session`);
  }
  // The listening pools ≤ station ride on the context (design 08 §4): the Ear Walk, the sparring's listen reps and the shadow warm-up read them.
  const ctx = await withPools(await loadPlanContext({ ...o, mode }));
  const template = fitToTime(templateFor(mode, templateCtx(ctx, { tag: o.tag })), fitBudgetMinutes(mode), { due: ctx.showDue });
  const used = new Set<CardKey>();
  const blocks: (PlannedBlock & { steps: Step[] })[] = [];
  const meta: PlanMeta = { dueTotal: ctx.dueTotal, dueTaken: 0, backlog: ctx.backlog, newCount: 0, scrollIds: [] };
  let dueBudget = ctx.showDue;

  // Nemesis dossier / duel steps come first so their cards are held out of every review draw: the duel is the item's rep of the day.
  const nemesis = mode === 'kumite' || mode === 'shugyo' ? nemesisBlockSteps(ctx) : [];
  for (const s of nemesis) if (s.cardKey) used.add(s.cardKey);
  // The Grudge List opens the session on the day of a lost fight (design 04 §11), its cards held out of the draws too.
  const grudge = mode === 'kata' || mode === 'kumite' || mode === 'shugyo' ? grudgeBlockSteps(ctx) : [];
  for (const s of grudge) if (s.cardKey) used.add(s.cardKey);
  if (grudge.length > 0) {
    const minutes = Math.round((grudge.reduce((a, s) => a + s.estMs, 0) / 60_000) * 10) / 10;
    blocks.push({ kind: 'weak', label: S.blockGrudge, minutes, spec: { kind: 'weak', minutes, count: grudge.length }, stepIds: grudge.map((s) => s.id), steps: grudge });
  }

  // Sparring wants ≥ 2 listen reps where available (design 03 §2.2): hold them back from the warm-up.
  const sparringSpec = template.find((t) => t.kind === 'sparring')?.spec;
  const listenWanted = sparringSpec?.facetMix?.listen ?? 0;
  const reserved: QueueCard[] = listenWanted > 0 ? dueQueue(ctx, Math.max(ctx.showDue, 1), used).filter((c) => c.facet === 'listen').slice(0, listenWanted) : [];
  for (const c of reserved) used.add(c.cardKey);

  const takeDue = (n: number): QueueCard[] => {
    const cards = dueQueue(ctx, Math.min(n, Math.max(0, dueBudget)), used);
    for (const c of cards) used.add(c.cardKey);
    dueBudget -= cards.length;
    meta.dueTaken += cards.length;
    return cards;
  };

  for (const t of template) {
    const spec = t.spec;
    let steps: Step[] = [];
    if (t.kind === 'sparring' && nemesis.length > 0) {
      const minutes = Math.round((nemesis.reduce((a, s) => a + s.estMs, 0) / 60_000) * 10) / 10;
      blocks.push({ kind: 'weak', label: S.blockNemesis, minutes, spec: { kind: 'weak', minutes, count: nemesis.length }, stepIds: nemesis.map((s) => s.id), steps: nemesis });
    }
    switch (t.kind) {
      case 'reviews': {
        if (mode === 'welcome') {
          steps = toSteps(ctx, composeReviews(welcomeSet(ctx, spec.count ?? 20)), 'reviews', used);
          meta.dueTaken += steps.length;
        } else {
          const rechecks = recheckSteps(ctx, used, 5);
          const cards = takeDue(Math.max(0, (spec.count ?? 0) - rechecks.length));
          steps = [...rechecks, ...toSteps(ctx, composeReviews(cards), 'reviews', used)];
          meta.dueTaken -= cards.length - steps.filter((s) => !s.params.recheck).length;
          if (mode === 'kata') {
            const m = michikusaStep(ctx);
            if (m && steps.length > 0) {
              steps.splice(Math.min(MICHIKUSA_AFTER_REP, steps.length), 0, m);
              meta.michikusaId = m.params.michikusaId;
            }
          }
        }
        break;
      }
      case 'warmup': {
        if (spec.outputKind === 'shadow' && pickDrill(ctx, 'shadow') === 'shadow') {
          const sh = outputBlockSteps(ctx, 'shadow', spec.count ?? 3);
          for (const s of sh) s.block = 'warmup';
          steps = sh;
        }
        if (steps.length === 0) {
          const cards = takeDue(spec.count ?? 3);
          steps = toSteps(ctx, composeReviews(cards), 'warmup', used);
        }
        break;
      }
      case 'scroll': {
        const max = ctx.newTarget > 0 ? (spec.scrollCount ?? 1) : spec.minCount ?? 1;
        const scrolls = ctx.newAllowed > 0 || ctx.newTarget > 0 ? scrollsForToday(ctx, max) : [];
        const sb = scrollBlockSteps(ctx, scrolls);
        steps = sb.steps;
        meta.scrollIds.push(...scrolls.map((s) => s.id));
        meta.newCount += sb.itemIds.length;
        break;
      }
      case 'sparring': {
        if (mode === 'rapid' || mode === 'gojuon') {
          const ex = pickDrill(ctx, mode === 'rapid' ? 'rapid-fire' : 'gojuon-fighter');
          if (ex) steps = [makeStep(ctx, { block: 'sparring', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null) })];
          break;
        }
        const room = Math.max(5, (spec.count ?? 15) - 2 * meta.newCount);
        const listenMin = spec.facetMix?.listen ?? 0;
        for (const c of reserved) used.delete(c.cardKey);
        const pool = dueQueue(ctx, Math.max(room * 2, 20), used);
        const listen = [...reserved, ...pool.filter((c) => c.facet === 'listen' && !reserved.some((r) => r.cardKey === c.cardKey))].slice(0, listenMin);
        const rest = pool.filter((c) => !listen.some((l) => l.cardKey === c.cardKey)).slice(0, Math.max(0, room - listen.length));
        const chosen = [...listen, ...rest].slice(0, Math.min(room, Math.max(0, dueBudget) + listen.length));
        for (const c of chosen) used.add(c.cardKey);
        dueBudget -= chosen.length;
        meta.dueTaken += chosen.length;
        steps = toSteps(ctx, composeReviews(chosen), 'sparring', used);
        break;
      }
      case 'input': {
        const r = inputBlockSteps(ctx, spec.inputKind);
        steps = r.steps;
        if (r.storyId) meta.storyId = r.storyId;
        break;
      }
      case 'output': {
        steps = outputBlockSteps(ctx, spec.outputKind, spec.count ?? 3, meta.storyId);
        break;
      }
      case 'weak': {
        steps = weakSteps(ctx, spec.tag ?? o.tag, spec.count ?? 20, used);
        break;
      }
      case 'michikusa': {
        if (mode === 'kata') break; // placed inside the reviews block, between reps 8 and 9
        const m = michikusaStep(ctx);
        if (m) {
          steps = [m];
          meta.michikusaId = m.params.michikusaId;
        }
        break;
      }
      case 'cooldown': {
        const n = spec.count ?? 3;
        let cards = takeDue(n);
        if (cards.length < n) cards = cards.concat(easiestCards(ctx, n - cards.length, used));
        for (const c of cards) used.add(c.cardKey);
        steps = toSteps(ctx, cards.sort((a, b) => b.r - a.r), 'cooldown', used);
        break;
      }
      case 'phase':
        break;
    }
    blocks.push({ kind: t.kind, label: t.label, minutes: t.minutes, spec, stepIds: steps.map((s) => s.id), steps });
  }
  return finalizePlan(ctx, mode, blocks, meta);
}

/** The plan a snapshot was taken from (its steps include the runner's re-queues). */
export function planFromSnapshot(s: SessionSnapshot): SessionPlan {
  return s.plan;
}

/** Retrievability helper re-exported for the feed and end card. */
export function retrievabilityOf(t: CardTuple, today: EpochDay): number {
  return cardRetrievability(t, today);
}

/** Item kind for a key from the store's facets (chunks detected). */
export function kindForKey(key: CardKey): ItemKind | null {
  const { itemId } = parseCardKey(key);
  return kindOfCards(itemId, Object.keys(store.cards.byItem(itemId)) as QueueCard['facet'][]) ?? null;
}
