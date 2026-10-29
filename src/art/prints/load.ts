/**
 * TSUZUKU — fetching the print manifest (prints B1; the pattern of
 * `shared/koyomi.ts fetchKoyomi` and the voice pack's manifest read in
 * `audio/clips.ts`).
 *
 * `./art/manifest.json` is page-relative like `./audio/manifest.json` and is
 * fetched behind first paint: concurrent callers share the request and later
 * callers get the settled result without a second fetch. A 404 (no pack
 * built), a body that is not JSON or not a print pack, and a browser without
 * `fetch` settle as `artStatus 'none'` with a `null` manifest for the session
 * — never a throw, never a console line: a surface simply hangs no print. A
 * failure that may pass — the fetch threw (offline, a dropped connection) or
 * the answer was a 5xx (the worker answers an uncached manifest offline with
 * a 504) — also settles `'none'`, but forgets the request, so the next
 * `useArtManifest()` (a later Station, Road or About) asks again, as
 * `fetchKoyomi` does. A retry never shows `'loading'`: the status stays
 * `'none'` (the drawn fallback stays up; no surface swaps it for the waiting
 * box) and moves only on success. The result rides on two Preact signals;
 * `useArtManifest()` starts the load on first use and subscribes the caller.
 * `resetArtForTests()` forgets everything.
 *
 * A build without the pack knows it: vite.config.ts defines
 * `import.meta.env.VITE_ART_PACK` as `false` when `public/art/manifest.json`
 * was absent at build time (CI fetches the pack before it builds), and then
 * the status is `'none'` from module load — no surface waits on a round trip
 * to a 404 (which the worker never caches) before drawing its fallback. The
 * dev server and the tests leave the flag undefined and keep the fetch.
 */
import { batch, signal, type Signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { parseArtManifest, type ArtManifest } from './types';

export const ART_MANIFEST_URL = './art/manifest.json';

export type ArtStatus = 'idle' | 'loading' | 'ready' | 'none';

const env = import.meta.env as Record<string, unknown>;

/** `true` when the build defined `VITE_ART_PACK` false (no `public/art/manifest.json` at build time); `true`, unset or anything else keeps the fetch. */
export function builtWithoutPack(e: Record<string, unknown> = env): boolean {
  return e.VITE_ART_PACK === false || e.VITE_ART_PACK === 'false';
}

/** Where a session starts: `none` already in a build without the pack, `idle` otherwise. */
export function initialArtStatus(noPack: boolean = builtWithoutPack()): ArtStatus {
  return noPack ? 'none' : 'idle';
}

/** The parsed manifest, `null` until `ready`. */
export const artManifest: Signal<ArtManifest | null> = signal<ArtManifest | null>(null);
/** `idle` before the first call (`none` from the start in a build without the pack), `loading` while the first request is in flight, then `ready`, or `none` — for the session, or until a retry after a transient failure succeeds. */
export const artStatus: Signal<ArtStatus> = signal<ArtStatus>(initialArtStatus());

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The shared request: kept after a settled answer, cleared after a transient failure so the next caller retries. */
let pending: Promise<ArtManifest | null> | null = null;

/** A 5xx: the server, or the service worker standing in for it offline (504) — worth asking again later. */
const SERVER_ERROR = 500;

function defaultFetch(): FetchLike | null {
  return typeof fetch === 'function' ? (input, init) => fetch(input, init) : null;
}

function settle(parsed: ArtManifest | null): ArtManifest | null {
  batch(() => {
    artManifest.value = parsed;
    artStatus.value = parsed ? 'ready' : 'none';
  });
  return parsed;
}

/**
 * Fetches and parses the manifest; resolves `null` (status `none`) on any failure. Shared while in flight and after a
 * settled answer (`ready`, a 404, a bad body); forgotten after a thrown fetch or a 5xx so that a later call retries.
 */
export function loadArtManifest(fetchImpl?: typeof fetch, url: string = ART_MANIFEST_URL): Promise<ArtManifest | null> {
  if (pending) return pending;
  const f: FetchLike | null = fetchImpl ?? defaultFetch();
  // no fetch, or a build that shipped without the pack: settled `none` at once, nothing asked of the network
  if (!f || builtWithoutPack()) {
    pending = Promise.resolve(settle(null));
    return pending;
  }
  // only the first request reads as `loading`: a retry keeps `none` until it succeeds
  if (artStatus.value === 'idle') artStatus.value = 'loading';
  let attempt: Promise<ArtManifest | null> | null = null; // assigned below; compared by identity after the awaits
  const run = async (): Promise<ArtManifest | null> => {
    let parsed: ArtManifest | null = null;
    let transient = false;
    let res: Response | null = null;
    try {
      res = await f(url);
    } catch {
      transient = true; // the network itself: offline, a dropped connection, an abort
    }
    if (res) {
      if (res.ok) {
        try {
          parsed = parseArtManifest(await res.json());
        } catch {
          parsed = null; // not JSON: settled, like a wrong shape
        }
      } else if (res.status >= SERVER_ERROR) transient = true;
    }
    settle(parsed);
    if (!parsed && transient && pending === attempt) pending = null; // forget a transient failure (not one a reset or a newer call replaced)
    return parsed;
  };
  attempt = run();
  pending = attempt;
  return attempt;
}

/** Tests: forget the manifest, the status and any in-flight or settled fetch. */
export function resetArtForTests(): void {
  pending = null;
  batch(() => {
    artManifest.value = null;
    artStatus.value = initialArtStatus();
  });
}

/** The manifest for a component: starts the load on first use (or the retry after a transient failure), re-renders the caller when it lands. */
export function useArtManifest(): ArtManifest | null {
  useEffect(() => {
    void loadArtManifest();
  }, []);
  return artManifest.value;
}
