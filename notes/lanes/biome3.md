# biome3 — Candy Kingdom and Sunken Ruins

## Players get

Candy Kingdom has pink gumdrop hills, striped candy fences and lollipop cover, sprinkle weather, chocolate streams that slow movement, candy enemy colours, and Gummy Bears that split into three Little Gummies. Cake Tyrant fires candle fans and expanding frosting waves, summons bears, and loses its upper tiers at its two phase gates. Cupcake Baron is its smaller two-phase variant.

Sunken Ruins has teal masonry and caustic floor markings, coral cover, swaying kelp, rising bubbles and two opposing slow currents. Jellyfish drift sideways and warn before firing radial zap rings. Kraken King sends telegraphed tentacles out of the ground, briefly obscures the view with ink and pulls heroes into a swirling current in phase three. Kraken Princeling is the mini-boss. Both bosses have expressive portraits used by the existing finisher comics, story chapters, codex entries and EN/AR text. Four synthesized music arrangements are in the jukebox.

## Decisions and tuning

- Stages 1–8 stay unchanged. Stage 9 is Candy, 10 Ruins, 11 Aurora Peaks, 12 Magma/Omega. Classic remixes move to loop 4. Later loops repeat rows 2–4 (12-stage cycle); every fourth stage still ends with Omega. This preserves all existing areas and the original first loop.
- Cake: 2,550 base HP, speed 2.5, radius 2.1. Kraken: 2,500 HP, speed 2.8, radius 2.0. Both gate at 66%/33%; burst damage cannot skip layers/phases. Minis: 760/740 HP, 50% gate, eligible from stage 9. Stage/difficulty/co-op multipliers remain standard.
- Gummy: 100 HP, speed 2.4, contact 12, max 12 alive; splits into 3 gumlets (12 HP, speed 4.5, contact 6). Jellyfish: 40 HP, speed 2, contact 7, max 8; 0.9 s wind-up then 10 bullets at speed 5.5/damage 9, 3.6 s cooldown. Native spawn filters limit them to their own areas.
- Chocolate: 65% movement, no sinking/damage; 46 overlapping radius-2.8 circles trace two streams. Ruins currents: two opposite wind conveyor strips at speed 0.85. Initial hero spawn stays clear.
- Boss attacks: 0.9 s wind-up, 1.25 s base recovery (shorter with phases). Frosting uses the existing dashable shockwave rules, max 8 waves. Candle fans grow from 7 to 11 shots, damage 12. Summons: 3 natives (2 for minis).
- Tentacles: pool 24, 1.1 s warning, radius 1.6, damage 17 once at eruption, 0.6 s recovery. Cancel when their source dies. One instanced mesh, curved hooks and cyan suckers.
- Ink: 1.35 s, translucent pixel-shaped screen overlay, opacity 0.42 (0.12 with reduce flashing). Whirlpool: 3.5 s, radius 15, first 0.8 s warning only, safe inner radius 2.8, shove 1.35 at 5 Hz; dashes resist it. Host sends remote hero shoves through the existing message path.
- No new settings/save shape/dependencies. Weather/quality and existing reduce flashing/OS reduced motion apply. Kelp stops swaying with calm settings. Ambience reuses meadow/peaks loops; footsteps reuse snow/sand. No external APIs or recorded audio generation.
- Music measured offline with existing loudness audit: candy -28 LUFS / gain 1; ruins -28.9 / 1.10917; cake -25.9 / 0.78524; kraken -27 / 0.89125.

## Architecture and files

New content/logic is in `src/data/biome3.ts`, `src/world/biome3Arena.ts`, `src/game/biome3Brain.ts`, `src/game/biome3Models.ts`, `src/game/systems/biome3.ts`, `src/i18n/biome3.ts`, `src/ui/biome3Portraits.ts`, and `src/ui/debugBiome3.ts`.

Small registry/render hooks: `src/data/{biomes,enemies,bosses3,bestiary,codex}.ts`; `src/game/{ambience,animMath,bossField,bosses,enemies,firstten,hazards}.ts`; `src/game/story/strings.ts`; `src/game/systems/{bossFight,characters}.ts`; `src/render/{biomeLook,biomeSkins}.ts`; `src/world/{fieldArena,biomeProps}.ts`; `src/ui/{portraitArt,debugPanel}.ts`; `src/i18n/{en,ar}.ts`; `src/audio/loudness.ts`, `src/audio/music/composition.ts`; `src/dev/testLinks.ts`.

No edits to Game, hero, HUD, screens, global CSS, settings, netHost or netClient. Boss snapshots carry optional `bx.bi3` (tentacles/ink/whirlpool); frosting wave tuples have an optional colour. Existing enemy snapshots carry boss phases and native enemy state. Gameplay runs on the host; clients render state and effects. Arena geometry, streams and currents derive from the common seed. New enemy IDs append to the registry so prior numeric IDs stay stable. Client version parity is required as with other new content.

Tests: new `tests/biome3.test.ts`; additive expectation updates in `tests/{biomes,bossLane,bosses3,models,music,world}.test.ts`. Also `PLAN.md` and this handoff.

## Test links and visual review

- `?test&biome=candy&god&day&near=chocolate`
- `?test&biome=ruins&god&day`
- `?test&biome=candy&bossnow&nointro&b3near&god&biome3move=frosting`
- `?test&biome=candy&bossnow&nointro&phase=3&god&biome3move=candles`
- `?test&biome=ruins&bossnow&nointro&b3near&god&biome3move=tentacles`
- `?test&biome=ruins&bossnow&nointro&phase=2&god&biome3move=ink`
- `?test&biome=ruins&bossnow&nointro&phase=3&god&biome3move=whirlpool`
- `?test&stage=9&miniboss&god&nointro` / stage 10 for Princeling.
- `?test&biome=candy&spawn=gummy:3&god` / `?test&biome=ruins&spawn=jellyfish:4&god`
- Append `&lang=ar`, `&calm`, or `&killboss=2&finat=0.7` for locale, reduced flashing, or pinned finisher checks. `b3pose` is useful for models but holds the boss in a roar, so do not combine it with phase transition testing.

Ran the project screenshot command, then a temporary native-Metal variant with a game-ready wait on this heavily loaded machine. Inspected PNGs in `shots/`: `biome3-candy.png`, `biome3-ruins.png`, `biome3-candy-world.png`, `biome3-lollipops.png`, `biome3-cake-phase3.png`, `biome3-kraken-tentacles.png`, `biome3-ruins-ar.png`, `biome3-cake-finisher.png`. Shots are ignored local artifacts. The phase-three model capture sets HP/phase directly because `b3pose` intentionally suppresses transitions; actual gates are tested independently.

## Validation

- Final `npm run typecheck` and `npx vite build`: PASS (existing large bundle warning).
- `npm run smoke`: PASS; all nine run configurations, training, modes, Versus, three-player local co-op, race/challenge, mortal death/history and menu checks completed without runtime errors.
- New biome3 tests: PASS, including actual native splitting/zaps, telegraph single-hit timing, pool limits, cleanup, seeded arena agreement, phase gates, expressive portraits, Arabic text, and host/client `bx.bi3` state through compact binary encoding. Frosting colour reaches clients.
- Existing affected rotation/model/music/world tests: PASS after updating expansion expectations. A full-suite run captured two old bossLane assertions before the last test edit; its subsequent standalone rerun passes.
- `COOP_TIMEOUT_MS=120000 COOP_LOAD_TIMEOUT=120000 npm run coop -- --offline --angle metal`: PASS, 1,574 real WebRTC snapshots, average 1,893 B, max 13,098 B; reconnect scenario passed. Offline mode uses local signaling. The browser harness covers existing co-op stages; new boss mechanics have in-process host/client coverage, not a dedicated two-browser boss encounter scenario.
- Benchmark: same native-Metal high-quality 640×360 heavy scene, 10 s measurement / 3 s warmup, roughly 290–296 enemies and 489–500 bullets. Meadow simulation/render = 0.89/1.85 ms; Candy = 0.91/1.66; Ruins = 0.85/1.74. Total CPU including GL = 4.72/4.18/4.31 ms; all ~61 fps. Shared machine load was high, so compare against the same-run meadow baseline rather than the historical ~2 ms number. JSON in `shots/biome3-bench-{base,candy,ruins}.json`.
- One controlled god-bot fixed-build sample each: King ~38 s, Cake ~35 s, Kraken ~49 s from spawn to clear (33/47 s new bosses after 2 s warmup). Four rank-4 auto weapons, default buster/charge. A chest promoted Candy missiles to rank 5, so these establish the broad existing kill-time band, not a rigorous balance equivalence claim.

## Outstanding validation and risks

The full suite is not green on the starting revision. Untouched baseline `309ab1e` independently reproduces the five `coopplayCoop` bunker/bomb assertions, two `meta2` achievement assertions, `pvp2` null-phase exception, and `raceCoop` missing `pvp.rules.rounds` exception. Baseline race needs the test runner’s wrapped import to report its load-time exception; invoking the bundled module directly swallowed it through the test environment’s error handler. `arenaCoop` passed both its baseline rerun and the second full pass. These unrelated systems were left untouched for their owning lanes.

Caustics are static merged floor motifs; bubbles/kelp supply motion. No bespoke recorded boss voice lines or underwater ambience sample were generated. Longer multi-build balance testing and a dedicated browser co-op scenario for both new bosses remain useful integration follow-ups.
