/**
 * TSUZUKU — `<PitchLine>` / `<PitchGlyph>`: pitch-accent drawn as shape
 * (design 04 §2, 01 §7 "pitch lines drawn as shape, not color only").
 *
 * The nucleus `pitch` is the mora after which the pitch drops: 0 = 平板
 * heiban (no drop), 1 = 頭高 atamadaka, 2..n−1 = 中高 nakadaka, n = 尾高
 * odaka (drop onto the particle). Standard Tokyo rules: the first mora is
 * low unless the nucleus is 1; morae 2..nucleus are high; everything after
 * the nucleus, particle included, is low; without a nucleus the particle
 * stays high — which is how 平板 and 尾高 differ, so the particle slot is
 * always drawn. High morae are filled dots on the upper line, low morae
 * hollow dots on the lower line, the drop a vertical bar with an arrowhead
 * between the nucleus and the next mora. Kana labels sit under the dots.
 *
 * Input mode (`onPick`): the learner taps the mora where the pitch drops,
 * or 「no drop」; digits 1..n pick a mora and n+1 picks 平板 through the
 * enclosing `<ExerciseFrame>`. The true contour is hidden until `revealed`.
 * The contour polyline hiku-draws when it mounts (`.ink-hiku[data-axis="stroke"]`,
 * stroke-dashoffset over --dur-3; shown complete under reduced motion).
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { moraSplit } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { PITCH_TYPE_LABEL, S, fill, type PitchType } from './strings';
import './PitchLine.css';

export type { PitchType };
export const PITCH_TYPES: readonly PitchType[] = ['heiban', 'atamadaka', 'nakadaka', 'odaka'];

export interface PitchContour {
  /** High (true) or low per mora. */
  high: boolean[];
  /** The following particle (が) is high — only in 平板. */
  particleHigh: boolean;
  /** Mora index (1-based) after which the pitch drops, or `null`. */
  drop: number | null;
}

function clampNucleus(pitch: number, n: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(0, Math.min(n, Math.round(pitch)));
}

/** Contour for `n` morae and nucleus `pitch` (see the module header). */
export function pitchContour(n: number, pitch: number): PitchContour {
  const count = Math.max(1, Math.floor(n));
  const p = clampNucleus(pitch, count);
  const high: boolean[] = [];
  for (let i = 1; i <= count; i++) {
    if (p === 0) high.push(i > 1);
    else if (p === 1) high.push(i === 1);
    else high.push(i > 1 && i <= p);
  }
  return { high, particleHigh: p === 0, drop: p === 0 ? null : p };
}

/** Pitch type by mora count. */
export function pitchTypeFor(n: number, pitch: number): PitchType {
  const count = Math.max(1, Math.floor(n));
  const p = clampNucleus(pitch, count);
  if (p === 0) return 'heiban';
  if (p === 1) return 'atamadaka';
  if (p >= count) return 'odaka';
  return 'nakadaka';
}

/** 雨 1 → atamadaka · 飴 0 → heiban · 男 3 of 4 → nakadaka · 花 2 of 2 → odaka. */
export function pitchType(kana: string, pitch: number): PitchType {
  return pitchTypeFor(moraSplit(kana).length, pitch);
}

/** Representative nucleus for each type over a four-mora schematic (the glyphs). */
export const GLYPH_NUCLEUS: Record<PitchType, number> = { heiban: 0, atamadaka: 1, nakadaka: 3, odaka: 4 };

/* ── drawing ─────────────────────────────────────────────────────────────── */

const STEP = 28;
const R = 4;
const Y_HIGH = 9;
const Y_LOW = 25;
const Y_MID = 17;
const Y_LABEL = 41;
const HEIGHT = 46;

function xOf(i: number): number {
  return STEP / 2 + STEP * i;
}

interface ContourSvgProps {
  contour: PitchContour;
  /** Kana per mora; omitted for glyphs. */
  labels?: string[];
  /** Neutral: dots only at mid height (input mode before the reveal). */
  neutral?: boolean;
  ariaLabel: string;
  compact?: boolean;
}

function ContourSvg(p: ContourSvgProps): JSX.Element {
  const { high, particleHigh, drop } = p.contour;
  const n = high.length;
  const width = STEP * (n + 1);
  const y = (h: boolean): number => (p.neutral ? Y_MID : h ? Y_HIGH : Y_LOW);
  const points = high.map((h, i) => `${xOf(i)},${y(h)}`).join(' ');
  const lastX = xOf(n - 1);
  const partX = xOf(n);
  const dropX = drop !== null && drop >= 1 ? xOf(drop - 1) + STEP / 2 : null;
  return (
    <svg
      class={p.compact ? 'pitch-svg pitch-svg--compact' : 'pitch-svg'}
      viewBox={`0 0 ${width} ${p.labels ? HEIGHT : Y_LOW + R + 4}`}
      role="img"
      aria-label={p.ariaLabel}
      data-morae={n}
      data-drop={drop ?? 'none'}
      data-neutral={p.neutral ? 'true' : undefined}
    >
      {!p.neutral ? <polyline class="pitch-svg__line ink-hiku" data-axis="stroke" pathLength={1} points={points} fill="none" /> : null}
      {!p.neutral ? (
        <line class="pitch-svg__particle-line" x1={lastX} y1={y(high[n - 1] ?? false)} x2={partX} y2={y(particleHigh)} />
      ) : null}
      {high.map((h, i) => (
        <circle
          key={i}
          class={p.neutral ? 'pitch-svg__dot' : h ? 'pitch-svg__dot pitch-svg__dot--high' : 'pitch-svg__dot pitch-svg__dot--low'}
          cx={xOf(i)}
          cy={y(h)}
          r={R}
          data-mora={i + 1}
          data-high={p.neutral ? undefined : h ? 'true' : 'false'}
        />
      ))}
      <circle class="pitch-svg__dot pitch-svg__dot--particle" cx={partX} cy={y(particleHigh)} r={R - 1} data-particle="true" />
      {!p.neutral && dropX !== null ? (
        <g class="pitch-svg__drop" data-drop-marker="true">
          <line x1={dropX} y1={Y_HIGH} x2={dropX} y2={Y_LOW - 5} />
          <polygon points={`${dropX - 3.5},${Y_LOW - 6} ${dropX + 3.5},${Y_LOW - 6} ${dropX},${Y_LOW}`} />
        </g>
      ) : null}
      {p.labels
        ? p.labels.map((m, i) => (
            <text key={`l${i}`} class="pitch-svg__label" x={xOf(i)} y={Y_LABEL} text-anchor="middle" lang="ja">
              {m}
            </text>
          ))
        : null}
      {p.labels ? (
        <text class="pitch-svg__label pitch-svg__label--particle" x={partX} y={Y_LABEL} text-anchor="middle" lang="ja">
          が
        </text>
      ) : null}
    </svg>
  );
}

function typeLabel(t: PitchType): string {
  const l = PITCH_TYPE_LABEL[t];
  return `${l.en} (${l.ja})`;
}

function ariaFor(t: PitchType, drop: number | null, n: number): string {
  return drop === null ? fill(S.pitchAriaFlat, { type: typeLabel(t), n }) : fill(S.pitchAria, { type: typeLabel(t), mora: drop, n });
}

/* ── PitchLine ───────────────────────────────────────────────────────────── */

export interface PitchLineProps {
  kana: string;
  /** Nucleus, 0..mora count. */
  pitch: number;
  /** Input mode: the learner taps the drop mora (nucleus 1..n) or no drop (0). */
  onPick?(nucleus: number): void;
  /** Nucleus the learner picked (locks the picker). */
  picked?: number;
  /** Show the true contour (and the verdict in input mode). Default: true unless `onPick` is set. */
  revealed?: boolean;
  /** Print the type label under the line (default true when revealed). */
  showLabel?: boolean;
  class?: string;
}

export function PitchLine(p: PitchLineProps): JSX.Element {
  const morae = moraSplit(p.kana);
  const n = Math.max(1, morae.length);
  const labels = morae.length > 0 ? morae : [p.kana];
  const interactive = typeof p.onPick === 'function';
  const revealed = p.revealed ?? !interactive;
  const contour = pitchContour(n, p.pitch);
  const type = pitchTypeFor(n, p.pitch);
  const nucleus = contour.drop ?? 0;
  const cls = ['pitch-line', interactive ? 'pitch-line--input' : '', p.class ?? ''].filter(Boolean).join(' ');

  return (
    <div class={cls} data-type={revealed ? type : undefined} data-pitch={revealed ? nucleus : undefined}>
      <ContourSvg
        contour={contour}
        labels={labels}
        neutral={!revealed}
        ariaLabel={revealed ? ariaFor(type, contour.drop, n) : fill(S.pitchPickerLabel, {})}
      />
      {revealed && (p.showLabel ?? true) ? (
        <span class="pitch-line__type">
          <span>{PITCH_TYPE_LABEL[type].en}</span> <span lang="ja">{PITCH_TYPE_LABEL[type].ja}</span>
        </span>
      ) : null}
      {interactive ? (
        <PitchPicker morae={labels} nucleus={nucleus} picked={p.picked} revealed={revealed} onPick={p.onPick as (n: number) => void} />
      ) : null}
    </div>
  );
}

/* ── PitchPicker (input mode) ────────────────────────────────────────────── */

interface PitchPickerProps {
  morae: string[];
  nucleus: number;
  picked?: number;
  revealed: boolean;
  onPick(nucleus: number): void;
}

type PickState = 'idle' | 'correct' | 'wrong' | 'missed';

function pickState(value: number, picked: number | undefined, nucleus: number, revealed: boolean): PickState {
  if (!revealed) return 'idle';
  if (picked === value) return picked === nucleus ? 'correct' : 'wrong';
  if (nucleus === value) return 'missed';
  return 'idle';
}

function PitchPicker(p: PitchPickerProps): JSX.Element {
  const n = p.morae.length;
  const locked = p.picked !== undefined || p.revealed;
  const fired = useRef(false);
  // Re-arm for a new word (or when the host clears `picked`).
  const sig = p.morae.join('\u001f');
  const last = useRef({ sig, picked: p.picked });
  if (last.current.sig !== sig || (last.current.picked !== undefined && p.picked === undefined)) fired.current = false;
  last.current = { sig, picked: p.picked };
  const pick = (nucleus: number): void => {
    if (locked || fired.current || nucleus < 0 || nucleus > n) return;
    fired.current = true;
    p.onPick(nucleus);
  };
  // Digit i (1-based) → drop after mora i; digit n+1 → no drop.
  useExerciseKeys({ onChoice: (idx) => pick(idx < n ? idx + 1 : idx === n ? 0 : -1) });

  const options: { value: number; label: JSX.Element; sr: string; key: number }[] = p.morae.map((m, i) => ({
    value: i + 1,
    key: i + 1,
    label: <span lang="ja">{m}</span>,
    sr: fill(S.pitchDropAfter, { mora: m }),
  }));
  options.push({ value: 0, key: n + 1, label: <span>{S.pitchFlat}</span>, sr: S.pitchFlat });

  return (
    <div class="pitch-picker" role="group" aria-label={S.pitchPickerLabel} data-locked={locked ? 'true' : undefined}>
      {options.map((o) => {
        const st = pickState(o.value, p.picked, p.nucleus, p.revealed);
        return (
          <button
            key={o.key}
            type="button"
            class="pitch-picker__btn"
            data-nucleus={o.value}
            data-state={st}
            disabled={locked}
            aria-label={o.sr}
            aria-keyshortcuts={o.key <= 9 ? String(o.key) : undefined}
            onClick={() => pick(o.value)}
          >
            {o.key <= 9 ? (
              <kbd class="pitch-picker__key" aria-hidden="true">
                {o.key}
              </kbd>
            ) : null}
            {o.label}
            {st !== 'idle' ? (
              <span class="pitch-picker__mark" aria-hidden="true">
                {st === 'wrong' ? '×' : '○'}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── PitchGlyph ──────────────────────────────────────────────────────────── */

export interface PitchGlyphProps {
  type: PitchType;
  /** Print the English + kanji name under the glyph. */
  label?: boolean;
  class?: string;
}

/** The four contour glyphs 平板/頭高/中高/尾高 over a four-mora schematic (pitch-ear choices). */
export function PitchGlyph(p: PitchGlyphProps): JSX.Element {
  const contour = pitchContour(4, GLYPH_NUCLEUS[p.type]);
  const cls = ['pitch-glyph', p.class ?? ''].filter(Boolean).join(' ');
  return (
    <span class={cls} data-type={p.type}>
      <ContourSvg contour={contour} compact ariaLabel={fill(S.pitchGlyphAria, { type: typeLabel(p.type) })} />
      {p.label ? (
        <span class="pitch-glyph__label">
          <span>{PITCH_TYPE_LABEL[p.type].en}</span> <span lang="ja">{PITCH_TYPE_LABEL[p.type].ja}</span>
        </span>
      ) : null}
    </span>
  );
}
