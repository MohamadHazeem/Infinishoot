LANE: postfx

Goal: a full look pass on lighting and post-processing, without losing the retro charm or frame rate.
Build:
1. Dynamic light: explosions, muzzle flashes, fire, lightning and glowing projectiles light the ground and nearby enemies (a small, fixed budget of point lights evaluated in the retro material shader, e.g. 8–16 brightest lights per frame packed in uniforms; vertex-lit to stay cheap).
2. Night stages: some stages (e.g. every 3rd stage, or a run event) are at night: dark, tinted ambient, a light radius around each player, shots and explosions lighting the dark, enemies with glowing eyes emerging from the dark. Readable, not frustrating. Add test link `&night`.
3. Enemy outlines: clean, thin, dark outline (inverted-hull or a post edge pass) on enemies and heroes for readability; elites get coloured outlines.
4. Shockwave and heat distortion: a screen-space distortion pass for explosion shockwave rings, boss slams and heat shimmer above fire/lava (cheap, a few concurrent waves).
5. Colour grading per area (lift/gamma/gain or small LUT-like curves per biome) and a better glow/bloom on bright emissive things, tuned to keep the palette cheerful.
6. Performance guard: auto quality — measure frame time, and step quality down (pixel ratio, post passes, particle density, light count) and back up with hysteresis to hold 60 fps; quality setting gets an "Auto" option (default).
All effects respect settings (flashes, reduce motion, quality) and work at the low internal resolution.
Owns: src/render/* (renderer.ts, retroMaterial.ts, retroSettings.ts, biomeLook.ts, new postfx.ts, lights.ts, quality.ts), src/game/settings.ts quality bits, tests/postfx.test.ts for pure logic (quality governor).
