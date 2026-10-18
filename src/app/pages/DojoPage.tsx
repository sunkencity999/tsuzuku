/**
 * TSUZUKU — 道場 the home screen (group A, design 03 §3, §6–§8, §11–§12; 06 §5).
 *
 * `pages.ts` injects `Scene` (G's DojoScene, or nothing while it lands),
 * `feed` (E's `dojoFeed`, or null) and `gate` (E's `gateForecast`, or null).
 * The page renders synchronously from the store — flame, quests, resume card,
 * belt line — and fills the forecast, teaser, Kage, Nemesis, Gatekeeper and
 * Shinsa panels when the feed resolves. A missing or failing feed degrades to
 * `derived.forecastCounts()`: the three session buttons always work. That
 * fallback knows of no Scroll for today, so when `gate` is present it is run
 * with 0 scrolls and the Scroll block minutes come off the Kumite / Shugyō
 * estimates exactly as the live feed takes them off (`gateForecast` is E's;
 * A only imports its type and receives the function through `pages.ts`).
 * Never a countdown, never a red number.
 */
import type { FunctionComponent, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { STATIONS, type Belt } from '@/content/types';
import { href, type Route } from '@/shared/routes';
import type { DojoFeed, SessionMode, SessionSnapshot } from '@/shared/session-types';
import { QUESTS, questProgress, store, type QuestProgress } from '@/store';
import { forecastCounts, streakState, type FlameState } from '@/store/derived';
import type { DojoFeedFull, gateForecast } from '@/session/dojo-feed';
import { isFirstRun } from '../first-run';
import { BELT_NAME, S, fmt, num } from './strings';
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

export interface DojoPageProps {
  route: Route;
  /** G's `DojoScene`; `pages.ts` passes an empty component until the art lands. */
  Scene?: FunctionComponent<{ compact?: boolean }> | null;
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

function stationName(n: number): { ja: string; romaji: string; gateEn: string } {
  const s = STATIONS.find((st) => st.number === n);
  if (s) return { ja: s.nameJa, romaji: s.nameRomaji, gateEn: s.gateEn };
  return n <= 0 ? { ja: S.onbTitleJa, romaji: S.onbTitle, gateEn: '' } : { ja: '三条大橋', romaji: 'Sanjō Ōhashi', gateEn: '' };
}

function beltName(b: Belt): string {
  return BELT_NAME[b] ?? b;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sub-views                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function SessionButtons(p: { feed: Feed }): JSX.Element {
  const { minutes, due = 0, scrolls, episodes } = p.feed;
  const counts: Record<SessionMode, string | null> = {
    kata: dueLine(due),
    kumite: scrolls === undefined ? null : scrolls === 1 ? S.dojoScrollOne : fmt(S.dojoScrolls, { n: scrolls }),
    shugyo: episodes === undefined ? null : episodes >= 1 ? S.dojoEpisodeOne : null,
    kage: null,
    weak: null,
    rapid: null,
    gojuon: null,
    gate: null,
    shinsa: null,
    scroll: null,
    welcome: null,
    dan: null,
  };
  return (
    <div class="dojo__sessions" role="list">
      {SESSION_MODES_SHOWN.map((s) => {
        const min = Math.max(1, Math.round(minutes[s.mode as keyof DojoFeed['minutes']]));
        return (
          <a
            key={s.mode}
            role="listitem"
            class="hanko dojo__session"
            href={href({ name: 'train', mode: s.mode })}
            aria-label={fmt(S.dojoStartSession, { name: s.name, n: min })}
            data-mode={s.mode}
          >
            <span class="dojo__session-name">
              <span class="dojo__session-ja brush" lang="ja" aria-hidden="true">
                {s.ja}
              </span>
              <span>{s.name}</span>
              <span class="dojo__session-min">{fmt(S.dojoMinutes, { n: min })}</span>
            </span>
            <span class="dojo__session-desc">{s.desc}</span>
            {counts[s.mode] ? <span class="dojo__session-count">{counts[s.mode]}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

/**
 * 茶屋ラジオ tile (design 08 §10.2): a quiet link under the session buttons.
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

function Quests(): JSX.Element {
  const list = questProgress(store);
  const allDone = list.length > 0 && list.every((q) => q.done);
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
          {list.map((q) => (
            <li key={q.id} class="dojo__quest" data-done={q.done ? 'true' : 'false'} data-quest={q.id}>
              <span class="dojo__quest-mark" aria-hidden="true">
                {q.done ? '✓' : ''}
              </span>
              <span class="dojo__quest-title">{questTitle(q.id)}</span>
              <span class="dojo__quest-count">{q.done ? S.dojoQuestDone : fmt(S.dojoQuestOf, { n: q.n, target: q.target })}</span>
              <span class="visually-hidden">{q.done ? S.dojoQuestDone : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {allDone ? <p class="page__status">{S.dojoQuestsDone}</p> : null}
    </section>
  );
}

function ResumeCard(p: { snap: SessionSnapshot; onFresh(): void }): JSX.Element {
  const left = stepsLeft(p.snap);
  return (
    <section class="status-window dojo__resume" aria-label={S.dojoResumeTitle}>
      <p class="dojo__resume-text">
        <strong>{S.dojoResumeTitle}</strong> {S.dojoResumeHint}
      </p>
      <a class="hanko" href={href({ name: 'train', mode: p.snap.plan.mode })} data-resume>
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
        <a class="hanko" href={href({ name: 'gate', n: g.station })}>
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
        <a class="hanko" href={href({ name: 'shinsa', belt: s.belt })}>
          {S.dojoShinsaCta}
        </a>
      ) : null}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function DojoPage(p: DojoPageProps): JSX.Element {
  const profile = store.profile.value;
  const progress = store.progress.value;
  const cardsVersion = store.cards.version.value;
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
  const flame = streakState();
  const station = progress.station;
  const here = stationName(station);
  const nextN = Math.min(53, Math.max(1, station + 1));
  const next = stationName(nextN);
  const Scene = p.Scene ?? null;
  const welcome = progress.welcomeBackDue ? 'comeback' : progress.awayDays >= 7 ? 'mountain' : 'none';

  const onFresh = (): void => {
    store.session.clear();
    setSnap(null);
  };

  return (
    <div class="page dojo" data-feed={status}>
      <h1 class="visually-hidden">{S.dojoTitle}</h1>

      {welcome !== 'none' ? (
        <section class="notice dojo__banner" role="status" data-welcome={welcome}>
          <p class="dojo__banner-text">
            <strong>{S.dojoKept}</strong> {welcome === 'comeback' ? S.dojoWelcomeBack : S.dojoMountain}
          </p>
          {welcome === 'comeback' ? (
            <a class="hanko" href={href({ name: 'train', mode: 'welcome' })}>
              {S.dojoTrain}
            </a>
          ) : null}
        </section>
      ) : null}

      {Scene ? (
        <div class="dojo__scene" aria-label={S.dojoSceneLabel} role="img">
          <Scene />
        </div>
      ) : null}

      <section class="status-window dojo__status" aria-label={S.dojoForecast}>
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
          <span class="flame" data-state={flame} aria-hidden="true">
            <span class="flame__glyph">火</span>
          </span>
          <span data-flame={flame}>{FLAME_TEXT[flame]}</span>
        </p>
        <p class="dojo__line">
          <span class={`belt belt--${profile.belt}`} data-belt={profile.belt}>
            {fmt(S.dojoBeltStatus, { belt: beltName(profile.belt), n: station })}
          </span>
          <span lang="ja">{here.ja}</span>
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
          {snap && stepsLeft(snap) > 0 ? <ResumeCard snap={snap} onFresh={onFresh} /> : null}
          <section class="page__section" aria-labelledby="dojo-sessions">
            <h2 id="dojo-sessions" class="visually-hidden">
              {S.dojoSessions}
            </h2>
            <SessionButtons feed={feed} />
          </section>
          <RadioTile feed={feed} />
          <Quests />
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
          <div class="dojo__side">
            <Teaser feed={feed} />
            {feed.sentenceOfDay ? (
              <section class="panel dojo__tategaki" aria-label={S.dojoSentenceOfDay}>
                <p class="tategaki" lang="ja">
                  {feed.sentenceOfDay.ja}
                </p>
                <span class="visually-hidden" lang="ja">
                  {feed.sentenceOfDay.kana}
                </span>
              </section>
            ) : null}
          </div>
        </>
      )}

      <section class="page__section" aria-labelledby="dojo-road">
        <h2 id="dojo-road">
          {S.dojoRoad}
          <span class="ja" lang="ja">
            {S.dojoRoadJa}
          </span>
        </h2>
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
          <p class="dojo__proverb" lang="ja" aria-label={S.dojoProverb}>
            {feed.proverb}
          </p>
        ) : null}
      </section>
    </div>
  );
}
