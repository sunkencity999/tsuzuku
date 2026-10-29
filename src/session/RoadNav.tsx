/**
 * TSUZUKU — `<RoadNav>`: the Tōkaidō as a scrolling vertical road (design 01
 * §4.4 "Road Nav", 02 §1, 06 §4; design 09 §7 D Tōchaku, §3.3 signage, §10 C2).
 *
 *  - 53 stations from `STATIONS`, Nihonbashi above, Sanjō Ōhashi below, in one
 *    list (the complete index: every station reachable here). Belt bands
 *    separate the segments.
 *  - THE SPINE is one SVG path (`.tokaido__spine-walked`, `pathLength="1"`)
 *    over the road, in the belt colour (`--belt-color`), from Nihonbashi to the
 *    current station; the road ahead is a second, grey path. Its ends are
 *    measured from the DOM (a `ResizeObserver` where there is one) because row
 *    heights are content.
 *  - Every row is a `.sign` (motion.css: number · ordinal 第N宿 · brush name ·
 *    the reading · the English state word). The reading follows design 09
 *    §3.3: romaji while the learner's belt (`profile.belt`, the store) is below
 *    Green, kana as `<Ruby>` over the name from Green on — removed, not dimmed;
 *    the same gate holds for the where-line and the two end nodes. A `tap`
 *    furigana setting reads as `always` on signage (`signRubyMode`): no
 *    tap-to-reveal ruby inside a link, no extra tab stop. The readings are
 *    computed here (`kanaReading`, the session tier's copy of
 *    `src/art/road/reading.ts`, held equal by its test) so no reading ever
 *    waits on the art chunk. Towns ahead say `ahead`, never "locked".
 *  - Marker per state: cleared = goshuin seal (gold frame when perfect, grey
 *    corner when assisted), current = the chōchin lantern (the kit's, on a
 *    `.seal` span so `transitions.ts`'s `station-seal` hero finds it), ahead =
 *    a dashed number. The vignette beside each row is a kit motif from
 *    `src/art/road` on the `--road` band; ahead rows are an ink wash.
 *  - THE GALLERY (prints B3, `@/art/prints`): once the print pack's manifest
 *    is here every row — and both end nodes, 0 Nihonbashi and 54 Sanjō Ōhashi
 *    — leads with the station's own print as a 96 × 72 `<PrintFigure
 *    variant="thumb">` in the vignette's place (`data-print` on the row widens
 *    its column): passed rows in colour, the current row with the vermilion
 *    ring, rows ahead in ink only (the figure's `ahead` state — the colour is
 *    the arrival's reward, nothing says "locked"). The thumbs are decorative
 *    (the link's label names the station), deferred by the browser, and the
 *    rows out of view keep skipping layout, so a 55-row list fetches nothing
 *    it does not show. Under the data saver (`settings.dataSaver` or the
 *    browser's Save-Data, design 08 §13) every thumb keeps its 24 px preview
 *    alone — no `<img>`, no button — and the gallery is coloured for no bytes
 *    beyond the manifest. Without a pack the kit vignette stays as it was.
 *  - MOMENT D (§7 D), on the first Road view with `current > stationSeen`:
 *    0 the spine hiku-draws (`--dur-4`); 900 the passed station's seal osu then
 *    kawaku with `stamp` (its haptic is the recipe's); 1,100 the new lantern
 *    tomosu (gold lamp, Night glow twin on `::before`) and the row's `.sign`
 *    settles (`data-arrived`); 1,500 at ≥ 600 px the current row's 160 px
 *    bokashi band is revealed (`data-shown`: a clip-path wipe — its box is
 *    reserved from mount so the list never shifts; with a print the row holds
 *    its thumb instead, whose picture waits as its preview under
 *    `data-arriving` and fades in at this beat); then
 *    `progress.stationSeen` is patched once — at beat 3, or on unmount when
 *    the learner leaves mid-ceremony, so it never replays. Sound: `scroll` on
 *    the first arrival, `submit` after; silent in Zen. Reduced motion: spine,
 *    seal and lantern complete at once, the row keeps a gold hairline
 *    (`data-arrived`), the patch happens at once.
 *  - The art tier is reached through a deferred glob (`pages.ts optional()` idiom:
 *    the session group may not import `src/art` statically, ARCHITECTURE §0);
 *    rows render their text at once and the pictures land a tick later.
 *  - Every station is a real link (`href()`), one roving tab stop; arrow keys
 *    walk the road, Home/End jump, Enter/Space open. Mounting never scrolls.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toHiragana } from 'wanakana';
import { PrintFigure, printForStation, useArtManifest, type PrintState } from '@/art/prints';
import type * as RoadArt from '@/art/road';
import { BELTS, BELT_IDS, NIHONBASHI, SANJO_OHASHI, STATIONS, type Belt } from '../content/types';
import { saveDataRequested, sfx } from '../shared/audio';
import { href } from '../shared/routes';
import type { FuriganaMode } from '../shared/store-types';
import { Ruby } from '../shared/ui/Ruby';
import { prefersReducedMotion } from '../shared/ui/use-reveal';
import { store } from '../store';
import { BELT_NAME } from './engine-strings';
import { S, fill } from './pages/strings';
import './RoadNav.css';

export interface RoadNavProps {
  /** Current station 0–53 (0 = Nihonbashi, nothing started). */
  current: number;
  cleared: number[];
  assisted: number[];
  /** Additive: stations passed at 100 % (gold frame). */
  perfect?: number[];
  onPick(n: number): void;
  /** Additive: `progress.stationSeen` — the Tōchaku moment plays once while `current` is beyond it. */
  stationSeen?: number;
  /** Additive: multiplies the arrival beats (tests pass 0). */
  tempo?: number;
}

export type StationState = 'cleared' | 'perfect' | 'assisted' | 'current' | 'locked';

export function stationState(n: number, p: Pick<RoadNavProps, 'current' | 'cleared' | 'assisted' | 'perfect'>): StationState {
  if (p.cleared.includes(n)) {
    if (p.assisted.includes(n)) return 'assisted';
    if (p.perfect?.includes(n)) return 'perfect';
    return 'cleared';
  }
  return n === p.current ? 'current' : 'locked';
}

export const STATE_LABEL: Record<StationState, string> = {
  cleared: S.stateCleared,
  perfect: S.statePerfect,
  assisted: S.stateAssisted,
  current: S.stateCurrent,
  locked: S.stateLocked,
};

/* ── signage rules (design 09 §3.3) ─────────────────────────────────────── */

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 1–99 in kanji numerals (一 … 五十三). */
export function kanjiNumeral(n: number): string {
  const v = Math.max(0, Math.min(99, Math.floor(Number.isFinite(n) ? n : 0)));
  if (v < 10) return KANJI_DIGITS[v]!;
  const tens = Math.floor(v / 10);
  const ones = v % 10;
  return `${tens === 1 ? '' : KANJI_DIGITS[tens]}十${ones === 0 ? '' : KANJI_DIGITS[ones]}`;
}

/** 第N宿 (Shippori shell glyphs) for a station 1–53; `''` off the road. */
export function ordinalJa(n: number): string {
  return n >= 1 && n <= 53 ? `第${kanjiNumeral(n)}宿` : '';
}

const GREEN_INDEX = BELT_IDS.indexOf('green');

/** Romaji on signage only while the belt is below Green (design 09 §3.3). */
export function romajiAllowed(belt: Belt): boolean {
  const i = BELT_IDS.indexOf(belt);
  return i >= 0 && i < GREEN_INDEX;
}

/** Signage inside a link never renders a tap-to-reveal ruby: `tap` reads as `always` (a name cannot be sounded out). */
export function signRubyMode(mode: FuriganaMode): FuriganaMode {
  return mode === 'tap' ? 'always' : mode;
}

/** Native spellings the romaji cannot carry (long vowels, づ), keyed by the content's romaji — the same table as src/art/road/reading.ts. */
const KANA_OVERRIDE: Readonly<Record<string, string>> = {
  Ōiso: 'おおいそ',
  Numazu: 'ぬまづ',
  Fuchū: 'ふちゅう',
  Chiryū: 'ちりゅう',
  Shōno: 'しょうの',
  Ōtsu: 'おおつ',
  'Sanjō Ōhashi': 'さんじょうおおはし',
};
const PLAIN_VOWEL: Record<string, string> = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o', Ā: 'A', Ī: 'I', Ū: 'U', Ē: 'E', Ō: 'O' };

/** Hiragana reading of a romaji place name (`STATIONS[n].nameRomaji`); `''` when it is not fully convertible. */
export function kanaReading(romaji: string): string {
  const t = romaji.trim();
  if (t === '') return '';
  const fixed = KANA_OVERRIDE[t];
  if (fixed) return fixed;
  const k = toHiragana(t.replace(/[āīūēōĀĪŪĒŌ]/g, (m) => PLAIN_VOWEL[m] ?? m));
  return /[A-Za-z]/.test(k) ? '' : k;
}

/** `{nameJa|reading}` for `<Ruby>` from Green on; the plain name when no reading exists. */
export function rubyMarkup(nameJa: string, romaji: string): string {
  const k = kanaReading(romaji);
  return k ? `{${nameJa}|${k}}` : nameJa;
}

/** The reading of a name for a plain text line: romaji below Green, kana after. */
function readingLine(nameJa: string, romaji: string, romajiOk: boolean): string {
  const r = romajiOk ? romaji : kanaReading(romaji);
  return r ? `${nameJa} ${r}` : nameJa;
}

/* ── the art tier, on demand ──────────────────────────────────────────────── */

export type RoadArtModule = typeof RoadArt;

const ROAD_ART_FILE = '/src/art/road/index.ts';
const ROAD_ART = import.meta.glob<RoadArtModule>('/src/art/road/index.ts');
let artPromise: Promise<RoadArtModule | null> | null = null;
let artCache: RoadArtModule | null = null;

/** The road art barrel, once; `null` when it is not built or fails to load (the road still works, without pictures). */
export function loadRoadArt(): Promise<RoadArtModule | null> {
  if (!artPromise) {
    const loader = ROAD_ART[ROAD_ART_FILE];
    artPromise = loader
      ? loader().then(
          (m) => {
            artCache = m;
            return m;
          },
          () => null,
        )
      : Promise.resolve(null);
  }
  return artPromise;
}

/** The art module, synchronously once loaded, else after one tick. */
export function useRoadArt(): RoadArtModule | null {
  const [art, setArt] = useState<RoadArtModule | null>(artCache);
  useEffect(() => {
    if (art) return;
    let alive = true;
    loadRoadArt().then((m) => {
      if (alive && m) setArt(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return art;
}

/** Arcade Night: the lamps are lit (theme.ts writes `data-color-scheme` before first render). */
export function isNight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-color-scheme') === 'dark';
}

/* ── the arrival (design 09 §7 D) ───────────────────────────────────────── */

/** Beats in ms from mount: the spine draws from 0. */
export const ARRIVAL_BEATS = { seal: 900, lantern: 1100, band: 1500 } as const;

export interface Arrival {
  /** `current > stationSeen`: the moment plays. */
  arriving: boolean;
  /** No arrival has ever been shown: the `scroll` fanfare instead of `submit`. */
  first: boolean;
}

export function arrivalFor(current: number, stationSeen: number | undefined): Arrival {
  const seen = Math.max(0, Math.floor(stationSeen ?? 0));
  return { arriving: current >= 1 && current > seen, first: seen === 0 };
}

const WIDE_QUERY = '(min-width: 600px)';

function matchWide(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches;
  } catch {
    return false;
  }
}

/** `true` at ≥ 600 px, where the current row grows its band; false without `matchMedia`. */
function useWide(): boolean {
  const [wide, setWide] = useState(matchWide);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(WIDE_QUERY);
    const on = (): void => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}

function play(name: 'stamp' | 'scroll' | 'submit'): void {
  try {
    if (store.settings.peek().feel === 'zen') return;
  } catch {
    /* no store: still play */
  }
  sfx(name);
}

/** The ONE shared wet-ink def while a seal dries (motion.css `.ink-wet::after` → `url(#ink-bleed-8)`). */
function InkDefs(): JSX.Element {
  return (
    <svg class="tokaido__defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="ink-bleed-8" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="8" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" result="disp" />
        <feGaussianBlur in="disp" stdDeviation="0.7" result="soft" />
        <feComponentTransfer in="soft">
          <feFuncA type="linear" slope="1.25" intercept="0" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

/* ── component ──────────────────────────────────────────────────────────── */

const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);
/** Ōtsu, the last station with a number; the arrival past it is the pack's stop 54 (`src/art/road END_NUMBER`). */
const LAST_STATION = 53;
const END_STOP = 54;

function levelLabel(b: (typeof BELTS)[number]): string {
  return b.level === 'kana' ? S.levelKana : b.level.toUpperCase();
}

interface SpineGeometry {
  /** Fractions of the road's height: the start seal's centre and the current marker's centre. */
  start: number;
  end: number;
}

export function RoadNav(p: RoadNavProps): JSX.Element {
  const current = Math.max(0, Math.min(53, Math.floor(p.current)));
  const focusStation = current >= 1 ? current : 1;
  const [focusN, setFocusN] = useState(focusStation);
  const links = useRef(new Map<number, HTMLAnchorElement>());
  const roadRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLSpanElement>(null);
  const art = useRoadArt();
  // the print pack's manifest: `null` until it lands, and for the session when there is none (the kit vignettes stay)
  const prints = useArtManifest();
  const wide = useWide();
  // the store's theme and belt: a read subscribes this render to theme and belt changes
  const settings = store.settings.value;
  const learnerBelt = store.profile.value.belt;
  const romaji = romajiAllowed(learnerBelt);
  const rubyMode = signRubyMode(settings.furigana);
  // `@/audio`'s dataSaverOn() body (design 08 §13): the thumbs keep their previews alone — no image, no button to ask with
  const dataSaver = settings.dataSaver === true || saveDataRequested();
  const lit = isNight();
  const reduced = prefersReducedMotion();

  // the arrival is decided once per mount: the patch below changes `stationSeen` under us
  const arrival = useRef<Arrival>(arrivalFor(current, p.stationSeen)).current;
  const tempo = Math.max(0, p.tempo ?? 1);
  const [beat, setBeat] = useState(arrival.arriving && !reduced ? 0 : 3);
  const finished = useRef(false);

  useEffect(() => {
    setFocusN(focusStation);
  }, [focusStation]);

  /** The one store write: `stationSeen` catches up with `station`; a second call is a no-op. */
  const finish = (): void => {
    if (finished.current) return;
    finished.current = true;
    store.patch('progress', (pr) => (pr.stationSeen === pr.station ? pr : { ...pr, stationSeen: pr.station }));
  };

  // the beats; leaving the Road mid-ceremony counts as having seen it (the moment never replays)
  useEffect(() => {
    if (!arrival.arriving || reduced) return;
    const timers = [
      setTimeout(() => setBeat((b) => Math.max(b, 1)), ARRIVAL_BEATS.seal * tempo),
      setTimeout(() => setBeat((b) => Math.max(b, 2)), ARRIVAL_BEATS.lantern * tempo),
      setTimeout(() => setBeat((b) => Math.max(b, 3)), ARRIVAL_BEATS.band * tempo),
    ];
    return () => {
      timers.forEach(clearTimeout);
      finish();
    };
  }, []);

  // sound and the store write ride the beats (reduced motion lands on 3 at once)
  const passed = current - 1;
  const sealToPress = arrival.arriving && p.cleared.includes(passed) ? passed : null;
  const lastBeat = useRef(-1);
  useEffect(() => {
    if (!arrival.arriving) return;
    const from = lastBeat.current;
    lastBeat.current = beat;
    if (from < 1 && beat >= 1 && sealToPress !== null) play('stamp');
    if (from < 2 && beat >= 2) play(arrival.first ? 'scroll' : 'submit');
    if (beat >= 3) finish();
  }, [beat]);

  // the spine's ends, from the DOM
  const [geom, setGeom] = useState<SpineGeometry | null>(null);
  useLayoutEffect(() => {
    const road = roadRef.current;
    if (!road) return;
    const measure = (): void => {
      const H = road.offsetHeight;
      const start = startRef.current;
      const end = current >= 1 ? links.current.get(current)?.querySelector<HTMLElement>('.tokaido__marker') : start;
      if (!H || !start || !end) {
        setGeom(null);
        return;
      }
      const top = road.getBoundingClientRect().top;
      const s = start.getBoundingClientRect();
      const e = end.getBoundingClientRect();
      setGeom({ start: (s.top + s.height / 2 - top) / H, end: (e.top + e.height / 2 - top) / H });
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure);
      ro.observe(road);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [current, art, prints]);

  const jump = (): void => {
    const el = links.current.get(focusStation);
    if (!el) return;
    setFocusN(focusStation);
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  };

  const clearedCount = STATIONS.filter((st) => p.cleared.includes(st.number)).length;
  const currentDef = STATIONS.find((st) => st.number === current);
  const belt: Belt = currentDef?.belt ?? 'white';
  const where = currentDef
    ? fill(S.whereAmI, { n: current, name: readingLine(currentDef.nameJa, currentDef.nameRomaji, romaji), belt: BELT_NAME[belt], cleared: clearedCount })
    : fill(S.whereAmIStart, { belt: BELT_NAME[belt], cleared: clearedCount });

  const move = (from: number, to: number): void => {
    const target = Math.max(1, Math.min(53, to));
    if (target === from) return;
    setFocusN(target);
    links.current.get(target)?.focus();
  };

  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLElement>): void => {
    if (!NAV_KEYS.has(e.key)) return;
    const el = e.target as HTMLElement | null;
    const n = Number(el?.getAttribute?.('data-station'));
    if (!Number.isFinite(n) || n < 1) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') move(n, n + 1);
    else if (e.key === 'ArrowUp') move(n, n - 1);
    else if (e.key === 'Home') move(n, 1);
    else move(n, 53);
  };

  const drawing = arrival.arriving && !reduced && beat < 3;
  const bandShown = !arrival.arriving || beat >= 3;
  const lanternLit = !arrival.arriving || beat >= 2;
  const lanternMark = useMemo(() => art?.lanternMark() ?? '', [art]);
  const rubyOf = useMemo(() => new Map(STATIONS.map((st) => [st.number, rubyMarkup(st.nameJa, st.nameRomaji)])), []);
  const spineD = geom ? `M0.5 ${geom.start.toFixed(4)} V${geom.end.toFixed(4)}` : 'M0.5 0 V0';
  // the ends' prints: Nihonbashi is `here` before the first step and passed after; Sanjō Ōhashi is ahead until Ōtsu is cleared
  const startPrint = prints ? printForStation(prints, 0) : null;
  const endPrint = prints ? printForStation(prints, END_STOP) : null;

  /** A name with its reading for the two end nodes: brush JA, then romaji below Green or the kana ruby after. */
  const endName = (end: { nameJa: string; nameRomaji: string }, english: string): JSX.Element => (
    <>
      <span lang="ja">{romaji ? end.nameJa : <Ruby ja={rubyMarkup(end.nameJa, end.nameRomaji)} mode={rubyMode} />}</span>
      {romaji ? <span class="tokaido__node-reading">{end.nameRomaji}</span> : null}
      <span>{english}</span>
    </>
  );

  const rows: JSX.Element[] = [];
  for (const b of BELTS) {
    rows.push(
      <li key={`band-${b.id}`} class="tokaido__band" data-belt={b.id}>
        <span class={`belt belt--${b.id}`}>
          <span lang="ja">{b.nameJa}</span> {b.nameEn}
        </span>
        <span class="tokaido__band-line">{fill(S.bandLabel, { belt: b.nameEn, from: b.stations[0], to: b.stations[1], level: levelLabel(b) })}</span>
      </li>,
    );
    for (const st of STATIONS) {
      if (st.belt !== b.id) continue;
      const n = st.number;
      const state = stationState(n, p);
      const isCurrent = state === 'current';
      const label = fill(S.stationAria, { n, name: st.nameJa, romaji: st.nameRomaji, belt: BELT_NAME[st.belt], state: STATE_LABEL[state] });
      const sealBase = state === 'locked' ? 'seal seal--locked' : state === 'perfect' ? 'seal seal--perfect' : state === 'assisted' ? 'seal tokaido__seal--assisted' : 'seal';
      const pressing = sealToPress === n && !reduced && beat >= 1 && beat < 3;
      const sealClass = pressing ? `${sealBase} ink-osu ink-wet is-dry` : sealBase;
      // the station's print leads the row when the pack is here; else the kit vignette, and for the current row at
      // ≥ 600 px the band, whose box is reserved from mount (no layout step at beat 3) and revealed at the beat
      const print = prints ? printForStation(prints, n) : null;
      const band = isCurrent && wide && !print;
      const rowState = state === 'locked' ? 'ahead' : isCurrent ? 'current' : 'cleared';
      const thumbState: PrintState = state === 'locked' ? 'ahead' : isCurrent ? 'here' : 'passed';
      const vignette = art && !print ? (band ? art.bandVignette(n, { lit }) : art.rowVignette(n, rowState, { lit })) : '';
      const arrived = arrival.arriving && isCurrent && (reduced || beat >= 2);
      rows.push(
        <li key={st.id} class="tokaido__row" data-belt={st.belt} data-state={state} data-arrived={arrived ? '' : undefined} data-band={band ? '' : undefined} data-print={print ? '' : undefined}>
          <a
            class="tokaido__station"
            href={href({ name: 'station', n })}
            data-station={n}
            data-state={state}
            aria-label={label}
            aria-current={isCurrent ? 'step' : undefined}
            tabIndex={n === focusN ? 0 : -1}
            ref={(el) => {
              if (el) links.current.set(n, el);
              else links.current.delete(n);
            }}
            onClick={(e) => {
              e.preventDefault();
              setFocusN(n);
              p.onPick(n);
            }}
          >
            <span class="tokaido__marker" aria-hidden="true">
              {isCurrent ? (
                <span class={`seal tokaido__lantern${arrival.arriving && !reduced && beat >= 2 ? ' ink-tomosu' : ''}`} data-lit={lanternLit ? '' : undefined}>
                  <svg viewBox="0 0 32 32" width="32" height="32" focusable="false" dangerouslySetInnerHTML={{ __html: lanternMark }} />
                </span>
              ) : (
                <span class={sealClass} lang="ja">
                  {state === 'locked' ? n : S.stampGlyph}
                </span>
              )}
            </span>
            {print ? (
              <PrintFigure print={print} variant="thumb" state={thumbState} decorative dataSaver={dataSaver} class="tokaido__print" />
            ) : (
              <svg
                class={`tokaido__art${band ? ' tokaido__art--band' : ''}`}
                viewBox={band ? '0 0 160 160' : '0 0 48 40'}
                width={band ? 160 : 48}
                height={band ? 160 : 40}
                preserveAspectRatio="xMidYMax meet"
                aria-hidden="true"
                focusable="false"
                data-shown={band && bandShown ? '' : undefined}
                dangerouslySetInnerHTML={{ __html: vignette }}
              />
            )}
            <span class="sign tokaido__sign">
              <span class="sign__number">{n}</span>
              <span class="sign__ordinal" lang="ja" aria-hidden="true">
                {ordinalJa(n)}
              </span>
              <span class="sign__ja" lang="ja">
                {romaji ? st.nameJa : <Ruby ja={rubyOf.get(n) ?? st.nameJa} mode={rubyMode} />}
              </span>
              {romaji ? <span class="sign__reading">{st.nameRomaji}</span> : null}
              <span class="sign__en">{STATE_LABEL[state]}</span>
            </span>
          </a>
        </li>,
      );
    }
  }

  return (
    <nav class="tokaido" aria-label={S.roadNavAria} data-belt={belt} data-arriving={arrival.arriving && beat < 3 ? '' : undefined}>
      <p class="tokaido__where" aria-live="polite">
        {where}
      </p>
      <p class="tokaido__hint">{S.keyboardHint}</p>
      <button type="button" class="btn btn--ghost btn--sm tokaido__jump" onClick={jump}>
        {S.jumpToCurrent}
      </button>
      {sealToPress !== null && !reduced && beat >= 1 && beat < 3 ? <InkDefs /> : null}
      <div class="tokaido__road" ref={roadRef}>
        <svg class="tokaido__spine" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path class="tokaido__spine-ahead" d="M0.5 0 V1" pathLength="1" vector-effect="non-scaling-stroke" />
          <path class={`tokaido__spine-walked${drawing ? ' ink-hiku' : ''}`} data-axis={drawing ? 'stroke' : undefined} d={spineD} pathLength="1" stroke-dasharray="1" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="tokaido__node tokaido__node--start" data-belt="white">
          <span class="seal seal--round" lang="ja" aria-hidden="true" ref={startRef}>
            橋
          </span>
          {startPrint ? <PrintFigure print={startPrint} variant="thumb" state={current === 0 ? 'here' : 'passed'} decorative dataSaver={dataSaver} class="tokaido__print" /> : null}
          {endName(NIHONBASHI, S.startNodeEn)}
        </div>
        <ol class="tokaido__list" onKeyDown={onKey}>
          {rows}
        </ol>
        <div class="tokaido__node tokaido__node--arrival" data-belt="black">
          <span class="seal seal--round" lang="ja" aria-hidden="true">
            京
          </span>
          {endPrint ? <PrintFigure print={endPrint} variant="thumb" state={p.cleared.includes(LAST_STATION) ? 'here' : 'ahead'} decorative dataSaver={dataSaver} class="tokaido__print" /> : null}
          {endName(SANJO_OHASHI, S.arrivalNodeEn)}
        </div>
      </div>
    </nav>
  );
}
