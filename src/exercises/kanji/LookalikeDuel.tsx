/**
 * TSUZUKU — 似字対決 Lookalike Duel (design 04 §3, `kanji:read` variant).
 *
 * A sentence with the target kanji blanked (`params.sentence` with ruby,
 * `params.blank` = the kanji's `[start, end]` in plain coordinates; without a
 * range the first occurrence of the kanji is blanked) and 2–4 look-alike kanji
 * (`params.choices`, else the item's declared `lookalikes` through
 * `kanjiLookalikes`) → tap the one that fits. Without a sentence the drill
 * blanks the kanji inside one of its example words and shows the word's kana
 * as the clue. A blank that cuts through a ruby group ({未来|みらい} blanked
 * at 未) leaves the rest of the word bare beside it and keeps the group's
 * reading as the hint (`ruby-split`; in sentence mode it sits behind the
 * Reading button and the frame's `?` / Hint button), so nothing is
 * duplicated on reveal. The
 * blank fills with the right kanji after the pick; a wrong pick → Again
 * tagged `kanji-meaning`. Fewer than two choices → the kanji is
 * shown, not tested (an honest Hard-ceiling result on Continue).
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { toPlain } from '@/content/ruby';
import type { ContentItem, KanjiItem } from '@/content/types';
import { kanjiLookalikes } from '@/learn';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor, shuffle } from '@/shared/hash';
import { containsHiragana, containsKatakana } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { attempt, gradeChoice } from '../check';
import { S as SD } from '../strings';
import { splitAtPlainRange } from './ruby-split';
import { S } from './strings';
import './kanji.css';

export const meta: ExerciseMeta = {
  id: 'lookalike-duel',
  facet: 'read',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

export const MAX_CHOICES = 4;

export function isKanjiItem(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i && 'examples' in i;
}

export interface DuelPrompt {
  /** Ruby'd pieces `[before, target, after]`; the target is what the blank hides. */
  pieces: [string, string, string];
  /** Kana reading of the blanked word when known (the clue in word mode, a hint in sentence mode). */
  clue: string | null;
  mode: 'sentence' | 'word';
}

function containsKana(s: string): boolean {
  return containsHiragana(s) || containsKatakana(s);
}

/** What to show: the sentence with the kanji blanked, else an example word with the kanji blanked. */
export function buildDuelPrompt(kanji: KanjiItem, params: ExerciseProps['step']['params'], exposures: number): DuelPrompt | null {
  if (params.sentence) {
    const plain = toPlain(params.sentence);
    const blank = params.blank;
    let range: [number, number] | null = null;
    if (blank && blank[0] >= 0 && blank[1] > blank[0] && blank[1] <= plain.length) range = [blank[0], blank[1]];
    else {
      const i = plain.indexOf(kanji.char);
      if (i >= 0) range = [i, i + kanji.char.length];
    }
    if (!range) return null;
    const { pieces, reading } = splitAtPlainRange(params.sentence, range[0], range[1]);
    const kana = reading ?? '';
    return { pieces, clue: kana !== toPlain(pieces[1]) && containsKana(kana) ? kana : null, mode: 'sentence' };
  }
  const examples = kanji.examples.filter((e) => e.word.includes(kanji.char));
  if (examples.length === 0) return { pieces: ['', kanji.char, ''], clue: null, mode: 'word' };
  const ex = examples[((exposures % examples.length) + examples.length) % examples.length];
  if (!ex) return null;
  const i = ex.word.indexOf(kanji.char);
  return { pieces: [ex.word.slice(0, i), kanji.char, ex.word.slice(i + kanji.char.length)], clue: ex.kana, mode: 'word' };
}

/** The choice list: `params.choices` (answer guaranteed present, capped at four), else the declared look-alikes. */
export function duelChoices(kanji: KanjiItem, params: ExerciseProps['step']['params'], rng: () => number): string[] {
  const distinct = Array.from(new Set((params.choices ?? []).map((c) => c.trim()).filter(Boolean)));
  if (distinct.length === 0) return kanjiLookalikes(kanji, [], rng, MAX_CHOICES);
  if (!distinct.includes(kanji.char)) return shuffle(rng, [kanji.char, ...distinct.slice(0, MAX_CHOICES - 1)]);
  const capped = distinct.slice(0, MAX_CHOICES);
  if (capped.includes(kanji.char)) return capped;
  return [kanji.char, ...distinct.filter((c) => c !== kanji.char)].slice(0, MAX_CHOICES);
}

type Phase = 'answer' | 'done';

export function LookalikeDuel(p: ExerciseProps): JSX.Element {
  const kanji = isKanjiItem(p.item) ? p.item : null;
  const rng = useMemo(() => rngFor(store.seed(), store.today(), p.step.id), [p.step.id]);
  const prompt = useMemo(() => (kanji ? buildDuelPrompt(kanji, p.step.params, p.exposures) : null), [kanji, p.step.params, p.exposures]);
  const choices = useMemo(() => (kanji ? duelChoices(kanji, p.step.params, rng) : []), [kanji, p.step.params, rng]);
  const correctIdx = kanji ? choices.indexOf(kanji.char) : -1;

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('answer');
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const emit = (r: AttemptResult): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };

  const showHint = (): void => {
    if (hintShown || phase !== 'answer') return;
    setHintShown(true);
    p.onHint();
  };
  // The frame's `?` / Hint button shows the reading in sentence mode (hint-only set: the ChoiceGrid keeps 1–9).
  useExerciseKeys({ onHint: prompt?.mode === 'sentence' && !!prompt.clue && phase === 'answer' && !hintShown ? showHint : undefined });

  const onPick = (i: number): void => {
    if (picked !== undefined || phase !== 'answer') return;
    setPicked(i);
    emit(gradeChoice(i, correctIdx, { ms: elapsed(), hintUsed: hintShown, missTags: ['kanji-meaning'], answer: choices[i] }));
  };

  if (!kanji || !prompt) {
    return (
      <div class="kj kj-duel" data-state="unavailable">
        <div class="kj__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{S.cannotBuild}</p>
          <p class="kj__why">{S.shownNotTested}</p>
        </div>
        <div class="kj__actions">
          <button type="button" class="hanko" onClick={() => emit(attempt({ ms: elapsed(), correct: true, hintUsed: true }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const testable = choices.length >= 2 && correctIdx >= 0;
  const revealed = phase === 'done';
  const revealKind = result ? (result.correct ? 'correct' : 'wrong') : 'info';
  const sentenceMode = prompt.mode === 'sentence';

  return (
    <div class="kj kj-duel" data-phase={phase} data-mode={prompt.mode} data-state={testable ? undefined : 'shown'}>
      <p class="kj__prompt">{sentenceMode ? S.lookalikePrompt : S.lookalikePromptWord}</p>
      <p class={sentenceMode ? 'kj__sentence' : 'kj__sentence kj__glyph kj__glyph--sm'} lang="ja">
        {prompt.pieces[0] ? <Ruby ja={prompt.pieces[0]} mode={sentenceMode ? p.furigana : 'off'} /> : null}
        <span class="kj__blank" data-blank="true" data-filled={revealed || !testable ? 'true' : 'false'} aria-label={S.lookalikeBlank}>
          {revealed || !testable ? <Ruby ja={prompt.pieces[1]} mode={sentenceMode ? 'always' : 'off'} /> : '＿'}
        </span>
        {prompt.pieces[2] ? <Ruby ja={prompt.pieces[2]} mode={sentenceMode ? p.furigana : 'off'} /> : null}
      </p>
      {!sentenceMode && prompt.clue ? (
        <p class="kj__gloss" lang="ja" data-clue="true">
          <span class="eyebrow" lang="en">
            {S.lookalikeReading}
          </span>{' '}
          {prompt.clue}
        </p>
      ) : null}

      {sentenceMode && prompt.clue && phase === 'answer' ? (
        <div class="kj__actions">
          {hintShown ? (
            <p class="kj__gloss" lang="ja" data-hint="true">
              <span class="eyebrow" lang="en">
                {S.lookalikeReading}
              </span>{' '}
              {prompt.clue}
            </p>
          ) : (
            <button type="button" class="btn btn--ghost" onClick={showHint}>
              {SD.reading}
            </button>
          )}
        </div>
      ) : null}
      {hintShown && phase === 'answer' ? <p class="kj__why">{S.hintUsedNote}</p> : null}

      {testable ? (
        <ChoiceGrid choices={choices} onPick={onPick} picked={picked} correct={correctIdx} ja size="lg" label={S.kanjiLabel} />
      ) : (
        <div class="kj__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{S.lookalikeShownNotTested}</p>
          <div class="kj__actions">
            <button type="button" class="hanko" onClick={() => emit(attempt({ ms: elapsed(), correct: true, hintUsed: true }))}>
              {S.continue}
            </button>
          </div>
        </div>
      )}

      {revealed && testable ? (
        <div class="kj__reveal reveal ink-nijimi" data-kind={revealKind}>
          <p>
            <span class="eyebrow">{S.kanjiLabel}</span> <span lang="ja">{kanji.char}</span> <span>{kanji.meanings.join(' · ')}</span>
          </p>
          {kanji.on.length > 0 || kanji.kun.length > 0 ? (
            <p>
              {kanji.on.length > 0 ? (
                <>
                  <span class="eyebrow">{S.onReading}</span> <span lang="ja">{kanji.on.join('・')}</span>{' '}
                </>
              ) : null}
              {kanji.kun.length > 0 ? (
                <>
                  <span class="eyebrow">{S.kunReading}</span> <span lang="ja">{kanji.kun.join('・')}</span>
                </>
              ) : null}
            </p>
          ) : null}
          {result && !result.correct ? <p class="kj__why">{SD.whyKanjiMeaning}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
