// @vitest-environment node
/**
 * public/sw.js evaluated inside a fake ServiceWorkerGlobalScope, plus the
 * build stamp vite.config.ts applies to it (node environment: the worker
 * needs no DOM, and importing vite.config.ts pulls in esbuild, which refuses jsdom).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SW_ASSETS_PLACEHOLDER, SW_STAMP_PLACEHOLDER, buildStamp, stampSw } from '../../vite.config';

const code = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
const VERSION = /const CACHE_VERSION = '([^']+)'/.exec(code)![1]!;
const SHELL = `tsuzuku-shell-${VERSION}`;
const RUNTIME = `tsuzuku-runtime-${VERSION}`;
const FONTS = 'tsuzuku-fonts-v1';
const ORIGIN = 'https://user.github.io';
const BASE = `${ORIGIN}/repo/`;

type Listener = (ev: unknown) => void;

interface RequestLike {
  url: string;
  method: string;
  mode?: string;
}

class FakeCache {
  readonly store = new Map<string, Response>();
  async put(req: RequestLike | string, res: Response): Promise<void> {
    this.store.set(typeof req === 'string' ? req : req.url, res);
  }
  async match(req: RequestLike | string): Promise<Response | undefined> {
    const hit = this.store.get(typeof req === 'string' ? req : req.url);
    return hit ? hit.clone() : undefined;
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
  async match(req: RequestLike | string): Promise<Response | undefined> {
    for (const c of this.caches.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface Scope {
  listeners: Map<string, Listener[]>;
  self: {
    location: { href: string };
    addEventListener(type: string, fn: Listener): void;
    clients: { claim: ReturnType<typeof vi.fn> };
    skipWaiting: ReturnType<typeof vi.fn>;
  };
  caches: FakeCacheStorage;
  fetch: ReturnType<typeof vi.fn>;
  dispatch(type: string, ev: unknown): void;
}

function load(fetchImpl: (req: RequestLike | string) => Promise<Response>, source: string = code): Scope {
  const listeners = new Map<string, Listener[]>();
  const self: Scope['self'] = {
    location: { href: `${BASE}sw.js` },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
  };
  const caches = new FakeCacheStorage();
  const fetch = vi.fn(fetchImpl);
  const run = new Function('self', 'caches', 'fetch', 'Response', 'URL', source) as (...a: unknown[]) => void;
  run(self, caches, fetch, Response, URL);
  return {
    listeners,
    self,
    caches,
    fetch,
    dispatch(type, ev) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
  };
}

function extendable(): { waitUntil(p: Promise<unknown>): void; done: Promise<unknown> } {
  let done: Promise<unknown> = Promise.resolve();
  return {
    waitUntil(p) {
      done = p;
    },
    get done() {
      return done;
    },
  };
}

function fetchEvent(req: RequestLike): { request: RequestLike; respondWith(p: Promise<Response>): void; response: Promise<Response> | null } {
  const ev = {
    request: req,
    response: null as Promise<Response> | null,
    respondWith(p: Promise<Response>) {
      ev.response = p;
    },
  };
  return ev;
}

const ok = (body: string, type = 'application/json'): Response => new Response(body, { status: 200, headers: { 'Content-Type': type } });
const urlOf = (req: RequestLike | string): string => (typeof req === 'string' ? req : req.url);

describe('public/sw.js', () => {
  it('declares a versioned cache name and a page-relative base', () => {
    expect(code).toMatch(/const CACHE_VERSION = '[^']+'/);
    expect(code).toMatch(/new URL\('\.\/', self\.location\.href\)/);
    expect(code).toContain("'SKIP_WAITING'");
  });

  it('CACHE_VERSION is the build placeholder, and the build stamp changes the worker bytes per release', () => {
    expect(VERSION).toBe(SW_STAMP_PLACEHOLDER);
    expect(code.split(SW_STAMP_PLACEHOLDER).length - 1).toBe(1);
    expect(code.split(SW_ASSETS_PLACEHOLDER).length - 1).toBe(1);
    const a = buildStamp('0.1.0', ['<html>a</html>', 'index-aaa.js']);
    const b = buildStamp('0.1.0', ['<html>a</html>', 'index-bbb.js']);
    expect(a).toMatch(/^0\.1\.0-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(buildStamp('0.1.0', ['<html>a</html>', 'index-aaa.js'])).toBe(a);
    const stamped = stampSw(code, a, ['assets/index-aaa.js', 'assets/index-bbb.css']);
    expect(stamped).not.toContain(SW_STAMP_PLACEHOLDER);
    expect(stamped).not.toContain(SW_ASSETS_PLACEHOLDER);
    expect(stamped).toContain(`const CACHE_VERSION = '${a}'`);
    expect(stamped).toContain("'assets/index-aaa.js,assets/index-bbb.css'");
    expect(stamped).not.toBe(code);
    expect(() => stampSw(stamped, b)).toThrow(/placeholder/);
    // An unstamped worker (dev, tests) precaches no assets; a name that would break the string literal is dropped.
    expect(stampSw(code, a)).toContain("'';");
    expect(stampSw(code, a, ["assets/x'y.js", 'assets/ok.js'])).toContain("'assets/ok.js'");
  });

  it('install precaches every stamped asset into the runtime cache, so one online visit makes the app work offline', async () => {
    const stamped = stampSw(code, '0.1.0-cafe0000', ['assets/index-E2lYAAt2.js', 'assets/index-BJTiF_er.css', 'assets/RoadPage-abc.js']);
    const sw = load(async (req) => (urlOf(req).includes('/assets/') ? ok('bytes', 'application/javascript') : ok('<!doctype html>', 'text/html')), stamped);
    const ev = extendable();
    sw.dispatch('install', ev);
    await ev.done;
    const runtime = sw.caches.caches.get('tsuzuku-runtime-0.1.0-cafe0000')!;
    expect(runtime, 'runtime cache').toBeDefined();
    for (const a of ['index-E2lYAAt2.js', 'index-BJTiF_er.css', 'RoadPage-abc.js']) expect(runtime.store.has(`${BASE}assets/${a}`)).toBe(true);
    expect(sw.caches.caches.get('tsuzuku-shell-0.1.0-cafe0000')!.store.has(`${BASE}index.html`)).toBe(true);
    // Offline now: the entry bundle is served from the cache without a network call.
    sw.fetch.mockImplementation(async () => {
      throw new TypeError('offline');
    });
    const js = fetchEvent({ url: `${BASE}assets/index-E2lYAAt2.js`, method: 'GET' });
    sw.dispatch('fetch', js);
    expect((await js.response!).status).toBe(200);
  });

  it('the unstamped worker precaches only the shell (no asset list), and install still succeeds when one asset 404s', async () => {
    const sw = load(async (req) => (urlOf(req).endsWith('.css') ? new Response('', { status: 404 }) : ok('x', 'text/html')));
    const ev = extendable();
    sw.dispatch('install', ev);
    await ev.done;
    expect(await sw.caches.keys()).toEqual([SHELL]);
    const stamped = stampSw(code, 'v', ['assets/a.js', 'assets/b.css']);
    const sw2 = load(async (req) => (urlOf(req).endsWith('.css') ? new Response('', { status: 404 }) : ok('x', 'text/html')), stamped);
    const ev2 = extendable();
    sw2.dispatch('install', ev2);
    await expect(ev2.done).resolves.toBeUndefined();
    const runtime = sw2.caches.caches.get('tsuzuku-runtime-v')!;
    expect(runtime.store.has(`${BASE}assets/a.js`)).toBe(true);
    expect(runtime.store.has(`${BASE}assets/b.css`)).toBe(false);
  });

  it('an uncached asset or font requested offline answers 504 instead of a rejected promise', async () => {
    const sw = load(async () => {
      throw new TypeError('offline');
    });
    const js = fetchEvent({ url: `${BASE}assets/Lazy-xyz.js`, method: 'GET' });
    sw.dispatch('fetch', js);
    const res = await js.response!;
    expect(res.status).toBe(504);
    const font = fetchEvent({ url: `${BASE}fonts/YujiSyuku-n5.woff2`, method: 'GET' });
    sw.dispatch('fetch', font);
    expect((await font.response!).status).toBe(504);
    expect(sw.caches.caches.has(RUNTIME)).toBe(false);
  });

  it('install precaches the shell (index.html + manifest) under the versioned cache', async () => {
    const sw = load(async (req) => ok(`<!doctype html>${urlOf(req)}`, 'text/html'));
    const ev = extendable();
    sw.dispatch('install', ev);
    await ev.done;
    const names = await sw.caches.keys();
    expect(names).toEqual([SHELL]);
    const shell = sw.caches.caches.get(SHELL)!;
    expect(shell.store.has(`${BASE}index.html`)).toBe(true);
    expect(shell.store.has(`${BASE}manifest.webmanifest`)).toBe(true);
    expect(shell.store.has(BASE)).toBe(true);
  });

  it('install survives an offline network (nothing cached, no throw)', async () => {
    const sw = load(async () => {
      throw new TypeError('offline');
    });
    const ev = extendable();
    sw.dispatch('install', ev);
    await expect(ev.done).resolves.toBeUndefined();
  });

  it('content item and bundle requests are not intercepted, even when an old runtime cache holds a stale copy', async () => {
    const sw = load(async () => ok('{"fresh":true}'));
    const item = `${BASE}content/vocab/n5/vocab-n5-001.json`;
    const bundle = `${BASE}content/stations/04.json`;
    const stale = await sw.caches.open('tsuzuku-runtime-v1');
    await stale.put(item, ok('{"cached":true}'));
    const first = fetchEvent({ url: item, method: 'GET', mode: 'cors' });
    sw.dispatch('fetch', first);
    const second = fetchEvent({ url: bundle, method: 'GET' });
    sw.dispatch('fetch', second);
    // The browser goes to the network itself; the loader's tsuzuku-content-<version> cache is the offline store.
    expect(first.response).toBeNull();
    expect(second.response).toBeNull();
    expect(sw.fetch).not.toHaveBeenCalled();
    expect(sw.caches.caches.has(RUNTIME)).toBe(false);
  });

  it('content/manifest.json is stale-while-revalidate: cached copy now, fresh copy for the next load', async () => {
    const sw = load(async () => ok('{"contentVersion":"2026.11"}'));
    const url = `${BASE}content/manifest.json`;
    const first = fetchEvent({ url, method: 'GET' });
    sw.dispatch('fetch', first);
    expect(await (await first.response!).text()).toBe('{"contentVersion":"2026.11"}');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    sw.fetch.mockImplementation(async () => ok('{"contentVersion":"2026.12"}'));
    const second = fetchEvent({ url, method: 'GET' });
    sw.dispatch('fetch', second);
    expect(await (await second.response!).text()).toBe('{"contentVersion":"2026.11"}');
    expect(sw.fetch).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 0));
    const third = fetchEvent({ url, method: 'GET' });
    sw.dispatch('fetch', third);
    expect(await (await third.response!).text()).toBe('{"contentVersion":"2026.12"}');
  });

  it('hashed assets are cache-first in the runtime cache; failed responses are never cached', async () => {
    const sw = load(async (req) => (urlOf(req).endsWith('.woff2') ? new Response('', { status: 404 }) : ok('js')));
    const js = fetchEvent({ url: `${BASE}assets/index-abc123.js`, method: 'GET' });
    sw.dispatch('fetch', js);
    expect((await js.response!).status).toBe(200);
    const font = fetchEvent({ url: `${BASE}fonts/missing.woff2`, method: 'GET' });
    sw.dispatch('fetch', font);
    expect((await font.response!).status).toBe(404);
    const runtime = sw.caches.caches.get(RUNTIME)!;
    expect(runtime.store.has(`${BASE}assets/index-abc123.js`)).toBe(true);
    expect(sw.caches.caches.get(FONTS)?.store.has(`${BASE}fonts/missing.woff2`) ?? false).toBe(false);
    const again = fetchEvent({ url: `${BASE}assets/index-abc123.js`, method: 'GET' });
    sw.dispatch('fetch', again);
    expect((await again.response!).status).toBe(200);
    expect(sw.fetch).toHaveBeenCalledTimes(2);
  });

  it('fonts are cache-first in the stable fonts cache that no release clears', async () => {
    const sw = load(async () => new Response('woff', { status: 200 }));
    const url = `${BASE}fonts/DotGothic16-base.woff2`;
    const ev = fetchEvent({ url, method: 'GET' });
    sw.dispatch('fetch', ev);
    expect((await ev.response!).status).toBe(200);
    expect(sw.caches.caches.get(FONTS)!.store.has(url)).toBe(true);
    expect(sw.caches.caches.has(RUNTIME)).toBe(false);
    const act = extendable();
    sw.dispatch('activate', act);
    await act.done;
    expect(await sw.caches.keys()).toContain(FONTS);
  });

  it('navigations are network-first and fall back to the cached index.html offline', async () => {
    let online = true;
    const sw = load(async () => {
      if (!online) throw new TypeError('offline');
      return ok('<!doctype html>live', 'text/html');
    });
    const nav = fetchEvent({ url: `${BASE}`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', nav);
    expect(await (await nav.response!).text()).toBe('<!doctype html>live');
    online = false;
    const offline = fetchEvent({ url: `${BASE}index.html`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', offline);
    const res = await offline.response!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<!doctype html>live');
  });

  it('a navigation to a non-HTML file under scope never replaces the cached shell', async () => {
    let online = true;
    const sw = load(async (req) => {
      if (!online) throw new TypeError('offline');
      const u = urlOf(req);
      if (u.endsWith('.json')) return ok('{"kana":[]}');
      if (u.endsWith('sw.js')) return ok("'use strict';", 'application/javascript');
      return ok('<!doctype html>shell', 'text/html');
    });
    const nav = fetchEvent({ url: `${BASE}`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', nav);
    await (await nav.response!).text();
    const json = fetchEvent({ url: `${BASE}content/kana/hiragana.json`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', json);
    expect(await (await json.response!).text()).toBe('{"kana":[]}');
    const js = fetchEvent({ url: `${BASE}sw.js`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', js);
    await (await js.response!).text();
    const shell = sw.caches.caches.get(SHELL)!;
    expect(shell.store.get(`${BASE}index.html`)!.headers.get('Content-Type')).toMatch(/^text\/html/);
    online = false;
    const offline = fetchEvent({ url: `${BASE}`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', offline);
    expect(await (await offline.response!).text()).toBe('<!doctype html>shell');
  });

  it('ignores non-GET, cross-origin and out-of-scope requests', () => {
    const sw = load(async () => ok('x'));
    const post = fetchEvent({ url: `${BASE}content/x.json`, method: 'POST' });
    sw.dispatch('fetch', post);
    const foreign = fetchEvent({ url: 'https://example.com/content/x.json', method: 'GET' });
    sw.dispatch('fetch', foreign);
    const outside = fetchEvent({ url: `${ORIGIN}/other/content/x.json`, method: 'GET' });
    sw.dispatch('fetch', outside);
    expect(post.response).toBeNull();
    expect(foreign.response).toBeNull();
    expect(outside.response).toBeNull();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it('activate deletes our shell/runtime caches from other builds, keeps the loader and fonts caches, and claims clients', async () => {
    const sw = load(async () => ok('x'));
    await sw.caches.open('tsuzuku-shell-v1');
    await sw.caches.open('tsuzuku-runtime-v1');
    await sw.caches.open('tsuzuku-shell-0.1.0-deadbeef');
    await sw.caches.open(SHELL);
    await sw.caches.open('tsuzuku-content-2026.10');
    await sw.caches.open(FONTS);
    const ev = extendable();
    sw.dispatch('activate', ev);
    await ev.done;
    const names = (await sw.caches.keys()).sort();
    expect(names).toEqual([SHELL, 'tsuzuku-content-2026.10', FONTS].sort());
    expect(sw.self.clients.claim).toHaveBeenCalledTimes(1);
  });

  it('audio sprites are NOT intercepted: the request passes through to the network and nothing is stored (design 08 §8)', async () => {
    const sw = load(async () => ok('bytes', 'video/webm'));
    const sprite = fetchEvent({ url: `${BASE}audio/sprites/s07/s-07-1-ab12cd34.webm`, method: 'GET' });
    sw.dispatch('fetch', sprite);
    const kana = fetchEvent({ url: `${BASE}audio/sprites/kana/row-a-00000000.webm`, method: 'GET', mode: 'cors' });
    sw.dispatch('fetch', kana);
    expect(sprite.response).toBeNull();
    expect(kana.response).toBeNull();
    expect(sw.fetch).not.toHaveBeenCalled();
    expect(await sw.caches.keys()).toEqual([]);
    // even when the audio bucket already holds something, a sprite request is never answered from here
    const bucket = await sw.caches.open('tsuzuku-audio-v1');
    await bucket.put(`${BASE}audio/sprites/s07/s-07-1-ab12cd34.webm`, ok('cached', 'video/webm'));
    const again = fetchEvent({ url: `${BASE}audio/sprites/s07/s-07-1-ab12cd34.webm`, method: 'GET' });
    sw.dispatch('fetch', again);
    expect(again.response).toBeNull();
  });

  it('audio/manifest.json and audio/<audioVersion>/*.json are stale-while-revalidate in tsuzuku-audio-v1, which survives activate; content/** stays untouched', async () => {
    const sw = load(async (req) => ok(urlOf(req).endsWith('manifest.json') ? '{"audioVersion":"a-1"}' : '{"v-n5-0001":{"start":0}}'));
    const manifest = `${BASE}audio/manifest.json`;
    const words = `${BASE}audio/a-0123456789/n5/words.json`;
    const first = fetchEvent({ url: manifest, method: 'GET' });
    sw.dispatch('fetch', first);
    expect(await (await first.response!).text()).toBe('{"audioVersion":"a-1"}');
    const w = fetchEvent({ url: words, method: 'GET' });
    sw.dispatch('fetch', w);
    expect(await (await w.response!).text()).toBe('{"v-n5-0001":{"start":0}}');
    expect(sw.fetch).toHaveBeenCalledTimes(2);
    const audio = sw.caches.caches.get('tsuzuku-audio-v1')!;
    expect(audio, 'audio bucket').toBeDefined();
    expect(audio.store.has(manifest)).toBe(true);
    expect(audio.store.has(words)).toBe(true);
    expect(sw.caches.caches.has(RUNTIME)).toBe(false);
    expect(sw.caches.caches.has(SHELL)).toBe(false);
    // stale copy now, the fresh copy on the next load
    sw.fetch.mockImplementation(async () => ok('{"audioVersion":"a-2"}'));
    const second = fetchEvent({ url: manifest, method: 'GET' });
    sw.dispatch('fetch', second);
    expect(await (await second.response!).text()).toBe('{"audioVersion":"a-1"}');
    await new Promise((r) => setTimeout(r, 0));
    const third = fetchEvent({ url: manifest, method: 'GET' });
    sw.dispatch('fetch', third);
    expect(await (await third.response!).text()).toBe('{"audioVersion":"a-2"}');
    // offline: the cached index still answers
    sw.fetch.mockImplementation(async () => {
      throw new TypeError('offline');
    });
    const offline = fetchEvent({ url: words, method: 'GET' });
    sw.dispatch('fetch', offline);
    expect((await offline.response!).status).toBe(200);
    // activate drops old shell / runtime caches and keeps the audio bucket
    await sw.caches.open('tsuzuku-shell-0.0.1-00000000');
    await sw.caches.open('tsuzuku-runtime-0.0.1-00000000');
    const act = extendable();
    sw.dispatch('activate', act);
    await act.done;
    const names = await sw.caches.keys();
    expect(names).toContain('tsuzuku-audio-v1');
    expect(names).not.toContain('tsuzuku-shell-0.0.1-00000000');
    expect(names).not.toContain('tsuzuku-runtime-0.0.1-00000000');
    expect(audio.store.has(manifest)).toBe(true);
    // content/** is still not intercepted
    const item = fetchEvent({ url: `${BASE}content/vocab/n5/vocab-n5-001.json`, method: 'GET' });
    sw.dispatch('fetch', item);
    const bundle = fetchEvent({ url: `${BASE}content/stations/07.json`, method: 'GET' });
    sw.dispatch('fetch', bundle);
    expect(item.response).toBeNull();
    expect(bundle.response).toBeNull();
    // the committed release pointer at the root is not an audio index
    const pointer = fetchEvent({ url: `${BASE}audio-pack.json`, method: 'GET' });
    sw.dispatch('fetch', pointer);
    expect(pointer.response).toBeNull();
  });

  it('SKIP_WAITING messages call skipWaiting; other messages are ignored', () => {
    const sw = load(async () => ok('x'));
    sw.dispatch('message', { data: { type: 'HELLO' } });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
    sw.dispatch('message', {});
  });
});
