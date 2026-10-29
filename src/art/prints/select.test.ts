/**
 * select.ts — the kō index from the fixed sekki table (Feb 4 = 0, Oct 28 = 51, Jan 20..Feb 3 = 69..71, equal to koOf
 * all year), today's print by phase and month, the station print, the caption parts and the alt text.
 */
import { KO_COUNT, koOf, skyPhase, type SkyPhase } from '../../shared/koyomi';
import type { EpochDay } from '../../shared/store-types';
import { civilToDay } from '../../shared/time';
import { FIXTURE_IDS, makeFixtureManifest, makeFixturePrint } from './fixtures';
import { altOf, captionOf, koIndexOf, printById, printForStation, printForToday, sourceLine } from './select';

const d = (y: number, m: number, day: number): EpochDay => civilToDay({ year: y, month: m, day });

describe('koIndexOf', () => {
  it('Risshun (Feb 4) opens the year at 0; the day before is the last kō, 71', () => {
    expect(koIndexOf(d(2026, 2, 4))).toBe(0);
    expect(koIndexOf(d(2026, 2, 3))).toBe(71);
    expect(koIndexOf(d(2027, 2, 4))).toBe(0);
  });

  it('Oct 28 2026 is the first kō of Sōkō, 51; the steps follow at five days', () => {
    expect(koIndexOf(d(2026, 10, 24))).toBe(51);
    expect(koIndexOf(d(2026, 10, 28))).toBe(51);
    expect(koIndexOf(d(2026, 10, 29))).toBe(52);
    expect(koIndexOf(d(2026, 11, 3))).toBe(53);
    expect(koIndexOf(d(2026, 11, 6))).toBe(53);
    expect(koIndexOf(d(2026, 11, 7))).toBe(54);
  });

  it('Jan 20..Feb 3 (Daikan) are 69, 70, 71', () => {
    for (let day = 20; day <= 24; day++) expect(koIndexOf(d(2026, 1, day))).toBe(69);
    for (let day = 25; day <= 29; day++) expect(koIndexOf(d(2026, 1, day))).toBe(70);
    for (const [m, day] of [[1, 30], [1, 31], [2, 1], [2, 2], [2, 3]] as const) expect(koIndexOf(d(2026, m, day))).toBe(71);
  });

  it('the third kō absorbs the sixteenth day: Feb 14..18 are all 2, Feb 19 (Usui) is 3', () => {
    for (let day = 14; day <= 18; day++) expect(koIndexOf(d(2026, 2, day))).toBe(2);
    expect(koIndexOf(d(2026, 2, 19))).toBe(3);
  });

  it('agrees with koOf without names over two whole years (one of them leap) and never leaves 0..71', () => {
    for (const year of [2026, 2028]) {
      for (let day = d(year, 1, 1); day <= d(year, 12, 31); day++) {
        const i = koIndexOf(day);
        expect(i).toBe(koOf(day, null).index);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(KO_COUNT);
      }
    }
  });

  it('a non-finite day still yields an index in range', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const i = koIndexOf(bad);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(KO_COUNT);
    }
  });
});

describe('printForToday', () => {
  const today = d(2026, 10, 28);

  it('day, dawn and dusk hang the kō print from the day table', () => {
    const m = makeFixtureManifest();
    const want = m.calendar.day[koIndexOf(today)];
    expect(want).toBeDefined();
    for (const phase of ['day', 'dawn', 'dusk'] as SkyPhase[]) {
      const p = printForToday(m, today, phase);
      expect(p?.id).toBe(want);
      expect(p?.id).not.toBe(FIXTURE_IDS.snow);
    }
  });

  it('night hangs the month print: October reads slot 9, January slot 0, and skyPhase(23) is night', () => {
    const m = makeFixtureManifest();
    m.calendar.night[9] = FIXTURE_IDS.bridge;
    m.calendar.night[0] = FIXTURE_IDS.pine;
    expect(printForToday(m, today, 'night')?.id).toBe(FIXTURE_IDS.bridge);
    expect(printForToday(m, d(2026, 1, 15), 'night')?.id).toBe(FIXTURE_IDS.pine);
    expect(printForToday(m, d(2026, 12, 31), skyPhase(23))?.id).toBe(FIXTURE_IDS.snow);
    expect(printForToday(m, d(2026, 12, 31), skyPhase(12))?.id).not.toBe(FIXTURE_IDS.snow);
  });

  it('a night slot that names no print falls back to the day print; a day slot that names none is null', () => {
    const m = makeFixtureManifest();
    m.calendar.night[9] = 'nope';
    expect(printForToday(m, today, 'night')?.id).toBe(m.calendar.day[koIndexOf(today)]);
    m.calendar.day[koIndexOf(today)] = 'nope';
    expect(printForToday(m, today, 'day')).toBeNull();
    expect(printForToday(m, today, 'night')).toBeNull();
  });

  it('is deterministic: the same day and phase always hang the same print', () => {
    const m = makeFixtureManifest();
    const a = printForToday(m, today, 'day');
    for (let i = 0; i < 5; i++) expect(printForToday(m, today, 'day')).toBe(a);
  });
});

describe('printForStation', () => {
  it('0, 11 and 54 resolve through the stations table', () => {
    const m = makeFixtureManifest();
    for (const n of [0, 11, 54]) expect(printForStation(m, n)?.id).toBe(m.stations[String(n)]);
    expect(printForStation(m, 0)?.id).toBe(FIXTURE_IDS.river);
  });

  it('off the road is null: -1, 55, a fraction, NaN', () => {
    const m = makeFixtureManifest();
    for (const n of [-1, 55, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(printForStation(m, n)).toBeNull();
  });

  it('a stop that names no print is null', () => {
    const m = makeFixtureManifest();
    m.stations['7'] = 'nope';
    expect(printForStation(m, 7)).toBeNull();
  });
});

describe('printById', () => {
  it('finds a print, returns null for an unknown or missing id, and keeps one map per manifest', () => {
    const m = makeFixtureManifest();
    const a = printById(m, FIXTURE_IDS.pine);
    expect(a?.orientation).toBe('portrait');
    expect(printById(m, FIXTURE_IDS.pine)).toBe(a);
    expect(printById(m, 'nope')).toBeNull();
    expect(printById(m, undefined)).toBeNull();
  });
});

describe('captionOf / altOf / sourceLine', () => {
  it('names every part of the caption and formats the credit as "<museum>, <credit> <accession> · <license>"', () => {
    const p = makeFixturePrint({
      id: 'hoeido-11-mishima',
      artist: { ja: 'ARTIST-JA', reading: 'Utagawa Hiroshige', en: 'Utagawa Hiroshige' },
      title: { ja: 'TITLE-JA', reading: 'Mishima, asagiri', en: 'Mishima: Morning Mist' },
      series: { id: 'hoeido', ja: 'SERIES-JA', reading: 'Tokaido gojusan tsugi no uchi', en: 'Fifty-three Stations of the Tokaido (Hoeido edition)' },
      date: 'c. 1833-34',
      source: { museum: 'Art Institute of Chicago', objectId: 10926, url: 'https://www.artic.edu/artworks/10926', accession: '1932.170', creditLine: 'Gift of H. R. Warner', license: 'CC0 1.0' },
    });
    expect(captionOf(p)).toEqual({
      artistJa: 'ARTIST-JA',
      artistEn: 'Utagawa Hiroshige',
      titleJa: 'TITLE-JA',
      titleReading: 'Mishima, asagiri',
      titleEn: 'Mishima: Morning Mist',
      seriesJa: 'SERIES-JA',
      seriesReading: 'Tokaido gojusan tsugi no uchi',
      seriesEn: 'Fifty-three Stations of the Tokaido (Hoeido edition)',
      date: 'c. 1833-34',
      source: 'Art Institute of Chicago, Gift of H. R. Warner 1932.170 · CC0 1.0',
    });
    expect(altOf(p)).toBe('Utagawa Hiroshige, Mishima: Morning Mist');
  });

  it('drops a blank credit line or accession without leaving a dangling comma', () => {
    const base = makeFixturePrint({ id: 'x-01-y' }).source;
    expect(sourceLine({ ...base, creditLine: '', accession: '' })).toBe('Fixture Museum · CC0 1.0');
    expect(sourceLine({ ...base, creditLine: '' })).toBe('Fixture Museum, 0000.1 · CC0 1.0');
    expect(sourceLine({ ...base, accession: ' ' })).toBe('Fixture Museum, Gift of the fixture · CC0 1.0');
  });
});
