/**
 * TSUZUKU — 文中読み Kanji Read (design 04 §3, `kanji:read`).
 *
 * A sentence containing the kanji inside one of its example words, the word
 * highlighted and stripped of furigana (the rest of the sentence follows the
 * learner's furigana setting) → type the word's reading. `params.sentence`
 * carries ruby markup, `params.blank` the target's `[start, end]` in plain
 * coordinates, `params.answer` the kana reading (else the example's kana).
 * The blank is the occurrence the ruby names: a given blank whose reading
 * contradicts the answer (cut through a compound, a homograph's other
 * reading) is re-located to the occurrence of the same word that reads as
 * the answer (`ruby-split.alignedRange`) when there is one; without a blank
 * the first example word with a ruby-aligned occurrence reading as its kana
 * is used, else the first plain occurrence. A blank that still cuts through
 * a ruby group leaves bare kanji on each side (`ruby-split`), never a
 * duplicated base. Without a sentence the drill rotates through
 * `examples` by exposure count, so on and kun readings are learned in words. Graded with `checkJa` through
 * `<TextAnswer mode="ja">` with no particle tolerance: exact or canonical
 * equivalent → Good, a slip → Block, a miss → Again tagged `kanji-reading`.
 * Showing the English gloss before answering is a hint (Hard ceiling); the
 * frame's `?` / Hint button opens it too (`useExerciseKeys({ onHint })`).
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { toPlain } from '@/content/ruby';
import type { ContentItem, KanjiItem, WordExample } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { equivalentJa } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { attempt } from '../check';
import { S as SD } from '../strings';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { alignedRange, spanReading, splitAtPlainRange } from './ruby-split';
import { S } from './strings';
import './kanji.css';

export const meta: ExerciseMeta = {
  id: 'kanji-read',
  facet: 'read',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

export function isKanjiItem(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i && 'examples' in i;
}

/** Splits ruby'd `ja` at plain-text offsets into `[before, target, after]`, each keeping the ruby markup that fits inside it (`splitAtPlainRange`). */
export function splitRuby(ja: string, start: number, end: number): [string, string, string] {
  return splitAtPlainRange(ja, start, end).pieces;
}

export interface ReadPrompt {
  /** Ruby'd sentence pieces around the target, or `null` for a word-only prompt. */
  sentence: [string, string, string] | null;
  /** Plain target word. */
  word: string;
  /** Kana reading expected (the display form). */
  answer: string;
  /** English gloss of the word when known. */
  gloss: string | null;
}

/** Resolves what to show and what to accept from the step and the kanji item (see the header). */
export function buildReadPrompt(kanji: KanjiItem | null, params: ExerciseProps['step']['params'], exposures: number): ReadPrompt | null {
  const examples: WordExample[] = kanji?.examples ?? [];
  const byAnswer = params.answer ? examples.find((e) => equivalentJa(e.kana, params.answer as string)) : undefined;
  if (params.sentence) {
    const plain = toPlain(params.sentence);
    let range: [number, number] | null = null;
    let word = '';
    const blank = params.blank;
    if (blank && blank[0] >= 0 && blank[1] > blank[0] && blank[1] <= plain.length) {
      range = [blank[0], blank[1]];
      word = plain.slice(blank[0], blank[1]);
      // A blank whose ruby contradicts the answer (cut through a compound, a homograph's other reading)
      // moves to the occurrence of the same word that reads as the answer, when the sentence has one.
      const want = params.answer ?? examples.find((e) => e.word === word)?.kana;
      if (want) {
        const reading = spanReading(params.sentence, range[0], range[1]);
        if (reading === null || !equivalentJa(reading, want)) range = alignedRange(params.sentence, word, want) ?? range;
      }
    } else {
      const ordered = byAnswer ? [byAnswer, ...examples.filter((e) => e !== byAnswer)] : examples;
      // The first example with an occurrence whose ruby aligns and reads as the example does; else the first plain hit.
      for (const e of ordered) {
        const at = alignedRange(params.sentence, e.word, e.kana);
        if (at) {
          range = at;
          word = e.word;
          break;
        }
      }
      if (!range) {
        for (const e of ordered) {
          const i = plain.indexOf(e.word);
          if (i >= 0) {
            range = [i, i + e.word.length];
            word = e.word;
            break;
          }
        }
      }
    }
    const ex = examples.find((e) => e.word === word) ?? byAnswer;
    const answer = (params.answer ?? ex?.kana ?? '').trim();
    if (!answer) return null;
    const sentence = range ? splitRuby(params.sentence, range[0], range[1]) : (['', params.sentence, ''] as [string, string, string]);
    return { sentence, word: word || toPlain(sentence[1]), answer, gloss: params.promptEn ?? ex?.en ?? null };
  }
  if (examples.length === 0) {
    if (params.answer && kanji) return { sentence: null, word: kanji.char, answer: params.answer, gloss: params.promptEn ?? null };
    return null;
  }
  const ex = byAnswer ?? (examples[((exposures % examples.length) + examples.length) % examples.length] as WordExample);
  return { sentence: null, word: ex.word, answer: (params.answer ?? ex.kana).trim(), gloss: params.promptEn ?? ex.en };
}

type Phase = 'answer' | 'done';

export function KanjiRead(p: ExerciseProps): JSX.Element {
  const kanji = isKanjiItem(p.item) ? p.item : null;
  const prompt = useMemo(() => buildReadPrompt(kanji, p.step.params, p.exposures), [kanji, p.step.params, p.exposures]);
  const accept = useMemo(() => {
    if (!prompt) return [];
    return Array.from(new Set([prompt.answer, ...(p.step.params.accept ?? [])].map((s) => s.trim()).filter(Boolean)));
  }, [prompt, p.step.params.accept]);

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('answer');
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
  // The frame's `?` / Hint button shows the gloss (withdrawn once shown).
  useExerciseKeys({ onHint: prompt?.gloss && phase === 'answer' && !hintShown ? showHint : undefined });

  const onSubmit = (r: TextAnswerResult): void => {
    emit(attempt({ ms: elapsed(), correct: r.correct, nearMiss: r.nearMiss, hintUsed: hintShown, errorTags: r.tags, answer: r.given }));
  };

  if (!prompt || !kanji) {
    return (
      <div class="kj kj-read" data-state="unavailable">
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

  const revealed = phase === 'done';
  const targetRuby = prompt.sentence ? prompt.sentence[1] : null;
  const revealKind = result ? (result.nearMiss ? 'partial' : result.correct ? 'correct' : 'wrong') : 'info';

  return (
    <div class="kj kj-read" data-phase={phase} data-mode={prompt.sentence ? 'sentence' : 'word'}>
      <p class="kj__prompt">{prompt.sentence ? S.readPrompt : S.readPromptWord}</p>
      {prompt.sentence ? (
        <p class="kj__sentence" lang="ja">
          {prompt.sentence[0] ? <Ruby ja={prompt.sentence[0]} mode={p.furigana} /> : null}
          <mark class="kj__target" data-target="true" aria-label={S.readTarget}>
            <Ruby ja={prompt.sentence[1]} mode={revealed ? 'always' : 'off'} />
          </mark>
          {prompt.sentence[2] ? <Ruby ja={prompt.sentence[2]} mode={p.furigana} /> : null}
        </p>
      ) : (
        <div class="kj__glyph kj__glyph--sm" lang="ja" data-target="true" aria-label={S.readTarget}>
          {prompt.word}
        </div>
      )}

      {prompt.gloss && phase === 'answer' ? (
        <div class="kj__actions">
          {hintShown ? (
            <p class="kj__gloss" data-hint="true">
              <span class="eyebrow">{S.readGloss}</span> <span>{prompt.gloss}</span>
            </p>
          ) : (
            <button type="button" class="btn btn--ghost" onClick={showHint}>
              {S.readShowGloss}
            </button>
          )}
        </div>
      ) : null}
      {hintShown && phase === 'answer' ? <p class="kj__why">{S.hintUsedNote}</p> : null}

      <TextAnswer mode="ja" accept={accept} onSubmit={onSubmit} autoFocus label={SD.reading} particleSlip={false} kanaOnlyPolicy="good" missTags={['kanji-reading']} />

      {revealed ? (
        <div class="kj__reveal reveal ink-nijimi" data-kind={revealKind}>
          <p lang="ja" class="kj__sentence" data-word="true">
            {targetRuby ? <Ruby ja={targetRuby} mode="always" /> : <Ruby ja={`{${prompt.word}|${prompt.answer}}`} mode="always" />}
          </p>
          {prompt.gloss ? (
            <p>
              <span class="eyebrow">{S.readGloss}</span> <span>{prompt.gloss}</span>
            </p>
          ) : null}
          <p>
            <span class="eyebrow">{S.kanjiLabel}</span> <span lang="ja">{kanji.char}</span> <span>{kanji.meanings.join(' · ')}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
