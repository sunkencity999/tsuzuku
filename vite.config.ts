/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';

/* ── service-worker build stamp ──────────────────────────────────────────
 * public/sw.js is copied verbatim, and a browser installs a new worker only
 * when the script bytes differ. `CACHE_VERSION` there is the placeholder
 * below; after the bundle is written we replace it with
 * `<pkg.version>-<sha256 of index.html + the hashed asset names>`, so every
 * release that changes the shell ships a new worker (update toast, old caches
 * dropped) while a byte-identical rebuild stays quiet. The second placeholder
 * receives the comma-joined `assets/<hashed name>` list so the worker can
 * precache the entry bundle and the lazy chunks at install (one online visit
 * makes the whole app available offline; see public/sw.js).
 */
export const SW_STAMP_PLACEHOLDER = '__TSUZUKU_BUILD__';
export const SW_ASSETS_PLACEHOLDER = '__TSUZUKU_SHELL_ASSETS__';

/** `<version>-<8 hex>` over the given build inputs (deterministic). */
export function buildStamp(version: string, inputs: readonly string[]): string {
  const h = createHash('sha256');
  for (const s of inputs) h.update(s).update('\0');
  return `${version}-${h.digest('hex').slice(0, 8)}`;
}

/**
 * Replaces both placeholders in the worker source (`stamp` for the cache
 * version, `assets` as the comma-joined precache list, e.g. `assets/index-abc.js`);
 * throws when either placeholder is gone, so a stamped worker is never re-stamped.
 */
export function stampSw(code: string, stamp: string, assets: readonly string[] = []): string {
  for (const ph of [SW_STAMP_PLACEHOLDER, SW_ASSETS_PLACEHOLDER]) {
    if (!code.includes(ph)) throw new Error(`sw.js: missing ${ph} placeholder`);
  }
  const list = assets.filter((a) => a.length > 0 && !/[,'\\\n]/.test(a)).join(',');
  return code.split(SW_STAMP_PLACEHOLDER).join(stamp).split(SW_ASSETS_PLACEHOLDER).join(list);
}

function swStampPlugin(): Plugin {
  let outDir = resolve('dist');
  return {
    name: 'tsuzuku:sw-stamp',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const swPath = resolve(outDir, 'sw.js');
      const indexPath = resolve(outDir, 'index.html');
      if (!existsSync(swPath) || !existsSync(indexPath)) return;
      const assetsDir = resolve(outDir, 'assets');
      const assets = existsSync(assetsDir) ? readdirSync(assetsDir).sort() : [];
      const stamp = buildStamp(pkg.version, [readFileSync(indexPath, 'utf8'), ...assets]);
      // Every emitted asset (entry + lazy chunks + CSS): ~1.4 MB, cached once per release.
      const precache = assets.filter((name) => /\.(?:js|css|woff2?|svg|png|webp)$/i.test(name)).map((name) => `assets/${name}`);
      writeFileSync(swPath, stampSw(readFileSync(swPath, 'utf8'), stamp, precache));
    },
  };
}

/* ── the print pack's build flag ─────────────────────────────────────────
 * `import.meta.env.VITE_ART_PACK` (the build only): whether
 * `public/art/manifest.json` was on disk when the bundle was built. CI runs
 * `art:fetch` before `build` (deploy.yml), so `false` is a deploy without the
 * pack: `src/art/prints/load.ts` then settles `artStatus 'none'` before first
 * paint and the Dojo draws its room at once, instead of holding an empty box
 * for a network round trip to a 404 on every session (the worker never caches
 * a 404). The dev server and vitest leave it undefined and keep the fetch: dev
 * serves whatever `public/art` holds, tests stub `fetch`.
 */
export function artPackBuilt(root: string = fileURLToPath(new URL('.', import.meta.url))): boolean {
  return existsSync(resolve(root, 'public', 'art', 'manifest.json'));
}

// base './' makes the build relocatable: works at https://<user>.github.io/<repo>/
// and at a custom domain root, because routing is hash-based.
export default defineConfig(({ command }) => ({
  base: './',
  // `import.meta.env.VITE_APP_VERSION` = package.json's version (About page); `VITE_ART_PACK` as above, builds only.
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    ...(command === 'build' ? { 'import.meta.env.VITE_ART_PACK': JSON.stringify(artPackBuilt()) } : {}),
  },
  plugins: [preact(), swStampPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
}));
