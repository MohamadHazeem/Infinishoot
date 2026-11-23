# Gate 8 · Boss Maker

## What players get

Open **Extras → Boss Maker** to choreograph King Bopper, Rampage Rex or the Queen. Pick an arena, edit three phases, and test the fight immediately. Each phase loops one to four attacks in order. Each attack has three timing choices. A win or defeat returns to the workshop. Keyboard, pad and touch use the existing menu navigator and prompts. The share field supports paste and manual copying when clipboard access is unavailable. The workshop and route card have English and Arabic copy.

Save up to 12 designs on the device. Share a versioned `ISB1.` code directly or publish to the optional community board. The board supports 1–5 star ratings, re-rating and pages of 30 designs. An ordinary run offers **Weekly Boss** as its last road choice into stages 2, 6, 10 and so on, when there is a design to offer. The other roads remain available. Choosing it uses the normal co-op vote, stage waves, earned loadout, boss rewards and portal.

## Encounter rules

- Bodies supply the model, phase gates at 66% and 33%, intro and rewards. The host schedules the chosen attacks in simulation time. Projectiles, strikes, wall stingers, summons, damage and warning effects use the existing game systems. The inert body has zero contact damage and moves only for its authored charge. Each hero can take at most one hit per charge.
- Minimum warnings in seconds are ring 0.95, fan 1.00, ground strike 1.10, charge 1.15, summon 1.25 and wall 1.35. The other timing choices add 0.35 or 0.70 seconds. Normal recovery is 1.15, 1.55 or 1.95 seconds. Enrage shortens recovery by a divisor capped at 1.4. Charge locks its heading before the warning, travels at 18 m/s for up to 0.48 seconds and stops at solid terrain.
- A ring has ten projectiles and a fan has five. Summons use the marked location, check for nearby heroes again at release and cap active swarmers at three. Walls leave a central 4.6 m exclusion band for stinger centres, aligned with the target's position when warned. The host checks the gap and its path to the target against terrain before scheduling a wall.
- Base boss HP is 430 for the isolated starter test and 1,750 on the route. The director applies its ordinary stage, loop and party multipliers and the run's difficulty. Direct move damage uses the lower of `12 × enemy damage multiplier` and `16 + 2 × min(stage, 8)`. Designers cannot set HP, damage, rewards, difficulty or heat.
- Arenas use the three existing editor samples or saved editor geometry. The code strips custom names and gameplay rules, bounds the embedded layout, runs the editor's collision/reachability checks, and requires all hero markers to be at least 8 m from the boss marker. The marker must fit the largest body (Rex, 2.1 m radius) beside solid cover and inside the arena edge. Codes encode one character per move/timing pair and have a version, exact grammar, CRC and 2,300-character ceiling.
- An early earned-build test died on Lava Pit's floor before the Queen spawned. Boss Maker now filters persistent lava and thorns from both preset and imported fight layouts. Walls, props, pads, terrain shape, biome and markers remain available. The original Arena Editor saves keep their pieces.
- Reliable host messages distribute the offer and selection, including on `hello`. A sparse snapshot repairs the active design. A late reliable selection also rebuilds the arena if the first stage snapshot already loaded stock geometry. Both peers use the same arena/marker hooks. Each run starts with its existing stats. Workshop fights use the arena editor's separate practice lifecycle.

## Community and storage

`GET /bosses?page=N`, `POST /bosses`, `POST /bosses/rate` and `GET /bosses/weekly` use the existing Worker, D1 `TELEMETRY` and KV `SCORES`. A completed UTC Monday–Sunday week contributes the three highest averages, with ballot count, publication time and design ID breaking ties. Map selection rotates through those winners by week and loop. With no server, no winners or a failed fetch, only locally saved designs qualify. An empty local library leaves the ordinary route intact.

Designs are deduplicated by content digest. Each installation has a random local ballot token. D1 keeps a hash scoped to one design and week, and a new rating updates that ballot. Per-action KV cooldowns last 60 seconds, with hour-scoped hashes of the connecting address. These are anonymous best-effort limits. The Worker revalidates codes with the game's decoder. Local keys are `bossMaker.v1` and `bossBallot.v1` under the existing storage prefix. The lead's normal deployment must apply migration `0002_boss_maker.sql`.

## Files

- The lane owns `src/game/bossMaker.ts`, `src/game/bossMakerCode.ts`, `src/ui/bossMakerUi.ts`, `src/i18n/bossMaker.ts`, `server/leaderboard/bosses.js`, `server/leaderboard/migrations/0002_boss_maker.sql`, `tests/g8bossmaker.test.ts` and this note.
- In the shared files, `src/game/game.ts` installs the conductor and UI, ticks the active fight, and mirrors the sparse snapshot. `src/ui/screens.ts` registers the screen name. `src/dev/testLinks.ts` dispatches its preview. `src/i18n/arabic2.ts` and `src/i18n/ar.ts` include the two catalogs. `server/leaderboard/routes.js` registers the route module.

## Visual verification

Use `?test&bossmaker` for the workshop, `?test&bossmaker=fight` for a starter fight and `?test&bossmaker=route` for the selection card. Append `&lang=ar` for Arabic. Baseline and updated production screenshots used seed 42, a six-second wait and the same meadow (`stage=1&day`), night (`stage=2&night`) and original boss (`stage=1&bossnow&nointro`) queries. The shell screenshot launch hit the macOS Chromium bootstrap restriction. Managed headless Playwright produced the PNGs. The pairs were visually inspected.

| Scene | EN 1280×720 | AR 1280×720 | EN 1920×1080 | AR 1920×1080 |
| --- | --- | --- | --- | --- |
| meadow | [before](../../shots/g8-bossmaker-before-meadow-en-720.png) / [after](../../shots/g8-bossmaker-after-meadow-en-720.png) | [before](../../shots/g8-bossmaker-before-meadow-ar-720.png) / [after](../../shots/g8-bossmaker-after-meadow-ar-720.png) | [before](../../shots/g8-bossmaker-before-meadow-en-1080.png) / [after](../../shots/g8-bossmaker-after-meadow-en-1080.png) | [before](../../shots/g8-bossmaker-before-meadow-ar-1080.png) / [after](../../shots/g8-bossmaker-after-meadow-ar-1080.png) |
| night | [before](../../shots/g8-bossmaker-before-night-en-720.png) / [after](../../shots/g8-bossmaker-after-night-en-720.png) | [before](../../shots/g8-bossmaker-before-night-ar-720.png) / [after](../../shots/g8-bossmaker-after-night-ar-720.png) | [before](../../shots/g8-bossmaker-before-night-en-1080.png) / [after](../../shots/g8-bossmaker-after-night-en-1080.png) | [before](../../shots/g8-bossmaker-before-night-ar-1080.png) / [after](../../shots/g8-bossmaker-after-night-ar-1080.png) |
| boss | [before](../../shots/g8-bossmaker-before-boss-en-720.png) / [after](../../shots/g8-bossmaker-after-boss-en-720.png) | [before](../../shots/g8-bossmaker-before-boss-ar-720.png) / [after](../../shots/g8-bossmaker-after-boss-ar-720.png) | [before](../../shots/g8-bossmaker-before-boss-en-1080.png) / [after](../../shots/g8-bossmaker-after-boss-en-1080.png) | [before](../../shots/g8-bossmaker-before-boss-ar-1080.png) / [after](../../shots/g8-bossmaker-after-boss-ar-1080.png) |

- editor · [720p EN](../../shots/g8-bossmaker-after-editor-en-720.png) · [720p AR](../../shots/g8-bossmaker-after-editor-ar-720.png) · [1080p EN](../../shots/g8-bossmaker-after-editor-en-1080.png) · [1080p AR](../../shots/g8-bossmaker-after-editor-ar-1080.png)
- weekly · [720p EN](../../shots/g8-bossmaker-after-weekly-en-720.png) · [720p AR](../../shots/g8-bossmaker-after-weekly-ar-720.png) · [1080p EN](../../shots/g8-bossmaker-after-weekly-en-1080.png) · [1080p AR](../../shots/g8-bossmaker-after-weekly-ar-1080.png)
- testfight · [720p EN](../../shots/g8-bossmaker-after-testfight-en-720.png) · [720p AR](../../shots/g8-bossmaker-after-testfight-ar-720.png) · [1080p EN](../../shots/g8-bossmaker-after-testfight-en-1080.png) · [1080p AR](../../shots/g8-bossmaker-after-testfight-ar-1080.png)
- 844×390 workshop · [390p EN](../../shots/g8-bossmaker-after-editor-en-390.png) · [390p AR](../../shots/g8-bossmaker-after-editor-ar-390.png). On the short viewport, the scroll cue leads to the remaining controls.

## Mortal skilled bot

`npm run skillbot -- --runs 5` ran seeds 1–5 on Normal before and after. Both runs cleared stages 1–4 at **100 / 100 / 100 / 80%**. Four of five cleared a loop. Seed 4 died to a slug. Mean run time was **1,014.8 seconds** both times. This small cohort starts above the Gate 2 target of 40–60%. The earlier rhythm lane measured 65% over 40 seeds. Boss Maker introduces no tuning change to ordinary runs.

`G8_BOSS_PILOT=1 npm test -- g8bossmaker` used the mortal `window.skillRun` with five generated designs covering all six attacks. All five won inside the Normal stage-one target of 45 seconds.

| Design seed | Body | Stage-one test kill |
| --- | --- | --- |
| 0 | King | 37.48 s |
| 1 | Rex | 32.65 s |
| 2 | Queen | 28.48 s |
| 3 | King | 28.13 s |
| 4 | Rex | 32.10 s |

The separate `G8_WEEKLY_PILOT=1…5 npm test -- g8bossmaker` fixture earns a Normal seed-14 loadout and votes for the weekly road. Across development and the Lava Pit correction, the five stage-two kill times were 30.10, 10.76, 8.97, 29.89 and 11.08 seconds. The stage-two budget is 55 seconds. The first browser cross-check still had the earlier arena code cached in its Vite development server and reproduced the lava death. After restarting the server and verifying the served source, the mortal browser pilot cleared all five naturally earned weekly fights on the final build in **10.85, 9.61, 7.98, 12.37 and 9.63 seconds**. [Browser cohort results](../../shots/g8-bossmaker-coop/weekly-pilot-final.json)

## Network and release checks

- TypeScript and the production Vite build passed. Focused Boss Maker, Worker routing/deploy-kit and i18n checks passed, including 6,163 matching catalog entries. SQLite-backed tests exercise validation, bounded submissions, deduplication, cooldowns, ballot edits, ranking, pagination and the UTC week boundary. A browser UI test published, voted, reopened and saved a design against a local fixture.
- `npm test` passed all 153 files on the complete rerun. The runner repeated `worldGame.test.ts` in isolation. The first full run had a random secret-room placement failure. Its stand-alone check passed, as did the complete rerun. The late-message regression and the focused Worker and localization tests passed on the final source.
- `npm run smoke` passed, including invincible runs, mortal game-over/history and runtime-error checks. The Worker also bundled locally into 453,095 bytes (171,836 bytes gzipped). The live D1 migration and publication are reserved for the lead.
- Managed Chromium exercised keyboard Arrow/Enter/Escape navigation, a standard-mapped gamepad's D-pad/A button, and touch taps on an 844×390 screen. Each reached its intended tab or control.
- The direct shell launcher for `npm run coop -- --offline` could not start Chromium because macOS denied its Mach bootstrap registration. The stock offline scenario and assertions ran through managed headless Chromium, including a disconnect, recovery, team objectives and party restart. It passed with 1,898 snapshots, 1,762 bytes on average, 14,551 bytes maximum and zero over 16 KiB. A separate two-peer test voted for the weekly route, matched all 29 Windy Keep colliders and its 24 m half-size on both peers, and observed the Rex and the host's warning zones on the guest.
- `npm run balance` hit the same shell Chromium error. In managed Chromium, the four-kit invincible replay produced identical results on this lane and the original source at `27939c3`. Every kit reached stage three. The four saved tolerances missed on both builds were Buster stage-two kills (9,700 vs 15,414), Laser stage-one ranks (8 vs 12), and Rail stage-one/stage-two kills (4,103 vs 5,677 and 10,622 vs 15,298).
- The QA hero stands beside King Bopper in these charge captures. [EN 720p](../../shots/g8-bossmaker-after-charge-en-720.png), [AR 720p](../../shots/g8-bossmaker-after-charge-ar-720.png), [EN 1080p](../../shots/g8-bossmaker-after-charge-en-1080.png), [AR 1080p](../../shots/g8-bossmaker-after-charge-ar-1080.png).

## Performance

The direct `npm run bench:real -- --check` launcher hit the same macOS Chromium permission error before and after. Managed headless Chromium used the repository's scene driver and budget checker on hardware Metal, with 2 s warm-up and 5 s of measurement per row.

| 1280×720 High | FPS | Frame p95 | CPU p95 |
| --- | ---: | ---: | ---: |
| Original heavy scene, before implementation | 60.00 | 16.8 ms | 5.9 ms |
| Same heavy scene, first full lane matrix | 59.80 | 16.7 ms | 7.8 ms |
| Original heavy scene, matched comparison | 59.60 | 16.7 ms | 10.6 ms |
| Lane heavy scene, matched comparison | 59.80 | 16.7 ms | 9.8 ms |
| Authored King in the workshop, median 206 enemies and 501 projectiles | 59.60 | 16.7 ms | 3.2 ms |

The first matrix missed 26 of 62 render cases on the shared machine. All four load checks passed. After rerunning the failed rows, 51 of 62 render cases passed. Ten 4× CPU-throttled cases still missed budget, as did the unthrottled 1080p WebGPU 1,000-light stress case (44 FPS, 50 ms frame p95). All unthrottled WebGL2 scenes passed on the merged report. The budget command returns failure on that report. [First matrix](../../shots/g8-bossmaker-coop/matrix.json) · [retry matrix](../../shots/g8-bossmaker-coop/matrix-retry.json)

A quieter final recheck of the remaining rows passed **57/62 render cases and all four loads**. Every unthrottled WebGL2 and WebGPU case passed, including WebGPU lights at 59.6 FPS and 16.7 ms frame p95. All five remaining failures use 4× CPU throttling. At 720p, double, four heroes and night missed simulation p95 (14.0, 16.9 and 13.3 ms against 12 ms). At 1080p, double and four heroes missed it (13.9 and 16.2 ms). Four heroes also missed the 34.5 ms frame p95 limit at both sizes (50.0 and 49.9 ms). The performance gate remains open. [Final gate report](../../shots/g8-bossmaker-coop/matrix-final.json)

In back-to-back 1080p Low, 4× CPU comparisons, the original and lane builds both missed budget. Frame p95 before/after was 66.7/150.1 ms on heavy, 66.6/116.6 ms on double and 166.6/133.3 ms on four heroes. These loaded samples do not establish a performance improvement. [Matched original and lane measurements](../../shots/g8-bossmaker-coop/matched.json)
