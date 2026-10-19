LANE: anim

Goal: characters move with personality, and the camera tells the story.
Build:
1. Hero animation (src/game/heroModel.ts): proper walk/run cycle (leg swing, arm swing, body bob, lean into movement), idle breathing, firing recoil pose, dash pose with stretch, hurt flinch, victory pose at stage clear, death fall.
2. Enemy animation: walk cycles/hops per enemy type (bob, waddle, scuttle), wind-up poses before attacks that make telegraphs readable (squash before lunge, rear back before charge, shake before exploding), hit reactions (squash, knock back tilt, flash) and deaths where enemies are flung away spinning (cheap, instanced, cosmetic only).
3. Smarter camera (src/game/cameraRig.ts): zoom out smoothly as the swarm grows or many enemies are near the edge (bounded), slight zoom in on calm moments, directional shake (shake toward the impact direction), a slow-motion kill-cam on boss kills (zoom to the boss, slow-mo, then back), and co-op framing that keeps all players in view.
4. Everything cosmetic and computed locally (no netcode) and respects reduce-motion/shake settings.
Owns: src/game/heroModel.ts, src/game/cameraRig.ts, src/game/systems/render.ts (enemy mesh animation parts; keep edits focused), enemy mesh pose code, tests/anim.test.ts for pure logic (camera zoom function).
