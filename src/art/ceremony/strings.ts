/**
 * TSUZUKU — reward ceremony copy (group G, Sensei voice: terse, warm, dry;
 * design 01 §3, 02 §2, 06 §2–§4). Linted by `src/i18n/banned.test.ts`.
 *
 * Plain strings; `{slot}` placeholders are filled by the components with
 * `fill()` from `../strings`. Japanese appears only where the learner can
 * read it at that moment (station and belt names, つづく at Shodan). Mon and
 * Kakejiku are glossed (crest, scroll) where the learner first meets them.
 */
import type { Belt } from '../../content/types';

export const S = {
  // Host
  dialogLabel: 'Ceremony',
  continue: 'Continue',
  skipHint: 'Tap, Enter or Esc to continue.',
  announceBadge: 'Mon crest earned: {ja}, {en}. {describe}',
  announceBelt: '{belt} belt. {title}. The gate was yours.',
  announceWallpaper: 'Kakejiku scroll unlocked: {ja}, {en}.',
  announceReveal: 'A quarter more of {en} revealed, {q} of 4.',
  announceStamp: 'Goshuin for {station} pressed into the book.',
  announceLevel: 'Level {n}. Effort, counted.',
  announceSummary: 'More rewards wait in your Collections.',

  // Level toast
  levelLabel: 'Lv',
  levelLine: 'Level {n}. Effort, counted.',
  levelNote: 'Level is effort. Belt is skill.',

  // Overflow summary
  summaryTitle: 'The rest of today',
  summaryLine: 'Several things arrived at once. They are all in your Collections.',
  summaryBadges: '{n} Mon',
  summaryWallpapers: '{n} kakejiku',
  summaryStamps: '{n} goshuin',
  summaryLevels: '{n} level',
  openCollections: 'Open Collections',

  // Badge slam
  badgeEarned: 'Mon · crest earned',
  badgeCrestAlt: '{ja} crest',
  tierBronze: 'Bronze',
  tierSilver: 'Silver',
  tierGold: 'Gold',
  strandKana: 'Kana',
  strandStreak: 'Flame',
  strandTraining: 'Training',
  strandRoad: 'Road',
  strandBelt: 'Belts',
  strandInput: 'Input',
  strandOutput: 'Output',
  strandMastery: 'Mastery',
  strandSpirit: 'Spirit',
  saveImage: 'Save as image',
  saving: 'Drawing…',
  saved: 'Saved.',
  savedOpened: 'Opened in a new tab. Press and hold the image to save it.',
  saveUnavailable: 'This browser cannot draw the image. Try a current desktop browser.',
  saveFailed: 'The brush slipped. Try once more.',
  shareCardTitle: 'TSUZUKU · 紋',
  shareFilePrefix: 'tsuzuku-mon',

  // Belt ceremony
  beltTitle: '{belt} belt',
  beltRank: 'Rank',
  beltSensei: 'Level is effort. Belt is skill. This one is skill.',
  beltNextLantern: 'Next lantern',
  beltRoadEnd: 'Sanjō Ōhashi',
  beltRoadEndJa: '三条大橋',
  beltSealAlt: 'Your name seal, {name}',
  beltKnotAlt: 'A {belt} belt tying its knot',
  beltThumbAlt: 'Your new kakejiku, {name}',
  beltLanternsAlt: 'The road: the next lantern turns vermilion',
  beltVignettes: {
    white: 'The road begins at Nihonbashi. Nothing to hand over yet; the first gate is at Shinagawa.',
    yellow:
      'At the inn below Odawara castle the innkeeper sets a folded yellow belt on the tray beside your tea. "The road from Nihonbashi is short on the map," she says, "and long on the feet. You walked it." Outside, the lanterns of Hakone are already lit.',
    orange:
      'Snow on the Kanbara road. The innkeeper shakes it from your coat and hands you an orange belt, still warm from the brazier. "Six gates. You answered every keeper in their own words." He pours. The N5 road is behind you; the Satta Pass waits at dawn.',
    green:
      'The Ōi River has no bridge; porters carry travellers across on their shoulders. On the far bank at Kanaya the innkeeper is waiting with a green belt. "You crossed on your own feet," she says. "From here, the stories carry you." Second Wind begins.',
    blue:
      'The Arai checkpoint stamps your papers without a word. Inside the inn the keeper lays out a blue belt and says only: "The first wall is behind you. The plateau is wide, and the plateau is where the hands learn." A daruma on the shelf has one eye painted.',
    purple:
      'The long bridge at Okazaki, two hundred and eight spans. The innkeeper counts them with you, then hands over a purple belt. "Assistant master. You explain words with words now, in Japanese." The dictionary stays closed.',
    brown:
      'Clear sky over Kameyama after snow. The innkeeper bows a little lower than before and gives you a brown belt. "Master. The wall you climbed at Nissaka is rubble behind you." On the Road, the last stretch to Kyoto is seven stations.',
    black:
      'Sanjō Ōhashi, dusk. No inn, only the bridge and the river. An old man you have never met hands you a black belt without ceremony and walks on. Shodan. Kyoto was never the end; it was the first place to rest. The road continues. つづく',
  } as Record<Belt, string>,

  // Wallpaper unlock
  wallpaperUnlocked: 'Kakejiku · scroll unlocked',
  wallpaperRevealed: 'A quarter more revealed',
  revealCount: '{q} of 4',
  openStudio: 'Open in the Studio',
  previewPending: 'The full piece waits in the Studio.',
  previewLoading: 'Grinding ink…',
  scrollAlt: 'A hanging scroll unrolling to show {name}',

  // Stamp press
  stampTitle: 'Goshuin',
  stampTitleJa: '御朱印',
  stampStation: 'Station {n}',
  stampBehind: 'The gate is behind you.',
  stampPerfect: 'Pressed in gold. A perfect gate.',
  stampAssisted: 'A grey corner until the Revenge Match.',
  stampAlt: 'Goshuin stamp for station {n}, {name}',
  stampUnknownStation: 'the road',

  // The era date under a seal (design 09 §7 E): 令和8年10月18日 with its Latin gloss beneath
  eraGloss: '{era}{y} · {mon} {d}',
  eraNames: { 令和: 'Reiwa', 平成: 'Heisei', 昭和: 'Shōwa' } as Record<string, string>,
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  /** Kana readings of BELTS[*].titleJa for the `<Ruby>` line from Green kana on (design 09 §3.3; romaji below Green). */
  beltTitleKana: { white: 'みならい', yellow: 'にゅうもん', orange: 'もんかせい', green: 'ちゅうけん', blue: 'しはんだいこうほ', purple: 'しはんだい', brown: 'しはん', black: 'たつじん' } as Record<Belt, string>,

  // Shared
  nameless: '無名',
} as const;
