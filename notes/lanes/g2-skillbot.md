# Gate 2 skilled-bot baseline

The mortal Rookie cleared the first loop on 19/20 Easy seeds, 12/20 Normal seeds and 13/20 Hard seeds. Hard met the requested pre-Gate-2 range of 50–80% with the default reaction and aim settings. These runs measure the game at `6751d85`, before the other Gate 2 lanes change the difficulty.

| Difficulty | Stage 1 clear | Stage 2 clear | Stage 3 clear | Stage 4 / loop clear | Median stage reached | Mean game seconds | Deaths by source |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Easy | 100% | 100% | 100% | 95% (19/20) | 4 | 1,027.6 | `lava` ×1 |
| Normal | 100% | 80% | 80% | 60% (12/20) | 4 | 909.7 | `golden_king_shockwave` ×3, `the_ring_of_fire` ×3, `golden_king` ×1, `lava` ×1 |
| Hard | 95% | 95% | 95% | 65% (13/20) | 4 | 964.4 | `golden_king` ×3, `slug` ×2, `lava` ×1, `spinner` ×1 |

Each percentage uses all 20 starts. All 60 runs ended in death or an Omega kill and stage clear. Mean time uses the run's game clock. Normal is the difficulty ID displayed as Medium in this build. One win moves a cohort by five percentage points.

## Reproducing the measurement

```sh
npm run skillbot -- --runs 20 --difficulty all --seed 1 --jsdom
```

The CLI defaults to jsdom, Normal, 20 runs and seed 1. It runs each seed in a fresh process, sets the season off, and uses the starter Buster, Charge Shot and Bomb with no pet. The game, input, drops, damage and automatic rescues run at a fixed 60 Hz. Simulated timers drive deferred events. The measurement ends at death, the first loop clear, or the 2,100-second simulation cap. Capped samples are identified separately in the summary.

The JSON includes the seed, tuning, level and loadout, per-stage damage, up to five accepted hits with source and HP after the hit, boss fight durations and kill status, actual dash starts, and parry windows opened. Projectile attribution follows the shot UID across pool swaps. A shot already airborne when a browser measurement starts can have the fallback source `enemy_fire`.

All three difficulties used seeds 1–20. During review four last-hit histories contained an unidentified projectile. Replaying those seeds with copied-shot attribution identified Mirror Bot variants on Hard 6, Normal 10 and 20, and Easy 12. Every replay matched the original gameplay fields, including hit timing, damage, kills and run time. The report retains the original timing measurements. The partial November 22 checkpoint is superseded. [Full November 23 report](../perf/skillbot-2026-11-23.json)

## How the pilot plays

- Samples combat at 10 Hz. Each command waits 180 ms, rounded up to 11 simulation steps. Aim varies by up to 4° on a deterministic curve independent of the game's random stream. Override `reactionMs`, `aimErrorDeg` or `decisionHz` in `window.skillRun(seconds, opts)`. Defaults are exported as `skillTuning`.
- Kites visible crowds, aims at visible bosses and elites, and routes around walls. It steps across lunge, charge and sniper lines, leaves fuse, slam and strike zones, and checks the relative trajectory of approaching bullets. It uses movement, dash and parry according to the warning and available cooldowns. Rex's charge uses the same 24 m/s, 0.5 s line as its brain and ground telegraph.
- Releases the charged secondary at full charge, spends the special or ultimate when pressed or fighting a boss, and detours for nearby hearts and magnets. Level-up and shop choices score owned weapon tags and evolution partners. Low life raises the priority of defense, healing and rest roads. Route decisions use the same map view that masks undiscovered roads for players.
- The dev console advances an active solo run synchronously. Adjacent calls retain the reaction queue, hit history and fight records. A fresh run or intervening live step starts a fresh measurement. The caller's god-mode setting and virtual controls are restored when the slice ends.

## Files and verification

- Lane files are `src/dev/skillBot.ts`, `scripts/skillbot.mjs`, `tests/skillbot.test.ts`, these notes and the generated JSON. The WIP's shared edits are one import and one registration in `src/dev/bot.ts`, and one `skillbot` script line in `package.json`. The shared gameplay, network and UI files have no lane edits.
- `npm run typecheck`, `npx vite build`, `npm test` (129 files), `npm run smoke` and the 60-run calibration passed. The skillbot tests cover an idle hero taking a scripted charge while the pilot sidesteps it, Rex's charge line, a reflected incoming shot and a harmless outgoing one, build choices, lethal and blocked hits, projectile provenance, sliced reactions, and the stage-four win condition.
- Open `?ci2&test&seed=14&stage=2&bossnow&nointro&season=off&lang=en` in the dev build and change `lang` to `ar` for Arabic. In headless Playwright, `window.skillRun(6)` produced 90 HP, one dash and eight parry attempts against Rex in all four captures. Inspected `shots/g2-skillbot-rex-{en,ar}-{1280,1920}.png` at 1280×720 and 1920×1080.
- The literal `npm run balance` command stopped before gameplay when macOS denied its headless Chromium launch. Running the same four kit scenarios, seed, clock and 25% baseline checks through the available headless Playwright browser passed for both stages of every kit. Co-op simulation and the existing autoplay behavior have no lane changes.
