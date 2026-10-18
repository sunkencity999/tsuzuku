/**
 * TSUZUKU — road art copy (design 09 §7 D, §10 C2; Sensei voice, design 01 §3).
 *
 * The 53 vista names and notes (English only — every Japanese name on the road
 * comes from `content/types STATIONS`, so no kanji lives here), the genkan
 * strip's three state words and its label, and the `ahead` word the Station
 * headpiece puts on the towns beyond. Linted by `src/i18n/banned.test.ts`:
 * the road never says "locked", never counts down.
 */

export interface VistaCopy {
  /** The short vista name that rides inside 次回予告's Gatekeeper line ("Hill Keeper · Fuji view"). */
  name: string;
  /** One line for the Station headpiece's accessible description. */
  note: string;
}

/** Index = station number 1–53 (0 unused). After Hiroshige's Hōeidō series, public domain. */
export const VISTA_COPY: readonly VistaCopy[] = [
  { name: '', note: '' },
  { name: 'Tide at the bay', note: 'The first bay beyond Edo; boats at low tide.' },
  { name: 'Ferry crossing', note: 'The Rokugō ferry across the river.' },
  { name: 'Harbour terrace', note: 'Teahouses on the slope above the harbour.' },
  { name: 'Shinmachi bridge', note: 'The road bends over a small bridge toward the hills.' },
  { name: 'Dawn at the inn', note: 'Travellers leave the inn before sunrise.' },
  { name: 'Grove and torii', note: 'The torii of Enoshima stands among pines.' },
  { name: 'Fuji beyond the plain', note: 'Mount Kōrai and, far behind, Fuji.' },
  { name: 'Shore pines', note: 'Pines lean over the beach in a passing rain.' },
  { name: 'River before the castle', note: 'Porters wade the Sakawa River under the castle.' },
  { name: 'The mountain checkpoint', note: 'The steep pass and the checkpoint by the lake.' },
  { name: 'Shrine in the mist', note: 'The shrine torii at dawn, half in fog.' },
  { name: 'Moon over the harbour', note: 'A full moon over the river road into town.' },
  { name: 'Fuji view', note: 'Fuji at its tallest over the Hara marshes.' },
  { name: 'Fuji on the left', note: 'The road bends and Fuji appears on the left.' },
  { name: 'Snow at night', note: 'Deep snow on the village roofs at night.' },
  { name: 'Fuji from the pass', note: 'Fuji across the bay from the Satta cliffs.' },
  { name: 'Kiyomi shore', note: 'The river mouth and the bay at Kiyomi.' },
  { name: 'Boats in the gust', note: 'Sails on the bay beyond the Miho pines.' },
  { name: 'Abe River crossing', note: 'Porters carry travellers across the Abe River.' },
  { name: 'The tororo teahouse', note: 'A thatched teahouse famous for grated yam.' },
  { name: 'The narrow pass', note: 'A stream through a dark gorge of cedars.' },
  { name: 'Changing horses', note: 'Porters change loads at the relay station.' },
  { name: 'The Ōi River', note: 'Travellers ford the wide Ōi River on porters.' },
  { name: 'Far bank', note: 'The far bank of the Ōi and the hills beyond.' },
  { name: 'The night-crying stone', note: 'A steep pass and the stone of legend.' },
  { name: 'Kite in the wind', note: 'A kite over the Akiha road in autumn wind.' },
  { name: 'Outdoor teahouse', note: 'A kettle on a tripod beside the road.' },
  { name: 'Tenryū ferry', note: 'Ferry boats on the Tenryū River.' },
  { name: 'Winter field', note: 'A fire in a bare field under a great pine.' },
  { name: 'Imagire strait', note: 'The strait at Imagire and Fuji far away.' },
  { name: 'The lake checkpoint', note: 'Ferry boats carry travellers to the checkpoint.' },
  { name: 'Shiomi slope', note: 'The sea seen from the Shiomizaka hill.' },
  { name: 'The hill teahouse', note: 'A teahouse on the Saru-ga-Baba moor.' },
  { name: 'Toyokawa bridge', note: 'The long bridge below Yoshida castle.' },
  { name: 'Inn at dusk', note: 'Maids call travellers into the inns at dusk.' },
  { name: 'Lanterns of the inn', note: 'An inn courtyard lit by lanterns.' },
  { name: 'Edge of town', note: 'A procession passes the town boundary post.' },
  { name: 'Yahagi bridge', note: 'The longest bridge of the road, before the castle.' },
  { name: 'Horse market', note: 'Horses tethered under a great pine.' },
  { name: 'Dyed cloth shops', note: 'Shops of tie-dyed cloth along the street.' },
  { name: 'Festival at the shrine', note: 'A festival race by torchlight at the shrine.' },
  { name: 'The seven-ri ferry', note: 'Boats arrive at the castle landing.' },
  { name: 'Wind on the river', note: 'A hat blows away over the Mie River.' },
  { name: 'The temple gate', note: 'The temple of Yakushi among the fields.' },
  { name: 'Sudden shower', note: 'Travellers run from a sudden rain on the slope.' },
  { name: 'Snow clearing', note: 'A clear morning after snow below the castle.' },
  { name: 'Early departure', note: 'An inn party sets out before dawn.' },
  { name: 'The brush-throwing peak', note: 'A view so fine a painter threw his brush.' },
  { name: 'Spring rain', note: 'A procession crosses a bridge in spring rain.' },
  { name: 'Drying gourds', note: 'Women dry strips of gourd outside the houses.' },
  { name: 'The Megawa teahouse', note: 'A lively teahouse by the village road.' },
  { name: 'The fork', note: 'Where the Nakasendō joins; a busy teahouse.' },
  { name: 'The running spring', note: 'Carts pass the Hashirii teahouse near the lake.' },
];

export const S = {
  /** The genkan strip (design 09 §9 B1 / C2): three towns at the door. */
  genkanLabel: 'The road at the door',
  townPassed: 'passed',
  townHere: 'here',
  townAhead: 'ahead',
  /** The Station headpiece: `{name}` is the vista name, `{note}` its line. */
  headpieceLabel: '{name}. {note}',
  /** Towns beyond the current one on the headpiece (never "locked"). */
  ahead: 'ahead',
} as const;

/** `{key}` placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
