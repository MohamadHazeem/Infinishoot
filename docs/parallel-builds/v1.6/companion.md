LANE: companion

Goal: pets that grow and co-op that feels like a team.
1. Companion that levels up: the pet (src/game/pet.ts, src/data/pets.ts) gains a level each stage cleared and learns a skill per level from a small tree per pet type: fetches gems/coins, taunts nearby enemies (pulls aggro briefly), zaps enemies, shields the hero once per stage, revives the hero once per run at high level. Visible pet growth (size/glow/accessory), level-up moment (sample 'pet_level'), HUD pet indicator. Works for every player in co-op (synced).
2. Co-op team moves: (a) Combined attack: when 2+ heroes stand close together for ~1.5 s while in combat a shared TEAM meter charges (sample 'team_charge'); when full, any of them triggers a team move (pick 2-3 designs: a converging beam between heroes, a ring blast, a meteor call) scaled by the number of heroes. (b) High-five revive: reviving a downed teammate ends in a high-five that heals both (sample 'high_five'), with a tiny celebration. Solo: the team meter doesn't appear.
3. Clear HUD and settings, host-authoritative, synced, `npm run coop` green (extend scripts/coop-test.mjs with checks for pet levels and a team move).
Owns: src/game/pet.ts, src/data/pets.ts, new src/game/teamMoves.ts, a new system file, small hooks in revive code and hud, tests/companion.test.ts.
