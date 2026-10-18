/**
 * RoadNav.tsx — 53 markers and .sign rows, the one-path spine, keyboard walking, the kit vignettes, the kana rule,
 * and the Tōchaku arrival (design 09 §7 D): spine hiku, seal osu / kawaku, lantern tomosu, data-arrived, the one
 * stationSeen patch; reduced motion: everything complete, no .ink-* class, the gold hairline attribute.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATIONS } from '../content/types';
import { installServices, nullAudio, resetServices } from '../shared/audio';
import { resetStoreForTests, store } from '../store';
import { makeTestStore } from '../store/testing';
import { ARRIVAL_BEATS, RoadNav, arrivalFor, kanaReading, kanjiNumeral, loadRoadArt, ordinalJa, romajiAllowed, rubyMarkup, signRubyMode, stationState } from './RoadNav';

let root: HTMLDivElement;
// the art tier is a lazy chunk (~0.6 s on its first load here): resolve it once so every mount renders its pictures at once
beforeAll(async () => {
  expect(await loadRoadArt()).not.toBeNull();
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  document.documentElement.removeAttribute('data-color-scheme');
  vi.restoreAllMocks();
});

const settle = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

type Props = Parameters<typeof RoadNav>[0];
function mount(p: Partial<Props> = {}): ReturnType<typeof vi.fn> {
  const onPick = vi.fn();
  act(() => render(<RoadNav current={p.current ?? 4} cleared={p.cleared ?? [1, 2, 3]} assisted={p.assisted ?? []} perfect={p.perfect} stationSeen={p.stationSeen} tempo={p.tempo} onPick={onPick} />, root));
  return onPick;
}
/** Mount with the art landed (the lazy barrel resolved) and the beats run (tempo 0). */
async function mountSettled(p: Partial<Props> = {}): Promise<ReturnType<typeof vi.fn>> {
  const onPick = mount({ tempo: 0, ...p });
  await settle();
  return onPick;
}

const stations = (): HTMLAnchorElement[] => Array.from(root.querySelectorAll<HTMLAnchorElement>('a.tokaido__station'));
const row = (n: number): HTMLElement => stations()[n - 1]!.parentElement as HTMLElement;
const nodes = (el: Element): number => el.querySelectorAll('*').length + 1;

describe('<RoadNav>', () => {
  it('renders 53 station links as .sign rows with names, ordinals, readings and the English state word; the ends are nodes, not stations', async () => {
    await makeTestStore({ save: { profile: { belt: 'yellow' } } });
    await mountSettled();
    const links = stations();
    expect(links).toHaveLength(53);
    expect(links[0]?.getAttribute('href')).toBe('#/station/1');
    expect(links[52]?.getAttribute('href')).toBe('#/station/53');
    expect(links[0]?.querySelector('.sign__ja')?.textContent).toBe('品川');
    expect(links[0]?.querySelector('.sign__number')?.textContent).toBe('1');
    expect(links[0]?.querySelector('.sign__ordinal')?.textContent).toBe('第一宿');
    expect(links[0]?.querySelector('.sign__reading')?.textContent).toBe('Shinagawa');
    expect(links[0]?.querySelector('.sign__en')?.textContent).toBe('cleared');
    expect(links[3]?.querySelector('.sign__en')?.textContent).toBe('you are here');
    expect(links[52]?.querySelector('.sign__ja')?.textContent).toBe('大津');
    expect(links[52]?.querySelector('.sign__ordinal')?.textContent).toBe('第五十三宿');
    expect(links[52]?.querySelector('.sign__en')?.textContent).toBe('ahead');
    expect(root.textContent?.toLowerCase()).not.toContain('locked');
    expect(root.querySelector('.tokaido__node--start')).not.toBeNull();
    expect(root.querySelector('.tokaido__node--arrival')).not.toBeNull();
    // the sign contract: number first, then ordinal, JA, reading, English (motion.css)
    expect(Array.from(links[0]!.querySelector('.sign')!.children).map((c) => c.className)).toEqual(['sign__number', 'sign__ordinal', 'sign__ja', 'sign__reading', 'sign__en']);
  });

  it('cleared = seal, assisted = grey corner, perfect = gold frame, current = the chōchin on a .seal (the station-seal hero), ahead = dashed number', async () => {
    await makeTestStore();
    await mountSettled({ current: 5, cleared: [1, 2, 3, 4], assisted: [3], perfect: [2], stationSeen: 5 });
    const links = stations();
    expect(links[0]?.dataset.state).toBe('cleared');
    expect(links[0]?.querySelector('.seal')).not.toBeNull();
    expect(links[0]?.querySelector('.seal--locked')).toBeNull();
    expect(links[1]?.dataset.state).toBe('perfect');
    expect(links[1]?.querySelector('.seal--perfect')).not.toBeNull();
    expect(links[2]?.dataset.state).toBe('assisted');
    expect(links[2]?.querySelector('.tokaido__seal--assisted')).not.toBeNull();
    expect(links[4]?.dataset.state).toBe('current');
    const lantern = links[4]?.querySelector('.tokaido__lantern');
    expect(lantern).not.toBeNull();
    expect(lantern?.classList.contains('seal')).toBe(true); // transitions.ts heroFor: `${row} .seal`
    expect(lantern?.hasAttribute('data-lit')).toBe(true);
    expect(lantern?.querySelector('svg')?.children.length).toBeGreaterThan(0); // the kit's chōchin landed
    expect(links[4]?.getAttribute('aria-current')).toBe('step');
    expect(links[5]?.dataset.state).toBe('locked');
    expect(links[5]?.querySelector('.seal--locked')).not.toBeNull();
    expect(root.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('paints belt bands, the one-path spine (pathLength = stroke-dasharray = 1) and says where you are', async () => {
    await makeTestStore();
    await mountSettled({ current: 10, cleared: [1, 2, 3, 4, 5, 6, 7, 8, 9], stationSeen: 10 });
    expect(root.querySelectorAll('.tokaido__band')).toHaveLength(8);
    expect(root.querySelector('.tokaido__row[data-belt="orange"]')).not.toBeNull();
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('Station 10');
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('箱根');
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('9 of 53');
    // the spine: ONE walked path over ONE road-ahead path, no per-row bars
    const spine = root.querySelector('.tokaido__spine');
    expect(spine).not.toBeNull();
    expect(spine?.querySelectorAll('path').length).toBe(2);
    const walked = spine?.querySelector('.tokaido__spine-walked');
    expect(walked?.getAttribute('pathLength')).toBe('1');
    expect(walked?.getAttribute('stroke-dasharray')).toBe(walked?.getAttribute('pathLength'));
    expect(walked?.getAttribute('d')).toMatch(/^M0\.5 [\d.]+ V[\d.]+$/);
    expect(spine?.querySelector('.tokaido__spine-ahead')?.getAttribute('d')).toBe('M0.5 0 V1');
    // not arriving: nothing draws
    expect(walked?.classList.contains('ink-hiku')).toBe(false);
    expect(root.querySelectorAll('[class*="ink-"]').length).toBe(0);
  });

  it('every row stays within 40 nodes, pictures included', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' } } });
    await mountSettled({ current: 20, cleared: Array.from({ length: 19 }, (_, i) => i + 1), stationSeen: 20 });
    for (const li of Array.from(root.querySelectorAll('.tokaido__row'))) expect(nodes(li), li.querySelector('a')?.getAttribute('data-station') ?? '').toBeLessThanOrEqual(40);
    // every row has its kit vignette on the band; ahead rows are an ink wash in --hai
    for (const a of stations()) expect(a.querySelector('.tokaido__art')?.children.length).toBeGreaterThan(0);
    const ahead = stations()[30]!.querySelector('.tokaido__art')!;
    for (const m of ahead.innerHTML.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) expect(['var(--hai)', 'none']).toContain(m[1]);
  });

  it('the reading follows the kana rule everywhere on the road: romaji below Green, kana ruby from Green on — rows, the where-line and both end nodes (design 09 §3.3)', async () => {
    await makeTestStore({ save: { profile: { belt: 'orange' } } });
    await mountSettled({ current: 10, cleared: [], stationSeen: 10 });
    expect(stations()[9]?.querySelector('.sign__reading')?.textContent).toBe('Hakone');
    expect(stations()[9]?.querySelector('.sign__ja ruby')).toBeNull();
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('箱根 Hakone');
    expect(root.querySelector('.tokaido__node--start')?.textContent).toContain('Nihonbashi');
    expect(root.querySelector('.tokaido__node--start')?.textContent).toContain('the start');
    expect(root.querySelector('.tokaido__node--arrival')?.textContent).toContain('Sanjō Ōhashi');
    expect(root.querySelector('.tokaido__node--arrival ruby')).toBeNull();
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { profile: { belt: 'green' }, settings: { furigana: 'always' } } });
    await mountSettled({ current: 16, cleared: [], stationSeen: 16 });
    expect(stations()[15]?.querySelector('.sign__reading')).toBeNull();
    expect(stations()[15]?.querySelector('.sign__ja rt')?.textContent).toBe('ゆい');
    expect(stations()[15]?.querySelector('.sign__ja')?.textContent).toContain('由比');
    // the where-line and the ends: kana, no romaji anywhere
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('由比 ゆい');
    expect(root.querySelector('.tokaido__where')?.textContent).not.toContain('Yui');
    expect(root.querySelector('.tokaido__node--start rt')?.textContent).toBe('にほんばし');
    expect(root.querySelector('.tokaido__node--arrival rt')?.textContent).toBe('さんじょうおおはし');
    expect(root.querySelector('.tokaido__node--arrival')?.textContent).toContain('the Shodan Shinsa');
    expect(root.querySelector('.tokaido__road')?.textContent).not.toMatch(/Nihonbashi|Ōhashi/);
    expect(root.textContent).not.toMatch(/[ァ-ヺー]{2,}/); // hiragana readings, never katakana loanword spellings
    // `tap` furigana: signage shows the reading outright — no tap-to-reveal ruby inside a link, no extra tab stop
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { profile: { belt: 'green' }, settings: { furigana: 'tap' } } });
    await mountSettled({ current: 16, cleared: [], stationSeen: 16 });
    expect(stations()[15]?.querySelector('.sign__ja rt')?.textContent).toBe('ゆい');
    expect(root.querySelectorAll('a.tokaido__station [role="button"], a.tokaido__station [tabindex], .ruby__seg--fog').length).toBe(0);
    expect(stations().filter((a) => a.tabIndex === 0)).toHaveLength(1);
  });

  it('station 0 (Nihonbashi) is summarised as the start and focuses station 1; nothing arrives', async () => {
    await makeTestStore();
    await mountSettled({ current: 0, cleared: [] });
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('Nihonbashi');
    expect(stations()[0]?.tabIndex).toBe(0);
    expect(root.querySelector('[aria-current="step"]')).toBeNull();
    expect(root.querySelector('.tokaido__jump')?.textContent).toBe('Go to your station');
    expect(root.querySelector('[data-arrived]')).toBeNull();
    expect(store.progress.value.stationSeen).toBeUndefined();
  });

  it('is keyboard navigable: one tab stop, arrows walk, Home/End jump, Enter picks', () => {
    const onPick = mount({ current: 4, stationSeen: 4 });
    const links = stations();
    const tabbable = links.filter((a) => a.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.dataset.station).toBe('4');
    const key = (el: HTMLElement, k: string): void => {
      act(() => {
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      });
    };
    key(links[3] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(links[4]);
    expect(links[4]?.tabIndex).toBe(0);
    expect(links[3]?.tabIndex).toBe(-1);
    key(links[4] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(links[3]);
    key(links[3] as HTMLElement, 'End');
    expect(document.activeElement).toBe(links[52]);
    key(links[52] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(links[52]);
    key(links[52] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(links[0]);
    act(() => {
      (links[0] as HTMLElement).click();
    });
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it('mount never scrolls the window; "Go to your station" scrolls the current station into view and focuses it', () => {
    const scroll = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = scroll;
    try {
      mount({ current: 40, cleared: Array.from({ length: 39 }, (_, i) => i + 1), stationSeen: 40 });
      expect(scroll).not.toHaveBeenCalled();
      act(() => {
        (root.querySelector('.tokaido__jump') as HTMLButtonElement).click();
      });
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(stations()[39]);
      expect(stations()[39]?.tabIndex).toBe(0);
    } finally {
      if (original === undefined) delete proto.scrollIntoView;
      else proto.scrollIntoView = original;
    }
  });

  it('every station has an accessible label naming its belt and state', () => {
    mount({ current: 16, cleared: Array.from({ length: 15 }, (_, i) => i + 1), stationSeen: 16 });
    for (const a of stations()) {
      const label = a.getAttribute('aria-label') ?? '';
      expect(label).toMatch(/Station \d+:/);
      expect(label).toMatch(/belt/);
    }
    expect(stations()[15]?.getAttribute('aria-label')).toContain('Green belt');
    expect(stations()[15]?.getAttribute('aria-label')).toContain('you are here');
  });
});

describe('<RoadNav> Tōchaku — the arrival (design 09 §7 D)', () => {
  it('plays once when current > stationSeen: the spine hiku-draws, the passed seal presses and dries, the new lantern tomosu, the row settles (data-arrived), then stationSeen is patched exactly once', async () => {
    await makeTestStore({ save: { progress: { station: 5, stationsCleared: [1, 2, 3, 4], stationSeen: 4 } } });
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    const patch = vi.spyOn(store, 'patch');
    // beat 0: the spine draws, nothing else has happened
    mount({ current: 5, cleared: [1, 2, 3, 4], stationSeen: 4, tempo: 1000 });
    const walked = root.querySelector('.tokaido__spine-walked')!;
    expect(walked.classList.contains('ink-hiku')).toBe(true);
    expect(walked.getAttribute('data-axis')).toBe('stroke');
    expect(walked.getAttribute('pathLength')).toBe('1');
    expect(root.querySelector('.tokaido')?.hasAttribute('data-arriving')).toBe(true);
    expect(row(5).hasAttribute('data-arrived')).toBe(false);
    expect(row(5).querySelector('.tokaido__lantern')?.hasAttribute('data-lit')).toBe(false);
    expect(root.querySelector('#ink-bleed-8')).toBeNull();
    expect(sfx).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    // leaving the Road mid-ceremony (unmount) still counts the moment as seen, exactly once
    render(null, root);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.progress.value.stationSeen).toBe(5);
    // the beats run (tempo 0): 900 seal, 1,100 lantern, 1,500 band + the patch
    patch.mockClear();
    await makeTestStore({ save: { progress: { station: 5, stationsCleared: [1, 2, 3, 4], stationSeen: 4 } } });
    installServices({ audio: { ...nullAudio, sfx } });
    const spy = vi.spyOn(store, 'patch');
    await mountSettled({ current: 5, cleared: [1, 2, 3, 4], stationSeen: 4 });
    expect(sfx.mock.calls.map((c) => c[0])).toEqual(['stamp', 'submit']); // stamp at 900 (the recipe carries the haptic), submit at 1,100 (not the first arrival)
    expect(row(5).hasAttribute('data-arrived')).toBe(true);
    expect(row(5).querySelector('.tokaido__lantern')?.hasAttribute('data-lit')).toBe(true);
    expect(row(5).querySelector('.tokaido__lantern')?.classList.contains('ink-tomosu')).toBe(true);
    // the moment is over: the spine no longer draws, the seal is dry and plain, the wet def is gone (no live filter)
    expect(root.querySelector('.tokaido__spine-walked')?.classList.contains('ink-hiku')).toBe(false);
    expect(row(4).querySelector('.seal')?.classList.contains('ink-wet')).toBe(false);
    expect(root.querySelector('#ink-bleed-8')).toBeNull();
    expect(root.querySelector('.tokaido')?.hasAttribute('data-arriving')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('progress');
    expect(store.progress.value.stationSeen).toBe(5);
    // a second render with the patched value patches nothing more
    act(() => render(<RoadNav current={5} cleared={[1, 2, 3, 4]} assisted={[]} stationSeen={5} tempo={0} onPick={() => undefined} />, root));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledTimes(2);
  });

  it('the first arrival ever plays the scroll fanfare; Zen is silent; no arrival when stationSeen has caught up', async () => {
    await makeTestStore({ save: { progress: { station: 1, stationsCleared: [] } } });
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    await mountSettled({ current: 1, cleared: [], stationSeen: undefined });
    expect(sfx.mock.calls.map((c) => c[0])).toEqual(['scroll']); // no seal to press at Station 1
    expect(store.progress.value.stationSeen).toBe(1);
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { settings: { feel: 'zen' }, progress: { station: 6, stationsCleared: [1, 2, 3, 4, 5], stationSeen: 5 } } });
    sfx.mockClear();
    installServices({ audio: { ...nullAudio, sfx } });
    await mountSettled({ current: 6, cleared: [1, 2, 3, 4, 5], stationSeen: 5 });
    expect(sfx).not.toHaveBeenCalled();
    expect(row(6).hasAttribute('data-arrived')).toBe(true);
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 6, stationsCleared: [1, 2, 3, 4, 5], stationSeen: 6 } } });
    const spy = vi.spyOn(store, 'patch');
    await mountSettled({ current: 6, cleared: [1, 2, 3, 4, 5], stationSeen: 6 });
    expect(root.querySelector('[data-arrived]')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(arrivalFor(6, 6)).toEqual({ arriving: false, first: false });
    expect(arrivalFor(6, 5)).toEqual({ arriving: true, first: false });
    expect(arrivalFor(1, undefined)).toEqual({ arriving: true, first: true });
    expect(arrivalFor(0, undefined).arriving).toBe(false);
  });

  it('reduced motion: spine, seal and lantern are shown complete, no .ink-* class anywhere, the row carries the gold hairline attribute, the patch is immediate', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true }, progress: { station: 5, stationsCleared: [1, 2, 3, 4], stationSeen: 4 } } });
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    const spy = vi.spyOn(store, 'patch');
    mount({ current: 5, cleared: [1, 2, 3, 4], stationSeen: 4, tempo: 1000 });
    await settle();
    expect(root.querySelectorAll('[class*="ink-"]').length).toBe(0);
    expect(root.querySelector('.tokaido__spine-walked')?.hasAttribute('data-axis')).toBe(false);
    expect(row(5).hasAttribute('data-arrived')).toBe(true);
    expect(row(5).querySelector('.tokaido__lantern')?.hasAttribute('data-lit')).toBe(true);
    expect(root.querySelector('#ink-bleed-8')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.progress.value.stationSeen).toBe(5);
    expect(sfx.mock.calls.map((c) => c[0])).toEqual(['stamp', 'submit']);
  });

  it('at ≥ 600 px the current row carries its 160 × 160 band (data-band) from mount — the box is reserved, nothing shifts — and the picture is revealed (data-shown) once the moment is over', async () => {
    // wide, and only wide: the reduced-motion query stays false
    const mq = (q: string) => ({ matches: q.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', vi.fn(mq));
    try {
      await makeTestStore({ save: { progress: { station: 5, stationsCleared: [1, 2, 3, 4], stationSeen: 5 } } });
      await mountSettled({ current: 5, cleared: [1, 2, 3, 4], stationSeen: 5 });
      expect(row(5).hasAttribute('data-band')).toBe(true);
      expect(row(5).querySelector('.tokaido__art')?.getAttribute('viewBox')).toBe('0 0 160 160');
      expect(row(5).querySelector('.tokaido__art')?.hasAttribute('data-shown')).toBe(true); // not arriving: shown at once
      expect(row(4).hasAttribute('data-band')).toBe(false);
      expect(row(4).querySelector('.tokaido__art')?.getAttribute('viewBox')).toBe('0 0 48 40');
      expect(nodes(row(5))).toBeLessThanOrEqual(40);
      // arriving: the box is there at beat 0, the picture waits for beat 3
      render(null, root);
      resetStoreForTests();
      await makeTestStore({ save: { progress: { station: 5, stationsCleared: [1, 2, 3, 4], stationSeen: 4 } } });
      mount({ current: 5, cleared: [1, 2, 3, 4], stationSeen: 4, tempo: 1000 });
      expect(row(5).hasAttribute('data-band')).toBe(true);
      expect(row(5).querySelector('.tokaido__art')?.getAttribute('viewBox')).toBe('0 0 160 160');
      expect(row(5).querySelector('.tokaido__art')?.hasAttribute('data-shown')).toBe(false);
      render(null, root);
      resetStoreForTests();
      await makeTestStore({ save: { progress: { station: 5, stationsCleared: [1, 2, 3, 4], stationSeen: 4 } } });
      await mountSettled({ current: 5, cleared: [1, 2, 3, 4], stationSeen: 4 });
      expect(row(5).querySelector('.tokaido__art')?.hasAttribute('data-shown')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Night lights the lamps (data-color-scheme); the art barrel resolves once and is shared', async () => {
    document.documentElement.setAttribute('data-color-scheme', 'dark');
    await makeTestStore();
    await mountSettled({ current: 36, cleared: Array.from({ length: 35 }, (_, i) => i + 1), stationSeen: 36 });
    const art = await loadRoadArt();
    expect(art).not.toBeNull();
    expect(typeof art?.headpiece).toBe('function');
    expect(stations()[35]?.querySelector('.tokaido__art')?.innerHTML).toContain('var(--kin)');
  });
});

describe('motion.css sign rules (design 09 §12.1 d65)', () => {
  it('the ruby inside a sign keeps the brush face: .ruby sets --font-ja, so .sign__ja .ruby inherits', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/motion.css'), 'utf8');
    expect(css).toMatch(/\.sign__ja \.ruby \{ font-family: inherit; \}/);
  });
});

describe('RoadNav.css (design 09 §6.7 rule 6, §12.1 d45)', () => {
  it('every row but the current one skips layout out of view, sized to the rendered row (125 px: the romaji sign; ≈ 119 px once the reading is ruby, so the taller stands); the current row is exempt below 600 px too, where it has no band', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/session/RoadNav.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.tokaido__row:not\(\[data-band\]\):not\(\[data-state="current"\]\)\s*\{\s*content-visibility:\s*auto;\s*contain-intrinsic-size:\s*auto 125px;\s*\}/);
  });
});

describe('stationState / signage helpers', () => {
  it('derives the marker state from progress', () => {
    const p = { current: 5, cleared: [1, 2, 3, 4], assisted: [4], perfect: [1] };
    expect(stationState(1, p)).toBe('perfect');
    expect(stationState(2, p)).toBe('cleared');
    expect(stationState(4, p)).toBe('assisted');
    expect(stationState(5, p)).toBe('current');
    expect(stationState(6, p)).toBe('locked');
  });

  it('第N宿 for every station; romaji only below Green', () => {
    expect(kanjiNumeral(4)).toBe('四');
    expect(kanjiNumeral(10)).toBe('十');
    expect(kanjiNumeral(13)).toBe('十三');
    expect(kanjiNumeral(53)).toBe('五十三');
    expect(ordinalJa(53)).toBe('第五十三宿');
    expect(ordinalJa(0)).toBe('');
    for (const st of STATIONS) expect(ordinalJa(st.number)).toMatch(/^第[一二三四五六七八九十]+宿$/);
    expect(romajiAllowed('white')).toBe(true);
    expect(romajiAllowed('orange')).toBe(true);
    expect(romajiAllowed('green')).toBe(false);
    expect(romajiAllowed('black')).toBe(false);
    expect(kanaReading('Hodogaya')).toBe('ほどがや');
    expect(kanaReading('Ōtsu')).toBe('おおつ');
    expect(kanaReading('Numazu')).toBe('ぬまづ');
    expect(rubyMarkup('由比', 'Yui')).toBe('{由比|ゆい}');
    expect(signRubyMode('tap')).toBe('always');
    expect(signRubyMode('off')).toBe('off');
    expect(ARRIVAL_BEATS).toEqual({ seal: 900, lantern: 1100, band: 1500 });
  });
});
