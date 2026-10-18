/**
 * TSUZUKU — `<KageView>`: the versus screen against your own shadow (design 03 §11).
 *
 *  Your name against your silhouette, DotGothic numbers (best of four weeks,
 *  last run), the hi-score table whose "Factory defaults" rows are multiples of
 *  your own first score, the standing line, then the Ghost Set itself through
 *  `<SessionView>` and the result (accuracy × speed index × 1000). A second run
 *  in the same week is free play: `finishKage` writes nothing. Arcade skin via
 *  tokens (`--neon-c` / `--neon-m`, `--font-pixel`); nothing here taunts.
 *
 *  The Ghost Set's runner never touches the training snapshot (`persist:
 *  false`) and leaving the room mid-run abandons it.
 *
 *  Design 09 §2.5 / §5.6–§5.8 / §10 D1: the arcade is a woodblock print — the
 *  heads are `.poster-title` (Dela, 1 px misregistration, kentō marks), the
 *  digits are Dela `<Ticker roll>`s (the cabinet roll, d59), the lanes are
 *  `.meter`s, the hi-score table is arcade.css's `.hiscore`, and the BEST
 *  eyebrow appears in the result ONLY when the run passed the learner's OWN
 *  best of four weeks — never another learner, never a global, never on a miss
 *  (footnote 5). The table's factory initials (katakana, kage.ts) carry their
 *  romaji while kana are below Green and stand alone from Green on (§3.3).
 *  Nothing glows. Back is a route turn: the View Transition's kasure is the
 *  result panel's exit.
 *
 *  `<KageStrip>` is the compact race strip the Road page shows.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { content as appContent, type ContentLoader } from '../content/loader';
import type { DrillId } from '../content/types';
import { href } from '../shared/routes';
import type { SessionPlan } from '../shared/session-types';
import { weekOf } from '../shared/time';
import type { KageState } from '../shared/store-types';
import { Ticker } from '../shared/ui/Ticker';
import { romajiAllowed } from '../art/road/reading';
import { store } from '../store';
import { S as AS } from './arcade-strings';
import { fill } from './engine-strings';
import { buildKage, finishKage, hiScoreTable, kageResultLine, kageStanding, scoreKage, type HiScoreRow, type KageScore } from './kage';
import { SessionRunner } from './runner';
import { SessionHost, type SessionViewComponent } from './ScrollView';
import { S } from './pages/strings';
import './KageView.css';

export interface KageViewProps {
  onExit(): void;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
  /** Additive: a prebuilt Ghost Set (tests); skips `buildKage`. */
  plan?: SessionPlan;
  /** Additive: called with the runner this view creates (hosts, tests). */
  onRunner?(r: SessionRunner): void;
}

export type KageStage = 'standing' | 'building' | 'failed' | 'empty' | 'run' | 'result';

const digits = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Dela digits that roll (the cabinet roll, `data-roll`) with thin-space grouping, never a countdown. */
export function Digits(p: { value: number; label?: string; size?: 'md' | 'lg' }): JSX.Element {
  return (
    <span class={`kage-digits kage-digits--${p.size ?? 'md'}`} aria-label={p.label ? `${p.label}: ${p.value}` : undefined}>
      <Ticker value={p.value} format={digits} roll />
    </span>
  );
}

export function HiScoreTable(p: { rows: HiScoreRow[] }): JSX.Element {
  // design 09 §3.3: the katakana initials read with romaji only below Green kana
  const romaji = romajiAllowed(store.profile.value.belt);
  return (
    <table class="kage-table hiscore" aria-label={S.kageTableTitle}>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{S.kageYou}</th>
          <th scope="col">{S.kageScore}</th>
          <th scope="col">{S.kageFactory}</th>
        </tr>
      </thead>
      <tbody>
        {p.rows.map((r, i) => (
          <tr key={`${r.initials}-${r.week ?? 'f'}-${i}`} data-factory={r.factory ? 'true' : 'false'}>
            <td>{i + 1}</td>
            <td>
              {r.factory ? (
                <>
                  <span lang="ja">{r.initials}</span>
                  {romaji && AS.kageInitials[r.initials] ? <span class="kage-table__romaji"> {AS.kageInitials[r.initials]}</span> : null}
                </>
              ) : (
                r.initials
              )}
            </td>
            <td>
              <Digits value={r.score} />
            </td>
            <td>{r.factory ? S.kageFactory : r.week !== undefined ? fill(S.kageWeek, { n: r.week }) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Versus(p: { name: string; best: number; last: number | null }): JSX.Element {
  return (
    <div class="kage-versus halftone" aria-label={S.kageTitle}>
      <div class="kage-versus__side kage-versus__side--you">
        <span class="kage-versus__name">{p.name}</span>
        <span class="kage-versus__label">{S.kageLast}</span>
        <Digits value={p.last ?? 0} size="lg" label={S.kageLast} />
      </div>
      <span class="kage-versus__vs" aria-hidden="true">
        VS
      </span>
      <div class="kage-versus__side kage-versus__side--kage">
        <span class="kage-versus__silhouette" aria-hidden="true" />
        <span class="kage-versus__name">
          <span lang="ja">影</span> {S.kageShadow}
        </span>
        <span class="kage-versus__label">{S.kageBest}</span>
        <Digits value={p.best} size="lg" label={S.kageBest} />
      </div>
    </div>
  );
}

export function KageView(p: KageViewProps): JSX.Element {
  const loader = p.loader ?? appContent;
  const [stage, setStage] = useState<KageStage>('standing');
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [score, setScore] = useState<KageScore | null>(null);
  const [outcome, setOutcome] = useState<{ beat: boolean; counted: boolean; firstRun: boolean; bestBefore: number } | null>(null);
  const [, setTick] = useState(0);
  const finished = useRef(false);
  const kage: KageState = store.kage.value;
  const today = store.today();
  const standing = kageStanding(kage, today);
  const name = store.profile.value.name;

  useEffect(() => {
    if (!runner) return;
    return effect(() => {
      void runner.index.value;
      void runner.feedback.value;
      setTick((t) => t + 1);
      if (runner.done.value) setStage('result');
    });
  }, [runner]);

  useEffect(() => {
    if (stage !== 'result' || !runner || finished.current) return;
    finished.current = true;
    const firstRun = store.kage.value.history.length === 0;
    // the learner's OWN best before this run: the only number the BEST eyebrow ever compares with
    const bestBefore = kageStanding(store.kage.value, store.today()).best;
    const sc = scoreKage(runner.results, store.medianMs.value);
    const out = finishKage(sc.score, weekOf(store.today()));
    setScore(sc);
    setOutcome({ ...out, firstRun, bestBefore });
  }, [stage, runner]);

  useEffect(
    () => () => {
      if (runner && !runner.done.peek() && !runner.abandoned.peek()) runner.abandon();
    },
    [runner],
  );

  const begin = async (): Promise<void> => {
    setStage('building');
    setScore(null);
    setOutcome(null);
    finished.current = false;
    try {
      const plan = p.plan ?? (await buildKage(today, store.seed(), { loader, available: p.available }));
      if (plan.steps.length === 0) {
        setStage('empty');
        return;
      }
      const r = new SessionRunner(plan, { loader, persist: false });
      p.onRunner?.(r);
      setRunner(r);
      setStage('run');
    } catch {
      setStage('failed');
    }
  };

  const leave = (): void => {
    if (runner && !runner.done.value && !runner.abandoned.value) runner.abandon();
    p.onExit();
  };

  const table = <HiScoreTable rows={hiScoreTable(store.kage.value)} />;

  if (stage === 'building') {
    return (
      <section class="kage-view" aria-label={S.kageAria} aria-busy="true">
        <p role="status">{S.kageBuilding}</p>
      </section>
    );
  }

  if (stage === 'failed' || stage === 'empty') {
    return (
      <section class="kage-view" aria-label={S.kageAria}>
        <div class="notice notice--warn">
          <p>{stage === 'empty' ? S.kageNotEnough : S.kageBuildFailed}</p>
          <button type="button" class="btn" onClick={p.onExit}>
            {S.backToDojo}
          </button>
        </div>
      </section>
    );
  }

  if (stage === 'run' && runner) {
    return (
      <section class="kage-view" aria-label={S.kageAria} data-stage="run">
        <SessionHost runner={runner} onExit={leave} view={p.view} />
      </section>
    );
  }

  if (stage === 'result' && runner && score) {
    const line = outcome ? kageResultLine(outcome.beat, outcome.firstRun) : '';
    const best = outcome !== null && outcome.beat && outcome.counted && outcome.bestBefore > 0;
    return (
      <section class="kage-view" aria-label={S.kageAria} data-stage="result" data-beat={outcome?.beat ? 'true' : 'false'}>
        <h2 class="kage-view__title poster-title poster-title--m">{AS.kageResultPoster}</h2>
        <p class="eyebrow kage-view__eyebrow">{S.kageResultTitle}</p>
        {best ? <p class="eyebrow kage-view__best">{fill(AS.kageBest, { n: outcome.bestBefore })}</p> : null}
        <p class="kage-view__score">
          <Digits value={score.score} size="lg" label={S.kageScore} />
        </p>
        <dl class="kage-view__facts">
          <div>
            <dt>{S.kageAccuracy}</dt>
            <dd>{fill(S.percent, { n: Math.round(score.accuracy * 100) })}</dd>
          </div>
          <div>
            <dt>{S.kageSpeed}</dt>
            <dd>{score.speedIndex.toFixed(2)}</dd>
          </div>
        </dl>
        <p class="kage-view__line">{line}</p>
        <p class="kage-view__sub">{outcome?.counted ? S.kageCounted : S.kageNotCounted}</p>
        {table}
        <div class="kage-view__actions">
          <button type="button" class="btn" onClick={p.onExit}>
            {S.backToDojo}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="kage-view" aria-label={S.kageAria} data-stage="standing">
      <h2 class="kage-view__title poster-title">{AS.kagePoster}</h2>
      <p class="eyebrow kage-view__eyebrow">{S.kageTitle}</p>
      <Versus name={name} best={standing.best} last={standing.lastScore} />
      <p class="kage-view__line">{standing.line}</p>
      <p class="kage-view__sub">{S.kageSetLine}</p>
      {!standing.due ? <p class="kage-view__sub">{S.kageFreePlayLine}</p> : null}
      {table}
      <div class="kage-view__actions">
        <button type="button" class="hanko" onClick={() => void begin()}>
          {standing.due ? S.kageRun : S.kageFreePlay}
        </button>
        <button type="button" class="btn btn--ghost" onClick={p.onExit}>
          {S.backToDojo}
        </button>
      </div>
    </section>
  );
}

/** Compact race strip for the Road and Dojo: you (last run) against your shadow (best of four weeks). */
export function KageStrip(): JSX.Element {
  const standing = kageStanding(store.kage.value, store.today());
  const max = Math.max(1, standing.best, standing.lastScore ?? 0);
  const you = standing.lastScore ?? 0;
  const state = standing.due ? S.kageStripDue : standing.beatenThisWeek ? S.kageStripBeat : S.kageStripRun;
  return (
    <a class="kage-strip" href={href({ name: 'train', mode: 'kage' })} aria-label={`${S.kageStripTitle} · ${state}`} data-due={standing.due ? 'true' : 'false'}>
      <span class="kage-strip__title">
        <span lang="ja">影</span> {S.kageStripTitle}
      </span>
      <span class="kage-strip__lanes" aria-hidden="true">
        <span class="eyebrow kage-strip__lane-label">{AS.kageLaneYou}</span>
        <span class="meter kage-strip__lane kage-strip__lane--you" style={{ '--value': String(you / max) }}>
          <span class="meter__fill" />
        </span>
        <span class="eyebrow kage-strip__lane-label">{AS.kageLaneShadow}</span>
        <span class="meter kage-strip__lane kage-strip__lane--kage" style={{ '--value': String(standing.best / max) }}>
          <span class="meter__fill" />
        </span>
      </span>
      <span class="kage-strip__meta">
        {state} · {standing.lastScore === null ? S.kageStripNone : fill(S.kageStripLast, { n: standing.lastScore })} · {fill(S.kageStripBest, { n: standing.best })}
      </span>
    </a>
  );
}
