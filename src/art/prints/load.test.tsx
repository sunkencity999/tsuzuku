/**
 * load.ts — one page-relative fetch (shared in flight, settled after): 404 / bad JSON / wrong shape / no fetch → status
 * none and a null manifest for the session; a thrown fetch or a 5xx (offline, the worker's 504) → none for now and a
 * retry on the next call that never shows loading; no throw and no console line either way; the hook loads on first use;
 * a build without the pack (vite.config.ts `VITE_ART_PACK` false) starts at none and never asks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { vi, type MockInstance } from 'vitest';
import { makeFixtureManifestJson } from './fixtures';
import { ART_MANIFEST_URL, artManifest, artStatus, builtWithoutPack, initialArtStatus, loadArtManifest, resetArtForTests, useArtManifest } from './load';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const asFetch = (f: FetchFn): typeof fetch => f as unknown as typeof fetch;
const okFetch = (body: unknown = makeFixtureManifestJson()) => vi.fn<FetchFn>(async () => ({ ok: true, json: async () => body }) as unknown as Response);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const CONSOLE = ['error', 'warn', 'log', 'info', 'debug'] as const;
let spies: MockInstance[] = [];
beforeEach(() => {
  resetArtForTests();
  spies = CONSOLE.map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => {
  for (const s of spies) expect(s).not.toHaveBeenCalled();
  for (const s of spies) s.mockRestore();
  vi.unstubAllGlobals();
  resetArtForTests();
});

describe('loadArtManifest', () => {
  it('fetches ./art/manifest.json once, shares the in-flight request, settles ready and never refetches', async () => {
    const f = okFetch();
    expect(artStatus.value).toBe('idle');
    const p1 = loadArtManifest(asFetch(f));
    const p2 = loadArtManifest(asFetch(f));
    expect(artStatus.value).toBe('loading');
    expect(p1).toBe(p2);
    const [a, b] = await Promise.all([p1, p2]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(ART_MANIFEST_URL);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a?.prints).toHaveLength(4);
    expect(artManifest.value).toBe(a);
    expect(artStatus.value).toBe('ready');
    expect(await loadArtManifest(asFetch(f))).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a 404 settles none with a null manifest, and the session does not ask again', async () => {
    const f = vi.fn<FetchFn>(async () => ({ ok: false, status: 404 }) as unknown as Response);
    expect(await loadArtManifest(asFetch(f))).toBeNull();
    expect(artStatus.value).toBe('none');
    expect(artManifest.value).toBeNull();
    expect(await loadArtManifest(asFetch(f))).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    // settled: a later caller with a working network is not asked either
    const good = okFetch();
    expect(await loadArtManifest(asFetch(good))).toBeNull();
    expect(good).not.toHaveBeenCalled();
    expect(artStatus.value).toBe('none');
  });

  it('any other 4xx is settled like a 404', async () => {
    const gone = vi.fn<FetchFn>(async () => ({ ok: false, status: 410 }) as unknown as Response);
    expect(await loadArtManifest(asFetch(gone))).toBeNull();
    expect(await loadArtManifest(asFetch(gone))).toBeNull();
    expect(gone).toHaveBeenCalledTimes(1);
    expect(artStatus.value).toBe('none');
  });

  it('a thrown fetch (offline) settles none without throwing — and forgets the request: the next caller asks again, the status stays none meanwhile (never back to loading), and a good answer promotes it to ready', async () => {
    const boom = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(loadArtManifest(asFetch(boom))).resolves.toBeNull();
    expect(artStatus.value).toBe('none');
    expect(artManifest.value).toBeNull();
    // still offline: another try, another none, no loading in between
    const again = loadArtManifest(asFetch(boom));
    expect(artStatus.value).toBe('none');
    await expect(again).resolves.toBeNull();
    expect(boom).toHaveBeenCalledTimes(2);
    expect(artStatus.value).toBe('none');
    // back online
    const good = okFetch();
    const p = loadArtManifest(asFetch(good));
    expect(artStatus.value).toBe('none');
    expect(await p).not.toBeNull();
    expect(good).toHaveBeenCalledTimes(1);
    expect(artStatus.value).toBe('ready');
    expect(artManifest.value?.prints).toHaveLength(4);
    // settled for good: no further fetch
    expect(await loadArtManifest(asFetch(good))).toBe(artManifest.value);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("a 5xx — the worker's 504 for a manifest it never cached, offline — is transient too: none now, asked again later; callers during the retry share one request", async () => {
    const gateway = vi.fn<FetchFn>(async () => ({ ok: false, status: 504 }) as unknown as Response);
    expect(await loadArtManifest(asFetch(gateway))).toBeNull();
    expect(artStatus.value).toBe('none');
    const p1 = loadArtManifest(asFetch(gateway));
    const p2 = loadArtManifest(asFetch(gateway));
    expect(p1).toBe(p2);
    expect(artStatus.value).toBe('none');
    expect(await Promise.all([p1, p2])).toEqual([null, null]);
    expect(gateway).toHaveBeenCalledTimes(2);
    const good = okFetch();
    expect(await loadArtManifest(asFetch(good))).not.toBeNull();
    expect(artStatus.value).toBe('ready');
  });

  it('a body that is not JSON settles none for the session', async () => {
    const bad = vi.fn<FetchFn>(async () => ({ ok: true, json: async () => Promise.reject(new SyntaxError('nope')) }) as unknown as Response);
    expect(await loadArtManifest(asFetch(bad))).toBeNull();
    expect(artStatus.value).toBe('none');
    const good = okFetch();
    expect(await loadArtManifest(asFetch(good))).toBeNull();
    expect(good).not.toHaveBeenCalled();
  });

  it('well-formed JSON that is not a print pack settles none for the session', async () => {
    expect(await loadArtManifest(asFetch(okFetch({ schema: 'tsuzuku.audio/1', audioVersion: 'a-1' })))).toBeNull();
    expect(artStatus.value).toBe('none');
    expect(artManifest.value).toBeNull();
    const good = okFetch();
    expect(await loadArtManifest(asFetch(good))).toBeNull();
    expect(good).not.toHaveBeenCalled();
  });

  it('a browser without fetch settles none at once', async () => {
    vi.stubGlobal('fetch', undefined);
    expect(await loadArtManifest()).toBeNull();
    expect(artStatus.value).toBe('none');
  });

  it('uses the global fetch by default', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    expect(await loadArtManifest()).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[0]).toBe(ART_MANIFEST_URL);
    expect(artStatus.value).toBe('ready');
  });

  it('resetArtForTests forgets the result so the next call fetches again', async () => {
    const f = okFetch();
    await loadArtManifest(asFetch(f));
    resetArtForTests();
    expect(artStatus.value).toBe('idle');
    expect(artManifest.value).toBeNull();
    await loadArtManifest(asFetch(f));
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('useArtManifest', () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  function Probe() {
    const m = useArtManifest();
    return <p data-status={artStatus.value}>{m ? m.artVersion : 'none'}</p>;
  }

  it('starts the load on first use and re-renders the caller when the manifest lands', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    act(() => render(<Probe />, root));
    const p = (): HTMLElement => root.querySelector('p')!;
    expect(f).toHaveBeenCalledTimes(1);
    expect(p().textContent).toBe('none');
    expect(p().getAttribute('data-status')).toBe('loading');
    await act(async () => {
      await tick();
    });
    expect(p().textContent).toBe('p-0123456789');
    expect(p().getAttribute('data-status')).toBe('ready');
    // a second mount reads the settled manifest without another fetch
    render(null, root);
    act(() => render(<Probe />, root));
    expect(p().textContent).toBe('p-0123456789');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('renders none when there is no pack, and stays quiet', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>(async () => ({ ok: false, status: 404 }) as unknown as Response));
    act(() => render(<Probe />, root));
    await act(async () => {
      await tick();
    });
    expect(root.querySelector('p')?.textContent).toBe('none');
    expect(root.querySelector('p')?.getAttribute('data-status')).toBe('none');
  });

  it('a mount after a failed first request (offline) asks again — the probe reads none, never loading, until the manifest lands', async () => {
    const boom = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', boom);
    act(() => render(<Probe />, root));
    await act(async () => {
      await tick();
    });
    expect(root.querySelector('p')?.getAttribute('data-status')).toBe('none');
    expect(boom).toHaveBeenCalledTimes(1);
    render(null, root);
    const good = okFetch();
    vi.stubGlobal('fetch', good);
    act(() => render(<Probe />, root));
    expect(good).toHaveBeenCalledTimes(1);
    expect(root.querySelector('p')?.getAttribute('data-status')).toBe('none');
    await act(async () => {
      await tick();
    });
    expect(root.querySelector('p')?.textContent).toBe('p-0123456789');
    expect(root.querySelector('p')?.getAttribute('data-status')).toBe('ready');
  });
});

describe('a build without the pack (vite.config.ts VITE_ART_PACK)', () => {
  it('builtWithoutPack reads the build flag: false (or its string) means no pack; true, unset or anything else keeps the fetch; the test run is not a build', () => {
    expect(builtWithoutPack({ VITE_ART_PACK: false })).toBe(true);
    expect(builtWithoutPack({ VITE_ART_PACK: 'false' })).toBe(true);
    expect(builtWithoutPack({ VITE_ART_PACK: true })).toBe(false);
    expect(builtWithoutPack({ VITE_ART_PACK: 'true' })).toBe(false);
    expect(builtWithoutPack({ VITE_ART_PACK: 0 })).toBe(false);
    expect(builtWithoutPack({})).toBe(false);
    expect(initialArtStatus(true)).toBe('none');
    expect(initialArtStatus(false)).toBe('idle');
    expect(builtWithoutPack()).toBe(false);
    expect(initialArtStatus()).toBe('idle');
    expect(artStatus.value).toBe('idle');
  });

  it('with the flag false the module starts at none and loadArtManifest settles at once without touching the network', async () => {
    vi.stubEnv('VITE_ART_PACK', 'false');
    vi.resetModules();
    try {
      const fresh = await import('./load');
      expect(fresh.builtWithoutPack()).toBe(true);
      expect(fresh.artStatus.value).toBe('none');
      expect(fresh.artManifest.value).toBeNull();
      const f = okFetch();
      expect(await fresh.loadArtManifest(asFetch(f))).toBeNull();
      expect(f).not.toHaveBeenCalled();
      expect(fresh.artStatus.value).toBe('none');
      // a reset keeps the build's word
      fresh.resetArtForTests();
      expect(fresh.artStatus.value).toBe('none');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('vite.config.ts defines the flag for the build only, from public/art/manifest.json on disk (CI fetches the pack before it builds)', () => {
    const cfg = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/export function artPackBuilt\([\s\S]*?\): boolean \{\s*return existsSync\(resolve\(root, 'public', 'art', 'manifest\.json'\)\);/);
    expect(cfg).toMatch(/\.\.\.\(command === 'build' \? \{ 'import\.meta\.env\.VITE_ART_PACK': JSON\.stringify\(artPackBuilt\(\)\) \} : \{\}\)/);
    // the deploy fetches the pack before the build, so the flag sees the fetched manifest
    const deploy = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy.indexOf('npm run art:fetch -- --optional')).toBeGreaterThan(-1);
    expect(deploy.indexOf('npm run art:fetch -- --optional')).toBeLessThan(deploy.indexOf('npm run build'));
  });
});
