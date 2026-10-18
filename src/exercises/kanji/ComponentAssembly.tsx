/**
 * TSUZUKU — 部品組み Component Assembly (design 04 §3, `kanji:comp`).
 *
 * Meaning + primary reading + a layout frame (`params.layout`: left-right,
 * top-bottom, enclosure) → pick the kanji's 1–5 parts from eight tiles and
 * place them in the slots, then Check (Enter). Grading is set-based: the
 * exact set of parts → Good regardless of order (for a left-right or
 * top-bottom frame a swapped order is still right and only earns a note
 * saying where the first part sits); any other set → Again, tagged
 * `kanji-meaning`; a hint (the mnemonic, which names every part) → Hard
 * ceiling. The mnemonic is shown on completion.
 *
 * Parts come from `content.components()` (names → `ComponentDef` glyphs),
 * distractors are a seeded sample of the component pool (`params.distractorIds`
 * first when given). A fast path skips the loader: `params.accept` = the
 * answer glyphs in slot order and `params.choices` = the tile glyphs.
 * A kanji that repeats a part (林 = tree + tree, 協, 営, 禁) gets one tile
 * per occurrence: the 2nd+ copy carries an `#n` key suffix so each copy is
 * placed once and the set compare behaves as a multiset compare.
 * Digits 1–8 pick tiles through the enclosing `<ExerciseFrame>`; its `?` /
 * Hint button shows the mnemonic.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import type { ComponentDef, ContentItem, KanjiItem } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor, shuffle, type Rng } from '@/shared/hash';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { attempt } from '../check';
import { useFlip } from '../flip';
import { S as SD } from '../strings';
import { S, fill } from './strings';
import './kanji.css';

export const meta: ExerciseMeta = {
  id: 'component-assembly',
  facet: 'comp',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

export const TILE_COUNT = 8;

export type Layout = NonNullable<ExerciseProps['step']['params']['layout']>;

export interface Tile {
  /** Stable identity: the component id, or `g:<glyph>` / `name:<keyword>` fallbacks; a repeated part's 2nd+ copy adds `#<n>`. */
  key: string;
  /** What the tile shows (glyph, or the keyword when no glyph is known). */
  char: string;
  /** Canonical keyword when known. */
  name: string;
  /** The tile shows a keyword instead of a glyph (no `ComponentDef` found). */
  text?: boolean;
}

export function isKanjiItem(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i && 'components' in i;
}

function kebab(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Per-occurrence keys: the first copy of `base` is `base`, the n-th is `base#n`. */
function occurrenceKeys(): (base: string) => string {
  const seen = new Map<string, number>();
  return (base) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
}

/** Component keywords → tiles; a keyword with no definition becomes a text tile (honest degradation). A repeated part yields one tile per occurrence. */
export function resolveParts(names: readonly string[], defs: ReadonlyMap<string, ComponentDef>): Tile[] {
  const byName = new Map<string, ComponentDef>();
  for (const d of defs.values()) byName.set(d.name.trim().toLowerCase(), d);
  const keyFor = occurrenceKeys();
  return names.map((n) => {
    const d = byName.get(n.trim().toLowerCase()) ?? defs.get(`c-${kebab(n)}`);
    return d ? { key: keyFor(d.id), char: d.char, name: d.name } : { key: keyFor(`name:${n}`), char: n, name: n, text: true };
  });
}

/** The answer tiles plus seeded distractors from the pool (`preferIds` first), shuffled; never duplicates. */
export function buildTiles(answer: readonly Tile[], defs: ReadonlyMap<string, ComponentDef>, rng: Rng, total = TILE_COUNT, preferIds: readonly string[] = []): Tile[] {
  const taken = new Set(answer.map((t) => t.key));
  const want = Math.max(0, total - answer.length);
  const pool: Tile[] = [];
  const push = (d: ComponentDef): void => {
    if (pool.length >= want || taken.has(d.id)) return;
    taken.add(d.id);
    pool.push({ key: d.id, char: d.char, name: d.name });
  };
  for (const id of preferIds) {
    const d = defs.get(id);
    if (d) push(d);
  }
  for (const d of shuffle(rng, Array.from(defs.values()))) push(d);
  return shuffle(rng, [...answer, ...pool]);
}

/** `params.accept` (answer glyphs) + `params.choices` (tile glyphs) → tiles without the loader; a glyph the answer repeats gets as many tiles. */
export function fastTiles(params: ExerciseProps['step']['params']): { answer: Tile[]; tiles: Tile[] } | null {
  const accept = (params.accept ?? []).map((s) => s.trim()).filter(Boolean);
  const choices = (params.choices ?? []).map((s) => s.trim()).filter(Boolean);
  if (accept.length === 0 || choices.length === 0) return null;
  const count = (list: readonly string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const g of list) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  };
  const need = new Map<string, number>(choices.map((g) => [g, 1]));
  for (const [g, n] of count(accept)) need.set(g, Math.max(need.get(g) ?? 0, n));
  const answerKey = occurrenceKeys();
  const tileKey = occurrenceKeys();
  const tiles: Tile[] = [];
  for (const [g, n] of need) for (let i = 0; i < n; i++) tiles.push({ key: tileKey(`g:${g}`), char: g, name: '' });
  return { answer: accept.map((g) => ({ key: answerKey(`g:${g}`), char: g, name: '' })), tiles };
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = a.slice().sort();
  const y = b.slice().sort();
  return x.every((v, i) => v === y[i]);
}

const LAYOUT_LABEL: Record<Layout, string> = { lr: S.assemblyLayoutLr, tb: S.assemblyLayoutTb, enc: S.assemblyLayoutEnc };
const LAYOUT_WHERE: Record<Layout, string> = { lr: S.assemblyWhereLeft, tb: S.assemblyWhereTop, enc: S.assemblyWhereOutside };

function Reading(p: { kanji: KanjiItem }): JSX.Element | null {
  const on = p.kanji.on[0];
  const kun = p.kanji.kun[0];
  if (on) return <dd lang="ja">{on}</dd>;
  if (!kun) return null;
  const [stem, oku] = kun.split('.');
  return (
    <dd lang="ja">
      {stem}
      {oku ? <span class="kj__okurigana">{oku}</span> : null}
    </dd>
  );
}

type Phase = 'build' | 'done';

export function ComponentAssembly(p: ExerciseProps): JSX.Element {
  const kanji = isKanjiItem(p.item) ? p.item : null;
  const layout: Layout = p.step.params.layout ?? 'lr';
  const params = p.step.params;
  const fast = useMemo(() => fastTiles(params), [params]);
  const [defs, setDefs] = useState<ReadonlyMap<string, ComponentDef> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const kanjiId = kanji?.id;

  useEffect(() => {
    if (fast || !kanjiId) return;
    let alive = true;
    content.components().then(
      (m) => {
        if (alive) setDefs(m);
      },
      () => {
        if (alive) setLoadError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [fast, kanjiId]);

  const rng = useMemo(() => rngFor(store.seed(), store.today(), p.step.id), [p.step.id]);
  const built = useMemo(() => {
    if (fast) return fast;
    if (!defs || !kanji) return null;
    const answer = resolveParts(kanji.components, defs);
    return { answer, tiles: buildTiles(answer, defs, rng, TILE_COUNT, params.distractorIds) };
  }, [fast, defs, kanji, rng, params.distractorIds]);

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('build');
  const [picked, setPicked] = useState<Tile[]>([]);
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [orderNote, setOrderNote] = useState<string | null>(null);

  const n = built?.answer.length ?? 0;
  const elapsed = (): number => Math.max(0, store.now() - started.current);
  // reorder = FLIP (design 09 §10 C1): a part glides down a slot when the one before it is taken out
  const frame = useRef<HTMLDivElement>(null);
  useFlip(frame, picked.map((t) => t.key).join(','));

  const emit = (r: AttemptResult): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };

  const pickTile = (i: number): void => {
    if (!built || phase !== 'build') return;
    const tile = built.tiles[i];
    if (!tile) return;
    setPicked((cur) => (cur.length >= n || cur.some((t) => t.key === tile.key) ? cur : [...cur, tile]));
  };
  const removeSlot = (i: number): void => {
    if (phase !== 'build') return;
    setPicked((cur) => cur.filter((_, j) => j !== i));
  };
  const clear = (): void => {
    if (phase === 'build') setPicked([]);
  };
  const showHint = (): void => {
    if (hintShown || phase !== 'build') return;
    setHintShown(true);
    p.onHint();
  };

  const check = (): void => {
    if (!built || phase !== 'build' || picked.length !== n || n === 0) return;
    const expected = built.answer.map((t) => t.key);
    const got = picked.map((t) => t.key);
    const correct = sameSet(expected, got);
    if (correct && n >= 2 && layout !== 'enc' && got[0] !== expected[0]) {
      const first = built.answer[0] as Tile;
      setOrderNote(fill(S.assemblyOrderNote, { first: first.name || first.char, where: LAYOUT_WHERE[layout] }));
    }
    emit(
      attempt({
        ms: elapsed(),
        correct,
        hintUsed: hintShown,
        errorTags: correct ? [] : ['kanji-meaning'],
        answer: picked.map((t) => t.char).join(''),
      }),
    );
  };

  useExerciseKeys({ onChoice: pickTile, onSubmit: check, onHint: !!kanji && !loadError && !!built && phase === 'build' && !hintShown ? showHint : undefined });

  if (!kanji || loadError) {
    return (
      <div class="kj kj-asm" data-state="unavailable">
        <div class="kj__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{loadError ? S.assemblyNoParts : S.cannotBuild}</p>
          <p class="kj__why">{S.shownNotTested}</p>
          {kanji ? (
            <p class="kj__glyph kj__glyph--sm" lang="ja">
              {kanji.char}
            </p>
          ) : null}
        </div>
        <div class="kj__actions">
          <button type="button" class="hanko" onClick={() => emit(attempt({ ms: elapsed(), correct: true, hintUsed: true }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const expectedKeys = new Set(built?.answer.map((t) => t.key) ?? []);
  const pickedKeys = new Set(picked.map((t) => t.key));
  const full = built !== null && picked.length === n;
  const revealKind = result ? (result.correct ? 'correct' : 'wrong') : 'info';

  return (
    <div class="kj kj-asm" data-phase={phase} data-layout={layout}>
      <p class="kj__prompt">{S.assemblyPrompt}</p>
      <dl class="kj__meta">
        <dt>{SD.meaning}</dt>
        <dd>{kanji.meanings.join(' · ')}</dd>
        <dt>{SD.reading}</dt>
        <Reading kanji={kanji} />
        <dt>{fill(S.assemblyLayoutLabel, { layout: LAYOUT_LABEL[layout] })}</dt>
        <dd>{fill(S.writeStrokes, { n: kanji.strokes })}</dd>
      </dl>

      {built ? (
        <div class="kj-frame" data-layout={layout} role="group" aria-label={S.assemblyFrame} ref={frame}>
          {Array.from({ length: n }, (_, i) => {
            const t = picked[i] ?? null;
            const state = phase === 'done' && t ? (expectedKeys.has(t.key) ? 'correct' : 'wrong') : undefined;
            return (
              <button
                key={i}
                type="button"
                class="kj-slot"
                lang={t && !t.text ? 'ja' : undefined}
                data-slot={i}
                data-filled={t ? 'true' : 'false'}
                data-active={phase === 'build' && !t && picked.length === i ? 'true' : undefined}
                data-state={state}
                disabled={phase !== 'build' || !t}
                aria-label={t ? fill(S.assemblySlotFilled, { n: i + 1, part: t.name || t.char }) : `${fill(S.assemblySlot, { n: i + 1 })}: ${S.assemblySlotEmpty}`}
                onClick={() => removeSlot(i)}
              >
                {t ? <span data-flip={t.key}>{t.char}</span> : fill(S.assemblySlot, { n: i + 1 })}
              </button>
            );
          })}
        </div>
      ) : (
        <p class="kj__gloss" role="status">
          {S.assemblyLoading}
        </p>
      )}

      {built ? (
        <div class="kj-tiles" role="group" aria-label={S.assemblyTiles}>
          {built.tiles.map((t, i) => {
            const used = pickedKeys.has(t.key);
            const missed = phase === 'done' && expectedKeys.has(t.key) && !used;
            return (
              <button
                key={t.key}
                type="button"
                class={t.text ? 'kj-tile kj-tile--text' : 'kj-tile'}
                lang={t.text ? undefined : 'ja'}
                data-index={i}
                data-used={used ? 'true' : 'false'}
                data-state={missed ? 'missed' : undefined}
                disabled={phase !== 'build' || used || full}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                aria-label={fill(used ? S.assemblyTileUsed : S.assemblyTile, { part: t.name || t.char })}
                onClick={() => pickTile(i)}
              >
                {i < 9 ? (
                  <kbd class="kj-tile__key" aria-hidden="true">
                    {i + 1}
                  </kbd>
                ) : null}
                {t.char}
                {t.name && !t.text ? (
                  <span class="kj-tile__name" aria-hidden="true">
                    {t.name}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {phase === 'build' ? (
        <div class="kj__actions">
          <button type="button" class="btn btn--ghost" disabled={hintShown || !built} onClick={showHint}>
            {S.assemblyShowMnemonic}
          </button>
          <button type="button" class="btn btn--ghost" disabled={picked.length === 0} onClick={clear}>
            {S.assemblyClear}
          </button>
          <button type="button" class="hanko" disabled={!full} aria-keyshortcuts="Enter" onClick={check}>
            {S.assemblyCheck}
          </button>
        </div>
      ) : null}

      {hintShown && phase === 'build' ? (
        <div class="kj__reveal reveal ink-nijimi" data-kind="info" data-hint="true">
          <p>
            <span class="eyebrow">{SD.mnemonic}</span> <span>{kanji.mnemonic}</span>
          </p>
          <p class="kj__why">{S.hintUsedNote}</p>
        </div>
      ) : null}

      {phase === 'done' && built ? (
        <div class="kj__reveal reveal ink-nijimi" data-kind={revealKind}>
          <p class="kj__glyph kj__glyph--sm" lang="ja" aria-label={S.kanjiLabel}>
            {kanji.char}
          </p>
          <p data-parts="true">
            <span class="eyebrow">{SD.components}</span>{' '}
            <span>{fill(S.assemblyAnswer, { parts: built.answer.map((t) => (t.name && !t.text ? `${t.char} ${t.name}` : t.char)).join(' · ') })}</span>
          </p>
          {orderNote ? (
            <p class="kj__why" data-order-note="true">
              {orderNote}
            </p>
          ) : null}
          <p>
            <span class="eyebrow">{SD.mnemonic}</span> <span>{kanji.mnemonic}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
