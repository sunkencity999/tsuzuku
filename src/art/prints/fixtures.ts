/**
 * TSUZUKU — a fixture print pack (prints B1) for tests and dry mounts: four
 * prints — two landscapes, one portrait, one night scene — with ASCII
 * placeholder names (fonts.test.ts walks this file: no Japanese glyph enters
 * src by way of a fixture; the series' reading differs from its `ja` so a
 * caption test can tell the two apart), the full 55-stop stations table and
 * the full 72-day / 12-night calendar, filled cyclically. The LQIP is a real
 * 1 × 1 WebP.
 */
import { KO_COUNT } from '../../shared/koyomi';
import { ART_SCHEMA, NIGHT_MONTHS, STATION_COUNT, type ArtManifest, type PrintEntry } from './types';

export const FIXTURE_LQIP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

export const FIXTURE_IDS = {
  river: 'fx-01-river',
  bridge: 'fx-02-bridge',
  pine: 'fx-03-pine',
  snow: 'fx-04-snow',
} as const;

/** 64 hex from a one-character seed. */
const sha = (seed: string): string => `${seed}0123456789abcdef`.repeat(4).slice(0, 64);

/** One valid print; pass any field to override it. */
export function makeFixturePrint(over: Partial<PrintEntry> & { id: string }): PrintEntry {
  const digest = sha(over.id.charCodeAt(over.id.length - 1).toString(16).slice(-1));
  return {
    file: `prints/${over.id}-${digest.slice(0, 8)}.webp`,
    bytes: 123_456,
    sha256: digest,
    width: 1400,
    height: 897,
    orientation: 'landscape',
    lqip: FIXTURE_LQIP,
    focus: [0.5, 0.42],
    artist: { ja: 'Fixture Eshi', reading: 'Fixture Eshi', en: 'Fixture Artist' },
    title: { ja: 'Kawa no asa', reading: 'Kawa no asa', en: 'Morning on the river' },
    series: { id: 'fx', ja: 'Fixture no uchi', reading: 'Fikusucha no uchi', en: 'The fixture series' },
    date: 'c. 1833-34',
    source: { museum: 'Fixture Museum', objectId: 1, url: 'https://example.invalid/artworks/1', accession: '0000.1', creditLine: 'Gift of the fixture', license: 'CC0 1.0' },
    ...over,
  };
}

/** A complete, valid manifest: three day prints turn through the kō, the snow scene serves every night. */
export function makeFixtureManifest(): ArtManifest {
  const prints: PrintEntry[] = [
    makeFixturePrint({ id: FIXTURE_IDS.river, roles: { station: 0, kos: [0, 3, 6] } }),
    makeFixturePrint({
      id: FIXTURE_IDS.bridge,
      height: 960,
      focus: [0.4, 0.5],
      title: { ja: 'Hashi no yu', reading: 'Hashi no yu', en: 'Evening at the bridge' },
      source: { museum: 'Fixture Museum', objectId: 2, url: 'https://example.invalid/artworks/2', accession: '0000.2', creditLine: 'Fixture collection', license: 'CC0 1.0' },
      roles: { station: 1 },
    }),
    makeFixturePrint({
      id: FIXTURE_IDS.pine,
      width: 940,
      height: 1400,
      orientation: 'portrait',
      focus: [0.5, 0.3],
      title: { ja: 'Matsu', reading: 'Matsu', en: 'A pine' },
      source: { museum: 'Fixture Museum', objectId: 3, url: 'https://example.invalid/artworks/3', accession: '', creditLine: '', license: 'CC0 1.0' },
    }),
    makeFixturePrint({
      id: FIXTURE_IDS.snow,
      height: 900,
      title: { ja: 'Yoru no yuki', reading: 'Yoru no yuki', en: 'Evening snow' },
      roles: { nightMonths: Array.from({ length: NIGHT_MONTHS }, (_, i) => i + 1) },
    }),
  ];
  const ids = prints.map((p) => p.id);
  const dayIds = [FIXTURE_IDS.river, FIXTURE_IDS.bridge, FIXTURE_IDS.pine];
  const stations: Record<string, string> = {};
  for (let n = 0; n < STATION_COUNT; n++) stations[String(n)] = ids[n % ids.length]!;
  return {
    schema: ART_SCHEMA,
    artVersion: 'p-0123456789',
    generatedAt: '2026-10-28T00:00:00.000Z',
    encoder: { tool: 'cwebp', quality: 82, width: 1400, lqip: 24 },
    sources: [{ museum: 'Fixture Museum', license: 'CC0 1.0', url: 'https://example.invalid/open-access' }],
    prints,
    stations,
    calendar: {
      day: Array.from({ length: KO_COUNT }, (_, i) => dayIds[i % dayIds.length]!),
      night: Array.from({ length: NIGHT_MONTHS }, () => FIXTURE_IDS.snow),
    },
  };
}

/** The fixture as a plain JSON document (what a fetch would hand the parser). */
export function makeFixtureManifestJson(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(makeFixtureManifest())) as Record<string, unknown>;
}
