/**
 * TSUZUKU — Shinsa (審査) belt exam (design 04 §12, 02 §2).
 *
 *  Eligibility: every Gatekeeper of the belt passed, ≥ 85 % of the belt's
 *  items at item belt Green and ≥ 50 % at Brown (`derived.beltEligibility`),
 *  and no pending Sensei's Notes for the belt (one Notes session first).
 *  Five sections, pass = ≥ 80 % in each present section; no hints, no
 *  furigana (from Orange), 20 s soft timer per item (never a fail).
 *    耳 10 items at belt speed (speed-tier presets only): belt story lines
 *       whose resolved tokens are all known, then — short of 10 — the belt
 *       stations' own pool examples the learner knows (design 08 §4, with
 *       their clip keys), then the belt's words as bare prompts
 *    読 2 passages; Brown ≥ 300 cpm, Black ≥ 400 cpm (hard timer from the cpm)
 *    形 30 typed production / cloze / transform items from the belt pool
 *    口 one role-play (Speak or Type) + 5 shadow lines; Black adds a 2-minute
 *       monologue. The role-play takes a dialogue the learner has a part in
 *       (`isSpeakable`, design 08 §11): an audio-first piece only with
 *       `learnerSpeaker`
 *    書 3–6 sentences to a prompt (from Green)
 *  Not passed → `progress.shinsaNotes` (items + dominant tags); a retake needs
 *  one Notes session (`buildNotesPlan` → the runner calls
 *  `completeNotesSession`). Notes are written only when a missed step had a
 *  card behind it: failing only the card-less sections (Reading, Speaking,
 *  Writing) leaves nothing to drill, so the retake opens at once instead of
 *  waiting on a Notes session that can never be built. Passed →
 *  `progress.shinsaPassed`, `profile.belt`; `shinsa:result` is emitted either
 *  way (B emits `belt:promoted`).
 */
import { BELT_IDS, ERROR_TAGS, STATIONS, type Belt, type CardKey, type DrillId, type ErrorTag, type StationBundle, type StoryItem, type StoryLine } from '../content/types';
import type { ContentLoader } from '../content/loader';
import { hasKanji, toPlain } from '../content/ruby';
import { SHINSA_SECTIONS, type ShinsaSection } from '../shared/catalog';
import { bus } from '../shared/events';
import { cardKey as makeKey } from '../shared/ids';
import type { SessionPlan, Step, StepParams, StepResult } from '../shared/session-types';
import { CardFlag, hasFlag, type SpeedTier } from '../shared/store-types';
import { store } from '../store';
import { beltEligibility, beltStations, bundleItemIds, kindFor } from '../store/derived';
import { type QueueCard } from '../learn';
import { S, SHINSA_LABEL, BELT_NAME, fill } from './engine-strings';
import { finalizePlan, isGrammar, isSpeakable, isVocab, knownExampleRefs, loadPlanContext, makeStep, parseExampleRef, pickDrill, pickStories, queueCardOf, resolveParams, stepForCard, withPools, type PlanContext } from './builder';
import { dedupe } from './params';
import { sampleLowR } from './gatekeeper';

export const SHINSA_PASS = 0.8;
export const SHINSA_GREEN = 0.85;
export const SHINSA_BROWN = 0.5;
export const SHINSA_SOFT_TIMER_MS = 20_000;
export const SECTION_SIZES = { ear: 10, read: 2, form: 30, shadow: 5 } as const;
export const NOTES_PLAN_PREFIX = 'shinsa-notes-';

/** Belt listening speed: speed-tier presets only (design 04 §12). */
export const SHINSA_SPEED: Record<Belt, number> = { white: 0.9, yellow: 0.9, orange: 0.9, green: 1.0, blue: 1.1, purple: 1.1, brown: 1.25, black: 1.25 };
/** Reading cpm floors for the timed passages. */
export const SHINSA_CPM: Partial<Record<Belt, number>> = { brown: 300, black: 400 };
/** Black (Shodan) monologue length, seconds. */
export const SHODAN_MONOLOGUE_S = 120;

/** The speed tier whose preset equals the belt's rate. */
export function speedTierFor(belt: Belt): SpeedTier {
  const rate = SHINSA_SPEED[belt];
  if (rate <= 0.75) return 1;
  if (rate <= 0.9) return 2;
  if (rate <= 1.0) return 3;
  if (rate <= 1.1) return 4;
  return 5;
}

/** The belt after `belt` on the road, or `null` after Black. */
export function nextBelt(belt: Belt): Belt | null {
  const i = BELT_IDS.indexOf(belt);
  return i >= 0 && i + 1 < BELT_IDS.length ? (BELT_IDS[i + 1] as Belt) : null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Eligibility                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ShinsaEligibility {
  eligible: boolean;
  reasons: string[];
  /** Present when bundles were available. */
  coverage?: { green: number; brown: number; total: number };
  gatesDone: boolean;
  notesPending: boolean;
  passed: boolean;
}

/**
 * Sync check. Coverage needs the belt's station bundles; without them the
 * result is ineligible with `S.shinsaReasonContent` (use `shinsaEligibleAsync`).
 */
export function shinsaEligible(belt: Belt, o: { bundles?: StationBundle[] } = {}): ShinsaEligibility {
  const p = store.progress.value;
  const reasons: string[] = [];
  const passed = p.shinsaPassed.includes(belt);
  const [from, to] = beltStations(belt);
  let gatesDone = true;
  for (let n = from; n <= to; n++) if (!p.stationsCleared.includes(n)) gatesDone = false;
  const notesPending = p.shinsaNotes?.belt === belt;
  if (belt === 'white') return { eligible: false, reasons: [S.shinsaReasonWhite], gatesDone, notesPending, passed };
  if (passed) reasons.push(S.shinsaReasonPassed);
  if (!gatesDone) reasons.push(fill(S.shinsaReasonGates, { belt: BELT_NAME[belt] }));
  if (notesPending) reasons.push(S.shinsaReasonNotes);
  let coverage: ShinsaEligibility['coverage'];
  if (o.bundles && o.bundles.length > 0) {
    const e = beltEligibility(belt, o.bundles);
    coverage = { green: e.coverageRec, brown: e.coverageProd, total: e.total };
    if (e.total === 0) reasons.push(S.shinsaReasonContent);
    if (e.coverageRec < SHINSA_GREEN) reasons.push(fill(S.shinsaReasonGreen, { pct: 85, now: Math.round(e.coverageRec * 100) }));
    if (e.coverageProd < SHINSA_BROWN) reasons.push(fill(S.shinsaReasonBrown, { pct: 50, now: Math.round(e.coverageProd * 100) }));
  } else {
    reasons.push(S.shinsaReasonContent);
  }
  const out: ShinsaEligibility = { eligible: reasons.length === 0, reasons, gatesDone, notesPending, passed };
  if (coverage) out.coverage = coverage;
  return out;
}

/** Loads the belt's station bundles (stations absent from the manifest are skipped). */
export async function loadBeltBundles(belt: Belt, loader?: ContentLoader): Promise<StationBundle[]> {
  const l = loader ?? (await import('../content/loader')).content;
  const [from, to] = beltStations(belt);
  const out: StationBundle[] = [];
  for (let n = from; n <= to; n++) {
    try {
      out.push(await l.station(n));
    } catch {
      /* missing station */
    }
  }
  return out;
}

export async function shinsaEligibleAsync(belt: Belt, loader?: ContentLoader): Promise<ShinsaEligibility> {
  return shinsaEligible(belt, { bundles: await loadBeltBundles(belt, loader) });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Building                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ShinsaOptions {
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
}

function stepId(belt: Belt, section: ShinsaSection, i: number): string {
  return `shinsa:${belt}:${section}:${i}`;
}

/** Section of a Shinsa step from its id. */
export function sectionOfStep(id: string): ShinsaSection | null {
  const m = /^shinsa:[a-z]+:([a-z]+):/.exec(id);
  const s = m?.[1];
  return s && (SHINSA_SECTIONS as readonly string[]).includes(s) ? (s as ShinsaSection) : null;
}

function formCandidates(ctx: PlanContext, ids: readonly string[]): QueueCard[] {
  const out: QueueCard[] = [];
  for (const id of ids) {
    const facets = store.cards.byItem(id);
    const kind = kindFor(id, facets);
    if (!kind || kind === 'component') continue;
    const wanted: QueueCard['facet'][] = kind === 'grammar' ? ['prod', 'cloze'] : kind === 'kanji' ? ['read'] : ['prod'];
    for (const f of wanted) {
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

function formDrill(ctx: PlanContext, qc: QueueCard): DrillId {
  switch (qc.kind) {
    case 'kana':
      return 'kana-forge';
    case 'kanji':
      return 'kanji-read';
    case 'grammar': {
      if (qc.facet === 'cloze') return 'pattern-cloze';
      const g = ctx.loader.get(qc.itemId);
      if (ctx.station >= 16) return 'transform';
      if (ctx.station >= 10 && isGrammar(g) && g.unlocksForms && g.unlocksForms.length > 0) return 'form-forge';
      return 'pattern-cloze';
    }
    case 'chunk':
      return 'shadow';
    default:
      return 'production-forge';
  }
}

/** One candidate of the 耳 section: a known story line, a belt pool example (with its clip key), or a bare word. */
type EarCandidate = { story: StoryItem; lineIndex: number; vocabId: string | null } | { ref: { itemId: string; k: number; clip: string }; vocabId: string | null } | { word: string; vocabId: string };

/** Every resolved token of the line is known (the Gatekeeper's rule; design 04 §11). */
function lineKnown(line: StoryLine, known: ReadonlySet<string>): boolean {
  const ids = (line.tokenIds ?? []).filter((x): x is string => x !== null);
  return ids.length > 0 && ids.every((id) => known.has(id));
}

/**
 * 耳 candidates (design 04 §12, 08 §4): the belt stories' lines whose tokens
 * the learner all knows; short of 10, the belt stations' own pool examples
 * the learner knows (i+0); short still, the belt's words as bare prompts,
 * known ones first — never a line or an example with an untaught word.
 */
export function earCandidates(ctx: PlanContext, stories: readonly StoryItem[], beltIds: readonly string[], range: [number, number]): EarCandidate[] {
  const out: EarCandidate[] = [];
  for (const st of stories) {
    st.lines.forEach((line, lineIndex) => {
      if (!lineKnown(line, ctx.known)) return;
      out.push({ story: st, lineIndex, vocabId: line.tokenIds?.find((x): x is string => x !== null && x.startsWith('v-')) ?? null });
    });
  }
  if (out.length < SECTION_SIZES.ear) {
    for (const r of knownExampleRefs(ctx, { stations: (n) => n >= range[0] && n <= range[1] })) {
      if (out.length >= SECTION_SIZES.ear) break;
      const parsed = parseExampleRef(r.ref);
      if (!parsed) continue;
      out.push({ ref: { itemId: parsed.itemId, k: parsed.k, clip: r.ref }, vocabId: parsed.itemId.startsWith('v-') ? parsed.itemId : (r.ids.find((x) => x.startsWith('v-')) ?? null) });
    }
  }
  if (out.length < SECTION_SIZES.ear) {
    const words = beltIds.map((id) => ctx.loader.get(id)).filter(isVocab);
    for (const v of [...words.filter((v) => ctx.known.has(v.id)), ...words.filter((v) => !ctx.known.has(v.id))]) {
      if (out.length >= SECTION_SIZES.ear) break;
      out.push({ word: v.id, vocabId: v.id });
    }
  }
  return out;
}

export async function buildShinsa(belt: Belt, seed: number, o: ShinsaOptions = {}): Promise<SessionPlan> {
  const [from, to] = beltStations(belt);
  // The belt stations' listening pools ride on the context (design 08 §4): the 耳 section draws its examples from them.
  const ctx = await withPools(await loadPlanContext({ station: to, loader: o.loader, available: o.available, seed, mode: 'shinsa' }));
  const bundles: StationBundle[] = [];
  for (let n = from; n <= to; n++) {
    try {
      const b = await ctx.loader.station(n);
      bundles.push(b);
      if (n !== to) {
        try {
          await ctx.loader.preloadStation(n);
        } catch {
          /* partial content */
        }
      }
    } catch {
      /* missing station */
    }
  }
  const beltIds = bundles.flatMap(bundleItemIds);
  const beltStories: StoryItem[] = [];
  for (const b of bundles) for (const sid of b.storyIds) {
    const st = ctx.loader.get<StoryItem>(sid);
    if (st && 'lines' in st && !ctx.stories.includes(st)) beltStories.push(st);
  }
  const stories = [...ctx.stories, ...beltStories];
  const rng = ctx.rng;
  const rate = SHINSA_SPEED[belt];
  const soft = SHINSA_SOFT_TIMER_MS;
  const blocks: { kind: 'phase'; label: string; minutes: number; spec: { kind: 'phase'; minutes: number; phase: number; count: number }; stepIds: string[]; steps: Step[] }[] = [];
  const push = (section: ShinsaSection, minutes: number, steps: Step[]): void => {
    blocks.push({ kind: 'phase', label: SHINSA_LABEL[section], minutes, spec: { kind: 'phase', minutes, phase: SHINSA_SECTIONS.indexOf(section) + 1, count: steps.length }, stepIds: steps.map((s) => s.id), steps });
  };

  // 耳 Listening
  const ear: Step[] = [];
  const listen = pickDrill(ctx, 'sentence-listen');
  if (listen === 'sentence-listen') {
    const candidates = earCandidates(ctx, stories, beltIds, [from, to]);
    const picked = sampleLowR(
      rng,
      candidates.map((_, i) => ({ cardKey: 'x#rec' as CardKey, itemId: String(i), kind: 'vocab' as const, facet: 'rec' as const, r: 0.5, mature: false, exposures: 0 })),
      SECTION_SIZES.ear,
    ).map((q) => candidates[Number(q.itemId)]!);
    picked.forEach((l, i) => {
      const vocab = l.vocabId ? ctx.loader.get(l.vocabId) ?? null : null;
      const key = l.vocabId ? makeKey(l.vocabId, 'listen') : null;
      let params: StepParams;
      if ('word' in l) {
        // The word itself (bare word → kana), with its own clip key; its example may carry an untaught word.
        params = isVocab(vocab)
          ? { sentence: hasKanji(vocab.word) ? `{${vocab.word}|${vocab.kana}}` : vocab.word, answer: vocab.kana, accept: dedupe([vocab.word, vocab.kana]), promptEn: vocab.meanings[0] ?? '', clip: vocab.id }
          : resolveParams(ctx, listen, vocab, { rep: i });
      } else if ('ref' in l) {
        params = resolveParams(ctx, listen, ctx.loader.get(l.ref.itemId) ?? null, { example: l.ref.k, rep: i });
      } else {
        params = resolveParams(ctx, listen, vocab, { storyId: l.story.id, lineIndex: l.lineIndex, rep: i });
      }
      params.rate = rate;
      ear.push(makeStep(ctx, { block: 'phase', exercise: listen, itemId: l.vocabId, cardKey: key && store.cards.get(key) ? key : null, params, timerMs: soft, exposures: 5, id: stepId(belt, 'ear', i) }));
    });
  }
  push('ear', 4, ear);

  // 読 Reading
  const read: Step[] = [];
  const reader = pickDrill(ctx, 'story-read');
  if (reader === 'story-read') {
    const covered = pickStories({ ...ctx, stories }, { kind: 'story', station: to });
    const pool = (covered.length >= SECTION_SIZES.read ? covered : stories.filter((s) => s.kind === 'story')).slice().sort((a, b) => (b.id < a.id ? -1 : 1));
    const cpm = SHINSA_CPM[belt];
    pool.slice(0, SECTION_SIZES.read).forEach((st, i) => {
      const params = resolveParams(ctx, reader, st, { storyId: st.id });
      const chars = st.lines.reduce((a, l) => a + toPlain(l.ja).length, 0);
      if (cpm) {
        params.rate = cpm;
        read.push(makeStep(ctx, { block: 'phase', exercise: reader, itemId: st.id, cardKey: null, params, timed: true, timerMs: Math.max(60_000, Math.round((chars / cpm) * 60_000)), id: stepId(belt, 'read', i) }));
      } else {
        read.push(makeStep(ctx, { block: 'phase', exercise: reader, itemId: st.id, cardKey: null, params, id: stepId(belt, 'read', i) }));
      }
    });
  }
  push('read', 6, read);

  // 形 Form
  const form: Step[] = [];
  const picked = sampleLowR(rng, formCandidates(ctx, beltIds), SECTION_SIZES.form);
  picked.forEach((qc, i) => {
    const s = stepForCard(ctx, { ...qc, exposures: Math.max(2, qc.exposures) }, 'phase', { exercise: formDrill(ctx, qc), id: stepId(belt, 'form', i), rep: i });
    if (s) {
      s.timerMs = soft;
      form.push(s);
    }
  });
  push('form', 8, form);

  // 口 Speaking
  const mouth: Step[] = [];
  const rp = pickDrill(ctx, 'role-play');
  // A dialogue the learner has a part in (design 08 §11): an audio-first piece only when its writer set `learnerSpeaker`.
  const dialogues = stories.filter(isSpeakable).sort((a, b) => (b.id < a.id ? -1 : 1));
  if (rp === 'role-play' && dialogues[0]) {
    const d = dialogues[0];
    const params = resolveParams(ctx, rp, d, { storyId: d.id });
    params.mode = ctx.settings.speaking === 'self' || ctx.settings.speaking === 'off' ? 'type' : 'speak';
    mouth.push(makeStep(ctx, { block: 'phase', exercise: rp, itemId: d.id, cardKey: null, params, id: stepId(belt, 'mouth', 0) }));
  }
  const sh = pickDrill(ctx, 'shadow');
  if (sh === 'shadow') {
    const lines = stories.flatMap((st) => st.lines.map((_, lineIndex) => ({ story: st, lineIndex })));
    const chosen = sampleLowR(
      rng,
      lines.map((_, i) => ({ cardKey: 'x#rec' as CardKey, itemId: String(i), kind: 'vocab' as const, facet: 'rec' as const, r: 0.5, mature: false, exposures: 0 })),
      SECTION_SIZES.shadow,
    ).map((q) => lines[Number(q.itemId)]!);
    chosen.forEach((l, i) => {
      const params = resolveParams(ctx, sh, null, { storyId: l.story.id, lineIndex: l.lineIndex });
      params.rate = rate;
      mouth.push(makeStep(ctx, { block: 'phase', exercise: sh, itemId: null, cardKey: null, params, id: stepId(belt, 'mouth', i + 1) }));
    });
  }
  if (belt === 'black') {
    const mono = pickDrill(ctx, 'monologue');
    if (mono === 'monologue') mouth.push(makeStep(ctx, { block: 'phase', exercise: mono, itemId: null, cardKey: null, params: { seconds: SHODAN_MONOLOGUE_S, promptEn: S.shinsaMonologuePrompt }, id: stepId(belt, 'mouth', 9) }));
  }
  push('mouth', 4, mouth);

  // 書 Writing (from Green)
  const write: Step[] = [];
  const wd = pickDrill(ctx, 'writing-dojo');
  if (BELT_IDS.indexOf(belt) >= BELT_IDS.indexOf('green') && wd === 'writing-dojo') {
    const grammar = bundles.flatMap((b) => b.grammarIds).map((id) => ctx.loader.get(id)).filter(isGrammar).slice(-3);
    const n = belt === 'green' ? 3 : belt === 'blue' || belt === 'purple' ? 4 : 6;
    const st = STATIONS.find((s) => s.number === to);
    write.push(makeStep(ctx, { block: 'phase', exercise: wd, itemId: null, cardKey: null, params: { patternIds: grammar.map((g) => g.id), promptEn: fill(S.shinsaWritingPrompt, { n, station: st ? `${st.nameJa} ${st.nameRomaji}` : `Station ${to}` }), seconds: n * 60 }, id: stepId(belt, 'write', 0) }));
  }
  push('write', 3, write);

  return finalizePlan(ctx, 'shinsa', blocks, { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scoring                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ShinsaScore {
  sections: Record<ShinsaSection, number>;
  passed: boolean;
  /** Additive: what Sensei's Notes would hold on a fail. */
  notes: { items: CardKey[]; tags: ErrorTag[] };
  /** Additive: sections that had steps. */
  present: ShinsaSection[];
}

function hit(r: StepResult | undefined): boolean {
  if (!r) return false;
  if (r.guard) return false;
  if (r.correct) return true;
  if (r.score !== undefined) return r.score >= SHINSA_PASS;
  return r.selfRating === 3;
}

/** ≥ 80 % in each section that has steps; absent sections score 1 (not applicable). */
export function scoreShinsa(plan: SessionPlan, steps: StepResult[]): ShinsaScore {
  const byId = new Map(steps.map((r) => [r.stepId, r] as const));
  const totals: Record<ShinsaSection, { hit: number; total: number }> = { ear: { hit: 0, total: 0 }, read: { hit: 0, total: 0 }, form: { hit: 0, total: 0 }, mouth: { hit: 0, total: 0 }, write: { hit: 0, total: 0 } };
  for (const s of plan.steps) {
    const sec = sectionOfStep(s.id);
    if (!sec) continue;
    totals[sec].total++;
    if (hit(byId.get(s.id))) totals[sec].hit++;
  }
  const sections = {} as Record<ShinsaSection, number>;
  const present: ShinsaSection[] = [];
  for (const sec of SHINSA_SECTIONS) {
    const t = totals[sec];
    sections[sec] = t.total === 0 ? 1 : Math.round((t.hit / t.total) * 1000) / 1000;
    if (t.total > 0) present.push(sec);
  }
  const passed = present.length > 0 && present.every((sec) => sections[sec] >= SHINSA_PASS);
  return { sections, passed, notes: senseiNotes(steps), present };
}

/** 先生の覚書: the missed cards and the dominant error tags (most frequent first). */
export function senseiNotes(steps: StepResult[]): { items: CardKey[]; tags: ErrorTag[] } {
  const items: CardKey[] = [];
  const counts = new Map<ErrorTag, number>();
  for (const r of steps) {
    if (!hit(r) && r.cardKey && !items.includes(r.cardKey)) items.push(r.cardKey);
    if (!hit(r)) for (const t of r.errorTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const tags = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || ERROR_TAGS.indexOf(a[0]) - ERROR_TAGS.indexOf(b[0]))
    .map(([t]) => t);
  return { items, tags };
}

/**
 * Writes the result: pass → `shinsaPassed` + `profile.belt`; fail with missed
 * cards → Sensei's Notes (a fail with nothing to drill clears any stale notes
 * so the retake is open). Emits `shinsa:result`.
 */
export function finishShinsa(belt: Belt, s: ShinsaScore): void {
  if (s.passed) {
    store.patch('progress', (p) => {
      const next = { ...p, shinsaPassed: p.shinsaPassed.includes(belt) ? p.shinsaPassed : [...p.shinsaPassed, belt] };
      if (next.shinsaNotes?.belt === belt) delete next.shinsaNotes;
      return next;
    });
    store.patch('profile', (p) => (BELT_IDS.indexOf(belt) > BELT_IDS.indexOf(p.belt) ? { ...p, belt, ...(belt === 'black' && p.dan < 1 ? { dan: 1 } : {}) } : p));
  } else if (s.notes.items.length > 0) {
    store.patch('progress', (p) => ({ ...p, shinsaNotes: { belt, items: s.notes.items.slice(), tags: s.notes.tags.slice() } }));
  } else {
    store.patch('progress', (p) => {
      if (p.shinsaNotes?.belt !== belt) return p;
      const next = { ...p };
      delete next.shinsaNotes;
      return next;
    });
  }
  bus.emit('shinsa:result', { belt, passed: s.passed, sections: { ...s.sections } });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sensei's Notes session                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** A `weak`-mode plan over the noted cards (plus a few more carrying the dominant tag); `null` without notes. */
export async function buildNotesPlan(o: ShinsaOptions = {}): Promise<SessionPlan | null> {
  const notes = store.progress.value.shinsaNotes;
  if (!notes) return null;
  const ctx = await loadPlanContext({ loader: o.loader, available: o.available, mode: 'notes' });
  ctx.planKey = `${NOTES_PLAN_PREFIX}${ctx.planKey}`;
  try {
    await ctx.loader.load(notes.items.map((k) => k.split('#')[0] as string).filter((id) => ctx.loader.get(id) === undefined));
  } catch {
    /* offline */
  }
  const steps: Step[] = [];
  const tag = notes.tags[0];
  for (const key of notes.items) {
    const qc = queueCardOf(ctx, key);
    if (!qc) continue;
    const s = stepForCard(ctx, qc, 'weak', { id: `${NOTES_PLAN_PREFIX}${key}` });
    if (!s) continue;
    if (tag) s.params.tag = tag;
    steps.push(s);
  }
  return finalizePlan(ctx, 'weak', [{ kind: 'weak', label: S.blockNotes, minutes: 3, spec: { kind: 'weak', minutes: 3, count: steps.length, ...(tag ? { tag } : {}) }, stepIds: steps.map((s) => s.id), steps }], {
    dueTotal: 0,
    dueTaken: 0,
    backlog: false,
    newCount: 0,
    scrollIds: [],
  });
}

/** The Notes session is done: the retake is open. */
export function completeNotesSession(): void {
  store.patch('progress', (p) => {
    if (!p.shinsaNotes) return p;
    const next = { ...p };
    delete next.shinsaNotes;
    return next;
  });
}
