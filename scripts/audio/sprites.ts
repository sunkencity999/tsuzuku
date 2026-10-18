/**
 * TSUZUKU — sprite assembly (design 08 §7 steps 5–6, docs/AUDIO_PACK.md §1).
 *
 * Pure PCM concat math plus the two thin shell-outs the pipeline needs:
 *
 *  - `layout(parts)` places 16-bit mono 24 kHz clips one after another with a
 *    300 ms pad before every clip and after the last one; each cue's `start`
 *    and `end` sit 20 ms INSIDE the pads (`start = offset − 0.02`, `end = offset
 *    + length + 0.02`), computed from sample offsets, so a seek never clips a
 *    consonant and never bleeds into the neighbour.
 *  - `concatPcm(parts)` materialises that layout as one PCM buffer.
 *  - `planMixedSprites(clips)` fills mixed-kind sprites greedily up to 90 s of
 *    audio (pads included); a caller that wants one sprite per text (stories)
 *    simply does not call it — a text longer than 90 s is still one sprite.
 *  - `spriteName(base, bytes)` is the content-addressed file name
 *    `<base>-<sha8>.webm`, unchanged while the bytes are.
 *  - `encodeOpus(wav, webm)` runs `ffmpeg -c:a libopus -b:a 24k -ac 1 -ar 24000
 *    -application voip -flags +bitexact -fflags +bitexact` (≈ 3.46 KB/s measured;
 *    bitexact makes the bytes reproducible); `wrapWav` / `pcmOfWav` convert
 *    between raw PCM and the engine's 44-byte-header WAV.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const SAMPLE_RATE = 24000;
export const BYTES_PER_SAMPLE = 2;
/** Silence before every clip and after the last one. */
export const PAD_SECONDS = 0.3;
/** How far a cue reaches into its pads. */
export const GUARD_SECONDS = 0.02;
/** Mixed-kind sprites (words, grammar, examples, misc, ear) split at this much audio. */
export const MAX_MIXED_SECONDS = 90;
/**
 * ffmpeg arguments after `-i <wav>` (design 08 §7 step 5). `+bitexact` drops the
 * muxer's creation date, random SegmentUID and encoder tag, so the same PCM
 * encodes to the same bytes on every run — without it every sprite would be
 * renamed on every render and `reusedBytesShare` would read 0 (measured).
 */
export const OPUS_ARGS: readonly string[] = ['-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-ar', String(SAMPLE_RATE), '-application', 'voip', '-flags', '+bitexact', '-fflags', '+bitexact'];
/** Opus bytes per second of speech at these settings, measured (for dry-run estimates). */
export const OPUS_BYTES_PER_SECOND = 3460;
/** Container overhead per file, measured. */
export const OPUS_FILE_OVERHEAD = 1000;

export const PAD_SAMPLES = Math.round(PAD_SECONDS * SAMPLE_RATE);
export const GUARD_SAMPLES = Math.round(GUARD_SECONDS * SAMPLE_RATE);

export interface ClipLength {
  id: string;
  /** Length of the clip in samples (16-bit mono). */
  samples: number;
}

export interface PlacedClip extends ClipLength {
  /** Sample offset of the clip's first sample inside the sprite. */
  offset: number;
  /** Cue bounds in seconds (3 decimals), 20 ms inside the pads. */
  start: number;
  end: number;
}

export interface Layout {
  clips: PlacedClip[];
  totalSamples: number;
  seconds: number;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Sample offsets and cue bounds for clips laid out with `PAD_SECONDS` between them. */
export function layout(parts: readonly ClipLength[]): Layout {
  const clips: PlacedClip[] = [];
  let at = PAD_SAMPLES;
  for (const p of parts) {
    clips.push({
      id: p.id,
      samples: p.samples,
      offset: at,
      start: round3((at - GUARD_SAMPLES) / SAMPLE_RATE),
      end: round3((at + p.samples + GUARD_SAMPLES) / SAMPLE_RATE),
    });
    at += p.samples + PAD_SAMPLES;
  }
  const totalSamples = parts.length === 0 ? 0 : at;
  return { clips, totalSamples, seconds: round3(totalSamples / SAMPLE_RATE) };
}

/** Seconds a set of clips occupies in a sprite, pads included. */
export function spriteSeconds(parts: readonly ClipLength[]): number {
  return layout(parts).seconds;
}

export interface PcmPart {
  id: string;
  /** Raw 16-bit little-endian mono PCM at 24 kHz. */
  pcm: Buffer;
}

/** The sprite's PCM (pads are zero samples) and its cues. */
export function concatPcm(parts: readonly PcmPart[]): { pcm: Buffer; layout: Layout } {
  const lay = layout(parts.map((p) => ({ id: p.id, samples: Math.floor(p.pcm.length / BYTES_PER_SAMPLE) })));
  const pcm = Buffer.alloc(lay.totalSamples * BYTES_PER_SAMPLE);
  parts.forEach((p, i) => {
    const placed = lay.clips[i] as PlacedClip;
    p.pcm.copy(pcm, placed.offset * BYTES_PER_SAMPLE, 0, placed.samples * BYTES_PER_SAMPLE);
  });
  return { pcm, layout: lay };
}

/**
 * Greedy fill of mixed-kind sprites: clips keep their order, a new sprite opens
 * when adding the next clip would push the audio past `maxSeconds` (pads
 * included). A single clip longer than the cap gets a sprite of its own.
 */
export function planMixedSprites<T extends ClipLength>(clips: readonly T[], maxSeconds = MAX_MIXED_SECONDS): T[][] {
  const maxSamples = Math.round(maxSeconds * SAMPLE_RATE);
  const out: T[][] = [];
  let cur: T[] = [];
  let curSamples = PAD_SAMPLES;
  for (const c of clips) {
    const add = c.samples + PAD_SAMPLES;
    if (cur.length > 0 && curSamples + add > maxSamples) {
      out.push(cur);
      cur = [];
      curSamples = PAD_SAMPLES;
    }
    cur.push(c);
    curSamples += add;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/* ── WAV ───────────────────────────────────────────────────────────────── */

/** The 44-byte RIFF header for `pcmBytes` of 16-bit mono 24 kHz PCM. */
export function wavHeader(pcmBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcmBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcmBytes, 40);
  return h;
}

export function wrapWav(pcm: Buffer): Buffer {
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}

/**
 * The PCM payload of a WAV (the `data` chunk; the engine writes a plain 44-byte
 * header, but the chunk walk also accepts LIST/fact chunks). Throws on a
 * non-16-bit-mono-24 kHz file so a mis-set engine is caught at once.
 */
export function pcmOfWav(wav: Buffer): Buffer {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('sprites: not a RIFF/WAVE file');
  let at = 12;
  let fmtOk = false;
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      const channels = wav.readUInt16LE(body + 2);
      const rate = wav.readUInt32LE(body + 4);
      const bits = wav.readUInt16LE(body + 14);
      if (channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) throw new Error(`sprites: expected 16-bit mono ${SAMPLE_RATE} Hz WAV, got ${bits}-bit ${channels} ch ${rate} Hz`);
      fmtOk = true;
    } else if (id === 'data') {
      if (!fmtOk) throw new Error('sprites: WAV data before fmt');
      const end = Math.min(wav.length, body + size);
      return wav.subarray(body, end - ((end - body) % BYTES_PER_SAMPLE));
    }
    at = body + size + (size % 2);
  }
  throw new Error('sprites: WAV without a data chunk');
}

export function wavSeconds(wav: Buffer): number {
  return pcmOfWav(wav).length / BYTES_PER_SAMPLE / SAMPLE_RATE;
}

/* ── names and encoding ────────────────────────────────────────────────── */

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** First 8 hex digits of sha256 over the bytes. */
export function sha8(buf: Buffer | string): string {
  return sha256Hex(buf).slice(0, 8);
}

/** `<base>-<sha8 of bytes>.webm` — content-addressed, so the name moves only when the audio does. */
export function spriteName(base: string, bytes: Buffer): string {
  return `${base}-${sha8(bytes)}.webm`;
}

/** Dry-run byte estimate for `seconds` of speech at the pack's Opus settings. */
export function estimateOpusBytes(seconds: number): number {
  return Math.round(seconds * OPUS_BYTES_PER_SECOND) + OPUS_FILE_OVERHEAD;
}

/** `ffmpeg -i wav <OPUS_ARGS> webm`; throws with ffmpeg's stderr on failure. */
export function encodeOpus(wavPath: string, webmPath: string, ffmpeg = 'ffmpeg'): void {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, ...OPUS_ARGS, webmPath], { encoding: 'utf8' });
  if (r.error) throw new Error(`sprites: ${ffmpeg} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`sprites: ${ffmpeg} exited ${r.status}: ${r.stderr}`);
}

/** True when `ffmpeg` runs and has libopus. */
export function ffmpegHasOpus(ffmpeg = 'ffmpeg'): boolean {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return r.status === 0 && /libopus/.test(r.stdout);
}
