/**
 * TSUZUKU — the print pack's manifest: types and parser (prints B1; design 09
 * §2 paper, §3 type — the runtime side of the pack contract).
 *
 * `public/art/manifest.json` (`tsuzuku.art/1`) is a release asset fetched at
 * build like the voice pack, so the browser reads it as untrusted data.
 * `parseArtManifest` checks the whole shape — the schema string, every print
 * row's fields, that `stations` names all 55 stops (0 Nihonbashi … 54 the
 * arrival at Kyoto) and that every id the stations and calendar tables point
 * at is a print in the pack — and returns `null` on anything malformed, so a
 * surface has either a complete gallery or none. File paths stay relative
 * (`prints/<id>-<sha8>.webp` under `public/art/`): an absolute path, a scheme
 * or a `..` segment fails the parse. The LQIP must be an inline base64
 * `data:image/…` URI (it becomes a `background-image`). A `focus` outside
 * 0..1 is clamped, not rejected. No Japanese glyph lives in this file:
 * artists, titles and series names are data in the manifest (fonts.test.ts
 * walks src as text).
 */
import { KO_COUNT } from '../../shared/koyomi';

export const ART_SCHEMA = 'tsuzuku.art/1';
export const ART_PACK_SCHEMA = 'tsuzuku.art-pack/1';
/** Stops a print may head: 0 Nihonbashi, 1–53 the stations, 54 Kyoto (Sanjō Ōhashi, the Road's END_NUMBER). */
export const STATION_FIRST = 0;
export const STATION_LAST = 54;
export const STATION_COUNT = STATION_LAST - STATION_FIRST + 1;
/** The night table has one print per month. */
export const NIGHT_MONTHS = 12;

export type PrintOrientation = 'landscape' | 'portrait';

/** A Japanese name with its reading and English gloss: the teaching voice never shows one without the other two. */
export interface PrintText {
  ja: string;
  reading: string;
  en: string;
}

export interface PrintSeries extends PrintText {
  id: string;
}

export interface PrintSource {
  museum: string;
  objectId: number;
  url: string;
  accession: string;
  creditLine: string;
  license: string;
}

export interface PrintRoles {
  /** 0–54: the stop this print heads. */
  station?: number;
  /** Kō indexes 0–71 it serves by day. */
  kos?: number[];
  /** Months 1–12 it serves at night. */
  nightMonths?: number[];
}

export interface PrintEntry {
  /** Stable slug `<series>-<nn>-<name>`. */
  id: string;
  /** Relative to `public/art/`: `prints/<id>-<sha8>.webp`, content-addressed. */
  file: string;
  bytes: number;
  /** 64 hex, lower-cased by the parser. */
  sha256: string;
  width: number;
  height: number;
  orientation: PrintOrientation;
  /** A 24 px wide `data:image/webp;base64,…` preview. */
  lqip: string;
  /** `[x, y]` in 0..1: the focal point of a cover crop. */
  focus: [number, number];
  artist: PrintText;
  title: PrintText;
  series: PrintSeries;
  date: string;
  source: PrintSource;
  roles?: PrintRoles;
}

export interface ArtEncoder {
  tool: string;
  quality: number;
  width: number;
  lqip: number;
}

export interface ArtSourceCredit {
  museum: string;
  license: string;
  url: string;
}

export interface ArtCalendar {
  /** 72 print ids, index = kō 0–71 (kō index = sekki.index × 3 + step, sekki 0 = Risshun). */
  day: string[];
  /** 12 print ids, index = month − 1. */
  night: string[];
}

export interface ArtManifest {
  schema: typeof ART_SCHEMA;
  /** `p-<10 hex>` over the merged curation and the encoder settings. */
  artVersion: string;
  generatedAt: string;
  encoder: ArtEncoder;
  sources: ArtSourceCredit[];
  prints: PrintEntry[];
  /** `"0"` … `"54"` → print id, every key present. */
  stations: Record<string, string>;
  calendar: ArtCalendar;
}

export interface ArtPackAsset {
  tier: string;
  name: string;
  sha256: string;
  bytes: number;
}

/** `public/art-pack.json`: the committed pointer the build fetches the pack by (the shape of `audio-pack.json`). */
export interface ArtPackPointer {
  schema: typeof ART_PACK_SCHEMA;
  repo: string;
  artVersion: string;
  tag: string;
  assets: ArtPackAsset[];
  credits: string[];
}

/* ── the parser ─────────────────────────────────────────────────────────── */

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string';
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const positive = (x: unknown): x is number => finite(x) && x > 0;
const intIn = (x: unknown, lo: number, hi: number): x is number => finite(x) && Number.isInteger(x) && x >= lo && x <= hi;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const SHA256_RE = /^[0-9a-f]{64}$/i;
/** A relative path with no scheme, no leading slash, no `..` segment and no whitespace. */
const SAFE_FILE_RE = /^(?!\/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!(?:.*\/)?\.\.(?:\/|$))\S+$/;
/** An inline base64 image, the only thing the figure will put in a `background-image`. */
const LQIP_RE = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+=*$/i;

function textOf(x: unknown): PrintText | null {
  if (!isRecord(x) || !nonEmpty(x.ja) || !isText(x.reading) || !nonEmpty(x.en)) return null;
  return { ja: x.ja, reading: x.reading, en: x.en };
}

function seriesOf(x: unknown): PrintSeries | null {
  const t = textOf(x);
  if (!t || !isRecord(x) || !nonEmpty(x.id)) return null;
  return { id: x.id, ...t };
}

function sourceOf(x: unknown): PrintSource | null {
  if (!isRecord(x) || !nonEmpty(x.museum) || !finite(x.objectId) || !isText(x.url) || !isText(x.accession) || !isText(x.creditLine) || !nonEmpty(x.license)) return null;
  return { museum: x.museum, objectId: x.objectId, url: x.url, accession: x.accession, creditLine: x.creditLine, license: x.license };
}

function intList(x: unknown, lo: number, hi: number): number[] | null {
  if (!Array.isArray(x)) return null;
  const out: number[] = [];
  for (const v of x) {
    if (!intIn(v, lo, hi)) return null;
    out.push(v);
  }
  return out;
}

/** `undefined` when absent, `null` when present and malformed. */
function rolesOf(x: unknown): PrintRoles | null | undefined {
  if (x === undefined) return undefined;
  if (!isRecord(x)) return null;
  const roles: PrintRoles = {};
  if (x.station !== undefined) {
    if (!intIn(x.station, STATION_FIRST, STATION_LAST)) return null;
    roles.station = x.station;
  }
  if (x.kos !== undefined) {
    const kos = intList(x.kos, 0, KO_COUNT - 1);
    if (!kos) return null;
    roles.kos = kos;
  }
  if (x.nightMonths !== undefined) {
    const months = intList(x.nightMonths, 1, NIGHT_MONTHS);
    if (!months) return null;
    roles.nightMonths = months;
  }
  return roles;
}

/** One print row; `null` when any field is missing or malformed. */
export function parsePrintEntry(x: unknown): PrintEntry | null {
  if (!isRecord(x)) return null;
  if (!nonEmpty(x.id) || !nonEmpty(x.file) || !SAFE_FILE_RE.test(x.file)) return null;
  if (!positive(x.bytes) || !positive(x.width) || !positive(x.height)) return null;
  if (!isText(x.sha256) || !SHA256_RE.test(x.sha256)) return null;
  if (x.orientation !== 'landscape' && x.orientation !== 'portrait') return null;
  if (!isText(x.lqip) || !LQIP_RE.test(x.lqip)) return null;
  if (!Array.isArray(x.focus) || x.focus.length !== 2 || !finite(x.focus[0]) || !finite(x.focus[1])) return null;
  const artist = textOf(x.artist);
  const title = textOf(x.title);
  const series = seriesOf(x.series);
  const source = sourceOf(x.source);
  if (!artist || !title || !series || !source || !isText(x.date)) return null;
  const roles = rolesOf(x.roles);
  if (roles === null) return null;
  const entry: PrintEntry = {
    id: x.id,
    file: x.file,
    bytes: x.bytes,
    sha256: x.sha256.toLowerCase(),
    width: x.width,
    height: x.height,
    orientation: x.orientation,
    lqip: x.lqip,
    focus: [clamp01(x.focus[0]), clamp01(x.focus[1])],
    artist,
    title,
    series,
    date: x.date,
    source,
  };
  if (roles) entry.roles = roles;
  return entry;
}

function encoderOf(x: unknown): ArtEncoder | null {
  if (!isRecord(x) || !nonEmpty(x.tool) || !finite(x.quality) || !finite(x.width) || !finite(x.lqip)) return null;
  return { tool: x.tool, quality: x.quality, width: x.width, lqip: x.lqip };
}

function sourcesOf(x: unknown): ArtSourceCredit[] | null {
  if (!Array.isArray(x)) return null;
  const out: ArtSourceCredit[] = [];
  for (const s of x) {
    if (!isRecord(s) || !nonEmpty(s.museum) || !nonEmpty(s.license) || !isText(s.url)) return null;
    out.push({ museum: s.museum, license: s.license, url: s.url });
  }
  return out;
}

/** A list of exactly `length` ids, each a print in `ids`. */
function idList(x: unknown, length: number, ids: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(x) || x.length !== length) return null;
  const out: string[] = [];
  for (const id of x) {
    if (!nonEmpty(id) || !ids.has(id)) return null;
    out.push(id);
  }
  return out;
}

/**
 * The whole manifest, validated and copied field by field (unknown fields are
 * dropped); `null` on any defect — a wrong schema, a bad print row, a
 * duplicate id, a stop or calendar slot that is missing or names no print.
 */
export function parseArtManifest(raw: unknown): ArtManifest | null {
  if (!isRecord(raw) || raw.schema !== ART_SCHEMA) return null;
  if (!nonEmpty(raw.artVersion) || !isText(raw.generatedAt)) return null;
  const encoder = encoderOf(raw.encoder);
  const sources = sourcesOf(raw.sources);
  if (!encoder || !sources) return null;
  if (!Array.isArray(raw.prints) || raw.prints.length === 0) return null;
  const prints: PrintEntry[] = [];
  const ids = new Set<string>();
  for (const row of raw.prints) {
    const p = parsePrintEntry(row);
    if (!p || ids.has(p.id)) return null;
    ids.add(p.id);
    prints.push(p);
  }
  if (!isRecord(raw.stations)) return null;
  const stations: Record<string, string> = {};
  for (let n = STATION_FIRST; n <= STATION_LAST; n++) {
    const id = raw.stations[String(n)];
    if (!nonEmpty(id) || !ids.has(id)) return null;
    stations[String(n)] = id;
  }
  if (!isRecord(raw.calendar)) return null;
  const day = idList(raw.calendar.day, KO_COUNT, ids);
  const night = idList(raw.calendar.night, NIGHT_MONTHS, ids);
  if (!day || !night) return null;
  return { schema: ART_SCHEMA, artVersion: raw.artVersion, generatedAt: raw.generatedAt, encoder, sources, prints, stations, calendar: { day, night } };
}

/** The committed pointer; `null` when it is not a `tsuzuku.art-pack/1` document. */
export function parseArtPackPointer(raw: unknown): ArtPackPointer | null {
  if (!isRecord(raw) || raw.schema !== ART_PACK_SCHEMA) return null;
  if (!nonEmpty(raw.repo) || !nonEmpty(raw.artVersion) || !nonEmpty(raw.tag)) return null;
  if (!Array.isArray(raw.assets) || !Array.isArray(raw.credits)) return null;
  const assets: ArtPackAsset[] = [];
  for (const a of raw.assets) {
    if (!isRecord(a) || !nonEmpty(a.tier) || !nonEmpty(a.name) || !isText(a.sha256) || !SHA256_RE.test(a.sha256) || !positive(a.bytes)) return null;
    assets.push({ tier: a.tier, name: a.name, sha256: a.sha256.toLowerCase(), bytes: a.bytes });
  }
  const credits: string[] = [];
  for (const c of raw.credits) {
    if (!isText(c)) return null;
    credits.push(c);
  }
  return { schema: ART_PACK_SCHEMA, repo: raw.repo, artVersion: raw.artVersion, tag: raw.tag, assets, credits };
}
