/**
 * TSUZUKU — <StampPress>: the goshuin pressed onto the book page after a
 * Gatekeeper pass (design 06 §4): the seal hovers, presses with a hanko thump
 * and its ink spreads; gold frame when the gate was perfect, a grey corner
 * when it was Assisted. Completes on its own after the press (or on skip).
 *
 * The stamp is `<GoshuinStamp>` (sibling G module) when built; otherwise the
 * fallback here: seeded square/round seal frame with eroded edges, the station
 * name in 1–3 tategaki columns, the era date in small sumi type.
 *
 * Design 09 §7 E / §10 D1: the card and the book page are `.sheet`s; the press
 * is a --spring transition, the wet ink dries (kawaku, opacity only); at `set`
 * the era date lands exactly as `formatEraDate` prints it with its Latin gloss
 * beneath (`.seal-date`); the station line shows romaji only below Green kana
 * and a kana `<Ruby>` from Green on (d49, `src/art/road/reading`); Continue
 * and the auto-complete dry the card out (kasure, `useExit`) before `onDone`,
 * or hand over at once when the host owns the exit (`hostExit`).
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { STATIONS, type StationDef } from '../../content/types';
import { hashSeed, mulberry32 } from '../../shared/hash';
import type { EpochDay } from '../../shared/store-types';
import { formatEraDate } from '../../shared/time';
import { Ruby } from '../../shared/ui/Ruby';
import { store } from '../../store';
import { inkBleed, sealFrame } from '../brush';
import { INK, PALETTE, STONE } from '../color';
import { FONTS, columnsFor, fitSize, splitColumns, tategaki } from '../jtext';
import { romajiAllowed, rubyMarkup, signRubyMode } from '../road/reading';
import { path, polygon, svgDoc, text, uid, url } from '../svg';
import { fill } from '../strings';
import { S } from './strings';
import { eraDateNodes, eraGloss, loadGoshuinStamp, playSfx, prefersReducedMotion, useExit, useLazy, useTimeline, verb } from './support';
import './StampPress.css';

export interface StampPressProps {
  station: number;
  perfect: boolean;
  assisted: boolean;
  onDone(): void;
  reduced?: boolean;
  /** The host plays the one kasure exit on its overlay: Continue / the auto-complete hand over at once. */
  hostExit?: boolean;
}

/** Phase start times: hover → press (thump, ink spread) → set (copy appears). */
export const PRESS_AT: readonly number[] = [0, 350, 900];
export const PRESS_PHASES = ['hover', 'press', 'set'] as const;
/** The ceremony completes by itself this long after mount. */
export const PRESS_DONE_MS = 3600;

export function stationDef(n: number): StationDef | null {
  return Number.isInteger(n) && n >= 1 && n <= STATIONS.length ? (STATIONS[n - 1] ?? null) : null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fallback stamp                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface FallbackStampOptions {
  station: StationDef | null;
  number: number;
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
  seed: number;
  size: number;
}

/** A standalone goshuin document (vermilion on transparent; the page supplies the paper). */
export function fallbackStampSvg(o: FallbackStampOptions): string {
  const s = Math.max(48, o.size);
  const rng = mulberry32(o.seed >>> 0);
  const round = rng() < 0.5;
  const shu = PALETTE.light.shu;
  const kin = PALETTE.light.kin;
  const bleedId = uid('stamp-bleed', o.number, o.seed);
  const defs = [inkBleed(bleedId, o.seed, { scale: s * 0.012, blur: 0.5 })];
  const body: string[] = [];
  if (o.perfect) {
    body.push(path(sealFrame({ x: s * 0.02, y: s * 0.02, size: s * 0.96, round, seed: o.seed ^ 0x9e3779b9, stroke: s * 0.02, erode: 0.008 }), { fill: kin, 'fill-rule': 'evenodd' }));
  }
  body.push(path(sealFrame({ x: s * 0.08, y: s * 0.08, size: s * 0.84, round, seed: o.seed, stroke: s * 0.055 }), { fill: shu, 'fill-rule': 'evenodd', filter: url(bleedId) }));

  const name = o.station?.nameJa ?? S.stampUnknownStation;
  const cols = Math.min(3, columnsFor(name, 3));
  const columns = splitColumns(name, cols);
  const inner = s * 0.56;
  const colGap = 1.45;
  let size = Infinity;
  for (const c of columns) size = Math.min(size, fitSize(c, inner / Math.max(1, (cols - 1) * colGap + 1), inner, { vertical: true, max: s * 0.3 }));
  if (!Number.isFinite(size)) size = s * 0.2;
  const longest = Math.max(1, ...columns.map((c) => Array.from(c).length));
  const colHeight = size * (1 + (longest - 1) * 1.12);
  const pitch = colGap * size;
  const cx = s / 2;
  const cy = s / 2;
  body.push(
    tategaki({
      text: name,
      x: cx + ((columns.length - 1) * pitch) / 2,
      y: cy - colHeight / 2,
      size,
      columns: columns.length,
      font: FONTS.brush,
      fill: shu,
      colGap,
    }),
  );
  body.push(
    text(formatEraDate(o.at), {
      x: cx,
      y: s * 0.975,
      'text-anchor': 'middle',
      'font-family': FONTS.mincho,
      'font-size': s * 0.055,
      fill: INK,
      lang: 'ja',
    }),
  );
  if (o.assisted) {
    body.push(
      polygon(
        [
          [s * 0.72, s * 0.08],
          [s * 0.92, s * 0.08],
          [s * 0.92, s * 0.28],
        ],
        { fill: STONE, opacity: 0.92 },
      ),
    );
  }
  const title = fill(S.stampAlt, { n: o.number, name: o.station ? `${o.station.nameJa} ${o.station.nameRomaji}` : S.stampUnknownStation });
  return svgDoc({ w: s, h: s, defs, body, title, preserveAspectRatio: 'xMidYMid meet', attrs: { role: 'img' } });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function StampPress(p: StampPressProps): JSX.Element {
  const reduced = p.reduced ?? prefersReducedMotion();
  const exit = useExit(p.onDone, reduced || p.hostExit === true);
  const phase = useTimeline(PRESS_AT, { reduced, endAt: PRESS_DONE_MS, onEnd: exit.leave });
  const stamp = useLazy(loadGoshuinStamp);
  const romaji = romajiAllowed(store.profile.value.belt);
  const rubyMode = signRubyMode(store.settings.value.furigana);
  const def = stationDef(p.station);
  const at: EpochDay = store.collections.value.stamps[p.station]?.at ?? store.today();
  const seed = hashSeed(store.seed(), 'goshuin', p.station);
  const pressed = phase >= 1;

  useEffect(() => {
    if (pressed) playSfx('stamp');
  }, [pressed]);

  const Stamp = stamp.value;
  const phaseName = PRESS_PHASES[Math.min(phase, PRESS_PHASES.length - 1)];
  const svg = fallbackStampSvg({ station: def, number: p.station, at, perfect: p.perfect, assisted: p.assisted, seed, size: 240 });

  return (
    <section
      class={`stamp-press sheet stamp-press--${phaseName} ${verb(reduced, 'ink-nijimi')}`}
      data-phase={phase}
      data-perfect={p.perfect}
      data-assisted={p.assisted}
      data-station={p.station}
      data-leaving={exit.leaving ? '' : undefined}
      ref={exit.ref}
    >
      <p class="stamp-press__eyebrow eyebrow">
        {S.stampTitle}
        <span class="stamp-press__eyebrow-ja" lang="ja">
          {S.stampTitleJa}
        </span>
      </p>
      <div class="stamp-press__page sheet sheet--gutter">
        <div class="stamp-press__stamp" data-stamp={Stamp ? 'goshuin' : 'fallback'}>
          {Stamp ? <Stamp station={p.station} at={at} perfect={p.perfect} assisted={p.assisted} size={240} /> : <div class="stamp-press__fallback" dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
      </div>
      <p class="stamp-press__line">
        {fill(S.stampStation, { n: p.station })}
        {def ? (
          <>
            {', '}
            {romaji ? (
              <>
                <span lang="ja">{def.nameJa}</span> {def.nameRomaji}
              </>
            ) : (
              <Ruby ja={rubyMarkup(def.nameJa, def.nameRomaji)} mode={rubyMode} />
            )}
          </>
        ) : null}
        {'. '}
        {S.stampBehind}
      </p>
      {phase >= 2 ? (
        <p class={`seal-date ceremony__date stamp-press__date ${verb(reduced, 'ink-nijimi')}`}>
          <span class="ceremony__era" lang="ja">
            {eraDateNodes(at)}
          </span>
          <span class="seal-date__label">{eraGloss(at)}</span>
        </p>
      ) : null}
      {p.perfect ? <p class="stamp-press__note stamp-press__note--gold">{S.stampPerfect}</p> : null}
      {p.assisted ? <p class="stamp-press__note muted">{S.stampAssisted}</p> : null}
      <div class="stamp-press__actions">
        <button type="button" class="hanko stamp-press__continue" onClick={exit.leave}>
          {S.continue}
        </button>
      </div>
    </section>
  );
}
