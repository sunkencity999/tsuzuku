/**
 * TSUZUKU — 作文 Writing Dojo (design 04 §9, 04 §12 書, 05 §6, 05 §10).
 *
 * Prompt (`params.promptEn`) + required patterns (`params.patternIds`) +
 * target length by belt (`checks.SENTENCE_RANGE_BY_BELT`). Live checks on
 * every keystroke through `checks.checkWriting`: required patterns present,
 * particle sanity, register consistency, kanji for Green words (vocab the
 * learner holds at item-belt Green), conjugation slips with their fix.
 *  · Rubric self-check: one line per pattern ("My text uses X"), verified
 *    live; a tick without the pattern in the text is said plainly.
 *  · Style Judge: on Finish a deterministic sample (same rate as every
 *    Judge, `learn/judge`) asks the rubric Judge for one pattern through
 *    `requestJudge({rubric, regex})`; the host supplies the text.
 *  · Export copies a tutor-ready text (`checks.exportText`) to the
 *    clipboard, with a selectable fallback when the clipboard is blocked.
 *  · No automatic grade (ungraded, XP 30 from B): emits `output:done
 *    {kind:'writing', patternsHit, seconds}`; the result carries the
 *    findings' error tags (particle / conjugation / register) for Weak Points
 *    and `answer` = the text.
 *  · The finished sentences join `store.bookmarks` under `WRITING_PREFIX`
 *    (`@/shared/writing`, SaveMeta has no `writings` slice in v1); the art
 *    tier reads them back with `writingSentencesFrom` for the Tanabata wall
 *    scrolls (`WallpaperData.writingSentences`). Both names are re-exported
 *    here for the tests. The closing line says exactly that: kept with the
 *    bookmarks, and the wall scrolls can carry it.
 * Facet `null`; keys `none`. The textarea takes focus through `useAutoFocus`
 * (a bare `autoFocus` attribute is ignored once anything on the page was focused).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import type { CardKey, ContentItem, ErrorTag, GrammarItem, RegisterTag, VocabItem } from '@/content/types';
import { beltAtLeast, judgeRate, rubricJudge, shouldJudge } from '@/learn';
import { bus } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { itemOfKey, tryKindOfId } from '@/shared/ids';
import { normalizeJa } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import type { CardsApi } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { useAutoFocus } from '@/shared/ui/use-auto-focus';
import { WRITING_PREFIX, writingSentencesFrom } from '@/shared/writing';
import { store } from '@/store';
import { itemBeltOf } from '@/store/derived';
import { FINDING_COPY, REGISTER_NAME, S, fill } from '../strings';
import { registerFor } from '../taiwa/register';
import { SENTENCE_RANGE_BY_BELT, checkWriting, exportText, patternPresent, sentencesOf, type WritingCheck, type WritingFinding } from './checks';
import './writing.css';

export const meta: ExerciseMeta = {
  id: 'writing-dojo',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: true,
  timeable: false,
  keys: 'none',
};

/** The bookmark convention shared with the art tier (`@/shared/writing`), re-exported for the tests. */
export { WRITING_PREFIX, writingSentencesFrom };
/** Sentences kept per finished piece. */
export const KEEP_MAX = 12;
/** A kept sentence has at least this many readable characters. */
export const KEEP_MIN_CHARS = 4;
/** Green vocabulary scanned for kana-only use (cap for the per-mount scan). */
export const GREEN_WORDS_CAP = 600;

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}
function isVocabItem(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i && 'word' in i;
}

/** The step's grammar items (missing ids are skipped). */
export function patternsFor(params: StepParams, get: (id: string) => ContentItem | undefined): GrammarItem[] {
  return (params.patternIds ?? []).map((id) => get(id)).filter(isGrammarItem);
}

/** Target register: the step's, else the first pattern with a non-neutral register, else polite. */
export function targetRegister(params: StepParams, patterns: readonly GrammarItem[]): RegisterTag {
  if (params.registerTarget) return params.registerTarget;
  const p = patterns.find((g) => g.register !== 'neutral');
  return p ? p.register : 'polite';
}

/** Vocab items the learner holds at item-belt Green or better, as loaded items (capped). */
export function greenVocab(cards: CardsApi, get: (id: string) => ContentItem | undefined, cap = GREEN_WORDS_CAP): VocabItem[] {
  const ids = new Set<string>();
  cards.forEach((k) => {
    const id = itemOfKey(k as CardKey);
    if (tryKindOfId(id) === 'vocab') ids.add(id);
  });
  const out: VocabItem[] = [];
  for (const id of ids) {
    if (out.length >= cap) break;
    if (!beltAtLeast(itemBeltOf(id, undefined, cards), 'green')) continue;
    const item = get(id);
    if (isVocabItem(item)) out.push(item);
  }
  return out;
}

/** Sentences worth keeping from a finished piece (≥ 4 readable characters, ≤ 12). */
export function keepSentences(text: string): string[] {
  return sentencesOf(text)
    .filter((s) => Array.from(normalizeJa(s)).length >= KEEP_MIN_CHARS)
    .slice(0, KEEP_MAX);
}

/** Distinct error tags of the findings (particle / conjugation / register). */
export function errorTagsFrom(findings: readonly WritingFinding[]): ErrorTag[] {
  const out: ErrorTag[] = [];
  for (const f of findings) if (f.tag && !out.includes(f.tag)) out.push(f.tag);
  return out;
}

/** Copy for one finding; `{detail}` is the pattern name for a missing pattern, the surface otherwise. */
export function findingCopy(f: WritingFinding, patternName: (id: string) => string): string {
  const detail = f.code === 'pattern-missing' ? patternName(f.detail) : f.detail;
  return fill(FINDING_COPY[f.code], { detail, fix: f.fix ?? '' }).replace(/ → $/, '');
}

/** Findings shown live (length is shown as the count line instead). */
export function liveFindings(check: WritingCheck): WritingFinding[] {
  return check.findings.filter((f) => f.code !== 'length-short' && f.code !== 'length-long' && f.code !== 'empty');
}

/** Same sample as the runner's `judgeNeeded` (design 05 §6); `reps` = pieces written so far. */
export function judgeSampled(cardKey: CardKey | null, stepId: string, writings: number): boolean {
  const stats = store.stats.value;
  const rate = judgeRate(stats.judgeChecks > 0 ? stats.honesty : null, stats.judgeChecks);
  return shouldJudge(store.seed(), cardKey ?? (stepId as CardKey), writings, rate);
}

function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'ms'>): AttemptResult {
  return { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, errorTags: [], ...over };
}

async function copyText(text: string, nav: Pick<Navigator, 'clipboard'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<boolean> {
  try {
    const cb = nav?.clipboard;
    if (!cb || typeof cb.writeText !== 'function') return false;
    await cb.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface WritingDojoExtraProps {
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get'>;
  /** Clipboard owner (default: `navigator`). */
  nav?: Pick<Navigator, 'clipboard'>;
}

interface Done {
  check: WritingCheck;
  judge?: 'pass' | 'fail';
  kept: string[];
}

export function WritingDojo(p: ExerciseProps & WritingDojoExtraProps): JSX.Element {
  return <WritingDojoBody key={p.step.id} {...p} />;
}

function WritingDojoBody(p: ExerciseProps & WritingDojoExtraProps): JSX.Element {
  const loader = p.loader ?? content;
  const get = (id: string): ContentItem | undefined => loader.get(id);
  const params = p.step.params;
  const belt = store.profile.value.belt;
  const patterns = useMemo(() => patternsFor(params, get), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const register = useMemo(() => targetRegister(params, patterns), [params, patterns]);
  const range = SENTENCE_RANGE_BY_BELT[belt];
  const greenWords = useMemo(() => greenVocab(store.cards, get), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rubric = useMemo(() => patterns.map((g) => ({ id: g.id, ...rubricJudge(g) })), [patterns]);

  const [text, setText] = useState('');
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState('');
  const [exportShown, setExportShown] = useState(false);
  const [judging, setJudging] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const startedAt = useRef(store.now());
  const alive = useRef(true);
  const live = useRef({ text, done, judging });
  live.current = { text, done, judging };
  // The textarea is focused imperatively (design 01 §7): a bare `autoFocus` attribute is ignored once anything was focused.
  const textRef = useRef<HTMLTextAreaElement>(null);
  useAutoFocus(textRef, [p.step.id]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useMemo(() => checkWriting(text, { patterns, register, greenWords, range }), [text, patterns, register, greenWords, range]);
  const findings = liveFindings(check);
  const inRange = check.sentences >= range[0] && check.sentences <= range[1];
  const patternName = (id: string): string => patterns.find((g) => g.id === id)?.pattern ?? id;
  const exportBody = (): string =>
    exportText(text, { prompt: params.promptEn, patterns, register, labels: { prompt: S.writingExportPrompt, patterns: S.writingExportPatterns, register: S.writingExportRegister } });

  const doExport = async (): Promise<void> => {
    const ok = await copyText(exportBody(), p.nav);
    if (!alive.current) return;
    setStatus(ok ? S.writingExported : S.writingExportFailed);
    setExportShown(!ok);
  };

  const emit = (final: WritingCheck, judge?: 'pass' | 'fail'): void => {
    const kept = keepSentences(live.current.text);
    if (kept.length > 0) {
      store.patch('bookmarks', (prev) => {
        const next = prev.slice();
        for (const s of kept) {
          const line = WRITING_PREFIX + s;
          if (!next.includes(line)) next.push(line);
        }
        return next;
      });
    }
    const seconds = Math.max(0, Math.round((store.now() - startedAt.current) / 1000));
    bus.emit('output:done', { kind: 'writing', patternsHit: final.patternsHit, seconds, path: 'self' });
    const r = attempt({
      ms: Math.max(0, store.now() - startedAt.current),
      correct: true,
      answer: live.current.text.trim(),
      errorTags: errorTagsFrom(final.findings),
    });
    setDone({ check: final, kept, ...(judge ? { judge } : {}) });
    p.onResult(r);
  };

  const finish = (): void => {
    const s = live.current;
    if (s.done || s.judging) return;
    const final = checkWriting(s.text, { patterns, register, greenWords, range });
    if (final.sentences === 0) {
      setStatus(S.writingEmpty);
      return;
    }
    const candidates = rubric.filter((r) => ticked[r.id]);
    const target = candidates[0] ?? rubric[0];
    if (!target || !judgeSampled(p.step.cardKey, p.step.id, store.stats.value.writings)) {
      emit(final);
      return;
    }
    setJudging(true);
    setStatus(S.writingJudgeWaiting);
    p.requestJudge({ rubric: target.rubric, regex: target.regex })
      .then((pass) => {
        if (!alive.current) return;
        setJudging(false);
        setStatus('');
        emit(final, pass ? 'pass' : 'fail');
      })
      .catch(() => {
        if (!alive.current) return;
        setJudging(false);
        setStatus('');
        emit(final);
      });
  };

  useExerciseKeys({ onSubmit: finish });

  const minutes = params.seconds ? Math.max(1, Math.round(params.seconds / 60)) : null;

  return (
    <div class="dojo-write" data-exercise="writing-dojo" data-feel={p.feel} data-done={done ? 'true' : undefined}>
      <header class="dojo-write__head">
        <h2 class="dojo-write__title">
          <span class="dojo-write__title-ja" lang="ja">
            {S.writingTitleJa}
          </span>
          <span>{S.writingTitle}</span>
        </h2>
        {params.promptEn ? (
          <p class="dojo-write__prompt">
            <span class="eyebrow">{S.writingPrompt}</span>
            {params.promptEn}
          </p>
        ) : null}
        <p class="dojo-write__meta">
          <span class="chip">{fill(S.writingRegister, { register: REGISTER_NAME[registerFor(register)] })}</span>
          <span class="chip">{fill(S.writingLength, { min: range[0], max: range[1] })}</span>
          {minutes !== null ? <span class="chip">{fill(S.writingTime, { n: minutes })}</span> : null}
        </p>
        {patterns.length > 0 ? (
          <ul class="dojo-write__patterns" aria-label={S.writingPatterns}>
            {patterns.map((g) => {
              const present = !check.patternsMissing.includes(g.id);
              return (
                <li key={g.id} class="dojo-write__pattern" data-present={present ? 'true' : 'false'} data-pattern={g.id}>
                  <span class="dojo-write__pattern-ja" lang="ja">
                    {g.pattern}
                  </span>
                  <span>{g.meaning}</span>
                  <span class="dojo-write__pattern-state">{present ? S.writingPatternPresent : S.writingPatternMissing}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="dojo-write__meta">{S.writingNoPatterns}</p>
        )}
      </header>

      {!done ? (
        <div class="dojo-write__field">
          <label class="eyebrow" for={`${p.step.id}-text`}>
            {S.writingField}
          </label>
          <textarea
            id={`${p.step.id}-text`}
            class="dojo-write__text"
            lang="ja"
            value={text}
            placeholder={S.writingPlaceholder}
            spellcheck={false}
            ref={textRef}
            onInput={(e) => {
              setText(e.currentTarget.value);
              if (status) setStatus('');
            }}
          />
          <p class="dojo-write__count" data-inrange={inRange ? 'true' : 'false'} aria-live="polite">
            {fill(S.writingCount, { sentences: check.sentences, chars: check.chars })}
          </p>
        </div>
      ) : null}

      {!done ? (
        <section class="dojo-write__checks" aria-label={S.writingChecks}>
          <h3 class="eyebrow">{S.writingChecks}</h3>
          {findings.length === 0 ? (
            <p class="dojo-write__status">{S.writingChecksClean}</p>
          ) : (
            <ul class="dojo-write__findings">
              {findings.map((f, i) => (
                <li key={`${f.code}:${f.detail}:${i}`} class="dojo-write__finding" data-code={f.code} data-tag={f.tag ?? undefined}>
                  <span lang={f.code === 'register' ? 'ja' : undefined}>{findingCopy(f, patternName)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!done && rubric.length > 0 ? (
        <fieldset class="dojo-write__rubric">
          <legend>{S.writingRubricTitle}</legend>
          {rubric.map((r) => {
            const present = patternPresent(text, patterns.find((g) => g.id === r.id) as GrammarItem);
            return (
              <div key={r.id} class="dojo-write__rubric-item">
                <label class="dojo-write__check">
                  <input type="checkbox" checked={!!ticked[r.id]} onChange={() => setTicked((t) => ({ ...t, [r.id]: !t[r.id] }))} data-rubric={r.id} />
                  <span>
                    {S.writingRubricItem} <span lang="ja">{patternName(r.id)}</span>
                  </span>
                </label>
                {ticked[r.id] && !present ? <p class="dojo-write__mismatch">{S.writingRubricMismatch}</p> : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <div class="dojo-write__actions">
        {!done ? (
          <button type="button" class="hanko" onClick={finish} disabled={judging || check.sentences === 0} aria-keyshortcuts="Enter" data-action="finish">
            {S.writingFinish}
          </button>
        ) : null}
        <button type="button" class="btn btn--ghost" onClick={() => void doExport()} disabled={check.sentences === 0} data-action="export">
          {S.writingExport}
        </button>
      </div>
      <p class="dojo-write__status" role="status" aria-live="polite" data-status="main">
        {status}
      </p>
      {exportShown ? <textarea class="dojo-write__export" readOnly value={exportBody()} aria-label={S.writingExport} onFocus={(e) => e.currentTarget.select()} /> : null}

      {done ? (
        <div class="dojo-write__result" role="status">
          <p class="dojo-write__verdict">{fill(S.writingDone, { hit: done.check.patternsHit, total: done.check.patternsTotal, sentences: done.check.sentences })}</p>
          <p>{S.writingDoneNote}</p>
          {done.judge ? (
            <p class="dojo-write__judge" data-judge={done.judge}>
              {done.judge === 'pass' ? S.writingJudgePass : S.writingJudgeFail}
            </p>
          ) : null}
          {done.kept.length > 0 ? <p class="dojo-write__meta">{S.writingKept}</p> : null}
          <ul class="dojo-write__sentences" lang="ja">
            {sentencesOf(text).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
