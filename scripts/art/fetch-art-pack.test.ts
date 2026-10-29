import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../audio/fetch-audio-pack.ts';
import { defaultDest, defaultPointerPath, fetchArtPack, LABEL, NONE_MESSAGE } from './fetch-art-pack.ts';
import { type ArtPackPointer, buildPointer } from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));

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

describe('fetch-art-pack — the audio fetch with the art pointer, destination and none message', () => {
  const made: string[] = [];
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  it('defaults to public/art-pack.json → public/art; no pointer is "none" with no network call; the committed placeholder too', async () => {
    expect(defaultPointerPath()).toBe(resolve(here, '..', '..', 'public', 'art-pack.json'));
    expect(defaultDest()).toBe(resolve(here, '..', '..', 'public', 'art'));
    expect(NONE_MESSAGE).toBe('art pack: none — the drawn room stands');
    expect(LABEL).toBe('art pack');
    const tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-art-fetch-'));
    made.push(tmp);
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      throw new Error('no network');
    };
    const log: string[] = [];
    const r = await fetchArtPack({ pointerPath: join(tmp, 'nope.json'), dest: join(tmp, 'art'), fetchImpl, spawnImpl: () => ({ status: 0 }), log: (l) => log.push(l) });
    expect(r).toEqual({ code: 0, message: NONE_MESSAGE, extracted: [] });
    expect(log).toEqual([NONE_MESSAGE]);
    expect(calls).toEqual([]);
    // The committed pointer: while it is the placeholder (no assets), the default fetch is "none" without the network.
    const committed = JSON.parse(readFileSync(defaultPointerPath(), 'utf8')) as ArtPackPointer;
    if (committed.assets.length === 0) {
      const d = await fetchArtPack({ dest: join(tmp, 'art-default'), fetchImpl, spawnImpl: () => ({ status: 0 }), log: () => {} });
      expect(d.message).toBe(NONE_MESSAGE);
      expect(calls).toEqual([]);
    }
  });

  it('a verified asset of release art-<artVersion> is extracted into the destination and reported as "art pack p-…"', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-art-fetch-'));
    made.push(tmp);
    const tar = Buffer.from('fake art tar '.repeat(30));
    const pointer = buildPointer('p-0123456789', { sha256: createHash('sha256').update(tar).digest('hex'), bytes: tar.length });
    const pointerPath = join(tmp, 'art-pack.json');
    writeFileSync(pointerPath, JSON.stringify(pointer));
    const dest = join(tmp, 'public', 'art');
    const calls: string[] = [];
    const spawns: { cmd: string; args: string[] }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push(`${url} ${init?.headers?.accept ?? ''}`);
      if (url.includes('/releases/tags/')) return streamResponse(Buffer.from(JSON.stringify({ tag_name: 'art-p-0123456789', assets: [{ id: 9, name: 'tsuzuku-art-p-0123456789.tar', size: tar.length }] })));
      if (url.endsWith('/releases/assets/9')) return streamResponse(tar);
      throw new Error(`unexpected url ${url}`);
    };
    const log: string[] = [];
    const r = await fetchArtPack({ pointerPath, dest, tmpRoot: tmp, fetchImpl, spawnImpl: (cmd, args) => (spawns.push({ cmd, args }), { status: 0, stderr: '' }), log: (l) => log.push(l) });
    expect(r.code).toBe(0);
    expect(r.extracted).toEqual(['tsuzuku-art-p-0123456789.tar']);
    expect(r.message).toBe(`art pack p-0123456789: 1 assets extracted to ${dest}`);
    expect(calls[0]).toContain('/repos/sunkencity999/tsuzuku/releases/tags/art-p-0123456789 application/vnd.github+json');
    expect(spawns).toEqual([{ cmd: 'tar', args: ['-xf', expect.stringMatching(/tsuzuku-art-p-0123456789\.tar$/) as unknown as string, '-C', dest] }]);
    // a release that is not there yet: the art none message, exit 0
    const gone = await fetchArtPack({ pointerPath, dest, tmpRoot: tmp, fetchImpl: async () => streamResponse(Buffer.from('{"message":"Not Found"}'), 404), spawnImpl: () => ({ status: 0 }), log: () => {} });
    expect(gone).toEqual({ code: 0, message: NONE_MESSAGE, extracted: [] });
    // a tampered asset: exit 1, nothing extracted
    writeFileSync(pointerPath, JSON.stringify({ ...pointer, assets: [{ ...pointer.assets[0], sha256: 'f'.repeat(64) }] }));
    const bad = await fetchArtPack({ pointerPath, dest: join(tmp, 'untouched'), tmpRoot: tmp, fetchImpl, spawnImpl: () => ({ status: 0 }), log: () => {} });
    expect(bad.code).toBe(1);
    expect(bad.message).toMatch(/sha256 .* does not match/);
  });
});
