/**
 * TSUZUKU — `.hanko.is-pressed` (design 09 §5.3: the ink-bleed ring, components.css).
 *
 * Delegated from one root: pointerdown on anything inside a `.hanko` presses
 * it, and the next pointerup / pointercancel anywhere in the document releases
 * every pressed seal under the root (a finger that slides off the seal still
 * releases it). The shell binds it once on `.layout` (§12.1 d41) so the Dojo's
 * hanko, Train's Begin and the session's Continue all ring; SessionView keeps
 * its own binding for the Leave slip's dialog, which lives outside the frame.
 * Returns a canceller.
 */
export function pressRing(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const up = (): void => {
    doc.removeEventListener('pointerup', up);
    doc.removeEventListener('pointercancel', up);
    for (const h of Array.from(root.querySelectorAll('.hanko.is-pressed'))) h.classList.remove('is-pressed');
  };
  const down = (e: Event): void => {
    const h = e.target instanceof Element ? e.target.closest('.hanko') : null;
    if (!h || !root.contains(h)) return;
    h.classList.add('is-pressed');
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', up);
  };
  root.addEventListener('pointerdown', down);
  return () => {
    root.removeEventListener('pointerdown', down);
    up();
  };
}
