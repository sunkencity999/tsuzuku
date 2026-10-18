/**
 * TSUZUKU — session contracts (ARCHITECTURE §5, verbatim).
 *
 * `AttemptResult` is declared here and re-exported by `exercise-types.ts`.
 * Depends only on `content/types` and `store-types` (type-only; no cycles).
 */
import type { CardKey, ConjForm, ConjugablePos, DrillId, ErrorTag, RegisterTag } from '../content/types';
import type { EpochDay, ItemBelt, Rating } from './store-types';

export const SESSION_MODES = [
  'kata',
  'kumite',
  'shugyo',
  'kage',
  'weak',
  'rapid',
  'gojuon',
  'gate',
  'shinsa',
  'scroll',
  'welcome',
  'dan',
] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const BLOCK_KINDS = [
  'warmup',
  'reviews',
  'scroll',
  'sparring',
  'input',
  'output',
  'weak',
  'michikusa',
  'cooldown',
  'phase',
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * Sentence contract (builder → exercises): `sentence` carries RUBY MARKUP
 * (`{漢字|かんじ}`) for every sentence drill; render it with `<Ruby>` and
 * derive the plain surface with `toPlain(sentence)`. `blank` / `blanks` are
 * `[start, end)` offsets into `toPlain(sentence)`, and `answer` / `accept`
 * hold plain surfaces (no markup). Exception: production-forge keeps a plain
 * `sentence` (the kanji candidates are the exercise's own ruby).
 */
export type StepParams = Partial<{
  choices: string[];
  /** Plain surface (sentence drills) or kana (kana items). */
  answer: string;
  /** Accepted plain surfaces besides `answer`. */
  accept: string[];
  /** Per-form answers (form-chain). */
  answers: string[];
  /** Kanji candidates Space cycles (production-forge). */
  candidates: string[];
  targetForm: ConjForm;
  forms: ConjForm[];
  /** Part of speech of the head word (form-chain / form-forge), so the drill need not infer the verb group from `answers`. */
  pos: ConjugablePos;
  /** Per-form accepted surfaces parallel to `forms` (`[answer, answerKana, ...alt]` each); `answers[i]` stays the canonical one. */
  accepts: string[][];
  /** Ruby markup (plain for production-forge); see the type comment. */
  sentence: string;
  /** Reading of the picked item (e.g. the verb's kana for grammar prod cards). */
  kana: string;
  /** `[start, end)` into `toPlain(sentence)`. */
  blank: [number, number];
  /** 1–3 particle slots (particle-duel), offsets into `toPlain(sentence)`. */
  blanks: [number, number][];
  tiles: string[];
  /** Component-assembly frame. */
  layout: 'lr' | 'tb' | 'enc';
  storyId: string;
  lineIndex: number;
  rate: number;
  distractorIds: string[];
  promptEn: string;
  seconds: number;
  tag: ErrorTag;
  pool: CardKey[];
  phase: 1 | 2 | 3 | 4;
  michikusaId: string;
  scrollId: string;
  registerTarget: RegisterTag;
  mode: 'choose' | 'build' | 'type' | 'speak' | 'reduce-expand';
  kanaOnlyPolicy: 'good' | 'hard';
  /** Required grammar (writing-dojo). */
  patternIds: string[];
  missionId: string;
  /** Untimed re-test of an arcade miss. */
  recheck: boolean;
  /**
   * Clip key the step's audio plays through the voice pack (design 08 §8):
   * `${itemId}#ex${k}` for an example sentence, `${storyId}#L${i}` for a
   * line, `${itemId}` for a bare word. Set by the planner for sentence-listen,
   * shadow and pattern-cloze examples; drills pass it as `SpeakOptions.clip`.
   */
  clip: string;
  /**
   * Pool refs of an Ear Walk (design 08 §10.4): `listening-set` in pool mode
   * hears these i+0 / i+1 sentences (`v-n5-0249#ex0`, `g-n5-024#ex1`,
   * `s-07-2#L3`) instead of a text; the set emits `listening:set` with
   * `storyId: null`, `refs`, `mode: 'walk'`.
   */
  refs: string[];
  /** Clause of a long line to dictate, `[fromMora, toMora)` over the cue's `clauses` (design 08 §9: lines over `DICTATION_MAX_MORAE`). */
  clause: [number, number];
}>;

export type StepTag = 'intro' | '+3' | '+10' | 'recovery' | 'relearn';

export interface Step {
  id: string;
  block: BlockKind;
  exercise: DrillId;
  itemId: string | null;
  cardKey: CardKey | null;
  params: StepParams;
  timed: boolean;
  timerMs?: number;
  isNew: boolean;
  stepTag: StepTag | null;
  exposures: number;
  estMs: number;
}

export interface SessionBlock {
  kind: BlockKind;
  label: string;
  estMinutes: number;
  stepIds: string[];
}

export interface SessionPlan {
  id: string;
  mode: SessionMode;
  day: EpochDay;
  createdAt: number;
  station: number;
  steps: Step[];
  blocks: SessionBlock[];
  meta: {
    dueTotal: number;
    dueTaken: number;
    backlog: boolean;
    newCount: number;
    scrollIds: string[];
    storyId?: string;
    michikusaId?: string;
  };
}

/** What every exercise emits (design 04 §0). */
export interface AttemptResult {
  correct: boolean;
  nearMiss: boolean;
  hintUsed: boolean;
  /** Shift+Enter "don't know". */
  guard: boolean;
  timedOut: boolean;
  ms: number;
  errorTags: ErrorTag[];
  answer?: string;
  /** Self-graded exercises: Again / Hard / Good. */
  selfRating?: 1 | 2 | 3;
  /** 0..1 (dictation, shadow). */
  score?: number;
  replays?: number;
  /** Implicit evidence on other cards (dictation/shadow content words). */
  implicit?: { cardKey: CardKey; rating: Rating }[];
}

export interface StepResult extends AttemptResult {
  stepId: string;
  cardKey: CardKey | null;
  rating: Rating | null;
  ki: number;
  combo: number;
  ippon: boolean;
  kiai: boolean;
  xpDelta: number;
  promotion?: ItemBelt;
}

export interface Tally {
  reps: number;
  correct: number;
  accuracy: number;
  bestCombo: number;
  ippon: number;
  xp: number;
  minutes: number;
  promotions: { itemId: string; to: ItemBelt }[];
  questsDone: string[];
  backlogWaiting: number;
}

export interface SessionResult {
  planId: string;
  mode: SessionMode;
  startedAt: number;
  endedAt: number;
  steps: StepResult[];
  tally: Tally;
  zen: boolean;
  resumed: boolean;
}

export interface KiaiState {
  ki: number;
  combo: number;
  bestCombo: number;
  /** Reps left in Kiai state (XP × 1.5). */
  kiaiLeft: number;
  ippon: number;
  recoveryQueue: { cardKey: CardKey; at: number }[];
}

export const SESSION_SCHEMA = 'tsuzuku.session/1' as const;

export interface SessionSnapshot {
  schema: typeof SESSION_SCHEMA;
  plan: SessionPlan;
  cursor: number;
  results: StepResult[];
  kiai: KiaiState;
  /** Active milliseconds accumulated before this segment (resume credit); older snapshots load as 0. */
  activeMs?: number;
}

/** 次回予告 — three informational lines on the つづく card (design 03 §10). */
export interface JikaiYokoku {
  /** One sentence from the next episode with one token masked as ???. */
  sentence?: { storyId: string; ja: string; kana: string; maskedToken: number };
  /** Three words you will meet tomorrow, kana only. */
  words: { itemId: string; kana: string }[];
  /** "The Gatekeeper of Totsuka awaits in about 4 days." */
  milestone: string;
}

/** What the Dojo home shows (design 03 §3). */
export interface DojoFeed {
  forecastLine: string;
  minutes: { kata: number; kumite: number; shugyo: number };
  sentenceOfDay?: { ja: string; kana: string };
  nextMilestone: string;
  welcome: 'none' | 'mountain' | 'comeback';
  resume?: { stepsLeft: number };
}
