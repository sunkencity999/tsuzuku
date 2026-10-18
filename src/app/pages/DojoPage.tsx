/**
 * TSUZUKU — 道場 the home screen (group A, design 03 §3, §6–§8, §11–§12; 06 §5;
 * design 09 §7 A Hiraku, §5.1 / §5.3 / §5.9 / §5.11, §8 the return loop).
 *
 * `pages.ts` injects `Scene` (G's DojoScene, or nothing while it lands),
 * `feed` (E's `dojoFeed`, or null) and `gate` (E's `gateForecast`, or null).
 * The page renders synchronously from the store — flame, quests, resume card,
 * belt line — and fills the forecast, teaser, Kage, Nemesis, Gatekeeper and
 * Shinsa panels when the feed resolves. A missing or failing feed degrades to
 * `derived.forecastCounts()`: the three session tiles always work.
 *
 * The arrival (09 §7 A): on the first Dojo render of a visit where
 * `progress.arrivedDay !== store.today()` the shōji panels part (`.shoji`,
 * aria-hidden, never blocking input, any tap or key skips), the phase word
 * (朝 asa · morning …) sits over the stage's top edge for two seconds once the
 * panels are gone (out of flow: nothing below it shifts when it leaves), the
 * tategaki column, then the forecast and the one hanko bleed in — each
 * entrance delayed past the panels' part (pages.css, "paper, then ink, then
 * text", §6.3) — and the scene (`arrival` prop) pulses what grew since
 * yesterday; then `arrivedDay` is written once. Entered from a session
 * (`html[data-travel="out"]`, §7 C Kadode) the panels and the word are skipped
 * — that return has its own shōji — and today's done quest ticks osu once.
 * Reduced motion: no `.ink-*` class (wet ink shown dry), the panels and the
 * word fade at --dur-fade, captions identical.
 * The ethical line: no absent-day count anywhere here; the never-lit hearth
 * says `S.flameUnlit`; the mountain card prints the honest spread, never the
 * absence length; the sekki and kō carry dates, never "in N days".
 *
 * The column (§3.3, §5.9): today's seal (kanji numerals + "Oct 18", only when
 * today has a session, wet until the 04:00 roll), the sekki, the kō, the moon —
 * each with romaji and English, the Japanese from `public/calendar/koyomi.json`
 * once `fetchKoyomi()` resolves (called here after mount, never at boot) — the
 * Mastered sentence of the day or the greeting triple, and the era date with
 * its Latin gloss. Exactly one `.hanko` on the page: the recommended session
 * (or the Welcome Back set, or Resume); the other sessions are `.sheet` tiles.
 */
import type { FunctionComponent, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SANJO_OHASHI, STATIONS, type Belt } from '@/content/types';
import { bus } from '@/shared/events';
import { fetchKoyomi, koOf, koyomiData, moonJa, moonPhase, sekkiJa, sekkiSpanOf, skyPhase, type SkyPhase } from '@/shared/koyomi';
import { href, type Route } from '@/shared/routes';
import type { DojoFeed, SessionMode, SessionSnapshot } from '@/shared/session-types';
import type { DailyRow, EpochDay } from '@/shared/store-types';
import { civilParts, dayToCivil, formatEraDate } from '@/shared/time';
import { Lantern, type LanternState } from '@/shared/ui/Lantern';
import { prefersReducedMotion } from '@/shared/ui/use-reveal';
import { QUESTS, awayStatus, questProgress, store, type AwayStatus, type QuestProgress } from '@/store';
import { forecastCounts, streakState, type FlameState } from '@/store/derived';
import type { DojoFeedFull, gateForecast } from '@/session/dojo-feed';
import { isFirstRun } from '../first-run';
import { BELT_NAME, MONTHS_SHORT, S, fmt, num } from './strings';
import './pages.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The contract feed plus whatever extras E's full feed carries (all optional),
 * among them `radioMinutes` (design 08 §10.2: minutes of 茶屋ラジオ material the
 * learner can already follow; `null` when the feed cannot say).
 */
export type Feed = DojoFeed & Partial<Omit<DojoFeedFull, keyof DojoFeed>>;

/** E's `gateForecast(fc, scrolls)`: the store forecast with the Scroll block taken off when nothing is left to teach. */
export type GateForecast = typeof gateForecast;

/** What the page hands the injected scene (G's `DojoScene` props). */
export interface SceneProps {
  compact?: boolean;
  /** The daily arrival (design 09 §7 A): the scene diffs and pulses since yesterday, then persists `sceneSeen`. */
  arrival?: boolean;
}

export interface DojoPageProps {
  route: Route;
  /** G's `DojoScene`; `pages.ts` passes an empty component until the art lands. */
  Scene?: FunctionComponent<SceneProps> | null;
  /** E's `dojoFeed`; null while the session barrel is missing. */
  feed?: (() => Promise<DojoFeed>) | null;
  /** E's `gateForecast`; null while the session barrel does not export it. The fallback forecast then stands ungated. */
  gate?: GateForecast | null;
}

type FeedStatus = 'loading' | 'ready' | 'failed' | 'none';

const SESSION_MODES_SHOWN: readonly { mode: SessionMode; name: string; ja: string; desc: string }[] = [
  { mode: 'kata', name: S.dojoKata, ja: S.dojoKataJa, desc: S.dojoKataDesc },
  { mode: 'kumite', name: S.dojoKumite, ja: S.dojoKumiteJa, desc: S.dojoKumiteDesc },
  { mode: 'shugyo', name: S.dojoShugyo, ja: S.dojoShugyoJa, desc: S.dojoShugyoDesc },
];

export const FLAME_TEXT: Record<FlameState, string> = {
  lit: S.flameLit,
  gold: S.flameGold,
  ember: S.flameEmber,
  frozen: S.flameFrozen,
  rest: S.flameRest,
  broken: S.flameBroken,
};

/** The visible English state word beside the drawn tongue (design 09 §5.10). */
export const FLAME_WORD: Record<FlameState, string> = {
  lit: S.flameWordLit,
  gold: S.flameWordGold,
  ember: S.flameWordEmber,
  frozen: S.flameWordFrozen,
  rest: S.flameWordRest,
  broken: S.flameWordBroken,
};

/** The phase word of the arrival (design 09 §3.4, §7 A beat 1,100): kanji, reading, English. */
export const PHASE_WORD: Record<SkyPhase, { ja: string; reading: string; en: string }> = {
  dawn: { ja: S.dojoPhaseDawnJa, reading: S.dojoPhaseDawnReading, en: S.dojoPhaseDawnEn },
  day: { ja: S.dojoPhaseDayJa, reading: S.dojoPhaseDayReading, en: S.dojoPhaseDayEn },
  dusk: { ja: S.dojoPhaseDuskJa, reading: S.dojoPhaseDuskReading, en: S.dojoPhaseDuskEn },
  night: { ja: S.dojoPhaseNightJa, reading: S.dojoPhaseNightReading, en: S.dojoPhaseNightEn },
};

/** How long the phase word stays (design 09 §7 A: "for 2 s"). */
export const PHASE_WORD_MS = 2000;
/** Safety timers for the shōji's part (≤ 600 ms) and a kasure exit when no transitionend / animationend arrives (jsdom, a hidden tab). */
export const SHOJI_SAFETY_MS = 1000;
export const LEAVE_SAFETY_MS = 400;
/** Below this width the scene is the compact stage and the column a line under it (design 09 §5.9). */
export const COMPACT_QUERY = '(max-width: 639.98px)';

const ERA_ROMAJI: Record<string, string> = { 令和: S.eraReiwa, 平成: S.eraHeisei, 昭和: S.eraShowa };
const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers (exported for tests)                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/** A save with no trace of a learner: the shell's `isFirstRun` under the Dojo's name. */
export const isFreshSave = isFirstRun;

export function dueLine(due: number): string {
  if (due <= 0) return S.dojoNoDue;
  return due === 1 ? S.dojoDueOne : fmt(S.dojoDue, { n: num(due) });
}

/** The forecast when the engine's line is unavailable: due count and the Kumite estimate. */
export function fallbackForecast(due: number, kumiteMinutes: number): string {
  return `${dueLine(due)}${S.separator}${fmt(S.dojoMinutes, { n: Math.max(1, Math.round(kumiteMinutes)) })}`;
}

/**
 * What the store alone can say about today. The store knows of no Scroll, so
 * with E's `gate` the forecast is gated at 0 scrolls (no new-item minutes),
 * the same cut the live feed makes on a day without a Scroll.
 */
export function fallbackFeed(gate?: GateForecast | null): Feed {
  const raw = forecastCounts();
  const fc = gate ? { ...raw, ...gate(raw, 0) } : raw;
  const p = store.progress.value;
  return {
    forecastLine: fallbackForecast(fc.due, fc.minutes.kumite),
    minutes: fc.minutes,
    nextMilestone: '',
    welcome: p.welcomeBackDue ? 'comeback' : p.awayDays >= 7 ? 'mountain' : 'none',
    due: fc.due,
    flame: streakState(),
  };
}

export function questTitle(id: QuestProgress['id']): string {
  return QUESTS.find((q) => q.id === id)?.titleEn ?? id;
}

/** Steps left in a saved session, or 0 when none is waiting. */
export function stepsLeft(snap: SessionSnapshot | null): number {
  if (!snap) return 0;
  return Math.max(0, snap.plan.steps.length - snap.cursor);
}

/**
 * The one session the hanko recommends (design 09 §5.3 "the recommended
 * session"): Shugyō when an episode waits, Kumite when a Scroll does, Kata
 * otherwise — honest to what the day holds, never a nudge upward.
 */
export function recommendedMode(feed: Feed): SessionMode {
  if ((feed.episodes ?? 0) >= 1) return 'shugyo';
  if ((feed.scrolls ?? 0) >= 1) return 'kumite';
  return 'kata';
}

/** `18` → 十八 (1–99; 0 → 〇): the seal's day and the station ordinal, glyphs all in the base and shell slices. */
export function kanjiNumeral(n: number): string {
  const v = Math.max(0, Math.min(99, Math.floor(Number.isFinite(n) ? n : 0)));
  if (v < 10) return KANJI_DIGITS[v]!;
  const tens = Math.floor(v / 10);
  const ones = v % 10;
  return `${tens === 1 ? '' : KANJI_DIGITS[tens]}十${ones === 0 ? '' : KANJI_DIGITS[ones]}`;
}

/** "Oct 18" — the pixel micro-label under the seal and in the glosses. */
export function dateLabel(day: EpochDay): string {
  const c = dayToCivil(day);
  return `${MONTHS_SHORT[c.month - 1] ?? c.month} ${c.day}`;
}

/** "Reiwa 8 · Oct 18": the Latin gloss of `formatEraDate` (year 1 = 元年 → 1). */
export function eraGloss(day: EpochDay): string {
  const ja = formatEraDate(day);
  const m = /^(\D+?)(\d+|元)年/.exec(ja);
  const era = m ? (ERA_ROMAJI[m[1]!] ?? m[1]!) : '';
  const year = m ? (m[2] === '元' ? '1' : m[2]!) : String(dayToCivil(day).year);
  return `${era ? `${era} ` : ''}${year}${S.separator}${dateLabel(day)}`;
}

/** The era date with every run of Arabic digits wrapped for tate-chū-yoko (upright in the column, pixel face). */
export function eraDateNodes(day: EpochDay): JSX.Element[] {
  return formatEraDate(day)
    .split(/(\d+)/)
    .filter((s) => s.length > 0)
    .map((s, i) => (/^\d+$/.test(s) ? <span key={i} class="tategaki-column__tcy">{s}</span> : <span key={i}>{s}</span>));
}

/**
 * "The dojo kept your place. Day 2 back · 6 spread days left · new items return tomorrow."
 * (design 09 §8): the honest spread from `awayStatus`; the absence length is never printed.
 */
export function mountainLine(a: AwayStatus): string {
  const parts = [fmt(S.dojoMountainDay, { n: a.returnedDaysAgo + 1 })];
  if (a.spreadDaysLeft > 0) parts.push(a.spreadDaysLeft === 1 ? S.dojoMountainSpreadOne : fmt(S.dojoMountainSpread, { n: a.spreadDaysLeft }));
  parts.push(a.newPaused ? (a.returnedDaysAgo === 0 ? S.dojoMountainNewPaused : S.dojoMountainNewTomorrow) : S.dojoMountainNewBack);
  return `${S.dojoKept} ${parts.join(S.separator)}.`;
}

/** Today has a session (a daily row with reps or minutes): the day's seal is pressed. */
export function hasSessionToday(daily: Record<EpochDay, DailyRow>, today: EpochDay): boolean {
  const row = daily[today];
  return Boolean(row && (row.reps > 0 || row.minutes > 0));
}

/** The genkan strip's three towns: the one before, the current station, the one ahead (0 = Nihonbashi, 54 = Sanjō Ōhashi). */
export function townNumbers(station: number): number[] {
  const s = Math.max(0, Math.min(53, Math.floor(Number.isFinite(station) ? station : 0)));
  return [s - 1, s, s + 1].filter((n) => n >= 0 && n <= 54);
}

export function stationName(n: number): { ja: string; romaji: string; gateEn: string } {
  const s = STATIONS.find((st) => st.number === n);
  if (s) return { ja: s.nameJa, romaji: s.nameRomaji, gateEn: s.gateEn };
  return n <= 0 ? { ja: S.onbTitleJa, romaji: S.onbTitle, gateEn: '' } : { ja: SANJO_OHASHI.nameJa, romaji: SANJO_OHASHI.nameRomaji, gateEn: '' };
}

function townHref(n: number): string {
  return n >= 1 && n <= 53 ? href({ name: 'station', n }) : href({ name: 'road' });
}

function beltName(b: Belt): string {
  return BELT_NAME[b] ?? b;
}

function localHour(now: number, tz: string): number {
  try {
    return civilParts(now, tz).hour;
  } catch {
    return civilParts(now).hour;
  }
}

/** The page is being entered from a session (design 09 §7 C): `transitions.ts` writes `html[data-travel="out"]` for both the VT and the fallback path before the swap. */
function cameFromSession(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-travel') === 'out';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hooks                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function matchCompact(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches;
  } catch {
    return false;
  }
}

/** `true` below 640 px (the compact stage); false where `matchMedia` is absent. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(matchCompact);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(COMPACT_QUERY);
    const on = (): void => setCompact(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return compact;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The arrival (design 09 §7 A)                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The shōji panels (§5.11): mounted closed, parted on the next frame (motion.css
 * transitions the panels ≤ 600 ms; reduced motion fades the element at
 * --dur-fade), gone on `transitionend`, on any tap or key, or after the safety
 * timer. `pointer-events: none` and `aria-hidden`: they never block anything.
 */
function Shoji(p: { onDone: () => void }): JSX.Element {
  const [state, setState] = useState<'closed' | 'open'>('closed');
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(p.onDone);
  done.current = p.onDone;
  useEffect(() => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      done.current();
    };
    const el = ref.current;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setState('open')) : null;
    const timer = raf === null ? setTimeout(() => setState('open'), 0) : null;
    // the panels are ::before / ::after: their transitionend targets this element
    const onEnd = (e: Event): void => {
      if (e.target === el) finish();
    };
    el?.addEventListener('transitionend', onEnd);
    document.addEventListener('pointerdown', finish, true);
    document.addEventListener('keydown', finish, true);
    const safety = setTimeout(finish, SHOJI_SAFETY_MS);
    return () => {
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      if (timer !== null) clearTimeout(timer);
      clearTimeout(safety);
      el?.removeEventListener('transitionend', onEnd);
      document.removeEventListener('pointerdown', finish, true);
      document.removeEventListener('keydown', finish, true);
    };
  }, []);
  return <div ref={ref} class="shoji" aria-hidden="true" data-state={state} data-shoji />;
}

/**
 * The phase word over the stage's top edge (out of flow, pointer-events: none):
 * nijimi in, two seconds from the moment the panels are gone (`hold`), kasure
 * out. Reduced motion: no verb class, `.rm-fade` — a --dur-fade opacity exit.
 */
function PhaseWord(p: { phase: SkyPhase; reduced: boolean; hold: boolean; onDone: () => void }): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const done = useRef(p.onDone);
  done.current = p.onDone;
  useEffect(() => {
    if (p.hold) return;
    const t = setTimeout(() => setLeaving(true), PHASE_WORD_MS);
    return () => clearTimeout(t);
  }, [p.hold]);
  useEffect(() => {
    if (!leaving) return;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      done.current();
    };
    const el = ref.current;
    const onEnd = (e: Event): void => {
      if (e.target === el) finish();
    };
    el?.addEventListener('animationend', onEnd);
    el?.addEventListener('transitionend', onEnd);
    const safety = setTimeout(finish, LEAVE_SAFETY_MS);
    return () => {
      clearTimeout(safety);
      el?.removeEventListener('animationend', onEnd);
      el?.removeEventListener('transitionend', onEnd);
    };
  }, [leaving]);
  const w = PHASE_WORD[p.phase];
  return (
    <p ref={ref} class={`dojo__phase${p.reduced ? ' rm-fade' : ' ink-nijimi'}`} data-phase={p.phase} data-leaving={leaving ? '' : undefined}>
      <span class="dojo__phase-ja" lang="ja">
        {w.ja}
      </span>
      <span class="dojo__phase-reading">{w.reading}</span>
      <span class="dojo__phase-en">{w.en}</span>
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The tategaki column (design 09 §3.3, §5.9)                                  */
/* ────────────────────────────────────────────────────────────────────────── */

interface ColumnProps {
  today: EpochDay;
  /** The Mastered sentence of the day (Brown, else Green); the greeting triple when none exists. */
  sentence?: { ja: string; kana: string };
  /** Today has a session: the day's seal is pressed. */
  sealed: boolean;
  /** The seal is still wet (dries at the 04:00 roll). */
  wet: boolean;
  /** Reduced motion: wet ink is shown dry — no `.ink-wet` at all (design 09 §5.3). */
  reduced: boolean;
}

function Column(p: ColumnProps): JSX.Element {
  const data = koyomiData();
  const span = sekkiSpanOf(p.today);
  const sekki = span.sekki;
  const ko = koOf(p.today, data);
  const moon = moonPhase(p.today);
  const sekkiName = sekkiJa(sekki.id, data);
  const moonName = moonJa(moon.name, data);
  const day = dayToCivil(p.today).day;
  // --i 1…: the phase word takes 0, so the column follows it by one stagger on the arrival
  let i = 1;
  const idx = (): JSX.CSSProperties => ({ '--i': i++ }) as JSX.CSSProperties;
  // the wet layer sits on the DISC only: the pixel label beneath stays untinted and legible (01 §7 AA)
  const wetClass = p.reduced ? '' : p.wet ? ' ink-wet' : ' ink-wet is-dry';
  return (
    <aside class="tategaki-column dojo__column" aria-label={S.dojoColumnLabel} data-koyomi={data ? 'loaded' : 'pending'}>
      {p.sealed ? (
        <span class="seal-date" style={idx()} role="img" aria-label={fmt(S.dojoSealLabel, { date: dateLabel(p.today) })} data-seal>
          <span class={`seal-date__day${wetClass}`} lang="ja" aria-hidden="true">
            {kanjiNumeral(day)}日
          </span>
          <span class="seal-date__label">{dateLabel(p.today)}</span>
        </span>
      ) : null}
      <span class="dojo__col-item" style={idx()} data-col="sekki">
        {sekkiName ? <span lang="ja">{sekkiName}</span> : null}
        <span class="tategaki-column__gloss">
          {sekki.romaji}
          {S.separator}
          {sekki.en}
          {S.separator}
          {fmt(S.dojoColumnFrom, { date: dateLabel(span.from) })}
        </span>
      </span>
      <span class="dojo__col-item" style={idx()} data-col="ko">
        {ko.ja ? (
          <span lang="ja" class="dojo__col-ja--ko">
            {ko.ja}
          </span>
        ) : null}
        <span class="tategaki-column__gloss">
          {ko.romaji && ko.en ? `${ko.romaji}${S.separator}${ko.en}` : fmt(S.dojoColumnKoStep, { n: ko.step + 1 })}
          {S.separator}
          {fmt(S.dojoColumnFrom, { date: dateLabel(ko.fromDay) })}
        </span>
      </span>
      <span class="dojo__col-item" style={idx()} data-col="moon" data-moon={moon.name}>
        {moonName ? <span lang="ja">{moonName}</span> : null}
        <span class="tategaki-column__gloss">
          {moon.romaji}
          {S.separator}
          {moon.en}
        </span>
      </span>
      {p.sentence ? (
        <span class="dojo__col-item dojo__col-sentence" style={idx()} data-col="sentence">
          <span class="visually-hidden">{S.dojoSentenceOfDay}</span>
          <span lang="ja">{p.sentence.ja}</span>
          <span class="visually-hidden" lang="ja">
            {p.sentence.kana}
          </span>
        </span>
      ) : (
        <span class="dojo__col-item dojo__col-greeting" style={idx()} data-col="greeting">
          <span lang="ja">{S.columnGreetingJa}</span>
          <span class="tategaki-column__gloss">
            {S.columnGreetingRomaji}
            {S.separator}
            {S.columnGreetingEn}
          </span>
        </span>
      )}
      <span class="tategaki-column__foot dojo__col-item" style={idx()} data-col="era">
        <span lang="ja">{eraDateNodes(p.today)}</span>
        <span class="tategaki-column__gloss">{eraGloss(p.today)}</span>
      </span>
      {/* the honesty label is visible, not a tooltip (design 09 §7 H) */}
      <span class="tategaki-column__gloss" style={idx()} data-col="note">
        {S.dojoColumnNote}
      </span>
    </aside>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sub-views                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** The three sessions: the recommended one is the page's hanko, the others paper tiles with a seal corner (design 09 §5.3). */
function SessionTiles(p: { feed: Feed; hanko: SessionMode | null; enter: boolean }): JSX.Element {
  const { minutes, due = 0, scrolls, episodes } = p.feed;
  const counts: Partial<Record<SessionMode, string | null>> = {
    kata: dueLine(due),
    kumite: scrolls === undefined ? null : scrolls === 1 ? S.dojoScrollOne : fmt(S.dojoScrolls, { n: scrolls }),
    shugyo: episodes === undefined ? null : episodes >= 1 ? S.dojoEpisodeOne : null,
  };
  return (
    <div class="dojo__sessions" role="list">
      {SESSION_MODES_SHOWN.map((s, i) => {
        const min = Math.max(1, Math.round(minutes[s.mode as keyof DojoFeed['minutes']]));
        const isHanko = p.hanko === s.mode;
        return (
          <a
            key={s.mode}
            role="listitem"
            class={`${isHanko ? 'hanko' : 'sheet'} dojo__session${isHanko && p.enter ? ' ink-nijimi' : ''}`}
            style={isHanko && p.enter ? ({ '--i': 2 } as JSX.CSSProperties) : undefined}
            href={href({ name: 'train', mode: s.mode })}
            aria-label={`${fmt(S.dojoStartSession, { name: s.name, n: min })}${isHanko ? `${S.separator}${S.dojoRecommended}` : ''}`}
            data-mode={s.mode}
            data-recommended={isHanko ? 'true' : undefined}
          >
            {isHanko ? null : (
              <span class="seal dojo__session-seal" lang="ja" aria-hidden="true">
                {s.ja}
              </span>
            )}
            <span class="dojo__session-name">
              {isHanko ? (
                <span class="dojo__session-ja brush" lang="ja" aria-hidden="true">
                  {s.ja}
                </span>
              ) : null}
              <span>{s.name}</span>
              <span class="dojo__session-min">{fmt(S.dojoMinutes, { n: min })}</span>
            </span>
            <span class="dojo__session-desc">{s.desc}</span>
            {counts[s.mode] ? <span class="dojo__session-count">{counts[s.mode]}</span> : null}
            {isHanko ? <span class="dojo__session-tag">{S.dojoRecommended}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

/**
 * 茶屋ラジオ tile (design 08 §10.2): a quiet link under the session tiles.
 * The minute count is the feed's; without a feed the number is hidden and the
 * link stays. Never a session, never a training day — the copy says so.
 */
function RadioTile(p: { feed: Feed }): JSX.Element {
  const n = p.feed.radioMinutes;
  const hasCount = typeof n === 'number' && Number.isFinite(n);
  return (
    <section class="panel page__section dojo__radio" aria-labelledby="dojo-radio" data-radio>
      <h2 id="dojo-radio">
        {S.dojoRadioTitle}
        <span class="ja" lang="ja">
          {S.dojoRadioTitleJa}
        </span>
      </h2>
      <p class="dojo__line">{S.dojoRadioLede}</p>
      {hasCount ? (
        <p class="dojo__radio-min" data-radio-minutes>
          {fmt(S.dojoRadioMinutes, { n: num(n) })}
        </p>
      ) : null}
      <p class="dojo__line">{S.dojoRadioNote}</p>
      <div class="page__actions">
        <a class="btn" href={href({ name: 'radio' })} data-radio-link>
          {S.dojoRadioOpen}
        </a>
      </div>
    </section>
  );
}

/**
 * The Three Kata; a done tick is wet ink (the latest one carries the bleed) until
 * the 04:00 roll; entered from a session (§7 C beat 1,000) every done tick
 * presses once (`.ink-osu`, --i staggered). Reduced motion: colour only.
 */
function Quests(p: { wetId: string | null; dry: boolean; reduced: boolean; osu: boolean }): JSX.Element {
  const list = questProgress(store);
  const allDone = list.length > 0 && list.every((q) => q.done);
  let pressed = 0;
  return (
    <section class="panel page__section" aria-labelledby="dojo-quests">
      <h2 id="dojo-quests">
        {S.dojoQuests}
        <span class="ja" lang="ja">
          {S.dojoQuestsJa}
        </span>
      </h2>
      {list.length === 0 ? (
        <p class="empty">{S.dojoQuestsNone}</p>
      ) : (
        <ul class="dojo__quests">
          {list.map((q) => {
            const wet = q.done && q.id === p.wetId && !p.reduced;
            const osu = q.done && p.osu && !p.reduced;
            return (
              <li key={q.id} class="dojo__quest" data-done={q.done ? 'true' : 'false'} data-quest={q.id} data-wet={q.done && q.id === p.wetId ? (p.dry ? 'dry' : 'wet') : undefined}>
                <span class={`dojo__quest-wet${wet ? ' ink-wet' : ''}${wet && p.dry ? ' is-dry' : ''}${osu ? ' ink-osu' : ''}`} style={osu ? ({ '--i': pressed++ } as JSX.CSSProperties) : undefined}>
                  <span class="dojo__quest-mark" aria-hidden="true">
                    {q.done ? '✓' : ''}
                  </span>
                </span>
                <span class="dojo__quest-title">{questTitle(q.id)}</span>
                <span class="dojo__quest-count">{q.done ? S.dojoQuestDone : fmt(S.dojoQuestOf, { n: q.n, target: q.target })}</span>
              </li>
            );
          })}
        </ul>
      )}
      {allDone ? <p class="page__status">{S.dojoQuestsDone}</p> : null}
    </section>
  );
}

function ResumeCard(p: { snap: SessionSnapshot; onFresh(): void; hanko: boolean }): JSX.Element {
  const left = stepsLeft(p.snap);
  return (
    <section class="status-window dojo__resume" aria-label={S.dojoResumeTitle}>
      <p class="dojo__resume-text">
        <strong>{S.dojoResumeTitle}</strong> {S.dojoResumeHint}
      </p>
      <a class={p.hanko ? 'hanko' : 'btn'} href={href({ name: 'train', mode: p.snap.plan.mode })} data-resume>
        {fmt(S.dojoResume, { n: left })}
      </a>
      <button type="button" class="btn btn--ghost" onClick={p.onFresh}>
        {S.dojoStartFresh}
      </button>
    </section>
  );
}

function Teaser(p: { feed: Feed }): JSX.Element | null {
  const t = p.feed.teaser;
  if (!t) return null;
  return (
    <section class="panel page__section" aria-labelledby="dojo-teaser">
      <h2 id="dojo-teaser">
        {S.dojoTeaserTitle}
        <span class="ja" lang="ja">
          {S.dojoTeaserTitleJa}
        </span>
      </h2>
      {t.sentence ? (
        <div>
          <p class="dojo__line">{S.dojoTeaserSentence}</p>
          <p lang="ja" class="dojo__forecast">
            {t.sentence.ja}
          </p>
        </div>
      ) : null}
      {t.words.length > 0 ? (
        <div>
          <p class="dojo__line">{S.dojoTeaserWords}</p>
          <ul class="dojo__words">
            {t.words.map((w) => (
              <li key={w.itemId} class="dojo__word" lang="ja">
                {w.kana}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {t.milestone ? <p class="page__status">{t.milestone}</p> : null}
    </section>
  );
}

function KageStrip(p: { feed: Feed }): JSX.Element | null {
  const k = p.feed.kage;
  if (!k) return null;
  return (
    <section class="panel dojo__kage" aria-labelledby="dojo-kage" data-due={k.due ? 'true' : 'false'}>
      <p class="dojo__kage-text">
        <strong id="dojo-kage">
          {S.dojoKageTitle}
          <span class="ja" lang="ja">
            {' '}
            {S.dojoKageTitleJa}
          </span>
        </strong>
        <span>{k.beatenThisWeek ? S.dojoKageWon : k.line}</span>
        <span class="dojo__kage-score pixel">
          {k.best > 0 ? fmt(S.dojoKageBest, { n: num(k.best) }) : S.dojoKageNoRun}
          {k.lastScore !== null && k.lastScore !== undefined ? `${S.separator}${fmt(S.dojoKageLast, { n: num(k.lastScore) })}` : ''}
        </span>
      </p>
      {k.due ? (
        <a class="btn" href={href({ name: 'train', mode: 'kage' })}>
          {S.dojoKageRun}
        </a>
      ) : null}
    </section>
  );
}

function GateBanner(p: { feed: Feed }): JSX.Element | null {
  const g = p.feed.gate;
  if (!g || g.cleared || g.station <= 0) return null;
  const st = stationName(g.station);
  return (
    <section class="notice dojo__banner" aria-labelledby="dojo-gate" data-ready={g.ready ? 'true' : 'false'}>
      <p class="dojo__banner-text">
        <strong id="dojo-gate">
          {S.dojoGateTitle}
          <span class="ja" lang="ja">
            {' '}
            {S.dojoGateTitleJa}
          </span>
        </strong>{' '}
        {g.ready ? fmt(S.dojoGateReady, { gate: st.gateEn, station: st.romaji }) : fmt(S.dojoGateProgress, { green: g.green, total: g.total })}
      </p>
      {g.ready ? (
        <a class="btn" href={href({ name: 'gate', n: g.station })}>
          {S.dojoGateCta}
        </a>
      ) : (
        <a class="btn btn--ghost" href={href({ name: 'station', n: g.station })}>
          {st.romaji}
        </a>
      )}
    </section>
  );
}

function ShinsaBanner(p: { feed: Feed }): JSX.Element | null {
  const s = p.feed.shinsa;
  if (!s || s.eligibility.passed) return null;
  const belt = beltName(s.belt);
  return (
    <section class="notice dojo__banner" aria-labelledby="dojo-shinsa" data-eligible={s.eligibility.eligible ? 'true' : 'false'}>
      <p class="dojo__banner-text">
        <strong id="dojo-shinsa">
          {S.dojoShinsaTitle}
          <span class="ja" lang="ja">
            {' '}
            {S.dojoShinsaTitleJa}
          </span>
        </strong>{' '}
        {s.eligibility.eligible ? fmt(S.dojoShinsaReady, { belt }) : fmt(S.dojoShinsaNotYet, { belt })}
        {!s.eligibility.eligible && s.eligibility.reasons.length > 0 ? ` ${s.eligibility.reasons.join(' ')}` : ''}
      </p>
      {s.eligibility.eligible ? (
        <a class="btn" href={href({ name: 'shinsa', belt: s.belt })}>
          {S.dojoShinsaCta}
        </a>
      ) : null}
    </section>
  );
}

/** The genkan strip (design 09 §10 B1 first version): three `.sign`s, the current station in the middle; towns ahead are "ahead", never locked. */
function Genkan(p: { station: number }): JSX.Element {
  return (
    <ol class="dojo__genkan" aria-label={S.dojoGenkanLabel}>
      {townNumbers(p.station).map((n) => {
        const t = stationName(n);
        const state = n < p.station ? 'passed' : n === p.station ? 'here' : 'ahead';
        const word = state === 'passed' ? S.dojoTownPassed : state === 'here' ? S.dojoTownHere : S.dojoTownAhead;
        return (
          <li key={n} class="dojo__town" data-town={n} data-state={state} aria-current={state === 'here' ? 'step' : undefined}>
            <a class="sign dojo__town-link" href={townHref(n)}>
              <span class="sign__number">{n}</span>
              {n >= 1 && n <= 53 ? (
                <span class="sign__ordinal" lang="ja" aria-hidden="true">
                  第{kanjiNumeral(n)}宿
                </span>
              ) : null}
              <span class="sign__ja" lang="ja">
                {t.ja}
              </span>
              <span class="sign__reading">{t.romaji}</span>
              <span class="sign__en">{word}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** The ONE shared wet-ink def per page (motion.css `.ink-wet::after` → `url(#ink-bleed-8)`, brush.ts `inkBleed` at scale 8). */
function InkDefs(): JSX.Element {
  return (
    <svg class="dojo__defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="ink-bleed-8" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="8" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" result="disp" />
        <feGaussianBlur in="disp" stdDeviation="0.7" result="soft" />
        <feComponentTransfer in="soft">
          <feFuncA type="linear" slope="1.25" intercept="0" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function DojoPage(p: DojoPageProps): JSX.Element {
  const profile = store.profile.value;
  const progress = store.progress.value;
  const streak = store.streak.value;
  const settings = store.settings.value;
  const daily = store.daily.value;
  const quests = store.quests.value;
  const cardsVersion = store.cards.version.value;
  const today = store.today();
  const [status, setStatus] = useState<FeedStatus>(p.feed ? 'loading' : 'none');
  const [feed, setFeed] = useState<Feed>(() => fallbackFeed(p.gate));
  const [snap, setSnap] = useState<SessionSnapshot | null>(() => store.session.load());

  useEffect(() => {
    let alive = true;
    setSnap(store.session.load());
    if (!p.feed) {
      setFeed(fallbackFeed(p.gate));
      setStatus('none');
      return;
    }
    setStatus('loading');
    p.feed().then(
      (f) => {
        if (!alive) return;
        setFeed({ ...fallbackFeed(p.gate), ...(f as Feed) });
        setStatus('ready');
      },
      (err: unknown) => {
        if (!alive) return;
        console.warn('[dojo] feed failed', err);
        setFeed(fallbackFeed(p.gate));
        setStatus('failed');
      },
    );
    return () => {
      alive = false;
    };
  }, [p.feed, p.gate, cardsVersion]);

  const fresh = isFreshSave();
  const reduced = Boolean(settings.reducedMotion) || prefersReducedMotion();

  // Hiraku (design 09 §7 A): once a day, decided on the first render of the visit; `arrivedDay` written once.
  // Entered from a session (§7 C) the panels and the word stay away — Kadode closed its own shōji — and the ticks osu.
  const [arrival] = useState(() => !fresh && store.progress.peek().arrivedDay !== store.today());
  const [fromSession] = useState(cameFromSession);
  const [shoji, setShoji] = useState(arrival && !fromSession);
  const [phaseWord, setPhaseWord] = useState(arrival && !fromSession);
  useEffect(() => {
    if (!arrival) return;
    const t = store.today();
    store.patch('progress', (pr) => (pr.arrivedDay === t ? pr : { ...pr, arrivedDay: t }));
  }, []);

  // the calendar names: fetched once the picture is up, never at boot (design 09 §12.1 decision 15)
  const [, koyomiTick] = useState(0);
  useEffect(() => {
    if (koyomiData()) return;
    let alive = true;
    fetchKoyomi().then(
      (d) => {
        if (alive && d) koyomiTick((n) => n + 1);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  // wet ink dries at the 04:00 roll (design 09 §8 "Tomorrow")
  const [rolled, setRolled] = useState(false);
  useEffect(() => bus.on('day:rolled', () => setRolled(true)), []);

  const compact = useCompact();
  const flame = streakState();
  const unlit = streak.totalDays === 0;
  const lanternState: LanternState = unlit ? 'unlit' : flame;
  const station = progress.station;
  const here = stationName(station);
  // the station ahead is the one being walked (fixes the old station + 1 off-by-one)
  const nextN = Math.min(53, Math.max(1, station));
  const next = stationName(nextN);
  const Scene = p.Scene ?? null;
  const phase = skyPhase(localHour(store.now(), profile.tz));

  // the mountain card from the daily rows (design 09 §8): the honest spread, never the absence length
  const away = awayStatus(daily, today);
  const comeback = progress.welcomeBackDue;
  const mountain = !comeback && (progress.awayDays >= 7 || away.awayDays > 0);
  const welcome: 'comeback' | 'mountain' | 'none' = comeback ? 'comeback' : mountain ? 'mountain' : 'none';

  // exactly one hanko: the Welcome Back set, else Resume, else the recommended session
  const resumeLeft = stepsLeft(snap);
  const hankoAt: 'comeback' | 'resume' | 'session' | 'first' = fresh ? 'first' : comeback ? 'comeback' : resumeLeft > 0 ? 'resume' : 'session';
  const recommended = recommendedMode(feed);
  const enter = arrival && !reduced;
  const sealed = hasSessionToday(daily, today);
  const wetQuest = quests.day === today && quests.done.length > 0 ? quests.done[quests.done.length - 1]! : null;

  const onFresh = (): void => {
    store.session.clear();
    setSnap(null);
  };

  return (
    <div class="page dojo" data-feed={status} data-arrival={arrival ? '' : undefined} data-reduced={reduced ? '' : undefined}>
      <h1 class="visually-hidden">{S.dojoTitle}</h1>
      <InkDefs />
      {shoji ? <Shoji onDone={() => setShoji(false)} /> : null}

      {welcome !== 'none' ? (
        <section class="notice dojo__banner" role="status" data-welcome={welcome}>
          <p class="dojo__banner-text">
            {welcome === 'comeback' ? (
              <>
                <strong>{S.dojoKept}</strong> {S.dojoWelcomeBack}
              </>
            ) : away.awayDays > 0 ? (
              mountainLine(away)
            ) : (
              <>
                <strong>{S.dojoKept}</strong> {S.dojoMountain}
              </>
            )}
          </p>
          {welcome === 'comeback' ? (
            <a class="hanko" href={href({ name: 'train', mode: 'welcome' })}>
              {S.dojoTrain}
            </a>
          ) : null}
        </section>
      ) : null}

      <div class="dojo__stage">
        {Scene ? (
          <div class="dojo__scene">
            <Scene compact={compact} arrival={arrival} />
          </div>
        ) : null}
        {!fresh ? <Column today={today} sentence={feed.sentenceOfDay} sealed={sealed} wet={!rolled} reduced={reduced} /> : null}
        {phaseWord ? <PhaseWord phase={phase} reduced={reduced} hold={shoji} onDone={() => setPhaseWord(false)} /> : null}
      </div>

      <section class={`status-window dojo__status${enter ? ' ink-nijimi' : ''}`} style={enter ? ({ '--i': 1 } as JSX.CSSProperties) : undefined} aria-label={S.dojoForecast}>
        <p class="dojo__forecast" data-forecast>
          {feed.forecastLine}
        </p>
        {status === 'loading' ? <p class="dojo__line">{S.dojoFeedLoading}</p> : null}
        {status === 'failed' ? <p class="dojo__line">{S.dojoFeedFailed}</p> : null}
        {feed.nextMilestone ? (
          <p class="dojo__line">
            <span>{S.dojoNextMilestone}</span>
            <span>{feed.nextMilestone}</span>
          </p>
        ) : null}
        <p class="dojo__line">
          <Lantern state={lanternState} title={S.flame} label={unlit ? S.flameWordUnlit : FLAME_WORD[flame]} />
          <span data-flame={flame}>{unlit ? S.flameUnlit : FLAME_TEXT[flame]}</span>
        </p>
        <p class="dojo__line">
          <span class={`belt belt--${profile.belt}`} data-belt={profile.belt}>
            {fmt(S.dojoBeltStatus, { belt: beltName(profile.belt), n: station })}
          </span>
          <span>
            <span lang="ja">{here.ja}</span> {here.romaji}
          </span>
          <span>{S.levelLine}</span>
        </p>
        {feed.backlogLine ? (
          <p class="dojo__line" role="status">
            {feed.backlogLine}
          </p>
        ) : null}
        {feed.crammingCap ? (
          <p class="dojo__line" role="status">
            {S.dojoCramCap}
          </p>
        ) : null}
      </section>

      {fresh ? (
        <section class="status-window page__section" aria-labelledby="dojo-first">
          <h2 id="dojo-first">{S.dojoFirstRunTitle}</h2>
          <p>{S.dojoFirstRunBody}</p>
          <div class="page__actions">
            <a class="hanko hanko--lg" href={href({ name: 'onboarding' })} data-first-run>
              {S.dojoFirstRunCta}
            </a>
          </div>
        </section>
      ) : (
        <>
          {snap && resumeLeft > 0 ? <ResumeCard snap={snap} onFresh={onFresh} hanko={hankoAt === 'resume'} /> : null}
          <section class="page__section" aria-labelledby="dojo-sessions">
            <h2 id="dojo-sessions" class="visually-hidden">
              {S.dojoSessions}
            </h2>
            <SessionTiles feed={feed} hanko={hankoAt === 'session' ? recommended : null} enter={enter} />
          </section>
          <RadioTile feed={feed} />
          <Quests wetId={wetQuest} dry={rolled || quests.day !== today} reduced={reduced} osu={arrival && fromSession && quests.day === today} />
          <GateBanner feed={feed} />
          <ShinsaBanner feed={feed} />
          <KageStrip feed={feed} />
          {feed.nemesis?.line ? (
            <section class="notice dojo__banner" aria-labelledby="dojo-nemesis">
              <p class="dojo__banner-text">
                <strong id="dojo-nemesis">
                  {S.dojoNemesisTitle}
                  <span class="ja" lang="ja">
                    {' '}
                    {S.dojoNemesisTitleJa}
                  </span>
                </strong>{' '}
                {feed.nemesis.line} {S.dojoNemesisHint}
              </p>
            </section>
          ) : null}
          <Teaser feed={feed} />
        </>
      )}

      <section class="page__section" aria-labelledby="dojo-road">
        <h2 id="dojo-road">
          {S.dojoRoad}
          <span class="ja" lang="ja">
            {S.dojoRoadJa}
          </span>
        </h2>
        <Genkan station={station} />
        <div class="dojo__links">
          <a class="btn" href={href({ name: 'station', n: nextN })} data-next-station>
            {S.dojoNextStation}
            {S.separator}
            {fmt(S.dojoStationLink, { n: nextN, name: next.romaji })}
          </a>
          <a class="btn btn--ghost" href={href({ name: 'road' })}>
            {S.navRoad}
          </a>
        </div>
        {!fresh ? (
          <div class="dojo__links" aria-label={S.dojoArcade}>
            <a class="btn btn--ghost" href={href({ name: 'train', mode: 'rapid' })}>
              {S.dojoRapidFire}
            </a>
            <a class="btn btn--ghost" href={href({ name: 'train', mode: 'gojuon' })}>
              {S.dojoGojuon}
            </a>
            <span class="muted">{S.dojoArcadeHint}</span>
          </div>
        ) : null}
        {feed.proverb ? (
          <p class="dojo__proverb-line">
            <span class="eyebrow">{S.dojoProverb}</span>
            <span class="dojo__proverb" lang="ja">
              {feed.proverb}
            </span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
