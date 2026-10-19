LANE: bosses

Goal: bosses are memorable fights.
Build:
1. Every regular boss (King Bopper, Rex, Queen) gets 3 phases at HP thresholds with clear phase transitions (invulnerable roar moment, flash, arena shake, new attack set): King's slam leaves expanding shockwave rings you must dash/jump through; Rex smashes through cover and charges in a figure-eight, later breathes fire; Queen plants hives that hatch minions if not destroyed, later summons a swarm wall. Omega keeps its phases but gets the same transition treatment.
2. Arena twists per boss (affecting the field while the boss lives) and readable telegraphs on every attack.
3. Mid-stage mini-bosses: around the middle of each stage (from stage 2), a mini-boss (scaled-down variant with 2 phases and its own bar) appears with a warning; it drops a chest.
4. Boss entrances: a short cinematic (camera pans/zooms to the boss, slow motion, letterbox bars, big name title card with subtitle, roar), skippable and short (~2 s), and safe in co-op (host-driven, clients see it via vfx event).
5. Sync: boss phase and new attack states must reach clients (snapshot/vfx).
6. Expose phase changes so the music lane can react: call `music.setBossPhase?.(n)` guarded with optional chaining or a small event, it may not exist yet.
Owns: boss behaviour code (move/extend the boss functions from src/game/enemies.ts into a new src/game/bosses.ts if useful, but keep the diff minimal in enemies.ts since another lane edits it), boss data entries in src/data/enemies.ts, new src/game/bossIntro.ts, boss bar bits in hud (small), tests/bosses.test.ts.
