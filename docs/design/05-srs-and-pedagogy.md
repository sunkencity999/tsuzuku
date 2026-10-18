# TSUZUKU — 05 · Hyakuren (百錬): SRS Policy and Pedagogy

## 1. FSRS-5 parameters and scheduling policy

Implemented in-house in `src/learn/fsrs.ts` (pure TS, ~250 lines, no runtime dependency); golden tests pin it to `src/learn/fsrs-golden.ts`, a frozen table of 60 seeded review sequences generated once by the engine itself (`mulberry32(0x5eed)`; `ts-fsrs` is not installed) and regenerated only when a formula deliberately changes (last: the FSRS-5 difficulty damping, review round 1).

| Setting | Value |
|---|---|
| Algorithm | FSRS-5, 19 weights, defaults: `[0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621]` (verify against the reference before release) |
| Desired retention | 0.90 Standard (0.85 Casual; 0.85 / 0.90 / 0.95 selectable) |
| Max interval | 365 d |
| Fuzz | ±5 % of interval; **load balancing**: pick the day in the fuzz window with the fewest cards already due |
| Day boundary | 04:00 local; `due` and `last` stored as epoch-day integers |
| In-session steps | new cards re-presented at +3 and +10 reps; a miss on a learning card returns at +3 |
| Relearning | lapsed card returns within the session (+5 reps) then FSRS |
| Optimizer | Phase 3: per-learner weight fitting in a Web Worker over the review log (≥ 2,000 reviews), opt-in |

Core formulas (DECAY = −0.5, FACTOR = 19/81):

```
R(t, S)        = (1 + FACTOR · t / S) ^ DECAY                       // retrievability after t days
I(r, S)        = (S / FACTOR) · (r ^ (1/DECAY) − 1)                 // next interval for desired retention r
S0(g)          = w[g−1]                                              // initial stability by rating g ∈ 1..4
D0(g)          = w4 − e^(w5·(g−1)) + 1,  clamped 1..10
ΔD             = −w6 · (g − 3)
D″             = D + ΔD · (10 − D) / 9                                 // FSRS-5 linear damping: a hard card moves less
D'             = w7·D0(4) + (1 − w7)·D″,  clamped 1..10                 // mean-reverting difficulty update
S'_success     = S · (e^w8 · (11 − D) · S^(−w9) · (e^(w10·(1−R)) − 1) · [g=2 ? w15 : 1] · [g=4 ? w16 : 1] + 1)
S'_lapse       = min(S, w11 · D^(−w12) · ((S+1)^w13 − 1) · e^(w14·(1−R)))
S'_same_day    = S · e^(w17 · (g − 3 + w18))                         // short-term step
```

---

## 2. Facets: separate schedules for receptive and productive knowledge

Each item spawns one FSRS card per **facet**, created in a staggered way so a new word never spawns four cards at once. Later facets are **warm-started** from the parent facet (S₀ = k × S_parent, D₀ = D_parent) so they do not begin from zero; this cuts their lifetime reviews by roughly 40 %.

| Item | Facet | Created when | Warm start | Exercises | Retires |
|---|---|---|---|---|---|
| Kana | `rec` | intro | — | kana-flash | archived at S > 180 d |
| Kana | `prod` | intro | — | kana-ear (first 2), kana-forge | archived at S > 180 d |
| Component | `rec` | intro (Station 2+, one station ahead of its first kanji; `StationBundle.componentIds`) | — | component-flash | archived at S > 90 d |
| Vocab | `rec` | intro | — | meaning-guard (first 2) → meaning-recall / meaning-judge | never (Kaiden lane) |
| Vocab | `listen` | `rec` S ≥ 2 d | 0.5 × S_rec | audio-flash; fed by sentence-listen | never |
| Vocab | `prod` | `rec` S ≥ 4 d | 0.3 × S_rec | production-forge; fed by shadow | never |
| Vocab | `pitch` | `prod` S ≥ 7 d; ~1,000 high-frequency N5–N4 words with `pitchConfidence: high` only (set by the licensed-dataset post-pass, never by a writer) | 0.5 × S_prod | pitch-ear | S > 90 d |
| Kanji | `comp` | intro (all components Green) | — | component-assembly | never |
| Kanji | `read` | `comp` S ≥ 1 d | 0.5 × S_comp | kanji-read, lookalike-duel | never |
| Grammar | `cloze` | lesson | — | pattern-cloze, particle-duel, scramble, judgment-call | never |
| Grammar | `prod` | `cloze` S ≥ 7 d | 0.4 × S_cloze | transform, form-forge, form-chain, say-three-ways | never |
| Chunk (set phrase) | `prod` | intro | — | shadow, role-play | never |

Sentences, stories and dialogues are **not** scheduled; they feed the cards above. Pitch is graded (a card) only on words where the data is reliable; the pitch line is drawn whenever `pitch` is present (most N3+ cards have none).

**Definitions.** *Known* (for coverage math) = base-facet retrievability ≥ 0.85 now (`rec`; `comp` for kanji, `cloze` for grammar; `02 §4`). *Green/Mastered/Black* item belts are in `02 §4`. *Mature* = the tested facet S ≥ 14 d (`learn/grading.ts isMature`). *Kaiden lane* (皆伝): cards with every facet S ≥ 120 d are served from a separate lane capped at **max(10, 15 % of today's review cap)** — a share, not an absolute, so the lane never builds a permanent backlog as thousands of cards mature — and **implicit evidence counts**: a Kaiden word read in a story with no gloss tap and ≥ 2/3 comprehension logs Good on its `rec` card, and a Rapid Fire correct on a Kaiden card logs Good. `scheduler.test.ts` simulates steady state and asserts Kaiden overdue never exceeds 7 days.

**Load model (V1 content, Standard).** Cards at completion: vocab 6,350 × 3 + pitch 1,000 + kanji 1,000 × 2 + grammar 450 × 2 + kana 476 + components 250 ≈ **23,700 cards**. Lifetime reviews per vocab item in year one ≈ 7 (`rec`) + 3.5 (`listen`, warm) + 4.5 (`prod`, warm) = 15. At the N5 rate (7 vocab + 1 kanji + 0.75 grammar per day) steady-state reviews ≈ 7×15 + 1×12 + 0.75×14 ≈ **130/day ≈ 13 min**; at the Brown rate ≈ 290/day, which is why Brown's expected session is 40 min and the Intense preset warns.

---

## 3. Item introduction policy

- Daily new-item targets by belt are in `02 §6.1`; the mix is vocab : kanji : grammar, grammar in syllabus order. **Components** are introduced inside kana/kanji Scrolls one station ahead of their first kanji (`StationBundle.componentIds`; the N5 set across Stations 2–3), and a kanji unlocks when every component is **Green or was introduced ≥ 7 days ago** — so the Green gate protects the comp → read warm start but a lapsed component never stalls a station. Because components lead by a station, the 7-day lag is normally absorbed; where it is not, the Scroll says so ("部品 first — this kanji unlocks in 3 days").
- **Chikaradameshi** pretest: 3 of a Scroll's items are tested before teaching; misses are expected and graded as the first exposure (no FSRS penalty).
- **Cramming cap:** introduction stops at 2 × target; **adaptive rate:** halves when acc7 < desiredRetention − 0.07 over ≥ 50 reviews or backlog > 1.2 × cap, restored with hysteresis (`03 §5`); **Backlog mode:** pauses new items when due > 2 × the belt-scaled cap (`03 §4–5`).
- **Captured words** (from stories, Field Missions) enter the queue ahead of the station list, up to 40 % of the daily vocab budget from Green.
- **"既知 I already know this"** on a new card sets S₀ = w[3] (Easy) and skips the in-session steps; it is the only path to an Easy rating outside classic mode. Onboarding runs the **full 46-kana Kana Flash** (≈ 2 min) and marks 既知 only the kana answered correctly; the rest are introduced at Station 1 normally.
- **"退 Retire"** on any item archives all its cards (flag, reversible, no XP change) — learner autonomy over the corpus, listed in 道場の掟.

---

## 4. Grading map: exercise result → FSRS rating

| Result | Rating |
|---|---|
| Wrong, timed out in a boss Flash/Strike phase (score miss) | **Hard** (timeout) / **Again** (wrong) |
| Guard ("don't know") on a card with ≥ 3 reviews | **Again**, flagged honest |
| Guard on a card with < 3 reviews (or in its first 2 MC exposures) | learning-step miss: the card returns at +3, no lapse, flagged honest |
| Near-miss (Block) | **Hard** |
| Correct with hint, second dictation replay | **Hard** (ceiling) |
| Correct, mature card (tested facet S ≥ 14 d), latency > **3 ×** personal median (n ≥ 50) — only when the speed ring is shown (Dojo/Arcade with `settings.speedGrading` on; default off in Zen) and only for exercises with keys `choices` / `kana`, never free English typing | **Hard** |
| Correct | **Good** |
| Easy | never auto-assigned; only "既知" on new cards, or classic four-button mode (opt-in) |
| Self-graded (meaning-judge, shadow fallback, kanji-write, Final Form) | learner's Again/Hard/Good, sampled by the Judge |
| Rapid Fire, Gojūon Fighter | correct → nothing (Good on a Kaiden-lane card); miss → `recheck` flag, re-tested untimed next session, **Again only if that fails** |
| Story gloss tap on an introduced word **due today**, not on the episode's first read | Hard on `rec` |
| Dictation / shadow success on content words due within 3 d | Good on `listen` / `prod` |

"Speed affects grading" is a Settings toggle explained in "How this game works"; off, latency never touches a rating.

Classic mode exposes the four FSRS buttons for learners who want them; Honesty % applies.

---

## 5. Kiai (気合): ki, combo, Ippon — rules that protect learning

**Ki** 0–100, no time decay.

| Event | Ki |
|---|---|
| Correct | +8 |
| Correct, mature card (S ≥ 14 d), faster than 0.8 × median | +12 |
| **Ippon 一本**: correct, mature, fast, and D ≥ 7 or lapsed within 30 d | +20 (+3 XP, brush flash, drum) |
| Wrong | −10 |
| Guard | −4 |
| Hint | −6 |

At 100: **Kiai state** for 10 reps (XP × 1.5, rising pitch, edge glow in Arcade only), then ki resets to 30. Kiai never alters FSRS grading. Ippon criteria are public; there is no RNG.

**Combo** = consecutive correct answers in a session. Milestones 10 (十連) / 25 / 50 / 100.

- **Training dummy:** a miss on a card with < 3 reviews does not break the combo. New moves are supposed to whiff.
- **Guard:** on a training-dummy card (< 3 reviews) or in a card's first 2 multiple-choice exposures, Guard costs **ki 0 and leaves the combo unchanged** — so Guard is never worse than guessing; on a mature card it halves the combo instead of resetting it (ki −4). Honest unknowns are better SRS data than guesses, and the rules make that true.
- **Block:** a near-miss holds the combo ("Blocked").
- **Recovery:** a clean miss on a mature card resets the combo; the card returns 3–8 reps later; get it right and half the combo is restored (+2 XP).
- Speed never affects the combo; only correctness and honesty do.

---

## 6. Metsuke (目付): the Judge honesty mechanic

Applies only to self-graded results (meaning-judge, shadow fallback, kanji-write, Final Form, classic mode). On a deterministic sample of self-rated Good answers (`hash(seed, cardKey, reps) % 100 < rate`) a **Judge Card** appears. The sampling rate adapts to Honesty %: **25 % at ≥ 95 %, 50 % at 90–95 %, 100 % below 90 %** (and 100 % for the first 20 checks). Three Judge shapes: the **meaning Judge** (meaning-judge, kanji-write, classic) is **4-option** — the correct meaning, one `confusables` entry and two same-POS distractors — so a guess passes 25 %, not 50 %; the **rubric Judge** (Final Form, writing) asks "Does your sentence contain X? Show it" and verifies by regex; the **perception Judge** (shadow fallback) is a minimal-pair check on the key word. Failing forces Again on that card. The profile shows **正直度 Honesty %** = Judge passes / Judge checks over the last 200; ≥ 95 % earns the 正直者 badge. Typed `meaning-recall` stays the default receptive exercise at every level; J-J self-grading is the opt-in (`04 §2`). Copy frames it as calibration, never distrust: "The inspector checks everyone. 94 % — well calibrated."

---

## 7. Error tags and Weak Points (弱点)

Tags: `particle · conjugation · vowel-length · voicing · small-kana · kanji-reading · kanji-meaning · word-choice · register · word-order · pitch · transcription · aizuchi · listening`.

Each tag holds an EWMA error rate (α = 0.2, updated per tagged attempt; untagged correct attempts on exercises that *could* raise the tag count as 0). A tag above **20 %** with **n ≥ 15** tagged-eligible attempts (`WeakPoints[tag].n`; three early misses from zero never fire a set) spawns a **3-minute Weak Point set** (items carrying that tag, plus the matching perception drill: minimal-pair for vowel-length/voicing, particle-duel for particle, form-forge for conjugation, say-three-ways for register, aizuchi-dense role-play for aizuchi) in the next Shugyō until it falls below **8 %**. The Records page shows a Weak Point heat map. Bringing any tag from > 20 % to < 5 % earns 弱点克服.

---

## 8. Retirement of mature trivia

Kana cards archive at S > 180 d; component and pitch cards at S > 90 d; cards with all facets S ≥ 120 d move to the Kaiden lane (max(10, 15 % of the review cap) per day, implicit evidence counts — §2). Archived cards resurface only through Rapid Fire and Kage sets. Nothing is deleted from the save; archive is a flag (so is 退 Retire).

---

## 9. Jimoku-chō (耳目帳): the Input Ledger and external hours

The app supplies **≈ 450 structured hours** over the road at Standard (≈ 300 Casual, ≈ 650 Intense; computed from the preset, `02 §6.1`); fluency needs ≈ 1,500 hours of real listening and reading plus hundreds of conversations, most of them outside the app. The ledger makes those hours visible and counted; its 1,500-hour goal runs past Kyoto into the Dan road (`02 §3`).

- **Entries:** `{day, minutes, kind: listen | read | watch | speak, source: app | external, note?}`. In-app minutes are logged automatically by `startLedger`: `story:read` → a `read` row and `listening:set` (Arena, Ear Walk) → a `listen` row, both whole minutes, one row per event; `listen:played` (茶屋ラジオ Radio and Read-along, design 08 §10.2–§10.3) → `listen` minutes from the seconds actually played, to a tenth of a minute, **coalesced into one app row per day** (a Radio sitting writes a handful of rows, not one per track; `backup.mergeLedger` keeps the larger side per day and kind for app rows). Read-along is hearing with the text open: a `listen` row, 0 XP, never `story:read`. External minutes by the end-card prompt (one tap: 10/20/30/60) or Settings.
- **Goal:** 1,500 lifetime hours shown as a road-side milestone marker; weekly target rises by belt (White 0.5 h → Yellow–Orange 1 h → Green 3 h → Blue–Purple 5 h → Brown 7 h → Black 8 h → Dan 8 h), ≈ 400 h by arrival at 100 % adherence (≈ 550 h at 70 %, since the road takes longer). The weekly target is shown on the Station page whenever the station's texts are all read (`02 §6.3`). The weekly target counts **outside** hours only; the dojo's own heard minutes appear as the informational line "In the dojo this week: {h} h heard" on the Ledger and Station pages (`appListeningHours` / `weekAppMinutes`), never in the target.
- **Field Missions** (`04 §9`) escalate to real conversation; the "two things you couldn't say" become captured items or Weak Points.
- **XP:** 1 XP per external minute, cap 60/day; ledger entry +5 (cap 20/day). Honest framing: self-reported, not verified, shown with "(reported)" on Records.
- **Badges:** 耳百時間 (100 h listening), 千時間 (1,000 h), 現場主義 (10 missions), 初対話 (first conversation mission).

---

## 10. Kabe no Shō (壁の章): the Plateau Arc, Stations 25–46

| Plateau cause | Mandatory countermeasure |
|---|---|
| Input stays learner-graded | **Native Bridge** (橋渡し) passages from **Station 27**: `bridge: true`, authentic-style register (news, forum, drama-like dialogue with contractions, fillers, dropped particles), coverage target **93 %** for any `bridge` passage (`COVERAGE_TARGETS.bridge`, V20); ordinary passages stay at 97 % through Station 28, then 95 % (29–38) and 93 % (39+); casual narration from Station 25; listening tier pushed to 1.1–1.25× |
| Breadth stalls at 3–4k words | **Breadth Campaign**: 12–14 new words/day; J-J definitions default from Station 34 (EN behind a tap); captured words up to 40 % of budget |
| Output fossilizes in safe N4 patterns | **Say It Three Ways** (27+), **Monologue Marathon** (29+), **Reduce & Expand** 60/45/30 s (37+), Writing Dojo weekly |
| Avoidance of real conversation | **Field Missions** escalate: 20 min with JP subtitles → 3-line forum comment → 15-minute conversation with two logged gaps |

"Mandatory" here means offered every week and narrated as the medicine; **nothing in the arc gates progression**. Entering at Nissaka unlocks the **VS Screen** wallpaper (you vs 壁); clearing Kameyama unlocks **Beyond the Wall**. The arc is narrated as the training-arc wall; the countermeasures are the medicine.

---

## 11. Perapera Index (ぺらぺら指数): the fluency radar

Five axes, 0–100 each, computed on app open (no nightly job on a static site). XP is effort, belts are milestones, Perapera is fluency.

| Axis | Formula |
|---|---|
| 語彙 Vocab | `0.6 · Σ R(rec) / 10,000 + 0.4 · Σ R(prod) / 6,000`, × 100, capped |
| 耳 Ear (synthetic) | design 08 §12 (`store/perapera.ts`): `tier = min(speedTier, max(1, bestCleanTier))` — the tier the learner has **shown** with a clean set, not only the dial · `base = 20 · tier · clamp(dictationAcc / 0.9, 0.5, 1)` · `comp = coldSets ≥ 10 ? clamp(coldPassRate / 0.8, 0.5, 1) : 1` (understood on first hearing, either surface) · `authentic = outside listen + watch hours + listeningAuthenticMinutes / 60` · **cap = 70 below 7.5 h, 85 below 15 h, 100 from 15 h of authentic-style listening** (`EAR_CAP_STEP_HOURS = [7.5, 15]`; heard in the dojo — bridge, casual talk, news, lectures at full speed, understood — or outside) · `ear = min(cap, base · comp)`; the dojo alone can carry a learner to about 18 h (`REACHABLE_IN_APP_HOURS`, corpus-walked). Labelled "(synthetic)" in Perapera and Records copy: every in-app voice is a VOICEVOX character voice; the ledger's outside hours are real people |
| 読 Reading | `median cpm of last 10 episodes with ≥ 2/3 / 500 · 100`, capped |
| 口 Mouth | recognition: `50 · shadowPassRate50 + 50 · min(1, monologueWpm / 100)`; fallback: `70 · selfPassRate50 + 30 · min(1, monologues / 30)` shown with "(estimated)" |
| 場 Register | `50 · rolePlayBestRate20 + 50 · threeWaysAcc30`; "—" before Station 21 |

Composite = mean of available axes; history stored monthly for the radar-over-time view.

---

## 12. Method notes (kept short; the exercises carry the detail)

- **Kanji:** ~250 components are items with canonical keywords (`content/_meta/components.json`, authored before any kanji packet goes out); a kanji unlocks when its components are Green or introduced ≥ 7 days ago (§3); taught by components → mnemonic (must use the canonical keywords) → primary reading → 2–3 words; secondary readings only through words; handwriting optional and never gating.
- **Grammar:** pattern card ≤ 120 words, 3+ examples (V1 scope), one contrast, rotating cloze sentences; conjugation via the engine and its golden table (60 head words: 40 verbs × 20 forms, 20 adjectives × 6 forms; ≈ 903 rows per `content-plan.json`).
- **Vocab production:** prod prompts rotate per rep between the item's examples (≥ 2 by release) and story lines containing the word (`StoryLine.tokenIds`), so Production Forge stays meaning-driven rather than one memorized frame.
- **Pitch:** drawn whenever `pitch` is present; graded only on dataset-confirmed words; Pitch Ear plays only clips whose accent was verified against `pitch` (`pitchVerified`), and the app never claims a synthetic voice proves the pattern — the strip is the dictionary pattern.
- **Chunks:** collocations (1–3 per word) shown after answering; set phrases are `chunk` items with a `prod` facet; aizuchi are chunks.
- **Furigana fog:** furigana visible while a kanji's `read` S < 7 d, then hidden with tap-to-reveal (a hint).
- **Noticing:** after a Scroll, the station's episode excerpt is re-shown with the new items highlighted.

---

## 13. What we deliberately cut and why

| Cut | Reason |
|---|---|
| Hearts / lives / Retreat in bosses | errors are the learning event; punishing them teaches avoidance |
| Omikuji daily fortune with XP modifiers | a slot-machine costume with zero learning value; replaced by a deterministic proverb Michikusa |
| Speed pressure on new/learning items | invites guessing and anxiety; speed is for mature items and Rapid Fire only |
| Auto-Easy from fast answers | inflates intervals; Easy only via "既知" or classic mode |
| Single FSRS schedule per item | receptive and productive knowledge are dissociable |
| Leaderboards, social comparison | no backend; comparison undermines intrinsic motivation |
| Loot boxes, random rewards, timed events, currency, shop | gambling psychology and FOMO |
| Picture-matching beyond concrete N5 nouns | doesn't scale to abstract vocabulary |
| English-first reveal past Purple | interferes with direct form-meaning mapping; the J-J `definitionJa` becomes the default reveal (EN behind a tap); typed EN recall stays available |
| Mandatory handwriting | most learners type; components + reading-in-context carry kanji |
| Grammar lectures > 120 words | patterns + examples + one contrast beat prose |
| Romaji anywhere except as input | slows kana automaticity |
| Self-rating as sole grading | learners overrate; the Judge calibrates |
| Heavy cutscenes | story is the reader, not a cutscene; vignettes ≤ 80 words |
| Boss Pressure Rounds | pure speed pressure on mixed-maturity items |

---

## 14. Mechanic-to-learning audit

| Mechanic | Learning principle | Risk | Mitigation |
|---|---|---|---|
| Per-facet FSRS cards, warm-started | receptive/productive dissociation; spacing | card inflation | staggered unlock, warm start, Kaiden lane, retirement |
| Ki, combo, Ippon | sustained attention, honest self-report, automaticity on mature items | anxiety, guessing | speed only on S ≥ 14 d, training dummy, Guard, Block, Zen |
| Item belts | visible consolidation; generation effect | farming easy items | scheduler owns item choice; Brown requires production |
| Gatekeepers | cumulative interleaved testing, output under mild pressure | gatekeeping frustration | no lives, same-day rematch, Grudge List, Assisted Gate, Revenge Match |
| Shinsa | mastery gate, transfer across skills | multi-week limbo | eligibility shown as a progress bar; Sensei's Notes; no clock |
| Kage weekly set | testing effect on recent material; fluency on known | discouragement | self-referential; factory hi-score table |
| Tabi Nikki + capture | comprehensible input; learner-driven acquisition | too hard / stilted prose | live coverage gating, tap gloss, modern-road setting, style guide |
| Judge | calibration of self-rating | reads as distrust | adaptive 25–100 % sampling, 4-option card, Sensei voice, Honesty % framed as a skill |
| Weak Points | targeted remediation within 48 h | drill fatigue | 3-minute cap, perception drill paired |
| Rapid Fire / Gojūon Fighter | automaticity, isolated from accuracy | guessing; speed slips collapsing stability | mature items only; misses only flag `recheck`; XP one run/day; excluded from review stats |
| Aizuchi slots, register switching | conversational pragmatics | shallow marker regex | debrief with recasts; Perapera 場 uses rates, not single checks |
| Input Ledger, Field Missions | input volume; real conversation | unverified self-report | labelled "(reported)", capped XP, badges tied to counts not quality |
| Load governor, cramming cap | spacing survives real life | hidden backlog | honest count, FSRS handles overdue |
| Streak suite | habit formation | shame churn | freezes, rest, Ember, repair, total-days identity, Welcome Back |
| Wallpapers, stamps, Kotodama flames | identity, long-horizon goals | hollow reward | personalized with real competence data; conditions visible |
| 次回予告 | curiosity, continuity | FOMO | informational only, no countdowns |
