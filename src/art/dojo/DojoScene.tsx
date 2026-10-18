/**
 * TSUZUKU — `<DojoScene/>` (design 06 §5; design 09 §7 A/C/H, §8): the home-screen
 * room composed from store state and the real local time.
 *
 *  room (room.ts)     belt → tatami, chosen kanji → scroll, level → lanterns,
 *                     badge categories → Mon shelf (real crests), latest goshuin,
 *                     Kage, the moon and the eaves ornament from the calendar,
 *                     seasonal tree by month
 *  hearth (flames.ts) the Tsuzuku Flame state from `store/derived streakState`
 *  bonsai (bonsai.ts) total training days; blooms at 100; pruned after a gap,
 *                     healing over the week back
 *  kotodama (flames)  one flame per Black-belt item (counts from the cards)
 *
 * The SVG is a string rebuilt only when a STRUCTURAL input changes (`sceneKey`
 * leaves out the hour and the flame state); the time of day, the lanterns and
 * the hearth are LIVE: attributes on the HTML wrapper `.dojo-scene__art`
 * (`data-phase`, `data-lanterns`, `data-hearth`) and classes the layout effect
 * writes into the injected DOM (`syncLive`: the two sky rects' fills, the
 * hearth's `dj-hf--<state>`, the lanterns' `--lit`), so an hour change or a
 * relight never swaps the string. Room first, flames after an idle slot.
 *
 * Since yesterday (§7 A beat 1,700): on the arrival (`arrival` prop, once a
 * day) the persisted `progress.sceneSeen` is diffed against today's durable
 * fields (`sinceYesterday`); each part that GREW gets one 900 ms glow pulse —
 * `<use>` twins through ONE shared filter def, scheduled so at most two carry
 * it at once — or, under reduced motion, a static 1 px gold ring for the visit;
 * the caption names the parts; `data-since` lists them; the scene then
 * persists `durableFieldsOf(inputs)` as the new `sceneSeen`. The ethical line
 * (§7 A, §8): the arrival never names a gap — a hearth that cooled, a bonsai
 * that was pruned, nothing lost is pulsed or captioned (the hotspot tips carry
 * the calm sentences); nothing here counts absent days; the never-lit hearth
 * says "Unlit".
 *
 * The hearth relights BY GROWING (§7 C): a freshly injected string carries
 * `dj-hf--unlit`; the live state is held there until the picture is final (the
 * flames' idle slot), then `syncLive` flushes style once and swaps the class,
 * so the tongues' `scale` transition (DojoScene.css, --spring) runs from 0 on
 * the real Rest → Dojo path, not only on a live flip. Reduced motion writes the
 * state at once (the durations are zero).
 *
 * Hotspots are real links (`href()`) over the picture: scroll → station,
 * bonsai and hearth → records, racks → collections. Colors are CSS tokens, so
 * the scene follows the page theme; motion respects `settings.reducedMotion`
 * and the OS preference; the Zen feel drops the glow.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { groupByItem, itemBelt, kindOfCards } from '@/learn';
import { STATIONS, type Belt, type CardKey, type Facet } from '../../content/types';
import type { BadgeId } from '../../shared/catalog';
import { hashSeed } from '../../shared/hash';
import { nextBoundaryMs } from '../../shared/koyomi';
import { href, type Route } from '../../shared/routes';
import type { CardTuple, Collections, EpochDay, Feel, ItemKind, SceneSeen, StampEntry } from '../../shared/store-types';
import { civilParts, weekOf } from '../../shared/time';
import { prefersReducedMotion } from '../../shared/ui/use-reveal';
import { BADGE_DEFS, awayStatus, store, type FlameState } from '../../store';
import { streakState } from '../../store/derived';
import { MON_CATEGORIES, MON_SPECS, type MonCategory } from '../mon';
import { svgDoc, url } from '../svg';
import { BLOOM_DAYS, bonsaiSvg, depthFor } from './bonsai';
import { HEARTH_STATES, HF, emptyCounts, flamesSvg, hearthStateOf, hearthSvg, type HearthState } from './flames';
import {
  ID,
  LANTERN_LIT,
  MON_SLOTS,
  PART_ID,
  lanternCount,
  lanternsLit,
  roomSvg,
  skyId,
  skyPhase,
  tok,
  type CrestSpec,
  type OrnamentId,
  type RoomLayout,
  type ScenePart,
  type Season,
  type SkyPhase,
} from './room';
import { BELT_NAME, S, fill } from './strings';
import './DojoScene.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const SCENE_SIZE = { full: { w: 960, h: 540 }, compact: { w: 960, h: 400 } } as const;
/** Kotodama rendered in the scene (node budget ≤ 420, design 09 §10 — held with every reduced-motion ring drawn on the richest save); the counter shows the true total. */
export const KOTODAMA_MAX = { full: 105, compact: 75 } as const;
/** The whole scene's SVG node ceiling (design 09 §10 budgets table). */
export const SCENE_NODE_BUDGET = 420;
/** Away days after which the bonsai looks pruned (design 03 §8 "Back from the Mountain"). */
export const PRUNED_AWAY_DAYS = 7;
/** Days back over which a pruned bonsai heals to the full tree (design 09 §8). */
export const HEALING_DAYS = 7;
/** One since-yesterday pulse (mirrors --dur-4) and the stagger that keeps two twins live at most. */
export const PULSE_MS = 900;
export const PULSE_STAGGER_MS = 450;
/** When the first pulse lands after the picture is up: §7 A's beat 1,700 against the Dojo's mount at beat 900. */
export const PULSE_START_MS = 800;

const PHASE_TEXT: Record<SkyPhase, string> = { dawn: S.phaseDawn, day: S.phaseDay, dusk: S.phaseDusk, night: S.phaseNight };
const SEASON_TEXT: Record<Season, string> = { spring: S.seasonSpring, summer: S.seasonSummer, autumn: S.seasonAutumn, winter: S.seasonWinter };
const HEARTH_TEXT: Record<HearthState, string> = { unlit: S.hearthUnlit, ember: S.hearthEmber, steady: S.hearthSteady, roaring: S.hearthRoaring };
export const ORNAMENT_TEXT: Record<OrnamentId, { ja: string; reading: string; en: string }> = {
  tanabata: { ja: S.ornamentTanabataJa, reading: S.ornamentTanabataReading, en: S.ornamentTanabataEn },
  koinobori: { ja: S.ornamentKoinoboriJa, reading: S.ornamentKoinoboriReading, en: S.ornamentKoinoboriEn },
  yuki: { ja: S.ornamentYukiJa, reading: S.ornamentYukiReading, en: S.ornamentYukiEn },
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const NO_PARTS: readonly ScenePart[] = [];

/* ────────────────────────────────────────────────────────────────────────── */
/* Inputs from the store                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Everything the picture is built from. Assignable to the structural `SceneSeen` (store-types). */
export interface SceneInputs extends SceneSeen {
  w: number;
  h: number;
  belt: Belt;
  level: number;
  dan: number;
  chosenKanji?: string;
  badgeCategories: number;
  /** One earned crest per category, shelf order. */
  crests: CrestSpec[];
  latestStamp?: string;
  kageBeaten: boolean;
  /** LIVE: leaves the scene key (the phase is a wrapper attribute). */
  hour: number;
  month: number;
  seed: string;
  today: EpochDay;
  totalDays: number;
  streak: number;
  blooming: boolean;
  pruned: boolean;
  /** 0 → 1 over the week back while pruned. */
  healing: number;
  counts: Record<ItemKind, number>;
  reducedMotion: boolean;
  feel: Feel;
  /** LIVE: leaves the scene key (the hearth flips by class). */
  flame: FlameState;
  station: number;
  flamesMax: number;
}

interface CardWalk {
  forEach(fn: (k: CardKey, t: CardTuple) => void): void;
}

/** Black-belt items per kind (`learn/item-belt`): the kotodama counts. */
export function blackCounts(cards: CardWalk): Record<ItemKind, number> {
  const out = emptyCounts();
  for (const [itemId, facets] of groupByItem(cards)) {
    const kind = kindOfCards(itemId, Object.keys(facets) as Facet[]);
    if (!kind) continue;
    if (itemBelt(kind, facets) === 'black') out[kind]++;
  }
  return out;
}

const CATEGORY_OF: ReadonlyMap<string, string> = new Map(BADGE_DEFS.map((d) => [d.id, d.category] as const));

/** Distinct badge categories with at least one earned Mon (one shelf slot each). */
export function badgeCategoryCount(badges: Collections['badges']): number {
  const seen = new Set<string>();
  for (const id of Object.keys(badges) as BadgeId[]) {
    const c = CATEGORY_OF.get(id);
    if (c && badges[id] !== undefined) seen.add(c);
  }
  return seen.size;
}

/** The earliest-earned crest of each earned category, in `MON_CATEGORIES` order: the shelf's real crests. */
export function crestsFor(badges: Collections['badges']): CrestSpec[] {
  const first = new Map<MonCategory, { id: BadgeId; at: number }>();
  for (const id of Object.keys(badges) as BadgeId[]) {
    const at = badges[id];
    const c = CATEGORY_OF.get(id) as MonCategory | undefined;
    if (at === undefined || !c) continue;
    const prev = first.get(c);
    if (!prev || at < prev.at || (at === prev.at && id < prev.id)) first.set(c, { id, at });
  }
  const out: CrestSpec[] = [];
  for (const c of MON_CATEGORIES) {
    const hit = first.get(c);
    if (!hit) continue;
    const spec = MON_SPECS[hit.id];
    if (spec) out.push({ ring: spec.ring, field: spec.field, glyph: spec.glyph, accent: spec.accent });
  }
  return out;
}

/** Japanese name of the most recent goshuin (latest day; ties → the farther station). */
export function latestStampName(stamps: Record<number, StampEntry>): string | undefined {
  let bestN = -1;
  let bestAt = -Infinity;
  for (const [k, e] of Object.entries(stamps)) {
    const n = Number(k);
    if (!Number.isFinite(n) || !e) continue;
    if (e.at > bestAt || (e.at === bestAt && n > bestN)) {
      bestAt = e.at;
      bestN = n;
    }
  }
  if (bestN < 0) return undefined;
  return STATIONS.find((s) => s.number === bestN)?.nameJa;
}

function localParts(now: number, tz: string): { hour: number; month: number } {
  try {
    const p = civilParts(now, tz);
    return { hour: p.hour, month: p.month };
  } catch {
    const p = civilParts(now);
    return { hour: p.hour, month: p.month };
  }
}

/** Reads every signal the scene depends on (subscribes the caller when used in render). */
export function sceneInputs(o: { compact?: boolean } = {}): SceneInputs {
  const profile = store.profile.value;
  const streak = store.streak.value;
  const progress = store.progress.value;
  const collections = store.collections.value;
  const kage = store.kage.value;
  const settings = store.settings.value;
  const daily = store.daily.value;
  // subscribe to card writes; the counts are derived below
  store.cards.version.value;
  const now = store.now();
  const today = store.today();
  const { hour, month } = localParts(now, profile.tz);
  const size = o.compact ? SCENE_SIZE.compact : SCENE_SIZE.full;
  const pruned = progress.awayDays >= PRUNED_AWAY_DAYS;
  const healing = pruned ? Math.min(1, Math.max(0, awayStatus(daily, today).returnedDaysAgo / HEALING_DAYS)) : 1;
  return {
    w: size.w,
    h: size.h,
    belt: profile.belt,
    level: profile.level,
    dan: profile.dan,
    chosenKanji: profile.chosenKanji,
    badgeCategories: badgeCategoryCount(collections.badges),
    crests: crestsFor(collections.badges),
    latestStamp: latestStampName(collections.stamps),
    kageBeaten: kage.beatenWeek !== undefined && kage.beatenWeek === weekOf(today),
    hour,
    month,
    seed: store.seed(),
    today,
    totalDays: streak.totalDays,
    streak: streak.current,
    blooming: streak.totalDays >= BLOOM_DAYS,
    pruned,
    healing,
    counts: blackCounts(store.cards),
    reducedMotion: Boolean(settings.reducedMotion),
    feel: settings.feel,
    flame: streakState(),
    station: progress.station,
    flamesMax: o.compact ? KOTODAMA_MAX.compact : KOTODAMA_MAX.full,
  };
}

/** Stable key of the STRUCTURAL inputs (the memo key): the hour and the flame are live attributes, not part of the string. */
export function sceneKey(i: SceneInputs): string {
  const rest: Partial<SceneInputs> = { ...i };
  delete rest.hour;
  delete rest.flame;
  return JSON.stringify(rest);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Since yesterday (design 09 §7 A, §8)                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** The durable fields of the picture — exactly `SceneSeen` (§12.1 decision 17) — persisted as `progress.sceneSeen`. */
export function durableFieldsOf(i: SceneInputs): SceneSeen {
  const out: SceneSeen = {
    belt: i.belt,
    level: i.level,
    dan: i.dan,
    badgeCategories: i.badgeCategories,
    kageBeaten: i.kageBeaten,
    totalDays: i.totalDays,
    streak: i.streak,
    blooming: i.blooming,
    pruned: i.pruned,
    counts: { ...i.counts },
    station: i.station,
    flame: i.flame,
  };
  if (i.chosenKanji !== undefined) out.chosenKanji = i.chosenKanji;
  if (i.latestStamp !== undefined) out.latestStamp = i.latestStamp;
  return out;
}

const FLAMES: ReadonlySet<string> = new Set<FlameState>(['lit', 'gold', 'ember', 'frozen', 'rest', 'broken']);
const hearthOf = (flame: string | undefined): HearthState | null => (flame !== undefined && FLAMES.has(flame) ? hearthStateOf(flame as FlameState).state : null);
/** The hearth only ever pulses when it climbs this ladder (design 09 §7 A: no different music for a cold hearth). */
export const HEARTH_RANK: Record<HearthState, number> = { unlit: 0, ember: 1, steady: 2, roaring: 3 };

/**
 * Which parts of the picture GREW since the save was last seen, in a fixed
 * order: a lantern added, the bonsai deeper / in bloom / healed from pruned, a
 * new goshuin or crest, the hearth climbing (never cooling), a new belt or dan,
 * a kanji on the scroll, the Kage sitting or leaving (§8 the week), the road
 * moved on. A loss — a cooled hearth, a pruned bonsai — is never emitted: the
 * arrival never names a gap, and nothing here counts absent days. No `seen`
 * (first visit) → nothing to pulse.
 */
export function sinceYesterday(seen: SceneSeen | undefined, now: SceneSeen): ScenePart[] {
  if (!seen) return [];
  const out: ScenePart[] = [];
  if (lanternCount(now.level) > lanternCount(seen.level)) out.push('lantern');
  if (depthFor(now.totalDays) > depthFor(seen.totalDays) || (now.blooming && !seen.blooming) || (seen.pruned && !now.pruned)) out.push('bonsai');
  if (now.latestStamp !== undefined && now.latestStamp !== seen.latestStamp) out.push('stamp');
  if (now.badgeCategories > seen.badgeCategories) out.push('mon');
  const h0 = hearthOf(seen.flame);
  const h1 = hearthOf(now.flame);
  if (h0 !== null && h1 !== null && HEARTH_RANK[h1] > HEARTH_RANK[h0]) out.push('hearth');
  if (now.belt !== seen.belt || now.dan > seen.dan) out.push('belt');
  if (now.chosenKanji !== undefined && now.chosenKanji !== seen.chosenKanji) out.push('scroll');
  if (now.kageBeaten !== seen.kageBeaten) out.push('kage');
  if (now.station > seen.station) out.push('station');
  return out;
}

/** "Since yesterday: …" — one clause per changed part, from `strings.ts`. */
export function sinceCaption(parts: readonly ScenePart[], seen: SceneSeen | undefined, now: SceneSeen): string {
  const clauses = parts.map((p) => {
    switch (p) {
      case 'lantern':
        return S.sinceLantern;
      case 'bonsai':
        // only growth reaches here (a pruning is never captioned on the arrival; the hotspot tip says it, §8)
        return now.blooming && !seen?.blooming ? S.bonsaiBlooming : S.sinceBonsai;
      case 'stamp':
        return S.sinceStamp;
      case 'mon':
        return S.sinceMon;
      case 'hearth':
        return HEARTH_TEXT[hearthOf(now.flame) ?? 'unlit'];
      case 'belt':
        return S.sinceBelt;
      case 'scroll':
        return S.sinceScroll;
      case 'kage':
        return now.kageBeaten ? S.kageSitting : S.kageLeft;
      case 'station':
        return S.sinceStation;
    }
  });
  return `${S.sinceYesterday} ${clauses.join(S.sinceJoin)}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Composition (pure)                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BuiltScene {
  svg: string;
  rendered: number;
  total: number;
  season: Season;
  ornament: OrnamentId | null;
  layout: RoomLayout;
}

export interface BuildExtras {
  /** The Kage sat here yesterday and leaves today (drawn once more with the leaving class). */
  kageLeaving?: boolean;
  /** Reduced motion: parts drawn with the static 1 px gold ring. */
  rings?: readonly ScenePart[];
}

export function buildScene(i: SceneInputs, withFlames: boolean, x: BuildExtras = {}): BuiltScene {
  const seed = hashSeed(i.seed, 'dojo');
  const room = roomSvg({
    belt: i.belt,
    level: i.level,
    dan: i.dan,
    chosenKanji: i.chosenKanji,
    badgeCategories: i.badgeCategories,
    crests: i.crests,
    latestStamp: i.latestStamp,
    kageBeaten: i.kageBeaten,
    kageLeaving: x.kageLeaving,
    month: i.month,
    today: i.today,
    seed,
    w: i.w,
    h: i.h,
    slots: MON_SLOTS,
    rings: x.rings,
  });
  const L = room.layout;
  const glow = i.feel !== 'zen';
  const hearth = hearthSvg({ seed, x: L.hearth.x, y: L.hearth.y, w: L.hearth.w, h: L.hearth.h, reducedMotion: i.reducedMotion, glow, id: PART_ID.hearth });
  const bonsai = bonsaiSvg({
    totalDays: i.totalDays,
    blooming: i.blooming,
    seed: hashSeed(seed, 'bonsai'),
    x: L.bonsai.x,
    y: L.bonsai.y,
    scale: L.bonsai.scale,
    season: room.season,
    streak: i.streak,
    pruned: i.pruned,
    healing: i.healing,
    id: PART_ID.bonsai,
  });
  let total = 0;
  for (const n of Object.values(i.counts)) total += Math.max(0, Math.floor(n));
  const flames = withFlames
    ? flamesSvg({
        counts: i.counts,
        seed: hashSeed(seed, 'kotodama', i.today),
        x: L.hall.x,
        y: L.hall.y,
        w: L.hall.w,
        h: L.hall.h,
        reducedMotion: i.reducedMotion,
        max: i.flamesMax,
        glow,
      })
    : null;
  const overlay = room.layers[room.overlayIndex] ?? '';
  const body = [...room.layers.slice(0, room.overlayIndex), bonsai, overlay, hearth, flames?.svg ?? ''];
  const svg = svgDoc({
    w: i.w,
    h: i.h,
    defs: room.defs,
    body,
    preserveAspectRatio: 'xMidYMid meet',
    attrs: { class: 'dojo-scene__svg', 'aria-hidden': 'true', focusable: 'false', 'data-season': room.season },
  });
  return { svg, rendered: flames?.rendered ?? 0, total, season: room.season, ornament: room.ornament, layout: L };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Live state → the injected DOM (never the string)                           */
/* ────────────────────────────────────────────────────────────────────────── */

export interface LiveState {
  phase: SkyPhase;
  lit: boolean;
  hearth: HearthState;
  crystal: boolean;
}

/**
 * Writes the time of day, the lanterns and the hearth into the injected SVG:
 * sky --a takes the phase's gradient; on a phase change sky --b takes the
 * previous one and fades out (`room__sky--fade`, --dur-4); the hearth group
 * swaps its `dj-hf--<state>` class — after one forced style flush, so a string
 * injected in this same task has a computed `scale: 1 0` to transition FROM
 * (§7 C "relights by growing"; without the flush a fresh DOM would jump); the
 * lanterns take `--lit` and the lit paper fill.
 */
export function syncLive(root: ParentNode | null, live: LiveState, prevPhase: SkyPhase | null): void {
  if (!root) return;
  root.querySelector('.room__sky--a')?.setAttribute('fill', url(skyId(live.phase)));
  const skyB = root.querySelector('.room__sky--b');
  if (skyB && prevPhase && prevPhase !== live.phase) {
    skyB.setAttribute('fill', url(skyId(prevPhase)));
    skyB.classList.remove('room__sky--fade');
    void skyB.getBoundingClientRect(); // restart the fade
    skyB.classList.add('room__sky--fade');
  }
  const hf = root.querySelector(`.${HF}`);
  if (hf) {
    const shown = HEARTH_STATES.find((s) => hf.classList.contains(`${HF}--${s}`));
    if (shown !== live.hearth) {
      void hf.getBoundingClientRect(); // the tongues' current scale becomes the transition's start value
      for (const s of HEARTH_STATES) hf.classList.remove(`${HF}--${s}`);
      hf.classList.add(`${HF}--${live.hearth}`);
    }
    hf.classList.toggle(`${HF}--crystal`, live.crystal);
  }
  for (const l of Array.from(root.querySelectorAll('.room__lantern'))) l.classList.toggle('room__lantern--lit', live.lit);
  root.querySelector('.room__lanterns')?.classList.toggle('room__lanterns--lit', live.lit);
  for (const b of Array.from(root.querySelectorAll('.room__lantern-body'))) b.setAttribute('fill', live.lit ? LANTERN_LIT : tok('surface'));
}

/**
 * The since-yesterday pulse: one `<use>` twin per changed part through the shared
 * `#dj-pulse` def, each live for `PULSE_MS`, started `PULSE_STAGGER_MS` apart —
 * so at most two filtered elements exist at any instant (design 09 §6.7 rule 2).
 * Returns the cancel (clears timers, removes twins).
 */
export function schedulePulses(svg: SVGSVGElement | null, parts: readonly ScenePart[], o: { delay?: number; onDone?: () => void } = {}): () => void {
  const ids = Array.from(new Set(parts.map((p) => PART_ID[p])));
  if (!svg || ids.length === 0) {
    o.onDone?.();
    return () => undefined;
  }
  const timers: ReturnType<typeof setTimeout>[] = [];
  const live = new Set<Element>();
  const delay = Math.max(0, o.delay ?? 0);
  ids.forEach((id, i) => {
    timers.push(
      setTimeout(() => {
        if (!svg.isConnected || !svg.querySelector(`#${id}`)) return;
        const u = document.createElementNS(SVG_NS, 'use');
        u.setAttribute('href', `#${id}`);
        u.setAttribute('class', 'room__pulse');
        u.setAttribute('filter', url(ID.pulse));
        u.setAttribute('pointer-events', 'none');
        u.setAttribute('data-pulse', id);
        svg.appendChild(u);
        live.add(u);
        timers.push(
          setTimeout(() => {
            u.remove();
            live.delete(u);
          }, PULSE_MS),
        );
      }, delay + i * PULSE_STAGGER_MS),
    );
  });
  timers.push(setTimeout(() => o.onDone?.(), delay + (ids.length - 1) * PULSE_STAGGER_MS + PULSE_MS));
  return () => {
    for (const t of timers) clearTimeout(t);
    for (const u of live) u.remove();
    live.clear();
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hotspots                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Hotspot {
  id: 'scroll' | 'bonsai' | 'rack' | 'shelf' | 'stamps' | 'hearth';
  route: Route;
  label: string;
  tip: string;
  /** Percent of the stage. */
  left: number;
  top: number;
  width: number;
  height: number;
}

function pct(v: number, of: number): number {
  return Math.round((v / Math.max(1, of)) * 10000) / 100;
}

const joinLabel = (...parts: (string | null | undefined)[]): string => parts.filter((p): p is string => Boolean(p)).join(' ');

export function hotspotsFor(i: SceneInputs, b: BuiltScene): Hotspot[] {
  const L = b.layout;
  const box = (id: Hotspot['id'], r: { x: number; y: number; w: number; h: number }, route: Route, label: string, tip: string): Hotspot => ({
    id,
    route,
    label,
    tip,
    left: pct(r.x, L.w),
    top: pct(r.y, L.h),
    width: pct(r.w, L.w),
    height: pct(r.h, L.h),
  });
  const stationDef = STATIONS.find((s) => s.number === i.station);
  const scrollRoute: Route = stationDef ? { name: 'station', n: stationDef.number } : { name: 'road' };
  const scrollLabel = joinLabel(stationDef ? fill(S.hotspotScroll, { n: stationDef.number, name: stationDef.nameJa }) : S.hotspotScrollRoad, i.chosenKanji ? null : S.scrollEmpty);
  const bonsaiBox = { x: L.bonsai.x - 60 * L.sx, y: L.bonsai.y - 150 * L.sy, w: 120 * L.sx, h: 150 * L.sy };
  const bonsaiLabel = joinLabel(fill(S.hotspotBonsai, { days: i.totalDays }), i.pruned ? S.bonsaiPruned : i.blooming ? S.bonsaiBlooming : null);
  const { state, crystal } = hearthStateOf(i.flame);
  const hearthText = joinLabel(i.totalDays === 0 ? S.hearthNeverLit : HEARTH_TEXT[state], crystal ? S.hearthCrystal : null);
  return [
    box('scroll', L.scroll, scrollRoute, scrollLabel, S.tipScroll),
    box('bonsai', bonsaiBox, { name: 'records' }, bonsaiLabel, S.tipBonsai),
    box('rack', L.rack, { name: 'collections', tab: 'kakejiku' }, fill(S.hotspotRack, { belt: BELT_NAME[i.belt] }), S.tipRack),
    box('shelf', L.shelf, { name: 'collections', tab: 'mon' }, fill(S.hotspotShelf, { n: Math.min(i.badgeCategories, MON_SLOTS), total: MON_SLOTS }), S.tipShelf),
    box('stamps', L.stamps, { name: 'collections', tab: 'goshuin' }, joinLabel(S.hotspotStamps, i.latestStamp ? null : S.stampsEmpty), S.tipStamps),
    box('hearth', L.hearth, { name: 'records' }, fill(S.hotspotHearth, { state: hearthText }), S.tipHearth),
  ];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Idle scheduling                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

interface IdleGlobal {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

/** Runs `fn` in an idle slot (or next tick); returns the cancel. */
export function afterIdle(fn: () => void): () => void {
  const gl = globalThis as unknown as IdleGlobal;
  if (typeof gl.requestIdleCallback === 'function') {
    const id = gl.requestIdleCallback(fn, { timeout: 800 });
    return () => gl.cancelIdleCallback?.(id);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}

function boundaryMs(): number {
  const now = store.now();
  try {
    return nextBoundaryMs(now, store.profile.peek().tz);
  } catch {
    return nextBoundaryMs(now);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DojoSceneProps {
  /** Shorter stage (960 × 400) for narrow layouts. */
  compact?: boolean;
  /** The daily arrival (design 09 §7 A): diff and pulse since yesterday, then persist `sceneSeen`. */
  arrival?: boolean;
}

export function DojoScene(p: DojoSceneProps = {}): JSX.Element {
  const compact = Boolean(p.compact);
  const inputs = sceneInputs({ compact });
  const key = sceneKey(inputs);
  const phase = skyPhase(inputs.hour);
  const lit = lanternsLit(phase);
  const { state: hearth, crystal } = hearthStateOf(inputs.flame);
  const reduced = inputs.reducedMotion || prefersReducedMotion();
  const [flamesReady, setFlamesReady] = useState(false);
  useEffect(() => afterIdle(() => setFlamesReady(true)), []);

  // since yesterday: diffed ONCE per mount, on the arrival, against the picture as last seen
  const [seen] = useState<SceneSeen | undefined>(() => store.progress.peek().sceneSeen);
  const [since] = useState<ScenePart[]>(() => (p.arrival ? sinceYesterday(seen, durableFieldsOf(inputs)) : []));
  const kageLeaving = since.includes('kage') && !inputs.kageBeaten;
  const rings = reduced ? since : NO_PARTS;

  // `key` stands for every structural input: the SVG string is rebuilt only when one changes.
  const built = useMemo(() => buildScene(inputs, flamesReady, { kageLeaving, rings }), [key, flamesReady, kageLeaving, rings]);
  const hotspots = useMemo(() => hotspotsFor(inputs, built), [built, inputs.flame]);

  // live state into the injected DOM, before paint. The hearth is HELD unlit until the picture is final
  // (the flames' idle slot re-injects the string), then grows once (§7 C); reduced motion writes it at once.
  const artRef = useRef<HTMLDivElement>(null);
  const prevPhase = useRef<SkyPhase | null>(null);
  const hearthHeld = !reduced && !flamesReady && hearth !== 'unlit';
  useLayoutEffect(() => {
    syncLive(artRef.current, { phase, lit, hearth: hearthHeld ? 'unlit' : hearth, crystal }, prevPhase.current);
    prevPhase.current = phase;
  }, [built.svg, phase, lit, hearth, crystal, hearthHeld]);

  // the arrival persists the picture as seen (once a day; DojoPage writes `arrivedDay`)
  useEffect(() => {
    if (!p.arrival) return;
    const now = durableFieldsOf(inputs);
    store.patch('progress', (pr) => ({ ...pr, sceneSeen: now }));
  }, []);

  // the pulse: once, after the flames landed, full motion only; reduced motion drew the rings instead
  const [pulsing, setPulsing] = useState(false);
  const pulsed = useRef(false);
  const mountedAt = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  useEffect(() => {
    if (pulsed.current || !flamesReady || reduced || since.length === 0) return;
    pulsed.current = true;
    const svg = artRef.current?.querySelector('svg') ?? null;
    const elapsed = typeof performance !== 'undefined' ? performance.now() - mountedAt.current : PULSE_START_MS;
    setPulsing(true);
    return schedulePulses(svg, since, { delay: PULSE_START_MS - elapsed, onDone: () => setPulsing(false) });
  }, [flamesReady]);

  // the sky shifts live at 05 / 08 / 17 / 20 h and the 04:00 roll while the tab stays open (design 09 §8)
  const [, bump] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => bump((n) => n + 1), boundaryMs());
    return () => clearTimeout(t);
  }, [phase, inputs.today]);

  const label = fill(S.sceneLabel, {
    belt: BELT_NAME[inputs.belt],
    days: inputs.totalDays,
    phase: PHASE_TEXT[phase],
    season: SEASON_TEXT[built.season],
  });
  const partial = built.rendered > 0 && built.rendered < built.total;
  const sinceText = since.length > 0 ? sinceCaption(since, seen, durableFieldsOf(inputs)) : null;
  const ornament = built.ornament ? ORNAMENT_TEXT[built.ornament] : null;

  return (
    <div class={`dojo-scene${compact ? ' dojo-scene--compact' : ''}`} data-season={built.season} data-flames={flamesReady ? 'ready' : 'pending'}>
      <div class="dojo-scene__stage">
        <div
          ref={artRef}
          class="dojo-scene__art"
          role="img"
          aria-label={label}
          data-phase={phase}
          data-lanterns={lit ? 'lit' : 'unlit'}
          data-hearth={hearth}
          data-hearth-held={hearthHeld ? '' : undefined}
          data-since={since.length > 0 ? since.join(' ') : undefined}
          data-pulsing={pulsing ? '' : undefined}
          dangerouslySetInnerHTML={{ __html: built.svg }}
        />
        <ul class="dojo-scene__hotspots" aria-label={S.hotspotsLabel}>
          {hotspots.map((h) => (
            <li key={h.id}>
              <a
                class={`dojo-scene__hotspot dojo-scene__hotspot--${h.id}`}
                href={href(h.route)}
                aria-label={h.label}
                title={h.label}
                data-hotspot={h.id}
                style={{ left: `${h.left}%`, top: `${h.top}%`, width: `${h.width}%`, height: `${h.height}%` }}
              >
                <span class="dojo-scene__tip" aria-hidden="true">
                  {h.tip}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {sinceText ? (
        <p class="dojo-scene__since" data-since={since.join(' ')}>
          {sinceText}
        </p>
      ) : null}
      <p class="dojo-scene__caption" data-total={built.total} data-rendered={built.rendered}>
        <span lang="ja">{S.kotodamaJa}</span>
        <span>{built.total > 0 ? fill(S.kotodamaCount, { total: built.total }) : S.kotodamaNone}</span>
        {partial ? <span class="dojo-scene__muted">{fill(S.kotodamaShown, { rendered: built.rendered, total: built.total })}</span> : null}
        {ornament && built.ornament ? (
          <span class="dojo-scene__ornament" data-ornament={built.ornament}>
            <span lang="ja">{ornament.ja}</span> {ornament.reading}
            {S.sinceJoin}
            {ornament.en}
          </span>
        ) : null}
      </p>
    </div>
  );
}
