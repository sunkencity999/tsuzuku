# TSUZUKU — 09 · Design Language and Motion: Washi & Sumi

**Status:** FINAL spec (2026-10-18). **Extends design 01 §4 (visual identity) and SUPERSEDES 01 §4.5 (motion)**; 01 §4.1–§4.4 remain in force except where a row below names them. Nothing in 02–06 (pedagogy, progression, sessions, exercises, SRS, rewards) is reopened: every reward stays deterministic (06 §7), every unlock condition visible, every streak rule as 03 §7 wrote it. Where this file and 01 disagree on *how things look and move*, this file wins; `docs/ARCHITECTURE.md` and `src/content/types.ts` still win on ids, paths, storage keys and type names. Design history: synthesised from the design fleet of 2026-10-18 — five readers' maps (tokens/type/surfaces, motion/shell, home/return loop, surfaces audit, art primitives), five visions, three judges (taste, habit, build). The judges' consensus spine is **Vision 1, "Washi & Sumi — the book that takes ink"**; the governing rules of Vision 4, the glow discipline and day-safe neon tokens of Vision 3, the motion engineering of Vision 2 and the road signage of Vision 5 are grafted where a judge named them. Everything a judge rejected is left out unless a footnote argues it (Appendix A lists the omissions). Every file:line below was read in the landed tree (`85d7606`), not assumed.

## 1. Thesis and the one idea

TSUZUKU should feel like a goshuin-chō the learner owns: a book of good paper that takes ink. Nothing in it is plastic. Paper has grain; ink bleeds, then dries overnight; a seal is pressed and leaves a slightly imperfect mark; a page carries the real date; and the colour of the paper follows the real calendar through the twenty-four sekki. A learner comes back tomorrow because the book is different tomorrow — yesterday's ink has dried, today's page carries a new date and, every fifteen days, a season name they can now read — and because an unfinished stroke asks to be finished. つづく is a promise the paper keeps, not a debt the learner owes.

**The one idea: everything is printed.** Edo is the hand — brush, seal, washi. The arcade is a woodblock *print* of an arcade: flat inks, bokashi gradient bands, a deliberate 1 px misregistration where a lesser design would put a glow, in the manner of Kobayashi Kiyochika's kōsenga, the 1880s Tokyo night prints under gaslight (public domain, no franchise). The JRPG status window is the print's cartouche: its notched `clip-path` (`src/styles/components.css:29`) reads as a kentō registration mark, and it is reserved for the character-sheet surfaces so the frame means "character sheet" again. Three eras, one press. The eras differ in **tempo, not colour**: Edo moves at 400–2,400 ms, the arcade at 40–220 ms, the cartouche at 220–600 ms.

Two governing rules sit above every section of this file and are testable:

1. **Effort makes noise; the clock never does.** The brush, the seal and the graded answer may sound (01 §5 palette). Arrival, the day roll, a sekki boundary, the moon, a theme change, dusk falling and Monday are silent. No sound is ever tied to opening the app.
2. **Nothing glows in Dojo Morning. In Arcade Night only light sources glow** — lanterns, the hearth, the brand once a day — never more than six glowing elements in a viewport, and a glow never animates: the glowing thing is a static pseudo-twin whose *opacity* changes. `text-shadow`, `box-shadow` and `filter` are never animated properties.

Today (measured): the UI is flat `var(--bg)` with zero texture (`src/styles/tokens.css:148-158`); 37 `@keyframes` live in 15 CSS files and fire almost only inside modals; there is no page transition (the only motion between screens is the accidental `html { scroll-behavior: smooth }` glide at `src/styles/base.css:25` applied to `router.ts:36`); the core rep loop never calls `sfx()`; the forgiveness the streak machine already grants (`Streak.freezes`, `weekly`, `restDaysTaken`, `repairWindow`, `src/shared/store-types.ts:160-178`) renders nowhere; and the ceremony stage, the sky and the hearth are hard-coded hex rather than tokens. This document turns those debts into one language.

## 2. The world

### 2.1 Materials

Six materials, each with a source already in the kit. Everything the learner sees is one of them; everything that moves is one of them doing what it does.

| Material | Token / source | What it does |
|---|---|---|
| **Washi** 和紙 — paper | `--bg`, `--surface`, `--raised`; grain from `--paper` (one static `feTurbulence` tile, `src/art/pixel.ts grainFilter :112` / `src/art/svg.ts turbulence :258`, exported once as an `svgDataUrl`) | receives ink; never moves; has grain at ≤ 6 % |
| **Sumi** 墨 — ink | `--fg`, `--stage-*`; `brush.ts inkBleed :208`, `splatter :221`, `dryBrush :186`, `dashWrite :365` | spreads (nijimi), dries (kawaku), draws (hiku), dries out (kasure) |
| **Shu** 朱 — cinnabar seal paste | `--shu`, `--shu-text`; `brush.ts sealFrame :331` | is pressed (osu) |
| **Kin** 金 — gold leaf | `--kin`, `--kin-text`, `--glow-kin` (Night only) | settles; marks XP, dan, lanterns, repair |
| **Ai** 藍 — indigo dye | `--ai`, `--kon`, `--ai-dye` | notes, listening, water and sky |
| **Wood** 木 — rollers, shelves, rack | `WOOD` / `WOOD_LIGHT` (`src/art/dojo/room.ts:111-112`), promoted to `--wood` / `--wood-light` | holds things: jiku, shelf rails, the belt rack |

Arcade Night adds a seventh, **urushi** (lacquer): the same sumi with a warm cast, where the grain becomes fine gold dust at 4 %. The two themes are **not inversions**: Dojo Morning is *paper receiving ink*; Arcade Night is *lacquer receiving gold*. Vermilion, gold and foam-white are the marks on lacquer; indigo and matcha read as pigments on paper.

### 2.2 Light

Dojo Morning is light through shōji: diffuse, warm, no cast shadows. Depth is paper shading — an inset `box-shadow` as `src/art/ceremony/StampPress.css:38-47` already does — never a drop shadow. Arcade Night is lamplight on lacquer: the only warm light is gold and vermilion, and it comes from things that are lit (lanterns, hearth, the brand at its daily ignition). The ceremony and End Card stage stays sumi in both themes — already true by accident through hard-coded hex (`src/session/EndCard.css:4-8`, `src/art/ceremony/CeremonyHost.css:3-4`, `BeltCeremony.css:3-4`, `StampPress.css:3`, `BadgeSlam.css:3-4`, `WallpaperUnlock.css:3-5`) — and becomes the declared `--stage-*` token set (§4).

### 2.3 Texture

One tokenised paper layer: `--paper`, a 128 px `feTurbulence` grain tile (`baseFrequency .9`, `stitchTiles="stitch"`, ≈ 700 bytes as a data URI), painted on `body::before` at `--paper-opacity` (.055 Morning, .04 Night with a gold tint) and on `.sheet::before`. A background image, never a live filter. The body layer sits **behind** all content (`body::before { z-index: -1 }`, plain opacity in both themes), so it blends with `--bg` only and text contrast is untouched; `mix-blend-mode: soft-light` is reserved for `.sheet::before` in Night (≤ 12 grain sheets per view), and grain is excluded from inputs and from text containers under 160 px. A1's `tokens.test.ts` asserts that `--fg-muted` on `--bg` mixed with the tile's mean grey at `--paper-opacity` shifts by under 0.1 (§10). No deckle edges, no torn paper anywhere in the shell.¹

### 2.4 Two themes as morning and night of one place

Dojo Morning and Arcade Night are the same room at 09:00 and 21:00. Geometry, class names and layout are identical; only material tokens change (`--paper-opacity`, `--glow-*`, `--stage-*` are invariant, the cartouche hairline, Dela Gothic One's role). Switching theme is **dusk falling** (§7 G): a 400 ms View Transition in which the sky darkens before the floor and the lanterns light. The real hour and season paint both themes through `data-phase` / `data-season` on `<html>` (§4.3); an opt-in **Follow the sky** mode (`Settings.theme: 'sky'`, §8) lets Dojo Morning turn to Arcade Night at dusk in `profile.tz`, so the two names finally mean times.

### 2.5 Era re-weighting (extends 01 §4.1)

| Era (01 §4.1) | Now | Weight in chrome | Tempo |
|---|---|---|---|
| Edo road & dojo | **The hand.** Paper, ink, seal, wood on every page: Road, Station, Library, Collections, stories, ceremonies, the Dojo, and the shell itself | 70 | 400–2,400 ms |
| 90s arcade | **The poster.** Drills, Rapid Fire, Gojūon Fighter, Kage as a woodblock print of an arcade: flat `--neon-c` / `--neon-m` inks, bokashi bands, 1 px vermilion misregistration on poster titles (never on reading text or numbers), kentō marks, Dela Gothic One titles. Glows go. CRT scanlines stay opt-in (01 §4.4) | 20 | 40–220 ms |
| JRPG status screen | **The cartouche.** `.status-window` reserved for Dojo status, HUD, Records tiles, End Card tally and the Leave dialog; everywhere else it becomes `.sheet` or `.card`. The ≈ 150 lines of unmounted spectacle in `src/styles/arcade.css:52-200` (eight classes no `.tsx` renders: `.glow-edge .speed-lines .halftone .ippon-flash .combo-pop .ki-glow .arcade-head .hiscore`; the `.combo[data-tier]` rules at `:139-146` are live and stay) are either mounted under `data-feel=arcade` by §9's owners or deleted | 10 | 220–600 ms |

"Synthwave Tokyo, rain-slick streets" (01 §4.1) survives as the Kiyochika print: a wet street is a bokashi band of `--kon` into `--bg` at the foot of the Kage and Records pages in Arcade Night, with no rain loop and no reflection animation.

## 3. Typography system (extends 01 §4.2)

Families are exactly those of `src/styles/fonts.css` and `tokens.css:51-56`: `--font-ui` (system Latin), `--font-ja` (system Japanese, `palt`, `--lh-ja 1.8`), `--font-pixel` DotGothic16, `--font-brush` Yuji Syuku, `--font-mincho` Shippori Mincho B1, `--font-neon` Dela Gothic One. No new family.

### 3.1 Three voices per page, never more

| Voice | Family | Job | Rule |
|---|---|---|---|
| **Brush** | Yuji Syuku | says one word: the title kanji, 一本, つづく, a station name, the hanko's kanji | always 400 weight, `line-height 1.1`; never body text; may be *written* (hiku) on first paint of a ceremony or arrival surface, shown whole on back navigation |
| **Mincho** | Shippori Mincho B1 | the reading voice: story and reader bodies, Shinsa section sheets, the End Card's omikuji (never first paint); on the **Dojo home** (the sekki label, the sentence of the day, the era date) and the **Station headpiece** (第七宿) only through the Shippori `shell` slice (≤ 40 KB, §3.5) — until that slice ships, those lines set in `--font-ja` | **fenced**: those surfaces and no others (the cream-and-serif trap closes the moment Mincho spreads); `--lh-mincho: 2`, `--measure-ja: 36em`; **Mincho never animates beyond opacity** — formality is stillness. Today `.dojo__proverb` (`src/app/pages/pages.css:241`) already pulls the 204 KB `ShipporiMinchoB1-base.woff2` onto the home screen; B1 moves it to `--font-ja` (the proverb's glyphs are not in the `shell` list) |
| **Pixel** | DotGothic16 | the carved label and every count: eyebrows, counts, XP deltas, kbd, table heads, HUD, chart labels, the colophon of every print | one `.eyebrow` (`--fs-1`, uppercase, `letter-spacing .08em`) replaces the **47** hand-rolled `__label` / `__eyebrow` classes across `src/**/*.css` (`.page__label`, `.rapid__label`, `.listen__label`, `.scramble__label`, `.tile__label`, `.story-page__eyebrow`, … — the whole label/eyebrow family, each swapped by its §10 owner: C1 for `src/exercises`, C4 for `src/input`, C3 for collections and records); never below `--fs-1` (lifts `src/records/charts.css:32,40` from 12/9 px) |
| **Poster / the number that matters** | Dela Gothic One | arcade titles (Kage VS, Rapid Fire, Gojūon Fighter, Perapera head) in Arcade Night; the one number that matters in both themes: End Card tally values, Records tile values, Kage digits, Rapid Fire best | `font-variant-numeric: tabular-nums; letter-spacing .02em; line-height 1`; titles carry the 1 px misregistration shadow (`text-shadow: 1px 0 0 var(--shu)`), numbers never; its 98 KB base slice loads **on first use** (today only `KageView.css:124`, `PeraperaRadar.css:23`, `base.css:224`), never on the Dojo's first paint — the End Card, Records and the arcade are later surfaces, so the 07 §9 budget is untouched; whether Morning keeps Dela for numbers at all is open question 4 |
| System UI / JP | `--font-ui`, `--font-ja` | controls, interactive Japanese, ruby | unchanged |

### 3.2 Scale and rhythm

The scale is unchanged (`--fs-1…8` = 0.75 / 0.875 / 1 / 1.25 / 1.75 / 2.5 / 4 / 7.5 rem). Added: `--lh-mincho: 2`, `--measure-ja: 36em`. Half of all sized rules are 12–14 px today; that stays the texture of a status screen, but the stray px literals (`charts.css:32,40,333`, `PitchLine.css:64`, `KakejikuGallery.css:144`, `StudioPage.css:233`, `Layout.css:162`) move onto the scale. Weight 600 is the house bold; brush, pixel, mincho and neon are always 400.

### 3.3 Japanese / Latin pairing rules

- Latin beside Japanese is set at **0.92 ×** the adjacent JA size with `letter-spacing .02em`; JA never shrinks or wraps inside a lockup; Latin wraps first.
- Brush baseline is lifted `0.08em` (`position: relative; top: -0.08em`) so brush JA and system Latin share one visual baseline.
- **`.title-lockup`** (replaces `RecordsPage.css:21-35`, `LibraryPage.css:20-35`, `session/pages/pages.css:16-23`, `GateView.css:22-30`): brush JA at `--fs-5`, English in `--font-ui` at `--fs-2`, uppercase, `letter-spacing .12em`, `--fg-muted`; optional `data-write` draws a brush underline (`brush.ts brushStroke :121` revealed by `dashWrite :365`, `--dur-4`).
- **`.sign`** (Road rows, Station headpiece, Library shelf heads): the zero-Japanese lockup — line 1 brush JA (`--fs-4`, `--fs-5` on a headpiece), line 2 **the reading**, line 3 English gloss at `--fs-1` `--fg-muted`, the station number in pixel `--fs-1` `tabular-nums` in the first column. The sign plate is `--surface-paper`; `--road` runs behind it as a band and never under the text (§4.1). **The reading line follows 05's rule** (its rejected-designs table: "Romaji anywhere except as input — slows kana automaticity"): romaji in `--font-ui` at `--fs-2` `letter-spacing .04em` appears **only while the learner's kana are below Green** — proper names on signage a learner cannot yet sound out are the one sanctioned exception, recorded here against that 05 row — and it is **removed, not dimmed**, once kana are Green; from then on line 2 is the kana reading as `<ruby>` over the JA in the learner's furigana mode (`src/shared/ui/Ruby.tsx`). Every glyph on the road has a reading (romaji before Green kana, kana after) and English within 16 px. Towns ahead are labelled **ahead**, never "locked".
- **Kanji numerals that teach**: station ordinals in Mincho (`.sign__ordinal`, Shippori `shell` slice) as 第七宿 beside "Station 7" (replacing the pixel eyebrow at `session/pages/pages.css:35`): decorative-with-a-label, and the learner meets 一〜十 daily. All glyphs are in every `base` slice and in the `shell` list.
- **Ruby**: gothic ruby (`--font-ja`) at 0.5 em on a Mincho body — the modern book convention and sharper at 7 px; in the tategaki column `ruby-position: over` renders to the right; fog/tap modes unchanged (`src/shared/ui/ui.css:24-60`).
- **Tategaki as structure**: the Dojo's right edge carries a permanent vertical column (§5.9, 06 §5's "Tategaki Column", which 01 §4.4 places on the right edge): today's date seal with its "Oct 18" label, the sekki in Mincho with its gloss, the kō line with its gloss, and the sentence slot — **06 §5 fixes it as "a Mastered sentence of the day"** (`sentenceOfDay`, `src/session/dojo-feed.ts:106-118`, Brown then Green items), and the slot stays **empty** until one exists. The teaser sentence and the proverb never fill it: both carry tokens the learner cannot read, which 01 §3 forbids ("Japanese appears in copy only when the learner can read it"). The column is still never empty in week one because every other line is glossed, and on days with no sentence the slot shows the greeting こんにちは · konnichiwa · hello (a new `S.columnGreeting` triple, romaji and English visible) — the one piece of Japanese a day-one learner is explicitly taught to recognise. Station pages get a vertical eyebrow down the belt-coloured left rule (`session/pages/pages.css:63`); the End Card's 次回予告 becomes a column at ≥ 720 px.

### 3.4 Display moments

| Moment | Face | Treatment |
|---|---|---|
| Arrival | brush ensō (not type) → the phase word 朝 / 昼 / 夕 / 夜 with reading and English for 2 s under the brand | hiku then nijimi |
| Page title on first paint | brush | brush underline drawn, `--dur-4` |
| 一本 | brush | written through a `dashWrite` mask in 300 ms (`ui.css:471` scale flash retired) |
| End Card | brush つづく at `--fs-7` | written over 1,200 ms, synced to the `tsuzuku` gliss |
| Tally / Records / Kage | Dela | `<Ticker>` count-up ≤ 400 ms; Kage digits roll per column |
| Station arrival | `.sign` | the JA line's wrapper enters at `transform: scale(1.43)` and settles to 1 (`--ease-press`, 400 ms); the type is set at `--fs-5` throughout — `font-size` is layout and never animates |

### 3.5 New glyphs the subsets need

`src/styles/fonts.test.ts:101-111` requires every CJK ideograph in `src/**/*.{ts,tsx,css}`, `index.html` and the manifest (comments included; tests, `src/content/fixtures/` and `kanji-stars.ts` excluded) to sit in every family's `base` slice. Checked against the landed `fonts.css`:

- **Already in every base slice (no rebuild):** 朝昼夕夜 · 日付印 · 一二三四五六七八九十 · 第宿 · 新月三半 · 火炎残氷休灰 · 型組手修行 · 次回予告 · 関所道今令和年 · 気候 · 七夕鯉桜風星 · 言霊続開旅 · 墨朱金木 · 立春雨水分清明夏小大秋白降冬雪.
- **Missing from all four base slices — one rebuild via `scripts/fonts/build-fonts.py`:** 啓 蟄 穀 満 芒 種 至 暑 処 露 寒 霜 (the twelve sekki glyphs not already covered) and 節 (the column's 節気 label): **13 code points × 4 families**, estimated under 20 KB in total. 満 also serves the moon (満月). Because these glyphs never appear in `src` (the names are JSON, §4.3), the pipeline's inventory walk would not find them: `build-fonts.py` gains an explicit `EXTRA_UI` list of the 13 code points (none exists today) and `fonts.test.ts` mirrors it (`uiKanji ∪ EXTRA_UI` in the coverage rule), so the rebuild can run first, last or alone. Until it lands, the sekki label renders the covered names in Mincho and the rest in `--font-ja` with the gloss (the fallback is designed, not accidental).
- **Never in source:** the verb kanji 滲掠引押乾捲, 昨, 閉, 紙, 藍, 絵, 版 — they appear only in this document; class names and comments use romaji (`nijimi`, `kasure`, …). Writing 滲 in a CSS comment would fail CI.
- **The 72 kō names** (菊花開, 蟋蟀在戸, …) ship as data, `public/calendar/koyomi.json` (outside `public/content/`, so `scripts/validate-content.ts` never walks it), rendered in `--font-ja` with an English gloss — the system font carries them and the font test does not scan `public/`.
- **Font budget (07 §9: initial fonts ≤ 250 KB).** Fonts load on first use, so the budget is what the Dojo's first paint actually requests. `YujiSyuku-base.woff2` is 364 KB alone, and the brand つづく pulls it on first paint; `ShipporiMinchoB1-base.woff2` is 204 KB and `.dojo__proverb` pulls it today, and this file puts Mincho on the column — DotGothic 54 + Yuji 364 + Shippori 204 = 622 KB today, 318 KB even with a Yuji `shell`. The pipeline therefore gains **two** `shell` slices: Yuji Syuku — つづく, the eight belt names, the 53 station names, 一本 気合 休 and the flame glyphs, ≈ 130 glyphs, ≤ 60 KB — and Shippori Mincho B1 — the 24 sekki names, 節気, 第宿 and 一〜十, 令和元年月日, the eight moon names, the omikuji heads, ≈ 60 glyphs, ≤ 40 KB. Each is declared *after* its `base` (so it wins the overlap), while `base` keeps the full inventory for the test's coverage rule. **First paint of the Dojo = DotGothic base 54 + Yuji shell ≤ 60 + Shippori shell ≤ 40 ≤ 154 KB**, asserted from the files on disk (A4). `fonts.test.ts` is extended at every anchor that assumes the slice set is `rest|n5…n2|base` (`:30, :86, :91, :94-95, :105, :125, :135, :140`; A4 owns the file, so this is scope, not overlap). The remainders are warmed after first paint with `document.fonts.load('1em "Yuji Syuku"', sample)` and the same for Shippori.

## 4. Color and token deltas (`src/styles/tokens.css`)

No existing value changes. Every themed token below is added to `:root` and to **both** dark blocks (`:root:not([data-theme="light"])` under the media query and `:root[data-theme="dark"]`), because `src/styles/tokens.test.ts:77-83` asserts both blocks and the media pattern; collapsing the duplicate is deferred (§12).² Invariant tokens (`--stage-*`, durations, eases, radii) are declared on `:root` only and the test asserts they are *not* redefined in dark, exactly as `--ink` is today.

### 4.1 New tokens

| Token | Dojo Morning | Arcade Night | Contrast / notes |
|---|---|---|---|
| `--dur-3` | `400ms` | same | content: page turn, card reveal, bars |
| `--dur-4` | `900ms` | same | a drawn stroke, a ceremony beat |
| `--dur-5` | `2400ms` | same | one brush-written kanji; ambient half-period |
| `--dur-fade` | `150ms` | same | **the one duration reduced motion keeps** (opacity-only rules) |
| `--stagger` | `40ms` | same | per-item delay, capped at 8 items (§6.3) |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | same | exits |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | same | the mat dim, kasure of chrome |
| `--ease-draw` | `cubic-bezier(0.3, 0, 0.1, 1)` | same | a brush lifts slowly (hiku) |
| `--ease-press` | `cubic-bezier(0.2, 0.9, 0.2, 1.15)` | same | the overshoot copied in `BeltCeremony.css:131` and `BadgeSlam.css:60`, unified (`StampPress.css:76` uses a different curve, `cubic-bezier(0.3, 1.3, 0.5, 1)`, and moves onto this token too); also the `--spring` fallback |
| `--spring` | `linear(0, .006, .025 2.8%, .101 6.1%, .539 18.9%, .721 25.3%, .849 31.5%, .937 38.1%, .968 41.8%, .991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)` | same | a damped spring in pure CSS; `@supports not (animation-timing-function: linear(0, 1)) { :root { --spring: var(--ease-press); } }` |
| `--paper` | `url("data:image/svg+xml,…")` 128 px grain tile | same tile | static image; built once by `scripts/paper-tile.ts` from `pixel.ts grainFilter`, pasted as a literal |
| `--paper-opacity` | `.055` | `.04` | `body::before` is plain opacity at `z-index: -1` in both themes; Night tints the tile gold via `mix-blend-mode: soft-light` on `.sheet::before` only (§2.3) |
| `--stage-bg` / `--stage-fg` / `--stage-muted` / `--stage-line` / `--stage-raised` | `#0B0B10` / `#F4EDE0` / `#A9A49A` / `#2C2C3A` / `#1F1F2A` | invariant | the always-sumi stage; fg 16.9:1, muted 7.9:1 on `--stage-bg`, 6.6:1 on `--stage-raised`; replaces every hex in `EndCard.css:4-8,19,133`, `CeremonyHost.css:3-4`, `BeltCeremony.css:3-4,132,139,219,225-226`, `StampPress.css:3,41-42,52`, `BadgeSlam.css:3-4`, `WallpaperUnlock.css:3-5` and `SessionView.css:72` |
| `--neon-c-text` | `#0B6660` | `#2EE6D6` | 5.85:1 on `--bg`, 6.60 on `--surface`, 5.16 on `--raised` (today's `--neon-c` measures 3.41 on washi); Night 12.5:1 |
| `--neon-m-text` | `#A8206F` | `#FF3DA6` | 5.82 / 6.56 / 5.13; Night 6.05 |
| `--glow-kin` | `none` | `0 0 6px color-mix(in srgb, var(--kin) 55%, transparent), 0 0 18px color-mix(in srgb, var(--kin) 22%, transparent)` | Night only, light sources only, never animated (§1 rule 2) |
| `--glow-shu` | `none` | same shape with `--shu` | the brand's daily ignition, the hearth |
| `--sky-top` / `--sky-mid` / `--sky-horizon` | `#4F6FD6` / `#9FC4F0` / `#F4EDE0` (day defaults) | same defaults | written at runtime by `theme.ts` from `SKY_STOPS[phase]` (`room.ts:91-96`: dawn `#1F3A93 #C9718A #F7B2C4`, day `#4F6FD6 #9FC4F0 #F4EDE0`, dusk `#1F2A6B #C9302C #E0B341`, night `#0A0F2E #1F2A6B #1F3A93`); consumers always mix ≤ 40 % with `--bg` |
| `--lamp-alpha` | `0` | `0` | runtime: 0 day · .15 dawn · .35 dusk · .6 night |
| `--sekki-pigment` / `--sekki-mix` | `var(--bg)` / `0%` | same | runtime per sekki (§4.3); mix ≤ 3 % |
| `--bg-paper` / `--surface-paper` / `--raised-paper` | `color-mix(in srgb, var(--bg) calc(100% - var(--sekki-mix)), var(--sekki-pigment))` (and `--surface`, `--raised`) | same formula | `body` and `.sheet` consume these; `--bg` itself never moves, so the 32 direct uses are untouched |
| `--belt-color` | `var(--belt-white)` | same | written by `theme.ts` from `profile.belt`; header chip, XP bar, focus ring on the Road, road surface and ceremonies tint per belt (today only `RoadNav.css:44-51` and `session/pages/pages.css:66` read it) |
| `--road` | `color-mix(in oklab, var(--belt-color) 12%, var(--bg))` | same | the road **band** behind a Road row's vignette and under the Station headpiece — never the surface under `.sign` text, which sits on `--surface-paper`; capped at 12 % because at 35 % `--fg-muted` failed AA on 9 of 16 belt/theme pairs (Morning black 2.57, Night white 2.76, Morning brown 3.28 …) and at 12 % the worst pair is 4.56 (Morning black); `tokens.test.ts` loops 8 belts × 2 themes for `--fg-muted` and `--fg` on `--road` |
| `--wood` / `--wood-light` | `#5C3A21` / `#8B5A2B` | same | promoted from `room.ts:111-112`; shelf rails, jiku |
| `--ai-dye` | `linear-gradient(180deg, var(--kon), var(--ai))` | same | listening surfaces' band |
| `--kintsugi` | `linear-gradient(90deg, var(--kin), #F2DC8A 50%, var(--kin))` | same | the repair seam, visible only while `repairWindow` is open³ |
| `--radius-paper` / `--radius-seal` | `2px` / `4px` | same | the 14 + 12 literal radii |
| `--lh-mincho` / `--measure-ja` | `2` / `36em` | same | §3.2 |

**Changed blocks:** the two reduced-motion blocks (`tokens.css:169-179`) zero `--dur-1…5` and `--stagger`; they never touch `--dur-fade`. `--kin` and `--shu` are documented as **fill-only**: the 78 `color: var(--shu)` and 45 `color: var(--kin)` rules (e.g. `components.css:447,620`, `RoadNav.css:235`, `EndCard.css:102,194`, `kana.css:139`, `RapidFire.css:136,140`) move to `--shu-text` / `--kin-text`; gold text on Dojo Morning paper sits at 2.80:1 today.

### 4.2 Contrast notes

Measured with WCAG relative luminance (the same formula as `tokens.test.ts:97`). Sekki tint at the 3 % cap, Dojo Morning: `--fg-muted` on tinted `--bg` ≥ 5.59 (worst case indigo, `#EEE7DC`), `--fg` ≥ 14.1; on tinted `--raised`, `--fg-muted` ≥ 4.95, `--kin-text` ≥ 4.61, `--shu-text` ≥ 4.86 — every pair stays ≥ 4.5. Arcade Night at 3 %: muted ≥ 7.62 on `--bg`, ≥ 6.22 on `--raised`. A 5 % tint would still pass (5.42 worst case) but 3 % is the ceiling by rule, so no entry of the 24-row table can regress. Hanko text (`--bg` on `--shu`) is 4.57 / 4.70, unchanged, which is why `components.css:90-91` forbids alpha on hanko text and `.sheet` tiles replace five of the six Dojo hanko (§9). **`--road`** is evaluated separately (§4.1): at the 12 % belt mix `--fg-muted` ≥ 4.56 and `--fg` ≥ 10.7 on every belt in both themes; `.sign` text never sits on it anyway.

### 4.3 The seasonal and time-of-day mechanism (deterministic, testable)

New pure module **`src/shared/koyomi.ts`** (暦, the calendar; snapshot-tested, no DOM):

- `skyPhase(hour)` and `seasonOf(month)` move here from `room.ts:65-83` (room.ts re-exports them).
- `sekkiOf(day: EpochDay): Sekki` — 24 entries `{ id, romaji, en, month, dayOfMonth, pigment }` at fixed Gregorian month/day pairs; the Japanese names (`ja`) live in `public/calendar/koyomi.json` beside the kō names, **not in `src`**, because `fonts.test.ts:57-66` walks every `src/**/*.ts` for CJK and `:106-111` fails on the twelve uncovered glyphs (§3.5) — so A3 lands green whether or not A4's rebuild has happened (立春 Feb 4, 雨水 Feb 19, 啓蟄 Mar 6, 春分 Mar 21, 清明 Apr 5, 穀雨 Apr 20, 立夏 May 6, 小満 May 21, 芒種 Jun 6, 夏至 Jun 21, 小暑 Jul 7, 大暑 Jul 23, 立秋 Aug 8, 処暑 Aug 23, 白露 Sep 8, 秋分 Sep 23, 寒露 Oct 8, 霜降 Oct 24, 立冬 Nov 7, 小雪 Nov 22, 大雪 Dec 7, 冬至 Dec 22, 小寒 Jan 6, 大寒 Jan 20). The real boundaries drift ± 1 day by year; the label says *traditional calendar, approximate*, and because nothing unlocks on a sekki the drift is harmless. Each entry names a `pigment` token for the paper tint: 立春 → `--sakura` 2 %, 清明 → `--matcha` 2 %, 大暑 → `--kin` 2 % (bleached), 霜降 → `--hai` 3 %, 冬至 → `--kon` 3 %, and so on — a 24-row table in the module, every mix ≤ 3 %.
- `koOf(day): Ko` — the 72 kō as five-day steps inside each sekki, names and glosses loaded from `public/calendar/koyomi.json`.
- `moonPhase(day): { fraction, name }` — synodic month 29.530588 d from the new moon of 2000-01-06 18:14 UTC; eight names (新月 shingetsu new moon · 三日月 mikazuki crescent · 半月 hangetsu half moon · 満月 mangetsu full moon and their waning twins), drawn with a two-circle mask in the shōji window.
- `nextBoundaryMs(now, tz)` — the earliest of the next 05:00 / 08:00 / 17:00 / 20:00 and the 04:00 day roll (`DAY_BOUNDARY_HOUR`, `src/shared/time.ts:9`) in the profile zone.

**`src/app/theme.ts`** gains `applyCalendar(now, tz, doc)` alongside `applyTheme`: it writes `data-phase`, `data-season`, `data-sekki`, `data-moon` on `<html>`, sets `--sky-top/--sky-mid/--sky-horizon` from `SKY_STOPS`, `--lamp-alpha`, `--sekki-pigment` / `--sekki-mix`, `--belt-color` from `profile.belt`, and `<meta theme-color>` from the sky horizon mixed 40 % into `--bg` (so the browser chrome tells the hour); `startThemeSync` arms a timer for `nextBoundaryMs` in the `msUntilNextDay` + `startDayRoll` idiom (`src/store/day.ts:119-136`) and re-applies on `visibilitychange`. Everything is a function of `(now, tz, profile.belt, settings)`; the test feeds fixed instants and asserts the attributes and properties byte-for-byte.

## 5. Materials and components

Vocabulary and names. Existing names are kept: Dojo, Road, Station, Mon, Kakejiku, Goshuin, Hanko Button, Status Window, Forge Bar, Scroll Card, Combo Counter, Judge Card, Tategaki Column, the つづく end card. Verb classes use romaji. New long-duration motion lives in a new **`src/styles/motion.css`** (imported after `arcade.css`, the last style import at `src/main.tsx:37`, by A2) with its own guard test, because `src/styles/components.test.ts:79-84` requires every literal in `components.css` to be 60–240 ms and `motion.css` needs `--dur-3…5`.

### 5.1 `.sheet` — paper you can almost touch

Replaces `.card` on Edo pages (Road, Station, Library, Collections, the Dojo's forecast and session tiles) and absorbs the washi look re-drawn locally in `StampPress.css:38-52` and `GoshuinBook.css:50-63`.

```css
.sheet {
  position: relative;
  background: var(--surface-paper);
  border-radius: var(--radius-paper);
  box-shadow:
    inset 0 0 36px color-mix(in srgb, var(--stage-bg) 6%, transparent),
    0 1px 0 color-mix(in srgb, var(--stage-bg) 14%, transparent);
}
.sheet::before {
  content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: var(--paper); opacity: var(--paper-opacity);
}
.sheet--gutter::after { /* the goshuin spread's centre line */
  content: ""; position: absolute; inset: 8px auto 8px 50%; width: 1px; background: var(--line);
}
```

Light: warm washi, inset shading only. Dark: the same box on `--surface-paper` (lacquer), grain at .04 with `mix-blend-mode: soft-light` so it reads as gold dust. Reduced motion: no motion involved.

### 5.2 Ink rules — `.hairline`

The header's bottom rule and every section rule become a fibre hairline: a 1 px `border-bottom: 1px solid var(--line)` masked by a static `mask-image` of `turbulence()` noise (`svg.ts:258`) so the line breaks like a brushed rule. ≤ 4 per view; `forced-colors: active` drops the mask. Static in all modes.

### 5.3 Seals — `.hanko`, `.seal`, `.seal-date`, `.ink-wet`

The Hanko Button keeps 01 §4.4's spec (square vermilion, `scale(.96)` for 60 ms) and finally gets its ink-bleed: `.hanko.is-pressed` (declared at `components.css:152-163`, toggled nowhere today) is set on `pointerdown` and cleared on `pointerup`, and its `ink-bleed` keyframe — which animates `box-shadow` today (`:156-162`) — is **redefined** as a `::after` ring in `--shu` that scales 1 → 1.25 and fades .45 → 0 (transform + opacity only, §6.7 rule 1). **One hanko per view** (the header comment at `components.css:17` and `:89-91`): the Dojo's six (`DojoPage.tsx:153,245,336,366,437,492`) become one hanko (the recommended session) and `.sheet` tiles with a `.seal` corner.

`.seal-date` is the 日付印, a round seal 28 px with the day in kanji numerals (十八日) in brush, pressed on the tategaki column by the first session of the day, **with a visible pixel micro-label beneath it** ("Oct 18", `--fs-1`, `--fg-muted`) so it is decorative-with-a-label for a learner who cannot yet read 十八日; the accessible name is the English date. `.ink-wet` is kawaku's wet layer (§6.2): a `::after` of `currentColor` at 30 % opacity through one shared `<filter id="ink-bleed-8">` def per page (`brush.ts inkBleed`, scale 8), fading to 0 over `--dur-4` when `.is-dry` lands. At most **two live `inkBleed` filters per viewport**, sharing the def; the goshuin book, which mounts up to 53 stamps at 200 px with their own turbulence (`GoshuinBook.tsx:117`, `goshuin.ts:304-309`), moves its stamps to `<img>` data URLs rendered with `cssVars: false` and `theme` read from `data-color-scheme` (a data-URL image resolves no `var(--shu)`; `goshuin.ts:304-309` already falls back to `PALETTE.light/dark` when `cssVars` is off), re-rendered once on moment G.

Light / dark: seals are `--shu` on paper in both; the wet layer darkens 12 %. Reduced motion: no press scale; the colour sets under `--dur-fade`; wet ink is shown dry.

### 5.4 Scrolls — `.scroll-card`, Kakejiku

The Scroll Card keeps its 240 ms unroll (01 §4.4, `components.css:55`) as the `hiku` verb on `scaleY` from the top edge — the literal **240 ms** stays (`components.test.ts:79-84` caps every `components.css` literal at 60–240 ms, so `--dur-3`'s 400 ms is not used here) on `--ease-out`; the gradient end caps (`components.css:57-72`) are redrawn from the kakejiku roller geometry in `room.ts scrollLayer :296-320` so lessons and the Dojo scroll share one jiku. Kakejiku gallery cards hang from a wood rail (`--wood`) on a `catenary` cord (`geom.ts:250`), static; no swing. Reduced motion: cards appear unrolled.

### 5.5 Status Window — the cartouche

Unchanged geometry (`components.css:22-44`): 2 px double `--fg-muted`, notched `clip-path`, pixel labels. Reserved (§2.5). Night adds a 1 px inner hairline in `color-mix(in srgb, var(--kin) 35%, var(--line))` — lacquer and gold, not neon. The copies at `RecordsPage.css:55-58,107-116` and `LedgerPage.css:189` collapse onto the class. **Never transform a clipped window**: entrances animate an inner wrapper. Reduced motion: no change.

### 5.6 Poster titles — `.poster-title` (the arcade as print)

Dela Gothic One, `--neon-c-text` or `--neon-m-text`, `text-shadow: 1px 0 0 var(--shu)` (static misregistration), a bokashi band behind (`linear-gradient` of `--kon` → transparent at 42 %), two kentō marks as `::before/::after` 8 px corner brackets in `--fg-muted`. Used on Kage VS, Rapid Fire, Gojūon Fighter and the Perapera head. Light: inks on paper, no shadow beyond the 1 px offset. Dark: the same on lacquer. Reduced: static.

### 5.7 `.meter` — one bar, composited

Replaces the twelve bar implementations (`.progress`, `.forge-bar`, `.ki-bar`, `.gate-wall`, `.shinsa-cov`, `.station-bar`, `.kage-strip__lane`, `.taiwa__meter`, `.monologue__track`, `.speed__bar`, `.bar__track`, `.gojuon__track`) and the eight `width` tweens (`components.css:397,417`, `ui.css:228`, `charts.css:276`, `GateView.css:113`, `reader.css:435`, `RolePlay.css:379`, `speaking.css:369`). The three `src/input` bars (`.taiwa__meter` in `src/input/taiwa/RolePlay.css`, `.monologue__track` in `src/input/speaking/speaking.css`, `.speed__bar` in `src/input/reader/reader.css`) and their tweens belong to **C4** (§10). The Forge Bar keeps its name and its 百錬 label as `.meter.forge-bar`.

```css
.meter { --value: 0; --target: 0; position: relative; height: 6px; overflow: hidden;
  background: var(--raised); border-radius: 999px; }
.meter__fill { position: absolute; inset: 0; background: var(--meter-tone, var(--kin));
  transform: scaleX(var(--value)); transform-origin: left;
  transition: transform var(--dur-3) var(--ease-out); }
.meter[data-target]::after { content: ""; position: absolute; top: 0; bottom: 0; width: 2px;
  left: calc(var(--target) * 100%); background: var(--fg-muted); }
.meter[data-met="true"]::after { background: var(--kin); animation: osu var(--dur-2) var(--spring) both; }
```

Reduced motion: `transition-duration: 0s` (the token is zeroed); the tick recolours.

### 5.8 `<Ticker>` — numbers that count

`src/shared/ui/Ticker.tsx`: `<Ticker value={n} format={fmt} />` renders the final digits in the DOM (so screen readers and tests see the real number), rolls from the previous value under one shared `requestAnimationFrame` scheduler over ≤ 400 ms on `--ease-out`, `tabular-nums`, and announces nothing itself (the surrounding live region announces once). Kage digits add `data-roll` for a per-column `translateY` cabinet roll. Reduced motion (`prefersReducedMotion()`, `src/art/ceremony/support.ts:175-186`): the value is set at once under a `--dur-fade` opacity.

### 5.9 The tategaki column — `.tategaki-column`

The right edge of the Dojo stage (06 §5, 01 §4.4): `writing-mode: vertical-rl`, Mincho (Shippori `shell` slice; `--font-ja` until it ships) at `--fs-4`, `--lh-mincho`, the glossed-only fallback chain of §3.3, foot = the era date (`formatEraDate`, `time.ts:223`, Arabic digits) with "Reiwa 8 · Oct 18" as its Latin gloss. Contents top to bottom: `.seal-date` with label (today's only³), the sekki with gloss, the kō line with gloss, the Mastered sentence or the glossed greeting. New text slides *down* the column (vertical-rl reads top to bottom) with nijimi (`--from: 0 -8px`) at `--dur-3`. Below 640 px the column becomes a horizontal line under the scene with the same content.

### 5.10 `.lantern[data-state]` — one drawn flame everywhere

The header flame is a kanji glyph today (`Layout.tsx:59-66`: 火 炎 残 氷 休 灰) with an `aria-label` only — the shell's one unlabelled Japanese glyph for a zero-Japanese learner. It becomes a 20 px inline tongue — a self-contained six-node path in `src/shared/ui/Lantern.tsx` (A2, Phase A) whose shape copies `flames.ts tongue()` at `:244` (module-private today and in B1's Phase-B tree, so A2 does not import it; B1 later points the hearth at the shared shape, or exports `tongue()` and has `Lantern` import it, so hearth and header share one tongue by the end of Phase B) — coloured by `FlameState`, **static**: the header is chrome and §6.3 forbids loops there, so the hearth's `dj-hf` flicker stays inside the Dojo SVG and the header tongue tells its state by colour and by the glow twin's opacity alone, **with a visible English state word beside it** (`S.flameLit` …, `src/i18n/strings.ts:48-53`). The same component renders in the End Card's flame line and the Dojo status, replacing three disagreeing glyph tables (`Layout.tsx:59-66`, `DojoPage.tsx:463-465`, `EndCard.tsx:61`). The glow (`--glow-kin`) is a static `::before` whose opacity follows `--lamp-alpha`. Next to it, calm chips render what exists and is invisible today: 氷 × N held, 休 rest set, weekly flame × N, and "repair open · 1 of 3 days" with the `--kintsugi` seam across the chip **while `repairWindow` is open**; when it closes, a repaired flame is indistinguishable from one that never dimmed.³ Reduced motion: still tongue, static glow.

### 5.11 `.shoji` — the panels

Two panels with kumiko lattice from two repeating gradients over `--paper`, `position: fixed; inset: 0; pointer-events: none; aria-hidden`. They part on arrival (≤ 600 ms, `--dur-4 × ⅔`, `--ease`) and close on departure (`--dur-3`, `--ease-in`). They never block input and any tap or key skips to the end state. Reduced motion: `transform: none`, a `--dur-fade` opacity fade.

### 5.12 `.tanzaku` — the leave slip

The Leave dialog (`SessionView.tsx:171-190`) keeps its `.status-window` body for the cartouche rule but arrives as a paper slip that slides down from the top edge like a bookmark laid in a book, 300 ms `--ease-out`, on a `--stage-bg` 60 % backdrop (replacing `SessionView.css:72`'s rgba). Its copy is the existing honest `S.leaveBody`. Reduced: `--dur-fade` fade.

### 5.13 Verb classes

`.ink-nijimi` `.ink-kasure` `.ink-hiku` `.ink-osu` `.ink-wet` `.ink-meku` `.ink-tomosu` and `.rm-fade` — §6.2 defines them; they are the only animation classes `motion.css` exports (direction and distance ride on the `--from` custom property, never on extra classes), so a review can say "that should be a nijimi, not an osu".

## 6. The motion system (supersedes 01 §4.5)

### 6.1 Tokens

Durations `--dur-1` 120 (micro), `--dur-2` 220 (ui), `--dur-3` 400 (content), `--dur-4` 900 (a drawn stroke, a ceremony beat), `--dur-5` 2400 (one written kanji), `--dur-fade` 150 (reduced motion keeps it), `--stagger` 40. Easings `--ease` (exists), `--ease-out`, `--ease-in`, `--ease-draw`, `--ease-press`, `--spring` (§4.1). Ceremonies express every number through these (01 §4.5's "6–12 s, always skippable" stands).

### 6.2 Seven ink verbs

| Verb | Job | Full motion (composited only) | Reduced motion |
|---|---|---|---|
| **Nijimi** 滲み — bleed in | entrance | opacity 0→1 + `scale(.985)`→1, `--dur-2 --ease`; an optional `--from` custom property (a translate vector, e.g. `--from: 8px 0` for moment J, `0 -8px` for the column) prepends a `translate` so `.ink-nijimi` stays the one entrance class; **no `filter`** — §1 rule 2 and §6.7 rule 1 forbid animating it, and the bleed reads from the scale alone | opacity only, `--dur-fade` linear |
| **Kasure** 掠れ — dry out | exit | opacity 1→0 + 6 px translate toward the exit, `--dur-1 --ease-out`; via `@starting-style` + `transition-behavior: allow-discrete`, `data-leaving` phase where unsupported | instant |
| **Hiku** 引く — draw | strokes, bars, unroll | `stroke-dashoffset` via `dashWrite`; bars `scaleX` from the left; cards `scaleY` from the top; `--dur-3/4 --ease-draw` | shown complete |
| **Osu** 押す — press | commit | `scale(1.12)`→`.98`→1, 180 ms `--spring`, then kawaku | no scale; colour sets under `--dur-fade` |
| **Kawaku** 乾く — dry | settle | the wet layer fades over the dry layer, `--dur-4`, opacity only; today's ink stays wet (30 %) until the 04:00 roll | shown dry |
| **Meku** 捲る — turn | pages, theme | View Transition: old snapshot kasure; new snapshot revealed by a `clip-path: inset()` wipe in the travel direction, `--dur-3 --ease` (§6.4) | `--dur-fade` opacity crossfade, no wipe |
| **Tomosu** 灯す — light | a lamp catches | the glow twin's opacity 0→`--lamp-alpha` over `--dur-4`, core fill crossfade; a brand ignition is **one rise** (opacity .35 → 1 over 900 ms on `--ease-draw`, no dip — a dip would change brightness direction twice in under a second, §6.8); **never idle flicker** | final state + caption |

### 6.3 Choreography grammar

- **Enter / exit.** Within a page, exit (`--dur-1`) precedes enter (`--dur-2`); on a page turn they overlap. Every surface that enters also exits: toasts (`Layout.tsx:285-295`), notices, TeachOnce (`TeachOnce.tsx:108`), ceremony dismiss (`CeremonyHost.tsx:169`), the pause overlay and the Leave dialog all leave the way they arrived.
- **Stagger with a cap.** `animation-delay: calc(min(var(--i, 0), 7) * var(--stagger))` — the first eight items stagger, the rest arrive with the eighth; tiles 40 ms, cards 60 ms, rows 90 ms via a local `--stagger`. `TeachCard.css:6` already does the uncapped form (C4 caps it).
- **Shared elements travel, never fade.** `view-transition-name` is derived from the *route pair*, not the pointer, so keyboard users get the same hero (§6.4).
- **Tempo by era** (§2.5). "Paper, then ink, then text" is a Dojo and ceremony rule only; the drill loop never waits for a surface to settle before the next step is ready.
- **Ambient budget.** Paper does not move. The only idle motion is light: hearth flicker and kotodama drift inside the Dojo SVG (existing, self-gating), one lantern breath at 0.25 Hz on the Road's current station, the sky crossfade at phase boundaries. Nothing loops in chrome; no parallax of any kind; no weather loops by default.
- **State.** Numbers tick (§5.8); bars hiku (§5.7); chips nijimi in and kasure out with a colour change at `--dur-1`; `.hud__block[data-state]` (`Hud.css:62-76`) slides its vermilion dot from the previous block (FLIP, 220 ms, transform only); quest ticks osu then stay wet; the flame tomosu when its state improves.

### 6.4 Route transitions on the hash router

**Where the transition starts.** Not around `apply()` in `src/shared/routes.ts:250-253` — that would hold a View Transition open while a lazy chunk loads (frozen page, ~4 s timeout). It starts in `PageHost` (`src/app/App.tsx:103-172`) at **module resolve**, when the old page is still mounted and interactive:

```ts
// src/app/App.tsx, inside PageHost's effect
p.pageFor(r).then((mod) => {
  if (!alive || !sameRoute(route.peek(), r)) return;
  const from = loaded?.route;
  const commit = () => { setLoaded({ key, Page: mod.Page, props: mod.props ?? {}, route: r }); restoreScroll(r); };
  if (!canTransition(from, r)) { commit(); fallbackEnter(); return; }
  prepareTransition(from, r);                       // html[data-travel], hero name on the old element
  const vt = document.startViewTransition(() => { commit(); return afterPaint(); });
  vt.finished.then(cleanupTransition).catch(cleanupTransition);
});
```

`src/app/transitions.ts` (new): `travelOf(from, to)` → `forward | back | in | out | home | none` from `NAV_ITEMS` order (dojo < road < library < collections < records < settings; station / gate / shinsa / dan hang under road, story under library, ledger under records, backup and about under settings, radio under dojo; `in` = → train/gate/shinsa, `out` = the reverse, `home` = → dojo); `heroFor(from, to)` → the route pair's shared element (below); `canTransition()` = `'startViewTransition' in document && !prefersReducedMotion() && !document.hidden && !isCeremonyOpen()` (a one-line export A2 adds to `CeremonyHost.tsx` — `current` at `:88` is module-private — as its one permitted edit in D1's tree, §10); `afterPaint()` = two `requestAnimationFrame`s after Preact commits; `fallbackEnter()` adds `.page-enter` (nijimi) to `.layout__main > *`. `.page-stale` (`App.css:80-84`) is retired: the old snapshot holds while the chunk loads.

**Fixed names.** `.layout__header { view-transition-name: header }`, `.layout__nav { … nav }`, `.layout__brand { … brand }`, `.layout__main { … main }`. Chrome holds still; only `main` moves. The names are **suspended during a theme transition** (`html[data-vt="theme"] :is(.layout__header, .layout__nav, .layout__brand, .layout__main) { view-transition-name: none }`) so that the whole page falls into `root` and §7 G's top-down wipe covers it; with the names in force `root` would hold only the body background and the chrome would crossfade on its own. During a transition `html:active-view-transition { scroll-behavior: auto }`, and `scrollToY` (`router.ts:33-41`) passes `{ top: y, behavior: 'instant' }` always — the accidental glide dies either way.

**Heroes by route pair** (set by `prepareTransition` on the old element, carried by static CSS on the new page where only one such element exists):

| From → to | Old element | New element | Name |
|---|---|---|---|
| boot → dojo | `.app-loading__mark` (the ensō) | `.dojo-scene__art` — the HTML wrapper of the scene (`DojoScene.tsx:353`); the wall scroll `<g class="room__scroll">` inside it (`room.ts:296-320`, an ensō until `chosenKanji`) is SVG injected by `innerHTML` and cannot carry a `view-transition-name` | `enso` |
| road → station N | `.tokaido__station[data-station="N"] .seal` (`data-station` sits on the `<a>`, `RoadNav.tsx:181`; the seal span's class is `seal` / `seal--perfect` / `tokaido__seal--assisted`, `:175`) | `.station-head .sign` | `station-seal` |
| train (End Card) → dojo | `.end-card__brush` (つづく) | the hearth hotspot `.dojo-scene__hotspot--hearth` | `tsuzuku-mark` |
| ceremony (belt) ↔ shell | `.layout__status .belt` | the knot in `BeltCeremony` | `belt-chip` |
| badge slam → collections | the slammed crest | `.mon-grid__cell[data-badge="id"]` (`MonGrid.tsx:175`) | `mon` |

**The wipe.**

```css
::view-transition-group(*) { animation-duration: var(--dur-3); animation-timing-function: var(--ease); }
::view-transition-old(main) { animation: kasure var(--dur-1) var(--ease-out) both; }
::view-transition-new(main) { animation: meku var(--dur-3) var(--ease) both; }
@keyframes meku { from { clip-path: inset(0 100% 0 0); opacity: .6; } to { clip-path: inset(0); opacity: 1; } }
html[data-travel="back"] ::view-transition-new(main) { animation-name: meku-back; }   /* inset(0 0 0 100%) → inset(0) */
html[data-travel="in"]   ::view-transition-new(main) { animation-name: mat; }         /* opacity only over a --stage-bg dim, 300 ms */
html[data-travel="home"] ::view-transition-new(main) { animation-name: nijimi; }
html:active-view-transition { scroll-behavior: auto; }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: vt-fade var(--dur-fade) linear both; clip-path: none; }
}
:root[data-reduced-motion] ::view-transition-group(*), :root[data-reduced-motion] ::view-transition-old(*), :root[data-reduced-motion] ::view-transition-new(*) { animation: vt-fade var(--dur-fade) linear both; clip-path: none; }
```

`clip-path: inset()` is compositor-animatable; a brush-edged `mask-image` wipe (`brushStroke` blot, animating `mask-size`) is paint-level and is kept as an **experiment behind a measurement gate**: it ships only if it passes the §10 frame protocol (DevTools, 4× throttle, ten turns, no frame over 18 ms).⁴ The `*` rule at `base.css:343-348` does not reach `::view-transition` pseudo-elements, hence the explicit overrides above under both selectors; `canTransition()` also skips the API entirely under reduced motion, so the overrides are belt and braces.

**Dojo → session** (`in`): `main` dims to `--stage-bg` over 300 ms `--ease-in` while `.layout__status` kasure-fades and `.layout__nav` translates down 100 % — the chrome no longer pops out via `display: none` (`Layout.css:90-94,148-153`); `display` flips after the transition. Session → anywhere (`out`) reverses it over 400 ms: the calmest motion in the app is the one that ends the day.

**Focus and announcements.** On `finished`, `focusMain()` (`Layout.tsx`) runs when `document.activeElement` is `document.body` or `null` — i.e. the new page placed no focus of its own (sessions focus the exercise box first, so the check is false there); `document.title` still updates in `apply()`; the `#live` region announces the route title once via `announce()` (`Layout.tsx:39`), identical in both motion modes.

**Fallback** (Safari < 18, Firefox < 144, or `canTransition()` false): `.page-enter` nijimi on `.layout__main > *`, no exit (Preact unmounts synchronously). **Reduced motion:** API skipped; the fallback plays its `--dur-fade` fade.

### 6.5 Number, bar and chip state transitions

As §5.7–§5.8 and §6.3. Header `Lv` and XP tick on `xp:gained` (`events.ts:131`) with a single `--dur-2` `--kin-text` colour transition on the delta text (the §6.7 colour exception: text and small fills only, ≤ `--dur-2`, never a keyframe); the XP bar is a `.meter`; combo scales by tier as today (01 §4.4) with `combo-pop` (`arcade.css`) only under `data-feel=arcade`; three combo-tier declarations (`components.css:437-456`, `ui.css:220-238`, `arcade.css:140-146`) become one — A1 writes the canonical rule in `components.css`, C1 deletes the `ui.css` copy.

### 6.6 Reduced motion as a first-class variant

Rule: **keep opacity, drop travel, drop loops, nothing longer than `--dur-fade`** — every reduced variant in §5–§7 is written against that one token (no literal 200 or 300 ms anywhere; a static end state is not a hold and needs no duration). Implementation in one line plus tokens, then migration: the global nuke at `base.css:343-357` becomes `*:not(.rm-fade), *:not(.rm-fade)::before, *:not(.rm-fade)::after` under both selectors (`base.test.ts:124-126` still finds `animation-duration` rules under both); `.rm-fade` carries `animation-duration: var(--dur-fade) !important` only for keyframes that animate opacity alone; the tokens zero `--dur-1…5` and `--stagger` and never `--dur-fade`; verb classes get `transform: none; filter: none` under `[data-reduced-motion]` and the media query. The 49 per-file reduced-motion blocks are deleted as each file is touched; none are added. JS reads `prefersReducedMotion()` (store OR media query, `support.ts:175-186`) for View Transitions, tickers, timelines and the scene, exactly as `useTimeline` does. Every verb's reduced form is in §6.2; every signature moment's is in §7.

### 6.7 Performance rules

1. Animated properties are **only** `opacity`, `transform`, `clip-path` and SVG `stroke-dashoffset`. Never `width`, `height`, `padding`, `top/left`, `box-shadow`, `text-shadow` or `filter` (the kawaku layer is filtered once and its *opacity* animates). `WallpaperUnlock.css:71-78`'s `height` tween becomes `scaleY` (D1); `speaking.css:228-235`'s `recorder-level` keyframe (`height` today) animates `scaleY` (C4). **Colour exception:** `color`, `fill`, `stroke` and the `background-color` of elements ≤ 160 px may *transition* for ≤ `--dur-2` (chip states, the meter tick, the XP delta, a tile's grade); colour never appears in a `@keyframes` block and never tweens on a background larger than 160 px (the sekki tint therefore *steps*, §7 H).
2. ≤ 2 live SVG filters (`inkBleed`, `displace`, `turbulence`) per viewport; one shared def per page.
3. `will-change` only transiently (set by the reveal hook, cleared on `finished`); kotodama `will-change: transform` (`flames.ts:115`) capped at the first 24 `<use>`.
4. The header's `backdrop-filter: blur(6px)` (`Layout.css:36`) gains `contain: paint` and drops to a 92 % tint during a View Transition.
5. `requestAnimationFrame` budget: one shared scheduler (`Ticker`), ≤ 4 ms of script per frame, no rAF loop while `document.hidden`.
6. `content-visibility: auto` with `contain-intrinsic-size` **equal to the fixed row height** on Road rows, Library shelves and the Mon grid, so skipped rows never shift the layout; `restoreScroll(r)` (`App.tsx:117`, `router.ts:32-40`) runs after `afterPaint()` rather than right after `setLoaded`, so the hash router's scroll restoration lands on rendered, not estimated, heights.
7. Never transform a `clip-path` element (`.status-window`); animate an inner wrapper.
8. `--paper` is a static image; a `--sekki-mix` change is one full-page paint, accepted once a fortnight.

### 6.8 Flashing and vestibular safety

Nothing changes brightness direction more than twice per second; no infinite animation under 1,400 ms (hearth 1.45–1.9 s, kotodama 5–10 s, lantern breath 4 s); the hit-stop is a single 33 ms hold; no full-viewport translate over 24 px; no scale over 1.25 on anything larger than half the viewport; no parallax; no shake beyond one 4 px nudge-and-return. `src/styles/motion.test.ts` (new, in the style of `arcade.test.ts:70-95`) asserts for `motion.css`: every `@keyframes` animates only the allowed properties; no `infinite` animation under 1,400 ms; no keyframe reverses `opacity` more than twice per 1,000 ms of its duration; every animated selector has both reduced-motion overrides or the `.rm-fade` opt-in; every duration is a token; no colour literals.

## 7. Signature moments

Each storyboard names its trigger, beats, sound (01 §5 recipes only: `correct` `correct-tier2` `correct-tier3` `wrong` `submit` `ippon` `kiai` `promotion` `scroll` `badge` `stamp` `ceremony` `wallpaper` `tsuzuku`, `src/audio/sfx.ts:20-36`), reduced-motion version, surface and files, an acceptance test, and its **ethical line**. Clock-driven moments (A, G, H) are silent by rule 1.

### A · Hiraku 開く — opening the book (daily arrival)

Trigger: boot with `day:rolled` fired this visit and `progress.arrivedDay !== store.today()` — an *optional* additive field on the existing `progress` slice (as `storiesRead?` and `listened?` already are, `store-types.ts:208,215`), **not** a new `ui` slice: `SLICE_KEYS` (`store-types.ts:430-447`) drives persistence in `store.ts:131,162,173`, `backup.ts:661` and `migrations.ts:428`, none of which any owner touches. Surface: `src/app/App.tsx:180-189` → `DojoPage.tsx`, `DojoScene.tsx`, `.shoji`.

| ms | Beat |
|---|---|
| 0 | the boot mark is an ensō (`brush.ts enso :262` spine) drawing itself on the closed shōji with `dashWrite`, 900 ms `--ease-draw`, replacing the breathing text (`App.css:15-31`) |
| 900 | `store.ready`: meku. **Mechanism:** `App.tsx:180-189` unmounts the loading mark the instant `ready` flips, and `PageHost` only then starts loading the Dojo chunk — so PageHost's module-resolve VT (§6.4) can never see this flip. A2 therefore prefetches the dojo chunk during boot (`pageFor({ name: 'dojo' })` kicked off beside `initStore`) and, when `ready` flips with the chunk already resolved, `App` itself starts the arrival VT around the swap; the ensō's `view-transition-name: enso` carries it onto `.dojo-scene__art` (the HTML wrapper, §6.4), landing over the wall scroll's position where the scroll's own ensō is drawn whole. If the chunk is not yet resolved at `ready`, beat 2 is a plain `--dur-fade` crossfade. The shōji panels part (≤ 600 ms), `pointer-events: none`, skippable by any tap or key |
| 1,100 | the phase word — 朝 asa · morning / 昼 hiru · day / 夕 yū · dusk / 夜 yoru · night — nijimi-in under the brand for 2 s, reading and English beneath |
| 1,300 | the tategaki column nijimi-in: today's seal (if any), the sekki in Mincho with gloss, the kō line |
| 1,700 | **since yesterday**: `DojoScene` diffs the persisted `SceneSeen` (`progress.sceneSeen`, the durable `SceneInputs` fields — `store-types.ts`) against today's and gives each changed part — a lantern, a bonsai pad, a stamp, a Mon slot, the hearth state — one `glowTwin` pulse (`svg.ts:213`) of 900 ms; the caption names it from `src/art/dojo/strings.ts` (`bonsaiBlooming`, `kageSitting`, `hearthSteady` …, all unused today) prefixed "Since yesterday:" |
| 2,100 | forecast line and the one hanko nijimi-in; hotspots and tiles were interactive the whole time |

Sound: none. Reduced: the ensō is shown complete (a static mark, not a hold) and the shell arrives under one `--dur-fade` crossfade; changed parts carry a static 1 px `--kin` ring for the visit; captions identical. Acceptance: `DojoPage.test.tsx` renders with a fake `sceneSeen` one lantern behind and asserts the caption text and `data-since="lantern"` on the wrapper; with `settings.reducedMotion` asserts no `.ink-*` class is present and the ring attribute is; the shōji element has `aria-hidden` and `pointer-events: none` in the computed style. `App.test.tsx` (A2) with a fake `startViewTransition` asserts the `enso` name on `.app-loading__mark` before the callback and on `.dojo-scene__art` after, that the API is called only when the prefetched dojo module has resolved, and that it is not called when it has not. **Ethical line:** the arrival never names a gap. No absent-day count, no streak history on this surface, no different music for a cold hearth; the never-lit hearth says "Unlit. Your first session lights it." (new `S.flameUnlit`, shown when `streak.totalDays === 0`), not "The flame is out."

### B · Shūhitsu 終筆 — finishing a session

Trigger: `session:finished` → `EndCard`. Surface: `src/session/EndCard.tsx/.css`, `TrainPage.tsx`.

| ms | Beat |
|---|---|
| 0 | controls kasure down 120 ms; the page dims to `--stage-bg` over 300 ms |
| 300 | つづく is **written**: a brush-stroke `<mask>` drawn with `dashWrite` (as `BeltCeremony.tsx:82-121`), 1,200 ms, synced to the `tsuzuku` gliss (1,200 ms) |
| 1,500 | tally tiles nijimi-in 60 ms apart; each value is a Dela `<Ticker>` counting up in 400 ms |
| 2,100 | item belts flip (one `belt-flip` definition in `components.css`, A1's; B2 deletes `EndCard.css:356`, C1 deletes `ui.css:463`), one `promotion` koto pair per belt |
| 2,400 | **a lantern for today**: the 20 px tongue catches beside the flame line (tomosu); copy "A lantern for today." |
| 2,700 | 次回予告: the sentence appears, the masked ??? last with one gold pulse (900 ms); the omikuji writes in Mincho; "Good training. Rest." and, small, "The dojo keeps your place." |

Sound: `tsuzuku` at 300; `promotion` under belt flips; nothing else — no BEST eyebrow on this card.⁵ Reduced: stage cut at 0; つづく shown whole under a `--dur-fade` fade; tiles and final numbers at once; ??? static gold. Acceptance: `EndCard.test.tsx` with fake timers asserts the `--i` indices on tiles, the Ticker's final text equals the tally, the lantern's `data-state`, and that `sfx` was called with `tsuzuku` exactly once; under reduced motion the `dashWrite` mask is absent. **Ethical line:** the lantern records what was done; it asks for nothing. "Another Kata?" appears only while reviews remain (as built); no time words, no "come back".

### C · Kadode 門出 — leaving (Rest → Dojo)

Trigger: "Rest." on the End Card. Surface: `EndCard.tsx:296-347`, `DojoScene.tsx:339,353`, `transitions.ts`.

0–400 ms a View Transition carries `tsuzuku-mark` into the hearth hotspot while the shōji panels close over the stage (`--dur-3`, `--ease-in`), the sky still visible through the lattice; 400–1,000 the hearth relights **by growing** — tongues `scaleY` 0→1 on `--spring`, 600 ms — instead of the SVG string swapping; 1,000–1,160 today's quest circles tick with an osu each at 40 ms and stay wet; the Dojo stands with today's deltas already applied, no replay. Sound: none; the silence is the rest. Reduced: `--dur-fade` crossfade; hearth state swaps under the same fade. Acceptance: `App.test.tsx` with a fake `startViewTransition` asserts the hero name on `.end-card__brush` before the callback and on the hearth hotspot after; `DojoScene.test.tsx` asserts the hearth state flips by class (`dj-hf--steady`, a class B1 introduces — today `flames.ts` has only the `dj-hf` id, `:226`) without a scene-key change. **Ethical line:** there is no exit interception, ever — no "before you go", no `beforeunload`, no modal that delays leaving; the ritual is finished before the learner decides anything.

### D · Tōchaku 到着 — arriving at a new station

Trigger: first Road or Station view after `progress.station` increments (compared with `progress.stationSeen`). Surface: `src/session/RoadNav.tsx/.css`, `StationPage.tsx`, `session/pages/pages.css:60-100`, `src/art/motifs.ts`, `src/art/road/headpiece.ts` (new).

| ms | Beat (Road) |
|---|---|
| 0–900 | the belt-coloured spine (`RoadNav.css:44-51`, a `::before` bar today) becomes one SVG path and hiku-draws from Nihonbashi to the cleared station, `--dur-4 --ease-draw` |
| 900 | the cleared station's seal osu (180 ms) then kawaku (500 ms); `stamp` thump; haptic 10-30-10 |
| 1,100 | the new station's lantern (`RoadNav.css:140-152`) tomosu: gold fill + static `glowTwin` halo, 400 ms; the row's `.sign` settles (the JA wrapper `scale(1.43)` → 1, §3.4) |
| 1,500 | at ≥ 600 px the row's 48 px vignette (`RoadNav.tsx:60-100`, hand paths today) is replaced by kit motifs (`motifs.ts`) and the current row grows a 160 px bokashi band |

On the Station page the lantern is the shared element (`station-seal`) into a **160 px headpiece** composed from the existing wallpaper layer functions (`fuji-ridge.ts` bands, `torii-dawn.ts`), the keeper as a `dryBrush` silhouette (`brush.ts:186`) lifting from ink wash to tone (900 ms), the road surface in `--road`, the sign at `--fs-5` with 第七宿; towns ahead on the Road render through `sumiFilter` (`src/art/wallpapers/spec.ts:156`) and are labelled **ahead**. Sound: `scroll` fanfare on the first arrival only; `submit` otherwise. Reduced: spine, seal and lantern shown; the new row carries a gold hairline for the visit. Acceptance: `RoadNav.test.tsx` asserts the spine path's `stroke-dasharray` equals its length and `data-arrived` on the new row when `stationSeen < station`; snapshot of one headpiece (Hara, Station 13: Fuji centre) at 280 and 720 px in both themes. **Ethical line:** the station ahead is grey with its name, its reading (romaji before Green kana, kana after) and English visible — no padlock, no "locked"; Projected Arrival stays a month name.

### E · Ōin 押印 — a stamp or badge

Trigger: `stamp:earned`, `badge:earned` (ceremonies, as built: `StampPress` 0/350/900 ms, `BadgeSlam` 0/60/520 ms), and inline at quarter scale in `MonGrid` and `GoshuinBook` via `useReveal` (one-shot `IntersectionObserver`, `{ threshold: .5 }`) for items earned since last open. Beats (ceremony): 0 the `.sheet` nijimi-in with grain; 350 osu on `--spring`, `stamp` / `badge` thump; 530–1,300 kawaku; 1,300 the era date nijimi in Mincho exactly as `formatEraDate` prints it (`令和8年10月18日`, Arabic digits, `time.ts:223-230`) with "Reiwa 8 · Oct 18" beneath in pixel `--fs-1` — never an unglossed 令和八年; dismiss = kasure. Locked crests become grey stone (`mon.ts embossFilter :618`, 06 §2) so the slam reads as stone turning to colour. The book's stamps become `<img>` data URLs (≈ 106 live filters retired) and the newest spread turns with `perspective(1200px) rotateY(-180deg)` on the right page, 320 ms. Sound: `stamp` / `badge`. Reduced: sheet and dry seal at 0 under a `--dur-fade` fade; book opens on the latest spread. Acceptance: `MonGrid.test.tsx` with a fake observer asserts `mon--slam` is added once for badges with `at > lastOpened` and never for older ones. **Ethical line:** every one of the 53 pages is readable from day one; the Assisted grey corner always names its path; nothing on a page is timed.

### F · Shiori 栞 — about to leave a session

Trigger: Leave (`SessionView.tsx:171`). Beats: 0 backdrop nijimi to 60 % `--stage-bg`, 220 ms; 0 the `.tanzaku` slip slides down 300 ms with `S.leaveBody` and the remaining rep count as a small vermilion mark; Stay is the hanko (already so). On Leave: meku to the Dojo (`out`); the slip's `view-transition-name: shiori` lands as the ribbon on the Resume card ("Resume · 6 reps left"), 400 ms; `submit` tap. Reduced: dialog fades under `--dur-fade`; the ribbon is shown. Acceptance: `SessionView.test.tsx` asserts the dialog role, the count text, and that `.tanzaku` gets `data-leaving` before unmount. **Ethical line:** no guilt line, no timer, no "are you sure?" second step; the copy stays "Your place is kept."

### G · Kure 暮れ — dusk falls (theme change)

Trigger: Settings theme or feel radio, a `prefers-color-scheme` change, or the sky-follow boundary. Surface: `theme.ts:68-92`, `tokens.css`, `SettingsPage.tsx:565-585`, `settings.css` (new). Beats: 0 `theme.ts` sets `html[data-vt="theme"]` (which drops the four fixed `view-transition-name`s, §6.4, so header, nav, brand and main are snapshotted inside `root` rather than as independent crossfading groups) and calls `startViewTransition(() => applyTheme(...))`, 400 ms; `::view-transition-new(root)` revealed top-down (`clip-path: inset(0 0 100% 0)` → `inset(0)`) so the sky darkens before the floor — the whole page, chrome included; `data-vt` is cleared on `finished`; 400 in the Dojo the lanterns tomosu (class flip `.room__lantern--lit`, `room.ts:371-394`); `<meta theme-color>` updates inside the callback. Each theme radio shows a live 48 px washi / lacquer swatch holding a tiny `.status-window`. Sound: none. Reduced: `--dur-fade` crossfade. Acceptance: `theme.test.ts` asserts `data-color-scheme` flips inside the recorded callback, that `html[data-vt="theme"]` is present while the callback runs and absent after `finished`, and the meta colour equals the computed `--bg`; `App.test.tsx` (A2) asserts the four named elements lose their `view-transition-name` under `data-vt="theme"` by a static CSS check; `SettingsPage.test.tsx` asserts both swatches render. **Ethical line:** the app never switches presets silently (01 §6); Follow the sky is opt-in and announced once in Settings.

### H · Sekki 節気 — the calendar turns

Trigger: `day:rolled` where `sekkiOf(today) !== sekkiOf(yesterday)`, or the five-day kō step, or a moon name change. Surface: `koyomi.ts`, `theme.ts applyCalendar`, the tategaki column, `room.ts:262-296` (window), `DojoScene.tsx:373-377` (caption). Beats: at the next arrival 0 the column's label kasure, the new label nijimi — 霜降 sōkō · frost falls · from Oct 24 (a date, never "in N days"⁶); 400 `--sekki-mix` **steps** on `body` in one paint (§6.7 rule 8; a `background-color` tween of the whole page is exactly what rule 1's colour exception forbids — the column's label change is the visible event, the tint is felt tomorrow); 900 the kō line and, when the month has one, the eaves ornament with its gloss (tanzaku in July "七夕 tanabata", carp streamers in May "鯉のぼり koinobori", snow on the rail in winter "雪 yuki"), drawn not typed; the moon in the window matches `moonPhase`. Sound: none — the wind chime stays reserved for wallpapers. Reduced: label, tint and ornament at once. Acceptance: `koyomi.test.ts` snapshots all 24 sekki, the 72 kō and 30 consecutive moon days from a fixed epoch day; `theme.test.ts` asserts `data-sekki`, `--sekki-pigment` and `--sekki-mix ≤ 3%` for four sample instants; `tokens.test.ts` iterates the 24 pigments × 3 surfaces × 2 themes and asserts the §4.2 contrast floors. **Ethical line:** micro-seasons are decorative-with-a-label; nothing collectible is keyed to them; they are never a quiz; the label says "traditional calendar, approximate".

### I · Bokuten 墨点 — the ink dot (a graded answer)

Trigger: `attempt:graded`. Surface: `src/exercises/ChoiceGrid.css/.tsx`, `src/shared/ui/Feedback.tsx`, `ui.css`, `SessionView.tsx` (wire `sfx`, which the core loop never calls today — only `GojuonFighter.tsx:249`, `ListeningArena.tsx:499`, `RolePlay.tsx:359`, `EndCard` and the ceremonies do). Beats: 0 correct — a matcha `splatter` dot (`brush.ts:221`, a data-URI pseudo-element) osu-blooms at the tile's ○, 180 ms; wrong — a `dryBrush` strike hiku-draws across the text in 220 ms instead of `line-through`; 33 under `data-feel=arcade` only, a hit-stop: a JS class toggles `transform: scale(.995)` for one 33 ms hold (never a keyframe, so no 334 ms guard trips); 60 feedback nijimi (existing `fb-in`), the ki `.meter` hiku, `+XP` ticks; a full ki bar charges the Continue hanko with a static `--glow-shu` border in Night and a `--kin` ring in Morning. Sound: `correct` / `correct-tier2` / `correct-tier3` / `wrong` / `submit` / `ippon`, haptics as 01 §5; Zen silent. Reduced: tile recolours, strike shown complete, no hold. Acceptance: `SessionView.test.tsx` with a recording `sfx` fake asserts one call per grade with the tier-correct recipe and none in Zen; `ChoiceGrid.test.tsx` asserts `data-state="correct"` adds the dot class and `--i` on each tile. **Ethical line:** the wrong sound is a soft donk, never a buzzer; the strike is ink, not red; no streak or combo copy appears on a miss.

### J · Michi 道 — step to step

Trigger: the next step (`<Exercise key={step.id}>`, `SessionView.tsx:550`). Beats: outgoing card kasure 6 px left, 120 ms; incoming nijimi from 8 px right, 220 ms, choice tiles staggered 40 ms (cap 8); `.hud__block` dot glides (FLIP). Sound: none beyond the grade. Reduced: `--dur-fade` crossfade. Acceptance: `SessionView.test.tsx` asserts the outgoing wrapper receives `data-leaving` and the incoming `.ink-nijimi`. **Ethical line:** the loop never waits on decoration — the next step is interactive the moment it mounts.

## 8. The return loop

**Daily arrival (A).** The sky is at the real hour (and now shifts live at 05 / 08 / 17 / 20 h while the tab is open — a timer, not a re-render on luck). Yesterday's ink has dried. The phase word teaches one of four kanji. The tategaki column reads today's date, sekki and kō — true whether or not the learner came. The since-yesterday pulse shows exactly what the learner's effort grew, in the picture, with a caption.

**Departure (B, C).** つづく written, a lantern for today, the shōji closing, the mark carried into the hearth that relights. The frame is identical on day 1 and day 400 whatever the streak says.

**Tomorrow.** Everything inked today — quest ticks, the day's seal, a new goshuin — renders *wet* (kawaku held at 30 %) until the 04:00 roll (`time.ts:126-130`); on the next `day:rolled` it is dry. That is the "what's new" layer: no notification, no counts. The hearth relights with the first session.

**The week.** Monday: the Kage silhouette stands and leaves the corner (`room.ts:467-474`; translateX 24 px + kasure; reduced: the silhouette swaps under `--dur-fade`; caption "The Kage left the corner. It runs again this week."); the backup notice (`Layout.tsx:179-186`) nijimi once; the weekly-flame chip may tick. Every five days the kō turns — a line the learner can read with its gloss.

**The month.** The first Records visit after `monthRolled()` (`day.ts:78`) morphs the Perapera radar from last month's dashed polygon (`store.perapera.months`, `src/store/perapera.ts:333-348`) to now over 600 ms (reduced: both polygons shown at once, no tween); tiles tick; the bonsai tip reads "+N days this month."

**Seasons, micro-seasons, moon.** The paper tint steps every ≈ 15 days (≤ 3 %); the garden tree, bonsai tint and snow caps turn with the month (existing); labelled ornaments hang on the eaves; the moon waxes in the shōji window. All deterministic from the date and the save (`hashSeed(seed, day, …)` in `src/session/dojo-feed.ts:115`, the seeded picks in `src/store/quests.ts` and `src/session/end-card.ts`, `DojoScene.tsx:233`); nothing to miss, nothing expiring.

**Follow the sky.** `Settings.theme` gains `'sky'`: Dojo Morning from dawn to dusk in `profile.tz`, Arcade Night after, changed by moment G at the boundary; opt-in only; the Settings line explains it once.

**The ethical line.** `src/i18n/banned-phrases.ts` governs every new string and is the law of this loop: *"Shame, guilt, urgency and hype have no place in the Sensei voice. The CI lint (`banned.test.ts`) greps every `strings.ts` and every `.tsx` under `src/` against this list."* — streak shame, guilt, urgency and countdowns ("only X hours left", "hurry", "last chance", "expires"), hype and guilt exclamations. 06 §7 #5 adds: *"No countdowns anywhere; 次回予告 is informational; no notifications beyond an optional neutral `.ics`."* Hence, in this document: the kō and sekki are shown as **dates**, never "in N days"⁶; only **today's** date seal sits on the Dojo, history living in Records' calendar heat (`charts.css:301-302`)⁷; the kintsugi seam shows only while `repairWindow` is open³; no absent-day count anywhere on the arrival surface; no exit interception; no sound on the clock. Two copy debts are fixed on the way: "No streak yet" (`strings.ts:36`) after a break becomes "Streak paused · repair open: {done} of 3 days" while the window exists; the day-one hearth says "Unlit", not "out". All new copy — the phase words, the sekki and kō names with glosses, "Since yesterday: …", "A lantern for today.", "The dojo keeps your place.", "Unlit. Your first session lights it." — lives in strings files under `banned.test.ts`.

**What the Dojo scene shows.**

| | Day 1 (after onboarding) | Day 30 (daily, Standard) | Back after 10 days away (from day 30) |
|---|---|---|---|
| Hearth / flame | unlit, label "Unlit. Your first session lights it."; header tongue grey with the word | gold after a full day, four tongues; header tongue vermilion/gold with "The flame is lit." | cold; "The flame is out. Light it with any session." — the same calm sentence as always; `.kintsugi` only if a repair window is open, with "repair open: 0 of 3 days" |
| Column | today's sekki and kō with glosses, the greeting こんにちは · konnichiwa · hello, era date with its Latin gloss; the sentence slot empty; no seal yet | today's seal in kanji numerals with its "Oct 18" label; a Mastered (Brown, else Green) sentence of the day | today's sekki and kō (they moved while the learner was away, and read the same way); no seal until the first session |
| Since yesterday | nothing to pulse; caption "No word-spirits yet…" (existing) | a lantern (Lv 13 → 1), stamp, three or four gold Mon slots, bonsai depth 6 | nothing pulses; the bonsai is pruned (existing) and the hotspot tip finally says so (`bonsaiPruned`), healing 40 → 100 % over `returnedDaysAgo / 7` |
| Sky, moon, season | by the clock and the date | the same | the same — the room kept time |
| Banner | first-run card | none | one-time card from `awayStatus()` (`day.ts:54-75`): "The dojo kept your place. Day 2 back · 6 spread days left · new items return tomorrow." — the absence length is never printed |
| Hanko | one: Kata | one: the recommended session; Kumite and Shugyō as `.sheet` tiles | one |

## 9. Per-surface plan

| Surface | Changes | Owner (§10) |
|---|---|---|
| Tokens, base, components, motion | §4 tokens in `:root` + both dark blocks; `motion.css` + test; `*:not(.rm-fade)`; `.sheet .hairline .eyebrow .title-lockup .sign .meter .poster-title .tanzaku .shoji .lantern .seal-date .tategaki-column`; verb classes; `.status-window` Night hairline; canonical combo tiers, `belt-flip`, `.sr-only` (the duplicates in `ui.css`, `EndCard.css`, `RoadNav.css` are deleted by C1, B2, C2); delete or gate the unmounted arcade layer | A1 tokens-motion |
| Fonts | 13-glyph rebuild; Yuji `shell` slice; test updates; `document.fonts.load` warm-up | A4 fonts |
| Router / shell | VT at module resolve, `transitions.ts`, fixed names, `data-travel`, heroes, fallback, instant scroll; chrome kasure for drills; header `.hairline`; `.lantern` with label + forgiveness chips; `<Ticker>` + `.meter` on Lv/XP; `contain: paint`; toasts and notices exit; copy fixes in `src/i18n/strings.ts` | A2 shell-router |
| Calendar and theme | `koyomi.ts` (+ `public/calendar/koyomi.json`), `applyCalendar`, boundary timer, `--belt-color`, meta theme-color from the sky, theme VT (G), `theme: 'sky'`, Settings swatches in `settings.css` | A3 calendar-theme |
| Dojo home + scene | arrival (A), since-yesterday diff, wet ink on quest ticks, tategaki column with fallbacks, one hanko + `.sheet` tiles, genkan strip (three towns; fixes `DojoPage.tsx:417,549-553` to `progress.station`), moon, ornaments, sky as two rects crossfading by class (phase leaves `sceneKey`), hearth relight by class, real crest and goshuin symbols on shelf and rack, `compact` stage < 640 px, kotodama `will-change` cap, mountain card + healing bonsai, `S.flameUnlit` branch | B1 dojo-home |
| End Card + departure | B and C; `--stage-*` replaces hex; Dela tickers; lantern for today; 次回予告 column ≥ 720 px; `tsuzuku-mark` | B2 end-card |
| Session runner + exercises | I and J; `.tanzaku` leave slip (F); chrome handoff; core-loop sfx; `.reveal[data-kind]` for the 13 result-panel copies; tile stagger; TextAnswer caret + drawn underline; Scramble / Component Assembly FLIP; PitchLine hiku; `.meter` for ki; delete the `ui.css` duplicates of `.sr-only`, the combo tiers and `belt-flip` | C1 session-loop |
| Input surfaces (reader, Radio + Listening Arena, speaking, taiwa, stories, missions) | `.meter` for `.taiwa__meter` `.monologue__track` `.speed__bar` and their `width` tweens; `recorder-level` → `scaleY`; `.eyebrow` for the `src/input` labels; `--ai-dye` band on the listening surfaces; `.sheet` on story and mission cards; TeachCard stagger cap | C4 input-surfaces |
| Road + Station | D; `motifs.ts`; headpiece; `.sign`; `sumiFilter` towns ahead; `--road`; genkan strip component shared with B1 via `src/art/road/` | C2 road-station |
| Collections + Records | E inline (`useReveal`); stone-locked crests; goshuin `<img>` + page turn; kakejiku rail; Library shelf rails and new-item dot; Records tickers, radar month morph, chart type to `--fs-1`, `.status-window` reuse | C3 collections-records |
| Ceremonies, gates, arcade | `--stage-*`, `--spring`, exits; taiko visuals re-timed to the recipe (BeltCeremony 600/1200/1800 → 0/700/1400, `BeltCeremony.tsx:46` vs `sfx.ts ceremony`); silk unroll via `scaleY`; ink-wash backdrop (`turbulence`); belt chip hero; Gate wall as stone (`ditherPattern`) chipped with `geom.shatter :391`, one piece per hit, doors part on a pass; Shinsa sheets in Mincho, 600 ms sumi beat before the ceremony; Kage / Rapid Fire / Gojūon as the poster (`.poster-title`, lanes `.meter`, digits roll, BEST eyebrow against own history in arcade results only⁵) | D1 ceremonies-arcade |

## 10. Implementation plan

Owners have **disjoint path lists** so a fleet can run them in parallel; a path listed under one owner is off-limits to every other, and where one owner needs a one-line change in another's tree the brief names it as that owner's *allowed edit* (A2's `isCeremonyOpen()` export, A3's `room.ts` re-export). Every file this document touches has exactly one owner below; `src/input/**`, `src/session/TeachCard.*` and `src/session/engine-strings.ts` are C4's, `src/i18n/banned.test.ts` is A2's, and `src/store/store.ts` / `src/store/backup.ts` are touched by nobody (the three new persisted fields hang on the existing `progress` slice). Phase order: **A** (tokens + motion system + shell transitions + fonts + calendar) → **B** (home and return loop) → **C** (surfaces) → **D** (ceremonies' director's cut). B depends on A1–A3 landing; C and D depend on A1; A1–A4 have no ordering dependency among themselves. House rules for every owner: no new runtime dependency; both themes; reduced motion first-class; no new UI kanji outside §3.5's list; every new string in a strings file; never touch `public/audio/` or `.audio-cache/`.

### Budgets (whole programme)

| Budget | Ceiling | Today |
|---|---|---|
| New CSS (gross) | ≤ 26 KB | tree 377 KB (66 files) |
| Net CSS after deletions | ≤ +12 KB (unmounted arcade layer ≈ 150 lines, bar and status-window clones, duplicate keyframes, 49 reduced-motion blocks) | — |
| First-paint fonts | ≤ 250 KB (07 §9): DotGothic16 base 54 KB + Yuji `shell` ≤ 60 KB + Shippori `shell` ≤ 40 KB (the Dojo column), asserted as the real sum of the three files; Yuji and Shippori `base` warm after first paint; Dela loads on first use (Kage, Records, End Card) | 622 KB: DotGothic 54 + Yuji 364 + Shippori 204 (`.dojo__proverb`) load on the home screen today |
| Sekki rebuild | ≤ 20 KB across four families | — |
| Dojo scene | ≤ 420 SVG nodes (today ≈ 330–400; + second sky rect, moon ≤ 4, ornament ≤ 12, crest/goshuin symbols ≤ 40 as `<use>`) | — |
| Station headpiece | ≤ 60 nodes; one shared filter | — |
| Header tongue | ≤ 6 nodes, no filter in Morning | — |
| Live SVG filters | ≤ 2 per viewport | goshuin book ≈ 106 |
| Frame budget | **a documented manual protocol, not a Vitest assertion** (nothing in the repo measures frames): Chrome DevTools Performance panel, 4× CPU throttle, 390 × 844 viewport, ten consecutive route turns (dojo → road → station → road → library → records → dojo → train → dojo → settings); pass = no main-thread frame over 18 ms during a transition and no long task over 50 ms; recorded as a checklist line in the A2 and C2 PRs, and §11's prototype carries the fps readout | — |

### A1 · tokens-motion (Phase A)

Paths: `src/styles/tokens.css`, `src/styles/tokens.test.ts`, `src/styles/base.css`, `src/styles/base.test.ts`, `src/styles/components.css`, `src/styles/components.test.ts`, `src/styles/arcade.css`, `src/styles/arcade.test.ts`, `src/styles/motion.css` (new), `src/styles/motion.test.ts` (new), `scripts/paper-tile.ts` (new), `docs/ARCHITECTURE.md` (§7 token list only).

Tasks: add every §4.1 token to `:root` and both dark blocks; zero `--dur-3/4/5` and `--stagger` in both reduced blocks, never `--dur-fade`; `@supports` fallback for `--spring`; build the `--paper` tile once; `*:not(.rm-fade)` in `base.css`; write `motion.css` (verb classes, `.rm-fade`, VT pseudo-element rules, `.sheet .hairline .eyebrow .title-lockup .sign .meter .poster-title .tanzaku .shoji .lantern .seal-date .tategaki-column`); add the new classes to the `components.css` header `CLASSES:` list where they live there; provide the **single canonical definition** of the combo tiers (`components.css:437-456`, absorbing `arcade.css:140-146`'s `data-feel` variant), of `belt-flip` (moved into `components.css`) and of `.sr-only` (`base.css:230`) — the duplicates are deleted by the owners of the files they live in (C1: `ui.css:11` `.sr-only`, `ui.css:220-238` combo tiers, `ui.css:463` `belt-flip`; B2: `EndCard.css:356` `belt-flip`; C2: `RoadNav.css:239` `.tokaido .sr-only`), each in its own phase, so A1 never opens a C/B file; either gate the unmounted arcade spectacle (≈ 150 lines, eight classes) under `data-feel=arcade` hooks the D1 owner will mount or delete it, keeping the live `.combo[data-tier]` rules; update ARCHITECTURE §7's token list; wire `motion.css` into `src/main.tsx` — **no**: `main.tsx` belongs to A2; A1 exports the file and A2 imports it.

Acceptance: `tokens.test.ts` extended — new themed tokens present in all three blocks, invariant tokens absent from dark, `--neon-c-text`/`--neon-m-text` ≥ 4.5:1 on `--bg`/`--surface`/`--raised` in both themes, the 24-pigment × 3-surface × 2-theme tint loop ≥ 4.5 for `--fg-muted`, `--kin-text`, `--shu-text` (the loop imports the table from `src/shared/koyomi.ts` once A3 lands; until then a local copy); the 8-belt × 2-theme `--road` loop ≥ 4.5 for `--fg-muted` and `--fg`; a grain-contrast check that `--fg-muted` on `--bg` mixed with the tile's mean grey at `--paper-opacity` (the mean is written by `scripts/paper-tile.ts` as a constant beside the data URI) shifts by < 0.1 from the untextured ratio (§2.3); `motion.test.ts` as §6.8; `components.test.ts` still passes (literals 60–240 ms, no colour literals, text-safe tokens); `base.test.ts:124-126` still finds both reduced blocks; CSS byte count asserted ≤ 403 KB total.

### A2 · shell-router (Phase A)

Paths: `src/main.tsx`, `src/app/App.tsx`, `src/app/App.css`, `src/app/App.test.tsx`, `src/app/router.ts`, `src/app/router.test.ts`, `src/app/transitions.ts` (new) + test, `src/app/Layout.tsx`, `src/app/Layout.css`, `src/app/Layout.test.tsx`, `src/i18n/strings.ts`, `src/i18n/banned.test.ts` (A2 owns the scanner: it adds `public/calendar/koyomi.json` to the data-table scan for A3), `src/shared/ui/Ticker.tsx` (new) + test, `src/shared/ui/Lantern.tsx` (new) + test (the self-contained header tongue, §5.10), `src/shared/ui/use-reveal.ts` (new) + test, `src/shared/routes.ts` (only if `apply()` needs a hook; prefer not). **One allowed edit outside these paths:** a one-line `export function isCeremonyOpen(): boolean { return current !== null; }` in `src/art/ceremony/CeremonyHost.tsx` (the `current` variable at `:88` is module-private; D1 owns the rest of that tree).

Tasks: import `motion.css` after `arcade.css`; `scrollToY` → `scrollTo({ top, behavior: 'instant' })`; prefetch the dojo chunk during boot and start the arrival VT from `App` when `ready` flips with the chunk resolved (§7 A); `PageHost` starts the VT at module resolve per §6.4, retires `.page-stale`, `.page-enter` fallback, focus and announce on `finished`; `transitions.ts` with `travelOf`, `heroFor`, `canTransition`, `afterPaint`; fixed `view-transition-name`s; header `.hairline`; `.layout__brand` ignition once per day (tomosu, Night glow via `--glow-shu`, Morning plain); the flame → `.lantern` with visible state word and forgiveness chips (reads `streak.freezes`, `restDaysTaken`, `weekly`, `repairWindow`); `S.flameUnlit`, `S.streakPaused` ("Streak paused · repair open: {done} of 3 days"), `S.sinceYesterday` prefix, chip strings; `<Ticker>` on Lv/XP and `.meter` on the XP bar; `contain: paint` on the header; toasts and notices exit via `@starting-style`; chrome kasure for `in`/`out` instead of `display: none`.

Acceptance: `App.test.tsx` — with a recording `document.startViewTransition` fake the callback runs after the module resolves and resolves after two frames; without the API `.page-enter` appears; with `settings.reducedMotion` the API is never called; `html[data-travel]` equals `forward` for dojo → road and `in` for dojo → train; `focusMain` runs on `finished` when `document.activeElement === document.body` and does not run when the page has focused an element. `router.test.ts` asserts `behavior: 'instant'`. `Layout.test.tsx` asserts the lantern renders the English state word for all six states and "Unlit…" when `totalDays === 0`, the chips for `freezes: 2`, and the kintsugi class only with an open `repairWindow`. `Ticker.test.tsx` asserts the DOM text equals the final value immediately and no rAF under reduced motion. `banned.test.ts` passes on the new strings. `fonts.test.ts` passes (no new kanji here).

### A3 · calendar-theme (Phase A)

Paths: `src/shared/koyomi.ts` (new) + `koyomi.test.ts`, `public/calendar/koyomi.json` (new), `src/app/theme.ts`, `src/app/theme.test.ts`, `src/app/pages/SettingsPage.tsx`, `src/app/pages/settings.css` (new), `src/shared/store-types.ts` (the `Theme` union gains `'sky'`; three *optional* fields on the existing `Progress` interface — `arrivedDay?: EpochDay`, `sceneSeen?: SceneInputs`, `stationSeen?: number` — for B1 and C2; no new slice, so `SLICE_KEYS`, `store.ts` and `backup.ts` stay untouched), `src/store/defaults.ts`, `src/store/migrations.ts` (+ tests: `coerce` keeps the optional fields when present and drops nothing).

Tasks: §4.3 module (`skyPhase`/`seasonOf` moved here, `room.ts` re-exports — coordinate: `room.ts` is B1's; A3 adds the new module and B1 switches the import); `applyCalendar` and the boundary timer in `startThemeSync`; `--belt-color` from `profile.belt`; meta theme-color from the sky horizon; theme change wrapped in a 400 ms VT (moment G) when `canTransition()`; `theme: 'sky'` scheduling with `effectiveTheme` reading the phase; Settings radios with live swatches and the one-line explanation; the sekki table's pigments exported for A1's test.

Acceptance: `koyomi.test.ts` snapshots (24 sekki, 72 kō, 30 moon days, boundary math across DST in `America/Los_Angeles` and `Asia/Tokyo`); `theme.test.ts` asserts attributes and properties for four fixed instants (05:30 dawn / 12:00 day / 18:00 dusk / 23:00 night), `--sekki-mix ≤ 3%` for every day of a year, `data-color-scheme` under `'sky'` at 12:00 and 21:00, the meta colour, and that `applyTheme` is called inside the VT callback when the API exists. `banned.test.ts` on the JSON glosses — A2 adds `public/calendar/koyomi.json` to the scanner's data-table list (A2 owns `banned.test.ts`); A3 lands the file and asks for the hook in its PR. No new kanji in `src`: the sekki *and* kō Japanese names live in `koyomi.json`, `koyomi.ts` holds ids, romaji, English, dates and pigments only, so `fonts.test.ts` is untouched by A3 and A3 does not wait for A4.

### A4 · fonts (Phase A)

Paths: `scripts/fonts/build-fonts.py`, `public/fonts/*.woff2`, `src/styles/fonts.css`, `src/styles/fonts.test.ts`.

Tasks: add an explicit `EXTRA_UI` list of the 13 code points to `build-fonts.py` (they never enter `src`, §3.5 / §4.3) and mirror it in `fonts.test.ts`'s inventory; add the Yuji `shell` slice (declared after `base`, ≤ 60 KB, glyph list in §3.5) and the Shippori `shell` slice (≤ 40 KB: the 24 sekki names, 節気, 第宿 + 一〜十, 令和元年月日, the eight moon names, the omikuji heads); extend `fonts.test.ts` at **every** anchor the new slice name touches — `:30` (`slice()` regex `-(base|n5|n4|n3|n2|rest)` would throw on `shell`), `:86`, `:94-95`, `:105`, `:125` (`list[list.length-1]` is taken as `base`; `shell` is declared after it, so the lookup becomes "the face named `base`"), `:91` (base declared last → `shell` may follow), `:135` (the `src` URL whitelist `(rest|n2|n3|n4|n5|base)`), `:140` (no orphan slice); add a test that `YujiSyuku-shell.woff2` ≤ 60 KB and covers つづく, the belt names, STATIONS and the flame glyphs, and that `ShipporiMinchoB1-shell.woff2` ≤ 40 KB and covers the column's glyphs; add a frozen `UI_KANJI_ALLOWED` snapshot so "no new UI kanji outside §3.5's list" is a test, not a request (the inventory walk's set must equal the landed set ∪ §3.5's additions). A4 has no ordering dependency on A3 or B1.

Acceptance: `fonts.test.ts` green on the rebuilt tree; `public/fonts` has no orphan; **the real first-paint sum** — `DotGothic16-base` + `YujiSyuku-shell` + `ShipporiMinchoB1-shell` — ≤ 250 KB asserted from the files on disk, plus a static CSS-parse test that no selector in `src/styles/*.css`, `src/app/**/*.css` or `src/art/dojo/**/*.css` sets `--font-mincho` or `--font-neon` outside the `shell`-covered classes (`.tategaki-column`, `.sign__ordinal`, `.seal-date`), so the Dojo's first paint cannot quietly pull a `base` slice again.

### B1 · dojo-home (Phase B)

Paths: `src/app/pages/DojoPage.tsx`, `src/app/pages/DojoPage.test.tsx`, `src/app/pages/pages.css`, `src/app/pages/strings.ts`, `src/art/dojo/**`, `src/session/dojo-feed.ts` (+ test). The optional `progress.arrivedDay` / `progress.sceneSeen` / `progress.stationSeen` fields are A3's; B1 lands after A3 and reads them.

Tasks: moment A; the `.shoji` mount; since-yesterday diff and captions; `.tategaki-column` with the glossed-only fallback chain (§3.3: Mastered sentence or the greeting triple, never the teaser or the proverb) and `.dojo__proverb` moved off Mincho (§3.1); one hanko + `.sheet` tiles with seal corners; wet quest ticks; the genkan strip (imports `src/art/road/` from C2 — land after C2's strip component or ship a first version with the existing row art); scene restructure so `phase`, `lanternsLit` and `hearth` leave `sceneKey` and become wrapper attributes with two sky rects crossfading (`.room__sky--a/--b`, opacity, `--dur-4`); moon and ornaments from `koyomi`; hearth relight by class (`dj-hf--steady`, a class B1 introduces beside the existing `dj-hf` id) and `scaleY`; hearth tongues share their shape with A2's `Lantern.tsx` (export `tongue()` or import the shared path — B1's call, after A2 lands); real crest and goshuin `<symbol>`s on shelf and rack (`mon.ts monParts :641`, `goshuin.ts goshuinParts :290`); `compact` below 640 px; kotodama `will-change` cap 24; mountain card from `awayStatus()` with the honest spread count; bonsai healing interpolation; `bonsaiPruned`/`scrollEmpty` tips wired; next-station off-by-one fixed.

Acceptance: `DojoPage.test.tsx` (moment A tests above; the banner text for `returnedDaysAgo: 1, spreadDaysLeft: 5`; exactly one `.hanko` in the rendered page); `DojoScene.test.tsx` asserts `sceneKey` is unchanged across an hour change and the wrapper's `data-phase` changes; snapshot of the scene at day 1 / day 30 / pruned in both themes; node count ≤ 420; `banned.test.ts` green; `fonts.test.ts` green (phase words, moon names and ornament labels are in base; sekki names wait for A4's rebuild and render the covered subset until then).

### B2 · end-card (Phase B)

Paths: `src/session/EndCard.tsx`, `src/session/EndCard.css`, `src/session/EndCard.test.tsx`, `src/session/end-card.ts` (+ test), `src/session/end-card-strings.ts` (new), `src/session/pages/TrainPage.tsx`, `src/session/pages/TrainPage.css`.

Tasks: moments B and C; `--stage-*` replaces every hex; Dela `<Ticker>` tally; lantern for today; delete `EndCard.css:356`'s `belt-flip` in favour of A1's canonical one; 次回予告 column ≥ 720 px — **still 03 §10's three lines** (the preview sentence with its ???, three words for tomorrow, the Gatekeeper / exam / Kage line): when a next-station vista exists its name rides *inside* line 3, which already names the next Gatekeeper's town ("The Gatekeeper of Hara · Fuji view awaits in about 4 days"); no fourth line, and 03 §10 is not amended; `tsuzuku-mark` hero; "The dojo keeps your place." Acceptance: as moment B; `EndCard.css` has no colour literals (extend the no-literals check to this file); `sfx` called with `tsuzuku` once and never with a BEST recipe.

### C1 · session-loop (Phase C)

Paths: `src/session/SessionView.tsx`, `SessionView.css`, `SessionView.test.tsx`, `src/session/Hud.tsx`, `Hud.css`, `src/session/strings.ts`, `src/session/runner.ts` (sfx hooks only), `src/shared/ui/ui.css`, `src/shared/ui/ExerciseFrame.tsx`, `Feedback.tsx`, `TeachOnce.tsx`, `JudgeCard.tsx`, `src/exercises/ChoiceGrid.*`, `TextAnswer.*`, `PitchLine.*`, `check.ts`, `strings.ts`, `src/exercises/grammar/**`, `src/exercises/kanji/**`, `src/exercises/listening/**`, `src/exercises/vocab/**`, `src/exercises/fluency/NemesisDossier.*`, `src/exercises/fluency/strings.ts`, `src/exercises/kana/KanaEar.tsx`, `KanaFlash.tsx`, `KanaForge.tsx`, `src/exercises/kana/strings.ts` (RapidFire, Gojūon Fighter and `kana.css` are D1's).

Tasks: moments F, I, J; delete the `ui.css` duplicates once A1's canonical definitions land (`.sr-only` at `:11`, the combo tiers at `:220-238`, `belt-flip` at `:463`); chrome handoff with A2's `in`/`out`; `.reveal[data-kind]` replacing the 13 local result panels; `.meter` for ki and the Forge Bar; tile stagger; the `.hanko.is-pressed` toggle; TextAnswer caret and drawn underline; Scramble and Component Assembly FLIP (transform only); PitchLine hiku; RapidFire card osu on `--spring`, clock tick ≤ 1 Hz; recorder meter `scaleY`; TeachOnce and pause overlay exits; combo tier rule in one place. Acceptance: as moments F, I, J; `arcade.test.ts` still green; no `width`/`height` in any `transition` or `@keyframes` under these paths. The grep test in `motion.test.ts` (A1) walks `src/**/*.css` but carries an explicit allow-list of the four `src/input` sites (`reader.css:435`, `RolePlay.css:379`, `speaking.css:369`, `speaking.css:228-235`) until C4 lands and deletes the allow-list in the same change — so C1 can go green without touching C4's tree.

### C4 · input-surfaces (Phase C)

Paths: `src/input/**` (reader, listening `Radio` + `ListeningArena`, speaking, taiwa, writing, missions, `pages/StoryPage*`, `pages/RadioPage*`, every `strings.ts` under it), `src/session/TeachCard.tsx`, `src/session/TeachCard.css`, `src/session/TeachCard.test.tsx`, `src/session/engine-strings.ts`.

Tasks: `.meter` replaces `.taiwa__meter`, `.monologue__track` and `.speed__bar` and their three `width` tweens; `recorder-level` (`speaking.css:228-235`) animates `scaleY`; `.eyebrow` replaces the `src/input` `__label` / `__eyebrow` classes (`.story-page__eyebrow` among them); the `--ai-dye` band on `Radio`, `ListeningArena` and `SentenceListen`'s host page (§2.1, §4.1); story and mission cards become `.sheet`; the reader's Mincho body gains `--lh-mincho` / `--measure-ja`; TeachCard's stagger takes the `min(var(--i), 7)` cap; delete the per-file reduced-motion blocks as each file is touched; remove the four entries from `motion.test.ts`'s allow-list. Any string D1's Gate / Shinsa / Kage views need from `engine-strings.ts` (belt names, `fill`) is imported read-only — D1 adds its own copy to `src/session/arcade-strings.ts` and never edits this file.

Acceptance: `motion.test.ts`'s `width`/`height` grep passes with an empty allow-list; `RolePlay.test.tsx` / `speaking` tests assert the meter's `--value` and that no `width` transition remains; `fonts.test.ts` green (no new kanji); `banned.test.ts` green.

### C2 · road-station (Phase C)

Paths: `src/session/RoadNav.tsx`, `RoadNav.css`, `RoadNav.test.tsx`, `src/session/pages/RoadPage.tsx`, `StationPage.tsx`, `src/session/pages/pages.css`, `src/session/pages/strings.ts`, `src/art/motifs.ts` (new) + test, `src/art/road/**` (new: `headpiece.ts`, `vistas.ts`, `GenkanStrip.tsx`), `src/art/wallpapers/*` only to export the private motif functions it lifts.

Tasks: moment D; `motifs.ts` (pine ×3, torii ×4, chōchin ×4, pagoda ×2, Fuji profile, wave crest, bridge from `catenary`, checkpoint gate, teahouse, inn — lifted from `fifty-three.ts`, `golden-screen.ts`, `chaya-lanterns.ts`, `lantern-river.ts`, `okaeri.ts`, `sakura-storm.ts`, `kyoto-arrival.ts`, `fuji-ridge.ts`, `great-wave.ts`); the 160 px headpiece; a 53-row `vistas.ts` table keyed to the keeper themes but rendered **only** as headpieces and the three-town genkan strip, not a full emaki hero; `.sign` on rows and the Station headpiece with the romaji line gated by the kana-Green rule (§3.3; `StationPage.tsx:255` shows `nameRomaji` unconditionally today); `sumiFilter` for towns ahead; `--road` as the band behind the vignette and under the headpiece, never under `.sign` text; delete `RoadNav.css:239`'s `.tokaido .sr-only` override once A1's canonical `.sr-only` lands; the vertical `.tokaido` stays the complete index. Acceptance: as moment D; a Vitest snapshot of the Hara headpiece at 280 and 720 px, day and night, with and without reduced motion (the go/no-go for a later full emaki); RoadNav rows ≤ 40 nodes each; `fonts.test.ts` green (every sign kanji is in base; 西 船 雲 霧 stay drawn, never typed).

### C3 · collections-records (Phase C)

Paths: `src/collections/**`, `src/records/**`, `src/art/GoshuinStamp.tsx`, `GoshuinStamp.css`, `src/art/MonCrest.tsx`, `MonCrest.css`, `src/art/goshuin.ts` (shared def), `src/art/mon.ts` (stone variant only).

Tasks: moment E inline via `useReveal`; stone-locked crests; goshuin `<img>` + 320 ms page turn + `.sheet--gutter`; kakejiku rail; Library shelf rails (`--wood`), `grid-template-rows 0fr→1fr` expand, new-item gold dot; Records: `.status-window` reuse, Dela tickers, radar month morph (600 ms points tween), chart type ≥ `--fs-1`, Projected Arrival line unchanged. Acceptance: `GoshuinBook.test.tsx` asserts ≤ 2 `<filter>` elements in the mounted book; `MonGrid.test.tsx` as moment E; `RecordsPage.test.tsx` asserts the radar renders both polygons when a previous month exists and the tiles' final values, and under `settings.reducedMotion` that the polygon carries no transition class and both polygons are present at once.

### D1 · ceremonies-arcade (Phase D)

Paths: `src/art/ceremony/**` (except A2's one-line `isCeremonyOpen()` export), `src/audio/sfx.ts` (taiko timing table only) + test, `src/session/GateView.tsx`, `GateView.css`, `src/session/ShinsaView.tsx`, `ShinsaView.css`, `src/session/KageView.tsx`, `KageView.css`, `src/session/arcade-strings.ts` (new: poster titles, stone / shatter captions, the "ahead" towns on Kage, Shinsa sheet heads), `src/exercises/fluency/RapidFire.tsx`, `RapidFire.css`, `src/exercises/fluency/rapid-strings.ts` (new: the BEST eyebrow and poster copy), `src/exercises/kana/GojuonFighter.tsx`, `src/exercises/kana/gojuon-strings.ts` (new), `src/exercises/kana/kana.css`. All three new files match `banned.test.ts`'s `*-strings.ts` glob (`STRINGS_RE`, `:46`) and are scanned automatically. **D1 never edits** `src/session/pages/strings.ts` (C2), `src/session/engine-strings.ts` (C4), `src/exercises/strings.ts`, `src/exercises/kana/strings.ts` or `src/exercises/fluency/strings.ts` (C1): the views keep importing what they import today and add the new copy from their own files.

Tasks: `--stage-*`, `--spring`, token durations throughout; exits on dismiss; one table owning taiko hits (visual 0/700/1400 ms = recipe); the palette sweep as a clip-path wipe; silk `scaleY`; seeded ink-wash backdrop; belt-chip hero; Gate wall stone + shatter; Shinsa sheets + 600 ms sumi beat; the poster treatment for Kage / Rapid Fire / Gojūon (`.poster-title`, bokashi band, kentō, lanes as `.meter`, digits roll, `.hiscore` table with the BEST eyebrow against the learner's own `stats.bestCombo` / `rapidBest` only); mount or delete the arcade spectacle classes per A1's decision; CRT stays opt-in. Acceptance: `BeltCeremony.test.tsx` asserts `BELT_PHASE_AT` taiko entries equal `sfx` recipe offsets; `arcade.test.ts` green; a **static CSS-parse** glow-count test over `KageView.css`, `arcade.css` and `motion.css` counts the selectors that set `box-shadow: var(--glow-*)` under `data-feel=arcade` / the dark blocks and asserts ≤ 6 (jsdom does not resolve custom-property cascades, and no test in `src` uses `getComputedStyle` today); `banned.test.ts` green on the three new strings files (`banned-phrases.ts:46-47` keeps "Insert Coin" as a kakejiku title and has **no** grep for it; none is added).

## 11. Prototype checklist

The live HTML prototype (one static page, both themes, no build step, tokens pasted from `tokens.css`) must demonstrate, with a reduced-motion toggle and an fps readout:

1. `--paper` on `body` and three `.sheet`s beside three `.card`s, Morning and Night, at 390 px and 1,280 px.
2. Meku between three fake routes: `forward`, `back`, `in` (mat dim) and `home`, with the `clip-path` wipe, then the same with `startViewTransition` stubbed out (fallback nijimi), then under reduced motion (150 ms fade, no wipe).
3. The arrival: ensō drawn on closed shōji → panels part → ensō lands on a wall-scroll placeholder → phase word → column → one since-yesterday pulse; any tap skips; a button under the panels stays clickable throughout.
4. The End Card: つづく written in 1,200 ms, Dela tickers staggered, belt flip, lantern for today, ??? gold pulse; then "Rest." carrying the mark into a hearth that relights by `scaleY`.
5. The Road: spine drawn, seal osu → kawaku (wet layer visibly drying), lantern tomosu, one `.sign` with ruby, one town ahead in ink wash labelled "ahead".
6. The rep: a 2 × 2 choice grid with stagger, a correct ink dot, a wrong dry-brush strike, the ki `.meter` charging the hanko; a hit-stop toggle under an "arcade" switch.
7. Kure: a theme switch animated top-down in 400 ms with lanterns lighting.
8. The column at three dates (Feb 4, Jul 23, Oct 24) with the paper tint stepping and the moon changing; a contrast readout for `--fg-muted` on the tinted paper.
9. The header: `.lantern` in all six states with the English word, forgiveness chips, kintsugi seam toggled by a "repair open" switch.
10. A poster title (Kage VS) in both themes with the 1 px misregistration and kentō marks, next to a glow-count badge reading ≤ 6.

## 12. Open questions for the owner

1. **Dark-block dedupe.** `tokens.test.ts:77` pins both dark blocks and the media pattern; Vision 3's `data-color-scheme`-only palette with a pre-paint script is the right end state but a test rewrite and a no-JS first-paint change. Schedule it as its own change after Phase A, or leave the duplication?²
2. **Follow the sky.** Ship `theme: 'sky'` in Phase A (A3) or hold it until the Dojo's sky crossfade (B1) is in?
3. **Font rebuild logistics.** The pipeline needs fonttools + brotli in a venv and the four OFL TTFs downloaded; is a machine available while the voice render runs, or does A4 land last?
4. **Dela for numbers in Morning.** This file sets Dela for "the number that matters" in both themes; if the Morning page should stay pixel-only, D1/B2/C3 switch the tally and tiles to `--font-pixel` and Dela stays a Night poster face.
5. **Chosen kanji.** 06 §5's wall scroll waits for `profile.chosenKanji`, which nothing writes; the belt ceremony is the natural place for the choice. It is a 06 question, not a 09 one — approve a small D1 addition, or keep the ensō?
6. **The full emaki.** C2 ships headpieces and the genkan strip only; the Hara snapshot is the go/no-go for a horizontal Road hero in a later cycle (and would also settle 01 §4.4's "horizontal scrolling road", built vertical).
7. **Hit-stop.** Keep it (Arcade feel only, JS class, 33 ms) or drop it as the one piece of arcade juice that does not print?
8. **Kō glosses.** The 72 English glosses are ours to write; who reviews them for the Sensei voice before `koyomi.json` lands?
9. **Shippori `shell` glyph list.** §3.5 sizes it at ≈ 60 glyphs / ≤ 40 KB from the Yuji ratio; if the real cut lands over 40 KB, does the Dojo column stay in `--font-ja` for good, or does the budget give up Yuji `shell` bytes (shorter station-name list) to keep Mincho on the column?
10. **Frame protocol device.** §10's protocol uses DevTools 4× CPU throttle as the stand-in for a mid-range Android; is a real device available to calibrate the 18 ms line once, before A2's PR?

### 12.1 Lead decisions (binding; 2026-10-18)

Answers to the ten questions above, taken before Phase A, plus the eleven taken on Phase A's integrator census. Later phases build on these, not on the §10 figures they replace.

1. **Both dark blocks stay** this programme; no `data-color-scheme`-only dedupe. (Night-only *component* rules may still key off `:root[data-color-scheme="dark"]`, which `theme.ts` writes before first render — A1 does so for the status-window hairline and the sheet's gold dust.)
2. **Follow the sky ships in Phase A** (`theme: 'sky'`, A3): dawn and day are Morning, **dusk and night are Arcade Night** (the spec's "turn to Arcade Night at dusk" wins over the earlier 20:00 line).
3. **A4 rebuilt the fonts now** (fonttools + brotli in a scratchpad venv, the four OFL TTFs downloaded beside it). Yuji `shell` 49.3 KB, Shippori `shell` 14.9 KB, first paint 118.9 KB ≤ 250 KB.
4. **Dela stays "the number that matters" in both themes**; `.poster-title` is on the font fence's planned list (arcade titles only, Dela loads on first use).
5. **Chosen kanji:** the ensō stays on the wall scroll; nothing new.
6. **The Hara headpiece snapshot is the go/no-go** for any later horizontal emaki (Phase C).
7. **Hit-stop stays** (Arcade feel only, a JS class, 33 ms; Phase C).
8. **The 72 kō glosses** were reviewed by A3's skeptic for the Sensei voice before `koyomi.json` landed.
9. **The Shippori `shell` slice shipped** (14.9 KB ≤ 40 KB), so `.tategaki-column` is **Mincho by default**; `[data-face="ja"]` opts a column out. The Mastered sentence inside it may pull one non-shell Shippori slice after first paint (cached by the fonts cache); B1 may set that one line to `--font-ja` if it prefers, nothing else. *Amended by d23 at Phase B close.*
10. **Frame protocol:** DevTools 4× CPU throttle is the stand-in, documented in each PR's checklist; no device. No owner has run it yet — A2 and C2 run it before Phase C closes.
11. **CSS budget re-based.** §10's 26 KB gross / 403 KB total under-counted `motion.css` (19.7 KB after compaction, implementing all twelve A1 component classes, seven verbs and the View-Transition contract). Phase A landed at **412.5 KB**. `motion.test.ts` asserts **415,000 B for Phase A and 425,000 B for the whole programme** (`CSS_CEILING_PROGRAMME`): Phases B–D may add at most 12.5 KB net between them and each deletes what it replaces (the 49 reduced-motion blocks, the bar and status-window clones, the 13 result panels). The 389,000 ratchet the task text imagined is withdrawn.
12. **View-Transition selectors are attached, never descendant.** `::view-transition-*` pseudo-elements hang off the root element, so `html[data-travel="back"] ::view-transition-new(main)` (with a space) matches nothing — A2 probed this in Chrome 156 and the lead fixed all fifteen rules in `motion.css` to `html[data-travel="back"]::view-transition-new(main)`; `motion.test.ts` now rejects the descendant form outright. Specificity after the fix: reduced-motion overrides `:root:root::…` (0,2,1) still outrank the travel variants `html[attr]::…` (0,1,2).
13. **One home for the §6.4 contract rules:** the `html[data-vt="theme"]` name suspension and `html:active-view-transition { scroll-behavior: auto }` live in `motion.css` only; `Layout.css` keeps its own `html:active-view-transition .layout__*` rules (blur rest, chrome hold) and its test asserts the absence of the duplicates.
14. **Moon names:** A3's traditional eight stand — 新月 三日月 半月 十三夜 満月 十六夜 二十三夜 二十六夜 (the Edo moon-viewing nights are better teaching than invented "waning twins"). Every display carries romaji and the English gloss from `MOON_NAMES` / `koyomi.json` (the zero-Japanese rule, 01 §4.1).
15. **`calendar/koyomi.json` is precached** with the shell by `public/sw.js` and served stale-while-revalidate under `calendar/`, so the first offline morning still has its kō name. Nothing fetches it at boot (no network on first paint); B1 calls `fetchKoyomi()` from the Dojo once the picture is up.
16. **`--road` mixes the belt at 10 %, not 12 %**: with OKLab mixing, `--fg-muted` on the Morning black-belt road measures 4.39 : 1 at 12 %; 10 % is the largest integer mix that passes all sixteen belt/theme pairs (worst 4.61 : 1). The paper tile's alpha row is the speck row (`2·n − 0.9`), which keeps the §2.3 grain-contrast shift at 0.05 instead of 0.14.
17. **`Progress.sceneSeen` is the structural `SceneSeen`** (`store-types.ts`: belt, level, dan, chosenKanji, badgeCategories, latestStamp, kageBeaten, totalDays, streak, blooming, pruned, counts, station, flame). The contract tier never imports the art tier, even type-only; `SceneInputs` is assignable to it and B1 persists only those fields.
18. **Arcade spectacle deleted, not allow-listed:** the idle `.glow-edge` breathing, `.speed-lines` spin, the `.ippon-flash` scale pop and the `.ki-bar` animated box-shadow pulse are gone (rules 1–2); `.crt .halftone .arcade-head .hiscore` stay gated for D1, `combo-pop` moved to `components.css` at `--dur-3`, and `arcade.css` carries zero animations.
19. **Follow-ups parked for Phase B** (not Phase A defects): the boot mark as a self-drawing ensō (A beat 0; an inline SVG circle with a composited `stroke-dashoffset` draw in `App.tsx`, ~15 lines, B1's arrival work); phone header density below 480 px (belt chip + lantern word + up to four chips + days line + Lv/meter wrap to a third row at 320 px — collapse the chips, CSS-only, `Layout.css`); the Kage `data-roll` per-column `translateY` for `<Ticker roll>` (the Kage surface, Phase C); the §6.5 XP delta text in Dela (B2 — *withdrawn by d26*); `gateJa` / belt `titleJa` are not in the Yuji shell, so a Station headpiece set in brush fetches `YujiSyuku-base` on the Station page, not the Dojo (C2 decides; ≈ 30 glyphs of shell headroom exist).
20. **The onboarding summary** for a save that already carries `theme: 'sky'` reads "Follow the sky" (reusing A3's label; the onboarding radiogroup itself still offers auto / light / dark — the sky choice lives in Settings next to the sky swatch).
21. **`fonts.test.ts`'s frozen UI-kanji inventory is 551 glyphs** (538 landed + 13 `EXTRA_UI`) and goes red whenever an owner adds or removes a UI kanji in `src`; each phase's integrator re-snapshots it once as the last step, after confirming every new glyph is in a base or shell slice.

Phase B (Dojo home arrival, End Card ceremony, shell follow-ups; three owners, nine skeptic lenses, three fixers, one integrator census) landed the same day. Lead decisions 22–34 were taken on its census and the owners' open items.

22. **The sky-phase word is brush.** 朝 昼 夕 夜 joined the Yuji `shell` (`DOJO_BRUSH_KEYS` reads the four `dojoPhase*Ja` keys from `src/app/pages/strings.ts`; shell 49.3 → 52.5 KB ≤ 60 KB, first paint 122.0 KB ≤ 250 KB) and `.dojo__phase-ja` is `--font-brush`. The word sits over the stage's top edge (`.dojo__phase`, out of flow, `--shu`) for two seconds, not literally under the header brand: the brand slot stays A2's and is not opened for it. The beats are per element (shōji at mount, the word at 2 s, the first pulse ≈ 1,700 ms after mount, forecast and hanko nijimi on `--i`), not one timeline.
23. **Decision 9 amended — first paint beats Mincho.** In the tategaki column only the sekki and moon names are Mincho from the shell. The kō name (72 names, outside the shell), the greeting kana, the Mastered sentence and the era digits ride `--font-ja` / `--font-pixel` (each digit run in `.tategaki-column__tcy`, `text-combine-upright: all`), so the first paint never fetches `ShipporiMinchoB1-base` (208 KB). The End Card omikuji stays `--font-ja` for the same reason (the proverbs' glyphs are outside the shell).
24. **The since-yesterday pulse keeps its blur in Morning.** `glowTwin` merges a blurred copy of the part with itself in the part's *own* colours — no kin, no flood — so in Morning the pulse reads as nijimi (the ink wet again) and in Night as a glow; rule 2 forbids luminous gold, and the pulse carries none. Two twins live at most (`PULSE_STAGGER_MS`), the lantern glow filter rests under `[data-pulsing]`, and the wet seal's `#ink-bleed-8` rests while the stage pulses: the page never holds more than two live SVG filters. The lantern glow itself is Night-only (`:root[data-color-scheme="dark"]`).
25. **CSS ceiling re-based to 421,000** (`CSS_CEILING_PHASE` in `motion.test.ts`; the tree measures 420,792 B after the lead fixes). Owner nets: B1 +5,982 B against a ≤ 4,096 target, B3 +1,405 against ≤ 1,024, B2 +856. The programme ceiling 425,000 is unchanged, which leaves Phases C–D **4,208 B net**: C1, C3 and C4 must delete first (the 47 `__label` / `__eyebrow` classes, the `ui.css` combo copy, every reduced-motion block the global rule already covers) and the integrator reports each owner's net as a signed figure.
26. **Decision 19's "XP delta text in Dela" is withdrawn.** §3.1 lists XP deltas under Pixel and the header has no delta text (Lv ticks in a `<Ticker>`, the meter fills); the Dela number of the session loop is the End Card tally, already Dela + `--kin-text`.
27. **Rest-surface copy:** "N reviews still due today." is now "{n} reviews remain." / "1 review remains." (`src/session/strings.ts`). Under "The dojo keeps your place." the old line read as a deadline (03 §1 forgiveness).
28. **Header density (B3, measured in headless Chrome 156 with DotGothic16):** below 480 px the chips fold to one "+N" chip whose hidden text lists them; the everyday states hold two rows at 320 px; while a repair window is open the status takes three rows at every phone width, because "Streak paused · repair open: N of 3 days" cannot share a row with Lv without hiding content — accepted, the repair state is designed copy (§5.10, §8). The decorative 氷/休 chip glyph hides ≤ 360 px. The fold stays below 480 px (481–700 px with four chips is four rows; one media figure if ever wanted). `daysLine()` lets an open repair window win over `current` (the store sets `current` to the days done inside the window).
29. **The End Card lantern follows the sky.** In Arcade Night during daytime hours `--lamp-alpha` is 0, so the tomosu catch rises to 0 and only the tongue colour marks beat 2,400 — accepted. The lantern is the sky's instrument; the tally is the ceremony.
30. **Mountain-card arithmetic:** `awayStatus()` gives `spreadDaysLeft = 7 − returnedDaysAgo`, so the §8 example reads "Day 2 back · 6 spread days left" (this file and the `DojoPage.tsx` comment corrected). `mountainLine` renders whatever `awayStatus` returns; the absence length is never printed; the generic `S.dojoMountain` shows when the daily rows cannot see the absence.
31. **Two store writes on the arrival:** `DojoPage` patches `arrivedDay`, `DojoScene` patches `sceneSeen` from its own `SceneInputs` (the shell may not import art-tier helpers such as `badgeCategoryCount` or `BLOOM_DAYS`). A second render the same day patches nothing (tested by progress-signal identity). `sinceYesterday()` is growth-only: nothing lost is pulsed or captioned; the hearth pulses only when it climbs `HEARTH_RANK`; Kage both ways (§8, the week). The relight is held at `dj-hf--unlit` until the flames' idle slot lands, then one style flush before the state class, so the tongues grow from 0 rather than appear.
32. **End Card deviations accepted:** the DOM carries the final tally from first paint and each `<Ticker>` is remounted at the beat to roll 0 → value (05 §5.8 "final digits in the DOM"; `SessionView.test.tsx` reads the tally synchronously); the つづく mask draws through `.ink-hiku[data-axis="stroke"]` with `dashWrite`'s attribute contract rather than importing `src/art/brush.ts` (import rule 4); 次回予告 always renders three lines (`yokokuNoSentence` / `yokokuNoWords` fill the empty slots); one `sfx('promotion')` per belt flip, 40 ms apart, capped at 8, silent in Zen; the page dims to `--stage-bg` over 300 ms through `.end-card::before` because `SessionView` unmounts the controls synchronously (C1 fixes the kasure, d33).
33. **Carry to Phase C** (into the owners' briefs): **C1** holds the Hud and ExerciseFrame under `data-leaving` for `--dur-1` when `done` flips and mounts the End Card on `animationend`, so beat 0's kasure exists; glosses the three kana words and the preview sentence of 次回予告 (03 §10 renders them furigana-only, against the zero-Japanese rule). **C2** swaps the genkan `.sign` plates for the `src/art/road` strip (romaji gated on the kana belt, Ruby after Green), wires `vista` into `jikaiYokoku` once `vistas.ts` lands (`gateNameOf` and `ES.gateWithVista` are in place), decides `gateJa` / `titleJa` (Yuji shell headroom after d22 ≈ 7 KB), and ships the Kage `data-roll`. **A2 + C2** run the frame protocol (`docs/design/09-frame-protocol.md`; every §5 row reads "not yet run") for Phases A–C, including the hearth relight on the real Rest → Dojo path and the theme-gated `url(#dj-lantern-glow)` with the hash route in the URL; Phase C does not close with an empty row. `boot.test.tsx`'s `waitFor` deadline is 8 s (was 4 s; the grown Dojo chunk measured 4,081 ms cold).
34. **`fonts.test.ts` inventory re-snapshotted at 550** (炎 U+708E retired with `EndCard.tsx`'s `FLAME_GLYPH` table; `YUJI_WORDS` keeps the five flame glyphs for a brush lantern word, nothing sets them in brush today). The slices were rebuilt from the 550-glyph inventory with the four phase words (d22): `public/fonts/*.woff2` and `src/styles/fonts.css` changed; 25 faces, 2.16 MB total.

---

### Appendix A · What this document deliberately leaves out

Deckle-edge masks (scrapbook kitsch, paint cost)¹ · misregistration near reading text or on numbers · any Mincho beyond §3.1's fence · pointer or scroll parallax of any kind · idle neon breathing or any animated `text-shadow` · "paper, then ink, then text" as a drill-loop rule · Arcade Night as the hero or neon signage in Morning chrome · rain loops on the End Card or ceremony backdrop · the six nav words hanging as signs on the scene · a seven-slot week row with unlit days (a streak chain in costume) · a BEST chase on the End Card⁵ · a 1.2 s theme fade (400 ms) · `!important` reduced-motion layers over the global rule (tokens and `*:not(.rm-fade)` instead) · a greeting speaker button on the arrival surface · the full 53-vista emaki as a second home hero · neon romaji on paper sign plates · default weather loops · "the next kō turns in N days" (a date instead)⁶ · a month of date seals on the Dojo (today's only)⁷ · kintsugi as a permanent scar³ · romaji as a permanent sign line (05 rejects romaji except as input; the reading line is romaji only until kana are Green, then kana ruby) · a fourth 次回予告 line (03 §10 fixes three) · a flickering header flame (loops in chrome) · a `ui` save slice (optional `progress` fields instead) · a View Transition wrapped around `apply()` while a chunk loads · `view-transition-name` set only on `pointerdown` (keyboard users would lose the hero) · hit-stop as a keyframe · verb or season kanji anywhere in `src`.

---

¹ Vision 1 proposed a `mask-image` deckle on `.sheet`; the taste judge rejected it and no other judge asked for it. Grain alone carries the material; the goshuin book's spread is the one place a torn edge could ever return, and even there it waits.
² The taste and habit judges grafted the `data-color-scheme`-only palette; the build judge showed it rewrites `tokens.test.ts:77` and breaks the no-JS first paint. Design 09 keeps both dark blocks this programme and lists the dedupe as open question 1, because a token spec that fails its own test on day one is not a spec.
³ The habit judge: a permanent kintsugi seam is a visible scar of the break. The seam is therefore bound to `Streak.repairWindow` (`store-types.ts:170`) and disappears with it; a repaired flame is indistinguishable from one that never dimmed.
⁴ The build judge: `mask-position`/`mask-size` on a `::view-transition` pseudo-element is paint-level in Chromium. The `clip-path: inset()` wipe is compositor-animatable and gives the direction for free; the brush edge is an experiment, not a dependency.
⁵ The habit judge: a best-hunt is the wrong incentive at the moment that should end the day. BEST lives in the arcade results (Rapid Fire, Gojūon, Kage) and Records, compared against the learner's own history only (`stats.bestCombo`, `stats.rapidBest`), never on the End Card.
⁶ 06 §7 #5: "No countdowns anywhere." The sekki and kō are shown with their dates (霜降 · from Oct 24); "in 3 days" would be a countdown by the letter of the rule even though nothing expires.
⁷ A month of seals on the arrival surface is a streak calendar in paper clothing; the Dojo shows today's seal only, and the history — with its gaps uncounted and uncoloured — lives where it already does, in Records' calendar heat.
