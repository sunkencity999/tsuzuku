/**
 * TSUZUKU — 活用連鎖 Form Chain (design 04 §4, `grammar:prod`).
 *
 * One word, five forms in sequence (`params.forms`, with `params.answers`
 * per form; without them the first five applicable forms of a conjugable
 * vocab item, answers from `learn/conjugate`). Each form is typed through a
 * fresh `<TextAnswer mode="ja">` (kanji, kana and every engine alternate
 * accepted; no particle tolerance) and lands in a running log marked right /
 * close / miss. One result for the whole chain: every form right → Good,
 * one form missed → Hard (reported as a near miss), two or more → Again;
 * any miss is tagged `conjugation` and the missed forms' rules are listed.
 * Showing a form's rule first is a hint (Hard ceiling for the chain).
 *
 * On a grammar `prod` card the item is the GrammarItem and the verb the
 * planner picked travels in `params.sentence` (its dictionary form),
 * `params.kana` (its reading), `params.pos` (its part of speech),
 * `params.promptEn` (its gloss) and `params.accepts` (accepted surfaces per
 * form). The head word is derived from them (`head-word.inferHeadWord`: the
 * given pos, else the one pos whose engine answers reproduce `params.answers`)
 * so every link's kana comes from the engine exactly; `params.accepts` rows
 * are graded as given; the flat `params.accept` tail heuristic
 * (`attachFlatAccept`) is the last resort for a step that carries neither.
 * The frame's `?` / Hint button opens the current form's rule (withdrawn once
 * shown): each link mounts a fresh `<TextAnswer>`, so the hint is registered
 * by `<ChainHintKey>` mounted beside it with the same key, after it — `?`
 * reads the last registered set, and a parent-level registration would be
 * hidden by the second link's widget.
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { ConjForm } from '@/content/types';
import { applicableForms, conjugate } from '@/learn';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { attempt } from '../check';
import { S as SD } from '../strings';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { type HeadWord, acceptsRow, headWordOf, inferHeadWord, isVocabItem } from './head-word';
import { FORM_HINT, FORM_LABEL, POS_GROUP_LABEL, S, fill } from './strings';
import './grammar.css';

export { headWordOf, inferHeadWord, isVocabItem, type HeadWord } from './head-word';

export const meta: ExerciseMeta = {
  id: 'form-chain',
  facet: 'prod',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'kana',
};

export const CHAIN_LENGTH = 5;

export interface ChainLink {
  form: ConjForm;
  /** Accepted surfaces, display form first. */
  accept: string[];
}

/** Trailing non-kanji run of a conjugated surface (飲みます → みます; a kana-only surface is its own tail). */
function kanaTail(surface: string): string {
  const m = /[^㐀-䶿一-鿿々〆]*$/.exec(surface);
  return m ? m[0] : surface;
}

/**
 * Last resort for a step without a head word and without `params.accepts`:
 * the planner's flat `params.accept` carries the kana and alternates of
 * every form in one list. Each extra surface is attached to the link whose
 * answer has the longest kana tail that ends it (のみません → 飲みません, not
 * 飲みます), so a kana answer is still Good on such a grammar prod card.
 */
function attachFlatAccept(links: ChainLink[], flat: readonly string[] | undefined): void {
  if (!flat || links.length === 0) return;
  const tails = links.map((l) => kanaTail(l.accept[0] ?? ''));
  for (const raw of flat) {
    const s = raw.trim();
    if (!s || links.some((l) => l.accept.includes(s))) continue;
    let best = -1;
    for (let i = 0; i < links.length; i++) {
      const t = tails[i] as string;
      if (t.length > 0 && s.endsWith(t) && (best < 0 || t.length > (tails[best] as string).length)) best = i;
    }
    if (best >= 0) (links[best] as ChainLink).accept.push(s);
  }
}

/**
 * The chain: step forms + answers + `params.accepts` rows merged with the
 * engine — through the head word, or on a grammar prod card through
 * `inferHeadWord` (`params.pos`, else the pos the answers prove); without
 * either, the flat `params.accept` is attached by tail — else the first five
 * applicable forms of the head word.
 */
export function buildChain(head: HeadWord | null, params: ExerciseProps['step']['params']): ChainLink[] | null {
  const engineHead = head ?? inferHeadWord(params);
  const forms: ConjForm[] =
    params.forms && params.forms.length > 0
      ? params.forms
      : head
        ? applicableForms(head.pos)
            .filter((f) => conjugate(head.word, head.kana, head.pos, f) !== null)
            .slice(0, CHAIN_LENGTH)
        : [];
  const links: ChainLink[] = [];
  forms.forEach((form, i) => {
    const accept: string[] = [];
    const push = (s: string | undefined): void => {
      const t = (s ?? '').trim();
      if (t && !accept.includes(t)) accept.push(t);
    };
    push(params.answers?.[i]);
    for (const a of acceptsRow(params, i)) push(a);
    if (engineHead) {
      const c = conjugate(engineHead.word, engineHead.kana, engineHead.pos, form);
      if (c) {
        push(c.answer);
        push(c.answerKana);
        for (const a of c.alt) push(a);
      }
    }
    if (accept.length > 0) links.push({ form, accept });
  });
  if (!engineHead) attachFlatAccept(links, params.accept);
  return links.length > 0 ? links : null;
}

export type LinkState = 'right' | 'close' | 'miss';

export interface LinkLog {
  form: ConjForm;
  given: string;
  expected: string;
  state: LinkState;
}

/** Chain grading bands: n/n Good, n−1 Hard (near miss), else Again; any miss tagged `conjugation`. */
export function chainResult(log: readonly LinkLog[], n: number, ctx: { ms: number; hintUsed: boolean }): AttemptResult & { hits: number } {
  const hits = log.filter((l) => l.state === 'right').length;
  const perfect = n > 0 && hits === n;
  const r = attempt({
    ms: ctx.ms,
    correct: perfect,
    nearMiss: !perfect && n > 1 && hits === n - 1,
    hintUsed: ctx.hintUsed,
    errorTags: perfect ? [] : ['conjugation'],
    answer: log.map((l) => l.given).join(' / '),
  });
  return Object.assign(r, { hits });
}

/**
 * Registers the chain's hint with the frame after the current link's
 * `<TextAnswer>`: rendered right after it with a parallel key, it mounts (and
 * so registers) last on every link, where a parent-level `useExerciseKeys`
 * would be hidden by the second link's widget. Hint-only, so the widget keeps
 * Enter.
 */
function ChainHintKey(p: { onHint: (() => void) | undefined }): null {
  useExerciseKeys({ onHint: p.onHint });
  return null;
}

const MARK: Record<LinkState, string> = { right: '○', close: '△', miss: '×' };
const STATE_TEXT: Record<LinkState, string> = { right: S.chainStepRight, close: S.chainStepClose, miss: S.chainStepMiss };

type Phase = 'chain' | 'done';

export function FormChain(p: ExerciseProps): JSX.Element {
  const head = useMemo(() => headWordOf(p.item), [p.item]);
  const engineHead = useMemo(() => head ?? inferHeadWord(p.step.params), [head, p.step.params]);
  const chain = useMemo(() => buildChain(head, p.step.params), [head, p.step.params]);
  const vocab = isVocabItem(p.item) ? p.item : null;
  const n = chain?.length ?? 0;

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('chain');
  const [index, setIndex] = useState(0);
  const [log, setLog] = useState<LinkLog[]>([]);
  const [hintUsed, setHintUsed] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [result, setResult] = useState<(AttemptResult & { hits: number }) | null>(null);
  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const emit = (r: AttemptResult & { hits: number }): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };

  const showHint = (): void => {
    if (hintOpen || phase !== 'chain') return;
    setHintOpen(true);
    setHintUsed(true);
    p.onHint();
  };

  const onSubmit = (r: TextAnswerResult): void => {
    if (!chain || phase !== 'chain') return;
    const link = chain[index];
    if (!link) return;
    const state: LinkState = r.correct ? 'right' : r.nearMiss ? 'close' : 'miss';
    const next: LinkLog[] = [...log, { form: link.form, given: r.given, expected: link.accept[0] as string, state }];
    setLog(next);
    setHintOpen(false);
    if (index + 1 < n) setIndex(index + 1);
    else emit(chainResult(next, n, { ms: elapsed(), hintUsed }));
  };

  const fromStep = (p.step.params.sentence ?? '').trim();
  const display = vocab ? { word: vocab.word, kana: vocab.kana, pos: head?.pos ?? null } : fromStep.length > 0 ? { word: fromStep, kana: (p.step.params.kana ?? '').trim() || fromStep, pos: engineHead?.pos ?? null } : null;
  const gloss = vocab ? (vocab.meanings.length > 0 ? vocab.meanings.join(' · ') : null) : ((p.step.params.promptEn ?? '').trim() || null);

  if (!chain || !display) {
    return (
      <div class="gr gr-chain" data-state="unavailable">
        <div class="gr__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{S.cannotBuild}</p>
          {vocab ? (
            <p>
              <span class="eyebrow">{S.forgeDictionary}</span> <span lang="ja">{vocab.word}</span>
            </p>
          ) : null}
          <p class="gr__why">{S.shownNotTested}</p>
        </div>
        <div class="gr__actions">
          <button type="button" class="hanko" onClick={() => emit(Object.assign(attempt({ ms: elapsed(), correct: true, hintUsed: true }), { hits: 0 }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const current = chain[index] as ChainLink;
  const revealed = phase === 'done';
  const kind = result ? (result.nearMiss ? 'partial' : result.correct ? 'correct' : 'wrong') : 'info';
  const band = result ? (result.correct ? S.chainPerfect : result.nearMiss ? S.chainOneMiss : S.chainMany) : '';
  const missed = log.filter((l) => l.state !== 'right');

  return (
    <div class="gr gr-chain" data-phase={phase} data-index={index} data-length={n}>
      <p class="gr__prompt">{fill(S.chainPrompt, { n })}</p>
      <div class="gr__word">
        <span class="eyebrow">{S.forgeDictionary}</span>
        <span class="gr__word-ja" lang="ja" data-dictionary="true">
          {display.word}
        </span>
        {display.kana !== display.word ? (
          <span class="gr__word-kana" lang="ja">
            {display.kana}
          </span>
        ) : null}
        {display.pos ? <span class="gr__gloss">{POS_GROUP_LABEL[display.pos]}</span> : null}
        {gloss ? (
          <span class="gr__gloss" data-gloss="true">
            {gloss}
          </span>
        ) : null}
      </div>

      <ol class="gr-chain__log" aria-label={S.chainLog}>
        {chain.map((link, i) => {
          const entry = log[i];
          const state = entry ? entry.state : i === index && !revealed ? 'current' : 'pending';
          return (
            <li key={link.form} class="gr-chain__row" data-state={state} data-form={link.form} aria-current={state === 'current' ? 'step' : undefined}>
              <span class="gr-chain__mark" aria-hidden="true">
                {entry ? MARK[entry.state] : i + 1}
              </span>
              <span>
                <span class="eyebrow">{FORM_LABEL[link.form]}</span>
                {entry ? (
                  <>
                    {' '}
                    {entry.state !== 'right' ? (
                      <span class="gr__given" lang="ja">
                        {entry.given}
                      </span>
                    ) : null}{' '}
                    <span lang="ja" data-expected="true">
                      {entry.state === 'right' ? entry.given : entry.expected}
                    </span>
                  </>
                ) : null}
              </span>
              <span class="gr-chain__progress">{entry ? STATE_TEXT[entry.state] : ''}</span>
            </li>
          );
        })}
      </ol>

      {!revealed ? (
        <div class="gr-chain__step" data-step={index}>
          <p class="gr__gloss">
            <span class="gr-chain__progress" data-progress="true">
              {fill(S.chainStep, { i: index + 1, n })}
            </span>{' '}
            <span class="gr__target" data-target-form="true">
              {FORM_LABEL[current.form]}
            </span>
          </p>
          <div class="gr__actions">
            {hintOpen ? null : (
              <button type="button" class="btn btn--ghost" onClick={showHint}>
                {S.forgeShowRule}
              </button>
            )}
          </div>
          {hintOpen ? (
            <div class="gr__reveal reveal ink-nijimi" data-kind="info" data-hint="true">
              <p>
                <span class="eyebrow">{S.forgeRule}</span> <span>{FORM_HINT[current.form]}</span>
              </p>
              <p class="gr__why">{S.hintUsedNote}</p>
            </div>
          ) : null}
          <TextAnswer key={index} mode="ja" accept={current.accept} onSubmit={onSubmit} autoFocus reveal={false} label={SD.answerField} particleSlip={false} kanaOnlyPolicy="good" missTags={['conjugation']} />
          <ChainHintKey key={`hint-${index}`} onHint={hintOpen ? undefined : showHint} />
        </div>
      ) : null}

      {revealed && result ? (
        <div class="gr__reveal reveal ink-nijimi" data-kind={kind}>
          <p data-tally="true">{fill(S.chainTally, { hits: result.hits, n })}</p>
          <p data-band="true">{band}</p>
          {missed.map((l) => (
            <p key={l.form} class="gr__why" data-rule={l.form}>
              <span class="eyebrow">{FORM_LABEL[l.form]}</span> <span>{FORM_HINT[l.form]}</span>
            </p>
          ))}
          <p class="gr__why">{S.kanaAccepted}</p>
        </div>
      ) : null}
    </div>
  );
}
