/**
 * types.ts — the manifest parser: the fixture parses whole, unknown fields drop, focus clamps, the digest lower-cases;
 * every malformation (schema, rows, paths, LQIP, roles, the 55 stops, the 72 / 12 calendar slots) returns null; the pointer too.
 */
import { KO_COUNT } from '../../shared/koyomi';
import { makeFixtureManifest, makeFixtureManifestJson, makeFixturePrint } from './fixtures';
import { ART_PACK_SCHEMA, ART_SCHEMA, NIGHT_MONTHS, STATION_COUNT, parseArtManifest, parseArtPackPointer, parsePrintEntry } from './types';

type J = Record<string, unknown>;
const json = (): J => makeFixtureManifestJson();
const prints = (m: J): J[] => m.prints as J[];
const first = (m: J): J => prints(m)[0]!;
const stations = (m: J): J => m.stations as J;
const calendar = (m: J): { day: string[]; night: string[] } => m.calendar as { day: string[]; night: string[] };

describe('parseArtManifest: a good document', () => {
  it('parses the fixture whole and equals the typed fixture', () => {
    const parsed = parseArtManifest(json());
    expect(parsed).toEqual(makeFixtureManifest());
    expect(parsed?.schema).toBe(ART_SCHEMA);
    expect(Object.keys(parsed!.stations)).toHaveLength(STATION_COUNT);
    expect(parsed?.calendar.day).toHaveLength(KO_COUNT);
    expect(parsed?.calendar.night).toHaveLength(NIGHT_MONTHS);
  });

  it('drops unknown fields at every level and copies the rest', () => {
    const m = json();
    m.extra = 1;
    first(m).extra = 'x';
    (first(m).source as J).extra = true;
    const parsed = parseArtManifest(m)!;
    expect(parsed).not.toBeNull();
    expect('extra' in parsed).toBe(false);
    expect('extra' in parsed.prints[0]!).toBe(false);
    expect('extra' in parsed.prints[0]!.source).toBe(false);
  });

  it('clamps focus into 0..1 and lower-cases the digest', () => {
    const m = json();
    first(m).focus = [1.4, -0.2];
    first(m).sha256 = (first(m).sha256 as string).toUpperCase();
    const p = parseArtManifest(m)!.prints[0]!;
    expect(p.focus).toEqual([1, 0]);
    expect(p.sha256).toBe(p.sha256.toLowerCase());
  });

  it('roles are optional and validated when present', () => {
    const m = json();
    delete first(m).roles;
    const parsed = parseArtManifest(m)!;
    expect('roles' in parsed.prints[0]!).toBe(false);
    expect(parsed.prints[1]!.roles).toEqual({ station: 1 });
    expect(parsed.prints[3]!.roles?.nightMonths).toHaveLength(12);
  });

  it('accepts nested relative paths and an empty reading, credit or accession', () => {
    const m = json();
    first(m).file = 'prints/sub/x.webp';
    (first(m).title as J).reading = '';
    const parsed = parseArtManifest(m)!;
    expect(parsed.prints[0]!.file).toBe('prints/sub/x.webp');
    expect(parsed.prints[2]!.source.creditLine).toBe('');
  });
});

describe('parseArtManifest: null on anything malformed', () => {
  it.each([null, undefined, 'x', 1, [], true])('%s is not a manifest', (raw) => {
    expect(parseArtManifest(raw)).toBeNull();
  });

  const cases: [string, (m: J) => void][] = [
    ['the schema is another pack', (m) => void (m.schema = 'tsuzuku.art/2')],
    ['the schema is the audio pack', (m) => void (m.schema = 'tsuzuku.audio/1')],
    ['artVersion is blank', (m) => void (m.artVersion = ' ')],
    ['generatedAt is missing', (m) => void delete m.generatedAt],
    ['the encoder is missing', (m) => void delete m.encoder],
    ['the encoder has no tool', (m) => void ((m.encoder as J).tool = '')],
    ['sources is not a list', (m) => void (m.sources = {})],
    ['a source has no license', (m) => void ((m.sources as J[])[0]!.license = '')],
    ['prints is empty', (m) => void (m.prints = [])],
    ['prints is not a list', (m) => void (m.prints = {})],
    ['two prints share an id', (m) => void (prints(m)[1]!.id = first(m).id)],
    ['a print row is not an object', (m) => void (prints(m)[1] = 'x' as unknown as J)],
    ['a print has no id', (m) => void (first(m).id = '')],
    ['the digest is short', (m) => void (first(m).sha256 = 'abc')],
    ['the digest is not hex', (m) => void (first(m).sha256 = 'g'.repeat(64))],
    ['the file is an absolute path', (m) => void (first(m).file = '/prints/x.webp')],
    ['the file is a URL', (m) => void (first(m).file = 'https://example.invalid/x.webp')],
    ['the file climbs out', (m) => void (first(m).file = '../x.webp')],
    ['the file climbs out midway', (m) => void (first(m).file = 'prints/../x.webp')],
    ['the file has whitespace', (m) => void (first(m).file = 'prints/a b.webp')],
    ['the LQIP is a URL', (m) => void (first(m).lqip = 'https://example.invalid/a.webp')],
    ['the LQIP is not base64', (m) => void (first(m).lqip = 'data:image/svg+xml,<svg/>')],
    ['the LQIP carries a paren', (m) => void (first(m).lqip = 'data:image/webp;base64,AA")')],
    ['focus has three parts', (m) => void (first(m).focus = [0.5, 0.5, 0.5])],
    ['focus is not numeric', (m) => void (first(m).focus = ['a', 0.5])],
    ['the orientation is unknown', (m) => void (first(m).orientation = 'square')],
    ['width is zero', (m) => void (first(m).width = 0)],
    ['bytes is negative', (m) => void (first(m).bytes = -1)],
    ['a title has no English', (m) => void ((first(m).title as J).en = '')],
    ['a title has no Japanese', (m) => void ((first(m).title as J).ja = '')],
    ['the artist is not an object', (m) => void (first(m).artist = 'x')],
    ['the series has no id', (m) => void ((first(m).series as J).id = '')],
    ['the source has no license', (m) => void ((first(m).source as J).license = '')],
    ['the source has no museum', (m) => void ((first(m).source as J).museum = '')],
    ['the objectId is a string', (m) => void ((first(m).source as J).objectId = '1')],
    ['the date is a number', (m) => void (first(m).date = 1833)],
    ['roles is not an object', (m) => void (first(m).roles = 'x')],
    ['roles.station is past the arrival', (m) => void (first(m).roles = { station: 55 })],
    ['roles.station is negative', (m) => void (first(m).roles = { station: -1 })],
    ['roles.kos is past 71', (m) => void (first(m).roles = { kos: [72] })],
    ['roles.kos is not a list', (m) => void (first(m).roles = { kos: 3 })],
    ['roles.nightMonths has a month 0', (m) => void (first(m).roles = { nightMonths: [0] })],
    ['roles.nightMonths has a month 13', (m) => void (first(m).roles = { nightMonths: [13] })],
    ['stations is not an object', (m) => void (m.stations = [])],
    ['a stop is missing (54)', (m) => void delete stations(m)['54']],
    ['a stop is missing (0)', (m) => void delete stations(m)['0']],
    ['a stop names no print', (m) => void (stations(m)['3'] = 'nope')],
    ['the calendar is missing', (m) => void delete m.calendar],
    ['the day table is short', (m) => void calendar(m).day.pop()],
    ['the day table is long', (m) => void calendar(m).day.push('fx-01-river')],
    ['a day slot names no print', (m) => void (calendar(m).day[51] = 'nope')],
    ['the night table is short', (m) => void calendar(m).night.pop()],
    ['a night slot names no print', (m) => void (calendar(m).night[11] = 'nope')],
  ];

  it.each(cases)('%s', (_name, mutate) => {
    const m = json();
    mutate(m);
    expect(parseArtManifest(m)).toBeNull();
  });
});

describe('parsePrintEntry', () => {
  it('parses one row and leaves roles out when absent', () => {
    const p = makeFixturePrint({ id: 'solo-01-x' });
    const parsed = parsePrintEntry(JSON.parse(JSON.stringify(p)))!;
    expect(parsed).toEqual(p);
    expect('roles' in parsed).toBe(false);
  });

  it('returns null for a non-object', () => {
    expect(parsePrintEntry(null)).toBeNull();
    expect(parsePrintEntry([])).toBeNull();
  });
});

describe('parseArtPackPointer', () => {
  const pointer = (): J => ({
    schema: ART_PACK_SCHEMA,
    repo: 'sunkencity999/tsuzuku',
    artVersion: 'p-0123456789',
    tag: 'art-p-0123456789',
    assets: [{ tier: 'prints', name: 'tsuzuku-art-p-0123456789.tar', sha256: 'ab'.repeat(32), bytes: 10 }],
    credits: ['Art Institute of Chicago · CC0'],
  });

  it('parses the committed pointer', () => {
    const p = parseArtPackPointer(pointer())!;
    expect(p.tag).toBe('art-p-0123456789');
    expect(p.assets[0]?.name).toBe('tsuzuku-art-p-0123456789.tar');
    expect(p.credits).toHaveLength(1);
  });

  it('returns null on the audio pointer, a bad digest, or a credit that is not text', () => {
    expect(parseArtPackPointer({ ...pointer(), schema: 'tsuzuku.audio-pack/1' })).toBeNull();
    expect(parseArtPackPointer({ ...pointer(), assets: [{ tier: 'prints', name: 'x.tar', sha256: 'nope', bytes: 1 }] })).toBeNull();
    expect(parseArtPackPointer({ ...pointer(), credits: [1] })).toBeNull();
    expect(parseArtPackPointer({ ...pointer(), assets: {} })).toBeNull();
    expect(parseArtPackPointer(null)).toBeNull();
  });
});
