/**
 * Route → page wiring. Every route's module must be on disk: a renamed or
 * deleted page fails this file instead of becoming a silent skip.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRILL_IDS, RUNNER_IDS, type DrillId } from '@/content/types';
import { resetRegistryForTests, resolveExercise } from '@/shared/exercise-types';
import type { Route, RouteName } from '@/shared/routes';
import { EXERCISES_BARREL, INPUT_BARREL, PAGE_SOURCES, ROUTE_NAMES, ensureExercises, exercisesReady, loadErrors, moduleAvailable, pageFor, resetExercisesForTests } from './pages';

const exists = (p: string): boolean => existsSync(resolve(process.cwd(), p));

/** Which barrel registers which drill (design 07 §13; D 26, F 9). */
export const D_DRILLS: readonly DrillId[] = [
  'kana-flash',
  'kana-ear',
  'kana-forge',
  'gojuon-fighter',
  'meaning-guard',
  'meaning-recall',
  'meaning-judge',
  'audio-flash',
  'production-forge',
  'pitch-ear',
  'component-flash',
  'component-assembly',
  'kanji-read',
  'lookalike-duel',
  'kanji-write',
  'pattern-cloze',
  'particle-duel',
  'form-forge',
  'form-chain',
  'transform',
  'scramble',
  'judgment-call',
  'sentence-listen',
  'minimal-pair',
  'rapid-fire',
  'nemesis-duel',
];
export const F_DRILLS: readonly DrillId[] = [
  'story-read',
  'speed-read',
  'listening-set',
  'shadow',
  'say-three-ways',
  'monologue',
  'role-play',
  'writing-dojo',
  'field-mission',
];

const ALL_ROUTE_NAMES: RouteName[] = [
  'dojo',
  'onboarding',
  'train',
  'scroll',
  'road',
  'station',
  'gate',
  'shinsa',
  'story',
  'listen',
  'taiwa',
  'radio',
  'dan',
  'library',
  'collections',
  'studio',
  'records',
  'ledger',
  'settings',
  'backup',
  'about',
];

function sampleRoute(name: RouteName): Route {
  switch (name) {
    case 'train':
      return { name, mode: 'kata' };
    case 'scroll':
      return { name, id: '4-1' };
    case 'station':
      return { name, n: 1 };
    case 'gate':
      return { name, n: 1 };
    case 'shinsa':
      return { name, belt: 'yellow' };
    case 'story':
    case 'listen':
    case 'taiwa':
      return { name, id: 's-04-1' };
    case 'collections':
      return { name, tab: 'mon' };
    case 'studio':
      return { name, wallpaperId: 'torii-dawn' };
    default:
      return { name } as Route;
  }
}

describe('route table', () => {
  it('names every route exactly once', () => {
    expect([...ROUTE_NAMES].sort()).toEqual([...ALL_ROUTE_NAMES].sort());
    for (const name of ALL_ROUTE_NAMES) {
      const src = PAGE_SOURCES[name];
      expect(src.module, name).toMatch(/^@\//);
      expect(src.export.length, name).toBeGreaterThan(0);
      expect(src.files.length, name).toBeGreaterThan(0);
    }
  });

  it('A pages are default exports; group barrels are named exports', () => {
    for (const name of ALL_ROUTE_NAMES) {
      const src = PAGE_SOURCES[name];
      if (src.module.startsWith('@/app/pages/')) expect(src.export).toBe('default');
      else expect(src.export).not.toBe('default');
    }
  });

  it('the lazy module table mirrors what is on disk', () => {
    const files = new Set([...ALL_ROUTE_NAMES.map((n) => PAGE_SOURCES[n].files[0]!), EXERCISES_BARREL, INPUT_BARREL]);
    for (const f of files) expect(moduleAvailable(f), f).toBe(exists(f));
    expect(moduleAvailable('src/app/pages/Nope.tsx')).toBe(false);
  });

  it('session and reader routes wait for the exercise registry', () => {
    const waits = ALL_ROUTE_NAMES.filter((n) => PAGE_SOURCES[n].needsExercises).sort();
    expect(waits).toEqual(['dan', 'gate', 'listen', 'scroll', 'shinsa', 'story', 'taiwa', 'train']);
  });

  it('D and F drill ownership is disjoint and covers all 35 DRILL_IDS; no RUNNER_ID is a drill', () => {
    expect(D_DRILLS.length).toBe(26);
    expect(F_DRILLS.length).toBe(9);
    const union = new Set([...D_DRILLS, ...F_DRILLS]);
    expect(union.size).toBe(35);
    expect([...union].sort()).toEqual([...DRILL_IDS].sort());
    for (const id of RUNNER_IDS) expect((DRILL_IDS as readonly string[]).includes(id)).toBe(false);
  });
});

describe('pageFor', () => {
  for (const name of ALL_ROUTE_NAMES) {
    const src = PAGE_SOURCES[name];
    // The dojo case cold-imports the art, session, exercises and input barrels: give it room.
    it(
      `${name} → ${src.module}#${src.export} resolves to a component`,
      async () => {
        // Every route, `radio` (design 08 §10.2) included, resolves for real: a renamed page fails here, never as a skip.
        const mod = await pageFor(sampleRoute(name));
        expect(typeof mod.Page).toBe('function');
        if (name === 'dojo') {
          expect(mod.props).toBeDefined();
          expect(mod.props).toHaveProperty('Scene');
          expect(mod.props).toHaveProperty('feed');
          expect(mod.props).toHaveProperty('gate');
          // The barrel's own exports, or null — never something else.
          for (const k of ['feed', 'gate'] as const) expect(mod.props![k] === null || typeof mod.props![k] === 'function', k).toBe(true);
        }
      },
      name === 'dojo' ? 30_000 : undefined,
    );
  }

  it('every route module is on disk (a renamed page fails here, never as a skip)', () => {
    const missing = ALL_ROUTE_NAMES.filter((n) => !PAGE_SOURCES[n].files.every(exists));
    expect(missing).toEqual([]);
  });

  it('the dojo page waits for the exercise registry, so its feed never sees an empty registry', async () => {
    resetRegistryForTests();
    resetExercisesForTests();
    expect(exercisesReady()).toBe(false);
    const mod = await pageFor({ name: 'dojo' });
    expect(typeof mod.Page).toBe('function');
    expect(exercisesReady()).toBe(true);
  });
});

/** The drill component files each barrel registers (module-plan depends_on). */
const D_FILES = [
  'kana/KanaFlash',
  'kana/KanaEar',
  'kana/KanaForge',
  'kana/GojuonFighter',
  'vocab/MeaningGuard',
  'vocab/MeaningRecall',
  'vocab/MeaningJudge',
  'vocab/AudioFlash',
  'vocab/ProductionForge',
  'vocab/PitchEar',
  'kanji/ComponentFlash',
  'kanji/ComponentAssembly',
  'kanji/KanjiRead',
  'kanji/LookalikeDuel',
  'kanji/KanjiWrite',
  'grammar/PatternCloze',
  'grammar/ParticleDuel',
  'grammar/FormForge',
  'grammar/FormChain',
  'grammar/Transform',
  'grammar/Scramble',
  'grammar/JudgmentCall',
  'listening/SentenceListen',
  'listening/MinimalPair',
  'fluency/RapidFire',
  'fluency/NemesisDossier',
].map((f) => `src/exercises/${f}.tsx`);
const F_FILES = [
  'reader/StoryReader',
  'reader/SpeedRead',
  'listening/ListeningArena',
  'speaking/Shadow',
  'speaking/SayThreeWays',
  'speaking/Monologue',
  'taiwa/RolePlay',
  'writing/WritingDojo',
  'missions/FieldMission',
].map((f) => `src/input/${f}.tsx`);

describe('ensureExercises', () => {
  const dBarrel = exists(EXERCISES_BARREL);
  const fBarrel = exists(INPUT_BARREL);
  const dPresent = D_FILES.filter(exists).length;
  const fPresent = F_FILES.filter(exists).length;
  const dComplete = dBarrel && dPresent === D_FILES.length;
  const fComplete = fBarrel && fPresent === F_FILES.length;
  const owner = (id: DrillId): 'D' | 'F' => (D_DRILLS.includes(id) ? 'D' : 'F');

  // `pageFor` above already filled and memoized the registry; clear both the
  // Map and the memo so this block exercises a real registration.
  beforeAll(() => {
    resetRegistryForTests();
    resetExercisesForTests();
  });

  it('resolves even when a barrel is missing, and remembers the failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(ensureExercises()).resolves.toBeUndefined();
    warn.mockRestore();
    if (!dBarrel) expect(loadErrors().some((e) => e.module === EXERCISES_BARREL)).toBe(true);
    if (!fBarrel) expect(loadErrors().some((e) => e.module === INPUT_BARREL)).toBe(true);
    expect(exercisesReady()).toBe(dBarrel && fBarrel && !loadErrors().some((e) => e.module === EXERCISES_BARREL || e.module === INPUT_BARREL));
    console.info(`[pages] drills on disk: D ${dPresent}/${D_FILES.length}, F ${fPresent}/${F_FILES.length}`);
  });

  it('registered drills belong to the barrel that was loaded; runner ids never register', async () => {
    await ensureExercises();
    for (const id of DRILL_IDS) {
      if (!resolveExercise(id)) continue;
      const by = owner(id);
      expect(by === 'D' ? dBarrel : fBarrel, `${id} registered without its barrel`).toBe(true);
    }
    for (const id of RUNNER_IDS) expect(resolveExercise(id), id).toBeUndefined();
  });

  it('registers the 26 D drills once src/exercises is complete', async (ctx) => {
    if (!dComplete) ctx.skip(`src/exercises: ${dBarrel ? `${dPresent}/${D_FILES.length} drill files` : 'barrel'} not landed yet`);
    await ensureExercises();
    for (const id of D_DRILLS) expect(resolveExercise(id), id).toBeDefined();
  });

  it('registers the 9 F drills once src/input is complete', async (ctx) => {
    if (!fComplete) ctx.skip(`src/input: ${fBarrel ? `${fPresent}/${F_FILES.length} drill files` : 'barrel'} not landed yet`);
    await ensureExercises();
    for (const id of F_DRILLS) expect(resolveExercise(id), id).toBeDefined();
  });

  it('all 35 DRILL_IDS resolve and every RUNNER_ID stays undefined once both groups are complete', async (ctx) => {
    if (!(dComplete && fComplete)) ctx.skip('waiting on D and/or F drill files');
    await ensureExercises();
    for (const id of DRILL_IDS) expect(resolveExercise(id), id).toBeDefined();
    for (const id of RUNNER_IDS) expect(resolveExercise(id), id).toBeUndefined();
    expect(exercisesReady()).toBe(true);
    expect(ensureExercises()).toBe(ensureExercises());
  });
});
