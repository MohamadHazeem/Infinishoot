LANE: bosses3 — a boss for each new biome

Neon City, Toy Factory and Sky Fortress still reuse the old 4 bosses. Give each its own stage boss (when the stage's biome is one of these, bossForStage picks its boss; Omega stays the loop finale):
1. GLITCH DJ (Neon City): a robot DJ on a floating deck; attacks on the music's beat (use the beat API), bass-drop shockwaves, laser grids that sweep in time, "remix" phase that reverses/mirrors its patterns, spawns dancing minions.
2. BOXER JACK (Toy Factory): a giant jack-in-the-box; springs across the arena, wind-up crank telegraph, punches with boxing-glove arms (long lines), toy-soldier summons, a final phase where the box opens fully and it bounces like a pinball.
3. ADMIRAL GALE (Sky Fortress): a sky-pirate admiral on a small airship; cannon volleys, wind gusts that push heroes and bullets (reuse the Sky Fortress wind), boarding parties, phase 3 storm with lightning.
Each: 3 phases with transitions (use the existing boss phase system, bossFight.ts), readable telegraphs, entrance cinematic with name card, finisher support (finisher.ts portraits — add their portraits to portraitArt), mini-boss variant, bestiary/codex entries, music boss theme style, co-op sync, tests, God-bot kill times in the same band as the existing bosses (record them).
Recorded audio ready in public/audio: roar_glitch, roar_boxer, roar_gale; voice lines boss_glitch_intro/phase/defeat, boss_boxer_*, boss_gale_* (wire them like the other bosses in src/audio/voices.ts).
Owns: src/data/enemies.ts (new boss entries, additive), src/game/bosses.ts (new behaviours in a new src/game/bosses3.ts if cleaner), boss models, portraitArt additions, voices.ts additions, tests/bosses3.test.ts.
