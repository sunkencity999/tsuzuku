/**
 * TSUZUKU — listening report (design 08 §2, §4, §12): what the listening pools
 * hold, station by station, and the hours the audio pack would carry.
 *
 *   node scripts/listening-report.ts [--root <content dir>] [--out <docs/listening-report.md>] [--json]
 *
 * Reads `public/content` (items, stories, the committed `stations/NN.json`
 * bundles) and regenerates the pools in memory (`buildPools`, the same call
 * `content:assign` writes from), so the report never disagrees with
 * `listening/pool-NN.json`. It writes `docs/listening-report.md` (byte-stable:
 * no timestamps, every number derived from the content) and, with `--json`,
 * prints the same data to stdout for the Pass 4b writers and the docs owner.
 *
 * Sections: (1) per station — the station's own pool (stories · grammar ·
 * vocab refs, minutes), i+0 = every ref in the pools ≤ the station, i+1 =
 * every later ref with exactly one id beyond the station (a build-time
 * ceiling: at runtime `selectPool` applies the learner's live known set), and
 * the own-station share of vocab examples (the V46 census: all-known examples
 * / examples of the station's items; `itemsWithout` per station is the count
 * Pass 4b drives to 0) and the serialised file size against the 256 KiB pool
 * budget (`POOL_FILE_BUDGET_BYTES`, hard); (2) the hours tables of design 08 §2 —
 * mined sentences, pieces, drill clips, the natural-slow takes and the render
 * tiers at 3.46 KB/s; (3) the authentic inventory of §12 (bridge texts, the
 * casual non-bridge dialogues from Station 10, authentic pieces) with the
 * reachable figure; (4) the segmenter's calibration against the stories' own
 * `tokenIds`; (5) the never-all-known vocab examples (rewrite candidates) and
 * the items without an own-station example; (6) grammar examples and story
 * lines outside every pool.
 *
 * Speech estimate: morae ÷ 7 s + 0.5 s per clip (`speechSecondsFor`; the
 * runtime's `poolMinutes` uses the same constants). A collocation has no kana
 * field, so its morae are estimated as kana characters + 2 per kanji.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isAuthenticText, STATIONS } from '../src/content/types.ts';
import type { Belt, KanaItem, KanjiItem, ListeningPool, MichikusaItem, StationBundle, StoryItem } from '../src/content/types.ts';
import { toPlain } from '../src/content/ruby.ts';
import { POOL_FILE_BUDGET_BYTES } from './build-content-index.ts';
import { buildPools, linkSentence, matchToken, plusOneIdsOf, readContentItems, readPoolCorpus, sentenceMorae, speechSecondsFor, stationPools, stringifyPool } from './linker.ts';
import type { PoolCorpus, PoolVerdict } from './linker.ts';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants (design 08 §2, §12)                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Opus 24 kbps mono, measured (design 08 §2). */
export const KB_PER_SECOND = 3.46;
/** Natural-slow second take of every sentence clip of Stations 1–17 (design 08 §7 step 4). */
export const SLOW_TAKE_UP_TO_STATION = 17;
/** Pieces take a slow take through Orange (design 08 §2 "pieces incl. their Yellow–Orange slow takes"). */
export const PIECE_SLOW_UP_TO_STATION = 15;
/** An Arena set runs ≈ 2.5× the speech length (design 08 §12). */
export const ARENA_SET_FACTOR = 2.5;
/** Two Radio re-hearings at ≥ 1.0× with the gist question (design 08 §12). */
export const RADIO_REHEARINGS = 2;
/** Casual non-bridge dialogues count as authentic from this station (design 08 §12). */
export const CASUAL_FROM_STATION = 10;

/* ────────────────────────────────────────────────────────────────────────── */
/* Data                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Clips {
  count: number;
  hours: number;
}

export interface StationRow {
  station: number;
  belt: Belt;
  /** The station's own pool (`bytes` = the serialised `pool-NN.json`, against `budget.bytes`). */
  own: { refs: number; stories: number; grammar: number; vocab: number; minutes: number; bytes: number };
  /** Every ref in the pools ≤ the station. */
  i0: { refs: number; minutes: number };
  /** Every later ref with exactly one id beyond the station. */
  i1: { refs: number; minutes: number };
  /** Own-station vocab examples: all-known at the station / all examples of the station's items; items without one. */
  examples: { allKnown: number; total: number; items: number; itemsWithout: number };
}

export interface SentenceRow {
  ref: string;
  station: number;
  plain: string;
  unknown: string[];
}

export interface ItemRow {
  id: string;
  word: string;
  station: number;
  examples: SentenceRow[];
}

export interface HoursData {
  mined: {
    vocabInPools: Clips;
    vocabAll: Clips;
    grammarInPools: Clips;
    grammarAll: Clips;
    storyLinesInPools: Clips;
    storyLinesAll: Clips;
    michikusaQuotes: Clips;
    /** pool vocab + every grammar example + every story line of the texts + michikusa quotes (design 08 §2 row 1) */
    connectedHours: number;
  };
  pieces: Clips & { texts: number };
  drills: {
    words: Clips;
    kanjiWords: Clips & { reused: number };
    kana: Clips;
    collocations: Clips;
    pitchGa: Clips;
    definitionJa: Clips;
    totalHours: number;
  };
  slowTakes: { storyLines: Clips; grammar: Clips; poolVocab: Clips; pieces: Clips; totalHours: number };
  distinct: { connected: number; drills: number; total: number };
  renderedHours: number;
  tiers: { core: { hours: number; mb: number }; pool: { hours: number; mb: number }; ear: { hours: number; mb: number }; totalMb: number };
}

export interface AuthenticData {
  bridgeTexts: Clips;
  casualDialogues: Clips;
  authenticPieces: Clips;
  distinctHours: number;
  arenaHours: number;
  radioHours: number;
  reachableHours: number;
}

export interface CalibrationData {
  lines: number;
  /** Lines whose all-known verdict (every token known) agrees with the story's own `tokenIds` + matcher. */
  verdictAgreement: number;
  /** Lines whose linked id set equals the story's non-null `tokenIds`. */
  idSetAgreement: number;
  /** The same over vocab ids only. */
  vocabIdAgreement: number;
}

export interface ReportData {
  schema: 'tsuzuku.listening-report/1';
  contentVersion: string | null;
  basis: string;
  stations: StationRow[];
  totals: { refs: number; stories: number; grammar: number; vocab: number; minutes: number };
  /** The per-file budget (`POOL_FILE_BUDGET_BYTES` = 256 KiB, a HARD limit: `content:index` fails over it) and the pools over it (empty on a tree `content:all` accepted). */
  budget: { bytes: number; over: { station: number; bytes: number; refs: number }[] };
  hours: HoursData;
  authentic: AuthenticData;
  calibration: CalibrationData;
  /** Vocab examples in no pool (an unknown token against the whole corpus): the Pass 4b rewrite candidates. */
  neverAllKnown: SentenceRow[];
  /** Vocab items with no example all-known at their own station (the V46 list), with every example's unknown tokens. Per station, `stations[].examples.itemsWithout` is the V46 census (the count Pass 4b drives to 0 for Stations 4–15). */
  itemsWithoutOwnExample: ItemRow[];
  grammarOutside: SentenceRow[];
  storyLinesOutside: SentenceRow[];
}

export interface Report {
  data: ReportData;
  pools: ListeningPool[];
  verdicts: PoolVerdict[];
  /** The corpus the report was built from (one read, so a test compares against the same files). */
  corpus: PoolCorpus;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Build                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The committed `stations/NN.json` bundles (every station that has one). */
export function readBundles(root: string): StationBundle[] {
  root = resolve(root);
  const out: StationBundle[] = [];
  for (const st of STATIONS) {
    const p = join(root, 'stations', `${pad2(st.number)}.json`);
    if (!existsSync(p)) continue;
    try {
      const b = JSON.parse(readFileSync(p, 'utf8')) as StationBundle;
      if (b.schema === 'tsuzuku.station/1') out.push(b);
    } catch {
      /* unreadable bundle: skipped */
    }
  }
  return out;
}

const KANA_CHAR_RE = /[ぁ-ゖァ-ヺー]/gu;
const KANJI_CHAR_RE = /[㐀-䶿一-鿿々〆]/gu;

/** Morae of a plain string without a kana field (collocations): kana characters + 2 per kanji. */
export function estimateMorae(plain: string): number {
  return (plain.match(KANA_CHAR_RE)?.length ?? 0) + 2 * (plain.match(KANJI_CHAR_RE)?.length ?? 0);
}

function hoursOf(moraeList: readonly number[]): number {
  let s = 0;
  for (const m of moraeList) s += speechSecondsFor(m);
  return s / 3600;
}

function clips(moraeList: readonly number[]): Clips {
  return { count: moraeList.length, hours: hoursOf(moraeList) };
}

function stationOfText(s: StoryItem): number | null {
  const m = /^st-(\d{2})$/.exec(String(s.stationId));
  return m ? Number(m[1]) : null;
}

function lineMorae(s: StoryItem): number[] {
  return (Array.isArray(s.lines) ? s.lines : []).map((ln) => sentenceMorae(typeof ln?.kana === 'string' ? ln.kana : ''));
}

function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * The calibration of the segmenter against the stories' own `tokenIds` (the
 * texts; pieces excluded), each line linked against the pool `linkStories`
 * linked its text against (the cumulative allowlist + the text's plusOne
 * words). The pools themselves take story lines by their `tokenIds`, so this
 * is a report on the segmenter the EXAMPLE sentences are judged by, not on
 * what enters the pools.
 */
export function calibrate(corpus: PoolCorpus, bundles: readonly StationBundle[]): CalibrationData {
  const poolFor = stationPools(bundles, corpus);
  let lines = 0;
  let verdict = 0;
  let idSet = 0;
  let vocabIds = 0;
  for (const s of corpus.stories) {
    if (s.audioFirst) continue;
    const n = stationOfText(s);
    if (n === null || !Array.isArray(s.lines)) continue;
    const names: ReadonlySet<string> = new Set(Array.isArray(s.names) ? s.names.filter((x): x is string => typeof x === 'string') : []);
    const pool = poolFor(n, plusOneIdsOf(s));
    for (const ln of s.lines) {
      if (!ln || !Array.isArray(ln.tokens) || !Array.isArray(ln.tokenIds) || ln.tokenIds.length !== ln.tokens.length || typeof ln.ja !== 'string') continue;
      lines++;
      const want = [...new Set(ln.tokenIds.filter((x): x is string => typeof x === 'string'))].sort();
      const r = linkSentence(pool, toPlain(ln.ja), names);
      const got = [...r.ids].sort();
      const storyKnown = ln.tokens.every((t, j) => ln.tokenIds![j] !== null || (typeof t === 'string' && matchToken(pool, t, names).known));
      if (storyKnown === (r.unknown === 0)) verdict++;
      if (want.join(' ') === got.join(' ')) idSet++;
      if (want.filter((x) => x.startsWith('v-')).join(' ') === got.filter((x) => x.startsWith('v-')).join(' ')) vocabIds++;
    }
  }
  return { lines, verdictAgreement: lines ? round(verdict / lines, 4) : 0, idSetAgreement: lines ? round(idSet / lines, 4) : 0, vocabIdAgreement: lines ? round(vocabIds / lines, 4) : 0 };
}

/** Builds the report from the content root (pools regenerated in memory; nothing written). */
export function buildReport(root: string): Report {
  root = resolve(root);
  const bundles = readBundles(root);
  const corpus = readPoolCorpus(root);
  const kanji = readContentItems<KanjiItem>(root, 'kanji');
  const kana = readContentItems<KanaItem>(root, 'kana');
  const michikusa = readContentItems<MichikusaItem>(root, 'michikusa');
  const { pools, verdicts } = buildPools(root, bundles, corpus);
  const poolFor = stationPools(bundles, corpus);
  const vocabById = new Map(corpus.vocab.map((v) => [v.id, v]));
  const stationOfId = new Map<string, number>();
  for (const b of bundles) {
    for (const id of b.vocabIds ?? []) stationOfId.set(id, b.number);
    for (const id of b.grammarIds ?? []) stationOfId.set(id, b.number);
  }
  const minutesOf = (refs: readonly { morae: number }[]) => refs.reduce((s, r) => s + speechSecondsFor(r.morae), 0) / 60;

  // ── per station ──
  const allRefs = pools.flatMap((p) => p.refs.map((r) => ({ ...r, station: p.station })));
  const stations: StationRow[] = [];
  for (const p of pools) {
    const def = STATIONS[p.station - 1];
    if (!def) continue;
    const own = p.refs;
    const i0 = allRefs.filter((r) => r.station <= p.station);
    const i1 = allRefs.filter((r) => r.station > p.station && r.ids.filter((id) => (stationOfId.get(id) ?? 0) > p.station).length === 1);
    const exVerdicts = verdicts.filter((v) => v.ref.startsWith('v-') && v.station === p.station);
    const items = new Map<string, boolean>();
    for (const v of exVerdicts) {
      const id = v.ref.split('#')[0]!;
      items.set(id, (items.get(id) ?? false) || v.ownStation);
    }
    stations.push({
      station: p.station,
      belt: def.belt,
      own: {
        refs: own.length,
        stories: own.filter((r) => r.ref.startsWith('s-')).length,
        grammar: own.filter((r) => r.ref.startsWith('g-')).length,
        vocab: own.filter((r) => r.ref.startsWith('v-')).length,
        minutes: round(minutesOf(own), 1),
        bytes: Buffer.byteLength(stringifyPool(p), 'utf8'),
      },
      i0: { refs: i0.length, minutes: round(minutesOf(i0), 1) },
      i1: { refs: i1.length, minutes: round(minutesOf(i1), 1) },
      examples: { allKnown: exVerdicts.filter((v) => v.ownStation).length, total: exVerdicts.length, items: items.size, itemsWithout: [...items.values()].filter((ok) => !ok).length },
    });
  }
  const totals = {
    refs: allRefs.length,
    stories: allRefs.filter((r) => r.ref.startsWith('s-')).length,
    grammar: allRefs.filter((r) => r.ref.startsWith('g-')).length,
    vocab: allRefs.filter((r) => r.ref.startsWith('v-')).length,
    minutes: round(minutesOf(allRefs), 1),
  };
  const budget = { bytes: POOL_FILE_BUDGET_BYTES, over: stations.filter((s) => s.own.bytes > POOL_FILE_BUDGET_BYTES).map((s) => ({ station: s.station, bytes: s.own.bytes, refs: s.own.refs })) };

  // ── hours (design 08 §2) ──
  const vocabV = verdicts.filter((v) => v.ref.startsWith('v-'));
  const grammarV = verdicts.filter((v) => v.ref.startsWith('g-'));
  const texts = corpus.stories.filter((s) => !s.audioFirst);
  const pieces = corpus.stories.filter((s) => s.audioFirst === true);
  const storyV = verdicts.filter((v) => v.ref.startsWith('s-'));
  const pieceIds = new Set(pieces.map((s) => s.id));
  const textLineV = storyV.filter((v) => !pieceIds.has(v.ref.split('#')[0]!));
  const vocabInPools = clips(vocabV.filter((v) => v.knownAt !== null).map((v) => v.morae));
  const vocabAll = clips(vocabV.map((v) => v.morae));
  const grammarInPools = clips(grammarV.filter((v) => v.knownAt !== null).map((v) => v.morae));
  const grammarAll = clips(grammarV.map((v) => v.morae));
  const storyLinesInPools = clips(textLineV.filter((v) => v.knownAt !== null).map((v) => v.morae));
  const storyLinesAll = clips(texts.flatMap(lineMorae));
  const michikusaQuotes = clips(michikusa.filter((m) => typeof m.ja === 'string' && typeof m.kana === 'string').map((m) => sentenceMorae(m.kana as string)));
  const pieceLines = clips(pieces.flatMap(lineMorae));
  const wordMorae = corpus.vocab.map((v) => sentenceMorae(typeof v.kana === 'string' ? v.kana : ''));
  const vocabWords = new Set(corpus.vocab.map((v) => `${v.word}\u0000${v.kana}`));
  const kanjiExamples = kanji.flatMap((k) => (Array.isArray(k.examples) ? k.examples : [])).filter((e) => e && typeof e.kana === 'string');
  const kanjiNet = kanjiExamples.filter((e) => !vocabWords.has(`${e.word}\u0000${e.kana}`));
  const kanaMorae = kana.flatMap((k) => [sentenceMorae(typeof k.kana === 'string' ? k.kana : ''), sentenceMorae(typeof k.exampleWord?.kana === 'string' ? k.exampleWord.kana : '')]);
  const collocations = corpus.vocab.flatMap((v) => (Array.isArray(v.collocations) ? v.collocations : [])).filter((c): c is string => typeof c === 'string');
  const pitchGa = corpus.vocab.filter((v) => v.pitchConfidence === 'high').map((v) => sentenceMorae(typeof v.kana === 'string' ? v.kana : '') + 1);
  const defs = corpus.vocab.filter((v) => v.definitionJa && typeof v.definitionJa.kana === 'string').map((v) => sentenceMorae(v.definitionJa!.kana));
  const drills = {
    words: clips(wordMorae),
    kanjiWords: { ...clips(kanjiNet.map((e) => sentenceMorae(e.kana))), reused: kanjiExamples.length - kanjiNet.length },
    kana: clips(kanaMorae),
    collocations: clips(collocations.map(estimateMorae)),
    pitchGa: clips(pitchGa),
    definitionJa: clips(defs),
    totalHours: 0,
  };
  drills.totalHours = drills.words.hours + drills.kanjiWords.hours + drills.kana.hours + drills.collocations.hours + drills.pitchGa.hours + drills.definitionJa.hours;
  const slowStory = clips(texts.filter((s) => (stationOfText(s) ?? 99) <= SLOW_TAKE_UP_TO_STATION).flatMap(lineMorae));
  const slowGrammar = clips(grammarV.filter((v) => v.station <= SLOW_TAKE_UP_TO_STATION).map((v) => v.morae));
  const slowPoolVocab = clips(vocabV.filter((v) => v.knownAt !== null && v.knownAt >= 4 && v.knownAt <= SLOW_TAKE_UP_TO_STATION).map((v) => v.morae));
  const slowPieces = clips(pieces.filter((s) => (stationOfText(s) ?? 99) <= PIECE_SLOW_UP_TO_STATION).flatMap(lineMorae));
  const slowTakes = { storyLines: slowStory, grammar: slowGrammar, poolVocab: slowPoolVocab, pieces: slowPieces, totalHours: slowStory.hours + slowGrammar.hours + slowPoolVocab.hours + slowPieces.hours };
  const connectedHours = vocabInPools.hours + grammarAll.hours + storyLinesAll.hours + michikusaQuotes.hours + pieceLines.hours;
  const distinct = { connected: connectedHours, drills: drills.totalHours, total: connectedHours + drills.totalHours };
  const mb = (hours: number) => round((hours * 3600 * KB_PER_SECOND) / 1024, 1);
  const coreHours = storyLinesAll.hours + pieceLines.hours + drills.words.hours + drills.kanjiWords.hours + drills.kana.hours + grammarAll.hours + michikusaQuotes.hours + slowStory.hours + slowGrammar.hours + slowPieces.hours;
  const poolHours = vocabInPools.hours + slowPoolVocab.hours;
  const earHours = drills.collocations.hours + drills.pitchGa.hours + drills.definitionJa.hours;
  const hours: HoursData = {
    mined: { vocabInPools, vocabAll, grammarInPools, grammarAll, storyLinesInPools, storyLinesAll, michikusaQuotes, connectedHours: round(vocabInPools.hours + grammarAll.hours + storyLinesAll.hours + michikusaQuotes.hours, 2) },
    pieces: { ...pieceLines, texts: pieces.length },
    drills,
    slowTakes,
    distinct,
    renderedHours: distinct.total + slowTakes.totalHours,
    tiers: { core: { hours: coreHours, mb: mb(coreHours) }, pool: { hours: poolHours, mb: mb(poolHours) }, ear: { hours: earHours, mb: mb(earHours) }, totalMb: mb(coreHours + poolHours + earHours) },
  };

  // ── authentic inventory (design 08 §12) ──
  const bridgeTexts = texts.filter((s) => s.bridge === true);
  const casual = texts.filter((s) => s.kind === 'dialogue' && s.register === 'casual' && !s.bridge && (stationOfText(s) ?? 0) >= CASUAL_FROM_STATION);
  const authPieces = pieces.filter(isAuthenticText);
  const inv = (list: StoryItem[]): Clips => ({ count: list.length, hours: hoursOf(list.flatMap(lineMorae)) });
  const bridge = inv(bridgeTexts);
  const casualC = inv(casual);
  const authC = inv(authPieces);
  const distinctHours = bridge.hours + casualC.hours + authC.hours;
  const authentic: AuthenticData = {
    bridgeTexts: bridge,
    casualDialogues: casualC,
    authenticPieces: authC,
    distinctHours,
    arenaHours: distinctHours * ARENA_SET_FACTOR,
    radioHours: distinctHours * RADIO_REHEARINGS,
    reachableHours: distinctHours * (ARENA_SET_FACTOR + RADIO_REHEARINGS),
  };

  // ── lists ──
  const row = (v: PoolVerdict): SentenceRow => ({ ref: v.ref, station: v.station, plain: v.plain, unknown: v.unknownTokens });
  const neverAllKnown = vocabV.filter((v) => v.knownAt === null).map(row);
  const byItem = new Map<string, PoolVerdict[]>();
  for (const v of vocabV) {
    const id = v.ref.split('#')[0]!;
    const arr = byItem.get(id) ?? [];
    arr.push(v);
    byItem.set(id, arr);
  }
  const itemsWithoutOwnExample: ItemRow[] = [];
  for (const [id, vs] of byItem) {
    if (vs.some((v) => v.ownStation)) continue;
    const item = vocabById.get(id);
    itemsWithoutOwnExample.push({
      id,
      word: item?.word ?? '',
      station: vs[0]!.station,
      // each example's unknown tokens against the item's own station (the V46 message)
      examples: vs.map((v) => ({ ref: v.ref, station: v.station, plain: v.plain, unknown: v.unknownTokens.length > 0 ? v.unknownTokens : linkSentence(poolFor(v.station), v.plain).unknownTokens })),
    });
  }
  itemsWithoutOwnExample.sort((a, b) => a.station - b.station || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const grammarOutside = grammarV.filter((v) => v.knownAt === null).map(row);
  const storyLinesOutside = storyV.filter((v) => v.knownAt === null).map(row);

  let contentVersion: string | null = null;
  try {
    const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { contentVersion?: unknown };
    if (typeof m.contentVersion === 'string') contentVersion = m.contentVersion;
  } catch {
    contentVersion = null;
  }
  const data: ReportData = {
    schema: 'tsuzuku.listening-report/1',
    contentVersion,
    basis: `speech estimate = morae ÷ 7 s + 0.5 s per clip (morae = kana characters with small kana folded; a collocation's morae are estimated as kana characters + 2 per kanji); bytes at ${KB_PER_SECOND} KB/s (Opus 24 kbps)`,
    stations,
    totals,
    budget,
    hours,
    authentic,
    calibration: calibrate(corpus, bundles),
    neverAllKnown,
    itemsWithoutOwnExample,
    grammarOutside,
    storyLinesOutside,
  };
  return { data, pools, verdicts, corpus };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Markdown                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function num(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function h(x: number): string {
  return `${x.toFixed(1)} h`;
}

function min(x: number): string {
  return `${x.toFixed(1)} min`;
}

function pct(x: number): string {
  return `${(100 * x).toFixed(1)} %`;
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KiB`;
}

function clipCell(c: Clips): string {
  return `${num(c.count)} · ${h(c.hours)}`;
}

export function renderMarkdown(d: ReportData): string {
  const out: string[] = [];
  out.push('# TSUZUKU — Listening report');
  out.push('');
  out.push(`Generated by \`scripts/listening-report.ts\` from \`public/content\`${d.contentVersion ? ` (content \`${d.contentVersion}\`)` : ''}; the pools are regenerated in memory by the same \`buildPools\` call \`content:assign\` writes \`listening/pool-NN.json\` from. Basis: ${d.basis}. Design 08 §2 quotes §2 and §3 of this file; §12 quotes §3. Rerun with \`node scripts/listening-report.ts\` (\`--json\` prints the same data).`);
  out.push('');
  out.push('## 1. Pools by station');
  out.push('');
  out.push('Own = the station\'s own `pool-NN.json`; i+0 = every ref in the pools ≤ the station (the ceiling of what a learner who knows the whole allowlist can follow); i+1 = every later ref with exactly one id beyond the station. At runtime `selectPool` applies the learner\'s live known set, so the Station page shows a live count, never these ceilings. Own-station examples = the V46 census: vocab examples all-known at the station the word is introduced / all examples of that station\'s items, and the items with none.');
  out.push('');
  out.push('| Station | Belt | Own refs (stories · grammar · vocab) | Own | File | i+0 refs | i+0 | i+1 refs | i+1 | Own-station examples | Items without |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of d.stations) {
    out.push(`| ${pad2(s.station)} | ${s.belt} | ${num(s.own.refs)} (${num(s.own.stories)} · ${num(s.own.grammar)} · ${num(s.own.vocab)}) | ${min(s.own.minutes)} | ${kb(s.own.bytes)}${s.own.bytes > d.budget.bytes ? ' ⚠' : ''} | ${num(s.i0.refs)} | ${min(s.i0.minutes)} | ${num(s.i1.refs)} | ${min(s.i1.minutes)} | ${s.examples.allKnown} / ${s.examples.total} | ${s.examples.itemsWithout} / ${s.examples.items} |`);
  }
  out.push(`| **Σ** | | **${num(d.totals.refs)}** (${num(d.totals.stories)} · ${num(d.totals.grammar)} · ${num(d.totals.vocab)}) | **${min(d.totals.minutes)}** | ${kb(d.stations.reduce((n, s) => n + s.own.bytes, 0))} | | | | | | |`);
  out.push('');
  out.push(
    d.budget.over.length === 0
      ? `File = the serialised \`pool-NN.json\` (one ref per line). Every pool file is within the ${kb(d.budget.bytes)} budget (\`POOL_FILE_BUDGET_BYTES\`, a hard limit: \`content:index\` fails over it; \`kana\` stays in \`PoolRef\` because Radio reads it); the largest is Station ${pad2(d.stations.reduce((m, s) => (s.own.bytes > m.own.bytes ? s : m)).station)} at ${kb(Math.max(...d.stations.map((s) => s.own.bytes)))}.`
      : `File = the serialised \`pool-NN.json\` (one ref per line). ${d.budget.over.length} of ${d.stations.length} pools exceed the ${kb(d.budget.bytes)} budget (⚠; \`POOL_FILE_BUDGET_BYTES\` is a hard limit — \`content:index\` FAILS over it, the largest is Station ${pad2(d.budget.over.reduce((m, o) => (o.bytes > m.bytes ? o : m)).station)} at ${kb(Math.max(...d.budget.over.map((o) => o.bytes)))}): split the station's examples or take a new budget to the lead.`,
  );
  out.push('');
  const H = d.hours;
  out.push('## 2. Hours (design 08 §2)');
  out.push('');
  out.push('Distinct = each text rendered once; rendered adds the natural-slow second take of the Stations 1–17 sentence clips (pieces through Orange).');
  out.push('');
  out.push('| Source | What | Count · distinct audio | Tier |');
  out.push('|---|---|---|---|');
  out.push(`| Mined sentences | vocab \`examples[]\` in the pools (${num(H.mined.vocabInPools.count)} of ${num(H.mined.vocabAll.count)}; ${h(H.mined.vocabAll.hours)} if all were rendered) | ${clipCell(H.mined.vocabInPools)} | T2 pool |`);
  out.push(`| | grammar \`examples[]\` (${num(H.mined.grammarInPools.count)} in the pools) | ${clipCell(H.mined.grammarAll)} | T1 core |`);
  out.push(`| | story lines of the texts (${num(H.mined.storyLinesInPools.count)} in the pools) | ${clipCell(H.mined.storyLinesAll)} | T1 core |`);
  out.push(`| | michikusa quotes | ${clipCell(H.mined.michikusaQuotes)} | T1 core |`);
  out.push(`| Audio-first pieces | ${num(H.pieces.texts)} texts (\`audioFirst\`) on disk | ${clipCell(H.pieces)} | T1 core |`);
  out.push(`| Drill clips | bare words (by item id) | ${clipCell(H.drills.words)} | T1 core |`);
  out.push(`| | kanji example words not covered by a vocab clip (${num(H.drills.kanjiWords.reused)} reuse one) | ${clipCell(H.drills.kanjiWords)} | T1 core |`);
  out.push(`| | kana + \`exampleWord\` | ${clipCell(H.drills.kana)} | T1 core |`);
  out.push(`| | collocations (morae estimated) | ${clipCell(H.drills.collocations)} | T3 ear |`);
  out.push(`| | \`word + が\` for \`pitchConfidence: high\` | ${clipCell(H.drills.pitchGa)} | T3 ear |`);
  out.push(`| | \`definitionJa\` | ${clipCell(H.drills.definitionJa)} | T3 ear |`);
  out.push('');
  out.push(`Connected speech ≈ **${h(H.distinct.connected)}** distinct (mined ${h(H.mined.connectedHours)} + pieces ${h(H.pieces.hours)}); drill clips ≈ **${h(H.distinct.drills)}**; ≈ **${h(H.distinct.total)} distinct, ≈ ${h(H.renderedHours)} rendered** with the slow takes (story lines ${h(H.slowTakes.storyLines.hours)} + grammar ${h(H.slowTakes.grammar.hours)} + pool vocab Stations 4–17 ${h(H.slowTakes.poolVocab.hours)} + pieces ${h(H.slowTakes.pieces.hours)}).`);
  out.push('');
  out.push('| Tier | Hours rendered | Bytes |');
  out.push('|---|---|---|');
  out.push(`| T1 core (story lines + pieces, words, kanji words, kana, grammar examples, michikusa quotes, their slow takes) | ${h(H.tiers.core.hours)} | ≈ ${H.tiers.core.mb} MB |`);
  out.push(`| T2 pool (pool vocab examples + slow takes for Stations 4–17) | ${h(H.tiers.pool.hours)} | ≈ ${H.tiers.pool.mb} MB |`);
  out.push(`| T3 ear (collocations, word + が, definitionJa; minimal-pair partners not counted) | ${h(H.tiers.ear.hours)} | ≈ ${H.tiers.ear.mb} MB |`);
  out.push(`| **Total** | **${h(H.tiers.core.hours + H.tiers.pool.hours + H.tiers.ear.hours)}** | **≈ ${H.tiers.totalMb} MB** |`);
  out.push('');
  const A = d.authentic;
  out.push('## 3. Authentic inventory (design 08 §12)');
  out.push('');
  out.push('| Source | Texts | Distinct hours |');
  out.push('|---|---|---|');
  out.push(`| bridge texts (\`bridge: true\`, the existing texts) | ${A.bridgeTexts.count} | ${h(A.bridgeTexts.hours)} |`);
  out.push(`| casual non-bridge dialogues from Station ${CASUAL_FROM_STATION} (the existing texts) | ${A.casualDialogues.count} | ${h(A.casualDialogues.hours)} |`);
  out.push(`| authentic pieces (\`audioFirst\` with \`isAuthenticText\`) on disk | ${A.authenticPieces.count} | ${h(A.authenticPieces.hours)} |`);
  out.push(`| **Distinct** | | **${h(A.distinctHours)}** |`);
  out.push('');
  out.push(`An Arena set runs ≈ ${ARENA_SET_FACTOR}× the speech length → sets alone ≈ ${h(A.arenaHours)}; ${RADIO_REHEARINGS} Radio re-hearings at ≥ 1.0× with the gist question add ≈ ${h(A.radioHours)} — **≈ ${h(A.reachableHours)} reachable in the dojo** (\`src/store/perapera.test.ts\` walks the same inventory).`);
  out.push('');
  const C = d.calibration;
  out.push('## 4. Segmenter calibration');
  out.push('');
  out.push(`\`linkSentence\` (the segmenter the example sentences are judged by) against the stories' own \`tokenIds\` (${num(C.lines)} lines of the texts, each story's cumulative allowlist + its plusOne words): the all-known verdict agrees on ${pct(C.verdictAgreement)} of lines, the linked id set is identical on ${pct(C.idSetAgreement)}, the vocab ids alone on ${pct(C.vocabIdAgreement)}. The differences are the writers' tokenisation of grammar surfaces (とても, ように, のため kept whole or split) and the V20 matcher's hint rule on unknown verbs (歩きました counts as known through the ました hint in a story; the segmenter keeps 歩き unknown). Story lines enter the pools by their writers' \`tokenIds\`, not by this segmenter, so the pools are not affected by the disagreement.`);
  out.push('');
  out.push('## 5. Vocab examples outside every pool (Pass 4b rewrite candidates)');
  out.push('');
  out.push(`${num(d.neverAllKnown.length)} examples hold a token that links nowhere in the corpus (shown in brackets); they are rendered only once rewritten. Items without an own-station all-known example (the V46 list, ${num(d.itemsWithoutOwnExample.length)} items) follow, with each example's unknown tokens against the item's own station.`);
  out.push('');
  let station = 0;
  for (const r of d.neverAllKnown) {
    if (r.station !== station) {
      station = r.station;
      out.push('');
      out.push(`### Station ${pad2(station)}`);
      out.push('');
    }
    out.push(`- \`${r.ref}\` ${r.plain} [${r.unknown.join(' ')}]`);
  }
  out.push('');
  out.push('### Items without an own-station all-known example');
  out.push('');
  station = 0;
  for (const it of d.itemsWithoutOwnExample) {
    if (it.station !== station) {
      station = it.station;
      out.push('');
      out.push(`#### Station ${pad2(station)}`);
      out.push('');
    }
    out.push(`- **${it.id}** ${it.word}: ${it.examples.map((e) => `${e.ref.split('#')[1]} ${e.plain} [${e.unknown.join(' ')}]`).join(' · ')}`);
  }
  out.push('');
  out.push('## 6. Grammar examples and story lines outside every pool');
  out.push('');
  out.push(`Grammar examples (${num(d.grammarOutside.length)}):`);
  out.push('');
  for (const r of d.grammarOutside) out.push(`- \`${r.ref}\` ${r.plain} [${r.unknown.join(' ')}]`);
  out.push('');
  out.push(`Story lines (${num(d.storyLinesOutside.length)}; a line whose writers' \`tokenIds\` leave a content token unknown against its own text's pool — the V20 coverage allowance; a line not yet linked with \`tokenIds\` is not listed, it simply waits for \`content:assign\`):`);
  out.push('');
  for (const r of d.storyLinesOutside) out.push(`- \`${r.ref}\` ${r.plain} [${r.unknown.join(' ')}]`);
  out.push('');
  return out.join('\n');
}

/** Builds the report and writes the markdown (only when its bytes changed). Returns the report and whether the file changed. */
export function writeReport(root: string, outPath: string): { report: Report; changed: boolean; path: string } {
  const report = buildReport(root);
  const text = renderMarkdown(report.data);
  const abs = resolve(outPath);
  const changed = !existsSync(abs) || readFileSync(abs, 'utf8') !== text;
  if (changed) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return { report, changed, path: abs };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CLI                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function main(): void {
  const argv = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  let root = join(here, '..', 'public', 'content');
  let out: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--root') root = argv[++i] ?? root;
    else if (a === '--out') out = argv[++i];
    else if (a === '--json') json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: node scripts/listening-report.ts [--root <content dir>] [--out <docs/listening-report.md>] [--json]\n  writes docs/listening-report.md; --json prints the report data to stdout instead (with --out, both)\n');
      process.exit(0);
    }
  }
  try {
    if (json && out === undefined) {
      process.stdout.write(JSON.stringify(buildReport(resolve(root)).data, null, 2) + '\n');
      return;
    }
    const { report, changed, path } = writeReport(resolve(root), out ?? join(here, '..', 'docs', 'listening-report.md'));
    if (json) process.stdout.write(JSON.stringify(report.data, null, 2) + '\n');
    else {
      const d = report.data;
      process.stdout.write(`${changed ? 'wrote' : 'unchanged'} ${path}\n${num(d.totals.refs)} refs in ${d.stations.length} pools (${d.totals.minutes.toFixed(0)} min) · ${num(d.neverAllKnown.length)} vocab examples outside every pool · connected ${d.hours.distinct.connected.toFixed(1)} h, drills ${d.hours.distinct.drills.toFixed(1)} h · authentic ${d.authentic.distinctHours.toFixed(1)} h distinct, ≈ ${d.authentic.reachableHours.toFixed(0)} h reachable\n`);
    }
  } catch (e) {
    process.stderr.write(`listening-report failed: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
