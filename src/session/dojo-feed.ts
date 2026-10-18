/**
 * TSUZUKU — the Dojo feed (design 03 §3, §6–§8, §11–§12).
 *
 *  `dojoFeed()` is what the home screen shows: the forecast line
 *  ("42 reviews · 1 scroll · 1 episode · ~18 min") from `derived.forecastCounts`
 *  — the whole day's due count with the Shugyō's Scroll count and minutes, one
 *  basis, never the day's reviews priced at a Kumite's length — plus today's
 *  Scroll / episode availability, minutes per session size, the
 *  sentence of the day (`hash(seed, day)` over Brown items with examples), the
 *  next milestone, the welcome state, resume info (`loadSnapshot`: a snapshot
 *  with malformed card keys is never offered) — and, additively, the Three
 *  Kata, the flame, the Kage standing, the Nemesis callout, the Gatekeeper and
 *  Shinsa availability, the governor notes and the 次回予告 teaser — and
 *  `radioMinutes` (design 08 §4, §10.2): the minutes of pool sentences the
 *  learner can follow today at the live known set, for the Dojo's 茶屋ラジオ
 *  tile ("{n} min of material you can already follow"); `null` when no pool
 *  is on the road, so the tile keeps its link and drops the number.
 *
 *  `forecastCounts` has no plan context: it adds the Scroll block's minutes
 *  (5 Kumite / 10 Shugyō) and the belt's new-item budget whenever the budget
 *  is positive. The feed knows whether a Scroll exists today, so `gateForecast`
 *  takes those minutes and the new-item count off when nothing is left to
 *  teach (everything introduced, or a backlog day).
 */
import type { Belt } from '../content/types';
import type { ContentLoader } from '../content/loader';
import type { DojoFeed, JikaiYokoku } from '../shared/session-types';
import type { QuestId } from '../shared/catalog';
import { hashSeed } from '../shared/hash';
import type { EpochDay } from '../shared/store-types';
import { store } from '../store';
import { SHINSA_STATIONS, beltOfStation, forecastCounts, itemBeltOf, stationProgress, streakState, type FlameState, type ForecastCounts } from '../store/derived';
import { BELT_ORDER, poolMinutes, selectPool, type Scroll } from '../learn';
import { S, fill, plural } from './engine-strings';
import { isGrammar, isVocab, loadPlanContext, pickStories, poolRefs, scrollsForToday, withPools, type PlanContext } from './builder';
import { jikaiYokoku, milestoneLine, omikuji, type Omikuji } from './end-card';
import { gateAvailable } from './gatekeeper';
import { kageStanding, type KageStanding } from './kage';
import { duelsReady } from './nemesis';
import { loadSnapshot } from './snapshot';
import { shinsaEligibleAsync, type ShinsaEligibility } from './shinsa';
import { toPlain } from '../content/ruby';

export interface DojoFeedFull extends DojoFeed {
  due: number;
  /** New items the day's budget still allows. */
  newItems: number;
  scrolls: number;
  episodes: number;
  quests: { id: QuestId; done: boolean }[];
  flame: FlameState;
  streak: { current: number; totalDays: number };
  kage: KageStanding;
  nemesis: { count: number; itemIds: string[]; line: string | null };
  gate: { station: number; ready: boolean; cleared: boolean; introduced: number; green: number; total: number } | null;
  shinsa: { belt: Belt; eligibility: ShinsaEligibility } | null;
  backlog: boolean;
  backlogLine: string | null;
  crammingCap: boolean;
  overtraining: boolean;
  teaser?: JikaiYokoku;
  proverb: Omikuji;
  /**
   * Minutes of pool sentences the learner can follow today (design 08 §4:
   * i+0 at the live known set over the pools ≤ station, `poolMinutes`),
   * rounded; `null` when no pool is on the road (Stations 1–3, a build before
   * `content:assign` wrote pools). The Dojo's 茶屋ラジオ tile shows the number
   * when present and keeps its link either way.
   */
  radioMinutes: number | null;
}

export interface DojoFeedOptions {
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: skip the 次回予告 teaser (cheaper). */
  teaser?: boolean;
}

/** The Scroll block minutes `derived.forecastCounts` adds when the new-item budget is positive (design 03 §2.2–2.3). */
export const SCROLL_BLOCK_MINUTES = { kumite: 5, shugyo: 10 } as const;

/**
 * The forecast for today's actual plan: with no Scroll to teach, the new-item
 * count is 0 and the Scroll block minutes come off the Kumite / Shugyō
 * estimates (Kata has no Scroll block). With a Scroll, the forecast stands.
 */
export function gateForecast(fc: ForecastCounts, scrolls: number): Pick<ForecastCounts, 'newItems' | 'minutes'> {
  if (scrolls > 0 || fc.newItems === 0) return { newItems: fc.newItems, minutes: fc.minutes };
  return {
    newItems: 0,
    minutes: { kata: fc.minutes.kata, kumite: Math.max(0, fc.minutes.kumite - SCROLL_BLOCK_MINUTES.kumite), shugyo: Math.max(0, fc.minutes.shugyo - SCROLL_BLOCK_MINUTES.shugyo) },
  };
}

/** `42 reviews · 1 scroll · 1 episode · ~18 min` (design 03 §3). */
export function forecastLine(due: number, scrolls: number, episodes: number, minutes: number): string {
  if (due === 0 && scrolls === 0 && episodes === 0) return S.forecastRest;
  const parts = [plural(due, S.forecastReview, S.forecastReviews)];
  if (scrolls > 0) parts.push(plural(scrolls, S.forecastScroll, S.forecastScrolls));
  if (episodes > 0) parts.push(plural(episodes, S.forecastEpisode, S.forecastEpisodes));
  parts.push(fill(S.forecastMinutes, { n: Math.max(1, Math.round(minutes)) }));
  return parts.join(S.forecastJoin);
}

/** A sentence from a Brown item (Green when none), deterministic per (seed, day). */
export function sentenceOfDay(ctx: PlanContext, day: EpochDay = ctx.today): { ja: string; kana: string } | undefined {
  const brown = BELT_ORDER.indexOf('brown');
  const green = BELT_ORDER.indexOf('green');
  const items = [...ctx.vocabPool, ...ctx.grammarPool].filter((it) => it.examples.length > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  const ranked = items.map((it) => ({ it, rank: BELT_ORDER.indexOf(itemBeltOf(it.id)) }));
  let pool = ranked.filter((x) => x.rank >= brown);
  if (pool.length === 0) pool = ranked.filter((x) => x.rank >= green);
  if (pool.length === 0) return undefined;
  const pick = pool[hashSeed(ctx.seed, day, 'sentence-of-day') % pool.length]!.it;
  const ex = (isVocab(pick) || isGrammar(pick) ? pick.examples : [])[hashSeed(ctx.seed, day, 'sentence-example') % Math.max(1, pick.examples.length)];
  return ex ? { ja: ex.ja, kana: ex.kana } : undefined;
}

/**
 * Minutes of listening the learner can follow today (design 08 §4, §10.1):
 * `poolMinutes` of the i+0 selection over the pools ≤ station at the live
 * known set — the live count, never the allowlist figure; `null` without pools.
 */
export function radioMinutesFor(ctx: PlanContext): number | null {
  if ((ctx.pools?.length ?? 0) === 0) return null;
  return Math.round(poolMinutes(selectPool(poolRefs(ctx), ctx.known, store.cards, ctx.today, { mode: 'i+0' })));
}

/** Welcome state (design 03 §8). */
export function welcomeState(): DojoFeed['welcome'] {
  const p = store.progress.value;
  if (p.welcomeBackDue) return 'comeback';
  if (p.awayDays >= 7) return 'mountain';
  return 'none';
}

/** Resume info from the saved snapshot, when reps remain. */
export function resumeInfo(): { stepsLeft: number } | undefined {
  const snap = loadSnapshot();
  if (!snap) return undefined;
  const left = snap.plan.steps.length - snap.cursor;
  return left > 0 ? { stepsLeft: left } : undefined;
}

export async function dojoFeed(o: DojoFeedOptions = {}): Promise<DojoFeedFull> {
  const ctx = await withPools(await loadPlanContext({ loader: o.loader, mode: 'dojo' }));
  const today = ctx.today;
  const scrollsToday: Scroll[] = ctx.backlog ? [] : scrollsForToday(ctx, 4);
  const fc = gateForecast(forecastCounts(), scrollsToday.length);
  const episodes = pickStories(ctx, { kind: 'story' }).length > 0 ? 1 : 0;
  const due = ctx.showDue;
  const quests = store.quests.value;
  const questList = quests.day === today ? quests.ids.map((id) => ({ id, done: quests.done.includes(id) })) : [];
  const streak = store.streak.value;
  const kage = kageStanding(store.kage.value, today);
  const duels = duelsReady(today);
  const nemesisLine = duels.length === 0 ? null : plural(duels.length, S.nemesisCallout, S.nemesisCallouts);
  const bundle = ctx.bundle;
  const gate = bundle
    ? (() => {
        const a = gateAvailable(ctx.station, bundle, store.cards, today);
        return { station: ctx.station, ...a, cleared: stationProgress(ctx.station, bundle).cleared };
      })()
    : null;
  const belt = beltOfStation(ctx.station);
  const shinsa = belt !== 'white' && SHINSA_STATIONS.includes(ctx.station) && !store.progress.value.shinsaPassed.includes(belt) ? { belt, eligibility: await shinsaEligibleAsync(belt, ctx.loader) } : null;

  const feed: DojoFeedFull = {
    // One coherent basis: the day's due count, the Shugyō's Scroll count and the Shugyō minutes (design 03 §3 "whole day").
    forecastLine: forecastLine(due, scrollsToday.length, episodes, fc.minutes.shugyo),
    minutes: fc.minutes,
    nextMilestone: milestoneLine(ctx),
    welcome: welcomeState(),
    due,
    newItems: scrollsToday.length > 0 ? ctx.newAllowed : 0,
    scrolls: scrollsToday.length,
    episodes,
    quests: questList,
    flame: streakState(),
    streak: { current: streak.current, totalDays: streak.totalDays },
    kage,
    nemesis: { count: duels.length, itemIds: duels.map((d) => d.itemId), line: nemesisLine },
    gate,
    shinsa,
    backlog: ctx.backlog,
    backlogLine: ctx.backlog ? fill(S.backlogLine, { shown: ctx.showDue, due: ctx.dueTotal }) : null,
    crammingCap: ctx.crammingCap,
    overtraining: ctx.overtraining,
    proverb: omikuji(ctx.seed, today),
    radioMinutes: radioMinutesFor(ctx),
  };
  const sod = sentenceOfDay(ctx);
  if (sod) feed.sentenceOfDay = { ja: toPlain(sod.ja), kana: sod.kana };
  const resume = resumeInfo();
  if (resume) feed.resume = resume;
  if (o.teaser !== false) {
    try {
      feed.teaser = await jikaiYokoku({ station: ctx.station, today, loader: ctx.loader });
    } catch {
      /* the teaser is optional */
    }
  }
  return feed;
}
