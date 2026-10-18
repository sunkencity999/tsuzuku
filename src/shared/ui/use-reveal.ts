/**
 * TSUZUKU — reveal and motion-preference hooks (contract tier, design 09 §6.6 / §7 E).
 *
 *  prefersReducedMotion()   the store's `reducedMotion` setting OR the OS media
 *                           query — the same body as art/ceremony/support.ts,
 *                           re-homed here because shared/ui and the shell may
 *                           not import the art tier (ARCHITECTURE §0 import rule).
 *  useReveal(ref, o)        one-shot IntersectionObserver: `true` once the element
 *                           has crossed `threshold` (default .5), then disconnects.
 *                           Safe where the API is absent (jsdom, old WebViews):
 *                           it resolves to `true` at once so nothing waits on a
 *                           decoration. `will-change` is set only for the reveal
 *                           and cleared when the entrance ends (§6.7 rule 3).
 */
import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { store } from '@/store';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** The store's `reducedMotion` setting OR the OS preference. */
export function prefersReducedMotion(): boolean {
  try {
    if (store.settings.peek().reducedMotion) return true;
  } catch {
    /* store not initialised: fall through to the media query */
  }
  try {
    return typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

export interface RevealOptions {
  /** Fraction of the element that must be visible (default .5). */
  threshold?: number;
  rootMargin?: string;
  /** Skip the observer and reveal at once (tests, lists above the fold). */
  immediate?: boolean;
}

/** How long `will-change` may stay after a reveal when no entrance fires. */
export const WILL_CHANGE_CLEAR_MS = 1000;

function hasObserver(): boolean {
  return typeof IntersectionObserver === 'function';
}

/** Marks `el` for compositing during its entrance and clears the hint when the entrance ends. */
export function transientWillChange(el: HTMLElement | SVGElement, value = 'opacity, transform'): () => void {
  el.style.willChange = value;
  let done = false;
  const clear = (): void => {
    if (done) return;
    done = true;
    el.style.willChange = '';
    el.removeEventListener('animationend', clear);
    el.removeEventListener('transitionend', clear);
    clearTimeout(timer);
  };
  el.addEventListener('animationend', clear, { once: true });
  el.addEventListener('transitionend', clear, { once: true });
  const timer = setTimeout(clear, WILL_CHANGE_CLEAR_MS);
  return clear;
}

/**
 * `true` once `ref.current` has been seen on screen (one-shot). Without an
 * `IntersectionObserver` it is `true` from the first render.
 */
export function useReveal<T extends Element>(ref: RefObject<T>, o: RevealOptions = {}): boolean {
  const [revealed, setRevealed] = useState<boolean>(() => Boolean(o.immediate) || !hasObserver());

  useEffect(() => {
    if (revealed) return;
    const el = ref.current;
    if (!el) return;
    if (!hasObserver()) {
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        // The hint clears itself when the entrance ends (or after the safety timeout), not when this effect re-runs.
        if (el instanceof HTMLElement || el instanceof SVGElement) transientWillChange(el);
        setRevealed(true);
      },
      { threshold: o.threshold ?? 0.5, rootMargin: o.rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealed]);

  return revealed;
}
