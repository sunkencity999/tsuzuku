/**
 * TSUZUKU — `<PrintFigure>`: a woodblock print on its mat (prints B1; design
 * 09 §2.1 washi, §2.2 light — paper shading, no drop shadow — §3.1 the
 * caption's voices, §6.7 opacity-only motion).
 *
 *  - Three frames. `hero`: the Dojo's print of the day on a padded mat with
 *    its caption; a landscape fills the width at its own ratio, a portrait is
 *    shown whole in a 3 / 2 box with mat around it. `band`: the Station
 *    headpiece, 4 / 1, cover-cropped about the print's focus. `thumb`: the
 *    Road's gallery, 4 / 3 cover. `state` colours the Road: `ahead` is the
 *    ink-only print — grey and dim until the learner arrives — `here` carries
 *    the vermilion ring; nothing here says "locked".
 *  - The LQIP (a 24 px data URI from the manifest) is the box's background
 *    from first paint; the `<img>` (`./art/<file>`, width and height from the
 *    manifest so nothing shifts, deferred unless `eager`) fades in on `load`:
 *    `data-loaded` lands on the figure and the image's opacity goes 0 → 1
 *    over --dur-2 (reduced motion zeroes the token; base.css stops the
 *    transition). A print that was already complete when the element mounted
 *    (the browser cache) is marked loaded by the effect.
 *  - A print that does not arrive — a 404 after a republished pack dropped
 *    the name, a 504 offline — fires `error`: `data-failed` lands on the
 *    figure instead, the LQIP stays as the picture on purpose (the image keeps
 *    opacity 0, so no broken-image glyph), the owner's `onLoaded` is not
 *    called, and a swap to another print clears it like `data-loaded`. A
 *    broken image already complete at mount is marked the same way.
 *  - Data saver: only the LQIP and a ≥ 44 px "Show the print" button; the tap
 *    loads that one image eagerly. A `decorative` figure (a Road thumb beside
 *    its sign) has no one to ask: under the saver it keeps its preview alone —
 *    no image, no button — so the gallery is coloured for no bytes beyond the
 *    manifest.
 *  - The caption teaches: artist and title in Japanese, then artist, reading
 *    and English, then the series with its reading, its English name and the
 *    date, then the museum credit. Every Japanese string comes from the
 *    manifest at runtime; none lives in this file. Only a captioned figure is
 *    a `figure` to assistive tech: a `decorative` or uncaptioned one (every
 *    band and thumb) is `role="presentation"`, since an unnamed figure would
 *    be announced inside each of the Road's links and over the Station's sign
 *    plate (ARIA `figure` takes no name from its img) — the owner's link or
 *    the image's alt already names the picture.
 *  - The title line is set in `--font-ja` through `[lang="ja"]`, never in
 *    Mincho (09 §3.1 fence, §3.5): the manifest's glyphs are outside every
 *    shell slice, so `.mincho` here pulled ShipporiMinchoB1-base plus `rest`
 *    and the level slices — 238–830 KB a day — onto the Dojo's first paint
 *    (docs/ART_PACK.md §9). fonts.test.ts walks this file for the class.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IMG_LOADING } from './img-loading';
import { altOf, captionOf } from './select';
import { S } from './strings';
import type { PrintEntry } from './types';
import './PrintFigure.css';

export type PrintVariant = 'hero' | 'band' | 'thumb';
export type PrintState = 'passed' | 'here' | 'ahead';

export interface PrintFigureProps {
  print: PrintEntry;
  variant: PrintVariant;
  /** The Road's word for the stop (`data-state` on the figure). */
  state?: PrintState;
  /** The figcaption; default `variant === 'hero'`. */
  caption?: boolean;
  /** `loading="eager"` + `fetchpriority="high"`: the one print above the fold. */
  eager?: boolean;
  /** Only the LQIP and a button until the learner asks; with `decorative`, the LQIP alone. */
  dataSaver?: boolean;
  /** `alt=""`: the owner labels the picture itself (a Road thumb beside its sign); under the data saver, no button either. */
  decorative?: boolean;
  onLoaded?: () => void;
  /** Extra classes on the figure. */
  class?: string;
}

/** Where the manifest's `file` paths hang (page-relative, like `./audio/`). */
export const ART_ROOT = './art/';

export function printSrc(p: PrintEntry): string {
  return `${ART_ROOT}${p.file}`;
}

const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;

/** `object-position` / `background-position` for a cover crop: "50% 42%". */
export function focusPosition(p: PrintEntry): string {
  return `${pct(p.focus[0])} ${pct(p.focus[1])}`;
}

const SEP = ' · ';

export function PrintFigure(p: PrintFigureProps): JSX.Element {
  const { print, variant } = p;
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [askedId, setAskedId] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const asked = askedId === print.id;
  const shown = !p.dataSaver || asked;
  const loaded = loadedId === print.id;
  const failed = failedId === print.id;
  const eager = Boolean(p.eager) || asked;
  const caption = p.caption ?? variant === 'hero';
  const cropped = variant !== 'hero';

  const markLoaded = (): void => {
    if (loadedId === print.id) return;
    setLoadedId(print.id);
    p.onLoaded?.();
  };

  const markFailed = (): void => {
    if (failedId === print.id) return;
    setFailedId(print.id);
  };

  // a cached image can be complete before the listeners are attached: a width means it loaded, none means it broke
  useEffect(() => {
    const el = img.current;
    if (!shown || !el || !el.complete) return;
    if (el.naturalWidth > 0) markLoaded();
    else markFailed();
  }, [print.id, shown]);

  const boxStyle: JSX.CSSProperties = { backgroundImage: `url("${print.lqip}")` };
  if (cropped) boxStyle.backgroundPosition = focusPosition(print);
  else if (print.orientation === 'landscape') boxStyle.aspectRatio = `${print.width} / ${print.height}`;
  const imgStyle: JSX.CSSProperties | undefined = cropped ? { objectPosition: focusPosition(print) } : undefined;

  const c = captionOf(print);
  const reading = [c.artistEn, c.titleReading, c.titleEn].filter((x) => x.length > 0).join(SEP);
  const seriesGloss = [c.seriesReading, c.date ? `${c.seriesEn}, ${c.date}` : c.seriesEn].filter((x) => x.length > 0).join(SEP);
  const cls = `print print--${variant} print--${print.orientation}${p.class ? ` ${p.class}` : ''}`;
  // without a caption (every band and thumb) the wrapper is presentational: an unnamed `figure` would be announced inside each
  // Road link and over the Station's sign plate (ARIA `figure` takes no name from its img); the owner's link or the alt names it
  const plain = Boolean(p.decorative) || !caption;

  return (
    <figure class={cls} role={plain ? 'presentation' : undefined} data-state={p.state} data-loaded={loaded ? '' : undefined} data-failed={failed ? '' : undefined}>
      <div class="print__box" style={boxStyle}>
        {shown ? (
          <img
            ref={img}
            class="print__img"
            src={printSrc(print)}
            alt={p.decorative ? '' : altOf(print)}
            width={print.width}
            height={print.height}
            loading={eager ? IMG_LOADING.eager : IMG_LOADING.deferred}
            decoding="async"
            fetchpriority={eager ? 'high' : undefined}
            style={imgStyle}
            onLoad={markLoaded}
            onError={markFailed}
          />
        ) : p.decorative ? null : (
          <button type="button" class="btn btn--ghost print__show" onClick={() => setAskedId(print.id)}>
            {S.printShow}
          </button>
        )}
      </div>
      {caption ? (
        <figcaption class="print__caption">
          <span lang="ja" class="print__title-ja">
            {c.artistJa}
            {'《'}
            {c.titleJa}
            {'》'}
          </span>
          <span class="print__reading">{reading}</span>
          <span class="print__series">
            {S.printFrom} <span lang="ja">{c.seriesJa}</span> {seriesGloss}
          </span>
          <span class="print__source">{c.source}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
