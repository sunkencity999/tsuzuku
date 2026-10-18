import { render } from 'preact';
import { act } from 'preact/test-utils';
import { toRomaji } from 'wanakana';
import { FIXTURE } from '@/content/fixtures';
import type { CardKey, KanaItem } from '@/content/types';
import type { ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { CardFlag, hasFlag } from '@/shared/store-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLIDE_END_MS, GLIDE_START_MS, GOJUON_ROUND_SIZE, GojuonFighter, buildRound, landMs, meta, rowOf, type GojuonRound } from './GojuonFighter';
import { S as GS, fill as gfill } from './gojuon-strings';
import { isDisplayRomaji } from './KanaFlash';

// `content` is a singleton with an empty cache in tests; serve one loaded kana
// item from it (を with the corpus display romaji o) and leave the rest to `kanaFromId`.
const WO: KanaItem = { id: 'k-h-wo', kana: 'を', romaji: 'o', script: 'hiragana', type: 'basic', row: 'w', mnemonic: 'を: a man kicking a ball — the object marker.', exampleWord: { word: 'を', kana: 'を', en: 'object marker' } };
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  return { ...orig, content: { ...orig.content, get: (id: string) => (id === 'k-h-wo' ? WO : undefined) } };
});

let root: HTMLDivElement;
let clock = 1_000_000;
const POOL: CardKey[] = ['k-h-ka#rec', 'k-h-ki#rec', 'k-h-ne#rec'];

beforeEach(async () => {
  vi.useFakeTimers();
  clock = 1_000_000;
  await makeTestStore({
    now: () => clock,
    cards: {
      'k-h-ka#rec': card({ s: 30, reps: 12, state: 2, due: 100 }),
      'k-h-ki#rec': card({ s: 20, reps: 9, state: 2, due: 100 }),
      'k-h-ne#rec': card({ s: 15, reps: 7, state: 2, due: 100 }),
    },
  });
  // only か has a review history; a Gojūon row must never be the first row of a card
  store.log.push([clock - 86_400_000, 'k-h-ka#rec', 3, 900, 0, 0]);
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'g1',
    block: 'sparring',
    exercise: 'gojuon-fighter',
    itemId: null,
    cardKey: null,
    params: { pool: POOL },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 120_000,
    ...over,
  };
}

type P = ExerciseProps<{ pool: CardKey[] }> & { onResult: ReturnType<typeof vi.fn>; onRound: ReturnType<typeof vi.fn> };

function props(over: Partial<P> = {}): P {
  return {
    step: step() as P['step'],
    item: null,
    feel: 'arcade',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 0,
    onResult: vi.fn(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    onRound: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as P;
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={1} ki={10} combo={0} comboTier={0} timer={null} feel="arcade" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(p: P, framed = true): void {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<GojuonFighter {...p} />, p.step) : <GojuonFighter {...p} />, root));
}

/** Advances the store clock and the fake timers together. */
function pass(ms: number): void {
  clock += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function key(target: EventTarget, k: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const input = (): HTMLInputElement => root.querySelector('.gojuon__field') as HTMLInputElement;
const glyph = (): string => root.querySelector('.gojuon__kana')?.textContent ?? '';
const phase = (): string | null => root.querySelector('.gojuon')?.getAttribute('data-phase') ?? null;

function type(text: string): void {
  const el = input();
  for (const ch of text) {
    act(() => {
      el.value = el.value + ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

/** Types the current kana's romaji after `ms` and presses Enter if it is still pending (ん). */
function hit(ms = 200): void {
  const g = glyph();
  pass(ms);
  type(toRomaji(g));
  if (glyph() === g && phase() === 'play') key(input(), 'Enter');
}

describe('meta / pure helpers', () => {
  it('registers gojuon-fighter with no facet (fluency mode) and text keys', () => {
    expect(meta).toMatchObject({ id: 'gojuon-fighter', facet: null, keys: 'text', needsTts: false });
  });

  it('landMs tightens from 3.5 s to 1.5 s across the round', () => {
    expect(landMs(0, 46)).toBe(GLIDE_START_MS);
    expect(landMs(45, 46)).toBe(GLIDE_END_MS);
    expect(landMs(22, 46)).toBeLessThan(GLIDE_START_MS);
    expect(landMs(22, 46)).toBeGreaterThan(GLIDE_END_MS);
    for (let i = 1; i < 46; i++) expect(landMs(i, 46)).toBeLessThanOrEqual(landMs(i - 1, 46));
    expect(landMs(0, 1)).toBe(GLIDE_START_MS);
  });

  it('rowOf maps romaji to gojūon rows', () => {
    expect(rowOf('shi')).toBe('s');
    expect(rowOf('chi')).toBe('t');
    expect(rowOf('tsu')).toBe('t');
    expect(rowOf('fu')).toBe('h');
    expect(rowOf('kya')).toBe('k');
    expect(rowOf('a')).toBe('a');
    expect(rowOf('n')).toBe('nn');
    expect(rowOf('fa')).toBe('h');
    expect(rowOf('va')).toBe('ext');
  });

  it('buildRound: pool kana graded, padded with ungraded kana of the same script, deduped, seeded', () => {
    const get = (id: string) => FIXTURE.items[id];
    const a = buildRound([...POOL, 'k-h-ka#prod'], { seed: 's', day: 1, stepId: 'g', get });
    expect(a.length).toBe(GOJUON_ROUND_SIZE);
    expect(a.filter((k) => k.graded).map((k) => k.id).sort()).toEqual(['k-h-ka', 'k-h-ki', 'k-h-ne']);
    expect(a.find((k) => k.id === 'k-h-ka')).toMatchObject({ glyph: 'か', romaji: 'ka', row: 'k', cardKey: 'k-h-ka#rec' });
    expect(new Set(a.map((k) => k.glyph)).size).toBe(GOJUON_ROUND_SIZE);
    expect(a.filter((k) => !k.graded).every((k) => k.cardKey === null && /^k-h-/.test(k.id))).toBe(true);
    expect(a.find((k) => k.glyph === 'し')).toMatchObject({ romaji: 'shi', row: 's', graded: false });
    const b = buildRound([...POOL, 'k-h-ka#prod'], { seed: 's', day: 1, stepId: 'g', get });
    expect(b.map((k) => k.id)).toEqual(a.map((k) => k.id));
    const c = buildRound(POOL, { seed: 's', day: 2, stepId: 'g', get });
    expect(c.map((k) => k.id)).not.toEqual(a.map((k) => k.id));
  });

  it('buildRound derives unloaded kana from the id, follows the katakana majority, samples a large pool and skips junk keys', () => {
    const none = () => undefined;
    const kata = buildRound(['k-k-shi#rec', 'k-k-tsu#rec', 'k-h-a#rec', 'bogus' as CardKey], { seed: 's', day: 1, stepId: 'g', get: none, size: 6 });
    expect(kata.length).toBe(6);
    expect(kata.find((k) => k.id === 'k-k-shi')).toMatchObject({ glyph: 'シ', romaji: 'shi', graded: true });
    expect(kata.filter((k) => !k.graded).every((k) => /^k-k-/.test(k.id))).toBe(true);
    const big = Array.from({ length: 10 }, (_, i) => `k-h-${['a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko'][i]}#rec` as CardKey);
    const sampled = buildRound(big, { seed: 's', day: 1, stepId: 'g', get: none, size: 4 });
    expect(sampled.length).toBe(4);
    expect(sampled.every((k) => k.graded)).toBe(true);
  });
});

describe('<GojuonFighter> round', () => {
  it('runs 46 kana: hits advance, a landing counts a miss, recheck keys and reaction times come out, nothing is rated', () => {
    const cap = captureEvents();
    const p = props();
    mount(p);
    expect(phase()).toBe('ready');
    expect(root.textContent).toContain('3 are mature kana');
    // the ready panel is a .sheet under a poster title (design 09 §2.5)
    expect(root.querySelector('.gojuon .drill')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('.gojuon .drill h3')?.classList.contains('poster-title')).toBe(true);
    key(document.body, 'Enter'); // frame Enter → start
    expect(phase()).toBe('play');
    expect(root.querySelector('.gojuon__opponent [lang="ja"]')?.textContent).toMatch(/行|ん/);
    // the landing bar is a .meter driven by --value; the miss count rolls
    const track = root.querySelector('.gojuon__track') as HTMLElement;
    expect(track.classList.contains('meter')).toBe(true);
    expect(track.style.getPropertyValue('--value')).toBe('1.000');
    expect(root.querySelector('.gojuon__lantern .ticker[data-roll]')).not.toBeNull();

    const round = buildRound(POOL, { seed: store.seed(), day: store.today(), stepId: 'g1' });
    const kaIdx = round.findIndex((k) => k.id === 'k-h-ka');
    const neIdx = round.findIndex((k) => k.id === 'k-h-ne');
    const fillerIdx = round.findIndex((k) => !k.graded);
    let misses = 0;
    for (let i = 0; i < round.length; i++) {
      expect(glyph()).toBe(round[i]?.glyph);
      if (i === kaIdx || i === fillerIdx) {
        // let it land
        pass(landMs(i, round.length) + 60);
        misses++;
        if (i < round.length - 1) expect(root.querySelector('.gojuon__lantern')?.getAttribute('data-dim')).toBe(String(misses));
      } else if (i === neIdx) {
        // a resolved wrong kana (か for ね) is an immediate miss
        pass(100);
        type('ka');
        misses++;
      } else {
        hit(150);
      }
    }
    expect(phase()).toBe('over');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(p.onRound).toHaveBeenCalledTimes(1);
    const r = p.onRound.mock.calls[0]?.[0] as GojuonRound;
    expect(r.total).toBe(GOJUON_ROUND_SIZE);
    expect(r.reactions.length).toBe(GOJUON_ROUND_SIZE);
    expect(r.misses).toBe(misses);
    expect(r.hits).toBe(GOJUON_ROUND_SIZE - misses);
    expect(misses).toBe(3);
    expect(r.recheck.slice().sort()).toEqual(['k-h-ka#rec', 'k-h-ne#rec']);
    expect(r.reactions.filter((x) => x.hit).every((x) => x.ms >= 150 && x.ms < 1000)).toBe(true);
    expect(p.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, guard: false, timedOut: false, answer: `${r.hits}/${r.total}` });
    expect(p.onResult.mock.calls[0]?.[0].score).toBeCloseTo(r.hits / r.total);

    // recheck flags on the missed pool cards only
    expect(hasFlag(store.cards.get('k-h-ka#rec')?.[7] ?? 0, CardFlag.recheck)).toBe(true);
    expect(hasFlag(store.cards.get('k-h-ne#rec')?.[7] ?? 0, CardFlag.recheck)).toBe(true);
    expect(hasFlag(store.cards.get('k-h-ki#rec')?.[7] ?? 0, CardFlag.recheck)).toBe(false);
    // stability untouched: speed slips never collapse a card
    expect(store.cards.get('k-h-ka#rec')?.[1]).toBe(30);

    // one arcade:done, no attempt:graded / ratings from the drill itself
    const names = cap.events.map((e) => e[0]);
    expect(names.filter((n) => n === 'arcade:done').length).toBe(1);
    expect(names).not.toContain('attempt:graded');
    expect(names).not.toContain('item:promoted');
    const ev = cap.events.find((e) => e[0] === 'arcade:done')?.[1] as { mode: string; correct: number; misses: number; ms: number; recheck: CardKey[] };
    expect(ev).toMatchObject({ mode: 'gojuon', correct: r.hits, misses: r.misses });
    expect(ev.ms).toBeGreaterThan(0);
    expect(ev.recheck.sort()).toEqual(r.recheck.sort());
    cap.stop();

    // log rows: only for pool kana with a history (か), carrying the reaction time
    const ka = store.log.forCard('k-h-ka#rec');
    expect(ka.length).toBe(2);
    expect(ka[ka.length - 1]?.[2]).toBe(1);
    expect(store.log.forCard('k-h-ki#rec').length).toBe(0);
    expect(store.log.forCard('k-h-ne#rec').length).toBe(0);

    // results panel: a .sheet, poster title, rolling counts, eyebrow labels (kana.css carries no .drill__label any more)
    expect(root.querySelectorAll('.gojuon__reaction').length).toBe(GOJUON_ROUND_SIZE);
    expect(root.querySelectorAll('.gojuon__reaction[data-hit="false"]').length).toBe(misses);
    expect(root.textContent).toContain('kana come back untimed next session');
    expect(root.querySelector('.gojuon__over')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('.gojuon__over h3')?.classList.contains('poster-title')).toBe(true);
    expect(root.querySelectorAll('.gojuon__stats .ticker[data-roll]').length).toBe(2);
    expect(root.querySelectorAll('.gojuon__stats dt.eyebrow').length).toBe(4);
    expect(root.querySelector('.drill__label')).toBeNull();
    const kanaCss = readFileSync(resolve(process.cwd(), 'src/exercises/kana/kana.css'), 'utf8');
    expect(kanaCss).not.toContain('.drill__label');
    // the gliding kana never moves by `left` (design 09 §6.7 rule 1): a composited translate in container-query units
    expect(kanaCss).not.toContain('left: calc(var(--remain)');
    expect(kanaCss).toMatch(/\.gojuon__kana \{[^}]*translate: calc\(var\(--remain\) \* \(100cqi - 3\.5rem\)\) -50%/);
    expect(kanaCss).toMatch(/\.gojuon__stage \{[^}]*container-type: inline-size/);
    // no own best yet (stats.gojuonBest 0): no BEST eyebrow (footnote 5)
    expect(root.querySelector('.gojuon__best')).toBeNull();
  });

  it('the BEST eyebrow names the learner’s OWN previous best only when the round’s hits pass it', async () => {
    await makeTestStore({ now: () => clock, save: { stats: { gojuonBest: 10 } }, cards: { 'k-h-ka#rec': card({ s: 30, reps: 12, state: 2, due: 100 }) } });
    const p = props({ step: step({ params: { pool: ['k-h-ka#rec' as CardKey] } }) as P['step'] });
    mount(p, false);
    act(() => (root.querySelector('.hanko') as HTMLButtonElement).click());
    const round = buildRound(['k-h-ka#rec'], { seed: store.seed(), day: store.today(), stepId: 'g1' });
    for (let i = 0; i < round.length; i++) hit(100);
    expect(phase()).toBe('over');
    expect(root.querySelector('.gojuon__best')?.textContent).toBe(gfill(GS.bestEyebrow, { n: 10 }));
    // a round that does not pass the own best: no eyebrow
    await makeTestStore({ now: () => clock, save: { stats: { gojuonBest: 46 } }, cards: { 'k-h-ka#rec': card({ s: 30, reps: 12, state: 2, due: 100 }) } });
    mount(props({ step: step({ id: 'g2', params: { pool: ['k-h-ka#rec' as CardKey] } }) as P['step'] }), false);
    act(() => (root.querySelector('.hanko') as HTMLButtonElement).click());
    const round2 = buildRound(['k-h-ka#rec'], { seed: store.seed(), day: store.today(), stepId: 'g2' });
    pass(landMs(0, round2.length) + 60); // one miss
    for (let i = 1; i < round2.length; i++) hit(100);
    expect(phase()).toBe('over');
    expect(root.querySelector('.gojuon__best')).toBeNull();
  });

  it('a lone n needs Enter (ん) and a clean round reports no recheck', () => {
    const p = props({ step: step({ params: { pool: ['k-h-n#rec' as CardKey] } }) as P['step'] });
    mount(p, false);
    act(() => (root.querySelector('.hanko') as HTMLButtonElement).click());
    const round = buildRound(['k-h-n#rec'], { seed: store.seed(), day: store.today(), stepId: 'g1' });
    for (let i = 0; i < round.length; i++) hit(100);
    expect(phase()).toBe('over');
    const r = p.onRound.mock.calls[0]?.[0] as GojuonRound;
    expect(r.misses).toBe(0);
    expect(r.recheck).toEqual([]);
    expect(r.reactions.find((x) => x.glyph === 'ん')?.hit).toBe(true);
    expect(p.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
    expect(root.textContent).toContain('Clean round');
  });

  it('the corpus display romaji is a hit: o lands を (as Kana Flash teaches it) instead of resolving to お and missing', () => {
    expect(isDisplayRomaji('o', 'o', 'を')).toBe(true);
    expect(isDisplayRomaji('o', 'o', 'お')).toBe(false);
    expect(isDisplayRomaji('wo', 'o', 'を')).toBe(false);
    const p = props({ step: step({ params: { pool: ['k-h-wo#rec' as CardKey] } }) as P['step'] });
    mount(p, false);
    act(() => (root.querySelector('.hanko') as HTMLButtonElement).click());
    const round = buildRound(['k-h-wo#rec'], { seed: store.seed(), day: store.today(), stepId: 'g1', get: (id) => (id === 'k-h-wo' ? WO : undefined) });
    expect(round.find((k) => k.id === 'k-h-wo')?.romaji).toBe('o');
    for (let i = 0; i < round.length; i++) {
      expect(glyph()).toBe(round[i]?.glyph);
      if (glyph() === 'を') {
        pass(100);
        type('o');
      } else hit(100);
    }
    expect(phase()).toBe('over');
    const r = p.onRound.mock.calls[0]?.[0] as GojuonRound;
    expect(r.misses).toBe(0);
    expect(r.reactions.find((x) => x.glyph === 'を')?.hit).toBe(true);
    expect(r.recheck).toEqual([]);
  });

  it('an empty pool is a practice round: playable, graded nothing, no flags', () => {
    const cap = captureEvents();
    const p = props({ step: step({ params: { pool: [] } }) as P['step'] });
    mount(p, false);
    expect(root.textContent).toContain('practice only');
    act(() => (root.querySelector('.hanko') as HTMLButtonElement).click());
    expect(phase()).toBe('play');
    pass(landMs(0, GOJUON_ROUND_SIZE) + 60);
    expect(root.querySelector('.gojuon__lantern')?.getAttribute('data-dim')).toBe('1');
    for (let i = 1; i < GOJUON_ROUND_SIZE; i++) hit(100);
    const r = p.onRound.mock.calls[0]?.[0] as GojuonRound;
    expect(r.recheck).toEqual([]);
    expect(r.misses).toBe(1);
    expect(cap.events.filter((e) => e[0] === 'arcade:done').length).toBe(1);
    cap.stop();
  });

  it('typing before the round starts does nothing and the start button is a hanko with an Enter shortcut', () => {
    const p = props();
    mount(p, false);
    expect(root.querySelector('.gojuon__field')).toBeNull();
    const start = root.querySelector('.hanko') as HTMLButtonElement;
    expect(start.getAttribute('aria-keyshortcuts')).toBe('Enter');
    expect(p.onResult).not.toHaveBeenCalled();
  });
});
