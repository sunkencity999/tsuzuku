/**
 * TSUZUKU — the 29 kakejiku (design 06 §3; 茶屋の灯 from design 08 §11): registry and renderer.
 *
 * IMPORT CONVENTION: every generator `src/art/wallpapers/<kebab>.ts` exports
 * `export const spec: WallpaperSpec`, imported here in catalog order as
 * `import { spec as toriiDawn } from './torii-dawn'`. `WALLPAPERS` is keyed by
 * `WallpaperId` and covers every id in `WALLPAPER_IDS` (index.test.ts).
 *
 *  renderWallpaper(id, {size, reforge, revealed, locked, …})
 *      seed = hashSeed(profile.seed, id, reforge)
 *      data = wallpaperData() (or `data`/`overrides` from the caller)
 *      → spec.compose → finalize (silhouette when locked, quadrant reveal,
 *        post layer) → RenderedWallpaper
 *
 *  composeWallpaper(spec, …) is the synchronous, store-free half for tests
 *  and previews.
 */
import { WALLPAPER_IDS, type WallpaperId } from '../../shared/catalog';
import { hashSeed } from '../../shared/hash';
import { store } from '../../store';
import { WALLPAPER_NAMES } from '../strings';
import { wallpaperData } from './data';
import { finalize, type Composition, type RenderedWallpaper, type Revealed, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';

import { spec as toriiDawn } from './torii-dawn';
import { spec as kanaGrid } from './kana-grid';
import { spec as neonAlley } from './neon-alley';
import { spec as sakuraStorm } from './sakura-storm';
import { spec as greatWave } from './great-wave';
import { spec as kanjiStars } from './kanji-stars';
import { spec as fiftyThree } from './fifty-three';
import { spec as lanternRiver } from './lantern-river';
import { spec as sumiDragon } from './sumi-dragon';
import { spec as okaeri } from './okaeri';
import { spec as vsWall } from './vs-wall';
import { spec as wallBroken } from './wall-broken';
import { spec as tanabata } from './tanabata';
import { spec as hankoGarden } from './hanko-garden';
import { spec as fujiRidge } from './fuji-ridge';
import { spec as koiDragon } from './koi-dragon';
import { spec as shojiLight } from './shoji-light';
import { spec as insertCoin } from './insert-coin';
import { spec as daruma } from './daruma';
import { spec as vendingNight } from './vending-night';
import { spec as onsen } from './onsen';
import { spec as waveform } from './waveform';
import { spec as goldenScreen } from './golden-screen';
import { spec as festival } from './festival';
import { spec as stationSign } from './station-sign';
import { spec as kyotoArrival } from './kyoto-arrival';
import { spec as roadContinues } from './road-continues';
import { spec as endCard } from './end-card';
import { spec as chayaLanterns } from './chaya-lanterns';

export type { Composition, RenderedWallpaper, Revealed, WallpaperData, WallpaperSize, WallpaperSpec } from './spec';
export { finalize, sumiSilhouette, revealQuadrants, appendPostLayer, safeZoneViolations } from './spec';
export { wallpaperData, sampleData, validateData, normalizeData } from './data';

/** The generators by id; `WALLPAPERS` re-keys this literal in `WALLPAPER_IDS` order (design 08 §11 adds `chaya-lanterns`). */
const GENERATORS: Record<WallpaperId, WallpaperSpec> = {
  'torii-dawn': toriiDawn,
  'kana-grid': kanaGrid,
  'neon-alley': neonAlley,
  'sakura-storm': sakuraStorm,
  'great-wave': greatWave,
  'kanji-stars': kanjiStars,
  'fifty-three': fiftyThree,
  'lantern-river': lanternRiver,
  'sumi-dragon': sumiDragon,
  okaeri,
  'vs-wall': vsWall,
  'wall-broken': wallBroken,
  tanabata,
  'hanko-garden': hankoGarden,
  'fuji-ridge': fujiRidge,
  'koi-dragon': koiDragon,
  'shoji-light': shojiLight,
  'insert-coin': insertCoin,
  daruma,
  'vending-night': vendingNight,
  onsen,
  waveform,
  'golden-screen': goldenScreen,
  festival,
  'station-sign': stationSign,
  'kyoto-arrival': kyotoArrival,
  'road-continues': roadContinues,
  'end-card': endCard,
  'chaya-lanterns': chayaLanterns,
};

/** All 29 generators keyed by id, in catalog order (`WALLPAPER_IDS` is the one order, whatever the literal above lists first). */
export const WALLPAPERS: Record<WallpaperId, WallpaperSpec> = Object.fromEntries(WALLPAPER_IDS.map((id) => [id, GENERATORS[id]])) as Record<WallpaperId, WallpaperSpec>;

/** Ids in the catalog without a registered generator (always empty once the registry is complete). */
export function missingGenerators(): WallpaperId[] {
  return WALLPAPER_IDS.filter((id) => !WALLPAPERS[id] || typeof WALLPAPERS[id].compose !== 'function');
}

export function specOf(id: WallpaperId): WallpaperSpec {
  return WALLPAPERS[id];
}

/** `hashSeed(profile.seed, id, reforge)` — the one seed a piece is drawn from (design 06 §3). */
export function wallpaperSeed(profileSeed: string, id: WallpaperId, reforge: number): number {
  return hashSeed(profileSeed, id, Math.max(0, Math.floor(reforge)));
}

export interface ComposeOptions {
  seed: number;
  data: WallpaperData;
  size: WallpaperSize;
  locked: boolean;
  revealed: Revealed;
  /** See `FinalizeOptions.post` (default `svg`). */
  post?: 'svg' | 'raster' | 'none';
}

/**
 * Synchronous render of one spec: a hand-made `spec.silhouette` is used for a
 * fully hidden locked piece; otherwise the generic sumi silhouette / quadrant
 * reveal wraps `spec.compose`. Pure: same inputs → identical output.
 */
export function composeWallpaper(spec: WallpaperSpec, o: ComposeOptions): RenderedWallpaper {
  const title = WALLPAPER_NAMES[spec.id]?.en;
  if (o.locked && o.revealed <= 0 && spec.silhouette) {
    const c: Composition = spec.silhouette(o.seed, o.data, o.size);
    const r = finalize({ ...c, texts: [] }, { size: o.size, seed: o.seed, locked: false, revealed: 4, post: o.post, title });
    return { ...r, locked: true, revealed: 0 };
  }
  const c = spec.compose(o.seed, o.data, o.size);
  return finalize(c, { size: o.size, seed: o.seed, locked: o.locked, revealed: o.revealed, post: o.post, title });
}

export interface RenderOptions {
  size: WallpaperSize;
  /** `collections.wallpapers[id].reforges` (0 before the first reforge). */
  reforge: number;
  /** `collections.wallpapers[id].revealed` for counter pieces; ignored when unlocked. */
  revealed: Revealed;
  locked: boolean;
  /** Skip the store/content gather and use this data (tests, previews). */
  data?: WallpaperData;
  /** Studio personalisation merged over the gathered data (sentence of choice, chosen kanji…). */
  overrides?: Partial<WallpaperData>;
  /** Override the seed (previews); default `wallpaperSeed(store.seed(), id, reforge)`. */
  seed?: number;
  post?: 'svg' | 'raster' | 'none';
}

/** Render a piece for the current learner. */
export async function renderWallpaper(id: WallpaperId, o: RenderOptions): Promise<RenderedWallpaper> {
  const spec = WALLPAPERS[id];
  const data = o.data ?? (await wallpaperData(o.overrides ?? {}));
  const seed = o.seed ?? wallpaperSeed(store.seed(), id, o.reforge);
  return composeWallpaper(spec, { seed, data, size: o.size, locked: o.locked, revealed: o.revealed, post: o.post });
}
