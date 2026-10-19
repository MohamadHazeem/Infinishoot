LANE: enemies

Goal: enemies are smarter and more varied.
Build:
1. 4 new enemy types with their own look (chunky low-poly, cheerful), behaviour and readable telegraphs, joining at sensible stages via the director: e.g. a Shielder (frontal shield, must be flanked, protects others behind it), a Leaper (hops over cover in arcs with a landing ring), a Healer/Medic bot (heals nearby enemies, priority target), a Splitter (splits into 2-3 minis on death), a Sniper (long telegraph line, retreats). Pick 4, add bestiary entries.
2. Smarter crowd AI: chasers surround and flank instead of a conga line (assign approach angles/slots around the player, some circle wide), shooters keep distance and use cover (move behind nearby cover clusters between shots), chargers avoid charging into walls; cheap (spatial hash, staggered updates).
3. Elite squads: elites spawn with and command a small squad (formation, they buff/rally them); killing the elite scatters the squad.
4. Golden treasure enemy: rare (about once per stage, never on stage 1 first minute), shiny gold, flees from the player and teleports away after ~12 s with a laugh (sample 'golden_laugh' may exist under public/audio — the sound lane wires samples; you can call sfx functions that exist). Catching it drops a big gold/gem/chest reward with a celebration effect.
5. Everything must sync in co-op (enemy kinds/behaviour states are in the binary enemy record in the snapshot; extend carefully and keep it compact).
Owns: src/data/enemies.ts, src/game/enemies.ts (non-boss behaviours), src/game/director.ts, src/data/bestiary.ts, enemy meshes, tests/enemies.test.ts. Avoid the boss behaviour functions in enemies.ts (bosses lane edits those).
