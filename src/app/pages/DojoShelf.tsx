/**
 * TSUZUKU — `<DojoShelf/>` the shelf of seals (prints B2; design 06 §5 the
 * Dojo's procedural state, design 09 §5.3 seals, §7 A beat 1,700 "since
 * yesterday", §8 the return loop).
 *
 * When the print of the day hangs where the drawn room was, the room's state
 * moves here: six seals in a row (three per row under 640 px) — belt,
 * lanterns, days trained, goshuin, mon, word-spirits — each a kanji the UI
 * already carries, its value in the pixel face, a muted label, and each a
 * link to the room the matching hotspot opened (`DojoScene hotspotsFor`: the
 * belt rack → kakejiku, the bonsai and the hearth → records, the stamp rack
 * → goshuin, the Mon shelf → crests). The kanji is `aria-hidden`; its
 * reading and meaning (`obi · belt`, `.seal-tile__r`) stand as the tile's
 * first line, visible — every Japanese string the learner meets carries both
 * — and so precede the value for screen readers too.
 * The shelf is a real `<ul>` of six `<li>`, one link each, with no ARIA role
 * on anything: `role="listitem"` on an `a[href]` would replace its link role
 * (the seals would leave the links rotor), and the native list says the same.
 * The page mounts the shelf in print mode only — the drawn room keeps its
 * furniture, so the no-pack fallback never shows its state twice (06 §5).
 *
 * Since yesterday: on the arrival in print mode (`arrival` prop) the persisted
 * `progress.sceneSeen` is diffed ONCE per mount against today's durable fields
 * (`durableFieldsOf(sceneInputs())`, the scene's own tables, unchanged) and
 * every seal whose VALUE grew — a new belt or dan, a level, a training day, a
 * new goshuin, a new crest category, more word-spirits — carries `data-since`
 * and one `.ink-nijimi` (`--i` staggered, pages.css delays it past the column);
 * reduced motion draws a static 1 px gold ring (`data-ring`) instead. The shelf
 * then persists the fields as the new `sceneSeen` exactly as `DojoScene` does,
 * and only the mounted path writes: the page passes `arrival` here only once
 * the print is up, so the drawn room (the fallback) keeps its own pulse and
 * write and the two never double-count. A loss — fewer days, a cooled hearth —
 * is never marked (design 09 §7 A's ethical line); a first visit (no
 * `sceneSeen`) marks nothing.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { durableFieldsOf, sceneInputs } from '@/art/dojo/DojoScene';
import { MON_SLOTS, TATAMI_BY_BELT, lanternCount } from '@/art/dojo/room';
import type { Belt } from '@/content/types';
import { href, type Route } from '@/shared/routes';
import type { SceneSeen, StampEntry } from '@/shared/store-types';
import { store } from '@/store';
import { BELT_NAME, S, fmt, num } from './strings';

export type SealId = 'belt' | 'lanterns' | 'days' | 'goshuin' | 'mon' | 'spirits';
export const SEAL_IDS: readonly SealId[] = ['belt', 'lanterns', 'days', 'goshuin', 'mon', 'spirits'];

export interface Seal {
  id: SealId;
  /** The kanji (aria-hidden; every one is already in the UI inventory). */
  ja: string;
  /** The reading and the English meaning, "obi · belt": the tile's first line, visible, read before the value. */
  name: string;
  /** The value in the pixel face. */
  value: string;
  /** The muted label under it. */
  label: string;
  route: Route;
}

/** What the seals are read from — the durable fields of the picture plus the goshuin count. */
export interface ShelfValues {
  belt: Belt;
  level: number;
  totalDays: number;
  badgeCategories: number;
  counts: Partial<Record<string, number>>;
  stamps: number;
}

/** Black-belt items of every kind: the word-spirit count (`SceneSeen.counts` may be partial). */
export function spiritTotal(counts: Partial<Record<string, number>> | undefined): number {
  let t = 0;
  for (const n of Object.values(counts ?? {})) if (typeof n === 'number' && Number.isFinite(n)) t += Math.max(0, Math.floor(n));
  return t;
}

/** Goshuin on the rack: the entries under a station number. */
export function stampCount(stamps: Record<number, StampEntry | undefined>): number {
  let n = 0;
  for (const [k, e] of Object.entries(stamps)) if (Number.isFinite(Number(k)) && e) n++;
  return n;
}

/**
 * Which seals' values GREW since the save was last seen, in shelf order. Only
 * growth: a belt or dan up, a level up, a training day added, a new goshuin,
 * a new crest category, more word-spirits. Nothing lost is ever marked, and
 * no `seen` (first visit) marks nothing.
 */
export function shelfSince(seen: SceneSeen | undefined, now: SceneSeen): SealId[] {
  if (!seen) return [];
  const out: SealId[] = [];
  if (now.belt !== seen.belt || now.dan > seen.dan) out.push('belt');
  if (now.level > seen.level) out.push('lanterns');
  if (now.totalDays > seen.totalDays) out.push('days');
  if (now.latestStamp !== undefined && now.latestStamp !== seen.latestStamp) out.push('goshuin');
  if (now.badgeCategories > seen.badgeCategories) out.push('mon');
  if (spiritTotal(now.counts) > spiritTotal(seen.counts)) out.push('spirits');
  return out;
}

/** "lanterns at 10" before the first lantern, then the count the eaves carry (one per ten levels). */
export function lanternLabel(level: number): string {
  const n = lanternCount(level);
  return n === 0 ? S.sealLanternLabelNone : n === 1 ? S.sealLanternLabelOne : fmt(S.sealLanternLabel, { n });
}

/** The six seals, in shelf order, from the values. */
export function sealsOf(v: ShelfValues): Seal[] {
  const spirits = spiritTotal(v.counts);
  return [
    { id: 'belt', ja: S.sealBeltJa, name: S.sealBeltName, value: BELT_NAME[v.belt] ?? v.belt, label: fmt(S.sealBeltLabel, { n: TATAMI_BY_BELT[v.belt] ?? 2 }), route: { name: 'collections', tab: 'kakejiku' } },
    { id: 'lanterns', ja: S.sealLanternJa, name: S.sealLanternName, value: fmt(S.sealLanternValue, { n: num(v.level) }), label: lanternLabel(v.level), route: { name: 'records' } },
    { id: 'days', ja: S.sealDaysJa, name: S.sealDaysName, value: num(v.totalDays), label: v.totalDays === 1 ? S.sealDaysLabelOne : S.sealDaysLabel, route: { name: 'records' } },
    { id: 'goshuin', ja: S.sealStampJa, name: S.sealStampName, value: num(v.stamps), label: S.sealStampLabel, route: { name: 'collections', tab: 'goshuin' } },
    { id: 'mon', ja: S.sealMonJa, name: S.sealMonName, value: fmt(S.sealMonValue, { n: Math.min(v.badgeCategories, MON_SLOTS), total: MON_SLOTS }), label: S.sealMonLabel, route: { name: 'collections', tab: 'mon' } },
    { id: 'spirits', ja: S.sealSpiritJa, name: S.sealSpiritName, value: num(spirits), label: spirits === 1 ? S.sealSpiritLabelOne : S.sealSpiritLabel, route: { name: 'records' } },
  ];
}

export interface DojoShelfProps {
  /** The daily arrival with the print up (design 09 §7 A): diff and mark since yesterday, then persist `sceneSeen`. Never set while the drawn room is mounted. */
  arrival?: boolean;
  /** Reduced motion: the static ring instead of the one-shot bleed. */
  reduced: boolean;
}

export function DojoShelf(p: DojoShelfProps): JSX.Element {
  const inputs = sceneInputs();
  const stamps = stampCount(store.collections.value.stamps);
  // since yesterday: diffed ONCE per mount, on the arrival, against the picture as last seen
  const [since] = useState<SealId[]>(() => (p.arrival ? shelfSince(store.progress.peek().sceneSeen, durableFieldsOf(inputs)) : []));
  // the arrival persists the picture as seen (once a day; DojoPage writes `arrivedDay`)
  useEffect(() => {
    if (!p.arrival) return;
    const now = durableFieldsOf(inputs);
    store.patch('progress', (pr) => ({ ...pr, sceneSeen: now }));
  }, []);
  const seals = sealsOf({ belt: inputs.belt, level: inputs.level, totalDays: inputs.totalDays, badgeCategories: inputs.badgeCategories, counts: inputs.counts, stamps });
  let i = 0;
  return (
    <ul class="dojo__shelf" aria-label={S.dojoShelfLabel} data-shelf data-since={since.length > 0 ? since.join(' ') : undefined}>
      {seals.map((s) => {
        const grew = since.includes(s.id);
        const ink = grew && !p.reduced;
        return (
          <li key={s.id}>
            <a
              class={`seal-tile${ink ? ' ink-nijimi' : ''}`}
              style={ink ? ({ '--i': i++ } as JSX.CSSProperties) : undefined}
              href={href(s.route)}
              data-tile={s.id}
              data-since={grew ? '' : undefined}
              data-ring={grew && p.reduced ? '' : undefined}
            >
              <span class="seal-tile__k" lang="ja" aria-hidden="true">
                {s.ja}
              </span>
              <span class="seal-tile__t">
                <span class="seal-tile__r">{s.name}</span>
                <span class="seal-tile__v">{s.value}</span>
                <span class="seal-tile__n">{s.label}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
