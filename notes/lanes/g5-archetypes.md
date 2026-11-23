# Gate 5 · Hero build paths

Each of the 11 heroes has two signature paths. A diamond on a level-up card, shop offer or owned Mod upgrade shows the path name and the score **after** taking the pick. A star marks completion. Pause → Your Build shows both recipes, separate weapon and support counts, and what the capstone does. Online players see their own recipes. A shared-screen party sees each seat's recipes under its own player number.

## Rules

- Bring **one weapon with the named tag to level 3**, then collect **two ranks across the listed supports**. Either order works. Two ranks in the same passive or Mod count. Two different level-one weapons do not make a level-two weapon. The starting kit counts, including hero-specific clicks. Evolution tags count. A weapon fused from two maxed ingredients satisfies the weapon tier for its resulting tags.
- The capstone belongs to the equipped build. Selling or trading away its last required support disables it. Each qualifying path has its own eight-second cooldown, including on activation. Both can run together. There is no currency, permanent unlock, reroll bias, free item or save migration.
- Most effects select an enemy near the aim point, up to 4 m forward with a 5 m acquisition radius. Close-quarters triggers require a target within 2.8 m. Expose lasts 1.4 s. Frost lasts 0.65 s with the usual boss multiplier. The 2.8 m control pulse affects up to four targets. Shielded foes and boss entrances resist it. Pulls and shoves leave bosses, mini-bosses, Titan parts and the Reaper anchored. A ward intercepts one hostile projectile within 3 m. The blast has radius 1.8 m and base damage 12. Lightning uses the existing two-hop zap with base damage 9.
- An active capstone evaluates the owner's actions during the authoritative fight step. Pause, shopping and a holstered Pacifist road suspend it. During competitive duels the capstones stay dormant. Enemy, bullet and build snapshots carry the outcomes. Ring, star, blast and lightning effects use the owner's existing networked weapon context. Gear changes rebuild a two-bit active mask. The combat loop reuses the hero's target array and existing pools. It does not scan inventory or construct arrays per frame.
- Reconnect and host promotion reconstruct eligibility from the restored equipment. A reconstructed hero starts with a full eight-second wait. The online pause uses the guest's snapshot of owned Mods. Shop hints are a top-level, optional field on the existing reliable shop view. Level-up offers carry optional canonical path IDs and counts. A player reads them in their own language.

## Test links and visuals

All links start on the current worktree's Vite preview. Add `&lang=ar` for Arabic.

| View | Query |
| --- | --- |
| Level-up chip | `?test&god&seed=42&passives=rapid_coil:1&levelup` |
| Shop chips | `?test&god&seed=42&shop&modoffers=quick_draw,demolition&gold=60` |
| Completed Demolitionist and partial Gunslinger | `?test&god&seed=42&setpause=1&weapons=swarm:3&passives=big_bang:2`, then expand Your Build |
| Bulwark ward | `?test&god&hero=bulwark&weapons=aura:3&passives=armor:2`, then fire while stationary |

Inspected level-up, shop and expanded pause screenshots in English and Arabic at 1280×720 and 1920×1080, plus Arabic at 844×390. On the short viewport the built-in scroll cue leads to the chips, and the shop action row stays pinned. Screenshots are under `shots/g5-archetypes-{level,shop,pause}-{en,ar}-{720,1080,390}.png`. The focused first shop card overlaps the first-shop help banner at 720p, as previously recorded in the Gate 2 notes. The path name and count remain visible.

## Files

| File | Change |
| --- | --- |
| `src/data/archetypes.ts` | Paths for every hero and shared capstone tuning. |
| `src/data/heroes.ts` | An additive paths field on each hero definition. |
| `src/game/archetypes.ts` | Recipe evaluation, projected hints, pause markup, triggers, bounded capstone effects and per-hero timers. |
| `src/game/hero.ts` (shared) | Own/reset the runtime, refresh after gear changes and chest weapon ranks, attach hints to the shop view. |
| `src/game/game.ts` (shared) | Fight-step dispatch, pause roster, capstone blast names in damage reports and final-hand hints including Pacifist rewards and migrated hands. |
| `src/ui/screens.ts` (shared) | Optional hint fields, card chips, pause panel and shop upgrade chips. |
| `src/style.css` (shared) | Responsive two-column pause recipes and chip type size. |
| `src/i18n/menus.ts` (shared catalog) | English and Arabic names, effect descriptions and recipes. The existing five fallback catalogs already import the English menu keys. |
| `tests/g5archetypes.test.ts` | Catalog validation, every trigger/effect pair, rank and fusion projections, sale, reset, cooldown, per-seat authoritative offers, client Mods, shared-screen progress and Arabic rendering. |
| `notes/lanes/g5-archetypes.md` | Design, measurements and integration handoff. |

## Verification on 2026-11-23

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. |
| `npm run smoke` | Passed across the roster. The mortal run reached the death screen and recorded its cause. |
| `npm test -- g5archetypes` | Passed, including all 22 trigger/effect pairs and rebuilding a returning seat. |
| `npm test` | 121/132 files passed. Eleven fixtures failed again in the runner's serial retry. The lane test and strict i18n passed. The final targeted run of the lane, i18n and both modes fixtures passed all four files. |
| `npm run coop -- --offline` | The shell Chromium launcher failed before startup. The same offline suite passed three times in managed headless Playwright, with isolated contexts, real WebRTC, low graphics and the suite's original assertions. The final run sent 1,852 snapshots, with a maximum of 14,846 bytes and zero over 16 KB. |
| `npm run balance` | The shell Chromium launcher failed before startup. In managed headless Playwright, all four kits cleared both stages within the original 25% tolerance. Stage 2 cumulative kills were 15,414 (Buster), 15,491 (Laser), 15,122 (Scatter) and 15,293 (Rail). |
| `npm run shot` | The shell Chromium launcher failed before startup. Managed headless Playwright captured and inspected the built preview instead. |

The three shell browser commands hit macOS `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`. The browser checks used localhost. No broker, deployment or live service was needed.

The ten failures already described in [the Gate 2 hard-mode handoff](g2-hardmode.md) were `balance3`, `gameplay`, `gameplayCoop`, `menus`, `meta`, `raid`, `time`, `timeCoop`, `ultboss` and `worldEventsGame`. They exercise the previous Normal rules or the collapse fixture's recycled enemy. The eleventh, `hostmig`, tried to construct the bundled PeerJS client during a timed reconnect (`import_bundler.default is not a constructor`). A separate bundle using the unchanged shared files from `1ddb32a` reproduced that exception at the same reconnect step. These fixtures and the network transport are outside this lane's ownership.

## Skilled-bot experiment

The paired baseline uses the mortal Gate 2 Rookie on New Normal at `1ddb32a`, seeds 1 through 20, pet and season off, default clicks and special. Each fresh process ran `window.skillRun(2100)` with the CLI's seeded RNG, simulated timers, 60 Hz steps, 180 ms reaction time and 4° aim error. The unmodified CLI ran before the gameplay change. The after adapter records a path ID the first time the hero's equipped build reaches five points. It observes eligibility on the build refresh and preserves the default pilot, shop and level-up policy. The checked-in Gate 2 perf JSON predates the New Normal rebalance, so it was neither used as the control nor overwritten.

The hero comparison assigns a path before the run. Each path gets the same two actual game seeds (1 and 3) and starts from its hero's ordinary kit with no forced gear. In a fresh headless Chromium page, the same `window.skillRun(2100)` pilot handles combat, survival, healing, routing and specials. The menu adapter substitutes the first offered card with a diamond for the assigned path and chooses its supporting Mod when it is on sale, fits a free slot and the player can afford it. Otherwise it keeps the skilled bot's choice. Timeouts and intervals advance by simulation time. This cohort measures the cost of pursuing a path, including runs where the build never comes together. It uses a different engine and pick policy from the paired jsdom control.

### Paired New Normal Rookie results

| Metric | Before | After |
| --- | ---: | ---: |
| Starts ending in death or loop clear | 20/20 | 20/20 |
| Clear stages 1 / 2 / 3 | 14 / 12 / 11 | 14 / 12 / 11 |
| Clear the first loop | 8/20 (40%) | 9/20 (45%) |
| Median stage reached | 4 | 4 |
| Mean game seconds | 711.3 | 704.2 |
| Runs reaching a capstone | — | 5/20 (25%) |

Seeds 4 and 11 gained a clear. Seed 16 lost one. Gunslinger was reached in four runs (11, 13, 16 and 18), with three clears. Demolitionist was reached in two (4 and 13), both clears. Seed 13 reached both. Four of the five runs reaching any capstone cleared, as did five of the other 15. Reaching a capstone requires surviving long enough to assemble the gear. One win moves this paired cohort by five percentage points.

The stock baseline CLI used non-overlapping batches of 4 and 16. Reproduce the full control with `npm run skillbot -- --runs 20 --seed 1 --difficulty normal --jsdom`. The instrumented after runner initially reserved 64 samples. Its paired collector was deliberately stopped on entry to sample 21 after it checkpointed the 20 completed Rookie runs. The separate 44 path-directed samples ran through the headless browser.

### Directed runs by intended path

Across 44 starts, **30/44 (68%) reached a capstone**, **28/44 (64%) reached the assigned capstone** and **14/44 (32%) cleared the loop**. All runs ended in death or victory. The observed win rates across assigned paths span **0% to 100%**. Each row has only two starts, so one seed changes its win rate by 50 percentage points.

| Hero | Intended path | Reached intended | Loop clears | Clear seed(s) |
| --- | --- | ---: | ---: | --- |
| Rookie | Gunslinger | 1/2 | 1/2 | 1 |
| Rookie | Demolitionist | 0/2 | 1/2 | 1 |
| Bulwark | Bastion | 2/2 | 1/2 | 3 |
| Bulwark | Siegebreaker | 2/2 | 1/2 | 3 |
| Dash | Ice Skater | 0/2 | 0/2 | — |
| Dash | Outrider | 1/2 | 0/2 | — |
| Ace | Spotter | 2/2 | 2/2 | 1, 3 |
| Ace | Stormcaller | 2/2 | 0/2 | — |
| Duelist | Riposte Artist | 1/2 | 0/2 | — |
| Duelist | Deadeye | 2/2 | 1/2 | 1 |
| Furnace | Crucible | 1/2 | 1/2 | 3 |
| Furnace | Backdraft | 2/2 | 0/2 | — |
| Twin | Crossfire | 2/2 | 1/2 | 3 |
| Twin | Binary Orbit | 1/2 | 0/2 | — |
| Ronin | Flash Draw | 0/2 | 0/2 | — |
| Ronin | Winter Blade | 0/2 | 0/2 | — |
| Tinker | Arc Welder | 2/2 | 2/2 | 1, 3 |
| Tinker | Point Defence | 2/2 | 0/2 | — |
| Medic | Triage | 2/2 | 1/2 | 3 |
| Medic | Quarantine | 2/2 | 2/2 | 1, 3 |
| Brawler | Clinch Fighter | 1/2 | 0/2 | — |
| Brawler | Ring Out | 0/2 | 0/2 | — |

Spotter, Arc Welder and Quarantine each cleared both seeds. Neither Ronin build reached its assigned capstone on these seeds. Demolitionist missed both assigned attempts but did complete in other Rookie runs. These small samples expose differences in access to the required gear and in the pilot's handling of melee. The ordinary Rookie benchmark met the Gate 2 target. The directed all-hero cohort fell below it. Human clear rates, fairness feedback and Gate 5's 15% share-of-wins criterion still require playtest telemetry.
