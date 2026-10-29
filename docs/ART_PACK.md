# TSUZUKU — print pack runbook (design 09 §12.1 d77–d78)

The print pack is a set of public-domain ukiyo-e prints — Hiroshige and Hokusai from the Art Institute of Chicago's CC0 open access — encoded once as WebP, named by content and described by one **manifest**. The site never blocks on it: CI fetches the pack as a GitHub release asset when one is published (exactly as it fetches the voice pack), and a build without it keeps the drawn room. This file is the contract between the sourcing pipeline (`scripts/art/*`, the pipeline owner) and the prints runtime (`src/art/prints/`): **§2–§3 are the exact shapes the runtime reads** (`src/art/prints/types.ts` `parseArtManifest` parses §3.1 and rejects anything else). Everything else is the operator's runbook. `docs/AUDIO_PACK.md` is the model; where the two packs differ this file says so.

Every print the learner meets is captioned the way the chrome teaches: the artist and the title in Japanese with their reading and English gloss, the series and date, and the museum's credit line. Only CC0 works ship (the pipeline asserts `is_public_domain` on every record), and no raster file is committed to the repository.

## 1. Layout on disk

```
public/art/                               gitignored: written by art:source locally, by art:fetch in CI
  manifest.json                           tsuzuku.art/1 (§3.1) — the only file the runtime fetches (./art/manifest.json, page-relative)
  prints/<id>-<sha8>.webp                 one WebP per print, 1,400 px wide, q 82 — e.g. prints/hoeido-11-mishima-3f9c2e1b.webp
public/art-pack.json                      COMMITTED: the pointer CI fetches (tsuzuku.art-pack/1, §3.2); the placeholder lists no assets
scripts/art/curation/*.json               COMMITTED: the hand-picked lists (tsuzuku.art-curation/1, §2): tokaido.json (55 Hōeidō stops), calendar.json (72 kō + 12 nights)
.art-cache/                               gitignored: the pipeline's working files
  records/<aicId>.json                    the museum record, cached so a rerun asks nothing (--refresh-records to re-ask)
  raw/<aicId>-<image_id>-1600.jpg         the museum JPEG at full/1600, keyed by object, scan and width (kept; a re-run downloads nothing it already has; a museum re-scan or a width change downloads afresh and retires the old raw; --force re-downloads)
  webp/<id>.webp · <id>.lqip.webp · <id>.key   the print, its 24 px preview and the key sha256(raw) + encoder string (method, source width and preview quality included): a changed source or setting re-encodes, nothing else does
  release/tsuzuku-art-<artVersion>.tar    art:pack's asset (+ its .list)
```

`sha8` = the first 8 hex digits of sha256 over the WebP's bytes, so a print's path changes only when its pixels do: a re-encode with the same settings keeps every name, and the service worker's cache-first bucket (§8) can never serve a stale print. Every path inside the pack is relative to `public/art/` and is served at `./art/<path>`.

## 2. Curation — `scripts/art/curation/*.json` (`tsuzuku.art-curation/1`)

```json
{
  "schema": "tsuzuku.art-curation/1",
  "series": {
    "hoeido": { "ja": "東海道五拾三次之内", "reading": "Tōkaidō gojūsan tsugi no uchi", "en": "Fifty-three Stations of the Tōkaidō (Hōeidō edition)",
                "artist": { "ja": "歌川広重", "reading": "Utagawa Hiroshige", "en": "Utagawa Hiroshige" }, "date": "c. 1833–34" }
  },
  "entries": [
    { "id": "hoeido-11-mishima", "aicId": 10926,
      "title": { "ja": "三島 朝霧", "reading": "Mishima, asagiri", "en": "Mishima: Morning Mist" },
      "series": "hoeido", "focus": [0.5, 0.42], "roles": { "station": 11 },
      "why": "one line: which impression, and the alternates considered" }
  ],
  "calendar": { "day": ["<id>", "… 72 in all"], "night": ["<id>", "… 12 in all"] }
}
```

- Every `*.json` in the directory is merged, sorted by file name (`mergeCuration`): a duplicate id, a series that differs between files, two prints claiming one station or one kō — each is an error.
- `id` is `<series>-<nn>-<name>`, lowercase ASCII (`printId` / `ID_RE`; `slugify` drops macrons: Ōtsu → `otsu`). `aicId` is the Art Institute's artwork id (the number in `https://www.artic.edu/artworks/<id>`).
- `title`, `series` and `artist` are **trilingual** — `ja`, `reading`, `en`, all three non-empty: the teaching voice never shows a Japanese string without its reading and gloss. An entry may override its series' `artist` or `date` (a mixed series). Japanese lives here and in the manifest only, never under `src/`.
- `focus` is the `[x, y]` focal point (0..1) of a cover crop: the station band and the Road thumbs crop toward it; the hero shows the whole sheet.
- `roles` build the three tables: `station` 0..54 (0 Nihonbashi … 53 Ōtsu, 54 Kyoto — Sanjō Ōhashi, the Road's `END_NUMBER`), `kos` (kō indexes 0..71 it serves by day; kō index = `sekki.index × 3 + step`, sekki 0 = Risshun, Feb 4), `nightMonths` (1..12). An explicit `calendar` block overrides role-derived slots. A full run **stops before the first download** when any of the 55 + 72 + 12 slots is empty (`tableGaps`).
- `why` is the curator's one line (which impression, the alternates considered). It is neither shipped nor hashed: editing it moves no byte and no `artVersion`.

The landed curation: `tokaido.json` — the 55 stops of the Hōeidō Tōkaidō (the first-state Buckingham or the Gookin impression where the museum holds several); `calendar.json` — 72 day prints and 12 night prints drawn from *Thirty-six Views of Mount Fuji* (Hokusai), *One Hundred Famous Views of Edo*, *Sixty-nine Stations of the Kisokaidō* and *Eight Views of Ōmi* (Hiroshige), plus the Hōeidō sheets that fit a season. 127 prints, five series, two artists.

## 3. Manifest and pointer

### 3.1 `public/art/manifest.json` (`tsuzuku.art/1`)

```json
{
  "schema": "tsuzuku.art/1",
  "artVersion": "p-3f9c2e1b07",
  "generatedAt": "2026-10-28T20:00:00.000Z",
  "encoder": { "tool": "cwebp", "quality": 82, "width": 1400, "lqip": 24 },
  "sources": [{ "museum": "Art Institute of Chicago", "license": "CC0 1.0", "url": "https://www.artic.edu/open-access/open-access-images" }],
  "prints": [{
    "id": "hoeido-11-mishima",
    "file": "prints/hoeido-11-mishima-3f9c2e1b.webp",
    "bytes": 169352, "sha256": "<64 hex>", "width": 1400, "height": 897, "orientation": "landscape",
    "lqip": "data:image/webp;base64,…",
    "focus": [0.5, 0.42],
    "artist": { "ja": "歌川広重", "reading": "Utagawa Hiroshige", "en": "Utagawa Hiroshige" },
    "title":  { "ja": "三島 朝霧", "reading": "Mishima, asagiri", "en": "Mishima: Morning Mist" },
    "series": { "id": "hoeido", "ja": "東海道五拾三次之内", "reading": "Tōkaidō gojūsan tsugi no uchi", "en": "Fifty-three Stations of the Tōkaidō (Hōeidō edition)" },
    "date": "c. 1833–34",
    "source": { "museum": "Art Institute of Chicago", "objectId": 10926, "url": "https://www.artic.edu/artworks/10926", "accession": "1932.170", "creditLine": "Gift of H. R. Warner", "license": "CC0 1.0" },
    "roles": { "station": 11 }
  }],
  "stations": { "0": "hoeido-00-nihonbashi", "…": "…", "54": "hoeido-54-kyoto" },
  "calendar": { "day": ["<id>", "… 72 in all"], "night": ["<id>", "… 12 in all"] }
}
```

- `artVersion` = `p-` + 10 hex of sha256 over the merged curation (keys sorted, `stableStringify`, each entry's `why` left out) ⏎ the encoder string (`cwebp q82 w1400 lqip24 m6 src1600 lq40` — the shipped `encoder` object, then cwebp's method, the IIIF source width and the preview quality, which the manifest does not carry but which decide the bytes): the id moves when a print, a title, a focus or any encoder setting does, and not otherwise — two packs with different bytes never share an id, and a `why` edit makes no release. The release tag is `art-<artVersion>`, the asset `tsuzuku-art-<artVersion>.tar`.
- `file` is `prints/<id>-<sha8>.webp` (`printFile`); `orientation` follows `width ≥ height`; `lqip` is the 24 px `-q 40` preview inlined as a `data:image/webp;base64,` URI, ≤ 1,000 characters — it is the frame's `background-image` until the print lands, and the whole table of 127 stays light enough for one fetch.
- `stations` has **every** key `"0"` … `"54"` and nothing else; `calendar.day` has exactly 72 ids, `calendar.night` exactly 12; every id in the three tables is a print of the pack; `roles` on a print agree with the tables (`manifestProblems`). The runtime parser is all-or-nothing: one bad row, one missing stop or slot and the whole manifest is rejected — a surface has a complete gallery or none, never a gap.
- `source.accession` and `source.creditLine` are the museum's `main_reference_number` and `credit_line`, verbatim; `source.url` is the artwork page. The caption's source line is `"<museum>, <creditLine> <accession> · <license>"` (`sourceLine` in `src/art/prints/select.ts`; a blank credit or accession drops cleanly).

### 3.2 `public/art-pack.json` (`tsuzuku.art-pack/1`) — the committed pointer

```json
{ "schema": "tsuzuku.art-pack/1", "repo": "sunkencity999/tsuzuku", "artVersion": null, "tag": null, "assets": [], "credits": [] }
```

The voice pointer's shape with `artVersion` in place of `audioVersion`, and one asset, tier `prints`: `assets: [{ "tier": "prints", "name": "tsuzuku-art-<artVersion>.tar", "sha256", "bytes" }]`, `tag: "art-<artVersion>"`, `credits: ["Art Institute of Chicago · CC0"]`. An empty `assets` list means **no pack**: `art:fetch -- --optional` prints `art pack: none — the drawn room stands` and exits 0. `scripts/audio/fetch-audio-pack.ts` reads either pointer (`PointerLike`), so the fetch is one body for both packs.

## 4. Sourcing — `art:source` (build Mac, never CI)

`curation → museum record → IIIF JPEG → cwebp → manifest`; every step is keyed by content and resumable. Requirements: Node 26 (the scripts are `.ts`, run directly) and the `cwebp` CLI on `PATH` (`brew install webp` — libwebp; the project adds no npm dependency).

```
npm run art:source -- --dry-run                                           # the merged curation, the three tables with their gaps, the artVersion; no network
npm run art:source                                                        # the whole pack: records → .art-cache/raw → cwebp → public/art/{manifest.json,prints/}
npm run art:source -- --only hoeido-11-mishima --dest /tmp/art-scratch    # one print: a PARTIAL manifest (never packed); a complete public/art is not overwritten without --force
npm run art:source -- --limit 5 --dest /tmp/art-scratch                   # a smoke run
```

Options: `--dry-run`, `--only <id,…>`, `--limit N`, `--force` (a partial run may overwrite a complete manifest, and every raw the run touches is downloaded again), `--refresh-records` (ask the museum again instead of `.art-cache/records/<aicId>.json`; how a re-scanned image is noticed — records are otherwise cached, and a rate-limited request (HTTP 429) is retried after 2, 4, 8, 16 and 32 s), `--curation scripts/art/curation`, `--dest public/art`, `--cache .art-cache`, `--cwebp cwebp`.

1. **Merge and check the tables.** `readCurationDir` → `mergeCuration` → `tableGaps`; a full run stops here on any gap, before the first byte is fetched.
2. **Records.** `GET https://api.artic.edu/api/v1/artworks/<aicId>?fields=id,title,artist_title,date_display,credit_line,main_reference_number,image_id,is_public_domain,dimensions` (≤ 4 in flight). `recordProblems` refuses a record whose `is_public_domain` is not `true`, that has no `image_id`, no accession number or no credit line — **a print that is not CC0 cannot ship**.
3. **JPEGs.** `https://www.artic.edu/iiif/2/<image_id>/full/1600,/0/default.jpg` streamed to `.art-cache/raw/<aicId>-<image_id>-1600.jpg` (`streamToFile`, the voice fetch's body); a present, non-empty file is reused unless `--force`. The name keys the raw by the museum's scan and the source width, so a re-scan (a new `image_id` on the same object) or a width change downloads afresh and retires the earlier raw — and a re-scan is logged loudly (`RE-SCANNED`), because new pixels arrive under an unchanged `artVersion`: review the sheet before packing. Downloaded bytes are data: hashed, read for their header and handed to `cwebp` — never executed or imported.
4. **Encode.** `cwebp -q 82 -m 6 -resize 1400 0` → `.art-cache/webp/<id>.webp`, and `-q 40 -resize 24 0` → `<id>.lqip.webp`; `<id>.key` holds sha256(raw) + the encoder string (`cwebp q82 w1400 lqip24 m6 src1600 lq40`), so only a changed source or setting — the method included — re-encodes. The WebP's own header (`webpDimensions`: VP8 / VP8L / VP8X) gives `width × height`. A print over 400,000 bytes or a preview over 1,000 characters stops the run (lower the quality or crop the source).
5. **Manifest.** `buildPrint` rows (the artist from the entry or its series; the date from the entry, the series or the record's `date_display`), the tables from the curation, `manifestProblems` empty for a full run, then the files are copied to `public/art/prints/` and the manifest is written last. A full run prunes prints the manifest no longer names; a `--only` / `--limit` run writes a PARTIAL manifest (full tables, some prints) that `art:check` fails and `art:pack` refuses.

**Review before packing.** Nothing generates a contact sheet yet: open `.art-cache/webp/` (or `public/art/prints/`) in an image viewer and check that every sheet is the chosen impression, the right way up and uncropped; then `npm run dev` and visit the Dojo, a Station and the Road to judge the `focus` crops on the band and the thumbs. Adjust `focus` in the curation and re-run — the encode is reused, only the manifest (and the `artVersion`) moves. The approved look — mat, caption typography, shelf of seals, station band, road thumbs — is the concept page the user signed off, kept outside the repository.

## 5. Check — `art:check`

```
npm run art:check                                     # fails without a manifest
npm run art:check -- --optional                       # what CI runs after the build: no manifest → "art pack: none — the drawn room stands", exit 0
```

`manifestProblems` (the schema and version; every print's trilingual title / artist / series, its source accession and credit line, `lqip` ≤ 1,000 chars, `bytes` ≤ 400,000; the station table complete 0..54 and nothing else; `calendar.day` 72 and `calendar.night` 12; every id resolving; roles agreeing with the tables; the prints' total ≤ 30 MB), then the files: every file the manifest names exists with its bytes and sha256, and its own WebP header says the manifest's `width × height`. Each failure is one `FAIL:` line; exit 1 on any. `--art <dir>` points it elsewhere.

## 6. Pack and publish — `art:pack`, `art:publish`

```
npm run art:pack                                      # .art-cache/release/tsuzuku-art-<artVersion>.tar (manifest.json + prints/**) and public/art-pack.json rewritten
npm run art:publish                                   # DRY RUN: verifies the tar against the pointer, prints the gh commands
npm run art:publish -- --yes                          # the real release art-<artVersion> on sunkencity999/tsuzuku (lead only; an existing release is uploaded to with --clobber)
git add public/art-pack.json                          # the pointer is the only committed output; commit it together with the curation that produced it
```

One tar, built with the system `tar` (`-C public/art -T <list>`; GNU tar and bsdtar both take a list file). `art:pack` refuses a manifest with problems (a partial run, a gap) or a file missing on disk — only a whole, checked pack ships. `publish` verifies the local tar's sha256 and bytes against the pointer before it plans anything; the release notes name the museum, the licence and the asset's sha256.

## 7. CI fetch — `art:fetch` (`deploy.yml`)

```
npm run art:fetch -- --optional                       # what CI runs, after the voice pack
```

`fetch-art-pack.ts` calls the voice pack's `fetchAudioPack` with the art pointer, `public/art` as the destination, the none message and the label `art pack`: the release `art-<artVersion>` is looked up through the GitHub API (`GITHUB_TOKEN`), the asset is streamed to a temp file and hashed while streaming, verified against the pointer's sha256 and bytes, and only then `tar -xf` into `public/art`. **No pack** — no pointer, an empty asset list, a 404 release — exits 0 with the none message; **every other failure** (a hash or size mismatch, a failed download, an API error, a failing tar) exits 1 whatever the flags and leaves `public/art` untouched. `deploy.yml` runs `content:validate … → content:index → audio:fetch → art:fetch → test → build → audio:check → art:check` (every pack step `-- --optional`); the `workflow_dispatch` inputs `audio` and `art` (default true) rehearse the no-pack paths. Cost per deploy with the pack: ≈ 20 MB download + ≈ 20 MB more in the Pages artifact (the pack budget caps it at 30 MB).

## 8. What the runtime does with it

- **Load** (`src/art/prints/load.ts`): `./art/manifest.json` is fetched once per session behind first paint (`useArtManifest`); a 404 or a malformed document settles `artStatus 'none'` for the session; a thrown fetch or a 5xx (offline — the worker's 504 for a manifest it never cached) settles `'none'` for now and the next surface's `useArtManifest()` asks again, the status never going back to `'loading'` (the drawn fallback stays up until the retry succeeds); no console line either way, and no surface hangs a print until `'ready'`. The parser (`types.ts` `parseArtManifest`) enforces §3.1 and additionally requires `file` to be a safe relative path (no leading slash, scheme or `..`) and `lqip` a base64 `data:image/…` URI. A build without the pack says so at build time: `vite.config.ts` defines `import.meta.env.VITE_ART_PACK` as `false` when `public/art/manifest.json` is absent (CI fetches before it builds), and `load.ts` then starts the session at `'none'` with no request — the Dojo draws its room on the first paint instead of holding an empty box through a round trip to a 404 (which the worker never caches); the dev server and the tests leave the flag unset and keep the fetch.
- **Select** (`select.ts`, deterministic, no RNG): the Dojo's print of the day is `calendar.day[koIndexOf(today)]`; when `skyPhase(hour)` is `night` it is `calendar.night[month − 1]` (dawn and dusk keep the day print); a station's headpiece and its Road thumb are `stations[n]`.
- **Show** (`PrintFigure.tsx`): hero (the Dojo, with caption), band (the Station headpiece, 4:1, cropped toward `focus`), thumb (the Road, 4:3); the LQIP is the frame's background until the image lands; with the data saver on, a "Show the print" button stands in for the image; a print that does not arrive (a 404 after a republished pack dropped its name, a 504 offline) keeps the LQIP as the picture with `data-failed` on the figure — never a fade that waits for ever, never a broken-image glyph. The hero caption is `artistJa《titleJa》`, then `artistEn · titleReading · titleEn`, then "from *seriesJa* seriesReading · seriesEn, date", then the source line — the credit rule, on every hero. The title line is `--font-ja` through `[lang="ja"]`, never Mincho (§9).
- **Cache** (`public/sw.js`): `art/manifest.json` network-first into the stable bucket `tsuzuku-art-v1`, which `activate` never clears — a republished pack replaces the print files the deploy serves (`art:fetch` unpacks only the new manifest's names), so the page must read the new manifest on the first load after it; the cached copy answers offline or on a 5xx, and a 404 passes through (a build without the pack shows the drawn room, never a cached manifest's gone names). `art/prints/*.webp` cache-first in the same bucket (content-addressed names never go stale; a cached print is right for ever). `art-pack.json` is not intercepted (a build-time file).
- **Credits** (`src/app/pages/AboutPage.tsx`): the Prints (画) section lists every artist with the series they contribute and the count, then `<museum> · <license>` linked to the open-access page; without a pack it says the drawn room stands; the licences list carries the prints line (public domain, CC0 scans, not CC BY-SA).

## 9. Budgets and acceptance

| Item | Number |
|---|---|
| One print | ≤ 400,000 bytes (`MAX_PRINT_BYTES`); 1,400 px wide, `cwebp -q 82 -m 6` (the brief's Mishima sheet: 169,352 B) |
| LQIP | 24 px wide, `-q 40`, ≤ 1,000 characters as a data URI (`MAX_LQIP_CHARS`) |
| Pack | ≤ 30 MB (`MAX_PACK_BYTES`); the landed curation of 127 prints is expected ≈ 20 MB |
| Manifest | one fetch per session; 127 rows with inline previews, an estimated ≤ 220 KB raw (≈ 1.7 KB a row) — the integrator records the measured figure |
| Tables | stations 55 / 55, day 72 / 72, night 12 / 12 — `art:source` stops on a gap, `art:check` fails one, the runtime rejects one |
| CSS | `src/art/prints/PrintFigure.css` ≤ 1,600 B (1,588); `CSS_CEILING_PHASE` is raised by the integrator only, never above 421,000 |
| Fonts | no new UI kanji (the inventory stays 550: artists, titles and series are data); the hero caption's title line is `--font-ja` through `[lang="ja"]` — zero font bytes. It was `.mincho` for a day, and the cost was not the 204 KB `base` slice alone: resolved against `fonts.css`'s unicode-ranges, every one of the 127 curated artist + title lines needs `ShipporiMinchoB1-base` (208,036 B), 74 also need `-rest` (424,276 B, the U+4E00–9FFF catch-all) and most need level slices (n4 104 lines, n2 39, n3 28, n5 36) — 237,868 B on the lightest day, 662,144 B median, 830,104 B at most per cold cache, against the 07 §9 budget of 250 KB for every first-paint font together, with `font-display: swap` re-flowing the line as each slice lands. A Mincho caption needs a third Shippori slice cut from the curation's code points (339 glyphs ≈ 85 KB at the shell's ≈ 250 B a glyph, declared after `base` like `shell`, mirrored in `fonts.test.ts`) — the integrator's call, with this number. `fonts.test.ts` now walks `src/art/prints` and checks that no `.tsx` in the fenced directories mounts `.mincho` / `.neon` |
| Motion | the only transition is `opacity` on the image (reduced motion zeroes it) |
| Licence | every record `is_public_domain: true`; `source.license` `CC0 1.0`; the credit line and accession number shipped verbatim |

Acceptance: `art:check` ok (0 `FAIL`) on the sourced pack; `art:pack` builds one tar and rewrites the pointer; the `art:publish` dry run names the tag and the asset; after `--yes` and the pointer commit, a CI run fetches, tests, builds and checks green, and the live site serves `art/manifest.json` and the prints with the manifest's byte counts; a `workflow_dispatch` with `art=false` builds the drawn room. Clean-clone rehearsal: `git clone --depth 1 … && npm ci && npm run content:index && npm run art:fetch && npm test && npm run build && npm run art:check`.

Owed: `art:check` runs the pipeline's `manifestProblems`, not the runtime's `parseArtManifest`; the two agree on every shape shipped today, but a release gate that also runs the runtime parser over the manifest (so a pack the browser would reject can never publish) is the pipeline owner's next step.

## 10. The museum and the credit rule

**Art Institute of Chicago open access** (verified 2026-10-28): CC0 1.0 for public-domain works (`is_public_domain: true` in the API). Records: `GET https://api.artic.edu/api/v1/artworks/<id>?fields=…` → `data.{ id, title, artist_title, date_display, credit_line, main_reference_number, image_id, is_public_domain, dimensions }`. Search: `GET https://api.artic.edu/api/v1/artworks/search?q=<terms>&limit=100&page=N&fields=…`. Images through IIIF: `https://www.artic.edu/iiif/2/<image_id>/full/<width>,/0/default.jpg` — public-domain works serve up to `full/3000,`; `full/max` is 403. Send a User-Agent: the API takes the full `tsuzuku-art/1 (+https://github.com/sunkencity999/tsuzuku)`; the IIIF host sits behind a challenge page that rejects a User-Agent carrying a URL (403 for every `(+https://…)` shape, 200 for the bare token), so the JPEGs are requested as `tsuzuku-art/1`.

**The credit rule.** CC0 asks for nothing; the dojo credits anyway, because the caption is a lesson. Every print the learner sees carries its title as a reading (`歌川広重《三島 朝霧》` — Utagawa Hiroshige · Mishima, asagiri · Mishima: Morning Mist: the reading is written with a comma, never with the caption's own separator), its series with its reading and the date, and the museum's own credit line with the accession number (`Art Institute of Chicago, Gift of H. R. Warner 1932.170 · CC0 1.0`). The About page repeats the museum line with the open-access link and says, beside the CC BY-SA line for the dojo's own art, that the prints are public domain and not CC BY-SA. Nothing in the pack is a franchise image, a living person or an operator's signage (design 01 §4.1).
