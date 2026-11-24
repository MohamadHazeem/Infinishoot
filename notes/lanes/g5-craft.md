# Gate 5 · Weapon crafting and synergy discovery

Players can take a frame from treasure or buy one at the shop's **Workbench**. It takes one of the four auto slots and starts firing immediately. Five frames deliver a pulse, orbit, lob, beam or field. Five cores supply burn, freeze, shock, blast radius or chain. Five modifiers split, pierce, bounce, home or repeat the attack. The three sockets compose into 125 full recipes. The HUD lists the installed parts.

## Economy and combat

- A frame costs 7 gold, a core 12, a modifier 18. A paid refit replaces one socket and preserves the others. Only one chassis per hero. Invalid purchases, duplicates, insufficient funds, a full rack and a closed shop cannot charge the player.
- Elite and boss treasure can offer a frame or a missing part in an ordinary card slot. Evolution and fusion choices take priority. Map chests have a 45% chance to fill a missing socket on an owned chassis. At levels 6 and 12, the next gear pickup can pay for the missing core or modifier using its reroll. These gear drops favor the hero's other weapon tags and use seeded tie-breaking. Free parts never overwrite a choice. The workbench explains the gear trade.
- Bare frames use 15% of full damage and two sockets use 46%. Hits use the existing hero damage, crit, status and PvP paths. Lobbers mark the landing point before impact. In duels, a pilot gets a 0.6-second ground warning. Stepping outside its two-unit radius avoids the hit, and an unmarked bystander is safe from splash or chains. Pulses use a fixed 16-slot pool, a single instanced mesh per weapon and reused hit buffers. Clients draw compact active transforms from snapshots. The host applies damage and distributes sounds and impacts through the effects bus.
- Eight hidden interactions pair other equipped weapons' tags with the chassis. Shared feed increases impact power, Standing wave widens area pulses, Thermal lens rewards hitting exposed enemies, Induction loop extends a chain, Pressure vessel enlarges explosive impacts, Double ratchet shortens cooldown, Wide aperture extends reach, and Residual heat strengthens the repeat. A successful hit is required for discovery. Conditional effects also require the relevant exposed hit, extra arc or echo.
- The **Synergy Journal** is available in the workbench and enemy guide. EN and AR show each interaction's effect and the seed of the first run in which the player triggered it. Other languages use the existing English fallback. The normalized `infinishoot.craft.discoveries.v1` storage key accepts known IDs and unsigned integer seeds. The game save schema is unchanged. Run-local sockets and discoveries survive the existing snapshot/build paths. Guests record only their own results, while human couch players share the local profile.

## Measurements

**Dev bot, to re-measure with the skilled bot.** This checkout lacks both `src/dev/skillBot.ts` and the `npm run skillbot` command. The disposable Game fixtures export `measureRun(game, runner)`, `medianDistinct(runs)` and `measureWeapon(game, runner, weapon, target)` from `tests/g5craft.test.ts`. The runner receives a requested number of seconds and must advance that Game. Swap in the Gate 2 runner for the same measurements once available.

Normal, Rookie, Buster / Charge Shot / Bomb, no pet, seeds 41–43. Before the change, mortal `botRun(s, false)` cleared 0/3 loops. All three died in stage 1 at 271/261/261 simulated seconds, levels 17/19/19, with 4305/5347/5545 kills and zero crafting interactions.

| Seed | Mortal crafting run | Final sockets | Stage / level | Simulated seconds | Kills | Distinct interactions |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 41 | Took a frame | projector / fire / split | 2 / 29 | 535 | 15492 | 3 |
| 42 | Took a frame | projector / chain / home | 1 / 19 | 264 | 5350 | 3 |
| 43 | Took a frame | projector / fire / bounce | 1 / 19 | 276 | 5689 | 3 |

The crafting shopper prioritized projector/fire/split at actual shop and treasure decisions. Drops supplied alternatives. It received no extra gold, parts, XP or chances. Median **3 distinct per crafting run**, 0/3 loop clears. Three stock first-card control runs after the change all died in stage 1 (272/276/262 seconds, 5980/5572/5354 kills) and used zero crafting interactions. Their median was 0. These small samples do not establish the 40–60% skilled-bot Normal loop-clear rate or a median for the entire player population.

For DPS, each run starts with either an evolved Glacier Heart (Nova) or one full recipe. The same invincible dev runner advances 30 one-second intervals, replenishing a ring of twelve 2500-HP Chonks seven units from the hero. DPS is the weapon's credited damage divided by elapsed simulation time. Separately credited collateral, such as burn ticks, is excluded. This measures representative crowded combat; moving bosses and different weapon partners can produce different rankings.

| Full weapon | Seed 41 | Seed 42 | Seed 43 | Median DPS |
| --- | ---: | ---: | ---: | ---: |
| Evolved Glacier Heart, before change | 630 | 543 | 436 | 543 |
| Projector / fire / split | 725 | 591 | 677 | 677 |
| Orbiter / shock / bounce | 675 | 485 | 458 | 485 |
| Lobber / explosive / home | 591 | 636 | 646 | 636 |
| Beam / chain / pierce | 543 | 534 | 686 | 543 |
| Field / frost / linger | 577 | 446 | 403 | 446 |

The five recipe medians span 82–125% of the reference. Their median is **543 DPS**. The comparison covers five of 125 recipes and one evolved reference.

Reproduce with `CRAFT_SEED=41 CRAFT_BENCH=run CRAFT_KIT=projector,fire,split npm test -- g5craft`; omit `CRAFT_KIT` for the stock shopper. Use `CRAFT_BENCH=probe` to run the DPS probe, omitting `CRAFT_KIT` for the evolved reference.

## Multiplayer and visual checks

- The offline co-op scenarios passed twice in headless Chromium via Playwright. The first run observed 1967 snapshots averaging 1763 bytes, with a 15242-byte maximum. Reconnect, three objective stages, host/client state checks and return to lobby passed.
- An additional two-browser WebRTC run bought all three parts as the guest. Both machines saw `projector/fire/split/37`. The guest journal recorded Shared feed, Thermal lens and Double ratchet with seed 1325070728. The same purchase and ownership check passed again with seed 2996888072. The host journal stayed empty in both runs. Unit coverage also checks the build export/import used by migration and PvP. A newly promoted client discards purely visual in-flight pulses before resuming authoritative firing.
- Headless production preview, English and Arabic, 1280×720 and 1920×1080. All five workbench choices and navigation controls fit at each size. Both journals showed real discoveries with the originating run and hid undiscovered details. Screenshots were opened and inspected. Local artifacts are under `shots/g5-craft-bench-{en,ar}-{720,1080}.png`, `shots/g5-craft-journal-{en,ar}.png`, and `shots/g5-craft-combat.png`.
- Workbench link: `?test&craft=projector,fire,split&bench&gold=40`. Journal: play `?test&craft=projector,fire,split&god&swarm=24:chonk&seed=41`, then visit `?test&journal` on the same origin. Combat: `?test&craft=lobber,explosive,bounce&god&swarm=7:chonk&seed=41`. Append `&lang=ar` for RTL.
- The stock invincible balance replay ran all four kits through stage 3 in headless Chromium, with zero assertion failures or page errors. The corresponding CLI commands (`npm run coop -- --offline`, `npm run balance` and `npm run shot`) could not launch their own browser under the macOS sandbox. The Playwright connector ran the same replay and offline scenarios with browser/server setup adapted for its existing headless process.

- A 120-step headless combat sample with beam/chain/pierce maintained at least 175 enemies and 566 projectiles. The simulation update plus crafted instance update took 0.2 ms median and 0.4 ms at p95. Timing excludes GPU rendering and does not certify end-to-end 60 fps on target hardware.

## Checks

- Passed: `npm run typecheck`, `npx vite build`, `npm run smoke` (whole-game run, death report and history; zero runtime errors), `npm test -- g5craft fusion i18n pvp2`, and the final crafting-only regression run. The i18n test compared all 5830 catalog keys. The four-kit balance replay and both offline co-op browser runs passed via the headless connector.
- `npm test`: 120 of 131 files passed. Eleven failed on the isolated retry. Each also failed against the original tracked source at `d2f2456`: `balance3` (shockwave damage cap), `gameplay` and `gameplayCoop` (comeback), `menus` (Medium label), `hostmig` (bundled Peer constructor), `meta` (heat), `raid` (old Medium clear time), `time` and `timeCoop` (rewind/last stand), `ultboss` (team HP) and `worldEventsGame` (pit kill). The independent stock fusion check passed after keeping the workshop chassis outside the fixed fusion catalog.
- `npm run skillbot`: unavailable in this revision. Re-run both balance cohorts with the Gate 2 skilled bot after integration.

## Files touched

- New gameplay and content: `src/data/craftParts.ts`, `src/game/crafting.ts`, `src/game/weapons/crafted.ts`.
- New UI, copy, tests and notes: `src/ui/discoveryUi.ts`, `src/i18n/g5craft.ts`, `tests/g5craft.test.ts`, `notes/lanes/g5-craft.md`.
- Shared hooks: `src/game/game.ts` handles the shop action, gear pickup, partner-tag lookup and local discovery observation. `src/game/hero.ts` integrates treasure, slots and the HUD description. `src/game/weapons/index.ts` registers the buildable chassis by ID while keeping the fixed stock unlock/fusion catalogs intact. `src/ui/screens.ts` adds the two entry points, shop view and action. `src/dev/testLinks.ts` registers the QA parameters. `src/i18n/arabic2.ts` and `src/i18n/ar.ts` register the English/fallback and Arabic strings.
