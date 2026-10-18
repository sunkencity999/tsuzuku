/**
 * TSUZUKU — the audio slot as group D's drills see it (ARCHITECTURE §0 / §3,
 * design 08 §8). Every body lives in the contract tier (`shared/audio.ts`), so
 * D's drills, F's `@/audio` and the input group read one definition; this
 * module keeps D's import path (`../voice`) and is the ONLY place a drill
 * reaches the voice pack: no file under `src/exercises/**` imports
 * `src/audio` or `src/input` (the import lint, `src/i18n/lint.test.ts`).
 *
 *  · `voiceAudible` — `speak()` will be heard (text fallbacks gate on it).
 *  · `clipSource()` — what the status copy should name right now:
 *    `'clips'` (synthetic voice, VOICEVOX), `'synth'` (device voice) or
 *    `'none'` (text only); `audioSourceOf(services.audio)`.
 *  · `clipCue(key)` / `canPlayClip(key)` — the pack cue a clip key resolves
 *    to (`services.audio.clipFor`), `undefined` / `false` on `nullAudio`, on
 *    a build without a pack and on every existing `{ ...nullAudio }` double,
 *    so with no pack every drill behaves exactly as before. The answer is
 *    gated the way `speak()` itself is (design 08 §8 / §13): under
 *    `settings.audioSource === 'device'` or while `packReady` is `false` the
 *    pack is not consulted, so a drill's source copy, `data-source` and
 *    same-source decisions never name a clip the runtime would not play.
 */
import { audioSourceOf, services, type AudioSource, type ClipCue } from '@/shared/audio';
import { store } from '@/store';

export { audioSourceOf, speak, voiceAudible } from '@/shared/audio';
export type { AudioSource, ClipCue, SpeakOptions } from '@/shared/audio';

/** The source the live audio slot would use for the next `speak()` (design 08 §8 / §10.1). */
export function clipSource(): AudioSource {
  return audioSourceOf(services.audio);
}

/**
 * Whether `speak()` may reach the pack at all right now: the learner has not
 * chosen the device voice (`settings.audioSource`, design 08 §13) and the
 * slot does not report an unready pack (`packReady` `false`; absent on
 * `nullAudio` and on doubles, which counts as no objection).
 */
export function packAllowed(): boolean {
  if (store.settings.value.audioSource === 'device') return false;
  return services.audio.packReady?.value !== false;
}

/** The pack cue `key` resolves to right now (nearest native rate), or `undefined` when the pack misses, there is none, or `packAllowed()` is false. */
export function clipCue(key: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined {
  if (!packAllowed()) return undefined;
  return services.audio.clipFor?.(key, o);
}

/** Whether `speak(text, { clip: key })` would play a pack clip rather than the device voice. */
export function canPlayClip(key: string, o?: { rate?: number; speaker?: string }): boolean {
  return clipCue(key, o) !== undefined;
}

/** Whether the pack holds `key` AND its accent matched the dictionary pitch (design 08 §7 verify; Pitch Ear's gate). */
export function isPitchVerified(key: string): boolean {
  return clipCue(key)?.pitchVerified === true;
}
