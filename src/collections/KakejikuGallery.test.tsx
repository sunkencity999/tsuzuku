import { render } from 'preact';
import { act } from 'preact/test-utils';
import { sampleData } from '../art/wallpapers/data';
import { WALLPAPER_IDS } from '../shared/catalog';
import { href } from '../shared/routes';
import { civilToDay } from '../shared/time';
import { WALLPAPER_DEFS, store } from '../store';
import { resetStoreForTests } from '../store/store';
import { TEST_SEED, makeTestStore } from '../store/testing';
import { KakejikuGallery, cardStateOf, isUnlocked, progressFor, revealedFor, thumbnailFor } from './KakejikuGallery';

const DAY = civilToDay({ year: 2026, month: 10, day: 17 });
const def = (id: string) => WALLPAPER_DEFS.find((d) => d.id === id)!;

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

const SAVE = {
  stats: { reviews: 600 },
  collections: {
    wallpapers: {
      'torii-dawn': { at: DAY, reforges: 2, revealed: 4 as const },
      'great-wave': { at: 0, reforges: 0, revealed: 1 as const },
      daruma: { at: DAY, reforges: 0, revealed: 4 as const },
    },
  },
  progress: { shinsaPassed: ['yellow', 'orange', 'green', 'blue'] as ('yellow' | 'orange' | 'green' | 'blue')[] },
};

async function mount(thumbnails: boolean): Promise<void> {
  await makeTestStore({ save: SAVE });
  await act(async () => {
    render(<KakejikuGallery thumbnails={thumbnails} />, root);
  });
}

const card = (id: string): HTMLElement => root.querySelector<HTMLElement>(`.kakejiku-card[data-wallpaper="${id}"]`)!;

describe('gallery helpers', () => {
  it('isUnlocked / cardStateOf / revealedFor follow the store entry and the live progress', async () => {
    await makeTestStore({ save: SAVE });
    const m = store.meta();
    expect(isUnlocked(undefined)).toBe(false);
    expect(isUnlocked({ at: 0, reforges: 0, revealed: 2 })).toBe(false);
    expect(isUnlocked({ at: DAY, reforges: 0, revealed: 4 })).toBe(true);
    // great-wave: 600 / 1000 reviews → 60 % → 2 quadrants live, stored 1 → shows 2
    expect(progressFor(def('great-wave'), m, store.cards)).toBeCloseTo(0.6);
    expect(revealedFor(def('great-wave'), m.collections.wallpapers['great-wave'], m, store.cards)).toBe(2);
    expect(cardStateOf(m.collections.wallpapers['great-wave'], 2)).toBe('revealing');
    // non-counter piece: no progress, locked
    expect(progressFor(def('okaeri'), m, store.cards)).toBeNull();
    expect(revealedFor(def('okaeri'), undefined, m, store.cards)).toBe(0);
    expect(cardStateOf(undefined, 0)).toBe('locked');
    // unlocked always 4
    expect(revealedFor(def('torii-dawn'), m.collections.wallpapers['torii-dawn'], m, store.cards)).toBe(4);
    // a stub that claims 4 while locked is capped at 3
    expect(revealedFor(def('end-card'), { at: 0, reforges: 0, revealed: 4 }, m, store.cards)).toBe(3);
  });

  it('thumbnailFor is deterministic, image-ready and bakes the text layers in for unlocked pieces', () => {
    const data = sampleData(1);
    const a = thumbnailFor('torii-dawn', { data, size: 'desktop', locked: false, revealed: 4, reforge: 0, profileSeed: TEST_SEED });
    const b = thumbnailFor('torii-dawn', { data, size: 'desktop', locked: false, revealed: 4, reforge: 0, profileSeed: TEST_SEED });
    expect(a).toBe(b);
    expect(a.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(a)).toContain(data.nameKana);
    const reforged = thumbnailFor('torii-dawn', { data, size: 'desktop', locked: false, revealed: 4, reforge: 1, profileSeed: TEST_SEED });
    expect(reforged).not.toBe(a);
    const locked = thumbnailFor('torii-dawn', { data, size: 'desktop', locked: true, revealed: 0, reforge: 0, profileSeed: TEST_SEED });
    expect(decodeURIComponent(locked)).not.toContain(data.nameKana);
    expect(decodeURIComponent(locked)).toContain('wp-sumi');
  });
});

describe('<KakejikuGallery>', () => {
  it('renders all 29 scrolls with locked vs unlocked states, chips and Studio links', async () => {
    await mount(false);
    const cards = root.querySelectorAll('.kakejiku-card');
    expect(cards).toHaveLength(WALLPAPER_IDS.length);
    expect(root.querySelector('.kakejiku-gallery')?.getAttribute('data-unlocked')).toBe('2');
    expect(root.querySelector('.kakejiku-gallery__lede')?.textContent).toContain('2 of 29');

    const torii = card('torii-dawn');
    expect(torii.dataset.state).toBe('unlocked');
    expect(torii.textContent).toContain('Reforged 2×');
    expect(torii.textContent).toContain('朝の鳥居');
    expect(torii.textContent).toContain('Torii at Dawn');
    expect(torii.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'studio', wallpaperId: 'torii-dawn' }));
    expect(torii.querySelector('.kakejiku-card__ring')).toBeNull();
    expect(torii.querySelector('.kakejiku-card__condition')).toBeNull();

    const okaeri = card('okaeri');
    expect(okaeri.dataset.state).toBe('locked');
    expect(okaeri.textContent).toContain('Locked');
    expect(okaeri.querySelector('.kakejiku-card__condition')?.textContent).toBe(def('okaeri').describe);
    expect(okaeri.querySelector('.kakejiku-card__ring')).toBeNull();

    // living pieces carry the badge
    expect(card('sakura-storm').querySelector('.kakejiku-card__living')).not.toBeNull();
    expect(card('vs-wall').querySelector('.kakejiku-card__living')).toBeNull();
    // daruma: blue passed, not black → left eye
    expect(card('daruma').textContent).toContain('Left eye painted');
    // without thumbnails no <img>, but every art slot has an accessible label
    expect(root.querySelectorAll('img')).toHaveLength(0);
    expect(root.querySelectorAll('.kakejiku-card__pending[role="img"]')).toHaveLength(29);
  });

  it('counter pieces show a progress ring and the revealed quadrant count', async () => {
    await mount(false);
    const wave = card('great-wave');
    expect(wave.dataset.state).toBe('revealing');
    expect(wave.dataset.revealed).toBe('2');
    const ring = wave.querySelector('.kakejiku-card__ring')!;
    expect(ring.getAttribute('role')).toBe('img');
    expect(ring.getAttribute('aria-label')).toBe('60 % toward the unlock');
    expect(ring.textContent).toContain('60');
    expect(wave.textContent).toContain('2 of 4 quadrants');
    // locked counter piece with zero progress still shows the ring at 0
    const neon = card('neon-alley');
    expect(neon.dataset.state).toBe('locked');
    expect(neon.querySelector('.kakejiku-card__ring')?.getAttribute('aria-label')).toBe('0 % toward the unlock');
  });

  it('composes thumbnails one per tick: the first unlocked card gets an <img> data URL with the preview alt', async () => {
    await mount(true);
    for (let i = 0; i < 40 && !root.querySelector('img'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    const img = card('torii-dawn').querySelector<HTMLImageElement>('img.kakejiku-card__img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')!.startsWith('data:image/svg+xml')).toBe(true);
    expect(img!.getAttribute('alt')).toBe('Preview of Torii at Dawn');
    // the rest keep rendering; a locked piece gets the silhouette alt once it lands
    for (let i = 0; i < 80 && !card('kana-grid').querySelector('img'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(card('kana-grid').querySelector('img')?.getAttribute('alt')).toBe('Sumi silhouette of Gojūon Select');
  });
});
