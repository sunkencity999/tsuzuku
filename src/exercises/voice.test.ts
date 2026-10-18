import { signal } from '@preact/signals';
import { audioSourceOf as sharedAudioSourceOf, installServices, nullAudio, resetServices, speak as sharedSpeak, voiceAudible as sharedVoiceAudible, type ClipCue } from '@/shared/audio';
import { makeTestStore } from '@/store/testing';
import { audioSourceOf, canPlayClip, clipCue, clipSource, isPitchVerified, packAllowed, speak, voiceAudible } from './voice';

const CUE: ClipCue = { key: 'v-n5-0001', file: 'audio/sprites/s04/words-01-abcdef12.webm', start: 1.2, end: 1.9, voice: 'VOICEVOX:ずんだもん', rate: 1, pitchVerified: true };

beforeEach(async () => {
  await makeTestStore();
});
afterEach(() => {
  resetServices();
});

describe('re-exports', () => {
  it('resolve to the shared/audio bodies (one definition for D, F and the input group)', () => {
    expect(voiceAudible).toBe(sharedVoiceAudible);
    expect(audioSourceOf).toBe(sharedAudioSourceOf);
    expect(speak).toBe(sharedSpeak);
  });
});

describe('voiceAudible', () => {
  it('reads canSpeak when the service exposes it', () => {
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true), canSpeak: signal(false) })).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(true) })).toBe(true);
  });

  it('falls back to hasJaVoice for nullAudio-style doubles without canSpeak', () => {
    expect(voiceAudible(nullAudio)).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true) })).toBe(true);
  });
});

describe('clipSource', () => {
  it('is text only on nullAudio, the device voice on an audible double without a source signal, and the source signal when present', () => {
    expect(clipSource()).toBe('none');
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true) } });
    expect(clipSource()).toBe('synth');
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), source: signal('clips') } });
    expect(clipSource()).toBe('clips');
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), source: signal('none') } });
    expect(clipSource()).toBe('none');
  });
});

describe('clipCue / canPlayClip / isPitchVerified', () => {
  it('are undefined / false on nullAudio and on doubles without clipFor (no pack: drills behave as before)', () => {
    expect(clipCue('v-n5-0001')).toBeUndefined();
    expect(canPlayClip('v-n5-0001')).toBe(false);
    expect(isPitchVerified('v-n5-0001')).toBe(false);
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true) } });
    expect(canPlayClip('v-n5-0001')).toBe(false);
  });

  it('read services.audio.clipFor through the slot, passing the options along', () => {
    const clipFor = vi.fn((key: string) => (key === CUE.key ? CUE : key === 'v-n5-0002' ? { ...CUE, key, pitchVerified: false } : undefined));
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), clipFor } });
    expect(clipCue('v-n5-0001', { rate: 0.85 })).toBe(CUE);
    expect(clipFor).toHaveBeenLastCalledWith('v-n5-0001', { rate: 0.85 });
    expect(canPlayClip('v-n5-0001')).toBe(true);
    expect(canPlayClip('v-n5-0001#ga')).toBe(false);
    expect(isPitchVerified('v-n5-0001')).toBe(true);
    // present but the accent did not match the dictionary: playable, not pitch-verified
    expect(canPlayClip('v-n5-0002')).toBe(true);
    expect(isPitchVerified('v-n5-0002')).toBe(false);
  });

  it("follow the gate speak() uses: no cue while the pack is not ready, none under the learner's device-voice setting, and clipFor is not even asked", async () => {
    const clipFor = vi.fn(() => CUE);
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), clipFor, packReady: signal(true) } });
    expect(packAllowed()).toBe(true);
    expect(canPlayClip(CUE.key)).toBe(true);
    // the pack is still loading (or failed): the runtime would fall back to the device voice, so does the answer
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), clipFor, packReady: signal(false) } });
    expect(packAllowed()).toBe(false);
    expect(clipCue(CUE.key)).toBeUndefined();
    expect(canPlayClip(CUE.key)).toBe(false);
    expect(isPitchVerified(CUE.key)).toBe(false);
    // the learner chose the device voice (design 08 §13): the pack is not consulted at all
    await makeTestStore({ save: { settings: { audioSource: 'device' } } });
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), clipFor, packReady: signal(true) } });
    clipFor.mockClear();
    expect(packAllowed()).toBe(false);
    expect(clipCue(CUE.key)).toBeUndefined();
    expect(canPlayClip(CUE.key)).toBe(false);
    expect(isPitchVerified(CUE.key)).toBe(false);
    expect(clipFor).not.toHaveBeenCalled();
    // back to the pack: the same slot answers again
    await makeTestStore({ save: { settings: { audioSource: 'pack' } } });
    expect(canPlayClip(CUE.key)).toBe(true);
    expect(clipFor).toHaveBeenCalledTimes(1);
  });
});
