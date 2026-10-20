LANE: gfx3 — graphics extras

1. Optional real dynamic shadows on HIGH (a single directional shadow map for heroes, bosses and big props; enemies keep blob shadows) with a setting; cost measured with npm run bench and kept small.
2. New VFX pass: muzzle flashes per weapon family, better explosion shapes (ring + debris + smoke column), level-up beam, evolution transformation effect, rarity-coloured chest bursts, hit sparks that match materials (metal sparks, slime splats, stone chips).
3. A cinematic camera for the in-engine intro/endings (if the story lane needs it, expose src/render/cinematicCamera.ts with simple keyframes).
4. Everything quality-scaled; screenshots before/after.
Owns: src/render/shadows.ts (new), VFX in src/game/fx.ts / particles.ts (additive), src/render/cinematicCamera.ts, settings option (additive), tests/gfx3.test.ts.
