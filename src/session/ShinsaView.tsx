/**
 * TSUZUKU — `<ShinsaView>`: the belt exam (design 04 §12, 02 §2).
 *
 *  eligibility (gates, Green / Brown coverage bars, Sensei's Notes pending)
 *  → exam: five sections run by one `SessionRunner` through `<SessionView>`,
 *  each opened by a section card (runner paused while it shows) → result:
 *  section scores against the 80 % mark, "Passed. The ceremony follows." with
 *  the 1,000 XP line, or "Not yet" with Sensei's Notes and the Notes session
 *  that opens the retake. `finishShinsa` writes the save and emits
 *  `shinsa:result`; B emits `belt:promoted` and G runs the ceremony.
 *  Speaking passed on the typed path is said so (design 04 §12).
 *  The exam runner never touches the training snapshot (`persist: false`) and
 *  leaving the room mid-exam abandons the run; a Notes plan with nothing to
 *  drill (stale notes whose cards are gone) completes the Notes session on the
 *  spot so the retake can never be locked.
 *
 *  Design 09 §3.1 / §10 D1: the five section sheets are `.sheet`s whose heads
 *  set in Mincho (the one surface outside the Dojo column the fence allows) —
 *  SHINSA_LABEL's kanji never without its English (arcade-strings' heads);
 *  the coverage bars are `.meter`s with a target tick; a pass opens with the
 *  600 ms sumi beat (`SHINSA_SUMI_MS`): one seeded ink wash (the ceremony's
 *  own `inkWashUrl`, a static data URL) nijimi over --dur-3, a hold, then
 *  kasure — skippable by any tap or key, absent under reduced motion — and the
 *  host holds the belt ceremony for it (CeremonyHost `BELT_SETTLE_MS` = hold +
 *  kasure; the test here pins the sum). The header's rank title shows romaji
 *  only below Green kana and a kana `<Ruby>` from Green on (§3.3).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { content as appContent, type ContentLoader } from '../content/loader';
import { BELTS, type Belt, type DrillId } from '../content/types';
import { SHINSA_SECTIONS, type ShinsaSection } from '../shared/catalog';
import { hashSeed } from '../shared/hash';
import { parseCardKey } from '../shared/ids';
import type { SessionPlan } from '../shared/session-types';
import type { Stats } from '../shared/store-types';
import { Ruby } from '../shared/ui/Ruby';
import { TAG_LABEL } from '../shared/ui/strings';
import { prefersReducedMotion } from '../shared/ui/use-reveal';
import { inkWashUrl } from '../art/ceremony/BeltCeremony';
import { beltTitleRuby } from '../art/ceremony/support';
import { romajiAllowed, signRubyMode } from '../art/road/reading';
import { store } from '../store';
import { beltStations } from '../store/derived';
import { S as AS } from './arcade-strings';
import { BELT_NAME, SHINSA_LABEL, fill } from './engine-strings';
import { itemHead } from './GateView';
import { SessionRunner } from './runner';
import { SessionHost, type SessionViewComponent } from './ScrollView';
import { SHINSA_BROWN, SHINSA_GREEN, SHINSA_PASS, buildNotesPlan, buildShinsa, completeNotesSession, finishShinsa, scoreShinsa, sectionOfStep, shinsaEligibleAsync, type ShinsaEligibility, type ShinsaScore } from './shinsa';
import { S } from './pages/strings';
import './ShinsaView.css';

export interface ShinsaViewProps {
  belt: Belt;
  onExit(): void;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
  /** Additive: a prebuilt exam plan (tests); skips `buildShinsa`. */
  plan?: SessionPlan;
  /** Additive: called with each runner this view creates (hosts, tests). */
  onRunner?(r: SessionRunner): void;
}

export type ShinsaStage = 'loading' | 'eligibility' | 'building' | 'failed' | 'empty' | 'exam' | 'notes' | 'result';

/** The sumi beat before the belt ceremony (design 09 §10 D1): the wash is in over --dur-3 and the whole beat holds 600 ms. */
export const SHINSA_SUMI_MS = 600;
/** The wash's kasure after the hold (--dur-1), as a timer fallback. */
export const SHINSA_SUMI_OUT_MS = 120;

/** The section kanji (耳 読 形 口 書) of a SHINSA_LABEL, shown in Mincho beside its English head. */
export function sectionKanji(sec: ShinsaSection): string {
  return Array.from(SHINSA_LABEL[sec])[0] ?? '';
}

/**
 * Speaking passed on the typed path: no role-play was spoken in this exam and
 * the learner has never shadowed or delivered a monologue (Speak or
 * self-assessment). Records shows "Speaking: untested (typed path)" then.
 */
export function typedPath(plan: SessionPlan, stats: Pick<Stats, 'shadowLines' | 'monologues'>): boolean {
  const spoke = plan.steps.some((s) => s.exercise === 'role-play' && s.params.mode === 'speak');
  if (spoke) return false;
  return stats.shadowLines === 0 && stats.monologues === 0;
}

function Coverage(p: { label: string; now: number; target: number }): JSX.Element {
  const pct = Math.round(p.now * 100);
  const target = Math.round(p.target * 100);
  const met = pct >= target ? 'true' : 'false';
  return (
    <div class="shinsa-cov" role="progressbar" aria-label={p.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-met={met}>
      <span class="shinsa-cov__label">{p.label}</span>
      <span class="meter shinsa-cov__track" data-target="" data-met={met} style={{ '--value': String(Math.min(1, p.now)), '--target': String(p.target), '--meter-tone': 'var(--matcha)' }}>
        <span class="meter__fill" />
      </span>
      <span class="shinsa-cov__count">{fill(S.coverageOf, { now: pct, target })}</span>
    </div>
  );
}

/** A section's head: its kanji in Mincho, its English beside it (zero-Japanese rule). */
function SheetHead(p: { sec: ShinsaSection }): JSX.Element {
  return (
    <span class="shinsa-sheet__head">
      <span class="shinsa-sheet__kanji" lang="ja">
        {sectionKanji(p.sec)}
      </span>{' '}
      <span class="shinsa-sheet__en">{AS.shinsaHead[p.sec]}</span>
    </span>
  );
}

export function ShinsaView(p: ShinsaViewProps): JSX.Element {
  const loader = p.loader ?? appContent;
  const belt = p.belt;
  const beltDef = BELTS.find((b) => b.id === belt);
  const [stage, setStage] = useState<ShinsaStage>('loading');
  const [elig, setElig] = useState<ShinsaEligibility | null>(null);
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [sectionIntro, setSectionIntro] = useState<number | null>(null);
  const [score, setScore] = useState<ShinsaScore | null>(null);
  const [notesDone, setNotesDone] = useState(false);
  const [, setTick] = useState(0);
  const [sumi, setSumi] = useState<'in' | 'leaving' | null>(null);
  const finished = useRef(false);
  const cardsVersion = store.cards.version.value;
  const progress = store.progress.value;
  // signage (design 09 §3.3): romaji only below Green kana; a kana ruby from Green on
  const romaji = romajiAllowed(store.profile.value.belt);
  const rubyMode = signRubyMode(store.settings.value.furigana);
  // the sumi beat's wash: the ceremony's seeded ink, encoded once (never a live filter)
  const wash = useMemo(() => inkWashUrl(hashSeed(store.seed(), 'shinsa', belt)), [belt]);

  useEffect(() => {
    if (stage !== 'loading') return;
    let alive = true;
    shinsaEligibleAsync(belt, loader)
      .then((e) => {
        if (!alive) return;
        setElig(e);
        setStage('eligibility');
      })
      .catch(() => {
        if (!alive) return;
        setElig(null);
        setStage('eligibility');
      });
    return () => {
      alive = false;
    };
  }, [stage, belt, loader, cardsVersion, progress]);

  useEffect(() => {
    if (!runner) return;
    let lastBlock = 0;
    const isExam = runner.plan.mode === 'shinsa';
    return effect(() => {
      const done = runner.done.value;
      void runner.index.value;
      void runner.feedback.value;
      setTick((t) => t + 1);
      if (done) {
        if (isExam) setStage('result');
        else {
          setNotesDone(true);
          setRunner(null);
          setStage('loading');
        }
        return;
      }
      if (runner.abandoned.value || !isExam) return;
      const step = runner.step.value;
      if (!step) return;
      const bi = runner.plan.blocks.findIndex((b) => b.stepIds.includes(step.id));
      if (bi > lastBlock) {
        lastBlock = bi;
        if (!runner.paused.peek()) runner.pause();
        setSectionIntro(bi);
      }
    });
  }, [runner]);

  useEffect(() => {
    if (stage !== 'result' || !runner || finished.current) return;
    finished.current = true;
    const sc = scoreShinsa(runner.plan, runner.results);
    finishShinsa(belt, sc);
    setScore(sc);
  }, [stage, runner, belt]);

  // the sumi beat on a pass: the wash is in at once (nijimi, --dur-3), holds to SHINSA_SUMI_MS, then dries out; any tap or key ends it
  useEffect(() => {
    if (stage !== 'result' || !score?.passed || prefersReducedMotion()) {
      setSumi(null);
      return;
    }
    setSumi('in');
    let out: ReturnType<typeof setTimeout> | null = null;
    const dry = (): void => {
      setSumi((s) => (s === 'in' ? 'leaving' : s));
      if (out === null) out = setTimeout(() => setSumi(null), SHINSA_SUMI_OUT_MS);
    };
    const hold = setTimeout(dry, SHINSA_SUMI_MS);
    document.addEventListener('pointerdown', dry, true);
    document.addEventListener('keydown', dry, true);
    return () => {
      clearTimeout(hold);
      if (out !== null) clearTimeout(out);
      document.removeEventListener('pointerdown', dry, true);
      document.removeEventListener('keydown', dry, true);
    };
  }, [stage, score]);

  // No retreat: leaving the room (browser Back, route change) mid-run abandons the fight honestly.
  useEffect(
    () => () => {
      if (runner && !runner.done.peek() && !runner.abandoned.peek()) runner.abandon();
    },
    [runner],
  );

  const beginExam = async (): Promise<void> => {
    setStage('building');
    setScore(null);
    setSectionIntro(null);
    finished.current = false;
    try {
      const plan = p.plan ?? (await buildShinsa(belt, hashSeed(store.seed(), 'shinsa', belt, store.today()), { loader, available: p.available }));
      if (plan.steps.length === 0) {
        setStage('empty');
        return;
      }
      const r = new SessionRunner(plan, { loader, persist: false });
      r.pause();
      p.onRunner?.(r);
      setRunner(r);
      setSectionIntro(0);
      setStage('exam');
    } catch {
      setStage('failed');
    }
  };

  const beginNotes = async (): Promise<void> => {
    setStage('building');
    setNotesDone(false);
    try {
      const plan = await buildNotesPlan({ loader, available: p.available });
      if (!plan) {
        setStage('empty');
        return;
      }
      if (plan.steps.length === 0) {
        // Nothing left to drill behind the notes: the Notes session is done by definition and the retake opens.
        completeNotesSession();
        setNotesDone(true);
        setStage('loading');
        return;
      }
      const r = new SessionRunner(plan, { loader });
      p.onRunner?.(r);
      setRunner(r);
      setStage('notes');
    } catch {
      setStage('failed');
    }
  };

  const leave = (): void => {
    if (runner && !runner.done.value && !runner.abandoned.value) runner.abandon();
    p.onExit();
  };

  const beltName = BELT_NAME[belt];
  // Furigana is switched off from Orange (design 04 §12; `<SessionView>` applies it); the first exam keeps it, and says so.
  const sectionsLine = belt === 'yellow' ? S.sectionsLineYellow : S.sectionsLine;
  const header = (
    <header class="shinsa-view__head">
      <h2 class="shinsa-view__title">
        <span lang="ja">審査</span> {fill(S.shinsaHeading, { belt: beltName })}
      </h2>
      {beltDef ? (
        <p class="shinsa-view__sub">
          <span class={`belt belt--${belt}`}>
            <span lang="ja">{beltDef.nameJa}</span> {beltDef.nameEn}
          </span>{' '}
          {romaji ? (
            <>
              <span lang="ja">{beltDef.titleJa}</span> {beltDef.titleRomaji}
            </>
          ) : (
            <Ruby ja={beltTitleRuby(beltDef)} mode={rubyMode} />
          )}
        </p>
      ) : null}
    </header>
  );

  if (stage === 'loading' || stage === 'building') {
    return (
      <section class="shinsa-view" aria-label={S.shinsaAria} aria-busy="true">
        {header}
        <p role="status">{stage === 'building' ? S.shinsaBuilding : S.loading}</p>
      </section>
    );
  }

  if (stage === 'failed' || stage === 'empty') {
    return (
      <section class="shinsa-view" aria-label={S.shinsaAria}>
        {header}
        <div class="notice notice--warn">
          <p>{stage === 'empty' ? S.shinsaEmptyPlan : S.shinsaBuildFailed}</p>
          <button type="button" class="btn" onClick={p.onExit}>
            {S.backToStation}
          </button>
        </div>
      </section>
    );
  }

  if (stage === 'eligibility') {
    if (belt === 'white' || !elig) {
      return (
        <section class="shinsa-view" aria-label={S.shinsaAria} data-stage="eligibility">
          {header}
          <div class="notice">
            <p>{belt === 'white' ? S.whiteNoExam : S.shinsaBuildFailed}</p>
            <button type="button" class="btn" onClick={p.onExit}>
              {S.backToStation}
            </button>
          </div>
        </section>
      );
    }
    const [from, to] = beltStations(belt);
    const gatesLeft = Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((n) => !progress.stationsCleared.includes(n)).length;
    const notes = progress.shinsaNotes?.belt === belt ? progress.shinsaNotes : undefined;
    return (
      <section class="shinsa-view" aria-label={S.shinsaAria} data-stage="eligibility" data-eligible={elig.eligible ? 'true' : 'false'}>
        {header}
        <h3 class="eyebrow shinsa-view__label">{S.eligibilityTitle}</h3>
        {notesDone ? <p class="notice">{S.notesDone}</p> : null}
        {elig.passed ? <p class="shinsa-view__status">{fill(S.shinsaEarnedLine, { belt: beltName })}</p> : null}
        <p class="shinsa-view__line">{gatesLeft === 0 ? S.gatesDoneLine : fill(S.gatesMissingLine, { n: gatesLeft })}</p>
        {elig.coverage ? (
          <div class="shinsa-view__coverage">
            <Coverage label={S.coverageGreen} now={elig.coverage.green} target={SHINSA_GREEN} />
            <Coverage label={S.coverageBrown} now={elig.coverage.brown} target={SHINSA_BROWN} />
          </div>
        ) : null}
        {elig.eligible ? (
          <p class="shinsa-view__status">{S.eligibleLine}</p>
        ) : (
          <ul class="shinsa-view__reasons" aria-label={S.eligibilityTitle}>
            {elig.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        {notes ? (
          <section class="shinsa-notes" aria-label={S.notesTitle2}>
            <h4 class="eyebrow shinsa-view__label">{S.notesTitle2}</h4>
            <p>{S.notesLine}</p>
            <p>{notes.items.length === 1 ? S.notesItem : fill(S.notesItems, { n: notes.items.length })}</p>
            {notes.tags.length > 0 ? <p>{fill(S.notesTags, { tags: notes.tags.map((t) => TAG_LABEL[t]).join(', ') })}</p> : null}
            <ul class="shinsa-notes__items">
              {Array.from(new Set(notes.items.map((k) => parseCardKey(k).itemId)))
                .slice(0, 12)
                .map((id) => (
                  <li key={id} class="chip chip--tag" lang="ja">
                    {itemHead(loader.get(id), id)}
                  </li>
                ))}
            </ul>
            <button type="button" class="hanko" onClick={() => void beginNotes()}>
              {S.notesButton}
            </button>
          </section>
        ) : null}
        <h3 class="eyebrow shinsa-view__label">{S.sectionsTitle}</h3>
        <p class="shinsa-view__line">{sectionsLine}</p>
        <ol class="shinsa-view__sections">
          {SHINSA_SECTIONS.map((sec) => (
            <li key={sec} class="sheet shinsa-sheet" aria-label={fill(AS.shinsaSheetAria, { head: AS.shinsaHead[sec] })}>
              <SheetHead sec={sec} />
              <span class="shinsa-sheet__line">{S.sectionLine[sec]}</span>
            </li>
          ))}
        </ol>
        <div class="shinsa-view__actions">
          {elig.eligible ? (
            <button type="button" class="hanko" onClick={() => void beginExam()}>
              {S.beginExam}
            </button>
          ) : null}
          <button type="button" class="btn btn--ghost" onClick={p.onExit}>
            {S.backToStation}
          </button>
        </div>
      </section>
    );
  }

  if (stage === 'notes' && runner) {
    return (
      <section class="shinsa-view" aria-label={S.shinsaAria} data-stage="notes">
        {header}
        <h3 class="eyebrow shinsa-view__label">{S.notesTitle2}</h3>
        <SessionHost runner={runner} onExit={leave} view={p.view} />
      </section>
    );
  }

  if (stage === 'exam' && runner) {
    const plan = runner.plan;
    if (sectionIntro !== null) {
      const block = plan.blocks[sectionIntro];
      const first = plan.steps.find((s) => s.id === block?.stepIds[0]);
      const sec: ShinsaSection | null = first ? sectionOfStep(first.id) : null;
      return (
        <section class="shinsa-view" aria-label={S.shinsaAria} data-stage="section">
          {header}
          <article class="sheet shinsa-sheet shinsa-section" aria-label={fill(S.sectionIntro, { n: sectionIntro + 1, total: plan.blocks.length })}>
            <h3 class="eyebrow">{fill(S.sectionIntro, { n: sectionIntro + 1, total: plan.blocks.length })}</h3>
            <p class="shinsa-section__name">{sec ? <SheetHead sec={sec} /> : <span lang="ja">{block?.label ?? ''}</span>}</p>
            <p class="shinsa-section__line">{sec ? S.sectionLine[sec] : ''}</p>
            <p class="shinsa-view__line">{sectionsLine}</p>
            <div class="shinsa-view__actions">
              <button
                type="button"
                class="hanko"
                onClick={() => {
                  runner.resume();
                  setSectionIntro(null);
                }}
              >
                {S.begin}
              </button>
              <button type="button" class="btn btn--ghost" onClick={leave}>
                {S.leave}
              </button>
            </div>
          </article>
        </section>
      );
    }
    return (
      <section class="shinsa-view" aria-label={S.shinsaAria} data-stage="exam">
        <SessionHost runner={runner} onExit={leave} view={p.view} />
      </section>
    );
  }

  if (stage === 'result' && runner) {
    const plan = runner.plan;
    const sc = score ?? scoreShinsa(plan, runner.results);
    const typed = typedPath(plan, store.stats.value);
    const passMark = Math.round(SHINSA_PASS * 100);
    const notesNow = store.progress.value.shinsaNotes?.belt === belt ? store.progress.value.shinsaNotes : undefined;
    return (
      <section class="shinsa-view" aria-label={S.shinsaAria} data-stage="result" data-passed={sc.passed ? 'true' : 'false'}>
        {sumi ? <div class="shinsa-sumi ink-nijimi" data-leaving={sumi === 'leaving' ? '' : undefined} aria-hidden="true" style={{ '--shinsa-wash': `url("${wash}")` }} /> : null}
        {header}
        <h3 class="shinsa-view__result">{sc.passed ? S.shinsaPassed : S.shinsaNotYet}</h3>
        {sc.passed ? (
          <p class="shinsa-view__status">
            <span class="shinsa-view__xp">{S.shinsaXp}</span> · {fill(S.beltYours, { belt: beltName })}
          </p>
        ) : null}
        <dl class="shinsa-result__table">
          {SHINSA_SECTIONS.map((sec) => {
            const present = sc.present.includes(sec);
            const pct = Math.round(sc.sections[sec] * 100);
            return (
              <div key={sec} class="shinsa-result__row" data-pass={present ? (pct >= passMark ? 'true' : 'false') : 'absent'}>
                <dt lang="ja">{SHINSA_LABEL[sec]}</dt>
                <dd>{present ? fill(S.percent, { n: pct }) : S.danLater}</dd>
              </div>
            );
          })}
        </dl>
        {typed ? (
          <p class="notice shinsa-view__typed">
            <strong>{S.typedNote}</strong> {S.typedNoteLong}
          </p>
        ) : null}
        {!sc.passed && notesNow ? (
          <section class="shinsa-notes" aria-label={S.notesTitle2}>
            <h4 class="eyebrow shinsa-view__label">{S.notesTitle2}</h4>
            <p>{S.notesLine}</p>
            <p>{notesNow.items.length === 1 ? S.notesItem : fill(S.notesItems, { n: notesNow.items.length })}</p>
            {notesNow.tags.length > 0 ? <p>{fill(S.notesTags, { tags: notesNow.tags.map((t) => TAG_LABEL[t]).join(', ') })}</p> : null}
            <ul class="shinsa-notes__items">
              {Array.from(new Set(notesNow.items.map((k) => parseCardKey(k).itemId)))
                .slice(0, 12)
                .map((id) => (
                  <li key={id} class="chip chip--tag" lang="ja">
                    {itemHead(loader.get(id), id)}
                  </li>
                ))}
            </ul>
            <button type="button" class="hanko" onClick={() => void beginNotes()}>
              {S.notesButton}
            </button>
          </section>
        ) : null}
        <div class="shinsa-view__actions">
          <button type="button" class="btn" onClick={p.onExit}>
            {S.backToStation}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="shinsa-view" aria-label={S.shinsaAria}>
      {header}
    </section>
  );
}
