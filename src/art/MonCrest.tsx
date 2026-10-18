/**
 * TSUZUKU — <MonCrest>: one badge crest, inline and labelled (design 06 §2).
 *
 * Renders `monSvg` for a badge id with an accessible label, an optional
 * caption (name, the unlock condition while locked, the earned day once
 * earned) and a tooltip. Names and conditions come from `BADGE_DEFS`
 * (`store/defs-strings`); this component only adds the framing copy from
 * `./mon-strings`. The SVG uses `cssVars` so the gold ring and the accent
 * follow the page theme.
 *
 * Stone (design 09 §7 E): `stone` draws the grey-stone art for an earned crest
 * (the moment before it turns to colour; caption and label still speak the
 * truth), and `stoneImg` renders any stone as an `<img>` data URL so a grid of
 * sixty locked crests holds no live emboss filter (§6.7 rule 2). Webfonts never
 * resolve inside an image (07 §8), so the glyph is left out of the data URL
 * and set over it as inline `<text>` in the page's Yuji face (`mon.ts
 * monStoneImage`). `stoneLeaving` keeps the stone layer mounted over the
 * colour art under kasure, so a reveal reads as stone turning to colour.
 * `svgClass` reaches the art box for the press / wet-ink verbs. `dateGloss`
 * is the Latin reading of the era date ("Reiwa 8 · Oct 18", §3.3): shown
 * under the date in pixel, appended to the label and tooltip.
 *
 *  <MonCrest id="kyoto" earned size={128} earnedOn={day} />
 *  <MonCrest id="zen" earned={false} />            // grey stone + condition
 *  <MonCrest id="ippon" earned slam caption={false} />   // ceremony use
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { BadgeId } from '../shared/catalog';
import type { EpochDay } from '../shared/store-types';
import { formatEraDate, isoDate } from '../shared/time';
import { BADGE_DEFS } from '../store';
import type { Theme } from './color';
import { textEl } from './jtext';
import { MON_SPECS, MON_VIEW, clampMonSize, monSeed, monStoneImage, monSvg } from './mon';
import { S } from './mon-strings';
import { fill } from './strings';
import './MonCrest.css';

export interface MonCrestProps {
  id: BadgeId;
  earned: boolean;
  /** Rendered px (default 96; design range 48–256). */
  size?: number;
  /** Condition text for a locked crest; defaults to the badge's own rule. */
  describe?: string;
  /** Day the badge was earned → tooltip and caption date (Japanese era format). */
  earnedOn?: EpochDay;
  /** Show the caption under the crest (default true). */
  caption?: boolean;
  /** Add the hanko-slam entrance (−6°, 300 ms; opacity-only under reduced motion). */
  slam?: boolean;
  /** Theme the hex fallbacks are resolved for (the inline crest follows CSS tokens anyway). */
  theme?: Theme;
  /** Draw the stone art although earned (moment E: stone before colour). */
  stone?: boolean;
  /** Render stone as an `<img>` data URL: one rasterised emboss, no live filter. */
  stoneImg?: boolean;
  /** Colour art with the stone image still over it, drying out (kasure): the stone-to-colour crossfade. Needs `stoneImg`. */
  stoneLeaving?: boolean;
  /** Extra classes on the art box (`.mon__svg`), e.g. the press / wet-ink verbs. */
  svgClass?: string;
  /** Latin reading of the era date (`Reiwa 8 · Oct 18`), shown under `.mon__date` and in the label / tooltip. */
  dateGloss?: string;
  class?: string;
}

export const MON_DEFAULT_SIZE = 96;
export const MON_SLAM_CLASS = 'mon--slam';

const BY_ID = new Map(BADGE_DEFS.map((d) => [d.id, d] as const));

export interface MonCrestText {
  nameEn: string;
  nameJa: string;
  /** The unlock rule in plain words. */
  condition: string;
  /** `令和8年10月17日` when `earnedOn` is known. */
  date: string | null;
  /** aria-label for the crest. */
  label: string;
  /** `title` tooltip. */
  tooltip: string;
}

/** Every string the component shows, so hosts (BadgeSlam, MonGrid) can reuse them. */
export function monCrestText(p: Pick<MonCrestProps, 'id' | 'earned' | 'describe' | 'earnedOn' | 'dateGloss'>): MonCrestText {
  const def = BY_ID.get(p.id);
  const nameEn = def?.nameEn ?? p.id;
  const nameJa = def?.nameJa ?? '';
  const condition = p.describe ?? def?.describe ?? S.notYet;
  const date = p.earnedOn === undefined ? null : formatEraDate(p.earnedOn);
  const dateRead = date && p.dateGloss ? `${date} · ${p.dateGloss}` : date;
  const name = nameJa ? `${nameEn} ${nameJa}` : nameEn;
  let label: string;
  let tooltip: string;
  if (p.earned) {
    label = dateRead ? fill(S.crestEarnedOn, { name, date: dateRead }) : fill(S.crestEarned, { name });
    tooltip = dateRead ? fill(S.earnedOn, { date: dateRead }) : nameEn;
  } else {
    label = fill(S.crestLocked, { name, condition });
    tooltip = condition;
  }
  return { nameEn, nameJa, condition, date, label, tooltip };
}

export function MonCrest(p: MonCrestProps): JSX.Element {
  const size = clampMonSize(p.size ?? MON_DEFAULT_SIZE);
  const spec = MON_SPECS[p.id];
  const t = monCrestText(p);
  const stone = !p.earned || p.stone === true;
  const asImg = stone && p.stoneImg === true;
  const leaving = !stone && p.stoneImg === true && p.stoneLeaving === true;
  const svg = useMemo(
    () => (asImg ? '' : monSvg(spec, { size, earned: !stone, seed: monSeed(p.id), theme: p.theme, cssVars: true })),
    [spec, size, stone, asImg, p.id, p.theme],
  );
  const image = useMemo(() => (asImg || leaving ? monStoneImage(spec, { size, seed: monSeed(p.id) }) : null), [spec, size, asImg, leaving, p.id]);
  const classes = ['mon', p.earned ? 'mon--earned' : 'mon--locked', `mon--${spec.ring}`, p.slam ? MON_SLAM_CLASS : '', p.class ?? ''].filter(Boolean).join(' ');
  const svgClasses = ['mon__svg', p.svgClass ?? ''].filter(Boolean).join(' ');
  const showCaption = p.caption ?? true;
  const box = { width: `${size}px`, height: `${size}px` };
  // the stone image with its glyph set over it in the page's brush face (an image resolves no webfont)
  const stoneLayer = image ? (
    <div class={leaving ? 'mon__stone ink-kasure' : 'mon__stone'} data-leaving={leaving ? '' : undefined}>
      <img class="mon__img" src={image.url} alt="" width={size} height={size} decoding="async" />
      <svg class="mon__text" viewBox={`0 0 ${MON_VIEW} ${MON_VIEW}`} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: textEl(image.glyph) }} />
    </div>
  ) : null;
  return (
    <figure class={classes} data-badge={p.id} data-tier={spec.ring} data-earned={p.earned ? 'true' : 'false'} data-stone={stone ? '' : undefined} title={t.tooltip}>
      {asImg ? (
        <div class={svgClasses} role="img" aria-label={t.label} style={box}>
          {stoneLayer}
        </div>
      ) : leaving ? (
        <div class={svgClasses} role="img" aria-label={t.label} style={box}>
          <div class="mon__colour" dangerouslySetInnerHTML={{ __html: svg }} />
          {stoneLayer}
        </div>
      ) : (
        <div class={svgClasses} role="img" aria-label={t.label} style={box} dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      {showCaption && (
        <figcaption class="mon__caption">
          <span class="mon__name">{t.nameEn}</span>
          {t.nameJa && (
            <span class="mon__ja" lang="ja">
              {t.nameJa}
            </span>
          )}
          {!p.earned && <span class="mon__condition">{t.condition}</span>}
          {p.earned && p.earnedOn !== undefined && (
            <time class="mon__date" lang="ja" dateTime={isoDate(p.earnedOn)}>
              {t.date}
            </time>
          )}
          {p.earned && p.earnedOn !== undefined && p.dateGloss ? <span class="mon__gloss">{p.dateGloss}</span> : null}
        </figcaption>
      )}
    </figure>
  );
}
