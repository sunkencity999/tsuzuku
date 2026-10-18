/**
 * TSUZUKU — audio barrel (group F). `main.tsx` installs these through
 * `installServices({ audio: createWebAudio({ clips: createClipPlayer() }), stt: createStt() })`.
 */
export { createWebAudio, splitUtterance, estimateMs, textToSpeak, stripDisplayMarks, voiceAudible, installAdvice, packChosenIn } from './tts';
export type { WebAudioOptions, WebAudioService, TtsSettings, SynthLike, UtteranceLike } from './tts';
export {
  createClipPlayer,
  AUDIO_CACHE,
  POOL_SIZE,
  OPUS_BLOB_TYPE,
  OPUS_PROBE_TYPE,
  PREFETCH_BUDGET_BYTES,
  CACHE_UNAVAILABLE,
  MANIFEST_SCHEMA,
  spritePath,
  beltOfStation,
  levelOfStation,
  nearestRate,
  clauseRange,
  karaokeAt,
  byTextKey,
  parseManifest,
  parseIndex,
  isSentenceText,
} from './clips';
export { dataSaverOn, prefetchAllowed, saveDataRequested } from './data-saver';
export type { DataSaverSettings } from './data-saver';
export type { ClipPlayerOptions, ClipPlayerEx, ClipPlaybackEx, KanaTrackCue, MediaLike, MediaCtor, CacheLike, CacheStorageLike, RafLike, ObjectUrls, PackManifest, PackFile, ParsedIndex } from './clips';
export type { ClipPlayer, ClipCue, ClipPlayOptions, ClipPlayback, ClipReady, AudioPackInfo, AudioPackBelt, TrackCue, AudioSource } from '../shared/audio';
export { createStt, detectRecognitionCtor, stateForError, sttFailure, SHADOW_MAX_MS } from './stt';
export type { SttOptions, SttServiceEx, SttState, SttFailure, RecognitionLike, RecognitionCtor } from './stt';
export { createSfx, RECIPES, SFX_DURATION_MS, VIBRATION } from './sfx';
export type { SfxEngine, Recipe } from './sfx';
export { rankVoices, pickPair, installGuide, detectPlatform, isJaVoice, voiceLabel, PAIR_OFFSET } from './voices';
export type { RankedVoice, VoicePair, VoiceLike, Platform } from './voices';
export { S as AUDIO_STRINGS, STT_STATE_LABEL, SOURCE_LABEL } from './strings';
