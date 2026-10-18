/**
 * TSUZUKU — `<GenkanStrip>`: the road at the Dojo's door (design 09 §9 B1 → C2,
 * §12.1 decision 33): three towns — the one passed, the current station in the
 * middle, the one ahead — each a `.sign` (motion.css contract: __number
 * __ordinal __ja __reading __en) over a 48 × 32 kit vignette on the --road band.
 *
 *  - Japanese names only from `content/types` (STATIONS, NIHONBASHI,
 *    SANJO_OHASHI); the ordinal 第N宿 for 1–53 in the Mincho shell glyphs.
 *  - The reading follows §3.3: romaji while the belt is below Green
 *    (`romajiAllowed`), kana as `<Ruby>` over the name after — removed, not
 *    dimmed; a `tap` furigana setting reads as `always` here (`signRubyMode`:
 *    no interactive ruby inside the link). The English state word (passed ·
 *    here · ahead) is always there. The two ends carry no station number: 0
 *    and 54 are not numbers a learner meets anywhere else.
 *  - ≤ 60 nodes in all, no filter (GenkanStrip.test.tsx); the vignettes ask the
 *    kit for motifs of ≤ 6 nodes. Each town carries `data-belt` so its --road
 *    band follows the station's belt (road.css).
 *  - Class names are the Dojo's (`dojo__genkan`, `dojo__town`, `dojo__town-link`)
 *    so B1's rules in src/app/pages/pages.css keep styling the strip; the
 *    vignette's band is `road.css`.
 */
import type { JSX } from 'preact';
import { NIHONBASHI, SANJO_OHASHI, STATIONS, type Belt } from '../../content/types';
import { href } from '../../shared/routes';
import type { FuriganaMode } from '../../shared/store-types';
import { Ruby } from '../../shared/ui/Ruby';
import { ordinalJa, romajiAllowed, rubyMarkup, signRubyMode } from './reading';
import { rowVignette, type RowState } from './row';
import { S } from './strings';
import './road.css';

export const GENKAN_MAX_NODES = 60;
/** The arrival point past Station 53. */
export const END_NUMBER = 54;

/** The three towns around `station`: 0 = Nihonbashi, 54 = Sanjō Ōhashi; the ends yield two. */
export function townNumbers(station: number): number[] {
  const s = Math.max(0, Math.min(53, Math.floor(Number.isFinite(station) ? station : 0)));
  return [s - 1, s, s + 1].filter((n) => n >= 0 && n <= END_NUMBER);
}

export interface Town {
  n: number;
  ja: string;
  romaji: string;
  /** 1–53: a station with an ordinal; the two ends have none. */
  onRoad: boolean;
  href: string;
  /** The station's belt (white at Nihonbashi, black at Sanjō Ōhashi): the town's --road band. */
  belt: Belt;
}

export function townOf(n: number): Town {
  const st = STATIONS.find((s) => s.number === n);
  if (st) return { n, ja: st.nameJa, romaji: st.nameRomaji, onRoad: true, href: href({ name: 'station', n }), belt: st.belt };
  const end = n <= 0 ? NIHONBASHI : SANJO_OHASHI;
  return { n, ja: end.nameJa, romaji: end.nameRomaji, onRoad: false, href: href({ name: 'road' }), belt: n <= 0 ? 'white' : 'black' };
}

export type TownState = 'passed' | 'here' | 'ahead';

const WORD: Record<TownState, string> = { passed: S.townPassed, here: S.townHere, ahead: S.townAhead };
const ROW_STATE: Record<TownState, RowState> = { passed: 'cleared', here: 'current', ahead: 'ahead' };

export interface GenkanStripProps {
  station: number;
  /** The learner's belt (the romaji rule reads it). */
  belt: Belt;
  furigana: FuriganaMode;
  /** Lanterns lit (Arcade Night). */
  lit?: boolean;
}

export function GenkanStrip(p: GenkanStripProps): JSX.Element {
  const romaji = romajiAllowed(p.belt);
  const mode = signRubyMode(p.furigana);
  return (
    <ol class="dojo__genkan" aria-label={S.genkanLabel}>
      {townNumbers(p.station).map((n) => {
        const t = townOf(n);
        const state: TownState = n < p.station ? 'passed' : n === p.station ? 'here' : 'ahead';
        return (
          <li key={n} class="dojo__town" data-town={n} data-belt={t.belt} data-state={state} aria-current={state === 'here' ? 'step' : undefined}>
            <svg class="dojo__town-art" viewBox="0 0 48 32" width="48" height="32" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: rowVignette(n, ROW_STATE[state], { w: 48, h: 32, lit: p.lit, maxNodes: 6 }) }} />
            <a class="sign dojo__town-link" href={t.href}>
              {t.onRoad ? (
                <>
                  <span class="sign__number">{n}</span>
                  <span class="sign__ordinal" lang="ja" aria-hidden="true">
                    {ordinalJa(n)}
                  </span>
                </>
              ) : null}
              <span class="sign__ja" lang="ja">
                {romaji ? t.ja : <Ruby ja={rubyMarkup(t.ja, t.romaji)} mode={mode} />}
              </span>
              {romaji ? <span class="sign__reading">{t.romaji}</span> : null}
              <span class="sign__en">{WORD[state]}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
