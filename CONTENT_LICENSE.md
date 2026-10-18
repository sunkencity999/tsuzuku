# TSUZUKU content licence

The learning content of TSUZUKU is released under the
**Creative Commons Attribution-ShareAlike 4.0 International** licence
(CC BY-SA 4.0). The full legal text is at
<https://creativecommons.org/licenses/by-sa/4.0/legalcode>; a summary is at
<https://creativecommons.org/licenses/by-sa/4.0/>.

Copyright (c) 2026 Christopher Bradford.

## What this covers

- `public/content/**` — the kana, vocabulary, kanji, grammar, story,
  michikusa and component files, the conjugation table, the generated
  station bundles and the content manifest.
- `docs/allowlists/**` — the per-station surface allowlists derived from that
  content.
- The art the app renders from this content and from a learner's own
  progress (wallpapers, seals, stamps, the Dojo scene and their PNG exports).
  All of it is original and procedural; none of it reproduces franchise
  material.

## What this does not cover

- The application code, build scripts and generated build output are under
  the MIT License (`LICENSE` at the root of the repository).
- The four webfonts in `public/fonts/` (DotGothic16, Yuji Syuku, Shippori
  Mincho B1 and Dela Gothic One) are licensed by their designers under the
  SIL Open Font License 1.1. Each face's licence text and copyright notice is
  shipped beside it as `public/fonts/OFL-*.txt`; the OFL, not this file,
  governs the font files and their subsets.
- `wanakana` and Preact are third-party MIT-licensed libraries; their licence
  texts are in their packages.

## Attribution

When you share or adapt the content, keep this attribution line (or an
equivalent one) with it, and release your adaptation under the same licence:

> Japanese learning content from **TSUZUKU** by Christopher Bradford,
> licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).

If you only reuse part of the content, say which part, and note any changes
you made. A link back to the repository you obtained this content from is
appreciated but not required.

## Synthetic voices

The voice pack (`public/audio/**`, fetched into a build from the release
`audio-<audioVersion>` named in `public/audio-pack.json`; design 08 §6–§7) is
**not** CC BY-SA content. Every clip in it is synthetic speech rendered at
build time with VOICEVOX 0.25.2 from the text above, using the character
voices listed below, and each clip is governed by that character's own terms
of use (the VOICEVOX character licences), not by this licence. The app says so
wherever a learner meets a voice: the status chips and headers read
*synthetic voice (VOICEVOX)*, and the About page lists the credits from the
pack's manifest. No engine ships with the site; only the rendered clips do.

Credit lines, one per character the pack uses, in the form the VOICEVOX
terms require (`VOICEVOX:<character>`); `scripts/audio/cast.json` maps every
one of the 62 speaker and narrator labels of the stories and listening pieces
to one of these 22 characters (this list is kept equal to that file's
`credit` values), and `public/audio/manifest.json` carries the subset a given
pack actually uses. Only characters whose terms permit this use are cast:
青山龍星, 後鬼, もち子さん, ユーレイちゃん, No.7, Voidoll and ぞん子 are never
used (design 08 §6), and style ids are resolved from the engine at render
time, never hard-coded:

VOICEVOX:九州そら · VOICEVOX:玄野武宏 · VOICEVOX:ちび式じい · VOICEVOX:波音リツ ·
VOICEVOX:麒ヶ島宗麟 · VOICEVOX:冥鳴ひまり · VOICEVOX:四国めたん · VOICEVOX:春日部つむぎ ·
VOICEVOX:雨晴はう · VOICEVOX:琴詠ニア · VOICEVOX:東北イタコ · VOICEVOX:東北ずん子 ·
VOICEVOX:東北きりたん · VOICEVOX:満別花丸 · VOICEVOX:春歌ナナ · VOICEVOX:猫使アル ·
VOICEVOX:猫使ビィ · VOICEVOX:白上虎太郎 · VOICEVOX:剣崎雌雄 · VOICEVOX:雀松朱司 ·
VOICEVOX:中部つるぎ · VOICEVOX:黒沢冴白

If you redistribute the rendered clips, keep the credit line of every
character you redistribute and follow that character's terms; the learning
content the clips speak remains under CC BY-SA 4.0 as described above.
