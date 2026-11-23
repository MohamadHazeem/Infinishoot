# Gate 7 · Field machinery

Each machine has a gold chevron pressure switch and colored posts. Cross the arrow or shoot a lit post to trigger it while enemies are in range. Each switch has a colored warning, a positional sound and a physical change in the device. A spent switch goes dark. A hero standing on it has to step off and return before it can fire again. Each screen shows a short local tip on first approaching each kind, in their selected language.

| Machine | What happens | Warning | Rearm after active phase |
| --- | --- | ---: | ---: |
| Spike trap | Nine spikes rise from a 3.4 m square. The floor deals 38 base damage. | 0.85 s | 14 s |
| Drawbridge | The center deck drops for 2.2 s over an orange hazard channel. Ordinary enemies on the deck fall. Elites take 25% of maximum health as fixed damage. The two side rails remain traversable, and shots cross the open gap. | 1.10 s | 19 s |
| Flood gate | The sluice lifts. Four bands of water advance down the channel at 0.18 s intervals. Each pushes enemies forward and deals 9 base damage. | 0.95 s | 16 s |
| Barrel chain | Three drums ignite in order, 0.32 s apart. Each explosion reaches 2.35 m and deals 32 base damage. | 0.95 s | 21 s |
| Lure beacon | Six inward pulls at 0.32 s intervals draw a crowd from up to 5 m away. | 0.75 s | 17 s |

Spike, flood and barrel damage gains 16% of base per stage after the first. All five spare heroes, bosses, mini-bosses, Titan parts, Reapers and PvP stand-ins. Knockback resistance applies to sweeps and pulls. The fight clock advances the machines, so freezing the simulation also freezes their timers.

## Island construction

- There are 15 hand-drawn plans, three per machine. The spike rooms are Broken Cloister, Sun Court and Watch Fort. The bridges are Ribbon Viaduct, Broken Aqueduct and Lantern Crossing. The sluices are Twin Sluice, Mill Race and Spillway. The barrel yards are Powder Yard, Cargo Lock and Fuse Alley. The lure sites are Echo Ring, Signal Plaza and Chime Ruin. These are internal plan names.
- Each procedural stage tries to place one of each machine. A separate PRNG seeded from the arena selects the plan, order, quarter-turn and coordinates. The first search bands extend from 17–24 m out to 33–44 m. A bounded fallback searches the wider island. A crowded island can omit a site. The 8.4 m square footprints keep clear of existing collision geometry, island-rule patches and chambers, hazards, objectives, chests, conveyors, jump pads and their landings. A 20 m square stays open at spawn.
- Reserving the plaza restored the Ronin dash-strike, Brawler throw and co-op carry fixtures. Spreading the five landmarks out from the center left room for an ordinary kiting route and put a landmark on each approach. An experiment with passable rubble was discarded. Towers, ruins and arch posts provide real cover.
- Raid, gauntlet, boss rush, authored editor arenas, training, PvP, Versus and the title demo keep their own layouts. The lane uses the flat XZ plane. This checkout has no exported vertical-terrain height API.
- The stage owns three instanced batches for blocks, eight-sided cylinders and spike/cone silhouettes. The renderer uses the game camera’s sphere test to cull whole courtyards and uploads occupied slots when the visible set, phase or pulse changes. Batches are allocated once per stage before rendering because Three.js draws random numbers for object IDs. Moving the camera never allocates those objects. A camera with all five courtyards outside its view submits no machinery draws. A machine scans the bounded enemy pool only when delivering a pulse. The night material keeps enough self-light for the arrow, bridge and switch to be read against Neon City.

## Ownership and co-op

The host records the hero who crosses the treadle or owns the projectile that hits a lit post. Later shots during the warning cannot take credit. The existing fixed-damage and environmental-kill hooks credit that hero’s damage and Wrecking Crew count, including delayed barrel explosions. Environmental kills also advance the team score and any active environmental-kill objective. A flood or lure that pushes a foe into another hazard keeps credit for 0.8 s. Credit checks the pooled enemy's UID.

The host sends positions, rotation, plan, phase, triggering hero, pulse number, remaining ticks and treadle occupancy with the arena seed. A new recipient gets the complete state, including a bridge already down. Established recipients receive transitions and a refresh every 90 host steps. Clients rebuild collision and visuals from the snapshot. Machinery walls precede the removable co-op vault box so reinstalling the same vault keeps collision order identical on both peers. Rings, sounds and bursts use the effects bus. The regression test exercises encoded host snapshots and client application, repeat delivery, stale-stage rejection, vault replacement, bridge collision and kill credit when the operator is farther from the victim than a teammate.

## Files

- Owned implementation in `src/data/setPieces.ts`, `src/world/setPieces.ts` and `src/game/interactives2.ts`. Regression coverage in `tests/g7setpieces.test.ts`.
- Small shared edits in `src/game/game.ts` register the system, reset per-run counters on host and client start, step it after island rules, draw it, mirror its snapshot field, route projectile impacts on lit posts to the device, and retain recent push credit through fixed hazard damage.
- Shared `src/dev/testLinks.ts` adds `setpiece=`. Shared `src/i18n/en.ts` and `src/i18n/ar.ts` add device names and first-approach tips. The other locales use their English fallback. There are no new save fields or dependencies.

## Test links

Open `?test&seed=42&season=off&stage=1&god&setpiece=spikes`. Substitute `bridge`, `flood`, `barrels` or `lure` to stand off that device's switch. For the night bridge use `&stage=5&biome=neon&night&setpiece=bridge&lang=ar`. For the boss use `&stage=4&bossnow&nointro&setpiece=barrels`.

## Headless visual checks

Each pair compares production previews of the original revision `95ca29f` and the delivered layout. Both used seed 42, high quality, season off, a six-second fixed-step fight and the same camera target. The test driver placed the hero 1.6 m east and 3.4 m south of each site center. In the boss fixture it also positioned Omega near the site on both builds. These are staging coordinates for comparison. The normal test links above follow an actual seeded switch.

| Scene and site center | English 1280×720 | Arabic 1280×720 | English 1920×1080 | Arabic 1920×1080 |
| --- | --- | --- | --- | --- |
| Meadow spike ruin (−33, −6) | [before](../../shots/g7-setpieces-before-meadow-en-720.png) / [after](../../shots/g7-setpieces-after-meadow-en-720.png) | [before](../../shots/g7-setpieces-before-meadow-ar-720.png) / [after](../../shots/g7-setpieces-after-meadow-ar-720.png) | [before](../../shots/g7-setpieces-before-meadow-en-1080.png) / [after](../../shots/g7-setpieces-after-meadow-en-1080.png) | [before](../../shots/g7-setpieces-before-meadow-ar-1080.png) / [after](../../shots/g7-setpieces-after-meadow-ar-1080.png) |
| Neon night bridge (−33, −4) | [before](../../shots/g7-setpieces-before-night-en-720.png) / [after](../../shots/g7-setpieces-after-night-en-720.png) | [before](../../shots/g7-setpieces-before-night-ar-720.png) / [after](../../shots/g7-setpieces-after-night-ar-720.png) | [before](../../shots/g7-setpieces-before-night-en-1080.png) / [after](../../shots/g7-setpieces-after-night-en-1080.png) | [before](../../shots/g7-setpieces-before-night-ar-1080.png) / [after](../../shots/g7-setpieces-after-night-ar-1080.png) |
| Omega barrel yard (24, −24) | [before](../../shots/g7-setpieces-before-boss-en-720.png) / [after](../../shots/g7-setpieces-after-boss-en-720.png) | [before](../../shots/g7-setpieces-before-boss-ar-720.png) / [after](../../shots/g7-setpieces-after-boss-ar-720.png) | [before](../../shots/g7-setpieces-before-boss-en-1080.png) / [after](../../shots/g7-setpieces-after-boss-en-1080.png) | [before](../../shots/g7-setpieces-before-boss-ar-1080.png) / [after](../../shots/g7-setpieces-after-boss-ar-1080.png) |

All 24 PNGs were inspected. The nine orange sockets, lit arrow and stone cover are distinct in the meadow. The bridge deck and rail silhouettes remain visible at night after raising the material’s self-light. In the Omega fight its existing boss warning and attack rings take visual priority over the barrel yard. English and Arabic pressure-switch instructions fit the existing toast.

Active-phase close-ups show the raised teeth, missing deck, moving water band, spent drums and crowd ring. [Spike trap](../../shots/g7-setpieces-detail-spikes.png) · [Drawbridge](../../shots/g7-setpieces-detail-bridge.png) · [Flood gate](../../shots/g7-setpieces-detail-flood.png) · [Barrel chain](../../shots/g7-setpieces-detail-barrels.png) · [Lure beacon](../../shots/g7-setpieces-detail-lure.png)

## Skilled play

The before and after cohorts used the Gate 2 mortal Rookie on Normal, seeds 1–20, 2,100 simulated seconds per seed, no pet and season off. Each sample ran in a fresh process. The runner’s output path was redirected to the temporary directory and a read-only observer collected activation counters after `window.skillRun` returned. Its ordinary movement and projectiles operate the same switches as a player's.

| Cohort | Stage 1 / 2 / 3 / 4 clear | Loops | Mean game time |
| --- | --- | ---: | ---: |
| Control `95ca29f` | 100% / 95% / 90% / 50% | 10/20 (50%) | 946.1 s |
| Delivered | 100% / 100% / 90% / 50% | 10/20 (50%) | 966.6 s |

| Activations per run | Spike trap | Drawbridge | Flood gate | Barrel chain | Lure beacon |
| --- | ---: | ---: | ---: | ---: | ---: |
| Control | 0 | 0 | 0 | 0 | 0 |
| Delivered | 30.80 | 23.05 | 29.85 | 22.45 | 23.25 |

All five machines were used in 19/20 runs. Seed 7 used four kinds, so every run used at least four. Total activations averaged 129.4 per run, range 51–161. A barrel chain counts once per ignition, even when all three drums explode. The pressure-switch-only prototype cleared 7/20. Remote posts let a hero trigger the machine while kiting outside the room. All four invincible-bot kits also cleared both stages inside the stock 25% tolerance.

## Metal performance

The managed headless Chromium browser used the Apple M5 Pro Metal adapter and production Vite previews. The stock scene and load collectors ran 60 ordinary scenes, both thousand-light renderer cases and four cold loads. Each scene used a fresh browser context, two seconds of warm-up and five seconds of measurement at the configured viewport, preset and CPU rate. The eight throttled rows that missed timing were repeated once. After this lane’s CPU-heavy tests and bot cohort exited, each of those eight rows was also measured side by side with the original build, alternating which revision went first. The table and final budget use these paired measurements.

All 48 ordinary native scenes ran at 59.8–60.0 fps with frame interval p95 at or below 16.8 ms. The 1080p HIGH double scene had a median of 328 enemies and 1005 projectiles. All four load cases passed.

| Scene | FPS before → after | Frame interval p95, ms | Simulation p95, ms | Callback CPU p95, ms |
| --- | ---: | ---: | ---: | ---: |
| heavy 1080p HIGH ×1 | 60.0 → 60.0 | 16.8 → 16.7 | 2.0 → 2.1 | 4.3 → 4.9 |
| double 1080p HIGH ×1 | 60.0 → 60.0 | 16.8 → 16.7 | 2.3 → 2.6 | 4.8 → 5.3 |
| team 1080p HIGH ×1 | 60.0 → 60.0 | 16.8 → 16.8 | 2.1 → 2.5 | 4.9 → 6.3 |
| night 1080p HIGH ×1 | 60.0 → 60.0 | 16.7 → 16.8 | 2.1 → 2.2 | 4.4 → 5.1 |
| heavy 720p LOW ×4 | 47.0 → 46.4 | 33.4 → 33.4 | 11.5 → 12.2 | 20.3 → 20.3 |
| double 720p LOW ×4 | 46.4 → 43.2 | 33.4 → 33.4 | 11.1 → 14.3 | 19.7 → 23.7 |
| team 720p LOW ×4 | 34.1 → 32.4 | 33.4 → 50.0 | 15.7 → 16.0 | 28.4 → 26.6 |
| night 720p LOW ×4 | 38.9 → 41.6 | 33.4 → 33.4 | 12.8 → 12.5 | 23.0 → 23.1 |
| heavy 1080p LOW ×4 | 44.1 → 45.4 | 33.4 → 33.4 | 10.9 → 11.5 | 19.8 → 20.8 |
| double 1080p LOW ×4 | 39.8 → 45.8 | 33.4 → 33.4 | 13.7 → 11.6 | 22.8 → 19.0 |
| team 1080p LOW ×4 | 30.1 → 29.2 | 50.0 → 50.1 | 17.9 → 19.2 | 30.6 → 32.2 |
| night 1080p LOW ×4 | 38.9 → 39.5 | 33.4 → 33.4 | 13.1 → 12.1 | 23.6 → 23.3 |
| webgpu lights 1080p HIGH ×1 | 60.0 → 60.0 | 16.7 → 16.8 | 1.9 → 2.3 | 6.0 → 7.7 |

The HIGH native control rows were taken before development. Throttled rows use the paired control, and the WebGPU control was recorded on the original production bundle on the same machine. The first 720p LOW ×4 control already exceeded the 12 ms simulation budget in heavy, double, team and night (12.6, 12.8, 14.0 and 13.0 ms). These shared-machine samples separate repeatable budget failures from timing variation.

**The hard performance gate remains failed.** Both native thousand-light scenes met budget at 60.0 fps after courtyard culling. In the final paired comparison the delivered build failed six LOW ×4 rows and the original failed five. Both revisions missed team and night at both resolutions. The delivered 720p heavy and double failed where the paired control passed. The delivered 1080p double passed where the control failed. The 1080p team profile averaged 2.43 → 2.62 ms in enemy simulation, 1.55 → 1.65 ms in weapons and specials, and 0.95 → 1.01 ms in hazards and arena work. The lane therefore cannot claim the low-end gate. The original budget, population and quality thresholds were used throughout.

## Verification and remaining risk

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. Vite emitted its existing large-chunk advisory. |
| `npm test` | Passed all 146 files in the final full run. |
| `npm run smoke` | Passed the whole-game suite. |
| `npm run skillbot -- --runs 20 --seed 1 --difficulty normal` | Completed all 20 mortal runs. Results and activation frequencies are above. |
| `npm run balance` | The direct Chromium launcher was blocked. The same four kits, eight clears and 32 stock regression comparisons passed in managed headless Chromium. |
| `npm run coop -- --offline` | The direct Chromium launcher was blocked. The stock two-browser WebRTC assertions passed in managed headless Chromium across three stages and a reconnect. The host sent 1,938 snapshots averaging 2,011 bytes, maximum 15,479 bytes. An additional guest-switch probe observed five matching sites, hero 1 owning the open bridge and identical collision on both peers. |
| `npm run shot` | The direct Chromium launcher was blocked. The 24 paired PNGs and five active-phase close-ups above were saved and inspected using managed headless Chromium. |
| `npm run bench:real -- --check` | The direct Chromium launcher was blocked. The stock budget evaluated the complete managed Metal report using `--from-report`. The measured result is reported above. |

macOS denied Chromium's Mach bootstrap registration inside the shell sandbox. The browser-backed checks used the managed headless Playwright browser. Local JSON measurements are in `/tmp/g7-setpieces-metal.json`, `/tmp/g7-setpieces-before-skill.json` and `/tmp/g7-setpieces-stable-2026-11-23.json`. The PNGs are under the repository’s ignored `shots/` directory.

An earlier unit run exposed an intermittent title-demo assertion. A focused observation identified the existing `hands-movement` and `perfectdash` tips being added to in-memory save state while zero machines were installed or used. Local storage stayed identical. The final full test run passed without a retry. An extended co-op probe also saw a ping portrait miss and a forced stage objective differ in one run. The stock offline harness subsequently passed twice.
