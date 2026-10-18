/**
 * TSUZUKU — 仮名鍛造 Kana Forge (design 04 §1): the voice says the kana (or,
 * without a Japanese voice, the romaji is the prompt and the Listen button is
 * not shown) → type the kana through the IME. Exact kana required: カタカナ
 * and ひらがな are different answers (`allowKatakanaFold: false`), katakana
 * mode switches on by itself for a katakana item, a small-kana or long-vowel
 * slip is a Block tagged by kind. The romaji shown is the IME spelling
 * (`imeRomaji`: を → wo, ティ → thi) so what is read can be typed. With a
 * voice available the romaji sits behind 「Show romaji」 (also the frame's
 * `?` / Hint button), which counts as a hint (`onHint`, Hard ceiling) —
 * except for を/ヲ (`SPOKEN_HOMOPHONES`),
 * which the voice pronounces exactly like お/オ: their romaji is shown up
 * front at no cost, with the audio still playing. Space replays; replays are
 * counted. The kana plays with `clip: item.id` (design 08 §10.5; the pack
 * falls back to the device voice when it misses) and the first long-vowel /
 * っ item from Station 2 opens with the `held-beat` card (`<KanaTeach>`);
 * dismissing it re-bases the latency clock and plays the kana again (not a
 * replay), since the prompt sounded under the card.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { services, speak } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { voiceAudible } from '../voice';
import { acceptForms, attempt } from '../check';
import { S as X } from '../strings';
import { KanaTeach, MissingItem, imeRomaji, isKanaItem, missingResult, romajiLabel, useDrillKeys, useLatency } from './KanaFlash';
import { S } from './strings';
import './kana.css';

/** Kana whose spoken form is shared with another kana (を ≡ お, ヲ ≡ オ): TTS cannot distinguish them. */
export const SPOKEN_HOMOPHONES: ReadonlySet<string> = new Set(['を', 'ヲ']);
export function isSpokenHomophone(kana: string): boolean {
  return SPOKEN_HOMOPHONES.has(kana);
}

export const meta: ExerciseMeta = {
  id: 'kana-forge',
  facet: 'prod',
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

export function KanaForge(p: ExerciseProps): JSX.Element {
  return <KanaForgeBody key={p.step.id} {...p} />;
}

function KanaForgeBody(p: ExerciseProps): JSX.Element {
  const item = isKanaItem(p.item) ? p.item : null;
  const kana = item?.kana ?? '';
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [romajiShown, setRomajiShown] = useState(false);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const fired = useRef(false);
  const hasVoice = voiceAudible(services.audio);
  const romaji = item ? imeRomaji(item) : (p.step.params.promptEn ?? '');
  // を/ヲ are spoken exactly like お/オ: the voice alone cannot name them, so
  // their IME romaji (wo) is shown up front at no hint cost (audio still plays).
  const spokenHomophone = item ? isSpokenHomophone(item.kana) : false;
  const showRomaji = !hasVoice || romajiShown || spokenHomophone;
  const hintUsed = hasVoice && romajiShown;
  const accept = acceptForms(item, p.step.params);

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
  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const reveal = (): void => {
    if (romajiShown || fired.current) return;
    setRomajiShown(true);
    if (hasVoice) p.onHint();
  };
  useDrillKeys(root, { onReplay: replay, onHint: item && !showRomaji && done === null ? reveal : undefined });

  const submit = (r: TextAnswerResult): void => {
    finish(attempt({ ms: ms(), correct: r.correct, nearMiss: r.nearMiss, errorTags: r.tags, answer: r.given, hintUsed, replays: replaysRef.current }));
  };

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  return (
    <div class="drill kana-forge" data-exercise="kana-forge" data-script={item.script} ref={root}>
      <KanaTeach
        item={item}
        drill="forge"
        onDismissed={() => {
          ms.restart();
          play();
        }}
      />
      <div class="drill__row drill__row--between">
        <p class="drill__prompt">{hasVoice ? S.forgePromptAudio : S.forgePromptRomaji}</p>
        <span class="chip">{item.script === 'katakana' ? S.katakanaItem : S.hiraganaItem}</span>
      </div>

      <div class="drill__row drill__row--between">
        {showRomaji ? (
          <p class="drill__glyph kana-forge__romaji" lang="en">
            {romaji}
          </p>
        ) : (
          <button type="button" class="btn btn--ghost" onClick={reveal} disabled={done !== null}>
            {S.showRomaji}
          </button>
        )}
        {hasVoice ? (
          <button type="button" class="kana-ear__speaker" onClick={replay} disabled={done !== null} aria-keyshortcuts="Space" aria-label={X.replay}>
            <span class="kana-ear__glyph" aria-hidden="true" lang="ja">
              耳
            </span>
            <span>{replays > 0 ? X.replay : S.listen}</span>
          </button>
        ) : null}
      </div>
      {hintUsed ? (
        <p class="drill__hint" role="status">
          {S.romajiShown}
        </p>
      ) : null}

      <TextAnswer mode="ja" accept={accept} katakana={item.script === 'katakana'} allowKatakanaFold={false} particleSlip={false} autoFocus label={X.answerField} onSubmit={submit} />

      {done ? (
        <div class="drill__after" data-correct={done.nearMiss ? 'near' : done.correct ? 'true' : 'false'}>
          <p>
            <span class="eyebrow">{S.kanaLabel}</span>{' '}
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
