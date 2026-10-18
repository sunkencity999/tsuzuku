/**
 * TSUZUKU — copy for the reward definitions, the Perapera Index and the
 * Projected Arrival (group B, Sensei voice: terse, warm, dry; design 01 §3).
 *
 * Linted by `src/i18n/banned.test.ts`. Every badge and wallpaper name and
 * every condition sentence lives here; `badge-defs.ts` / `wallpaper-defs.ts`
 * only reference keys. Templates use `{name}` slots; the modules fill them.
 * Condition sentences are plain statements of the rule, because unearned
 * crests show them from day one (design 06 §2, §7 #2).
 */
import type { BadgeId, WallpaperId } from '../shared/catalog';

export interface NamedCopy {
  en: string;
  ja: string;
  /** The unlock condition in plain words. */
  describe: string;
}

const BADGES: Record<BadgeId, NamedCopy> = {
  'first-step': { en: 'First Step', ja: '一歩', describe: 'One session finished. The road begins.' },
  gojuon: { en: 'Gojūon', ja: '五十音', describe: 'Every basic hiragana held for a week.' },
  katakana: { en: 'Katakana Awakening', ja: '片仮名開眼', describe: 'Every katakana, extended set included, held for a week.' },
  voiced: { en: 'Voiced', ja: '濁点', describe: 'Every dakuten, handakuten and yōon hiragana held for a week.' },
  'rain-candy': { en: 'Rain and Candy', ja: '雨と飴', describe: 'Minimal pairs at 95 % over 200 trials.' },
  'gojuon-perfect': { en: 'Perfect Round', ja: '完全', describe: 'Gojūon Fighter: all 46, no misses, under a minute.' },
  'three-day': { en: 'Three-Day Monk, Defeated', ja: '三日坊主打破', describe: 'Four days in a row. The three-day monk is beaten.' },
  seven: { en: 'Seven Days', ja: '七日', describe: 'Seven days in a row.' },
  thirty: { en: 'Thirty Suns', ja: '三十日', describe: 'Thirty days in a row.' },
  hundred: { en: 'Hundred-Day Training', ja: '百日修行', describe: 'One hundred training days in total.' },
  year: { en: 'One Year', ja: '一年', describe: '365 training days in total.' },
  'rise-eight': { en: 'Fall Seven, Rise Eight', ja: '七転八起', describe: 'A broken streak repaired once.' },
  ember: { en: 'Ember Keeper', ja: '残り火', describe: 'A flame restored from embers.' },
  'samurai-rest': { en: 'Even Samurai Rest', ja: '侍も休む', describe: 'Ten planned rest days taken.' },
  'five-hundred-days': { en: 'Five Hundred Days', ja: '五百日', describe: 'Five hundred training days in total.' },
  'thousand-cuts': { en: 'Thousand Cuts', ja: '千本', describe: '1,000 graded reviews.' },
  'ten-thousand': { en: 'Ten Thousand', ja: '万本', describe: '10,000 graded reviews.' },
  'hundred-thousand': { en: 'Hundred Thousand', ja: '十万本', describe: '100,000 graded reviews.' },
  'ten-chain': { en: 'Ten-Chain', ja: '十連', describe: 'A combo of 10.' },
  'fifty-chain': { en: 'Fifty-Chain', ja: '五十連', describe: 'A combo of 50.' },
  'hundred-chain': { en: 'Hundred-Chain', ja: '百連', describe: 'A combo of 100.' },
  unscathed: { en: 'Unscathed', ja: '無傷', describe: 'A Kata of 15 or more reps with every answer right.' },
  ippon: { en: 'Ippon', ja: '一本', describe: 'One Ippon: a mature card, fast and clean.' },
  'hundred-ippon': { en: 'Hundred Ippon', ja: '一本百回', describe: 'One hundred Ippon.' },
  'gatekeepers-respect': { en: "Gatekeeper's Respect", ja: '関守の敬意', describe: 'One Gatekeeper passed.' },
  'perfect-gate': { en: 'Perfect Gate', ja: '完全通過', describe: 'A Gatekeeper passed at 100 %.' },
  revenge: { en: 'Revenge', ja: '雪辱', describe: 'A Revenge Match won after an Assisted Gate.' },
  halfway: { en: 'Halfway', ja: '道半ば', describe: 'Station 27 cleared. Half the road behind you.' },
  kyoto: { en: 'Kyoto', ja: '京', describe: 'Every Gatekeeper on the road passed.' },
  'belt-yellow': { en: 'Yellow Belt', ja: '黄帯', describe: 'The Yellow Shinsa passed.' },
  'belt-orange': { en: 'Orange Belt', ja: '橙帯', describe: 'The Orange Shinsa passed.' },
  'belt-green': { en: 'Green Belt', ja: '緑帯', describe: 'The Green Shinsa passed.' },
  'belt-blue': { en: 'Blue Belt', ja: '青帯', describe: 'The Blue Shinsa passed.' },
  'belt-purple': { en: 'Purple Belt', ja: '紫帯', describe: 'The Purple Shinsa passed.' },
  'belt-brown': { en: 'Brown Belt', ja: '茶帯', describe: 'The Brown Shinsa passed.' },
  'belt-black': { en: 'Black Belt', ja: '黒帯', describe: 'The Shodan Shinsa passed at Sanjō Ōhashi.' },
  bookworm: { en: 'Bookworm', ja: '本の虫', describe: 'Fifty episodes read.' },
  'dictionary-free': { en: 'Dictionary-Free', ja: '辞書要らず', describe: 'An episode of 300 characters or more understood with two gloss taps or fewer.' },
  'speed-reader': { en: 'Speed Reader', ja: '速読', describe: 'A Speed Read at 300 cpm or more with the question answered right.' },
  'golden-ear': { en: 'Golden Ear', ja: '地獄耳', describe: 'One hundred dictation lines at 95 % at normal speed.' },
  'fast-ear': { en: 'Fast Forward', ja: '倍速の耳', describe: 'Twenty Listening Arena sets passed at 1.25× or faster.' },
  // design 08 §11: Teahouse Radio minutes; texts understood on the first hearing, Arena or Radio alike.
  'teahouse-regular': { en: 'Teahouse Regular', ja: '茶屋の常連', describe: 'Ten hours of Teahouse Radio heard.' },
  'first-hearing': { en: 'First Hearing', ja: '初耳', describe: 'Twenty texts understood on the first hearing.' },
  voice: { en: 'Voice Unlocked', ja: '声出し', describe: 'One shadow line passed.' },
  'shadow-warrior': { en: 'Shadow Warrior', ja: '影武者', describe: 'Five hundred shadow lines passed.' },
  aizuchi: { en: 'Aizuchi Master', ja: '相槌名人', describe: 'Twenty role-plays with 80 % of the aizuchi slots hit.' },
  'three-forms': { en: 'Three Forms', ja: '三変化', describe: 'One hundred Say It Three Ways rounds.' },
  'one-minute-monologue': { en: 'One-Minute Monologue', ja: '一分間独白', describe: 'Sixty seconds of continuous speech at 80 words, or thirty self-timed monologues.' },
  'hundred-kanji': { en: 'Hundred Characters', ja: '百字', describe: 'One hundred kanji Mastered.' },
  'thousand-kanji': { en: 'Thousand Characters', ja: '千字', describe: 'One thousand kanji Mastered.' },
  'thousand-words': { en: 'Thousand Words', ja: '千語', describe: 'One thousand words Mastered.' },
  'five-thousand': { en: 'Five Thousand', ja: '五千語', describe: 'Five thousand words Mastered.' },
  grammarian: { en: 'Grammarian', ja: '文法家', describe: 'Every N5 and N4 pattern Mastered.' },
  'form-chain-20': { en: 'Form Chain', ja: '活用連鎖', describe: 'Twenty perfect Form Chains.' },
  'particle-sage': { en: 'Particle Sage', ja: '助詞の賢者', describe: 'Five hundred Particle Duel slots at 95 %.' },
  honest: { en: 'Honest One', ja: '正直者', describe: 'Honesty at 95 % over 200 inspections. Well calibrated.' },
  'weak-conquered': { en: 'Weakness Conquered', ja: '弱点克服', describe: 'An error tag brought from above 20 % to under 5 %.' },
  'nemesis-slayer': { en: 'Nemesis Slayer', ja: '宿敵討ち', describe: 'Ten Nemesis defeated.' },
  'shadow-breaker': { en: 'Shadow Breaker', ja: '影を越えて', describe: 'Your Kage beaten ten times.' },
  'beyond-the-wall': { en: 'Beyond the Wall', ja: '壁を越えて', describe: 'The Brown Shinsa passed. The wall is behind you.' },
  'hundred-hours': { en: 'Hundred Hours of Ears', ja: '耳百時間', describe: 'One hundred hours of listening in the ledger.' },
  'thousand-hours': { en: 'Thousand Hours', ja: '千時間', describe: 'One thousand ledger hours.' },
  field: { en: 'Field Operative', ja: '現場主義', describe: 'Ten Field Missions reported.' },
  'first-convo': { en: 'First Real Conversation', ja: '初対話', describe: 'A real conversation mission logged.' },
  comeback: { en: 'Comeback', ja: '復活', describe: 'A Welcome Back session finished after thirty days away. The dojo kept your place.' },
  zen: { en: 'Zen', ja: '禅', describe: 'Thirty sessions in Zen.' },
  backup: { en: 'Prepared', ja: '備えあれば', describe: 'Your save exported once.' },
  tsuzuku: { en: 'To Be Continued', ja: 'つづく', describe: 'One hundred sessions. To be continued.' },
};

const WALLPAPERS: Record<WallpaperId, NamedCopy> = {
  'torii-dawn': { en: 'Torii at Dawn', ja: '朝の鳥居', describe: 'Every hiragana at Green.' },
  'kana-grid': { en: 'Gojūon Select', ja: '五十音セレクト', describe: 'The three White stations cleared.' },
  'neon-alley': { en: 'Neon Alley', ja: '電脳横丁', describe: 'One hundred words Mastered.' },
  'sakura-storm': { en: 'Sakura Storm', ja: '桜吹雪', describe: 'Thirty training days in total.' },
  'great-wave': { en: 'Great Wave of Words', ja: '文字の大波', describe: '1,000 graded reviews.' },
  'kanji-stars': { en: 'Kanji Constellations', ja: '漢字星座', describe: 'One hundred kanji Mastered.' },
  'fifty-three': { en: 'Fifty-Three Stations', ja: '五十三次', describe: 'Reach Station 10, Hakone.' },
  'lantern-river': { en: 'Lantern River', ja: '灯籠流し', describe: 'One hundred training days in total.' },
  'sumi-dragon': { en: 'Sumi Dragon', ja: '墨龍', describe: 'Sixty training days in total.' },
  okaeri: { en: 'Welcome Back', ja: 'おかえり', describe: 'A flame restored from embers, a streak repaired, or a Welcome Back finished.' },
  'vs-wall': { en: 'VS Screen', ja: '対戦画面', describe: 'Reach Station 25, Nissaka. The Wall begins.' },
  'wall-broken': { en: 'Beyond the Wall', ja: '壁を越えて', describe: 'The Brown Shinsa passed.' },
  tanabata: { en: 'Tanabata', ja: '七夕', describe: '365 training days in total.' },
  'hanko-garden': { en: 'Hanko Garden', ja: '判子の庭', describe: 'Twenty-five Mon earned.' },
  'fuji-ridge': { en: 'Fuji Ridge', ja: '富士の線', describe: 'The Green Shinsa passed.' },
  'koi-dragon': { en: 'Dragon Gate', ja: '登竜門', describe: 'The Purple Shinsa passed.' },
  'shoji-light': { en: 'Shōji Light', ja: '障子', describe: 'One hundred grammar patterns Mastered.' },
  'insert-coin': { en: 'Insert Coin', ja: '筐体', describe: 'A Rapid Fire run of 50 correct.' },
  daruma: { en: 'Daruma', ja: '達磨', describe: 'The Blue Shinsa passed. The right eye waits for Shodan.' },
  'vending-night': { en: 'Vending Machine Night', ja: '自販機の夜', describe: 'Three hundred katakana words Mastered.' },
  onsen: { en: 'Onsen Steam', ja: '温泉の湯気', describe: 'Ten planned rest days taken.' },
  waveform: { en: 'Waveform', ja: '聴写の波形', describe: 'The Golden Ear Mon earned.' },
  'golden-screen': { en: 'Golden Screen', ja: '金屏風', describe: 'Nidan, the second dan.' },
  festival: { en: 'Festival Night', ja: '祭り', describe: 'Sandan, the third dan.' },
  'station-sign': { en: 'Station Sign', ja: '駅名標', describe: 'Any Gatekeeper passed.' },
  'kyoto-arrival': { en: 'Kyoto Arrival', ja: '京の橋', describe: 'The Shodan Shinsa passed.' },
  'road-continues': { en: 'The Road Continues', ja: '無限の道', describe: 'Jūdan: one thousand training days and 1,500 ledger hours.' },
  'end-card': { en: 'End Card', ja: 'つづく', describe: 'One hundred sessions.' },
  // design 08 §11: ledger listen hours, dojo rows and outside rows alike; one chōchin per ten.
  'chaya-lanterns': { en: 'Teahouse Lanterns', ja: '茶屋の灯', describe: 'One hundred hours of listening in the ledger, dojo and world together. A lantern for every ten.' },
};

export const S = {
  badges: BADGES,
  wallpapers: WALLPAPERS,

  // Badge tiers and categories (Collections filters, Dojo shelf labels)
  tierBronze: 'Bronze',
  tierSilver: 'Silver',
  tierGold: 'Gold',
  categoryKana: 'Kana',
  categoryStreak: 'Flame',
  categoryTraining: 'Training',
  categoryRoad: 'Road',
  categoryBelt: 'Belts',
  categoryInput: 'Input',
  categoryOutput: 'Output',
  categoryMastery: 'Mastery',
  categorySpirit: 'Spirit',

  // Wallpaper states
  wallpaperLocked: 'Locked. A sumi silhouette until then.',
  wallpaperLiving: 'Living piece: redrawn from your current state.',
  wallpaperReveal: 'Quadrant {q} of 4 revealed.',
  wallpaperReforge: 'Same picture, new brush.',
  darumaNoEyes: 'Both eyes blank.',
  darumaLeftEye: 'Left eye painted at the Blue Shinsa.',
  darumaBothEyes: 'Both eyes painted. Shodan.',

  // Perapera Index (design 05 §11)
  peraperaVocab: '語彙',
  peraperaEar: '耳',
  peraperaRead: '読',
  peraperaMouth: '口',
  peraperaRegister: '場',
  peraperaVocabEn: 'Vocabulary',
  peraperaEarEn: 'Ear',
  peraperaReadEn: 'Reading',
  peraperaMouthEn: 'Mouth',
  peraperaRegisterEn: 'Register',
  peraperaUnavailable: '—',
  flagSynthetic: '(synthetic)',
  flagEstimated: '(estimated)',
  flagNoVoice: '(no voice)',
  explainVocab: 'Retrievability summed over {rec} receptive and {prod} productive word cards.',
  // 耳 (design 08 §12). `explainEarCap` is filled by store/perapera.ts with {cap, goal, app, ext, reach}: `goal` is the
  // top step of EAR_CAP_STEP_HOURS, `app` the dojo's authentic minutes / 60, `ext` the ledger's outside listen + watch
  // hours, `reach` the hours the dojo alone can carry (the corpus-walking test keeps it honest).
  explainEar: "Listening tier {tier} of 5 at {acc} % dictation accuracy. Synthetic: every voice in the dojo is a VOICEVOX character voice. The ledger's outside hours are real people.",
  explainEarNoData: 'Listening tier {tier} of 5. No dictation lines yet, so the floor applies.',
  explainEarCap:
    'Held at {cap} until {goal} h of authentic-style listening: {app} h in the dojo (bridge, casual talk, news, lectures at full speed, understood) + {ext} h outside so far. The dojo alone can carry you to about {reach} h; the rest is the world.',
  explainEarComp: 'Understood on first hearing: {passed} of {sets} texts ({rate} %). Counts from ten first hearings; 80 % reads as full, 0 % as half.',
  explainEarTier: 'Tier {tier} of 5: the fastest clean set so far ran at {rate}×. The dial may sit higher; the radar reads the tier you have shown.',
  explainRead: 'Best Speed Read {cpm} cpm; 500 cpm reads as 100.',
  explainReadNoData: 'No Speed Read yet.',
  explainMouthRecognition: 'Shadow pass rate {rate} % and {wpm} words in one minute, by recognition.',
  explainMouthSelf: 'Shadow self-pass rate {rate} % and {n} of 30 monologues. Estimated: the self-assessment path.',
  explainMouthOff: 'Voice features are off. Nothing to read here yet.',
  explainRegister: 'Role-play best answers {best} % and Say It Three Ways accuracy {acc} %.',
  explainRegisterUnavailable: 'Opens at Station 21, Okabe, where register switching begins.',
  compositeNote: 'Composite is the mean of the axes with data.',

  // Projected Arrival (design 02 §6.2)
  projectionTooEarly: 'Projected Arrival appears after 14 active days. Until then the onboarding estimates stand.',
  projectionQuotaNote: 'Stations not yet loaded are counted from their quotas.',
  projectionAtPace: 'at your current pace',
  projectionDaily: 'at daily practice',
  projectionBand: 'give or take 20 %',
  arrivalTarget: 'Sanjō Ōhashi',
} as const;

/** Fill `{slot}` placeholders in a template. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
