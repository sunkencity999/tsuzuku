/**
 * TSUZUKU — route → page wiring (group A, ARCHITECTURE §0 exception).
 *
 * THE module (with `src/main.tsx`) allowed to import other groups' barrels.
 * Every page is loaded lazily so each group ships as its own chunk:
 *   A  src/app/pages/*Page.tsx   Dojo · Onboarding · Settings · Backup · About
 *   E  src/session/index.ts      Train · Scroll · Station · Gate · Shinsa · Road · Dan · dojoFeed (· gateForecast)
 *   F  src/input/index.ts        Story · Listen · Taiwa · Radio (+ registerAll for 9 drills)
 *   B  src/records/index.ts      Records · Ledger
 *   G  src/collections/index.ts  Collections · Studio · Library
 *   G  src/art/index.ts          DojoScene (CeremonyHost is mounted by main.tsx)
 *   D  src/exercises/index.ts    registerAll for 26 drills
 *
 * The loaders come from `import.meta.glob` over these exact paths: Vite
 * code-splits each match exactly like a literal `import()`, but a module that
 * is not on disk yet is simply absent instead of a build error, so the shell
 * keeps working (and testing) while the groups land. `ensureExercises()`
 * fills the exercise registry before any session or reader route renders;
 * failures degrade (partial registry, empty Dojo scene) and are kept in
 * `loadErrors()` for the About page.
 */
import type { FunctionComponent } from 'preact';
import type { Route, RouteName } from '@/shared/routes';

export interface PageProps {
  route: Route;
}
export type PageComponent = FunctionComponent<PageProps>;

export interface PageModule {
  Page: PageComponent;
  props?: Record<string, unknown>;
}

export interface PageSource {
  /** Import specifier (documentation; loading goes through `files[0]`). */
  module: string;
  /** Named export (or `default`). */
  export: string;
  /** Repo-relative source files that must exist for this route to resolve; `files[0]` is the module. */
  files: string[];
  /** The exercise registry is filled before this page renders. */
  needsExercises: boolean;
}

/** Where every route's page comes from. Exhaustive over `RouteName` (compile-time). */
export const PAGE_SOURCES: Record<RouteName, PageSource> = {
  dojo: { module: '@/app/pages/DojoPage', export: 'default', files: ['src/app/pages/DojoPage.tsx'], needsExercises: false },
  onboarding: { module: '@/app/pages/OnboardingPage', export: 'default', files: ['src/app/pages/OnboardingPage.tsx'], needsExercises: false },
  settings: { module: '@/app/pages/SettingsPage', export: 'default', files: ['src/app/pages/SettingsPage.tsx'], needsExercises: false },
  backup: { module: '@/app/pages/BackupPage', export: 'default', files: ['src/app/pages/BackupPage.tsx'], needsExercises: false },
  about: { module: '@/app/pages/AboutPage', export: 'default', files: ['src/app/pages/AboutPage.tsx'], needsExercises: false },
  train: { module: '@/session', export: 'TrainPage', files: ['src/session/index.ts'], needsExercises: true },
  scroll: { module: '@/session', export: 'ScrollPage', files: ['src/session/index.ts'], needsExercises: true },
  station: { module: '@/session', export: 'StationPage', files: ['src/session/index.ts'], needsExercises: false },
  gate: { module: '@/session', export: 'GatePage', files: ['src/session/index.ts'], needsExercises: true },
  shinsa: { module: '@/session', export: 'ShinsaPage', files: ['src/session/index.ts'], needsExercises: true },
  road: { module: '@/session', export: 'RoadPage', files: ['src/session/index.ts'], needsExercises: false },
  dan: { module: '@/session', export: 'DanPage', files: ['src/session/index.ts'], needsExercises: true },
  story: { module: '@/input', export: 'StoryPage', files: ['src/input/index.ts'], needsExercises: true },
  listen: { module: '@/input', export: 'ListenPage', files: ['src/input/index.ts'], needsExercises: true },
  taiwa: { module: '@/input', export: 'TaiwaPage', files: ['src/input/index.ts'], needsExercises: true },
  // 茶屋ラジオ (design 08 §10.2, ARCHITECTURE §6): a non-session surface, so it never waits for the registry.
  // The row is final; `RadioPage` is exported from the F barrel by the radio owner (listening-plan `radio`).
  radio: { module: '@/input', export: 'RadioPage', files: ['src/input/index.ts'], needsExercises: false },
  records: { module: '@/records', export: 'RecordsPage', files: ['src/records/index.ts'], needsExercises: false },
  ledger: { module: '@/records', export: 'LedgerPage', files: ['src/records/index.ts'], needsExercises: false },
  collections: { module: '@/collections', export: 'CollectionsPage', files: ['src/collections/index.ts'], needsExercises: false },
  studio: { module: '@/collections', export: 'StudioPage', files: ['src/collections/index.ts'], needsExercises: false },
  library: { module: '@/collections', export: 'LibraryPage', files: ['src/collections/index.ts'], needsExercises: false },
};

export const ROUTE_NAMES: readonly RouteName[] = Object.keys(PAGE_SOURCES) as RouteName[];

export const EXERCISES_BARREL = 'src/exercises/index.ts';
export const INPUT_BARREL = 'src/input/index.ts';
export const SESSION_BARREL = 'src/session/index.ts';
export const ART_BARREL = 'src/art/index.ts';

/* ── lazy module table ──────────────────────────────────────────────────── */

type AnyModule = Record<string, unknown>;
type Loader = () => Promise<AnyModule>;

const MODULES: Record<string, Loader> = {
  ...import.meta.glob<AnyModule>([
    '/src/session/index.ts',
    '/src/input/index.ts',
    '/src/records/index.ts',
    '/src/collections/index.ts',
    '/src/art/index.ts',
    '/src/exercises/index.ts',
  ]),
  ...import.meta.glob<AnyModule>('/src/app/pages/*Page.tsx'),
};

/** True when `file` (repo-relative) was on disk at build time. */
export function moduleAvailable(file: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODULES, `/${file}`);
}

function loadModule(file: string): Promise<AnyModule> {
  const loader = MODULES[`/${file}`];
  if (!loader) return Promise.reject(new Error(`${file} is not built yet`));
  return loader();
}

/* ── load-error ledger (About page debug panel) ─────────────────────────── */

const errors: { module: string; message: string }[] = [];

function remember(module: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (!errors.some((e) => e.module === module && e.message === message)) errors.push({ module, message });
  console.warn(`[pages] ${module} failed to load: ${message}`);
}

/** Modules that failed to load so far, oldest first. */
export function loadErrors(): readonly { module: string; message: string }[] {
  return errors.slice();
}

/* ── exercise registry ──────────────────────────────────────────────────── */

let exercisesPromise: Promise<void> | null = null;
let exercisesOk = false;

async function registerBarrel(file: string): Promise<boolean> {
  try {
    const m = await loadModule(file);
    const registerAll = m.registerAll;
    if (typeof registerAll !== 'function') throw new Error('no registerAll() export');
    (registerAll as () => void)();
    return true;
  } catch (err) {
    remember(file, err);
    return false;
  }
}

/**
 * Loads `src/exercises` (D, 26 drills) and `src/input` (F, 9 drills) and runs
 * both `registerAll()`. Memoized once both succeed; otherwise the next call retries.
 */
export function ensureExercises(): Promise<void> {
  if (exercisesPromise) return exercisesPromise;
  exercisesPromise = (async () => {
    const [d, f] = await Promise.all([registerBarrel(EXERCISES_BARREL), registerBarrel(INPUT_BARREL)]);
    exercisesOk = d && f;
    if (!exercisesOk) exercisesPromise = null;
  })();
  return exercisesPromise;
}

/** True once both registries loaded cleanly. */
export function exercisesReady(): boolean {
  return exercisesOk;
}

/**
 * Forgets the memoized registration and the load-error ledger. Pair it with
 * `resetRegistryForTests()` from `@/shared/exercise-types`: that clears the
 * registry Map, this clears the memo that would otherwise skip refilling it.
 */
export function resetExercisesForTests(): void {
  exercisesPromise = null;
  exercisesOk = false;
  errors.length = 0;
}

/* ── page resolution ────────────────────────────────────────────────────── */

function pick(mod: AnyModule, name: string, module: string): PageComponent {
  const v = mod[name];
  if (typeof v !== 'function') throw new Error(`${module} has no export "${name}"`);
  return v as unknown as PageComponent;
}

const EmptyScene: FunctionComponent = () => null;

async function optional(file: string): Promise<AnyModule | null> {
  try {
    return await loadModule(file);
  } catch (err) {
    remember(file, err);
    return null;
  }
}

/**
 * Dojo props: `Scene` from G's art barrel, `feed` and `gate` (`gateForecast`,
 * which the Dojo's fallback forecast runs at 0 scrolls so it agrees with the
 * live feed) from E's session barrel; all three degrade to nothing. The feed
 * reads the exercise registry synchronously (`isRegistered`), so the registry
 * is filled here rather than at boot.
 */
async function dojoProps(): Promise<Record<string, unknown>> {
  const [art, session] = await Promise.all([optional(ART_BARREL), optional(SESSION_BARREL), ensureExercises()]);
  const Scene = typeof art?.DojoScene === 'function' ? art.DojoScene : EmptyScene;
  const feed = typeof session?.dojoFeed === 'function' ? session.dojoFeed : null;
  const gate = typeof session?.gateForecast === 'function' ? session.gateForecast : null;
  return { Scene, feed, gate };
}

/**
 * Resolves the page for a route. Rejects when the page module is missing or
 * broken; `App` shows its calm error state. Session and reader routes wait for
 * the exercise registry first.
 */
export async function pageFor(r: Route): Promise<PageModule> {
  const src = PAGE_SOURCES[r.name];
  if (src.needsExercises) await ensureExercises();
  const [mod, props] = await Promise.all([loadModule(src.files[0]!), r.name === 'dojo' ? dojoProps() : Promise.resolve(undefined)]);
  const Page = pick(mod, src.export, src.module);
  return props ? { Page, props } : { Page };
}
