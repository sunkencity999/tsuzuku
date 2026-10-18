/**
 * TSUZUKU — koyomi, the traditional calendar (design 09 §4.3, §7 H, §8).
 *
 * Pure and snapshot-tested: no DOM, no store, no clock of its own. Everything
 * is a function of an `EpochDay` (shared/time.ts, the 04:00 learner day) or of
 * an explicit `(nowMs, tz)`.
 *
 *  skyPhase / seasonOf   moved here from art/dojo/room.ts (room.ts keeps its
 *                        copy until B1 switches the import); SKY_STOPS and
 *                        LAMP_ALPHA are the runtime values theme.ts writes
 *                        into --sky-* / --lamp-alpha.
 *  sekkiOf(day)          the 24 sekki at fixed Gregorian month/day pairs, each
 *                        with an id, romaji, English, and the paper pigment
 *                        (token + mix, never over SEKKI_MIX_MAX = 3 %).
 *  koOf(day)             the 72 kō as five-day steps inside each sekki; the
 *                        names and glosses come from public/calendar/koyomi.json
 *                        (loadKoyomi / fetchKoyomi), never from this file.
 *  moonPhase(day)        synodic month from the new moon of 2000-01-06 18:14 UTC,
 *                        eight names (ids, romaji, English here; Japanese in the JSON).
 *  nextBoundaryMs        the earliest of the next 05 / 08 / 17 / 20 h sky change
 *                        and the 04:00 day roll in the profile zone.
 *
 * No Japanese glyph lives in this module, comments included: the sekki, kō
 * and moon names are data in `public/calendar/koyomi.json` (design 09 §3.5,
 * §4.3), so the font inventory test (src/styles/fonts.test.ts, which walks
 * every .ts file under src as text) never sees them and A3 does not wait on A4. The label a learner reads says
 * "traditional calendar, approximate" (the JSON's `note`): the real sekki
 * boundaries drift ± 1 day by year, and nothing unlocks on them.
 */
import type { EpochDay } from './store-types';
import { DAY_BOUNDARY_HOUR, MS_PER_DAY, civilParts, civilToDay, dayToCivil, localToMs, type CivilDate } from './time';

/* ────────────────────────────────────────────────────────────────────────── */
/* Sky and season (from room.ts)                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 05–07 dawn · 08–16 day · 17–19 dusk · else night (local hour). */
export function skyPhase(hour: number): SkyPhase {
  if (!Number.isFinite(hour)) return 'day';
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h <= 7) return 'dawn';
  if (h >= 8 && h <= 16) return 'day';
  if (h >= 17 && h <= 19) return 'dusk';
  return 'night';
}

/** 3–5 spring · 6–8 summer · 9–11 autumn · 12–2 winter (month 1–12). */
export function seasonOf(month: number): Season {
  if (!Number.isFinite(month)) return 'spring';
  const m = ((((Math.round(month) - 1) % 12) + 12) % 12) + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

/** The local hours at which `skyPhase` changes. */
export const PHASE_HOURS: readonly number[] = [5, 8, 17, 20];

/** Sky gradient stops, top → horizon (design 09 §4.1 `--sky-top/--sky-mid/--sky-horizon`). */
export const SKY_STOPS: Record<SkyPhase, readonly [top: string, mid: string, horizon: string]> = {
  dawn: ['#1F3A93', '#C9718A', '#F7B2C4'],
  day: ['#4F6FD6', '#9FC4F0', '#F4EDE0'],
  dusk: ['#1F2A6B', '#C9302C', '#E0B341'],
  night: ['#0A0F2E', '#1F2A6B', '#1F3A93'],
};

/** `--lamp-alpha` per phase (design 09 §4.1): 0 day · .15 dawn · .35 dusk · .6 night. */
export const LAMP_ALPHA: Record<SkyPhase, number> = { day: 0, dawn: 0.15, dusk: 0.35, night: 0.6 };

/* ────────────────────────────────────────────────────────────────────────── */
/* The twenty-four sekki                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type SekkiId =
  | 'risshun'
  | 'usui'
  | 'keichitsu'
  | 'shunbun'
  | 'seimei'
  | 'kokuu'
  | 'rikka'
  | 'shouman'
  | 'boushu'
  | 'geshi'
  | 'shousho'
  | 'taisho'
  | 'risshuu'
  | 'shosho'
  | 'hakuro'
  | 'shuubun'
  | 'kanro'
  | 'soukou'
  | 'rittou'
  | 'shousetsu'
  | 'taisetsu'
  | 'touji'
  | 'shoukan'
  | 'daikan';

/** Colour tokens a sekki may tint the paper with (`--sekki-pigment: var(--<token>)`). */
export type PigmentToken = 'sakura' | 'matcha' | 'kin' | 'hai' | 'kon' | 'ai' | 'shu';
export const PIGMENT_TOKENS: readonly PigmentToken[] = ['sakura', 'matcha', 'kin', 'hai', 'kon', 'ai', 'shu'];

/** The ceiling on `--sekki-mix`, in percent (design 09 §4.2: every contrast pair stays ≥ 4.5 at 3 %). */
export const SEKKI_MIX_MAX = 3;

export interface Sekki {
  id: SekkiId;
  /** 0 Risshun … 23 Daikan, the traditional order. */
  index: number;
  /** With macrons, for display beside the Japanese name. */
  romaji: string;
  en: string;
  /** Fixed Gregorian start (traditional calendar, approximate). */
  month: number;
  dayOfMonth: number;
  pigment: PigmentToken;
  /** Percent of pigment mixed into the paper, ≤ `SEKKI_MIX_MAX`. */
  mix: number;
}

function sekki(index: number, id: SekkiId, romaji: string, en: string, month: number, dayOfMonth: number, pigment: PigmentToken, mix: number): Sekki {
  return { id, index, romaji, en, month, dayOfMonth, pigment, mix };
}

/** The 24-row table (design 09 §4.3), in the traditional order from Risshun. */
export const SEKKI: readonly Sekki[] = [
  sekki(0, 'risshun', 'Risshun', 'spring begins', 2, 4, 'sakura', 2),
  sekki(1, 'usui', 'Usui', 'rain water', 2, 19, 'ai', 2),
  sekki(2, 'keichitsu', 'Keichitsu', 'insects awaken', 3, 6, 'matcha', 1),
  sekki(3, 'shunbun', 'Shunbun', 'spring equinox', 3, 21, 'sakura', 3),
  sekki(4, 'seimei', 'Seimei', 'clear and bright', 4, 5, 'matcha', 2),
  sekki(5, 'kokuu', 'Kokuu', 'grain rain', 4, 20, 'ai', 2),
  sekki(6, 'rikka', 'Rikka', 'summer begins', 5, 6, 'matcha', 3),
  sekki(7, 'shouman', 'Shōman', 'grain fills', 5, 21, 'matcha', 2),
  sekki(8, 'boushu', 'Bōshu', 'grain in ear', 6, 6, 'kin', 1),
  sekki(9, 'geshi', 'Geshi', 'summer solstice', 6, 21, 'kin', 1),
  sekki(10, 'shousho', 'Shōsho', 'lesser heat', 7, 7, 'kin', 1),
  sekki(11, 'taisho', 'Taisho', 'greater heat', 7, 23, 'kin', 2),
  sekki(12, 'risshuu', 'Risshū', 'autumn begins', 8, 8, 'kin', 1),
  sekki(13, 'shosho', 'Shosho', 'heat eases', 8, 23, 'hai', 1),
  sekki(14, 'hakuro', 'Hakuro', 'white dew', 9, 8, 'hai', 1),
  sekki(15, 'shuubun', 'Shūbun', 'autumn equinox', 9, 23, 'shu', 1),
  sekki(16, 'kanro', 'Kanro', 'cold dew', 10, 8, 'shu', 2),
  sekki(17, 'soukou', 'Sōkō', 'frost falls', 10, 24, 'hai', 3),
  sekki(18, 'rittou', 'Rittō', 'winter begins', 11, 7, 'kon', 2),
  sekki(19, 'shousetsu', 'Shōsetsu', 'lesser snow', 11, 22, 'hai', 2),
  sekki(20, 'taisetsu', 'Taisetsu', 'greater snow', 12, 7, 'kon', 2),
  sekki(21, 'touji', 'Tōji', 'winter solstice', 12, 22, 'kon', 3),
  sekki(22, 'shoukan', 'Shōkan', 'lesser cold', 1, 6, 'ai', 2),
  sekki(23, 'daikan', 'Daikan', 'greater cold', 1, 20, 'hai', 2),
];

export const SEKKI_IDS: readonly SekkiId[] = SEKKI.map((s) => s.id);
export const SEKKI_BY_ID: Readonly<Record<SekkiId, Sekki>> = Object.fromEntries(SEKKI.map((s) => [s.id, s])) as Record<SekkiId, Sekki>;

/** id → pigment token and mix percent: the table `src/styles/tokens.test.ts` loops over (A1). */
export const SEKKI_PIGMENTS: Readonly<Record<SekkiId, { pigment: PigmentToken; mix: number }>> = Object.fromEntries(
  SEKKI.map((s) => [s.id, { pigment: s.pigment, mix: s.mix }]),
) as Record<SekkiId, { pigment: PigmentToken; mix: number }>;

const monthDay = (month: number, day: number): number => month * 100 + day;

/** The sekki whose fixed start is the latest one on or before the day's calendar date. */
export function sekkiOf(day: EpochDay): Sekki {
  const c = dayToCivil(day);
  const md = monthDay(c.month, c.day);
  let found: Sekki | null = null;
  for (const s of SEKKI) {
    const smd = monthDay(s.month, s.dayOfMonth);
    if (smd <= md && (found === null || smd > monthDay(found.month, found.dayOfMonth))) found = s;
  }
  // 1–5 January belong to Tōji, which started the previous December.
  return found ?? SEKKI_BY_ID.touji;
}

export interface SekkiSpan {
  sekki: Sekki;
  /** First day of the sekki. */
  from: EpochDay;
  /** First day of the next sekki (exclusive end). */
  to: EpochDay;
}

/** The sekki containing `day` with its start and (exclusive) end as learner days. */
export function sekkiSpanOf(day: EpochDay): SekkiSpan {
  const s = sekkiOf(day);
  const c = dayToCivil(day);
  const fromYear = monthDay(s.month, s.dayOfMonth) > monthDay(c.month, c.day) ? c.year - 1 : c.year;
  const next = SEKKI[(s.index + 1) % SEKKI.length]!;
  const toYear = monthDay(next.month, next.dayOfMonth) <= monthDay(s.month, s.dayOfMonth) ? fromYear + 1 : fromYear;
  return {
    sekki: s,
    from: civilToDay({ year: fromYear, month: s.month, day: s.dayOfMonth }),
    to: civilToDay({ year: toYear, month: next.month, day: next.dayOfMonth }),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The seventy-two kō                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export const KO_COUNT = 72;
export const KO_PER_SEKKI = 3;
/** A kō is a five-day step; the third kō of a sekki absorbs the sixteenth day. */
export const KO_STEP_DAYS = 5;

export interface KoName {
  ja: string;
  romaji: string;
  en: string;
}

export interface Ko {
  /** 0–71 in the traditional order (Risshun's first kō is 0). */
  index: number;
  sekki: SekkiId;
  /** 0, 1 or 2 inside the sekki. */
  step: 0 | 1 | 2;
  /** The kō's first calendar date (shown as a date, never as "in N days"). */
  from: CivilDate;
  fromDay: EpochDay;
  /** From `koyomi.json`; `null` until the data is loaded. */
  ja: string | null;
  romaji: string | null;
  en: string | null;
}

/* ── the JSON (public/calendar/koyomi.json) ────────────────────────────── */

export type MoonId = 'new' | 'waxing-crescent' | 'first-quarter' | 'waxing-gibbous' | 'full' | 'waning-gibbous' | 'last-quarter' | 'waning-crescent';
export const MOON_IDS: readonly MoonId[] = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'];

export interface KoyomiData {
  /** "Traditional calendar, approximate" — the label's honesty line. */
  note: string;
  /** Sekki id → Japanese name. */
  sekki: Readonly<Record<SekkiId, string>>;
  /** The 72 kō in order. */
  ko: readonly KoName[];
  /** Moon id → Japanese name. */
  moon: Readonly<Record<MoonId, string>>;
}

export const KOYOMI_URL = './calendar/koyomi.json';

let loaded: KoyomiData | null = null;
let pending: Promise<KoyomiData | null> | null = null;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/** Validates the JSON shape (throws on a bad document); never caches. */
export function parseKoyomi(raw: unknown): KoyomiData {
  if (!isRecord(raw)) throw new Error('koyomi: document is not an object');
  if (!nonEmpty(raw.note)) throw new Error('koyomi: missing note');
  if (!isRecord(raw.sekki)) throw new Error('koyomi: missing sekki names');
  const sekkiNames: Partial<Record<SekkiId, string>> = {};
  for (const id of SEKKI_IDS) {
    const v = raw.sekki[id];
    if (!nonEmpty(v)) throw new Error(`koyomi: missing sekki name for ${id}`);
    sekkiNames[id] = v;
  }
  if (!Array.isArray(raw.ko) || raw.ko.length !== KO_COUNT) throw new Error(`koyomi: expected ${KO_COUNT} ko`);
  const ko: KoName[] = raw.ko.map((k: unknown, i: number) => {
    if (!isRecord(k) || !nonEmpty(k.ja) || !nonEmpty(k.romaji) || !nonEmpty(k.en)) throw new Error(`koyomi: bad ko at ${i}`);
    return { ja: k.ja, romaji: k.romaji, en: k.en };
  });
  if (!isRecord(raw.moon)) throw new Error('koyomi: missing moon names');
  const moonNames: Partial<Record<MoonId, string>> = {};
  for (const id of MOON_IDS) {
    const v = raw.moon[id];
    if (!nonEmpty(v)) throw new Error(`koyomi: missing moon name for ${id}`);
    moonNames[id] = v;
  }
  return { note: raw.note, sekki: sekkiNames as Record<SekkiId, string>, ko, moon: moonNames as Record<MoonId, string> };
}

/** Injects the data (tests read the file from disk; the browser goes through `fetchKoyomi`). */
export function loadKoyomi(raw: unknown): KoyomiData {
  loaded = parseKoyomi(raw);
  return loaded;
}

/** The loaded data, or `null` before `loadKoyomi` / `fetchKoyomi` resolved. */
export function koyomiData(): KoyomiData | null {
  return loaded;
}

/** Tests: forget the loaded data and any in-flight fetch. */
export function resetKoyomiForTests(): void {
  loaded = null;
  pending = null;
}

/**
 * Fetches `public/calendar/koyomi.json` once and caches it; concurrent callers
 * share the request; a failed fetch resolves `null` (the labels fall back to
 * romaji and English) and lets a later call retry.
 */
export function fetchKoyomi(fetchImpl?: typeof fetch, url: string = KOYOMI_URL): Promise<KoyomiData | null> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  const f = fetchImpl ?? (typeof fetch === 'function' ? (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) : null);
  if (!f) return Promise.resolve(null);
  pending = (async (): Promise<KoyomiData | null> => {
    try {
      const res = await f(url);
      if (!res.ok) return null;
      return loadKoyomi(await res.json());
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** The kō containing `day`, named when the data is loaded (or passed in). */
export function koOf(day: EpochDay, data: KoyomiData | null = loaded): Ko {
  const span = sekkiSpanOf(day);
  const offset = Math.max(0, day - span.from);
  const step = Math.min(KO_PER_SEKKI - 1, Math.floor(offset / KO_STEP_DAYS)) as 0 | 1 | 2;
  const index = span.sekki.index * KO_PER_SEKKI + step;
  const fromDay = span.from + step * KO_STEP_DAYS;
  const name = data?.ko[index] ?? null;
  return {
    index,
    sekki: span.sekki.id,
    step,
    from: dayToCivil(fromDay),
    fromDay,
    ja: name?.ja ?? null,
    romaji: name?.romaji ?? null,
    en: name?.en ?? null,
  };
}

/** Japanese name of a sekki from the data (`null` until loaded). */
export function sekkiJa(id: SekkiId, data: KoyomiData | null = loaded): string | null {
  return data?.sekki[id] ?? null;
}

/** Japanese name of a moon phase from the data (`null` until loaded). */
export function moonJa(id: MoonId, data: KoyomiData | null = loaded): string | null {
  return data?.moon[id] ?? null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The moon                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** Mean synodic month, days. */
export const SYNODIC_DAYS = 29.530588;
/** A reference new moon: 2000-01-06 18:14 UTC. */
export const MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);

export const MOON_NAMES: Readonly<Record<MoonId, { romaji: string; en: string }>> = {
  new: { romaji: 'shingetsu', en: 'new moon' },
  'waxing-crescent': { romaji: 'mikazuki', en: 'crescent moon, waxing' },
  'first-quarter': { romaji: 'hangetsu', en: 'half moon, waxing' },
  'waxing-gibbous': { romaji: 'jūsan’ya', en: 'gibbous moon, waxing' },
  full: { romaji: 'mangetsu', en: 'full moon' },
  'waning-gibbous': { romaji: 'izayoi', en: 'gibbous moon, waning' },
  'last-quarter': { romaji: 'nijūsan’ya', en: 'half moon, waning' },
  'waning-crescent': { romaji: 'nijūrokuya', en: 'crescent moon, waning' },
};

export interface MoonPhase {
  /** 0 new → .5 full → 1 new again, at the day's noon UTC; 4 decimals. */
  fraction: number;
  /** Days since the last new moon, 2 decimals. */
  age: number;
  /** Lit share of the disc, 0–1, 3 decimals. */
  illumination: number;
  name: MoonId;
  romaji: string;
  en: string;
}

const round = (x: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(x * k) / k;
};

/** The phase at the day's noon UTC; eight equal slices centred on new, half, full and the quarters between. */
export function moonPhase(day: EpochDay): MoonPhase {
  const at = day * MS_PER_DAY + MS_PER_DAY / 2;
  const cycles = (at - MOON_EPOCH_MS) / (SYNODIC_DAYS * MS_PER_DAY);
  const fraction = cycles - Math.floor(cycles);
  const slot = Math.floor(((fraction + 1 / 16) % 1) * 8);
  const name = MOON_IDS[slot]!;
  return {
    fraction: round(fraction, 4),
    age: round(fraction * SYNODIC_DAYS, 2),
    illumination: round((1 - Math.cos(2 * Math.PI * fraction)) / 2, 3),
    name,
    romaji: MOON_NAMES[name].romaji,
    en: MOON_NAMES[name].en,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Boundaries                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** The wall-clock hours at which the document re-applies the calendar: the 04:00 day roll and the four sky changes. */
export const BOUNDARY_HOURS: readonly number[] = [DAY_BOUNDARY_HOUR, ...PHASE_HOURS].sort((a, b) => a - b);

export interface Boundary {
  /** The instant, ms. */
  at: number;
  /** The wall-clock hour it falls on (4, 5, 8, 17 or 20). */
  hour: number;
}

/** The earliest boundary strictly after `now` in `tz` (or the host zone); DST-safe through `localToMs`. */
export function nextBoundary(now: number, tz?: string): Boundary {
  const p = civilParts(now, tz);
  const today: CivilDate = { year: p.year, month: p.month, day: p.day };
  const tomorrow = dayToCivil(civilToDay(today) + 1);
  let best: Boundary | null = null;
  for (const c of [today, tomorrow]) {
    for (const hour of BOUNDARY_HOURS) {
      const at = localToMs(c, hour, 0, tz);
      if (at > now && (best === null || at < best.at)) best = { at, hour };
    }
  }
  // Two civil days always hold a future boundary; the fallback only guards an impossible zone.
  return best ?? { at: now + MS_PER_DAY, hour: DAY_BOUNDARY_HOUR };
}

/** Milliseconds from `now` to the next 05 / 08 / 17 / 20 h or 04:00 boundary in `tz`. Always > 0. */
export function nextBoundaryMs(now: number, tz?: string): number {
  return Math.max(1, nextBoundary(now, tz).at - now);
}
