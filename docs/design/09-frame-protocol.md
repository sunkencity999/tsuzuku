# TSUZUKU — 09 · Frame protocol (manual)

**Status:** protocol defined, **no run recorded yet** (2026-10-18). Companion to design 09 §10 (budgets, "Frame budget" row), §6.4 (the wipe; footnote ⁴'s brush-edged `mask-image` experiment ships only if it passes this protocol), §6.7 (performance rules) and §12.1 decision 10 (DevTools 4× CPU throttle is the stand-in for a mid-range Android; no device; A2 and C2 run it before Phase C closes). Nothing in the repo measures frames — `src/styles/motion.test.ts` guards *what* animates, not how fast it paints — so this file is the measurement, by hand, and the only place results are recorded besides each PR's checklist line.

The pass line is the spec's, uncalibrated against a real device (§12 question 10): **during a transition, no main-thread frame over 18 ms and no long task over 50 ms.** A run that fails is recorded as a fail with the numbers; the table below never carries a number nobody measured.

## 1. Setup checklist

- [ ] **Browser.** Chrome stable (same-document View Transitions ship from Chrome 111; the `::view-transition-*` rules in `motion.css` are attached selectors, §12.1 decision 12). Note the exact version in the results row. The protocol measures Chrome only (the DevTools *Frames* lane and the 4× throttle are Chrome's); an engine without `document.startViewTransition` — Safari < 18, Firefox < 144, §6.4's fallback condition, feature-detected by `viewTransitionApi()` in `src/app/transitions.ts`, never by engine name — takes the `fallbackEnter()` nijimi path and is out of scope. Current Safari and Firefox run the View Transitions and could be measured with their own tools; nothing here records them.
- [ ] **Build.** The production build served locally (`npm run build && npm run preview`, or the GitHub Pages deploy of the commit under test) — never the Vite dev server, whose unbundled modules and HMR client change the main-thread profile. Record the commit hash.
- [ ] **Fonts and shell warm.** Load the app once, wait for the service worker to install (DevTools → Application → Service workers shows *activated*), then reload. The first-paint fonts (`DotGothic16-base`, `YujiSyuku-shell`, `ShipporiMinchoB1-shell`) and `calendar/koyomi.json` must come from the cache so the trace measures paint, not network.
- [ ] **Save.** A learner with something to draw: ≥ 30 days trained, a lit or gold flame, two or more forgiveness chips, a few stamps and badges, at least one station reached. (A fresh save renders an emptier Dojo and a shorter Road and would pass too easily.) Export it first (Settings → Backup) so the run is repeatable.
- [ ] **Settings.** Reduced motion **off** in the app (Settings) and at the OS (the protocol measures the full motion; a second, optional pass with reduced motion on is a control and must be labelled as such). Theme: run the ten turns once in Dojo Morning and once in Arcade Night; glows exist only in Night (§1 rule 2), so Night is the heavier pass.
- [ ] **Viewport.** DevTools device toolbar, *Responsive*, **390 × 844**, device pixel ratio 3, mobile UA on, no touch emulation needed. Do not pick a named phone preset: presets change the UA client hints and, on some, the DPR.
- [ ] **CPU.** Performance panel → capture settings (the gear) → **CPU: 4× slowdown**. Network: *No throttling* (everything is cached; a network throttle would hold the chunk loads, which happen *before* a turn starts — §6.4 starts the View Transition at module resolve — and are not part of the measurement).
- [ ] **Panel options.** Screenshots on (to see the wipe), *Web Vitals* lane off, *Enable advanced paint instrumentation* **off** (it inflates main-thread time), memory off.
- [ ] **Quiet tab.** Close other tabs, pause extensions (or use a guest profile), plug the laptop in, and let the page idle ten seconds after the reload before recording.

## 2. The ten route turns

Each row is one page turn under a View Transition. Perform them in order in **one** recording per theme, pausing about two seconds between turns so the traces separate. `data-travel` is what `src/app/transitions.ts travelOf()` writes on `<html>` for the pair; the hero is the shared element named for it (§6.4 table).

| # | From → to | How | `data-travel` | Hero |
|---|---|---|---|---|
| 1 | dojo → road | bottom nav *Road* | `forward` | — |
| 2 | road → station | tap the current station's row on the Tōkaidō | `forward` | `station-seal` (the row's seal → `.station-head .sign`) |
| 3 | station → road | back (browser back or nav *Road*) | `back` | — |
| 4 | road → library | nav *Library* | `forward` | — |
| 5 | library → records | nav *Records* | `forward` | — |
| 6 | records → dojo | nav *Dojo* | `home` | — |
| 7 | dojo → train | the one hanko on the Dojo — the recommended session, which on §1's ≥ 30-day save may be Kumite or Shugyō rather than Kata (§8); any session tile is the same `in` turn | `in` | — (main dims to `--stage-bg`, chrome kasure / slides out) |
| 8 | train → dojo | finish the session so the End Card shows, then **Rest.** (the `tsuzuku-mark` hero exists only from the End Card; *Leave* mid-session is a plain `out` with no hero) | `out` | `tsuzuku-mark` (`.end-card__brush` → `.dojo-scene__hotspot--hearth`) |
| 9 | dojo → settings | nav *Settings* | `forward` | — |
| 10 | settings → dojo | nav *Dojo* | `home` | — |

§10's list names ten stops (dojo → road → station → road → library → records → dojo → train → dojo → settings), which are nine turns; #10 closes the loop so ten turns are measured and the recording ends where it began. The session in #7–#8 is short: take whatever the hanko offers (or Kata from its tile) and answer honestly; its length does not matter, only the two turns around it.

## 3. The two extra moments

- [ ] **Dusk — the theme wipe (moment G, §7 G).** On Settings, switch the theme between light and dark (or set *Follow the sky* and wait for the 17:00 boundary in `profile.tz`, which is the same code path: `transitionTheme()` in `src/app/theme.ts` wraps the change in a View Transition with `html[data-vt="theme"]`, the fixed chrome names suspended, the whole page revealed top-down by `meku-down` over `--dur-3`). Record one light → dark and one dark → light.
- [ ] **The Dojo arrival (moment A, §7 A).** With the save loaded and the shell cached, start recording, reload at `#/`, and let it settle: the boot ensō draws (`--dur-4`), `store.ready` flips with the Dojo chunk prefetched, and `App` runs the arrival View Transition carrying `enso` from `.app-loading__mark` onto `.dojo-scene__art`; the phase word, the tategaki column and the since-yesterday pulse follow (B1). Measure from the first frame of the ensō to the end of the last entrance. A cold reload (service worker cleared) is a different measurement and is not this protocol.

## 4. Recording and reading the trace

1. Open DevTools → **Performance**. Confirm the gear shows *CPU 4× slowdown*, *Network: No throttling*.
2. Press **Record** (⌘E / Ctrl+E), wait one second, perform the turns of §2 with two-second pauses, then **Stop**. Save the trace (right-click the timeline → *Save profile…*) as `trace-<phase>-<theme>-<commit>.json` outside the repo; traces are not committed.
3. For each turn, select the window from the input event (the *Interactions* lane shows the tap / click) to the end of the last animation frame after it — about `--dur-3` 400 ms plus settle; `in` and `out` turns are 300–400 ms, the dusk wipe 400 ms, the arrival up to about 2.5 s.
4. **Frames.** In the *Frames* lane, hover each frame inside the window: read its duration. Partially presented frames are hatched, dropped frames red. **Any frame over 18 ms fails the turn.** Record the longest frame per turn.
5. **Long tasks.** On the *Main* track, a task longer than 50 ms carries a red hatched corner. **Any long task inside a turn's window fails the turn.** Record its duration and its bottom-up top entry (Summary → *Bottom-Up*): layout, paint, style recalc or script, and which function.
6. **Paint cost.** Open *Layers* or tick *Enable advanced paint instrumentation* only for a diagnosis pass, never for the recorded run.
7. Repeat the whole set in the other theme. Record the worst of both.

What usually fails, and where the spec already names the owner: a frame that recalculates style for the whole page (the sekki tint *steps*, §7 H; a `color` transition on a background over 160 px breaks §6.7 rule 1); a `filter` or `box-shadow` that animates (§1 rule 2); more than two live SVG filters in the viewport (§6.7 rule 2); `backdrop-filter` on the header during a transition (`Layout.css` rests it under `html:active-view-transition`); `restoreScroll()` before paint (§6.7 rule 6).

## 5. Results

One row per phase. "Not yet run" is the honest value until someone records a trace; a row with numbers names the person, the day, the commit and the Chrome version, and a fail stays a fail with its numbers.

| Phase | Run on | Commit | Chrome | Theme(s) | Longest frame in a turn | Long tasks (≥ 50 ms) in a turn | Dusk wipe | Arrival | Result |
|---|---|---|---|---|---|---|---|---|---|
| A (shell transitions, A2) | — | `20e6822` | — | — | not yet run | not yet run | not yet run | not yet run | **not yet run** |
| B (Dojo arrival, End Card, shell follow-ups) | — | — | — | — | not yet run | not yet run | not yet run | not yet run | **not yet run** |
| C (Road, Station, surfaces; C2 runs it) | — | — | — | — | not yet run | not yet run | not yet run | not yet run | not yet run |
| D (ceremonies) | — | — | — | — | not yet run | not yet run | not yet run | not yet run | not yet run |

A PR that touches a page turn, a hero or a shell entrance adds one line to its checklist: *Frame protocol: run / not run; longest frame N ms; long tasks N* — and, when run, fills the row above in the same change.
