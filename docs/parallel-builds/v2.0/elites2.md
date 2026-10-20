LANE: elites2 — new elite types and champions

1. Six new elite modifiers (src/data/eliteMods.ts style, rolled by weight, readable visuals and a toast): GRAVITY (pulls heroes and bullets slightly), SUMMONER (spawns 2 adds every 6 s), MIRRORED (reflects every 4th bullet), PHASING (blinks out of reality every few seconds, immune then), BERSERK (gets faster and stronger as it loses life), FROSTBITE (leaves freezing trails). Co-op sync (the enemy record has elite modifier bits: check tests/netCodec.test.ts limits; extend carefully).
2. CHAMPIONS: from stage 3, a rare champion elite with TWO modifiers, a golden name tag and a better chest.
3. Enemy guide/codex entries, elite tuning in data, bot balance check (elite kill times similar to existing elites), English + Arabic strings, tests and screenshots.
Owns: src/data/eliteMods.ts (additive), elite behaviour hooks (new src/game/systems/elites2.ts), codec bits (careful), tests/elites2.test.ts.
