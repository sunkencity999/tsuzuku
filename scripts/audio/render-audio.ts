/**
 * TSUZUKU — VOICEVOX render pipeline (design 08 §7; runbook docs/AUDIO_PACK.md).
 *
 *   node scripts/audio/render-audio.ts [--tier core|pool|ear]… [--stations A-B] [--engines url,…]
 *        [--dry-run] [--fixtures [dir]] [--limit N] [--root public/content] [--out public/audio]
 *        [--cache .audio-cache] [--cast scripts/audio/cast.json] [--ffmpeg ffmpeg] [--dict high|all|none] [--no-prune]
 *        [--previous manifest.json] [--force] [--allow-skips]
 *
 * render → verify → encode → sprites → indexes → manifest. Every step is
 * incremental, content-hash keyed and resumable: a clip's id is
 * `sha256(engine|version|styleId|dictVersion|text|kana|speedScale|pitchScale|intonationScale|accentOverride)`
 * (16 hex) and `.audio-cache/<id>.{wav,json}` is reused across runs; sprites
 * are content-addressed (`<base>-<sha8>.webm`), so a one-word fix re-renders
 * and renames exactly the sprites that contain that word.
 *
 * Text handed to the engine: `textToSpeak(toPlain(ja), kana)` for sentences,
 * lines, quotes and definitions (exactly what `speak()` hands the device voice,
 * so clip and caller agree; `byText` carries the hash of both spoken forms
 * when the kana changes it); the WORD SURFACE for word clips, with a
 * user-dictionary entry `{ surface, pronunciation: katakana(kana), accent_type:
 * pitch }` — never bare kana, since 301 kana-homophone groups differ in pitch
 * (雨 / 飴). The T3 `<itemId>#pair` clip is the partner the runtime
 * synthesizes (`synthesizeMinimalPair`), spoken from its kana.
 *
 * Every `audio_query` is verified (`verify.ts`): morae against the content
 * kana under the lenient fold, then the ladder (user-dict the offending word →
 * kana patch with `is_kana=true` → kana text → skip, logged to
 * `.audio-cache/skipped.jsonl`); a `pitchConfidence: high` word's accent is
 * checked and overridden to the dictionary pitch (`pitchVerified`). A skipped
 * clip is covered by `speechSynthesis`; silence never ships.
 *
 * The four engines share ONE user_dict.json and each recompiles it only on its
 * own write (measured: an entry added on 50021 is in 50022's `GET /user_dict`
 * but not in its reading until 50022 itself writes; a delete recompiles too).
 * So `syncDictionary` ends with a touch (add + delete a sentinel) on an engine
 * that wrote nothing, and ladder step 1's temporary entry runs under one
 * process-wide mutex (`dictionaryLock`) that holds add → re-query → delete, so
 * no engine ever compiles another engine's temporary word.
 *
 * A transport failure (connection refused, HTTP 5xx) requeues the clip and
 * counts against the engine; three in a row retire it, and the run fails when
 * every engine is down (`shardAcrossEngines`). An HTTP 4xx is a per-clip skip.
 * A real render exits 1 when ≥ 2 % of clips were skipped unless `--allow-skips`.
 *
 * `--dry-run --fixtures` needs neither an engine nor ffmpeg: timings come from
 * the saved `__fixtures__/queries/*.json` where the text matches and from a
 * mora estimate otherwise, sprite bytes are estimated, and the manifest,
 * indexes and skipped.jsonl are written (`manifest.dryRun: true`). A dry run
 * defaults `--out` / `--cache` to `.audio-cache/dry-run/{audio,cache}`, and a
 * dry or partial (`--stations`, `--limit`) run refuses to overwrite a complete
 * real pack's manifest without `--force`; a partial render never prunes and
 * records `manifest.partial`, which `pack.ts` refuses. CI never renders; the
 * build Mac runs this with four engines (≈ 2.1× realtime).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentFile, GrammarItem, KanaItem, KanjiItem, Level, LineEmotion, ListeningPool, MichikusaItem, StoryItem, VocabItem } from '../../src/content/types.ts';
import { segmentsToTokens, toKana, toPlain } from '../../src/content/ruby.ts';
import { moraCount, moraSplit, normalizeJa, toKatakana } from '../../src/shared/jp.ts';
import { stripDisplayMarks, textToSpeak } from '../../src/shared/speak-text.ts';
import {
  type AudioManifest,
  type IndexFile,
  type KanaIndex,
  type ManifestFileEntry,
  type ManifestPartial,
  type ManifestVoice,
  type RenderedClip,
  type TrackRecord,
  audioVersionOf,
  RENDER_RULES_VERSION,
  beltOfStation,
  beltTotals,
  FILES_SIDECAR,
  indexBudgetFindings,
  KANA_SIDECAR,
  kanaDiffShare,
  kanaSidecarOf,
  MANIFEST_SCHEMA,
  MAX_MANIFEST_BYTES,
  reusedBytesShare,
  serializeIndex,
  stationScope,
  buildIndexes,
} from './indexes.ts';
import { kanaTracks, type KanaTrackSpec } from './kana-tracks.ts';
import { concatPcm, encodeOpus, estimateOpusBytes, layout, type ClipLength, pcmOfWav, planMixedSprites, SAMPLE_RATE, sha256Hex, sha8, spriteName, wrapWav } from './sprites.ts';
import {
  type AudioQuery,
  type LadderStep,
  type VvAccentPhrase,
  engineMorae,
  expectedAccent,
  kanaNameFoldDiffers,
  kanaPatch,
  kanaText,
  queryDuration,
  synthesizeMinimalPair,
  toAquesTalk,
  verifyAccent,
  verifyMorae,
  withAccent,
  withAccentPhrases,
} from './verify.ts';

export const ENGINE_NAME = 'VOICEVOX';
export const ENGINE_VERSION = '0.25.2';
export const ENGINE_LABEL = `${ENGINE_NAME} ${ENGINE_VERSION}`;
export const DEFAULT_ENGINES = ['http://127.0.0.1:50021', 'http://127.0.0.1:50022', 'http://127.0.0.1:50023', 'http://127.0.0.1:50024'];
/** Natural-slow take (design 08 §7 step 4). */
export const SLOW_RATE = 0.85;
export const SLOW_PAUSE_SCALE = 1.3;
/** Sentence clips of Stations 1–17 render a slow take. */
export const SLOW_THROUGH_STATION = 17;
export const TIERS = ['core', 'pool', 'ear'] as const;
export type Tier = (typeof TIERS)[number];
export type DictPolicy = 'high' | 'all' | 'none';
/** Narration, kana tracks and word clips are ハナ's voice (design 08 §6). */
export const NARRATOR = 'ハナ';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const DEFAULT_FIXTURES = join(here, '__fixtures__');

/* ── corpus ────────────────────────────────────────────────────────────── */

export interface Corpus {
  contentVersion: string;
  kana: KanaItem[];
  vocab: VocabItem[];
  kanji: KanjiItem[];
  grammar: GrammarItem[];
  stories: StoryItem[];
  michikusa: MichikusaItem[];
  pools: ListeningPool[];
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.json')) out.push(p);
  }
  return out;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function itemsOf<T>(root: string, sub: string): T[] {
  const out: T[] = [];
  for (const p of walk(join(root, sub))) out.push(...readJson<ContentFile<T>>(p).items);
  return out;
}

/** Reads `public/content` (or a fixture root): every item kind the pipeline voices, plus the pools when they exist. */
export function loadCorpus(root: string): Corpus {
  root = resolve(root);
  const manifestPath = join(root, 'manifest.json');
  const contentVersion = existsSync(manifestPath) ? (readJson<{ contentVersion?: string }>(manifestPath).contentVersion ?? 'c-unknown') : 'c-unknown';
  const pools: ListeningPool[] = [];
  for (const p of walk(join(root, 'listening'))) if (/pool-\d\d\.json$/.test(p)) pools.push(readJson<ListeningPool>(p));
  return {
    contentVersion,
    kana: itemsOf<KanaItem>(root, 'kana'),
    vocab: itemsOf<VocabItem>(root, 'vocab'),
    kanji: itemsOf<KanjiItem>(root, 'kanji'),
    grammar: itemsOf<GrammarItem>(root, 'grammar'),
    stories: itemsOf<StoryItem>(root, 'stories'),
    michikusa: itemsOf<MichikusaItem>(root, 'michikusa'),
    pools,
  };
}

/* ── cast ──────────────────────────────────────────────────────────────── */

export interface CastEntry {
  name: string;
  gender: 'm' | 'f';
  age: number;
  character: string;
  style: string;
  emotionStyles?: Partial<Record<LineEmotion, string>>;
  credit: string;
}

export interface CastFile {
  schema: string;
  engine: string;
  speakers: CastEntry[];
}

export interface Cast {
  entries: Map<string, CastEntry>;
  sha: string;
}

export function loadCast(path: string): Cast {
  const text = readFileSync(path, 'utf8');
  const file = JSON.parse(text) as CastFile;
  const entries = new Map<string, CastEntry>();
  for (const e of file.speakers) entries.set(e.name, e);
  return { entries, sha: sha256Hex(text) };
}

export interface SpeakerInfo {
  name: string;
  styles: { name: string; id: number }[];
}

export interface Voice {
  label: string;
  character: string;
  style: string;
  styleId: number;
  /** Style id per emotion the character has (design 08 §5 `emotion`). */
  emotionIds: Partial<Record<LineEmotion, number>>;
  credit: string;
}

/** Style ids for every cast label from `GET /speakers` (never hard-coded, design 08 §6). */
export function resolveVoices(cast: Cast, speakers: readonly SpeakerInfo[]): Map<string, Voice> {
  const byName = new Map(speakers.map((s) => [s.name, s]));
  const out = new Map<string, Voice>();
  for (const e of cast.entries.values()) {
    const sp = byName.get(e.character);
    if (!sp) throw new Error(`cast: character ${e.character} (${e.name}) is not on this engine`);
    const style = sp.styles.find((s) => s.name === e.style);
    if (!style) throw new Error(`cast: ${e.character} has no style ${e.style} (${e.name})`);
    const emotionIds: Partial<Record<LineEmotion, number>> = {};
    for (const [emotion, styleName] of Object.entries(e.emotionStyles ?? {})) {
      const st = sp.styles.find((s) => s.name === styleName);
      if (st) emotionIds[emotion as LineEmotion] = st.id;
    }
    out.set(e.name, { label: e.name, character: e.character, style: e.style, styleId: style.id, emotionIds, credit: e.credit });
  }
  return out;
}

/* ── inventory ─────────────────────────────────────────────────────────── */

export type SpecKind = 'word' | 'sentence' | 'line' | 'misc' | 'ear' | 'track';

export interface ClipSpec {
  /** Clip key (docs/AUDIO_PACK.md §2); track segments use `track:<name>#<i>`. */
  key: string;
  kind: SpecKind;
  tier: Tier;
  level: Level | null;
  station: number;
  /** Text handed to the engine (`textToSpeak(toPlain(ja), kana)` for texts). */
  text: string;
  /** Sentences / lines: the spoken form WITHOUT the kana (`textToSpeak(toPlain(ja))`) when it differs — `byText` hashes both. */
  textAlt?: string;
  /** Content kana ('' when the content has none: collocations). */
  kana: string;
  /** Cast label. */
  speaker: string;
  emotion?: LineEmotion;
  rate: number;
  /** Words: dictionary pitch and whether the app grades it (accent verified + overridden). */
  pitch?: number;
  pitchHigh?: boolean;
  /** Lines: the token surfaces / ids behind the text (ladder step 1). */
  tokens?: string[];
  tokenIds?: (string | null)[];
  ja?: string;
  textId?: string;
  lineIndex?: number;
  /** Lines: the story's line count (sizes `stories.json` `lines[]`; a skipped line voids the `whole` track). */
  lineCount?: number;
  /** Sprite group: `s04/text/s-04-1`, `s04/words`, `s04/grammar`, `s04/examples`, `s04/misc`, `s04/ear`, `kana/<track>`. */
  group: string;
  /** Kanji example that reuses a vocab clip: the vocab key (not rendered). */
  reuseOf?: string;
  /** Track segments: track name and index. */
  track?: string;
  segment?: number;
  /**
   * A kana NAME: a lone kana spoken as itself (the `k-*` items and the row /
   * pair track segments that reuse them). Verified under the strict fold —
   * は / へ must come back as ハ / ヘ, not the particle readings ワ / エ the
   * lenient fold accepts for words and sentences (the ladder's kana patch
   * forces them); such a clip of は or へ takes its own clip id.
   */
  kanaName?: boolean;
}

const LEVEL_OF_JLPT: Record<number, Level> = { 5: 'n5', 4: 'n4', 3: 'n3', 2: 'n2', 1: 'n1' };
const FIRST_STATION_OF_LEVEL: Record<string, number> = { kana: 1, n5: 4, n4: 16, n3: 25, n2: 39, n1: 47, dan: 53 };

export function levelOfId(id: string): Level | null {
  const m = /^[vg]-(n[1-5])-/.exec(id);
  return m ? (m[1] as Level) : null;
}

const stationOfStoryId = (id: string): number => Number(id.split('-')[1]);

/** Word surface the engine is handed for a word clip: the plain surface (display marks stripped); the kana only when nothing speakable is left. */
export function wordText(word: string, kana: string): string {
  const s = stripDisplayMarks(toPlain(word));
  return s.length > 0 ? s : kana;
}

/**
 * The two spoken forms of a text (design 08 §7): `text` is what the engine is
 * handed and what `speak(plain, { kana })` hashes — `textToSpeak(toPlain(ja), kana)`;
 * `textAlt` is `textToSpeak(toPlain(ja))` when a caller without the kana would
 * hash something else (a punctuation-less text ≤ 8 chars), so `byText` holds both.
 */
export function spokenForms(ja: string, kana: string): { text: string; textAlt?: string } {
  const plain = toPlain(ja);
  const text = textToSpeak(plain, kana);
  const alt = textToSpeak(plain);
  return alt === text ? { text } : { text, textAlt: alt };
}

export interface InventoryOptions {
  tiers: ReadonlySet<Tier>;
  stations?: [number, number];
}

/** Every clip the selected tiers need, in deterministic order; slow takes are second specs with the same key. */
export function inventory(corpus: Corpus, o: InventoryOptions): ClipSpec[] {
  const specs: ClipSpec[] = [];
  const inRange = (n: number): boolean => !o.stations || (n >= o.stations[0] && n <= o.stations[1]);
  const push = (s: ClipSpec): void => {
    if (inRange(s.station)) specs.push(s);
  };
  const withSlow = (s: ClipSpec): void => {
    push(s);
    if (s.station <= SLOW_THROUGH_STATION) push({ ...s, rate: SLOW_RATE });
  };
  const core = o.tiers.has('core');
  const scope = (n: number): string => stationScope(n);

  if (core) {
    // Kana items and their example words (Stations 1–3).
    for (const k of corpus.kana) {
      const station = k.station ?? FIRST_STATION_OF_LEVEL.kana ?? 1;
      push({ key: k.id, kind: 'word', tier: 'core', level: 'kana', station, text: k.kana, kana: k.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/words`, kanaName: true });
      push({ key: `${k.id}#ex0`, kind: 'word', tier: 'core', level: 'kana', station, text: wordText(k.exampleWord.word, k.exampleWord.kana), kana: k.exampleWord.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/words` });
    }
    // Vocab words, keyed by item id, rendered from the surface with the dictionary accent.
    const vocabByWord = new Map<string, VocabItem>();
    for (const v of corpus.vocab) {
      const level = levelOfId(v.id) ?? LEVEL_OF_JLPT[v.jlpt] ?? 'n5';
      const station = v.station ?? FIRST_STATION_OF_LEVEL[level] ?? 4;
      vocabByWord.set(`${v.word}\u0000${v.kana}`, v);
      const spec: ClipSpec = { key: v.id, kind: 'word', tier: 'core', level, station, text: wordText(v.word, v.kana), kana: v.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/words` };
      if (v.pitch !== undefined) {
        spec.pitch = v.pitch;
        spec.pitchHigh = v.pitchConfidence === 'high';
      }
      push(spec);
    }
    // Kanji example words: reuse the vocab clip only when word AND kana match.
    for (const k of corpus.kanji) {
      const level = LEVEL_OF_JLPT[k.jlpt] ?? 'n5';
      const station = k.station ?? FIRST_STATION_OF_LEVEL[level] ?? 4;
      k.examples.forEach((ex, i) => {
        const hit = vocabByWord.get(`${ex.word}\u0000${ex.kana}`);
        const spec: ClipSpec = { key: `${k.id}#ex${i}`, kind: 'word', tier: 'core', level, station, text: wordText(ex.word, ex.kana), kana: ex.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/words` };
        if (hit) spec.reuseOf = hit.id;
        push(spec);
      });
    }
    // Grammar examples (+ slow through Station 17).
    for (const g of corpus.grammar) {
      const level = levelOfId(g.id) ?? LEVEL_OF_JLPT[g.jlpt] ?? 'n5';
      const station = g.station ?? FIRST_STATION_OF_LEVEL[level] ?? 4;
      g.examples.forEach((ex, i) => {
        withSlow({ key: `${g.id}#ex${i}`, kind: 'sentence', tier: 'core', level, station, ...spokenForms(ex.ja, ex.kana), kana: ex.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/grammar` });
      });
    }
    // Story lines and pieces: one sprite per text.
    for (const s of corpus.stories) {
      const station = stationOfStoryId(s.id);
      s.lines.forEach((line, i) => {
        const spec: ClipSpec = {
          key: `${s.id}#L${i}`,
          kind: 'line',
          tier: 'core',
          level: null,
          station,
          ...spokenForms(line.ja, line.kana),
          kana: line.kana,
          speaker: line.speaker ?? s.narrator ?? NARRATOR,
          rate: 1,
          tokens: line.tokens,
          ja: line.ja,
          textId: s.id,
          lineIndex: i,
          lineCount: s.lines.length,
          group: `${scope(station)}/text/${s.id}`,
        };
        if (line.tokenIds) spec.tokenIds = line.tokenIds;
        if (line.emotion) spec.emotion = line.emotion;
        withSlow(spec);
      });
    }
    // Michikusa quotes.
    for (const m of corpus.michikusa) {
      if (!m.ja || !m.kana) continue;
      const station = Number(m.stationId.slice(3));
      push({ key: m.id, kind: 'misc', tier: 'core', level: null, station, ...spokenForms(m.ja, m.kana), kana: m.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/misc` });
    }
    // Generated kana tracks.
    for (const t of kanaTracks(corpus.kana)) {
      t.segments.forEach((seg, i) => {
        // A segment that duplicates a kana item's own clip (`clip: 'k-h-ha'`, no `#`) is that kana's name.
        const kanaName = typeof seg.clip === 'string' && !seg.clip.includes('#');
        push({ key: `track:${t.name}#${i}`, kind: 'track', tier: 'core', level: 'kana', station: 1, text: textToSpeak(seg.text, seg.kana), kana: seg.kana, speaker: t.voice, rate: t.rate, group: `kana/${t.name}`, track: t.name, segment: i, ...(kanaName ? { kanaName } : {}) });
      });
    }
  }

  if (o.tiers.has('pool')) {
    // Vocab example sentences that some pool admits (design 08 §2 T2), at the pool's station; slow takes for Stations 4–17.
    const refStation = new Map<string, number>();
    for (const p of corpus.pools) for (const r of p.refs) if (/^v-/.test(r.ref)) refStation.set(r.ref, Math.min(p.station, refStation.get(r.ref) ?? 99));
    for (const v of corpus.vocab) {
      const level = levelOfId(v.id) ?? 'n5';
      v.examples.forEach((ex, i) => {
        const key = `${v.id}#ex${i}`;
        const station = refStation.get(key);
        if (station === undefined) return;
        withSlow({ key, kind: 'sentence', tier: 'pool', level, station, ...spokenForms(ex.ja, ex.kana), kana: ex.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/examples` });
      });
    }
  }

  if (o.tiers.has('ear')) {
    for (const v of corpus.vocab) {
      const level = levelOfId(v.id) ?? 'n5';
      const station = v.station ?? FIRST_STATION_OF_LEVEL[level] ?? 4;
      (v.collocations ?? []).forEach((col, i) => {
        push({ key: `${v.id}#col${i}`, kind: 'ear', tier: 'ear', level, station, text: textToSpeak(toPlain(col)), kana: '', speaker: NARRATOR, rate: 1, group: `${scope(station)}/ear` });
      });
      if (v.definitionJa) push({ key: `${v.id}#def`, kind: 'ear', tier: 'ear', level, station, ...spokenForms(v.definitionJa.ja, v.definitionJa.kana), kana: v.definitionJa.kana, speaker: NARRATOR, rate: 1, group: `${scope(station)}/ear` });
      if (v.pitchConfidence === 'high' && v.pitch !== undefined) {
        push({ key: `${v.id}#ga`, kind: 'word', tier: 'ear', level, station, text: `${wordText(v.word, v.kana)}が`, kana: `${v.kana}が`, speaker: NARRATOR, rate: 1, pitch: v.pitch, pitchHigh: true, group: `${scope(station)}/ear` });
      }
      // The Minimal Pair partner the runtime keys as `<id>#pair` (pairClipKey → synthesizeMinimalPair): one voice, one rate, spoken from its kana (it is no item).
      const partner = synthesizeMinimalPair(v.kana);
      push({ key: `${v.id}#pair`, kind: 'word', tier: 'ear', level, station, text: partner, kana: partner, speaker: NARRATOR, rate: 1, group: `${scope(station)}/ear` });
    }
  }
  return specs;
}

/* ── dictionary and clip ids ───────────────────────────────────────────── */

export interface DictEntry {
  surface: string;
  pronunciation: string;
  accent_type: number;
  word_type: 'COMMON_NOUN' | 'PROPER_NOUN' | 'VERB' | 'ADJECTIVE' | 'SUFFIX';
  priority: number;
}

/** User-dictionary entries for the word clips (design 08 §7 step 1): `{ surface: word, pronunciation: katakana(kana), accent_type: pitch }`. */
export function dictionaryEntries(corpus: Corpus, policy: DictPolicy): DictEntry[] {
  if (policy === 'none') return [];
  const out = new Map<string, DictEntry>();
  for (const v of corpus.vocab) {
    if (v.pitch === undefined) continue;
    if (policy === 'high' && v.pitchConfidence !== 'high') continue;
    const surface = wordText(v.word, v.kana);
    if (surface === v.kana || /[\s　]/.test(surface)) continue; // kana-written words need no entry
    if (out.has(surface)) continue;
    out.set(surface, { surface, pronunciation: toKatakana(normalizeJa(v.kana)), accent_type: v.pitch, word_type: 'COMMON_NOUN', priority: 5 });
  }
  return [...out.values()].sort((a, b) => (a.surface < b.surface ? -1 : 1));
}

/** `d-` + 10 hex of sha256 over the sorted entries. */
export function dictVersionOf(entries: readonly DictEntry[]): string {
  return `d-${sha256Hex(JSON.stringify(entries)).slice(0, 10)}`;
}

export interface ClipIdParts {
  styleId: number;
  dictVersion: string;
  text: string;
  kana: string;
  speedScale: number;
  pitchScale?: number;
  intonationScale?: number;
  /** The accent the query is forced to (pitchConfidence: high words), '' otherwise. */
  accentOverride?: string;
  /**
   * `kana-name` for a kana-name clip whose kana the strict fold reads differently
   * (は / へ, `kanaNameFoldDiffers`), '' otherwise. Appended to the hash input
   * ONLY when set, so every other clip keeps the id it has had since the first
   * pack (the cache stays warm).
   */
  readingOverride?: string;
}

/** Design 08 §7 step 2: the first 16 hex of sha256 over the render inputs. */
export function clipId(p: ClipIdParts): string {
  const parts = [ENGINE_NAME, ENGINE_VERSION, p.styleId, p.dictVersion, p.text, p.kana, p.speedScale, p.pitchScale ?? 0, p.intonationScale ?? 1, p.accentOverride ?? ''];
  if (p.readingOverride) parts.push(p.readingOverride);
  return sha256Hex(parts.join('|')).slice(0, 16);
}

/** The id parts of a spec under a voice table and dictionary version. */
export function clipIdOf(spec: ClipSpec, voices: Map<string, Voice>, dictVersion: string): string {
  const v = voiceOf(spec, voices);
  return clipId({
    styleId: v.styleId,
    dictVersion,
    text: spec.text,
    kana: spec.kana,
    speedScale: spec.rate,
    accentOverride: spec.pitchHigh && spec.pitch !== undefined ? `accent=${spec.pitch}` : '',
    readingOverride: spec.kanaName && kanaNameFoldDiffers(spec.kana) ? 'kana-name' : '',
  });
}

export function voiceOf(spec: ClipSpec, voices: Map<string, Voice>): Voice & { styleId: number } {
  const v = voices.get(spec.speaker);
  if (!v) throw new Error(`cast: speaker "${spec.speaker}" of ${spec.key} is not in cast.json`);
  const styleId = (spec.emotion && v.emotionIds[spec.emotion]) || v.styleId;
  return { ...v, styleId };
}

/* ── engine client ─────────────────────────────────────────────────────── */

/** An engine call that failed: `status` is the HTTP status, or `undefined` when the connection itself failed. */
export class EngineError extends Error {
  readonly status: number | undefined;
  readonly base: string;
  constructor(base: string, message: string, status?: number) {
    super(message);
    this.name = 'EngineError';
    this.base = base;
    this.status = status;
  }
}

/** A failure of the engine PROCESS (connection refused / reset, HTTP 5xx) rather than of the request: the clip is requeued, the engine counted down. */
export function isTransportError(err: unknown): boolean {
  return err instanceof EngineError && (err.status === undefined || err.status >= 500);
}

/**
 * A promise mutex: `run(fn)` executes `fn` after every earlier `run` has
 * settled. Used for the user-dictionary writes — the four engines share one
 * user_dict.json, so a temporary entry's add → re-query → delete must never
 * interleave with another engine's write (`dictionaryLock`).
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  /** How many `run` bodies are executing right now (0 or 1; asserted by the tests). */
  held = 0;
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      this.held++;
      try {
        return await fn();
      } finally {
        this.held--;
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** The one lock every dictionary write of a run goes through. */
export const dictionaryLock = new Mutex();

export class Engine {
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  private async call<T>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { method: 'POST', ...init });
    } catch (e) {
      throw new EngineError(this.base, `${this.base}${path}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new EngineError(this.base, `${this.base}${path} → ${res.status} ${await res.text()}`, res.status);
    return (init.raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T;
  }
  version(): Promise<string> {
    return this.call<string>('/version', { method: 'GET' });
  }
  speakers(): Promise<SpeakerInfo[]> {
    return this.call<SpeakerInfo[]>('/speakers', { method: 'GET' });
  }
  audioQuery(text: string, styleId: number): Promise<AudioQuery> {
    return this.call<AudioQuery>(`/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`);
  }
  accentPhrases(text: string, styleId: number, isKana: boolean): Promise<VvAccentPhrase[]> {
    return this.call<VvAccentPhrase[]>(`/accent_phrases?speaker=${styleId}&text=${encodeURIComponent(text)}&is_kana=${isKana}`);
  }
  synthesis(q: AudioQuery, styleId: number): Promise<Buffer> {
    return this.call<Buffer>(`/synthesis?speaker=${styleId}`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(q), raw: true });
  }
  userDict(): Promise<Record<string, { surface: string; pronunciation: string; accent_type: number; priority: number }>> {
    return this.call('/user_dict', { method: 'GET' });
  }
  addWord(e: DictEntry): Promise<string> {
    const u = new URLSearchParams({ surface: e.surface, pronunciation: e.pronunciation, accent_type: String(e.accent_type), word_type: e.word_type, priority: String(e.priority) });
    return this.call<string>(`/user_dict_word?${u.toString()}`);
  }
  async deleteWord(id: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/user_dict_word/${id}`, { method: 'DELETE' });
    } catch (e) {
      throw new EngineError(this.base, `${this.base} DELETE /user_dict_word/${id}: ${(e as Error).message}`);
    }
    if (!res.ok && res.status !== 404) throw new EngineError(this.base, `${this.base} DELETE /user_dict_word/${id} → ${res.status}`, res.status);
  }
}

/** A nonsense surface no content holds: added and deleted to make an engine recompile the shared dictionary file. */
export const DICT_TOUCH_ENTRY: DictEntry = { surface: 'ゾヌケツヅ', pronunciation: 'ゾヌケツヅ', accent_type: 0, word_type: 'PROPER_NOUN', priority: 0 };

/**
 * Makes the engine's user dictionary equal to `entries` (adds missing, removes
 * foreign or stale ones). The engines share one user_dict.json and recompile
 * it only on their own write, so an engine that found the file already right
 * (another engine wrote it) is TOUCHED — a sentinel added and deleted — and
 * ends the sync with the dictionary compiled (`touched: true`).
 */
export async function syncDictionary(e: Engine, entries: readonly DictEntry[]): Promise<{ added: number; removed: number; touched: boolean }> {
  const have = await e.userDict();
  const want = new Map(entries.map((x) => [x.surface, x]));
  let removed = 0;
  const present = new Set<string>();
  for (const [id, w] of Object.entries(have)) {
    const ours = want.get(w.surface);
    if (ours && ours.pronunciation === w.pronunciation && ours.accent_type === w.accent_type && !present.has(w.surface)) {
      present.add(w.surface);
      continue;
    }
    await e.deleteWord(id);
    removed++;
  }
  let added = 0;
  for (const x of entries) {
    if (present.has(x.surface)) continue;
    await e.addWord(x);
    added++;
  }
  let touched = false;
  if (added === 0 && removed === 0) {
    const id = await e.addWord(DICT_TOUCH_ENTRY);
    await e.deleteWord(id);
    touched = true;
  }
  return { added, removed, touched };
}

/* ── fixtures / estimates (dry run) ────────────────────────────────────── */

export interface QueryFixture {
  name: string;
  text: string;
  kana: string;
  styleId: number;
  query: AudioQuery;
}

export function loadQueryFixtures(dir: string): Map<string, QueryFixture> {
  const out = new Map<string, QueryFixture>();
  for (const p of walk(join(dir, 'queries'))) {
    const f = readJson<QueryFixture>(p);
    out.set(f.text, f);
  }
  return out;
}

/** A plausible query for `kana` without an engine: 0.143 s per mora (7 morae / s), 0.25 s per 、, 0.1 s pre / post. */
export function estimateQuery(kana: string, speedScale = 1): AudioQuery {
  const phrases: VvAccentPhrase[] = [];
  let cur: VvAccentPhrase = { moras: [], accent: 1, pause_mora: null, is_interrogative: false };
  const flush = (pause: boolean): void => {
    if (cur.moras.length === 0) return;
    cur.accent = cur.moras.length;
    if (pause) cur.pause_mora = { text: '、', consonant: null, consonant_length: null, vowel: 'pau', vowel_length: 0.25, pitch: 0 };
    phrases.push(cur);
    cur = { moras: [], accent: 1, pause_mora: null, is_interrogative: false };
  };
  for (const ch of normalizeJa(kana.replace(/[、，,]/g, '\u0001'), {})) {
    if (ch === '\u0001') {
      flush(true);
      continue;
    }
    for (const m of moraSplit(ch)) {
      const last = cur.moras[cur.moras.length - 1];
      if (/^[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]$/.test(m) && last) {
        last.text += toKatakana(m);
        continue;
      }
      cur.moras.push({ text: toKatakana(m), consonant: null, consonant_length: 0.043, vowel: 'a', vowel_length: 0.1, pitch: 5.5 });
    }
  }
  flush(false);
  const q: AudioQuery = { accent_phrases: phrases, speedScale, pitchScale: 0, intonationScale: 1, volumeScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1, pauseLength: null, pauseLengthScale: 1, outputSamplingRate: SAMPLE_RATE, outputStereo: false };
  q.kana = toAquesTalk(q);
  return q;
}

/* ── rendering one clip ────────────────────────────────────────────────── */

export interface CachedClip {
  id: string;
  key: string;
  text: string;
  kana: string;
  styleId: number;
  rate: number;
  step: LadderStep | 'unverified';
  query: AudioQuery;
  seconds: number;
  pitchVerified: boolean;
  renderedAt: string;
}

export interface SkipRecord {
  key: string;
  id: string;
  text: string;
  kana: string;
  got: string;
  want: string;
  step: 'skip' | 'accent';
  reason: string;
}

interface WordLookup {
  (token: string, id: string | null): { surface: string; kana: string; pitch?: number } | undefined;
}

/**
 * The engine-side pass for one spec: query → verify → ladder → accent →
 * synthesis. `null` = skipped. Ladder step 1 (a temporary dictionary entry)
 * runs under `lock`, which holds add → re-query → delete so no other engine's
 * write can interleave and compile the temporary word into its own dictionary.
 */
export async function renderOne(e: Engine, spec: ClipSpec, voice: Voice & { styleId: number }, lookupWord: WordLookup, skips: SkipRecord[], lock: Mutex = dictionaryLock): Promise<{ query: AudioQuery; wav: Buffer; step: CachedClip['step']; pitchVerified: boolean } | null> {
  const applySpeed = (q: AudioQuery): AudioQuery => {
    q.speedScale = spec.rate;
    if (spec.rate !== 1) q.pauseLengthScale = SLOW_PAUSE_SCALE;
    return q;
  };
  let q = applySpeed(await e.audioQuery(spec.text, voice.styleId));
  let step: CachedClip['step'] = 'surface';
  // A kana name is verified strictly: は / へ must be ハ / ヘ, not the particle readings (the kana patch forces them).
  const strict = spec.kanaName === true;
  if (spec.kana) {
    let v = verifyMorae(q, spec.kana, strict);
    // Step 1: user-dict the offending word (a temporary entry; removed afterwards so the dictionary stays the version we hashed).
    if (!v.ok && spec.tokens && spec.ja) {
      const word = offendingWord(spec, v.got, v.want, lookupWord);
      if (word) {
        const q1 = await lock.run(async () => {
          const id = await e.addWord({ surface: word.surface, pronunciation: toKatakana(normalizeJa(word.kana)), accent_type: word.pitch ?? 0, word_type: 'COMMON_NOUN', priority: 9 });
          try {
            return applySpeed(await e.audioQuery(spec.text, voice.styleId));
          } finally {
            await e.deleteWord(id);
          }
        });
        const v1 = verifyMorae(q1, spec.kana, strict);
        if (v1.ok) {
          q = q1;
          v = v1;
          step = 'user-dict';
        }
      }
    }
    // Step 2: patch the engine's own kana and re-query with is_kana=true.
    if (!v.ok) {
      const patch = kanaPatch(q, spec.kana, strict);
      if (patch) {
        try {
          const phrases = await e.accentPhrases(patch, voice.styleId, true);
          const q2 = applySpeed(withAccentPhrases(q, phrases));
          const v2 = verifyMorae(q2, spec.kana, strict);
          if (v2.ok) {
            q = q2;
            v = v2;
            step = 'kana-patch';
          }
        } catch {
          /* the parser rejected the patch: fall through to step 3 */
        }
      }
    }
    // Step 3: the content kana as plain text.
    if (!v.ok) {
      const q3 = applySpeed(await e.audioQuery(kanaText(spec.kana), voice.styleId));
      const v3 = verifyMorae(q3, spec.kana, strict);
      if (v3.ok) {
        q = q3;
        v = v3;
        step = 'kana-text';
      }
    }
    if (!v.ok) {
      skips.push({ key: spec.key, id: '', text: spec.text, kana: spec.kana, got: v.got.join(''), want: v.want.join(''), step: 'skip', reason: 'morae differ after the ladder' });
      return null;
    }
  } else step = 'unverified';

  // Accent for the words the app grades (design 08 §7 step 3b, §15).
  let pitchVerified = false;
  if (spec.pitchHigh && spec.pitch !== undefined) {
    if (q.accent_phrases.length !== 1) {
      // The engine split the word into phrases: re-query as ONE phrase in kana notation (engine form: ー expanded, which the parser demands).
      const morae = engineMorae(spec.kana);
      const accent = expectedAccent(spec.pitch, morae.length);
      const one = morae.map((m, i) => m + (i + 1 === accent ? "'" : '')).join('');
      try {
        const phrases = await e.accentPhrases(one, voice.styleId, true);
        const q4 = applySpeed(withAccentPhrases(q, phrases));
        if (verifyMorae(q4, spec.kana, strict).ok && q4.accent_phrases.length === 1) q = q4;
      } catch {
        /* keep q */
      }
    }
    const a = verifyAccent(q, spec.pitch);
    if (q.accent_phrases.length === 1) {
      if (!a.ok) q = applySpeed(withAccent(q, a.want));
      pitchVerified = verifyAccent(q, spec.pitch).ok;
    }
    if (!pitchVerified) {
      skips.push({ key: spec.key, id: '', text: spec.text, kana: spec.kana, got: String(a.got), want: String(a.want), step: 'accent', reason: `accent could not be set on ${q.accent_phrases.length} phrases` });
      return null;
    }
  }
  const wav = await e.synthesis(q, voice.styleId);
  return { query: q, wav, step, pitchVerified };
}

/** The vocab word behind the first differing mora of a line (ladder step 1). */
export function offendingWord(spec: ClipSpec, got: readonly string[], want: readonly string[], lookupWord: WordLookup): { surface: string; kana: string; pitch?: number } | undefined {
  if (!spec.tokens || !spec.ja) return undefined;
  let pre = 0;
  while (pre < got.length && pre < want.length && got[pre] === want[pre]) pre++;
  let at = 0;
  const toks = segmentsToTokens(spec.ja, spec.tokens);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i] as { token: string; ja: string };
    const n = moraCount(normalizeJa(toKana(tok.ja)));
    if (pre < at + n || i === toks.length - 1) {
      const hit = lookupWord(tok.token, spec.tokenIds?.[i] ?? null);
      if (hit) return hit;
      // No item behind the token: the token's own ruby reading is still a usable entry.
      const reading = normalizeJa(toKana(tok.ja));
      if (reading && reading !== tok.token && /[一-鿿々]/.test(tok.token)) return { surface: tok.token, kana: reading };
      return undefined;
    }
    at += n;
  }
  return undefined;
}

/* ── the run ───────────────────────────────────────────────────────────── */

export interface RenderOptions {
  root: string;
  out: string;
  cache: string;
  castPath: string;
  tiers: Tier[];
  stations?: [number, number];
  engines: string[];
  dryRun: boolean;
  fixtures?: string;
  limit?: number;
  ffmpeg: string;
  dict: DictPolicy;
  prune: boolean;
  previousManifest?: string;
  /** Overwrite a complete real pack's manifest with a dry or partial run (never by default). */
  force?: boolean;
  /** Exit 0 even when ≥ 2 % of clips were skipped (the acceptance budget). */
  allowSkips?: boolean;
  log?: (line: string) => void;
}

export interface RenderResult {
  manifest: AudioManifest;
  indexes: IndexFile[];
  specs: number;
  rendered: number;
  cached: number;
  skipped: SkipRecord[];
  seconds: number;
}

/** What a run leaves out on purpose (`manifest.partial`); `null` for the whole corpus. */
export function partialOf(o: Pick<RenderOptions, 'stations' | 'limit'>): ManifestPartial | null {
  if (!o.stations && o.limit === undefined) return null;
  const p: ManifestPartial = {};
  if (o.stations) p.stations = o.stations;
  if (o.limit !== undefined) p.limit = o.limit;
  return p;
}

export interface ShardOptions {
  log?: (line: string) => void;
  /** Consecutive transport failures that retire an engine (default 3). */
  maxConsecutiveFailures?: number;
  /** Pause after a transport failure so a healthy engine takes the requeued clip first (default 250 ms × failures). */
  retryDelayMs?: number;
  /** Progress line interval (default 30 s; 0 disables). */
  reportEveryMs?: number;
  /** A non-transport engine error (HTTP 4xx): the clip is skipped with this reason. */
  onSkip: (spec: ClipSpec, reason: string) => void;
}

/**
 * Shards `todo` across the engines from one queue: each engine serialises its
 * own requests, a shared queue balances them. A transport failure (connection
 * refused / reset, HTTP 5xx) puts the clip back at the head of the queue and
 * counts against that engine; `maxConsecutiveFailures` in a row retire it (its
 * worker stops, the others drain the queue). When every engine is retired the
 * run fails — the cache resumes it. Any other error skips just that clip.
 */
export async function shardAcrossEngines<E extends { base: string }>(todo: readonly ClipSpec[], engines: readonly E[], produce: (spec: ClipSpec, e: E) => Promise<void>, o: ShardOptions): Promise<{ done: number; retired: string[] }> {
  const log = o.log ?? (() => {});
  const max = o.maxConsecutiveFailures ?? 3;
  const delay = o.retryDelayMs ?? 250;
  const queue = [...todo];
  const retired: string[] = [];
  let done = 0;
  const t0 = Date.now();
  const every = o.reportEveryMs ?? 30000;
  const report = every > 0 ? setInterval(() => log(`  … ${done}/${todo.length} clips, ${((Date.now() - t0) / 60000).toFixed(1)} min`), every) : null;
  try {
    await Promise.all(
      engines.map(async (e) => {
        let failures = 0;
        for (;;) {
          const spec = queue.shift();
          if (!spec) return;
          try {
            await produce(spec, e);
            failures = 0;
            done++;
          } catch (err) {
            const message = (err as Error).message;
            if (!isTransportError(err)) {
              o.onSkip(spec, `engine error: ${message}`);
              done++;
              continue;
            }
            queue.unshift(spec);
            failures++;
            log(`warning: ${e.base} failed (${failures}/${max}) on ${spec.key}: ${message}`);
            if (failures >= max) {
              retired.push(e.base);
              if (retired.length === engines.length) throw new Error(`render: every engine is down (${retired.join(', ')}); ${queue.length} clips not rendered — restart the engines and re-run (the cache resumes)`);
              log(`engine ${e.base} retired after ${max} consecutive failures; ${queue.length} clips go to the other engines`);
              return;
            }
            if (delay > 0) await new Promise((r) => setTimeout(r, delay * failures));
          }
        }
      }),
    );
  } finally {
    if (report) clearInterval(report);
  }
  return { done, retired };
}

interface Produced {
  spec: ClipSpec;
  id: string;
  query: AudioQuery;
  seconds: number;
  samples: number;
  pitchVerified: boolean;
  voice: Voice & { styleId: number };
  /** Cached WAV path (real render) — absent in a dry run. */
  wavPath?: string;
}

const nowIso = (): string => new Date().toISOString();

/** The whole pipeline (CLI body); pure in its inputs, writes under `out` and `cache`. */
export async function renderAudio(o: RenderOptions): Promise<RenderResult> {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const t0 = Date.now();
  const corpus = loadCorpus(o.root);
  const cast = loadCast(o.castPath);
  const tiers = new Set<Tier>(o.tiers);
  const partial = partialOf(o);

  // What is in --out already, and what this run measures reuse against. Read before anything is written.
  const manifestPath = join(o.out, 'manifest.json');
  const existing = existsSync(manifestPath) ? readJson<AudioManifest>(manifestPath) : null;
  if (existing && !existing.dryRun && !existing.partial && (o.dryRun || partial) && !o.force) {
    throw new Error(`render: ${manifestPath} is a complete real pack (${existing.audioVersion}); a ${o.dryRun ? 'dry run' : 'partial render'} would overwrite its manifest and indexes — use another --out (a dry run defaults to .audio-cache/dry-run/audio) or pass --force`);
  }
  const previousPath = o.previousManifest ?? manifestPath;
  const previous = o.previousManifest ? (existsSync(previousPath) ? readJson<AudioManifest>(previousPath) : null) : existing;
  const previousKana = previous ? readKanaSidecar(join(dirname(previousPath), previous.audioVersion, KANA_SIDECAR)) : null;
  if (partial) log(`partial render (${partial.stations ? `stations ${partial.stations[0]}-${partial.stations[1]}` : ''}${partial.stations && partial.limit !== undefined ? ', ' : ''}${partial.limit !== undefined ? `limit ${partial.limit}` : ''}): the manifest is marked partial, nothing is pruned, pack.ts will refuse it`);
  mkdirSync(o.cache, { recursive: true });
  mkdirSync(o.out, { recursive: true });

  // Engines or fixtures.
  const engines = o.dryRun ? [] : o.engines.map((b) => new Engine(b));
  let speakers: SpeakerInfo[];
  if (o.dryRun) {
    const fixturesDir = o.fixtures ?? DEFAULT_FIXTURES;
    speakers = readJson<SpeakerInfo[]>(join(fixturesDir, 'speakers.json'));
  } else {
    const first = engines[0];
    if (!first) throw new Error('render: no engine given (--engines)');
    const version = await first.version();
    if (version !== ENGINE_VERSION) log(`warning: engine reports ${version}, pipeline is pinned to ${ENGINE_VERSION}`);
    speakers = await first.speakers();
  }
  const voices = resolveVoices(cast, speakers);

  // Dictionary.
  const dict = dictionaryEntries(corpus, o.dict);
  const dictVersion = dictVersionOf(dict);
  if (!o.dryRun) {
    for (const e of engines) {
      const r = await syncDictionary(e, dict);
      log(`dictionary ${dictVersion} on ${e.base}: ${dict.length} entries (+${r.added} −${r.removed}${r.touched ? ', touched to recompile the shared file' : ''})`);
    }
  }

  // Inventory.
  let specs = inventory(corpus, { tiers, ...(o.stations ? { stations: o.stations } : {}) });
  if (tiers.has('pool') && corpus.pools.length === 0) log('warning: --tier pool but public/content/listening/pool-*.json is absent (run content:assign first); no example sentences rendered');
  if (o.limit !== undefined) specs = specs.slice(0, o.limit);
  const todo = specs.filter((s) => !s.reuseOf);
  log(`inventory: ${specs.length} clips (${todo.length} to render, ${specs.length - todo.length} kanji examples reuse a vocab clip) over tiers ${[...tiers].join(',')}`);

  const vocabByWord = new Map<string, VocabItem>();
  const vocabById = new Map<string, VocabItem>();
  for (const v of corpus.vocab) {
    vocabByWord.set(v.word, v);
    vocabById.set(v.id, v);
  }
  const lookupWord: WordLookup = (token, id) => {
    const v = (id && vocabById.get(id)) || vocabByWord.get(token);
    if (!v) return undefined;
    const hit: { surface: string; kana: string; pitch?: number } = { surface: v.word, kana: v.kana };
    if (v.pitch !== undefined) hit.pitch = v.pitch;
    return hit;
  };

  // Render (or look up) every clip.
  const produced = new Map<string, Produced>();
  const skips: SkipRecord[] = [];
  let rendered = 0;
  let cached = 0;
  const fixtures = o.dryRun ? loadQueryFixtures(o.fixtures ?? DEFAULT_FIXTURES) : new Map<string, QueryFixture>();
  const dedupe = new Map<string, Produced>();

  const produce = async (spec: ClipSpec, e: Engine | null): Promise<void> => {
    const voice = voiceOf(spec, voices);
    const id = clipIdOf(spec, voices, dictVersion);
    const key = `${spec.key}@${spec.rate}`;
    const same = dedupe.get(id);
    if (same) {
      produced.set(key, { ...same, spec });
      return;
    }
    const jsonPath = join(o.cache, `${id}.json`);
    const wavPath = join(o.cache, `${id}.wav`);
    if (!o.dryRun && existsSync(jsonPath) && existsSync(wavPath)) {
      const c = readJson<CachedClip>(jsonPath);
      const p: Produced = { spec, id, query: c.query, seconds: c.seconds, samples: Math.round(c.seconds * SAMPLE_RATE), pitchVerified: c.pitchVerified, voice, wavPath };
      produced.set(key, p);
      dedupe.set(id, p);
      cached++;
      return;
    }
    if (o.dryRun) {
      const fx = fixtures.get(spec.text);
      let q = fx ? structuredClone(fx.query) : estimateQuery(spec.kana || spec.text);
      q.speedScale = spec.rate;
      if (spec.rate !== 1) q.pauseLengthScale = SLOW_PAUSE_SCALE;
      let pitchVerified = false;
      if (spec.kana && fx) {
        const v = verifyMorae(q, spec.kana, spec.kanaName === true);
        if (!v.ok) {
          const patch = kanaPatch(q, spec.kana, spec.kanaName === true);
          // Without an engine the patch cannot be re-queried: a fixture misread is a skip (so skipped.jsonl exercises the path).
          skips.push({ key: spec.key, id, text: spec.text, kana: spec.kana, got: v.got.join(''), want: v.want.join(''), step: 'skip', reason: `dry run: misread (patch would be ${patch ?? '—'})` });
          return;
        }
      }
      if (spec.pitchHigh && spec.pitch !== undefined) {
        const a = verifyAccent(q, spec.pitch);
        if (!a.ok) q = withAccent(q, a.want);
        pitchVerified = verifyAccent(q, spec.pitch).ok;
      }
      const seconds = queryDuration(q);
      const p: Produced = { spec, id, query: q, seconds, samples: Math.round(seconds * SAMPLE_RATE), pitchVerified, voice };
      produced.set(key, p);
      dedupe.set(id, p);
      rendered++;
      return;
    }
    if (!e) throw new Error('render: no engine for a live render');
    const r = await renderOne(e, spec, voice, lookupWord, skips);
    if (!r) {
      const last = skips[skips.length - 1];
      if (last) last.id = id;
      return;
    }
    const pcm = pcmOfWav(r.wav);
    const seconds = pcm.length / 2 / SAMPLE_RATE;
    writeFileSync(wavPath, wrapWav(pcm));
    const c: CachedClip = { id, key: spec.key, text: spec.text, kana: spec.kana, styleId: voice.styleId, rate: spec.rate, step: r.step, query: r.query, seconds, pitchVerified: r.pitchVerified, renderedAt: nowIso() };
    writeFileSync(jsonPath, JSON.stringify(c));
    const p: Produced = { spec, id, query: r.query, seconds, samples: pcm.length / 2, pitchVerified: r.pitchVerified, voice, wavPath };
    produced.set(key, p);
    dedupe.set(id, p);
    rendered++;
  };

  const skippedPath = join(o.cache, 'skipped.jsonl');
  const writeSkipped = (): void => writeFileSync(skippedPath, skips.map((s) => JSON.stringify(s)).join('\n') + (skips.length ? '\n' : ''));
  if (o.dryRun) {
    for (const spec of todo) await produce(spec, null);
  } else {
    try {
      await shardAcrossEngines(todo, engines, (spec, e) => produce(spec, e), {
        log,
        onSkip: (spec, reason) => skips.push({ key: spec.key, id: '', text: spec.text, kana: spec.kana, got: '', want: '', step: 'skip', reason }),
      });
    } catch (err) {
      writeSkipped(); // what the ladder skipped so far is kept for the re-run
      throw err;
    }
  }
  writeSkipped();
  log(`clips: ${rendered} rendered, ${cached} cached, ${skips.length} skipped → ${relative(REPO_ROOT, skippedPath)}`);

  // Sprites.
  const castSha = cast.sha;
  const audioVersion = audioVersionOf({ contentVersion: corpus.contentVersion, castSha, engine: ENGINE_LABEL, dictVersion, tiers: [...tiers], rules: RENDER_RULES_VERSION }, sha256Hex);
  const groups = new Map<string, Produced[]>();
  for (const spec of specs) {
    if (spec.reuseOf) continue;
    const p = produced.get(`${spec.key}@${spec.rate}`);
    if (!p) continue;
    let g = groups.get(spec.group);
    if (!g) {
      g = [];
      groups.set(spec.group, g);
    }
    g.push(p);
  }
  const files: ManifestFileEntry[] = [];
  const fileSha: Record<string, string> = {};
  const clips: RenderedClip[] = [];
  const trackRecords: TrackRecord[] = [];
  const spritesDir = join(o.out, 'sprites');
  const written = new Set<string>();
  const tmpDir = o.dryRun ? '' : join(tmpdir(), `tsuzuku-sprites-${process.pid}`);
  if (tmpDir) mkdirSync(tmpDir, { recursive: true });
  const trackSpecs = new Map<string, KanaTrackSpec>(kanaTracks(corpus.kana).map((t) => [t.name, t]));

  const emitSprite = (dir: string, base: string, parts: Produced[], tier: Tier, station: number): { path: string; cues: { p: Produced; start: number; end: number }[] } => {
    const lengths: ClipLength[] = parts.map((p) => ({ id: p.id, samples: p.samples }));
    let bytes: Buffer;
    let name: string;
    let seconds: number;
    if (o.dryRun) {
      const lay = layout(lengths);
      seconds = lay.seconds;
      const pseudo = sha256Hex(parts.map((p) => p.id).join(','));
      name = `${base}-${pseudo.slice(0, 8)}.webm`;
      bytes = Buffer.alloc(0);
      files.push({ path: `${dir}/${name}`, bytes: estimateOpusBytes(seconds), seconds, clips: parts.length, belt: beltOfStation(station), tier });
      fileSha[`${dir}/${name}`] = pseudo;
      return { path: `${dir}/${name}`, cues: lay.clips.map((c, i) => ({ p: parts[i] as Produced, start: c.start, end: c.end })) };
    }
    const { pcm, layout: lay } = concatPcm(parts.map((p) => ({ id: p.id, pcm: pcmOfWav(readFileSync(p.wavPath as string)) })));
    seconds = lay.seconds;
    const wavTmp = join(tmpDir, `${base}.wav`);
    const webmTmp = join(tmpDir, `${base}.webm`);
    writeFileSync(wavTmp, wrapWav(pcm));
    encodeOpus(wavTmp, webmTmp, o.ffmpeg);
    bytes = readFileSync(webmTmp);
    rmSync(wavTmp, { force: true });
    rmSync(webmTmp, { force: true });
    name = spriteName(base, bytes);
    const rel = `${dir}/${name}`;
    const abs = join(o.out, rel);
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }
    written.add(rel);
    files.push({ path: rel, bytes: bytes.length, seconds, clips: parts.length, belt: beltOfStation(station), tier });
    fileSha[rel] = sha256Hex(bytes);
    return { path: rel, cues: lay.clips.map((c, i) => ({ p: parts[i] as Produced, start: c.start, end: c.end })) };
  };

  const record = (p: Produced, file: string, start: number, end: number): RenderedClip => {
    const s = p.spec;
    const kind = s.kind === 'track' ? 'word' : s.kind;
    const r: RenderedClip = { key: s.key, kind, level: s.level, station: s.station, rate: s.rate, voice: p.voice.credit, file, start, end, kana: s.kana };
    if (s.kind === 'sentence' || s.kind === 'line') {
      r.text = s.text;
      if (s.textAlt) r.textAlt = s.textAlt;
      r.query = p.query;
    }
    if (p.pitchVerified) r.pitchVerified = true;
    if (s.textId !== undefined) r.textId = s.textId;
    if (s.lineIndex !== undefined) r.lineIndex = s.lineIndex;
    if (s.lineCount !== undefined) r.lineCount = s.lineCount;
    return r;
  };

  const cueByKey = new Map<string, RenderedClip>();
  for (const [group, parts] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [scope, kind, ...rest] = group.split('/') as [string, string, ...string[]];
    const station = parts[0]?.spec.station ?? 1;
    const tier = parts[0]?.spec.tier ?? 'core';
    if (scope === 'kana') {
      // One sprite per kana track; segments in order.
      const ordered = [...parts].sort((a, b) => (a.spec.segment ?? 0) - (b.spec.segment ?? 0));
      const { path, cues } = emitSprite('sprites/kana', kind, ordered, tier, 1);
      const t = trackSpecs.get(kind);
      const first = cues[0];
      const last = cues[cues.length - 1];
      if (t && first && last) {
        trackRecords.push({
          key: `track:${t.name}`,
          title: t.title,
          titleEn: t.titleEn,
          file: path,
          start: first.start,
          end: last.end,
          voice: first.p.voice.credit,
          rate: t.rate,
          station: 1,
          segments: cues.map((c) => {
            const seg = t.segments[c.p.spec.segment ?? 0];
            return { s: c.start, e: c.end, text: seg?.text ?? c.p.spec.text, ...(seg?.en ? { en: seg.en } : {}) };
          }),
        });
      }
      continue;
    }
    if (kind === 'text') {
      // One sprite per text: lines at rate 1 in order, then the slow takes.
      const textId = rest[0] as string;
      const ordered = [...parts].sort((a, b) => b.spec.rate - a.spec.rate || (a.spec.lineIndex ?? 0) - (b.spec.lineIndex ?? 0));
      const { path, cues } = emitSprite(`sprites/${scope}`, textId, ordered, tier, station);
      for (const c of cues) {
        const r = record(c.p, path, c.start, c.end);
        clips.push(r);
        if (c.p.spec.rate === 1) cueByKey.set(c.p.spec.key, r);
      }
      continue;
    }
    // Mixed-kind sprites ≤ 90 s: words-NN, grammar-NN, examples-NN, misc-NN, ear-NN.
    const ordered = [...parts].sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : b.spec.rate - a.spec.rate));
    planMixedSprites(ordered.map((p) => ({ id: p.id, samples: p.samples, p }))).forEach((chunk, i) => {
      const { path, cues } = emitSprite(`sprites/${scope}`, `${kind}-${String(i + 1).padStart(2, '0')}`, chunk.map((c) => c.p), tier, station);
      for (const c of cues) {
        const r = record(c.p, path, c.start, c.end);
        clips.push(r);
        if (c.p.spec.rate === 1) cueByKey.set(c.p.spec.key, r);
      }
    });
  }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });

  // Kanji example words that reuse a vocab clip: the same cue under their own key.
  for (const spec of specs) {
    if (!spec.reuseOf) continue;
    const target = cueByKey.get(spec.reuseOf);
    if (!target) continue;
    clips.push({ ...target, key: spec.key, level: spec.level, kana: spec.kana, station: spec.station });
  }

  // Indexes.
  const indexes = buildIndexes(clips, trackRecords, audioVersion);
  const findings = indexBudgetFindings(indexes);
  for (const f of findings) log(`${f.level === 'error' ? 'ERROR' : 'warning'}: ${f.path} is ${f.bytes} bytes (limit ${f.limit})`);
  if (findings.some((f) => f.level === 'error')) throw new Error('render: a level index is over the 350 KB budget (design 08 §14); split the level or trim cue fields');
  const versionDir = join(o.out, audioVersion);
  const indexEntries: AudioManifest['indexes'] = [];
  for (const f of indexes) {
    const text = serializeIndex(f.json);
    const abs = join(versionDir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    indexEntries.push({ path: `${audioVersion}/${f.path}`, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Hex(text) });
  }
  // Sidecar: full sha256 per sprite (pack and check read it; the manifest stays small).
  {
    const sorted = Object.fromEntries(Object.entries(fileSha).sort(([a], [b]) => (a < b ? -1 : 1)));
    const text = JSON.stringify(sorted);
    writeFileSync(join(versionDir, FILES_SIDECAR), text);
    indexEntries.push({ path: `${audioVersion}/${FILES_SIDECAR}`, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Hex(text) });
  }

  // Manifest.
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const { belts, totals } = beltTotals(files, clips.length + trackRecords.length);
  const usedVoices: Record<string, ManifestVoice> = {};
  const credits = new Set<string>();
  for (const p of produced.values()) {
    const v = voices.get(p.spec.speaker);
    if (v) {
      usedVoices[v.label] = { character: v.character, style: v.style, styleId: v.styleId, credit: v.credit };
      credits.add(v.credit);
    }
  }
  const total = rendered + cached;
  const manifest: AudioManifest = {
    schema: MANIFEST_SCHEMA,
    audioVersion,
    contentVersion: corpus.contentVersion,
    engine: ENGINE_LABEL,
    dictVersion,
    castSha,
    tiers: [...tiers].sort(),
    generatedAt: nowIso(),
    dryRun: o.dryRun,
    partial,
    voices: Object.fromEntries(Object.entries(usedVoices).sort(([a], [b]) => (a < b ? -1 : 1))),
    belts,
    files,
    indexes: indexEntries,
    totals,
    render: { rendered, cached, skipped: skips.length, reused: specs.length - todo.length },
    changedClipShare: total === 0 ? 0 : Math.round((rendered / total) * 10000) / 10000,
    contentDiffShare: kanaDiffShare(kanaSidecarOf(indexes)?.keys ?? {}, previousKana),
    skipped: skips.length,
    credits: [...credits].sort(),
    reusedBytesShare: reusedBytesShare(files, previous),
  };
  const manifestText = JSON.stringify(manifest);
  writeFileSync(manifestPath, manifestText);

  // Prune sprites and index directories the manifest no longer names (never after a partial render: the other stations' sprites are not in this manifest).
  if (o.prune && !o.dryRun && !partial) {
    const keep = new Set(files.map((f) => f.path));
    for (const abs of walkAll(spritesDir)) {
      const rel = relative(o.out, abs).split(sep).join('/');
      if (!keep.has(rel)) rmSync(abs, { force: true });
    }
    if (existsSync(o.out)) for (const name of readdirSync(o.out)) if (/^a-[0-9a-f]{10}$/.test(name) && name !== audioVersion) rmSync(join(o.out, name), { recursive: true, force: true });
  }

  const seconds = (Date.now() - t0) / 1000;
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
  log(`pack ${audioVersion} (${corpus.contentVersion}, dict ${dictVersion}${o.dryRun ? ', DRY RUN' : ''}${partial ? ', PARTIAL' : ''}): ${files.length} sprites, ${mb(totals.bytes)} MB, ${(totals.seconds / 3600).toFixed(2)} h; ${indexes.length} indexes${manifest.reusedBytesShare !== null ? `; reusedBytesShare ${manifest.reusedBytesShare}` : ''}${manifest.contentDiffShare !== null ? `; contentDiffShare ${manifest.contentDiffShare}` : ''}; ${seconds.toFixed(0)} s`);
  for (const [belt, b] of Object.entries(belts)) log(`  ${belt}: ${mb(b.bytes)} MB, ${(b.seconds / 60).toFixed(1)} min, ${b.files} files`);
  if (Buffer.byteLength(manifestText) > MAX_MANIFEST_BYTES) log(`warning: manifest is ${Buffer.byteLength(manifestText)} bytes (accepted budget ${MAX_MANIFEST_BYTES / 1024} KiB raw, docs/AUDIO_PACK.md §8; ≈ 110–135 bytes per sprite, gzipped on the wire)`);
  return { manifest, indexes, specs: specs.length, rendered, cached, skipped: skips, seconds };
}

/** The `keys` of a `kana.json` sidecar on disk, or `null` when it is missing or not one. */
export function readKanaSidecar(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null;
  try {
    const j = readJson<Partial<KanaIndex>>(path);
    return j.kind === 'kana' && j.keys && typeof j.keys === 'object' ? j.keys : null;
  } catch {
    return null;
  }
}

function walkAll(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else out.push(p);
  }
  return out;
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

export function parseArgs(argv: readonly string[]): RenderOptions {
  const o: RenderOptions = {
    root: join(REPO_ROOT, 'public', 'content'),
    out: join(REPO_ROOT, 'public', 'audio'),
    cache: join(REPO_ROOT, '.audio-cache'),
    castPath: join(here, 'cast.json'),
    tiers: [],
    engines: DEFAULT_ENGINES,
    dryRun: false,
    ffmpeg: 'ffmpeg',
    dict: 'high',
    prune: true,
  };
  let outGiven = false;
  let cacheGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--tier') {
      const t = next();
      if (!(TIERS as readonly string[]).includes(t)) throw new Error(`unknown tier ${t}`);
      o.tiers.push(t as Tier);
    } else if (a === '--stations') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(next());
      if (!m) throw new Error('--stations A-B');
      o.stations = [Number(m[1]), Number(m[2] ?? m[1])];
    } else if (a === '--engines') o.engines = next().split(',').filter(Boolean);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--fixtures') {
      const v = argv[i + 1];
      o.fixtures = v && !v.startsWith('--') ? resolve(argv[++i] as string) : DEFAULT_FIXTURES;
    } else if (a === '--limit') o.limit = Number(next());
    else if (a === '--root') o.root = resolve(next());
    else if (a === '--out') {
      o.out = resolve(next());
      outGiven = true;
    } else if (a === '--cache') {
      o.cache = resolve(next());
      cacheGiven = true;
    } else if (a === '--cast') o.castPath = resolve(next());
    else if (a === '--ffmpeg') o.ffmpeg = next();
    else if (a === '--dict') {
      const d = next();
      if (d !== 'high' && d !== 'all' && d !== 'none') throw new Error('--dict high|all|none');
      o.dict = d;
    } else if (a === '--no-prune') o.prune = false;
    else if (a === '--previous') o.previousManifest = resolve(next());
    else if (a === '--force') o.force = true;
    else if (a === '--allow-skips') o.allowSkips = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'usage: node scripts/audio/render-audio.ts [--tier core|pool|ear]… [--stations A-B] [--engines url,…] [--dry-run] [--fixtures [dir]] [--limit N]\n       [--root public/content] [--out public/audio] [--cache .audio-cache] [--cast scripts/audio/cast.json] [--ffmpeg ffmpeg] [--dict high|all|none] [--no-prune]\n       [--previous manifest.json] [--force] [--allow-skips]\n  a dry run writes to .audio-cache/dry-run/{audio,cache} unless --out / --cache are given\n',
      );
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (o.tiers.length === 0) o.tiers = ['core'];
  // A dry run never lands on the real pack or the real skipped.jsonl by default.
  if (o.dryRun) {
    if (!outGiven) o.out = join(REPO_ROOT, '.audio-cache', 'dry-run', 'audio');
    if (!cacheGiven) o.cache = join(REPO_ROOT, '.audio-cache', 'dry-run', 'cache');
  }
  return o;
}

/** Skipped share of the acceptance budget (design 08 §14: < 2 %). */
export const MAX_SKIPPED_SHARE = 0.02;

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  renderAudio(opts)
    .then((r) => {
      const share = r.specs === 0 ? 0 : r.skipped.length / r.specs;
      if (share < MAX_SKIPPED_SHARE) return;
      const msg = `${(share * 100).toFixed(1)} % of clips skipped (budget < ${MAX_SKIPPED_SHARE * 100} %, see ${relative(REPO_ROOT, join(opts.cache, 'skipped.jsonl'))})`;
      if (opts.dryRun || opts.allowSkips) process.stdout.write(`warning: ${msg}\n`);
      else {
        process.stderr.write(`render-audio: ${msg} — fix the content or the ladder, or pass --allow-skips to ship anyway\n`);
        process.exit(1);
      }
    })
    .catch((e: Error) => {
      process.stderr.write(`render-audio: ${e.message}\n`);
      process.exit(1);
    });
}
