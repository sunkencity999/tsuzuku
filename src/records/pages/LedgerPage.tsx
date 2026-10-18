/**
 * TSUZUKU — the Input Ledger 耳目帳 (group B; design 05 §9, 04 §9).
 *
 * Hours of real listening, reading, watching and speaking, by source and by
 * kind; the week against the belt's target (a ring); the last twelve weeks
 * as stacked minutes; the 1,500-hour milestone; a one-tap add-entry form
 * (10/20/30/60, kind, note → bookmarks); today's rows with an inline minutes
 * edit; Field Missions from the catalog with belt availability and a report
 * form; the mission log and the bookmarks. Every self-reported number says
 * "(reported)". Writes go through `addLedgerEntry` / `logMission` so the XP
 * reducer and the stats see the same events as the end card.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { BELT_IDS, type Belt } from '../../content/types';
import { MISSIONS, type MissionDef } from '../../shared/catalog';
import { href, type Route } from '../../shared/routes';
import { LEDGER_KINDS, type EpochDay, type LedgerEntry, type LedgerKindName, type SaveMeta } from '../../shared/store-types';
import { fill } from '../../shared/ui/strings';
import { KIND_INDEX, LEDGER_GOAL_HOURS, addLedgerEntry, ledgerHoursBy, logMission, store, weekAppMinutes } from '../../store';
import { ledgerSummary } from '../../store/selectors';
import { BarRow, Ring, StackedBars, fmtNum, fullDate, tickDate } from '../charts';
import { BELT_EN, LEDGER_KIND, S } from '../strings';
import './LedgerPage.css';

export interface LedgerPageProps {
  route: Route;
}

export const QUICK_MINUTES: readonly number[] = [10, 20, 30, 60];
/** Design 02 §6.1: roughly 400 ledger hours by arrival at full adherence. */
export const KYOTO_HOURS = 400;

function beltRank(b: Belt): number {
  return BELT_IDS.indexOf(b);
}

/** Missions the learner's belt (or dan) has unlocked. */
export function availableMissions(belt: Belt, dan: number, all: readonly MissionDef[] = MISSIONS): MissionDef[] {
  return all.filter((m) => dan > 0 || beltRank(m.belt) <= beltRank(belt));
}

function hoursText(h: number): string {
  return fill(S.hoursShort, { h: fmtNum(Math.round(h * 10) / 10) });
}

/**
 * Minutes heard in the dojo in `today`'s week (design 08 §12 "In the dojo this
 * week: {h} h heard"): the store's `weekAppMinutes` — `listen` rows with
 * `source: app` (Arena sets, Ear Walks, Radio, Read-along), Monday to Sunday.
 * Informational — the weekly ring and its target keep counting outside hours
 * only (`weekProgress`).
 */
export function dojoWeekMinutes(m: SaveMeta, today: EpochDay): number {
  return weekAppMinutes(m, today);
}

function kindName(idx: number): LedgerKindName {
  return LEDGER_KINDS[idx] ?? 'listen';
}

/**
 * A row's minutes as the learner reads them: whole when whole, one decimal
 * when fractional — a Radio or Read-along row holds `listen:played` seconds
 * to a tenth of a minute (design 08 §12), a hand-entered row a whole minute.
 */
export function rowMinutes(m: number): string {
  return fmtNum(Math.round(m * 10) / 10);
}

/** What the editor opens with: the row rounded to a whole minute, at least 1 — the editor saves whole minutes only. */
export function editableMinutes(m: number): number {
  return Number.isFinite(m) ? Math.max(1, Math.round(m)) : 1;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Add-entry form                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function AddEntry(): JSX.Element {
  const [minutes, setMinutes] = useState<number>(20);
  const [kind, setKind] = useState<LedgerKindName>('listen');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const submit = (e: Event): void => {
    e.preventDefault();
    const m = Math.round(Number(minutes));
    if (!Number.isFinite(m) || m <= 0) {
      setStatus(S.addZero);
      return;
    }
    addLedgerEntry({ day: store.today(), minutes: m, kind: KIND_INDEX[kind], source: 1, note: note.trim() || undefined });
    setStatus(fill(S.addDone, { n: m, kind: LEDGER_KIND[kind].label }));
    setNote('');
  };

  return (
    <form class="ledger__form" onSubmit={submit} aria-labelledby="ledger-add-title">
      <h2 id="ledger-add-title" class="ledger__h2">
        {S.addTitle}
      </h2>
      <div class="ledger__quick" role="group" aria-label={S.addQuick}>
        {QUICK_MINUTES.map((n) => (
          <button key={n} type="button" class="btn ledger__quick-btn" aria-pressed={minutes === n} aria-label={fill(S.addQuickLabel, { n })} onClick={() => setMinutes(n)}>
            {n}
          </button>
        ))}
      </div>
      <div class="ledger__fields">
        <label class="field">
          <span class="field__label">{S.addMinutes}</span>
          <input class="input" type="number" inputMode="numeric" min={1} max={1440} step={1} value={minutes} onInput={(e) => setMinutes(Number((e.currentTarget as HTMLInputElement).value))} />
        </label>
        <label class="field">
          <span class="field__label">{S.addKind}</span>
          <select class="select" value={kind} onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as LedgerKindName)}>
            {LEDGER_KINDS.map((k) => (
              <option key={k} value={k}>
                {LEDGER_KIND[k].glyph} {LEDGER_KIND[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label class="field">
        <span class="field__label">{S.addNote}</span>
        <textarea class="input ledger__note" rows={2} value={note} onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
        <span class="field__hint">{S.addNoteHint}</span>
      </label>
      <div class="ledger__actions">
        <button type="submit" class="hanko">
          {S.addSubmit}
        </button>
        <span class="ledger__hint">{S.addXpNote}</span>
      </div>
      <p class="ledger__status" role="status" aria-live="polite">
        {status ?? ''}
      </p>
    </form>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Today's rows                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function TodayRows(): JSX.Element {
  const today = store.today();
  const entries = store.ledger.value.entries;
  const [editing, setEditing] = useState<{ index: number; minutes: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const rows = entries.map((e, index) => ({ e, index })).filter((r) => r.e[0] === today);

  const save = (index: number, minutes: number): void => {
    // Whole minutes only, at least 1: a fractional row (never from the form, but a tenth-of-a-minute app row could be) is rounded first.
    const m = Math.round(minutes);
    if (!Number.isFinite(m) || m <= 0) {
      setStatus(S.addZero);
      return;
    }
    store.patch('ledger', (l) => {
      const next = l.entries.slice();
      const prev = next[index];
      if (!prev) return l;
      // The optional note column (the learner's free text) rides along: editing the minutes never drops it.
      const row: LedgerEntry = prev[4] !== undefined ? [prev[0], m, prev[2], prev[3], prev[4]] : [prev[0], m, prev[2], prev[3]];
      next[index] = row;
      return { ...l, entries: next };
    });
    setEditing(null);
    setStatus(S.edited);
  };

  return (
    <section class="ledger__block" aria-labelledby="ledger-today-title">
      <h2 id="ledger-today-title" class="ledger__h2">
        {S.todayTitle}
      </h2>
      {rows.length === 0 ? <p class="ledger__muted">{S.todayNone}</p> : null}
      <ul class="list ledger__today">
        {rows.map(({ e, index }) => {
          const k = kindName(e[2]);
          const external = e[3] === 1;
          const isEditing = editing?.index === index;
          return (
            <li key={index} class="list__item ledger__today-row">
              <span class="ledger__glyph" lang="ja" aria-hidden="true">
                {LEDGER_KIND[k].glyph}
              </span>
              {isEditing ? (
                <form
                  class="ledger__edit"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    save(index, editing.minutes);
                  }}
                >
                  <label class="field">
                    <span class="field__label">{S.editMinutes}</span>
                    <input class="input" type="number" min={1} max={1440} value={editing.minutes} onInput={(ev) => setEditing({ index, minutes: Number((ev.currentTarget as HTMLInputElement).value) })} />
                  </label>
                  <button type="submit" class="btn btn--sm">
                    {S.save}
                  </button>
                  <button type="button" class="btn btn--sm btn--ghost" onClick={() => setEditing(null)}>
                    {S.cancel}
                  </button>
                </form>
              ) : (
                <>
                  <span class="ledger__today-text">{fill(S.todayRow, { minutes: rowMinutes(e[1]), kind: LEDGER_KIND[k].label, source: external ? S.sourceExternal : S.sourceApp })}</span>
                  {external ? (
                    <button type="button" class="btn btn--sm btn--ghost" onClick={() => setEditing({ index, minutes: editableMinutes(e[1]) })}>
                      {S.editMinutes}
                    </button>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p class="ledger__status" role="status" aria-live="polite">
        {status ?? ''}
      </p>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Missions                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function Missions(): JSX.Element {
  const profile = store.profile.value;
  const ledger = store.ledger.value;
  const available = new Set(availableMissions(profile.belt, profile.dan).map((m) => m.id));
  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string | null>(null);
  const done = ledger.missions.length;
  const conv = ledger.missions.filter((m) => m.conversation).length;

  const report = (m: MissionDef): void => {
    const mins = Math.round(minutes[m.id] ?? m.minutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setStatus(S.addZero);
      return;
    }
    logMission(m.id, mins);
    setStatus(fill(S.missionLogged, { n: mins }));
  };

  return (
    <section class="ledger__block" aria-labelledby="ledger-missions-title">
      <h2 id="ledger-missions-title" class="ledger__h2">
        <span lang="ja">{S.missionsTitleJa}</span> <span class="ledger__h2-en">{S.missionsTitle}</span>
      </h2>
      <p class="ledger__muted">{S.missionsLede}</p>
      <p class="ledger__line">
        {done === 1 ? S.missionsDoneOne : fill(S.missionsDone, { n: done })} · {conv === 1 ? S.conversationOne : fill(S.conversationsDone, { n: conv })}
      </p>
      <ul class="ledger__missions">
        {MISSIONS.map((m) => {
          const open = available.has(m.id);
          return (
            <li key={m.id} class={open ? 'mission mission--available' : 'mission mission--locked'} data-tier={m.tier}>
              <div class="mission__head">
                <span class="tag">{fill(S.missionTier, { n: m.tier })}</span>
                <span class="mission__title">
                  <span lang="ja">{m.titleJa}</span> {m.titleEn}
                </span>
                {m.conversation ? <span class="chip chip--accent">{S.missionConversation}</span> : null}
                {open ? <span class="chip">{S.missionAvailable}</span> : <span class="chip">{fill(S.missionLocked, { belt: BELT_EN[m.belt] ?? m.belt })}</span>}
              </div>
              <p class="mission__prompt">{m.promptEn}</p>
              {open ? (
                <form
                  class="mission__form"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    report(m);
                  }}
                >
                  <label class="field mission__minutes">
                    <span class="field__label">{S.missionMinutes}</span>
                    <input class="input" type="number" min={1} max={1440} value={minutes[m.id] ?? m.minutes} onInput={(ev) => setMinutes({ ...minutes, [m.id]: Number((ev.currentTarget as HTMLInputElement).value) })} />
                  </label>
                  <button type="submit" class="btn">
                    {S.missionLog}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p class="ledger__status" role="status" aria-live="polite">
        {status ?? ''}
      </p>
      <h3 class="ledger__h3">{S.missionLogTitle}</h3>
      {ledger.missions.length === 0 ? (
        <p class="ledger__muted">{S.missionLogNone}</p>
      ) : (
        <ul class="ledger__log">
          {ledger.missions
            .slice()
            .reverse()
            .slice(0, 12)
            .map((x, i) => (
              <li key={`${x.day}-${i}`}>{fill(S.missionLogRow, { date: fullDate(x.day), tier: x.tier, conv: x.conversation ? S.missionLogConv : '' })}</li>
            ))}
        </ul>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function LedgerPage(_p: LedgerPageProps): JSX.Element {
  const meta = store.meta();
  const sum = ledgerSummary(12);
  const app = ledgerHoursBy(meta, { source: 0 });
  const ext = ledgerHoursBy(meta, { source: 1 });
  const kinds = LEDGER_KINDS.map((k) => ({ k, h: sum.hours[k] }));
  const kindMax = Math.max(1, ...kinds.map((x) => x.h));
  const weekHours = Math.round((sum.week.minutes / 60) * 10) / 10;
  const dojoHours = Math.round((dojoWeekMinutes(meta, store.today()) / 60) * 10) / 10;
  const bookmarks = store.bookmarks.value.slice().reverse().slice(0, 8);

  return (
    <article class="ledger">
      <header class="ledger__head">
        <h1 class="ledger__h1">
          <span lang="ja">{S.ledgerTitleJa}</span> <span class="ledger__h1-en">{S.ledgerTitle}</span>
        </h1>
        <p class="ledger__muted">{S.ledgerLede}</p>
      </header>

      <section class="ledger__block" aria-labelledby="ledger-week-title">
        <h2 id="ledger-week-title" class="ledger__h2">
          {S.weekTitle}
        </h2>
        <div class="ledger__week">
          <Ring ratio={sum.week.ratio} label={fill(S.ringLabel, { pct: Math.round(sum.week.ratio * 100) })} center={hoursText(weekHours)} />
          <div class="ledger__week-text">
            <p class="ledger__line">
              {fill(S.weekRing, { h: fmtNum(weekHours), target: fmtNum(sum.week.targetHours) })} <span class="tag">{S.reported}</span>
            </p>
            <p class="ledger__muted">{fill(S.weekTargetNote, { target: fmtNum(sum.week.targetHours), belt: BELT_EN[meta.profile.belt] ?? meta.profile.belt })}</p>
            {sum.week.ratio >= 1 ? <p class="ledger__line">{S.weekMet}</p> : null}
            <p class="ledger__line ledger__dojo" data-dojo-week>
              <span>{fill(S.weekDojo, { h: fmtNum(dojoHours) })}</span>
              <span class="ledger__muted">{S.weekDojoNote}</span>
            </p>
          </div>
        </div>
      </section>

      <section class="ledger__block" aria-labelledby="ledger-voices-title" data-honest-share>
        <h2 id="ledger-voices-title" class="ledger__h2">
          <span lang="ja">{S.dojoVoicesTitleJa}</span> <span class="ledger__h2-en">{S.dojoVoicesTitle}</span>
        </h2>
        <p class="ledger__muted">{S.honestShare}</p>
      </section>

      <AddEntry />

      <TodayRows />

      <section class="ledger__block" aria-labelledby="ledger-life-title">
        <h2 id="ledger-life-title" class="ledger__h2">
          {S.lifetimeTitle}
        </h2>
        <div class="ledger__tiles">
          <div class="tile">
            <span class="tile__value">{hoursText(sum.hours.total)}</span>
            <span class="tile__label">{S.lifetimeTotal}</span>
          </div>
          <div class="tile" data-tile-external>
            <span class="tile__value">{hoursText(ext.total)}</span>
            <span class="tile__label">
              {S.sourceExternal} <span class="tag">{S.reported}</span>
            </span>
          </div>
          <div class="tile">
            <span class="tile__value">{hoursText(app.total)}</span>
            <span class="tile__label">{S.sourceApp}</span>
          </div>
        </div>
        <h3 class="ledger__h3">{S.lifetimeGoal}</h3>
        <BarRow label={S.lifetimeGoal} value={sum.hours.total} max={LEDGER_GOAL_HOURS} valueText={hoursText(sum.hours.total)} marker={KYOTO_HOURS / LEDGER_GOAL_HOURS} markerLabel={S.kyotoMarker} series="ai" />
        <p class="ledger__muted">{fill(S.lifetimeGoalLine, { h: fmtNum(Math.round(sum.hours.total * 10) / 10) })}</p>
        <h3 class="ledger__h3">{S.byKind}</h3>
        <div class="ledger__bars">
          {kinds.map(({ k, h }) => (
            <BarRow key={k} label={`${LEDGER_KIND[k].glyph} ${LEDGER_KIND[k].label}`} value={h} max={kindMax} valueText={hoursText(h)} series={LEDGER_KIND[k].series} />
          ))}
        </div>
      </section>

      <section class="ledger__block" aria-labelledby="ledger-weeks-title">
        <h2 id="ledger-weeks-title" class="ledger__h2">
          {S.weeksTitle}
        </h2>
        <p class="ledger__muted">{S.weeksCaption}</p>
        <StackedBars
          caption={S.weeksTitle}
          unit=" min"
          series={LEDGER_KINDS.map((k) => ({ label: LEDGER_KIND[k].label, glyph: LEDGER_KIND[k].glyph, series: LEDGER_KIND[k].series }))}
          rows={sum.weeks.map((w) => ({ label: tickDate(w.start), title: fill(S.weekLabel, { date: fullDate(w.start) }), parts: LEDGER_KINDS.map((k) => w.minutes[k]) }))}
        />
      </section>

      <Missions />

      <section class="ledger__block" aria-labelledby="ledger-notes-title">
        <h2 id="ledger-notes-title" class="ledger__h2">
          {S.notesTitle}
        </h2>
        <p class="ledger__muted">{S.notesLede}</p>
        {bookmarks.length === 0 ? (
          <p class="ledger__muted">{S.notesNone}</p>
        ) : (
          <ul class="ledger__log">
            {bookmarks.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
      </section>

      <p class="ledger__footer">
        <a class="btn" href={href({ name: 'records' })}>
          {S.toRecords}
        </a>
      </p>
    </article>
  );
}
