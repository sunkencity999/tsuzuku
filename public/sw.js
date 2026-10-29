/*
 * TSUZUKU — service worker (group A, design 07 §10). Plain JS, no build step
 * beyond two stamps: `vite build` replaces the CACHE_VERSION placeholder with
 * `<pkg.version>-<hash of the built shell>` and the SHELL_ASSETS placeholder
 * with the comma-joined `assets/<hashed name>` list of the build
 * (vite.config.ts), so the worker's bytes change with every release, a new
 * worker installs, the Layout update toast fires, and `cleanOldCaches` drops
 * the previous release's shell and hashed assets. Fonts, the voice-pack
 * indexes and the print pack live in their own stable caches that no release clears.
 *
 * Why the assets are precached: on the first visit the page requests its own
 * entry JS/CSS before the worker controls it, so a runtime cache filled only
 * by `fetch` events stays empty until the second online load. Precaching the
 * whole `assets/` list (entry + lazy route/exercise chunks) at install makes
 * one visit enough for the shell AND every room to open offline.
 *
 * Scope is wherever this file is served from, so it works at
 * https://<user>.github.io/<repo>/ and at a custom root alike.
 *
 *   install   precache the shell (./, index.html, manifest, favicon, calendar/koyomi.json) into the
 *             shell cache and the build's assets/** into the runtime cache
 *   activate  drop our shell/runtime caches from other builds, claim clients
 *   fetch     navigations / index.html     → network-first; only an HTML
 *                                            response is stored as the shell
 *             content/manifest.json        → stale-while-revalidate (new content versions flow)
 *             content/**                   → NOT intercepted: the loader's own
 *                                            `tsuzuku-content-<version>` cache is the
 *                                            single offline store and is pruned per manifest
 *             audio/sprites/**             → NOT intercepted (design 08 §8): a cache-first
 *                                            rule here would grow Cache Storage without bound
 *                                            (Radio streams up to 45 min of sprites a sitting);
 *                                            src/audio/clips.ts owns the `tsuzuku-audio-v1`
 *                                            bucket and writes it only for the station prefetch
 *                                            and the belts the learner downloads, pruned per manifest
 *             audio/manifest.json,
 *             audio/<audioVersion>/**.json → stale-while-revalidate into the stable
 *                                            `tsuzuku-audio-v1` bucket (never cleared here)
 *             art/manifest.json            → network-first into the stable `tsuzuku-art-v1` bucket (design 09
 *                                            §12.1 d77–d78; never cleared here): a republished pack REPLACES the
 *                                            print files the deploy serves (CI's art:fetch unpacks only the new
 *                                            manifest's names), so the page must read the new manifest on the
 *                                            first load after it, not the next; the cached copy answers offline
 *                                            or on a 5xx, and a 4xx passes through (a build without the pack:
 *                                            the drawn room stands instead of a cached manifest's gone names)
 *             art/prints/**.webp           → cache-first in `tsuzuku-art-v1`: the names are content-addressed
 *                                            (`<id>-<sha8>.webp`), so a cached print is right for ever; a print
 *                                            the deploy no longer serves is a 404 the page shows as its LQIP
 *                                            (the pack is ≤ 30 MB; nothing is pruned)
 *             art-pack.json                → NOT intercepted: the committed build-time pointer; the page
 *                                            never fetches it
 *             assets/**                    → cache-first (hashed, immutable per release)
 *             fonts/**                     → cache-first in the stable fonts cache
 *             calendar/**                  → stale-while-revalidate in the shell cache (design 09 §4.3:
 *                                            the 72 kō names the Dojo column shows, 8 KB, offline from day one)
 *             (a cache-first miss while offline answers 504, never a rejected promise)
 *             manifest / favicon / sw.js   → stale-while-revalidate
 *   message   {type:'SKIP_WAITING'} → skipWaiting (the page asks after the learner taps Reload)
 *
 * The content loader keeps its own `tsuzuku-content-<version>` caches; we never touch those.
 */
'use strict';

const CACHE_VERSION = '__TSUZUKU_BUILD__';
const SHELL_CACHE = 'tsuzuku-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'tsuzuku-runtime-' + CACHE_VERSION;
const FONTS_CACHE = 'tsuzuku-fonts-v1';
// Shared with src/audio/clips.ts (AUDIO_CACHE): the worker only adds the small indexes to it.
const AUDIO_CACHE = 'tsuzuku-audio-v1';
// The print pack (src/art/prints, docs/ART_PACK.md §8): the manifest and the content-addressed prints.
const ART_CACHE = 'tsuzuku-art-v1';
const OWN_PREFIXES = ['tsuzuku-shell-', 'tsuzuku-runtime-'];
const BASE = new URL('./', self.location.href);
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './calendar/koyomi.json'].map(function (p) {
  return new URL(p, BASE).href;
});
const INDEX_URL = new URL('./index.html', BASE).href;
// Stamped by vite.config.ts; the unstamped placeholder yields an empty list (dev, tests).
const SHELL_ASSETS = '__TSUZUKU_SHELL_ASSETS__'
  .split(',')
  .filter(function (p) {
    return p.length > 0 && p.indexOf('__TSUZUKU_') !== 0;
  })
  .map(function (p) {
    return new URL('./' + p, BASE).href;
  });

function relativePath(url) {
  return url.href.startsWith(BASE.href) ? url.href.slice(BASE.href.length).split('?')[0].split('#')[0] : null;
}

function isHtml(response) {
  const type = (response && response.headers && response.headers.get('Content-Type')) || '';
  return type.toLowerCase().startsWith('text/html');
}

async function precacheInto(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.all(
    urls.map(async function (url) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res && res.ok) await cache.put(url, res);
      } catch (_) {
        /* offline during install: the fetch handler fills the gap online, the next install retries */
      }
    }),
  );
}

async function precacheShell() {
  await precacheInto(SHELL_CACHE, SHELL_URLS);
  if (SHELL_ASSETS.length > 0) await precacheInto(RUNTIME_CACHE, SHELL_ASSETS);
}

async function cleanOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(function (k) {
        return OWN_PREFIXES.some(function (p) {
          return k.startsWith(p);
        }) && k !== SHELL_CACHE && k !== RUNTIME_CACHE;
      })
      .map(function (k) {
        return caches.delete(k);
      }),
  );
}

async function putIfOk(cacheName, request, response) {
  if (!response || !response.ok) return response;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (_) {
    /* quota: serve without caching */
  }
  return response;
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    return await putIfOk(cacheName, request, res);
  } catch (_) {
    // Offline and not cached: a plain 504, so the page sees a failed load
    // instead of the worker surfacing an unhandled rejection.
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(function (res) {
      return putIfOk(cacheName, request, res);
    })
    .catch(function () {
      return null;
    });
  if (cached) {
    refresh.catch(function () {});
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response('', { status: 504, statusText: 'offline' });
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      // Only the app shell may become the offline fallback: a navigation to a
      // JSON file or sw.js under scope must never overwrite index.html.
      if (isHtml(res)) await putIfOk(SHELL_CACHE, INDEX_URL, res.clone());
      return res;
    }
    const cached = (await caches.match(request)) || (await caches.match(INDEX_URL));
    return cached || res;
  } catch (_) {
    const cached = (await caches.match(request)) || (await caches.match(INDEX_URL));
    return cached || new Response('<!doctype html><title>TSUZUKU</title><p>Offline. The dojo opens again when the network returns.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

// Network-first for a small index whose names a deploy may replace (the print manifest): the live copy whenever
// the network answers, the cached copy when it cannot (offline, a 5xx), and a 4xx passed through — the server's
// own word that the file is not in this deploy, which a cached copy must not contradict.
async function networkFirstInto(request, cacheName) {
  let res = null;
  try {
    res = await fetch(request);
  } catch (_) {
    res = null;
  }
  if (res && res.ok) return putIfOk(cacheName, request, res);
  if (res && res.status < 500) return res;
  const cached = await caches.match(request);
  return cached || res || new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('install', function (event) {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    cleanOldCaches().then(function () {
      return self.clients && self.clients.claim ? self.clients.claim() : undefined;
    }),
  );
});

self.addEventListener('message', function (event) {
  const data = event && event.data;
  if (data && data.type === 'SKIP_WAITING' && self.skipWaiting) self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== BASE.origin) return;
  const rel = relativePath(url);
  if (rel === null) return;

  if (request.mode === 'navigate' || rel === '' || rel === 'index.html') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (rel === 'content/manifest.json') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }
  if (rel.startsWith('content/')) {
    // Unversioned paths: left to the network and the loader's versioned cache.
    return;
  }
  if (rel.startsWith('audio/sprites/')) {
    // Pass-through: clips.ts reads the audio bucket itself and fills it only on prefetch / download.
    return;
  }
  if (rel === 'audio/manifest.json' || (rel.startsWith('audio/') && rel.endsWith('.json'))) {
    event.respondWith(staleWhileRevalidate(request, AUDIO_CACHE));
    return;
  }
  if (rel === 'art/manifest.json') {
    event.respondWith(networkFirstInto(request, ART_CACHE));
    return;
  }
  if (rel.startsWith('art/prints/') && rel.endsWith('.webp')) {
    event.respondWith(cacheFirst(request, ART_CACHE));
    return;
  }
  if (rel.startsWith('calendar/')) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
  if (rel.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }
  if (rel.startsWith('fonts/')) {
    event.respondWith(cacheFirst(request, FONTS_CACHE));
    return;
  }
  if (rel === 'manifest.webmanifest' || rel === 'favicon.svg' || rel === 'sw.js') {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
