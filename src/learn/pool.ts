/**
 * TSUZUKU — graded listening from the sentence pools (design 08 §4).
 *
 * `content:assign` writes one `ListeningPool` per station: every example
 * sentence and story line whose content tokens all link inside the cumulative
 * allowlist, as `PoolRef { ref, ids, kana, morae }`. This module selects from
 * those refs at the learner's LIVE known set — the same `knownSet`
 * (`learn/known.ts`, base facet R ≥ 0.85) the reader's coverage and the
 * Gatekeeper use — so every consumer (Ear Walk, Radio, `sentence-listen`
 * planning, Gatekeeper / Shinsa 耳, the Station page's "N min you can follow")
 * draws the same sentences:
 *
 *  - **i+0**: every id in `ref.ids` is known.
 *  - **i+1**: exactly one id is unknown, AND that id's `listen` card exists,
 *    AND it is due within `IMPLICIT_WINDOW_DAYS` or not yet in review state —
 *    so the one unknown is the word FSRS wants rehearsed, and the Arena's
 *    `implicitListenGrades` (which writes nothing for a missing card) can
 *    record the evidence. A vocab `listen` card unlocks at rec S ≥ 2 d
 *    (`scheduler.UNLOCK_RULES`); an unknown id without one is NOT i+1, and a
 *    grammar or kanji id (which never has a `listen` card) can never be the
 *    plus-one.
 *
 * Pool sizes are ceilings: in a station's first weeks the R filter admits a
 * fraction of them, so surfaces show `poolMinutes(selectPool(…))`, never the
 * allowlist figure. Pure: `today` and the cards are injected; the order of
 * the input is preserved (pool files are sorted by `content:assign`), so a
 * selection is deterministic for a given pool and save.
 */
import type { PoolRef } from '../content/types';
import { cardKey } from '../shared/ids';
import type { CardTuple, CardsApi, EpochDay } from '../shared/store-types';

/**
 * Days ahead within which a `listen` card counts as due for implicit evidence
 * (design 05 §4, 08 §4). Equal to `IMPLICIT_WINDOW_DAYS` in
 * `src/input/listening/set.ts` and `IMPLICIT_DUE_WINDOW` in `learn/apply.ts`;
 * exported here so the pure barrel needs neither.
 */
export const IMPLICIT_WINDOW_DAYS = 3;

/** Speech estimate per clip (design 08 §2, `scripts/listening-report.ts`): morae ÷ 7 s + 0.5 s. */
export const MORAE_PER_SECOND = 7;
export const CLIP_PAD_SECONDS = 0.5;

/** `'i+0'` = every id known; `'i+1'` = exactly one unknown id whose `listen` card is rehearsable (design 08 §4). */
export type PoolMode = 'i+0' | 'i+1';

export interface SelectPoolOptions {
  mode: PoolMode;
  /** At most this many refs, in input order (default: no cap). */
  limit?: number;
}

/**
 * The one unknown id of `ref` against `known`, or `null` when the ref has no
 * unknown id (i+0 material) or more than one (not gradable). Radio's G key
 * glosses this word (design 08 §10.2). Design 08 §4.
 */
export function plusOneId(ref: PoolRef, known: ReadonlySet<string>): string | null {
  let unknown: string | null = null;
  for (const id of ref.ids) {
    if (known.has(id)) continue;
    if (unknown !== null) return null;
    unknown = id;
  }
  return unknown;
}

/** Due within the window, or never yet in review (state 0 new / 1 learning). Design 08 §4. */
function rehearsable(card: CardTuple, today: EpochDay): boolean {
  return card[0] <= today + IMPLICIT_WINDOW_DAYS || card[5] === 0 || card[5] === 1;
}

/**
 * Selects pool refs at the learner's live known set (design 08 §4):
 * `mode: 'i+0'` keeps refs whose every id is in `known`; `mode: 'i+1'` keeps
 * refs with exactly one unknown id whose `listen` card EXISTS in `cards` and
 * is due within `IMPLICIT_WINDOW_DAYS` of `today` or not yet in review state.
 * Input order is preserved and `limit` cuts the tail, so the result is
 * deterministic for a given pool and save. Grammar / kanji ids never carry a
 * `listen` card, so a ref whose one unknown is such an id is never i+1.
 */
export function selectPool(refs: readonly PoolRef[], known: ReadonlySet<string>, cards: Pick<CardsApi, 'get'>, today: EpochDay, o: SelectPoolOptions): PoolRef[] {
  const limit = o.limit ?? Number.POSITIVE_INFINITY;
  const out: PoolRef[] = [];
  for (const ref of refs) {
    if (out.length >= limit) break;
    if (o.mode === 'i+0') {
      if (ref.ids.every((id) => known.has(id))) out.push(ref);
      continue;
    }
    const unknown = plusOneId(ref, known);
    if (unknown === null) continue;
    const card = cards.get(cardKey(unknown, 'listen'));
    if (card && rehearsable(card, today)) out.push(ref);
  }
  return out;
}

/**
 * Minutes of speech the refs hold at 1×: Σ (morae ÷ 7 + 0.5 s) ÷ 60 — the
 * same estimate `scripts/listening-report.ts` uses for the §2 hours tables,
 * so the Station page's "N min you can follow" and the report agree. Design 08 §4.
 */
export function poolMinutes(refs: readonly PoolRef[]): number {
  let seconds = 0;
  for (const r of refs) seconds += r.morae / MORAE_PER_SECOND + CLIP_PAD_SECONDS;
  return seconds / 60;
}
