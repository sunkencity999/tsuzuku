/**
 * TSUZUKU — Records and Input Ledger copy (group B, Sensei voice: terse,
 * warm, dry; design 01 §3). Linted by `src/i18n/banned.test.ts`.
 *
 * Plain strings only; `{slot}` templates are filled with `fill()` from
 * `shared/ui/strings`. Numbers are never red and never counted down
 * (design 02 §6.2). Self-reported hours always carry "(reported)" (05 §9).
 */
import type { LedgerKindName } from '../shared/store-types';

export const S = {
  /* ── Records page ───────────────────────────────────────────────── */
  recordsTitle: 'Records',
  recordsTitleJa: '記録',
  recordsLede: 'Level = effort. Belt = skill. Perapera = fluency. Three numbers, three meanings.',
  toLedger: 'Open the Input Ledger',

  // Stat tiles
  daysTrained: 'Days trained',
  minutesTrained: 'Minutes in the dojo',
  reviews: 'Graded reviews',
  retention7: 'Accuracy, last 7 days',
  retention30: 'Accuracy, last 30 days',
  noReps: 'No graded reviews yet.',
  honesty: 'Honesty',
  honestyJa: '正直度',
  honestyLine: 'The inspector checks everyone. {pct} % over {n} inspections.',
  honestyCalibrated: 'Well calibrated.',
  honestyNone: 'No inspections yet. The inspector appears on self-graded answers.',

  // Activity
  activityTitle: 'Last four weeks',
  activityTitleJa: '四週間',
  activityCaption: 'Days trained, oldest first. Darker is more reps.',
  activeOf28: '{n} of 28 days active',
  repsPerDay: 'Reviews per day',
  minutesPerDay: 'Minutes per day',
  dayLabel: '{date}: {reps} reviews, {minutes} min',
  dayIdle: '{date}: rest',

  // Forecast
  forecastTitle: 'Tomorrow, roughly',
  forecastTitleJa: '明日',
  forecastDue: 'Reviews due',
  forecastNew: 'New items at your setting',
  forecastKata: 'Kata, 3 min',
  forecastKumite: 'Kumite, 10 min',
  forecastShugyo: 'Shugyō, 30 min',
  forecastMinutes: '{n} min',
  forecastNote: 'Estimated from your median speed per rep. The gatekeeper caps what a day shows.',

  // Projected Arrival
  projectionTitle: 'Projected Arrival',
  projectionTitleJa: '三条大橋まで',
  projectionLine: '{target}: {pace} at your current pace · {daily} at daily practice.',
  projectionBand: 'Give or take 20 %: {from} to {to}.',
  projectionPace: 'Last 28 days: {active} active, about {rate} new items per active day.',
  projectionQuota: 'Stations not loaded yet are counted from their quotas.',
  projectionTooEarly: 'Projected Arrival appears after 14 active days. Until then, the onboarding estimates stand.',
  projectionActiveSoFar: '{n} of 14 active days so far.',
  onboardingLine: 'Sanjō Ōhashi: {d100} at daily practice · {d70} at seven days in ten.',
  onboardingHours: 'About {h} in-app hours at your setting. The rest of fluency happens outside the app, in the ledger.',
  beltTimeline: 'Belt timeline',
  beltPassed: '{belt} belt · passed {date}',
  beltAhead: '{belt} belt · {pace} at your pace · {daily} at daily practice',
  beltCurrentMark: 'current',
  /** The White belt's band is kana, not a JLPT level; lower-case like RoadNav. */
  levelKana: 'kana',
  arrivalMeansTitle: 'What arrival means',
  arrivalMeans:
    'Sanjō Ōhashi is the N1 core: 6,350 words, 1,000 kanji, 450 patterns, 137 graded texts. Reading N1 texts comfortably also needs the jōyō remainder, about 1,136 more kanji and 3,500 more words, plus the hours in the ledger. The road continues past Kyoto.',

  // Perapera
  peraperaTitle: 'Perapera Index',
  peraperaTitleJa: 'ぺらぺら指数',
  peraperaComposite: 'Composite',
  peraperaCompositeNote: 'Mean of the axes with data.',
  peraperaNow: 'Now',
  peraperaLastMonth: 'Last month',
  peraperaNoHistory: 'The first monthly snapshot is taken at the next day roll. History builds from there.',
  peraperaHistoryTitle: 'Month by month',
  peraperaFlagsLabel: 'Flags',
  peraperaFlagSynthetic: "Synthetic: every voice in the dojo is a VOICEVOX character voice. The ledger's outside hours are real people.",
  peraperaFlagEstimated: 'Estimated: the self-assessment path, not recognition.',
  peraperaFlagNoVoice: 'No voice: speaking features are off, so 口 is left out of the composite.',
  peraperaFlagReported: 'Reported: ledger hours are self-reported and not verified.',

  // Weak Points
  weakTitle: 'Weak Points',
  weakTitleJa: '弱点',
  weakLede: 'Error rate per tag, smoothed. A tag above 20 % with enough attempts gets a three-minute set in your next Shugyō.',
  weakActive: 'in training',
  weakConquered: 'conquered',
  weakPeak: 'peak {pct} %',
  weakAttempts: '{n} attempts',
  weakTooFew: 'too few attempts to say',
  weakNoneActive: 'No weak points right now. The map fills in as you train.',
  weakTrain: 'Train a Weak Point set',
  weakCellLabel: '{tag}: {pct} % error rate over {n} attempts',

  // Kage
  kageTitle: 'Kage',
  kageTitleJa: '影',
  kageLede: 'Your weekly ghost: last week you versus this week you.',
  kageWins: 'Beaten {n} times',
  kageWinsOne: 'Beaten once',
  kageBest: 'Best of the last four weeks: {n}',
  kageNone: 'No Kage sets yet. The first one is drawn after a week of training.',
  kageWeek: 'Week of {date}: {score}',
  kageScores: 'Kage scores by week',

  // Kiai
  kiaiTitle: 'Kiai',
  kiaiTitleJa: '気合',
  ippon: 'Ippon',
  bestCombo: 'Best combo',
  recoveries: 'Recoveries',
  kiaiNote: 'Ippon criteria are public: a mature card, fast and clean. No dice anywhere.',

  // Reading & speaking
  readingTitle: 'Reading and speaking',
  readingTitleJa: '読と口',
  readingBest: 'Best Speed Read: {cpm} cpm, with the question answered right.',
  readingNone: 'No Speed Read yet.',
  readingNote: 'The save keeps the best run, not a history, so this number is a ceiling rather than an average.',
  speakingUntested: 'Speaking: untested so far. Shadow a line or speak a monologue and the 口 axis starts reading.',
  speakingLines: 'Shadow lines: {lines}, passed {pass}. Monologues: {n}.',

  // Next step
  nextTitle: 'What to do next',
  nextFirst: 'The road starts at Nihonbashi. One Kata opens it.',
  nextBacklog: 'The gatekeeper holds the line. {shown} of your {due} reviews today; the rest wait without penalty.',
  nextDue: '{n} reviews are due. A Kata takes the first of them.',
  nextDueOne: '1 review is due. A Kata takes it.',
  nextWeak: 'A weak point is active: {tag}. A Shugyō carries the set.',
  nextLedger: 'The week is {h} h of {target} h outside the app. Log what you listen to.',
  nextRest: 'Nothing is due. A Kata keeps the hands warm; rest is also training.',

  /* ── Ledger page ────────────────────────────────────────────────── */
  ledgerTitle: 'Input Ledger',
  ledgerTitleJa: '耳目帳',
  ledgerLede: 'Hours of listening, reading, watching and speaking. Outside hours are self-reported and say so; dojo hours are counted by the app.',
  reported: '(reported)',
  toRecords: 'Back to Records',

  // The dojo's share (design 08 §12): informational beside the external ring, never part of the target
  weekDojo: 'In the dojo this week: {h} h heard',
  weekDojoNote: 'Informational. The ring counts outside hours only.',
  dojoVoicesTitle: 'The dojo’s voices',
  dojoVoicesTitleJa: '声',
  honestShare:
    'Every voice in the dojo is synthetic: VOICEVOX character voices, pre-rendered, clear and consistent on purpose. The dojo holds about 31 hours of sentences and texts, plus about 3 hours of word and phrase clips for drills, and gives you about 60–75 hours of worthwhile listening over the road, because each piece returns at rising speed. That covers about two-thirds of the weekly listening target at White and Yellow and all of it at Orange, about a quarter at Green, a sixth at Blue and Purple and a tenth at Brown and Black. Real people mumble, overlap and joke; the ledger’s outside hours exist for that, and the 1,500-hour goal still needs the world.',

  // Lifetime
  lifetimeTitle: 'Lifetime',
  lifetimeTotal: 'Hours logged',
  lifetimeGoal: '1,500-hour milestone',
  lifetimeGoalLine: '{h} h of 1,500 h. The marker stands past Kyoto, on the Dan road.',
  kyotoMarker: 'Around Kyoto: roughly 400 h by arrival',
  lifetimeBySource: 'By source',
  sourceApp: 'In the app',
  sourceExternal: 'Outside',
  byKind: 'By kind',
  hoursShort: '{h} h',

  // Week
  weekTitle: 'This week',
  weekRing: '{h} h of {target} h outside the app this week',
  weekTargetNote: 'The weekly target rises with your belt: {target} h at {belt}.',
  weekMet: 'Target met. Anything more is a gift to future you.',
  weeksTitle: 'Last twelve weeks',
  weeksCaption: 'Minutes per week by kind, oldest first.',
  weekLabel: 'Week of {date}',

  // Add entry
  addTitle: 'Log outside input',
  addMinutes: 'Minutes',
  addKind: 'Kind',
  addNote: 'Note (optional)',
  addNoteHint: 'A word you met, a thing you could not say. It goes to your bookmarks.',
  addSubmit: 'Add to the ledger',
  addQuick: 'Quick taps',
  addQuickLabel: '{n} minutes',
  addDone: 'Logged. {n} minutes of {kind} on the ledger.',
  addZero: 'Minutes must be above zero.',
  addXpNote: 'XP: one per outside minute, capped at sixty a day; five per entry, capped at four entries. The hours count without limit.',

  // Today
  todayTitle: 'Today',
  todayNone: 'Nothing logged today.',
  todayRow: '{minutes} min {kind} · {source}',
  editMinutes: 'Edit minutes',
  save: 'Save',
  cancel: 'Cancel',
  edited: 'Entry updated.',

  // Missions
  missionsTitle: 'Field Missions',
  missionsTitleJa: '他流試合',
  missionsLede: 'The real world is the final exam. Report a mission and its minutes go to the ledger.',
  missionAvailable: 'Available',
  missionLocked: 'From {belt} belt',
  missionTier: 'Tier {n}',
  missionConversation: 'A real conversation',
  missionMinutes: 'Minutes',
  missionLog: 'Report',
  missionLogged: 'Reported. {n} minutes on the ledger.',
  missionsDone: '{n} missions reported',
  missionsDoneOne: '1 mission reported',
  conversationsDone: '{n} conversations',
  conversationOne: '1 conversation',
  missionLogTitle: 'Mission log',
  missionLogRow: '{date}: tier {tier}{conv}',
  missionLogConv: ', a conversation',
  missionLogNone: 'No missions reported yet.',

  // Notes
  notesTitle: 'Bookmarks',
  notesLede: 'Things you met outside the app.',
  notesNone: 'No bookmarks yet.',

  /* ── Shared ─────────────────────────────────────────────────────── */
  loading: 'Walking there.',
  tableView: 'Table view',
  value: 'Value',
  label: 'Label',
  percent: '{n} %',
  legend: 'Legend',
  chartAxes: 'Axes',
  chartNow: 'now',
  chartHistory: 'earlier',
  radarLabel: 'Perapera radar: {axes}',
  sparkLabel: '{label}: latest {last}, highest {max}',
  heatLabel: 'Heat map',
  calendarLabel: 'Days trained calendar',
  stackLabel: 'Stacked bars',
  barLabel: '{label}: {value} of {max}',
  ringLabel: '{pct} % of the weekly target',
  milestone: 'milestone',
  unavailable: '—',
} as const;

/** English month names for "March 2027" style dates. */
export const MONTHS: readonly string[] = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const MONTHS_SHORT: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ledger kinds: label, glyph (so color is never the only signal), chart series class. */
export const LEDGER_KIND: Record<LedgerKindName, { label: string; glyph: string; series: string }> = {
  listen: { label: 'listening', glyph: '耳', series: 'listen' },
  read: { label: 'reading', glyph: '読', series: 'read' },
  watch: { label: 'watching', glyph: '目', series: 'watch' },
  speak: { label: 'speaking', glyph: '口', series: 'speak' },
};

export const BELT_EN: Record<string, string> = {
  white: 'White',
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  black: 'Black',
};
