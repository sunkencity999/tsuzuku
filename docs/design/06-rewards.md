# TSUZUKU — 06 · Rewards: XP, Mon Badges, Kakejiku Wallpapers, Goshuin-chō, the Dojo

Binding rules: every unlock condition is deterministic, machine-checkable against the save, and visible before unlock. No randomness in rewards (procedural seeds change detail, never value). Nothing expires or is taken away.

## 1. XP sources

| Event | XP |
|---|---|
| Review correct Good / Hard / Again (effort) | 2 / 1 / 1 |
| Recovery success after a miss | +2 |
| Ippon | +3 |
| Kiai state | × 1.5 on rep XP for 10 reps |
| New item introduced (immediate checks done) | 5 |
| First `prod` success on an item | 10 |
| Item belt promotion Yellow / Green / Brown / Black | 5 / 10 / 20 / 40 |
| Combo 10 / 25 / 50 / 100 | 10 / 25 / 60 / 150 |
| Scroll completed (+ flawless = every immediate check correct; the Chikaradameshi pretest is excluded) | 30 (+10) |
| Tabi Nikki episode ≥ 2/3 | 25 + 5 per correct question |
| Speed Read correct | 15 |
| Listening Arena set | 20 + 5 per correct question |
| Ear Walk (`listening-set` in pool mode) | 20 + 5 per correct question |
| 茶屋ラジオ Radio track · Read-along (`listen:played`) | 0 (passive hearing is input, not effort; design 08 §10.2 / §10.3) |
| Dictation line (by accuracy × tier) | 3–6 |
| Shadow line pass / set of 5 | 3 / +10 |
| Role-play (+ all best, + all aizuchi) | 25 (+10, +5) |
| Say It Three Ways / Monologue / Reduce & Expand | 15 / 15 / 20 |
| Writing Dojo | 30 |
| Weak Point set cleared | 15 |
| Rapid Fire run (1 per correct, ≤ 60; **first run of the day only**, later runs are free play) | ≤ 60 |
| Michikusa read | 5 |
| Three Kata complete (Full Training Day) | 50 |
| Gatekeeper pass / 100 % / Assisted / Revenge | 300 / +100 / 150 / 450 |
| Shinsa pass | 1,000 |
| Kage beaten | 60 |
| Nemesis defeated | 40 |
| Field Mission | 30–100 |
| External input (per minute, cap 60/day) / ledger entry (cap 20/day) | 1 / 5 |

A Standard day lands around 420 XP; no daily cap. Arcade modes (Rapid Fire, Gojūon Fighter) never count toward `stats.reviews` or `stats.bestCombo`, so no badge or milestone is a grind over known items.

---

## 2. Mon (紋) — badges (68)

Each badge is a circular family-crest-style emblem rendered from a declarative spec `{ring, field, glyph, accent}`: ring **Bronze** single (`#B87333`), **Silver** double (`#C9CED6`), **Gold** double + 16 rays (`--kin`); field circle / hexagon / tomoe / square / petal; one kanji glyph in Yuji Syuku. Unearned crests show as grey stone with the condition in plain text. Earning = hanko slam at −6° with ink bleed and the 300 ms thump. Conditions reference only `SaveMeta` paths (`ARCHITECTURE §1`), `STAT_KEYS` counters (`stats.*`) and the `ledgerHours(m)` helper of `store/ledger.ts`; `BADGE_IDS` in `shared/catalog.ts` lists exactly these 68 ids, and no badge id is also a wallpaper or exercise id (`catalog.test.ts`).

| Id | Name | 和名 | Glyph · field | Condition | Tier |
|---|---|---|---|---|---|
| first-step | First Step | 一歩 | 歩 · circle | `stats.sessions >= 1` | Bronze |
| gojuon | Gojūon | 五十音 | あ · petal | all 46 basic hiragana `rec` S ≥ 7 d | Silver |
| katakana | Katakana Awakening | 片仮名開眼 | カ · petal | all katakana (incl. extended) `rec` S ≥ 7 d | Silver |
| voiced | Voiced | 濁点 | ゛ · circle | all dakuten/handakuten/yōon kana S ≥ 7 d | Bronze |
| rain-candy | Rain and Candy | 雨と飴 | 雨 · hexagon | minimal-pair set ≥ 95 % over 200 trials | Silver |
| gojuon-perfect | Perfect Round | 完全 | 星 · tomoe | Gojūon Fighter 46/46, 0 misses, < 60 s | Gold |
| three-day | Three-Day Monk, Defeated | 三日坊主打破 | 四 · circle | `streak.current >= 4` | Bronze |
| seven | Seven Days | 七日 | 七 · circle | `streak.current >= 7` | Bronze |
| thirty | Thirty Suns | 三十日 | 月 · circle | `streak.current >= 30` | Silver |
| hundred | Hundred-Day Training | 百日修行 | 修 · tomoe | `streak.totalDays >= 100` | Gold |
| year | One Year | 一年 | 年 · tomoe | `streak.totalDays >= 365` | Gold |
| rise-eight | Fall Seven, Rise Eight | 七転八起 | 起 · hexagon | `streak.repairs >= 1` | Silver |
| ember | Ember Keeper | 残り火 | 火 · circle | `streak.emberRestores >= 1` | Bronze |
| samurai-rest | Even Samurai Rest | 侍も休む | 休 · circle | `streak.restDaysTaken >= 10` | Bronze |
| five-hundred-days | Five Hundred Days | 五百日 | 日 · tomoe | `streak.totalDays >= 500` | Gold |
| thousand-cuts | Thousand Cuts | 千本 | 千 · square | `stats.reviews >= 1000` | Bronze |
| ten-thousand | Ten Thousand | 万本 | 万 · square | `stats.reviews >= 10000` | Silver |
| hundred-thousand | Hundred Thousand | 十万本 | 十 · square | `stats.reviews >= 100000` | Gold |
| ten-chain | Ten-Chain | 十連 | 連 · hexagon | `stats.bestCombo >= 10` | Bronze |
| fifty-chain | Fifty-Chain | 五十連 | 連 · hexagon | `stats.bestCombo >= 50` | Silver |
| hundred-chain | Hundred-Chain | 百連 | 連 · tomoe | `stats.bestCombo >= 100` | Gold |
| unscathed | Unscathed | 無傷 | 無 · circle | a Kata of ≥ 15 reps at 100 % | Bronze |
| ippon | Ippon! | 一本 | 一 · square | `stats.ippon >= 1` | Bronze |
| hundred-ippon | Hundred Ippon | 一本百回 | 本 · square | `stats.ippon >= 100` | Silver |
| gatekeepers-respect | Gatekeeper's Respect | 関守の敬意 | 関 · hexagon | `progress.stationsCleared.length >= 1` | Bronze |
| perfect-gate | Perfect Gate | 完全通過 | 門 · hexagon | `progress.perfectGates >= 1` | Silver |
| revenge | Revenge | 雪辱 | 雪 · hexagon | a Revenge Match won | Silver |
| halfway | Halfway | 道半ば | 道 · tomoe | station 27 cleared | Silver |
| kyoto | Kyoto | 京 | 京 · tomoe | `progress.stationsCleared` includes 53 (every Gatekeeper on the road cleared) | Gold |
| belt-yellow, belt-orange, belt-green, belt-blue, belt-purple, belt-brown, belt-black | Yellow … Black Belt (7) | 黄帯 … 黒帯 | 帯 · square | `progress.shinsaPassed` includes that belt (White has no Shinsa; `belt-black` = the Shodan Shinsa at Sanjō Ōhashi) | Bronze (yellow, orange) → Silver (green, blue, purple) → Gold (brown, black) |
| bookworm | Bookworm | 本の虫 | 本 · petal | `stats.episodesRead >= 50` | Silver |
| dictionary-free | Dictionary-Free | 辞書要らず | 辞 · petal | an episode ≥ 300 chars with ≥ 2/3 comprehension and ≤ 2 gloss taps | Silver |
| speed-reader | Speed Reader | 速読 | 速 · petal | Speed Read ≥ 300 cpm with the question correct | Silver |
| golden-ear | Golden Ear | 地獄耳 | 耳 · circle | `stats.dictation95at1x >= 100` | Silver |
| fast-ear | Fast Forward | 倍速の耳 | 倍 · circle | 20 Listening Arena passes at ≥ 1.25× | Gold |
| teahouse-regular | Teahouse Regular | 茶屋の常連 | 常 · circle | `stats.radioMinutes >= 600` (茶屋ラジオ minutes played; design 08 §11) | Bronze |
| first-hearing | First Hearing | 初耳 | 初 · circle | `stats.coldSetsPassed >= 20` (texts understood on first hearing, Arena or Radio; design 08 §12) | Silver |
| voice | Voice Unlocked | 声出し | 声 · circle | `stats.shadowPass >= 1` | Bronze |
| shadow-warrior | Shadow Warrior | 影武者 | 影 · hexagon | `stats.shadowPass >= 500` | Gold |
| aizuchi | Aizuchi Master | 相槌名人 | 槌 · hexagon | 20 role-plays with ≥ 80 % aizuchi slots hit | Silver |
| three-forms | Three Forms | 三変化 | 変 · hexagon | `stats.threeWays >= 100` | Silver |
| one-minute-monologue | One-Minute Monologue | 一分間独白 | 独 · hexagon | 60 s continuous speech ≥ 80 words (or 30 self-timed) | Silver |
| hundred-kanji | Hundred Characters | 百字 | 字 · square | `stats.kanjiBrown >= 100` | Silver |
| thousand-kanji | Thousand Characters | 千字 | 字 · square | `stats.kanjiBrown >= 1000` | Gold |
| thousand-words | Thousand Words | 千語 | 語 · square | `stats.vocabBrown >= 1000` | Silver |
| five-thousand | Five Thousand | 五千語 | 語 · square | `stats.vocabBrown >= 5000` | Gold |
| grammarian | Grammarian | 文法家 | 型 · square | all N5 + N4 grammar Brown | Silver |
| form-chain-20 | Form Chain | 活用連鎖 | 活 · square | 20 perfect Form Chains | Bronze |
| particle-sage | Particle Sage | 助詞の賢者 | 助 · square | 500 Particle Duel slots at ≥ 95 % | Silver |
| honest | Honest One | 正直者 | 正 · circle | `stats.honesty >= 0.95` over 200 Judge checks | Gold |
| weak-conquered | Weakness Conquered | 弱点克服 | 克 · hexagon | any error tag from > 20 % to < 5 % | Silver |
| nemesis-slayer | Nemesis Slayer | 宿敵討ち | 討 · hexagon | `stats.nemesisDefeated >= 10` | Silver |
| shadow-breaker | Shadow Breaker | 影を越えて | 越 · tomoe | `kage.wins >= 10` | Gold |
| beyond-the-wall | Beyond the Wall | 壁を越えて | 壁 · tomoe | Brown Shinsa passed | Gold |
| hundred-hours | Hundred Hours of Ears | 耳百時間 | 聴 · circle | `ledgerHours(m).listen >= 100` | Silver |
| thousand-hours | Thousand Hours | 千時間 | 時 · tomoe | `ledgerHours(m).total >= 1000` | Gold |
| field | Field Operative | 現場主義 | 現 · circle | `stats.fieldMissions >= 10` | Bronze |
| first-convo | First Real Conversation | 初対話 | 話 · circle | a `conversation` mission logged | Silver |
| comeback | Comeback | 復活 | 復 · circle | Welcome Back session completed after 30+ days | Bronze |
| zen | Zen | 禅 | 禅 · circle | `stats.zenSessions >= 30` | Silver |
| backup | Prepared | 備えあれば | 備 · circle | `stats.exports >= 1` | Bronze |
| tsuzuku | To Be Continued | つづく | 続 · tomoe | `stats.sessions >= 100` | Gold |

---

## 3. Kakejiku (掛け軸) — wallpapers (29)

**Rules.** Each piece is a seeded SVG scene (`seed = hash(profile.seed, wallpaperId, reforgeCount)`) with two compositions, desktop 16:9 and phone 9:19.5, rendered to PNG at 1920×1080 / 2560×1440 and 1170×2532 / 1290×2796; 3840×2160 only where `canRender4k()` holds — a desktop pointer at ≥ 1024 px, not iOS, and `navigator.deviceMemory` (when the browser reports it) ≥ 4 GB; everywhere else the picker stops at 2560×1440 and says so. Phone layouts keep the top 12 % and bottom 10 % as safe zones. **Progressive reveal:** locked pieces show as a sumi silhouette; those tied to a counter reveal in quadrants at 25/50/75/100 % of the condition. **Reforge** re-rolls detail **once per day per piece** and is labelled as cosmetic ("same picture, new brush"); **living** pieces re-render from current state. Personalization tokens: `nameKana`, `chosenKanji`, belt seal, `streak.longest` (streak-based personalization is frozen at the longest streak so a break never shrinks a piece), total days, a Mastered sentence of the learner's choice (a typed custom sentence is capped at 48 glyphs; every sentence the art lays out is cut to 96), station, date (Japanese era format). Pipeline in `07 §8`. `WALLPAPER_IDS` lists exactly these 29 ids.

| Id | Name | Concept | Palette | Technique | Personalization | Unlock |
|---|---|---|---|---|---|---|
| torii-dawn | 朝の鳥居 Torii at Dawn | 5 noise ridges, mist bands, one torii | kon→sakura sky, shu | 1-D noise ridges, feGaussianBlur mist | name on a hanging ema | all hiragana Green |
| kana-grid | 五十音セレクト Gojūon Select | arcade select screen: 10×5 kana tiles, cursor on your slowest kana | sumi, neon-c→neon-m heat | SVG rects + blurred glow twins, scanline pattern | heatmap = your Gojūon Fighter reaction times | White complete |
| neon-alley | 電脳横丁 Neon Alley | one-point-perspective rainy alley; every sign is one of your words | neon-m, neon-c, kin, sumi | glow via blurred twin, flipped-gradient puddle reflections | signs = your Mastered N5 words; biggest = most reviewed | 100 vocab Brown |
| sakura-storm | 桜吹雪 Sakura Storm | petal storm over a pagoda silhouette | sakura, dusk indigo | curl-noise flow field, 3 blur depth layers | one tanzaku with longest streak and date | `streak.totalDays >= 30` |
| great-wave | 文字の大波 Great Wave of Words | a woodblock wave whose shape is built from ~600 of your glyphs sized by stability | kon, washi, white foam | log-spiral crest, glyph placement along noise bands | glyphs = your Mastered kana/kanji | 1,000 reviews |
| kanji-stars | 漢字星座 Kanji Constellations | your kanji as stars; edges join kanji sharing a component | night `#0A0F2E`, kin for Black | Poisson-disc + relaxation, component edge list, fBm Milky Way | brightness = stability; labels = your 3 most common components | 100 kanji Brown |
| fifty-three | 五十三次 Fifty-Three Stations | ukiyo-e horizontal road map with hills, pines, markers | kon, washi, shu stamps | layered noise hills, `<pattern>` pines | your position and goshuin for cleared stations (living) | Station 10 |
| lantern-river | 灯籠流し Lantern River | floating lanterns on dark water | sumi, warm `#FFD166` | point glows, reflection displacement | one lantern per word learned this month | `streak.totalDays >= 100` |
| sumi-dragon | 墨龍 Sumi Dragon | an ink dragon coiling across washi | sumi on washi, one shu seal | Catmull-Rom spine, pressure envelope, bristle displacement | one body segment per day of `streak.longest` (30–365); never shrinks | `streak.totalDays >= 60` |
| okaeri | おかえり Welcome Back | CRT arcade attract screen showing おかえり and a hi-score table — **no countdown digit, no "insert coin"** | phosphor amber or green (seeded) | barrel distortion, scanlines, chromatic offset | 1ST = your name and XP; 2ND = your total training days | Ember restore, repair, or Welcome Back |
| vs-wall | 対戦画面 VS Screen | fighting-game intro, split diagonal, speed lines | neon-c / neon-m, sumi | radial speed lines, slab VS | left: your name; right: 壁 | Station 25 |
| wall-broken | 壁を越えて Beyond the Wall | same composition, the wall shattered into kanji fragments | as above + kin light | polygon shatter, light shafts | fragments = grammar points mastered during the arc | Brown Shinsa |
| tanabata | 七夕 Tanabata | bamboo under the Milky Way; tanzaku strips | night, matcha, five strip colors | segmented stalks, fBm band | strips = up to 24 of your Writing Dojo sentences | 365 total training days |
| hanko-garden | 判子の庭 Hanko Garden | your badge crests pressed as seals on washi | washi, shu | ±8° rotations, ink bleed, partial impressions | your badges in unlock order | 25 badges |
| fuji-ridge | 富士の線 Fuji Ridge | minimal Fuji whose ridge is data | kon bands, washi snow | data-ridge: array → smoothed polyline | ridge = your last 90 days of minutes | Green Shinsa |
| koi-dragon | 登竜門 Dragon Gate | koi climbing a waterfall, becoming a dragon | kon, shu, kin leaf | Bézier ribbon bodies along streamlines, spray particles | scales = your kanji; count = kanji Brown / 50 | Purple Shinsa |
| shoji-light | 障子 Shōji Light | warm light through paper screens, bamboo shadow | `#F7EFDF`, lattice, 35 % shadow | lattice grid, blurred shadow layer, 8 % text | the panels carry your 100 Brown grammar patterns | 100 grammar Brown |
| insert-coin | 筐体 Insert Coin | arcade cabinet, marquee, CRT hi-score | neon-c, neon-m, kin | procedural cabinet, scanlines | marquee = name; hi-score = Rapid Fire best, initials in katakana | Rapid Fire 50 correct |
| daruma | 達磨 Daruma | vermilion daruma, gold brushwork | shu, kin, washi | brush ribbons, gold flecks | left eye painted at Blue Shinsa, right eye at Shodan (upgrades in place) | Blue Shinsa |
| vending-night | 自販機の夜 Vending Machine Night | glowing machine in rain, labelled cans | sumi, `#FFD166`, neon-c | inner glow, 400 rain lines, puddle flip | can labels = katakana words you mastered | 300 katakana vocab Brown |
| onsen | 温泉の湯気 Onsen Steam | rotenburo at night, steam curls | night, matcha, washi steam | feTurbulence steam, mountain silhouettes | stones = planned rest days taken | 10 rest days |
| waveform | 聴写の波形 Waveform | oscilloscope trace of a sentence you dictated perfectly | sumi, neon-c | synthetic envelope from mora count/pitch, pixel text | that sentence in DotGothic16 | Golden Ear badge |
| chaya-lanterns | 茶屋の灯 Teahouse Lanterns | a roadside teahouse at dusk, one chōchin per 10 h of listening | dusk indigo, lantern gold, washi | eaves slots first, then a roadside rope receding with the road (`roadGeometry`, `placeLanterns`) | lantern count = floor(`WallpaperData.listenHours` / 10), capped at 60 — dojo and outside `listen` rows alike (living) | `ledgerHours(m).listen >= 100`; quadrants reveal at 25 / 50 / 75 / 100 h (design 08 §11) |
| golden-screen | 金屏風 Golden Screen | six-panel gold-leaf byōbu, cloud bands, cranes | kin jitter, sumi, washi | leaf grid with luminance jitter, suyari-gasumi, 6-point cranes | a formal greeting with your name on panel six | 二段 Nidan |
| festival | 祭り Festival Night | lantern strings, taiko stand, happi silhouettes, fireworks | sumi, shu, kin bursts | catenary strings, radial burst particles | casual words on the banners | 三段 Sandan |
| station-sign | 駅名標 Station Sign | generic platform sign at dusk | washi plate, kon, sakura sky | plate geometry, dusk gradient | center = your name in katakana; left/right = previous/next station | any Gatekeeper |
| kyoto-arrival | 京の橋 Kyoto Arrival | great bridge at dusk, pagoda, lantern reflections | kon, shu, kin | mirrored gradients, geese polylines | your full title and arrival date | Shodan Shinsa |
| road-continues | 無限の道 The Road Continues | perspective road into sunrise, つづく typography | sakura→kin sunrise | receding poles, brush type | streak and total days on the signpost | 十段 |
| end-card | つづく End Card | pure sumi, brush つづく, grain | sumi, washi | grain filter | your streak in small type below | 100 sessions |

---

## 4. Goshuin-chō (御朱印帳) — the stamp book

One vermilion stamp per Gatekeeper, procedurally varied: a square or round seal frame (seeded), the station name in Yuji Syuku arranged in 1–3 columns, a seeded border motif (seigaiha / asanoha / kikkō by belt), noise-eroded edges, the clear date in Japanese era format in small sumi type, and a gold frame if the gate was passed at 100 %. Assisted Gate stamps carry a grey corner until the Revenge Match. The book is an accordion of 53 pages viewable on the Road and exportable as a single PNG strip (desktop) or a 6-page phone set.

---

## 5. The Dojo (home screen): procedural state

An SVG scene that is the save file made visible; everything below is deterministic from state.

| State | Visual |
|---|---|
| Belt | tatami count (2 → 10) and the belt hanging on the wall rack |
| Chosen kanji (picked at each belt from Brown kanji) | the wall scroll (kakejiku) |
| Total training days | bonsai L-system depth (3 at day 1 → 8 at day 365); blooms at 100 total training days |
| Level | lantern count along the eaves (1 per 10 levels) |
| Badge categories | a shelf of Mon crests, one slot per category |
| Black items (Kotodama) | spirit flames drifting on a noise field, colored by category; capped at 400 rendered, counter shows the true total |
| Stamps | the stamp rack with the latest goshuin open |
| Kage beaten this week | the silhouette sitting in the corner |
| Season / time of day (real date) | sky through the shōji: dawn, day, dusk, night; seasonal tree |
| Today's forecast | one line under the Hanko Button |
| Tategaki column | a Mastered sentence of the day |

---

## 6. Michikusa (道草) library and later collections

212 fragments (4 per station) collected one per session; the Library shows them by station with the un-collected count ("3 more at Totsuka"). The Library also reserves a yojijukugo shelf: the 100 four-character idioms are a later content release (a `contentVersion` that adds files, `07 §6`), and the empty-shelf copy says only that they arrive later — no pack name, no rank.

---

## 7. Ethical guardrails (shipped in Settings → 道場の掟)

1. No purchases, currency, ads, loot boxes, timed offers, energy or lives.
2. No randomness in rewards; procedural seeds change detail, never value. All unlock conditions visible from day one.
3. No leaderboards against strangers; the only rival is your own Kage.
4. Streaks forgive: freezes, planned rest, Ember, repair; total days beside the streak. Your streak can pause and be repaired; badges, wallpapers, belts, levels and total days are never removed, and no badge or wallpaper above 30 days is keyed to the current streak.
5. No countdowns anywhere; 次回予告 is informational; no notifications beyond an optional neutral `.ics`.
6. Level = effort, Belt = skill; XP cannot buy a belt.
7. New items pause when the forge is overloaded; new items stop at 2 × target. The app protects you from your own enthusiasm.
8. Zen removes every pressure element without reducing learning or XP.
9. "How this game works" explains FSRS, the grading map, ki rules, the Judge and the governor in plain language.
10. Your study data never leaves the browser: export any time, import anywhere, no backend, no analytics. Speech recognition and some system voices are provided by your browser or OS vendor and **may send audio or text to their servers** (Chromium recognition requires network); the self-assessment path is fully offline and earns identical XP. The voice pack's clips are synthetic VOICEVOX character voices rendered at build time and fetched from this site's own release; playing them sends nothing anywhere, and every chip and header says *synthetic voice (VOICEVOX)* (design 08 §6). Recognition is off (`settings.speaking = 'self'`) until you opt in after reading this notice, and network voices are marked in the voice picker.
