/**
 * TSUZUKU — 三変化 Say It Three Ways (design 04 §6, 05 §10, Station 27+).
 *
 * One idea (`params.promptEn`, with `params.sentence` as a model behind a
 * hint — the "Show one model" button or the frame's `?` / Hint button,
 * contract #32) → the learner types or speaks it three times: casual, polite, keigo.
 * Each version is classified by `taiwa/register.detectRegister` (だ・です・
 * でございます; くれる・くださる・いただく; verb forms); a version "lands"
 * when its register is exactly the one asked for (a mixed line never lands).
 *  · Speak mode (`params.mode === 'speak'` and recognition opted in): a
 *    per-row Speak button fills the field from the recognizer's first
 *    alternative; the learner may still edit before checking. A typed
 *    recognizer failure (`sttFailure`) is named in place of "nothing heard".
 *  · Emits `output:done {kind:'three-ways', registersCorrect, path}`; the
 *    result tags `register` on any slip and carries an implicit `prod` grade
 *    for the step's grammar point when its card is due within 3 days.
 * Facet `null` (ungraded, XP only); keys `kana`.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { SHADOW_MAX_MS, sttFailure } from '@/audio';
import { toPlain } from '@/content/ruby';
import type { CardKey, ContentItem, GrammarItem } from '@/content/types';
import { services } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { cardKey } from '@/shared/ids';
import { normalizeJa } from '@/shared/jp';
import type { CardsApi, EpochDay, Rating } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { KanaInput } from '@/shared/ui/KanaInput';
import { store } from '@/store';
import { detectRegister, markersDetailed, registerFor, type Register } from '../taiwa/register';
import { patternPresent } from '../writing/checks';
import { REGISTER_NAME, REGISTER_NAME_JA, S, fill } from '../strings';
import { recognitionAllowed } from './Shadow';
import { IMPLICIT_WINDOW_DAYS } from './scoring';
import './speaking.css';

export const meta: ExerciseMeta = {
  id: 'say-three-ways',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'kana',
};

export const REGISTERS = ['casual', 'polite', 'keigo'] as const;
export type TargetRegister = (typeof REGISTERS)[number];
export type Answers = Record<TargetRegister, string>;

export interface ThreeWaysRow {
  register: TargetRegister;
  text: string;
  detected: Register | null;
  ok: boolean;
  markers: string[];
}

export interface ThreeWaysGrade {
  rows: ThreeWaysRow[];
  correct: 0 | 1 | 2 | 3;
}

/** Classifies the three versions; an empty version never lands. */
export function gradeThreeWays(a: Answers): ThreeWaysGrade {
  const rows: ThreeWaysRow[] = REGISTERS.map((register) => {
    const text = a[register].trim();
    if (normalizeJa(text).length === 0) return { register, text, detected: null, ok: false, markers: [] };
    const detected = detectRegister(text);
    return { register, text, detected, ok: detected === register, markers: markersDetailed(text).map((m) => m.surface) };
  });
  const correct = rows.filter((r) => r.ok).length as 0 | 1 | 2 | 3;
  return { rows, correct };
}

function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}

/**
 * Implicit `prod` grade for the step's grammar point: Good when the version
 * in the point's own register landed and uses the pattern, Again otherwise;
 * only when the card exists and is due within 3 days (design 05 §4).
 */
export function implicitGrammarGrade(item: ContentItem | null, g: ThreeWaysGrade, cards: Pick<CardsApi, 'get'>, today: EpochDay): { cardKey: CardKey; rating: Rating }[] {
  if (!isGrammarItem(item)) return [];
  const key = cardKey(item.id, 'prod');
  const c = cards.get(key);
  if (!c || c[0] > today + IMPLICIT_WINDOW_DAYS) return [];
  const target = registerFor(item.register);
  const row = g.rows.find((r) => r.register === target);
  const good = !!row && row.ok && patternPresent(row.text, item);
  return [{ cardKey: key, rating: good ? 3 : 1 }];
}

function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'ms'>): AttemptResult {
  return { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, errorTags: [], ...over };
}

const EMPTY: Answers = { casual: '', polite: '', keigo: '' };

export function SayThreeWays(p: ExerciseProps): JSX.Element {
  return <ThreeWaysBody key={p.step.id} {...p} />;
}

function ThreeWaysBody(p: ExerciseProps): JSX.Element {
  const params = p.step.params;
  const speakMode = params.mode === 'speak' && recognitionAllowed(store.settings.value, services.stt);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [listening, setListening] = useState<TargetRegister | null>(null);
  const [spoke, setSpoke] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [nudge, setNudge] = useState('');
  const [done, setDone] = useState<ThreeWaysGrade | null>(null);
  const startedAt = useRef(store.now());
  const live = useRef({ answers, done, listening });
  live.current = { answers, done, listening };
  const alive = useRef(true);

  const allFilled = REGISTERS.every((r) => normalizeJa(answers[r]).length > 0);
  const model = params.sentence ? toPlain(params.sentence) : '';
  const modelRegister: Register | null = model ? detectRegister(model) : null;

  const set = (r: TargetRegister, v: string): void => {
    if (live.current.done) return;
    setAnswers((a) => ({ ...a, [r]: v }));
    if (nudge) setNudge('');
  };

  const speakRow = async (r: TargetRegister): Promise<void> => {
    if (!speakMode || live.current.done || live.current.listening) return;
    setListening(r);
    let text = '';
    try {
      const res = await services.stt.recognize({ maxMs: SHADOW_MAX_MS });
      text = res?.alternatives[0] ?? '';
    } catch {
      text = '';
    }
    if (!alive.current) return;
    setListening(null);
    if (text) {
      setSpoke(true);
      set(r, text);
    } else setNudge(sttFailure(services.stt)?.label ?? S.shadowNoSpeech);
  };

  const revealModel = (): void => {
    if (showModel || live.current.done || !model) return;
    setShowModel(true);
    p.onHint();
  };

  const check = (): void => {
    const s = live.current;
    if (s.done) return;
    if (!REGISTERS.every((r) => normalizeJa(s.answers[r]).length > 0)) {
      setNudge(S.threeWaysEmpty);
      return;
    }
    const g = gradeThreeWays(s.answers);
    const path: 'recognition' | 'self' = spoke ? 'recognition' : 'self';
    bus.emit('output:done', { kind: 'three-ways', registersCorrect: g.correct, path });
    const r = attempt({
      ms: Math.max(0, store.now() - startedAt.current),
      correct: g.correct === 3,
      nearMiss: g.correct === 2,
      hintUsed: showModel,
      errorTags: g.correct === 3 ? [] : ['register'],
      answer: REGISTERS.map((k) => g.rows.find((x) => x.register === k)?.text ?? '').join(' / '),
    });
    const implicit = implicitGrammarGrade(p.item, g, store.cards, store.today());
    if (implicit.length > 0) r.implicit = implicit;
    setDone(g);
    p.onResult(r);
  };

  // `?` / the frame's Hint button reveal the model; nothing to offer once shown, done, or without a model.
  useExerciseKeys({ onSubmit: check, onHint: model && !showModel && !done ? revealModel : undefined });

  const verdict = done ? (done.correct === 3 ? S.threeWaysAllThree : done.correct === 2 ? S.threeWaysTwo : S.threeWaysFew) : '';
  const kind = done ? (done.correct === 3 ? 'correct' : done.correct === 2 ? 'near' : 'wrong') : undefined;

  return (
    <div class="speak three-ways" data-exercise="say-three-ways" data-feel={p.feel} data-mode={speakMode ? 'speak' : 'type'} data-done={done ? 'true' : undefined}>
      <header class="speak__head">
        <h2 class="speak__title">
          <span class="speak__title-ja" lang="ja">
            {S.threeWaysTitleJa}
          </span>
          <span>{S.threeWaysTitle}</span>
        </h2>
        <p class="speak__prompt">{params.promptEn ?? S.threeWaysPrompt}</p>
      </header>

      <ol class="three-ways__rows">
        {REGISTERS.map((r) => {
          const row = done?.rows.find((x) => x.register === r);
          return (
            <li key={r} class="three-ways__row" data-register={r} data-verdict={row ? (row.ok ? 'hit' : 'miss') : undefined}>
              <div class="three-ways__reg">
                <span>{REGISTER_NAME[r]}</span>
                <span class="three-ways__reg-ja" lang="ja">
                  {REGISTER_NAME_JA[r]}
                </span>
              </div>
              {done ? (
                <p class="three-ways__answer" lang="ja">
                  {row?.text}
                </p>
              ) : (
                <KanaInput value={answers[r]} onChange={(v) => set(r, v)} onSubmit={() => check()} label={fill(S.threeWaysField, { register: REGISTER_NAME[r] })} autoFocus={r === 'casual'} />
              )}
              {speakMode && !done ? (
                <button type="button" class="btn btn--sm" onClick={() => void speakRow(r)} disabled={listening !== null} data-action={`speak-${r}`} aria-label={fill(S.threeWaysSpeakRow, { register: REGISTER_NAME[r] })}>
                  {listening === r ? S.shadowListening : S.shadowSpeak}
                </button>
              ) : null}
              {row ? (
                <p class="speak__meta" data-detected={row.detected ?? 'none'}>
                  <span class="chip" data-ok={row.ok ? 'true' : 'false'}>
                    {row.detected ? fill(S.threeWaysReadsAs, { register: REGISTER_NAME[row.detected] }) : S.threeWaysNoMarkers}
                  </span>
                  <span>{row.ok ? S.threeWaysHit : S.threeWaysMiss}</span>
                </p>
              ) : null}
              {row && row.markers.length > 0 ? (
                <ul class="three-ways__markers" aria-label={S.threeWaysMarkers}>
                  {row.markers.map((m, i) => (
                    <li key={i} class="chip" lang="ja">
                      {m}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div class="speak__row">
        {!done ? (
          <button type="button" class="hanko" onClick={check} disabled={!allFilled} aria-keyshortcuts="Enter" data-action="check">
            {S.threeWaysCheck}
          </button>
        ) : null}
        {model && !done ? (
          <button type="button" class="btn btn--ghost btn--sm" onClick={revealModel} disabled={showModel} title={S.threeWaysModelHint} data-action="model">
            {S.threeWaysShowModel}
          </button>
        ) : null}
      </div>
      <p class="speak__status" role="status" aria-live="polite">
        {nudge}
      </p>

      {(showModel || done) && model ? (
        <p class="speak__en">
          <span class="eyebrow">{S.threeWaysModel}</span>
          <span lang="ja">{model}</span>
          {modelRegister ? <span class="chip">{REGISTER_NAME[modelRegister]}</span> : null}
        </p>
      ) : null}

      {done ? (
        <div class="speak__result" data-kind={kind} role="status">
          <p class="speak__verdict">{fill(S.threeWaysScore, { n: done.correct })}</p>
          <p class="speak__note">{verdict}</p>
        </div>
      ) : null}
    </div>
  );
}
