import { render } from 'preact';
import { act } from 'preact/test-utils';
import { BADGE_IDS } from '../shared/catalog';
import { civilToDay, formatEraDate } from '../shared/time';
import { BADGE_DEFS } from '../store';
import { resetStoreForTests } from '../store/store';
import { makeTestStore } from '../store/testing';
import { CATEGORY_ORDER, MonGrid, groupBadges } from './MonGrid';

const DAY = civilToDay({ year: 2026, month: 10, day: 17 });
const ZEN = BADGE_DEFS.find((d) => d.id === 'zen')!;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
});

async function mount(badges: Record<string, number> = {}): Promise<void> {
  await makeTestStore({ save: { collections: { badges } } });
  await act(async () => {
    render(<MonGrid />, root);
  });
}

const cells = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.mon-grid__cell'));

describe('groupBadges', () => {
  it('covers every badge once, in shelf order, with earned counts', () => {
    const groups = groupBadges(BADGE_DEFS, { kyoto: DAY, seven: DAY });
    const ids = groups.flatMap((g) => g.defs.map((d) => d.id));
    expect(ids.length).toBe(BADGE_IDS.length);
    expect(new Set(ids).size).toBe(BADGE_IDS.length);
    expect(groups.map((g) => g.category)).toEqual(CATEGORY_ORDER.filter((c) => BADGE_DEFS.some((d) => d.category === c)));
    const road = groups.find((g) => g.category === 'road')!;
    const streak = groups.find((g) => g.category === 'streak')!;
    expect(road.earned).toBe(1);
    expect(streak.earned).toBe(1);
    expect(groups.reduce((n, g) => n + g.earned, 0)).toBe(2);
  });
});

describe('<MonGrid>', () => {
  it('renders all 68 crests; unearned ones show the condition text as grey stone', async () => {
    await mount();
    expect(cells()).toHaveLength(68);
    expect(root.querySelectorAll('.mon--locked')).toHaveLength(68);
    const zen = root.querySelector('.mon-grid__cell[data-badge="zen"]')!;
    expect(zen.querySelector('.mon__condition')?.textContent).toBe(ZEN.describe);
    expect(zen.getAttribute('data-earned')).toBe('false');
    expect(root.querySelector('.mon-grid')?.getAttribute('data-earned')).toBe('0');
    expect(root.querySelector('.mon-grid__lede')?.textContent).toContain('0 of 68');
    // one heading per strand
    expect(root.querySelectorAll('.mon-grid__group').length).toBe(CATEGORY_ORDER.length);
  });

  it('earned crests show the era date and count in the lede; the filters narrow the grid', async () => {
    await mount({ kyoto: DAY, seven: DAY });
    const kyoto = root.querySelector('.mon-grid__cell[data-badge="kyoto"]')!;
    expect(kyoto.getAttribute('data-earned')).toBe('true');
    expect(kyoto.querySelector('time.mon__date')?.textContent).toBe(formatEraDate(DAY));
    expect(kyoto.querySelector('.mon__condition')).toBeNull();
    expect(root.querySelector('.mon-grid__lede')?.textContent).toContain('2 of 68');

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.mon-grid__filters button'));
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    act(() => buttons[1]!.click());
    expect(cells()).toHaveLength(2);
    expect(root.querySelectorAll('.mon-grid__empty').length).toBeGreaterThan(0);
    act(() => buttons[2]!.click());
    expect(cells()).toHaveLength(66);
    act(() => buttons[0]!.click());
    expect(cells()).toHaveLength(68);
  });

  it('tapping a crest opens a detail dialog with the condition; Escape closes it and restores focus', async () => {
    await mount({ seven: DAY });
    const trigger = root.querySelector<HTMLButtonElement>('.mon-grid__cell[data-badge="zen"] button')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    act(() => trigger.click());
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain(ZEN.nameEn);
    expect(dialog.textContent).toContain(ZEN.nameJa);
    expect(dialog.textContent).toContain(ZEN.describe);
    expect(dialog.textContent).toContain('Not yet earned');
    expect(dialog.textContent).toContain('Silver');
    expect(document.activeElement).toBe(dialog.querySelector('button'));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('an earned crest in the sheet shows its date; the close button and backdrop both close', async () => {
    await mount({ seven: DAY });
    act(() => root.querySelector<HTMLButtonElement>('.mon-grid__cell[data-badge="seven"] button')!.click());
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('time')?.textContent).toContain(formatEraDate(DAY));
    expect(dialog.textContent).toContain('Bronze');
    act(() => (dialog.querySelector('.modal__actions button') as HTMLButtonElement).click());
    expect(root.querySelector('[role="dialog"]')).toBeNull();

    act(() => root.querySelector<HTMLButtonElement>('.mon-grid__cell[data-badge="seven"] button')!.click());
    const backdrop = root.querySelector<HTMLElement>('.mon-detail')!;
    act(() => backdrop.click());
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
});
