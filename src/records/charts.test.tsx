import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { BarRow, CalendarHeat, HeatGrid, RADAR_MORPH_CLASS, Radar, Ring, Sparkline, StackedBars, clamp100, fmtNum } from './charts';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const AXES = ['語彙', '耳', '読', '口', '場'];

describe('Radar', () => {
  it('renders a deterministic polygon for fixed data (snapshot of geometry)', () => {
    act(() => render(<Radar axes={AXES} values={[50, 100, 0, 25, 75]} />, root));
    const now = root.querySelector('polygon.chart__radar-now');
    expect(now).not.toBeNull();
    // Center 100,100 · radius 78 · axis 0 points up: 50 % → y = 100 − 39.
    expect(now?.getAttribute('points')).toBe('100,61 174.2,75.9 100,100 88.5,115.8 44.4,81.9');
    const first = root.innerHTML;
    act(() => render(null, root));
    act(() => render(<Radar axes={AXES} values={[50, 100, 0, 25, 75]} />, root));
    expect(root.innerHTML).toBe(first);
  });

  it('clamps values to 0..100 and shows the clamped numbers in the table', () => {
    act(() => render(<Radar axes={AXES} values={[-20, 250, Number.NaN, 50, 50]} />, root));
    const cells = Array.from(root.querySelectorAll('tbody td')).map((td) => td.textContent);
    expect(cells).toEqual(['0', '100', '0', '50', '50']);
    const pts = root.querySelector('polygon.chart__radar-now')?.getAttribute('points') ?? '';
    expect(pts.startsWith('100,100 ')).toBe(true); // −20 clamped to 0 sits at the center
    expect(clamp100(250)).toBe(100);
    expect(clamp100(Number.NaN)).toBe(0);
  });

  it('has an aria-label naming every axis and value, labels in lang="ja"', () => {
    act(() => render(<Radar axes={AXES} values={[10, 20, 30, 40, 50]} />, root));
    const svg = root.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toContain('語彙 10');
    expect(svg?.getAttribute('aria-label')).toContain('場 50');
    const labels = Array.from(root.querySelectorAll('text.chart__label'));
    expect(labels).toHaveLength(5);
    expect(labels.every((t) => t.getAttribute('lang') === 'ja')).toBe(true);
  });

  it('draws the last history vector dashed, with a legend and a three-column table', () => {
    act(() => render(<Radar axes={AXES} values={[60, 60, 60, 60, 60]} history={[[10, 10, 10, 10, 10], [30, 30, 30, 30, 30]]} available={[true, true, true, false, true]} />, root));
    const hist = root.querySelector('polygon.chart__radar-history');
    expect(hist).not.toBeNull();
    expect(hist?.getAttribute('points')?.startsWith('100,76.6')).toBe(true); // 30 % of 78 = 23.4
    expect(root.querySelectorAll('.chart__legend li')).toHaveLength(2);
    expect(root.querySelectorAll('thead th')).toHaveLength(3);
    expect(root.querySelectorAll('.chart__dot--hollow')).toHaveLength(1);
  });
});

describe('HeatGrid', () => {
  it('sets --heat from the clamped value and marks active rows', () => {
    act(() =>
      render(
        <HeatGrid
          rows={[
            { label: 'particle', value: 35, active: true, marker: 'in training', sub: '20 attempts' },
            { label: 'voicing', value: 140 },
            { label: 'pitch', value: -3 },
          ]}
        />,
        root,
      ),
    );
    const cells = Array.from(root.querySelectorAll('.heat__cell')) as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells[0]?.classList.contains('heat__cell--active')).toBe(true);
    expect(cells[0]?.style.getPropertyValue('--heat')).toBe('0.35');
    expect(cells[1]?.style.getPropertyValue('--heat')).toBe('1');
    expect(cells[2]?.style.getPropertyValue('--heat')).toBe('0');
    expect(cells[0]?.querySelector('.heat__marker')?.textContent).toBe('in training');
    expect(cells[1]?.querySelector('.heat__value')?.textContent).toBe('100 %');
    expect(root.querySelector('ul.heat')?.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('Sparkline', () => {
  it('scales to the max, labels the latest value and is deterministic', () => {
    act(() => render(<Sparkline values={[0, 10, 20, 40]} label="Reviews per day" />, root));
    const line = root.querySelector('polyline');
    expect(line?.getAttribute('points')).toBe('5,35 55,27.5 105,20 155,5');
    expect(root.querySelector('.chart__spark-num')?.textContent).toBe('40');
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Reviews per day: latest 40, highest 40');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('handles an empty or all-zero series without NaN coordinates', () => {
    act(() => render(<Sparkline values={[0, 0, 0]} label="Minutes" />, root));
    expect(root.innerHTML).not.toContain('NaN');
    expect(root.querySelector('polyline')?.getAttribute('points')).toBe('5,35 80,35 155,35');
    act(() => render(<Sparkline values={[]} label="Minutes" />, root));
    expect(root.innerHTML).not.toContain('NaN');
    expect(root.querySelector('polyline')).toBeNull();
  });
});

describe('BarRow', () => {
  it('is a .meter: --value scales the fill by value ÷ max (clamped), --target places the milestone tick, and the aria-label names both', () => {
    act(() => render(<BarRow label="Due" value={30} max={120} />, root));
    const track = root.querySelector('.bar__track') as HTMLElement;
    expect(track.classList.contains('meter')).toBe(true);
    expect(track.style.getPropertyValue('--value')).toBe('0.25');
    expect(track.hasAttribute('data-target')).toBe(false);
    const fill = root.querySelector('.bar__fill') as HTMLElement;
    expect(fill.classList.contains('meter__fill')).toBe(true);
    expect(fill.getAttribute('style')).toBeNull();
    expect(root.querySelector('.bar')?.getAttribute('aria-label')).toBe('Due: 30 of 120');
    act(() => render(<BarRow label="Due" value={500} max={120} valueText="500 min" marker={0.5} />, root));
    const t2 = root.querySelector('.bar__track') as HTMLElement;
    expect(t2.style.getPropertyValue('--value')).toBe('1');
    expect(t2.hasAttribute('data-target')).toBe(true);
    expect(t2.style.getPropertyValue('--target')).toBe('0.5');
    expect(root.querySelector('.bar__value')?.textContent).toBe('500 min');
    expect(root.querySelector('.bar__marker')).toBeNull();
    expect(root.querySelector('.bar')?.getAttribute('aria-label')).toBe('Due: 500 min of 120 · milestone');
  });

  it('survives max 0 and NaN', () => {
    act(() => render(<BarRow label="x" value={Number.NaN} max={0} />, root));
    expect((root.querySelector('.bar__track') as HTMLElement).style.getPropertyValue('--value')).toBe('0');
    expect(root.innerHTML).not.toContain('NaN');
  });
});

describe('Radar morph (design 09 §8 "the month")', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('without `morph` (or without history) the polygon never carries the morph class', () => {
    act(() => render(<Radar axes={AXES} values={[50, 50, 50, 50, 50]} history={[[10, 10, 10, 10, 10]]} />, root));
    expect(root.querySelector('polygon.chart__radar-now')?.classList.contains(RADAR_MORPH_CLASS)).toBe(false);
    act(() => render(null, root));
    act(() => render(<Radar axes={AXES} values={[50, 50, 50, 50, 50]} morph />, root));
    expect(root.querySelector('polygon.chart__radar-now')?.classList.contains(RADAR_MORPH_CLASS)).toBe(false);
  });

  it('with `morph` and history it tweens the points from last month on the shared frame scheduler and lands on the real polygon', () => {
    let frame: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    act(() => render(<Radar axes={AXES} values={[50, 100, 0, 25, 75]} history={[[0, 0, 0, 0, 0]]} morph />, root));
    const now = root.querySelector('polygon.chart__radar-now')!;
    expect(now.classList.contains(RADAR_MORPH_CLASS)).toBe(true);
    // last month's shape is set before any frame, so the real polygon never flashes ahead of its tween
    expect(now.getAttribute('points')).toBe('100,100 100,100 100,100 100,100 100,100');
    // the first frame still starts from last month's shape: every point at the centre
    act(() => frame!(1000));
    expect(now.getAttribute('points')).toBe('100,100 100,100 100,100 100,100 100,100');
    act(() => frame!(1300));
    const mid = now.getAttribute('points') ?? '';
    expect(mid).not.toBe('100,100 100,100 100,100 100,100 100,100');
    expect(mid).not.toBe('100,61 174.2,75.9 100,100 88.5,115.8 44.4,81.9');
    act(() => frame!(1700));
    expect(now.getAttribute('points')).toBe('100,61 174.2,75.9 100,100 88.5,115.8 44.4,81.9');
    expect(now.classList.contains(RADAR_MORPH_CLASS)).toBe(false);
  });
});

describe('charts.css (design 09 §3.1, §6.7 rule 1)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/records/charts.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('never tweens width or height (the bar track is motion.css\'s .meter) and carries no per-file reduced-motion block', () => {
    expect(css).not.toMatch(/transition:[^;]*\b(width|height)\b/);
    expect(css).not.toMatch(/\.bar__track\s*\{/);
    expect(css).not.toMatch(/\.bar__fill\s*\{/);
    expect(css).not.toMatch(/prefers-reduced-motion|\.reduced-motion/);
  });

  it('sets every chart type size as a scale token, none below --fs-1 (12 / 9 px lifted)', () => {
    const sizes = Array.from(css.matchAll(/font-size:\s*([^;]+);/g), (m) => m[1]!.trim());
    expect(sizes.length).toBeGreaterThan(5);
    for (const v of sizes) expect(v).toMatch(/^var\(--fs-[1-8]\)$/);
    expect(css).not.toMatch(/font-size:\s*\d+px/);
  });
});

describe('StackedBars', () => {
  const series = [
    { label: 'listening', glyph: '耳', series: 'listen' },
    { label: 'reading', glyph: '読', series: 'read' },
  ];
  it('stacks segments with a 2 px surface gap and lists every series in the legend and table', () => {
    act(() =>
      render(
        <StackedBars
          caption="Minutes per week"
          rows={[
            { label: '10/6', parts: [60, 30] },
            { label: '10/13', parts: [0, 90] },
          ]}
          series={series}
          unit=" min"
        />,
        root,
      ),
    );
    const segs = Array.from(root.querySelectorAll('rect.chart__seg'));
    expect(segs).toHaveLength(3); // the zero segment is skipped
    const heights = segs.map((s) => Number(s.getAttribute('height')));
    // max total 90 → plot 84 px: 60 → 56 − 2 gap = 54, 30 → 28 − 2 = 26, 90 → 84 − 2 = 82
    expect(heights).toEqual([54, 26, 82]);
    expect(segs[0]?.classList.contains('chart-series--listen')).toBe(true);
    expect(segs[0]?.querySelector('title')?.textContent).toBe('10/6 · 耳 listening: 60 min');
    expect(root.querySelectorAll('.chart__legend li')).toHaveLength(2);
    expect(root.querySelectorAll('thead th')).toHaveLength(3);
    expect(root.innerHTML).not.toContain('NaN');
  });
});

describe('CalendarHeat', () => {
  it('lays days out in 7 columns, idle days without opacity, active days darker with more', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ label: `day ${i}`, value: i % 2 ? i * 5 : 0, active: i % 2 === 1 }));
    act(() => render(<CalendarHeat days={days} caption="Days trained" />, root));
    const rects = Array.from(root.querySelectorAll('rect.chart__day')) as unknown as SVGRectElement[];
    expect(rects).toHaveLength(14);
    expect(rects[7]?.getAttribute('x')).toBe('0');
    expect(rects[7]?.getAttribute('y')).toBe('21');
    expect(rects[0]?.classList.contains('chart__day--active')).toBe(false);
    expect(rects[13]?.classList.contains('chart__day--active')).toBe(true);
    expect((rects[13] as unknown as HTMLElement).style.fillOpacity).toBe('1');
    expect(Number((rects[1] as unknown as HTMLElement).style.fillOpacity)).toBeLessThan(1);
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Days trained');
  });
});

describe('Ring', () => {
  it('draws the ratio as a dash and clamps to the full circle', () => {
    act(() => render(<Ring ratio={0.5} label="half" center="50 %" />, root));
    const fill = root.querySelector('.ring__fill');
    const dash = fill?.getAttribute('stroke-dasharray') ?? '';
    const [a, b] = dash.split(' ').map(Number);
    expect(a).toBeCloseTo((b ?? 0) / 2, 0);
    act(() => render(<Ring ratio={3} label="over" center="100 %" />, root));
    const over = root.querySelector('.ring__fill');
    expect(over?.classList.contains('ring__fill--met')).toBe(true);
    const [c, d] = (over?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
    expect(c).toBe(d);
  });
});

describe('fmtNum', () => {
  it('formats with en-US grouping and one decimal at most', () => {
    expect(fmtNum(1234.56)).toBe('1,234.6');
    expect(fmtNum(Number.NaN)).toBe('0');
  });
});
