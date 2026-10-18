/**
 * TSUZUKU — copy for the vocabulary drills (design 04 §2, Sensei voice 01 §3).
 *
 * Shared drill copy (prompts, controls, feedback lines, pitch labels) lives in
 * `src/exercises/strings.ts`; this file holds what only Meaning Guard, Meaning
 * Recall, Meaning Judge, Audio Flash, Production Forge and Pitch Ear say.
 * Templates use `{name}` placeholders filled with `fill()`.
 */
export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── shared by the vocab drills ──────────────────────────────────────── */
  wordLabel: 'Word',
  readingLabel: 'Reading',
  meaningLabel: 'Meaning',
  listen: 'Listen',
  replayHint: 'Space replays',
  alsoMeans: 'Also',
  skipMissing: 'Continue without this one',

  /* ── Meaning Recall / J-J reveal ─────────────────────────────────────── */
  jjLabel: 'In Japanese',
  hideEnglish: 'Hide English',
  noDefinition: 'No Japanese definition for this word yet; the English stands in.',

  /* ── Meaning Judge ───────────────────────────────────────────────────── */
  revealHint: 'Enter reveals',
  rateHint: '1 Again · 2 Hard · 3 Good',
  rateLabel: 'Rate yourself',
  judgeWaiting: 'The inspector is checking this one.',
  judgePassed: 'The inspector agrees.',
  judgeFailed: 'The inspector saw it differently. Again on this one.',
  ratedAgain: 'Again. It comes back soon.',
  ratedHard: 'Hard. Noted.',
  ratedGood: 'Good.',

  /* ── Audio Flash ─────────────────────────────────────────────────────── */
  listenFirst: 'Listen. The word appears after you answer.',
  noVoice: 'No Japanese voice is available. The word is shown instead.',
  heardIn: 'Heard in',
  typeWhatItMeans: 'Type what it means.',

  /* ── Production Forge ────────────────────────────────────────────────── */
  contextLabel: 'Context',
  glossLabel: 'In English',
  blankSr: 'blank',
  firstKana: 'Show the first kana',
  firstKanaShown: 'Starts with {kana}. The best this rep can earn is Hard.',
  kanaOnlyNote: 'Kana counts as right until the kanji is Green.',
  kanaOnlyHardNote: 'From Green, writing the kanji counts.',

  /* ── Pitch Ear ───────────────────────────────────────────────────────── */
  pitchChoicesLabel: 'Pitch contours',
  pitchContrast: 'Same sound, different pitch',
  /** Device-voice path (design 08 §8): the synth only approximates the dataset's pattern. */
  pitchDatasetNote: 'The pattern comes from the pitch dataset; the device voice only approximates it.',
  /** Pack path: the clip was verified against the dictionary pitch (design 08 §7). */
  pitchClipNote: 'Synthetic voice (VOICEVOX): the clip follows the dictionary pitch pattern.',
  pitchGaNoteFlat: 'Now with が (ga) after it: a flat word stays high on が — nothing drops anywhere.',
  pitchGaNoteTail: 'Now with が (ga) after it: a tail-high word drops right onto が — only the particle shows it.',
  pitchGaNoteInside: 'Now with が (ga) after it: the drop already happened inside the word, so が stays low.',
  pitchCompareLabel: 'Hear both',
  hearWord: 'Hear {word}',
  pitchHeard: 'You chose',
} as const;
