/**
 * TSUZUKU — the 53 vistas (design 09 §10 C2, §12.1 decision 6).
 *
 * One row per station, keyed to the Gatekeeper's theme in `STATIONS`
 * (`gateEn`: Tide, Ferry, Pine Grove, Great Checkpoint, Fuji-View …): the
 * motif set drawn from `src/art/motifs.ts` (main motif first — the Road row's
 * vignette; the headpiece adds the second and third), a palette hint, and the
 * English vista name and note from `./strings.ts`. Japanese names are never
 * here — they are `STATIONS[n].nameJa`.
 *
 * Rendered ONLY as the 160 px Station headpiece and the three-town genkan
 * strip, never as a full emaki hero: the Hara headpiece snapshot
 * (`headpiece.test.ts`) is the go/no-go for any later horizontal scroll.
 *
 * `vistaName(n)` is the `VistaLookup` of `session/end-card.ts`: it returns
 * `null` for a station without a vista (0, 54 and anything off the road), so
 * 次回予告's line 3 stays the plain Gatekeeper line there.
 */
import { STATIONS } from '../../content/types';
import type { MotifId } from '../motifs';
import { VISTA_COPY } from './strings';

/** Which pigment leads the headpiece's bands (a token name, resolved by the host's CSS). */
export type PaletteHint = 'kon' | 'sakura' | 'matcha' | 'kin' | 'ai' | 'sumi';

export interface Vista {
  station: number;
  /** Main motif first (the row vignette); the headpiece draws up to three. */
  motifs: readonly MotifId[];
  palette: PaletteHint;
  /** The short vista name ("Fuji view"). */
  name: string;
  /** One English line. */
  note: string;
}

const row = (station: number, motifs: readonly MotifId[], palette: PaletteHint): Vista => {
  const copy = VISTA_COPY[station]!;
  return { station, motifs, palette, name: copy.name, note: copy.note };
};

export const VISTAS: readonly Vista[] = [
  // White — the bay
  row(1, ['wave', 'chochin-b'], 'ai'),
  row(2, ['wave', 'teahouse'], 'ai'),
  row(3, ['inn', 'wave', 'chochin-c'], 'kon'),
  // Yellow — hills and shore
  row(4, ['pine-a', 'bridge'], 'matcha'),
  row(5, ['inn', 'torii-b'], 'sakura'),
  row(6, ['torii-c', 'pine-a', 'pine-b'], 'matcha'),
  row(7, ['pine-b', 'fuji'], 'kon'),
  row(8, ['pine-a', 'wave'], 'ai'),
  row(9, ['gate', 'bridge'], 'kon'),
  // Orange — the checkpoint and Fuji
  row(10, ['gate', 'pine-c'], 'sumi'),
  row(11, ['torii-c', 'chochin-c'], 'sumi'),
  row(12, ['pine-a', 'inn'], 'kon'),
  row(13, ['fuji', 'pine-a'], 'sakura'),
  row(14, ['fuji', 'pine-b'], 'matcha'),
  row(15, ['inn', 'pine-b'], 'sumi'),
  // Green — the bay from the cliffs, the rivers
  row(16, ['fuji', 'wave'], 'ai'),
  row(17, ['pine-a', 'wave'], 'ai'),
  row(18, ['wave', 'pine-b'], 'kon'),
  row(19, ['bridge', 'inn'], 'kon'),
  row(20, ['teahouse', 'pine-b'], 'matcha'),
  row(21, ['pine-c', 'gate'], 'sumi'),
  row(22, ['inn', 'chochin-c'], 'kin'),
  row(23, ['wave', 'bridge'], 'ai'),
  row(24, ['wave', 'pine-a'], 'ai'),
  // Blue — the plateau
  row(25, ['pine-c', 'gate'], 'sumi'),
  row(26, ['pine-b', 'bridge'], 'kin'),
  row(27, ['teahouse', 'chochin-a'], 'kin'),
  row(28, ['wave', 'bridge'], 'ai'),
  row(29, ['pine-c', 'inn'], 'sumi'),
  row(30, ['wave', 'fuji'], 'ai'),
  row(31, ['gate', 'wave'], 'kon'),
  // Purple — inns and bridges
  row(32, ['wave', 'pine-a'], 'ai'),
  row(33, ['teahouse', 'pine-b'], 'matcha'),
  row(34, ['bridge', 'gate'], 'kon'),
  row(35, ['inn', 'chochin-a'], 'kin'),
  row(36, ['inn', 'chochin-a', 'chochin-b'], 'kin'),
  row(37, ['pine-b', 'gate'], 'matcha'),
  row(38, ['bridge', 'gate', 'pagoda-b'], 'kon'),
  // Brown — markets, shrines, snow
  row(39, ['pine-c', 'teahouse'], 'matcha'),
  row(40, ['inn', 'chochin-c'], 'sakura'),
  row(41, ['torii-d', 'chochin-b'], 'kin'),
  row(42, ['wave', 'gate'], 'ai'),
  row(43, ['bridge', 'pine-a'], 'kon'),
  row(44, ['torii-c', 'pagoda-a'], 'matcha'),
  row(45, ['pine-b', 'teahouse'], 'sumi'),
  row(46, ['gate', 'pine-c'], 'sumi'),
  // Black — toward the lake and Kyoto
  row(47, ['inn', 'chochin-a'], 'kin'),
  row(48, ['pine-c', 'teahouse'], 'sumi'),
  row(49, ['bridge', 'pine-b'], 'ai'),
  row(50, ['teahouse', 'inn'], 'kin'),
  row(51, ['teahouse', 'chochin-c'], 'matcha'),
  row(52, ['teahouse', 'bridge'], 'kin'),
  row(53, ['teahouse', 'wave', 'pagoda-b'], 'ai'),
];

const BY_STATION = new Map(VISTAS.map((v) => [v.station, v]));

/** The vista of station `n` (1–53), or `undefined` off the road. */
export function vistaOf(n: number): Vista | undefined {
  return BY_STATION.get(n);
}

/** `VistaLookup` for 次回予告: the vista name, or `null` where the road has none. */
export function vistaName(n: number): string | null {
  return BY_STATION.get(n)?.name ?? null;
}

/** The motifs of the two ends of the road: both are bridges (日本橋, 三条大橋 — names from `content/types`). */
export const END_MOTIF: MotifId = 'bridge';

/** True when `n` names a station (`STATIONS`), so `nameJa` exists. */
export function onRoad(n: number): boolean {
  return STATIONS.some((s) => s.number === n);
}
