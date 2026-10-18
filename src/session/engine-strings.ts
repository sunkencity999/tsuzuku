/**
 * TSUZUKU — session-engine copy (Sensei voice, design 01 §3).
 *
 * Every user-visible string produced by the pure session engines
 * (blocks, builder, runner, end-card, gatekeeper, shinsa, kage, nemesis,
 * dojo-feed, dan) lives here. Values are plain strings; `{key}` placeholders
 * are filled by `fill()`. No countdown words, no exclamation guilt.
 */
import type { Belt } from '../content/types';
import type { ShinsaSection } from '../shared/catalog';
import type { BlockKind } from '../shared/session-types';

export const S = {
  // Block labels
  blockWarmup: 'Warm-up',
  blockReviews: 'Reviews',
  blockScroll: 'Scroll',
  blockSparring: 'Sparring',
  blockInput: 'Input',
  blockOutput: 'Output',
  blockWeak: 'Weak Point',
  blockMichikusa: 'Michikusa',
  blockCooldown: 'Cooldown',
  blockPhase: 'Phase',
  blockKage: 'Kage Ghost Set',
  blockWelcome: 'Welcome Back',
  blockNotes: "Sensei's Notes",
  blockNemesis: 'Nemesis',
  blockGrudge: '遺恨帳 Grudge List',
  blockGauntlet: 'Dōjō Yaburi',
  blockRapid: 'Rapid Fire',
  blockGojuon: 'Gojūon Fighter',
  blockPretest: 'Chikaradameshi',

  // Gatekeeper phases (design 04 §11)
  phaseFlash: '閃 Flash',
  phaseStrike: '打 Strike',
  phaseEar: '耳 Ear',
  phaseFinalForm: '型 Final Form',
  phaseAssistedForm: '型 Form (assisted)',

  // Forecast line (design 03 §3)
  forecastReview: '{n} review',
  forecastReviews: '{n} reviews',
  forecastScroll: '{n} scroll',
  forecastScrolls: '{n} scrolls',
  forecastEpisode: '{n} episode',
  forecastEpisodes: '{n} episodes',
  forecastMinutes: '~{n} min',
  forecastJoin: ' · ',
  forecastRest: 'Nothing due. The dojo is open all the same.',

  // Governor copy (design 03 §5)
  backlogLine: 'The gatekeeper holds the line. {shown} of your {due} reviews today; the rest wait without penalty.',
  crammingLine: 'Enough new words for today. The dojo will be here tomorrow.',
  overtrainingLine: 'Spaced beats massed. Tomorrow counts more than more today.',
  feelNudgeLine: 'Two Arcade sessions ran hot. The Dojo feel is one tap away in Settings.',
  backlogWaiting: '{n} waited today without penalty.',

  // End card (design 03 §10)
  ledgerPrompt: 'Outside input today? +20 min anime / podcast / reading / conversation.',
  closingLine: 'Good training. Rest.',
  anotherKata: 'Another Kata?',
  restButton: 'Rest.',
  welcomeBackPreviewOnly: 'Day one back. Only the preview today; the tally returns tomorrow.',

  // 次回予告 milestones
  milestoneGateReady: 'The {gate} is ready when you are.',
  milestoneGateSoon: 'The {gate} awaits tomorrow, more or less.',
  milestoneGateIn: 'The {gate} awaits in about {n} days.',
  milestoneShinsa: 'The {belt} belt exam waits at {station}.',
  milestoneShinsaReady: 'The {belt} belt exam is open.',
  milestoneKageMonday: 'The Kage runs again on Monday.',
  milestoneKageNow: 'The Kage is waiting this week.',
  milestoneDan: 'The road continues past Kyoto.',
  milestoneQuiet: 'One station at a time. The road is long and that is fine.',
  maskToken: '???',

  // Welcome states (design 03 §8)
  welcomeMountain: 'The dojo kept your place.',
  welcomeComeback: 'Welcome back. Twenty items you still know, to start.',
  resumeLine: 'Resume ({n} reps left)',
  startFresh: 'Start fresh',

  // Kage (design 03 §11) — respectful, no taunts
  kageIntro: 'Your shadow runs the same set. Same words, last week’s hands.',
  kageFirstRun: 'First run. From here, the shadow is you.',
  kageBeat: 'You outran your shadow this week.',
  kageHeld: 'The shadow kept pace. Next Monday it runs again.',
  kageNotEnough: 'Not enough items yet. The shadow waits until there is something to race.',
  kageDone: 'This week’s Ghost Set is run. The shadow rests until Monday.',
  kageFactoryLabel: 'Factory defaults',
  kageYou: 'YOU',

  // Omikuji cut: a deterministic proverb line, no modifiers (design 05 §13)
  omikujiLabel: 'Today’s proverb',

  // Nemesis (design 04 §9)
  nemesisDossier: 'A Nemesis. Study the dossier; the duel comes later.',
  nemesisContext: 'In context only for now. Meet it in stories and cloze.',
  nemesisDuel: 'Duel day. One clean win counts today.',
  nemesisDefeated: 'Nemesis defeated.',
  nemesisCallout: '{n} Nemesis duel ready',
  nemesisCallouts: '{n} Nemesis duels ready',

  // Gatekeeper results and rematch
  gateNotYet: 'Not yet. The gate will still be here.',
  gatePassed: 'The {gate} steps aside.',
  gatePerfect: 'A clean pass. The {gate} bows.',
  gateAssisted: 'Provisional pass. The stamp waits for a Revenge Match.',
  gateRevenge: 'Revenge Match won. The stamp is whole.',
  rematchGrudge: 'Train {n} more Grudge reps today, then the gate opens again.',
  rematchOpen: 'The gate is open for another attempt.',
  rematchAssisted: 'The Assisted Gate is open: no timers, threshold 80 percent, provisional stamp.',
  gateFinalFormPrompt: 'Write one sentence using {pattern} ({meaning}).',

  // Shinsa (design 04 §12)
  shinsaReasonGates: 'Pass every Gatekeeper of the {belt} belt first.',
  shinsaReasonGreen: 'Bring {pct} percent of the belt to Green; {now} percent now.',
  shinsaReasonBrown: 'Bring {pct} percent of the belt to Brown; {now} percent now.',
  shinsaReasonNotes: 'Train one Sensei’s Notes session first.',
  shinsaReasonPassed: 'Already passed.',
  shinsaReasonContent: 'The belt’s stations are not loaded yet.',
  shinsaReasonWhite: 'The White belt has no exam; the Port Keeper is the test.',
  shinsaPassed: 'Passed. The ceremony follows.',
  shinsaNotYet: 'Not yet. The gate will still be here.',
  shinsaSpeakingTyped: 'Speaking: untested (typed path)',
  shinsaMonologuePrompt: 'Two minutes. Tell the examiner about your road so far.',
  shinsaWritingPrompt: 'Write {n} sentences about a day in {station}. Use the patterns named.',

  // Scroll flow (design 05 §3)
  pretestLine: 'Miss these; that’s the point.',
  movingOn: 'Moving on. This one returns tomorrow.',
  kanjiUnlocksIn: 'Components first. This kanji unlocks in {n} days.',
  kanjiNeedsComponents: 'Components first. This kanji waits for its parts.',
  noticingLine: 'Now see them in the road.',

  // Output prompts
  monologuePrompt: 'Sixty seconds. Tell the room about {topic}.',
  monologuePromptLong: 'Two minutes. Tell the room about {topic}.',
  reduceExpandPrompt: 'Retell the passage you just read in {n} seconds.',
  threeWaysPrompt: 'Say it three ways: casual, polite, keigo. {en}',
  writingPrompt: 'Write {n} sentences about {topic}. Use the patterns named.',
  transformPrompt: 'Say the same thing with {pattern}: {en}',
  formForgePrompt: '{word}: {form}',
  judgmentPrompt: 'Natural or not?',
  kanjiReadPrompt: 'Reading of the highlighted word',

  // Dan road (design 02 §3)
  danNidan: '敬語の段 Keigo mastery',
  danSandan: '自然体の段 Natural speech',
  danYondan: '独白と影の段 Monologue and shadowing',
  danGodan: '文の段 Literary and domain',
  danRokudan: '維持の段 Maintenance',
  danJudan: '続く者 The One Who Continues',
  danCritThreeWays: 'Say It Three Ways register accuracy ≥ {pct} percent over the last {n}',
  danCritRolePlays: '{n} role-plays with ≥ {pct} percent best lines',
  danCritLedger: 'Ledger hours ≥ {n}',
  danCritAizuchi: 'Aizuchi hit rate ≥ {pct} percent over {n} role-plays',
  danCritEpisodes: '{n} episodes read at ≥ 2/3',
  danCritMonologues: '{n} monologues',
  danCritMonologueWords: 'A monologue of ≥ {n} words',
  danCritFastListening: '{n} Listening Arena passes at 1.25×',
  danCritShadowLines: '{n} shadow lines',
  danCritCpm: 'Reading ≥ {n} cpm',
  danCritVocabBrown: '{n} words at Brown',
  danCritDays: '{n} training days',
  danCritKageWins: '{n} Kage wins',
  danPromoted: 'Promoted to {dan}. The road continues.',

  // Monologue topics (seeded)
  topics: ['your morning', 'the last station', 'a meal you remember', 'the weather today', 'a place you want to see', 'what you did yesterday', 'a friend', 'your work', 'a word you like', 'the road so far'],

  // Omikuji proverbs (seeded, deterministic, no XP effect)
  /** Proverbs in ruby markup (`{base|reading}`, content/ruby.ts) so a zero-Japanese learner can read them; the gloss rides beside (design 09 §12.1 d36). */
  omikuji: [
    { ja: '{継続|けいぞく}は{力|ちから}なり', en: 'Continuation is strength.' },
    { ja: '{七転|ななころ}び{八起|やお}き', en: 'Fall seven times, rise eight.' },
    { ja: '{塵|ちり}も{積|つ}もれば{山|やま}となる', en: 'Dust, piled up, becomes a mountain.' },
    { ja: '{千里|せんり}の{道|みち}も{一歩|いっぽ}から', en: 'A thousand-ri road begins with one step.' },
    { ja: '{石|いし}の{上|うえ}にも{三年|さんねん}', en: 'Three years on a cold stone, and it warms.' },
    { ja: '{雨降|あめふ}って{地固|じかた}まる', en: 'After the rain, the ground hardens.' },
    { ja: '{初心|しょしん}{忘|わす}るべからず', en: 'Keep the beginner’s heart.' },
    { ja: '{猿|さる}も{木|き}から{落|お}ちる', en: 'Even monkeys fall from trees.' },
    { ja: '{明日|あした}は{明日|あした}の{風|かぜ}が{吹|ふ}く', en: 'Tomorrow’s wind blows tomorrow.' },
    { ja: '{習|なら}うより{慣|な}れろ', en: 'Practice over study; let the hands remember.' },
  ],
} as const;

export const BLOCK_LABEL: Record<BlockKind, string> = {
  warmup: S.blockWarmup,
  reviews: S.blockReviews,
  scroll: S.blockScroll,
  sparring: S.blockSparring,
  input: S.blockInput,
  output: S.blockOutput,
  weak: S.blockWeak,
  michikusa: S.blockMichikusa,
  cooldown: S.blockCooldown,
  phase: S.blockPhase,
};

export const SHINSA_LABEL: Record<ShinsaSection, string> = {
  ear: '耳 Listening',
  read: '読 Reading',
  form: '形 Form',
  mouth: '口 Speaking',
  write: '書 Writing',
};

export const BELT_NAME: Record<Belt, string> = {
  white: 'White',
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  black: 'Black',
};

export const DAN_NAME: Record<number, string> = {
  1: '初段 Shodan',
  2: '二段 Nidan',
  3: '三段 Sandan',
  4: '四段 Yondan',
  5: '五段 Godan',
  6: '六段 Rokudan',
  7: '七段 Nanadan',
  8: '八段 Hachidan',
  9: '九段 Kudan',
  10: '十段 Jūdan',
};

/** Fills `{key}` placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** `1 review` / `3 reviews`. */
export function plural(n: number, one: string, many: string): string {
  return fill(n === 1 ? one : many, { n });
}
