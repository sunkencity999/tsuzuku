import { fnv1a32 } from '../../shared/hash';
import { svgDoc } from '../svg';
import {
  BLOOM_DAYS,
  DEPTH_MAX,
  DEPTH_MIN,
  MAX_BRANCHES,
  MAX_PADS,
  MIN_PADS,
  NEEDLE,
  bonsaiSvg,
  branchWidth,
  depthFor,
  growBonsai,
  sizeFor,
  type BonsaiOptions,
} from './bonsai';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svgDoc({ w: 400, h: 300, body: [svg] }), 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const BASE: BonsaiOptions = { totalDays: 120, blooming: true, seed: 42, x: 200, y: 280, scale: 1 };

describe('depthFor', () => {
  it('is 3 at day 1 and 8 at day 365, clamped beyond', () => {
    expect(depthFor(1)).toBe(DEPTH_MIN);
    expect(depthFor(365)).toBe(DEPTH_MAX);
    expect(depthFor(0)).toBe(3);
    expect(depthFor(-10)).toBe(3);
    expect(depthFor(10_000)).toBe(8);
    expect(depthFor(Number.NaN)).toBe(3);
  });

  it('is monotone over 1..1000 and hits every depth on a log scale', () => {
    let prev = 0;
    const seen = new Set<number>();
    for (let d = 1; d <= 1000; d++) {
      const k = depthFor(d);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
      seen.add(k);
    }
    expect(Array.from(seen).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8]);
    // log scale: the halfway depth comes long before day 182
    expect(depthFor(19)).toBeGreaterThanOrEqual(5);
    expect(sizeFor(1)).toBeCloseTo(0.78);
    expect(sizeFor(365)).toBeCloseTo(1);
    expect(sizeFor(2000)).toBeCloseTo(1);
  });
});

describe('growBonsai', () => {
  it('is deterministic and varies with the seed', () => {
    const a = growBonsai(BASE);
    const b = growBonsai(BASE);
    expect(a).toEqual(b);
    const c = growBonsai({ ...BASE, seed: 7 });
    expect(c.branches.length === a.branches.length && c.branches[1]?.b[0] === a.branches[1]?.b[0]).toBe(false);
  });

  it('grows monotonically with days: branches, pads and reach never shrink', () => {
    let prevBranches = 0;
    let prevReach = 0;
    for (const days of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 365, 400, 900]) {
      const m = growBonsai({ ...BASE, totalDays: days, blooming: false });
      expect(m.branches.length).toBeGreaterThanOrEqual(prevBranches);
      const reach = Math.max(...m.branches.map((b) => -b.b[1]));
      expect(reach).toBeGreaterThanOrEqual(prevReach - 1e-9);
      prevBranches = m.branches.length;
      prevReach = reach;
      expect(m.branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
    }
  });

  it('the tree at depth d is a prefix of the tree at depth d+1', () => {
    const small = growBonsai({ ...BASE, totalDays: 10, blooming: false });
    const big = growBonsai({ ...BASE, totalDays: 365, blooming: false });
    expect(big.depth).toBeGreaterThan(small.depth);
    // structure (levels, angles) is shared; only the size factor stretches the older tree
    for (let i = 0; i < small.branches.length; i++) {
      expect(big.branches[i]!.level).toBe(small.branches[i]!.level);
      expect(big.branches[i]!.angle).toBeCloseTo(small.branches[i]!.angle, 9);
      expect(big.branches[i]!.len).toBeGreaterThanOrEqual(small.branches[i]!.len);
    }
  });

  it('branches grow upward from the soil and never below the horizontal', () => {
    const m = growBonsai({ ...BASE, totalDays: 365 });
    expect(m.branches[0]!.a).toEqual([0, 0]);
    for (const b of m.branches) {
      expect(b.angle).toBeLessThanOrEqual(-8);
      expect(b.angle).toBeGreaterThanOrEqual(-172);
      expect(b.b[1]).toBeLessThan(b.a[1] + 1e-9);
    }
  });

  it('pads: between MIN and MAX, pruned is sparser but never bare, streak thickens', () => {
    const full = growBonsai({ ...BASE, totalDays: 365, pruned: false });
    const pruned = growBonsai({ ...BASE, totalDays: 365, pruned: true });
    expect(full.pads.length).toBeLessThanOrEqual(MAX_PADS);
    expect(pruned.pads.length).toBeGreaterThanOrEqual(MIN_PADS);
    expect(pruned.pads.length).toBeLessThan(full.pads.length);
    expect(pruned.pruned).toBe(true);
    const day1 = growBonsai({ ...BASE, totalDays: 1, pruned: true });
    expect(day1.pads.length).toBeGreaterThanOrEqual(MIN_PADS);
    const streaky = growBonsai({ ...BASE, totalDays: 60, streak: 45 });
    const plain = growBonsai({ ...BASE, totalDays: 60, streak: 0 });
    expect(streaky.pads.length).toBeGreaterThanOrEqual(plain.pads.length);
  });

  it('healing (design 09 §8): a pruned tree grows its pads back 40 → 100 % over the week, and a healed pruned tree equals the full one', () => {
    const full = growBonsai({ ...BASE, totalDays: 365, pruned: false });
    const h0 = growBonsai({ ...BASE, totalDays: 365, pruned: true, healing: 0 });
    const h5 = growBonsai({ ...BASE, totalDays: 365, pruned: true, healing: 0.5 });
    const h1 = growBonsai({ ...BASE, totalDays: 365, pruned: true, healing: 1 });
    expect(h0.healing).toBe(0);
    expect(h5.healing).toBe(0.5);
    expect(h1.healing).toBe(1);
    expect(full.healing).toBe(1);
    expect(h0.pads.length).toBeLessThan(h5.pads.length);
    expect(h5.pads.length).toBeLessThanOrEqual(h1.pads.length);
    expect(h1.pads.length).toBe(full.pads.length);
    expect(h1.pads[0]!.rx).toBeCloseTo(full.pads[0]!.rx);
    expect(h0.pads[0]!.rx).toBeLessThan(full.pads[0]!.rx);
    // the default for a pruned tree is unhealed; out-of-range values clamp
    expect(growBonsai({ ...BASE, pruned: true }).healing).toBe(0);
    expect(growBonsai({ ...BASE, pruned: true, healing: 7 }).healing).toBe(1);
    expect(growBonsai({ ...BASE, pruned: true, healing: Number.NaN }).healing).toBe(0);
    const d = parse(bonsaiSvg({ ...BASE, pruned: true, healing: 0.5, id: 'dj-p-bonsai' }));
    expect(d.querySelector('.bonsai')?.getAttribute('data-healing')).toBe('0.5');
    expect(d.querySelector('.bonsai')?.getAttribute('id')).toBe('dj-p-bonsai');
    expect(parse(bonsaiSvg(BASE)).querySelector('.bonsai')?.getAttribute('data-healing')).toBeNull();
  });

  it('blooming adds sakura nodes; otherwise none', () => {
    expect(growBonsai({ ...BASE, blooming: true }).blooms.length).toBeGreaterThan(0);
    expect(growBonsai({ ...BASE, blooming: false }).blooms.length).toBe(0);
    expect(BLOOM_DAYS).toBe(100);
  });
});

describe('bonsaiSvg', () => {
  it('renders a positioned group with one branch path per level, pads and blooms', () => {
    const svg = bonsaiSvg(BASE);
    const d = parse(svg);
    const root = d.querySelector('.bonsai')!;
    expect(root).not.toBeNull();
    expect(root.getAttribute('transform')).toBe('translate(200 280) scale(1)');
    const m = growBonsai(BASE);
    expect(d.querySelectorAll('.bonsai__branch').length).toBe(m.depth);
    expect(d.querySelectorAll('.bonsai__pad').length).toBe(m.pads.length);
    expect(d.querySelectorAll('.bonsai__bloom').length).toBe(m.blooms.length);
    expect(d.querySelectorAll('.bonsai__bloom').length).toBeGreaterThan(0);
    expect(root.classList.contains('bonsai--blooming')).toBe(true);
    expect(root.getAttribute('data-depth')).toBe(String(m.depth));
    expect(d.querySelector('.bonsai__pot')).not.toBeNull();
    expect(svg).not.toContain('NaN');
  });

  it('without blooming there are no sakura nodes', () => {
    const d = parse(bonsaiSvg({ ...BASE, blooming: false }));
    expect(d.querySelectorAll('.bonsai__bloom').length).toBe(0);
    expect(d.querySelector('.bonsai')?.classList.contains('bonsai--blooming')).toBe(false);
  });

  it('is a deterministic snapshot', () => {
    const a = bonsaiSvg(BASE);
    expect(a).toBe(bonsaiSvg(BASE));
    expect(fnv1a32(a).toString(16)).toMatchInlineSnapshot(`"49b1f05e"`);
  });

  it('seasons tint the needles; winter adds snow caps', () => {
    const spring = bonsaiSvg({ ...BASE, season: 'spring' });
    const autumn = bonsaiSvg({ ...BASE, season: 'autumn' });
    expect(spring).not.toBe(autumn);
    expect(spring).toContain(NEEDLE.spring);
    expect(autumn).toContain(NEEDLE.autumn);
    const winter = parse(bonsaiSvg({ ...BASE, season: 'winter' }));
    expect(winter.querySelectorAll('.bonsai__snow').length).toBeGreaterThan(0);
    expect(winter.querySelectorAll('.bonsai__snow').length).toBeLessThanOrEqual(8);
    expect(parse(spring).querySelectorAll('.bonsai__snow').length).toBe(0);
  });

  it('branch widths taper by level and stay above the floor', () => {
    expect(branchWidth(0, 1)).toBeCloseTo(10);
    expect(branchWidth(1, 1)).toBeLessThan(branchWidth(0, 1));
    expect(branchWidth(20, 0.5)).toBe(0.8);
  });

  it('keeps the node budget (≤ 100 elements at a year, blooming, winter)', () => {
    const d = parse(bonsaiSvg({ ...BASE, totalDays: 365, blooming: true, season: 'winter', streak: 200 }));
    expect(d.querySelectorAll('.bonsai *').length).toBeLessThanOrEqual(100);
  });
});
