/**
 * TSUZUKU — 対話 Taiwa role-play copy (Sensei voice, design 01 §3 / 04 §8).
 *
 * Every user-visible string of `src/input/taiwa/**` lives here (ARCHITECTURE
 * §8), linted by `src/i18n/banned.test.ts`. Terse, warm, dry; "you", never
 * guilt. Templates use `{name}` placeholders filled with `fill()`
 * (re-exported from `@/shared/ui/strings`). The aizuchi chips themselves are
 * Japanese content (`aizuchi.ts`), not copy.
 */
import type { RegisterTag } from '@/content/types';

export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── header / intro ──────────────────────────────────────────────────── */
  title: 'Role-Play',
  titleJa: '対話',
  youPlay: 'You play {name}',
  partner: 'Your partner: {name}',
  modeLabel: 'Mode: {mode}',
  registerLabel: 'Register: {register}',
  introLine: 'Listen, then answer in your role. Corrections come as the model line, mid-flow.',
  begin: 'Begin',

  /* ── partner lines ───────────────────────────────────────────────────── */
  npcSpeaking: '{name} is speaking…',
  npcWaiting: '{name} waits for a nod…',
  replayLine: 'Hear it again',
  showEnglish: 'Show English',
  hideEnglish: 'Hide English',
  registerShift: 'Register shift: {register}',

  /* ── learner turn ────────────────────────────────────────────────────── */
  yourLine: 'Your line',
  cue: 'Say: {en}',
  choosePrompt: 'Pick the line that fits.',
  buildPrompt: 'Build the line from the pieces.',
  typePrompt: 'Type your line.',
  speakPrompt: 'Say your line aloud.',
  optionN: 'Option {n}',
  tilesLabel: 'Pieces',
  tileN: 'Piece {n}',
  builtLabel: 'Your line so far',
  removeTile: 'Remove {tile}',
  undo: 'Undo',
  clear: 'Clear',
  submit: 'Submit',
  nothingBuilt: 'Pick at least one piece.',
  nothingTyped: 'Type something first.',
  typedField: 'Your line',
  hint: 'Hint',
  hintUse: 'Use: {words}',
  hintNone: 'No hint for this line. Say what the cue says.',
  hintCeiling: 'Hint used: this line counts as fine, not best.',
  speak: 'Speak',
  listening: 'Listening…',
  heard: 'Heard: {text}',
  nothingHeard: 'Nothing heard. Try again, or type the line.',
  tryAgain: 'Try again',
  typeInstead: 'Type instead',
  speakUnavailable: 'Speech recognition is not available here, so this role-play runs in Type mode. Same XP.',
  noVoice: 'No Japanese voice can be heard here (none installed, or sound is off), so your partner\'s lines are shown as text. Read each one, then Continue.',
  npcRun: 'Earlier in this turn',

  /* ── aizuchi ─────────────────────────────────────────────────────────── */
  aizuchiPrompt: 'Backchannel now.',
  aizuchiLabel: 'Backchannel',
  aizuchiChipN: 'Backchannel {n}',
  aizuchiHit: 'Good timing.',
  aizuchiLate: 'A beat late. The pause was earlier.',
  aizuchiMissed: '{name} waited for a nod. Fill the pause next time.',
  aizuchiOffRegister: 'Heard, though that one belongs to the other register.',

  /* ── feedback ────────────────────────────────────────────────────────── */
  best: 'Best line.',
  ok: 'That works. The model line:',
  near: 'Close. One sound off. The model line:',
  wrong: 'Not this time. The model line:',
  modelLine: 'Model line',
  yours: 'Yours',
  hearModel: 'Hear the model line',
  /** Design 08 §11: the gold line replays in the learner's role voice; `{speaker}` is the learnerSpeaker (never assumed). */
  yourLineAs: 'Your line, as {speaker} says it',
  continue: 'Continue',

  /* ── debrief ─────────────────────────────────────────────────────────── */
  debriefTitle: 'Debrief',
  bestLine: '{best} of {total} lines at their best',
  aizuchiLine: '{hit} of {total} backchannels on time',
  noAizuchi: 'No backchannel slots in this dialogue.',
  registerMeter: 'Register',
  registerClean: 'Every line matched the register.',
  registerSlipOne: 'One line slipped register.',
  registerSlips: '{n} lines slipped register.',
  corrections: 'Corrections',
  noCorrections: 'Nothing to correct. Every line was the model line.',
  slotHit: 'on time',
  slotLate: 'late',
  slotMissed: 'missed',
  closing: 'The conversation is over. Rest your voice.',

  /* ── states ──────────────────────────────────────────────────────────── */
  loading: 'Opening the dialogue.',
  notFound: 'This dialogue is not in the loaded content.',
  notDialogue: 'This text has no second speaker to play against.',

  /* ── standalone page (#/taiwa/:id) ───────────────────────────────────── */
  pageNav: 'Where to',
  pageNext: 'Next',
  pageBack: 'Back to the dojo',
  pageStation: 'Station {n}',
  pageListen: 'Hear it as a listening set',
  pageRead: 'Read the episode',
  pageAgain: 'Play it again',
  pageModeNote: '{mode} mode for your station and device.',
  pageLedger: 'Speaking minutes go to your ledger when the conversation ends.',
  pageLogged: '{n} min of conversation, in the ledger',
} as const;

export const MODE_LABEL: Record<'choose' | 'build' | 'type' | 'speak', string> = {
  choose: 'Choose',
  build: 'Build',
  type: 'Type',
  speak: 'Speak',
};

export const REGISTER_LABEL: Record<RegisterTag, string> = {
  neutral: 'neutral',
  polite: 'polite',
  casual: 'casual',
  formal: 'formal',
  written: 'written',
  honorific: 'honorific (sonkeigo)',
  humble: 'humble (kenjōgo)',
  slang: 'slang',
  dialect: 'dialect',
  literary: 'literary',
};
