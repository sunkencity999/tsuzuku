import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { createFakeLoader } from '../../content/fixtures';
import type { CardKey } from '../../content/types';
import { findBanned } from '../../i18n/banned-phrases';
import { bus } from '../../shared/events';
import type { CardTuple, DailyRow, EpochDay } from '../../shared/store-types';
import { epochDay } from '../../shared/time';
import { resetStoreForTests } from '../../store/store';
import { resetFrameSchedulerForTests } from '../../shared/ui/Ticker';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../../store/testing';
import { RADAR_MORPH_CLASS } from '../charts';
import { resetRadarMorphForTests } from '../PeraperaRadar';
import RecordsPage, { beltTargetLabel, nextStepLine } from './RecordsPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROUTE = { name: 'records' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetRadarMorphForTests();
  resetFrameSchedulerForTests();
  bus.reset();
  vi.unstubAllGlobals();
});

const MONTHS = { '2025-12': [30, 40, 20, 10, 0] as [number, number, number, number, number] };

function activeRows(n: number, reps = 30): Record<EpochDay, DailyRow> {
  const out: Record<EpochDay, DailyRow> = {};
  for (let i = 0; i < n; i++) out[TODAY - i] = { reps, ok: Math.round(reps * 0.9), minutes: 12, xp: 100, input: 0 };
  return out;
}

async function mount(): Promise<void> {
  const loader = createFakeLoader();
  await act(async () => {
    render(<RecordsPage route={ROUTE} loader={loader} />, root);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('<RecordsPage>', () => {
  it('renders the two projection lines from a 20-active-day store, with the band and never a countdown', async () => {
    const cards: Record<CardKey, CardTuple> = {
      'v-n5-0001#rec': card({ due: TODAY + 3, s: 20, reps: 4, state: 2, last: TODAY - 2 }),
    };
    await makeTestStore({
      cards,
      save: { daily: activeRows(20), streak: { totalDays: 20, current: 20, longest: 20, lastDay: TODAY }, progress: { station: 4 }, profile: { belt: 'yellow' } },
    });
    await mount();
    const line = root.querySelector('.records__projection-line')?.textContent ?? '';
    expect(line).toContain('Sanjō Ōhashi:');
    expect(line).toContain('at your current pace');
    expect(line).toContain('at daily practice');
    expect(line).toMatch(/\b20\d\d\b/);
    const proj = root.querySelector('.records__projection')?.textContent ?? '';
    expect(proj).toContain('Give or take 20 %');
    expect(proj).toContain('Last 28 days: 20 active');
    expect(proj).toContain('counted from their quotas');
    expect(proj).not.toMatch(/days? (left|remaining)/i);
    expect(root.querySelector('.records__onboarding')).toBeNull();
    // Belt timeline: every belt listed, yellow marked current, ETAs on the belts ahead.
    const rows = Array.from(root.querySelectorAll('.belts__row'));
    expect(rows).toHaveLength(8);
    expect(rows[1]?.classList.contains('belts__row--current')).toBe(true);
    expect(rows[1]?.textContent).toContain('at your pace');
    expect(rows[7]?.textContent).toContain('Black belt');
  });

  it('shows the onboarding estimates under 14 active days', async () => {
    await makeTestStore({ save: { daily: activeRows(5), streak: { totalDays: 5 }, progress: { station: 1 } } });
    await mount();
    const onb = root.querySelector('.records__onboarding');
    expect(onb).not.toBeNull();
    const text = onb?.textContent ?? '';
    expect(text).toContain('at daily practice');
    expect(text).toContain('at seven days in ten');
    expect(text).toContain('in-app hours');
    expect(text).toContain('5 of 14 active days so far');
    expect(root.querySelector('.records__projection')).toBeNull();
  });

  it('tiles show days, minutes, reviews, retention and honesty from the store', async () => {
    await makeTestStore({
      save: {
        daily: activeRows(20),
        streak: { totalDays: 20 },
        stats: { minutes: 240, reviews: 1234, judgeChecks: 50, honesty: 0.96, ippon: 7, bestCombo: 31, recoveries: 3, speedReadBestCpm: 180 },
      },
    });
    await mount();
    const tiles = Array.from(root.querySelectorAll('.records__tiles .tile')).map((t) => `${t.querySelector('.eyebrow')?.textContent}=${t.querySelector('.tile__value')?.textContent}`);
    expect(tiles).toContain('Days trained=20');
    expect(tiles).toContain('Minutes in the dojo=240');
    expect(tiles).toContain('Graded reviews=1,234');
    expect(tiles).toContain('Accuracy, last 7 days=90 %');
    expect(tiles).toContain('正直度 Honesty=96 %');
    expect(root.textContent).toContain('Well calibrated.');
    expect(tiles).toContain('Ippon=7');
    expect(tiles).toContain('Best combo=31');
    expect(root.textContent).toContain('Best Speed Read: 180 cpm');
    expect(root.textContent).toContain('Speaking: untested');
    expect(root.querySelectorAll('.records__bars .bar')).toHaveLength(5);
    expect(root.querySelectorAll('rect.chart__day')).toHaveLength(28);
  });

  it('renders the Perapera radar, the Weak Point map, Kage history and the ledger link', async () => {
    await makeTestStore({ save: { kage: { week: 2900, best4: [40, 55], wins: 1, history: [[2899, 40], [2900, 55]] } } });
    await mount();
    expect(root.querySelector('.perapera')).not.toBeNull();
    expect(root.querySelector('.weakmap')).not.toBeNull();
    expect(root.textContent).toContain('Beaten once');
    expect(root.textContent).toContain('Best of the last four weeks: 55');
    expect(root.querySelector('a[href="#/ledger"]')).not.toBeNull();
  });

  it('Zen hides the Kiai block (no pressure elements), Dojo shows it', async () => {
    await makeTestStore({ save: { settings: { feel: 'zen' } } });
    await mount();
    expect(root.querySelector('#kiai-title')).toBeNull();
    resetStoreForTests();
    await makeTestStore({ save: { settings: { feel: 'dojo' } } });
    render(null, root);
    await mount();
    expect(root.querySelector('#kiai-title')).not.toBeNull();
    expect(root.querySelector('.tile .eyebrow [lang="ja"]')?.textContent).toBe('正直度');
  });

  it('contains no banned phrase and nothing red-alarm in any state', async () => {
    await makeTestStore({ save: { daily: activeRows(20), streak: { totalDays: 20 }, weakPoints: { particle: { n: 30, ewma: 0.4, active: true, peak: 0.4 } } } });
    await mount();
    const text = root.textContent ?? '';
    expect(findBanned(text)).toEqual([]);
    expect(text).not.toContain('!');
  });

  it('a fresh save points at Nihonbashi, not at the ledger', async () => {
    await makeTestStore();
    await mount();
    const text = root.textContent ?? '';
    expect(text).toContain('The road starts at Nihonbashi. One Kata opens it.');
    expect(text).not.toContain('outside the app. Log what you listen to.');
    expect(findBanned(text)).toEqual([]);
    expect(text).not.toContain('!');
  });

  it('nextStepLine picks first session > backlog > due > weak point > ledger > rest', () => {
    expect(nextStepLine({ backlog: false, due: 0, shown: 0, weakTag: null, weekMinutes: 0, weekTargetHours: 0.5, sessions: 0 })).toBe('The road starts at Nihonbashi. One Kata opens it.');
    expect(nextStepLine({ backlog: false, due: 0, shown: 0, weakTag: null, weekMinutes: 0, weekTargetHours: 0.5, sessions: 1 })).toBe('The week is 0 h of 0.5 h outside the app. Log what you listen to.');
    expect(nextStepLine({ backlog: true, due: 310, shown: 120, weakTag: null, weekMinutes: 0, weekTargetHours: 1 })).toBe('The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty.');
    expect(nextStepLine({ backlog: false, due: 12, shown: 12, weakTag: 'particle', weekMinutes: 0, weekTargetHours: 1 })).toBe('12 reviews are due. A Kata takes the first of them.');
    expect(nextStepLine({ backlog: false, due: 1, shown: 1, weakTag: 'particle', weekMinutes: 0, weekTargetHours: 1 })).toBe('1 review is due. A Kata takes it.');
    expect(nextStepLine({ backlog: false, due: 0, shown: 0, weakTag: 'particle', weekMinutes: 0, weekTargetHours: 1 })).toContain('particle');
    expect(nextStepLine({ backlog: false, due: 0, shown: 0, weakTag: null, weekMinutes: 30, weekTargetHours: 1 })).toBe('The week is 0.5 h of 1 h outside the app. Log what you listen to.');
    expect(nextStepLine({ backlog: false, due: 0, shown: 0, weakTag: null, weekMinutes: 90, weekTargetHours: 1 })).toBe('Nothing is due. A Kata keeps the hands warm; rest is also training.');
  });

  it('beltTargetLabel names the belt level and its Shinsa station', () => {
    expect(beltTargetLabel('white')).toBe('kana (Kanagawa)');
    expect(beltTargetLabel('purple')).toBe('N3 (Okazaki)');
    expect(beltTargetLabel('yellow')).toBe('N5 (Odawara)');
  });

  it('tiles are .status-window cartouches whose Dela tickers hold the final value in the DOM from first paint (design 09 §5.5, §5.8)', async () => {
    await makeTestStore({ save: { daily: activeRows(20), streak: { totalDays: 20 }, stats: { minutes: 240, reviews: 1234 } } });
    await mount();
    const tiles = Array.from(root.querySelectorAll<HTMLElement>('.records__tiles .tile'));
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    for (const t of tiles) expect(t.classList.contains('status-window')).toBe(true);
    const reviews = tiles.find((t) => t.querySelector('.eyebrow')?.textContent === 'Graded reviews')!;
    expect(reviews.querySelector('.ticker__value')?.textContent).toBe('1,234');
    expect(reviews.querySelector('.ticker')?.hasAttribute('data-ticking')).toBe(false);
    const ret = tiles.find((t) => t.querySelector('.eyebrow')?.textContent === 'Accuracy, last 7 days')!;
    expect(ret.querySelector('.ticker__value')?.textContent).toBe('90 %');
    const next = root.querySelector('.records__block--next')!;
    expect(next.classList.contains('status-window')).toBe(true);
    // the cartouche's frame is components.css's alone: the page's generic block class (same specificity, later
    // in the cascade) would override its padding, background, double border and radius
    expect(next.classList.contains('records__block')).toBe(false);
    const css = readFileSync(resolve(process.cwd(), 'src/records/pages/RecordsPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const nextRule = /\.records__block--next\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(nextRule).not.toMatch(/\b(border|border-radius|background|padding|clip-path)\s*:/);
    expect(css).not.toMatch(/\.records__block\s*,\s*\.records__block--next|\.records__block--next\s*,/);
    expect(next.querySelector('.records__next')).not.toBeNull();
    expect(root.querySelector('.tile__label')).toBeNull();
    // the forecast bars are .meter tracks (transform, never width)
    for (const track of Array.from(root.querySelectorAll<HTMLElement>('.records__bars .bar__track'))) {
      expect(track.classList.contains('meter')).toBe(true);
      expect(track.querySelector('.meter__fill')).not.toBeNull();
    }
  });

  it('the radar renders both polygons when a previous month exists and morphs the now-polygon once on the frame scheduler', async () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    await makeTestStore({ save: { perapera: { months: MONTHS } } });
    await mount();
    expect(root.querySelector('polygon.chart__radar-history')).not.toBeNull();
    const now = root.querySelector('polygon.chart__radar-now')!;
    expect(now).not.toBeNull();
    expect(now.classList.contains(RADAR_MORPH_CLASS)).toBe(true);
    expect(raf).toHaveBeenCalled();
    // the DOM keeps the real now-polygon as its attribute source
    expect(now.getAttribute('points')?.split(' ')).toHaveLength(5);
  });

  it('under settings.reducedMotion the polygon carries no transition class and both polygons are present at once', async () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    await makeTestStore({ save: { settings: { reducedMotion: true }, perapera: { months: MONTHS } } });
    await mount();
    expect(root.querySelector('polygon.chart__radar-history')).not.toBeNull();
    const now = root.querySelector('polygon.chart__radar-now')!;
    expect(now.classList.contains(RADAR_MORPH_CLASS)).toBe(false);
    expect(root.querySelectorAll('polygon.chart__radar-now')).toHaveLength(1);
    expect(raf).not.toHaveBeenCalled();
  });
});
