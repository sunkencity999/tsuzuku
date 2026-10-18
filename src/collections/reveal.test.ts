import { civilToDay } from '../shared/time';
import { MemoryStorage } from '../store/testing';
import { MAX_LIVE_REVEALS, acquireReveal, eraGloss, liveReveals, markOpened, markSeen, newSince, resetOpenedForTests } from './reveal';

// Node ≥ 22 defines a flag-gated `localStorage` global that jsdom cannot override: stand a real Storage in for it
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});
afterEach(() => {
  resetOpenedForTests();
  vi.unstubAllGlobals();
});

describe('newSince / markOpened (design 09 §7 E "earned since last open")', () => {
  it('with no record, only today\'s ink is new; dated nothing is never new', () => {
    const fresh = newSince('mon', [{ id: 'a', at: 100 }, { id: 'b', at: 99 }, { id: 'c' }], 100);
    expect(Array.from(fresh)).toEqual(['a']);
  });

  it('after an open, only what the record lacks is new — whatever its day', () => {
    markOpened('mon', ['a']);
    const fresh = newSince('mon', [{ id: 'a', at: 100 }, { id: 'b', at: 1 }, { id: 'c' }], 100);
    expect(Array.from(fresh).sort()).toEqual(['b', 'c']);
    markOpened('mon', ['a', 'b', 'c']);
    expect(newSince('mon', [{ id: 'a', at: 100 }, { id: 'b', at: 1 }], 100).size).toBe(0);
  });

  it('the record lives in localStorage per shelf (it survives a relaunch), never in the save', () => {
    markOpened('goshuin', ['7']);
    expect(JSON.parse(localStorage.getItem('tsuzuku:opened:goshuin') ?? '[]')).toEqual(['7']);
    expect(localStorage.getItem('tsuzuku:opened:mon')).toBeNull();
    expect(sessionStorage.getItem('tsuzuku:opened:goshuin')).toBeNull();
    resetOpenedForTests();
    localStorage.setItem('tsuzuku:opened:mon', JSON.stringify(['a', 3]));
    expect(Array.from(newSince('mon', [{ id: 'a', at: 1 }, { id: 'b', at: 1 }], 100))).toEqual(['b']);
    localStorage.setItem('tsuzuku:opened:library', 'not json');
    expect(newSince('library', [{ id: 'x' }], 100).size).toBe(0);
  });

  it('markSeen adds one id to the record once its reveal has played; a record that never existed starts from that id', () => {
    markOpened('mon', ['a']);
    markSeen('mon', 'b');
    expect(JSON.parse(localStorage.getItem('tsuzuku:opened:mon') ?? '[]').sort()).toEqual(['a', 'b']);
    expect(newSince('mon', [{ id: 'a', at: 1 }, { id: 'b', at: 1 }, { id: 'c', at: 1 }], 100).has('c')).toBe(true);
    expect(newSince('mon', [{ id: 'b', at: 1 }], 100).size).toBe(0);
    markSeen('goshuin', '4');
    expect(Array.from(newSince('goshuin', [{ id: '4', at: 1 }, { id: '5', at: 1 }], 100))).toEqual(['5']);
  });
});

describe('acquireReveal (≤ 2 live wet layers, §6.7 rule 2)', () => {
  it('runs two at once, queues the third until one is released, and lets a waiter withdraw', () => {
    const log: string[] = [];
    const a = acquireReveal(() => log.push('a'));
    const b = acquireReveal(() => log.push('b'));
    const c = acquireReveal(() => log.push('c'));
    const d = acquireReveal(() => log.push('d'));
    expect(MAX_LIVE_REVEALS).toBe(2);
    expect(log).toEqual(['a', 'b']);
    expect(liveReveals()).toBe(2);
    c(); // withdraws before it ran
    a();
    expect(log).toEqual(['a', 'b', 'd']);
    expect(liveReveals()).toBe(2);
    a(); // a second release is a no-op
    expect(liveReveals()).toBe(2);
    b();
    d();
    expect(liveReveals()).toBe(0);
  });
});

describe('eraGloss', () => {
  it('reads the era date in Latin: era, year, month, day', () => {
    expect(eraGloss(civilToDay({ year: 2026, month: 10, day: 18 }))).toBe('Reiwa 8 · Oct 18');
    expect(eraGloss(civilToDay({ year: 2019, month: 5, day: 1 }))).toBe('Reiwa 1 · May 1');
    expect(eraGloss(civilToDay({ year: 1995, month: 3, day: 3 }))).toBe('Heisei 7 · Mar 3');
    expect(eraGloss(civilToDay({ year: 1950, month: 12, day: 31 }))).toBe('Shōwa 25 · Dec 31');
    expect(eraGloss(civilToDay({ year: 1920, month: 1, day: 1 }))).toBe('1920 · Jan 1');
  });
});
