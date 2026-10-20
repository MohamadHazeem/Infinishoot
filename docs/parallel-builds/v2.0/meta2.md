LANE: meta2 — long-term goals (cosmetic only: every run still starts equal)

1. Achievements to ~100: cover every system (bosses incl. new ones, modes, co-op, PvP, fusions, mech, rewind, parries, cash-ins, secrets, heroes, biomes, Ascension...), with tiers (bronze/silver/gold) and hidden ones; an ACHIEVEMENTS screen with progress bars and unlock date; unlock toast with the 'achievement' sample.
2. Profile level: XP from every run (time, kills, bosses, stages, co-op bonus), levels 1-100 with cosmetic rewards (titles, banner colours, HUD themes, pet hats, trail colours) and a level-up moment ('profile_level' sample); shown on player cards in co-op (expose profile summary for the lobby lane).
3. Daily quests: 3 per day (seeded by date), e.g. "Kill 500 enemies with fire", "Parry 15 shots", "Clear a stage in co-op"; reward profile XP/cosmetics; 'quest_done' sample; a QUESTS panel on the title.
4. PROFILE page (EXTRAS > PROFILE): lifetime stats (time played, kills by enemy, favourite kit/hero, best runs per mode, bosses beaten, co-op stats), a timeline of best runs, and the current title/banner.
5. Save migration (bump save version, normalize old saves), tests.
Owns: src/data/achievements (extend where achievements live: src/data/meta.ts) and new src/data/quests.ts, src/data/profile.ts, src/game/save.ts (additive), new src/ui/profileScreen.ts and achievementsScreen.ts, tests/meta2.test.ts.
