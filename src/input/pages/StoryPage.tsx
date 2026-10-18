/**
 * TSUZUKU — `#/story/:id`: a Tabi Nikki episode read outside a session
 * (design 04 §7, 05 §9), and `#/story/:id/listen`: the 読み聞かせ Read-along
 * (design 08 §10.3). Episode header (title, station link, kind, bridge), the
 * previous episode's recap, the reader, then the result.
 *
 * Read: the reader emits `story:read`; B's reducers grant XP, stats, badges
 * and the ledger row. When the result says B did not log the minutes
 * (`ledgerLogged: false`, e.g. reducers not wired), the page logs them itself
 * through `addLedgerEntry` so a standalone read always reaches the 耳目帳 and
 * never twice.
 *
 * Listen: the reader emits `listen:played` (a `listen` ledger row with
 * `source: app`, 0 XP, never `story:read`). The store's `listen:played`
 * reducer OWNS that row — it may merge the day's Radio and Read-along
 * seconds into one row, so "the ledger did not grow during the emit" is no
 * signal and the page logs nothing itself (a fallback here would double-log).
 * The result card names the heard time, the served rate and voice, the gist
 * self-check and the minutes the reducer logs (`playedMinutes`, the
 * reducer's own rounding), and offers the plain reader ("Read it as an
 * episode" is a first read as before). A missing id shows a calm empty state
 * with ways back.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import { STATIONS, type StoryItem } from '@/content/types';
import { href, type Route } from '@/shared/routes';
import { Ruby } from '@/shared/ui/Ruby';
import { KIND_INDEX, addLedgerEntry, playedMinutes, store } from '@/store';
import { JJ_FROM_STATION, StoryReader, formatHeard, formatRate, isStoryItem, sourceLabel, storyStation, type StoryListenResult, type StoryReadResult } from '../reader/StoryReader';
import { S, fill } from '../reader/strings';
import './StoryPage.css';

export interface StoryPageProps {
  route: Route;
  /** Defaults to the live `content` loader (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
}

/** Ids of the episode before this one, best candidate first: same station `k−1`, else the previous station's 3 → 1. */
export function previousEpisodeIds(id: string): string[] {
  const m = /^s-(\d{2})-(\d)$/.exec(id);
  if (!m) return [];
  const station = Number(m[1]);
  const seq = Number(m[2]);
  if (seq > 1) return [`s-${m[1]}-${seq - 1}`];
  if (station <= 1) return [];
  const prev = String(station - 1).padStart(2, '0');
  return [3, 2, 1].map((k) => `s-${prev}-${k}`);
}

/** Minutes line for the result card. */
export function minutesLine(r: StoryReadResult): string {
  return r.minutes > 0 ? fill(S.resultMinutes, { n: r.minutes }) : S.resultMinutesNone;
}

/**
 * Ledger minutes of a Read-along: the store's own `playedMinutes(seconds)`
 * (`seconds / 60` to a tenth, design 08 §12), so the card names exactly what
 * the `listen:played` reducer logs. Under 3 s rounds to 0 and the reducer
 * logs nothing.
 */
export function listenMinutes(r: Pick<StoryListenResult, 'seconds' | 'heard'>): number {
  return r.heard ? playedMinutes(r.seconds) : 0;
}

/** Ledger line of a Read-along result: nothing heard → nothing logged; under three seconds → nothing logged. */
export function listenMinutesLine(r: Pick<StoryListenResult, 'seconds' | 'heard'>): string {
  if (!r.heard) return S.heardNone;
  const m = listenMinutes(r);
  return m > 0 ? fill(S.resultListenMinutes, { n: m }) : S.resultListenMinutesNone;
}

function tapsLine(n: number): string {
  if (n === 0) return S.resultTapsNone;
  if (n === 1) return S.resultTapsOne;
  return fill(S.resultTaps, { n });
}

type Loaded = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ok'; story: StoryItem };

export default function StoryPage(p: StoryPageProps): JSX.Element {
  const loader = p.loader ?? content;
  const id = p.route.name === 'story' ? p.route.id : null;
  const listen = p.route.name === 'story' && p.route.mode === 'listen';
  const settings = store.settings.value;
  const learnerStation = store.progress.value.station;

  const [loaded, setLoaded] = useState<Loaded>(() => {
    const it = id ? loader.get(id) : undefined;
    return isStoryItem(it) ? { kind: 'ok', story: it } : { kind: 'loading' };
  });
  const [prev, setPrev] = useState<StoryItem | null>(null);
  const [result, setResult] = useState<StoryReadResult | null>(null);
  const [heard, setHeard] = useState<StoryListenResult | null>(null);
  const [readKey, setReadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setHeard(null);
    setPrev(null);
    if (!id) {
      setLoaded({ kind: 'missing' });
      return;
    }
    const sync = loader.get(id);
    if (isStoryItem(sync)) setLoaded({ kind: 'ok', story: sync });
    else {
      setLoaded({ kind: 'loading' });
      loader
        .getAsync(id)
        .then((it) => {
          if (alive) setLoaded(isStoryItem(it) ? { kind: 'ok', story: it } : { kind: 'missing' });
        })
        .catch(() => {
          if (alive) setLoaded({ kind: 'missing' });
        });
    }
    // the previous episode's recap, first candidate that exists
    void (async () => {
      for (const pid of previousEpisodeIds(id)) {
        const hit = loader.get(pid) ?? (await loader.getAsync(pid).catch(() => undefined));
        if (!alive) return;
        if (isStoryItem(hit)) {
          setPrev(hit);
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, listen, loader]);

  const onDone = (r: StoryReadResult): void => {
    setResult(r);
    if (!r.missing && !r.ledgerLogged && r.minutes > 0) {
      addLedgerEntry({ day: store.today(), minutes: r.minutes, kind: KIND_INDEX.read, source: 0 });
    }
  };

  /** The listen row belongs to the store's `listen:played` reducer (it may merge same-day rows); the page only shows the result. */
  const onListened = (r: StoryListenResult): void => {
    setHeard(r);
  };

  const eyebrow = listen ? (
    <div class="eyebrow reader__mode" data-field="mode">
      <span lang="ja">{S.listenTitleJa}</span> {S.listenTitle}
    </div>
  ) : (
    <div class="eyebrow">{S.pageTitle}</div>
  );
  const pageLabel = listen ? S.listenTitle : S.pageTitle;

  if (loaded.kind === 'loading') {
    return (
      <article class="story-page" aria-label={pageLabel} data-state="loading" data-mode={listen ? 'listen' : 'read'}>
        {eyebrow}
        <p class="story-page__note" role="status">
          {S.storyLoading}
        </p>
      </article>
    );
  }

  if (loaded.kind === 'missing') {
    const st = id ? storyStation(id) : undefined;
    return (
      <article class="story-page" aria-label={pageLabel} data-state="missing" data-mode={listen ? 'listen' : 'read'}>
        {eyebrow}
        <div class="story-page__empty" role="status">
          <strong>{S.storyMissing}</strong>
          <p class="story-page__note">{S.storyMissingHint}</p>
          <div class="story-page__actions">
            {st !== undefined && st >= 1 ? (
              <a class="btn" href={href({ name: 'station', n: st })} data-link="station">
                {fill(S.stationLink, { n: st })}
              </a>
            ) : null}
            <a class="btn btn--ghost" href={href({ name: 'road' })} data-link="road">
              {S.backToStation}
            </a>
            <a class="btn btn--ghost" href={href({ name: 'dojo' })} data-link="dojo">
              {S.backToDojo}
            </a>
          </div>
        </div>
      </article>
    );
  }

  const story = loaded.story;
  const station = storyStation(story.id) ?? loader.stationOf(story.id) ?? learnerStation;
  const stationDef = STATIONS.find((s) => s.number === station);
  const jj = settings.jj || learnerStation >= JJ_FROM_STATION;
  const titleMode = settings.furigana === 'off' ? 'off' : 'always';
  const state = listen ? (heard ? 'result' : 'listening') : result ? 'result' : 'reading';

  const navLinks = (
    <>
      <a class="btn btn--ghost" href={href({ name: 'station', n: station })} data-link="station">
        {S.backToStation}
      </a>
      <a class="btn btn--ghost" href={href({ name: 'ledger' })} data-link="ledger">
        {S.toLedger}
      </a>
      <a class="btn btn--ghost" href={href({ name: 'dojo' })} data-link="dojo">
        {S.backToDojo}
      </a>
    </>
  );

  return (
    <article class="story-page" aria-label={pageLabel} data-state={state} data-mode={listen ? 'listen' : 'read'}>
      <header class="story-page__head">
        {eyebrow}
        <h1 class="story-page__title" lang="ja">
          <Ruby ja={story.titleJa} mode={titleMode} />
        </h1>
        <p class="story-page__title-en">{story.titleEn}</p>
        <ul class="story-page__chips" aria-label={S.episodeLabel}>
          <li>
            <a class="chip" href={href({ name: 'station', n: station })} data-link="station">
              {fill(S.stationLink, { n: station })}
              {stationDef ? (
                <>
                  {' · '}
                  <span lang="ja">{stationDef.nameJa}</span> {stationDef.nameRomaji}
                </>
              ) : null}
            </a>
          </li>
          <li class="chip">{story.kind === 'dialogue' ? S.dialogueLabel : S.episodeLabel}</li>
          {story.bridge ? <li class="chip chip--accent">{S.bridgeChip}</li> : null}
        </ul>
        <p class="story-page__note" data-field="standalone-note">
          {listen ? S.listenStandaloneNote : S.standaloneNote}
        </p>
      </header>

      {prev ? (
        <aside class="story-page__recap sheet" data-field="previously" aria-label={S.previously}>
          <h2 class="eyebrow">{S.previously}</h2>
          <p class="story-page__recap-title">{prev.titleEn}</p>
          <p>{prev.recapEn}</p>
        </aside>
      ) : null}

      {listen && heard ? (
        <>
          <section class="story-page__result sheet" aria-label={S.listenResultTitle} data-heard={heard.heard ? 'true' : 'false'} data-field="listen-result">
            <h2>{S.listenResultTitle}</h2>
            <p class="story-page__score" data-field="heard">
              {formatHeard(heard.seconds)}
            </p>
            <ul class="story-page__facts">
              {heard.heard ? (
                <li data-field="rate">
                  {fill(S.listenRate, { rate: formatRate(heard.rate) })} · {fill(S.listenSource, { source: sourceLabel(heard.source) })}
                </li>
              ) : null}
              <li data-field="gist">{heard.gistCorrect === null ? S.listenGistSkipped : heard.gistCorrect ? S.listenGistRight : S.listenGistWrong}</li>
              {heard.answered ? <li data-field="score">{fill(S.questionsScore, { correct: heard.correct, total: heard.total })}</li> : null}
              {heard.heard && heard.cold ? <li data-field="cold">{S.listenCold}</li> : null}
              {heard.authentic ? (
                <li data-mark="true" data-field="authentic">
                  {S.listenAuthentic}
                </li>
              ) : null}
              <li data-field="minutes">{listenMinutesLine(heard)}</li>
            </ul>
            <div class="story-page__actions">
              <button
                type="button"
                class="btn"
                data-action="listen-again"
                onClick={() => {
                  setHeard(null);
                  setReadKey((k) => k + 1);
                }}
              >
                {S.listenAgain}
              </button>
              <a class="btn" href={href({ name: 'story', id: story.id })} data-link="read">
                {S.listenReadIt}
              </a>
              {navLinks}
            </div>
          </section>
          <aside class="story-page__recap sheet" data-field="recap">
            <h2 class="eyebrow">{S.recapLabel}</h2>
            <p>{story.recapEn}</p>
          </aside>
        </>
      ) : null}

      {!listen && result ? (
        <>
          <section class="story-page__result sheet" aria-label={S.resultTitle} data-passed={result.passed ? 'true' : 'false'} data-field="result">
            <h2>{S.resultTitle}</h2>
            <p class="story-page__score" aria-label={fill(S.questionsScore, { correct: result.correct, total: result.total })}>
              {result.correct}/{result.total}
            </p>
            <p class="story-page__note">{result.passed ? S.questionsPassed : S.questionsMissed}</p>
            <ul class="story-page__facts">
              <li data-field="cpm">{result.cpm > 0 ? `${fill(S.resultCpm, { n: result.cpm })} · ${S.bandShort[result.band]}` : S.resultCpmNone}</li>
              {result.cpm > 0 ? <li>{S.band[result.band]}</li> : null}
              <li data-field="taps">{tapsLine(result.glossTaps)}</li>
              {result.hints > 0 ? <li>{fill(S.resultHints, { n: result.hints })}</li> : null}
              {result.dictionaryFree ? (
                <li data-mark="true" data-field="dictionary-free">
                  {S.resultDictionaryFree}
                </li>
              ) : null}
              {result.kaidenConfirmed.length > 0 ? <li data-field="kaiden">{fill(S.resultKaiden, { n: result.kaidenConfirmed.length })}</li> : null}
              <li data-field="minutes">{minutesLine(result)}</li>
            </ul>
            <div class="story-page__actions">
              <button
                type="button"
                class="btn"
                data-action="read-again"
                onClick={() => {
                  setResult(null);
                  setReadKey((k) => k + 1);
                }}
              >
                {S.readAgain}
              </button>
              {navLinks}
            </div>
          </section>
          <aside class="story-page__recap sheet" data-field="recap">
            <h2 class="eyebrow">{S.recapLabel}</h2>
            <p>{story.recapEn}</p>
          </aside>
        </>
      ) : null}

      {listen && !heard ? (
        <StoryReader
          key={`listen:${readKey}`}
          mode="listen"
          storyId={story.id}
          loader={loader}
          sessionId={`listen:${story.id}:${store.today()}`}
          feel={settings.feel}
          furigana={settings.furigana}
          jj={jj}
          station={learnerStation}
          onDone={onListened}
        />
      ) : null}

      {!listen && !result ? (
        <StoryReader
          key={`read:${readKey}`}
          storyId={story.id}
          loader={loader}
          sessionId={`story:${story.id}:${store.today()}`}
          feel={settings.feel}
          furigana={settings.furigana}
          jj={jj}
          station={learnerStation}
          onDone={onDone}
        />
      ) : null}
    </article>
  );
}
