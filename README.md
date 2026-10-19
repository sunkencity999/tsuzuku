# TSUZUKU（つづく）— To be continued. Every day.

A static, offline-friendly web app that takes an English speaker from zero to fluent Japanese
along the 53 stations of the old Tōkaidō road — kana at Shinagawa, N1 at Kyoto, and an
open-ended Dan road beyond. It is a game on the outside (belts, combos, Gatekeeper bosses,
Mon badges, collectible procedurally-drawn wallpapers) and a spaced-repetition engine on the
inside (FSRS-5 with separate schedules for receptive and productive knowledge).

Hosted on GitHub Pages. No backend, no accounts. All progress lives in your browser's
localStorage with one-click JSON export/import.

## The road

| Belt | Stations | Level | What you train |
|---|---|---|---|
| White | 1–3 | kana | hiragana, katakana, Gojūon Fighter arcade |
| Yellow / Orange | 4–15 | N5 | first 800 words, 100 kanji, 90 grammar points, Tabi Nikki travel diary |
| Green | 16–24 | N4 | reading becomes the main XP source ("Second Wind") |
| Blue / Purple | 25–38 | N3 | the Plateau Arc: native-bridge texts, register switching, aizuchi |
| Brown | 39–46 | N2 | Beyond the Wall |
| Black (初段) | 47–53 | N1 core | Shodan Shinsa at Sanjō Ōhashi |
| Dan road | — | beyond | keigo, natural speech, dialect awareness, monologue marathons |

Every station ends with a **Gatekeeper** (関守): a four-phase mastery check, never a time gate.
Belts are awarded by **Shinsa** (審査) exams. Fail one and you get Sensei's Notes and a retake.

## How it teaches

- **Hyakuren (百錬)** — FSRS-5 scheduling per facet (`rec`, `listen`, `prod`, `read`, `comp`, `cloze`, `pitch`).
  An item cannot reach Black until you can *produce* it.
- **Speed trained apart from accuracy** — timers and combo bonuses touch only mature items (stability ≥ 14 days).
- **Comprehensible input** — 137 graded stories and dialogues plus 100 audio-first listening pieces (237 texts), written against
  each station's known-word allowlist, with furigana fog, tap-to-gloss, comprehension checks, and a serialized travel diary (旅日記).
- **Listening** — an in-app voice pack of synthetic VOICEVOX character voices (pre-rendered at build time, fetched into the
  build as a release asset, never a dependency): a Listening Arena with karaoke-timed transcripts, a Read-along reader, the
  茶屋ラジオ Radio that plays only sentences made of words you already know (screen off, with the ledger counting), and
  53 generated sentence pools graded at your live known set. Every voice says it is synthetic; the app works without the pack
  through your device's voice, and the Perapera 耳 axis counts authentic-style listening heard in the dojo or outside.
- **Output every day** — romaji→kana typing (IME built on wanakana), conjugation drills (Form Forge), scramble,
  shadowing and role-play with speech recognition where the browser supports it.
- **Honest numbers** — the Perapera Index (ぺらぺら指数) radar, an Input Ledger for the real listening hours
  no app can supply, and a Projected Arrival date computed from your actual pace.

## How it rewards

- **XP and levels** for effort; **belts** for skill. One never gates the other.
- **Kiai (気合)**: ki meter, combos that forgive misses on new items, Ippon for fast clean hits.
- **68 Mon (紋) badges**, each an original SVG crest with a machine-checked condition.
- **29 Kakejiku wallpapers** — procedural SVG art (torii at dawn, neon alley of *your* words, kanji constellations,
  the Great Wave built from your glyphs) personalized with your data and exportable as PNG for desktop and phone.
- **Goshuin-chō** stamp book, a procedural Dojo home screen that grows with you, and a つづく end card after
  every session. No loot boxes, no streak shaming, forgiveness built in.

## How it looks

The visual language is **Washi & Sumi** — paper and ink (`docs/design/09-design-language-and-motion.md`). The app
should feel like a goshuin-chō (御朱印帳, a pilgrim's stamp book) you own: good paper that takes ink. Its three visual
eras — the Edo-period road and dojo, a 90s arcade, a JRPG status screen — are all *printed*. Edo is the hand: brush, seal,
washi (paper). The arcade is a woodblock print of an arcade: flat inks, bokashi (soft gradient) bands, and a 1 px
misregistration where a lesser design would put a glow. The JRPG status window is the print's cartouche, its notched
frame a kentō registration mark. Three eras, one press — they differ in tempo, not colour.

- **Two governing rules.** *Effort makes noise; the clock never does*: the brush, the seal and a graded answer may
  sound; arrival, the day roll, a season boundary and a theme change are silent (kept by construction — no arrival,
  theme, calendar or day-roll module imports the sound engine). *Nothing glows in Dojo Morning*; in Arcade Night only
  light sources glow, never more than six in a viewport, and a glow never animates (`src/styles/glow-count.test.ts`
  caps the arcade and ceremony stylesheets at six glow rules and checks the Morning tokens are `none`).
- **One room, morning and night.** Dojo Morning and Arcade Night — the light and dark themes — are the same room at
  09:00 and 21:00: identical geometry, only the material tokens change. The paper's tint follows the real calendar
  through the twenty-four sekki (節気, solar terms); the sky and the lamps follow the real hour. Switching theme is
  *dusk falling*, a 400 ms top-down View Transition in which the sky darkens before the floor; with *Follow the sky* on,
  dusk in your time zone turns the theme and lights the Dojo's lanterns in one wipe.
- **Four display faces, never more than three on a page.** Brush (Yuji Syuku) says one word — a station name, つづく
  (tsuzuku, "to be continued"), the kanji on a hanko (seal); Mincho (Shippori Mincho B1) sets long reading — stories
  and the reader; Pixel (DotGothic16) is the carved label and every small count; Dela Gothic One is the arcade poster
  and "the number that matters". First paint carries 122 KB of unicode-range font slices, under the 250 KB ceiling
  `src/styles/fonts.test.ts` asserts from the files on disk.
- **Seven ink verbs name the motion.** nijimi (滲み, bleed in), kasure (掠れ, dry out), hiku (引く, draw a stroke or a
  bar), osu (押す, press a seal), kawaku (乾く, dry — the Dojo's seal for today stays wet until the 04:00 day roll), meku
  (捲る, turn a page or the theme) and tomosu (灯す, light a lamp). Each animates only `opacity`, `transform`, `clip-path`
  or an SVG `stroke-dashoffset`, each has a reduced-motion form, and `src/styles/motion.test.ts` fails CI on a
  `width`/`height` tween anywhere under `src/` and on any `motion.css` keyframe that touches another property.
- **Pages turn.** Where the browser has View Transitions (and reduced motion is off), a route change is one — with a
  travel direction (forward, back, home, in, out) and shared elements that carry across: the boot ensō (brush circle)
  lands on the Dojo scene, the Road's seal becomes the Station sign, the End Card's つづく brush lands on the hearth,
  the Leave slip's bookmark lands on Resume. Elsewhere the new page bleeds in.
- **Ceremonies share one stage grammar.** Belt, stamp, badge and wallpaper ceremonies run on the same stage tokens,
  exit through the same dry-out, and rasterise their art once as `<img>` data URLs — the belt's name seal is its one
  live SVG filter, the stamp's inline goshuin carries two, and two is the tested ceiling. The belt ceremony's three
  taiko (drum) hits are scheduled from one table in `src/audio/sfx.ts`, which a test pins equal to the picture's phases.
- **It teaches even here.** Japanese in the chrome carries a reading with English beside it. On the Road's station signs
  and in the belt ceremony the reading is romaji while your belt is below Green and kana ruby from Green on (your
  furigana setting applies). The arcade's high-score tables compare you with your own record only.

The spec's lead decisions (`09 §12.1`, 75 so far) and the frame-budget protocol (`docs/design/09-frame-protocol.md`)
record what was measured — a headless stand-in whose rows still fail the 18 ms frame line under a software compositor —
and what is still owed: the manual DevTools run and a ceremony pass. A static prototype of the language lives at
`docs/design/09-prototype.html`.

## Develop

```bash
npm install
npm run dev            # Vite dev server
npm test               # Vitest
npm run typecheck
npm run content:validate   # validate public/content/**/*.json against the writer rules (V01–V46)
npm run content:all        # release step: validate → assign stations (writes `station`, stations/NN.json, listening/pool-NN.json, docs/allowlists) → build manifest.json → content:report (docs/listening-report.md) → validate --strict --listening-release
npm run audio:render -- --tier core --dry-run --fixtures   # the voice-pack pipeline without an engine (docs/AUDIO_PACK.md); audio:pack / audio:publish / audio:fetch / audio:check
npm run build          # dist/ for GitHub Pages (tsc --noEmit && vite build; sw.js is stamped per build)
```

Node 24+ (content pipeline scripts are TypeScript run directly by Node).

## Deploy to GitHub Pages

1. Push to GitHub. In the repo settings choose **Pages → Source: GitHub Actions**.
2. `.github/workflows/deploy.yml` validates content, rebuilds `manifest.json`, fetches the voice pack named in `public/audio-pack.json` when a release exists (`audio:fetch -- --optional`; the site builds and speaks through the device voice without one), runs tests, builds, checks the pack against the content (`audio:check -- --optional`), and deploys on every push to `main`. Run `npm run content:all` and commit its output (`stations/`, `listening/pool-NN.json`, `tokenIds`, `manifest.json`, `docs/listening-report.md`) before the first push — CI never assigns stations.
3. The build uses relative asset paths and hash routing, so it works at `https://<user>.github.io/<repo>/`
   and at a custom domain without changes.

## Repository map

| Path | What |
|---|---|
| `index.html`, `vite.config.ts`, `tsconfig.json` | Vite + Preact shell; relative `base: './'`, hash routing, `VITE_APP_VERSION` from `package.json` |
| `public/` | static files copied as-is: `sw.js` (relative-scope service worker, stamped per build with the cache version and the shell assets; never caches `content/**` or `audio/sprites/**`), `audio-pack.json` (the committed pointer to the voice-pack release; `public/audio/` is fetched by CI and gitignored), `manifest.webmanifest`, `favicon.svg`, `fonts/` (the four OFL faces as 25 unicode-range woff2 slices — base / n5 / n4 / n3 / n2 per family, `rest` for all but Yuji Syuku, and a first-paint `shell` slice for Yuji Syuku and Shippori Mincho B1 (design 09 §3.5); the UI-kanji inventory ships in `base` — plus the OFL texts; regenerate with `scripts/fonts/build-fonts.py`) |
| `public/content/` | the corpus (6,387 vocab · 1,000 kanji · 450 grammar · 238 kana · 237 texts — 137 stories and dialogues + 100 audio-first listening pieces · 212 michikusa): hand-written `kana/`, `vocab/` (N5–N1), `kanji/` (N5–N2), `grammar/` (N5–N1), `stories/` (by level; `stories-sNN.json` and `listening-sNN.json` per station), `michikusa/` (53 stations), `conjugation/` (golden table), `_meta/` (components, denylist); generated by the pipeline and committed: `stations/NN.json` (53 bundles with the cumulative `surfaces` map), `listening/pool-NN.json` (53 graded sentence pools, 16,188 refs), `StoryLine.tokenIds` and `manifest.json` (`contentVersion` derived from the content). Served by the loader's Cache API mirror, not the service worker |
| `scripts/` | content pipeline run directly by Node: `validate-content.ts` (rules V01–V46; V37–V40 warn only, V41–V46 are the listening rules behind `--strict --listening-release`), `assign-stations.ts` (stations, allowlists, POS floors; runs the story linker and writes the listening pools), `linker.ts` (the token → item matcher and sentence segmenter shared by `content:assign`, the validator and the report), `build-content-index.ts` (`manifest.json`; `contentVersion` is `c-` + a sha256 of every content file unless `--version`/`CONTENT_VERSION` overrides it, so the offline Cache API mirror refreshes on any content change; 300 KiB per-file cap, 256 KiB hard pool-file budget, 1 MiB station-entry warning), `listening-report.ts` (`docs/listening-report.md`), `audio/` (the VOICEVOX render → verify → sprites → indexes → manifest → pack → publish pipeline and the CI-side `fetch-audio-pack.ts` / `check-audio.ts`; `cast.json` maps every speaker label to a character — `docs/AUDIO_PACK.md`), `check-components.mjs`; `scripts/fonts/build-fonts.py` regenerates `public/fonts/*.woff2` + `src/styles/fonts.css` (needs fonttools and the OFL TTF sources) |
| `src/main.tsx` | composition root: `initStore` → Perapera snapshot → audio services → exercise registry → `<App>` → router → service worker |
| `src/shared/` | contract tier: store/session/exercise types, event bus, routes, catalog (68 Mon, 29 wallpapers, 17 quests), the audio slot (`ClipPlayer`, `servicesVersion`), `speak-text`, kana IME, `jp` (`speechMorae`), time, `koyomi` (the calendar: 24 sekki, 72 kō, moon phase, sky phase); `shared/ui/` (`Ruby`, `KanaInput`, `ExerciseFrame`, `Feedback`, `JudgeCard`, `TeachOnce`) |
| `src/content/` | content schemas and the 53 stations (`types.ts`), the cached `./content/` loader, ruby parsing, in-memory test fixtures |
| `src/store/` | persistence (slots, shards, quota ladder, migrations), XP/levels, quests, streak and day roll, ledger, weak points, badge and wallpaper definitions, backup import/export, `derived.ts` read-model (Perapera, projection), `testing.ts` (`MemoryStorage`, `makeTestStore`) |
| `src/learn/` | the engine: FSRS-5 scheduler, queue and governors, item belts, Kiai combos, leech/nemesis, conjugation, grading and judge rubrics, distractors; `apply.ts` is the only writer |
| `src/exercises/` | the 26 core drills by family: `kana/`, `vocab/`, `kanji/`, `grammar/`, `listening/`, `fluency/`, plus shared `ChoiceGrid`, `TextAnswer`, `PitchLine` |
| `src/session/` | session planning and running: block builder, runner, Gatekeeper, Shinsa, Kage, Dan road, scrolls, Dojo feed, end card; `pages/` Train · Scroll · Station · Gate · Shinsa · Road · Dan |
| `src/input/` | comprehensible input and output: `reader/` (fog, gloss, comprehension, speed read, Read-along), `listening/` (Arena, Ear Walk, karaoke, 茶屋ラジオ Radio + playlist + Media Session), `speaking/` (shadow, monologue, recorder), `taiwa/` (role play, aizuchi, register), `writing/`, `missions/`; `pages/` Story · Listen · Taiwa · Radio |
| `src/audio/` | the voice-pack `ClipPlayer` (`clips.ts`: content-addressed Opus sprites, explicit Cache API bucket, event-driven timing), the data-saver gate, the device-voice `speechSynthesis` fallback, voices, speech recognition, SFX — installed into the `shared/audio` slot |
| `src/records/` | Records and Ledger pages, Perapera radar, weak-point map, charts |
| `src/collections/` | Collections, Studio and Library pages: Mon grid, Goshuin book, Kakejiku gallery |
| `src/art/` | procedural art: SVG/brush/pixel primitives, Mon crests, Goshuin stamps, `dojo/` home scene (`room.ts` — tatami, wall scroll, lanterns, racks, shōji window and moon; `bonsai.ts`; `flames.ts`, the hearth; `DojoScene.tsx`), `ceremony/` overlays (belt, stamp, badge, wallpaper; the Gate's stone wall), `road/` (Station headpiece, the genkan (doorstep) strip of towns ahead on the Dojo, the romaji → kana reading rule), `motifs.ts` (the road motif kit — pines, torii, lanterns, Fuji — lifted from the wallpaper generators), `wallpapers/` (29 generators), `png.ts` (PNG export) |
| `src/app/` | the shell: `App`, `Layout`, router, theme (incl. the calendar attributes on `<html>` and the dusk View Transition), `transitions.ts` (travel direction, hero pairs, the fallback entrance), `pages.ts` (route → lazy page table), SW registration, `.ics` export; `pages/` Dojo · Onboarding · Settings · Backup · About |
| `src/styles/`, `src/i18n/` | CSS tokens (incl. the `--sekki-pigment` / `--sekki-mix`, `--sky-*` and `--lamp-alpha` hooks that `src/app/theme.ts` writes from the calendar tables in `src/shared/koyomi.ts`), base, components, the generated `fonts.css`, `motion.css` (the seven ink verbs, View Transitions, `.sheet` / `.sign` / `.meter` / `.lantern` / `.tanzaku`) and the arcade print skin; the budget tests `motion.test.ts` (composited-only motion, the CSS byte ceiling), `fonts.test.ts` (first-paint font bytes, the frozen UI-kanji inventory) and `glow-count.test.ts`; UI strings and the banned-phrase list |
| `docs/design/01–09` | the design: identity, progression, sessions, exercises, SRS policy, rewards, architecture, listening and audio (`08`, with `docs/listening-plan.json` as its work breakdown and `docs/listening-report.md` as the generated figures), and the design language and motion system (`09-design-language-and-motion.md` with its binding lead decisions in §12.1, `09-frame-protocol.md` for the frame budget, `09-prototype.html`) |
| `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/CONTRACT_NOTES.md` | binding shared contracts, contract-tier change log, integration notes |
| `docs/CONTENT_GUIDE.md`, `docs/LISTENING_BRIEF.md`, `docs/station-allocation.md` | writer handbook with validation rules V01–V46; the listening writers' brief; the per-station quota plan |
| `docs/AUDIO_PACK.md` | the voice-pack runbook and the pack / index / manifest shapes the clip runtime reads |
| `docs/content-plan.json`, `docs/module-plan.json` | every content file and source module, by owner |
| `docs/BUILD_STATUS.md` | current module/test counts, what each group delivered, known gaps, next steps |
| `docs/design-panel/` | the four original design proposals and judge scores this spec was synthesized from |
| `.github/workflows/deploy.yml` | GitHub Pages CI (Node 24): validate content → build index → fetch the voice pack (optional) → test → build → check the pack → deploy (`content:assign` is an authoring step and never runs in CI) |
| `LICENSE`, `CONTENT_LICENSE.md` | MIT for the code; CC BY-SA 4.0 for the corpus, allowlists and generated art (fonts: SIL OFL 1.1, `public/fonts/OFL-*.txt`); the voice pack's clips are VOICEVOX character audio under each character's terms, credited `VOICEVOX:<character>` |

## License

Code: MIT (`LICENSE`). Content under `public/content/`, the allowlists and the art rendered from them: CC BY-SA 4.0 (`CONTENT_LICENSE.md`, with the attribution line). The four webfonts are SIL OFL 1.1 (`public/fonts/OFL-*.txt`). The voice pack (when fetched into a build) is synthetic VOICEVOX character audio under each character's own terms, credited `VOICEVOX:<character>` in `CONTENT_LICENSE.md` and on the About page — not CC BY-SA content. All art is original and procedural; no franchise material.
