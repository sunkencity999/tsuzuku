/**
 * TSUZUKU — 自然か Judgment Call (design 04 §4, from Brown): one sentence →
 * ○ natural or × not, then the explanation.
 *
 *  · Unnatural sentences and their explanations are mined from
 *    `GrammarItem.mistakes` in the V14 format `× wrong → ○ right (why)`
 *    (`parseMistake`); natural ones come from `examples`.
 *  · `params.sentence` names the sentence to judge; `params.answer` may pin
 *    the verdict (`○` / `natural` / `×` / `unnatural`), otherwise the verdict is
 *    looked up in the item (a mistake's wrong form → ×, anything else → ○).
 *    Without a sentence the case is drawn deterministically from the item
 *    (`store.seed() + today + step.id`), unnatural and natural alike.
 *  · Grading: `gradeChoice`; a miss carries the slip's tag (`mistakeTag`:
 *    particle swap → particle, permutation → word-order, else conjugation).
 * Facet `grammar:cloze`; keys `choices` (1 = ○, 2 = ×).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toPlain } from '@/content/ruby';
import type { ContentItem, ErrorTag, GrammarItem } from '@/content/types';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { chance, type Rng, pick, rngFor } from '@/shared/hash';
import { equivalentJa, normalizeAnswer } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { gradeChoice, particleSlip } from '../check';
import { S } from '../strings';
import { S as S2, fill } from './strings-2';
import './JudgmentCall.css';

export const meta: ExerciseMeta = {
  id: 'judgment-call',
  facet: 'cloze',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function isGrammar(i: ContentItem | null): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i && 'mistakes' in i;
}

export interface Mistake {
  wrong: string;
  right: string;
  why?: string;
}

const MISTAKE_RE = /^\s*[×✕x]\s*(.+?)\s*(?:→|->)\s*[○◯o]\s*(.+?)\s*(?:[（(]\s*(.+?)\s*[)）])?\s*$/u;

/** Parses `× wrong → ○ right (why)`; `null` when the line is not in that form. */
export function parseMistake(line: string): Mistake | null {
  const m = MISTAKE_RE.exec(line);
  if (!m) return null;
  const bad = (m[1] ?? '').trim();
  const good = (m[2] ?? '').trim();
  if (bad.length === 0 || good.length === 0) return null;
  const why = m[3]?.trim();
  return why ? { wrong: bad, right: good, why } : { wrong: bad, right: good };
}

/** The slip a mistake exemplifies: particle swap → particle, same characters reordered → word-order, else conjugation. */
export function mistakeTag(bad: string, good: string): ErrorTag {
  if (particleSlip(bad, good)) return 'particle';
  const b = normalizeAnswer(bad);
  const g = normalizeAnswer(good);
  const sameChars = Array.from(b).sort().join('') === Array.from(g).sort().join('');
  if (sameChars && b !== g) return 'word-order';
  return 'conjugation';
}

export interface JudgmentCase {
  /** The sentence to judge (ruby allowed). */
  sentence: string;
  natural: boolean;
  /** Unnatural: the right form. */
  right?: string;
  /** Unnatural: the why; natural: the example's English. */
  why?: string;
  tag: ErrorTag;
}

const YES = new Set(['○', '◯', 'o', 'natural', 'true', 'yes']);
const NO = new Set(['×', '✕', 'x', 'unnatural', 'false', 'no']);

/**
 * Resolves the case: `params.sentence` (+ optional `params.answer` verdict),
 * else a deterministic draw from the item's mistakes and examples.
 */
export function judgmentCase(item: ContentItem | null, params: StepParams, rng: Rng): JudgmentCase | null {
  const g = isGrammar(item) ? item : null;
  const mistakes = (g?.mistakes ?? []).map(parseMistake).filter((m): m is Mistake => m !== null);
  const examples = g?.examples ?? [];

  if (params.sentence) {
    const plain = toPlain(params.sentence);
    const hit = mistakes.find((m) => equivalentJa(m.wrong, plain));
    const verdict = params.answer?.trim().toLowerCase();
    const natural = verdict !== undefined && (YES.has(verdict) || NO.has(verdict)) ? YES.has(verdict) : !hit;
    const ex = examples.find((e) => equivalentJa(toPlain(e.ja), plain) || equivalentJa(e.kana, plain));
    const tag = hit ? mistakeTag(hit.wrong, hit.right) : 'conjugation';
    const out: JudgmentCase = { sentence: params.sentence, natural, tag };
    if (!natural && hit) {
      out.right = hit.right;
      if (hit.why) out.why = hit.why;
    } else if (!natural && params.accept?.[0]) {
      out.right = params.accept[0];
    } else if (natural && ex) out.why = ex.en;
    return out;
  }

  const canFalse = mistakes.length > 0;
  const canTrue = examples.length > 0;
  if (!canFalse && !canTrue) return null;
  const drawNatural = canTrue && (!canFalse || chance(rng, 0.5));
  if (drawNatural) {
    const ex = pick(rng, examples);
    return { sentence: ex.ja, natural: true, why: ex.en, tag: 'conjugation' };
  }
  const m = pick(rng, mistakes);
  const out: JudgmentCase = { sentence: m.wrong, natural: false, right: m.right, tag: mistakeTag(m.wrong, m.right) };
  if (m.why) out.why = m.why;
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function JudgmentCall(p: ExerciseProps): JSX.Element {
  const { step, item } = p;
  const kase = useMemo(() => judgmentCase(item, step.params, rngFor(store.seed(), store.today(), step.id, 'judgment')), [item, step.id, step.params]);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const startedAt = useRef(store.now());
  const fired = useRef(false);

  useEffect(() => {
    startedAt.current = store.now();
    fired.current = false;
    setPicked(undefined);
  }, [step.id]);

  const correctIdx = kase ? (kase.natural ? 0 : 1) : 0;
  const choices = [`○ ${S2.natural}`, `× ${S2.unnatural}`];

  const onPick = (i: number): void => {
    if (fired.current || !kase) return;
    fired.current = true;
    setPicked(i);
    const ms = Math.max(0, store.now() - startedAt.current);
    p.onResult(gradeChoice(i, correctIdx, { ms, missTags: [kase.tag], answer: kase.natural ? '○' : '×' }));
  };

  const continueEmpty = (): void => {
    if (fired.current) return;
    fired.current = true;
    setPicked(0);
    p.onResult(gradeChoice(0, 0, { ms: 0 }));
  };

  if (!kase) {
    return (
      <div class="judgment" data-feel={p.feel}>
        <p class="judgment__empty" role="status">
          {S2.noSentence}
        </p>
        {picked === undefined ? (
          <button type="button" class="hanko" onClick={continueEmpty}>
            {S.continue}
          </button>
        ) : null}
      </div>
    );
  }

  const answered = picked !== undefined;
  const wasRight = answered && picked === correctIdx;
  const g = isGrammar(item) ? item : null;

  return (
    <div class="judgment" data-feel={p.feel} data-done={answered ? 'true' : undefined}>
      <p class="judgment__prompt">{S2.judgmentPrompt}</p>
      <div class="judgment__sentence status-window">
        <Ruby ja={kase.sentence} mode={p.furigana} />
      </div>

      <ChoiceGrid choices={choices} onPick={onPick} picked={picked} correct={correctIdx} columns={2} size="lg" label={S2.judgmentPrompt} />

      {answered ? (
        <div class="judgment__explain reveal ink-nijimi" data-kind={wasRight ? 'correct' : 'wrong'} role="status">
          <p class="judgment__line">{wasRight ? S2.judgmentCorrect : S2.judgmentMiss}</p>
          <p class="eyebrow judgment__label">{S2.explanation}</p>
          {kase.natural ? (
            <p class="judgment__why">{g ? fill(S2.naturalLine, { pattern: g.pattern, meaning: g.meaning }) : S2.noExplanation}</p>
          ) : (
            <p class="judgment__why">{S2.unnaturalLine}</p>
          )}
          {!kase.natural && kase.right ? (
            <p class="judgment__right" lang="ja">
              <span class="judgment__mark" aria-hidden="true">
                ○
              </span>
              {kase.right}
            </p>
          ) : null}
          {kase.why ? <p class="judgment__detail">{kase.why}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
