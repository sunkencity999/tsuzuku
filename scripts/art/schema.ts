/**
 * TSUZUKU — print pack schema (design 09 §3 prints; runbook docs/ART_PACK.md §1–§3).
 *
 * The three JSON shapes of the print pipeline and the pure helpers every
 * `scripts/art/*` script shares — keep docs/ART_PACK.md and this file in step:
 *
 *  - `ArtManifest`    `public/art/manifest.json` (`tsuzuku.art/1`): every print with its
 *                     content-addressed file, the station table (keys 0..54) and the calendar
 *                     tables (`day` = 72 kō, index sekki.index × 3 + step; `night` = 12 months)
 *  - `ArtPackPointer` `public/art-pack.json` (`tsuzuku.art-pack/1`): the committed pointer the
 *                     build fetches — the same shape as `public/audio-pack.json`, so
 *                     `scripts/audio/fetch-audio-pack.ts` fetches it unchanged
 *  - `CurationFile`   `scripts/art/curation/*.json` (`tsuzuku.art-curation/1`): the hand-picked
 *                     list (ids, museum object ids, titles with reading and gloss, roles) the
 *                     pipeline sources from
 *
 * `artVersionOf` names a pack: sha256 over the merged curation (sorted keys, `why` left out)
 * plus the encoder string — the shipped `encoder` object AND the settings that decide a byte
 * without shipping (cwebp's method, the IIIF source width, the preview quality) — `p-` + 10
 * hex: the id moves when a print, a title, a focus or any encoder setting does, never for a note.
 * `webpDimensions` reads a WebP header (lossy VP8, lossless VP8L, extended VP8X) so the
 * pipeline needs no image library. Japanese titles live in the curation data, never here.
 * Scripts use `node:crypto`; nothing under `src/` imports this file.
 */
import { createHash } from 'node:crypto';

export const MANIFEST_SCHEMA = 'tsuzuku.art/1';
export const PACK_SCHEMA = 'tsuzuku.art-pack/1';
export const CURATION_SCHEMA = 'tsuzuku.art-curation/1';
export const PACK_REPO = 'sunkencity999/tsuzuku';
/** The one tier of the print pack (the voice pack has three). */
export const PACK_TIER = 'prints';
export const releaseTag = (artVersion: string): string => `art-${artVersion}`;
export const assetName = (artVersion: string): string => `tsuzuku-art-${artVersion}.tar`;

/** Stations 0 (Nihonbashi) … 54 (Kyoto, the Road's END_NUMBER). */
export const STATION_COUNT = 55;
/** Kō 0..71 (`src/shared/koyomi.ts` KO_COUNT; index = sekki.index × KO_PER_SEKKI + step, sekki 0 = Risshun). */
export const KO_COUNT = 72;
export const MONTH_COUNT = 12;

/** The encoder settings every print is made with — the manifest's `encoder` object (§3.1, a fixed shape); part of the artVersion. */
export const ENCODER: ArtEncoder = { tool: 'cwebp', quality: 82, width: 1400, lqip: 24 };
/**
 * The rest of what decides a print's bytes — cwebp's `-m`, the width the IIIF JPEG is
 * sourced at (`full/<sourceWidth>,`) and the preview's `-q`. Not in the manifest (the
 * contract's `encoder` object is fixed) but hashed into the artVersion and the encode key
 * beside ENCODER, so a change to any of them re-encodes every print under a new id.
 */
export const ENCODE: EncodeSettings = { method: 6, sourceWidth: 1600, lqipQuality: 40, longSide: true };
/** Budgets (docs/ART_PACK.md §3): a preview stays a short data URI, a print under 400 KB, the pack under 30 MB. */
export const MAX_LQIP_CHARS = 1000;
export const MAX_PRINT_BYTES = 400_000;
export const MAX_PACK_BYTES = 30_000_000;

export const AIC_MUSEUM = 'Art Institute of Chicago';
export const AIC_LICENSE = 'CC0 1.0';
export const AIC_SOURCE: ArtSource = { museum: AIC_MUSEUM, license: AIC_LICENSE, url: 'https://www.artic.edu/open-access/open-access-images' };
/** The pointer's credit list (the release notes repeat it). */
export const CREDITS: readonly string[] = ['Art Institute of Chicago · CC0'];
export const artworkUrl = (objectId: number): string => `https://www.artic.edu/artworks/${objectId}`;

/* ── shapes ────────────────────────────────────────────────────────────── */

/** Every Japanese string the learner meets carries a reading and an English gloss. */
export interface Trilingual {
  ja: string;
  reading: string;
  en: string;
}

export interface ArtEncoder {
  tool: string;
  quality: number;
  width: number;
  lqip: number;
}

/** The byte-deciding settings the manifest does not carry (`ENCODE`). */
export interface EncodeSettings {
  method: number;
  sourceWidth: number;
  lqipQuality: number;
  /** Cap the LONG edge at ENCODER.width (portrait prints resize by height). */
  longSide?: boolean;
}

export interface ArtSource {
  museum: string;
  license: string;
  url: string;
}

export type Orientation = 'landscape' | 'portrait';

/** What a print serves: a station of the Road, kō by day (0..71), months by night (1..12). */
export interface PrintRoles {
  station?: number;
  kos?: number[];
  nightMonths?: number[];
}

export interface PrintSource {
  museum: string;
  objectId: number;
  url: string;
  accession: string;
  creditLine: string;
  license: string;
}

export interface PrintSeries extends Trilingual {
  id: string;
}

export interface ArtPrint {
  /** `<series>-<nn>-<name>`, lowercase ASCII (`ID_RE`). */
  id: string;
  /** `prints/<id>-<sha8>.webp`, relative to `public/art/`. */
  file: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  orientation: Orientation;
  /** A 24 px wide preview as a data URI, ≤ MAX_LQIP_CHARS. */
  lqip: string;
  /** 0..1 focal point for cover crops. */
  focus: [number, number];
  artist: Trilingual;
  title: Trilingual;
  series: PrintSeries;
  date: string;
  source: PrintSource;
  roles?: PrintRoles;
}

export interface ArtManifest {
  schema: typeof MANIFEST_SCHEMA;
  artVersion: string;
  generatedAt: string;
  encoder: ArtEncoder;
  sources: ArtSource[];
  prints: ArtPrint[];
  /** Every key 0..54 → print id. */
  stations: Record<string, string>;
  /** `day[kō 0..71]`, `night[month − 1]` → print id. */
  calendar: { day: string[]; night: string[] };
}

export interface ArtPackAsset {
  tier: string;
  name: string;
  sha256: string;
  bytes: number;
}

export interface ArtPackPointer {
  schema: typeof PACK_SCHEMA;
  repo: string;
  artVersion: string | null;
  tag: string | null;
  assets: ArtPackAsset[];
  credits: string[];
}

export interface CurationSeries extends Trilingual {
  artist: Trilingual;
  date: string;
}

export interface CurationEntry {
  id: string;
  aicId: number;
  title: Trilingual;
  /** A key of `series`. */
  series: string;
  focus: [number, number];
  roles?: PrintRoles;
  /** One line: why this impression. */
  why: string;
  /** Overrides the series' date / artist for this print. */
  date?: string;
  artist?: Trilingual;
}

/** Explicit tables; a `null` slot is filled from the entries' roles. */
export interface CurationCalendar {
  day?: (string | null)[];
  night?: (string | null)[];
}

export interface CurationFile {
  schema: typeof CURATION_SCHEMA;
  series: Record<string, CurationSeries>;
  entries: CurationEntry[];
  calendar?: CurationCalendar;
}

/* ── hashes and the version ────────────────────────────────────────────── */

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** First 8 hex digits of sha256 over the bytes (the content address in a file name). */
export function sha8(buf: Buffer | string): string {
  return sha256Hex(buf).slice(0, 8);
}

/** JSON with every object's keys sorted, so the same curation hashes the same whatever the authoring order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** `cwebp q82 w1400 lqip24 m6 src1600 lq40` — every setting that decides a byte, hashed into the artVersion and the encode key. */
export function encoderString(e: ArtEncoder = ENCODER, s: EncodeSettings = ENCODE): string {
  return `${e.tool} q${e.quality} w${e.width} lqip${e.lqip} m${s.method} src${s.sourceWidth} lq${s.lqipQuality}${s.longSide ? ' long' : ''}`;
}

/** `p-` + 10 hex of sha256(curation JSON ⏎ encoder settings). */
export function artVersionOf(curationJsonText: string, encoderSettings: string): string {
  return `p-${sha256Hex(`${curationJsonText}\n${encoderSettings}`).slice(0, 10)}`;
}

export const ART_VERSION_RE = /^p-[0-9a-f]{10}$/;

/* ── WebP header ───────────────────────────────────────────────────────── */

/**
 * Width and height from a WebP's first bytes. RIFF `WEBP`, then one of:
 * `VP8 ` (lossy: key-frame start code 9d 01 2a, then 14-bit width / height),
 * `VP8L` (lossless: signature 2f, then 14 + 14 bits, minus one), or
 * `VP8X` (extended: 24-bit canvas width / height, minus one). Throws on anything else.
 */
export function webpDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP (no RIFF/WEBP header)');
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new Error('VP8: key-frame start code missing');
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (buf[20] !== 0x2f) throw new Error('VP8L: signature byte missing');
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${JSON.stringify(kind)}`);
}

export function orientationOf(width: number, height: number): Orientation {
  return width >= height ? 'landscape' : 'portrait';
}

/* ── ids and file names ────────────────────────────────────────────────── */

/** Lowercase ASCII words joined by single hyphens. */
export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRINT_ID_RE = /^([a-z0-9]+)-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** `Ōtsu` → `otsu`, `Sanjō Ōhashi` → `sanjo-ohashi`: diacritics dropped, anything else a hyphen. */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `<series>-<nn>-<name>` — `printId('hoeido', 11, 'Mishima')` → `hoeido-11-mishima`. */
export function printId(series: string, nn: number, name: string): string {
  const s = slugify(series);
  const n = slugify(name);
  if (!s || !n || !Number.isInteger(nn) || nn < 0 || nn > 99) throw new Error(`printId: bad parts ${JSON.stringify([series, nn, name])}`);
  return `${s}-${String(nn).padStart(2, '0')}-${n}`;
}

export function parsePrintId(id: string): { series: string; nn: number; name: string } | null {
  const m = PRINT_ID_RE.exec(id);
  return m ? { series: m[1] as string, nn: Number(m[2]), name: m[3] as string } : null;
}

/** `prints/<id>-<sha8>.webp` — content-addressed, so the name moves only when the pixels do. */
export function printFile(id: string, sha256: string): string {
  return `prints/${id}-${sha256.slice(0, 8)}.webp`;
}

/* ── structural validation ─────────────────────────────────────────────── */

const isTri = (t: unknown): t is Trilingual => !!t && typeof t === 'object' && ['ja', 'reading', 'en'].every((k) => typeof (t as Record<string, unknown>)[k] === 'string' && ((t as Record<string, string>)[k] as string).length > 0);
const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

/**
 * Everything about a manifest that can be checked without the files: the
 * schema and version, every print's fields and budgets, the station table
 * (every key 0..54, nothing else), the calendar tables (72 / 12), every id
 * resolving, and the roles agreeing with the tables. Empty = sound. Used by
 * source-prints (before it writes), pack (refuses a manifest with problems,
 * so a `--only` / `--limit` run never ships) and check-art.
 */
export function manifestProblems(m: ArtManifest): string[] {
  const out: string[] = [];
  if (m.schema !== MANIFEST_SCHEMA) out.push(`schema ${JSON.stringify(m.schema)} is not ${MANIFEST_SCHEMA}`);
  if (typeof m.artVersion !== 'string' || !ART_VERSION_RE.test(m.artVersion)) out.push(`artVersion ${JSON.stringify(m.artVersion)} is not p-<10 hex>`);
  if (!Array.isArray(m.sources) || m.sources.length === 0) out.push('sources is empty');
  const prints = Array.isArray(m.prints) ? m.prints : [];
  if (!Array.isArray(m.prints)) out.push('prints is not an array');
  const ids = new Set<string>();
  let total = 0;
  for (const p of prints) {
    const at = `print ${JSON.stringify(p.id)}`;
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) out.push(`${at}: id is not lowercase ASCII words`);
    else if (ids.has(p.id)) out.push(`${at}: duplicate id`);
    ids.add(p.id);
    if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) out.push(`${at}: sha256 is not 64 hex`);
    else if (p.file !== printFile(p.id, p.sha256)) out.push(`${at}: file ${JSON.stringify(p.file)} is not ${printFile(p.id, p.sha256)}`);
    if (!isInt(p.bytes, 1, MAX_PRINT_BYTES)) out.push(`${at}: bytes ${JSON.stringify(p.bytes)} is not 1..${MAX_PRINT_BYTES}`);
    else total += p.bytes;
    if (!isInt(p.width, 1, 1 << 24) || !isInt(p.height, 1, 1 << 24)) out.push(`${at}: width/height missing`);
    else if (p.orientation !== orientationOf(p.width, p.height)) out.push(`${at}: orientation ${JSON.stringify(p.orientation)} does not match ${p.width}×${p.height}`);
    if (typeof p.lqip !== 'string' || !p.lqip.startsWith('data:image/webp;base64,')) out.push(`${at}: lqip is not a WebP data URI`);
    else if (p.lqip.length > MAX_LQIP_CHARS) out.push(`${at}: lqip is ${p.lqip.length} chars, over ${MAX_LQIP_CHARS}`);
    if (!Array.isArray(p.focus) || p.focus.length !== 2 || !p.focus.every((f) => typeof f === 'number' && f >= 0 && f <= 1)) out.push(`${at}: focus is not [x, y] in 0..1`);
    if (!isTri(p.title)) out.push(`${at}: title needs ja, reading and en`);
    if (!isTri(p.artist)) out.push(`${at}: artist needs ja, reading and en`);
    if (!isTri(p.series) || typeof p.series.id !== 'string' || !ID_RE.test(p.series.id)) out.push(`${at}: series needs id, ja, reading and en`);
    if (typeof p.date !== 'string' || p.date.length === 0) out.push(`${at}: date missing`);
    const s = p.source;
    if (!s || typeof s !== 'object') out.push(`${at}: source missing`);
    else {
      for (const k of ['museum', 'url', 'accession', 'creditLine', 'license'] as const) if (typeof s[k] !== 'string' || s[k].length === 0) out.push(`${at}: source.${k} missing`);
      if (!isInt(s.objectId, 1, Number.MAX_SAFE_INTEGER)) out.push(`${at}: source.objectId missing`);
    }
    const r = p.roles;
    if (r !== undefined) {
      if (r.station !== undefined && !isInt(r.station, 0, STATION_COUNT - 1)) out.push(`${at}: roles.station ${JSON.stringify(r.station)} is not 0..${STATION_COUNT - 1}`);
      if (r.kos !== undefined && (!Array.isArray(r.kos) || !r.kos.every((k) => isInt(k, 0, KO_COUNT - 1)))) out.push(`${at}: roles.kos must be indexes 0..${KO_COUNT - 1}`);
      if (r.nightMonths !== undefined && (!Array.isArray(r.nightMonths) || !r.nightMonths.every((n) => isInt(n, 1, MONTH_COUNT)))) out.push(`${at}: roles.nightMonths must be months 1..${MONTH_COUNT}`);
    }
  }
  if (total > MAX_PACK_BYTES) out.push(`prints total ${total} bytes, over ${MAX_PACK_BYTES}`);
  // Stations: every key 0..54, nothing else, every value a print.
  const stations = m.stations && typeof m.stations === 'object' ? m.stations : {};
  if (!m.stations || typeof m.stations !== 'object') out.push('stations missing');
  for (let n = 0; n < STATION_COUNT; n++) {
    const id = stations[String(n)];
    if (id === undefined) out.push(`stations: station ${n} missing`);
    else if (!ids.has(id)) out.push(`stations: station ${n} names unknown print ${JSON.stringify(id)}`);
  }
  for (const k of Object.keys(stations)) if (!/^\d+$/.test(k) || Number(k) >= STATION_COUNT) out.push(`stations: key ${JSON.stringify(k)} is not a station 0..${STATION_COUNT - 1}`);
  // Calendar: 72 by day, 12 by night.
  const cal = m.calendar && typeof m.calendar === 'object' ? m.calendar : { day: [], night: [] };
  if (!m.calendar || typeof m.calendar !== 'object') out.push('calendar missing');
  for (const [name, want] of [
    ['day', KO_COUNT],
    ['night', MONTH_COUNT],
  ] as const) {
    const list = Array.isArray(cal[name]) ? cal[name] : [];
    if (!Array.isArray(cal[name]) || list.length !== want) out.push(`calendar.${name} has ${Array.isArray(cal[name]) ? list.length : 'no'} entries, needs ${want}`);
    list.forEach((id, i) => {
      if (!ids.has(id)) out.push(`calendar.${name}[${i}] names unknown print ${JSON.stringify(id)}`);
    });
  }
  // Roles agree with the tables they derive.
  for (const p of prints) {
    const r = p.roles;
    if (!r || !ids.has(p.id)) continue;
    if (isInt(r.station, 0, STATION_COUNT - 1) && stations[String(r.station)] !== undefined && stations[String(r.station)] !== p.id) out.push(`print ${p.id}: roles.station ${r.station} but stations[${r.station}] is ${JSON.stringify(stations[String(r.station)])}`);
    for (const k of r.kos ?? []) if (isInt(k, 0, KO_COUNT - 1) && cal.day?.[k] !== undefined && cal.day[k] !== p.id) out.push(`print ${p.id}: roles.kos has ${k} but calendar.day[${k}] is ${JSON.stringify(cal.day[k])}`);
    for (const n of r.nightMonths ?? []) if (isInt(n, 1, MONTH_COUNT) && cal.night?.[n - 1] !== undefined && cal.night[n - 1] !== p.id) out.push(`print ${p.id}: roles.nightMonths has ${n} but calendar.night[${n - 1}] is ${JSON.stringify(cal.night[n - 1])}`);
  }
  return out;
}

/** The pointer for a built tar; `emptyPointer` is the placeholder a checkout ships before the first publish. */
export function buildPointer(artVersion: string, asset: Omit<ArtPackAsset, 'tier' | 'name'>, repo = PACK_REPO): ArtPackPointer {
  return { schema: PACK_SCHEMA, repo, artVersion, tag: releaseTag(artVersion), assets: [{ tier: PACK_TIER, name: assetName(artVersion), sha256: asset.sha256, bytes: asset.bytes }], credits: [...CREDITS] };
}

export function emptyPointer(repo = PACK_REPO): ArtPackPointer {
  return { schema: PACK_SCHEMA, repo, artVersion: null, tag: null, assets: [], credits: [] };
}

/** The no-pack line of `art:check` / `art:fetch`: the site builds and the drawn room stands without a print. */
export const NONE_MESSAGE = 'art pack: none — the drawn room stands';
