import { render } from 'preact';
import { act } from 'preact/test-utils';
import { resetStoreForTests, store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { TICKER_MAX_MS, TICKER_MIN_MS, Ticker, activeFrameJobs, easeOut, resetFrameSchedulerForTests, scheduleFrame, tickerDuration } from './Ticker';

let root: HTMLDivElement;
let rafSpy: ReturnType<typeof vi.fn>;
/** Queued frame callbacks; `frame(t)` runs them at time `t`. */
let queue: FrameRequestCallback[] = [];

function frame(t: number): void {
  const cbs = queue;
  queue = [];
  act(() => {
    for (const cb of cbs) cb(t);
  });
}

beforeEach(async () => {
  root = document.createElement('div');
  document.body.appendChild(root);
  queue = [];
  rafSpy = vi.fn((cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await makeTestStore();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetFrameSchedulerForTests();
  resetStoreForTests();
  vi.unstubAllGlobals();
});

const value = (): string => root.querySelector('.ticker__value')?.textContent ?? '';
const roll = (): HTMLElement | null => root.querySelector('.ticker__roll');

describe('<Ticker> (design 09 §5.8)', () => {
  it('renders the final digits in the DOM at once, in tabular figures, and never rolls on first paint', () => {
    act(() => render(<Ticker value={42} />, root));
    expect(value()).toBe('42');
    expect(root.querySelector('.ticker')?.textContent).toBe('42');
    expect(root.querySelector<HTMLElement>('.ticker')?.style.fontVariantNumeric).toBe('tabular-nums');
    expect(roll()).toBeNull();
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('on a change the DOM text is the final value immediately while an aria-hidden twin rolls from the previous one, then the twin goes', () => {
    act(() => render(<Ticker value={10} />, root));
    act(() => render(<Ticker value={20} />, root));
    expect(value()).toBe('20');
    expect(root.querySelector('.ticker')?.hasAttribute('data-ticking')).toBe(true);
    expect(roll()?.getAttribute('aria-hidden')).toBe('true');
    expect(rafSpy).toHaveBeenCalledTimes(1);
    frame(1000); // start
    expect(roll()?.textContent).toBe('10');
    frame(1000 + TICKER_MAX_MS / 2);
    const mid = Number(roll()?.textContent);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(20);
    frame(1000 + TICKER_MAX_MS + 1);
    expect(roll()).toBeNull();
    expect(root.querySelector('.ticker')?.hasAttribute('data-ticking')).toBe(false);
    expect(root.querySelector('.ticker')?.textContent).toBe('20');
    expect(activeFrameJobs()).toBe(0);
  });

  it('uses the caller’s format for both the value and the twin', () => {
    const fmt = (n: number): string => `${Math.round(n)} XP`;
    act(() => render(<Ticker value={0} format={fmt} />, root));
    act(() => render(<Ticker value={30} format={fmt} />, root));
    expect(value()).toBe('30 XP');
    frame(0);
    expect(roll()?.textContent).toBe('0 XP');
  });

  it('under reduced motion (store setting) the value is set at once and no animation frame is requested', () => {
    store.settings.value = { ...store.settings.value, reducedMotion: true };
    act(() => render(<Ticker value={1} />, root));
    act(() => render(<Ticker value={99} />, root));
    expect(value()).toBe('99');
    expect(roll()).toBeNull();
    expect(rafSpy).not.toHaveBeenCalled();
    expect(activeFrameJobs()).toBe(0);
  });

  it('while the tab is hidden pending rolls snap to the end instead of running a frame loop (§6.7 rule 5)', () => {
    act(() => render(<Ticker value={1} />, root));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => render(<Ticker value={5} />, root));
    expect(rafSpy).not.toHaveBeenCalled();
    expect(roll()).toBeNull();
    expect(value()).toBe('5');
  });

  it('two tickers share one requestAnimationFrame per frame', () => {
    act(() =>
      render(
        <>
          <Ticker value={1} class="a" />
          <Ticker value={1} class="b" />
        </>,
        root,
      ),
    );
    act(() =>
      render(
        <>
          <Ticker value={9} class="a" />
          <Ticker value={9} class="b" />
        </>,
        root,
      ),
    );
    expect(activeFrameJobs()).toBe(2);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    frame(0);
    expect(rafSpy).toHaveBeenCalledTimes(2);
    frame(TICKER_MAX_MS + 1);
    expect(activeFrameJobs()).toBe(0);
    expect(Array.from(root.querySelectorAll('.ticker')).map((t) => t.textContent)).toEqual(['9', '9']);
  });

  it('adds data-roll for the Kage cabinet', () => {
    act(() => render(<Ticker value={3} roll />, root));
    expect(root.querySelector('.ticker')?.hasAttribute('data-roll')).toBe(true);
  });
});

describe('scheduler helpers', () => {
  it('scheduleFrame runs a job each frame until it returns false; the canceller drops it', () => {
    const seen: number[] = [];
    scheduleFrame((t) => {
      seen.push(t);
      return t < 2;
    });
    const cancel = scheduleFrame(() => true);
    expect(activeFrameJobs()).toBe(2);
    frame(1);
    frame(2);
    expect(seen).toEqual([1, 2]);
    expect(activeFrameJobs()).toBe(1);
    cancel();
    expect(activeFrameJobs()).toBe(0);
  });

  it('a throwing job is dropped and never blocks the others', () => {
    let ran = 0;
    scheduleFrame(() => {
      throw new Error('boom');
    });
    scheduleFrame(() => {
      ran++;
      return false;
    });
    frame(0);
    expect(ran).toBe(1);
    expect(activeFrameJobs()).toBe(0);
  });

  it('easeOut starts fast and lands exactly at 1; durations run 160–400 ms by delta', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(tickerDuration(1)).toBe(TICKER_MIN_MS);
    expect(tickerDuration(-1)).toBe(TICKER_MIN_MS);
    expect(tickerDuration(10)).toBe(TICKER_MAX_MS);
    expect(tickerDuration(1000)).toBe(TICKER_MAX_MS);
    expect(tickerDuration(5)).toBeGreaterThan(TICKER_MIN_MS);
    expect(tickerDuration(5)).toBeLessThan(TICKER_MAX_MS);
  });
});
