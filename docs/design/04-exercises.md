# TSUZUKU — 04 · Exercises: Interaction Specs

Every exercise emits `{cardKey | null, correct, nearMiss, hintUsed, guard, ms, errorTags[]}` and the Hyakuren engine maps it to an FSRS rating (`05 §4`). Facet ids: `rec · listen · prod · pitch · read · comp · cloze`. Card key = `${itemId}#${facet}`.

## 0. Shared controls

- **Keys:** 1–9 choices · Enter submit / continue · Space replay · `?` hint (ceiling Hard, ki −6) · Shift+Enter = Guard "don't know" (honest; on a card with < 3 reviews or in its first 2 multiple-choice exposures: ki 0, combo unchanged, graded as a learning-step miss; on a mature card: ki −4, combo halves, Again — `05 §5`) · Esc pause. Input sits in the bottom third on phones.
- **Kana Forge IME** (`src/shared/kana-ime.ts`, `wanakana.toKana` with `IMEMode: true` plus a post-pass): live romaji→kana; Hepburn and Kunrei accepted; `nn`/`n'` → ん, `n` + consonant → ん, doubled consonant → っ, `x/l` prefix → small kana, `-` → ー; unresolved trailing romaji stays visible; a toggle (or Caps Lock) switches katakana; katakana-tagged answers auto-convert.
- **Normalization:** NFKC; strip whitespace/punctuation; fold widths; fold katakana→hiragana when allowed; accept おう/おー variants, the kanji surface, `altForms`, or the kana reading.
- **Near-miss ("Block"):** Levenshtein ≤ 1 on ≥ 5 chars, small-kana slip (っ/つ, ゃ/や), long-vowel slip → shown in yellow "almost," correction displayed, rating **Hard**, combo holds, error tag (`small-kana`, `vowel-length`, `transcription`).
- **Timers:** only on **mature** cards (the tested facet S ≥ 14 d), only in Dojo/Arcade presets, and never fail a rep outside boss Flash/Strike phases. "Slow" = > **3 ×** personal median for that exercise type (rolling last 200, **n ≥ 50**) → Hard, and only when the speed ring is shown (Dojo/Arcade, `settings.speedGrading` on — default off in Zen) and only for exercises with keys `choices` or `kana`, never for free English typing (`05 §4`).
- **Feedback:** correct form, character diff, error tag, one line of *why* or a confusable contrast; 「もう一度」 re-queues the item 3–8 reps later (Recovery).
- **First exposure rule:** multiple choice only for a card's first 2 exposures and for perception tasks (listening, pitch); typing after that.

---

## 1. Kana (Stations 1–3)

| Id | Name | Prompt → response | Pass | Facet | Notes |
|---|---|---|---|---|---|
| `kana-flash` | 仮名閃 Kana Flash | one kana/digraph (spoken once — the pack clip `k-…` or the device voice) → type romaji; auto-submits on match | exact (variants accepted) | `kana:rec` | first 2 exposures: 4 choices. Timer 1.5 s target (mature only) |
| `kana-ear` | 仮名の耳 Kana Ear | a spoken mora → tap the kana in a 3×3 grid of confusables (ね/れ/わ, シ/ツ, ソ/ン); the grid never seats a homophone of the target (same romaji, ぢ≡じ, づ≡ず, を≡お, ヲ≡オ) since the prompt is audio-only and the grid grades by index | exact | `kana:prod` (first 2 exposures) | keys 1–9 |
| `kana-forge` | 仮名鍛造 Kana Forge | a spoken kana or romaji → type the kana via IME; を / ヲ show their IME romaji (`wo`) up front at no hint cost because the voice pronounces them like お / オ | exact kana | `kana:prod` | katakana mode auto for katakana items |
| `gojuon-fighter` | 五十音ファイター | arcade: kana glides in from the right; type romaji before it lands (3.5 s → 1.5 s over the round; the corpus display romaji — `o` for を — is a hit, as in Kana Flash); 46 per round; the rival's lantern dims per miss (no health bars) | per-kana | fluency mode: a miss sets the card's **`recheck`** flag and the card is re-tested **untimed** in the next session (Again only if that fails — speed slips never collapse stability); pool = kana with S ≥ 14 d (younger kana are shown ungraded) | reaction time per kana logged → `kana-grid` wallpaper heatmap; arcade reps are excluded from `stats.reviews` and `stats.bestCombo`. Unlocks Station 2; stays available |

Kana cards retire (archived) at S > 180 d; everything else exercises them.

---

## 2. Vocabulary

| Id | Name | Prompt → response | Grading | Facet | Unlock / retire |
|---|---|---|---|---|---|
| `meaning-guard` | 意味ガード Meaning Guard | word (+ furigana per fog rule) + audio → 4 choices (distractors: same POS/station, one confusable) | exact → Good; wrong → Again | `rec` | first 2 exposures only |
| `meaning-recall` | 意味想起 Meaning Recall | word + audio → type English | fuzzy: any `meanings`/`accept`, Levenshtein ≤ 1 (≥ 5 chars) or ≤ 2 (≥ 9), articles and "to" stripped; **"I meant that" override** logs and triggers a Judge check next time | `rec` | Station 4+; **stays the default** receptive exercise at every level |
| `meaning-judge` | 目付 Meaning Judge | word → recall silently → Reveal shows the **J-J definition** (`definitionJa`; English behind a tap) → self-rate Again/Hard/Good. **Judge mechanic** (`05 §6`): a deterministic sample of Good ratings — 25 % at Honesty ≥ 95 %, 50 % at 90–95 %, 100 % below 90 % — gets a **4-option** verification (correct meaning + one `confusables` entry + two same-POS distractors); failing forces Again and updates Honesty % | self + Judge | `rec` | **opt-in** from Station 34 (Purple) in Settings ("J-J self-grading"); the reveal of every vocab card defaults to J-J from Station 34 regardless |
| `audio-flash` | 耳閃 Audio Flash | the spoken word (clip `item.id`; from Green inside its collocation, `${item.id}#col<k>`) → 4 choices incl. one minimal-pair distractor, or typed meaning after 2 exposures | exact / fuzzy | `listen` | `listen` card created when `rec` S ≥ 2 d |
| `production-forge` | 産出鍛造 Production Forge | English gloss + a context sentence with a blank (constrains word choice) → type Japanese via IME; **Space cycles the kanji candidates** (`params.candidates`: target + known homophones) once the typed kana reads as the word — before that Space is a plain character — Enter submits | any listed form; kana-only accepted (Good) through Orange; from Green, kana-only → Hard when the word's kanji `read` cards are ≥ 7 d; particle slips tagged `particle` and do not fail the card | `prod` | `prod` card created when `rec` S ≥ 4 d; warm-started (`05 §2`) |
| `pitch-ear` | 高低の耳 Pitch Ear | the spoken word (only a pack cue with `pitchVerified: true`; when either half of a pair lacks one, both halves go through the device voice — never one clip against one device word) → choose 平板/頭高/中高/尾高 drawn as contour glyphs; minimal-pair rounds "雨 or 飴?" — the contrast shown after the answer is a loaded homophone with a different pitch: the planner fills `params.distractorIds` from `session/params.pitchHomophones` (`pairId` → homophone `confusables` → kana-equal lookup over the loaded vocab with `pitchConfidence: high`) and the drill (`pitchPairPool`) reads them first, then the item's own `confusables`; the field stays unset when the word has no homophone | exact | `pitch` | Station 7+; `pitch` card for the N5–N4 words carrying `pitchConfidence: high` (set by the pitch post-pass — eleven per-file passes against standard Tokyo accent, audited by the vocab lens; 1,266 words, `CONTENT_GUIDE §20`), created when `prod` S ≥ 7 d; retires at S > 90 d |

Every vocab card shows the pitch line over the kana (whenever `pitch` is present) and 1–3 collocations after answering. From Station 34 the revealed gloss defaults to J-J (`definitionJa`, EN behind a tap). Every card also carries a **退 Retire** action (archive flag, reversible, no XP change): the learner may drop a word without waiting for 8 lapses and the Nemesis chain.

---

## 3. Kanji and components

| Id | Name | Prompt → response | Grading | Facet | Unlock |
|---|---|---|---|---|---|
| `component-flash` | 部品 Component | component glyph → type its keyword (first 2 exposures: 4 choices) | fuzzy | `component:rec` | Station 2+: components are items in `StationBundle.componentIds`, placed one station ahead of the first kanji that uses them (the N5 set across Stations 2–3), and are introduced inside kana/kanji Scrolls; archived at S > 90 d |
| `component-assembly` | 部品組み Component Assembly | kanji meaning + primary reading + layout frame (`params.layout`: left-right / top-bottom / enclosure) → pick 2–4 component tiles from 8 and drop them into the slots; mnemonic shown on completion | exact set → Good; hint → Hard | `kanji:comp` | kanji unlocks when every component is Green **or** was introduced ≥ 7 days ago (`05 §3`) |
| `kanji-read` | 文中読み Kanji Read | a sentence containing the kanji inside one of its example words, the word highlighted, no furigana → type the reading of the word. The example's vocab item is matched by surface AND reading (a homograph read differently never lends its sentence); the blank is the first occurrence whose ruby aligns with the word and reads as the example does, never inside a longer compound; with no such sentence the bare word is the prompt. The drill re-checks the planner's blank (`ruby-split.spanReading` / `alignedRange`): a blank that cuts a compound or reads differently from the answer is re-located to an aligned occurrence of the same word when the sentence has one, else kept | exact reading; `kanji-reading` tag on miss | `kanji:read` | created when `comp` S ≥ 1 d; rotates through `exampleVocab` so on/kun are learned in words |
| `lookalike-duel` | 似字対決 Lookalike Duel | sentence with a blank + 2–4 look-alike kanji (未/末, 微/徴) → tap the one that fits | exact | `kanji:read` (variant, S ≥ 7 d) | from Green |
| `kanji-write` | 書き取り Kanji Recall Write | meaning + reading → freehand on canvas → 20 %-opacity overlay → self-grade with Judge sampling | self | optional `kanji:write` card, never gates anything | opt-in in settings; stroke-order data is a later add-on |

---

## 4. Grammar

| Id | Name | Prompt → response | Grading | Facet | Unlock / retire |
|---|---|---|---|---|---|
| `pattern-cloze` | 文型穴埋め Pattern Cloze | sentence with one blank, English gloss below; the whole sentence is spoken first (clip `${itemId}#ex${k}` when the pack has it) → type the missing piece (first exposure: 4 tiles with the point's distractors) | exact or kana-equivalent; `clozeHints` drive the blank; rotating sentences so the surface cannot be memorized | `grammar:cloze` | at lesson; typed from the second exposure |
| `particle-duel` | 助詞対決 Particle Duel | sentence with 1–3 particle slots → pick from は/が/を/に/で/と/へ/から/まで/より/の (keys) | exact per slot; partial → Hard; tag `particle` | `grammar:cloze` (particle points) | Station 5+ |
| `form-forge` | 活用鍛造 Form Forge | dictionary form (+ reading) + target form label (て / ない / た / potential / passive / causative / causative-passive / volitional / imperative / ば / たら / たい / adjective forms) → type; the head word is drawn from the items that realise a declared form (adjectives for adj-* points, verbs for verb points) and never from a word that lacks the form (ある for たい) | engine answer (`src/learn/conjugate.ts`, POS × ConjForm, irregulars 行く/来る/する/いい/ある handled); tag `conjugation` | `grammar:prod` of the form's grammar point | forms become drillable when a grammar point declares `unlocksForms` (Station 10 onward) |
| `form-chain` | 活用連鎖 Form Chain | one verb, always 5 target forms in sequence: the point's own `unlocksForms` first, then forms unlocked by grammar points already met, then the verb's other applicable forms (rotating), each link graded against the engine's accepted surfaces (ら抜き potential, short causative, よ imperative) | 5/5 Good, 4/5 Hard, ≤ 3 Again | `grammar:prod` (same points) | Station 12+; appears in Three Kata |
| `transform` | 変換 Transform | a full sentence + instruction ("make it casual past", "make it sonkeigo") → type | `accept[]` list; tags `conjugation` / `register` / `word-order` | `grammar:prod` | `prod` card created when `cloze` S ≥ 7 d |
| `scramble` | 並べ替え Scramble | English + shuffled bunsetsu tiles → order by tap/keys. Particles attach to the preceding word (は/が/を/に/で/と/へ/から/まで/より/の/も and the compounds のは/のが/のを/には/とは/からは/までは stay on their word); a tile is cut after a particle only when the next character is not hiragana, so ありがとう / ながら / とき never straddle tiles; interior 、 is never a bank piece; a sentence with one movable tile is not scheduled | exact or listed alternate; first try Good, after 1 fix Hard, else Again; tag `word-order` | `grammar:cloze` (Hard/Good only) | Stations 4–24, **retires after Green** (too easy; recognition-shaped) |
| `judgment-call` | 自然か Judgment Call | sentence → ○/× natural or not, then explanation | exact | `grammar:cloze` | from Brown (N2). Unnatural sentences and their explanations are mined from `GrammarItem.mistakes`, whose `× wrong → ○ right (why)` format V14 enforces; natural ones from `examples` |

Grammar Scroll: pretest (3) → pattern, label, formation, ≤ 120-word explanation, 3–5 spoken examples (`TeachCard` passes clip `${item.id}#ex${k}`), one contrast → 3 immediate checks (cloze tiles → typed cloze → transform) → episode excerpt re-shown with the pattern highlighted (noticing).

---

## 5. Listening

| Id | Name | Spec | Grading / effect |
|---|---|---|---|
| `sentence-listen` | 聴写 Sentence Dictation | the sentence spoken at the learner's **speed tier** (0.75 / 0.9 / 1.0 / 1.1 / 1.25; the planner sets `StepParams.clip` — an i+0 pool example of the item first, then a story line, then the bare word — and the pack serves its natural-slow 0.85 take through Station 17); replay ≤ 2 (second replay → Hard ceiling); a line over `DICTATION_MAX_MORAE` (22) dictates one clause (`StepParams.clause`, the clip's `c` boundaries; morae counted with `speechMorae`); type via IME; mora-level diff colored by tag (`vowel-length`, `voicing`, `particle`, `transcription`) | score = 1 − normalized edit distance over mora; ≥ 0.95 Good, ≥ 0.80 Hard, else Again. Not scheduled itself: a correct dictation logs Good on `listen` cards due within 3 days; a mis-transcribed content word logs Again on its `listen` card. The speed tier is never advanced by a drill: after a clean Arena set the dojo **offers** the next tier (`ListeningArena offerTier`, "you decide"; `01 §6`), and the radar reads the tier the learner has shown (`bestCleanTier`, design 08 §12). Station 4+ |
| `listening-set` | 聴解 Listening Arena | a text (dialogue, monologue or audio-first piece) audio only — one cast voice per speaker from the pack, two alternating device voices otherwise (utterances ≤ 180 chars on that path); **questions first** (`gist` first, then by `kind`: detail / number / speaker / inference; a miss on a question with `lineRef` replays that line), then transcript reveal with karaoke highlight (line; the token sweep from the clip's `m` cues at ≥ 1.0×; pitch dots in slow mode), then a mandatory re-listen at +0.1×; a line over 22 morae dictates one clause. **Pool mode — the Ear Walk:** `StepParams.refs` instead of `storyId`: 6–8 i+0 / i+1 pool sentences as choice and dictation items with the same graders and `listening:set { storyId: null, refs, mode: 'walk' }`. The header names the speakers and the source (`3 voices · synthetic` / `2 voices · device`; never "recorded"). A **passed** text set appends the id to `progress.listened` and stamps `progress.arenaAt[storyId]` (design 08 §10.4); a failed set and the Ear Walk write nothing | XP by questions (20 + 5 per correct, walk mode alike); the cold flag, `bestCleanTier` and the authentic minutes feed Perapera 耳 (design 08 §12); after a clean set the next speed tier is **offered**, never applied silently. Station 4+. English questions through Orange, Japanese from Green |
| `minimal-pair` | 聞き分け Minimal Pair | audio of one of two near words (おばさん/おばあさん, きて/きって, つ/す, voiced/unvoiced, ん/vowel) → A/B; **both words through one source** — both pack clips (`item.id` and `${id}#pair`, or the planner's real partner in `distractorIds`) or both the device voice — never a clip against a synthesized partner, or timbre leaks the answer; a synthesized partner follows `synthesizeMinimalPair` (design 08 §11: っ never before ー / ん, same mora count) | skill stat only (not scheduled); feeds `vowel-length`/`voicing` tags. Station 3+ |

---

## 6. Speaking

| Id | Name | Spec | Grading |
|---|---|---|---|
| `shadow` | 影打ち Shadow Strike | sentence with pitch contour; the voice plays the **plain surface** (`toPlain(ja)`, never kana-only text; a pack clip from `params.clip` / `storyId#L` animates the pitch strip's timing, and the strip is labelled "dictionary pattern", never "what you heard"); learner speaks (text hidden after first play once its words are Green). **Recognition path** (`webkitSpeechRecognition`, `ja-JP`, `maxAlternatives 5`, 8 s cap): recognizer output is kanji-kana mixed, so similarity = max over the plain surface, the kana surface and the ruby-mixed variants (per-ruby DP, `input/speaking/scoring.ts`); mora Levenshtein, best of 5. **Fallback:** MediaRecorder plays model then you; 3-item checklist (mora count, long vowels, pitch shape) → self-grade with Judge sampling (a **minimal-pair perception check** on the key word: "which did you hear — きて or きって?") | ≥ 0.80 Good, 0.60–0.79 Hard ("Blocked," diff shown), < 0.60 Again. Facet: `chunk:prod` for set phrases; for ordinary sentences it logs Good/Again on content words' `prod` cards due within 3 days. XP identical on both paths. Station 3+ |
| `say-three-ways` | 三変化 Say It Three Ways | one idea → type or speak it in casual / polite / keigo | marker detection (だ・です・でございます; くれる・くださる・いただく; verb forms); each register's grammar points get `prod` grades; tag `register`. Station 27+ |
| `monologue` | 独白 Monologue Marathon | 60 s (120 s from Brown) on a prompt; recognition counts words and fillers; otherwise timer + self-report. **Reduce & Expand** (Station 37+): retell a just-read passage in 60 → 45 → 30 s | XP only; words/min feeds Perapera 口. Station 29+ |

---

## 7. Reading

| Id | Name | Spec | Grading / effect |
|---|---|---|---|
| `story-read` | 旅日記 Tabi Nikki Episode | passage with **furigana fog** (furigana visible while the kanji's `read` S < 7 d; else hidden, tap to reveal = hint), **tap gloss** on any token (J-E through Green, J-J `definitionJa` + EN behind tap from Purple; resolved through `StoryLine.tokenIds`, loading the item with `getAsync`), silent cpm timer, 3 comprehension questions (EN through Orange, JA from Green). A gloss tap on an introduced word logs Hard on its `rec` card only if the card is **due today** and this is not the episode's first read; on an unintroduced **word** it shows **「捕まえる」Capture** (bookmark → new-item queue; vocab only — grammar and kanji tokens show their station line instead, since `intro-policy` routes only vocab captures into Scrolls). Selection: coverage ≥ `coverageTargetFor(station, bridge)` (97 % through Station 28, 95 % 29–38, 93 % 39+; `bridge` passages 93 % from Station 27) against the learner's live known set | ≥ 2/3 for full XP; cpm logged → Perapera 読. 辞書要らず badge for an episode ≥ 300 chars with ≥ 2/3 and ≤ 2 taps. Vertical text toggle from Blue |
| `speed-read` | 速読 Speed Read | a previously read episode revealed line by line at a chosen cpm; 1 question | correct → XP; targets N5 80 · N4 150 · N3 250 · N2 350 · N1 450 cpm. Station 6+ |

---

## 8. Conversation

**`role-play` 対話 Taiwa Role-Play** (Station 7+). Plays a `dialogue` StoryItem (`learnerSpeaker` = the role the learner plays) with an NPC voice. Dialogues are **linear gold scripts**: the content schema has no branching. Writer-filled fields on learner lines carry the grading data (`StoryLine.options`, `accept`, `mustInclude`; required for every `dialogue` text in Pass 2, V27) and on NPC lines the pauses (`aizuchiSlot`) and register changes (`registerTarget`); `input/taiwa/options.ts` synthesizes options only as a fallback for a line without them, and `aizuchi.ts` infers slots heuristically only when none are marked. Register markers (だ・です・でございます; くれる・くださる・いただく; verb forms) are a runtime constant (`input/taiwa/register.ts`). Mode by belt and device: **Choose** (Yellow–Orange, first exposure only: the line's 3–4 options typed `best / ok / register-wrong / grammar-wrong`, each wrong option plausible and showing its `recast`), **Build** (Orange–Green: tiles from `tokens`), **Type / Speak** (free input matched against plain `ja` ∪ `accept[]`, `mustInclude[]` content words and the register markers; **Type from Station 10** with recasts, Speak from Green).

- **Aizuchi slots:** at `aizuchiSlot` lines the learner must backchannel by tap or voice from the set (はい・ええ・そうですね・へえ・なるほど; うん/へー in casual dialogues) within **2.5 s at Yellow–Orange (untagged, feedback only), 1.8 s at Green, 1.2 s from Blue**. A missed slot is tagged `aizuchi` only from Green; the NPC pauses visibly, then continues.
- **Register switching** (Station 21+): a dialogue may change `registerTarget` mid-way ("your manager joins the table"); the learner's next lines are scored against the new markers; tag `register`.
- Correction is an implicit **recast** mid-flow; explicit corrections and a register meter appear in the debrief. XP 25 (+10 all best, +5 all aizuchi hit). Feeds Perapera 場. Listening Arena reuses the same `dialogue` stories audio-only.

---

## 9. Fluency and remediation modes

| Id | Name | Spec |
|---|---|---|
| `rapid-fire` | 連続技 Rapid Fire | 60-second blitz over cards with **S ≥ 14 d only**; mixed rec/read/cloze; combo counter; arcade skin, chiptune. A miss sets the card's **`recheck`** flag: it is re-tested untimed in the next session and only that failure writes Again (speed slips never collapse a 90-day card). Correct answers write nothing except a Good on a Kaiden-lane card (`05 §8`). XP ≤ 60 for **one run per day** (further runs are free play); arcade reps are excluded from `stats.reviews` and `stats.bestCombo`. Personal best table; feeds `insert-coin` wallpaper. Station 7+ |
| `nemesis-duel` | 宿敵対決 Nemesis Duel | ≥ 8 lapses on a facet → **Nemesis**: dossier (components, mnemonic, 3 extra sentences, confusable side by side); 14 days in context only (cloze, story); then the Duel chain `prod` → `listen` → `cloze`. 3 duel wins on 3 distinct days → defeated (+40 XP), S reset to 3 d. Station 6+ |
| `weak-point-set` | 弱点 Jakuten Set | when an error tag's EWMA > 20 %, a 3-minute set of items carrying that tag is inserted into the next Shugyō (and offered after a Kumite) until the tag drops below 8 %. +15 XP per set |
| `writing-dojo` | 作文 Writing Dojo | prompt + required patterns + target length (3–12 sentences by belt); live checks: required patterns present, particle sanity, register consistency, kanji used for Green words; rubric self-check; **Export** copies text for a tutor. XP 30; no automatic grade. Station 16+ |
| `field-mission` | 他流試合 Taryū-jiai Field Missions | self-reported real-world tasks escalating by belt: read a sign or label aloud (White, Station 3) → order in Japanese (Yellow) → 20 min with JP subtitles, log 3 words → a 3-line comment → 15-minute conversation, log two things you couldn't say (Blue+). Minutes go to the ledger. "Mandatory" in `05 §10` means **offered every week, never a gate**: a learner without access to speakers is never blocked. The two things you couldn't say go to `bookmarks` as free text; only ids that resolve in the corpus enter `captured`, the rest may become Weak Point tags. 30–100 XP. Station 3+ |

---

## 10. Michikusa (道草) — fragments

Not an exercise: a 10-second card (etymology, proverb, culture, pitch fact, kanji origin, usage, road history), 4 per station (212; `michikusa/michikusa-sNN.json`), one per session chosen by `hash(seed, day)` from the un-collected pool of **stations ≤ current + 1** — a find that is deterministic and completable, and never leaks Station 50 road history to a Station 5 learner. When that pool is exhausted the session re-shows a collected fragment flagged "again" with no XP. Collected in the Library.

---

## 11. Gatekeeper (関守) — station boss, 12–15 minutes

**Available when** every item of the station is introduced and ≥ 80 % are Green. No lives, no retreat: the fight always runs to completion and misses are information. **What the gate gates:** the next station's Scrolls open as soon as the current station's items are all introduced; the Gatekeeper gates the goshuin stamp, Shinsa eligibility and the belt — never new items — and Projected Arrival shows the real wait (`02 §6.2`).

| Phase | Items | Time | Pool | Exercises |
|---|---|---|---|---|
| 1 閃 Flash | 20 | 4 s each | cards whose **tested facet** is mature (S ≥ 14 d); younger cards are shown untimed, scored but not timed | `meaning-guard`-style recognition (typed from Green), `kanji-read` |
| 2 打 Strike | 20 | 12 s each | mature `prod` / `cloze` cards (S ≥ 14 d on that facet); younger cards untimed as above; a chunk's rep is a `shadow` and is never timed (self-graded drills carry no hard timer, in Flash or Strike) | `production-forge`, `pattern-cloze`, `form-forge`, `shadow` for chunks |
| 3 耳 Ear | 12 | untimed, 2 replays | station sentences at belt speed (`BELT_RATE`; clips through `playbackRate`): own-station pool refs first (`listening/pool-NN.json` — the vocab and grammar examples that link inside the station's allowlist, design 08 §4), then the station's story lines whose resolved tokens are all known, topped up with the station's own words (bare word → kana); the fight header shows the source chip | `sentence-listen` meaning or dictation |
| 4 型 Final Form | 3 prompts | untimed | station grammar | write or speak a sentence using a named pattern; rubric (pattern regex, length, no banned filler) + model answer + self-grade with a **rubric-item Judge** ("Does your sentence contain 〜てください? Show it." — verified by regex), not the two-option meaning Judge |

Sampling: 70 % this station, 30 % cumulative, weighted toward low retrievability; `gatekeeper.test.ts` asserts no timed Step has a card with facet S < 14 d. Timed-phase timeouts count as a miss in the score but are graded **Hard** (not Again) in FSRS. The Guard button counts as a miss in the score, Again in FSRS, no combo penalty.

**Pass:** overall ≥ 85 % and every phase ≥ 70 %. Reward: goshuin stamp (gold if 100 %), 300 XP (+100 at 100 %), 2 Michikusa, a wallpaper quadrant where tied.

**Not yet:** misses enter the **遺恨帳 Grudge List**; same-day rematch after ≥ 20 Grudge reps — reachable because the day's Kata / Kumite / Shugyō then opens with a Grudge List block (≤ 20 reps; `rematchGrudge` names the reps still owed), and the loss time is saved (`gateAttemptAt`) so a reload keeps the baseline. The third non-pass offers the **Assisted Gate**: no timers, Final Form replaced by 3 cloze, threshold 80 %; a provisional pass (grey-cornered stamp, 150 XP) unlocks Shinsa eligibility. The full fight stays as a **Revenge Match** (450 XP, full stamp, 雪辱 badge). New items are never locked behind a gate (see above).

---

## 12. Shinsa (審査) — belt exam, 20–25 minutes

Taken at the belt's last station after its Gatekeeper, when coverage (`02 §2`) is met. Five sections, pass = ≥ 80 % in each. No hints; furigana stays on for the Yellow exam and is off from Orange (the intro copy says which); 20 s soft timer per item (no fail on timeout).

| Section | Content | Belt-specific |
|---|---|---|
| 耳 Listening | 10 items at belt speed (speed-tier presets only; own-station pool refs before the bare-word top-up, as in the Gatekeeper's 耳 phase) | Yellow 0.9× · Orange 0.9× · Green 1.0× · Blue/Purple 1.1× · Brown/Black 1.25× |
| 読 Reading | 2 passages at belt length, timed | Brown ≥ 300 cpm, Black ≥ 400 cpm at ≥ 80 % |
| 形 Form | 30 typed production/cloze/transform items from the belt pool | — |
| 口 Speaking | one role-play (Speak or Type mode; a dialogue with `learnerSpeaker` only — an audio-first piece without one never reaches role-play or this section), register-scored, + 5 shadow lines | Black adds a 2-minute monologue |
| 書 Writing | 3–6 sentences to a prompt, rubric + required-pattern detection | from Green |

**Not passed:** 「先生の覚書」 **Sensei's Notes** lists exactly which items and tags to drill; retake available after completing one Sensei's Notes session (no clock, no XP loss). **Passed:** ceremony (`02 §2`), 1,000 XP, the belt badge and any Shinsa-gated wallpaper of that belt (`06 §3`), Dojo title. Speaking may be passed in Type mode; Records then shows "Speaking: untested (typed path)" until the learner has used Speak or the self-assessment path, and the ceremony copy says so.

---

## 13. Availability summary

| Station | Unlocks | Retires |
|---|---|---|
| 1 | kana-flash, kana-ear, kana-forge; 茶屋ラジオ Radio `#/radio` (not a drill: the generated kana tracks and the White story lines; never a training day, design 08 §10.2 / §10.5) | — |
| 2 | gojuon-fighter, component-flash | — |
| 3 | minimal-pair, shadow, field-mission | — |
| 4 | meaning-guard, meaning-recall, audio-flash, production-forge, component-assembly, kanji-read, pattern-cloze, scramble, sentence-listen, listening-set (text mode and the Ear Walk), story-read; Read-along `#/story/:id/listen` (a `listen:played` row, never a read) | — |
| 5 | particle-duel | — |
| 6 | speed-read, nemesis-duel | — |
| 7 | role-play (Choose; aizuchi slots), rapid-fire, pitch-ear | — |
| 10 | form-forge; role-play Type mode (with recasts) | — |
| 12 | form-chain | — |
| 16 | writing-dojo, lookalike-duel, transform; role-play Speak mode | Choose mode |
| 21 | role-play register switching | — |
| 25 | Native Bridge passages, vertical text | scramble |
| 27 | say-three-ways | — |
| 29 | monologue | — |
| 34 | meaning-judge (J-J self-grading, opt-in); J-J reveal default | — |
| 37 | reduce & expand | — |
| 39 | judgment-call | — |
| any | kanji-write (opt-in) | kana cards archive at S > 180 d; pitch at S > 90 d; components at S > 90 d |

**Build phases** (`07 §13`, `module-plan.json`): everything unlocked by Station 15 ships in Phase 1 **except** `nemesis-duel`, `rapid-fire`, `role-play` and `field-mission`, which ship in Phase 2 with the ledger; until then the builder skips them (an unregistered exercise is skipped, `ARCHITECTURE §8`) and the Three Kata pool omits their quests.
