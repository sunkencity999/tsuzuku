/**
 * TSUZUKU — <GoshuinStamp>: one station's goshuin, inline and labelled
 * (design 06 §4).
 *
 * Looks the station up by number, seeds the stamp from the profile seed
 * (`hashSeed(store.seed(), 'goshuin', station)`) so every learner's book is
 * their own, and renders `goshuinSvg` with `cssVars` so the vermilion, gold
 * and grey follow the page theme. `pressed` adds the stamp-press entrance
 * (`GOSHUIN_PRESS_CLASS`) that StampPress can trigger; the thump itself is
 * the host's job (`sfx('stamp')`). `img` renders the stamp as an `<img>` data
 * URL instead (design 09 §5.3): hex paints for `theme`, the turbulence
 * rasterised once, no live filter in the book (§6.7 rule 2). Webfonts never
 * resolve inside an image (07 §8), so the ordinal, name, 奉拝 and date stay
 * out of the data URL and are set over it as inline `<text>` in the page's
 * Yuji / Shippori faces (`goshuin.ts goshuinImage`). `svgClass` reaches the
 * art box for the press / wet-ink verbs, `printClass` the print inside it
 * (image + text) for an entrance. `dateGloss` is the Latin reading of the
 * era date (`Reiwa 8 · Oct 18`, §3.3): under the date, in the label and tooltip.
 *
 *  <GoshuinStamp station={7} at={day} perfect={false} assisted={false} />
 *  <GoshuinStamp station={7} at={day} perfect assisted={false} pressed size={240} />
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { hashSeed } from '../shared/hash';
import type { EpochDay } from '../shared/store-types';
import { formatEraDate, isoDate } from '../shared/time';
import { store } from '../store';
import type { Theme } from './color';
import { GOSHUIN_VIEW, clampGoshuinSize, goshuinImage, goshuinLabel, goshuinSvg, stationByNumber } from './goshuin';
import { textLayersSvg } from './jtext';
import { S } from './mon-strings';
import { fill } from './strings';
import './GoshuinStamp.css';

export interface GoshuinStampProps {
  /** Station number 1–53. */
  station: number;
  /** Day the gate was cleared. */
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
  /** Rendered px (default 160). */
  size?: number;
  /** Play the press entrance (300 ms; opacity-only under reduced motion). */
  pressed?: boolean;
  /** Show a caption (name, number · romaji, date) under the stamp (default false). */
  caption?: boolean;
  /** Draw a washi page behind the stamp (default transparent). */
  paper?: boolean;
  /** Override the seed (previews, tests); default from the profile seed. */
  seed?: number;
  /** Theme the hex fallbacks resolve for (the inline stamp follows CSS tokens anyway; an `img` stamp needs it). */
  theme?: Theme;
  /** Render as an `<img>` data URL (no live SVG filter; paints resolved for `theme`). */
  img?: boolean;
  /** Extra classes on the art box (`.goshuin__svg`). */
  svgClass?: string;
  /** Extra classes on the print inside the box (image + text; `img` only), e.g. an entrance verb. */
  printClass?: string;
  /** Latin reading of the era date (`Reiwa 8 · Oct 18`), shown under `.goshuin__date` and in the label / tooltip. */
  dateGloss?: string;
  class?: string;
}

export const GOSHUIN_DEFAULT_SIZE = 160;
export const GOSHUIN_PRESS_CLASS = 'goshuin--pressed';

/** The stamp seed of a station for a profile: stable per learner, distinct per station. */
export function goshuinSeed(station: number, profileSeed: string = store.seed()): number {
  return hashSeed(profileSeed, 'goshuin', station);
}

export function GoshuinStamp(p: GoshuinStampProps): JSX.Element {
  const size = clampGoshuinSize(p.size ?? GOSHUIN_DEFAULT_SIZE);
  const st = stationByNumber(p.station);
  const seed = p.seed ?? (st ? goshuinSeed(st.number) : 0);
  const asImg = p.img === true;
  // inline: the SVG markup; img: the data URL plus the text layers set over it in the page's own fonts
  const art = useMemo(() => {
    if (!st) return { svg: '', url: '', text: '' };
    const o = { station: st, at: p.at, perfect: p.perfect, assisted: p.assisted, seed, size, theme: p.theme, paper: p.paper };
    if (!asImg) return { svg: goshuinSvg({ ...o, cssVars: true }), url: '', text: '' };
    const image = goshuinImage(o);
    return { svg: '', url: image.url, text: textLayersSvg(image.texts) };
  }, [st, p.at, p.perfect, p.assisted, seed, size, p.theme, p.paper, asImg]);
  if (!st) {
    return (
      <figure class={['goshuin', 'goshuin--missing', p.class ?? ''].filter(Boolean).join(' ')} role="note" data-station={p.station}>
        <figcaption class="goshuin__caption">{fill(S.stampUnknown, { n: p.station })}</figcaption>
      </figure>
    );
  }
  const date = formatEraDate(p.at);
  const label = goshuinLabel(st, p.at, p.perfect, p.assisted) + (p.dateGloss ? ` ${p.dateGloss}.` : '');
  const tooltip = fill(S.stampTooltip, { n: st.number, romaji: st.nameRomaji, date: p.dateGloss ? `${date} · ${p.dateGloss}` : date });
  const classes = ['goshuin', p.perfect ? 'goshuin--perfect' : '', p.assisted ? 'goshuin--assisted' : '', p.pressed ? GOSHUIN_PRESS_CLASS : '', p.class ?? ''].filter(Boolean).join(' ');
  const svgClasses = ['goshuin__svg', p.svgClass ?? ''].filter(Boolean).join(' ');
  const printClasses = ['goshuin__print', p.printClass ?? ''].filter(Boolean).join(' ');
  const box = { width: `${size}px`, height: `${size}px` };
  return (
    <figure class={classes} data-station={st.number} data-perfect={p.perfect ? 'true' : 'false'} data-assisted={p.assisted ? 'true' : 'false'} title={tooltip}>
      {asImg ? (
        <div class={svgClasses} role="img" aria-label={label} style={box}>
          <div class={printClasses}>
            <img class="goshuin__img" src={art.url} alt="" width={size} height={size} decoding="async" />
            <svg class="goshuin__text" viewBox={`0 0 ${GOSHUIN_VIEW} ${GOSHUIN_VIEW}`} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: art.text }} />
          </div>
        </div>
      ) : (
        <div class={svgClasses} role="img" aria-label={label} style={box} dangerouslySetInnerHTML={{ __html: art.svg }} />
      )}
      {p.caption && (
        <figcaption class="goshuin__caption">
          <span class="goshuin__name" lang="ja">
            {st.nameJa}
          </span>
          <span class="goshuin__romaji">
            {st.number} · {st.nameRomaji}
          </span>
          <time class="goshuin__date" lang="ja" dateTime={isoDate(p.at)}>
            {date}
          </time>
          {p.dateGloss ? <span class="goshuin__gloss">{p.dateGloss}</span> : null}
          {p.perfect && <span class="goshuin__note">{S.stampPerfect}</span>}
          {p.assisted && <span class="goshuin__note">{S.stampAssisted}</span>}
        </figcaption>
      )}
    </figure>
  );
}
