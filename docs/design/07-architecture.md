# TSUZUKU — 07 · Architecture

Stack (fixed): Vite 7 · Preact 10 + `@preact/signals` 2 · TypeScript 5 strict · Vitest 3 · wanakana 5. No other runtime dependencies: FSRS, the hash router, the conjugation engine, the PRNG/noise toolkit and the service worker are all in-repo. Dev-only tools (never shipped): `ts-fsrs` to generate golden vectors, `kuromoji` for the optional tokenizer cross-check in `scripts/`.

> **Precedence.** `docs/ARCHITECTURE.md` and `src/content/types.ts` are the shared contracts and win over this file on ids, file paths, storage keys and type names; `docs/module-plan.json` wins on module boundaries, ownership and phases. Sections §2, §3 and §6 below are kept for the narrative and point there for the details.

## 1. Routes and screens (hash router, `#/…`)

| Route | Screen | Notes |
|---|---|---|
| `#/` | 道場 Dojo (home) | procedural scene, forecast line, Hanko Button (Kata / Kumite / Shugyō), quests, flame, tategaki column |
| `#/onboarding` | 日本橋 Nihonbashi | name — an English input with a katakana suggestion from `app/names`, kana by sound on request, default 無名 Mumei (`02 §1`) — then kana check, pace, honest timeline, voice test |
| `#/train/:mode` | session runner | `kata · kumite · shugyo · kage · weak · rapid · gojuon` |
| `#/scroll/:id` | Scroll (lesson) | also reachable from a station |
| `#/road` | 東海道 Road | 53 stations, stamps, Projected Arrival |
| `#/station/:n` | station page | items, stories, Michikusa, Gatekeeper button |
| `#/gate/:n` | Gatekeeper | boss runner |
| `#/shinsa/:belt` | belt exam | exam runner, Sensei's Notes |
| `#/story/:id` | Tabi Nikki reader | furigana fog, gloss, capture |
| `#/listen/:id` | Listening Arena | |
| `#/taiwa/:id` | role-play | |
| `#/dan` | Dan road | Dōjō Yaburi modules and criteria |
| `#/library` | Michikusa library | |
| `#/collections/:tab` | Mon · Kakejiku · Goshuin-chō | |
| `#/studio/:wallpaperId` | Print Studio | render, personalize, download |
| `#/records` | Records | Perapera radar, Weak Point map, ledger, retention, cpm, Projected Arrival |
| `#/ledger` | 耳目帳 | add/edit input entries, Field Missions |
| `#/settings` | settings | intensity, feel preset, theme, voice, speed tier, furigana mode, rest day, classic grading |
| `#/backup` | export / import | |
| `#/about` | How this game works · 道場の掟 · licenses | |

Router: ~60 lines over `hashchange`, route params parsed by a tiny matcher, scroll restoration per route, `document.title` set per screen.

## 2. Module layout

The authoritative tree is `docs/ARCHITECTURE.md` §0–§8 (tiers, import rule, contracts) and `docs/module-plan.json` (every file, its owner group A–G, API, tests and phase). In outline:

```
src/
  main.tsx · app/ (A: router, pages, Dojo/Onboarding/Settings/Backup/About; names/ — the onboarding `NameField` + the katakana name dictionary) · styles/tokens.css
  shared/     contract tier: store-types · events · catalog · routes · session-types · exercise-types · audio · hash · ids · jp · kana-ime · ui/{Ruby,KanaInput,ExerciseFrame,Feedback,JudgeCard}
  content/    types.ts · loader.ts · ruby.ts · fixtures/           (C)
  learn/      fsrs · scheduler · item-belt · known · governors · intro-policy · queue · grading · judge · kiai · leech · distractors · conjugate · apply   (C, pure except apply)
  store/      store · persist · migrations · xp · streak · day · quests · badge-defs · wallpaper-defs · unlocks · stats · weak-points · ledger · derived (selectors, perapera, projection) · testing   (B)
  exercises/  one component per drill id (D) · session/ (E: blocks, builder, runner, SessionView, Hud, scroll, gatekeeper, shinsa, kage, pages)
  input/      reader · listening · taiwa · speaking · writing · missions (F) · audio/ (F: tts, voices, sfx, stt)
  art/        svg · noise · geom · brush · pixel · color · jtext · png · mon · goshuin · dojo/ · wallpapers/ · ceremony/ (G) · collections/ (G)
  i18n/       strings, banned phrases, architecture lint
scripts/      validate-content.ts · assign-stations.ts · build-content-index.ts · writer-packet.ts   (C; run with `node --experimental-strip-types`)
public/       content/** · fonts/*.woff2 · sw.js · manifest.webmanifest · icons (SVG)
```

`src/learn/**` holds the pure engines (plain data in, plain data out) and is the primary test surface.

## 3. State shape

> **Superseded in part by `ARCHITECTURE.md §1` and `src/content/types.ts`:** ids are hyphen-form (`v-n5-0123`), `Belt`/`ErrorTag`/content types live in `src/content/types.ts`, and the store slices below carry the deltas listed in `ARCHITECTURE §1`. The shape here is the narrative version.

```ts
type EpochDay = number;                       // days since 1970-01-01 at the 04:00 local boundary
type Facet = 'rec'|'listen'|'prod'|'pitch'|'read'|'comp'|'cloze';
type CardKey = `${string}#${Facet}`;         // "v-n5-0123#prod"
// [due, stability(d, 2 decimals), difficulty(1-10, 2 decimals), reps, lapses, state 0-3, lastReview, flags]
// flags bitmask: 1 archived · 2 nemesis · 4 kaiden-lane · 8 learning-step-pending · 16 recheck (arcade miss, re-tested untimed)
type CardTuple = [EpochDay, number, number, number, number, 0|1|2|3, EpochDay, number];

interface SaveMeta {
  schema: 'tsuzuku.save/1'; seed: string; createdAt: number; updatedAt: number; contentVersion: string;
  profile: { name: string; nameKana: string; chosenKanji?: string; belt: Belt; dan: number; level: number; xp: number;
             startedAt: number; tz: string; goals: string[] };
  settings: { intensity: 'casual'|'standard'|'intense'|'custom'; newPerDay: {vocab:number;kanji:number;grammar:number};
              maxReviews: number; retention: 0.85|0.9|0.95; feel: 'zen'|'dojo'|'arcade'; theme: 'auto'|'light'|'dark';
              restDay: number|null; furigana: 'always'|'fog'|'tap'|'off'; jj: boolean; classicGrading: boolean;
              ttsVoiceURI?: string; speedTier: 1|2|3|4|5; speaking: 'auto'|'recognition'|'self'|'off';
              writing: boolean; reducedMotion: boolean; sound: number; crt: boolean };
  streak: { current: number; longest: number; lastDay: EpochDay; totalDays: number; freezes: number; ember?: EpochDay;
            repairs: number; repairWindow?: { start: EpochDay; done: number }; restDaysTaken: number; weekly: number;
            vacationUntil?: EpochDay; emberRestores: number };
  progress: { station: number; stationsCleared: number[]; perfectGates: number; assisted: number[]; gateAttempts: Record<number, number>;
              grudge: CardKey[]; shinsaPassed: Belt[]; shinsaNotes?: { items: CardKey[]; tags: ErrorTag[] } };
  quests: { day: EpochDay; ids: string[]; done: string[] };
  collections: { badges: Record<string, EpochDay>; wallpapers: Record<string, { at: EpochDay; reforges: number; revealed: 0|1|2|3|4 }>;
                 stamps: Record<number, { at: EpochDay; perfect: boolean; assisted: boolean }>; michikusa: string[] };
  kage: { week: number; best4: number[]; wins: number; history: [week: number, score: number][] };
  weakPoints: Record<ErrorTag, { n: number; ewma: number; active: boolean }>;
  ledger: { entries: [day: EpochDay, minutes: number, kind: 0|1|2|3, source: 0|1][]; monthly: Record<string, number> };
  stats: Record<string, number>;                 // flat counters referenced by badge conditions (06 §2)
  medianMs: Record<string, number>;              // per exercise id, rolling
  captured: string[]; bookmarks: string[];
  perapera: { months: Record<string, [number, number, number, number, number]> };
  daily: Record<EpochDay, { reps: number; ok: number; minutes: number; xp: number; input: number }>;  // 3 years ≈ 1,100 rows
}
interface CardShard { schema: 'tsuzuku.cards/1'; kind: 'kana'|'vocab'|'kanji'|'grammar'|'misc'; level: Level; cards: Record<CardKey, CardTuple> }   // sharded by kind AND level from day 0
interface ReviewLog { schema: 'tsuzuku.log/1'; entries: [t: number, cardKey: string, rating: 1|2|3|4, ms: number, exerciseIdx: number, tag?: number][] } // ring buffer 5,000
```

`Belt`, `ErrorTag` and every content type live in `src/content/types.ts`: `KanaItem`, `VocabItem` (with `pitchConfidence`, `collocations`, `definitionJa`, `frequencyRank`), `ComponentDef`, `KanjiItem`, `GrammarItem` (with `unlocksForms`), `StoryItem` (one type for readings **and** dialogues; `kind: 'story'|'dialogue'`, `bridge`, `learnerSpeaker`; lines carry `tokens`, generated `tokenIds`, and for dialogues the writer-filled `options`/`accept`/`mustInclude`/`aizuchiSlot`/`registerTarget`), `MichikusaItem`, `ConjugationGoldenEntry`, `StationDef`/`StationBundle`. There is no separate `ListeningSet` or `Dialogue` type — Listening Arena and role-play reuse `dialogue` stories — and no `Station.gate` field: the Gatekeeper phase spec is the constant in `04 §11`.

## 4. localStorage budget and compression plan

localStorage counts **UTF-16 code units**, so `bytes(str) = str.length × 2`; every figure below is in those bytes. A persisted card is ≈ 51 chars (`"v-n5-0123#prod":[20500,12.34,5.67,12,1,2,20488,0],`) ≈ 102 B.

| Key | Content | Size at Sanjō Ōhashi |
|---|---|---|
| `tsuzuku.meta.v1` | `SaveMeta` (no cards, no log) | ≈ 240 KB (daily rows dominate) |
| `tsuzuku.cards.v1.<kind>.<level>` ×14 | `CardShard`s by kind **and** level (`vocab.n5 … n1`, `kanji.n5 … n2`, `grammar.n5 … n1`, `kana.kana`, `misc.kana`), ≈ 23,700 tuples at ≈ 102 B | ≈ 2.4 MB total; largest shard (`vocab.n3`, ≈ 5,100 cards) ≈ 0.5 MB — a review rewrites ≤ 0.5 MB, not 2 MB |
| `tsuzuku.log.v1` | 5,000-entry ring buffer × ≈ 90 B | ≈ 450 KB |
| `tsuzuku.session.v1` | in-progress session snapshot | ≤ 100 KB |
| **Total** | | **≈ 3.2 MB** of the 5 MB origin quota |

Policy: **warning at 3.5 MB** (Settings shows a storage meter and recommends export), **hard ceiling 4.5 MB** (the log ring shrinks to 2,000, daily rows older than 2 years aggregate to monthly, then the largest shard is stored gzip-compressed via `CompressionStream` and read back through `DecompressionStream`). Writes are debounced 1 s per shard and flushed on `visibilitychange` / `pagehide`; a review touches only one shard. Every read/write is wrapped in try/catch; `QuotaExceededError` opens the export prompt. An unreadable document (meta, card shard or review log) is stashed as `<key>.bak` before it is replaced; if the stash itself hits the quota the key is frozen for the session (original text left in place, level `ceiling`, the shell says progress may not be saving) instead of being overwritten. Numbers are stored with two decimals. `persist.test.ts` measures a synthetic full save (23,700 cards + 5,000 log rows + 1,100 daily rows) and asserts it stays under the warning threshold and that one review's write stays ≤ 20 ms. The key scheme is frozen in `ARCHITECTURE §1` and the same spelling is used by `store/persist.ts`.

## 5. Export and import

- **Export:** one JSON document `{ meta, shards, log }` downloaded as `tsuzuku-backup-YYYY-MM-DD.json`; optionally gzip via native `CompressionStream('gzip')` to `.tsuzuku.json.gz` (≈ 300 KB). Gentle weekly reminder line on the Dojo, dismissible; the 備えあれば badge rewards the first export.
- **Import:** file input → size check (files, text or inflated gzip output over 32 MB are refused before parsing) → schema validation and type-aware repair (`fillMeta`: unions, array elements, record values, string caps; the preview says "repaired") → migrations (`schema` version chain) → **merge preview** (streak = max, XP = max, collections = union, cards = newer `lastReview` wins, ledger = union by day; a browser with no learner trace takes the backup's identity) or **replace**. Import never runs silently; it shows a diff summary first, applies atomically in one batch, and discards the in-progress session snapshot.
- Three save slots (`<key>.<slot>`) are allowed for households; default slot 0.

## 6. Content loading strategy

> **Superseded by `ARCHITECTURE.md §3`, `src/content/types.ts` and `docs/CONTENT_GUIDE.md` §1–§2, §18:** the file layout, the id grammar and the validator rules live there; ids are **hyphen-form**.

- **Layout:** `public/content/manifest.json` (generated) → `stations/NN.json` (`StationBundle`: kana/vocab/kanji/grammar/component ids, story ids, Michikusa ids, the cumulative `surfaces` map, file list — no gate spec; the Gatekeeper phases are the constant in `04 §11`) → item chunks `vocab/n5/vocab-n5-003.json`, `kanji/n4/…`, `grammar/n3/…`, `kana/hiragana.json`, `_meta/components.json`, `stories/n5/stories-s07.json`, `michikusa/michikusa-s07.json`. **Writers emit ≤ 150 items per file** (`_meta/*` exempt); the validator fails above 150.
- **IDs:** `v-n5-0123`, `j-食`, `g-n3-031`, `c-person`, `k-h-ka`, `s-07-2` (stories and dialogues share one kind), `m-07-3`, `cj-0007`, `st-07`; card keys `v-n5-0123#prod`. Station assignment is a field (`station`) set by `scripts/assign-stations.ts` after Pass 1; the manifest maps station → ids so the known-set for any station is computable before Pass 2 writers start.
- **Fetch:** `fetch(new URL('content/…', import.meta.env.BASE_URL + location.pathname))` resolved relative to the page so `base: './'` works at `/<repo>/` and at a custom root. On entering a station the loader fetches that station's bundle and the chunks it references (typically 2–8 files, ≤ 300 KB each — the hard cap in `build-content-index.ts`; measured vocab is 1.3–1.85 KB per item), keeps them in a memory `Map`, and stores them in the Cache API (`tsuzuku-content-<contentVersion>`); the next station is prefetched on idle. A story needs only its own file plus the learner's cards (`StoryLine.tokenIds`); a gloss tap loads the one file that holds the item (`getAsync`).
- **Validator (`npm run content:validate`, CI-blocking, real from day 1):** rules V01–V40 of `CONTENT_GUIDE §18`, from envelope shape and id grammar through ruby reconstruction, token integrity, station-aware coverage (`coverageTargetFor`), dialogue option checks (V27), denylist, dedupe, ±10 % station quotas, byte-identical manifest regeneration (V35 also flags a stale derived `contentVersion`) and the information-only V37–V40 (pos vs verb ending, repeated kanji component, duplicated michikusa card, `unlocksForms` with no conjugable word in the cumulative allowlist). The token → item matcher the validator and `content:assign` share is `scripts/linker.ts` (exact surfaces → generated verb / copula inflections → function tokens → stems). Optional dev cross-check tokenizes with kuromoji and warns on untagged content words.
- **Release trains:** a newer `contentVersion` only adds files or `redirects` ids; learner state references ids only; Dan-rank packs and the N1 kanji/vocab remainder arrive this way without app changes.

## 7. Audio services

- **TTS:** `speechSynthesis.getVoices()` refreshed on `voiceschanged` **and polled every 250 ms for 3 s** (iOS Safari does not fire the event reliably); filter `lang` starting `ja`; rank by a preference table (Google 日本語, Microsoft Nanami/Keita, Kyoko, O-Ren, any `ja-JP` local voice); network voices are marked in the picker (`06 §7` #10); learner may pick. `speak(text, {kana?})` is given the **plain surface** (`toPlain(ja)`) for sentences — kana-only strings segment and accent badly — and kana only for kana items; it resolves on `onend` **or** `onerror` **or** a timeout of estimated duration + 2 s (Chrome often never fires `onend` after `cancel()`), so an awaited `speak()` can never hang a session. Warm-up utterance on first gesture (Chrome first-utterance delay). Utterances split at ≤ 180 chars (Chromium ~15 s cutoff). Queue with cancel-on-navigation. Rate presets 0.75 / 0.9 / 1.0 / 1.1 / 1.25 (speed tiers; Shinsa uses these presets only) plus 1.5 for Dan. Dialogues alternate two voices where ≥ 2 Japanese voices exist; with one voice `pickPair` degrades to the same voice with a rate/pitch offset. No Japanese voice → kana shown at full size, one-time install guide (Windows language pack, macOS Spoken Content, Android TTS data), audio exercises fall back to text; Perapera 耳 marked "(no voice)".
- **SFX:** one `AudioContext`; every sound is `(ctx, t) => void` from `audio/sfx.ts`; muted in Zen and by setting.
- **Recognition:** feature-detect `webkitSpeechRecognition` / `SpeechRecognition`; `lang 'ja-JP'`, `maxAlternatives 5`, `interimResults false`, 8 s cap for shadow lines; `recognize({maxMs, continuous: true})` restarts on `onend` until `maxMs` for the 60–120 s Monologue. Recognizer output is kanji-kana mixed, so `src/input/speaking/scoring.ts` scores against the plain surface, the kana surface and the ruby-mixed variants (per-ruby DP). Fallback chain `recognition → self (MediaRecorder playback + checklist + Judge) → off`; the default is `self` until the learner opts into recognition after the network notice (`06 §7` #10). Speaking is never a hard gate below 三段; XP and badges are identical across paths.

## 8. Procedural art pipeline

Scene graph → SVG string (shapes only) → `Blob` URL → `Image` → `canvas.drawImage` at target size → text layer with Canvas 2D after `document.fonts.load` (webfonts do not render inside an `<img>`-loaded SVG; no `foreignObject`, which would taint the canvas) → optional post pass (Bayer dither, scanlines, grain) → `canvas.toBlob('image/png')` → download: one anchor click on every platform (`<a download>`; on iOS Safari `target=_blank` with a long-press hint — no `window.open`, whose `'noopener'` form returns null by spec) and the object URL is revoked after 30 s (download) / 60 s (iOS tab). Export runs in `requestIdleCallback` with `OffscreenCanvas` where available and a progress ring. The Dojo scene, Mon crests and goshuin use the same `art/` toolkit, so zero raster assets ship. Every generator has a Vitest snapshot asserting identical SVG for a fixed seed.

## 9. Performance budgets

| Budget | Target |
|---|---|
| Initial JS (gzip) | ≤ 250 KB; exercises, art and studio code-split per route |
| Initial fonts | ≤ 250 KB (DotGothic16 subset, Yuji Syuku ceremony subset); print fonts lazy |
| First interaction on a mid-range phone | < 2 s; Dojo scene renders progressively |
| Drill rep latency (submit → feedback) | < 50 ms; FSRS update synchronous |
| Content chunk | ≤ 300 KB each (hard cap; a 150-item N1 vocab file is ≈ 276 KB raw, ≈ 60 KB gzipped on Pages); station entry ≤ 1 MB raw, cached once in the Cache API; opening a story needs only its own file |
| Wallpaper export | ≤ 3 s at 1920×1080; 4K desktop-only |
| Save write | ≤ 20 ms per shard on debounce |

## 10. Offline and PWA

Hand-written `public/sw.js` (no plugin), stamped per build by `vite.config.ts` (`CACHE_VERSION = '__TSUZUKU_BUILD__'` → `<pkg.version>-<sha256 of index.html + asset names>`, and `SHELL_ASSETS` → the build's hashed `assets/**`): on install it precaches the shell and every emitted asset, so the app is usable offline after one visit; the shell is network-first (a navigation response is stored under `index.html` only when it is `text/html`), assets cache-first (a miss while offline answers 504 instead of rejecting); **`content/**` is never cached by the SW** — the loader's Cache API mirror `tsuzuku-content-<contentVersion>` is the one offline store for content and `manifest.json` is stale-while-revalidate; fonts live in a stable `tsuzuku-fonts-v1` cache that `cleanOldCaches` never evicts; the versioned shell / runtime caches are cleared on activate. The update path is `reg.update()` → waiting worker → Layout toast → `SKIP_WAITING` → `controllerchange` reload (only after the learner asked). `manifest.webmanifest` with SVG icons, `display: standalone`, `start_url: './#/'`. The SW is registered with a scope relative to the page so it works under `/<repo>/`. Offline: any Kata/Kumite/Shugyō over cached stations works; TTS works offline where the OS voice is local; recognition requires network on Chromium and falls back automatically.

## 11. GitHub Pages deployment

`vite.config.ts` already sets `base: './'`; hash routing means no 404 rewrites are needed (an optional `404.html` copy of `index.html` is harmless). The existing workflow runs `content:validate`, `test`, `build` on push to `main` and deploys `dist/` with `actions/deploy-pages`. Content lives in `public/content/` and is copied verbatim. There is no `prebuild`; the workflow runs `content:validate` → `content:index` → `test` → `build` → deploy, so `manifest.json` is regenerated (derived `contentVersion`) on every push while `stations/NN.json` and the linked `tokenIds` are authored by `content:assign` / `content:all` and committed (the assigner writes `station` in place, so it is never run in CI). The scripts are `.ts` run directly by Node (Node 24 in CI) so they import `src/content/types.ts` directly. No secrets, no backend, no analytics.

## 12. Tests (Vitest)

FSRS golden vectors and monotonicity; facet unlock and warm start; grading map; Kana Forge table (≥ 300 cases incl. ん/っ edge cases); grader fuzzy and mora diff; conjugation golden table (60 head words: 40 verbs × 20 forms, 20 adjectives × 6 forms, ≈ 903 rows per `content-plan.json`); composer invariants (wave, no repeats within 4 except steps/recovery, ≤ 3 same type, time fitting); kiai rules (dummy, Guard, Block, Recovery); governors; reader coverage and fog; Kage sampling determinism; streak state machine (freeze, rest, Ember, repair, vacation, 4 AM boundary); XP/level curve; badge and wallpaper unlock evaluators (table-driven); art snapshots per seed; persistence sharding, quota handling, migrations and import merge; content validator fixtures; banned-phrase lint over UI strings.

## 13. Build phases

- **Phase 1 (MVP, Stations 0–15, Pass 1 lists):** engines, Kata/Kumite/Shugyō, Scrolls with pretests, Tabi Nikki reader and Listening Arena, Gatekeepers, **Yellow and Orange Shinsa** (`session/shinsa.ts`, `ShinsaView`, `ShinsaPage` are `[P1]`), Dojo, Road, Records with Perapera and Projected Arrival (`store/perapera.ts`, `PeraperaRadar` are `[P1]`), streak suite, Three Kata, Michikusa, 20 badges, 8 wallpapers, export/import, SW, Pages deploy, the content pipeline scripts. **Exercise ids shipped in Phase 1 (exactly):** `kana-flash kana-ear kana-forge gojuon-fighter meaning-guard meaning-recall audio-flash production-forge pitch-ear component-flash component-assembly kanji-read pattern-cloze particle-duel form-forge form-chain scramble sentence-listen listening-set minimal-pair shadow story-read speed-read` — everything `04 §13` unlocks by Station 15 except the four below.
- **Phase 2 (Stations 16–38):** `nemesis-duel`, `rapid-fire`, `role-play` (aizuchi, register switching), `field-mission` with the ledger, Kage, `lookalike-duel`, `transform`, `writing-dojo`, `say-three-ways`, `monologue`, Plateau Arc tools, J-J mode (`meaning-judge`), Blue and Purple Shinsa, remaining badges, wallpapers to 20 (incl. `koi-dragon`).
- **Phase 3 (Stations 39–53, Dan road):** `judgment-call`, Dōjō Yaburi runner, Brown and Shodan Shinsa, FSRS optimizer worker, optional stroke-order add-on (`kanji-write`), all 66 badges and 28 wallpapers.

`docs/module-plan.json` tags every file with the same phases; where this list and the plan disagree, the plan is corrected, not this list.
