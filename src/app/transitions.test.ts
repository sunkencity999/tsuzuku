import { syncRouteFromLocation, type Route } from '@/shared/routes';
import { resetStoreForTests, store } from '@/store';
import { makeTestStore } from '@/store/testing';
import {
  afterPaint,
  canTransition,
  cleanupTransition,
  COMMIT_TIMEOUT_MS,
  commitGate,
  ENTER_CLASSES,
  fallbackEnter,
  heroFor,
  isCeremonyOpen,
  nameNewHeroes,
  prepareTransition,
  resetTransitionsForTests,
  setCeremonyProbe,
  shownRoute,
  transitionToken,
  travelOf,
  viewTransitionApi,
} from './transitions';

/** `document` without lib.dom's typed `startViewTransition`, so a fake can be installed and removed. */
type Doc = { startViewTransition?: unknown };

const dojo: Route = { name: 'dojo' };
const road: Route = { name: 'road' };
const station = (n: number): Route => ({ name: 'station', n });
const train: Route = { name: 'train', mode: 'kata' };

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0) as unknown as number);
});
afterEach(() => {
  root.remove();
  resetTransitionsForTests();
  delete (document as unknown as Doc).startViewTransition;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  resetStoreForTests();
  vi.unstubAllGlobals();
});

describe('travelOf (design 09 §6.4)', () => {
  it('follows the nav order: dojo < road < library < collections < records < settings', () => {
    expect(travelOf(dojo, road)).toBe('forward');
    expect(travelOf(road, { name: 'library' })).toBe('forward');
    expect(travelOf({ name: 'library' }, { name: 'collections', tab: 'mon' })).toBe('forward');
    expect(travelOf({ name: 'records' }, { name: 'settings' })).toBe('forward');
    expect(travelOf({ name: 'settings' }, { name: 'records' })).toBe('back');
    expect(travelOf({ name: 'collections', tab: 'mon' }, road)).toBe('back');
  });

  it('children hang under their section: deeper is forward, back up is back', () => {
    expect(travelOf(road, station(3))).toBe('forward');
    expect(travelOf(station(3), road)).toBe('back');
    expect(travelOf(station(3), station(4))).toBe('forward');
    expect(travelOf({ name: 'records' }, { name: 'ledger' })).toBe('forward');
    expect(travelOf({ name: 'about' }, { name: 'settings' })).toBe('back');
    expect(travelOf({ name: 'story', id: 's-01' }, { name: 'library' })).toBe('back'); // story under library
    expect(travelOf(dojo, { name: 'radio' })).toBe('forward'); // radio under dojo
    expect(travelOf({ name: 'backup' }, road)).toBe('back'); // settings → road
  });

  it('sessions go in and out: train / gate / shinsa', () => {
    expect(travelOf(dojo, train)).toBe('in');
    expect(travelOf(road, { name: 'gate', n: 2 })).toBe('in');
    expect(travelOf(station(2), { name: 'shinsa', belt: 'yellow' })).toBe('in');
    expect(travelOf(train, dojo)).toBe('out'); // the End Card's Rest, the calmest motion in the app
    expect(travelOf({ name: 'gate', n: 2 }, road)).toBe('out');
    expect(travelOf(train, { name: 'train', mode: 'kumite' })).toBe('forward');
  });

  it('home is any turn to the dojo that is not a session exit', () => {
    expect(travelOf(road, dojo)).toBe('home');
    expect(travelOf({ name: 'settings' }, dojo)).toBe('home');
    expect(travelOf({ name: 'radio' }, dojo)).toBe('home');
    expect(travelOf({ name: 'onboarding' }, dojo)).toBe('home');
  });

  it('the arrival (no previous page) is home for the dojo and none for a deep link; the same route is none', () => {
    expect(travelOf(null, dojo)).toBe('home');
    expect(travelOf(undefined, dojo)).toBe('home');
    expect(travelOf(null, road)).toBe('none');
    expect(travelOf(road, road)).toBe('none');
    expect(travelOf(station(3), station(3))).toBe('none');
  });
});

describe('heroFor (design 09 §6.4 table)', () => {
  it('boot → dojo carries the ensō; road → station the seal; train → dojo the つづく mark', () => {
    expect(heroFor(null, dojo)).toEqual([{ name: 'enso', from: '.app-loading__mark', to: '.dojo__hero, .dojo-scene__art' }]);
    const [seal] = heroFor(road, station(7));
    expect(seal?.name).toBe('station-seal');
    expect(seal?.from).toContain('[data-station="7"]');
    expect(seal?.to).toBe('.station-head .sign');
    expect(heroFor(train, dojo)).toEqual([{ name: 'tsuzuku-mark', from: '.end-card__brush', to: '.dojo-scene__hotspot--hearth, .seal-tile[data-tile="days"]' }]);
  });

  it('other pairs have no hero (chrome holds still, main turns)', () => {
    expect(heroFor(dojo, road)).toEqual([]);
    expect(heroFor(null, road)).toEqual([]);
    expect(heroFor(station(3), road)).toEqual([]);
  });

  it('the Dojo landings exist in every stage mode (prints B2): with the print (or the waiting mat) up the ensō lands on the picture slot and the つづく mark on the days seal; with the drawn room up, on its art and its hearth as before', () => {
    root.innerHTML = '<div class="dojo__hero dojo__hero-wait"></div><ul class="dojo__shelf"><li><a class="seal-tile" data-tile="days" href="#/records"></a></li></ul>';
    nameNewHeroes(null, dojo);
    nameNewHeroes(train, dojo);
    expect(root.querySelector<HTMLElement>('.dojo__hero')?.style.getPropertyValue('view-transition-name')).toBe('enso');
    expect(root.querySelector<HTMLElement>('.seal-tile')?.style.getPropertyValue('view-transition-name')).toBe('tsuzuku-mark');
    cleanupTransition();
    expect(root.querySelector<HTMLElement>('.dojo__hero')?.style.getPropertyValue('view-transition-name')).toBe('');
    root.innerHTML = '<div class="dojo-scene__art"></div><a class="dojo-scene__hotspot--hearth" href="#/records"></a>';
    nameNewHeroes(null, dojo);
    nameNewHeroes(train, dojo);
    expect(root.querySelector<HTMLElement>('.dojo-scene__art')?.style.getPropertyValue('view-transition-name')).toBe('enso');
    expect(root.querySelector<HTMLElement>('.dojo-scene__hotspot--hearth')?.style.getPropertyValue('view-transition-name')).toBe('tsuzuku-mark');
    cleanupTransition();
  });
});

describe('canTransition', () => {
  it('is false without the API (jsdom), true with it, and false for a pair with no travel', async () => {
    await makeTestStore();
    expect(viewTransitionApi()).toBeNull();
    expect(canTransition(dojo, road)).toBe(false);
    (document as unknown as Doc).startViewTransition = vi.fn();
    expect(viewTransitionApi()).not.toBeNull();
    expect(canTransition(dojo, road)).toBe(true);
    expect(canTransition(road, road)).toBe(false);
    expect(canTransition(null, road)).toBe(false);
    expect(canTransition(null, dojo)).toBe(true);
  });

  it('skips the API under reduced motion (store setting), a hidden tab, or an open ceremony', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true } } });
    (document as unknown as Doc).startViewTransition = vi.fn();
    expect(canTransition(dojo, road)).toBe(false);
    store.settings.value = { ...store.settings.value, reducedMotion: false };
    expect(canTransition(dojo, road)).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    expect(canTransition(dojo, road)).toBe(false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    expect(isCeremonyOpen()).toBe(false);
    setCeremonyProbe(() => true);
    expect(isCeremonyOpen()).toBe(true);
    expect(canTransition(dojo, road)).toBe(false);
    setCeremonyProbe(() => {
      throw new Error('boom');
    });
    expect(isCeremonyOpen()).toBe(false);
    setCeremonyProbe(null);
    expect(canTransition(dojo, road)).toBe(true);
  });
});

describe('commitGate (the update callback\'s promise)', () => {
  it('settles when the post-commit effect says so — idempotent, no frame involved', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn()); // never called: a frame cannot fire while the callback is pending
    const g = commitGate();
    let done = false;
    void g.promise.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(g.settled).toBe(false);
    expect(done).toBe(false);
    g.settle();
    g.settle();
    expect(g.settled).toBe(true);
    await g.promise;
    expect(done).toBe(true);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('settles itself after the safety timeout, shorter than the browser\'s ~4 s skip', async () => {
    vi.useFakeTimers();
    try {
      const g = commitGate();
      vi.advanceTimersByTime(COMMIT_TIMEOUT_MS - 1);
      expect(g.settled).toBe(false);
      vi.advanceTimersByTime(1);
      expect(g.settled).toBe(true);
      expect(COMMIT_TIMEOUT_MS).toBeLessThan(4000);
      const g2 = commitGate(50);
      g2.settle();
      vi.advanceTimersByTime(100); // the cleared timer does nothing
      expect(g2.settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('afterPaint', () => {
  it('resolves after two animation frames, not before', async () => {
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      frames++;
      return setTimeout(() => fn(frames), 0) as unknown as number;
    });
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(frames).toBe(2);
    expect(settled).toBe(false); // the second frame's callback has queued, the promise settles after it
    await p;
    expect(settled).toBe(true);
  });
});

describe('prepareTransition / nameNewHeroes / cleanupTransition', () => {
  it('writes html[data-travel] and the hero name on the old element, then the new one, and clears both', () => {
    root.innerHTML = '<span class="app-loading__mark">つづく</span>';
    const travel = prepareTransition(null, dojo);
    expect(travel).toBe('home');
    expect(document.documentElement.getAttribute('data-travel')).toBe('home');
    const mark = root.querySelector<HTMLElement>('.app-loading__mark')!;
    expect(mark.style.getPropertyValue('view-transition-name')).toBe('enso');
    root.innerHTML = '<div class="dojo-scene__art"></div>';
    nameNewHeroes(null, dojo);
    const art = root.querySelector<HTMLElement>('.dojo-scene__art')!;
    expect(art.style.getPropertyValue('view-transition-name')).toBe('enso');
    cleanupTransition();
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
    expect(art.style.getPropertyValue('view-transition-name')).toBe('');
    expect(mark.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('a hero whose element is absent is skipped without throwing', () => {
    expect(() => prepareTransition(road, station(2))).not.toThrow();
    expect(document.documentElement.getAttribute('data-travel')).toBe('forward');
    expect(() => nameNewHeroes(road, station(2))).not.toThrow();
    cleanupTransition();
  });

  it('a stale token cleans nothing: a rapid second turn keeps the state its own prepareTransition set', () => {
    root.innerHTML = '<span class="app-loading__mark"></span>';
    prepareTransition(null, dojo);
    const first = transitionToken();
    prepareTransition(dojo, train); // the second turn, prepared before the first one finished
    const second = transitionToken();
    expect(second).not.toBe(first);
    cleanupTransition(first); // the first turn's `finished`
    expect(document.documentElement.getAttribute('data-travel')).toBe('in');
    expect(root.querySelector<HTMLElement>('.app-loading__mark')?.style.getPropertyValue('view-transition-name')).toBe('enso');
    cleanupTransition(second);
    expect(document.documentElement.hasAttribute('data-travel')).toBe(false);
    expect(root.querySelector<HTMLElement>('.app-loading__mark')?.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('shownRoute starts null and is reset for tests', () => {
    expect(shownRoute.value).toBeNull();
    shownRoute.value = road;
    resetTransitionsForTests();
    expect(shownRoute.value).toBeNull();
  });
});

describe('fallbackEnter', () => {
  it('adds .page-enter and the nijimi verb to every child of main and removes them when the animation ends', () => {
    root.innerHTML = '<main class="layout__main"><section id="a"></section><aside id="b"></aside></main>';
    expect(fallbackEnter()).toBe(2);
    const a = root.querySelector<HTMLElement>('#a')!;
    for (const c of ENTER_CLASSES) expect(a.classList.contains(c)).toBe(true);
    expect(root.querySelector('#b')?.classList.contains('page-enter')).toBe(true);
    a.dispatchEvent(new Event('animationend'));
    expect(a.classList.contains('page-enter')).toBe(false);
    expect(a.classList.contains('ink-nijimi')).toBe(false);
    expect(root.querySelector('#b')?.classList.contains('page-enter')).toBe(true);
  });

  it("ignores a child's bubbled animationend (a chip's entrance ending first must not cut the page's)", () => {
    root.innerHTML = '<main class="layout__main"><section id="a"><span id="chip"></span></section></main>';
    fallbackEnter();
    const a = root.querySelector<HTMLElement>('#a')!;
    root.querySelector('#chip')!.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(a.classList.contains('ink-nijimi')).toBe(true);
    a.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(a.classList.contains('ink-nijimi')).toBe(false);
    // the listener is gone with the classes: a later event changes nothing and throws nothing
    expect(() => a.dispatchEvent(new Event('animationend'))).not.toThrow();
  });

  it('accepts another selector (the plain arrival uses .layout) and returns 0 when nothing matches', () => {
    root.innerHTML = '<div class="layout"></div>';
    expect(fallbackEnter('.layout')).toBe(1);
    expect(fallbackEnter('.nothing-here')).toBe(0);
  });
});
