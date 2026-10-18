/**
 * TSUZUKU — 他流試合 Field Mission self-report step (design 04 §9, 05 §9–§10).
 *
 * Shows one `MISSIONS` entry (`params.missionId`, else the highest tier the
 * station has opened) with its prompt, default minutes and the honesty note:
 * every number here is self-reported and the ledger shows it as "(reported)".
 *  · "I did it" → report: minutes, then the gaps — words you met (tier 3) or
 *    things you could not say (tier 5; one optional slot otherwise), each with
 *    an optional kind (an error tag). "Not yet" is an honest skip (`guard`),
 *    never a wrong answer.
 *  · Report → `logMission(id, minutes)` (B: `ledger.missions`, a ledger row,
 *    `field-mission:done`, XP); every gap that resolves through the station's
 *    cumulative `surfaces` enters `store.captured` (new-item queue), the rest
 *    become free-text `bookmarks`; the chosen kinds ride on the result's
 *    `errorTags`, which B's Weak Points reducer counts as evidence.
 * "Mandatory" means offered every week, never a gate: a learner without
 * speakers around is never blocked. Facet `null`; keys `none`; ungraded.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import { BELT_IDS, type Belt, type ErrorTag } from '@/content/types';
import { MISSIONS, type MissionDef } from '@/shared/catalog';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import type { StepParams } from '@/shared/session-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { TAG_LABEL } from '@/shared/ui/strings';
import { logMission, store } from '@/store';
import { bookmarkText, captureItem, isCapturableId } from '../reader/capture';
import { S, fill } from '../strings';
import './missions.css';

export const meta: ExerciseMeta = {
  id: 'field-mission',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: true,
  timeable: false,
  keys: 'none',
};

/** Kinds a gap may be filed under (the tags Weak Points can act on for speech). */
export const GAP_TAGS: readonly ErrorTag[] = ['word-choice', 'particle', 'conjugation', 'register', 'listening', 'pitch'];
export const MAX_MINUTES = 24 * 60;

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** The mission for a step: by id, else the highest tier opened at the station (and the belt); `null` with none. */
export function missionFor(params: StepParams, station: number, belt: Belt, all: readonly MissionDef[] = MISSIONS): MissionDef | null {
  if (params.missionId) {
    const byId = all.find((m) => m.id === params.missionId);
    if (byId) return byId;
  }
  const beltRank = BELT_IDS.indexOf(belt);
  const open = all.filter((m) => m.fromStation <= station && BELT_IDS.indexOf(m.belt) <= beltRank).sort((a, b) => a.tier - b.tier);
  return open[open.length - 1] ?? null;
}

/** How many gap slots the report shows and what they are called. */
export function gapSlots(m: MissionDef): { count: number; title: string } {
  if (m.tier === 3) return { count: 3, title: S.missionWordsTitle };
  if (m.tier === 5) return { count: 2, title: S.missionGapsTitle };
  return { count: 1, title: S.missionGapsTitle };
}

export type GapOutcome = { kind: 'empty' } | { kind: 'captured'; itemId: string; text: string } | { kind: 'bookmarked'; text: string };

/** A gap resolves to a corpus item through the station `surfaces` (word / kana / altForm), else stays free text. */
export function resolveGap(text: string, surfaces: Readonly<Record<string, string>> | null): GapOutcome {
  const t = text.trim();
  if (t.length === 0) return { kind: 'empty' };
  const id = surfaces?.[t] ?? surfaces?.[t.normalize('NFKC')];
  if (id && isCapturableId(id)) return { kind: 'captured', itemId: id, text: t };
  return { kind: 'bookmarked', text: t };
}

export function sanitizeMinutes(v: string | number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_MINUTES, Math.round(n));
}

function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'ms'>): AttemptResult {
  return { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, errorTags: [], ...over };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface FieldMissionExtraProps {
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'station'>;
}

type Phase = 'brief' | 'report' | 'done';

interface Gap {
  text: string;
  tag: ErrorTag | '';
}

interface Done {
  minutes: number;
  outcomes: GapOutcome[];
  tags: ErrorTag[];
}

export function FieldMission(p: ExerciseProps & FieldMissionExtraProps): JSX.Element {
  return <FieldMissionBody key={p.step.id} {...p} />;
}

function FieldMissionBody(p: ExerciseProps & FieldMissionExtraProps): JSX.Element {
  const loader = p.loader ?? content;
  const station = store.progress.value.station;
  const belt = store.profile.value.belt;
  const mission = useMemo(() => missionFor(p.step.params, station, belt), [p.step.params, station, belt]);
  const slots = mission ? gapSlots(mission) : { count: 0, title: '' };

  const [phase, setPhase] = useState<Phase>('brief');
  const [minutes, setMinutes] = useState<string>(mission ? String(mission.minutes) : '');
  const [gaps, setGaps] = useState<Gap[]>(() => Array.from({ length: slots.count }, () => ({ text: '', tag: '' })));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const startedAt = useRef(store.now());
  const alive = useRef(true);
  const live = useRef({ phase, minutes, gaps, busy, done });
  live.current = { phase, minutes, gaps, busy, done };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const elapsed = (): number => Math.max(0, store.now() - startedAt.current);

  const notYet = (): void => {
    if (live.current.phase !== 'brief' || !mission) return;
    p.onResult(attempt({ ms: elapsed(), guard: true, answer: 'not-yet' }));
    setDone({ minutes: 0, outcomes: [], tags: [] });
    setPhase('done');
  };

  const setGap = (i: number, patch: Partial<Gap>): void => {
    setGaps((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  const report = async (): Promise<void> => {
    const s = live.current;
    if (s.phase !== 'report' || s.busy || !mission) return;
    setBusy(true);
    const mins = sanitizeMinutes(s.minutes, mission.minutes);
    let surfaces: Record<string, string> | null = null;
    try {
      surfaces = (await loader.station(station)).surfaces;
    } catch {
      surfaces = null;
    }
    if (!alive.current) return;
    const outcomes: GapOutcome[] = [];
    const tags: ErrorTag[] = [];
    for (const g of s.gaps) {
      const o = resolveGap(g.text, surfaces);
      outcomes.push(o);
      if (o.kind === 'captured') captureItem(o.itemId);
      else if (o.kind === 'bookmarked') bookmarkText(o.text);
      if (o.kind !== 'empty' && g.tag && !tags.includes(g.tag)) tags.push(g.tag);
    }
    logMission(mission.id, mins);
    const r = attempt({
      ms: elapsed(),
      correct: true,
      errorTags: tags,
      answer: outcomes
        .filter((o): o is Exclude<GapOutcome, { kind: 'empty' }> => o.kind !== 'empty')
        .map((o) => o.text)
        .join(' / '),
    });
    if (!r.answer) delete r.answer;
    setDone({ minutes: mins, outcomes, tags });
    setBusy(false);
    setPhase('done');
    p.onResult(r);
  };

  useExerciseKeys({
    onSubmit: () => {
      const ph = live.current.phase;
      if (ph === 'brief') setPhase('report');
      else if (ph === 'report') void report();
    },
  });

  if (!mission) {
    return (
      <div class="mission" data-exercise="field-mission" data-feel={p.feel}>
        <p class="mission__note" role="status">
          {S.missionMissing}
        </p>
      </div>
    );
  }

  return (
    <div class="mission" data-exercise="field-mission" data-feel={p.feel} data-phase={phase} data-mission={mission.id}>
      <header class="mission__head">
        <h2 class="mission__title">
          <span class="mission__title-ja" lang="ja">
            {S.missionTitleJa}
          </span>
          <span>{S.missionTitle}</span>
        </h2>
        <p class="mission__meta">
          <span class="chip">{fill(S.missionTier, { n: mission.tier })}</span>
          <span class="chip">{fill(S.missionMinutesDefault, { n: mission.minutes })}</span>
          {mission.conversation ? <span class="chip chip--accent">{S.missionConversation}</span> : null}
        </p>
        <h3 class="mission__name">
          <span lang="ja">{mission.titleJa}</span>
          <span>{mission.titleEn}</span>
        </h3>
        <p class="mission__prompt">{mission.promptEn}</p>
        <p class="mission__note">{S.missionLede}</p>
      </header>

      {phase === 'brief' ? (
        <div class="mission__actions">
          <button type="button" class="hanko" onClick={() => setPhase('report')} aria-keyshortcuts="Enter" data-action="did-it">
            {S.missionDidIt}
          </button>
          <button type="button" class="btn btn--ghost" onClick={notYet} data-action="not-yet">
            {S.missionNotYet}
          </button>
        </div>
      ) : null}

      {phase === 'report' ? (
        <form
          class="mission__report"
          onSubmit={(e) => {
            e.preventDefault();
            void report();
          }}
        >
          <p class="mission__note">{S.missionHonesty}</p>
          <label class="mission__field">
            <span class="eyebrow">{S.missionMinutes}</span>
            <input
              class="input mission__minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_MINUTES}
              step={1}
              value={minutes}
              onInput={(e) => setMinutes(e.currentTarget.value)}
              data-field="minutes"
            />
          </label>
          <fieldset class="mission__gaps sheet">
            <legend>{slots.title}</legend>
            <p class="mission__note">{S.missionGapsLede}</p>
            {gaps.map((g, i) => (
              <div key={i} class="mission__gap">
                <label class="mission__field">
                  <span class="eyebrow">{fill(S.missionGapField, { n: i + 1 })}</span>
                  <input class="input" type="text" lang="ja" value={g.text} onInput={(e) => setGap(i, { text: e.currentTarget.value })} autoComplete="off" data-field={`gap-${i}`} />
                </label>
                <label class="mission__field mission__field--kind">
                  <span class="eyebrow">{S.missionGapKind}</span>
                  <select class="select" value={g.tag} onChange={(e) => setGap(i, { tag: e.currentTarget.value as ErrorTag | '' })} data-field={`kind-${i}`}>
                    <option value="">{S.missionGapKindNone}</option>
                    {GAP_TAGS.map((t) => (
                      <option key={t} value={t}>
                        {TAG_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </fieldset>
          <div class="mission__actions">
            <button type="submit" class="hanko" disabled={busy} aria-keyshortcuts="Enter" data-action="report">
              {S.missionReport}
            </button>
          </div>
        </form>
      ) : null}

      {phase === 'done' && done ? (
        <div class="mission__result sheet" role="status" data-reported={done.minutes > 0 ? 'true' : 'false'}>
          {done.minutes > 0 ? (
            <>
              <p class="mission__verdict">{fill(S.missionReported, { n: done.minutes })}</p>
              <ul class="mission__outcomes">
                {done.outcomes.map((o, i) =>
                  o.kind === 'empty' ? null : (
                    <li key={i} class="chip" data-outcome={o.kind} lang="ja">
                      {o.kind === 'captured' ? fill(S.missionCaptured, { word: o.text }) : fill(S.missionBookmarked, { text: o.text })}
                    </li>
                  ),
                )}
                {done.tags.map((t) => (
                  <li key={t} class="chip chip--tag" data-tag={t}>
                    {fill(S.missionTagged, { tag: TAG_LABEL[t] })}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p class="mission__verdict">{S.missionNotYetNote}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
