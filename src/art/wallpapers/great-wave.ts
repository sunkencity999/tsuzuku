/**
 * TSUZUKU — kakejiku 'great-wave' 文字の大波 (design 06 §3).
 *
 * An original woodblock wave in the ukiyo-e tradition: a back slope rising
 * to a crest that curls over a log-spiral tube and hangs its foam claws
 * above the trough. The body of the wave is made of ~600 glyphs, the
 * learner's Mastered kana and kanji, strongest first: the strongest ride
 * the crest spiral as white foam, the rest fill the body in concentric
 * noise bands whose rhythm sets glyph size and tint. Kon water, washi sky
 * with a bokashi band, a far peak, a title cartouche, the learner's name
 * in a second cartouche and the chosen kanji on a shu seal.
 *
 * Seed → crest position and radius, band rhythm, foam, far waves, glyph
 * jitter. Name, title, kanji and date are `TextLayer`s.
 */
import { hashSeed, mulberry32, uniform } from '../../shared/hash';
import { brushStroke, PRESSURE, sealFrame } from '../brush';
import { FOAM, INK, INK_WASH, PALETTE, WASHI, WASHI_LIGHT, alpha, beltColor, darken, lighten, mix, mixOklab } from '../color';
import { bezierPoint, pointInPolygon, polygonArea, type Pt } from '../geom';
import { FONTS, eraDate, layoutInBox, type TextLayer } from '../jtext';
import { fbm, simplex2 } from '../noise';
import { circle, g, linearGradient, path, polyPath, polygon, rect, svgDoc, text, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';

const P = 'gw';
const TARGET_GLYPHS = 600;

interface Wave {
  outline: Pt[];
  center: Pt;
  R: number;
  apex: Pt;
  lip: Pt;
  trough: number;
}

function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) out.push(bezierPoint(p0, c1, c2, p1, i / n));
  return out;
}

/** The wave outline (closed polygon) for a crest at `apex` with curl radius `R`, rising from `backX` over a sea at `seaY`, on a `w`-wide canvas. */
export function wave(apex: Pt, R: number, seaY: number, backX: number, w: number, h: number, wobble: (x: number, y: number) => number): Wave {
  const [ax, ay] = apex;
  const center: Pt = [ax, ay + R];
  const trough = seaY + R * 0.3;
  const pts: Pt[] = [[backX, h + 4], [backX, seaY + R * 0.45]];
  // back slope: a long concave climb to the apex
  pts.push(...cubic([backX, seaY + R * 0.45], [backX + (ax - backX) * 0.3, seaY + R * 0.3], [ax - R * 0.9, ay + R * 0.1], apex, 40));
  // outer arc of the curl, with hand-cut wobble
  const lipAngle = 0.42 * Math.PI;
  let lip: Pt = apex;
  for (let i = 1; i <= 30; i++) {
    const th = -Math.PI / 2 + (i / 30) * (Math.PI / 2 + lipAngle);
    const r = R * (1 + 0.05 * wobble(Math.cos(th) * 2, Math.sin(th) * 2));
    lip = [center[0] + r * 1.08 * Math.cos(th), center[1] + r * Math.sin(th)];
    pts.push(lip);
  }
  // tube ceiling: the spiral tightens inward
  for (let i = 1; i <= 22; i++) {
    const k = i / 22;
    const th = lipAngle + k * (Math.PI - lipAngle);
    const r = R * (0.92 - 0.46 * k);
    pts.push([center[0] + r * Math.cos(th), center[1] + r * Math.sin(th)]);
  }
  // face: down to the foot, slightly concave
  const foot: Pt = [center[0] - R * 0.42, trough];
  const faceTop = pts[pts.length - 1]!;
  pts.push(...cubic(faceTop, [faceTop[0] - R * 0.18, faceTop[1] + (trough - faceTop[1]) * 0.35], [foot[0] - R * 0.1, trough - R * 0.15], foot, 12));
  // trough and swell to the right edge
  for (let i = 1; i <= 24; i++) {
    const k = i / 24;
    const x = foot[0] + (w * 1.05 - foot[0]) * k;
    const y = trough - Math.sin(k * Math.PI) * R * 0.18 - R * 0.06 * wobble(k * 5, 7);
    pts.push([x, y]);
  }
  pts.push([w * 1.05, h + 4]);
  return { outline: pts, center, R, apex, lip, trough };
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 44 : 40);
  const kon = PALETTE.light.kon;
  const konLight = PALETTE.dark.kon;
  const shu = PALETTE.light.shu;
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];
  const noise = fbm(simplex2(hashSeed(seed, 'bands')), 3);

  /* Paper and bokashi sky */
  defs.push(linearGradient(`${P}-paper`, [[0, WASHI_LIGHT], [1, WASHI]]));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-paper`) }));
  defs.push(linearGradient(`${P}-bokashi`, [[0, mix(kon, WASHI, 0.15)], [0.55, mix(kon, WASHI, 0.7), 0.6], [1, WASHI, 0]]));
  body.push(rect(0, 0, w, h * (phone ? 0.26 : 0.3), { fill: url(`${P}-bokashi`) }));

  /* Geometry */
  const seaY = h * (phone ? 0.56 : 0.56);
  const ax = w * (phone ? uniform(rng, 0.38, 0.48) : uniform(rng, 0.34, 0.46));
  const R = phone ? h * uniform(rng, 0.15, 0.17) : h * uniform(rng, 0.2, 0.24);
  const ay = seaY - R * 2.05;
  const main = wave([ax, ay], R, seaY, -w * 0.05, w, h, noise);
  const seaLevel = main.trough - R * 0.06;

  /* Far peak (generic), the sea, a smaller far crest on the right */
  const peakX = w * uniform(rng, 0.68, 0.8);
  const peakH = h * (phone ? 0.06 : 0.09);
  body.push(polygon([[peakX - peakH * 2.3, seaLevel], [peakX, seaLevel - peakH], [peakX + peakH * 2.3, seaLevel]], { fill: mix(kon, WASHI, 0.45) }));
  body.push(polygon([[peakX - peakH * 0.5, seaLevel - peakH * 0.78], [peakX, seaLevel - peakH], [peakX + peakH * 0.5, seaLevel - peakH * 0.78], [peakX + peakH * 0.2, seaLevel - peakH * 0.7], [peakX - peakH * 0.2, seaLevel - peakH * 0.72]], { fill: WASHI_LIGHT }));
  defs.push(linearGradient(`${P}-sea`, [[0, mix(konLight, kon, 0.5)], [1, darken(kon, 0.35)]]));
  body.push(rect(-4, seaLevel, w + 8, h - seaLevel + 4, { fill: url(`${P}-sea`) }));
  const farR = R * uniform(rng, 0.3, 0.4);
  const farX = w * uniform(rng, 0.8, 0.9);
  const far = wave([farX, seaLevel - farR * 1.9], farR, seaLevel - farR * 0.3, farX - farR * 3.2, w, h, noise);
  body.push(polygon(far.outline, { fill: mix(kon, konLight, 0.5), stroke: darken(kon, 0.5), 'stroke-width': 1.5 }));
  /* Main wave body */
  defs.push(linearGradient(`${P}-wave`, [[0, mix(konLight, kon, 0.35)], [1, darken(kon, 0.45)]]));
  body.push(polygon(main.outline, { fill: url(`${P}-wave`) }));
  body.push(path(polyPath(main.outline, true), { fill: 'none', stroke: darken(kon, 0.6), 'stroke-width': phone ? 3 : 2.5, 'stroke-linejoin': 'round' }));
  // sea bands
  let bands = '';
  for (let b = 0; b < 7; b++) {
    const y0 = main.trough + (b + 1) * ((h - main.trough) / 8);
    let d = '';
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * w;
      const y = y0 + noise(x / w * 6 + b, b * 3) * R * 0.25;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    bands += d;
  }
  body.push(path(bands, { fill: 'none', stroke: lighten(kon, 0.35), 'stroke-width': phone ? 5 : 4, opacity: 0.4 }));


  /* Glyph supply, strongest first */
  const supply = [...data.mastered.kanji, ...data.mastered.kana].filter((s) => s.length > 0);
  const glyphAt = (i: number): string => (supply.length ? supply[i % supply.length]! : '波');
  const glyphs: string[] = [];
  let used = 0;

  // the crest: three arcs of white foam glyphs riding the curl
  const { center, R: Rm } = main;
  const crestArcs = [0.97, 0.8, 0.63];
  for (let a = 0; a < crestArcs.length; a++) {
    const r = Rm * crestArcs[a]!;
    const sz = (phone ? 30 : 34) - a * 6;
    const th0 = -Math.PI * 0.62;
    const th1 = 0.3 * Math.PI;
    const n = Math.max(4, Math.floor((r * (th1 - th0)) / (sz * 1.05)));
    for (let i = 0; i <= n; i++) {
      const th = th0 + ((th1 - th0) * i) / n;
      const x = center[0] + r * Math.cos(th);
      const y = center[1] + r * Math.sin(th);
      if (!pointInPolygon([x, y], main.outline)) continue;
      glyphs.push(text(glyphAt(used++), { x, y, 'font-size': sz, fill: FOAM, transform: `rotate(${((th * 180) / Math.PI + 90).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` }));
    }
  }

  // the body: a jittered grid, kept inside the outline, sized and tinted by concentric noise bands;
  // below the trough the same glyphs thin out into small, dim water texture
  const waveArea = Math.max(1, Math.abs(polygonArea(main.outline)) - w * 1.1 * (h + 4 - main.trough));
  const cell = Math.sqrt(waveArea / Math.max(60, TARGET_GLYPHS * 0.78 - used));
  const gRng = mulberry32(hashSeed(seed, 'grid'));
  const candidates: { p: Pt; s: number; band: number }[] = [];
  const inside = (p: Pt, s: number): boolean => pointInPolygon(p, main.outline) && pointInPolygon([p[0], p[1] - s * 0.5], main.outline) && pointInPolygon([p[0], p[1] + s * 0.5], main.outline);
  for (let y = main.apex[1] - Rm * 0.1; y < main.trough + Rm * 0.1; y += cell) {
    for (let x = -w * 0.04; x < w * 1.04; x += cell) {
      const p: Pt = [x + uniform(gRng, -cell * 0.3, cell * 0.3), y + uniform(gRng, -cell * 0.3, cell * 0.3)];
      const d = Math.hypot(p[0] - center[0], p[1] - center[1]) / Rm;
      const band = 0.5 + 0.5 * Math.sin((d * 3.2 + 0.7 * noise(p[0] / w * 4, p[1] / h * 4)) * Math.PI * 2);
      const s = cell * (0.55 + 0.6 * band);
      if (p[1] > main.trough + Rm * 0.1 || !inside(p, s)) continue;
      candidates.push({ p, s, band });
    }
  }
  const seaCell = cell * 1.9;
  for (let y = main.trough + Rm * 0.1 + seaCell * 0.5; y < h; y += seaCell) {
    for (let x = -w * 0.04; x < w * 1.04; x += seaCell) {
      if (candidates.length >= TARGET_GLYPHS + 40) break;
      const p: Pt = [x + uniform(gRng, -seaCell * 0.35, seaCell * 0.35), y + uniform(gRng, -seaCell * 0.3, seaCell * 0.3)];
      const s = cell * 0.5;
      if (!inside(p, s)) continue;
      candidates.push({ p, s, band: 0.2 });
    }
  }
  candidates.sort((a, b) => b.s - a.s || a.p[1] - b.p[1] || a.p[0] - b.p[0]);
  for (const c of candidates) {
    const below = c.p[1] > main.trough + Rm * 0.1;
    const nearCrest = !below && Math.hypot(c.p[0] - center[0], c.p[1] - center[1]) > Rm * 0.84 && c.p[1] < center[1] + Rm * 0.5;
    const fill = nearCrest ? FOAM : mixOklab(lighten(kon, 0.25), WASHI_LIGHT, c.band);
    glyphs.push(text(glyphAt(used++), { x: c.p[0], y: c.p[1], 'font-size': c.s, fill, opacity: below ? 0.28 : nearCrest ? 1 : 0.82 + 0.18 * c.band }));
  }
  body.push(g({ 'font-family': FONTS.mincho, 'text-anchor': 'middle', 'dominant-baseline': 'central', lang: 'ja' }, glyphs));

  /* Foam: claws along the lip, droplets below */
  const claws: string[] = [];
  const fRng = mulberry32(hashSeed(seed, 'foam'));
  const nClaws = phone ? 8 : 10;
  for (let i = 0; i < nClaws; i++) {
    const th = -Math.PI * 0.35 + (i / (nClaws - 1)) * (0.68 * Math.PI);
    const p0: Pt = [center[0] + Rm * 1.0 * Math.cos(th), center[1] + Rm * 1.0 * Math.sin(th)];
    const tangent: Pt = [-Math.sin(th), Math.cos(th)];
    const len = Rm * uniform(fRng, 0.14, 0.26) * (1 - Math.abs(i / (nClaws - 1) - 0.6));
    const spine: Pt[] = [
      [p0[0] - tangent[0] * len * 0.3, p0[1] - tangent[1] * len * 0.3],
      p0,
      [p0[0] + tangent[0] * len * 0.6 + Math.cos(th) * len * 0.25, p0[1] + tangent[1] * len * 0.6 + Math.sin(th) * len * 0.25],
      [p0[0] + tangent[0] * len + Math.cos(th) * len * 0.15, p0[1] + tangent[1] * len + Math.sin(th) * len * 0.35],
    ];
    claws.push(path(brushStroke(spine, { width: Rm * 0.09, pressure: PRESSURE.taper, seed: hashSeed(seed, 'claw', i), bristle: 0.3 }), { fill: FOAM }));
  }
  let drops = '';
  for (let i = 0; i < (phone ? 40 : 56); i++) {
    const th = uniform(fRng, -0.3 * Math.PI, 0.5 * Math.PI);
    const r = Rm * uniform(fRng, 1.02, 1.45);
    const x = center[0] + r * Math.cos(th);
    const y = center[1] + r * Math.sin(th);
    if (y > main.trough - 4) continue;
    const s = uniform(fRng, 2.5, 7) * (phone ? 1.1 : 1);
    drops += `M${(x + s).toFixed(1)} ${y.toFixed(1)}a${s.toFixed(1)} ${s.toFixed(1)} 0 1 1 ${(-2 * s).toFixed(1)} 0a${s.toFixed(1)} ${s.toFixed(1)} 0 1 1 ${(2 * s).toFixed(1)} 0Z`;
  }
  body.push(g(undefined, claws));
  body.push(path(drops, { fill: FOAM }));
  body.push(circle(main.lip[0], main.lip[1], Rm * 0.05, { fill: FOAM }));

  /* Cartouches: title (tategaki), name (tategaki), seal; date along the bottom */
  const belt = beltColor(data.belt);
  const cw = phone ? 96 : 84;
  const ch = phone ? 420 : 360;
  const cx0 = safe.x + safe.w - cw - (phone ? 24 : 36);
  const cy0 = safe.y + (phone ? 24 : 40);
  const cart = (x: number, y: number, hh: number, label: string, font: string, fill: string): void => {
    body.push(rect(x, y, cw, hh, { fill: WASHI_LIGHT, stroke: belt, 'stroke-width': 3 }));
    body.push(rect(x + 7, y + 7, cw - 14, hh - 14, { fill: 'none', stroke: alpha(INK, 0.35), 'stroke-width': 1 }));
    texts.push(layoutInBox(label, { x: x + cw * 0.15, y: y + 26, w: cw * 0.7, h: hh - 52 }, { font, fill, vertical: true, max: cw * 0.66, weight: 600 }));
  };
  cart(cx0, cy0, ch, WALLPAPER_NAMES['great-wave'].ja, FONTS.mincho, INK);
  const nh = Math.min(ch * 0.8, Math.max(140, Array.from(data.nameKana).length * cw * 0.6 + 60));
  cart(cx0 - cw - 18, cy0, nh, data.nameKana, FONTS.brush, INK);
  const ss = cw * 0.8;
  const sx = cx0 - cw - 18 + (cw - ss) / 2;
  const sy = cy0 + nh + 18;
  body.push(path(sealFrame({ x: sx, y: sy, size: ss, round: false, seed: hashSeed(seed, 'seal'), stroke: ss * 0.08, erode: 0.014 }), { fill: shu, 'fill-rule': 'evenodd' }));
  if (data.chosenKanji) {
    body.push(rect(sx + ss * 0.16, sy + ss * 0.16, ss * 0.68, ss * 0.68, { fill: shu, opacity: 0.92 }));
    texts.push(layoutInBox(data.chosenKanji, { x: sx + ss * 0.2, y: sy + ss * 0.2, w: ss * 0.6, h: ss * 0.6 }, { font: FONTS.brush, fill: WASHI, weight: 700 }));
  }
  const ds = phone ? 28 : 24;
  texts.push({ text: eraDate(data.date), x: safe.x + (phone ? 24 : 36), y: safe.y + safe.h - ds * 0.3, size: ds, font: FONTS.mincho, fill: mix(WASHI, INK_WASH, 0.15), opacity: 0.9, lang: 'ja' });

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['great-wave'].en, attrs: { 'data-piece': 'great-wave' } });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: 'great-wave', compose };
