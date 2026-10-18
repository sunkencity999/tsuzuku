/**
 * TSUZUKU — kakejiku 'fifty-three' 五十三次 (design 06 §3). Living piece.
 *
 * An ukiyo-e road map: a kon bokashi sky with trailing cloud bands, three
 * layered noise ridges, pines from a `<pattern>`, and the road winding
 * from 江戸 to 京 past 53 markers. Cleared stations carry a shu goshuin
 * (eroded seal frame, slight tilt, the station's first kanji); the next
 * station glows as a lantern; the learner's position is a traveller under
 * a kasa. Station names from `content/types STATIONS` label every fifth
 * post, the ends, the current and the cleared ones. Re-rendered from
 * current state (`living: true`).
 *
 * Seed → ridges, road jitter, cloud bands, pine offsets, seal tilt and
 * roundness. Title, name, position line and date are `TextLayer`s.
 */
import { STATIONS } from '../../content/types';
import { hashSeed, mulberry32, uniform } from '../../shared/hash';
import { sealFrame } from '../brush';
import { INK, INK_WASH, PALETTE, WARM, WASHI, WASHI_LIGHT, alpha, beltColor, darken, mix } from '../color';
import { chaikin, resample, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, layoutInBox, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { circle, el, g, line, linearGradient, path, pattern, polygon, polyPath, radialGradient, rect, svgDoc, text, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-1';

const P = 'ft';
const N_STATIONS = 53;

export function pine(x: number, y: number, s: number, fill: string): string {
  return (
    path(`M${(x - s * 0.08).toFixed(1)} ${y.toFixed(1)}h${(s * 0.16).toFixed(1)}v${(-s * 0.45).toFixed(1)}h${(-s * 0.16).toFixed(1)}Z`, { fill }) +
    el('ellipse', { cx: x, cy: y - s * 0.5, rx: s * 0.5, ry: s * 0.2, fill }) +
    el('ellipse', { cx: x - s * 0.18, cy: y - s * 0.72, rx: s * 0.36, ry: s * 0.16, fill }) +
    el('ellipse', { cx: x + s * 0.1, cy: y - s * 0.9, rx: s * 0.26, ry: s * 0.13, fill })
  );
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 44 : 40);
  const kon = PALETTE.light.kon;
  const shu = PALETTE.light.shu;
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];

  /* Paper, bokashi sky, cloud bands */
  defs.push(linearGradient(`${P}-paper`, [[0, WASHI_LIGHT], [1, WASHI]]));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-paper`) }));
  const skyH = h * (phone ? 0.2 : 0.26);
  defs.push(linearGradient(`${P}-sky`, [[0, mix(kon, WASHI, 0.1)], [0.6, mix(kon, WASHI, 0.65), 0.7], [1, WASHI, 0]]));
  body.push(rect(0, 0, w, skyH, { fill: url(`${P}-sky`) }));
  const clouds = 3 + Math.floor(uniform(rng, 0, 3));
  for (let i = 0; i < clouds; i++) {
    const cy = h * uniform(rng, 0.08, phone ? 0.3 : 0.4);
    const cw = w * uniform(rng, 0.3, 0.65);
    const cx = uniform(rng, -cw * 0.3, w - cw * 0.7);
    const ch = h * (phone ? 0.014 : 0.024);
    body.push(rect(cx, cy, cw, ch, { rx: ch / 2, fill: WASHI_LIGHT, stroke: alpha(kon, 0.5), 'stroke-width': 1.5 }));
    body.push(rect(cx + cw * 0.12, cy - ch * 0.7, cw * 0.5, ch * 0.8, { rx: ch * 0.4, fill: WASHI_LIGHT, stroke: alpha(kon, 0.5), 'stroke-width': 1.5 }));
  }

  /* Ridges (far → near) with pines */
  const pineFill = darken(kon, 0.25);
  const tile = phone ? 76 : 66;
  defs.push(pattern(`${P}-pines`, tile, tile * 0.9, [pine(tile * 0.25, tile * 0.55, tile * 0.3, pineFill), pine(tile * 0.72, tile * 0.86, tile * 0.24, pineFill)], { patternTransform: `translate(${uniform(rng, 0, tile).toFixed(1)} 0)` }));
  const ridgeColors = [mix(kon, WASHI, 0.55), mix(kon, WASHI, 0.32), mix(kon, '#4E8A3C', 0.35)];
  const bases = phone ? [0.34, 0.5, 0.72] : [0.46, 0.62, 0.84];
  const PTS = 64;
  for (let i = 0; i < 3; i++) {
    const amp = h * (phone ? [0.09, 0.08, 0.07][i]! : [0.16, 0.13, 0.11][i]!);
    const hs = ridge(hashSeed(seed, 'ridge', i), PTS, amp, { roughness: 0.32 });
    const base = h * bases[i]!;
    const poly: Pt[] = hs.map((v, k) => [(-0.02 + (1.04 * k) / (PTS - 1)) * w, base - v]);
    poly.push([w * 1.02, h + 2], [-w * 0.02, h + 2]);
    body.push(polygon(poly, { fill: ridgeColors[i]! }));
    body.push(polygon(poly, { fill: url(`${P}-pines`), opacity: i === 0 ? 0.18 : i === 1 ? 0.3 : 0.42 }));
    body.push(path(polyPath(poly.slice(0, PTS)), { fill: 'none', stroke: alpha(darken(kon, 0.4), 0.6), 'stroke-width': 2 }));
  }
  // the near ground the road runs on
  const groundY = h * (phone ? 0.78 : 0.88);
  body.push(rect(-4, groundY, w + 8, h - groundY + 4, { fill: mix(WASHI, '#8A5A2B', 0.18) }));

  /* The road: an S-curve across (desktop) or a switchback down (phone) */
  const way: Pt[] = phone
    ? [
        [w * 0.12, h * 0.31],
        [w * 0.88, h * 0.4],
        [w * 0.12, h * 0.51],
        [w * 0.88, h * 0.62],
        [w * 0.12, h * 0.72],
        [w * 0.88, h * 0.81],
      ]
    : [
        [w * 0.04, h * 0.68],
        [w * 0.18, h * 0.58],
        [w * 0.34, h * 0.76],
        [w * 0.5, h * 0.6],
        [w * 0.66, h * 0.78],
        [w * 0.82, h * 0.6],
        [w * 0.96, h * 0.7],
      ];
  const jittered = way.map(([x, y], i) => (i === 0 || i === way.length - 1 ? [x, y] : [x + uniform(rng, -w * 0.03, w * 0.03), y + uniform(rng, -h * 0.03, h * 0.03)]) as Pt);
  const smooth = chaikin(jittered, 4);
  const roadW = phone ? 22 : 18;
  body.push(path(polyPath(smooth), { fill: 'none', stroke: darken(mix(WASHI, '#8A5A2B', 0.3), 0.3), 'stroke-width': roadW + 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  body.push(path(polyPath(smooth), { fill: 'none', stroke: WASHI_LIGHT, 'stroke-width': roadW, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  body.push(path(polyPath(smooth), { fill: 'none', stroke: alpha(INK, 0.35), 'stroke-width': 1.5, 'stroke-dasharray': '10 14' }));
  const posts = resample(smooth, N_STATIONS);

  /* Markers */
  const cleared = new Set(data.stamps);
  const current = Math.max(0, Math.min(N_STATIONS, Math.floor(data.station)));
  const next = Math.min(N_STATIONS, Math.max(1, (data.stamps.length ? Math.max(...data.stamps) : 0) + 1));
  const sealSize = phone ? 40 : 34;
  const labelSize = phone ? 24 : 20;
  const sRng = mulberry32(hashSeed(seed, 'seals'));
  defs.push(radialGradient(`${P}-lantern`, [[0, WARM, 0.9], [0.5, WARM, 0.3], [1, WARM, 0]]));
  const labels: string[] = [];
  const markers: string[] = [];
  for (let n = 1; n <= N_STATIONS; n++) {
    const p = posts[n - 1]!;
    const st = STATIONS[n - 1]!;
    const above = n % 2 === 1;
    if (cleared.has(n)) {
      const tilt = uniform(sRng, -8, 8);
      const round = sRng() < 0.35;
      const x = p[0] - sealSize / 2;
      const y = p[1] - sealSize / 2;
      markers.push(
        g({ transform: `rotate(${tilt.toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)})` }, [
          path(sealFrame({ x, y, size: sealSize, round, seed: hashSeed(seed, 'seal', n), stroke: sealSize * 0.09, erode: 0.016 }), { fill: shu, 'fill-rule': 'evenodd' }),
          text(Array.from(st.nameJa)[0]!, { x: p[0], y: p[1] + sealSize * 0.04, 'font-size': sealSize * 0.5, fill: shu, 'font-family': FONTS.brush, 'text-anchor': 'middle', 'dominant-baseline': 'central', lang: 'ja' }),
        ]),
      );
    } else if (n === next) {
      markers.push(circle(p[0], p[1], sealSize * 0.9, { fill: url(`${P}-lantern`) }));
      markers.push(rect(p[0] - sealSize * 0.22, p[1] - sealSize * 0.36, sealSize * 0.44, sealSize * 0.62, { rx: sealSize * 0.2, fill: WARM, stroke: INK, 'stroke-width': 1.5 }));
      markers.push(rect(p[0] - sealSize * 0.26, p[1] - sealSize * 0.44, sealSize * 0.52, sealSize * 0.09, { fill: INK }));
    } else {
      markers.push(circle(p[0], p[1], phone ? 8 : 7, { fill: WASHI, stroke: INK_WASH, 'stroke-width': 2 }));
    }
    const labelled = n === 1 || n === N_STATIONS || n % 4 === 0 || n === current;
    if (labelled && n !== current) {
      const ly = above ? p[1] - sealSize * 0.9 : p[1] + sealSize * 0.9 + labelSize * 0.8;
      labels.push(text(st.nameJa, { x: p[0], y: ly, 'font-size': labelSize, fill: INK, 'text-anchor': 'middle' }));
    }
  }
  body.push(g(undefined, markers));
  body.push(g({ 'font-family': FONTS.mincho, lang: 'ja' }, labels));

  /* Edo and Kyoto cartouches at the ends */
  const endBox = (p: Pt, label: string, dx: number): void => {
    const bw = labelSize * 2.2;
    const bh = labelSize * 1.5;
    const x = p[0] + dx - bw / 2;
    const y = p[1] - (phone ? sealSize * 2.1 : sealSize * 2.3) - bh;
    body.push(rect(x, y, bw, bh, { fill: kon, rx: 3 }));
    body.push(text(label, { x: x + bw / 2, y: y + bh * 0.7, 'font-size': labelSize, fill: WASHI_LIGHT, 'font-family': FONTS.mincho, 'text-anchor': 'middle', lang: 'ja' }));
  };
  endBox(posts[0]!, S.edo, phone ? 0 : labelSize * 1.2);
  endBox(posts[N_STATIONS - 1]!, S.kyoto, phone ? 0 : -labelSize * 1.2);

  /* The traveller at the current station */
  const here = current >= 1 ? posts[current - 1]! : posts[0]!;
  const tH = phone ? 64 : 54;
  body.push(el('ellipse', { cx: here[0], cy: here[1] + 4, rx: tH * 0.3, ry: tH * 0.08, fill: alpha(INK, 0.3) }));
  body.push(rect(here[0] - tH * 0.14, here[1] - tH * 0.62, tH * 0.28, tH * 0.6, { rx: tH * 0.08, fill: kon }));
  body.push(polygon([[here[0] - tH * 0.42, here[1] - tH * 0.58], [here[0], here[1] - tH * 0.98], [here[0] + tH * 0.42, here[1] - tH * 0.58]], { fill: INK }));
  body.push(line(here[0] + tH * 0.26, here[1] - tH * 1.05, here[0] + tH * 0.26, here[1], { stroke: darken('#8A5A2B', 0.2), 'stroke-width': 3 }));
  body.push(circle(here[0], here[1], tH * 0.5, { fill: 'none', stroke: beltColor(data.belt), 'stroke-width': 3, opacity: 0.9 }));

  /* Title and name cartouches, position line, date */
  const cw = phone ? 90 : 78;
  const ch = phone ? 330 : 300;
  const right = phone ? true : rng() < 0.5;
  const cx0 = right ? safe.x + safe.w - cw - (phone ? 20 : 30) : safe.x + (phone ? 20 : 30);
  const cy0 = safe.y + (phone ? 20 : 28);
  body.push(rect(cx0, cy0, cw, ch, { fill: WASHI_LIGHT, stroke: kon, 'stroke-width': 3 }));
  body.push(rect(cx0 + 6, cy0 + 6, cw - 12, ch - 12, { fill: 'none', stroke: alpha(INK, 0.35), 'stroke-width': 1 }));
  texts.push(layoutInBox(WALLPAPER_NAMES['fifty-three'].ja, { x: cx0 + cw * 0.15, y: cy0 + 22, w: cw * 0.7, h: ch - 44 }, { font: FONTS.mincho, fill: INK, vertical: true, max: cw * 0.62, weight: 600 }));
  const nx = right ? cx0 - cw * 0.85 - 14 : cx0 + cw + 14;
  const nh = Math.min(ch, Math.max(120, Array.from(data.nameKana).length * cw * 0.55 + 50));
  body.push(rect(nx, cy0, cw * 0.85, nh, { fill: WASHI_LIGHT, stroke: beltColor(data.belt), 'stroke-width': 3 }));
  texts.push(layoutInBox(data.nameKana, { x: nx + cw * 0.14, y: cy0 + 20, w: cw * 0.57, h: nh - 40 }, { font: FONTS.brush, fill: INK, vertical: true, max: cw * 0.52, weight: 600 }));

  const ds = phone ? 28 : 24;
  const ps = phone ? 32 : 28;
  const stName = current >= 1 ? STATIONS[current - 1]!.nameJa : S.edo;
  const posText = current >= 1 ? `${S.here}　${S.stationNo}${current}${S.stationSuffix}　${stName}` : `${S.here}　${S.edo}　${S.departure}`;
  const dayText = `${data.totalDays}${S.dayCount}　${eraDate(data.date)}`;
  const px = right ? safe.x + (phone ? 20 : 30) : safe.x + safe.w - (phone ? 20 : 30);
  const anchor = right ? 'start' : 'end';
  const baseY = safe.y + safe.h - ds * 0.3;
  body.push(rect(right ? px - 12 : px - w * 0.42 + 12, baseY - ps * 2.6, w * 0.42, ps * 3.2, { fill: alpha(WASHI_LIGHT, 0.82), rx: 4 }));
  texts.push({ text: posText, x: px, y: baseY - ds * 1.5, size: Math.min(ps, fitSize(posText, w * 0.4, ps, { max: ps })), font: FONTS.mincho, fill: INK, anchor, weight: 600, lang: 'ja' });
  texts.push({ text: dayText, x: px, y: baseY, size: Math.min(ds, fitSize(dayText, w * 0.4, ds, { max: ds })), font: FONTS.mincho, fill: INK_WASH, anchor, lang: 'ja' });

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['fifty-three'].en, attrs: { 'data-piece': 'fifty-three' } });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: 'fifty-three', compose, living: true };
