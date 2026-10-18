/**
 * TSUZUKU — 書き取り Kanji Recall Write (design 04 §3, 05 §6; opt-in, never gates).
 *
 * Meaning + reading → the learner writes the kanji from memory, on the
 * scratch pad (freehand strokes, no recognition) or on paper → Reveal shows
 * the kanji at 20 % opacity over the strokes plus the mnemonic → self-rate
 * Again / Hard / Good (keys 1–3). A Good is sampled by the Judge
 * (`shouldJudge(seed, cardKey, reps, judgeRate(honesty, checks))`): when the
 * step carries three meaning distractors (`params.choices`) the 4-option
 * meaning Judge is requested before the result is emitted; the runner records
 * the verdict. The result carries `selfRating`; `correct` mirrors it
 * (Again → false) so stats and the feedback card read honestly. No facet of
 * its own (`facet: null`): the optional `kanji:write` card is the runner's
 * business, this drill only reports.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ContentItem, KanjiItem } from '@/content/types';
import { judgeRate, shouldJudge } from '@/learn';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { normalizeEn } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { attempt } from '../check';
import { S as SD } from '../strings';
import { S, fill } from './strings';
import './kanji.css';

export const meta: ExerciseMeta = {
  id: 'kanji-write',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: true,
  timeable: false,
  keys: 'none',
};

export const PAD_SIZE = 240;
export const STROKE_WIDTH = 10;

export function isKanjiItem(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i && 'mnemonic' in i;
}

/** Three distinct meaning distractors from `choices`, or `null`. */
export function judgeDistractors(meanings: readonly string[], choices: readonly string[] | undefined): [string, string, string] | null {
  if (!choices) return null;
  const seen = new Set(meanings.map(normalizeEn));
  const out: string[] = [];
  for (const c of choices) {
    const k = normalizeEn(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length === 3) return [out[0] as string, out[1] as string, out[2] as string];
  }
  return null;
}

/** Deterministic Judge sample for a self-rated Good on this card (design 05 §6). */
export function wantsJudge(cardKey: string): boolean {
  const stats = store.stats.value;
  const honesty = stats.judgeChecks > 0 ? stats.honesty : null;
  const reps = store.cards.get(cardKey as `${string}#${'comp'}`)?.[3] ?? 0;
  return shouldJudge(store.seed(), cardKey as `${string}#${'comp'}`, reps, judgeRate(honesty, stats.judgeChecks));
}

type Phase = 'write' | 'rate' | 'judge' | 'done';
type SelfRating = 1 | 2 | 3;

const RATE_LABEL: Record<SelfRating, { title: string; sub: string }> = {
  1: { title: S.writeRateAgain, sub: SD.rateAgain },
  2: { title: S.writeRateHard, sub: SD.rateHard },
  3: { title: S.writeRateGood, sub: SD.rateGood },
};

export function KanjiWrite(p: ExerciseProps): JSX.Element {
  const kanji = isKanjiItem(p.item) ? p.item : null;
  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('write');
  const [canDraw, setCanDraw] = useState(true);
  const [drawn, setDrawn] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = c.getContext('2d');
    } catch {
      ctx = null;
    }
    ctxRef.current = ctx;
    if (!ctx) {
      setCanDraw(false);
      return;
    }
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let color = '';
    try {
      color = getComputedStyle(c).color;
    } catch {
      color = '';
    }
    ctx.strokeStyle = color || '#000';
  }, []);

  // Pointer listeners are attached imperatively: not every DOM exposes the
  // `onpointerdown` IDL attributes a JSX prop would need to be mapped correctly.
  const handlers = useRef({ down: (_e: PointerEvent): void => undefined, move: (_e: PointerEvent): void => undefined, up: (): void => undefined });
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const down = (e: Event): void => handlers.current.down(e as PointerEvent);
    const move = (e: Event): void => handlers.current.move(e as PointerEvent);
    const up = (): void => handlers.current.up();
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('pointerleave', up);
    };
  }, []);

  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const emit = (r: AttemptResult): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };

  const point = (e: PointerEvent): [number, number] | null => {
    const c = canvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const sx = rect.width > 0 ? c.width / rect.width : 1;
    const sy = rect.height > 0 ? c.height / rect.height : 1;
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
  };

  const onDown = (e: PointerEvent): void => {
    const ctx = ctxRef.current;
    const pt = point(e);
    if (!ctx || !pt || phase !== 'write') return;
    e.preventDefault();
    try {
      const el = e.currentTarget as HTMLCanvasElement | null;
      if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    drawing.current = true;
    ctx.beginPath();
    ctx.moveTo(pt[0], pt[1]);
    ctx.lineTo(pt[0] + 0.1, pt[1] + 0.1);
    ctx.stroke();
    if (!drawn) setDrawn(true);
  };
  const onMove = (e: PointerEvent): void => {
    const ctx = ctxRef.current;
    const pt = point(e);
    if (!ctx || !pt || !drawing.current) return;
    e.preventDefault();
    ctx.lineTo(pt[0], pt[1]);
    ctx.stroke();
  };
  const onUp = (): void => {
    drawing.current = false;
  };
  handlers.current = { down: onDown, move: onMove, up: onUp };

  const clearPad = (): void => {
    const ctx = ctxRef.current;
    const c = canvasRef.current;
    if (ctx && c) ctx.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };

  const reveal = (): void => {
    if (phase !== 'write') return;
    drawing.current = false;
    setPhase('rate');
  };

  const rate = (r: SelfRating): void => {
    if (phase !== 'rate' || !kanji) return;
    const base = attempt({ ms: elapsed(), correct: r >= 2, nearMiss: r === 2, selfRating: r });
    if (r === 3) {
      const distractors = judgeDistractors(kanji.meanings, p.step.params.choices);
      const cardKey = p.step.cardKey ?? `${kanji.id}#comp`;
      if (distractors && wantsJudge(cardKey)) {
        setPhase('judge');
        void p.requestJudge({ correct: kanji.meanings[0] ?? kanji.char, distractors }).then(() => emit(base), () => emit(base));
        return;
      }
    }
    emit(base);
  };

  useExerciseKeys({
    onChoice: (i) => {
      if (phase === 'rate' && i >= 0 && i <= 2) rate((i + 1) as SelfRating);
    },
    onSubmit: reveal,
  });

  if (!kanji) {
    return (
      <div class="kj kj-write" data-state="unavailable">
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

  const revealed = phase !== 'write';
  const kun = kanji.kun.map((k) => k.replace('.', '・'));

  return (
    <div class="kj kj-write" data-phase={phase} data-drawn={drawn ? 'true' : 'false'}>
      <p class="kj__prompt">{S.writePrompt}</p>
      <dl class="kj__meta">
        <dt>{SD.meaning}</dt>
        <dd>{kanji.meanings.join(' · ')}</dd>
        {kanji.on.length > 0 ? (
          <>
            <dt>{S.onReading}</dt>
            <dd lang="ja">{kanji.on.join('・')}</dd>
          </>
        ) : null}
        {kun.length > 0 ? (
          <>
            <dt>{S.kunReading}</dt>
            <dd lang="ja">{kun.join('　')}</dd>
          </>
        ) : null}
        <dt>{SD.components}</dt>
        <dd>{fill(S.writeStrokes, { n: kanji.strokes })}</dd>
      </dl>

      <div class="kj-pad" role="img" aria-label={S.writePad} data-can-draw={canDraw ? 'true' : 'false'}>
        <div class="kj-pad__guides" aria-hidden="true" />
        <canvas ref={canvasRef} class="kj-pad__canvas" width={PAD_SIZE} height={PAD_SIZE} />
        {!canDraw ? <p class="kj-pad__paper">{S.writeNoCanvas}</p> : null}
        {revealed ? (
          <div class="kj-pad__overlay" lang="ja" aria-hidden="true" data-overlay="true">
            {kanji.char}
          </div>
        ) : null}
      </div>
      <p class="kj__gloss">{canDraw ? S.writePadHelp : S.writeOptIn}</p>

      {phase === 'write' ? (
        <div class="kj__actions">
          <button type="button" class="btn btn--ghost" disabled={!canDraw || !drawn} onClick={clearPad}>
            {S.writeClear}
          </button>
          <button type="button" class="hanko" aria-keyshortcuts="Enter" onClick={reveal}>
            {S.writeReveal}
          </button>
        </div>
      ) : null}

      {revealed ? (
        <div class="kj__reveal reveal ink-nijimi" data-kind={phase === 'done' ? (result?.correct ? (result.nearMiss ? 'partial' : 'correct') : 'wrong') : 'info'}>
          <p class="kj__glyph kj__glyph--sm" lang="ja" aria-label={S.kanjiLabel} data-answer="true">
            {kanji.char}
          </p>
          <p class="kj__why">{S.writeOverlay}</p>
          <p>
            <span class="eyebrow">{SD.mnemonic}</span> <span>{kanji.mnemonic}</span>
          </p>
          {phase === 'judge' ? (
            <p class="kj__why" role="status">
              {S.writeInspecting}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === 'rate' ? (
        <div class="kj-rate" role="group" aria-label={S.writeRate}>
          {([1, 2, 3] as const).map((r) => (
            <button key={r} type="button" class="kj-rate__btn" data-rating={r} aria-keyshortcuts={String(r)} onClick={() => rate(r)}>
              <kbd aria-hidden="true">{r}</kbd>
              <strong>{RATE_LABEL[r].title}</strong>
              <small>{RATE_LABEL[r].sub}</small>
            </button>
          ))}
        </div>
      ) : null}
      {phase === 'rate' ? <p class="kj__gloss">{S.writeOptIn}</p> : null}
    </div>
  );
}
