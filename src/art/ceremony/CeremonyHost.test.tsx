import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { BADGE_IDS, type BadgeId } from '../../shared/catalog';
import { bus, type Events } from '../../shared/events';
import { href } from '../../shared/routes';
import type { SessionResult } from '../../shared/session-types';
import { makeTestStore } from '../../store/testing';
import {
  BELT_SETTLE_MS,
  CEREMONY_BETWEEN_MS,
  CEREMONY_GRACE_MS,
  CEREMONY_SETTLE_MS,
  CeremonyHost,
  LEVEL_TOAST_MS,
  MAX_QUEUE,
  announcementFor,
  ceremonyKey,
  currentCeremony,
  enqueueCeremony,
  flushCeremonies,
  labelFor,
  pendingCeremonies,
  resetCeremoniesForTests,
} from './CeremonyHost';
import { S } from './strings';
import { EXIT_FALLBACK_MS, setLazyArtForTests } from './support';

let root: HTMLDivElement;
let sfx: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await makeTestStore({ save: { profile: { name: 'Hana', nameKana: 'ハナ' } } });
  bus.reset();
  resetCeremoniesForTests();
  root = document.createElement('div');
  document.body.appendChild(root);
  sfx = vi.fn();
  installServices({ audio: { ...nullAudio, sfx } });
  setLazyArtForTests({ MonCrest: null, GoshuinStamp: null, mon: null, wallpapers: null });
  // jsdom has no 2D canvas; a null context is the "cannot rasterise" path exportPng reports.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.useFakeTimers();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  setLazyArtForTests(null);
  resetCeremoniesForTests();
  bus.reset();
  vi.useRealTimers();
  location.hash = '';
});

const mount = (): void => {
  act(() => render(<CeremonyHost />, root));
};
const emit = <K extends keyof Events>(name: K, payload: Events[K]): void => {
  act(() => bus.emit(name, payload));
};
const tick = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const dialog = (): HTMLElement | null => root.querySelector('[role="dialog"]');
const live = (): string => root.querySelector('.ceremony-live')?.textContent ?? '';
const key = (k: string, target: Element | null = dialog()): void => {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
};
const badge = (id: BadgeId): void => emit('badge:earned', { id });
const finished = (): void => emit('session:finished', { planId: 'p', mode: 'kata', startedAt: 0, endedAt: 1, steps: [], zen: false, resumed: false, tally: {} } as unknown as SessionResult);

describe('<CeremonyHost> queue', () => {
  it('events enqueue and show after the settle beat, with a labelled dialog and a live announcement', () => {
    mount();
    expect(dialog()).toBeNull();
    badge('seven');
    expect(dialog()).toBeNull();
    expect(pendingCeremonies()).toHaveLength(1);
    tick(CEREMONY_SETTLE_MS);
    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.getAttribute('aria-label')).toContain('Seven Days');
    expect(root.querySelector('.badge-slam')?.getAttribute('data-badge')).toBe('seven');
    expect(live()).toContain('Seven Days');
    expect(pendingCeremonies()).toHaveLength(0);
    expect(sfx).toHaveBeenCalledWith('badge');
  });

  it('defers while a session is active and flushes after session:finished (grace for the つづく card)', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'kumite', zen: false });
    badge('ippon');
    emit('stamp:earned', { station: 4, perfect: false, assisted: false });
    tick(10_000);
    expect(dialog()).toBeNull();
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['badge:ippon', 'stamp:4']);
    finished();
    tick(CEREMONY_GRACE_MS - 1);
    expect(dialog()).toBeNull();
    tick(1);
    expect(root.querySelector('.badge-slam')).not.toBeNull();
  });

  it('attempt:graded also marks a session active (resumed sessions never emit session:started)', () => {
    mount();
    emit('attempt:graded', { correct: true } as unknown as Events['attempt:graded']);
    emit('stamp:earned', { station: 9, perfect: true, assisted: false });
    tick(5_000);
    expect(dialog()).toBeNull();
    emit('session:abandoned', { sessionId: 's', steps: 3 });
    tick(CEREMONY_GRACE_MS);
    expect(root.querySelector('.stamp-press')?.getAttribute('data-station')).toBe('9');
  });

  it('preserves arrival order and dismisses by Escape, a backdrop tap, Enter and Space', () => {
    mount();
    badge('seven');
    emit('stamp:earned', { station: 7, perfect: false, assisted: false });
    emit('wallpaper:unlocked', { id: 'okaeri' });
    badge('ippon');
    tick(CEREMONY_SETTLE_MS);
    expect(root.querySelector('.badge-slam')?.getAttribute('data-badge')).toBe('seven');

    key('Escape');
    // the overlay leaves as kasure (design 09 §6.3): data-leaving on the root, gone on the ≤ 200 ms fallback
    expect(dialog()).not.toBeNull();
    expect(root.querySelector('.ceremony')?.hasAttribute('data-leaving')).toBe(true);
    tick(EXIT_FALLBACK_MS);
    expect(dialog()).toBeNull();
    expect(live()).toBe('');
    tick(CEREMONY_BETWEEN_MS);
    expect(root.querySelector('.stamp-press')).not.toBeNull();
    expect(root.querySelector('.ceremony')?.hasAttribute('data-leaving')).toBe(false);

    act(() => {
      (root.querySelector('.ceremony__backdrop') as HTMLElement).click();
    });
    tick(EXIT_FALLBACK_MS + CEREMONY_BETWEEN_MS);
    expect(root.querySelector('.kakejiku-unlock')?.getAttribute('data-wallpaper')).toBe('okaeri');

    key('Enter');
    tick(EXIT_FALLBACK_MS + CEREMONY_BETWEEN_MS);
    expect(root.querySelector('.badge-slam')?.getAttribute('data-badge')).toBe('ippon');

    key(' ');
    tick(EXIT_FALLBACK_MS);
    expect(dialog()).toBeNull();
    expect(pendingCeremonies()).toHaveLength(0);
  });

  it('the dialog carries the verb and the exit (the full-viewport backdrop only fades): kasure ends early on the dialog’s own animationend, never on a child’s', () => {
    mount();
    badge('seven');
    tick(CEREMONY_SETTLE_MS);
    const overlay = root.querySelector('.ceremony')!;
    expect(overlay.classList.contains('ink-nijimi')).toBe(false);
    expect(dialog()?.classList.contains('ink-nijimi')).toBe(true);
    key('Escape');
    expect(overlay.hasAttribute('data-leaving')).toBe(true);
    expect(dialog()?.hasAttribute('data-leaving')).toBe(true);
    act(() => {
      root.querySelector('.badge-slam')!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(dialog()).not.toBeNull();
    act(() => {
      dialog()!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it('a belt ceremony arriving outside a session waits for the Shinsa sumi beat (BELT_SETTLE_MS) before it opens', () => {
    mount();
    emit('belt:promoted', { belt: 'green' });
    tick(CEREMONY_SETTLE_MS);
    expect(dialog()).toBeNull();
    tick(BELT_SETTLE_MS - CEREMONY_SETTLE_MS - 1);
    expect(dialog()).toBeNull();
    tick(1);
    expect(root.querySelector('.belt-ceremony')?.getAttribute('data-belt')).toBe('green');
    expect(BELT_SETTLE_MS).toBeGreaterThanOrEqual(600 + 120);
    // other ceremonies keep the plain settle
    key('Escape');
    tick(EXIT_FALLBACK_MS + CEREMONY_BETWEEN_MS);
    badge('seven');
    tick(CEREMONY_SETTLE_MS);
    expect(root.querySelector('.badge-slam')).not.toBeNull();
  });

  it('a tap on the card text dismisses; a tap on a control inside does not', async () => {
    mount();
    badge('first-step');
    tick(CEREMONY_SETTLE_MS);
    const save = root.querySelector('.badge-slam__save') as HTMLButtonElement;
    await act(async () => {
      save.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(dialog()).not.toBeNull();
    act(() => {
      (root.querySelector('.badge-slam__describe') as HTMLElement).click();
    });
    tick(EXIT_FALLBACK_MS);
    expect(dialog()).toBeNull();
  });

  it('Enter on a focused control activates the control instead of dismissing twice', () => {
    mount();
    badge('first-step');
    tick(CEREMONY_SETTLE_MS);
    const btn = root.querySelector('.badge-slam__continue') as HTMLButtonElement;
    key('Enter', btn);
    expect(dialog()).not.toBeNull();
    act(() => btn.click());
    // ONE kasure beat: the card hands over at once (hostExit) and the overlay dries out
    expect(root.querySelector('.badge-slam')?.hasAttribute('data-leaving')).toBe(false);
    expect(root.querySelector('.ceremony')?.hasAttribute('data-leaving')).toBe(true);
    tick(EXIT_FALLBACK_MS);
    expect(dialog()).toBeNull();
  });

  it('flushCeremonies() shows the deferred queue at once', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    badge('seven');
    tick(5_000);
    expect(dialog()).toBeNull();
    act(() => flushCeremonies());
    expect(root.querySelector('.badge-slam')).not.toBeNull();
  });

  it('a belt promotion folds in its Shinsa badge and ceremony wallpaper', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'shinsa', zen: false });
    badge('belt-green');
    emit('wallpaper:unlocked', { id: 'fuji-ridge' });
    badge('seven');
    emit('belt:promoted', { belt: 'green' });
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['badge:seven', 'belt:green']);
    emit('wallpaper:unlocked', { id: 'fuji-ridge' });
    badge('belt-green');
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['badge:seven', 'belt:green']);
    finished();
    tick(CEREMONY_GRACE_MS);
    key('Escape');
    tick(EXIT_FALLBACK_MS + CEREMONY_BETWEEN_MS);
    const belt = root.querySelector('.belt-ceremony')!;
    expect(belt.getAttribute('data-belt')).toBe('green');
    expect(dialog()?.getAttribute('aria-label')).toBe('Green belt');
    expect(root.querySelector('.ceremony--belt')).not.toBeNull();
    expect(live()).toContain('Green belt');
  });

  it('wallpaper reveals carry their quadrant; a later full unlock replaces a queued reveal', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    emit('wallpaper:revealed', { id: 'great-wave', quadrant: 2 });
    emit('wallpaper:revealed', { id: 'great-wave', quadrant: 3 });
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['wallpaper:great-wave:2', 'wallpaper:great-wave:3']);
    emit('wallpaper:unlocked', { id: 'great-wave' });
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['wallpaper:great-wave:full']);
    emit('wallpaper:revealed', { id: 'great-wave', quadrant: 4 });
    expect(pendingCeremonies()).toHaveLength(1);
    resetCeremoniesForTests();
    emit('wallpaper:revealed', { id: 'sumi-dragon', quadrant: 1 });
    tick(CEREMONY_SETTLE_MS);
    expect(root.querySelector('.kakejiku-unlock__quadrant')?.textContent).toBe('1 of 4');
  });

  it('level:up is a toast that keeps only the latest level, plays the koto, and dismisses itself', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    emit('level:up', { level: 4 });
    emit('level:up', { level: 5 });
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['level']);
    finished();
    tick(CEREMONY_GRACE_MS);
    const toast = root.querySelector('.ceremony-toast')!;
    expect(toast).not.toBeNull();
    expect(dialog()).toBeNull();
    // a .sheet, not the reserved cartouche (§2.5): no clip-path under the verb (§6.7 rule 7)
    expect(toast.classList.contains('sheet')).toBe(true);
    expect(toast.classList.contains('status-window')).toBe(false);
    expect(toast.classList.contains('ink-nijimi')).toBe(true);
    expect(toast.textContent).toContain('Lv 5');
    expect(sfx).toHaveBeenCalledWith('promotion');
    expect(live()).toBe(announcementFor({ kind: 'level', level: 5 }));
    tick(LEVEL_TOAST_MS);
    expect(root.querySelector('.ceremony-toast')?.hasAttribute('data-leaving')).toBe(true);
    tick(EXIT_FALLBACK_MS);
    expect(root.querySelector('.ceremony-toast')).toBeNull();
  });

  it('a level reached while its toast shows queues behind it instead of being lost', () => {
    mount();
    emit('level:up', { level: 7 });
    tick(CEREMONY_SETTLE_MS);
    expect(root.querySelector('.ceremony-toast')?.textContent).toContain('Lv 7');
    emit('level:up', { level: 8 });
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['level']);
    tick(LEVEL_TOAST_MS + EXIT_FALLBACK_MS + CEREMONY_BETWEEN_MS);
    expect(root.querySelector('.ceremony-toast')?.textContent).toContain('Lv 8');
  });

  it('a burst longer than MAX_QUEUE collapses into one summary card that points at Collections', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    const ids = BADGE_IDS.slice(0, MAX_QUEUE + 4);
    for (const id of ids) badge(id);
    const keys = pendingCeremonies().map(ceremonyKey);
    expect(keys).toHaveLength(MAX_QUEUE + 1);
    expect(keys[keys.length - 1]).toBe('summary');
    emit('belt:promoted', { belt: 'yellow' });
    expect(pendingCeremonies().map(ceremonyKey).slice(-2)).toEqual(['belt:yellow', 'summary']);
    finished();
    tick(CEREMONY_GRACE_MS);
    for (let i = 0; i < MAX_QUEUE + 1; i++) {
      expect(dialog()).not.toBeNull();
      key('Escape');
      tick(EXIT_FALLBACK_MS + CEREMONY_BETWEEN_MS);
    }
    const summary = root.querySelector('.ceremony-summary')!;
    expect(summary).not.toBeNull();
    expect(summary.querySelector('.ceremony-summary__counts')?.textContent).toBe('4 Mon');
    expect(summary.querySelector('.ceremony-summary__link')?.getAttribute('href')).toBe(href({ name: 'collections', tab: 'mon' }));
    expect(summary.classList.contains('sheet')).toBe(true);
    key('Escape');
    tick(EXIT_FALLBACK_MS);
    expect(dialog()).toBeNull();
    expect(pendingCeremonies()).toHaveLength(0);
  });

  it('reduced motion renders the static variant: no ink verb anywhere, final frame of the belt, an immediate dismissal', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true }, profile: { nameKana: 'ハナ' } } });
    mount();
    emit('belt:promoted', { belt: 'blue' });
    tick(CEREMONY_SETTLE_MS);
    expect(root.querySelector('.ceremony')?.classList.contains('ink-nijimi')).toBe(false);
    expect(root.querySelector('[class*="ink-"]')).toBeNull();
    // the belt hold is for the sumi beat, which is absent under reduced motion: the plain settle applies
    expect(root.querySelector('.belt-ceremony')?.getAttribute('data-phase-name')).toBe('vignette');
    expect(root.querySelector('.belt-vignette__continue')).not.toBeNull();
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ハ');
    key('Escape');
    expect(dialog()).toBeNull();
  });

  it('moves focus into the dialog, locks page scroll, and restores both on close', () => {
    const outside = document.createElement('button');
    outside.textContent = 'x';
    document.body.appendChild(outside);
    outside.focus();
    mount();
    badge('seven');
    tick(CEREMONY_SETTLE_MS);
    expect(document.activeElement).toBe(dialog());
    expect(document.body.style.overflow).toBe('hidden');
    key('Tab');
    key('Escape');
    tick(EXIT_FALLBACK_MS);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('keeps a showing ceremony for the next host when unmounted', () => {
    mount();
    badge('seven');
    tick(CEREMONY_SETTLE_MS);
    expect(currentCeremony()?.kind).toBe('badge');
    act(() => render(null, root));
    expect(currentCeremony()).toBeNull();
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['badge:seven']);
    mount();
    tick(CEREMONY_SETTLE_MS);
    expect(root.querySelector('.badge-slam')?.getAttribute('data-badge')).toBe('seven');
  });

  it('dedupes identical rewards and ignores a summary pushed from outside', () => {
    mount();
    emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    badge('seven');
    badge('seven');
    enqueueCeremony({ kind: 'summary', badges: 1, wallpapers: 0, stamps: 0, levels: 0 });
    expect(pendingCeremonies().map(ceremonyKey)).toEqual(['badge:seven']);
  });

  it('labels and announcements name the reward in plain words', () => {
    expect(labelFor({ kind: 'badge', id: 'kyoto' })).toBe(`${S.badgeEarned}: Kyoto`);
    expect(labelFor({ kind: 'stamp', station: 7, perfect: true, assisted: false })).toBe(`${S.stampTitle}: Station 7`);
    expect(labelFor({ kind: 'wallpaper', id: 'daruma', quadrant: 1 })).toBe(`${S.wallpaperRevealed}: Daruma`);
    expect(announcementFor({ kind: 'stamp', station: 7, perfect: false, assisted: false })).toContain('平塚');
    expect(announcementFor({ kind: 'wallpaper', id: 'daruma' })).toContain('達磨');
    expect(announcementFor({ kind: 'belt', belt: 'black' })).toContain('Black belt');
    expect(announcementFor({ kind: 'summary', badges: 0, wallpapers: 0, stamps: 0, levels: 0 })).toBe(S.announceSummary);
  });
});
