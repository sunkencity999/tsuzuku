/**
 * TSUZUKU — `<TeachOnce>`: a dismissible first-contact card (design 08 §11).
 *
 * One short teaching note the learner meets once per `id` — "Japanese is
 * made of beats called morae" at Station 1, "You hear it before you see it"
 * at the first Arena, 雨 / 飴 at the first Pitch Ear, the Radio's "Everything
 * here is made of words you already know" — and dismisses for good. The seen
 * ids live in `Progress.teachSeen`.
 *
 * `shared/ui` stays store-free (ARCHITECTURE §0: leaf contracts; no
 * `shared/ui` module imports the store), so the card takes the seen set and
 * an `onDismiss(id)` callback as props, and the two pure helpers below give
 * every surface the same read and write shape:
 *
 *   <TeachOnce id="arena-first" title={S.arenaTeachTitle} body={S.arenaTeachBody}
 *              seen={store.progress.value.teachSeen}
 *              onDismiss={(id) => store.patch('progress', (p) => markTeachSeen(p, id))} />
 *
 * Copy comes from the surface's own `strings.ts` (Sensei voice, linted); the
 * dismiss label defaults to the shared `S.continue` and can be overridden.
 * Japanese in `title` / `body` is marked `lang="ja"` automatically.
 *
 * Motion (design 09 §6.3 "every surface that enters also exits"): the card
 * enters as `.ink-nijimi`; dismiss calls `onDismiss(id)` at once (the store
 * write and the drill's follow-up never wait on decoration) while the card
 * stays under `data-leaving` (kasure) until its exit ends — `animationend`,
 * or `EXIT_FALLBACK_MS` — and is gone at once under reduced motion or where
 * the engine runs no animations (`exitsPlay`). The verb rides the outer
 * `.teach-once` (the `role="note"` landmark); the `.status-window` cartouche
 * is the inner `.teach-once__card`, clipped and never transformed (§6.7 rule 7).
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { containsJapanese } from '../jp';
import type { Progress } from '../store-types';
import { EXIT_FALLBACK_MS, exitsPlay, onExitEnd } from './ExerciseFrame';
import { S } from './strings';
import './ui.css';

export { EXIT_FALLBACK_MS };

/** A seen set as the store holds it (`Progress.teachSeen`) or as a page may pre-build it. */
export type TeachSeen = ReadonlySet<string> | readonly string[] | undefined;

/**
 * Shape of a card id (design 08 §11): lowercase ASCII — `[a-z0-9]` then `[a-z0-9#:._-]`, at most
 * 64 characters — the same `ID_LIKE` / `ID_MAX` guard `store/migrations.ts fillMeta` applies to
 * `progress.teachSeen` at every load, import and merge. An id outside it is written and then dropped,
 * so its card would return after every reload: name the Station 7 card `pitch-ame`, never `pitch:雨`.
 */
export const TEACH_ID_RE = /^[a-z0-9][a-z0-9#:._-]{0,63}$/;

/** Whether `id` survives `fillMeta` (design 08 §11). */
export function isTeachId(id: string): boolean {
  return TEACH_ID_RE.test(id);
}

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** Dev-time guard (the `exercise-types.register` idiom): a bad id fails the surface's test instead of resurfacing its card in production. */
function assertTeachId(id: string): void {
  if (isDev() && !TEACH_ID_RE.test(id)) throw new RangeError(`TeachOnce id "${id}" does not match TEACH_ID_RE (lowercase ASCII, ≤ 64 chars); store/migrations fillMeta would drop it and the card would come back`);
}

/** Whether the card `id` was already dismissed (design 08 §11). */
export function isTeachSeen(seen: TeachSeen, id: string): boolean {
  if (!seen) return false;
  return seen instanceof Set ? seen.has(id) : (seen as readonly string[]).includes(id);
}

/**
 * The `Progress` write for a dismissal (design 08 §11): appends `id` to
 * `teachSeen` once, immutably; returns the same object when it is already
 * there, so `store.patch('progress', (p) => markTeachSeen(p, id))` is idempotent. In dev an `id`
 * outside `TEACH_ID_RE` throws a `RangeError` (`fillMeta` would drop it).
 */
export function markTeachSeen<P extends Pick<Progress, 'teachSeen'>>(progress: P, id: string): P {
  assertTeachId(id);
  const seen = progress.teachSeen ?? [];
  if (seen.includes(id)) return progress;
  return { ...progress, teachSeen: [...seen, id] };
}

export interface TeachOnceProps {
  /** Stable card id matching `TEACH_ID_RE` (lowercase ASCII, ≤ 64 chars — anything else is dropped by `migrations.fillMeta` and the card returns), e.g. `kana-morae`, `arena-first`, `radio-known-words` (design 08 §11 lists them by station). */
  id: string;
  title: string;
  body: string;
  /** `Progress.teachSeen` (or a set built from it). The card renders nothing once `id` is in it. */
  seen: TeachSeen;
  /** Called with `id` on dismiss; the caller writes `markTeachSeen` into the store. */
  onDismiss(id: string): void;
  /** Dismiss button label; default `S.continue`. */
  dismissLabel?: string;
  /** Optional extra content (an example, a pitch mark) between body and button. */
  children?: ComponentChildren;
  class?: string;
}

function Text(p: { text: string; class: string; as: 'h3' | 'p' }): JSX.Element {
  const lang = containsJapanese(p.text) ? 'ja' : undefined;
  return p.as === 'h3' ? (
    <h3 class={p.class} lang={lang}>
      {p.text}
    </h3>
  ) : (
    <p class={p.class} lang={lang}>
      {p.text}
    </p>
  );
}

export function TeachOnce(p: TeachOnceProps): JSX.Element | null {
  assertTeachId(p.id);
  const ref = useRef<HTMLElement>(null);
  /** `leaving`: the dismissed card is still playing its exit; `gone`: the id whose card has left (renders nothing from then on). */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  useEffect(() => {
    if (!leaving || !ref.current) return;
    return onExitEnd(ref.current, () => {
      setGone(leaving);
      setLeaving(null);
    });
  }, [leaving]);
  if (gone === p.id) return null;
  if (isTeachSeen(p.seen, p.id) && leaving !== p.id) return null;
  const dismiss = (): void => {
    if (leaving) return;
    if (exitsPlay()) setLeaving(p.id);
    else setGone(p.id);
    p.onDismiss(p.id);
  };
  return (
    <aside ref={ref} class={`teach-once ink-nijimi${p.class ? ` ${p.class}` : ''}`} role="note" data-teach-id={p.id} data-leaving={leaving ? '' : undefined} aria-labelledby={`teach-once-${p.id}`}>
      <div class="teach-once__card status-window">
        <h3 class="teach-once__title" id={`teach-once-${p.id}`} lang={containsJapanese(p.title) ? 'ja' : undefined}>
          {p.title}
        </h3>
        <Text text={p.body} class="teach-once__body" as="p" />
        {p.children}
        <div class="teach-once__actions">
          <button type="button" class="btn btn--sm teach-once__dismiss" onClick={dismiss}>
            {p.dismissLabel ?? S.continue}
          </button>
        </div>
      </div>
    </aside>
  );
}
