# TSUZUKU — audio pack runbook (design 08 §7–§8)

The voice pack is a set of pre-rendered VOICEVOX clips, packed into Opus/WebM **sprites** (content-addressed, immutable) with small JSON **indexes** (versioned) and one **manifest**. The site never blocks on it: CI fetches the pack as a GitHub release asset when one is published, and a build without it speaks through the device voice. This file is the contract between the render pipeline (`scripts/audio/*`, this owner) and the clip runtime (`src/audio/clips.ts`): **§2–§4 are the exact shapes the runtime reads**. Everything else is the operator's runbook.

Every voice is synthetic and says so: credits are `VOICEVOX:<character>` strings, the UI vocabulary is *synthetic voice (VOICEVOX)* / *device voice* / *text only*, and the word *recorded* never appears on a chip, header or label.

## 1. Layout on disk (`public/audio/`, gitignored)

```
public/audio/
  manifest.json                         tsuzuku.audio/1 (§4) — the only file the runtime fetches first
  <audioVersion>/                       versioned indexes, e.g. a-3f9c2e1b07/
    kana/words.json                     kana items (k-…) and their example words      CueIndex (§3.1)
    kana/tracks.json                    generated kana tracks for Radio               TracksIndex (§3.3)
    n5/words.json  n4/… n3/… n2/… n1/…  vocab words (v-…), kanji example words (j-…#exN), #ga, #pair
    n5/sentences.json …                 vocab + grammar examples (v-…#exN, g-…#exN)   CueIndex with byText
    n5/ear.json …                       T3 only: #col<k>, #def                       CueIndex
    s01/stories.json … s53/stories.json one per station: texts, lines, michikusa      StoriesIndex (§3.2)
    files.json                          sprite path → full sha256 (pack / check only; the runtime ignores it)
    kana.json                           clip key → hex8 of the kana it was verified against   KanaIndex (§3.4; check only, ≈ 640 KB, in the core tar, never fetched)
  sprites/
    s04/s-04-1-<sha8>.webm              ONE sprite per text (lines in order, then the slow takes)
    s04/words-01-<sha8>.webm            mixed sprites ≤ 90 s: words-NN, grammar-NN, examples-NN, misc-NN, ear-NN
    kana/<track name>-<sha8>.webm       one sprite per kana track
```

`sha8` = the first 8 hex digits of sha256 over the sprite's bytes, so a sprite's path changes only when its audio changes; a one-word content fix re-renders and renames exactly the sprites that contain that word and renames the index directory (`audioVersion` changes). Every path inside the pack is relative to `public/audio/` and is served at `./audio/<path>`; Pages serves `.webm` as `video/webm`, so the runtime re-wraps the bytes as `audio/webm; codecs=opus` (design 08 §8).

Sprite audio: PCM concat at 24 kHz mono with a **300 ms pad** before every clip and after the last one; cue `start` / `end` sit **20 ms inside the pads** (`start = clip offset − 0.02`, `end = clip end + 0.02`), so a seek never clips a consonant. Opus `-b:a 24k -ac 1 -ar 24000 -application voip -flags +bitexact -fflags +bitexact` (≈ 3.46 KB/s measured; `bitexact` strips the muxer's date and random SegmentUID so identical PCM gives identical bytes — measured: without it every sprite is renamed on every run).

## 2. Clip keys

Exactly design 08 §8 (`src/shared/audio.ts` `ClipCue` doc):

| Key | What | Index |
|---|---|---|
| `<itemId>` | a vocab word (`v-n5-0249`) or a kana (`k-h-a`) | `<level>/words.json`, `kana/words.json` |
| `k-h-a#ex0` | a kana item's `exampleWord` | `kana/words.json` |
| `j-日#ex<k>` | a kanji item's example word; **reuses the vocab clip** (same file region) when a vocab item has the same `word` AND `kana` | `<jlpt level>/words.json` |
| `<itemId>#ex<k>` | vocab / grammar example sentence `k` | `<level>/sentences.json` |
| `<storyId>#L<i>` | line `i` of a story or piece | `sNN/stories.json` `texts[storyId].lines[i]` |
| `<storyId>` | the whole text (Radio track: lines edge to edge, no slow takes); **absent (`whole: null`) when any line of the text was skipped** | `sNN/stories.json` `texts[storyId].whole` |
| `m-NN-k` | a michikusa quote (`ja`) | `sNN/stories.json` `misc` |
| `<itemId>#def` | `definitionJa` (T3) | `<level>/ear.json` |
| `<itemId>#col<k>` | collocation `k` (T3; no kana in the content, so morae are not verified) | `<level>/ear.json` |
| `<itemId>#ga` | word + が pitch-contrast variant, `pitchConfidence: high` words only (T3) | `<level>/words.json` |
| `<itemId>#pair` | the minimal-pair partner the runtime synthesizes for the item (`synthesizeMinimalPair(item.kana)`, the string `pairClipKey` keys as `#pair`), spoken from that kana in ハナ's voice at rate 1 (T3; one per vocab item) | `<level>/words.json` |
| `track:<name>` | a generated kana track (§3.3) | `kana/tracks.json` |

Which file holds a key: `v-<level>-…` / `g-<level>-…` → that level; `k-…` → `kana`; `s-NN-…` / `m-NN-…` → `sNN`; `j-…` has no level in the id, so the runtime looks it up in every loaded `words.json` (the kanji's `jlpt` decides where it was written). Sentence text lookup (`cueForText`) goes through `byText` (§3.1) and exists for sentences and lines only — never for words, since a kana key would collapse homophones (雨 / 飴).

A clip rendered at two speeds has **two cues** under one key: `r: 1` and `r: 0.85` (the natural-slow take, `speedScale 0.85`, `pauseLengthScale 1.3`; sentence clips of Stations 1–17 only). `cueFor(key, { rate })` picks the cue whose `r` is nearest.

## 3. Index shapes (`tsuzuku.audio-index/1`)

Indexes are compact: `files` and `voices` are tables, cues index into them with short keys. Expansion to the contract `ClipCue`:

```
ClipCue.key           = the object key (or texts[storyId] + '#L' + i, or storyId for `whole`)
ClipCue.file          = files[cue.f]            path relative to public/audio/  ("sprites/s04/s-04-1-1a2b3c4d.webm")
ClipCue.start         = cue.s                   seconds, 3 decimals
ClipCue.end           = cue.e                   seconds, 3 decimals
ClipCue.voice         = voices[cue.v]           "VOICEVOX:九州そら" (the credit string)
ClipCue.rate          = cue.r                   1 or 0.85
ClipCue.morae         = cue.m                   story lines only (§3.2)
ClipCue.clauses       = cue.c                   story lines always; a sentence only when it is longer than DICTATION_MAX_MORAE (22) and has more than one clause (§3.1)
ClipCue.pitchVerified = cue.pv                  words only; present only when true
```

A cue carries nothing else: the kana a clip was verified against is **not** in the runtime indexes (`kana.json`, §3.4, holds it for `audio:check`), so a `CueIndex` is exactly `{ f, s, e, v, r, pv?, m?, c? }` per cue.

### 3.1 `CueIndex` — `<level>/words.json`, `<level>/sentences.json`, `<level>/ear.json`, `kana/words.json`

```json
{
  "schema": "tsuzuku.audio-index/1",
  "audioVersion": "a-3f9c2e1b07",
  "scope": "n5",
  "kind": "words",
  "files": ["sprites/s04/words-01-1a2b3c4d.webm", "sprites/s05/words-01-9e8d7c6b.webm"],
  "voices": ["VOICEVOX:九州そら"],
  "cues": {
    "v-n5-0001": [{ "f": 0, "s": 0.28, "e": 0.934, "v": 0, "r": 1, "pv": true }],
    "j-日#ex0":  [{ "f": 0, "s": 7.12, "e": 8.01,  "v": 0, "r": 1 }]
  },
  "byText": { "a1b2c3d4": "v-n5-0249#ex0" }
}
```

- `kind` ∈ `words | sentences | ear`. `scope` is the level (`kana n5 n4 n3 n2 n1`).
- `cues[key]` is an array: one cue per native rate, `r: 1` first.
- `byText` exists **only in `sentences.json`** (and `stories.json`): key = `fnv1a32` of the spoken text as 8 lowercase hex digits (`src/shared/hash.ts fnv1a32`, over UTF-16 code units, i.e. `hashString(spoken).toString(16).padStart(8, '0')`), value = the clip key. The spoken text is `textToSpeak(toPlain(ja), kana)` — exactly what `speak(plain, { kana })` hands the voice and what the engine was handed — and, when a caller without the kana would hash something else (`textToSpeak(toPlain(ja))` differs only for a punctuation-less text ≤ 8 characters, e.g. a line `大磯、加藤`), **both** hashes map to the key, so `cueForText` resolves whichever form the caller computed, without the index carrying the text itself (budget: ≤ 350 KB raw per level file).
- `c` on a sentence cue: clause boundaries (§3.2) — present **only when the sentence is longer than `DICTATION_MAX_MORAE` (22 morae) and has more than one clause**, the one case clause dictation reaches a sentence (design 08 §9). The thousands of short pool examples carry no `c`; that is what keeps `n3/sentences.json` (the largest level file with the pools: 306 KB in the core + pool measurement, 301 KB in the three-tier dry run) under its 350 KB budget.

### 3.2 `StoriesIndex` — `sNN/stories.json`

```json
{
  "schema": "tsuzuku.audio-index/1",
  "audioVersion": "a-3f9c2e1b07",
  "scope": "s04",
  "kind": "stories",
  "files": ["sprites/s04/s-04-1-1a2b3c4d.webm", "sprites/s04/s-04-2-55aa66bb.webm", "sprites/s04/misc-01-c0ffee12.webm"],
  "voices": ["VOICEVOX:九州そら", "VOICEVOX:玄野武宏", "VOICEVOX:春日部つむぎ"],
  "texts": {
    "s-04-1": {
      "f": 0,
      "whole": { "s": 0.28, "e": 61.42 },
      "lines": [
        [{ "s": 0.28, "e": 2.31, "v": 0, "r": 1, "m": [120, 230, 350, 480, 610, 790, 1990], "c": [3, 7] },
         { "s": 61.72, "e": 64.1, "v": 0, "r": 0.85, "m": [130, 260, 400, 560, 720, 940, 2340], "c": [3, 7] }],
        [{ "s": 2.61, "e": 4.02, "v": 1, "r": 1, "m": [110, 240, 380, 520, 1380], "c": [5] }]
      ]
    },
    "s-04-2": { "f": 1, "whole": null, "lines": [[{ "s": 0.28, "e": 1.9, "v": 0, "r": 1, "m": [110, 240, 380, 1500], "c": [4] }], []] }
  },
  "misc": { "m-04-1": [{ "f": 2, "s": 0.28, "e": 1.1, "v": 0, "r": 1 }] },
  "byText": { "e5f6a7b8": "s-04-1#L1" }
}
```

- One sprite per text: `texts[id].f` is the file for **every** line cue of that text (line cues carry no `f`); `whole` is the whole-text Radio track — the `r: 1` lines in order, edge to edge, **without** the slow takes, which are appended after `whole.e` in the same sprite.
- **`whole` is `null` when any line of the text was skipped** (the ladder could not verify it, `skipped.jsonl`): the sprite would otherwise jump the missing line, and design 08 §7 says silence never ships — neither does a hole. A text with `whole: null` has no Radio track (Radio skips it); its present lines still play by key and the device voice covers the skipped one. **Runtime rule:** an explicit `null` means "no whole track" — never synthesize one from the line cues' min / max (`s-04-2` above).
- `lines[i]` = the cues of line `i` (one per native rate, `r: 1` first); **`lines.length` is the story's line count**, and a skipped line is an empty array `[]` (never a shorter `lines`). `v` is the line's speaker voice (`speaker` label, or the text's `narrator`, or ハナ for a speaker-less diary text) resolved through `scripts/audio/cast.json`.
- `m` (story lines only): cumulative **mora boundaries in ms from the cue's `start`**, one entry per mora of the line's `kana` (`speechMorae(kana)`, `src/shared/jp.ts` — the body the validator's V41 count and the linker's pool `morae` share), `m[i]` = when mora `i` ends. Computed from the verified `audio_query`: 20 ms guard + `prePhonemeLength` + Σ (`consonant_length` + `vowel_length`) / `speedScale`, a `pause_mora` folded into the preceding boundary. Token *i* of the line owns morae `[k_i, k_{i+1})` with `k` the cumulative `moraCount(toKana(tok.ja))` over `segmentsToTokens(line.ja, line.tokens)` (design 08 §9).
- `c`: clause boundaries as mora indexes — at every `pause_mora` and at every clause mark of the kana (、。！？ and the … ‥ — 〜 runs `stripDisplayMarks` turns into a pause); the last entry is the mora count, so clause `j` spans `[c[j−1] ?? 0, c[j])`. Morae are counted with `speechMorae` (`RE_NOT_MORA` drops every punctuation character — 、。！？「」『』〜…・ and whitespace — never a mora; `~`, the NFKC fold of ～, joins the clause marks), over one `spokenKana` string for `m` and `c` alike, so **`c[c.length − 1] === m.length` on every cue** by construction (asserted over the whole corpus). `ClipPlayOptions.clause = [fromMora, toMora)` plays that span.
- `misc`: michikusa quote cues (`m-NN-k`), one sprite `misc-NN` per station.
- `byText`: spoken text hash → `<storyId>#L<i>` (lines only, same hash and both-forms rule as §3.1).

### 3.3 `TracksIndex` — `kana/tracks.json`

```json
{
  "schema": "tsuzuku.audio-index/1",
  "audioVersion": "a-3f9c2e1b07",
  "kind": "tracks",
  "tracks": [
    { "key": "track:row-h-k", "title": "か行", "titleEn": "The k-row: ka ki ku ke ko",
      "file": "sprites/kana/row-h-k-1a2b3c4d.webm", "start": 0.28, "end": 6.41, "voice": "VOICEVOX:九州そら", "rate": 1,
      "segments": [{ "s": 0.28, "e": 1.02, "text": "か" }, { "s": 1.32, "e": 2.05, "text": "き" }] }
  ]
}
```

Rows are **full `TrackCue`s** (`src/shared/audio.ts`): `key`, `title`, `titleEn`, `file`, `start`, `end`, `voice`, `rate`, plus `segments` (what is said when, for the Radio transcript). Track names: `row-<h|k>-<row>[-<type>]` (gojūon rows per script: basic, dakuten, handakuten, yoon), `pairs-<h|k>-<base><row>[-yoon]` (base ↔ dakuten / handakuten pairs: `pairs-h-kg`, `pairs-h-hp`, `pairs-k-sz`, `pairs-h-kg-yoon`), `pair-<nn>` (one minimal pair: both words, one voice, one rate), `counting` (1–10), `greetings`, `words-<h|k>-<row>[-<type>]` (the `exampleWord`s). All kana tracks are ハナ's voice at rate 1.

### 3.4 `KanaIndex` — `<audioVersion>/kana.json` (check-only sidecar)

```json
{ "schema": "tsuzuku.audio-index/1", "audioVersion": "a-3f9c2e1b07", "kind": "kana", "keys": { "s-04-1#L0": "7a7a7a7a", "v-n5-0001": "5c3a9e01", "v-n5-0001#pair": "c2c2c2c2" } }
```

Every clip key of the pack → `fnv1a32` hex8 of the content kana the clip was verified against (`''` → `811c9dc5` for a kana-less collocation). The runtime never fetches it (it is listed in `manifest.indexes` so `pack.ts` ships it in the core tar and `audio:check` finds it); `audio:check` fails a cue whose record differs from the content's kana now or that has no record, and the **content diff** between two packs (`manifest.contentDiffShare`, the gate of the reuse warning) is the share of keys that are new or re-kana'd between the two sidecars. ≈ 640 KB for T1 + T2 — outside every index budget.

## 4. Manifest — `public/audio/manifest.json` (`tsuzuku.audio/1`)

```json
{
  "schema": "tsuzuku.audio/1",
  "audioVersion": "a-3f9c2e1b07",
  "contentVersion": "c-eda59d9655",
  "engine": "VOICEVOX 0.25.2",
  "dictVersion": "d-0c1d2e3f4a",
  "castSha": "b7e4…",
  "tiers": ["core"],
  "generatedAt": "2026-10-17T22:10:00.000Z",
  "dryRun": false,
  "partial": null,
  "voices": { "ハナ": { "character": "九州そら", "style": "ノーマル", "styleId": 16, "credit": "VOICEVOX:九州そら" } },
  "belts": { "white": { "bytes": 1234567, "seconds": 356.2, "files": 12 }, "yellow": { "bytes": 0, "seconds": 0, "files": 0 } },
  "files": [{ "path": "sprites/s04/s-04-1-1a2b3c4d.webm", "bytes": 212345, "seconds": 61.4, "clips": 14, "belt": "yellow", "tier": "core" }],
  "indexes": [{ "path": "a-3f9c2e1b07/n5/words.json", "bytes": 88123, "sha256": "…" }, { "path": "a-3f9c2e1b07/files.json", "bytes": 60123, "sha256": "…" }, { "path": "a-3f9c2e1b07/kana.json", "bytes": 640123, "sha256": "…" }],
  "totals": { "bytes": 1234567, "seconds": 356.2, "files": 12, "clips": 1890 },
  "render": { "rendered": 1890, "cached": 0, "skipped": 7, "reused": 0 },
  "changedClipShare": 1,
  "contentDiffShare": null,
  "skipped": 7,
  "credits": ["VOICEVOX:九州そら", "VOICEVOX:玄野武宏"],
  "reusedBytesShare": null
}
```

- `audioVersion` = `a-` + 10 hex of sha256 over `contentVersion | castSha | engine | dictVersion | tiers`, plus `rules=<n>` for the renderer's rule set `RENDER_RULES_VERSION` from 2 on (2 = the strict kana-name fold; rule set 1 is the two first packs and adds nothing, so their ids still reproduce). The runtime summary `AudioPackInfo` is `{ audioVersion, contentVersion, engine, belts, totals, credits }`.
- `partial`: `null` for a whole-corpus render; a `--stations A-B` or `--limit N` render records `{ stations?, limit? }`. A partial manifest is a working artefact only: `pack.ts` refuses it exactly as it refuses a dry run, `audio:check` warns on it, and a partial render never prunes (the other stations' sprites are simply not in its manifest).
- `files` lists **sprites only** (the Cache API prune in `clips.ts` is a set difference against `files[].path`, never a version-prefix match, so an unchanged sprite survives every release); `indexes` lists the versioned JSON files, the two check-only sidecars included. `belts` sums equal the `files` sums (`audio:check` asserts it). A sprite's station is in its path and its full sha256 in the `files.json` sidecar (the name already carries sha8 of the bytes), so an entry is ≈ 110–135 bytes: the manifest measures ≈ 92 KB compact for the 601 T1 sprites of the shipped corpus, ≈ 157 KB with the 1,173 T1 + T2 sprites and ≈ 214 KB raw (214,321 bytes, 1,664 sprites) with all three tiers on the landed corpus (≈ 20–40 KB gzipped on the wire). The accepted budget is **≤ 160 KiB raw** (`MAX_MANIFEST_BYTES`, the T1 + T2 measurement; design 08 §14's 80 KB predated content-addressed names) — the render warns over it and never fails; whether to accept ≈ 215 KB raw for T3 or move `files[]` per belt is the lead's open call (§8). `download(belt)` fetches `files.filter(f => f.belt === belt)`.
- `reusedBytesShare`: share of `files` bytes whose path already existed in the previous manifest (`null` when there was none). `contentDiffShare`: share of clip keys that are new or whose kana changed against the previous pack's `kana.json` (§3.4; `null` without one) — the content diff. `changedClipShare`: share of clips freshly rendered in this run — informational only, since a cold cache makes it 1 whatever the content did. `audio:check` warns when `reusedBytesShare < 0.9` while the content diff is below 5 % (or unknown).
- `skipped`: clips the ladder could not verify (listed in `.audio-cache/skipped.jsonl`); the device voice covers them, silence never ships. A real render exits 1 when ≥ 2 % of clips were skipped unless `--allow-skips` is passed.

## 5. The committed pointer — `public/audio-pack.json` (`tsuzuku.audio-pack/1`)

```json
{ "schema": "tsuzuku.audio-pack/1", "repo": "sunkencity999/tsuzuku", "audioVersion": null, "tag": null, "assets": [], "credits": [] }
```

`assets: [{ tier, name, sha256, bytes }]` names the release assets of tag `audio-<audioVersion>` (`tsuzuku-audio-<audioVersion>-<tier>.tar`). An empty `assets` list means **no pack**: `audio:fetch -- --optional` prints `audio pack: none — speechSynthesis only` and exits 0.

## 6. Pipeline (build Mac, never CI)

`render → verify → encode → sprites → indexes → manifest → pack → publish → CI fetch`; every step is incremental, content-hash keyed and resumable.

```
npm run audio:render -- --tier core                             # the whole corpus: engines at 127.0.0.1:50021…50024, ffmpeg on PATH
npm run audio:render -- --tier core --tier pool --tier ear      # T1 + T2 + T3 in one pack
npm run audio:render -- --tier core --dry-run --fixtures        # no engine, no ffmpeg → .audio-cache/dry-run/{audio,cache}: manifest + indexes + skipped.jsonl
npm run audio:render -- --tier core --limit 50 --out <scratch>  # a smoke render: PARTIAL manifest, never packed
npm run audio:pack                                              # tsuzuku-audio-<v>-<tier>.tar + public/audio-pack.json (refuses a dry-run or partial manifest)
npm run audio:publish                                           # DRY RUN: prints the gh commands
npm run audio:publish -- --yes                                  # the real release (lead only)
npm run audio:fetch -- --optional                               # what CI runs
npm run audio:check -- --optional                               # what CI runs after the build
```

`render-audio.ts` options: `--tier core|pool|ear` (repeatable), `--stations A-B`, `--engines url,url,…`, `--dry-run`, `--fixtures [dir]`, `--limit N` (smoke renders ≤ 50 clips in this phase), `--root public/content`, `--out public/audio`, `--cache .audio-cache`, `--cast scripts/audio/cast.json`, `--ffmpeg <path>`, `--dict high|all|none` (which words get a user-dictionary entry; default `high`), `--no-prune`, `--previous <manifest.json>` (what `reusedBytesShare` / `contentDiffShare` are measured against; default: the manifest already in `--out` and its `kana.json`), `--force`, `--allow-skips`. Guards: a **dry run** defaults `--out` / `--cache` to `.audio-cache/dry-run/{audio,cache}` so it never lands on the real pack or the real `skipped.jsonl`; a dry or **partial** (`--stations`, `--limit`) run **refuses** to overwrite an `--out` whose manifest is a complete real pack unless `--force`; a partial render marks `manifest.partial`, never prunes and is refused by `pack.ts`. A whole-corpus render prunes sprites and index directories its manifest no longer names. Each engine process serialises its requests (≈ 0.85× realtime); the run shards clips across the four engines from one queue (measured: 42 clips with the ladder in 32 s on four engines). A **transport failure** (connection refused / reset, HTTP 5xx) requeues the clip and counts against that engine — three in a row retire it and the others drain the queue; when every engine is down the run fails (the cache resumes it) instead of skipping its way to exit 0. An HTTP 4xx skips just that clip. The run exits 1 when ≥ 2 % of clips were skipped (`--allow-skips` overrides; a dry run only warns).

**The user dictionary is one file.** The four engines share `user_dict.json`, and an engine recompiles it only on its **own** write (measured on 0.25.2: an entry added through 50021 shows in 50022's `GET /user_dict` but not in its reading until 50022 itself adds or deletes something). So the start-of-run sync (`dictVersion` = sha over the entries) ends with a **touch** — a sentinel `ゾヌケツヅ` added and deleted — on every engine that found the file already right, and ladder step 1's temporary entry runs under one process-wide mutex that holds add → re-query → delete, so no engine ever compiles another engine's temporary word and the dictionary every clip was rendered with is exactly the hashed `dictVersion` set. An engine shared with other work ends the run holding the pack's dictionary.

1. **Inventory.** The text handed to the engine is `textToSpeak(toPlain(ja), kana)` (`src/shared/speak-text.ts`) for sentences, lines, quotes and definitions, so the clip and the caller agree (`byText` carries both spoken forms when the kana changes it, §3.1). Word clips are rendered from the **word surface** with a user-dictionary entry `{ surface: word, pronunciation: katakana(kana), accent_type: pitch }` (heiban 0 → the mora count, VOICEVOX's convention), never from bare kana — 301 kana-homophone groups differ in pitch. The T3 `<itemId>#pair` clip is `synthesizeMinimalPair(item.kana)` (re-exported by `verify.ts` from `src/learn/distractors.ts`, which is importable under plain Node — `render-audio.test.ts` asserts the import identity), spoken from that kana; the っ rule "never before ー or ん, a same-mora-count near miss otherwise" (design 08 §11) therefore reaches the clips.
2. **Clip id** = `sha256(engine|0.25.2|styleId|dictVersion|text|kana|speedScale|pitchScale|intonationScale|accentOverride)` first 16 hex; `.audio-cache/<id>.{wav,json}` at the repo root (gitignored). Existing clips are skipped.
3. **Verify** every `audio_query` (`scripts/audio/verify.ts`): (a) morae = `moraSplit(kana)` under the lenient fold (katakana → hiragana, は/わ, へ/え, を/お, ぢ/じ, づ/ず, long vowels canonical — but STRICT for a kana NAME, `ClipSpec.kanaName`: the lone `k-*` kana and the row / pair track segments keep は / へ, because OpenJTalk reads the lone character as the particle and the engine said ワ / エ in the first two packs; such a clip takes a `kana-name` reading override in its id, `pause_mora` dropped); (b) a `pitchConfidence: high` word's `accent_phrases[0].accent` equals `pitch` (0 ↔ mora count) — a mismatch sets `accent` and re-verifies. Ladder on a mora mismatch: **0** surface → **1** user-dict the offending `tokenIds` word → **2** patch the span in the response `kana` (AquesTalk notation) and re-query `/accent_phrases?is_kana=true` → **3** the content kana as plain text → **skip** (`.audio-cache/skipped.jsonl`: `{ key, text, kana, got, want, step }`). Every ladder string is written in the **engine's** notation (`engineMorae`): the `is_kana` parser rejects ー (`コーヒー'` → HTTP 400, `コオヒイ'` → 200), so each ー of the content kana is expanded to the preceding vowel (`expandLongVowelMark`) before it is katakana-ized — `クォーツ` misread as `クオオツ` is patched as `クォオ'ツ`, not skipped.
4. **Natural slow.** Sentence clips of Stations 1–17 render twice (`speedScale 0.85`, `pauseLengthScale 1.3`, cue `r: 0.85`). Words and kana render once.
5. **Sprites** (`sprites.ts`): §1. One sprite per text; mixed sprites split at 90 s; a text longer than 90 s is still one sprite (asserted end to end in `render-audio.test.ts`).
6. **Indexes** (`indexes.ts`): §3. Budgets: ≤ 350 KB raw per level file (the render FAILS the run over it; measured with the pools on disk: n3 `sentences.json` 306 KB core + pool, 301 KB in the three-tier dry run), station files warn over 64 KB (§8), the manifest warns over 160 KiB (`MAX_MANIFEST_BYTES`, the accepted figure, §8; a three-tier pack measures ≈ 214 KB raw and warns). The sidecars (`files.json`, `kana.json`) are not budgeted.
7. **Manifest**: §4.
8. **Pack / publish** (`pack.ts`, `publish.ts`): one tar per tier → release `audio-<audioVersion>` on `sunkencity999/tsuzuku`. `pack.ts` refuses a dry-run or partial manifest; `publish.ts` is a dry run unless `--yes`.
9. **CI** (`deploy.yml`): `content:validate → content:index → audio:fetch -- --optional → test → build → audio:check -- --optional`; `workflow_dispatch` input `audio` (default true, `false` rehearses the no-pack path). `fetch-audio-pack.ts` streams each asset to a temp file (`Readable.fromWeb(res.body).pipe(createWriteStream)`), hashes while streaming, verifies sha256 + bytes for **every** asset first, then `spawnSync('tar', ['-xf', tmp, '-C', 'public/audio'])`. **No pack** — no pointer, an empty asset list, a 404 release — exits 0 with `audio pack: none — speechSynthesis only`; **every other failure** (a sha256 or byte-count mismatch, a failed download, an API error, a failing tar) exits 1 whatever the flags, leaving `public/audio` untouched — a corrupt or tampered asset must never deploy silently as a device-voice-only site. `--optional` is accepted for symmetry with `audio:check` and changes nothing. **GNU tar (or bsdtar) must be on the runner** — ubuntu-latest and macOS have it; Node has no tar and the project adds no dependency.

### CI cost per deploy with the full pack

≈ 490 MB release download + Vite's copy of `public/audio` into `dist/` + ≈ 520 MB Pages artifact upload — several minutes longer than today; artifact storage is free on a public repo. `audio:check` fails when `dist/` exceeds 900 MB (Pages limit 1 GB).

## 7. Cast — `scripts/audio/cast.json` (`tsuzuku.cast/1`)

One entry per speaker label: `{ name, gender, age, character, style, emotionStyles?, credit }`. ハナ = 九州そら (also narration, kana tracks and word clips), ケン = 玄野武宏, 田中さん = ちび式じい, `anchor` = 波音リツ, `lecturer` = 麒ヶ島宗麟, `reader` = 冥鳴ひまり; every other local is assigned by gender and age; two speakers of one text never share a character. Only permitted characters (never 青山龍星, 後鬼, もち子さん, ユーレイちゃん, No.7, Voidoll, ぞん子). Style ids are resolved from `GET /speakers` at render time, never hard-coded. V42 (`scripts/validate-content.ts`) fails in strict mode on a label this file does not resolve; a writer's `newCast` block is added here before the packet ships.

## 8. Budgets and acceptance (design 08 §14, `docs/listening-plan.json`)

| Item | Number |
|---|---|
| T1 core | ≤ 140 MB before the pieces (≈ 126 MB + 65 MB pieces; dry-run estimate ≈ 134 MB / 601 sprites before the pieces, 177.2 MB / 14.9 h / 671 sprites with the 100 pieces on the landed corpus) · ≈ 5 h wall clock on 4 engines (≈ 2.1× realtime), ≤ 6 h |
| T2 pool · T3 ear | design ≈ 169 MB · ≈ 131 MB; dry-run estimates on the shipped corpus with the pools on disk: pool ≈ 171 MB (572 sprites; core + pool 304.8 MB, 25.6 h), ear ≈ 133 MB / 11.2 h including the 6,387 `#pair` partner clips (≈ 17 MB) and 1,266 `#ga` clips; ≈ 440 MB in all. Final three-tier dry run on the landed corpus (`a-acc3792de1`, content `c-22578c2f0f`, dict `d-43fbf691bc`): core 177.2 MB / 14.9 h / 671 sprites, pool 140.3 MB / 11.8 h / 510, ear 133.2 MB / 11.2 h / 483 — **450.7 MB, 37.8 h, 1,664 sprites, 46,031 clips rendered, 2 skipped** (`k-k-kwo#ex0` and `track:words-k-ext#29` クォーツ — a dry-run misread; a real render patches it as クォオ'ツ) |
| Sprites | ≤ 90 s mixed-kind; one per text whatever its length; ≤ 1.2 MB Opus for the longest text |
| Indexes | ≤ 350 KB raw per level file (asserted over the shipped corpus with core + pool; measured max n3 `sentences.json` 306 KB, n5 260 KB, n2 250 KB in the pack owner's core + pool measurement with the pools on disk; T1-only max ≈ 201 KB for n2 `words.json`); station files warn over 64 KB (design 08 §14 said 20 KB, but `m` at both rates makes a three-text Green station ≈ 41–44 KB raw / 7 KB gzipped; max measured s52 `stories.json` 44.5 KB, 0 of 53 over); manifest ≈ 92 KB compact for T1, ≈ 157 KB for T1 + T2, ≈ 214 KB raw for T1 + T2 + T3 (§4; accepted budget 256 KiB since 2026-10-18, one `files[]` list; max level index n3 `sentences.json` 301 KB = 301,110 bytes in the three-tier `--dry-run --fixtures` render — the same file as the 306 KB core + pool figure, a different measurement; 0 of 16 over) |
| Sidecars | `files.json` ≈ 124 KB, `kana.json` ≈ 644 KB for T1 + T2 — in the core tar, never fetched by the runtime, not budgeted |
| `skipped.jsonl` | < 2 % of clips after the ladder (the render exits 1 over it unless `--allow-skips`); every `pitchConfidence: high` word clip carries `pv: true` or is skipped; a text with a skipped line ships without its `whole` track (§3.2) |
| dist | ≤ 900 MB |
| Release | one tag `audio-<audioVersion>`, per-tier assets, `reusedBytesShare ≥ 0.99` after a one-word fix; only a whole-corpus real render is packed (`manifest.partial === null`, `dryRun === false`) |

**Accepted by the lead (2026-10-18)** — the documented deviations from the first draft of design 08 §7 / §14: `files[]` entries carry no `sha256` (it is in the `files.json` sidecar; `+≈ 46 KB` compact to restore), the station-file warning threshold is 64 KB, and the manifest budget is ≤ 256 KiB raw (`MAX_MANIFEST_BYTES`; first set to 160 KiB from the T1 + T2 measurement, raised the same day once the three-tier dry run measured ≈ 214 KB raw — 1,664 sprites ≈ 129 B each, ≈ 30–40 KB gzipped — rather than splitting `files[]` per belt); the render only warns over it, never fails.

Clean-clone rehearsal: `git clone --depth 1 … && npm ci && npm run content:index && npm run audio:fetch && npm test && npm run build && npm run audio:check`; the same with `workflow_dispatch audio=false` builds and `vite preview` speaks through the device voice.
