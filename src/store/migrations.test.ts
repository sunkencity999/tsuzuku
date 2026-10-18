import { CARDS_SCHEMA, LOG_SCHEMA, NAME_MAX_GLYPHS, type CardShard, type CardTuple, type LogEntry } from '../shared/store-types';
import { freshSave, freshWeakPoints } from './defaults';
import {
  CURRENT,
  LISTENED_MAX,
  MigrationError,
  TEACH_SEEN_MAX,
  applyRedirects,
  migrateLog,
  migrateMeta,
  migrateMetaChecked,
  migrateShard,
  redirectKey,
  resolveRedirect,
} from './migrations';

const NOW = Date.UTC(2026, 0, 1);

describe('CURRENT', () => {
  it('is version 1 for every document', () => {
    expect(CURRENT).toEqual({ meta: 1, cards: 1, log: 1 });
  });
});

describe('migrateMeta', () => {
  it('passes a complete v1 save through unchanged', () => {
    const s = freshSave(NOW, 'UTC');
    s.profile.name = 'テスト';
    s.stats.reviews = 42;
    const out = migrateMeta(JSON.parse(JSON.stringify(s)));
    expect(out).toEqual(s);
  });

  it('is idempotent', () => {
    const s = freshSave(NOW, 'UTC');
    const once = migrateMeta(s);
    expect(migrateMeta(once)).toEqual(once);
  });

  it('migrates a v0 document (no schema) to v1 and fills defaults', () => {
    const v0 = { profile: { name: 'Old', tz: 'Asia/Tokyo' }, settings: { intensity: 'casual' } };
    const out = migrateMeta(v0);
    expect(out.schema).toBe('tsuzuku.save/1');
    expect(out.profile.name).toBe('Old');
    expect(out.profile.tz).toBe('Asia/Tokyo');
    expect(out.profile.kanaKnown).toEqual([]);
    expect(out.settings.intensity).toBe('casual');
    expect(out.settings.speedGrading).toBe(true);
    expect(out.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(out.stats.reviews).toBe(0);
    expect(out.daily).toEqual({});
  });

  it('fills additive fields a newer build added to a slice', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    delete s.stats.rapidBest;
    delete s.settings.verticalText;
    delete s.weakPoints.aizuchi;
    delete s.progress.gateAttemptAt;
    const out = migrateMeta(s);
    expect(out.stats.rapidBest).toBe(0);
    expect(out.progress.gateAttemptAt).toEqual({});
    expect(out.settings.verticalText).toBe(false);
    expect(out.weakPoints.aizuchi).toEqual({ n: 0, ewma: 0, active: false, peak: 0 });
  });

  it('a save from before design 08 fills the listening fields and seeds bestCleanTier from its speed tier, with no repair reported', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    s.settings.speedTier = 4;
    delete s.settings.audioSource;
    delete s.settings.dataSaver;
    delete s.progress.listened;
    delete s.progress.teachSeen;
    for (const k of ['radioMinutes', 'coldSets', 'coldSetsPassed', 'listeningAuthenticMinutes', 'bestCleanTier']) delete s.stats[k];
    const { meta, coerced } = migrateMetaChecked(s);
    expect(meta.settings.audioSource).toBe('pack');
    expect(meta.settings.dataSaver).toBe(false);
    expect(meta.progress.listened).toEqual([]);
    expect(meta.progress.teachSeen).toEqual([]);
    expect(meta.stats.radioMinutes).toBe(0);
    expect(meta.stats.coldSets).toBe(0);
    expect(meta.stats.coldSetsPassed).toBe(0);
    expect(meta.stats.listeningAuthenticMinutes).toBe(0);
    // grandfathered: the radar keeps the tier the learner had chosen (design 08 §12)
    expect(meta.stats.bestCleanTier).toBe(4);
    expect(coerced).toEqual([]);
    // idempotent: once seeded, the counter is the save's own and is never re-seeded
    const again = migrateMetaChecked({ ...meta, settings: { ...meta.settings, speedTier: 2 } });
    expect(again.meta.stats.bestCleanTier).toBe(4);
    expect(again.coerced).toEqual([]);
    // a v0 document without stats is an existing save too: seeded from its (validated) speed tier
    expect(migrateMeta({ profile: { tz: 'UTC' }, settings: { speedTier: 3 } }).stats.bestCleanTier).toBe(3);
    expect(migrateMeta({ profile: { tz: 'UTC' }, settings: { speedTier: 9 } }).stats.bestCleanTier).toBe(freshSave(0, 'UTC').settings.speedTier);
    // a NEW save keeps bestCleanTier 1 (freshStats), the pass-through case
    expect(migrateMeta(freshSave(NOW, 'UTC')).stats.bestCleanTier).toBe(1);
  });

  it('repairs settings.audioSource outside its union to pack and a non-boolean dataSaver to false, reporting both', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    s.settings.audioSource = 'cassette';
    s.settings.dataSaver = 'yes';
    const { meta, coerced } = migrateMetaChecked(s);
    expect(meta.settings.audioSource).toBe('pack');
    expect(meta.settings.dataSaver).toBe(false);
    expect(coerced.sort()).toEqual(['settings.audioSource', 'settings.dataSaver']);
    const ok = freshSave(NOW, 'UTC');
    ok.settings = { ...ok.settings, audioSource: 'device', dataSaver: true };
    expect(migrateMetaChecked(ok)).toEqual({ meta: ok, coerced: [] });
  });

  it('progress.listened / teachSeen keep id-like strings only (prose, capitals, non-strings and oversize dropped, never cut) and are capped at the newest entries', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    // text ids are lowercase (`s-08-1`, `m-10-2`); a line clip key's `#L3` is uppercase and never a heard text, so it is dropped too
    s.progress.listened = ['s-07-2', 'Hello there', 'S-07-3', 42, null, 'x'.repeat(65), 's-08-1#L3', 's-08-1', 'm-10-2'];
    s.progress.teachSeen = ['morae-beats', { id: 'x' }, 'pitch:雨', 'arena-first'];
    const { meta, coerced } = migrateMetaChecked(s);
    expect(meta.progress.listened).toEqual(['s-07-2', 's-08-1', 'm-10-2']);
    expect(meta.progress.teachSeen).toEqual(['morae-beats', 'arena-first']);
    expect(coerced).toEqual(expect.arrayContaining(['progress.listened', 'progress.teachSeen']));
    expect(migrateMetaChecked(meta).coerced).toEqual([]);
    const big = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    big.progress.listened = Array.from({ length: LISTENED_MAX + 10 }, (_, i) => `s-${String((i % 53) + 1).padStart(2, '0')}-${(i % 9) + 1}:${i}`);
    big.progress.teachSeen = Array.from({ length: TEACH_SEEN_MAX + 3 }, (_, i) => `card-${i}`);
    const capped = migrateMetaChecked(big);
    expect(capped.meta.progress.listened).toHaveLength(LISTENED_MAX);
    expect(capped.meta.progress.listened?.[LISTENED_MAX - 1]).toBe((big.progress.listened as string[])[LISTENED_MAX + 9]);
    expect(capped.meta.progress.teachSeen).toHaveLength(TEACH_SEEN_MAX);
    expect(capped.meta.progress.teachSeen?.[0]).toBe('card-3');
    expect(capped.coerced).toEqual(expect.arrayContaining(['progress.listened', 'progress.teachSeen']));
    expect(migrateMetaChecked(capped.meta).coerced).toEqual([]);
  });

  it('repairs fields of the wrong type to the fresh-save default and reports the paths', () => {
    const tag = Object.keys(freshWeakPoints())[0];
    const raw = JSON.parse(
      '{"schema":"tsuzuku.save/1","profile":{"name":null,"xp":1e999,"level":"abc","belt":"rainbow","goals":"notarray","tz":"UTC"},' +
        '"settings":{"newPerDay":null,"restDay":"mon"},"streak":{"current":"7","longest":{}},"progress":{"station":"7","stationsCleared":[1,null,2]},' +
        `"bookmarks":[null,"b"],"stats":{"reviews":"x"},"weakPoints":{"${tag}":{"n":"3","ewma":0.5,"active":1,"peak":0}}}`,
    ) as unknown;
    const { meta, coerced } = migrateMetaChecked(raw);
    const d = freshSave(0, 'UTC');
    expect(meta.profile).toMatchObject({ name: d.profile.name, xp: 0, level: 1, belt: 'white', goals: [], tz: 'UTC' });
    expect(meta.settings.newPerDay).toEqual(d.settings.newPerDay);
    expect(meta.settings.restDay).toBeNull();
    expect(meta.streak).toMatchObject({ current: 0, longest: 0 });
    expect(meta.progress.station).toBe(0);
    expect(meta.progress.stationsCleared).toEqual([1, 2]);
    expect(meta.bookmarks).toEqual(['b']);
    expect(meta.stats.reviews).toBe(0);
    expect(meta.weakPoints[tag as keyof typeof meta.weakPoints]).toEqual({ n: 0, ewma: 0.5, active: false, peak: 0 });
    expect(coerced).toEqual(
      expect.arrayContaining(['profile.name', 'profile.xp', 'profile.level', 'profile.belt', 'profile.goals', 'settings.newPerDay', 'settings.restDay', 'streak.current', 'streak.longest', 'progress.station', 'progress.stationsCleared', 'bookmarks', 'stats.reviews', `weakPoints.${tag}.n`, `weakPoints.${tag}.active`]),
    );
    // Idempotent: a repaired save needs no further repair.
    expect(migrateMetaChecked(meta)).toEqual({ meta, coerced: [] });
    expect(migrateMetaChecked(freshSave(NOW, 'UTC')).coerced).toEqual([]);
  });

  it('repairs out-of-union settings values to defaults and reports the paths', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    Object.assign(s.settings, { intensity: 'bogus', feel: 'bogus', theme: 'sepia', furigana: 'maybe', speaking: 'loud', speedTier: 9, retention: 0.5, restDay: 12, sound: 7 });
    const { meta, coerced } = migrateMetaChecked(s);
    const d = freshSave(0, 'UTC').settings;
    expect(meta.settings).toMatchObject({ intensity: d.intensity, feel: d.feel, theme: d.theme, furigana: d.furigana, speaking: d.speaking, speedTier: d.speedTier, retention: d.retention, restDay: null, sound: 1 });
    expect(coerced.sort()).toEqual(['settings.feel', 'settings.furigana', 'settings.intensity', 'settings.restDay', 'settings.retention', 'settings.sound', 'settings.speaking', 'settings.speedTier', 'settings.theme']);
    expect(migrateMetaChecked(meta).coerced).toEqual([]);
    const ok = freshSave(NOW, 'UTC');
    ok.settings = { ...ok.settings, intensity: 'custom', feel: 'arcade', speedTier: 5, retention: 0.95, restDay: 6, sound: 0 };
    expect(migrateMetaChecked(ok)).toEqual({ meta: ok, coerced: [] });
  });

  it('drops array elements of the wrong shape: card keys, belts, stations, ledger and kage tuples, capped strings', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    s.progress.grudge = [42, 'noFacet', 'v-n5-0001#rec', 'x#bogus'];
    s.progress.stationsCleared = ['3', 1, 99, -1, 2.5, 7];
    s.progress.assisted = [1, 'two'];
    s.progress.shinsaPassed = ['white', 'rainbow', 3];
    s.profile.kanaKnown = [1, 2, 'k-h-a'];
    s.profile.goals = [1, { a: 1 }, 'road:sanjo-ohashi'];
    s.ledger = { entries: [5, 'x', [1, 2], [20000, 10, 0, 1], [20001, 5, 9, 0], [20002, -5, 0, 0], [20003, 7, 1, 1, 'anime']], monthly: { '2025-01': 10, '2025-02': 'x' }, missions: [{ day: 1, tier: 3, conversation: true }, { day: 'x' }, 7] };
    s.kage = { week: 1, best4: [3, 'x'], wins: 0, history: [[1, 3], [2], 'x'] };
    (s as Record<string, unknown>).bookmarks = [{ evil: true }, 42, 'ok', 'long '.repeat(200)];
    (s as Record<string, unknown>).captured = [null, 7, 'v-n5-0003'];
    const { meta, coerced } = migrateMetaChecked(s);
    expect(meta.progress.grudge).toEqual(['v-n5-0001#rec']);
    expect(meta.progress.stationsCleared).toEqual([1, 7]);
    expect(meta.progress.assisted).toEqual([1]);
    expect(meta.progress.shinsaPassed).toEqual(['white']);
    expect(meta.profile.kanaKnown).toEqual(['k-h-a']);
    expect(meta.profile.goals).toEqual(['road:sanjo-ohashi']);
    expect(meta.ledger.entries).toEqual([[20000, 10, 0, 1], [20003, 7, 1, 1, 'anime']]);
    expect(meta.ledger.monthly).toEqual({ '2025-01': 10 });
    expect(meta.ledger.missions).toEqual([{ day: 1, tier: 3, conversation: true }]);
    expect(meta.kage.best4).toEqual([3]);
    expect(meta.kage.history).toEqual([[1, 3]]);
    expect(meta.bookmarks).toHaveLength(2);
    expect(meta.bookmarks[0]).toBe('ok');
    expect(Array.from(meta.bookmarks[1]).length).toBe(500);
    expect(meta.captured).toEqual(['v-n5-0003']);
    expect(coerced).toEqual(expect.arrayContaining(['progress.grudge', 'progress.stationsCleared', 'progress.assisted', 'progress.shinsaPassed', 'profile.kanaKnown', 'profile.goals', 'ledger.entries', 'ledger.monthly', 'ledger.missions', 'kage.best4', 'kage.history', 'bookmarks', 'captured']));
    expect(migrateMetaChecked(meta).coerced).toEqual([]);
  });

  it('drops record entries of the wrong shape (daily rows, stamps, badges, wallpapers, medians, gate attempts, perapera)', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    s.daily = { 20000: { reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 }, 20001: 5, 20002: { reps: 'x' } };
    s.collections = { badges: { 'first-step': 20000, seven: 'x' }, wallpapers: { a: { at: 1, reforges: 0, revealed: 2 }, b: { at: 1, reforges: 0, revealed: 9 }, c: 'x' }, stamps: { 3: { at: 1, perfect: true, assisted: false }, 4: 'x' }, michikusa: [] };
    s.medianMs = { 'kana-flash': 800, 'audio-flash': 'x' };
    s.progress.gateAttempts = { 1: 2, 2: 'x' };
    s.perapera = { months: { '2026-01': [1, 2, 3, 4, 5], '2026-02': [1, 2], '2026-03': 'x' } };
    const { meta, coerced } = migrateMetaChecked(s);
    expect(meta.daily).toEqual({ 20000: { reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 } });
    expect(meta.collections.badges).toEqual({ 'first-step': 20000 });
    expect(Object.keys(meta.collections.wallpapers)).toEqual(['a']);
    expect(meta.collections.stamps).toEqual({ 3: { at: 1, perfect: true, assisted: false } });
    expect(meta.medianMs).toEqual({ 'kana-flash': 800 });
    expect(meta.progress.gateAttempts).toEqual({ 1: 2 });
    expect(meta.perapera.months).toEqual({ '2026-01': [1, 2, 3, 4, 5] });
    expect(coerced).toEqual(expect.arrayContaining(['daily', 'collections.badges', 'collections.wallpapers', 'collections.stamps', 'medianMs', 'progress.gateAttempts', 'perapera.months']));
    expect(migrateMetaChecked(meta).coerced).toEqual([]);
  });

  it('caps header strings: seed ≤ 64 chars, name/nameKana ≤ NAME_MAX_GLYPHS (24) code points, chosenKanji exactly one glyph, dictatedSentence ≤ 500', () => {
    expect(NAME_MAX_GLYPHS).toBe(24);
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    (s as Record<string, unknown>).seed = 'a'.repeat(1_000_000);
    s.profile.name = '花'.repeat(200);
    s.profile.nameKana = 'は'.repeat(50);
    s.profile.chosenKanji = '食'.repeat(3000);
    s.profile.dictatedSentence = 'x'.repeat(2000);
    s.profile.onboardedAt = 'yesterday';
    const { meta, coerced } = migrateMetaChecked(s);
    expect(meta.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(Array.from(meta.profile.name).length).toBe(NAME_MAX_GLYPHS);
    expect(Array.from(meta.profile.nameKana).length).toBe(NAME_MAX_GLYPHS);
    expect(meta.profile.nameKana).toBe('は'.repeat(NAME_MAX_GLYPHS));
    expect(meta.profile.chosenKanji).toBeUndefined();
    expect(Array.from(meta.profile.dictatedSentence as string).length).toBe(500);
    expect(meta.profile.onboardedAt).toBeUndefined();
    expect(coerced.sort()).toEqual(['profile.chosenKanji', 'profile.dictatedSentence', 'profile.name', 'profile.nameKana', 'profile.onboardedAt', 'seed']);
    expect(migrateMetaChecked(meta).coerced).toEqual([]);
    const ok = freshSave(NOW, 'UTC');
    ok.profile.chosenKanji = '食';
    ok.profile.dictatedSentence = 'これはペンです。';
    ok.profile.name = '😀'.repeat(NAME_MAX_GLYPHS); // astral glyphs count once
    expect(migrateMetaChecked(ok)).toEqual({ meta: ok, coerced: [] });
  });

  it('repairs an unresolvable or unsafe profile.tz to UTC and reports the path; valid zones pass', () => {
    const typo = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    typo.profile.tz = 'Nowhere/Town';
    expect(migrateMetaChecked(typo)).toMatchObject({ meta: { profile: { tz: 'UTC' } }, coerced: ['profile.tz'] });
    const injected = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    injected.profile.tz = 'UTC\nX:1';
    expect(migrateMetaChecked(injected)).toMatchObject({ meta: { profile: { tz: 'UTC' } }, coerced: ['profile.tz'] });
    const padded = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    padded.profile.tz = ' Asia/Tokyo ';
    expect(migrateMetaChecked(padded).meta.profile.tz).toBe('Asia/Tokyo');
    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'US/Pacific', 'Etc/GMT+8']) {
      const ok = freshSave(NOW, tz);
      expect(migrateMetaChecked(ok)).toEqual({ meta: ok, coerced: [] });
    }
  });

  it('keeps optional fields and record entries the template lacks', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    s.streak.ember = 123;
    s.streak.repairWindow = { start: 5, done: 1 };
    s.quests.n = { 'clear-due': 4 };
    s.progress.gateAttempts = { 1: 2 };
    s.progress.gateAttemptAt = { 4: 1_700_000_000_000 };
    s.daily = { 20000: { reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 } };
    s.profile.onboardedAt = 77;
    const out = migrateMeta(s) as unknown as Record<string, Record<string, unknown>>;
    expect(out.streak.ember).toBe(123);
    expect(out.streak.repairWindow).toEqual({ start: 5, done: 1 });
    expect(out.quests.n).toEqual({ 'clear-due': 4 });
    expect(out.progress.gateAttempts).toEqual({ 1: 2 });
    expect(out.progress.gateAttemptAt).toEqual({ 4: 1_700_000_000_000 });
    expect(out.daily).toEqual(s.daily);
    expect(out.profile.onboardedAt).toBe(77);
  });

  it('lifts a save that finished onboarding at station 0 to the first uncleared station', () => {
    const fresh = freshSave(NOW, 'UTC');
    expect(migrateMeta(fresh).progress.station).toBe(0);
    const onboarded = { ...fresh, profile: { ...fresh.profile, goals: ['road:sanjo-ohashi'] } };
    expect(migrateMeta(onboarded).progress.station).toBe(1);
    const trained = { ...fresh, stats: { ...fresh.stats, sessions: 3 }, progress: { ...fresh.progress, stationsCleared: [1, 2, 3] } };
    expect(migrateMeta(trained).progress.station).toBe(4);
    const moved = { ...onboarded, progress: { ...fresh.progress, station: 5 } };
    expect(migrateMeta(moved).progress.station).toBe(5);
  });

  it('throws a typed MigrationError on an unknown schema', () => {
    expect(() => migrateMeta({ schema: 'somebody.else/1' })).toThrow(MigrationError);
    try {
      migrateMeta({ schema: 'somebody.else/1' });
    } catch (e) {
      expect(e).toBeInstanceOf(MigrationError);
      expect((e as MigrationError).doc).toBe('meta');
      expect((e as MigrationError).schema).toBe('somebody.else/1');
    }
  });

  it('throws on a save newer than this build', () => {
    expect(() => migrateMeta({ ...freshSave(NOW, 'UTC'), schema: 'tsuzuku.save/2' })).toThrow(/newer/);
  });

  it('throws on non-objects and on schema-less junk', () => {
    expect(() => migrateMeta(null)).toThrow(MigrationError);
    expect(() => migrateMeta('x')).toThrow(MigrationError);
    expect(() => migrateMeta({ hello: 1 })).toThrow(MigrationError);
  });
});

describe('migrateShard', () => {
  const good: CardTuple = [20500, 12.34, 5.67, 12, 1, 2, 20488, 0];

  it('passes a v1 shard through and keeps only valid tuples under valid keys', () => {
    const raw = {
      schema: CARDS_SCHEMA,
      kind: 'vocab',
      level: 'n5',
      cards: {
        'v-n5-0001#rec': good,
        'v-n5-0002#prod': [1, 2, 3],
        'v-n5-0003#rec': [20500, 1, 1, 1, 1, 7, 1, 0],
        'v-n5-0004': good,
        'v-n5-0005#nope': good,
      },
    };
    const out = migrateShard(raw);
    expect(out.schema).toBe(CARDS_SCHEMA);
    expect(out.kind).toBe('vocab');
    expect(out.level).toBe('n5');
    expect(Object.keys(out.cards)).toEqual(['v-n5-0001#rec']);
  });

  it('stamps the schema on a v0 shard', () => {
    const out = migrateShard({ kind: 'kana', level: 'kana', cards: { 'k-h-a#rec': good } });
    expect(out.schema).toBe(CARDS_SCHEMA);
    expect(out.cards['k-h-a#rec']).toEqual(good);
  });

  it('throws on unknown schema or missing/unknown kind/level', () => {
    expect(() => migrateShard({ schema: 'tsuzuku.cards/9', kind: 'vocab', level: 'n5', cards: {} })).toThrow(MigrationError);
    expect(() => migrateShard({ schema: CARDS_SCHEMA, cards: {} })).toThrow(/kind/);
    expect(() => migrateShard({ schema: CARDS_SCHEMA, kind: 'bogus', level: 'n5', cards: {} })).toThrow(MigrationError);
    // a level outside the curriculum must not ride into the import as a placement hint
    expect(() => migrateShard({ schema: CARDS_SCHEMA, kind: 'vocab', level: 'n9', cards: {} })).toThrow(/level/);
    expect(() => migrateShard({ schema: CARDS_SCHEMA, kind: 'vocab', level: 7, cards: {} })).toThrow(/level/);
    expect(() => migrateShard(7)).toThrow(MigrationError);
  });
});

describe('migrateLog', () => {
  const e6: LogEntry = [1_700_000_000_000, 'v-n5-0001#rec', 3, 2345, 5, 0];

  it('keeps valid 6-tuples and fills the 5-tuple tagsMask with 0', () => {
    const out = migrateLog({ schema: LOG_SCHEMA, entries: [e6, [1, 'g-n5-001#cloze', 2, 10, 1], ['bad'], [1, 'nokey', 3, 1, 1, 0], [1, 'v-n5-0001#rec', 9, 1, 1, 0]] });
    expect(out).toEqual([e6, [1, 'g-n5-001#cloze', 2, 10, 1, 0]]);
  });

  it('accepts a bare v0 array', () => {
    expect(migrateLog([e6])).toEqual([e6]);
  });

  it('throws on unknown schema and non-objects', () => {
    expect(() => migrateLog({ schema: 'tsuzuku.log/2', entries: [] })).toThrow(MigrationError);
    expect(() => migrateLog(3)).toThrow(MigrationError);
  });
});

describe('applyRedirects', () => {
  const t = (last: number, reps = 1): CardTuple => [last + 5, 3, 5, reps, 0, 2, last, 0];
  const shard = (cards: CardShard['cards']): CardShard => ({ schema: CARDS_SCHEMA, kind: 'vocab', level: 'n5', cards });

  it('rewrites keys through redirects and follows chains', () => {
    expect(resolveRedirect('a', { a: 'b', b: 'c' })).toBe('c');
    expect(resolveRedirect('a', { a: 'b', b: 'a' })).toBe('a');
    expect(redirectKey('v-n5-0001#rec', { 'v-n5-0001': 'v-n5-0100' })).toBe('v-n5-0100#rec');
    const out = applyRedirects(shard({ 'v-n5-0001#rec': t(10), 'v-n5-0001#prod': t(11) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(Object.keys(out.cards).sort()).toEqual(['v-n5-0100#prod', 'v-n5-0100#rec']);
  });

  it('merges collisions by newer lastReview, ties by more reps', () => {
    const out = applyRedirects(shard({ 'v-n5-0001#rec': t(10), 'v-n5-0100#rec': t(20) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(out.cards['v-n5-0100#rec']).toEqual(t(20));
    const tie = applyRedirects(shard({ 'v-n5-0001#rec': t(10, 9), 'v-n5-0100#rec': t(10, 2) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(tie.cards['v-n5-0100#rec']).toEqual(t(10, 9));
  });

  it('is idempotent and returns the same shard when nothing matches', () => {
    const s = shard({ 'v-n5-0002#rec': t(1) });
    expect(applyRedirects(s, { 'v-n5-0001': 'v-n5-0100' })).toBe(s);
    const once = applyRedirects(shard({ 'v-n5-0001#rec': t(1) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(applyRedirects(once, { 'v-n5-0001': 'v-n5-0100' })).toBe(once);
  });
});
