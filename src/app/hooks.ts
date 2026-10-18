/**
 * TSUZUKU — shell hooks shared by the app pages (group A).
 *
 * The audio barrel is installed behind first paint (`main.tsx`), so a page
 * that reads `services.audio.*` during render would otherwise keep the
 * `nullAudio` answer it saw at mount ("text only", no voices, no pack) until
 * some unrelated state change re-rendered it. Reading `servicesVersion.value`
 * in render subscribes the component to the slot: `installServices()` and
 * `resetServices()` bump the signal and the page re-renders with the live
 * service, so no poll and no timer are needed.
 *
 * `useAudioService` (design 08 §8): the live service for render-time reads
 * (`hasJaVoice`, `source`, `voices()`, `rateForTier`); handlers may keep
 * reading `services.audio` directly, since they read at call time.
 *
 * `useClipPlayer` (design 08 §8 / §13): the installed voice-pack player for
 * Settings (sizes, cache usage, belt downloads) and About (credits), and
 * whether the question "is there a pack?" is settled. A cold load sees
 * `services.audio.clips === undefined` before the real service lands — "not
 * installed yet", never "no pack". Settled once the slot holds something other
 * than `nullAudio`, or any install / reset has happened (a build with no pack
 * installs a real service without a player); only then does an undefined
 * player mean this build has none.
 *
 * Contract with `main.tsx`: `installAudio()` must bump the version on EVERY
 * outcome — the real service on success, and `installServices({})` (bumps
 * the signal, swaps nothing) when the audio barrel fails to load or
 * `createWebAudio` throws. Without that bump a failed boot would leave the
 * pack card "looking" for the life of the page: there is no give-up timer here.
 */
import { nullAudio, services, servicesVersion, type AudioService, type ClipPlayer } from '@/shared/audio';

export function useAudioService(): AudioService {
  void servicesVersion.value; // subscribe: installServices() / resetServices() bump it
  return services.audio;
}

export function useClipPlayer(): { clips: ClipPlayer | undefined; settled: boolean } {
  const audio = useAudioService();
  return { clips: audio.clips, settled: audio !== nullAudio || servicesVersion.value > 0 };
}
