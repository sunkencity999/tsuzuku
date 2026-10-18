/**
 * TSUZUKU — the road art barrel (design 09 §10 C2). The Road, the Station page
 * and the Dojo's genkan reach these through a lazy glob (the `pages.ts
 * optional()` idiom — the session and shell groups may not import the art
 * tier statically, ARCHITECTURE §0), so everything a host needs is exported
 * from here and the chunk loads once, after first paint. `road.css` (the
 * headpiece and strip rules) is imported here so the Station page's picture
 * never depends on GenkanStrip's module being evaluated.
 */
import './road.css';
export { GenkanStrip, townNumbers, townOf, GENKAN_MAX_NODES, END_NUMBER, type GenkanStripProps, type Town, type TownState } from './GenkanStrip';
export { headpiece, headpieceLabel, headpieceWidth, HEADPIECE_HEIGHT, HEADPIECE_MAX_NODES, HEADPIECE_MIN_WIDTH, HEADPIECE_MAX_WIDTH, HEADPIECE_WIDE, SUMI_FILTER_ID, type HeadpieceOptions } from './headpiece';
export { VISTAS, vistaOf, vistaName, onRoad, END_MOTIF, type Vista, type PaletteHint } from './vistas';
export { KANA_OVERRIDE, kanaReading, ordinalJa, romajiAllowed, rubyMarkup, signRubyMode } from './reading';
export { rowVignette, bandVignette, lanternMark, rowMotif, rowPalette, ROW_MAX_NODES, type RowState, type VignetteOptions } from './row';
export { S as ROAD_S, VISTA_COPY } from './strings';
