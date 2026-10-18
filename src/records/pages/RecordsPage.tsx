/**
 * TSUZUKU — Records page (group B; design 02 §6.2, 05 §6–§7, §11).
 *
 * The JRPG status screen: days trained, minutes, reviews, retention,
 * honesty, the last four weeks, tomorrow's forecast, Projected Arrival
 * (two lines, a ±20 % band, never red, never a countdown; the onboarding
 * estimates before 14 active days), the belt timeline, the Perapera radar,
 * the Weak Point map, Kage history, Kiai totals, reading and speaking, and
 * one honest "what to do next" line (the first line, before any session has
 * been trained, points at Nihonbashi rather than the ledger; a due count is
 * narrated as a Kata to take, never as a backlog to clear). Everything is
 * recomputed on open from
 * the live store; the current station's bundle is fetched once so the
 * projection counts real remaining items, and every other station is
 * counted from its quota (the page says so). The tiles are .status-window
 * cartouches with Dela <Ticker> values (design 09 §5.5, §5.8, §12.1 d4): the
 * DOM holds the final number from first paint; the roll is a visual twin.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { content, type ContentLoader } from '../../content/loader';
import { BELTS, SANJO_OHASHI, STATIONS, type Belt, type StationBundle } from '../../content/types';
import { beltBadgeId } from '../../shared/catalog';
import { href, type Route } from '../../shared/routes';
import { weekStartDay } from '../../shared/time';
import type { EpochDay } from '../../shared/store-types';
import { TAG_LABEL, fill } from '../../shared/ui/strings';
import { Ticker } from '../../shared/ui/Ticker';
import { store } from '../../store';
import { forecastCounts, isBacklog, reviewCap } from '../../store/derived';
import { weekProgress } from '../../store/ledger';
import { MIN_ACTIVE_DAYS, lifetimeActiveDays, onboardingEstimate, projectRoad, type RoadProjection } from '../../store/projection';
import { activeTags } from '../../store/weak-points';
import { activityDays, retention } from '../../store/selectors';
import { honesty } from '../../store/stats';
import { BarRow, CalendarHeat, Sparkline, fmtNum, fullDate, monthYear, shortDate } from '../charts';
import { PeraperaRadar } from '../PeraperaRadar';
import { BELT_EN, S } from '../strings';
import { WeakPointMap } from '../WeakPointMap';
import './RecordsPage.css';

export interface RecordsPageProps {
  route: Route;
  /** Injectable for tests; defaults to the app loader. */
  loader?: ContentLoader;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure pieces                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** A ratio as whole percent points for a tile, or null when there is nothing to show. */
function pctValue(x: number | null): number | null {
  return x === null ? null : Math.round(x * 100);
}
const percentFormat = (n: number): string => fill(S.percent, { n: Math.round(n) });

/**
 * Station label for a belt's Shinsa station: `N3 (Okazaki)` style, from
 * STATIONS. The White belt's level is the kana band, not a JLPT level, so it
 * stays lower-case like RoadNav shows it (`kana (Kanagawa)`).
 */
export function beltTargetLabel(belt: Belt): string {
  const def = BELTS.find((b) => b.id === belt);
  const st = def ? STATIONS.find((s) => s.number === def.stations[1]) : undefined;
  const level = def ? (def.level === 'kana' ? S.levelKana : def.level.toUpperCase()) : '';
  return st ? `${level} (${st.nameRomaji})` : level;
}

export interface NextStepInput {
  backlog: boolean;
  due: number;
  shown: number;
  weakTag: string | null;
  weekMinutes: number;
  weekTargetHours: number;
  /** Lifetime sessions trained; 0 means the road has not started yet. */
  sessions?: number;
}

/**
 * One honest line: first session > backlog > due > weak point > ledger behind > rest.
 * The due line names a Kata, never an imperative to clear the queue (design 01 §3).
 */
export function nextStepLine(i: NextStepInput): string {
  if (i.sessions === 0) return S.nextFirst;
  if (i.backlog) return fill(S.nextBacklog, { shown: i.shown, due: i.due });
  if (i.due === 1) return S.nextDueOne;
  if (i.due > 0) return fill(S.nextDue, { n: i.due });
  if (i.weakTag) return fill(S.nextWeak, { tag: i.weakTag });
  if (i.weekTargetHours > 0 && i.weekMinutes < i.weekTargetHours * 60) {
    return fill(S.nextLedger, { h: fmtNum(Math.round((i.weekMinutes / 60) * 10) / 10), target: fmtNum(i.weekTargetHours) });
  }
  return S.nextRest;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Blocks                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** One cartouche: the number that matters in Dela, ticking in from its previous value; `null` prints the dash. */
function Tile(p: { label: string; value: number | null; format?: (n: number) => string; sub?: string; ja?: string }): JSX.Element {
  return (
    <div class="status-window tile">
      <span class="tile__value">{p.value === null ? S.unavailable : <Ticker value={p.value} format={p.format ?? fmtNum} />}</span>
      <span class="eyebrow">
        {p.ja ? <span lang="ja">{p.ja}</span> : null}
        {p.ja ? ' ' : ''}
        {p.label}
      </span>
      {p.sub ? <span class="tile__sub">{p.sub}</span> : null}
    </div>
  );
}

function Block(p: { id: string; ja: string; en: string; children: JSX.Element | (JSX.Element | null)[] | null; lede?: string }): JSX.Element {
  return (
    <section class="records__block" aria-labelledby={`${p.id}-title`}>
      <h2 id={`${p.id}-title`} class="records__h2">
        <span lang="ja">{p.ja}</span> <span class="records__h2-en">{p.en}</span>
      </h2>
      {p.lede ? <p class="records__lede">{p.lede}</p> : null}
      {p.children}
    </section>
  );
}

function ProjectionBlock(p: { road: RoadProjection | null; bundlesLoaded: boolean; today: EpochDay }): JSX.Element {
  const meta = store.meta();
  const active = lifetimeActiveDays(meta);
  if (!p.road) {
    const est = onboardingEstimate(meta.settings, p.today, Math.max(1, meta.progress.station));
    return (
      <div class="records__onboarding">
        <p class="records__projection-line">{fill(S.onboardingLine, { d100: monthYear(est.arrive100), d70: monthYear(est.arrive70) })}</p>
        <p class="records__muted">{fill(S.onboardingHours, { h: fmtNum(est.hoursInApp) })}</p>
        <p class="records__muted">
          {S.projectionTooEarly} {fill(S.projectionActiveSoFar, { n: Math.min(active, MIN_ACTIVE_DAYS) })}
        </p>
      </div>
    );
  }
  const a = p.road.arrival;
  return (
    <div class="records__projection">
      <p class="records__projection-line">{fill(S.projectionLine, { target: SANJO_OHASHI.nameRomaji, pace: monthYear(a.atPace), daily: monthYear(a.daily) })}</p>
      <p class="records__muted">{fill(S.projectionBand, { from: monthYear(a.band[0]), to: monthYear(a.band[1]) })}</p>
      <p class="records__muted">{fill(S.projectionPace, { active: a.activeDays, rate: fmtNum(Math.round(a.realizedRate * 10) / 10) })}</p>
      {a.fromQuota || !p.bundlesLoaded ? <p class="records__muted">{S.projectionQuota}</p> : null}
    </div>
  );
}

function BeltTimeline(p: { road: RoadProjection | null }): JSX.Element {
  const profile = store.profile.value;
  const progress = store.progress.value;
  const badges = store.collections.value.badges;
  const ahead = new Map((p.road?.belts ?? []).map((b) => [b.belt, b]));
  return (
    <ol class="belts" aria-label={S.beltTimeline}>
      {BELTS.map((b) => {
        const passed = progress.shinsaPassed.includes(b.id);
        const badgeId = beltBadgeId(b.id);
        const at = badgeId ? badges[badgeId] : undefined;
        const eta = ahead.get(b.id);
        const current = profile.belt === b.id;
        let text: string;
        if (passed) text = fill(S.beltPassed, { belt: BELT_EN[b.id] ?? b.id, date: at ? fullDate(at) : S.unavailable });
        else if (eta) text = fill(S.beltAhead, { belt: BELT_EN[b.id] ?? b.id, pace: monthYear(eta.atPace), daily: monthYear(eta.daily) });
        else text = `${BELT_EN[b.id] ?? b.id} · ${beltTargetLabel(b.id)}`;
        return (
          <li key={b.id} class={passed ? 'belts__row belts__row--passed' : current ? 'belts__row belts__row--current' : 'belts__row'} data-belt={b.id}>
            <span class={`belt belt--${b.id}`}>
              <span lang="ja">{b.nameJa}</span>
            </span>
            <span class="belts__text">{text}</span>
            {current ? <span class="tag">{S.beltCurrentMark}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function KageBlock(): JSX.Element {
  const k = store.kage.value;
  const rows = [...k.history].sort((a, b) => a[0] - b[0]).slice(-12);
  if (rows.length === 0) return <p class="records__muted">{S.kageNone}</p>;
  const best = Math.max(0, ...k.best4);
  return (
    <div class="records__kage">
      <p class="records__line">
        {k.wins === 1 ? S.kageWinsOne : fill(S.kageWins, { n: k.wins })} · {fill(S.kageBest, { n: fmtNum(best) })}
      </p>
      <Sparkline values={rows.map((r) => r[1])} label={S.kageScores} labels={rows.map((r) => shortDate(weekStartDay(r[0])))} />
      <ul class="records__list">
        {rows
          .slice()
          .reverse()
          .slice(0, 4)
          .map((r) => (
            <li key={r[0]}>{fill(S.kageWeek, { date: shortDate(weekStartDay(r[0])), score: fmtNum(r[1]) })}</li>
          ))}
      </ul>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function RecordsPage(p: RecordsPageProps): JSX.Element {
  const loader = p.loader ?? content;
  const today = store.today();
  const meta = store.meta();
  store.cards.version.value;
  const stats = meta.stats;
  const station = meta.progress.station;

  const [bundles, setBundles] = useState<StationBundle[] | null>(null);
  useEffect(() => {
    let alive = true;
    const n = Math.max(1, station);
    loader
      .station(n)
      .then((b) => {
        if (alive) setBundles([b]);
      })
      .catch(() => {
        if (alive) setBundles([]);
      });
    return () => {
      alive = false;
    };
  }, [station, loader]);

  const days = activityDays(28, today);
  const active28 = days.filter((d) => d.active).length;
  const ret7 = retention(7, today);
  const ret30 = retention(30, today);
  const hon = honesty(meta);
  const forecast = forecastCounts();
  const backlog = isBacklog();
  const cap = reviewCap();
  const road = projectRoad(meta, store.cards, bundles ?? [], today, store.log.recent(5000));
  const week = weekProgress(meta, today);
  const weak = activeTags(meta.weakPoints);
  const next = nextStepLine({
    backlog,
    due: forecast.due,
    shown: Math.min(forecast.due, cap),
    weakTag: weak[0] ? TAG_LABEL[weak[0]] : null,
    weekMinutes: week.minutes,
    weekTargetHours: week.targetHours,
    sessions: stats.sessions,
  });
  const speakingTested = stats.shadowLines > 0 || stats.monologues > 0;

  return (
    <article class="records">
      <header class="records__head">
        <h1 class="title-lockup">
          <span class="title-lockup__ja" lang="ja">
            {S.recordsTitleJa}
          </span>
          <span class="title-lockup__en">{S.recordsTitle}</span>
        </h1>
        <p class="records__lede">{S.recordsLede}</p>
      </header>

      <section class="records__tiles" aria-label={S.recordsTitle}>
        <Tile label={S.daysTrained} value={meta.streak.totalDays} />
        <Tile label={S.minutesTrained} value={stats.minutes} />
        <Tile label={S.reviews} value={stats.reviews} />
        <Tile label={S.retention7} value={pctValue(ret7)} format={percentFormat} sub={ret7 === null ? S.noReps : undefined} />
        <Tile label={S.retention30} value={pctValue(ret30)} format={percentFormat} />
        <Tile ja={S.honestyJa} label={S.honesty} value={pctValue(hon)} format={percentFormat} sub={hon === null ? S.honestyNone : `${fill(S.honestyLine, { pct: Math.round(hon * 100), n: stats.judgeChecks })}${hon >= 0.95 ? ` ${S.honestyCalibrated}` : ''}`} />
      </section>

      <section class="records__block--next status-window" aria-labelledby="next-title">
        <h2 id="next-title" class="records__h2">
          {S.nextTitle}
        </h2>
        <p class="records__next">{next}</p>
      </section>

      <Block id="activity" ja={S.activityTitleJa} en={S.activityTitle} lede={fill(S.activeOf28, { n: active28 })}>
        <div class="records__activity">
          <CalendarHeat caption={S.activityCaption} days={days.map((d) => ({ label: d.active ? fill(S.dayLabel, { date: fullDate(d.day), reps: d.reps, minutes: d.minutes }) : fill(S.dayIdle, { date: fullDate(d.day) }), value: d.reps, active: d.active }))} />
          <div class="records__sparks">
            <Sparkline values={days.map((d) => d.reps)} label={S.repsPerDay} labels={days.map((d) => shortDate(d.day))} />
            <Sparkline values={days.map((d) => d.minutes)} label={S.minutesPerDay} labels={days.map((d) => shortDate(d.day))} />
          </div>
        </div>
      </Block>

      <Block id="forecast" ja={S.forecastTitleJa} en={S.forecastTitle} lede={S.forecastNote}>
        <div class="records__bars">
          <BarRow label={S.forecastDue} value={forecast.due} max={Math.max(cap, forecast.due, 1)} series="ai" />
          <BarRow label={S.forecastNew} value={forecast.newItems} max={Math.max(20, forecast.newItems)} series="matcha" />
          <BarRow label={S.forecastKata} value={forecast.minutes.kata} max={Math.max(60, forecast.minutes.shugyo)} valueText={fill(S.forecastMinutes, { n: forecast.minutes.kata })} series="kin" />
          <BarRow label={S.forecastKumite} value={forecast.minutes.kumite} max={Math.max(60, forecast.minutes.shugyo)} valueText={fill(S.forecastMinutes, { n: forecast.minutes.kumite })} series="kin" />
          <BarRow label={S.forecastShugyo} value={forecast.minutes.shugyo} max={Math.max(60, forecast.minutes.shugyo)} valueText={fill(S.forecastMinutes, { n: forecast.minutes.shugyo })} series="kin" />
        </div>
      </Block>

      <Block id="projection" ja={S.projectionTitleJa} en={S.projectionTitle}>
        {bundles === null ? <p class="records__muted">{S.loading}</p> : <ProjectionBlock road={road} bundlesLoaded={bundles.length > 0} today={today} />}
        <h3 class="records__h3">{S.beltTimeline}</h3>
        <BeltTimeline road={road} />
        <h3 class="records__h3">{S.arrivalMeansTitle}</h3>
        <p class="records__muted">{S.arrivalMeans}</p>
      </Block>

      <PeraperaRadar />

      <WeakPointMap />

      <Block id="kage" ja={S.kageTitleJa} en={S.kageTitle} lede={S.kageLede}>
        <KageBlock />
      </Block>

      {meta.settings.feel === 'zen' ? null : (
        <Block id="kiai" ja={S.kiaiTitleJa} en={S.kiaiTitle} lede={S.kiaiNote}>
          <div class="records__tiles records__tiles--inline">
            <Tile label={S.ippon} value={stats.ippon} />
            <Tile label={S.bestCombo} value={stats.bestCombo} />
            <Tile label={S.recoveries} value={stats.recoveries} />
          </div>
        </Block>
      )}

      <Block id="reading" ja={S.readingTitleJa} en={S.readingTitle}>
        <p class="records__line">{stats.speedReadBestCpm > 0 ? fill(S.readingBest, { cpm: fmtNum(stats.speedReadBestCpm) }) : S.readingNone}</p>
        <p class="records__muted">{S.readingNote}</p>
        <p class="records__line">{speakingTested ? fill(S.speakingLines, { lines: fmtNum(stats.shadowLines), pass: fmtNum(stats.shadowPass), n: fmtNum(stats.monologues) }) : S.speakingUntested}</p>
      </Block>

      <p class="records__footer">
        <a class="btn" href={href({ name: 'ledger' })}>
          {S.toLedger}
        </a>
      </p>
    </article>
  );
}
