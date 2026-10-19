# gfx3 — graphics extras

## What players get

- Optional **DYNAMIC SHADOWS** under SETTINGS > VIDEO (default OFF; English and Arabic). One real directional depth map for hero bodies, bosses/mini-bosses/Titan parts, merged large scenery, crates and pillars. Normal enemies retain their blob shadows. Only the HIGH render rung enables the pass, including AUTO if it reaches HIGH.
- Five weapon-family muzzle silhouettes using the existing hero flash meshes: ballistic cone, broad scatter star, long cyan energy diamond, compact orange explosive cone and electric cross. Reduced screen effects/flashing and LOW make them smaller.
- Explosion bursts gain a ground ring, capped fallback debris and a narrower rising smoke column. Existing debris pools, sprite pools and scene noise budgets remain in charge.
- Cyan level-up columns, a gold/item-colour evolution column with three contracting airborne rings, and chest bursts using the actual reward's canonical rarity colour. Track/fork evolution picks now also use the existing evolution fanfare.
- Material impacts: thin gold/cyan metal/shield sparks, larger green/body-colour slime droplets that flatten into splats at the floor, and flattened stone chips with heavier gravity.
- `src/render/cinematicCamera.ts`: independent keyframe player for the story lane. It does not take over the regular combat camera.

## Decisions and tuning

- Shadows are opt-in to protect lower-end machines. `shadowTuning` in `src/render/shadows.ts`: 512², 42 m span, light 45 m away, 30 Hz map refresh, 0.72 sun attenuation, 0.0012 depth bias, 0.035 m normal bias, at most 12 merged static prop batches. Four depth taps and a 7% border fade soften map edges. Ambient light stays intact. Caster geometry uses native Three.js depth rendering; retro materials sample the map's depth texture. The map follows the local hero, rounded to its texel grid. Dynamic casters keep the existing live transforms/instance matrices.
- No gameplay or save format changes. The new boolean receives its default through the existing settings merge. No new runtime packages, generated media, audio calls or remote service integrations.
- Rewards use a bounded 160-slot beam pool (one extra draw only when nonempty), sharing the existing FX update and instance uploads. `gfx3Tuning`: 0.28 brightness; normal beam 4 m / 0.7 s; evolution 6 m / 1.1 s. LOW/POTATO remove columns; reduced motion hides them even if already alive. Ground reward cues remain. Instant initial visibility keeps the level-up column visible when the card menu pauses simulation.
- Existing `BurstOptions` events carry rare `flourish` and compact template extras for `shape`; there is no new event kind or snapshot field. Material bursts otherwise use existing fields. The binary round-trip test checks reward identity and slime silhouette. Clients reconstruct their own cosmetic pools, colours and shadows.
- Explosion smoke retains its original requested particle count: every third puff rises as a column; opacity 0.4 for column puffs / 0.6 for the outer puffs. If no debris was requested, at most three small pieces are added. All go through the existing local admission budget.
- Settings master, OS reduced motion and local scene pressure are read through the existing noise governor; dangerous warning rings retain their reserved budget. Shrinking cosmetic evolution rings consume the friendly budget.
- Debug panel: **Sun shadows & reward VFX** exposes shadow strength/bias/refresh and beam tuning.

## Cinematic camera API

```ts
import { CinematicCamera } from '../render/cinematicCamera';
const cine = new CinematicCamera(game.cam.camera);
cine.play([
  { time: 0, position: [8, 6, 10], target: [0, 1, 0], fov: 45 },
  { time: 4, position: [-6, 4, 8], target: [0, 1, 0], fov: 40 },
]);
// After the regular CameraRig's update, in local presentation:
const finished = cine.update(frameDt, reduceMotion());
// Explicit hand-back (or skip): restores the captured position, orientation and FOV.
cine.stop();
```

Times begin at zero and strictly increase. Smoothstep interpolates position, look target and FOV without allocating in update/seek. `cut: true` on the arriving keyframe makes a hard cut. Reduced motion holds static compositions and cuts at keys. `seek(seconds)` holds an exact pose; completion holds the last frame until `stop()` or another `play()`. `stop(false)` leaves the final pose for a caller that owns its own handoff. Tracks are copied and validated on play. This is an API for the story lane to integrate with its intro/ending timing; existing cinematic systems are unchanged.

## Test links and captures

Use `season=off&day&dry` for clean comparisons. Shadow flag is unsaved: `shadows=1` / `shadows=0`. The flag only applies to gameplay links (the existing `screen=settings` route returns before gameplay fixture hooks).

- `?test&season=off&god&seed=42&quality=high&stage=1&day&dry&bench&cam=0.8&shadows=1`
- Add `gfx3=level|evolution|chest|explosion|hits`; `rarity=common|uncommon|rare|legendary` selects chest fixture colour. These emit on an interval for captures only.
- Add `gfx3camera=2.5` to hold the supplied five-second camera demo at 2.5 s.
- `?test&season=off&god&quality=high&bossnow&nointro&shadows=1&bench` for a real boss caster.
- `?test&screen=settings&settingstab=0&lang=ar` (also `lang=en`).
- `quality=low` and `reduceeffects` exercise effect suppression.

Captured and inspected under ignored `shots/`: `gfx3-before.png` (original HEAD from an isolated archive), `gfx3-shadows-on.png`, `gfx3-shadow-first.png`, `gfx3-boss-shadows-on.png` / `off.png`, `gfx3-evolution.png`, `gfx3-explosion.png`, `gfx3-chest.png`, `gfx3-hits.png`, `gfx3-low.png`, `gfx3-reduced.png`, `gfx3-camera.png`, `gfx3-settings-en.png`, `gfx3-settings-ar.png`, and `gfx3-muzzle-buster|scatter|laser|grenade.png`. Flat spread/electric muzzle stars were adjusted to face the camera and sit clear of the cannon after visual inspection. The first 4 s cold-start capture caught the loading screen; final cold captures use 12 s, warm-server captures 4 s. One concurrent baseline server invalidated Vite's shared optimize cache; the final captures use one persistent server and have no page/shader errors.

## Performance and validation

Measured with `npm run bench -- --gpu metal --seconds 15 --warmup 8`, production 1280×720, heavy scene (200 added enemies, held spinners/bursters, 500 projectiles, night/rain/explosions). Other overnight lanes shared the machine, so treat small differences as noise:

| Build | CPU/frame avg | CPU p95 | Draws avg | Enemies avg | Bullets avg |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before lane | 3.09 ms | 3.75 ms | 177 | 315 | 493 |
| Extras, shadows OFF | 2.60 ms | 3.41 ms | 181 | 315 | 510 |
| Extras, shadows ON | 2.54 ms | 3.18 ms | 197 | 316 | 516 |

All three held a measured 16.67 ms frame interval. Shadow selection/follow phase is about 0.002 ms/frame when enabled; the optional map adds approximately 16 average draw calls in this scenario. No claim that the lane makes the game faster: the CPU spread is normal shared-machine variance. Raw benchmark JSON and browser verification script/logs are ignored in `shots/` / `/tmp/gfx3-*`. SwiftShader was also run as the initial baseline; Metal gives the useful hardware comparison.

Live browser assertions: map size 512, boss batch casts, eight visible-scene prop batches selected, all ordinary enemy batches exclude themselves, OFF and LOW immediately disable the renderer pass, no page or shader errors.

- `npm run typecheck` and `npx vite build`: passed (existing large-chunk advisory only).
- `npm run coop -- --angle metal`: full 80 s scenario and party phase passed. 1,540 snapshots, 2,008 B average / 13,623 B maximum, none over 16 KB; sent/received skill counts matched. The initial run was invalidated by development hot reload; a clean run completed after the one-line party harness repair.
- `tests/gfx3.test.ts` covers keyframe interpolation/cuts/clamps/validation/restoration, reduced motion, shadow gating/texel snapping/controller cleanup, weapon families/shared geometry, material motion profiles, binary effect metadata, pool limits/expiry and live LOW/reduced-motion suppression.
- `npm run smoke`: passed all seven hero runs, training, mode checks, Versus, local co-op, and mortal-run/game-over/history assertions, with no runtime errors.
- The first unit run hit an intermittent late-join pick-count assertion (7 picks versus the required 8); an isolated rerun and the final full run both passed that check with 9. No assertion was weakened. `npm test`: all 72 test files passed in the final full run.

## Files / merge surface

- Owned/new: `src/render/shadows.ts`, `src/render/cinematicCamera.ts`, `src/game/systems/gfx3.ts`, `src/dev/gfx3Links.ts`, `tests/gfx3.test.ts`, this note.
- Owned additions: `src/game/fx.ts`, `src/game/particles.ts`.
- Small integration edits: `src/render/retroMaterial.ts` (shadow uniforms/chunk/sun multiplier), `src/render/renderer.ts` (one bridge call), `src/game/enemies.ts` and `interactives.ts` (caster flags), `src/game/systems/render.ts` (two presentation hooks), `combat.ts` (material burst selection), `levelUps.ts` (reward tags/track evolution hook), `statuses.ts` (rarity-coloured chest burst), `settings.ts`, `ui/settingsScreen.ts`, `ui/debugPanel.ts`, `i18n/en.ts`, `i18n/ar.ts`, `dev/testLinks.ts`, and the required additive `PLAN.md` decision log.
- One independent harness repair: `scripts/coop-test.mjs` party phase used `p.evaluate` on `{ name, page, errors }`; corrected to `p.page.evaluate` so the required full co-op run can reach its assertions.

## Limits / remaining risks

- Shadow coverage is a local 42 m patch with a faded edge, not cascaded whole-island shadows. It uses sun attenuation only; night/ambient-dominant scenes intentionally show softer shadows. The camera API itself does not move that patch to a remote story subject; the story lane may choose to disable shadows or provide its own focus during distant shots.
- No physical low-end GPU, manual gameplay, or Electron visual check. Default OFF and the HIGH-only gate bound the exposure. Native depth casters omit decorative outline hulls, and use unsnapped geometry against the intentionally pixel-snapped retro scene.
- Cinematic camera is ready for consumers, but the story lane owns authored intro/ending tracks and integration.
