# Gate 8 · Asymmetric co-op roles

## Playing

In an online co-op lobby, the host turns **ROLES ON** and each player cycles **YOUR ROLE**. The roster shows everyone's selection. Duplicate roles are allowed, and a crew can launch without a Pilot. A fresh mid-run seat takes Gunner. A reclaimed seat keeps its assignment. Two through eight seats fit in the protocol. Couch players can select their own role in the standard join screen using the fifth row. Choosing Gunner for everyone starts classic couch co-op. In solo Run Setup, enable at least one AI squadmate to see the roles switch. Pick the leader's role and the squad fills the available specialist seats before duplicating jobs. A full default squad is Gunner, Pilot, Scout and Commander.

| Role | Controls and effects |
| --- | --- |
| Gunner | Standard primary, secondary and special, with the usual aim controls. |
| Pilot | Primary fires the existing pellet turret at stage + 1 rank, capped at the weapon's final rank. Secondary boards the existing heavy mech for 30 s on a 75 s activation cycle. The suit moves at 72% speed, fires its heavy arsenal and stomps while walking. |
| Scout | Primary retains the normal gun. Secondary scans every 4 s. An aimed target within 24 m receives the existing 4 s Expose mark (+30% incoming damage). Cyan pips lead the party to the nearest elite within 30 m, and gold pips lead to a sealed biome chamber within 30 m. A Scout moves 18% faster and adds 0.6 to its revive-speed stat. |
| Commander | Hold primary to send a rank-three drone formation toward the cursor, or aim it with a stick. Release primary or hold secondary to recall. The swarm moves at 22 m/s with a 15 m reach. Stick aim acquires range from an enemy on the aim ray at 10 Hz. The squad AI sends the swarm while it has a firing target. |

The role panel shows the active actions and Pilot/Scout cooldown, uses the existing device prompts and follows RTL layout. AI uses the same combat implementations as local and remote players. Specials and passive arsenal upgrades continue to work. All role power is run-local. There is no save migration, permanent stat unlock, backend endpoint or deployment. PvP and weekly competition keep their fixed rules.

## Director and network

Each spawn, including a boss, uses the active crew. A living Scout or Commander with no living Pilot grants a 6% reduction in spawn health. A Pilot or all-Gunner crew gets the existing health curve. The adjustment applies on spawn and introduces no extra attacks, damage, speed or telegraphs. Ordinary solo runs keep Gate 2 tuning.

The host accepts a role pick only from the matching peer in the open co-op lobby. Combat and scan effects run on the authority. Clients reconstruct the instanced drone formation and show the host's scan through the effects bus. Classic snapshots omit the role field. Roles-on snapshots carry a 17-bit assignment word (two bits per seat plus an enable flag), one integer per Pilot/Scout for remaining cooldown, and three integers per Commander for position and orbit phase. Positions are rounded to 0.1 m, phase to 0.01 radians. One of each role costs six integers total.

## Files

- New gameplay and data modules are `src/game/asymRoles.ts` and `src/data/asymRoles.ts`. They call the existing mech, pellet and drone implementations.
- New UI and tests are `src/ui/asymRoleHud.ts` and `tests/g8roles.test.ts`.
- Shared edits are the lifecycle, input, snapshot, spawn and render hooks in `src/game/game.ts`, one squad setup callback in `src/ui/screens.ts`, the lobby row and seat labels in `src/ui/localCoopUi.ts`, the `roles` switch in `src/dev/testLinks.ts`, and 24 matching keys each in `src/i18n/en.ts` and `src/i18n/ar.ts`. The five other catalogs use existing English fallbacks.

## Visual checks

Use `?test&bench&circle&aim=1,0&squad=3&squadheroes=rookie,rookie,rookie&seed=42&season=off&god` with the scene switches below. Add `&lang=en` or `&lang=ar`. The reference preview used unchanged revision `827475b` without the role switch. The final image uses the listed role. Each image was taken in headless Chromium after six seconds. Pilot and Scout used secondary. The screenshots show the mirrored HUD against the meadow, night lighting and Omega's telegraphs.

| Scene | Extra switches | Leader |
| --- | --- | --- |
| Meadow | `&day&roles=pilot` | Pilot in the mech |
| Night | `&stage=2&night&roles=commander` | Commander |
| Boss | `&stage=4&bossnow&nointro&roles=scout` | Scout |

Screenshot pairs are under the worktree's ignored `shots/` directory.

| Before | After |
| --- | --- |
| [g8-roles-before-meadow-720-en.png](../../shots/g8-roles-before-meadow-720-en.png) | [g8-roles-after-meadow-720-en.png](../../shots/g8-roles-after-meadow-720-en.png) |
| [g8-roles-before-meadow-720-ar.png](../../shots/g8-roles-before-meadow-720-ar.png) | [g8-roles-after-meadow-720-ar.png](../../shots/g8-roles-after-meadow-720-ar.png) |
| [g8-roles-before-meadow-1080-en.png](../../shots/g8-roles-before-meadow-1080-en.png) | [g8-roles-after-meadow-1080-en.png](../../shots/g8-roles-after-meadow-1080-en.png) |
| [g8-roles-before-meadow-1080-ar.png](../../shots/g8-roles-before-meadow-1080-ar.png) | [g8-roles-after-meadow-1080-ar.png](../../shots/g8-roles-after-meadow-1080-ar.png) |
| [g8-roles-before-night-720-en.png](../../shots/g8-roles-before-night-720-en.png) | [g8-roles-after-night-720-en.png](../../shots/g8-roles-after-night-720-en.png) |
| [g8-roles-before-night-720-ar.png](../../shots/g8-roles-before-night-720-ar.png) | [g8-roles-after-night-720-ar.png](../../shots/g8-roles-after-night-720-ar.png) |
| [g8-roles-before-night-1080-en.png](../../shots/g8-roles-before-night-1080-en.png) | [g8-roles-after-night-1080-en.png](../../shots/g8-roles-after-night-1080-en.png) |
| [g8-roles-before-night-1080-ar.png](../../shots/g8-roles-before-night-1080-ar.png) | [g8-roles-after-night-1080-ar.png](../../shots/g8-roles-after-night-1080-ar.png) |
| [g8-roles-before-boss-720-en.png](../../shots/g8-roles-before-boss-720-en.png) | [g8-roles-after-boss-720-en.png](../../shots/g8-roles-after-boss-720-en.png) |
| [g8-roles-before-boss-720-ar.png](../../shots/g8-roles-before-boss-720-ar.png) | [g8-roles-after-boss-720-ar.png](../../shots/g8-roles-after-boss-720-ar.png) |
| [g8-roles-before-boss-1080-en.png](../../shots/g8-roles-before-boss-1080-en.png) | [g8-roles-after-boss-1080-en.png](../../shots/g8-roles-after-boss-1080-en.png) |
| [g8-roles-before-boss-1080-ar.png](../../shots/g8-roles-before-boss-1080-ar.png) | [g8-roles-after-boss-1080-ar.png](../../shots/g8-roles-after-boss-1080-ar.png) |

Menu test links are `?test&lobby=coop`, `?test&localcoop&lcpads=3&lcjoin`, and `?test&squad=3&screen=modes`. The online lobby captures are in `shots/g8-roles-coop/lobby-{en,ar}-{720,1080}.png`. All 24 gameplay images and the four lobby images were visually inspected. The Pilot selector was also exercised in both languages on the couch lobby and the solo setup screen. Those four inspected images are in `shots/g8-roles-coop/{couch,squad}-{en,ar}.png`. Hardware controller and physical touchscreen feel still need a hands-on pass.

## Skilled-bot results

Fresh Rookie on Normal, no pet, season off, 2,100 s game-time cap. All seats were mortal. The Gate 2 pilot uses 180 ms reaction time, 4° aim error and 10 Hz decisions. For solo, two batches of ten seeds per revision used `npm run skillbot -- --runs 10 --seed 1` and `--seed 11`. The second reference batch bundled the six pre-change integration files directly from Git HEAD. Every matched solo seed had the same outcome, cause of death and elapsed game time on both revisions.

| Cohort | Seeds | Stage 1 / 2 / 3 / 4 clear | Loop clears | Mean game seconds |
| --- | --- | --- | --- | --- |
| Solo before | 1–20 | 100 / 100 / 100 / 75% | 15/20 | 1016.1 |
| Solo after | 1–20 | 100 / 100 / 100 / 75% | 15/20 | 1016.1 |
| Four bots, roles off | 1–6 | 100 / 100 / 100 / 66.7% | 4/6 | 1040.7 |
| Four bots, roles on | 1–6 | 100 / 100 / 100 / 83.3% | 5/6 | 1037.0 |

The solo sample exceeds the Gate 2 target of 40–60% on the starting revision and on this lane. Classic squad wins were seeds 1, 2, 3 and 6. With roles, seeds 2–6 won. Seed 1 fell to Omega. These are six matched runs per condition, with no timeouts. They establish the observed outcome for this squad composition.

To reproduce the team cohort using the Gate 2 harness, set `settings.squadBots = 3` and `settings.squadHeroes = 'rookie,rookie,rookie'` before its fixed-seed run. Call `game.startSquad()`, set `game.asym.squadMode` to the condition and then call `game.startRun({seed, difficulty})`. The leader uses the normal skilled pilot and the other three seats use the normal squad AI. In the temporary measurement bundle only, allow the offline `g.squadRun` exception in the skilled bot's co-op guard. The build still rejected online, host and client sessions. The final role-on measurement asserted four heroes and assignment word 65764. The shipped bot and skillbot command were unchanged. Individual seed records are in `shots/g8-roles-measurements/{solo-before,solo-after,team-off,team-on}.json`.

## Hardware performance

Managed headless Chromium used the Apple M5 Pro's Metal adapter and local production previews. The benchmark used the stock scenario driver, 2 s warm-up, 5 s sample, four fresh load scenarios and the unmodified budget checker. The command-line Chromium launcher aborted inside the macOS sandbox. The official checker ran separately with `npm run bench:real -- --check --from-report shots/g8-roles-measurements/metal-retried.json`.

| High, native CPU | Before FPS / frame p95 / CPU p95 in ms | After FPS / frame p95 / CPU p95 in ms |
| --- | --- | --- |
| 720p stock heavy | 60.0 / 16.8 / 6.0 | 60.0 / 16.8 / 6.5 |
| 720p stock team | 60.0 / 16.8 / 7.7 | 60.0 / 16.7 / 7.8 |
| 720p real AI squad, classic → roles | 60.0 / 16.7 / 6.5 | 60.0 / 16.7 / 6.8 |
| 1080p real AI squad, classic → roles | 60.0 / 16.7 / 6.5 | 60.0 / 16.8 / 6.4 |

The four real-AI runs passed every stock team budget. The roles-on links added `&squad=3&squadheroes=rookie,rookie,rookie&roles=gunner` to the stock team benchmark. The driver checked the assignment mask before sampling. At 720p and 1080p the roles-on runs had 345 and 303 median enemies, respectively, and 498 median projectiles in both. The projectile population reached 500 in each test.

**Full performance gate failed.** The first sweep missed 30 of 62 gameplay rows. All 30 were retried. The official checker then passed 52/62 gameplay rows, including both light stress backends, and all four load rows. At 720p the 4×-throttled low heavy, double, team and night rows missed one or more timing budgets. At 1080p high/native double and boss missed timing, as did 4×-throttled low heavy, double, team and night. A shared-machine control on unchanged HEAD missed 4 of those 10 rows (720p double/team and 1080p heavy/team at 4×). The other six passed in the independent control attempt. System load varied substantially across the measurements. These results do not establish a cause for all ten misses. A follow-up on those six passing control rows also passed the final build at 720p heavy and both 1080p native cases. Three 4× runs still missed simulation p95 (720p night 14.9 ms, 1080p double 14.5 ms and 1080p night 12.8 ms, budget 12 ms). The full retest report and the control and role-specific measurements are under `shots/g8-roles-measurements/`.

## Network, balance and release checks

- The official offline co-op scenario passed using managed headless Chromium, the local signalling fixture and actual WebRTC peers. It measured 2,069 snapshots, 1,618 bytes average, 11,662 bytes maximum, zero above 16 KiB. The scenario covered co-op objectives, disconnect, rejoin, restart and kick. An additional two-browser lobby probe used 70 ms latency, 30 ms jitter and 2% loss. Pilot host and Commander guest both received word 65549, showed the correct controls, and agreed on the commanded drone center at (13.6, 0.0).
- The command-line browser launches for `npm run shot`, `npm run coop -- --offline`, `npm run balance` and `npm run bench:real -- --check` aborted under the macOS sandbox. Their browser work used a managed headless Chromium instance against local Vite servers.
- All four kits in the invincible `botRun(s, true)` balance harness cleared two stages. Four golden comparisons failed identically on HEAD and the final build. Buster stage-two kills were 9,700 (golden 15,414), laser stage-one ranks were 8 (12), and rail stage-one/two kills were 4,103 / 10,622 (5,677 / 15,298). All four kits on both builds produced identical level, rank, kill and time records. The reference file and global tuning were left intact.
- `npm run typecheck` and `npx vite build` passed. Vite retained its large-chunk advisory. The dedicated `npm test -- g8roles` passed. It covers all eight seat indices, authority, input replacement, actual mech and drone damage, Expose, support scaling, recall, compact snapshot decoding, lobby validation and reset.
- `npm run smoke` passed the whole-game suite, including local co-op, the mortal run and game over.
- **The full unit gate failed.** Three full runs finished 153/154, 153/154 and 152/154. Every file passed on at least one run. The final `TEST_JOBS=4 npm test` and a subsequent serial run of the two failures both reported `hostmig.test.ts` and `worldGame.test.ts`. The host migration unit can reach a real PeerJS constructor in Node after its reconnect delay. An independent build of unchanged HEAD raised the same constructor error. The title-demo test intermittently saw local storage change. A matched seeded diagnostic on both revisions showed the error reporter saving the test's own slow-frame assertion to `infinishoot.errors.v1` (4.85 ms on HEAD, 5.51 ms on the lane against a 4 ms limit). In the full suite there were also storage failures with the frame assertion passing. Their precise cause remains unresolved. Separate diagnostic runs on both revisions passed the storage assertion.

The implementation is uncommitted. Remaining release issues are the unit and performance gates, the inherited balance golden mismatches, and the above-target solo clear rate. All browser checks were local and headless.
