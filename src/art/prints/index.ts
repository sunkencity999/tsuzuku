/**
 * TSUZUKU — the prints barrel (prints B1, open art tier). The Dojo, Station
 * and Road owners import this statically as `@/art/prints`: it reaches nothing
 * in `src/art/dojo`, `wallpapers` or `ceremony`, so a surface that hangs a
 * print never pays for the drawn room. The boot barrel `src/art/index.ts`
 * (globbed lazily by main.tsx / pages.ts) stays as it is.
 */
export {
  ART_PACK_SCHEMA,
  ART_SCHEMA,
  NIGHT_MONTHS,
  STATION_COUNT,
  STATION_FIRST,
  STATION_LAST,
  parseArtManifest,
  parseArtPackPointer,
  parsePrintEntry,
  type ArtCalendar,
  type ArtEncoder,
  type ArtManifest,
  type ArtPackAsset,
  type ArtPackPointer,
  type ArtSourceCredit,
  type PrintEntry,
  type PrintOrientation,
  type PrintRoles,
  type PrintSeries,
  type PrintSource,
  type PrintText,
} from './types';
export { altOf, captionOf, koIndexOf, printById, printForStation, printForToday, sourceLine, type PrintCaption } from './select';
export { ART_MANIFEST_URL, artManifest, artStatus, loadArtManifest, resetArtForTests, useArtManifest, type ArtStatus } from './load';
export { ART_ROOT, PrintFigure, focusPosition, printSrc, type PrintFigureProps, type PrintState, type PrintVariant } from './PrintFigure';
export { S as PRINT_S } from './strings';
export { FIXTURE_IDS, FIXTURE_LQIP, makeFixtureManifest, makeFixtureManifestJson, makeFixturePrint } from './fixtures';
