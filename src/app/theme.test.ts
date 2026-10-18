import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freshSave, resetStoreForTests, store } from '@/store';
import type { Settings } from '@/shared/store-types';
import { makeTestStore } from '@/store/testing';
import { SEKKI_MIX_MAX, sekkiOf } from '@/shared/koyomi';
import { civilToDay, localToMs } from '@/shared/time';
import { applyCalendar, applyTheme, canThemeTransition, effectiveTheme, mixHex, phaseAt, skyMetaColor, startThemeSync, transitionTheme } from './theme';

function settings(over: Partial<Settings> = {}): Settings {
  return { ...freshSave(0, 'UTC').settings, ...over };
}

const html = (): HTMLElement => document.documentElement;
const meta = (): string | null => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

const TOKYO = 'Asia/Tokyo';
const at = (tz: string, y: number, m: number, d: number, h: number, min = 0): number => localToMs({ year: y, month: m, day: d }, h, min, tz);
const prop = (name: string): string => html().style.getPropertyValue(name);
/** The View Transition API slot, typed loosely so a test can install a fake and remove it. */
const vtSlot = (): { startViewTransition?: unknown } => document as unknown as { startViewTransition?: unknown };
/** Disposers of every `startThemeSync` a test started, run even when the test fails (a leaked effect would repaint later tests). */
const stops: (() => void)[] = [];
const sync = (...args: Parameters<typeof startThemeSync>): (() => void) => {
  const stop = startThemeSync(...args);
  stops.push(stop);
  return stop;
};

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  resetStoreForTests();
  vi.useRealTimers();
  for (const a of ['data-theme', 'data-color-scheme', 'data-feel', 'data-crt', 'data-reduced-motion', 'data-phase', 'data-season', 'data-sekki', 'data-moon', 'data-vt']) html().removeAttribute(a);
  html().removeAttribute('style');
  document.body.className = '';
  document.querySelector('meta[name="theme-color"]')?.remove();
  delete vtSlot().startViewTransition;
});

describe('effectiveTheme', () => {
  it('auto follows the system preference', () => {
    expect(effectiveTheme(settings({ theme: 'auto' }), true)).toBe('dark');
    expect(effectiveTheme(settings({ theme: 'auto' }), false)).toBe('light');
  });
  it('manual choice overrides the media query', () => {
    expect(effectiveTheme(settings({ theme: 'light' }), true)).toBe('light');
    expect(effectiveTheme(settings({ theme: 'dark' }), false)).toBe('dark');
  });
  it('without matchMedia (jsdom) auto is light', () => {
    expect(effectiveTheme(settings({ theme: 'auto' }))).toBe('light');
  });
  it('sky reads the phase: Morning through dawn and day, Night from the moment dusk falls (09 §2.4, §7 G); the OS preference is ignored; no phase means Morning', () => {
    const sky = settings({ theme: 'sky' });
    expect(effectiveTheme(sky, true, 'dawn')).toBe('light');
    expect(effectiveTheme(sky, true, 'day')).toBe('light');
    expect(effectiveTheme(sky, false, 'dusk')).toBe('dark');
    expect(effectiveTheme(sky, false, 'night')).toBe('dark');
    expect(effectiveTheme(sky, true)).toBe('light');
    expect(phaseAt(at(TOKYO, 2026, 10, 18, 12), TOKYO)).toBe('day');
    expect(phaseAt(at(TOKYO, 2026, 10, 18, 18), TOKYO)).toBe('dusk');
    expect(phaseAt(at(TOKYO, 2026, 10, 18, 21), TOKYO)).toBe('night');
  });
});

describe('applyTheme', () => {
  it('auto + dark media → data-theme=auto, color-scheme dark, dark theme-color', () => {
    applyTheme(settings({ theme: 'auto' }), { prefersDark: true });
    expect(html().getAttribute('data-theme')).toBe('auto');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(meta()?.toUpperCase()).toBe('#0B0B10');
  });

  it('manual light overrides dark media', () => {
    applyTheme(settings({ theme: 'light' }), { prefersDark: true });
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(meta()?.toUpperCase()).toBe('#F4EDE0');
  });

  it('manual dark sets data-theme=dark', () => {
    applyTheme(settings({ theme: 'dark' }), { prefersDark: false });
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
  });

  it('feel class swaps on body and data-feel on html', () => {
    applyTheme(settings({ feel: 'dojo' }));
    expect(document.body.classList.contains('feel-dojo')).toBe(true);
    expect(html().getAttribute('data-feel')).toBe('dojo');
    applyTheme(settings({ feel: 'arcade' }));
    expect(document.body.classList.contains('feel-arcade')).toBe(true);
    expect(document.body.classList.contains('feel-dojo')).toBe(false);
    expect(html().getAttribute('data-feel')).toBe('arcade');
    applyTheme(settings({ feel: 'zen' }));
    expect(Array.from(document.body.classList).filter((c) => c.startsWith('feel-'))).toEqual(['feel-zen']);
  });

  it('reducedMotion adds the class and the data attribute; removing it removes both', () => {
    applyTheme(settings({ reducedMotion: true }));
    expect(document.body.classList.contains('reduced-motion')).toBe(true);
    expect(html().hasAttribute('data-reduced-motion')).toBe(true);
    applyTheme(settings({ reducedMotion: false }));
    expect(document.body.classList.contains('reduced-motion')).toBe(false);
    expect(html().hasAttribute('data-reduced-motion')).toBe(false);
  });

  it('CRT applies only with the arcade feel', () => {
    applyTheme(settings({ crt: true, feel: 'dojo' }));
    expect(document.body.classList.contains('crt')).toBe(false);
    expect(html().hasAttribute('data-crt')).toBe(false);
    applyTheme(settings({ crt: true, feel: 'arcade' }));
    expect(document.body.classList.contains('crt')).toBe(true);
    expect(html().hasAttribute('data-crt')).toBe(true);
  });

  it('creates the theme-color meta when index.html lacks one and reuses it afterwards', () => {
    expect(meta()).toBeNull();
    applyTheme(settings({ theme: 'dark' }));
    expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
    applyTheme(settings({ theme: 'light' }));
    expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
    expect(meta()?.toUpperCase()).toBe('#F4EDE0');
  });
});

describe('applyCalendar (design 09 §4.3, §7 H)', () => {
  // 2026-10-18 in Tokyo: autumn, 寒露 kanro (Oct 8 → Oct 24, --shu 2 %), the waxing half moon.
  const OCT18 = { 'data-season': 'autumn', 'data-sekki': 'kanro', 'data-moon': 'first-quarter' };
  const cases = [
    { label: '05:30 dawn', h: 5, min: 30, phase: 'dawn', sky: ['#1F3A93', '#C9718A', '#F7B2C4'], lamp: '0.15' },
    { label: '12:00 day', h: 12, min: 0, phase: 'day', sky: ['#4F6FD6', '#9FC4F0', '#F4EDE0'], lamp: '0' },
    { label: '18:00 dusk', h: 18, min: 0, phase: 'dusk', sky: ['#1F2A6B', '#C9302C', '#E0B341'], lamp: '0.35' },
    { label: '23:00 night', h: 23, min: 0, phase: 'night', sky: ['#0A0F2E', '#1F2A6B', '#1F3A93'], lamp: '0.6' },
  ] as const;

  it.each(cases)('$label: attributes and properties byte for byte', ({ h, min, phase, sky, lamp }) => {
    applyCalendar(at(TOKYO, 2026, 10, 18, h, min), TOKYO, document, { belt: 'green', scheme: 'light' });
    expect(html().getAttribute('data-phase')).toBe(phase);
    for (const [k, v] of Object.entries(OCT18)) expect(html().getAttribute(k), k).toBe(v);
    expect(prop('--sky-top')).toBe(sky[0]);
    expect(prop('--sky-mid')).toBe(sky[1]);
    expect(prop('--sky-horizon')).toBe(sky[2]);
    expect(prop('--lamp-alpha')).toBe(lamp);
    expect(prop('--sekki-pigment')).toBe('var(--shu)');
    expect(prop('--sekki-mix')).toBe('2%');
    expect(prop('--belt-color')).toBe('var(--belt-green)');
    // the browser chrome tells the hour: the horizon mixed 40 % into --bg (light #F4EDE0)
    expect(meta()).toBe(skyMetaColor('#F4EDE0', sky[2]));
  });

  it('the meta colour is the sky horizon mixed 40 % into the effective --bg: day on washi stays washi, night on lacquer turns indigo', () => {
    expect(mixHex('#0B0B10', '#1F3A93', 0.4)).toBe('#131E44');
    expect(skyMetaColor('#F4EDE0', '#F4EDE0')).toBe('#F4EDE0');
    applyCalendar(at(TOKYO, 2026, 10, 18, 23), TOKYO, document, { scheme: 'dark' });
    expect(meta()).toBe('#131E44');
    applyCalendar(at(TOKYO, 2026, 10, 18, 12), TOKYO, document, { scheme: 'light' });
    expect(meta()).toBe('#F4EDE0');
    // without a scheme option the document's data-color-scheme decides
    html().setAttribute('data-color-scheme', 'dark');
    applyCalendar(at(TOKYO, 2026, 10, 18, 23), TOKYO, document);
    expect(meta()).toBe('#131E44');
  });

  it('--sekki-mix never exceeds 3 % on any day of a year, and the pigment is always a var() of a palette token', () => {
    const start = civilToDay({ year: 2026, month: 1, day: 1 });
    const seen = new Set<string>();
    for (let i = 0; i < 365; i++) {
      const now = localToMs({ year: 2026, month: 1, day: 1 + i }, 12, 0, TOKYO);
      applyCalendar(now, TOKYO, document, { scheme: 'light' });
      const mix = Number.parseFloat(prop('--sekki-mix'));
      expect(mix, `day ${i}`).toBeGreaterThan(0);
      expect(mix, `day ${i}`).toBeLessThanOrEqual(SEKKI_MIX_MAX);
      expect(prop('--sekki-pigment')).toMatch(/^var\(--(sakura|matcha|kin|hai|kon|ai|shu)\)$/);
      expect(html().getAttribute('data-sekki')).toBe(sekkiOf(start + i).id);
      seen.add(html().getAttribute('data-sekki')!);
    }
    expect(seen.size).toBe(24);
  });

  it('the learner day drives the date: 03:00 still belongs to yesterday’s sekki, moon and season; an unknown belt leaves --belt-color alone', () => {
    // 2026-02-04 立春 begins; at 03:00 on Feb 4 the learner day is still Feb 3 (大寒)
    applyCalendar(at(TOKYO, 2026, 2, 4, 3), TOKYO, document, { belt: 'white' });
    expect(html().getAttribute('data-sekki')).toBe('daikan');
    expect(html().getAttribute('data-phase')).toBe('night');
    applyCalendar(at(TOKYO, 2026, 2, 4, 4), TOKYO, document, { belt: 'bogus' as never });
    expect(html().getAttribute('data-sekki')).toBe('risshun');
    expect(prop('--belt-color')).toBe('var(--belt-white)');
    // 2026-03-01 03:00 → learner day Feb 28 → winter
    applyCalendar(at(TOKYO, 2026, 3, 1, 3), TOKYO, document);
    expect(html().getAttribute('data-season')).toBe('winter');
    applyCalendar(at(TOKYO, 2026, 3, 1, 4), TOKYO, document);
    expect(html().getAttribute('data-season')).toBe('spring');
  });

  it('an unresolvable zone falls back to the host zone instead of throwing', () => {
    expect(() => applyCalendar(Date.UTC(2026, 9, 18, 3), 'Mars/Olympus', document)).not.toThrow();
    expect(html().getAttribute('data-sekki')).toBe('kanro');
  });
});

describe('applyTheme with the clock (sky + calendar)', () => {
  it('sky at 12:00 is Dojo Morning, at 18:00 (dusk) and 21:00 Arcade Night, whatever the OS prefers; data-theme pins the palette to the scheme', () => {
    applyTheme(settings({ theme: 'sky' }), { prefersDark: true, now: at(TOKYO, 2026, 10, 18, 12), tz: TOKYO });
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().getAttribute('data-phase')).toBe('day');
    expect(meta()).toBe('#F4EDE0');
    // dusk has fallen: Night, with the dusk horizon in the chrome
    applyTheme(settings({ theme: 'sky' }), { prefersDark: false, now: at(TOKYO, 2026, 10, 18, 18), tz: TOKYO });
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-phase')).toBe('dusk');
    expect(meta()).toBe(mixHex('#0B0B10', '#E0B341', 0.4));
    applyTheme(settings({ theme: 'sky' }), { prefersDark: false, now: at(TOKYO, 2026, 10, 18, 21), tz: TOKYO });
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-phase')).toBe('night');
    expect(meta()).toBe('#131E44');
  });

  it('applyTheme without env.tz uses UTC for both the sky phase and the calendar — one zone, whatever the host zone', () => {
    applyTheme(settings({ theme: 'sky' }), { prefersDark: false, now: Date.UTC(2026, 9, 18, 18, 30) });
    expect(html().getAttribute('data-phase')).toBe('dusk');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    applyTheme(settings({ theme: 'sky' }), { prefersDark: true, now: Date.UTC(2026, 9, 18, 12, 0) });
    expect(html().getAttribute('data-phase')).toBe('day');
    expect(html().getAttribute('data-color-scheme')).toBe('light');
  });

  it('applyTheme is compare-and-set: a second identical apply writes no attribute, no property and no meta', () => {
    const env = { prefersDark: false, now: at(TOKYO, 2026, 10, 18, 12), tz: TOKYO, belt: 'green' as const };
    const s = settings({ theme: 'sky', feel: 'arcade', crt: true });
    applyTheme(s, env);
    const metaEl = document.querySelector('meta[name="theme-color"]')!;
    const attr = vi.spyOn(html(), 'setAttribute');
    const style = vi.spyOn(html().style, 'setProperty');
    const metaAttr = vi.spyOn(metaEl, 'setAttribute');
    applyTheme(s, env);
    expect(attr).not.toHaveBeenCalled();
    expect(style).not.toHaveBeenCalled();
    expect(metaAttr).not.toHaveBeenCalled();
    attr.mockRestore();
    style.mockRestore();
    metaAttr.mockRestore();
  });

  it('with env.now the calendar is applied and --belt-color follows the belt; without it nothing calendar-shaped is written', () => {
    applyTheme(settings({ theme: 'light' }), { now: at(TOKYO, 2026, 10, 18, 12), tz: TOKYO, belt: 'brown' });
    expect(html().getAttribute('data-sekki')).toBe('kanro');
    expect(prop('--belt-color')).toBe('var(--belt-brown)');
    html().removeAttribute('data-sekki');
    html().removeAttribute('style');
    applyTheme(settings({ theme: 'light' }));
    expect(html().hasAttribute('data-sekki')).toBe(false);
    expect(prop('--belt-color')).toBe('');
    expect(meta()?.toUpperCase()).toBe('#F4EDE0');
  });
});

describe('moment G · Kure — the theme change rides a View Transition', () => {
  function fakeVt(trace: string[]): { svt: ReturnType<typeof vi.fn>; finish(): Promise<void> } {
    let resolveFinished!: () => void;
    const finished = new Promise<void>((r) => {
      resolveFinished = r;
    });
    const svt = vi.fn((update: () => void) => {
      trace.push(`before:${html().getAttribute('data-vt')}:${html().getAttribute('data-color-scheme')}`);
      update();
      trace.push(`inside:${html().getAttribute('data-vt')}:${html().getAttribute('data-color-scheme')}`);
      return { finished };
    });
    vtSlot().startViewTransition = svt;
    return {
      svt,
      finish: async () => {
        resolveFinished();
        await finished;
        await Promise.resolve();
      },
    };
  }

  it('transitionTheme: data-vt="theme" is set before the callback, applyTheme runs inside it, the attribute clears on finished', async () => {
    const trace: string[] = [];
    const { svt, finish } = fakeVt(trace);
    const ran = transitionTheme(document, () => applyTheme(settings({ theme: 'dark' })), false);
    expect(ran).toBe(true);
    expect(svt).toHaveBeenCalledTimes(1);
    expect(trace).toEqual(['before:theme:null', 'inside:theme:dark']);
    expect(html().getAttribute('data-vt')).toBe('theme');
    expect(meta()?.toUpperCase()).toBe('#0B0B10');
    await finish();
    expect(html().hasAttribute('data-vt')).toBe(false);
  });

  it('transitionTheme: an older transition finishing never clears data-vt from under a newer one (two taps, or a boundary beside a tap)', async () => {
    const trace: string[] = [];
    const first = fakeVt(trace);
    expect(transitionTheme(document, () => applyTheme(settings({ theme: 'dark' })), false)).toBe(true);
    const second = fakeVt(trace);
    expect(transitionTheme(document, () => applyTheme(settings({ theme: 'light' })), false)).toBe(true);
    expect(html().getAttribute('data-vt')).toBe('theme');
    await first.finish();
    expect(html().getAttribute('data-vt')).toBe('theme');
    await second.finish();
    expect(html().hasAttribute('data-vt')).toBe(false);
  });

  it('without the API, under reduced motion, or while hidden the change applies directly and data-vt is never set', () => {
    expect(canThemeTransition(document, false)).toBe(false);
    expect(transitionTheme(document, () => applyTheme(settings({ theme: 'dark' })), false)).toBe(false);
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(html().hasAttribute('data-vt')).toBe(false);
    const trace: string[] = [];
    const { svt } = fakeVt(trace);
    expect(canThemeTransition(document, true)).toBe(false);
    expect(transitionTheme(document, () => applyTheme(settings({ theme: 'light' })), true)).toBe(false);
    expect(svt).not.toHaveBeenCalled();
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(html().hasAttribute('data-vt')).toBe(false);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    expect(canThemeTransition(document, false)).toBe(false);
    hidden.mockRestore();
    expect(canThemeTransition(document, false)).toBe(true);
  });

  it('startThemeSync: the first paint is direct; a scheme or feel change rides the transition; a change nothing repaints does not; reduced motion skips the API', async () => {
    await makeTestStore({ save: { settings: { theme: 'light', feel: 'dojo' } } });
    const trace: string[] = [];
    const { svt, finish } = fakeVt(trace);
    // no reducedMotion override: the setting decides (jsdom has no matchMedia, so the media query reads false)
    const stop = sync({ prefersDark: false, now: at(TOKYO, 2026, 10, 18, 12), tz: TOKYO });
    expect(svt).not.toHaveBeenCalled();
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(html().getAttribute('data-sekki')).toBe('kanro');
    store.patch('settings', (s) => ({ ...s, theme: 'dark' }));
    expect(svt).toHaveBeenCalledTimes(1);
    expect(trace).toEqual(['before:theme:light', 'inside:theme:dark']);
    // dark --bg with the day horizon mixed in
    expect(meta()).toBe(skyMetaColor('#0B0B10', '#F4EDE0'));
    await finish();
    expect(html().hasAttribute('data-vt')).toBe(false);
    store.patch('settings', (s) => ({ ...s, sound: 0.2 }));
    expect(svt).toHaveBeenCalledTimes(1);
    store.patch('settings', (s) => ({ ...s, feel: 'arcade' }));
    expect(svt).toHaveBeenCalledTimes(2);
    expect(html().getAttribute('data-feel')).toBe('arcade');
    store.patch('settings', (s) => ({ ...s, reducedMotion: true }));
    expect(svt).toHaveBeenCalledTimes(2);
    store.patch('settings', (s) => ({ ...s, theme: 'light' }));
    expect(svt).toHaveBeenCalledTimes(2);
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    stop();
  });

  it('startThemeSync: Follow the sky falls to Night at the 17:00 dusk boundary through the timer (moment G, the lanterns light inside it), stays Night at 20:00 without a second transition, re-applies on visibilitychange, and stops on dispose', async () => {
    vi.useFakeTimers();
    await makeTestStore({ save: { settings: { theme: 'sky' }, profile: { tz: TOKYO, belt: 'blue' } } });
    let now = at(TOKYO, 2026, 10, 18, 16, 59);
    const trace: string[] = [];
    const { svt } = fakeVt(trace);
    const stop = sync({ prefersDark: true, clock: () => now, reducedMotion: false });
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(html().getAttribute('data-phase')).toBe('day');
    expect(prop('--belt-color')).toBe('var(--belt-blue)');
    // 16:59:59 — not yet
    now += 59_000;
    vi.advanceTimersByTime(59_000);
    expect(html().getAttribute('data-phase')).toBe('day');
    // 17:00 + the one-second slack: the timer fires, dusk falls through moment G
    now += 2_000;
    vi.advanceTimersByTime(2_000);
    expect(html().getAttribute('data-phase')).toBe('dusk');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(svt).toHaveBeenCalledTimes(1);
    expect(trace[0]).toBe('before:theme:light');
    expect(meta()).toBe(mixHex('#0B0B10', '#E0B341', 0.4));
    // 20:00: night — the scheme is already Night, so the sky stops change but no transition starts
    now = at(TOKYO, 2026, 10, 18, 20, 0) + 1_500;
    vi.advanceTimersByTime(3 * 3_600_000);
    expect(html().getAttribute('data-phase')).toBe('night');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(svt).toHaveBeenCalledTimes(1);
    // the tab comes back at 08:30 next morning: visibilitychange re-applies and re-arms
    now = at(TOKYO, 2026, 10, 19, 8, 30);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(html().getAttribute('data-phase')).toBe('day');
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(svt).toHaveBeenCalledTimes(2);
    // re-armed for 17:00: eight and a half hours later dusk falls again
    now = at(TOKYO, 2026, 10, 19, 17, 0) + 1_500;
    vi.advanceTimersByTime(8.5 * 3_600_000 + 1_500);
    expect(html().getAttribute('data-phase')).toBe('dusk');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(svt).toHaveBeenCalledTimes(3);
    // disposed: neither the timer nor visibilitychange touches the document again
    stop();
    now = at(TOKYO, 2026, 10, 20, 8, 0);
    vi.advanceTimersByTime(15 * 3_600_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(html().getAttribute('data-phase')).toBe('dusk');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
  });

  it('startThemeSync: a time-zone change re-applies the calendar and re-arms the boundary timer for the new zone', async () => {
    vi.useFakeTimers();
    await makeTestStore({ save: { settings: { theme: 'sky' }, profile: { tz: TOKYO, belt: 'blue' } } });
    // Tokyo 10:00 on Oct 19 is 18:00 the evening before in Los Angeles (PDT)
    let now = at(TOKYO, 2026, 10, 19, 10, 0);
    const stop = sync({ prefersDark: false, clock: () => now, reducedMotion: true });
    expect(html().getAttribute('data-phase')).toBe('day');
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    store.patch('profile', (p) => ({ ...p, tz: 'America/Los_Angeles' }));
    expect(html().getAttribute('data-phase')).toBe('dusk');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    // the old zone's next boundary was Tokyo 17:00, seven hours out; the new zone's is 20:00 Los Angeles, two hours out
    now += 2 * 3_600_000 + 2_000;
    vi.advanceTimersByTime(2 * 3_600_000 + 2_000);
    expect(html().getAttribute('data-phase')).toBe('night');
    stop();
  });

  it('startThemeSync: an XP or level patch on profile (every graded answer) never re-applies the document; a belt change does', async () => {
    await makeTestStore({ save: { profile: { belt: 'white', tz: TOKYO } } });
    const clock = vi.fn(() => at(TOKYO, 2026, 10, 18, 12));
    const stop = sync({ prefersDark: false, clock, reducedMotion: true });
    // one clock read per apply (and one for the timer): the count is the number of applies
    const applies = clock.mock.calls.length;
    store.patch('profile', (p) => ({ ...p, xp: p.xp + 10, level: p.level + 1 }));
    store.patch('profile', (p) => ({ ...p, name: 'Tester' }));
    expect(clock.mock.calls.length).toBe(applies);
    store.patch('profile', (p) => ({ ...p, belt: 'yellow' }));
    expect(clock.mock.calls.length).toBe(applies + 1);
    expect(prop('--belt-color')).toBe('var(--belt-yellow)');
    stop();
  });

  it('startThemeSync: the saved theme arriving at boot (store not ready → ready) is applied directly, never as a dusk', async () => {
    const trace: string[] = [];
    const { svt } = fakeVt(trace);
    // the shell starts the sync before the save is loaded (App mounts first)
    sync({ prefersDark: false, now: at(TOKYO, 2026, 10, 18, 12), reducedMotion: false });
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    await makeTestStore({ save: { settings: { theme: 'dark', feel: 'arcade' } } });
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(html().getAttribute('data-feel')).toBe('arcade');
    expect(svt).not.toHaveBeenCalled();
    // after boot, a real change rides the transition
    store.patch('settings', (s) => ({ ...s, theme: 'light' }));
    expect(svt).toHaveBeenCalledTimes(1);
  });

  it('startThemeSync: a belt change re-applies --belt-color without a transition', async () => {
    await makeTestStore({ save: { profile: { belt: 'white', tz: TOKYO } } });
    const trace: string[] = [];
    const { svt } = fakeVt(trace);
    const stop = sync({ prefersDark: false, now: at(TOKYO, 2026, 10, 18, 12), reducedMotion: false });
    expect(prop('--belt-color')).toBe('var(--belt-white)');
    store.patch('profile', (p) => ({ ...p, belt: 'yellow' }));
    expect(prop('--belt-color')).toBe('var(--belt-yellow)');
    expect(svt).not.toHaveBeenCalled();
    stop();
  });
});

describe('first-paint theme colour', () => {
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
  const lightBg = (): string => {
    const tokens = read('src/styles/tokens.css');
    const root = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')));
    return /--bg:\s*(#[0-9a-fA-F]{6})/.exec(root)![1]!.toUpperCase();
  };

  it('index.html seeds <meta theme-color> with the light --bg token (the :root default), so the browser bar matches the first paint until the store is ready', () => {
    const m = /<meta name="theme-color" content="([^"]+)"/.exec(read('index.html'));
    expect(m, 'theme-color meta').not.toBeNull();
    expect(m![1]!.toUpperCase()).toBe(lightBg());
    expect(lightBg()).toBe('#F4EDE0');
  });

  it('the web manifest uses the same light colour for theme_color and background_color (consistent PWA splash)', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { theme_color: string; background_color: string };
    expect(manifest.theme_color.toUpperCase()).toBe(lightBg());
    expect(manifest.background_color.toUpperCase()).toBe(lightBg());
  });
});

describe('startThemeSync', () => {
  it('follows store.settings and stops after dispose', async () => {
    await makeTestStore({ save: { settings: { feel: 'zen', theme: 'light' } } });
    const stop = sync({ prefersDark: true });
    expect(html().getAttribute('data-feel')).toBe('zen');
    expect(html().getAttribute('data-theme')).toBe('light');
    store.patch('settings', (s) => ({ ...s, feel: 'arcade', theme: 'auto' }));
    expect(html().getAttribute('data-feel')).toBe('arcade');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    stop();
    store.patch('settings', (s) => ({ ...s, feel: 'dojo' }));
    expect(html().getAttribute('data-feel')).toBe('arcade');
  });
});
