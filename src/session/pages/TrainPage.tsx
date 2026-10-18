/**
 * TSUZUKU — `#/train/:mode` (design 03 §2, §11, §12; ARCHITECTURE §6).
 *
 * Builds the plan for the mode (`buildPlan`; the Kage Ghost Set through
 * `buildKage`) or offers to resume the saved snapshot ("Resume (6 reps left)" /
 * "Start fresh"), shows a short pre-roll of what is coming (blocks, reps,
 * minutes — `plannedReps` / `plannedMs`, so the +3 / +10 steps new cards owe
 * and their teach cards are in the total, shown as "~N reps" when they add
 * to the planned count; the versus table for Kage), then hands a `SessionRunner` to
 * `<SessionView>`. Rapid Fire and Gojūon Fighter are ordinary plans with one
 * arcade step. `gate`, `shinsa` and `dan` have their own rooms and redirect; a
 * stale snapshot of such a fight (boss rooms never resume) is abandoned on the
 * way so the Dojo stops offering it. Snapshots are read through `loadSnapshot`
 * (one whose card keys are malformed is neither offered nor resumed; the next
 * run's save replaces it). Leaving keeps the snapshot (the runner
 * saves after every rep); "Another Kata?" on the end card starts a fresh Kata
 * at once. Mode titles render the Japanese half under `lang="ja"`. The
 * Begin / Resume buttons take focus imperatively (`useAutoFocus`): a dynamic
 * `autofocus` attribute is ignored once anything on the page has been focused.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { content as appContent, type ContentLoader } from '../../content/loader';
import type { DrillId } from '../../content/types';
import { href, navigate, type Route } from '../../shared/routes';
import type { SessionMode, SessionPlan, SessionSnapshot } from '../../shared/session-types';
import { weekOf } from '../../shared/time';
import { store } from '../../store';
import { beltOfStation } from '../../store/derived';
import { plannedMs, plannedReps } from '../blocks';
import { buildPlan } from '../builder';
import { buildKage, finishKage, hiScoreTable, kageResultLine, kageStanding, scoreKage } from '../kage';
import { SessionRunner } from '../runner';
import { loadSnapshot } from '../snapshot';
import { SessionView } from '../SessionView';
import { S, fill } from '../strings';
import { useAutoFocus } from '../use-auto-focus';
import './TrainPage.css';

export interface TrainPageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability for the builder (default: the registry). */
  available?: (id: DrillId) => boolean;
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'resume'; snap: SessionSnapshot }
  | { kind: 'building' }
  | { kind: 'preroll'; plan: SessionPlan }
  | { kind: 'running'; runner: SessionRunner }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'redirect' };

/** Modes with their own room: `train/<mode>` walks there instead. */
export function redirectFor(mode: SessionMode, station: number): Route | null {
  if (mode === 'gate') return { name: 'gate', n: Math.max(1, station) };
  if (mode === 'shinsa') return { name: 'shinsa', belt: beltOfStation(Math.max(1, station)) };
  if (mode === 'dan') return { name: 'dan' };
  return null;
}

/** Graded reps left in a snapshot (steps with a card behind them — the Leave slip's count, d37); 0 when it is spent. */
export function snapshotStepsLeft(snap: SessionSnapshot | null): number {
  if (!snap) return 0;
  return snap.plan.steps.slice(snap.cursor).filter((s) => s.cardKey !== null).length;
}

function fmtMinutes(min: number): string {
  const n = Math.max(1, Math.round(min));
  return n === 1 ? S.estMinutesOne : fill(S.estMinutes, { n });
}

function fmtReps(n: number): string {
  return n === 1 ? S.repsCountOne : fill(S.repsCount, { n });
}

/** `型 Kata`: the Japanese half under `lang="ja"`, the English half plain (design 01 §7). */
function ModeTitle(p: { mode: SessionMode }): JSX.Element {
  return (
    <>
      <span lang="ja">{S.modeNameJa[p.mode]}</span> {S.modeNameEn[p.mode]}
    </>
  );
}

export default function TrainPage(p: TrainPageProps): JSX.Element {
  const loader = p.loader ?? appContent;
  const mode: SessionMode = p.route.name === 'train' ? p.route.mode : 'kata';
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [kageNotes, setKageNotes] = useState<string[]>([]);
  const alive = useRef(true);
  const kageDone = useRef<string | null>(null);
  // The one primary button of the resume / pre-roll screens (rendered after load, so `autofocus` would be ignored).
  const primary = useRef<HTMLButtonElement>(null);
  useAutoFocus(primary, [phase.kind]);

  const build = async (m: SessionMode, autoStart: boolean): Promise<void> => {
    setPhase({ kind: 'building' });
    try {
      const o = { loader, ...(p.available ? { available: p.available } : {}) };
      const plan = m === 'kage' ? await buildKage(store.today(), store.seed(), o) : await buildPlan(m, o);
      if (!alive.current) return;
      if (plan.steps.length === 0) {
        setPhase({ kind: 'empty' });
        return;
      }
      if (autoStart) setPhase({ kind: 'running', runner: new SessionRunner(plan, { loader }) });
      else setPhase({ kind: 'preroll', plan });
    } catch (err) {
      console.error('[train] plan failed', err);
      if (alive.current) setPhase({ kind: 'error' });
    }
  };

  useEffect(() => {
    alive.current = true;
    setKageNotes([]);
    kageDone.current = null;
    const redirect = redirectFor(mode, store.progress.value.station);
    if (redirect) {
      // A boss / exam fight is never resumed (design 04 §11): a snapshot left by an older build is abandoned, not offered.
      const stale = loadSnapshot();
      if (stale && stale.plan.mode === mode) new SessionRunner(stale.plan, { resumed: stale, loader }).abandon();
      setPhase({ kind: 'redirect' });
      navigate(redirect, { replace: true });
      return () => {
        alive.current = false;
      };
    }
    const snap = loadSnapshot();
    if (snap && snapshotStepsLeft(snap) > 0) setPhase({ kind: 'resume', snap });
    else void build(mode, false);
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Kage: score and record the week's run once the set is finished (a same-week rerun is free play).
  const runner = phase.kind === 'running' ? phase.runner : null;
  const done = runner?.done.value ?? null;
  useEffect(() => {
    if (!runner || !done || runner.plan.mode !== 'kage' || kageDone.current === runner.plan.id) return;
    kageDone.current = runner.plan.id;
    const firstRun = store.kage.value.history.length === 0;
    const score = scoreKage(done.steps, store.medianMs.value);
    const { beat, counted } = finishKage(score.score, weekOf(store.today()));
    const lines = [fill(S.kageScoreLine, { score: score.score, acc: Math.round(score.accuracy * 100), speed: score.speedIndex.toFixed(2) })];
    lines.push(counted ? kageResultLine(beat, firstRun) : S.kageFreePlay);
    setKageNotes(lines);
  }, [runner, done]);

  const toDojo = (): void => navigate({ name: 'dojo' });

  const resume = (snap: SessionSnapshot): void => {
    const r = SessionRunner.resume({ loader }) ?? new SessionRunner(snap.plan, { resumed: snap, loader });
    setPhase({ kind: 'running', runner: r });
  };

  const startFresh = (snap: SessionSnapshot): void => {
    // The old run leaves with its fact on the bus and no card; the snapshot is cleared with it.
    new SessionRunner(snap.plan, { resumed: snap, loader }).abandon();
    void build(mode, false);
  };

  const begin = (plan: SessionPlan): void => {
    setPhase({ kind: 'running', runner: new SessionRunner(plan, { loader }) });
  };

  const back = (
    <a class="btn btn--ghost train__back" href={href({ name: 'dojo' })}>
      {S.backToDojo}
    </a>
  );

  switch (phase.kind) {
    case 'checking':
    case 'building':
      return (
        <section class="train" data-mode={mode} data-phase={phase.kind} aria-label={S.trainAria}>
          <p class="train__status muted" role="status">
            {S.building}
          </p>
        </section>
      );
    case 'redirect':
      return (
        <section class="train" data-mode={mode} data-phase="redirect" aria-label={S.trainAria}>
          <p class="train__status muted" role="status">
            {S.redirecting}
          </p>
        </section>
      );
    case 'error':
      return (
        <section class="train" data-mode={mode} data-phase="error" aria-label={S.trainAria}>
          <p class="train__status notice notice--warn" role="alert">
            {S.buildFailed}
          </p>
          <div class="train__actions">
            <button type="button" class="hanko" onClick={() => void build(mode, false)}>
              {S.begin}
            </button>
            {back}
          </div>
        </section>
      );
    case 'empty':
      return (
        <section class="train" data-mode={mode} data-phase="empty" aria-label={S.trainAria}>
          <h1 class="train__title">
            <ModeTitle mode={mode} />
          </h1>
          <p class="train__status empty" role="status">
            {S.emptyPlan}
          </p>
          <div class="train__actions">{back}</div>
        </section>
      );
    case 'resume': {
      const left = snapshotStepsLeft(phase.snap);
      return (
        <section class="train train__resume" data-mode={mode} data-phase="resume" aria-label={S.trainAria}>
          <h1 class="train__title">{S.resumeTitle}</h1>
          <p class="train__line">
            <ModeTitle mode={phase.snap.plan.mode} />
          </p>
          <p class="train__body muted">{S.resumeBody}</p>
          <div class="train__actions">
            <button type="button" class="hanko train__resume-btn" onClick={() => resume(phase.snap)} ref={primary}>
              {fill(S.resumeLine, { n: left })}
            </button>
            <button type="button" class="btn train__fresh-btn" onClick={() => startFresh(phase.snap)}>
              {S.startFresh}
            </button>
            {back}
          </div>
        </section>
      );
    }
    case 'preroll': {
      const plan = phase.plan;
      // What the runner will serve, learning steps included (an upper bound: Easy-rated intros owe none), hence "~".
      const minutes = plannedMs(plan.steps, plan.mode, store.medianMs.value) / 60_000;
      const reps = plannedReps(plan.steps, plan.mode);
      const approx = reps !== plan.steps.filter((s) => s.block !== 'michikusa').length;
      const kage = plan.mode === 'kage' ? kageStanding(store.kage.value, store.today()) : null;
      const table = kage ? hiScoreTable(store.kage.value) : [];
      return (
        <section class="train train__preroll" data-mode={mode} data-phase="preroll" aria-label={S.trainAria}>
          <header class="train__head">
            <h1 class="train__title">
              <ModeTitle mode={plan.mode} />
            </h1>
            <p class="train__line">{S.modeLine[plan.mode]}</p>
          </header>
          <section class="train__coming status-window" aria-label={S.preRollAria}>
            <ol class="train__blocks">
              {plan.blocks
                .filter((b) => b.stepIds.length > 0)
                .map((b, i) => (
                  <li key={`${b.kind}-${i}`} class="train__block" data-kind={b.kind}>
                    <span class="train__block-label">{b.label}</span>
                    <span class="train__block-meta muted">
                      {fmtReps(b.stepIds.length)} · {fmtMinutes(b.estMinutes)}
                    </span>
                  </li>
                ))}
            </ol>
            <p class="train__totals">
              <span class="train__total">{approx ? fill(S.repsAbout, { n: reps }) : fmtReps(reps)}</span>
              <span class="train__total">{fmtMinutes(minutes)}</span>
              {plan.meta.dueTotal > 0 ? <span class="train__total muted">{fill(S.dueTaken, { taken: plan.meta.dueTaken, due: plan.meta.dueTotal })}</span> : null}
              {plan.meta.newCount > 0 ? <span class="train__total muted">{plan.meta.newCount === 1 ? S.newItemOne : fill(S.newItems, { n: plan.meta.newCount })}</span> : null}
              {plan.meta.michikusaId ? <span class="train__total muted">{S.michikusaInSession}</span> : null}
            </p>
            {plan.meta.backlog ? <p class="train__backlog notice">{fill(S.backlogLine, { shown: plan.meta.dueTaken, due: plan.meta.dueTotal })}</p> : null}
          </section>
          {kage ? (
            <section class="train__kage status-window" aria-label={S.kageTitle}>
              <h2 class="train__h2">{S.kageTitle}</h2>
              <p class="train__line">{kage.line}</p>
              {table.length > 0 ? (
                <table class="train__table" aria-label={S.kageTableAria}>
                  <tbody>
                    {table.map((row, i) => (
                      <tr key={`${row.initials}-${i}`} data-factory={row.factory ? 'true' : undefined}>
                        <td class="train__rank">{i + 1}</td>
                        <td class="train__initials" lang={row.factory ? 'ja' : undefined}>
                          {row.initials}
                        </td>
                        <td class="train__score">{row.score}</td>
                        <td class="train__when muted">{row.factory ? S.kageFactory : row.week !== undefined ? fill(S.kageWeek, { n: row.week }) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : null}
          <div class="train__actions">
            <button type="button" class="hanko hanko--lg train__begin" onClick={() => begin(plan)} ref={primary}>
              {S.begin}
            </button>
            {back}
          </div>
        </section>
      );
    }
    case 'running':
      return (
        <section class="train train__running" data-mode={mode} data-phase="running" aria-label={S.trainAria}>
          <SessionView runner={phase.runner} loader={loader} notes={kageNotes} onExit={toDojo} onAnother={() => void build('kata', true)} />
        </section>
      );
  }
}
