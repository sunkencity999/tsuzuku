import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import type { FeedbackState } from '../exercise-types';
import type { Step } from '../session-types';
import { ExerciseFrame, useExerciseKeys, type ExerciseFrameProps, EXIT_FALLBACK_MS } from './ExerciseFrame';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const step = (over: Partial<Step> = {}): Step => ({
  id: 's1',
  block: 'reviews',
  exercise: 'meaning-guard',
  itemId: 'v-n5-0001',
  cardKey: 'v-n5-0001#rec',
  params: { choices: ['a', 'b', 'c', 'd'] },
  timed: true,
  timerMs: 4000,
  isNew: false,
  stepTag: null,
  exposures: 3,
  estMs: 6000,
  ...over,
});

const feedback = (over: Partial<FeedbackState> = {}): FeedbackState => ({
  kind: 'correct',
  correct: 'ねこ',
  errorTags: [],
  rating: 3,
  ippon: false,
  kiai: false,
  xpDelta: 2,
  ...over,
});

interface Spies {
  onGuard: ReturnType<typeof vi.fn>;
  onHint: ReturnType<typeof vi.fn>;
  onPause: ReturnType<typeof vi.fn>;
  onContinue: ReturnType<typeof vi.fn>;
  onReplay: ReturnType<typeof vi.fn>;
  onChoice: ReturnType<typeof vi.fn>;
  onResume: ReturnType<typeof vi.fn>;
}

function spies(): Spies {
  return {
    onGuard: vi.fn(),
    onHint: vi.fn(),
    onPause: vi.fn(),
    onContinue: vi.fn(),
    onReplay: vi.fn(),
    onChoice: vi.fn(),
    onResume: vi.fn(),
  };
}

function props(s: Spies, over: Partial<ExerciseFrameProps> = {}): ExerciseFrameProps {
  return {
    step: step(),
    index: 2,
    total: 20,
    ki: 40,
    combo: 12,
    comboTier: 1,
    timer: { ms: 4000, startedAt: 0 },
    feel: 'dojo',
    feedback: null,
    now: () => 0,
    children: <div class="exercise">drill</div>,
    ...s,
    ...over,
  };
}

function mount(p: ExerciseFrameProps): void {
  act(() => render(<ExerciseFrame {...p} />, root));
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

/** A drill with its own hint, registered the way every drill should (`useExerciseKeys({ onHint })`). */
function HintChild(p: { hint: () => void }) {
  useExerciseKeys({ onHint: p.hint });
  return <div class="exercise">drill</div>;
}

const hintButton = (): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>('.exercise-frame__hint');
/** jsdom runs no animations, so exits are instant there; these tests lend it an engine (`getAnimations`) and end the exit by hand. */
let restoreEngine: (() => void) | null = null;
const withAnimations = (): void => {
  const proto = Element.prototype as { getAnimations?: () => Animation[] };
  const had = proto.getAnimations;
  proto.getAnimations = () => [];
  restoreEngine = () => {
    if (had) proto.getAnimations = had;
    else delete proto.getAnimations;
    restoreEngine = null;
  };
};
afterEach(() => restoreEngine?.());
const endAnimation = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
};
const isInert = (el: Element | null): boolean => !!el && (el.hasAttribute('inert') || (el as HTMLElement & { inert?: boolean }).inert === true);

describe('<ExerciseFrame> keys', () => {
  it("Shift+Enter → onGuard, ? → the drill's registered hint (never the legacy prop), Esc → onPause (overlay) and Esc again resumes", () => {
    const s = spies();
    const hint = vi.fn();
    mount(props(s, { children: <HintChild hint={hint} /> }));
    press('Enter', { shiftKey: true });
    expect(s.onGuard).toHaveBeenCalledTimes(1);
    const q = press('?', { shiftKey: true });
    expect(hint).toHaveBeenCalledTimes(1);
    expect(q.defaultPrevented).toBe(true);
    expect(s.onHint).not.toHaveBeenCalled();
    hintButton()!.click();
    expect(hint).toHaveBeenCalledTimes(2);

    press('Escape');
    expect(s.onPause).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.pause-overlay')).not.toBeNull();
    expect(root.querySelector('.exercise-frame')?.getAttribute('data-paused')).toBe('true');
    // other keys are swallowed while paused
    press('?');
    expect(hint).toHaveBeenCalledTimes(2);
    press('Escape');
    expect(root.querySelector('.pause-overlay')).toBeNull();
    expect(s.onResume).toHaveBeenCalledTimes(1);
    expect(s.onPause).toHaveBeenCalledTimes(1);
  });

  it('? is inert and the footer shows no Hint button while no drill offers a hint (nothing is charged)', () => {
    const s = spies();
    mount(props(s));
    const e = press('?');
    expect(e.defaultPrevented).toBe(false);
    expect(s.onHint).not.toHaveBeenCalled();
    expect(hintButton()).toBeNull();
  });

  it("a hint-only set never shadows a child's keys; a later keyed set without a hint (a Judge Card) hides the hint", () => {
    const s = spies();
    const picked = vi.fn();
    const hint = vi.fn();
    const judgePick = vi.fn();
    function Grid() {
      useExerciseKeys({ onChoice: picked });
      return <div>grid</div>;
    }
    function Drill() {
      // the parent registers after its child, with a hint alone
      useExerciseKeys({ onHint: hint });
      return <Grid />;
    }
    function Judge() {
      useExerciseKeys({ onChoice: judgePick, onReplay: () => undefined });
      return null;
    }
    mount(props(s, { children: <Drill /> }));
    press('3');
    expect(picked).toHaveBeenCalledWith(2);
    press('?');
    expect(hint).toHaveBeenCalledTimes(1);
    expect(hintButton()).not.toBeNull();

    mount(
      props(s, {
        children: (
          <>
            <Drill />
            <Judge />
          </>
        ),
      }),
    );
    expect(hintButton()).toBeNull();
    expect(press('?').defaultPrevented).toBe(false);
    expect(hint).toHaveBeenCalledTimes(1);
    press('2');
    expect(judgePick).toHaveBeenCalledWith(1);
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it('the Hint button follows the drill: gone once its onHint is withdrawn (hint used), back when offered again', () => {
    const s = spies();
    function Drill() {
      const [used, setUsed] = useState(false);
      useExerciseKeys({ onHint: used ? undefined : () => setUsed(true) });
      return (
        <button type="button" class="reset" onClick={() => setUsed(false)}>
          {used ? 'used' : 'fresh'}
        </button>
      );
    }
    mount(props(s, { children: <Drill /> }));
    expect(hintButton()).not.toBeNull();
    press('?');
    expect(root.querySelector('.reset')?.textContent).toBe('used');
    expect(hintButton()).toBeNull();
    expect(press('?').defaultPrevented).toBe(false);
    act(() => root.querySelector<HTMLButtonElement>('.reset')!.click());
    expect(hintButton()).not.toBeNull();
  });

  it('digits pick a choice through the context handler (0-based), falling back to the onChoice prop', () => {
    const s = spies();
    const picked = vi.fn();
    function Child() {
      useExerciseKeys({ onChoice: picked });
      return <div>child</div>;
    }
    mount(props(s, { children: <Child /> }));
    const e = press('3');
    expect(picked).toHaveBeenCalledWith(2);
    expect(s.onChoice).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);

    mount(props(s));
    press('1');
    expect(s.onChoice).toHaveBeenCalledWith(0);
    // digits typed into an input are left alone
    const input = document.createElement('input');
    root.appendChild(input);
    const e2 = press('2', {}, input);
    expect(e2.defaultPrevented).toBe(false);
    expect(s.onChoice).toHaveBeenCalledTimes(1);
  });

  it('Space replays when no feedback is shown; registered handler wins over the prop', () => {
    const s = spies();
    mount(props(s));
    press(' ');
    expect(s.onReplay).toHaveBeenCalledTimes(1);
    const replay = vi.fn();
    function Child() {
      useExerciseKeys({ onReplay: replay });
      return null;
    }
    mount(props(s, { children: <Child /> }));
    press(' ');
    expect(replay).toHaveBeenCalledTimes(1);
    expect(s.onReplay).toHaveBeenCalledTimes(1);
  });

  it('feedback shown: Enter/Space → onContinue (even from an input), digits/hint/guard inert', () => {
    const s = spies();
    const hint = vi.fn();
    mount(props(s, { feedback: feedback(), children: <HintChild hint={hint} /> }));
    expect(root.querySelector('.feedback')).not.toBeNull();
    expect(root.querySelector('.hanko')?.textContent).toContain('Continue');
    expect(hintButton()).toBeNull();
    press('1');
    press('?');
    press('Enter', { shiftKey: true });
    expect(s.onChoice).not.toHaveBeenCalled();
    expect(hint).not.toHaveBeenCalled();
    expect(s.onGuard).not.toHaveBeenCalled();

    const e = press('Enter');
    expect(s.onContinue).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    press(' ');
    expect(s.onContinue).toHaveBeenCalledTimes(2);

    const input = document.createElement('input');
    root.appendChild(input);
    const e2 = press('Enter', {}, input);
    expect(e2.defaultPrevented).toBe(true);
    expect(s.onContinue).toHaveBeenCalledTimes(3);
  });

  it('Enter without feedback is left to inputs and reaches a registered onSubmit otherwise', () => {
    const s = spies();
    const submit = vi.fn();
    function Child() {
      useExerciseKeys({ onSubmit: submit });
      return <input class="x" />;
    }
    mount(props(s, { children: <Child /> }));
    const input = root.querySelector('input.x') as HTMLInputElement;
    const e = press('Enter', {}, input);
    expect(e.defaultPrevented).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    press('Enter');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(s.onContinue).not.toHaveBeenCalled();
  });

  it('Enter/Space mid-IME-composition (isComposing or keyCode 229) never reach onSubmit or onReplay', () => {
    const s = spies();
    const submit = vi.fn();
    function Child() {
      useExerciseKeys({ onSubmit: submit });
      return <div class="x" />;
    }
    mount(props(s, { children: <Child /> }));
    expect(press('Enter', { isComposing: true }).defaultPrevented).toBe(false);
    expect(press('Enter', { keyCode: 229 }).defaultPrevented).toBe(false);
    press(' ', { isComposing: true });
    press(' ', { keyCode: 229 });
    expect(submit).not.toHaveBeenCalled();
    expect(s.onReplay).not.toHaveBeenCalled();
    press('Enter');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('feedback shown: Enter/Space mid-IME-composition never reach onContinue', () => {
    const s = spies();
    mount(props(s, { feedback: feedback() }));
    const input = document.createElement('input');
    root.appendChild(input);
    press('Enter', { isComposing: true }, input);
    press('Enter', { keyCode: 229 }, input);
    press(' ', { isComposing: true }, input);
    press('Enter', { isComposing: true });
    expect(s.onContinue).not.toHaveBeenCalled();
    press('Enter');
    expect(s.onContinue).toHaveBeenCalledTimes(1);
  });

  it('ignores modifier combos and key repeat', () => {
    const s = spies();
    const hint = vi.fn();
    mount(props(s, { children: <HintChild hint={hint} /> }));
    press('?', { metaKey: true });
    press('?', { repeat: true });
    expect(hint).not.toHaveBeenCalled();
  });
});

describe('<ExerciseFrame> HUD', () => {
  it('Dojo shows ki bar, combo with tier and the speed ring for a timed step; progress/combo carry no aria-label on a generic span', () => {
    const s = spies();
    mount(props(s));
    expect(root.querySelector('.ki-bar')?.getAttribute('aria-valuenow')).toBe('40');
    const combo = root.querySelector('.combo');
    expect(combo?.getAttribute('data-tier')).toBe('1');
    expect(combo?.textContent).toContain('12');
    expect(combo?.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector('.speed-ring')).not.toBeNull();
    expect(root.querySelector('.speed-ring')?.getAttribute('data-soft')).toBeNull();
    const progress = root.querySelector('.exercise-frame__progress');
    expect(progress?.textContent).toContain('3 / 20');
    expect(progress?.hasAttribute('aria-label')).toBe(false);
    expect(progress?.querySelector('.sr-only')?.textContent).toBe('Step 3 of 20');
    expect(progress?.querySelector('[aria-hidden="true"]')?.textContent).toContain('3 / 20');
  });

  it('Zen hides ki, combo and timer', () => {
    const s = spies();
    mount(props(s, { feel: 'zen' }));
    expect(root.querySelector('.ki-bar')).toBeNull();
    expect(root.querySelector('.combo')).toBeNull();
    expect(root.querySelector('.speed-ring')).toBeNull();
    expect(root.querySelector('.exercise-frame')?.getAttribute('data-feel')).toBe('zen');
  });

  it('the ring follows the timer alone: soft for an untimed step, absent without a timer; combo hidden at 0', () => {
    const s = spies();
    mount(props(s, { step: step({ timed: false }), combo: 0, comboTier: 0 }));
    const ring = root.querySelector('.speed-ring');
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute('data-soft')).toBe('true');
    expect(root.querySelector('.combo')).toBeNull();
    mount(props(s, { timer: null }));
    expect(root.querySelector('.speed-ring')).toBeNull();
    mount(props(s, { timer: null, step: step({ timed: false }) }));
    expect(root.querySelector('.speed-ring')).toBeNull();
  });

  it('a soft ring runs out without onTimeout or data-timed-out; a timed step reports onTimeout once', () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const s = spies();
      const onTimeout = vi.fn();
      mount(props(s, { now: () => t, timer: { ms: 1000, startedAt: 0 }, onTimeout, step: step({ timed: false }) }));
      t = 1200;
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      const soft = root.querySelector('.speed-ring');
      expect(soft?.getAttribute('data-expired')).toBe('true');
      expect(soft?.getAttribute('data-timed-out')).toBeNull();
      expect(onTimeout).not.toHaveBeenCalled();

      t = 0;
      mount(props(s, { now: () => t, timer: { ms: 1000, startedAt: 0 }, onTimeout, step: step({ id: 's2' }) }));
      t = 600;
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(root.querySelector('.speed-ring__text')?.textContent).toBe('1');
      t = 1200;
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(root.querySelector('.speed-ring')?.getAttribute('data-timed-out')).toBe('true');
      expect(root.querySelector('.speed-ring')?.getAttribute('data-expired')).toBe('true');
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('controls swap: Guard (and Hint, when the drill offers one) before feedback, Continue after; live region announces', () => {
    const s = spies();
    mount(props(s, { children: <HintChild hint={vi.fn()} /> }));
    const labels = Array.from(root.querySelectorAll('.exercise-frame__controls button')).map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes("Don't know"))).toBe(true);
    expect(labels.some((l) => l.includes('Hint'))).toBe(true);
    expect(labels.some((l) => l.includes('Continue'))).toBe(false);
    (root.querySelector('.exercise-frame__controls button') as HTMLButtonElement).click();
    expect(s.onGuard).toHaveBeenCalledTimes(1);

    mount(props(s, { feedback: feedback({ kind: 'wrong', given: 'ねご', promotion: 'green' }), children: <HintChild hint={vi.fn()} /> }));
    const after = Array.from(root.querySelectorAll('.exercise-frame__controls button')).map((b) => b.textContent ?? '');
    expect(after.some((l) => l.includes('Continue'))).toBe(true);
    expect(after.some((l) => l.includes('Hint'))).toBe(false);
    const live = root.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toContain("Again. That's the training.");
    expect(live?.textContent).toContain('Green');
  });

  it('step chips: New and the step tag', () => {
    const s = spies();
    mount(props(s, { step: step({ isNew: true, stepTag: 'recovery' }) }));
    const chips = Array.from(root.querySelectorAll('.exercise-frame__tag')).map((c) => c.textContent);
    expect(chips).toEqual(['New', 'Recovery']);
  });
});

describe('<ExerciseFrame> pause overlay', () => {
  it('Escape moves focus to Resume, Tab wraps inside the overlay, the rest of the frame is hidden and inert, and the opener gets focus back on resume', () => {
    const s = spies();
    mount(props(s));
    const guard = root.querySelector('.exercise-frame__controls button') as HTMLButtonElement;
    guard.focus();
    expect(document.activeElement).toBe(guard);

    press('Escape');
    const overlay = root.querySelector('.pause-overlay') as HTMLElement;
    const resumeBtn = overlay.querySelector('.hanko') as HTMLButtonElement;
    expect(overlay.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(resumeBtn);

    const tab = press('Tab', {}, resumeBtn);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(resumeBtn);
    const back = press('Tab', { shiftKey: true }, resumeBtn);
    expect(back.defaultPrevented).toBe(true);
    expect(overlay.contains(document.activeElement)).toBe(true);

    for (const sel of ['.exercise-frame__head', '.exercise-frame__body', '.exercise-frame__controls']) {
      const el = root.querySelector(sel);
      expect(el?.getAttribute('aria-hidden'), sel).toBe('true');
      expect(isInert(el), sel).toBe(true);
    }
    expect(guard.closest('[aria-hidden="true"]')).not.toBeNull();

    act(() => {
      resumeBtn.click();
    });
    expect(root.querySelector('.pause-overlay')).toBeNull();
    expect(s.onResume).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(guard);
    for (const sel of ['.exercise-frame__head', '.exercise-frame__body', '.exercise-frame__controls']) {
      const el = root.querySelector(sel);
      expect(el?.hasAttribute('aria-hidden'), sel).toBe(false);
      expect(isInert(el), sel).toBe(false);
    }
  });

  it('with an animation engine the overlay enters as .ink-nijimi and leaves on data-leaving: resume is immediate, the frame is live again, the overlay goes on animationend', () => {
    withAnimations();
    const s = spies();
    mount(props(s));
    const guard = root.querySelector('.exercise-frame__controls button') as HTMLButtonElement;
    guard.focus();
    press('Escape');
    const overlay = root.querySelector('.pause-overlay') as HTMLElement;
    expect(overlay.classList.contains('ink-nijimi')).toBe(true);
    expect(overlay.hasAttribute('data-leaving')).toBe(false);
    press('Escape');
    expect(s.onResume).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.exercise-frame')?.getAttribute('data-paused')).toBeNull();
    for (const sel of ['.exercise-frame__head', '.exercise-frame__body', '.exercise-frame__controls']) expect(isInert(root.querySelector(sel)), sel).toBe(false);
    expect(overlay.hasAttribute('data-leaving')).toBe(true);
    expect(root.querySelector('.pause-overlay')).toBe(overlay);
    // a leaving overlay is no modal: inert, hidden from assistive tech, aria-modal gone, the opener focused already
    expect(isInert(overlay)).toBe(true);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement).toBe(guard);
    endAnimation(overlay);
    expect(root.querySelector('.pause-overlay')).toBeNull();
    expect(document.activeElement).toBe(guard);
  });

  it('held (the Leave slip is open): the ring stops and nothing times out; released, it runs on', () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const s = spies();
      const onTimeout = vi.fn();
      mount(props(s, { now: () => t, timer: { ms: 1000, startedAt: 0 }, onTimeout, held: true }));
      t = 1200;
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(onTimeout).not.toHaveBeenCalled();
      expect(root.querySelector('.speed-ring')?.getAttribute('data-expired')).toBeNull();
      mount(props(s, { now: () => t, timer: { ms: 1000, startedAt: 0 }, onTimeout, held: false }));
      t = 2400;
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the overlay exit falls back to a timer (≤ 200 ms) when no animationend arrives, and is skipped under reduced motion', () => {
    withAnimations();
    vi.useFakeTimers();
    try {
      const s = spies();
      mount(props(s));
      press('Escape');
      press('Escape');
      expect(root.querySelector('.pause-overlay')?.hasAttribute('data-leaving')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(EXIT_FALLBACK_MS);
      });
      expect(root.querySelector('.pause-overlay')).toBeNull();
      expect(EXIT_FALLBACK_MS).toBeLessThanOrEqual(200);
    } finally {
      vi.useRealTimers();
    }
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    try {
      press('Escape');
      expect(root.querySelector('.pause-overlay')).not.toBeNull();
      press('Escape');
      expect(root.querySelector('.pause-overlay')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the Pause button opens the same overlay and Enter on the focused Resume falls through to its click', () => {
    const s = spies();
    mount(props(s));
    const pauseBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.exercise-frame__controls button')).find((b) => b.textContent?.includes('Pause'))!;
    pauseBtn.focus();
    act(() => {
      pauseBtn.click();
    });
    const resumeBtn = root.querySelector('.pause-overlay .hanko') as HTMLButtonElement;
    expect(document.activeElement).toBe(resumeBtn);
    const e = press('Enter', {}, resumeBtn);
    expect(e.defaultPrevented).toBe(false); // native click resumes
    act(() => {
      resumeBtn.click();
    });
    expect(root.querySelector('.pause-overlay')).toBeNull();
    expect(document.activeElement).toBe(pauseBtn);
  });
});

describe('<ExerciseFrame> ki meter and the charged hanko (design 09 §7 I)', () => {
  it('the ki track is a .meter whose --value is the ki fraction; a full bar marks data-full and charges Continue', () => {
    const s = spies();
    mount(props(s));
    const track = root.querySelector('.ki-bar .meter.ki-bar__track') as HTMLElement;
    expect(track).not.toBeNull();
    expect(track.style.getPropertyValue('--value')).toBe('0.4');
    expect(track.querySelector('.meter__fill')).not.toBeNull();
    expect(root.querySelector('.ki-bar')?.hasAttribute('data-full')).toBe(false);
    expect(root.querySelector('[style*="width"]')).toBeNull();
    const fb = { kind: 'correct' as const, correct: 'x', errorTags: [], rating: 3 as const, ippon: false, kiai: false, xpDelta: 2 };
    mount(props(s, { ki: 100, feedback: fb }));
    expect(root.querySelector('.ki-bar')?.getAttribute('data-full')).toBe('true');
    expect((root.querySelector('.ki-bar .meter') as HTMLElement).style.getPropertyValue('--value')).toBe('1');
    const hanko = root.querySelector('.exercise-frame__controls .hanko');
    expect(hanko?.classList.contains('hanko--charged')).toBe(true);
    mount(props(s, { ki: 60, feedback: fb }));
    expect(root.querySelector('.exercise-frame__controls .hanko')?.classList.contains('hanko--charged')).toBe(false);
    mount(props(s, { ki: 100, feedback: fb, feel: 'zen' }));
    expect(root.querySelector('.ki-bar')).toBeNull();
    expect(root.querySelector('.exercise-frame__controls .hanko')?.classList.contains('hanko--charged')).toBe(false);
  });

  it('.hanko.is-pressed rides pointerdown and clears on pointerup, delegated from the frame (the ink-bleed ring, §5.3)', () => {
    const s = spies();
    const fb = { kind: 'correct' as const, correct: 'x', errorTags: [], rating: 3 as const, ippon: false, kiai: false, xpDelta: 2 };
    mount(props(s, { feedback: fb }));
    const hanko = root.querySelector('.exercise-frame__controls .hanko') as HTMLButtonElement;
    act(() => {
      hanko.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(hanko.classList.contains('is-pressed')).toBe(true);
    act(() => {
      hanko.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    expect(hanko.classList.contains('is-pressed')).toBe(false);
    // a finger that slides off the seal releases it too: the pointerup lands outside the frame
    act(() => {
      hanko.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(hanko.classList.contains('is-pressed')).toBe(true);
    act(() => {
      document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    expect(hanko.classList.contains('is-pressed')).toBe(false);
    // a press elsewhere never rings a seal
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(root.querySelector('.hanko.is-pressed')).toBeNull();
  });
});
