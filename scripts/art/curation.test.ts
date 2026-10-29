/**
 * TSUZUKU — the curation files as a whole (design 09 §3 prints; docs/ART_PACK.md §4).
 *
 * `scripts/art/curation/*.json` merged exactly as source-prints merges them,
 * with no network: every station, kō and month served and nothing claimed
 * twice; no print on both the day and the night table; every museum object
 * id used once across the files; the day table at least two-thirds landscape
 * (the yoko-e series hoeido, fugaku36, kisokaido and omi8 — edo100 is
 * tate-e); at most twelve Hōeidō station sheets borrowed by the calendar;
 * every title's reading in Latin letters (it is what the learner says) with
 * no middle dot inside it — the caption joins artist, reading and gloss with
 * one, so a reading carrying its own would blur into the separators (the
 * concept writes "Kanbara, yoru no yuki"); and each calendar entry's roles
 * agreeing with the explicit tables. The
 * Japanese titles stay in the JSON — this file holds none.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CurationFile, KO_COUNT, MONTH_COUNT, STATION_COUNT } from './schema.ts';
import { mergeCuration, readCurationDir, tableGaps } from './source-prints.ts';

const CURATION_DIR = join(dirname(fileURLToPath(import.meta.url)), 'curation');
/** Series printed as yoko-e (wider than tall); every other series counts as portrait. */
const LANDSCAPE_SERIES = new Set(['hoeido', 'fugaku36', 'kisokaido', 'omi8']);
/** The calendar may borrow this many Hōeidō station sheets (the brief's cap). */
const HOEIDO_CAP = 12;
/** Latin letters with macrons, digits, spaces and the punctuation a romanised title carries — never the middle dot, which is the caption's separator. */
const READING_RE = /^[A-Za-z0-9ĀāĒēĪīŌōŪū][A-Za-z0-9ĀāĒēĪīŌōŪū '’,.:()-]*$/;

const files = readCurationDir(CURATION_DIR);
const merged = mergeCuration(files);
const byId = new Map(merged.entries.map((e) => [e.id, e]));
const calendarFile = files.find((f) => f.name === 'calendar.json')?.json as CurationFile | undefined;

describe('curation — the merged tables', () => {
  it('serves every station, kō and month with nothing claimed twice', () => {
    expect(tableGaps(merged)).toEqual([]);
    expect(Object.keys(merged.stations)).toHaveLength(STATION_COUNT);
    expect(merged.calendar.day).toHaveLength(KO_COUNT);
    expect(merged.calendar.night).toHaveLength(MONTH_COUNT);
  });

  it('puts no print on both the day and the night table', () => {
    const day = new Set(merged.calendar.day);
    const both = merged.calendar.night.filter((id) => day.has(id));
    expect(both).toEqual([]);
  });

  it('uses every museum object id once across the files', () => {
    const seen = new Map<number, string>();
    for (const e of merged.entries) {
      expect(seen.get(e.aicId), `AIC ${e.aicId} is ${e.id} and ${seen.get(e.aicId)}`).toBeUndefined();
      seen.set(e.aicId, e.id);
    }
  });

  it('keeps the day table at least two-thirds landscape and borrows at most twelve Hōeidō sheets', () => {
    const landscape = merged.calendar.day.filter((id) => LANDSCAPE_SERIES.has(byId.get(id as string)?.series ?? '')).length;
    expect(landscape).toBeGreaterThanOrEqual(Math.ceil((KO_COUNT * 2) / 3));
    const borrowed = new Set([...merged.calendar.day, ...merged.calendar.night].filter((id) => byId.get(id as string)?.series === 'hoeido'));
    expect(borrowed.size).toBeLessThanOrEqual(HOEIDO_CAP);
    for (const id of borrowed) expect(byId.get(id as string)?.roles?.station, `${id} is not a station sheet`).toBeTypeOf('number');
  });

  it('gives every title and series a reading in Latin letters, beside the Japanese, with no middle dot inside it', () => {
    for (const e of merged.entries) {
      expect(e.title.reading, `${e.id}: a reading with · inside it is indistinguishable from the caption's separators`).not.toContain('·');
      expect(e.title.reading, e.id).toMatch(READING_RE);
      expect(e.title.ja.length, e.id).toBeGreaterThan(0);
      expect(e.title.en.length, e.id).toBeGreaterThan(0);
    }
    for (const [sid, s] of Object.entries(merged.series)) {
      expect(s.reading, sid).toMatch(READING_RE);
      expect(s.artist.reading, sid).toMatch(READING_RE);
    }
  });
});

describe('curation — calendar.json', () => {
  it('exists, names the whole calendar explicitly and defines no series another file owns', () => {
    expect(calendarFile).toBeDefined();
    const cal = calendarFile as CurationFile;
    expect(cal.calendar?.day?.filter((id) => id !== null)).toHaveLength(KO_COUNT);
    expect(cal.calendar?.night?.filter((id) => id !== null)).toHaveLength(MONTH_COUNT);
    expect(Object.keys(cal.series)).not.toContain('hoeido');
    expect(JSON.parse(readFileSync(join(CURATION_DIR, 'calendar.json'), 'utf8')).schema).toBe('tsuzuku.art-curation/1');
  });

  it('gives each of its entries a calendar role that the tables honour', () => {
    const cal = calendarFile as CurationFile;
    for (const e of cal.entries) {
      const kos = e.roles?.kos ?? [];
      const months = e.roles?.nightMonths ?? [];
      expect(kos.length + months.length, `${e.id} serves nothing`).toBeGreaterThan(0);
      for (const k of kos) expect(merged.calendar.day[k], `${e.id} kō ${k}`).toBe(e.id);
      for (const m of months) expect(merged.calendar.night[m - 1], `${e.id} month ${m}`).toBe(e.id);
      expect(e.why.length, e.id).toBeGreaterThan(0);
      expect(e.why).not.toMatch(/\n/);
    }
  });
});
