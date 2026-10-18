/**
 * TSUZUKU — <BeltCeremony>: the 12 s belt ceremony (design 02 §2), skippable.
 *
 *   dim → three taiko hits, each blooming a vermilion ink splash → the rank
 *   kanji brush-writes (a brush-shaped mask drawn with stroke-dasharray over
 *   Yuji Syuku type) → a woven belt in the new colour ties its knot (two
 *   Béziers morphing, tails drawn in) while the palette sweeps to the belt →
 *   the learner's name seal slams at −6° with ink bleed → the new kakejiku
 *   thumbnail rises from the ink with the wind chime → the next lantern on
 *   the Road turns vermilion → the Sensei line and a ≤ 80-word vignette.
 *
 * Phase times live in `BELT_PHASE_AT`; the three taiko phases are the
 * `ceremony` recipe's own hit offsets (`CEREMONY_TAIKO_AT_MS`, src/audio/sfx.ts
 * — the one table that owns the hits; the art tier may not import the audio
 * group, so BeltCeremony.test.tsx pins the equality). Reduced motion shows
 * the final frame at once, with no ink verb on it. Audio: `ceremony` at the
 * start, `wallpaper` when the thumbnail rises. Continue (and the host's tap /
 * Enter / Esc) dries the card out (kasure, `useExit`) before `onDone` fires —
 * or hands over at once when the host owns the exit (`hostExit`).
 *
 * Design 09 §7 E / §10 D1: the stage is `--stage-*` sumi in both themes over
 * a seeded ink wash rendered ONCE as a data URL (`inkWashUrl`); the three
 * splashes AND the kakejiku thumbnail (placeholder or registry render, text
 * layers baked in) are `<img>` data URLs, so the only live `<filter>` on the
 * whole ceremony is the name seal's ink bleed (§6.7 rule 2, def × users); the
 * knot carries the `belt-chip` hero (static CSS). The vignette's rank title and
 * next-lantern line show romaji only below Green kana and a kana `<Ruby>` from
 * Green on (§3.3, `src/art/road/reading`): the Green ceremony is the moment
 * romaji is removed, not dimmed.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BELTS, STATIONS, type Belt } from '../../content/types';
import { beltBadgeId, type WallpaperId } from '../../shared/catalog';
import { hashSeed } from '../../shared/hash';
import { Ruby } from '../../shared/ui/Ruby';
import { store } from '../../store';
import { dashWrite, inkBleed, sealFrame, splatter } from '../brush';
import { INK_WASH, PALETTE, STONE, WASHI, beltColor, darken, lighten } from '../color';
import { FONTS, columnsFor, fitSize, katakanaName, splitColumns, tategaki, textLayersSvg, textWidth } from '../jtext';
import { romajiAllowed, rubyMarkup, signRubyMode } from '../road/reading';
import { circle, el, line, mask, path, pattern, polyPath, rect, roundedRectPath, style, svgDataUrl, svgDoc, text, turbulence, uid, url } from '../svg';
import { WALLPAPER_NAMES, fill } from '../strings';
import { badgeDefinition, fallbackCrestSvg } from './BadgeSlam';
import { S } from './strings';
import { appendToSvg, beltTitleRuby, loadMonCrest, loadWallpapers, playSfx, prefersReducedMotion, useExit, useLazy, useTimeline, verb } from './support';
import { placeholderWallpaperSvg } from './WallpaperUnlock';
import './BeltCeremony.css';

export interface BeltCeremonyProps {
  belt: Belt;
  nameKana: string;
  /** The piece this belt unlocks (design 02 §2); default `BELT_WALLPAPER[belt]`. */
  wallpaperId?: WallpaperId;
  onDone(): void;
  reduced?: boolean;
  /** The host plays the one kasure exit on its overlay: Continue hands over at once. */
  hostExit?: boolean;
}

export const BELT_PHASES = ['dim', 'taiko1', 'taiko2', 'taiko3', 'kanji', 'knot', 'seal', 'thumb', 'lantern', 'vignette'] as const;
export type BeltPhase = (typeof BELT_PHASES)[number];
/**
 * Start of each phase in ms since mount (≈ 12 s to the vignette, `SFX_DURATION_MS.ceremony`).
 * The taiko phases are the recipe's hits — 0 / 700 / 1,400 ms, `CEREMONY_TAIKO_AT_MS` in
 * src/audio/sfx.ts (BeltCeremony.test.tsx asserts the equality by importing it); the kanji
 * writes at 2,400 ms, where the recipe's shakuhachi enters.
 */
export const BELT_PHASE_AT: readonly number[] = [0, 0, 700, 1400, 2400, 5000, 7600, 8800, 10600, 11600];
/** Indices of the taiko phases in `BELT_PHASES` / `BELT_PHASE_AT`. */
export const BELT_TAIKO_PHASES: readonly number[] = [1, 2, 3];

/** Ceremony wallpapers by belt (design 02 §2); Yellow and Orange unlock a badge only. */
export const BELT_WALLPAPER: Partial<Record<Belt, WallpaperId>> = {
  green: 'fuji-ridge',
  blue: 'daruma',
  purple: 'koi-dragon',
  brown: 'wall-broken',
  black: 'kyoto-arrival',
};

export function beltPhaseIndex(name: BeltPhase): number {
  return BELT_PHASES.indexOf(name);
}

const SHU = PALETTE.light.shu;
const KIN = PALETTE.light.kin;

/* ────────────────────────────────────────────────────────────────────────── */
/* SVG pieces                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** The seeded ink wash behind the stage (svg.ts turbulence), as a static data URL: rasterised once, never a live filter. */
export function inkWashUrl(seed: number): string {
  const id = 'belt-wash';
  return svgDataUrl(
    svgDoc({
      w: 320,
      h: 224,
      defs: [turbulence(id, { baseFrequency: [0.012, 0.02], octaves: 3, seed, alpha: 0.9 })],
      body: [rect(0, 0, 320, 224, { fill: INK_WASH, filter: url(id), opacity: 0.18 })],
      preserveAspectRatio: 'none',
      attrs: { 'aria-hidden': 'true' },
    }),
  );
}

/** One taiko splash: a wet centre and flung droplets, 220 × 220. */
export function splashSvg(seed: number, i: number): string {
  const id = uid('belt-splash', i, seed);
  const s = seed + i * 7919;
  return svgDoc({
    w: 220,
    h: 220,
    defs: [inkBleed(id, s, { scale: 8, blur: 0.8 })],
    body: [el('g', { filter: url(id), fill: SHU }, [circle(110, 110, 34 + (i % 2) * 4), path(splatter(110, 110, 96, s, 22))])],
    preserveAspectRatio: 'xMidYMid meet',
    attrs: { 'aria-hidden': 'true' },
  });
}

/** The rank kanji in brush type, revealed by a brush-shaped mask drawn with stroke-dasharray (600 × 240). */
export function kanjiSvg(titleJa: string, seed: number, reduced: boolean): string {
  const W = 600;
  const H = 240;
  const size = fitSize(titleJa, 560, 200, { max: 200, min: 40 });
  const tw = textWidth(titleJa, size);
  const maskId = uid('belt-write', seed);
  const passes = 3;
  const x0 = W / 2 - tw / 2 - size * 0.18;
  const x1 = W / 2 + tw / 2 + size * 0.18;
  const top = H / 2 - size * 0.52;
  const row = (size * 1.04) / passes;
  const pts: [number, number][] = [];
  for (let k = 0; k < passes; k++) {
    const y = top + (k + 0.5) * row;
    if (k % 2 === 0) pts.push([x0, y], [x1, y]);
    else pts.push([x1, y], [x0, y]);
  }
  const write = dashWrite(1000, { dur: 2200, cls: 'belt-write' });
  const brushPath = path(polyPath(pts), {
    stroke: '#fff',
    'stroke-width': row * 1.3,
    fill: 'none',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    ...(reduced ? {} : write.attrs),
  });
  const defs = reduced ? [] : [mask(maskId, brushPath, { x: 0, y: 0, width: W, height: H }), style(write.css)];
  const glyphs = text(titleJa, {
    x: W / 2,
    y: H / 2,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': FONTS.brush,
    'font-size': size,
    fill: WASHI,
    lang: 'ja',
    mask: reduced ? undefined : url(maskId),
  });
  return svgDoc({ w: W, h: H, defs, body: [glyphs], preserveAspectRatio: 'xMidYMid meet', attrs: { 'aria-hidden': 'true' } });
}

const EAR_LOOSE = 'M300 150 C220 40 100 70 130 165 C150 225 240 215 300 170';
const EAR_TIGHT = 'M300 150 C258 108 196 120 212 165 C224 199 268 192 300 170';
const TAIL_L = 'M286 190 C262 236 236 266 222 310';
const TAIL_R = 'M314 190 C338 236 364 266 378 310';

/** The woven belt tying its knot: band, two ears morphing tight, tails drawn in (600 × 320). */
export function knotSvg(belt: Belt, seed: number, reduced: boolean): string {
  const c = beltColor(belt);
  const edge = belt === 'white' ? darken(WASHI, 0.35) : darken(c, 0.35);
  const weaveId = uid('belt-weave', belt, seed);
  const weave = pattern(weaveId, 12, 12, [line(0, 12, 12, 0, { stroke: edge, 'stroke-width': 1.2, opacity: 0.28 }), line(0, 0, 12, 12, { stroke: lighten(c, 0.25), 'stroke-width': 0.8, opacity: 0.25 })]);
  const morph = reduced
    ? ''
    : el('animate', {
        attributeName: 'd',
        from: EAR_LOOSE,
        to: EAR_TIGHT,
        begin: '0.9s',
        dur: '0.8s',
        fill: 'freeze',
        calcMode: 'spline',
        keyTimes: '0;1',
        keySplines: '0.2 0.8 0.2 1',
      });
  const earD = reduced ? EAR_TIGHT : EAR_LOOSE;
  const ear = (): string =>
    el('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      el('path', { d: earD, stroke: edge, 'stroke-width': 31 }, morph),
      el('path', { d: earD, stroke: c, 'stroke-width': 26 }, morph),
    ]);
  const tailL = dashWrite(1000, { dur: 900, cls: 'belt-tail-l' });
  const tailR = dashWrite(1000, { dur: 900, delay: 500, cls: 'belt-tail-r' });
  const tail = (d: string, w: ReturnType<typeof dashWrite>): string =>
    el('g', { fill: 'none', 'stroke-linecap': 'butt' }, [
      path(d, { stroke: edge, 'stroke-width': 31, ...(reduced ? {} : w.attrs) }),
      path(d, { stroke: c, 'stroke-width': 26, ...(reduced ? {} : w.attrs) }),
    ]);
  const body: string[] = [
    rect(40, 130, 520, 46, { fill: c, stroke: edge, 'stroke-width': 2 }),
    rect(40, 130, 520, 46, { fill: url(weaveId) }),
    ear(),
    el('g', { transform: 'translate(600 0) scale(-1 1)' }, ear()),
    tail(TAIL_L, tailL),
    tail(TAIL_R, tailR),
    path(roundedRectPath(268, 118, 64, 72, 10), { fill: c, stroke: edge, 'stroke-width': 2 }),
    path(roundedRectPath(268, 118, 64, 72, 10), { fill: url(weaveId) }),
  ];
  if (belt === 'black') body.push(line(40, 153, 560, 153, { stroke: KIN, 'stroke-width': 2, 'stroke-dasharray': '10 7', opacity: 0.9 }));
  const defs = [weave, ...(reduced ? [] : [style(tailL.css + tailR.css)])];
  return svgDoc({ w: 600, h: 320, defs, body, preserveAspectRatio: 'xMidYMid meet', attrs: { 'aria-hidden': 'true' } });
}

/** The learner's name seal: eroded square frame, washi slip, name in 1–3 tategaki columns (200 × 200). */
export function sealSvg(name: string, seed: number): string {
  const s = 200;
  const bleedId = uid('belt-seal-bleed', seed);
  const shown = katakanaName(name) || S.nameless;
  const cols = Math.min(3, columnsFor(shown, 4));
  const columns = splitColumns(shown, cols);
  const colGap = 1.4;
  let size = Infinity;
  for (const col of columns) size = Math.min(size, fitSize(col, 118 / Math.max(1, (columns.length - 1) * colGap + 1), 118, { vertical: true, max: 64 }));
  if (!Number.isFinite(size)) size = 40;
  const longest = Math.max(1, ...columns.map((c) => Array.from(c).length));
  const colHeight = size * (1 + (longest - 1) * 1.12);
  const pitch = colGap * size;
  const body = [
    rect(28, 28, 144, 144, { fill: WASHI }),
    path(sealFrame({ x: 14, y: 14, size: 172, round: false, seed, stroke: 12 }), { fill: SHU, 'fill-rule': 'evenodd', filter: url(bleedId) }),
    tategaki({ text: shown, x: 100 + ((columns.length - 1) * pitch) / 2, y: 100 - colHeight / 2, size, columns: columns.length, font: FONTS.brush, fill: SHU, colGap }),
  ];
  return svgDoc({ w: s, h: s, defs: [inkBleed(bleedId, seed, { scale: 4, blur: 0.5 })], body, preserveAspectRatio: 'xMidYMid meet', attrs: { 'aria-hidden': 'true' } });
}

export interface NextStop {
  ja: string;
  romaji: string;
  /** 1–53, or 54 for Sanjō Ōhashi. */
  number: number;
}

/** The lantern after this belt's last Gatekeeper. */
export function nextStop(belt: Belt): NextStop {
  const def = BELTS.find((b) => b.id === belt) ?? BELTS[0]!;
  const n = def.stations[1] + 1;
  const st = STATIONS[n - 1];
  return st ? { ja: st.nameJa, romaji: st.nameRomaji, number: n } : { ja: S.beltRoadEndJa, romaji: S.beltRoadEnd, number: STATIONS.length + 1 };
}

/** Five lanterns around the belt's last station; the next one carries `belt-lantern--next` and lights up in CSS (600 × 140). */
export function lanternsSvg(belt: Belt): string {
  const def = BELTS.find((b) => b.id === belt) ?? BELTS[0]!;
  const last = def.stations[1];
  const first = Math.max(1, last - 3);
  const body: string[] = [];
  for (let i = 0; i < 5; i++) {
    const n = first + i;
    const cx = 60 + i * 120;
    const st = STATIONS[n - 1];
    const label = st ? st.nameJa : n === STATIONS.length + 1 ? S.beltRoadEndJa : '';
    if (!label) continue;
    const cleared = n <= last;
    const next = n === last + 1;
    body.push(rect(cx - 14, 14, 28, 8, { fill: INK_WASH, rx: 2 }));
    body.push(rect(cx - 14, 80, 28, 8, { fill: INK_WASH, rx: 2 }));
    body.push(
      path(roundedRectPath(cx - 20, 22, 40, 58, 15), {
        class: next ? 'belt-lantern belt-lantern--next' : cleared ? 'belt-lantern belt-lantern--lit' : 'belt-lantern',
        fill: next ? 'none' : cleared ? SHU : 'none',
        stroke: next ? STONE : cleared ? darken(SHU, 0.3) : STONE,
        'stroke-width': 2,
      }),
    );
    if (cleared) body.push(line(cx - 12, 51, cx + 12, 51, { stroke: darken(SHU, 0.35), 'stroke-width': 1.5, opacity: 0.6 }));
    body.push(text(label, { x: cx, y: 120, 'text-anchor': 'middle', 'font-family': FONTS.ja, 'font-size': 16, fill: WASHI, opacity: next || cleared ? 0.95 : 0.55, lang: 'ja' }));
  }
  return svgDoc({ w: 600, h: 140, body, preserveAspectRatio: 'xMidYMid meet', attrs: { 'aria-hidden': 'true' } });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function BeltCeremony(p: BeltCeremonyProps): JSX.Element {
  const reduced = p.reduced ?? prefersReducedMotion();
  const phase = useTimeline(BELT_PHASE_AT, { reduced });
  const def = BELTS.find((b) => b.id === p.belt) ?? BELTS[0]!;
  const wallpaperId = p.wallpaperId ?? BELT_WALLPAPER[p.belt];
  const seed = hashSeed(store.seed(), 'belt', p.belt);
  const name = p.nameKana.trim() || S.nameless;
  const crest = useLazy(loadMonCrest);
  const wallpapers = useLazy(loadWallpapers);
  const [thumb, setThumb] = useState<string | null>(null);
  const reached = (ph: BeltPhase): boolean => phase >= beltPhaseIndex(ph);
  const reforge = wallpaperId ? (store.collections.value.wallpapers[wallpaperId]?.reforges ?? 0) : 0;
  const exit = useExit(p.onDone, reduced || p.hostExit === true);
  // signage (design 09 §3.3): romaji only below Green kana; a kana ruby from Green on (the belt the store holds — this ceremony's)
  const romaji = romajiAllowed(store.profile.value.belt);
  const rubyMode = signRubyMode(store.settings.value.furigana);
  // static images, each encoded once per ceremony, never per phase render
  const wash = useMemo(() => inkWashUrl(seed), [seed]);
  const splashes = useMemo(() => [0, 1, 2].map((i) => svgDataUrl(splashSvg(seed, i))), [seed]);
  const thumbSrc = useMemo(() => (wallpaperId ? svgDataUrl(thumb ?? placeholderWallpaperSvg(wallpaperId, hashSeed(store.seed(), wallpaperId, reforge), 'desktop')) : ''), [thumb, wallpaperId, reforge]);

  useEffect(() => {
    playSfx('ceremony');
  }, []);

  const thumbUp = reached('thumb');
  useEffect(() => {
    if (thumbUp && wallpaperId) playSfx('wallpaper');
  }, [thumbUp]);

  useEffect(() => {
    if (!wallpaperId || !wallpapers.settled || !wallpapers.value) return;
    let alive = true;
    wallpapers.value.renderWallpaper(wallpaperId, { size: 'desktop', reforge, revealed: 4, locked: false }).then(
      (r) => {
        if (alive && r && typeof r.svg === 'string') setThumb(appendToSvg(r.svg, textLayersSvg(r.texts ?? [])));
      },
      (err: unknown) => {
        console.warn('[ceremony] renderWallpaper failed', err);
      },
    );
    return () => {
      alive = false;
    };
  }, [wallpapers.settled]);

  const badgeId = beltBadgeId(p.belt);
  const badgeDef = badgeId ? badgeDefinition(badgeId) : undefined;
  const Crest = crest.value;
  const next = nextStop(p.belt);
  const classes = ['belt-ceremony', verb(reduced, 'ink-nijimi'), ...BELT_PHASES.slice(0, phase + 1).map((n) => `is-${n}`)].filter(Boolean).join(' ');

  return (
    <section
      class={classes}
      data-belt={p.belt}
      data-phase={phase}
      data-phase-name={BELT_PHASES[phase]}
      data-leaving={exit.leaving ? '' : undefined}
      ref={exit.ref}
      style={{ '--belt-wash': `url("${wash}")` }}
    >
      <div class="belt-ceremony__sweep" aria-hidden="true" />
      <div class="belt-ceremony__stage" aria-hidden="true">
        {splashes.map((src, i) => (reached(BELT_PHASES[i + 1]!) ? <img key={i} class={`belt-splash belt-splash--${i}`} src={src} alt="" /> : null))}
        {reached('kanji') ? <div class="belt-kanji" dangerouslySetInnerHTML={{ __html: kanjiSvg(def.titleJa, seed, reduced) }} /> : null}
        {reached('knot') ? <div class={`belt-knot ${verb(reduced, 'ink-nijimi')}`} data-hero="belt-chip" style={{ '--from': '0 24px' }} dangerouslySetInnerHTML={{ __html: knotSvg(p.belt, seed, reduced) }} /> : null}
        {reached('seal') ? <div class="belt-seal" dangerouslySetInnerHTML={{ __html: sealSvg(name, seed) }} /> : null}
      </div>
      <p class="visually-hidden">
        {fill(S.beltKnotAlt, { belt: def.nameEn })} {fill(S.beltSealAlt, { name })}
      </p>
      {wallpaperId && reached('thumb') ? (
        <figure class={`belt-thumb ${verb(reduced, 'ink-nijimi')}`} aria-label={fill(S.beltThumbAlt, { name: WALLPAPER_NAMES[wallpaperId].en })} data-preview={thumb ? 'render' : 'placeholder'}>
          <img class={`belt-thumb__art ${verb(reduced, 'ink-hiku')}`} data-axis="y" src={thumbSrc} alt="" decoding="async" />
          <figcaption class="belt-thumb__caption" lang="ja">
            {WALLPAPER_NAMES[wallpaperId].ja}
          </figcaption>
        </figure>
      ) : null}
      {reached('lantern') ? <div class="belt-lanterns" role="img" aria-label={S.beltLanternsAlt} dangerouslySetInnerHTML={{ __html: lanternsSvg(p.belt) }} /> : null}
      {reached('vignette') ? (
        <div class={`belt-vignette ${verb(reduced, 'ink-nijimi')}`}>
          <p class="eyebrow belt-vignette__eyebrow">
            {fill(S.beltTitle, { belt: def.nameEn })}
            <span lang="ja">{def.nameJa}</span>
          </p>
          <h2 class="belt-vignette__rank brush" lang="ja">
            {romaji ? def.titleJa : <Ruby ja={beltTitleRuby(def)} mode={rubyMode} />}
          </h2>
          {romaji ? <p class="belt-vignette__romaji">{def.titleRomaji}</p> : null}
          {badgeId && badgeDef ? (
            <div class="belt-vignette__crest" data-crest={Crest ? 'mon' : 'fallback'}>
              {Crest ? (
                <Crest id={badgeId} earned size={72} describe={badgeDef.describe} caption={false} />
              ) : (
                <div dangerouslySetInnerHTML={{ __html: fallbackCrestSvg({ glyph: badgeDef.glyph, tier: badgeDef.tier, field: badgeDef.field, size: 72, seed: hashSeed(store.seed(), 'mon', badgeId), title: badgeDef.nameJa }) }} />
              )}
            </div>
          ) : null}
          <p class="belt-vignette__sensei">{S.beltSensei}</p>
          <p class="belt-vignette__text">{S.beltVignettes[p.belt]}</p>
          <p class="belt-vignette__next">
            {S.beltNextLantern}
            {': '}
            {romaji ? (
              <>
                <span lang="ja">{next.ja}</span> {next.romaji}
              </>
            ) : (
              <Ruby ja={rubyMarkup(next.ja, next.romaji)} mode={rubyMode} />
            )}
          </p>
          <button type="button" class="hanko belt-vignette__continue" onClick={exit.leave}>
            {S.continue}
          </button>
        </div>
      ) : null}
    </section>
  );
}
