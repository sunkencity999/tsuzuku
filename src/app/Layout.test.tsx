import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { bus } from '@/shared/events';
import { href, navigate, route, syncRouteFromLocation, type Route } from '@/shared/routes';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, makeTestStore } from '@/store/testing';
import { S, fmt } from '@/i18n/strings';
import type { FlameState } from '@/store/derived';
import { FLAME_WORD, Layout, NAV_ITEMS, announce, chipText, daysLine, flameImproved, focusMain, navTargetFor, resetIgnitionForTests, shouldIgnite, storageNoticeDismissed } from './Layout';
import { resetSwForTests, swUpdate } from './sw-register';
import { resetTransitionsForTests } from './transitions';
import { shownRoute } from './transitions';

/** 2026-01-12T12:00Z: a Monday. */
const MONDAY = Date.UTC(2026, 0, 12, 12, 0, 0);

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  resetIgnitionForTests();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetSwForTests();
  resetIgnitionForTests();
  resetTransitionsForTests();
  bus.reset();
});

function mount(): void {
  act(() => render(<Layout>{<p id="child">content</p>}</Layout>, root));
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

/**
 * A notice or toast leaves by kasure (design 09 §6.3): it holds with
 * `data-leaving` until its transition ends, then unmounts. jsdom fires no
 * transitions, so the test ends the exit itself.
 */
function finishExit(selector: string): void {
  const el = root.querySelector(selector);
  expect(el, `${selector} should still be mounted, leaving`).not.toBeNull();
  expect(el?.hasAttribute('data-leaving'), `${selector} data-leaving`).toBe(true);
  act(() => {
    el?.dispatchEvent(new Event('transitionend'));
  });
}

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

  it('the chrome follows shownRoute (the page PageHost committed) over the hash, so the drill chrome turns with the page', async () => {
    await makeTestStore();
    mount();
    act(() => navigate({ name: 'train', mode: 'kata' }));
    expect(root.querySelector('.layout')?.getAttribute('data-route')).toBe('train'); // no page host yet: the hash
    act(() => {
      shownRoute.value = { name: 'dojo' };
    });
    expect(root.querySelector('.layout')?.getAttribute('data-route')).toBe('dojo');
    expect(root.querySelector('[data-nav="dojo"]')?.getAttribute('aria-current')).toBe('page');
    act(() => {
      shownRoute.value = { name: 'train', mode: 'kata' };
    });
    expect(root.querySelector('.layout')?.getAttribute('data-route')).toBe('train');
    expect(root.querySelector('[aria-current="page"]')).toBeNull();
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
    finishExit('.layout__notice');
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
    finishExit('.layout__notice');
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
    finishExit('.layout__notice');
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
    finishExit('.layout__notice');
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
    finishExit('.layout__notice');
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
    expect(root.querySelector('.lantern')?.getAttribute('data-state')).toBe('broken');
    expect(root.querySelector('.layout__level')?.textContent).toContain('7');
    expect(root.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  /* ── the lantern (design 09 §5.10) ─────────────────────────────────── */

  const FLAME_SAVES: Record<FlameState, { streak: Record<string, unknown>; settings?: Record<string, unknown>; quests?: Record<string, unknown> }> = {
    // DEFAULT_TEST_NOW is a Thursday; `today` is the test store's epoch day
    lit: { streak: { totalDays: 10, current: 3, lastDay: 0 } },
    gold: { streak: { totalDays: 10, current: 3, lastDay: 0 }, quests: { day: 0, ids: ['q1'], done: ['q1'] } },
    ember: { streak: { totalDays: 10, current: 3, lastDay: -2, ember: -1 } },
    frozen: { streak: { totalDays: 10, current: 3, lastDay: -3 } },
    rest: { streak: { totalDays: 10, current: 3, lastDay: -1 }, settings: { restDay: 4 } },
    broken: { streak: { totalDays: 10, current: 0, lastDay: -5 } },
  };

  it('renders the drawn tongue with the visible English state word for all six states and the long sentence hidden', async () => {
    await makeTestStore();
    const today = store.today();
    for (const [state, save] of Object.entries(FLAME_SAVES) as [FlameState, (typeof FLAME_SAVES)[FlameState]][]) {
      const shift = (v: unknown): unknown => (typeof v === 'number' ? v + today : v);
      const streak = Object.fromEntries(Object.entries(save.streak).map(([k, v]) => [k, k === 'totalDays' || k === 'current' ? v : shift(v)]));
      const quests = save.quests ? { ...save.quests, day: today } : undefined;
      await makeTestStore({ save: { streak, settings: save.settings, quests } });
      mount();
      const lantern = root.querySelector('.lantern');
      expect(lantern?.getAttribute('data-state'), state).toBe(state);
      expect(lantern?.querySelector('.lantern__word')?.textContent, state).toBe(FLAME_WORD[state]);
      expect(lantern?.querySelector('svg.lantern__tongue path')?.getAttribute('d'), state).toMatch(/^M/);
      expect(lantern?.textContent, state).toContain(S.flame);
      // the old kanji glyph table is gone: nothing Japanese is left unlabelled in the header's flame
      expect(lantern?.textContent, state).not.toMatch(/[火炎残氷休灰]/);
      render(null, root);
    }
  });

  it('day one (totalDays === 0): the tongue is grey and says "Unlit. Your first session lights it.", never "out"', async () => {
    await makeTestStore({ save: { streak: { totalDays: 0, current: 0 } } });
    mount();
    const lantern = root.querySelector('.lantern')!;
    expect(lantern.getAttribute('data-state')).toBe('unlit');
    expect(lantern.querySelector('.lantern__word')?.textContent).toBe(S.flameWordUnlit);
    expect(lantern.textContent).toContain(S.flameUnlit);
    expect(lantern.textContent).not.toContain(S.flameBroken);
  });

  it('the flame tomosu when its state improves (§6.3): .ink-tomosu for one rise into a glowing state, gone on the twin\'s animationend', async () => {
    await makeTestStore();
    const today = store.today();
    await makeTestStore({ save: { streak: { totalDays: 10, current: 3, lastDay: today - 2, ember: today - 1 } } });
    mount();
    const lantern = root.querySelector('.lantern')!;
    expect(lantern.getAttribute('data-state')).toBe('ember');
    expect(lantern.classList.contains('ink-tomosu')).toBe(false); // the first render never lights
    act(() => {
      store.streak.value = { ...store.streak.value, lastDay: today, ember: undefined };
    });
    expect(lantern.getAttribute('data-state')).toBe('lit');
    expect(lantern.classList.contains('ink-tomosu')).toBe(true);
    // a child's bubbled animationend is not the twin's
    act(() => {
      lantern.querySelector('svg')!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(lantern.classList.contains('ink-tomosu')).toBe(true);
    act(() => {
      lantern.dispatchEvent(new Event('animationend'));
    });
    expect(lantern.classList.contains('ink-tomosu')).toBe(false);
    // the pure rule: rises into lit / gold only
    expect(flameImproved('ember', 'lit')).toBe(true);
    expect(flameImproved('broken', 'lit')).toBe(true);
    expect(flameImproved('lit', 'gold')).toBe(true);
    expect(flameImproved('frozen', 'lit')).toBe(true);
    expect(flameImproved('ember', 'frozen')).toBe(false); // held, not glowing: the twin stays dark
    expect(flameImproved('gold', 'lit')).toBe(false);
    expect(flameImproved('lit', 'ember')).toBe(false);
    expect(flameImproved(null, 'gold')).toBe(false);
  });

  it('under reduced motion the flame never carries .ink-tomosu', async () => {
    await makeTestStore();
    const today = store.today();
    await makeTestStore({ save: { settings: { reducedMotion: true }, streak: { totalDays: 10, current: 3, lastDay: today - 2, ember: today - 1 } } });
    mount();
    act(() => {
      store.streak.value = { ...store.streak.value, lastDay: today, ember: undefined };
    });
    expect(root.querySelector('.lantern')?.getAttribute('data-state')).toBe('lit');
    expect(root.querySelector('.lantern')?.classList.contains('ink-tomosu')).toBe(false);
  });

  it('forgiveness chips: 氷 × 2 held reads "2 freezes held" with the glyph decorative; nothing renders for an empty slice', async () => {
    await makeTestStore({ save: { streak: { totalDays: 12, current: 2, freezes: 2 } } });
    mount();
    const chips = root.querySelectorAll('.flame-chip');
    expect(chips.length).toBe(1);
    expect(chips[0]?.getAttribute('data-chip')).toBe('freeze');
    expect(chips[0]?.querySelector('.flame-chip__text')?.textContent).toBe(fmt(S.chipFreezes, { n: 2 }));
    expect(chips[0]?.querySelector('[lang="ja"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.flame-chips')?.getAttribute('aria-label')).toBe(S.chipsLabel);
    expect(root.querySelector('.kintsugi')).toBeNull();
    await makeTestStore({ save: { streak: { totalDays: 12, current: 2, freezes: 0, weekly: 0, restDaysTaken: 0 } } });
    mount();
    expect(root.querySelector('.flame-chips')).toBeNull();
  });

  it('the kintsugi seam shows only while repairWindow is open, with "Streak paused · repair open: 1 of 3 days" in the days line', async () => {
    await makeTestStore();
    const today = store.today();
    await makeTestStore({ save: { streak: { totalDays: 30, current: 0, lastDay: today - 3, repairWindow: { start: today - 1, done: 1 } } } });
    mount();
    const repair = root.querySelector('.flame-chip[data-chip="repair"]');
    expect(repair?.classList.contains('kintsugi')).toBe(true);
    expect(repair?.textContent).toBe(fmt(S.chipRepair, { done: 1 }));
    expect(root.querySelector('.layout__days')?.textContent).toBe(`30 days trained · ${fmt(S.streakPaused, { done: 1 })}`);
    // the window closed: no seam, no chip, the plain line — a repaired flame is indistinguishable from one that never dimmed
    await makeTestStore({ save: { streak: { totalDays: 30, current: 0, lastDay: today - 9, repairWindow: { start: today - 7, done: 1 } } } });
    mount();
    expect(root.querySelector('.kintsugi')).toBeNull();
    expect(root.querySelector('.flame-chip[data-chip="repair"]')).toBeNull();
    expect(root.querySelector('.layout__days')?.textContent).toBe(`30 days trained · ${S.streakNone}`);
  });

  it('chipText covers the singulars and the rest-day cases', () => {
    expect(chipText({ kind: 'freeze', n: 1 })).toBe(S.chipFreeze);
    expect(chipText({ kind: 'rest', n: 0, set: true })).toBe(S.chipRestSet);
    expect(chipText({ kind: 'rest', n: 1, set: false })).toBe(S.chipRestTakenOne);
    expect(chipText({ kind: 'rest', n: 4, set: false })).toBe(fmt(S.chipRestTaken, { n: 4 }));
    expect(chipText({ kind: 'weekly', n: 1 })).toBe(S.chipWeeklyOne);
    expect(chipText({ kind: 'weekly', n: 3 })).toBe(fmt(S.chipWeekly, { n: 3 }));
    expect(daysLine(5, 0, 2)).toBe(`5 days trained · ${fmt(S.streakPaused, { done: 2 })}`);
  });

  /* ── Lv / XP (design 09 §5.7 / §5.8) ───────────────────────────────── */

  it('Lv is a <Ticker> whose DOM text is the real level, and the XP bar is a .meter driven by --value', async () => {
    await makeTestStore({ save: { profile: { level: 7, xp: 0 } } });
    mount();
    const ticker = root.querySelector('.layout__level .ticker');
    expect(ticker?.querySelector('.ticker__value')?.textContent).toBe('7');
    const meter = root.querySelector<HTMLElement>('.meter.layout__xp');
    expect(meter?.getAttribute('role')).toBe('progressbar');
    expect(meter?.querySelector('.meter__fill')).not.toBeNull();
    expect(Number(meter?.style.getPropertyValue('--value'))).toBeGreaterThanOrEqual(0);
    expect(root.querySelector('.progress__fill')).toBeNull();
  });

  /* ── brand ignition (design 09 §6.2 tomosu, once a day) ────────────── */

  it('the brand ignites once per day: data-ignite at the first mount of the day, not again on a remount, again after day:rolled', async () => {
    await makeTestStore();
    mount();
    expect(root.querySelector('.layout__brand')?.hasAttribute('data-ignite')).toBe(true);
    render(null, root);
    mount();
    expect(root.querySelector('.layout__brand')?.hasAttribute('data-ignite')).toBe(false);
    act(() => bus.emit('day:rolled', { day: store.today() + 1, awayDays: 0 }));
    expect(root.querySelector('.layout__brand')?.hasAttribute('data-ignite')).toBe(true);
    expect(shouldIgnite(store.today() + 1)).toBe(false);
    expect(shouldIgnite(store.today() + 2)).toBe(true);
    // never a save field
    expect(JSON.stringify(store.streak.value)).not.toContain('ignit');
  });

  /* ── focus for page turns (design 09 §6.4) ─────────────────────────── */

  it('focusMain({ ifIdle }) moves focus to <main> only when nothing else holds it', async () => {
    await makeTestStore();
    mount();
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(focusMain({ ifIdle: true })).toBe(true);
    expect(document.activeElement?.id).toBe('main');
    const btn = root.querySelector<HTMLButtonElement>('.nav__item') as unknown as HTMLElement;
    btn.setAttribute('tabindex', '0');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(focusMain({ ifIdle: true })).toBe(false);
    expect(document.activeElement).toBe(btn);
    expect(focusMain()).toBe(true);
    expect(document.activeElement?.id).toBe('main');
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
    // it leaves the way it arrived: a data-leaving kasure, then unmount (design 09 §6.3)
    finishExit('.toast');
    expect(root.querySelector('.toast')).toBeNull();
  });

  it("a leaving toast ignores the Dismiss button's own bubbled transitionend (the .btn press transition ends 60 ms in)", async () => {
    await makeTestStore();
    mount();
    act(() => {
      swUpdate.value = true;
    });
    const later = root.querySelectorAll<HTMLButtonElement>('.toast button')[1]!;
    act(() => later.click());
    expect(root.querySelector('.toast')?.hasAttribute('data-leaving')).toBe(true);
    act(() => {
      later.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    expect(root.querySelector('.toast'), 'still leaving: the button is not the toast').not.toBeNull();
    finishExit('.toast');
    expect(root.querySelector('.toast')).toBeNull();
  });

  it('under reduced motion a dismissed toast unmounts at once (kasure’s reduced form is instant)', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true } } });
    mount();
    act(() => {
      swUpdate.value = true;
    });
    expect(root.querySelector('.toast')).not.toBeNull();
    act(() => {
      root.querySelectorAll<HTMLButtonElement>('.toast button')[1]?.click();
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

  it('header, nav, brand and main carry fixed view-transition-names; the html[data-vt="theme"] suspension and the scroll-behavior rule have one home, motion.css (design 09 §6.4, §12.1 decision 13)', () => {
    for (const [cls, name] of [
      ['header', 'header'],
      ['nav', 'nav'],
      ['brand', 'brand'],
      ['main', 'main'],
    ]) {
      const re = new RegExp(`\\.layout__${cls}\\s*\\{[^}]*view-transition-name:\\s*${name};`);
      expect(css, cls).toMatch(re);
    }
    const motion = readFileSync(resolve(process.cwd(), 'src/styles/motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const suspend = /html\[data-vt="theme"\] :is\(([^)]*)\)\s*\{([^}]*)\}/.exec(motion);
    expect(suspend, 'suspension rule lives in motion.css').not.toBeNull();
    for (const cls of ['.layout__header', '.layout__nav', '.layout__brand', '.layout__main']) expect(suspend![1]).toContain(cls);
    expect(suspend![2]).toMatch(/view-transition-name:\s*none/);
    expect(motion).toMatch(/html:active-view-transition\s*\{[^}]*scroll-behavior:\s*auto/);
    // and not a second time here (Layout.css keeps only its own `html:active-view-transition .layout__*` rules)
    expect(css).not.toMatch(/html\[data-vt="theme"\] :is\(/);
    expect(css).not.toMatch(/html:active-view-transition\s*\{/);
  });

  it('the header has contain: paint and the .hairline class; the blur rests during a transition (§6.7 rule 4)', () => {
    expect(block('.layout__header {\n  position: sticky')).toMatch(/contain:\s*paint/);
    expect(css).toMatch(/html:active-view-transition \.layout__header\s*\{[^}]*backdrop-filter:\s*none/);
  });

  it('drill chrome leaves by kasure / a slide, never a plain display pop: display flips with allow-discrete; the return is gated on an `out` turn', () => {
    const chrome = /\.layout__status,\s*\.layout__nav\s*\{([^}]*)\}/.exec(css);
    expect(chrome, 'chrome transition rule').not.toBeNull();
    expect(chrome![1]).toMatch(/transition-property:\s*opacity, translate, display/);
    expect(chrome![1]).toMatch(/transition-behavior:\s*allow-discrete/);
    expect(chrome![1]).toMatch(/transition-duration:\s*var\(--dur-3/); // the return: 400 ms, out-eased
    expect(chrome![1]).toMatch(/transition-timing-function:\s*var\(--ease-out/);
    // a first mount never slides: the starting style exists only for the way back from a drill
    expect(css).toMatch(/@starting-style\s*\{\s*html\[data-travel="out"\] \.layout__status/);
    expect(css).not.toMatch(/@starting-style\s*\{\s*\.layout__status/);
    // the no-VT exit: --dur-1, in-eased, no input while it fades
    const exit = /\.layout\[data-route="train"\] \.layout__status,[^{]*\{([^}]*)\}/.exec(css);
    expect(exit![1]).toMatch(/transition-duration:\s*var\(--dur-1/);
    expect(exit![1]).toMatch(/transition-timing-function:\s*var\(--ease-in/);
    expect(exit![1]).toMatch(/pointer-events:\s*none/);
    // the snapshots: in = calc(--dur-3 × .75) with main's dim, out = --dur-3 --ease-out
    expect(css).toMatch(/html\[data-travel="in"\]::view-transition-old\(nav\)\s*\{\s*animation:\s*layout-nav-out calc\(var\(--dur-3, 400ms\) \* 0\.75\) var\(--ease-in/);
    expect(css).toMatch(/html\[data-travel="out"\]::view-transition-new\(nav\)\s*\{\s*animation:\s*layout-nav-in var\(--dur-3, 400ms\) var\(--ease-out/);
  });

  it('the plain arrival fades the shell (opacity only, --dur-fade): nijimi on .layout would make it the containing block of the fixed nav', () => {
    const arrive = block('.layout.ink-nijimi {');
    expect(arrive).toMatch(/animation-name:\s*mat/);
    expect(arrive).toMatch(/animation-duration:\s*var\(--dur-fade\)/);
  });

  it('toasts and notices enter through @starting-style and leave through data-leaving (design 09 §6.3)', () => {
    expect(css).toMatch(/@starting-style\s*\{\s*\.layout__notice,\s*\.layout__toast/);
    const leaving = /\.layout__notice\[data-leaving\],\s*\.layout__toast\[data-leaving\][^{]*\{([^}]*)\}/.exec(css);
    expect(leaving, 'leaving rule').not.toBeNull();
    expect(leaving![1]).toMatch(/opacity:\s*0/);
    expect(leaving![1]).toMatch(/transition-duration:\s*var\(--dur-1\)/);
    expect(leaving![1]).toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/\[hidden\]/); // nothing toggles `hidden`: no dead variant
  });

  it('the brand ignition is one rise with a static glow (never an animated shadow); the lantern look belongs to motion.css', () => {
    const ignite = block('.layout__brand[data-ignite] .layout__brand-ja {');
    expect(ignite).toMatch(/animation:\s*brand-tomosu var\(--dur-4/);
    expect(ignite).toMatch(/text-shadow:\s*var\(--glow-shu/);
    const kf = /@keyframes brand-tomosu\s*\{([\s\S]*?)\}\s*\}/.exec(css);
    expect(kf![1]).toMatch(/opacity:\s*0\.35/);
    expect(kf![1]).not.toMatch(/text-shadow|box-shadow|filter/);
    // one drawn flame everywhere: Layout.css adds only the touch target, no second colour table
    expect(css).not.toMatch(/\.lantern\[data-state/);
    expect(css).not.toMatch(/--lantern-tone/);
    expect(block('.layout .lantern {')).toMatch(/min-height:\s*var\(--touch\)/);
  });

  it('animates only composited properties and takes every duration from a token (design 09 §6.7)', () => {
    expect(css).not.toMatch(/\b\d+ms\b(?![^(]*\))/); // literal ms only as var() fallbacks
    for (const m of css.matchAll(/@keyframes [\w-]+\s*\{([\s\S]*?)\n\}/g)) {
      const props = Array.from(m[1]!.matchAll(/^\s*([a-z-]+):/gm), (x) => x[1]!);
      for (const p of props) expect(['opacity', 'transform', 'translate'], `${m[0].slice(0, 30)} animates ${p}`).toContain(p);
    }
    expect(css).not.toMatch(/\.reduced-motion|prefers-reduced-motion/); // the zeroed tokens and base.css carry reduced motion
  });
});
