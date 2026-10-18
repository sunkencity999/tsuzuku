import { signal } from '@preact/signals';
import {
  audioSourceOf,
  installServices,
  nullAudio,
  nullStt,
  resetServices,
  services,
  sfx,
  speak,
  SPEED_TIER_RATES,
  voiceAudible,
  type AudioService,
  type AudioSource,
  type ClipCue,
  type SpeakOptions,
} from './audio';

afterEach(() => resetServices());

describe('audio slot', () => {
  it('nullAudio.speak resolves; nullStt is unavailable', async () => {
    await expect(nullAudio.speak('こんにちは', { kana: 'こんにちは' })).resolves.toBeUndefined();
    expect(nullAudio.voices()).toEqual([]);
    expect(nullAudio.hasJaVoice.value).toBe(false);
    // left unset on purpose: `{ ...nullAudio, hasJaVoice: signal(true) }` doubles must stay audible via the fallback
    expect(nullAudio.canSpeak).toBeUndefined();
    expect(nullAudio.rateForTier(5)).toBe(SPEED_TIER_RATES[5]);
    expect(nullStt.available).toBe(false);
    await expect(nullStt.recognize({ maxMs: 100 })).resolves.toBeNull();
  });
  it('installServices swaps the implementation seen by earlier importers', async () => {
    const spoken: string[] = [];
    const fake: AudioService = { ...nullAudio, speak: (t) => { spoken.push(t); return Promise.resolve(); }, sfx: (n) => { spoken.push(`sfx:${n}`); } };
    const before = services; // captured before install
    installServices({ audio: fake });
    await speak('旅日記');
    sfx('ippon');
    expect(before.audio).toBe(fake);
    expect(spoken).toEqual(['旅日記', 'sfx:ippon']);
    expect(services.stt).toBe(nullStt);
    resetServices();
    expect(services.audio).toBe(nullAudio);
  });
  it('voiceAudible reads canSpeak when the service exposes it, else hasJaVoice (doubles stay audible)', () => {
    expect(voiceAudible(nullAudio)).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true) })).toBe(true);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true), canSpeak: signal(false) })).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(true) })).toBe(true);
  });
});

describe('design 08 §8 pack extension (all optional)', () => {
  it('nullAudio satisfies AudioService without source / clipFor / packReady, and voiceAudible is unchanged', () => {
    const a: AudioService = nullAudio;
    expect(a.source).toBeUndefined();
    expect(a.clipFor).toBeUndefined();
    expect(a.packReady).toBeUndefined();
    expect(voiceAudible(nullAudio)).toBe(false);
    // the spread double every group uses still compiles and stays audible
    const double: AudioService = { ...nullAudio, hasJaVoice: signal(true) };
    expect(voiceAudible(double)).toBe(true);
    expect(double.source).toBeUndefined();
  });

  it('audioSourceOf reads the source signal when present, else synth while audible, else none', () => {
    expect(audioSourceOf(nullAudio)).toBe('none');
    expect(audioSourceOf({ ...nullAudio, hasJaVoice: signal(true) })).toBe('synth');
    expect(audioSourceOf({ ...nullAudio, hasJaVoice: signal(true), canSpeak: signal(false) })).toBe('none');
    const src = signal<AudioSource>('clips');
    const packed: AudioService = { ...nullAudio, source: src, packReady: signal(true), clipFor: () => undefined };
    expect(audioSourceOf(packed)).toBe('clips');
    src.value = 'none';
    expect(audioSourceOf(packed)).toBe('none');
  });

  it('a pack-aware double resolves clip keys and the new SpeakOptions type-check', async () => {
    const cue: ClipCue = { key: 's-07-1#L3', file: 'audio/sprites/s07/s-07-1-ab12cd34.webm', start: 12.3, end: 15.1, voice: '九州そら', rate: 0.85, morae: [0, 140, 290], clauses: [0, 2], pitchVerified: true };
    const seen: SpeakOptions[] = [];
    const fake: AudioService = {
      ...nullAudio,
      speak: (_t, o) => {
        seen.push(o ?? {});
        return Promise.resolve();
      },
      clipFor: (key) => (key === cue.key ? cue : undefined),
    };
    expect(fake.clipFor?.('s-07-1#L3', { rate: 0.85 })).toBe(cue);
    expect(fake.clipFor?.('v-n5-0001')).toBeUndefined();
    const progress: [number, number, number][] = [];
    await fake.speak('石部は', { clip: 's-07-1#L3', speaker: 'ハナ', clause: [0, 2], onProgress: (t, m, c) => progress.push([t, m, c]) });
    expect(seen[0]?.clip).toBe('s-07-1#L3');
    expect(seen[0]?.speaker).toBe('ハナ');
    expect(seen[0]?.clause).toEqual([0, 2]);
    seen[0]?.onProgress?.(1.2, 3, 0);
    expect(progress).toEqual([[1.2, 3, 0]]);
    expectTypeOf<AudioSource>().toEqualTypeOf<'clips' | 'synth' | 'none'>();
  });
});
