/**
 * TSUZUKU — FLIP for reordered tiles (src/exercises, group D; design 09 §10 C1).
 *
 * `useFlip(ref, key)` measures every `[data-flip]` descendant of `ref` after
 * each render whose `key` changed and, for the ones that moved, plays the
 * inverse translate back to rest: transform only, --dur-2, --ease (§6.7 rule
 * 1). Identity is the `data-flip` value, not the node, so a tile that Preact
 * re-creates in a new parent (a slot, a row position) still glides from where
 * its predecessor stood. Places are measured relative to `root`, so a page
 * that scrolled between the two commits (a phone keyboard, a bank tap) is not
 * read as movement. Nothing happens for a tile with no previous place (an
 * entrance is the host's nijimi, not a FLIP), when nothing moved (jsdom
 * measures zeros), or under reduced motion — the reduced swap is none.
 */
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { prefersReducedMotion } from '@/shared/ui/use-reveal';

export const FLIP_ATTR = 'data-flip';

/** Starts `el` (already laid out in its new place) `dx, dy` back and lets the transform transition to none. Returns whether it moved. */
export function flipMove(el: HTMLElement, dx: number, dy: number): boolean {
  if (!dx && !dy) return false;
  el.style.transition = 'none';
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  el.getBoundingClientRect();
  el.style.transition = 'transform var(--dur-2) var(--ease)';
  el.style.transform = '';
  const clear = (): void => {
    el.style.transition = '';
    el.removeEventListener('transitionend', clear);
  };
  el.addEventListener('transitionend', clear);
  return true;
}

/** A tile's place relative to its root. */
export interface FlipPlace {
  left: number;
  top: number;
}

function placeOf(el: Element, base: DOMRect): FlipPlace {
  const r = el.getBoundingClientRect();
  return { left: r.left - base.left, top: r.top - base.top };
}

/** Current places of the `[data-flip]` descendants of `root`, by key, relative to `root`. */
export function measureFlip(root: Element): Map<string, FlipPlace> {
  const out = new Map<string, FlipPlace>();
  const base = root.getBoundingClientRect();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${FLIP_ATTR}]`))) {
    const k = el.getAttribute(FLIP_ATTR);
    if (k !== null) out.set(k, placeOf(el, base));
  }
  return out;
}

/** Glides every keyed tile from `before` to its place in `root`; returns how many moved. */
export function playFlip(root: Element, before: ReadonlyMap<string, FlipPlace>): number {
  let moved = 0;
  const base = root.getBoundingClientRect();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${FLIP_ATTR}]`))) {
    const k = el.getAttribute(FLIP_ATTR);
    const a = k === null ? undefined : before.get(k);
    if (!a) continue;
    const b = placeOf(el, base);
    if (flipMove(el, a.left - b.left, a.top - b.top)) moved++;
  }
  return moved;
}

/** Re-measures on every change of `key` and FLIPs the tiles that moved since the last measure. */
export function useFlip(ref: RefObject<HTMLElement>, key: unknown): void {
  const last = useRef<Map<string, FlipPlace> | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const before = last.current;
    if (before && !prefersReducedMotion()) playFlip(root, before);
    last.current = measureFlip(root);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
