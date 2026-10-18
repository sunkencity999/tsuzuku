import { signal } from '@preact/signals';
import { render } from 'preact';
import { nullAudio, resetServices, services, servicesVersion, type AudioPackInfo, type ClipPlayer, type ClipReady } from '@/shared/audio';
import { route, syncRouteFromLocation } from '@/shared/routes';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, MemoryStorage, makeTestStore, type DeepPartial } from '@/store/testing';
import type { SaveMeta } from '@/shared/store-types';
import { createClipPlayer } from './audio/clips';
import { IDLE_FALLBACK_MS, boot, isFirstRun, prefetchAllowed, saveDataRequested, whenIdle } from './main';

/** A `ClipPlayer` double that records the boot index load and prefetch. */
function fakeClips(ready: ClipReady = 'ready'): ClipPlayer & { prefetched: number[]; loaded: number[]; unlocks: number; disposed: number } {
  const f = {
    ready: signal<ClipReady>(ready),
    info: signal<AudioPackInfo | null>(null),
    prefetched: [] as number[],
    loaded: [] as number[],
    unlocks: 0,
    disposed: 0,
    loadLevel: async () => undefined,
    loadStation: async (n: number): Promise<void> => {
      f.loaded.push(n);
    },
    prefetchStation(n: number) {
      f.prefetched.push(n);
    },
    cueFor: () => undefined,
    cueForText: () => undefined,
    kanaTracks: async () => [],
    play: () => ({ done: Promise.resolve({ source: 'none' as const, seconds: 0 }), stop() {} }),
    unlock() {
      f.unlocks++;
    },
    dispose() {
      f.disposed++;
    },
    cacheUsage: async () => ({ bytes: 0, files: 0 }),
    download: async () => undefined,
    remove: async () => undefined,
  };
  return f;
}

const now = (): number => DEFAULT_TEST_NOW;

/** Seeds a MemoryStorage with a save, then hands the store back to "not booted". */
async function seeded(save: DeepPartial<SaveMeta> = {}): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await makeTestStore({ save, storage, now });
  resetStoreForTests();
  return storage;
}

const ACTIVE: DeepPartial<SaveMeta> = { profile: { name: 'Hana', xp: 120 }, stats: { sessions: 3 }, streak: { totalDays: 3, current: 1 } };

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  vi.restoreAllMocks();
  location.hash = '';
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Polls `pred` (the audio barrel is a lazy `import.meta.glob` import, so its arrival takes a few macrotasks). */
async function waitFor(pred: () => boolean, what: string, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const audioInstalled = (): Promise<void> => waitFor(() => services.audio !== nullAudio, 'the audio services');

describe('boot()', () => {
  it('renders the shell into #app from a fake Storage with nullAudio installed', async () => {
    const storage = await seeded(ACTIVE);
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    await flush();
    expect(store.ready.value).toBe(true);
    expect(store.profile.value.name).toBe('Hana');
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('main#main')).not.toBeNull();
    expect(services.audio).toBe(nullAudio);
    expect(route.value.name).toBe('dojo');
  });

  it('an empty profile.name routes to onboarding (replacing the dojo entry)', async () => {
    const storage = await seeded({ profile: { name: '' } });
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    expect(route.value.name).toBe('onboarding');
    expect(location.hash).toBe('#/onboarding');
  });

  it('a fresh save with no activity routes to onboarding; an existing learner stays on the dojo', async () => {
    const fresh = await seeded();
    await boot(root, { storage: fresh, now, audio: false, overlays: false, sw: false });
    expect(isFirstRun()).toBe(true);
    expect(route.value.name).toBe('onboarding');

    render(null, root);
    resetStoreForTests();
    location.hash = '#/';
    syncRouteFromLocation();
    const active = await seeded(ACTIVE);
    await boot(root, { storage: active, now, audio: false, overlays: false, sw: false });
    expect(isFirstRun()).toBe(false);
    expect(route.value.name).toBe('dojo');
  });

  it('leaves a deep link alone even on first run', async () => {
    const storage = await seeded();
    location.hash = '#/about';
    syncRouteFromLocation();
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    expect(route.value.name).toBe('about');
  });

  it('never throws when speechSynthesis is undefined and optional barrels are loaded', async () => {
    expect((globalThis as { speechSynthesis?: unknown }).speechSynthesis).toBeUndefined();
    const storage = await seeded(ACTIVE);
    await expect(boot(root, { storage, now, audio: true, overlays: true, sw: false })).resolves.toBeUndefined();
    await flush();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(typeof services.audio.speak).toBe('function');
    expect(typeof services.audio.cancel).toBe('function');
  });

  it('paints the loading mark before the store is ready: nothing else blocks first paint', async () => {
    const storage = await seeded(ACTIVE);
    expect(store.ready.value).toBe(false);
    const booting = boot(root, { storage, now, audio: true, overlays: true, sw: false });
    // Synchronously after the call: the shell has rendered its loading state (no blank screen).
    expect(root.querySelector('.app-loading')).not.toBeNull();
    expect(root.querySelector('.layout')).toBeNull();
    await booting;
    await flush();
    expect(root.querySelector('.app-loading')).toBeNull();
    expect(root.querySelector('.layout')).not.toBeNull();
  });

  it('uses an injected clock for store.now()', async () => {
    const storage = await seeded(ACTIVE);
    await boot(root, { storage, now: () => 1234, audio: false, overlays: false, sw: false });
    expect(store.now()).toBe(1234);
  });

  it('starts the monthly Perapera snapshot once the store is ready', async () => {
    const storage = await seeded(ACTIVE);
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    const months = store.meta().perapera.months;
    expect(Object.keys(months)).toHaveLength(1);
    expect(Object.values(months)[0]).toHaveLength(5);
  });
});

describe('boot() and the voice pack (design 08 §8)', () => {
  // jsdom has no requestIdleCallback; the stub runs the idle callback on the next macrotask (what `flush()` awaits).
  beforeEach(() => {
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      setTimeout(cb, 0);
      return 1;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('whenIdle uses requestIdleCallback when present and a 2 s timer otherwise (Safari)', () => {
    const ric = vi.fn((cb: () => void, _o?: { timeout: number }) => {
      cb();
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', ric);
    const fn = vi.fn();
    whenIdle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0]?.[1]).toEqual({ timeout: 5000 });
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    try {
      const late = vi.fn();
      whenIdle(late);
      vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1);
      expect(late).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(late).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('boot with no audio manifest (404) renders, installs the web audio service with the pack absent, and never throws', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    const storage = await seeded(ACTIVE);
    // the default player: jsdom's canPlayType is '' so the capability gate alone makes it absent
    await expect(boot(root, { storage, now, audio: true, overlays: false, sw: false })).resolves.toBeUndefined();
    await audioInstalled();
    await flush();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(services.audio).not.toBe(nullAudio);
    expect(services.audio.clips).toBeDefined();
    expect(services.audio.packReady?.value).toBe(false);
    expect(services.audio.source?.value).toBe('none');
    expect(services.audio.clips?.ready.value).toBe('absent');
    // a player whose probe passes but whose manifest 404s: absent as well, one fetch, no throw
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const player = createClipPlayer({ fetch: fetchSpy, canPlay: () => 'probably', urls: { create: () => 'blob:x', revoke: () => undefined } });
    await flush();
    expect(player.ready.value).toBe('absent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/audio\/manifest\.json$/);
    expect(errors).not.toHaveBeenCalled();
    player.dispose();
    vi.unstubAllGlobals();
  });

  it('audio barrel unavailable (its import rejects): the shell renders, nullAudio stays and servicesVersion still settles, so the pack card stops waiting', async () => {
    // `vi.doMock` is not hoisted: only the NEXT dynamic import of the barrel (main's `import.meta.glob` loader) sees it.
    vi.doMock('@/audio', () => {
      throw new Error('audio barrel unavailable (test)');
    });
    try {
      const storage = await seeded(ACTIVE);
      const before = servicesVersion.value;
      await expect(boot(root, { storage, now, audio: true, overlays: false, sw: false })).resolves.toBeUndefined();
      await waitFor(() => servicesVersion.value > before, 'servicesVersion to settle');
      await flush();
      expect(root.querySelector('.layout')).not.toBeNull();
      expect(services.audio).toBe(nullAudio);
      expect(servicesVersion.value).toBeGreaterThan(0);
      expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes('[boot] audio services unavailable'))).toBe(true);
    } finally {
      vi.doUnmock('@/audio');
    }
  });

  it('the station indexes load at install and prefetchStation runs at the next idle moment; under dataSaver or saveData the indexes still load and nothing prefetches', async () => {
    const clips = fakeClips();
    const storage = await seeded({ ...ACTIVE, progress: { station: 7 } });
    await boot(root, { storage, now, audio: true, clips, overlays: false, sw: false });
    await audioInstalled();
    expect(clips.loaded).toEqual([7]); // synchronous with the install
    await flush();
    expect(services.audio.clips).toBe(clips);
    expect(clips.prefetched).toEqual([7]);
    expect(prefetchAllowed()).toBe(true);

    render(null, root);
    resetStoreForTests();
    resetServices();
    const saver = fakeClips();
    const saverStorage = await seeded({ ...ACTIVE, progress: { station: 7 }, settings: { dataSaver: true } });
    await boot(root, { storage: saverStorage, now, audio: true, clips: saver, overlays: false, sw: false });
    await audioInstalled();
    await flush();
    expect(services.audio.clips).toBe(saver);
    expect(saver.loaded).toEqual([7]);
    expect(saver.prefetched).toEqual([]);
    expect(prefetchAllowed()).toBe(false);

    render(null, root);
    resetStoreForTests();
    resetServices();
    const browserSaver = fakeClips();
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    try {
      expect(saveDataRequested()).toBe(true);
      const s3 = await seeded({ ...ACTIVE, progress: { station: 7 } });
      await boot(root, { storage: s3, now, audio: true, clips: browserSaver, overlays: false, sw: false });
      await audioInstalled();
      await flush();
      expect(browserSaver.loaded).toEqual([7]);
      expect(browserSaver.prefetched).toEqual([]);
    } finally {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
    }
    expect(saveDataRequested()).toBe(false);
  });

  it('station 0 (onboarding) prefetches Station 1; clips: null installs the device voice alone', async () => {
    const clips = fakeClips();
    const storage = await seeded({ profile: { name: '' }, progress: { station: 0 } });
    await boot(root, { storage, now, audio: true, clips, overlays: false, sw: false });
    await audioInstalled();
    await flush();
    expect(clips.loaded).toEqual([1]);
    expect(clips.prefetched).toEqual([1]);

    render(null, root);
    resetStoreForTests();
    resetServices();
    const plain = await seeded(ACTIVE);
    await boot(root, { storage: plain, now, audio: true, clips: null, overlays: false, sw: false });
    await audioInstalled();
    await flush();
    expect(services.audio).not.toBe(nullAudio);
    expect(services.audio.clips).toBeUndefined();
    expect(services.audio.packReady?.value).toBe(false);
  });
});
