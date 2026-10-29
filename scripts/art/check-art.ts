/**
 * TSUZUKU — post-build print pack check (docs/ART_PACK.md §5; deploy.yml's last steps).
 *
 *   node scripts/art/check-art.ts [--optional] [--art public/art]
 *
 *  - no manifest → `art pack: none — the drawn room stands` (exit 0 with --optional, else 1)
 *  - `manifestProblems` (schema.ts): the schema and version; every print's title / artist /
 *    series with ja, reading and en, its source accession and credit line, lqip ≤ 1,000 chars,
 *    bytes ≤ 400,000; the station table complete 0..54; calendar.day 72 and calendar.night 12;
 *    every id resolving; roles agreeing with the tables; the prints' total ≤ 30 MB
 *  - every file the manifest names exists with its bytes and sha256, and its own WebP header
 *    says the manifest's width × height
 *  - exit 1 on any failure, each on its own `FAIL:` line
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ArtManifest, manifestProblems, NONE_MESSAGE, sha256Hex, webpDimensions } from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
export { NONE_MESSAGE };

export interface Finding {
  level: 'fail' | 'warn' | 'info';
  message: string;
}

/** Every file the manifest names: present, the right length, the right hash, the header's dimensions. */
export function checkFiles(artDir: string, m: ArtManifest): Finding[] {
  const out: Finding[] = [];
  let bytes = 0;
  for (const p of m.prints ?? []) {
    const path = join(artDir, p.file);
    if (!existsSync(path)) {
      out.push({ level: 'fail', message: `${p.file} named by the manifest is missing` });
      continue;
    }
    const buf = readFileSync(path);
    bytes += buf.length;
    if (buf.length !== p.bytes) out.push({ level: 'fail', message: `${p.file}: ${buf.length} bytes, manifest says ${p.bytes}` });
    else if (sha256Hex(buf) !== p.sha256) out.push({ level: 'fail', message: `${p.file}: sha256 differs from the manifest` });
    try {
      const d = webpDimensions(buf);
      if (d.width !== p.width || d.height !== p.height) out.push({ level: 'fail', message: `${p.file}: header says ${d.width}×${d.height}, manifest says ${p.width}×${p.height}` });
    } catch (e) {
      out.push({ level: 'fail', message: `${p.file}: ${(e as Error).message}` });
    }
  }
  out.push({ level: 'info', message: `${(m.prints ?? []).length} prints on disk, ${(bytes / 1024 / 1024).toFixed(2)} MB` });
  return out;
}

export interface CheckOptions {
  artDir: string;
  optional: boolean;
  log?: (s: string) => void;
}

export function checkArt(o: CheckOptions): { code: number; findings: Finding[] } {
  const log = o.log ?? ((s: string) => process.stdout.write(s + '\n'));
  const manifestPath = join(o.artDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    log(NONE_MESSAGE);
    return { code: o.optional ? 0 : 1, findings: [{ level: o.optional ? 'info' : 'fail', message: NONE_MESSAGE }] };
  }
  const findings: Finding[] = [];
  let m: ArtManifest;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtManifest;
  } catch (e) {
    findings.push({ level: 'fail', message: `${manifestPath} is not valid JSON: ${(e as Error).message}` });
    log(`FAIL: ${findings[0]?.message}`);
    log('art:check — FAILED');
    return { code: 1, findings };
  }
  findings.push({ level: 'info', message: `pack ${m.artVersion} (${m.generatedAt}), ${(m.prints ?? []).length} prints` });
  for (const p of manifestProblems(m)) findings.push({ level: 'fail', message: p });
  findings.push(...checkFiles(o.artDir, m));
  for (const f of findings) log(`${f.level === 'fail' ? 'FAIL' : f.level === 'warn' ? 'WARN' : 'info'}: ${f.message}`);
  const failed = findings.some((f) => f.level === 'fail');
  log(failed ? 'art:check — FAILED' : `art:check — ok (${findings.filter((f) => f.level === 'warn').length} warnings)`);
  return { code: failed ? 1 : 0, findings };
}

function parse(argv: readonly string[]): CheckOptions {
  const o: CheckOptions = { artDir: join(REPO_ROOT, 'public', 'art'), optional: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--optional') o.optional = true;
    else if (a === '--art') o.artDir = resolve(v());
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(checkArt(parse(process.argv.slice(2))).code);
  } catch (e) {
    process.stderr.write(`check-art: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
