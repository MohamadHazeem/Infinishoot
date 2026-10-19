LANE: enemies2

Goal: three new enemy families with fresh mechanics.
1. Burrowers: dig under the ground (a moving dirt mound + rumble telegraph, untargetable while underground except by explosions), pop up under/near the player with a ring telegraph (sample 'burrow' exists), attack, then dig again. A small and an elite-sized variant.
2. Mirror bots: scan the player (sample 'mirror_copy'), then copy the player's current left-click weapon pattern at reduced damage with their own colour; a few variants appear from stage 3. Killing one while it's mid-copy drops a bonus.
3. Swarm Queen (a mid-stage special/mini-boss-like enemy, not a stage boss): screeches (sample 'swarm_screech') and splits the arena with a wall of swarmers you must cut through, lays egg clusters that hatch if not destroyed, flees and returns once. Has its own bar like a mini-boss (see bosses' mini-boss handling in systems/bossFight.ts) or a compact elite bar.
4. Director: sensible stage introduction, bestiary entries, elite variants, tuning in data, readable telegraphs, models in the chunky cheerful style, gaits for the animation system (gaitOf in src/game/animMath.ts must cover new models), sounds wired via sfx cues.
5. Co-op sync (enemy record bits in src/net/codec.ts; keep tests/netCodec.test.ts passing — kinds must fit a byte, and BOSS_ACTIONS is already full at 8, don't add to it; use separate fields) and `npm run coop` stays green.
Owns: src/data/enemies.ts (new entries), src/game/enemies.ts (new behaviours, keep existing code untouched where possible), systems/enemyAi.ts, director.ts, bestiary, animMath gait additions, tests/enemies2.test.ts.
