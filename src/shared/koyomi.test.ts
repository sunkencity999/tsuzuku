import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findBanned } from '@/i18n/banned-phrases';
import { SKY_STOPS as ROOM_SKY_STOPS, seasonOf as roomSeasonOf, skyPhase as roomSkyPhase } from '@/art/dojo/room';
import {
  BOUNDARY_HOURS,
  KO_COUNT,
  LAMP_ALPHA,
  MOON_IDS,
  MOON_NAMES,
  PIGMENT_TOKENS,
  SEKKI,
  SEKKI_BY_ID,
  SEKKI_IDS,
  SEKKI_MIX_MAX,
  SEKKI_PIGMENTS,
  SKY_STOPS,
  fetchKoyomi,
  koOf,
  koyomiData,
  loadKoyomi,
  moonJa,
  moonPhase,
  nextBoundary,
  nextBoundaryMs,
  parseKoyomi,
  resetKoyomiForTests,
  seasonOf,
  sekkiJa,
  sekkiOf,
  sekkiSpanOf,
  skyPhase,
  type KoyomiData,
} from './koyomi';
import type { EpochDay } from './store-types';
import { civilToDay, dayToCivil, localToMs } from './time';

const JSON_PATH = resolve(process.cwd(), 'public/calendar/koyomi.json');
const raw = (): unknown => JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const d = (y: number, m: number, day: number): EpochDay => civilToDay({ year: y, month: m, day });
const at = (tz: string, y: number, m: number, day: number, h: number, min = 0): number => localToMs({ year: y, month: m, day }, h, min, tz);
const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
const isCjk = (s: string): boolean => /[㐀-䶿一-鿿豈-﫿]/u.test(s);

let data: KoyomiData;
beforeEach(() => {
  resetKoyomiForTests();
  data = loadKoyomi(raw());
});
afterEach(() => resetKoyomiForTests());

describe('skyPhase / seasonOf / SKY_STOPS (moved from art/dojo/room.ts, byte-identical until B1 switches the import)', () => {
  it('agrees with room.ts for every hour, every month and every sky stop', () => {
    for (let h = -3; h < 30; h++) expect(skyPhase(h), `hour ${h}`).toBe(roomSkyPhase(h));
    expect(skyPhase(Number.NaN)).toBe('day');
    for (let m = 0; m <= 13; m++) expect(seasonOf(m), `month ${m}`).toBe(roomSeasonOf(m));
    expect(seasonOf(Number.NaN)).toBe('spring');
    expect(SKY_STOPS).toEqual(ROOM_SKY_STOPS);
    expect(LAMP_ALPHA).toEqual({ day: 0, dawn: 0.15, dusk: 0.35, night: 0.6 });
  });
});

describe('the twenty-four sekki (design 09 §4.3)', () => {
  it('24 rows in the traditional order with unique ids, fixed dates, and a pigment mixed at most 3 %', () => {
    expect(SEKKI).toHaveLength(24);
    expect(new Set(SEKKI_IDS).size).toBe(24);
    SEKKI.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(SEKKI_BY_ID[s.id]).toBe(s);
      expect(PIGMENT_TOKENS).toContain(s.pigment);
      expect(s.mix, s.id).toBeGreaterThan(0);
      expect(s.mix, s.id).toBeLessThanOrEqual(SEKKI_MIX_MAX);
      expect(Number.isInteger(s.mix), s.id).toBe(true);
      expect(SEKKI_PIGMENTS[s.id]).toEqual({ pigment: s.pigment, mix: s.mix });
      expect(isCjk(s.id) || isCjk(s.romaji) || isCjk(s.en), 'no Japanese glyph in src').toBe(false);
    });
    expect(SEKKI_MIX_MAX).toBe(3);
    // the spec's named anchors
    expect(SEKKI_BY_ID.risshun).toMatchObject({ month: 2, dayOfMonth: 4, pigment: 'sakura', mix: 2 });
    expect(SEKKI_BY_ID.seimei).toMatchObject({ month: 4, dayOfMonth: 5, pigment: 'matcha', mix: 2 });
    expect(SEKKI_BY_ID.taisho).toMatchObject({ month: 7, dayOfMonth: 23, pigment: 'kin', mix: 2 });
    expect(SEKKI_BY_ID.soukou).toMatchObject({ month: 10, dayOfMonth: 24, pigment: 'hai', mix: 3, en: 'frost falls' });
    expect(SEKKI_BY_ID.touji).toMatchObject({ month: 12, dayOfMonth: 22, pigment: 'kon', mix: 3 });
  });

  it('snapshot: all 24 with their Japanese names from the JSON', () => {
    expect(SEKKI.map((s) => ({ ...s, ja: sekkiJa(s.id) }))).toMatchSnapshot();
  });

  it('sekkiOf: the latest fixed start on or before the date; 1–5 January belong to 冬至 of the previous December', () => {
    expect(sekkiOf(d(2026, 2, 3)).id).toBe('daikan');
    expect(sekkiOf(d(2026, 2, 4)).id).toBe('risshun');
    expect(sekkiOf(d(2026, 2, 18)).id).toBe('risshun');
    expect(sekkiOf(d(2026, 2, 19)).id).toBe('usui');
    expect(sekkiOf(d(2026, 10, 18)).id).toBe('kanro');
    expect(sekkiOf(d(2026, 10, 24)).id).toBe('soukou');
    expect(sekkiOf(d(2026, 12, 22)).id).toBe('touji');
    expect(sekkiOf(d(2026, 12, 31)).id).toBe('touji');
    expect(sekkiOf(d(2027, 1, 1)).id).toBe('touji');
    expect(sekkiOf(d(2027, 1, 5)).id).toBe('touji');
    expect(sekkiOf(d(2027, 1, 6)).id).toBe('shoukan');
    expect(sekkiOf(d(2027, 1, 20)).id).toBe('daikan');
  });

  it('sekkiSpanOf brackets every day of a leap year and of a common year, spans are 14–16 days, and the year closes on itself', () => {
    for (const year of [2026, 2028]) {
      const start = d(year, 1, 1);
      const days = year === 2028 ? 366 : 365;
      let distinct = 0;
      let prev = '';
      for (let i = 0; i < days; i++) {
        const day = start + i;
        const span = sekkiSpanOf(day);
        expect(span.from, String(day)).toBeLessThanOrEqual(day);
        expect(span.to, String(day)).toBeGreaterThan(day);
        expect(span.to - span.from).toBeGreaterThanOrEqual(14);
        expect(span.to - span.from).toBeLessThanOrEqual(16);
        expect(sekkiOf(span.from)).toBe(span.sekki);
        expect(sekkiOf(span.to).index).toBe((span.sekki.index + 1) % 24);
        if (span.sekki.id !== prev) {
          distinct++;
          prev = span.sekki.id;
        }
      }
      // 冬至 opens the year and closes it: 25 runs, 24 distinct sekki
      expect(distinct).toBe(25);
    }
    expect(sekkiSpanOf(d(2027, 1, 3))).toEqual({ sekki: SEKKI_BY_ID.touji, from: d(2026, 12, 22), to: d(2027, 1, 6) });
    expect(sekkiSpanOf(d(2026, 1, 25))).toEqual({ sekki: SEKKI_BY_ID.daikan, from: d(2026, 1, 20), to: d(2026, 2, 4) });
  });
});

describe('the seventy-two kō', () => {
  it('five-day steps inside each sekki: 72 distinct kō over a year, each named from the JSON, in order', () => {
    const seen = new Map<number, ReturnType<typeof koOf>>();
    const start = d(2026, 2, 4);
    for (let i = 0; i < 365; i++) {
      const k = koOf(start + i);
      expect(k.sekki).toBe(sekkiOf(start + i).id);
      expect(k.index).toBe(SEKKI_BY_ID[k.sekki].index * 3 + k.step);
      expect(k.fromDay).toBeLessThanOrEqual(start + i);
      expect(k.from).toEqual(dayToCivil(k.fromDay));
      expect(k.ja).toBe(data.ko[k.index]!.ja);
      if (!seen.has(k.index)) seen.set(k.index, k);
    }
    expect(seen.size).toBe(KO_COUNT);
    expect(Array.from(seen.keys())).toEqual(Array.from({ length: 72 }, (_, i) => i));
  });

  it('snapshot: the 72 kō with ja, romaji, gloss and start date', () => {
    const rows: { index: number; sekki: string; step: number; from: string; ja: string | null; romaji: string | null; en: string | null }[] = [];
    const start = d(2026, 2, 4);
    let last = -1;
    for (let i = 0; i < 365; i++) {
      const k = koOf(start + i);
      if (k.index !== last) {
        rows.push({ index: k.index, sekki: k.sekki, step: k.step, from: `${k.from.month}/${k.from.day}`, ja: k.ja, romaji: k.romaji, en: k.en });
        last = k.index;
      }
    }
    expect(rows).toHaveLength(72);
    expect(rows).toMatchSnapshot();
  });

  it('the third kō absorbs a sixteen-day sekki; a known day resolves to its kō', () => {
    // 寒露 Oct 8 → Oct 24: steps on 8, 13, 18; Oct 23 is still the third kō
    expect(koOf(d(2026, 10, 8))).toMatchObject({ sekki: 'kanro', step: 0, from: { month: 10, day: 8 } });
    expect(koOf(d(2026, 10, 13))).toMatchObject({ sekki: 'kanro', step: 1 });
    expect(koOf(d(2026, 10, 18))).toMatchObject({ sekki: 'kanro', step: 2, index: 50, ja: '蟋蟀在戸', romaji: 'kirigirisu to ni ari', en: 'crickets sing at the door' });
    expect(koOf(d(2026, 10, 23))).toMatchObject({ sekki: 'kanro', step: 2 });
    expect(koOf(d(2026, 10, 24))).toMatchObject({ sekki: 'soukou', step: 0, index: 51 });
  });

  it('without data the position is known and the names are null; injected data wins over the cache', () => {
    resetKoyomiForTests();
    expect(koyomiData()).toBeNull();
    const k = koOf(d(2026, 10, 18));
    expect(k).toMatchObject({ index: 50, sekki: 'kanro', step: 2, ja: null, romaji: null, en: null });
    expect(sekkiJa('kanro')).toBeNull();
    expect(moonJa('full')).toBeNull();
    expect(koOf(d(2026, 10, 18), data).ja).toBe('蟋蟀在戸');
  });
});

describe('public/calendar/koyomi.json', () => {
  it('parses: a note saying the calendar is traditional and approximate, 24 sekki names, 72 kō, 8 moon names, every Japanese name is Japanese', () => {
    expect(data.note).toMatch(/^Traditional calendar, approximate\./);
    expect(Object.keys(data.sekki).sort()).toEqual([...SEKKI_IDS].sort());
    expect(data.ko).toHaveLength(72);
    expect(Object.keys(data.moon).sort()).toEqual([...MOON_IDS].sort());
    for (const id of SEKKI_IDS) expect(isCjk(data.sekki[id]), id).toBe(true);
    for (const id of MOON_IDS) expect(isCjk(data.moon[id]), id).toBe(true);
    for (const k of data.ko) {
      expect(isCjk(k.ja), k.ja).toBe(true);
      expect(isCjk(k.romaji) || isCjk(k.en), k.ja).toBe(false);
    }
    expect(data.sekki.risshun).toBe('立春');
    expect(data.sekki.soukou).toBe('霜降');
    expect(data.moon.new).toBe('新月');
    expect(data.moon.full).toBe('満月');
  });

  it('the glosses are in the Sensei voice: no banned phrase, no exclamation mark, no countdown, lowercase phrases', () => {
    const texts = [data.note, ...data.ko.flatMap((k) => [k.en, k.romaji]), ...SEKKI.map((s) => s.en), ...MOON_IDS.map((m) => MOON_NAMES[m].en)];
    for (const t of texts) {
      expect(findBanned(t).map((h) => h.rule.source), t).toEqual([]);
      expect(t, t).not.toMatch(/!/);
      expect(t, t).not.toMatch(/\bin \d+ days?\b/i);
    }
    // lowercase phrases (a proper noun such as "Japanese" may open one)
    for (const k of data.ko) expect(k.en, k.en).toMatch(/^(?:[a-z]|Japanese )/);
  });

  it('parseKoyomi rejects a malformed document and never caches it', () => {
    resetKoyomiForTests();
    expect(() => parseKoyomi(null)).toThrow(/not an object/);
    expect(() => parseKoyomi({})).toThrow(/note/);
    const bad = JSON.parse(JSON.stringify(raw())) as { ko: unknown[] };
    bad.ko = bad.ko.slice(0, 71);
    expect(() => parseKoyomi(bad)).toThrow(/72/);
    expect(koyomiData()).toBeNull();
  });

  it('fetchKoyomi fetches once, shares the request, caches, and resolves null on a failed fetch (retry allowed)', async () => {
    resetKoyomiForTests();
    const ok = vi.fn(async () => ({ ok: true, json: async () => raw() }) as unknown as Response);
    const [a, b] = await Promise.all([fetchKoyomi(ok as unknown as typeof fetch), fetchKoyomi(ok as unknown as typeof fetch)]);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledWith('./calendar/koyomi.json');
    expect(a).toBe(b);
    expect(a?.ko).toHaveLength(72);
    expect(await fetchKoyomi(ok as unknown as typeof fetch)).toBe(a);
    expect(ok).toHaveBeenCalledTimes(1);
    resetKoyomiForTests();
    const fail = vi.fn(async () => ({ ok: false }) as unknown as Response);
    expect(await fetchKoyomi(fail as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchKoyomi(boom as unknown as typeof fetch)).toBeNull();
    expect(koyomiData()).toBeNull();
    expect(await fetchKoyomi(ok as unknown as typeof fetch)).not.toBeNull();
  });
});

describe('the moon', () => {
  it('eight names with romaji and English in src, Japanese in the JSON', () => {
    expect(MOON_IDS).toHaveLength(8);
    for (const id of MOON_IDS) {
      expect(MOON_NAMES[id].romaji.length).toBeGreaterThan(0);
      expect(MOON_NAMES[id].en.length).toBeGreaterThan(0);
      expect(isCjk(MOON_NAMES[id].romaji) || isCjk(MOON_NAMES[id].en)).toBe(false);
      expect(moonJa(id)).toBe(data.moon[id]);
    }
  });

  it('matches the real sky: full on 2026-01-03, new on 2026-01-18, half (waxing) on 2026-10-18, full on 2026-10-26', () => {
    expect(moonPhase(d(2026, 1, 3)).name).toBe('full');
    expect(moonPhase(d(2026, 1, 18)).name).toBe('new');
    expect(moonPhase(d(2026, 10, 18)).name).toBe('first-quarter');
    expect(moonPhase(d(2026, 10, 26)).name).toBe('full');
    const m = moonPhase(d(2026, 1, 18));
    expect(m.illumination).toBeLessThan(0.01);
    // the real new moon fell at 19:52 UTC, after the noon sample: the age sits at the very end of the cycle
    expect(m.age).toBeGreaterThan(29.4);
  });

  it('snapshot: 30 consecutive days from 2026-01-15 (DEFAULT_TEST_NOW) walk through every name once in order', () => {
    const start = d(2026, 1, 15);
    const days = Array.from({ length: 30 }, (_, i) => ({ day: start + i, date: dayToCivil(start + i), ...moonPhase(start + i), ja: moonJa(moonPhase(start + i).name) }));
    for (const row of days) {
      expect(row.fraction).toBeGreaterThanOrEqual(0);
      expect(row.fraction).toBeLessThan(1);
      expect(row.illumination).toBeGreaterThanOrEqual(0);
      expect(row.illumination).toBeLessThanOrEqual(1);
    }
    const order = days.map((r) => r.name).filter((n, i, a) => i === 0 || n !== a[i - 1]);
    expect(new Set(order).size).toBe(8);
    expect(days).toMatchSnapshot();
  });
});

describe('nextBoundaryMs (05 / 08 / 17 / 20 h and the 04:00 day roll)', () => {
  it('the boundary hours are 4, 5, 8, 17, 20', () => {
    expect(BOUNDARY_HOURS).toEqual([4, 5, 8, 17, 20]);
  });

  it('Asia/Tokyo (no DST): plain wall-clock distances, strictly after now', () => {
    expect(nextBoundaryMs(at(TOKYO, 2026, 10, 18, 12), TOKYO)).toBe(5 * 3_600_000);
    expect(nextBoundaryMs(at(TOKYO, 2026, 10, 18, 17), TOKYO)).toBe(3 * 3_600_000);
    expect(nextBoundaryMs(at(TOKYO, 2026, 10, 18, 20), TOKYO)).toBe(8 * 3_600_000);
    expect(nextBoundaryMs(at(TOKYO, 2026, 10, 18, 3, 59), TOKYO)).toBe(60_000);
    expect(nextBoundaryMs(at(TOKYO, 2026, 10, 18, 4), TOKYO)).toBe(3_600_000);
    expect(nextBoundary(at(TOKYO, 2026, 10, 18, 4), TOKYO)).toEqual({ at: at(TOKYO, 2026, 10, 18, 5), hour: 5 });
    expect(nextBoundary(at(TOKYO, 2026, 10, 18, 23), TOKYO)).toEqual({ at: at(TOKYO, 2026, 10, 19, 4), hour: 4 });
  });

  it('America/Los_Angeles spring forward (2026-03-08): 01:00 → 04:00 is two real hours, not three', () => {
    const now = at(LA, 2026, 3, 8, 1);
    expect(nextBoundaryMs(now, LA)).toBe(2 * 3_600_000);
    expect(new Date(nextBoundary(now, LA).at).toISOString()).toBe('2026-03-08T11:00:00.000Z');
    // the evening before the switch: 20:00 → 04:00 is seven real hours
    expect(nextBoundaryMs(at(LA, 2026, 3, 7, 20), LA)).toBe(7 * 3_600_000);
  });

  it('America/Los_Angeles fall back (2026-11-01): 00:30 PDT → 04:00 PST is four and a half real hours', () => {
    const now = at(LA, 2026, 11, 1, 0, 30);
    expect(nextBoundaryMs(now, LA)).toBe(4.5 * 3_600_000);
    expect(new Date(nextBoundary(now, LA).at).toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(nextBoundaryMs(at(LA, 2026, 10, 31, 20), LA)).toBe(9 * 3_600_000);
  });

  it('is always positive and lands exactly on a boundary hour in both zones across a whole year, minute by minute at the edges', () => {
    for (const tz of [LA, TOKYO]) {
      for (let i = 0; i < 365; i++) {
        const day = d(2026, 1, 1) + i;
        const c = dayToCivil(day);
        for (const [h, m] of [
          [3, 59],
          [4, 0],
          [7, 59],
          [16, 59],
          [19, 59],
          [23, 59],
        ] as const) {
          const now = at(tz, c.year, c.month, c.day, h, m);
          const b = nextBoundary(now, tz);
          expect(b.at, `${tz} ${c.year}-${c.month}-${c.day} ${h}:${m}`).toBeGreaterThan(now);
          expect(b.at - now).toBeLessThanOrEqual(9 * 3_600_000 + 60_000);
          expect(BOUNDARY_HOURS).toContain(b.hour);
        }
      }
    }
  });

  it('works without a zone (host clock)', () => {
    const ms = nextBoundaryMs(Date.UTC(2026, 0, 15, 12));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(9 * 3_600_000);
  });
});
