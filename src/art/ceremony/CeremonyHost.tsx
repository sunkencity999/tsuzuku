/**
 * TSUZUKU — <CeremonyHost>: the global reward overlay (group G, design 06).
 *
 * Mounted once by App (`<App overlays={[CeremonyHost]}/>`). It listens on the
 * bus for B's derived reward events and turns them into a queue of ceremonies:
 *
 *   badge:earned        → <BadgeSlam>        wallpaper:unlocked / :revealed → <WallpaperUnlock>
 *   belt:promoted       → <BeltCeremony>     stamp:earned                  → <StampPress>
 *   level:up            → a small toast
 *
 * One ceremony shows at a time, in arrival order. Nothing shows during an
 * exercise step: `session:started` (or any `attempt:graded`, which also covers
 * a resumed session) defers the queue, and `session:finished` /
 * `session:abandoned` releases it after `CEREMONY_GRACE_MS`, so the つづく card
 * lands first. `flushCeremonies()` shows the queue at once (the end card may
 * call it through the host API; the bus release makes it optional).
 *
 * Every ceremony is dismissed by a tap on the backdrop or card, Enter, Space or
 * Esc; the dialog traps Tab, takes focus on open and gives it back on close; a
 * polite live region announces each ceremony. The overlay enters as nijimi and
 * leaves as kasure (design 09 §6.3 — every surface that enters also exits):
 * the verb rides `.ceremony__dialog` while the backdrop only fades (mat), so
 * the opaque belt stage is never scaled or translated (§6.7 rule 7 in spirit:
 * a full-viewport sheet shows a rim of the page when it moves); a dismissal
 * sets `data-leaving` on the root and the dialog, and the queue moves on at the
 * dialog's own animationend or after `EXIT_FALLBACK_MS` (`useExit`). The cards
 * get `hostExit`, so their Continue hands over at once and a dismissal costs
 * ONE --dur-1 kasure, never the card's and then the overlay's. A belt ceremony
 * that arrives outside a session waits `BELT_SETTLE_MS` for ShinsaView's 600 ms
 * sumi beat (+ its kasure) before it opens. Reduced motion (store setting or
 * OS) renders the static final frame, no ink verb, and dismisses at once.
 * Audio goes through `shared/audio`.
 *
 * The live region's sentence (`announcementFor`) keeps the station's romaji
 * beside its kanji at every belt: it is SPOKEN, not shown, and a screen reader
 * needs the Latin spelling to say the name — design 09 §3.3's romaji gate
 * (d49) is about glyphs the learner sees; `StampPress` gates the visible line.
 *
 * Belt promotions fold in their own Shinsa badge and ceremony wallpaper so the
 * learner is not shown the same reward twice; a burst of more than `MAX_QUEUE`
 * rewards (an imported save being reconciled) collapses the tail into one
 * summary card that points at Collections.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BELTS, type Belt } from '../../content/types';
import { beltBadgeId, type BadgeId, type WallpaperId } from '../../shared/catalog';
import { bus, type Unsubscribe } from '../../shared/events';
import { href } from '../../shared/routes';
import { store } from '../../store';
import { WALLPAPER_NAMES, fill } from '../strings';
import { BadgeSlam, badgeDefinition } from './BadgeSlam';
import { BELT_WALLPAPER, BeltCeremony } from './BeltCeremony';
import { StampPress, stationDef } from './StampPress';
import { S } from './strings';
import { isInteractive, playSfx, prefersReducedMotion, trapTab, useExit, verb } from './support';
import { WallpaperUnlock } from './WallpaperUnlock';
import './CeremonyHost.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Queue model                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export type Ceremony =
  | { kind: 'badge'; id: BadgeId }
  | { kind: 'belt'; belt: Belt }
  | { kind: 'wallpaper'; id: WallpaperId; quadrant?: 1 | 2 | 3 }
  | { kind: 'stamp'; station: number; perfect: boolean; assisted: boolean }
  | { kind: 'level'; level: number }
  | { kind: 'summary'; badges: number; wallpapers: number; stamps: number; levels: number };

/** After `session:finished`: let the つづく card and its gliss land first. */
export const CEREMONY_GRACE_MS = 1600;
/** Outside a session: let the page's own feedback settle. */
export const CEREMONY_SETTLE_MS = 250;
/**
 * A belt ceremony opens no sooner than this after the pass (design 09 §10 D1):
 * ShinsaView's sumi beat holds 600 ms (`SHINSA_SUMI_MS`) and dries out over
 * --dur-1 (`SHINSA_SUMI_OUT_MS`, 120) — the art tier may not import the
 * session group, so the two figures are carried here; ShinsaView.test pins the
 * sum. Not applied under reduced motion (the beat is absent there).
 */
export const BELT_SETTLE_MS = 720;
/** Beat between two ceremonies. */
export const CEREMONY_BETWEEN_MS = 350;
/** The level toast dismisses itself. */
export const LEVEL_TOAST_MS = 3500;
/** Longer bursts collapse into one summary card (belt ceremonies are never dropped). */
export const MAX_QUEUE = 8;

export function ceremonyKey(c: Ceremony): string {
  switch (c.kind) {
    case 'badge':
      return `badge:${c.id}`;
    case 'belt':
      return `belt:${c.belt}`;
    case 'wallpaper':
      return `wallpaper:${c.id}:${c.quadrant ?? 'full'}`;
    case 'stamp':
      return `stamp:${c.station}`;
    case 'level':
      return 'level';
    default:
      return 'summary';
  }
}

type Overflow = { badges: number; wallpapers: number; stamps: number; levels: number };
const zero = (): Overflow => ({ badges: 0, wallpapers: 0, stamps: 0, levels: 0 });

let queue: Ceremony[] = [];
let current: Ceremony | null = null;
/** Design 09 §6.4: the shell's `canTransition()` skips a page turn while a ceremony is on screen (A2's one permitted edit here). */
export function isCeremonyOpen(): boolean {
  return current !== null;
}
let sessionActive = false;
let nextDelay = CEREMONY_SETTLE_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let overflow: Overflow = zero();
let hosts = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of Array.from(listeners)) l();
}
function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
function show(): void {
  timer = null;
  if (current || sessionActive || queue.length === 0) return;
  const next = queue.shift()!;
  if (next.kind === 'summary') {
    current = { kind: 'summary', ...overflow };
    overflow = zero();
  } else {
    current = next;
  }
  nextDelay = CEREMONY_SETTLE_MS;
  notify();
}
/** The settle before the next ceremony: a belt at the head of the queue waits for the Shinsa sumi beat. */
function settleDelay(): number {
  return queue[0]?.kind === 'belt' && !prefersReducedMotion() ? Math.max(nextDelay, BELT_SETTLE_MS) : nextDelay;
}
function schedule(delay = settleDelay()): void {
  if (hosts === 0 || current || sessionActive || timer !== null || queue.length === 0) return;
  timer = setTimeout(show, delay);
}
function coveredByBelt(c: Ceremony, by: Ceremony): boolean {
  if (by.kind !== 'belt') return false;
  if (c.kind === 'wallpaper') return BELT_WALLPAPER[by.belt] === c.id;
  if (c.kind === 'badge') return beltBadgeId(by.belt) === c.id;
  return false;
}

/** Add a ceremony (dedupes, folds belt rewards, caps bursts) and schedule it. */
export function enqueueCeremony(c: Ceremony): void {
  if (c.kind === 'summary') return; // only the overflow path creates summaries
  const key = ceremonyKey(c);
  if (c.kind === 'level') {
    // only the latest level waits; a level reached while its toast shows queues behind it
    queue = queue.filter((q) => q.kind !== 'level');
  } else if ((current && ceremonyKey(current) === key) || queue.some((q) => ceremonyKey(q) === key)) {
    return;
  }
  if (c.kind === 'belt') {
    queue = queue.filter((q) => !coveredByBelt(q, c));
  } else if (c.kind === 'badge' || c.kind === 'wallpaper') {
    if ((current && coveredByBelt(c, current)) || queue.some((q) => coveredByBelt(c, q))) return;
    if (c.kind === 'wallpaper') {
      if (c.quadrant !== undefined) {
        if (queue.some((q) => q.kind === 'wallpaper' && q.id === c.id && q.quadrant === undefined)) return;
      } else {
        queue = queue.filter((q) => !(q.kind === 'wallpaper' && q.id === c.id));
      }
    }
  }
  if (c.kind !== 'belt' && queue.filter((q) => q.kind !== 'summary').length >= MAX_QUEUE) {
    if (c.kind === 'badge') overflow.badges++;
    else if (c.kind === 'wallpaper') overflow.wallpapers++;
    else if (c.kind === 'stamp') overflow.stamps++;
    else overflow.levels++;
    if (!queue.some((q) => q.kind === 'summary')) queue.push({ kind: 'summary', ...zero() });
    notify();
    schedule();
    return;
  }
  const si = queue.findIndex((q) => q.kind === 'summary');
  if (si >= 0) queue.splice(si, 0, c);
  else queue.push(c);
  notify();
  schedule();
}

/** Close the ceremony on screen; the next one follows after a beat. */
export function dismissCeremony(): void {
  if (!current) return;
  current = null;
  notify();
  schedule(CEREMONY_BETWEEN_MS);
}

/** Show the deferred queue now (end card, tests). Clears the session gate. */
export function flushCeremonies(): void {
  sessionActive = false;
  clearTimer();
  if (!current && queue.length > 0 && hosts > 0) show();
  else notify();
}

/** Session gate: `true` while an exercise step may be on screen. */
export function setSessionActive(on: boolean): void {
  if (on) {
    sessionActive = true;
    clearTimer();
  } else {
    sessionActive = false;
    nextDelay = queue.length > 0 ? CEREMONY_GRACE_MS : CEREMONY_SETTLE_MS;
    schedule();
  }
}

export function isSessionActive(): boolean {
  return sessionActive;
}
export function pendingCeremonies(): readonly Ceremony[] {
  return queue.slice();
}
export function currentCeremony(): Ceremony | null {
  return current;
}
export function subscribeCeremonies(fn: () => void): Unsubscribe {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tests: empty queue, no ceremony, gate open. */
export function resetCeremoniesForTests(): void {
  clearTimer();
  queue = [];
  current = null;
  sessionActive = false;
  nextDelay = CEREMONY_SETTLE_MS;
  overflow = zero();
  notify();
}

/** Bus → queue. Returns the unsubscribe; the host wires this on mount. */
export function startCeremonyBus(): Unsubscribe {
  const offs = [
    bus.on('session:started', () => setSessionActive(true)),
    bus.on('attempt:graded', () => {
      if (!sessionActive) setSessionActive(true);
    }),
    bus.on('session:finished', () => setSessionActive(false)),
    bus.on('session:abandoned', () => setSessionActive(false)),
    bus.on('badge:earned', (p) => enqueueCeremony({ kind: 'badge', id: p.id })),
    bus.on('belt:promoted', (p) => enqueueCeremony({ kind: 'belt', belt: p.belt })),
    bus.on('wallpaper:unlocked', (p) => enqueueCeremony({ kind: 'wallpaper', id: p.id })),
    bus.on('wallpaper:revealed', (p) => {
      const q = p.quadrant;
      enqueueCeremony(q === 1 || q === 2 || q === 3 ? { kind: 'wallpaper', id: p.id, quadrant: q } : { kind: 'wallpaper', id: p.id });
    }),
    bus.on('stamp:earned', (p) => enqueueCeremony({ kind: 'stamp', station: p.station, perfect: p.perfect, assisted: p.assisted })),
    bus.on('level:up', (p) => enqueueCeremony({ kind: 'level', level: p.level })),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Copy                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function beltName(b: Belt): { en: string; ja: string; title: string } {
  const d = BELTS.find((x) => x.id === b);
  return { en: d?.nameEn ?? b, ja: d?.nameJa ?? '', title: d ? `${d.titleJa} ${d.titleRomaji}` : '' };
}

/** The live-region sentence for a ceremony. */
export function announcementFor(c: Ceremony): string {
  switch (c.kind) {
    case 'badge': {
      const d = badgeDefinition(c.id);
      return fill(S.announceBadge, { ja: d?.nameJa ?? '', en: d?.nameEn ?? c.id, describe: d?.describe ?? '' });
    }
    case 'belt': {
      const n = beltName(c.belt);
      return fill(S.announceBelt, { belt: n.en, title: n.title });
    }
    case 'wallpaper': {
      const n = WALLPAPER_NAMES[c.id];
      return c.quadrant !== undefined ? fill(S.announceReveal, { en: n.en, q: c.quadrant }) : fill(S.announceWallpaper, { ja: n.ja, en: n.en });
    }
    case 'stamp': {
      const st = stationDef(c.station);
      return fill(S.announceStamp, { station: st ? `${st.nameJa} ${st.nameRomaji}` : fill(S.stampStation, { n: c.station }) });
    }
    case 'level':
      return fill(S.announceLevel, { n: c.level });
    default:
      return S.announceSummary;
  }
}

/** The dialog's accessible name. */
export function labelFor(c: Ceremony): string {
  switch (c.kind) {
    case 'badge':
      return `${S.badgeEarned}: ${badgeDefinition(c.id)?.nameEn ?? c.id}`;
    case 'belt':
      return fill(S.beltTitle, { belt: beltName(c.belt).en });
    case 'wallpaper':
      return `${c.quadrant !== undefined ? S.wallpaperRevealed : S.wallpaperUnlocked}: ${WALLPAPER_NAMES[c.id].en}`;
    case 'stamp':
      return `${S.stampTitle}: ${fill(S.stampStation, { n: c.station })}`;
    case 'level':
      return fill(S.levelLine, { n: c.level });
    default:
      return S.summaryTitle;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small cards                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

function SummaryCard(p: { c: Extract<Ceremony, { kind: 'summary' }>; onDone(): void }): JSX.Element {
  const parts: string[] = [];
  if (p.c.badges > 0) parts.push(fill(S.summaryBadges, { n: p.c.badges }));
  if (p.c.wallpapers > 0) parts.push(fill(S.summaryWallpapers, { n: p.c.wallpapers }));
  if (p.c.stamps > 0) parts.push(fill(S.summaryStamps, { n: p.c.stamps }));
  if (p.c.levels > 0) parts.push(fill(S.summaryLevels, { n: p.c.levels }));
  return (
    <section class="ceremony-summary sheet">
      <p class="ceremony-summary__eyebrow eyebrow">{S.summaryTitle}</p>
      <p class="ceremony-summary__line">{S.summaryLine}</p>
      {parts.length > 0 ? <p class="ceremony-summary__counts">{parts.join(' · ')}</p> : null}
      <div class="ceremony-summary__actions">
        <a class="hanko ceremony-summary__link" href={href({ name: 'collections', tab: 'mon' })} onClick={() => p.onDone()}>
          {S.openCollections}
        </a>
        <button type="button" class="btn btn--ghost ceremony-summary__continue" onClick={() => p.onDone()}>
          {S.continue}
        </button>
      </div>
    </section>
  );
}

function LevelToast(p: { level: number; onDone(): void; reduced: boolean }): JSX.Element {
  const exit = useExit(p.onDone, p.reduced);
  const leave = useRef(exit.leave);
  leave.current = exit.leave;
  useEffect(() => {
    playSfx('promotion');
    const t = setTimeout(() => leave.current(), LEVEL_TOAST_MS);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        leave.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <button
      type="button"
      class={`ceremony-toast sheet ${verb(p.reduced, 'ink-nijimi')}`}
      style={{ '--from': '0 8px' }}
      data-kind="level"
      data-leaving={exit.leaving ? '' : undefined}
      ref={exit.ref}
      onClick={exit.leave}
      aria-label={fill(S.levelLine, { n: p.level })}
    >
      <span class="ceremony-toast__lv pixel" aria-hidden="true">
        {S.levelLabel} {p.level}
      </span>
      <span class="ceremony-toast__text">{fill(S.levelLine, { n: p.level })}</span>
      <span class="ceremony-toast__note muted">{S.levelNote}</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Host                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function CeremonyHost(): JSX.Element {
  const [, setTick] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hosts++;
    const offBus = startCeremonyBus();
    const offSub = subscribeCeremonies(() => setTick((t) => t + 1));
    schedule();
    return () => {
      offBus();
      offSub();
      hosts--;
      if (hosts === 0 && current) {
        // keep the ceremony for the next host instead of losing it
        queue.unshift(current);
        current = null;
      }
    };
  }, []);

  const c = current;
  const key = c ? ceremonyKey(c) : '';
  const modal = c !== null && c.kind !== 'level';
  // the overlay's kasure exit: one per ceremony (keyed, so the next ceremony can leave too)
  const exit = useExit(dismissCeremony, prefersReducedMotion(), key);

  // Focus into the dialog, lock page scroll, restore both on close.
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (previous && previous.isConnected) previous.focus();
    };
  }, [key, modal]);

  const reduced = prefersReducedMotion();
  const live = (
    <p class="visually-hidden ceremony-live" role="status" aria-live="polite" aria-atomic="true">
      {c ? announcementFor(c) : ''}
    </p>
  );
  if (!c) return live;
  if (c.kind === 'level') {
    return (
      <>
        {live}
        <LevelToast key={key} level={c.level} onDone={dismissCeremony} reduced={reduced} />
      </>
    );
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      exit.leave();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !isInteractive(e.target)) {
      e.preventDefault();
      exit.leave();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) trapTab(e, dialogRef.current);
  };
  const onClick = (e: MouseEvent): void => {
    if (isInteractive(e.target)) return;
    exit.leave();
  };

  let body: JSX.Element;
  switch (c.kind) {
    case 'badge':
      body = <BadgeSlam key={key} id={c.id} onDone={exit.leave} reduced={reduced} hostExit />;
      break;
    case 'belt': {
      const profile = store.profile.value;
      body = <BeltCeremony key={key} belt={c.belt} nameKana={profile.nameKana || profile.name || S.nameless} wallpaperId={BELT_WALLPAPER[c.belt]} onDone={exit.leave} reduced={reduced} hostExit />;
      break;
    }
    case 'wallpaper':
      body = <WallpaperUnlock key={key} id={c.id} quadrant={c.quadrant} onDone={exit.leave} reduced={reduced} hostExit />;
      break;
    case 'stamp':
      body = <StampPress key={key} station={c.station} perfect={c.perfect} assisted={c.assisted} onDone={exit.leave} reduced={reduced} hostExit />;
      break;
    default:
      body = <SummaryCard key={key} c={c} onDone={exit.leave} />;
  }

  return (
    <>
      {live}
      <div key={key} class={`ceremony ceremony--${c.kind}`} data-kind={c.kind} data-leaving={exit.leaving ? '' : undefined} onClick={onClick} onKeyDown={onKeyDown}>
        <div class="ceremony__backdrop" aria-hidden="true" />
        <div
          ref={(el) => {
            dialogRef.current = el;
            exit.ref(el);
          }}
          class={`ceremony__dialog ${verb(reduced, 'ink-nijimi')}`}
          role="dialog"
          aria-modal="true"
          aria-label={labelFor(c)}
          tabIndex={-1}
          data-leaving={exit.leaving ? '' : undefined}
        >
          {body}
          <p class="ceremony__hint">{S.skipHint}</p>
        </div>
      </div>
    </>
  );
}
