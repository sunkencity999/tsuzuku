import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPlain } from '../src/content/ruby.ts';
import type { StoryLine } from '../src/content/types.ts';
import { POOL_FILE_BUDGET_BYTES } from './build-content-index.ts';
import { linkSentence, matchToken, stationPools, stringifyPool } from './linker.ts';
import type { PoolCorpus } from './linker.ts';
import { ARENA_SET_FACTOR, buildReport, estimateMorae, RADIO_REHEARINGS, readBundles, renderMarkdown, writeReport } from './listening-report.ts';
import type { Report } from './listening-report.ts';
import { validate } from './validate-content.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', 'public', 'content');
const tmps: string[] = [];

/*
 * Census pins. The plan row's figures (Station 4 own-station share 13 / 120,
 * flagged items 47 / 45 / 35 at Stations 4–6 and 154 at Stations 4–15, pool
 * totals 9,362 / 1,583 / 2,743) were measured BEFORE Pass 4b with the
 * validator's stand-in segmenter, which passed an unknown kana word carved
 * into function tokens + one stray hiragana (まだ = ま + だ, よく = よ + く).
 * Pass 4b landed on this tree while the pools were rebased on `linkSentence`
 * (which closes that leak), so: the V46-driven counts are asserted in the
 * release direction (the share can only rise, the flagged counts only fall —
 * the ceilings are the ±6 % tolerance of the plan's census), and the pool
 * totals two-sided around the figures measured with the corrected rule on the
 * same corpus (vocab) or the plan's figure where it still holds (grammar,
 * story lines). Re-pin from `node scripts/listening-report.ts --json`
 * (`totals`, `stations[].examples`) when the content moves again; the
 * invariants below are what guards the linker itself.
 */
const CENSUS = {
  /** Plan: 13 / 120 before Pass 4b; a floor now (Pass 4b rewrites lift it). */
  station4ShareFloor: 13 / 120,
  /** Plan: 47 / 45 / 35 at Stations 4–6 and 154 at 4–15 before Pass 4b; the release target is 0 (V46 is F at release). Ceilings = 6 % of the plan's census. */
  flaggedCeiling: { 4: 3, 5: 3, 6: 3, total4to15: 9 },
  /** The corrected rule, re-pinned on the landed wave B tree (100 pieces + Pass 4b; `node scripts/listening-report.ts --json` totals.vocab = 8,709, 8,710 with 体's restored third example; the plan's 9,362 carried the stand-in's leak, −7.0 %); ±6 %. */
  vocabRefs: 8709,
  /** Plan figure (the landed tree reports 1,531, −3.3 %), still within ±6 %. */
  grammarRefs: 1583,
  /** Plan figure (text lines all-known at their own station), still within ±6 % on the landed tree. */
  ownStationTextLines: 2743,
  tolerance: 0.06,
} as const;

let report: Report;
let corpus: PoolCorpus;
beforeAll(() => {
  report = buildReport(ROOT);
  corpus = report.corpus;
}, 180_000);

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const within = (actual: number, pinned: number, tol = CENSUS.tolerance) => Math.abs(actual - pinned) <= pinned * tol;

describe('listening-report (shipped corpus; design 08 §2, §4, §12)', () => {
  it("the report's Station 4 own-station share is at or above the plan's 13 / 120 census (the pre-Pass-4b floor) and is the pool builder's own verdict over the station's examples", () => {
    const s4 = report.data.stations.find((s) => s.station === 4)!;
    expect(s4.belt).toBe('yellow');
    expect(s4.examples.total).toBeGreaterThan(0);
    const share = s4.examples.allKnown / s4.examples.total;
    expect(share).toBeGreaterThanOrEqual(CENSUS.station4ShareFloor);
    expect(share).toBeLessThanOrEqual(1);
    // the share is the pool builder's own verdict over the station's examples
    const own = report.verdicts.filter((v) => v.ref.startsWith('v-') && v.station === 4);
    expect(s4.examples.total).toBe(own.length);
    expect(s4.examples.allKnown).toBe(own.filter((v) => v.ownStation).length);
    const items = new Set(own.map((v) => v.ref.split('#')[0]));
    expect(s4.examples.items).toBe(items.size);
    expect(s4.examples.itemsWithout).toBe(report.data.itemsWithoutOwnExample.filter((it) => it.station === 4).length);
    // an own-station example is in the station's own pool, exactly
    const p4 = new Set(report.pools.find((p) => p.station === 4)!.refs.map((r) => r.ref));
    for (const v of own) expect(p4.has(v.ref), v.ref).toBe(v.ownStation);
  });

  it('the authentic inventory reports 25 bridge texts and 29 casual non-bridge dialogues from Station 10, counts pieces with isAuthenticText, and the reachable figure is distinct × (2.5 + 2)', () => {
    const a = report.data.authentic;
    expect(a.bridgeTexts.count).toBe(25);
    expect(a.casualDialogues.count).toBe(29);
    expect(a.bridgeTexts.hours).toBeGreaterThan(0.5);
    expect(a.casualDialogues.hours).toBeGreaterThan(0.3);
    expect(a.authenticPieces.count).toBe(corpus.stories.filter((s) => s.audioFirst === true && (s.bridge === true || (s.kind === 'dialogue' && s.register === 'casual') || ['casual-talk', 'interview', 'news', 'drama', 'debate', 'lecture'].includes(String(s.genre)))).length);
    expect(a.distinctHours).toBeCloseTo(a.bridgeTexts.hours + a.casualDialogues.hours + a.authenticPieces.hours, 6);
    expect(a.arenaHours).toBeCloseTo(a.distinctHours * ARENA_SET_FACTOR, 6);
    expect(a.radioHours).toBeCloseTo(a.distinctHours * RADIO_REHEARINGS, 6);
    expect(a.reachableHours).toBeCloseTo(a.distinctHours * (ARENA_SET_FACTOR + RADIO_REHEARINGS), 6);
  });

  it('per-station rows: own refs sum to the totals, i+0 is cumulative over the pools, i+1 refs have exactly one id beyond the station, minutes follow morae ÷ 7 + 0.5, bytes are the serialised file and the budget list is the pools over POOL_FILE_BUDGET_BYTES', () => {
    const d = report.data;
    expect(d.stations.map((s) => s.station)).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
    expect(d.stations.reduce((n, s) => n + s.own.refs, 0)).toBe(d.totals.refs);
    expect(d.totals.refs).toBe(report.pools.reduce((n, p) => n + p.refs.length, 0));
    expect(d.totals.stories + d.totals.grammar + d.totals.vocab).toBe(d.totals.refs);
    let cum = 0;
    for (const s of d.stations) {
      cum += s.own.refs;
      expect(s.i0.refs).toBe(cum);
      expect(s.own.stories + s.own.grammar + s.own.vocab).toBe(s.own.refs);
      expect(s.i1.refs).toBeLessThanOrEqual(d.totals.refs - cum);
      const pool = report.pools.find((p) => p.station === s.station)!;
      expect(s.own.minutes).toBeCloseTo(pool.refs.reduce((n, r) => n + r.morae / 7 + 0.5, 0) / 60, 1);
      expect(s.own.bytes).toBe(Buffer.byteLength(stringifyPool(pool), 'utf8'));
    }
    expect(d.stations[52]!.i1.refs).toBe(0);
    expect(d.stations[3]!.i1.refs).toBeGreaterThan(0);
    expect(d.budget.bytes).toBe(POOL_FILE_BUDGET_BYTES);
    expect(d.budget.over.map((o) => o.station)).toEqual(d.stations.filter((s) => s.own.bytes > POOL_FILE_BUDGET_BYTES).map((s) => s.station));
    for (const o of d.budget.over) expect(o.bytes).toBeLessThan(300 * 1024);
  });

  it('pool totals: vocab examples within ±6 % of the corrected-rule census, grammar examples within ±6 % of the plan’s 1,583, text lines all-known at their own station within ±6 % of the plan’s 2,743; the never-all-known list is exactly the vocab examples in no pool', () => {
    const d = report.data;
    expect(within(d.totals.vocab, CENSUS.vocabRefs), `vocab ${d.totals.vocab}`).toBe(true);
    expect(within(d.totals.grammar, CENSUS.grammarRefs), `grammar ${d.totals.grammar}`).toBe(true);
    const texts = new Set(report.verdicts.filter((v) => v.ref.startsWith('s-')).map((v) => v.ref.split('#')[0]!));
    expect(texts.size).toBeGreaterThanOrEqual(137);
    const isText = (ref: string) => (/^s-\d\d-[1-3]#/.test(ref) && Number(ref.slice(2, 4)) <= 31) || (/^s-\d\d-[12]#/.test(ref) && Number(ref.slice(2, 4)) >= 32);
    const ownStationLines = report.verdicts.filter((v) => v.ref.startsWith('s-') && v.ownStation && isText(v.ref)).length;
    expect(within(ownStationLines, CENSUS.ownStationTextLines), `own-station text lines ${ownStationLines}`).toBe(true);
    // the never-all-known list is exactly the vocab examples in no pool
    const outside = report.verdicts.filter((v) => v.ref.startsWith('v-') && v.knownAt === null);
    expect(d.neverAllKnown.map((r) => r.ref)).toEqual(outside.map((v) => v.ref));
    expect(d.neverAllKnown.length + d.totals.vocab).toBe(report.verdicts.filter((v) => v.ref.startsWith('v-')).length);
    for (const r of d.neverAllKnown.slice(0, 50)) expect(r.unknown.length).toBeGreaterThan(0);
  });

  it("every V46-passing vocab item at Stations 4–15 has a ref in its own station's pool and every flagged one has none (the validator and the pool builder share one linker); the flagged counts sit at or under the release-direction ceilings (6 % of the pre-Pass-4b census)", () => {
    const r = validate(ROOT);
    expect(r.bundles).toBe(true);
    const flagged = new Set(r.warnings.filter((f) => f.rule === 'V46').map((f) => f.id));
    const byStation = new Map(report.pools.map((p) => [p.station, new Set(p.refs.map((x) => x.ref.split('#')[0]!))]));
    const items = new Map<string, number>();
    for (const v of report.verdicts) if (v.ref.startsWith('v-')) items.set(v.ref.split('#')[0]!, v.station);
    let checked = 0;
    for (const [id, station] of items) {
      if (station < 4 || station > 15) continue;
      checked++;
      expect(byStation.get(station)!.has(id), `${id} @${station}`).toBe(!flagged.has(id));
    }
    expect(checked).toBeGreaterThan(600);
    // the report's per-station census is the same count
    for (const s of report.data.stations) expect(s.examples.itemsWithout).toBe([...items].filter(([id, st]) => st === s.station && flagged.has(id)).length);
    const flaggedAt = (st: number) => [...items].filter(([id, s]) => s === st && flagged.has(id)).map(([id]) => id);
    for (const st of [4, 5, 6] as const) expect(flaggedAt(st).length, `Station ${st}: ${flaggedAt(st).join(' ')}`).toBeLessThanOrEqual(CENSUS.flaggedCeiling[st]);
    const flagged4to15 = [...items].filter(([id, st]) => st >= 4 && st <= 15 && flagged.has(id)).map(([id]) => id);
    expect(flagged4to15.length, `Stations 4–15: ${flagged4to15.join(' ')}`).toBeLessThanOrEqual(CENSUS.flaggedCeiling.total4to15);
  }, 180_000);

  it('invariants of the pools over the shipped corpus: story refs carry only their line’s tokenIds and sit at max(text station, stations of those ids); example refs start with their owner; every id of a ref is introduced at or before the pool’s station, and the latest one (or the owner) at it unless the previous station’s pool cannot cover the sentence', () => {
    const bundles = readBundles(ROOT);
    const poolFor = stationPools(bundles, corpus);
    const plainOf = new Map(report.verdicts.map((v) => [v.ref, v.plain]));
    let settledLater = 0;
    const stationOfId = new Map<string, number>();
    for (const b of bundles) {
      for (const id of b.vocabIds ?? []) stationOfId.set(id, b.number);
      for (const id of b.grammarIds ?? []) stationOfId.set(id, b.number);
    }
    const lineById = new Map<string, StoryLine>();
    const textStation = new Map<string, number>();
    for (const s of corpus.stories) {
      const m = /^st-(\d{2})$/.exec(String(s.stationId));
      if (!m || !Array.isArray(s.lines)) continue;
      textStation.set(s.id, Number(m[1]));
      s.lines.forEach((ln, i) => lineById.set(`${s.id}#L${i}`, ln));
    }
    const itemStation = new Map<string, number>();
    for (const it of [...corpus.vocab, ...corpus.grammar]) if (typeof it.station === 'number') itemStation.set(it.id, it.station);
    let storyRefs = 0;
    let exampleRefs = 0;
    for (const p of report.pools) {
      for (const r of p.refs) {
        const owner = r.ref.split('#')[0]!;
        const floor = r.ref.startsWith('s-') ? textStation.get(owner)! : itemStation.get(owner)!;
        expect(floor, r.ref).toBeGreaterThan(0);
        const stations = r.ids.map((id) => stationOfId.get(id) ?? -1);
        for (const s of stations) expect(s, `${r.ref} id without a station`).toBeGreaterThan(0);
        const latest = Math.max(floor, ...stations);
        expect(latest, r.ref).toBeLessThanOrEqual(p.station);
        if (latest < p.station) {
          // an example settled at the first station whose pool covers it: the previous pool's surfaces cannot (13 refs in 10,000)
          expect(r.ref.startsWith('s-'), r.ref).toBe(false);
          expect(linkSentence(poolFor(p.station - 1), plainOf.get(r.ref)!).unknown, `${r.ref} @${p.station}`).toBeGreaterThan(0);
          settledLater++;
        }
        if (r.ref.startsWith('s-')) {
          storyRefs++;
          const ln = lineById.get(r.ref)!;
          const linked = new Set((ln.tokenIds ?? []).filter((x): x is string => typeof x === 'string'));
          expect(r.ids.length).toBe(linked.size);
          for (const id of r.ids) expect(linked.has(id), `${r.ref} ${id}`).toBe(true);
        } else {
          exampleRefs++;
          expect(r.ids[0], r.ref).toBe(owner);
        }
      }
    }
    expect(storyRefs).toBeGreaterThan(3000);
    expect(exampleRefs).toBeGreaterThan(8000);
    expect(settledLater).toBeLessThanOrEqual(30);
    // a text line in no pool has an unknown token against its own text's pool (the V20 coverage allowance), never a linked one left out
    const outside = report.verdicts.filter((v) => v.ref.startsWith('s-') && v.knownAt === null);
    expect(outside.length).toBeGreaterThan(0);
    for (const v of outside) expect(v.unknownTokens.length, v.ref).toBeGreaterThan(0);
  }, 180_000);

  it('no admitted example sentence rests on a tolerated stray: re-linked at its pool’s station every token is known to the matcher, the only id-less single hiragana being the honorific prefix (the stand-in’s leak — まだ as ま + だ, よく as よ + く — is closed)', () => {
    const bundles = readBundles(ROOT);
    const poolFor = stationPools(bundles, corpus);
    const plainOf = new Map(report.verdicts.map((v) => [v.ref, v.plain]));
    const strays = new Map<string, number>();
    let checked = 0;
    for (const p of report.pools) {
      const pool = poolFor(p.station);
      for (const r of p.refs) {
        if (r.ref.startsWith('s-')) continue;
        checked++;
        const link = linkSentence(pool, plainOf.get(r.ref)!);
        expect(link.unknown, `${r.ref} @${p.station}: ${link.unknownTokens.join(' ')}`).toBe(0);
        for (const t of link.tokens) if (!matchToken(pool, t).known) strays.set(t, (strays.get(t) ?? 0) + 1);
      }
    }
    expect(checked).toBeGreaterThan(9000);
    expect([...strays.keys()].sort()).toEqual(['お'].concat(strays.has('ご') ? ['ご'] : []));
  }, 180_000);

  it('renders byte-stable markdown with the station table (file sizes and the budget note), the §2 hours tables, the §3 inventory, the calibration and the rewrite list; the data round-trips through JSON; the calibration floors hold; writeReport writes it', () => {
    const d = report.data;
    const md = renderMarkdown(d);
    expect(renderMarkdown(d)).toBe(md);
    expect(md.startsWith('# TSUZUKU — Listening report\n')).toBe(true);
    for (const heading of ['## 1. Pools by station', '## 2. Hours (design 08 §2)', '## 3. Authentic inventory (design 08 §12)', '## 4. Segmenter calibration', '## 5. Vocab examples outside every pool (Pass 4b rewrite candidates)', '## 6. Grammar examples and story lines outside every pool']) expect(md).toContain(heading);
    expect(md).toMatch(/\n\| 04 \| yellow \| /);
    expect(md).toContain('| Station | Belt | Own refs (stories · grammar · vocab) | Own | File | i+0 refs |');
    expect(md).toContain(d.budget.over.length === 0 ? 'Every pool file is within the 256 KiB budget' : `${d.budget.over.length} of ${d.stations.length} pools exceed the 256 KiB budget`);
    expect(d.budget.bytes).toBe(256 * 1024);
    expect(d.budget.over).toEqual([]);
    expect(md).toContain('| T2 pool (pool vocab examples + slow takes for Stations 4–17) |');
    expect(md).toContain(`| bridge texts (\`bridge: true\`, the existing texts) | ${d.authentic.bridgeTexts.count} |`);
    expect(md.split('\n').filter((l) => /^- `v-n[1-5]-\d{4}#ex\d+` /.test(l)).length).toBe(d.neverAllKnown.length);
    expect(md).not.toMatch(/\d{4}-\d\d-\d\dT/);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(d.schema).toBe('tsuzuku.listening-report/1');
    expect(d.calibration.lines).toBeGreaterThan(3000);
    expect(d.calibration.verdictAgreement).toBeGreaterThanOrEqual(0.9);
    expect(d.calibration.idSetAgreement).toBeGreaterThanOrEqual(0.55);
    expect(d.calibration.vocabIdAgreement).toBeGreaterThanOrEqual(d.calibration.idSetAgreement);
    expect(d.hours.distinct.total).toBeCloseTo(d.hours.distinct.connected + d.hours.distinct.drills, 6);
    expect(d.hours.tiers.totalMb).toBeGreaterThan(100);
    expect(d.hours.mined.vocabInPools.count).toBe(d.totals.vocab);
    const dir = mkdtempSync(join(tmpdir(), 'tsuzuku-report-'));
    tmps.push(dir);
    const out = join(dir, 'listening-report.md');
    const w = writeReport(ROOT, out);
    expect(w.changed).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe(renderMarkdown(w.report.data));
  }, 180_000);

  it('estimateMorae counts kana characters and two per kanji (collocations carry no kana field); toPlain is what the pools segment', () => {
    expect(estimateMorae('本を読む')).toBe(6);
    expect(estimateMorae('コーヒーを飲む')).toBe(8);
    expect(estimateMorae('')).toBe(0);
    expect(report.verdicts.find((v) => v.ref === 'v-n5-0007#ex0')?.plain).toBe(toPlain(corpus.vocab.find((v) => v.id === 'v-n5-0007')!.examples[0]!.ja));
  });
});
