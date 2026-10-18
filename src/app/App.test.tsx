import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render, type FunctionComponent } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { navigate, syncRouteFromLocation, type Route } from '@/shared/routes';
import { resetStoreForTests, store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { S } from '@/i18n/strings';
import { App, ENSO_D, ErrorBoundary, routeAnnouncement } from './App';
import type { PageModule } from './pages';
import { resetTransitionsForTests, shownRoute } from './transitions';

/** `document` without lib.dom's typed `startViewTransition`, so a fake can be installed and removed. */
type Doc = { startViewTransition?: unknown };

const Shows: FunctionComponent<{ route: Route }> = (p) => <h2 id="page">{p.route.name}</h2>;
const Throws: FunctionComponent<{ route: Route }> = () => {
  throw new Error('page boom');
};
/** A page that places its own focus (sessions focus the exercise box first). */
const Focuses: FunctionComponent<{ route: Route }> = (p) => {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <button id="page" ref={ref} type="button">
      {p.route.name}
    </button>
  );
};
/** The Dojo stand-in: the scene wrapper the arrival carries the ensō onto. */
const DojoLike: FunctionComponent<{ route: Route }> = (p) => (
  <section id="page">
    <div class="dojo-scene__art" />
    {p.route.name}
  </section>
);

const pages = async (r: Route): Promise<PageModule> => {
  if (r.name === 'records') return { Page: Throws };
  if (r.name === 'library') throw new Error('not built');
  if (r.name === 'about') return { Page: Shows, props: { extra: 1 } };
  return { Page: Shows };
};

let root: HTMLDivElement;
let errorSpy: ReturnType<typeof vi.spyOn>;
let rafCount = 0;
/** Update callbacks pending right now: while > 0 the browser suppresses rendering, so no frame fires. */
let suppressed = 0;
let heldFrames: FrameRequestCallback[] = [];

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await flush();
};
/** Lets the update callback run and its promise chain settle: act flushes Preact's commit, then the thenable adoption needs a few more ticks. */
const microtasks = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

interface VtCall {
  /** `html[data-travel]` when the API was called. */
  travel: string | null;
  /** Inline `view-transition-name`s present when the API was called: [class, name]. */
  names: [string, string][];
  callbackSettled: boolean;
  finish: () => void;
}

/**
 * A recording `document.startViewTransition`: runs the callback on a microtask,
 * `finished` waits for `finish()`. Like the browser, it withholds every
 * animation frame while the callback's promise is pending (rendering is
 * suppressed then), releasing them once it settles — so a callback that waits
 * on `requestAnimationFrame` never settles here either.
 */
function fakeViewTransitions(): { api: ReturnType<typeof vi.fn>; calls: VtCall[] } {
  const calls: VtCall[] = [];
  const api = vi.fn((cb: () => void | Promise<void>) => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const rec: VtCall = {
      travel: document.documentElement.getAttribute('data-travel'),
      names: Array.from(document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')).map((el) => [el.getAttribute('class') ?? '', el.style.getPropertyValue('view-transition-name')]),
      callbackSettled: false,
      finish,
    };
    suppressed++;
    const updateCallbackDone = Promise.resolve().then(() => cb());
    const release = (): void => {
      rec.callbackSettled = true;
      suppressed--;
      if (suppressed === 0) {
        const held = heldFrames;
        heldFrames = [];
        for (const fn of held) setTimeout(() => fn(0), 0);
      }
    };
    void updateCallbackDone.then(release, release);
    calls.push(rec);
    return { finished, ready: updateCallbackDone, updateCallbackDone, skipTransition() {} };
  });
  (document as unknown as Doc).startViewTransition = api;
  return { api, calls };
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
  rafCount = 0;
  suppressed = 0;
  heldFrames = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    rafCount++;
    if (suppressed > 0) {
      heldFrames.push(fn);
      return 0;
    }
    return setTimeout(() => fn(0), 0) as unknown as number;
  });
});
afterEach(() => {
  render(null, root);
  root.remove();
  delete (document as unknown as Doc).startViewTransition;
  resetTransitionsForTests();
  resetStoreForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('<App>', () => {
  it('shows the loading state until store.ready, then the layout and the page', async () => {
    resetStoreForTests();
    act(() => render(<App pageFor={pages} />, root));
    expect(root.querySelector('.app-loading')?.textContent).toContain(S.loading);
    expect(root.querySelector('.layout')).toBeNull();
    await act(async () => {
      await makeTestStore();
    });
    await flush();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
  });

  it('swaps the page on route change and passes injected props', async () => {
    await makeTestStore();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
    act(() => navigate({ name: 'about' }));
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('about');
    act(() => navigate({ name: 'settings' }));
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('settings');
  });

  it('holds the previous page, interactive and on its own route, while the next one loads (no dimmed .page-stale copy)', async () => {
    await makeTestStore();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'road') await new Promise<void>((res) => (release = res));
      return { Page: Shows };
    };
    act(() => render(<App pageFor={slow} />, root));
    await flush();
    act(() => navigate({ name: 'road' }));
    // the old page stays mounted on ITS route (the stale copy used to receive the new one) and nothing dims it
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
    expect(root.querySelector('.page-stale')).toBeNull();
    expect(root.querySelector('[aria-busy]')).toBeNull();
    expect(root.querySelector('.layout__main .visually-hidden[role="status"]')?.textContent).toBe(S.pageLoading);
    release!();
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('road');
    expect(root.querySelector('.layout__main .visually-hidden[role="status"]')).toBeNull();
  });

  it('the error boundary catches a throwing page: "Rest. Reload." with a reload button; nav survives', async () => {
    await makeTestStore();
    const reload = vi.fn();
    act(() => render(<App pageFor={pages} reload={reload} />, root));
    await flush();
    act(() => navigate({ name: 'records' }));
    await flush();
    const fallback = root.querySelector('.app-error');
    expect(fallback?.querySelector('h1')?.textContent).toBe('Rest. Reload.');
    expect(fallback?.textContent).toContain(S.errorBody);
    expect(fallback?.textContent).toContain('page boom');
    const btn = fallback?.querySelector<HTMLButtonElement>('.app-error__reload');
    expect(btn?.textContent).toBe(S.reload);
    act(() => btn?.click());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.nav')).not.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    // navigating away resets the boundary
    act(() => navigate({ name: 'about' }));
    await flush();
    expect(root.querySelector('.app-error')).toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('about');
  });

  it('a page module that fails to load shows the calm missing-room state with a retry', async () => {
    await makeTestStore();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    act(() => navigate({ name: 'library' }));
    await flush();
    const err = root.querySelector('.page-error');
    expect(err?.textContent).toContain(S.pageMissing);
    expect(err?.textContent).toContain('not built');
    expect(err?.querySelector('a')?.getAttribute('href')).toBe('#/');
    expect(err?.querySelector('button')?.textContent).toBe(S.reload);
  });

  it('renders overlays, and a throwing overlay is swallowed silently', async () => {
    await makeTestStore();
    const Overlay: FunctionComponent = () => <div id="overlay" />;
    const Bad: FunctionComponent = () => {
      throw new Error('overlay boom');
    };
    act(() => render(<App pageFor={pages} overlays={[Overlay, Bad]} />, root));
    await flush();
    expect(root.querySelector('#overlay')).not.toBeNull();
    expect(root.querySelector('.app-error')).toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
  });

  it('overlays handed over as a signal mount when the art barrel resolves after first paint', async () => {
    await makeTestStore();
    const Overlay: FunctionComponent = () => <div id="overlay" />;
    const overlays = signal<FunctionComponent[]>([]);
    act(() => render(<App pageFor={pages} overlays={overlays} />, root));
    await flush();
    expect(root.querySelector('#overlay')).toBeNull();
    act(() => {
      overlays.value = [Overlay];
    });
    await flush();
    expect(root.querySelector('#overlay')).not.toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
  });

  it('applies the theme to the document while mounted', async () => {
    await makeTestStore({ save: { settings: { feel: 'arcade' } } });
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    expect(document.documentElement.getAttribute('data-feel')).toBe('arcade');
    expect(document.body.classList.contains('feel-arcade')).toBe(true);
  });
});

describe('page turns (design 09 §6.4)', () => {
  it('without the API the new page nijimi-in through .page-enter; html[data-travel] names the turn until it settles, nothing else is touched', async () => {
    await makeTestStore();
    expect((document as unknown as Doc).startViewTransition).toBeUndefined();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false); // the first page is not a turn
    act(() => navigate({ name: 'road' }));
    await flush();
    const page = root.querySelector('#page')!;
    expect(page.textContent).toBe('road');
    expect(page.classList.contains('page-enter')).toBe(true);
    expect(page.classList.contains('ink-nijimi')).toBe(true);
    // the chrome's return from a drill keys on it (Layout.css @starting-style), so the fallback path sets it too …
    expect(document.documentElement.getAttribute('data-travel')).toBe('forward');
    await frames(3);
    // … and clears it once the turn has settled
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
    expect(root.querySelector('[style*="view-transition-name"]')).toBeNull();
  });

  it('starts the View Transition at MODULE RESOLVE, not before; the callback settles on the commit — never on a frame, which cannot fire while it is pending', async () => {
    await makeTestStore();
    const vt = fakeViewTransitions();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'road') await new Promise<void>((res) => (release = res));
      return { Page: Shows };
    };
    act(() => render(<App pageFor={slow} />, root));
    await flush();
    expect(vt.api).not.toHaveBeenCalled(); // the first page (no previous page) never turns
    act(() => navigate({ name: 'road' }));
    await flush();
    expect(vt.api).not.toHaveBeenCalled(); // the chunk is still loading: the old page holds, no frozen transition
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
    rafCount = 0;
    release!();
    await microtasks();
    expect(vt.api).toHaveBeenCalledTimes(1);
    const call = vt.calls[0]!;
    expect(root.querySelector('#page')?.textContent).toBe('road'); // committed inside the callback
    expect(call.callbackSettled).toBe(true); // … and settled by the post-commit layout effect, with no frame requested
    expect(rafCount).toBe(0);
    expect(document.documentElement.getAttribute('data-travel')).toBe('forward'); // until `finished`
    act(() => call.finish());
    await frames(2);
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
    expect(root.querySelector('#page')?.classList.contains('page-enter')).toBe(false); // no fallback entrance when the API ran
  });

  it('the chrome follows the committed page, not the hash: data-route and the current nav item turn with the page', async () => {
    await makeTestStore();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'train') await new Promise<void>((res) => (release = res));
      return { Page: Shows };
    };
    act(() => render(<App pageFor={slow} />, root));
    await flush();
    expect(shownRoute.value).toEqual({ name: 'dojo' });
    act(() => navigate({ name: 'train', mode: 'kata' }));
    await flush();
    // the old page still shows: the drill chrome has NOT collapsed yet
    expect(root.querySelector('.layout')?.getAttribute('data-route')).toBe('dojo');
    expect(root.querySelector('[data-nav="dojo"]')?.getAttribute('aria-current')).toBe('page');
    release!();
    await frames(3);
    expect(root.querySelector('#page')?.textContent).toBe('train');
    expect(root.querySelector('.layout')?.getAttribute('data-route')).toBe('train');
    expect(root.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('a startViewTransition that throws falls back to the plain turn instead of holding the old page', async () => {
    await makeTestStore();
    (document as unknown as Doc).startViewTransition = vi.fn(() => {
      throw new Error('inactive document');
    });
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    act(() => navigate({ name: 'road' }));
    await frames(3);
    expect(root.querySelector('#page')?.textContent).toBe('road');
    expect(root.querySelector('#page')?.classList.contains('page-enter')).toBe(true);
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
  });

  it('html[data-travel] is "forward" for dojo → road and "in" for dojo → train', async () => {
    await makeTestStore();
    const vt = fakeViewTransitions();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    act(() => navigate({ name: 'road' }));
    await frames(3);
    expect(vt.calls[0]?.travel).toBe('forward');
    act(() => vt.calls[0]!.finish());
    await flush();
    act(() => navigate({ name: 'dojo' }));
    await frames(3);
    expect(vt.calls[1]?.travel).toBe('home');
    act(() => vt.calls[1]!.finish());
    await flush();
    act(() => navigate({ name: 'train', mode: 'kata' }));
    await frames(3);
    expect(vt.calls[2]?.travel).toBe('in');
    act(() => vt.calls[2]!.finish());
    await flush();
    act(() => navigate({ name: 'dojo' }));
    await frames(3);
    expect(vt.calls[3]?.travel).toBe('out');
  });

  it('with settings.reducedMotion the API is never called and the fallback plays its fade', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true } } });
    const vt = fakeViewTransitions();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    act(() => navigate({ name: 'road' }));
    await frames(3);
    expect(vt.api).not.toHaveBeenCalled();
    expect(root.querySelector('#page')?.classList.contains('page-enter')).toBe(true);
  });

  it('on finished: the route is announced once and <main> takes focus when the page placed none of its own', async () => {
    await makeTestStore();
    const vt = fakeViewTransitions();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(document.activeElement).toBe(document.body);
    act(() => navigate({ name: 'road' }));
    await frames(3);
    expect(document.activeElement).toBe(document.body); // nothing moves before `finished`
    act(() => vt.calls[0]!.finish());
    await frames(2); // `finished` → focus; announce() speaks on its own task
    expect(document.activeElement?.id).toBe('main');
    expect(root.querySelector('#live')?.textContent).toBe(routeAnnouncement({ name: 'road' }));
    expect(routeAnnouncement({ name: 'road' })).toBe('東海道 Road');
  });

  it('on finished: focus stays where the page put it (a session focuses its exercise box first)', async () => {
    await makeTestStore();
    const vt = fakeViewTransitions();
    const focusing = async (r: Route): Promise<PageModule> => ({ Page: r.name === 'train' ? Focuses : Shows });
    act(() => render(<App pageFor={focusing} />, root));
    await flush();
    act(() => navigate({ name: 'train', mode: 'kata' }));
    await frames(3);
    expect(document.activeElement?.id).toBe('page');
    act(() => vt.calls[0]!.finish());
    await flush();
    expect(document.activeElement?.id).toBe('page');
  });

  it('a route change while the chunk loads abandons that turn: no transition for a stale module', async () => {
    await makeTestStore();
    const vt = fakeViewTransitions();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'road') await new Promise<void>((res) => (release = res));
      return { Page: Shows };
    };
    act(() => render(<App pageFor={slow} />, root));
    await flush();
    act(() => navigate({ name: 'road' }));
    await flush();
    act(() => navigate({ name: 'about' }));
    await frames(3);
    expect(vt.api).toHaveBeenCalledTimes(1);
    expect(vt.calls[0]?.travel).toBe('forward');
    act(() => vt.calls[0]!.finish());
    await flush();
    release!();
    await frames(3);
    expect(vt.api).toHaveBeenCalledTimes(1);
    expect(root.querySelector('#page')?.textContent).toBe('about');
  });
});

describe('Kadode — train (End Card) → dojo (design 09 §7 C)', () => {
  const EndCardLike: FunctionComponent<{ route: Route }> = (p) => (
    <section id="page">
      <span class="end-card__brush">{p.route.name}</span>
    </section>
  );
  const HearthLike: FunctionComponent<{ route: Route }> = (p) => (
    <section id="page">
      <button type="button" class="dojo-scene__hotspot dojo-scene__hotspot--hearth">
        {p.route.name}
      </button>
    </section>
  );
  const sessionPages = async (r: Route): Promise<PageModule> => ({ Page: r.name === 'train' ? EndCardLike : r.name === 'dojo' ? HearthLike : Shows });

  it('carries tsuzuku-mark: on .end-card__brush before the callback, on the hearth hotspot after; travel is out; both clear on finished', async () => {
    await makeTestStore();
    const vt = fakeViewTransitions();
    location.hash = '#/train/kata';
    syncRouteFromLocation();
    act(() => render(<App pageFor={sessionPages} />, root));
    await flush();
    expect(root.querySelector('.end-card__brush')).not.toBeNull();
    act(() => navigate({ name: 'dojo' }));
    await microtasks();
    expect(vt.api).toHaveBeenCalledTimes(1);
    const call = vt.calls[0]!;
    expect(call.travel).toBe('out');
    expect(call.names).toEqual([['end-card__brush', 'tsuzuku-mark']]);
    const hearth = root.querySelector<HTMLElement>('.dojo-scene__hotspot--hearth');
    expect(hearth).not.toBeNull();
    expect(hearth?.style.getPropertyValue('view-transition-name')).toBe('tsuzuku-mark'); // named before the callback settled
    expect(call.callbackSettled).toBe(true);
    act(() => call.finish());
    await flush();
    expect(hearth?.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
  });
});

describe('arrival — Hiraku (design 09 §7 A)', () => {
  const dojoPages = async (r: Route): Promise<PageModule> => ({ Page: r.name === 'dojo' ? DojoLike : Shows });

  it('prefetches the dojo chunk while the save loads and, when ready flips with it resolved, turns the boot mark into the shell: enso on .app-loading__mark before the callback, on .dojo-scene__art after', async () => {
    resetStoreForTests();
    const vt = fakeViewTransitions();
    const pageFor = vi.fn(dojoPages);
    act(() => render(<App pageFor={pageFor} />, root));
    await flush();
    expect(pageFor).toHaveBeenCalledWith({ name: 'dojo' }); // the prefetch, beside initStore
    expect(vt.api).not.toHaveBeenCalled();
    await act(async () => {
      await makeTestStore();
    });
    await microtasks();
    expect(vt.api).toHaveBeenCalledTimes(1);
    expect(vt.calls[0]?.travel).toBe('home');
    expect(vt.calls[0]?.names).toEqual([['app-loading__mark', 'enso']]);
    expect(vt.calls[0]?.callbackSettled).toBe(true); // settled by the shell's commit, no frame needed
    const art = root.querySelector<HTMLElement>('.dojo-scene__art');
    expect(art).not.toBeNull();
    expect(art?.style.getPropertyValue('view-transition-name')).toBe('enso');
    expect(root.querySelector('.app-loading')).toBeNull();
    // the prefetched module is the page: no second load for the dojo
    expect(pageFor.mock.calls.filter(([r]) => r.name === 'dojo').length).toBe(1);
    act(() => vt.calls[0]!.finish());
    await flush();
    expect(art?.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
  });

  it('when the chunk has not resolved at ready, the boot mark holds for it (d35) and the arrival turns once it lands', async () => {
    resetStoreForTests();
    const vt = fakeViewTransitions();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'dojo') await new Promise<void>((res) => (release = res));
      return { Page: DojoLike };
    };
    act(() => render(<App pageFor={slow} />, root));
    await flush();
    await act(async () => {
      await makeTestStore();
    });
    await frames(3);
    // the save is ready, the chunk is not: the ensō keeps the stage, nothing is turned yet
    expect(vt.api).not.toHaveBeenCalled();
    expect(root.querySelector('.app-loading')).not.toBeNull();
    expect(root.querySelector('.layout')).toBeNull();
    await act(async () => {
      release!();
    });
    await flush();
    await microtasks();
    expect(vt.api).toHaveBeenCalledTimes(1);
    expect(vt.calls[0]?.travel).toBe('home');
    expect(vt.calls[0]?.names).toEqual([['app-loading__mark', 'enso']]);
    const art = root.querySelector<HTMLElement>('.dojo-scene__art');
    expect(art?.style.getPropertyValue('view-transition-name')).toBe('enso');
    expect(root.querySelector('.app-loading')).toBeNull();
    act(() => vt.calls[0]!.finish());
    await flush();
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
  });

  it('a chunk that misses the hold arrives plainly — the ensō never waits past its own stroke (d35)', async () => {
    resetStoreForTests();
    const vt = fakeViewTransitions();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'dojo') await new Promise<void>((res) => (release = res));
      return { Page: DojoLike };
    };
    act(() => render(<App pageFor={slow} arrivalHoldMs={30} />, root));
    await flush();
    await act(async () => {
      await makeTestStore();
    });
    await frames(2);
    expect(root.querySelector('.app-loading')).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    await frames(2);
    expect(vt.api).not.toHaveBeenCalled();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('.layout')?.classList.contains('page-enter')).toBe(true);
    expect(root.querySelector('.dojo-scene__art')).toBeNull();
    release!();
    await frames(3);
    expect(root.querySelector('.dojo-scene__art')).not.toBeNull();
    expect(vt.api).not.toHaveBeenCalled(); // the first page never turns on its own
  });

  it('a deep link prefetches nothing and arrives plainly', async () => {
    resetStoreForTests();
    location.hash = '#/about';
    syncRouteFromLocation();
    const vt = fakeViewTransitions();
    const pageFor = vi.fn(dojoPages);
    act(() => render(<App pageFor={pageFor} />, root));
    await flush();
    expect(pageFor).not.toHaveBeenCalled();
    await act(async () => {
      await makeTestStore();
    });
    await frames(3);
    expect(vt.api).not.toHaveBeenCalled();
    expect(root.querySelector('#page')?.textContent).toBe('about');
  });

  it('under reduced motion the arrival skips the API even with the chunk resolved', async () => {
    resetStoreForTests();
    const vt = fakeViewTransitions();
    act(() => render(<App pageFor={dojoPages} />, root));
    await flush();
    await act(async () => {
      await makeTestStore({ save: { settings: { reducedMotion: true } } });
    });
    await frames(3);
    expect(store.settings.value.reducedMotion).toBe(true);
    expect(vt.api).not.toHaveBeenCalled();
    expect(root.querySelector('.dojo-scene__art')).not.toBeNull();
  });

  it('the boot mark is an ensō drawing itself (§7 A beat 0): one OPEN arc with round caps on hiku-stroke, pathLength 1, ≤ 10 nodes, no filter; the loading sentence stays, visually hidden', () => {
    resetStoreForTests();
    act(() => render(<App pageFor={dojoPages} />, root));
    const mark = root.querySelector('svg.app-loading__mark');
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.querySelector('circle'), 'an ensō has a gap: no closed <circle>').toBeNull();
    const stroke = mark?.querySelector('path');
    expect(stroke?.getAttribute('d')).toBe(ENSO_D);
    expect(ENSO_D).toMatch(/^M[\d. ]+A20 20 0 1 1 [\d. ]+$/); // one arc, large-arc, clockwise …
    expect(ENSO_D).not.toMatch(/[Zz]/); // … never closed
    expect(stroke?.getAttribute('pathLength')).toBe('1');
    expect(stroke?.classList.contains('ink-hiku')).toBe(true);
    expect(stroke?.getAttribute('data-axis')).toBe('stroke');
    expect(stroke?.getAttribute('fill')).toBe('none');
    expect(stroke?.getAttribute('stroke-linecap')).toBe('round');
    expect(1 + (mark?.querySelectorAll('*').length ?? 0)).toBeLessThanOrEqual(10); // the §10 node budget
    expect(mark?.querySelector('filter')).toBeNull();
    // the sentence is for assistive tech now: hidden, still the only text, no Japanese glyph on the boot screen
    const text = root.querySelector('.app-loading__text');
    expect(text?.classList.contains('visually-hidden')).toBe(true);
    expect(root.querySelector('.app-loading')?.textContent).toBe(S.loading);
    // motion.css draws it in --dur-4 on --ease-draw (stroke-dashoffset only) and rests it under BOTH reduced selectors
    const motion = readFileSync(resolve(process.cwd(), 'src/styles/motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(motion).toMatch(/\.ink-hiku\[data-axis="stroke"\]\s*\{[^}]*animation-name:\s*hiku-stroke;[^}]*animation-duration:\s*var\(--dur-4\)/);
    expect(motion).toMatch(/\.ink-hiku\s*\{[^}]*var\(--ease-draw\)/);
    expect(motion).toMatch(/@keyframes hiku-stroke\s*\{[^}]*stroke-dashoffset[^}]*\}/);
    // the @media body alone: a greedy [\s\S]* would run on into the :root[data-reduced-motion] twin below it and prove nothing
    const mediaBody = (css: string, query: string): string => {
      const i = css.indexOf(`@media ${query}`);
      expect(i, query).toBeGreaterThanOrEqual(0);
      const open = css.indexOf('{', i);
      let depth = 1;
      let j = open + 1;
      for (; j < css.length && depth > 0; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
      return css.slice(open + 1, j - 1);
    };
    const reduce = mediaBody(motion, '(prefers-reduced-motion: reduce)');
    expect(reduce).not.toMatch(/:root\[data-reduced-motion\]/); // the slice really is the @media block only
    expect(reduce).toMatch(/\.ink-hiku\[data-axis="stroke"\][^{]*\{[^}]*animation:\s*none/);
    expect(motion).toMatch(/:root\[data-reduced-motion\] :is\([^)]*\.ink-hiku\[data-axis="stroke"\][^)]*\)[^{]*\{[^}]*animation:\s*none/);
  });

  it('under reduced motion (the OS query, before the save is known) the drawing class is absent and the arc is already whole — a static mark, not a hold', () => {
    resetStoreForTests();
    const mql = (query: string): MediaQueryList =>
      ({
        matches: /prefers-reduced-motion/.test(query),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', mql);
    act(() => render(<App pageFor={dojoPages} />, root));
    const stroke = root.querySelector('svg.app-loading__mark path');
    expect(stroke).not.toBeNull();
    expect(stroke?.classList.contains('ink-hiku')).toBe(false);
    expect(stroke?.hasAttribute('data-axis')).toBe(false);
    expect(stroke?.getAttribute('d')).toBe(ENSO_D); // the same complete arc, drawn whole
    expect(stroke?.getAttribute('stroke-dasharray')).toBeNull();
    expect(root.querySelector('svg.app-loading__mark')?.getAttribute('class')).toBe('app-loading__mark'); // the hero name's host is unchanged
  });

  it('App.tsx draws the ensō inline: it never imports src/art/brush.ts (the art chunk stays out of the boot bundle)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(src).not.toMatch(/from '[^']*art\/brush'/);
    expect(src).not.toMatch(/from '@\/art\//);
  });
});

describe('<ErrorBoundary>', () => {
  it('renders children when nothing throws and nothing in silent mode on error', () => {
    act(() =>
      render(
        <ErrorBoundary>
          <span id="ok" />
        </ErrorBoundary>,
        root,
      ),
    );
    expect(root.querySelector('#ok')).not.toBeNull();
    act(() =>
      render(
        <ErrorBoundary silent>
          <Throws route={{ name: 'dojo' }} />
        </ErrorBoundary>,
        root,
      ),
    );
    expect(root.textContent).toBe('');
  });
});
