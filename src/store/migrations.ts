/**
 * TSUZUKU — save schema migrations (store group B).
 *
 * Versioned chains for the three persisted documents (`tsuzuku.save/N`,
 * `tsuzuku.cards/N`, `tsuzuku.log/N`). v0 = a pre-schema document (no
 * `schema` field); v0 → v1 fills defaults and is the identity on a complete
 * v1 document. Later versions register a step in `*_STEPS`. Every function is
 * pure and idempotent; unknown or newer schemas throw `MigrationError` so the
 * caller can stash the raw document instead of overwriting it.
 *
 * `fillMeta` is type-aware against `freshSave()` as the template: a field
 * whose runtime kind differs from the default (a string where a number
 * belongs, `null`, `Infinity`, an object for an array…) falls back to the
 * default, recursively through nested objects. Beyond kinds it checks
 * values: the closed unions of `settings` (intensity, feel, theme, furigana,
 * speaking, speedTier 1–5, retention, restDay 0–6, sound 0–1), `profile.belt`
 * a known belt, `profile.tz` a zone the host resolves (`shared/time.safeTz`,
 * else `'UTC'`); array elements by slice (`ELEMENT_GUARDS`: card keys in
 * `grudge`, belts in `shinsaPassed`, stations 0–53, ledger/kage tuples,
 * capped strings elsewhere); record values by shape (`RECORD_GUARDS`: daily
 * rows, stamps, badges, wallpapers, gate attempts, medians, perapera months);
 * and the header strings (`seed` ≤ 64 chars, name/nameKana ≤ `NAME_MAX_GLYPHS`
 * (24) code points — the same cap onboarding types against, so an imported or
 * hand-edited save never lays out more than the wallpapers' safe zone holds —
 * `chosenKanji` exactly one glyph). Other keys the template lacks (optional
 * fields) pass through untouched. `migrateMetaChecked` also reports the
 * repaired paths so an import can warn. A save that finished onboarding
 * (goals set, or any training recorded) while `progress.station` is still 0
 * is lifted to the first station past its cleared gates (Nihonbashi is
 * onboarding only).
 *
 * Listening (design 08 §11–§13): `settings.audioSource` is checked against its
 * closed union (`'pack' | 'device'`, else `'pack'`); `progress.listened` /
 * `teachSeen` keep only id-like strings (`ID_LIKE`, ≤ `ID_MAX` glyphs — a
 * truncated id names nothing, so a bad entry is dropped, never cut) and are
 * capped at `LISTENED_MAX` / `TEACH_SEEN_MAX` newest entries (`ARRAY_CAPS`);
 * `progress.arenaAt` (optional, the Arena's last pass per text — `checkArenaAt`)
 * keeps id-like keys whose value is a non-negative integer EpochDay, drops the
 * rest, is capped at `ARENA_AT_MAX` entries keeping the NEWEST days, and is
 * left absent on a save that never had it — a non-object, or an object with
 * nothing valid left, is removed rather than kept as `{}`; design 09's optional
 * `progress.arrivedDay` / `sceneSeen` / `stationSeen` are kept when valid and
 * dropped (reported) otherwise (`checkSeen`);
 * a save from before the listening counters is seeded with
 * `stats.bestCleanTier = settings.speedTier` so no 耳 radar drops on upgrade
 * (a new save starts at `FRESH_BEST_CLEAN_TIER`). Additive fields need no
 * schema bump: `freshSave()` is the template and the per-slice fill does the rest.
 *
 * `applyRedirects` is the id-rename pass driven by `ContentManifest.redirects`.
 */
import { BELT_IDS, FACETS, LEVELS, type CardKey } from '../content/types';
import {
  CARDS_SCHEMA,
  LEDGER_KINDS,
  LEDGER_SOURCES,
  LOG_SCHEMA,
  NAME_MAX_GLYPHS,
  SAVE_SCHEMA,
  SHARD_KINDS,
  SLICE_KEYS,
  type CardShard,
  type CardTuple,
  type Feel,
  type FuriganaMode,
  type Intensity,
  type LogEntry,
  type Profile,
  type Progress,
  type Retention,
  type SaveMeta,
  type Settings,
  type SpeakingMode,
  type Theme,
} from '../shared/store-types';
import { safeTz } from '../shared/time';
import { freshSave } from './defaults';

export const CURRENT = { meta: 1, cards: 1, log: 1 } as const;

export class MigrationError extends Error {
  readonly doc: 'meta' | 'cards' | 'log';
  readonly schema: unknown;
  constructor(doc: 'meta' | 'cards' | 'log', message: string, schema?: unknown) {
    super(`migrate ${doc}: ${message}`);
    this.name = 'MigrationError';
    this.doc = doc;
    this.schema = schema;
  }
}

type Raw = Record<string, unknown>;
type Step = (raw: Raw) => Raw;

function isObject(x: unknown): x is Raw {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** `tsuzuku.save/3` → 3; absent → 0; malformed → null. */
function versionOf(doc: 'meta' | 'cards' | 'log', raw: Raw): number | null {
  const prefix = { meta: 'tsuzuku.save/', cards: 'tsuzuku.cards/', log: 'tsuzuku.log/' }[doc];
  const s = raw.schema;
  if (s === undefined) return 0;
  if (typeof s !== 'string' || !s.startsWith(prefix)) return null;
  const n = Number(s.slice(prefix.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function runChain(doc: 'meta' | 'cards' | 'log', raw: Raw, steps: Record<number, Step>, current: number): Raw {
  const v = versionOf(doc, raw);
  if (v === null) throw new MigrationError(doc, `unknown schema "${String(raw.schema)}"`, raw.schema);
  if (v > current) throw new MigrationError(doc, `schema version ${v} is newer than this build (${current})`, raw.schema);
  let out = raw;
  for (let i = v; i < current; i++) {
    const step = steps[i];
    if (!step) throw new MigrationError(doc, `no migration step from version ${i}`, raw.schema);
    out = step(out);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* meta                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const META_STEPS: Record<number, Step> = {
  /** v0 (no schema) → v1: stamp the schema; defaults are filled afterwards. */
  0: (raw) => ({ ...raw, schema: SAVE_SCHEMA }),
  // Future: 1: (raw) => ({ ...raw, schema: 'tsuzuku.save/2', ... }),
};

function num(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

const BELT_SET: ReadonlySet<string> = new Set(BELT_IDS);
const FACET_SET: ReadonlySet<string> = new Set(FACETS);

function isCardKeyString(k: unknown): k is CardKey {
  if (typeof k !== 'string') return false;
  const i = k.lastIndexOf('#');
  return i > 0 && FACET_SET.has(k.slice(i + 1));
}

function isFinite_(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isInt(x: unknown, lo: number, hi: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
}

/** Glyph-capped string; `undefined` for a non-string. Returns the input itself when already within the cap. */
function cappedString(x: unknown, max: number): string | undefined {
  if (typeof x !== 'string') return undefined;
  const glyphs = Array.from(x);
  return glyphs.length <= max ? x : glyphs.slice(0, max).join('');
}

/** Longest free-text field (bookmarks, dictated sentence). */
const TEXT_MAX = 500;
/** Content ids, quest ids, goals. */
const ID_MAX = 64;
/** `profile.name` / `profile.nameKana` cap (shared with onboarding and the art tier). */
const NAME_MAX = NAME_MAX_GLYPHS;
const SEED_MAX = 64;

/** An element guard returns the (possibly repaired) element, or `undefined` to drop it. */
type Guard = (x: unknown) => unknown;

const str = (max: number): Guard => (x) => cappedString(x, max);
const station: Guard = (x) => (isInt(x, 0, 53) ? x : undefined);

/**
 * Text ids heard / teach cards seen (design 08 §10–§11): lowercase ASCII ids such as
 * `s-07-2` or `morae-beats`. Prose, capitals, non-strings and oversize are dropped, not cut.
 */
const ID_LIKE = /^[a-z0-9][a-z0-9#:._-]*$/;
const idLike: Guard = (x) => (typeof x === 'string' && x.length <= ID_MAX && ID_LIKE.test(x) ? x : undefined);

/** Newest entries kept in `progress.listened` (design 08 §11; 237 texts + kana tracks, with room for release trains). */
export const LISTENED_MAX = 4096;
/** Newest entries kept in `progress.teachSeen` (design 08 §11; a few dozen teach cards exist). */
export const TEACH_SEEN_MAX = 256;
/** Entries kept in `progress.arenaAt` (design 08 §10.2; 237 texts, with room for release trains) — the newest days survive the cap. */
export const ARENA_AT_MAX = 1024;
/** Per-array caps keyed by template path; arrays not listed are uncapped. */
const ARRAY_CAPS: Record<string, number> = {
  'progress.listened': LISTENED_MAX,
  'progress.teachSeen': TEACH_SEEN_MAX,
};

function ledgerEntry(x: unknown): unknown {
  if (!Array.isArray(x) || x.length < 4 || x.length > 5) return undefined;
  const [day, minutes, kind, source, note] = x as unknown[];
  if (!isFinite_(day) || !isFinite_(minutes) || minutes < 0) return undefined;
  if (!isInt(kind, 0, LEDGER_KINDS.length - 1) || !isInt(source, 0, LEDGER_SOURCES.length - 1)) return undefined;
  if (note === undefined) return x.length === 4 ? x : [day, minutes, kind, source];
  const n = cappedString(note, TEXT_MAX);
  return n === undefined ? [day, minutes, kind, source] : n === note ? x : [day, minutes, kind, source, n];
}

/** Per-array element guards keyed by template path; arrays not listed only drop `null`/`undefined`. */
const ELEMENT_GUARDS: Record<string, Guard> = {
  'profile.goals': str(ID_MAX),
  'profile.kanaKnown': str(ID_MAX),
  'progress.stationsCleared': station,
  'progress.assisted': station,
  'progress.grudge': (x) => (isCardKeyString(x) ? x : undefined),
  'progress.shinsaPassed': (x) => (typeof x === 'string' && BELT_SET.has(x) ? x : undefined),
  'progress.storiesRead': str(ID_MAX),
  'progress.listened': idLike,
  'progress.teachSeen': idLike,
  'quests.ids': str(ID_MAX),
  'quests.done': str(ID_MAX),
  'collections.michikusa': str(ID_MAX),
  'kage.best4': (x) => (isFinite_(x) ? x : undefined),
  'kage.history': (x) => (Array.isArray(x) && x.length === 2 && isFinite_(x[0]) && isFinite_(x[1]) ? x : undefined),
  'ledger.entries': ledgerEntry,
  'ledger.missions': (x) => (isObject(x) && isFinite_(x.day) && isInt(x.tier, 1, 5) && typeof x.conversation === 'boolean' ? x : undefined),
  captured: str(ID_MAX),
  bookmarks: str(TEXT_MAX),
};

const DAILY_FIELDS = ['reps', 'ok', 'minutes', 'xp', 'input'] as const;

/** Per-record value guards keyed by template path (records are `{}` in `freshSave`, so their entries need their own check). */
const RECORD_GUARDS: Record<string, Guard> = {
  'progress.gateAttempts': (v) => (isFinite_(v) ? v : undefined),
  'progress.gateAttemptDay': (v) => (isFinite_(v) ? v : undefined),
  'progress.gateAttemptAt': (v) => (isFinite_(v) ? v : undefined),
  'collections.badges': (v) => (isFinite_(v) ? v : undefined),
  'collections.wallpapers': (v) => (isObject(v) && isFinite_(v.at) && isFinite_(v.reforges) && isInt(v.revealed, 0, 4) ? v : undefined),
  'collections.stamps': (v) => (isObject(v) && isFinite_(v.at) && typeof v.perfect === 'boolean' && typeof v.assisted === 'boolean' ? v : undefined),
  'ledger.monthly': (v) => (isFinite_(v) ? v : undefined),
  medianMs: (v) => (isFinite_(v) ? v : undefined),
  'perapera.months': (v) => (Array.isArray(v) && v.length === 5 && v.every(isFinite_) ? v : undefined),
  daily: (v) => (isObject(v) && DAILY_FIELDS.every((f) => isFinite_(v[f])) ? v : undefined),
};

/**
 * `have` if its runtime kind matches `def`, else `def`; objects recurse key
 * by key (keys absent from `def` pass through, record values through
 * `RECORD_GUARDS`), arrays drop `null`/`undefined` entries and whatever the
 * path's `ELEMENT_GUARDS` entry rejects. Repaired paths are appended to `coerced`.
 */
function coerce(def: unknown, have: unknown, path: string, coerced: string[]): unknown {
  if (have === undefined) return def;
  if (def === null) {
    if (have === null || isFinite_(have)) return have;
    coerced.push(path);
    return def;
  }
  if (Array.isArray(def)) {
    if (!Array.isArray(have)) {
      coerced.push(path);
      return def;
    }
    const guard = ELEMENT_GUARDS[path];
    const clean: unknown[] = [];
    let changed = false;
    for (const x of have) {
      const y = x === null || x === undefined ? undefined : guard ? guard(x) : x;
      if (y === undefined) changed = true;
      else {
        if (y !== x) changed = true;
        clean.push(y);
      }
    }
    const cap = ARRAY_CAPS[path];
    const kept = cap !== undefined && clean.length > cap ? clean.slice(clean.length - cap) : clean;
    if (changed || kept !== clean) coerced.push(path);
    return kept;
  }
  if (isObject(def)) {
    if (!isObject(have)) {
      coerced.push(path);
      return def;
    }
    const out: Raw = { ...have };
    for (const [k, dv] of Object.entries(def)) out[k] = coerce(dv, have[k], `${path}.${k}`, coerced);
    const guard = RECORD_GUARDS[path];
    if (guard) {
      let changed = false;
      for (const [k, v] of Object.entries(have)) {
        if (k in def) continue;
        const y = guard(v);
        if (y === undefined) {
          delete out[k];
          changed = true;
        } else out[k] = y;
      }
      if (changed) coerced.push(path);
    }
    return out;
  }
  const kind = typeof def;
  if (typeof have === kind && (kind !== 'number' || Number.isFinite(have))) return have;
  coerced.push(path);
  return def;
}

const INTENSITIES: ReadonlySet<string> = new Set<Intensity>(['casual', 'standard', 'intense', 'custom']);
const FEELS: ReadonlySet<string> = new Set<Feel>(['zen', 'dojo', 'arcade']);
const THEMES: ReadonlySet<string> = new Set<Theme>(['auto', 'light', 'dark', 'sky']);
const FURIGANA: ReadonlySet<string> = new Set<FuriganaMode>(['always', 'fog', 'tap', 'off']);
const SPEAKING: ReadonlySet<string> = new Set<SpeakingMode>(['auto', 'recognition', 'self', 'off']);
const RETENTIONS: ReadonlySet<number> = new Set<Retention>([0.85, 0.9, 0.95]);
/** design 08 §13 `Settings.audioSource`: the voice pack or the device voice. */
const AUDIO_SOURCES: ReadonlySet<string> = new Set<Settings['audioSource']>(['pack', 'device']);

/** Closed unions and ranges of `settings` (kinds alone let `intensity: 'bogus'` NaN the new-item budget). */
function checkSettings(st: Settings, d: Settings, coerced: string[]): Settings {
  const out = { ...st };
  const fix = <K extends keyof Settings>(k: K, ok: boolean): void => {
    if (ok) return;
    out[k] = d[k];
    coerced.push(`settings.${k}`);
  };
  fix('intensity', INTENSITIES.has(st.intensity));
  fix('feel', FEELS.has(st.feel));
  fix('theme', THEMES.has(st.theme));
  fix('furigana', FURIGANA.has(st.furigana));
  fix('speaking', SPEAKING.has(st.speaking));
  fix('speedTier', isInt(st.speedTier, 1, 5));
  fix('retention', RETENTIONS.has(st.retention));
  fix('audioSource', AUDIO_SOURCES.has(st.audioSource));
  fix('restDay', st.restDay === null || isInt(st.restDay, 0, 6));
  if (st.sound < 0 || st.sound > 1) {
    out.sound = Math.min(1, Math.max(0, st.sound));
    coerced.push('settings.sound');
  }
  return out;
}

/** Header strings: belt, zone, lengths, the optional one-glyph `chosenKanji`. */
function checkProfile(pr: Profile, d: Profile, tz: string, coerced: string[]): Profile {
  const out = { ...pr };
  if (!BELT_SET.has(pr.belt)) {
    coerced.push('profile.belt');
    out.belt = d.belt;
  }
  // An unresolvable or unsafe zone id would throw in `Intl` day math and could leak into an ICS line.
  if (pr.tz !== tz) {
    coerced.push('profile.tz');
    out.tz = tz;
  }
  for (const k of ['name', 'nameKana'] as const) {
    const v = cappedString(pr[k], NAME_MAX) as string;
    if (v !== pr[k]) {
      coerced.push(`profile.${k}`);
      out[k] = v;
    }
  }
  if (pr.chosenKanji !== undefined && !(typeof pr.chosenKanji === 'string' && Array.from(pr.chosenKanji).length === 1)) {
    coerced.push('profile.chosenKanji');
    delete out.chosenKanji;
  }
  if (pr.dictatedSentence !== undefined) {
    const v = cappedString(pr.dictatedSentence, TEXT_MAX);
    if (v !== pr.dictatedSentence) {
      coerced.push('profile.dictatedSentence');
      if (v === undefined) delete out.dictatedSentence;
      else out.dictatedSentence = v;
    }
  }
  if (pr.onboardedAt !== undefined && !isFinite_(pr.onboardedAt)) {
    coerced.push('profile.onboardedAt');
    delete out.onboardedAt;
  }
  return out;
}

/**
 * `progress.arenaAt` is optional (not in the `freshSave` template, so `coerce`
 * passes it through): text id → EpochDay of the last passed Arena set. Keys
 * must be id-like, values finite non-negative integers; anything else is
 * dropped, a non-object — or an object with nothing valid left — is removed
 * (one shape for "nothing valid": absent, never `{}`), and over
 * `ARENA_AT_MAX` entries the OLDEST days go (original key order kept). Absent
 * stays absent; an honest `{}` is left as it is.
 */
function checkArenaAt(pr: Progress, coerced: string[]): Progress {
  const have: unknown = pr.arenaAt;
  if (have === undefined) return pr;
  if (!isObject(have)) {
    coerced.push('progress.arenaAt');
    const out = { ...pr };
    delete out.arenaAt;
    return out;
  }
  let changed = false;
  let kept: [string, number][] = [];
  for (const [k, v] of Object.entries(have)) {
    if (idLike(k) !== undefined && isInt(v, 0, Number.MAX_SAFE_INTEGER)) kept.push([k, v]);
    else changed = true;
  }
  if (kept.length > ARENA_AT_MAX) {
    const byDay = kept.map((_, i) => i).sort((a, b) => kept[a][1] - kept[b][1]);
    const drop = new Set(byDay.slice(0, kept.length - ARENA_AT_MAX));
    kept = kept.filter((_, i) => !drop.has(i));
    changed = true;
  }
  if (!changed) return pr;
  coerced.push('progress.arenaAt');
  if (kept.length === 0) {
    const out = { ...pr };
    delete out.arenaAt;
    return out;
  }
  return { ...pr, arenaAt: Object.fromEntries(kept) };
}

/**
 * Design 09's optional `progress` fields (A3; B1 writes `arrivedDay` and
 * `sceneSeen`, C2 writes `stationSeen`). None is in the `freshSave` template,
 * so `coerce` passes them through; this keeps a valid value byte for byte,
 * drops a wrong shape (reported), and leaves absent absent: `arrivedDay` a
 * non-negative integer day, `stationSeen` an integer 0–53, `sceneSeen` a plain
 * object (the JSON snapshot of the Dojo picture).
 */
function checkSeen(pr: Progress, coerced: string[]): Progress {
  let out: Progress | null = null;
  const drop = (k: 'arrivedDay' | 'sceneSeen' | 'stationSeen'): void => {
    if (out === null) out = { ...pr };
    delete out[k];
    coerced.push(`progress.${k}`);
  };
  if (pr.arrivedDay !== undefined && !isInt(pr.arrivedDay, 0, Number.MAX_SAFE_INTEGER)) drop('arrivedDay');
  if (pr.stationSeen !== undefined && !isInt(pr.stationSeen, 0, 53)) drop('stationSeen');
  if (pr.sceneSeen !== undefined && !isObject(pr.sceneSeen)) drop('sceneSeen');
  return out ?? pr;
}

/**
 * Fill every slice with defaults for keys the document lacks (additive fields
 * of newer builds) and repair fields of the wrong type or value (see the module header).
 */
function fillMeta(raw: Raw, coerced: string[]): SaveMeta {
  const tz = safeTz(isObject(raw.profile) && typeof raw.profile.tz === 'string' ? raw.profile.tz : 'UTC');
  const d = freshSave(num(raw.createdAt, 0), tz);
  const out = {} as Record<string, unknown>;
  out.schema = SAVE_SCHEMA;
  if (typeof raw.seed === 'string' && raw.seed.length > 0 && raw.seed.length <= SEED_MAX) out.seed = raw.seed;
  else {
    if (raw.seed !== undefined) coerced.push('seed');
    out.seed = d.seed;
  }
  out.createdAt = num(raw.createdAt, d.createdAt);
  out.updatedAt = num(raw.updatedAt, out.createdAt as number);
  out.contentVersion = typeof raw.contentVersion === 'string' ? raw.contentVersion : '';
  for (const k of SLICE_KEYS) out[k] = coerce(d[k], raw[k], k, coerced);
  const meta = out as unknown as SaveMeta;
  meta.profile = checkProfile(meta.profile, d.profile, tz, coerced);
  meta.settings = checkSettings(meta.settings, d.settings, coerced);
  meta.progress = checkSeen(checkArenaAt(meta.progress, coerced), coerced);
  // design 08 §12: a save from before the listening counters keeps the radar it had — `bestCleanTier` is
  // seeded from the chosen speed tier (a NEW save starts at FRESH_BEST_CLEAN_TIER through freshStats).
  // Additive, not a repair: nothing is pushed to `coerced`.
  if (!isObject(raw.stats) || !isFinite_(raw.stats.bestCleanTier)) meta.stats = { ...meta.stats, bestCleanTier: meta.settings.speedTier };
  // Onboarding done at station 0 (Nihonbashi is onboarding only): lift to the first uncleared station.
  const pr = meta.progress;
  const trained = meta.profile.goals.length > 0 || meta.stats.sessions > 0 || meta.streak.totalDays > 0;
  if (pr.station === 0 && trained) {
    meta.progress = { ...pr, station: Math.min(53, Math.max(1, ...pr.stationsCleared.map((n) => n + 1))) };
  }
  return meta;
}

/** `migrateMeta` plus the paths whose values were repaired to defaults (empty on a well-typed save). */
export function migrateMetaChecked(raw: unknown): { meta: SaveMeta; coerced: string[] } {
  if (!isObject(raw)) throw new MigrationError('meta', 'document is not an object');
  if (raw.schema === undefined && !isObject(raw.profile) && !isObject(raw.settings)) {
    throw new MigrationError('meta', 'document has no schema and does not look like a save');
  }
  const coerced: string[] = [];
  const meta = fillMeta(runChain('meta', raw, META_STEPS, CURRENT.meta), coerced);
  return { meta, coerced };
}

export function migrateMeta(raw: unknown): SaveMeta {
  return migrateMetaChecked(raw).meta;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* cards                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const CARD_STEPS: Record<number, Step> = {
  0: (raw) => ({ ...raw, schema: CARDS_SCHEMA }),
};

export function isCardTuple(x: unknown): x is CardTuple {
  if (!Array.isArray(x) || x.length !== 8) return false;
  for (let i = 0; i < 8; i++) {
    const v = x[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  const state = x[5];
  return state === 0 || state === 1 || state === 2 || state === 3;
}

export function migrateShard(raw: unknown): CardShard {
  if (!isObject(raw)) throw new MigrationError('cards', 'document is not an object');
  const r = runChain('cards', raw, CARD_STEPS, CURRENT.cards);
  const kind = typeof r.kind === 'string' && (SHARD_KINDS as readonly string[]).includes(r.kind) ? r.kind : null;
  // A level outside the curriculum would ride into `applyImport` as a placement hint; refuse the shard here instead.
  const level = typeof r.level === 'string' && (LEVELS as readonly string[]).includes(r.level) ? r.level : null;
  if (!kind || !level) throw new MigrationError('cards', 'shard lacks a known kind/level');
  const cards: Record<CardKey, CardTuple> = {};
  if (isObject(r.cards)) {
    for (const [k, t] of Object.entries(r.cards)) {
      if (isCardKeyString(k) && isCardTuple(t)) cards[k] = t;
    }
  }
  return { schema: CARDS_SCHEMA, kind: kind as CardShard['kind'], level: level as CardShard['level'], cards };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* log                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

const LOG_STEPS: Record<number, Step> = {
  0: (raw) => ({ ...raw, schema: LOG_SCHEMA }),
};

/** Accepts the 6-tuple and the design-07 5-tuple (`tagsMask` optional → 0). */
export function toLogEntry(x: unknown): LogEntry | null {
  if (!Array.isArray(x) || x.length < 5 || x.length > 6) return null;
  const [t, k, rating, ms, ex, mask] = x as unknown[];
  if (typeof t !== 'number' || typeof k !== 'string' || !isCardKeyString(k)) return null;
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) return null;
  if (typeof ms !== 'number' || typeof ex !== 'number') return null;
  const m = typeof mask === 'number' ? mask : 0;
  return [t, k, rating, ms, ex, m];
}

export function migrateLog(raw: unknown): LogEntry[] {
  // v0 may be a bare array of entries.
  const doc: Raw = Array.isArray(raw) ? { entries: raw } : isObject(raw) ? raw : {};
  if (!Array.isArray(raw) && !isObject(raw)) throw new MigrationError('log', 'document is not an object');
  const r = runChain('log', doc, LOG_STEPS, CURRENT.log);
  const entries = Array.isArray(r.entries) ? r.entries : [];
  const out: LogEntry[] = [];
  for (const e of entries) {
    const le = toLogEntry(e);
    if (le) out.push(le);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* id redirects                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Follow `old → new` chains (≤ 16 hops, cycle-safe). */
export function resolveRedirect(id: string, redirects: Record<string, string>): string {
  let cur = id;
  for (let i = 0; i < 16; i++) {
    const next = redirects[cur];
    if (next === undefined || next === cur) break;
    cur = next;
  }
  return cur;
}

export function redirectKey(key: CardKey, redirects: Record<string, string>): CardKey {
  const i = key.lastIndexOf('#');
  const itemId = key.slice(0, i);
  const facet = key.slice(i);
  const to = resolveRedirect(itemId, redirects);
  return to === itemId ? key : (`${to}${facet}` as CardKey);
}

/** Newer `last` wins a collision; ties go to the card with more reps. */
export function newerCard(a: CardTuple, b: CardTuple): CardTuple {
  if (b[6] !== a[6]) return b[6] > a[6] ? b : a;
  return b[3] > a[3] ? b : a;
}

/** Rewrite card keys through `redirects`; merge collisions by newer `last`. Idempotent. */
export function applyRedirects(shard: CardShard, redirects: Record<string, string>): CardShard {
  let changed = false;
  const cards: Record<CardKey, CardTuple> = {};
  for (const [k, t] of Object.entries(shard.cards) as [CardKey, CardTuple][]) {
    const nk = redirectKey(k, redirects);
    if (nk !== k) changed = true;
    const existing = cards[nk];
    cards[nk] = existing ? newerCard(existing, t) : t;
  }
  return changed ? { ...shard, cards } : shard;
}
