/**
 * TSUZUKU — karaoke timing helpers (design 08 §9). Pure.
 *
 * A story cue (`ClipCue.morae`) carries cumulative mora boundaries; the clip
 * player reports the active mora index through `SpeakOptions.onProgress`.
 * This module maps that index back onto the line's word tokens so the
 * transcript can sweep token by token:
 *
 *   token i owns morae [k_i, k_{i+1}) where k is the cumulative
 *   `moraCount(toKana(tok.ja))` over `segmentsToTokens(line.ja, line.tokens)`.
 *
 * V13 guarantees the token readings concatenate to `line.kana`, which is the
 * order the engine's `morae` were aligned to. The engine drops pause morae
 * (design 08 §7 step 3), so punctuation and spaces are not beats here either:
 * a punctuation token owns an empty span and the spans of a line sum to
 * `speechMoraCount(line.kana)`.
 *
 * `clauses` (design 08 §9) are clause boundaries as mora indexes; `clauseSpans`
 * turns them into `[from, to)` spans whatever the writer included (with or
 * without 0 and the end), and `clauseKana` cuts the kana a dictated clause is
 * graded against.
 */
import { segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { ClipCue } from '@/shared/audio';
import type { StoryLine } from '@/content/types';
import { speechMorae as sharedSpeechMorae } from '@/shared/jp';

/** `[start, end)` in morae. */
export type MoraSpan = [start: number, end: number];

/** Native rate of a natural-slow take (design 08 §7 step 4): the one cue rate that shows mora dots. */
export const NATURAL_SLOW_RATE = 0.85;

/** The morae of a reading as the engine counts them: punctuation and spaces are pauses, not beats — the one body is `speechMorae` in `shared/jp.ts` (`RE_NOT_MORA` removed, then `moraSplit`). */
export function speechMoraSplit(kana: string): string[] {
  return sharedSpeechMorae(kana);
}

/** `speechMoraSplit(kana).length` — the beat count. Named apart from `speechMorae` in `shared/jp.ts` (the mora array) on purpose, so the one name means one thing tree-wide. */
export function speechMoraCount(kana: string): number {
  return speechMoraSplit(kana).length;
}

/**
 * The mora span each token of `line` owns, in token order. A line without
 * tokens (a pool example sentence) has no spans; a punctuation token owns an
 * empty span `[k, k)`.
 */
export function tokenMoraSpans(line: Pick<StoryLine, 'ja' | 'tokens'>): MoraSpan[] {
  if (line.tokens.length === 0) return [];
  const toks = segmentsToTokens(line.ja, line.tokens);
  const out: MoraSpan[] = [];
  let k = 0;
  for (const t of toks) {
    const n = speechMoraCount(toKana(t.ja));
    out.push([k, k + n]);
    k += n;
  }
  return out;
}

/**
 * Index of the token being sung at `mora`: the last token with a non-empty
 * span starting at or before `mora` (so a punctuation token is never active
 * and a mora past the end stays on the last word). `-1` when nothing has
 * started (no spans, or `mora` below the first word). Monotone in `mora`.
 */
export function activeToken(spans: readonly MoraSpan[], mora: number): number {
  let active = -1;
  for (let i = 0; i < spans.length; i++) {
    const [start, end] = spans[i] as MoraSpan;
    if (end <= start) continue;
    if (start <= mora) active = i;
    else break;
  }
  return active;
}

/**
 * Clause spans of a line from the cue's boundary list: boundaries strictly
 * inside `(0, total)` cut the line, `0` and `total` are implied, duplicates and
 * out-of-range values are ignored. An empty or missing list is one clause.
 */
export function clauseSpans(clauses: readonly number[] | undefined, total: number): MoraSpan[] {
  if (total <= 0) return [];
  const cuts = Array.from(new Set((clauses ?? []).filter((c) => Number.isInteger(c) && c > 0 && c < total))).sort((a, b) => a - b);
  const out: MoraSpan[] = [];
  let from = 0;
  for (const c of cuts) {
    out.push([from, c]);
    from = c;
  }
  out.push([from, total]);
  return out;
}

/** The kana of one clause `[from, to)` of `kana` (speech morae: punctuation dropped). */
export function clauseKana(kana: string, span: MoraSpan): string {
  return speechMoraSplit(kana).slice(span[0], span[1]).join('');
}

/**
 * The written surface of one clause when the line's tokens let us cut it (the
 * tokens whose spans fall inside `span`, punctuation between them kept);
 * `null` when the line has no tokens or the clause cuts through a word.
 */
export function clauseText(line: Pick<StoryLine, 'ja' | 'tokens'>, span: MoraSpan): string | null {
  const spans = tokenMoraSpans(line);
  if (spans.length === 0) return null;
  const toks = segmentsToTokens(line.ja, line.tokens);
  let out = '';
  let seen = false;
  for (let i = 0; i < spans.length; i++) {
    const [s, e] = spans[i] as MoraSpan;
    const tok = toks[i];
    if (!tok) continue;
    if (e <= s) {
      // punctuation: keep it only between words of the clause
      if (seen && i + 1 < spans.length && (spans[i + 1] as MoraSpan)[0] < span[1]) out += toPlain(tok.ja);
      continue;
    }
    if (e <= span[0] || s >= span[1]) continue;
    if (s < span[0] || e > span[1]) return null; // the clause cuts a word
    out += toPlain(tok.ja);
    seen = true;
  }
  return seen ? out : null;
}

/** Whether a served cue is a natural-slow take (mora dots instead of the token sweep, design 08 §9). */
export function isSlowCue(cue: Pick<ClipCue, 'rate'> | undefined): boolean {
  return !!cue && Math.abs(cue.rate - NATURAL_SLOW_RATE) < 1e-6;
}
