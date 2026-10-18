/**
 * Registry tests. `./index.ts` statically imports all 28 generator modules,
 * which other builders are writing now; until every one exists the module
 * cannot load, so this suite skips itself (with the load error in the skip
 * reason) and runs in full once the registry resolves.
 */
import { WALLPAPER_IDS, type WallpaperId } from '../../shared/catalog';
import { fnv1a32, hashSeed } from '../../shared/hash';
import { textLayersSvg } from '../jtext';
import { makeTestStore, TEST_SEED } from '../../store/testing';
import { sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES, type WallpaperSize } from './spec';

type Registry = typeof import('./index');

let registry: Registry | null = null;
let loadError = '';
try {
  registry = await import('./index');
} catch (e) {
  const m = (e as { message?: unknown } | null)?.message;
  loadError = typeof m === 'string' && m ? m : String(e);
}

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

describe.skipIf(!registry)(`wallpapers registry${registry ? '' : ` (skipped: ${loadError.split('\n')[0]})`}`, () => {
  const R = (): Registry => registry!;

  it('every WALLPAPER_ID has a generator whose id matches its key, in catalog order', () => {
    const { WALLPAPERS, missingGenerators } = R();
    expect(missingGenerators()).toEqual([]);
    expect(Object.keys(WALLPAPERS)).toEqual([...WALLPAPER_IDS]);
    for (const id of WALLPAPER_IDS) {
      expect(WALLPAPERS[id].id, id).toBe(id);
      expect(typeof WALLPAPERS[id].compose).toBe('function');
    }
  });

  for (const id of WALLPAPER_IDS) {
    for (const size of WALLPAPER_SIZES) {
      it(`${id} ${size}: same (seed, data, size) → byte-identical, well-formed, self-contained SVG (snapshot)`, () => {
        const spec = R().WALLPAPERS[id];
        const a = spec.compose(1, DATA, size);
        const b = spec.compose(1, DATA, size);
        expect(isComposition(a)).toBe(true);
        expect(a.svg).toBe(b.svg);
        expect(a.texts).toEqual(b.texts);
        expect(a.post).toBe(b.post);
        expect(hasCanvasSize(a, size), 'root width/height/viewBox equal SIZES[size]').toBe(true);
        expect(isSelfContained(a.svg), 'no <image>, <script>, foreignObject or external refs').toBe(true);
        expect(usesReservedIds(a.svg), 'ids must not start with wp-').toBe(false);
        expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
        const doc = new DOMParser().parseFromString(a.svg, 'image/svg+xml');
        expect(doc.querySelector('parsererror')).toBeNull();
        expect(fingerprint(a.svg)).toMatchSnapshot();
      });
    }
    it(`${id}: phone variant keeps every TextLayer inside the safe zones`, () => {
      const c = R().WALLPAPERS[id].compose(1, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
    });
    it(`${id}: locked renders a sumi silhouette without personal text; reforge changes the seed`, () => {
      const { WALLPAPERS, composeWallpaper, wallpaperSeed } = R();
      const spec = WALLPAPERS[id];
      const open = composeWallpaper(spec, { seed: 1, data: DATA, size: 'desktop', locked: false, revealed: 4, post: 'none' });
      const locked = composeWallpaper(spec, { seed: 1, data: DATA, size: 'desktop', locked: true, revealed: 0, post: 'none' });
      expect(locked.locked).toBe(true);
      expect(locked.revealed).toBe(0);
      expect(locked.texts).toEqual([]);
      expect(locked.svg).not.toBe(open.svg);
      if (!spec.silhouette) expect(locked.svg).toContain('id="wp-sumi"');
      const half = composeWallpaper(spec, { seed: 1, data: DATA, size: 'desktop', locked: true, revealed: 2, post: 'none' });
      expect(half.svg).toContain('id="wp-reveal"');
      expect(half.texts.length).toBeLessThanOrEqual(open.texts.length);
      expect(wallpaperSeed(TEST_SEED, id, 0)).toBe(hashSeed(TEST_SEED, id, 0));
      expect(wallpaperSeed(TEST_SEED, id, 1)).not.toBe(wallpaperSeed(TEST_SEED, id, 0));
    });
  }

  it('imported-save strings reach the SVG only XML-escaped: a hostile name, sentences and seal glyph parse clean in every piece', () => {
    const hostile = '<script>alert(1)</script>"&\'';
    const d = sampleData(1, { nameKana: hostile, sentenceOfChoice: hostile, dictatedSentence: hostile, writingSentences: [hostile, hostile], chosenKanji: '<' });
    expect(d.nameKana.startsWith('<script>')).toBe(true);
    for (const id of WALLPAPER_IDS) {
      for (const size of WALLPAPER_SIZES) {
        const c = R().WALLPAPERS[id].compose(1, d, size);
        const layers = textLayersSvg(c.texts);
        const baked = c.svg.slice(0, c.svg.lastIndexOf('</svg>')) + layers + '</svg>';
        expect(baked, `${id} ${size}`).not.toMatch(/<\/?script|"&'/i); // raw tag or raw quote run = an unescaped sink
        if (c.texts.some((t) => t.text.includes('<'))) expect(layers, `${id} ${size}`).toContain('&lt;');
        const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
        expect(doc.querySelector('parsererror'), `${id} ${size}`).toBeNull();
      }
    }
  });

  it('renderWallpaper seeds from the profile and the reforge count, honours data/overrides and post modes', async () => {
    const { renderWallpaper, composeWallpaper, WALLPAPERS, wallpaperSeed } = R();
    await makeTestStore({ save: { profile: { nameKana: 'ハナ' } } });
    const id: WallpaperId = 'torii-dawn';
    const r = await renderWallpaper(id, { size: 'desktop', reforge: 2, revealed: 4, locked: false, data: DATA });
    const expected = composeWallpaper(WALLPAPERS[id], { seed: wallpaperSeed(TEST_SEED, id, 2), data: DATA, size: 'desktop', locked: false, revealed: 4 });
    expect(r.svg).toBe(expected.svg);
    expect(r.seed).toBe(hashSeed(TEST_SEED, id, 2));
    expect(r.post).toBe('none');
    const raster = await renderWallpaper(id, { size: 'phone', reforge: 0, revealed: 4, locked: false, data: DATA, post: 'raster' });
    expect(raster.post).toBe(raster.effect);
    expect(raster.w).toBe(1080);
    const gathered = await renderWallpaper(id, { size: 'desktop', reforge: 0, revealed: 1, locked: true });
    expect(gathered.locked).toBe(true);
    expect(gathered.texts).toEqual([]);
    const sizes: WallpaperSize[] = ['desktop', 'phone'];
    for (const size of sizes) expect((await renderWallpaper(id, { size, reforge: 0, revealed: 4, locked: false, data: DATA })).size).toBe(size);
  });
});

describe('registry prerequisites (always run)', () => {
  it('the catalog lists 29 kakejiku (design 08 §11 adds 茶屋の灯) and sample data is valid', () => {
    expect(WALLPAPER_IDS.length).toBe(29);
    expect(DATA.mastered.kana.length).toBeGreaterThan(0);
  });
  it('reports why the registry is skipped, if it is', () => {
    if (!registry) expect(loadError).toMatch(/Failed to (load|resolve)|Cannot find|does the file exist/i);
    else expect(loadError).toBe('');
  });
});
