/**
 * TSUZUKU — the data-saver gate (design 08 §13), one body for every reader:
 * the Settings toggle (which shows the EFFECTIVE state, not just the stored
 * flag), the boot prefetch in `main.tsx` and Radio's "no sprite beyond the
 * current track" rule. The learner's `settings.dataSaver` OR the browser's own
 * `navigator.connection.saveData` (Chrome Android) turns it on; the clip
 * player's idle `prefetchStation()` stores nothing while it is on.
 *
 * `clips.ts` stays store-free and re-exports the contract-tier `saveDataRequested()`
 * from `shared/audio.ts`; this module adds the store half; both are on the `@/audio` barrel.
 */
import type { Settings } from '../shared/store-types';
import { store } from '../store';
import { saveDataRequested } from './clips';

export { saveDataRequested };

/** The slice of `Settings` the gate reads (a double passes `{ dataSaver }`). */
export type DataSaverSettings = Pick<Settings, 'dataSaver'>;

/**
 * `settings.dataSaver || saveDataRequested()`: the effective data-saver state.
 * Defaults to the live store settings and the real `navigator`; both are
 * injectable so a page or a test can evaluate a candidate state.
 */
export function dataSaverOn(s: DataSaverSettings = store.settings.value, nav?: unknown): boolean {
  return s.dataSaver === true || saveDataRequested(nav);
}

/** Idle sprite prefetch may store bytes right now: the negation of `dataSaverOn()`. */
export function prefetchAllowed(s?: DataSaverSettings, nav?: unknown): boolean {
  return !dataSaverOn(s, nav);
}
