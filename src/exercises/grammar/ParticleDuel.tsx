/**
 * TSUZUKU — 助詞対決 Particle Duel (design 04 §4, `grammar:cloze`).
 *
 * A sentence with 1–3 particle slots (`params.blanks`, plain `[start, end]`
 * ranges; the slot's text is the expected particle unless `params.answers`
 * overrides it) → fill each slot from the particle keyboard
 * は・が・を・に・で・と・へ・から・まで・より・の (`params.choices` narrows it),
 * then Check (Enter). Digits 1–9 press the first nine keys through the
 * enclosing frame, whose `?` / Hint button shows the point's meaning (a
 * hint, Hard ceiling). Graded with `gradeSlots`: every slot right → Good, some →
 * Hard (Block), none → Again; every miss is tagged `particle`. Without
 * blanks the drill blanks the point's particle `clozeHints` in a rotating
 * example; a point without particle hints is shown, not tested.
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { segmentsToTokens, toPlain } from '@/content/ruby';
import type { ContentItem, GrammarItem, SentenceExample } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { equivalentJa } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { attempt, gradeSlots } from '../check';
import { S as SD, WHY_BY_TAG } from '../strings';
import { S, fill } from './strings';
import './grammar.css';

export const meta: ExerciseMeta = {
  id: 'particle-duel',
  facet: 'cloze',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

/** The particle keyboard (design 04 §4). Mirrors `learn/distractors.PARTICLES`, which the barrel does not re-export. */
export const PARTICLE_KEYS: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の'];
export const MAX_SLOTS = 3;

export function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}

export interface SentencePiece {
  /** Ruby'd text, or the hidden particle when `slot` is set. */
  ja: string;
  /** Slot index for a blank piece. */
  slot?: number;
}

export interface DuelPrompt {
  pieces: SentencePiece[];
  /** Expected particle per slot. */
  expected: string[];
  plain: string;
  gloss: string | null;
}

/** Splits ruby'd `ja` around sorted, non-overlapping plain ranges; blank pieces carry their slot index. */
export function splitSlots(ja: string, blanks: readonly [number, number][]): SentencePiece[] {
  const plain = toPlain(ja);
  const sorted = blanks
    .map(([a, b]): [number, number] => [Math.max(0, Math.min(a, plain.length)), Math.max(0, Math.min(b, plain.length))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const chunks: string[] = [];
  const slotOf: (number | undefined)[] = [];
  let cursor = 0;
  sorted.forEach(([a, b], i) => {
    if (a < cursor) return; // overlap: skip
    chunks.push(plain.slice(cursor, a));
    slotOf.push(undefined);
    chunks.push(plain.slice(a, b));
    slotOf.push(i);
    cursor = b;
  });
  chunks.push(plain.slice(cursor));
  slotOf.push(undefined);
  const toks = segmentsToTokens(ja, chunks);
  const out: SentencePiece[] = [];
  toks.forEach((t, i) => {
    const slot = slotOf[i];
    if (slot !== undefined) out.push({ ja: t.ja, slot });
    else if (t.ja.length > 0) out.push({ ja: t.ja });
  });
  return out;
}

/** Resolves the sentence and its slots from the step, else from the point's particle hints (see the header). */
export function buildDuelPrompt(item: GrammarItem | null, params: ExerciseProps['step']['params'], exposures: number): DuelPrompt | null {
  const examples: SentenceExample[] = item?.examples ?? [];
  let ja = params.sentence;
  let example: SentenceExample | undefined;
  if (ja) example = examples.find((e) => e.ja === ja || toPlain(e.ja) === toPlain(ja as string));
  else if (examples.length > 0) {
    example = examples[((exposures % examples.length) + examples.length) % examples.length];
    ja = example?.ja;
  }
  if (!ja) return null;
  const plain = toPlain(ja);
  let blanks: [number, number][] = (params.blanks ?? []).filter((b) => b[0] >= 0 && b[1] > b[0] && b[1] <= plain.length).slice(0, MAX_SLOTS);
  if (blanks.length === 0) {
    const hints = (item?.clozeHints ?? []).filter((h) => PARTICLE_KEYS.includes(h));
    const used: [number, number][] = [];
    for (const h of hints) {
      let from = 0;
      while (used.length < MAX_SLOTS) {
        const i = plain.indexOf(h, from);
        if (i < 0) break;
        if (!used.some(([a, b]) => i < b && i + h.length > a)) used.push([i, i + h.length]);
        from = i + h.length;
      }
      if (used.length >= MAX_SLOTS) break;
    }
    blanks = used.sort((x, y) => x[0] - y[0]);
  }
  if (blanks.length === 0) return null;
  const pieces = splitSlots(ja, blanks);
  const slots = pieces.filter((pc) => pc.slot !== undefined);
  const sorted = blanks.slice().sort((x, y) => x[0] - y[0]);
  const expected = slots.map((_, i) => {
    const override = params.answers?.[i]?.trim();
    const range = sorted[i] as [number, number];
    return override && override.length > 0 ? override : plain.slice(range[0], range[1]);
  });
  return { pieces, expected, plain, gloss: params.promptEn ?? example?.en ?? null };
}

/** The keyboard: `params.choices` (every expected particle guaranteed), else the eleven keys. */
export function duelKeyboard(params: ExerciseProps['step']['params'], expected: readonly string[]): string[] {
  const given = Array.from(new Set((params.choices ?? []).map((c) => c.trim()).filter(Boolean)));
  const base = given.length >= 2 ? given : PARTICLE_KEYS.slice();
  for (const e of expected) if (!base.some((k) => equivalentJa(k, e))) base.push(e);
  return base;
}

type Phase = 'fill' | 'done';

export function ParticleDuel(p: ExerciseProps): JSX.Element {
  const item = isGrammarItem(p.item) ? p.item : null;
  const prompt = useMemo(() => buildDuelPrompt(item, p.step.params, p.exposures), [item, p.step.params, p.exposures]);
  const keys = useMemo(() => (prompt ? duelKeyboard(p.step.params, prompt.expected) : []), [prompt, p.step.params]);
  const n = prompt?.expected.length ?? 0;

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('fill');
  const [picked, setPicked] = useState<(string | null)[]>(() => Array.from({ length: n }, () => null));
  const [active, setActive] = useState(0);
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<(AttemptResult & { hits: number }) | null>(null);
  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const emit = (r: AttemptResult & { hits: number }): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };

  const pressKey = (i: number): void => {
    if (phase !== 'fill' || n === 0) return;
    const particle = keys[i];
    if (particle === undefined) return;
    setPicked((cur) => {
      const next = cur.slice();
      const at = active < n ? active : next.findIndex((x) => x === null);
      if (at < 0) return cur;
      next[at] = particle;
      const following = next.findIndex((x, j) => j > at && x === null);
      const anyEmpty = next.findIndex((x) => x === null);
      setActive(following >= 0 ? following : anyEmpty >= 0 ? anyEmpty : n);
      return next;
    });
  };
  const chooseSlot = (i: number): void => {
    if (phase === 'fill') setActive(i);
  };
  const clear = (): void => {
    if (phase !== 'fill') return;
    setPicked(Array.from({ length: n }, () => null));
    setActive(0);
  };
  const showHint = (): void => {
    if (hintShown || phase !== 'fill') return;
    setHintShown(true);
    p.onHint();
  };
  const check = (): void => {
    if (!prompt || phase !== 'fill' || n === 0 || picked.some((x) => x === null)) return;
    emit(gradeSlots(picked, prompt.expected, { ms: elapsed(), hintUsed: hintShown }));
  };

  useExerciseKeys({ onChoice: pressKey, onSubmit: check, onHint: prompt && item && phase === 'fill' && !hintShown ? showHint : undefined });

  if (!prompt || !item) {
    return (
      <div class="gr gr-duel" data-state="unavailable">
        <div class="gr__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{S.cannotBuild}</p>
          <p class="gr__why">{S.shownNotTested}</p>
          {item ? <p lang="ja">{item.pattern}</p> : null}
        </div>
        <div class="gr__actions">
          <button type="button" class="hanko" onClick={() => emit(Object.assign(attempt({ ms: elapsed(), correct: true, hintUsed: true }), { hits: 0 }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const full = picked.every((x) => x !== null);
  const revealed = phase === 'done';
  const kind = result ? (result.nearMiss ? 'partial' : result.correct ? 'correct' : 'wrong') : 'info';

  return (
    <div class="gr gr-duel" data-phase={phase} data-slots={n}>
      <p class="gr__prompt">{n > 1 ? S.particlePrompt : S.particlePromptOne}</p>
      <p class="gr__sentence" lang="ja">
        {prompt.pieces.map((pc, i) => {
          if (pc.slot === undefined) return <Ruby key={i} ja={pc.ja} mode={p.furigana} />;
          const slot = pc.slot;
          const value = picked[slot] ?? null;
          const expected = prompt.expected[slot] as string;
          const right = value !== null && equivalentJa(value, expected);
          return (
            <button
              key={i}
              type="button"
              class="gr-slot"
              lang="ja"
              data-slot={slot}
              data-filled={value !== null ? 'true' : 'false'}
              data-active={!revealed && active === slot ? 'true' : undefined}
              data-state={revealed ? (right ? 'correct' : 'wrong') : undefined}
              disabled={revealed}
              aria-label={value !== null ? fill(S.particleSlotFilled, { n: slot + 1, particle: value }) : `${fill(S.particleSlot, { n: slot + 1 })}: ${S.particleSlotEmpty}`}
              onClick={() => chooseSlot(slot)}
            >
              {revealed && !right ? <span class="gr__given">{value ?? '＿'}</span> : null}
              {revealed ? expected : (value ?? '＿')}
            </button>
          );
        })}
      </p>
      {prompt.gloss ? (
        <p class="gr__gloss">
          <span class="eyebrow">{S.clozeGloss}</span> <span>{prompt.gloss}</span>
        </p>
      ) : null}

      {!revealed ? (
        <div class="gr-keys" role="group" aria-label={S.particleKeyboard}>
          {keys.map((k, i) => (
            <button key={k} type="button" class="gr-key" lang="ja" data-index={i} aria-keyshortcuts={i < 9 ? String(i + 1) : undefined} aria-label={fill(S.particleKey, { particle: k })} onClick={() => pressKey(i)}>
              {i < 9 ? (
                <kbd class="gr-key__num" aria-hidden="true">
                  {i + 1}
                </kbd>
              ) : null}
              {k}
            </button>
          ))}
        </div>
      ) : null}

      {!revealed ? (
        <div class="gr__actions">
          <button type="button" class="btn btn--ghost" disabled={hintShown} onClick={showHint}>
            {S.particleShowPattern}
          </button>
          <button type="button" class="btn btn--ghost" disabled={picked.every((x) => x === null)} onClick={clear}>
            {S.particleClear}
          </button>
          <button type="button" class="hanko" disabled={!full} aria-keyshortcuts="Enter" onClick={check}>
            {S.particleCheck}
          </button>
        </div>
      ) : null}

      {hintShown && !revealed ? (
        <div class="gr__reveal reveal ink-nijimi" data-kind="info" data-hint="true">
          <p>
            <span class="eyebrow">{S.patternLabel}</span> <span lang="ja">{item.pattern}</span> <span>{item.meaning}</span>
          </p>
          <p class="gr__why">{S.hintUsedNote}</p>
        </div>
      ) : null}

      {revealed && result ? (
        <div class="gr__reveal reveal ink-nijimi" data-kind={kind}>
          <p data-hits="true">{fill(S.particleHits, { hits: result.hits, n })}</p>
          {!result.correct ? <p class="gr__why">{WHY_BY_TAG.particle}</p> : null}
          <p>
            <span class="eyebrow">{S.patternLabel}</span> <span lang="ja">{item.pattern}</span> <span>{item.meaning}</span>
          </p>
          {result.correct && result.hits === n ? <p class="gr__why">{SD.correct}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
