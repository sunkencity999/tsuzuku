/**
 * TSUZUKU — pack the rendered audio into release assets (design 08 §7 step 8).
 *
 *   node scripts/audio/pack.ts [--audio public/audio] [--out .audio-cache/release] [--pointer public/audio-pack.json]
 *
 * One tar per tier, `tsuzuku-audio-<audioVersion>-<tier>.tar`, built with the
 * system `tar` (`-C public/audio -T <list>`; GNU tar and bsdtar both take a
 * list file). The `core` tar carries `manifest.json` and every index (the
 * check-only `files.json` / `kana.json` sidecars included) beside its sprites;
 * `pool` and `ear` carry their sprites only (the indexes already describe
 * every tier). A dry-run or PARTIAL manifest (`--stations`, `--limit`) is
 * refused: only a whole-corpus real render is packed. The committed pointer
 * `public/audio-pack.json` (`tsuzuku.audio-pack/1`) is rewritten with the tag,
 * the assets' sha256 and bytes and the credit list — the build fetches
 * exactly these.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AudioManifest, type AudioPackPointer, type PackAsset, assetName, PACK_REPO, PACK_SCHEMA, releaseTag } from './indexes.ts';
import { sha256Hex } from './sprites.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');

/** Paths (relative to `public/audio/`) that belong in a tier's tar. */
export function tarPaths(manifest: AudioManifest, tier: string): string[] {
  const out = manifest.files.filter((f) => f.tier === tier).map((f) => f.path);
  if (tier === 'core') out.push('manifest.json', ...manifest.indexes.map((i) => i.path));
  return out.sort();
}

/** The tiers the manifest holds files for (`core` first). */
export function tiersOf(manifest: AudioManifest): string[] {
  const set = new Set<string>(manifest.files.map((f) => f.tier));
  set.add('core');
  return [...set].sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a < b ? -1 : 1));
}

/** The pointer file for a set of built assets. */
export function buildPointer(manifest: AudioManifest, assets: PackAsset[], repo = PACK_REPO): AudioPackPointer {
  return { schema: PACK_SCHEMA, repo, audioVersion: manifest.audioVersion, tag: releaseTag(manifest.audioVersion), assets: [...assets].sort((a, b) => (a.name < b.name ? -1 : 1)), credits: [...manifest.credits] };
}

/** An empty pointer: no pack, `speechSynthesis` only. */
export function emptyPointer(repo = PACK_REPO): AudioPackPointer {
  return { schema: PACK_SCHEMA, repo, audioVersion: null, tag: null, assets: [], credits: [] };
}

export interface PackOptions {
  audioDir: string;
  outDir: string;
  pointerPath: string;
  tar?: string;
  log?: (s: string) => void;
}

export function pack(o: PackOptions): AudioPackPointer {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const manifestPath = join(o.audioDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`pack: ${manifestPath} not found — run audio:render first`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AudioManifest;
  if (manifest.dryRun) throw new Error('pack: the manifest is a dry run; render for real before packing');
  if (manifest.partial) throw new Error(`pack: the manifest is a partial render (${JSON.stringify(manifest.partial)}); render the whole corpus (no --stations / --limit) before packing`);
  mkdirSync(o.outDir, { recursive: true });
  const assets: PackAsset[] = [];
  for (const tier of tiersOf(manifest)) {
    const paths = tarPaths(manifest, tier);
    for (const p of paths) if (!existsSync(join(o.audioDir, p))) throw new Error(`pack: ${p} named by the manifest is missing on disk`);
    const name = assetName(manifest.audioVersion, tier);
    const listPath = join(o.outDir, `${name}.list`);
    writeFileSync(listPath, paths.join('\n') + '\n');
    const tarPath = join(o.outDir, name);
    const r = spawnSync(o.tar ?? 'tar', ['-cf', tarPath, '-C', o.audioDir, '-T', listPath], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pack: tar exited ${r.status}: ${r.stderr}`);
    const bytes = readFileSync(tarPath);
    assets.push({ tier, name, sha256: sha256Hex(bytes), bytes: bytes.length });
    log(`${name}: ${paths.length} files, ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
  }
  const pointer = buildPointer(manifest, assets);
  writeFileSync(o.pointerPath, JSON.stringify(pointer, null, 2) + '\n');
  log(`${o.pointerPath}: tag ${pointer.tag}, ${assets.length} assets, ${pointer.credits.length} credits`);
  return pointer;
}

function main(argv: readonly string[]): void {
  const o: PackOptions = { audioDir: join(REPO_ROOT, 'public', 'audio'), outDir: join(REPO_ROOT, '.audio-cache', 'release'), pointerPath: join(REPO_ROOT, 'public', 'audio-pack.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--audio') o.audioDir = resolve(v());
    else if (a === '--out') o.outDir = resolve(v());
    else if (a === '--pointer') o.pointerPath = resolve(v());
    else if (a === '--tar') o.tar = v();
    else throw new Error(`unknown argument ${a}`);
  }
  pack(o);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`pack: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
