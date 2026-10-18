/**
 * TSUZUKU — art/wallpaper copy (Sensei voice, design 01 §3).
 * Linted by `src/i18n/banned.test.ts`. Plain strings only; `{name}`-style
 * placeholders are filled by the components. Japanese names carry their
 * English twin so UI can show either.
 */
import type { WallpaperId } from '../shared/catalog';

export const S = {
  // Print Studio / export
  exportPng: 'Export PNG',
  exporting: 'Rendering… {p}%',
  exported: 'Saved {filename}.',
  exportUnavailable: 'This browser cannot draw the image. Try a current desktop browser.',
  exportFailed: 'The brush slipped. Try the export again.',
  iosHint: 'Press and hold the image, then choose Save Image.',
  fourKGated: '4K is for desktop browsers with room to spare. This one stops at 2560 × 1440.',
  sizeDesktop: 'Desktop 16:9',
  sizePhone: 'Phone 9:19.5',
  reforge: 'Reforge',
  reforgeHint: 'Same picture, new brush.',
  reforgeUsed: 'Reforged today. Tomorrow brings another brush.',
  living: 'Living piece. It redraws from your current training.',
  locked: 'Locked. {condition}',
  revealed: '{n} of 4 quadrants revealed.',
  silhouetteAlt: 'Sumi silhouette of {name}',
  wallpaperAlt: '{name}, your kakejiku',
  previewAlt: 'Preview of {name}',

  // Post passes
  postNone: 'Clean',
  postDither: 'Dither',
  postScanlines: 'Scanlines',
  postGrain: 'Grain',

  // Personalization labels
  nameless: '無名',
  dateLabel: 'Date',
  streakLabel: 'Longest streak',
  totalDaysLabel: 'Total training days',
  days: '{n} days',
  sentenceOfChoice: 'A sentence you mastered',
  noSentence: 'Pick a mastered sentence in the Studio.',

  // Export filename stem
  filePrefix: 'tsuzuku',
} as const;

/** Wallpaper names (design 06 §3), English and Japanese. */
export const WALLPAPER_NAMES: Record<WallpaperId, { en: string; ja: string }> = {
  'torii-dawn': { en: 'Torii at Dawn', ja: '朝の鳥居' },
  'kana-grid': { en: 'Gojūon Select', ja: '五十音セレクト' },
  'neon-alley': { en: 'Neon Alley', ja: '電脳横丁' },
  'sakura-storm': { en: 'Sakura Storm', ja: '桜吹雪' },
  'great-wave': { en: 'Great Wave of Words', ja: '文字の大波' },
  'kanji-stars': { en: 'Kanji Constellations', ja: '漢字星座' },
  'fifty-three': { en: 'Fifty-Three Stations', ja: '五十三次' },
  'lantern-river': { en: 'Lantern River', ja: '灯籠流し' },
  'sumi-dragon': { en: 'Sumi Dragon', ja: '墨龍' },
  okaeri: { en: 'Welcome Back', ja: 'おかえり' },
  'vs-wall': { en: 'VS Screen', ja: '対戦画面' },
  'wall-broken': { en: 'Beyond the Wall', ja: '壁を越えて' },
  tanabata: { en: 'Tanabata', ja: '七夕' },
  'hanko-garden': { en: 'Hanko Garden', ja: '判子の庭' },
  'fuji-ridge': { en: 'Fuji Ridge', ja: '富士の線' },
  'koi-dragon': { en: 'Dragon Gate', ja: '登竜門' },
  'shoji-light': { en: 'Shōji Light', ja: '障子' },
  'insert-coin': { en: 'Insert Coin', ja: '筐体' },
  daruma: { en: 'Daruma', ja: '達磨' },
  'vending-night': { en: 'Vending Machine Night', ja: '自販機の夜' },
  onsen: { en: 'Onsen Steam', ja: '温泉の湯気' },
  waveform: { en: 'Waveform', ja: '聴写の波形' },
  'golden-screen': { en: 'Golden Screen', ja: '金屏風' },
  festival: { en: 'Festival Night', ja: '祭り' },
  'station-sign': { en: 'Station Sign', ja: '駅名標' },
  'kyoto-arrival': { en: 'Kyoto Arrival', ja: '京の橋' },
  'road-continues': { en: 'The Road Continues', ja: '無限の道' },
  'end-card': { en: 'End Card', ja: 'つづく' },
  // design 08 §11
  'chaya-lanterns': { en: 'Teahouse Lanterns', ja: '茶屋の灯' },
};

/** `S.x` with `{key}` placeholders replaced. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
