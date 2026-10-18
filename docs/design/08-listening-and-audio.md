# TSUZUKU — 08 · Listening and Audio: In-App Listening to Fluency

**Status:** design, synthesised from the listening panel (pedagogy, product/UX, engineering lenses and their judges; 2026-10-17) and revised after the skeptics' pass (feasibility, pedagogy, consistency). Where this file and `01–07` disagree on listening, this file wins; `docs/ARCHITECTURE.md` and `src/content/types.ts` still win on ids, paths, storage keys and type names. Build order lives in `docs/listening-plan.json`.

## 1. Thesis

A learner who starts with zero Japanese should be able to reach fluency with the dojo as the main road and the world as the supplement, not the other way round. Today every voice in the app is `speechSynthesis`, three stations in four hold one dialogue, nothing plays with the screen off, and the Perapera 耳 axis is held at 70 until the learner logs 20 hours of listening *outside*. This design turns listening into three things the app already knows how to make — **content** (new audio-first pieces through the same validator and linker as every text), **mined input** (the 12,774 example sentences, 1,892 grammar examples and 3,268 story lines graded at the learner's live known set) and **a voice** (a pre-rendered VOICEVOX pack keyed by content id, with per-mora timing) — and re-points the honesty copy at what is now true.

Three promises hold throughout: the voices are **synthetic and say so** everywhere the learner meets them (every status chip, header and credit line says *synthetic*; the `(synthetic)` flag stays unconditional); the app **never blocks on the pack** (every surface falls back to `speechSynthesis` per clip, and the site builds with no pack); and the in-app share of the 1,500-hour goal is **stated, not implied** — ≈ 24 h of distinct sentences and texts (plus ≈ 13 h of word and phrase clips that serve drills, not the ledger), ≈ 70–90 h of worthwhile hearing over the road (§12).

## 2. Three sources, one pipeline

All hours below come from one run of `scripts/listening-report.ts` over `public/content` (speech estimate = kana chars ÷ 7 s + 0.5 s per clip; kanji example words deduplicated against the vocab clip they reuse; the T3 figure is the panel's estimate until the report has `definitionJa` lengths). *Distinct* = each text rendered once; *rendered* adds the natural-slow second take of Stations 1–17 sentence clips.

| Source | What | Distinct audio | Job |
|---|---|---|---|
| **Mined sentences** (connected speech) | vocab `examples[]` in the pools 12.4 h (9,362 of 12,774; 17.0 h if all were rendered) · grammar `examples[]` 2.0 h · story lines 4.5 h · michikusa quotes 0.1 h | **19.0 h** | sentence decoding at i+0 / i+1, dictation, Radio, Gatekeeper and Shinsa 耳 |
| **Audio-first pieces** (connected speech) | 100 new `StoryItem`s (`audioFirst: true`, a `genre`), 2 per station from Station 4 | **≈ 4.7 h** | the registers the diary cannot carry: counters, phones, announcements, weather, interviews, news, debate, lectures, essays |
| **Drill clips** (not ledger input) | 6,387 bare words 1.9 h · kanji example words 0.2 h net (2,119 of 2,882 reuse the vocab clip) · kana + `exampleWord` 0.1 h · T3 ear set (collocations 0.8 h, `word + が` 0.4 h, minimal-pair partners, `definitionJa` ≈ 9 h) | **≈ 12.7 h** | Audio Flash, Pitch Ear, Minimal Pair, Kana Ear, J-J reveal |

Connected speech ≈ 23.7 h distinct; drill clips ≈ 12.7 h; **≈ 36 h distinct, ≈ 39 h rendered** with the slow takes. The 137 existing texts (4.5 h) are voiced with one fixed voice per cast member and serve discourse listening, the karaoke transcript and role-play NPC lines.

Render tiers (incremental, content-hash keyed; sizes at Opus 24 kbps ≈ 3.46 KB/s measured):

| Tier | Contents | Hours rendered | Bytes |
|---|---|---|---|
| **T1 core** | 3,268 story lines + pieces as they land · 6,387 vocab words (by id, accent from `pitch`) · kanji example words not covered by a vocab clip · 238 kana + 238 `exampleWord` · 1,892 grammar examples · 178 michikusa quotes · generated kana tracks · natural-slow takes (`speedScale 0.85`) of every sentence clip of Stations 1–17 (story lines 0.9 h + grammar 0.4 h) | ≈ 10.1 (+ 5.2 pieces incl. their Yellow–Orange slow takes) | ≈ 126 (+ 65) MB |
| **T2 pool** | the 9,362 vocab example sentences that are fully allowlisted at some station (the pool, §4) 12.4 h + slow takes for Stations 4–17 ≈ 1.2 h; the 3,412 never-all-known examples are not rendered until rewritten | ≈ 13.6 | ≈ 169 MB |
| **T3 ear** | collocations (5,709 unique, Audio Flash from Green) · `word + が` pitch-contrast variants for the 1,266 `pitchConfidence: high` words · minimal-pair partners that `synthesizeMinimalPair` would otherwise voice through the device · `definitionJa` (4,924, J-J reveal from Station 34) | ≈ 10.5 | ≈ 131 MB |

Total ≈ 490 MB of audio + 32 MB of site, inside the 1 GB Pages limit. T1 ships first; T2 and T3 are release trains of the same pack format.

## 3. Content program by belt

`quota.listening = 2` for every station 4–53 (`StationQuota.listening`; 0 for Stations 1–3), ids after the station's texts (`s-NN-4` / `s-NN-5` through Station 31, `s-NN-3` / `s-NN-4` from 32). **Pieces live in their own files**, `public/content/stories/<level>/listening-sNN.json` (`type: 'story'`, `stations: [NN]`, the same `StoryItem` schema): the existing `stories-sNN.json` files are already 100–153 KB at Blue–Black (1.7 KB per line), and two 60-line Black pieces would push them past `MAX_FILE_BYTES` (300 KiB, `scripts/build-content-index.ts:41`) so `content:index` would throw in CI. The loader needs no change — `src/content/loader.ts:385` already returns every story file whose `stations` include the id's station, and the manifest lists files by `stations`; V43 (§5) checks that an `audioFirst` text lives in a `listening-` file so the 300 KiB budget stays a per-kind guarantee. Lengths are target speech time; "tier" is the speed the piece is first served at (`SPEED_TIER_RATES` 1–5 = 0.75 / 0.9 / 1.0 / 1.1 / 1.25). Every piece obeys V20 coverage (≤ 1 `plusOne` per line, 0.97 through Station 28, `bridge` 0.93), V21 question language (English ≤ Station 15) and the line caps of V15; `number` questions may use digits in English choices only.

| Belt (stations) | Genres (`ListeningGenre`; first station in `GENRE_FROM_STATION`) | Length · speakers · tier · register | Tasks |
|---|---|---|---|
| White (1–3) | no pieces: generated **kana tracks** (§10.5) and the 140 White story lines | 20–40 s · 1 · tier 1–2 natural-slow | Kana Ear, Minimal Pair (3), Radio |
| Yellow (4–9) | `exchange`, `self-intro`, `phone` (one side, 8+) | ≤ 60 s · 1–2 · tier 2 · polite | gist, detail, `number`; every line ≤ 22 morae (dictable) |
| Orange (10–15) | `exchange` with て-form requests, `directions`, `voicemail`, first `casual-talk` | ≤ 90 s · 1–3 · tier 2→3 · polite + casual | gist, detail, `speaker`; Shinsa 耳 0.9× |
| Green (16–24) | `narrative` (told, not read), `announcement`, `weather`, `phone` both sides | ≤ 2 min · 1–3 · tier 3 | Japanese questions (`JA_CHOICES_FROM_STATION`), `inference`, clause dictation (§9) |
| Blue (25–31) | `interview`, `announcement` with changes, `voicemail` with a task, `casual-talk` with contractions (30+), `bridge` (27+) | ≤ 3 min · 2–3 · tier 3→4 | "what must the listener do next", Say It Three Ways restatement, Monologue retell; Shinsa 1.1× |
| Purple (32–38) | `news`, `interview` with two guests, `drama`, `casual-talk` with fillers | ≤ 3 min · 2–3 · tier 4 | J-J stems (34+), `speaker` across three voices, Reduce & Expand (37+) |
| Brown (39–46) | `news` with numbers and sources, `debate` (two positions + moderator), `lecture`, business `phone` in keigo | ≤ 4 min · 2–3 · tier 4→5 | claim vs support, "which speaker said", thesis-clause dictation, Judgment Call; Shinsa 1.25× |
| Black (47–53) | `lecture` (4–5 min), `essay` read aloud (47+), `drama` multi-scene, `debate` | ≤ 5 min · 1–3 · tier 5 | Japanese summary (Writing Dojo rubric), tone, 2-min response (Shodan) |
| Dan | `bridge` texts and Purple–Black pieces at `DAN_RATE` 1.5× until a `listening-dan` pack ships as the first release train | — | — |

**One-sided pieces.** A `phone (one side)` or `voicemail` piece has a single voice, which V25 forbids for `kind: 'dialogue'`, so it is `kind: 'story'` with `narrator` = the caller's cast name (e.g. `narrator: 'ケン'`) and `emotion` per line; `speaker`-kind questions are allowed only in dialogues (V41). From Station 16 `phone` pieces carry both sides and are dialogues.

The writer brief (`docs/LISTENING_BRIEF.md`) adds the `number` conventions, the aizuchi room a `phone` piece leaves, the one-sided rule above, and the rule that pieces are heard before they are read (no kanji puns).

**Pass 4b — the Yellow rewrite.** Own-station vocab examples are all-known at their own station for only 13 / 17 / 29 / 58 / 62 / 91 of 120 at Stations 4–9, so the mined i+0 pool is 2 minutes at Station 4. Rewriting ≈ 450 Station 4–9 examples so that **every item has one example inside the cumulative allowlist ≤ its own station** (V46) lifts the Yellow pool to ≈ 15 min per station.

## 4. Mining: how sentences become graded listening

1. **Segment and link at build time.** `scripts/linker.ts` gains `segmentSentence(pool, plain)` — a greedy longest-match over `pool.exact ∪ pool.forms ∪ FUNCTION_TOKENS ∪ CAST_NAMES` with `matchToken` for stems, hints and counters; unknown runs stay one token — and `linkSentence(pool, ex)` → `{ ids: string[]; unknown: number }`. Calibrated against the stories' own `tokenIds`: 93.9 % per-line agreement, errors balanced (±6 %).
2. **Emit pools, not tokens.** Tokens are **not** written into `SentenceExample` (they would add ≈ 3.6 MB and push 16 item files over `MAX_FILE_BYTES`). `content:assign` writes `public/content/listening/pool-NN.json` (`ListeningPool`, schema `tsuzuku.pool/1`, new `CONTENT_KINDS` entry `'pool'`, listed in `manifest.json` like `stations/NN.json`): one `PoolRef = { ref, ids, kana, morae }` per sentence whose every content token links inside the cumulative allowlist and whose `knownAt = max(station of ids)` equals NN. `ref` is the clip key (§8): `v-n5-0249#ex0`, `g-n5-024#ex1`, `s-07-2#L3`. A sentence with an out-of-corpus token enters no pool (it is a rewrite candidate, reported by `scripts/listening-report.ts`). Pool files are generated, never hand-written, and are **not ContentFiles**: `scripts/validate-content.ts` skips `listening/pool-*.json` in its walk exactly as it skips `stations/` (otherwise V08 fails on the unknown directory), and CONTENT_GUIDE §1 lists the row.
3. **Select at the learner's live known set.** `knownSet` (`src/learn/known.ts`, base-facet R ≥ 0.85 — the same set `gatekeeper.stationSentences` and `params.knownSentences` use) over the pools ≤ station: **i+0** = every id known; **i+1** = exactly one id unknown **and that id's `listen` card exists** and is due within `IMPLICIT_WINDOW_DAYS` (3) or not yet in review state — so the one unknown is the word FSRS wants rehearsed, and `implicitListenGrades` (`src/input/listening/set.ts:172`, which writes nothing for a missing card) records the evidence. An unknown id whose `listen` card has not been created yet (vocab `listen` unlocks at rec S ≥ 2 d, `src/learn/scheduler.ts`) is *not* i+1. Pool sizes are ceilings: in a station's first weeks the R filter admits a fraction of them, so the Station page shows the live count ("28 min you can follow"), never the allowlist figure.
4. **Consumers.** The Ear Walk (§10.4), Radio (§10.2), `sentence-listen` planning (an i+0 example of the item first, then a story line, then the bare word), Gatekeeper 耳 and Shinsa 耳 (own-station pool refs before the bare-word top-up), Shadow warm-up (`knownSentences` reads pool refs instead of `examples[0]`).

## 5. Schema and validator

Additions to `src/content/types.ts` (contract tier; CHANGELOG line):

```ts
export const LISTENING_GENRES = ['exchange','self-intro','phone','directions','voicemail','casual-talk','narrative','announcement','weather','interview','news','drama','debate','lecture','essay'] as const;
export type ListeningGenre = (typeof LISTENING_GENRES)[number];
export const GENRE_FROM_STATION: Record<ListeningGenre, number> = { exchange: 4, 'self-intro': 4, phone: 8, directions: 10, voicemail: 10, 'casual-talk': 10, narrative: 16, announcement: 16, weather: 16, interview: 25, news: 32, drama: 32, debate: 39, lecture: 39, essay: 47 };
export const AUTHENTIC_GENRES: ReadonlySet<ListeningGenre> = new Set(['casual-talk','interview','news','drama','debate','lecture']);
/** Authentic-style text (design 08 §12): a bridge text, an AUTHENTIC_GENRES piece, or a casual dialogue (the 29 existing ones from Station 10). */
export const isAuthenticText = (s: Pick<StoryItem, 'bridge' | 'genre' | 'kind' | 'register'>): boolean =>
  !!s.bridge || (!!s.genre && AUTHENTIC_GENRES.has(s.genre)) || (s.kind === 'dialogue' && s.register === 'casual');
export type LineEmotion = 'neutral'|'warm'|'annoyed'|'sad'|'glad'|'whisper';
export type QuestionKind = 'gist'|'detail'|'number'|'speaker'|'inference';
// StoryItem: genre?: ListeningGenre; audioFirst?: true; narrator?: string (cast name of a speaker-less text's reader)
// StoryLine: emotion?: LineEmotion
// ComprehensionQuestion: kind?: QuestionKind; lineRef?: number (index into lines; a miss replays this line)
// StationQuota: listening: number (0 for Stations 1–3, 2 for 4–53)
// CONTENT_KINDS += 'pool'; ID_PATTERNS.pool = /^pool-(0[1-9]|[1-4]\d|5[0-3])$/
export interface PoolRef { ref: string; ids: string[]; kana: string; morae: number }
export interface ListeningPool { schema: 'tsuzuku.pool/1'; station: number; refs: PoolRef[] }
```

`StoryKind` stays `'story' | 'dialogue'`: a news bulletin, lecture, one-sided phone call or voicemail is a speaker-less `story` with `narrator`; a two-sided phone call or debate is a `dialogue`. `isStoryItem` is shape-based, so the Arena, ledger, XP and badges consume pieces unchanged; `kindOfId`, the loader, `StationBundle` and the manifest need nothing new for pieces. Role-play and Shinsa 口 select `kind === 'dialogue' && (!audioFirst || learnerSpeaker)` (§11): a piece enters speaking surfaces only when its writer sets `learnerSpeaker`, and then V27's learner-line fields apply to it.

Validator rules (CONTENT_GUIDE §18; F = fail, W = warn):

- **V41** F · Listening fields: `genre ∈ LISTENING_GENRES` and `GENRE_FROM_STATION[genre] ≤ station`; `audioFirst` only with `genre`; `narrator` only on `kind: 'story'`; `emotion ∈ LINE_EMOTIONS` (W on a `story` line without `narrator`); `comprehension[].kind ∈ QUESTION_KINDS`, `lineRef` a valid line index, `kind: 'speaker'` only in a dialogue; an `audioFirst` text has ≥ 1 `gist` question and, through Station 15, every line ≤ 22 morae; an `audioFirst` dialogue with `learnerSpeaker` names one of its own speakers (then V27 applies), without it V27 is not required.
- **V42** F in strict mode, W otherwise · Cast: every `StoryLine.speaker` and `StoryItem.narrator` resolves in `scripts/audio/cast.json` (`--cast <path>`; absent file → W "cast check skipped"). W · a cast entry no text uses.
- **V43** F at release, W before · Listening quota and placement: `audioFirst` texts per station `=== quota.listening`; none at Stations 1–3; every `audioFirst` text lives in a `stories/<level>/listening-sNN.json` file and no non-`audioFirst` text does; **V05 amendment:** story sequence ≤ `quota.stories + quota.listening`; **V34 amendment:** texts without `audioFirst` `=== quota.stories`.
- **V44** F · Pools: `listening/pool-NN.json` regenerate byte-identically; every `ref` target exists (`#ex<k>` < `examples.length`, `#L<i>` < `lines.length`); every id resolves; no ref whose sentence holds an unlinked content token. Reported by `scripts/build-content-index.ts` (which has the linker and the bundles) in the same `{file, id, rule, message}` shape, inside its default check — `check` is on unless `--no-check` (`build-content-index.ts:349`), so CI's existing `npm run content:index` step enforces it. CONTENT_GUIDE §18 notes this one exception to "rules are reported by `validate-content.ts`".
- **V45** W · Listening minutes band: Σ speech estimate (kana chars ÷ 7 + 0.5 s per line) of a station's pieces within ±30 % of the §3 band.
- **V46** W during Pass 4b, F at release for Stations 4–15 · Own-station example: every vocab item has ≥ 1 example whose content tokens all link inside the cumulative allowlist ≤ the item's `station`.

CONTENT_GUIDE §1 gains the rows `story | stories/<level>/listening-sNN.json — audio-first pieces (design 08 §3), same schema as stories-sNN.json` and `pool | listening/pool-<NN>.json — generated by content:assign, never hand-written, schema tsuzuku.pool/1, not a ContentFile (skipped by the validator)`. §14.2 gains: "`genre`, `audioFirst` and `narrator` mark a listening piece (design 08 §3); pieces live in `listening-sNN.json`; pieces are heard before they are read — no kanji puns, every `number` question states its unit, every line ≤ 22 morae through Station 15. `speaker` and `narrator` labels must resolve in `scripts/audio/cast.json` (a new local is added there with gender and age before the packet ships). `emotion` only changes the voice style; `lineRef` names the line that answers a question; set `learnerSpeaker` only when the piece should also be a role-play."

## 6. Cast and credits

Voices are build-time VOICEVOX 0.25.2 styles; the app never ships the engine. The cast follows the bible (CONTENT_GUIDE §14.1): ハナ is 24 and the diarist, so **narration is ハナ's voice** — one character carries the kana stage, the vocabulary words, Pitch Ear, the diary and her dialogue lines. Every one of the 46 speakers gets an explicit `voice` in `scripts/audio/cast.json` (`{ name, gender, age, character, style, emotionStyles?, credit }`); nothing is hash-assigned, so two same-gender locals in one dialogue never collide.

| Role | Character (style) | Notes |
|---|---|---|
| ハナ · narration · kana · words · Pitch Ear | 九州そら (ノーマル; `emotion` → あまあま warm, ツンツン annoyed, ささやき whisper) | the first voice the learner meets returns as the protagonist at Station 4 |
| ケン | 玄野武宏 (ノーマル; 喜び glad, 悲しみ sad, ツンギレ annoyed) | 31, cook |
| 田中さん | ちび式じい | retired station master |
| news / announcements (`narrator: 'anchor'`) | 波音リツ (クイーン for formal) | — |
| lecturer / debate moderator (`narrator: 'lecturer'`) | 麒ヶ島宗麟 | — |
| essay reader (`narrator: 'reader'`) | 冥鳴ひまり | literary register |
| adult men (minor) | 雀松朱司, 白上虎太郎, 剣崎雌雄, 中部つるぎ, 黒沢冴白 | assigned per name |
| adult women (minor) | 春日部つむぎ, 雨晴はう, 琴詠ニア, 四国めたん | assigned per name |
| elders | 東北イタコ (second elder) | — |
| children (ミキ, ユウ, ユウタ, リョウ if minors — cast.json decides) | 春歌ナナ, 猫使アル | — |

Only characters from the permitted list are used (never 青山龍星, 後鬼, もち子さん, ユーレイちゃん, No.7, Voidoll, ぞん子). Style ids are resolved from `/speakers` at render time, never hard-coded. Credits `VOICEVOX:<character>` for every character the pack uses live in `public/audio-pack.json` (committed) and `public/audio/manifest.json` (rendered); the About page lists them from the runtime manifest and says "No voice pack in this build; your device voice speaks" when it is absent; `CONTENT_LICENSE.md` gains a section stating that the rendered clips are VOICEVOX character audio under each character's terms with the credit line, not CC BY-SA content.

## 7. The audio pack pipeline

`render → verify → encode → sprites → indexes → manifest → release asset → CI fetch`; every step is incremental, content-hash keyed and resumable. Scripts live in `scripts/audio/` and run on the build Mac (engine at `http://127.0.0.1:50021…50024`, four processes ≈ 2.1× realtime); CI never renders.

1. **Inventory** (`render-audio.ts --tier core|pool|ear --stations 1-17 --engines … --dry-run --fixtures`). Text handed to the engine is `textToSpeak(toPlain(ja), kana)` so the clip and the caller agree. `textToSpeak` and `stripDisplayMarks` move from `src/audio/tts.ts` to a pure contract-tier module **`src/shared/speak-text.ts`** (imports with `.ts` extensions, no store or signals import; `tts.ts` and `@/audio` re-export them), because Node cannot import `tts.ts` today — it imports `'../content/ruby'` without the extension and `{ store } from '../store'`. ARCHITECTURE §0 adds `src/shared/speak-text.ts` and `src/shared/jp.ts` to the modules scripts may import, and `scripts/audio/render-audio.test.ts` asserts `import()` of every consumed module succeeds under Node. Word clips are rendered from the **word surface** with a user-dictionary entry `{ surface: word, pronunciation: katakana(kana), accent_type: pitch }` (`/import_user_dict` once per run; `dictVersion` = sha of the payload), never from bare kana — 301 kana-homophone groups differ in pitch (雨 / 飴, 橋 / 箸).
2. **Clip id** = `sha256(engine|0.25.2|styleId|dictVersion|text|kana|speedScale|pitchScale|intonationScale|accentOverride)` first 16 hex; WAV + verified `audio_query` JSON live in `.audio-cache/<id>.{wav,json}` at the repo root (gitignored — `public/**` ships to `dist/`). Existing clips are skipped.
3. **Verify** every `/audio_query`: (a) morae = `moraSplit(kana)` under the lenient fold (katakana→hiragana, `ー` expanded, は/わ へ/え を/お, ぢ/じ づ/ず, long-vowel canon, `pause_mora` dropped); (b) for a `pitchConfidence: high` word, `accent_phrases[0].accent` equals `pitch` (0 ↔ the mora count in VOICEVOX's convention) — a mismatch sets `accent` in the query and re-verifies. Ladder: user-dict the offending `tokenIds` word → patch the span in the response `kana`, re-query `is_kana=true` → hiragana re-query → **skip** and log to `.audio-cache/skipped.jsonl`. A skipped clip is covered by `speechSynthesis`; silence never ships.
4. **Natural slow.** Sentence clips of Stations 1–17 render twice: `speedScale 1.0` and `speedScale 0.85, pauseLengthScale 1.3` (`rate: 0.85` in the cue). Words and kana render once.
5. **Sprites.** PCM concat in Node with 300 ms pads, one `ffmpeg -c:a libopus -b:a 24k -ac 1 -ar 24000 -application voip` per sprite; cues from sample offsets (±20 ms into the pads). **One sprite per text** for stories and pieces (lines in order: a Radio track plays it edge to edge, the Arena seeks into it); mixed sprites `words-01`, `grammar-01`, `examples-NN`, `misc-01` per station and `kana/*` (≤ 90 s each).
6. **Content-addressed files.** Sprites are immutable and named by their bytes: `audio/sprites/sNN/<storyId>-<sha8>.webm`, `audio/sprites/sNN/examples-01-<sha8>.webm`, `audio/sprites/kana/<name>-<sha8>.webm` (`sha8` = first 8 hex of sha256 of the file). Only the small indexes live under `audio/<audioVersion>/`: `<level>/words.json` (item id → cue; also `id#ga`, `id#pair`), `<level>/sentences.json` (`v-…#ex<k>`, `g-…#ex<k>`, slow cue beside), `<level>/ear.json` (T3 only: `id#col<k>`, `id#def`), `sNN/stories.json` (`s-NN-k#L<i>` → cue with `m` mora and `c` clause boundaries, plus `byText`), `kana/tracks.json`. Budgets: ≤ 350 KB raw per level file (Pages gzips JSON, ≈ 80 KB on the wire; the measured n5 `sentences.json` is ≈ 260 KB with 1,612 examples and their slow cues), ≤ 20 KB per station file. A one-character content fix therefore renames the indexes and *only the sprites whose audio changed*; everything else stays cached on every learner's device.
7. **Manifest** `public/audio/manifest.json`: `{ schema: 'tsuzuku.audio/1', audioVersion: 'a-<10 hex>' (sha over contentVersion + castSha + engine + dictVersion + tiers), contentVersion, engine, dictVersion, tiers, voices, belts: { belt → { bytes, seconds, files } }, files: [{ path, bytes, sha256, seconds, clips }], totals, skipped, credits, reusedBytesShare }` — `reusedBytesShare` is the share of sprite bytes whose paths already existed in the previous manifest, so a release that would re-download everything is visible before it ships (`audio:check` prints it and warns below 0.9 when the content diff is small).
8. **Pack and publish**: one tar per tier `tsuzuku-audio-<audioVersion>-<tier>.tar` → `gh release create audio-<audioVersion>` / `gh release upload --clobber` on `sunkencity999/tsuzuku`; the committed `public/audio-pack.json` names the tag, assets, sha256, bytes and credits.
9. **CI** (`deploy.yml`): `content:validate → content:index → audio:fetch --optional → test → build → audio:check --optional`. `fetch-audio-pack.ts` **streams** each asset to disk (`Readable.fromWeb(res.body).pipe(createWriteStream(tmp))`, sha256 computed while streaming — never `arrayBuffer()` on a 170 MB file), verifies sha256 and bytes, then `spawnSync('tar', ['-xf', tmp, '-C', 'public/audio'])` (GNU tar is on ubuntu-latest and macOS; Node has no tar and the project adds no dependency); `--optional` exits 0 with "audio pack: none — speechSynthesis only". `check-audio.ts` warns on a stale `contentVersion`, fails when an index kana ≠ the content's kana or `dist/` > 900 MB. A `workflow_dispatch` input `audio: false` rehearses the no-pack path. `.gitignore` adds `public/audio/` and `.audio-cache/`. CI cost per deploy with the full pack: ≈ 490 MB download + Vite's copy of `public/audio` into `dist/` + a ≈ 520 MB Pages artifact upload — several minutes longer than today (public repo, so artifact storage is free); `docs/AUDIO_PACK.md` records it.

## 8. Runtime

**ClipPlayer** (`src/audio/clips.ts`, zero dependencies):

```ts
export interface ClipCue { key: string; file: string; start: number; end: number; voice: string; rate: number; morae?: number[]; clauses?: number[]; pitchVerified?: boolean }
export interface ClipPlayer {
  ready: Signal<'unknown' | 'ready' | 'absent'>;            // ./audio/manifest.json → 404 or canPlayType('audio/webm; codecs="opus"') === '' → absent
  loadLevel(level: Level): Promise<void>; loadStation(n: number): Promise<void>; prefetchStation(n: number): void;
  cueFor(key: string, o?: { rate?: number; speaker?: string }): ClipCue | undefined;   // nearest native rate; text fallback for sentences only
  play(cue: ClipCue, o: { rate: number; volume: number; clause?: [number, number]; onProgress?: (t: number, mora: number, clause: number) => void; onPlayed?: (seconds: number) => void }): { done: Promise<{ source: 'clips' | 'none'; seconds: number }>; stop(): void };
  unlock(): void; dispose(): void;
  cacheUsage(): Promise<{ bytes: number; files: number }>; download(belt: Belt, onProgress): Promise<void>; remove(belt: Belt): Promise<void>;
}
```

**Playback and iOS.** WebKit's autoplay unlock is per media element, so `unlock()` — called synchronously inside the existing first-gesture `warmUp()` (`src/audio/tts.ts:471`) — constructs the **fixed pool of 6 `Audio` elements once**, sets each `src` to a tiny silent Opus blob and calls `play().then(pause)` inside the gesture; from then on the LRU only swaps `src` (a blob URL from `fetch('./audio/sprites/…')`, re-wrapped as `new Blob([buf], { type: 'audio/webm; codecs=opus' })` because Pages serves `.webm` as `video/webm`) and never calls `new Audio()` again. `play()` before `unlock()` resolves `done` at once with `source: 'none'` so callers fall back to the device voice instead of hanging. `preservesPitch = true` (`webkitPreservesPitch` on old Safari); `playbackRate = rate / cue.rate`; `currentTime = start`. **Played seconds come from media events only**: `currentTime` deltas accumulated on `timeupdate` (fires with the screen off on both engines), reconciled at `pause` / `ended` / `visibilitychange`; the stop at `cue.end` is driven by `timeupdate` with a `(end − start) / rate + 1 s` timer only as a foreground backstop; `requestAnimationFrame` drives the karaoke sweep and nothing else. A whole-text Radio track never schedules a stop timer — the sprite plays edge to edge and `ended` advances the playlist. Blob URLs bypass the service worker, so Safari's Range/206 requirement for media from the Cache API never arises.

**Clip keys** (`SpeakOptions.clip`): `<itemId>` for a word or kana, `<itemId>#ex<k>` for an example, `<storyId>#L<i>` for a line, `<itemId>#def`, `<itemId>#col<k>`, `<itemId>#ga`. Every caller that holds the item passes the key (`speakWord` → `item.id`; StoryReader, Arena, RolePlay → `${story.id}#L${i}`; the planner sets `StepParams.clip` for `sentence-listen`, `shadow`, `pattern-cloze` examples). Text lookup (`byText`) is a fallback for **sentences** only — never for bare words, since a kana key would collapse homophones.

**AudioService extension** (`src/shared/audio.ts`, contract): `SpeakOptions.clip?`, `speaker?` (the line's speaker label or the text's `narrator`, resolved by the pack to the cast voice; the synth path keeps `voice: 'a' | 'b'` from `voiceSlots()`), `onProgress?`, `clause?: [number, number]`; `AudioService.source?: Signal<'clips' | 'synth' | 'none'>`, `clipFor?(key)`, `packReady?`. Both new members are optional like `canSpeak`, so `{ ...nullAudio, hasJaVoice: signal(true) }` doubles keep working. In `tts.ts` **`speak()` resolves the clip before the synth guard**: `cancelAll` → resolve the cue (clip key / speaker / `byText` for a sentence) → if `settings.audioSource === 'pack'`, `clips.ready === 'ready'` and the cue hits, play it and return → else the existing `if (disposed || !synth || !Utterance) return` guard and the utterance path. Today that guard is the first statement (`tts.ts:506`), which would silence a kiosk browser that has a pack and no `speechSynthesis`. One `cancelAll` owns both queues. `canSpeak = (hasJaVoice || packReady) && audible`, and the **six** direct `hasJaVoice` readers — Settings, Onboarding, Arena, Shadow, the install guide in `src/audio/strings.ts`, and `src/collections/pages/LibraryPage.tsx:84` — read `voiceAudible` plus `source` so a device with a pack and no Japanese voice gets audio without the install nag.

**Caching.** The service worker **does not intercept `audio/sprites/`** (pass-through to the network): a cache-first rule there would grow Cache Storage without bound and outside the learner's control (Radio alone streams up to 45 min of sprites per sitting). `clips.ts` owns the Cache API bucket `tsuzuku-audio-v1` directly: `cache.match(url)` first, network second, and `cache.put` **only** for (a) the current station's idle prefetch set (1–3 MB; skipped under `settings.dataSaver` or `navigator.connection.saveData`) and (b) belts the learner downloaded from Settings. Pruning is a **set difference against `manifest.files[].path`**, never a version-prefix match, so an unchanged sprite survives every release. `audio/manifest.json` and `audio/<audioVersion>/*.json` go through the SW as stale-while-revalidate. "Download this belt's audio" fetches the belt's sprites into the bucket with a progress bar; Settings reports real usage from `cacheUsage()`; the Safari note says downloaded audio may be purged after 7 days without a visit unless the app is installed to the Home Screen.

**Media Session.** Radio sets `navigator.mediaSession.metadata` (title `titleJa`, artist `speaker · synthetic · VOICEVOX:<character>`, album 茶屋ラジオ · station, artwork the station-sign render) and play / pause / previoustrack / nexttrack / seekbackward handlers. With the screen off only whole-text tracks play; sentence sets need seeking and stay foreground.

## 9. Karaoke and timing

A story cue carries `m`: cumulative mora boundaries in ms from `(Σ consonant_length + vowel_length) / speedScale + prePhonemeLength`, pause morae folded into the preceding boundary (measured 6.38 s estimated vs 6.34 s actual), and `c`: clause boundaries as mora indexes at `pause_mora` and 。、. Token *i* owns morae `[k_i, k_{i+1})` where `k` is the cumulative `moraCount(toKana(tok.ja))` over `segmentsToTokens(line.ja, line.tokens)`; V13 guarantees the token readings concatenate to `line.kana`, which is the order `m` was aligned to.

Three highlight levels, two shown at once: **line** (the existing `data-speaking` rule), **token** (a soft sweep that fills each `.ruby__token` over its span, shown at ≥ 1.0×), **mora** (pitch dots above the ruby from the engine's per-mora `pitch`, only in slow mode — per-mora flashing at speed reads as noise). The synth path stays line-level (no token timing exists there) and the transcript says nothing about it. `clauses` make long lines dictable: `sentence-listen` and the Arena dictate one clause of a line > `DICTATION_MAX_MORAE` (22) instead of skipping the line (600 lines exceed 40 morae), loop-a-line becomes loop-a-clause, and a missed question with `lineRef` replays that line.

## 10. Surfaces

### 10.1 耳 Ear panel (Station page)
Above the texts list: *聴解 Set* (`#/listen/:id`), *読み聞かせ Read-along* (`#/story/:id/listen`), *茶屋ラジオ from here* (`#/radio`), each with a status chip — **`synthetic voice (VOICEVOX)`**, **`device voice`** (clips missing), **`text only`** (`!voiceAudible`) — and the live line "N min you can follow today" from the known pool. The word *recorded* never appears on a chip or header; it is used once, in the Settings explanation ("pre-rendered synthetic voices"). Pieces show their genre and *Listen first*; their Read link opens after an Arena pass or a deliberate "Read it anyway".

### 10.2 茶屋ラジオ Radio (`#/radio`)
A non-session surface (never a training day, never lights the flame or restores an Ember) reached from a quiet Dojo tile and the Ear panel. `radio-playlist.ts` (pure, `rngFor(seed, day, 'radio')`) builds up to 45 min from **cold** pieces and dialogues ≤ station not yet heard on either surface (`progress.listened`), **i+0 pool sentences** at the learner's tier weighted by `1 − R(listen)`, and **re-hearings** least recently heard first, one tier faster than last time ("Here it is again at 1.1×"). A **gist question** follows every cold text and every re-hearing of an authentic-style text (`isAuthenticText`) at ≥ 1.0× — one tap, optional, skippable — so re-hearings can earn authentic minutes (§12) and cold hearings feed the comprehension counters. When new material runs out the player says so. Keys: Space pause · ←/→ line · L loop line (clause in slow mode) · `[` `]` speed · T transcript (closed by default, karaoke-timed) · G gloss the i+1 word · `?` "didn't catch that" (Hard on the sentence's `listen` cards due within 3 days, transcript for 3 s). Radio emits `listen:played` per track (§12), **earns no XP** (Level = effort; passive hearing is input), appends heard text ids to `progress.listened`, and counts only seconds actually played at volume > 0 — measured from `timeupdate` deltas (§8), so the count is right with the screen off (Zen is not mute for voices).

### 10.3 Read-along (Reader)
`StoryReader` with `mode: 'listen'` plays the text line by line with the token sweep; tap-to-gloss keeps playing and pauses at the line boundary while a gloss is open (the `04 §7` gloss-tap rule holds); per-line chips `slow (natural) · my tier · fast` say which clip was served. It ends in the comprehension questions as an optional self-check and emits **`listen:played { source: 'readalong', refs: [story.id], seconds, rate, cold, authentic, gistCorrect }`** — a `listen` ledger row with `source: app`, **0 XP**, `progress.listened` appended, and *no* `story:read`: a read-along is hearing with the text open, so it never pays the episode tariff, never bumps `episodesRead`, the `read-episode` quest or the reading badges, and never marks the text read for the builder's unread-first pick (`01 §2` pillar 1: nothing pays for re-reading; `10.2`: passive hearing is input). Reading it afterwards in the plain reader is a first read as before.

### 10.4 Arena and Ear Walk
Arena order is unchanged for every genre: listen → questions (gist first, then by `kind`) → transcript with karaoke → mandatory re-listen +0.1×. The header names the speakers (ハナ · ケン · 森さん; 田中さん with ruby) and the source (**`3 voices · synthetic`** / **`2 voices · device`**); the transcript phase shows the credit line `VOICEVOX:<character>` per speaker. The **Ear Walk** is `listening-set` in pool mode (`StepParams.refs`): 6–8 i+0 / i+1 pool sentences as choice and dictation items with the same graders, implicit `listen` evidence and `listening:set { storyId: null, refs, mode: 'walk' }` — no new drill id, and it replaces the proposed audio-first `pattern-cloze`, which would have written a listening miss onto a grammar `cloze` card (`01 §2` pillar 2). A set is **cold** when the text is not in `progress.listened` at set start (neither an Arena pass nor a Radio hearing has touched it); a passed set appends the id. Minimal Pair and the perception Judge use **one source for both words** (both clips or both device voice), otherwise timbre leaks the answer.

### 10.5 Stations 1–3
No pieces and no chant `StoryItem`s (V04 / V14 / V34 forbid them). The render script generates **kana tracks** from `KanaItem` rows and the White set — row walks, dakuten pairs, long-vowel / っ contrasts in one voice at one speed, counting 1–10, greetings, the 238 `exampleWord`s — into `kana/*.webm` + `kana/tracks.json`; Radio at Stations 1–3 plays them with the 140 White story lines. Kana Ear / Flash / Forge pass `clip: kanaItem.id`. Onboarding's voice step becomes *Meet ハナ* (あ・い・う・え・お lit in time, then こんにちは with the English gloss *hello* beneath the lit kana — no romaji, per `05 §13`) **before** the kana check, and each glyph is spoken on reveal during the check (sound before symbol). Without the pack all of this falls back to the device voice as today.

## 11. Sessions, gates, rewards

- **Builder** (`inputSteps`, `inputKind: 'listening'`): rotation unheard piece → dialogue → Ear Walk, never the same genre twice in a row (derived from `progress.listened`, no new slice); `pickStories` accepts `{ audioFirst?, genre? }` and the listening filter becomes `kind === 'dialogue' || audioFirst`. **Speaking surfaces exclude pieces unless they opt in**: `builder.ts:338` (role-play Output block), `builder.ts:390` (the dialogue fallback) and `shinsa.ts:283` (Shinsa 口) select `kind === 'dialogue' && (!audioFirst || learnerSpeaker)`; `resolveLearnerSpeaker`'s second-speaker fallback never fires on a piece. Sparring's ≥ 2 `listen` reps prefer i+0 examples. A piece is not re-served within 14 days.
- **Role-play copy** no longer assumes ハナ: after the learner answers a line the gold line is replayed in the **learnerSpeaker's cast voice** with "Your line, as {speaker} says it" (every existing dialogue has `learnerSpeaker: 'ハナ'`, so today's copy is unchanged in effect; the test uses a non-ハナ fixture).
- **Gatekeeper 耳 / Shinsa 耳** draw own-station pool refs before bare words; clips play through `playbackRate` at `BELT_RATE`; the Arena-in-fight header shows the source chip.
- **Teach cards** (`Progress.teachSeen`, shared `TeachOnce`): Station 1 "Japanese is made of beats called morae; each kana is one beat"; Station 2 long vowel / っ as a beat; Station 3 "words rise and fall — the line over the kana is the melody; these voices are synthetic and follow the dictionary pattern"; Station 4 first Arena "You hear it before you see it. Two replays; the second caps the grade at Hard — honest, not a penalty"; speed "Slow here is spoken slowly, not stretched. After a clean set the dojo offers the next tier; you decide"; Station 7 first Pitch Ear 雨 / 飴; Radio "Everything here is made of words you already know"; Station 27 "Some pieces now sound like real people: dropped particles, fillers. Aim for 93 %, not 100 %."
- **Speed tiers** keep the **offer** (`ListeningArena` `offerTier`); the app never changes speed silently (`01 §6`); design 04 §5's "advances after 10 consecutive ≥ 0.9" is corrected to the offer. The radar reads the tier the learner has **demonstrated**, not only the one chosen (§12 `bestCleanTier`).
- **Rewards** (deterministic, `06` binding rules): badges `teahouse-regular` 茶屋の常連 (`stats.radioMinutes ≥ 600`, Bronze, glyph 常) and `first-hearing` 初耳 (`stats.coldSetsPassed ≥ 20`, Silver, glyph 初) → `BADGE_IDS` 68; wallpaper `chaya-lanterns` 茶屋の灯 (a roadside teahouse at dusk, one chōchin per 10 h of `ledgerHours(m).listen`, quadrants at 25 / 50 / 75 / 100 h, living) → `WALLPAPER_IDS` 29. Every `Record<RouteName | BadgeId | WallpaperId | …>` site changes with its table in the same owner: `src/app/Layout.tsx` `NAV_OF_ROUTE` (`radio: 'dojo'`), `src/art/strings.ts` `WALLPAPER_NAMES` (茶屋の灯), `src/art/mon.ts` `ROWS` (常 / 初; `mon.test.ts` asserts the keys equal `BADGE_IDS`). No new quest (the pool is contract-pinned at 17 and `03 §6` caps quests at ~12 minutes).

## 12. The 耳 cap, the ledger, the honest share

**耳 axis** (`store/perapera.ts`, replaces `05 §11`'s row):

```
tier      = min(settings.speedTier, max(1, stats.bestCleanTier))       // the preset, capped by the tier the learner has shown
base      = 20 · tier · clamp(dictationAcc / 0.9, 0.5, 1)
comp      = coldSets ≥ 10 ? clamp(coldPassRate / 0.8, 0.5, 1) : 1        // material understood on first hearing, either surface
authentic = externalListenWatchHours + stats.listeningAuthenticMinutes / 60
cap       = authentic < 10 ? 70 : authentic < 20 ? 85 : 100
ear       = min(cap, base · comp)
```

`bestCleanTier` (new `STAT_KEY`) is the highest tier at which the learner has passed a `listening:set` with every question right (`total ≥ 3`, `correct === total`; tier = nearest `SPEED_TIER_RATES` entry to the set's `rate`); existing saves are seeded with their current `speedTier` at migration so nobody's radar drops on upgrade, new saves start at 1. `coldSets` / `coldSetsPassed` count **first hearings on either surface**: an Arena set whose text was not in `progress.listened` (pass → both), and a Radio cold track whose gist question was answered (correct → both, wrong → `coldSets` only); a Radio cold track with the question skipped counts nothing. Without this the factor would measure Radio usage, not comprehension — a Radio listener hears every text before its Arena set.

`listeningAuthenticMinutes` counts (a) `listening:set` minutes (the set's wall-clock `minutes`, as the ledger already counts them) on **authentic-style texts** — `isAuthenticText`: `bridge`, an `AUTHENTIC_GENRES` piece, or one of the 29 existing casual non-bridge dialogues from Station 10 — passed (≥ `PASS_RATIO`) at rate ≥ 1.0, and (b) `listen:played` seconds on such texts at ≥ 1.0× whose gist question was answered correctly, on **cold hearings and re-hearings alike** (Radio asks it on both, §10.2). The inventory, computed from the corpus (`scripts/listening-report.ts`): bridge texts 25 ≈ 1.1 h + casual non-bridge dialogues 29 ≈ 0.7 h + Blue–Black authentic pieces ≈ 3 h ≈ **4.8 h distinct**. An Arena set runs ≈ 2.5× the speech length, so sets alone give ≈ 12 h; two Radio re-hearings at ≥ 1.0× with the gist question add ≈ 10 h — **20 h is reachable in Black, by a learner who takes every re-hearing at full speed, and not before**; a learner who skips the re-hearings reaches ≈ 12–15 h and 85 stays the in-app ceiling. The explain line says exactly that: "Held at {cap} until 20 h of authentic-style listening: {app} h in the dojo (bridge, casual talk, news, lectures at full speed, understood) + {ext} h outside so far. The dojo alone can carry you to about {reach} h; the rest is the world." `src/store/perapera.test.ts` walks the corpus inventory and asserts the reachable figure, so the sentence cannot drift from the content. The flag stays `(synthetic)`; `peraperaFlagSynthetic` and `S.explainEar` are reworded to "Synthetic: every voice in the dojo is a VOICEVOX character voice. The ledger's outside hours are real people." (today's "Real listening is the hours you log" would deny the in-app authentic minutes).

**Ledger.** `listening:set` (Arena, Ear Walk) and `listen:played { source: 'radio' | 'readalong', seconds }` log `listen` rows with `source: app` (`startLedger`). Drill audio (Audio Flash, dictation, Shadow) is form work and is not ledger input. `weekProgress` and the weekly external target keep their meaning (`05 §9`: outside hours); the Ledger and Station pages add an informational line "In the dojo this week: {h} h heard".

**Honest share** (stated on the Ledger page and in onboarding's honesty clause, replacing "the app's audio is a text-to-speech voice"): "Every voice in the dojo is synthetic — VOICEVOX character voices, pre-rendered, clear and consistent on purpose. The dojo holds ≈ 24 hours of sentences and texts (plus ≈ 13 hours of word and phrase clips for drills) and gives you ≈ 70–90 hours of worthwhile listening over the road, because each piece returns at rising speed. That covers the weekly listening target through Orange (from Station 9), about a quarter of it from Green to Purple and an eighth at Brown and Black (`WEEKLY_TARGET_HOURS` 3 / 5 / 5 / 7 / 8). Real people mumble, overlap and joke; the ledger's outside hours exist for that, and the 1,500-hour goal still needs the world." The per-belt sentence is derived from the 24 h of connected speech only — word clips are drills, not listening.

## 13. Settings and offline

- **音声パック Voice pack** card: "Pre-rendered synthetic voices (VOICEVOX). Your belt: 38 MB · all belts: 490 MB · on this device: {cacheUsage}" from the manifest's `belts` and `cacheUsage()`, never guessed; per-belt *Download for offline* with a progress bar and *Remove*; the Safari ITP note; absent pack → "This build has no voice pack; your device voice speaks."
- `audioSource: 'pack' | 'device'` (default `pack`): the existing voice pickers stay and the hint says which drills each source serves. `dataSaver` (auto-on when `navigator.connection.saveData`): no idle prefetch, no Radio sprite beyond the current track.
- Speed-tier picker note: "Slow is spoken slowly through Station 17; faster speeds keep the pitch."
- Offline copy: `public/sw.js` already promises one visit makes the app available offline; the Settings card says audio is extra and downloaded per belt.

## 14. Budgets

| Item | Number |
|---|---|
| Render wall clock (4 engines ≈ 2.1× realtime) | T1 ≈ 5 h · pieces ≈ 2.5 h · T2 ≈ 6.5 h (overnight) · T3 ≈ 5 h; incremental afterwards |
| Pack bytes | T1 126 MB (+65 MB pieces) · T2 169 MB · T3 131 MB · ≈ 490 MB total; `dist/` ≤ 900 MB asserted |
| First belts | White + Yellow + Orange T1 + T2 ≈ 3.1 h ≈ 40 MB, + slow takes ≈ 40 MB |
| Per-station idle prefetch | 1–3 MB (story sprites + words); 0 under data saver |
| Pages bandwidth (100 GB / month soft limit) | a learner costs ≈ 0.5 GB over the whole road (one belt download per belt + prefetch), ≈ 20–60 MB per month; ≈ 200 full-pack or ≈ 1,500 belt downloads per month before the limit; a content release re-downloads only changed sprites (`reusedBytesShare` ≥ 0.9 expected) |
| Indexes | ≤ 350 KB raw per level file (≈ 80 KB gzipped), ≤ 20 KB per station, manifest ≤ 80 KB (content-addressed paths add ≈ 9 bytes per file) |
| Memory | ≤ 6 decoded sprites (≤ 1.2 MB Opus each for the longest text) |
| CI | + ≈ 490 MB fetch, + ≈ 520 MB artifact upload per deploy with the full pack |
| Content writing | 100 pieces (50 packets) + ≈ 450 Yellow example rewrites (6 packets) |
| New contract surface | types.ts fields above + `isAuthenticText`, `src/shared/speak-text.ts`, `SpeakOptions` + `AudioService` optionals, `Settings.audioSource/dataSaver`, `Progress.listened/teachSeen`, 5 `STAT_KEYS`, route `radio` + story `mode`, `StepParams.clip/refs`, `listening:set.storyId: string \| null` + `refs?`, `listen:played`, BADGE_IDS 68, WALLPAPER_IDS 29, CONTENT_KINDS + `pool` |

## 15. Risks

| Risk | Mitigation |
|---|---|
| VOICEVOX misreads kanji (7.5 % of sampled lines) | per-clip mora verification + four-step ladder; `skipped.jsonl` reviewed per render; the device voice covers a skipped clip |
| Wrong pitch on the only words the app grades for pitch | rendered from the surface with `accent_type = pitch`, accent verified for `high`, `pitchVerified` on the cue; Pitch Ear plays verified clips only, else both halves through the device voice |
| iOS autoplay, per-element unlock, blob MIME | the 6-element pool is created and played inside the first gesture (`unlock()`); blob re-wrapped as `audio/webm`; 20 ms guards in 300 ms pads; **pre-flight on a real iPhone before the clip-runtime owner starts** (blob WebM/Opus plays, seek to 60 s, `playbackRate` 1.25 with `preservesPitch`, 30 s with the screen off), logged in `docs/BUILD_STATUS.md` |
| Screen-off playback with sprite cues | whole-text sprites for Radio tracks, `ended`-driven, seconds from `timeupdate`; sentence sets foreground only |
| Pack and content drift | `audioVersion` embeds `contentVersion`; `audio:check` warns; sprites are content-addressed so a fix never invalidates unchanged audio; text-keyed sentence fallback degrades gracefully |
| Pool ceilings read as promises | the Station page shows the live known count, never allowlist totals |
| 20 h of authentic listening unreachable before Black | stated in the explain line with the reachable figure; 85 is the in-app ceiling for a learner who skips re-hearings; the corpus-walking test keeps the sentence honest |
| Phone storage | no implicit sprite caching; only prefetch (≤ 3 MB) and explicit belt downloads are stored; Settings shows real usage |
| Engine only on one Mac | render is a local step; a Docker `voicevox_engine` CPU path and the pinned engine + `dictVersion` in the manifest make it reproducible |

## 16. What we deliberately cut and why

| Cut | Reason |
|---|---|
| A `listening/` content kind with `l-` ids | nine contract-tier files for no learner gain |
| Appending pieces to `stories-sNN.json` | Black files would exceed `MAX_FILE_BYTES`; `listening-sNN.json` beside them needs no loader change |
| Generated `tokens` in `SentenceExample` | +3.6 MB, 16 files over `MAX_FILE_BYTES`; pools carry the ids |
| `audio/<audioVersion>/` prefix on sprites | every content fix would re-download ≈ 490 MB per learner; content-addressed sprite names + versioned indexes |
| SW cache-first for sprites | unbounded Cache Storage; `clips.ts` caches prefetch and downloads only |
| Read-along emitting `story:read` | pays reading XP, quests and badges for hearing (`01 §2` pillar 1); it is a `listen:played` row |
| White-belt `sounds` pieces and chant `StoryItem`s | fail V04 / V14 / V34 and leak into the builder; kana tracks are generated |
| 誰の声 item and the `voice-ear` badge | trivia with three recurring voices; takes a slot in a 6-item set |
| `radio-fifteen` quest | quest pool is contract-pinned; `03 §6` caps quests at ~12 minutes |
| Radio XP; `teahouse-regular` via ledger notes | `xp.ts` grants 0 for app rows by design; notes mirror into bookmarks |
| Audio-first `pattern-cloze` | a listening miss on a grammar `cloze` card breaks facet integrity |
| Auto-advancing speed tier | the app never switches a preset silently |
| Romaji in Meet ハナ | `05 §13` cuts romaji outside input; the English gloss does the job |
| Hash-assigned minor voices | explicit `voice` per speaker avoids same-gender collisions |
| Two voices per word | +1.9 h / 25 MB and breaks the kanji-example reuse; a second talker arrives through sentences |
| Per-speaker silhouettes on the wallpaper | no per-speaker minutes in `SaveMeta`; ハナ's whole corpus is ≈ 48 min |
| Weekly target counting in-app minutes | `05 §9` defines it as outside hours; in-app hours get their own line |
| SW-served media with Range requests | blob URLs avoid Safari's 206 path |
