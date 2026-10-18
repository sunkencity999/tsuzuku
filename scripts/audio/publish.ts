/**
 * TSUZUKU — publish the pack as a GitHub release (design 08 §7 step 8).
 *
 *   node scripts/audio/publish.ts [--dry-run] [--yes] [--pointer public/audio-pack.json] [--assets .audio-cache/release] [--repo sunkencity999/tsuzuku]
 *
 * A DRY RUN unless `--yes` is given: it prints the `gh` commands it would run
 * (`gh release create audio-<audioVersion> …` then `gh release upload … --clobber`)
 * and exits 0 without touching the release. The lead publishes the release;
 * in this phase nobody passes `--yes`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AudioPackPointer } from './indexes.ts';
import { sha256Hex } from './sprites.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');

export interface PublishPlan {
  tag: string;
  repo: string;
  create: string[];
  upload: string[];
}

/** The two `gh` invocations for a pointer; `assetsDir` holds the tars named in it. */
export function publishCommands(pointer: AudioPackPointer, assetsDir: string, repo = pointer.repo): PublishPlan {
  if (!pointer.tag || !pointer.audioVersion) throw new Error('publish: the pointer names no release (run audio:pack first)');
  if (pointer.assets.length === 0) throw new Error('publish: the pointer lists no assets');
  const notes = [
    `TSUZUKU voice pack ${pointer.audioVersion} — pre-rendered synthetic voices (VOICEVOX).`,
    '',
    'Every voice is a VOICEVOX character voice under that character\'s terms (see CONTENT_LICENSE.md, "Synthetic voices"):',
    ...pointer.credits.map((c) => `- ${c}`),
    '',
    'Assets (one tar per tier; sha256 in public/audio-pack.json):',
    ...pointer.assets.map((a) => `- ${a.name} — ${a.tier}, ${a.bytes} bytes, sha256 ${a.sha256}`),
  ].join('\n');
  return {
    tag: pointer.tag,
    repo,
    create: ['gh', 'release', 'create', pointer.tag, '--repo', repo, '--title', `Voice pack ${pointer.audioVersion}`, '--notes', notes],
    upload: ['gh', 'release', 'upload', pointer.tag, ...pointer.assets.map((a) => join(assetsDir, a.name)), '--repo', repo, '--clobber'],
  };
}

/** Every asset named by the pointer exists and matches its sha256 / bytes. */
export function verifyAssets(pointer: AudioPackPointer, assetsDir: string): string[] {
  const problems: string[] = [];
  for (const a of pointer.assets) {
    const p = join(assetsDir, a.name);
    if (!existsSync(p)) {
      problems.push(`${a.name}: missing in ${assetsDir}`);
      continue;
    }
    const bytes = readFileSync(p);
    if (bytes.length !== a.bytes) problems.push(`${a.name}: ${bytes.length} bytes, pointer says ${a.bytes}`);
    else if (sha256Hex(bytes) !== a.sha256) problems.push(`${a.name}: sha256 differs from the pointer`);
  }
  return problems;
}

const quote = (s: string): string => (/^[\w./:=@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export interface PublishOptions {
  pointerPath: string;
  assetsDir: string;
  repo?: string;
  yes: boolean;
  log?: (s: string) => void;
}

export function publish(o: PublishOptions): number {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const pointer = JSON.parse(readFileSync(o.pointerPath, 'utf8')) as AudioPackPointer;
  const plan = publishCommands(pointer, o.assetsDir, o.repo ?? pointer.repo);
  const problems = verifyAssets(pointer, o.assetsDir);
  if (problems.length > 0) {
    for (const p of problems) log(`publish: ${p}`);
    return 1;
  }
  log(`${o.yes ? 'publishing' : 'DRY RUN —'} release ${plan.tag} on ${plan.repo}:`);
  log('  ' + plan.create.map(quote).join(' '));
  log('  ' + plan.upload.map(quote).join(' '));
  if (!o.yes) {
    log('nothing was published (pass --yes to run these commands; the lead publishes the release)');
    return 0;
  }
  const exists = spawnSync('gh', ['release', 'view', plan.tag, '--repo', plan.repo], { encoding: 'utf8' });
  if (exists.status !== 0) {
    const c = spawnSync(plan.create[0] as string, plan.create.slice(1), { stdio: 'inherit' });
    if (c.status !== 0) return c.status ?? 1;
  } else log(`release ${plan.tag} exists — uploading with --clobber`);
  const u = spawnSync(plan.upload[0] as string, plan.upload.slice(1), { stdio: 'inherit' });
  return u.status ?? 1;
}

function main(argv: readonly string[]): number {
  const o: PublishOptions = { pointerPath: join(REPO_ROOT, 'public', 'audio-pack.json'), assetsDir: join(REPO_ROOT, '.audio-cache', 'release'), yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--dry-run') o.yes = false;
    else if (a === '--yes') o.yes = true;
    else if (a === '--pointer') o.pointerPath = resolve(v());
    else if (a === '--assets') o.assetsDir = resolve(v());
    else if (a === '--repo') o.repo = v();
    else throw new Error(`unknown argument ${a}`);
  }
  return publish(o);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`publish: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
