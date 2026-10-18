import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReadableStream } from 'node:stream/web';
import { type FetchLike, type SpawnLike, fetchAudioPack, NONE_MESSAGE, streamToFile } from './fetch-audio-pack.ts';
import { emptyPointer } from './pack.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** A response whose body streams `bytes` in small chunks (never one buffer). */
function streamResponse(bytes: Buffer, status = 200) {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, at + 7);
      controller.enqueue(new Uint8Array(bytes.subarray(at, end)));
      at = end;
    },
  });
  return { ok: status >= 200 && status < 300, status, body, json: async () => JSON.parse(bytes.toString('utf8')) as unknown, text: async () => bytes.toString('utf8') };
}

function jsonResponse(v: unknown, status = 200) {
  return streamResponse(Buffer.from(JSON.stringify(v)), status);
}

interface Scenario {
  tmp: string;
  pointer: string;
  dest: string;
  tar: Buffer;
  calls: string[];
  spawns: { cmd: string; args: string[] }[];
  fetchImpl: FetchLike;
  spawnImpl: SpawnLike;
}

function scenario(o: { tarBytes?: Buffer; pointerSha?: string; pointerBytes?: number; release?: 404 | 'ok' | 500; tarStatus?: number } = {}): Scenario {
  const tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-fetch-'));
  const tar = o.tarBytes ?? Buffer.from('fake tar bytes '.repeat(20));
  const pointer = join(tmp, 'audio-pack.json');
  writeFileSync(
    pointer,
    JSON.stringify({ schema: 'tsuzuku.audio-pack/1', repo: 'sunkencity999/tsuzuku', audioVersion: 'a-0123456789', tag: 'audio-a-0123456789', assets: [{ tier: 'core', name: 'tsuzuku-audio-a-0123456789-core.tar', sha256: o.pointerSha ?? sha(tar), bytes: o.pointerBytes ?? tar.length }], credits: ['VOICEVOX:九州そら'] }),
  );
  const dest = join(tmp, 'public', 'audio');
  const calls: string[] = [];
  const spawns: { cmd: string; args: string[] }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push(`${url} ${init?.headers?.accept ?? ''}`);
    if (url.includes('/releases/tags/')) {
      if (o.release === 404) return jsonResponse({ message: 'Not Found' }, 404);
      if (o.release === 500) return jsonResponse({ message: 'boom' }, 500);
      return jsonResponse({ tag_name: 'audio-a-0123456789', assets: [{ id: 77, name: 'tsuzuku-audio-a-0123456789-core.tar', size: tar.length }] });
    }
    if (url.endsWith('/releases/assets/77')) return streamResponse(tar, o.tarStatus ?? 200);
    throw new Error(`unexpected url ${url}`);
  };
  const spawnImpl: SpawnLike = (cmd, args) => {
    spawns.push({ cmd, args });
    return { status: 0, stderr: '' };
  };
  return { tmp, pointer, dest, tar, calls, spawns, fetchImpl, spawnImpl };
}

describe('fetch-audio-pack — streaming download with verification', () => {
  const made: string[] = [];
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  it('streamToFile hashes while streaming and writes the file in chunks', async () => {
    const s = scenario();
    made.push(s.tmp);
    const file = join(s.tmp, 'out.bin');
    const r = await streamToFile(s.fetchImpl, 'https://api.github.com/repos/x/y/releases/assets/77', file, { accept: 'application/octet-stream' });
    expect(r.bytes).toBe(s.tar.length);
    expect(r.sha256).toBe(sha(s.tar));
    expect(readFileSync(file).equals(s.tar)).toBe(true);
  });

  it('a verified asset is extracted with tar -xf <temp> -C <dest> via spawnSync, with the token on the API calls', async () => {
    const s = scenario();
    made.push(s.tmp);
    const log: string[] = [];
    const r = await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: false, token: 'ghs_test', tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: (l) => log.push(l) });
    expect(r.code).toBe(0);
    expect(r.extracted).toEqual(['tsuzuku-audio-a-0123456789-core.tar']);
    expect(s.spawns.length).toBe(1);
    expect(s.spawns[0]?.cmd).toBe('tar');
    expect(s.spawns[0]?.args.slice(0, 1)).toEqual(['-xf']);
    expect(s.spawns[0]?.args[1]).toMatch(/tsuzuku-audio-.*tsuzuku-audio-a-0123456789-core\.tar$/);
    expect(s.spawns[0]?.args.slice(2)).toEqual(['-C', s.dest]);
    expect(s.calls[0]).toContain('/repos/sunkencity999/tsuzuku/releases/tags/audio-a-0123456789 application/vnd.github+json');
    expect(s.calls[1]).toContain('/releases/assets/77 application/octet-stream');
    expect(existsSync(s.dest)).toBe(true);
    // the temp download is gone afterwards
    expect(readdirSync(s.tmp).filter((n) => n.startsWith('tsuzuku-audio-'))).toEqual([]);
    expect(log.some((l) => /verified/.test(l))).toBe(true);
  });

  it('a sha256 mismatch exits 1 and leaves public/audio untouched (no tar call, no dest)', async () => {
    const s = scenario({ pointerSha: 'f'.repeat(64) });
    made.push(s.tmp);
    const r = await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: false, tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: () => {} });
    expect(r.code).toBe(1);
    expect(r.message).toMatch(/sha256 .* does not match/);
    expect(s.spawns).toEqual([]);
    expect(existsSync(s.dest)).toBe(false);
  });

  it('a byte-count mismatch is also a failure, and --optional does NOT downgrade it: a corrupt asset never deploys silently (exit 1, nothing extracted)', async () => {
    const s = scenario({ pointerBytes: 1 });
    made.push(s.tmp);
    const strict = await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: false, tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: () => {} });
    expect(strict.code).toBe(1);
    const log: string[] = [];
    const lax = await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: true, tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: (l) => log.push(l) });
    expect(lax.code).toBe(1);
    expect(log[0]).toMatch(/^error: .*bytes, pointer says 1/);
    expect(s.spawns).toEqual([]);
    expect(existsSync(s.dest)).toBe(false);
    // sha256 mismatch under --optional: the same.
    const t = scenario({ pointerSha: 'f'.repeat(64) });
    made.push(t.tmp);
    expect((await fetchAudioPack({ pointerPath: t.pointer, dest: t.dest, optional: true, tmpRoot: t.tmp, fetchImpl: t.fetchImpl, spawnImpl: t.spawnImpl, log: () => {} })).code).toBe(1);
  });

  it("a missing release exits 0 with 'audio pack: none — speechSynthesis only'", async () => {
    const s = scenario({ release: 404 });
    made.push(s.tmp);
    const log: string[] = [];
    const r = await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: false, tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: (l) => log.push(l) });
    expect(r.code).toBe(0);
    expect(r.message).toBe(NONE_MESSAGE);
    expect(log.join('\n')).toContain(NONE_MESSAGE);
    expect(s.spawns).toEqual([]);
  });

  it('an empty asset list (the placeholder a checkout ships before the first pack is published) exits 0 with the none message and never calls the network', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-fetch-'));
    made.push(tmp);
    const pointer = join(tmp, 'audio-pack.json');
    writeFileSync(pointer, JSON.stringify(emptyPointer(), null, 2));
    const calls: string[] = [];
    const log: string[] = [];
    const r = await fetchAudioPack({
      pointerPath: pointer,
      dest: join(tmp, 'audio'),
      optional: true,
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error('no network');
      },
      spawnImpl: () => ({ status: 0 }),
      log: (l) => log.push(l),
    });
    expect(r.code).toBe(0);
    expect(log).toEqual([NONE_MESSAGE]);
    expect(calls).toEqual([]);
  });

  it('a server error on the lookup fails (exit 1) with or without --optional — only NO pack is optional; a failing tar fails too', async () => {
    const s = scenario({ release: 500 });
    made.push(s.tmp);
    expect((await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: false, tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: () => {} })).code).toBe(1);
    expect((await fetchAudioPack({ pointerPath: s.pointer, dest: s.dest, optional: true, tmpRoot: s.tmp, fetchImpl: s.fetchImpl, spawnImpl: s.spawnImpl, log: () => {} })).code).toBe(1);
    const t = scenario();
    made.push(t.tmp);
    const r = await fetchAudioPack({ pointerPath: t.pointer, dest: t.dest, optional: true, tmpRoot: t.tmp, fetchImpl: t.fetchImpl, spawnImpl: () => ({ status: 2, stderr: 'tar: boom' }), log: () => {} });
    expect(r.code).toBe(1);
    expect(r.message).toMatch(/tar exited 2/);
    // The three no-pack shapes exit 0 without the flag as well.
    const u = scenario({ release: 404 });
    made.push(u.tmp);
    expect((await fetchAudioPack({ pointerPath: u.pointer, dest: u.dest, optional: false, tmpRoot: u.tmp, fetchImpl: u.fetchImpl, spawnImpl: u.spawnImpl, log: () => {} })).code).toBe(0);
    expect((await fetchAudioPack({ pointerPath: join(u.tmp, 'no-such-pointer.json'), dest: u.dest, optional: false, tmpRoot: u.tmp, fetchImpl: u.fetchImpl, spawnImpl: u.spawnImpl, log: () => {} })).message).toBe(NONE_MESSAGE);
  });
});
