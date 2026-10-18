/**
 * RoadPage.tsx — onboarding estimates before fourteen active days, pace lines after; legend, strip, road and the dan link.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATION_4, createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { epochDay } from '../../shared/time';
import type { DailyRow, SaveMeta } from '../../shared/store-types';
import { resetStoreForTests, store } from '../../store';
import { DEFAULT_TEST_NOW, makeTestStore, testSave } from '../../store/testing';
import RoadPage, { KANA_PER_STATION, monthYear, quotaTotal, roadEstimate, roadTargets, spanLabel, targetLabel } from './RoadPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
});

const settle = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

function activeDays(n: number): Record<number, DailyRow> {
  const out: Record<number, DailyRow> = {};
  for (let i = 0; i < n; i++) out[TODAY - i] = { reps: 12, ok: 11, minutes: 6, xp: 30, input: 0 };
  return out;
}

async function mount(): Promise<void> {
  act(() => render(<RoadPage route={{ name: 'road' }} loader={loader} />, root));
  await settle();
}
const text = (): string => root.textContent ?? '';

describe('roadEstimate', () => {
  it('before fourteen active days: onboarding estimates at 100 % and 70 % for the belt exam and Kyoto', () => {
    const m = testSave({ save: { progress: { station: 4 } } });
    const lines = roadEstimate({ meta: m, cards: store.cards, log: [], bundle: null, today: TODAY });
    expect(lines.map((l) => l.target)).toEqual([9, 53]);
    expect(lines.every((l) => l.kind === 'onboarding')).toBe(true);
    const belt = lines[0];
    const kyoto = lines[1];
    if (belt?.kind !== 'onboarding' || kyoto?.kind !== 'onboarding') throw new Error('expected onboarding lines');
    expect(belt.full).toBeGreaterThan(30);
    expect(belt.seventy).toBeGreaterThan(belt.full);
    expect(Math.abs(belt.seventy - belt.full / 0.7)).toBeLessThan(2);
    // Kyoto from Station 4 at Standard: on the order of two years (design 02 §6.1)
    expect(kyoto.full).toBeGreaterThan(400);
    expect(kyoto.full).toBeLessThan(1000);
  });

  it('the full-pace rate is the store rule: a stale stored mix at a preset changes nothing, the custom mix is honoured', () => {
    const fullDays = (settings: Partial<SaveMeta['settings']>): number[] =>
      roadEstimate({ meta: testSave({ save: { progress: { station: 4 }, settings } }), cards: store.cards, log: [], bundle: null, today: TODAY }).map((l) => (l.kind === 'onboarding' ? l.full : -1));
    const standard = fullDays({ intensity: 'standard' });
    expect(standard.every((d) => d > 0)).toBe(true);
    // onboarding stores the White mix; at a preset the belt table rules, so a stale mix moves no estimate
    expect(fullDays({ intensity: 'standard', newPerDay: { vocab: 1, kanji: 0, grammar: 0 } })).toEqual(standard);
    // the custom preset is the one place the stored mix is the budget
    const custom = fullDays({ intensity: 'custom', newPerDay: { vocab: 1, kanji: 0, grammar: 0 } });
    expect(custom[1]!).toBeGreaterThan(standard[1]! * 3);
  });

  it('after fourteen active days: pace and daily dates, daily never later than pace, cleared stations skipped', () => {
    const m = testSave({ save: { progress: { station: 4, stationsCleared: [1, 2, 3] }, daily: activeDays(20) } });
    const lines = roadEstimate({ meta: m, cards: store.cards, log: [], bundle: STATION_4, today: TODAY });
    expect(lines.every((l) => l.kind === 'pace')).toBe(true);
    for (const l of lines) {
      if (l.kind !== 'pace') continue;
      expect(l.atPace).toBeGreaterThan(TODAY);
      expect(l.daily).toBeLessThanOrEqual(l.atPace);
    }
    const further = roadEstimate({ meta: testSave({ save: { progress: { station: 4 }, daily: activeDays(20) } }), cards: store.cards, log: [], bundle: STATION_4, today: TODAY });
    const a = lines[1] as { kind: 'pace'; atPace: number };
    const b = further[1] as { kind: 'pace'; atPace: number };
    // station 1–3 cleared → not earlier than... in fact earlier or equal: cleared stations add no days
    expect(a.atPace).toBeLessThanOrEqual(b.atPace);
  });

  it('targets, quotas and labels', () => {
    expect(roadTargets(4)).toEqual([9, 53]);
    expect(roadTargets(1)).toEqual([9, 53]);
    expect(roadTargets(10)).toEqual([15, 53]);
    expect(roadTargets(50)).toEqual([53]);
    expect(roadTargets(0)).toEqual([9, 53]);
    expect(quotaTotal(1)).toBe(20 + KANA_PER_STATION[1]!);
    expect(quotaTotal(4)).toBe(60 + 8 + 8);
    expect(quotaTotal(99)).toBe(0);
    expect(targetLabel(53)).toBe('Kyoto (N1 core)');
    expect(targetLabel(9)).toBe('Yellow belt (小田原 Odawara)');
    expect(targetLabel(9, false)).toBe('Yellow belt (小田原 おだわら)'); // from Green on: kana, no romaji (design 09 §3.3)
    expect(targetLabel(53, false)).toBe('Kyoto (N1 core)');
    expect(spanLabel(3)).toBe('3 days');
    expect(spanLabel(21)).toBe('3 weeks');
    expect(spanLabel(365)).toBe('12 months');
    expect(monthYear(TODAY)).toBe('January 2026');
  });
});

describe('<RoadPage>', () => {
  it('shows onboarding estimates, the legend, the Kage strip and the road for a new learner', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    await mount();
    expect(text()).toContain('The Road');
    expect(text()).toContain('Level = effort. Belt = skill.');
    const lines = root.querySelectorAll('.road-page__line');
    expect(lines.length).toBe(2);
    expect(lines[0]?.getAttribute('data-kind')).toBe('onboarding');
    expect(lines[1]?.textContent).toMatch(/^Kyoto \(N1 core\): about \d+ months at daily practice · about \d+ months at seventy percent\.$/);
    expect(text()).toContain('Your own pace shows after fourteen active days.');
    expect(root.querySelectorAll('.road-page__legend .belt')).toHaveLength(8);
    expect(root.querySelector('.kage-strip')).not.toBeNull();
    expect(root.querySelectorAll('.tokaido__station')).toHaveLength(53);
    expect(root.querySelector('a[href="#/dan"]')).toBeNull();
    expect(text()).not.toMatch(/\d+ (hours|days|minutes) left/i);
  });

  it('shows pace lines with month names after fourteen active days, and the dan link past Kyoto', async () => {
    await makeTestStore({ save: { profile: { dan: 1, belt: 'black' }, progress: { station: 4 }, daily: activeDays(16) } });
    await mount();
    const lines = root.querySelectorAll('.road-page__line');
    expect(lines.length).toBe(2);
    expect(lines[0]?.getAttribute('data-kind')).toBe('pace');
    // a Black belt: kana are Green, so the target's reading is kana, not romaji (design 09 §3.3)
    expect(lines[0]?.textContent).toMatch(/^Yellow belt \(小田原 おだわら\): [A-Z][a-z]+ \d{4} at your current pace · [A-Z][a-z]+ \d{4} at daily practice\.$/);
    expect(text()).toContain('Give or take twenty percent');
    expect(root.querySelector('a[href="#/dan"]')).not.toBeNull();
    expect(root.querySelector('.tokaido__station[data-state="current"]')?.getAttribute('data-station')).toBe('4');
  });

  it('a stamp pressed at 100 % shows the gold frame on the road', async () => {
    await makeTestStore({ save: { progress: { station: 3, stationsCleared: [1, 2] }, collections: { stamps: { 1: { at: TODAY - 3, perfect: true, assisted: false }, 2: { at: TODAY - 1, perfect: false, assisted: false } } } } });
    await mount();
    expect(root.querySelector('.tokaido__station[data-station="1"]')?.getAttribute('data-state')).toBe('perfect');
    expect(root.querySelector('.tokaido__station[data-station="2"]')?.getAttribute('data-state')).toBe('cleared');
  });
});
