/**
 * TSUZUKU — 耳閃 Audio Flash (design 04 §2): the voice says the word — from
 * Green inside one of its collocations — and nothing is written on screen
 * until the answer is in. First two exposures (the planner sends
 * `params.choices`, one of them a minimal-pair / confusable distractor): four
 * meaning choices; afterwards the meaning is typed (fuzzy English, with the
 * 「I meant that」 override). Space replays; replays are counted. A miss is
 * tagged `listening`. After the answer: the word with furigana, the kana,
 * what was heard, pitch line, collocations and the gloss.
 *
 * `keys` is `text` so the slow rule never grades the typed half (it needs a
 * mature card, which a choices-mode card — exposures < 2 — can never be).
 *
 * Voice pack (design 08 §8): `spokenText` is unchanged, and `speakWord` keys
 * it — `item.id` for the bare word, `${item.id}#col<k>` for the k-th
 * collocation — so the pack serves the T3 ear clip and falls back to the
 * device voice when it misses.
 *
 * Without an audible Japanese voice (`voiceAudible(services.audio)`, read at render) the
 * word and its kana are shown up front with a no-voice note instead of the
 * Speaker, and a miss is tagged `word-choice` rather than `listening` — the
 * card is then a meaning card, not a listening card.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BELT_IDS, type ErrorTag } from '@/content/types';
import { services } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { ChoiceGrid } from '../ChoiceGrid';
import { voiceAudible } from '../voice';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { gradeChoice, gradeEn } from '../check';
import { S as X } from '../strings';
import { MissingItem, missingResult, useDrillKeys, useLatency } from '../kana/KanaFlash';
import { Speaker, VocabAfter, WordHead, beltNow, correctChoice, isVocabItem, speakWord } from './MeaningGuard';
import { acceptEn } from './MeaningRecall';
import { S } from './strings';
import './vocab.css';

export const meta: ExerciseMeta = {
  id: 'audio-flash',
  facet: 'listen',
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'text',
};

/** From Green the word is spoken inside one of its collocations (the first that contains it). */
export function spokenText(item: { word: string; collocations?: string[] }, belt: string): string {
  const green = BELT_IDS.indexOf(belt as (typeof BELT_IDS)[number]) >= BELT_IDS.indexOf('green');
  if (!green) return item.word;
  return (item.collocations ?? []).find((c) => c.includes(item.word)) ?? item.word;
}

export function AudioFlash(p: ExerciseProps): JSX.Element {
  return <AudioFlashBody key={p.step.id} {...p} />;
}

function AudioFlashBody(p: ExerciseProps): JSX.Element {
  const item = isVocabItem(p.item) ? p.item : null;
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const fired = useRef(false);
  const hasVoice = voiceAudible(services.audio);
  const missTags: ErrorTag[] = hasVoice ? ['listening'] : ['word-choice'];
  const text = useMemo(() => (item ? spokenText(item, beltNow()) : ''), [item]);
  const choices = p.step.params.choices ?? [];
  const mc = item !== null && choices.length >= 2 && correctChoice(choices, item, p.step.params) >= 0;
  const correctIdx = item ? correctChoice(choices, item, p.step.params) : -1;
  const accept = item ? acceptEn(item.meanings, p.step.params) : [];

  const play = (): void => {
    if (item) void speakWord(item, text);
  };
  useEffect(() => {
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, text]);

  const replay = (): void => {
    if (fired.current || !item || !hasVoice) return;
    replaysRef.current += 1;
    setReplays(replaysRef.current);
    play();
    p.onReplay();
  };
  useDrillKeys(root, { onReplay: replay });

  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const pick = (i: number): void => {
    finish(gradeChoice(i, correctIdx, { ms: ms(), replays: replaysRef.current, answer: choices[i] ?? '', missTags }));
  };

  const typed = (r: TextAnswerResult): void => {
    finish(gradeEn(r.given, accept, { ms: ms(), replays: replaysRef.current, override: r.override, missTags }));
  };

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const pickedIdx = done?.answer !== undefined ? choices.indexOf(done.answer) : -1;
  const heardIn = text !== item.word;

  return (
    <div class="drill audio-flash" data-exercise="audio-flash" data-mode={mc ? 'choices' : 'text'} data-voice={hasVoice ? 'true' : 'false'} data-revealed={done ? 'true' : 'false'} ref={root}>
      <p class="drill__prompt">{mc ? X.chooseMeaning : S.typeWhatItMeans}</p>
      {!done && !hasVoice ? (
        <div class="vocab__head">
          <WordHead item={item} mode={p.furigana} kana />
          <p class="drill__hint audio-flash__novoice" role="status">
            {S.noVoice}
          </p>
        </div>
      ) : !done ? (
        <div class="vocab__head">
          <Speaker onClick={replay} disabled={false} replays={replays} big />
          <p class="drill__hint">{S.listenFirst}</p>
          <p class="drill__hint">{S.replayHint}</p>
        </div>
      ) : (
        <div class="vocab__head">
          <WordHead item={item} mode={p.furigana} kana />
          {heardIn && hasVoice ? (
            <p class="drill__hint">
              <span class="drill__label">{S.heardIn}</span>{' '}
              <span class="drill__ja" lang="ja">
                {text}
              </span>
            </p>
          ) : null}
          {hasVoice ? <Speaker onClick={replay} disabled replays={replays} /> : null}
        </div>
      )}

      {mc ? (
        <ChoiceGrid choices={choices} correct={correctIdx} picked={pickedIdx >= 0 ? pickedIdx : undefined} onPick={pick} label={X.choicesLabel} />
      ) : (
        <TextAnswer mode="en" accept={accept} autoFocus label={X.englishField} onSubmit={typed} />
      )}

      {done ? <VocabAfter item={item} correct={done.correct ? (done.selfRating !== undefined ? 'near' : 'true') : 'false'} jj={p.jj} furigana={p.furigana} meaning={mc || done.correct} /> : null}
    </div>
  );
}
