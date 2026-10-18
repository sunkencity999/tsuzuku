/**
 * TSUZUKU — Listening Arena set helpers: constants, the deterministic set
 * builder, the dictation grader and the listen-facet evidence (design 04 §5,
 * 05 §4, 08 §9–§10). Pure; `ListeningArena.tsx` re-exports them (tests and
 * E's builder import from there). Split out of the component in review
 * round 2b to keep the file under the size cap.
 *
 * Design 08 additions: comprehension questions are asked gist first, then by
 * `ComprehensionQuestion.kind` (`QUESTION_KIND_RANK`); a line longer than
 * `DICTATION_MAX_MORAE` is dictated one clause at a time when the served cue
 * carries clause boundaries (`SetOptions.clauses`, `ListenItem.clause`), and
 * the evidence writer grades only the words inside that clause. The Ear Walk
 * (`./walk.ts`) builds items of the same shape over pool sentences, and
 * `implicitListenGrades` takes the pool's `ids` for a sentence without tokens.
 */
import { KANJI_RE, parseRuby, segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { CardKey, ComprehensionQuestion, ContentItem, ErrorTag, QuestionKind, StoryItem, StoryLine, VocabItem } from '@/content/types';
import { SCORE_BANDS } from '@/learn';
import { pick, shuffle, type Rng } from '@/shared/hash';
import { cardKey, tryKindOfId } from '@/shared/ids';
import { diffChars, moraCount, moraSimilarity, nearMissKind, normalizeAnswer, normalizeJa } from '@/shared/jp';
import type { CardsApi, EpochDay, Rating } from '@/shared/store-types';
import { clauseKana, clauseSpans, speechMoraCount, tokenMoraSpans, type MoraSpan } from './karaoke';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Items per set (design 04 §5 "a set of 5–8"); the gist questions come first. */
export const SET_TARGET = 6;
export const SET_MIN_LINES = 2;
export const SET_MAX = 8;
/** Replays per item and for the whole-text listen (design 04 §5: ≤ 2, second → Hard ceiling). */
export const REPLAY_BUDGET = 2;
/** Lines longer than this (morae) are dictated one clause at a time when the cue has clauses, else heard as a choice item. */
export const DICTATION_MAX_MORAE = 22;
/** A dictated clause is at least this many morae (design 08 §9: a particle alone teaches nothing). */
export const CLAUSE_MIN_MORAE = 4;
/** Japanese choices (the line itself) from Green; English meanings before. */
export const JA_CHOICES_FROM_STATION = 16;
/** The mandatory re-listen is this much faster. */
export const RELISTEN_DELTA = 0.1;
/** Implicit listen grades apply to cards due within this many days (design 05 §4). */
export const IMPLICIT_WINDOW_DAYS = 3;
/** Set pass mark for XP / stats (design 04 §7 "≥ 2/3"). */
export const PASS_RATIO = 2 / 3;

/** Asking order of comprehension questions (design 08 §10.4): gist first, then by kind; a question without `kind` is gist. */
export const QUESTION_KIND_RANK: Record<QuestionKind, number> = { gist: 0, detail: 1, number: 2, speaker: 3, inference: 4 };

const FUNCTION_POS: ReadonlySet<string> = new Set(['prt', 'aux', 'conj', 'pref', 'suf']);

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers (exported for tests and for E's builder)                      */
/* ────────────────────────────────────────────────────────────────────────── */

export function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'comprehension' in i && Array.isArray((i as StoryItem).lines);
}

function isVocab(i: ContentItem | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}

/** Speaker label → voice slot by first appearance (`a`, `b`, `a`, …); unlabelled lines use `a`. */
export function voiceSlots(lines: readonly StoryLine[]): Map<string, 'a' | 'b'> {
  const slots = new Map<string, 'a' | 'b'>();
  for (const l of lines) {
    const name = l.speaker ?? '';
    if (!slots.has(name)) slots.set(name, slots.size % 2 === 0 ? 'a' : 'b');
  }
  return slots;
}

export function slotFor(line: StoryLine, slots: Map<string, 'a' | 'b'>): 'a' | 'b' {
  return slots.get(line.speaker ?? '') ?? 'a';
}

/** The re-listen rate: +0.1×, rounded to two decimals. */
export function relistenRate(rate: number): number {
  return Math.round((rate + RELISTEN_DELTA) * 100) / 100;
}

/** Comprehension questions in asking order: gist first, then by kind rank; a stable sort, so same-kind questions keep the writer's order. */
export function orderQuestions<Q extends Pick<ComprehensionQuestion, 'kind'>>(questions: readonly Q[]): Q[] {
  return questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => QUESTION_KIND_RANK[a.q.kind ?? 'gist'] - QUESTION_KIND_RANK[b.q.kind ?? 'gist'] || a.i - b.i)
    .map((x) => x.q);
}

export type ListenItem =
  | { kind: 'gist'; q: ComprehensionQuestion }
  | { kind: 'choice'; lineIndex: number; choices: string[]; answer: number; ja: boolean }
  /** `clause` = the `[fromMora, toMora)` span dictated of a line over `DICTATION_MAX_MORAE` (design 08 §9); absent = the whole line. */
  | { kind: 'dictation'; lineIndex: number; clause?: MoraSpan };

export interface SetOptions {
  rng: Rng;
  station: number;
  /** Clause boundaries (mora indexes, `ClipCue.clauses`) of the cue that will play line `i`; absent = no clause dictation. */
  clauses?: (lineIndex: number) => readonly number[] | undefined;
}

/** Whether a reading is short enough to dictate whole. */
export function dictable(kana: string): boolean {
  return moraCount(normalizeJa(kana, { foldKatakana: true })) <= DICTATION_MAX_MORAE;
}

/**
 * One clause of a long line to dictate (design 08 §9): a `[from, to)` span of
 * `CLAUSE_MIN_MORAE`–`DICTATION_MAX_MORAE` morae drawn from the cue's clause
 * boundaries, or `null` when no clause fits.
 */
export function pickClause(kana: string, clauses: readonly number[] | undefined, rng: Rng): MoraSpan | null {
  const total = speechMoraCount(kana);
  const spans = clauseSpans(clauses, total).filter(([s, e]) => e - s >= CLAUSE_MIN_MORAE && e - s <= DICTATION_MAX_MORAE);
  return spans.length ? pick(rng, spans) : null;
}

/** A choice item over `lines[lineIndex]` with three distractors drawn from the other lines (deduped on the plain surface). */
export function choiceItem(lines: readonly StoryLine[], lineIndex: number, ja: boolean, rng: Rng): ListenItem {
  const text = (l: StoryLine): string => (ja ? l.ja : l.en);
  const line = lines[lineIndex] as StoryLine;
  const correctText = text(line);
  const pool: string[] = [];
  const seen = new Set([normalizeAnswer(toPlain(correctText)) || correctText]);
  for (const j of shuffle(
    rng,
    lines.map((_, i) => i),
  )) {
    if (j === lineIndex) continue;
    const t = text(lines[j] as StoryLine);
    const k2 = normalizeAnswer(toPlain(t)) || t;
    if (seen.has(k2)) continue;
    seen.add(k2);
    pool.push(t);
    if (pool.length === 3) break;
  }
  const choices = shuffle(rng, [correctText, ...pool]);
  return { kind: 'choice', lineIndex, choices, answer: choices.indexOf(correctText), ja };
}

/**
 * Builds the set: every comprehension question first (gist, then by kind),
 * then 2–5 line items (alternating choice / dictation; a line too long to
 * dictate is dictated one clause when the cue has clauses, else becomes a
 * choice), 5–8 items in all. Deterministic for a given `rng`.
 */
export function buildListeningSet(story: StoryItem, o: SetOptions): ListenItem[] {
  const items: ListenItem[] = orderQuestions(story.comprehension).map((q) => ({ kind: 'gist', q }));
  const lines = story.lines;
  if (lines.length === 0) return items;
  const lineCount = Math.max(SET_MIN_LINES, Math.min(SET_MAX - items.length, SET_TARGET - items.length, lines.length));
  const order = shuffle(
    o.rng,
    lines.map((_, i) => i),
  ).slice(0, lineCount);
  const ja = o.station >= JA_CHOICES_FROM_STATION;
  order.forEach((lineIndex, k) => {
    const line = lines[lineIndex] as StoryLine;
    if (k % 2 === 1) {
      if (dictable(line.kana)) {
        items.push({ kind: 'dictation', lineIndex });
        return;
      }
      const clause = o.clauses ? pickClause(line.kana, o.clauses(lineIndex), o.rng) : null;
      if (clause) {
        items.push({ kind: 'dictation', lineIndex, clause });
        return;
      }
    }
    items.push(choiceItem(lines, lineIndex, ja, o.rng));
  });
  return items;
}

export interface DictationGrade {
  /** 1 − mora edit distance / length. */
  score: number;
  rating: Rating;
  /** ≥ 0.80 counts as a right answer for the set. */
  correct: boolean;
  tags: ErrorTag[];
  diff: [string, 0 | 1 | 2][];
}

/** The kana a dictation is graded against: the whole line, or one clause of it. */
export function dictationTarget(line: Pick<StoryLine, 'kana'>, clause?: MoraSpan): string {
  return clause ? clauseKana(line.kana, clause) : line.kana;
}

/** Mora-similarity grading of a typed line or clause (design 04 §5 sentence-listen bands). */
export function gradeDictation(answer: string, line: Pick<StoryLine, 'kana'>, clause?: MoraSpan): DictationGrade {
  const target = dictationTarget(line, clause);
  const score = Math.max(0, Math.min(1, moraSimilarity(answer, target)));
  const near = nearMissKind(answer, target);
  let rating: Rating = score >= SCORE_BANDS.good ? 3 : score >= SCORE_BANDS.hard ? 2 : 1;
  if (near && rating < 2) rating = 2;
  const tags: ErrorTag[] = [];
  if (rating < 3) tags.push(near ?? (rating === 2 ? 'transcription' : 'listening'));
  return { score, rating, correct: rating >= 2, tags, diff: diffChars(normalizeJa(answer), normalizeJa(target)) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Listen-facet evidence                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

interface Evidence {
  id: string;
  /** Readings / surfaces any of which, present in the answer, means the word was heard. */
  surfaces: string[];
}

/** Good when a surface of the word is in the answer, else Again — for `listen` cards that exist and are due within the window. */
function gradeEvidence(entries: readonly Evidence[], answer: string, get: (id: string) => ContentItem | undefined, cards: Pick<CardsApi, 'get'>, today: EpochDay): { cardKey: CardKey; rating: Rating }[] {
  const key = normalizeAnswer(answer);
  const out: { cardKey: CardKey; rating: Rating }[] = [];
  const seen = new Set<CardKey>();
  for (const e of entries) {
    if (tryKindOfId(e.id) !== 'vocab') continue;
    // The item may not be in memory (a story opens with only its own file, ARCHITECTURE §3):
    // the id already says "vocab"; a loaded function word is the only thing that excludes it.
    const item = get(e.id);
    if (isVocab(item) && FUNCTION_POS.has(item.pos)) continue;
    const ck = cardKey(e.id, 'listen');
    if (seen.has(ck)) continue;
    const card = cards.get(ck);
    if (!card || card[0] > today + IMPLICIT_WINDOW_DAYS) continue;
    const present = e.surfaces.some((s) => {
      const k = normalizeAnswer(s);
      return k.length > 0 && key.includes(k);
    });
    seen.add(ck);
    out.push({ cardKey: ck, rating: present ? 3 : 1 });
  }
  return out;
}

export interface EvidenceOptions {
  /** Grade only the words inside this clause (design 08 §9). */
  clause?: MoraSpan;
  /** Item ids of the sentence's content words for a line without `tokenIds` (a pool example, `PoolRef.ids`). */
  ids?: readonly string[];
}

/**
 * Listen-facet evidence for one dictated line: a content word whose kana (or
 * surface) appears in the answer → Good on its `listen` card, else Again —
 * only for cards that exist and are due within 3 days (design 04 §5, 05 §4).
 * A line with `tokenIds` is graded token by token (inside the clause when one
 * is given); a sentence without tokens is graded over `o.ids` through the
 * loaded items' readings (so a pool example still rehearses its i+1 word).
 */
export function implicitListenGrades(
  line: Pick<StoryLine, 'ja' | 'kana' | 'tokens' | 'tokenIds'>,
  answer: string,
  get: (id: string) => ContentItem | undefined,
  cards: Pick<CardsApi, 'get'>,
  today: EpochDay,
  o: EvidenceOptions = {},
): { cardKey: CardKey; rating: Rating }[] {
  const ids = line.tokenIds;
  if (ids) {
    const toks = segmentsToTokens(line.ja, line.tokens);
    const spans = o.clause ? tokenMoraSpans(line) : null;
    const entries: Evidence[] = [];
    ids.forEach((id, i) => {
      if (!id) return;
      if (spans && o.clause) {
        const span = spans[i];
        if (!span || span[1] <= span[0] || span[0] < o.clause[0] || span[1] > o.clause[1]) return;
      }
      const surface = line.tokens[i] ?? '';
      const reading = toks[i] ? toKana(toks[i].ja) : surface;
      entries.push({ id, surfaces: [reading, surface] });
    });
    return gradeEvidence(entries, answer, get, cards, today);
  }
  if (!o.ids || o.ids.length === 0) return [];
  const within = o.clause ? normalizeAnswer(clauseKana(line.kana, o.clause)) : null;
  const entries: Evidence[] = [];
  for (const id of o.ids) {
    const item = get(id);
    if (!isVocab(item)) continue;
    const surfaces = wordSurfacesIn(item, line.ja);
    if (within !== null && !surfaces.some((s) => normalizeAnswer(s).length > 0 && within.includes(normalizeAnswer(s)))) continue;
    entries.push({ id, surfaces });
  }
  return gradeEvidence(entries, answer, get, cards, today);
}

const CONJUGABLE: ReadonlySet<string> = new Set(['v1', 'v5', 'v-irr', 'adj-i']);

/**
 * Readings that show `item` was heard in the sentence `ja` (ruby markup), for
 * a sentence without tokens: the dictionary kana, plus the reading the word
 * actually has in this sentence — for a kanji word, the ruby of its kanji run
 * followed by as many kana as its okurigana (飲む in {飲|の}みます → のみ, so an
 * inflected verb still counts); for a kana word that conjugates, its kana
 * minus the last character (おいしい → おいし). Surfaces shorter than two
 * characters fall back to the whole kana.
 */
export function wordSurfacesIn(item: Pick<VocabItem, 'word' | 'kana' | 'pos' | 'altForms'>, ja: string): string[] {
  const out = new Set<string>([item.kana, item.word, ...(item.altForms ?? [])]);
  const conj = CONJUGABLE.has(item.pos);
  const kanjiIdx = Array.from(item.word).reduce((last, ch, i) => (KANJI_RE.test(ch) ? i : last), -1);
  if (kanjiIdx >= 0) {
    const stem = Array.from(item.word).slice(0, kanjiIdx + 1).join('');
    const okurigana = Array.from(item.word).length - kanjiIdx - 1;
    const segs = parseRuby(ja);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg || seg.reading === null || !seg.base.includes(stem)) continue;
      let reading = seg.reading;
      let need = okurigana;
      for (let j = i + 1; j < segs.length && need > 0; j++) {
        const next = segs[j];
        if (!next) break;
        const text = next.reading ?? next.base;
        const take = Array.from(text).slice(0, need);
        reading += take.join('');
        need -= take.length;
        if (next.reading !== null) break;
      }
      if (reading.length >= 2) out.add(reading);
      break;
    }
  } else if (conj) {
    const stem = Array.from(item.kana).slice(0, -1).join('');
    if (stem.length >= 2) out.add(stem);
  }
  return Array.from(out);
}
