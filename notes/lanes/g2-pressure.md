# Gate 2 pressure director and boss enrage

## What players get

The host measures how effectively the team clears the field. A team clearing arrivals quickly with life to spare draws a larger horde, more shooters, earlier elite and swarm waves, and more champions. A hurt or downed teammate takes away the extra pressure. Normal and harder difficulties keep the stage's unmodified density and refill rate as their floor. Assist keeps its six-second near-death breather down to 78%.

The stage boss's life bar counts down to enrage from its entrance. At the target the boss announces enrage, gains 10% of base damage and speeds up. Every further 20 combat seconds adds another 10 percentage points and queues an extra selection from its own attack rotation. The bar shows the damage bonus and time until the next step in each player's language.

## Decisions and tuning

- Nine five-second buckets cover 45 simulation seconds. The first full window in each stage enables the wave mix. The score starts with the ratio of kills to successful spawns, capped at 1 and discounted below one team kill per second. It multiplies that ratio by a weighted sum of 0.35 base, up to 0.25 for low team-average damage per minute, 0.18 for time at full life, 0.10 for time standing still while clearing, and 0.12 for beating elites quickly. The elite term ranges from full at zero seconds to zero at 30 seconds and uses half credit when there is no observation. Elite time includes the spawn animation and requires a recorded arrival.
- A score of 0.65 starts the surplus and 0.95 requests the full mix. The weakest present hero gates the surplus from 35% to 75% life. The field's occupancy limits it further when enemies are piling up. The share of the full mix is capped at 40% in stage 1, 60% in stage 2 and 100% thereafter. Mix can rise by 0.05 per second and fall by 1/6 per second. Density rises by at most 0.018 per second. In the first two stages, the measured mix alone sets Normal+ crowd size and refill speed. From stage 3 a team above the score threshold can also regain the original 18% crowd bonus if the weakest hero is healthy, damage taken is low and kills per player stay high. Refill still follows the measured mix alone. Applying the full crowd and refill bonuses together in the opening stages put two-stage god-bot XP and rank progression outside the existing balance tolerances.
- At full intensity the alive target and refill rate reach 1.27×, elite scheduling reaches 1.26×, ring scheduling reaches 1.18×, and the relative roll weight of eligible shooters reaches 1.40×. Stage-3+ champions go from 12% to at most 24% per eligible elite. The existing 450 ordinary-enemy target, type ceilings, specialty reserves, boss HP and stage timer still apply. Eight-player overflow HP uses the underlying stage count so surplus density cannot turn into extra enemy life.
- Each wave's next interval is chosen when its predecessor arrives. Accelerated rings and elites get a three-second heads-up on the effects bus as well as the native spawn tells. A combined warning covers coincident deadlines. The director reserves the last 20 seconds of the first two stages and the last eight seconds of later stages when scheduling an extra elite. The same wave emits one cue even if an Assist breather defers its arrival. Regular enemy refill requests are reused by definition.
- Boss targets for stage slots 1–4 are 45 / 55 / 65 / 85 seconds and repeat each loop. Assist adds 90 seconds. Entrance and phase roars hold the clock. Speed rises by 8 percentage points per step up to 40%. The selector waits through windups, attacks and recovery, then resumes the previous regular deadline. Titan moves use the Titan's cooldown, and the Architect waits for its active hazards to clear. Each step has at most one bonus pending, so a long attack cannot bank a burst.
- The host applies damage and attack timing in simulation. Boss-owned ground strikes get the bonus at launch and regular mortars keep their own damage. Rewind reconciles the clock with restored director time. Boss clock primitives travel in the existing host-migration checkpoint. The new host rebuilds its local performance window while pacing smoothly adjusts. Clients read two integers from the existing boss snapshot and receive transient cues through VFX. Mid-stage mini-bosses retain their HP-phase behavior, and the Hydra raid keeps its dedicated encounter clock.
- The consent-gated run summary records the latest survival-window score as an integer percentage in `stages[].ranks["director:power"][0]`. The existing schema accepts that namespaced numeric field. The Adaptive pacing panel under Debug → Director exposes the live score, mix and boss timing.

## Files and integration

Lane code is in `src/game/director.ts`, `src/game/systems/director2.ts`, `src/game/systems/spawning.ts`, `src/game/bossRules.ts`, `src/game/systems/bossFight.ts` and `tests/g2pressure.test.ts`.

Shared changes, including the paused commit, are the two guarded boss-update calls in `src/game/game.ts`, one stage-summary assignment in `src/game/systems/telemetry.ts`, the optional boss timer and its HUD element in `src/ui/hud.ts`, its local styles in `src/style.css`, and matching wave and timer entries in `src/i18n/en.ts` and `src/i18n/ar.ts`.

## Test links

- `?test&stage=2&bossnow&nointro&god&seed=42` shows the full pre-enrage countdown.
- `?test&stage=2&enrage&nointro&god&seed=42` starts one combat second before enrage. `enrage=active` starts at the threshold for screenshots. Add `&lang=ar` for Arabic.
- `?test&stage=3&god&weapons=drones:6,aura:5&seed=42` exercises the ordinary director. Debug shows the observations while playing. `&adaptive=off` selects the underlying baseline for comparison.

The boss timer, damage step and next escalation fit below the HP bar in all four inspected headless captures. Arabic uses a larger type size and both languages use an opaque background. [English 720p](../../shots/g2-pressure-enrage-en-720.png), [Arabic 720p](../../shots/g2-pressure-enrage-ar-720.png), [English 1080p](../../shots/g2-pressure-enrage-en-1080.png), [Arabic 1080p](../../shots/g2-pressure-enrage-ar-1080.png)

## God-bot comparison

The comparison uses the pre-lane source at `6751d85` and this worktree with the same three seeds (42, 912 and 4242). Each run starts a solo Normal Rookie with the default kit and no pet. The invincible bot calls `botRun(1, true)` until loop clear. Alive counts sample the field once per simulation second during survival. Elite counts include scripted arrivals. Boss times use the bot's spawn-to-kill clock, which includes phase transitions. To repeat a seed after `npm test`, run `G2_PRESSURE_BOT=42 node node_modules/.tests/g2pressure.test.mjs` with the chosen seed.

| Stage | Mean alive, before → after | Mean elite arrivals, before → after | Median main-boss time, before → after |
| --- | ---: | ---: | ---: |
| 1 | 125.5 → 109.1 | 4.0 → 5.0 | 17 s → 14 s |
| 2 | 190.4 → 166.8 | 5.7 → 5.7 | 23 s → 16 s |
| 3 | 211.1 → 216.7 | 5.0 → 5.0 | 45 s → 78 s |
| 4 | 222.2 → 238.8 | 4.0 → 5.0 | 16 s → 37 s |

All three seeds cleared all four stages in each build. Early crowds were smaller than under the previous healthy-team cruising bonus. Late-stage crowds grew on average. All three final runs drew five elites in both stages 3 and 4, and the Hive Queen exceeded her 65-second target on seeds 42 and 4242. The Golden King also appeared in two final runs. The table counts only the four named stage bosses for kill times. Different drops and build choices affect those times, so they describe the whole-run change. First-time human clear rates still need a merged Gate 2 playtest.

## Verification

- `npm run typecheck`, `npx vite build` and `npm run smoke` passed. Smoke exercised the mortal run through its recorded death as well as the invincible bot, local co-op and alternate modes.
- `npm test` passed all 129 test files on the final full retry. Under heavier machine load the preceding run failed the Tinker minion-hit assertion and the host-migration harness reached its 300 ms PeerJS reconnect deadline. The Tinker passed its isolated retry and both passed in the full retry with `RAYON_NUM_THREADS=2` for bundling. Test assertions and networking clocks were unchanged.
- All four `npm run balance` kits cleared two stages within the existing 25% tolerance. Stage-2 cumulative kills were 10,667 (Buster), 13,585 (Laser), 12,234 (Scatter) and 13,541 (Rail).
- `npm run coop -- --offline` passed with two headless peers, simulated latency/loss and reconnect. All three loaded stages agreed on objective props. The host sent 1,877 snapshots averaging 1,513 B, peaking at 11,844 B. A unit test exercises the binary snapshot's actual enrage step and countdown, including Arabic display on a late client.
- The production heavy scene ran for 20 seconds in headless Chromium on Metal at High, with a 1280×720 viewport and 360p internal rendering. It averaged 270 enemies and 507 projectiles, with a 16.67 ms p95 frame interval and a 2.93 ms p95 frame-callback CPU time. The director and remaining simulation work averaged 0.036 ms per step.
- Local Chromium startup was restricted in this sandbox. The screenshot, co-op, balance and benchmark scripts connected to an isolated headless Chromium launched through Playwright MCP. The repository scripts and their assertions ran as written.
