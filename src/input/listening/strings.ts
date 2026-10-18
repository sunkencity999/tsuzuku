/**
 * TSUZUKU — 聴解 Listening Arena copy (Sensei voice, design 01 §3 / 04 §5 / 08 §10–§11).
 *
 * Every user-visible string of `src/input/listening/**` lives here
 * (ARCHITECTURE §8), linted by `src/i18n/banned.test.ts`. Terse, warm, dry;
 * "you", never guilt. Templates use `{name}` placeholders filled with
 * `fill()` (re-exported from `@/shared/ui/strings`). Every Japanese label
 * carries its English beside it (the learner starts with zero Japanese), and
 * the voice vocabulary is design 08's: "synthetic" (VOICEVOX), "device voice",
 * "text only" — never a word that would claim a human recording.
 */
import type { ListeningGenre } from '@/content/types';

export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── header ──────────────────────────────────────────────────────────── */
  title: 'Listening Arena',
  titleJa: '聴解',
  /** The Ear Walk (design 08 §10.4): pool sentences instead of a text. 聞き歩き = "listening as you walk". */
  walkTitle: 'Ear Walk',
  walkTitleJa: '聞き歩き',
  walkStoryTitle: '{n} sentences you can follow',
  speedLabel: 'Speed {rate}×',
  voicesLabel: '{n} voices',
  oneVoiceLabel: '1 voice',
  /** Source chips (design 08 §10.4): what is speaking, said plainly. */
  sourceClips: '{n} voices · synthetic',
  sourceClipsOne: '1 voice · synthetic',
  sourceDevice: '{n} voices · device',
  sourceDeviceOne: '1 voice · device',
  sourceNone: 'text only',
  speakersLabel: 'Voices:',
  /** Lines without a speaker label (a diary entry, a pool example): the narrator's voice. */
  narrationName: 'narration',
  genreLabel: 'Genre: {genre}',
  listenFirstChip: 'listen first',

  /* ── listen phase ────────────────────────────────────────────────────── */
  audioOnly: 'Audio only. The transcript opens after the questions.',
  walkIntro: 'Sentences built from words you already hold; one may carry a word you are learning. Audio only, then the questions.',
  play: 'Play',
  playing: 'Playing…',
  replay: 'Replay',
  replaysLeft: '{n} replays left',
  noReplaysLeft: 'No replays left',
  lineOf: 'Line {i} of {n}',
  toQuestions: 'To the questions',
  noVoice: 'No Japanese voice is available on this device. The lines are shown as text instead; the questions still count.',
  volumeOff: 'Volume is 0, so nothing would be heard. The lines are shown as text instead; turn the sound up in Settings for audio only.',

  /* ── first-contact cards (design 08 §11, shared TeachOnce) ───────────── */
  teachArenaFirstTitle: 'You hear it before you see it.',
  teachArenaFirstBody: 'Two replays. The second caps the grade at Hard: honest, not a penalty. The transcript opens after the questions.',
  teachArenaBridgeTitle: 'Some pieces now sound like real people.',
  teachArenaBridgeBody: 'Dropped particles, fillers, half-finished thoughts. Aim for 93%, not 100%.',
  teachDismiss: 'Got it',

  /* ── questions phase ─────────────────────────────────────────────────── */
  questionOf: 'Question {i} of {n}',
  gistPrompt: 'From what you heard:',
  choicePromptEn: 'Which meaning did you hear?',
  choicePromptJa: 'Which line did you hear?',
  dictationPrompt: 'Type the line you heard.',
  /** Clause dictation (design 08 §9): one clause of a long line. */
  clausePrompt: 'Type the part you heard.',
  clauseNote: 'One clause of a longer line: {n} beats.',
  choicesLabel: 'Choices',
  choiceN: 'Choice {n}',
  playLine: 'Play the line',
  typedField: 'What you heard',
  submit: 'Submit',
  nothingTyped: 'Type something first.',
  next: 'Next',
  toTranscript: 'To the transcript',
  secondReplayCeiling: 'Second replay: the best this line can earn is Hard.',
  correct: 'Correct.',
  near: 'Close. Hard.',
  wrong: "Again. That's the training.",
  scoreLine: '{pct}% of the morae',
  /** A missed question that names its line (design 08 §9 `lineRef`). */
  lineRefReplay: 'Line {i} holds the answer. Hear it again.',
  theLine: 'The line',
  diffLegend: 'Struck characters were extra; dotted characters were missing.',

  /* ── transcript phase ────────────────────────────────────────────────── */
  transcript: 'Transcript',
  relistenRequired: 'One more listen, a touch faster. Then the set is done.',
  relisten: 'Listen again at {rate}×',
  relistening: 'Listening again at {rate}×…',
  relistenDone: 'Faster, and you followed it.',
  showEnglish: 'Show English',
  hideEnglish: 'Hide English',
  speakerLabel: 'Speaker {name}',
  nowSpeaking: 'now speaking',
  /** The mora dots of a natural-slow take (design 08 §9): one dot per beat. */
  moraDotsLabel: '{n} beats',
  /** Credits (design 08 §6): one line per speaker on the clip path. */
  creditsTitle: 'Synthetic voices (VOICEVOX)',
  creditLine: '{name} · {credit}',
  finish: 'Finish',

  /* ── result ──────────────────────────────────────────────────────────── */
  resultTitle: 'Set complete',
  resultLine: '{correct} of {total} right at {rate}×',
  resultPass: 'Your ear did the work. The words will follow.',
  resultMiss: 'Listening grows by listening. Same set, another day.',
  /** The tier OFFER (design 08 §11): the app never changes speed silently. */
  tierOffer: 'Clean set. After a clean set the dojo offers the next speed tier; you decide.',
  tierOfferNote: 'Slow here is spoken slowly, not stretched. Faster tiers keep the pitch.',
  tierAccept: 'Tier {tier} from now',
  tierKeep: 'Stay at this tier',
  tierAccepted: 'Tier {tier}. Every voice in the dojo speaks a little faster now.',
  tierTop: 'Top tier. Nothing left to speed up; keep listening.',
  minutesLogged: '{n} min listened, in the ledger',

  /* ── states ──────────────────────────────────────────────────────────── */
  loading: 'Opening the set.',
  notFound: 'This set is not in the loaded content.',
  noLines: 'This set has no lines to play.',
  walkEmpty: 'None of these sentences is in the loaded content.',

  /* ── standalone page (#/listen/:id) ──────────────────────────────────── */
  pageNav: 'Where to',
  pageNext: 'Next',
  pageBack: 'Back to the dojo',
  pageStation: 'Station {n}',
  pageRolePlay: 'Play it as a conversation',
  pageRead: 'Read the episode',
  /** An audio-first piece (design 08 §10.1): the text opens after a pass, or on purpose. */
  pageReadAnyway: 'Read it anyway',
  pageListenFirst: 'This piece is heard before it is read. Pass the set and the text opens.',
  pageAgain: 'Listen again',
  pageTier: 'Your speed tier is {tier}: {rate}×. Change it in Settings.',
  pageLedger: 'Listening minutes go to your ledger when the set is done.',
} as const;

/** Plain English for a piece's genre (design 08 §3), shown in the header chip. */
export const GENRE_LABEL: Record<ListeningGenre, string> = {
  exchange: 'a short exchange',
  'self-intro': 'a self-introduction',
  phone: 'a phone call',
  directions: 'directions',
  voicemail: 'a voicemail',
  'casual-talk': 'casual talk',
  narrative: 'a story told aloud',
  announcement: 'an announcement',
  weather: 'a weather report',
  interview: 'an interview',
  news: 'the news',
  drama: 'a drama',
  debate: 'a debate',
  lecture: 'a lecture',
  essay: 'an essay read aloud',
};
