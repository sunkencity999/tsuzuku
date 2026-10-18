import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { FlameState } from '@/store/derived';
import { REPAIR_NEEDED as STORE_REPAIR_NEEDED, REPAIR_WINDOW_DAYS as STORE_REPAIR_WINDOW_DAYS } from '@/store/streak';
import { HEADER_TONGUE, Lantern, REPAIR_NEEDED, REPAIR_WINDOW_DAYS, TONGUE_PATH, lanternChips, repairOpen, tonguePath, type StreakForgiveness } from './Lantern';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const STATES: FlameState[] = ['lit', 'gold', 'ember', 'frozen', 'rest', 'broken'];
const streak: StreakForgiveness = { freezes: 0, restDaysTaken: 0, weekly: 0 };

describe('the tongue (design 09 §5.10)', () => {
  it('is a self-contained six-node path: move, two quadratic curves, close — in a 20 × 20 box', () => {
    const d = tonguePath();
    expect(d).toBe(TONGUE_PATH);
    const commands = d.match(/[MQZ]/g) ?? [];
    expect(commands).toEqual(['M', 'Q', 'Q', 'Z']);
    // nodes: the move point + two (control, end) pairs = 5 coordinates, + Z = 6 nodes at most
    const points = d.match(/-?\d+(\.\d+)? -?\d+(\.\d+)?/g) ?? [];
    expect(points.length).toBe(5);
    expect(points.length + 1).toBeLessThanOrEqual(6);
    for (const n of d.match(/-?\d+(\.\d+)?/g)!.map(Number)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(20);
    }
    // the same construction as flames.ts tongue(): base corners, a tip leaning right
    const { cx, base, height, width, lean } = HEADER_TONGUE;
    expect(d.startsWith(`M${cx - width / 2} ${base}`)).toBe(true);
    expect(d).toContain(` ${cx + lean} ${base - height} `);
  });
});

describe('<Lantern>', () => {
  it('renders the drawn flame, aria-hidden, with the visible English word and a hidden detail for every state', () => {
    for (const state of STATES) {
      act(() => render(<Lantern state={state} label={`word-${state}`} detail={`detail-${state}`} title="Tsuzuku Flame" />, root));
      const el = root.querySelector('.lantern')!;
      expect(el.getAttribute('data-state')).toBe(state);
      // motion.css colours `.lantern__tongue` through `--lantern-tone`; the svg is a direct child so its ::before glow twin aligns
      const svg = el.querySelector(':scope > svg.lantern__tongue')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
      expect(svg.getAttribute('width')).toBe('20');
      expect(svg.querySelector('path')?.getAttribute('d')).toBe(TONGUE_PATH);
      expect(svg.querySelector('path')?.getAttribute('fill')).toBe('currentColor');
      expect(el.querySelector('.lantern__word')?.textContent).toBe(`word-${state}`);
      expect(el.textContent).toContain(`detail-${state}`);
      expect(el.textContent).toContain('Tsuzuku Flame');
      // no Japanese glyph for a zero-Japanese learner: the tongue is drawn, the word is English
      expect(el.textContent).not.toMatch(/[一-鿿]/);
      // static: nothing in the markup animates (no <animate>, no inline animation)
      expect(el.querySelector('animate, animateTransform')).toBeNull();
    }
  });

  it('unlit (day one) is its own state — the tongue stays grey — with the caller’s "Unlit" copy, never "out"', () => {
    act(() => render(<Lantern state="unlit" label="Unlit" detail="Unlit. Your first session lights it." />, root));
    const el = root.querySelector('.lantern')!;
    expect(el.getAttribute('data-state')).toBe('unlit');
    expect(el.querySelector('.lantern__word')?.textContent).toBe('Unlit');
    expect(el.textContent).toContain('Unlit. Your first session lights it.');
    expect(el.textContent).not.toMatch(/out/i);
  });

  it('a label equal to the detail is not read twice; size scales the box inline (motion.css fixes 20 px, so the attribute alone would lose)', () => {
    act(() => render(<Lantern state="lit" label="Lit." detail="Lit." size={32} />, root));
    expect(root.querySelector('.lantern')?.textContent).toBe('Lit.');
    const svg = root.querySelector<SVGElement>('svg')!;
    expect(svg.getAttribute('height')).toBe('32');
    expect(svg.style.width).toBe('32px');
    expect(svg.style.height).toBe('32px');
    act(() => render(<Lantern state="lit" label="Lit." />, root));
    expect(root.querySelector<SVGElement>('svg')?.style.width).toBe(''); // the default rides motion.css's 20 px
  });

  it("reports the glow twin's animationend to the caller, so the host can drop .ink-tomosu", () => {
    const onEnd = vi.fn();
    act(() => render(<Lantern state="lit" label="Lit" class="ink-tomosu" onAnimationEnd={onEnd} />, root));
    const el = root.querySelector('.lantern')!;
    act(() => {
      el.dispatchEvent(new Event('animationend'));
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('lanternChips / repairOpen', () => {
  it('mirrors the streak machine\'s constants exactly (store/streak.ts is not contract tier, so they are copied here)', () => {
    expect(REPAIR_WINDOW_DAYS).toBe(STORE_REPAIR_WINDOW_DAYS);
    expect(REPAIR_NEEDED).toBe(STORE_REPAIR_NEEDED);
  });

  it('renders what exists and is invisible today: freezes, rest, weekly flames', () => {
    expect(lanternChips({ streak, today: 100 })).toEqual([]);
    expect(lanternChips({ streak: { ...streak, freezes: 2 }, today: 100 })).toEqual([{ kind: 'freeze', n: 2 }]);
    expect(lanternChips({ streak: { ...streak, restDaysTaken: 3 }, today: 100 })).toEqual([{ kind: 'rest', n: 3, set: false }]);
    expect(lanternChips({ streak, today: 100, restDay: 0 })).toEqual([{ kind: 'rest', n: 0, set: true }]);
    expect(lanternChips({ streak: { ...streak, weekly: 4 }, today: 100 })).toEqual([{ kind: 'weekly', n: 4 }]);
  });

  it('the repair chip carries the kintsugi seam only while the five-day window is open', () => {
    const open = { ...streak, repairWindow: { start: 100, done: 1 } };
    expect(repairOpen(open, 100)).toBe(true);
    expect(repairOpen(open, 100 + REPAIR_WINDOW_DAYS - 1)).toBe(true);
    expect(repairOpen(open, 100 + REPAIR_WINDOW_DAYS)).toBe(false);
    expect(repairOpen(open, 99)).toBe(false);
    expect(repairOpen(streak, 100)).toBe(false);
    expect(lanternChips({ streak: open, today: 102 })).toEqual([{ kind: 'repair', n: 1, kintsugi: true }]);
    // closed: a repaired flame is indistinguishable from one that never dimmed
    expect(lanternChips({ streak: open, today: 110 })).toEqual([]);
  });

  it('orders the chips freeze · rest · weekly · repair', () => {
    const all = { freezes: 1, restDaysTaken: 2, weekly: 3, repairWindow: { start: 10, done: 0 } };
    expect(lanternChips({ streak: all, today: 12, restDay: 6 }).map((c) => c.kind)).toEqual(['freeze', 'rest', 'weekly', 'repair']);
  });
});
