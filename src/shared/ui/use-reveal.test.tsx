import { render, type JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { resetStoreForTests, store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { WILL_CHANGE_CLEAR_MS, prefersReducedMotion, transientWillChange, useReveal, type RevealOptions } from './use-reveal';

type IOCallback = (entries: Partial<IntersectionObserverEntry>[], observer: IntersectionObserver) => void;

/** A recording IntersectionObserver double; `fire(visible)` delivers one entry. */
function installObserver(): { instances: { cb: IOCallback; observed: Element[]; disconnected: number; options?: IntersectionObserverInit }[] } {
  const instances: { cb: IOCallback; observed: Element[]; disconnected: number; options?: IntersectionObserverInit }[] = [];
  class FakeIO {
    inst: (typeof instances)[number];
    constructor(cb: IOCallback, options?: IntersectionObserverInit) {
      this.inst = { cb, observed: [], disconnected: 0, options };
      instances.push(this.inst);
    }
    observe(el: Element): void {
      this.inst.observed.push(el);
    }
    disconnect(): void {
      this.inst.disconnected++;
    }
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIO);
  return { instances };
}

function Probe(p: { options?: RevealOptions }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useReveal(ref, p.options);
  return <div ref={ref} id="probe" data-revealed={revealed ? '' : undefined} />;
}

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.useFakeTimers();
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetStoreForTests();
});

const probe = (): HTMLElement => root.querySelector<HTMLElement>('#probe')!;

describe('useReveal (design 09 §7 E)', () => {
  it('is true at once where IntersectionObserver is absent (jsdom): nothing waits on a decoration', () => {
    expect(typeof IntersectionObserver).toBe('undefined');
    act(() => render(<Probe />, root));
    expect(probe().hasAttribute('data-revealed')).toBe(true);
  });

  it('with the observer: false until the element crosses the threshold (default .5), then true once and disconnected', () => {
    const io = installObserver();
    act(() => render(<Probe />, root));
    expect(probe().hasAttribute('data-revealed')).toBe(false);
    expect(io.instances.length).toBe(1);
    const inst = io.instances[0]!;
    expect(inst.observed).toEqual([probe()]);
    expect(inst.options?.threshold).toBe(0.5);
    act(() => inst.cb([{ isIntersecting: false }], {} as IntersectionObserver));
    expect(probe().hasAttribute('data-revealed')).toBe(false);
    act(() => inst.cb([{ isIntersecting: true }], {} as IntersectionObserver));
    expect(probe().hasAttribute('data-revealed')).toBe(true);
    expect(inst.disconnected).toBeGreaterThanOrEqual(1);
    // one-shot: a later re-render creates no second observer
    act(() => render(<Probe />, root));
    expect(io.instances.length).toBe(1);
  });

  it('sets will-change only for the reveal and clears it when the entrance ends or after the safety timeout', () => {
    const io = installObserver();
    act(() => render(<Probe />, root));
    act(() => io.instances[0]!.cb([{ isIntersecting: true }], {} as IntersectionObserver));
    expect(probe().style.willChange).toBe('opacity, transform');
    act(() => {
      probe().dispatchEvent(new Event('animationend'));
    });
    expect(probe().style.willChange).toBe('');
  });

  it('honours a custom threshold and `immediate`', () => {
    const io = installObserver();
    act(() => render(<Probe options={{ threshold: 0.1, rootMargin: '0px 0px 40px 0px' }} />, root));
    expect(io.instances[0]!.options?.threshold).toBe(0.1);
    expect(io.instances[0]!.options?.rootMargin).toBe('0px 0px 40px 0px');
    render(null, root);
    act(() => render(<Probe options={{ immediate: true }} />, root));
    expect(probe().hasAttribute('data-revealed')).toBe(true);
    expect(io.instances.length).toBe(1);
  });
});

describe('transientWillChange', () => {
  it('clears after WILL_CHANGE_CLEAR_MS when no entrance fires', () => {
    const el = document.createElement('div');
    transientWillChange(el);
    expect(el.style.willChange).toBe('opacity, transform');
    vi.advanceTimersByTime(WILL_CHANGE_CLEAR_MS - 1);
    expect(el.style.willChange).toBe('opacity, transform');
    vi.advanceTimersByTime(2);
    expect(el.style.willChange).toBe('');
  });
});

describe('prefersReducedMotion', () => {
  it('reads the store setting OR the media query, and is false when neither says so', async () => {
    await makeTestStore();
    expect(prefersReducedMotion()).toBe(false);
    store.settings.value = { ...store.settings.value, reducedMotion: true };
    expect(prefersReducedMotion()).toBe(true);
    store.settings.value = { ...store.settings.value, reducedMotion: false };
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('never throws before the store is initialised', () => {
    resetStoreForTests();
    expect(() => prefersReducedMotion()).not.toThrow();
  });
});
