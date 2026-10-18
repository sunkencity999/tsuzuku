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
 *
 * Motion (design 09 §7 F, I, J; §12.1 d7, d33):
 *   J · step to step — the step host `.session__step` is keyed by the step, so
 *     the incoming step mounts as `.ink-nijimi` from 8 px right; the outgoing
 *     one is a GHOST: a static `cloneNode` of the old wrapper (taken during the
 *     render that swaps steps, before Preact commits), appended to the inert
 *     `.session__ghosts` layer with `data-leaving` and removed on `animationend`
 *     or after `GHOST_FALLBACK_MS`; no ghost where the engine runs no animations
 *     (jsdom), none of the holds under reduced motion (`exitsPlay`). The live
 *     exercise unmounts synchronously, so no stale handler survives, and the new
 *     step is interactive at once.
 *   I · the ink dot — one effect per graded attempt: `sfx(sfxForGrade(...))`
 *     (silent in Zen, never more than one sound) and, under the Arcade feel, the
 *     hit-stop: `.is-hitstop` (transform: scale(.995)) held for `HIT_STOP_MS`.
 *   F · the Leave slip is a `.tanzaku` over a `.tanzaku__backdrop`; the runner
 *     pauses while it is open (no ring runs behind it) and resumes on Stay.
 *     Where a page turn will run (`pageTurns`) Leave calls `onExit` at once and
 *     the slip stays mounted, whole, so the turn's old snapshot captures its
 *     `view-transition-name: shiori` (§7 F); otherwise Leave sets `data-leaving`
 *     on slip and backdrop and runs `onExit` on `animationend` / a fallback —
 *     under reduced motion the --dur-fade fade motion.css declares. One
 *     `submit` tap. No second step, no timer, no guilt line.
 *   d33 · when `done` flips the whole session view is ghosted once more and held
 *     under `data-leaving` (kasure down, --dur-1) and the End Card mounts when
 *     the hold ends; under reduced motion it mounts at once.
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { content as appContent, type ContentLoader } from '../content/loader';
import { BELT_IDS, type ContentItem } from '../content/types';
import { services, sfx, speak, type AudioService } from '../shared/audio';
import type { SfxName } from '../shared/catalog';
import { resolveExercise, type AttemptResult, type FeedbackState, type JudgeRequest } from '../shared/exercise-types';
import { rngFor } from '../shared/hash';
import { equivalentJa } from '../shared/jp';
import type { JikaiYokoku, SessionPlan, SessionResult } from '../shared/session-types';
import type { LogEntry } from '../shared/store-types';
import { ExerciseFrame, animationsRun, exitsPlay, onExitEnd, pressRing } from '../shared/ui/ExerciseFrame';
import { JudgeCard, type JudgeShape } from '../shared/ui/JudgeCard';
import { useDialogFocus } from '../shared/ui/use-dialog-focus';
import { prefersReducedMotion } from '../shared/ui/use-reveal';
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
import { S, fill } from './strings';
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

/** The Arcade hit-stop: one held frame-and-a-bit (design 09 §6.8, §12.1 d7); a JS class, never a keyframe. */
export const HIT_STOP_MS = 33;
/** Longest a ghost (an outgoing step, the held session, the leaving slip) stays when no `animationend` arrives; the kasure itself is --dur-1. */
export const GHOST_FALLBACK_MS = 200;

/**
 * The one sound of a graded attempt (design 01 §5, 09 §7 I): correct by combo
 * tier — the arpeggio, then G5 / C6 added at tiers 2 / 3 — `ippon` for an
 * Ippon, the soft donk for a miss or a timeout, the anvil tap for a near miss
 * or a Guard (the learner committed; nothing to celebrate, nothing to mourn),
 * nothing for a plain note. Never a buzzer.
 */
export function sfxForGrade(fb: Pick<FeedbackState, 'kind' | 'ippon'>, tier: 0 | 1 | 2 | 3): SfxName | null {
  switch (fb.kind) {
    case 'correct':
      if (fb.ippon) return 'ippon';
      return tier >= 3 ? 'correct-tier3' : tier === 2 ? 'correct-tier2' : 'correct';
    case 'wrong':
    case 'timeout':
      return 'wrong';
    case 'near':
    case 'guard':
      return 'submit';
    default:
      return null;
  }
}

/**
 * A page turn will run on the next navigation: the View Transitions API is
 * there, motion is not reduced and the tab is visible (the gates App.tsx's
 * `canTransition` applies, minus the ceremony probe the session cannot see).
 * The Leave slip then stays on screen for the turn's snapshot (§7 F).
 */
export function pageTurns(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as Document & { startViewTransition?: unknown };
  return typeof d.startViewTransition === 'function' && !prefersReducedMotion() && !document.hidden;
}

/**
 * A static clone of `el` for an exit: no ids (the live tree keeps them), inert
 * and hidden from assistive tech, `data-leaving` for the kasure. The clone has
 * no listeners (cloneNode copies none), so nothing in it can act. A fresh node
 * would start every CSS animation its classes declare (tiles from opacity 0,
 * strokes from dashoffset 1), so each descendant is frozen at its drawn end
 * state and only the wrapper's kasure plays; typed values are carried over
 * (cloneNode copies the `value` attribute, not what was typed).
 */
export function ghostOf(el: HTMLElement, className: string): HTMLElement {
  const g = el.cloneNode(true) as HTMLElement;
  g.className = className;
  g.setAttribute('data-leaving', '');
  g.setAttribute('aria-hidden', 'true');
  g.setAttribute('inert', '');
  g.removeAttribute('role');
  g.removeAttribute('aria-label');
  g.removeAttribute('tabindex');
  for (const n of Array.from(g.querySelectorAll<HTMLElement>('*'))) {
    n.removeAttribute('id');
    n.style.animation = 'none';
    n.style.transition = 'none';
  }
  type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const live = Array.from(el.querySelectorAll<Field>('input, textarea, select'));
  Array.from(g.querySelectorAll<Field>('input, textarea, select')).forEach((f, i) => {
    const src = live[i];
    if (src) f.value = src.value;
  });
  return g;
}

/** Shows `ghost` in `host` until its exit animation ends (or the fallback fires), then calls `onGone`. Returns a canceller. */
export function mountGhost(host: HTMLElement, ghost: HTMLElement, onGone?: () => void): () => void {
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ghost.removeEventListener('animationend', onEnd);
    ghost.remove();
    onGone?.();
  };
  const onEnd = (e: Event): void => {
    if (e.target === ghost) finish();
  };
  ghost.addEventListener('animationend', onEnd);
  const timer = setTimeout(finish, GHOST_FALLBACK_MS);
  host.replaceChildren(ghost);
  return finish;
}

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

/**
 * The Leave slip (design 09 §5.12, §7 F Shiori): a `.tanzaku` laid in from the
 * top edge over a sumi backdrop, the honest `S.leaveBody` and the remaining rep
 * count as a small vermilion mark. Shared focus management (initial focus on
 * Stay, Tab trap, opener restore; Escape arrives through `useEarlyKeydown`);
 * the §5.3 press ring comes from the session root's delegated listener.
 * Leave: where a page turn will run (`pageTurns`) `onLeave(true)` fires at
 * once and the slip stays whole for the turn's snapshot — `data-shiori` is the
 * hook for the `view-transition-name: shiori` rule in SessionView.css, and the
 * out turn carries it to the Dojo's Resume ribbon. Otherwise `data-leaving`
 * (slip and backdrop kasure out; a --dur-fade fade under reduced motion) and
 * `onLeave(false)` when the exit ends — at once where no animation runs. While
 * leaving the slip is inert and hidden from assistive tech (no modal that is
 * not modal). One `submit` tap, never in Zen.
 */
function LeaveDialog(p: { onStay(): void; onLeave(departing: boolean): void; remaining: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const fired = useRef(false);
  const onLeave = useRef(p.onLeave);
  onLeave.current = p.onLeave;
  useDialogFocus(ref, { onClose: p.onStay, initial: '[data-stay]' });
  const gone = (departing: boolean): void => {
    if (fired.current) return;
    fired.current = true;
    if (store.settings.peek().feel !== 'zen') sfx('submit');
    onLeave.current(departing);
  };
  useEffect(() => {
    if (!leaving || !ref.current) return;
    return onExitEnd(ref.current, () => gone(false));
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps
  const leave = (): void => {
    if (leaving || fired.current) return;
    if (pageTurns()) {
      gone(true);
      return;
    }
    if (animationsRun()) setLeaving(true);
    else gone(false);
  };
  const out = leaving ? '' : undefined;
  return (
    <>
      <div class="tanzaku__backdrop" data-leaving={out} />
      <div
        ref={ref}
        tabIndex={-1}
        class="tanzaku session__dialog"
        role="dialog"
        aria-modal={leaving ? undefined : 'true'}
        aria-hidden={leaving ? 'true' : undefined}
        inert={leaving || undefined}
        aria-labelledby="session-leave-title"
        data-shiori
        data-leaving={out}
      >
        <div class="session__dialog-body status-window">
          <h2 id="session-leave-title" class="session__dialog-title">
            {S.leaveTitle}
          </h2>
          <p class="session__dialog-copy">{S.leaveBody}</p>
          <p class="session__dialog-left">{fill(p.remaining === 1 ? S.leaveLeftOne : S.leaveLeft, { n: p.remaining })}</p>
        </div>
        <div class="session__dialog-actions">
          <button type="button" class="btn session__leave-keep" onClick={leave}>
            {S.leaveKeep}
          </button>
          <button type="button" class="hanko session__leave-stay" data-stay onClick={p.onStay}>
            {S.leaveStay}
          </button>
        </div>
      </div>
    </>
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
  /** The runner was paused for the slip (not by the frame or the teach phase): Stay resumes it. */
  const pausedForLeave = useRef(false);
  // The slip is the spec's no-timer surface (§7 F): the runner pauses while it is open, so no rep can expire behind it.
  const openLeave = (): void => {
    if (!runner.paused.peek()) {
      runner.pause();
      pausedForLeave.current = true;
    }
    setLeaving(true);
  };
  const stay = (): void => {
    if (pausedForLeave.current) {
      pausedForLeave.current = false;
      runner.resume();
    }
    setLeaving(false);
  };
  // Escape while the Leave dialog is open means Stay, and must not pause the frame (see the header).
  useEarlyKeydown((e) => {
    if (!leavingRef.current || e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    stay();
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
  const sessionRoot = useRef<HTMLDivElement | null>(null);
  const ringOff = useRef<(() => void) | null>(null);
  // Every hanko of the view (Continue, Stay, Begin the checks, the Michikusa Continue, the End Card's) takes the §5.3 ring from one delegated listener on the root.
  const bindRoot = useCallback((el: HTMLDivElement | null): void => {
    if (el === sessionRoot.current) return;
    ringOff.current?.();
    ringOff.current = el ? pressRing(el) : null;
    sessionRoot.current = el;
  }, []);
  const stepBox = useRef<HTMLDivElement>(null);
  const ghostHost = useRef<HTMLDivElement>(null);
  const endHost = useRef<HTMLDivElement>(null);
  const [, rerender] = useState(0);
  const bump = (): void => rerender((n) => n + 1);
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

  // J · the outgoing step becomes a ghost: cloned here, during the render that swaps steps (the DOM
  // still shows the old step), mounted in the layout effect below, removed when its kasure ends.
  const lastStepId = useRef<string | null>(null);
  const pendingGhost = useRef<HTMLElement | null>(null);
  if (stepId !== lastStepId.current) {
    if (lastStepId.current !== null && stepId !== null && stepBox.current && animationsRun()) pendingGhost.current = ghostOf(stepBox.current, 'session__step session__ghost rm-fade');
    lastStepId.current = stepId;
  }
  useLayoutEffect(() => {
    const g = pendingGhost.current;
    pendingGhost.current = null;
    const host = ghostHost.current;
    if (!g || !host) return;
    return mountGhost(host, g);
  }, [stepId]);

  // d33 · the finished session is held under data-leaving (kasure down) before the End Card mounts.
  const doneSeen = useRef(false);
  const endGhost = useRef<HTMLElement | null>(null);
  if (done && !doneSeen.current) {
    doneSeen.current = true;
    if (exitsPlay() && sessionRoot.current) endGhost.current = ghostOf(sessionRoot.current, 'session session--held');
  }
  useLayoutEffect(() => {
    const g = endGhost.current;
    const host = endHost.current;
    if (!done || !g || !host) return;
    let alive = true;
    const cancel = mountGhost(host, g, () => {
      endGhost.current = null;
      if (alive) bump();
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [done]);

  // I · one sound per graded attempt, by kind and combo tier (never in Zen); the Arcade hit-stop.
  useEffect(() => {
    if (!feedback) return;
    if (feel !== 'zen') {
      const name = sfxForGrade(feedback, comboTierOf(kiai.combo));
      if (name) sfx(name);
    }
    const root = sessionRoot.current;
    if (feel !== 'arcade' || !root || prefersReducedMotion()) return;
    root.classList.add('is-hitstop');
    const t = setTimeout(() => root.classList.remove('is-hitstop'), HIT_STOP_MS);
    return () => {
      clearTimeout(t);
      root.classList.remove('is-hitstop');
    };
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (endGhost.current) {
      return (
        <div class="session session--ending" data-feel={feel} aria-label={S.sessionLabel} ref={bindRoot}>
          <div class="session__ghosts session__ghosts--end" ref={endHost} />
        </div>
      );
    }
    const extra = p.notes ?? [];
    return (
      <div class="session session--done" data-feel={feel} ref={bindRoot}>
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
      <button type="button" class="btn btn--ghost btn--sm session__leave" onClick={openLeave}>
        {S.leave}
      </button>
    </div>
  );

  // Reps as the tally counts them: the steps ahead that carry a card (a Michikusa or an output prompt is not a rep).
  const leaveDialog = leaving ? (
    <LeaveDialog
      remaining={livePlan.steps.slice(index).filter((s) => s.cardKey !== null).length}
      onStay={stay}
      onLeave={(departing) => {
        pausedForLeave.current = false;
        // a page turn snapshots the slip where it stands; otherwise it has already left
        if (!departing) setLeaving(false);
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
      <div class="session session--teach" data-feel={feel} aria-label={S.sessionLabel} data-scroll={teaching.scrollId} ref={bindRoot}>
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
      <div class="session session--michikusa" data-feel={feel} aria-label={S.sessionLabel} ref={bindRoot}>
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
      <div class="session" data-feel={feel} aria-label={S.sessionLabel} ref={bindRoot}>
        {leaveBar}
        {hud}
        <ExerciseFrame {...frameProps} held={leaving}>
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
    <div class="session" role="region" data-feel={feel} data-exercise={step.exercise} aria-label={S.sessionLabel} ref={bindRoot}>
      {leaveBar}
      {hud}
      <ExerciseFrame {...frameProps} held={leaving}>
        <div class="session__exercise" ref={exerciseBox} tabIndex={-1} aria-hidden={judge ? 'true' : undefined}>
          <div key={step.id} class="session__step ink-nijimi" ref={stepBox}>
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
          <div class="session__ghosts" ref={ghostHost} aria-hidden="true" />
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
