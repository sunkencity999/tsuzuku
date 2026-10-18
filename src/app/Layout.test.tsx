import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { bus } from '@/shared/events';
import { href, navigate, route, syncRouteFromLocation, type Route } from '@/shared/routes';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, makeTestStore } from '@/store/testing';
import { S, fmt } from '@/i18n/strings';
import { Layout, NAV_ITEMS, announce, daysLine, navTargetFor, storageNoticeDismissed } from './Layout';
import { resetSwForTests, swUpdate } from './sw-register';

/** 2026-01-12T12:00Z: a Monday. */
const MONDAY = Date.UTC(2026, 0, 12, 12, 0, 0);

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetSwForTests();
  bus.reset();
});

function mount(): void {
  act(() => render(<Layout>{<p id="child">content</p>}</Layout>, root));
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

describe('<Layout>', () => {
  it("renders '412 days trained · 3-day streak' from the store", async () => {
    await makeTestStore({ save: { streak: { totalDays: 412, current: 3 } } });
    mount();
    expect(root.querySelector('.layout__days')?.textContent).toBe('412 days trained · 3-day streak');
    expect(root.querySelector('#child')?.textContent).toBe('content');
    expect(root.querySelector('main#main')).not.toBeNull();
  });

  it('daysLine handles singulars and no streak', () => {
    expect(daysLine(1, 1)).toBe('1 day trained · 1-day streak');
    expect(daysLine(0, 0)).toBe(`0 days trained · ${S.streakNone}`);
    expect(daysLine(10, 0)).toBe(`10 days trained · ${S.streakNone}`);
  });

  it('nav has six links built with href() and marks the active one', async () => {
    await makeTestStore();
    mount();
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.nav__item'));
    expect(links.length).toBe(6);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(NAV_ITEMS.map((i) => href(i.route)));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      expect.stringContaining('Dojo'),
      expect.stringContaining('Road'),
      expect.stringContaining('Library'),
      expect.stringContaining('Collections'),
      expect.stringContaining('Records'),
      expect.stringContaining('Settings'),
    ]);
    expect(root.querySelector('[data-nav="dojo"]')?.getAttribute('aria-current')).toBe('page');
    act(() => navigate({ name: 'studio', wallpaperId: 'torii-dawn' }));
    expect(root.querySelector('[data-nav="collections"]')?.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('[data-nav="dojo"]')?.getAttribute('aria-current')).toBeNull();
    expect(navTargetFor({ name: 'ledger' })).toBe('records');
    expect(navTargetFor({ name: 'train', mode: 'kata' })).toBeNull();
    expect(navTargetFor({ name: 'about' })).toBe('settings');
  });

  it('茶屋ラジオ (design 08 §10.2) highlights the Dojo nav: Radio is reached from the Dojo tile and is never a session', async () => {
    await makeTestStore();
    mount();
    const radio: Route = { name: 'radio' };
    expect(navTargetFor(radio)).toBe('dojo');
    act(() => {
      route.value = radio;
    });
    expect(root.querySelector('[data-nav="dojo"]')?.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('[data-nav="road"]')?.getAttribute('aria-current')).toBeNull();
    expect(root.querySelector('.layout')?.getAttribute('data-route')).toBe('radio');
  });

  it('announce() writes to #live (polite) and #live-alert (assertive)', async () => {
    await makeTestStore();
    mount();
    announce('一本');
    await tick();
    expect(root.querySelector('#live')?.textContent).toBe('一本');
    expect(root.querySelector('#live')?.getAttribute('aria-live')).toBe('polite');
    announce('Belt', 'assertive');
    await tick();
    expect(root.querySelector('#live-alert')?.textContent).toBe('Belt');
  });

  it('bus events reach the live region', async () => {
    await makeTestStore();
    mount();
    bus.emit('badge:earned', { id: 'first-step' });
    await tick();
    // Announced by name (BADGE_DEFS.nameEn), never by raw id.
    expect(root.querySelector('#live')?.textContent).toBe(fmt(S.liveBadge, { name: 'First Step' }));
    bus.emit('quest:completed', { id: 'q', allDone: true });
    await tick();
    expect(root.querySelector('#live')?.textContent).toBe(S.liveQuestsAll);
    bus.emit('day:rolled', { day: 1, awayDays: 9 });
    await tick();
    expect(root.querySelector('#live')?.textContent).toBe(S.liveWelcomeBack);
  });

  it("storage level 'warn' shows the export line linking to the backup page; dismiss hides it", async () => {
    await makeTestStore();
    mount();
    expect(root.querySelector('.layout__notice')).toBeNull();
    act(() => {
      store.storage.value = { bytes: 3_600_000, level: 'warn' };
    });
    const notice = root.querySelector('.layout__notice');
    expect(notice?.textContent).toContain(S.storageWarn);
    expect(notice?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'backup' }));
    act(() => {
      store.storage.value = { bytes: 4_600_000, level: 'ceiling' };
    });
    expect(root.querySelector('.layout__notice')?.textContent).toContain(S.storageCeiling);
    act(() => {
      root.querySelector<HTMLButtonElement>('.layout__notice button')?.click();
    });
    expect(root.querySelector('.layout__notice')).toBeNull();
  });

  it('a dismissed storage notice returns when the level changes, and at the ceiling on every store update', async () => {
    await makeTestStore();
    mount();
    act(() => {
      store.storage.value = { bytes: 3_600_000, level: 'warn' };
    });
    act(() => {
      root.querySelector<HTMLButtonElement>('.layout__notice button')?.click();
    });
    // warn: stays dismissed while the level holds, even as bytes move
    act(() => {
      store.storage.value = { bytes: 3_700_000, level: 'warn' };
    });
    expect(root.querySelector('.layout__notice')).toBeNull();
    // escalation to ceiling un-dismisses
    act(() => {
      store.storage.value = { bytes: 4_600_000, level: 'ceiling' };
    });
    expect(root.querySelector('.layout__notice')?.textContent).toContain(S.storageCeiling);
    act(() => {
      root.querySelector<HTMLButtonElement>('.layout__notice button')?.click();
    });
    expect(root.querySelector('.layout__notice')).toBeNull();
    // a failing write keeps re-reporting the ceiling: the notice comes back
    act(() => {
      store.storage.value = { bytes: 4_600_000, level: 'ceiling' };
    });
    expect(root.querySelector('.layout__notice')?.textContent).toContain(S.storageCeiling);
    // back to ok: nothing shown
    act(() => {
      store.storage.value = { bytes: 1_000, level: 'ok' };
    });
    expect(root.querySelector('.layout__notice')).toBeNull();
  });

  it('storageNoticeDismissed: level-scoped for warn, state-scoped for ceiling', () => {
    const warn = { bytes: 1, level: 'warn' } as const;
    const ceiling = { bytes: 2, level: 'ceiling' } as const;
    expect(storageNoticeDismissed(warn, null)).toBe(false);
    expect(storageNoticeDismissed(warn, { bytes: 9, level: 'warn' })).toBe(true);
    expect(storageNoticeDismissed(ceiling, warn)).toBe(false);
    expect(storageNoticeDismissed(ceiling, ceiling)).toBe(true);
    expect(storageNoticeDismissed(ceiling, { ...ceiling })).toBe(false);
  });

  it('shows the weekly backup reminder on Mondays for an established learner and hides it after an export', async () => {
    await makeTestStore({ now: MONDAY, save: { streak: { totalDays: 30, current: 2 }, stats: { sessions: 12 } } });
    mount();
    const notice = root.querySelector('.layout__notice');
    expect(notice?.textContent).toContain(S.backupReminder);
    act(() => bus.emit('backup:exported', {}));
    expect(root.querySelector('.layout__notice')).toBeNull();
  });

  it('no reminder on a Thursday or for a brand-new learner', async () => {
    await makeTestStore({ now: DEFAULT_TEST_NOW, save: { streak: { totalDays: 30 }, stats: { sessions: 12 } } });
    mount();
    expect(root.querySelector('.layout__notice')).toBeNull();
    await makeTestStore({ now: MONDAY });
    mount();
    expect(root.querySelector('.layout__notice')).toBeNull();
  });

  it('shows the belt chip (JA name), the flame state and the level', async () => {
    await makeTestStore({ save: { profile: { belt: 'green', level: 7 }, streak: { current: 0, totalDays: 3 } } });
    mount();
    expect(root.querySelector('.belt')?.getAttribute('data-belt')).toBe('green');
    expect(root.querySelector('.belt [lang="ja"]')?.textContent).toBe('緑帯');
    expect(root.querySelector('.flame')?.getAttribute('data-state')).toBe('broken');
    expect(root.querySelector('.layout__level')?.textContent).toContain('7');
    expect(root.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('the level is named by visually-hidden text, not by an aria-label on a generic span (prohibited on role=generic)', async () => {
    await makeTestStore({ save: { profile: { belt: 'green', level: 7, xp: 0 } } });
    mount();
    const level = root.querySelector('.layout__level');
    expect(level?.hasAttribute('aria-label')).toBe(false);
    const hidden = level?.querySelector('.visually-hidden')?.textContent ?? '';
    expect(hidden).toContain(fmt(S.levelLong, { n: 7 }));
    expect(hidden).toMatch(/XP to the next level/);
    expect(level?.querySelector('[aria-hidden="true"]')?.textContent).toContain('7');
  });

  it('the nav precedes <main> in the DOM, so the ≥900 px sticky strip sits under the header instead of at the page end', async () => {
    await makeTestStore();
    mount();
    const nav = root.querySelector('nav.layout__nav')!;
    const main = root.querySelector('main#main')!;
    const header = root.querySelector('header.layout__header')!;
    expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a waiting service worker shows the update toast and announces it', async () => {
    await makeTestStore();
    mount();
    expect(root.querySelector('.toast')).toBeNull();
    act(() => {
      swUpdate.value = true;
    });
    const toast = root.querySelector('.toast');
    expect(toast?.textContent).toContain(S.swUpdateReady);
    expect(Array.from(toast?.querySelectorAll('button') ?? []).map((b) => b.textContent)).toEqual([S.swUpdateAction, S.swUpdateLater]);
    await tick();
    expect(root.querySelector('#live')?.textContent).toBe(S.swUpdateReady);
    act(() => {
      toast?.querySelectorAll<HTMLButtonElement>('button')[1]?.click();
    });
    expect(root.querySelector('.toast')).toBeNull();
  });

  it('the skip link focuses <main>', async () => {
    await makeTestStore();
    mount();
    const skip = root.querySelector<HTMLButtonElement>('.skip-link');
    expect(skip?.textContent).toBe(S.skipToContent);
    act(() => skip?.click());
    expect(document.activeElement?.id).toBe('main');
  });
});

describe('Layout.css', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/Layout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, selector).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  it('the header is not sticky below 900 px (the fixed bottom nav already anchors phones)', () => {
    const m = /@media \(max-width: 899px\)\s*\{\s*\.layout__header\s*\{([^}]*)\}/.exec(css);
    expect(m, 'phone header rule').not.toBeNull();
    expect(m![1]).toMatch(/position:\s*static/);
  });

  it('drills collapse the header to the brand row: status hidden on train / gate / shinsa', () => {
    for (const r of ['train', 'gate', 'shinsa']) {
      const re = new RegExp(`\\.layout\\[data-route="${r}"\\] \\.layout__status[^{]*\\{[^}]*display:\\s*none`);
      expect(css, r).toMatch(re);
    }
    expect(css).not.toMatch(/\.layout\[data-route="dojo"\] \.layout__status/);
  });

  it('drills leave the home-indicator inset to the sticky exercise controls; onboarding keeps its own', () => {
    const drill = /\.layout\[data-route="train"\] \.layout__main,\s*\.layout\[data-route="gate"\] \.layout__main,\s*\.layout\[data-route="shinsa"\] \.layout__main \{([^}]*)\}/.exec(css);
    expect(drill, 'drill main rule').not.toBeNull();
    expect(drill![1]).toMatch(/padding-bottom:\s*var\(--sp-5\)/);
    expect(drill![1]).not.toMatch(/--safe-bottom/);
    expect(block('.layout[data-route="onboarding"] .layout__main {')).toMatch(/padding-bottom:\s*calc\(var\(--safe-bottom\)/);
  });

  it('the Dan label uses the text-safe gold and the header height tracks the brand row', () => {
    expect(block('.layout__dan {')).toMatch(/color:\s*var\(--kin-text\)/);
    expect(block('.layout {')).toMatch(/--header-height:\s*calc\(var\(--touch\)/);
  });
});
