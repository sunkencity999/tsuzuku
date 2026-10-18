/**
 * TSUZUKU — the Ear Walk (design 08 §10.4): `listening-set` in pool mode.
 *
 * The planner hands the Arena `StepParams.refs` — 6–8 i+0 / i+1 pool refs
 * (`v-n5-0249#ex0`, `g-n5-024#ex1`, `s-07-2#L3`, design 08 §4) picked with
 * `selectPool` — and the Arena hears them as one set: listen → choice and
 * dictation items with the same graders and listen evidence as a text →
 * transcript → re-listen, then `listening:set { storyId: null, refs, mode:
 * 'walk' }`. No new drill id.
 *
 * Pure: `resolveRef` turns a `PoolRef` into a `StoryLine`-shaped `WalkLine`
 * (a story line keeps its tokens and `tokenIds`; an example sentence has no
 * tokens, so its `ids` carry the listen evidence); `buildWalkSet` picks the
 * items. `poolRefFor` rebuilds a `PoolRef` from the content when no pool file
 * holds the ref (a build before `content:assign` wrote pools), so the walk
 * still plays — with the example's own item as its only graded id.
 */
import { toKana } from '@/content/ruby';
import type { ContentItem, GrammarItem, PoolRef, StoryItem, StoryLine, VocabItem } from '@/content/types';
import { plusOneId } from '@/learn';
import { shuffle, type Rng } from '@/shared/hash';
import { tryKindOfId } from '@/shared/ids';
import { speechMoraCount } from './karaoke';
import { JA_CHOICES_FROM_STATION, SET_MAX, choiceItem, dictable, isStoryItem, pickClause, type ListenItem } from './set';

/** Items per walk (design 08 §10.4 "6–8 sentences"); fewer only when the planner passes fewer refs. */
export const WALK_TARGET = 6;
export const WALK_MAX = SET_MAX;
/** Tag of the walk's `rngFor(seed, today, WALK_SEED_TAG, ...refs)` draw, so a test can rebuild the same set. */
export const WALK_SEED_TAG = 'walk';

/** A pool sentence as the Arena plays it: a `StoryLine` plus its clip key and graded ids. */
export interface WalkLine extends StoryLine {
  /** The clip key (design 08 §8). */
  ref: string;
  /** Content-word item ids of the sentence (`PoolRef.ids`); the listen evidence for a line without tokens. */
  ids: string[];
  /** Speech morae of the sentence. */
  morae: number;
}

export interface ParsedRef {
  /** The item id (`v-n5-0249`, `g-n5-024`, `s-07-2`). */
  id: string;
  /** `ex` = `examples[index]` of a vocab / grammar item; `line` = `lines[index]` of a story. */
  kind: 'ex' | 'line';
  index: number;
}

const REF_RE = /^(.+)#(ex|L)(\d+)$/;

/** Splits a pool ref into item id, kind and index; `null` for a bare word key or an ill-formed ref. */
export function parseRef(ref: string): ParsedRef | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  return { id: m[1] as string, kind: m[2] === 'ex' ? 'ex' : 'line', index: Number(m[3]) };
}

function hasExamples(i: ContentItem | undefined): i is VocabItem | GrammarItem {
  return !!i && 'examples' in i && Array.isArray((i as VocabItem).examples) && 'jlpt' in i && !('char' in i);
}

/** The sentence a ref points at: `{ ja, kana, en }` plus the story line's tokens when it is one. */
function sentenceOf(ref: string, get: (id: string) => ContentItem | undefined): (Pick<StoryLine, 'ja' | 'kana' | 'en'> & Partial<Pick<StoryLine, 'tokens' | 'tokenIds' | 'speaker'>>) | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const item = get(parsed.id);
  if (parsed.kind === 'line') {
    if (!isStoryItem(item)) return null;
    const line = item.lines[parsed.index];
    return line ?? null;
  }
  if (!hasExamples(item)) return null;
  const ex = item.examples[parsed.index];
  if (!ex) return null;
  const sentence = ex as { ja: string; kana: string; en: string };
  return { ja: sentence.ja, kana: sentence.kana, en: sentence.en };
}

/** Resolves a pool ref to a playable line; `null` when the item or sentence is not in the loaded content. */
export function resolveRef(ref: PoolRef, get: (id: string) => ContentItem | undefined): WalkLine | null {
  const s = sentenceOf(ref.ref, get);
  if (!s) return null;
  const kana = s.kana || toKana(s.ja);
  const line: WalkLine = {
    ja: s.ja,
    kana,
    en: s.en,
    tokens: s.tokens ?? [],
    ref: ref.ref,
    ids: ref.ids.slice(),
    morae: speechMoraCount(kana),
  };
  if (s.tokenIds) line.tokenIds = s.tokenIds;
  if (s.speaker) line.speaker = s.speaker;
  return line;
}

/**
 * A `PoolRef` rebuilt from the content for a ref no pool file holds: a story
 * line's vocab / grammar `tokenIds`, or the example's own item id (the one
 * word an example is guaranteed to contain, V16). `null` when the sentence
 * cannot be found.
 */
export function poolRefFor(ref: string, get: (id: string) => ContentItem | undefined): PoolRef | null {
  const parsed = parseRef(ref);
  const s = sentenceOf(ref, get);
  if (!parsed || !s) return null;
  const ids = s.tokenIds
    ? Array.from(new Set(s.tokenIds.filter((id): id is string => !!id && (tryKindOfId(id) === 'vocab' || tryKindOfId(id) === 'grammar'))))
    : [parsed.id];
  const kana = s.kana || toKana(s.ja);
  return { ref, ids, kana, morae: speechMoraCount(kana) };
}

export interface WalkOptions {
  rng: Rng;
  station: number;
  /** The learner's live known set (`knownSet`, design 08 §4): i+1 refs are preferred for dictation, where their one unknown word earns evidence. */
  known: ReadonlySet<string>;
  /** Clause boundaries (`ClipCue.clauses`) of the cue that will play `ref`; a ref over `DICTATION_MAX_MORAE` dictates one clause when they exist. */
  clauses?: (ref: string) => readonly number[] | undefined;
}

/**
 * Builds the walk's items over `refs` (which `items` must resolve): up to
 * `WALK_MAX` refs in `rng` order, alternating choice / dictation like a text
 * set and gist-free; i+1 refs take the dictation slots first; a ref over
 * `DICTATION_MAX_MORAE` dictates one clause when `o.clauses` has them and
 * becomes a choice item otherwise. `lineIndex` indexes `refs`. Deterministic
 * for a given `rng`.
 */
export function buildWalkSet(refs: readonly PoolRef[], items: (id: string) => ContentItem | undefined, o: WalkOptions): ListenItem[] {
  const lines = refs.map((r) => resolveRef(r, items));
  const usable = refs.map((_, i) => i).filter((i) => lines[i] !== null);
  if (usable.length === 0) return [];
  const order = shuffle(o.rng, usable);
  const count = Math.min(order.length, WALK_MAX);
  const plus = order.filter((i) => plusOneId(refs[i] as PoolRef, o.known) !== null);
  const plain = order.filter((i) => plusOneId(refs[i] as PoolRef, o.known) === null);
  const chosen: number[] = [];
  for (let k = 0; k < count; k++) {
    const wantDictation = k % 2 === 1;
    const src = wantDictation ? (plus.length ? plus : plain) : plain.length ? plain : plus;
    const next = src.shift();
    if (next === undefined) break;
    chosen.push(next);
  }
  const ja = o.station >= JA_CHOICES_FROM_STATION;
  const all = lines.map((l, i) => l ?? ({ ja: '', kana: '', en: '', tokens: [], ref: refs[i]?.ref ?? '', ids: [], morae: 0 } as WalkLine));
  const out: ListenItem[] = [];
  chosen.forEach((lineIndex, k) => {
    const line = lines[lineIndex] as WalkLine;
    if (k % 2 === 1) {
      if (dictable(line.kana)) {
        out.push({ kind: 'dictation', lineIndex });
        return;
      }
      const clause = o.clauses ? pickClause(line.kana, o.clauses(line.ref), o.rng) : null;
      if (clause) {
        out.push({ kind: 'dictation', lineIndex, clause });
        return;
      }
    }
    out.push(choiceItemOver(all, usable, lineIndex, ja, o.rng));
  });
  return out;
}

/** `choiceItem` restricted to the resolvable lines (an unresolved ref never becomes a distractor). */
function choiceItemOver(lines: readonly WalkLine[], usable: readonly number[], lineIndex: number, ja: boolean, rng: Rng): ListenItem {
  if (usable.length === lines.length) return choiceItem(lines, lineIndex, ja, rng);
  const sub = usable.map((i) => lines[i] as WalkLine);
  const item = choiceItem(sub, usable.indexOf(lineIndex), ja, rng);
  return item.kind === 'choice' ? { ...item, lineIndex } : item;
}

/** The line indexes a walk set hears, in play order (ascending, unique): the listen phase and the transcript show only these. */
export function heardLines(items: readonly ListenItem[]): number[] {
  const set = new Set<number>();
  for (const it of items) if (it.kind !== 'gist') set.add(it.lineIndex);
  return Array.from(set).sort((a, b) => a - b);
}
