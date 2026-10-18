/**
 * TSUZUKU — root component (group A).
 *
 * Waits for `store.ready`, keeps the document's theme/feel classes in sync,
 * renders `<Layout>` around the page resolved by `pages.ts` for the current
 * route, mounts injected overlays (ceremonies) and wraps everything in an
 * error boundary with the "Rest. Reload." copy. A page that throws takes
 * down only the page area: the nav keeps working and the next navigation
 * resets the boundary.
 *
 * Page turns (design 09 §6.4): `PageHost` starts the View Transition at
 * MODULE RESOLVE, while the old page is still mounted and interactive — never
 * around `apply()` while a chunk loads. The old page holds until the next one
 * is ready (no dimmed `.page-stale` copy any more). The update callback
 * commits and returns a `commitGate()` that the post-commit layout effect
 * settles — after naming the new hero and restoring the scroll, so the new
 * capture already shows both. Never a frame-based wait inside the callback:
 * rendering is suppressed while it is pending, so `requestAnimationFrame`
 * does not fire there and the browser would skip the turn after ~4 s. On
 * `finished` the route title is announced once and `<main>` takes focus when
 * the page placed none of its own. Without the API (or under reduced motion,
 * a hidden tab, a ceremony) the new page nijimi-in through `fallbackEnter()`;
 * `html[data-travel]` is set for that path too, so the chrome's return from a
 * drill (Layout.css, `@starting-style`) knows the direction. `shownRoute`
 * follows the committed page so the chrome turns with it.
 *
 * Arrival (design 09 §7 A, Hiraku): the boot mark is an ensō drawing itself
 * (`.ink-hiku[data-axis="stroke"]`, --dur-4 --ease-draw; complete at once under
 * reduced motion). The Dojo chunk is prefetched while the save loads; when
 * `ready` flips with the chunk resolved, App itself turns the mark into the
 * shell under a View Transition, the `enso` name carrying `.app-loading__mark`
 * onto `.dojo-scene__art`. If the chunk is not there yet, the shell arrives
 * under a plain --dur-fade crossfade (`.layout.ink-nijimi` → mat, Layout.css).
 */
import type { ReadonlySignal } from '@preact/signals';
import { Component, type ComponentChildren, type FunctionComponent, type JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { href, route, sameRoute, titleFor, type Route } from '@/shared/routes';
import { store } from '@/store';
import { S } from '@/i18n/strings';
import { Layout, announce, focusMain } from './Layout';
import { pageFor as defaultPageFor, type PageModule } from './pages';
import { restoreScroll } from './router';
import { startThemeSync } from './theme';
import { afterPaint, canTransition, cleanupTransition, commitGate, fallbackEnter, nameNewHeroes, prepareTransition, shownRoute, transitionToken, viewTransitionApi, type CommitGate } from './transitions';
import './App.css';

export interface AppProps {
  /** Overlay components rendered above the layout (G's CeremonyHost); a signal lets main.tsx add them after first paint. */
  overlays?: FunctionComponent[] | ReadonlySignal<FunctionComponent[]>;
  /** Page resolver; defaults to `pages.pageFor` (tests inject their own). */
  pageFor?: (r: Route) => Promise<PageModule>;
  /** Defaults to `location.reload()`. */
  reload?: () => void;
}

function defaultReload(): void {
  if (typeof location !== 'undefined') location.reload();
}

/* ── error boundary ──────────────────────────────────────────────────── */

interface BoundaryProps {
  children: ComponentChildren;
  /** Render nothing on error (decorative overlays). */
  silent?: boolean;
  reload?: () => void;
  /** Called when the learner chooses "Back to the dojo". */
  onHome?: () => void;
}
interface BoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown): void {
    console.error('[app] page crashed', error);
  }

  render(): ComponentChildren {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <section class="app-error status-window" role="alert" aria-labelledby="app-error-title">
        <h1 id="app-error-title" class="app-error__title">
          {S.errorTitle}
        </h1>
        <p class="app-error__body">{S.errorBody}</p>
        <details class="app-error__details">
          <summary>{S.errorDetails}</summary>
          <pre class="app-error__message">{error.message}</pre>
        </details>
        <div class="app-error__actions">
          <button type="button" class="hanko app-error__reload" onClick={() => (this.props.reload ?? defaultReload)()}>
            {S.reload}
          </button>
          <a
            class="btn btn--ghost"
            href={href({ name: 'dojo' })}
            onClick={() => {
              this.setState({ error: null });
              this.props.onHome?.();
            }}
          >
            {S.backToDojo}
          </a>
        </div>
      </section>
    );
  }
}

/* ── page host ───────────────────────────────────────────────────────── */

interface Loaded {
  key: string;
  route: Route;
  Page: PageModule['Page'];
  props: Record<string, unknown>;
}

function loadedFrom(r: Route, mod: PageModule): Loaded {
  return { key: href(r), route: r, Page: mod.Page, props: mod.props ?? {} };
}

/** What the live region says on a page turn: the title without the app suffix ("道場 Dojo"). */
export function routeAnnouncement(r: Route): string {
  return titleFor(r).split(' · ')[0] ?? titleFor(r);
}

function PageHost(p: { pageFor: (r: Route) => Promise<PageModule>; reload?: () => void; initial?: Loaded | null }): JSX.Element {
  const r = route.value;
  const key = href(r);
  const [loaded, setLoaded] = useState<Loaded | null>(() => (p.initial && p.initial.key === key ? p.initial : null));
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedRef = useRef<Loaded | null>(loaded);
  loadedRef.current = loaded;
  /** Runs synchronously in the layout effect once the page for `key` is in the DOM (before paint). */
  const onCommit = useRef<(() => void) | null>(null);
  /** The pending update callback's gate, settled early if the route moves on. */
  const gate = useRef<CommitGate | null>(null);

  useEffect(() => {
    // Seeded by the arrival: the page is already on screen.
    if (attempt === 0 && loadedRef.current?.key === key) {
      shownRoute.value = r;
      return;
    }
    let alive = true;
    setFailed(null);
    p.pageFor(r).then(
      (mod) => {
        if (!alive || !sameRoute(route.peek(), r)) return;
        const from = loadedRef.current?.route ?? null;
        const next = loadedFrom(r, mod);
        const commit = (): void => {
          shownRoute.value = r;
          setLoaded(next);
        };
        // A turn (not the first page) is announced and focused once it has settled.
        const settled = (): void => {
          if (!from || !sameRoute(route.peek(), r)) return;
          announce(routeAnnouncement(r));
          focusMain({ ifIdle: true });
        };
        // html[data-travel] for both paths (the chrome's return from a drill keys on it); the hero name on the old element.
        if (from) prepareTransition(from, r);
        const token = transitionToken();
        const start = viewTransitionApi();
        // The first page never turns on its own (the arrival is App's, §7 A); otherwise the gates of canTransition().
        if (from && start && canTransition(from, r)) {
          const g = commitGate();
          gate.current = g;
          onCommit.current = () => {
            nameNewHeroes(from, r);
            restoreScroll(r);
            g.settle();
          };
          try {
            const vt = start(() => {
              commit();
              return g.promise;
            });
            const finish = (): void => {
              gate.current = null;
              cleanupTransition(token);
              settled();
            };
            vt.finished.then(finish, finish);
            return;
          } catch (err) {
            // A throwing API (a polyfill, an inactive document) must never hold the boot screen or the old page.
            console.warn('[app] startViewTransition threw; plain turn', err);
            g.settle();
            gate.current = null;
          }
        }
        onCommit.current = () => {
          restoreScroll(r);
          fallbackEnter();
        };
        commit();
        void afterPaint().then(() => {
          cleanupTransition(token);
          settled();
        });
      },
      (err: unknown) => {
        if (!alive) return;
        console.warn('[app] page failed to load', err);
        shownRoute.value = r;
        setFailed({ key, message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      alive = false;
      onCommit.current = null;
      // The route moved on while a callback was pending: let the transition proceed rather than time out.
      gate.current?.settle();
      gate.current = null;
    };
  }, [key, attempt]);

  // Post-commit, pre-paint: the new hero name and the scroll land before the capture (VT) or the first frame (fallback).
  useLayoutEffect(() => {
    if (onCommit.current && loaded && loaded.key === key) {
      const fn = onCommit.current;
      onCommit.current = null;
      fn();
    }
  }, [loaded]);

  if (failed && failed.key === key) {
    return (
      <section class="page-error status-window" role="alert">
        <p class="page-error__text">{S.pageMissing}</p>
        <details class="app-error__details">
          <summary>{S.errorDetails}</summary>
          <pre class="app-error__message">{failed.message}</pre>
        </details>
        <div class="app-error__actions">
          <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>
            {S.reload}
          </button>
          <a class="btn btn--ghost" href={href({ name: 'dojo' })}>
            {S.backToDojo}
          </a>
        </div>
      </section>
    );
  }

  // The old page holds, interactive and on its own route, while the next chunk loads (design 09 §6.4).
  const loading = !loaded || loaded.key !== key;
  return (
    <>
      {loaded ? (
        <ErrorBoundary key={loaded.key} reload={p.reload}>
          <loaded.Page route={loaded.route} {...loaded.props} />
        </ErrorBoundary>
      ) : (
        <p class="page-loading muted" role="status" aria-live="polite">
          {S.pageLoading}
        </p>
      )}
      {loading && loaded ? <span class="visually-hidden" role="status">{S.pageLoading}</span> : null}
    </>
  );
}

/* ── root ────────────────────────────────────────────────────────────── */

type Arrival = 'idle' | 'pending' | 'running' | 'done';

export function App(p: AppProps): JSX.Element {
  const ready = store.ready.value;
  const pageFor = p.pageFor ?? defaultPageFor;
  const [, rerender] = useState(0);
  const prefetched = useRef<{ route: Route; mod: PageModule } | null>(null);
  const seed = useRef<Loaded | null>(null);
  /** The arrival turn: decided synchronously on the first ready render, started in an effect. */
  const arrival = useRef<Arrival>('idle');
  const plainArrival = useRef(false);
  /** The arrival callback's gate, settled from the layout effect once the shell is in the DOM. */
  const arrivalGate = useRef<CommitGate | null>(null);
  useEffect(() => startThemeSync(), []);

  // Hiraku (design 09 §7 A): the Dojo chunk loads beside initStore, so the arrival has something to turn to.
  useEffect(() => {
    if (store.ready.peek()) return;
    const r = route.peek();
    if (r.name !== 'dojo') return;
    let alive = true;
    pageFor(r).then(
      (mod) => {
        if (alive) prefetched.current = { route: r, mod };
      },
      () => undefined, // PageHost reports the failure when it loads the page itself
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    arrival.current = 'idle';
    seed.current = null;
  } else if (arrival.current === 'idle') {
    // `ready` just flipped: with the chunk resolved the swap waits for a View Transition; otherwise the shell renders now.
    const r = route.peek();
    const pre = prefetched.current;
    const mod = pre && sameRoute(pre.route, r) ? pre.mod : null;
    seed.current = mod ? loadedFrom(r, mod) : null;
    if (mod && viewTransitionApi() && canTransition(null, r)) arrival.current = 'pending';
    else {
      arrival.current = 'done';
      plainArrival.current = true;
    }
  }

  // The arrival turn: the boot mark (enso) → the shell, `.dojo-scene__art` named from the post-commit effect.
  useEffect(() => {
    if (arrival.current !== 'pending') return;
    arrival.current = 'running';
    const r = route.peek();
    const start = viewTransitionApi();
    const plain = (): void => {
      arrival.current = 'done';
      plainArrival.current = true;
      rerender((n) => n + 1);
    };
    if (!start) {
      plain();
      return;
    }
    prepareTransition(null, r);
    const token = transitionToken();
    const g = commitGate();
    arrivalGate.current = g;
    try {
      const vt = start(() => {
        arrival.current = 'done';
        rerender((n) => n + 1);
        return g.promise;
      });
      const finish = (): void => cleanupTransition(token);
      vt.finished.then(finish, finish);
    } catch (err) {
      console.warn('[app] startViewTransition threw; plain arrival', err);
      g.settle();
      arrivalGate.current = null;
      cleanupTransition(token);
      plain();
    }
  });

  const shown = ready && arrival.current === 'done';

  // Post-commit, pre-paint: the arrival names the new hero and settles its gate; the plain arrival fades the shell in.
  useLayoutEffect(() => {
    if (!shown) return;
    const g = arrivalGate.current;
    if (g) {
      arrivalGate.current = null;
      const r = route.peek();
      nameNewHeroes(null, r);
      restoreScroll(r);
      g.settle();
    }
    if (plainArrival.current) {
      plainArrival.current = false;
      fallbackEnter('.layout');
    }
  }, [shown]);

  if (!shown) {
    return (
      <div class="app-loading" role="status" aria-live="polite">
        {/* the ensō: a ring drawing itself (hiku-stroke, pathLength 1); carried onto `.dojo-scene__art` as `enso` */}
        <svg class="app-loading__mark" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
          <circle
            class="app-loading__enso ink-hiku"
            data-axis="stroke"
            cx="24"
            cy="24"
            r="20"
            pathLength="1"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            transform="rotate(120 24 24)"
          />
        </svg>
        <span class="app-loading__text">{S.loading}</span>
      </div>
    );
  }

  const overlays = p.overlays === undefined ? [] : Array.isArray(p.overlays) ? p.overlays : p.overlays.value;
  return (
    <ErrorBoundary reload={p.reload}>
      <Layout>
        <PageHost pageFor={pageFor} reload={p.reload} initial={seed.current} />
      </Layout>
      {overlays.map((Overlay, i) => (
        <ErrorBoundary key={i} silent>
          <Overlay />
        </ErrorBoundary>
      ))}
    </ErrorBoundary>
  );
}
