/**
 * TSUZUKU — source the print pack (design 09 §3 prints; runbook docs/ART_PACK.md §4).
 *
 *   node scripts/art/source-prints.ts [--dry-run] [--only <id,…>] [--limit N] [--force] [--refresh-records]
 *                                     [--curation scripts/art/curation] [--dest public/art]
 *                                     [--cache .art-cache] [--cwebp cwebp]
 *
 * curation → museum record → IIIF JPEG → cwebp → manifest. Every
 * `scripts/art/curation/*.json` (`tsuzuku.art-curation/1`) is merged (a
 * duplicate id, a series that differs between files, two prints claiming one
 * station or one kō: error). For each entry the Art Institute of Chicago
 * record is fetched (`is_public_domain` and `image_id` asserted; credit line,
 * accession number, date and dimensions captured), the JPEG is streamed at
 * `full/1600,` into `.art-cache/raw/<aicId>-<image_id>-1600.jpg` — keyed by
 * the object, the museum's scan and the width, so a re-scan or a width change
 * downloads afresh and retires the old raw; a re-scan is logged LOUDLY, since
 * the artVersion does not move for it; `--force` re-downloads what is cached;
 * ≤ 4 downloads at a time — encoded with the local `cwebp` CLI
 * (`-q 82 -m 6 -resize 1400 0`) into `.art-cache/webp/<id>.webp` beside a
 * 24 px `-q 40` preview that becomes the `lqip` data URI, hashed, measured
 * from its own header (`webpDimensions`) and copied to
 * `public/art/prints/<id>-<sha8>.webp`. The manifest (`tsuzuku.art/1`) is
 * written last, after `manifestProblems` found nothing — the station table
 * 0..54 and the calendar tables (72 kō, 12 months) come from the curation
 * (roles, or an explicit `calendar`), and a full run checks them for gaps
 * BEFORE the first download. A `--only` / `--limit` run writes a PARTIAL
 * manifest (full tables, some prints): `art:check` fails it and `art:pack`
 * refuses it, and it will not overwrite a complete manifest without `--force`.
 * `--dry-run` lists the merged curation, the tables and the artVersion and
 * touches no network. Any API, download or encode error stops the run.
 *
 * Downloaded bytes are data: they are hashed, read for their header and
 * handed to cwebp — never executed, imported or trusted beyond their magic.
 * The IIIF host (www.artic.edu) sits behind a challenge page that rejects a
 * User-Agent carrying a URL (measured 2026-10-28: 403 for every `(+https://…)`
 * shape, 200 for the bare token), so the JPEGs are requested as `tsuzuku-art/1`
 * while the API, which takes it, gets the full `USER_AGENT`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FetchLike, streamToFile } from '../audio/fetch-audio-pack.ts';
import {
  type ArtManifest,
  type ArtPrint,
  type CurationEntry,
  type CurationFile,
  type CurationSeries,
  type PrintRoles,
  type Trilingual,
  AIC_LICENSE,
  AIC_MUSEUM,
  AIC_SOURCE,
  artVersionOf,
  artworkUrl,
  CURATION_SCHEMA,
  ENCODE,
  ENCODER,
  encoderString,
  ID_RE,
  KO_COUNT,
  MANIFEST_SCHEMA,
  manifestProblems,
  MAX_LQIP_CHARS,
  MAX_PRINT_BYTES,
  MONTH_COUNT,
  orientationOf,
  printFile,
  sha256Hex,
  stableStringify,
  STATION_COUNT,
  webpDimensions,
} from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');

export const USER_AGENT = 'tsuzuku-art/1 (+https://github.com/sunkencity999/tsuzuku)';
/** The IIIF host challenges a UA with a URL in it (header comment); the bare token passes. */
export const IMAGE_USER_AGENT = 'tsuzuku-art/1';
export const API = 'https://api.artic.edu/api/v1/artworks';
export const IIIF = 'https://www.artic.edu/iiif/2';
/** The IIIF width the JPEG is sourced at — `ENCODE.sourceWidth`, part of the artVersion and the raw's name. */
export const IMAGE_WIDTH = ENCODE.sourceWidth;
export const CONCURRENCY = 4;
/** The preview's cwebp quality — `ENCODE.lqipQuality`, part of the artVersion and the encode key. */
export const LQIP_QUALITY = ENCODE.lqipQuality;
export const AIC_FIELDS = 'id,title,artist_title,date_display,credit_line,main_reference_number,image_id,is_public_domain,dimensions';

export const recordUrl = (aicId: number): string => `${API}/${aicId}?fields=${AIC_FIELDS}`;
export const imageUrl = (imageId: string, width = IMAGE_WIDTH): string => `${IIIF}/${imageId}/full/${width},/0/default.jpg`;

/** The fields of an artworks record the pipeline reads (every one may be null in the API). */
export interface AicRecord {
  id: number;
  title: string | null;
  artist_title: string | null;
  date_display: string | null;
  credit_line: string | null;
  main_reference_number: string | null;
  image_id: string | null;
  is_public_domain: boolean | null;
  dimensions: string | null;
}

/** Why a record cannot be used: not public domain, no image, no accession or credit line (the manifest needs both). */
export function recordProblems(r: Partial<AicRecord> | null | undefined, aicId: number): string[] {
  const out: string[] = [];
  if (!r || typeof r !== 'object') return [`AIC ${aicId}: no record`];
  if (r.id !== aicId) out.push(`AIC ${aicId}: the record says id ${JSON.stringify(r.id)}`);
  if (r.is_public_domain !== true) out.push(`AIC ${aicId}: is_public_domain is ${JSON.stringify(r.is_public_domain)} — not CC0, cannot ship`);
  if (typeof r.image_id !== 'string' || !/^[0-9a-f-]{36}$/.test(r.image_id)) out.push(`AIC ${aicId}: no image_id`);
  if (typeof r.main_reference_number !== 'string' || r.main_reference_number.length === 0) out.push(`AIC ${aicId}: no main_reference_number (accession)`);
  if (typeof r.credit_line !== 'string' || r.credit_line.length === 0) out.push(`AIC ${aicId}: no credit_line`);
  return out;
}

/* ── curation ──────────────────────────────────────────────────────────── */

export interface CurationInput {
  name: string;
  json: CurationFile;
}

export interface MergedCuration {
  series: Record<string, CurationSeries>;
  /** Sorted by id. */
  entries: CurationEntry[];
  /** Station → id, from the entries' `roles.station`. */
  stations: Record<string, string>;
  /** Resolved tables: roles first, an explicit `calendar` over them; `null` where nothing serves the slot. */
  calendar: { day: (string | null)[]; night: (string | null)[] };
  /** What `artVersionOf` hashes: the merged files, keys sorted, the entries without their `why`. */
  json: string;
}

/** Every `*.json` of the curation directory, sorted by name. */
export function readCurationDir(dir: string): CurationInput[] {
  if (!existsSync(dir)) throw new Error(`curation directory ${dir} not found`);
  const names = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  if (names.length === 0) throw new Error(`no curation files in ${dir}`);
  return names.map((name) => {
    let json: CurationFile;
    try {
      json = JSON.parse(readFileSync(join(dir, name), 'utf8')) as CurationFile;
    } catch (e) {
      throw new Error(`${name}: not valid JSON: ${(e as Error).message}`);
    }
    return { name, json };
  });
}

const isTri = (t: unknown): t is Trilingual => !!t && typeof t === 'object' && ['ja', 'reading', 'en'].every((k) => typeof (t as Record<string, unknown>)[k] === 'string' && ((t as Record<string, string>)[k] as string).length > 0);
const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

function entryProblems(e: CurationEntry, at: string): string[] {
  const out: string[] = [];
  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) out.push(`${at}: id ${JSON.stringify(e.id)} is not lowercase ASCII words`);
  if (!isInt(e.aicId, 1, Number.MAX_SAFE_INTEGER)) out.push(`${at}: aicId ${JSON.stringify(e.aicId)} is not a museum object id`);
  if (!isTri(e.title)) out.push(`${at}: title needs ja, reading and en`);
  if (typeof e.series !== 'string' || e.series.length === 0) out.push(`${at}: series missing`);
  if (!Array.isArray(e.focus) || e.focus.length !== 2 || !e.focus.every((f) => typeof f === 'number' && f >= 0 && f <= 1)) out.push(`${at}: focus is not [x, y] in 0..1`);
  if (typeof e.why !== 'string' || e.why.length === 0) out.push(`${at}: why missing (one line)`);
  if (e.artist !== undefined && !isTri(e.artist)) out.push(`${at}: artist needs ja, reading and en`);
  const r: PrintRoles | undefined = e.roles;
  if (r !== undefined) {
    if (r.station !== undefined && !isInt(r.station, 0, STATION_COUNT - 1)) out.push(`${at}: roles.station ${JSON.stringify(r.station)} is not 0..${STATION_COUNT - 1}`);
    if (r.kos !== undefined && (!Array.isArray(r.kos) || !r.kos.every((k) => isInt(k, 0, KO_COUNT - 1)))) out.push(`${at}: roles.kos must be indexes 0..${KO_COUNT - 1}`);
    if (r.nightMonths !== undefined && (!Array.isArray(r.nightMonths) || !r.nightMonths.every((n) => isInt(n, 1, MONTH_COUNT)))) out.push(`${at}: roles.nightMonths must be months 1..${MONTH_COUNT}`);
  }
  return out;
}

/**
 * Merges the curation files. Throws, listing every problem, on: a wrong
 * schema, a malformed entry, a duplicate id, a series defined differently in
 * two files, an entry naming an unknown series, two prints claiming one
 * station / kō / month (through roles or an explicit table), an explicit
 * table of the wrong length or naming an unknown id. Gaps in the tables are
 * NOT an error here (`tableGaps` reports them; a full run refuses them).
 */
export function mergeCuration(files: readonly CurationInput[]): MergedCuration {
  const problems: string[] = [];
  const series: Record<string, CurationSeries> = {};
  const seriesFrom: Record<string, string> = {};
  const entries: CurationEntry[] = [];
  const entryFrom = new Map<string, string>();
  const day: (string | null)[] = Array.from({ length: KO_COUNT }, () => null);
  const night: (string | null)[] = Array.from({ length: MONTH_COUNT }, () => null);
  const dayFrom: (string | null)[] = day.slice();
  const nightFrom: (string | null)[] = night.slice();
  const stations: Record<string, string> = {};
  const stationFrom: Record<string, string> = {};
  const claim = (table: (string | null)[], from: (string | null)[], i: number, id: string, who: string, what: string): void => {
    if (table[i] !== null && table[i] !== id) problems.push(`${what} ${i}: claimed by ${table[i]} (${from[i]}) and ${id} (${who})`);
    table[i] = id;
    from[i] = who;
  };
  for (const f of files) {
    const j = f.json;
    if (!j || typeof j !== 'object' || j.schema !== CURATION_SCHEMA) {
      problems.push(`${f.name}: schema is not ${CURATION_SCHEMA}`);
      continue;
    }
    for (const [sid, s] of Object.entries(j.series ?? {})) {
      if (!ID_RE.test(sid)) problems.push(`${f.name}: series id ${JSON.stringify(sid)} is not lowercase ASCII words`);
      if (!isTri(s) || !isTri(s.artist) || typeof s.date !== 'string' || s.date.length === 0) problems.push(`${f.name}: series ${sid} needs ja, reading, en, artist {ja, reading, en} and date`);
      if (series[sid] !== undefined && stableStringify(series[sid]) !== stableStringify(s)) problems.push(`${f.name}: series ${sid} differs from ${seriesFrom[sid]}`);
      series[sid] = s;
      seriesFrom[sid] ??= f.name;
    }
    if (!Array.isArray(j.entries)) problems.push(`${f.name}: entries is not an array`);
    for (const e of j.entries ?? []) {
      const at = `${f.name} entry ${JSON.stringify(e?.id)}`;
      problems.push(...entryProblems(e, at));
      if (typeof e.id !== 'string') continue;
      const seen = entryFrom.get(e.id);
      if (seen) problems.push(`${at}: duplicate id (also in ${seen})`);
      entryFrom.set(e.id, f.name);
      entries.push(e);
      const r = e.roles;
      if (r?.station !== undefined && isInt(r.station, 0, STATION_COUNT - 1)) {
        const k = String(r.station);
        if (stations[k] !== undefined && stations[k] !== e.id) problems.push(`station ${k}: claimed by ${stations[k]} (${stationFrom[k]}) and ${e.id} (${at})`);
        stations[k] = e.id;
        stationFrom[k] ??= at;
      }
      for (const k of r?.kos ?? []) if (isInt(k, 0, KO_COUNT - 1)) claim(day, dayFrom, k, e.id, `${at} roles.kos`, 'kō');
      for (const n of r?.nightMonths ?? []) if (isInt(n, 1, MONTH_COUNT)) claim(night, nightFrom, n - 1, e.id, `${at} roles.nightMonths`, 'month − 1');
    }
  }
  // Explicit tables lie over the roles.
  for (const f of files) {
    const cal = f.json?.calendar;
    if (!cal) continue;
    for (const [name, table, from, want] of [
      ['day', day, dayFrom, KO_COUNT],
      ['night', night, nightFrom, MONTH_COUNT],
    ] as const) {
      const list = cal[name];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length !== want) {
        problems.push(`${f.name}: calendar.${name} has ${Array.isArray(list) ? list.length : 'no'} entries, needs ${want}`);
        continue;
      }
      list.forEach((id, i) => {
        if (id === null) return;
        if (typeof id !== 'string') problems.push(`${f.name}: calendar.${name}[${i}] is not an id`);
        else claim(table, from, i, id, `${f.name} calendar.${name}`, name === 'day' ? 'kō' : 'month − 1');
      });
    }
  }
  const ids = new Set(entries.map((e) => e.id));
  for (const e of entries) if (typeof e.series === 'string' && series[e.series] === undefined) problems.push(`${entryFrom.get(e.id)} entry ${e.id}: unknown series ${JSON.stringify(e.series)}`);
  day.forEach((id, i) => {
    if (id !== null && !ids.has(id)) problems.push(`calendar.day[${i}] (${dayFrom[i]}) names unknown print ${JSON.stringify(id)}`);
  });
  night.forEach((id, i) => {
    if (id !== null && !ids.has(id)) problems.push(`calendar.night[${i}] (${nightFrom[i]}) names unknown print ${JSON.stringify(id)}`);
  });
  if (problems.length > 0) throw new Error(`curation:\n  ${problems.join('\n  ')}`);
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const explicit = files.map((f) => f.json.calendar).filter((c): c is NonNullable<CurationFile['calendar']> => c !== undefined);
  // `why` is the curator's note: shipped nowhere, it decides no byte, so it stays out of the hash.
  const hashed = entries.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'why')));
  const json = stableStringify({ series, entries: hashed, calendar: explicit });
  return { series, entries, stations, calendar: { day, night }, json };
}

/** What the tables still lack: `station 7`, `kō 12`, `month 3`. Empty when every slot is served. */
export function tableGaps(c: Pick<MergedCuration, 'stations' | 'calendar'>): string[] {
  const out: string[] = [];
  for (let n = 0; n < STATION_COUNT; n++) if (c.stations[String(n)] === undefined) out.push(`station ${n}`);
  c.calendar.day.forEach((id, i) => {
    if (id === null) out.push(`kō ${i}`);
  });
  c.calendar.night.forEach((id, i) => {
    if (id === null) out.push(`month ${i + 1}`);
  });
  return out;
}

/* ── fetching ──────────────────────────────────────────────────────────── */

const apiHeaders = { accept: 'application/json', 'user-agent': USER_AGENT };
const imageHeaders = { accept: 'image/jpeg', 'user-agent': IMAGE_USER_AGENT };

export async function fetchRecord(fetchImpl: FetchLike, aicId: number): Promise<AicRecord> {
  const res = await fetchImpl(recordUrl(aicId), { headers: apiHeaders });
  if (!res.ok) throw new Error(`AIC ${aicId}: record → HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Partial<AicRecord> };
  const r = body?.data;
  const problems = recordProblems(r, aicId);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return r as AicRecord;
}

/**
 * The record from `<cache>/records/<aicId>.json` when present (and not `--force`), else from the
 * API — retried on HTTP 429 with backoff (2, 4, 8, 16, 32 s; the museum rate-limits bursts) — then
 * written there, so a rerun after one failure never refetches 130 records.
 */
export async function cachedRecord(fetchImpl: FetchLike, aicId: number, cacheDir: string, o: { force?: boolean; waitMs?: (ms: number) => Promise<void> } = {}): Promise<AicRecord> {
  const file = join(cacheDir, `${aicId}.json`);
  if (!o.force && existsSync(file)) {
    try {
      const r = JSON.parse(readFileSync(file, 'utf8')) as AicRecord;
      if (recordProblems(r, aicId).length === 0) return r;
    } catch {
      /* a damaged cache entry is refetched */
    }
  }
  const wait = o.waitMs ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetchRecord(fetchImpl, aicId);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(r)}\n`);
      return r;
    } catch (e) {
      if (!(e as Error).message.endsWith('HTTP 429') || attempt >= 5) throw e;
      await wait(2000 * 2 ** attempt);
    }
  }
}

let partCounter = 0;

/** `<aicId>-<image_id>-<width>.jpg` — a raw is keyed by the object, the museum's scan and the width it was asked at. */
export const rawName = (aicId: number, imageId: string, width = IMAGE_WIDTH): string => `${aicId}-${imageId}-${width}.jpg`;
const RAW_RE = /^(\d+)-([0-9a-f-]{36})-(\d+)\.jpg$/;

export interface RawOutcome {
  path: string;
  downloaded: boolean;
  /** The image_id of an earlier raw of this object that was retired — the museum re-scanned it (the artVersion does not move for that). */
  rescanned: string | null;
}

/**
 * `cache/raw/<aicId>-<image_id>-<width>.jpg`: kept when present and non-empty
 * (unless `force`), else streamed from the IIIF host through a temp name of its
 * own (two attempts never share one) and checked for the JPEG magic before the
 * rename. Earlier raws of the same object — another scan, another width, or the
 * unkeyed `<aicId>.jpg` of the first pipeline — are retired once the current one
 * is in place, and a changed image_id is reported so the run can say so loudly.
 */
export async function ensureRaw(fetchImpl: FetchLike, record: AicRecord, rawDir: string, o: { force?: boolean } = {}): Promise<RawOutcome> {
  const imageId = record.image_id as string;
  const name = rawName(record.id, imageId);
  const path = join(rawDir, name);
  mkdirSync(rawDir, { recursive: true });
  const stale = readdirSync(rawDir).filter((n) => n !== name && (n === `${record.id}.jpg` || (n.startsWith(`${record.id}-`) && RAW_RE.test(n))));
  const rescanned = stale.map((n) => RAW_RE.exec(n)?.[2] ?? '').find((id) => id !== '' && id !== imageId) ?? null;
  let downloaded = false;
  if (o.force === true || !existsSync(path) || statSync(path).size === 0) {
    const tmp = `${path}.${process.pid}-${(partCounter++).toString(36)}.part`;
    const url = imageUrl(imageId);
    try {
      const got = await streamToFile(fetchImpl, url, tmp, imageHeaders);
      if (got.bytes < 4) throw new Error(`${url} → ${got.bytes} bytes`);
      const head = readFileSync(tmp).subarray(0, 3);
      if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) throw new Error(`${url} → not a JPEG (${head.toString('hex')}…)`);
      renameSync(tmp, path);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw new Error(`AIC ${record.id}: download failed: ${(e as Error).message}`);
    }
    downloaded = true;
  }
  for (const n of stale) rmSync(join(rawDir, n), { force: true });
  return { path, downloaded, rescanned };
}

/** Runs `fn` over `items` with at most `n` in flight; the first rejection rejects the whole, and no worker takes another item after it (the ones mid-item finish theirs). */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i] as T, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

/* ── encoding ──────────────────────────────────────────────────────────── */

export interface Encoded {
  webp: Buffer;
  lqip: string;
  width: number;
  height: number;
  reused: boolean;
}

/** `-resize <width> 0`, or `-resize 0 <height>` for a portrait print when `longSide` caps the long edge (a 1400-wide Edo view is 2,070 px tall and over the byte budget). */
export const cwebpArgs = (input: string, output: string, quality: number, width: number, height = 0): string[] => ['-quiet', '-q', String(quality), '-m', String(ENCODE.method), '-resize', String(height ? 0 : width), String(height), input, '-o', output];

function runCwebp(cwebp: string, args: string[]): void {
  const r = spawnSync(cwebp, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`${cwebp} failed to start: ${r.error.message} (brew install webp)`);
  if (r.status !== 0) throw new Error(`${cwebp} exited ${r.status}: ${(r.stderr ?? '').trim()}`);
}

/**
 * `cache/webp/<id>.webp` (the print) and `<id>.lqip.webp` (24 px) from the raw
 * JPEG, keyed by `<id>.key` = sha256 of the raw + the encoder string (method,
 * source width and preview quality included), so a changed source or setting
 * re-encodes and nothing else does.
 */
export function encodePrint(cwebp: string, id: string, rawPath: string, webpDir: string): Encoded {
  mkdirSync(webpDir, { recursive: true });
  const raw = readFileSync(rawPath);
  const key = `${sha256Hex(raw)}\n${encoderString()}\n`;
  const out = join(webpDir, `${id}.webp`);
  const lq = join(webpDir, `${id}.lqip.webp`);
  const keyPath = join(webpDir, `${id}.key`);
  const fresh = existsSync(out) && existsSync(lq) && existsSync(keyPath) && readFileSync(keyPath, 'utf8') === key && statSync(out).size > 0 && statSync(lq).size > 0;
  if (!fresh) {
    rmSync(keyPath, { force: true });
    runCwebp(cwebp, cwebpArgs(rawPath, out, ENCODER.quality, ENCODER.width));
    if (ENCODE.longSide) {
      const first = webpDimensions(readFileSync(out));
      if (first.height > first.width) runCwebp(cwebp, cwebpArgs(rawPath, out, ENCODER.quality, ENCODER.width, ENCODER.width));
    }
    runCwebp(cwebp, cwebpArgs(rawPath, lq, LQIP_QUALITY, ENCODER.lqip));
    writeFileSync(keyPath, key);
  }
  const webp = readFileSync(out);
  const { width, height } = webpDimensions(webp);
  const lqip = `data:image/webp;base64,${readFileSync(lq).toString('base64')}`;
  return { webp, lqip, width, height, reused: fresh };
}

/* ── the manifest ──────────────────────────────────────────────────────── */

/** One manifest row from the curation entry, the museum record and the encoded bytes. */
export function buildPrint(entry: CurationEntry, series: CurationSeries, record: AicRecord, enc: Encoded): ArtPrint {
  const sha256 = sha256Hex(enc.webp);
  const print: ArtPrint = {
    id: entry.id,
    file: printFile(entry.id, sha256),
    bytes: enc.webp.length,
    sha256,
    width: enc.width,
    height: enc.height,
    orientation: orientationOf(enc.width, enc.height),
    lqip: enc.lqip,
    focus: [entry.focus[0], entry.focus[1]],
    artist: { ...(entry.artist ?? series.artist) },
    title: { ...entry.title },
    series: { id: entry.series, ja: series.ja, reading: series.reading, en: series.en },
    date: entry.date ?? series.date ?? record.date_display ?? '',
    source: { museum: AIC_MUSEUM, objectId: record.id, url: artworkUrl(record.id), accession: record.main_reference_number as string, creditLine: record.credit_line as string, license: AIC_LICENSE },
  };
  if (entry.roles) print.roles = { ...entry.roles };
  return print;
}

export interface SourceOptions {
  curationDir: string;
  dest: string;
  cache: string;
  dryRun: boolean;
  only?: string[];
  limit?: number;
  force: boolean;
  cwebp?: string;
  fetchImpl?: FetchLike;
  /** Ignore `<cache>/records/` and ask the museum again (picks up a re-scanned image_id). */
  refreshRecords?: boolean;
  /** Backoff sleeper for HTTP 429 retries (tests pass an instant one). */
  waitMs?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (s: string) => void;
}

export interface SourceOutcome {
  artVersion: string;
  /** `null` for a dry run. */
  manifest: ArtManifest | null;
  partial: boolean;
  gaps: string[];
  downloaded: number;
  encoded: number;
  bytes: number;
}

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`;

export async function sourcePrints(o: SourceOptions): Promise<SourceOutcome> {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const fetchImpl: FetchLike = o.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const cwebp = o.cwebp ?? 'cwebp';
  const merged = mergeCuration(readCurationDir(o.curationDir));
  const artVersion = artVersionOf(merged.json, encoderString(ENCODER));
  const gaps = tableGaps(merged);
  const partial = o.only !== undefined || o.limit !== undefined;
  let entries = merged.entries;
  if (o.only) {
    const want = new Set(o.only);
    const known = new Set(entries.map((e) => e.id));
    const unknown = [...want].filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`--only names unknown prints: ${unknown.join(', ')}`);
    entries = entries.filter((e) => want.has(e.id));
  }
  if (o.limit !== undefined) {
    if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error(`--limit needs a positive integer, got ${o.limit}`);
    entries = entries.slice(0, o.limit);
  }
  const stations: Record<string, string> = {};
  for (const k of Object.keys(merged.stations).sort((a, b) => Number(a) - Number(b))) stations[k] = merged.stations[k] as string;
  const calendar = { day: merged.calendar.day.map((id) => id ?? ''), night: merged.calendar.night.map((id) => id ?? '') };

  if (o.dryRun) {
    log(`dry run — ${merged.entries.length} curated prints in ${o.curationDir} (${Object.keys(merged.series).length} series), artVersion ${artVersion}`);
    for (const e of entries) {
      const r = e.roles ?? {};
      const roles = [r.station !== undefined ? `station ${r.station}` : '', r.kos?.length ? `kō ${r.kos.join(',')}` : '', r.nightMonths?.length ? `night ${r.nightMonths.join(',')}` : ''].filter(Boolean).join('; ');
      log(`  ${e.id}  AIC ${e.aicId}  ${e.title.en}${roles ? `  [${roles}]` : ''}`);
    }
    log(`tables: stations ${Object.keys(stations).length}/${STATION_COUNT}, day ${merged.calendar.day.filter(Boolean).length}/${KO_COUNT}, night ${merged.calendar.night.filter(Boolean).length}/${MONTH_COUNT}`);
    for (const kind of ['station', 'kō', 'month']) {
      const of = gaps.filter((g) => g.startsWith(`${kind} `)).map((g) => g.slice(kind.length + 1));
      if (of.length > 0) log(`  gaps — ${kind} (${of.length}): ${of.join(', ')}`);
    }
    if (gaps.length > 0 && !partial) throw new Error(`the tables have ${gaps.length} gaps — a full run stops here`);
    log(`nothing fetched (dry run)`);
    return { artVersion, manifest: null, partial, gaps, downloaded: 0, encoded: 0, bytes: 0 };
  }

  if (gaps.length > 0 && !partial) throw new Error(`the tables have ${gaps.length} gaps (${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? ', …' : ''}) — fill the curation before a full run, or use --only / --limit for a partial one`);
  if (entries.length === 0) throw new Error('nothing to source (empty selection)');
  const manifestPath = join(o.dest, 'manifest.json');
  if (partial && !o.force && existsSync(manifestPath)) {
    try {
      const have = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtManifest;
      if (manifestProblems(have).length === 0) throw new Error(`${manifestPath} is a complete pack (${have.artVersion}); a --only / --limit run will not overwrite it without --force (or use --dest <scratch>)`);
    } catch (e) {
      if ((e as Error).message.includes('will not overwrite')) throw e;
    }
  }

  // Phase 1 — records and raw JPEGs, ≤ CONCURRENCY in flight.
  const rawDir = join(o.cache, 'raw');
  let downloaded = 0;
  let rescanned = 0;
  const records = await pool(entries, CONCURRENCY, async (e) => {
    const record = await cachedRecord(fetchImpl, e.aicId, join(o.cache, 'records'), { force: o.force || o.refreshRecords, waitMs: o.waitMs });
    const raw = await ensureRaw(fetchImpl, record, rawDir, { force: o.force });
    if (raw.downloaded) downloaded++;
    log(`  ${e.id}: AIC ${e.aicId} ${raw.downloaded ? 'downloaded' : 'cached'} (${record.dimensions ?? 'no dimensions'}; ${record.credit_line})`);
    if (raw.rescanned !== null) {
      rescanned++;
      log(`  ${e.id}: RE-SCANNED — AIC ${e.aicId} image_id ${raw.rescanned} → ${record.image_id}: new pixels, and the artVersion (${artVersion}) does not move for a museum re-scan; review the sheet before packing`);
    }
    return { entry: e, record, rawPath: raw.path };
  });

  // Phase 2 — encode, measure, hash (in id order; cwebp is CPU-bound, so one at a time).
  const webpDir = join(o.cache, 'webp');
  const prints: ArtPrint[] = [];
  let encoded = 0;
  for (const { entry, record, rawPath } of records) {
    const enc = encodePrint(cwebp, entry.id, rawPath, webpDir);
    if (!enc.reused) encoded++;
    if (enc.webp.length > MAX_PRINT_BYTES) throw new Error(`${entry.id}: ${enc.webp.length} bytes, over ${MAX_PRINT_BYTES} — lower the quality or crop`);
    if (enc.lqip.length > MAX_LQIP_CHARS) throw new Error(`${entry.id}: lqip is ${enc.lqip.length} chars, over ${MAX_LQIP_CHARS}`);
    const print = buildPrint(entry, merged.series[entry.series] as CurationSeries, record, enc);
    prints.push(print);
    log(`  ${print.id}: ${print.width}×${print.height} ${print.orientation}, ${(print.bytes / 1024).toFixed(0)} KB, lqip ${print.lqip.length} chars${enc.reused ? ' (encode reused)' : ''}`);
  }

  const manifest: ArtManifest = {
    schema: MANIFEST_SCHEMA,
    artVersion,
    generatedAt: (o.now ?? (() => new Date()))().toISOString(),
    encoder: { ...ENCODER },
    sources: [{ ...AIC_SOURCE }],
    prints,
    stations,
    calendar,
  };
  const problems = manifestProblems(manifest);
  if (!partial && problems.length > 0) throw new Error(`manifest:\n  ${problems.join('\n  ')}`);

  // Phase 3 — the files, then the manifest; a full run prunes what the manifest no longer names.
  const printsDir = join(o.dest, 'prints');
  mkdirSync(printsDir, { recursive: true });
  for (const p of prints) {
    const target = join(o.dest, p.file);
    const src = join(webpDir, `${p.id}.webp`);
    if (!existsSync(target) || statSync(target).size !== p.bytes) writeFileSync(target, readFileSync(src));
  }
  if (!partial) {
    const keep = new Set(prints.map((p) => basename(p.file)));
    for (const name of readdirSync(printsDir)) if (!keep.has(name)) rmSync(join(printsDir, name), { force: true });
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const bytes = prints.reduce((s, p) => s + p.bytes, 0);
  log(`${prints.length} prints, ${mb(bytes)}, ${downloaded} downloaded, ${encoded} encoded; artVersion ${artVersion} → ${manifestPath}`);
  if (rescanned > 0) log(`${rescanned} raw${rescanned === 1 ? '' : 's'} RE-SCANNED by the museum (the lines above name them): the pixels changed, the artVersion did not — review before packing`);
  if (partial) log(`PARTIAL manifest (--only / --limit): ${problems.length} table problems — art:check fails it and art:pack refuses it; run without --only / --limit before packing`);
  return { artVersion, manifest, partial, gaps, downloaded, encoded, bytes };
}

function parse(argv: readonly string[]): SourceOptions {
  const o: SourceOptions = { curationDir: join(here, 'curation'), dest: join(REPO_ROOT, 'public', 'art'), cache: join(REPO_ROOT, '.art-cache'), dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (a === '--refresh-records') o.refreshRecords = true;
    else if (a === '--only') o.only = [...(o.only ?? []), ...v().split(',').map((s) => s.trim()).filter(Boolean)];
    else if (a === '--limit') o.limit = Number(v());
    else if (a === '--curation') o.curationDir = resolve(v());
    else if (a === '--dest') o.dest = resolve(v());
    else if (a === '--cache') o.cache = resolve(v());
    else if (a === '--cwebp') o.cwebp = v();
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve()
    .then(() => sourcePrints(parse(process.argv.slice(2))))
    .then(() => process.exit(0))
    .catch((e: Error) => {
      process.stderr.write(`source-prints: ${e.message}\n`);
      process.exit(1);
    });
}
