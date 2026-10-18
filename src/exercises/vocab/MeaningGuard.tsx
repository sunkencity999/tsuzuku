/**
 * TSUZUKU — 意味ガード Meaning Guard (design 04 §2): the word (furigana per
 * the learner's mode, fog hides a reading once that kanji's `read` card has
 * S ≥ 7 d; a fog tap is a hint, and so is the frame's `?` / Hint button,
 * which shows the reading under the word while it is hidden) plus audio →
 * four meaning choices. Exact →
 * Good, wrong → Again tagged `word-choice`. First two exposures only; the
 * planner hands the choices in `params.choices` (`learn/distractors
 * .meaningChoices`); without them the grid is built here from the loaded
 * confusables, seeded. After answering: pitch line over the kana (when
 * `pitch` is present), 1–3 collocations, and from Station 34 the J-J
 * definition with English behind a tap.
 *
 * This file also hosts the helpers the vocab drills share: `isVocabItem`,
 * `wordRuby`, `fogFor`, `readingHidden`, `vocabPoolFrom`, `speakWord` (keyed
 * for the voice pack: `item.id` for the bare word, `${item.id}#col<k>` for
 * the k-th collocation, design 08 §8), `wordClipKey`, `beltNow`,
 * `correctChoice` (`params.answer`, then the primary gloss, before any
 * secondary meaning — so the choice the planner placed is the graded one),
 * `<WordHead>`, `<VocabAfter>`, `<Speaker>`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import { kanjiIn, parseRuby } from '@/content/ruby';
import type { Belt, ContentItem, VocabItem } from '@/content/types';
import { speak } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { containsKanji, normalizeEn } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import type { FuriganaMode } from '@/shared/store-types';
import { Ruby } from '@/shared/ui/Ruby';
import { meaningChoices } from '@/learn';
import { beltForStation, store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { PitchLine } from '../PitchLine';
import { gradeChoice } from '../check';
import { S as X } from '../strings';
import { MissingItem, missingResult, useDrillKeys, useLatency } from '../kana/KanaFlash';
import { S } from './strings';
import './vocab.css';

export const meta: ExerciseMeta = {
  id: 'meaning-guard',
  facet: 'rec',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Shared vocab helpers                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** Furigana is visible while a kanji's `read` card has S < 7 d (design 05 §12). */
export const FOG_READ_DAYS = 7;

export function isVocabItem(item: ContentItem | null | undefined): item is VocabItem {
  return !!item && 'word' in item && 'kana' in item && 'meanings' in item && 'pos' in item;
}

/**
 * Ruby markup for a dictionary word: shared leading / trailing kana stay
 * outside, the kanji core gets the remaining reading (食べる/たべる →
 * `{食|た}べる`, お茶/おちゃ → `お{茶|ちゃ}`). A word without kanji is returned as is;
 * a core with kana inside it (食べ物) takes the whole reading.
 */
export function wordRuby(word: string, kana: string): string {
  if (!containsKanji(word) || kana.length === 0 || word === kana) return word;
  const w = Array.from(word);
  const k = Array.from(kana);
  let pre = 0;
  while (pre < w.length && pre < k.length && w[pre] === k[pre] && !containsKanji(w[pre] as string)) pre++;
  let suf = 0;
  while (suf < w.length - pre && suf < k.length - pre && w[w.length - 1 - suf] === k[k.length - 1 - suf] && !containsKanji(w[w.length - 1 - suf] as string)) suf++;
  const base = w.slice(pre, w.length - suf).join('');
  const reading = k.slice(pre, k.length - suf).join('');
  if (base.length === 0 || reading.length === 0) return `{${word}|${kana}}`;
  return `${w.slice(0, pre).join('')}{${base}|${reading}}${w.slice(w.length - suf).join('')}`;
}

/** Fog predicate for `<Ruby>`: hide the reading when every kanji in `base` has a mature-enough `read` card. */
export function fogFor(base: string): boolean {
  const kanji = kanjiIn(base);
  if (kanji.length === 0) return false;
  return kanji.every((ch) => {
    const c = store.cards.get(`j-${ch}#read`);
    return !!c && c[1] >= FOG_READ_DAYS;
  });
}

/**
 * Whether `<WordHead>` keeps the word's reading from the learner in `mode`
 * (so a reveal has something to show): a kana-only word has none; `off` and
 * `tap` hide it; `fog` hides it only when `fogFor` fogs the kanji core.
 */
export function readingHidden(item: VocabItem, mode: FuriganaMode): boolean {
  if (item.kana === item.word) return false;
  if (mode === 'always') return false;
  if (mode === 'off' || mode === 'tap') return true;
  return parseRuby(wordRuby(item.word, item.kana)).some((seg) => seg.reading !== null && fogFor(seg.base));
}

/** Vocab items behind `params.distractorIds`, else the item's `confusables`, that are loaded. */
export function vocabPoolFrom(item: VocabItem, params: StepParams): VocabItem[] {
  const ids = params.distractorIds ?? item.confusables ?? [];
  return ids.map((id) => content.get(id)).filter(isVocabItem);
}

/**
 * Clip key of what `speakWord(item, text)` says (design 08 §8): the item id
 * for the bare word, `${item.id}#col<k>` for its k-th collocation, `null`
 * for any other text (no pack clip exists for it; the device voice reads it).
 */
export function wordClipKey(item: Pick<VocabItem, 'id' | 'word' | 'collocations'>, text?: string): string | null {
  if (text === undefined || text === item.word) return item.id;
  const k = item.collocations?.indexOf(text) ?? -1;
  return k >= 0 ? `${item.id}#col${k}` : null;
}

/**
 * The word through the audio slot: the bare word goes with its kana reading
 * (single kanji are misread in isolation) and its clip key; any other `text`
 * (a collocation) is spoken as written with the `#col<k>` key, since passing
 * the word's kana would make the engine say the bare word instead of the
 * phrase. The pack resolves the key to a cue and falls back to the device
 * voice when it misses, so with no pack nothing changes.
 */
export function speakWord(item: VocabItem, text?: string): Promise<void> {
  const clip = wordClipKey(item, text);
  if (text === undefined || text === item.word) return speak(item.word, { kana: item.kana, clip: item.id });
  return speak(text, clip ? { clip } : undefined);
}

export function beltNow(): Belt {
  return beltForStation(store.progress.value.station);
}

export interface WordHeadProps {
  item: VocabItem;
  mode: FuriganaMode;
  /** A fogged reading was tapped open. */
  onReveal?(): void;
  /** Show the kana under the word (default false). */
  kana?: boolean;
}

export function WordHead(p: WordHeadProps): JSX.Element {
  return (
    <div class="vocab__head">
      <p class="drill__word">
        <Ruby ja={wordRuby(p.item.word, p.item.kana)} mode={p.mode} fog={fogFor} onReveal={() => p.onReveal?.()} />
      </p>
      {p.kana && p.item.kana !== p.item.word ? (
        <p class="vocab__kana" lang="ja">
          {p.item.kana}
        </p>
      ) : null}
    </div>
  );
}

export interface SpeakerProps {
  onClick(): void;
  disabled?: boolean;
  replays: number;
  big?: boolean;
}

export function Speaker(p: SpeakerProps): JSX.Element {
  return (
    <button type="button" class={p.big ? 'vocab__speaker vocab__speaker--big' : 'vocab__speaker'} onClick={() => p.onClick()} disabled={p.disabled} aria-keyshortcuts="Space" aria-label={X.replay}>
      <span aria-hidden="true" lang="ja">
        耳
      </span>
      <span>{p.replays > 0 ? X.replay : S.listen}</span>
    </button>
  );
}

export interface VocabAfterProps {
  item: VocabItem;
  /** Panel accent: 'true' | 'false' | 'near'. */
  correct: 'true' | 'false' | 'near';
  /** J-J reveal (Station 34+). */
  jj: boolean;
  /** Print the English meaning(s) (default true; `false` when the widget already shows them). */
  meaning?: boolean;
  furigana: FuriganaMode;
}

/** Pitch line, collocations, and the gloss (J-J with English behind a tap when `jj`). */
export function VocabAfter(p: VocabAfterProps): JSX.Element {
  const [en, setEn] = useState(false);
  const def = p.jj ? p.item.definitionJa : undefined;
  const meanings = p.item.meanings.join(' · ');
  return (
    <div class="drill__after vocab__after" data-correct={p.correct}>
      {p.item.pitch !== undefined ? <PitchLine kana={p.item.kana} pitch={p.item.pitch} /> : null}
      {def ? (
        <div>
          <span class="eyebrow">{S.jjLabel}</span>
          <p class="vocab__definition">
            <Ruby ja={def.ja} mode={p.furigana} />
          </p>
          <button type="button" class="btn btn--ghost btn--sm" aria-pressed={en} onClick={() => setEn((v) => !v)}>
            {en ? S.hideEnglish : X.showEnglish}
          </button>
          {en ? <p class="vocab__meaning-en">{meanings}</p> : null}
        </div>
      ) : (p.meaning ?? true) ? (
        <p class="vocab__meaning-en">
          <span class="eyebrow">{S.meaningLabel}</span> <span>{meanings}</span>
          {p.jj ? <span class="drill__hint"> · {S.noDefinition}</span> : null}
        </p>
      ) : null}
      {p.item.collocations && p.item.collocations.length > 0 ? (
        <div>
          <span class="eyebrow">{X.collocations}</span>
          <ul class="vocab__collocations">
            {p.item.collocations.slice(0, 3).map((c) => (
              <li key={c} class="vocab__collocation" lang="ja">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Index of the correct choice, in tiers so a secondary gloss that also sits
 * among the choices never outranks the one the planner placed (風情: taste |
 * charm — the grid holds `meanings[0]`): `params.answer`, then the primary
 * gloss (`meanings[0]`), then `params.accept`, then the other meanings, each
 * through `normalizeEn`; `-1` when none matches.
 */
export function correctChoice(choices: readonly string[], item: VocabItem, params: StepParams): number {
  const tiers: readonly (readonly string[])[] = [[params.answer ?? ''], [item.meanings[0] ?? ''], params.accept ?? [], item.meanings.slice(1)];
  for (const tier of tiers) {
    const ok = new Set(tier.filter((m) => m.length > 0).map(normalizeEn));
    if (ok.size === 0) continue;
    const i = choices.findIndex((c) => ok.has(normalizeEn(c)));
    if (i >= 0) return i;
  }
  return -1;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Meaning Guard                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export function MeaningGuard(p: ExerciseProps): JSX.Element {
  return <MeaningGuardBody key={p.step.id} {...p} />;
}

function MeaningGuardBody(p: ExerciseProps): JSX.Element {
  const item = isVocabItem(p.item) ? p.item : null;
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const hinted = useRef(false);
  const [hintTaken, setHintTaken] = useState(false);
  const [readingShown, setReadingShown] = useState(false);
  const fired = useRef(false);

  const choices = useMemo<string[]>(() => {
    if (!item) return [];
    const given = p.step.params.choices;
    if (given && given.length >= 2 && correctChoice(given, item, p.step.params) >= 0) return given;
    const rng = rngFor(store.seed(), store.today(), p.step.id, 'meaning-guard');
    return meaningChoices(item, vocabPoolFrom(item, p.step.params), rng);
  }, [item, p.step.id, p.step.params]);
  const correctIdx = item ? correctChoice(choices, item, p.step.params) : -1;

  useEffect(() => {
    if (item) void speakWord(item);
  }, [item]);

  const replay = (): void => {
    if (fired.current || !item) return;
    replaysRef.current += 1;
    setReplays(replaysRef.current);
    void speakWord(item);
    p.onReplay();
  };
  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const pick = (i: number): void => {
    const r = gradeChoice(i, correctIdx, { ms: ms(), replays: replaysRef.current, answer: choices[i] ?? '', missTags: ['word-choice'], hintUsed: hinted.current });
    finish(r);
  };

  /** A fogged reading tapped open: the hint is taken (Hard ceiling). */
  const reveal = (): void => {
    if (hinted.current || fired.current) return;
    hinted.current = true;
    setHintTaken(true);
    p.onHint();
  };
  /** The frame's `?` / Hint button: show the reading under the word — the same hint as a fog tap. */
  const showReading = (): void => {
    if (hinted.current || fired.current) return;
    setReadingShown(true);
    reveal();
  };
  const canShowReading = !!item && !hintTaken && done === null && readingHidden(item, p.furigana);
  useDrillKeys(root, { onReplay: replay, onHint: canShowReading ? showReading : undefined });

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const pickedIdx = done?.answer !== undefined ? choices.indexOf(done.answer) : -1;

  return (
    <div class="drill meaning-guard" data-exercise="meaning-guard" ref={root}>
      <p class="drill__prompt">{X.chooseMeaning}</p>
      <WordHead item={item} mode={p.furigana} onReveal={reveal} kana={readingShown} />
      <div class="drill__row drill__row--between">
        <Speaker onClick={replay} disabled={done !== null} replays={replays} />
        <span class="drill__hint">{S.replayHint}</span>
      </div>

      <ChoiceGrid choices={choices} correct={correctIdx} picked={pickedIdx >= 0 ? pickedIdx : undefined} onPick={pick} label={X.choicesLabel} />

      {done ? <VocabAfter item={item} correct={done.correct ? 'true' : 'false'} jj={p.jj} furigana={p.furigana} /> : null}
    </div>
  );
}
