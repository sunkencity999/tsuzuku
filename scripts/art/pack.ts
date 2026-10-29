/**
 * TSUZUKU — pack the sourced prints into the release asset (docs/ART_PACK.md §6).
 *
 *   node scripts/art/pack.ts [--art public/art] [--out .art-cache/release] [--pointer public/art-pack.json] [--tar tar]
 *
 * One tar, `tsuzuku-art-<artVersion>.tar`, built with the system `tar`
 * (`-C public/art -T <list>`; GNU tar and bsdtar both take a list file) from
 * `manifest.json` and every `prints/**` file the manifest names. A manifest
 * with problems (`manifestProblems`: a `--only` / `--limit` run's partial
 * tables, a missing station, a broken row) or a file missing on disk is
 * refused — only a whole, checked pack ships. The committed pointer
 * `public/art-pack.json` (`tsuzuku.art-pack/1`, tier `prints`) is rewritten
 * with the tag, the asset's sha256 and bytes and the credit line — the build
 * fetches exactly this.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ArtManifest, type ArtPackPointer, assetName, buildPointer, emptyPointer, manifestProblems, sha256Hex } from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
export { buildPointer, emptyPointer };

/** Paths (relative to `public/art/`) that belong in the tar: the manifest and every print, sorted. */
export function tarPaths(manifest: ArtManifest): string[] {
  return ['manifest.json', ...manifest.prints.map((p) => p.file)].sort();
}

export interface PackOptions {
  artDir: string;
  outDir: string;
  pointerPath: string;
  tar?: string;
  log?: (s: string) => void;
}

export function pack(o: PackOptions): ArtPackPointer {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const manifestPath = join(o.artDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} not found — run art:source first`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtManifest;
  const problems = manifestProblems(manifest);
  if (problems.length > 0) throw new Error(`the manifest is not a whole pack (a --only / --limit run, or a gap):\n  ${problems.slice(0, 12).join('\n  ')}${problems.length > 12 ? `\n  … ${problems.length - 12} more` : ''}`);
  const paths = tarPaths(manifest);
  for (const p of paths) if (!existsSync(join(o.artDir, p))) throw new Error(`${p} named by the manifest is missing on disk`);
  mkdirSync(o.outDir, { recursive: true });
  const name = assetName(manifest.artVersion);
  const listPath = join(o.outDir, `${name}.list`);
  writeFileSync(listPath, paths.join('\n') + '\n');
  const tarPath = join(o.outDir, name);
  const r = spawnSync(o.tar ?? 'tar', ['-cf', tarPath, '-C', o.artDir, '-T', listPath], { encoding: 'utf8' });
  if (r.error) throw new Error(`tar failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`tar exited ${r.status}: ${r.stderr}`);
  const bytes = readFileSync(tarPath);
  const pointer = buildPointer(manifest.artVersion, { sha256: sha256Hex(bytes), bytes: bytes.length });
  log(`${name}: ${paths.length} files, ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
  writeFileSync(o.pointerPath, JSON.stringify(pointer, null, 2) + '\n');
  log(`${o.pointerPath}: tag ${pointer.tag}, ${pointer.assets.length} asset, ${pointer.credits.length} credit`);
  return pointer;
}

function main(argv: readonly string[]): void {
  const o: PackOptions = { artDir: join(REPO_ROOT, 'public', 'art'), outDir: join(REPO_ROOT, '.art-cache', 'release'), pointerPath: join(REPO_ROOT, 'public', 'art-pack.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--art') o.artDir = resolve(v());
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
