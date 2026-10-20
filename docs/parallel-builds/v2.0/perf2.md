LANE: perf2 — performance after the big merge

Tonight ~30 lanes merged into main. A lane measured 0.81 ms per simulation step (it was 0.24 ms after the last perf pass; see notes/lanes/perf.md for the method and the earlier numbers). Find and fix what got slower.
1. Run `npm run bench` (heavy scene, HIGH and LOW, SwiftShader and --gpu metal) and the per-phase timers; compare with notes/lanes/perf.md. Profile the simulation and render phases; list the top costs and which lane added them.
2. Fix the biggest regressions without removing features: per-frame allocations, O(n^2) loops over enemies/heroes/bullets, DOM work every frame (HUD panels, overlays, portraits, network overlay, objective markers), per-frame Map/array creation, repeated querySelector, unpooled meshes/materials, lights or shadows when off, systems that run when their mode isn't active (raid, race, pvp, halloween, gauntlet, secrets, story, spectate...). Early-out inactive systems.
3. Check memory: a 10-minute bot soak with heap sampling (scripts/soak.mjs if present) stays flat.
4. Record before/after in notes/lanes/perf2.md. All checks must pass.
Owns: performance edits anywhere (surgical, behaviour-preserving), tests/perf2.test.ts if useful.
