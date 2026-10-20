LANE: raid — 4-player raid mode

1. RAID mode (co-op lobby option, 2-8 players, scales; also playable solo with AI help ghosts/autopilot as a fallback): a long multi-phase fight against THE HYDRA ENGINE, a colossal three-headed mechanical hydra in its own arena (amb_raid ambience, raid_alarm, raid_horn, roar_hydra, voice lines boss_hydra_intro/phase/defeat, vo_raid).
2. Mechanics that need split roles: each head has a role (one breathes fire cones that someone must bait away, one shields the others until a hero stands on a pressure plate, one fires homing volleys that must be parried back); cutting a head regrows two smaller ones unless the stump is burned within 10 s; a heart core phase where heroes carry energy cells to cannons (uses coop objectives if available, else self-contained); enrage timer.
3. Raid rewards: exclusive cosmetics and an achievement; a raid leaderboard (local; online if configured).
4. Readable telegraphs, phase transitions, music (raid boss theme style), finisher with portrait, co-op sync, scaling for 2-8, bot-tested (team of bots can clear it in ~8-12 min on Medium), npm run coop scenario.
Owns: src/data/modes.ts (additive), new src/game/raid/*.ts and src/game/systems/raid.ts, raid arena, boss data (additive), tests/raid.test.ts.
