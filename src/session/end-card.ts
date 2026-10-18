/**
 * TSUZUKU — the つづく end card model (design 03 §10, §5, §12).
 *
 *  tally()          reps · accuracy · best combo · Ippon · promotions · XP · minutes
 *  jikaiYokoku()    次回予告: one sentence of the next episode with exactly one
 *                   token masked as ???, three words from the next Scroll in
 *                   kana, one informational milestone line (no countdown words)
 *  endCardNotes()   overtraining line, Arcade-feel nudge, cramming / backlog lines
 *  omikuji()        the Omikuji cut: a seeded proverb line, no modifiers
 *  trackCeremonies() collects badge / wallpaper / stamp / belt / level events
 *                   emitted by B during a session so the card can replay them
 */
import type { ContentItem, StoryItem, StoryLine } from '../content/types';
import { STATIONS } from '../content/types';
import type { ContentLoader } from '../content/loader';
import { segmentsToTokens, toPlain } from '../content/ruby';
import { bus, type EventName, type Events } from '../shared/events';
import { hashSeed } from '../shared/hash';
import { parseCardKey } from '../shared/ids';
import type { JikaiYokoku, StepResult, Tally } from '../shared/session-types';
import type { EpochDay, ItemBelt, Ledger, Settings } from '../shared/store-types';
import { store } from '../store';
import { SHINSA_STATIONS, beltOfStation, projectedArrival, stationProgress } from '../store/derived';
import { nextScrolls } from '../learn';
import { S, fill, BELT_NAME } from './engine-strings';
import { isGrammar, isKana, isKanji, isVocab, isComponent, loadPlanContext, type PlanContext } from './builder';
import { ES } from './end-card-strings';
import { kageDueThisWeek } from './kage';

/* ────────────────────────────────────────────────────────────────────────── */
/* Tally                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TallyOptions {
  startedAt: number;
  endedAt: number;
  questsDone: string[];
  backlogWaiting: number;
  /** Milliseconds spent paused (excluded from `minutes`). */
  pausedMs?: number;
}

/** Design 03 §10 #1. `reps` counts graded steps (a Michikusa card is not a rep). */
export function tally(steps: StepResult[], o: TallyOptions): Tally {
  const graded = steps.filter((s) => s.cardKey !== null || s.rating !== null || s.score !== undefined || s.selfRating !== undefined || s.correct);
  const reps = graded.length;
  const correct = graded.filter((s) => s.correct).length;
  let bestCombo = 0;
  let ippon = 0;
  let xp = 0;
  const promotions: { itemId: string; to: ItemBelt }[] = [];
  for (const s of steps) {
    bestCombo = Math.max(bestCombo, s.combo);
    if (s.ippon) ippon++;
    xp += s.xpDelta;
    if (s.promotion && s.cardKey) promotions.push({ itemId: parseCardKey(s.cardKey).itemId, to: s.promotion });
  }
  const spanMs = Math.max(0, o.endedAt - o.startedAt - (o.pausedMs ?? 0));
  return {
    reps,
    correct,
    accuracy: reps > 0 ? Math.round((correct / reps) * 1000) / 1000 : 0,
    bestCombo,
    ippon,
    xp,
    minutes: Math.round(spanMs / 6000) / 10,
    promotions,
    questsDone: o.questsDone.slice(),
    backlogWaiting: Math.max(0, o.backlogWaiting),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 次回予告                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MaskedLine {
  ja: string;
  kana: string;
  maskedToken: number;
  unknownCount: number;
}

/** Masks token `index` of a line in its ruby'd `ja` (the kana stays whole for TTS). */
export function maskLine(line: StoryLine, index: number): { ja: string; kana: string } {
  if (line.tokens.length === 0 || index < 0 || index >= line.tokens.length) return { ja: line.ja, kana: line.kana };
  const parts = segmentsToTokens(line.ja, line.tokens);
  const ja = parts.map((p, i) => (i === index ? S.maskToken : p.ja)).join('');
  return { ja, kana: line.kana };
}

/**
 * The line with the fewest not-yet-introduced tokens (≥ 1), masking the first
 * of them; with no unknown token anywhere, the first token whose item is due
 * by tomorrow; else the first resolved content token.
 */
export function pickMaskedLine(story: StoryItem, introduced: (id: string) => boolean, dueSoon: (id: string) => boolean): MaskedLine | null {
  let best: { line: StoryLine; idx: number; unknown: number } | null = null;
  for (const line of story.lines) {
    const ids = line.tokenIds ?? [];
    const unknownIdx = ids.findIndex((id) => id !== null && !introduced(id));
    if (unknownIdx < 0) continue;
    const unknown = ids.filter((id) => id !== null && !introduced(id)).length;
    if (!best || unknown < best.unknown) best = { line, idx: unknownIdx, unknown };
  }
  if (!best) {
    for (const line of story.lines) {
      const ids = line.tokenIds ?? [];
      const idx = ids.findIndex((id) => id !== null && dueSoon(id));
      if (idx >= 0) {
        best = { line, idx, unknown: 0 };
        break;
      }
    }
  }
  if (!best) {
    for (const line of story.lines) {
      const idx = (line.tokenIds ?? []).findIndex((id) => id !== null);
      if (idx >= 0) {
        best = { line, idx, unknown: 0 };
        break;
      }
    }
  }
  if (!best) return null;
  const masked = maskLine(best.line, best.idx);
  return { ja: masked.ja, kana: masked.kana, maskedToken: best.idx, unknownCount: best.unknown };
}

/** Kana surface of an item for the "three words you will meet tomorrow" line. */
export function kanaOf(item: ContentItem | undefined): string | null {
  if (!item) return null;
  if (isVocab(item)) return item.kana;
  if (isKana(item)) return item.kana;
  if (isKanji(item)) return item.examples[0]?.kana ?? item.kun[0]?.replace('.', '') ?? item.on[0] ?? null;
  if (isGrammar(item)) return item.clozeHints[0] ?? toPlain(item.pattern);
  if (isComponent(item)) return item.char;
  return null;
}

/** Tomorrow's first Scroll ignoring today's spent budget (what the learner will meet next). */
export function nextScrollItems(ctx: PlanContext, n: number): string[] {
  if (!ctx.bundle) return [];
  const scrolls = nextScrolls({
    bundle: ctx.bundle,
    cards: store.cards,
    captured: store.captured.value,
    newPerDay: { vocab: 10, kanji: 4, grammar: 1 },
    introducedToday: { vocab: 0, kanji: 0, grammar: 0 },
    belt: beltOfStation(ctx.station),
    components: ctx.components,
    get: (id) => ctx.loader.get(id),
    today: ctx.today,
    kanaPerDay: 20,
    introducedKanaToday: 0,
    introducedComponentsToday: 0,
  });
  // "Three words": prefer a vocab / kanji / grammar / kana Scroll over a component mini-scroll.
  const first = scrolls.find((sc) => sc.kind !== 'component') ?? scrolls[0];
  return first ? first.itemIds.slice(0, n) : [];
}

/**
 * The next station's vista name ("Fuji view"), when one is known — C2's
 * `src/art/road/vistas.ts` table once it lands; `null` / `undefined` for none.
 */
export type VistaLookup = (station: number) => string | null | undefined;

/** `坂の関守 Hill Keeper`, with the vista riding inside it (`… · Fuji view`) when the lookup knows one (design 09 §10 B2). */
export function gateNameOf(station: number, vista?: VistaLookup): string {
  const st = STATIONS.find((s) => s.number === station);
  const gate = st ? `${st.gateJa} ${st.gateEn}` : `Station ${station}`;
  const v = vista?.(station);
  return v ? fill(ES.gateWithVista, { gate, vista: v }) : gate;
}

/** The milestone line: gate ETA from Projected Arrival, else the belt exam, else the Kage Monday (design 03 §10 #2). */
export function milestoneLine(ctx: PlanContext, vista?: VistaLookup): string {
  const progress = store.progress.value;
  if (ctx.bundle) {
    const sp = stationProgress(ctx.station, ctx.bundle);
    if (sp.gateReady && !sp.cleared) return fill(S.milestoneGateReady, { gate: gateNameOf(ctx.station, vista) });
  }
  if (!progress.stationsCleared.includes(ctx.station)) {
    const proj = projectedArrival(store.meta(), store.cards, ctx.bundles, ctx.station, ctx.today, store.log.recent(5000));
    if (proj) {
      const days = Math.max(0, proj.atPace - ctx.today);
      return days <= 1 ? fill(S.milestoneGateSoon, { gate: gateNameOf(ctx.station, vista) }) : fill(S.milestoneGateIn, { gate: gateNameOf(ctx.station, vista), n: days });
    }
  }
  const belt = beltOfStation(ctx.station);
  const shinsaStation = SHINSA_STATIONS.find((n) => n >= ctx.station && beltOfStation(n) === belt);
  if (belt !== 'white' && shinsaStation !== undefined && !progress.shinsaPassed.includes(belt)) {
    const st = STATIONS.find((s) => s.number === shinsaStation);
    const stationName = st ? `${st.nameJa} ${st.nameRomaji}` : `Station ${shinsaStation}`;
    return progress.stationsCleared.includes(shinsaStation) ? fill(S.milestoneShinsaReady, { belt: BELT_NAME[belt] }) : fill(S.milestoneShinsa, { belt: BELT_NAME[belt], station: stationName });
  }
  if (ctx.station >= 53 && progress.stationsCleared.includes(53)) return S.milestoneDan;
  return kageDueThisWeek(store.kage.value, ctx.today) ? S.milestoneKageNow : S.milestoneKageMonday;
}

export interface YokokuOptions {
  station: number;
  today: EpochDay;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: the next-station vista name for line 3 (design 09 §10 B2); absent until C2's vistas table lands. */
  vista?: VistaLookup;
}

/** 次回予告 (design 03 §10 #2). Every line is informational; nothing counts down. */
export async function jikaiYokoku(o: YokokuOptions): Promise<JikaiYokoku> {
  const ctx = await loadPlanContext({ station: o.station, loader: o.loader, mode: 'yokoku' });
  const introduced = (id: string): boolean => Object.keys(store.cards.byItem(id)).length > 0;
  const dueSoon = (id: string): boolean => {
    const facets = store.cards.byItem(id);
    return Object.values(facets).some((t) => t !== undefined && t[0] <= o.today + 1);
  };
  const stories = ctx.stories.filter((s) => s.kind === 'story').sort((a, b) => (a.id < b.id ? -1 : 1));
  const candidates = stories.filter((s) => s.lines.some((l) => (l.tokenIds ?? []).some((id) => id !== null && !introduced(id))));
  const story = candidates[0] ?? stories[0] ?? ctx.stories[0];
  const out: JikaiYokoku = { words: [], milestone: milestoneLine(ctx, o.vista) };
  if (story) {
    const masked = pickMaskedLine(story, introduced, dueSoon);
    if (masked) out.sentence = { storyId: story.id, ja: masked.ja, kana: masked.kana, maskedToken: masked.maskedToken };
  }
  for (const id of nextScrollItems(ctx, 3)) {
    const kana = kanaOf(ctx.loader.get(id));
    if (kana) out.words.push({ itemId: id, kana });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Notes, Omikuji, ledger prompt                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export interface EndCardNotesInput {
  minutesToday: number;
  /** Error rates (0–1) of the most recent sessions, oldest first; only Arcade-feel sessions count toward the nudge. */
  recentErrorRates: number[];
  feel: Settings['feel'];
  /** Additive: the overtraining threshold in minutes (design 03 §5: 1.5 × the preset's expected max; default 60). */
  overtrainingAt?: number;
  /** Additive: the cramming cap was reached today. */
  crammingCap?: boolean;
  /** Additive: backlog-day numbers for the "waited without penalty" line. */
  backlog?: { shown: number; due: number };
}

export const NUDGE_ERROR_RATE = 0.4;
export const DEFAULT_OVERTRAINING_MINUTES = 60;

/** Lines under the tally, in order; empty when nothing applies. */
export function endCardNotes(o: EndCardNotesInput): string[] {
  const out: string[] = [];
  if (o.backlog && o.backlog.due > o.backlog.shown) out.push(fill(S.backlogWaiting, { n: o.backlog.due - o.backlog.shown }));
  if (o.minutesToday >= (o.overtrainingAt ?? DEFAULT_OVERTRAINING_MINUTES)) out.push(S.overtrainingLine);
  if (o.crammingCap) out.push(S.crammingLine);
  const last2 = o.recentErrorRates.slice(-2);
  if (o.feel === 'arcade' && last2.length === 2 && last2.every((r) => r > NUDGE_ERROR_RATE)) out.push(S.feelNudgeLine);
  return out;
}

/** The Omikuji cut: a deterministic proverb per (seed, day); it changes nothing (design 05 §13). */
export function omikuji(seed: string, day: EpochDay): string {
  return S.omikuji[hashSeed(seed, day, 'omikuji') % S.omikuji.length] as string;
}

/** The ledger prompt shows until an external entry exists for today. */
export function ledgerPromptDue(ledger: Ledger, today: EpochDay): boolean {
  return !ledger.entries.some((e) => e[0] === today && e[3] === 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ceremonies                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const CEREMONY_EVENTS = ['badge:earned', 'wallpaper:unlocked', 'wallpaper:revealed', 'stamp:earned', 'belt:promoted', 'level:up', 'quest:completed'] as const;
export type CeremonyName = (typeof CEREMONY_EVENTS)[number];
export type CeremonyEvent = { [K in CeremonyName]: { name: K; payload: Events[K] } }[CeremonyName];

/** Records B's reward events until `stop()`; the end card replays them in order. */
export function trackCeremonies(): { events: CeremonyEvent[]; stop(): void } {
  const events: CeremonyEvent[] = [];
  const offs = CEREMONY_EVENTS.map((name: EventName) =>
    bus.on(name, (payload) => {
      events.push({ name, payload } as CeremonyEvent);
    }),
  );
  return {
    events,
    stop() {
      for (const off of offs) off();
    },
  };
}
