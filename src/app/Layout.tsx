/**
 * TSUZUKU — shell chrome (group A, design 01 §4, 03 §7).
 *
 * Skip link · header (belt chip, Tsuzuku Flame, "412 days trained · 3-day
 * streak" in one type size, Lv / XP, with a visually-hidden "Level 7, 80 XP
 * to the next level" instead of an aria-label on a generic span) · notices ·
 * nav (Dojo, Road, Library, Collections, Records, Settings) with the active
 * route · <main id="main"> · ARIA live regions (#live polite, #live-alert
 * assertive) fed by `announce()` and by bus events · storage-warning and
 * Monday backup-reminder lines · service-worker update toast. The nav sits
 * BEFORE <main> in the DOM: on phones it is position:fixed at the bottom
 * (order irrelevant), from 900 px it is a sticky strip that must follow the
 * header in flow, not trail the page. Safe-area insets live in Layout.css.
 *
 * Storage notice: Dismiss hides it for the level it was shown at; a change
 * of level brings it back. At `ceiling` (the store also reports this while
 * a write keeps failing, so progress may not be saving) the dismissal lasts
 * only until the next `store.storage` update, so a repeated failure is never
 * silent.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BELTS } from '@/content/types';
import { bus } from '@/shared/events';
import { href, route, type Route, type RouteName } from '@/shared/routes';
import type { StorageState } from '@/shared/store-types';
import { weekdayOf } from '@/shared/time';
import { BADGE_DEFS, WALLPAPER_DEFS, store } from '@/store';
import { streakState, xpToNextLevel, type FlameState } from '@/store/derived';
import { BELT_NAME, S, fmt } from '@/i18n/strings';
import { applySwUpdate, dismissSwUpdate, swUpdate } from './sw-register';
import './Layout.css';

/* ── live region ─────────────────────────────────────────────────────── */

export type Politeness = 'polite' | 'assertive';

/** Speaks `text` through the live region. Repeats of the same text are re-announced. */
export function announce(text: string, politeness: Politeness = 'polite'): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(politeness === 'assertive' ? 'live-alert' : 'live');
  if (!el) return;
  el.textContent = '';
  // A separate task so assistive tech sees a change even for identical text.
  setTimeout(() => {
    el.textContent = text;
  }, 0);
}

const FLAME_TEXT: Record<FlameState, string> = {
  lit: S.flameLit,
  gold: S.flameGold,
  ember: S.flameEmber,
  frozen: S.flameFrozen,
  rest: S.flameRest,
  broken: S.flameBroken,
};

const FLAME_GLYPH: Record<FlameState, string> = {
  lit: '火',
  gold: '炎',
  ember: '残',
  frozen: '氷',
  rest: '休',
  broken: '灰',
};

/* ── bottom nav ──────────────────────────────────────────────────────── */

export type NavKey = 'dojo' | 'road' | 'library' | 'collections' | 'records' | 'settings';

export const NAV_ITEMS: readonly { key: NavKey; route: Route; label: string; glyph: string }[] = [
  { key: 'dojo', route: { name: 'dojo' }, label: S.navDojo, glyph: S.navDojoJa },
  { key: 'road', route: { name: 'road' }, label: S.navRoad, glyph: S.navRoadJa },
  { key: 'library', route: { name: 'library' }, label: S.navLibrary, glyph: S.navLibraryJa },
  { key: 'collections', route: { name: 'collections', tab: 'mon' }, label: S.navCollections, glyph: S.navCollectionsJa },
  { key: 'records', route: { name: 'records' }, label: S.navRecords, glyph: S.navRecordsJa },
  { key: 'settings', route: { name: 'settings' }, label: S.navSettings, glyph: S.navSettingsJa },
];

const NAV_OF_ROUTE: Record<RouteName, NavKey | null> = {
  dojo: 'dojo',
  // design 08 §10.2: 茶屋ラジオ opens from the Dojo tile and is never a session, so the Dojo stays current.
  radio: 'dojo',
  onboarding: null,
  train: null,
  scroll: 'road',
  road: 'road',
  station: 'road',
  gate: 'road',
  shinsa: 'road',
  story: 'road',
  listen: 'road',
  taiwa: 'road',
  dan: 'road',
  library: 'library',
  collections: 'collections',
  studio: 'collections',
  records: 'records',
  ledger: 'records',
  settings: 'settings',
  backup: 'settings',
  about: 'settings',
};

/** Which bottom-nav item is "current" for a route (null during sessions and onboarding). */
export function navTargetFor(r: Route): NavKey | null {
  return NAV_OF_ROUTE[r.name];
}

/* ── header lines ────────────────────────────────────────────────────── */

export function daysLine(totalDays: number, current: number): string {
  const days = totalDays === 1 ? S.dayTrained : fmt(S.daysTrained, { n: totalDays });
  const streak = current <= 0 ? S.streakNone : current === 1 ? S.streakDay : fmt(S.streakDays, { n: current });
  return `${days}${S.separator}${streak}`;
}

/* ── bus → live region ───────────────────────────────────────────────── */

/** Reward names for the live region (a raw id such as `seven` means nothing aloud). */
const badgeName = (id: string): string => BADGE_DEFS.find((d) => d.id === id)?.nameEn ?? id;
const wallpaperName = (id: string): string => WALLPAPER_DEFS.find((d) => d.id === id)?.nameEn ?? id;

function wireAnnouncements(): () => void {
  const offs = [
    bus.on('level:up', (p) => announce(fmt(S.liveLevelUp, { n: p.level }))),
    bus.on('badge:earned', (p) => announce(fmt(S.liveBadge, { name: badgeName(p.id) }))),
    bus.on('wallpaper:unlocked', (p) => announce(fmt(S.liveWallpaper, { name: wallpaperName(p.id) }))),
    bus.on('wallpaper:revealed', (p) => announce(fmt(S.liveWallpaperRevealed, { name: wallpaperName(p.id) }))),
    bus.on('stamp:earned', (p) => announce(fmt(S.liveStamp, { n: p.station }))),
    bus.on('belt:promoted', (p) => announce(fmt(S.liveBelt, { belt: BELT_NAME[p.belt] ?? p.belt }), 'assertive')),
    bus.on('quest:completed', (p) => announce(p.allDone ? S.liveQuestsAll : S.liveQuest)),
    bus.on('nemesis:defeated', () => announce(S.liveNemesis)),
    bus.on('streak:changed', (p) => {
      if (p.state === 'ember') announce(S.liveStreakEmber);
      else if (p.state === 'frozen') announce(S.liveStreakFrozen);
      else if (p.state === 'rest') announce(S.liveStreakRest);
      else if (p.state === 'lit' || p.state === 'gold') announce(fmt(S.liveStreak, { n: p.current }));
    }),
    bus.on('day:rolled', (p) => announce(p.awayDays >= 7 ? S.liveWelcomeBack : S.liveDayRolled)),
  ];
  return () => offs.forEach((off) => off());
}

/**
 * Whether a storage notice dismissed at `dismissed` still hides the notice for
 * `current`: same level, and at `ceiling` the very same state (each store
 * update at the ceiling re-shows it).
 */
export function storageNoticeDismissed(current: StorageState, dismissed: StorageState | null): boolean {
  if (dismissed === null || dismissed.level !== current.level) return false;
  return current.level !== 'ceiling' || dismissed === current;
}

/* ── component ───────────────────────────────────────────────────────── */

export function Layout(p: { children: ComponentChildren }): JSX.Element {
  const r = route.value;
  const profile = store.profile.value;
  const streak = store.streak.value;
  const storage = store.storage.value;
  const stats = store.stats.value;
  const flame = streakState();
  const xp = xpToNextLevel(profile.xp);
  const beltDef = BELTS.find((b) => b.id === profile.belt);
  const active = navTargetFor(r);
  const updateReady = swUpdate.value;

  const [storageDismissed, setStorageDismissed] = useState<StorageState | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  useEffect(() => wireAnnouncements(), []);
  useEffect(() => bus.on('backup:exported', () => setReminderDismissed(true)), []);
  useEffect(() => {
    if (updateReady) announce(S.swUpdateReady);
  }, [updateReady]);

  const showStorage = storage.level !== 'ok' && !storageNoticeDismissed(storage, storageDismissed) && r.name !== 'backup';
  const showReminder =
    !reminderDismissed &&
    r.name !== 'backup' &&
    r.name !== 'onboarding' &&
    streak.totalDays >= 7 &&
    weekdayOf(store.today()) === 1 &&
    stats.sessions > 0;

  const focusMain = (e: Event): void => {
    e.preventDefault();
    const main = document.getElementById('main');
    if (main) {
      main.focus();
      main.scrollIntoView?.();
    }
  };

  return (
    <div class="layout" data-route={r.name}>
      <button type="button" class="skip-link visually-hidden focusable" onClick={focusMain}>
        {S.skipToContent}
      </button>

      <header class="layout__header" aria-label={S.headerLabel}>
        <a class="layout__brand" href={href({ name: 'dojo' })} aria-label={S.appName}>
          <span class="layout__brand-ja brush" lang="ja" aria-hidden="true">
            {S.appNameJa}
          </span>
          <span class="layout__brand-en pixel">{S.appName}</span>
        </a>

        <div class="layout__status">
          <span class={`belt belt--${profile.belt}`} data-belt={profile.belt} title={fmt(S.beltLabel, { belt: BELT_NAME[profile.belt] ?? profile.belt })}>
            <span lang="ja">{beltDef?.nameJa ?? profile.belt}</span>
            {profile.dan > 0 ? <span class="layout__dan">{fmt(S.danLabel, { n: profile.dan })}</span> : null}
          </span>

          <span class="flame" data-state={flame} role="img" aria-label={`${S.flame}: ${FLAME_TEXT[flame]}`}>
            <span class="flame__glyph" lang="ja" aria-hidden="true">
              {FLAME_GLYPH[flame]}
            </span>
          </span>

          <span class="layout__days">{daysLine(streak.totalDays, streak.current)}</span>

          <span class="layout__level pixel">
            <span aria-hidden="true">
              {S.level} {profile.level}
            </span>
            <span class="visually-hidden">
              {fmt(S.levelLong, { n: profile.level })}, {fmt(S.xpToNext, { n: xp.remaining })}
            </span>
            <span
              class="progress layout__xp"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={xp.needed || 1}
              aria-valuenow={xp.into}
              aria-label={S.xp}
            >
              <span class="progress__fill" style={{ width: `${Math.round(xp.progress * 100)}%` }} />
            </span>
          </span>
        </div>
      </header>

      {showStorage ? (
        <div class={`notice notice--warn layout__notice${storage.level === 'ceiling' ? ' notice--shu' : ''}`} role="status">
          <span class="layout__notice-text">{storage.level === 'ceiling' ? S.storageCeiling : S.storageWarn}</span>
          <a class="btn btn--sm" href={href({ name: 'backup' })}>
            {S.backupLink}
          </a>
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setStorageDismissed(storage)} aria-label={S.dismissReminder}>
            {S.dismiss}
          </button>
        </div>
      ) : null}

      {showReminder ? (
        <div class="notice layout__notice" role="status">
          <span class="layout__notice-text">{S.backupReminder}</span>
          <a class="btn btn--sm" href={href({ name: 'backup' })}>
            {S.backupLink}
          </a>
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setReminderDismissed(true)} aria-label={S.dismissReminder}>
            {S.dismiss}
          </button>
        </div>
      ) : null}

      <nav class="nav layout__nav" aria-label={S.navLabel}>
        {NAV_ITEMS.map((item) => (
          <a key={item.key} class="nav__item" href={href(item.route)} aria-current={active === item.key ? 'page' : undefined} data-nav={item.key}>
            <span class="nav__glyph" lang="ja" aria-hidden="true">
              {item.glyph}
            </span>
            <span class="nav__label">{item.label}</span>
          </a>
        ))}
      </nav>

      <main id="main" class="layout__main container" tabIndex={-1}>
        {p.children}
      </main>

      {updateReady ? (
        <div class="toast layout__toast" role="status">
          <span class="toast__text">{S.swUpdateReady}</span>
          <button type="button" class="btn btn--sm" onClick={() => applySwUpdate()}>
            {S.swUpdateAction}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => dismissSwUpdate()}>
            {S.swUpdateLater}
          </button>
        </div>
      ) : null}

      <div id="live" class="visually-hidden" aria-live="polite" aria-atomic="true" />
      <div id="live-alert" class="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true" />
    </div>
  );
}
