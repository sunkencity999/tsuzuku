# TSUZUKU — 02 · Progression: the Tōkaidō, Belts, Dan, XP

Two axes, kept deliberately separate and stated in the UI as **"Level = effort. Belt = skill."**

- **Belt / rank** (kyū → dan) is earned only by mastery coverage plus a Shinsa exam. XP cannot buy a belt.
- **Level** (Lv 1–99) is earned by XP. Continuous, cosmetic, never gates content.

---

## 1. The road: Station 0 → 53 → Sanjō Ōhashi

The curriculum is the historical Tōkaidō. **Station 0 Nihonbashi (日本橋)** is onboarding (name, kana check, pace, honest timeline). Stations 1–53 are chapters; each ends at a **Gatekeeper (関守)**. The final belt exam for Black is taken at the arrival point, **三条大橋 Sanjō Ōhashi** (Kyoto). Each belt's Shinsa is taken at its last station after that station's Gatekeeper.

**The name step at Nihonbashi.** The learner arriving here has zero Japanese, so the field is a plain English input — never the drill IME — labelled "Your name", with one helper line: Japanese writes names from abroad by their sound in katakana (カタカナ); type your name as you usually write it and the dojo suggests the katakana. While the text holds Latin letters the first word is looked up live (case- and accent-insensitive) in the names dictionary (`src/app/names`: 1,043 English given names → the katakana Japanese media use, each with the romaji that types it); a match shows the katakana large, a sound-it-out guide (ku・ri・su・to・fa・ー), "This is how Japan writes Christopher." and a "Use クリストファー" button — Enter accepts it too, and with nothing to accept Enter is Next. Accepting puts the katakana into the field ("Your dojo name: クリストファー") with Change to get the Latin spelling back. No match says so and offers two ways on: **Type it by sound** (the katakana IME with a four-line guide — the vowels and the ka row, `-` → ー, nn → ン, kurisutofa- → クリストファー — letters still waiting for a vowel explained inline, Back to English) or **Keep ‹Name› in English** ("We’ll write it as you do; your scrolls will say ‹Name›."). Pasted kana is accepted as it is; blank trains as 無名 Mumei. Saved: `profile.name` is the display name (the katakana, the Latin spelling, or 無名) and `profile.nameKana` is that name only when it is pure kana, else `''` — Latin letters are never written as kana, and every piece of art falls back to `name` (a Latin name is set in the brush / mincho / pixel / neon faces, whose `base` slices carry Latin). The whole draft survives Back; both fields are cut to `NAME_MAX_GLYPHS` (24 code points). Implementation note (post-launch fix 1, 2026-10-17): the launch build showed the IME itself here, so "Christopher" became chリsトpヘr and was saved as kana; `OnboardingPage` now renders `<NameField>` (`src/app/names/NameField.tsx`) and `resolveName` / `isKanaName` decide what `finish()` writes.

Content per station is fixed by the V1 scope (vocab 6,350 · kanji 1,000 · grammar 450 · kana 238 · stories 137 · components ≈ 250 · Michikusa 212). Station assignment of individual items is done by `scripts/assign-stations.ts` after Pass 1 lists exist (frequency order within level — `frequencyRank` when present, else corpus order; kanji only after all their components; grammar in syllabus order). **Components** are SRS items too: each lands one station ahead of the first kanji that uses it (the N5 set across Stations 2–3 beside the kana), so the Green gate on components never stalls a station's kanji (`05 §3`).

Stories column: V1 ships **3** texts per station for Stations 1–31 (episode + dialogue + a short standalone piece) and **2** for Stations 32–53 (episode + dialogue; from Station 27 one of them may be a `bridge` passage), so the Blue–Black learner always has input to meet the Breadth Campaign words in. Gatekeeper names are original; the themes come from the public-domain geography and folklore of each post town.

| # | Station | Romaji | Belt | JLPT | Vocab | Kanji | Gram | Stories | Gatekeeper (関守) · theme |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 品川 | Shinagawa | White | kana | 20 | 0 | 0 | 3 | 潮の関守 Tide Keeper · hiragana 46 + dakuten/handakuten (71 kana) |
| 2 | 川崎 | Kawasaki | White | kana | 20 | 0 | 0 | 3 | 渡しの関守 Ferry Keeper · hiragana yōon, っ, long vowels, katakana 46 (79) |
| 3 | 神奈川 | Kanagawa | White | kana | 40 | 0 | 0 | 3 | 湊の関守 Port Keeper · katakana dakuten/yōon/extended (88), mora & pitch bootcamp |
| 4 | 保土ヶ谷 | Hodogaya | Yellow | N5-A | 60 | 8 | 8 | 3 | 坂の関守 Hill Keeper · です/は/も, これ・それ・あれ, か |
| 5 | 戸塚 | Totsuka | Yellow | N5-A | 60 | 8 | 8 | 3 | 夜明けの関守 Dawn Keeper · numbers, time, から〜まで, の |
| 6 | 藤沢 | Fujisawa | Yellow | N5-A | 60 | 8 | 7 | 3 | 松林の関守 Pine Grove Keeper · ます/ません/ました, を/で/に/へ/と |
| 7 | 平塚 | Hiratsuka | Yellow | N5-A | 60 | 8 | 8 | 3 | 七夕の関守 Tanabata Keeper · い/な adjectives, とても/あまり; first aizuchi (はい/ええ/そうですね) |
| 8 | 大磯 | Ōiso | Yellow | N5-A | 60 | 8 | 7 | 3 | 浜辺の関守 Shore Keeper · あります/います, counters 〜つ/〜人/〜枚/〜本 |
| 9 | 小田原 | Odawara | Yellow | N5-A | 60 | 8 | 7 | 3 | 城下の関守 Castle Town Keeper · 〜ましょう/〜ませんか, 〜たい, 〜をください · **Yellow Shinsa** |
| 10 | 箱根 | Hakone | Orange | N5-B | 60 | 9 | 8 | 3 | 大関所の関守 Great Checkpoint Keeper · て-form (Form Forge I), 〜てください, 〜ています |
| 11 | 三島 | Mishima | Orange | N5-B | 60 | 9 | 8 | 3 | 湧水の関守 Spring Keeper · 〜てもいい/〜てはいけない, 〜から/〜が/でも |
| 12 | 沼津 | Numazu | Orange | N5-B | 60 | 9 | 7 | 3 | 港市の関守 Harbor Market Keeper · plain forms (dictionary/ない/た/なかった), 〜と思う |
| 13 | 原 | Hara | Orange | N5-B | 60 | 9 | 8 | 3 | 富士見の関守 Fuji-View Keeper · 〜前に/〜後で/〜てから/〜ながら, 〜たことがある |
| 14 | 吉原 | Yoshiwara | Orange | N5-B | 60 | 8 | 7 | 3 | 左富士の関守 Left-Fuji Keeper · potential, 〜ことができる, あげる/もらう/くれる |
| 15 | 蒲原 | Kanbara | Orange | N5-B | 60 | 8 | 7 | 3 | 雪夜の関守 Snowy Night Keeper · 〜たら/〜と/〜ば/〜なら, 〜なければならない · **Orange Shinsa (N5)** |
| 16 | 由比 | Yui | Green | N4 | 72 | 22 | 10 | 3 | 薩埵峠の関守 Satta Pass Keeper · transitive/intransitive pairs, 〜てしまう, 〜ておく |
| 17 | 興津 | Okitsu | Green | N4 | 72 | 22 | 10 | 3 | 清見の関守 Kiyomi Keeper · 〜ていく/〜てくる, 〜てみる, imperative/〜な/〜なさい |
| 18 | 江尻 | Ejiri | Green | N4 | 72 | 22 | 10 | 3 | 突風の関守 Gust Keeper · passive, causative, causative-passive (Form Forge II) |
| 19 | 府中 | Fuchū | Green | N4 | 72 | 22 | 10 | 3 | 駿府の関守 Sunpu Keeper · 〜そうだ (hearsay/appearance), 〜ようだ/〜みたい, 〜らしい |
| 20 | 鞠子 | Mariko | Green | N4 | 72 | 22 | 10 | 3 | とろろ汁の関守 Tororo Keeper · 〜ように/〜ために, 〜ようになる, 〜ことにする |
| 21 | 岡部 | Okabe | Green | N4 | 72 | 22 | 10 | 3 | 宇津ノ谷の関守 Utsunoya Pass Keeper · keigo basics (お〜になる/お〜する), 〜ていただけませんか; register switching begins |
| 22 | 藤枝 | Fujieda | Green | N4 | 72 | 22 | 10 | 3 | 継立の関守 Relay Keeper · 〜かどうか, embedded questions, 〜はず/〜ばかり/〜ところ |
| 23 | 島田 | Shimada | Green | N4 | 72 | 22 | 10 | 3 | 大井川の関守 Ōi River Keeper · 〜ても/〜のに, 〜し, 〜ば〜ほど |
| 24 | 金谷 | Kanaya | Green | N4 | 74 | 24 | 10 | 3 | 川越しの関守 River Crossing Keeper · 〜んです, conversation strategies (fillers, aizuchi set) · **Green Shinsa (N4)** |
| 25 | 日坂 | Nissaka | Blue | N3-A | 121 | 25 | 8 | 3 | 小夜の中山の関守 Sayo-no-Nakayama Keeper · **壁の章 Plateau Arc begins**: Native Bridge passages, 〜わけ family |
| 26 | 掛川 | Kakegawa | Blue | N3-A | 121 | 25 | 8 | 3 | 秋風の関守 Autumn Wind Keeper · 〜たびに/〜うちに/〜間に, 〜によって |
| 27 | 袋井 | Fukuroi | Blue | N3-A | 121 | 25 | 8 | 3 | 出茶屋の関守 Teahouse Keeper · 〜に対して/〜について/〜として, Say It Three Ways begins |
| 28 | 見付 | Mitsuke | Blue | N3-A | 121 | 25 | 8 | 3 | 天竜川の関守 Tenryū Keeper · 〜ことになっている, 〜一方, compound verbs |
| 29 | 浜松 | Hamamatsu | Blue | N3-A | 121 | 25 | 8 | 3 | 冬枯れの関守 Winter Field Keeper · 〜ものだ/〜べき, 〜はずがない, Monologue Marathon begins |
| 30 | 舞坂 | Maisaka | Blue | N3-A | 121 | 25 | 8 | 3 | 今切の関守 Imagire Keeper · 〜っぽい/〜がち/〜げ, contractions (〜ちゃう/〜とく/〜じゃん) receptive |
| 31 | 新居 | Arai | Blue | N3-A | 121 | 25 | 8 | 3 | 新居関所の関守 Arai Checkpoint Keeper · written vs spoken register · **Blue Shinsa** (listening 1.1×) |
| 32 | 白須賀 | Shirasuka | Purple | N3-B | 122 | 25 | 8 | 2 | 潮見坂の関守 Shiomizaka Keeper · 〜ずにはいられない, 〜ないわけにはいかない |
| 33 | 二川 | Futagawa | Purple | N3-B | 122 | 25 | 8 | 2 | 猿ヶ馬場の関守 Saru-ga-Baba Keeper · formal connectives, news-style grammar |
| 34 | 吉田 | Yoshida | Purple | N3-B | 122 | 25 | 8 | 2 | 豊川橋の関守 Toyokawa Bridge Keeper · 〜に違いない/〜にすぎない, J-J definitions default on |
| 35 | 御油 | Goyu | Purple | N3-B | 122 | 25 | 8 | 2 | 旅籠の関守 Inn Keeper · onomatopoeia strand I (giongo), 〜ばかりでなく |
| 36 | 赤坂 | Akasaka | Purple | N3-B | 122 | 25 | 7 | 2 | 宿の灯の関守 Lantern Inn Keeper · onomatopoeia strand II (gitaigo), 〜最中に |
| 37 | 藤川 | Fujikawa | Purple | N3-B | 122 | 25 | 7 | 2 | 棒鼻の関守 Bōbana Keeper · 〜向け/〜向き, 〜からには, Reduce & Expand begins |
| 38 | 岡崎 | Okazaki | Purple | N3-B | 121 | 25 | 8 | 2 | 矢矧橋の関守 Yahagi Bridge Keeper · consolidation · **Purple Shinsa (N3)** |
| 39 | 池鯉鮒 | Chiryū | Brown | N2 | 212 | 44 | 12 | 2 | 馬市の関守 Horse Market Keeper · 〜に限らず/〜をはじめ/〜次第, Breadth Campaign peak |
| 40 | 鳴海 | Narumi | Brown | N2 | 212 | 44 | 11 | 2 | 絞りの関守 Shibori Keeper · 〜ざるを得ない/〜かねる/〜得る |
| 41 | 宮 | Miya | Brown | N2 | 212 | 44 | 11 | 2 | 熱田の関守 Atsuta Keeper · 〜に越したことはない/〜のみならず, essay structure |
| 42 | 桑名 | Kuwana | Brown | N2 | 212 | 44 | 11 | 2 | 七里の渡しの関守 Seven-Ri Ferry Keeper · 〜につれて/〜に伴って/〜とともに |
| 43 | 四日市 | Yokkaichi | Brown | N2 | 213 | 44 | 11 | 2 | 三重川の関守 Mie River Keeper · 〜ものの/〜とはいえ/〜にしても, listening 1.1× |
| 44 | 石薬師 | Ishiyakushi | Brown | N2 | 213 | 44 | 11 | 2 | 薬師の関守 Yakushi Keeper · 〜まい/〜ずじまい, extended monologue listening |
| 45 | 庄野 | Shōno | Brown | N2 | 213 | 43 | 11 | 2 | 白雨の関守 Sudden Shower Keeper · 〜がてら/〜かたわら, business mail register |
| 46 | 亀山 | Kameyama | Brown | N2 | 213 | 43 | 12 | 2 | 雪晴れの関守 Snow Clearing Keeper · **Plateau Arc complete** · **Brown Shinsa (N2)** (1.25×, 300 cpm) |
| 47 | 関 | Seki | Black | N1 | 214 | 0 | 10 | 2 | 関の関守 Keeper of the Barrier · 〜べからず/〜んばかり/〜ごとく, literary register |
| 48 | 坂下 | Sakashita | Black | N1 | 214 | 0 | 10 | 2 | 筆捨山の関守 Fudesute Keeper · 〜をもって/〜といえども/〜ゆえに |
| 49 | 土山 | Tsuchiyama | Black | N1 | 214 | 0 | 10 | 2 | 春雨の関守 Spring Rain Keeper · 〜ながらも/〜つつ/〜きらいがある |
| 50 | 水口 | Minakuchi | Black | N1 | 214 | 0 | 10 | 2 | 干瓢の関守 Kanpyō Keeper · 〜に至る/〜を禁じ得ない/〜極まりない |
| 51 | 石部 | Ishibe | Black | N1 | 214 | 0 | 10 | 2 | 目川の関守 Megawa Keeper · 〜ずくめ/〜まみれ/〜なりに, abstract vocabulary bands |
| 52 | 草津 | Kusatsu | Black | N1 | 215 | 0 | 10 | 2 | 追分の関守 Fork Keeper · 〜とあって/〜ともなると/〜にかたくない, lecture-style listening |
| 53 | 大津 | Ōtsu | Black | N1 | 215 | 0 | 10 | 2 | 走井の関守 Hashirii Keeper · consolidation, 1,000+ char reading |
| — | 三条大橋 | Sanjō Ōhashi | Black 初段 | N1 | — | — | — | — | **Shodan Shinsa** (400 cpm, 1.25× listening, 2-min monologue) |

Column totals: vocab 6,350 · kanji 1,000 (N1 stations add none in V1; the jōyō remainder is a content hook, see §6) · grammar 450 · stories 137 · kana 238 · Michikusa 212 (4 per station, not shown).

---

## 2. Belts (kyū) and what each requires

Belt promotion requires **all three**, no XP threshold:

1. Every Gatekeeper of the belt passed (Assisted Gate counts provisionally; the belt stamp shows a grey corner until the Revenge Match).
2. Mastery coverage of the belt's items: ≥ 85 % at **item belt Green** (base facet S ≥ 7 d, §4) **and** ≥ 50 % at **item belt Brown** (§4), kana and component items excluded above White.
3. The belt **Shinsa** (審査) passed: ≥ 80 % in each section (spec in `04 §12`).

| Belt | Stations | Level | Dojo title | Ceremony unlocks |
|---|---|---|---|---|
| White 白帯 | 1–3 | kana | 見習い Minarai (Apprentice) | start of road; `kana-grid` wallpaper on completion |
| Yellow 黄帯 | 4–9 | N5-A | 入門 Nyūmon | `belt-yellow` badge, 3 tatami |
| Orange 橙帯 | 10–15 | N5-B | 門下生 Monkasei (Disciple) | `belt-orange` badge, 4 tatami |
| Green 緑帯 | 16–24 | N4 | 中堅 Chūken | `belt-green` badge, `fuji-ridge` wallpaper, 6 tatami, Second Wind (stories become primary XP) |
| Blue 青帯 | 25–31 | N3-A | 師範代候補 | `belt-blue` badge, `daruma` wallpaper (left eye); `vs-wall` at Station 25 entry, Plateau Arc tools |
| Purple 紫帯 | 32–38 | N3-B | 師範代 Shihandai (Assistant Master) | `belt-purple` badge, `koi-dragon` wallpaper, 8 tatami, J-J default |
| Brown 茶帯 | 39–46 | N2 | 師範 Shihan (Master) | `belt-brown` + `beyond-the-wall` badges, `wall-broken` wallpaper, 10 tatami |
| Black 黒帯 初段 | 47–53 + Sanjō Ōhashi | N1 core | 達人 Tatsujin (Adept) | `belt-black` badge, `kyoto-arrival` wallpaper, `daruma` right eye, Dan road opens |

Every unlock above is an id from the `06 §2` badge table or the `06 §3` wallpaper table; there are no other ceremony rewards.

**Belt ceremony (12 s, skippable):** screen dims to `--bg` sumi → three taiko hits each blooming a vermilion ink splash → the rank kanji brush-writes stroke by stroke (stroke-dasharray on Yuji Syuku outlines converted to paths at build time) → a woven SVG belt in the new color ties its knot (two Béziers morphing) → the learner's name-seal slams at −6° with ink bleed → the new wallpaper thumbnail rises from the ink with a wind chime → the next lantern on the Road turns vermilion. A ≤ 80-word Tabi Nikki vignette follows (the innkeeper hands you the belt).

---

## 3. Dan ranks: the road past Kyoto (open-ended endgame)

No stations, no Gatekeepers. Each dan is a **Dōjō Yaburi (道場破り)** module: themed 10-minute gauntlets with explicit, machine-checkable promotion criteria tied to Perapera axes and the Input Ledger. V1 ships the framework, the gauntlet runner, and criteria; content packs for 二段+ are release trains (see `07`). Until packs exist, gauntlets run on Native Bridge passages, the learner's captured words, and Say It Three Ways / Monologue / Shadowing over existing content.

| Dan | Module | Promotion criteria (all) |
|---|---|---|
| 二段 Nidan | 敬語の段 Keigo mastery: sonkeigo / kenjōgo / bikago, business mail, phone, service register | Say It Three Ways register accuracy ≥ 90 % over last 60; 20 keigo role-plays with ≥ 80 % "best"; Ledger +100 h since 初段 |
| 三段 Sandan | 自然体の段 Natural speech: contractions, fillers, sentence-final particles, aizuchi marathon, dialect awareness (receptive: Kansai, Hakata, Tōhoku markers) | Aizuchi timing ≥ 85 % over 30 role-plays; Kansai recognition set ≥ 80 %; 50 Native Bridge passages at ≥ 93 % coverage with ≥ 80 % comprehension; Ledger +150 h |
| 四段 Yondan | 独白と影の段 Monologue & shadowing marathons: 2-min monologues, 1.25–1.5× listening, 5-minute shadow sets | 30 monologues ≥ 100 wpm (recognized or self-timed); 20 Listening Arena passes at 1.25×; 500 shadow lines; Ledger +200 h |
| 五段 Godan | 文の段 Literary and domain: classical fragments (〜ず/〜べし/〜なり), yojijukugo, proverbs, learner-chosen domain (aviation, tech, medicine, law…) | 100 yojijukugo Brown; 2 domain packs read; reading ≥ 450 cpm at ≥ 80 %; Ledger total ≥ 1,000 h |
| 六段+ | 維持の段 Maintenance: Kaiden lane, weekly Kage, Dōjō Yaburi records | one dan per 300 Ledger hours beyond 1,000 and 100 training days; 十段 = 1,000 training days + 1,500 Ledger hours, title 続く者 "The One Who Continues" |

---

## 4. Item belts (micro meta-progression)

Every item carries a belt derived from its facet cards (facets defined in `05 §2`). Each kind has a **base facet** (created at introduction) and a **production facet** (created later, warm-started):

| Kind | Base facet | Production facet |
|---|---|---|
| vocab, chunk | `rec` (chunk: `prod` is both) | `prod` |
| kana | `rec` | `prod` |
| component | `rec` | — (never Brown; archives at S > 90 d) |
| kanji | `comp` | `read` |
| grammar | `cloze` | `prod` (transform / form-forge / form-chain / say-three-ways) |

| Item belt | Rule | XP | Meaning |
|---|---|---|---|
| White | introduced | — | new |
| Yellow | base S ≥ 1 d | 5 | first night survived |
| Green "Known" | base S ≥ 7 d | 10 | counts for coverage and belt eligibility |
| Brown "Mastered" | base S ≥ 30 d **and** production S ≥ 7 d | 20 | production exists |
| Black | every unlocked facet S ≥ 120 d | 40 | becomes a Kotodama flame on the Dojo; enters the Kaiden lane |

`learn/item-belt.ts` implements exactly this table (`baseFacet(kind)`, `productionFacet(kind)`).

Promotions fire a two-pluck koto sound and a small belt flip on the card. This is where most mid-session dopamine lives, because it tracks real consolidation.

---

## 5. XP and levels (effort axis)

Level curve: `xpToNext(L) = 160 + 120·L`, cumulative `xp(L) = 60·L² + 100·L`.

| Level | Cumulative XP | ≈ at Standard (≈ 420 XP/day) |
|---|---|---|
| 5 | 2,000 | 5 days |
| 10 | 7,000 | 2.5 weeks |
| 20 | 26,000 | 2 months |
| 30 | 57,000 | 4.5 months |
| 50 | 155,000 | 1 year |
| 75 | 345,000 | 2.3 years |
| 99 | 597,960 | 3.9 years |

Level is cosmetic: it sets the lantern count on the Dojo and the gi trim. XP sources and amounts are in `06 §1`. No daily XP cap; the XP-optimal path is the learning-optimal path because grinding known items yields baseline XP and no promotions.

---

## 6. Timeline and Projected Arrival

### 6.1 New-item rates per belt at Standard

Days per belt = **max** over the three streams (vocab, kanji, grammar) of items ÷ rate, not the vocab-bound estimate alone. Minutes/day are computed from the `05 §2` steady-state review load at **8 s per rep** (typed IME/dictation reps budget 9–12 s, multiple-choice 4 s) plus the Scroll, input and output blocks of `03 §2`; Scroll size scales by belt (`03 §2.2`) so the day can introduce the items the rates assume.

| Belt | Vocab/day | Kanji/day | Grammar/day | Items in belt | Days (100 %) | Cum. months 100 % / 70 % | Reviews/day (steady) | Expected min/day |
|---|---|---|---|---|---|---|---|---|
| White | 20 kana + 4 words | — | — | 238 + 80 | 23 (words-bound: 80 ÷ 4 + 3 gates; kana 238 ÷ 20 ≈ 12 is not binding) | 0.8 / 1.1 | ≈ 60 | ≈ 15 |
| Yellow + Orange | 7 | 1 | 0.75 | 720 + 100 + 90 | 120 (grammar-bound) | 4.4 / 6.3 | ≈ 130 | ≈ 25 |
| Green | 8 | 2.5 | 1 | 650 + 200 + 90 | 90 (grammar-bound) | 7.4 / 10.6 | ≈ 180 | ≈ 32 |
| Blue + Purple | 12 (Breadth Campaign) | 2.5 | 0.8 | 1,700 + 350 + 110 | 142 | 12.1 / 17.3 | ≈ 220 | ≈ 45 |
| Brown | 14 | 3 | 0.8 | 1,700 + 350 + 90 | 121 | 16.0 / 22.9 | ≈ 290 | ≈ 58 |
| Black | 14 | — | 0.7 | 1,500 + 70 | 107 | 19.6 / 28.0 | ≈ 270 | ≈ 55 |

Plus one day per Gatekeeper and two per Shinsa (~65 days). Implementation note (review round 2c): `OnboardingPage` derives months / hours / belt-after-days per preset from `store/derived.onboardingEstimate` (`roadEstimateFor(preset)`: station quotas ÷ the preset's rates, `GATE_DAYS = 1` per Gatekeeper, 2 per Shinsa — the same basis as the Records projection and the Road page); the table above (white 23 …) is the design figure, and the page's `ROAD_DAYS` fallback (white 15, yellow / orange 60, green 90, blue / purple 71, brown 121, black 107) is used only when no estimate can be computed. The cumulative months the page shows are the estimate's `days100` / `days70` ÷ 30.44, so they follow the live quotas rather than this table. The post-Scroll gate wait (≥ 80 % Green at S ≥ 7 d, `§6.2 gateWait`) is not part of `onboardingEstimate`; adding it there changes the page with no app change. **Arrival at Sanjō Ōhashi: ≈ 22 months at 100 % adherence, ≈ 31 months at 70 %.** Casual ≈ 1.8×, Intense ≈ 0.6× these. Expected in-app minutes/day at Standard rise from ≈ 25 (N5) to ≈ 60 (N2); the Plateau Arc shifts that time toward input. Summed over the road this is **≈ 450 in-app hours at Standard** (≈ 300 Casual, ≈ 650 Intense) — the number the onboarding honesty clause shows (`01 §2`), computed from the preset, never hard-coded. Review caps are belt-scaled so the steady-state load always fits under the cap (`03 §4`).

What arrival means, stated on the Records page: the **N1 core** (6,350 words, 1,000 kanji, 450 patterns, 137 graded texts). Reading N1 texts comfortably also needs the jōyō remainder (~1,136 kanji) and ~3,500 more words — content hooks `kanji/n1/*`, `vocab/n1x/*` — and the ledger hours. The app says so.

### 6.2 Projected Arrival (Records page, recomputed on open)

```
adherence  = clamp(activeDays(last 28 days) / 28, 0.3, 1.0)
realized   = itemsIntroduced(last 28 days) / activeDays(last 28 days)      // what actually happened, incl. governor and cramming cap
rate(s)    = clamp(realized, 1, newPerDay(belt of s, learner's setting))    // never above the setting, never below 1/day
gateWait(s)= max(1, 7 − daysSinceLastIntro(s))                              // Gatekeeper needs ≥ 80 % Green (S ≥ 7 d) after the last Scroll
daysFor(s) = remainingItems(s) / rate(s) + gateWait(s)
daysFor(belt exam) = 2
projected(station) = today + Σ_{s ≤ station} daysFor(s) / adherence         // shown with a ±20 % band, recomputed after every session
```

Displayed as two lines: *"N3 (Okazaki): March 2027 at your current pace · December 2026 at daily practice."* ("daily practice" = adherence 1.0 and `rate = newPerDay`.) Shown only after 14 active days; before that the onboarding estimates (100 % / 70 %) are shown. A Backlog-mode day counts as active. The number is never red and never accompanied by a countdown. `projection.test.ts` checks the estimate is monotone in realized logs and never earlier than the 1-item/day floor.

### 6.3 Second Wind (Station 16 onward) and the Plateau Arc (25–46)

- **Second Wind** at Green: the Tabi Nikki story becomes the primary XP source per session; captured words from reading become a sanctioned new-item source (up to 40 % of the daily new-vocab budget).
- **壁の章 Kabe no Shō (The Wall)**, Stations 25–46: mandatory countermeasures, not optional modes ("mandatory" = offered every week and narrated as the medicine; nothing here gates progression). The difficulty cliffs are **staggered**, never stacked on one station: casual-register narration from Station 25 (still at the 97 % coverage target), Native Bridge passages (`bridge: true`, 93 %, contractions, fillers, dropped particles) from **Station 27**, ordinary passages at 95 % from **Station 29** and 93 % from **Station 39** (`COVERAGE_TARGETS` in `types.ts`); Breadth Campaign (12–14 new words/day, J-J definitions default from Station 34), Say It Three Ways (from 27), Monologue Marathon (from 29), Reduce & Expand 60/45/30 s (from 37), Field Missions escalating to a real 15-minute conversation. Each station keeps ≥ 2 texts (§1); when the learner has read them all, the Station page shows the week's **external input target** from the ledger (`05 §9`) and the current Field Mission as the explicit substitute. `vs-wall` wallpaper at entry, `wall-broken` at exit. Full spec in `05 §10`.
