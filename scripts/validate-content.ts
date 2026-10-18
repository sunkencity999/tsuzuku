/**
 * TSUZUKU — content validator (CONTENT_GUIDE §18, rules V01–V43, V45, V46).
 *
 *   node scripts/validate-content.ts [--strict] [--json] [--only <glob-or-path>] [--fix-tokenids] [--root <dir>]
 *                                    [--cast <path>] [--listening-release]
 *
 * Runs under Node's native type stripping, so this file uses only erasable
 * TypeScript and imports `src/content/types.ts` / `src/content/ruby.ts`
 * directly (no duplicated regexes). Exit code 1 on any failure.
 *
 * Severity model
 *  - V01–V08, V10–V19, V21–V27, V30–V33: FAIL / WARN exactly as the guide says.
 *  - V20 (coverage), V34 (quotas), V35 (manifest), V36 (J-J definitions):
 *    WARN unless `--strict` AND `stations/NN.json` bundles exist; then they
 *    are computed against the bundles and FAIL, and the linker writes
 *    `StoryLine.tokenIds` (also with `--fix-tokenids`). V20 also carries two
 *    always-WARN notes: an allowlisted word detected but not in `vocabIds`,
 *    and `vocabIds` covering < 60 % of the allowlisted words detected.
 *  - V37 (pos vs verb ending), V38 (repeated kanji component), V39 (the same
 *    michikusa ja/kana collected at two stations) and V40 (a station's grammar
 *    declares `unlocksForms` while its cumulative allowlist holds no verb /
 *    adjective to conjugate; needs bundles): WARN only, informational; the
 *    content is kept as written.
 *  - Listening (design 08 §5): V41 (listening fields) FAIL; V42 (cast) FAIL in
 *    strict mode, WARN otherwise, one WARN "cast check skipped" when the cast
 *    file (`--cast`, default `scripts/audio/cast.json`) is absent; V43 placement
 *    (an `audioFirst` text lives in `listening-sNN.json`, none at Stations 1–3)
 *    FAIL in strict mode with bundles, and the per-station `quota.listening`
 *    count FAIL only with `--strict --listening-release` (WARN in strict without
 *    the flag, silent under quota otherwise — like V34's story count); V45
 *    (minutes band) WARN; V46 (own-station all-known example) WARN, FAIL for
 *    Stations 4–15 with `--strict --listening-release`. `--listening-release`
 *    is the "at release" switch of design 08 §5: it is added to `content:all`
 *    once Pass 4 / 4b have landed. V44 (pools) is reported by
 *    `scripts/build-content-index.ts`'s default check, not here; the walk skips
 *    `listening/pool-*.json` exactly as it skips `stations/`.
 *  - The token → item matcher (V19 / V20 tokenIds, V36 segmentation) is
 *    `scripts/linker.ts`, shared with `content:assign`; it links inflected
 *    forms of allowlisted verbs and the copula (します, いった, ではない …), so
 *    changing it makes every story's `tokenIds` stale until `--fix-tokenids`.
 *  - `_meta/components.json` is a ContentFile<ComponentDef> exempt from the
 *    150 cap; `_meta/denylist.json` is not a ContentFile (read by V30 only).
 *
 * Performance notes: V30 compiles the denylist once — Latin terms into a few
 * case-insensitive, word-boundary-aware alternation regexes (longest first),
 * other terms into a first-character bucket scan — instead of one regex per
 * term per string; V36 caches the match pool per station.
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { moraCount, speechMorae } from '../src/shared/jp.ts';
import {
  BELT_IDS,
  CONJ_FORMS,
  CONTENT_KINDS,
  DOMAIN_TAGS,
  GENRE_FROM_STATION,
  ID_PATTERNS,
  KANA_SENTENCE_RE,
  KANA_WORD_RE,
  LEVELS,
  LINE_EMOTIONS,
  LISTENING_GENRES,
  MAX_ITEMS_PER_FILE,
  MISC_TAGS,
  POS_VALUES,
  QUESTION_KINDS,
  REGISTER_TAGS,
  RUBY_RE,
  SENTENCE_MAX_CHARS,
  STATIONS,
  BRIDGE_FROM_STATION,
  coverageTargetFor,
} from '../src/content/types.ts';
import type {
  Belt,
  ComponentDef,
  ConjugationGoldenEntry,
  ContentKind,
  GrammarItem,
  KanaItem,
  KanjiItem,
  Level,
  ListeningGenre,
  MichikusaItem,
  StationBundle,
  StationDef,
  StoryItem,
  StoryLine,
  VocabItem,
  ContentManifest,
} from '../src/content/types.ts';
import { KANJI_RE, hasKanji, parseRuby, toKana, toPlain } from '../src/content/ruby.ts';
import type { RubySegment } from '../src/content/ruby.ts';
import { buildIndex, deriveContentVersion, isDerivedVersion, listContentFiles } from './build-content-index.ts';
import { bundlesFromCorpus, stringifyJson } from './assign-stations.ts';
import { allowlistStationFor, AUX_VERBS, buildMatchPool, CAST_NAMES, cumulativeIds, FUNCTION_TOKENS, linkSentence, matchToken, stemApplies } from './linker.ts';
import type { MatchPool } from './linker.ts';

/* ────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Finding {
  /** Path relative to the content root, e.g. `vocab/n5/vocab-n5-001.json`. */
  file: string;
  id?: string;
  rule: string;
  message: string;
}

export interface Denylist {
  terms: string[];
  patterns: string[];
}

export interface ValidateOptions {
  /** Overrides `_meta/components.json`. */
  components?: ComponentDef[];
  /** Overrides `_meta/denylist.json`. */
  denylist?: Denylist | string[];
  /** Release mode: V20/V34/V35/V36 fail (when bundles exist) and tokenIds are written. */
  strict?: boolean;
  /** Glob or path (relative to the root) restricting which files' findings are reported. */
  only?: string;
  /** Write `StoryLine.tokenIds` from the V20 match (requires bundles). */
  fixTokenIds?: boolean;
  /**
   * V42 cast (design 08 §5–§6): the path of `cast.json` (default `scripts/audio/cast.json`), or the
   * parsed file. An absent file is one W "cast check skipped".
   */
  cast?: string | CastInput;
  /**
   * The "at release" switch of design 08 §5 for the listening rules: with `strict`, the V43 per-station
   * `quota.listening` count and V46 for Stations 4–15 FAIL instead of WARN. Off until Pass 4 / 4b land.
   */
  listeningRelease?: boolean;
}

/**
 * `scripts/audio/cast.json` as the validator reads it (design 08 §6: one entry per speaker label and
 * narrator role, `{ name, gender, age, character, style, emotionStyles?, credit }`). The render-pipeline
 * owner authors the file; V42 only needs the names, so an array of entries, an object holding that array
 * under `speakers` / `cast` / `entries` / `voices`, or an object keyed by name all work.
 */
export type CastInput = unknown;

export interface ValidateResult {
  failures: Finding[];
  warnings: Finding[];
  /** Story lines whose `tokenIds` were computed by the linker (written when fixing). */
  linked: number;
  /** Content files inspected. */
  files: number;
  /** True when `stations/NN.json` bundles were available for V20/V34–V36. */
  bundles: boolean;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Corpus loading                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

interface LoadedFile {
  rel: string;
  abs: string;
  text: string;
  json: Json | undefined;
  parseError?: string;
  /** Kind implied by the directory (V01). */
  pathKind: ContentKind | null;
  /** Level implied by the path, or null. */
  pathLevel: Level | null;
  /** NNN / NN from the file name, when present. */
  seq: number | null;
  items: JsonObject[];
  meta: boolean;
}

const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS);

/** `listening/pool-NN.json` — the generated pool files the walk skips exactly as it skips `stations/` (design 08 §4). */
export const POOL_FILE_RE = /^listening\/pool-\d{2}\.json$/;
/** `stories/<level>/listening-sNN.json` — the files that hold audio-first pieces (design 08 §3, V43). */
const LISTENING_FILE_RE = /^stories\/(kana|n[1-5])\/listening-s(\d{2})\.json$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

function kindOfPath(rel: string): ContentKind | null {
  const seg = rel.split('/')[0] ?? '';
  switch (seg) {
    case 'kana':
    case 'vocab':
    case 'kanji':
    case 'grammar':
    case 'conjugation':
    case 'michikusa':
      return seg;
    case 'stories':
      return 'story';
    case '_meta':
      return rel === '_meta/components.json' ? 'component' : null;
    default:
      return null;
  }
}

function levelOfPath(rel: string): Level | null {
  const parts = rel.split('/');
  if (parts.length >= 3 && LEVEL_SET.has(parts[1] ?? '')) return parts[1] as Level;
  return null;
}

function seqOfPath(rel: string): number | null {
  const m = /-(?:s)?(\d{2,3})\.json$/.exec(rel);
  return m ? Number(m[1]) : null;
}

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadCorpus(root: string): LoadedFile[] {
  const files: LoadedFile[] = [];
  for (const abs of walk(root)) {
    const rel = toRel(root, abs);
    if (rel === 'manifest.json' || rel.startsWith('stations/')) continue;
    // Generated listening pools (design 08 §4, `ListeningPool`): not ContentFiles; V44 checks them in content:index.
    if (POOL_FILE_RE.test(rel)) continue;
    if (rel === '_meta/denylist.json' || rel === '_meta/redirects.json') continue;
    const text = readFileSync(abs, 'utf8');
    let json: Json | undefined;
    let parseError: string | undefined;
    try {
      json = JSON.parse(text) as Json;
    } catch (e) {
      parseError = (e as Error).message;
    }
    const items = isObject(json) && Array.isArray(json['items']) ? (json['items'] as Json[]).filter(isObject) : [];
    files.push({
      rel,
      abs,
      text,
      json,
      parseError,
      pathKind: kindOfPath(rel),
      pathLevel: levelOfPath(rel),
      seq: seqOfPath(rel),
      items,
      meta: rel.startsWith('_meta/'),
    });
  }
  return files;
}

function loadDenylist(root: string, override?: Denylist | string[]): Denylist | null {
  if (override) return Array.isArray(override) ? { terms: override, patterns: [] } : override;
  const p = join(root, '_meta', 'denylist.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Json;
    if (Array.isArray(raw)) return { terms: raw.filter((t): t is string => typeof t === 'string'), patterns: [] };
    if (isObject(raw)) {
      const terms: string[] = [];
      for (const key of ['terms', 'items', 'words', 'denied']) {
        const arr = raw[key];
        if (Array.isArray(arr)) for (const t of arr) if (typeof t === 'string') terms.push(t);
      }
      const patterns = Array.isArray(raw['patterns']) ? (raw['patterns'] as Json[]).filter((t): t is string => typeof t === 'string') : [];
      return { terms, patterns };
    }
  } catch {
    /* reported by caller */
  }
  return { terms: [], patterns: [] };
}

function loadBundles(root: string): Map<number, StationBundle> {
  const out = new Map<number, StationBundle>();
  const dir = join(root, 'stations');
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const m = /^(\d{2})\.json$/.exec(name);
    if (!m) continue;
    try {
      const b = JSON.parse(readFileSync(join(dir, name), 'utf8')) as StationBundle;
      if (b && b.schema === 'tsuzuku.station/1') out.set(Number(m[1]), b);
    } catch {
      /* V35 reports */
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small language helpers                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** The small kana that attach to the mora before them (mirrors `src/shared/jp.ts`; used by the V20 kana-glyph check). */
const SMALL_FOLLOWERS = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゎ', 'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ']);

/** V18 pitch bounds count morae with `src/shared/jp.ts` `moraCount` (small kana attach to the previous mora); re-exported for the tests. */
export { moraCount };

const HIRAGANA_RE = /^[ぁ-ゖ]+$/;
const KATAKANA_RE = /^[ァ-ヺ]+$/;
const ON_RE = /^[ァ-ヺー]+$/;
const KUN_RE = /^[ぁ-ゖー]+(\.[ぁ-ゖ]+)?$/;
const JAPANESE_CHAR_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿々〆ー]/;
const DIGIT_RE = /[0-9]/;
const LATIN_RE = /[A-Za-z]/;
const FULLWIDTH_RE = /[Ａ-Ｚａ-ｚ０-９]/;
const ACRONYM_RE = /^[A-Z]{1,4}$/;
const PUNCT_TOKEN_RE = /^[\p{P}\p{S}\s]+$/u;
const KANJI_NUMERAL_RE = /^[〇零一二三四五六七八九十百千万億兆]+$/;
const MISTAKE_RE = /^× .+ → ○ .+( \(.+\))?$/;
/** Characters whose NFKC form differs but which the guide explicitly allows in Japanese text. */
const NFKC_EXEMPT = new Set(['！', '？', '…', '　', '（', '）', '～', '‥']);

function rubyRe(): RegExp {
  return new RegExp(RUBY_RE.source, 'g');
}

/** Code-point length; 0 for anything that is not a string (shape errors are reported by V03). */
function chars(s: unknown): number {
  return typeof s === 'string' ? [...s].length : 0;
}

function wordCount(s: unknown): number {
  return typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

function levelOfJlpt(j: number): Exclude<Level, 'kana' | 'dan'> {
  return `n${j}` as Exclude<Level, 'kana' | 'dan'>;
}

function stationLevel(st: StationDef): Exclude<Level, 'dan'> {
  return st.jlpt === null ? 'kana' : levelOfJlpt(st.jlpt);
}

function stationOfId(stationId: string): StationDef | undefined {
  return STATIONS.find((s) => s.id === stationId);
}

function stationNumberOf(id: string): number | null {
  const m = /^[sm]-(\d{2})-\d$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Sentence-final particle / punctuation stripped before the V22 register test. */
function sentenceCore(plain: string): string {
  return plain.replace(/[。！？!?]+$/u, '').replace(/(よね|かな|か|ね|よ|わ)$/u, '');
}
const POLITE_END_RE = /(ます|ません|ました|ましょう|です|でした|でしょう|ください|ませんでした)$/u;
function isPolite(plain: string): boolean {
  return POLITE_END_RE.test(sentenceCore(plain));
}
function isSentence(plain: string): boolean {
  return /[。！？!?]$/u.test(plain);
}

/* V24 kana table: glyph → [id romaji segment, row, type]. */
type KanaRowName = KanaItem['row'];
type KanaTypeName = KanaItem['type'];
const HIRA_TABLE: [glyph: string, romaji: string, row: KanaRowName, type: KanaTypeName][] = [
  ['あ', 'a', 'a', 'basic'], ['い', 'i', 'a', 'basic'], ['う', 'u', 'a', 'basic'], ['え', 'e', 'a', 'basic'], ['お', 'o', 'a', 'basic'],
  ['か', 'ka', 'k', 'basic'], ['き', 'ki', 'k', 'basic'], ['く', 'ku', 'k', 'basic'], ['け', 'ke', 'k', 'basic'], ['こ', 'ko', 'k', 'basic'],
  ['さ', 'sa', 's', 'basic'], ['し', 'shi', 's', 'basic'], ['す', 'su', 's', 'basic'], ['せ', 'se', 's', 'basic'], ['そ', 'so', 's', 'basic'],
  ['た', 'ta', 't', 'basic'], ['ち', 'chi', 't', 'basic'], ['つ', 'tsu', 't', 'basic'], ['て', 'te', 't', 'basic'], ['と', 'to', 't', 'basic'],
  ['な', 'na', 'n', 'basic'], ['に', 'ni', 'n', 'basic'], ['ぬ', 'nu', 'n', 'basic'], ['ね', 'ne', 'n', 'basic'], ['の', 'no', 'n', 'basic'],
  ['は', 'ha', 'h', 'basic'], ['ひ', 'hi', 'h', 'basic'], ['ふ', 'fu', 'h', 'basic'], ['へ', 'he', 'h', 'basic'], ['ほ', 'ho', 'h', 'basic'],
  ['ま', 'ma', 'm', 'basic'], ['み', 'mi', 'm', 'basic'], ['む', 'mu', 'm', 'basic'], ['め', 'me', 'm', 'basic'], ['も', 'mo', 'm', 'basic'],
  ['や', 'ya', 'y', 'basic'], ['ゆ', 'yu', 'y', 'basic'], ['よ', 'yo', 'y', 'basic'],
  ['ら', 'ra', 'r', 'basic'], ['り', 'ri', 'r', 'basic'], ['る', 'ru', 'r', 'basic'], ['れ', 're', 'r', 'basic'], ['ろ', 'ro', 'r', 'basic'],
  ['わ', 'wa', 'w', 'basic'], ['を', 'wo', 'w', 'basic'], ['ん', 'n', 'nn', 'basic'],
  ['が', 'ga', 'g', 'dakuten'], ['ぎ', 'gi', 'g', 'dakuten'], ['ぐ', 'gu', 'g', 'dakuten'], ['げ', 'ge', 'g', 'dakuten'], ['ご', 'go', 'g', 'dakuten'],
  ['ざ', 'za', 'z', 'dakuten'], ['じ', 'ji', 'z', 'dakuten'], ['ず', 'zu', 'z', 'dakuten'], ['ぜ', 'ze', 'z', 'dakuten'], ['ぞ', 'zo', 'z', 'dakuten'],
  ['だ', 'da', 'd', 'dakuten'], ['ぢ', 'di', 'd', 'dakuten'], ['づ', 'du', 'd', 'dakuten'], ['で', 'de', 'd', 'dakuten'], ['ど', 'do', 'd', 'dakuten'],
  ['ば', 'ba', 'b', 'dakuten'], ['び', 'bi', 'b', 'dakuten'], ['ぶ', 'bu', 'b', 'dakuten'], ['べ', 'be', 'b', 'dakuten'], ['ぼ', 'bo', 'b', 'dakuten'],
  ['ぱ', 'pa', 'p', 'handakuten'], ['ぴ', 'pi', 'p', 'handakuten'], ['ぷ', 'pu', 'p', 'handakuten'], ['ぺ', 'pe', 'p', 'handakuten'], ['ぽ', 'po', 'p', 'handakuten'],
  ['きゃ', 'kya', 'k', 'yoon'], ['きゅ', 'kyu', 'k', 'yoon'], ['きょ', 'kyo', 'k', 'yoon'],
  ['しゃ', 'sha', 's', 'yoon'], ['しゅ', 'shu', 's', 'yoon'], ['しょ', 'sho', 's', 'yoon'],
  ['ちゃ', 'cha', 't', 'yoon'], ['ちゅ', 'chu', 't', 'yoon'], ['ちょ', 'cho', 't', 'yoon'],
  ['にゃ', 'nya', 'n', 'yoon'], ['にゅ', 'nyu', 'n', 'yoon'], ['にょ', 'nyo', 'n', 'yoon'],
  ['ひゃ', 'hya', 'h', 'yoon'], ['ひゅ', 'hyu', 'h', 'yoon'], ['ひょ', 'hyo', 'h', 'yoon'],
  ['みゃ', 'mya', 'm', 'yoon'], ['みゅ', 'myu', 'm', 'yoon'], ['みょ', 'myo', 'm', 'yoon'],
  ['りゃ', 'rya', 'r', 'yoon'], ['りゅ', 'ryu', 'r', 'yoon'], ['りょ', 'ryo', 'r', 'yoon'],
  ['ぎゃ', 'gya', 'g', 'yoon'], ['ぎゅ', 'gyu', 'g', 'yoon'], ['ぎょ', 'gyo', 'g', 'yoon'],
  ['じゃ', 'ja', 'z', 'yoon'], ['じゅ', 'ju', 'z', 'yoon'], ['じょ', 'jo', 'z', 'yoon'],
  ['びゃ', 'bya', 'b', 'yoon'], ['びゅ', 'byu', 'b', 'yoon'], ['びょ', 'byo', 'b', 'yoon'],
  ['ぴゃ', 'pya', 'p', 'yoon'], ['ぴゅ', 'pyu', 'p', 'yoon'], ['ぴょ', 'pyo', 'p', 'yoon'],
];
const KATA_EXT: [glyph: string, romaji: string][] = [
  ['ファ', 'fa'], ['フィ', 'fi'], ['フェ', 'fe'], ['フォ', 'fo'], ['フュ', 'fyu'], ['ヴァ', 'va'], ['ヴィ', 'vi'], ['ヴ', 'vu'], ['ヴェ', 've'], ['ヴォ', 'vo'],
  ['ヴュ', 'vyu'], ['シェ', 'she'], ['ジェ', 'je'], ['チェ', 'che'], ['ツァ', 'tsa'], ['ツィ', 'tsi'], ['ツェ', 'tse'], ['ツォ', 'tso'], ['ティ', 'thi'], ['ディ', 'dhi'],
  ['テュ', 'thu'], ['デュ', 'dhu'], ['トゥ', 'twu'], ['ドゥ', 'dwu'], ['ウィ', 'whi'], ['ウェ', 'whe'], ['ウォ', 'who'], ['イェ', 'ye'], ['クァ', 'kwa'], ['クォ', 'kwo'],
];
interface KanaSpec { romaji: string; row: KanaRowName; type: KanaTypeName; script: 'hiragana' | 'katakana' }
const KANA_SPECS: Map<string, KanaSpec> = (() => {
  const m = new Map<string, KanaSpec>();
  for (const [g, r, row, type] of HIRA_TABLE) {
    m.set(g, { romaji: r, row, type, script: 'hiragana' });
    const k = [...g].map((c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).join('');
    m.set(k, { romaji: r, row, type, script: 'katakana' });
  }
  for (const [g, r] of KATA_EXT) m.set(g, { romaji: r, row: 'ext', type: 'extended', script: 'katakana' });
  return m;
})();
export const KANA_INVENTORY = { hiragana: 104, katakana: 134 } as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Shape schema (V03)                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

type FieldType = 'string' | 'int' | 'number' | 'boolean' | 'string[]' | 'object' | 'object[]' | 'idlist';
interface FieldSpec {
  t: FieldType;
  req?: boolean;
  /** Minimum array length when present (0 = may be empty). */
  min?: number;
  shape?: Shape;
  /** Fixed array length. */
  len?: number;
}
type Shape = Record<string, FieldSpec>;

const SENTENCE: Shape = { ja: { t: 'string', req: true }, kana: { t: 'string', req: true }, en: { t: 'string', req: true } };
const WORD_EX: Shape = { word: { t: 'string', req: true }, kana: { t: 'string', req: true }, en: { t: 'string', req: true } };
const QUESTION: Shape = { q: { t: 'string', req: true }, choices: { t: 'string[]', req: true, len: 4 }, answer: { t: 'int', req: true }, kind: { t: 'string' }, lineRef: { t: 'int' } };
const OPTION: Shape = { text: { t: 'string', req: true }, kind: { t: 'string', req: true }, recast: { t: 'string' } };
const DEF_JA: Shape = { ja: { t: 'string', req: true }, kana: { t: 'string', req: true } };
const LINE: Shape = {
  speaker: { t: 'string' },
  ja: { t: 'string', req: true },
  kana: { t: 'string', req: true },
  en: { t: 'string', req: true },
  tokens: { t: 'string[]', req: true, min: 1 },
  tokenIds: { t: 'idlist' },
  plusOne: { t: 'string[]', min: 1 },
  aizuchiSlot: { t: 'boolean' },
  registerTarget: { t: 'string' },
  accept: { t: 'string[]', min: 1 },
  mustInclude: { t: 'string[]', min: 1 },
  options: { t: 'object[]', min: 1, shape: OPTION },
  emotion: { t: 'string' },
};
const SHAPES: Record<ContentKind, Shape> = {
  kana: {
    id: { t: 'string', req: true }, kana: { t: 'string', req: true }, romaji: { t: 'string', req: true }, script: { t: 'string', req: true },
    type: { t: 'string', req: true }, row: { t: 'string', req: true }, mnemonic: { t: 'string', req: true },
    exampleWord: { t: 'object', req: true, shape: WORD_EX }, lookalikes: { t: 'string[]', min: 1 }, station: { t: 'int' },
  },
  vocab: {
    id: { t: 'string', req: true }, word: { t: 'string', req: true }, kana: { t: 'string', req: true }, romaji: { t: 'string' },
    meanings: { t: 'string[]', req: true, min: 1 }, pos: { t: 'string', req: true }, jlpt: { t: 'int', req: true }, tags: { t: 'string[]', req: true, min: 0 },
    pitch: { t: 'int' }, pitchConfidence: { t: 'string' }, examples: { t: 'object[]', req: true, min: 1, shape: SENTENCE },
    definitionJa: { t: 'object', shape: DEF_JA }, frequencyRank: { t: 'int' }, notes: { t: 'string' }, kanjiIds: { t: 'string[]', min: 1 },
    altForms: { t: 'string[]', min: 1 }, collocations: { t: 'string[]', min: 1 }, trans: { t: 'string' }, pairId: { t: 'string' },
    confusables: { t: 'string[]', min: 1 }, station: { t: 'int' },
  },
  kanji: {
    id: { t: 'string', req: true }, char: { t: 'string', req: true }, meanings: { t: 'string[]', req: true, min: 1 }, on: { t: 'string[]', req: true, min: 0 },
    kun: { t: 'string[]', req: true, min: 0 }, strokes: { t: 'int', req: true }, jlpt: { t: 'int', req: true }, components: { t: 'string[]', req: true, min: 1 },
    mnemonic: { t: 'string', req: true }, examples: { t: 'object[]', req: true, min: 1, shape: WORD_EX }, radical: { t: 'string' },
    lookalikes: { t: 'string[]', min: 1 }, station: { t: 'int' },
  },
  grammar: {
    id: { t: 'string', req: true }, pattern: { t: 'string', req: true }, meaning: { t: 'string', req: true }, formation: { t: 'string[]', req: true, min: 1 },
    explanation: { t: 'string', req: true }, jlpt: { t: 'int', req: true }, register: { t: 'string', req: true },
    examples: { t: 'object[]', req: true, min: 1, shape: SENTENCE }, clozeHints: { t: 'string[]', req: true, min: 1 }, mistakes: { t: 'string[]', req: true, min: 0 },
    related: { t: 'string[]', req: true, min: 0 }, tags: { t: 'string[]', req: true, min: 0 }, notes: { t: 'string' }, unlocksForms: { t: 'string[]', min: 1 }, station: { t: 'int' },
  },
  story: {
    id: { t: 'string', req: true }, stationId: { t: 'string', req: true }, titleJa: { t: 'string', req: true }, titleEn: { t: 'string', req: true },
    kind: { t: 'string', req: true }, register: { t: 'string', req: true }, lines: { t: 'object[]', req: true, min: 1, shape: LINE },
    vocabIds: { t: 'string[]', req: true, min: 0 }, grammarIds: { t: 'string[]', req: true, min: 0 }, comprehension: { t: 'object[]', req: true, min: 1, shape: QUESTION },
    recapEn: { t: 'string', req: true }, names: { t: 'string[]', min: 1 }, bridge: { t: 'boolean' }, learnerSpeaker: { t: 'string' },
    genre: { t: 'string' }, audioFirst: { t: 'boolean' }, narrator: { t: 'string' },
  },
  conjugation: {
    id: { t: 'string', req: true }, word: { t: 'string', req: true }, kana: { t: 'string', req: true }, pos: { t: 'string', req: true }, form: { t: 'string', req: true },
    answer: { t: 'string', req: true }, answerKana: { t: 'string', req: true }, alt: { t: 'string[]', min: 1 },
  },
  component: {
    id: { t: 'string', req: true }, char: { t: 'string', req: true }, name: { t: 'string', req: true }, variants: { t: 'string[]', min: 1 }, hint: { t: 'string' },
  },
  michikusa: {
    id: { t: 'string', req: true }, stationId: { t: 'string', req: true }, kind: { t: 'string', req: true }, titleEn: { t: 'string', req: true },
    bodyEn: { t: 'string', req: true }, ja: { t: 'string' }, kana: { t: 'string' }, sourceNote: { t: 'string' },
  },
  station: {},
  // generated `listening/pool-NN.json`; never walked (POOL_FILE_RE), checked by content:index (V44)
  pool: {},
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Validator                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

interface Ctx {
  root: string;
  files: LoadedFile[];
  failures: Finding[];
  warnings: Finding[];
  strict: boolean;
  components: Map<string, ComponentDef> | null; // by name
  denylist: Denylist | null;
  bundles: Map<number, StationBundle>;
  // corpus indexes
  ids: Map<string, string>; // id -> file
  vocab: Map<string, VocabItem>;
  kanji: Map<string, KanjiItem>;
  grammar: Map<string, GrammarItem>;
  kana: Map<string, KanaItem>;
  stories: Map<string, StoryItem>;
  storyNames: Set<string>;
  /** `word\u0000kana` of every conjugation head word → the pos values the golden table gives it (V37 ground truth). */
  conjPos: Map<string, Set<string>>;
  linked: number;
  writeTokenIds: boolean;
  /** V42: cast names from cast.json, or null when the file is absent (check skipped). */
  cast: Set<string> | null;
  /** Path of the cast file as reported in V42 findings. */
  castFile: string;
  /** Speaker labels and narrators the texts use (V42 unused-entry warning). */
  castUsed: Set<string>;
  /** design 08 §5 "at release" switch for V43 counts and V46 (Stations 4–15). */
  listeningRelease: boolean;
}

function fail(ctx: Ctx, file: string, rule: string, message: string, id?: unknown): void {
  ctx.failures.push(typeof id === 'string' ? { file, id, rule, message } : { file, rule, message });
}
function warn(ctx: Ctx, file: string, rule: string, message: string, id?: unknown): void {
  ctx.warnings.push(typeof id === 'string' ? { file, id, rule, message } : { file, rule, message });
}
/** FAIL in strict mode (with bundles), WARN otherwise — for V20/V34/V35/V36. */
function soft(ctx: Ctx, file: string, rule: string, message: string, id?: string): void {
  if (ctx.strict && ctx.bundles.size > 0) fail(ctx, file, rule, message, id);
  else warn(ctx, file, rule, message, id);
}
/** FAIL with `--strict --listening-release`, WARN otherwise — one switch for the whole of V43 and for V46 at Stations 4–15 (design 08 §5 "F at release, W before"). */
function atRelease(ctx: Ctx): typeof fail {
  return ctx.strict && ctx.listeningRelease ? fail : warn;
}

export function validate(root: string, o: ValidateOptions = {}): ValidateResult {
  root = resolve(root);
  const files = loadCorpus(root);
  const bundles = loadBundles(root);
  const ctx: Ctx = {
    root,
    files,
    failures: [],
    warnings: [],
    strict: !!o.strict,
    components: null,
    denylist: loadDenylist(root, o.denylist),
    bundles,
    ids: new Map(),
    vocab: new Map(),
    kanji: new Map(),
    grammar: new Map(),
    kana: new Map(),
    stories: new Map(),
    storyNames: new Set(),
    conjPos: new Map(),
    linked: 0,
    writeTokenIds: (!!o.strict || !!o.fixTokenIds) && bundles.size > 0,
    cast: null,
    castFile: DEFAULT_CAST_FILE,
    castUsed: new Set(),
    listeningRelease: !!o.listeningRelease,
  };

  // Cast (V42, design 08 §6): names from cast.json; absent → one W, check skipped.
  loadCast(ctx, o.cast);

  // Components (V07/V17).
  const compList = o.components ?? (files.find((f) => f.rel === '_meta/components.json')?.items as unknown as ComponentDef[] | undefined);
  if (compList) {
    ctx.components = new Map();
    for (const c of compList) if (c && typeof c.name === 'string') ctx.components.set(c.name.toLowerCase(), c);
  } else {
    warn(ctx, '_meta/components.json', 'V07', 'components.json absent: kanji component-name checks (V07/V17) skipped');
  }
  if (!ctx.denylist) warn(ctx, '_meta/denylist.json', 'V30', 'denylist.json absent: denylist check skipped');

  // Pass 1: structure per file + corpus indexes.
  for (const f of files) checkEnvelope(ctx, f);
  checkPathSequences(ctx);
  for (const f of files) indexFile(ctx, f);
  // Pass 2: per-item rules.
  for (const f of files) {
    if (!f.pathKind || f.parseError) continue;
    for (const it of f.items) checkItem(ctx, f, it);
    checkFileLevelRules(ctx, f);
  }
  // Pass 3: corpus-wide rules.
  checkDedupe(ctx);
  checkKanaInventory(ctx);
  checkConjugationCoverage(ctx);
  checkFormUnlocks(ctx);
  checkStories(ctx);
  checkQuotas(ctx);
  checkManifest(ctx);
  checkDefinitions(ctx);
  checkListening(ctx);
  checkOwnStationExamples(ctx);

  // --only filter.
  let failures = ctx.failures;
  let warnings = ctx.warnings;
  if (o.only) {
    const pred = onlyMatcher(o.only, root);
    failures = failures.filter((x) => pred(x.file));
    warnings = warnings.filter((x) => pred(x.file));
  }
  const key = (x: Finding) => `${x.file}\u0000${x.rule}\u0000${x.id ?? ''}\u0000${x.message}`;
  failures = dedupeBy(failures, key);
  warnings = dedupeBy(warnings, key);
  failures.sort(compareFinding);
  warnings.sort(compareFinding);
  return { failures, warnings, linked: ctx.linked, files: files.length, bundles: bundles.size > 0 };
}

function dedupeBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function compareFinding(a: Finding, b: Finding): number {
  return a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || (a.id ?? '').localeCompare(b.id ?? '') || a.message.localeCompare(b.message);
}

function onlyMatcher(only: string, root: string): (rel: string) => boolean {
  const norm = only.split(sep).join('/');
  if (/[*?[]/.test(norm)) {
    const re = new RegExp(
      '^' +
        norm
          .replace(/[.+^${}()|\\]/g, '\\$&')
          .replace(/\*\*\//g, '\u0001')
          .replace(/\*\*/g, '\u0002')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')
          .replace(/\u0001/g, '(?:.*/)?')
          .replace(/\u0002/g, '.*') +
        '$',
    );
    return (rel) => re.test(rel) || re.test(`public/content/${rel}`);
  }
  const abs = resolve(norm);
  return (rel) => rel === norm || norm.endsWith(`/${rel}`) || resolve(root, rel) === abs || rel.startsWith(norm.replace(/^public\/content\//, '').replace(/\/$/, '') + '/');
}

/* ── V01 / V02 / V08 ─────────────────────────────────────────────────────── */

const PATH_RES: Record<Exclude<ContentKind, 'station' | 'pool'>, RegExp> = {
  kana: /^kana\/(hiragana|katakana)\.json$/,
  vocab: /^vocab\/(n[1-5])\/vocab-\1-(\d{3})\.json$/,
  kanji: /^kanji\/(n[1-5])\/kanji-\1-(\d{3})\.json$/,
  grammar: /^grammar\/(n[1-5])\/grammar-\1-(\d{3})\.json$/,
  // `stories-sNN.json` holds the station's texts, `listening-sNN.json` its audio-first pieces (design 08 §3, V43)
  story: /^stories\/(kana|n[1-5])\/(stories|listening)-s(0[1-9]|[1-4]\d|5[0-3])\.json$/,
  conjugation: /^conjugation\/conjugation-(\d{3})\.json$/,
  component: /^_meta\/components\.json$/,
  michikusa: /^michikusa\/michikusa-s(0[1-9]|[1-4]\d|5[0-3])\.json$/,
};

function checkEnvelope(ctx: Ctx, f: LoadedFile): void {
  const file = f.rel;
  if (f.parseError) {
    fail(ctx, file, 'V01', `invalid JSON: ${f.parseError}`);
    return;
  }
  // V08 path grammar
  if (!f.pathKind) {
    fail(ctx, file, 'V08', 'path does not match any content directory (§1 table)');
    return;
  }
  const pre = PATH_RES[f.pathKind as Exclude<ContentKind, 'station' | 'pool'>];
  if (!pre.test(file)) {
    fail(ctx, file, 'V08', `file name does not match the ${f.pathKind} path grammar`);
  } else if (f.pathKind === 'story' || f.pathKind === 'michikusa') {
    const n = f.seq ?? 0;
    const st = STATIONS[n - 1];
    if (!st) fail(ctx, file, 'V08', `station ${n} does not exist`);
    else if (f.pathKind === 'story' && f.pathLevel !== stationLevel(st)) fail(ctx, file, 'V08', `stories for Station ${n} belong under stories/${stationLevel(st)}/`);
  }
  // V01 envelope
  const j = f.json;
  if (!isObject(j)) {
    fail(ctx, file, 'V01', 'top level must be an object');
    return;
  }
  if (j['schema'] !== 'tsuzuku.content/1') fail(ctx, file, 'V01', `schema must be "tsuzuku.content/1" (got ${JSON.stringify(j['schema'])})`);
  if (j['type'] !== f.pathKind) fail(ctx, file, 'V01', `type must be "${f.pathKind}" for this directory (got ${JSON.stringify(j['type'])})`);
  if (!Array.isArray(j['items'])) fail(ctx, file, 'V01', 'items must be an array');
  if (f.pathLevel) {
    if (j['level'] !== f.pathLevel) fail(ctx, file, 'V01', `level must be "${f.pathLevel}" (path level)`);
  } else if ('level' in j) {
    fail(ctx, file, 'V01', 'level must be omitted when the path has no level segment');
  }
  for (const k of Object.keys(j)) {
    if (!['schema', 'type', 'level', 'writer', 'generatedAt', 'items'].includes(k)) fail(ctx, file, 'V01', `unknown envelope key "${k}"`);
  }
  if (typeof j['writer'] !== 'undefined' && typeof j['writer'] !== 'string') fail(ctx, file, 'V01', 'writer must be a string');
  if (typeof j['generatedAt'] !== 'undefined' && typeof j['generatedAt'] !== 'string') fail(ctx, file, 'V01', 'generatedAt must be an ISO string');
  // V02
  if (Array.isArray(j['items'])) {
    const n = (j['items'] as Json[]).length;
    if (n < 1) fail(ctx, file, 'V02', 'items is empty');
    if (!f.meta && n > MAX_ITEMS_PER_FILE) fail(ctx, file, 'V02', `${n} items > ${MAX_ITEMS_PER_FILE}`);
    (j['items'] as Json[]).forEach((it, i) => {
      if (!isObject(it)) fail(ctx, file, 'V03', `items[${i}] is not an object`);
    });
  }
}

function checkPathSequences(ctx: Ctx): void {
  const groups = new Map<string, LoadedFile[]>();
  for (const f of ctx.files) {
    if (!f.pathKind || f.seq === null) continue;
    if (f.pathKind === 'story' || f.pathKind === 'michikusa') continue;
    const key = `${f.pathKind}/${f.pathLevel ?? ''}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    let expect = 1;
    for (const f of arr) {
      if ((f.seq ?? 0) !== expect) {
        fail(ctx, f.rel, 'V08', `file sequence gap: expected ${String(expect).padStart(3, '0')}, found ${String(f.seq).padStart(3, '0')}`);
        expect = (f.seq ?? 0) + 1;
      } else expect++;
    }
  }
}

/* ── indexes (V05 uniqueness) ────────────────────────────────────────────── */

function indexFile(ctx: Ctx, f: LoadedFile): void {
  if (!f.pathKind || f.parseError) return;
  for (const it of f.items) {
    const id = it['id'];
    if (typeof id !== 'string') continue;
    const prev = ctx.ids.get(id);
    if (prev !== undefined) fail(ctx, f.rel, 'V05', `duplicate id (also in ${prev})`, id);
    else ctx.ids.set(id, f.rel);
    switch (f.pathKind) {
      case 'vocab':
        ctx.vocab.set(id, it as unknown as VocabItem);
        break;
      case 'kanji':
        ctx.kanji.set(id, it as unknown as KanjiItem);
        break;
      case 'grammar':
        ctx.grammar.set(id, it as unknown as GrammarItem);
        break;
      case 'kana':
        ctx.kana.set(id, it as unknown as KanaItem);
        break;
      case 'story': {
        const s = it as unknown as StoryItem;
        ctx.stories.set(id, s);
        if (Array.isArray(s.names)) for (const n of s.names) if (typeof n === 'string') ctx.storyNames.add(n);
        break;
      }
      case 'conjugation': {
        const c = it as unknown as ConjugationGoldenEntry;
        if (typeof c.word === 'string' && typeof c.kana === 'string' && typeof c.pos === 'string') {
          const key = `${c.word}\u0000${c.kana}`;
          const set = ctx.conjPos.get(key) ?? new Set<string>();
          set.add(c.pos);
          ctx.conjPos.set(key, set);
        }
        break;
      }
      default:
        break;
    }
  }
}

/* ── V03 shape + deep string hygiene (V31) ───────────────────────────────── */

function checkShape(ctx: Ctx, file: string, id: string | undefined, obj: JsonObject, shape: Shape, path: string): void {
  for (const [k, spec] of Object.entries(shape)) {
    const v = obj[k];
    const label = path ? `${path}.${k}` : k;
    if (v === undefined) {
      if (spec.req) fail(ctx, file, 'V03', `missing required field ${label}`, id);
      continue;
    }
    if (v === null) {
      fail(ctx, file, 'V03', `${label} is null (omit optional fields)`, id);
      continue;
    }
    switch (spec.t) {
      case 'string':
        if (typeof v !== 'string') fail(ctx, file, 'V03', `${label} must be a string`, id);
        break;
      case 'boolean':
        if (typeof v !== 'boolean') fail(ctx, file, 'V03', `${label} must be a boolean`, id);
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) fail(ctx, file, 'V03', `${label} must be a number`, id);
        break;
      case 'int':
        if (typeof v !== 'number' || !Number.isInteger(v)) fail(ctx, file, 'V03', `${label} must be an integer`, id);
        break;
      case 'string[]':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) fail(ctx, file, 'V03', `${label} must be an array of strings`, id);
        else {
          if (spec.len !== undefined && v.length !== spec.len) fail(ctx, file, 'V03', `${label} must have exactly ${spec.len} entries`, id);
          if (spec.min !== undefined && spec.min > 0 && v.length < spec.min) fail(ctx, file, 'V03', `${label} must have at least ${spec.min} entry`, id);
        }
        break;
      case 'idlist':
        if (!Array.isArray(v) || v.some((x) => x !== null && typeof x !== 'string')) fail(ctx, file, 'V03', `${label} must be an array of string|null`, id);
        break;
      case 'object':
        if (!isObject(v)) fail(ctx, file, 'V03', `${label} must be an object`, id);
        else if (spec.shape) checkShape(ctx, file, id, v, spec.shape, label);
        break;
      case 'object[]':
        if (!Array.isArray(v)) fail(ctx, file, 'V03', `${label} must be an array`, id);
        else {
          if (spec.min !== undefined && spec.min > 0 && v.length < spec.min) fail(ctx, file, 'V03', `${label} must have at least ${spec.min} entry`, id);
          v.forEach((x, i) => {
            if (!isObject(x)) fail(ctx, file, 'V03', `${label}[${i}] must be an object`, id);
            else if (spec.shape) checkShape(ctx, file, id, x, spec.shape, `${label}[${i}]`);
          });
        }
        break;
    }
  }
  for (const k of Object.keys(obj)) {
    if (!(k in shape)) fail(ctx, file, 'V03', `unknown key ${path ? `${path}.` : ''}${k}`, id);
  }
}

/** Deep walk: no null (except tokenIds entries), no empty strings; V31 NFKC/trim/full-width; V30 denylist. */
function checkStrings(ctx: Ctx, file: string, id: string | undefined, v: Json, path: string): void {
  if (v === null) {
    if (!/tokenIds\[\d+\]$/.test(path)) fail(ctx, file, 'V03', `${path} is null`, id);
    return;
  }
  if (typeof v === 'string') {
    if (v.length === 0) fail(ctx, file, 'V03', `${path} is an empty string`, id);
    if (v !== v.trim()) fail(ctx, file, 'V31', `${path} has leading/trailing whitespace`, id);
    if (FULLWIDTH_RE.test(v)) fail(ctx, file, 'V31', `${path} contains full-width Latin or digits`, id);
    if (v.normalize('NFC') !== v) fail(ctx, file, 'V31', `${path} is not NFC/NFKC-normalized (decomposed characters)`, id);
    else {
      for (const ch of v) {
        if (NFKC_EXEMPT.has(ch)) continue;
        if (ch.normalize('NFKC') !== ch) {
          fail(ctx, file, 'V31', `${path} is not NFKC-normalized ("${ch}" → "${ch.normalize('NFKC')}")`, id);
          break;
        }
      }
    }
    checkDenylist(ctx, file, id, v, path);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => checkStrings(ctx, file, id, x, `${path}[${i}]`));
    return;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) checkStrings(ctx, file, id, x, path ? `${path}.${k}` : k);
  }
}

/** A denylist compiled for V30 (see `compileDenylist`). */
export interface CompiledDenylist {
  /** Printable-ASCII terms, in chunks: `(?:^|[^A-Za-z])(t1|t2|…)(?=[^A-Za-z]|$)`, case-insensitive, longest first. */
  latin: RegExp[];
  /** lower-cased Latin term → the term as the denylist spells it. */
  latinTerms: Map<string, string>;
  /** Every other term, bucketed by first UTF-16 code unit, longest first; matched as a case-sensitive substring. */
  other: Map<string, string[]>;
  patterns: RegExp[];
  /** Patterns that failed to compile. */
  invalidPatterns: string[];
  /** True when every Latin term contains a letter, so a string without Latin letters can skip the Latin regexes. */
  latinNeedsLetter: boolean;
}

/** What V30 found in a string: the offending term as the denylist spells it, or the pattern source. */
export interface DenyHit {
  kind: 'term' | 'pattern';
  value: string;
}

const LATIN_TERM_RE = /^[\x20-\x7e]+$/;
/** Terms per alternation regex; ≈ 8 regexes for the 1,900 Latin terms of the real denylist. */
const LATIN_CHUNK = 250;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a denylist once. Semantics are those of the original one-regex-per-term
 * matcher: a printable-ASCII term matches case-insensitively when not adjoined by a
 * Latin letter on either side (`(^|[^A-Za-z])term([^A-Za-z]|$)`); any other term matches
 * as a case-sensitive substring; patterns are `iu` regexes.
 */
export function compileDenylist(d: Denylist): CompiledDenylist {
  const c: CompiledDenylist = { latin: [], latinTerms: new Map(), other: new Map(), patterns: [], invalidPatterns: [], latinNeedsLetter: true };
  const latin: string[] = [];
  for (const t of d.terms) {
    if (!t) continue;
    if (LATIN_TERM_RE.test(t)) {
      const key = t.toLowerCase();
      if (c.latinTerms.has(key)) continue;
      c.latinTerms.set(key, t);
      latin.push(t);
      if (!LATIN_RE.test(t)) c.latinNeedsLetter = false;
    } else {
      const bucket = c.other.get(t.charAt(0)) ?? [];
      if (!bucket.includes(t)) bucket.push(t);
      c.other.set(t.charAt(0), bucket);
    }
  }
  latin.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < latin.length; i += LATIN_CHUNK) {
    const alt = latin
      .slice(i, i + LATIN_CHUNK)
      .map(escapeRe)
      .join('|');
    c.latin.push(new RegExp(`(?:^|[^A-Za-z])(${alt})(?=[^A-Za-z]|$)`, 'i'));
  }
  for (const bucket of c.other.values()) bucket.sort((a, b) => b.length - a.length);
  for (const p of d.patterns) {
    try {
      c.patterns.push(new RegExp(p, 'iu'));
    } catch {
      c.invalidPatterns.push(p);
    }
  }
  return c;
}

/** First denylist hit in `s` (Latin terms, then other terms, then patterns), or null. */
export function findDenylisted(c: CompiledDenylist, s: string): DenyHit | null {
  if (c.latin.length > 0 && (!c.latinNeedsLetter || LATIN_RE.test(s))) {
    for (const re of c.latin) {
      const m = re.exec(s);
      if (m) return { kind: 'term', value: c.latinTerms.get((m[1] as string).toLowerCase()) ?? (m[1] as string) };
    }
  }
  if (c.other.size > 0) {
    for (let i = 0; i < s.length; i++) {
      const bucket = c.other.get(s.charAt(i));
      if (!bucket) continue;
      for (const t of bucket) if (s.startsWith(t, i)) return { kind: 'term', value: t };
    }
  }
  for (const re of c.patterns) if (re.test(s)) return { kind: 'pattern', value: re.source };
  return null;
}

const denyCache = new WeakMap<Denylist, CompiledDenylist>();
function checkDenylist(ctx: Ctx, file: string, id: string | undefined, s: string, path: string): void {
  const d = ctx.denylist;
  if (!d) return;
  let c = denyCache.get(d);
  if (!c) {
    c = compileDenylist(d);
    for (const p of c.invalidPatterns) warn(ctx, '_meta/denylist.json', 'V30', `invalid pattern ${JSON.stringify(p)}`);
    denyCache.set(d, c);
  }
  const hit = findDenylisted(c, s);
  if (!hit) return;
  if (hit.kind === 'term') fail(ctx, file, 'V30', `${path} contains denylisted term "${hit.value}"`, id);
  else fail(ctx, file, 'V30', `${path} matches denylist pattern /${hit.value}/`, id);
}

/* ── ruby-field checks (V11 / V12 / V13 / V31) ───────────────────────────── */

/** V11 well-formed + V12 no bare kanji + V31 Latin/digits, for one `ja`-like field. Returns true when well-formed. */
function checkJa(ctx: Ctx, file: string, id: string | undefined, ja: string, path: string, rule = ''): boolean {
  let ok = true;
  const re = rubyRe();
  let rest = '';
  let last = 0;
  for (const m of ja.matchAll(re)) {
    const idx = m.index ?? 0;
    rest += ja.slice(last, idx);
    last = idx + m[0].length;
    const base = m[1] as string;
    const reading = m[2] as string;
    if (!(hasKanji(base) || ACRONYM_RE.test(base))) {
      fail(ctx, file, rule || 'V11', `${path}: ruby base "${base}" has no kanji (or is not an uppercase acronym ≤ 4 letters)`, id);
      ok = false;
    }
    if (!KANA_WORD_RE.test(reading)) {
      fail(ctx, file, rule || 'V11', `${path}: ruby reading "${reading}" is not kana-only`, id);
      ok = false;
    }
    if (LATIN_RE.test(base) && !ACRONYM_RE.test(base)) fail(ctx, file, 'V31', `${path}: Latin letters in ruby base "${base}" (only uppercase acronyms ≤ 4 letters)`, id);
  }
  rest += ja.slice(last);
  if (/[{}|]/.test(rest)) {
    fail(ctx, file, rule || 'V11', `${path}: stray "{", "}" or "|" outside a well-formed ruby`, id);
    ok = false;
  }
  if (KANJI_RE.test(rest)) fail(ctx, file, rule || 'V12', `${path}: bare kanji "${rest.match(KANJI_RE)?.[0]}" outside ruby`, id);
  if (LATIN_RE.test(rest)) fail(ctx, file, 'V31', `${path}: Latin letters outside ruby`, id);
  if (DIGIT_RE.test(ja)) fail(ctx, file, 'V31', `${path}: ASCII digits (write numbers in kanji with ruby or in kana)`, id);
  return ok;
}

/** V13 reconstruction + V10 for a (ja, kana) pair. */
function checkJaKana(ctx: Ctx, file: string, id: string | undefined, ja: string, kana: string, path: string, sentence: boolean): void {
  const re = sentence ? KANA_SENTENCE_RE : KANA_WORD_RE;
  if (!re.test(kana)) fail(ctx, file, 'V10', `${path}.kana is not kana-only: "${kana}"`, id);
  if (DIGIT_RE.test(kana)) fail(ctx, file, 'V31', `${path}.kana contains ASCII digits`, id);
  const rk = toKana(ja);
  if (rk !== kana) fail(ctx, file, 'V13', `${path}: readings reconstruct to "${rk}" but kana is "${kana}"`, id);
}

function checkPlainField(ctx: Ctx, file: string, id: string | undefined, s: string, path: string, digits = true): void {
  if (/[{}|]/.test(s)) fail(ctx, file, 'V12', `${path} must be plain (no ruby markup): "${s}"`, id);
  if (digits && DIGIT_RE.test(s)) fail(ctx, file, 'V31', `${path} contains ASCII digits`, id);
}

/* ── per item ────────────────────────────────────────────────────────────── */

function checkItem(ctx: Ctx, f: LoadedFile, it: JsonObject): void {
  const kind = f.pathKind as ContentKind;
  const file = f.rel;
  const id = typeof it['id'] === 'string' ? (it['id'] as string) : undefined;
  checkShape(ctx, file, id, it, SHAPES[kind], '');
  checkStrings(ctx, file, id, it, '');
  if (id === undefined) return;
  // V04
  if (!ID_PATTERNS[kind].test(id)) fail(ctx, file, 'V04', `id does not match the ${kind} id grammar`, id);
  switch (kind) {
    case 'kana':
      return checkKana(ctx, f, it as unknown as KanaItem);
    case 'vocab':
      return checkVocab(ctx, f, it as unknown as VocabItem);
    case 'kanji':
      return checkKanji(ctx, f, it as unknown as KanjiItem);
    case 'grammar':
      return checkGrammar(ctx, f, it as unknown as GrammarItem);
    case 'story':
      return checkStoryItem(ctx, f, it as unknown as StoryItem);
    case 'conjugation':
      return checkConjugation(ctx, f, it as unknown as ConjugationGoldenEntry);
    case 'component':
      return checkComponent(ctx, f, it as unknown as ComponentDef);
    case 'michikusa':
      return checkMichikusa(ctx, f, it as unknown as MichikusaItem);
    default:
      return;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
/** A surface without its affix/counter marker: `〜泊` → `泊`, `不〜` → `不` (what V16, V20 and V36 compare against). */
function bare(s: string): string {
  return s.replace(/^〜/, '').replace(/〜$/, '');
}

function checkSentenceExamples(ctx: Ctx, file: string, id: string, examples: unknown, level: Exclude<Level, 'kana' | 'dan'> | null, path: string): string[] {
  const plains: string[] = [];
  if (!Array.isArray(examples)) return plains;
  examples.forEach((ex, i) => {
    if (!isObject(ex)) return;
    const ja = str(ex['ja']);
    const kana = str(ex['kana']);
    const en = str(ex['en']);
    const p = `${path}[${i}]`;
    if (ja !== undefined) {
      checkJa(ctx, file, id, ja, `${p}.ja`);
      if (kana !== undefined) checkJaKana(ctx, file, id, ja, kana, p, true);
      const plain = toPlain(ja);
      plains.push(plain);
      if (level) {
        const cap = SENTENCE_MAX_CHARS[level];
        if (chars(plain) > cap) fail(ctx, file, 'V15', `${p}.ja is ${chars(plain)} chars > ${cap} (${level.toUpperCase()} cap)`, id);
      }
    }
    if (en !== undefined && !/[.?!]["”’']?$/.test(en)) warn(ctx, file, 'V33', `${p}.en should end with . ? or !`, id);
  });
  return plains;
}

/**
 * V33 proper-noun allowlist: a gloss may start uppercase when its first word is one of
 * these (weekday and month names, nationality/language adjectives, festival and
 * religion names, place names, titles) or an all-caps acronym of 2–4 letters (TV, UN).
 * Matched on the first word, so "Japanese-style room", "New Year's Eve" and
 * "Buddhist temple" all pass; everything else still warns.
 */
const PROPER_NOUN_STARTS: readonly string[] = [
  // weekdays and months
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  // nationality / language / culture adjectives and nouns
  'Japanese', 'English', 'Western', 'Eastern', 'Chinese', 'Korean', 'American', 'European', 'Asian', 'African', 'British', 'French', 'German',
  'Italian', 'Spanish', 'Portuguese', 'Dutch', 'Russian', 'Indian', 'Thai', 'Vietnamese', 'Arabic', 'Latin', 'Greek', 'Roman', 'Indo', 'Sino', 'United',
  // festivals, holidays and observances
  'Obon', 'Bon', 'Tanabata', 'Setsubun', 'Hinamatsuri', 'Shichi', 'Tango', 'Hanami', 'Golden', 'New', 'Christmas', 'Halloween', 'Valentine',
  'Girls', 'Boys', 'Doll', 'Star', 'Coming',
  // religion, philosophy and deities
  'Buddhist', 'Buddhism', 'Buddha', 'Shinto', 'Zen', 'Taoism', 'Taoist', 'Confucianism', 'Confucian', 'Christian', 'Christianity', 'Islam', 'Islamic',
  'Hindu', 'Hinduism', 'Jizo', 'Kannon', 'Amida', 'Nio', 'Fudo', 'Inari', 'Amaterasu', 'Daruma', 'Ebisu', 'Daikoku', 'Benten', 'Bishamon',
  // places and eras
  'Europe', 'China', 'America', 'Japan', 'Asia', 'Africa', 'Korea', 'India', 'Russia', 'Britain', 'England', 'France', 'Germany', 'Italy', 'Spain',
  'Australia', 'Canada', 'Brazil', 'Mexico', 'Tokyo', 'Kyoto', 'Osaka', 'Edo', 'Nara', 'Hokkaido', 'Okinawa', 'Kanto', 'Kansai', 'Kyushu', 'Shikoku',
  'Honshu', 'Fuji', 'Mt.', 'Mount', 'Pacific', 'Atlantic', 'Tokaido', 'Tōkaidō', 'Nakasendo', 'Meiji', 'Heian', 'Showa', 'Shōwa', 'Taisho', 'Taishō',
  'Heisei', 'Reiwa', 'Renaissance', 'Middle', 'Earth', 'Mars', 'Venus', 'Jupiter', 'Saturn', 'Mercury', 'Diet', 'Olympics', 'Olympic', 'Nobel',
  // titles
  'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.',
];
const PROPER_NOUN_START_RE = new RegExp(`^(?:${PROPER_NOUN_STARTS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|[A-Z]{2,4})(?=$|[\\s,;:(/'’-])`);

function startsWithProperNoun(g: string): boolean {
  return PROPER_NOUN_START_RE.test(g);
}

function checkGloss(ctx: Ctx, file: string, id: string, g: string, path: string, opts: { verb?: boolean; properNoun?: boolean; kanji?: boolean; anyCase?: boolean }): void {
  if (chars(g) > 40) fail(ctx, file, 'V15', `${path} gloss is ${chars(g)} chars > 40`, id);
  if (/\.$/.test(g)) warn(ctx, file, 'V33', `${path} gloss ends with a period`, id);
  if (g.includes('/')) warn(ctx, file, 'V33', `${path} gloss contains "/" (split into separate glosses)`, id);
  if (!opts.properNoun && !opts.anyCase && /^[A-Z]/.test(g) && g !== 'I' && !/^I['’ ]/.test(g) && !startsWithProperNoun(g)) warn(ctx, file, 'V33', `${path} gloss starts uppercase: "${g}"`, id);
  if (opts.verb && !/^to /.test(g) && !/^\(/.test(g)) warn(ctx, file, 'V33', `${path} verb gloss should begin with "to ": "${g}"`, id);
  if (opts.kanji && /^to /.test(g)) warn(ctx, file, 'V33', `${path} kanji keyword should not begin with "to ": "${g}"`, id);
}

/* V24 / V10 / V14 / V15 / V16 — kana */
function checkKana(ctx: Ctx, f: LoadedFile, k: KanaItem): void {
  const file = f.rel;
  const id = k.id;
  const glyph = str(k.kana);
  if (glyph === undefined) return;
  const spec = KANA_SPECS.get(glyph);
  const fileScript = f.rel.endsWith('hiragana.json') ? 'hiragana' : 'katakana';
  if (k.script !== 'hiragana' && k.script !== 'katakana') fail(ctx, file, 'V07', `script must be hiragana|katakana`, id);
  else if (k.script !== fileScript) fail(ctx, file, 'V24', `script "${k.script}" in ${fileScript}.json`, id);
  if (!['basic', 'dakuten', 'handakuten', 'yoon', 'extended'].includes(String(k.type))) fail(ctx, file, 'V07', `type "${String(k.type)}" is not a KanaType`, id);
  if (!['a', 'k', 'g', 's', 'z', 't', 'd', 'n', 'h', 'b', 'p', 'm', 'y', 'r', 'w', 'nn', 'ext'].includes(String(k.row))) fail(ctx, file, 'V07', `row "${String(k.row)}" is not a KanaRow`, id);
  if (!KANA_WORD_RE.test(glyph)) fail(ctx, file, 'V10', `kana glyph "${glyph}" is not kana`, id);
  // glyph block vs script
  if (k.script === 'hiragana' && !HIRAGANA_RE.test(glyph)) fail(ctx, file, 'V24', `glyph "${glyph}" is not hiragana`, id);
  if (k.script === 'katakana' && !KATAKANA_RE.test(glyph)) fail(ctx, file, 'V24', `glyph "${glyph}" is not katakana`, id);
  if (typeof k.romaji === 'string' && !/^[a-z]+$/.test(k.romaji)) fail(ctx, file, 'V24', `romaji "${k.romaji}" must be lowercase ASCII`, id);
  if (!spec) {
    fail(ctx, file, 'V24', `glyph "${glyph}" is not in the kana inventory (§3)`, id);
  } else {
    const expectedId = `k-${spec.script === 'hiragana' ? 'h' : 'k'}-${spec.romaji}`;
    if (id !== expectedId) fail(ctx, file, 'V24', `id should be "${expectedId}" for ${glyph}`, id);
    if (k.row !== spec.row) fail(ctx, file, 'V24', `row should be "${spec.row}" for ${glyph}`, id);
    if (k.type !== spec.type) fail(ctx, file, 'V24', `type should be "${spec.type}" for ${glyph}`, id);
  }
  // extended ⇔ ext
  if ((k.type === 'extended') !== (k.row === 'ext')) fail(ctx, file, 'V24', `type "extended" ⇔ row "ext"`, id);
  if (typeof k.mnemonic === 'string' && chars(k.mnemonic) > 160) fail(ctx, file, 'V15', `mnemonic is ${chars(k.mnemonic)} chars > 160`, id);
  if (isObject(k.exampleWord as unknown as Json)) {
    const ex = k.exampleWord;
    if (typeof ex.word === 'string') checkPlainField(ctx, file, id, ex.word, 'exampleWord.word');
    if (typeof ex.kana === 'string' && !KANA_WORD_RE.test(ex.kana)) fail(ctx, file, 'V10', `exampleWord.kana "${ex.kana}" is not kana-only`, id);
    if (typeof ex.word === 'string' && typeof ex.kana === 'string' && !ex.word.includes(glyph) && !ex.kana.includes(glyph)) {
      fail(ctx, file, 'V16', `exampleWord "${ex.word}" does not contain ${glyph}`, id);
    }
    if (typeof ex.en === 'string') checkGloss(ctx, file, id, ex.en, 'exampleWord.en', { anyCase: true });
  }
  for (const l of strs(k.lookalikes)) if (!ctx.kana.has(l)) fail(ctx, file, 'V06', `lookalike "${l}" does not resolve to a kana id`, id);
}

/* vocab */
function checkVocab(ctx: Ctx, f: LoadedFile, v: VocabItem): void {
  const file = f.rel;
  const id = v.id;
  const word = str(v.word);
  const kana = str(v.kana);
  // V05 level consistency
  const m = /^v-n([1-5])-\d{4}$/.exec(id);
  if (m) {
    if (Number(m[1]) !== v.jlpt) fail(ctx, file, 'V05', `id level n${m[1]} ≠ jlpt ${String(v.jlpt)}`, id);
    if (f.pathLevel && `n${m[1]}` !== f.pathLevel) fail(ctx, file, 'V05', `id level n${m[1]} ≠ path level ${f.pathLevel}`, id);
  }
  // V07 enums
  if (!(POS_VALUES as readonly string[]).includes(String(v.pos))) fail(ctx, file, 'V07', `pos "${String(v.pos)}" is not a Pos`, id);
  if (![1, 2, 3, 4, 5].includes(v.jlpt as number)) fail(ctx, file, 'V07', `jlpt must be 1–5`, id);
  if (v.pitchConfidence !== undefined && v.pitchConfidence !== 'high' && v.pitchConfidence !== 'low') fail(ctx, file, 'V07', `pitchConfidence must be high|low`, id);
  if (v.trans !== undefined && v.trans !== 'vt' && v.trans !== 'vi') fail(ctx, file, 'V07', `trans must be vt|vi`, id);
  const tags = strs(v.tags);
  for (const t of tags) {
    if (t === 'neutral') fail(ctx, file, 'V07', `tag "neutral" is never written (it is the default)`, id);
    else if (!(DOMAIN_TAGS as readonly string[]).includes(t) && !(REGISTER_TAGS as readonly string[]).includes(t) && !(MISC_TAGS as readonly string[]).includes(t)) {
      fail(ctx, file, 'V07', `tag "${t}" is not a domain, register or misc tag`, id);
    }
  }
  // V14 counts
  const meanings = strs(v.meanings);
  if (meanings.length < 1 || meanings.length > 4) fail(ctx, file, 'V14', `meanings must have 1–4 entries (${meanings.length})`, id);
  if (tags.length < 1 || tags.length > 6) fail(ctx, file, 'V14', `tags must have 1–6 entries (${tags.length})`, id);
  const examples = Array.isArray(v.examples) ? v.examples : [];
  if (examples.length < 1) fail(ctx, file, 'V14', `examples must have ≥ 1 entry`, id);
  else if (ctx.strict && examples.length < 2) warn(ctx, file, 'V14', `examples has ${examples.length} entry (release requires ≥ 2, Pass 3 vocab-examples-2)`, id);
  // V10 / V12 / V31 plain fields
  if (word !== undefined) checkPlainField(ctx, file, id, word, 'word');
  if (kana !== undefined) {
    if (!KANA_WORD_RE.test(kana)) fail(ctx, file, 'V10', `kana "${kana}" is not kana-only`, id);
    if (DIGIT_RE.test(kana)) fail(ctx, file, 'V31', `kana contains ASCII digits`, id);
  }
  for (const [i, a] of strs(v.altForms).entries()) checkPlainField(ctx, file, id, a, `altForms[${i}]`);
  for (const [i, c] of strs(v.collocations).entries()) checkPlainField(ctx, file, id, c, `collocations[${i}]`);
  // V15
  if (v.notes !== undefined && chars(v.notes) > 200) fail(ctx, file, 'V15', `notes is ${chars(v.notes)} chars > 200`, id);
  const isVerb = v.pos === 'v1' || v.pos === 'v5' || v.pos === 'v-irr';
  for (const [i, g] of meanings.entries()) checkGloss(ctx, file, id, g, `meanings[${i}]`, { verb: isVerb, properNoun: tags.includes('proper-noun') });
  // examples: V11–V13, V15, V33
  const level = typeof v.jlpt === 'number' && v.jlpt >= 1 && v.jlpt <= 5 ? levelOfJlpt(v.jlpt) : f.pathLevel && f.pathLevel !== 'kana' && f.pathLevel !== 'dan' ? f.pathLevel : null;
  const plains = checkSentenceExamples(ctx, file, id, examples, level, 'examples');
  // V16 target presence
  if (word !== undefined && kana !== undefined) {
    const targets = vocabSurfaces(v);
    plains.forEach((plain, i) => {
      if (!targets.some((t) => t.length > 0 && plain.includes(t))) fail(ctx, file, 'V16', `examples[${i}] does not contain "${word}" (or an altForm / kana / stem)`, id);
    });
    if (tags.includes('casual') || tags.includes('slang')) {
      plains.forEach((plain, i) => {
        if (isSentence(plain) && isPolite(plain)) warn(ctx, file, 'V22', `examples[${i}] is polite but the word is tagged casual/slang`, id);
      });
    }
  }
  // V37 pos vs verb ending (W, informational)
  if (word !== undefined && kana !== undefined && (v.pos === 'v1' || v.pos === 'v5')) checkVerbPos(ctx, file, id, v.pos, word, kana);
  // V18 numeric sanity
  if (v.pitch !== undefined) {
    if (kana !== undefined && (!Number.isInteger(v.pitch) || v.pitch < 0 || v.pitch > moraCount(kana))) fail(ctx, file, 'V18', `pitch ${String(v.pitch)} outside [0, ${moraCount(kana)}] for "${kana}"`, id);
    if (v.pitchConfidence === undefined) fail(ctx, file, 'V18', `pitchConfidence is required when pitch is present`, id);
    // `pitchConfidence: "high"` is set by the pitch post-pass (review round 2b, 2026-10-17: every N5/N4 item
    // checked one by one against standard Tokyo accent and audited by the vocab lens), so it is no longer a warning.
  } else if (v.pitchConfidence !== undefined) fail(ctx, file, 'V18', `pitchConfidence present without pitch`, id);
  if (v.frequencyRank !== undefined && (!Number.isInteger(v.frequencyRank) || v.frequencyRank < 1)) fail(ctx, file, 'V18', `frequencyRank must be a positive integer`, id);
  // V06 references
  for (const k of strs(v.kanjiIds)) if (!ctx.kanji.has(k)) fail(ctx, file, 'V06', `kanjiIds "${k}" does not resolve`, id);
  if (word !== undefined) {
    const listed = new Set(strs(v.kanjiIds));
    if (listed.size > 0) for (const ch of word.match(new RegExp(KANJI_RE.source, 'g')) ?? []) if (!listed.has(`j-${ch}`) && ch !== '々' && ch !== '〆') warn(ctx, file, 'V06', `kanjiIds omits j-${ch} used in "${word}"`, id);
  }
  if (v.pairId !== undefined) {
    const p = ctx.vocab.get(v.pairId);
    if (!p) fail(ctx, file, 'V06', `pairId "${v.pairId}" does not resolve`, id);
    else if (p.pairId !== id) warn(ctx, file, 'V06', `pairId is not symmetric (${v.pairId}.pairId = ${String(p.pairId)})`, id);
  }
  for (const c of strs(v.confusables)) if (!ctx.vocab.has(c)) fail(ctx, file, 'V06', `confusables "${c}" does not resolve`, id);
  // definitionJa (V11–V13, V15, V36 content checks)
  if (isObject(v.definitionJa as unknown as Json)) {
    const d = v.definitionJa as { ja: string; kana: string };
    if (typeof d.ja === 'string') {
      checkJa(ctx, file, id, d.ja, 'definitionJa.ja');
      if (typeof d.kana === 'string') checkJaKana(ctx, file, id, d.ja, d.kana, 'definitionJa', true);
      const plain = toPlain(d.ja);
      if (chars(plain) > 45) fail(ctx, file, 'V15', `definitionJa.ja is ${chars(plain)} plain chars > 45`, id);
      if (word !== undefined && kana !== undefined) {
        const hit = definitionContainsTarget(d.ja, plain, [word, kana, ...strs(v.altForms)], kana);
        if (hit !== null) soft(ctx, file, 'V36', `definitionJa contains the target "${hit}"`, id);
      }
    }
  }
}

/**
 * V36: the first target surface (word / kana / altForm, `〜` markers stripped)
 * that the definition contains, or null. A surface of two or more characters
 * counts when it appears in the plain text or in the reading text. A
 * single-character surface (〜泊, 〜的, 例, 差 …) would false-positive on every
 * other word that reuses the kanji (泊 in 泊まる, 的 in 目的), so it counts only
 * when a ruby `{X|yomi}` writes that kanji with the target's own reading.
 */
export function definitionContainsTarget(ja: string, plain: string, surfaces: readonly string[], kana: string): string | null {
  const reading = bare(kana);
  let rubyBases: RubySegment[] | null = null;
  for (const raw of surfaces) {
    const t = bare(raw);
    if (t.length === 0) continue;
    if (t.length >= 2) {
      if (plain.includes(t) || toKana(ja).includes(t)) return raw;
      continue;
    }
    rubyBases ??= parseRuby(ja).filter((s) => s.reading !== null);
    if (rubyBases.some((s) => s.base === t && s.reading === reading)) return raw;
  }
  return null;
}

/* ── V37 pos vs verb ending ──────────────────────────────────────────────── */

/**
 * Ichidan (v1) dictionary forms end in an い-row or え-row mora followed by る:
 * いる きる ぎる しる じる ちる ぢる にる ひる びる ぴる みる りる ·
 * える ける げる せる ぜる てる でる ねる へる べる ぺる める れる (and their katakana forms, ウケる).
 */
export const ICHIDAN_ENDING_RE = /(?:[いきぎしじちぢにひびぴみりえけげせぜてでねへべぺめれ]|[イキギシジチヂニヒビピミリエケゲセゼテデネヘベペメレ])る$/;

/**
 * Common ichidan verbs whose dictionary form looks like a godan one (え/い-mora + る),
 * keyed by the written word so きる (着る v1 / 切る v5) and かえる (変える v1 / 帰る v5)
 * stay apart. Consulted by V37 only when the conjugation golden table has no entry.
 */
export const KNOWN_ICHIDAN: ReadonlySet<string> = new Set([
  '食べる', '見る', '寝る', '起きる', '出る', '開ける', '閉める', '教える', '借りる', '着る', '浴びる', '降りる', '覚える', '考える', '答える',
  '入れる', '生まれる', '忘れる', '疲れる', '止める', '始める', '調べる', '捨てる', '伝える', '集める', '決める', '届ける', '続ける', '比べる', '逃げる',
  '投げる', '迎える', '見せる', '見える', '聞こえる', '足りる', '信じる', '感じる', '似る', '煮る', '出来る', 'できる', '遅れる', '慣れる', '別れる',
  '晴れる', '倒れる', '流れる', '離れる', '触れる', '訪れる', '現れる', '壊れる', '折れる', '売れる', '取れる', '切れる', '割れる', '増える', '植える',
  '変える', '替える', '消える', '冷える', '燃える', '覚める', '温める', '褒める', '詰める', '眺める', '勤める', '務める', '認める', '求める', '辞める',
  '定める', '占める', '締める', '上げる', '下げる', '受ける', '掛ける', 'かける', '避ける', '助ける', '付ける', '着ける', '漬ける', '分ける', '見つける',
  '片付ける', '出かける', '生きる', '過ぎる', '落ちる', '用いる', '率いる', '強いる', '老いる', '報いる', '延びる', '伸びる', '滅びる', '詫びる', '試みる',
  '顧みる', '省みる', '鑑みる', '得る', '経る', '寄せる', '任せる', '乗せる', '載せる', '知らせる', '合わせる', '済ませる', '混ぜる', '撫でる', '茹でる',
  '建てる', '立てる', '育てる', '当てる', '隔てる', '慌てる', '果てる', '企てる', '跳ねる', '尋ねる', '訪ねる', '重ねる', '兼ねる', '真似る', '連れる',
  '恐れる', '暮れる', '濡れる', '枯れる', '揺れる', '腫れる', '溢れる', '紛れる', '乱れる', '優れる', '隠れる', '抱える', '耐える', '堪える', '支える',
  '控える', '構える', '整える', '唱える', '称える', '甘える', '栄える', '肥える', '越える', '超える', '凍える', '震える', '揃える', '数える', '蓄える',
  '据える', '飢える', '見分ける', '明ける', '設ける', '儲ける', '砕ける', '欠ける', '焼ける', '溶ける', '解ける', '老ける', '更ける', '怠ける', '化ける',
  '負ける', '預ける', '痩せる', '見つめる', '勧める', '進める', '攻める', '責める', '泊める', '埋める', '染める', '諦める', '確かめる', '苦しめる', '含める',
  '緩める', '丸める', 'まとめる', 'あきらめる', '与える', '加える', '終える', '捉える', '押さえる', '抑える', '備える', '供える', '訴える', '例える', '応える',
  '違える', '間違える', '着替える', '乗り換える', '生える', '映える', '冴える', '叶える', '仕える', '沈める', '努める', '込める', '慰める',
]);

function checkVerbPos(ctx: Ctx, file: string, id: string, pos: 'v1' | 'v5', word: string, kana: string): void {
  const w = bare(word);
  const k = bare(kana);
  const attested = ctx.conjPos.get(`${w}\u0000${k}`);
  if (attested && attested.size > 0) {
    // the conjugation golden table is ground truth where the head word appears
    if (!attested.has(pos)) {
      const truth = [...attested].filter((p) => p === 'v1' || p === 'v5' || p === 'v-irr');
      if (truth.length > 0) warn(ctx, file, 'V37', `pos "${pos}" but the conjugation table lists "${w}" as ${truth.join('/')}; suggested pos ${truth[0]}`, id);
    }
    return;
  }
  if (pos === 'v1') {
    if (/(?:する|くる|来る)$/.test(w)) warn(ctx, file, 'V37', `pos "v1" but "${w}" ends in する/くる; suggested pos v-irr (or n-suru for noun + する)`, id);
    else if (!ICHIDAN_ENDING_RE.test(k)) warn(ctx, file, 'V37', `pos "v1" but kana "${k}" does not end in an ichidan ending (い/え-row mora + る); suggested pos v5`, id);
  } else if (ICHIDAN_ENDING_RE.test(k) && KNOWN_ICHIDAN.has(w)) {
    warn(ctx, file, 'V37', `pos "v5" but "${w}" is a known ichidan verb; suggested pos v1`, id);
  }
}

/** Surfaces that count as "the word is present" (V16) and as token matches (V20). */
function vocabSurfaces(v: VocabItem): string[] {
  const out = new Set<string>();
  const word = str(v.word) ?? '';
  const kana = str(v.kana) ?? '';
  if (word) out.add(bare(word));
  if (kana) out.add(bare(kana));
  for (const a of strs(v.altForms)) out.add(bare(a));
  if (v.pos === 'v1' || v.pos === 'v5' || v.pos === 'adj-i' || v.pos === 'n-suru' || v.pos === 'v-irr') {
    const stem = (s: string) => (s.length >= 2 ? s.slice(0, -1) : s);
    if (v.pos === 'n-suru') {
      // the noun itself is the stem
    } else {
      if (word) out.add(stem(bare(word)));
      if (kana) out.add(stem(bare(kana)));
      for (const a of strs(v.altForms)) out.add(stem(bare(a)));
    }
  }
  return [...out].filter((s) => s.length > 0);
}

/* kanji */
function checkKanji(ctx: Ctx, f: LoadedFile, k: KanjiItem): void {
  const file = f.rel;
  const id = k.id;
  const ch = str(k.char);
  if (ch !== undefined && id !== `j-${ch}`) fail(ctx, file, 'V05', `id must equal "j-" + char ("j-${ch}")`, id);
  if (![1, 2, 3, 4, 5].includes(k.jlpt as number)) fail(ctx, file, 'V07', `jlpt must be 1–5`, id);
  else if (f.pathLevel && levelOfJlpt(k.jlpt) !== f.pathLevel) fail(ctx, file, 'V05', `jlpt ${k.jlpt} ≠ path level ${f.pathLevel}`, id);
  const meanings = strs(k.meanings);
  if (meanings.length < 1 || meanings.length > 3) fail(ctx, file, 'V14', `meanings must have 1–3 entries (${meanings.length})`, id);
  const comps = strs(k.components);
  if (comps.length < 1 || comps.length > 5) fail(ctx, file, 'V14', `components must have 1–5 entries (${comps.length})`, id);
  // V38 repeated component (W, information only; the list is kept as written)
  {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const c of comps) {
      const key = c.toLowerCase();
      if (seen.has(key)) {
        if (!repeated.includes(c)) repeated.push(c);
      } else seen.add(key);
    }
    if (repeated.length > 0) warn(ctx, file, 'V38', `components repeats ${repeated.map((c) => `"${c}"`).join(', ')} (${comps.join(', ')})`, id);
  }
  const examples = Array.isArray(k.examples) ? k.examples : [];
  if (examples.length < 2) fail(ctx, file, 'V14', `examples must have ≥ 2 entries (${examples.length})`, id);
  const on = strs(k.on);
  const kun = strs(k.kun);
  if (Array.isArray(k.on) && Array.isArray(k.kun) && on.length === 0 && kun.length === 0) fail(ctx, file, 'V14', `on and kun cannot both be empty`, id);
  for (const [i, r] of on.entries()) if (!ON_RE.test(r)) fail(ctx, file, 'V10', `on[${i}] "${r}" must be katakana only`, id);
  for (const [i, r] of kun.entries()) if (!KUN_RE.test(r)) fail(ctx, file, 'V10', `kun[${i}] "${r}" must be hiragana with ≤ 1 dot before okurigana`, id);
  if (typeof k.strokes === 'number' && (!Number.isInteger(k.strokes) || k.strokes < 1 || k.strokes > 30)) fail(ctx, file, 'V18', `strokes ${k.strokes} outside 1–30`, id);
  if (typeof k.mnemonic === 'string') {
    if (chars(k.mnemonic) > 280) fail(ctx, file, 'V15', `mnemonic is ${chars(k.mnemonic)} chars > 280`, id);
    for (const c of comps) {
      const re = new RegExp(`(^|[^A-Za-z])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i');
      if (!re.test(k.mnemonic)) fail(ctx, file, 'V17', `mnemonic does not mention component "${c}"`, id);
    }
  }
  if (ctx.components) {
    for (const c of comps) if (!ctx.components.has(c.toLowerCase())) fail(ctx, file, 'V07', `component "${c}" is not a canonical name in _meta/components.json`, id);
  }
  for (const [i, g] of meanings.entries()) checkGloss(ctx, file, id, g, `meanings[${i}]`, { kanji: true });
  let readingUsed = false;
  const readings = [...on.map((r) => katakanaToHiragana(r)), ...kun.map((r) => r.split('.')[0] ?? r)].filter((r) => r.length > 0);
  examples.forEach((ex, i) => {
    if (!isObject(ex as unknown as Json)) return;
    const w = str(ex.word);
    const ka = str(ex.kana);
    if (w !== undefined) {
      checkPlainField(ctx, file, id, w, `examples[${i}].word`);
      if (ch !== undefined && !w.includes(ch)) fail(ctx, file, 'V16', `examples[${i}].word "${w}" does not contain ${ch}`, id);
    }
    if (ka !== undefined) {
      if (!KANA_WORD_RE.test(ka)) fail(ctx, file, 'V10', `examples[${i}].kana "${ka}" is not kana-only`, id);
      if (readings.some((r) => katakanaToHiragana(ka).includes(r))) readingUsed = true;
    }
    if (typeof ex.en === 'string') checkGloss(ctx, file, id, ex.en, `examples[${i}].en`, { anyCase: true });
  });
  if (!readingUsed && readings.length > 0 && examples.length > 0) warn(ctx, file, 'V16', `no example uses a listed on/kun reading`, id);
  if (k.radical !== undefined && typeof k.radical === 'string' && !hasKanji(k.radical) && !/^[⺀-⿕]$/.test(k.radical)) warn(ctx, file, 'V03', `radical "${k.radical}" is not a kanji/radical glyph`, id);
  for (const l of strs(k.lookalikes)) if (!ctx.kanji.has(l)) fail(ctx, file, 'V06', `lookalike "${l}" does not resolve to a kanji id`, id);
}

function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/* grammar */
function checkGrammar(ctx: Ctx, f: LoadedFile, g: GrammarItem): void {
  const file = f.rel;
  const id = g.id;
  const m = /^g-n([1-5])-\d{3}$/.exec(id);
  if (m) {
    if (Number(m[1]) !== g.jlpt) fail(ctx, file, 'V05', `id level n${m[1]} ≠ jlpt ${String(g.jlpt)}`, id);
    if (f.pathLevel && `n${m[1]}` !== f.pathLevel) fail(ctx, file, 'V05', `id level n${m[1]} ≠ path level ${f.pathLevel}`, id);
  }
  if (![1, 2, 3, 4, 5].includes(g.jlpt as number)) fail(ctx, file, 'V07', `jlpt must be 1–5`, id);
  if (!(REGISTER_TAGS as readonly string[]).includes(String(g.register))) fail(ctx, file, 'V07', `register "${String(g.register)}" is not a RegisterTag`, id);
  for (const t of strs(g.tags)) {
    if (t === 'neutral' || (!(DOMAIN_TAGS as readonly string[]).includes(t) && !(REGISTER_TAGS as readonly string[]).includes(t) && !(MISC_TAGS as readonly string[]).includes(t))) {
      fail(ctx, file, 'V07', `tag "${t}" is not a domain, register or misc tag`, id);
    }
  }
  const examples = Array.isArray(g.examples) ? g.examples : [];
  if (examples.length < 3) fail(ctx, file, 'V14', `examples must have ≥ 3 entries (${examples.length})`, id);
  const hints = strs(g.clozeHints);
  if (hints.length < 1) fail(ctx, file, 'V14', `clozeHints must have ≥ 1 entry`, id);
  const formation = strs(g.formation);
  if (formation.length < 1 || formation.length > 6) fail(ctx, file, 'V14', `formation must have 1–6 lines (${formation.length})`, id);
  const mistakes = strs(g.mistakes);
  if (mistakes.length > 3) fail(ctx, file, 'V14', `mistakes must have ≤ 3 entries (${mistakes.length})`, id);
  mistakes.forEach((mi, i) => {
    if (!MISTAKE_RE.test(mi)) fail(ctx, file, 'V14', `mistakes[${i}] must match "× <wrong> → ○ <right> (<why>)"`, id);
    if (chars(mi) > 160) fail(ctx, file, 'V15', `mistakes[${i}] is ${chars(mi)} chars > 160`, id);
  });
  for (const [i, h] of hints.entries()) checkPlainField(ctx, file, id, h, `clozeHints[${i}]`, false);
  if (typeof g.explanation === 'string' && wordCount(g.explanation) > 120) fail(ctx, file, 'V15', `explanation is ${wordCount(g.explanation)} words > 120`, id);
  if (g.notes !== undefined && chars(g.notes) > 200) fail(ctx, file, 'V15', `notes is ${chars(g.notes)} chars > 200`, id);
  if (typeof g.meaning === 'string' && /\.$/.test(g.meaning)) warn(ctx, file, 'V33', `meaning ends with a period`, id);
  const level = typeof g.jlpt === 'number' && g.jlpt >= 1 && g.jlpt <= 5 ? levelOfJlpt(g.jlpt) : null;
  const plains = checkSentenceExamples(ctx, file, id, examples, level, 'examples');
  plains.forEach((plain, i) => {
    const ex = examples[i];
    const kana = isObject(ex as unknown as Json) ? str((ex as { kana?: unknown }).kana) ?? '' : '';
    if (hints.length > 0 && !hints.some((h) => plain.includes(h) || kana.includes(h))) fail(ctx, file, 'V16', `examples[${i}] contains none of clozeHints`, id);
  });
  // V22 per register
  if (g.register === 'polite' || g.register === 'casual') {
    plains.forEach((plain, i) => {
      if (!isSentence(plain)) return;
      const polite = isPolite(plain);
      if (g.register === 'polite' && !polite) warn(ctx, file, 'V22', `examples[${i}] does not end politely (register polite)`, id);
      if (g.register === 'casual' && polite) warn(ctx, file, 'V22', `examples[${i}] ends in ます/です (register casual)`, id);
    });
  }
  // V23
  const related = strs(g.related);
  if (related.includes(id)) fail(ctx, file, 'V23', `related contains the item itself`, id);
  if (new Set(related).size !== related.length) fail(ctx, file, 'V23', `related has duplicates`, id);
  for (const r of related) if (!ctx.grammar.has(r)) fail(ctx, file, 'V06', `related "${r}" does not resolve`, id);
  for (const fm of strs(g.unlocksForms)) if (!(CONJ_FORMS as readonly string[]).includes(fm)) fail(ctx, file, 'V23', `unlocksForms "${fm}" is not a ConjForm`, id);
}

/* conjugation */
const VERB_FORMS: ReadonlySet<string> = new Set(CONJ_FORMS.filter((f) => !f.startsWith('adj-')));
const ADJ_FORMS: ReadonlySet<string> = new Set(CONJ_FORMS.filter((f) => f.startsWith('adj-')));
const CONJ_POS: ReadonlySet<string> = new Set(['v1', 'v5', 'v-irr', 'adj-i', 'adj-na']);

function checkConjugation(ctx: Ctx, f: LoadedFile, c: ConjugationGoldenEntry): void {
  const file = f.rel;
  const id = c.id;
  if (!CONJ_POS.has(String(c.pos))) fail(ctx, file, 'V26', `pos "${String(c.pos)}" is not conjugable`, id);
  if (!(CONJ_FORMS as readonly string[]).includes(String(c.form))) fail(ctx, file, 'V07', `form "${String(c.form)}" is not a ConjForm`, id);
  else {
    const isAdj = c.pos === 'adj-i' || c.pos === 'adj-na';
    if (isAdj && !ADJ_FORMS.has(c.form)) fail(ctx, file, 'V26', `form "${c.form}" does not apply to ${c.pos}`, id);
    if (!isAdj && CONJ_POS.has(String(c.pos)) && !VERB_FORMS.has(c.form)) fail(ctx, file, 'V26', `form "${c.form}" does not apply to ${c.pos}`, id);
  }
  if (typeof c.kana === 'string' && !KANA_WORD_RE.test(c.kana)) fail(ctx, file, 'V10', `kana "${c.kana}" is not kana-only`, id);
  if (typeof c.answerKana === 'string' && !KANA_WORD_RE.test(c.answerKana)) fail(ctx, file, 'V26', `answerKana "${c.answerKana}" is not kana-only`, id);
  if (typeof c.word === 'string') checkPlainField(ctx, file, id, c.word, 'word');
  if (typeof c.answer === 'string' && /[{}|]/.test(c.answer)) fail(ctx, file, 'V26', `answer must be plain (no ruby)`, id);
  for (const [i, a] of strs(c.alt).entries()) {
    checkPlainField(ctx, file, id, a, `alt[${i}]`);
    if (a === c.answer) fail(ctx, file, 'V26', `alt[${i}] equals answer`, id);
  }
}

/* component */
function checkComponent(ctx: Ctx, f: LoadedFile, c: ComponentDef): void {
  const file = f.rel;
  const id = c.id;
  if (typeof c.name === 'string') {
    if (c.name !== c.name.toLowerCase()) fail(ctx, file, 'V03', `name must be lowercase`, id);
    const kebab = `c-${c.name.trim().toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
    if (id !== kebab) fail(ctx, file, 'V05', `id should be "${kebab}" (kebab-case of name)`, id);
  }
  if (c.hint !== undefined && chars(c.hint) > 80) fail(ctx, file, 'V15', `hint is ${chars(c.hint)} chars > 80`, id);
}

/* michikusa */
const MICHIKUSA_KINDS: ReadonlySet<string> = new Set(['etymology', 'proverb', 'culture', 'pitch', 'kanji-origin', 'usage', 'road-history']);
function checkMichikusa(ctx: Ctx, f: LoadedFile, m: MichikusaItem): void {
  const file = f.rel;
  const id = m.id;
  if (!MICHIKUSA_KINDS.has(String(m.kind))) fail(ctx, file, 'V07', `kind "${String(m.kind)}" is not a MichikusaKind`, id);
  const st = typeof m.stationId === 'string' ? stationOfId(m.stationId) : undefined;
  if (typeof m.stationId === 'string' && !st) fail(ctx, file, 'V06', `stationId "${m.stationId}" is not in STATIONS`, id);
  const n = stationNumberOf(id);
  if (st && n !== null && st.number !== n) fail(ctx, file, 'V05', `id station ${n} ≠ stationId ${m.stationId}`, id);
  if (n !== null && f.seq !== null && n !== f.seq) fail(ctx, file, 'V05', `id station ${n} ≠ file station ${f.seq}`, id);
  if (typeof m.bodyEn === 'string' && wordCount(m.bodyEn) > 60) fail(ctx, file, 'V15', `bodyEn is ${wordCount(m.bodyEn)} words > 60`, id);
  if (m.sourceNote !== undefined && chars(m.sourceNote) > 80) fail(ctx, file, 'V15', `sourceNote is ${chars(m.sourceNote)} chars > 80`, id);
  if ((m.kind === 'road-history' || m.kind === 'etymology' || m.kind === 'kanji-origin') && m.sourceNote === undefined) fail(ctx, file, 'V03', `sourceNote is required for kind "${m.kind}"`, id);
  if (typeof m.ja === 'string') {
    checkJa(ctx, file, id, m.ja, 'ja');
    if (typeof m.kana !== 'string') fail(ctx, file, 'V03', `kana is required when ja is present`, id);
    else checkJaKana(ctx, file, id, m.ja, m.kana, '', true);
  } else if (m.kana !== undefined) fail(ctx, file, 'V03', `kana present without ja`, id);
}

/* story (per item structural parts; V20 lives in checkStories) */
function checkStoryItem(ctx: Ctx, f: LoadedFile, s: StoryItem): void {
  const file = f.rel;
  const id = s.id;
  const st = typeof s.stationId === 'string' ? stationOfId(s.stationId) : undefined;
  if (typeof s.stationId === 'string' && !st) fail(ctx, file, 'V06', `stationId "${s.stationId}" is not in STATIONS`, id);
  const n = stationNumberOf(id);
  if (st && n !== null && st.number !== n) fail(ctx, file, 'V05', `id station ${n} ≠ stationId ${s.stationId}`, id);
  if (n !== null && f.seq !== null && n !== f.seq) fail(ctx, file, 'V05', `id station ${n} ≠ file station ${f.seq}`, id);
  const seq = Number(/-(\d)$/.exec(id)?.[1] ?? 0);
  // V05 amendment (design 08 §5): the pieces take the sequence numbers after the station's texts.
  if (st && seq > st.quota.stories + st.quota.listening) fail(ctx, file, 'V05', `story sequence ${seq} > quota.stories + quota.listening (${st.quota.stories} + ${st.quota.listening}) for ${st.id}`, id);
  if (s.kind !== 'story' && s.kind !== 'dialogue') fail(ctx, file, 'V07', `kind must be story|dialogue`, id);
  if (!(REGISTER_TAGS as readonly string[]).includes(String(s.register))) fail(ctx, file, 'V07', `register "${String(s.register)}" is not a RegisterTag`, id);
  const station = st?.number ?? n ?? 0;
  const level = st ? stationLevel(st) : 'n5';
  const cap = Math.ceil(SENTENCE_MAX_CHARS[level === 'kana' ? 'n5' : level] * 1.5);
  if (typeof s.titleJa === 'string') checkJa(ctx, file, id, s.titleJa, 'titleJa');
  if (typeof s.recapEn === 'string' && wordCount(s.recapEn) > 60) fail(ctx, file, 'V15', `recapEn is ${wordCount(s.recapEn)} words > 60`, id);
  if (s.bridge === true && station < BRIDGE_FROM_STATION) soft(ctx, file, 'V20', `bridge: true only from Station ${BRIDGE_FROM_STATION}`, id);
  const lines = Array.isArray(s.lines) ? s.lines : [];
  if (lines.length < 12 || lines.length > 60) fail(ctx, file, 'V14', `lines must have 12–60 entries (${lines.length})`, id);
  const questions = Array.isArray(s.comprehension) ? s.comprehension : [];
  if (questions.length < 3) fail(ctx, file, 'V14', `comprehension must have ≥ 3 questions (${questions.length})`, id);
  // lines
  const speakers = new Set<string>();
  let politeLines = 0;
  let sentenceLines = 0;
  const plainLines: string[] = [];
  const kanaLines: string[] = [];
  lines.forEach((ln, i) => {
    if (!isObject(ln as unknown as Json)) return;
    const p = `lines[${i}]`;
    const ja = str(ln.ja);
    const kana = str(ln.kana);
    const plain = ja !== undefined ? toPlain(ja) : '';
    plainLines.push(plain);
    kanaLines.push(kana ?? '');
    if (ja !== undefined) {
      checkJa(ctx, file, id, ja, `${p}.ja`);
      if (kana !== undefined) checkJaKana(ctx, file, id, ja, kana, p, true);
      if (chars(plain) > cap) fail(ctx, file, 'V15', `${p}.ja is ${chars(plain)} chars > ${cap} (story cap at ${level.toUpperCase()})`, id);
      if (isSentence(plain)) {
        sentenceLines++;
        if (isPolite(plain)) politeLines++;
      }
    }
    if (typeof ln.en === 'string' && !/[.?!]["”’']?$/.test(ln.en)) warn(ctx, file, 'V33', `${p}.en should end with . ? or !`, id);
    const tokens = strs(ln.tokens);
    if (Array.isArray(ln.tokens)) {
      if (tokens.some((t) => t.length === 0)) fail(ctx, file, 'V19', `${p}.tokens has an empty token`, id);
      if (tokens.some((t) => /[{}|]/.test(t))) fail(ctx, file, 'V19', `${p}.tokens contains ruby markup`, id);
      if (tokens.some((t) => DIGIT_RE.test(t))) fail(ctx, file, 'V31', `${p}.tokens contains ASCII digits`, id);
      if (ja !== undefined && tokens.join('') !== plain) fail(ctx, file, 'V19', `${p}.tokens.join("") ≠ plain ja ("${tokens.join('')}" vs "${plain}")`, id);
      if (Array.isArray(ln.tokenIds) && ln.tokenIds.length !== tokens.length) fail(ctx, file, 'V19', `${p}.tokenIds (${ln.tokenIds.length}) is not parallel to tokens (${tokens.length})`, id);
      if (Array.isArray(ln.tokenIds) && ctx.bundles.size === 0) warn(ctx, file, 'V19', `${p}.tokenIds present but no station bundles exist to verify it (writers never set tokenIds)`, id);
      if (level === 'kana') {
        const words = tokens.filter((t) => !PUNCT_TOKEN_RE.test(t)).length;
        if (words > 14) warn(ctx, file, 'V15', `${p} has ${words} words > 14 (White picture-book lines are 2–6 words)`, id);
      } else if (level === 'n5') {
        const words = tokens.filter((t) => !PUNCT_TOKEN_RE.test(t)).length;
        if (words > 14) warn(ctx, file, 'V15', `${p} has ${words} words > 14 (N5)`, id);
      }
    }
    if (typeof ln.speaker === 'string') speakers.add(ln.speaker);
    if (ln.registerTarget !== undefined) {
      if (!(REGISTER_TAGS as readonly string[]).includes(String(ln.registerTarget))) fail(ctx, file, 'V27', `${p}.registerTarget "${String(ln.registerTarget)}" is not a RegisterTag`, id);
      if (station < 21) fail(ctx, file, 'V27', `${p}.registerTarget only from Station 21`, id);
    }
    for (const [j, a] of strs(ln.accept).entries()) {
      checkPlainField(ctx, file, id, a, `${p}.accept[${j}]`);
      if (a === plain) fail(ctx, file, 'V27', `${p}.accept[${j}] equals the line itself`, id);
    }
    for (const [j, mi] of strs(ln.mustInclude).entries()) {
      checkPlainField(ctx, file, id, mi, `${p}.mustInclude[${j}]`);
      if (!plain.includes(mi)) fail(ctx, file, 'V27', `${p}.mustInclude[${j}] "${mi}" is not a substring of the line`, id);
    }
    if (Array.isArray(ln.options)) {
      const texts = new Set<string>();
      let best = 0;
      ln.options.forEach((op, j) => {
        if (!isObject(op as unknown as Json)) return;
        if (!['best', 'ok', 'register-wrong', 'grammar-wrong'].includes(String(op.kind))) fail(ctx, file, 'V07', `${p}.options[${j}].kind "${String(op.kind)}" is invalid`, id);
        if (typeof op.text === 'string') {
          checkPlainField(ctx, file, id, op.text, `${p}.options[${j}].text`);
          if (texts.has(op.text)) fail(ctx, file, 'V27', `${p}.options texts are not distinct ("${op.text}")`, id);
          texts.add(op.text);
          if (op.kind === 'best') {
            best++;
            if (op.text !== plain) fail(ctx, file, 'V27', `${p}.options best.text must equal the plain line`, id);
          } else if (op.recast === undefined) fail(ctx, file, 'V27', `${p}.options[${j}] (${String(op.kind)}) needs a recast`, id);
        }
        if (op.recast !== undefined && typeof op.recast === 'string') checkPlainField(ctx, file, id, op.recast, `${p}.options[${j}].recast`);
      });
      if (ln.options.length < 3 || ln.options.length > 4) fail(ctx, file, 'V27', `${p}.options must have 3–4 entries (${ln.options.length})`, id);
      if (best !== 1) fail(ctx, file, 'V27', `${p}.options must have exactly one kind "best" (${best})`, id);
    }
  });
  // V25 story form
  if (s.kind === 'dialogue') {
    lines.forEach((ln, i) => {
      if (isObject(ln as unknown as Json) && typeof ln.speaker !== 'string') fail(ctx, file, 'V25', `lines[${i}] has no speaker (dialogue)`, id);
    });
    if (speakers.size < 2) fail(ctx, file, 'V25', `dialogue needs ≥ 2 distinct speakers (${speakers.size})`, id);
    if (s.learnerSpeaker !== undefined && !speakers.has(s.learnerSpeaker)) fail(ctx, file, 'V25', `learnerSpeaker "${s.learnerSpeaker}" is not one of the speakers`, id);
    // V27 learner lines
    if (s.learnerSpeaker !== undefined) {
      lines.forEach((ln, i) => {
        if (!isObject(ln as unknown as Json)) return;
        const learner = ln.speaker === s.learnerSpeaker;
        if (learner) {
          if (!Array.isArray(ln.options)) fail(ctx, file, 'V27', `lines[${i}] (learner line) has no options`, id);
          if (!Array.isArray(ln.mustInclude)) fail(ctx, file, 'V27', `lines[${i}] (learner line) has no mustInclude`, id);
          if (!Array.isArray(ln.accept)) warn(ctx, file, 'V27', `lines[${i}] (learner line) has no accept`, id);
          if (ln.aizuchiSlot === true) fail(ctx, file, 'V27', `lines[${i}].aizuchiSlot only on NPC lines`, id);
        }
      });
    }
  } else if (s.kind === 'story') {
    lines.forEach((ln, i) => {
      if (!isObject(ln as unknown as Json)) return;
      if (ln.speaker !== undefined) fail(ctx, file, 'V25', `lines[${i}] has a speaker (story)`, id);
      for (const k of ['options', 'accept', 'mustInclude', 'aizuchiSlot', 'registerTarget'] as const) {
        if (ln[k] !== undefined) fail(ctx, file, 'V27', `lines[${i}].${k} is a dialogue-only field`, id);
      }
    });
    if (s.learnerSpeaker !== undefined) fail(ctx, file, 'V25', `learnerSpeaker only in dialogues`, id);
  }
  for (const nm of strs(s.names)) {
    if (!plainLines.some((p) => p.includes(nm)) && !kanaLines.some((k) => k.includes(nm))) fail(ctx, file, 'V25', `names entry "${nm}" appears in no line`, id);
  }
  // V22 majority register
  if ((s.register === 'polite' || s.register === 'casual') && sentenceLines > 0) {
    const share = politeLines / sentenceLines;
    if (s.register === 'polite' && share < 0.5) warn(ctx, file, 'V22', `only ${Math.round(share * 100)} % of lines end politely but register is polite`, id);
    if (s.register === 'casual' && share > 0.5) warn(ctx, file, 'V22', `${Math.round(share * 100)} % of lines end in ます/です but register is casual`, id);
  }
  // V21 comprehension
  const answers = new Set<number>();
  questions.forEach((q, i) => {
    if (!isObject(q as unknown as Json)) return;
    const p = `comprehension[${i}]`;
    const choices = strs(q.choices);
    if (choices.length !== 4) fail(ctx, file, 'V21', `${p}.choices must have exactly 4 entries`, id);
    if (new Set(choices).size !== choices.length) fail(ctx, file, 'V21', `${p}.choices are not distinct`, id);
    if (typeof q.answer === 'number') {
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) fail(ctx, file, 'V18', `${p}.answer must be 0–3`, id);
      else answers.add(q.answer);
    }
    const texts = [typeof q.q === 'string' ? q.q : '', ...choices];
    if (station <= 15) {
      texts.forEach((t, j) => {
        if (JAPANESE_CHAR_RE.test(t)) fail(ctx, file, 'V21', `${p}.${j === 0 ? 'q' : `choices[${j - 1}]`} must be English through Station 15`, id);
      });
    } else {
      texts.forEach((t, j) => {
        if (JAPANESE_CHAR_RE.test(t) || /[{}|]/.test(t)) checkJa(ctx, file, id, t, `${p}.${j === 0 ? 'q' : `choices[${j - 1}]`}`, 'V21');
      });
    }
  });
  if (questions.length >= 2 && answers.size === 1) warn(ctx, file, 'V21', `the correct index is the same for every question`, id);
  // V06 references
  for (const v of strs(s.vocabIds)) if (!ctx.vocab.has(v)) fail(ctx, file, 'V06', `vocabIds "${v}" does not resolve`, id);
  for (const g of strs(s.grammarIds)) if (!ctx.grammar.has(g)) fail(ctx, file, 'V06', `grammarIds "${g}" does not resolve`, id);
  lines.forEach((ln, i) => {
    if (!isObject(ln as unknown as Json)) return;
    for (const v of strs(ln.plusOne)) if (!ctx.vocab.has(v)) fail(ctx, file, 'V06', `lines[${i}].plusOne "${v}" does not resolve`, id);
  });
  checkListeningFields(ctx, f, s, { station, lines, questions, speakers, kanaLines });
}

/* ── V41 / V42 / V43 (per text) — listening pieces, design 08 §5 ─────────── */

/** `DICTATION_MAX_MORAE` (src/input/listening/set.ts): every line of an audioFirst piece through Station 15 stays dictable (design 08 §3, V41). */
export const PIECE_LINE_MAX_MORAE = 22;

/**
 * Morae of a line's kana for the V41 cap: punctuation and spaces are not morae (design 08 §5). One body with the
 * clip cues' `m` / `c` indexes, the planner's clause and the drills' clause cut: `speechMorae` (`src/shared/jp.ts`,
 * `RE_NOT_MORA` dropped, small kana folded).
 */
export function lineMorae(kana: string): number {
  return speechMorae(kana).length;
}

interface StoryParts {
  station: number;
  lines: StoryLine[];
  questions: StoryItem['comprehension'];
  speakers: Set<string>;
  kanaLines: string[];
}

function checkListeningFields(ctx: Ctx, f: LoadedFile, s: StoryItem, parts: StoryParts): void {
  const file = f.rel;
  const id = s.id;
  const { station, lines, questions, speakers } = parts;
  const genre = s.genre as unknown;
  const audioFirst = s.audioFirst as unknown;
  // V41 genre and audioFirst
  if (genre !== undefined) {
    if (!(LISTENING_GENRES as readonly string[]).includes(String(genre))) fail(ctx, file, 'V41', `genre "${String(genre)}" is not a ListeningGenre`, id);
    else {
      const from = GENRE_FROM_STATION[genre as ListeningGenre];
      if (from > station) fail(ctx, file, 'V41', `genre "${String(genre)}" only from Station ${from} (this text is at Station ${station})`, id);
    }
  }
  if (audioFirst !== undefined) {
    if (audioFirst !== true) fail(ctx, file, 'V41', `audioFirst is true or omitted (got ${JSON.stringify(audioFirst)})`, id);
    if (genre === undefined) fail(ctx, file, 'V41', `audioFirst requires genre`, id);
  }
  // V41 narrator only on a speaker-less text
  if (s.narrator !== undefined && s.kind === 'dialogue') fail(ctx, file, 'V41', `narrator only on kind "story" (a dialogue names its speakers per line)`, id);
  // V41 emotion
  lines.forEach((ln, i) => {
    if (!isObject(ln as unknown as Json) || ln.emotion === undefined) return;
    if (!(LINE_EMOTIONS as readonly string[]).includes(String(ln.emotion))) fail(ctx, file, 'V41', `lines[${i}].emotion "${String(ln.emotion)}" is not a LineEmotion`, id);
    else if (s.kind === 'story' && s.narrator === undefined) warn(ctx, file, 'V41', `lines[${i}].emotion on a story line without narrator (no cast voice to style)`, id);
  });
  // V41 question kinds and lineRef
  let gist = 0;
  questions.forEach((q, i) => {
    if (!isObject(q as unknown as Json)) return;
    const p = `comprehension[${i}]`;
    if (q.kind !== undefined) {
      if (!(QUESTION_KINDS as readonly string[]).includes(String(q.kind))) fail(ctx, file, 'V41', `${p}.kind "${String(q.kind)}" is not a QuestionKind`, id);
      else {
        if (q.kind === 'gist') gist++;
        if (q.kind === 'speaker' && s.kind !== 'dialogue') fail(ctx, file, 'V41', `${p}.kind "speaker" only in a dialogue`, id);
      }
    }
    if (q.lineRef !== undefined && (!Number.isInteger(q.lineRef) || q.lineRef < 0 || q.lineRef >= lines.length)) {
      fail(ctx, file, 'V41', `${p}.lineRef ${String(q.lineRef)} is not a line index (0–${Math.max(0, lines.length - 1)})`, id);
    }
  });
  const inListeningFile = LISTENING_FILE_RE.test(file);
  if (audioFirst === true) {
    if (gist === 0) fail(ctx, file, 'V41', `an audioFirst text needs ≥ 1 comprehension question with kind "gist"`, id);
    if (station <= 15) {
      lines.forEach((ln, i) => {
        if (!isObject(ln as unknown as Json) || typeof ln.kana !== 'string') return;
        const m = lineMorae(ln.kana);
        if (m > PIECE_LINE_MAX_MORAE) fail(ctx, file, 'V41', `lines[${i}] is ${m} morae > ${PIECE_LINE_MAX_MORAE} (every line of a piece is dictable through Station 15)`, id);
      });
    }
    if (s.kind === 'dialogue' && s.learnerSpeaker !== undefined && !speakers.has(s.learnerSpeaker)) {
      fail(ctx, file, 'V41', `audioFirst dialogue: learnerSpeaker "${s.learnerSpeaker}" is not one of its speakers (${[...speakers].join(', ')}); omit it unless the piece is also a role-play`, id);
    }
    // V43 placement — the same switch as the per-station count (design 08 §5: F at release, W before)
    const v43 = atRelease(ctx);
    if (station <= 3) v43(ctx, file, 'V43', `audioFirst pieces only from Station 4 (none at Stations 1–3)`, id);
    if (!inListeningFile) v43(ctx, file, 'V43', `an audioFirst text lives in stories/<level>/listening-s${String(station).padStart(2, '0')}.json, not in ${file.split('/').pop() ?? file}`, id);
  } else if (inListeningFile) {
    atRelease(ctx)(ctx, file, 'V43', `listening-sNN.json holds audioFirst pieces only (this text has no audioFirst: true)`, id);
  }
  // V42 cast: every speaker label and narrator resolves in cast.json (F in strict mode, W otherwise)
  const labels = new Set<string>(speakers);
  if (typeof s.narrator === 'string') labels.add(s.narrator);
  for (const name of labels) {
    ctx.castUsed.add(name);
    if (ctx.cast !== null && !ctx.cast.has(name)) {
      const report = ctx.strict ? fail : warn;
      report(ctx, file, 'V42', `${name === s.narrator ? 'narrator' : 'speaker'} "${name}" does not resolve in ${ctx.castFile} (add the local there with gender and age before the packet ships)`, id);
    }
  }
}

const DEFAULT_CAST_FILE = 'scripts/audio/cast.json';

/** Names of a cast file in any of the shapes `CastInput` allows (design 08 §6; V42). */
export function castNames(raw: CastInput): Set<string> {
  const out = new Set<string>();
  const addEntry = (e: unknown) => {
    if (typeof e === 'string') out.add(e);
    else if (e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string') out.add((e as { name: string }).name);
  };
  if (Array.isArray(raw)) {
    for (const e of raw) addEntry(e);
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const key of ['speakers', 'cast', 'entries', 'voices']) {
    if (Array.isArray(obj[key])) {
      for (const e of obj[key] as unknown[]) addEntry(e);
      return out;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$') || k === 'schema' || k === 'engine' || k === 'version' || k === 'generatedAt') continue;
    if (v && typeof v === 'object') out.add(typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : k);
  }
  return out;
}

function loadCast(ctx: Ctx, cast: string | CastInput | undefined): void {
  if (cast !== undefined && typeof cast !== 'string') {
    ctx.cast = castNames(cast);
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const p = typeof cast === 'string' ? resolve(cast) : join(here, 'audio', 'cast.json');
  ctx.castFile = typeof cast === 'string' ? cast.split(sep).join('/') : DEFAULT_CAST_FILE;
  if (!existsSync(p)) {
    warn(ctx, ctx.castFile, 'V42', `cast check skipped: ${ctx.castFile} not found (speakers and narrators are not resolved; --cast <path>)`);
    return;
  }
  try {
    ctx.cast = castNames(JSON.parse(readFileSync(p, 'utf8')) as CastInput);
  } catch (e) {
    fail(ctx, ctx.castFile, 'V42', `invalid cast file: ${(e as Error).message}`);
    ctx.cast = new Set();
  }
}

/* ── per file (V22 casual share) ─────────────────────────────────────────── */

function checkFileLevelRules(ctx: Ctx, f: LoadedFile): void {
  if (f.pathKind !== 'vocab') return;
  let sentences = 0;
  let casual = 0;
  for (const it of f.items) {
    const ex = it['examples'];
    if (!Array.isArray(ex)) continue;
    for (const e of ex) {
      if (!isObject(e) || typeof e['ja'] !== 'string') continue;
      const plain = toPlain(e['ja']);
      if (!isSentence(plain)) continue;
      sentences++;
      if (!isPolite(plain)) casual++;
    }
  }
  if (sentences === 0) return;
  const share = casual / sentences;
  const pct = Math.round(share * 100);
  const seq = f.seq ?? 0;
  let range: [number, number] | null = null;
  if (f.pathLevel === 'n5') range = seq <= 4 ? [0, 0.1] : [0.2, 0.4];
  else if (f.pathLevel === 'n4' || f.pathLevel === 'n3') range = [0.35, 0.65];
  if (range && (share < range[0] || share > range[1])) {
    warn(ctx, f.rel, 'V22', `casual share is ${pct} % (expected ${Math.round(range[0] * 100)}–${Math.round(range[1] * 100)} % for this file)`);
  }
}

/* ── corpus-wide ─────────────────────────────────────────────────────────── */

function checkDedupe(ctx: Ctx): void {
  const byKey = new Map<string, VocabItem[]>();
  for (const v of ctx.vocab.values()) {
    if (typeof v.word !== 'string' || typeof v.kana !== 'string') continue;
    const key = `${v.word.normalize('NFKC')}\u0000${v.kana.normalize('NFKC')}`;
    const arr = byKey.get(key) ?? [];
    arr.push(v);
    byKey.set(key, arr);
  }
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    const allHomograph = arr.every((v) => strs(v.tags).includes('homograph'));
    const meaningSets = arr.map((v) => new Set(strs(v.meanings).map((m) => m.toLowerCase())));
    let overlap = false;
    for (let i = 0; i < meaningSets.length && !overlap; i++) for (let j = i + 1; j < meaningSets.length && !overlap; j++) for (const m of meaningSets[i]!) if (meaningSets[j]!.has(m)) overlap = true;
    if (allHomograph && !overlap) continue;
    const ids = arr.map((v) => v.id);
    for (const v of arr) fail(ctx, ctx.ids.get(v.id) ?? '', 'V32', `duplicate word+kana "${v.word}/${v.kana}" (${ids.join(', ')})${allHomograph ? ' with overlapping meanings' : ''}`, v.id);
  }
  // same kana, different word, overlapping meanings → W
  const byKana = new Map<string, VocabItem[]>();
  for (const v of ctx.vocab.values()) {
    if (typeof v.kana !== 'string') continue;
    const arr = byKana.get(v.kana) ?? [];
    arr.push(v);
    byKana.set(v.kana, arr);
  }
  for (const arr of byKana.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!;
        const b = arr[j]!;
        if (a.word === b.word) continue;
        const ma = new Set(strs(a.meanings).map((m) => m.toLowerCase()));
        if (strs(b.meanings).some((m) => ma.has(m.toLowerCase()))) warn(ctx, ctx.ids.get(a.id) ?? '', 'V32', `same kana "${a.kana}" as ${b.id} with an overlapping meaning`, a.id);
      }
    }
  }
  // kanji char unique
  const chars = new Map<string, string>();
  for (const k of ctx.kanji.values()) {
    if (typeof k.char !== 'string') continue;
    const prev = chars.get(k.char);
    if (prev) fail(ctx, ctx.ids.get(k.id) ?? '', 'V32', `kanji char "${k.char}" duplicated (${prev})`, k.id);
    else chars.set(k.char, k.id);
  }
  // kana glyph unique per script
  const glyphs = new Map<string, string>();
  for (const k of ctx.kana.values()) {
    if (typeof k.kana !== 'string') continue;
    const key = `${String(k.script)}:${k.kana}`;
    const prev = glyphs.get(key);
    if (prev) fail(ctx, ctx.ids.get(k.id) ?? '', 'V32', `kana glyph "${k.kana}" duplicated (${prev})`, k.id);
    else glyphs.set(key, k.id);
  }
  // grammar pattern duplicated → W
  const patterns = new Map<string, string>();
  for (const g of ctx.grammar.values()) {
    if (typeof g.pattern !== 'string') continue;
    const prev = patterns.get(g.pattern);
    if (prev) warn(ctx, ctx.ids.get(g.id) ?? '', 'V32', `grammar pattern "${g.pattern}" duplicated (${prev})`, g.id);
    else patterns.set(g.pattern, g.id);
  }
  checkMichikusaDuplicates(ctx);
}

/* ── V39 duplicated michikusa card ───────────────────────────────────────── */

/** Plain-text key for V39: NFKC, no spaces or Japanese punctuation, so `{箱根|はこね}{八里|はちり}` and `{箱根八里|はこねはちり}` collide. */
function michikusaTextKey(s: string): string {
  return s.normalize('NFKC').replace(/[\s、。，．・「」『』（）()〜～!?！？…]/g, '');
}

/**
 * V39 (W, information only): the same michikusa `ja` (by plain text) or `kana`
 * collected at two different stations is the same card dealt twice (a proverb at
 * both Hakone and Shimada). One warning per item naming its twins; the content is
 * kept as written and the pair goes to the human spot-check list.
 */
function checkMichikusaDuplicates(ctx: Ctx): void {
  interface Card { id: string; file: string; station: number | null; ja: string }
  const byKey = new Map<string, Card[]>();
  for (const f of ctx.files) {
    if (f.pathKind !== 'michikusa' || f.parseError) continue;
    for (const it of f.items) {
      const id = str(it['id']);
      const ja = str(it['ja']);
      if (id === undefined || ja === undefined) continue;
      const card: Card = { id, file: f.rel, station: stationNumberOf(id) ?? f.seq, ja: toPlain(ja) };
      const keys = new Set<string>();
      const plain = michikusaTextKey(card.ja);
      if (plain.length > 0) keys.add(`ja\u0000${plain}`);
      const kana = michikusaTextKey(str(it['kana']) ?? toKana(ja));
      if (kana.length > 0) keys.add(`kana\u0000${kana}`);
      for (const key of keys) {
        const arr = byKey.get(key) ?? [];
        arr.push(card);
        byKey.set(key, arr);
      }
    }
  }
  const twins = new Map<string, Set<string>>(); // id -> other ids
  const cards = new Map<string, Card>();
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    for (const a of arr) {
      for (const b of arr) {
        if (a.id === b.id || a.station === b.station) continue;
        cards.set(a.id, a);
        const set = twins.get(a.id) ?? new Set<string>();
        set.add(b.id);
        twins.set(a.id, set);
      }
    }
  }
  for (const [id, others] of twins) {
    const card = cards.get(id)!;
    warn(ctx, card.file, 'V39', `michikusa card "${card.ja}" is also collected at ${[...others].sort().join(', ')} (same ja/kana at another station; vary or move one)`, id);
  }
}

function checkKanaInventory(ctx: Ctx): void {
  let h = 0;
  let k = 0;
  for (const it of ctx.kana.values()) {
    if (it.script === 'hiragana') h++;
    else if (it.script === 'katakana') k++;
  }
  if (h !== KANA_INVENTORY.hiragana && ctx.files.some((f) => f.rel === 'kana/hiragana.json')) warn(ctx, 'kana/hiragana.json', 'V24', `corpus holds ${h} hiragana (inventory is ${KANA_INVENTORY.hiragana})`);
  if (k !== KANA_INVENTORY.katakana && ctx.files.some((f) => f.rel === 'kana/katakana.json')) warn(ctx, 'kana/katakana.json', 'V24', `corpus holds ${k} katakana (inventory is ${KANA_INVENTORY.katakana})`);
}

function checkConjugationCoverage(ctx: Ctx): void {
  const seen = new Map<string, string>();
  const heads = new Map<string, { pos: string; forms: Set<string>; file: string; id: string }>();
  for (const f of ctx.files) {
    if (f.pathKind !== 'conjugation') continue;
    for (const it of f.items) {
      const c = it as unknown as ConjugationGoldenEntry;
      if (typeof c.word !== 'string' || typeof c.form !== 'string') continue;
      const key = `${c.word}\u0000${c.form}`;
      const prev = seen.get(key);
      if (prev) fail(ctx, f.rel, 'V26', `(word, form) "${c.word}"/${c.form} duplicated (${prev})`, c.id);
      else seen.set(key, c.id);
      const hk = `${c.word}\u0000${String(c.pos)}`;
      const h = heads.get(hk) ?? { pos: String(c.pos), forms: new Set<string>(), file: f.rel, id: c.id };
      h.forms.add(c.form);
      heads.set(hk, h);
    }
  }
  for (const [hk, h] of heads) {
    const word = hk.split('\u0000')[0] ?? '';
    const applicable = h.pos === 'adj-i' || h.pos === 'adj-na' ? ADJ_FORMS : CONJ_POS.has(h.pos) ? VERB_FORMS : null;
    if (!applicable) continue;
    const exempt = DEFECTIVE_VERB_FORMS[word] ?? EMPTY_FORMS;
    const missing = [...applicable].filter((fm) => !h.forms.has(fm) && !exempt.has(fm));
    if (missing.length > 0) warn(ctx, h.file, 'V26', `head word "${word}" is missing forms: ${missing.join(', ')}`, h.id);
  }
}

const EMPTY_FORMS: ReadonlySet<string> = new Set();
/**
 * V26 defective-verb exemptions: forms these verbs lack in standard usage (or that
 * are too marginal to teach), so the coverage warning does not ask writers to invent
 * them. Keyed by the written head word (`ConjugationGoldenEntry.word`).
 */
export const DEFECTIVE_VERB_FORMS: Readonly<Record<string, ReadonlySet<string>>> = {
  // ある: no potential/volitional/passive/causative, no imperative/prohibitive, no 〜たい, no 〜ている (stative)
  'ある': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai', 'te-iru']),
  // 要る: stative "to need"; the same gaps (要れる is marginal)
  '要る': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai', 'te-iru']),
  // できる: already a potential; no second potential, no volition/command, no 〜たい
  'できる': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai']),
  '出来る': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai']),
  // 分かる: stative; 分かれる would be "to split"
  '分かる': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive']),
  'わかる': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive']),
  // spontaneous perception verbs: no potential/volition/passive/command, no 〜たい
  '見える': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai']),
  '聞こえる': new Set(['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai']),
};

/* ── V40 unlocksForms with nothing to conjugate ──────────────────────────── */

/**
 * V40 W (informational): a station's grammar declares `unlocksForms`, but the
 * cumulative vocab allowlist at that station (Stations 1–3 share the White set)
 * holds no verb for a verb form, or no adjective for an adj-* form, so Form
 * Forge has no head word to drill there. Needs bundles; never fails.
 */
function checkFormUnlocks(ctx: Ctx): void {
  if (ctx.bundles.size === 0) return;
  const bundles = [...ctx.bundles.values()].sort((a, b) => a.number - b.number);
  const counts = new Map<number, { verbs: number; adjectives: number }>();
  let verbs = 0;
  let adjectives = 0;
  for (const b of bundles) {
    for (const id of strs(b.vocabIds)) {
      const pos = ctx.vocab.get(id)?.pos;
      if (pos === 'v1' || pos === 'v5' || pos === 'v-irr') verbs++;
      else if (pos === 'adj-i' || pos === 'adj-na') adjectives++;
    }
    counts.set(b.number, { verbs, adjectives });
  }
  for (const b of bundles) {
    const c = counts.get(allowlistStationFor(b.number)) ?? counts.get(b.number);
    if (!c) continue;
    for (const id of strs(b.grammarIds)) {
      const g = ctx.grammar.get(id);
      const forms = strs(g?.unlocksForms);
      if (!g || forms.length === 0) continue;
      const file = ctx.ids.get(id) ?? `stations/${String(b.number).padStart(2, '0')}.json`;
      const verbForms = forms.filter((fm) => VERB_FORMS.has(fm));
      const adjForms = forms.filter((fm) => ADJ_FORMS.has(fm));
      if (verbForms.length > 0 && c.verbs === 0) warn(ctx, file, 'V40', `unlocksForms ${verbForms.join('/')} at Station ${b.number}, but the cumulative allowlist has no conjugable verb (v1/v5/v-irr)`, id);
      if (adjForms.length > 0 && c.adjectives === 0) warn(ctx, file, 'V40', `unlocksForms ${adjForms.join('/')} at Station ${b.number}, but the cumulative allowlist has no adjective (adj-i/adj-na)`, id);
    }
  }
}

/* ── V20 + linker ────────────────────────────────────────────────────────── */

/** The validator's view of the shared linker pool: ids → items from the loaded corpus. */
function buildPool(ctx: Ctx, vocabIds: Iterable<string>, grammarIds: Iterable<string>, plusOne: Iterable<string>, kanaStage = false): MatchPool {
  const pick = <T>(ids: Iterable<string>, m: Map<string, T>): T[] => {
    const out: T[] = [];
    for (const id of ids) {
      const v = m.get(id);
      if (v) out.push(v);
    }
    return out;
  };
  return buildMatchPool(pick(vocabIds, ctx.vocab), pick(grammarIds, ctx.grammar), pick(plusOne, ctx.vocab), { kanaStage });
}

function cum(ctx: Ctx, upTo: number, key: 'kanaIds' | 'vocabIds' | 'grammarIds'): Set<string> {
  return cumulativeIds([...ctx.bundles.values()], upTo, key);
}

/** V20 W: a story's `vocabIds` should name at least this share of the allowlisted words the linker detects in its text. */
export const VOCAB_IDS_MIN_COVERAGE = 0.6;

/**
 * An auxiliary use of an allowlisted verb (います, しまった, きた …): the token is a
 * function token, or a kana inflection of an `AUX_VERBS` lexeme. The linker links
 * it, but V20 does not ask the story to list the verb in `vocabIds` for it.
 */
function isAuxiliaryUse(ctx: Ctx, token: string, id: string): boolean {
  if (FUNCTION_TOKENS.has(token)) return true;
  if (hasKanji(token)) return false;
  const kana = str(ctx.vocab.get(id)?.kana);
  return kana !== undefined && AUX_VERBS.has(kana.replace(/^〜/, '').replace(/〜$/, ''));
}

function checkStories(ctx: Ctx): void {
  const haveBundles = ctx.bundles.size > 0;
  for (const f of ctx.files) {
    if (f.pathKind !== 'story' || f.parseError) continue;
    let changed = false;
    for (const it of f.items) {
      const s = it as unknown as StoryItem;
      if (typeof s.id !== 'string' || !Array.isArray(s.lines)) continue;
      const st = typeof s.stationId === 'string' ? stationOfId(s.stationId) : undefined;
      if (!st) continue;
      const station = st.number;
      const allowStation = allowlistStationFor(station);
      if (!haveBundles) {
        warn(ctx, f.rel, 'V20', `coverage not computed: no stations/NN.json bundles (run content:assign)`, s.id);
        continue;
      }
      const vocabAllow = cum(ctx, allowStation, 'vocabIds');
      const grammarAllow = cum(ctx, allowStation, 'grammarIds');
      const plusOneAll = new Set<string>();
      for (const ln of s.lines) if (isObject(ln as unknown as Json)) for (const p of strs(ln.plusOne)) plusOneAll.add(p);
      for (const v of strs(s.vocabIds)) if (!vocabAllow.has(v) && !plusOneAll.has(v) && ctx.vocab.has(v)) soft(ctx, f.rel, 'V20', `vocabIds "${v}" is beyond the Station ${allowStation} allowlist and not in plusOne`, s.id);
      for (const g of strs(s.grammarIds)) if (!grammarAllow.has(g) && ctx.grammar.has(g)) soft(ctx, f.rel, 'V20', `grammarIds "${g}" is beyond the Station ${allowStation} grammar allowlist`, s.id);
      const maxPlus = station <= 3 ? 6 : 3;
      if (plusOneAll.size > maxPlus) soft(ctx, f.rel, 'V20', `${plusOneAll.size} plusOne words > ${maxPlus}`, s.id);
      for (const p of plusOneAll) if (vocabAllow.has(p)) soft(ctx, f.rel, 'V20', `plusOne "${p}" is already in the allowlist`, s.id);
      const names = new Set(strs(s.names));
      const pool = buildPool(ctx, vocabAllow, grammarAllow, plusOneAll, allowStation <= 3);
      const detected = new Set<string>();
      const plusSeen = new Set<string>();
      let known = 0;
      let total = 0;
      s.lines.forEach((ln, i) => {
        if (!isObject(ln as unknown as Json)) return;
        const tokens = strs(ln.tokens);
        const linePlus = strs(ln.plusOne);
        if (linePlus.length > 1) soft(ctx, f.rel, 'V20', `lines[${i}] has ${linePlus.length} plusOne words (≤ 1 per line)`, s.id);
        const ids: (string | null)[] = [];
        let plusHits = 0;
        for (const t of tokens) {
          const m = matchToken(pool, t, names);
          if (!m.punct) {
            total++;
            if (m.known) known++;
          }
          if (m.id && pool.plusOne.has(m.id)) {
            plusHits++;
            plusSeen.add(m.id);
            if (!linePlus.includes(m.id)) soft(ctx, f.rel, 'V20', `lines[${i}] uses plusOne word ${m.id} without listing it in plusOne`, s.id);
          } else if (m.id && !isAuxiliaryUse(ctx, t, m.id)) detected.add(m.id);
          ids.push(m.id);
        }
        if (plusHits > 1) soft(ctx, f.rel, 'V20', `lines[${i}] contains ${plusHits} plusOne words (≤ 1 per line)`, s.id);
        for (const p of linePlus) {
          if (!ids.includes(p) && ctx.vocab.has(p)) soft(ctx, f.rel, 'V20', `lines[${i}].plusOne "${p}" does not appear in the line`, s.id);
        }
        // kana allowlist (Stations 1–3)
        if (station <= 3 && s.id !== 's-01-1' && typeof ln.kana === 'string') checkKanaAllowlist(ctx, f.rel, s.id, i, ln.kana, station);
        // tokenIds
        if (tokens.length > 0 && tokens.length === ids.length) {
          const existing = Array.isArray(ln.tokenIds) ? ln.tokenIds : undefined;
          const same = existing !== undefined && existing.length === ids.length && existing.every((x, j) => x === ids[j]);
          if (ctx.writeTokenIds) {
            if (!same) {
              (ln as StoryLine).tokenIds = ids;
              changed = true;
            }
            ctx.linked++;
          } else if (existing !== undefined && !same) {
            fail(ctx, f.rel, 'V19', `lines[${i}].tokenIds differs from the linker result (writer-supplied or stale; run with --fix-tokenids)`, s.id);
          }
        }
      });
      const coverage = total === 0 ? 1 : known / total;
      const target = coverageTargetFor(station, s.bridge === true);
      if (coverage < target) soft(ctx, f.rel, 'V20', `known-token coverage ${(coverage * 100).toFixed(1)} % < ${(target * 100).toFixed(0)} % (${total - known} unknown of ${total})`, s.id);
      const listed = new Set(strs(s.vocabIds));
      const detectedVocab = [...detected].filter((d) => ctx.vocab.has(d));
      for (const d of detectedVocab) if (!listed.has(d)) warn(ctx, f.rel, 'V20', `allowlisted word ${d} ("${str(ctx.vocab.get(d)?.word) ?? ''}") detected in the text but missing from vocabIds`, s.id);
      if (detectedVocab.length > 0) {
        const covered = detectedVocab.filter((d) => listed.has(d)).length;
        const share = covered / detectedVocab.length;
        if (share < VOCAB_IDS_MIN_COVERAGE) warn(ctx, f.rel, 'V20', `vocabIds covers ${covered} of ${detectedVocab.length} allowlisted words detected in the text (${Math.round(share * 100)} % < ${Math.round(VOCAB_IDS_MIN_COVERAGE * 100)} %)`, s.id);
      }
    }
    if (changed) {
      writeFileSync(f.abs, stringifyJson(f.json as unknown));
    }
  }
}

function checkKanaAllowlist(ctx: Ctx, file: string, id: string, lineIndex: number, kana: string, station: number): void {
  // glyph → station from kana items (assigned by assign-stations) or bundles
  const glyphStation = new Map<string, number>();
  for (const k of ctx.kana.values()) if (typeof k.kana === 'string' && typeof k.station === 'number') glyphStation.set(k.kana, k.station);
  if (glyphStation.size === 0) {
    for (const [n, b] of ctx.bundles) for (const kid of b.kanaIds ?? []) {
      const k = ctx.kana.get(kid);
      if (k && typeof k.kana === 'string' && !glyphStation.has(k.kana)) glyphStation.set(k.kana, n);
    }
  }
  if (glyphStation.size === 0) return;
  const cs = [...kana];
  const bad = new Set<string>();
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (/[\s　、。！？「」『』〜…・]/.test(c)) continue;
    if (c === 'っ' || c === 'ッ' || c === 'ー') {
      if (station < 2) bad.add(c);
      continue;
    }
    if (SMALL_FOLLOWERS.has(c)) continue; // handled with the preceding char
    const next = cs[i + 1];
    const digraph = next !== undefined && SMALL_FOLLOWERS.has(next) ? c + next : null;
    const stN = digraph ? glyphStation.get(digraph) : glyphStation.get(c);
    if (stN === undefined || stN > station) bad.add(digraph ?? c);
  }
  if (bad.size > 0) soft(ctx, file, 'V20', `lines[${lineIndex}] uses kana not yet taught by Station ${station}: ${[...bad].join(' ')}`, id);
}

/* ── V34 quotas ──────────────────────────────────────────────────────────── */

const LEVEL_TARGETS: Record<'vocab' | 'kanji' | 'grammar', Partial<Record<Level, number>>> = {
  vocab: { n5: 800, n4: 650, n3: 1700, n2: 1700, n1: 1500 },
  kanji: { n5: 100, n4: 200, n3: 350, n2: 350 },
  grammar: { n5: 90, n4: 90, n3: 110, n2: 90, n1: 70 },
};

function checkQuotas(ctx: Ctx): void {
  const counts = new Map<number, { vocab: number; kanji: number; grammar: number }>();
  let assigned = 0;
  const bump = (st: unknown, kind: 'vocab' | 'kanji' | 'grammar') => {
    if (typeof st !== 'number') return;
    assigned++;
    const c = counts.get(st) ?? { vocab: 0, kanji: 0, grammar: 0 };
    c[kind]++;
    counts.set(st, c);
  };
  for (const v of ctx.vocab.values()) bump(v.station, 'vocab');
  for (const k of ctx.kanji.values()) bump(k.station, 'kanji');
  for (const g of ctx.grammar.values()) bump(g.station, 'grammar');
  if (assigned === 0) {
    if (ctx.vocab.size + ctx.kanji.size + ctx.grammar.size > 0) warn(ctx, 'stations/', 'V34', 'no item carries a station yet (run content:assign); quotas not checked');
    return;
  }
  // V34 amendment (design 08 §5): `quota.stories` counts the texts without audioFirst; the pieces are V43's.
  const storyCounts = new Map<number, number>();
  for (const s of ctx.stories.values()) {
    if (s.audioFirst === true) continue;
    const n = stationOfId(String(s.stationId))?.number;
    if (n !== undefined) storyCounts.set(n, (storyCounts.get(n) ?? 0) + 1);
  }
  for (const st of STATIONS) {
    const c = counts.get(st.number) ?? { vocab: 0, kanji: 0, grammar: 0 };
    for (const kind of ['vocab', 'kanji', 'grammar'] as const) {
      const q = st.quota[kind];
      const have = c[kind];
      if (q === 0) {
        if (have > 0) soft(ctx, `stations/${String(st.number).padStart(2, '0')}.json`, 'V34', `${st.id} has ${have} ${kind} but quota is 0`);
        continue;
      }
      if (Math.abs(have - q) > q * 0.1 + 1e-9) soft(ctx, `stations/${String(st.number).padStart(2, '0')}.json`, 'V34', `${st.id} ${kind}: ${have} vs quota ${q} (±10 %)`);
    }
    const stories = storyCounts.get(st.number) ?? 0;
    if (stories !== st.quota.stories && (ctx.strict || stories > st.quota.stories)) soft(ctx, `stations/${String(st.number).padStart(2, '0')}.json`, 'V34', `${st.id} stories: ${stories} vs quota ${st.quota.stories} (texts without audioFirst)`);
  }
  // level totals
  const levelCounts: Record<'vocab' | 'kanji' | 'grammar', Map<string, number>> = { vocab: new Map(), kanji: new Map(), grammar: new Map() };
  for (const f of ctx.files) {
    if (!f.pathLevel || (f.pathKind !== 'vocab' && f.pathKind !== 'kanji' && f.pathKind !== 'grammar')) continue;
    const m = levelCounts[f.pathKind];
    m.set(f.pathLevel, (m.get(f.pathLevel) ?? 0) + f.items.length);
  }
  for (const kind of ['vocab', 'kanji', 'grammar'] as const) {
    for (const [lvl, target] of Object.entries(LEVEL_TARGETS[kind])) {
      const have = levelCounts[kind].get(lvl) ?? 0;
      if (have === 0) continue; // level not written yet
      if (Math.abs(have - target) > target * 0.1) soft(ctx, `${kind}/${lvl}/`, 'V34', `${kind} ${lvl} total ${have} vs target ${target} (±10 %)`);
    }
  }
}

/* ── V35 manifest / bundles ──────────────────────────────────────────────── */

function checkManifest(ctx: Ctx): void {
  const manifestPath = join(ctx.root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    if (ctx.strict) soft(ctx, 'manifest.json', 'V35', 'manifest.json missing (run content:index)');
    return;
  }
  let existing: ContentManifest;
  const text = readFileSync(manifestPath, 'utf8');
  try {
    existing = JSON.parse(text) as ContentManifest;
  } catch (e) {
    fail(ctx, 'manifest.json', 'V35', `invalid JSON: ${(e as Error).message}`);
    return;
  }
  if (ctx.bundles.size === 0) {
    warn(ctx, 'manifest.json', 'V35', 'manifest present but no stations/NN.json bundles');
    return;
  }
  // bundles byte-identical
  const regenerated = bundlesFromCorpus(ctx.root);
  for (const b of regenerated) {
    const rel = `stations/${String(b.number).padStart(2, '0')}.json`;
    const p = join(ctx.root, rel);
    if (!existsSync(p)) {
      soft(ctx, rel, 'V35', 'station bundle missing (run content:assign)');
      continue;
    }
    if (readFileSync(p, 'utf8') !== stringifyJson(b)) soft(ctx, rel, 'V35', 'bundle does not regenerate byte-identically (run content:assign)');
  }
  try {
    const fresh = buildIndex(ctx.root, existing.contentVersion, { generatedAt: existing.generatedAt, check: false });
    if (stringifyJson(fresh) !== text) soft(ctx, 'manifest.json', 'V35', 'manifest does not regenerate byte-identically (run content:index)');
  } catch (e) {
    soft(ctx, 'manifest.json', 'V35', `manifest cannot be rebuilt: ${(e as Error).message}`);
  }
  // A derived contentVersion must match the content on disk (the loader's Cache API mirror is keyed by it).
  if (isDerivedVersion(existing.contentVersion)) {
    const derived = deriveContentVersion(ctx.root);
    if (derived !== existing.contentVersion) soft(ctx, 'manifest.json', 'V35', `contentVersion ${existing.contentVersion} is stale: the content now hashes to ${derived} (run content:index)`);
  }
  const listed = new Set((existing.files ?? []).map((f) => f.path));
  for (const f of listContentFiles(ctx.root)) if (!listed.has(f)) soft(ctx, 'manifest.json', 'V35', `file ${f} is not listed in the manifest`);
  for (const p of listed) if (!existsSync(join(ctx.root, p))) soft(ctx, 'manifest.json', 'V35', `listed file ${p} is missing`);
  for (const [from, to] of Object.entries(existing.redirects ?? {})) {
    if (!ctx.ids.has(to)) soft(ctx, 'manifest.json', 'V35', `redirect ${from} → ${to}: target does not exist`);
  }
}

/* ── V36 J-J definitions ─────────────────────────────────────────────────── */

function checkDefinitions(ctx: Ctx): void {
  const haveBundles = ctx.bundles.size > 0;
  // The cumulative pool depends only on the station, so build it once per station.
  const pools = new Map<number, MatchPool>();
  const poolFor = (station: number): MatchPool => {
    let p = pools.get(station);
    if (!p) {
      p = buildPool(ctx, cum(ctx, station, 'vocabIds'), cum(ctx, station, 'grammarIds'), []);
      pools.set(station, p);
    }
    return p;
  };
  for (const f of ctx.files) {
    if (f.pathKind !== 'vocab') continue;
    for (const it of f.items) {
      const v = it as unknown as VocabItem;
      if (typeof v.id !== 'string' || typeof v.jlpt !== 'number') continue;
      if (v.jlpt <= 3 && v.definitionJa === undefined) {
        if (ctx.strict) soft(ctx, f.rel, 'V36', `definitionJa missing (required for jlpt ≤ 3 at release)`, v.id);
        continue;
      }
      if (!isObject(v.definitionJa as unknown as Json) || typeof v.definitionJa?.ja !== 'string') continue;
      if (!haveBundles || typeof v.station !== 'number') continue;
      const plain = toPlain(v.definitionJa.ja);
      const pool = poolFor(v.station);
      const strictSpans = unresolvedSpans(pool, plain);
      if (strictSpans.length === 0) continue;
      // F only where the pre-round-2 segmentation also failed; spans that resolve solely by letting a
      // single-kanji stem swallow the next kanji (薄暗い ← 薄い, 意外 ← 意, 見抜く ← 見る) are a W: the
      // definition most likely uses a compound outside the allowlist, but that is a content call, not a gate.
      const unknown = unresolvedSpans(pool, plain, true);
      if (unknown.length > 0) soft(ctx, f.rel, 'V36', `definitionJa uses words outside the Station ${v.station} allowlist: ${unknown.join(' ')}`, v.id);
      const viaStem = strictSpans.filter((s) => !unknown.includes(s));
      if (viaStem.length > 0) warn(ctx, f.rel, 'V36', `definitionJa resolves ${viaStem.map((s) => `"${s}"`).join(' ')} only by letting a single-kanji verb/adjective stem swallow the next kanji (likely a compound outside the Station ${v.station} allowlist)`, v.id);
    }
  }
}

/** Every surface the pool can match (exact, inflected forms, stems, hints, function tokens), bucketed by first code unit, longest first. */
const surfaceIndexCache = new WeakMap<MatchPool, Map<string, string[]>>();
const oneCharStemCache = new WeakMap<MatchPool, Set<string>>();
function surfaceIndex(pool: MatchPool): Map<string, string[]> {
  let idx = surfaceIndexCache.get(pool);
  if (idx) return idx;
  idx = new Map();
  const all = new Set<string>([...pool.exact.keys(), ...pool.forms.keys(), ...pool.prefixes.map((p) => p.s), ...pool.hints.map((h) => h.h), ...FUNCTION_TOKENS]);
  // Single-kanji stems (有 ← 有る) are kept apart: they resolve only before okurigana (`stemApplies`).
  const stems = new Set<string>();
  for (const p of pool.prefixes) if (p.s.length === 1 && !pool.exact.has(p.s)) stems.add(p.s);
  oneCharStemCache.set(pool, stems);
  for (const s of all) {
    if (!s) continue;
    const bucket = idx.get(s.charAt(0)) ?? [];
    bucket.push(s);
    idx.set(s.charAt(0), bucket);
  }
  for (const bucket of idx.values()) bucket.sort((a, b) => b.length - a.length);
  surfaceIndexCache.set(pool, idx);
  return idx;
}

const UNRESOLVED_SPAN_RE = /[㐀-䶿一-鿿々〆ァ-ヺ]/;
const HIRAGANA_OR_BAR_RE = /[ぁ-ゖー]/;

/**
 * Greedy longest-match segmentation of plain text; returns spans with kanji/katakana that resolve to nothing.
 * A single-kanji stem (有 ← 有る) resolves only before okurigana (`stemApplies`); `lenient` lets it absorb any
 * following kanji — the pre-round-2 behaviour, kept so that V36 can report the difference as a warning.
 */
function unresolvedSpans(pool: MatchPool, plain: string, lenient = false): string[] {
  const idx = surfaceIndex(pool);
  const stems = lenient ? new Set<string>() : (oneCharStemCache.get(pool) ?? new Set<string>());
  const out: string[] = [];
  let pending = '';
  const flush = () => {
    if (pending && UNRESOLVED_SPAN_RE.test(pending)) out.push(pending);
    pending = '';
  };
  let off = 0;
  while (off < plain.length) {
    const bucket = idx.get(plain.charAt(off));
    let hit: string | null = null;
    if (bucket) {
      for (const s of bucket) {
        if (plain.startsWith(s, off) && (!stems.has(s) || stemApplies(s, plain.slice(off)))) {
          hit = s;
          break;
        }
      }
    }
    if (hit) {
      flush();
      off += hit.length;
      continue;
    }
    const c = String.fromCodePoint(plain.codePointAt(off) as number);
    if (PUNCT_TOKEN_RE.test(c) || HIRAGANA_OR_BAR_RE.test(c)) {
      flush();
    } else pending += c;
    off += c.length;
  }
  flush();
  return out;
}

/* ── V43 / V45 / V42 corpus-wide — listening quota, minutes band, unused cast ── */

/**
 * Target speech length of one piece per belt in seconds (design 08 §3 "Length" column: ≤ 60 s Yellow,
 * ≤ 90 s Orange, ≤ 2 min Green, ≤ 3 min Blue and Purple, ≤ 4 min Brown, ≤ 5 min Black; 0 = no pieces).
 * 2 pieces × these over Stations 4–53 ≈ 284 min, the ≈ 4.7 h of design 08 §2. V45's band for a station is
 * its pieces × the belt target, ±30 %.
 */
export const PIECE_TARGET_SECONDS: Record<Belt, number> = { white: 0, yellow: 60, orange: 90, green: 120, blue: 180, purple: 180, brown: 240, black: 300 };

const KANA_CHAR_RE = /[ぁ-ゖァ-ヺー]/gu;

/** Speech estimate of one line (design 08 §2, `scripts/listening-report.ts`): kana chars ÷ 7 s + 0.5 s. */
export function speechSeconds(kana: string): number {
  return (kana.match(KANA_CHAR_RE)?.length ?? 0) / 7 + 0.5;
}

/** Σ speech estimate over a text's lines (design 08 §2 estimate; V45). */
export function textSpeechSeconds(lines: readonly StoryLine[]): number {
  let s = 0;
  for (const ln of lines) if (isObject(ln as unknown as Json) && typeof ln.kana === 'string') s += speechSeconds(ln.kana);
  return s;
}

function listeningFileFor(st: StationDef): string {
  return `stories/${stationLevel(st)}/listening-s${String(st.number).padStart(2, '0')}.json`;
}

function checkListening(ctx: Ctx): void {
  const pieces = new Map<number, StoryItem[]>();
  let total = 0;
  for (const s of ctx.stories.values()) {
    if (s.audioFirst !== true) continue;
    const n = stationOfId(String(s.stationId))?.number;
    if (n === undefined) continue;
    total++;
    const arr = pieces.get(n) ?? [];
    arr.push(s);
    pieces.set(n, arr);
  }
  // V43 per-station count (design 08 §5 "F at release, W before"): every station off quota is listed, under or over,
  // with or without --strict; F only with --strict --listening-release. While no piece exists at all (Pass 4 not
  // started) the list would be 50 identical rows, so strict mode notes it once and plain mode stays silent.
  if (total === 0) {
    if (ctx.strict) warn(ctx, 'stories/', 'V43', 'no audioFirst piece in the corpus yet (Pass 4): quota.listening not checked');
  } else {
    const report = atRelease(ctx);
    for (const st of STATIONS) {
      const have = pieces.get(st.number)?.length ?? 0;
      const q = st.quota.listening;
      if (have !== q) report(ctx, listeningFileFor(st), 'V43', `${st.id} listening pieces: ${have} vs quota.listening ${q}`);
    }
  }
  // V45 minutes band (W)
  for (const [n, arr] of pieces) {
    const st = STATIONS[n - 1];
    if (!st) continue;
    const target = PIECE_TARGET_SECONDS[st.belt];
    if (target === 0) continue;
    const sum = arr.reduce((a, s) => a + textSpeechSeconds(Array.isArray(s.lines) ? s.lines : []), 0);
    const band = arr.length * target;
    if (sum < band * 0.7 || sum > band * 1.3) {
      warn(ctx, listeningFileFor(st), 'V45', `${st.id} pieces speak ≈ ${Math.round(sum)} s, outside ±30 % of the ${st.belt} band (${arr.length} × ${target} s = ${band} s; kana chars ÷ 7 + 0.5 s per line)`);
    }
  }
  // V42 W: a cast entry no text uses
  if (ctx.cast !== null) {
    for (const name of [...ctx.cast].sort()) if (!ctx.castUsed.has(name)) warn(ctx, ctx.castFile, 'V42', `cast entry "${name}" is used by no text`);
  }
}

/* ── V46 own-station all-known example ───────────────────────────────────── */

/**
 * V46 (design 08 §5): every vocab item has ≥ 1 example whose content tokens all link inside the cumulative
 * allowlist ≤ the item's station — the sentence the listening pool (§4) can serve as i+0 at the station
 * the word is learned. The arbiter is the pool builder's own linker (`scripts/linker.ts linkSentence`,
 * `unknown === 0` against the same cumulative pool `buildPools` links an example against first), so an
 * item that passes here always has a ref in its own station's `listening/pool-NN.json`; the message lists
 * the unknown tokens per example. W during Pass 4b; F for Stations 4–15 with `--strict --listening-release`.
 * Needs bundles (silent without them, like V36 / V40).
 */
function checkOwnStationExamples(ctx: Ctx): void {
  if (ctx.bundles.size === 0) return;
  const pools = new Map<number, MatchPool>();
  const poolFor = (station: number): MatchPool => {
    let p = pools.get(station);
    if (!p) {
      p = buildPool(ctx, cum(ctx, station, 'vocabIds'), cum(ctx, station, 'grammarIds'), [], station <= 3);
      pools.set(station, p);
    }
    return p;
  };
  for (const f of ctx.files) {
    if (f.pathKind !== 'vocab' || f.parseError) continue;
    for (const it of f.items) {
      const v = it as unknown as VocabItem;
      if (typeof v.id !== 'string' || typeof v.station !== 'number') continue;
      const examples = Array.isArray(v.examples) ? v.examples : [];
      const plains = examples.filter((ex) => isObject(ex as unknown as Json) && typeof ex.ja === 'string').map((ex) => toPlain(ex.ja));
      if (plains.length === 0) continue;
      const pool = poolFor(allowlistStationFor(v.station));
      const links = plains.map((p) => linkSentence(pool, p));
      if (links.some((l) => l.unknown === 0)) continue;
      const report = v.station >= 4 && v.station <= 15 ? atRelease(ctx) : warn;
      const detail = links.map((l, i) => `examples[${i}]: ${l.unknownTokens.join(' ')}`).join('; ');
      report(ctx, f.rel, 'V46', `no example links fully inside the Station ${v.station} allowlist (own-station all-known example for the listening pool, Pass 4b) — ${detail}`, v.id);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Report                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export function formatReport(result: ValidateResult, root: string, perRuleCap = 40): string {
  const lines: string[] = [];
  const all = [...result.failures.map((f) => ({ ...f, sev: 'F' as const })), ...result.warnings.map((w) => ({ ...w, sev: 'W' as const }))];
  const byFile = new Map<string, typeof all>();
  for (const x of all) {
    const arr = byFile.get(x.file) ?? [];
    arr.push(x);
    byFile.set(x.file, arr);
  }
  const shown = new Map<string, number>();
  const suppressed = new Map<string, number>();
  lines.push(`content root: ${root}`);
  for (const [file, arr] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rows: string[] = [];
    for (const x of arr) {
      const key = `${x.sev}${x.rule}`;
      const n = shown.get(key) ?? 0;
      // The cap applies per severity and rule (a V46 sweep over the corpus is ≈ 1,200 warnings); `--json` holds every row.
      if (n >= perRuleCap) {
        suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
        continue;
      }
      shown.set(key, n + 1);
      rows.push(`  ${x.sev} ${x.rule} ${x.id ? `${x.id}  ` : ''}${x.message}`);
    }
    if (rows.length > 0) {
      lines.push(file);
      lines.push(...rows);
    }
  }
  for (const [key, n] of [...suppressed.entries()].sort()) lines.push(`… ${n} more ${key.slice(1)} ${key.startsWith('F') ? 'failures' : 'warnings'} not shown (cap ${perRuleCap} per rule; --json lists them all)`);
  const byRule = new Map<string, number>();
  for (const f of result.failures) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  if (byRule.size > 0) lines.push(`failures by rule: ${[...byRule.entries()].sort().map(([r, n]) => `${r}=${n}`).join(' ')}`);
  lines.push(
    `TOTAL: ${result.failures.length} failure${result.failures.length === 1 ? '' : 's'}, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'} in ${result.files} file${result.files === 1 ? '' : 's'}; bundles ${result.bundles ? 'present' : 'absent'}; linked ${result.linked} line${result.linked === 1 ? '' : 's'}`,
  );
  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CLI                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

interface CliArgs {
  strict: boolean;
  json: boolean;
  only?: string;
  fixTokenIds: boolean;
  root?: string;
  cast?: string;
  listeningRelease: boolean;
}

const USAGE =
  'usage: node scripts/validate-content.ts [--strict] [--json] [--only <glob-or-path>] [--fix-tokenids] [--root <dir>] [--cast <path>] [--listening-release]\n';

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { strict: false, json: false, fixTokenIds: false, listeningRelease: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--strict') out.strict = true;
    else if (a === '--json') out.json = true;
    else if (a === '--fix-tokenids') out.fixTokenIds = true;
    else if (a === '--listening-release') out.listeningRelease = true;
    else if (a === '--only') out.only = argv[++i];
    else if (a.startsWith('--only=')) out.only = a.slice(7);
    else if (a === '--root') out.root = argv[++i];
    else if (a.startsWith('--root=')) out.root = a.slice(7);
    else if (a === '--cast') out.cast = argv[++i];
    else if (a.startsWith('--cast=')) out.cast = a.slice(7);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(args.root ?? join(here, '..', 'public', 'content'));
  const opts: ValidateOptions = { strict: args.strict, fixTokenIds: args.fixTokenIds, listeningRelease: args.listeningRelease };
  if (args.only !== undefined) opts.only = args.only;
  if (args.cast !== undefined) opts.cast = args.cast;
  const result = validate(root, opts);
  if (args.json) {
    process.stdout.write(JSON.stringify({ failures: result.failures, warnings: result.warnings, linked: result.linked, files: result.files, bundles: result.bundles }, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(result, root) + '\n');
  }
  // exitCode, not exit(): a large report piped to another process (`--json | jq`) must drain first.
  process.exitCode = result.failures.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
