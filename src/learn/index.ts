/**
 * TSUZUKU — the PURE learning core barrel (ARCHITECTURE §0, module plan).
 *
 * No store import, so B may use it without a cycle. The impure writer lives
 * in `./apply` and is imported directly as `@/learn/apply`, never from here.
 *
 * The scheduling half (fsrs, scheduler, item-belt, known, governors,
 * intro-policy, queue) is re-exported wholesale; the grading half is
 * re-exported by the names in the module plan.
 */
export * from './fsrs';
export * from './fsrs-golden';
export * from './scheduler';
export * from './item-belt';
export * from './known';
export * from './governors';
export * from './intro-policy';
export * from './queue';
// design 08 §4: the i+0 / i+1 pool selector the Ear Walk, Radio, planner and Station page share
export * from './pool';

export { toRating, isMature, isSlow, SCORE_BANDS, SHADOW_BANDS, MATURE_S } from './grading';
export { judgeRate, shouldJudge, judgeOptions, rubricJudge, perceptionJudge, rubricPasses, honestyRate } from './judge';
export { KIAI_RULES, kiaiInit, kiaiStep, comboTier, dueRecoveries } from './kiai';
export { isNemesis, nemesisPhase, duelProgress, defeat, nextDuelKey, wonToday } from './leech';
export { meaningChoices, kanaGrid, kanjiLookalikes, clozeTiles, scrambleTiles, PARTICLES, particleOptions, minimalPairPartner } from './distractors';
export { conjugate, applicableForms, isConjugable, acceptedSurfaces, applicableFormsFor, conjugateAll, DEFECTIVE, defectiveFormsFor, VERB_FORMS, ADJ_FORMS, isVerbPos, type Conjugation } from './conjugate';
