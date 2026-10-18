/**
 * Hud.tsx — progress only in Zen, honest backlog copy, no ki/combo markup.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import type { SessionPlan, Step } from '../shared/session-types';
import { Hud, blockIndexOf, blockProgress, glide, reviewSteps } from './Hud';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(id: string, block: Step['block'], cardKey: CardKey | null = `v-n5-0001#rec`): Step {
  return { id, block, exercise: 'meaning-recall', itemId: cardKey ? cardKey.split('#')[0]! : null, cardKey, params: {}, timed: false, isNew: false, stepTag: null, exposures: 3, estMs: 6000 };
}

function plan(o: { backlog?: boolean; dueTotal?: number; dueTaken?: number } = {}): SessionPlan {
  const warm = [step('w0', 'warmup'), step('w1', 'warmup'), step('w2', 'warmup')];
  const reviews = [step('r0', 'reviews'), step('r1', 'reviews'), step('m', 'michikusa', null), step('r2', 'reviews'), step('r3', 'reviews')];
  const cool = [step('c0', 'cooldown'), step('c1', 'cooldown')];
  return {
    id: 'kata-test',
    mode: 'kata',
    day: 1,
    createdAt: 0,
    station: 4,
    steps: [...warm, ...reviews, ...cool],
    blocks: [
      { kind: 'warmup', label: 'Warm-up', estMinutes: 1, stepIds: warm.map((s) => s.id) },
      { kind: 'reviews', label: 'Reviews', estMinutes: 2, stepIds: reviews.map((s) => s.id) },
      { kind: 'cooldown', label: 'Cooldown', estMinutes: 0.5, stepIds: cool.map((s) => s.id) },
    ],
    meta: { dueTotal: o.dueTotal ?? 9, dueTaken: o.dueTaken ?? 9, backlog: o.backlog ?? false, newCount: 0, scrollIds: [] },
  };
}

function mount(p: Parameters<typeof Hud>[0]): void {
  act(() => render(<Hud {...p} />, root));
}

describe('<Hud>', () => {
  it('dojo feel: progress, block chips, the current block line and the Forge Bar', () => {
    const pl = plan();
    mount({ plan: pl, index: 4, feel: 'dojo', backlog: false });
    const bar = root.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(root.querySelectorAll('.hud__block')).toHaveLength(3);
    expect(root.querySelector('.hud__block[data-state="done"]')?.textContent).toContain('Warm-up');
    expect(root.querySelector('.hud__block[data-state="current"]')?.textContent).toContain('Reviews');
    expect(root.querySelector('.hud__current')?.textContent).toBe('Reviews · 2 of 5');
    const forge = root.querySelector('.hud__forge')!;
    expect(forge.getAttribute('role')).toBe('meter');
    // 9 review steps (the Michikusa card is not a review); 4 answered → 5 left.
    expect(forge.getAttribute('aria-valuenow')).toBe('5');
    expect(forge.getAttribute('aria-valuemax')).toBe('9');
    expect(forge.querySelector('.forge-bar__label')?.textContent).toBe('百錬');
    // the Forge Bar is a .meter (design 09 §5.7): --value scales the fill, width never tweens
    const track = forge.querySelector('.meter.forge-bar') as HTMLElement;
    expect(track.style.getPropertyValue('--value')).toBe('0.56');
    expect(track.querySelector('.meter__fill')).not.toBeNull();
    expect(forge.querySelector('[style*="width"]')).toBeNull();
    // and so is the progress bar (4 of 10)
    expect(bar.classList.contains('meter')).toBe(true);
    expect((bar as HTMLElement).style.getPropertyValue('--value')).toBe('0.4');
    expect(bar.querySelector('.meter__fill')).not.toBeNull();
  });

  it('the current block alone carries the vermilion .hud__dot (the FLIP glider); done / ahead keep their pseudo dots', () => {
    mount({ plan: plan(), index: 4, feel: 'dojo', backlog: false });
    expect(root.querySelectorAll('.hud__dot')).toHaveLength(1);
    expect(root.querySelector('.hud__block[data-state="current"] .hud__dot')).not.toBeNull();
    expect(root.querySelector('.hud__dot')?.getAttribute('aria-hidden')).toBe('true');
    // the block moves on: the dot follows into the new current block
    mount({ plan: plan(), index: 8, feel: 'dojo', backlog: false });
    expect(root.querySelector('.hud__block[data-state="current"]')?.textContent).toContain('Cooldown');
    expect(root.querySelector('.hud__block[data-state="current"] .hud__dot')).not.toBeNull();
    expect(root.querySelectorAll('.hud__dot')).toHaveLength(1);
  });

  it('the Forge Bar label carries its English beside 百錬 (the zero-Japanese rule)', () => {
    mount({ plan: plan(), index: 4, feel: 'dojo', backlog: false });
    expect(root.querySelector('.hud__forge .forge-bar__label')?.textContent).toBe('百錬');
    expect(root.querySelector('.hud__forge .eyebrow')?.textContent).toBe('reviews');
  });

  it('the dot\'s FLIP measures relative to the Hud: a page that scrolled between two commits is not read as movement', () => {
    const origin = Element.prototype.getBoundingClientRect;
    let scroll = 0;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      // every box rides the same scroll offset; the dot sits 40 px into the Hud
      const x = this.classList.contains('hud__dot') ? 40 : 0;
      return { left: x, top: -scroll, right: x + 6, bottom: -scroll + 6, width: 6, height: 6, x, y: -scroll, toJSON: () => ({}) } as DOMRect;
    };
    try {
      mount({ plan: plan(), index: 4, feel: 'dojo', backlog: false });
      scroll = 120;
      mount({ plan: plan(), index: 8, feel: 'dojo', backlog: false });
      expect(root.querySelector('.hud__block[data-state="current"]')?.textContent).toContain('Cooldown');
      expect((root.querySelector('.hud__dot') as HTMLElement).style.transition).toBe('');
    } finally {
      Element.prototype.getBoundingClientRect = origin;
    }
  });

  it('glide: FLIP\'s last two letters — the inverse translate, then a transform-only transition to rest; a zero delta is a no-op', () => {
    const el = document.createElement('span');
    expect(glide(el, 0, 0)).toBe(false);
    expect(el.style.transition).toBe('');
    expect(glide(el, -42, 3)).toBe(true);
    expect(el.style.transform).toBe('');
    expect(el.style.transition).toBe('transform var(--dur-2) var(--ease)');
    el.dispatchEvent(new Event('transitionend'));
    expect(el.style.transition).toBe('');
  });

  it('zen hides everything but progress', () => {
    mount({ plan: plan(), index: 2, feel: 'zen', backlog: false });
    expect(root.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(root.querySelector('.forge-bar')).toBeNull();
    expect(root.querySelector('.hud__blocks')).toBeNull();
    expect(root.querySelector('.hud__current')).toBeNull();
    expect(root.querySelector('.hud__backlog')).toBeNull();
  });

  it('zen + backlog still shows no backlog line (progress only)', () => {
    mount({ plan: plan({ backlog: true, dueTotal: 310, dueTaken: 120 }), index: 0, feel: 'zen', backlog: true });
    expect(root.querySelector('.hud__backlog')).toBeNull();
    expect(root.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('backlog replaces the Forge Bar with the honest count copy', () => {
    mount({ plan: plan({ backlog: true, dueTotal: 310, dueTaken: 120 }), index: 0, feel: 'dojo', backlog: true });
    expect(root.querySelector('.forge-bar')).toBeNull();
    const line = root.querySelector('.hud__backlog')!;
    expect(line.textContent).toBe('The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty.');
  });

  it('never renders ki or combo markup (the frame owns them)', () => {
    for (const feel of ['zen', 'dojo', 'arcade'] as const) {
      mount({ plan: plan(), index: 3, feel, backlog: false });
      expect(root.querySelector('.combo')).toBeNull();
      expect(root.querySelector('.ki-bar')).toBeNull();
      expect(root.querySelector('[data-tier]')).toBeNull();
      expect(root.textContent).not.toMatch(/combo|気/);
    }
  });

  it('a re-queued step inherits the block of its source; the cursor clamps at the end', () => {
    const pl = plan();
    const requeue: Step = { ...step('r1~+3', 'reviews'), stepTag: '+3' };
    const live = { ...pl, steps: [...pl.steps.slice(0, 6), requeue, ...pl.steps.slice(6)] };
    expect(blockIndexOf(live, requeue)).toBe(1);
    const progress = blockProgress(live, 6);
    expect(progress[1]!.total).toBe(6);
    expect(progress[1]!.state).toBe('current');
    mount({ plan: live, index: 99, feel: 'dojo', backlog: false });
    expect(root.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('11');
    expect(root.querySelector('.hud__forge')!.getAttribute('aria-valuetext')).toBe('All reviews done');
    expect((root.querySelector('.meter.forge-bar') as HTMLElement).style.getPropertyValue('--value')).toBe('0');
  });

  it('reviewSteps excludes cardless steps', () => {
    expect(reviewSteps(plan().steps)).toHaveLength(9);
  });

  it('single-block plans show no block chips', () => {
    const pl = plan();
    const single = { ...pl, blocks: [pl.blocks[1]!] };
    mount({ plan: single, index: 0, feel: 'dojo', backlog: false });
    expect(root.querySelector('.hud__blocks')).toBeNull();
  });
});
