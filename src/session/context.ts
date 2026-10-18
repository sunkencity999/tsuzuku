/**
 * TSUZUKU — plan context (design 03 §2, §5; 07 §6/§9).
 *
 * `loadPlanContext` loads what a plan needs and evaluates the governor. Split
 * out of `builder.ts` (which re-exports it) so each file stays readable.
 *
 *  - The current station is preloaded, the next prefetched on idle, and only
 *    the cards a plan can draw (the due queue to `showDue` + a reserve,
 *    rechecks, Weak Point sets, Nemesis items) have their files fetched; the
 *    Dojo (`mode: 'dojo'`) loads none of them.
 *  - The PREVIOUS station's story file is loaded too (one small file), so
 *    `ctx.stories` holds the readable episodes of the station just finished
 *    while the current station's texts are still being learned (the Input
 *    block, Kumite role-play and the Dojo's "1 episode" draw from it).
 *  - `allowlist`: for Stations 1–3 the shared White allowlist (every item id
 *    of bundles 1–3), the set CONTENT_GUIDE §14.2 / V20 lets those stories
 *    use freely; `storyCoverage` counts it as covered. Empty elsewhere.
 *  - The new-item budget follows the belt table unless the preset is custom
 *    (`effectiveNewPerDay`), and `introducedToday` counts from the review log
 *    so the cramming cap survives the +3 / +10 graduations.
 */
import type { Belt, ComponentDef, DrillId, ErrorTag, GrammarItem, KanaItem, KanjiItem, ListeningPool, StationBundle, StoryItem, VocabItem } from '../content/types';
import { content as appContent, type ContentLoader } from '../content/loader';
import { isRegistered } from '../shared/exercise-types';
import { hashSeed, rngFor, type Rng } from '../shared/hash';
import { parseCardKey } from '../shared/ids';
import { CardFlag, hasFlag, type EpochDay, type SaveMeta, type Settings } from '../shared/store-types';
import { store } from '../store';
import { beltOfStation } from '../store/derived';
import { EXPECTED_MAX_MINUTES, capFor, dueCards, governor, kaidenQuota, knownSet, recheckCards, weakPointSet } from '../learn';
import { nemesisItems } from './nemesis';
import { isGrammar, isKana, isKanji, isStory, isVocab } from './params';
import { DUE_LOAD_RESERVE, accuracy7, effectiveNewPerDay, introducedToday } from './pickers';

/** Stations whose stories share one allowlist (CONTENT_GUIDE §14.2, V20). */
export const SHARED_ALLOWLIST_TO = 3;

export interface PlanContext {
  loader: ContentLoader;
  today: EpochDay;
  now: number;
  seed: string;
  station: number;
  /** Curriculum belt of `station`. */
  belt: Belt;
  settings: Settings;
  medianMs: SaveMeta['medianMs'];
  bundle: StationBundle | null;
  /** Loaded bundles ≤ station (current included), ascending. */
  bundles: StationBundle[];
  /** Bundle of station + 1 when it exists (Michikusa pool). */
  nextBundle: StationBundle | null;
  components: Map<string, ComponentDef>;
  stories: StoryItem[];
  vocabPool: VocabItem[];
  kanjiPool: KanjiItem[];
  grammarPool: GrammarItem[];
  kanaPool: KanaItem[];
  known: Set<string>;
  /** Item ids story coverage counts as covered besides `known`: the shared White allowlist at Stations 1–3, else empty. */
  allowlist: ReadonlySet<string>;
  /**
   * Listening pools of stations ≤ `station`, ascending by station (design 08
   * §4), set by `params.withPools()`; absent or empty before it ran and on a
   * build without pool files, when every consumer keeps its pre-pool behaviour.
   */
  pools?: readonly ListeningPool[];
  rng: Rng;
  available: (id: DrillId) => boolean;
  /** Governor outcome for today. */
  cap: number;
  dueTotal: number;
  backlog: boolean;
  showDue: number;
  newTarget: number;
  newAllowed: number;
  crammingCap: boolean;
  overtraining: boolean;
  /** Step id counter. */
  seq: number;
  planKey: string;
}

export interface PlanOptions {
  station?: number;
  tag?: ErrorTag;
  scrollId?: string;
  seed?: number;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the exercise registry). */
  available?: (id: DrillId) => boolean;
}

export async function tryStation(loader: ContentLoader, n: number): Promise<StationBundle | null> {
  if (n < 1 || n > 53) return null;
  try {
    return await loader.station(n);
  } catch {
    return null;
  }
}

function bundleIds(b: StationBundle): string[] {
  return [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.kanaIds, ...b.componentIds];
}

/** Loads what a plan needs and evaluates the governor. */
export async function loadPlanContext(o: PlanOptions & { mode?: string } = {}): Promise<PlanContext> {
  const loader = o.loader ?? appContent;
  const today = store.today();
  const progress = store.progress.value;
  const settings = store.settings.value;
  const station = Math.max(1, Math.min(53, o.station ?? Math.max(1, progress.station)));
  const belt = beltOfStation(station);

  const bundle = await tryStation(loader, station);
  if (bundle) {
    try {
      await loader.preloadStation(station);
    } catch {
      /* the bundle's files failed; whatever is in memory is used */
    }
    // The next station warms on idle (design 07 §6); the loader dedupes and swallows errors.
    if (station < 53) loader.prefetchStation(station + 1);
  }
  const prev = station > 1 ? await tryStation(loader, station - 1) : null;
  if (prev) {
    // The previous station's episodes are what a learner mid-station can read (one small stories file).
    try {
      await loader.load(prev.storyIds.filter((id) => loader.get(id) === undefined));
    } catch {
      /* offline: the Input block falls back to whatever is in memory */
    }
  }
  const nextBundle = await tryStation(loader, station + 1);
  const bundles = [prev, bundle].filter((b): b is StationBundle => b !== null);
  // Stations 1–3 write their stories against one shared allowlist (V20); the bundles are tiny, the items are not loaded.
  const allowlist = new Set<string>();
  if (station <= SHARED_ALLOWLIST_TO) {
    for (let n = 1; n <= SHARED_ALLOWLIST_TO; n++) {
      const b = bundles.find((x) => x.number === n) ?? (await tryStation(loader, n));
      if (b) for (const id of bundleIds(b)) allowlist.add(id);
    }
  }
  let components = new Map<string, ComponentDef>();
  try {
    components = await loader.components();
  } catch {
    /* no components file yet */
  }

  // Governor first: it needs only card tuples and the save, and its `showDue` bounds what has to be in memory.
  const cap = capFor(settings.intensity, belt, settings.maxReviews);
  let dueTotal = 0;
  store.cards.forEach((k, t) => {
    void k;
    if (t[0] <= today && t[5] !== 0 && !hasFlag(t[7], CardFlag.archived)) dueTotal++;
  });
  const { acc7, n } = accuracy7(store.daily.value, today);
  const intro = introducedToday(today);
  const npd = effectiveNewPerDay(settings, belt);
  const target = Math.round(npd.vocab + npd.kanji + npd.grammar);
  const minutesToday = store.daily.value[today]?.minutes ?? 0;
  const expected = settings.intensity === 'custom' ? EXPECTED_MAX_MINUTES.standard : EXPECTED_MAX_MINUTES[settings.intensity];
  const gov = governor({
    due: dueTotal,
    cap,
    acc7,
    acc7n: n,
    retention: settings.retention,
    halved: false,
    recoveredDays: 0,
    newToday: intro.vocab + intro.kanji + intro.grammar,
    target,
    minutesToday,
    expectedMaxMinutes: expected,
    awayDays: progress.awayDays,
    daysBack: 0,
  });

  // Only the cards a plan can draw need their items in memory (design 07 §6/§9: station entry ≤ 1 MB raw, not
  // the whole corpus behind every due card): the due queue up to `showDue` plus a reserve, in the same order
  // `dueQueue` uses, arcade rechecks, and the Weak Point set when a tag is in play. The Dojo needs counts only.
  const dueItems: string[] = [];
  if (o.mode !== 'dojo') {
    const wanted = new Set<string>();
    for (const c of dueCards({ cards: store.cards, today, limit: gov.showDue + DUE_LOAD_RESERVE, backlog: gov.backlog, kaidenQuota: kaidenQuota(cap) })) wanted.add(c.itemId);
    for (const c of recheckCards(store.cards)) wanted.add(c.itemId);
    for (const e of nemesisItems(today)) wanted.add(e.itemId);
    const weak = store.weakPoints.value;
    const tags = new Set<ErrorTag>((Object.keys(weak) as ErrorTag[]).filter((t) => weak[t].active));
    if (o.tag) tags.add(o.tag);
    if (tags.size > 0) {
      const log = store.log.recent(5000);
      for (const tag of tags) for (const c of weakPointSet(tag, store.cards, log, today).slice(0, 20)) wanted.add(c.itemId);
    }
    dueItems.push(...wanted);
    try {
      await loader.load(dueItems.filter((id) => loader.get(id) === undefined));
    } catch {
      /* offline: cards whose content is missing are skipped by stepForCard */
    }
  }

  const vocabPool: VocabItem[] = [];
  const kanjiPool: KanjiItem[] = [];
  const grammarPool: GrammarItem[] = [];
  const kanaPool: KanaItem[] = [];
  const stories: StoryItem[] = [];
  const seen = new Set<string>();
  const addItem = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const it = loader.get(id);
    if (isVocab(it)) vocabPool.push(it);
    else if (isKanji(it)) kanjiPool.push(it);
    else if (isGrammar(it)) grammarPool.push(it);
    else if (isKana(it)) kanaPool.push(it);
    else if (isStory(it)) stories.push(it);
  };
  for (const b of bundles) for (const id of [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.kanaIds, ...b.storyIds]) addItem(id);
  for (const id of dueItems) addItem(id);
  // Every item the learner holds a card for and whose content is already in memory (older stations' words for pools and the sentence of the day).
  store.cards.forEach((k) => addItem(parseCardKey(k).itemId));

  const planKey = `${o.mode ?? 'plan'}-${today}-${hashSeed(store.seed(), today, o.mode ?? 'plan', o.seed ?? 0, station).toString(16)}`;
  return {
    loader,
    today,
    now: store.now(),
    seed: store.seed(),
    station,
    belt,
    settings,
    medianMs: store.medianMs.value,
    bundle,
    bundles,
    nextBundle,
    components,
    stories,
    vocabPool,
    kanjiPool,
    grammarPool,
    kanaPool,
    known: knownSet(store.cards, today),
    allowlist,
    rng: rngFor(store.seed(), today, o.mode ?? 'plan', o.seed ?? 0, station),
    available: o.available ?? ((id) => isRegistered(id)),
    cap,
    dueTotal,
    backlog: gov.backlog,
    showDue: gov.showDue,
    newTarget: gov.newTarget,
    newAllowed: gov.newAllowed,
    crammingCap: gov.crammingCap,
    overtraining: gov.overtraining,
    seq: 0,
    planKey,
  };
}
