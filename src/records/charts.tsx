/**
 * TSUZUKU — dependency-free SVG chart primitives for Records and the Ledger
 * (group B). Deterministic for a given data array (no ids minted at random,
 * coordinates rounded to one decimal), themed only through CSS tokens, and
 * never color-alone: every mark carries a text label, a `<title>` tooltip and
 * a table view (`<details>`), and series colors are always paired with a
 * glyph in the legend.
 *
 *  Radar        five-axis polygon with an optional history overlay (dashed)
 *  HeatGrid     label + value cells, one hue light→dark, active/peak markers
 *  Sparkline    2 px line, end marker, latest value as the one direct label
 *  BarRow       horizontal bar ≤ 24 px thick, value at the tip, milestone tick
 *  StackedBars  columns of up to four kinds with 2 px surface gaps
 *  CalendarHeat 7-column grid of days, darker = more
 *  Ring         one ratio as an arc (weekly target)
 *
 * Marks follow the data-viz specs: thin marks, hairline solid grid, surface
 * gaps and rings, text in text tokens (never the series color).
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dayToCivil } from '../shared/time';
import { fill } from '../shared/ui/strings';
import { easeOut, scheduleFrame } from '../shared/ui/Ticker';
import { prefersReducedMotion } from '../shared/ui/use-reveal';
import { MONTHS, MONTHS_SHORT, S } from './strings';
import './charts.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function fmtNum(n: number): string {
  return NUM.format(Number.isFinite(n) ? n : 0);
}

/** Clamp to 0–100 (NaN → 0). */
export function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** `March 2027` for an EpochDay (calendar date of the day). */
export function monthYear(day: number): string {
  const c = dayToCivil(day);
  return `${MONTHS[c.month - 1] ?? ''} ${c.year}`;
}

/** `17 Oct` for an EpochDay. */
export function shortDate(day: number): string {
  const c = dayToCivil(day);
  return `${c.day} ${MONTHS_SHORT[c.month - 1] ?? ''}`;
}

/** `17 Oct 2026` for an EpochDay. */
export function fullDate(day: number): string {
  const c = dayToCivil(day);
  return `${c.day} ${MONTHS_SHORT[c.month - 1] ?? ''} ${c.year}`;
}

/** `10/6` style tick for a week start. */
export function tickDate(day: number): string {
  const c = dayToCivil(day);
  return `${c.month}/${c.day}`;
}

function Table(p: { caption: string; head: string[]; rows: (string | number)[][] }): JSX.Element {
  return (
    <details class="chart__table">
      <summary>{S.tableView}</summary>
      <table>
        <caption>{p.caption}</caption>
        <thead>
          <tr>
            {p.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Radar                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RadarProps {
  axes: string[];
  /** 0–100 each; clamped. */
  values: number[];
  /** Earlier vectors (oldest first); the last one is drawn dashed. */
  history?: number[][];
  /** Axis has data (false → hollow marker, muted label). */
  available?: boolean[];
  /** Legend labels; defaults to now / earlier. */
  legend?: { now: string; history: string };
  /** Row labels for the table view (defaults to `axes`). */
  tableLabels?: string[];
  /**
   * Morph the now-polygon from the last history vector on mount (design 09 §8
   * "the month"): a `RADAR_MORPH_MS` tween of the `points` attribute on the
   * shared frame scheduler (points cannot be CSS-transitioned); the polygon
   * carries `RADAR_MORPH_CLASS` while it moves. Under reduced motion both
   * polygons stand at once and no class is set.
   */
  morph?: boolean;
}

const RADAR_R = 78;
const RADAR_C = 100;
/** ≤ calc(var(--dur-4) * 2 / 3). */
export const RADAR_MORPH_MS = 600;
export const RADAR_MORPH_CLASS = 'chart__radar-now--morph';

function radarPoint(i: number, n: number, v: number, r = RADAR_R): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const k = (r * clamp100(v)) / 100;
  return [r1(RADAR_C + k * Math.cos(a)), r1(RADAR_C + k * Math.sin(a))];
}

function polygon(values: number[], n: number, r = RADAR_R): string {
  return values
    .slice(0, n)
    .map((v, i) => radarPoint(i, n, v, r).join(','))
    .join(' ');
}

export function Radar(p: RadarProps): JSX.Element {
  const n = Math.max(3, p.axes.length);
  const values = p.axes.map((_, i) => clamp100(p.values[i] ?? 0));
  const last = p.history && p.history.length > 0 ? p.history[p.history.length - 1] : undefined;
  const hist = last ? p.axes.map((_, i) => clamp100(last[i] ?? 0)) : null;
  const label = fill(S.radarLabel, { axes: p.axes.map((a, i) => `${a} ${Math.round(values[i] ?? 0)}`).join(', ') });
  const legend = p.legend ?? { now: S.chartNow, history: S.chartHistory };
  const nowRef = useRef<SVGPolygonElement>(null);
  const [morphing, setMorphing] = useState(false);
  useEffect(() => {
    const el = nowRef.current;
    if (!p.morph || !hist || !el || prefersReducedMotion()) return;
    const from = hist;
    const to = values;
    let start: number | null = null;
    setMorphing(true);
    // last month's shape before the first paint, so the real polygon never flashes ahead of its tween
    el.setAttribute('points', polygon(from, n));
    const cancel = scheduleFrame((now) => {
      if (start === null) start = now;
      const t = Number.isFinite(now) ? Math.min(1, (now - start) / RADAR_MORPH_MS) : 1;
      const k = easeOut(t);
      el.setAttribute('points', polygon(from.map((f, i) => f + ((to[i] ?? 0) - f) * k), n));
      if (t < 1) return true;
      setMorphing(false);
      return false;
    });
    return cancel;
  }, []);
  return (
    <figure class="chart chart--radar">
      <svg viewBox="0 0 200 200" role="img" aria-label={label} class="chart__svg">
        {[25, 50, 75, 100].map((ring) => (
          <polygon key={ring} class="chart__grid" points={polygon(Array(n).fill(ring), n)} />
        ))}
        {p.axes.map((_, i) => {
          const [x, y] = radarPoint(i, n, 100);
          return <line key={i} class="chart__grid" x1={RADAR_C} y1={RADAR_C} x2={x} y2={y} />;
        })}
        {hist ? <polygon class="chart__radar-history" points={polygon(hist, n)} /> : null}
        <polygon ref={nowRef} class={morphing ? `chart__radar-now ${RADAR_MORPH_CLASS}` : 'chart__radar-now'} points={polygon(values, n)} />
        {values.map((v, i) => {
          const [x, y] = radarPoint(i, n, v);
          const ok = p.available ? p.available[i] !== false : true;
          return <circle key={i} class={ok ? 'chart__dot' : 'chart__dot chart__dot--hollow'} cx={x} cy={y} r={4} />;
        })}
        {p.axes.map((a, i) => {
          const [x, y] = radarPoint(i, n, 100, RADAR_R + 14);
          const ok = p.available ? p.available[i] !== false : true;
          return (
            <text key={a + i} class={ok ? 'chart__label' : 'chart__label chart__label--muted'} x={x} y={y} text-anchor="middle" dominant-baseline="middle" lang="ja">
              {a}
            </text>
          );
        })}
      </svg>
      {hist ? (
        <ul class="chart__legend" aria-label={S.legend}>
          <li>
            <span class="chart__swatch chart__swatch--now" aria-hidden="true" /> {legend.now}
          </li>
          <li>
            <span class="chart__swatch chart__swatch--history" aria-hidden="true" /> {legend.history}
          </li>
        </ul>
      ) : null}
      <Table
        caption={S.chartAxes}
        head={hist ? [S.label, legend.now, legend.history] : [S.label, S.value]}
        rows={p.axes.map((a, i) => {
          const name = p.tableLabels?.[i] ?? a;
          const row: (string | number)[] = [name, Math.round(values[i] ?? 0)];
          if (hist) row.push(Math.round(hist[i] ?? 0));
          return row;
        })}
      />
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* HeatGrid                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface HeatRow {
  label: string;
  /** 0–100; clamped. */
  value: number;
  /** Text under the value (attempts, peak). */
  sub?: string;
  /** Marker chip text (in training / conquered). */
  marker?: string;
  active?: boolean;
  /** Accessible description of the cell. */
  title?: string;
}

export function HeatGrid(p: { rows: HeatRow[]; caption?: string }): JSX.Element {
  return (
    <figure class="chart chart--heat">
      <ul class="heat" aria-label={p.caption ?? S.heatLabel}>
        {p.rows.map((r) => {
          const v = clamp100(r.value);
          return (
            <li key={r.label} class={r.active ? 'heat__cell heat__cell--active' : 'heat__cell'} style={{ '--heat': String(r1(v) / 100) }} title={r.title}>
              <span class="heat__label">{r.label}</span>
              <span class="heat__value">{fill(S.percent, { n: Math.round(v) })}</span>
              {r.sub ? <span class="heat__sub">{r.sub}</span> : null}
              {r.marker ? <span class="heat__marker">{r.marker}</span> : null}
            </li>
          );
        })}
      </ul>
      <Table caption={p.caption ?? S.heatLabel} head={[S.label, S.value]} rows={p.rows.map((r) => [r.label, fill(S.percent, { n: Math.round(clamp100(r.value)) })])} />
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sparkline                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SparklineProps {
  values: number[];
  label: string;
  /** Row labels for the table view. */
  labels?: string[];
  width?: number;
  height?: number;
}

export function Sparkline(p: SparklineProps): JSX.Element {
  const w = p.width ?? 160;
  const h = p.height ?? 40;
  const pad = 5;
  const vals = p.values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const max = Math.max(1, ...vals);
  const n = vals.length;
  const pts = vals.map((v, i) => {
    const x = n > 1 ? pad + ((w - 2 * pad) * i) / (n - 1) : w / 2;
    const y = h - pad - ((h - 2 * pad) * v) / max;
    return [r1(x), r1(y)] as [number, number];
  });
  const lastPt = pts[pts.length - 1];
  const last = vals[vals.length - 1] ?? 0;
  const aria = fill(S.sparkLabel, { label: p.label, last: fmtNum(last), max: fmtNum(Math.max(0, ...vals)) });
  return (
    <figure class="chart chart--spark">
      <div class="chart__spark-row">
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={aria} class="chart__svg chart__svg--spark" width={w} height={h}>
          <line class="chart__grid" x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} />
          {n > 1 ? <polyline class="chart__spark-line" points={pts.map((q) => q.join(',')).join(' ')} /> : null}
          {lastPt ? <circle class="chart__dot" cx={lastPt[0]} cy={lastPt[1]} r={4} /> : null}
        </svg>
        <span class="chart__spark-value">
          <span class="chart__spark-num">{fmtNum(last)}</span>
          <span class="chart__spark-label">{p.label}</span>
        </span>
      </div>
      <Table caption={p.label} head={[S.label, S.value]} rows={vals.map((v, i) => [p.labels?.[i] ?? String(i + 1), fmtNum(v)])} />
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* BarRow                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BarRowProps {
  label: string;
  value: number;
  max: number;
  /** Display text for the value (default: the number). */
  valueText?: string;
  /** Milestone tick at this fraction of `max` (0–1). */
  marker?: number;
  markerLabel?: string;
  /** Series class suffix for the fill (default accent). */
  series?: string;
}

/** The track is a `.meter` (design 09 §5.7): `--value` scales the fill, `--target` places the milestone tick. */
export function BarRow(p: BarRowProps): JSX.Element {
  const max = p.max > 0 ? p.max : 1;
  const v = Number.isFinite(p.value) ? Math.max(0, p.value) : 0;
  const pct = r1(Math.min(100, (v / max) * 100));
  const marker = p.marker === undefined ? undefined : Math.min(1, Math.max(0, p.marker));
  const base = fill(S.barLabel, { label: p.label, value: p.valueText ?? fmtNum(v), max: fmtNum(p.max) });
  const aria = marker === undefined ? base : `${base} · ${p.markerLabel ?? S.milestone}`;
  const style: Record<string, string> = { '--value': String(pct / 100) };
  if (marker !== undefined) style['--target'] = String(marker);
  return (
    <div class="bar" role="img" aria-label={aria}>
      <span class="bar__label">{p.label}</span>
      <span class="bar__track meter" data-target={marker !== undefined ? '' : undefined} style={style}>
        <span class={`bar__fill meter__fill chart-series--${p.series ?? 'accent'}`} />
      </span>
      <span class="bar__value">{p.valueText ?? fmtNum(v)}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* StackedBars                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface StackSeries {
  label: string;
  glyph: string;
  /** Series class suffix (`chart-series--<series>`). */
  series: string;
}

export interface StackRow {
  label: string;
  /** One value per series, same order. */
  parts: number[];
  /** Tooltip / table label (default `label`). */
  title?: string;
}

export function StackedBars(p: { rows: StackRow[]; series: StackSeries[]; caption: string; unit?: string }): JSX.Element {
  const colW = 24;
  const gapX = 6;
  const plotH = 84;
  const axisH = 16;
  const pad = 4;
  const w = pad * 2 + p.rows.length * (colW + gapX) - gapX;
  const h = plotH + axisH + pad;
  const totals = p.rows.map((r) => r.parts.reduce((a, b) => a + (Number.isFinite(b) ? Math.max(0, b) : 0), 0));
  const max = Math.max(1, ...totals);
  const unit = p.unit ?? '';
  const showLabel = (i: number): boolean => i === 0 || i === p.rows.length - 1 || i % 4 === 0;
  return (
    <figure class="chart chart--stack">
      <svg viewBox={`0 0 ${Math.max(w, 1)} ${h}`} role="img" aria-label={p.caption} class="chart__svg chart__svg--stack">
        <line class="chart__grid" x1={pad} y1={pad + plotH} x2={w - pad} y2={pad + plotH} />
        {p.rows.map((row, i) => {
          const x = pad + i * (colW + gapX);
          let y = pad + plotH;
          const total = totals[i] ?? 0;
          return (
            <g key={row.label + i}>
              {row.parts.map((v, j) => {
                const val = Number.isFinite(v) ? Math.max(0, v) : 0;
                const hh = (plotH * val) / max;
                if (hh <= 0) return null;
                const seg = Math.max(0, hh - 2);
                y -= hh;
                const s = p.series[j];
                return (
                  <rect key={j} class={`chart__seg chart-series--${s?.series ?? 'accent'}`} x={x} y={r1(y + 2)} width={colW} height={r1(seg)} rx={0}>
                    <title>{`${row.title ?? row.label} · ${s?.glyph ?? ''} ${s?.label ?? ''}: ${fmtNum(val)}${unit}`}</title>
                  </rect>
                );
              })}
              {total > 0 && showLabel(i) ? (
                <text class="chart__tick" x={x + colW / 2} y={r1(y - 3)} text-anchor="middle">
                  {fmtNum(total)}
                </text>
              ) : null}
              {showLabel(i) ? (
                <text class="chart__tick" x={x + colW / 2} y={h - 3} text-anchor="middle">
                  {row.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ul class="chart__legend" aria-label={S.legend}>
        {p.series.map((s) => (
          <li key={s.series}>
            <span class={`chart__swatch chart-series--${s.series}`} aria-hidden="true" />
            <span lang="ja">{s.glyph}</span> {s.label}
          </li>
        ))}
      </ul>
      <Table caption={p.caption} head={[S.label, ...p.series.map((s) => `${s.glyph} ${s.label}`)]} rows={p.rows.map((r) => [r.title ?? r.label, ...p.series.map((_, j) => fmtNum(r.parts[j] ?? 0))])} />
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CalendarHeat                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface CalendarDay {
  /** Table and tooltip label. */
  label: string;
  value: number;
  active: boolean;
}

export function CalendarHeat(p: { days: CalendarDay[]; caption: string }): JSX.Element {
  const cell = 18;
  const gap = 3;
  const cols = 7;
  const rows = Math.max(1, Math.ceil(p.days.length / cols));
  const w = cols * (cell + gap) - gap;
  const h = rows * (cell + gap) - gap;
  const max = Math.max(1, ...p.days.map((d) => (Number.isFinite(d.value) ? d.value : 0)));
  return (
    <figure class="chart chart--calendar">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={p.caption} class="chart__svg chart__svg--calendar">
        {p.days.map((d, i) => {
          const x = (i % cols) * (cell + gap);
          const y = Math.floor(i / cols) * (cell + gap);
          const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
          const op = d.active ? r1(0.3 + (0.7 * v) / max) : 0;
          return (
            <rect key={d.label + i} class={d.active ? 'chart__day chart__day--active' : 'chart__day'} x={x} y={y} width={cell} height={cell} rx={3} style={d.active ? { fillOpacity: String(op) } : undefined}>
              <title>{d.label}</title>
            </rect>
          );
        })}
      </svg>
      <Table caption={p.caption} head={[S.label, S.value]} rows={p.days.map((d) => [d.label, fmtNum(d.value)])} />
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ring                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function Ring(p: { ratio: number; label: string; center: string; sub?: string }): JSX.Element {
  const r = 34;
  const c = 2 * Math.PI * r;
  const ratio = Number.isFinite(p.ratio) ? Math.min(1, Math.max(0, p.ratio)) : 0;
  const dash = r1(c * ratio);
  return (
    <figure class="chart chart--ring">
      <svg viewBox="0 0 88 88" role="img" aria-label={p.label} class="chart__svg chart__svg--ring">
        <circle class="ring__track" cx={44} cy={44} r={r} />
        <circle class={ratio >= 1 ? 'ring__fill ring__fill--met' : 'ring__fill'} cx={44} cy={44} r={r} stroke-dasharray={`${dash} ${r1(c)}`} transform="rotate(-90 44 44)" />
        <text class="ring__center" x={44} y={44} text-anchor="middle" dominant-baseline="middle">
          {p.center}
        </text>
      </svg>
      {p.sub ? <figcaption class="chart__caption">{p.sub}</figcaption> : null}
    </figure>
  );
}
