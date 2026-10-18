/**
 * TSUZUKU — 仮名の耳 Kana Ear (design 04 §1): the voice says one mora → tap
 * the kana in a 3×3 grid of confusables (ね/れ/わ, シ/ツ, ソ/ン). Keys 1–9
 * pick, Space replays (replays are counted into the result), exact kana
 * required. `params.choices` carries the grid from `learn/distractors.kanaGrid`;
 * without it the grid is built here from the item's `lookalikes` that are
 * loaded, seeded by `store.seed() + today + step.id`. A miss is tagged
 * `voicing` when the picked kana differs only by a dakuten.
 *
 * Without an audible Japanese voice (`voiceAudible(services.audio)`, read at render) the
 * drill is honest: the prompt names the romaji (display spelling, plus the
 * IME spelling when they differ) with a no-voice note, the Listen button is
 * not shown and Space does nothing, so the first prod cards stay answerable.
 *
 * Voice pack (design 08 §10.5): the mora plays with `clip: item.id`; the
 * pack resolves it to the kana clip and falls back to the device voice when
 * it misses. At Station 1 the first Kana Ear opens with the `morae-beats`
 * card (`<KanaTeach>`, design 08 §11): Japanese is made of beats. Dismissing
 * a card re-bases the latency clock and plays the mora again (not a replay):
 * the sound is the prompt, and it played under the card.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import type { KanaItem } from '@/content/types';
import { services, speak } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { equivalentJa } from '@/shared/jp';
import { kanaGrid } from '@/learn';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { voiceAudible } from '../voice';
import { checkJa, gradeChoice } from '../check';
import { S as X } from '../strings';
import { KanaTeach, MissingItem, isKanaItem, missingResult, romajiLabel, useDrillKeys, useLatency } from './KanaFlash';
import { S, fill } from './strings';
import './kana.css';

export const meta: ExerciseMeta = {
  id: 'kana-ear',
  facet: 'prod',
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

export function KanaEar(p: ExerciseProps): JSX.Element {
  return <KanaEarBody key={p.step.id} {...p} />;
}

function KanaEarBody(p: ExerciseProps): JSX.Element {
  const item = isKanaItem(p.item) ? p.item : null;
  const kana = item?.kana ?? '';
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const fired = useRef(false);
  const hasVoice = voiceAudible(services.audio);

  const choices = useMemo<string[]>(() => {
    if (!item) return [];
    const given = p.step.params.choices;
    if (given && given.length >= 2 && given.some((c) => c === item.kana)) return given;
    const rng = rngFor(store.seed(), store.today(), p.step.id, 'kana-ear');
    const pool = (item.lookalikes ?? []).map((id) => content.get<KanaItem>(id)).filter(isKanaItem);
    return kanaGrid(item, [item, ...pool], rng);
  }, [item, p.step.id, p.step.params.choices]);

  const correctIdx = useMemo(() => {
    const exact = choices.indexOf(kana);
    return exact >= 0 ? exact : choices.findIndex((c) => equivalentJa(c, kana));
  }, [choices, kana]);

  const play = (): void => {
    if (kana && item) void speak(kana, { kana, clip: item.id });
  };
  useEffect(() => {
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kana]);

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
    const picked = choices[i] ?? '';
    const check = checkJa(picked, { accept: [kana], kanaOnlyPolicy: 'good', particleSlip: false, allowKatakanaFold: false });
    finish(gradeChoice(i, correctIdx, { ms: ms(), replays: replaysRef.current, answer: picked, missTags: check.correct ? [] : check.tags }));
  };

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const pickedIdx = done?.answer !== undefined ? choices.indexOf(done.answer) : undefined;

  return (
    <div class="drill kana-ear" data-exercise="kana-ear" data-voice={hasVoice ? 'true' : 'false'} ref={root}>
      <KanaTeach
        item={item}
        drill="ear"
        onDismissed={() => {
          ms.restart();
          play();
        }}
      />
      {hasVoice ? (
        <>
          <p class="drill__prompt">{X.tapKanaHeard}</p>
          <div class="drill__row drill__row--between">
            <button type="button" class="kana-ear__speaker" onClick={replay} disabled={done !== null} aria-keyshortcuts="Space" aria-label={X.replay}>
              <span class="kana-ear__glyph" aria-hidden="true" lang="ja">
                耳
              </span>
              <span>{replays > 0 ? X.replay : S.listen}</span>
            </button>
            <span class="drill__hint">{S.replayHint}</span>
          </div>
        </>
      ) : (
        <>
          <p class="drill__prompt">{fill(S.earPromptRomaji, { romaji: romajiLabel(item) })}</p>
          <p class="drill__hint kana-ear__novoice" role="status">
            {S.earNoVoice}
          </p>
        </>
      )}

      <ChoiceGrid choices={choices} correct={correctIdx} picked={pickedIdx !== undefined && pickedIdx >= 0 ? pickedIdx : undefined} onPick={pick} columns={3} ja size="lg" label={S.earGridLabel} />

      {done ? (
        <div class="drill__after" data-correct={done.correct ? 'true' : 'false'}>
          <p>
            <span class="eyebrow">{hasVoice ? S.earHeard : S.earTarget}</span>{' '}
            <span class="drill__ja" lang="ja">
              {item.kana}
            </span>{' '}
            <span>{romajiLabel(item)}</span>
          </p>
          <p>
            <span class="eyebrow">{S.seenIn}</span>{' '}
            <span class="drill__ja" lang="ja">
              {item.exampleWord.word}
            </span>{' '}
            <span>{item.exampleWord.en}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
