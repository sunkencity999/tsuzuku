/**
 * TSUZUKU — route transitions on the hash router (group A, design 09 §6.4, §7 A/C).
 *
 * The View Transition starts in `PageHost` at MODULE RESOLVE — never around
 * `apply()` while a chunk loads — and at `store.ready` for the arrival when the
 * Dojo chunk was prefetched (§7 A). This module holds the pure parts and the
 * DOM side effects PageHost and App share:
 *
 *   travelOf(from, to)       forward | back | in | out | home | none, from the
 *                            nav order dojo < road < library < collections <
 *                            records < settings (children hang under their
 *                            section; in = → train/gate/shinsa, out = the
 *                            reverse, home = → dojo)
 *   heroFor(from, to)        the route pair's shared elements (name + the old
 *                            and new selectors) — derived from the PAIR, never
 *                            the pointer, so keyboard users get the same hero
 *   canTransition(from, to)  API present, no reduced motion, tab visible, no
 *                            ceremony on screen, and the pair has a travel
 *   commitGate()             what the update callback returns: a promise that
 *                            settles from the post-commit layout effect (or a
 *                            safety timeout) — NEVER from requestAnimationFrame:
 *                            rendering is suppressed while the callback is
 *                            pending, so no frame fires inside it and a
 *                            frame-based wait only trips the ~4 s TimeoutError
 *   afterPaint()             two requestAnimationFrames — outside the callback
 *                            only (the no-VT path's announce / focus)
 *   prepareTransition()      html[data-travel] + the hero name on the old element
 *   transitionToken()        the turn that owns the DOM state right now
 *   nameNewHeroes()          the hero name on the new element (inside the callback)
 *   cleanupTransition(token) removes both on `finished` unless a newer turn has
 *                            prepared since (a rapid double navigation)
 *   fallbackEnter()          `.page-enter` + the nijimi verb on `.layout__main > *`
 *   shownRoute               the route whose page is in the DOM: Layout keys its
 *                            chrome (data-route, the current nav item) on it, so
 *                            the drill chrome collapses and returns WITH the page
 *                            turn — inside the View Transition — instead of at
 *                            the hash change while the old page still shows
 *
 * The ceremony probe is registered by `main.tsx` from `CeremonyHost.isCeremonyOpen`
 * (the shell may not import the art tier directly, ARCHITECTURE §0).
 */
import { signal } from '@preact/signals';
import { sameRoute, type Route, type RouteName } from '@/shared/routes';
import { prefersReducedMotion } from '@/shared/ui/use-reveal';

export type Travel = 'forward' | 'back' | 'in' | 'out' | 'home' | 'none';

export interface Hero {
  /** The `view-transition-name`. */
  name: string;
  /** Selector of the element on the OLD page. */
  from: string;
  /** Selector of the element on the NEW page. */
  to: string;
}

/**
 * The route whose page PageHost has committed (null before the first page).
 * `Layout` reads `shownRoute.value ?? route.value` so the chrome follows the
 * page on screen, not the hash.
 */
export const shownRoute = signal<Route | null>(null);

/* ── travel ─────────────────────────────────────────────────────────────── */

/** Bottom-nav order (Layout.tsx NAV_ITEMS). */
export const NAV_ORDER = ['dojo', 'road', 'library', 'collections', 'records', 'settings'] as const;
type Section = (typeof NAV_ORDER)[number];

/** Session routes: → in, ← out. The drill shell collapses on exactly these (Layout.css). */
export const SESSION_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>(['train', 'gate', 'shinsa']);

const SECTION_OF: Record<RouteName, Section | null> = {
  dojo: 'dojo',
  radio: 'dojo',
  onboarding: null,
  train: null,
  scroll: 'road',
  road: 'road',
  station: 'road',
  gate: 'road',
  shinsa: 'road',
  dan: 'road',
  listen: 'road',
  taiwa: 'road',
  story: 'library',
  library: 'library',
  collections: 'collections',
  studio: 'collections',
  records: 'records',
  ledger: 'records',
  settings: 'settings',
  backup: 'settings',
  about: 'settings',
};

const depthOf = (r: Route): number => ((NAV_ORDER as readonly string[]).includes(r.name) ? 0 : 1);
const indexOf = (s: Section): number => NAV_ORDER.indexOf(s);

/**
 * Direction of a page turn. `from` is null only at the arrival (boot → the
 * first page): `home` for the Dojo, `none` for a deep link (no snapshot to turn).
 */
export function travelOf(from: Route | null | undefined, to: Route): Travel {
  if (!from) return to.name === 'dojo' ? 'home' : 'none';
  if (sameRoute(from, to)) return 'none';
  const fromSession = SESSION_ROUTES.has(from.name);
  const toSession = SESSION_ROUTES.has(to.name);
  if (toSession && !fromSession) return 'in';
  if (fromSession && !toSession) return 'out';
  if (fromSession && toSession) return 'forward';
  if (to.name === 'dojo') return 'home';
  const sf = SECTION_OF[from.name];
  const st = SECTION_OF[to.name];
  if (sf === null || st === null) return 'forward';
  if (sf !== st) return indexOf(st) > indexOf(sf) ? 'forward' : 'back';
  const df = depthOf(from);
  const dt = depthOf(to);
  return dt < df ? 'back' : 'forward';
}

/* ── heroes ─────────────────────────────────────────────────────────────── */

/**
 * Shared elements by route pair (design 09 §6.4 table). The belt-chip and mon
 * heroes belong to ceremonies (D1), not to route turns, so they are not here.
 */
export function heroFor(from: Route | null | undefined, to: Route): Hero[] {
  if (!from) {
    return to.name === 'dojo' ? [{ name: 'enso', from: '.app-loading__mark', to: '.dojo-scene__art' }] : [];
  }
  if (from.name === 'road' && to.name === 'station') {
    const row = `.tokaido__station[data-station="${to.n}"]`;
    return [{ name: 'station-seal', from: `${row} .seal, ${row} .tokaido__seal--assisted`, to: '.station-head .sign' }];
  }
  if (from.name === 'train' && to.name === 'dojo') {
    return [{ name: 'tsuzuku-mark', from: '.end-card__brush', to: '.dojo-scene__hotspot--hearth' }];
  }
  return [];
}

/* ── gates ──────────────────────────────────────────────────────────────── */

let ceremonyProbe: (() => boolean) | null = null;

/** `main.tsx` hands over `CeremonyHost.isCeremonyOpen`; `null` clears it (tests). */
export function setCeremonyProbe(fn: (() => boolean) | null): void {
  ceremonyProbe = fn;
}

/** Whether a ceremony is on screen (false until the art tier has registered). */
export function isCeremonyOpen(): boolean {
  try {
    return ceremonyProbe ? ceremonyProbe() : false;
  } catch {
    return false;
  }
}

type DocWithVt = Document & { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> } };

/** The View Transitions API, when the document has it. */
export function viewTransitionApi(): ((cb: () => void | Promise<void>) => { finished: Promise<void> }) | null {
  if (typeof document === 'undefined') return null;
  const d = document as DocWithVt;
  return typeof d.startViewTransition === 'function' ? d.startViewTransition.bind(d) : null;
}

/** API present · no reduced motion · tab visible · no ceremony · the pair has a direction. */
export function canTransition(from: Route | null | undefined, to: Route): boolean {
  if (viewTransitionApi() === null) return false;
  if (prefersReducedMotion()) return false;
  if (document.hidden) return false;
  if (isCeremonyOpen()) return false;
  return travelOf(from, to) !== 'none';
}

/* ── frames ─────────────────────────────────────────────────────────────── */

function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

/**
 * Resolves two frames after the call. Only OUTSIDE a View Transition's update
 * callback (rendering — and so every animation frame — is suppressed while the
 * callback is pending; see `commitGate`).
 */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    nextFrame(() => nextFrame(resolve));
  });
}

/** Safety net for a commit that never reports (a stale turn): shorter than the browser's ~4 s skip. */
export const COMMIT_TIMEOUT_MS = 1000;

export interface CommitGate {
  /** What the update callback returns. */
  promise: Promise<void>;
  /** Called from the post-commit layout effect (idempotent). */
  settle(): void;
  /** Whether `settle()` has run (tests). */
  readonly settled: boolean;
}

/**
 * The update callback's promise. PageHost / App call `settle()` from a
 * `useLayoutEffect` once the new page is in the DOM — after naming the new hero
 * and restoring the scroll, so the new capture already shows both. Timers do
 * run while rendering is suppressed, so the safety timeout can fire.
 */
export function commitGate(timeoutMs = COMMIT_TIMEOUT_MS): CommitGate {
  let resolve!: () => void;
  let settled = false;
  const promise = new Promise<void>((r) => (resolve = r));
  const timer = setTimeout(() => settle(), timeoutMs);
  function settle(): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve();
  }
  return {
    promise,
    settle,
    get settled() {
      return settled;
    },
  };
}

/* ── DOM side effects ───────────────────────────────────────────────────── */

const named = new Set<HTMLElement>();
/** Bumped by every `prepareTransition`; `cleanupTransition(token)` ignores a stale one. */
let generation = 0;

function nameElement(selector: string, name: string): void {
  if (typeof document === 'undefined') return;
  let el: HTMLElement | null = null;
  try {
    el = document.querySelector<HTMLElement>(selector);
  } catch {
    el = null;
  }
  if (!el) return;
  el.style.setProperty('view-transition-name', name);
  named.add(el);
}

/** Before `startViewTransition`: `html[data-travel]` and the hero name on the old element. */
export function prepareTransition(from: Route | null | undefined, to: Route): Travel {
  const travel = travelOf(from, to);
  generation++;
  if (typeof document === 'undefined') return travel;
  document.documentElement.setAttribute('data-travel', travel);
  for (const h of heroFor(from, to)) nameElement(h.from, h.name);
  return travel;
}

/** Inside the callback, after the new page is in the DOM: the hero name on the new element. */
export function nameNewHeroes(from: Route | null | undefined, to: Route): void {
  for (const h of heroFor(from, to)) nameElement(h.to, h.name);
}

/** The current turn, taken right after `prepareTransition()` and handed back to `cleanupTransition()`. */
export function transitionToken(): number {
  return generation;
}

/**
 * On `finished` (or a failed transition): drop `data-travel` and every hero name
 * this module set. With a `token` from an earlier turn than the latest
 * `prepareTransition()`, nothing happens: the newer turn owns that state.
 */
export function cleanupTransition(token?: number): void {
  if (token !== undefined && token !== generation) return;
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-travel');
  for (const el of named) el.style.removeProperty('view-transition-name');
  named.clear();
}

/** Classes the fallback entrance adds: the marker and motion.css's nijimi verb. */
export const ENTER_CLASSES = ['page-enter', 'ink-nijimi'] as const;

/**
 * No View Transition (Safari < 18, Firefox < 144, reduced motion, a ceremony):
 * the new page nijimi-in. Preact unmounts the old page synchronously, so there
 * is no exit. The classes leave with the animation.
 */
export function fallbackEnter(selector = '.layout__main > *'): number {
  if (typeof document === 'undefined') return 0;
  let n = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    el.classList.add(...ENTER_CLASSES);
    // `animationend` bubbles: a child's own entrance (a chip, a card) ending first must not cut the page's.
    const onEnd = (e: Event): void => {
      if (e.target !== el) return;
      el.classList.remove(...ENTER_CLASSES);
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd);
    n++;
  }
  return n;
}

/** Tests: forget named elements without touching the document. */
export function resetTransitionsForTests(): void {
  named.clear();
  ceremonyProbe = null;
  generation = 0;
  shownRoute.value = null;
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-travel');
}
