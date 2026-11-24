# Gate 4 patrols and hunters

The Field Commander, two Wall Guards, a Squad Marksman and a Trap Runner share a target. Closing on the crown forces it back and moves the shield line. Killing the commander breaks the formation immediately. A separate Dusk Hunter circles at the edge of the fight before committing to a marked landing. All five enemies have distinct silhouettes, overhead pixel icons, sound cues, and discoverable English and Arabic Codex entries.

## Encounter rules

- In Standard and Endless, from stage 2, the second and fifth scheduled rings can become patrols. At a director power score of at least 0.65, the full five appear if every participating hero has at least 50% health on ring two or 35% on ring five. When either condition is missed, the patrol contains only the commander and two guards. All three have zero contact damage and no projectile, trap or landing attack. Killing the crown still routes both guards and earns its drops.
- On stage 1, a team with a wounded member can meet the smaller formation on the fifth ring. On stage 3 and later, the smaller formation opens the first ring while the director gathers its power readings. A living commander prevents overlapping patrols. Each formation replaces the entire ring. Ordinary reinforcements, including veterans, pause for four seconds on a full patrol or eight seconds on the three-enemy formation. Scheduled specials and elites keep their timing. Placement tries three sites 15–19 m out. Every member must fit inside the arena, clear walls, and stay at least 4 m from every living hero. Failed placement leaves the usual ring available.
- From stage 3, on the third ring, one ordinary slot can become a hunter 17–21 m out. It is eligible on one in three seeded stages and needs a director score of at least 0.8 and all participants at or above half health. A downed teammate, recovery breather, boss arrival or duel, the elites-only rule, and competitive modes suppress all natural tactical spawns.
- The host chooses the nearest living participant to each commander at 10 Hz. Each patrol keeps separate guard slots and cached waypoints. Losing the commander cancels a pending shot and rally, then the survivors flee for 3 seconds and leave without awarding a kill or loot. Already-fired shots and planted traps finish their visible paths.
- The crown carries 24 base XP and drops one shared chest to pay for the displaced wave. If any living participant is wounded, it also drops one normal 30-HP heart. Famine and the no-hearts Heat rule suppress it. The commander tries to hold 9 m. Its crown and gold pulse announce a 25% movement buff to its own squad within 8 m for 2.5 seconds, every 5 seconds. The guards form a rank 2.8 m forward and 2.1 m wide. Within 65° of a shield's facing, a primary shot that hits the plate deals one chip damage. Shots through the physical gap can hit their targets at full damage. Flanking or using a secondary opens the formation.
- The marksman's crosshair, rifle sound and aim line precede a 15-base-damage shot by 1.25 seconds. The direction locks for the last 0.25 seconds. The projectile stops at the 20 m tip of the painted line, including under bullet-speed modifiers, so it cannot hit a distant teammate beyond the warning. The marksman needs a clear line to start aiming and uses existing cover movement between shots.
- The orange baiter heads for the far side of nearby hazardous terrain. Within 8 m it can plant a trap at its own feet. Its sound and fixed ground ring give 1.6 seconds to leave a 1.65 m radius before 12 base damage. Its cooldown is 6 seconds.
- The hunter stalks for 12 seconds around 16 m away. A positional wail and ripple repeat every 3 seconds. Its fangs stay inside the viewport if the body leaves the screen. The hunter can be killed while stalking. When it engages, a 1.2-second crouch and 0.75-second airborne phase telegraph an 18-base-damage landing within 1.9 m. All patrol roles and the hunter have zero contact damage.
- The normal binary snapshots carry the appearance, facing, aim lock, rally, stalking phase and landing target. Positional audio and ground rings travel through the effects bus. On host migration the new host rebuilds membership from surviving actors and their positions. The migration format omits per-enemy AI timers, so a hunter can give the new host's party a fresh stalking interval. Rewind retains legacy leader and slot fields.

## Skilled-bot calibration

The mortal Rookie used the default Gate 2 pilot, Normal difficulty, seeds 1–50, 180 ms reactions and 4° aim error. Initial tuning used seeds 1–10. Seeds 11–20 extended that tuning sample. Seeds 21–30 were reserved for a separate comparison after the two-ring rule was set. The subsequent three-member formation addresses a problem exposed on seeds 1–20. The final stage-one health threshold stayed fixed for a separate, previously unused twenty-seed check at seeds 31–50. Each seed ran in a fresh process with the season off. Damage is accepted HP damage summed across every stage each run reached. An earlier death also shortens the time available to take damage.

```sh
npm run skillbot -- --runs 30 --difficulty normal --seed 1 --jsdom
npm run skillbot -- --runs 20 --difficulty normal --seed 31 --jsdom
```

| Normal seeds | Original clears | Patrol build clears | Original mean damage | Patrol build mean damage |
| --- | ---: | ---: | ---: | ---: |
| 1–20 | 6/20 (30.0%) | 8/20 (40.0%) | 692.61 HP | 655.26 HP |
| 21–30 | 0/10 (0.0%) | 2/10 (20.0%) | 679.04 HP | 650.58 HP |
| 1–30 | 6/30 (20.0%) | 10/30 (33.3%) | 688.09 HP | 653.70 HP |
| 31–50 | 4/20 (20.0%) | 8/20 (40.0%) | 661.51 HP | 782.24 HP |
| 1–50 | 10/50 (20.0%) | 18/50 (36.0%) | 677.46 HP | 705.12 HP |

The standard 20-run cohort and the previously unused 20-run cohort each reached the 40% lower bound. Pooling every seed gives 36%, two clears short of the 40–60% target. The combined-lane build still needs calibration against the full sample.

Across the 50 starts, stages 1 through 4 were cleared by 43, 33, 31, 10 runs on the original build and 42, 36, 33, 18 on the patrol build. Mean run duration went from 779.9 to 810.2 seconds. All 100 runs ended in death or a full loop clear.

The original build at `684fa1f` cleared 4/10 on seeds 1–10 with 683.60 mean damage. Embedding the patrol inside an ordinary ring cut that to 1/10. A stage-3 start with a health gate yielded 3/10. Giving the five enemies the ring to themselves at a 0.8 power threshold restored 4/10, with 733.24 mean damage.

| Encounter change | Clears on seeds 1–20 | Mean damage on seeds 1–20 |
| --- | ---: | ---: |
| Original build | 6/20 | 692.61 |
| Full ring reserved for a stage-3 patrol at power 0.8 | 6/20 | 726.26 |
| Stage-3 patrol at power 0.65 with 24 crown XP | 3/20 | — |
| Stage-2 patrol with a shared chest | 7/20 | 722.18 |
| Physical shield coverage and a heart for a wounded party | 6/20 | 700.43 |
| Second and fifth rings, four-second entrance | 5/20 | 730.04 |
| Two guards for weaker parties, first-stage introduction below half health | 7/20 | 658.48 |

The four-second entrance cleared another 5/10 on seeds 21–30 for 10/30 overall and 744.93 mean damage. Its health gate still sent the old encircling wave at wounded teams. Giving them a three-enemy formation brought that to 11/30 clears with 668.10 mean damage. The early introduction then widened to any wounded party, so it can fight for a heart before the first boss.

## Verification and test links

- `npm run typecheck`, `npx vite build`, `npm test` (140 files) and `npm run smoke` passed. Earlier full suites used the runner’s isolated retry for host migration and for a procedural secrets-room fixture. The focused squad tests also passed with a ring larger than the remaining director capacity.
- In two headless browser contexts connected over real WebRTC with local offline signalling, the client received the exact six actors, the stalking phase, the hunter wail and the sniper warning. With the host hero wounded, killing the crown produced the shared chest and recovery heart on the client. The client then removed the four retreating followers while the hunter remained. The standard offline co-op harness also passed its stage objectives, reconnection and party lifecycle checks. On the passing run, 1,931 snapshots averaged 1,913 bytes and peaked at 15,207 bytes. All fit below 16,000 bytes. Two earlier revisions intermittently reported mismatched stage-2 objective props on reconnect after the harness had forced a door. Both passed on retry. This revision passed on the first run.
- The invincible-bot balance suite passed all 32 original two-stage checks for four kits. The Buster finished stage two with 23 ranks against the checked-in reference of 22. The untouched worktree base produced 16 on the same browser. Stage-two kill totals in harness order were 12,527, 14,861, 13,068 and 12,418. The shell Chromium launcher for `npm run coop -- --offline`, `npm run balance` and `npm run shot` stopped at a macOS Mach-port permission error. The available managed headless browser ran the co-op and balance scenarios and captured the screenshots.
- At 1280×720, Medium graphics, the production preview delivered 601 frames in 10 seconds, 60.0 fps, median 1.8 ms and p95 2.6 ms CPU frame time, ending at 200 enemies and 578 projectiles including the patrol encounter. This measures one machine and one scene.
- Open `?test&patrol&spawn=dusk_hunter:1&spawnr=20&seed=42&god&day&dry&season=off&lang=en` for the fight. Use `patrol=guards` for the three-enemy encounter. Open `?test&metascreen=codex&codexall&season=off&lang=en` for the Codex. Use `lang=ar` for Arabic. Reviewed the full patrol, guard detail and Codex at 1280×720 and 1920×1080 after six seconds. Local captures are `shots/g4-squads-{patrol,guards,guide}-{en,ar}{720,1080}.png`.
- A staged close-range capture, `shots/g4-squads-warnings-en720.png`, shows the marksman's line crossing the hero, the baiter's ground ring, both wall shields and the hunter's fangs. The native attacks had 0.98 seconds and 1.33 seconds left before firing.
- Reproduce the stress scene with `?test&bench&patrol&spawn=dusk_hunter:1&spawnr=20&hold=70:charger,60:shielder,50:shooter&bullets=570&seed=42&god&day&dry&season=off&quality=medium`. The existing `bench` flag also opens the workbench. The measurement used fight mode with its overlay closed.
- The lane tests cover authority, target choice and reassignment, the 10 Hz cadence, rally range, shield slots and direction, aim lock, trap warnings, commander loss during a windup, pooled actor reuse, host promotion, hunter phases and snapshots, director eligibility and ring budgets, and Arabic discovery text.

## Integration note

The existing title-demo save test can fail when the demo hero dashes. A failing run added `hands-movement` and `perfectdash` to `save.tips`. A controlled dash during the save-locked demo reproduced both additions at the untouched `684fa1f` base. `teachMovement` in `src/game/systems/skill.ts` writes the first marker and queues the second. This belongs to the movement lane. The first-stage recovery encounter requires the fifth director ring and a wounded team. The title-demo test runs far earlier.

## Files

- `src/game/squads.ts`, `src/game/systems/enemyAi.ts`, `src/game/systems/spawning.ts` and `src/data/enemies.ts` implement the roles, formations, spawning, and native roster and Codex registration.
- Shared additions consist of eleven lines in `src/game/game.ts` for badges, the host enemy step, the marksman projectile limit, the director ring and the reinforcement hold, two lines in `src/dev/testLinks.ts` for the patrol fixture, and fifteen EN and fifteen AR entries in `src/i18n/en.ts` and `src/i18n/ar.ts`.
- `tests/g4squads.test.ts` exercises the lane. This note records the tuning and verification.
