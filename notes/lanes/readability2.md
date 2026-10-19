# readability2 — readable chaos

## What players get

- One visual-noise governor per scene, shared by direct cosmetic emitters and replayed host effects. Crowds reduce cubes, sparks, smoke/dust, debris (including fractured props), impact stars/rings, explosion lights and automatic damage numbers. Gameplay, collision records and the effects wire are untouched.
- Enemy bullets have a separate late draw pass: reserved magenta cores, thick Sweetie-16 ink rims, no additive white halos, no fog/depth occlusion and a restrained 2 Hz size pulse (off with reduced motion). Spawn/expiry animation no longer shrinks dangerous shots to nearly nothing.
- Enemy (including mirror beams), biome-foe, boss, Titan, duel and collapsing-ground warnings draw over weather and friendly effects. Shrinking effect rings have reserved capacity and bypass friendly fading. Ground-zone outlines stay bright; filled discs stay translucent. Wide charge lanes have 90% edges and 12% interiors so intersecting warnings do not paint over heroes.
- Friendly star/ring shaders fade spatially inside 3.2 m of the local hero, including the edges of large off-centre explosions. Smoke, sparks, cubes, bullet tails and explosion lights also retreat near the hero. A steady ink-rimmed local-player ring survives transparent effects. Pickup cores (including XP) draw over weather/fog and behind warnings.
- DAMAGE NUMBERS defaults to AUTO. It clusters nearby matching hits, suppresses ordinary hits at high density and budgets new hit labels. Crits/large hits remain eligible; healing, damage to players and noncombat text messages remain visible. Combat status labels (such as SHIELD BROKEN) share the budget so they cannot bypass thinning. Explicit ALL/MINE/OFF values from old settings survive; missing/new settings get AUTO. No profile-save schema change.
- Shake plus recoil has a shared displacement ceiling, and stacked HUD flashes share a cooldown and intensity ceiling. Weather flashes and anime impact frames are also capped. In dense combat, large centre banners become smaller and move to the upper right; CSS is injected by this lane.

## Tuning / decisions

All new budget knobs are exported as `noiseTuning`, exposed in debug > Readable chaos.

- Pressure: `(enemies + 0.28 * bullets + 18 * (heroes - 1) - 70) / 190`, clamped 0..1; attacks immediately, releases at 0.4/s. Uses live pooled counts conservatively (includes offscreen entities); no additional enemy/projectile scan.
- Calm → crowded admission rates per second: cubes/sparks/extra bullet trails 900 → 180, smoke/dust 90 → 18, debris 100 → 24, impacts 100 → 24, lights 30 → 6, AUTO numbers 70 → 14. Token buckets carry at most 0.2 s of burst credit, at least one event; dt refill clamps at 0.1 s to prevent resume bursts. Quality multipliers apply before admission.
- Friendly opacity away from hero: 1 → 0.55; at the hero: another x0.18. Cubes shrink by square root of this factor instead of enabling costly cube transparency. The danger layer never consumes those budgets.
- AUTO merge radius 0.35 → 1.8 m and window 0.14 → 0.24 s. Above 0.75 pressure only crits or hits >=1.5x the recent exponential average qualify. Average follows each hit at 4%; merged labels retain their original lifetime.
- Camera offset ceiling 0.32 → 0.14 m; kick velocity capped at 12. Zero shake setting and reduced motion suppress residual offsets too.
- HUD flash maximum 0.20 → 0.08, requests at least 0.55 s apart; reduced flashing lowers it further. Anime impact amount and lightning brightness use the same ceiling (anime impacts off in reduced motion).
- Transparent render orders: pickups 80, local ring rim/fill 89/90, danger fills 99, warnings 100, enemy bullet rim/core 110/111. Existing opaque hero x-ray remains intact. Warning buffers now scale with the existing 2048-enemy presentation capacity (4096 lines/rings, 2048 fills); the former 64-line pool could overflow under mass charges. Live-slot-only uploads remain. Added meshes: two enemy-bullet pools, two local-ring meshes, one reserved shrinking-ring pool (drawn only when nonempty). Reuse matrices and typed buffers; no new frame-loop allocations.
- Scope decision: small hooks in additional danger renderers, pickups, lighting, weather and Juice are necessary to cover the requested visibility and flash caps. No netHost/netClient/codec changes and no gameplay branches based on pressure.

## Audit and test links

Screenshots are local ignored artifacts under `shots/`, not committed. Viewed PNGs, not just process exit codes.

- Before: `shots/readability2-before.png`, `?test&bench&god&seed=42&swarm=300&bullets=500&boom&night&rain&anime&event=fog&mate&teamult=2&mech&nocine`. Bullet halos turn near-white, smoke/fog and additive rings hide ground details, and numbers + full-size centre banners obscure the hero/mech. Enemy bullets and telegraphs share depth with ordinary world meshes.
- Iteration: `shots/readability2-after.png` exposed the explosion-light bypass; the rings were thinned but their full-strength lights still washed out the floor. Added a separate light budget and near-hero attenuation. The first 4-second capture caught startup rather than play under machine contention, so later captures wait 12 seconds.
- Final chaos: `shots/readability2-chaos.png`, `?test&bench&god&seed=42&swarm=300&hold=300&bullets=500&boom&night&rain&anime&event=fog&mate&heroes=4&teamultloop=2&mech&nocine&quality=high`.
- Eclipse/fog/eight rigs: `shots/readability2-eclipse.png`, `?test&bench&god&seed=42&swarm=300&bullets=500&boom&night&rain&anime&wev=eclipse&wevnow&wevt=8&event=fog&heroes=8&quality=high&spawn=sniper:4,charger:8&frozen&nocine`.
- Low quality + reduced motion: `shots/readability2-calm.png`, `?test&bench&god&seed=42&stage=3&swarm=300&bullets=500&boom&night&rain&event=fog&heroes=4&quality=low&calm&spawn=sniper:6,charger:8&nocine`.
- The eight-hero audit also caught solid charge-line intersections obscuring bodies. Replaced them with strong boundaries and a faint interior before the final capture.
- New test options: `heroes=1..8` adds real stand-in rigs/loadouts; `numbers=auto|all|mine|off` chooses the display mode. Existing `mate` and `teamultloop` still work. Eight rigs stress local rendering; they do not expand the game's online player limit.

## Validation

- `npm run typecheck`: pass. `npx vite build`: pass (existing large-bundle warning only).
- `npm test`: all 57 files passed. The focused readability2 test also passed after extending warning buffers: 26 checks covering rate envelopes, frame-rate independence, per-scene isolation, AUTO clustering/filters, shake/flash caps, 500 bullets under budget exhaustion, 300 simultaneous charge warnings, reserved shrinking rings and intact effects-bus replay.
- `npm run smoke`: pass across seven heroes, modes, training, local co-op and online loopback checks; no runtime errors.
- `npm run coop`: stock 30 s browser waits timed out during startup under load. An ignored copy of the same test with 180 s page/screenshot waits and 90 s join/start waits reached the broker; one run failed to join, and an AUTO-quality retry exchanged 246 snapshots but failed a repeated guest-position check (~4.9 m). A final run using LOW from startup (`infinishoot.settings.v1` in the isolated browser context), 640x360 and extended waits **passed**, exchanged 255 snapshots (725 B average, 2105 B max), replayed particles/rings/numbers/zones and hit-stop, and checked the jump pad. Both host/client screenshots in `shots/readability2-coop-low/` were viewed. Log: `/tmp/readability2-coop-last.log`.
- Co-op coverage limit: large browser/GL stalls consumed the script's wall-clock window, so only its early scenarios executed. The unmodified default-timeout command and the full boss/revive/ultimate browser sequence still need a quiet-machine rerun. The full 57-file unit suite includes the host/client loopback scenarios, and the new test explicitly verifies intact effects replay under different local budgets. No transport or snapshot code was changed.
- `npm run bench` ran before and after, HIGH heavy preset (500 bullets). Before: 47 frames, 147 average draws, 1131 average particles, simulation 0.56 ms/step and render preparation 1.30 ms/frame. First after run: 6 frames, 122 draws, 41 particles, simulation 0.85 ms/step and render preparation 2.23 ms/frame. Final 12-second run was dominated by contention: only 2 rendered frames, 124 draws, 41 particles, 0.79 ms simulation + 2.56 ms render preparation; GL submission stalled for seconds. These timings cannot establish a 60-fps guarantee or a reliable whole-game before/after comparison.
- To isolate the changed buffer work from GL stalls, an ignored Node/jsdom microbenchmark alternated original pre-lane and current bullet/particle render code in one process for 1500 frames each: 500 mixed-team bullets and a 1200-particle burst. Median CPU buffer-preparation cost fell from 0.1444 to 0.0846 ms/frame (original 1200 live cubes vs governed 36 initial cubes). This measures these pools only, not total gameplay or GPU time. Raw local results: `shots/readability2-{before,after,final}-bench.json` and `/tmp/readability2-cpu.log`.
- The machine reached load averages of 130–156 during validation. Ordinary `npm run shot` captures initially passed; later captures timed out in Chromium's screenshot wait even at LOW. Final 960x540 captures use an ignored copy of `scripts/shot.mjs` under `node_modules/.cache/` with 180 s navigation/screenshot deadlines and a wait for `window.game.hero`; the scene, rendering and assertions are unchanged. Repository test scripts were not modified.

## Files touched

- New: `src/render/noiseGovernor.ts`, `src/game/systems/readability2.ts`, `tests/readability2.test.ts`, this note.
- Emission/render hooks: `src/game/particles.ts`, `fx.ts`, `debris.ts`, `bullets.ts`, `pickups.ts`, `ambience.ts`, `juice.ts`; `src/render/shatter.ts`.
- Danger hooks: `src/game/enemies.ts`, `biomeFoeView.ts`, `bossField.ts`, `bossDuel.ts`, `titan.ts`; `src/render/worldEventView.ts`.
- Small integration hooks: `src/game/systems/render.ts`, `look.ts`, `src/game/settings.ts`, `src/ui/hud.ts`, `screens.ts`, `damageNumbers.ts`, `debugPanel.ts`, `src/dev/testLinks.ts`.
- Existing default assertion updated: `tests/hudLane.test.ts` now expects AUTO for old settings without the field.

## Limits / integration risks

- Full default-timeout browser co-op coverage remains unverified under normal frame pacing (see validation above).
- Headless SwiftShader measurements are CPU evidence, not proof of 60 fps on a real GPU; the shared overnight machine is heavily contended. Hardware/touch play-testing remains.
- Existing weapon-specific meshes and trails outside these core emitters retain their own caps; the critical danger/pickup/ring layers draw above them. Huge mech rigs retain their authored size.
- Future danger renderers should call `dangerLayer`; future friendly emitters should share `noiseFor(scene)`. Do not apply budget decisions before recording `game.vfx` events.
- Depth-free pickup/warning/bullet cores deliberately remain visible through cover. Fullscreen cinematics and menus retain their existing behavior; this lane handles active combat.
- The top HUD still has finite space at extreme UI scale/eight teammate panels. The compact upper-right banner helps centre visibility but does not redesign the team HUD.

## Decision log for the integrating lead

2026-10-19: Readability2 adds a scene-local token budget (crowded: 180 particles, 18 puffs, 24 debris, 24 impacts, 6 explosion lights and 14 AUTO labels/s), spatial friendly-effect fading around the local hero, reserved late danger layers and a clear local ring/pickups. Enemy bullets keep dark-rimmed magenta cores above weather with no white halo; warning rings never spend friendly budgets. AUTO damage numbers cluster up to 1.8 m and show only crits/large hits above 75% pressure. Shake caps at 0.14 m and flashes at 0.08 in crowds. Existing settings choices and co-op effects records survive unchanged.
