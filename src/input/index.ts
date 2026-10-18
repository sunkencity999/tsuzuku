/**
 * TSUZUKU — input / output barrel for group F (ARCHITECTURE §4, §8).
 *
 * `registerAll()` registers EXACTLY the 9 F-owned drills with the shared
 * registry (`@/shared/exercise-types`): story-read, speed-read,
 * listening-set, shadow, say-three-ways, monologue, role-play, writing-dojo,
 * field-mission. Each drill file follows the D export convention
 * (`export const meta: ExerciseMeta` + a component named like the file).
 * Registration is idempotent (an id already registered is left alone) and
 * never touches D's 26 drills or the runner ids. The four standalone pages
 * (Story, Listen, Taiwa, Radio) are re-exported for `src/app/pages.ts`.
 */
import type { FunctionComponent } from 'preact';
import type { DrillId } from '@/content/types';
import { isRegistered, registerExercise, type ExerciseComponent, type ExerciseMeta, type ExerciseProps } from '@/shared/exercise-types';
import { ListeningArena, meta as listeningSetMeta } from './listening/ListeningArena';
import { FieldMission, meta as fieldMissionMeta } from './missions/FieldMission';
import { SpeedRead, meta as speedReadMeta } from './reader/SpeedRead';
import { StoryReader, meta as storyReadMeta } from './reader/StoryReader';
import { Monologue, meta as monologueMeta } from './speaking/Monologue';
import { SayThreeWays, meta as sayThreeWaysMeta } from './speaking/SayThreeWays';
import { Shadow, meta as shadowMeta } from './speaking/Shadow';
import { RolePlay, meta as rolePlayMeta } from './taiwa/RolePlay';
import { WritingDojo, meta as writingDojoMeta } from './writing/WritingDojo';

export { default as StoryPage } from './pages/StoryPage';
export { default as ListenPage } from './pages/ListenPage';
export { default as TaiwaPage } from './pages/TaiwaPage';
// design 08 §10.2: 茶屋ラジオ (#/radio), a non-session surface (`PAGE_SOURCES.radio`, needsExercises false)
export { default as RadioPage } from './pages/RadioPage';

/** The 9 drills group F registers (module plan), in design-04 order. */
export const F_DRILL_IDS = [
  'story-read',
  'speed-read',
  'listening-set',
  'shadow',
  'say-three-ways',
  'monologue',
  'role-play',
  'writing-dojo',
  'field-mission',
] as const satisfies readonly DrillId[];

export type FDrillId = (typeof F_DRILL_IDS)[number];

export interface FDrill {
  meta: ExerciseMeta;
  Component: ExerciseComponent;
}

/**
 * Components that also accept standalone props (`StoryReader`, `SpeedRead`,
 * `ListeningArena`, `RolePlay`) or carry optional test-injection props are
 * still `FunctionComponent<ExerciseProps>` at the call site: every extra
 * prop is optional, so `ExerciseProps` alone satisfies them.
 */
function asExercise<P extends ExerciseProps>(c: FunctionComponent<P>): ExerciseComponent {
  return c as unknown as ExerciseComponent;
}

/** meta + component per F drill, keyed by id. */
export const F_DRILLS: Readonly<Record<FDrillId, FDrill>> = {
  'story-read': { meta: storyReadMeta, Component: asExercise(StoryReader) },
  'speed-read': { meta: speedReadMeta, Component: asExercise(SpeedRead) },
  'listening-set': { meta: listeningSetMeta, Component: asExercise(ListeningArena) },
  shadow: { meta: shadowMeta, Component: asExercise(Shadow) },
  'say-three-ways': { meta: sayThreeWaysMeta, Component: asExercise(SayThreeWays) },
  monologue: { meta: monologueMeta, Component: asExercise(Monologue) },
  'role-play': { meta: rolePlayMeta, Component: asExercise(RolePlay) },
  'writing-dojo': { meta: writingDojoMeta, Component: asExercise(WritingDojo) },
  'field-mission': { meta: fieldMissionMeta, Component: asExercise(FieldMission) },
};

/** Registers the 9 F drills. Idempotent; ids another call already registered are kept. */
export function registerAll(): void {
  for (const id of F_DRILL_IDS) {
    const d = F_DRILLS[id];
    if (d.meta.id !== id) throw new Error(`input/index: ${id} exports meta for "${d.meta.id}"`);
    if (!isRegistered(id)) registerExercise(d.meta, d.Component);
  }
}

/** F drills not registered yet (the builder skips unregistered exercises, ARCHITECTURE §8). */
export function missingDrills(): FDrillId[] {
  return F_DRILL_IDS.filter((id) => !isRegistered(id));
}
