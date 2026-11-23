# Gate 8 · Echo runs and Clockwork Crossing

## What players get

- In standard or endless play, the host's most recently finished eligible run returns as a cyan mirror miniboss at 12 seconds into stage 2 of each four-stage loop. A fresh profile has no rival yet. Each participant earns 6 spendable gold on a kill. Leaving for the title also finishes a recording. There is no permanent bonus.
- The mirror wears the recorded hero model and cycles the old primary, secondary, acquired weapons and special. Its attacks use their recorded ranks, resolved build parameters and stat multipliers. Weapon families become hostile shots, fans, beams, ground strikes or radial pulses. Damage is capped at 16, fans at five shots. The mirror has zero contact damage and stands still for a 0.95-second directional or ground warning. Dash timing, preferred distance and side of the kite come from the previous pilot.
- Clockwork Crossing can replace the survival encounter on stages 5, 9, 13 and so on, with a 25% seeded chance per eligible island. This keeps the first-loop Normal calibration intact. The team must avoid damage for 60 seconds. A death rewinds immediately on attempts 1–4. A surviving but hit team rewinds at the bell. A flawless clear pays 18 bonus run gold to each remaining player plus the usual stage reward. On attempt five, surviving clears the stage and a lethal hit follows normal down/revive rules.
- Each clock attempt spawns the same 21 seeded pulse lattices and fixed-bearing projectile fans. There is a 1.2-second warning. Dash and parry work. The regular director, special, ultimate and manual rewind sit out this dodge challenge. HP, position, stamina and ability resources reset to entry values. The last failed pilot's cyan path and amber failure marks carry across retries. The EN/AR intro can be dismissed independently by click, Enter or gamepad confirm.

## Storage and co-op

`infinishoot.echo.runs.v1` uses the core normalized JSON store, keeps three recordings and stores no names, account IDs or raw input. Each recording has a maximum of 128 relative-motion samples at 4 Hz. The store records the hero, rank, resolved weapons, build paths, passives, mods and relics. The previous opponent is pinned in new replay headers. Race, PvP, training, trials, custom arenas and save-locked runs are excluded.

The authority owns damage, resets and rewards. Clients receive the encounter state and existing effects-bus cues. During an encounter, a full snapshot on entry, retry and every 120 simulation steps also carries the opponent or quantized party tracks. Following host migration, an unwitnessed pending impact is discarded and the new authority schedules the next full warning. A guest's predicted position is corrected on rewind.

## Changed files

New game code lives in `src/game/echo.ts`, `src/game/timeloop.ts` and `src/data/echoTape.ts`. The new UI and bilingual copy live in `src/ui/echoHud.ts` and `src/i18n/g8echo.ts`. `tests/g8echo.test.ts` covers persistence, the normal run-to-run path, once-only rewards, team deaths, deterministic retry hazards, guest poses, migration, Arabic HUD and dismissal, flawless clears and fifth-attempt exits.

Shared edits are additive. `src/game/game.ts` installs the encounter controller, calls it on run start, authoritative simulation, kill, input, and snapshot send/receive. `src/dev/testLinks.ts` adds two encounter previews. `src/i18n/en.ts` and `src/i18n/ar.ts` each import and spread the new catalog. No server changes. `.lane-brief.md` already had local changes when this lane started.

## Gate 2 skilled pilot

Fresh-profile Normal Rookie, no pet, seeds 1–5, 2,100 simulated seconds maximum. Both builds used the Gate 2 skilled pilot in jsdom and identical seeds. The stage-clear percentages were **100 / 100 / 100 / 60 before and after**. Seeds 2, 3 and 4 cleared the loop. Seeds 1 and 5 died to lava. Mean run time was 974.4 seconds both times. This five-run sample meets the 40–60% target at its upper bound.

I also tested the return-player path across the same five full loops. All began with a fresh character and a copy of the previous seed-1 Rookie’s real level-41 recording (buster 14, charge 12, discs 6, swarm 5, storm drones 1, crosswind 5, bomb 1). **All five defeated the natural mirror and cleared stages 1–3. Seeds 2 and 3 cleared the full loop, 2/5 (40%)**, with mean run time 977.1 seconds. Only the mirror tape was loaded into the new profile. The fresh-profile and return-player cohorts both fall within the Gate 2 target.

For encounter-specific trials the same non-invincible `window.skillRun` pilot recorded 36 seconds, restarted with its starter kit and entered the named encounter. Clock selection was forced when needed. Results are per seed, independent of the first-loop cohort.

| Normal seed | Mirror defeated after | Clock attempts | Clock outcome |
| --- | ---: | ---: | --- |
| 1 | 66 s | 1 | Flawless |
| 2 | 39 s | 2 | Flawless |
| 3 | 104 s | 5 | Ordinary clear |
| 4 | 12 s | 3 | Flawless |
| 5 | 73 s | 1 | Flawless |

Mirror wins **5/5**. Clock clears **5/5**, including **4/5 flawless**. Seed 3 was rerun with a 330-second ceiling and exited at the same 305th pilot call. These rates describe five deterministic bot seeds.

## Reproduction and visual pairs

- Use `?test&stage=2&echoboss&seed=42` to preview the equipped loadout and a short sample kite. For the natural recording, finish or quit an eligible run after at least two seconds of movement sampling, then reach stage 2 in the next run.
- Use `?test&stage=5&timeisland&seed=42` to enter Clockwork Crossing. Dash through a warning, or take a lethal hit to see the recorded route and danger marker. Add `&lang=ar` for Arabic.
- The comparison captures use `?test&ci2&bench&circle&god&season=off&seed=42` plus the table switches and `&lang=en` or `&lang=ar`. Production previews ran six seconds of fixed game updates before capture. Files are in the ignored `shots/` directory of this worktree.

| Scene | Before / after filename pair, for each resolution and language | Before switches | Added after |
| --- | --- | --- | --- |
| Meadow | `g8-echo-before-meadow-{1280,1920}-{en,ar}.png` / `g8-echo-after-meadow-{1280,1920}-{en,ar}.png` | `&stage=1` | `&echoboss` |
| Night | `g8-echo-before-night-{1280,1920}-{en,ar}.png` / `g8-echo-after-night-{1280,1920}-{en,ar}.png` | `&stage=2&night` | `&timeisland` |
| Boss | `g8-echo-before-boss-{1280,1920}-{en,ar}.png` / `g8-echo-after-boss-{1280,1920}-{en,ar}.png` | `&stage=2&bossnow&nointro` | `&echoboss` |

I inspected all 12 before/after pairs at 1280×720 and 1920×1080. The compact encounter panel sits below the central combat clock, leaving the boss's lower-screen CLOSE CALL notice visible. Additional 1280×720 captures in both languages cover the skippable panels, pulse fan and second-attempt ghost in `shots/g8-echo-detail-{mirror-intro,clock-intro,clock-rewind}-{en,ar}.png`.

## Performance

Measurements use the repository's five-second samples and two-second warm-up in fresh managed headless Chromium contexts, on the Apple M5 Pro Metal renderer. The baseline is unmodified revision `7a3b1ed`. The 1280×720 native LOW horde held **60.0 FPS before and after**. Before, callback CPU p50/p95/p99 was **3.1 / 4.7 / 5.8 ms**, frame intervals **16.7 / 16.8 / 16.8 ms**, with median 286 enemies and 520 projectiles. After, callback CPU was **3.0 / 4.6 / 6.8 ms**, intervals **16.7 / 16.8 / 16.8 ms**, with median 280 enemies and 501 projectiles.

The **hard performance gate failed**. All 48 unthrottled WebGL2 matrix cases, both resolutions in the throttled boss and Titan scenes, WebGL2 light stress and all four load checks passed. Eight ×4 CPU-throttled rows and WebGPU light stress missed at least one budget after reruns. The encounter HUD skips DOM work while inactive. The final pass below remeasured the affected rows and native LOW horde after that optimization. The first upstream control missed seven of these nine rows on the shared machine. I repeated the two remaining comparisons back-to-back in opposite build orders. Both builds then missed the 12 ms simulation budget in both cases. The 720p heavy control/final p95 was 13.9/13.6 ms. The 1080p double control/final p95 was 14.4/14.8 ms. All nine affected configurations have therefore also failed on the upstream control. The table retains the original control measurements.

| Scene | Control / final simulation p95 at 1280×720, ms | Control / final simulation p95 at 1920×1080, ms |
| --- | ---: | ---: |
| LOW ×4 heavy | 10.8 / 14.9 | 12.9 / 14.3 |
| LOW ×4 double | 14.3 / 15.1 | 11.8 / 18.2 |
| LOW ×4 four heroes | 15.3 / 20.3 | 18.6 / 19.0 |
| LOW ×4 night | 13.3 / 15.4 | 12.6 / 13.8 |

The throttled simulation limit is 12 ms. The four-hero cases reached 27.3 and 28.5 FPS against their 30 FPS minimum. WebGPU lights reached 59.6 FPS, with main callback CPU p95 of 10.1 ms against 10 ms and a submission-time miss. The control also missed submission time. In a separate 720p ×4 four-hero profiling pass, the encounter simulation hook itself used 0.10 ms p95 and 0.50 ms p99 across 413 calls. The complete simulation used 17.6 ms p95. The checks use the repository’s original quality settings, tolerances and population targets. To inspect the report on this machine, run `npm run bench:real -- --check --from-report /private/tmp/g8-echo-perf-final.json`.

The active encounters were also sampled in the 1280×720 LOW stress fixture. The mirror held **60.0 FPS**, p95 frame interval **16.8 ms**, p95 callback CPU **5.6 ms**, with median 291 enemies and 502 projectiles. Its HP was raised only in this timing fixture so the test weapons could not kill it before sampling ended. The clock held **60.0 FPS**, p95 interval **16.7 ms**, callback CPU **2.1 ms**, with 236 enemies and 500 projectiles forced by the fixture.

## Verification and outstanding gates

- `npm run typecheck` and `npx vite build` passed. Vite reports the existing large-chunk warning.
- `npm test` passed all 149 test files. The runner retried host migration and the sound-hearing scenario successfully on the final run. `npm run smoke` passed the full whole-game test, including local co-op and the mortal game-over path.
- `npm run skillbot -- --runs 5 --difficulty normal --seed 1 --jsdom` passed, with the results above. Temporary measurements and screenshots stay outside tracked source.
- The command-line browser launcher used by `npm run coop -- --offline`, `npm run shot`, `npm run balance` and `npm run bench:real -- --check` aborts with Chromium SIGABRT under this sandbox. The browser runs reported here used managed headless Chromium against local Vite servers.
- The offline co-op harness passed end to end in 94.5 seconds, including a disconnect, rejoin, restart vote and kick. It delivered 1,879 measured snapshots (1,616 bytes average, 15,139 maximum). A separate two-browser test received the host Tinker's mirror and kit over WebRTC. After a teammate triggered a rewind, the client displayed attempt two, the Ronin ghost and a clock checkpoint with both players' tracks.
- The invincible `botRun(s, true)` cleared two stages with all four balance kits. Three kits passed every golden tolerance. The laser/well/meteor kit had 8 stage-one ranks against 12 expected. An independent run on unchanged `7a3b1ed` produced exactly the same ranks, levels, kills and times for that kit. The checked-in balance assertion still fails.
- The full Metal performance assertion remains red as detailed above. Visual inspection and co-op checks ran locally and headlessly. No worker, deployment, save-format or permanent-power change is needed.
