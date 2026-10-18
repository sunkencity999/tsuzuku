/**
 * TSUZUKU — 文型穴埋め Pattern Cloze (design 04 §4, `grammar:cloze`).
 *
 * A sentence with one blank and its English gloss; TTS plays the whole
 * sentence first (Space / the Replay button play it again and count as
 * replays). First exposure: four tiles (`params.tiles` / `params.choices`,
 * else `clozeTiles` over the point's distractors); from the second exposure
 * the missing piece is typed through `<KanaInput>` and graded with
 * `gradeCloze`: exact or kana-equivalent → Good (a kana answer equals the
 * kanji answer), a slip → Block, a particle slip → Block tagged `particle`,
 * else Again. `params.sentence` carries ruby, `params.blank` the plain
 * `[start, end]` of the piece, `params.answer` the piece itself; without
 * them the drill rotates the point's examples by exposure and blanks the
 * first `clozeHints` entry found, so the surface cannot be memorized.
 * Showing the pattern before answering is a hint (Hard ceiling); the frame's
 * `?` / Hint button shows it too. The sentence plays with the planner's
 * `params.clip` (`g-…#ex<k>`, design 08 §8) when it set one; the pack
 * resolves it and falls back to the device voice when it misses.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { ContentItem, GrammarItem, SentenceExample } from '@/content/types';
import { clozeTiles } from '@/learn';
import { speak, type SpeakOptions } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { diffChars, equivalentJa, normalizeJa } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { KanaInput } from '@/shared/ui/KanaInput';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { attempt, gradeChoice, gradeCloze, whyFor, type CheckResult } from '../check';
import { S as SD } from '../strings';
import { S } from './strings';
import './grammar.css';

export const meta: ExerciseMeta = {
  id: 'pattern-cloze',
  facet: 'cloze',
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

/** Tiles only on the very first exposure (design 04 §4: "typed from the second exposure"). */
export const TILE_EXPOSURES = 1;

export function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}

function cut(ja: string, start: number, end: number): [string, string, string] {
  const plain = toPlain(ja);
  const a = Math.max(0, Math.min(start, plain.length));
  const b = Math.max(a, Math.min(end, plain.length));
  const t = segmentsToTokens(ja, [plain.slice(0, a), plain.slice(a, b), plain.slice(b)]);
  return [t[0]?.ja ?? '', t[1]?.ja ?? '', t[2]?.ja ?? ''];
}

export interface ClozePrompt {
  /** Ruby'd pieces `[before, blank, after]`. */
  pieces: [string, string, string];
  /** Plain sentence (what TTS reads). */
  plain: string;
  /** Kana of the sentence when known (TTS fallback). */
  kana: string | null;
  /** The missing piece (display form). */
  answer: string;
  /** Kana reading of the piece from its ruby, when it differs from `answer` (a kana answer equals the kanji answer). */
  answerKana: string | null;
  gloss: string | null;
}

/** Resolves sentence, blank and answer from the step, else from the point's examples (see the header). */
export function buildClozePrompt(item: GrammarItem | null, params: ExerciseProps['step']['params'], exposures: number): ClozePrompt | null {
  const examples: SentenceExample[] = item?.examples ?? [];
  const hints = item?.clozeHints ?? [];
  let ja = params.sentence;
  let example: SentenceExample | undefined;
  if (ja) example = examples.find((e) => e.ja === ja || toPlain(e.ja) === toPlain(ja as string));
  else if (examples.length > 0) {
    example = examples[((exposures % examples.length) + examples.length) % examples.length];
    ja = example?.ja;
  }
  if (!ja) return null;
  const plain = toPlain(ja);
  let range: [number, number] | null = null;
  let answer = (params.answer ?? '').trim();
  const blank = params.blank;
  if (blank && blank[0] >= 0 && blank[1] > blank[0] && blank[1] <= plain.length) {
    range = [blank[0], blank[1]];
    if (!answer) answer = plain.slice(blank[0], blank[1]);
  } else {
    for (const h of answer ? [answer, ...hints] : hints) {
      const i = plain.indexOf(h);
      if (i >= 0) {
        range = [i, i + h.length];
        if (!answer) answer = h;
        break;
      }
    }
  }
  if (!range || !answer) return null;
  const pieces = cut(ja, range[0], range[1]);
  const kanaForm = toKana(pieces[1]);
  const answerKana = kanaForm && !equivalentJa(kanaForm, answer) && equivalentJa(toPlain(pieces[1]), answer) ? kanaForm : null;
  return { pieces, plain, kana: example?.kana ?? null, answer, answerKana, gloss: params.promptEn ?? example?.en ?? null };
}

/** Tile list for the first exposure: step tiles/choices (answer guaranteed), else `clozeTiles`. */
export function clozeChoices(item: GrammarItem | null, params: ExerciseProps['step']['params'], answer: string, rng: () => number): string[] {
  const given = Array.from(new Set((params.tiles ?? params.choices ?? []).map((t) => t.trim()).filter(Boolean)));
  if (given.length >= 2) return given.some((t) => equivalentJa(t, answer)) ? given : [answer, ...given.slice(0, 3)];
  if (!item) return [];
  return clozeTiles(item, [], rng, answer);
}

type Phase = 'answer' | 'done';

export function PatternCloze(p: ExerciseProps): JSX.Element {
  const item = isGrammarItem(p.item) ? p.item : null;
  const prompt = useMemo(() => buildClozePrompt(item, p.step.params, p.exposures), [item, p.step.params, p.exposures]);
  const rng = useMemo(() => rngFor(store.seed(), store.today(), p.step.id), [p.step.id]);
  const tiles = useMemo(() => (prompt && p.exposures < TILE_EXPOSURES ? clozeChoices(item, p.step.params, prompt.answer, rng) : []), [prompt, item, p.step.params, p.exposures, rng]);
  const correctIdx = prompt ? tiles.findIndex((t) => equivalentJa(t, prompt.answer) || (prompt.answerKana !== null && equivalentJa(t, prompt.answerKana))) : -1;
  const useTiles = tiles.length >= 2 && correctIdx >= 0;
  const accept = useMemo(
    () => [...(prompt?.answerKana ? [prompt.answerKana] : []), ...(p.step.params.accept ?? [])].map((s) => s.trim()).filter(Boolean),
    [prompt, p.step.params.accept],
  );

  const started = useRef(store.now());
  const done = useRef(false);
  const replays = useRef(0);
  const [phase, setPhase] = useState<Phase>('answer');
  const [value, setValue] = useState('');
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [hintShown, setHintShown] = useState(false);
  const [nudge, setNudge] = useState('');
  const [result, setResult] = useState<(AttemptResult & { check?: CheckResult }) | null>(null);
  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const plain = prompt?.plain ?? null;
  const kana = prompt?.kana ?? null;
  const clip = p.step.params.clip;
  /** Kana when the example carries one, the planner's clip key when set; `undefined` when neither (the options are unchanged from before the pack). */
  const speakOptions = (): SpeakOptions | undefined => {
    const o: SpeakOptions = { ...(kana ? { kana } : {}), ...(clip ? { clip } : {}) };
    return Object.keys(o).length > 0 ? o : undefined;
  };
  useEffect(() => {
    if (plain) void speak(plain, speakOptions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plain, kana, clip, p.step.id]);

  const replay = (): void => {
    if (!prompt || phase !== 'answer') return;
    replays.current += 1;
    p.onReplay();
    void speak(prompt.plain, speakOptions());
  };

  const emit = (r: AttemptResult & { check?: CheckResult }): void => {
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

  const pickTile = (i: number): void => {
    if (!useTiles || picked !== undefined || phase !== 'answer' || i < 0 || i >= tiles.length) return;
    setPicked(i);
    emit(gradeChoice(i, correctIdx, { ms: elapsed(), hintUsed: hintShown, replays: replays.current, answer: tiles[i] }));
  };

  const submit = (raw: string): void => {
    if (!prompt || useTiles || phase !== 'answer') return;
    const given = raw.trim();
    if (normalizeJa(given).length === 0) {
      setNudge(SD.nothingTyped);
      return;
    }
    setNudge('');
    emit(gradeCloze(given, prompt.answer, accept, { ms: elapsed(), hintUsed: hintShown, replays: replays.current }));
  };

  useExerciseKeys({
    onChoice: pickTile,
    onReplay: replay,
    onSubmit: () => submit(value),
    onHint: prompt && item && phase === 'answer' && !hintShown ? showHint : undefined,
  });

  if (!prompt || !item) {
    return (
      <div class="gr gr-cloze" data-state="unavailable">
        <div class="gr__reveal status-window" data-kind="info" role="status">
          <p>{S.cannotBuild}</p>
          <p class="gr__why">{S.shownNotTested}</p>
        </div>
        <div class="gr__actions">
          <button type="button" class="hanko" onClick={() => emit(attempt({ ms: elapsed(), correct: true, hintUsed: true }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const revealed = phase === 'done';
  const check = result?.check;
  const kind = result ? (result.correct ? (result.nearMiss ? 'near' : 'correct') : result.nearMiss ? 'near' : 'wrong') : 'info';
  const given = result?.answer ?? '';
  const showDiff = revealed && !useTiles && result && !result.correct && given.length > 0;

  return (
    <div class="gr gr-cloze" data-phase={phase} data-mode={useTiles ? 'tiles' : 'typed'}>
      <p class="gr__prompt">{useTiles ? S.clozePromptTiles : S.clozePromptTyped}</p>
      <p class="gr__sentence" lang="ja" aria-label={S.clozeSentence}>
        {prompt.pieces[0] ? <Ruby ja={prompt.pieces[0]} mode={p.furigana} /> : null}
        <span class="gr__blank" data-blank="true" data-filled={revealed ? 'true' : 'false'} data-state={revealed ? (result?.correct ? 'correct' : 'wrong') : undefined} aria-label={S.clozeBlank}>
          {revealed ? (
            <>
              {showDiff ? <span class="gr__given">{given}</span> : null}
              <Ruby ja={prompt.pieces[1]} mode="always" />
            </>
          ) : (
            '＿＿'
          )}
        </span>
        {prompt.pieces[2] ? <Ruby ja={prompt.pieces[2]} mode={p.furigana} /> : null}
      </p>
      {prompt.gloss ? (
        <p class="gr__gloss">
          <span class="gr__label">{S.clozeGloss}</span> <span>{prompt.gloss}</span>
        </p>
      ) : null}

      <div class="gr__actions">
        <button type="button" class="btn btn--ghost" aria-keyshortcuts="Space" disabled={phase !== 'answer'} onClick={replay}>
          {S.clozeReplay}
        </button>
        {phase === 'answer' && !hintShown ? (
          <button type="button" class="btn btn--ghost" onClick={showHint}>
            {S.clozeShowPattern}
          </button>
        ) : null}
      </div>
      {hintShown && phase === 'answer' ? (
        <div class="gr__reveal status-window" data-kind="info" data-hint="true">
          <p>
            <span class="gr__label">{S.clozePattern}</span> <span lang="ja">{item.pattern}</span>
          </p>
          {item.formation[0] ? <p class="gr__why">{item.formation[0]}</p> : null}
          <p class="gr__why">{S.hintUsedNote}</p>
        </div>
      ) : null}

      {useTiles ? (
        <ChoiceGrid choices={tiles} onPick={pickTile} picked={picked} correct={correctIdx} ja label={S.clozeTiles} />
      ) : (
        <div class="gr__input">
          <KanaInput value={value} onChange={setValue} onSubmit={submit} autoFocus disabled={phase !== 'answer'} label={SD.answerField} />
          {nudge ? (
            <p class="gr__gloss" role="status">
              {nudge}
            </p>
          ) : null}
        </div>
      )}

      {revealed ? (
        <div class="gr__reveal status-window" data-kind={kind}>
          {!result?.correct || result.nearMiss ? (
            <p>
              <span class="gr__label">{SD.correctForm}</span> <span class="gr__form" lang="ja">{prompt.answer}</span>
            </p>
          ) : null}
          {showDiff ? (
            <p>
              <span class="gr__label">{SD.yours}</span>{' '}
              <span class="gr__diff" lang="ja">
                {diffChars(given, check?.expected ?? prompt.answer).map(([ch, k], i) => (
                  <span key={i} class={`diff ${['diff--same', 'diff--extra', 'diff--missing'][k]}`} data-diff={k}>
                    {ch}
                  </span>
                ))}
              </span>
            </p>
          ) : null}
          {check ? <p class="gr__why">{whyFor(check)}</p> : null}
          <p>
            <span class="gr__label">{S.clozePattern}</span> <span lang="ja">{item.pattern}</span> <span>{item.meaning}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
