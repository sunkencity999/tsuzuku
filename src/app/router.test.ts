import { installServices, nullAudio, resetServices, type AudioService } from '@/shared/audio';
import { navigate, route, syncRouteFromLocation, titleFor } from '@/shared/routes';
import { SCROLL_OPTIONS, resetScrollPositions, restoreScroll, savedScroll, startRouter } from './router';

let scrollY = 0;
let scrollTo: ReturnType<typeof vi.fn>;
let stop: (() => void) | null = null;

function fakeAudio(): AudioService & { cancel: ReturnType<typeof vi.fn> } {
  return { ...nullAudio, cancel: vi.fn() };
}

async function frames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  scrollY = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  scrollTo = vi.fn((o: ScrollToOptions) => {
    scrollY = o.top ?? 0;
  });
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
  resetScrollPositions();
  // jsdom's rAF ticks at 16 ms; make frames deterministic for the test
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number);
  location.hash = '#/';
  syncRouteFromLocation();
});

afterEach(() => {
  stop?.();
  stop = null;
  resetServices();
  vi.unstubAllGlobals();
  location.hash = '';
});

describe('startRouter', () => {
  it('hashchange updates the route signal and the document title', async () => {
    stop = startRouter();
    expect(route.value.name).toBe('dojo');
    location.hash = '#/records';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(route.value.name).toBe('records');
    expect(document.title).toBe(titleFor({ name: 'records' }));
  });

  it('calls services.audio.cancel() on navigation, not on start', () => {
    const audio = fakeAudio();
    installServices({ audio });
    stop = startRouter();
    expect(audio.cancel).not.toHaveBeenCalled();
    navigate({ name: 'road' });
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    navigate({ name: 'road' }); // same route: no-op
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    navigate({ name: 'settings' });
    expect(audio.cancel).toHaveBeenCalledTimes(2);
  });

  it('a throwing audio service never breaks navigation', () => {
    installServices({
      audio: {
        ...nullAudio,
        cancel: () => {
          throw new Error('boom');
        },
      },
    });
    stop = startRouter();
    expect(() => navigate({ name: 'library' })).not.toThrow();
    expect(route.value.name).toBe('library');
  });

  it('remembers scrollY per route at the hash change and never scrolls on its own: the old page must not jump while the next loads', async () => {
    stop = startRouter();
    scrollY = 420; // scrolled down the dojo
    navigate({ name: 'road' });
    expect(savedScroll({ name: 'dojo' })).toBe(420);
    await frames();
    expect(scrollTo).not.toHaveBeenCalled(); // the restore is PageHost's, after the commit
    expect(scrollY).toBe(420);
    // PageHost: a fresh route lands at the top
    restoreScroll({ name: 'road' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    scrollY = 77;
    navigate({ name: 'dojo' });
    expect(savedScroll({ name: 'road' })).toBe(77);
    await frames();
    restoreScroll({ name: 'dojo' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'instant' });
    expect(scrollY).toBe(420);
  });

  it('restoreScroll() can be called by a late-mounting page', () => {
    stop = startRouter();
    scrollY = 300;
    navigate({ name: 'records' });
    scrollTo.mockClear();
    scrollY = 0; // the new page rendered at the top
    restoreScroll({ name: 'dojo' });
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'instant' });
    restoreScroll({ name: 'about' });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    scrollTo.mockClear();
    restoreScroll({ name: 'about' }); // already at the top: no redundant call
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("every scroll is `behavior: 'instant'` (design 09 §6.4): the smooth-scroll glide never runs between pages", async () => {
    expect(SCROLL_OPTIONS).toEqual({ behavior: 'instant' });
    stop = startRouter();
    scrollY = 250;
    navigate({ name: 'records' });
    await frames();
    restoreScroll({ name: 'records' });
    scrollY = 0;
    restoreScroll({ name: 'dojo' });
    for (const call of scrollTo.mock.calls) {
      expect(call.length).toBe(1);
      expect(call[0]).toMatchObject({ behavior: 'instant' });
      expect(typeof call[0].top).toBe('number');
    }
    expect(scrollTo).toHaveBeenCalled();
  });

  it('the disposer removes the hashchange listener', () => {
    const audio = fakeAudio();
    installServices({ audio });
    stop = startRouter();
    stop();
    stop = null;
    navigate({ name: 'records' });
    // the signal still moves (routes.ts owns it) but our effect is gone: no cancel()
    expect(route.value.name).toBe('records');
    expect(audio.cancel).not.toHaveBeenCalled();
  });
});
