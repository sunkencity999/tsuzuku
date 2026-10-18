/**
 * TSUZUKU — `<SessionView>`: renders a `SessionRunner` (ARCHITECTURE §4–§5, design 03 §1, §12).
 *
 * The rep loop on screen: the runner's current step → `resolveExercise` →
 * the drill inside D's `<ExerciseFrame>` (fed the runner's index / total / ki /
 * combo / timer / feedback, `now: store.now`) → `onResult` → `runner.submit`
 * → feedback → Continue → `runner.next()`. `<Hud>` above the frame shows the
 * block progress and the Forge Bar; a Michikusa step renders `<MichikusaStep>`
 * (never graded: Continue calls `runner.next()`); when the runner is done the
 * つづく `<EndCard>` takes over with the 次回予告 read asynchronously.
 *
 * Judge protocol (design 05 §6): an exercise calls `requestJudge(shape)` before
 * `onResult`. The view asks `runner.judgeNeeded()` whether this Good is in the
 * deterministic sample; if not, the promise resolves `true` at once and no
 * verdict is recorded. Otherwise a `<JudgeCard>` is shown inside the frame and
 * the pick resolves the promise; the verdict rides on the next `submit()` as
 * `{judge}`. Additive fields the host needs: `answer` for a rubric Judge (no
 * answer → resolves `true`, nothing to verify) and `heard` for a perception
 * Judge (absent → seeded here, and the heard word is spoken through `speak()`).
 * A perception Judge plays its pair through ONE source (design 08 §10.4):
 * `pairClipKeys` resolves both words to clip keys — the item's own id, a pool
 * partner's id, `${id}#pair` for a synthesized partner — and only when the
 * pack is ready and holds both does the heard word carry a key; otherwise
 * neither does and both halves go through the device voice, so timbre never
 * leaks the answer.
 *
 * Scroll blocks (design 03 §2.2: pretest → teach → check): when the runner
 * reaches the first intro check of a Scroll it has not taught yet, the view
 * pauses the runner and unrolls that Scroll's `<TeachCard>`s (its item ids are
 * the intro-check steps that carry the same `scrollId`); "Begin the checks"
 * resumes. A host that teaches itself (`<ScrollView>`) passes `teach={false}`.
 *
 * Leaving mid-session keeps the snapshot (the runner saves after every submit
 * and step), so the Dojo offers "Resume (n reps left)" next time. The Leave
 * dialog is managed by `useDialogFocus` (shared/ui): Stay is focused first,
 * Tab wraps inside it and focus returns to the Leave button when it closes.
 * Escape = Stay: `<ExerciseFrame>` consumes Escape on the window in the
 * capture phase (its pause), before any listener inside the view can see it,
 * so the view registers its own capture listener ahead of the frame
 * (`useEarlyKeydown`, during the first render: child effects run first) and
 * closes the dialog there; the frame then bails on `defaultPrevented`.
 *
 * Speed ring: the ring is on screen exactly when `ringShown(timer, feel)`
 * (runner.ts) — the predicate the runner also hands the writer — so grading
 * and display cannot drift. The contract frame now gates the ring on the
 * `timer` alone and reads `step.timed` only to decide whether its expiry is a
 * hard timeout, so the real step goes to the frame as is; `runner.timeout()`
 * still ignores an untimed one, so an expired soft ring never fails a rep.
 *
 * Shinsa: furigana is off from the Orange exam up (`examFurigana`, design 04
 * §12); the drills receive `furigana: 'off'` in place of the learner's setting.
 *
 * Focus: the Judge Card takes focus when it opens (its dialog, so the 目付
 * title and prompt are read before the options) and the exercise root gets it
 * back after the pick; "Begin the checks" is focused imperatively
 * (`useAutoFocus`), since a dynamic `autofocus` attribute is ignored.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { content as appContent, type ContentLoader } from '../content/loader';
import { BELT_IDS, type ContentItem } from '../content/types';
import { services, speak, type AudioService } from '../shared/audio';
import { resolveExercise, type AttemptResult, type JudgeRequest } from '../shared/exercise-types';
import { rngFor } from '../shared/hash';
import { equivalentJa } from '../shared/jp';
import type { JikaiYokoku, SessionPlan, SessionResult } from '../shared/session-types';
import type { LogEntry } from '../shared/store-types';
import { ExerciseFrame } from '../shared/ui/ExerciseFrame';
import { JudgeCard, type JudgeShape } from '../shared/ui/JudgeCard';
import { useDialogFocus } from '../shared/ui/use-dialog-focus';
import { store } from '../store';
import { beltOfStation } from '../store/derived';
import { EXPECTED_MAX_MINUTES } from '../learn';
import { markKnown } from '../learn/apply';
import { effectiveNewPerDay, introducedToday } from './builder';
import { endCardNotes, jikaiYokoku } from './end-card';
import { S as ENGINE } from './engine-strings';
import { EndCard } from './EndCard';
import { Hud } from './Hud';
import { MichikusaStep } from './MichikusaStep';
import { isVocab } from './params';
import type { SessionRunner } from './runner';
import { isIntroCheck, teachModel, type TeachModel } from './scroll';
import { TeachCard } from './TeachCard';
import { useAutoFocus } from './use-auto-focus';
import { S as PS } from './pages/strings';
import { S } from './strings';
import './SessionView.css';

export interface SessionViewProps {
  runner: SessionRunner;
  /** Leave: the snapshot is kept (or already cleared by a finished run). */
  onExit(): void;
  /** Additive: "Another Kata?" on the end card (defaults to `onExit`). */
  onAnother?(): void;
  /** Additive: extra end-card lines from the page (Kage result, …). */
  notes?: readonly string[];
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: unroll a Scroll's teach cards before its first intro check (default `true`). */
  teach?: boolean;
}

/** Combo tier thresholds (design 01 §4.4; `learn/kiai.comboTier` is not in the `@/learn` barrel). */
export function comboTierOf(combo: number): 0 | 1 | 2 | 3 {
  if (combo >= 50) return 3;
  if (combo >= 25) return 2;
  if (combo >= 10) return 1;
  return 0;
}

/** Judge request with the host-side fields the card needs. */
export type JudgeAsk = JudgeRequest & { answer?: string; heard?: 0 | 1 };

interface PendingJudge {
  shape: JudgeShape;
  resolve(pass: boolean): void;
}

export const SESSION_GAP_MS = 10 * 60_000;

/**
 * Clip keys for a perception Judge's pair (design 08 §8, §10.4): the item's
 * own word is `item.id`, a partner from `distractorIds` its own id, a
 * synthesized partner `${item.id}#pair`. Returns the two keys only when the
 * pack is ready AND holds both clips; otherwise `null`, and the host speaks
 * both words without a key so neither half is a pack voice against a device
 * voice — one source for both words, or the timbre gives the answer away.
 */
export function pairClipKeys(pair: readonly [string, string], item: ContentItem | null, lookup: (id: string) => ContentItem | undefined, distractorIds: readonly string[], audio: AudioService): [string, string] | null {
  if (!audio.packReady?.value || !audio.clipFor || !isVocab(item)) return null;
  const partners = distractorIds.map(lookup).filter(isVocab);
  const keyFor = (w: string): string => {
    if (equivalentJa(item.kana, w) || item.word === w) return item.id;
    const hit = partners.find((v) => equivalentJa(v.kana, w) || v.word === w);
    return hit ? hit.id : `${item.id}#pair`;
  };
  const keys: [string, string] = [keyFor(pair[0]), keyFor(pair[1])];
  return keys.every((k) => audio.clipFor?.(k) !== undefined) ? keys : null;
}

/** Does this plan run with furigana off? A Shinsa from the Orange exam up (design 04 §12 "no furigana (from Orange)"). */
export function examFurigana(plan: Pick<SessionPlan, 'mode' | 'station'>): boolean {
  return plan.mode === 'shinsa' && BELT_IDS.indexOf(beltOfStation(Math.max(1, plan.station))) >= BELT_IDS.indexOf('orange');
}

/**
 * A window-capture keydown listener that precedes `<ExerciseFrame>`'s. The
 * frame registers its own in an effect, and child effects run before the
 * parent's, so this one is bound during the view's first render (once, by
 * ref) and removed on unmount. `handler` is read at call time.
 */
function useEarlyKeydown(handler: (e: KeyboardEvent) => void): void {
  const current = useRef(handler);
  current.current = handler;
  const bound = useRef<((e: KeyboardEvent) => void) | null>(null);
  if (!bound.current && typeof window !== 'undefined') {
    bound.current = (e) => current.current(e);
    window.addEventListener('keydown', bound.current, true);
  }
  useEffect(
    () => () => {
      if (bound.current) window.removeEventListener('keydown', bound.current, true);
      bound.current = null;
    },
    [],
  );
}

/** The Leave confirm: a small modal with the shared focus management (initial focus on Stay, Tab trap, opener restore; Escape arrives through `useEarlyKeydown`). */
function LeaveDialog(p: { onStay(): void; onLeave(): void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { onClose: p.onStay, initial: '[data-stay]' });
  return (
    <div class="session__dialog-backdrop">
      <div ref={ref} tabIndex={-1} class="session__dialog status-window" role="dialog" aria-modal="true" aria-labelledby="session-leave-title">
        <h2 id="session-leave-title" class="session__dialog-title">
          {S.leaveTitle}
        </h2>
        <p class="session__dialog-body">{S.leaveBody}</p>
        <div class="session__dialog-actions">
          <button type="button" class="btn session__leave-keep" onClick={p.onLeave}>
            {S.leaveKeep}
          </button>
          <button type="button" class="hanko session__leave-stay" data-stay onClick={p.onStay}>
            {S.leaveStay}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Error rate of the log session that ended before `before` (entries split on a
 * gap ≥ 10 min). `null` when there is none. Only the Arcade nudge reads it.
 */
export function previousSessionErrorRate(log: readonly LogEntry[], before: number, gapMs = SESSION_GAP_MS): number | null {
  const prior = log.filter((e) => e[0] < before);
  if (prior.length === 0) return null;
  let end = prior.length - 1;
  let start = end;
  while (start > 0 && (prior[start]?.[0] ?? 0) - (prior[start - 1]?.[0] ?? 0) < gapMs) start--;
  const group = prior.slice(start, end + 1);
  const misses = group.filter((e) => e[2] === 1).length;
  return group.length > 0 ? misses / group.length : null;
}

/** The lines under the tally for a finished run (overtraining, cramming, backlog, Arcade nudge). */
export function notesFor(result: SessionResult, plan: SessionRunner['plan']): string[] {
  const today = store.today();
  const settings = store.settings.value;
  const minutesToday = store.daily.value[today]?.minutes ?? result.tally.minutes;
  const preset = settings.intensity === 'custom' ? 'standard' : settings.intensity;
  const intro = introducedToday(today);
  const npd = effectiveNewPerDay(settings, beltOfStation(Math.max(1, plan.station)));
  const target = Math.round(npd.vocab + npd.kanji + npd.grammar);
  const crammingCap = target > 0 && intro.vocab + intro.kanji + intro.grammar >= 2 * target;
  const prev = settings.feel === 'arcade' ? previousSessionErrorRate(store.log.recent(2000), result.startedAt) : null;
  const rates = prev === null ? [1 - result.tally.accuracy] : [prev, 1 - result.tally.accuracy];
  return endCardNotes({
    minutesToday,
    recentErrorRates: result.tally.reps > 0 ? rates : [],
    feel: settings.feel,
    overtrainingAt: Math.round(EXPECTED_MAX_MINUTES[preset] * 1.5),
    crammingCap,
    ...(plan.meta.backlog ? { backlog: { shown: plan.meta.dueTaken, due: plan.meta.dueTotal } } : {}),
  });
}

export function SessionView(p: SessionViewProps): JSX.Element {
  const { runner } = p;
  const loader = p.loader ?? appContent;
  const step = runner.step.value;
  const done = runner.done.value;
  const abandoned = runner.abandoned.value;
  const feedback = runner.feedback.value;
  const kiai = runner.kiai.value;
  const timer = runner.timer.value;
  const index = runner.index.value;
  const total = runner.total.value;
  const settings = store.settings.value;
  const feel = settings.feel;

  const [judge, setJudge] = useState<PendingJudge | null>(null);
  const judgeRef = useRef<PendingJudge | null>(null);
  const verdict = useRef<'pass' | 'fail' | undefined>(undefined);
  /** The verdict that rode on the current step's submit (for the feedback line). */
  const submitted = useRef<'pass' | 'fail' | undefined>(undefined);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  leavingRef.current = leaving;
  // Escape while the Leave dialog is open means Stay, and must not pause the frame (see the header).
  useEarlyKeydown((e) => {
    if (!leavingRef.current || e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    setLeaving(false);
  });
  const [yokoku, setYokoku] = useState<JikaiYokoku | null>(null);
  const [notes, setNotes] = useState<string[] | null>(null);
  const judgeReplay = useRef<(() => void) | null>(null);
  /** Scroll ids whose cards have been unrolled in this view (a resumed run shows them once more; harmless). */
  const taughtScrolls = useRef(new Set<string>());
  const [teaching, setTeaching] = useState<{ scrollId: string; itemIds: string[] } | null>(null);
  const [known, setKnown] = useState<ReadonlySet<string>>(new Set());
  const teachOn = p.teach !== false;
  const teachBegin = useRef<HTMLButtonElement>(null);
  useAutoFocus(teachBegin, [teaching?.scrollId ?? null]);
  const judgeBox = useRef<HTMLDivElement>(null);
  const exerciseBox = useRef<HTMLDivElement>(null);
  const judgeWasOpen = useRef(false);
  // The Judge Card opens silently otherwise: the answer input keeps focus inside the now aria-hidden exercise.
  useEffect(() => {
    if (judge) {
      judgeWasOpen.current = true;
      const box = judgeBox.current;
      const dialog = box?.querySelector<HTMLElement>('[role="dialog"]') ?? box;
      if (!dialog) return;
      if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
      dialog.focus();
    } else if (judgeWasOpen.current) {
      judgeWasOpen.current = false;
      exerciseBox.current?.focus();
    }
  }, [judge]);

  const openJudge = (j: PendingJudge | null): void => {
    judgeRef.current = j;
    setJudge(j);
  };

  // A new step clears any pending Judge (settled as unverified, no verdict) and the verdict.
  const stepId = step?.id ?? null;
  useEffect(() => {
    const stale = judgeRef.current;
    if (stale) {
      openJudge(null);
      stale.resolve(true);
    }
    verdict.current = undefined;
    submitted.current = undefined;
    judgeReplay.current = null;
  }, [stepId]);

  // Scroll block: the first intro check of a Scroll pauses the runner while its cards are read (design 03 §2.2).
  useEffect(() => {
    if (!teachOn || !step || done || abandoned) return;
    const scrollId = step.params.scrollId;
    if (!scrollId || !isIntroCheck(step) || taughtScrolls.current.has(scrollId)) return;
    taughtScrolls.current.add(scrollId);
    const itemIds: string[] = [];
    for (const s of runner.steps()) if (isIntroCheck(s) && s.params.scrollId === scrollId && s.itemId && !itemIds.includes(s.itemId)) itemIds.push(s.itemId);
    if (itemIds.length === 0) return;
    if (!runner.paused.peek()) runner.pause();
    setTeaching({ scrollId, itemIds });
  }, [stepId, teachOn, done, abandoned]); // eslint-disable-line react-hooks/exhaustive-deps

  // The runner stops: leave, or read the 次回予告 for the card.
  useEffect(() => {
    if (abandoned) p.onExit();
  }, [abandoned]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!done) return;
    let alive = true;
    setNotes(notesFor(done, runner.plan));
    jikaiYokoku({ station: runner.plan.station, today: store.today(), loader })
      .then((y) => {
        if (alive) setYokoku(y);
      })
      .catch(() => {
        if (alive) setYokoku({ words: [], milestone: ENGINE.milestoneQuiet });
      });
    return () => {
      alive = false;
    };
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) {
    const extra = p.notes ?? [];
    return (
      <div class="session session--done" data-feel={feel}>
        <EndCard result={done} yokoku={yokoku} notes={[...(notes ?? []), ...extra]} ceremonies={runner.ceremonies} loader={loader} onAnother={p.onAnother ?? p.onExit} onRest={p.onExit} />
      </div>
    );
  }

  if (!step || abandoned) {
    return (
      <div class="session" data-feel={feel} aria-label={S.sessionLabel}>
        <p class="session__loading muted" role="status">
          {S.settingUp}
        </p>
      </div>
    );
  }

  // The live queue (re-queues included); `total` above is the runner's signal for it, so the Hud re-renders on a re-queue.
  const livePlan = { ...runner.plan, steps: runner.steps().slice() };

  const leaveBar = (
    <div class="session__bar">
      <button type="button" class="btn btn--ghost btn--sm session__leave" onClick={() => setLeaving(true)}>
        {S.leave}
      </button>
    </div>
  );

  const leaveDialog = leaving ? (
    <LeaveDialog
      onStay={() => setLeaving(false)}
      onLeave={() => {
        setLeaving(false);
        p.onExit();
      }}
    />
  ) : null;

  const hud = <Hud plan={livePlan} index={index} feel={feel} backlog={runner.plan.meta.backlog} />;

  if (teaching) {
    const models = teaching.itemIds.map((id) => {
      const item = loader.get(id);
      const model = item ? teachModel(item) : null;
      const contrast = model?.contrastId ? loader.get(model.contrastId) : undefined;
      return { id, item, model, contrast: contrast ? teachModel(contrast) : null };
    });
    const beginChecks = (): void => {
      setTeaching(null);
      runner.resume();
    };
    return (
      <div class="session session--teach" data-feel={feel} aria-label={S.sessionLabel} data-scroll={teaching.scrollId}>
        {leaveBar}
        {hud}
        <section class="session__teach" aria-label={PS.teachTitle}>
          <h3 class="session__teach-title">{PS.teachTitle}</h3>
          <p class="session__teach-line muted">{PS.teachLine}</p>
          <div class="session__teach-cards">
            {models.map((m, i) =>
              m.item && m.model ? (
                <TeachCard
                  key={m.id}
                  item={m.item}
                  model={m.model}
                  index={i}
                  total={models.length}
                  furigana={settings.furigana}
                  known={known.has(m.id)}
                  onKnown={() => {
                    markKnown(m.id, (m.model as TeachModel).kind);
                    setKnown((prev) => new Set([...prev, m.id]));
                  }}
                  contrast={m.contrast}
                />
              ) : null,
            )}
          </div>
          <div class="session__teach-actions">
            <button type="button" class="hanko session__teach-begin" onClick={beginChecks} ref={teachBegin}>
              {PS.beginChecks}
            </button>
          </div>
        </section>
        {leaveDialog}
      </div>
    );
  }

  if (step.block === 'michikusa') {
    const id = step.params.michikusaId ?? step.itemId ?? '';
    return (
      <div class="session session--michikusa" data-feel={feel} aria-label={S.sessionLabel}>
        {leaveBar}
        {hud}
        <MichikusaStep key={step.id} id={id} loader={loader} onDone={() => runner.next()} />
        {leaveDialog}
      </div>
    );
  }

  const resolved = resolveExercise(step.exercise);
  const item: ContentItem | null = step.itemId ? (loader.get(step.itemId) ?? null) : null;
  const jj = settings.jj || runner.plan.station >= 34;

  const onResult = (r: AttemptResult): void => {
    const v = verdict.current;
    verdict.current = undefined;
    submitted.current = v;
    runner.submit(r, v ? { judge: v } : {});
  };

  // The runner surfaces only a failed check; a passed one is worth its line too ("The inspector agrees").
  const shownFeedback = feedback && submitted.current === 'pass' && !feedback.judge ? { ...feedback, judge: 'pass' as const } : feedback;

  const requestJudge = (o: JudgeAsk): Promise<boolean> => {
    const current = runner.step.value;
    if (!current || current.id !== step.id || runner.feedback.value || runner.done.value) return Promise.resolve(true);
    const sampled = runner.judgeNeeded({ correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: runner.elapsedMs(), errorTags: [], selfRating: 3 });
    if (!sampled) return Promise.resolve(true);
    let shape: JudgeShape;
    if ('rubric' in o) {
      if (o.answer === undefined) return Promise.resolve(true);
      shape = { rubric: o.rubric, regex: o.regex, answer: o.answer };
    } else if ('minimalPair' in o) {
      const heard = o.heard ?? (rngFor(store.seed(), runner.plan.id, step.id, 'heard')() < 0.5 ? 0 : 1);
      shape = { minimalPair: o.minimalPair, heard };
      const word = o.minimalPair[heard];
      // One source for both halves (design 08 §10.4): a clip key only when the pack holds both words.
      const clip = pairClipKeys(o.minimalPair, item, (id) => loader.get(id), step.params.distractorIds ?? [], services.audio)?.[heard];
      judgeReplay.current = () => {
        void speak(word, clip ? { clip } : undefined);
      };
      judgeReplay.current();
    } else {
      shape = { correct: o.correct, distractors: o.distractors };
    }
    return new Promise<boolean>((resolve) => {
      openJudge({ shape, resolve });
    });
  };

  /** The learner picked on the Judge Card: record the verdict for the next submit and settle the exercise's promise. */
  const onJudgePick = (pass: boolean): void => {
    const pending = judgeRef.current;
    if (!pending) return;
    verdict.current = pass ? 'pass' : 'fail';
    judgeReplay.current = null;
    openJudge(null);
    pending.resolve(pass);
  };

  const furigana = examFurigana(runner.plan) ? 'off' : settings.furigana;
  const frameProps = {
    step,
    index,
    total,
    ki: kiai.ki,
    combo: kiai.combo,
    comboTier: comboTierOf(kiai.combo),
    timer,
    feel,
    feedback: shownFeedback,
    now: () => store.now(),
    onGuard: () => runner.guard(),
    onHint: () => runner.hint(),
    onPause: () => runner.pause(),
    onResume: () => runner.resume(),
    onContinue: () => runner.next(),
    onTimeout: () => runner.timeout(),
  };

  if (!resolved) {
    return (
      <div class="session" data-feel={feel} aria-label={S.sessionLabel}>
        {leaveBar}
        {hud}
        <ExerciseFrame {...frameProps}>
          <div class="session__missing notice" role="status">
            <p class="session__missing-title">{S.drillMissingTitle}</p>
            <p class="session__missing-body">{S.drillMissingBody}</p>
            <div class="session__missing-actions">
              {!feedback ? (
                <button type="button" class="btn session__missing-guard" onClick={() => runner.guard()}>
                  {S.drillMissingGuard}
                </button>
              ) : null}
              <button type="button" class="btn btn--ghost session__missing-leave" onClick={() => p.onExit()}>
                {S.leaveKeep}
              </button>
            </div>
          </div>
        </ExerciseFrame>
        {leaveDialog}
      </div>
    );
  }

  const { Component } = resolved;
  const judgeRng = rngFor(store.seed(), runner.plan.id, step.id, 'judge');

  return (
    <div class="session" role="region" data-feel={feel} data-exercise={step.exercise} aria-label={S.sessionLabel}>
      {leaveBar}
      {hud}
      <ExerciseFrame {...frameProps}>
        <div class="session__exercise" ref={exerciseBox} tabIndex={-1} aria-hidden={judge ? 'true' : undefined}>
          <Component
            key={step.id}
            step={step}
            item={item}
            feel={feel}
            furigana={furigana}
            jj={jj}
            speedTier={settings.speedTier}
            exposures={step.exposures}
            onResult={onResult}
            onHint={() => runner.hint()}
            onReplay={() => undefined}
            requestJudge={requestJudge}
          />
        </div>
        {judge ? (
          <div class="session__judge" ref={judgeBox}>
            <JudgeCard {...judge.shape} rng={judgeRng} onPick={onJudgePick} onReplay={judgeReplay.current ? () => judgeReplay.current?.() : undefined} />
          </div>
        ) : null}
      </ExerciseFrame>
      {leaveDialog}
    </div>
  );
}
