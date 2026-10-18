import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { CEREMONY_TAIKO_AT_MS, SFX_DURATION_MS } from '../../audio/sfx';
import { BELT_IDS } from '../../content/types';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { makeTestStore } from '../../store/testing';
import { BELT_PHASES, BELT_PHASE_AT, BELT_TAIKO_PHASES, BELT_WALLPAPER, BeltCeremony, beltPhaseIndex, inkWashUrl, kanjiSvg, knotSvg, lanternsSvg, nextStop, sealSvg, splashSvg } from './BeltCeremony';
import { S } from './strings';
import { EXIT_FALLBACK_MS, setLazyArtForTests, type MonCrestProps } from './support';

let root: HTMLDivElement;
let sfx: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
  sfx = vi.fn();
  installServices({ audio: { ...nullAudio, sfx } });
  setLazyArtForTests({ MonCrest: null, wallpapers: null });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  setLazyArtForTests(null);
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
const section = (): Element => root.querySelector('.belt-ceremony')!;
const phaseName = (): string | null => section().getAttribute('data-phase-name');
const advanceTo = (phase: (typeof BELT_PHASES)[number]): void => {
  const target = BELT_PHASE_AT[beltPhaseIndex(phase)]!;
  const now = Number(section().getAttribute('data-elapsed') ?? '0');
  act(() => {
    vi.advanceTimersByTime(target - now);
  });
  section().setAttribute('data-elapsed', String(target));
};

describe('<BeltCeremony>', () => {
  it('runs the phases in order with the right art appearing at each one', () => {
    vi.useFakeTimers();
    act(() => render(<BeltCeremony belt="green" nameKana="ハナ" onDone={() => {}} reduced={false} />, root));
    expect(phaseName()).toBe('dim');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(0);
    expect(root.querySelector('.belt-kanji')).toBeNull();

    advanceTo('taiko1');
    expect(phaseName()).toBe('taiko1');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(1);
    advanceTo('taiko2');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(2);
    advanceTo('taiko3');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(3);

    advanceTo('kanji');
    expect(phaseName()).toBe('kanji');
    expect(root.querySelector('.belt-kanji svg text')?.textContent).toBe('中堅');
    expect(root.querySelector('.belt-kanji svg mask path')?.getAttribute('stroke-dashoffset')).not.toBeNull();

    advanceTo('knot');
    expect(phaseName()).toBe('knot');
    expect(section().classList.contains('is-knot')).toBe(true);
    const knot = root.querySelector('.belt-knot')!;
    expect(knot.innerHTML).toContain('#3E9B4F');
    expect(knot.querySelector('animate[attributeName="d"]')).not.toBeNull();

    advanceTo('seal');
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ハ');
    expect(sfx).toHaveBeenCalledTimes(1);
    // ≤ 2 live SVG filters on the whole ceremony (§6.7 rule 2, counted as def × users): the splashes are <img> data URLs, the seal's bleed is the one
    expect(root.querySelectorAll('filter').length).toBeLessThanOrEqual(2);
    expect(root.querySelectorAll('[filter]').length).toBeLessThanOrEqual(2);
    expect(root.querySelectorAll('img.belt-splash')).toHaveLength(3);

    advanceTo('thumb');
    expect(phaseName()).toBe('thumb');
    expect(root.querySelector('.belt-thumb')?.getAttribute('data-preview')).toBe('placeholder');
    expect(root.querySelector('.belt-thumb__caption')?.textContent).toBe('富士の線');
    expect(sfx).toHaveBeenLastCalledWith('wallpaper');
    // the kakejiku thumbnail is one <img> data URL: the placeholder's mist blur (one def, four users) is rasterised, not live
    const thumbImg = root.querySelector('img.belt-thumb__art')!;
    expect(thumbImg.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(thumbImg.getAttribute('src')!)).toContain('<feGaussianBlur');
    expect(thumbImg.classList.contains('ink-hiku')).toBe(true);
    expect(thumbImg.getAttribute('data-axis')).toBe('y');
    expect(root.querySelectorAll('filter').length).toBeLessThanOrEqual(2);
    expect(root.querySelectorAll('[filter]').length).toBeLessThanOrEqual(2);

    advanceTo('lantern');
    expect(phaseName()).toBe('lantern');
    const lanterns = root.querySelector('.belt-lanterns')!;
    expect(lanterns.querySelectorAll('.belt-lantern--next')).toHaveLength(1);
    expect(lanterns.innerHTML).toContain('日坂');

    advanceTo('vignette');
    expect(phaseName()).toBe('vignette');
    expect(root.querySelector('.belt-vignette__rank')?.textContent).toBe('中堅');
    expect(root.querySelector('.belt-vignette__romaji')?.textContent).toBe('Chūken');
    expect(root.querySelector('.belt-vignette__sensei')?.textContent).toBe(S.beltSensei);
    expect(root.querySelector('.belt-vignette__text')?.textContent).toBe(S.beltVignettes.green);
    expect(root.querySelector('.belt-vignette__next')?.textContent).toContain('Nissaka');
    expect(root.querySelector('.belt-vignette__continue')).not.toBeNull();
    expect(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]).toBeLessThanOrEqual(12_000);
    // the vignette stays within the filter budget too (the crest here is the fallback: no filter)
    expect(root.querySelectorAll('[filter]').length).toBeLessThanOrEqual(2);
  });

  it('from Green kana the vignette drops the romaji — rank and next lantern are kana <ruby> (design 09 §3.3)', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' }, settings: { furigana: 'tap' } } });
    act(() => render(<BeltCeremony belt="green" nameKana="ハナ" onDone={() => {}} reduced />, root));
    expect(root.querySelector('.belt-vignette__romaji')).toBeNull();
    const rank = root.querySelector('.belt-vignette__rank')!;
    expect(rank.textContent).not.toContain('Chūken');
    expect(rank.querySelector('ruby rb')?.textContent).toBe('中堅');
    expect(rank.querySelector('ruby rt')?.textContent).toBe('ちゅうけん');
    const next = root.querySelector('.belt-vignette__next')!;
    expect(next.textContent).not.toContain('Nissaka');
    expect(next.querySelector('ruby rb')?.textContent).toBe('日坂');
    expect(next.querySelector('ruby rt')?.textContent).toBe('にっさか');
    // `tap` reads as `always` on signage: nothing to reveal, no fog
    expect(root.querySelector('.ruby__rt--fog')).toBeNull();
    expect(root.textContent).not.toMatch(/Chūken|Nissaka/);
  });

  it('when the host owns the exit (hostExit) Continue hands over at once instead of drying the card first', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<BeltCeremony belt="orange" nameKana="ハナ" onDone={onDone} reduced={false} hostExit />, root));
    act(() => {
      vi.advanceTimersByTime(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]!);
    });
    act(() => {
      (root.querySelector('.belt-vignette__continue') as HTMLButtonElement).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(section().hasAttribute('data-leaving')).toBe(false);
  });

  it('plays the ceremony sfx on mount and the wind chime only when a wallpaper rises', () => {
    vi.useFakeTimers();
    act(() => render(<BeltCeremony belt="yellow" nameKana="ハナ" onDone={() => {}} reduced={false} />, root));
    expect(sfx).toHaveBeenCalledWith('ceremony');
    act(() => {
      vi.advanceTimersByTime(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]! + 10);
    });
    expect(root.querySelector('.belt-thumb')).toBeNull();
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(phaseName()).toBe('vignette');
  });

  it('Continue dries the card out first: data-leaving on the root, onDone on its animationend', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<BeltCeremony belt="orange" nameKana="ハナ" onDone={onDone} reduced={false} />, root));
    expect(root.querySelector('.belt-vignette__continue')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]!);
    });
    act(() => {
      (root.querySelector('.belt-vignette__continue') as HTMLButtonElement).click();
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(section().hasAttribute('data-leaving')).toBe(true);
    expect(section().classList.contains('ink-nijimi')).toBe(true);
    act(() => {
      section().dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(EXIT_FALLBACK_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('…or on the ≤ 200 ms fallback timer when no animationend arrives; a child animation ending does not count', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<BeltCeremony belt="orange" nameKana="ハナ" onDone={onDone} reduced={false} />, root));
    act(() => {
      vi.advanceTimersByTime(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]!);
    });
    act(() => {
      (root.querySelector('.belt-vignette__continue') as HTMLButtonElement).click();
    });
    act(() => {
      root.querySelector('.belt-vignette')!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(EXIT_FALLBACK_MS).toBeLessThanOrEqual(200);
    act(() => {
      vi.advanceTimersByTime(EXIT_FALLBACK_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the knot carries the belt-chip hero: a static view-transition-name on the one element (§6.4)', () => {
    vi.useFakeTimers();
    act(() => render(<BeltCeremony belt="green" nameKana="ハナ" onDone={() => {}} reduced={false} />, root));
    advanceTo('knot');
    const knot = root.querySelector('.belt-knot')!;
    expect(knot.getAttribute('data-hero')).toBe('belt-chip');
    expect(root.querySelectorAll('[data-hero="belt-chip"]')).toHaveLength(1);
    const css = readFileSync(resolve(process.cwd(), 'src/art/ceremony/BeltCeremony.css'), 'utf8');
    expect(css).toMatch(/\.belt-knot \{[^}]*view-transition-name: belt-chip/);
    // the ink wash is one seeded data URL on the root, never a live filter
    expect(section().getAttribute('style')).toContain('--belt-wash');
    expect(inkWashUrl(3)).toBe(inkWashUrl(3));
    expect(inkWashUrl(3)).not.toBe(inkWashUrl(4));
    expect(inkWashUrl(3).startsWith('data:image/svg+xml')).toBe(true);
  });

  it('reduced motion renders the final frame at once: every phase, no SMIL morph, no dash writing, no ink verb, an immediate exit', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<BeltCeremony belt="brown" nameKana="ハナ" onDone={onDone} reduced />, root));
    expect(phaseName()).toBe('vignette');
    for (const ph of BELT_PHASES) expect(section().classList.contains(`is-${ph}`), ph).toBe(true);
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(3);
    expect(root.querySelector('[class*="ink-"]')).toBeNull();
    expect(root.querySelectorAll('filter').length).toBeLessThanOrEqual(2);
    act(() => {
      (root.querySelector('.belt-vignette__continue') as HTMLButtonElement).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(section().hasAttribute('data-leaving')).toBe(false);
    expect(root.querySelector('.belt-knot animate')).toBeNull();
    expect(root.querySelector('.belt-knot [stroke-dashoffset]')).toBeNull();
    expect(root.querySelector('.belt-kanji mask')).toBeNull();
    expect(root.querySelector('.belt-kanji svg text')?.textContent).toBe('師範');
    expect(root.querySelector('.belt-vignette__text')?.textContent).toBe(S.beltVignettes.brown);
    expect(sfx).toHaveBeenCalledWith('ceremony');
    expect(sfx).toHaveBeenCalledWith('wallpaper');
  });

  it('the name seal carries the learner (romaji → katakana; empty → 無名)', () => {
    act(() => render(<BeltCeremony belt="blue" nameKana="hana" onDone={() => {}} reduced />, root));
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ハ');
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ナ');
    act(() => render(<BeltCeremony belt="blue" nameKana="  " onDone={() => {}} reduced />, root));
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('無');
  });

  it('shows the belt badge crest in the vignette (real <MonCrest> when available)', async () => {
    const seen: MonCrestProps[] = [];
    const Fake = (p: MonCrestProps): JSX.Element => {
      seen.push(p);
      return <i class="fake-mon" />;
    };
    setLazyArtForTests({ MonCrest: Fake, wallpapers: null });
    act(() => render(<BeltCeremony belt="purple" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(root.querySelector('.belt-vignette__crest')?.getAttribute('data-crest')).toBe('mon');
    expect(seen[0]).toMatchObject({ id: 'belt-purple', earned: true, caption: false });
    act(() => render(null, root));
    setLazyArtForTests({ MonCrest: null, wallpapers: null });
    act(() => render(<BeltCeremony belt="purple" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(root.querySelector('.belt-vignette__crest')?.getAttribute('data-crest')).toBe('fallback');
    expect(root.querySelector('.belt-vignette__crest svg text')?.textContent).toBe('帯');
  });

  it('renders the registry thumbnail when the kakejiku module is available', async () => {
    const renderWallpaper = vi.fn(() =>
      Promise.resolve({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect id="fake-thumb"/></svg>',
        texts: [],
        post: 'none' as const,
        effect: 'none' as const,
        locked: false,
        revealed: 4 as const,
        seed: 1,
        size: 'desktop' as const,
        w: 1920,
        h: 1080,
      }),
    );
    setLazyArtForTests({ MonCrest: null, wallpapers: { renderWallpaper } });
    act(() => render(<BeltCeremony belt="black" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(renderWallpaper).toHaveBeenCalledWith('kyoto-arrival', { size: 'desktop', reforge: 0, revealed: 4, locked: false });
    expect(root.querySelector('.belt-thumb')?.getAttribute('data-preview')).toBe('render');
    // the registry render is baked into the <img> too: its filters (sumi-dragon carries six users) never go live here
    const src = decodeURIComponent(root.querySelector('img.belt-thumb__art')!.getAttribute('src')!);
    expect(src).toContain('id="fake-thumb"');
    expect(root.querySelector('#fake-thumb')).toBeNull();
    expect(root.querySelector('.belt-vignette__next')?.textContent).toContain(S.beltRoadEnd);
  });

  it('a registry render that carries a filter def with several users still leaves ≤ 2 live filters on the ceremony', async () => {
    const renderWallpaper = vi.fn(() =>
      Promise.resolve({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><filter id="mist"><feGaussianBlur stdDeviation="8"/></filter></defs><rect filter="url(#mist)"/><rect filter="url(#mist)"/><rect filter="url(#mist)"/><circle filter="url(#mist)"/></svg>',
        texts: [],
        post: 'none' as const,
        effect: 'none' as const,
        locked: false,
        revealed: 4 as const,
        seed: 1,
        size: 'desktop' as const,
        w: 1920,
        h: 1080,
      }),
    );
    setLazyArtForTests({ MonCrest: null, wallpapers: { renderWallpaper } });
    act(() => render(<BeltCeremony belt="green" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(root.querySelector('.belt-thumb')?.getAttribute('data-preview')).toBe('render');
    expect(root.querySelectorAll('filter').length).toBeLessThanOrEqual(2);
    expect(root.querySelectorAll('[filter]').length).toBeLessThanOrEqual(2);
  });
});

describe('belt tables and SVG pieces', () => {
  it('BELT_WALLPAPER follows design 02 §2 and nextStop walks the road', () => {
    expect(BELT_WALLPAPER).toEqual({ green: 'fuji-ridge', blue: 'daruma', purple: 'koi-dragon', brown: 'wall-broken', black: 'kyoto-arrival' });
    expect(nextStop('yellow')).toMatchObject({ ja: '箱根', romaji: 'Hakone', number: 10 });
    expect(nextStop('black')).toMatchObject({ ja: S.beltRoadEndJa, romaji: S.beltRoadEnd, number: 54 });
    expect(BELT_PHASES).toHaveLength(BELT_PHASE_AT.length);
    for (let i = 1; i < BELT_PHASE_AT.length; i++) expect(BELT_PHASE_AT[i]).toBeGreaterThanOrEqual(BELT_PHASE_AT[i - 1]!);
  });

  it('the taiko phases ARE the recipe’s hits (design 09 §10 D1: one table owns the hits) and the ceremony fits its sound', () => {
    expect(BELT_TAIKO_PHASES.map((i) => BELT_PHASES[i])).toEqual(['taiko1', 'taiko2', 'taiko3']);
    expect(BELT_TAIKO_PHASES.map((i) => BELT_PHASE_AT[i])).toEqual([...CEREMONY_TAIKO_AT_MS]);
    expect(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]).toBeLessThanOrEqual(SFX_DURATION_MS.ceremony);
    expect(BELT_PHASE_AT[beltPhaseIndex('kanji')]).toBeGreaterThan(CEREMONY_TAIKO_AT_MS[CEREMONY_TAIKO_AT_MS.length - 1]!);
  });

  it('every belt has a vignette of 80 words or fewer', () => {
    for (const b of BELT_IDS) {
      const words = S.beltVignettes[b].trim().split(/\s+/).length;
      expect(words, b).toBeLessThanOrEqual(80);
      expect(S.beltVignettes[b]).not.toMatch(/!/);
    }
  });

  it('SVG pieces are deterministic standalone documents', () => {
    expect(splashSvg(3, 1)).toBe(splashSvg(3, 1));
    expect(splashSvg(3, 1).startsWith('<svg')).toBe(true);
    expect(kanjiSvg('達人', 9, false)).toBe(kanjiSvg('達人', 9, false));
    expect(kanjiSvg('達人', 9, false)).toContain('@keyframes belt-write-draw');
    expect(kanjiSvg('達人', 9, true)).not.toContain('<mask');
    const black = knotSvg('black', 1, false);
    expect(black).toContain('#B8860B');
    expect(black).toContain('@keyframes belt-tail-l-draw');
    expect(knotSvg('green', 1, true)).not.toContain('<animate');
    expect(sealSvg('ハナ', 2)).toBe(sealSvg('ハナ', 2));
    const lanterns = lanternsSvg('green');
    expect((lanterns.match(/belt-lantern--lit/g) ?? []).length).toBe(4);
    expect((lanterns.match(/belt-lantern--next/g) ?? []).length).toBe(1);
    expect(lanternsSvg('black')).toContain(S.beltRoadEndJa);
  });
});
