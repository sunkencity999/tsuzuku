/**
 * TSUZUKU — fetch the print pack into the build (docs/ART_PACK.md §7; deploy.yml).
 *
 *   node scripts/art/fetch-art-pack.ts [--optional] [--pointer public/art-pack.json] [--dest public/art] [--repo owner/name]
 *
 * The whole fetch is `scripts/audio/fetch-audio-pack.ts`'s — the pointer
 * `public/art-pack.json` has the voice pack's shape (`artVersion` in place of
 * `audioVersion`), the release is looked up through the GitHub API, every
 * asset is streamed to a temp file and hashed while streaming, verified
 * against the pointer's sha256 and bytes, and only then `tar -xf` into
 * `public/art`. NO pack (no pointer, an empty asset list, a 404 release)
 * prints `art pack: none — the drawn room stands` and exits 0; every other
 * failure exits 1 whatever the flags and leaves `public/art` untouched.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FetchOptions, type FetchOutcome, fetchAudioPack } from '../audio/fetch-audio-pack.ts';
import { NONE_MESSAGE } from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
export { NONE_MESSAGE };
export const LABEL = 'art pack';

export const defaultPointerPath = (): string => join(REPO_ROOT, 'public', 'art-pack.json');
export const defaultDest = (): string => join(REPO_ROOT, 'public', 'art');

/** The audio fetch with the art pointer, destination, none message and label; every field may be overridden. */
export function fetchArtPack(o: Partial<FetchOptions> = {}): Promise<FetchOutcome> {
  return fetchAudioPack({ pointerPath: defaultPointerPath(), dest: defaultDest(), optional: false, ...o, noneMessage: o.noneMessage ?? NONE_MESSAGE, label: o.label ?? LABEL });
}

function parse(argv: readonly string[]): Partial<FetchOptions> {
  const o: Partial<FetchOptions> = {};
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) o.token = token;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--optional') o.optional = true;
    else if (a === '--pointer') o.pointerPath = resolve(v());
    else if (a === '--dest') o.dest = resolve(v());
    else if (a === '--repo') o.repo = v();
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve()
    .then(() => fetchArtPack(parse(process.argv.slice(2))))
    .then((r) => process.exit(r.code))
    .catch((e: Error) => {
      process.stderr.write(`fetch-art-pack: ${e.message}\n`);
      process.exit(1);
    });
}
