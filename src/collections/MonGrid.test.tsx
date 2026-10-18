import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { BADGE_IDS } from '../shared/catalog';
import { civilToDay, formatEraDate } from '../shared/time';
import { BADGE_DEFS } from '../store';
import { resetStoreForTests, store } from '../store/store';
import { makeTestStore } from '../store/testing';
import { CATEGORY_ORDER, MonGrid, groupBadges } from './MonGrid';
import { REVEAL_HOLD_MS, REVEAL_LEAVE_MS, eraGloss, liveReveals, newSince, resetOpenedForTests } from './reveal';

type IOCallback = (entries: Partial<IntersectionObserverEntry>[], observer: IntersectionObserver) => void;

/** A recording IntersectionObserver double (as use-reveal.test.tsx): `cb` delivers entries by hand. */
function installObserver(): { instances: { cb: IOCallback; observed: Element[]; options?: IntersectionObserverInit }[] } {
  const instances: { cb: IOCallback; observed: Element[]; options?: IntersectionObserverInit }[] = [];
  class FakeIO {
    inst: (typeof instances)[number];
    constructor(cb: IOCallback, options?: IntersectionObserverInit) {
      this.inst = { cb, observed: [], options };
      instances.push(this.inst);
    }
    observe(el: Element): void {
      this.inst.observed.push(el);
    }
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIO);
  return { instances };
}

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
  resetOpenedForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    // the era date is never unglossed (design 09 §3.3): its Latin reading stands beneath it
    expect(kyoto.querySelector('.mon__gloss')?.textContent).toBe(eraGloss(DAY));
    expect(kyoto.querySelector('figure.mon')?.getAttribute('title')).toBe(`Earned ${formatEraDate(DAY)} · ${eraGloss(DAY)}`);
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
    expect(dialog.querySelector('.mon-detail__state')?.textContent).toBe(`Earned ${formatEraDate(DAY)} · ${eraGloss(DAY)}`);
    expect(dialog.textContent).toContain('Bronze');
    act(() => (dialog.querySelector('.modal__actions button') as HTMLButtonElement).click());
    expect(root.querySelector('[role="dialog"]')).toBeNull();

    act(() => root.querySelector<HTMLButtonElement>('.mon-grid__cell[data-badge="seven"] button')!.click());
    const backdrop = root.querySelector<HTMLElement>('.mon-detail')!;
    act(() => backdrop.click());
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('locked crests are grey stone as <img> data URLs: the grid holds no live SVG filter (design 09 §6.7 rule 2)', async () => {
    // an earlier day relative to the store's clock (the test clock is January 2026; DAY is October)
    await makeTestStore();
    const today = store.today();
    act(() => store.patch('collections', (c) => ({ ...c, badges: { ...c.badges, seven: today - 40 } })));
    await act(async () => {
      render(<MonGrid />, root);
    });
    const stone = root.querySelectorAll('.mon-grid__cell[data-earned="false"] figure.mon[data-stone]');
    expect(stone).toHaveLength(67);
    expect(root.querySelectorAll('.mon-grid__cell[data-earned="false"] img.mon__img')).toHaveLength(67);
    expect(root.querySelector('.mon-grid__cell[data-badge="zen"] img.mon__img')?.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    // the glyph is set over each image in the page's brush face (an image resolves no webfont), never inside it
    expect(root.querySelectorAll('.mon-grid__cell[data-earned="false"] svg.mon__text text')).toHaveLength(67);
    expect(decodeURIComponent(root.querySelector('.mon-grid__cell[data-badge="zen"] img.mon__img')!.getAttribute('src')!)).not.toContain('<text');
    expect(root.querySelector('.mon-grid__cell[data-badge="zen"] svg.mon__text text')?.textContent).toBe(ZEN.nameJa);
    expect(root.querySelectorAll('filter')).toHaveLength(0);
    // an earned crest from an earlier day is colour at once: inline, no stone, no reveal
    const seven = root.querySelector('.mon-grid__cell[data-badge="seven"]')!;
    expect(seven.querySelector('figure.mon')?.hasAttribute('data-stone')).toBe(false);
    expect(seven.querySelector('.mon__svg svg')).not.toBeNull();
    expect(seven.hasAttribute('data-reveal')).toBe(false);
    expect(root.querySelectorAll('.mon-grid__group.sheet')).toHaveLength(CATEGORY_ORDER.length);
    expect(root.querySelector('.mon-detail__label')).toBeNull();
  });

  it('moment E inline: a crest earned since the last open is stone until half seen, then the stone dries out over the colour (kasure in place), the art presses and dries, the era date shows with its Latin gloss, and the cell settles by kasure — once', async () => {
    const io = installObserver();
    await makeTestStore();
    const today = store.today();
    act(() => store.patch('collections', (c) => ({ ...c, badges: { ...c.badges, kyoto: today, seven: today - 40 } })));
    await act(async () => {
      render(<MonGrid />, root);
    });
    const kyoto = root.querySelector('.mon-grid__cell[data-badge="kyoto"]')!;
    const seven = root.querySelector('.mon-grid__cell[data-badge="seven"]')!;
    // stone before it is seen; the caption and the label already tell the truth (date and gloss included)
    expect(kyoto.hasAttribute('data-reveal')).toBe(false);
    const fig = kyoto.querySelector('figure.mon')!;
    expect(fig.hasAttribute('data-stone')).toBe(true);
    expect(fig.classList.contains('mon--earned')).toBe(true);
    expect(kyoto.querySelector('img.mon__img')).not.toBeNull();
    expect(kyoto.querySelector('time.mon__date')?.textContent).toBe(formatEraDate(today));
    expect(kyoto.querySelector('.mon__gloss')?.textContent).toBe(eraGloss(today));
    expect(kyoto.querySelector('.mon__svg')?.getAttribute('aria-label')).toContain('earned');
    // the shelf has recorded only what it showed settled: the fresh crest stays new until it is seen
    expect(newSince('mon', [{ id: 'kyoto', at: today }, { id: 'seven', at: today - 40 }], today).has('kyoto')).toBe(true);
    expect(newSince('mon', [{ id: 'kyoto', at: today }, { id: 'seven', at: today - 40 }], today).has('seven')).toBe(false);
    // only the fresh cell is observed, at the half-visible threshold
    const inst = io.instances.find((i) => i.observed.includes(kyoto));
    expect(inst).toBeDefined();
    expect(inst!.options?.threshold).toBe(0.5);
    expect(io.instances.some((i) => i.observed.includes(seven))).toBe(false);

    vi.useFakeTimers();
    act(() => inst!.cb([{ isIntersecting: true }], {} as IntersectionObserver));
    expect(kyoto.getAttribute('data-reveal')).toBe('in');
    expect(fig.hasAttribute('data-stone')).toBe(false);
    // the colour art is in, the stone layer still over it under kasure: stone turning to colour, not a blink
    const art = kyoto.querySelector('.mon__svg')!;
    expect(art.querySelector('.mon__colour svg.mon-svg--earned')).not.toBeNull();
    const stone = art.querySelector('.mon__stone')!;
    expect(stone.classList.contains('ink-kasure')).toBe(true);
    expect(stone.querySelector('img.mon__img')).not.toBeNull();
    expect(fig.classList.contains('ink-nijimi')).toBe(false);
    expect(art.classList.contains('ink-osu')).toBe(true);
    expect(art.classList.contains('ink-wet')).toBe(true);
    expect(art.classList.contains('is-dry')).toBe(true);
    const seal = kyoto.querySelector('.seal-date')!;
    expect(seal.classList.contains('ink-nijimi')).toBe(true);
    expect(seal.querySelector('.collections__era')?.textContent).toBe(formatEraDate(today));
    expect(seal.querySelector('.collections__era')?.getAttribute('lang')).toBe('ja');
    expect(seal.querySelector('.seal-date__label')?.textContent).toBe(eraGloss(today));
    expect(seal.querySelector('.seal-date__label')?.textContent).toMatch(/^Reiwa \d+ · [A-Z][a-z]{2} \d+$/);
    expect(liveReveals()).toBe(1);
    // seen: the shelf records it now, so a remount mid-reveal never replays
    expect(newSince('mon', [{ id: 'kyoto', at: today }], today).size).toBe(0);
    // once: a second intersection adds nothing, the older crest never reveals
    act(() => inst!.cb([{ isIntersecting: true }], {} as IntersectionObserver));
    expect(kyoto.querySelectorAll('.seal-date')).toHaveLength(1);
    expect(seven.hasAttribute('data-reveal')).toBe(false);
    // the date leaves by kasure, then the cell settles, the stone layer is gone and the slot is free
    act(() => {
      vi.advanceTimersByTime(REVEAL_HOLD_MS);
    });
    expect(kyoto.getAttribute('data-reveal')).toBe('leaving');
    expect(kyoto.querySelector('.seal-date')?.hasAttribute('data-leaving')).toBe(true);
    expect(kyoto.querySelector('.mon__stone')).toBeNull();
    expect(liveReveals()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(REVEAL_LEAVE_MS);
    });
    expect(kyoto.hasAttribute('data-reveal')).toBe(false);
    expect(kyoto.querySelector('.seal-date')).toBeNull();
    expect(kyoto.querySelector('.mon__svg svg.mon-svg--earned')).not.toBeNull();
    expect(root.querySelectorAll('filter')).toHaveLength(0);
  });

  it('under reducedMotion the crest still waits to be seen (nothing reveals below the fold), then lands the final state at once with the same captions and no wet layer', async () => {
    const io = installObserver();
    await makeTestStore({ save: { settings: { reducedMotion: true } } });
    const today = store.today();
    act(() => store.patch('collections', (c) => ({ ...c, badges: { ...c.badges, kyoto: today } })));
    await act(async () => {
      render(<MonGrid />, root);
    });
    const kyoto = root.querySelector('.mon-grid__cell[data-badge="kyoto"]')!;
    expect(kyoto.hasAttribute('data-reveal')).toBe(false);
    expect(kyoto.querySelector('figure.mon')?.hasAttribute('data-stone')).toBe(true);
    // the glossed date already stands in the caption
    expect(kyoto.querySelector('.mon__gloss')?.textContent).toBe(eraGloss(today));
    const inst = io.instances.find((i) => i.observed.includes(kyoto));
    expect(inst).toBeDefined();
    act(() => inst!.cb([{ isIntersecting: true }], {} as IntersectionObserver));
    expect(kyoto.getAttribute('data-reveal')).toBe('in');
    expect(kyoto.querySelector('figure.mon')?.hasAttribute('data-stone')).toBe(false);
    expect(kyoto.querySelector('.seal-date__label')?.textContent).toBe(eraGloss(today));
    // no press, ink shown dry: the art box carries no verb, so no live filter is even referenced
    const art = kyoto.querySelector('.mon__svg')!;
    expect(art.classList.contains('ink-osu')).toBe(false);
    expect(art.classList.contains('ink-wet')).toBe(false);
    expect(liveReveals()).toBe(1);
  });

  it('a fresh crest never scrolled to stays new for the next open; the moment-E choreography keeps the Mincho date to opacity (design 09 §3.1)', async () => {
    installObserver();
    await makeTestStore();
    const today = store.today();
    act(() => store.patch('collections', (c) => ({ ...c, badges: { ...c.badges, kyoto: today } })));
    await act(async () => {
      render(<MonGrid />, root);
    });
    render(null, root);
    await act(async () => {
      render(<MonGrid />, root);
    });
    const kyoto = root.querySelector('.mon-grid__cell[data-badge="kyoto"]')!;
    expect(kyoto.querySelector('figure.mon')?.hasAttribute('data-stone')).toBe(true);
    const css = readFileSync(resolve(process.cwd(), 'src/collections/pages/CollectionsPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\[data-reveal\] \.collections__seal\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/--to:\s*0 0/);
    expect(/\[data-reveal\] \.collections__seal:not\(\[data-leaving\]\)\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/animation-name:\s*mat\b/);
    // the tab strip tweens its border only (§6.7 rule 1: no background-color on a strip wider than 160 px)
    expect(/\.collections__tab\s*\{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/background-color/);
    // the Mon cell's seal lies over the caption so the row never jumps; the wet layer follows the round seal
    const grid = readFileSync(resolve(process.cwd(), 'src/collections/MonGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\.mon-grid__cell \.mon-grid__button \.collections__seal\s*\{([^}]*)\}/.exec(grid)?.[1]).toMatch(/position:\s*absolute/);
    expect(/\.mon-grid__button \.mon__svg\s*\{([^}]*)\}/.exec(grid)?.[1]).toMatch(/border-radius:\s*50%/);
  });

  it('a second open in the same tab reveals nothing: the shelf remembers what it showed', async () => {
    await makeTestStore();
    const today = store.today();
    act(() => store.patch('collections', (c) => ({ ...c, badges: { ...c.badges, kyoto: today } })));
    await act(async () => {
      render(<MonGrid />, root);
    });
    expect(root.querySelector('.mon-grid__cell[data-badge="kyoto"]')?.getAttribute('data-reveal')).toBe('in'); // no observer in jsdom: seen at once
    render(null, root);
    await act(async () => {
      render(<MonGrid />, root);
    });
    expect(root.querySelector('.mon-grid__cell[data-badge="kyoto"]')?.hasAttribute('data-reveal')).toBe(false);
  });
});
