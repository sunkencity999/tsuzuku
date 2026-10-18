/**
 * TSUZUKU — lock-screen controls for 茶屋ラジオ (design 08 §8 "Media Session").
 *
 * Everything sits behind feature detection: without `navigator.mediaSession`
 * (jsdom, Firefox before 82, kiosk shells) every call is a no-op that returns
 * `false`, so the Radio renders the same and simply has no lock-screen card.
 * Radio calls these only in pack mode; the device-voice path has no media
 * element, so the OS has nothing to control.
 *
 * `metadata.artist` names the voice honestly (design 08 §6 credits):
 * `{speaker} · synthetic · VOICEVOX:{character}` — the cast voice of the
 * speaker, said to be synthetic, with the character credit the licence asks
 * for; when the cue names no character the line stops at `synthetic` rather
 * than inventing a credit. `album` is `茶屋ラジオ Teahouse Radio · Station N`.
 */
import { S, fill } from './radio-strings';

/** The slice of `MediaSession` Radio uses; `navigator.mediaSession` satisfies it. */
export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState?: 'none' | 'paused' | 'playing';
  setActionHandler(action: MediaSessionAction, handler: (() => void) | null): void;
}

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  previoustrack(): void;
  nexttrack(): void;
  seekbackward(): void;
}

/** The actions Radio wires (design 08 §8). */
export const MEDIA_ACTIONS: readonly (keyof MediaSessionHandlers)[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward'];

export interface TrackMeta {
  /** `titleJa` of the text, the sentence kana or the kana track title. */
  title: string;
  /** Speaker label or narrator; `null` → the default narration voice (ハナ, design 08 §6). */
  speaker: string | null;
  /** `ClipCue.voice`: the VOICEVOX character, with or without the `VOICEVOX:` prefix; `''` when the cue names none (no credit is shown). */
  voice: string;
  station: number | null;
  /** Station-sign render or any artwork URL; omitted when the caller has none. */
  artwork?: string;
}

type NavLike = { mediaSession?: MediaSessionLike } | null | undefined;

/** `navigator.mediaSession` when the browser has it, else `null`. */
export function mediaSessionOf(nav?: NavLike): MediaSessionLike | null {
  const n = nav === undefined ? (typeof navigator === 'undefined' ? null : (navigator as unknown as NavLike)) : nav;
  const ms = n?.mediaSession;
  return ms && typeof ms.setActionHandler === 'function' ? ms : null;
}

/** `VOICEVOX:<character>` and a bare `<character>` both read as that character (the pack's `ClipCue.voice` may carry either). */
export function characterOf(voice: string): string {
  const v = voice.trim();
  return v.replace(/^VOICEVOX\s*:\s*/i, '');
}

/** `{speaker} · synthetic · VOICEVOX:{character}` (design 08 §8); without a character, `{speaker} · synthetic`. */
export function artistLine(speaker: string | null, voice: string): string {
  const who = speaker && speaker.trim().length > 0 ? speaker : S.defaultSpeaker;
  const character = characterOf(voice);
  return character.length > 0 ? `${who} · ${S.synthetic} · VOICEVOX:${character}` : `${who} · ${S.synthetic}`;
}

/** `MediaMetadata` is a constructor the page may lack; return `null` instead of throwing. */
function makeMetadata(init: MediaMetadataInit): MediaMetadata | null {
  const Ctor = (globalThis as { MediaMetadata?: new (init?: MediaMetadataInit) => MediaMetadata }).MediaMetadata;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor(init);
  } catch {
    return null;
  }
}

/**
 * Sets the lock-screen card for `track`. Returns `false` (and does nothing)
 * without a Media Session or a `MediaMetadata` constructor.
 */
export function setMetadata(track: TrackMeta, o: { nav?: NavLike } = {}): boolean {
  const ms = mediaSessionOf(o.nav);
  if (!ms) return false;
  const meta = makeMetadata({
    title: track.title,
    artist: artistLine(track.speaker, track.voice),
    album: fill(S.album, { n: track.station ?? '—' }),
    ...(track.artwork ? { artwork: [{ src: track.artwork }] } : {}),
  });
  if (!meta) return false;
  try {
    ms.metadata = meta;
  } catch {
    return false;
  }
  return true;
}

/** Mirrors the player state to the OS (so the lock screen shows play or pause). No-op without a session. */
export function setPlaybackState(state: 'none' | 'paused' | 'playing', o: { nav?: NavLike } = {}): boolean {
  const ms = mediaSessionOf(o.nav);
  if (!ms || !('playbackState' in ms)) return false;
  try {
    ms.playbackState = state;
  } catch {
    return false;
  }
  return true;
}

/**
 * Wires play / pause / previoustrack / nexttrack / seekbackward. Returns a
 * function that clears them again (unmount). Without a session it returns a
 * no-op and `wired: false`.
 */
export function setHandlers(h: MediaSessionHandlers, o: { nav?: NavLike } = {}): { wired: boolean; clear(): void } {
  const ms = mediaSessionOf(o.nav);
  if (!ms) return { wired: false, clear: () => undefined };
  const set: (keyof MediaSessionHandlers)[] = [];
  for (const action of MEDIA_ACTIONS) {
    try {
      ms.setActionHandler(action, () => h[action]());
      set.push(action);
    } catch {
      // an action this browser does not support (seekbackward on some): skip it, keep the rest
    }
  }
  return {
    wired: set.length > 0,
    clear() {
      for (const action of set) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // already gone
        }
      }
      try {
        ms.metadata = null;
      } catch {
        // read-only in some shells
      }
    },
  };
}
