/**
 * TSUZUKU — `#/road` (design 02 §1, §6.2; 01 §4.4 "Road Nav").
 *
 *  The Tōkaidō (`<RoadNav>`), the Kage race strip, the belt legend and the
 *  Projected Arrival lines: after fourteen active days the learner's own pace
 *  ("N3 (Okazaki): March 2027 at your current pace · December 2026 at daily
 *  practice", ±20 %), before that the road's estimates for the preset at 100 %
 *  and 70 % adherence. Never red, never a countdown.
 *
 *  `roadEstimate` follows design 02 §6.2 with one honest addition: stations
 *  whose bundle is not loaded count their `STATIONS` quota (plus the kana for
 *  Stations 1–3) as remaining, so one bundle fetch is enough for the page.
 *  The full-pace rate is the store's `effectiveNewPerDay` (the belt table at
 *  every preset, the stored mix only at custom), so the road, the Dojo
 *  forecast and the builder agree on the budget.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { content, type ContentLoader } from '../../content/loader';
import { BELTS, STATIONS, type Belt, type StationBundle } from '../../content/types';
import { href, navigate, type Route } from '../../shared/routes';
import { dayToCivil } from '../../shared/time';
import type { CardsApi, EpochDay, LogEntry, SaveMeta } from '../../shared/store-types';
import { effectiveNewPerDay, newPerDayTotal, store } from '../../store';
import { SHINSA_STATIONS, activeDaysIn, beltOfStation, bundleItemIds, itemsIntroducedIn, lifetimeActiveDays } from '../../store/derived';
import { BELT_NAME, fill } from '../engine-strings';
import { KageStrip } from '../KageView';
import { RoadNav, kanaReading, romajiAllowed } from '../RoadNav';
import { S } from './strings';
import './pages.css';

export interface RoadPageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
}

/** Kana per White station (design 02 §1: 71 / 79 / 88). */
export const KANA_PER_STATION: Readonly<Record<number, number>> = { 1: 71, 2: 79, 3: 88 };
export const MIN_ACTIVE_DAYS = 14;
const GATE_WAIT_MAX = 7;
const SHINSA_DAYS = 2;
const GATE_DAYS = 1;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Items a station teaches by its quota (fallback when its bundle is not loaded). */
export function quotaTotal(n: number): number {
  const st = STATIONS.find((s) => s.number === n);
  if (!st) return 0;
  return st.quota.vocab + st.quota.kanji + st.quota.grammar + (KANA_PER_STATION[n] ?? 0);
}

function fullRate(m: SaveMeta, belt: Belt): number {
  const npd = effectiveNewPerDay(m.settings, belt);
  return Math.max(1, newPerDayTotal(npd));
}

export interface RoadEstimateInput {
  meta: SaveMeta;
  cards: CardsApi;
  log: readonly LogEntry[];
  /** The current station's bundle when loaded. */
  bundle: StationBundle | null;
  today: EpochDay;
}

export interface PaceLine {
  kind: 'pace';
  target: number;
  atPace: EpochDay;
  daily: EpochDay;
}
export interface OnboardingLine {
  kind: 'onboarding';
  target: number;
  /** Days at 100 % adherence. */
  full: number;
  /** Days at 70 % adherence. */
  seventy: number;
}
export type EstimateLine = PaceLine | OnboardingLine;

/** Targets shown: the next belt exam station (White has none, so Yellow's at 9), then Kyoto. */
export function roadTargets(station: number): number[] {
  const from = Math.max(1, Math.min(53, station));
  const nextExam = SHINSA_STATIONS.find((s) => s >= from);
  const out: number[] = [];
  if (nextExam !== undefined && nextExam !== 53) out.push(nextExam);
  out.push(53);
  return out;
}

/** Design 02 §6.2 (pace) or §6.1 (onboarding) per target. */
export function roadEstimate(o: RoadEstimateInput): EstimateLine[] {
  const m = o.meta;
  const from = Math.max(1, m.progress.station);
  const cleared = new Set(m.progress.stationsCleared);
  const pace = lifetimeActiveDays(m) >= MIN_ACTIVE_DAYS;
  const active = activeDaysIn(m, o.today);
  const adherence = clamp(active / 28, 0.3, 1);
  const realized = pace && active > 0 ? itemsIntroducedIn(o.log as LogEntry[], o.cards, o.today, m.profile.tz) / active : 0;

  return roadTargets(m.progress.station).map((target) => {
    let paceDays = 0;
    let dailyDays = 0;
    let fullDays = 0;
    for (let s = from; s <= target; s++) {
      if (cleared.has(s)) continue;
      const belt = beltOfStation(s);
      const full = fullRate(m, belt);
      let remaining = quotaTotal(s);
      let lastIntro: EpochDay | null = null;
      if (o.bundle && o.bundle.number === s) {
        remaining = 0;
        for (const id of bundleItemIds(o.bundle)) {
          const facets = Object.values(o.cards.byItem(id)).filter((t): t is NonNullable<typeof t> => t !== undefined);
          if (facets.length === 0) remaining++;
          else for (const t of facets) if (lastIntro === null || t[6] > lastIntro) lastIntro = t[6];
        }
      }
      const shinsa = SHINSA_STATIONS.includes(s) ? SHINSA_DAYS : 0;
      if (pace) {
        const rate = clamp(realized, 1, full);
        const gateWait = Math.max(1, GATE_WAIT_MAX - (lastIntro === null ? 0 : Math.max(0, o.today - lastIntro)));
        paceDays += remaining / rate + gateWait + shinsa;
        dailyDays += remaining / full + gateWait + shinsa;
      } else {
        fullDays += remaining / full + GATE_DAYS + shinsa;
      }
    }
    if (pace) {
      return { kind: 'pace', target, atPace: o.today + Math.ceil(paceDays / adherence), daily: o.today + Math.ceil(dailyDays) };
    }
    return { kind: 'onboarding', target, full: Math.ceil(fullDays), seventy: Math.ceil(fullDays / 0.7) };
  });
}

/** `March 2027`. */
export function monthYear(day: EpochDay): string {
  const c = dayToCivil(day);
  return `${S.months[c.month - 1] ?? ''} ${c.year}`;
}

/** `18 months` / `6 weeks` / `3 days`. */
export function spanLabel(days: number): string {
  if (days >= 60) {
    const months = Math.round(days / 30.4);
    return months === 1 ? S.arrivalMonth : fill(S.arrivalMonths, { n: months });
  }
  if (days >= 14) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? S.arrivalWeek : fill(S.arrivalWeeks, { n: weeks });
  }
  return days === 1 ? S.arrivalDay : fill(S.arrivalDays, { n: Math.max(0, days) });
}

/** `Yellow belt (小田原 Odawara)`; the reading follows the kana rule (design 09 §3.3): romaji below Green, kana after. */
export function targetLabel(target: number, romaji = true): string {
  if (target >= 53) return S.arrivalKyoto;
  const st = STATIONS.find((s) => s.number === target);
  const belt = beltOfStation(target);
  const name = st ? `${st.nameJa} ${romaji ? st.nameRomaji : kanaReading(st.nameRomaji)}`.trim() : fill(S.stationShort, { n: target });
  return fill(S.arrivalBelt, { belt: BELT_NAME[belt], station: name });
}

export default function RoadPage(p: RoadPageProps): JSX.Element {
  const loader = p.loader ?? content;
  const progress = store.progress.value;
  const collections = store.collections.value;
  const profile = store.profile.value;
  const romaji = romajiAllowed(profile.belt);
  const cardsVersion = store.cards.version.value;
  const [bundle, setBundle] = useState<StationBundle | null>(null);
  const [lines, setLines] = useState<EstimateLine[] | null>(null);
  const station = progress.station;

  useEffect(() => {
    let alive = true;
    (async () => {
      let b: StationBundle | null = null;
      try {
        b = await loader.station(Math.max(1, station));
      } catch {
        b = null;
      }
      if (!alive) return;
      setBundle(b);
    })();
    return () => {
      alive = false;
    };
  }, [station, loader]);

  useEffect(() => {
    setLines(roadEstimate({ meta: store.meta(), cards: store.cards, log: store.log.recent(5000), bundle, today: store.today() }));
  }, [bundle, cardsVersion, progress]);

  const perfect = Object.entries(collections.stamps)
    .filter(([, e]) => e.perfect)
    .map(([n]) => Number(n));
  const danOpen = profile.dan >= 1 || progress.stationsCleared.includes(53);

  return (
    <section class="page page--road" aria-label={S.roadTitleEn}>
      <header class="page__head">
        <h2 class="page__title">
          <span lang="ja">東海道</span> {S.roadTitleEn}
        </h2>
        <p class="page__sub">{S.roadSub}</p>
        <p class="road-page__thesis">{S.levelLine}</p>
      </header>

      <section class="page__section" aria-label={S.kageStripTitle}>
        <KageStrip />
      </section>

      <section class="page__section road-page__arrival" aria-label={S.arrivalTitle}>
        <h3 class="page__label">{S.arrivalTitle}</h3>
        {lines === null ? (
          <p class="page__muted">{S.loading}</p>
        ) : (
          <>
            {lines.map((l) =>
              l.kind === 'pace' ? (
                <p key={l.target} class="road-page__line" data-kind="pace">
                  {fill(S.arrivalPace, { target: targetLabel(l.target, romaji), pace: monthYear(l.atPace), daily: monthYear(l.daily) })}
                </p>
              ) : (
                <p key={l.target} class="road-page__line" data-kind="onboarding">
                  {fill(S.arrivalOnboarding, { target: targetLabel(l.target, romaji), full: spanLabel(l.full), seventy: spanLabel(l.seventy) })}
                </p>
              ),
            )}
            <p class="page__muted">{lines[0]?.kind === 'pace' ? S.arrivalBand : S.arrivalShown}</p>
          </>
        )}
      </section>

      <section class="page__section" aria-label={S.legendTitle}>
        <h3 class="page__label">{S.legendTitle}</h3>
        <ul class="road-page__legend">
          {BELTS.map((b) => (
            <li key={b.id} class={`belt belt--${b.id}`} title={fill(S.legendLine, { belt: b.nameEn, from: b.stations[0], to: b.stations[1], title: b.titleRomaji })}>
              <span lang="ja">{b.nameJa}</span> {b.nameEn} · {b.stations[0]}–{b.stations[1]}
            </li>
          ))}
        </ul>
      </section>

      <section class="page__section" aria-label={S.roadNavAria}>
        <RoadNav current={station} cleared={progress.stationsCleared} assisted={progress.assisted} perfect={perfect} stationSeen={progress.stationSeen} onPick={(n) => navigate({ name: 'station', n })} />
      </section>

      {danOpen ? (
        <div class="page__actions">
          <a class="btn" href={href({ name: 'dan' })}>
            {S.danLink}
          </a>
        </div>
      ) : null}
    </section>
  );
}
