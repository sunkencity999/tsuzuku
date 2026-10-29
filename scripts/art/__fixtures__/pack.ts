/**
 * TSUZUKU — print pack fixtures for the scripts/art tests.
 *
 * `fakeWebp` builds a RIFF/WEBP file whose first chunk is a lossy `VP8 `,
 * lossless `VP8L` or extended `VP8X` header with the given dimensions and
 * seeded filler (two files differ, so their hashes do). `fixturePack` is a
 * whole, sound manifest — 55 station prints, 72 kō, 12 months, every id
 * resolving — with placeholder ASCII titles (no kanji in a fixture), and
 * `writeFixturePack` lays it on disk with real files for check-art and pack.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type ArtManifest, type ArtPrint, AIC_SOURCE, ENCODER, KO_COUNT, MANIFEST_SCHEMA, MONTH_COUNT, orientationOf, printFile, sha256Hex, STATION_COUNT } from '../schema.ts';

export type WebpKind = 'VP8 ' | 'VP8L' | 'VP8X';

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u24 = (n: number): Buffer => {
  const b = Buffer.alloc(3);
  b.writeUIntLE(n, 0, 3);
  return b;
};
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** A WebP of `kind` with `width` × `height` in its header, `pad` filler bytes after it, seeded. */
export function fakeWebp(kind: WebpKind, width: number, height: number, pad = 16, seed = 0): Buffer {
  let payload: Buffer;
  // VP8: frame tag, key-frame start code, then 14-bit width / height with 2 scale bits each (set from the seed to prove the mask).
  if (kind === 'VP8 ') payload = Buffer.concat([Buffer.from([0x30, 0x01, 0x00]), Buffer.from([0x9d, 0x01, 0x2a]), u16(width | (seed % 4 << 14)), u16(height | ((seed >> 2) % 4 << 14))]);
  // VP8L: signature, then width − 1 (14 bits), height − 1 (14 bits), alpha (1 bit, set), version (3 bits, 0).
  else if (kind === 'VP8L') payload = Buffer.concat([Buffer.from([0x2f]), u32((width - 1) | ((height - 1) << 14) | (1 << 28))]);
  // VP8X: flags, reserved, canvas width − 1 and height − 1 as 24-bit.
  else payload = Buffer.concat([Buffer.from([0x10, 0, 0, 0]), u24(width - 1), u24(height - 1)]);
  const filler = Buffer.alloc(pad, seed & 0xff);
  const chunk = Buffer.concat([Buffer.from(kind, 'latin1'), u32(payload.length + filler.length), payload, filler]);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), chunk]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32(body.length), body]);
}

export const FIXTURE_VERSION = 'p-0123456789';

export interface FixturePack {
  manifest: ArtManifest;
  /** Path (relative to the pack dir) → bytes. */
  files: Map<string, Buffer>;
}

export const fixtureId = (n: number): string => `fix-${String(n).padStart(2, '0')}-station`;

/** 55 prints (one per station; even ones landscape, odd portrait; the three header kinds in turn), 72 kō and 12 months served, print 0 with kō and night roles. */
export function fixturePack(): FixturePack {
  const files = new Map<string, Buffer>();
  const prints: ArtPrint[] = [];
  const kinds: WebpKind[] = ['VP8 ', 'VP8L', 'VP8X'];
  for (let n = 0; n < STATION_COUNT; n++) {
    const id = fixtureId(n);
    const [w, h] = n % 2 === 0 ? [40, 25] : [25, 40];
    const bytes = fakeWebp(kinds[n % 3] as WebpKind, w, h, 32, n + 1);
    const sha256 = sha256Hex(bytes);
    const print: ArtPrint = {
      id,
      file: printFile(id, sha256),
      bytes: bytes.length,
      sha256,
      width: w,
      height: h,
      orientation: orientationOf(w, h),
      lqip: `data:image/webp;base64,${bytes.subarray(0, 30).toString('base64')}`,
      focus: [0.5, 0.4],
      artist: { ja: 'artist-ja', reading: 'Artist Reading', en: 'Artist' },
      title: { ja: `title-${n}`, reading: `Station ${n}`, en: `Station ${n} (fixture)` },
      series: { id: 'fix', ja: 'series-ja', reading: 'Series Reading', en: 'Fixture series' },
      date: 'c. 1833',
      source: { museum: AIC_SOURCE.museum, objectId: 1000 + n, url: `https://www.artic.edu/artworks/${1000 + n}`, accession: `1900.${n}`, creditLine: 'Fixture gift', license: AIC_SOURCE.license },
      roles: n === 0 ? { station: 0, kos: [0, 55], nightMonths: [1] } : { station: n },
    };
    prints.push(print);
    files.set(print.file, bytes);
  }
  const ids = prints.map((p) => p.id);
  const manifest: ArtManifest = {
    schema: MANIFEST_SCHEMA,
    artVersion: FIXTURE_VERSION,
    generatedAt: '2026-10-28T00:00:00.000Z',
    encoder: { ...ENCODER },
    sources: [{ ...AIC_SOURCE }],
    prints,
    stations: Object.fromEntries(ids.map((id, n) => [String(n), id])),
    calendar: { day: Array.from({ length: KO_COUNT }, (_, i) => ids[i % ids.length] as string), night: Array.from({ length: MONTH_COUNT }, (_, i) => ids[i] as string) },
  };
  return { manifest, files };
}

/** Writes every file and `manifest.json` (the given one, or the pack's) under `dir`. */
export function writeFixturePack(dir: string, pack: FixturePack, manifest: ArtManifest = pack.manifest): void {
  for (const [path, bytes] of pack.files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
