/**
 * TSUZUKU — the Perapera radar (ぺらぺら指数, design 05 §11) for Records.
 *
 * Reads `store/perapera.peraperaNow` over the live store (recomputed on every
 * render; the slices it touches are signals, so the component re-renders when
 * they change) and overlays the last stored monthly snapshot as the dashed
 * history polygon. Flags are spelled out, not just shown: 耳 is always
 * "(synthetic)" because every in-app voice is TTS; 口 is "(estimated)" on the
 * self-assessment path and "(no voice)" when speaking is off; ledger-fed
 * numbers are "(reported)". Each axis has one sentence saying what it is
 * made of (`explain`), so the number is never a mystery. The first Records
 * visit of a month with a stored earlier snapshot morphs the polygon from last
 * month to now over 600 ms (design 09 §8 "the month"; `Radar morph`): once per
 * calendar month, the month key remembered in localStorage under its own key
 * (and in memory) — never a save field — so a relaunch does not replay it.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { store } from '../store';
import { PERAPERA_LABELS_EN, peraperaHistory, peraperaNow, type PeraperaMonth, type PeraperaResult } from '../store/perapera';
import { S as DEFS } from '../store/defs-strings';
import { Radar } from './charts';
import { S } from './strings';
import './PeraperaRadar.css';

/** The stored snapshots that precede the current month (oldest first). */
export function earlierMonths(history: PeraperaMonth[], currentKey: string): PeraperaMonth[] {
  return history.filter((h) => h.month < currentKey);
}

function monthKeyOf(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Where the last morphed month key rests between launches (not the save). */
export const RADAR_MORPH_KEY = 'tsuzuku:radar-morphed';
/** The month whose radar has already morphed (memory mirror of the stored key). */
let morphedMonth: string | null = null;

/** `localStorage` when the host has one (never Node's flag-gated global, never a throwing private-mode getter). */
function storage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

function readMorphed(): string | null {
  if (morphedMonth !== null) return morphedMonth;
  try {
    const raw = storage()?.getItem(RADAR_MORPH_KEY);
    if (typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw)) morphedMonth = raw;
  } catch {
    /* no localStorage: memory only */
  }
  return morphedMonth;
}

/** Forgets the morph record (tests). */
export function resetRadarMorphForTests(): void {
  morphedMonth = null;
  try {
    storage()?.removeItem(RADAR_MORPH_KEY);
  } catch {
    /* nothing stored */
  }
}

/** Whether this mount morphs: an earlier month exists and this month has not morphed yet (on this device). */
export function claimRadarMorph(month: string, hasHistory: boolean): boolean {
  if (!hasHistory || readMorphed() === month) return false;
  morphedMonth = month;
  try {
    storage()?.setItem(RADAR_MORPH_KEY, month);
  } catch {
    /* memory only */
  }
  return true;
}

function flagLine(flag: string): string {
  if (flag === DEFS.flagSynthetic) return S.peraperaFlagSynthetic;
  if (flag === DEFS.flagEstimated) return S.peraperaFlagEstimated;
  if (flag === DEFS.flagNoVoice) return S.peraperaFlagNoVoice;
  return flag;
}

export function PeraperaRadar(): JSX.Element {
  // Subscribe to everything the index reads.
  store.cards.version.value;
  const meta = store.meta();
  const result: PeraperaResult = peraperaNow(meta, store.cards, store.now());
  const month = monthKeyOf(store.today());
  const history = earlierMonths(peraperaHistory(meta), month);
  const historyVectors = history.map((h) => h.axes as number[]);
  const flags = [...result.flags, S.reported];
  const [morph] = useState(() => claimRadarMorph(month, historyVectors.length > 0));

  return (
    <section class="perapera" aria-labelledby="perapera-title">
      <header class="perapera__head">
        <h2 id="perapera-title" class="perapera__title">
          <span lang="ja">{S.peraperaTitleJa}</span> <span class="perapera__title-en">{S.peraperaTitle}</span>
        </h2>
        <p class="perapera__composite">
          <span class="perapera__composite-num">{result.composite}</span>
          <span class="perapera__composite-label">
            {S.peraperaComposite} · {S.peraperaCompositeNote}
          </span>
        </p>
      </header>

      <div class="perapera__body">
        <Radar
          axes={result.labels}
          values={result.axes}
          history={historyVectors.length ? historyVectors : undefined}
          morph={morph}
          available={result.available}
          legend={{ now: S.peraperaNow, history: S.peraperaLastMonth }}
          tableLabels={PERAPERA_LABELS_EN.map((en, i) => `${result.labels[i] ?? ''} ${en}`)}
        />

        <dl class="perapera__axes">
          {result.axes.map((v, i) => (
            <div key={i} class={result.available[i] ? 'perapera__axis' : 'perapera__axis perapera__axis--off'}>
              <dt>
                <span lang="ja">{result.labels[i]}</span> <span class="perapera__axis-en">{PERAPERA_LABELS_EN[i]}</span>
                <span class="perapera__axis-value">{result.available[i] ? v : S.unavailable}</span>
              </dt>
              <dd>
                {result.explain[i]}
                {i === 1 ? ` ${DEFS.flagSynthetic}` : ''}
                {i === 3 && result.available[3] && result.flags.includes(DEFS.flagEstimated) ? ` ${DEFS.flagEstimated}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <ul class="perapera__flags" aria-label={S.peraperaFlagsLabel}>
        {flags.map((f) => (
          <li key={f}>
            <span class="tag">{f}</span> {f === S.reported ? S.peraperaFlagReported : flagLine(f)}
          </li>
        ))}
      </ul>

      {history.length === 0 ? (
        <p class="perapera__note">{S.peraperaNoHistory}</p>
      ) : (
        <details class="perapera__history">
          <summary>{S.peraperaHistoryTitle}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{S.label}</th>
                {PERAPERA_LABELS_EN.map((en, i) => (
                  <th key={en} scope="col">
                    <span lang="ja">{result.labels[i]}</span> {en}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.month}>
                  <th scope="row">{h.month}</th>
                  {h.axes.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
