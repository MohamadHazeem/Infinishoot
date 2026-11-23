# Gate 7 · Biome terrain and secrets

Nine island families have three usable patches each. Remixes inherit their parent’s rules. Each patch has four corner stones, a floor pictogram and a low toy-like landmark. Approaching it teaches its effect through the existing toast queue, once per profile with TIPS on, in English or Arabic. Existing ice pools, conveyors, chocolate, wind, lava, crushers, night lighting, weather events and relay puzzles still use their original systems.

| Island | Three marked terrain effects | Optional lair keeper | Keeper reward per hero |
| --- | --- | --- | --- |
| Bright Meadow | Roots, spring, magnet | Prince Bopper | Rescue Relay |
| Sunset Dunes | Shelter, prism, tide | Rex Jr. | Golden Glove |
| Frosty Peaks | Ice skid, prism, spring | Hive Princess | Cold Snap Soles |
| Magma Isle | Spring, shelter, tide | Rex Jr. | Cinder Receipt |
| Neon City | Prism, magnet, shelter | MC Static | Static Charm |
| Toy Factory | Magnet, spring, roots | Jack Jr. | Salvage Permit |
| Sky Fortress | Tide, spring, prism | Commodore Squall | Swift Feather |
| Candy Kingdom | Roots, tide, spring | Cupcake Baron | Forty Winks |
| Sunken Ruins | Tide, shelter, magnet | Kraken Princeling | Lodestone |

Roots slow ordinary enemies by 35%. Prisms expose them for 0.8 s. Tides push them radially at an impulse of 7 every 2 s. Ice preserves their incoming heading by adding a skid impulse of 4. Boss parts, mini-bosses and the Reaper resist these four effects. The spring adds 3.5 percentage points of special charge per second while occupied. Standing on a magnet pulls XP gems within 8 m. An occupied shelter cancels one nearby hostile round every 1.6 s. Patch radius is 2.5 m. Contacts use the existing spatial hash on a 0.2 s cadence.

## Exploration and co-op

- A separate stage-seeded roll assigns 58% vault, 20% puzzle shrine, 8% lair and 14% empty. The door normally lies 6–10 m from the start. Terrain patches normally lie 8–24 m away. Placement reserves clear footprints and falls back to the wider field if the central ring is busy. The rule set runs on procedural Standard, Endless, Daily and Weekly islands. Raid, Boss Rush, Gauntlet, custom arenas, training, PvP and Versus use their authored layouts.
- A friendly projectile crossing the gold seam opens the door. Laser and rail use the wall-clipped segment of their muzzle flash. Pets point out a nearby seal with a trail a teammate can follow. Discovery means revealing a previously sealed chamber. Collection is a separate action.
- Walk into an open vault for 2 gold per participant. Each hero missing the common Iron Heart also gains its 30 maximum life and heals 30 if alive. An owned Iron Heart never stacks. The reward is claimed once per chamber. In a shrine, step on the one-mark tile then the two-mark tile for 4 gold per participant. Both orders and rewards are team-wide. A lair requires standing still on its crown for 1.5 s. A 4 m landing circle warns for 2.5 s and holds until every living player is clear. An existing mini-boss fights with its normal attack tells and 0.6× stage boss HP scaling. Its death awards the island relic, or 12 gold on a duplicate. It never takes the stage boss’s slot.
- Solo and host resolve every contact, discovery, guardian kill and prize in simulation. The snapshot carries the actual placement, chamber phase, guardian UID and run find count. Each recipient receives a layout on change and periodically for recovery. Clients draw the props and show their local-language tip. A promoted host rebinds the restored mini-boss, or reopens the challenge if its spawn predates the migration checkpoint.
- One static instanced draw batch per arena holds the terrain and chamber. It uploads only on first draw or a phase change. The ordinary arena disposal releases it. Creating Three materials and geometry in render keeps their random UUID draws off the combat replay stream.
- The opt-in telemetry run’s existing stage record gains `ranks["secret:<biome>"] = [openedThisStage, cumulativeFinds]`. A newly sampled run with no finds has an explicit zero. Historical reports can omit the field. Filter to reports containing the field and test whether any cumulative value exceeds zero to measure run discovery. The existing schema and Worker accept the field directly. Unit coverage exercises the consented run through the real queue. No live reports were submitted.

## Source and shared edits

- New lane modules are `src/data/biomeRules.ts` (terrain, glyphs, keeper and reward), `src/game/biomeRules.ts` (placement, effects, replication, presentation and tips), and `src/game/secrets2.ts` (chamber interactions). `src/data/biomes.ts` attaches the rule set to biome definitions.
- Shared `src/game/game.ts` adds the field, reset, authoritative tick, kill notification, view installation, local guest tips and snapshot calls. The requested telemetry integration adds two lines in `src/game/systems/telemetry.ts`. Shared `src/i18n/en.ts` and `src/i18n/ar.ts` contain matching text keys. Other languages use the existing English fallback. Tips use the normalized `save.tips` array and its existing reset control.
- Shared `src/dev/testLinks.ts` adds `fieldsite=1|2|3|door` and distinguishes the combat profiler from the crafting workbench. Both used `bench`, and the existing performance matrix opened the shop and waited forever for combat. Explicit craft/journal links still open crafting.
- `tests/g7biomes.test.ts` covers every biome and remix, distribution, shot ownership, deterministic placement, all seven effects, shrine order, guardian warning and kill credit, duplicate snapshot delivery, run reset and queued telemetry. This handoff is the lane decision log. The existing modification in `.lane-brief.md` belongs to the caller.

## Visual checks and test links

The pairs below use seed 11, season off, the same viewport and locale, and six seconds of wall time after navigation. For each row, the four suffixes are `en-720`, `ar-720`, `en-1080`, `ar-1080`. The widths are 1280 and 1920 respectively. All screenshots are local, ignored PNGs under `shots/`.

| Scene | Link (append `&lang=ar` for Arabic) | Before / after filename pair |
| --- | --- | --- |
| Meadow | `?test&seed=11&season=off&stage=1` | `g7-biomes-before-meadow-<suffix>.png` / `g7-biomes-after-meadow-<suffix>.png` |
| Night | `?test&seed=11&season=off&stage=1&biome=dunes:night` | `g7-biomes-before-night-<suffix>.png` / `g7-biomes-after-night-<suffix>.png` |
| Rex fight | `?test&seed=11&season=off&stage=2&bossnow&nointro` | `g7-biomes-before-boss-<suffix>.png` / `g7-biomes-after-boss-<suffix>.png` |

Close-ups use `?test&season=off&god` with the options below. The shrine and lair captures include a friendly shot through the seam. The site link only positions the hero.

| Capture | Options |
| --- | --- |
| `g7-biomes-roots-en-720.png` | `&biome=meadow&seed=3&fieldsite=1&lang=en` |
| `g7-biomes-shelter-ar-720.png` | `&biome=dunes:night&seed=3&fieldsite=1&lang=ar` |
| `g7-biomes-shrine-en-1080.png` | `&biome=peaks&seed=4&fieldsite=door&lang=en` |
| `g7-biomes-lair-ar-1080.png` | `&biome=ruins&seed=31&fieldsite=door&lang=ar` |

The two additional vault captures, `g7-biomes-vault-en-1080.png` and `g7-biomes-vault-ar-720.png`, use `&biome=meadow&seed=3&fieldsite=door`. After a friendly shot and entry, each showed the localized prize toast and 130 maximum life. The English and Arabic hints fit the toast queue. The night shelter stays legible under its lamp and the guardian/shrine floor remains visible beneath the HUD. Inspection led to a brighter root glyph and darker meadow stone to separate them from grass.


## Mortal skilled bot

Discovery cohorts used fresh Normal Rookie starts, no pet, season off and seeds 1–20 in each biome. Each stock pilot played 60 simulation seconds with the biome pinned on stage one. The pilot received no secret positions, forced shots or exploration instructions. The observer recorded the chamber phase after `window.skillRun(60)`. An opening and a collection are counted separately. There were no deaths in these one-minute samples. Chamber kind shares the same seeded roll across families, so these are paired terrain comparisons.

| Biome | Chamber present | Found | Reward collected |
| --- | ---: | ---: | ---: |
| meadow | 18 | 18 / 20 | 4 / 20 |
| dunes | 18 | 18 / 20 | 2 / 20 |
| peaks | 18 | 18 / 20 | 1 / 20 |
| magma | 18 | 18 / 20 | 1 / 20 |
| neon | 18 | 18 / 20 | 4 / 20 |
| factory | 18 | 18 / 20 | 2 / 20 |
| sky | 18 | 18 / 20 | 0 / 20 |
| candy | 18 | 18 / 20 | 2 / 20 |
| ruins | 18 | 18 / 20 | 2 / 20 |

All nine families cleared the 25% discovery threshold. Combined finds were 162/180 (90%). Seeds 1 and 2 rolled no chamber in every group. The unmodified game has no cracked chamber, shrine or keeper, so it cannot emit a find for this feature.


The full-loop control used revision `84f42cc`, Rookie, no pet, season off, seeds 1–20 and a 2,100-second cap per Normal run. All comparisons use the stock `scripts/skillbot.mjs` simulation with one fresh process per seed. For the biome-specific runs, a temporary observer set `biomeForce.key` before `startRun` and recorded room state after `window.skillRun` returned. Full-loop runs used the ordinary stage rotation. The pilot had 4° aim error, 180 ms reaction time and 10 Hz decisions.

| Normal build | Clears at stages 1 / 2 / 3 / 4 | Full loop | Mean game seconds |
| --- | --- | ---: | ---: |
| Before | 20 / 19 / 18 / 7 | 7/20 (35%) | 929.2 |
| Gold-only vault trial | 20 / 19 / 18 / 6 | 6/20 (30%) | 931.7 |
| Delivered vault with Iron Heart | 20 / 19 / 18 / 11 | 11/20 (55%) | 957.4 |

The gold-only trial retained early-stage progression but lost a stage-four clear. Vaults now supply the game's existing common Iron Heart only when the hero lacks it. A player has to find the seal and enter the room. This gives exploration a defensive payoff that can last until the boss without changing boss damage, attack tells, draft odds or the bot.

The delivered cohort completed all 20 samples without hitting the time cap. Winning seeds were 1, 2, 3, 5, 8, 11, 12, 15, 18, 19, 20. Across the full natural rotation, 20/20 runs opened a chamber, with 66 stage finds in total. The Normal loop result falls inside the 40–60% Gate 2 target.

## Regression checks

- `npm run typecheck` and `npx vite build` passed. Vite retains its existing large-chunk warning.
- `npm test` passed all 143 files with the Iron Heart reward. The focused `node scripts/run-tests.mjs g7biomes i18n` run also passed both files.
- `npm run smoke` passed. The mortal smoke run reached game over and recorded the cause. The local co-op smoke run reached stage two with three heroes.
- `npm run balance` could not start shell Chromium. The same four-kit harness passed its 32 comparisons in managed Chromium. All four invincible bots reached stage three. Stage-two cumulative kills were 15,105 Buster, 13,409 Laser, 14,735 Scatter and 13,886 Rail.
- `npm run coop -- --offline` could not start shell Chromium. The offline harness passed in managed headless Chromium using its real local WebRTC data channel, low graphics and the documented 120-second timeout. Host and client matched escort, zones and door objectives across stages 1–3. Reconnect, revive, restart and kick passed. The 1,906 snapshots averaged 1,817 B and peaked at 14,962 B, with zero over 16 KB.
- Chromium launched through the shell is blocked on this macOS worker at Mach bootstrap registration, before it can create a page. The browser checks used the managed headless Playwright browser with the project's drivers and assertions. No public broker or service was involved in the offline co-op run.

### Metal performance

The full 60-scene matrix used hardware ANGLE Metal on an Apple M5 Pro, production Vite preview, fresh contexts, 2 s warm-up and 5 s measurement. All 48 native cases sustained 60.0 FPS. The worst native frame-interval p95 was 16.8 ms. All four transfer/readiness cases passed. Broadband title and fight reached ready at 1.06 and 1.21 s. The 720p HIGH heavy case had a median of 289 enemies and 502 projectiles in the delivered build.

The unchanged control used production code from `84f42cc` with only the test-link bench/workbench disambiguation so the measured scene remained in combat. Control measurements include every LOW ×4 row and a native HIGH reference. When six delivered rows failed initially, each was measured again once. The stock gate evaluated the full report using the retry for each of those rows. Of 60 scenes, 57 passed. The three remaining failures also failed on the control.

| Scene | FPS before → after | Frame interval p95, ms | Simulation p95, ms | Callback CPU p95, ms |
| --- | ---: | ---: | ---: | ---: |
| 720p HIGH heavy, native | 60.0 → 60.0 | 16.7 → 16.7 | 2.2 → 2.1 | 5.2 → 4.8 |
| 720p LOW team, ×4 | 28.0 → 31.7 | 50.0 → 50.0 | 19.6 → 17.8 | 35.1 → 30.5 |
| 1080p LOW double, ×4 | 38.1 → 45.8 | 33.4 → 33.4 | 16.0 → 12.2 | 27.9 → 19.9 |
| 1080p LOW team, ×4 | 28.3 → 33.3 | 50.0 → 33.5 | 19.6 → 16.5 | 33.3 → 28.6 |

The native HIGH heavy GPU p95 was 2.74 ms before and 2.28 ms after. Under ×4 throttling the limits are 12 ms simulation, 28 ms callback CPU and 34.5 ms frame interval at p95. The hard performance gate remains **failed**. Shared-machine measurements vary, so the improvements above should not be attributed solely to this lane. No budget, population or quality setting was relaxed. Local reports are `/tmp/g7-biomes-vault-metal.json` (full first pass), `/tmp/g7-biomes-vault-checked.json` (retries included) and `/tmp/g7-biomes-control-metal.ndjson` (control). Recheck with `npm run bench:real -- --check --from-report /tmp/g7-biomes-vault-checked.json`.
