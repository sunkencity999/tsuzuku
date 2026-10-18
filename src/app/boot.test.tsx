/**
 * TSUZUKU — boot smoke test (group A).
 *
 * The real wiring end to end, with only the I/O replaced:
 *   store      initialised over a `MemoryStorage` (B's test double)
 *   content    the `content` singleton routed to the in-memory fixture loader
 *   pages      `<App>` with the REAL `pageFor`: lazy `DojoPage`, G's `DojoScene`,
 *              E's `dojoFeed` (nothing injected)
 * at the dojo route. It must render without throwing: no error boundary,
 * no missing-room state, the Dojo page on screen, and not a single
 * real `fetch`. `main.test.tsx` covers `boot()`'s routing rules; this file is
 * the "does the whole thing come up" check.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, createFakeLoader } from '@/content/fixtures';
import type { ContentLoader } from '@/content/loader';
import { resetServices } from '@/shared/audio';
import { bus } from '@/shared/events';
import { resetRegistryForTests } from '@/shared/exercise-types';
import { loadKoyomi, resetKoyomiForTests } from '@/shared/koyomi';
import { route, syncRouteFromLocation } from '@/shared/routes';
import type { SaveMeta } from '@/shared/store-types';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, MemoryStorage, makeTestStore, type DeepPartial } from '@/store/testing';
import { boot } from '@/main';
import { App } from './App';
import { resetExercisesForTests } from './pages';

// `content` is a singleton; route its reads to the fixture loader (the actual
// module keeps ContentError / isChunk for the fixtures' own imports).
const fake = vi.hoisted(() => ({ loader: null as ContentLoader | null }));
vi.mock('@/content/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content/loader')>();
  const content = new Proxy(actual.content, { get: (t, k) => Reflect.get(fake.loader ?? t, k) });
  return { ...actual, content };
});

const now = (): number => DEFAULT_TEST_NOW;

/**
 * The Dojo column's calendar data (design 09 §3.5): `DojoPage` fetches `./calendar/koyomi.json` once
 * after mount unless `koyomiData()` is already loaded, so the boot test seeds it from disk the way
 * DojoPage.test.tsx does — the "not a single real fetch" rule stays strict and the column renders
 * its Japanese as in the browser.
 */
const KOYOMI = JSON.parse(readFileSync(resolve(process.cwd(), 'public/calendar/koyomi.json'), 'utf8')) as unknown;

/** A learner with history, so `boot()` does not redirect a first run to onboarding. */
const ACTIVE: DeepPartial<SaveMeta> = {
  profile: { name: 'Hana', xp: 120 },
  stats: { sessions: 3 },
  streak: { totalDays: 3, current: 1 },
};

let root: HTMLDivElement;
let fetchSpy: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** Polls until `pred()` holds or `ms` elapse (lazy page modules resolve on their own ticks). */
async function waitFor(pred: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the page');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const dojoRendered = (): boolean => root.querySelector('.page.dojo') !== null;
const anyError = (): boolean => root.querySelector('.app-error, .page-error') !== null;

beforeEach(() => {
  fake.loader = createFakeLoader(FIXTURE);
  root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  // The fixture loader answers every content read; a real network call would be a leak.
  fetchSpy = vi.fn(() => Promise.reject(new Error('boot test: unexpected fetch')));
  vi.stubGlobal('fetch', fetchSpy);
  loadKoyomi(KOYOMI);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetExercisesForTests();
  resetRegistryForTests();
  resetServices();
  bus.reset();
  resetKoyomiForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  location.hash = '';
});

describe('boot: MemoryStorage + fixture loader + real pages', () => {
  it('<App> at #/ renders the real Dojo page for an active learner without throwing', async () => {
    const storage = new MemoryStorage();
    await makeTestStore({ storage, save: ACTIVE, now, reducers: true });
    expect(store.ready.value).toBe(true);
    expect(store.profile.value.name).toBe('Hana');

    expect(() => act(() => render(<App />, root))).not.toThrow();
    await waitFor(() => dojoRendered() || anyError());

    expect(root.querySelector('.app-error')).toBeNull();
    expect(root.querySelector('.page-error')).toBeNull();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('main#main')).not.toBeNull();
    expect(dojoRendered()).toBe(true);
    expect(root.querySelector('.dojo__sessions')).not.toBeNull();
    expect(route.value.name).toBe('dojo');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    // The save round-trips through the fake Storage, not localStorage.
    expect(storage.keys().some((k) => k.includes('tsuzuku'))).toBe(true);
  });

  it('<App> at #/ renders the Dojo zero state for a fresh save without throwing', async () => {
    const storage = new MemoryStorage();
    await makeTestStore({ storage, now, reducers: true });

    expect(() => act(() => render(<App />, root))).not.toThrow();
    await waitFor(() => dojoRendered() || anyError());

    expect(anyError()).toBe(false);
    expect(dojoRendered()).toBe(true);
    // A fresh save shows the first-run card (to Nihonbashi) in place of the session buttons.
    expect(root.querySelector('[data-first-run]')).not.toBeNull();
    expect(root.querySelector('.dojo__sessions')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('boot() over the same doubles (with the art overlay) resolves and lands on the Dojo', async () => {
    const storage = new MemoryStorage();
    await makeTestStore({ storage, save: ACTIVE, now });
    resetStoreForTests();

    await expect(boot(root, { storage, now, audio: false, overlays: true, sw: false })).resolves.toBeUndefined();
    await waitFor(() => dojoRendered() || anyError());

    expect(anyError()).toBe(false);
    expect(dojoRendered()).toBe(true);
    expect(root.querySelector('.dojo__sessions')).not.toBeNull();
    expect(route.value.name).toBe('dojo');
    expect(store.now()).toBe(DEFAULT_TEST_NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
