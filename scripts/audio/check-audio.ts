/**
 * TSUZUKU — post-build pack check (design 08 §7 step 9; deploy.yml's last step).
 *
 *   node scripts/audio/check-audio.ts [--optional] [--audio public/audio] [--content public/content] [--dist dist]
 *                                    [--previous <manifest.json>] [--content-diff <0..1>]
 *
 *  - no manifest → `audio pack: none — speechSynthesis only` (exit 0 with --optional, else 1)
 *  - manifest.contentVersion ≠ public/content/manifest.json → WARN (stale pack; the text-keyed fallbacks degrade gracefully)
 *  - a cue key whose `kana.json` hash ≠ the content's kana, a key the sidecar lacks, or a key with no content behind it → FAIL
 *  - belts sums ≠ files sums → FAIL
 *  - dist/ over 900 MB → FAIL (Pages limit 1 GB)
 *  - prints reusedBytesShare (from the manifest, or recomputed against --previous) and WARNS when it is
 *    below 0.9 while the content diff touched < 5 % of clip keys — the diff is measured on the two packs'
 *    `kana.json` sidecars (`--previous`'s directory, or `manifest.contentDiffShare` from the render), or
 *    given as --content-diff; `changedClipShare` (clips rendered this run) is informational only, since a
 *    cold cache makes it 1 whatever the content did
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentFile, GrammarItem, KanaItem, KanjiItem, MichikusaItem, StoryItem, VocabItem } from '../../src/content/types.ts';
import { type AudioManifest, type CueIndex, type KanaIndex, type StoriesIndex, type TracksIndex, FILES_SIDECAR, KANA_SIDECAR, kanaDiffShare, kanaHash, MAX_DIST_BYTES, reusedBytesShare } from './indexes.ts';
import { synthesizeMinimalPair } from './verify.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
export const NONE_MESSAGE = 'audio pack: none — speechSynthesis only';
export const REUSE_WARN_BELOW = 0.9;
export const SMALL_DIFF_BELOW = 0.05;

export interface Finding {
  level: 'fail' | 'warn' | 'info';
  message: string;
}

/* ── content kana lookup ───────────────────────────────────────────────── */

export interface KanaLookup {
  /** The content kana behind a clip key; `undefined` when the key resolves to nothing; `null` when the content has no kana (collocations). */
  (key: string): string | undefined | null;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.json')) out.push(p);
  }
  return out;
}

const items = <T>(root: string, sub: string): T[] => walk(join(root, sub)).flatMap((p) => (JSON.parse(readFileSync(p, 'utf8')) as ContentFile<T>).items);

/** Builds the key → kana resolver over a content root (docs/AUDIO_PACK.md §2 keys). */
export function contentKanaLookup(root: string): KanaLookup {
  const kana = new Map(items<KanaItem>(root, 'kana').map((k) => [k.id, k]));
  const vocab = new Map(items<VocabItem>(root, 'vocab').map((v) => [v.id, v]));
  const kanji = new Map(items<KanjiItem>(root, 'kanji').map((k) => [k.id, k]));
  const grammar = new Map(items<GrammarItem>(root, 'grammar').map((g) => [g.id, g]));
  const stories = new Map(items<StoryItem>(root, 'stories').map((s) => [s.id, s]));
  const michikusa = new Map(items<MichikusaItem>(root, 'michikusa').map((m) => [m.id, m]));
  return (key) => {
    const [id, frag] = key.split('#') as [string, string | undefined];
    if (id.startsWith('k-')) {
      const k = kana.get(id);
      if (!k) return undefined;
      if (frag === undefined) return k.kana;
      return frag === 'ex0' ? k.exampleWord.kana : undefined;
    }
    if (id.startsWith('v-')) {
      const v = vocab.get(id);
      if (!v) return undefined;
      if (frag === undefined) return v.kana;
      if (frag === 'ga') return `${v.kana}が`;
      if (frag === 'def') return v.definitionJa?.kana;
      if (frag === 'pair') return synthesizeMinimalPair(v.kana); // the partner the runtime keys as #pair (pure function of the kana)
      const col = /^col(\d+)$/.exec(frag);
      if (col) return (v.collocations ?? [])[Number(col[1])] === undefined ? undefined : null;
      const ex = /^ex(\d+)$/.exec(frag);
      if (ex) return v.examples[Number(ex[1])]?.kana;
      return undefined;
    }
    if (id.startsWith('g-')) {
      const g = grammar.get(id);
      const ex = frag ? /^ex(\d+)$/.exec(frag) : null;
      return g && ex ? g.examples[Number(ex[1])]?.kana : undefined;
    }
    if (id.startsWith('j-')) {
      const k = kanji.get(id);
      const ex = frag ? /^ex(\d+)$/.exec(frag) : null;
      return k && ex ? k.examples[Number(ex[1])]?.kana : undefined;
    }
    if (id.startsWith('s-')) {
      const s = stories.get(id);
      if (!s) return undefined;
      if (frag === undefined) return null; // the whole-text track has no single kana
      const line = /^L(\d+)$/.exec(frag);
      return line ? s.lines[Number(line[1])]?.kana : undefined;
    }
    if (id.startsWith('m-')) {
      const m = michikusa.get(id);
      return m ? m.kana : undefined;
    }
    if (id.startsWith('track:')) return null;
    return undefined;
  };
}

/* ── checks ────────────────────────────────────────────────────────────── */

type AnyIndexJson = CueIndex | StoriesIndex | TracksIndex | KanaIndex;

/**
 * Every cue key of every runtime index against the content: the key must
 * resolve to content, and its `kana.json` record (fnv1a32 hex8 of the kana the
 * clip was verified against) must equal the hash of the content's kana now.
 * A key the sidecar lacks is a failure too (the pack was built without it).
 */
export function checkIndexes(indexes: readonly { path: string; json: AnyIndexJson }[], lookup: KanaLookup, kanaKeys: Readonly<Record<string, string>>): Finding[] {
  const out: Finding[] = [];
  let cues = 0;
  const check = (path: string, key: string): void => {
    cues++;
    const kana = lookup(key);
    const k = kanaKeys[key];
    if (kana === undefined) out.push({ level: 'fail', message: `${path}: cue ${key} has no content behind it` });
    else if (k === undefined) out.push({ level: 'fail', message: `${path}: cue ${key} has no record in ${KANA_SIDECAR}` });
    else if (kana !== null && kanaHash(kana) !== k) out.push({ level: 'fail', message: `${path}: cue ${key} was rendered from different kana than the content now has (pack ${k}, content ${kanaHash(kana)})` });
  };
  for (const f of indexes) {
    const j = f.json;
    if (!('kind' in j) || j.kind === 'tracks' || j.kind === 'kana') continue; // sidecars / tracks carry no cue kana
    if (j.kind === 'stories') {
      for (const [id, t] of Object.entries(j.texts)) t.lines.forEach((cuesOfLine, i) => cuesOfLine.forEach(() => check(f.path, `${id}#L${i}`)));
      for (const [key, list] of Object.entries(j.misc)) list.forEach(() => check(f.path, key));
      continue;
    }
    for (const [key, list] of Object.entries(j.cues)) list.forEach(() => check(f.path, key));
  }
  out.push({ level: 'info', message: `${cues} cues checked against the content kana` });
  return out;
}

/** `belts` sums equal `files` sums (bytes, seconds within 1 ms per file, files). */
export function checkBelts(m: AudioManifest): Finding[] {
  const out: Finding[] = [];
  const sum = { bytes: 0, files: 0, seconds: 0 };
  for (const b of Object.values(m.belts)) {
    sum.bytes += b.bytes;
    sum.files += b.files;
    sum.seconds += b.seconds;
  }
  const files = m.files.reduce((s, f) => ({ bytes: s.bytes + f.bytes, files: s.files + 1, seconds: s.seconds + f.seconds }), { bytes: 0, files: 0, seconds: 0 });
  if (sum.bytes !== files.bytes || sum.files !== files.files) out.push({ level: 'fail', message: `manifest.belts sums (${sum.bytes} bytes, ${sum.files} files) differ from files (${files.bytes} bytes, ${files.files} files)` });
  if (Math.abs(sum.seconds - files.seconds) > 0.001 * Math.max(1, files.files)) out.push({ level: 'fail', message: `manifest.belts seconds (${sum.seconds}) differ from files (${files.seconds})` });
  if (m.totals.bytes !== files.bytes || m.totals.files !== files.files) out.push({ level: 'fail', message: `manifest.totals (${m.totals.bytes} bytes, ${m.totals.files} files) differ from files` });
  return out;
}

export function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirBytes(p) : st.size;
  }
  return total;
}

export function checkDist(dist: string, max = MAX_DIST_BYTES): Finding[] {
  if (!existsSync(dist)) return [{ level: 'info', message: `${dist} absent (not built yet); size not checked` }];
  const bytes = dirBytes(dist);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return bytes > max ? [{ level: 'fail', message: `dist is ${mb} MB, over the ${(max / 1024 / 1024).toFixed(0)} MB cap (Pages limit 1 GB)` }] : [{ level: 'info', message: `dist ${mb} MB (cap ${(max / 1024 / 1024).toFixed(0)} MB)` }];
}

/**
 * reusedBytesShare report: warn below 0.9 when the content diff was small. The
 * diff is, in order: `contentDiff` (given, or measured from two `kana.json`
 * sidecars), `manifest.contentDiffShare` (the render measured it against the
 * previous pack), else unknown — then a low share still warns, since nothing
 * explains it. `changedClipShare` is never used as the diff (a cold cache
 * renders everything whatever the content did).
 */
export function checkReuse(m: AudioManifest, previous: AudioManifest | null, contentDiff?: number | null): Finding[] {
  const share = previous ? reusedBytesShare(m.files, previous) : m.reusedBytesShare;
  const diff = contentDiff ?? m.contentDiffShare ?? null;
  if (share === null) return [{ level: 'info', message: 'reusedBytesShare: n/a (no previous manifest)' }];
  const base = `reusedBytesShare ${share} (content diff ${diff === null ? 'unknown' : `${(diff * 100).toFixed(1)} % of clip keys`}; ${(m.changedClipShare * 100).toFixed(1)} % of clips rendered this run)`;
  if (share < REUSE_WARN_BELOW && (diff === null || diff < SMALL_DIFF_BELOW)) return [{ level: 'warn', message: `${base}: a ${diff === null ? 'content change of unknown size' : 'small content change'} re-downloads ${((1 - share) * 100).toFixed(0)} % of the pack — check the sprite grouping before shipping` }];
  return [{ level: 'info', message: base }];
}

/** The `kana.json` sidecar a manifest names, read from its audio directory (`null` when absent). */
export function readKanaKeys(audioDir: string, m: Pick<AudioManifest, 'indexes' | 'audioVersion'>): Record<string, string> | null {
  const entry = m.indexes.find((i) => i.path.endsWith(`/${KANA_SIDECAR}`)) ?? { path: `${m.audioVersion}/${KANA_SIDECAR}` };
  const p = join(audioDir, entry.path);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as Partial<KanaIndex>;
    return j.kind === 'kana' && j.keys ? j.keys : null;
  } catch {
    return null;
  }
}

export interface CheckOptions {
  audioDir: string;
  contentDir: string;
  dist: string;
  optional: boolean;
  previous?: string;
  contentDiff?: number;
  log?: (s: string) => void;
}

export function checkAudio(o: CheckOptions): { code: number; findings: Finding[] } {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const manifestPath = join(o.audioDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    log(NONE_MESSAGE);
    return { code: o.optional ? 0 : 1, findings: [{ level: o.optional ? 'info' : 'fail', message: NONE_MESSAGE }] };
  }
  const findings: Finding[] = [];
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as AudioManifest;
  const contentManifest = join(o.contentDir, 'manifest.json');
  const contentVersion = existsSync(contentManifest) ? (JSON.parse(readFileSync(contentManifest, 'utf8')) as { contentVersion?: string }).contentVersion : undefined;
  if (contentVersion && contentVersion !== m.contentVersion) findings.push({ level: 'warn', message: `stale pack: audio ${m.audioVersion} was rendered for ${m.contentVersion}, content is ${contentVersion} (text-keyed fallbacks degrade gracefully; re-render soon)` });
  else findings.push({ level: 'info', message: `pack ${m.audioVersion} for ${m.contentVersion}${m.dryRun ? ' (DRY RUN manifest)' : ''}` });
  if (m.partial) findings.push({ level: 'warn', message: `partial pack: rendered with ${JSON.stringify(m.partial)} — not for release (pack.ts refuses it)` });
  const indexes: { path: string; json: AnyIndexJson }[] = [];
  for (const i of m.indexes) {
    const p = join(o.audioDir, i.path);
    if (!existsSync(p)) {
      findings.push({ level: 'fail', message: `index ${i.path} named by the manifest is missing` });
      continue;
    }
    if (i.path.endsWith(`/${FILES_SIDECAR}`)) continue; // the sha256 sidecar is not a cue index
    indexes.push({ path: i.path, json: JSON.parse(readFileSync(p, 'utf8')) as AnyIndexJson });
  }
  for (const f of m.files) if (!existsSync(join(o.audioDir, f.path)) && !m.dryRun) findings.push({ level: 'fail', message: `sprite ${f.path} named by the manifest is missing` });
  const kanaKeys = readKanaKeys(o.audioDir, m);
  if (!kanaKeys) findings.push({ level: 'fail', message: `${m.audioVersion}/${KANA_SIDECAR} is missing or not a kana sidecar: the cues cannot be checked against the content` });
  findings.push(...checkIndexes(indexes, contentKanaLookup(o.contentDir), kanaKeys ?? {}));
  findings.push(...checkBelts(m));
  findings.push(...checkDist(o.dist));
  const previous = o.previous && existsSync(o.previous) ? (JSON.parse(readFileSync(o.previous, 'utf8')) as AudioManifest) : null;
  // The content diff: given, else measured from the two kana sidecars when --previous points at a pack directory.
  const previousKeys = previous && o.previous ? readKanaKeys(dirname(o.previous), previous) : null;
  const measured = kanaKeys && previousKeys ? kanaDiffShare(kanaKeys, previousKeys) : null;
  findings.push(...checkReuse(m, previous, o.contentDiff ?? measured));
  for (const f of findings) log(`${f.level === 'fail' ? 'FAIL' : f.level === 'warn' ? 'WARN' : 'info'}: ${f.message}`);
  const failed = findings.some((f) => f.level === 'fail');
  log(failed ? 'audio:check — FAILED' : `audio:check — ok (${findings.filter((f) => f.level === 'warn').length} warnings)`);
  return { code: failed ? 1 : 0, findings };
}

function parse(argv: readonly string[]): CheckOptions {
  const o: CheckOptions = { audioDir: join(REPO_ROOT, 'public', 'audio'), contentDir: join(REPO_ROOT, 'public', 'content'), dist: join(REPO_ROOT, 'dist'), optional: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--optional') o.optional = true;
    else if (a === '--audio') o.audioDir = resolve(v());
    else if (a === '--content') o.contentDir = resolve(v());
    else if (a === '--dist') o.dist = resolve(v());
    else if (a === '--previous') o.previous = resolve(v());
    else if (a === '--content-diff') o.contentDiff = Number(v());
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(checkAudio(parse(process.argv.slice(2))).code);
  } catch (e) {
    process.stderr.write(`check-audio: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
