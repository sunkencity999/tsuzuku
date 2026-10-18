/**
 * TSUZUKU — Print Studio (group G): `#/studio/:wallpaperId` (design 06 §3,
 * 07 §8).
 *
 * Live preview of one kakejiku at desktop or phone orientation, drawn from
 * the learner's own data; personalisation (a Mastered sentence of choice, the
 * seal kanji, typed sentences capped at `MAX_CUSTOM_SENTENCE` glyphs so the
 * waveform/okaeri captions stay inside their safe zones); Reforge (one new
 * brush per day per piece, cosmetic: the
 * reforge counter in `collections.wallpapers[id]` changes the seed); a
 * resolution picker (4K gated to capable desktops, hint copy matching
 * `canRender4k`); PNG export through
 * `art/png.ts` with a progress ring, a download link and copy-to-clipboard
 * where the browser supports image clipboard writes. A locked piece shows its
 * silhouette, the unlock condition and the quadrant progress instead of the
 * export controls. Print fonts load lazily for the preview.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { textLayersSvg } from '../../art/jtext';
import { canRender4k, download, exportPng, exportSizes, filenameFor, fontsOf, type DownloadOutcome, type ExportOptions } from '../../art/png';
import { WALLPAPER_NAMES } from '../../art/strings';
import { masteredItems, normalizeData } from '../../art/wallpapers/data';
import { WALLPAPERS, composeWallpaper, wallpaperSeed } from '../../art/wallpapers/index';
import type { PostPass, RenderedWallpaper, WallpaperData, WallpaperSize } from '../../art/wallpapers/spec';
import { content, type ContentLoader } from '../../content/loader';
import { toPlain } from '../../content/ruby';
import type { VocabItem } from '../../content/types';
import { WALLPAPER_IDS, type WallpaperId } from '../../shared/catalog';
import { href, type Route } from '../../shared/routes';
import { formatEraDate } from '../../shared/time';
import { WALLPAPER_DEFS, store } from '../../store';
import { gatherData, isUnlocked, progressFor, revealedFor } from '../KakejikuGallery';
import { eraGloss } from '../reveal';
import { S, fill } from '../strings';
import './StudioPage.css';

export type ClipboardWriter = (blob: Blob) => Promise<void>;

export interface StudioPageProps {
  route: Route;
  /** PNG pipeline (default `exportPng`); tests inject a recorder. */
  exporter?: (o: ExportOptions) => Promise<Blob | null>;
  /** Save step (default `download`). */
  saver?: (blob: Blob, filename: string) => DownloadOutcome;
  /** Image clipboard writer; default from `navigator.clipboard`, `null` hides the button. */
  clipboard?: ClipboardWriter | null;
  /** 4K allowed (default `canRender4k()`). */
  allow4k?: boolean;
  /** Content loader for sentence candidates (default the app loader). */
  loader?: ContentLoader;
}

export const CUSTOM_SENTENCE = '__custom__';
export const MAX_SENTENCE_CANDIDATES = 40;
/** Glyph cap for a typed sentence of choice (`maxlength` on the input and clamped again in `personalize`). */
export const MAX_CUSTOM_SENTENCE = 48;

const EFFECT_LABEL: Record<PostPass, string> = { none: S.effectNone, dither: S.effectDither, scanlines: S.effectScanlines, grain: S.effectGrain };

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export function wallpaperIdOf(route: Route): WallpaperId {
  return route.name === 'studio' && (WALLPAPER_IDS as readonly string[]).includes(route.wallpaperId) ? route.wallpaperId : WALLPAPER_IDS[0];
}

/** Example sentences of the learner's Mastered words, plain surface, unique, strongest first. */
export function sentenceCandidates(loader: ContentLoader, limit = MAX_SENTENCE_CANDIDATES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let mastered: ReturnType<typeof masteredItems>;
  try {
    mastered = masteredItems(store.cards);
  } catch {
    return out;
  }
  for (const m of [...mastered.vocab, ...mastered.chunk]) {
    const it = loader.get<VocabItem>(m.itemId);
    if (!it || !('examples' in it)) continue;
    for (const ex of it.examples) {
      const plain = toPlain(ex.ja).trim();
      if (!plain || seen.has(plain)) continue;
      seen.add(plain);
      out.push(plain);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function kanjiCandidates(profileKanji: string | undefined, mastered: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of [profileKanji ?? '', ...mastered]) if (k && Array.from(k).length === 1 && !out.includes(k)) out.push(k);
  return out;
}

export interface Personal {
  /** `''` none, `CUSTOM_SENTENCE`, or a candidate sentence. */
  sentence: string;
  custom: string;
  /** `''` = no seal. */
  kanji: string;
}

/** Trim and cap a typed sentence at `MAX_CUSTOM_SENTENCE` glyphs (code points, so a surrogate pair is never split). */
export function clampSentence(s: string, max = MAX_CUSTOM_SENTENCE): string {
  return Array.from(s.trim()).slice(0, max).join('').trim();
}

export function personalize(base: WallpaperData, p: Personal): WallpaperData {
  const sentence = p.sentence === CUSTOM_SENTENCE ? clampSentence(p.custom) : p.sentence;
  return normalizeData({ ...base, sentenceOfChoice: sentence || undefined, chosenKanji: p.kanji || undefined });
}

/** The preview document: the composition with its text layers baked in (the exporter draws them itself). */
export function previewSvg(r: RenderedWallpaper): string {
  const i = r.svg.lastIndexOf('</svg>');
  return i < 0 || r.texts.length === 0 ? r.svg : r.svg.slice(0, i) + textLayersSvg(r.texts) + r.svg.slice(i);
}

function defaultClipboard(): ClipboardWriter | null {
  if (typeof navigator === 'undefined' || typeof ClipboardItem === 'undefined') return null;
  const cb = navigator.clipboard as Clipboard | undefined;
  if (!cb || typeof cb.write !== 'function') return null;
  return (blob) => cb.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}

function defaultSize(): WallpaperSize {
  try {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches ? 'phone' : 'desktop';
  } catch {
    return 'desktop';
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pieces                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function ProgressRing(p: { pct: number }): JSX.Element {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg class="studio__ring" viewBox="0 0 48 48" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-label={fill(S.exporting, { p: p.pct })}>
      <circle class="studio__ring-track" cx="24" cy="24" r={r} />
      <circle class="studio__ring-fill" cx="24" cy="24" r={r} stroke-dasharray={`${((c * p.pct) / 100).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 24 24)" />
      <text class="studio__ring-text" x="24" y="28" text-anchor="middle">
        {p.pct}
      </text>
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function StudioPage(p: StudioPageProps): JSX.Element {
  const id = wallpaperIdOf(p.route);
  const exporter = p.exporter ?? exportPng;
  const saver = p.saver ?? download;
  const clipboard = p.clipboard === undefined ? defaultClipboard() : p.clipboard;
  const allow4k = p.allow4k ?? canRender4k();
  const loader = p.loader ?? content;

  const spec = WALLPAPERS[id];
  const def = WALLPAPER_DEFS.find((d) => d.id === id);
  const names = WALLPAPER_NAMES[id];
  const entry = store.collections.value.wallpapers[id];
  const profile = store.profile.value;
  const cardsVersion = store.cards.version.value;
  const meta = store.meta();
  const today = store.today();
  const unlocked = isUnlocked(entry);
  const revealed = def ? revealedFor(def, entry, meta, store.cards) : unlocked ? 4 : 0;
  const progress = def ? progressFor(def, meta, store.cards) : null;
  const reforges = entry?.reforges ?? 0;
  const seed = wallpaperSeed(store.seed(), id, reforges);
  const reforgedToday = entry?.lastReforgeDay === today;

  const [size, setSize] = useState<WallpaperSize>(defaultSize);
  const [resIndex, setResIndex] = useState(0);
  const [base, setBase] = useState<WallpaperData | null>(null);
  const [personal, setPersonal] = useState<Personal>({ sentence: '', custom: '', kanji: profile.chosenKanji ?? '' });
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [blob, setBlob] = useState<{ blob: Blob; filename: string; url: string | null } | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Gather the learner's data once per piece (and again when cards change while the page is open).
  useEffect(() => {
    let on = true;
    gatherData().then((d) => {
      if (on && alive.current) setBase(d);
    });
    return () => {
      on = false;
    };
  }, [id, cardsVersion]);

  // Release the last export's object URL when it is replaced or the page unmounts.
  useEffect(
    () => () => {
      if (blob?.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(blob.url);
    },
    [blob],
  );

  const sizes = useMemo(() => exportSizes(size, allow4k), [size, allow4k]);
  const resolution = sizes[Math.min(resIndex, sizes.length - 1)] ?? sizes[0] ?? [1920, 1080];
  const sentences = useMemo(() => sentenceCandidates(loader), [loader, cardsVersion]);
  const kanjiOptions = useMemo(() => kanjiCandidates(profile.chosenKanji, base?.mastered.kanji ?? []), [profile.chosenKanji, base]);

  const data = useMemo(() => (base ? personalize(base, personal) : null), [base, personal]);
  const preview = useMemo<{ rendered: RenderedWallpaper; svg: string } | 'error' | null>(() => {
    if (!data) return null;
    try {
      const rendered = composeWallpaper(spec, { seed, data, size, locked: !unlocked, revealed, post: 'svg' });
      return { rendered, svg: previewSvg(rendered) };
    } catch (err) {
      console.warn('[studio] compose failed', id, err);
      return 'error';
    }
  }, [spec, seed, data, size, unlocked, revealed]);

  // Print fonts on demand: wait for the families the text layers use (best effort; the inline SVG repaints on its own).
  useEffect(() => {
    if (preview === null || preview === 'error') return;
    const families = fontsOf(preview.rendered.texts);
    const fonts = typeof document !== 'undefined' ? (document as { fonts?: { load(spec: string): Promise<unknown> } }).fonts : undefined;
    if (families.length === 0 || !fonts || typeof fonts.load !== 'function') {
      setFontsReady(true);
      return;
    }
    let on = true;
    setFontsReady(false);
    Promise.all(families.map((f) => fonts.load(`32px "${f}"`).catch(() => undefined))).then(() => {
      if (on && alive.current) setFontsReady(true);
    });
    return () => {
      on = false;
    };
  }, [preview === null || preview === 'error' ? '' : fontsOf(preview.rendered.texts).join('|')]);

  const reforge = (): void => {
    if (!unlocked || reforgedToday) return;
    store.patch('collections', (c) => {
      const e = c.wallpapers[id];
      if (!e) return c;
      return { ...c, wallpapers: { ...c.wallpapers, [id]: { ...e, reforges: e.reforges + 1, lastReforgeDay: today } } };
    });
    setStatus(null);
  };

  const doExport = async (): Promise<void> => {
    if (!data || !unlocked || busy) return;
    setBusy(true);
    setPct(0);
    setStatus(null);
    try {
      const r = composeWallpaper(spec, { seed, data, size, locked: false, revealed: 4, post: 'raster' });
      const [w, h] = resolution;
      const out = await exporter({
        svg: r.svg,
        texts: r.texts,
        width: w,
        height: h,
        post: r.post,
        seed,
        onProgress: (q) => {
          if (alive.current) setPct(Math.round(q * 100));
        },
      });
      if (!alive.current) return;
      if (!out) {
        setStatus(S.exportUnavailable);
        return;
      }
      const filename = filenameFor(id, size, today);
      const outcome = saver(out, filename);
      const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(out) : null;
      setBlob({ blob: out, filename, url });
      setStatus(outcome === 'opened' ? S.iosHint : outcome === 'unavailable' ? S.exportUnavailable : fill(S.exported, { filename }));
    } catch (err) {
      console.warn('[studio] export failed', id, err);
      if (alive.current) setStatus(S.exportFailed);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!blob || !clipboard) return;
    try {
      await clipboard(blob.blob);
      if (alive.current) setStatus(S.copied);
    } catch {
      if (alive.current) setStatus(S.copyFailed);
    }
  };

  const effect = preview && preview !== 'error' ? preview.rendered.effect : 'none';

  return (
    <div class="studio" data-wallpaper={id} data-state={unlocked ? 'unlocked' : 'locked'} data-size={size}>
      <header class="studio__head">
        <a class="studio__back" href={href({ name: 'collections', tab: 'kakejiku' })}>
          ← {S.backToGallery}
        </a>
        <h1 class="studio__h1">
          <span class="studio__h1-ja" lang="ja">
            {names.ja}
          </span>
          <span class="studio__h1-en">{names.en}</span>
        </h1>
        <p class="studio__meta">
          <span lang="ja">{S.studioJa}</span> {S.studioTitle}
          {def?.living ? <span class="chip chip--tag">{S.livingLabel}</span> : null}
          {reforges > 0 ? <span class="chip">{fill(S.brushLabel, { n: reforges + 1 })}</span> : null}
          <span class="chip">{`${S.effectLabel}: ${EFFECT_LABEL[effect]}`}</span>
        </p>
      </header>

      <section class="studio__preview" aria-label={S.previewLabel}>
        <div class="studio__size" role="radiogroup" aria-label={S.sizeLabel}>
          {(['desktop', 'phone'] as const).map((s) => (
            <button
              key={s}
              type="button"
              class="btn btn--sm"
              role="radio"
              aria-checked={size === s ? 'true' : 'false'}
              data-size={s}
              onClick={() => {
                setSize(s);
                setResIndex(0);
              }}
            >
              {s === 'desktop' ? S.sizeDesktop : S.sizePhone}
            </button>
          ))}
        </div>
        <figure class={`studio__figure studio__figure--${size}`}>
          {preview === null ? (
            <div class="studio__pending" role="img" aria-label={fill(S.previewAlt, { name: names.en })}>
              {S.previewLoading}
            </div>
          ) : preview === 'error' ? (
            <p class="notice notice--warn studio__error" role="alert">
              {S.previewFailed}
            </p>
          ) : (
            <div class="studio__art" role="img" aria-label={fill(unlocked ? S.previewAlt : S.silhouetteAlt, { name: names.en })} data-fonts={fontsReady ? 'ready' : 'loading'} dangerouslySetInnerHTML={{ __html: preview.svg }} />
          )}
          <figcaption class="studio__caption">
            {!fontsReady && preview && preview !== 'error' ? <span class="studio__fonts">{S.fontsLoading}</span> : null}
            {data ? (
              <span class="studio__facts">
                <span>
                  {S.dateLabel}: <span lang="ja">{formatEraDate(data.date)}</span> · {eraGloss(data.date)}
                </span>
                <span>
                  {S.streakLabel}: {fill(S.daysUnit, { n: data.streak })}
                </span>
                <span>
                  {S.totalDaysLabel}: {fill(S.daysUnit, { n: data.totalDays })}
                </span>
              </span>
            ) : null}
          </figcaption>
        </figure>
      </section>

      {!unlocked ? (
        <section class="studio__locked status-window" aria-label={S.lockedTitle}>
          <h2 class="studio__h2">{S.lockedTitle}</h2>
          <p class="studio__condition">{fill(S.lockedCondition, { condition: def?.describe ?? '' })}</p>
          {progress !== null ? (
            <p class="studio__reveal" data-revealed={revealed}>
              {fill(S.revealedProgress, { n: revealed })} {fill(S.progressToward, { p: Math.round(progress * 100) })}
            </p>
          ) : null}
          <p class="studio__muted">{S.lockedPreviewNote}</p>
        </section>
      ) : (
        <>
          <section class="studio__controls" aria-label={S.personalizeLabel}>
            <h2 class="studio__h2">{S.personalizeLabel}</h2>
            <div class="field">
              <label class="field__label" for="studio-sentence">
                {S.sentenceLabel}
              </label>
              <select id="studio-sentence" class="select" value={personal.sentence} onChange={(e) => setPersonal({ ...personal, sentence: (e.currentTarget as HTMLSelectElement).value })}>
                <option value="">{S.sentenceNone}</option>
                {sentences.map((s) => (
                  <option key={s} value={s} lang="ja">
                    {s}
                  </option>
                ))}
                <option value={CUSTOM_SENTENCE}>{S.sentenceCustom}</option>
              </select>
            </div>
            {personal.sentence === CUSTOM_SENTENCE ? (
              <div class="field">
                <label class="field__label" for="studio-custom">
                  {S.sentenceInputLabel}
                </label>
                <input id="studio-custom" class="input" type="text" lang="ja" maxLength={MAX_CUSTOM_SENTENCE} placeholder={S.sentencePlaceholder} value={personal.custom} onInput={(e) => setPersonal({ ...personal, custom: (e.currentTarget as HTMLInputElement).value })} />
              </div>
            ) : null}
            <div class="field">
              <label class="field__label" for="studio-kanji">
                {S.kanjiLabel}
              </label>
              <select id="studio-kanji" class="select" value={personal.kanji} onChange={(e) => setPersonal({ ...personal, kanji: (e.currentTarget as HTMLSelectElement).value })}>
                <option value="">{S.kanjiNone}</option>
                {kanjiOptions.map((k) => (
                  <option key={k} value={k} lang="ja">
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div class="studio__reforge">
              <button type="button" class="btn" data-action="reforge" disabled={reforgedToday} aria-describedby="studio-reforge-hint" onClick={reforge}>
                {S.reforge}
              </button>
              <span id="studio-reforge-hint" class="field__hint studio__hint">
                {reforgedToday ? S.reforgeUsed : S.reforgeHint}
              </span>
            </div>
            {def?.living ? <p class="studio__muted">{S.livingNote}</p> : null}
          </section>

          <section class="studio__export" aria-label={S.exportPng}>
            <fieldset class="studio__fieldset">
              <legend class="field__label">{S.resolutionLabel}</legend>
              <div class="studio__resolutions">
                {sizes.map(([w, h], i) => (
                  <label key={`${w}x${h}`} class="studio__res">
                    <input type="radio" name="studio-resolution" value={`${w}x${h}`} checked={i === Math.min(resIndex, sizes.length - 1)} onChange={() => setResIndex(i)} />
                    <span>{fill(S.resolutionOption, { w, h })}</span>
                  </label>
                ))}
              </div>
              {size === 'desktop' && !allow4k ? <p class="field__hint studio__hint">{S.fourKGated}</p> : null}
            </fieldset>
            <div class="studio__actions">
              <button type="button" class="hanko studio__export-button" data-action="export" disabled={busy || !data} onClick={() => void doExport()}>
                {S.exportPng}
              </button>
              {busy ? <ProgressRing pct={pct} /> : null}
              {blob && !busy ? (
                <>
                  {blob.url ? (
                    <a class="btn btn--ghost" href={blob.url} download={blob.filename}>
                      {S.downloadAgain}
                    </a>
                  ) : null}
                  {clipboard ? (
                    <button type="button" class="btn btn--ghost" data-action="copy" onClick={() => void copy()}>
                      {S.copyImage}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
            <p class="studio__status" role="status">
              {busy ? fill(S.exporting, { p: pct }) : (status ?? '')}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
