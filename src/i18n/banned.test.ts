/**
 * Banned-copy lint (design 01 §3, ARCHITECTURE §8).
 *
 * Scans every strings module (`src/<folder>/**\/strings.ts`, split files
 * `strings-2.ts`, and prefixed ones such as `engine-strings.ts`) AND every
 * `.tsx` (tests excluded) as text, plus the exported string values of every
 * strings module that can be imported, plus the learner-facing copy that lives
 * in data tables outside strings files (quest and mission text in
 * `shared/catalog`, station gate names and belt titles in `content/types`, the
 * `.ics` reminder text, and the sekki / kō glosses in `public/calendar/koyomi.json`,
 * design 09 §4.3). Files that do not exist yet are simply not scanned; the
 * report names file:line and the offending phrase.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BANNED, findBanned, lineOf } from './banned-phrases';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

const ALL = walk(SRC);
/** `strings.ts`, `strings-<n>.ts` and `<prefix>-strings.ts` (never tests). */
const STRINGS_RE = /(^|\/)(?:[\w-]+-)?strings(?:-\d+)?\.ts$/;
const STRINGS_FILES = ALL.filter((p) => STRINGS_RE.test(rel(p)));
const TSX_FILES = ALL.filter((p) => p.endsWith('.tsx') && !/\.test\.tsx$/.test(p));

function scanText(path: string, text: string): string[] {
  return findBanned(text).map((h) => `${rel(path)}:${lineOf(text, h.index)}  "${h.match}"  (rule ${h.rule.source})`);
}

function collectStrings(v: unknown, path: string, out: { path: string; value: string }[], depth = 0): void {
  if (depth > 6) return;
  if (typeof v === 'string') out.push({ path, value: v });
  else if (Array.isArray(v)) v.forEach((x, i) => collectStrings(x, `${path}[${i}]`, out, depth + 1));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) collectStrings(x, `${path}.${k}`, out, depth + 1);
  }
}

describe('banned phrases: the list itself', () => {
  const MUST_MATCH = [
    'You lost your streak',
    "Don't let Sensei down",
    'Only 3 hours left',
    'Hurry up',
    'Last chance',
    "Don't break your streak",
    'Streak at risk',
    'Oops',
    "You're on fire",
    'Game over',
    'Wrong answer!',
    'Oh no, you missed!',
    '🔥🔥🔥',
    'Keep your streak alive',
    'We miss you',
    'Time is running out',
  ];
  const MUST_PASS = [
    "Again. That's the training.",
    'Good. Now you know what to train.',
    'Not yet. The gate will still be here.',
    'The dojo kept your place.',
    'Rest is training.',
    'Enough new words for today. The dojo will be here tomorrow.',
    "Don't know",
    'The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty.',
    'Good training. Rest. つづく',
    'Unlit. Your first session lights it.',
    'Streak paused · repair open: 1 of 3 days',
    'repair open · 0 of 3 days',
    'Since yesterday: a lantern lit.',
    'Ippon',
    'Only mature items are timed.',
    'A new version of the dojo is ready.',
    '一本 🎌',
    'Insert Coin',
  ];

  it('every regex is case-insensitive and has no g flag side effects', () => {
    for (const re of BANNED) {
      expect(re.flags, re.source).toContain('i');
      expect(re.flags, re.source).not.toContain('g');
    }
  });

  it.each(MUST_MATCH)('flags %j', (text) => {
    expect(findBanned(text).length, text).toBeGreaterThan(0);
  });

  it.each(MUST_PASS)('allows %j', (text) => {
    expect(findBanned(text).map((h) => h.rule.source), text).toEqual([]);
  });

  it('lineOf reports 1-based lines', () => {
    const text = 'a\nb\nOops';
    const [hit] = findBanned(text);
    expect(hit).toBeDefined();
    expect(lineOf(text, hit!.index)).toBe(3);
  });
});

describe('banned phrases: the codebase', () => {
  it('finds the strings files that exist (report)', () => {
    // Informational: lists what was scanned so a missing file is visible, not silent.
    const names = STRINGS_FILES.map(rel);
    expect(names).toContain('src/i18n/strings.ts');
    console.info(`[banned] scanning ${names.length} strings files, ${TSX_FILES.length} tsx files`);
  });

  it('no strings.ts contains a banned phrase', () => {
    const problems: string[] = [];
    for (const f of STRINGS_FILES) {
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      problems.push(...scanText(f, text));
    }
    expect(problems, `banned copy:\n${problems.join('\n')}`).toEqual([]);
  });

  it('no .tsx contains a banned phrase', () => {
    const problems: string[] = [];
    for (const f of TSX_FILES) {
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      problems.push(...scanText(f, text));
    }
    expect(problems, `banned copy:\n${problems.join('\n')}`).toEqual([]);
  });

  it('exported string values of every importable strings module are clean', async () => {
    const modules = import.meta.glob(['/src/**/strings.ts', '/src/**/strings-*.ts', '/src/**/*-strings.ts']);
    const problems: string[] = [];
    let scanned = 0;
    for (const [path, load] of Object.entries(modules)) {
      let mod: unknown;
      try {
        mod = await load();
      } catch (err) {
        console.warn(`[banned] skipped ${path}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      scanned++;
      const values: { path: string; value: string }[] = [];
      collectStrings(mod, path, values);
      for (const { path: p, value } of values) {
        for (const hit of findBanned(value)) problems.push(`${p} = ${JSON.stringify(value)}  (rule ${hit.rule.source})`);
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(problems, `banned copy in exported strings:\n${problems.join('\n')}`).toEqual([]);
  });

  it('learner-facing copy outside strings files (quests, missions, gates, belts, .ics) is clean and never shouts', async () => {
    const { QUESTS, MISSIONS } = await import('@/shared/catalog');
    const { STATIONS, BELTS } = await import('@/content/types');
    const { ICS_SUMMARY, ICS_DESCRIPTION } = await import('@/app/ics');
    const values: { path: string; value: string }[] = [];
    collectStrings(QUESTS, 'shared/catalog#QUESTS', values);
    collectStrings(MISSIONS, 'shared/catalog#MISSIONS', values);
    collectStrings(STATIONS, 'content/types#STATIONS', values);
    collectStrings(BELTS, 'content/types#BELTS', values);
    collectStrings({ ICS_SUMMARY, ICS_DESCRIPTION }, 'app/ics', values);
    expect(values.length).toBeGreaterThan(50);
    const problems: string[] = [];
    for (const { path: p, value } of values) {
      for (const hit of findBanned(value)) problems.push(`${p} = ${JSON.stringify(value)}  (rule ${hit.rule.source})`);
      if (value.includes('!')) problems.push(`${p} = ${JSON.stringify(value)}  (exclamation mark)`);
    }
    expect(problems, `banned copy outside strings files:\n${problems.join('\n')}`).toEqual([]);
  });

  /**
   * Design 09 §4.3 / §7 H: the 24 sekki and 72 kō carry Japanese names and
   * English glosses as DATA (the kanji never enter `src`). The glosses are
   * learner-facing copy in the Sensei voice: dates, never "in N days"; no
   * countdown, no exclamation. The file lands with A3; until then the scan
   * reports it as absent instead of failing.
   */
  it('the calendar data table (public/calendar/koyomi.json) is clean, never shouts and never counts down', () => {
    const path = join(ROOT, 'public', 'calendar', 'koyomi.json');
    if (!existsSync(path)) {
      console.info('[banned] public/calendar/koyomi.json not landed yet: skipped');
      return;
    }
    const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const values: { path: string; value: string }[] = [];
    collectStrings(data, 'public/calendar/koyomi.json', values);
    expect(values.length).toBeGreaterThan(24);
    const problems: string[] = [];
    for (const { path: p, value } of values) {
      for (const hit of findBanned(value)) problems.push(`${p} = ${JSON.stringify(value)}  (rule ${hit.rule.source})`);
      if (value.includes('!')) problems.push(`${p} = ${JSON.stringify(value)}  (exclamation mark)`);
      if (/\bin \d+ days?\b/i.test(value)) problems.push(`${p} = ${JSON.stringify(value)}  (countdown: a date, never "in N days")`);
    }
    expect(problems, `banned copy in the calendar table:\n${problems.join('\n')}`).toEqual([]);
  });
});

/* ── listening honesty (design 08 §10.1 / §12) ────────────────────────────── */

/**
 * The listening program's vocabulary rules: a chip, header or label names the
 * voice as "synthetic voice (VOICEVOX)", "device voice" or "text only" and
 * never says "recorded voice" (the one place "recorded" may appear is the
 * Settings voice-pack explanation, `setPackExplain`); and the two perapera
 * sentences the program retired — "Real listening is the hours you log" (it
 * would deny the dojo's authentic minutes) and "every voice in the app is
 * text-to-speech" — are gone for good.
 */
const HONESTY_BANNED: RegExp[] = [/\brecorded voices?\b/i, /real listening is the hours you log/i, /every voice in the app is text-to-speech/i];
/** The exemption: file (repo-relative) and key / line marker. */
const HONESTY_EXEMPT = { file: /^src\/app\/pages\/strings\.ts$/, key: 'setPackExplain' };

function findHonesty(text: string): string[] {
  return HONESTY_BANNED.filter((re) => re.test(text)).map((re) => re.source);
}

describe('listening honesty copy (design 08 §10.1 / §12)', () => {
  const MUST_FLAG = ['recorded voice', 'A recorded voice reads each line.', 'Recorded voices, clear and consistent.', 'Real listening is the hours you log.', 'Synthetic: every voice in the app is text-to-speech. Real listening is the hours you log.'];
  const MUST_PASS = [
    'synthetic voice (VOICEVOX)',
    'device voice',
    'text only',
    'Pre-rendered synthetic voices (VOICEVOX).',
    "Synthetic: every voice in the dojo is a VOICEVOX character voice. The ledger's outside hours are real people.",
    '3 voices · synthetic',
    'Recorded. Play the model, then yours, and compare.', // the learner's own recording, not a voice claim
  ];

  it.each(MUST_FLAG)('flags %j', (text) => {
    expect(findHonesty(text).length, text).toBeGreaterThan(0);
  });

  it.each(MUST_PASS)('allows %j', (text) => {
    expect(findHonesty(text), text).toEqual([]);
  });

  it('no strings file or .tsx carries "recorded voice" or the retired sentences (the Settings explanation line is the one exemption)', () => {
    const problems: string[] = [];
    for (const f of [...STRINGS_FILES, ...TSX_FILES]) {
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      const exemptFile = HONESTY_EXEMPT.file.test(rel(f));
      text.split('\n').forEach((line, i) => {
        if (exemptFile && line.includes(HONESTY_EXEMPT.key)) return;
        for (const rule of findHonesty(line)) problems.push(`${rel(f)}:${i + 1}  (rule ${rule})`);
      });
    }
    expect(problems, `listening honesty:\n${problems.join('\n')}`).toEqual([]);
  });

  it('exported string values of every importable strings module are clean of them too', async () => {
    const modules = import.meta.glob(['/src/**/strings.ts', '/src/**/strings-*.ts', '/src/**/*-strings.ts']);
    const problems: string[] = [];
    let scanned = 0;
    for (const [path, load] of Object.entries(modules)) {
      let mod: unknown;
      try {
        mod = await load();
      } catch {
        continue;
      }
      scanned++;
      const values: { path: string; value: string }[] = [];
      collectStrings(mod, path, values);
      for (const { path: p, value } of values) {
        if (path.endsWith('/src/app/pages/strings.ts') && p.endsWith(`.${HONESTY_EXEMPT.key}`)) continue;
        for (const rule of findHonesty(value)) problems.push(`${p} = ${JSON.stringify(value)}  (rule ${rule})`);
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(problems, `listening honesty in exported strings:\n${problems.join('\n')}`).toEqual([]);
  });
});
