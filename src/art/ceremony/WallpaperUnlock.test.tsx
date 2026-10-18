import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { WALLPAPER_IDS } from '../../shared/catalog';
import { href } from '../../shared/routes';
import { makeTestStore } from '../../store/testing';
import { WALLPAPER_NAMES } from '../strings';
import { S } from './strings';
import { EXIT_FALLBACK_MS, setLazyArtForTests, type WallpaperRenderOptions, type WallpapersModule } from './support';
import { UNROLL_AT, WallpaperUnlock, placeholderWallpaperSvg } from './WallpaperUnlock';

let root: HTMLDivElement;
let sfx: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
  sfx = vi.fn();
  installServices({ audio: { ...nullAudio, sfx } });
  setLazyArtForTests({ wallpapers: null });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  setLazyArtForTests(null);
  vi.useRealTimers();
  location.hash = '';
});

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};

function fakeRegistry(): { mod: WallpapersModule; calls: WallpaperRenderOptions[] } {
  const calls: WallpaperRenderOptions[] = [];
  const mod: WallpapersModule = {
    renderWallpaper: (id, o) => {
      calls.push(o);
      return Promise.resolve({
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2340" viewBox="0 0 1080 2340"><rect id="fake-${id}" width="10" height="10"/></svg>`,
        texts: [{ text: 'ハナ', x: 540, y: 1200, size: 80, font: 'serif', fill: '#fff' }],
        post: 'none',
        effect: 'none',
        locked: o.locked,
        revealed: o.locked ? o.revealed : 4,
        seed: 1,
        size: o.size,
        w: 1080,
        h: 2340,
      });
    },
  };
  return { mod, calls };
}

describe('<WallpaperUnlock>', () => {
  it('renders the placeholder thumbnail and names until the registry renders, and says so', async () => {
    act(() => render(<WallpaperUnlock id="torii-dawn" onDone={() => {}} reduced />, root));
    await settle();
    const section = root.querySelector('.kakejiku-unlock')!;
    expect(section.getAttribute('data-preview')).toBe('placeholder');
    // the silk is one <img> data URL: the placeholder's mist blur is rasterised once, never a live filter (§6.7 rule 2)
    const art = root.querySelector('img.kakejiku__art')!;
    expect(art.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(art.getAttribute('src')!)).toContain('<feGaussianBlur');
    expect(root.querySelectorAll('filter')).toHaveLength(0);
    expect(root.querySelectorAll('[filter]')).toHaveLength(0);
    expect(root.querySelector('.kakejiku-unlock__name')?.textContent).toBe(WALLPAPER_NAMES['torii-dawn'].ja);
    expect(root.querySelector('.kakejiku-unlock__name')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.kakejiku-unlock__name-en')?.textContent).toBe(WALLPAPER_NAMES['torii-dawn'].en);
    expect(root.querySelector('.kakejiku-unlock__eyebrow')?.textContent).toContain(S.wallpaperUnlocked);
    expect(root.querySelector('.kakejiku-unlock__pending')?.textContent).toBe(S.previewPending);
  });

  it('links to the Studio for the piece and plays the wind chime', () => {
    act(() => render(<WallpaperUnlock id="sakura-storm" onDone={() => {}} reduced />, root));
    const link = root.querySelector('.kakejiku-unlock__studio') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(href({ name: 'studio', wallpaperId: 'sakura-storm' }));
    expect(link.getAttribute('href')).toBe('#/studio/sakura-storm');
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('wallpaper');
  });

  it('renders through the registry when available (locked quadrant reveal → locked render)', async () => {
    const { mod, calls } = fakeRegistry();
    setLazyArtForTests({ wallpapers: mod });
    act(() => render(<WallpaperUnlock id="great-wave" quadrant={2} onDone={() => {}} reduced />, root));
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ size: 'phone', reforge: 0, revealed: 2, locked: true });
    const section = root.querySelector('.kakejiku-unlock')!;
    expect(section.getAttribute('data-preview')).toBe('render');
    const rendered = decodeURIComponent(root.querySelector('img.kakejiku__art')!.getAttribute('src')!);
    expect(rendered).toContain('id="fake-great-wave"');
    expect(rendered).toContain('ハナ');
    expect(root.querySelector('#fake-great-wave')).toBeNull();
    expect(root.querySelector('.kakejiku-unlock__eyebrow')?.textContent).toContain(S.wallpaperRevealed);
    expect(root.querySelector('.kakejiku-unlock__quadrant')?.textContent).toBe('2 of 4');
    expect(root.querySelector('.kakejiku-unlock__pending')).toBeNull();
  });

  it('a full unlock renders unlocked with the piece reforge count', async () => {
    await makeTestStore({ save: { collections: { wallpapers: { okaeri: { at: 20_000, reforges: 3, revealed: 4 } } } } });
    const { mod, calls } = fakeRegistry();
    setLazyArtForTests({ wallpapers: mod });
    act(() => render(<WallpaperUnlock id="okaeri" onDone={() => {}} reduced />, root));
    await settle();
    expect(calls[0]).toMatchObject({ reforge: 3, revealed: 4, locked: false });
  });

  it('unrolls: rolled → unrolling → open; reduced motion is open at once', () => {
    vi.useFakeTimers();
    act(() => render(<WallpaperUnlock id="daruma" onDone={() => {}} reduced={false} />, root));
    const section = (): Element => root.querySelector('.kakejiku-unlock')!;
    expect(section().classList.contains('kakejiku-unlock--rolled')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(UNROLL_AT[1]!);
    });
    expect(section().classList.contains('kakejiku-unlock--unrolling')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(UNROLL_AT[2]! - UNROLL_AT[1]!);
    });
    expect(section().classList.contains('kakejiku-unlock--open')).toBe(true);

    act(() => render(<WallpaperUnlock id="daruma" onDone={() => {}} reduced />, root));
    expect(section().classList.contains('kakejiku-unlock--open')).toBe(true);
  });

  it('Continue and the Studio link both complete the ceremony (at once under reduced motion; one exit per card)', () => {
    const onDone = vi.fn();
    act(() => render(<WallpaperUnlock id="daruma" onDone={onDone} reduced />, root));
    expect(root.querySelector('.kakejiku-unlock')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('[class*="ink-"]')).toBeNull();
    (root.querySelector('.kakejiku-unlock__continue') as HTMLButtonElement).click();
    expect(onDone).toHaveBeenCalledTimes(1);
    (root.querySelector('.kakejiku-unlock__studio') as HTMLAnchorElement).click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('when the host owns the exit (hostExit) Continue hands over at once, no kasure on the card', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<WallpaperUnlock id="daruma" onDone={onDone} reduced={false} hostExit />, root));
    act(() => {
      (root.querySelector('.kakejiku-unlock__continue') as HTMLButtonElement).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.kakejiku-unlock')?.hasAttribute('data-leaving')).toBe(false);
  });

  it('with motion, Continue dries the card out first: data-leaving on the root, onDone on the ≤ 200 ms fallback', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<WallpaperUnlock id="daruma" onDone={onDone} reduced={false} />, root));
    expect(root.querySelector('.kakejiku-unlock')?.classList.contains('ink-nijimi')).toBe(true);
    act(() => {
      (root.querySelector('.kakejiku-unlock__continue') as HTMLButtonElement).click();
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(root.querySelector('.kakejiku-unlock')?.hasAttribute('data-leaving')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(EXIT_FALLBACK_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('placeholderWallpaperSvg', () => {
  it('is deterministic, seed-dependent, named, and respects the phone safe zone by construction', () => {
    const a = placeholderWallpaperSvg('neon-alley', 5, 'phone');
    expect(a).toBe(placeholderWallpaperSvg('neon-alley', 5, 'phone'));
    expect(a).not.toBe(placeholderWallpaperSvg('neon-alley', 6, 'phone'));
    expect(a).toContain('viewBox="0 0 1080 2340"');
    expect(a).toContain(WALLPAPER_NAMES['neon-alley'].en);
    for (const ch of Array.from(WALLPAPER_NAMES['neon-alley'].ja)) expect(a).toContain(ch);
    expect(a).toContain('<g lang="ja">');
    const desktop = placeholderWallpaperSvg('neon-alley', 5, 'desktop');
    expect(desktop).toContain('viewBox="0 0 1920 1080"');
    expect(desktop).toContain(`>${WALLPAPER_NAMES['neon-alley'].ja}<`);
  });

  it('renders for every catalog id', () => {
    for (const id of WALLPAPER_IDS) expect(placeholderWallpaperSvg(id, 1, 'phone').startsWith('<svg')).toBe(true);
  });
});
