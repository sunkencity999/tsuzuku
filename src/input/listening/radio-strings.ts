/**
 * TSUZUKU — 茶屋ラジオ Teahouse Radio copy (Sensei voice, design 01 §3 / 08 §10.2).
 *
 * Every user-visible string of `Radio.tsx`, `RadioPage.tsx` and
 * `media-session.ts` lives here (ARCHITECTURE §8), linted by
 * `src/i18n/banned.test.ts`. Every string teaches: a Japanese label always
 * carries its English gloss beside it, because the learner starts with zero
 * Japanese. Honesty vocabulary (design 08 §1, §10.1): the voices are
 * "synthetic voice (VOICEVOX)", "device voice" or "text only"; the word
 * "recorded" never appears on a chip, header or label. Templates use
 * `{name}` placeholders filled with `fill()`.
 */
export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── header ──────────────────────────────────────────────────────────── */
  titleJa: '茶屋ラジオ',
  title: 'Teahouse Radio',
  tagline: 'Listening you can follow, made of words you already know. Press play and let it run.',
  chipSynthetic: 'synthetic voice (VOICEVOX)',
  chipDevice: 'device voice',
  chipTextOnly: 'text only',
  chipSpeed: '{rate}×',
  chipStation: 'Station {n}',
  chipMinutes: '{n} min ready',

  /* ── source notices (why background play is or is not available) ───── */
  noticeDevice: 'This build or device has no voice pack, so your device voice reads each line while the screen is on. Background play and lock-screen controls need the pack.',
  noticeDeviceChosen: 'Settings prefer the device voice, so the lines play while the screen is on. Choose the voice pack in Settings for background play.',
  noticeNoVoice: 'No Japanese voice is available on this device and this build has no voice pack. The lines are shown as text.',
  noticeVolumeOff: 'Volume is 0, so nothing would be heard. The lines are shown as text; turn the sound up in Settings to listen.',
  noticePack: 'Whole pieces play edge to edge, so they keep going with the screen off; the lock screen shows the controls.',

  /* ── playlist notices ────────────────────────────────────────────────── */
  noticeNoPieces: 'Listening pieces start at Station 4. Until then the radio plays the kana tracks and the lines of the White stories.',
  noticeNothingNew: 'Nothing new today: you have heard every piece up to Station {n}. Re-hearings run one speed tier faster; new pieces arrive with the next station.',
  noticeEmpty: 'Nothing to play yet. The radio fills from what you know; clear a station and come back.',

  /* ── teach card (TeachOnce id "radio-first") ─────────────────────────── */
  teachTitle: 'Everything here is made of words you already know',
  teachBody: 'The radio plays pieces, dialogues and sentences built from your known words. Listen without reading; the transcript (T) is there when you want it. Nothing here earns XP or counts as a training day. It is input.',

  /* ── track card ──────────────────────────────────────────────────────── */
  trackOf: 'Track {i} of {n}',
  kindPiece: 'Piece',
  kindDialogue: 'Dialogue',
  kindStory: 'Story',
  kindSentence: 'Sentence',
  kindKana: 'Kana track',
  coldLabel: 'First hearing',
  againAt: 'Here it is again at {rate}×',
  loading: 'Tuning the radio.',
  loadError: 'The content did not load. Check the connection and come back.',
  playing: 'Playing',
  paused: 'Paused',
  readyLine: 'Ready. Press play.',
  lineOf: 'Line {i} of {n}',

  /* ── controls ────────────────────────────────────────────────────────── */
  play: 'Play',
  pause: 'Pause',
  resume: 'Resume',
  previous: 'Previous',
  next: 'Next',
  loop: 'Loop track',
  loopOn: 'Looping track',
  slower: 'Slower',
  faster: 'Faster',
  transcript: 'Transcript',
  gloss: 'Gloss',
  didntCatch: "Didn't catch that",
  keysHelp: 'Space play / pause · ← → track · L loop track · [ ] speed · T transcript · G gloss · ? didn’t catch that',
  speedNote: 'Speed here is for this sitting only; your speed tier in Settings is unchanged.',

  /* ── status notes ────────────────────────────────────────────────────── */
  didntCatchNote: 'Marked Hard on {n} words due for listening. Here is the line for a moment.',
  didntCatchNone: 'Nothing due to mark. Here is the line for a moment.',
  glossNone: 'Every word in this one is known. Nothing to gloss.',
  glossLine: '{word}（{kana}）— {en}',
  pauseNote: 'Paused. Minutes heard so far are in the ledger; the whole track starts over on play.',
  pauseNoteInPlace: 'Paused. Minutes heard so far are in the ledger; play picks up where it stopped.',
  pauseNoteLines: 'Paused. Minutes heard so far are in the ledger; play picks up at this line.',
  noticeNoWholeTrack: 'The pack has no whole track for this one yet, so its lines play one by one while the screen is on.',

  /* ── gist question ───────────────────────────────────────────────────── */
  gistTitle: 'From what you heard:',
  gistChoice: 'Choice {n}',
  gistSkip: 'Skip',
  gistCorrect: 'Correct. Those minutes count as understood.',
  gistWrong: 'Not this time. The answer: {answer}',
  gistSkipped: 'Skipped. The minutes still count; what we could not tell is whether you followed it.',

  /* ── transcript ──────────────────────────────────────────────────────── */
  transcriptTitle: 'Transcript',
  showEnglish: 'Show English',
  hideEnglish: 'Hide English',
  speakerLabel: 'Speaker {name}',
  nowSpeaking: 'now speaking',

  /* ── done ────────────────────────────────────────────────────────────── */
  doneTitle: 'End of the playlist',
  doneLine: '{n} min heard, in the ledger. No XP: hearing is input.',
  playAgain: 'Play it again',

  /* ── Media Session (lock screen) ─────────────────────────────────────── */
  album: '茶屋ラジオ Teahouse Radio · Station {n}',
  synthetic: 'synthetic',
  defaultSpeaker: 'ハナ',

  /* ── standalone page (#/radio) ───────────────────────────────────────── */
  pageNav: 'Where to',
  pageBack: 'Back to the dojo',
  pageStation: 'Station {n}',
  pageHonesty: 'Every voice here is synthetic: VOICEVOX character voices, pre-rendered, clear and consistent on purpose. Minutes go to your ledger as dojo listening; nothing here earns XP or lights the flame.',
  pageSettings: 'Voice pack, speed tier and volume live in Settings.',
} as const;
