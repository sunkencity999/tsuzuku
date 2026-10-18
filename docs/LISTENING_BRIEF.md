# TSUZUKU — Listening Writer's Brief (Pass 4 pieces · Pass 4b Yellow examples)

**Status (2026-10-18):** Pass 4 (100 pieces, 2,911 lines, in 50 `listening-sNN.json` files) and Pass 4b (229 rewritten examples in `vocab-n5-001 … 004` and `006`) have landed; the release gate `content:validate -- --strict --listening-release` reports 0 F (`docs/listening-report.md`, content `c-22578c2f0f`). The brief stays as the reference for any later piece, rewrite or new local.

This brief is pasted into every Pass 4 writer prompt together with `docs/CONTENT_GUIDE.md`. It tells one writer agent how to produce **one `listening-sNN.json` file — two audio-first pieces for Station NN** — that validates under V01–V46, and (§18) how a Pass 4b writer rewrites Yellow vocab examples so V46 holds. The spec is `docs/design/08-listening-and-audio.md` (§3 content program, §5 schema and validator, §6 cast, §9 clauses); on conflict design 08 wins on listening, `docs/CONTENT_GUIDE.md` and `src/content/types.ts` win on ids, paths, markup and type names. Everything in the Content Guide still applies to a piece: a piece is a `StoryItem`, nothing more exotic.

**Five rules that override everything else**

1. Output exactly one JSON file per assignment — no prose, no code fences — plus, **only** when you introduce a new local, one `newCast` block after it (§5.4). Two pieces per file, never more, never fewer.
2. **Heard before read.** Every line must carry its meaning as sound alone: no kanji puns, no joke that needs the written form, no fact that lives only in the spelling (§8).
3. Every `ja` string wraps every kanji in ruby `{漢字|かんじ}`; every `kana` string is kana only; `kana` is exactly what the voice says (§10).
4. Natural, modern, standard-Tokyo **spoken** Japanese of the piece's genre and register. No textbook stiffness after Station 5; a news bulletin sounds like a bulletin, a voicemail like a voicemail.
5. Nothing from any franchise, brand or living person; "sources" in news pieces are generic institutions (町の観光課, 気象台), never real companies or named people (§14).

---

## 1. What a piece is

A piece is a `StoryItem` with three extra marks — `genre`, `audioFirst: true` and, for a speaker-less text, `narrator` — written to be **heard first**. The app plays it before it shows it: the Arena order is listen → questions (gist first, then by `kind`) → transcript with karaoke → one re-listen a notch faster; Radio plays it edge to edge with one gist question after; Read-along plays it line by line with the text open. A piece is served first at its belt's speed tier (`SPEED_TIER_RATES` 1–5 = 0.75 / 0.9 / 1.0 / 1.1 / 1.25; Yellow–Orange pieces also get a natural-slow take at 0.85). Every station 4–53 holds exactly two pieces (`quota.listening = 2`; Stations 1–3 have none), in a file of their own beside the station's three (or two) texts.

Pieces share the validator, the linker, the Arena, the ledger and the badges with every other text, so every rule a story obeys (V01–V40) a piece obeys too. The additions are V41–V46 (§16 lists them with the self-check).

## 2. Your packet and what you return

Your packet carries: this brief; your station number NN; `docs/allowlists/station-NN.json` (the cumulative allowlist ≤ NN: `vocab` ids, `grammar` ids, `kana` ids, `names`, and `surfaces` — surface → vocab id, the exact spellings the linker knows); the station's grammar table with `clozeHints`; the station's existing `public/content/stories/<level>/stories-sNN.json` (reuse its locals, do not re-stage its scenes) and the previous episode's `recapEn`; the station's row of `docs/tabi-nikki-outline.json` (date, season, synopsis, threads); `public/content/_meta/denylist.json`.

You return **one file**, `public/content/stories/<level>/listening-sNN.json`, and nothing else — except that a writer who introduces a local not yet in the cast returns, after the file, a second JSON object:

```json
{ "newCast": [ { "name": "山口さん", "gender": "f", "age": 55, "role": "hot-spring innkeeper at Hakone", "station": 10 } ] }
```

The `newCast` block is **not** inside the content file (unknown keys fail V03). The lead forwards it to the render-pipeline owner, who adds the entry to `scripts/audio/cast.json` before the packet ships; until then `--strict` reports V42 for that label (§5.4).

## 3. File envelope and ids

```json
{ "schema": "tsuzuku.content/1", "type": "story", "level": "n5", "writer": "listening-s07", "generatedAt": "2026-10-17T00:00:00Z", "items": [ { … piece A … }, { … piece B … } ] }
```

- Path `public/content/stories/<level>/listening-sNN.json`; `type` is `story` (V01); `level` equals the path segment: Stations 4–15 `n5`, 16–24 `n4`, 25–38 `n3`, 39–46 `n2`, 47–53 `n1`. There is **no** `stations` key in the file — the manifest derives it from the ids.
- No `null`, no empty strings, no unknown keys, keys exactly as in `StoryItem` (V03). UTF-8, NFKC, no leading/trailing spaces (V31).
- **Ids** continue the station's text sequence (V04/V05, amended so the sequence may run to `quota.stories + quota.listening`). Every station 1–31 ships three texts and every station 32–53 ships two (checked against `public/content/stories` at HEAD), so:

| Stations | Existing texts | Piece A | Piece B |
|---|---|---|---|
| 4–31 | `s-NN-1`, `s-NN-2`, `s-NN-3` | `s-NN-4` | `s-NN-5` |
| 32–53 | `s-NN-1`, `s-NN-2` | `s-NN-3` | `s-NN-4` |

`stationId` is `st-NN`. Never reuse or renumber; never touch `stories-sNN.json`. (Why a separate file: the Black `stories-sNN.json` files are already 100–136 KB and two 60-line pieces add ≈ 200 KB; `MAX_FILE_BYTES` is 300 KiB. A `listening-sNN.json` must stay ≤ 220 KB — V43 also fails an `audioFirst` text that lives anywhere else.)

## 4. The piece: every field

| Field | Rule |
|---|---|
| `id`, `stationId` | §3. |
| `titleJa`, `titleEn` | Title with ruby on every kanji (V11/V12); English short, sentence case. The title is shown, not spoken, so it may carry what the audio cannot (a place name's kanji). |
| `kind` | `story` (one voice, no `speaker` on any line, **`narrator` required** for a piece) or `dialogue` (every line has `speaker`, ≥ 2 distinct speakers) (V25). §7 says which genre takes which. |
| `register` | The majority register of the lines (V22 heuristic: in `polite`, ≥ 50 % of lines end in ます／ません／ました／ましょう／です／でした／でしょう／ください (+ か／ね／よ); `casual` lines do not end in ます／です). Defaults by genre in §7. |
| `genre` | One of `exchange self-intro phone directions voicemail casual-talk narrative announcement weather interview news drama debate lecture essay`, and its first station ≤ NN (`GENRE_FROM_STATION`: exchange 4, self-intro 4, phone 8, directions 10, voicemail 10, casual-talk 10, narrative 16, announcement 16, weather 16, interview 25, news 32, drama 32, debate 39, lecture 39, essay 47) (V41). |
| `audioFirst` | Always `true` on a piece; only legal together with `genre` (V41). |
| `narrator` | On `kind: 'story'` only (V41): the cast label of the single voice — `ハナ`, `ケン`, `田中さん`, a local's label, or a role label `anchor` (news, announcements, weather), `lecturer` (lectures), `reader` (essays). Must resolve in `scripts/audio/cast.json` (V42). Never on a dialogue. |
| `bridge` | Optional, Station 27+ only, at most one piece per station: authentic register (dropped particles, fillers, contractions), coverage target 0.93 instead of 0.97/0.95 (V20). §13. |
| `learnerSpeaker` | Only on a dialogue the brief marks **RP** (§15; Yellow exchange / self-intro pieces that include ハナ): then `learnerSpeaker: 'ハナ'`, ハナ must be one of the speakers (V25), and every ハナ line carries the V27 fields (§13). Otherwise omit — a piece without it never enters role-play or Shinsa 口. |
| `names` | Every proper noun that is not ハナ／ケン／アオ／田中さん: locals (`森さん`), places (`保土ヶ谷`, `横浜`). Exempt from coverage; each must appear in ≥ 1 line's plain text (V25). |
| `lines[]` | 12–60 (V14); the belt band in §6. Fields in §10. |
| `vocabIds` | Every vocab item used, ⊆ allowlist ∪ `plusOne` (V20). |
| `grammarIds` | Every grammar point used, ⊆ the station's cumulative grammar allowlist (V20). |
| `comprehension[]` | ≥ 3 (V14); the first is a `gist` (V41); fields and rules in §12. |
| `recapEn` | ≤ 60 words: what a listener who understood the piece knows (V15). At Black it doubles as the seed of the two-minute spoken response, so name the thesis and the two sides. |

Fields a writer never sets: `tokenIds` (generated by the linker; a writer-supplied value fails V19), `station` (stories carry `stationId`), anything from `StationBundle`.

## 5. Cast and voice labels (design 08 §6)

### 5.1 The labels you may use

| Label | Who | Notes |
|---|---|---|
| `ハナ` | Hana, 24, the diarist, from Yokohama | Also the narration voice of every diary text, so a `narrative` told by Hana is `narrator: 'ハナ'`. |
| `ケン` | Ken, 31, her cousin, a cook between restaurants | Male voice with glad / sad / annoyed styles. |
| `田中さん` | Tanaka-san, about seventy, retired station master | `speaker`/`narrator` label is the plain `田中さん`; in `ja` write `{田中\|たなか}さん`. Announces exact times; the wall clock is always a minute off. |
| `anchor` | the news / announcement / weather voice | `narrator` only, never a `speaker`. Formal broadcast register. |
| `lecturer` | the lecture voice | `narrator` only. |
| `reader` | the essay voice | `narrator` only; literary register. |
| the 46 existing speaker labels | the locals already voiced in `cast.json` | Listed by station below; reuse them before inventing anyone. |

Existing locals (the 46 `speaker` labels of the shipped corpus, which `cast.json` voices): 4 森さん · 5 小川さん · 6 山本さん · 7 石井さん, ユウタ (8) · 8 加藤さん · 9 高橋さん · 12 大野さん · 13 鈴木さん · 16 ユウ (child) · 17 清水さん · 18 林さん · 19 松本さん · 20 青木さん · 21 大石さん · 22 田村さん · 24 野村さん · 25 小林さん · 26 横山さん · 27 ミキ (young), 井上さん · 29 平野さん · 30 山田さん · 31 吉田さん · 32 前田さん · 33 清田さん · 34 岩田さん · 35 村上さん · 36 近藤さん · 37 藤井さん · 39 佐々木さん · 40 小島さん (70) · 41 大西さん · 43 野口さん, リョウ (late twenties) · 45 堀さん · 46 中島さん · 49 本田さん · 50 福田さん · 51 三浦さん — plus ミヤさん (1), サイトウさん (2), タカギさん (3) from the kana stations. A name that appears only in a text's `names` (坂本さん at 28, 渡辺さん at 15) is **not** in the cast yet.

### 5.2 Rules

- `speaker` labels are plain (no ruby): `石井さん`, not `{石井|いしい}さん`; inside `ja` the same person takes ruby. A label is one person for the whole corpus — do not reuse `森さん` for a different person at another station.
- Hosts, moderators and interviewers are **named locals** (a `speaker` label), never `anchor` or `lecturer`.
- A one-sided piece (§7, `phone` one side, `voicemail`) is `kind: 'story'` with `narrator` = the caller's label and an `emotion` on **every** line.
- Children: ミキ, ユウ, ユウタ and any new child are voiced from the child set; a new child's `newCast` entry gives the age so the render owner picks it. リョウ is an adult.
- Pieces at Stations 1–3 do not exist; a piece never needs a kana-stage voice.

### 5.3 `emotion` (per line, optional)

`neutral · warm · annoyed · sad · glad · whisper`. It changes the voice style only where the character has that style (ハナ: warm / annoyed / whisper; ケン: glad / sad / annoyed; others fall back to neutral) and never the text, so write it for meaning: the line *is* a whisper, the speaker *is* annoyed. Use it on at most one line in four, except in one-sided pieces where every line carries one (`neutral` written out). On a `story` line without `narrator` it warns (V41) — a piece always has a narrator, so this never applies to you.

### 5.4 New locals

Introduce a new local only when the station's existing locals cannot carry the scene (a role the cast lacks: a radio host, a child, a craftsperson). Return the `newCast` block of §2 with `name` (the exact `speaker`/`narrator` label), `gender` (`m`/`f`), `age` (an integer; children ≤ 12), `role`, `station`. The render owner adds the voice before the packet ships; nothing is hash-assigned, so two same-gender locals in one dialogue never share a voice. Do not describe a voice or name a VOICEVOX character — that choice is not yours.

## 6. The content program by belt (design 08 §3)

| Belt (stations) | Genres new at this belt (older genres stay legal) | Per piece | Lines · per line | Voices | Tier | Register | What the app does with it |
|---|---|---|---|---|---|---|---|
| Yellow (4–9) | `exchange`, `self-intro`, `phone` one side (8+) | **45–60 s** (cap 60) | 14–16 · ≤ 22 morae, ≤ 38 chars | 1–2 | 2 (0.9×) | polite | gist, detail, `number`; every line dictable; RP pieces become role-plays |
| Orange (10–15) | `exchange` with て-form requests, `directions`, `voicemail`, first `casual-talk` | **65–90 s** (cap 90) | 18–24 · ≤ 22 morae, ≤ 38 chars | 1–3 | 2→3 | polite + casual | gist, detail, `speaker`; Shinsa 耳 0.9× |
| Green (16–24) | `narrative` (told, not read), `announcement`, `weather`, `phone` both sides | **85–120 s** (cap 120) | 18–24 · 25–32 kana, ≤ 53 chars | 1–3 | 3 | polite narration, casual dialogue | Japanese questions, `inference`, clause dictation |
| Blue (25–31) | `interview`, `announcement` with changes, `voicemail` with a task, `casual-talk` with contractions (30+), `bridge` (27+) | **130–180 s** (cap 180) | 24–32 · 30–40 kana, ≤ 68 chars | 2–3 | 3→4 | casual + polite | "what must the listener do next", Say It Three Ways restatement, Monologue retell; Shinsa 1.1× |
| Purple (32–38) | `news`, `interview` with two guests, `drama`, `casual-talk` with fillers | **130–180 s** (cap 180) | 24–32 · 30–40 kana, ≤ 68 chars | 2–3 | 4 | news formal, talk casual | J-J stems (34+), `speaker` across three voices, Reduce & Expand (37+) |
| Brown (39–46) | `news` with numbers and sources, `debate` (two positions + moderator), `lecture`, business `phone` in keigo | **170–240 s** (cap 240) | 30–40 · 35–45 kana, ≤ 90 chars | 2–3 | 4→5 | keigo, polite debate, formal news | claim vs support, "which speaker said", thesis-clause dictation, Judgment Call; Shinsa 1.25× |
| Black (47–53) | `lecture` (4–5 min), `essay` read aloud, `drama` multi-scene, `debate` | **210–300 s** (cap 300) | 36–50 · 35–45 kana, ≤ 120 chars | 1–3 | 5 | literary, formal, casual drama | Japanese summary, tone, 2-minute response (Shodan) |

**Length arithmetic.** Speech time ≈ **Σ `kana` characters ÷ 7 + 0.5 s × lines** (the estimate `scripts/listening-report.ts` and V45 use). A 14-line Yellow piece whose lines average 20 kana: 280 ÷ 7 + 7 = 47 s. A 28-line Blue piece at 36 kana: 1008 ÷ 7 + 14 = 158 s. V45 warns when the **station's pair** falls outside ±30 % of 2 × the cap, so write each piece at 75–100 % of its cap, never over. The 4.7 h program total assumes pieces near their caps.

The per-line character cap is V15's story cap for the level (`ceil(1.5 × 25/35/45/60/80)` = 38 / 53 / 68 / 90 / 120 plain characters). Through Station 15 the mora cap (§10.5) is the binding one.

## 7. Genre playbook

Every genre below names its `kind`, its default `register`, what makes it that genre, and the question kinds it should carry. "One voice" = `kind: 'story'` + `narrator`.

| Genre | Kind | Default register | Shape and must-haves | Questions |
|---|---|---|---|---|
| `exchange` | dialogue (2–3) | polite | A service exchange with a stake: check-in, a stall, a ticket window, a shrine board. Turns of 1–2 sentences; from Orange, て-form requests (見せてください). At Yellow, when ハナ is a speaker and the row says RP, it is a role-play (§13). | gist, detail, `number` |
| `self-intro` | one voice | polite | One person introduces themself: name, age, where from, what they do, one like and one dislike, closing hook (〜さんは？). The learner's own self-intro template at Station 4–7. | gist, detail, `number` (age) |
| `phone` (8–15) | **one voice**, `narrator` = caller, `emotion` every line | polite or casual by caller | **One side only.** Each line is one turn of the caller; the unheard party speaks between lines, so each new turn opens with an echo or confirmation that lets the listener reconstruct the other side (はい。七時ですね。／二人です。). Start with もしもし and a self-identification, end with a closing formula. No ellipsis characters — the pause between lines is the room. | gist, detail, `number`; never `speaker` |
| `phone` (16+) | dialogue (2) | polite; keigo at Brown | **Both sides.** Short backchannel lines (はい。／ええ。／そうですか。) from the listener as real lines, two to four per piece. At Brown a business call: お世話になっております, 〜の件, 〜かねます. | detail, `inference`, `speaker` |
| `directions` | dialogue (2) | polite | A route with 2–4 steps (まっすぐ行って、二つ目の角を右に曲がってください), a landmark, a time or distance, one permission or prohibition. | detail, `number` (minutes) |
| `voicemail` | **one voice**, `narrator` = caller, `emotion` every line | by caller | A message left for someone absent: identification, situation, **one concrete task from Blue** (bring X by Y; call back about Z), a closing. At Blue the questions ask "what must the listener do next". | gist, detail, `number`, task-as-`detail` |
| `casual-talk` | dialogue (2–3) | casual | ハナ and ケン (and a local) in plain forms. Orange: short plain turns. Blue 27+: fillers and dropped particles (bridge); 30+: real contractions (食べちゃう、置いとく、〜じゃん、〜んだって). Purple: fillers (えっと、なんか、まあ) that carry no information. | `speaker`, `inference`, detail |
| `narrative` | one voice | polite ≤ 24; casual for ハナ 25+ | **Told, not read**: a story someone tells someone (田中さん on the temple steps, ハナ to ケン at night), with the markers of telling (それでね、そのとき、〜んです) rather than diary prose. | gist, detail, `inference` |
| `announcement` | one voice, `narrator: 'anchor'` (a named local when it is plainly that person's PA) | polite | A loudspeaker or in-house announcement: where, when, what to do. Blue+: **with changes** — the old time or place is said and then corrected (五時ではなく四時に), so the `number` question has the old value as a distractor. | gist, `number`, detail |
| `weather` | one voice, `narrator: 'anchor'` | polite | A forecast: today, tomorrow, one number with a unit (度, ミリ, メートル), one piece of advice. Green uses 〜そうだ／〜らしい; Brown names a source (気象台によると). | `number`, detail |
| `interview` | dialogue (2–3) | polite host; guest by character | A named host asks, a guest answers at length; Purple: **two guests** who disagree on one point. The host restates once (つまり…ということですね). | `speaker`, `inference`, detail |
| `news` | one voice, `narrator: 'anchor'` | formal | A bulletin: lead sentence, two facts with numbers and units, **a quoted person by role not name** (店の人は「…」と話しています), a generic source (町によると), a closing. Brown: two sources, three numbers. | gist, `number`, detail; a J-J stem from 34 |
| `drama` | dialogue (3) | casual (scene-dependent) | A scene with a small problem that resolves: three voices, `emotion` on turning lines. Black: **multi-scene** — a scene change is carried **inside a spoken line** (「もう朝か。」), never by a speaker-less line (V25 forbids one in a dialogue). | `speaker` across three voices, `inference` |
| `debate` | dialogue (3) | polite | A named moderator and two positions: each side states a claim, supports it, concedes one point; the moderator restates both and closes. The closing restatement has clean clause boundaries (thesis-clause dictation). | "which speaker said", claim-vs-support as `detail`/`inference` |
| `lecture` | one voice, `narrator: 'lecturer'` | polite (です／ます) or formal (である) | Signposted talk (まず、次に、最後に; 一つ目は…), one thesis, two examples, one number with a unit, a summary. Black: 4–5 min. | gist (thesis), detail, `inference`, `number` |
| `essay` | one voice, `narrator: 'reader'` | literary / written | A read-aloud essay from Station 47: one image, one reflection, one turn, one close; literary grammar (〜ごとく、〜んばかり、〜べからず). Questions ask for the summary and the tone. | gist (summary), `inference` (tone), detail |

**Themes and places.** Each piece is set on the station's episode date at the station (the seed table §15 gives date, season, theme and existing locals). Pieces live in the same year as the diary: Yellow is early April then July, Green late July to mid-August, Blue–Purple late September to October, Brown late October to December, Black New Year to late January. The diary's running threads (the kindness tally, Ken's borrowed kitchens, the one-cat argument, Tanaka-san's wrong forecasts and exact times, Fuji hiding and appearing, one dish per station) may be touched in one line, never retold.

**Never duplicate the station's texts.** The seed rows avoid the scenes `stories-sNN.json` already stages; if your packet's recap shows an overlap, move the piece to a neighbouring setting, keep the genre.

## 8. Heard before read

1. **No kanji puns, no homophone jokes** (橋／箸, 雨／飴) and no line whose point is the written form — those belong to Pitch Ear, not to a piece.
2. **Nothing carried only by the writing.** A name's kanji, a sign's characters, a brand of punctuation: if the listener needs to *see* it, say it (「せきと書きます」 is fine; a silent 関 is not). Quoted speech inside a narrated piece is introduced audibly (〜と言いました、〜という声), because 「」 cannot be heard.
3. **Every proper noun is pronounceable from the kana** and introduced before it matters (この町、見付は…).
4. **Numbers are said once, in full, with their counter**, in the line a `number` question points to (§9).
5. **One idea per line.** The line is the replay unit, the dictation unit and the karaoke unit; a line that changes topic halfway is two lines.
6. **Clause-friendly punctuation** from Station 16: put 、 at real clause boundaries (after て-forms, から／けど／ので, quoted clauses) so a line longer than 22 morae dictates by clause (design 08 §9). Never a 、 inside a noun phrase for looks.
7. **No ellipsis, no dashes, no brackets** in `ja`/`kana`; punctuation is `。、？！「」` only (§14.2). A pause is a line break.
8. **Speech, not prose**: sentence-final particles where a speaker would use them (ね、よ、か), aizuchi as lines, fillers only where the belt allows them (§7).

## 9. Numbers — the four conventions

1. **In `ja` and `kana`, numbers are kanji with ruby or kana** (`{七時|しちじ}`, `{三百円|さんびゃくえん}`, `{二十四歳|にじゅうよんさい}`); never ASCII digits (V31). Dates, times, prices, counts, temperatures and distances all follow this.
2. **Every `number` question states its unit in the stem** ("What time does breakfast start?", "How many towels?", 「{何度|なんど}ですか」), and all four choices share that unit and format.
3. **English choices (Stations ≤ 15) may use digits** (`"7:00"`, `"¥300"`, `"2 nights"`); **Japanese choices (16+) use kanji numerals with ruby and the counter** (`"{三時半|さんじはん}"`, `"{二泊|にはく}"`). Mixed formats inside one question fail the learner, not the validator — keep them uniform.
4. **The answering line says the number once, in full, with its counter**, and `lineRef` points to it. Distractors are other numbers the piece actually says (the old time in an announcement with changes, the other party's count) or near-neighbours; the しち／いち and 四／七 traps are fair from Station 8, not before.

## 10. Lines

### 10.1 Ruby (§4 of the guide)
`{base|reading}`, base = the kanji run, reading = its kana; okurigana outside; one ruby per word (`{毎朝|まいあさ}`), not per character; every kanji and 々 inside a base (V11/V12); the readings + plain text must equal `kana` exactly (V13). Latin only as an uppercase acronym ≤ 4 letters inside a ruby (`{ATM|エーティーエム}`).

### 10.2 `kana` (§5)
Hiragana, katakana, `ー`, `・`, the sentence punctuation `、。！？「」` and spaces; katakana words stay katakana (`コーヒー`). It is what the engine speaks, so a long-vowel or small-っ slip is an audible error, not a typo.

### 10.3 `tokens` (§14.2)
Word-level surfaces whose concatenation equals plain `ja` exactly (V19): one token per word including its inflection (`飲みました`), particles separate, て-form auxiliaries separate (`食べて`, `います`), compound nouns one token, each punctuation mark its own token, `「` and `」` tokens of their own. Never `tokenIds`.

### 10.4 `en` (§6)
A natural full English sentence, sentence case, final `.`/`?`/`!`; default subject "I" when Japanese omits it; no literal word order, no bracketed explanations. In a dialogue, English that a subtitle would show.

### 10.5 The ≤ 22-morae rule (Stations 4–15, V41)
Every line of a piece through Station 15 is ≤ 22 morae so it can be dictated whole. Count the `kana` field with punctuation and spaces removed: each kana is one mora, a small ゃゅょぁぃぅぇぉ folds into the kana before it (きゃ = 1), っ, ん and ー are one each (`moraCount` in `src/shared/jp.ts`). `おはようございます。きょうはあついですね。` = 9 + 9 = 18. **Write ≤ 20** so the cap never bites. From Station 16 there is no cap; §8.6 applies instead.

### 10.6 Line length and count
Lines 12–60 per piece (V14); the belt's band in §6. Plain `ja` ≤ 38 / 53 / 68 / 90 / 120 characters for N5 / N4 / N3 / N2 / N1 (V15).

### 10.7 `plusOne`
A vocab id from a later station that this line uses: ≤ 1 per line, ≤ 3 per piece, present in the line, and also listed in `vocabIds` (V20). Spend them on the word the scene cannot do without (いとこ at Station 4), never on decoration.

### 10.8 `emotion`
§5.3.

## 11. Coverage (V20)

- **Allowlist** = `docs/allowlists/station-NN.json`: every vocab and grammar item assigned to stations ≤ NN (the ids in `public/content/stations/01…NN.json`), plus `names`. Every content word comes from it or is one of ≤ 3 `plusOne`.
- **Function tokens never count as unknown**: particles (は が を に で と へ から まで より の も か ね よ な わ って), copula and ます-forms (です だ でした だった じゃない ではありません でしょう ます ません ました ましょう), て-form auxiliaries (いる ある おく みる しまう くれる もらう あげる いく くる), name suffixes (さん ちゃん くん 様 たち), kanji numerals, punctuation, and any `clozeHints` substring of an allowlisted grammar point. Counters are vocab items — check their station.
- **Inflections link** to the dictionary form when the verb is in the allowlist (§14.2 of the guide: する／来る paradigms, godan onbin forms, てる／てた, ichidan forms, です forms). A kana token that is only the *reading* of a kanji word is a last resort for the linker, so **write content verbs in kanji with ruby** (`{出|だ}して`, not だして) and spell words as the allowlist's `surfaces` map spells them.
- **Targets**: known-token coverage ≥ 0.97 for Stations 4–28, 0.95 for 29–38, 0.93 for 39–53 and for any `bridge: true` piece.
- `vocabIds` lists every allowlisted word the piece uses (V20 warns on a detected word that is missing and when `vocabIds` names < 60 % of what the linker detects; auxiliary spellings are exempt). `grammarIds` lists every pattern used; a pattern outside the station's grammar allowlist fails.
- `names` entries are exempt from coverage; ハナ／ケン／アオ／田中さん are known everywhere.

## 12. Questions (V21 · V41)

```json
{ "q": "What time does breakfast start?", "choices": ["6:00", "7:00", "8:00", "4:30"], "answer": 1, "kind": "number", "lineRef": 5 }
```

- **≥ 3 per piece** (V14); **the first is `kind: 'gist'`** and asks what the piece is about or what happened, answerable without any single line (V41). Then by `kind`: `detail` (a stated fact), `number` (§9), `speaker` (who said it — **dialogues only**, V41; best in three-voice pieces; a fourth choice may be a cast member who is not in the piece), `inference` (not stated outright: why, how someone feels, what happens next — Green and later).
- **`lineRef`** on every non-gist question: the 0-based index into `lines` of the line that answers it; a miss replays that line (design 08 §9). A `gist` question may omit it. Out-of-range fails (V41).
- **Language**: through Station 15 `q` and `choices` are English with **no Japanese characters** (names romanised: Hana, Ken, Tanaka-san, Mori-san); from Station 16 they are Japanese and every `q` and every `choices` entry obeys the ruby rules (V21 — the app renders both through `<Ruby>`). From Station 34 one question per piece may be a **J-J stem** (「{本陣|ほんじん}」とは{何|なん}ですか) with Japanese paraphrase choices.
- Four **distinct, non-empty** choices; the correct index **varies** across the piece's questions (W when it does not).
- Belt tasks shape the mix (§6): Yellow gist + detail + number; Orange adds speaker; Green inference; Blue "what must the listener do next" (a `detail` on the task line); Brown claim vs support and "which speaker said"; Black summary and tone (an `inference` whose choices are four one-line Japanese summaries or four tone words with ruby).
- A piece has 3–5 questions; the Arena asks them all, Radio asks the gist only.

## 13. Register, bridge, role-play

- `register` is the majority register (§4 table). Aizuchi and one-word lines do not end politely, so in a `polite` piece keep ≥ 50 % of the lines ending in a polite form (V22 warns otherwise).
- **Casual input from Station 10**: a `casual-talk` piece is `casual`; its ハナ／ケン turns use plain forms, sentence-final particles and, from 30, contractions. A `polite` exchange may still contain one casual aside from ケン.
- **`bridge: true`** (27+, ≤ 1 piece per station; the station's existing bridge *text* in `stories-sNN.json` is separate — design 08 §3 adds the bridge piece beside it): authentic register — dropped particles (川、広いな), fillers (えっと、なんか), contractions, a notice or forum cadence — with coverage ≥ 0.93. A bridge piece is heard at the Station 27 teach card "Aim for 93 %, not 100 %"; do not make it harder than that.
- **`learnerSpeaker`** only on the Yellow dialogues the seed table marks **RP** (ハナ is a speaker): set `learnerSpeaker: 'ハナ'` and give every ハナ line the V27 fields — `options` (3–4 entries, exactly one `kind: 'best'` whose `text` equals the plain line, every other entry plausible with a `recast`), `mustInclude` (plain content words a free answer must contain), ideally `accept` (other natural plain surfaces); mark one `aizuchiSlot: true` on each NPC line ≥ 12 characters where a listener would backchannel. Pieces without RP carry none of these fields and no `aizuchiSlot` (they never reach role-play).
- Keigo at Green 21 is heard, not required of the learner; at Brown the business `phone` pieces are keigo on both sides.

## 14. Denylist and safety (V30, guide §17)

No franchise, character, studio, game, mascot, brand, product, real living person, real company signage or song lyric anywhere — Latin or katakana (`_meta/denylist.json`: 6,255 terms and 6 patterns; search your strings against it before returning). News and lecture **sources are generic roles and institutions** (町の観光課、気象台、店の人、研究者), quotes are attributed by role, statistics are plausible and unattributed to a real body. Historical figures only if dead > 100 years and, in a piece, unnamed ("an old poem", "a painter"). No stereotypes about nationalities, genders or regions; dialect only as a receptive colour in a local's lines, never mocked. Nothing violent, no illness drama, no romance plot (the bible).

## 15. Station seeds (binding: genre, kind, voices; adjust detail to the allowlist)

Two pieces per station, never the same genre twice in a station, every genre at or after its first station, set at the station on the episode's date. **RP** marks the Yellow dialogues that take `learnerSpeaker: 'ハナ'`. A voice marked **(new: …)** needs a `newCast` entry (§5.4); every other label is in the cast today. `anchor`, `lecturer`, `reader` are narrator labels.

| St | Setting · date · theme | Id | Genre | Kind · voices | Seed |
|---|---|---|---|---|---|
| 4 | **4 保土ヶ谷 (Hodogaya)** · 坂の関守 Hill Keeper · yellow · N5 · 04/01 · overnight rain clearing, petals on the Gontazaka hill · です/は/も, これ・それ・あれ, か | `s-04-4` | `exchange` | dialogue · ハナ · 森さん | RP. Checking in at the hill-top inn: Hana asks about everything (これは{何\|なん}ですか) and 森さん answers — the wooden box is the shoe cupboard, that is the bath, the key, the room number; それも／これも. number: how many people (二人) or which room. |
| 4 |  | `s-04-5` | `self-intro` | story · narrator ケン | At the dinner table Ken introduces himself to 森さん: name, 三十一歳, a cook, from Yokohama, Hana's cousin (いとこ may be plusOne), what he likes; closes with 森さんは？ as the hook. number: his age. |
| 5 | **5 戸塚 (Totsuka)** · 夜明けの関守 Dawn Keeper · yellow · N5 · 04/02 · cold pink dawn (6°C), warm afternoon · numbers, time, から〜まで, の | `s-05-4` | `exchange` | dialogue · ハナ · 小川さん | RP. Front desk before dawn: what time is it now (四時半), breakfast 七時から八時まで, the door opens at six, the first bus to the shrine. number: breakfast start, and distractors 一時/七時/四時 heard in the text. |
| 5 |  | `s-05-5` | `self-intro` | story · narrator 小川さん | The innkeeper's daughter introduces herself: 小川 (ruby), a university student, 二十歳, helps at the inn 月曜日から金曜日まで, studies in Yokohama, likes the dawn sky. number: her age or the weekday span. |
| 6 | **6 藤沢 (Fujisawa)** · 松林の関守 Pine Grove Keeper · yellow · N5 · 04/04 · warm and bright, pine grove, whitebait boats off Enoshima · ます/ません/ました, を/で/に/へ/と | `s-06-4` | `self-intro` | story · narrator 山本さん | The whitebait seller introduces his shack (ます/ません/ました; を/で/に/へ): 毎朝五時に海へ行きます、しらすを売ります、今日はたくさん取りました; what he did not do today. number: what time he goes to sea. |
| 6 |  | `s-06-5` | `exchange` | dialogue · ハナ · 山本さん | RP. Hana buys whitebait and cold tea for Ken at the stall: how much (〜円, 百/千 are in the White set), two packs, 'do you sell …?', 'where did you catch it?'. number: the price (三百円 vs 八百円). |
| 7 | **7 平塚 (Hiratsuka)** · 七夕の関守 Tanabata Keeper · yellow · N5 · 07/04 · rainy season just over, hot and humid, Tanabata streamers · い/な adjectives, とても/あまり, first aizuchi | `s-07-4` | `exchange` | dialogue · ハナ · ユウタ | RP. Under the Tanabata streamers Hana and eight-year-old ユウタ compare them: which is big, long, pretty, とても／あまり; colours; he asks if she likes festivals; first aizuchi (そうですね／へえ). number: how many colours they count (五つ). |
| 7 |  | `s-07-5` | `self-intro` | story · narrator ユウタ | The boy introduces himself (child voice): ユウタです、八歳です、学校はあまり好きじゃないです、七夕はとても好きです, his grandmother 石井さん, what his school made. number: his age (八歳, distractor 一歳/七歳). |
| 8 | **8 大磯 (Ōiso)** · 浜辺の関守 Shore Keeper · yellow · N5 · 07/06 · hot sea haze, evening low tide on the beach · あります/います, counters 〜つ/〜人/〜枚/〜本 | `s-08-4` | `phone` | story · narrator ケン | ONE-SIDED (kind story, narrator ケン, emotion on every line). Ken phones the Ōiso inn from the beach: もしもし、ケンです。今、浜辺にいます。…はい。二人です。…七時ですね。はい、わかりました。 — あります/います, counters; the unheard side is implied by his echoes. number: dinner time or the party size. |
| 8 |  | `s-08-5` | `exchange` | dialogue · ハナ · 加藤さん | RP. At the inn's front: is there a bath (庭のそばにあります), where is the cat (舟の下にいます — the アオ cat line), three towels (三枚), two bottles of tea (二本); あります／います contrast. number: how many towels. |
| 9 | **9 小田原 (Odawara)** · 城下の関守 Castle Town Keeper · yellow · N5 · 07/08 · 31°C, cicadas, lotus in bud in the castle moat · 〜ましょう/〜ませんか, 〜たい, 〜をください · Yellow Shinsa | `s-09-4` | `exchange` | dialogue · ハナ · 高橋さん | RP. At the castle-gate ticket window (not the kamaboko shop, which s-09-1/2 own): 大人二枚ください, shall we go up (上に行きましょうか／行きませんか), Hana wants to see the moat lotus (見たいです), the keeper suggests cold tea. number: how many tickets or the price. |
| 9 |  | `s-09-5` | `phone` | story · narrator 田中さん | ONE-SIDED (story, narrator 田中さん, emotion per line, elder voice). Tanaka-san phones from the station bench: もしもし、田中です。今、小田原駅にいます。…はい。三時に行きます。一緒にお城を見ませんか。…では、三時に。 He announces the exact time; the clock joke if room. number: the meeting time. |
| 10 | **10 箱根 (Hakone)** · 大関所の関守 Great Checkpoint Keeper · orange · N5 · 07/10 · mist on the climb, 19°C at the pass, hot-spring steam · て-form, 〜てください, 〜ています | `s-10-4` | `exchange` | dialogue · ハナ · ケン · 佐藤さん (new: m 40s) | て-form requests at the reconstructed checkpoint: the costumed guide asks them to show the stamp card (見せてください), write their names here, wait a moment; around them people are doing things (〜ています). No learnerSpeaker from Station 10. number: how many stamps on the card. |
| 10 |  | `s-10-5` | `voicemail` | story · narrator 山口さん (new: f 50s) | The hot-spring inn leaves a voicemail (story, narrator = the innkeeper, emotion per line): こちらは箱根の〜です; it is raining up here (降っています); dinner is being cooked for six (作っています); please come by six and bring the stamp card (〜てください). number: the hour. |
| 11 | **11 三島 (Mishima)** · 湧水の関守 Spring Keeper · orange · N5 · 07/13 · clear and hot, spring water at 15°C through the town · 〜てもいい/〜てはいけない, 〜から/〜が/でも | `s-11-4` | `directions` | dialogue · ハナ · 中村さん (new: f 30s) | From the great shrine to the spring-water footbridges: まっすぐ行って、二つ目の角を右に曲がってください; 〜てもいいですか — may I drink the water (yes), may I take photos here (no, 〜てはいけません); 〜から explains why. number: minutes on foot (五分 vs 十五分). |
| 11 |  | `s-11-5` | `casual-talk` | dialogue · ハナ · ケン | First casual piece: feet in the 15°C channel — 冷たい！／足、入れてもいい？／だめだって; why Ken became a cook (〜から), 'but' (でも), short plain-form turns; a cat line if アオ appears. speaker question allowed. |
| 12 | **12 沼津 (Numazu)** · 港市の関守 Harbor Market Keeper · orange · N5 · 07/15 · 5 a.m. fish market, horse mackerel drying · plain forms, 〜と思う | `s-12-4` | `casual-talk` | dialogue · ハナ · ケン | On the harbour wall after the 5 a.m. market, plain forms and 〜と思う: what Hana thinks of the road so far (歩くのは楽しいと思う、疲れると思う), Ken on the fish he saw; first 'the diary is only for me' remark (the-diary thread). inference: how Hana feels. |
| 12 |  | `s-12-5` | `directions` | dialogue · ハナ · 大野さん | The fishmonger explains the way from the market to the harbour bus stop and the inn: この道をまっすぐ行って、橋を渡ってください; the bus leaves at 八時十分; polite-blunt market voice. number: the bus time or minutes to walk. |
| 13 | **13 原 (Hara)** · 富士見の関守 Fuji-View Keeper · orange · N5 · 07/17 · very clear dawn, Fuji above the rice fields · 〜前に/〜後で/〜てから/〜ながら, 〜たことがある | `s-13-4` | `exchange` | dialogue · ハナ · ケン · 鈴木さん | Breakfast at the inn after the clear Fuji dawn: has anyone climbed Fuji (〜たことがある) — Ken has, once; Hana never; the farmer 鈴木さん three times; what they did before/after eating (〜前に／〜てから). number: how many times 鈴木さん has climbed. |
| 13 |  | `s-13-5` | `phone` | story · narrator ハナ | ONE-SIDED (story, narrator ハナ, emotion per line). Hana phones tomorrow's inn at Yoshiwara to book: もしもし、予約をお願いします。明日の晩、二人です。…はい。富士山を見てから行きます。…五時ごろ着きます。 Her echoes imply the clerk. number: how many nights / arrival hour. |
| 14 | **14 吉原 (Yoshiwara)** · 左富士の関守 Left-Fuji Keeper · orange · N5 · 07/19 · hot; Fuji appears on the left at the bend · potential, 〜ことができる, あげる/もらう/くれる | `s-14-4` | `casual-talk` | dialogue · ハナ · アヤ (new: f 7) | At the Left-Fuji marker a seven-year-old girl (child voice) and Hana: can you swim (泳げる？), can you read this sign (読める？), she gives Hana a sweet (これ、あげる／もらっていい？), Fuji is on the left today (fuji-watch thread). potential + あげる/もらう/くれる in plain casual form. |
| 14 |  | `s-14-5` | `voicemail` | story · narrator ケン | Ken's casual voicemail for Hana, who walked ahead (story, narrator ケン, emotion per line): 今、郵便局にいる。はがきを三枚買った。五時までに吉原の駅で会える？ (home-and-work thread: a postcard home). number: how many postcards. |
| 15 | **15 蒲原 (Kanbara)** · 雪夜の関守 Snowy Night Keeper · orange · N5 · 07/22 · typhoon approaching, rain all day, two nights at the inn · 〜たら/〜と/〜ば/〜なら, 〜なければならない · Orange Shinsa | `s-15-4` | `exchange` | dialogue · ハナ · ケン · 渡辺さん (new: f 60s) | The Kanbara inn in the typhoon: if the rain keeps up they must stay (降ったら／〜なければなりません), two nights, if it snowed like the print on the wall (雪が降ったら), 'it never snows here'; て-form requests to close the shutters. number: how many nights. |
| 15 |  | `s-15-5` | `voicemail` | story · narrator 田中さん | Tanaka-san's forecast voicemail (story, narrator 田中さん, emotion per line; tanaka-weather thread): 明日は晴れると思います。晴れたら由比へ行ってください。雨なら蒲原にいてください。 He is wrong as usual — the writer sets up the typhoon passing on the 25th. number: the hour he names. |
| 16 | **16 由比 (Yui)** · 薩埵峠の関守 Satta Pass Keeper · green · N4 · 07/25 · typhoon passed, washed sky, Suruga Bay deep blue, 33°C · transitive/intransitive pairs, 〜てしまう, 〜ておく | `s-16-4` | `weather` | story · narrator anchor | Radio weather after the typhoon (polite broadcast voice): Suruga Bay clear, 三十三度, north wind in the afternoon, waves falling; tomorrow hotter; 〜ておいてください advice (water, hats). Japanese questions from here. number: today's high (°C stated). |
| 16 |  | `s-16-5` | `phone` | dialogue · ケン · 渡辺さん (new: f 60s) | BOTH SIDES (dialogue from Station 16). Ken calls the Kanbara inn: he left the sakura-ebi bag (置いてきてしまいました); could you keep it (取っておいていただけますか is Station 21 — use 〜ておいてください); the window that would not close (閉まらない／閉める pairs). detail: where the bag is. |
| 17 | **17 興津 (Okitsu)** · 清見の関守 Kiyomi Keeper · green · N4 · 07/27 · hot and still, sea sparkling, greenhouse mikan · 〜ていく/〜てくる, 〜てみる, imperative/〜な/〜なさい | `s-17-4` | `narrative` | story · narrator 田中さん | TOLD, not read (elder voice): on the temple steps Tanaka-san tells how the Kiyomi barrier used to stop travellers, how the mikan came 'and went' (〜ていく／〜てくる), and gives his brisk orders (座りなさい、食べてみなさい). inference: why he is here (never said). |
| 17 |  | `s-17-5` | `announcement` | story · narrator anchor | Temple and mikan-stand loudspeaker: 走らないでください、触らないでください; the gate closes at 五時; try the greenhouse mikan (食べてみてください), 一袋三百円; today's tasting ends at four. number: closing time (vs the tasting time). |
| 18 | **18 江尻 (Ejiri)** · 突風の関守 Gust Keeper · green · N4 · 07/29 · strong sea wind at the Miho pine grove, hats lost · passive, causative, causative-passive | `s-18-4` | `narrative` | story · narrator ハナ | Told to Ken that evening (polite narration, warm): the gust that stole her hat (風に飛ばされた), the stranger's papers blown across the pines, the hat seen flying over the sea, the innkeeper making Ken cook (作らせた) — passive and causative in a told story. |
| 18 |  | `s-18-5` | `phone` | dialogue · 林さん · ケン | BOTH SIDES. The innkeeper phones Ken at the beach: the cook is away, 今夜、作っていただけませんか／作らせてもらえますか; eight guests, two children; what is in the kitchen; Ken agrees and is made to wait out the wind (待たされる). number: how many guests. |
| 19 | **19 府中 (Fuchū)** · 駿府の関守 Sunpu Keeper · green · N4 · 08/01 · hot city afternoon in Shizuoka, typhoon rumours · 〜そうだ, 〜ようだ/〜みたい, 〜らしい | `s-19-4` | `weather` | story · narrator anchor | The shop radio in the Sunpu arcade: 台風が近づいているそうです、明日には来ないようです、雨が降るらしい; temperatures and times; hearsay vs appearance side by side. number: the typhoon's distance or tomorrow's high. |
| 19 |  | `s-19-5` | `casual-talk` | dialogue · ハナ · ケン · 松本さん | At the Abekawa-mochi stand: things that look delicious (おいしそう), the sky looks like rain (降りそう／雨みたい), 松本さん says the typhoon will miss (らしい); Ken buys a box. speaker question across three voices. |
| 20 | **20 鞠子 (Mariko)** · とろろ汁の関守 Tororo Keeper · green · N4 · 08/04 · damp heat in the valley, cool inside the tororo teahouse · 〜ように/〜ために, 〜ようになる, 〜ことにする | `s-20-4` | `narrative` | story · narrator 青木さん | Told by the teahouse cook: how tororo-jiru is made so that travellers can keep walking (〜ように／〜ために), how she learned it (できるようになった), why she decided to keep the old recipe (〜ことにした). detail: what is grated first. |
| 20 |  | `s-20-5` | `announcement` | story · narrator anchor | The valley bus stop announcement: next bus 四時十分発, every forty minutes, please wait behind the line so that the bus can turn (〜ように), the last bus 七時; today the teahouse closes early. number: departure time. |
| 21 | **21 岡部 (Okabe)** · 宇津ノ谷の関守 Utsunoya Pass Keeper · green · N4 · 08/07 · cool dark Meiji tunnel, blazing outside, first dragonflies · keigo basics, 〜ていただけませんか, register switching | `s-21-4` | `phone` | dialogue · ハナ · 大石さん | BOTH SIDES, keigo: Hana calls the formal inn at Okabe — 荷物を預かっていただけませんか, 明日の朝早く出たいのですが; the proprietress answers お待ちしておりました、ご案内いたします, humble/honorific pairs the learner must only hear. detail: what Hana asks for. |
| 21 |  | `s-21-5` | `announcement` | story · narrator 大石さん | In-house keigo announcement by the proprietress: dinner at 六時半 in the hall, the bath open until 十一時, tomorrow's breakfast at 七時, please leave shoes at the entrance (お脱ぎください). number: bath closing time. |
| 22 | **22 藤枝 (Fujieda)** · 継立の関守 Relay Keeper · green · N4 · 08/10 · hot, tea fields, a slow bus · 〜かどうか, embedded questions, 〜はず/〜ばかり/〜ところ | `s-22-4` | `phone` | dialogue · ハナ · 田中さん | BOTH SIDES. Hana calls Tanaka-san from the relay-site bus stop: 今どこですか — もう着いているはずです; he is on a bus and does not know whether it stops at the station (止まるかどうか); embedded questions (何時に来るか分かりません). inference: who is more worried. |
| 22 |  | `s-22-5` | `announcement` | story · narrator anchor | The slow bus's recorded announcement: まもなく発車するところです、十分ほど遅れています、藤枝駅に止まるかどうかは…; the tea-field stop names; please ask the driver. number: minutes late (十分 vs 十五分). |
| 23 | **23 島田 (Shimada)** · 大井川の関守 Ōi River Keeper · green · N4 · 08/13 · Obon lanterns, the wide Ōi river low and braided · 〜ても/〜のに, 〜し, 〜ば〜ほど | `s-23-4` | `narrative` | story · narrator 田中さん | Told on the long bridge: the river that stopped travellers for days (〜のに today it is almost dry), 'even if it rains tomorrow we cross' (〜ても), the more you walk the more you notice (〜ば〜ほど), the Obon lanterns on the water; warm, unhurried. inference: why the river is low. |
| 23 |  | `s-23-5` | `weather` | story · narrator anchor | Obon-week forecast for the Ōi valley: dry weeks, river low, 三十四度, even if it rains tomorrow (降っても) the river will not rise; evening lantern event weather; 〜し listing reasons. number: expected rainfall or temperature. |
| 24 | **24 金谷 (Kanaya)** · 川越しの関守 River Crossing Keeper · green · N4 · 08/16 · Obon ends, hot afternoon in the river-crossing quarter · 〜んです, fillers, aizuchi · Green Shinsa | `s-24-4` | `phone` | dialogue · ケン · 野村さん | BOTH SIDES. Ken calls the river-crossing museum to ask whether the guided tour runs today (今日はやっているんですか); the volunteer guide explains at length with 〜んです and fillers (ええと、あのう); aizuchi from Ken (はい、ええ、そうですか). number: tour start time. |
| 24 |  | `s-24-5` | `narrative` | story · narrator 野村さん | Told by the retired guide (〜んです explanations, fillers): how porters carried travellers across the Ōi, why the river had no bridge, what a crossing cost; Green Shinsa consolidation of 16–24 grammar. detail: who was carried how. |
| 25 | **25 日坂 (Nissaka)** · 小夜の中山の関守 Sayo-no-Nakayama Keeper · blue · N3 · 09/23 · autumn equinox, red spider lilies, first cool evening · 〜わけ family; casual narration begins | `s-25-4` | `interview` | dialogue · 小林さん · ハナ | A town-paper writer interviews Hana about walking the Tōkaidō: why (〜わけだ／〜わけではない／〜わけにはいかない), what has changed in her, the diary; Hana answers in casual-polite. First interview; two voices. inference: what Hana does not say outright. |
| 25 |  | `s-25-5` | `narrative` | story · narrator ハナ | Hana's first CASUAL told narration: the Night-Weeping Stone legend told gently as 'a sad old story the town tells', the spider lilies, the first cool evening; no violence on the page; 〜わけ family in a telling voice. detail: what the stone is said to do. |
| 26 | **26 掛川 (Kakegawa)** · 秋風の関守 Autumn Wind Keeper · blue · N3 · 09/26 · dry autumn wind through the castle town, high clouds · 〜たびに/〜うちに/〜間に, 〜によって | `s-26-4` | `announcement` | story · narrator anchor | ANNOUNCEMENT WITH CHANGES: the castle-park loudspeaker — because of the wind (風によって) the keep closes at four, not five; the tea stall has moved to the gate; the garden path is closed while (〜うちに／〜間に) staff clear branches. number: the new closing time (old time as distractor). |
| 26 |  | `s-26-5` | `casual-talk` | dialogue · ハナ · ケン · 横山さん | At 横山さん's tea shop out of the wind: every time they rest Ken cooks (休むたびに), buy tea while it is cheap (安いうちに), while Hana slept (寝ている間に) Ken bought three bags; prices differ by grade (〜によって). speaker question across three voices. |
| 27 | **27 袋井 (Fukuroi)** · 出茶屋の関守 Teahouse Keeper · blue · N3 · 09/29 · warm and still, crown melons, the Tōkaidō midpoint · 〜に対して/〜について/〜として; Say It Three Ways | `s-27-4` | `voicemail` | story · narrator ミキ | VOICEMAIL WITH A TASK (story, narrator ミキ, casual-polite young voice, emotion per line): Hana left her diary at the teahouse; come by before six, or ミキ hands it to the regular 井上さん; call back about the melons. 'What must the listener do next' question. |
| 27 |  | `s-27-5` | `casual-talk` | dialogue · ハナ · ケン · 井上さん | BRIDGE (bridge: true, coverage 0.93, first authentic register): about the midpoint and crown melons (〜について／〜として), fillers and dropped particles, no heavy contractions yet; the elderly regular's slow turns vs Ken's quick ones. inference + speaker questions. |
| 28 | **28 見付 (Mitsuke)** · 天竜川の関守 Tenryū Keeper · blue · N3 · 10/02 · bright, the Tenryū fast after rain upstream, the white school · 〜ことになっている, 〜一方, compound verbs | `s-28-4` | `announcement` | story · narrator anchor | ANNOUNCEMENT WITH CHANGES: town broadcast by the Tenryū — the usual bridge is closed for repair today; crossing is by the north bridge (〜ことになっています); fishing boats cancelled while the river is high (一方); please do not swim. number: until what time the bridge is closed. |
| 28 |  | `s-28-5` | `interview` | dialogue · ハナ · 坂本さん (new: m 60s) | Hana interviews the keeper of the white wooden school about its 150 years: what the building is used for now, what is still forbidden, compound verbs (読み直す、書き直す、建て直す), 〜一方で; the town blackboard. detail: how old the school is. |
| 29 | **29 浜松 (Hamamatsu)** · 冬枯れの関守 Winter Field Keeper · blue · N3 · 10/06 · first cold north wind over rice stubble · 〜ものだ/〜べき, 〜はずがない; Monologue Marathon | `s-29-4` | `voicemail` | story · narrator ケン | VOICEMAIL WITH A TASK (story, narrator ケン, casual, emotion per line): he is at the market by the station; buy charcoal and come to 平野さん's farmhouse by five; 'a cook should taste first' (〜べきだ), 'it can't be that you are lost' (〜はずがない). Task question. |
| 29 |  | `s-29-5` | `interview` | dialogue · ハナ · 平野さん | Hana interviews the rice farmer in the stubble field: what farmers used to do in winter (〜ものだ), what young people should do (〜べきだ), why it cannot be that the harvest was bad (〜はずがない); the first cold north wind. number: how many fields or years. |
| 30 | **30 舞坂 (Maisaka)** · 今切の関守 Imagire Keeper · blue · N3 · 10/09 · clear, Lake Hamana silver at the strait, eel smoke · 〜っぽい/〜がち/〜げ, contractions receptive | `s-30-4` | `casual-talk` | dialogue · ハナ · ケン · 山田さん | BRIDGE, CONTRACTIONS (bridge: true): at the eel shop by the strait — 食べちゃう、置いとく、〜じゃん、〜んだって, 〜っぽい／〜がち／〜げ (眠そうな顔, 忘れがち); the owner's fast casual turns; aizuchi as real lines. speaker and inference questions. |
| 30 |  | `s-30-5` | `announcement` | story · narrator anchor | ANNOUNCEMENT WITH CHANGES at the strait boat landing: departure moved from 二時 to 二時半 because of the wind; delays are common in autumn (遅れがち); the lake-side path looks slippery (滑りやすそう); no boats after four. number: the new departure time. |
| 31 | **31 新居 (Arai)** · 新居関所の関守 Arai Checkpoint Keeper · blue · N3 · 10/10 · low autumn light on the preserved checkpoint · written vs spoken register · Blue Shinsa | `s-31-4` | `interview` | dialogue · ハナ · 吉田さん | Hana interviews the Arai checkpoint curator: the placard's written register (〜である、〜により、〜とされる) read aloud, then the same facts said plainly; what was inspected and why; Blue Shinsa consolidation. detail: what travellers had to show. |
| 31 |  | `s-31-5` | `voicemail` | story · narrator 田中さん | VOICEMAIL WITH A TASK (story, narrator 田中さん, polite-formal, emotion per line): the museum closes at four, bring the stamp card, meet at the gate at a quarter to; the clock on the museum wall is a minute off. Task + number question. |
| 32 | **32 白須賀 (Shirasuka)** · 潮見坂の関守 Shiomizaka Keeper · purple · N3 · 10/13 · very clear morning on Shiomizaka, the last faint Fuji · 〜ずにはいられない, 〜ないわけにはいかない | `s-32-3` | `news` | story · narrator anchor | Local news bulletin (formal, news grammar): the season's last Fuji sighting from Shiomizaka — visibility in km, the count of clear days this October, a quote from a walker who 'could not help stopping' (止まらずにはいられなかった); source named (the observatory). number: km or days. |
| 32 |  | `s-32-4` | `casual-talk` | dialogue · ハナ · ケン | WITH FILLERS: the call home that cannot be skipped (電話しないわけにはいかない) — Hana's mother's birthday (family unnamed), えっと／なんか／まあ, Ken teasing; the last faint Fuji behind them (fuji-watch pays off). inference: how Hana feels about home. |
| 33 | **33 二川 (Futagawa)** · 猿ヶ馬場の関守 Saru-ga-Baba Keeper · purple · N3 · 10/15 · grey and mild, the honjin museum quiet · formal connectives, news-style grammar | `s-33-3` | `drama` | dialogue · 清田さん · ハナ · ケン | Drama scene in the quiet honjin museum: a locked room, a key that should be on its hook, the lord's futon display, the curator's formal register against Ken's casual one; emotion per line (annoyed, whisper, glad). speaker questions across three voices. |
| 33 |  | `s-33-4` | `interview` | dialogue · 川村さん (new: f 40s) · 清田さん · 松井さん (new: m 60s) | INTERVIEW WITH TWO GUESTS: a community-radio host (named, not 'anchor') with the curator and the carpenter who restored the honjin: 〜によると、〜が明らかになった、〜とみられる in speech; costs, years, visitor numbers. number + speaker questions. |
| 34 | **34 吉田 (Yoshida)** · 豊川橋の関守 Toyokawa Bridge Keeper · purple · N3 · 10/17 · bright, the Toyokawa wide and slow under the long bridge · 〜に違いない/〜にすぎない; J-J definitions on | `s-34-3` | `casual-talk` | dialogue · ハナ · ケン · 岩田さん | WITH FILLERS at the udon counter: the misunderstanding that must be a joke (冗談に違いない), 'it is only noodles' (麺にすぎない), 岩田さん's deadpan; a J-J stem question from here (「本陣」とは{何\|なん}ですか with Japanese paraphrase choices). speaker question. |
| 34 |  | `s-34-4` | `news` | story · narrator anchor | Bulletin: a lane of the long Toyokawa bridge closed for inspection — hours, length in metres, detour minutes; a council quote (〜にすぎない); source named. One J-J definition stem among the questions. number: closure hours. |
| 35 | **35 御油 (Goyu)** · 旅籠の関守 Inn Keeper · purple · N3 · 10/20 · autumn rain beginning in the pine avenue · giongo, 〜ばかりでなく | `s-35-3` | `interview` | dialogue · 川村さん (new: f 40s) · 村上さん · 大久保さん (new: m 50s) | INTERVIEW WITH TWO GUESTS: the hatago keeper and a roof-tile craftsman on rain and old inns — sound words in speech (ザーザー、ポツポツ、ギシギシ), 〜ばかりでなく; the host keeps turns short. speaker + detail questions. |
| 35 |  | `s-35-4` | `drama` | dialogue · 村上さん · ハナ · ケン | Drama: a rainy night at the hatago — the kettle, footsteps on the corridor, a leak over Ken's futon, moving rooms at midnight; giongo in every scene beat; whisper and annoyed emotions. inference: who was awake. |
| 36 | **36 赤坂 (Akasaka)** · 宿の灯の関守 Lantern Inn Keeper · purple · N3 · 10/20 · the same rainy evening, lanterns at Akasaka · gitaigo, 〜最中に | `s-36-3` | `news` | story · narrator anchor | Bulletin: the lantern evening at Akasaka — how many lanterns, since what year, visitor counts, a shop owner quoted mid-sentence (準備している最中に雨が…); formal news grammar. number: lantern count. |
| 36 |  | `s-36-4` | `casual-talk` | dialogue · ハナ · ケン · 近藤さん | WITH FILLERS at the lantern inn: dinner interrupted (食べている最中に), gitaigo (そっと、ぽたぽた、ゆらゆら、ぐっすり), the innkeeper's stories, Ken half asleep; same evening as Goyu. speaker + inference questions. |
| 37 | **37 藤川 (Fujikawa)** · 棒鼻の関守 Bōbana Keeper · purple · N3 · 10/23 · crisp, persimmons, purple-barley fields being prepared · 〜向け/〜向き, 〜からには; Reduce & Expand | `s-37-3` | `drama` | dialogue · 藤井さん · ハナ · ケン | Drama at the Bōbana rest house: a leaflet mix-up — the one 'for walkers' (歩く人向け) vs 'for drivers', 'now that we have come this far' (来たからには), persimmons offered and refused and accepted; Tanaka-san may appear at the end. speaker questions. |
| 37 |  | `s-37-4` | `news` | story · narrator anchor | Bulletin: purple-barley planting around Fujikawa — hectares, the number of farms, the leaflet for visitors (観光客向け), a farmer quoted (〜からには); source named. Reduce & Expand later reuses it. number: hectares or farms. |
| 38 | **38 岡崎 (Okazaki)** · 矢矧橋の関守 Yahagi Bridge Keeper · purple · N3 · 10/26 · still golden afternoon on the Yahagi bridge, Hatchō miso · consolidation · Purple Shinsa | `s-38-3` | `casual-talk` | dialogue · ハナ · ケン | WITH FILLERS on the Yahagi bridge: Hana rereads her first diary pages aloud (the-diary thread), how she wrote then and now, the Hatchō miso smell, Ken's shop plans; Purple Shinsa consolidation of 32–38 grammar. inference: what has changed in Hana. |
| 38 |  | `s-38-4` | `news` | story · narrator anchor | Feature bulletin on Hatchō miso: cedar vats, years of ageing, river stones by count and weight, a quote from the brewery (〜に違いない), sources named. number: years or stones. |
| 39 | **39 池鯉鮒 (Chiryū)** · 馬市の関守 Horse Market Keeper · brown · N2 · 10/29 · cool and clear, the iris garden bare, dry leaves · 〜に限らず/〜をはじめ/〜次第 | `s-39-3` | `lecture` | story · narrator lecturer | Lecture (polite lecture voice): the Chiryū horse market and the Yatsuhashi irises — an old poem about irises (unnamed author), what travellers carried (〜に限らず、〜をはじめ), 'depending on the season' (〜次第); clear signposting (まず、次に、最後に). detail + inference. |
| 39 |  | `s-39-4` | `debate` | dialogue · 佐々木さん · ハナ · ケン | DEBATE: moderator 佐々木さん, two positions — carry less vs carry what you love (Ken's knife roll); claim vs support; 〜に限らず／〜次第で; the moderator restates each side. 'Which speaker said' + claim-vs-support questions. |
| 40 | **40 鳴海 (Narumi)** · 絞りの関守 Shibori Keeper · brown · N2 · 11/01 · mild, indigo smell in an Arimatsu shibori workshop · 〜ざるを得ない/〜かねる/〜得る | `s-40-3` | `phone` | dialogue · ケン · 小島さん | BUSINESS PHONE IN KEIGO: Ken calls the Arimatsu shibori workshop to ask about a noren for his future shop; 小島さん (70, blunt, Nagoya-area fillers) cannot promise a date (お約束しかねます), has to refuse rush orders (断らざるを得ない); Ken's humble forms. detail: what cannot be hurried. |
| 40 |  | `s-40-4` | `news` | story · narrator anchor | NEWS WITH NUMBERS AND SOURCES: the shibori district — four hundred years, number of workshops then and now, apprentice counts, a price range; two sources named; 〜得る in a quote. number questions with units. |
| 41 | **41 宮 (Miya)** · 熱田の関守 Atsuta Keeper · brown · N2 · 11/04 · first ginkgo yellow at Atsuta, cool and bright · 〜に越したことはない/〜のみならず; essay structure | `s-41-3` | `lecture` | story · narrator lecturer | Lecture: shrines and roads — a road is best with places to stop (〜に越したことはない), shrines were not only for prayer (〜のみならず), the seven-ri ferry from Atsuta; essay structure signposted (序論・本論・結論). inference: the lecturer's thesis. |
| 41 |  | `s-41-4` | `debate` | dialogue · 大西さん · ハナ · ケン | DEBATE: moderator 大西さん — cross Ise Bay by boat or by train? Positions, support, a concession each; 〜のみならず; the moderator summarises. Thesis-clause dictation target in the closing lines (clean clause boundaries). |
| 42 | **42 桑名 (Kuwana)** · 七里の渡しの関守 Seven-Ri Ferry Keeper · brown · N2 · 12/10 · cold and bright, Ise Bay choppy, clam shells · 〜につれて/〜に伴って/〜とともに | `s-42-3` | `news` | story · narrator anchor | News: clam season at Kuwana — catch figures over years (〜につれて), the bay's reed beds returning (〜に伴って), temperatures with the season (〜とともに); sources named. number: tonnes or years. |
| 42 |  | `s-42-4` | `phone` | dialogue · ケン · 石川さん (new: f 50s) | BUSINESS PHONE IN KEIGO: Ken asks a Kuwana restaurant owner to borrow her kitchen for one evening (borrowed-kitchens thread): お忙しいところ恐れ入ります、〜させていただけないでしょうか; terms, time, what he will cook. detail: what he offers in return. |
| 43 | **43 四日市 (Yokkaichi)** · 三重川の関守 Mie River Keeper · brown · N2 · 12/13 · cold clear night, factory lights across the water · 〜ものの/〜とはいえ/〜にしても; listening 1.2× | `s-43-3` | `debate` | dialogue · ハナ · 野口さん · リョウ | DEBATE AT 1.2×: Hana moderates at the ramen counter — is the factory night view beautiful? 野口さん says honest, not pretty (〜ものの、〜とはいえ), リョウ (late twenties, night shift) says beautiful anyway (〜にしても); fast casual turns. 'Which speaker said' questions. |
| 43 |  | `s-43-4` | `news` | story · narrator anchor | News: night-view tourism at the port — visitor numbers, boat tours per week, a resident quoted (〜とはいえ), sources named. number: visitors per year. |
| 44 | **44 石薬師 (Ishiyakushi)** · 薬師の関守 Yakushi Keeper · brown · N2 · 12/17 · still, grey, 5°C, dry leaves on the temple steps · 〜まい/〜ずじまい; extended monologue | `s-44-3` | `lecture` | story · narrator lecturer | Lecture: the Ishiyakushi temple and the village post town — population over forty years, what 'will not return' (〜まい), journeys left unfinished (〜ずじまい) as a theme; measured pace at 5°C. detail + inference. |
| 44 |  | `s-44-4` | `interview` | dialogue · ハナ · 田中さん | Hana interviews Tanaka-san (not his s-44-1 monologue; a formal Q&A): the walk he stopped here forty years ago, the friend, what he will not do again (〜まい), what he never got to say (言わずじまい); he finishes it with them. inference: why he keeps appearing. |
| 45 | **45 庄野 (Shōno)** · 白雨の関守 Sudden Shower Keeper · brown · N2 · 12/19 · a passing cold shower, then sun · 〜がてら/〜かたわら; business register | `s-45-3` | `phone` | dialogue · ハナ · 高木さん (new: m 30s) | BUSINESS PHONE IN KEIGO: Hana phones her former employer's office (never named) about a document — お世話になっております、〜の件につきまして、ご確認いただけますと幸いです; the clerk's keigo; she will post it 'while sightseeing' (観光がてら). detail: what she must send. |
| 45 |  | `s-45-4` | `weather` | story · narrator anchor | Weather with sources: the passing cold shower (時雨) — millimetres, minutes, the observatory named, sun after; 'working while watching the sky' (〜かたわら) in a farmer's quote. number: rainfall in mm. |
| 46 | **46 亀山 (Kameyama)** · 雪晴れの関守 Snow Clearing Keeper · brown · N2 · 12/23 · snow overnight clearing to blue, the Suzuka range white · Plateau Arc complete · Brown Shinsa | `s-46-3` | `debate` | dialogue · 中島さん · ハナ · ケン | DEBATE at Brown Shinsa pace: moderator 中島さん — is winter the best season to walk the old road? Snow, the white Suzuka range, the Plateau Arc ending; claim, support, rebuttal, summary. 'Which speaker said' + claim-vs-support. |
| 46 |  | `s-46-4` | `lecture` | story · narrator lecturer | Lecture: the Suzuka range, snow and the barrier towns — why the road climbed here, how travellers waited out snow, the castle's white turret wall; consolidation of 39–46 grammar. detail + number (metres, days). |
| 47 | **47 関 (Seki)** · 関の関守 Keeper of the Barrier · black · N1 · 12/31 · New Year's Eve and Day, frost, the temple bell, first sunrise · 〜べからず/〜んばかり/〜ごとく; literary register | `s-47-3` | `essay` | story · narrator reader | ESSAY READ ALOUD (literary voice): a New Year essay on the barrier town — frost, the bell, eaves 'all but touching' (〜んばかり), 'like a river of houses' (〜ごとく), an old prohibition (〜べからず) and what it forbade. Japanese-summary and tone questions. |
| 47 |  | `s-47-4` | `drama` | dialogue · ハナ · ケン · 田中さん | DRAMA, MULTI-SCENE: scene 1 the temple bell at midnight (whisper), scene 2 first sunrise down the street (glad), scene 3 the machiya museum sign; a one-line scene marker between scenes; the cat argument once. speaker + inference questions. |
| 48 | **48 坂下 (Sakashita)** · 筆捨山の関守 Fudesute Keeper · black · N1 · 01/04 · cold and dry, ice in puddles, Fudesute-yama bare · 〜をもって/〜といえども/〜ゆえに | `s-48-3` | `lecture` | story · narrator lecturer | Lecture (4–5 min): Fudesute-yama and the painter who threw away his brush — the legend, 'with this page' (〜をもって), 'even a master' (〜といえども), 'therefore' (〜ゆえに); the almost-vanished post town. detail + inference. |
| 48 |  | `s-48-4` | `debate` | dialogue · 西村さん (new: f 40s) · ハナ · ケン | DEBATE: moderator (new local) — should a diary be finished, or may it be abandoned? (the-diary thread: Hana nearly stops here) 〜といえども; Ken argues for stopping when it is done; the moderator restates. Claim-vs-support questions. |
| 49 | **49 土山 (Tsuchiyama)** · 春雨の関守 Spring Rain Keeper · black · N1 · 01/07 · cold rain on the Suzuka pass, seven-herb porridge · 〜ながらも/〜つつ/〜きらいがある | `s-49-3` | `essay` | story · narrator reader | ESSAY READ ALOUD: 'Rain at Tsuchiyama' — the old saying about the pass, walking while remembering (歩きつつ、思い出しつつ), wet yet content (濡れながらも), the tendency to carry too much (〜きらいがある). Tone + summary questions. |
| 49 |  | `s-49-4` | `drama` | dialogue · 本田さん · ハナ · ケン | DRAMA, MULTI-SCENE: scene 1 the seven-herb porridge kitchen, scene 2 the pass in rain, scene 3 the evening when Ken confesses he overpacks; the innkeeper's dry asides; emotion per scene. speaker + inference. |
| 50 | **50 水口 (Minakuchi)** · 干瓢の関守 Kanpyō Keeper · black · N1 · 01/10 · cold sun, the kanpyō shop, Lake Biwa's hills first seen · 〜に至る/〜を禁じ得ない/〜極まりない | `s-50-3` | `lecture` | story · narrator lecturer | Lecture: kanpyō — how gourd strips are peeled and dried in July, why only in summer, how the trade 'came to this' (〜に至る), numbers (strips per gourd, drying days). detail + number. |
| 50 |  | `s-50-4` | `debate` | dialogue · 田中さん · ハナ · ケン | DEBATE: Tanaka-san moderates — on a long road, photograph or write? Hana's feelings she cannot suppress at the first Biwa hills (〜を禁じ得ない), Ken's 'nothing is more tedious than…' (〜極まりない); summary by the moderator. 'Which speaker said'. |
| 51 | **51 石部 (Ishibe)** · 目川の関守 Megawa Keeper · black · N1 · 01/13 · frost then sun, dengaku grilling at the Megawa teahouse · 〜ずくめ/〜まみれ/〜なりに | `s-51-3` | `drama` | dialogue · 三浦さん · ハナ · ケン | DRAMA, MULTI-SCENE at the Megawa teahouse: scene 1 frost and the grill, scene 2 Ken mud-splashed to the knees (泥まみれ), scene 3 a day of nothing but good things (いいことずくめ) 'in its own way' (〜なりに); the cat's last-but-one appearance. speaker + inference. |
| 51 |  | `s-51-4` | `lecture` | story · narrator lecturer | Lecture: the Megawa teahouses — dengaku, bean rice, why travellers stopped here, how the quarter kept going 'in its own way' (〜なりに); numbers of teahouses then and now. detail + number. |
| 52 | **52 草津 (Kusatsu)** · 追分の関守 Fork Keeper · black · N1 · 01/16 · grey and cold at the fork of the two great roads · 〜とあって/〜ともなると/〜にかたくない; lecture-style | `s-52-3` | `debate` | dialogue · 岡本さん (new: m 60s) · ハナ · ケン | DEBATE: the local historian moderates — Tōkaidō or Nakasendō, which road would you take? 'being the junction' (〜とあって), 'when it comes to winter' (〜ともなると), positions with support and a concession. Claim-vs-support + 'which speaker'. |
| 52 |  | `s-52-4` | `essay` | story · narrator reader | ESSAY READ ALOUD: 'The Fork' — two roads meeting under a stone signpost, 'not hard to imagine' (〜にかたくない) the travellers who chose; the kerosene heater; the largest surviving honjin. Summary + tone questions. |
| 53 | **53 大津 (Ōtsu)** · 走井の関守 Hashirii Keeper · black · N1 · 01/19 · Great Cold, Lake Biwa steel-grey, the Hashirii spring unfrozen · consolidation, the last night before Kyoto | `s-53-3` | `lecture` | story · narrator lecturer | Lecture (4–5 min): Lake Biwa, the Hashirii spring and the last mile to Kyoto — the spring that never freezes, Hashirii mochi, distances and dates; consolidation vocabulary across the year; signposted. detail + number + inference. |
| 53 |  | `s-53-4` | `drama` | dialogue · ハナ · ケン · 田中さん | DRAMA, MULTI-SCENE, the last night: scene 1 the unfrozen spring, scene 2 the inn where Tanaka-san's watch and the clock finally agree, scene 3 dawn before Kyoto with the cat argument's last exchange; one scene marker line between scenes. speaker + inference; the 2-minute response prompt in recapEn's spirit. |

## 16. Writer self-check before returning the file

1. One JSON document, two items, ids `s-NN-4`/`s-NN-5` (4–31) or `s-NN-3`/`s-NN-4` (32–53), `stationId` `st-NN`, `type: 'story'`, `level` = the path's level, no `null`, no unknown keys (V01–V05).
2. Both pieces: `genre` legal at this station, `audioFirst: true`; a `story` has `narrator`, a `dialogue` has ≥ 2 speakers and no `narrator` (V25, V41).
3. Every `speaker` and `narrator` label is in §5.1's cast or in my `newCast` block (V42); `names` lists every local and place and each appears in a line (V25).
4. Every kanji in every `ja`, `titleJa`, `q` and (16+) choice is inside `{…|…}`; readings + plain text equal `kana` exactly (V11–V13); no ASCII digits, no Latin outside acronym rubies (V31).
5. `tokens` concatenate to plain `ja` on every line; no `tokenIds` (V19).
6. Through Station 15 every line ≤ 22 morae (I counted the kana without punctuation); from 16 every long line has 、 at clause boundaries (V41, §8.6).
7. Plain `ja` within the level's line cap; lines and seconds within the belt band; the pair ≈ 2 × the cap, never over (V14, V15, V45).
8. Every content word is in the allowlist or one of ≤ 3 `plusOne` (≤ 1 per line, each present in its line and in `vocabIds`); `grammarIds` ⊆ the grammar allowlist; coverage ≥ 0.97 / 0.95 / 0.93 (V20).
9. ≥ 3 questions, the first `gist`; every other question has a `kind` and a valid `lineRef`; `speaker` kind only in a dialogue; every `number` question states its unit and its choices share the format; English ≤ 15 with no Japanese characters, Japanese with ruby from 16; four distinct choices; the correct index varies (V21, V41).
10. `register` matches the majority of lines (V22); `bridge` only from 27 and only one per station; `learnerSpeaker` only on an RP piece, and then every ハナ line has `options` (one `best`), `mustInclude` and `accept`, NPC lines ≥ 12 chars mark an `aizuchiSlot` (V27).
11. One-sided `phone`/`voicemail` pieces: `kind: 'story'`, `narrator` = the caller, `emotion` on every line, each line one turn opening with an echo (§7).
12. Heard before read: no kanji pun, nothing carried only by the writing, numbers said in full with counters, quotes introduced audibly, one idea per line, punctuation `。、？！「」` only (§8).
13. Nothing denylisted; sources generic; no living person (V30).
14. `recapEn` ≤ 60 words; `titleEn` sentence case; `en` natural sentences (V15, V33).
15. The file is ≤ 220 KB and does not touch `stories-sNN.json`.

## 17. Validation — the exact commands

Run from the repo root (Node 26 runs the scripts directly; `--only` restricts the *report* to your file while the walk still reads the whole corpus, so a run takes a few seconds):

```sh
# 1. Structure, markup, counts, language rules (V01–V33, V41): no F allowed.
node scripts/validate-content.ts --only public/content/stories/n5/listening-s07.json

# 2. Strict: coverage V20 against the station bundles, quotas and placement V43, V45/V46 bands, cast V42 (reads scripts/audio/cast.json by default; `--cast <path>` to point elsewhere; an absent file warns "cast check skipped"). No F allowed; W rows go in your reply's notes.
node scripts/validate-content.ts --strict --only public/content/stories/n5/listening-s07.json

# 3. The integrator's run over everything, then the release step (writers do not run content:all).
npm run content:validate -- --strict
npm run content:all
```

Notes: `--only` takes a path relative to the repo or to `public/content/`, or a glob (`stories/n5/listening-*.json`). The strict run **writes `tokenIds` into the file on disk** (that is the linker's job, and the committed file carries them) — do not hand-edit or remove them afterwards, and never write them yourself. V43 warns about the station's piece count until both pieces are in the file; V42 fails in strict for a label that is not yet in `cast.json` — that is the `newCast` block's job, not yours to work around. The report rows are `{file, id, rule, message}`; fix only what they name and resend the same file.

## 18. Pass 4b — the Yellow example rewrite (design 08 §3, V46)

**Why.** The mined i+0 pool at Station 4 is two minutes long because only 13 / 17 / 29 / 58 / 62 / 91 of the 120 own-station vocab examples at Stations 4–9 are fully known at their own station. V46 requires that **every vocab item has ≥ 1 example whose content tokens all link inside the cumulative allowlist ≤ the item's `station`** (W during Pass 4b, F at release for Stations 4–15). Files: `vocab-n5-001 … 004` (Stations 1–11); ≈ 450 examples.

**What you receive.** The same validated file; the cumulative allowlists `docs/allowlists/station-04 … 11.json` (use the `surfaces` map — it is the exact spelling set the linker knows); the V46 rows from `node scripts/validate-content.ts --strict --only public/content/vocab/n5/vocab-n5-00N.json` and the never-all-known list from `node scripts/listening-report.ts` (the station of each item is its `station` field).

**What you change — and only this.**

1. For every flagged item, **rewrite one existing example** so every content token is known at or before the item's own station. Prefer rewriting `examples[1]` and keeping `examples[0]` when it is the gold collocation example of guide §11; rewrite `examples[0]` when `examples[1]` is the better teaching sentence. Never add a third example, never delete one (V14 needs ≥ 2), never reorder items, never change ids, `station`, `meanings`, `pos`, `tags`, `pitch`, `notes`, `collocations` or any other field.
2. **Keep the meaning the gloss teaches**: the example still shows the item in its first `meanings` sense and its usual frame; `en` is rewritten only so that it matches the new `ja` (§6: natural sentence, sentence case, final punctuation).
3. **Keep the target present** (V16: `word`, an `altForms` entry, `kana`, or the inflection stem for `v1 v5 adj-i n-suru`). The item's own word is the one thing that may be new at its station; everything else must already be known.
4. **Companions come from the allowlist ≤ `station`**: function tokens, kanji numerals, cast names ハナ／ケン／アオ／田中さん (the sentence linker knows them), counters only if their item is at or before the station, no place names, no later-station words. The §8 rule still holds — the target is never the only content word; at Station 4 pick companions from the White set (私, 人, 先生, 友達, greetings, はい／いいえ) and the Station 4 list.
5. **Markup and length as before**: ruby on every kanji (§4), `kana` reconstructing exactly (V13), plain `ja` ≤ 25 characters and ≤ 14 words (V15), no ASCII digits (V31), polite register — ≈ 0 % casual in these four files (V22) — natural modern Japanese (§8), the two examples still differing in frame, subject and tense (the Pass 3 rule). **Write content verbs in kanji with ruby** (`{食|た}べます`, not たべます) so the linker links the inflection; a kana-only spelling that is merely the reading of a kanji word may not link.
6. Items at Stations 1–3 (the White set, items 1–80 of `vocab-n5-001`) are W-only under V46: do what the 80-word White set allows (a whole greeting, はい／いいえ answers, a count) and move on.

**Done when** the strict run reports no V46 row for the file's Station 4–15 items, V13/V15/V16/V22/V31 are clean, and `scripts/listening-report.ts` shows the own-station all-known share ≥ 50 % at every station the file covers (acceptance: the Yellow i+0 pool ≥ 12 minutes at every station 4–9).

```json
// before (v-n5-0144 晩, station 5): 昨日の晩は家族とテレビを見ました — 家族 and テレビ are later-station words
{ "ja": "{昨日|きのう}の{晩|ばん}は{家族|かぞく}とテレビを{見|み}ました。", "kana": "きのうのばんはかぞくとテレビをみました。", "en": "Last night I watched TV with my family." }
// after: every companion known at Station 5, same sense (evening), target present, polite, ≤ 25 chars
{ "ja": "{今日|きょう}の{晩|ばん}は{七時|しちじ}に{食|た}べます。", "kana": "きょうのばんはしちじにたべます。", "en": "This evening we eat at seven." }
```

(The "after" line is illustrative — confirm each companion against `station-05.json`'s `surfaces` before you use it.)

## Appendix A — a Yellow one-sided `phone` piece, abbreviated

```json
{
  "id": "s-08-4", "stationId": "st-08",
  "titleJa": "{浜辺|はまべ}から{電話|でんわ}", "titleEn": "A call from the beach",
  "kind": "story", "register": "polite", "genre": "phone", "audioFirst": true, "narrator": "ケン",
  "names": ["大磯"],
  "lines": [
    { "ja": "もしもし、ケンです。", "kana": "もしもし、ケンです。", "en": "Hello, this is Ken.", "tokens": ["もしもし", "、", "ケン", "です", "。"], "emotion": "neutral" },
    { "ja": "{今|いま}、{大磯|おおいそ}の{浜辺|はまべ}にいます。ハナもいます。", "kana": "いま、おおいそのはまべにいます。ハナもいます。", "en": "I'm at the beach at Ōiso now. Hana is here too.", "tokens": ["今", "、", "大磯", "の", "浜辺", "に", "います", "。", "ハナ", "も", "います", "。"], "emotion": "neutral" },
    { "ja": "はい、{二人|ふたり}です。", "kana": "はい、ふたりです。", "en": "Yes, two of us.", "tokens": ["はい", "、", "二人", "です", "。"], "emotion": "neutral" },
    { "ja": "{七時|しちじ}ですね。はい、わかりました。", "kana": "しちじですね。はい、わかりました。", "en": "Seven o'clock, right? Yes, understood.", "tokens": ["七時", "です", "ね", "。", "はい", "、", "わかりました", "。"], "emotion": "glad" }
  ],
  "vocabIds": ["v-n5-…"], "grammarIds": ["g-n5-…"],
  "comprehension": [
    { "q": "What is this call about?", "choices": ["Booking dinner at the inn", "Buying fish", "Asking the way to the station", "Finding the cat"], "answer": 0, "kind": "gist" },
    { "q": "What time is dinner?", "choices": ["6:00", "7:00", "8:00", "1:00"], "answer": 1, "kind": "number", "lineRef": 3 },
    { "q": "How many people are coming?", "choices": ["One", "Two", "Three", "Four"], "answer": 1, "kind": "detail", "lineRef": 2 }
  ],
  "recapEn": "Ken phones the Ōiso inn from the beach: two guests, dinner at seven, Hana is with him."
}
```

Each line is one turn of the caller; the unheard clerk speaks between lines 1–2, 2–3 and 3–4 (the echoes 二人です and 七時ですね give the listener the other side). Every line is ≤ 22 morae and every number question states its unit. A real piece has 14–16 lines.

## Appendix B — quick reference

- `LISTENING_GENRES`: exchange · self-intro · phone · directions · voicemail · casual-talk · narrative · announcement · weather · interview · news · drama · debate · lecture · essay.
- `LineEmotion`: neutral · warm · annoyed · sad · glad · whisper.
- `QuestionKind`: gist · detail · number · speaker · inference.
- Narrator role labels: `anchor` (news / announcements / weather) · `lecturer` · `reader`.
- Coverage targets: 0.97 (4–28) · 0.95 (29–38) · 0.93 (39–53, any bridge).
- Line caps (plain chars): 38 (N5) · 53 (N4) · 68 (N3) · 90 (N2) · 120 (N1); ≤ 22 morae through Station 15.
- Speech estimate: Σ kana chars ÷ 7 + 0.5 s × lines; pair within ±30 % of 2 × belt cap (60 / 90 / 120 / 180 / 180 / 240 / 300 s).
- Questions: English ≤ 15, Japanese with ruby from 16; gist first; `lineRef` 0-based; `speaker` only in dialogues; J-J stem allowed from 34.
