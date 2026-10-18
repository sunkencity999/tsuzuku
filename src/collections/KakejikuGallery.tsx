/**
 * TSUZUKU — <KakejikuGallery>: the 28 hanging scrolls (design 06 §3).
 *
 * Every piece has a card: unlocked pieces show a thumbnail of the learner's
 * own render; locked pieces hang as a sumi silhouette, and counter-tied
 * pieces reveal in quadrants with a progress ring toward the condition.
 * Chips mark living pieces and the reforge count; the card links to the
 * Print Studio. Thumbnails are composed one per idle tick (the generators
 * are pure and fast, but 28 at once would stall the first paint) and shown
 * as `<img>` data URLs so the page DOM stays small. The cards hang on a
 * horizontal rail in --wood with scroll-snap (design 09 §5.4, §9 C3): each
 * scroll is a .sheet hung from the rail by a .hairline cord, static — no swing.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { WALLPAPER_NAMES } from '../art/strings';
import { svgDataUrl } from '../art/svg';
import { textLayersSvg } from '../art/jtext';
import { normalizeData, wallpaperData } from '../art/wallpapers/data';
import { WALLPAPERS, composeWallpaper, wallpaperSeed } from '../art/wallpapers/index';
import type { Revealed, WallpaperData, WallpaperSize } from '../art/wallpapers/spec';
import type { WallpaperId } from '../shared/catalog';
import { href } from '../shared/routes';
import type { CardsApi, SaveMeta, WallpaperEntry } from '../shared/store-types';
import { WALLPAPER_DEFS, store } from '../store';
import type { WallpaperDef } from '../store/wallpaper-defs';
import { S, fill } from './strings';
import './KakejikuGallery.css';

export interface KakejikuGalleryProps {
  /** Compose thumbnails (default true; tests may turn them off). */
  thumbnails?: boolean;
  /** Thumbnail orientation (default desktop). */
  size?: WallpaperSize;
}

export type CardState = 'unlocked' | 'revealing' | 'locked';

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** An entry with `at > 0` is unlocked; `at === 0` with `revealed` 1–3 is a progressive-reveal stub (store/wallpaper-defs). */
export function isUnlocked(e: WallpaperEntry | undefined): boolean {
  return e !== undefined && e.at > 0;
}

/** 0–1 toward the condition for counter pieces, `null` for the others. */
export function progressFor(def: WallpaperDef, m: SaveMeta, cards: CardsApi): number | null {
  if (!def.progress) return null;
  try {
    return clamp01(def.progress(m, cards));
  } catch {
    return 0;
  }
}

/** Quadrants to show: 4 when unlocked; otherwise the larger of the stored reveal and the live progress, capped at 3. */
export function revealedFor(def: WallpaperDef, e: WallpaperEntry | undefined, m: SaveMeta, cards: CardsApi): Revealed {
  if (isUnlocked(e)) return 4;
  const p = progressFor(def, m, cards);
  const live = p === null ? 0 : Math.floor(p * 4);
  const q = Math.min(3, Math.max(e?.revealed ?? 0, live));
  return (q < 0 ? 0 : q) as Revealed;
}

export function cardStateOf(e: WallpaperEntry | undefined, revealed: Revealed): CardState {
  if (isUnlocked(e)) return 'unlocked';
  return revealed > 0 ? 'revealing' : 'locked';
}

export interface ThumbnailOptions {
  data: WallpaperData;
  size: WallpaperSize;
  locked: boolean;
  revealed: Revealed;
  reforge: number;
  profileSeed: string;
}

/** The piece as an `<img>`-ready data URL (text layers baked in; system fonts stand in inside an image). */
export function thumbnailFor(id: WallpaperId, o: ThumbnailOptions): string {
  const spec = WALLPAPERS[id];
  const r = composeWallpaper(spec, {
    seed: wallpaperSeed(o.profileSeed, id, o.reforge),
    data: o.data,
    size: o.size,
    locked: o.locked,
    revealed: o.revealed,
    post: 'none',
  });
  const i = r.svg.lastIndexOf('</svg>');
  const svg = i < 0 || r.texts.length === 0 ? r.svg : r.svg.slice(0, i) + textLayersSvg(r.texts) + r.svg.slice(i);
  return svgDataUrl(svg);
}

/** Personalisation data for previews; falls back to the profile alone when content cannot be gathered. */
export async function gatherData(): Promise<WallpaperData> {
  try {
    return await wallpaperData();
  } catch {
    const m = store.meta();
    return normalizeData({
      nameKana: m.profile.nameKana || m.profile.name,
      chosenKanji: m.profile.chosenKanji,
      belt: m.profile.belt,
      streak: Math.max(m.streak.longest, m.streak.current),
      totalDays: m.streak.totalDays,
      level: m.profile.level,
      xp: m.profile.xp,
      station: m.progress.station,
      date: store.today(),
    });
  }
}

function afterIdle(): Promise<void> {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number };
  return new Promise((resolve) => {
    if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(() => resolve(), { timeout: 300 });
    else setTimeout(resolve, 0);
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pieces                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function Ring(p: { progress: number }): JSX.Element {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const pct = Math.round(p.progress * 100);
  return (
    <svg class="kakejiku-card__ring" viewBox="0 0 36 36" role="img" aria-label={fill(S.progressToward, { p: pct })}>
      <circle class="kakejiku-card__ring-track" cx="18" cy="18" r={r} />
      <circle class="kakejiku-card__ring-fill" cx="18" cy="18" r={r} stroke-dasharray={`${(c * p.progress).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 18 18)" />
      <text class="kakejiku-card__ring-text" x="18" y="21.5" text-anchor="middle">
        {pct}
      </text>
    </svg>
  );
}

const DARUMA_EYES: Record<number, string> = { 0: S.darumaEyes0, 1: S.darumaEyes1, 2: S.darumaEyes2 };

export function KakejikuGallery(p: KakejikuGalleryProps = {}): JSX.Element {
  const wantThumbs = p.thumbnails ?? true;
  const size: WallpaperSize = p.size ?? 'desktop';
  const entries = store.collections.value.wallpapers;
  const cardsVersion = store.cards.version.value;
  const meta = store.meta();
  const [thumbs, setThumbs] = useState<Partial<Record<WallpaperId, string>>>({});

  const rows = useMemo(
    () =>
      WALLPAPER_DEFS.map((def) => {
        const e = entries[def.id];
        const revealed = revealedFor(def, e, meta, store.cards);
        return { def, entry: e, revealed, state: cardStateOf(e, revealed), progress: progressFor(def, meta, store.cards) };
      }),
    [entries, cardsVersion],
  );
  const unlocked = rows.filter((r) => r.state === 'unlocked').length;
  const signature = rows.map((r) => `${r.def.id}:${r.entry?.reforges ?? 0}:${r.state}:${r.revealed}`).join('|');

  useEffect(() => {
    if (!wantThumbs) return;
    let alive = true;
    (async () => {
      const data = await gatherData();
      if (!alive) return;
      const seed = store.seed();
      for (const r of rows) {
        await afterIdle();
        if (!alive) return;
        let url: string | null = null;
        try {
          url = thumbnailFor(r.def.id, { data, size, locked: r.state !== 'unlocked', revealed: r.revealed, reforge: r.entry?.reforges ?? 0, profileSeed: seed });
        } catch (err) {
          console.warn('[collections] thumbnail failed', r.def.id, err);
        }
        if (url) setThumbs((prev) => (prev[r.def.id] === url ? prev : { ...prev, [r.def.id]: url }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [signature, size, wantThumbs]);

  return (
    <section class="kakejiku-gallery" aria-label={S.tabKakejiku} data-unlocked={unlocked} data-total={rows.length}>
      <p class="kakejiku-gallery__lede">{fill(S.kakejikuLede, { unlocked, total: rows.length })}</p>
      <ul class="kakejiku-gallery__cards">
        {rows.map(({ def, entry, revealed, state, progress }) => {
          const names = WALLPAPER_NAMES[def.id];
          const studio = href({ name: 'studio', wallpaperId: def.id });
          const thumb = thumbs[def.id];
          const alt = fill(state === 'unlocked' ? S.previewAlt : S.silhouetteAlt, { name: names.en });
          const eyes = def.id === 'daruma' && def.upgrade ? DARUMA_EYES[def.upgrade(meta)] : undefined;
          return (
            <li key={def.id} class={`kakejiku-card sheet kakejiku-card--${state}`} data-wallpaper={def.id} data-state={state} data-revealed={revealed}>
              <span class="kakejiku-card__cord hairline" aria-hidden="true" />
              <a class="kakejiku-card__link" href={studio} aria-label={`${names.en} · ${S.openStudio}`}>
                <figure class={`kakejiku-card__scroll kakejiku-card__scroll--${size}`}>
                  <span class="kakejiku-card__jiku" aria-hidden="true" />
                  <span class="kakejiku-card__art">
                    {thumb ? (
                      <img class="kakejiku-card__img" src={thumb} alt={alt} decoding="async" />
                    ) : (
                      <span class="kakejiku-card__pending" role="img" aria-label={alt}>
                        {wantThumbs ? S.thumbnailPending : null}
                      </span>
                    )}
                  </span>
                  <span class="kakejiku-card__jiku kakejiku-card__jiku--bottom" aria-hidden="true" />
                  <figcaption class="kakejiku-card__caption">
                    <span class="kakejiku-card__ja" lang="ja">
                      {names.ja}
                    </span>
                    <span class="kakejiku-card__en">{names.en}</span>
                  </figcaption>
                </figure>
              </a>
              <div class="kakejiku-card__meta">
                {state === 'unlocked' ? <span class="chip chip--accent">{S.unlockedLabel}</span> : <span class="chip">{S.lockedLabel}</span>}
                {def.living ? <span class="chip chip--tag kakejiku-card__living">{S.livingLabel}</span> : null}
                {entry && entry.reforges > 0 ? <span class="chip">{fill(S.reforgedTimes, { n: entry.reforges })}</span> : null}
                {state !== 'unlocked' && progress !== null ? <Ring progress={progress} /> : null}
                {state === 'revealing' ? <span class="chip">{fill(S.quadrantsRevealed, { n: revealed })}</span> : null}
              </div>
              {state !== 'unlocked' ? <p class="kakejiku-card__condition">{def.describe}</p> : null}
              {eyes && state === 'unlocked' ? (
                <p class="kakejiku-card__condition" data-daruma-eyes={def.upgrade?.(meta)}>
                  {eyes}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
