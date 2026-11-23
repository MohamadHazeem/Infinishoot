# Gate 3 · Weak points and armour

A shot through the glowing gold socket deals double damage. A player facing a Rhino can circle to its copper back vents, switch to Shock or Explosive, or spend the shot on another target. Weapon level-up cards and discovered weapon entries in the Gear Guide identify their matchups. Codex & Lore explains the markings, the shield break and both impact colours in English and Arabic.

## Combat decisions

| Target | Cue and rule |
| --- | --- |
| Plated | Silver front slab and copper rear vents. Within 60° of the front normal directional hits deal ×0.6. Within 60° of the rear they deal ×1.5. Ordinary projectiles striking a side deal ×0.85. Explosive and Shock bypass the front plate and deal ×1.4, stacking with the rear bonus. Applies to Rhinos, Chonks, Wind-up Soldiers, burrowers, rollers and their veterans. |
| Ethereal | A violet halo marks Mirror Bots, Phantoms and jellyfish. Fire, Frost and Shock hits, including tagged status damage, deal ×1.4. Other hits deal ×0.65. |
| Shielded | A powered cyan rim marks Shield Bots and Bastion Porters. Their existing front arcs and escort protection apply while charged. A damaging secondary-weapon hit breaks the front shield immediately. Further secondary hits refresh its four-second recharge. The team can shoot through the opening. The separate elite bubble keeps its existing absorb pool. |
| Swarm | Three green pips mark swarmers, bats, bees and Jellets. Each member retains its small, independent life pool. Area and Chain hits deal ×1.4, once even when both tags are present. |
| Cores | Shooters, exploders and each visible boss and mini-boss get one socket. Its centre sits 0.82 body radii to the enemy's right and its hit radius is 0.28 body radii. The incoming shot or beam line must cross it. The marker sits at gun height so the crosshair and the simulation agree on tall bosses. Hidden Titan, Architect and raid proxies keep their encounter-authored targets and vulnerability windows. |

Elites inherit family armour. Elites from otherwise unarmoured families gain a plate. Ordinary Boppers keep the starting fight familiar. Damage uses incoming travel direction, including ricochets and blasts. A directionless status tick gets its tag matchup only. Fixed damage, phase immunity and PvP retain their own rules.

The host resolves damage. A remote pooled projectile uses the same historical enemy position as its body collision. The history stores positions, so the socket orientation follows the host’s current facing. Hitscan uses the live enemy pose. Clients draw markings from the existing definition, elite flag, facing and shielder family state. The shield uses the family's existing rewind-recorded timer and snapshot state. Host migration rebuilds enemy AI state, which can recharge an open front shield early. The normal snapshot format and save schema have no new fields.

Weak hits send a gold spark and underlined number. Resisted hits send a smaller blue spark and diamond number. These use the existing coloured effects-bus number styles, including their owner filter and pooling. Quiet hits share a 0.35-second feedback cooldown per enemy. Plates, shield rims and sockets use three instanced pools with live-slot uploads. Pips and halos are baked into the family geometry once. Reduced flash keeps the socket steady.

## Measurement

**Dev bot, to re-measure with the skilled bot.** This checkout has neither `src/dev/skillBot.ts` nor `npm run skillbot`. Normal used the Gate 2 rules. Each observation ran in a fresh jsdom process with fixed clock, seeded game and seeded cosmetic rolls. The dev bot was mortal in both experiments.

The paired aim encounter runs a rank-one Laser against a moving stage-one King Bopper for 12 seconds. The stock bot aims at the body. Perfect aim adjusts the point of aim to the socket and compensates for the cannon's 0.38 m lateral offset. Both arms use the same firing, movement and dodge decisions. The fixture removes the secondary and regular spawns, locks experience, and multiplies boss life by ten to avoid phase gates and overkill. Damage is counted only for actual Laser hits on that boss.

| Seed | Before · body / socket damage | After · body / socket damage | After · body / socket hits | After ratio |
| --- | ---: | ---: | ---: | ---: |
| 42 | 1,960 / 1,989 | 1,839 / 3,561 | 70 / 69 | 51.6% |
| 77 | 1,951 / 1,929 | 1,854 / 3,641 | 72 / 72 | 50.9% |
| 123 | 2,043 / 2,015 | 2,038 / 4,019 | 77 / 77 | 50.7% |
| Total | 5,954 / 5,933 | 5,731 / 11,221 | 219 / 218 | **51.1%** |

Body/socket damage was 100.4% before the change. The fallback beat the under-60% criterion in this encounter on all three seeds. The Gate 3 skilled-bot criterion and the Gate 2 Normal skilled-bot loop target of 40–60% still need the integrated runner.

For the loop diagnostic, the same mortal runner played unrestricted Normal with Rookie, Buster, Charge Shot and Bomb. The dev bot cleared **0/3 before and 1/3 after** with the final runner. Both sides used the same harness, including its yield between 15-second blocks. An earlier synchronous run cleared 0/3 on both sides. The aim-damage totals repeated exactly.

| Seed | Before · final stage / run seconds / kills | After · final stage / run seconds / kills |
| --- | --- | --- |
| 42 | 2 / 483 / 15,028 | 1 / 261 / 5,937 |
| 77 | 1 / 120 / 1,126 | 5 (cleared) / 1,082 / 45,625 |
| 123 | 1 / 269 / 5,338 | 2 / 440 / 9,440 |

Run `G3_ARMOUR_BENCH=1 npm test -- g3armour` to repeat both experiments. The headless fixture exports `measureArmourAim(game, runSeconds, seed, aim)` and `measureNormalLoop(game, runSeconds, seed)`. Install the skilled pilot on a fresh game for each sample and pass its mortal seconds runner. The aim fixture accepts `average` and `perfect`. Each fixture owns its test game for the observation.

## Checks and reproduction

- `npm run typecheck` and `npx vite build` passed. The armour integration, strict i18n, enemy and model suites all passed together.
- `npm run smoke` passed. The invincible Normal Rookie reached stage 3 with 31,925 kills. The mortal Nightmare run recorded King Bopper's shockwave as its cause of death. The harness reported zero runtime errors.
- `npm test` passed 121 of 131 suites. Ten failures persisted on the runner's isolated retry and match the fixtures in [the Gate 2 decision log](g2-hardmode.md#unit-fixtures-for-integration). They cover the previous Normal damage cap (`balance3`), comeback (`gameplay`, `gameplayCoop`), rewind and last stand (`time`, `timeCoop`), difficulty label (`menus`), difficulty scaling (`meta`, `ultboss`), raid duration (`raid`) and a recycled enemy reference (`worldEventsGame`).
- The existing four-kit balance harness passed in managed Chromium using the original expected values, fixed clock and 25% tolerance. All kits reached stage 3. Cumulative stage-2 kills were 13,486 (Buster), 17,919 (Laser), 14,818 (Scatter) and 13,394 (Rail).
- The full offline co-op scenario passed in two isolated managed Chromium contexts, including the reconnect, party restart and lobby return. It recorded 1,873 snapshots, averaging 1,715 bytes with a maximum of 11,374. The raw `npm run coop -- --offline`, `npm run balance` and `npm run shot` launchers failed before the page loaded because macOS denied the Chromium shell's Mach port registration. The successful runs used the same local game and harness assertions with the managed browser.
- A ten-second 1280×720 Medium production stress capture recorded 600 frames at 60.0 FPS, median frame CPU 1.9 ms and p95 2.3 ms. The final sample held 184 enemies and 547 bullets. Reproduce with `?test&bench&seed=42&season=off&god&nolevel&hold=50:charger,50:shooter,50:shielder,20:ghost&bullets=550&aim=1,0&quality=medium&day&dry`.
- Visual links use `?test&seed=42&season=off` with `&lvlup`, `&screen=codex`, `&screen=arsenal&discover=all`, `&foe=king:move:2&god&nolevel&slowmo`, `&foe=charger:windup:4&god&slowmo` or `&foe=shielder:recover:4&god&slowmo`. Add `&lang=ar` for Arabic. Inspected all 24 production screenshots at 1280×720 and 1920×1080 in English and Arabic. At both sizes the matchups span the width of the discovered Gear Guide cards. The screenshots are under `shots/g3-armour-*.png`.

## Files

- New `src/data/armour.ts` contains the tunings and tag matchups. `src/data/enemies.ts` assigns families and weak points after all encounter definitions have registered.
- New `src/game/armour.ts` resolves directional hits, core intersections and front-shield breaks. `src/game/enemies.ts` owns the pooled markings, family geometry, shield recharge and escort coverage. `src/game/systems/combat.ts` calls the resolver and uses its result for impact feedback.
- Shared edits in `src/ui/screens.ts` add the level-up, Codex and Gear Guide hooks. `src/style.css` adds two matchup text rules. `src/dev/testLinks.ts` opens the Gear Guide after its test link seeds discoveries. `src/i18n/en.ts` and `src/i18n/ar.ts` add 12 strings each. Other languages use the existing English fallback.
- `tests/g3armour.test.ts` covers arcs, real hit lines, tag priorities, bosses, shield recharge, pooling, fixed hits, client authority, lag-compensated remote shots, snapshot encoding, hit cues and localized screens. This note is the lane decision log. The worktree's pre-existing change to `.lane-brief.md` belongs to the lead.
