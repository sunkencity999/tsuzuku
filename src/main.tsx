/**
 * TSUZUKU — composition root (group A, ARCHITECTURE §0 exception).
 *
 * The ONLY module that may hand `() => Date.now()` to `initStore()` and the
 * only one (with `app/pages.ts`) that imports other groups' barrels:
 *
 *   render(<App overlays={signal}/>)  first paint: the つづく loading mark while the save loads
 *   initStore({slot, now, storage})   → await ready → the Layout and the page render
 *   startPerapera(store)              monthly Perapera snapshot (now + every day:rolled)
 *   startRouter() · registerSw()
 *   installServices(createWebAudio({ clips }), createStt())   from @/audio (F), fire-and-forget;
 *     clips = createClipPlayer({ prefetchAllowed }) — the voice pack (design 08 §8) reads
 *     ./audio/manifest.json behind first paint (404 → device voice only, never a throw);
 *     once the services are in, the current station's small indexes load at once (so the
 *     first speak() hits the pack) and its sprites prefetch at the next idle moment
 *     (`whenIdle`) unless the learner's `settings.dataSaver` or
 *     `navigator.connection.saveData` says not to
 *   loadOverlays() → overlays.value   CeremonyHost from @/art (G), fire-and-forget; it also hands
 *     `isCeremonyOpen` to app/transitions.ts (design 09 §6.4) so no page turn starts under a ceremony
 *
 * Nothing but the store blocks first paint (design 07 §9 budgets): audio, the
 * ceremony overlay and the exercise registry load behind it (`pages.ts`
 * fills the registry per route, the Dojo included). Every optional barrel
 * degrades: no audio module → silent `nullAudio`; no art → no ceremonies;
 * the shell itself always renders. First-run detection lives in
 * `app/first-run.ts` (shared with the Dojo) and is re-exported here.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import { installServices, saveDataRequested as sharedSaveDataRequested, services, type ClipPlayer } from '@/shared/audio';
import { navigate, route } from '@/shared/routes';
import { initStore, store } from '@/store';
import { startPerapera } from '@/store/derived';
import { S } from '@/i18n/strings';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/arcade.css';
import '@/styles/motion.css';
import { App } from './app/App';
import { isFirstRun } from './app/first-run';
import { startRouter } from './app/router';
import { registerSw } from './app/sw-register';
import { setCeremonyProbe } from './app/transitions';
import type { FunctionComponent } from 'preact';

export interface BootOptions {
  /** Defaults to `localStorage` when reachable (the store falls back otherwise). */
  storage?: Storage;
  /** Defaults to the wall clock. */
  now?: () => number;
  /** Save slot (0 = default). */
  slot?: number;
  /** Load `@/audio` and install the real services (default true; tests keep `nullAudio`). */
  audio?: boolean;
  /**
   * The voice pack player to hand `createWebAudio` (design 08 §8). Default: the
   * barrel's `createClipPlayer()`; `null` installs the device voice alone. Tests
   * pass a double to watch the boot prefetch.
   */
  clips?: ClipPlayer | null;
  /** Load `@/art` for the ceremony overlay (default true). */
  overlays?: boolean;
  /** Register the service worker (default true; a no-op outside production). */
  sw?: boolean;
}

function browserStorage(): Storage | undefined {
  try {
    const s = globalThis.localStorage;
    // Touching it can throw in locked-down contexts.
    s.getItem('tsuzuku.probe');
    return s;
  } catch {
    return undefined;
  }
}

type AnyModule = Record<string, unknown>;

/**
 * F's audio barrel and G's art barrel, loaded lazily through `import.meta.glob`
 * over their exact paths: Vite code-splits them like a literal `import()`, but a
 * barrel that is not built yet is simply absent instead of a build error.
 */
const OPTIONAL = import.meta.glob<AnyModule>(['/src/audio/index.ts', '/src/art/index.ts', '/src/art/ceremony/CeremonyHost.tsx']);
export const AUDIO_BARREL = 'src/audio/index.ts';
export const ART_BARREL = 'src/art/index.ts';
/** `isCeremonyOpen()` for the shell's page turns (design 09 §6.4); the shell may not import the art tier itself. */
export const CEREMONY_HOST = 'src/art/ceremony/CeremonyHost.tsx';

async function optional(file: string, what: string): Promise<AnyModule | null> {
  const loader = OPTIONAL[`/${file}`];
  if (!loader) {
    console.warn(`[boot] ${what} unavailable: ${file} is not built yet`);
    return null;
  }
  try {
    return await loader();
  } catch (err) {
    console.warn(`[boot] ${what} unavailable`, err);
    return null;
  }
}

/** `navigator.connection.saveData` — the contract-tier body in `@/shared/audio`, re-exported for the boot tests. */
export { saveDataRequested } from '@/shared/audio';

/** Design 08 §13: no idle sprite prefetch under the learner's data saver or the browser's. */
export function prefetchAllowed(): boolean {
  return !store.settings.value.dataSaver && !sharedSaveDataRequested();
}

/** Fallback delay for `whenIdle` where `requestIdleCallback` is missing (Safari). */
export const IDLE_FALLBACK_MS = 2000;

/** Runs `fn` once the browser is idle (`requestIdleCallback`, 5 s ceiling), else after `IDLE_FALLBACK_MS`. */
export function whenIdle(fn: () => void): void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(fn, { timeout: 5000 });
  else setTimeout(fn, IDLE_FALLBACK_MS);
}

async function installAudio(o: BootOptions): Promise<void> {
  const m = await optional(AUDIO_BARREL, 'audio services');
  if (!m) {
    // Settle: `servicesVersion` bumps so Settings / About stop saying "Looking for the voice pack" (nullAudio stays).
    installServices({});
    return;
  }
  let clips: ClipPlayer | undefined;
  try {
    if (o.clips === undefined) {
      // The pack reads ./audio/manifest.json behind first paint; a 404 makes it `absent`, never a throw.
      clips =
        typeof m.createClipPlayer === 'function'
          ? (m.createClipPlayer as (opts: { prefetchAllowed: () => boolean }) => ClipPlayer)({ prefetchAllowed })
          : undefined;
    } else clips = o.clips ?? undefined;
  } catch (err) {
    console.warn('[boot] voice pack unavailable', err);
    clips = undefined;
  }
  try {
    const audio = typeof m.createWebAudio === 'function' ? (m.createWebAudio as (opts: { clips?: ClipPlayer }) => unknown)({ clips }) : undefined;
    const stt = typeof m.createStt === 'function' ? (m.createStt as () => unknown)() : undefined;
    installServices({
      audio: audio as Parameters<typeof installServices>[0]['audio'],
      stt: stt as Parameters<typeof installServices>[0]['stt'],
    });
  } catch (err) {
    // Silence is a feature, not a crash: nullAudio stays installed — but settle so the pack card stops waiting.
    console.warn('[boot] audio services failed to start', err);
    installServices({});
    return;
  }
  if (!clips) return;
  const player = clips;
  const station = Math.max(1, store.progress.value.station);
  // The station's small indexes load now, data saver or not, so the first speak() hits the pack (design 08 §13
  // limits data saver to sprites); the 1–3 MB sprite prefetch waits for an idle moment and re-checks the setting.
  try {
    void Promise.resolve(player.loadStation(station)).catch(() => undefined);
  } catch (err) {
    console.warn('[boot] voice pack index load skipped', err);
  }
  if (!prefetchAllowed()) return;
  whenIdle(() => {
    try {
      if (services.audio.clips === player && prefetchAllowed()) player.prefetchStation(station);
    } catch (err) {
      console.warn('[boot] voice pack prefetch skipped', err);
    }
  });
}

async function loadOverlays(): Promise<FunctionComponent[]> {
  const m = await optional(ART_BARREL, 'ceremonies');
  if (m && typeof m.CeremonyHost === 'function') {
    // Same module graph as the barrel (Vite dedupes): the probe keeps a page turn from starting under a ceremony.
    const host = await optional(CEREMONY_HOST, 'ceremony probe');
    if (host && typeof host.isCeremonyOpen === 'function') setCeremonyProbe(host.isCeremonyOpen as () => boolean);
    return [m.CeremonyHost as FunctionComponent];
  }
  return [];
}

export { isFirstRun };

let stopRouter: (() => void) | null = null;
let stopPerapera: (() => void) | null = null;

/** Boots the app into `root`. Never throws for optional pieces; the shell always renders. */
export async function boot(root: HTMLElement, o: BootOptions = {}): Promise<void> {
  stopRouter?.();
  stopRouter = null;
  stopPerapera?.();
  stopPerapera = null;
  const now = o.now ?? ((): number => Date.now());

  // Paint first: `store.ready` is false until initStore resolves, so the App
  // shows its loading mark instead of a blank screen while the save loads.
  const overlays = signal<FunctionComponent[]>([]);
  render(<App overlays={overlays} />, root);

  await initStore({ slot: o.slot ?? 0, now, storage: o.storage ?? browserStorage() });
  // store/day.ts leaves the month snapshot to perapera (it needs @/learn, which
  // the store barrel may not import), so the composition root wires it here.
  stopPerapera = startPerapera(store);

  // A brand-new learner lands at Nihonbashi; deep links are left alone.
  if (route.peek().name === 'dojo' && isFirstRun()) navigate({ name: 'onboarding' }, { replace: true });

  stopRouter = startRouter();
  if (o.sw !== false) void registerSw();

  // Behind first paint: audio services and the ceremony overlay.
  if (o.audio !== false) void installAudio(o);
  if (o.overlays !== false) {
    void loadOverlays().then((list) => {
      overlays.value = list;
    });
  }
}

function showFatal(root: HTMLElement, err: unknown): void {
  console.error('[boot] failed', err);
  const message = err instanceof Error ? err.message : String(err);
  root.replaceChildren();
  const box = document.createElement('section');
  box.className = 'app-error status-window';
  box.setAttribute('role', 'alert');
  const h = document.createElement('h1');
  h.textContent = S.errorTitle;
  const p = document.createElement('p');
  p.textContent = S.errorBody;
  const pre = document.createElement('pre');
  pre.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hanko';
  btn.textContent = S.reload;
  btn.addEventListener('click', () => location.reload());
  box.append(h, p, pre, btn);
  root.appendChild(box);
}

if (import.meta.env.MODE !== 'test' && typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) boot(root).catch((err: unknown) => showFatal(root, err));
}
