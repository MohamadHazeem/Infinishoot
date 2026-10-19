# Lane: anim (character animation and smart camera)

## What players get
- **Hero**: a real walk/run cycle (legs and arm swing, the forward foot lifts, body bobs, leans into movement; backpedalling and strafing swing the legs along the actual move direction), idle breathing and weight shifts, a recoil kick on every shot plus a two-handed aim stance while firing, a dash lunge (lean, trailing leg, arms swept back, stretched along the dash), a hurt flinch in the direction the hit pushed (head whips, arms fly up), a victory dance at stage clear (spin-jump to face the camera, then hop, pump the buster and wave), and a death fall (blown off the feet, flat on the back with one bounce, greyed out). Solo deaths now show the body instead of making the hero vanish.
- **Enemies**: a gait per model (Boppers/King hop with squash on landing, Swarmers flutter, shooters trundle, Rhinos/Rex stomp with a side-to-side roll, Ka-Boomers waddle, jellies jiggle, pylons pulse, Queen/Omega hover and bank, the Reaper glides), lean into movement and tip back under knockback, readable wind-ups (Rhinos and charge attacks rear up and paw, lungers crouch back and quiver, Ka-Boomers shake harder as the fuse burns, shooters rock back, snipers hunker, pylons spin up, bosses rear before every move), lunge/charge dives stretched along the attack, a dizzy wobble while recovering, a squash-and-wobble on every hit, and **corpses flung tumbling** away from the hit (one bounce, then pop). Bosses don't fly: they shake and swell in place under the death explosions.
- **Camera**: zooms out smoothly as the swarm grows or crowds the screen edge (up to x1.3 on top of the wheel zoom), pushes in slightly (x0.94) in calm moments, zooms out a bit during boss fights, frames co-op teammates (moves partway toward the team and zooms out up to x1.6 so they stay in view), **kill-cam on boss kills** (swings to the boss, zooms to x0.6 through the slow motion, then returns; 2.6 s), and **directional shake**: every positional shake also punches the camera toward the impact.
- New setting **DYNAMIC CAMERA** (SETTINGS, default ON): off = the old plain follow camera (no auto zoom, no kill-cam). Co-op framing stays on. The directional kick follows SCREEN SHAKE (0 = none).

## Key numbers (all tunable)
- `camDirTuning` (src/game/animMath.ts): autoMin 0.93, autoMax 1.3; swarm zoom-out starts at 30 enemies in view, full (+0.17) at 150; edge crowding (within 25% of the border, either side) starts at 5, full (+0.12) at 28; calm = fewer than 6 in view and no boss (x0.94); boss +0.08; zoom out at rate 1.1/s, back in at 0.3/s; co-op bias 0.5, margin 0.8, max x1.6; kill-cam 2.6 s at x0.6. The total zoom is clamped to [0.5, cameraTuning.zoomMax 2.2], so the co-op interest radius still covers it. Counting uses the wheel zoom only (no feedback loop).
- `heroAnimTuning` (heroModel.ts): 1.45 + 1.0 x speed steps per second, leg swing 0.95 rad, lean 0.2 rad, dash lean 0.5, dash stretch 35%, flinch 0.5 rad.
- `enemyAnimTuning` (enemyAnim.ts): lean max 0.45 rad; corpses fling at 7 m/s and 7 m/s up (heavy/elite x0.55), gravity 30, tumble 13 rad/s, life 0.75 s (heavy 1.0 s), boss 1.5 s; pool of 160 corpses (new ones are skipped when full).
- Boss-kill slow motion (existing host slowMoT, 35%) now also slows cosmetic animation time on that machine.
- The debug panel has a "Smart camera & animation" folder under Camera.

## How it works / netcode
- Everything is cosmetic. Hero and enemy poses are derived in render from state every machine already has (velocity, facing, state, flash, sq, timers); enemy velocity comes from the drawn motion, so hosts and clients behave the same.
- Corpses: `killEnemy` calls `vfx.corpse(...)` (new `'c'` effects-bus event: x, z, y, def id, scale, facing, push dir; values rounded to 0.01). Every machine flings the body locally (`Game.onCorpse` -> `Enemies.fling`), and boss corpses start the kill-cam, so clients get both. Self-detonating Ka-Boomers leave no corpse. The push direction is the enemy's knockback velocity, else away from the killer.
- Corpses render into the existing per-type enemy InstancedMeshes after the live enemies (no new draw calls, no allocations per frame).
- Camera inputs are fed each frame by `Game.cameraDirector` (src/game/systems/anim.ts) into `CameraRig` (`auto`, `frameTeam`, `killCam`, `resetDirector`); title and stage transitions reset it.

## Files
- New: src/game/animMath.ts (pure maths), src/game/enemyAnim.ts (enemy pose + corpse pool), src/game/systems/anim.ts (camera director, onCorpse), tests/anim.test.ts.
- Owned, rewritten parts: src/game/heroModel.ts (animateHero/HeroPose; poseVictory removed, folded in), src/game/cameraRig.ts, src/game/enemies.ts (render: pose and corpses; `Enemy.anim`, `Enemies.fling`, `Enemies.batch`), src/game/systems/render.ts (calls cameraDirector, slow-mo anim time).
- Small additive edits in shared files: game.ts (import, 2 method fields, `corpse` in the Vfx targets), vfx.ts ('c' event, `corpse()`, directional kick in playShake), systems/statuses.ts (corpse in killEnemy), player.ts (render builds the HeroPose; dead heroes stay visible and lie down instead of the old sideways rotation), settings.ts (`dynamicCamera`), ui/screens.ts (DYNAMIC CAMERA toggle), ui/debugPanel.ts (tuning folder), dev/testLinks.ts (options below).

## New test-link options (src/dev/testLinks.ts)
`&move=1,0` hold a move direction, `&aim=0,1` hold an aim direction (fires), `&circle` walk in circles, `&dashes=1` dash every second, `&cam=0.6` camera zoom (below 1 = close-up), `&swarm=200` or `&swarm=150:zippy` spawn a ring of enemies, `&frozen` stop the spawned enemies moving, `&killboss=3` kill the boss after 3 s (kill-cam), `&clear=3` clear the stage after 3 s (victory pose), `&hurt=1.5` a small hit every 1.5 s (flinch), `&die=3` die after 3 s (death fall).

## Checks
- `npm run typecheck`, `npm test` (35 new checks in anim.test.ts), `npm run smoke` all pass.
- Screenshots/frame sheets checked: walk, strafe with aim stance, dash, death lying pose, victory pose, corpses flying, Rhinos rearing with charge lines, auto zoom (camera height 21.3 -> 27.3 with 250 enemies around), kill-cam zoom on a boss kill.

## Unfinished / risky
- Co-op framing and the client side of corpses/kill-cam are covered by unit tests and code reading only; not tested with two real peers.
- The solo hero now lies on the ground after death instead of vanishing (the K.O. screen covers it after 1.2 s). If the old vanish is preferred, set `rig.root.visible = this.showWhenDead` again after `deathT > 0.8` in Player.render.
- Directional kicks add to the existing camera kick spring; heavy AoE builds with many nearby `vfx.shake` calls kick more than before (still scaled by SCREEN SHAKE, capped at 6 per event).
- The debug panel and settings toggle touch shared UI files (one line each in screens.ts) and may need a trivial merge with other lanes adding toggles.

## Decision-log paragraph for PLAN.md
- 2026-10-19: Animation and camera pass (anim lane). The hero animates from a per-frame HeroPose (walk/run cycle along the real move direction, breathing, recoil and aim stance, dash lunge with stretch, directional hurt flinch, victory spin-jump, death fall onto the back; downed heroes lie on their back instead of being rotated sideways). Enemies get a gait per model, lean and knockback tilt, wind-up poses that sell telegraphs, hit wobble and flung tumbling corpses drawn into the existing instanced batches; corpses reach clients as one 'c' effects-bus event per kill, which also triggers the boss kill-cam. The camera auto-zooms (x0.94 calm to x1.3 swarmed, bounded under the 2.2 wheel cap so the co-op interest radius still holds), frames co-op teammates (up to x1.6), plays a 2.6 s kill-cam on boss kills and punches toward impacts; SETTINGS > DYNAMIC CAMERA turns auto zoom and the kill-cam off.
