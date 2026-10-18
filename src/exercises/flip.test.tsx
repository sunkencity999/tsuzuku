/**
 * flip.ts — FLIP for reordered tiles (design 09 §10 C1): identity by data-flip,
 * transform only, nothing under reduced motion or when nothing moved.
 */
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLIP_ATTR, flipMove, measureFlip, playFlip, useFlip } from './flip';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom lays nothing out: fake each tile's place from `data-x` / `data-y`. */
function fakeRects(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const x = Number(this.getAttribute('data-x') ?? 0);
    const y = Number(this.getAttribute('data-y') ?? 0);
    return { left: x, top: y, right: x + 10, bottom: y + 10, width: 10, height: 10, x, y, toJSON: () => ({}) } as DOMRect;
  });
}

describe('flipMove', () => {
  it('starts the element back by the delta and lets the transform transition to rest (transform only); a zero delta is a no-op', () => {
    const el = document.createElement('div');
    expect(flipMove(el, 0, 0)).toBe(false);
    expect(el.style.transition).toBe('');
    expect(flipMove(el, 24, -8)).toBe(true);
    expect(el.style.transform).toBe('');
    expect(el.style.transition).toBe('transform var(--dur-2) var(--ease)');
    el.dispatchEvent(new Event('transitionend'));
    expect(el.style.transition).toBe('');
  });
});

describe('measureFlip / playFlip', () => {
  it('measures by key and glides only the tiles whose place changed', () => {
    fakeRects();
    root.innerHTML = `<span ${FLIP_ATTR}="a" data-x="0"></span><span ${FLIP_ATTR}="b" data-x="40"></span>`;
    const before = measureFlip(root);
    expect([...before.keys()]).toEqual(['a', 'b']);
    // b moves into a's place; a stays
    root.querySelector('[data-flip="b"]')!.setAttribute('data-x', '0');
    expect(playFlip(root, before)).toBe(1);
    const b = root.querySelector<HTMLElement>('[data-flip="b"]')!;
    expect(b.style.transition).toContain('transform var(--dur-2)');
    expect(root.querySelector<HTMLElement>('[data-flip="a"]')!.style.transition).toBe('');
  });

  it('places are relative to the root: a scroll between the two measures (the root itself moved) is not a move', () => {
    fakeRects();
    root.innerHTML = `<span ${FLIP_ATTR}="a" data-x="0"></span><span ${FLIP_ATTR}="b" data-x="40"></span>`;
    const before = measureFlip(root);
    expect(before.get('b')).toEqual({ left: 40, top: 0 });
    // the page scrolls 120 px: root and tiles share the offset
    root.setAttribute('data-y', '-120');
    for (const el of Array.from(root.querySelectorAll('[data-flip]'))) el.setAttribute('data-y', '-120');
    expect(playFlip(root, before)).toBe(0);
    // a real reorder under the same scroll still glides
    root.querySelector('[data-flip="b"]')!.setAttribute('data-x', '0');
    expect(playFlip(root, before)).toBe(1);
  });

  it('a tile with no previous place does not move (entrances are the host\'s)', () => {
    fakeRects();
    root.innerHTML = `<span ${FLIP_ATTR}="a" data-x="0"></span>`;
    const before = measureFlip(root);
    root.innerHTML = `<span ${FLIP_ATTR}="a" data-x="0"></span><span ${FLIP_ATTR}="n" data-x="40"></span>`;
    expect(playFlip(root, before)).toBe(0);
  });
});

function Row(p: { order: string[]; places: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref, p.order.join(','));
  return (
    <div ref={ref}>
      {p.order.map((k) => (
        <span key={k} data-flip={k} data-x={p.places[k]} />
      ))}
    </div>
  );
}

describe('useFlip', () => {
  it('FLIPs the moved tiles on reorder and does nothing under reduced motion', () => {
    fakeRects();
    act(() => render(<Row order={['a', 'b']} places={{ a: 0, b: 40 }} />, root));
    act(() => render(<Row order={['b', 'a']} places={{ b: 0, a: 40 }} />, root));
    expect(root.querySelector<HTMLElement>('[data-flip="a"]')!.style.transition).toContain('transform');
    expect(root.querySelector<HTMLElement>('[data-flip="b"]')!.style.transition).toContain('transform');

    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    render(null, root);
    act(() => render(<Row order={['a', 'b']} places={{ a: 0, b: 40 }} />, root));
    act(() => render(<Row order={['b', 'a']} places={{ b: 0, a: 40 }} />, root));
    expect(root.querySelector<HTMLElement>('[data-flip="a"]')!.style.transition).toBe('');
  });
});
