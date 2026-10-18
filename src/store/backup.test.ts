import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import { NAME_MAX_GLYPHS, type CardTuple, type LogEntry, type SaveMeta } from '../shared/store-types';
import { effect } from '@preact/signals';
import { SESSION_SCHEMA, type SessionSnapshot } from '../shared/session-types';
import { BACKUP_SCHEMA, IMPORT_MAX_BYTES, applyImport, buildBackup, collectShards, exportSave, hasNoLearnerTrace, mergeSaves, previewImport, previewImportBlob, readBlobBytes, readBlobText, unionLogs, type BackupDocument } from './backup';
import { effectiveNewPerDay } from './defaults';
import { LOG_RING, SESSION_KEY, hasCompression, pump } from './persist';
import { initStore, resetStoreForTests, store, storeCards } from './store';
import { DEFAULT_TEST_NOW, MemoryStorage, TEST_SEED, captureEvents, card, makeTestStore, testSave } from './testing';
import { S } from './strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function live(s: number, last = TODAY, reps = 3): CardTuple {
  return card({ due: last + 1, s, reps, state: 2, last });
}

const CARDS: Record<CardKey, CardTuple> = {
  'v-n5-0001#rec': live(10),
  'v-n5-0002#rec': live(3),
  'k-h-a#rec': live(40),
  'j-食#comp': live(8),
  'g-n5-001#cloze': live(5),
};

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

type Bytes = Uint8Array<ArrayBuffer>;

async function gzipForTest(text: string): Promise<Bytes> {
  const input = new TextEncoder().encode(text) as Bytes;
  const stream = new ReadableStream<Bytes>({
    start(c) {
      c.enqueue(input);
      c.close();
    },
  });
  return pump(stream.pipeThrough(new CompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>));
}

describe('exportSave', () => {
  it('builds a versioned envelope with every slice, every shard and the log; counts exports; emits backup:exported', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { name: 'ハナ', xp: 1234 } } });
    store.log.push([DEFAULT_TEST_NOW - 1000, 'v-n5-0001#rec', 3, 1200, 5, 0]);
    const cap = captureEvents();
    const { blob, filename } = await exportSave();
    cap.stop();
    expect(filename).toBe('tsuzuku-backup-2026-01-15.json');
    expect(blob.type).toBe('application/json');
    const doc = JSON.parse(await readBlobText(blob)) as BackupDocument;
    expect(doc.schema).toBe(BACKUP_SCHEMA);
    expect(doc.exportedAt).toBe(DEFAULT_TEST_NOW);
    expect(doc.meta.profile.name).toBe('ハナ');
    expect(doc.meta.stats.exports).toBe(1);
    // Kanji ids carry no level: at station 0 the shard falls back to kanji.n5.
    expect(Object.keys(doc.shards).sort()).toEqual(['grammar.n5', 'kana.kana', 'kanji.n5', 'vocab.n5']);
    const all = Object.values(doc.shards).flatMap((s) => Object.keys(s.cards));
    expect(all.sort()).toEqual(Object.keys(CARDS).sort());
    expect(doc.log.entries.length).toBe(1);
    expect(store.stats.value.exports).toBe(1);
    expect(cap.events.filter(([n]) => n === 'backup:exported').length).toBe(1);
    expect(collectShards()['vocab.n5'].cards['v-n5-0001#rec']).toEqual(CARDS['v-n5-0001#rec']);
  });

  it('gzip yields real gzip bytes and previewImportBlob reads them back', async () => {
    if (!hasCompression()) return;
    await makeTestStore({ cards: CARDS });
    const { blob, filename } = await exportSave({ gzip: true });
    expect(filename).toBe('tsuzuku-backup-2026-01-15.tsuzuku.json.gz');
    expect(blob.type).toBe('application/gzip');
    const bytes = await readBlobBytes(blob);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const p = await previewImportBlob(blob);
    expect(p.valid).toBe(true);
    expect(p.summary.cards).toEqual([5, 5]);
    // The same bytes handed over as text are refused with a calm hint.
    const asText = new TextDecoder().decode(bytes);
    expect(previewImport(asText)).toMatchObject({ valid: false, errors: [S.importCompressed] });
  });
});

describe('previewImport', () => {
  it('invalid JSON and non-saves are refused without touching the store', async () => {
    await makeTestStore({ cards: CARDS });
    expect(previewImport('{nope')).toMatchObject({ valid: false, errors: [S.importNotJson] });
    expect(previewImport('')).toMatchObject({ valid: false, errors: [S.importNotJson] });
    expect(previewImport('[1,2]')).toMatchObject({ valid: false, errors: [S.importNotBackup] });
    expect(previewImport('{"hello":1}')).toMatchObject({ valid: false, errors: [S.importNotBackup] });
    expect(previewImport(JSON.stringify({ schema: 'tsuzuku.backup/9', meta: testSave() }))).toMatchObject({ valid: false, errors: [S.importNewer] });
    expect(previewImport(JSON.stringify({ meta: { ...testSave(), schema: 'tsuzuku.save/7' } }))).toMatchObject({ valid: false, errors: [S.importNewer] });
    expect(store.cards.count()).toBe(5);
    const bad = previewImport('{"hello":1}');
    expect(bad.summary.cards).toEqual([5, 0]);
    expect(bad.summary.cardsLost).toBe(5);
  });

  it('summarises streak, xp, cards, badges and days against the current save', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { xp: 100 }, streak: { current: 2, totalDays: 9 }, collections: { badges: { 'first-step': TODAY } } } });
    const incoming = testSave({ save: { profile: { xp: 500 }, streak: { current: 7, totalDays: 30 }, collections: { badges: { 'first-step': TODAY - 5, seven: TODAY - 1 } } } });
    const doc = {
      schema: BACKUP_SCHEMA,
      exportedAt: 123,
      meta: incoming,
      shards: {
        'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: { 'v-n5-0001#rec': live(20, TODAY + 1), 'v-n5-0009#rec': live(1) } },
        broken: { schema: 'tsuzuku.cards/1', cards: {} },
      },
      log: { schema: 'tsuzuku.log/1', entries: [[1, 'v-n5-0001#rec', 3, 900, 5, 0], ['bad']] },
    };
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([S.importNoShard]);
    expect(p.summary).toEqual({ streak: [2, 7], xp: [100, 500], cards: [5, 2], badges: [1, 2], days: [9, 30], cardsGained: 1, cardsLost: 4, name: ['無名', '無名'] });
    expect(p.exportedAt).toBe(123);
    expect(p.data?.log).toEqual([[1, 'v-n5-0001#rec', 3, 900, 5, 0]]);
  });

  it('accepts a bare SaveMeta and the design-07 shape', async () => {
    await makeTestStore();
    const bare = previewImport(JSON.stringify(testSave({ save: { profile: { xp: 50 } } })));
    expect(bare.valid).toBe(true);
    expect(bare.summary.xp).toEqual([0, 50]);
    const d07 = previewImport(JSON.stringify({ meta: testSave(), shards: [], log: [] }));
    expect(d07.valid).toBe(true);
  });
});

describe('mergeSaves (pure)', () => {
  it('streak max, XP max, collections union, ledger union; settings stay local', () => {
    const cur = testSave({ save: { profile: { xp: 300, belt: 'yellow', name: 'A' }, settings: { feel: 'zen' }, streak: { current: 5, longest: 9, totalDays: 40, freezes: 3, lastDay: TODAY }, collections: { badges: { 'first-step': TODAY - 9 } }, ledger: { entries: [[TODAY, 10, 0, 1]] }, stats: { reviews: 100 }, progress: { station: 6, stationsCleared: [1, 2, 3, 4, 5] } } });
    const inc = testSave({ save: { profile: { xp: 2500, belt: 'orange', name: 'B' }, settings: { feel: 'arcade' }, streak: { current: 8, longest: 8, totalDays: 35, freezes: 1, lastDay: TODAY - 1 }, collections: { badges: { 'first-step': TODAY - 20, seven: TODAY - 3 } }, ledger: { entries: [[TODAY, 10, 0, 1], [TODAY - 1, 20, 1, 1]] }, stats: { reviews: 80, sessions: 9 }, progress: { station: 11, stationsCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } });
    const m = mergeSaves(cur, inc, 999);
    expect(m.profile).toMatchObject({ xp: 2500, level: 5, belt: 'orange', name: 'A' });
    expect(m.settings.feel).toBe('zen');
    expect(m.streak).toMatchObject({ current: 8, longest: 9, totalDays: 40, freezes: 3, lastDay: TODAY });
    expect(m.collections.badges).toEqual({ 'first-step': TODAY - 20, seven: TODAY - 3 });
    expect(m.ledger.entries).toEqual([[TODAY - 1, 20, 1, 1], [TODAY, 10, 0, 1]]);
    expect(m.stats.reviews).toBe(100);
    expect(m.stats.sessions).toBe(9);
    expect(m.progress.station).toBe(11);
    expect(m.progress.stationsCleared).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.updatedAt).toBe(999);
    expect(m.seed).toBe(cur.seed);
  });

  it('merge into a fresh browser takes the backup\'s name, nameKana, tz, dictatedSentence and onboardedAt', () => {
    const cur = testSave();
    const inc = testSave({ save: { profile: { name: '花子', nameKana: 'はなこ', tz: 'Asia/Tokyo', xp: 500, dictatedSentence: 'これはペンです。', onboardedAt: 123 }, stats: { sessions: 20 } } });
    expect(hasNoLearnerTrace(cur)).toBe(true);
    expect(hasNoLearnerTrace(inc)).toBe(false);
    const m = mergeSaves(cur, inc, 999);
    expect(m.profile).toMatchObject({ name: '花子', nameKana: 'はなこ', tz: 'Asia/Tokyo', xp: 500, dictatedSentence: 'これはペンです。', onboardedAt: 123 });
    expect(m.settings).toBe(cur.settings);
  });

  it('merge into an onboarded browser keeps the local name but fills a missing dictatedSentence/onboardedAt from the backup', () => {
    const cur = testSave({ save: { profile: { name: 'A', nameKana: 'えー', goals: ['road:sanjo-ohashi'] } } });
    const inc = testSave({ save: { profile: { name: 'B', nameKana: 'びー', tz: 'Asia/Tokyo', dictatedSentence: 'はい。', onboardedAt: 5 } } });
    const m = mergeSaves(cur, inc, 999);
    expect(m.profile).toMatchObject({ name: 'A', nameKana: 'えー', tz: 'UTC', dictatedSentence: 'はい。', onboardedAt: 5 });
    const kanaOnly = testSave({ save: { profile: { name: 'K', kanaKnown: ['k-h-a'] } } });
    expect(mergeSaves(kanaOnly, inc, 999).profile.name).toBe('K');
    expect(mergeSaves(testSave({ save: { profile: { name: 'D' }, streak: { totalDays: 1 } } }), inc, 999).profile.name).toBe('D');
  });

  it('progress: gateAttemptDay and gateAttemptAt keep the later value per station', () => {
    const cur = testSave({ save: { progress: { gateAttemptDay: { 4: TODAY - 1 }, gateAttemptAt: { 4: 100 } } } });
    const inc = testSave({ save: { progress: { gateAttemptDay: { 4: TODAY, 7: TODAY - 2 }, gateAttemptAt: { 4: 500, 7: 50 } } } });
    const m = mergeSaves(cur, inc, 999);
    expect(m.progress.gateAttemptDay).toEqual({ 4: TODAY, 7: TODAY - 2 });
    expect(m.progress.gateAttemptAt).toEqual({ 4: 500, 7: 50 });
    expect(mergeSaves(inc, cur, 999).progress.gateAttemptAt).toEqual({ 4: 500, 7: 50 });
  });

  it('listening (design 08 §11): texts heard and teach cards seen are unioned, the counters take the max, audio settings stay local', () => {
    const cur = testSave({ save: { settings: { audioSource: 'device', dataSaver: true }, progress: { listened: ['s-07-1', 's-07-2'], teachSeen: ['morae-beats'] }, stats: { radioMinutes: 30, coldSets: 4, coldSetsPassed: 3, listeningAuthenticMinutes: 12, bestCleanTier: 2 } } });
    const inc = testSave({ save: { settings: { audioSource: 'pack', dataSaver: false }, progress: { listened: ['s-07-2', 's-08-1'], teachSeen: ['arena-first'] }, stats: { radioMinutes: 600, coldSets: 2, coldSetsPassed: 1, listeningAuthenticMinutes: 40, bestCleanTier: 4 } } });
    const m = mergeSaves(cur, inc, 999);
    expect(m.progress.listened).toEqual(['s-07-1', 's-07-2', 's-08-1']);
    expect(m.progress.teachSeen).toEqual(['morae-beats', 'arena-first']);
    expect(m.stats).toMatchObject({ radioMinutes: 600, coldSets: 4, coldSetsPassed: 3, listeningAuthenticMinutes: 40, bestCleanTier: 4 });
    expect(m.settings.audioSource).toBe('device');
    expect(m.settings.dataSaver).toBe(true);
    // a side without the arrays contributes nothing and loses nothing
    const bare = testSave() as SaveMeta & { progress: { listened?: string[]; teachSeen?: string[] } };
    delete bare.progress.listened;
    delete bare.progress.teachSeen;
    expect(mergeSaves(bare, inc, 999).progress.listened).toEqual(['s-07-2', 's-08-1']);
    expect(mergeSaves(inc, bare, 999).progress.teachSeen).toEqual(['arena-first']);
  });
});

describe('applyImport', () => {
  it('export → replace into an empty store round-trips the save, the cards and the log', async () => {
    const storageA = new MemoryStorage();
    await makeTestStore({ cards: CARDS, storage: storageA, save: { seed: 'feedfacefeedface', profile: { name: 'ハナ', xp: 4321 }, streak: { current: 3, totalDays: 12 } } });
    expect(store.seed()).toBe('feedfacefeedface');
    store.log.push([DEFAULT_TEST_NOW - 5000, 'k-h-a#rec', 3, 800, 0, 0]);
    const { blob } = await exportSave();
    const json = await readBlobText(blob);
    const before: SaveMeta = JSON.parse(JSON.stringify(store.meta()));

    resetStoreForTests();
    await makeTestStore({ storage: new MemoryStorage() });
    const p = previewImport(json);
    expect(p.valid).toBe(true);
    expect(applyImport(p, 'replace')).toBe(true);
    const after = store.meta();
    expect(after.profile).toEqual(before.profile);
    expect(after.streak).toEqual(before.streak);
    expect(after.stats.imports).toBe(1);
    expect({ ...after.stats, imports: 0 }).toEqual({ ...before.stats, imports: 0 });
    expect(after.seed).toBe(before.seed);
    expect(store.seed()).toBe('feedfacefeedface');
    expect(store.cards.count()).toBe(5);
    for (const [k, t] of Object.entries(CARDS) as [CardKey, CardTuple][]) expect(store.cards.get(k)).toEqual(t);
    expect(store.log.recent(10)).toEqual([[DEFAULT_TEST_NOW - 5000, 'k-h-a#rec', 3, 800, 0, 0]]);
    expect(applyImport({ ...p, valid: false }, 'replace')).toBe(false);
  });

  it('merging a backup into a fresh browser keeps the backup\'s identity along with its XP and stats', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { name: '花子', nameKana: 'はなこ', xp: 500, onboardedAt: DEFAULT_TEST_NOW - 1000 }, stats: { sessions: 20 }, streak: { current: 4, totalDays: 20 } } });
    const bk = JSON.stringify(buildBackup());
    resetStoreForTests();
    await makeTestStore({ storage: new MemoryStorage() });
    expect(store.profile.value.name).toBe('無名');
    const p = previewImport(bk);
    expect(p.summary.name).toEqual(['無名', '花子']);
    expect(applyImport(p, 'merge')).toBe(true);
    expect(store.profile.value).toMatchObject({ name: '花子', nameKana: 'はなこ', xp: 500, onboardedAt: DEFAULT_TEST_NOW - 1000 });
    expect(store.stats.value.sessions).toBe(20);
    expect(store.streak.value.totalDays).toBe(20);
    expect(store.cards.count()).toBe(5);
  });

  it('applyImport drops the in-progress session snapshot in both modes', async () => {
    const storage = new MemoryStorage();
    await makeTestStore({ storage });
    const json = JSON.stringify(buildBackup());
    const snap = { schema: SESSION_SCHEMA, plan: { id: 'p1' }, cursor: 2 } as unknown as SessionSnapshot;
    store.session.save(snap);
    await store.flush();
    expect(storage.getItem(SESSION_KEY)).not.toBeNull();
    expect(applyImport(previewImport(json), 'replace')).toBe(true);
    await store.flush();
    expect(store.session.load()).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    store.session.save(snap);
    await store.flush();
    expect(applyImport(previewImport(json), 'merge')).toBe(true);
    await store.flush();
    expect(store.session.load()).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });

  it('applyImport runs cards.version / slice effects once per import, not once per card', async () => {
    await makeTestStore({ reducers: true });
    const incoming: Record<CardKey, CardTuple> = {};
    for (let i = 0; i < 50; i++) incoming[`v-n5-${String(i).padStart(4, '0')}#rec`] = live(3 + i);
    const doc = { schema: BACKUP_SCHEMA, meta: testSave({ save: { profile: { xp: 50 } } }), shards: { 'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: incoming } }, log: { schema: 'tsuzuku.log/1', entries: [] } };
    let runs = 0;
    const stop = effect(() => {
      void store.cards.version.value;
      void store.profile.value;
      void store.stats.value;
      runs++;
    });
    runs = 0;
    expect(applyImport(previewImport(JSON.stringify(doc)), 'replace')).toBe(true);
    expect(runs).toBe(1);
    expect(store.cards.count()).toBe(50);
    runs = 0;
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    expect(runs).toBe(1);
    stop();
  });

  it('replace drops cards the backup lacks; merge keeps them and takes the newer copy', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { xp: 10 } } });
    const incomingCards: Record<CardKey, CardTuple> = {
      'v-n5-0001#rec': live(99, TODAY + 2), // newer
      'v-n5-0002#rec': live(1, TODAY - 5), // older
      'v-n5-0777#rec': live(2), // new
    };
    const doc = { schema: BACKUP_SCHEMA, meta: testSave({ save: { profile: { xp: 5 } } }), shards: { 'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: incomingCards } }, log: { schema: 'tsuzuku.log/1', entries: [] } };
    const json = JSON.stringify(doc);

    expect(applyImport(previewImport(json), 'merge')).toBe(true);
    expect(store.cards.count()).toBe(6);
    expect(store.cards.get('v-n5-0001#rec')).toEqual(incomingCards['v-n5-0001#rec']);
    expect(store.cards.get('v-n5-0002#rec')).toEqual(CARDS['v-n5-0002#rec']);
    expect(store.cards.get('k-h-a#rec')).toEqual(CARDS['k-h-a#rec']);
    expect(store.profile.value.xp).toBe(10);
    expect(store.stats.value.imports).toBe(1);

    expect(applyImport(previewImport(json), 'replace')).toBe(true);
    expect(store.cards.count()).toBe(3);
    expect(store.cards.get('k-h-a#rec')).toBeUndefined();
    expect(store.cards.get('v-n5-0002#rec')).toEqual(incomingCards['v-n5-0002#rec']);
    expect(store.profile.value.xp).toBe(5);
    expect(store.stats.value.imports).toBe(1);
    expect(buildBackup().meta.profile.xp).toBe(5);
  });

  it('replace carries the backup\'s header (seed, createdAt, contentVersion) into the live store and the persisted save', async () => {
    const storage = new MemoryStorage();
    await makeTestStore({ storage });
    const doc = buildBackup();
    doc.meta.seed = 'feedfacefeedface';
    doc.meta.createdAt = DEFAULT_TEST_NOW - 86_400_000;
    doc.meta.contentVersion = 'c-2026.01';
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(applyImport(p, 'replace')).toBe(true);
    expect(store.seed()).toBe('feedfacefeedface');
    expect(store.meta().createdAt).toBe(DEFAULT_TEST_NOW - 86_400_000);
    expect(store.meta().contentVersion).toBe('c-2026.01');
    expect(store.stats.value.imports).toBe(1);
    await store.flush();
    await initStore({ storage, now: () => DEFAULT_TEST_NOW, reducers: false });
    expect(store.seed()).toBe('feedfacefeedface');
    expect(store.meta().createdAt).toBe(DEFAULT_TEST_NOW - 86_400_000);
  });

  it('merge keeps this browser\'s seed but takes the earlier createdAt and a missing contentVersion', async () => {
    await makeTestStore();
    const doc = buildBackup();
    doc.meta.seed = 'feedfacefeedface';
    doc.meta.createdAt = DEFAULT_TEST_NOW - 86_400_000;
    doc.meta.contentVersion = 'c-2026.01';
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    expect(store.seed()).toBe(TEST_SEED);
    expect(store.meta().createdAt).toBe(DEFAULT_TEST_NOW - 86_400_000);
    expect(store.meta().contentVersion).toBe('c-2026.01');
  });

  it('merge unions the review log without duplicates, in time order', async () => {
    await makeTestStore();
    const mine: LogEntry[] = [
      [100, 'v-n5-0001#rec', 3, 900, 0, 0],
      [200, 'v-n5-0002#rec', 2, 900, 0, 0],
      [300, 'v-n5-0001#rec', 3, 900, 0, 0],
    ];
    for (const e of mine) store.log.push(e);
    const doc = { schema: BACKUP_SCHEMA, meta: buildBackup().meta, shards: {}, log: { schema: 'tsuzuku.log/1', entries: [...mine, [50, 'v-n5-0003#rec', 1, 900, 0, 0], [250, 'v-n5-0001#rec', 4, 900, 0, 0]] } };
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    const all = store.log.recent(10);
    expect(all.map((e) => e[0])).toEqual([50, 100, 200, 250, 300]);
    expect(store.log.forCard('v-n5-0001#rec')).toHaveLength(3);
  });

  it('a full ring plus an older backup keeps this browser\'s newest 5,000 by time, not by push order', async () => {
    await makeTestStore();
    for (let i = 0; i < LOG_RING; i++) store.log.push([2_000_000 + i, 'v-n5-0001#rec', 3, 100, 0, 0]);
    const entries: LogEntry[] = [];
    for (let i = 0; i < LOG_RING; i++) entries.push([1_000_000 + i, 'v-n5-0002#rec', 3, 100, 0, 0]);
    const doc = { schema: BACKUP_SCHEMA, meta: buildBackup().meta, shards: {}, log: { schema: 'tsuzuku.log/1', entries } };
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    const r = store.log.recent(LOG_RING + 100);
    expect(r).toHaveLength(LOG_RING);
    expect(r.every((e) => e[0] >= 2_000_000)).toBe(true);
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBeGreaterThan(r[i - 1][0]);
    // The pure union: the newer half wins whichever side it comes from.
    const u = unionLogs(entries, r);
    expect(u).toHaveLength(LOG_RING);
    expect(u[0][0]).toBe(2_000_000);
  });

  it('fields of the wrong type are repaired to defaults with one warning, so a replaced save can still boot', async () => {
    await makeTestStore();
    const json = '{"schema":"tsuzuku.backup/1","meta":{"schema":"tsuzuku.save/1","profile":{"name":null,"xp":1e999,"level":"abc","belt":"rainbow","goals":"notarray","kanaKnown":"abc","tz":"UTC"},"settings":{"newPerDay":null,"restDay":3},"streak":{"current":"7","longest":{}},"progress":{"station":"7"},"bookmarks":[{"a":1},null,5],"stats":{"reviews":"x"}},"shards":{},"log":{"entries":[]}}';
    const p = previewImport(json);
    expect(p.valid).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([S.importRepaired]);
    expect(p.summary.xp).toEqual([0, 0]);
    expect(p.summary.streak).toEqual([0, 0]);
    expect(applyImport(p, 'replace')).toBe(true);
    const prof = store.profile.value;
    expect(typeof prof.name).toBe('string');
    expect(prof.name.trim().length).toBeGreaterThan(0);
    expect(prof).toMatchObject({ xp: 0, level: 1, belt: 'white', goals: [], kanaKnown: [] });
    expect(typeof store.settings.value.newPerDay.vocab).toBe('number');
    expect(store.settings.value.restDay).toBe(3);
    expect(store.streak.value).toMatchObject({ current: 0, longest: 0 });
    expect(store.progress.value.station).toBe(0);
    expect(store.bookmarks.value).not.toContain(null);
    expect(store.stats.value.reviews).toBe(0);
    // A well-typed backup carries no warning.
    expect(previewImport(JSON.stringify(buildBackup())).warnings).toEqual([]);
  });

  it('enum and array-element garbage is repaired: the new-item budget stays finite, grudge holds only card keys, merge does not throw', async () => {
    await makeTestStore();
    // Clone: `buildBackup()` hands out the live slice objects.
    const doc = JSON.parse(JSON.stringify(buildBackup())) as { meta: Record<string, Record<string, unknown>> & { seed: string } };
    doc.meta.settings.intensity = 'bogus';
    doc.meta.settings.speedTier = 9;
    doc.meta.progress.grudge = [42, 'noFacet', 'v-n5-0001#rec'];
    doc.meta.progress.stationsCleared = ['3', 2];
    doc.meta.profile.goals = [1, { a: 1 }];
    doc.meta.profile.kanaKnown = [{}];
    doc.meta.profile.name = 'x'.repeat(200_000);
    doc.meta.profile.chosenKanji = '食'.repeat(3000);
    (doc.meta as Record<string, unknown>).bookmarks = [{ evil: true }, 42, 'ok'];
    (doc.meta as Record<string, unknown>).captured = [null, 7];
    doc.meta.ledger.entries = [5, 'x', [1, 2], [TODAY, 10, 0, 1]];
    doc.meta.seed = 'a'.repeat(1_000_000);
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(p.warnings).toEqual([S.importRepaired]);
    const m = p.data?.meta as SaveMeta;
    expect(m.settings).toMatchObject({ intensity: 'standard', speedTier: 2 });
    expect(m.progress.grudge).toEqual(['v-n5-0001#rec']);
    expect(m.progress.stationsCleared).toEqual([2]);
    expect(m.profile.goals).toEqual([]);
    expect(m.profile.kanaKnown).toEqual([]);
    expect(Array.from(m.profile.name).length).toBe(NAME_MAX_GLYPHS);
    expect(m.profile.chosenKanji).toBeUndefined();
    expect(m.bookmarks).toEqual(['ok']);
    expect(m.captured).toEqual([]);
    expect(m.ledger.entries).toEqual([[TODAY, 10, 0, 1]]);
    expect(m.seed.length).toBeLessThanOrEqual(64);
    expect(applyImport(p, 'merge')).toBe(true);
    const n = effectiveNewPerDay(store.settings.value, 'white');
    expect(Number.isFinite(n.vocab) && Number.isFinite(n.kanji) && Number.isFinite(n.grammar)).toBe(true);
    expect(applyImport(previewImport(JSON.stringify(doc)), 'replace')).toBe(true);
    expect(store.seed().length).toBeLessThanOrEqual(64);
    expect(store.bookmarks.value).toEqual(['ok']);
  });

  it('a non-array ledger entry previews with the repair warning and merges without throwing', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY - 1, 15, 0, 1]] } } });
    const doc = JSON.parse(JSON.stringify(buildBackup())) as { meta: { ledger: { entries: unknown[] }; kage: { history: unknown[] } } };
    doc.meta.ledger.entries = [5];
    doc.meta.kage.history = [3, [1, 2]];
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(p.warnings).toEqual([S.importRepaired]);
    expect(p.data?.meta.ledger.entries).toEqual([]);
    expect(p.data?.meta.kage.history).toEqual([[1, 2]]);
    expect(() => applyImport(p, 'merge')).not.toThrow();
    expect(store.ledger.value.entries).toEqual([[TODAY - 1, 15, 0, 1]]);
    expect(store.kage.value.history).toEqual([[1, 2]]);
  });

  it('a shard with an unknown level is skipped with a warning instead of riding into the write as a placement hint', async () => {
    await makeTestStore();
    const doc = JSON.parse(JSON.stringify(buildBackup())) as { shards: Record<string, unknown> };
    doc.shards = {
      'vocab.n9': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n9', cards: { 'v-n5-0001#rec': live(10) } },
      'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: { 'v-n5-0002#rec': live(3) } },
    };
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(p.warnings).toEqual([S.importNoShard]);
    expect(p.summary.cards[1]).toBe(1);
    expect(applyImport(p, 'replace')).toBe(true);
    expect(store.cards.count()).toBe(1);
    expect(store.cards.get('v-n5-0002#rec')).toEqual(live(3));
  });

  it('a throw mid-write puts the previous meta, cards, log and session back before rethrowing (nothing half-applied)', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { name: 'ハナ', xp: 100 }, streak: { current: 3 } } });
    const entry: LogEntry = [DEFAULT_TEST_NOW - 5000, 'k-h-a#rec', 3, 800, 0, 0];
    store.log.push(entry);
    const snap: SessionSnapshot = {
      schema: SESSION_SCHEMA,
      plan: { id: 'p1', mode: 'kata', day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 1, steps: [], blocks: [], meta: { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] } },
      cursor: 0,
      results: [],
      kiai: { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] },
    };
    store.session.save(snap);
    const before = JSON.parse(JSON.stringify(store.meta())) as SaveMeta;
    const seed = store.seed();

    const incoming = JSON.parse(JSON.stringify(buildBackup())) as { meta: SaveMeta; shards: Record<string, unknown> };
    incoming.meta.profile.name = '太郎';
    incoming.meta.profile.xp = 9999;
    incoming.meta.seed = 'abcdef0123456789';
    incoming.shards = { 'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: { 'v-n5-0009#rec': live(7), 'v-n5-0010#rec': live(8) } } };
    const p = previewImport(JSON.stringify(incoming));
    expect(p.valid).toBe(true);

    const spy = vi.spyOn(storeCards, 'set').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(() => applyImport(p, 'replace')).toThrow('quota');
    spy.mockRestore();

    expect(store.meta().profile).toEqual(before.profile);
    expect(store.meta().streak).toEqual(before.streak);
    expect(store.meta().stats).toEqual(before.stats);
    expect(store.seed()).toBe(seed);
    expect(store.cards.count()).toBe(5);
    for (const [k, t] of Object.entries(CARDS) as [CardKey, CardTuple][]) expect(store.cards.get(k)).toEqual(t);
    expect(store.cards.get('v-n5-0009#rec')).toBeUndefined();
    expect(store.log.recent(10)).toEqual([entry]);
    expect(store.session.load()).toEqual(snap);
    // and the same import applies cleanly once nothing throws
    expect(applyImport(p, 'replace')).toBe(true);
    expect(store.profile.value.name).toBe('太郎');
    expect(store.cards.count()).toBe(2);
  });
});

describe('import size ceiling', () => {
  it('refuses an oversize file before reading it', async () => {
    await makeTestStore();
    const arrayBuffer = vi.fn();
    const stub = { size: IMPORT_MAX_BYTES + 1, arrayBuffer } as unknown as Blob;
    const p = await previewImportBlob(stub);
    expect(p).toMatchObject({ valid: false, errors: [S.importTooLarge] });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(await previewImportBlob(new Uint8Array(0))).toMatchObject({ valid: false, errors: [S.importNotJson] });
    expect(previewImport(' '.repeat(IMPORT_MAX_BYTES + 1))).toMatchObject({ valid: false, errors: [S.importTooLarge] });
  });

  it('stops inflating a gzip whose output passes the ceiling', async () => {
    if (!hasCompression()) return;
    await makeTestStore();
    const text = '[' + '0,'.repeat(((IMPORT_MAX_BYTES + 2 * 1024 * 1024) / 2) | 0) + '0]';
    const bytes = await gzipForTest(text);
    expect(bytes.length).toBeLessThan(IMPORT_MAX_BYTES);
    const p = await previewImportBlob(bytes);
    expect(p).toMatchObject({ valid: false, errors: [S.importTooLarge] });
  }, 60_000);
});
