import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import type { CardTuple } from '../shared/store-types';
import { epochDay } from '../shared/time';
import { resetStoreForTests, store } from '../store/store';
import { DEFAULT_TEST_NOW, MemoryStorage, card, makeTestStore } from '../store/testing';
import { PeraperaRadar, RADAR_MORPH_KEY, claimRadarMorph, earlierMonths, resetRadarMorphForTests } from './PeraperaRadar';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  // Node ≥ 22 defines a flag-gated `localStorage` global that jsdom cannot override: stand a real Storage in for it
  vi.stubGlobal('localStorage', new MemoryStorage());
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetRadarMorphForTests();
  bus.reset();
  vi.unstubAllGlobals();
});

function mount(): void {
  act(() => render(<PeraperaRadar />, root));
}

describe('<PeraperaRadar>', () => {
  it('renders the five axis labels, the synthetic + estimated + reported flags, and 場 as — before Station 21', async () => {
    await makeTestStore({ save: { progress: { station: 5 }, settings: { speaking: 'self' } } });
    mount();
    const dts = Array.from(root.querySelectorAll('.perapera__axis dt [lang="ja"]')).map((e) => e.textContent);
    expect(dts).toEqual(['語彙', '耳', '読', '口', '—']);
    const flags = Array.from(root.querySelectorAll('.perapera__flags .tag')).map((e) => e.textContent);
    expect(flags).toEqual(['(synthetic)', '(estimated)', '(reported)']);
    expect(root.querySelector('.perapera__axis--off')).not.toBeNull();
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toContain('語彙');
    expect(root.querySelectorAll('polygon.chart__radar-now')).toHaveLength(1);
    expect(root.querySelector('polygon.chart__radar-history')).toBeNull();
    expect(root.querySelector('.perapera__note')?.textContent).toBeTruthy();
  });

  it('shows (no voice) with speaking off and 場 numbers from Station 21', async () => {
    await makeTestStore({ save: { progress: { station: 21 }, settings: { speaking: 'off' }, stats: { rolePlays: 10, rolePlaysAllBest: 5, threeWays: 10, threeWaysCorrect: 10 } } });
    mount();
    const flags = Array.from(root.querySelectorAll('.perapera__flags .tag')).map((e) => e.textContent);
    expect(flags).toEqual(['(synthetic)', '(no voice)', '(reported)']);
    const values = Array.from(root.querySelectorAll('.perapera__axis-value')).map((e) => e.textContent);
    expect(values[3]).toBe('—'); // 口 excluded with voice off
    expect(values[4]).toBe('75'); // 50 · 0.5 + 50 · 1.0
  });

  it('reads vocabulary cards and overlays the earlier month as the dashed history polygon', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (let i = 0; i < 20; i++) cards[`v-n5-${String(i + 1).padStart(4, '0')}#rec`] = card({ due: TODAY + 30, s: 60, reps: 5, state: 2, last: TODAY });
    await makeTestStore({
      cards,
      save: { perapera: { months: { '2025-12': [3, 40, 0, 0, 0], '2026-01': [9, 9, 9, 9, 9] } } },
    });
    mount();
    expect(root.querySelector('polygon.chart__radar-history')).not.toBeNull();
    const explain = root.querySelector('.perapera__axis dd')?.textContent ?? '';
    expect(explain).toContain('20 receptive');
    expect(root.querySelector('.perapera__history')).not.toBeNull();
    const histRows = Array.from(root.querySelectorAll('.perapera__history tbody th')).map((e) => e.textContent);
    expect(histRows).toEqual(['2025-12']); // the current month's own snapshot is not "earlier"
    expect(root.querySelector('.chart__legend')?.textContent).toContain('Last month');
  });

  it('re-renders when the store changes (composite follows the stats)', async () => {
    await makeTestStore({ save: { progress: { station: 5 } } });
    mount();
    const before = root.querySelector('.perapera__composite-num')?.textContent;
    act(() => {
      store.patch('stats', (s) => ({ ...s, speedReadBestCpm: 500 }));
    });
    const after = root.querySelector('.perapera__composite-num')?.textContent;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it('earlierMonths drops the current month and anything later', () => {
    const rows = [
      { month: '2025-11', axes: [1, 1, 1, 1, 1] as [number, number, number, number, number] },
      { month: '2026-01', axes: [2, 2, 2, 2, 2] as [number, number, number, number, number] },
      { month: '2026-02', axes: [3, 3, 3, 3, 3] as [number, number, number, number, number] },
    ];
    expect(earlierMonths(rows, '2026-01').map((r) => r.month)).toEqual(['2025-11']);
  });

  it('claimRadarMorph: once per month, only with an earlier snapshot (design 09 §8 "the month")', () => {
    expect(claimRadarMorph('2026-01', false)).toBe(false);
    expect(claimRadarMorph('2026-01', true)).toBe(true);
    expect(claimRadarMorph('2026-01', true)).toBe(false);
    expect(claimRadarMorph('2026-02', true)).toBe(true);
    resetRadarMorphForTests();
    expect(claimRadarMorph('2026-02', true)).toBe(true);
  });

  it('the morphed month rests in localStorage (not the save), so a relaunch in the same month never replays it', () => {
    expect(localStorage.getItem(RADAR_MORPH_KEY)).toBeNull();
    expect(claimRadarMorph('2026-01', true)).toBe(true);
    expect(localStorage.getItem(RADAR_MORPH_KEY)).toBe('2026-01');
    // a fresh module memory (a new launch) reads the stored month back
    resetRadarMorphForTests();
    localStorage.setItem(RADAR_MORPH_KEY, '2026-01');
    expect(claimRadarMorph('2026-01', true)).toBe(false);
    expect(claimRadarMorph('2026-02', true)).toBe(true);
    expect(localStorage.getItem(RADAR_MORPH_KEY)).toBe('2026-02');
    // a foreign value is ignored
    resetRadarMorphForTests();
    localStorage.setItem(RADAR_MORPH_KEY, 'not a month');
    expect(claimRadarMorph('2026-02', true)).toBe(true);
    expect(sessionStorage.getItem(RADAR_MORPH_KEY)).toBeNull();
  });
});
