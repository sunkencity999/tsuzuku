/**
 * TSUZUKU — content index (`public/content/manifest.json`).
 *
 *   node scripts/build-content-index.ts [--root <content dir>] [--version <id>] [--no-check]
 *
 * Emits a `ContentManifest` with bytes/sha256 per hand-written content file,
 * the belts and stations each file serves, per-station counts read from the
 * `stations/NN.json` bundles (which `assign-stations.ts` generates), totals,
 * `componentsPath` and `redirects` (`_meta/redirects.json` when present).
 *
 * `contentVersion` is derived from the content itself unless `--version`
 * (or `CONTENT_VERSION`) overrides it: `c-` + the first 10 hex digits of
 * sha256 over the sorted `(path, sha256(bytes))` list of every `**\/*.json`
 * under the root except `manifest.json` (bundles, `_meta` and redirects
 * included). The loader's Cache API mirror `tsuzuku-content-<contentVersion>`
 * is the only offline store for `content/**`, so the version must change
 * whenever any content file changes; the validator's V35 flags a stale
 * derived version.
 *
 * Fails (throws / exit 1) when a station bundle is missing or any content
 * file exceeds MAX_FILE_BYTES = 300 KiB (307,200 bytes; measured vocab is
 * 1.3–1.85 KB per item, so a 150-item N1 file is ≈ 276 KB; stories are one
 * file per station). Warns (stderr, `writeIndex().warnings`) when a station
 * entry — the bytes the loader's `preloadStation(n)` fetches: the bundle's
 * item files plus `_meta/components.json` — exceeds STATION_ENTRY_BUDGET_BYTES
 * = 1 MiB (design 07 §9 "station entry ≤ 1 MB raw"); the assigner keeps a
 * station's vocab in ≤ 2–3 files (`orderRankedVocab`) so this holds.
 *
 * LISTENING POOLS (design 08 §4–§5). `listening/pool-NN.json`, written by
 * `content:assign`, are listed in `files` as type `'pool'` with `stations:
 * [NN]` (`count` = refs; `totals.pool` = pool files, like `totals.station`);
 * they are not ContentFiles and never count toward a station entry. The
 * default check (on unless `--no-check`) is V44: the pools are regenerated in
 * memory from the bundles and the files on disk (`buildPools`) and the build
 * fails on any byte difference, missing or unexpected pool file, ref whose
 * target example / line does not exist, or id that resolves to nothing —
 * reported as `{ file, id, rule: 'V44', message }` rows (`checkPools`,
 * `BuildIndexError.findings`), so CI's existing `content:index` step enforces
 * V44 with no workflow change. A pool file over POOL_FILE_BUDGET_BYTES
 * (256 KiB, a HARD limit — lead decision, wave B) fails the same default check
 * with a BuildIndexError naming the file and its bytes (`oversizePools`), so a
 * pool can never outgrow what the loader fetches per station unnoticed.
 *
 * Output is deterministic: files sorted by path, fixed key order, redirects
 * sorted; `generatedAt` is kept from the previous manifest when nothing else
 * changed, so a re-run is byte-identical.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BELT_IDS, CONTENT_KINDS, ID_PATTERNS, STATIONS } from '../src/content/types.ts';
import type { Belt, ContentKind, ContentManifest, Level, ListeningPool, ManifestFile, ManifestStation, StationBundle } from '../src/content/types.ts';
import { buildPools, poolPath, readPoolCorpus, stringifyPool } from './linker.ts';
import type { PoolCorpus } from './linker.ts';

/** Hard cap for one hand-written content file (bytes). */
export const MAX_FILE_BYTES = 300 * 1024;
/** Design 07 §9: everything `preloadStation(n)` fetches for one station entry ≤ 1 MB raw (soft; warns). */
export const STATION_ENTRY_BUDGET_BYTES = 1024 * 1024;
/**
 * Hard cap for one generated pool file (bytes): a pool file is ≤ 256 KiB; `content:index` fails over it
 * (lead decision, listening wave B — the plan's 80 KB soft figure predates `kana` in `PoolRef`, which Radio
 * reads; the largest shipped pool, Station 43, is ≈ 178 KiB). `BuildIndexOptions.poolFileBudget` overrides it for tests.
 */
export const POOL_FILE_BUDGET_BYTES = 256 * 1024;
export const COMPONENTS_PATH = '_meta/components.json';
const POOL_DIR = 'listening';
const POOL_FILE_RE = /^listening\/(pool-\d{2})\.json$/;

/** One V44 row, in the validator's `Finding` shape. */
export interface PoolFinding {
  file: string;
  id?: string;
  rule: 'V44';
  message: string;
}

/** Thrown by `buildIndex` when the default check fails; `findings` holds the V44 rows (empty for the other failures). */
export class BuildIndexError extends Error {
  findings: PoolFinding[];
  constructor(message: string, findings: PoolFinding[] = []) {
    super(message);
    this.name = 'BuildIndexError';
    this.findings = findings;
  }
}

export interface BuildIndexOptions {
  /** ISO timestamp to stamp; defaults to now. Pass the previous value for a byte-identical rebuild. */
  generatedAt?: string;
  /** Throw on missing bundles / oversize files (default true). */
  check?: boolean;
  /** Station entry budget for `writeIndex().warnings` (default STATION_ENTRY_BUDGET_BYTES). */
  stationEntryBudget?: number;
  /** Pool file budget the default check enforces (default POOL_FILE_BUDGET_BYTES; a pool over it throws). */
  poolFileBudget?: number;
}

export interface StationEntrySize {
  number: number;
  /** Manifest paths `preloadStation(n)` fetches (bundle `files` minus conjugation/station files, plus components). */
  files: string[];
  /** Sum of those files' manifest `bytes`. */
  bytes: number;
}

/**
 * Bytes the loader fetches on station entry, per station, from the written
 * bundles and the manifest. Mirrors `itemFilePaths` in src/content/loader.ts:
 * the bundle's `files` without conjugation and station files, plus
 * `componentsPath` when the station places components. Stations whose bundle
 * is missing or unreadable are skipped.
 */
export function stationEntrySizes(root: string, m: ContentManifest): StationEntrySize[] {
  root = resolve(root);
  const byPath = new Map(m.files.map((f) => [f.path, f]));
  const skip = new Set(m.files.filter((f) => f.type === 'conjugation' || f.type === 'station' || f.type === 'pool').map((f) => f.path));
  const out: StationEntrySize[] = [];
  for (const st of m.stations) {
    let b: StationBundle;
    try {
      b = JSON.parse(readFileSync(join(root, st.path), 'utf8')) as StationBundle;
    } catch {
      continue;
    }
    const files = (Array.isArray(b.files) ? b.files : []).filter((p) => typeof p === 'string' && !skip.has(p));
    if (Array.isArray(b.componentIds) && b.componentIds.length > 0 && !files.includes(m.componentsPath)) files.push(m.componentsPath);
    out.push({ number: st.number, files, bytes: files.reduce((n, p) => n + (byPath.get(p)?.bytes ?? 0), 0) });
  }
  return out;
}

/** One warning line per station whose entry exceeds `budget` bytes. */
export function oversizeStations(sizes: readonly StationEntrySize[], budget = STATION_ENTRY_BUDGET_BYTES): string[] {
  const out: string[] = [];
  for (const s of sizes) {
    if (s.bytes <= budget) continue;
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    out.push(`stations/${pad2(s.number)}.json: station entry ${kb(s.bytes)} over ${s.files.length} files > ${kb(budget)} budget (design 07 §9; regroup the level's files so a station spans ≤ 2–3)`);
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

interface Envelope {
  schema?: unknown;
  type?: unknown;
  level?: unknown;
  items?: unknown;
}

function isContentFile(rel: string, env: Envelope | null): env is Envelope & { items: unknown[] } {
  if (rel === 'manifest.json' || rel.startsWith('stations/') || rel.startsWith(`${POOL_DIR}/`)) return false;
  if (rel === '_meta/denylist.json' || rel === '_meta/redirects.json') return false;
  return !!env && env.schema === 'tsuzuku.content/1' && Array.isArray(env.items);
}

/** Sorted relative paths of every hand-written ContentFile under `root`. */
export function listContentFiles(root: string): string[] {
  root = resolve(root);
  const out: string[] = [];
  for (const abs of walk(root)) {
    const rel = toRel(root, abs);
    let env: Envelope | null = null;
    try {
      env = JSON.parse(readFileSync(abs, 'utf8')) as Envelope;
    } catch {
      env = null;
    }
    if (isContentFile(rel, env)) out.push(rel);
  }
  return out.sort();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Prefix of a derived (as opposed to `--version`-overridden) `contentVersion`. */
export const DERIVED_VERSION_PREFIX = 'c-';
const DERIVED_VERSION_RE = /^c-[0-9a-f]{10}$/;

/** True when `v` has the shape `deriveContentVersion` produces (so V35 may compare it). */
export function isDerivedVersion(v: unknown): v is string {
  return typeof v === 'string' && DERIVED_VERSION_RE.test(v);
}

/**
 * `c-` + the first 10 hex digits of sha256 over the sorted list of
 * `(path, sha256(file bytes))` for every `**\/*.json` under `root` except
 * `manifest.json`. Deterministic: the same bytes on disk give the same version,
 * and any content change (item files, bundles, `_meta`) gives a new one.
 */
export function deriveContentVersion(root: string): string {
  root = resolve(root);
  const entries: string[] = [];
  for (const abs of walk(root)) {
    const rel = toRel(root, abs);
    if (rel === 'manifest.json') continue;
    entries.push(`${rel}\u0000${sha256(readFileSync(abs))}`);
  }
  entries.sort();
  const h = createHash('sha256');
  for (const e of entries) h.update(e + '\n');
  return `${DERIVED_VERSION_PREFIX}${h.digest('hex').slice(0, 10)}`;
}

function stationNumberOfStationId(id: unknown): number | null {
  const m = typeof id === 'string' ? /^st-(\d{2})$/.exec(id) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= STATIONS.length ? n : null;
}

function beltsFor(stations: number[]): Belt[] {
  const set = new Set<Belt>();
  for (const n of stations) {
    const st = STATIONS[n - 1];
    if (st) set.add(st.belt);
  }
  return BELT_IDS.filter((b) => set.has(b));
}

/** Sorted relative paths of the pool files on disk (`listening/pool-NN.json`, by `ID_PATTERNS.pool`). */
export function listPoolFiles(root: string): string[] {
  root = resolve(root);
  const out: string[] = [];
  for (const abs of walk(join(root, POOL_DIR))) {
    const rel = toRel(root, abs);
    const m = POOL_FILE_RE.exec(rel);
    if (m && ID_PATTERNS.pool.test(m[1]!)) out.push(rel);
  }
  return out.sort();
}

function poolStation(rel: string): number {
  return Number(/pool-(\d{2})\.json$/.exec(rel)?.[1] ?? NaN);
}

/**
 * V44 (design 08 §5): the pool files on disk against the pools regenerated
 * from `bundles` and the content on disk. Rows for a file that does not
 * regenerate byte-identically (or is missing / unexpected), a `ref` whose
 * target example or line does not exist, and an id that resolves to no item.
 * Empty when everything holds. `corpus` may be passed to share one read.
 */
export function checkPools(root: string, bundles: readonly StationBundle[], corpus: PoolCorpus = readPoolCorpus(root)): PoolFinding[] {
  root = resolve(root);
  const rows: PoolFinding[] = [];
  const { pools } = buildPools(root, bundles, corpus);
  const expected = new Map(pools.map((p) => [poolPath(p.station), p]));
  const onDisk = new Set(listPoolFiles(root));
  for (const [rel, p] of expected) {
    if (!onDisk.has(rel)) {
      rows.push({ file: rel, rule: 'V44', message: 'pool file missing (run content:assign)' });
      continue;
    }
    if (readFileSync(join(root, rel), 'utf8') !== stringifyPool(p)) rows.push({ file: rel, rule: 'V44', message: 'pool does not regenerate byte-identically (run content:assign; pools are generated, never hand-written)' });
  }
  for (const rel of onDisk) if (!expected.has(rel)) rows.push({ file: rel, rule: 'V44', message: 'unexpected pool file: no station bundle generates it (delete it or run content:assign)' });
  // ref targets and ids, over the regenerated pools (the on-disk file is either identical or already reported)
  const examplesOf = new Map<string, number>();
  for (const v of corpus.vocab) examplesOf.set(v.id, Array.isArray(v.examples) ? v.examples.length : 0);
  for (const g of corpus.grammar) examplesOf.set(g.id, Array.isArray(g.examples) ? g.examples.length : 0);
  const linesOf = new Map<string, number>();
  for (const s of corpus.stories) linesOf.set(s.id, Array.isArray(s.lines) ? s.lines.length : 0);
  const ids = new Set<string>();
  for (const b of bundles) {
    for (const id of b.vocabIds ?? []) ids.add(id);
    for (const id of b.grammarIds ?? []) ids.add(id);
  }
  for (const p of pools) {
    const file = poolPath(p.station);
    for (const r of p.refs) {
      const m = /^([^#]+)#(ex|L)(\d+)$/.exec(r.ref);
      if (!m) {
        rows.push({ file, id: r.ref, rule: 'V44', message: `ref "${r.ref}" is not <id>#ex<k> or <id>#L<i>` });
        continue;
      }
      const [, owner, kind, k] = m;
      const count = kind === 'ex' ? examplesOf.get(owner!) : linesOf.get(owner!);
      if (count === undefined) rows.push({ file, id: r.ref, rule: 'V44', message: `ref target ${owner} does not exist` });
      else if (Number(k) >= count) rows.push({ file, id: r.ref, rule: 'V44', message: `ref ${r.ref} points past ${kind === 'ex' ? 'examples' : 'lines'}.length = ${count}` });
      for (const id of r.ids) if (!ids.has(id)) rows.push({ file, id: r.ref, rule: 'V44', message: `id ${id} resolves to no allowlisted item` });
    }
  }
  return rows;
}

/**
 * One line per pool file over `budget` bytes, naming the file and its bytes. The default check turns a
 * non-empty list into a `BuildIndexError` (the budget is a hard limit); `writeIndex().warnings` still carries
 * the lines for a `check: false` run.
 */
/** Bytes for a message: whole KiB when the figure is one (`256 KiB`), else the raw count (`100 bytes`). */
const kib = (n: number): string => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} KiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} bytes`);

export function oversizePools(root: string, m: Pick<ContentManifest, 'files'>, budget = POOL_FILE_BUDGET_BYTES): string[] {
  void root;
  return m.files.filter((f) => f.type === 'pool' && f.bytes > budget).map((f) => `${f.path}: ${f.bytes} bytes (${kib(f.bytes)}) > POOL_FILE_BUDGET_BYTES ${budget} bytes (${f.count} refs with their kana — a pool file is ≤ ${kib(budget)}, design 08 §4)`);
}

export function buildIndex(root: string, version: string, opts: BuildIndexOptions = {}): ContentManifest {
  root = resolve(root);
  const check = opts.check !== false;
  // Bundles.
  const bundles = new Map<number, StationBundle>();
  const missing: string[] = [];
  for (const st of STATIONS) {
    const rel = `stations/${pad2(st.number)}.json`;
    const p = join(root, rel);
    if (!existsSync(p)) {
      missing.push(rel);
      continue;
    }
    try {
      const b = JSON.parse(readFileSync(p, 'utf8')) as StationBundle;
      if (b.schema === 'tsuzuku.station/1') bundles.set(st.number, b);
      else missing.push(`${rel} (bad schema)`);
    } catch (e) {
      missing.push(`${rel} (${(e as Error).message})`);
    }
  }
  if (check && missing.length > 0) throw new BuildIndexError(`missing station bundles (run content:assign): ${missing.join(', ')}`);
  const componentStations: number[] = [];
  for (const [n, b] of bundles) if (Array.isArray(b.componentIds) && b.componentIds.length > 0) componentStations.push(n);

  // Files.
  const files: ManifestFile[] = [];
  const totals = Object.fromEntries(CONTENT_KINDS.map((k) => [k, 0])) as Record<ContentKind, number>;
  const oversize: string[] = [];
  for (const rel of listContentFiles(root)) {
    const abs = join(root, rel);
    const buf = readFileSync(abs);
    const env = JSON.parse(buf.toString('utf8')) as Envelope & { items: unknown[] };
    const type = String(env.type) as ContentKind;
    if (!(CONTENT_KINDS as readonly string[]).includes(type)) continue;
    if (buf.length > MAX_FILE_BYTES) oversize.push(`${rel} (${buf.length} bytes)`);
    const stations = new Set<number>();
    if (type === 'component') {
      for (const n of componentStations) stations.add(n);
    } else {
      for (const it of env.items) {
        if (!it || typeof it !== 'object') continue;
        const rec = it as { station?: unknown; stationId?: unknown };
        if (typeof rec.station === 'number' && Number.isInteger(rec.station)) stations.add(rec.station);
        const n = stationNumberOfStationId(rec.stationId);
        if (n !== null) stations.add(n);
      }
    }
    const stationList = [...stations].sort((a, b) => a - b);
    const level = typeof env.level === 'string' ? (env.level as Level) : null;
    files.push({
      path: rel,
      type,
      level,
      count: env.items.length,
      bytes: buf.length,
      sha256: sha256(buf),
      belts: beltsFor(stationList),
      stations: stationList,
    });
    totals[type] += env.items.length;
  }
  if (check && oversize.length > 0) throw new BuildIndexError(`content files over ${MAX_FILE_BYTES} bytes: ${oversize.join(', ')}`);
  totals.station = bundles.size;

  // Listening pools (design 08 §4): listed like bundles, one file per station, never a ContentFile.
  for (const rel of listPoolFiles(root)) {
    const buf = readFileSync(join(root, rel));
    let count = 0;
    try {
      const pool = JSON.parse(buf.toString('utf8')) as ListeningPool;
      count = Array.isArray(pool.refs) ? pool.refs.length : 0;
    } catch {
      count = 0;
    }
    const n = poolStation(rel);
    files.push({ path: rel, type: 'pool', level: null, count, bytes: buf.length, sha256: sha256(buf), belts: beltsFor([n]), stations: [n] });
    totals.pool += 1;
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (check) {
    const over = oversizePools(root, { files }, opts.poolFileBudget ?? POOL_FILE_BUDGET_BYTES);
    if (over.length > 0) throw new BuildIndexError(`listening pool file(s) over the ${opts.poolFileBudget ?? POOL_FILE_BUDGET_BYTES}-byte budget (a pool file is ≤ ${kib(opts.poolFileBudget ?? POOL_FILE_BUDGET_BYTES)}; split the station's examples or raise the budget with the lead):\n${over.map((o) => `  ${o}`).join('\n')}`);
    const rows = checkPools(root, [...bundles.values()]);
    if (rows.length > 0) {
      const shown = rows.slice(0, 12).map((r) => `  F V44 ${r.file}${r.id ? ` ${r.id}` : ''}  ${r.message}`);
      if (rows.length > shown.length) shown.push(`  … ${rows.length - shown.length} more V44 rows`);
      throw new BuildIndexError(`V44: ${rows.length} listening pool finding(s) (run content:assign)\n${shown.join('\n')}`, rows);
    }
  }

  // Stations.
  const stations: ManifestStation[] = [];
  for (const st of STATIONS) {
    const b = bundles.get(st.number);
    if (!b) continue;
    stations.push({
      number: st.number,
      path: `stations/${pad2(st.number)}.json`,
      counts: {
        kana: (b.kanaIds ?? []).length,
        vocab: (b.vocabIds ?? []).length,
        kanji: (b.kanjiIds ?? []).length,
        grammar: (b.grammarIds ?? []).length,
        story: (b.storyIds ?? []).length,
        michikusa: (b.michikusaIds ?? []).length,
      },
    });
  }

  // Redirects.
  const redirects: Record<string, string> = {};
  const rp = join(root, '_meta', 'redirects.json');
  if (existsSync(rp)) {
    const raw = JSON.parse(readFileSync(rp, 'utf8')) as Record<string, unknown>;
    for (const k of Object.keys(raw).sort()) if (typeof raw[k] === 'string') redirects[k] = raw[k] as string;
  }

  return {
    schema: 'tsuzuku.manifest/1',
    contentVersion: version,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    files,
    stations,
    totals,
    componentsPath: COMPONENTS_PATH,
    redirects,
  };
}

export function stringifyManifest(m: ContentManifest): string {
  return JSON.stringify(m, null, 2) + '\n';
}

/**
 * Writes `manifest.json`, reusing the previous `generatedAt` when nothing else
 * changed so repeated runs are byte-identical. `version` overrides the derived
 * `contentVersion` (`deriveContentVersion`). Returns the manifest written.
 */
export function writeIndex(root: string, version?: string, opts: BuildIndexOptions = {}): { manifest: ContentManifest; changed: boolean; path: string; warnings: string[] } {
  root = resolve(root);
  const p = join(root, 'manifest.json');
  let previous: ContentManifest | null = null;
  let previousText = '';
  if (existsSync(p)) {
    previousText = readFileSync(p, 'utf8');
    try {
      previous = JSON.parse(previousText) as ContentManifest;
    } catch {
      previous = null;
    }
  }
  const v = version ?? deriveContentVersion(root);
  const keep = buildIndex(root, v, { ...opts, generatedAt: opts.generatedAt ?? previous?.generatedAt ?? new Date().toISOString() });
  let manifest = keep;
  let text = stringifyManifest(keep);
  if (text !== previousText && opts.generatedAt === undefined && previous) {
    manifest = { ...keep, generatedAt: new Date().toISOString() };
    text = stringifyManifest(manifest);
  }
  const changed = text !== previousText;
  if (changed) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  const warnings = [...oversizeStations(stationEntrySizes(root, manifest), opts.stationEntryBudget ?? STATION_ENTRY_BUDGET_BYTES), ...oversizePools(root, manifest, opts.poolFileBudget ?? POOL_FILE_BUDGET_BYTES)];
  return { manifest, changed, path: p, warnings };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CLI                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function main(): void {
  const argv = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  let root = join(here, '..', 'public', 'content');
  let version: string | undefined;
  let check = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--root') root = argv[++i] ?? root;
    else if (a === '--version') version = argv[++i];
    else if (a.startsWith('--version=')) version = a.slice(10);
    else if (a === '--no-check') check = false;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: node scripts/build-content-index.ts [--root <content dir>] [--version <id>] [--no-check]\n  contentVersion defaults to c-<sha256 of the content>; --version or CONTENT_VERSION overrides it\n  the default check fails on a missing bundle, an oversize file, a pool file over 256 KiB and V44 (listening pools out of date); --no-check skips it\n');
      process.exit(0);
    }
  }
  if (version === undefined && process.env['CONTENT_VERSION']) version = process.env['CONTENT_VERSION'];
  try {
    const { manifest, changed, path, warnings } = writeIndex(resolve(root), version, { check });
    for (const w of warnings) process.stderr.write(`content:index warning: ${w}\n`);
    const t = manifest.totals;
    process.stdout.write(
      `${changed ? 'wrote' : 'unchanged'} ${path}\n` +
        `content ${manifest.contentVersion}: ${manifest.files.length} files, ${manifest.stations.length} stations · kana ${t.kana} vocab ${t.vocab} kanji ${t.kanji} grammar ${t.grammar} story ${t.story} michikusa ${t.michikusa} conjugation ${t.conjugation} component ${t.component} · ${t.pool} pool files (${manifest.files.filter((f) => f.type === 'pool').reduce((n, f) => n + f.count, 0)} refs)\n`,
    );
  } catch (e) {
    process.stderr.write(`content:index failed: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
