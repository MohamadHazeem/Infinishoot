# Lane: readability (graphics readability fixes)

## What players get
- **You can always find your hero.** When enemies, a boss or cover stand in front of a hero, the hidden part shows through as a dark-rimmed two-tone pixel checker in the player colour (solo: cyan). A bright unlit ground ring in the player colour, with a dark border and a notch pointing where you aim, sits under every hero and reads on every biome and at night. Every co-op hero gets both in their own colour on every machine.
- **Crowds read as many bodies, not one blob.** Enemies push apart harder, deep overlaps are corrected outright, enemies stuck in a jam stop shoving inward, and nothing stands on top of a hero any more (enemies still reach contact range, so contact damage is unchanged).
- **Night stages: dark enemies stay visible.** At night enemies keep a floor of their own colour and get a hard moonlit rim, and plain outlines lift from near-black toward a moonlit blue-grey, so dark veterans read on dark ground in every biome.
- **Explosive builds no longer carpet the floor.** Scorch scars live half as long (10 s -> 5 s) at 0.55 instead of 0.8 opacity, every scar fades out instead of only shrinking, frost and goo patches live 0.6x as long; craters from bombs, slams and boss deaths keep their full life.
- **Cheaper co-op rendering.** A hero's outline was one hull mesh per rig part (~26 draw calls per hero); it is now one merged mesh. With the x-ray and ring a hero costs 4 overlay draws instead of ~26.

## How it works
- `src/render/rigOverlay.ts` (`RigOverlay`, one per hero rig, created lazily by `updateHeroMarkers` in `src/game/systems/readability.ts`, called from the look pass where `outlineRig` used to be):
  - All solid rig parts are merged into one geometry with a per-vertex `partIndex`. A `mat4 uParts[40]` uniform holds each part's `matrixWorld`, copied in `onBeforeRender` (after three.js updates world matrices), so the merged mesh follows the procedural animation exactly. Hidden parts get a zero matrix and are sent off screen.
  - Outline hull: the old inverted-hull shader (clip-space push, same `outlineTuning`/uniforms), parts under `minPartRadius` left out as before. Follows the quality toggle (`outlineState.on`, LOW has no outlines).
  - X-ray: the same merged geometry drawn with `depthFunc: GreaterDepth`, no depth write, pushed 0.25 m toward the camera (`xrayBias`, so the ground and the ring under the feet never trigger it). Rim pass (2 px, dark) then checker fill pass. Draw order in the opaque pass: everything else (renderOrder 0) -> x-ray rim (49) -> x-ray fill (50) -> hero parts (51, set on the rig's meshes) -> outline hull (52). Because hero parts draw after the x-ray, a hero never x-rays through itself; it stays on at every quality.
  - Ring: a 32 px pixel-art ring texture on a plane, `createRetroMaterial({ map, alphaTest, unlit: 0.9 })`, child of the rig root (its notch turns with the aim). Hidden while downed, on the title screen and when the hero has left.
  - A rig that gains or loses meshes (new hero bodies, gear) is re-merged (checked every 32 frames).
- `src/game/crowd.ts` (`crowdTuning`, `keepOffHeroes`), used by the separation block in `Enemies.update` (src/game/enemies.ts): separation 7 -> 12 m/s per unit overlap, hard limit at 0.72 of the radii sum (half fixed per step, applied after integration), wanted speed divided by `1 + 2 * summed overlap`, and a positional push out to 0.8 x (enemy + hero radius) from every living hero. Bosses, the Reaper, hidden PvP stand-ins, attack moves (`rigid`) and hops skip the hero gap; bosses and the Reaper skip all of it as before.
- Night: `retroGlobals.uNightRim` (0.55), `uNightRimColor` (#94b0c2), `uNightLift` (0.5) in src/render/retroMaterial.ts, applied only to instance-flash meshes (enemies, barrels) and only when `uNight` > 0, so day stages are unchanged. `outlineTuning.nightColor` / `night` (0.75) blend plain outlines at night (elite outline colours unchanged).
- Scars: `scarTuning` and `scarLook(color)` / `scarFade(age, life)` in src/game/scars.ts; per-instance opacity through a `scarAlpha` instanced attribute (MeshBasicMaterial `onBeforeCompile`). Clients run the same `add()` from the effects bus, so they match the host.

## Tuning knobs (debug panel > Readability)
- Hero marker (`heroMarkerTuning`): xray on/off, rim px 2, light tone 0.55 (towards white), dark tone 0.35, depth bias 0.25 m, ring on/off, ring radius 0.95 m, ring unlit 0.9, solo colour #73eff7.
- Crowd spacing (`crowdTuning`): push 12, jam 2, hardGap 0.72, hardFix 0.5, heroGap 0.8.
- Night: enemy rim 0.55, colour floor 0.5, outline lift 0.75.
- Scars (`scarTuning`): scorch life x0.5 / opacity 0.55, crater x1 / 0.8, frost+goo x0.6 / 0.65, fade over the last 45%.

## Numbers
- Draw calls (renderer.info, headless Chromium, `?test&quality=high&god&seed=42&frozen`, extra heroes added with `game.makeHero` + `game.setHeroes`): solo 98 -> 82; 4 heroes 268 -> 178 (per hero ~57 -> ~32: 29 rig parts + 4 overlay draws, was 29 parts + 26 hulls). Triangles rise slightly because the x-ray passes draw the merged hero twice more (4-hero scene 55.8k -> 59.5k; the x-ray fragments are discarded by the depth test unless something hides the hero).
- Crowd (unit test, 120 swarmers converging on a hero for 8 s; old tuning vs new): enemies centred on the hero 4 -> 0, overlapping pairs ~630 -> ~300, mean overlap 27% -> 14%, deep overlaps (> 40%) ~180 -> ~2, enemies in contact range 18 -> 8 (contact damage takes the worst single enemy, so damage is unchanged).
- Enemy update cost (Node micro-bench, 270 mixed enemies, 1200 steps, median of 6 interleaved runs, on a machine with load ~25 on 4 cores): old tuning 1.12 ms, new 0.93 ms per step. Fewer overlaps mean fewer neighbour pushes, so it is not slower. `npm run bench` ran too but the box was so loaded (sim.enemies 2.3-3.3 ms in both builds, 0.085 ms on the perf lane's Mac) that its numbers only show "same ballpark"; the bench's draw calls were 117 (base) vs 114 (this lane) with one hero.

## Test links and how it was verified (screenshots looked at)
- `?test&swarm&time=150&god&quality=high` (task's swarm link): before, the hero is lost inside ~100 enemies; after, enemies keep off the hero and the x-ray checker plus the head show where it is. Also at `&quality=low` (outlines off, x-ray still on).
- `?test&quality=high&god&seed=42&bench&swarm=150&time=150` with the old crowd tuning and no marker vs the new defaults in the same seed: old is one blob with no hero visible, new shows rings of separate bodies and the hero.
- `?test&stage=3&bossnow&nointro&god&night&quality=high` (task's night link) and A/B renders of the same frozen frame with the night rim/lift/outline off vs on for stages 1 (meadow), 2 (dunes), 3 (peaks) and 4 (magma) with `&night&time=100&bench&spawn=v_bopper:4,v_shooter:3,v_chonk:2,v_swarmer:6,v_charger:2`: dark veterans get a light rim and lifted body on every biome; meadow and magma gain the most.
- Co-op: 3 stand-in heroes added in the page: rings in each player colour with aim notches, a hero behind enemies shows its x-ray in its own colour (grey for P4).
- Scars: a scripted explosive build (a scorch every 0.15 s, a crater every 3 s) with old vs new `scarTuning`: the old floor is a solid dark carpet, the new one shows ground between fading marks, craters still stand out.
- Title screen: no ring, no artefacts.
- `npm run typecheck`, `npm test` (tests/readability.test.ts: crowd metrics old vs new, hero gap keeps contact range, scar life/fade, rig merge counts and part indices, overlay adds exactly 4 meshes, parts draw after the x-ray, ring hides when downed), `npm run smoke` all pass.

## Files
- New: src/game/crowd.ts, src/game/systems/readability.ts, src/render/rigOverlay.ts, src/ui/debugReadability.ts, tests/readability.test.ts, notes/lanes/readability.md.
- Shared hot file: src/game/enemies.ts (import line; in the separation block a `hx/hz/jam` accumulation, the hard-overlap fix, the jam slow-down, `crowdTuning.push` instead of the literal 7, one `keepOffHeroes` call after integration).
- Other shared files: src/game/systems/look.ts (calls `updateHeroMarkers(this)` instead of `outlineRig` per hero), src/render/outlines.ts (exports `outlineUniforms`/`outlineState`, night outline colour, per-part `outlineRig` removed), src/render/retroMaterial.ts (3 night uniforms and the rim/floor block for instance-flash meshes), src/game/scars.ts (scarTuning, per-instance fade), src/ui/debugPanel.ts (one import, one call).

## Unfinished / risky
- The x-ray relies on renderOrder: anything opaque that must hide the hero has to draw before renderOrder 49 (true for all current scene content). An opaque mesh given renderOrder >= 51 by another lane would not trigger it.
- Hero rig parts now draw at renderOrder 51 (after other opaque things). Depth testing makes this invisible for opaque content; only draw order changed.
- The merged rig supports 40 parts (uniform budget, 29 used today). Parts beyond 40 would lose their outline and x-ray silently. A content lane adding big new hero bodies should stay under that or raise `MAX_RIG_PARTS` (each part costs 4 vertex uniform vectors; WebGL2 guarantees 256).
- The x-ray also triggers through tall grass tufts or props right in front of the hero's legs (by design, it is an always-on marker); the 0.25 m bias keeps the ground and the ring out of it.
- The hero gap is a gameplay change: enemies no longer overlap the hero's centre and the jam slows packed crowds pressing inward. Contact damage still lands (enemy centres stay inside contact range), but crowd pressure on a hero standing still is a little lower. Not balance-tested beyond the smoke test's bot runs.
- Enemy blob shadows still vanish on dark night ground (a shadow can't be lighter than the ground); the rim/outline is what keeps enemies readable.
- `npm run bench` numbers on this machine were dominated by load from other lanes; the CPU comparison above is a Node micro-benchmark. Not measured on a real iGPU.
- Fonts 403 in headless shots from this worktree (node_modules is a symlink outside Vite's allow list); screenshots used fallback fonts in the HUD. Pre-existing setup noise, not a game issue.

## Decision-log paragraph for PLAN.md
- 2026-10-19: Readability pass (readability lane, notes/lanes/readability.md). Heroes can't get lost any more: each hero's rig parts are merged into one mesh whose vertices pick their part's matrix from a uniform array, which drives the outline (1 draw instead of ~26 per hero: 4-player co-op went from 268 to 178 draw calls) and an x-ray drawn with an inverted depth test before the hero, so only the hidden part shows, as a dark-rimmed two-tone checker in the player colour; an unlit pixel ring with an aim notch sits under every hero. Crowds keep their bodies apart (separation 7 -> 12 m/s, hard overlap limit at 72% of the radii sum, jammed enemies stop shoving, a personal-space push keeps enemy centres at 0.8x contact distance from heroes so contact damage still lands): in a 120-swarmer test mean overlap fell from 27% to 14% and the enemy step got no slower. Night stages give enemies a colour floor, a hard moonlit rim and moonlit outlines. Scorch scars live 5 s instead of 10 at 0.55 opacity and every scar fades out; craters keep their life.
