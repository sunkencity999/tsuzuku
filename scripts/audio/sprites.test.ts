import {
  concatPcm,
  estimateOpusBytes,
  GUARD_SAMPLES,
  GUARD_SECONDS,
  layout,
  MAX_MIXED_SECONDS,
  OPUS_ARGS,
  PAD_SAMPLES,
  PAD_SECONDS,
  pcmOfWav,
  planMixedSprites,
  SAMPLE_RATE,
  sha8,
  spriteName,
  spriteSeconds,
  wavHeader,
  wavSeconds,
  wrapWav,
} from './sprites.ts';

const secs = (s: number): number => Math.round(s * SAMPLE_RATE);

describe('sprites — PCM concat cue math', () => {
  it('places 300 ms pads around every clip and puts the 20 ms guards inside them', () => {
    expect(PAD_SECONDS).toBe(0.3);
    expect(GUARD_SECONDS).toBe(0.02);
    const lay = layout([
      { id: 'a', samples: secs(1) },
      { id: 'b', samples: secs(2.5) },
    ]);
    const [a, b] = lay.clips;
    expect(a?.offset).toBe(PAD_SAMPLES);
    expect(a?.start).toBeCloseTo(0.3 - 0.02, 3);
    expect(a?.end).toBeCloseTo(1.3 + 0.02, 3);
    expect(b?.offset).toBe(PAD_SAMPLES + secs(1) + PAD_SAMPLES);
    expect(b?.start).toBeCloseTo(1.6 - 0.02, 3);
    expect(b?.end).toBeCloseTo(4.1 + 0.02, 3);
    // the pads keep the guards apart: a's end guard and b's start guard never overlap (300 − 2 × 20 = 260 ms of silence)
    expect((b?.start ?? 0) - (a?.end ?? 0)).toBeCloseTo(PAD_SECONDS - 2 * GUARD_SECONDS, 3);
    expect(lay.totalSamples).toBe(PAD_SAMPLES * 3 + secs(1) + secs(2.5));
    expect(lay.seconds).toBeCloseTo(0.3 * 3 + 3.5, 3);
    expect(GUARD_SAMPLES).toBe(480);
    expect(layout([]).totalSamples).toBe(0);
  });

  it('concatPcm writes each clip at its sample offset with zero pads between', () => {
    const a = Buffer.alloc(4 * 2);
    const b = Buffer.alloc(3 * 2);
    for (let i = 0; i < 4; i++) a.writeInt16LE(1000 + i, i * 2);
    for (let i = 0; i < 3; i++) b.writeInt16LE(-2000 - i, i * 2);
    const { pcm, layout: lay } = concatPcm([
      { id: 'a', pcm: a },
      { id: 'b', pcm: b },
    ]);
    expect(pcm.length).toBe((PAD_SAMPLES * 3 + 7) * 2);
    expect(pcm.readInt16LE(PAD_SAMPLES * 2)).toBe(1000);
    expect(pcm.readInt16LE((PAD_SAMPLES + 3) * 2)).toBe(1003);
    expect(pcm.readInt16LE((PAD_SAMPLES + 4) * 2)).toBe(0); // pad
    const bOff = lay.clips[1]?.offset ?? 0;
    expect(bOff).toBe(PAD_SAMPLES * 2 + 4);
    expect(pcm.readInt16LE(bOff * 2)).toBe(-2000);
    expect(pcm.readInt16LE((bOff + 2) * 2)).toBe(-2002);
    expect(pcm.readInt16LE((pcm.length - 2))).toBe(0);
  });

  it('mixed sprites split at 90 s and keep order; layout() itself never splits (the one-sprite-per-text rule is the pipeline\'s and is tested end to end in render-audio.test.ts)', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ id: `L${i}`, samples: secs(3) })); // 40 × 3.3 s = 132 s
    expect(spriteSeconds(long)).toBeGreaterThan(MAX_MIXED_SECONDS);
    expect(layout(long).clips.length).toBe(40);
    expect(layout(long).seconds).toBeCloseTo(0.3 + 40 * 3.3, 3);
    const mixed = planMixedSprites(long);
    expect(mixed.length).toBe(2);
    for (const group of mixed) expect(spriteSeconds(group)).toBeLessThanOrEqual(MAX_MIXED_SECONDS);
    expect(mixed.flat().map((c) => c.id)).toEqual(long.map((c) => c.id)); // order kept, nothing lost
    expect(mixed[0]?.length).toBe(27); // 0.3 + 27 × 3.3 = 89.4 s; a 28th would reach 92.7 s
  });

  it('a single clip over the cap gets its own sprite and never blocks the rest', () => {
    const groups = planMixedSprites([
      { id: 'huge', samples: secs(100) },
      { id: 'a', samples: secs(1) },
      { id: 'b', samples: secs(1) },
    ]);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([['huge'], ['a', 'b']]);
    expect(planMixedSprites([])).toEqual([]);
  });
});

describe('sprites — names and WAV', () => {
  it('the sprite file name carries sha8 of its bytes and is unchanged when the bytes are', () => {
    const bytes = Buffer.from('opus-bytes-of-the-sprite');
    const name = spriteName('s-04-1', bytes);
    expect(name).toMatch(/^s-04-1-[0-9a-f]{8}\.webm$/);
    expect(name).toBe(spriteName('s-04-1', Buffer.from('opus-bytes-of-the-sprite')));
    expect(spriteName('s-04-1', Buffer.from('opus-bytes-of-the-sprite!'))).not.toBe(name);
    expect(name.slice('s-04-1-'.length, -'.webm'.length)).toBe(sha8(bytes));
  });

  it('wrapWav / pcmOfWav round-trip a 24 kHz mono 16-bit payload and reject other formats', () => {
    const pcm = Buffer.alloc(secs(0.5) * 2, 7);
    const wav = wrapWav(pcm);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(pcmOfWav(wav).equals(pcm)).toBe(true);
    expect(wavSeconds(wav)).toBeCloseTo(0.5, 6);
    const stereo = wavHeader(pcm.length);
    stereo.writeUInt16LE(2, 22);
    expect(() => pcmOfWav(Buffer.concat([stereo, pcm]))).toThrow(/16-bit mono/);
    expect(() => pcmOfWav(Buffer.from('not a wav file at all'))).toThrow(/RIFF/);
  });

  it('the Opus settings are the design 08 ones and the dry-run estimate follows the measured rate', () => {
    expect(OPUS_ARGS).toEqual(['-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-ar', '24000', '-application', 'voip', '-flags', '+bitexact', '-fflags', '+bitexact']);
    expect(estimateOpusBytes(10)).toBe(34600 + 1000);
  });
});
