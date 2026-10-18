/**
 * TSUZUKU — listening drill copy (Sensei voice, design 01 §3 / 04 §5).
 *
 * Every user-visible string of `src/exercises/listening/**` lives here
 * (ARCHITECTURE §8), linted by `src/i18n/banned.test.ts`. Terse, warm, dry.
 * Templates use `{name}` placeholders filled with `fill()`.
 */
import type { ErrorTag } from '@/content/types';

export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── sentence dictation ──────────────────────────────────────────────── */
  listenPrompt: 'Listen, then type what you heard.',
  listenChoosePrompt: 'Listen, then choose the meaning.',
  play: 'Play',
  playing: 'Playing…',
  replay: 'Replay',
  replaysLeft: '{n} replays left',
  noReplaysLeft: 'No replays left',
  secondReplayCeiling: 'Second replay: the best this rep can earn is Hard.',
  speedLabel: 'Speed {rate}×',
  noVoice: 'No Japanese voice is available. Read the sentence instead.',
  hint: 'Hint',
  hintMeaning: 'Meaning',
  hintStart: 'It starts with',
  hintCeiling: 'Hint used: the best this rep can earn is Hard.',
  typedField: 'What you heard',
  submit: 'Submit',
  continue: 'Continue',
  nothingTyped: 'Type something first.',
  score: 'Score',
  scoreLine: '{pct}% of the morae',
  yours: 'Yours',
  theSentence: 'The sentence',
  diffLegend: 'Struck morae were extra; dotted morae were missing. The color names the slip.',
  bandGood: 'Clean. Good.',
  bandHard: 'Close. Hard.',
  bandAgain: 'Not yet. Again.',
  choiceCorrect: 'Correct.',
  choiceMiss: "Again. That's the training.",
  meaningLabel: 'Meaning',
  /** Clause dictation (design 08 §9): one clause of a line too long to dictate whole. */
  clauseNote: 'One piece of a longer line. Type just what plays.',
  theClause: 'The piece you heard',

  /* ── minimal pair ────────────────────────────────────────────────────── */
  pairPrompt: 'Which did you hear?',
  pairGroupLabel: 'Two near words',
  pairCorrect: 'Your ear caught it.',
  pairMiss: 'The other one. Listen for the beats.',
  pairWhyLength: 'Long vowel: one beat longer or shorter is a different word.',
  pairWhyVoicing: 'Voicing: the dakuten changes the consonant.',
  pairWhySmall: 'Small っ or ゃ: a stop or a glide changes the word.',
  pairWhyOther: 'One sound apart. Replay both and compare.',
  hearOption: 'Hear {kana}',
  compareLabel: 'Compare',
  skillNote: 'Perception practice: this one feeds your ear, not the schedule.',
} as const;

/** Tag chip labels for the mora diff (always paired with a glyph in CSS). */
export const TAG_LABEL: Record<ErrorTag, string> = {
  particle: 'particle',
  conjugation: 'conjugation',
  'vowel-length': 'vowel length',
  voicing: 'voicing',
  'small-kana': 'small kana',
  'kanji-reading': 'kanji reading',
  'kanji-meaning': 'kanji meaning',
  'word-choice': 'word choice',
  register: 'register',
  'word-order': 'word order',
  pitch: 'pitch',
  transcription: 'transcription',
  aizuchi: 'aizuchi',
  listening: 'listening',
};

/** Why-line for the minimal-pair contrast by the tag the pair exercises. */
export const PAIR_WHY: Partial<Record<ErrorTag, string>> = {
  'vowel-length': S.pairWhyLength,
  voicing: S.pairWhyVoicing,
  'small-kana': S.pairWhySmall,
  listening: S.pairWhyOther,
};
