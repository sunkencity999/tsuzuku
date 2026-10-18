/**
 * TSUZUKU — `<ExerciseFrame>`: the shared frame around every drill (ARCHITECTURE §4).
 *
 * E (SessionView/GateView/ShinsaView) wraps the resolved exercise in it and
 * feeds the runner's `ki/combo/timer/feedback`. The frame owns the keyboard
 * (design 04 §0 / 01 §7) — exercises never bind keys:
 *   1–9          pick a choice (the handler the exercise registered through
 *                `useExerciseKeys`, else the `onChoice` prop; index is 0-based)
 *   Enter        continue when feedback shows; else the registered `onSubmit`
 *   Space        continue when feedback shows; else replay (registered / prop)
 *   ?            the registered `onHint` — the drill's own reveal, which calls
 *                `ExerciseProps.onHint` so the host counts the hint; inert (and
 *                the footer Hint button hidden) while the latest registered
 *                set offers none. The frame never charges a hint by itself.
 *   Shift+Enter  guard · Esc pause / resume
 * Keys typed into an input/textarea are left alone except Shift+Enter, Esc and
 * Enter-to-continue (captured before the input sees it).
 *
 * Handler sets: 1–9 / Enter / Space go to the LAST registered set that names
 * one of those handlers (a parent's `useExerciseKeys` registers after its
 * children's, so the parent wins). A set registered with `onHint` alone is
 * transparent to them, so a drill may add its hint beside a child `ChoiceGrid`
 * / `TextAnswer` without shadowing their keys; `?` reads the last registered
 * set of either kind, so an open `JudgeCard` (keyed, no hint) hides the hint.
 *
 * Speed ring: on screen whenever a `timer` is given and the feel is not Zen;
 * `step.timed` only decides whether its expiry is a hard timeout
 * (`onTimeout`, `data-timed-out`). An untimed step's ring is soft
 * (`data-soft`): it runs out (`data-expired`) and nothing else happens. Zen
 * hides ki, combo and the ring.
 *
 * Pause: the overlay is a focus-managed dialog (`useDialogFocus` — Resume
 * takes focus imperatively, Tab wraps, the opener gets focus back on resume)
 * and the head, body and controls are `inert` + `aria-hidden` while it is up.
 * Resume is immediate (the runner and the inert flags flip at once, the opener
 * is focused again); the overlay alone stays for its kasure exit
 * (`data-leaving`, design 09 §6.3) — inert, hidden from assistive tech and no
 * longer `aria-modal`, so nothing can land in it — unmounting on
 * `animationend` or after `EXIT_FALLBACK_MS`, at once under reduced motion
 * and where the engine runs no animations (`exitsPlay`). `held` (additive):
 * the host holds the frame — the Leave slip is open — and the ring stops.
 *
 * Motion (design 09 §7 I): the ki bar is a `.meter` whose `--value` hiku-fills;
 * a full bar charges the Continue hanko (`hanko--charged`, a static ring —
 * CSS in ui.css); `.hanko.is-pressed` rides pointerdown / pointerup for the
 * ink-bleed ring (§5.3) through one delegated listener on the frame.
 *
 * The exit helpers here (`animationsRun`, `exitsPlay`, `onExitEnd`,
 * `pressRing`) are shared by TeachOnce, the Leave slip and the session view.
 */
import { createContext, type JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ExerciseFrameProps as ContractProps } from '../exercise-types';
import { Feedback, feedbackAnnouncement } from './Feedback';
import { S, fill } from './strings';
import { useDialogFocus } from './use-dialog-focus';
import { prefersReducedMotion } from './use-reveal';
import { useTimer } from './use-timer';
import './ui.css';

/** Longest an exit (`data-leaving`) is held when no `animationend` arrives (a cancelled animation); the kasure itself is --dur-1. */
export const EXIT_FALLBACK_MS = 200;

/** The engine reports animations (Web Animations). jsdom and old WebViews do not: there an exit is instant, nothing waits on an event that never comes. */
export function animationsRun(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.getAnimations === 'function';
}

/** An exit may play: the engine animates and motion is not reduced (design 09 §6.6: reduced exits are instant). */
export function exitsPlay(): boolean {
  return animationsRun() && !prefersReducedMotion();
}

/** Calls `onGone` once when `el`'s own exit animation ends, or after `EXIT_FALLBACK_MS`. Returns a canceller. */
export function onExitEnd(el: HTMLElement, onGone: () => void): () => void {
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.removeEventListener('animationend', onEnd);
    onGone();
  };
  const onEnd = (e: Event): void => {
    if (e.target === el) finish();
  };
  el.addEventListener('animationend', onEnd);
  const timer = setTimeout(finish, EXIT_FALLBACK_MS);
  return () => {
    done = true;
    clearTimeout(timer);
    el.removeEventListener('animationend', onEnd);
  };
}

/** `.hanko.is-pressed` on pointerdown (design 09 §5.3); the body lives in press-ring.ts so the shell can bind it too (d41). */
import { pressRing } from './press-ring';
export { pressRing };

/* ── context: exercises register handlers instead of binding keys ───────── */

export interface ExerciseKeyHandlers {
  /** Digit `n` (1–9) → `onChoice(n − 1)`. */
  onChoice?(index: number): void;
  /** Space (no feedback showing). */
  onReplay?(): void;
  /** Enter outside an input (no feedback showing). */
  onSubmit?(): void;
  /** `?` key and the footer Hint button (no feedback showing): open the drill's hint; it calls `ExerciseProps.onHint`. */
  onHint?(): void;
}

export interface ExerciseFrameApi {
  register(h: ExerciseKeyHandlers): () => void;
  /** Re-evaluates whether a hint is on offer (`useExerciseKeys` calls it when its `onHint` appears or goes). */
  refresh(): void;
  /** False outside a frame (tests, previews). */
  readonly inFrame: boolean;
}

export const ExerciseFrameContext = createContext<ExerciseFrameApi>({
  register: () => () => undefined,
  refresh: () => undefined,
  inFrame: false,
});

export function useExerciseFrame(): ExerciseFrameApi {
  return useContext(ExerciseFrameContext);
}

function isKeyed(h: ExerciseKeyHandlers): boolean {
  return h.onChoice !== undefined || h.onReplay !== undefined || h.onSubmit !== undefined;
}

/**
 * Registers the exercise's key handlers with the enclosing frame (latest
 * closures are used). A set without `onChoice`/`onReplay`/`onSubmit` at mount
 * registers as hint-only and never shadows a child's keys.
 */
export function useExerciseKeys(h: ExerciseKeyHandlers): void {
  const api = useContext(ExerciseFrameContext);
  const ref = useRef(h);
  ref.current = h;
  const keyed = useRef(isKeyed(h));
  const hasHint = h.onHint !== undefined;
  useEffect(() => {
    const reg: ExerciseKeyHandlers = {
      get onHint() {
        return ref.current.onHint ? (): void => ref.current.onHint?.() : undefined;
      },
    };
    if (keyed.current) {
      reg.onChoice = (i) => ref.current.onChoice?.(i);
      reg.onReplay = () => ref.current.onReplay?.();
      reg.onSubmit = () => ref.current.onSubmit?.();
    }
    return api.register(reg);
  }, [api]);
  useEffect(() => {
    api.refresh();
  }, [api, hasHint]);
}

/* ── props ──────────────────────────────────────────────────────────────── */

export interface ExerciseFrameProps extends ContractProps {
  /** Injected clock for the speed ring (`store.now`); `timer.startedAt` is read on this clock. */
  now?: () => number;
  /** Hard deadline reached on a `step.timed` step (ring empty). Not called for a soft ring. */
  onTimeout?(): void;
  /** 「もう一度」 on the feedback card; the button is hidden when absent. */
  onAgain?(): void;
  /** Resume after a pause (the frame keeps its own pause overlay). */
  onResume?(): void;
  /** The host holds the frame (the Leave slip is open): the speed ring stops and nothing times out. */
  held?: boolean;
}

const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type);
  }
  return false;
}

const STEP_TAG_LABEL: Record<NonNullable<ContractProps['step']['stepTag']>, string> = {
  intro: S.introStep,
  '+3': '+3',
  '+10': '+10',
  recovery: S.recoveryStep,
  relearn: S.relearnStep,
};

/* ── pause overlay ──────────────────────────────────────────────────────── */

/**
 * Mounted while paused, unmounted on resume, so the mount-only `useDialogFocus`
 * sees its root: Resume is focused imperatively (a dynamic `autofocus` is
 * ignored once the document has focused anything), Tab wraps and the opener
 * is focused again on unmount. Escape is consumed earlier by the frame's
 * capture-phase listener (resume); the hook's own Escape path is a backstop.
 */
function PauseOverlay(p: { onResume(): void; leaving: boolean; onGone(): void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Read before the dialog hook moves focus: the opener gets focus back the moment the overlay starts leaving, not when it unmounts.
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useDialogFocus(ref, { onClose: p.onResume, initial: '.hanko' });
  const gone = useRef(p.onGone);
  gone.current = p.onGone;
  useEffect(() => {
    if (!p.leaving || !ref.current) return;
    const o = opener.current;
    if (o && o.isConnected) o.focus();
    return onExitEnd(ref.current, () => gone.current());
  }, [p.leaving]);
  const leaving = p.leaving;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      class="pause-overlay ink-nijimi"
      style="--from: 0 0"
      role="dialog"
      aria-modal={leaving ? undefined : 'true'}
      aria-hidden={leaving ? 'true' : undefined}
      inert={leaving || undefined}
      aria-label={S.paused}
      data-leaving={leaving ? '' : undefined}
    >
      <div class="pause-overlay__card status-window">
        <span class="pause-overlay__kanji" lang="ja" aria-hidden="true">
          休憩
        </span>
        <p>{S.paused}</p>
        <button type="button" class="hanko" onClick={p.onResume}>
          {S.resumeButton}
        </button>
      </div>
    </div>
  );
}

/* ── the frame ──────────────────────────────────────────────────────────── */

export function ExerciseFrame(p: ExerciseFrameProps): JSX.Element {
  const [paused, setPaused] = useState(false);
  /** The overlay's own life: `open` while paused, `leaving` for its kasure after resume, `null` gone. */
  const [overlay, setOverlay] = useState<'open' | 'leaving' | null>(null);
  const [hasHint, setHasHint] = useState(false);
  const props = useRef(p);
  props.current = p;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const handlers = useRef<Set<ExerciseKeyHandlers>>(new Set());

  // Latest registered KEYED set wins 1–9 / Enter / Space (the innermost exercise registers last).
  const latest = (): ExerciseKeyHandlers | undefined => {
    let last: ExerciseKeyHandlers | undefined;
    for (const h of handlers.current) if (isKeyed(h)) last = h;
    return last;
  };
  // `?` reads the last set of either kind: a keyed set without a hint (JudgeCard) hides it.
  const latestHint = (): (() => void) | undefined => {
    let last: ExerciseKeyHandlers | undefined;
    for (const h of handlers.current) last = h;
    return last?.onHint ? () => last?.onHint?.() : undefined;
  };

  const api = useMemo<ExerciseFrameApi>(() => {
    const refresh = (): void => {
      let last: ExerciseKeyHandlers | undefined;
      for (const h of handlers.current) last = h;
      setHasHint(last?.onHint !== undefined);
    };
    return {
      inFrame: true,
      refresh,
      register(h) {
        handlers.current.add(h);
        refresh();
        return () => {
          handlers.current.delete(h);
          refresh();
        };
      },
    };
  }, []);

  const zen = p.feel === 'zen';
  const showTimer = p.timer !== null && !zen;
  const hard = p.step.timed;
  const timer = useTimer({
    deadlineMs: p.timer?.ms,
    running: showTimer && !paused && !p.held && p.feedback === null,
    now: p.now,
    startedAt: p.timer?.startedAt,
    onTimeout: () => {
      // A soft ring (untimed step) merely runs out; only a timed step's expiry is a timeout.
      if (props.current.step.timed) props.current.onTimeout?.();
    },
  });
  const startedAt = p.timer?.startedAt;
  useEffect(() => {
    timer.reset(startedAt);
  }, [timer, p.step.id, startedAt]);

  const pause = (): void => {
    if (pausedRef.current) return;
    setPaused(true);
    setOverlay('open');
    props.current.onPause();
  };
  // Resume at once; the overlay leaves the way it arrived (kasure) where an exit can play.
  const resume = (): void => {
    if (!pausedRef.current) return;
    setPaused(false);
    setOverlay(exitsPlay() ? 'leaving' : null);
    props.current.onResume?.();
  };
  const section = useRef<HTMLElement>(null);
  useEffect(() => (section.current ? pressRing(section.current) : undefined), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // keyCode 229 = a key swallowed by an IME (older Android keyboards leave isComposing false)
      if (e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey) return;
      const cur = props.current;
      const fb = cur.feedback;
      const editing = isEditable(e.target);
      const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';
      const consume = (): void => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (pausedRef.current) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          if (onButton && e.key !== 'Escape') return; // native click on Resume
          consume();
          resume();
        }
        return;
      }
      if (e.key === 'Escape') {
        consume();
        pause();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        if (!fb) {
          consume();
          cur.onGuard();
        }
        return;
      }
      if (fb && (e.key === 'Enter' || e.key === ' ')) {
        if (onButton) return; // let the focused button click
        consume();
        cur.onContinue();
        return;
      }
      if (editing) return;
      if (onButton && (e.key === 'Enter' || e.key === ' ')) return;

      const h = latest();
      if (e.key >= '1' && e.key <= '9' && e.key.length === 1) {
        if (fb) return;
        const idx = Number(e.key) - 1;
        const fn = h?.onChoice ?? cur.onChoice;
        if (fn) {
          consume();
          fn(idx);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (h?.onSubmit) {
          consume();
          h.onSubmit();
        }
        return;
      }
      if (e.key === ' ') {
        const fn = h?.onReplay ?? cur.onReplay;
        if (fn) {
          consume();
          fn();
        }
        return;
      }
      if (e.key === '?' && !fb) {
        const hint = latestHint();
        if (hint) {
          consume();
          hint();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const fb = p.feedback;
  const announce = paused ? S.paused : fb ? feedbackAnnouncement(fb) : '';
  const progress = timer.progress.value;
  const expired = timer.timedOut.value;
  const secondsLeft = Math.ceil(timer.remaining.value / 1000);
  const tag = p.step.stepTag;
  const hidden = paused ? 'true' : undefined;
  const inert = paused || undefined;
  const kiFull = !zen && p.ki >= 100;

  return (
    <ExerciseFrameContext.Provider value={api}>
      <section
        ref={section}
        class="exercise-frame"
        data-feel={p.feel}
        data-exercise={p.step.exercise}
        data-paused={paused ? 'true' : undefined}
        aria-label="Exercise"
      >
        <header class="exercise-frame__head" aria-hidden={hidden} inert={inert}>
          <span class="exercise-frame__progress">
            <span aria-hidden="true">
              {p.index + 1} / {p.total}
            </span>
            <span class="sr-only">{fill(S.stepOf, { i: p.index + 1, n: p.total })}</span>
            {p.step.isNew ? <span class="chip exercise-frame__tag">{S.newItem}</span> : null}
            {tag ? (
              <span class="chip exercise-frame__tag" data-step-tag={tag}>
                {STEP_TAG_LABEL[tag]}
              </span>
            ) : null}
          </span>
          {zen ? (
            <span />
          ) : (
            <div class="ki-bar status-window" role="meter" aria-label={S.ki} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.ki)} data-full={kiFull ? 'true' : undefined}>
              <span class="ki-bar__label">
                <span lang="ja">気</span> {S.ki}
              </span>
              <div class="meter ki-bar__track" style={`--value:${Math.max(0, Math.min(100, p.ki)) / 100}`}>
                <div class="meter__fill" />
              </div>
            </div>
          )}
          {!zen && p.combo > 0 ? (
            <span class="combo" data-tier={p.comboTier}>
              {p.combo}
              <small>{S.combo}</small>
            </span>
          ) : null}
          {showTimer ? (
            <div
              class="speed-ring"
              role="timer"
              aria-label={fill(S.secondsLeft, { n: secondsLeft })}
              data-soft={hard ? undefined : 'true'}
              data-expired={expired ? 'true' : undefined}
              data-timed-out={hard && expired ? 'true' : undefined}
            >
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle class="speed-ring__track" cx="18" cy="18" r={RING_R} />
                <circle
                  class="speed-ring__fill"
                  cx="18"
                  cy="18"
                  r={RING_R}
                  style={{ strokeDasharray: `${RING_C}`, strokeDashoffset: `${RING_C * progress}` }}
                />
              </svg>
              <span class="speed-ring__text" aria-hidden="true">
                {secondsLeft}
              </span>
            </div>
          ) : null}
        </header>

        <div class="exercise-frame__body" aria-hidden={hidden} inert={inert}>
          {p.children}
        </div>

        {fb ? <Feedback state={fb} feel={p.feel} onAgain={p.onAgain} /> : null}

        <footer class="exercise-frame__controls" aria-hidden={hidden} inert={inert}>
          {!fb ? (
            <button type="button" class="btn btn--ghost" onClick={() => p.onGuard()} aria-keyshortcuts="Shift+Enter">
              {S.guardButton}
              <kbd aria-hidden="true">⇧↵</kbd>
            </button>
          ) : null}
          {!fb && hasHint ? (
            <button type="button" class="btn btn--ghost exercise-frame__hint" onClick={() => latestHint()?.()} aria-keyshortcuts="?">
              {S.hintButton}
              <kbd aria-hidden="true">?</kbd>
            </button>
          ) : null}
          <button type="button" class="btn btn--ghost" onClick={pause} aria-keyshortcuts="Escape">
            {S.pauseButton}
            <kbd aria-hidden="true">Esc</kbd>
          </button>
          {fb ? (
            <button type="button" class={kiFull ? 'hanko hanko--charged' : 'hanko'} onClick={() => p.onContinue()} aria-keyshortcuts="Enter">
              {S.continue}
              <kbd aria-hidden="true">↵</kbd>
            </button>
          ) : null}
        </footer>

        {overlay ? <PauseOverlay onResume={resume} leaving={overlay === 'leaving'} onGone={() => setOverlay(null)} /> : null}

        <div class="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
      </section>
    </ExerciseFrameContext.Provider>
  );
}
