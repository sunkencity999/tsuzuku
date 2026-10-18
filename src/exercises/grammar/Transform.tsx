/**
 * TSUZUKU — 変換 Transform (design 04 §4): a full sentence plus an instruction
 * ("make it casual past", "make it sonkeigo", "rewrite with 〜てください")
 * → the learner types the rewritten sentence through the kana IME.
 *
 *  · Accept list (`transformAccept`): `params.answer`, `params.accept`, then
 *    the conjugation engine's surfaces when the item is a conjugable word and
 *    `params.targetForm` is set, then — for a grammar point with no answer in
 *    the params — the example sentence `params.lineIndex` names (plain + kana).
 *  · Tags (`transformTag`): `params.tag` wins; else `targetForm` → conjugation,
 *    `registerTarget` → register, otherwise conjugation for a conjugable word
 *    and word-order for a grammar point. A miss whose characters are a
 *    permutation of the expected form always adds `word-order`.
 *  · Grading goes through `<TextAnswer mode="ja">` (equivalence → particle
 *    slip → near miss → wrong), so づ/ず, long vowels and katakana folds are
 *    handled centrally. Hint (the button or the frame's `?` / Hint button)
 *    reveals the pattern or the first two characters and caps the rep at
 *    Hard (`hintUsed`).
 * Facet `grammar:prod`; keys `kana`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toPlain } from '@/content/ruby';
import type { ContentItem, ErrorTag, GrammarItem, VocabItem } from '@/content/types';
import { conjugate, isConjugable } from '@/learn';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { normalizeAnswer } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { attempt } from '../check';
import { S } from '../strings';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { FORM_LABEL, REGISTER_LABEL, S as S2, fill } from './strings-2';
import './Transform.css';

export const meta: ExerciseMeta = {
  id: 'transform',
  facet: 'prod',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers (exported for tests and for E's builder)                      */
/* ────────────────────────────────────────────────────────────────────────── */

function isVocab(i: ContentItem | null): i is VocabItem {
  return !!i && 'word' in i && 'kana' in i && 'meanings' in i && 'pos' in i;
}
function isGrammar(i: ContentItem | null): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}

function clean(xs: readonly string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const t = x.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Every surface a Transform answer may match, display form first:
 * `params.answer`, `params.accept`, the engine's conjugation surfaces
 * (conjugable word + `targetForm`), then a grammar example (plain + kana)
 * when nothing else named the answer.
 */
export function transformAccept(item: ContentItem | null, params: StepParams): string[] {
  const out: string[] = [];
  if (params.answer) out.push(params.answer);
  if (params.accept) out.push(...params.accept);
  if (isVocab(item) && params.targetForm && isConjugable(item.pos)) {
    const c = conjugate(item.word, item.kana, item.pos, params.targetForm);
    if (c) out.push(c.answer, c.answerKana, ...c.alt);
  }
  if (out.length === 0 && isGrammar(item) && item.examples.length > 0) {
    const idx = Math.min(Math.max(0, params.lineIndex ?? 0), item.examples.length - 1);
    const ex = item.examples[idx];
    if (ex) out.push(toPlain(ex.ja), ex.kana);
  }
  return clean(out);
}

/** The base error tag a Transform miss carries (design 04 §4: conjugation / register / word-order). */
export function transformTag(item: ContentItem | null, params: StepParams): ErrorTag {
  if (params.tag) return params.tag;
  if (params.targetForm) return 'conjugation';
  if (params.registerTarget) return 'register';
  if (isVocab(item) && isConjugable(item.pos)) return 'conjugation';
  return 'word-order';
}

/** `given` uses exactly the characters of `expected` in another order. */
export function isPermutation(given: string, expected: string): boolean {
  const g = Array.from(normalizeAnswer(given)).sort().join('');
  const e = Array.from(normalizeAnswer(expected)).sort().join('');
  return g.length > 0 && g === e && normalizeAnswer(given) !== normalizeAnswer(expected);
}

/** The instruction line: `promptEn`, else derived from the target form / register / pattern. */
export function transformInstruction(item: ContentItem | null, params: StepParams): string {
  if (params.promptEn) return params.promptEn;
  if (params.targetForm) return fill(S2.transformTo, { target: fill(S2.transformForm, { form: FORM_LABEL[params.targetForm] }) });
  if (params.registerTarget) return fill(S2.transformTo, { target: REGISTER_LABEL[params.registerTarget] });
  if (isGrammar(item)) return fill(S2.transformWith, { pattern: item.pattern });
  return S2.transformPrompt;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function Transform(p: ExerciseProps): JSX.Element {
  const { step, item } = p;
  const params = step.params;
  const accept = useMemo(() => transformAccept(item, params), [item, params]);
  const baseTag = transformTag(item, params);
  const instruction = transformInstruction(item, params);
  const display = accept[0] ?? '';

  const startedAt = useRef(store.now());
  const [hint, setHint] = useState(false);
  const [done, setDone] = useState<TextAnswerResult | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    startedAt.current = store.now();
    fired.current = false;
    setHint(false);
    setDone(null);
  }, [step.id]);

  const source = params.sentence ?? (isVocab(item) ? item.word : '');
  const sourceKana = !params.sentence && isVocab(item) && item.kana !== item.word ? item.kana : null;

  const useHint = (): void => {
    if (hint || done) return;
    setHint(true);
    p.onHint();
  };
  // The frame's `?` / Hint button (hint-only set: the TextAnswer keeps Enter); withdrawn once used.
  useExerciseKeys({ onHint: !hint && !done && accept.length > 0 ? useHint : undefined });

  const hintText = isGrammar(item) ? `${S2.hintPattern}: ${item.pattern}` : `${S2.hintStartsWith} ${Array.from(display).slice(0, 2).join('')}…`;

  const onSubmit = (r: TextAnswerResult): void => {
    if (fired.current) return;
    fired.current = true;
    const ms = Math.max(0, store.now() - startedAt.current);
    const tags: ErrorTag[] = [...r.tags];
    if (!r.correct && isPermutation(r.given, r.expected) && !tags.includes('word-order')) tags.push('word-order');
    setDone(r);
    p.onResult(
      attempt({
        ms,
        correct: r.correct,
        nearMiss: r.nearMiss,
        hintUsed: hint,
        errorTags: tags,
        answer: r.given,
      }),
    );
  };

  return (
    <div class="transform" data-feel={p.feel} data-done={done ? 'true' : undefined}>
      <p class="transform__instruction">{instruction}</p>
      {source ? (
        <div class="transform__source status-window">
          <span class="eyebrow">{S2.original}</span>
          <span class="transform__sentence">
            <Ruby ja={source} mode={p.furigana} />
            {sourceKana ? (
              <small class="transform__kana" lang="ja">
                {sourceKana}
              </small>
            ) : null}
          </span>
        </div>
      ) : null}

      <div class="transform__answer">
        <span class="eyebrow">{S2.target}</span>
        {accept.length > 0 ? (
          <TextAnswer
            key={step.id}
            mode="ja"
            accept={accept}
            kanaOnlyPolicy={params.kanaOnlyPolicy ?? 'good'}
            missTags={[baseTag]}
            candidates={params.candidates}
            autoFocus
            label={S2.typeRewrite}
            placeholder={S.typeJapanese}
            onSubmit={onSubmit}
          />
        ) : (
          <p class="transform__missing reveal ink-nijimi" data-kind="info" role="status">
            {S.itemMissing}
          </p>
        )}
      </div>

      <div class="transform__tools">
        {!done && accept.length > 0 ? (
          <button type="button" class="btn btn--ghost btn--sm" onClick={useHint} disabled={hint} aria-pressed={hint}>
            {S2.hint}
          </button>
        ) : null}
        {hint ? (
          <p class="transform__hint reveal ink-nijimi" data-kind="teach" role="status">
            <span lang={isGrammar(item) ? 'ja' : undefined}>{hintText}</span>
            <small>{S2.hintCeiling}</small>
          </p>
        ) : null}
      </div>
    </div>
  );
}
