/**
 * TSUZUKU — `<EndCard>`: the つづく card every session ends on (design 03 §10, §12; 01 §1, §5;
 * design 09 §7 B Shūhitsu and the End-Card side of §7 C Kadode, owner B2).
 *
 * The sumi stage in both themes (`--stage-*`). Beats, ms since mount
 * (`END_CARD_BEATS`; reduced motion jumps to the last beat at once, and so does
 * any tap on the card or any key — 01 §4.5 "always skippable", 09 §6.1):
 *   0      the page dims to `--stage-bg` (`.end-card::before`, the one fixed
 *          stage layer; the card itself is transparent so phones dim too)
 *   300    つづく is WRITTEN — the brush glyphs sit under an SVG `<mask>` whose
 *          brush-shaped stroke draws itself (stroke-dasharray / dashoffset, the
 *          `hiku` verb at 4/3 × `--dur-4` = 1,200 ms) synced to `sfx('tsuzuku')`
 *          (silent in Zen). Under reduced motion the mask is absent and the glyphs
 *          fade in whole at `--dur-fade`. `.end-card__brush` is the `tsuzuku-mark`
 *          hero `transitions.ts` carries into the Dojo hearth on "Rest." (§7 C).
 *   1,500  tally tiles (`.sheet`) nijimi in with `--i`; every value is a Dela
 *          `<Ticker>` counting up from 0 (≤ TICKER_MAX_MS) — the XP delta is "the
 *          number that matters" (§12.1 decision 4). The DOM carries the FINAL
 *          tally from the first paint (hidden until its beat): at the beat each
 *          Ticker is remounted at 0 and set to its value in the same frame, so
 *          the roll is visual only and readers and tests always see the number
 *   2,100  item belts flip (A1's `belt-flip`, components.css), one `promotion`
 *          koto pair per flip, `--stagger` apart (cap 8); what B granted lists
 *   2,400  a lantern for today: `<Lantern>` catches beside the flame line (tomosu,
 *          once); its English word is the shell's, the longer sentence is its
 *          visually hidden `detail`
 *   2,700  次回予告 — 03 §10's three lines, the masked ??? last with one gold
 *          pulse; the omikuji (in `--font-ja`: Mincho is fenced, §3.1); notes; the
 *          ledger prompt; "Good training. Rest." and, small, "The dojo keeps your
 *          place."; the Hanko: "Another Kata?" only while reviews remain, else "Rest."
 *
 * Sound: `tsuzuku` once at 300, `promotion` under the flips, nothing else — no
 * BEST eyebrow or recipe on this card (BEST lives in arcade results and Records).
 * No exit interception of any kind. Day one of a Welcome Back shows the preview
 * only. Promoted items are named by their surface (`itemHead`), never by raw id,
 * with their reading and English beside (`itemGloss`); the earned rows' marks
 * (紋 印 帯 軸) are aria-hidden spans labelled by the row's English.
 */
import type { JSX } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { content as appContent, type ContentLoader } from '../content/loader';
import type { ContentItem } from '../content/types';
import type { BadgeId, WallpaperId } from '../shared/catalog';
import { QUESTS } from '../shared/catalog';
import { sfx } from '../shared/audio';
import type { JikaiYokoku, SessionResult } from '../shared/session-types';
import type { LedgerKind, LedgerKindName } from '../shared/store-types';
import { LEDGER_KINDS } from '../shared/store-types';
import { BELT_LABEL } from '../shared/ui/strings';
import { Lantern, type LanternState } from '../shared/ui/Lantern';
import { Ruby } from '../shared/ui/Ruby';
import { Ticker } from '../shared/ui/Ticker';
import { prefersReducedMotion } from '../shared/ui/use-reveal';
import { BADGE_DEFS, WALLPAPER_DEFS, addLedgerEntry, store } from '../store';
import { dueCount, streakState, type FlameState } from '../store/derived';
import { BELT_NAME, S as ENGINE } from './engine-strings';
import { ledgerPromptDue, omikuji, type CeremonyEvent, glossOf, sentenceGloss } from './end-card';
import { ES } from './end-card-strings';
import { itemHead } from './item-head';
import { S, fill } from './strings';
import './EndCard.css';

export interface EndCardProps {
  result: SessionResult;
  /** `null` while the preview is still being read; the card renders the rest meanwhile. */
  yokoku: JikaiYokoku | null;
  /** Lines from `endCardNotes()` plus anything the page adds (Kage result, …). */
  notes: string[];
  onAnother(): void;
  onRest(): void;
  /** Additive: the runner's `ceremonies` (B's reward events during this session). */
  ceremonies?: readonly CeremonyEvent[];
  /** Additive: content source the promoted items are named through (`runner.contentLoader`; default: the app loader). */
  loader?: ContentLoader;
}

export const LEDGER_MINUTES: readonly number[] = [10, 20, 30, 60];

/* ── beats (design 09 §7 B) ─────────────────────────────────────────────── */

/** Start of each beat in ms since mount: stage · brush · tally · belts · lantern · yokoku. */
export const END_CARD_BEATS: readonly number[] = [0, 300, 1500, 2100, 2400, 2700];
export const BEAT = { stage: 0, brush: 1, tally: 2, belts: 3, lantern: 4, yokoku: 5 } as const;
/** Mirrors `--stagger` (tokens.css) and the eight-item cap (§6.3) for the promotion koto pairs. */
export const STAGGER_MS = 40;
export const STAGGER_CAP = 8;

/**
 * Current beat index; beats only move forward; `reduced` starts on the last one (as `useTimeline`). `skip` jumps to
 * the last beat (the end state); `done` is true once there.
 */
function useBeats(at: readonly number[], reduced: boolean): { beat: number; done: boolean; skip(): void } {
  const last = Math.max(0, at.length - 1);
  const [beat, setBeat] = useState(reduced ? last : 0);
  useEffect(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    at.forEach((ms, i) => {
      if (i === 0) return;
      timers.push(setTimeout(() => setBeat((b) => (i > b ? i : b)), Math.max(0, ms)));
    });
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // The beat table and the reduced flag are fixed for the life of a card.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { beat, done: beat >= last, skip: () => setBeat(last) };
}

/** Any key skips the beats while they run (the card holds nothing focusable until the last beat, so the listener is the document's). */
function useKeySkip(active: boolean, skip: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (): void => skip();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, skip]);
}

/* ── the brush ──────────────────────────────────────────────────────────── */

export interface TsuzukuBrush {
  w: number;
  h: number;
  /** Font size of the glyphs in user units. */
  size: number;
  /** The brush stroke's spine: three passes across the glyph box, boustrophedon. */
  points: readonly (readonly [number, number])[];
  strokeWidth: number;
}

/** The spine of the brush-shaped mask: `passes` rows across a text box of `glyphs` em (as BeltCeremony's `kanjiSvg`). */
export function tsuzukuBrush(glyphs = 3, size = 100, passes = 3, spacingEm = 0.08): TsuzukuBrush {
  const tw = glyphs * size + (glyphs - 1) * spacingEm * size;
  const w = Math.round(tw + size * 0.24);
  const h = Math.round(size * 1.2);
  const x0 = w / 2 - tw / 2 - size * 0.18;
  const x1 = w / 2 + tw / 2 + size * 0.18;
  const top = h / 2 - size * 0.52;
  const row = (size * 1.04) / passes;
  const points: [number, number][] = [];
  for (let k = 0; k < passes; k++) {
    const y = top + (k + 0.5) * row;
    if (k % 2 === 0) points.push([x0, y], [x1, y]);
    else points.push([x1, y], [x0, y]);
  }
  return { w, h, size, points, strokeWidth: row * 1.3 };
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/** `M x y L x y …` for the spine. */
export function spinePath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r2(x)} ${r2(y)}`).join(' ');
}

export const TSUZUKU_BRUSH = tsuzukuBrush();

/* ── copy helpers ───────────────────────────────────────────────────────── */

const FLAME_LINE: Record<FlameState, string> = {
  lit: S.flameLit,
  gold: S.flameGold,
  ember: S.flameEmber,
  frozen: S.flameFrozen,
  rest: S.flameRest,
  broken: S.flameBroken,
};

function badgeName(id: BadgeId): string {
  const d = BADGE_DEFS.find((b) => b.id === id);
  return d ? `${d.nameJa} ${d.nameEn}` : id;
}

function wallpaperName(id: WallpaperId): string {
  const d = WALLPAPER_DEFS.find((w) => w.id === id);
  return d ? `${d.nameJa} ${d.nameEn}` : id;
}

function questTitle(id: string): string {
  return QUESTS.find((q) => q.id === id)?.titleEn ?? id;
}

/**
 * Reading and English beside a promoted item's head, so a learner who cannot yet read the head still knows what
 * moved up (house rule: every glyph carries a label). The kana is omitted when it IS the head.
 */
export function itemGloss(item: ContentItem | undefined): { kana?: string; en?: string } {
  if (!item) return {};
  if ('word' in item && typeof item.word === 'string') return { kana: item.kana === item.word ? undefined : item.kana, en: item.meanings[0] };
  if ('pattern' in item) return { en: item.meaning };
  if ('char' in item) return 'meanings' in item ? { kana: item.kun[0] ?? item.on[0], en: item.meanings[0] } : { en: item.name };
  if ('kana' in item && typeof item.kana === 'string' && 'romaji' in item) return { en: item.romaji };
  return {};
}

const isJa = (s: string): boolean => /[^\x00-\x7f]/.test(s);

export interface EarnedLine {
  key: string;
  text: string;
  kind: Exclude<CeremonyEvent['name'], 'quest:completed'>;
  /** The decorative mark before the row (`ES.earnedMark`); the English `text` is its label. */
  mark: string;
}

/** One line per reward event, in the order B granted them. */
export function ceremonyLines(events: readonly CeremonyEvent[]): EarnedLine[] {
  const out: EarnedLine[] = [];
  const push = (key: string, kind: EarnedLine['kind'], text: string): void => {
    out.push({ key, kind, text, mark: ES.earnedMark[kind] });
  };
  events.forEach((e, i) => {
    const key = `${e.name}-${i}`;
    switch (e.name) {
      case 'badge:earned':
        push(key, e.name, fill(S.earnedBadge, { id: badgeName(e.payload.id) }));
        break;
      case 'wallpaper:unlocked':
        push(key, e.name, fill(S.earnedWallpaper, { id: wallpaperName(e.payload.id) }));
        break;
      case 'wallpaper:revealed':
        push(key, e.name, fill(S.earnedQuadrant, { id: wallpaperName(e.payload.id), q: e.payload.quadrant }));
        break;
      case 'stamp:earned':
        push(key, e.name, fill(S.earnedStamp, { n: e.payload.station }));
        break;
      case 'belt:promoted':
        push(key, e.name, fill(S.earnedBelt, { belt: BELT_NAME[e.payload.belt] }));
        break;
      case 'level:up':
        push(key, e.name, fill(S.earnedLevel, { n: e.payload.level }));
        break;
      case 'quest:completed':
        // Quests ticked already appear in the tally.
        break;
    }
  });
  return out;
}

/** The preview sentence with its one masked token wrapped for the gold pulse; the ruby markup around it is untouched. */
function MaskedSentence(p: { ja: string }): JSX.Element {
  const token = ENGINE.maskToken;
  const i = p.ja.indexOf(token);
  if (i < 0) return <Ruby ja={p.ja} mode="always" />;
  const before = p.ja.slice(0, i);
  const after = p.ja.slice(i + token.length);
  return (
    <>
      {before ? <Ruby ja={before} mode="always" /> : null}
      <span class="end-card__mask">{token}</span>
      {after ? <Ruby ja={after} mode="always" /> : null}
    </>
  );
}

const pct1 = (n: number): string => `${Math.round(n)}%`;
const plus = (n: number): string => `+${Math.round(n)}`;
const tenth = (n: number): string => String(Math.round(n * 10) / 10);

/* ── component ──────────────────────────────────────────────────────────── */

export function EndCard(p: EndCardProps): JSX.Element {
  const loader = p.loader ?? appContent;
  // 次回予告's glosses (09 §12.1 d33): the words' English beside their kana, the preview line's English under it
  const sentenceEn = sentenceGloss(p.yokoku?.sentence, (id) => loader.get(id));
  const r = p.result;
  const t = r.tally;
  const zen = r.zen;
  const feel = store.settings.value.feel;
  const reduced = prefersReducedMotion();
  const today = store.today();
  const welcomeDayOne = r.mode === 'welcome';
  const maskId = `${useId()}-tsuzuku`;

  const { beat, done, skip } = useBeats(END_CARD_BEATS, reduced);
  useKeySkip(!done, skip);
  /** A section that has not arrived yet is hidden (not focusable, not read); an item that has arrived bleeds in with its stagger index. */
  const pend = (b: number): string => (beat >= b ? '' : ' is-pending');
  const arrive = (b: number): string => (beat >= b ? ' ink-nijimi' : '');

  // beat 300: the gliss, once, never in Zen
  const played = useRef(false);
  useEffect(() => {
    if (beat < BEAT.brush || played.current) return;
    played.current = true;
    if (!zen) sfx('tsuzuku');
  }, [beat, zen]);

  // beat 2,100: one koto pair per belt flip, --stagger apart, capped like the visual stagger
  const promoted = useRef(false);
  useEffect(() => {
    if (beat < BEAT.belts || promoted.current) return;
    promoted.current = true;
    if (zen || t.promotions.length === 0) return;
    const n = Math.min(t.promotions.length, STAGGER_CAP);
    sfx('promotion');
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < n; i++) timers.push(setTimeout(() => sfx('promotion'), i * STAGGER_MS));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [beat]); // eslint-disable-line react-hooks/exhaustive-deps

  // beat 2,400: the lantern catches once (tomosu lights the glow twin); dropped when its rise ends; never under reduced motion
  const [tomosu, setTomosu] = useState(false);
  const lit = useRef(false);
  useEffect(() => {
    if (beat < BEAT.lantern || reduced || lit.current) return;
    lit.current = true;
    setTomosu(true);
  }, [beat, reduced]);
  const onLanternEnd = (e: AnimationEvent): void => {
    if (e.target === e.currentTarget) setTomosu(false);
  };

  const flame = streakState();
  const lanternState: LanternState = store.streak.value.totalDays === 0 ? 'unlit' : flame;
  const due = dueCount();
  const earned = ceremonyLines(p.ceremonies ?? []);
  const proverb = omikuji(store.seed(), today);

  const [ledgerKind, setLedgerKind] = useState<LedgerKindName>('listen');
  const [ledger, setLedger] = useState<'prompt' | 'logged' | 'dismissed'>(() => (ledgerPromptDue(store.ledger.value, today) ? 'prompt' : 'dismissed'));

  const logMinutes = (minutes: number): void => {
    const kind = Math.max(0, LEDGER_KINDS.indexOf(ledgerKind)) as LedgerKind;
    addLedgerEntry({ day: today, minutes, kind, source: 1 });
    setLedger('logged');
  };

  // beat 1,500: the count-up. `rest` = the final numbers stand (first paint, reduced motion); at the beat the
  // tickers remount at 0 (`arming`, never painted — the layout effect moves on before paint) and roll to the tally.
  const [count, setCount] = useState<'rest' | 'arming' | 'counting'>('rest');
  useEffect(() => {
    if (beat >= BEAT.tally && !reduced && count === 'rest') setCount('arming');
  }, [beat, reduced, count]);
  useLayoutEffect(() => {
    if (count === 'arming') setCount('counting');
  }, [count]);
  const tick = (n: number, format?: (v: number) => string): JSX.Element => (count === 'rest' ? <Ticker value={n} format={format} /> : <Ticker key="count" value={count === 'arming' ? 0 : n} format={format} />);
  const written = beat >= BEAT.brush;
  const b = TSUZUKU_BRUSH;

  const tiles: { key: string; label: JSX.Element | string; value: JSX.Element | string; cls?: string }[] = [
    { key: 'reps', label: S.reps, value: tick(t.reps) },
    { key: 'accuracy', label: S.accuracy, value: t.reps > 0 ? tick(t.accuracy * 100, pct1) : '—' },
    ...(zen
      ? []
      : [
          { key: 'combo', label: S.bestCombo, value: tick(t.bestCombo) },
          {
            key: 'ippon',
            label: (
              <>
                <span lang="ja">一本</span> {S.ippon}
              </>
            ),
            value: tick(t.ippon),
          },
        ]),
    { key: 'xp', label: S.xp, value: tick(t.xp, plus), cls: ' end-card__stat--xp' },
    { key: 'minutes', label: S.minutes, value: tick(t.minutes, tenth) },
  ];

  return (
    <section class="end-card" data-feel={feel} data-mode={r.mode} data-beat={beat} aria-label={S.endCardAria} onClick={done ? undefined : skip}>
      <header class="end-card__head">
        <h1 class={`end-card__brush end-card__tsuzuku${arrive(BEAT.brush)}`} lang="ja" aria-label={S.tsuzuku}>
          <svg class="end-card__brush-svg" viewBox={`0 0 ${b.w} ${b.h}`} aria-hidden="true" focusable="false">
            {reduced ? null : (
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={b.w} height={b.h}>
                  <path
                    class={`end-card__brush-stroke${written ? ' ink-hiku' : ''}`}
                    data-axis="stroke"
                    d={spinePath(b.points)}
                    pathLength="1"
                    stroke-dasharray="1"
                    stroke-dashoffset="1"
                    stroke="#fff"
                    stroke-width={r2(b.strokeWidth)}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    fill="none"
                  />
                </mask>
              </defs>
            )}
            <text class="end-card__brush-text" x={b.w / 2} y={b.h / 2} text-anchor="middle" dominant-baseline="central" font-size={b.size} mask={reduced ? undefined : `url(#${maskId})`}>
              {S.tsuzuku}
            </text>
          </svg>
        </h1>
        <p class={`end-card__sub${pend(BEAT.brush)}`}>{S.toBeContinued}</p>
      </header>

      {welcomeDayOne ? (
        <p class={`end-card__welcome${pend(BEAT.tally)}`}>{S.welcomePreviewOnly}</p>
      ) : (
        <section class={`end-card__tally status-window${pend(BEAT.tally)}`} aria-label={S.tallyTitle}>
          <h2 class="end-card__h">{S.tallyTitle}</h2>
          <dl class="end-card__stats">
            {tiles.map((tile, i) => (
              <div key={tile.key} class={`end-card__stat sheet${tile.cls ?? ''}${arrive(BEAT.tally)}`} style={`--i:${i}`}>
                <dt class="eyebrow">{tile.label}</dt>
                <dd>{tile.value}</dd>
              </div>
            ))}
          </dl>

          {t.promotions.length > 0 ? (
            <div class="end-card__promotions">
              <h3 class="end-card__h3">{S.promotionsTitle}</h3>
              <ul class="end-card__list">
                {t.promotions.map((pr, i) => {
                  const item = loader.get(pr.itemId);
                  const g = itemGloss(item);
                  return (
                    <li key={`${pr.itemId}-${i}`} class="end-card__promotion">
                      <span class="end-card__belt" data-belt={pr.to} data-flip={beat >= BEAT.belts ? '' : undefined} style={`--i:${i}`} aria-hidden="true">
                        <span lang="ja">{BELT_LABEL[pr.to].ja}</span>
                      </span>
                      <span class="end-card__item" lang="ja">
                        {itemHead(item, pr.itemId)}
                      </span>
                      {g.kana ? (
                        <span class="end-card__item-kana" lang="ja">
                          {g.kana}
                        </span>
                      ) : null}
                      {g.en ? <span class="end-card__item-en">{g.en}</span> : null}
                      <span class="end-card__to">{fill(S.promotedTo, { belt: BELT_LABEL[pr.to].en })}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {t.questsDone.length > 0 ? (
            <div class="end-card__quests">
              <h3 class="end-card__h3">{S.questsTitle}</h3>
              <ul class="end-card__list">
                {t.questsDone.map((id) => (
                  <li key={id} class="end-card__quest">
                    <span class="end-card__tick" aria-hidden="true">
                      ✓
                    </span>{' '}
                    {questTitle(id)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      <p class={`end-card__flame${pend(BEAT.lantern)}`} aria-label={S.flameTitle}>
        <Lantern state={lanternState} label={ES.lanternWord[lanternState]} detail={lanternState === 'unlit' ? undefined : FLAME_LINE[flame]} title={S.flameTitle} class={tomosu ? 'ink-tomosu' : undefined} onAnimationEnd={onLanternEnd} />
        <span class="end-card__flame-line">{ES.lanternForToday}</span>
      </p>

      {earned.length > 0 ? (
        <section class={`end-card__earned${pend(BEAT.belts)}`} aria-label={S.earnedTitle}>
          <h2 class="end-card__h">{S.earnedTitle}</h2>
          <ul class="end-card__list">
            {earned.map((e, i) => (
              <li key={e.key} class={`end-card__earned-row${arrive(BEAT.belts)}`} style={`--i:${i}`} data-kind={e.kind}>
                <span class="end-card__earned-mark" aria-hidden="true" lang={isJa(e.mark) ? 'ja' : undefined}>
                  {e.mark}
                </span>
                {e.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section class={`end-card__yokoku${pend(BEAT.yokoku)}`} aria-label={S.yokokuSub}>
        <h2 class="end-card__h end-card__yokoku-h">
          <span lang="ja">{S.yokokuTitle}</span> <span class="muted">{S.yokokuSub}</span>
        </h2>
        {p.yokoku ? (
          <ol class="end-card__yokoku-lines">
            <li class={`end-card__yokoku-line${arrive(BEAT.yokoku)}`} style="--i:0">
              <span class="end-card__yokoku-label eyebrow">{S.yokokuSentence}</span>
              {p.yokoku.sentence ? (
                <span class="end-card__yokoku-ja">
                  <MaskedSentence ja={p.yokoku.sentence.ja} />
                </span>
              ) : (
                <span class="muted">{ES.yokokuNoSentence}</span>
              )}
              {sentenceEn ? <span class="end-card__yokoku-en muted">{sentenceEn}</span> : null}
            </li>
            <li class={`end-card__yokoku-line${arrive(BEAT.yokoku)}`} style="--i:1">
              <span class="end-card__yokoku-label eyebrow">{S.yokokuWords}</span>
              {p.yokoku.words.length > 0 ? (
                <span class="end-card__yokoku-words" lang="ja">
                  {p.yokoku.words.map((w) => {
                    const en = glossOf(loader.get(w.itemId));
                    return (
                      <span key={w.itemId} class="chip end-card__word">
                        {w.kana}
                        {en ? (
                          <span class="end-card__word-en muted" lang="en">
                            {' · '}
                            {en}
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span class="muted">{ES.yokokuNoWords}</span>
              )}
            </li>
            <li class={`end-card__yokoku-line end-card__milestone${arrive(BEAT.yokoku)}`} style="--i:2">
              {p.yokoku.milestone || S.yokokuQuiet}
            </li>
          </ol>
        ) : (
          <p class="end-card__loading muted" role="status">
            {S.endCardLoading}
          </p>
        )}
      </section>

      <p class={`end-card__omikuji${pend(BEAT.yokoku)}${arrive(BEAT.yokoku)}`} style="--i:3">
        <span class="end-card__omikuji-label eyebrow">{S.omikujiLabel}</span>
        <span class="end-card__omikuji-text" lang="ja">
          <Ruby ja={proverb.ja} mode="always" />
        </span>
        <span class="end-card__omikuji-en muted" lang="en">
          {proverb.en}
        </span>
      </p>

      {p.notes.length > 0 ? (
        <ul class={`end-card__notes${pend(BEAT.yokoku)}`} aria-label={S.notesAria}>
          {p.notes.map((n, i) => (
            <li key={i} class="end-card__note">
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      {ledger !== 'dismissed' ? (
        <section class={`end-card__ledger status-window${pend(BEAT.yokoku)}`} aria-label={S.ledgerAria}>
          {ledger === 'logged' ? (
            <p class="end-card__ledger-done" role="status">
              {S.ledgerLogged}
            </p>
          ) : (
            <>
              <p class="end-card__ledger-prompt">{S.ledgerPrompt}</p>
              <div class="end-card__ledger-row">
                <label class="end-card__ledger-kind">
                  <span class="sr-only">{S.ledgerKindAria}</span>
                  <select class="select" value={ledgerKind} onChange={(e) => setLedgerKind((e.currentTarget as HTMLSelectElement).value as LedgerKindName)}>
                    {LEDGER_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {S.ledgerKind[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <div class="end-card__ledger-minutes" role="group" aria-label={S.ledgerAria}>
                  {LEDGER_MINUTES.map((m) => (
                    <button key={m} type="button" class="btn end-card__ledger-btn" data-minutes={m} onClick={() => logMinutes(m)}>
                      {fill(S.ledgerMinutes, { n: m })}
                    </button>
                  ))}
                </div>
                <button type="button" class="btn btn--ghost btn--sm end-card__ledger-dismiss" onClick={() => setLedger('dismissed')}>
                  {S.ledgerDismiss}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <footer class={`end-card__foot${pend(BEAT.yokoku)}`}>
        <p class="end-card__closing">{S.closingLine}</p>
        <p class="end-card__keeps">{ES.dojoKeepsPlace}</p>
        {due > 0 ? <p class="end-card__due muted">{due === 1 ? S.dueRemainingOne : fill(S.dueRemaining, { n: due })}</p> : null}
        <div class="end-card__actions">
          {due > 0 ? (
            <button type="button" class="hanko end-card__another" onClick={() => p.onAnother()}>
              {S.anotherKata}
            </button>
          ) : null}
          <button type="button" class={due > 0 ? 'btn end-card__rest' : 'hanko end-card__rest'} onClick={() => p.onRest()}>
            {S.restButton}
          </button>
        </div>
      </footer>
    </section>
  );
}
