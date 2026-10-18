import { DRILL_IDS, RUNNER_IDS } from '@/content/types';
import { isRegistered, listExercises, registerExercise, resetRegistryForTests, resolveExercise, type ExerciseMeta } from '@/shared/exercise-types';
import { F_DRILLS, F_DRILL_IDS, ListenPage, RadioPage, StoryPage, TaiwaPage, missingDrills, registerAll } from './index';

beforeEach(() => {
  resetRegistryForTests();
});
afterEach(() => {
  resetRegistryForTests();
});

/** needsTts / needsStt pinned per the module plan and design 04. */
const PINNED: Record<(typeof F_DRILL_IDS)[number], { needsTts: boolean; needsStt: boolean; keys: ExerciseMeta['keys'] }> = {
  'story-read': { needsTts: false, needsStt: false, keys: 'none' },
  'speed-read': { needsTts: false, needsStt: false, keys: 'choices' },
  'listening-set': { needsTts: true, needsStt: false, keys: 'choices' },
  shadow: { needsTts: true, needsStt: false, keys: 'none' },
  'say-three-ways': { needsTts: false, needsStt: false, keys: 'kana' },
  monologue: { needsTts: false, needsStt: false, keys: 'none' },
  'role-play': { needsTts: true, needsStt: false, keys: 'choices' },
  'writing-dojo': { needsTts: false, needsStt: false, keys: 'none' },
  'field-mission': { needsTts: false, needsStt: false, keys: 'none' },
};

describe('input barrel', () => {
  it('registerAll registers exactly the 9 F-owned ids, all with a null facet', () => {
    expect(listExercises()).toEqual([]);
    registerAll();
    const ids = listExercises().map((m) => m.id);
    expect(ids.length).toBe(9);
    expect([...ids].sort()).toEqual([...F_DRILL_IDS].sort());
    for (const id of F_DRILL_IDS) {
      const e = resolveExercise(id);
      expect(e, id).toBeDefined();
      expect(e!.meta.id).toBe(id);
      expect(e!.meta.facet).toBeNull();
      expect(typeof e!.Component).toBe('function');
      expect(e!.Component).toBe(F_DRILLS[id].Component);
    }
    expect(missingDrills()).toEqual([]);
  });

  it('needsTts / needsStt / keys match the plan: TTS for listening, shadow and role-play; STT is never required', () => {
    registerAll();
    for (const id of F_DRILL_IDS) {
      const m = resolveExercise(id)!.meta;
      expect({ id, needsTts: m.needsTts, needsStt: m.needsStt, keys: m.keys }).toEqual({ id, ...PINNED[id] });
      expect(typeof m.selfGraded).toBe('boolean');
      expect(typeof m.timeable).toBe('boolean');
    }
    // Self-graded paths exist only where the design says so (shadow fallback, writing rubric, mission self-report).
    expect(resolveExercise('shadow')!.meta.selfGraded).toBe(true);
    expect(resolveExercise('writing-dojo')!.meta.selfGraded).toBe(true);
    expect(resolveExercise('story-read')!.meta.selfGraded).toBe(false);
  });

  it('never registers a D drill or a runner id', () => {
    registerAll();
    const fSet = new Set<string>(F_DRILL_IDS);
    for (const id of DRILL_IDS) if (!fSet.has(id)) expect(isRegistered(id), id).toBe(false);
    for (const id of RUNNER_IDS) expect(isRegistered(id), id).toBe(false);
  });

  it('is idempotent and leaves an id another caller registered first alone', () => {
    const Other = (): null => null;
    registerExercise({ ...F_DRILLS.shadow.meta }, Other);
    registerAll();
    registerAll();
    expect(listExercises().length).toBe(9);
    expect(resolveExercise('shadow')!.Component).toBe(Other);
    expect(missingDrills()).toEqual([]);
  });

  it('missingDrills lists what is not registered yet', () => {
    expect(missingDrills()).toEqual([...F_DRILL_IDS]);
    registerExercise(F_DRILLS.monologue.meta, F_DRILLS.monologue.Component);
    expect(missingDrills()).toEqual(F_DRILL_IDS.filter((id) => id !== 'monologue'));
  });

  it('re-exports the four standalone pages (Story, Listen, Taiwa, Radio)', () => {
    expect(typeof StoryPage).toBe('function');
    expect(typeof ListenPage).toBe('function');
    expect(typeof TaiwaPage).toBe('function');
    // design 08 §10.2: `PAGE_SOURCES.radio` reads `RadioPage` from this barrel
    expect(typeof RadioPage).toBe('function');
  });
});
