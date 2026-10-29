/**
 * TSUZUKU — which print hangs today (prints B1; design 09 §4.3 the calendar,
 * §7 A the arrival). Pure and deterministic: no RNG, no clock, no DOM, no
 * koyomi names — the pick never waits on `koyomi.json`.
 *
 *  koIndexOf(today)              0–71, the kō of a learner day from the fixed
 *                                sekki table (`koOf` with no data): Risshun's
 *                                first kō is 0, Daikan's last is 71.
 *  printForToday(m, today, ph)   `calendar.day[kō]` by day, dawn and dusk;
 *                                `calendar.night[month − 1]` at night (the day
 *                                print when the night slot names no print).
 *  printForStation(m, n)         `stations[n]`, 0 Nihonbashi … 54 the arrival.
 *  captionOf(p) / altOf(p)       the caption's parts (every Japanese line with
 *                                its reading and English) and the alt text.
 */
import { KO_COUNT, koOf, type SkyPhase } from '../../shared/koyomi';
import type { EpochDay } from '../../shared/store-types';
import { dayToCivil } from '../../shared/time';
import { STATION_FIRST, STATION_LAST, type ArtManifest, type PrintEntry, type PrintSource } from './types';

const byId = new WeakMap<ArtManifest, Map<string, PrintEntry>>();

/** The print with this id, through an id → entry map built once per manifest object. */
export function printById(m: ArtManifest, id: string | undefined): PrintEntry | null {
  if (!id) return null;
  let map = byId.get(m);
  if (!map) {
    map = new Map(m.prints.map((p) => [p.id, p]));
    byId.set(m, map);
  }
  return map.get(id) ?? null;
}

const safeDay = (today: EpochDay): EpochDay => (Number.isFinite(today) ? Math.floor(today) : 0);

/** The kō index 0–71 of a learner day (`sekki.index × 3 + step`), always in range. */
export function koIndexOf(today: EpochDay): number {
  const i = koOf(safeDay(today), null).index;
  return Math.min(KO_COUNT - 1, Math.max(0, i));
}

/** Today's print: the kō's by day (dawn and dusk included), the month's at night. */
export function printForToday(m: ArtManifest, today: EpochDay, phase: SkyPhase): PrintEntry | null {
  const dayPrint = printById(m, m.calendar.day[koIndexOf(today)]);
  if (phase !== 'night') return dayPrint;
  const month = dayToCivil(safeDay(today)).month;
  return printById(m, m.calendar.night[month - 1]) ?? dayPrint;
}

/** The print that heads stop `n` (0–54); `null` off the road. */
export function printForStation(m: ArtManifest, n: number): PrintEntry | null {
  if (!Number.isInteger(n) || n < STATION_FIRST || n > STATION_LAST) return null;
  return printById(m, m.stations[String(n)]);
}

export interface PrintCaption {
  artistJa: string;
  artistEn: string;
  titleJa: string;
  titleReading: string;
  titleEn: string;
  seriesJa: string;
  /** The series' romaji ('Tōkaidō gojūsan tsugi no uchi'); every Japanese line the learner meets carries one. */
  seriesReading: string;
  seriesEn: string;
  date: string;
  /** "Art Institute of Chicago, Gift of H. R. Warner 1932.170 · CC0 1.0" */
  source: string;
}

/** `<museum>, <creditLine> <accession> · <license>`, dropping the parts a source leaves blank. */
export function sourceLine(s: PrintSource): string {
  const credit = [s.creditLine, s.accession].filter((x) => x.trim().length > 0).join(' ');
  const who = [s.museum, credit].filter((x) => x.length > 0).join(', ');
  return `${who} · ${s.license}`;
}

export function captionOf(p: PrintEntry): PrintCaption {
  return {
    artistJa: p.artist.ja,
    artistEn: p.artist.en,
    titleJa: p.title.ja,
    titleReading: p.title.reading,
    titleEn: p.title.en,
    seriesJa: p.series.ja,
    seriesReading: p.series.reading,
    seriesEn: p.series.en,
    date: p.date,
    source: sourceLine(p.source),
  };
}

/** The English alt text: "Utagawa Hiroshige, Mishima: Morning Mist". */
export function altOf(p: PrintEntry): string {
  return `${p.artist.en}, ${p.title.en}`;
}
