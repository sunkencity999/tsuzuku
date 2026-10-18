/**
 * TSUZUKU — copy for the five shell pages (group A, Sensei voice, design 01 §3).
 *
 * The shell strings (`@/i18n/strings`) already carry the dojo / onboarding /
 * settings / backup / about copy that the page briefs name; this file spreads
 * them and adds the lines only these pages need, so every string a page shows
 * resolves from one `S`. Keys are typed exactly: a missing key fails `tsc`.
 * Linted by `src/i18n/banned.test.ts` (as text and as exported values).
 */
import { S as SHELL, fmt, BELT_NAME, WEEKDAYS } from '@/i18n/strings';

export { fmt, BELT_NAME, WEEKDAYS };

/**
 * The honest share (design 08 §12): stated on the Ledger page (`records/strings.ts`
 * carries the same words), in onboarding's honesty clause and on the About page.
 * The hours are the corpus figures: ≈ 24 h of connected speech, ≈ 13 h of drill clips.
 */
const HONEST_SHARE =
  'Every voice in the dojo is synthetic: VOICEVOX character voices, pre-rendered, clear and consistent on purpose. The dojo holds about 24 hours of sentences and texts, plus about 13 hours of word and phrase clips for drills, and gives you about 70–90 hours of worthwhile listening over the road, because each piece returns at rising speed. That covers the weekly listening target through Orange (from Station 9), about a quarter of it from Green to Purple and an eighth at Brown and Black. Real people mumble, overlap and joke; the ledger’s outside hours exist for that, and the 1,500-hour goal still needs the world.';

const PAGE = {
  /* ── shared ───────────────────────────────────────────────────────── */
  levelLine: 'Level = effort. Belt = skill.',
  stepOf: 'Step {i} of {n}',
  percent: '{n}%',
  kb: '{n} KB',
  mb: '{n} MB',
  gb: '{n} GB',
  reloadHint: 'Reload so every room reads the new save.',

  /* ── listening honesty (design 08 §10.1 / §12) ────────────────────── */
  /** The three source words a chip or header may use; "recorded" is never one of them. */
  sourcePack: 'synthetic voice (VOICEVOX)',
  sourceDevice: 'device voice',
  sourceNone: 'text only',
  honestShare: HONEST_SHARE,
  /** Overrides the shell's device-TTS clause on the pace step (design 08 §12). */
  onbTtsNotice: HONEST_SHARE,

  /* ── dojo (home) ──────────────────────────────────────────────────── */
  dojoSceneLabel: 'Your dojo',
  dojoFeedLoading: 'Reading the day.',
  dojoFeedFailed: 'The forecast is unavailable right now. The sessions still work.',
  dojoFirstRunTitle: 'The road starts at Nihonbashi.',
  dojoFirstRunBody: 'Two minutes: your name, a kana check, your pace. Then the first station.',
  dojoFirstRunCta: 'Begin',
  dojoSessions: 'Sessions',
  dojoStartSession: 'Start {name}, about {n} minutes',
  dojoDue: '{n} due',
  dojoDueOne: '1 due',
  dojoScrolls: '{n} scrolls',
  dojoScrollOne: '1 scroll',
  dojoEpisodeOne: '1 episode',
  dojoNoDue: 'Nothing due. Any session still counts.',
  dojoResumeTitle: 'A session is waiting.',
  dojoResumeHint: 'Resume where you stopped, or clear it and start fresh.',
  dojoQuestOf: '{n} of {target}',
  dojoQuestDone: 'Done',
  dojoTeaserTitle: 'Next time',
  dojoTeaserTitleJa: '次回予告',
  dojoTeaserSentence: 'From your next episode',
  dojoTeaserWords: 'Three words you will meet tomorrow',
  dojoKageTitle: 'Kage',
  dojoKageTitleJa: '影',
  dojoKageBest: 'Best of the last four weeks: {n}',
  dojoKageLast: 'Last run: {n}',
  dojoKageNoRun: 'No run yet. The first one sets the pace.',
  dojoKageRun: 'Run the ghost set',
  dojoNemesisTitle: 'Nemesis',
  dojoNemesisTitleJa: '宿敵',
  dojoNemesisHint: 'The duel comes inside your next Kumite or larger.',
  dojoGateTitle: 'Gatekeeper',
  dojoGateTitleJa: '関守',
  dojoGateReady: '{gate} waits at the end of {station}.',
  dojoGateCta: 'Face the Gatekeeper',
  dojoGateProgress: '{green} of {total} items Green',
  dojoShinsaTitle: 'Shinsa',
  dojoShinsaTitleJa: '審査',
  dojoShinsaReady: 'The {belt} belt examination is open.',
  dojoShinsaCta: 'Take the Shinsa',
  dojoShinsaNotYet: 'The {belt} belt examination is not open yet.',
  dojoProverb: 'Today’s proverb',
  dojoRoad: 'The Road',
  dojoRoadJa: '東海道',
  dojoStationLink: 'Station {n}, {name}',
  dojoBeltStatus: '{belt} belt · Station {n}',
  dojoArcadeHint: 'Free play. Nothing is marked Again here; a miss just comes back untimed next session.',
  // 茶屋ラジオ tile (design 08 §10.2): a quiet, non-session surface
  dojoRadioTitle: 'Teahouse Radio',
  dojoRadioTitleJa: '茶屋ラジオ',
  dojoRadioLede: 'Listening with the text closed: pieces and sentences you can already follow, at rising speed.',
  dojoRadioMinutes: '{n} min of material you can already follow',
  dojoRadioNote: 'Not a session; it never counts as a training day.',
  dojoRadioOpen: 'Open the radio',

  /* ── onboarding (日本橋) ───────────────────────────────────────────── */
  onbNamePlaceholder: 'むめい',
  onbNameSummary: 'You train as {name}.',
  onbKanaFull: 'Check all forty-six',
  onbKanaPrompt: 'Type the reading',
  onbKanaPromptHint: 'Type romaji or kana. Enter checks it.',
  onbKanaCheck: 'Check',
  onbKanaProgress: '{i} of {n}',
  onbKanaCorrect: 'Read.',
  onbKanaMissed: 'Not yet. It goes to training.',
  onbKanaResult: '{known} of {n} kana read.',
  onbKanaResultHint: 'The ones you read start as known. The rest are taught at Shinagawa, the first station.',
  onbKanaSentBack: 'Back to training: {list}',
  onbKanaAllKnown: 'All forty-six kana marked as known.',
  onbKanaNoneKnown: 'Every kana is taught from the first station.',
  onbKanaTiles: 'Twelve tiles',
  onbKanaRedo: 'Check again',
  onbPaceHint: 'Change it any time in Settings.',
  onbPaceReviews: 'About {n} reviews a day at steady state.',
  onbHoursLabel: 'In this app',
  onbHoursValue: 'About {hours} hours',
  onbMonthsLabel: 'Kyoto',
  onbMonthsValue: 'About {full} months every day · about {partial} months at seven days in ten',
  onbVoiceHeard: 'If you heard it, the voice works.',
  onbVoiceSpeaking: 'Speaking.',
  onbVoiceGuideOpen: 'How to install one',
  // Meet ハナ (design 08 §10.5): sound before symbol, before the kana check
  onbMeetTitle: 'Meet',
  onbMeetName: 'ハナ',
  onbMeetNameEn: 'Hana',
  onbMeetBody: 'Hana walks the road with you: hers is the first voice you hear, and the kana, the words and her own lines stay in it. First the five vowel sounds, then hello.',
  onbMeetSource: 'On this device she speaks as: {source}.',
  onbMeetPlay: 'Hear',
  onbMeetAgain: 'Hear it again',
  onbMeetVowels: 'The five vowel sounds. Every Japanese syllable ends in one of them.',
  onbMeetGreetingEn: 'hello',
  onbMeetGreetingNote: 'Said from late morning until dusk. Your ear meets it first; the kana follow at the first station.',
  onbKanaSoundFirst: 'Each kana is spoken as it appears. Sound first, then the symbol.',
  onbKanaHear: 'Hear it again',
  onbSummaryTitle: 'Ready',
  onbSummaryPace: 'Pace: {pace}',
  onbSummaryKana: 'Kana known: {n} of 46',
  onbSummaryTheme: 'Theme: {theme}',
  onbSummarySpeech: 'Speaking: {mode}',
  onbSaving: 'Writing your save.',

  /* ── settings ─────────────────────────────────────────────────────── */
  setStudy: 'Study',
  setDisplay: 'Display',
  setAudio: 'Audio',
  setReminders: 'Reminders and rest',
  setPrivacy: 'Privacy and data',
  setDanger: 'Danger zone',
  setPaceCasual: 'Casual',
  setPaceStandard: 'Standard',
  setPaceIntense: 'Intense',
  setCustomHint: 'Your own numbers. The review cap still scales with your belt.',
  setRetentionHint: 'Higher retention means more reviews per day.',
  setSpeedTierHint: '{rate}× playback for listening exercises.',
  setSpeedTierNote: 'Slow is spoken slowly through Station 17; faster speeds keep the pitch.',
  setSoundHint: 'Master volume. Zen plays only the voice.',
  // 音声パック voice pack card (design 08 §13); "synthetic", never "recorded"
  setPackTitle: 'Voice pack',
  setPackTitleJa: '音声パック',
  setPackExplain: 'Pre-rendered synthetic voices (VOICEVOX). Every clip is made from the text ahead of time, so what you hear and what you read always agree.',
  setPackSizes: 'Your belt: {belt} · all belts: {all} · on this device: {device}',
  /** A partial pack may carry no clips for the learner's belt: say so instead of a false 0 MB. */
  setPackSizesNoBelt: 'Your belt: not in this pack · all belts: {all} · on this device: {device}',
  setPackCounting: 'counting',
  setPackLoading: 'Looking for the voice pack.',
  setPackNone: 'This build has no voice pack; your device voice speaks.',
  setPackBeltsTitle: 'Download for offline',
  setPackBeltsHint: 'One visit already keeps the dojo itself offline; audio is extra and comes belt by belt.',
  setPackDownload: 'Download',
  setPackRemove: 'Remove',
  setPackDownloading: 'Downloading {belt}: {pct}%',
  setPackDownloaded: '{belt} audio is on this device.',
  setPackRemoved: '{belt} audio removed from this device.',
  setPackFailed: 'The download stopped before the end. Nothing else changed; try again when the connection is back.',
  setPackRemoveFailed: 'The audio could not be removed right now. Try again later.',
  setPackSafari: 'Safari may clear downloaded audio after seven days without a visit unless the dojo is installed to the Home Screen.',
  setAudioSource: 'Voice source',
  setAudioSourcePack: 'Voice pack',
  setAudioSourceDevice: 'Device voice',
  setAudioSourceHint: 'Voice pack: kana, words, example sentences, Pitch Ear, texts and the radio in VOICEVOX character voices; the device voice fills in whatever the pack lacks. Device voice: every drill through the voices chosen above, pack or not.',
  setDataSaver: 'Data saver',
  setDataSaverHint: 'No audio fetched ahead of time; the radio loads one track at a time. Switches itself on when your browser asks to save data.',
  /** The switch shows the effective state while `navigator.connection.saveData` forces it on (design 08 §13). */
  setDataSaverForced: 'Your browser asks for data saving — idle downloads are off.',
  /** The device-voice picker when no Japanese system voice exists but the pack speaks (design 08 §8: no install nag). */
  setVoiceNonePack: 'No Japanese device voice; the voice pack speaks',
  setCrtHint: 'Only in the Arcade feel.',
  setVoiceDefault: 'System default',
  setVoiceHint: 'Voices marked network may send text to your browser vendor.',
  setRestDayHint: 'One fixed rest day a week never breaks the streak.',
  setReminderDownloaded: 'Calendar file saved.',
  setReminderFailed: 'Download is not available here. Copy the text below into a calendar.',
  setStorageLevelOk: 'Plenty of room.',
  setStorageLevelWarn: 'Getting large. Export a backup soon.',
  setStorageLevelCeiling: 'At the limit. New progress may not be saving; export a backup now.',
  setStorageOf: '{kb} KB of {mb} MB',
  setResetTitle: 'Start over',
  setResetBody: 'This browser’s save is replaced by a fresh one: cards, settings, collections, streak. Export a backup first if you might want it back.',
  setResetType: 'Type つづく to confirm',
  setResetButton: 'Reset this save',
  setResetDone: 'A fresh save. The road starts again at Nihonbashi.',
  setResetMismatch: 'Not quite. Type つづく.',
  setSpeedGradingHint: 'Only mature items are timed.',
  setJjHint: 'Japanese definitions first on glossary cards (from Station 34).',
  setWritingHint: 'Writing Dojo pieces and kanji writing drills.',
  setVerticalHint: 'Tategaki columns for stories (from Blue).',
  setClassicHint: 'Four buttons after each answer instead of the automatic map.',

  /* ── backup ───────────────────────────────────────────────────────── */
  bakIntro: 'Your study data lives in this browser. A backup is one file you keep.',
  bakStorageTitle: 'Storage',
  bakAdvice: 'Export after a milestone, and whenever the meter turns amber. A backup opens in any browser running TSUZUKU.',
  bakChooseFile: 'Choose a backup file',
  bakReading: 'Reading the file.',
  bakExporting: 'Writing the file.',
  bakDownloadFailed: 'The download could not start. Nothing was changed.',
  bakWarnings: 'Notes',
  bakCardsGained: '{n} cards gained',
  bakCardsLost: '{n} cards not in the file',
  bakExportedAt: 'Exported {date}',
  bakPreviewDays: 'Days trained',
  bakApplying: 'Applying.',
  bakFileLine: '{name} · {kb} KB',

  /* ── about ────────────────────────────────────────────────────────── */
  aboutWhatTitle: 'What this is',
  aboutWhat: 'TSUZUKU is a daily Japanese dojo: a spaced-repetition scheduler wearing a fighting-game costume. Fifty-three stations from Nihonbashi to Kyoto, three session sizes, one flame that forgives.',
  aboutHowTitle: 'How it teaches',
  aboutHow: 'Every rep retrieves or produces something; nothing pays for re-reading. Recognition and production are separate muscles with separate schedules. Speed is trained apart from accuracy. Input is the engine, and the ledger counts the hours outside the app.',
  aboutPrivacyTitle: 'Privacy',
  aboutCreditsTitle: 'Credits',
  aboutCredits: 'Built by one learner for other learners. Fonts by their designers under the Open Font License; kana conversion by wanakana.',
  aboutLicenseCode: 'The code is released under the MIT License; the text is LICENSE at the root of the repository.',
  aboutLicenseContent: 'Content and art are released under Creative Commons Attribution-ShareAlike 4.0; the terms and the attribution line are in CONTENT_LICENSE.md beside it.',
  aboutLicenseVoices: 'The voice clips are VOICEVOX character audio under each character’s terms, credited by name below; they are not CC BY-SA content.',
  aboutVoicesTitle: 'Voices',
  aboutVoicesTitleJa: '声',
  aboutVoicesNone: 'No voice pack in this build; your device voice speaks.',
  aboutVoiceCreditNote: 'a VOICEVOX character voice',
  aboutLoadErrorsTitle: 'Rooms that did not open',
  aboutNoLoadErrors: 'Every room opened.',
  aboutNoEvents: 'Nothing yet.',
  aboutRuleLabel: 'Rule {n}',
} as const satisfies Record<string, string>;

export const S = { ...SHELL, ...PAGE } as const;

export type PageStringKey = keyof typeof S;

/** `{n}` → `1,234` with a thin grouping, for counts shown to a learner. */
export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
