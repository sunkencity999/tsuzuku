/**
 * TSUZUKU — `<ChoiceGrid>`: the numbered choice grid every multiple-choice
 * drill shares (design 04 §0 keys 1–9, 01 §7 44 px targets).
 *
 *  · 2–9 choices in 2 or 3 columns (default: 2 up to four choices, else 3);
 *    text, `lang="ja"` text, or ruby markup (`ruby` = a furigana mode).
 *  · Digits arrive through `useExerciseKeys` from the enclosing
 *    `<ExerciseFrame>` (0-based index); the grid never binds keys itself.
 *  · After a pick (`picked`), or when `reveal` is set without one (timeout,
 *    Guard), every button locks and shows its state as shape + text, never
 *    color alone: `correct` (picked and right), `wrong` (picked and not),
 *    `missed` (the right answer the learner did not pick).
 *  · `onPick` fires once per grid life; later taps and digits are ignored.
 *
 * Motion (design 09 §7 I Bokuten, §7 J): tiles mount as `.ink-nijimi` with
 * `--i` for the capped stagger (motion.css); a correct tile grows a matcha
 * splatter dot (`.choice__dot`, a static SVG mask in ChoiceGrid.css, osu over
 * --dur-1) under its ○ (the mark paints last, so the ring stays on the ink);
 * a wrong tile's text is struck by a dry-brush stroke (`.choice__strike`,
 * three paths hiku-drawn by stroke-dashoffset over --dur-2) in the text's ink,
 * never red, instead of `line-through`. Under reduced motion no `.ink-*` class
 * and no `--i` ride the tiles (the states still show by shape + text).
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { FuriganaMode } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { prefersReducedMotion } from '@/shared/ui/use-reveal';
import { S, fill } from './strings';
import './ChoiceGrid.css';

/** The dry-brush strike over a wrong tile's text: a body stroke and two hairs across a 100 × 20 box (stretched to the text). */
const STRIKE_PATHS: readonly { d: string; w: number }[] = [
  { d: 'M3 11C25 6 45 14 65 9S90 8 97 11', w: 2.4 },
  { d: 'M6 13.5C30 8.5 55 15 95 12.5', w: 0.8 },
  { d: 'M4 8.5C28 5 60 12 96 9', w: 0.6 },
];

function Strike(p: { animate: boolean }): JSX.Element {
  return (
    <svg class="choice__strike" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      {STRIKE_PATHS.map((s, i) => (
        <path key={i} d={s.d} pathLength={1} stroke-width={s.w} class={p.animate ? 'ink-hiku' : undefined} data-axis={p.animate ? 'stroke' : undefined} />
      ))}
    </svg>
  );
}

/** `picked` = chosen with no `correct` index given (ungraded / self-graded grids). */
export type ChoiceState = 'idle' | 'picked' | 'correct' | 'wrong' | 'missed';

export interface ChoiceGridProps {
  choices: string[];
  onPick(i: number): void;
  /** Index the learner chose; set it to lock the grid and reveal states. */
  picked?: number;
  /** Index of the right answer (revealed with `picked` or `reveal`). */
  correct?: number;
  columns?: 2 | 3;
  /** Japanese choices: `lang="ja"` and the JP font. */
  ja?: boolean;
  /** Render choices through `<Ruby>` with this furigana mode (choices may carry `{base|reading}`). Implies `ja`. */
  ruby?: FuriganaMode;
  /** Lock and show states without a pick (timeout / Guard). */
  reveal?: boolean;
  disabled?: boolean;
  /** Accessible name of the group; default "Choices". */
  label?: string;
  /** `lg` for single glyphs (kana, kanji, ○/×). */
  size?: 'md' | 'lg';
}

const STATE_TEXT: Record<Exclude<ChoiceState, 'idle'>, string> = {
  picked: S.yourPick,
  correct: S.correctPick,
  wrong: S.yourPick,
  missed: S.missedPick,
};

const STATE_MARK: Record<Exclude<ChoiceState, 'idle'>, string> = { picked: '●', correct: '○', wrong: '×', missed: '○' };

/** State of choice `i` once the grid is answered (`picked` set) or revealed. */
export function choiceState(i: number, picked: number | undefined, correct: number | undefined, reveal: boolean): ChoiceState {
  if (picked === undefined && !reveal) return 'idle';
  if (picked === i) {
    if (correct === undefined) return 'picked';
    return picked === correct ? 'correct' : 'wrong';
  }
  if (correct === i) return 'missed';
  return 'idle';
}

export function ChoiceGrid(p: ChoiceGridProps): JSX.Element {
  const locked = p.picked !== undefined || Boolean(p.reveal) || Boolean(p.disabled);
  const fired = useRef(false);
  // Re-arm when the exercise instance is reused for a new step (new choices, or `picked` cleared).
  const sig = p.choices.join('\u001f');
  const last = useRef({ sig, picked: p.picked });
  if (last.current.sig !== sig || (last.current.picked !== undefined && p.picked === undefined)) fired.current = false;
  last.current = { sig, picked: p.picked };
  const n = p.choices.length;
  const columns = p.columns ?? (n <= 4 ? 2 : 3);
  const ja = Boolean(p.ja) || p.ruby !== undefined;

  const pick = (i: number): void => {
    if (locked || fired.current || i < 0 || i >= n) return;
    fired.current = true;
    p.onPick(i);
  };

  useExerciseKeys({ onChoice: pick });
  const reduced = prefersReducedMotion();

  return (
    <div
      class="choice-grid"
      role="group"
      aria-label={p.label ?? S.choicesLabel}
      data-columns={columns}
      data-size={p.size ?? 'md'}
      data-locked={locked ? 'true' : undefined}
    >
      {p.choices.map((c, i) => {
        const st = choiceState(i, p.picked, p.correct, Boolean(p.reveal));
        return (
          <button
            key={`${i}:${c}`}
            type="button"
            class={reduced ? 'choice' : 'choice ink-nijimi'}
            style={reduced ? undefined : `--i:${i}`}
            data-index={i}
            data-state={st}
            disabled={locked}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            onClick={() => pick(i)}
          >
            {i < 9 ? (
              <kbd class="choice__key" aria-hidden="true">
                {i + 1}
              </kbd>
            ) : null}
            <span class="choice__text">
              {p.ruby !== undefined ? <Ruby ja={c} mode={p.ruby} /> : ja ? <span lang="ja">{c}</span> : c}
              {st === 'wrong' ? <Strike animate={!reduced} /> : null}
            </span>
            {st === 'correct' ? <span class="choice__dot" aria-hidden="true" /> : null}
            {st !== 'idle' ? (
              <span class="choice__mark" aria-hidden="true">
                {STATE_MARK[st]}
              </span>
            ) : null}
            <span class="sr-only">{st !== 'idle' ? ` (${STATE_TEXT[st]})` : fill(S.choiceN, { n: i + 1 })}</span>
          </button>
        );
      })}
    </div>
  );
}
