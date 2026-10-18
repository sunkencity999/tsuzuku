# CONTRACT NOTES (day 0 → day 1)

Verbatim hand-off notes from the contract-tier authors. **Binding for all groups**: where these differ from `docs/module-plan.json` or the pseudo-TS in `docs/ARCHITECTURE.md`, the real source files win, and these notes explain the differences. Read the actual exports of any module you import.

## Stage 1 — leaf contracts (shared/*, content/ruby, tokens.css)

All 751 tests pass (13 files) and `tsc --noEmit` is clean for the whole project.

**Files written** (`/Users/christopher.bradford/japanlangrace/`): `src/shared/{time,hash,ids,events,store-types,catalog,routes,exercise-types,session-types,audio,jp,kana-ime}.ts`, `src/content/ruby.ts`, `src/styles/tokens.css`; tests beside time, hash, ids, events, routes, jp, kana-ime (515 cases), ruby, catalog, exercise-types, audio, tokens.

**API summary** — signatures follow ARCHITECTURE/module-plan exactly, plus additive helpers:
- time: `epochDay/dayOf(ms,tz?)`, `dayStartMs/startOfDay`, `dayEndMs`, `isoWeek/isoWeekYear/isoWeekKey`, `weekOf` (absolute Monday-based index; use this for Kage seeding), `weekdayOf`, `daysBetween`, `civilToDay/dayToCivil/localToMs`, `isoDate`, `monthKey`, `formatEraDate`, `formatMinutes`.
- hash: `fnv1a32/hashString`, `xmur3`, `fmix32`, `hashSeed(...parts)`, `mulberry32`, `rngFor`, `pick/shuffle/sample/range(inclusive)/uniform/chance/gauss/weighted`, `randomSeed()` (the only `Math.random`/crypto call).
- ids: `cardKey/parseCardKey/isCardKey/itemOfKey/facetOfKey`, `kindOfId` (throws on unknown; `tryKindOfId` doesn't), `stationOfId/stationId`, `isValidId`, `levelOfId`, `contentKindOf`.
- events: `Events` (§2 verbatim), `bus.{on,once,emit,reset,recent,listenerCount}`.
- store-types: all slices; `STAT_KEYS`, `SLICE_KEYS`, `CardFlag`+`hasFlag/withFlag/withoutFlag`, `LEDGER_KINDS/SOURCES`, `Store<S>`, `SAVE/CARDS/LOG_SCHEMA`. `Profile.kanaKnown: string[]` (kana ids marked 既知).
- catalog: `BADGE_IDS`(66) `WALLPAPER_IDS`(28) `QUEST_IDS`(17)+`QUESTS` (strand/fromStation/requires/phase), `MISSIONS`(5 tiers), `SFX_NAMES`, `SHINSA_SECTIONS`, `BELT_BADGE/beltBadgeId`.
- session-types: adds runtime `SESSION_MODES`, `BLOCK_KINDS`, `SESSION_SCHEMA`, `JikaiYokoku`, `DojoFeed`.
- exercise-types: `registerExercise/resolveExercise(id: ExerciseId)/listExercises/isRegistered/resetRegistryForTests`, `FeedbackState`, `JudgeRequest`; `ExerciseFrameProps` adds optional `onReplay?/onChoice?`.
- audio: `services`, `nullAudio/nullStt`, `installServices/resetServices`, `speak/sfx` helpers, `SPEED_TIER_RATES`.
- jp: `normalizeJa/normalizeAnswer/equivalentJa/normalizeEn`, `moraSplit/moraCount`, `levenshtein`, `moraSimilarity`, `nearMissKind`, `fuzzyEn`, `diffChars`, script predicates.
- kana-ime: `imeStep/convertLive`, `finalizeIme`, `romajiToKana`, `wantsKatakana`, `hasPending`.
- ruby: `parseRuby/toPlain/toKana/hasKanji/kanjiIn/rubyCount/segmentsToTokens/tokensMatchPlain`, `KANJI_RE`.

**Contract deviations/additions others must know**
1. `src/content/types.ts`: added `export type ContentItem = KanaItem|VocabItem|KanjiItem|GrammarItem|StoryItem|MichikusaItem|ComponentDef` (§3 placed it in loader.ts, which doesn't exist yet; C should import/re-export it from types rather than redeclare).
2. `store-types.ts` type-imports `BadgeId/WallpaperId/QuestId` from `catalog` (no cycle) so `collections`/`quests` are typed.
3. IME convention: Hepburn `nn`+vowel/y = ん+n-row (kanna→かんな, konnyaku→こんにゃく); ほんや is typed `hon'ya`. Uppercase is folded; katakana is the `{katakana}` option only.
4. `nearMissKind` returns `null` for `normalizeAnswer`-equivalent variants (grader must check `equivalentJa` first).
5. `ruby.ts` imports `./types.ts` with extension so node strip-types scripts can load it.

**Left for integrator**: none blocking. `routes.ts` sets `document.title` itself on navigate/hashchange (A can drop its own title code or ignore).

## Stage 2a — shared/ui primitives

**Files written** (`/Users/christopher.bradford/japanlangrace/src/shared/ui/`): `Ruby.tsx`, `KanaInput.tsx`, `use-timer.ts`, `ExerciseFrame.tsx`, `Feedback.tsx`, `JudgeCard.tsx`, `ui.css`, `strings.ts` (per-folder copy, convention §8), plus tests `Ruby/KanaInput/ExerciseFrame/Feedback/JudgeCard.test.tsx`, `use-timer.test.tsx` (51 cases, all pass). `tsc` is clean for `src/shared/ui`; the 11 remaining project errors and 7 failing tests are in `learn/intro-policy`, `store/*`, `content/fixtures`, `content/loader`, `learn/judge` (other groups).

**API**
- `Ruby({ja, mode: FuriganaMode, fog?(base)→hide, onReveal?, tokens?, onTokenTap?, vertical?, class?})` — modes are `Settings['furigana']` (`always|fog|tap|off`), not `all|none`.
- `KanaInput({value, onChange, onSubmit(final), katakana?, candidates?, placeholder?, autoFocus?, disabled?, label?, id?})` — `onSubmit` receives the finalized value (`onChange(final)` fires first); Shift+Enter is left to the frame.
- `useTimer({running, deadlineMs?, now?, startedAt?, tickMs?, onTimeout?}) → {elapsed, remaining, progress, timedOut, paused: Signal; pause(); resume(); reset(startedAt?)}`.
- `ExerciseFrame(props)` = contract props + optional `now`, `onTimeout`, `onAgain` (もう一度; hidden if absent), `onResume`. Exports `ExerciseFrameContext`, `useExerciseFrame()`, `useExerciseKeys({onChoice(idx0), onReplay, onSubmit})` — exercises register handlers, never bind keys. Digit index is 0-based.
- `Feedback({state, onAgain?, feel?})`, `feedbackAnnouncement(state)`.
- `JudgeCard(shape & {rng, onPick(pass), onReplay?})`, `rubricMatches(answer, regex)`. Host must add `answer` (rubric) / `heard` (perception) to the exercise's `JudgeRequest`.

**Notes for integrator**: E should pass `now: store.now` to `ExerciseFrame` so `timer.startedAt` is honored (default clock is `performance.now`). Space continues when feedback shows, replays otherwise. `.status-window/.hanko/.btn/.chip/.combo/.tategaki` base styles are expected from A's `components.css`; `ui.css` only layers scoped rules.

## Stage 2b — content loader + fixtures

**Files written** (`/Users/christopher.bradford/japanlangrace/`): `src/content/loader.ts`, `src/content/loader.test.ts` (29), `src/content/fixtures/index.ts`, `src/content/fixtures/fixtures.test.ts` (72). `tsc` clean for `src/content/**`; 131/131 content tests pass. `types.ts` untouched.

**API** — `createLoader(fetchImpl?, base='./content/')`, `content` singleton, `ContentLoader` exactly per §3 plus: `ContentError` (`code: 'http'|'parse'|'schema'|'missing-station'`, `path`, `status`), `CumulativeSets`/`CumulativeKey`, `isChunk(item)`. Lookup strategy documented atop loader.ts: exact index after load → components file → kana by script → story/michikusa by station segment → vocab/grammar by level + cumulative-count sequence estimate → kanji by bundle hint else manifest order; loaded files are never re-scanned; one fetch in the common case; in-flight dedupe per path; Cache API `tsuzuku-content-<version>` best-effort (skipped where `caches` is absent).

Fixtures: `FIXTURE {manifest, stations[1,4], items, components, conjugation, files}`, `createFakeLoader()` (synchronous `get()`, no `load()` needed), `fixtureFetch(f?, {missing?, corrupt?})` (drives the real loader; records `.calls`), `FIXTURE_IDS`, `V`/`G` id maps, `PATHS`, `FIXTURE_STORY_ID 's-04-1'`, `FIXTURE_DIALOGUE_ID 's-04-2'`, `FIXTURE_PITCH_HIGH_ID`, `FIXTURE_CHUNK_IDS`, `FIXTURE_REDIRECT_FROM 'v-n5-0009'`.

**Deviations/additions others must know**
1. `kindOf(id)` returns `'chunk'` for a *loaded* set-phrase/aizuchi VocabItem (same `IdKind` union; `kindOfId` never does).
2. `resolveId` is identity until the manifest is in memory; `getAsync/load` await it first.
3. `cumulative(n)` skips stations absent from the manifest; `getAsync` on `st-`/`cj-` ids resolves `undefined` without fetching.
4. Fixture has both a story and a dialogue (module-plan asked for the dialogue; F needs `options`/`aizuchiSlot`). Components ride in Station 4's `componentIds` (no Station 3 bundle).
5. Story `tokenIds` resolve は→`g-n5-002`, です→`g-n5-001`; other particles null.

**Left for integrator**: none in C. Unrelated failures exist in `src/store/*.ts` (tsc: `CardKey` not exported from store-types) and `src/learn/judge.test.ts`.

## Stage 2c — learn: FSRS/scheduler/queue/governors/intro-policy

Whole project: `tsc --noEmit` clean, 42 test files / 1855 tests pass (1 pre-existing skip, not mine). All verification is done; nothing further needed.

**Files written** (`/Users/christopher.bradford/japanlangrace/src/learn/`): `fsrs.ts`, `fsrs-golden.ts`, `scheduler.ts`, `item-belt.ts`, `known.ts`, `governors.ts`, `intro-policy.ts`, `queue.ts`, `index.ts`, plus `*.test.ts` beside each (130 tests). tsc clean for `src/learn/**` and the whole project; full suite 1855 pass.

**API** — module-plan signatures exactly, plus additive helpers:
- fsrs: `W DECAY FACTOR MAX_INTERVAL`, `retrievability nextInterval(r,s,max?) initialStability initialDifficulty nextDifficulty nextStability sameDayStability schedule`, `fuzzWindow balancedDue stepPending cardRetrievability round2`.
- scheduler: `facetsFor initialFacets newCard warmStart unlockableFacets shouldArchive isKaiden applyRating kaidenQuota`, `UNLOCK_RULES STEP_OFFSETS stepOffsetsFor kichiStart withKaidenFlag KAIDEN_MAX_INTERVAL`.
- item-belt: `itemBelt baseFacet productionFacet BELT_ORDER beltRank beltAtLeast beltPromotion`.
- known: `isKnown knownSet kindOfCards groupByItem createKnownSetCache KNOWN_R`.
- governors: `capFor steadyStateReviews governor` (+`newTarget`, `newPaused`, optional `daysBack`), `REVIEW_CAPS NEW_RATE_BY_BELT presetRate retentionWorkload EXPECTED_MAX_MINUTES`.
- intro-policy: `Scroll scrollsForStation nextScrolls` (+ optional `today`, `introducedOn`, kana/component budgets), `isKanjiUnlockable kanjiUnlocksIn componentReady partition scrollSizes`.
- queue: `QueueCard dueCards(…, kaidenQuota?) gojuonPool recheckCards prodPrompt orderWave interleave insertSteps exerciseFor weakPointSet rapidFirePool kagePools`, `buildQueue interleaveViolations prodPrompts RECHECK_FLAG`.

**Deviations/additions others must know**
1. `KAIDEN_MAX_INTERVAL = 730`: Kaiden-flagged cards exceed the 365-d cap, because 15k cards / 365 d (41/day) > the 36/day lane quota; design's ≤7-day assertion is impossible otherwise (test documents both).
2. `RECHECK_FLAG = 16` (arcade miss) lives in queue.ts; fold into `CardFlag` in store-types.
3. `Scroll.kind` adds `'kana'`; captured-words scroll id is `<station>-cap`.
4. `QueueCard` has optional `tag` (intro/+3/+10/recovery/relearn — gap-rule exempt) and `exercise`.
5. Golden table is self-generated and frozen (ts-fsrs not installed); provenance in the file header.
6. Prod-only vocab ids are chunks (`known`/`queue`); B's derived.ts already relies on this.
7. `warmStart` yields state 2, due today, no steps.

**For integrator**: `fsrs-golden.ts` is re-exported from the barrel; `index.ts` re-exports the grading half by module-plan names (all resolve today).

## Stage 2d — learn: grading/judge/kiai/leech/distractors/conjugate

**Files written** (`/Users/christopher.bradford/japanlangrace/src/learn/`): `grading.ts`, `judge.ts`, `kiai.ts`, `leech.ts`, `distractors.ts`, `conjugate.ts` + six `*.test.ts` beside them (719 tests pass; disk golden-table suite auto-skips until `public/content/conjugation/*.json` exists, then checks every row both directions). `tsc` clean for all six; no duplicate export names across `src/learn/*`, so the barrel's `export *` resolves. Remaining project tsc errors are in `src/store/*` and `scripts/validate-content.ts` (not mine).

**API** — module-plan signatures exact, plus additive:
- grading: `toRating`, `isMature(card|null)`, `isSlow`, `SCORE_BANDS` (0.95/0.80), `SHADOW_BANDS` (0.80/0.60), `grade()` → `{rating, reason, stepMiss, recheck, honest, slow}`, `scoreBandsFor`, `scoreRating`, `ARCADE/UNGRADED/SCORED_EXERCISES`. Ctx gains optional `exposures`, `judge:'pass'|'fail'`, `pretest`.
- judge: `judgeRate` (honesty 0–1), `shouldJudge`, `judgeOptions`, `rubricJudge`/`rubricPasses`, `perceptionJudge`, `honestyRate`, `pushHonesty`, `HONESTY_WINDOW`.
- kiai: `KIAI_RULES`, `kiaiInit`, `kiaiStep` (rep gains optional `cardKey/repIndex/rng/mcFirstExposures`; result adds `kiaiEntered, kiDelta, comboBroken`), `comboTier`, `dueRecoveries`, `isIppon`.
- leech: `isNemesis` (flag), `qualifiesNemesis` (lapses≥8), `markNemesis`, `nemesisPhase(card,log,today,key?,opts?)`, `duelProgress(log,itemId,opts?)`, `nextDuelKey`, `defeat`.
- distractors: `meaningChoices`, `kanaGrid`, `kanjiLookalikes`, `clozeTiles(…,answer?)`, `scrambleTiles`, `particleOptions`, `minimalPairPartner`.
- conjugate: `conjugate`, `applicableForms`, `applicableFormsFor` (ある 11, 要る 11, 分かる 16, 見える / 聞こえる / できる 12; the regular godan 炒る 20), `defectiveFormsFor` (review round 2b; keyed by the written head word + pos, so kana いる as v1 is the full 20), `conjugateAll`, `acceptedSurfaces`, `isConjugable`; `DEFECTIVE`, `VERB_FORMS`, `ADJ_FORMS`, `isVerbPos` are on the `@/learn` barrel too.

**Contract notes for others**
1. Guard on <3 reviews returns rating **1 with `grade().stepMiss=true`** — scheduler/apply should take the same-day step path and not count a lapse.
2. Arcade miss → `rating null, recheck:true`; apply sets the flag.
3. `defeat()` resets `lapses` to 0 (so a defeated card doesn't instantly re-qualify).
4. Kiai persists `lostCombo` as an extra prop on `KiaiState` (JSON-safe) for Recovery half-restore. Block (near-miss) costs ki −4 (unspecified in 05; documented in `KIAI_RULES`).
5. `AttemptResult.selfRating` is `1|2|3`; classic Easy (4) is honored at runtime if the UI casts.

**Integrator**: none blocking.

## Stage 2e — store core/persist/migrations/derived/testing

**Files written** (`/Users/christopher.bradford/japanlangrace/src/store/`): `defaults.ts`, `migrations.ts`, `persist.ts`, `store.ts`, `index.ts`, `testing.ts`, `derived.ts` + a `.test.ts` beside each (103 tests). Full suite: 42 files / 1855 pass; `tsc --noEmit` clean project-wide.

**API** (ARCHITECTURE §1 / module-plan signatures kept):
- `store` (signals per slice, `meta/seed/now/today/patch/cards/log/session/storage/flush`), `initStore({slot,now,storage,reducers?})`, `resetStoreForTests`, `registerReducer`.
- `persist.ts`: `createPersist(storage, slot, {onState,hooks,compression})` → `read/readSync/write/remove/schedule/flush/bytes/level/state/compact/compressLargest/dispose`; keys exactly as §1; `SHARD_SPECS` (16), `shardIdFor(key, {level?,station?})`, gzip rung (`'gz1:'` + base64, decoded on load).
- `defaults.ts`: `freshSave`, `INTENSITY_PRESETS`, `newPerDayFor`, `STANDARD_NEW_PER_DAY` (matches `learn/governors`).
- `migrations.ts`: `migrateMeta/Shard/Log`, `applyRedirects`, `MigrationError`, `CURRENT`.
- `testing.ts`: `makeTestStore`, `card`, `MemoryStorage` (quota), `captureEvents`, `deepMerge`, `testSave`.
- `derived.ts`: module-plan names (`dueCount, isBacklog, beltEligibility, stationProgress, forecastCounts, knownVocabCount, projectedArrival, peraperaNow`) + `currentBelt/currentStation/knownCounts/itemBeltOf/peraperaIndex/projection/xpToNextLevel/streakState`.

**Deviations/additions**
1. Kanji ids carry no level: `cards.set(k, t, {level?})` optional hint; otherwise shard = level of `progress.station` (bucketing only; lookups are map-based). Chunk cards live in `vocab.*` (id-routed), not `misc`.
2. `projectedArrival(..., log?)` takes an optional 6th `LogEntry[]` to measure realized introductions.
3. Reducers: `store.ts` has an empty `REDUCERS` list — integrator adds `startXp/startStreak/...` there (or via `registerReducer`); `index.ts` has commented export lines for backup/xp/quests/badge-defs/wallpaper-defs/ledger.
4. Compaction: old daily rows collapse to one row keyed at the month's first EpochDay (shape unchanged); old ledger entries → `ledger.monthly`.
5. `streak.lastDay=0`/`quests.day=0` are "never" sentinels.

**Integrator**: `peraperaNow` approximates rolling windows (読 uses `speedReadBestCpm`) until `perapera.ts` lands; `streakState` should defer to `streak.ts flameState`.

## Stage 2f — pipeline scripts (validate/assign/index)

**Files written** (`/Users/christopher.bradford/japanlangrace/`): `scripts/validate-content.ts`, `scripts/assign-stations.ts`, `scripts/build-content-index.ts`, their `*.test.ts` (59 tests, all pass; full suite 1914 pass), fixtures `scripts/__fixtures__/good/**` + `scripts/__fixtures__/plan-good.json`. `package.json` scripts set as specified (no prebuild); `.github/workflows/deploy.yml` node 24 + `content:index` step; deleted stub `scripts/validate-content.mjs`. `tsc` clean for `scripts/`.

**API**
- `validate(root, {components?, denylist?, strict?, only?, fixTokenIds?}) → {failures, warnings, linked, files, bundles}`, `formatReport`, `moraCount`. CLI: `[--strict] [--json] [--only] [--fix-tokenids] [--root]`, exit 1 on failures.
- `assign(root, plan, {write?, allowlistsDir?}) → {bundles, allowlists, report, assigned, missingFiles, linked}`; also `bundlesFromCorpus`, `linkStories`, `buildMatchPool/matchToken/FUNCTION_TOKENS`, `topoSortKanji`, `placeComponents`, `stringifyJson`, `CAST_NAMES`.
- `buildIndex(root, version, {generatedAt?, check?})`, `writeIndex` (keeps `generatedAt` when unchanged → idempotent), `listContentFiles`.

**Deviations/additions**
1. The linker (tokenIds) runs inside `content:assign`, since `content:all` indexes before `validate --strict`; strict/`--fix-tokenids` validate also writes (no-op afterwards).
2. 300 KB cap (raised from 120 KB on 2026-10-17 once the corpus measured 1.3–1.85 KB per vocab item) applies to hand-written files only: cumulative `surfaces` makes late bundles ≈400 KB (loader owner note).
3. Kana files carry no `level` (guide §1) → manifest `level: null`.
4. Components appear only via `componentIds`; `_meta/components.json` is listed in those stations' `files`.
5. `--strict` = release: V34/V36 fail until Pass 3/quotas; V14 "≥2 examples" warns in strict.
6. V15 14-word warning only for story lines (no tokenizer).
7. Robustness-fuzzed (780 malformed variants, no crashes).

**Integrator**: real corpus validated read-only (`_meta/components.json` passes, denylist absent → W). Assign/index not run on real corpus; `content:index` (hence deploy) fails until `content:assign` has produced `stations/`.

## Stage 3 — integrator (learn/apply, reconciliation)

**Stage 3 result** — `tsc --noEmit` clean project-wide; `npx vitest run` 46 files / 1944 pass (1 pre-existing skip); `npm run build` OK; `node scripts/validate-content.ts` exits 0 (1 WARN: denylist absent).

**Written**
- `/Users/christopher.bradford/japanlangrace/src/learn/apply.ts` + `apply.test.ts` (30 tests).
- `/Users/christopher.bradford/japanlangrace/docs/CHANGELOG.md` (created, 3 entries); ARCHITECTURE §1 flag list and §5 rep loop updated.

**Reconciled**
- `CardFlag.recheck = 16` added to `shared/store-types.ts`; `queue.ts RECHECK_FLAG` now aliases it.
- `content/loader.ts` re-exports `ContentItem` (type-only) so §3's import path works.
- Stage 2 had already left tsc/tests green; no export-name mismatches remained between `learn/index.ts`, `store/derived.ts` and `shared/ui`.

**`@/learn/apply` exports**
- `recordAttempt({sessionId, step, result, boss?, judge?, pretest?, firstRead?, kind?, item?, keys?, speedRingShown?, fast?, kiai?, repIndex?, rng?})` or `recordAttempt(step, result, ctx)` → `StepResult` + `card prev itemId kind facet promoted{from,to} firstProd mature grade stepOffsets unlocked nemesis archived logged recheckSet implicitApplied kiaiState? kiaiResult?`. Emits `attempt:graded`, `item:promoted`, `kiai:entered`; `xpDelta` = `xp:gained` B emits synchronously.
- `recordImplicit(g, {emit?})` (card+log+promotion, never `attempt:graded`; `dueWithin`), `introduceItem(itemId, kind, station)` → created keys, `markKnown(itemId, kind)` (既知; kana → `profile.kanaKnown`), `retireItem(itemId, retired?)`, `defeatNemesis(itemId)`; constants `IMPLICIT_DUE_WINDOW FAST_FACTOR RECENT_LAPSE_DAYS IPPON_DIFFICULTY`.

**Semantics E/F must know**: learning-step miss on a review-state card is scheduled as learning (no lapse); arcade miss sets flag 16, a `params.recheck` step clears it; `stepOffsets` tells the runner the +3/+10/+5 re-queue; pass `kiai` to get real combo facts; pass `keys` (registry empty in tests → `'none'`).

**CHANGELOG entries**: (1) `CardFlag.recheck=16`; (2) `recordAttempt` optional `kiai` runs `kiaiStep` internally, extended return, new `retireItem`/`defeatNemesis`, `markKnown` writes `kanaKnown`, `recordImplicit` no `attempt:graded`; (3) `ContentItem` lives in `types.ts`, re-exported by `loader.ts`.

**Left for integrator**: `store.ts REDUCERS` still empty (B's xp/streak/quests modules not yet written); `content:index`/deploy still need `content:assign` output.

## Review round 2 (2026-10-17) — contract-tier notes

Round-2 changes that consumers must read the real exports for (the CHANGELOG lines carry the dates; `docs/BUILD_STATUS.md` → "Review round 2" the ledger):

- **ExerciseFrame hints.** `ExerciseFrameProps.onHint` is legacy and never called. A drill registers its reveal through `useExerciseKeys({ onHint })` (D's `useDrillKeys` forwards it); the frame's `?` key and footer Hint button call the LAST registered set's `onHint` and are hidden when none is registered. A set with `onHint` alone is transparent to 1–9 / Enter / Space, so register it beside a child `ChoiceGrid` / `TextAnswer`, never as a second keyed set. Withdraw it (`undefined`) once used. The speed ring shows whenever `timer` is set outside Zen; `step.timed` only makes expiry a hard timeout.
- **`NAME_MAX_GLYPHS = 24`** lives in `src/shared/store-types.ts` next to `Profile` (not `catalog.ts`) and is re-exported by `@/store`; `shared/jp.clampGlyphs(s, max)` is the one cutter (onboarding, `fillMeta`, `art/wallpapers/data.ts normalizeData`).
- **`KanaInput.maxLength`** caps the resolved kana in code points in the IME path only; it sets no native `maxlength` attribute (UTF-16 units of kana + pending romaji would block `shi` at the boundary).
- **`cards.dueOn(day, o?)`** returns due reviews: state-0, archived and Kaiden cards are excluded unless `o.includeNew` opts them in (same predicate as `store/due.isDueReview`, `derived.dueCount`, `learn/queue.dueCards`). `effectiveNewPerDay(settings, belt)` is exported from `@/store` (`store/defaults.ts`) and is the one new-item-mix rule; `session/pickers.ts` re-exports it.
- **Store quest gates** (`@/store`): `setQuestGates(day, closed)`, `questClosed(id, day)`, `revalidateQuests(store)`, `resetQuestGatesForTests()`; `PickOptions.canDo` / `eligibleQuests`' fourth parameter is the pure availability gate. The `session:started` reducer revalidates. No session-layer caller exists yet, so the gate is inert until E declares `learn-scroll` / `michikusa-one` closed from the Dojo feed.
- **Listening Arena.** `DICTATED_MIN_RATE = 1` (`src/input/listening/ListeningArena.tsx`): a dictation in the Good band at a rate ≥ 1× writes `profile.dictatedSentence` (plain surface, newest wins; the art tier cuts it to `SENTENCE_MAX_GLYPHS = 96`, the store to 500). Since round 2c the sessions' Sentence Dictation drill (`src/exercises/listening/SentenceListen.tsx`, which exports its own `DICTATED_MIN_RATE = 1` because D cannot import `src/input`) writes the same field under the same conditions — Good band, no hint, fewer than 2 replays, rate ≥ 1× — so the Waveform kakejiku fills from sessions as well as the Arena. The pure helpers (`SET_TARGET`, `SET_MIN_LINES`, `SET_MAX`, `REPLAY_BUDGET`, `DICTATION_MAX_MORAE`, `JA_CHOICES_FROM_STATION`, `RELISTEN_DELTA`, `IMPLICIT_WINDOW_DAYS`, `PASS_RATIO`, `isStoryItem`, `voiceSlots`, `slotFor`, `relistenRate`, `buildListeningSet`, `gradeDictation`, `implicitListenGrades`, `ListenItem`, `SetOptions`, `DictationGrade`) now live in `src/input/listening/set.ts` and are re-exported from `ListeningArena.tsx`, so existing imports (tests, E's builder) are unchanged.
- **Art barrels.** `@/art` (boot) exports only `DojoScene`, `CeremonyHost`, `MonCrest`, `GoshuinStamp`; `@/art/studio` carries `renderWallpaper`, `WALLPAPERS`, `exportPng`, `download`, `canRender4k`, `exportSizes`, `filenameFor`.
- **Scripts.** `build-content-index.ts` derives `contentVersion` (`c-` + 10 hex sha256; `--version` / `CONTENT_VERSION` override), keeps `MAX_FILE_BYTES = 300 * 1024` and warns on station entries over 1 MiB; `validate-content.ts` is V01–V40 (V37–V40 warn only; V40 = `unlocksForms` with nothing to conjugate in the cumulative allowlist, needs bundles) and keeps its own `DEFECTIVE_VERB_FORMS` table for V26 (not an import of the engine's `DEFECTIVE`). Round 2c: the token → item matcher lives in `scripts/linker.ts` (shared by `content:assign` and the validator; `assign-stations.ts` re-exports it) and links inflected forms of allowlisted verbs and of the `aux` です item (します, いった, きた, ではありません …) — a kana token that is only the reading of a kanji word yields to a verb form (きた → 来る, not 北) — so V20's "missing from `vocabIds`" / 60 % warnings exempt auxiliary spellings (function tokens and kana inflections of いく くる いる おる ある おく みる しまう くれる もらう あげる する); V18 no longer warns on `pitchConfidence: "high"` (the post-pass's mark).

## Design 08 — contract-tier notes (2026-10-18)

The listening program (`docs/design/08-listening-and-audio.md`) as shipped: the contract tier (7ddfd0f), runtime waves A and B, the content fleet's Pass 4 / 4b and the pipeline pass. As everywhere in this file, the real exports win over the plan text; the CHANGELOG's 2026-10-18 sub-list carries the dated lines.

- **Lead decisions this wave.** (1) `POOL_FILE_BUDGET_BYTES` = 256 KiB (`scripts/build-content-index.ts`) is a **hard** limit — `content:index`'s default check throws a `BuildIndexError` naming the file, its bytes and the budget (`oversizePools`; `BuildIndexOptions.poolFileBudget` for tests) — and `kana` stays in `PoolRef` because Radio reads it. (2) The plan's pool acceptance "vocab examples ≈ 9,362 ± 6 %" is amended to ≈ 8,700 ± 6 % (the corrected linker rule; landed 8,710). (3) `docs/AUDIO_PACK.md` §8's deviations are **accepted**: `manifest.files[]` entries carry no `sha256` (the `files.json` sidecar does; the name carries sha8), the station-index warning threshold is 64 KB, the manifest budget is ≤ 256 KiB raw (`MAX_MANIFEST_BYTES`; a three-tier pack measures ≈ 214 KB, accepted the same day over splitting `files[]` per belt; the render only warns). (4) The 耳 cap steps are `EAR_CAP_STEP_HOURS = [7.5, 15]` (70 below 7.5 h, 85 below 15 h, 100 from 15 h), `REACHABLE_IN_APP_HOURS = round(DISTINCT_AUTHENTIC_HOURS × 4.5)` with `DISTINCT_AUTHENTIC_HOURS` = 4.0 re-pinned from the landed corpus (walks to 4.02 h, inside the 0.15 tolerance) → **18**. (5) `Progress.listenedAt` is **not** added: `Progress.arenaAt` (Arena-only writer, passed sets only) plus the least-recently-heard order of `progress.listened` is the shipped shape, `ARENA_RECENT_DAYS` = 14 (`@/learn`, `src/learn/pool.ts`) the one 14-day constant. (6) Same-day app `listen` rows from `listen:played` coalesce into one row (tenths). (7) `--listening-release` joined `content:all`'s strict step once it reported 0 F, and the same gate is CI's `content:validate` step in `deploy.yml`. (8) The minimal-pair っ rule "never before ー or ん" and the ローン → どーん same-mora-count fallback stand (nothing is rendered yet). (9) The 14-day "worked on recently" window keys off **passed** Arena sets only; `backup.mergeLedger` prefers the larger side per (day, kind) for app rows.
- **The pool `knownAt` rule** (`scripts/linker.ts buildPools`, design 08 §4): a sentence enters the pool of `knownAt = max(owner station, stations of its ids)` — an example never before its item's station even when its words are all older, a story line never before its text's station (`max(text station, stations of its ids)`), and an example the segmenter only covers with a later pool's surfaces at that pool's station; a sentence with an unlinked content token enters no pool (4,065 examples, `docs/listening-report.md` §5). Story lines enter by their writers' `tokenIds`, examples by `linkSentence`; `linkSentence(...).unknown === 0` is the arbiter of V46. `PoolRef.morae = speechMorae(kana).length`. Landed: 53 pools, 16,188 refs (5,947 story lines · 1,531 grammar · 8,710 vocab), largest Station 43 at 178 KiB / 583 refs.
- **One mora body.** `speechMorae(kana)` / `RE_NOT_MORA` in `src/shared/jp.ts` (small kana folded; `、。！？「」『』〜…・` and whitespace dropped) is what the validator's V41 `lineMorae` (≤ 22, `PIECE_LINE_MAX_MORAE`) and V18 `moraCount`, the linker's pool `morae`, the clip indexes' `m` / `c` cues (`scripts/audio/indexes.ts moraTotal` / `clauseBoundaries` over one `spokenKana` string, so `c[last] === moraTotal`), the Arena's clause cut (`karaoke.ts speechMoraSplit` / `speechMoraCount`) and `SentenceListen` all count. `speechMorae` means the shared mora array tree-wide; karaoke's count is `speechMoraCount`. `~` (the NFKC fold of ～) joins the clause marks.
- **`Progress.arenaAt` vs `listenedAt`.** `arenaAt?: Record<string, EpochDay>` = text id → epoch day of the last PASSED Arena set; written only by the Arena (same `store.patch` as the `progress.listened` append; the Ear Walk — `storyId: null` — and a failed set write nothing), read by Radio (`arenaRecentIds(progress.arenaAt, today)`: never cold, first among the re-hearings; `ARENA_FUTURE_SLACK_DAYS` = 1 ignores a stamp more than a day in the future; `loadRadioInputs(loader, { station, listened, arenaRecent?, clips? })` fetches those ids ahead of the `REHEAR_LOAD_MAX` 12 cut) and by the builder (`nextToHear(xs, listened, day, arenaAt?)`: closed while another candidate is open; `REHEAR_DAYS` is `ARENA_RECENT_DAYS`). `fillMeta`: id-like keys (`ID_LIKE`, ≤ 64 chars), finite non-negative integer days, anything else dropped, a non-object or an empty remainder REMOVED (absent, never `{}`), capped at `ARENA_AT_MAX` 1024 keeping the newest days; `mergeSaves` takes the per-text max day. A Radio re-hearing moves its id to the back of `progress.listened`, so that array is both a heard-set (`includes`) and a least-recently-heard order (`byLastHearing`; `lastHeardGenre` skips the Radio's kana-track ids).
- **The ledger coalescing rule** (`src/store/ledger.ts`): `listen:played` → `playedMinutes(seconds)` = `seconds / 60` to a tenth (`MINUTE_DECIMALS` 1; `sanitizeMinutes` drops < 3 s) through `withCoalescedEntry(l, e)`: when the row a new row would follow — the last row dated today or earlier; a row dated after today is skipped, never merged into — is today's `listen` / `app` row without a note, the tenths are added into it, else the row is appended; `listening:set` and `story:read` rows stay whole minutes (`wholeMinutes`) and always append; a track after an Arena set merges into the set's row. `ledger:entry` still carries each track's own minutes; `xp.ts` ignores `source: app`. `backup.mergeLedger`: app rows (source app, no note) per (day, kind) — the side with the larger sum keeps its rows, tie → this browser's; outside and noted rows union by identity. Barrels: `@/store` exports `playedMinutes`, `sanitizeMinutes`, `wholeMinutes`, `appListeningHours`, `weekAppMinutes`; `@/store/derived` exports `EAR_CAP_STEP_HOURS`, `EAR_CAP_STEPS`, `EAR_GOAL_HOURS`, `REACHABLE_IN_APP_HOURS`, `DISTINCT_AUTHENTIC_HOURS`, `authenticListeningHours`, `appAuthenticHours`.
- **The honesty strings.** Vocabulary everywhere a learner meets a voice: *synthetic voice (VOICEVOX)* / *device voice* / *text only*; never *recorded*, *native*, *human* or *real* for a voice (`src/i18n/banned.test.ts`). `S.explainEar`: "Listening tier {tier} of 5 at {acc} % dictation accuracy. Synthetic: every voice in the dojo is a VOICEVOX character voice. The ledger's outside hours are real people."; `S.explainEarCap {cap, goal, app, ext, reach}`: "Held at {cap} until {goal} h of authentic-style listening: {app} h in the dojo (bridge, casual talk, news, lectures at full speed, understood) + {ext} h outside so far. The dojo alone can carry you to about {reach} h; the rest is the world." with `goal` = `EAR_GOAL_HOURS` 15 and `reach` = `REACHABLE_IN_APP_HOURS` 18; `S.explainEarComp {passed, sets, rate}` and `S.explainEarTier {tier, rate}` (`src/store/defs-strings.ts`, quoted in design 08 §12). The honest-share paragraph (`src/records/strings.ts`, `src/app/pages/strings.ts`) says "about 24 hours of sentences and texts, plus about 13 hours of word and phrase clips … about 70–90 hours"; the landed corpus measures 19.6 h / 11.6 h under the report's morae estimator — re-pinning the copy is a shell change (tests assert 24 and 13). The install nag and Settings' `packSpeaks` read `packWillSpeak(a, packChosen)` = `packChosen && (a.packReady || audioSourceOf(a) === 'clips')`, `packChosen` = `settings.audioSource !== 'device'`; the `source === 'clips' && !packChosen` edge therefore reads as "device voice next" on Onboarding / Library / Settings — changing that reading means changing `packWillSpeak` itself (contract tier). The dead `onbVoiceTitle` / `onbVoiceBody` / `onbVoicePlay` strings are gone.
- **The ClipPlayer surfaces** (`src/shared/audio.ts`, implemented by `src/audio/clips.ts`). `AudioService.clips?: ClipPlayer` (optional like `canSpeak`; absent on `nullAudio` and on a build without a pack); `ClipPlayer { ready: Signal<'unknown'|'ready'|'absent'>; info: Signal<AudioPackInfo|null>; loadLevel; loadStation; prefetchStation; cueFor(key, { rate?, speaker? }); cueForText (sentences and lines only); kanaTracks(); play(cue, ClipPlayOptions): ClipPlayback; unlock; dispose; cacheUsage; download(belt, onProgress?); remove(belt) }`; `ClipPlayOptions { rate, volume, clause?, wholeTrack?, onProgress?, onPlayed? }`; `ClipPlayback { done, stop, pause?(), resume?(), position?() }` — the three optionals are implemented on every `clips.ts` playback (resume continues from the media position; `done.seconds` counts both halves once in media seconds; `stop()` while paused resolves with the seconds heard; `position()` reads without firing `onPlayed`), and a surface calls `pause?.()` and falls back to `stop()` + replay when a double lacks them. `storyEntry` honours `whole: null` (no Radio track for a text with a skipped line; never synthesised from the line cues). The idle `AudioService.source` is a derived computed (pack `ready`, `settings.audioSource`, voices) until the first `speak()`; `clipFor(key)` applies `speak()`'s gate (`packChosenIn(settings)`); `canSpeak = (hasJaVoice || (packReady && settings.audioSource !== 'device')) && audible`. `servicesVersion: Signal<number>` is bumped by every `installServices()` / `resetServices()`; `src/app/hooks.ts useAudioService()` / `useClipPlayer()` read it in render, and `main.tsx installAudio()` bumps it on every outcome (`installServices({})` on a failed audio boot). `StoryListenResult` (`src/input/reader/StoryReader.tsx`) carries **no** `ledgerLogged`: the store's `listen:played` reducer owns the Read-along row and `StoryPage` never logs the listen path (the read path keeps `StoryReadResult.ledgerLogged`). Data saver: `saveDataRequested(nav?)` (`src/shared/audio.ts`) is the one body; `@/audio`'s `dataSaverOn(settings?, nav?)` = `settings.dataSaver || saveDataRequested()` and `prefetchAllowed()` its negation; `SettingsPage.saveDataRequested` and `audio/clips.saveDataRequested` are re-exports. `installAdvice(a, ua, s?)` gained an optional settings parameter (defaults to the live store).
- **Minimal pairs.** `src/learn/distractors.ts synthesizeMinimalPair` (Node-importable; `scripts/audio/verify.ts` re-exports it for the `<itemId>#pair` clips): っ removed when present, else inserted before the first mora at index ≥ 1 that is not ー / ん / っ; a word with no such mora gets a same-mora-count near miss (consonant toggle on the first mora, else ん ↔ ー on the last special mora, else drop one ー); single morae byte-stable. `resolveParams(ctx, 'minimal-pair', item)` sets `distractorIds: [partner.id]` only for a real loaded partner, so the drill plays both halves from one source; `PlanContext.pools?: readonly ListeningPool[]` is native in `src/session/context.ts`.
- **Pipeline.** `npm run content:all` = validate → assign → index → `content:report` → `content:validate -- --strict --listening-release`; the gate reports 0 F on `c-22578c2f0f` (W: V38 29, V46 1,244 at Stations 16–53) and the tree is byte-stable under a second run. `scripts/audio/*.ts` may import `src/shared/speak-text.ts`, `src/shared/jp.ts` and `src/learn/distractors.ts` (ARCHITECTURE §0); `MAX_LEVEL_INDEX_BYTES` 350 KB (fails), `MAX_STATION_INDEX_BYTES` 64 KB (warns), `MAX_MANIFEST_BYTES` 160 KiB (warns). `cast.json`: 62 labels, 22 characters, 渡辺さん 45 (東北イタコ). Not in CI: the release gate (`deploy.yml` runs validate → index → `audio:fetch -- --optional` → test → build → `audio:check -- --optional`); the pool hard limit IS enforced there through `content:index`.
