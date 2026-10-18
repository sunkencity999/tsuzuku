/**
 * TSUZUKU — fetch the voice pack into the build (design 08 §7 step 9; deploy.yml).
 *
 *   node scripts/audio/fetch-audio-pack.ts [--optional] [--pointer public/audio-pack.json] [--dest public/audio] [--repo owner/name]
 *
 * Reads the committed pointer `public/audio-pack.json` (`{ audioVersion, tag,
 * assets: [{ tier, name, sha256, bytes }] }`), looks the release up through
 * the GitHub Releases API (`GITHUB_TOKEN` when set — the workflow's token), and
 * for EVERY asset: streams the download to a temp file
 * (`Readable.fromWeb(res.body).pipe(createWriteStream)`), hashing while
 * streaming — never `arrayBuffer()` on a 170 MB file — then verifies sha256 and
 * bytes. Only when every asset verified does it extract them in order with
 * `spawnSync('tar', ['-xf', tmp, '-C', dest])`; a mismatch exits 1 and leaves
 * `public/audio` untouched. NO pack — no pointer, an empty asset list or a
 * missing (404) release — prints `audio pack: none — speechSynthesis only`
 * and exits 0 (the site builds without a pack). Every other failure (a
 * corrupt or tampered asset, a byte-count or sha256 mismatch, a failed
 * download, an API error, a failing tar) exits 1 WHATEVER the flags: a site
 * that silently deploys without the pack it was promised is worse than a red
 * build. `--optional` is accepted for symmetry with `audio:check` and changes
 * nothing (a missing pack is always optional). GNU tar / bsdtar must be on the
 * runner; Node has no tar.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import type { AudioPackPointer } from './indexes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');

export const NONE_MESSAGE = 'audio pack: none — speechSynthesis only';
export const API = 'https://api.github.com';

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; redirect?: 'follow' }) => Promise<{ ok: boolean; status: number; body: WebReadableStream<Uint8Array> | null; json(): Promise<unknown>; text(): Promise<string> }>;
export type SpawnLike = (cmd: string, args: string[]) => { status: number | null; stderr?: string | null; error?: Error };

export interface FetchOptions {
  pointerPath: string;
  dest: string;
  /** Accepted for symmetry with audio:check; a missing pack exits 0 with or without it, and a corrupt one exits 1 either way. */
  optional: boolean;
  repo?: string;
  token?: string;
  fetchImpl?: FetchLike;
  spawnImpl?: SpawnLike;
  tmpRoot?: string;
  log?: (s: string) => void;
}

interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
}

export interface FetchOutcome {
  code: number;
  message: string;
  extracted: string[];
}

function headers(token: string | undefined, accept: string): Record<string, string> {
  const h: Record<string, string> = { accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'tsuzuku-audio-fetch' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** Streams `url` to `file`, returning its sha256 and byte count without ever holding the body in memory. */
export async function streamToFile(fetchImpl: FetchLike, url: string, file: string, hdrs: Record<string, string>): Promise<{ sha256: string; bytes: number }> {
  const res = await fetchImpl(url, { headers: hdrs, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const source = Readable.fromWeb(res.body);
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  await pipeline(source, createWriteStream(file));
  return { sha256: hash.digest('hex'), bytes };
}

export async function fetchAudioPack(o: FetchOptions): Promise<FetchOutcome> {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const fetchImpl: FetchLike = o.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const spawnImpl: SpawnLike = o.spawnImpl ?? ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  // A failure is a failure under every flag: --optional only ever meant "a pack may be absent", which exits 0 on its own.
  const fail = (message: string): FetchOutcome => {
    log(`error: ${message}`);
    return { code: 1, message, extracted: [] };
  };
  if (!existsSync(o.pointerPath)) {
    log(NONE_MESSAGE);
    return { code: 0, message: NONE_MESSAGE, extracted: [] };
  }
  let pointer: AudioPackPointer;
  try {
    pointer = JSON.parse(readFileSync(o.pointerPath, 'utf8')) as AudioPackPointer;
  } catch (e) {
    return fail(`${o.pointerPath} is not valid JSON: ${(e as Error).message}`);
  }
  if (!pointer.tag || !Array.isArray(pointer.assets) || pointer.assets.length === 0) {
    log(NONE_MESSAGE);
    return { code: 0, message: NONE_MESSAGE, extracted: [] };
  }
  const repo = o.repo ?? pointer.repo;
  // The release and its asset ids.
  let release: { assets: ReleaseAsset[] };
  try {
    const res = await fetchImpl(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(pointer.tag)}`, { headers: headers(o.token, 'application/vnd.github+json') });
    if (res.status === 404) {
      log(`release ${pointer.tag} not found on ${repo}; ${NONE_MESSAGE}`);
      return { code: 0, message: NONE_MESSAGE, extracted: [] };
    }
    if (!res.ok) return fail(`release lookup ${pointer.tag} → HTTP ${res.status}`);
    release = (await res.json()) as { assets: ReleaseAsset[] };
  } catch (e) {
    return fail(`release lookup failed: ${(e as Error).message}`);
  }
  const tmp = mkdtempSync(join(o.tmpRoot ?? tmpdir(), 'tsuzuku-audio-'));
  try {
    const downloaded: { tmpPath: string; name: string }[] = [];
    for (const a of pointer.assets) {
      const ra = release.assets.find((x) => x.name === a.name);
      if (!ra) return fail(`asset ${a.name} is not on release ${pointer.tag}`);
      const tmpPath = join(tmp, a.name);
      let got: { sha256: string; bytes: number };
      try {
        got = await streamToFile(fetchImpl, `${API}/repos/${repo}/releases/assets/${ra.id}`, tmpPath, headers(o.token, 'application/octet-stream'));
      } catch (e) {
        return fail(`download of ${a.name} failed: ${(e as Error).message}`);
      }
      if (got.bytes !== a.bytes) return fail(`${a.name}: ${got.bytes} bytes, pointer says ${a.bytes}`);
      if (got.sha256 !== a.sha256) return fail(`${a.name}: sha256 ${got.sha256} does not match the pointer (${a.sha256})`);
      log(`${a.name}: ${(got.bytes / 1024 / 1024).toFixed(1)} MB verified`);
      downloaded.push({ tmpPath, name: a.name });
    }
    // Every asset verified: extract.
    mkdirSync(o.dest, { recursive: true });
    const extracted: string[] = [];
    for (const d of downloaded) {
      const r = spawnImpl('tar', ['-xf', d.tmpPath, '-C', o.dest]);
      if (r.error) return fail(`tar failed to start for ${d.name}: ${r.error.message}`);
      if (r.status !== 0) return fail(`tar exited ${r.status} for ${d.name}: ${r.stderr ?? ''}`);
      extracted.push(d.name);
    }
    const message = `audio pack ${pointer.audioVersion}: ${extracted.length} assets extracted to ${o.dest}`;
    log(message);
    return { code: 0, message, extracted };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function parse(argv: readonly string[]): FetchOptions {
  const o: FetchOptions = { pointerPath: join(REPO_ROOT, 'public', 'audio-pack.json'), dest: join(REPO_ROOT, 'public', 'audio'), optional: false };
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
  fetchAudioPack(parse(process.argv.slice(2)))
    .then((r) => process.exit(r.code))
    .catch((e: Error) => {
      process.stderr.write(`fetch-audio-pack: ${e.message}\n`);
      process.exit(1);
    });
}
