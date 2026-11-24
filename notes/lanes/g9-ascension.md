# Gate 9 · Ascension and the Abyss

## Player-facing changes

PLAY → ASCENSION opens the cumulative 20-tier solo Standard/Endless climb on Hard. Defeating Omega on Hard or Nightmare opens A1. Clearing the selected tier unlocks the next and equips its enamel pin. Every cleared tier has a different seven-pixel silhouette and an EN/AR name. The badge button cycles earned pins and an unequipped state. Existing fifth-tier titles remain selectable separately. Pins change the HUD and have no simulation hooks. The existing gauntlet profile key keeps the highest tier, cleared tiers, selection, NG+ and title. An older profile can equip any pin it already earned.

| Tier | Added rule | Pin |
| --- | --- | --- |
| 1 | Loose gears stay behind between stages | Brass Cog |
| 2 | Two runners enter at 30 seconds | Relay Ribbon |
| 3 | One stock reroll per shop | Paper Crown |
| 4 | Even stages gain a translucent dark edge | Moon Lantern |
| 5 | First randomly assigned elite modifier is Shielded each stage. Elite powers double | Twin Comets |
| 6 | Timed chests every 60 seconds. The first elite kill each stage supplies a heart | Cargo Kite |
| 7 | Bosses warn for one second before an eight-shot bonus ring | Encore Bell |
| 8 | Stage clears cease to heal | Glass Heart |
| 9 | First elite death each stage calls a shield bearer | Tin Shield |
| 10 | At quarter life bosses start winding up bonus rings every five seconds. Runners can join outside duels | Quarter Moon |
| 11 | Carry at most ten unspent gold through a stage transition | Copper Key |
| 12 | Shops seal healing | Medic Star |
| 13 | Timed chests every 90 seconds. The one reroll after a clear is free | Salvage Hook |
| 14 | Sixteen-shot boss rings alternate their firing angle by half a gap | Ruby Pinwheel |
| 15 | Banked gold earns zero stage-clear interest | Vault Seal |
| 16 | Elite deaths mark a radius-2.4 blast for 1.25 seconds | Ember Pin |
| 17 | The chest clock stops while the stage boss is alive | Harbour Flag |
| 18 | The inter-stage shop closes after 20 seconds of shopping. Pause, relic choice and route navigation do not consume this clock | Clockwork Finch |
| 19 | Timed chests every 150 seconds. Bosses call a medic at half life | Royal Crest |
| 20 | Available boss rematches replace originals. Bonus rings reach 24 shots | Summit Sun |

PLAY → THE ABYSS appears after a loop victory, including an existing victory achievement. Solo Normal, standard pilot/loadout choices, one opening shop. Survive 45 combat seconds to reach the next floor. The clock holds in menus and on death. Stage entry shows the new mutation, the HUD shows the floor and latest mutation, and Pause → Your Build lists every active card and its stacks. Floor reached is the HUD, history and game-over score.

The ISO UTC week seeds a shuffle of 30 different cards, without replacement per deck. Floor 31 adds the second copy of one card. Eight patrol cards add pairs, six leave warned mines, five add family-specific speed, five grant shields and six turn family kills into supplies. Patrols cap at three pairs per card, extra speed at 50%, blast radius at 3.5, live scrap warnings at 12, and supply drops at every second kill. Scrap inflicts 12 base damage after a visible ring and fuse cue. Patrols use normal off-screen spawn points and entrance tells. Spawn/kill dispatch indexes cards by enemy family. Changing floors and restarting clear stage-local effects. Host/guest co-op retains its ordinary mode and snapshots.

## Records and operations

RUN SETUP → CHALLENGE RECORDS → ABYSS RECORDS shows the current weekly and all-time local floor. With a Worker URL configured, it also displays the deepest 30 first claims this UTC week and the anonymous pilot ID of the player's accepted weekly best. If the endpoint fails, local records remain available. Practice links, assists, god/unlock-all, custom arenas and modded runs do not post. An unconfigured service receives no requests.

The Worker needs its existing SCORES and TELEMETRY bindings and migrations/0003_abyss.sql. GET /abyss reads the board. POST issues a random ticket at the start of combat, then accepts floor claims from 2 upwards. A D1 transaction validates total elapsed time and time since the last accepted checkpoint at 45 seconds per floor with a fixed three-second delivery allowance. A missed floor can be skipped after the corresponding survival time. Repeated claims are idempotent, stale claims cannot backfill, and the unique (week, floor) key settles a tie. A new week invalidates old tickets. Starts are limited to one per ten seconds per source in the isolate, on top of the Worker's shared burst limit and bounded body reader. IPs are used transiently for rate limits. D1 retains random IDs and gameplay fields. Replay verification belongs to Gate 10. No deployment was performed.

## Integration

The paused commit ee0051a is based on 3b35432. The lane owns src/data/{ascension,ascension2,abyssMutations,modes}.ts, src/game/abyss.ts, src/game/systems/gauntlet.ts, src/ui/{ascensionBadges,menuRun}.ts, src/i18n/g9ascension{,Ar}.ts, tests/g9ascension.test.ts and this handoff. Worker changes are server/leaderboard/abyss.js, the route registration in routes.js and migrations/0003_abyss.sql.

Shared hooks are the active tier getter in game.ts, shop rules in hero.ts, the badge action and exhausted reroll button in screens.ts, floor score and countdown in systems/render.ts, mode lifecycle and banking in systems/runFlow.ts, and the boss/elite guards in systems/spawning.ts. Catalogs en/ar import their matching copy. The es/fr/de/pt-BR/tr entry points explicitly include English fallback copy. The cosmetic module injects no global style changes beyond the pin class in the existing Gauntlet stylesheet.

## Visual checks and links

Headless managed Chromium on Vite preview. The direct shell Chromium launch reported a macOS Mach bootstrap denial. Real menu clicks changed and displayed the pin, opened local records, selected The Abyss from Play and started Normal with a 45-second director clock. QA used throwaway browser profiles.

Use `?test&bench&circle&ascension=10&badge=10&seed=42&god&season=off` plus the scene parameters below and `&lang=en` or `&lang=ar`. Using bench with circle selects the combat profiler. For deep-floor testing use `?test&bench&circle&abyss=31&seed=42&god&lang=ar`. The floor shortcut is practice only. Records are reachable directly at `?test&gauntletscreen=records`. To test earned badges via normal menus, use an existing cleared tier and open Run Setup.

| Scene parameters | EN 1280×720 | AR 1280×720 | EN 1920×1080 | AR 1920×1080 |
| --- | --- | --- | --- | --- |
| Meadow · `stage=1&biome=meadow&day` | [before](../../shots/g9-ascension-before-meadow-en-1280.png) → [after](../../shots/g9-ascension-after-meadow-en-1280.png) | [before](../../shots/g9-ascension-before-meadow-ar-1280.png) → [after](../../shots/g9-ascension-after-meadow-ar-1280.png) | [before](../../shots/g9-ascension-before-meadow-en-1920.png) → [after](../../shots/g9-ascension-after-meadow-en-1920.png) | [before](../../shots/g9-ascension-before-meadow-ar-1920.png) → [after](../../shots/g9-ascension-after-meadow-ar-1920.png) |
| Night · `stage=2&biome=dunes&night` | [before](../../shots/g9-ascension-before-night-en-1280.png) → [after](../../shots/g9-ascension-after-night-en-1280.png) | [before](../../shots/g9-ascension-before-night-ar-1280.png) → [after](../../shots/g9-ascension-after-night-ar-1280.png) | [before](../../shots/g9-ascension-before-night-en-1920.png) → [after](../../shots/g9-ascension-after-night-en-1920.png) | [before](../../shots/g9-ascension-before-night-ar-1920.png) → [after](../../shots/g9-ascension-after-night-ar-1920.png) |
| Boss · `stage=4&bossnow&nointro` | [before](../../shots/g9-ascension-before-boss-en-1280.png) → [after](../../shots/g9-ascension-after-boss-en-1280.png) | [before](../../shots/g9-ascension-before-boss-ar-1280.png) → [after](../../shots/g9-ascension-after-boss-ar-1280.png) | [before](../../shots/g9-ascension-before-boss-en-1920.png) → [after](../../shots/g9-ascension-after-boss-en-1920.png) | [before](../../shots/g9-ascension-before-boss-ar-1920.png) → [after](../../shots/g9-ascension-after-boss-ar-1920.png) |

The before images were recaptured on the paused lane’s original production build, mounted under g9-control, with the same scene parameters and Hard selected. The after images show A10 and its moon pin in the goals column. The even-stage border leaves the central aiming area and boss tells visible. Inspecting the Arabic night and boss shots caught the English darkness label. The final captures show الظلام. Additional checked images are shots/g9-ascension-{ui-abyss,setup,board}-{en,ar}-{1280,1920}.png. The Arabic A20 setup was also checked at 844×390 after separating the two translated help lines (shots/g9-ascension-setup-ar-844.png). QA artifacts are ignored by Git.

## Validation evidence

- Node 22.23.3. Typecheck and the Vite production build passed. Vite printed its existing chunk-size warning.
- The Worker tests use its actual fetch entry point and migrated SQLite tables behind a D1 adapter. They cover issuance, a too-early claim, duplicate and competing claims, lost-floor recovery, stale backfill, malformed bodies, input limits and UTC rollover.
- The offline co-op CLI reached the macOS Chromium bootstrap restriction. Its full offline scenario ran using the same test code and managed headless Chromium with LOW graphics. It passed, with 2,872 snapshots averaging 1,432 bytes, maximum 11,745 bytes and zero over 16 KB. The dev server initially served fallback fonts. Visual evidence used the production preview with bundled fonts.
- The invincible balance runner still took Buster, Laser, Scatter and Rail through both stages. Its existing 25% golden check failed on Buster stage-two kills (9,700/15,414), Laser stage-one ranks (8/12) and Rail kills (4,103/5,677 and 10,622/15,298). The same four results are recorded before this lane in g8-world.md. The direct Chromium launch failed. The measurements used the managed browser, stock seed 4242, kits and tolerance.
- A like-for-like HIGH WebGL2 heavy meadow at 1280×720 on Apple M5 Pro Metal measured frame p95 of 16.8 ms before and 16.8 ms after. Median enemies/projectiles were 278/500 and 267/499. FPS was 57.6 and 59.4, callback CPU p95 15.5 and 10.4 ms. These measurements were taken during the shared-machine test load.

- The managed production hardware matrix ran all 62 render configurations and four cold loads. The stock budget evaluator passed 6/62 scenes and 3/4 loads on the first pass. Every failing configuration was remeasured once. That retry passed 19/62 scenes and 4/4 loads, including broadband title readiness at 2,243 ms. The performance gate failed. HIGH heavy rendered at 59.2 FPS, 16.8 ms frame p95 and 9.5 ms callback p95 at 720p, and 59.4 FPS, 16.8 ms and 12.6 ms at 1080p. The 4×-throttled four-hero scenes were particularly slow. Those reports are shots/g9-ascension-perf{,-retry}.{json,md}. The CLI budget evaluator consumed those reports with --check --from-report.
- Two additional matched 1080p controls compared the original and delivered production builds in the same browser. LOW 4× four-hero combat went from 9.9 FPS / 200.0 ms frame p95 to 25.6 FPS / 66.6 ms. HIGH WebGPU projectile lights went from 60.0 FPS / 16.8 ms to 59.0 FPS / 16.8 ms. These controls reproduced the throttled miss on both builds. They do not establish a cause for all 43 missed configurations. See shots/g9-ascension-perf-controls.json. The previous g8-world.md baseline also records seven throttled misses under a lighter machine load.
- When the machine load fell, the remaining 43 render configurations were measured again. **Final hardware gate: 57/62 scenes and 4/4 cold loads passed.** All 50 unthrottled configurations passed, including the two renderer stress tests. Each of the five remaining LOW 4× CPU failures also failed on the original production build. For these five, simulation p95 exceeded the 12 ms limit on both builds. HIGH heavy on the final matrix was 59.2 FPS / 16.8 ms frame p95 at 720p and 60.0 FPS / 16.7 ms at 1080p. The stock evaluator still exits 1. [Final matrix](../../shots/g9-ascension-perf-final.json) · [Source controls for the five misses](../../shots/g9-ascension-perf-parent-throttled.json).

| LOW 4× scene | Original frame p95 / simulation p95 (ms) | Delivered frame p95 / simulation p95 (ms) |
| --- | ---: | ---: |
| 720p double population | 33.4 / 13.3 | 33.4 / 13.2 |
| 720p four heroes | 50.0 / 18.3 | 33.4 / 14.6 |
| 720p night | 33.4 / 12.2 | 33.4 / 12.2 |
| 1080p double population | 33.4 / 13.6 | 33.4 / 13.4 |
| 1080p four heroes | 50.0 / 17.3 | 50.0 / 16.3 |

- The final focused run of g9ascension, gauntlet, i18n and langs passed all four files. The full headless smoke command passed its combat, menus, multiplayer modes, runs and game-over assertions, with zero runtime errors.

- Two complete unit attempts each passed 156/157 files after the runner’s automatic retries. The first missed host migration under load; its subsequent isolated run passed. The second missed the title-demo save assertion. A field-level replay on the original and delivered bundles showed the same two tutorial tip additions (hands-movement and perfectdash) on diagnostic seed 2. Neither wrote a local storage key. Both preserved the profile on diagnostic seed 42. These diagnostic runs left the assertions intact. A subsequent complete npm test run passed all 157 files, with heroes3 and worldGame passing on the runner’s automatic retry.

## Mortal-bot comparison

All runs use the Gate 2 Rookie bot with 180 ms reaction time, 4° aim error, 10 decisions per second, no pet, no season and a 2,100-second cap. The tier sweep selects an earned tier in memory before the normal startRun call, verifies the active tier and Hard difficulty, then runs window.skillRun. One seed per tier is a reach probe. A10 has six seeds to test repeatability.

The stock Normal control at the shared parent 3b35432 cleared 15/20 loops on seeds 1–20. Stage clear rates were 100/100/100/75%, mean time 1,016.1 s, with no incomplete runs. The independent pre-change seed-1 run matched all gameplay fields of that cohort and cleared in 1,036.93 s. Legacy A10 seed 1 reached stage 4 and died to Omega at 1,110.83 s. The parent Normal clear rate already exceeded the Gate 2 target of 40–60%.

The final Normal cohort cleared 15/20 loops (75%). Stage clear rates were 100/100/100/75%, mean duration 1,016.1 s, with 0 incomplete. Comparing stage reached, loop result, death cause and duration to the parent, 20/20 seeds matched. The existing Normal target miss is unchanged.

| Tier | Seed 1 stage reached | Outcome | Simulated seconds |
| ---: | ---: | --- | ---: |
| A1 | 4 | Loop clear | 1,050.52 |
| A2 | 4 | Loop clear | 1,085.43 |
| A3 | 4 | Loop clear | 1,085.43 |
| A4 | 4 | Loop clear | 1,085.43 |
| A5 | 4 | slug | 977.35 |
| A6 | 4 | Loop clear | 1,081.07 |
| A7 | 4 | Loop clear | 1,041.43 |
| A8 | 4 | Loop clear | 1,053.73 |
| A9 | 4 | sniper | 949.37 |
| A10 | 4 | omega | 1,075.79 |
| A11 | 4 | omega | 1,075.79 |
| A12 | 2 | shark | 466.44 |
| A13 | 4 | Loop clear | 1,070.23 |
| A14 | 4 | Loop clear | 1,058.57 |
| A15 | 4 | Loop clear | 1,058.57 |
| A16 | 4 | Loop clear | 1,068.28 |
| A17 | 4 | Loop clear | 1,068.28 |
| A18 | 4 | Loop clear | 1,068.28 |
| A19 | 4 | Loop clear | 1,063.94 |
| A20 | 4 | Loop clear | 1,100.85 |

A10 cleared on 2/6 seeds. Individual results follow.

| Seed | Stage reached | Outcome | Seconds |
| ---: | ---: | --- | ---: |
| 1 | 4 | omega | 1,075.79 |
| 2 | 4 | Loop clear | 1,082.23 |
| 3 | 4 | Loop clear | 1,055.17 |
| 4 | 4 | shooter | 915.94 |
| 5 | 4 | omega | 1,060.15 |
| 6 | 4 | mirror | 905.05 |

Local raw evidence is in shots/g9-ascension-normal.json and shots/g9-ascension-tiers.json.


## Open release checks

The lane is implemented and uncommitted. The 40–60% Normal target, five throttled performance budgets and four invincible-bot golden comparisons remain open on the shared base. The Worker was exercised against locally migrated SQLite. Production migration, deployment and a live weekly rollover remain with the lead.
