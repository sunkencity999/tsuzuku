/**
 * TSUZUKU — router glue (group A, ARCHITECTURE §6, design 07 §1).
 *
 * `@/shared/routes` already owns the `route` signal, `parseHash`, `href`,
 * `navigate` and the hashchange listener. This module adds what the shell
 * needs around it:
 *   - its own hashchange listener feeding `route` (belt and braces; removed on stop)
 *   - scroll positions per route (saved here at the hash change, keyed by
 *     `href(route)`); the RESTORE is PageHost's (`restoreScroll(r)` in its
 *     post-commit layout effect, design 09 §6.7 rule 6) — never at the hash
 *     change, when the old page is still on screen and would jump — always
 *     `behavior: 'instant'` (design 09 §6.4)
 *   - `document.title = titleFor(route)`
 *   - `services.audio.cancel()` on every navigation so no utterance outlives its screen
 *
 * `startRouter()` returns a disposer. Pages that render late can call
 * `restoreScroll()` after mounting to land on the remembered position.
 */
import { effect } from '@preact/signals';
import { services } from '@/shared/audio';
import { href, route, sameRoute, syncRouteFromLocation, titleFor, type Route } from '@/shared/routes';

const positions = new Map<string, number>();

function currentScrollY(): number {
  if (typeof window === 'undefined') return 0;
  const y = window.scrollY ?? window.pageYOffset ?? 0;
  return Number.isFinite(y) ? y : 0;
}

/**
 * Always `behavior: 'instant'` (design 09 §6.4): `html { scroll-behavior: smooth }`
 * must never turn a restored position into a glide between pages — the page
 * turn is the View Transition's job, and under reduced motion there is none.
 */
export const SCROLL_OPTIONS: Pick<ScrollToOptions, 'behavior'> = { behavior: 'instant' };

function scrollToY(y: number): void {
  if (typeof window === 'undefined') return;
  if (currentScrollY() === y) return;
  try {
    window.scrollTo({ top: y, ...SCROLL_OPTIONS });
  } catch {
    /* jsdom: not implemented */
  }
}

/** Remembers the current scroll position for `r` (default: the current route). */
export function saveScroll(r: Route = route.peek()): void {
  positions.set(href(r), currentScrollY());
}

/** Scrolls to the remembered position for `r` (default: the current route), or the top. */
export function restoreScroll(r: Route = route.peek()): void {
  scrollToY(positions.get(href(r)) ?? 0);
}

/** Remembered position for tests and for pages that want to know. */
export function savedScroll(r: Route): number | undefined {
  return positions.get(href(r));
}

/** Forgets every remembered position (tests). */
export function resetScrollPositions(): void {
  positions.clear();
}

export function startRouter(): () => void {
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) {
    window.addEventListener('hashchange', syncRouteFromLocation);
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    } catch {
      /* ignore */
    }
    // Make sure the signal reflects the URL we booted on.
    syncRouteFromLocation();
  }

  let prev: Route | null = null;
  const dispose = effect(() => {
    const r = route.value;
    if (prev !== null && sameRoute(prev, r)) return;
    if (prev !== null) {
      // Signals run before Preact re-renders, so scrollY still belongs to the old page.
      positions.set(href(prev), currentScrollY());
      try {
        services.audio.cancel();
      } catch {
        /* a broken audio service must never break navigation */
      }
    }
    prev = r;
    if (typeof document !== 'undefined') document.title = titleFor(r);
    // No scroll here: PageHost restores once the new page is committed (an old page must not jump while its successor loads).
  });

  return () => {
    dispose();
    if (hasWindow) window.removeEventListener('hashchange', syncRouteFromLocation);
  };
}
