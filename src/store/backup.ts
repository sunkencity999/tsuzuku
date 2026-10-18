/**
 * TSUZUKU — export / import (design 07 §5, 06 §7 #10). Your study data never
 * leaves the browser unless you carry it.
 *
 *  exportSave()        one JSON document `{schema, exportedAt, meta, shards, log}`
 *                      named `tsuzuku-backup-YYYY-MM-DD.json`; `{gzip:true}`
 *                      yields real gzip bytes (`CompressionStream`) as
 *                      `.tsuzuku.json.gz`. Emits `backup:exported`, bumps
 *                      `stats.exports`.
 *  previewImport(text) parses → migrates every document → a diff summary.
 *                      Accepts the envelope, a bare SaveMeta, or the design-07
 *                      `{meta, shards, log}` shape. Never writes.
 *  previewImportBlob() the file itself (gzip bytes or text) → previewImport.
 *                      Fields of the wrong type are repaired to defaults by
 *                      the migration layer and reported as one warning.
 *                      Anything over `IMPORT_MAX_BYTES` (file, text, or the
 *                      gunzip output, which is inflated no further) is
 *                      refused before it is parsed: a real save is < 4.5 MB.
 *  applyImport(p,mode) `merge` (streak max, XP max, collections union, cards
 *                      newer-wins, ledger — app rows per day and kind from the
 *                      side with the larger sum, never added, since today's
 *                      Radio row grows (design 08 §12); outside and noted
 *                      rows union —, texts heard / teach cards seen union,
 *                      the Arena's last pass per text (`arenaAt`) at the
 *                      later day and the listening counters max — design 08
 *                      §10.2 / §11;
 *                      identity — name, kana, zone,
 *                      dictated sentence — stays this browser's unless this
 *                      browser holds no learner trace yet, as on a new phone,
 *                      when the backup's is taken) or `replace` (the backup as
 *                      is; cards included, and the backup's seed/createdAt/
 *                      contentVersion header, so art renders as on the
 *                      original device). The review log is unioned in both
 *                      modes: deduped on `t|cardKey`, sorted by time, the
 *                      ring keeps the newest 5,000 by time (never by push
 *                      order). Runs inside one signals `batch` so the
 *                      unlock evaluator sees one change, not one per card;
 *                      drops the in-progress session snapshot (it was
 *                      planned against the old cards). Atomic: should any
 *                      write throw mid-way, the previous meta, cards, log
 *                      and session are put back before the error is
 *                      rethrown, so a page-level catch never sees a save
 *                      with its meta replaced and its cards half-written.
 *                      Flushes; the caller shows the reload hint.
 */
import { batch } from '@preact/signals';
import { BELT_IDS, type Belt, type CardKey, type Level } from '../content/types';
import { bus } from '../shared/events';
import { isoDate } from '../shared/time';
import {
  LOG_SCHEMA,
  SAVE_SCHEMA,
  SLICE_KEYS,
  type CardShard,
  type CardTuple,
  type Collections,
  type DailyRow,
  type EpochDay,
  type KageState,
  type Ledger,
  type LedgerEntry,
  type LogEntry,
  type Progress,
  type ReviewLog,
  type SaveMeta,
  type Streak,
  type WeakPoints,
} from '../shared/store-types';
import { MINUTE_DECIMALS } from './ledger';
import { MigrationError, migrateLog, migrateMetaChecked, migrateShard, newerCard } from './migrations';
import { InflateLimitError, LOG_RING, gunzipText, hasCompression, isCompressed, parseShardId, pump, type ShardId } from './persist';
import { replaceHeader, replaceLog, shardOfKey, store, storeCards } from './store';
import { S } from './strings';
import { levelFor } from './xp';

export const BACKUP_SCHEMA = 'tsuzuku.backup/1' as const;
export const BACKUP_VERSION = 1;
/** Largest file / text / inflated size an import will look at (a full save is < 4.5 MB, design 07 §4). */
export const IMPORT_MAX_BYTES = 32 * 1024 * 1024;

export interface BackupDocument {
  schema: typeof BACKUP_SCHEMA;
  app: 'tsuzuku';
  exportedAt: number;
  contentVersion: string;
  meta: SaveMeta;
  shards: Record<string, CardShard>;
  log: ReviewLog;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Export                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** The store's cards grouped into shard documents (same shape as storage). */
export function collectShards(): Record<string, CardShard> {
  const out: Record<string, CardShard> = {};
  storeCards.forEach((k, t) => {
    const id = shardOfKey(k);
    let s = out[id];
    if (!s) {
      const { kind, level } = parseShardId(id);
      s = { schema: 'tsuzuku.cards/1', kind, level, cards: {} };
      out[id] = s;
    }
    s.cards[k] = t;
  });
  return out;
}

export function buildBackup(): BackupDocument {
  const meta = store.meta();
  return {
    schema: BACKUP_SCHEMA,
    app: 'tsuzuku',
    exportedAt: store.now(),
    contentVersion: meta.contentVersion,
    meta,
    shards: collectShards(),
    log: { schema: LOG_SCHEMA, entries: store.log.recent(LOG_RING) },
  };
}

type Bytes = Uint8Array<ArrayBuffer>;

function fromBytes(bytes: Bytes): ReadableStream<Bytes> {
  return new ReadableStream<Bytes>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

async function gzipBytes(text: string): Promise<Bytes> {
  const input: Bytes = new TextEncoder().encode(text);
  return pump(fromBytes(input).pipeThrough(new CompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>));
}

/** Inflate gzip bytes, never past `IMPORT_MAX_BYTES` (`InflateLimitError`). */
async function gunzipBytes(bytes: Bytes): Promise<string> {
  const out = await pump(fromBytes(bytes).pipeThrough(new DecompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>), IMPORT_MAX_BYTES);
  return new TextDecoder().decode(out);
}

/** Blob → bytes; falls back to FileReader where `Blob.arrayBuffer` is missing (jsdom, old WebViews). */
export function readBlobBytes(blob: Blob): Promise<Bytes> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b) as Bytes);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer) as Bytes);
    r.readAsArrayBuffer(blob);
  });
}

/** Blob → text (UTF-8). */
export async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await readBlobBytes(blob));
}

export function backupFilename(day: EpochDay, gzip: boolean): string {
  return `${S.backupFilename}-${isoDate(day)}${gzip ? '.tsuzuku.json.gz' : '.json'}`;
}

export async function exportSave(o: { gzip?: boolean } = {}): Promise<{ blob: Blob; filename: string }> {
  // Count the export first so the file itself carries it (a restore keeps 備えあれば).
  store.patch('stats', (s) => ({ ...s, exports: s.exports + 1 }));
  const json = JSON.stringify(buildBackup());
  const gzip = !!o.gzip && hasCompression();
  let blob: Blob;
  if (gzip) {
    const bytes = await gzipBytes(json);
    blob = new Blob([bytes as BlobPart], { type: 'application/gzip' });
  } else {
    blob = new Blob([json], { type: 'application/json' });
  }
  bus.emit('backup:exported', {});
  return { blob, filename: backupFilename(store.today(), gzip) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Preview                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ImportData {
  meta: SaveMeta;
  cards: Record<CardKey, CardTuple>;
  /** Shard id per card (placement hint for kanji on `replace`). */
  shardOf: Record<CardKey, ShardId>;
  log: LogEntry[];
}

export interface ImportSummary {
  /** [current, incoming] */
  streak: [number, number];
  xp: [number, number];
  cards: [number, number];
  badges: [number, number];
  days: [number, number];
  /** Cards in the backup this browser does not have. */
  cardsGained: number;
  /** Cards this browser has that the backup lacks (lost on `replace`, kept on `merge`). */
  cardsLost: number;
  /** Learner name [current, incoming] — so a merge preview shows an identity change. */
  name: [string, string];
}

export interface ImportPreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: ImportSummary;
  exportedAt?: number;
  contentVersion?: string;
  data?: ImportData;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function emptySummary(): ImportSummary {
  const m = store.meta();
  const c = storeCards.count();
  return {
    streak: [m.streak.current, 0],
    xp: [m.profile.xp, 0],
    cards: [c, 0],
    badges: [Object.keys(m.collections.badges).length, 0],
    days: [m.streak.totalDays, 0],
    cardsGained: 0,
    cardsLost: c,
    name: [m.profile.name, ''],
  };
}

function invalid(errors: string[], warnings: string[] = []): ImportPreview {
  return { valid: false, errors, warnings, summary: emptySummary() };
}

/** Gzip magic read as text: 0x1f then 0x8b (Latin-1) or U+FFFD (UTF-8 decoding of the invalid byte). */
function looksBinary(text: string): boolean {
  const second = text.charCodeAt(1);
  return text.charCodeAt(0) === 0x1f && (second === 0x8b || second === 0xfffd);
}

export function previewImport(json: string): ImportPreview {
  if (json.length > IMPORT_MAX_BYTES) return invalid([S.importTooLarge]);
  const text = json.trim();
  if (text.length === 0) return invalid([S.importNotJson]);
  if (isCompressed(text) || looksBinary(text)) return invalid([S.importCompressed]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid([S.importNotJson]);
  }
  if (!isObject(parsed)) return invalid([S.importNotBackup]);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof parsed.schema === 'string' && parsed.schema.startsWith('tsuzuku.backup/')) {
    const v = Number(parsed.schema.slice('tsuzuku.backup/'.length));
    if (Number.isFinite(v) && v > BACKUP_VERSION) return invalid([S.importNewer]);
  }

  let rawMeta: unknown;
  let rawShards: unknown;
  let rawLog: unknown;
  if (isObject(parsed.meta)) {
    rawMeta = parsed.meta;
    rawShards = parsed.shards;
    rawLog = parsed.log;
  } else if (isObject(parsed.profile) && isObject(parsed.settings)) {
    rawMeta = parsed;
  } else {
    return invalid([S.importNotBackup]);
  }

  let meta: SaveMeta;
  try {
    const checked = migrateMetaChecked(rawMeta);
    meta = checked.meta;
    if (checked.coerced.length > 0) warnings.push(S.importRepaired);
  } catch (e) {
    if (e instanceof MigrationError && /newer/.test(e.message)) return invalid([S.importNewer]);
    return invalid([S.importNotBackup]);
  }

  const cards: Record<CardKey, CardTuple> = {};
  const shardOf: Record<CardKey, ShardId> = {};
  const shardList: unknown[] = Array.isArray(rawShards) ? rawShards : isObject(rawShards) ? Object.values(rawShards) : [];
  for (const raw of shardList) {
    try {
      const shard = migrateShard(raw);
      const id: ShardId = `${shard.kind}.${shard.level}`;
      for (const [k, t] of Object.entries(shard.cards) as [CardKey, CardTuple][]) {
        const prev = cards[k];
        cards[k] = prev ? newerCard(prev, t) : t;
        shardOf[k] = id;
      }
    } catch {
      warnings.push(S.importNoShard);
    }
  }

  let log: LogEntry[] = [];
  if (rawLog !== undefined && rawLog !== null) {
    try {
      log = migrateLog(rawLog);
    } catch {
      warnings.push(S.importNoLog);
    }
  }

  const cur = store.meta();
  const incomingKeys = Object.keys(cards) as CardKey[];
  let gained = 0;
  for (const k of incomingKeys) if (!storeCards.get(k)) gained++;
  let lost = 0;
  storeCards.forEach((k) => {
    if (!cards[k]) lost++;
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      streak: [cur.streak.current, meta.streak.current],
      xp: [cur.profile.xp, meta.profile.xp],
      cards: [storeCards.count(), incomingKeys.length],
      badges: [Object.keys(cur.collections.badges).length, Object.keys(meta.collections.badges).length],
      days: [cur.streak.totalDays, meta.streak.totalDays],
      cardsGained: gained,
      cardsLost: lost,
      name: [cur.profile.name, meta.profile.name],
    },
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : undefined,
    contentVersion: meta.contentVersion,
    data: { meta, cards, shardOf, log },
  };
}

/** The file itself: gzip bytes, `gz1:` base64 text, or plain JSON text. Over `IMPORT_MAX_BYTES` is refused unread. */
export async function previewImportBlob(src: Blob | ArrayBuffer | Uint8Array | string): Promise<ImportPreview> {
  if (typeof src === 'string') {
    if (src.length > IMPORT_MAX_BYTES) return invalid([S.importTooLarge]);
    if (isCompressed(src)) {
      if (!hasCompression()) return invalid([S.importCompressed]);
      try {
        return previewImport(await gunzipText(src, IMPORT_MAX_BYTES));
      } catch (e) {
        return invalid([e instanceof InflateLimitError ? S.importTooLarge : S.importNotJson]);
      }
    }
    return previewImport(src);
  }
  const size = src instanceof Uint8Array ? src.byteLength : src instanceof ArrayBuffer ? src.byteLength : (src as { size?: unknown }).size;
  if (typeof size === 'number' && size > IMPORT_MAX_BYTES) return invalid([S.importTooLarge]);
  let bytes: Bytes;
  if (src instanceof Uint8Array) bytes = new Uint8Array(src) as Bytes;
  else if (src instanceof ArrayBuffer) bytes = new Uint8Array(src) as Bytes;
  else bytes = await readBlobBytes(src);
  if (bytes.length > IMPORT_MAX_BYTES) return invalid([S.importTooLarge]);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (!hasCompression()) return invalid([S.importCompressed]);
    try {
      return previewImport(await gunzipBytes(bytes));
    } catch (e) {
      return invalid([e instanceof InflateLimitError ? S.importTooLarge : S.importNotJson]);
    }
  }
  return previewImportBlob(new TextDecoder().decode(bytes));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Merge (pure)                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function union<T>(a: readonly T[], b: readonly T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}

function beltRank(b: Belt): number {
  return BELT_IDS.indexOf(b);
}

function minPositive(a: number, b: number): number {
  if (a <= 0) return b;
  if (b <= 0) return a;
  return Math.min(a, b);
}

function mergeStreak(a: Streak, b: Streak): Streak {
  const later = b.lastDay > a.lastDay ? b : a;
  const out: Streak = {
    ...later,
    current: Math.max(a.current, b.current),
    longest: Math.max(a.longest, b.longest),
    lastDay: Math.max(a.lastDay, b.lastDay),
    totalDays: Math.max(a.totalDays, b.totalDays),
    freezes: Math.min(3, Math.max(a.freezes, b.freezes)),
    repairs: Math.max(a.repairs, b.repairs),
    restDaysTaken: Math.max(a.restDaysTaken, b.restDaysTaken),
    weekly: Math.max(a.weekly, b.weekly),
    emberRestores: Math.max(a.emberRestores, b.emberRestores),
  };
  return out;
}

function mergeProgress(a: Progress, b: Progress): Progress {
  const attempts: Record<number, number> = { ...a.gateAttempts };
  for (const [k, v] of Object.entries(b.gateAttempts)) attempts[Number(k)] = Math.max(attempts[Number(k)] ?? 0, v);
  const further = b.station > a.station ? b : a;
  const out: Progress = {
    ...a,
    station: Math.max(a.station, b.station),
    stationsCleared: union(a.stationsCleared, b.stationsCleared).sort((x, y) => x - y),
    perfectGates: Math.max(a.perfectGates, b.perfectGates),
    assisted: union(a.assisted, b.assisted).sort((x, y) => x - y),
    gateAttempts: attempts,
    grudge: union(a.grudge, b.grudge),
    shinsaPassed: union(a.shinsaPassed, b.shinsaPassed).sort((x, y) => beltRank(x) - beltRank(y)),
    shinsaNotes: further.shinsaNotes ?? a.shinsaNotes ?? b.shinsaNotes,
  };
  if (a.storiesRead || b.storiesRead) out.storiesRead = union(a.storiesRead ?? [], b.storiesRead ?? []);
  // design 08 §10–§11: a text heard or a teach card seen on either device stays heard / seen.
  if (a.listened || b.listened) out.listened = union(a.listened ?? [], b.listened ?? []);
  if (a.teachSeen || b.teachSeen) out.teachSeen = union(a.teachSeen ?? [], b.teachSeen ?? []);
  // design 08 §10.2: the Arena's last pass per text — the later day of the two devices wins; absent on both stays absent.
  if (a.arenaAt || b.arenaAt) {
    const at: Record<string, EpochDay> = { ...(a.arenaAt ?? {}) };
    for (const [k, v] of Object.entries(b.arenaAt ?? {})) at[k] = Math.max(at[k] ?? 0, v);
    out.arenaAt = at;
  }
  if (a.gateAttemptDay || b.gateAttemptDay) {
    const days: Record<number, EpochDay> = { ...(a.gateAttemptDay ?? {}) };
    for (const [k, v] of Object.entries(b.gateAttemptDay ?? {})) days[Number(k)] = Math.max(days[Number(k)] ?? 0, v);
    out.gateAttemptDay = days;
  }
  if (a.gateAttemptAt || b.gateAttemptAt) {
    const at: Record<number, number> = { ...(a.gateAttemptAt ?? {}) };
    for (const [k, v] of Object.entries(b.gateAttemptAt ?? {})) at[Number(k)] = Math.max(at[Number(k)] ?? 0, v);
    out.gateAttemptAt = at;
  }
  return out;
}

function mergeCollections(a: Collections, b: Collections): Collections {
  const badges: Collections['badges'] = { ...a.badges };
  for (const [id, day] of Object.entries(b.badges) as [keyof Collections['badges'], EpochDay][]) {
    const cur = badges[id];
    badges[id] = cur === undefined ? day : Math.min(cur, day);
  }
  const wallpapers: Collections['wallpapers'] = { ...a.wallpapers };
  for (const [id, w] of Object.entries(b.wallpapers) as [keyof Collections['wallpapers'], NonNullable<Collections['wallpapers'][keyof Collections['wallpapers']]>][]) {
    const cur = wallpapers[id];
    if (!cur) {
      wallpapers[id] = w;
      continue;
    }
    const merged = {
      ...cur,
      at: Math.min(cur.at, w.at),
      reforges: Math.max(cur.reforges, w.reforges),
      revealed: Math.max(cur.revealed, w.revealed) as 0 | 1 | 2 | 3 | 4,
    };
    const lr = Math.max(cur.lastReforgeDay ?? 0, w.lastReforgeDay ?? 0);
    if (lr > 0) merged.lastReforgeDay = lr;
    if (!merged.sentenceOfChoice && w.sentenceOfChoice) merged.sentenceOfChoice = w.sentenceOfChoice;
    if (!merged.sealKanji && w.sealKanji) merged.sealKanji = w.sealKanji;
    wallpapers[id] = merged;
  }
  const stamps: Collections['stamps'] = { ...a.stamps };
  for (const [k, s] of Object.entries(b.stamps)) {
    const n = Number(k);
    const cur = stamps[n];
    stamps[n] = cur ? { at: Math.min(cur.at, s.at), perfect: cur.perfect || s.perfect, assisted: cur.assisted && s.assisted } : s;
  }
  return { badges, wallpapers, stamps, michikusa: union(a.michikusa, b.michikusa) };
}

function mergeKage(a: KageState, b: KageState): KageState {
  const byWeek = new Map<number, number>();
  // `fillMeta` already drops malformed rows; the shape check here keeps a hand-edited live save from throwing.
  for (const row of [...a.history, ...b.history]) {
    if (!Array.isArray(row) || row.length !== 2) continue;
    const [w, s] = row;
    byWeek.set(w, Math.max(byWeek.get(w) ?? 0, s));
  }
  const history = Array.from(byWeek.entries()).sort((x, y) => x[0] - y[0]) as [number, number][];
  const out: KageState = {
    week: Math.max(a.week, b.week),
    best4: history.slice(-4).map(([, s]) => s),
    wins: Math.max(a.wins, b.wins),
    history,
  };
  const beaten = Math.max(a.beatenWeek ?? 0, b.beatenWeek ?? 0);
  if (beaten > 0) out.beatenWeek = beaten;
  return out;
}

function mergeWeakPoints(a: WeakPoints, b: WeakPoints): WeakPoints {
  const out = { ...a } as WeakPoints;
  for (const tag of Object.keys(b) as (keyof WeakPoints)[]) {
    const x = a[tag];
    const y = b[tag];
    if (!x || (y && y.n > x.n)) out[tag] = y;
  }
  return out;
}

/** A row the dojo wrote itself — `source: app` and no note (a set, a read, a Radio / Read-along track). */
const isAppRow = (e: LedgerEntry): boolean => e[3] === 0 && e[4] === undefined;
const dayKind = (e: LedgerEntry): string => `${e[0]}|${e[2]}`;
/** Minutes in tenths (`MINUTE_DECIMALS`), so `10 + 6.7` and `16.7` compare equal. */
const tenths = (minutes: number): number => Math.round(minutes * 10 ** MINUTE_DECIMALS);

/** App minutes per day and kind. */
function appDaySums(l: Ledger): Map<string, number> {
  const sums = new Map<string, number>();
  for (const e of l.entries) {
    if (!Array.isArray(e) || !isAppRow(e)) continue;
    const k = dayKind(e);
    sums.set(k, (sums.get(k) ?? 0) + e[1]);
  }
  return sums;
}

/**
 * Design 07 §5 / design 08 §12. App rows (`isAppRow`) are compared per day
 * and kind and the side with the LARGER sum keeps its rows as they are (a tie
 * keeps this browser's) — never both: since design 08 today's Radio minutes
 * coalesce INTO a row, so an export of this device taken earlier in the day
 * holds a smaller copy of a row that has since grown, and a union would count
 * it twice. The larger-side rule is the one `mergeDaily` and `monthly` use;
 * it never inflates. Two devices that both heard on one day keep the larger
 * side only (the identity union already folded byte-identical rows). Outside
 * rows and noted rows, which never change once written, union by identity.
 */
function mergeLedger(a: Ledger, b: Ledger): Ledger {
  const sumsA = appDaySums(a);
  const sumsB = appDaySums(b);
  const seen = new Set<string>();
  const entries: LedgerEntry[] = [];
  const take = (l: Ledger, mine: Map<string, number>, theirs: Map<string, number>, tieWins: boolean): void => {
    for (const e of l.entries) {
      if (!Array.isArray(e)) continue; // see mergeKage
      if (isAppRow(e)) {
        const k = dayKind(e);
        const x = tenths(mine.get(k) ?? 0);
        const y = tenths(theirs.get(k) ?? 0);
        if (x > y || (x === y && tieWins)) entries.push(e);
        continue;
      }
      const key = e.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(e);
    }
  };
  take(a, sumsA, sumsB, true);
  take(b, sumsB, sumsA, false);
  entries.sort((x, y) => x[0] - y[0]);
  const monthly: Record<string, number> = { ...a.monthly };
  for (const [k, v] of Object.entries(b.monthly)) monthly[k] = Math.max(monthly[k] ?? 0, v);
  const mseen = new Set(a.missions.map((m) => `${m.day}|${m.tier}`));
  const missions = [...a.missions];
  for (const m of b.missions) {
    const key = `${m.day}|${m.tier}`;
    if (mseen.has(key)) continue;
    mseen.add(key);
    missions.push(m);
  }
  missions.sort((x, y) => x.day - y.day);
  return { entries, monthly, missions };
}

function mergeDaily(a: Record<EpochDay, DailyRow>, b: Record<EpochDay, DailyRow>): Record<EpochDay, DailyRow> {
  const out: Record<EpochDay, DailyRow> = { ...a };
  for (const [k, row] of Object.entries(b)) {
    const d = Number(k);
    const cur = out[d];
    if (!cur || row.reps > cur.reps || (row.reps === cur.reps && row.minutes > cur.minutes)) out[d] = row;
  }
  return out;
}

/** No session, day, XP, goal or known kana yet: the browser has never met a learner (the shell's first-run rule). */
export function hasNoLearnerTrace(m: SaveMeta): boolean {
  return m.stats.sessions === 0 && m.streak.totalDays === 0 && m.profile.xp === 0 && m.profile.goals.length === 0 && m.profile.kanaKnown.length === 0;
}

/**
 * Design 07 §5 merge: streak max, XP max, collections union, ledger by
 * `mergeLedger` (app rows: the larger side per day and kind; outside and
 * noted rows: union); settings stay this browser's. Identity (name, nameKana, tz, onboardedAt,
 * dictatedSentence) stays this browser's too — unless this browser holds no
 * learner trace (a fresh install restoring a backup), when the backup's is taken.
 */
export function mergeSaves(cur: SaveMeta, inc: SaveMeta, now: number): SaveMeta {
  const xp = Math.max(cur.profile.xp, inc.profile.xp);
  const stats = { ...cur.stats };
  for (const k of Object.keys(inc.stats) as (keyof SaveMeta['stats'])[]) stats[k] = Math.max(cur.stats[k] ?? 0, inc.stats[k] ?? 0);
  const medianMs = { ...inc.medianMs, ...cur.medianMs };
  const identity = hasNoLearnerTrace(cur) ? inc.profile : cur.profile;
  const profile: SaveMeta['profile'] = {
    ...cur.profile,
    name: identity.name,
    nameKana: identity.nameKana,
    tz: identity.tz,
    xp,
    level: levelFor(xp),
    belt: beltRank(inc.profile.belt) > beltRank(cur.profile.belt) ? inc.profile.belt : cur.profile.belt,
    dan: Math.max(cur.profile.dan, inc.profile.dan),
    startedAt: minPositive(cur.profile.startedAt, inc.profile.startedAt),
    goals: cur.profile.goals.length > 0 ? cur.profile.goals : inc.profile.goals,
    kanaKnown: union(cur.profile.kanaKnown, inc.profile.kanaKnown),
  };
  const chosen = cur.profile.chosenKanji ?? inc.profile.chosenKanji;
  if (chosen !== undefined) profile.chosenKanji = chosen;
  const dictated = identity.dictatedSentence ?? cur.profile.dictatedSentence ?? inc.profile.dictatedSentence;
  if (dictated !== undefined) profile.dictatedSentence = dictated;
  else delete profile.dictatedSentence;
  const onboarded = identity.onboardedAt ?? cur.profile.onboardedAt ?? inc.profile.onboardedAt;
  if (onboarded !== undefined) profile.onboardedAt = onboarded;
  else delete profile.onboardedAt;
  return {
    schema: SAVE_SCHEMA,
    seed: cur.seed,
    createdAt: minPositive(cur.createdAt, inc.createdAt),
    updatedAt: now,
    contentVersion: cur.contentVersion || inc.contentVersion,
    profile,
    settings: cur.settings,
    streak: mergeStreak(cur.streak, inc.streak),
    progress: mergeProgress(cur.progress, inc.progress),
    quests: inc.quests.day > cur.quests.day ? inc.quests : cur.quests,
    collections: mergeCollections(cur.collections, inc.collections),
    kage: mergeKage(cur.kage, inc.kage),
    weakPoints: mergeWeakPoints(cur.weakPoints, inc.weakPoints),
    ledger: mergeLedger(cur.ledger, inc.ledger),
    stats,
    medianMs,
    captured: union(cur.captured, inc.captured),
    bookmarks: union(cur.bookmarks, inc.bookmarks),
    perapera: { months: { ...inc.perapera.months, ...cur.perapera.months } },
    daily: mergeDaily(cur.daily, inc.daily),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Apply                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Slices through `patch()`, then the header (seed, createdAt, contentVersion) that lives outside them. */
function applyMeta(next: SaveMeta): void {
  for (const k of SLICE_KEYS) store.patch(k, () => next[k] as never);
  replaceHeader({ seed: next.seed, createdAt: next.createdAt, contentVersion: next.contentVersion });
}

/** Union by `t|cardKey`, ordered by time; the ring keeps the newest 5,000 by time. */
export function unionLogs(current: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const merged: LogEntry[] = [];
  for (const e of [...current, ...incoming]) {
    if (!Array.isArray(e)) continue;
    const k = `${e[0]}|${e[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  merged.sort((a, b) => a[0] - b[0]);
  return merged.length > LOG_RING ? merged.slice(merged.length - LOG_RING) : merged;
}

function unionLog(incoming: LogEntry[]): void {
  if (incoming.length === 0) return;
  replaceLog(unionLogs(store.log.recent(LOG_RING), incoming));
}

/**
 * Write the previewed save. Returns `true` when something was applied
 * (false for an invalid preview). Flushes persistence; the page should
 * offer a reload so every live view re-reads from the new save.
 */
export function applyImport(p: ImportPreview, mode: 'merge' | 'replace'): boolean {
  if (!p.valid || !p.data) return false;
  const { meta, cards, shardOf, log } = p.data;
  // The pure half first: a throw here changes nothing.
  const cur = store.meta();
  const next = mode === 'replace' ? { ...meta, seed: meta.seed || cur.seed, updatedAt: store.now() } : mergeSaves(cur, meta, store.now());
  next.stats = { ...next.stats, imports: (next.stats.imports ?? 0) + 1 };
  // Everything the write half touches, so a throw mid-way can be undone instead of leaving the meta
  // replaced and the cards half-written (a page-level catch could not put either back).
  const prevCards = new Map<CardKey, { t: CardTuple; level: Level }>();
  storeCards.forEach((k, t) => prevCards.set(k, { t, level: parseShardId(shardOfKey(k)).level }));
  const prevLog = store.log.recent(LOG_RING);
  const prevSession = store.session.load();
  try {
    writeImport(next, mode, cards, shardOf, log);
  } catch (e) {
    batch(() => {
      applyMeta(cur);
      const added: CardKey[] = [];
      storeCards.forEach((k) => {
        if (!prevCards.has(k)) added.push(k);
      });
      for (const k of added) storeCards.delete(k);
      for (const [k, { t, level }] of prevCards) if (storeCards.get(k) !== t) storeCards.set(k, t, { level });
      replaceLog(prevLog);
      if (prevSession) store.session.save(prevSession);
    });
    throw e;
  }
  void store.flush();
  return true;
}

function writeImport(next: SaveMeta, mode: 'merge' | 'replace', cards: Record<CardKey, CardTuple>, shardOf: Record<CardKey, ShardId>, log: LogEntry[]): void {
  // One batch: every slice patch and card write lands before the unlock effect (and any other
  // `cards.version` reader) runs, so a 20,000-card save costs one evaluation, not 20,000.
  batch(() => {
    applyMeta(next);

    if (mode === 'replace') {
      const keep = new Set(Object.keys(cards));
      const drop: CardKey[] = [];
      storeCards.forEach((k) => {
        if (!keep.has(k)) drop.push(k);
      });
      for (const k of drop) storeCards.delete(k);
      for (const [k, t] of Object.entries(cards) as [CardKey, CardTuple][]) {
        const id = shardOf[k];
        storeCards.set(k, t, id ? { level: parseShardId(id).level } : undefined);
      }
    } else {
      for (const [k, t] of Object.entries(cards) as [CardKey, CardTuple][]) {
        const prev = storeCards.get(k);
        const id = shardOf[k];
        if (!prev) storeCards.set(k, t, id ? { level: parseShardId(id).level } : undefined);
        else if (newerCard(prev, t) !== prev) storeCards.set(k, t);
      }
    }
    unionLog(log);
    // A half-finished session was planned against the cards this browser had a moment ago.
    store.session.clear();
  });
}
