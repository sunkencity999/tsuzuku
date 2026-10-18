#!/usr/bin/env python3
"""Build TSUZUKU webfont subsets (public/fonts/*.woff2 + src/styles/fonts.css).

Usage (one-off, needs fonttools + brotli; not part of npm scripts):
  python3 -m venv <scratch>/fontenv && <scratch>/fontenv/bin/pip install fonttools brotli
  # download the four OFL TTFs + OFL.txt from github.com/google/fonts (raw.githubusercontent.com,
  # ofl/<family>/...) into a NEW, EMPTY <dir>:
  #   <dir>/dotgothic16/DotGothic16-Regular.ttf, <dir>/yujisyuku/YujiSyuku-Regular.ttf,
  #   <dir>/shipporiminchob1/ShipporiMinchoB1-Regular.ttf, <dir>/delagothicone/DelaGothicOne-Regular.ttf
  <scratch>/fontenv/bin/python -I scripts/fonts/build-fonts.py <dir>     # add --plan to only print the slices
  The downloaded directory is data: this script only reads it (never run anything from inside it),
  which is why it is passed as an argument instead of being a working directory.

Slices per family, declared in this order because later @font-face rules win for an
overlapping unicode-range (CSS Fonts 4 §4.5):
  rest          every other CJK ideograph of the corpus; its range is the whole CJK block, so it
                has the lowest precedence. Not built for the families in NO_REST_FAMILIES.
  n2 n3 n4 n5   the kanji of each JLPT level (public/content/kanji/<level>/*.json; a kanji listed
                at two levels belongs to the lower one), explicit code points, minus the UI
                inventory. The kanji dirs are the only source of level slices.
  base          ASCII, kana, symbols, punctuation (block ranges) + the UI glyph inventory: every
                CJK ideograph, and every other glyph outside the base blocks, that the shell
                itself can render — src/**/*.{ts,tsx,css} (strings files, STATIONS, belt, page
                and reward names, art labels), index.html and public/manifest.webmanifest, minus
                UI_EXCLUDE, plus EXTRA_UI (glyphs the shell renders from data, design 09 §3.5).
                Listed as explicit code points and declared after the level slices, so a
                brand-new learner renders the header, the Road and the Library from `base`
                alone and never downloads a level slice for shell chrome.
  shell         SHELL_FAMILIES only (design 09 §3.5): the few glyphs the Dojo's first paint and
                the Road set in that face, as explicit code points, declared AFTER `base` so it
                wins the overlap; `base` keeps the full inventory for the coverage rule and is
                fetched only when a glyph outside the shell list is rendered in that face.
                Yuji Syuku: the brand word (tsuzuku), the belt names and the station names (read
                from src/content/types.ts at build time), ippon / kiai / yasumi, the five flame
                glyphs, and the Dojo home's own brush words — the three session names and the
                kotodama caption, read from the strings files (DOJO_BRUSH_KEYS) — so the home
                screen never fetches YujiSyuku-base. Shippori Mincho B1: the 24 sekki names, the
                sekki label, the station ordinal glyphs with the numerals one to ten, the era-date
                glyphs, the eight moon names, the omikuji heads; the sekki and moon names are also
                read from public/calendar/koyomi.json (A3's data, the source of truth) when it is
                present, so a respelling there flows through a rebuild.
                Budgets (09 §10): Yuji shell <= 60 KB, Shippori shell <= 40 KB,
                first paint = DotGothic16-base + both shells <= 250 KB — src/styles/fonts.test.ts
                asserts them from the files on disk; this script prints them after a build.
Stale `<stem>-<slice>.woff2` files the run did not build are removed, so the directory always
matches the stylesheet. `--plan` prints the inventory and per-slice glyph counts only. After a
build every slice's cmap is read back with fontTools and checked against the glyphs it was asked
to carry (a glyph the source TTF itself lacks is reported, not fatal; one the TTF has but the
slice lost is a build failure).

No CJK ideograph is written literally in this file: the hand-maintained glyph lists below are
\\u escapes with a romaji note, so the only kanji that enter the pipeline by hand are visibly
spelled out and none can leak into a file that src/styles/fonts.test.ts scans (it walks src/**,
index.html and the manifest, never scripts/).
"""
import glob, json, os, re, subprocess, sys, shutil, unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
if len(sys.argv) < 2 or sys.argv[1].startswith('--'):
    sys.exit(__doc__)
SRC = sys.argv[1]            # downloaded fonts dir
OUT = os.path.join(ROOT, 'public', 'fonts')
CSS_OUT = os.path.join(ROOT, 'src', 'styles', 'fonts.css')
PLAN = '--plan' in sys.argv

FAMILIES = [
    # (file stem, family, dir, local() names)
    ('DotGothic16', 'DotGothic16', 'dotgothic16', ['DotGothic16', 'DotGothic16-Regular']),
    ('YujiSyuku', 'Yuji Syuku', 'yujisyuku', ['Yuji Syuku', 'YujiSyuku-Regular']),
    ('ShipporiMinchoB1', 'Shippori Mincho B1', 'shipporiminchob1', ['Shippori Mincho B1', 'ShipporiMinchoB1-Regular']),
    ('DelaGothicOne', 'Dela Gothic One', 'delagothicone', ['Dela Gothic One', 'DelaGothicOne-Regular']),
]
SLICE_NAMES = ('rest', 'n2', 'n3', 'n4', 'n5', 'base', 'shell')

# The brush face (--font-brush) draws shell chrome, station and reward names, never corpus
# text, so its catch-all `rest` slice (815 KB: every N1 / vocabulary-only ideograph of the
# corpus) was fetched by every phone that opened the Road for a handful of glyphs. These
# families ship no `rest` face and emit no @font-face for it; the shell glyphs they need are
# in `base`, and a non-corpus kanji falls back to the system mincho next in the stack.
NO_REST_FAMILIES = frozenset({'YujiSyuku'})

# UI glyph inventory: repo-relative globs scanned, and path fragments left out of the scan.
UI_SOURCES = ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.css', 'index.html', 'public/manifest.webmanifest']
UI_EXCLUDE = (
    '.test.',                             # test fixtures never render
    'src/content/fixtures/',              # contract-tier test doubles (a fixture corpus)
    'src/art/wallpapers/kanji-stars.ts',  # component → kanji index over corpus kanji: a star is drawn only
                                          # for a kanji the learner mastered, whose level slice is present
)
# src/styles/fonts.test.ts mirrors UI_SOURCES / UI_EXCLUDE / EXTRA_UI / the shell lists; change both together.

# Design 09 §3.5: glyphs the shell renders from DATA (public/calendar/koyomi.json), never from
# src, so the inventory walk cannot find them — the twelve sekki ideographs no landed string
# covers (kei chitsu koku man bou shu shi sho sho ro kan sou) and the sekki label's first glyph
# (setsu). 13 code points, added to every family's `base` and removed from the level slices.
EXTRA_UI = frozenset('\u5553\u87c4\u7a40\u6e80\u8292\u7a2e\u81f3\u6691\u51e6\u9732\u5bd2\u971c\u7bc0')

# ── shell lists (design 09 §3.5) ────────────────────────────────────────────────────────────
# Shippori Mincho B1 — the Dojo's tategaki column (§5.9) and the Station headpiece ordinal (§3.3).
SEKKI = [  # the 24 sekki names, risshun → daikan (§4.3's table)
    '\u7acb\u6625', '\u96e8\u6c34', '\u5553\u87c4', '\u6625\u5206', '\u6e05\u660e', '\u7a40\u96e8',
    '\u7acb\u590f', '\u5c0f\u6e80', '\u8292\u7a2e', '\u590f\u81f3', '\u5c0f\u6691', '\u5927\u6691',
    '\u7acb\u79cb', '\u51e6\u6691', '\u767d\u9732', '\u79cb\u5206', '\u5bd2\u9732', '\u971c\u964d',
    '\u7acb\u51ac', '\u5c0f\u96ea', '\u5927\u96ea', '\u51ac\u81f3', '\u5c0f\u5bd2', '\u5927\u5bd2',
]
COLUMN = [
    '\u7bc0\u6c17',                                              # sekki (the column's label)
    '\u7b2c\u5bbf',                                              # dai … shuku (the station ordinal frame)
    '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341',  # ichi … juu (numerals one to ten)
    '\u4ee4\u548c\u5143\u5e74\u6708\u65e5',                      # reiwa gannen / nen / gatsu / nichi (era date)
]
MOON = [  # the eight moon names as public/calendar/koyomi.json spells them (/moon, A3); the hand list documents the data
    '\u65b0\u6708', '\u4e09\u65e5\u6708', '\u534a\u6708', '\u5341\u4e09\u591c',                  # shingetsu mikazuki hangetsu jūsan'ya
    '\u6e80\u6708', '\u5341\u516d\u591c', '\u4e8c\u5341\u4e09\u591c', '\u4e8c\u5341\u516d\u591c',  # mangetsu izayoi nijūsan'ya nijūroku'ya
]
OMIKUJI = ['\u5927\u5409', '\u4e2d\u5409', '\u5c0f\u5409', '\u5409', '\u672b\u5409', '\u51f6']  # daikichi chūkichi shōkichi kichi suekichi kyō
# Yuji Syuku — the brand and the Road (§3.1 Brush voice). Belt and station names are read from
# src/content/types.ts below so a rename flows through a rebuild.
YUJI_WORDS = [
    '\u4e00\u672c', '\u6c17\u5408', '\u4f11',    # ippon, kiai, yasumi (rest)
    '\u706b\u708e\u6b8b\u6c37\u4f11',            # the five flame glyphs: hi honoo zan koori yasumi — kept for a brush lantern word (Phase B retired EndCard.tsx's FLAME_GLYPH table)
]
# The brand word and the Dojo home's brush words — the three session names (.dojo__session-ja,
# src/app/pages/DojoPage.tsx) and the kotodama caption (src/art/dojo/DojoScene.tsx) — are read
# from the strings files: every glyph the home screen sets in --font-brush must be in the shell,
# or the browser fetches YujiSyuku-base (372 KB) on first paint and the 250 KB budget is a paper
# number. B1 adds a key here (and in fonts.test.ts DOJO_HOME_BRUSH) when the home gains a brush word.
DOJO_BRUSH_KEYS = [('src/i18n/strings.ts', ['appNameJa', 'dojoKataJa', 'dojoKumiteJa', 'dojoShugyoJa']),
                   ('src/app/pages/strings.ts', ['dojoPhaseDawnJa', 'dojoPhaseDayJa', 'dojoPhaseDuskJa', 'dojoPhaseNightJa']),  # the sky-phase word (09 §7 A beat 900; §12.1 d22)
                   ('src/art/dojo/strings.ts', ['kotodamaJa'])]
YUJI_SHELL_MAX, SHIPPORI_SHELL_MAX, FIRST_PAINT_MAX = 60_000, 40_000, 250_000   # bytes (09 §10 budgets, decimal KB)

CJK_BLOCKS = [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)]
BASE_BLOCKS = [(0x0000, 0x00FF), (0x0100, 0x024F), (0x0370, 0x03FF), (0x2000, 0x206F), (0x2070, 0x20CF),
               (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF), (0x2500, 0x25FF),
               (0x2600, 0x27BF), (0x3000, 0x30FF), (0x31F0, 0x31FF), (0xFF00, 0xFFEF)]

def in_blocks(c, blocks):
    o = ord(c)
    return any(a <= o <= b for a, b in blocks)

def is_cjk(c):
    return in_blocks(c, CJK_BLOCKS)

def printable(c):
    """A glyph worth a code point in a slice: no controls, separators, format characters,
    surrogates, private use, unassigned, and no variation selectors (U+FE00–FE0F)."""
    return ord(c) >= 0x20 and unicodedata.category(c)[0] not in 'CZ' and not 0xFE00 <= ord(c) <= 0xFE0F

def chars_in(paths):
    s = set()
    for p in paths:
        try:
            s.update(open(p, encoding='utf-8').read())
        except Exception:
            pass
    return s

def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, '/')

def road_names():
    """Belt names (BELTS.nameJa), the 53 STATIONS (`st(N, 'name', …)`), NIHONBASHI and SANJO_OHASHI
    from src/content/types.ts — the proper names the brush face sets on the Road and the header."""
    src = open(os.path.join(ROOT, 'src', 'content', 'types.ts'), encoding='utf-8').read()
    stations = re.findall(r"^\s+st\(\d+, '([^']+)'", src, re.M)
    if len(stations) != 53:
        sys.exit(f'expected 53 st(...) stations in src/content/types.ts, found {len(stations)}')
    named = re.findall(r"nameJa: '([^']+)'", src)       # BELTS (8), NIHONBASHI, SANJO_OHASHI
    if len(named) < 10:
        sys.exit(f'expected the 8 belt names + 2 endpoints as nameJa literals in types.ts, found {len(named)}')
    return stations + named

def dojo_home_brush():
    """The brand word and the Dojo home's brush words, read from the strings files (DOJO_BRUSH_KEYS)
    so a reworded session name flows through a rebuild; a missing key stops the build."""
    out = []
    for path, keys in DOJO_BRUSH_KEYS:
        src = open(os.path.join(ROOT, path), encoding='utf-8').read()
        for key in keys:
            m = re.search(rf"^\s*{key}: '([^']+)'", src, re.M)
            if not m:
                sys.exit(f'{path}: no `{key}` string literal — update DOJO_BRUSH_KEYS (and fonts.test.ts DOJO_HOME_BRUSH)')
            out.append(m.group(1))
    return out

KOYOMI = os.path.join(ROOT, 'public', 'calendar', 'koyomi.json')
def koyomi_names():
    """The sekki and moon names the column renders, from A3's data file — the source of truth the
    SEKKI / MOON lists document; [] when it has not landed, so this build never waits on A3."""
    if not os.path.exists(KOYOMI):
        return []
    d = json.load(open(KOYOMI, encoding='utf-8'))
    return list((d.get('sekki') or {}).values()) + list((d.get('moon') or {}).values())

ui_all = sorted({p for pat in UI_SOURCES for p in glob.glob(os.path.join(ROOT, pat), recursive=True)})
ui_files = [p for p in ui_all if not any(x in rel(p) for x in UI_EXCLUDE)]
src_nontest = [p for p in ui_all if '.test.' not in rel(p)]
content_files = glob.glob(f'{ROOT}/public/content/**/*.json', recursive=True)

ui_chars = chars_in(ui_files)
used = chars_in(src_nontest) | chars_in(content_files) | EXTRA_UI
inventory = {c for c in ui_chars if printable(c) and (is_cjk(c) or not in_blocks(c, BASE_BLOCKS))} | EXTRA_UI

levels = {'n5': set(), 'n4': set(), 'n3': set(), 'n2': set()}
for p in glob.glob(f'{ROOT}/public/content/kanji/*/*.json'):
    lvl = p.split('/')[-2]
    d = json.load(open(p, encoding='utf-8'))
    for it in d.get('items', []):
        ch = it.get('char')
        if ch and lvl in levels:
            levels[lvl].add(ch)
# the UI inventory beats every level; a kanji listed at two levels belongs to the lower (earlier) one
seen = set(inventory)
for lvl in ['n5', 'n4', 'n3', 'n2']:
    levels[lvl] -= seen
    seen |= levels[lvl]
rest = {c for c in used if is_cjk(c)} - seen

base = {c for c in used if not is_cjk(c) and printable(c)}
base |= {chr(o) for o in range(0x20, 0x7F)}
base |= {chr(o) for o in range(0x3000, 0x3040)}      # CJK symbols & punctuation (incl. 々〆〇)
base |= {chr(o) for o in range(0x3041, 0x3097)}      # hiragana
base |= {chr(o) for o in range(0x3099, 0x30A0)}      # voicing marks, ゝゞ
base |= {chr(o) for o in range(0x30A0, 0x3100)}      # katakana
base |= {chr(o) for o in range(0x31F0, 0x3200)}      # small katakana
base |= {chr(o) for o in range(0xFF01, 0xFF5F)}      # full-width ASCII
base |= {chr(o) for o in range(0xFF61, 0xFFA0)}      # half-width kana
base |= set('★☆♪♫♡♥○●◎◯△▲▽▼□■◆◇✓✔✕✗→←↑↓↔⇒⇔…‥〜～ー・「」『』【】（）！？：；，．、。¥€£°±×÷≈≠≤≥∞√∑∂∈∪∩⌈⌉─│┌┐└┘├┤┬┴┼█▓▒░▀▄▌▐')
base |= inventory

# the shell slices: explicit code points, a subset of what the family can render; the base
# inventory is NOT a precondition (the moon names and omikuji heads are data, like the sekki)
yuji_shell = {c for c in ''.join(road_names() + dojo_home_brush() + YUJI_WORDS) if printable(c)}
shippori_hand = {c for c in ''.join(SEKKI + COLUMN + MOON + OMIKUJI) if printable(c)}
shippori_shell = shippori_hand | {c for c in ''.join(koyomi_names()) if printable(c)}
if shippori_shell - shippori_hand:   # the data respelled a name: the shell follows it; the hand lists and the fonts.test.ts mirror should too
    print('NOTE public/calendar/koyomi.json adds glyphs beyond SEKKI / MOON:', ''.join(sorted(shippori_shell - shippori_hand)),
          '— update the lists here and in src/styles/fonts.test.ts')
SHELL_FAMILIES = {'YujiSyuku': yuji_shell, 'ShipporiMinchoB1': shippori_shell}
SHELL_MAX = {'YujiSyuku': YUJI_SHELL_MAX, 'ShipporiMinchoB1': SHIPPORI_SHELL_MAX}

def ranges(chars):
    cps = sorted(ord(c) for c in chars)
    out = []
    for cp in cps:
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out

def fmt(rs):
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in sorted(rs))

# base's range = the block ranges + an explicit code point for everything else in the slice
# (the UI inventory above all), so every glyph the slice carries is reachable.
base_blocks = [list(b) for b in BASE_BLOCKS] + ranges({c for c in base if not in_blocks(c, BASE_BLOCKS)})

SLICES = {  # name -> (chars, css ranges or None for explicit code points)
    'rest': (rest, CJK_BLOCKS), 'n2': (levels['n2'], None), 'n3': (levels['n3'], None),
    'n4': (levels['n4'], None), 'n5': (levels['n5'], None), 'base': (base, base_blocks),
}

def slices_for(stem):
    """Declaration order: rest first (lowest precedence), then the levels, base, then shell
    (SHELL_FAMILIES only) last so its explicit code points win over base's."""
    return [n for n in SLICE_NAMES
            if not (n == 'rest' and stem in NO_REST_FAMILIES) and not (n == 'shell' and stem not in SHELL_FAMILIES)]

def slice_def(stem, name):
    return (SHELL_FAMILIES[stem], None) if name == 'shell' else SLICES[name]

inv_cjk = sum(1 for c in inventory if is_cjk(c))
print(f'UI inventory: {len(inventory)} glyphs ({inv_cjk} CJK ideographs + {len(inventory) - inv_cjk} other) '
      f'from {len(ui_files)} files + {len(EXTRA_UI)} EXTRA_UI; excluded: {", ".join(UI_EXCLUDE)}')
for name in SLICE_NAMES[:-1]:
    chars, blocks = SLICES[name]
    rs = ranges(chars)
    print(f'slice {name:5s} glyphs={len(chars):5d} explicit-ranges={len(rs):5d} css-chars={len(fmt(blocks or rs))}')
for stem, chars in SHELL_FAMILIES.items():
    cjk_n = sum(1 for c in chars if is_cjk(c))
    print(f'slice shell {stem:17s} glyphs={len(chars):4d} ({cjk_n} CJK + {len(chars) - cjk_n} kana/other) explicit-ranges={len(ranges(chars))}')
for stem, family, _, _ in FAMILIES:
    note = '  (no rest: NO_REST_FAMILIES)' if stem in NO_REST_FAMILIES else ''
    print(f'family {family:20s} faces: {" ".join(slices_for(stem))}{note}')
if PLAN:
    sys.exit(0)

PYFT = os.environ.get('PYFTSUBSET') or shutil.which('pyftsubset') or os.path.join(os.path.dirname(sys.executable), 'pyftsubset')
if not os.path.exists(PYFT):
    sys.exit('pyftsubset not found: pip install fonttools brotli (and run this with that venv\'s python)')
try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit('fontTools not importable: run this script with the venv python that has fonttools + brotli')

def cmap_of(path):
    f = TTFont(path)
    cm = set((f.getBestCmap() or {}).keys())
    f.close()
    return cm

os.makedirs(OUT, exist_ok=True)
n_faces = sum(len(slices_for(stem)) for stem, _, _, _ in FAMILIES)
css = ['/*',
       ' * TSUZUKU — self-hosted webfonts (SIL Open Font License 1.1; see public/fonts/OFL-*.txt).',
       ' * GENERATED by scripts/fonts/build-fonts.py — do not hand-edit; rerun the script instead.',
       ' * Unicode-range slices per family, declared in precedence order (later rules win for an',
       ' * overlapping range, CSS Fonts 4 §4.5): `rest` first with the whole CJK block (every other',
       ' * corpus ideograph), then n2 / n3 / n4 / n5 (the kanji of each JLPT level as explicit code',
       ' * points, so a learner only downloads the levels they have reached), then `base`: ASCII,',
       f' * kana, symbols, punctuation + the UI glyph inventory — the {inv_cjk} ideographs the shell',
       ' * itself renders (strings files, station names, belt / page / reward names, and the sekki',
       ' * glyphs the calendar renders from data), listed explicitly so the header, the Road and the',
       ' * Library never pull a level slice. Yuji Syuku and Shippori Mincho B1 end with a `shell`',
       ' * face (design 09 §3.5), declared after `base` so its explicit code points win: the brand,',
       ' * belt and station names for the brush; the sekki, ordinal, era-date, moon and omikuji',
       ' * glyphs for the mincho — the Dojo\'s first paint fetches DotGothic16-base + the two shells',
       ' * and leaves both `base` faces for later (first-paint budget 250 KB, src/styles/fonts.test.ts).',
       ' * The brush family (Yuji Syuku) ships no `rest` face: it draws shell chrome and proper',
       ' * names, never corpus text, and its catch-all slice weighed 815 KB; a non-corpus kanji in',
       f' * --font-brush falls back to the system mincho. {n_faces} faces in all.',
       ' * Every face lists local() first and uses font-display: swap; the page works without them.',
       ' */']
sizes = {}
failed = False
for stem, family, d, locals_ in FAMILIES:
    ttf = os.path.join(SRC, d, f'{stem}-Regular.ttf')
    shutil.copyfile(os.path.join(SRC, d, 'OFL.txt'), os.path.join(OUT, f'OFL-{stem}.txt'))
    ttf_cmap = cmap_of(ttf)
    for name in slices_for(stem):
        chars, blocks = slice_def(stem, name)
        out = os.path.join(OUT, f'{stem}-{name}.woff2')
        uni = ','.join(f'{ord(c):04X}' for c in sorted(chars))
        cmd = [PYFT, ttf, f'--unicodes={uni}', '--flavor=woff2', '--layout-features=kern,palt,pwid,vert,vrt2,liga,ccmp,locl,calt',
               '--no-hinting', '--desubroutinize', "--name-IDs=*", '--notdef-outline', f'--output-file={out}']
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print('FAILED', stem, name, r.stderr[-800:]); sys.exit(1)
        sizes[f'{stem}-{name}'] = os.path.getsize(out)
        # read the slice back: every requested glyph the TTF has must be in the woff2 cmap
        want = {ord(c) for c in chars}
        lacks = sorted(want - ttf_cmap)
        lost = sorted((want & ttf_cmap) - cmap_of(out))
        verdict = f'verified {len(want) - len(lacks) - len(lost)}/{len(want)}'
        if lacks:
            verdict += f'  font lacks {len(lacks)}: ' + ''.join(chr(o) for o in lacks[:40]) + (' …' if len(lacks) > 40 else '')
        if lost:
            verdict += f'  LOST {len(lost)}: ' + ''.join(chr(o) for o in lost[:40]); failed = True
        print(f'built {stem}-{name:5s} {os.path.getsize(out) / 1000:7.1f} KB  {verdict}')
        rs = fmt(blocks or ranges(chars))
        loc = ', '.join(f'local("{l}")' for l in locals_)
        css += ['@font-face {', f'  font-family: "{family}";', '  font-style: normal;', '  font-weight: 400;',
                '  font-display: swap;', f'  src: {loc}, url("/fonts/{stem}-{name}.woff2") format("woff2");',
                f'  unicode-range: {rs};', '}']
    for name in SLICE_NAMES:                       # prune slices this run did not build (e.g. a dropped rest)
        stale = os.path.join(OUT, f'{stem}-{name}.woff2')
        if name not in slices_for(stem) and os.path.exists(stale):
            os.remove(stale); print(f'removed stale {rel(stale)}')
if failed:
    sys.exit('a slice lost glyphs its source font has — see LOST above')
open(CSS_OUT, 'w', encoding='utf-8').write('\n'.join(css) + '\n')
total = 0
for k, v in sizes.items():
    print(f'{k:28s} {v/1000:8.1f} KB'); total += v
print(f'TOTAL {total/1e6:.2f} MB  css {os.path.getsize(CSS_OUT)/1000:.1f} KB  faces {n_faces}')
for stem, cap in SHELL_MAX.items():
    v = sizes[f'{stem}-shell']
    print(f'BUDGET {stem}-shell {v/1000:.1f} KB <= {cap/1000:.0f} KB  {"ok" if v <= cap else "OVER — do not ship (09 §10 / lead decision 9)"}')
fp = sizes['DotGothic16-base'] + sizes['YujiSyuku-shell'] + sizes['ShipporiMinchoB1-shell']
print(f'BUDGET first paint (DotGothic16-base + YujiSyuku-shell + ShipporiMinchoB1-shell) {fp/1000:.1f} KB <= {FIRST_PAINT_MAX/1000:.0f} KB  {"ok" if fp <= FIRST_PAINT_MAX else "OVER"}')
