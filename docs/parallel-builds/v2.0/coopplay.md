LANE: coopplay — co-op that needs teamwork

1. Co-op objectives (only when 2+ players; join the existing stage objectives in systems/arena.ts): TWO-SWITCH DOOR (two heroes hold two switches at once to open a vault with loot), ESCORT THE CORE (a slow core walks to a beacon; enemies target it), HOLD TWO ZONES at once, CARRY THE BOMB together (one carries it slowly, others defend, it blows a boss shield or a wall). Clear HUD markers, pings, rewards for everyone.
2. Carry downed teammates: walk over a downed teammate and press the interact/revive key to pick them up (slow move), carry them out of danger, then revive ('carry_lift' sample).
3. Buddy tether: a visible energy link between heroes within ~7 m ('tether_hum' sample): both get small bonuses (damage, regen) that grow with time linked; breaking it shows a snap effect. Setting to hide the visual.
4. Co-op banter: heroes call out to each other with recorded lines banter_<hero>_<nicesave|behind|thanks|groupup|onmyway|greatshot> (9 heroes, in public/audio): played locally on the speaker's teammate events (revive -> thanks, ally saves you -> nicesave, enemy behind a teammate -> behind, ping -> onmyway/groupup, big ally kill -> greatshot), through the voice channel with cooldowns; captions; HERO VOICES setting.
5. Synced, tested in npm run coop (add scenarios), screenshots.
Owns: new src/game/systems/coopplay.ts, additions in systems/arena.ts objectives (additive), voices.ts (banter, additive), tests/coopplay.test.ts.
