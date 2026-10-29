# TSUZUKU — 01 · Identity and Thesis

**Status:** FINAL design, single source of truth. Supersedes everything in `docs/design-panel/`. Where this set of seven files and a proposal disagree, these files win — **except `docs/ARCHITECTURE.md` and `src/content/types.ts`, which win on ids, file paths, storage keys and type names** (and `docs/module-plan.json` on who builds what, in which phase). Files: `01` identity · `02` progression · `03` sessions · `04` exercises · `05` SRS & pedagogy · `06` rewards · `07` architecture.

---

## 1. Name

**TSUZUKU** (つづく / 続く) — "to be continued." Tagline: **"To be continued. Every day."**

Kept over the three Kotodama-family proposals because the name *is* the product thesis (retention), the logo is the brush-lettered end card every session ends on, and 継続は力なり ("continuation is strength") is the proverb under the whole design. Zero franchise overlap; pronounceable (tsu-zu-ku). Trademark search before launch; fallback **DANDAN** (段々, "step by step" / 段 dan rank).

Runner-up names are recycled as system names so none of the wordplay is wasted:

| Word | Used for |
|---|---|
| 言霊 Kotodama | The spirit flames on the Dojo home screen, one per Black-belt item ("word-spirits you have tamed") |
| 百錬 Hyakuren | The SRS engine (FSRS-5 wrapper) — "a hundred forgings" |
| 修行 Shugyō | The 30-minute session size |
| ぺらぺら Perapera | The five-axis fluency index |
| 五十音ファイター Gojūon Fighter | The kana arcade drill |
| もう一度 Mō ichido | The "once more" button on every miss |

---

## 2. Design thesis

Fluency for an English speaker is a 2,000–3,000 hour problem. No mechanic shortens it. The app therefore has exactly two jobs: **(a)** make a learner show up for 20–40 minutes a day for about two years, and **(b)** guarantee each minute is the highest-value activity for *that* learner at *that* moment — and then **(c)** drive and count the ~1,000 external hours of real input that no app can supply.

Master rule, kept from the winning proposal: **the scheduler is the game master; the game is the costume.** The Hyakuren engine decides *what*; the Tsuzuku layer decides *how it feels*: a fighting-game training mode where words are moves and fluency is "the hands remembering."

Six pillars (five from the winner, one added from the pedagogy panel):

1. **Retrieval is the attack.** Every exercise retrieves or produces. Nothing pays for re-reading.
2. **Receptive and productive are different muscles.** Every item has separate FSRS schedules per facet (`rec`, `listen`, `prod`, …). An item cannot become Mastered without production.
3. **Speed is trained apart from accuracy.** Timers and speed bonuses touch only mature items (stability ≥ 14 days). New and learning items are graded on correctness alone. Rapid Fire is a separate fluency mode.
4. **Input is the engine; the app steers and counts it.** Graded stories, listening sets, and an Input Ledger (耳目帳) with a 1,500-hour lifetime goal. Input share rises from 25 % (N5) to 50 % (N2+).
5. **Rewards are receipts for competence.** Fireworks happen when an item becomes production-stable, a Gatekeeper opens, a belt changes. Never for grinding known items. No randomness anywhere in rewards.
6. **Failure is a whiff, not a death; forgiveness is a feature.** No lives, no hearts, no energy, no shame copy. Streaks forgive. The end card says "rest."

Honesty clause: the onboarding screen shows the road length at 100 % and at 70 % adherence (see `02`), and states the in-app hours **computed from the chosen preset** — `hoursInApp = Σ_belt expectedMinutes(belt, preset) × days(belt) / 60` ≈ **450 h at Standard** (≈ 300 h Casual, ≈ 650 h Intense; `02 §6.1`) — then says plainly that **≈ 1,200+ hours of real listening, reading and conversation remain outside the app**, states the honest share of listening the dojo itself supplies (design 08 §12 — the Ledger and About pages' paragraph, verbatim: "Every voice in the dojo is synthetic: VOICEVOX character voices, pre-rendered, clear and consistent on purpose. The dojo holds about 39 hours of sentences and texts, plus about 7 hours of word and phrase clips for drills, and gives you about 75–95 hours of worthwhile listening over the road, because each piece returns at rising speed. That covers about two-thirds of the weekly listening target at White and Yellow and all of it at Orange, about a quarter at Green, a fifth at Blue and Purple, a sixth at Brown and a seventh at Black. Real people mumble, overlap and joke; the ledger’s outside hours exist for that, and the 1,500-hour goal still needs the world."), and that the ledger's 1,500-hour goal runs past Kyoto into the Dan road (`02 §3`). Every voice in the app is synthetic and says so wherever the learner meets it — *synthetic voice (VOICEVOX)* when the voice pack is present, *device voice* otherwise, *text only* without either; the words *recorded*, *native*, *human* and *real* never describe a voice (`src/i18n/banned.test.ts`).

Art clause: the pictures the learner meets every day — the Dojo's print of the day, the station headpieces, the Road — are public-domain ukiyo-e (Hiroshige, Hokusai) reproduced from CC0 museum scans, each captioned with its title as a reading and its museum credit (design 09 §12.1 d77–d78; `docs/ART_PACK.md`); the drawn room is the fallback when no pack is built.

---

## 3. Tone: the Sensei voice

Terse, warm, dry. Addresses the learner as "you." Japanese appears in copy only when the learner can read it (kana from Station 2, kanji only after that kanji is Green).

| Moment | Copy |
|---|---|
| Miss | "Again. That's the training." |
| Honest "don't know" (Guard) | "Good. Now you know what to train." |
| Backlog mode | "The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty." |
| Session end | "Good training. Rest. つづく" |
| Return after absence | "The dojo kept your place." |
| Cramming cap reached | "Enough new words for today. The dojo will be here tomorrow." |
| Belt exam not passed | "Not yet. The gate will still be here." (then Sensei's Notes) |

**Banned phrases** (CI greps UI strings): "You lost your streak", "Don't let … down", "Only X hours left", "Hurry", "Last chance", "Don't break", "Streak at risk", any exclamation-mark guilt.

---

## 4. Visual identity

### 4.1 Era-to-function map (so the mix never feels random)

| Era / motif family | Lives in | Why |
|---|---|---|
| **Edo road & dojo**: ukiyo-e skies, torii, hanko seals, washi, sumi brush, goshuin stamps, tatami, kakejiku scrolls | Progression, ceremony, stories, light theme | Mastery is slow; paper and ink read as patience |
| **90s arcade**: pixel type, CRT scanlines (opt-in), combo counters, hi-score tables, chiptune | Drills, Rapid Fire, Gojūon Fighter, Kage versus screen | Fast feedback loops need arcade energy |
| **JRPG status screen / synthwave Tokyo**: bevelled windows, stat bars, neon kana signage, rain-slick streets | Dojo home, Records, Perapera radar, dark theme | "Numbers go up" framed as a character sheet, not a slot machine |

Allowed motifs: torii, sakura, pine, Fuji silhouette (generic), waves (seigaiha), asanoha, kikkō, hanko, enso, daruma, koi, cranes, lanterns, shōji, noren, bonsai, katana silhouette, gi and belt, taiko, CRT bezel, arcade cabinet (original), speed lines, halftone, neon tubes, vending machine (generic), station sign (generic). **Forbidden:** any franchise character, logo, title, catchphrase, or recognizable creature design; real operators' signage designs; real living people.

### 4.2 Typography

| Role | Font (OFL, self-hosted woff2 subsets) | Notes |
|---|---|---|
| UI body (Latin) | system-ui stack (`-apple-system, Segoe UI, Roboto, Noto Sans`) | Zero download |
| UI body (Japanese) | OS Japanese font first (`Hiragino Sans, Yu Gothic UI, Noto Sans CJK JP`), Noto Sans JP subset as fallback | `font-feature-settings: "palt"`; line-height 1.8 JP / 1.5 Latin |
| Pixel / arcade | **DotGothic16** (kana + 600 UI kanji + Latin subset, ≈ 150 KB) | Combo counter, Rapid Fire, Kage, hi-score |
| Brush / ceremony | **Yuji Syuku** (ceremony subset ≈ 80 KB: つづく, 一本, 気合, rank kanji, belt names, 53 station names) | End card, rank kanji, Ippon flash |
| Formal / print | **Shippori Mincho B1** (lazy, full, only in Print Studio) | Wallpaper text, stories at N2+ (toggle) |
| Neon display | **Dela Gothic One** (lazy, Print Studio and Kage screen) | Neon signage, versus numbers |
| Furigana | body JP font at 0.5em via `<ruby>` | Modes: always / fog / tap / off |

Type scale (rem): 0.75 / 0.875 / 1 / 1.25 / 1.75 / 2.5 / 4 / 7.5 (ceremony kanji). Initial font payload ≤ 250 KB; everything else lazy with a progress ring.

### 4.3 Color tokens (CSS custom properties on `:root`)

Two themes. `Dojo Morning` (light) and `Arcade Night` (dark); auto-follows `prefers-color-scheme`, manual override persisted. Pigment names, same token in both themes.

| Token | Dojo Morning | Arcade Night | Use |
|---|---|---|---|
| `--bg` | `#F4EDE0` washi | `#0B0B10` sumi | page background (always explicit on `body`) |
| `--surface` | `#FFFBF3` | `#15151D` | cards, scroll bodies |
| `--raised` | `#EADFCB` | `#1F1F2A` | status windows, inputs |
| `--fg` | `#1A1A1F` | `#F4EDE0` | text (contrast ≥ 12:1 both) |
| `--fg-muted` | `#5E5A52` | `#A9A49A` | secondary text (≥ 4.6:1) |
| `--line` | `#D9CDB6` | `#2C2C3A` | borders, tatami seams |
| `--shu` | `#C9302C` | `#E63B2E` | vermilion: primary action, torii, hanko, reading category |
| `--kin` | `#B8860B` | `#E0B341` | gold: XP, dan stitching, kanji category |
| `--ai` | `#1F2A6B` | `#6C7BD9` | indigo: listening category, links |
| `--sakura` | `#C9718A` | `#F7B2C4` | kana category, soft success |
| `--matcha` | `#4E8A3C` | `#7BB661` | correct, grammar category |
| `--neon-c` | `#0E8F86` | `#2EE6D6` | vocab category, arcade UI |
| `--neon-m` | `#B8257A` | `#FF3DA6` | speaking category, arcade UI |
| `--kon` | `#1F3A93` | `#4F6FD6` | prussian: ukiyo-e water and sky |
| `--hai` | `#8A8578` | `#6E6A61` | ash: disabled, hints, locked |
| `--focus` | `#1F2A6B` | `#2EE6D6` | focus ring (3 px, offset 2 px) |
| `--kin-text` | `#7A5A05` | `#E0B341` | gold as TEXT (≥ 4.5:1 on bg / surface / raised in both themes): XP deltas, kiai chips, dan stripe labels — `--kin` itself is a fill colour |
| `--shu-text` | `#B0241F` | `#FF6A5E` | vermilion as TEXT (≥ 4.5:1): danger buttons, tag chips, current nav item |
| `--ink` | `#1A1A1F` | `#1A1A1F` | invariant sumi for text drawn on a vermilion or gold fill (hanko, hi-score) |

Category colors are always paired with an icon glyph (kana あ, vocab 語, kanji 字, grammar 型, listening 耳, speaking 口, reading 読, culture 道) so color is never the only signal.

Belt colors (same in both themes): white `#F4EDE0` · yellow `#F2D54A` · orange `#F08A24` · green `#3E9B4F` · blue `#2F6FD6` · purple `#7A3FB5` · brown `#6B3F23` · black `#0B0B10` with `--kin` stitching for dan stripes.

### 4.4 UI components (motif → spec)

| Component | Motif | Spec |
|---|---|---|
| **Status Window** | JRPG frame | 2 px double border, notched corners, DotGothic16 labels (Lv / 気 / XP), 92 % `--raised` |
| **Scroll Card** | Makimono | lesson/story card with rolled SVG end caps; unroll 240 ms |
| **Hanko Button** | Seal | primary CTA is a square vermilion seal; press = scale 0.96 for 60 ms + ink-bleed pulse |
| **Forge Bar** | HP bar | due reviews as a depleting bar labelled 百錬; chips off per correct answer; hidden in Backlog mode (count shown instead) |
| **Combo Counter** | Arcade | top-right, DotGothic16, scale 1.0→1.3 by tier; hidden in Zen |
| **Road Nav** | Tōkaidō map | horizontal scrolling road; cleared stations carry a vermilion goshuin; the next is a lantern; locked are grey milestones with their name visible. The page does not scroll to the current station on mount (the title and Projected Arrival stay in view); a "Go to your station" button centres and focuses it on demand |
| **Tategaki Column** | Vertical text | a Mastered sentence of the day on the Dojo's right edge |
| **Judge Card** | 目付 inspector | small verification card (4-option meaning check, rubric check or minimal-pair check, `05 §6`), slides in from the right |
| **CRT Toggle** | Cabinet | scanlines + 1 px chromatic offset on arcade screens only; off by default |

### 4.5 Motion

UI transitions 120–220 ms, `cubic-bezier(.2,.8,.2,1)`. Ceremonies 6–12 s, always skippable with any key or tap. `prefers-reduced-motion` disables particles, speed lines and shake; keeps opacity fades. Nothing flashes above 3 Hz.

> **Superseded (2026-10-18):** the motion system now lives in `09-design-language-and-motion.md` §6 (tokens, the seven ink verbs, route transitions, reduced motion, performance and flashing rules); 09 §2–§5 extend §4.1–§4.4 above. This paragraph is kept for history.
---

## 5. Sound and haptics (Web Audio, zero samples)

All sounds synthesized at runtime from one lazily created `AudioContext` unlocked on first gesture. Master volume default 60 %, mute remembered. `navigator.vibrate` where available (10 ms correct, 30 ms wrong, 10-30-10 badge).

| Event | Recipe | Length |
|---|---|---|
| Correct | square C5→E5 arpeggio, 8 ms attack, 60 ms decay | 90 ms |
| Correct in combo tier 2 / 3 | adds G5 / adds C6 + noise hi-hat | 120 ms |
| Wrong | triangle A2 through 600 Hz low-pass, soft "donk" — never a buzzer | 140 ms |
| Submit (any grade) | band-passed noise click at 2 kHz (anvil tap) | 40 ms |
| Ippon | 55 Hz sine drum + brush-swish noise sweep | 300 ms |
| Kiai state | gong: inharmonic sine stack, 2 s decay | 2 s |
| Item belt promotion | two koto plucks (Karplus-Strong delay line) | 600 ms |
| Scroll complete | 5-note square fanfare G4 C5 E5 G5 C6 + triangle bass | 900 ms |
| Badge | hanko thump: 80 Hz sine + paper-slap noise | 300 ms |
| Belt ceremony | taiko ×3 (55 Hz sine pitch-drop + brown noise) then shakuhachi-like sine with 5 Hz vibrato and breath noise | 12 s |
| Wallpaper unlock | wind chime: 4 pentatonic sine partials, long decay | 2.5 s |
| つづく end card | struck bowl (rin 鈴): four sine partials at a singing bowl's inharmonic ratios 1 : 2.76 : 5.40 : 8.93 over E4, the fundamental a detuned pair beating at 1.5 Hz, one band-passed mallet tap; the つづく stroke is written over its first 1.2 s (replaced the rising triangle gliss, 09 §12.1 d76) | 2.4 s |

---

## 6. Feel presets

One setting, three values. Scheduling and XP are identical in all three.

| Preset | Timers | Ki / combo | Screen glow, shake | Sound |
|---|---|---|---|---|
| **Zen 禅** | hidden | hidden | none | off (the voices still speak — Zen is not mute for voices) |
| **Dojo 道場** (default) | ring only on mature items | visible, no edge glow | none | soft set |
| **Arcade 筐体** | ring on mature items | visible with edge glow and rising pitch | yes (reduced-motion aware) | full set, CRT optional |

Adaptive nudge: if two sessions in a row end with error rate > 40 % in Arcade, the end card offers Dojo or Zen once. The app never switches presets silently.

---

## 7. Accessibility

- Full keyboard: 1–9 choices, Enter submit / continue, Space replay audio, `?` hint, Shift+Enter Guard ("don't know"), Esc pause.
- ARIA live region for feedback text; every Japanese string wrapped in `lang="ja"`.
- Text tokens meet WCAG AA (4.5:1) in both themes; category color always paired with a glyph.
- Scalable type (rem throughout); minimum 16 px body; 44 px touch targets; answer input in the bottom third on phones; 16 px side gutters, no horizontal scroll.
- Furigana modes: always / fog (see `05`) / tap / off. Pitch lines drawn as shape, not color only.
- Reduced motion, no flashing above 3 Hz, Zen preset removes all pressure elements.
- Speech features degrade: the voice pack (synthetic VOICEVOX clips, design 08) speaks when present and the device's `speechSynthesis` voice otherwise; with neither → kana shown at full size and a one-time install guide (a pack without a Japanese device voice shows no nag — `packWillSpeak`); no recognition → self-assessment path with identical XP.

---

## 8. Glossary of system names

| JP | Romaji | EN | Where |
|---|---|---|---|
| 百錬 | Hyakuren | the SRS engine | 05 |
| 型 / 組手 / 修行 | Kata / Kumite / Shugyō | 3 / 10 / 30 min sessions | 03 |
| 巻物 | Makimono | a lesson ("Scroll") | 03, 04 |
| 旅日記 | Tabi Nikki | the serialized graded reader | 04 |
| 関守 | Sekimori | station Gatekeeper boss | 02, 04 |
| 審査 | Shinsa | belt examination | 02, 04 |
| 遺恨帳 | Ikon-chō | Grudge List of boss misses | 04 |
| 影 | Kage | weekly ghost rival / mini-exam | 03 |
| 宿敵 | Shukuteki | Nemesis (leech) | 04, 05 |
| 気合 / 一本 | Kiai / Ippon | ki state / skill-based crit | 03, 05 |
| 目付 | Metsuke | the Judge honesty check | 05 |
| 弱点 | Jakuten | Weak Points (error-tag targeting) | 05 |
| 耳目帳 | Jimoku-chō | Input Ledger (ears and eyes) | 05 |
| 他流試合 | Taryū-jiai | Field Missions (real-world) | 04, 05 |
| 壁の章 | Kabe no Shō | the Plateau Arc (Stations 25–46) | 02, 05 |
| ぺらぺら指数 | Perapera Index | 5-axis fluency radar | 05 |
| 道草 | Michikusa | roadside culture fragments | 06 |
| 御朱印帳 | Goshuin-chō | station stamp book | 06 |
| 掛け軸 | Kakejiku | wallpapers | 06 |
| 紋 | Mon | badge crests | 06 |
| 言霊 | Kotodama | spirit flames of Black items on the Dojo | 06 |
| 道場破り | Dōjō Yaburi | Dan-rank gauntlets (endgame) | 02 |
| 七転八起 | Nanakorobi Yaoki | streak repair | 03 |
