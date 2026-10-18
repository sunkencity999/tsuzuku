import { BELT_IDS, ERROR_TAGS } from '../content/types';
import { SAVE_SCHEMA, SLICE_KEYS, STAT_KEYS } from '../shared/store-types';
import {
  FRESH_BEST_CLEAN_TIER,
  INTENSITY_PRESETS,
  INTENSITY_SCALE,
  STANDARD_NEW_PER_DAY,
  beltForStation,
  effectiveNewPerDay,
  freshSave,
  freshStats,
  newPerDayFor,
  newPerDayTotal,
} from './defaults';

describe('INTENSITY_PRESETS (design 03 §4)', () => {
  it('equals the table', () => {
    expect(INTENSITY_PRESETS.casual).toEqual({ newPerDay: { vocab: 4, kanji: 0.6, grammar: 0.4 }, maxReviews: 80, retention: 0.85 });
    expect(INTENSITY_PRESETS.standard).toEqual({ newPerDay: { vocab: 7, kanji: 1, grammar: 0.75 }, maxReviews: 160, retention: 0.9 });
    expect(INTENSITY_PRESETS.intense).toEqual({ newPerDay: { vocab: 13, kanji: 1.8, grammar: 1.2 }, maxReviews: 300, retention: 0.9 });
  });

  it('N5 totals are 5 / 8.75 / 16 new items per day', () => {
    expect(newPerDayTotal(INTENSITY_PRESETS.casual.newPerDay)).toBeCloseTo(5);
    expect(newPerDayTotal(INTENSITY_PRESETS.standard.newPerDay)).toBeCloseTo(8.75);
    expect(newPerDayTotal(INTENSITY_PRESETS.intense.newPerDay)).toBeCloseTo(16);
  });
});

describe('newPerDayFor (design 02 §6.1)', () => {
  it('Standard N5 mix is 7 / 1 / 0.75', () => {
    expect(newPerDayFor('yellow', 'standard')).toEqual({ vocab: 7, kanji: 1, grammar: 0.75 });
    expect(newPerDayFor('orange', 'standard')).toEqual({ vocab: 7, kanji: 1, grammar: 0.75 });
  });

  it('Standard rates follow the belt table', () => {
    for (const belt of BELT_IDS) expect(newPerDayFor(belt, 'standard')).toEqual(STANDARD_NEW_PER_DAY[belt]);
    expect(newPerDayFor('green', 'standard')).toEqual({ vocab: 8, kanji: 2.5, grammar: 1 });
    expect(newPerDayFor('brown', 'standard')).toEqual({ vocab: 14, kanji: 3, grammar: 0.8 });
    expect(newPerDayFor('black', 'standard').kanji).toBe(0);
  });

  it('Casual and Intense scale the Standard rates by the N5 ratio', () => {
    expect(INTENSITY_SCALE.casual).toBeCloseTo(5 / 8.75);
    expect(INTENSITY_SCALE.intense).toBeCloseTo(16 / 8.75);
    const g = newPerDayFor('green', 'intense');
    expect(g.vocab).toBeCloseTo(8 * (16 / 8.75), 1);
    expect(newPerDayFor('green', 'casual').vocab).toBeCloseTo(8 * (5 / 8.75), 1);
  });

  it('custom returns the Standard belt rates (caller uses settings.newPerDay)', () => {
    expect(newPerDayFor('blue', 'custom')).toEqual(STANDARD_NEW_PER_DAY.blue);
  });

  it('effectiveNewPerDay follows the belt table for presets and the learner for custom (one rule for forecast / projection / Road)', () => {
    // The White mix frozen into settings at onboarding must not leak into later belts.
    const onboarded = { intensity: 'standard' as const, newPerDay: newPerDayFor('white', 'standard') };
    expect(effectiveNewPerDay(onboarded, 'white')).toEqual(STANDARD_NEW_PER_DAY.white);
    expect(effectiveNewPerDay(onboarded, 'green')).toEqual(STANDARD_NEW_PER_DAY.green);
    expect(effectiveNewPerDay({ ...onboarded, intensity: 'intense' }, 'green')).toEqual(newPerDayFor('green', 'intense'));
    const own = { vocab: 2, kanji: 0.5, grammar: 0.25 };
    expect(effectiveNewPerDay({ intensity: 'custom', newPerDay: own }, 'brown')).toBe(own);
  });

  it('beltForStation maps the road', () => {
    expect(beltForStation(0)).toBe('white');
    expect(beltForStation(3)).toBe('white');
    expect(beltForStation(4)).toBe('yellow');
    expect(beltForStation(15)).toBe('orange');
    expect(beltForStation(24)).toBe('green');
    expect(beltForStation(46)).toBe('brown');
    expect(beltForStation(53)).toBe('black');
  });
});

describe('freshSave', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  const s = freshSave(now, 'America/Los_Angeles');

  it('has the v1 schema, timestamps and zone', () => {
    expect(s.schema).toBe(SAVE_SCHEMA);
    expect(s.createdAt).toBe(now);
    expect(s.updatedAt).toBe(now);
    expect(s.profile.startedAt).toBe(now);
    expect(s.profile.tz).toBe('America/Los_Angeles');
    expect(s.contentVersion).toBe('');
  });

  it('seed is 16 hex chars and differs between saves', () => {
    expect(s.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(freshSave(now, 'UTC').seed).not.toBe(s.seed);
  });

  it('carries every slice, every stat key at 0 (bestCleanTier at 1) and every error tag', () => {
    for (const k of SLICE_KEYS) expect(s).toHaveProperty(k);
    for (const k of STAT_KEYS) expect(s.stats[k]).toBe(k === 'bestCleanTier' ? FRESH_BEST_CLEAN_TIER : 0);
    for (const t of ERROR_TAGS) expect(s.weakPoints[t]).toEqual({ n: 0, ewma: 0, active: false, peak: 0 });
  });

  it('listening defaults (design 08 §11–§13): the voice pack, data saver off, nothing heard or taught, counters at 0, bestCleanTier 1', () => {
    expect(s.settings.audioSource).toBe('pack');
    expect(s.settings.dataSaver).toBe(false);
    expect(s.progress.listened).toEqual([]);
    expect(s.progress.teachSeen).toEqual([]);
    expect(s.stats.radioMinutes).toBe(0);
    expect(s.stats.coldSets).toBe(0);
    expect(s.stats.coldSetsPassed).toBe(0);
    expect(s.stats.listeningAuthenticMinutes).toBe(0);
    expect(FRESH_BEST_CLEAN_TIER).toBe(1);
    expect(s.stats.bestCleanTier).toBe(FRESH_BEST_CLEAN_TIER);
    expect(freshStats().bestCleanTier).toBe(FRESH_BEST_CLEAN_TIER);
  });

  it('starts the learner as 無名 at White, Lv 1, speaking self, Dojo feel with speed grading on', () => {
    expect(s.profile.name).toBe('無名');
    expect(s.profile.belt).toBe('white');
    expect(s.profile.level).toBe(1);
    expect(s.profile.xp).toBe(0);
    expect(s.profile.kanaKnown).toEqual([]);
    expect(s.settings.speaking).toBe('self');
    expect(s.settings.feel).toBe('dojo');
    expect(s.settings.speedGrading).toBe(true);
    expect(s.settings.intensity).toBe('standard');
    expect(s.settings.maxReviews).toBe(160);
    expect(s.settings.retention).toBe(0.9);
    expect(s.settings.newPerDay).toEqual(STANDARD_NEW_PER_DAY.white);
  });

  it('uses 0 as the never sentinel for streak.lastDay and quests.day', () => {
    expect(s.streak.lastDay).toBe(0);
    expect(s.quests.day).toBe(0);
    expect(s.streak.totalDays).toBe(0);
  });
});
