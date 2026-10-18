/**
 * TSUZUKU — store barrel (group B, ARCHITECTURE §0/§1).
 *
 * Everything other groups may touch of B EXCEPT the derived read-model
 * (`src/store/derived.ts`, which imports `@/learn`). This barrel must never
 * (transitively) import `src/learn`.
 */
export { store, storeCards, initStore, resetStoreForTests, resetSave, registerReducer, currentSlot, shardOfKey, shardSizes, replaceHeader, replaceLog } from './store';
export type { InitOptions, ReducerStarter, DueOptions, SetHint, StoreCardsApi, SaveHeader } from './store';
export { isDueReview } from './due';
export {
  freshSave,
  INTENSITY_PRESETS,
  STANDARD_NEW_PER_DAY,
  INTENSITY_SCALE,
  KANA_PER_DAY,
  newPerDayFor,
  effectiveNewPerDay,
  newPerDayTotal,
  beltForStation,
} from './defaults';
export { CURRENT, MigrationError, migrateMeta, migrateMetaChecked, migrateShard, migrateLog, applyRedirects } from './migrations';
export {
  META_KEY,
  CARDS_KEY,
  LOG_KEY,
  SESSION_KEY,
  SHARD_SPECS,
  WARN_BYTES,
  CEILING_BYTES,
  LOG_RING,
  utf16Bytes,
  shardKey,
  shardIdFor,
} from './persist';
export type { ShardId, ShardSpec } from './persist';
export type * from '../shared/store-types';
export { NAME_MAX_GLYPHS } from '../shared/store-types';

export { exportSave, previewImport, previewImportBlob, applyImport, mergeSaves, hasNoLearnerTrace, buildBackup, BACKUP_SCHEMA, IMPORT_MAX_BYTES } from './backup';
export type { ImportPreview, ImportSummary, ImportData, BackupDocument } from './backup';
export { XP_TABLE, COMBO_XP, MAX_LEVEL, levelFor, xpToNext, xpAtLevel, xpFor, repXp, comboXp } from './xp';
export { QUESTS, QUEST_COUNT, NEEDS_FACET, pickQuests, pickDailyQuests, questProgress, questCounts, questDef, isFullDay, eligibleQuests, storeHasFacet, setQuestGates, questClosed, revalidateQuests } from './quests';
export type { QuestRule, QuestProgress, PickOptions } from './quests';
export { STAT_KEYS, updateMedian, honesty, HONESTY_WINDOW } from './stats';
export {
  addLedgerEntry,
  logMission,
  ledgerHours,
  ledgerHoursBy,
  ledgerByWeek,
  weekProgress,
  weeklyTargetHours,
  externalListeningHours,
  LEDGER_GOAL_HOURS,
  WEEKLY_TARGET_HOURS,
  KIND_INDEX,
  playedMinutes,
  sanitizeMinutes,
  wholeMinutes,
  appListeningHours,
  weekAppMinutes,
} from './ledger';
export type { LedgerInput, LedgerHours, WeekRow } from './ledger';
export { flameState, onDayRolled, onTrainingDay, startVacation, endVacation, FREEZE_MAX, REPAIR_NEEDED } from './streak';
export type { FlameState, RepairWindow } from './streak';
export { rollIfNeeded, awayStatus, AWAY_SPREAD_MIN, WELCOME_BACK_AWAY } from './day';
export type { AwayStatus } from './day';
export { TAG_EXERCISES, updateWeakPoints, activeTags, topWeakPoints, conqueredTags, tagsForExercise, WEAK_ACTIVATE, WEAK_CLEAR, WEAK_MIN_N } from './weak-points';
export type { WeakPointRow } from './weak-points';
export { S as STORE_STRINGS, LEDGER_KIND_LABEL } from './strings';
export { BADGE_DEFS, BADGE_CATEGORIES } from './badge-defs';
export type { BadgeDef, BadgeCategory, BadgeField, CardReader } from './badge-defs';
export { WALLPAPER_DEFS, WALLPAPER_BY_ID, isUnlocked, revealQuadrant, darumaCopy } from './wallpaper-defs';
export type { WallpaperDef, Quadrant } from './wallpaper-defs';
