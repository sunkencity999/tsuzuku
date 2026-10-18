# TSUZUKU — 03 · Sessions and the Daily Loop

## 1. The nested loop

```
REP      3–8 s    prompt → retrieve → answer → instant, tagged feedback → ki/combo tick
BOUT     1–3 min  10–20 reps sharing a combo meter; ends with a mini-tally
SESSION  3/10/30  warm-up → (new material) → sparring → (input) → (output) → cooldown → つづく card + 次回予告
DAY      —        Tsuzuku Flame, Three Kata (daily quests), Michikusa fragment, ledger prompt
WEEK     —        Kage ghost set (Mon), strand-share balancing, Weak Point sweeps
ARC      2–5 wk   Station → Gatekeeper → goshuin stamp → wallpaper quadrant
SAGA     3–6 mo   Belt → Shinsa → ceremony → Masterwork wallpaper
LIFETIME —        total training days, Dan road, 続く者
```

The rep loop is the fighting-game training mode. The session is a roguelike run (variable contents, fixed rules, always finishable). The arc/saga is the JRPG overworld.

**Day boundary: 04:00 local.** A 1 AM session credits the day you intended. Any completed session of any size counts as a training day.

A card missed three times in one run stops returning (no further +3 / +10 / relearn re-queue; FSRS has it for tomorrow); the feedback line says so.

---

## 2. Three session sizes

All three open with easy items and close with easy items (peak-end rule). All three end on the つづく card. The learner picks a size on the Dojo; the forecast line shows what each will contain.

### 2.1 Kata (型) — 3 minutes, "phone out, in line"
- 15–25 due reviews only, no new items. Ordered by **overdue-days × (1 − R)** descending regardless of maturity, so the fragile overdue learning-state cards come first; the speed ring appears only on cards the card-level rule allows (§2.4).
- Opens with 3 easiest (highest retrievability), closes with 2 easiest.
- Exactly one **Michikusa** (道草, a 10-second roadside fragment: etymology, proverb, culture, pitch fact) between reps 8 and 9.
- Keeps the streak; counts as a training day (the Three Kata quests, §6, decide the Full Training Day). The pre-roll total reads "~N reps · ~M min": N includes the +3 / +10 steps new cards owe and M adds ~15 s per teach card, so the estimate matches what the run will actually serve. Quest copy never calls a session "a Kata": the session is 型, the quests are 三つの型.

### 2.2 Kumite (組手, sparring) — 10 minutes
| Block | Minutes | Content |
|---|---|---|
| Warm-up | 3 | 15–20 due reviews, easiest 3 first |
| Scroll (巻物) | 3–7 | **1–2 lessons** (2 when today's new-item budget is unmet); Scroll size scales by belt: White–Green **6–8 vocab** or **1 grammar point** or **3 kanji**, Blue+ **8–10 vocab** or 1 grammar or **4 kanji**; **Chikaradameshi** (力試し) pretest of 3 items *before* teaching ("miss these; that's the point"); each item tested within 30 s of introduction — one immediate check on its base facet plus one for every other facet it is born with (kana production → Kana Ear), so recognition and production both start the day the kana is taught |
| Sparring | 3 | 15 reps interleaving new (+3 / +10 in-session steps) and due; ≥ 2 listening reps where available |
| Output | 1.5 | one shadow set (3 lines) **or** one role-play turn (from Station 7) — the Kumite's output micro-block |
| Cooldown | 0.5 | 3 easy reps, tally, つづく, 次回予告 |

A Kumite therefore runs 10–14 minutes depending on the Scroll block.

### 2.3 Shugyō (修行, training arc) — 30 minutes
| Block | Minutes | Content |
|---|---|---|
| Warm-up | 1.5 | 3 known sentences shadowed (primes the mouth) |
| Reviews | 8–12 | due reviews up to the daily cap; wave-ordered |
| Scrolls | 8–14 | 2–4 lessons with pretests (belt-sized Scrolls, §2.2), enough to meet the day's new-item budget |
| Input | 5 → 12 | **Tabi Nikki** episode (coverage-gated) **or** a listening block, alternating by the weekly strand ledger. The listening block rotates **unheard audio-first piece → dialogue → Ear Walk** (a `listening-set` in pool mode over i+0 / i+1 sentences from `listening/pool-NN.json`, design 08 §10.4 / §11), never the same genre twice in a row (derived from `progress.listened`), heard texts ordered by last hearing, and a text the Arena passed within the last 14 days (`progress.arenaAt`, `ARENA_RECENT_DAYS`) closed while another candidate is open; the 茶屋ラジオ Radio is not a session block (never a training day, design 08 §10.2). Minutes scale by belt: White–Orange 5 · Green 7 · Blue–Purple 9 · Brown+ 12 |
| Output | 3 → 7 | rotates: Role-play · Shadow set · Say It Three Ways · Monologue · Writing Dojo (by belt availability); minutes scale by belt: White–Orange 3 · Green 4 · Blue–Purple 5 · Brown+ 7 |
| Weak Point set | 0–3 | only if an error tag's EWMA > 20 % with n ≥ 15 (`05 §7`) |
| Cooldown | 1 | easy reps, tally, ledger prompt, つづく, 次回予告 |

The Shugyō grows from ≈ 30 min (White–Orange) to ≈ 45 min (Brown+) so the §5 strand shares are reachable from the templates alone.

Optional replacements: a **Gatekeeper** (12–15 min) replaces Input + Output when the station is complete; a **Shinsa** (20–25 min) is its own session type; the weekly **Kage** set (5 min) can replace Output on Mondays.

### 2.4 Composer invariants (`src/learn/queue.ts` + `src/session/builder.ts`)
- Items ordered by predicted retrievability into a wave `E E E H M H M H M H E E` (E easy ≥ 0.9, M 0.8–0.9, H < 0.8).
- No item (any facet) within 4 reps of itself **except learning steps (+3 / +10) and Recovery re-queues**; no more than 3 consecutive reps of the same exercise type; facets alternate where possible; `listen` reps never follow `listen` reps of the same word. `queue.test.ts` mirrors exactly this wording.
- New items are re-presented at +3 and +10 reps (short-term steps) before FSRS takes over.
- Reviews never drop below 60 % of due when a session is time-fitted; Input and Output shrink last.
- A card is **mature** when the facet being tested has S ≥ 14 d (`learn/grading.ts isMature`, the one definition used everywhere). Learning-state cards are never timed; mature cards show the speed ring only in Dojo/Arcade presets.

---

## 3. Morning page and forecast

Opening the app shows the Dojo with one line: *"42 reviews · 1 scroll · 1 episode · ~18 min."* Predictable workload reduces avoidance. The line is computed from due counts × per-type median latency + fixed block estimates, on one basis: the day's due count and the Shugyō's Scroll count are paired with the Shugyō minutes (not the Kumite's); with no Scroll to teach today the Scroll-block minutes come off every estimate and the new-item count reads 0.

---

## 4. Daily targets and intensity

| Knob | Casual 気楽 | Standard 一歩一歩 | Intense 修行 |
|---|---|---|---|
| New items/day (N5 example; belt rates in `02 §6.1`) | 5 | 8.75 | 16 |
| Review cap/day, **belt-scaled** (White–Orange → Green → Blue–Purple → Brown–Black) | 80 → 110 → 130 → 170 | 160 → 200 → 240 → 320 | 300 → 360 → 420 → 540 |
| Desired retention | 0.85 | 0.90 | 0.90 |
| Expected minutes/day (N5 → N2; derivation in `02 §6.1`) | 15–35 | 25–60 | 45–95 |

Caps are sized so that the `05 §2` steady-state review load of every belt × preset fits under the cap with headroom; `learn/governors.ts` exposes `capFor(preset, belt)` and `governors.test.ts` asserts `steadyStateReviews(rate, retention) ≤ capFor(preset, belt)` for every cell. `Settings.maxReviews` stores the White–Orange base; a custom intensity scales the same way.

Intense shows the projected steady-state review load before it is confirmed ("≈ 400 reviews/day in a year. Sure?").

New-item mix at Standard N5: 7 vocab : 1 kanji : 0.75 grammar; kanji unlock only when all components are Green; grammar in station order. From Green, up to 40 % of the vocab budget may come from words the learner captured while reading (Second Wind).

---

## 5. Governors

**Load Governor / Backlog mode.** If due > 2 × review cap, new items pause, only `cap` reviews are shown (most overdue, lowest retrievability first), and the copy says: *"The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty."* The Forge Bar is replaced by the honest count. FSRS reschedules overdue cards without penalty.

**Adaptive new rate.** The accuracy threshold is relative to the learner's own retention setting, so a Casual learner at 0.85 is not governed by construction: the new rate halves when **acc7 < desiredRetention − 0.07** (0.78 Casual, 0.83 Standard) over **≥ 50 reviews** in the window, or when backlog > 1.2 × cap; it is restored when acc7 ≥ desiredRetention − 0.03 for 3 consecutive days **and** backlog ≤ 1.2 × cap (hysteresis; `governor()` and `governors.test.ts`).

**Cramming cap.** New-item introduction stops at 2 × the daily target. Reviews, stories, listening, output and Rapid Fire remain available at full XP: *"Enough new words for today. The dojo will be here tomorrow."*

**Overtraining note.** At **1.5 × the preset's expected daily maximum** (Casual ≈ 50, Standard ≈ 90, Intense ≈ 140 in-app minutes in a day) the end card adds one line: "Spaced beats massed. Tomorrow counts more than more today." Never a nag to continue.

**Weekly strand shares.** Target share of minutes by strand, enforced per week not per session (a pure-reading Sunday is legal). The composer biases Input/Output block choice toward the strand most below target; the belt-scaled Input/Output minutes in §2.2–2.3 make every row below attainable from the templates.

| Belt | Form-focused (SRS, scrolls, drills) | Input (stories, listening) | Output (speaking, role-play, writing) |
|---|---|---|---|
| White–Orange | 60 % | 25 % | 15 % |
| Green | 50 % | 32 % | 18 % |
| Blue–Purple | 40 % | 38 % | 22 % |
| Brown | 30 % | 45 % | 25 % |
| Black | 25 % | 45 % | 30 % |
| Dan | 15 % | 50 % | 35 % |

---

## 6. Three Kata (三つの型) — daily quests

Three quests per day chosen deterministically from `hash(seed, day)` with a variety constraint (never two from the same strand). Pool of **17** (`QUEST_IDS`; availability by belt in `04`): clear all due (or 50) · learn a Scroll · read an episode · 5 shadow lines · reach a 20 combo · 5 dictation lines · 3 Form Chains · 5 Nemesis reps · 5 Pitch Ear items · one Rapid Fire run · one Michikusa read · one Speed Read · one role-play with all aizuchi slots hit · one Say It Three Ways · log 20 minutes of outside input · one Weak Point set · one Writing Dojo piece.

All three done = **Full Training Day**: +50 XP, the flame turns gold. Quests never require more than ~12 minutes beyond reviews.

Stations 1–2 offer **two** Kata, not three: only the form (`learn-scroll`) and input (`michikusa-one`, `outside-twenty` — the ledger exists from the first save) strands have a quest before Station 3, where the output strand's first quest `shadow-five` arrives with `shadow` (`04 §13`), and the variety rule forbids two from one strand. Full Training Day = both. A quest nothing can advance today (no Scroll left, fresh-fragment pool exhausted) is meant to be gated out of the draw (`setQuestGates`), keeping a quest already done today; the session-side wiring is still open.

---

## 7. The Tsuzuku Flame — streaks with forgiveness built in

| Rule | Spec |
|---|---|
| A day counts | any completed Kata or larger, or ≥ 20 reviews |
| Full day | all Three Kata; gold flame (plain day = orange flame; both continue the streak) |
| Dawn grace | day boundary 04:00 local |
| **Freeze tokens 氷** | earn 1 per 7 streak days, hold up to 3, auto-applied on a missed day ("Rest is training") |
| **Planned rest 休み** | up to 1 fixed rest day per week in settings; never breaks the streak; shown as a planned pause ("Even samurai rest") |
| **Ember 残り火** | with no tokens, a missed day turns the flame to embers for 48 h; one Kumite or larger restores it fully |
| **Nanakorobi Yaoki 七転八起** | if the streak does break, practice 3 of the next 5 days and the previous count is restored. One repair per 30 days. Free. |
| **Weekly Flame** | parallel counter of weeks with ≥ 5 active days; a single missed day cannot zero it |
| **Vacation** | up to 30 days/year; flame frozen; backlog spread over 7 days on return |
| Identity | header shows *Total training days* in the same type size as the streak ("412 days trained · 3-day streak") |
| Notifications | none (static site). Optional `.ics` daily reminder download, neutral title "The dojo is open." |

Nothing is ever taken away: badges, wallpapers, levels, belts and total days never decrease.

---

## 8. Welcome Back

- **7–29 days away ("Back from the Mountain" 山から戻る):** backlog spread evenly over the next 7 days; new items paused for 2 days; no shame screen: *"The dojo kept your place."*
- **30+ days away:** the first session is a **Welcome Back** set: 20 items the scheduler predicts you still know (highest retrievability), so the first session back is a win; then the 復活 Comeback badge and the おかえり Welcome Back (`okaeri`) wallpaper.

---

## 9. Zen and the feel presets

Zen (禅) hides timers, ki, combo, glow and sound; scheduling and XP are identical; 30 Zen sessions earn a badge. Dojo is the default calm preset; Arcade is opt-in. Full spec in `01 §6`.

---

## 10. The つづく end card and 次回予告

Every session, every size, ends on a black card (`--bg` sumi) with つづく in Yuji Syuku and a 1.2 s rising gliss. Below it, in order:

1. **Tally** — reps, accuracy, best combo, Ippon count, item promotions (belt flips animate), XP earned, quests ticked.
2. **次回予告 Jikai Yokoku (next-episode preview)** — three lines, all informational, no countdowns:
   - *One sentence from your next Tabi Nikki episode* with exactly one word rendered as ???: the composer picks the sentence in the next episode with the fewest not-yet-introduced tokens and masks the first of them; if none, it masks a word due tomorrow.
   - *Three words you will meet tomorrow* (from the next Scroll), in kana with no gloss.
   - *"The Gatekeeper of Totsuka awaits in about 4 days"* (from Projected Arrival), or the next belt exam, or the next Kage Monday.
3. **Ledger prompt** (one tap, dismissible): "Outside input today? +20 min anime / podcast / reading / conversation."
4. Closing line: "Good training. Rest."

Day 1 of a Welcome Back omits the tally comparison and shows only the preview.

---

## 11. Kage (影) — the ghost rival and the weekly test

Every Monday (ISO week, seeded by `hash(seed, isoWeek)`) a 30-item **Ghost Set** is sampled:

- 15 items introduced in the last 14 days (the testing effect: sampled regardless of FSRS due dates), graded normally and logged as reviews.
- 15 **mature** items (the tested facet S ≥ 14 d, `03 §2.4`), where the **speed index** is also measured.

Score = accuracy on all 30 × speed index on the mature 15 (speed index = clamp(median personal latency / observed, 0.5, 1.5)). You beat the Kage when you beat your own best of the last 4 weeks. The versus screen shows your name against your own silhouette; beneath sits a hi-score table labelled **"Factory defaults"**: its rows are derived from the learner's own first result (× 0.6 … × 1.1, initials in katakana) and are replaced by the learner's weekly history as it accrues — never fabricated rivals. Beating the Kage: +60 XP; after a win the Kage silhouette sits in the Dojo's corner until next Monday. Running the Ghost Set counts as a training day for the streak and may replace the Output block in a Shugyō.

---

## 12. Session end states

- **Finished:** tally + つづく. The Hanko Button becomes "Another Kata?" only if due reviews remain; otherwise it reads "Rest."
- **Interrupted** (tab closed, phone locked): state is flushed on `visibilitychange`; the next open offers "Resume (6 reps left)" or "Start fresh"; a resumed session still earns its つづく card.
- **Backlog day:** the card says how many waited "without penalty" and does not show the backlog as a red number anywhere.
