# Models lane

## What players get
- All seven heroes have layered chest/waist armour, shin guards, bevelled boots, shaped gloves, cannon detailing and helmet brow/cheek plates. Expressions, skin colours, wardrobe colours, recoil, movement and death poses remain on the original joints.
- Bulwark has broad layered pauldrons and cheek armour; Dash has a two-tail scarf and swept helmet fins; Ace has an antenna and targeting eyepiece; Duelist has a split cape behind the existing plume/scarf; Furnace has a plated furnace backpack behind the existing chimney/glowing grate; Twin has opposing armour colours on the chest and limbs. Rookie retains the balanced silhouette. Ronin and Tinker are absent from this checkout's hero data, so no speculative heroes were added.
- Regular enemies get biome paint and merged accessories: meadow leaves, desert wraps, Peaks snow caps/icicles, Magma basalt crests, Neon headset trims, Factory wind-up keys and Sky fins. All twelve biome/remix keys have palettes, including Haunted Meadow. Native foes, seasonal characters, treasure enemies and bosses keep their authored identities.
- King Bopper, Rex, Queen and Omega retain their finisher-portrait features with additional brow/mouth/crown details, ivory snout/armour/claws, antennae/mandibles/wing veins, and visor/grille/finger armour respectively. Each has an inset glowing reactor and two HP-driven crack/spark states. Minis and rematches using those model families inherit the details in their existing palettes.

## Decisions and tuning
- No gameplay, collision, save or network changes. Hero identity comes from the existing `setHeroDef` path on every machine; biome dressing comes from the existing arena/biome look hook. Boss damage reads existing `hp / maxHp`, already available in client enemy snapshots. The shader tolerates half of the snapshot's 1/255 HP quantization step at the thresholds.
- Damage gates use each definition's first two phase fractions, falling back to 0.66/0.33. Reactor and crack self-light is 0.85, tiny spark self-light 1.0. These are steady geometry, without pulses, flashing, particles or extra lights, so reduced motion/flashing needs no additional toggle.
- Biome body colour blends range 0.18–0.48; accent blend 0.55. White eyes, dark features and attack/hit flash colours are preserved. Paint is in vertex attributes because the whole arena shares a biome; multiplying instance colours would also tint the white eye mask. Boss HP is a separate instanced float attribute, uploaded for live slots with `commit`.
- One indexed body draw per enemy type, plus its existing optional outline. Accessories and damage details merge into that body. Geometry is cached per enemy definition/biome and swapped only at arena changes, preserving flash buffers and outline groups. Damage-only triangles are excluded from the hull so hidden sparks do not appear as floating outlines.
- Hero static meshes merge by joint/material; skin uniforms are shared rather than cloned. Including all five wardrobe meshes and existing mechanic gear, counts are Rookie 32, Bulwark 36, Dash 35, Ace 36, Duelist 39, Furnace 40, Twin 38 (limit 40). A model revision refreshes the merged outline/x-ray immediately when identities switch, including equal-part-count switches.

## Files touched
- Owned: `src/game/heroModel.ts`, mesh construction/presentation only in `src/game/enemies.ts`, new `src/render/biomeSkins.ts`, new `tests/models.test.ts`.
- Minimal integration: `src/game/hero.ts` (import + identity call), `src/game/systems/look.ts` (one biome call), `src/render/rigOverlay.ts` (revision tracking/rebuild, three lines), `src/render/outlines.ts` (one group-length change for damage-only triangles).
- This note contains the decision-log paragraph for the lead to copy into shared `PLAN.md`, avoiding a parallel-edit conflict.

## Verification and performance
- `npm run typecheck` and `npx vite build` pass. `tests/models.test.ts`: all 184 checks pass (rig budgets, skins, expressions/animation, identity switching, all biome keys, cache isolation, instancing/outline preservation, boss HP attributes and slot reset). `npm run smoke` passes: all seven heroes, training, rhythm/Pacifist/arcade/ghost modes, Versus, three-player local co-op, and the mortal run/MVP-to-game-over path complete with no runtime errors.
- `npm test` finishes with **68 of 72 test files passing**, including the model tests. Four files fail: `firstten.test.ts` (game-over screen), `lobbyCoop.test.ts` (game-over on both machines), `gauntlet.test.ts` (Hard Omega unlock and selected ascension), and `gameplay.test.ts` (cash-bomb damage). The first three reproduce on baseline `ff7c1c3`; gameplay passes its isolated rerun and the baseline run. This branch therefore does not meet the all-green integration gate; no failing assertions were suppressed or unrelated test files edited. Full log: `shots/models/unit.txt`; isolated checks: `shots/models/recheck-*.txt`.
- `npm run coop` (`COOP_ANGLE=metal COOP_TIMEOUT_MS=120000`) is **not green**: the latest run completes combat through stage 3, revives, phase changes, finisher, route voting, party restart, back-to-lobby and kick, with matched effect counters and no lasting desync, but fails the two assertions that expect `screens.current === 'gameover'` immediately after ending a run. The newer MVP screen opens first. The same two failures reproduce on untouched gameplay baseline `ff7c1c3`. The first run also failed back-to-lobby/kick; those passed on the repeat without any gameplay changes. Logs: `shots/models/coop.txt`, `coop-recheck.txt`, `baseline-coop.txt`.
- Baseline isolation: a temporary detached worktree at `ff7c1c3` reproduced the `firstten.test.ts` game-over expectation, `lobbyCoop.test.ts` game-over expectation and both `gauntlet.test.ts` Hard Omega/ascension assertions. `gameplay.test.ts` initially failed cash-bomb damage (0), then passed in isolation on both this branch and the baseline. These test/game-flow files are outside this lane and were left unchanged. The temporary baseline needed a Vite serving allow-list entry for its symlinked dependencies; gameplay source remained untouched. The worktree was removed after preserving logs in `shots/models/baseline-*.txt`.
- Native GPU benchmark, production HIGH 360p, 1280×720, 20 s after 4 s warm-up: `npm run bench -- --gpu metal --seconds 20 --json shots/models/final-metal.json`. The same command ran on detached baseline `ff7c1c3` before the new build. A first upgraded run measured 2.60 ms CPU/frame; the final run below includes the last material merge.

| Metric | Before | After |
| --- | ---: | ---: |
| CPU/frame average | 2.53 ms | 2.91 ms |
| CPU/frame p95 | 3.33 ms | 3.71 ms |
| game.render average | 0.82 ms | 0.90 ms |
| enemy render phase | 0.168 ms | 0.190 ms |
| frame interval | 16.67 ms | 16.67 ms |
| Enemies average/max | 309 / 395 | 309 / 364 |
| Projectiles average/max | 488 / 514 | 507 / 675 |
| Draw calls average | 190 | 178 |
| Triangles average | 217,238 | 244,031 |

The live scene has random events and population differences, so draw-count differences are not a controlled reduction claim. CPU remains in the same range (2.60–2.91 ms in the two upgraded runs); the scene sustained 60 Hz with over 300 enemies and roughly 500 projectiles. An initial SwiftShader run stalled in software GL (0.5 fps); those timings are not used for the comparison. Bench logs/JSON are under `shots/models/` and are intentionally uncommitted.

## Visual checks and links
- Inspected matched before/after contact sheets and individual captures for every hero, all four bosses and all twelve biome skins. Final captures: `shots/models/before-final/` and `shots/models/after-final/`. Additional after sheets show all hero backs and all four bosses at 20% HP. The isolated gallery uses the game's actual rig/builders/materials, fixed camera and identical lighting for comparisons. Temporary capture harness: `shots/models/capture.mjs` (ignored with the screenshots).
- Hero: `?test&season=off&god&hero=bulwark&cam=0.55&bench&seed=42`; replace hero with `rookie,dash,ace,duelist,furnace,twin`. Add `&look=---30` for wardrobe scarf plus identity gear; `&move=1,0&dashes=1` for animation.
- Biome: `?test&season=off&god&biome=peaks&spawn=bopper:8,shooter:2,charger:1&spawnr=4&frozen&cam=0.55&bench&seed=42`; replace biome with any key in `BIOME_SKINS`. Native enemies deliberately retain their own models.
- Boss: `?test&season=off&god&stage=1&bossnow&nointro&bench&day`; stages 1/2/3/4 show King/Rex/Queen/Omega. Add `&phase=2` or `&phase=3` for damage states. `&remix` checks the corresponding rematch palette.
- In-game `npm run shot` checks cover Furnace/wardrobe gear in Peaks and damaged bosses. This shared builder sometimes captured only the loading screen at 4–6 s; captures were repeated with native Metal and longer waits. The fixed gallery sheets are the close-up visual reference; combat shots verify normal rendering and overlays.

## Unfinished or risky
- The lane is **not integration-green** because the existing full-suite/co-op assertions above still need their owners to resolve them. No model implementation is pending. Cloth is rigid low-poly geometry following the existing body animation; this lane adds no cloth simulation.
- Furnace uses the full 40-part overlay budget with all wardrobe meshes allocated. Future gear additions must merge existing parts or reconsider the overlay uniform budget.
- Native Metal was measured on this shared builder; other GPUs still need release hardware testing. The added steady damage geometry avoids render-time allocations, but increases boss vertices and the regular skin accessories add a small vertex cost.
- Screenshots and benchmark files remain local under ignored `shots/`, per CONTRIBUTING.md.

## Decision-log paragraph for PLAN.md
2026-10-20: Models lane upgrades the seven existing hero rigs with layered armour and distinct identity silhouettes while merging static parts per joint/material to remain within the 40-part overlay limit (32–40 including wardrobe/mechanic gear). Twelve biome/remix palettes and small merged accessories dress regular enemies without new body draw calls or per-frame geometry work. The original four boss families gain portrait-matching details, glowing cores and steady HP-gated cracks/sparks using the existing snapshot HP fraction; no simulation or wire format changes. Native Metal heavy-scene benchmark: CPU 2.53 → 2.91 ms/frame (first upgraded run 2.60), enemy render 0.168 → 0.190 ms, 60 Hz with roughly 310 enemies and 500 projectiles. See notes/lanes/models.md for captures, checks and the small integration hooks.
