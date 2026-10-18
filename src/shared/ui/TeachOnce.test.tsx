import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Progress } from '../store-types';
import { TEACH_ID_RE, TeachOnce, isTeachId, isTeachSeen, markTeachSeen, type TeachSeen, EXIT_FALLBACK_MS } from './TeachOnce';
import { S } from './strings';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const progress = (teachSeen?: string[]): Progress => ({
  station: 4,
  stationsCleared: [1, 2, 3],
  perfectGates: 0,
  assisted: [],
  gateAttempts: {},
  grudge: [],
  shinsaPassed: [],
  awayDays: 0,
  welcomeBackDue: false,
  ...(teachSeen ? { teachSeen } : {}),
});

/** jsdom runs no animations, so exits are instant there; these tests lend it an engine (`getAnimations`) and end the exit by hand. */
let restoreEngine: (() => void) | null = null;
const withAnimations = (): void => {
  const proto = Element.prototype as { getAnimations?: () => Animation[] };
  const had = proto.getAnimations;
  proto.getAnimations = () => [];
  restoreEngine = () => {
    if (had) proto.getAnimations = had;
    else delete proto.getAnimations;
    restoreEngine = null;
  };
};
afterEach(() => restoreEngine?.());
const endAnimation = (): void => {
  act(() => {
    root.querySelector('.teach-once')?.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
};

function mount(seen: TeachSeen, onDismiss: (id: string) => void, extra: { dismissLabel?: string; title?: string } = {}): void {
  act(() =>
    render(
      <TeachOnce id="arena-first" title={extra.title ?? 'You hear it before you see it.'} body="Two replays; the second caps the grade at Hard. Honest, not a penalty." seen={seen} onDismiss={onDismiss} dismissLabel={extra.dismissLabel} />,
      root,
    ),
  );
}

describe('<TeachOnce>', () => {
  it('renders once with its title, body and the default dismiss label', () => {
    mount(undefined, () => {});
    const card = root.querySelector('.teach-once');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-teach-id')).toBe('arena-first');
    expect(card?.getAttribute('role')).toBe('note');
    expect(root.querySelector('.teach-once__title')?.textContent).toBe('You hear it before you see it.');
    expect(root.querySelector('.teach-once__body')?.textContent).toContain('Two replays');
    expect(root.querySelector('.teach-once__dismiss')?.textContent).toBe(S.continue);
    // English copy carries no lang="ja"
    expect(root.querySelector('.teach-once__title')?.getAttribute('lang')).toBeNull();
    // the verb rides the landmark; the clipped cartouche is the inner card and is never transformed (design 09 §6.7 rule 7)
    expect(card?.classList.contains('status-window')).toBe(false);
    const window = root.querySelector('.teach-once > .teach-once__card.status-window');
    expect(window).not.toBeNull();
    expect(window?.querySelector('.teach-once__title')).not.toBeNull();
    expect(window?.querySelector('.teach-once__dismiss')).not.toBeNull();
  });

  it('dismiss calls onDismiss with the id, and markTeachSeen writes it into progress.teachSeen once', () => {
    const dismissed: string[] = [];
    mount([], (id) => dismissed.push(id));
    expect(root.querySelector('.teach-once')?.classList.contains('ink-nijimi')).toBe(true);
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(dismissed).toEqual(['arena-first']);
    // jsdom runs no animations, so the dismissed card is gone at once (no exit to wait on)
    expect(root.querySelector('.teach-once')).toBeNull();

    const before = progress();
    const after = markTeachSeen(before, dismissed[0]!);
    expect(after.teachSeen).toEqual(['arena-first']);
    expect(after).not.toBe(before);
    expect(before.teachSeen).toBeUndefined(); // immutable
    expect(after.station).toBe(4);
    const again = markTeachSeen(after, 'arena-first');
    expect(again).toBe(after); // idempotent: same object, no duplicate
    const more = markTeachSeen(after, 'kana-morae');
    expect(more.teachSeen).toEqual(['arena-first', 'kana-morae']);
  });

  it('a seen id renders nothing (array or Set)', () => {
    mount(['arena-first'], () => {});
    expect(root.querySelector('.teach-once')).toBeNull();
    expect(root.textContent).toBe('');
    mount(new Set(['kana-morae', 'arena-first']), () => {});
    expect(root.querySelector('.teach-once')).toBeNull();
    // another id in the set does not hide this card
    mount(new Set(['kana-morae']), () => {});
    expect(root.querySelector('.teach-once')).not.toBeNull();
  });

  it('re-renders with the id now seen → the card disappears (the store round trip a surface performs)', () => {
    let p = progress();
    const onDismiss = (id: string): void => {
      p = markTeachSeen(p, id);
      mount(p.teachSeen, onDismiss);
    };
    mount(p.teachSeen, onDismiss);
    expect(root.querySelector('.teach-once')).not.toBeNull();
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(p.teachSeen).toEqual(['arena-first']);
    expect(root.querySelector('.teach-once')).toBeNull();
  });

  it('with an animation engine the card leaves the way it arrived: onDismiss at once, data-leaving until animationend, then nothing — even before the parent marks it seen', () => {
    withAnimations();
    const dismissed: string[] = [];
    mount([], (id) => dismissed.push(id));
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(dismissed).toEqual(['arena-first']);
    const card = root.querySelector('.teach-once')!;
    expect(card.hasAttribute('data-leaving')).toBe(true);
    // a second tap during the exit dismisses nothing twice
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(dismissed).toEqual(['arena-first']);
    endAnimation();
    expect(root.querySelector('.teach-once')).toBeNull();
    // the store round trip: the parent re-renders with the id seen while the exit plays, and the card still finishes it
    render(null, root);
    let p = progress();
    mount(p.teachSeen, (id) => {
      p = markTeachSeen(p, id);
      mount(p.teachSeen, () => {});
    });
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(p.teachSeen).toEqual(['arena-first']);
    expect(root.querySelector('.teach-once')?.hasAttribute('data-leaving')).toBe(true);
    endAnimation();
    expect(root.querySelector('.teach-once')).toBeNull();
  });

  it('the exit falls back to a timer (≤ 200 ms) without animationend, and is immediate under reduced motion', () => {
    withAnimations();
    vi.useFakeTimers();
    try {
      const dismissed: string[] = [];
      mount([], (id) => dismissed.push(id));
      act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
      expect(dismissed).toEqual(['arena-first']);
      expect(root.querySelector('.teach-once')?.hasAttribute('data-leaving')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(EXIT_FALLBACK_MS);
      });
      expect(root.querySelector('.teach-once')).toBeNull();
      expect(EXIT_FALLBACK_MS).toBeLessThanOrEqual(200);
    } finally {
      vi.useRealTimers();
    }
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    try {
      render(null, root);
      const dismissed: string[] = [];
      mount([], (id) => dismissed.push(id));
      act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
      expect(dismissed).toEqual(['arena-first']);
      expect(root.querySelector('.teach-once')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Japanese title / body carry lang="ja"; the dismiss label can be overridden', () => {
    mount(undefined, () => {}, { title: '雨と飴', dismissLabel: 'Got it' });
    expect(root.querySelector('.teach-once__title')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.teach-once__dismiss')?.textContent).toBe('Got it');
  });

  it('isTeachSeen handles undefined, arrays and Sets', () => {
    expect(isTeachSeen(undefined, 'x')).toBe(false);
    expect(isTeachSeen([], 'x')).toBe(false);
    expect(isTeachSeen(['x'], 'x')).toBe(true);
    expect(isTeachSeen(new Set(['y']), 'x')).toBe(false);
    expect(isTeachSeen(new Set(['x']), 'x')).toBe(true);
  });

  it('TEACH_ID_RE is the shape migrations.fillMeta keeps in progress.teachSeen: lowercase ASCII ≤ 64 chars pass; capitals, spaces, Japanese, a leading dash and 65 chars are refused', () => {
    for (const ok of ['morae-beats', 'arena-first', 'pitch-ame', 'radio.known-words', 'st7#pitch', 'speed:offer', 'a'.repeat(64)]) expect(isTeachId(ok)).toBe(true);
    for (const bad of ['Pitch', 'pitch 雨', 'pitch:雨', '-lead', '', 'a'.repeat(65)]) expect(TEACH_ID_RE.test(bad)).toBe(false);
  });

  it('a bad id throws in dev — markTeachSeen before it writes, and the component at render — so the surface’s test fails instead of the card resurfacing after every reload', () => {
    const before = progress();
    expect(() => markTeachSeen(before, 'pitch:雨')).toThrow(RangeError);
    expect(before.teachSeen).toBeUndefined();
    expect(() => act(() => render(<TeachOnce id="Pitch 雨" title="雨と飴" body="x" seen={undefined} onDismiss={() => {}} />, root))).toThrow(RangeError);
  });
});
