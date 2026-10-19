/**
 * TSUZUKU — pack indexes and manifest (design 08 §7 steps 6–7, §9; docs/AUDIO_PACK.md §3–§4).
 *
 * Pure builders from the pipeline's clip records to the JSON the clip runtime
 * reads. The shapes are the contract documented in docs/AUDIO_PACK.md — keep
 * that file and this one in step:
 *
 *  - `CueIndex`     `<level>/words.json`, `<level>/sentences.json`, `<level>/ear.json`, `kana/words.json`
 *  - `StoriesIndex` `sNN/stories.json` (one sprite per text, `whole` track, line cues with `m` / `c`, michikusa `misc`, `byText`)
 *  - `TracksIndex`  `kana/tracks.json` (full `TrackCue` rows)
 *  - `AudioManifest` `manifest.json` (`tsuzuku.audio/1`)
 *
 * Cues are compact (`f` file-table index, `s` start, `e` end, `v` voice-table
 * index, `r` native rate, `pv` pitch verified, `m` mora boundaries, `c` clause
 * boundaries); the runtime expands them to `ClipCue`. `m` comes from the
 * verified `audio_query`: 20 ms guard + prePhonemeLength + Σ (consonant +
 * vowel) / speedScale, a pause folded into the preceding boundary (measured
 * 6.38 s estimated vs 6.34 s actual). `c` marks every `pause_mora` and every
 * clause mark of the kana (、。！？ and the … ‥ — 〜 runs `stripDisplayMarks`
 * turns into a pause) as a mora index, the last entry being the mora count,
 * counted with `speechMorae` (`src/shared/jp.ts`, `RE_NOT_MORA` dropped) over
 * the width-folded kana with its clause marks removed — one body (`spokenKana`)
 * for `moraTotal` and `clauseBoundaries`, which on V10 kana equals the
 * verifier's `moraSplit(normalizeJa(kana))` — so `c` always indexes `m`.
 * `byText` keys are FNV-1a 32 hex8 of the spoken text
 * — the same function as `src/shared/hash.ts fnv1a32`, inlined so the script
 * tier imports nothing beyond the modules ARCHITECTURE §0 allows.
 *
 * The kana a clip was verified against is NOT in the runtime indexes (the
 * runtime never reads it): `<audioVersion>/kana.json` (`KanaIndex`, a sidecar
 * `audio:check` reads) maps every clip key to the hex8 hash of its content
 * kana, and the content diff between two packs is measured on it.
 */
import { BELTS, type Belt, type Level } from '../../src/content/types.ts';
import { foldWidth, speechMorae } from '../../src/shared/jp.ts';
import { GUARD_SECONDS } from './sprites.ts';
import type { AudioQuery } from './verify.ts';

export const INDEX_SCHEMA = 'tsuzuku.audio-index/1';
export const MANIFEST_SCHEMA = 'tsuzuku.audio/1';
export const PACK_SCHEMA = 'tsuzuku.audio-pack/1';
/** Budgets (design 08 §14). */
export const MAX_LEVEL_INDEX_BYTES = 350 * 1024;
/**
 * Design 08 §14 says ≤ 20 KB per station file; measured over the shipped corpus
 * a station with three Green texts is ≈ 44 KB raw (≈ 7 KB gzipped) because every
 * line carries `m` at both rates, so the warning threshold is 64 KB and the
 * design figure is noted as superseded in docs/AUDIO_PACK.md §8.
 */
export const MAX_STATION_INDEX_BYTES = 64 * 1024;
/**
 * Design 08 §14 says ≤ 80 KB; the lead accepted ≤ 160 KB raw for T1 + T2 (1,173 sprites ≈ 157 KB) and,
 * on 2026-10-18, ≤ 256 KiB raw for the three-tier pack (T3 adds ≈ 480 sprites; 1,664 sprites measure
 * ≈ 214 KB raw, ≈ 30–40 KB gzipped on Pages, fetched once and cached) rather than splitting `files[]`
 * per belt (docs/AUDIO_PACK.md §8). The render WARNS over it, never fails.
 */
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_DIST_BYTES = 900 * 1024 * 1024;
/** Clause dictation threshold (design 08 §9, `DICTATION_MAX_MORAE`): a sentence cue carries `c` only above it. */
export const DICTATION_MAX_MORAE = 22;
/** The check-only sidecars under `<audioVersion>/` (never fetched by the runtime, not under the index budgets). */
export const KANA_SIDECAR = 'kana.json';
export const FILES_SIDECAR = 'files.json';

/* ── hashing (identical to src/shared/hash.ts fnv1a32) ─────────────────── */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit over UTF-16 code units — byte-for-byte `src/shared/hash.ts fnv1a32`. */
export function fnv1a32(s: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/** `byText` key of a spoken sentence (`textToSpeak(toPlain(ja))`). */
export function textKey(spoken: string): string {
  return hex8(fnv1a32(spoken));
}

/** `kana.json` value of a clip key: hash of the content kana the clip was verified against. */
export function kanaHash(kana: string): string {
  return hex8(fnv1a32(kana));
}

/**
 * Share of `current` clip keys that are new or whose kana hash changed against
 * `previous` (two `kana.json` sidecars) — the content diff between two packs,
 * what `audio:check` gates the reuse warning on. `null` without a previous
 * sidecar or without keys.
 */
export function kanaDiffShare(current: Readonly<Record<string, string>>, previous: Readonly<Record<string, string>> | null): number | null {
  if (!previous) return null;
  const keys = Object.keys(current);
  if (keys.length === 0) return null;
  let changed = 0;
  for (const k of keys) if (previous[k] !== current[k]) changed++;
  return Math.round((changed / keys.length) * 10000) / 10000;
}

/* ── records the pipeline hands over ───────────────────────────────────── */

export type ClipKind = 'word' | 'sentence' | 'line' | 'misc' | 'ear';

export interface RenderedClip {
  /** Clip key (docs/AUDIO_PACK.md §2). */
  key: string;
  kind: ClipKind;
  /** Level for word / sentence / ear indexes (`kana` for kana items, the kanji's jlpt level for `j-…`); `null` for lines and misc. */
  level: Level | null;
  /** Owning station (sprite directory, belt, `sNN/stories.json`). */
  station: number;
  /** Native rate the clip was rendered at (1 or 0.85). */
  rate: number;
  /** Credit string of the voice (`VOICEVOX:九州そら`). */
  voice: string;
  /** Sprite path relative to `public/audio/`. */
  file: string;
  start: number;
  end: number;
  /** Content kana the clip was verified against ('' for a collocation, which has none). */
  kana: string;
  /** Spoken text (sentences and lines: the `byText` source — `textToSpeak(toPlain(ja), kana)`, what the engine was handed). */
  text?: string;
  /** The other spoken form a caller may hash (`textToSpeak(toPlain(ja))` without kana) when it differs from `text`; `byText` carries both. */
  textAlt?: string;
  /** The verified query (lines: `m` and `c`; sentences: `c`). */
  query?: AudioQuery;
  pitchVerified?: boolean;
  /** Lines: the text id, line index and the story's line count (sizes `lines[]`; a missing rate-1 line makes `whole` null). */
  textId?: string;
  lineIndex?: number;
  lineCount?: number;
}

export interface TrackRecord {
  /** `track:<name>`. */
  key: string;
  title: string;
  titleEn: string;
  file: string;
  start: number;
  end: number;
  voice: string;
  rate: number;
  station: number;
  segments: { s: number; e: number; text: string; en?: string }[];
}

/* ── index shapes ──────────────────────────────────────────────────────── */

export interface CompactCue {
  f?: number;
  s: number;
  e: number;
  v: number;
  r: number;
  pv?: boolean;
  m?: number[];
  c?: number[];
}

export interface CueIndex {
  schema: typeof INDEX_SCHEMA;
  audioVersion: string;
  scope: string;
  kind: 'words' | 'sentences' | 'ear';
  files: string[];
  voices: string[];
  cues: Record<string, CompactCue[]>;
  byText?: Record<string, string>;
}

export interface StoryEntry {
  f: number;
  /** The Radio track (the `r: 1` lines edge to edge); `null` when any line of the text was skipped — the text has no whole track and plays line by line. */
  whole: { s: number; e: number } | null;
  /** One entry per line of the story (`lines.length` = the story's line count); a skipped line is `[]`. */
  lines: CompactCue[][];
}

export interface StoriesIndex {
  schema: typeof INDEX_SCHEMA;
  audioVersion: string;
  scope: string;
  kind: 'stories';
  files: string[];
  voices: string[];
  texts: Record<string, StoryEntry>;
  misc: Record<string, CompactCue[]>;
  byText: Record<string, string>;
}

export interface TrackRow {
  key: string;
  title: string;
  titleEn: string;
  file: string;
  start: number;
  end: number;
  voice: string;
  rate: number;
  segments: { s: number; e: number; text: string; en?: string }[];
}

export interface TracksIndex {
  schema: typeof INDEX_SCHEMA;
  audioVersion: string;
  kind: 'tracks';
  tracks: TrackRow[];
}

/** `<audioVersion>/kana.json`: clip key → hex8 of the content kana it was verified against (check-only sidecar). */
export interface KanaIndex {
  schema: typeof INDEX_SCHEMA;
  audioVersion: string;
  kind: 'kana';
  keys: Record<string, string>;
}

export type AnyIndex = CueIndex | StoriesIndex | TracksIndex | KanaIndex;

export interface IndexFile {
  /** Path relative to `public/audio/<audioVersion>/` (`n5/words.json`, `s04/stories.json`, `kana/tracks.json`). */
  path: string;
  json: AnyIndex;
}

/* ── timing ────────────────────────────────────────────────────────────── */

const GUARD_MS = GUARD_SECONDS * 1000;

/**
 * Cumulative mora boundaries in ms from the cue's `start` (design 08 §9): one
 * entry per engine mora, `m[i]` = when mora `i` ends; a `pause_mora` is folded
 * into the boundary before it.
 */
export function moraBoundaries(q: AudioQuery): number[] {
  const speed = q.speedScale || 1;
  const pauseScale = q.pauseLengthScale ?? 1;
  let t = GUARD_MS + (q.prePhonemeLength / speed) * 1000;
  const out: number[] = [];
  for (const p of q.accent_phrases) {
    for (const m of p.moras) {
      t += (((m.consonant_length ?? 0) + m.vowel_length) / speed) * 1000;
      out.push(Math.round(t));
    }
    if (p.pause_mora && out.length > 0) {
      t += (((q.pauseLength ?? p.pause_mora.vowel_length) * pauseScale) / speed) * 1000;
      out[out.length - 1] = Math.round(t);
    }
  }
  return out;
}

/**
 * Marks that end a clause: 、。！？ and their ASCII / full-width forms, plus the
 * … ‥ — – 〜 ～ runs that `stripDisplayMarks` turns into a pause before the
 * engine (so the engine pauses there too). Every one of them is punctuation
 * for `normalizeJa`, i.e. never a mora. Tested AFTER `foldWidth` (NFKC), which
 * turns ～ into ~, … into ... and ！？，． into !?,. — so the ASCII forms are the
 * ones that must be here.
 */
const CLAUSE_MARK = /[、。！？!?，,．.…‥—–〜～~]/;

/**
 * The kana as spoken: width-folded (NFKC, as the verifier's `normalizeJa` folds it) with every `CLAUSE_MARK`
 * removed and remembered by position (`cuts` = spoken-string offsets of the marks). The ONE string
 * `moraTotal` and `clauseBoundaries` count, so the two cannot drift: a mark that is a clause cut is never a
 * mora, whatever the kana contains (V10 bars the ASCII / full-width forms from content kana anyway).
 */
function spokenKana(kana: string): { spoken: string; cuts: number[] } {
  let spoken = '';
  const cuts: number[] = [];
  for (const ch of foldWidth(kana)) {
    if (CLAUSE_MARK.test(ch)) cuts.push(spoken.length);
    else spoken += ch;
  }
  return { spoken, cuts };
}

/**
 * Spoken mora count of a kana string: `speechMorae` (`src/shared/jp.ts`; `RE_NOT_MORA` dropped, small kana
 * folded) over `spokenKana` — the body `clauseBoundaries` counts with, so `moraTotal(kana)` is always its
 * last entry. On content kana (V10: `KANA_SENTENCE_RE`) it equals `speechMorae(kana).length` (the validator's
 * V41 line cap, the planner's clause) and the verifier's `moraSplit(normalizeJa(kana)).length`
 * (`RE_NOT_MORA` ⊂ `normalizeJa`'s punctuation set), so `c[c.length − 1] === m.length` on every cue.
 */
export function moraTotal(kana: string): number {
  return speechMorae(spokenKana(kana).spoken).length;
}

/**
 * Clause boundaries as mora indexes: every `pause_mora` of the query and every
 * clause mark of the content kana; the last entry is the mora count, so clause
 * `j` spans `[c[j−1] ?? 0, c[j])`. Sorted, unique, never 0. Morae are counted
 * exactly as `lenientMorae` / `m` count them — NFKC, the clause marks removed
 * and remembered by position, the rest counted with `speechMorae` (`RE_NOT_MORA`
 * dropped: … ‥ ・ 「」 included; a small ゃゅょ… joins the mora before it, even
 * across a removed mark) — so `c[c.length − 1] === m.length` on a verified clip.
 */
export function clauseBoundaries(q: AudioQuery | undefined, kana: string): number[] {
  const set = new Set<number>();
  const { spoken, cuts } = spokenKana(kana);
  for (const len of cuts) {
    const at = speechMorae(spoken.slice(0, len)).length;
    if (at > 0) set.add(at);
  }
  const total = speechMorae(spoken).length;
  if (q) {
    let n = 0;
    for (const p of q.accent_phrases) {
      n += p.moras.length;
      if (p.pause_mora && n > 0 && n < total) set.add(n);
    }
  }
  if (total > 0) set.add(total);
  return [...set].filter((x) => x > 0 && x <= total).sort((a, b) => a - b);
}

/* ── builders ──────────────────────────────────────────────────────────── */

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

class Table {
  private readonly idx = new Map<string, number>();
  readonly list: string[] = [];
  id(s: string): number {
    let i = this.idx.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.idx.set(s, i);
      this.list.push(s);
    }
    return i;
  }
}

/**
 * One compact cue. `c` goes on every line (karaoke, loop-a-clause) and on a
 * sentence only when it is longer than `DICTATION_MAX_MORAE` and has more than
 * one clause — the only case clause dictation reaches a sentence (design 08 §9);
 * the pool tier's thousands of short examples carry no `c`, which is what keeps
 * a level's `sentences.json` under its 350 KB budget.
 */
function compact(c: RenderedClip, files: Table | null, voices: Table, withM: boolean): CompactCue {
  const cue: CompactCue = { s: round3(c.start), e: round3(c.end), v: voices.id(c.voice), r: c.rate };
  if (files) cue.f = files.id(c.file);
  if (c.pitchVerified) cue.pv = true;
  if (withM && c.query) cue.m = moraBoundaries(c.query);
  if (c.kind === 'line') cue.c = clauseBoundaries(c.query, c.kana);
  else if (c.kind === 'sentence') {
    const cl = clauseBoundaries(c.query, c.kana);
    if (cl.length > 1 && (cl[cl.length - 1] as number) > DICTATION_MAX_MORAE) cue.c = cl;
  }
  // `f` first for readability of the JSON.
  return cue.f === undefined ? cue : { f: cue.f, ...cue };
}

const byRate = (a: CompactCue, b: CompactCue): number => b.r - a.r;

/** `sNN` scope of a station. */
export const stationScope = (n: number): string => `s${String(n).padStart(2, '0')}`;

/** Belt of a station (design 02 §1 `BELTS`). */
export function beltOfStation(n: number): Belt {
  for (const b of BELTS) if (n >= b.stations[0] && n <= b.stations[1]) return b.id;
  return n < 1 ? 'white' : 'black';
}

/**
 * Every index file for the given clips and tracks (docs/AUDIO_PACK.md §3).
 * Words, sentences and ear cues go to their level; lines and michikusa to
 * their station; tracks to `kana/tracks.json`. Deterministic: keys and files
 * are sorted, so two renders of the same clips give byte-identical indexes.
 */
export function buildIndexes(clips: readonly RenderedClip[], tracks: readonly TrackRecord[], audioVersion: string): IndexFile[] {
  const out: IndexFile[] = [];
  const sorted = [...clips].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : b.rate - a.rate));
  const kanaKeys: Record<string, string> = {};
  for (const c of sorted) kanaKeys[c.key] = kanaHash(c.kana);
  // Both spoken forms resolve the key when they differ (a punctuation-less text ≤ 8 chars hashes its kana when the caller passes one).
  const addByText = (byText: Record<string, string>, c: RenderedClip): void => {
    if (c.text) byText[textKey(c.text)] = c.key;
    if (c.textAlt && c.textAlt !== c.text) byText[textKey(c.textAlt)] = c.key;
  };

  // Level indexes.
  const levels = new Map<string, { kind: CueIndex['kind']; clips: RenderedClip[] }>();
  for (const c of sorted) {
    if (c.kind === 'line' || c.kind === 'misc') continue;
    const kind: CueIndex['kind'] = c.kind === 'word' ? 'words' : c.kind === 'sentence' ? 'sentences' : 'ear';
    const level = c.level ?? 'kana';
    const key = `${level}/${kind}.json`;
    let e = levels.get(key);
    if (!e) {
      e = { kind, clips: [] };
      levels.set(key, e);
    }
    e.clips.push(c);
  }
  for (const [path, e] of [...levels.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const files = new Table();
    const voices = new Table();
    const cues: Record<string, CompactCue[]> = {};
    const byText: Record<string, string> = {};
    for (const c of e.clips) {
      (cues[c.key] ??= []).push(compact(c, files, voices, false));
      if (e.kind === 'sentences') addByText(byText, c);
    }
    for (const list of Object.values(cues)) list.sort(byRate);
    const json: CueIndex = { schema: INDEX_SCHEMA, audioVersion, scope: path.split('/')[0] as string, kind: e.kind, files: files.list, voices: voices.list, cues };
    if (e.kind === 'sentences') json.byText = byText;
    out.push({ path, json });
  }

  // Station indexes.
  const stations = new Map<number, RenderedClip[]>();
  for (const c of sorted) {
    if (c.kind !== 'line' && c.kind !== 'misc') continue;
    let list = stations.get(c.station);
    if (!list) {
      list = [];
      stations.set(c.station, list);
    }
    list.push(c);
  }
  for (const [station, list] of [...stations.entries()].sort(([a], [b]) => a - b)) {
    const files = new Table();
    const voices = new Table();
    const texts: Record<string, StoryEntry> = {};
    const misc: Record<string, CompactCue[]> = {};
    const byText: Record<string, string> = {};
    const lines = list.filter((c) => c.kind === 'line');
    const textIds = [...new Set(lines.map((c) => c.textId ?? ''))].filter(Boolean).sort();
    for (const id of textIds) {
      const own = lines.filter((c) => c.textId === id);
      const f = files.id((own[0] as RenderedClip).file);
      // Sized from the story's line count, so a skipped line is a visible hole (`[]`), never a shorter array.
      const n = Math.max(...own.map((c) => Math.max(c.lineCount ?? 0, (c.lineIndex ?? 0) + 1)));
      const entryLines: CompactCue[][] = Array.from({ length: n }, () => []);
      let ws = Number.POSITIVE_INFINITY;
      let we = 0;
      for (const c of own) {
        const cue = compact(c, null, voices, true);
        (entryLines[c.lineIndex ?? 0] as CompactCue[]).push(cue);
        if (c.rate === 1) {
          ws = Math.min(ws, cue.s);
          we = Math.max(we, cue.e);
        }
        if (c.rate === 1) addByText(byText, c);
      }
      for (const l of entryLines) l.sort(byRate);
      // The Radio track exists only when EVERY line has its rate-1 cue: the sprite would otherwise jump the skipped line
      // (design 08 §7: silence never ships, and neither does a hole) — `null` tells the runtime to play line by line.
      const complete = entryLines.every((l) => l.some((cue) => cue.r === 1));
      texts[id] = { f, whole: complete && Number.isFinite(ws) ? { s: ws, e: we } : null, lines: entryLines };
    }
    for (const c of list.filter((c) => c.kind === 'misc')) (misc[c.key] ??= []).push(compact(c, files, voices, false));
    for (const l of Object.values(misc)) l.sort(byRate);
    const json: StoriesIndex = { schema: INDEX_SCHEMA, audioVersion, scope: stationScope(station), kind: 'stories', files: files.list, voices: voices.list, texts, misc, byText };
    out.push({ path: `${stationScope(station)}/stories.json`, json });
  }

  // Tracks.
  if (tracks.length > 0) {
    const rows: TrackRow[] = [...tracks]
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((t) => ({ key: t.key, title: t.title, titleEn: t.titleEn, file: t.file, start: round3(t.start), end: round3(t.end), voice: t.voice, rate: t.rate, segments: t.segments.map((s) => ({ s: round3(s.s), e: round3(s.e), text: s.text, ...(s.en ? { en: s.en } : {}) })) }));
    out.push({ path: 'kana/tracks.json', json: { schema: INDEX_SCHEMA, audioVersion, kind: 'tracks', tracks: rows } });
  }

  // The check-only kana sidecar: every clip key → hash of its content kana (sorted, deterministic).
  if (sorted.length > 0) {
    const keys = Object.fromEntries(Object.entries(kanaKeys).sort(([a], [b]) => (a < b ? -1 : 1)));
    out.push({ path: KANA_SIDECAR, json: { schema: INDEX_SCHEMA, audioVersion, kind: 'kana', keys } });
  }
  return out;
}

/** The `kana.json` sidecar among built index files, if any. */
export function kanaSidecarOf(files: readonly IndexFile[]): KanaIndex | undefined {
  const f = files.find((x) => x.path === KANA_SIDECAR);
  return f && f.json.kind === 'kana' ? f.json : undefined;
}

/** Compact JSON (Pages gzips it on the wire). */
export function serializeIndex(json: AnyIndex | AudioManifest | object): string {
  return JSON.stringify(json);
}

export interface BudgetFinding {
  path: string;
  bytes: number;
  limit: number;
  level: 'error' | 'warn';
}

/** Level files over `MAX_LEVEL_INDEX_BYTES` (350 KB) are errors (the render fails); station files over `MAX_STATION_INDEX_BYTES` (64 KB) warn; the check-only sidecars are not budgeted. */
export function indexBudgetFindings(files: readonly IndexFile[]): BudgetFinding[] {
  const out: BudgetFinding[] = [];
  for (const f of files) {
    if (f.json.kind === 'kana') continue;
    const bytes = Buffer.byteLength(serializeIndex(f.json), 'utf8');
    const station = /^s\d\d\//.test(f.path);
    const limit = station ? MAX_STATION_INDEX_BYTES : MAX_LEVEL_INDEX_BYTES;
    if (bytes > limit) out.push({ path: f.path, bytes, limit, level: station ? 'warn' : 'error' });
  }
  return out;
}

/* ── manifest ──────────────────────────────────────────────────────────── */

export interface ManifestBelt {
  bytes: number;
  seconds: number;
  files: number;
}

/**
 * One sprite. The station is in the path (`sprites/sNN/…`, `sprites/kana/…`)
 * and the full sha256 lives in the `<audioVersion>/files.json` sidecar
 * (`FileShaMap`): the manifest keeps ≈ 110 bytes per sprite so it stays
 * small on the wire (the sprite name already carries sha8 of the bytes).
 */
export interface ManifestFileEntry {
  path: string;
  bytes: number;
  seconds: number;
  clips: number;
  belt: Belt;
  tier: string;
}

/** `<audioVersion>/files.json`: sprite path → sha256 (pack and check read it; the runtime does not). */
export type FileShaMap = Record<string, string>;

/** What a render left out on purpose (`--stations`, `--limit`); `null` = the whole corpus. `pack.ts` refuses a partial manifest. */
export interface ManifestPartial {
  stations?: [number, number];
  limit?: number;
}

/** Station number of a sprite path (`sprites/s04/…` → 4; kana tracks → 1). */
export function stationOfPath(path: string): number {
  const m = /^sprites\/s(\d\d)\//.exec(path);
  return m ? Number(m[1]) : 1;
}

export interface ManifestIndexEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ManifestVoice {
  character: string;
  style: string;
  styleId: number;
  credit: string;
}

export interface AudioManifest {
  schema: typeof MANIFEST_SCHEMA;
  audioVersion: string;
  contentVersion: string;
  engine: string;
  dictVersion: string;
  castSha: string;
  tiers: string[];
  generatedAt: string;
  dryRun: boolean;
  /** `null` for a whole-corpus render; a `--stations` / `--limit` render records what it left out and is never packed. */
  partial: ManifestPartial | null;
  voices: Record<string, ManifestVoice>;
  belts: Partial<Record<Belt, ManifestBelt>>;
  files: ManifestFileEntry[];
  indexes: ManifestIndexEntry[];
  totals: ManifestBelt & { clips: number };
  render: { rendered: number; cached: number; skipped: number; reused: number };
  /** Share of clips freshly rendered in this run (informational: a cold cache makes it 1 whatever the content did). */
  changedClipShare: number;
  /** Share of clip keys new or re-kana'd against the previous pack's `kana.json` (`kanaDiffShare`); `null` without a previous pack. */
  contentDiffShare: number | null;
  skipped: number;
  credits: string[];
  reusedBytesShare: number | null;
}

/**
 * The renderer's verification rules, part of the pack's identity since rule set 2:
 *  1 — the lenient mora fold for every clip (packs a-d2d42f75c3 and a-3467889b1f, whose lone は / へ said ワ / エ);
 *  2 — the strict fold for kana-name clips (`ClipSpec.kanaName`, 2026-10-18).
 * Rule set 1 adds nothing to the hash, so the two published ids are still reproducible from their inputs.
 */
export const RENDER_RULES_VERSION = 2;

/** `a-` + 10 hex of sha256 over the inputs that change the pack's identity (design 08 §7 step 7): content, cast, engine, dictionary, tiers — and the renderer's rule set from 2 on. */
export function audioVersionOf(parts: { contentVersion: string; castSha: string; engine: string; dictVersion: string; tiers: readonly string[]; rules?: number }, sha256Hex: (s: string) => string): string {
  const fields = [parts.contentVersion, parts.castSha, parts.engine, parts.dictVersion, [...parts.tiers].sort().join(',')];
  if ((parts.rules ?? 1) > 1) fields.push(`rules=${parts.rules}`);
  return `a-${sha256Hex(fields.join('|')).slice(0, 10)}`;
}

/** Sums `files` into `belts` and `totals`. */
export function beltTotals(files: readonly ManifestFileEntry[], clips: number): { belts: Partial<Record<Belt, ManifestBelt>>; totals: AudioManifest['totals'] } {
  const belts: Partial<Record<Belt, ManifestBelt>> = {};
  const totals = { bytes: 0, seconds: 0, files: 0, clips };
  for (const f of files) {
    const b = (belts[f.belt] ??= { bytes: 0, seconds: 0, files: 0 });
    b.bytes += f.bytes;
    b.seconds = round3(b.seconds + f.seconds);
    b.files += 1;
    totals.bytes += f.bytes;
    totals.seconds = round3(totals.seconds + f.seconds);
    totals.files += 1;
  }
  return { belts, totals };
}

/** Share of `files` bytes whose path already existed in `previous` (`null` without a previous manifest or without files). */
export function reusedBytesShare(files: readonly ManifestFileEntry[], previous: Pick<AudioManifest, 'files'> | null): number | null {
  if (!previous) return null;
  const total = files.reduce((s, f) => s + f.bytes, 0);
  if (total === 0) return null;
  const had = new Set(previous.files.map((f) => f.path));
  const reused = files.filter((f) => had.has(f.path)).reduce((s, f) => s + f.bytes, 0);
  return Math.round((reused / total) * 10000) / 10000;
}

/* ── the committed pointer ─────────────────────────────────────────────── */

export interface PackAsset {
  tier: string;
  name: string;
  sha256: string;
  bytes: number;
}

export interface AudioPackPointer {
  schema: typeof PACK_SCHEMA;
  repo: string;
  audioVersion: string | null;
  tag: string | null;
  assets: PackAsset[];
  credits: string[];
}

export const PACK_REPO = 'sunkencity999/tsuzuku';
export const releaseTag = (audioVersion: string): string => `audio-${audioVersion}`;
export const assetName = (audioVersion: string, tier: string): string => `tsuzuku-audio-${audioVersion}-${tier}.tar`;
