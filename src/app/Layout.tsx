/**
 * TSUZUKU — shell chrome (group A, design 01 §4, 03 §7, 09 §5.10 / §6.4 / §6.5).
 *
 * Skip link · header (belt chip, the Tsuzuku Flame as one drawn `<Lantern>`
 * with its visible English state word and the forgiveness chips the streak
 * machine already grants — below 480 px Layout.css folds all but the first
 * into a "+N" chip whose visually-hidden text lists them in full (it wears
 * the kintsugi seam while the folded repair chip does), so the DOM is the
 * same at every width and assistive tech loses nothing —
 * "412 days trained · 3-day streak" in one type size (two halves around the
 * separator, so a phone breaks the line only there),
 * Lv as a `<Ticker>` / XP as a `.meter`, with a visually-hidden "Level 7, 80 XP
 * to the next level" instead of an aria-label on a generic span) · notices ·
 * nav (Dojo, Road, Library, Collections, Records, Settings) with the active
 * route · <main id="main"> · ARIA live regions (#live polite, #live-alert
 * assertive) fed by `announce()` and by bus events · storage-warning and
 * Monday backup-reminder lines · service-worker update toast. The nav sits
 * BEFORE <main> in the DOM: on phones it is position:fixed at the bottom
 * (order irrelevant), from 900 px it is a sticky strip that must follow the
 * header in flow, not trail the page. Safe-area insets live in Layout.css.
 *
 * Chrome holds still across page turns: header, nav, brand and main carry
 * fixed `view-transition-name`s (Layout.css); `focusMain()` is what PageHost
 * calls on `finished`. The brand ignites (tomosu) once a day — the day is kept
 * in memory and sessionStorage, never in the save. Toasts and notices leave
 * the way they arrived: `useLeaving()` holds the element through a
 * `data-leaving` kasure (instant under reduced motion) before it unmounts.
 *
 * Storage notice: Dismiss hides it for the level it was shown at; a change
 * of level brings it back. At `ceiling` (the store also reports this while
 * a write keeps failing, so progress may not be saving) the dismissal lasts
 * only until the next `store.storage` update, so a repeated failure is never
 * silent.
 */
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BELTS } from '@/content/types';
import { bus } from '@/shared/events';
import { href, route, type Route, type RouteName } from '@/shared/routes';
import type { EpochDay, StorageState } from '@/shared/store-types';
import { weekdayOf } from '@/shared/time';
import { Lantern, lanternChips, repairOpen, type LanternChip, type LanternState } from '@/shared/ui/Lantern';
import { Ticker } from '@/shared/ui/Ticker';
import { prefersReducedMotion } from '@/shared/ui/use-reveal';
import { BADGE_DEFS, WALLPAPER_DEFS, store } from '@/store';
import { streakState, xpToNextLevel, type FlameState } from '@/store/derived';
import { BELT_NAME, S, fmt } from '@/i18n/strings';
import { applySwUpdate, dismissSwUpdate, swUpdate } from './sw-register';
import { shownRoute } from './transitions';
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

/**
 * Moves focus to `<main>` without scrolling. `ifIdle`: only when the page
 * placed no focus of its own (`document.activeElement` is the body or null) —
 * what PageHost asks on a finished page turn (design 09 §6.4). Returns whether
 * focus moved.
 */
export function focusMain(o: { ifIdle?: boolean } = {}): boolean {
  if (typeof document === 'undefined') return false;
  if (o.ifIdle) {
    const active = document.activeElement;
    if (active && active !== document.body) return false;
  }
  const main = document.getElementById('main');
  if (!main) return false;
  try {
    main.focus({ preventScroll: true });
  } catch {
    main.focus();
  }
  return true;
}

/** The long flame sentence (aria / the Dojo), design 03 §7. */
export const FLAME_TEXT: Record<FlameState, string> = {
  lit: S.flameLit,
  gold: S.flameGold,
  ember: S.flameEmber,
  frozen: S.flameFrozen,
  rest: S.flameRest,
  broken: S.flameBroken,
};

/** The visible state word beside the drawn tongue (design 09 §5.10). */
export const FLAME_WORD: Record<FlameState, string> = {
  lit: S.flameWordLit,
  gold: S.flameWordGold,
  ember: S.flameWordEmber,
  frozen: S.flameWordFrozen,
  rest: S.flameWordRest,
  broken: S.flameWordBroken,
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

/**
 * The two halves of "412 days trained · 3-day streak". While a repair window is
 * open (`repairDone` is the days done so far) the second half reads "Streak
 * paused · repair open: 1 of 3 days" (design 09 §8) — whatever `current` says:
 * inside the window the streak machine counts the repair days as a provisional
 * 1 or 2 (`onTrainingDay`, src/store/streak.ts) and restores the real count when
 * the third lands, so a "1-day streak" there would misread the state. Without a
 * window: "No streak yet" at zero, else the count. Rendered as two spans so a
 * phone (Layout.css ≤ 480 px) breaks the line at the separator only.
 */
export function daysParts(totalDays: number, current: number, repairDone: number | null = null): [days: string, streak: string] {
  const days = totalDays === 1 ? S.dayTrained : fmt(S.daysTrained, { n: totalDays });
  const streak =
    repairDone !== null
      ? fmt(S.streakPaused, { done: repairDone })
      : current <= 0
        ? S.streakNone
        : current === 1
          ? S.streakDay
          : fmt(S.streakDays, { n: current });
  return [days, streak];
}

/** The two halves joined by `S.separator`: the header's text as it reads aloud. */
export function daysLine(totalDays: number, current: number, repairDone: number | null = null): string {
  return daysParts(totalDays, current, repairDone).join(S.separator);
}

/** Copy for one forgiveness chip (design 09 §5.10). */
export function chipText(c: LanternChip): string {
  switch (c.kind) {
    case 'freeze':
      return c.n === 1 ? S.chipFreeze : fmt(S.chipFreezes, { n: c.n });
    case 'rest':
      return c.set ? S.chipRestSet : c.n === 1 ? S.chipRestTakenOne : fmt(S.chipRestTaken, { n: c.n });
    case 'weekly':
      return c.n === 1 ? S.chipWeeklyOne : fmt(S.chipWeekly, { n: c.n });
    default:
      return fmt(S.chipRepair, { done: c.n });
  }
}

/** Decorative glyph per chip (labelled by the chip's English text; base-slice glyphs only). */
const CHIP_GLYPH: Partial<Record<LanternChip['kind'], string>> = { freeze: '氷', rest: '休' };

/** The "+N" chip's hidden sentence: every folded chip in full ("rest day set, 2 weekly flames"). */
export function chipsMoreText(hidden: LanternChip[]): string {
  return hidden.map(chipText).join(S.listSeparator);
}

/**
 * The forgiveness chips: 氷 tokens held, planned rest, weekly flames, and the
 * open repair window with the kintsugi seam — only while the window is open,
 * so a repaired flame is indistinguishable from one that never dimmed.
 *
 * Phone density (design 09 §12.1 decision 19): when more than one chip exists
 * a trailing `.flame-chip--more` ("+N") is rendered too. Layout.css shows it
 * only below 480 px, where it hides the chips after the first; its visible
 * "+N" is aria-hidden and its visually-hidden text lists the folded chips in
 * full, so the DOM is one shape at every width and nothing is lost to AT. It
 * wears `.kintsugi` while a folded chip does (the repair chip is appended
 * last by lanternChips(), so without this the §5.10 / §8 seam would never
 * show on a phone).
 */
export function FlameChips(p: { chips: LanternChip[]; class?: string }): JSX.Element | null {
  if (p.chips.length === 0) return null;
  const hidden = p.chips.slice(1);
  return (
    <ul class={`flame-chips${p.class ? ` ${p.class}` : ''}`} aria-label={S.chipsLabel}>
      {p.chips.map((c) => (
        <li key={c.kind} class={`chip flame-chip${c.kintsugi ? ' kintsugi' : ''}`} data-chip={c.kind}>
          {CHIP_GLYPH[c.kind] ? (
            <span class="flame-chip__glyph" lang="ja" aria-hidden="true">
              {CHIP_GLYPH[c.kind]}
            </span>
          ) : null}
          <span class="flame-chip__text">{chipText(c)}</span>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li key="more" class={`chip flame-chip flame-chip--more${hidden.some((c) => c.kintsugi) ? ' kintsugi' : ''}`} data-chip="more">
          <span class="flame-chip__text" aria-hidden="true">
            {fmt(S.chipsMore, { n: hidden.length })}
          </span>
          <span class="visually-hidden">{chipsMoreText(hidden)}</span>
        </li>
      ) : null}
    </ul>
  );
}

/* ── brand ignition (tomosu, once a day) ─────────────────────────────── */

const IGNITION_KEY = 'tsuzuku.ignited';
let ignitedDay: EpochDay | null = null;

/**
 * Whether the brand ignites for `day`: once per day, remembered in memory and
 * sessionStorage (a reload does not relight it; a new day does). Never a save field.
 */
export function shouldIgnite(day: EpochDay): boolean {
  if (ignitedDay === null) {
    try {
      const v = sessionStorage.getItem(IGNITION_KEY);
      if (v !== null && /^-?\d+$/.test(v)) ignitedDay = Number(v);
    } catch {
      /* no sessionStorage: memory only */
    }
  }
  if (ignitedDay === day) return false;
  ignitedDay = day;
  try {
    sessionStorage.setItem(IGNITION_KEY, String(day));
  } catch {
    /* ignore */
  }
  return true;
}

export function resetIgnitionForTests(): void {
  ignitedDay = null;
  try {
    sessionStorage.removeItem(IGNITION_KEY);
  } catch {
    /* ignore */
  }
}

/* ── the flame tomosu when it improves (§6.3) ───────────────────────── */

/** States in rising order; `frozen` / `rest` hold, `lit` / `gold` glow. */
const FLAME_RANK: Record<LanternState, number> = { unlit: 0, broken: 0, ember: 1, frozen: 2, rest: 2, lit: 3, gold: 4 };
const GLOWING: ReadonlySet<LanternState> = new Set<LanternState>(['lit', 'gold']);

/**
 * Whether a change `prev → next` lights the lantern: a rise INTO a glowing
 * state (ember → lit, broken → lit, lit → gold, frozen → lit …). A rise into a
 * held state (ember → frozen) is not lit: motion.css keeps the twin at 0 there.
 */
export function flameImproved(prev: LanternState | null, next: LanternState): boolean {
  return prev !== null && GLOWING.has(next) && FLAME_RANK[next] > FLAME_RANK[prev];
}

/** Safety net when no `animationend` arrives (longer than `--dur-4`). */
export const TOMOSU_FALLBACK_MS = 1200;

/**
 * `.ink-tomosu` on the lantern for one rise (motion.css lights the glow twin
 * over --dur-4), dropped on the twin's `animationend` or after the fallback.
 * Nothing under reduced motion (the twin sits at its final state).
 */
export function useFlameTomosu(state: LanternState): { tomosu: boolean; onEnd: (e: AnimationEvent) => void } {
  const prev = useRef<LanternState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tomosu, setTomosu] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (!flameImproved(was, state) || prefersReducedMotion()) return;
    setTomosu(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTomosu(false), TOMOSU_FALLBACK_MS);
  }, [state]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onEnd = (e: AnimationEvent): void => {
    // the twin's event targets the lantern itself; a child's animation ending is not ours
    if (e.target !== e.currentTarget) return;
    if (timer.current) clearTimeout(timer.current);
    setTomosu(false);
  };
  return { tomosu, onEnd };
}

/* ── leaving (kasure before unmount) ─────────────────────────────────── */

/** Safety net when no `transitionend` arrives (longer than `--dur-1`, shorter than a blink of doubt). */
export const EXIT_FALLBACK_MS = 400;

/**
 * Keeps an element mounted through its exit: when `open` turns false the
 * element gets `data-leaving` (Layout.css fades and nudges it, `@starting-style`
 * + `allow-discrete` where the browser has them) and unmounts on
 * `transitionend` or after `EXIT_FALLBACK_MS`. Reduced motion: instant.
 */
export function useLeaving(open: boolean): { mounted: boolean; leaving: boolean; ref: RefObject<HTMLDivElement> } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    const el = ref.current;
    if (!el || prefersReducedMotion()) {
      setLeaving(false);
      setMounted(false);
      return;
    }
    setLeaving(true);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      setLeaving(false);
      setMounted(false);
    };
    // `transitionend` bubbles: the Dismiss button's own 60 ms press transition must not end the notice's kasure.
    const onEnd = (e: Event): void => {
      if (e.target === el) finish();
    };
    el.addEventListener('transitionend', onEnd);
    const timer = setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('transitionend', onEnd);
    };
  }, [open]);
  return { mounted, leaving, ref };
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
  // the page on screen (PageHost's commit), falling back to the hash before the first page
  const r = shownRoute.value ?? route.value;
  const profile = store.profile.value;
  const streak = store.streak.value;
  const settings = store.settings.value;
  const storage = store.storage.value;
  const stats = store.stats.value;
  const today = store.today();
  const flame = streakState();
  const unlit = streak.totalDays === 0;
  const lanternState: LanternState = unlit ? 'unlit' : flame;
  const flameTomosu = useFlameTomosu(lanternState);
  const repair = repairOpen(streak, today) ? (streak.repairWindow?.done ?? 0) : null;
  const chips = lanternChips({ streak, today, restDay: settings.restDay });
  const xp = xpToNextLevel(profile.xp);
  const beltDef = BELTS.find((b) => b.id === profile.belt);
  const beltLabel = fmt(S.beltLabel, { belt: BELT_NAME[profile.belt] ?? profile.belt });
  const dayParts = daysParts(streak.totalDays, streak.current, repair);
  const active = navTargetFor(r);
  const updateReady = swUpdate.value;

  const [storageDismissed, setStorageDismissed] = useState<StorageState | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [ignition, setIgnition] = useState(() => (shouldIgnite(today) ? 1 : 0));

  useEffect(() => wireAnnouncements(), []);
  useEffect(() => bus.on('backup:exported', () => setReminderDismissed(true)), []);
  useEffect(
    () =>
      bus.on('day:rolled', (e) => {
        if (shouldIgnite(e.day)) setIgnition((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    if (updateReady) announce(S.swUpdateReady);
  }, [updateReady]);

  const showStorage = storage.level !== 'ok' && !storageNoticeDismissed(storage, storageDismissed) && r.name !== 'backup';
  const showReminder =
    !reminderDismissed &&
    r.name !== 'backup' &&
    r.name !== 'onboarding' &&
    streak.totalDays >= 7 &&
    weekdayOf(today) === 1 &&
    stats.sessions > 0;
  const storageNotice = useLeaving(showStorage);
  const reminderNotice = useLeaving(showReminder);
  const toast = useLeaving(Boolean(updateReady));

  const skipToMain = (e: Event): void => {
    e.preventDefault();
    if (focusMain()) document.getElementById('main')?.scrollIntoView?.();
  };

  return (
    <div class="layout" data-route={r.name}>
      <button type="button" class="skip-link visually-hidden focusable" onClick={skipToMain}>
        {S.skipToContent}
      </button>

      <header class="layout__header hairline" aria-label={S.headerLabel}>
        <a class="layout__brand" href={href({ name: 'dojo' })} aria-label={S.appName} data-ignite={ignition > 0 ? '' : undefined}>
          <span key={ignition} class="layout__brand-ja brush" lang="ja" aria-hidden="true">
            {S.appNameJa}
          </span>
          <span class="layout__brand-en pixel">{S.appName}</span>
        </a>

        <div class="layout__status">
          <span class={`belt belt--${profile.belt}`} data-belt={profile.belt} title={beltLabel}>
            {/* the kanji are decorative-with-a-label: the swatch carries the colour, the English reaches assistive tech (a tooltip never reaches a phone) */}
            <span lang="ja" aria-hidden="true">
              {beltDef?.nameJa ?? profile.belt}
            </span>
            <span class="visually-hidden">{beltLabel}</span>
            {profile.dan > 0 ? <span class="layout__dan">{fmt(S.danLabel, { n: profile.dan })}</span> : null}
          </span>

          <Lantern
            class={`layout__flame${flameTomosu.tomosu ? ' ink-tomosu' : ''}`}
            state={lanternState}
            title={S.flame}
            label={unlit ? S.flameWordUnlit : FLAME_WORD[flame]}
            detail={unlit ? S.flameUnlit : FLAME_TEXT[flame]}
            onAnimationEnd={flameTomosu.onEnd}
          />
          <FlameChips chips={chips} class="layout__chips" />

          <span class="layout__days">
            <span>{dayParts[0]}</span>
            {S.separator}
            <span>{dayParts[1]}</span>
          </span>

          <span class="layout__level pixel">
            <span aria-hidden="true">
              {S.level} <Ticker value={profile.level} />
            </span>
            <span class="visually-hidden">
              {fmt(S.levelLong, { n: profile.level })}, {fmt(S.xpToNext, { n: xp.remaining })}
            </span>
            <span
              class="meter layout__xp"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={xp.needed || 1}
              aria-valuenow={xp.into}
              aria-label={S.xp}
              style={{ '--value': String(Math.round(xp.progress * 1000) / 1000) }}
            >
              <span class="meter__fill" />
            </span>
          </span>
        </div>
      </header>

      {storageNotice.mounted ? (
        <div
          ref={storageNotice.ref}
          class={`notice notice--warn layout__notice${storage.level === 'ceiling' ? ' notice--shu' : ''}`}
          role="status"
          data-leaving={storageNotice.leaving ? '' : undefined}
        >
          <span class="layout__notice-text">{storage.level === 'ceiling' ? S.storageCeiling : S.storageWarn}</span>
          <a class="btn btn--sm" href={href({ name: 'backup' })}>
            {S.backupLink}
          </a>
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setStorageDismissed(storage)} aria-label={S.dismissReminder}>
            {S.dismiss}
          </button>
        </div>
      ) : null}

      {reminderNotice.mounted ? (
        <div ref={reminderNotice.ref} class="notice layout__notice" role="status" data-leaving={reminderNotice.leaving ? '' : undefined}>
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

      {toast.mounted ? (
        <div ref={toast.ref} class="toast layout__toast" role="status" data-leaving={toast.leaving ? '' : undefined}>
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
