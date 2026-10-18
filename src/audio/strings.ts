/**
 * TSUZUKU — audio copy (Sensei voice, design 01 §3). Linted by
 * `src/i18n/banned.test.ts`. Plain strings only; the components template.
 *
 * Everything a learner may read about voices, sound and speech recognition
 * lives here: the one-time install guide per OS (design 07 §7), the
 * network notice for recognition and vendor voices (design 06 §7 #10), the
 * typed recognizer states the speaking exercises surface, and the honesty
 * vocabulary of the voice pack (design 08 §1 / §10.1): a status chip says
 * `synthetic voice (VOICEVOX)`, `device voice` or `text only` — the word
 * "recorded" never appears on a chip, header or label.
 */
import type { AudioSource } from '../shared/audio';

export const S = {
  // Voice availability
  noJaVoice: 'No Japanese voice on this device yet. Kana is shown at full size; audio drills fall back to text.',
  noJaVoiceShort: 'No Japanese voice',
  networkVoice: 'network voice',
  networkVoiceNote: 'A network voice sends the text to its vendor to be spoken. Local voices stay on your device.',
  localVoice: 'on this device',
  voiceDefault: 'System default',
  voiceSlotA: 'Voice A',
  voiceSlotB: 'Voice B',
  oneVoicePair: 'One Japanese voice. Dialogues use it twice, slightly lower and slower for the second speaker.',
  voiceTest: 'Test the voice',
  voiceTestLine: 'おはようございます。今日もよろしくお願いします。',
  voiceLoading: 'Looking for voices.',

  // Install guides (design 07 §7: Windows language pack, macOS Spoken Content, Android TTS data)
  installWindows:
    'Add a Japanese voice: Settings, Time and Language, Language and region, Add a language, Japanese. Tick Text-to-speech, then reload this page.',
  installMac:
    'Add a Japanese voice: System Settings, Accessibility, Spoken Content, System voice, Manage Voices. Download Kyoko or O-Ren, then reload this page.',
  installIos:
    'Add a Japanese voice: Settings, Accessibility, Spoken Content, Voices, Japanese. Download Kyoko or O-Ren, then reload this page.',
  installAndroid:
    'Add a Japanese voice: Settings, System, Languages and input, Text-to-speech output, Speech Services by Google, Install voice data, Japanese. Then reload this page.',
  installLinux:
    'Add a Japanese voice: install a speech-dispatcher voice for Japanese (for example espeak-ng with the ja voice) and restart the browser.',
  installGeneric: 'Add a Japanese text-to-speech voice in your system settings, then reload this page.',
  /** The clip-aware branch of the install guide (design 08 §8): the pack speaks, so the device voice is optional. */
  installPackPlaying: 'Synthetic voices (VOICEVOX) are playing; a device voice is optional.',

  // Voice pack source chips (design 08 §10.1): lower case, used beside a label
  sourceClips: 'synthetic voice (VOICEVOX)',
  sourceSynth: 'device voice',
  sourceNone: 'text only',
  /** Spoken in the honesty copy once; never on a chip. */
  packExplain: 'Pre-rendered synthetic voices (VOICEVOX), clear and consistent on purpose. Your device voice speaks whenever a clip is missing.',
  packAbsent: 'This build has no voice pack; your device voice speaks.',
  packLoading: 'Checking for the voice pack.',

  // Speech recognition
  sttUnavailable: 'Speech recognition is not available in this browser. The self-assessment path earns the same XP.',
  sttNetworkNotice:
    'Speech recognition is provided by your browser vendor and may send audio to their servers. The self-assessment path is fully offline and earns identical XP.',
  sttDenied: 'The microphone is blocked. Allow it in the browser, or keep the self-assessment path.',
  sttNoSpeech: 'Nothing heard. Speak a little closer, or try once more.',
  sttNetwork: 'Recognition needs a network connection right now. The self-assessment path works offline.',
  sttAborted: 'Recording stopped.',
  sttTimeout: 'Time is up for this line.',
  sttListening: 'Listening.',
  sttError: 'Recognition hit a snag. The self-assessment path is one tap away.',
  sttAudioCapture: 'No microphone was found. The self-assessment path is one tap away.',

  // Sound
  muted: 'Sound off',
  unmuted: 'Sound on',
  zenMuted: 'Zen keeps the dojo quiet. Voices still speak.',
  volume: 'Volume',
} as const;

/** The chip label for an `AudioSource` (`audioSourceOf(services.audio)`), design 08 §10.1. */
export const SOURCE_LABEL: Record<AudioSource, string> = {
  clips: S.sourceClips,
  synth: S.sourceSynth,
  none: S.sourceNone,
};

/** `S.sttXxx` keyed by recognizer state (`SttState`). */
export const STT_STATE_LABEL = {
  idle: '',
  listening: S.sttListening,
  done: '',
  'no-speech': S.sttNoSpeech,
  denied: S.sttDenied,
  network: S.sttNetwork,
  aborted: S.sttAborted,
  timeout: S.sttTimeout,
  unavailable: S.sttUnavailable,
  error: S.sttError,
  'audio-capture': S.sttAudioCapture,
} as const;
