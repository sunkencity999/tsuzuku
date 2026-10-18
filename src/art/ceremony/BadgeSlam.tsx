/**
 * TSUZUKU — <BadgeSlam>: a newly earned Mon slams onto the page at −6° with
 * an ink ring and the hanko thump (design 06 §2), then shows the name, its
 * strand and tier, the condition in plain words, and "Save as image", which
 * rasterises a share card through `exportPng` (design 07 §8).
 *
 * The crest itself is `<MonCrest>` (sibling G module) when built; until then a
 * fallback crest drawn here from the badge definition (ring · field · glyph)
 * keeps the ceremony honest. `fallbackCrestSvg` is also what the share card
 * uses when `mon.ts` is unavailable.
 *
 * Design 09 §7 E / §10 D1: the card is a `.sheet`; before the slam the crest
 * stands as grey STONE — mon.ts's own stone treatment (`monStoneImage`: the
 * emboss rasterised once as an `<img>` data URL, the glyph set over it in the
 * page's brush face, exactly as `<MonCrest>` draws a locked crest), so the
 * slam reads as THE SAME drawing turning from stone to colour; the unearned
 * fallback crest stands in only while mon.ts is not built. No live filter
 * either way. The ink ring dries (kawaku); at `settled` the era date lands
 * with its Latin gloss (`.seal-date`); Continue dries the card out (kasure,
 * `useExit`) first — or hands over at once when the host owns the exit
 * (`hostExit`: one kasure on the overlay, never two in a row).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { BadgeId } from '../../shared/catalog';
import { hashSeed, mulberry32 } from '../../shared/hash';
import type { EpochDay } from '../../shared/store-types';
import { formatEraDate, isoDate } from '../../shared/time';
import { BADGE_DEFS, store } from '../../store';
import { INK, INK_WASH, PALETTE, STONE, WASHI, ringHex } from '../color';
import { TAU, polar, rays, regularPolygon } from '../geom';
import { FONTS, fitSize, textEl, type TextLayer } from '../jtext';
import { download, exportPng } from '../png';
import { circle, g, innerOf, path, polygon, rect, roundedRectPath, svgDataUrl, svgDoc, text, uid, viewBoxOf } from '../svg';
import { fill } from '../strings';
import { S } from './strings';
import { eraDateNodes, eraGloss, loadMon, loadMonCrest, playSfx, prefersReducedMotion, useExit, useLazy, useTimeline, verb } from './support';
import './BadgeSlam.css';

export interface BadgeSlamProps {
  id: BadgeId;
  onDone(): void;
  /** Static card (default: the store setting or the OS preference). */
  reduced?: boolean;
  /** The host plays the one kasure exit on its overlay: Continue hands over at once instead of drying the card first. */
  hostExit?: boolean;
}

export type BadgeDefinition = (typeof BADGE_DEFS)[number];

/** Phase start times: 0 ready (crest held high) → slam → settled (ink ring, copy fades in). */
export const SLAM_AT: readonly number[] = [0, 60, 520];
export const SLAM_PHASES = ['ready', 'slam', 'settled'] as const;

export function badgeDefinition(id: BadgeId): BadgeDefinition | undefined {
  return BADGE_DEFS.find((d) => d.id === id);
}

const TIER_LABEL = { bronze: S.tierBronze, silver: S.tierSilver, gold: S.tierGold } as const;
const STRAND_LABEL: Record<BadgeDefinition['category'], string> = {
  kana: S.strandKana,
  streak: S.strandStreak,
  training: S.strandTraining,
  road: S.strandRoad,
  belt: S.strandBelt,
  input: S.strandInput,
  output: S.strandOutput,
  mastery: S.strandMastery,
  spirit: S.strandSpirit,
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Fallback crest                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface FallbackCrestOptions {
  glyph: string;
  tier: 'bronze' | 'silver' | 'gold';
  field: 'circle' | 'hexagon' | 'tomoe' | 'square' | 'petal';
  size: number;
  seed: number;
  earned?: boolean;
  title?: string;
}

/** A standalone crest document: ring by tier (gold adds 16 rays), field shape, one brush glyph. */
export function fallbackCrestSvg(o: FallbackCrestOptions): string {
  const s = Math.max(24, o.size);
  const cx = s / 2;
  const cy = s / 2;
  const R = s * 0.46;
  const earned = o.earned ?? true;
  const rng = mulberry32(o.seed >>> 0);
  const ring = earned ? ringHex(o.tier, 'light') : STONE;
  const fieldFill = earned ? INK : STONE;
  const glyphFill = earned ? WASHI : INK_WASH;
  const accent = earned ? PALETTE.light.shu : INK_WASH;
  const body: string[] = [];
  if (o.tier === 'gold') {
    body.push(path(rays(cx, cy, R * 0.9, R * 1.02, 16, -Math.PI / 2 + rng() * 0.2), { fill: 'none', stroke: ring, 'stroke-width': s * 0.014, 'stroke-linecap': 'round' }));
  }
  body.push(circle(cx, cy, R * 0.86, { fill: 'none', stroke: ring, 'stroke-width': s * 0.045 }));
  if (o.tier !== 'bronze') body.push(circle(cx, cy, R * 0.76, { fill: 'none', stroke: ring, 'stroke-width': s * 0.012 }));
  const r = R * 0.66;
  switch (o.field) {
    case 'hexagon':
      body.push(polygon(regularPolygon(cx, cy, r, 6), { fill: fieldFill }));
      break;
    case 'square':
      body.push(path(roundedRectPath(cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72, r * 0.12), { fill: fieldFill }));
      break;
    case 'petal': {
      const petals: string[] = [circle(cx, cy, r * 0.74, { fill: fieldFill })];
      for (let i = 0; i < 8; i++) {
        const [px, py] = polar(cx, cy, r * 0.62, (i / 8) * TAU);
        petals.push(circle(px, py, r * 0.4, { fill: fieldFill }));
      }
      body.push(g(undefined, petals));
      break;
    }
    case 'tomoe': {
      body.push(circle(cx, cy, r, { fill: fieldFill }));
      for (let i = 0; i < 3; i++) {
        const [px, py] = polar(cx, cy, r * 0.78, (i / 3) * TAU - Math.PI / 2);
        body.push(circle(px, py, r * 0.11, { fill: accent }));
      }
      break;
    }
    default:
      body.push(circle(cx, cy, r, { fill: fieldFill }));
  }
  body.push(
    text(o.glyph, {
      x: cx,
      y: cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': FONTS.brush,
      'font-size': r * 1.08,
      fill: glyphFill,
      lang: 'ja',
    }),
  );
  return svgDoc({ w: s, h: s, body, title: o.title, preserveAspectRatio: 'xMidYMid meet', attrs: { role: 'img' } });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Share card                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ShareCard {
  svg: string;
  texts: TextLayer[];
  w: number;
  h: number;
}

/** 1080 × 1080 washi card: the crest, 和名 in brush type, name, condition and the era date. */
export function badgeShareCard(o: { crestSvg: string; nameJa: string; nameEn: string; describe: string; day: EpochDay }): ShareCard {
  const W = 1080;
  const H = 1080;
  const vb = viewBoxOf(o.crestSvg) ?? { w: 600, h: 600 };
  const crestSize = 600;
  const crest = g({ transform: `translate(${(W - crestSize) / 2} 110) scale(${crestSize / vb.w} ${crestSize / vb.h})` }, innerOf(o.crestSvg));
  const body = [rect(0, 0, W, H, { fill: WASHI }), rect(24, 24, W - 48, H - 48, { fill: 'none', stroke: INK_WASH, 'stroke-width': 2, opacity: 0.35 }), crest];
  const describeSize = fitSize(o.describe, W - 160, 34, { min: 22, max: 30 });
  const texts: TextLayer[] = [
    { text: S.shareCardTitle, x: W / 2, y: 76, size: 24, font: FONTS.ui, fill: INK_WASH, anchor: 'middle', letterSpacing: 4, lang: 'en' },
    { text: o.nameJa, x: W / 2, y: 836, size: fitSize(o.nameJa, W - 160, 100, { min: 48, max: 96 }), font: FONTS.brush, fill: INK, anchor: 'middle', weight: 400 },
    { text: o.nameEn, x: W / 2, y: 896, size: 40, font: FONTS.ui, fill: INK, anchor: 'middle', lang: 'en' },
    { text: o.describe, x: W / 2, y: 952, size: describeSize, font: FONTS.ui, fill: INK_WASH, anchor: 'middle', lang: 'en' },
    { text: formatEraDate(o.day), x: W / 2, y: 1022, size: 26, font: FONTS.mincho, fill: INK_WASH, anchor: 'middle' },
  ];
  return { svg: svgDoc({ w: W, h: H, body, title: `${o.nameJa} ${o.nameEn}` }), texts, w: W, h: H };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function BadgeSlam(p: BadgeSlamProps): JSX.Element {
  const def = badgeDefinition(p.id);
  const reduced = p.reduced ?? prefersReducedMotion();
  const phase = useTimeline(SLAM_AT, { reduced });
  const exit = useExit(p.onDone, reduced || p.hostExit === true);
  const crest = useLazy(loadMonCrest);
  const mon = useLazy(loadMon);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = store.today();

  useEffect(() => {
    playSfx('badge');
  }, []);

  const nameJa = def?.nameJa ?? '';
  const nameEn = def?.nameEn ?? p.id;
  const describe = def?.describe ?? '';
  const tier = def?.tier ?? 'bronze';
  const field = def?.field ?? 'circle';
  const glyph = def?.glyph ?? '紋';
  const seed = hashSeed(store.seed(), 'mon', p.id);
  const fallback = (size: number): string => fallbackCrestSvg({ glyph, tier, field, size, seed, title: fill(S.badgeCrestAlt, { ja: nameJa || nameEn }) });

  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus(S.saving);
    try {
      const mon = await loadMon();
      let crestSvg: string | null = null;
      if (mon) {
        const spec = mon.MON_SPECS[p.id];
        if (spec !== undefined) {
          try {
            const s = mon.monSvg(spec, { size: 600, earned: true, seed });
            if (typeof s === 'string' && s.startsWith('<svg')) crestSvg = s;
          } catch (err) {
            console.warn('[ceremony] monSvg failed', err);
          }
        }
      }
      const card = badgeShareCard({ crestSvg: crestSvg ?? fallback(600), nameJa, nameEn, describe, day: store.today() });
      const blob = await exportPng({ svg: card.svg, texts: card.texts, width: card.w, height: card.h, background: WASHI });
      if (!blob) {
        setStatus(S.saveUnavailable);
        return;
      }
      const out = download(blob, `${S.shareFilePrefix}-${p.id}-${isoDate(store.today())}.png`);
      setStatus(out === 'download' ? S.saved : out === 'opened' ? S.savedOpened : S.saveUnavailable);
    } catch (err) {
      console.warn('[ceremony] share failed', err);
      setStatus(S.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const Crest = crest.value;
  const phaseName = SLAM_PHASES[Math.min(phase, SLAM_PHASES.length - 1)];
  const inkId = uid('slam-ink', p.id);
  // the crest in grey stone before it is earned (§7 E): mon.ts's stone image with the glyph over it in the page's brush face —
  // the real crest's own locked drawing — or the unearned fallback crest while mon.ts is not built; a static image either way
  const monMod = mon.value;
  const stone = useMemo(() => {
    if (reduced) return null;
    const spec = monMod?.MON_SPECS[p.id];
    if (monMod?.monStoneImage && spec !== undefined) {
      try {
        const img = monMod.monStoneImage(spec, { size: 200, seed: monMod.monSeed ? monMod.monSeed(p.id) : seed });
        return { kind: 'mon' as const, url: img.url, glyph: textEl(img.glyph), view: img.view };
      } catch (err) {
        console.warn('[ceremony] monStoneImage failed', err);
      }
    }
    return { kind: 'fallback' as const, url: svgDataUrl(fallbackCrestSvg({ glyph, tier, field, size: 200, seed, earned: false })), glyph: null, view: 0 };
  }, [reduced, monMod, p.id, glyph, tier, field, seed]);

  return (
    <section class={`badge-slam sheet badge-slam--${phaseName} ${verb(reduced, 'ink-nijimi')}`} data-phase={phase} data-tier={tier} data-badge={p.id} data-leaving={exit.leaving ? '' : undefined} ref={exit.ref}>
      <p class="badge-slam__eyebrow eyebrow">{S.badgeEarned}</p>
      <div class="badge-slam__stage">
        <span class="badge-slam__ink" id={inkId} aria-hidden="true" />
        {stone ? (
          <div class="badge-slam__stone" data-stone={stone.kind} aria-hidden="true">
            <img src={stone.url} alt="" decoding="async" />
            {stone.glyph ? <svg viewBox={`0 0 ${stone.view} ${stone.view}`} focusable="false" dangerouslySetInnerHTML={{ __html: stone.glyph }} /> : null}
          </div>
        ) : null}
        <div class="badge-slam__crest" data-crest={Crest ? 'mon' : 'fallback'}>
          {Crest ? <Crest id={p.id} earned size={200} describe={describe} caption={false} /> : <div class="badge-slam__fallback" dangerouslySetInnerHTML={{ __html: fallback(200) }} />}
        </div>
      </div>
      <h2 class="badge-slam__name brush" lang="ja">
        {nameJa}
      </h2>
      <p class="badge-slam__name-en">{nameEn}</p>
      <p class="badge-slam__chips">
        <span class="chip badge-slam__tier" data-tier={tier}>
          {TIER_LABEL[tier]}
        </span>
        {def ? <span class="chip chip--tag badge-slam__strand">{STRAND_LABEL[def.category]}</span> : null}
      </p>
      {describe ? <p class="badge-slam__describe muted">{describe}</p> : null}
      {phase >= 2 ? (
        <p class={`seal-date ceremony__date badge-slam__date ${verb(reduced, 'ink-nijimi')}`}>
          <span class="ceremony__era" lang="ja">
            {eraDateNodes(today)}
          </span>
          <span class="seal-date__label">{eraGloss(today)}</span>
        </p>
      ) : null}
      <div class="badge-slam__actions">
        <button type="button" class="btn badge-slam__save" onClick={() => void save()} disabled={busy} aria-busy={busy}>
          {S.saveImage}
        </button>
        <button type="button" class="hanko badge-slam__continue" onClick={exit.leave}>
          {S.continue}
        </button>
      </div>
      {status ? (
        <p class="badge-slam__status muted" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
