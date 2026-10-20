LANE: seasonpass — a free cosmetic season track

A free SEASON track (no money, no power, cosmetics only; every run still starts equal): 50 tiers per season (monthly seasons, seeded by year-month), earned with profile XP (src/data/profile.ts / systems/meta2.ts) plus weekly season challenges (3 per week, e.g. "clear a raid", "win a race", "reach SS style", "gold medal in 3 trials"). Rewards: skins, colour sets, trails, pet hats, banners, titles, emotes, HUD themes, photo-mode stickers — reuse existing cosmetic systems (customise, wardrobe, profile rewards) and add a few new cosmetic items where needed.
1. SEASON screen (EXTRAS and a title banner): tier track with rewards, progress bar, current challenges, time left, claim animation (achievement/trophy samples).
2. Save migration (bump the save version as others did, normalize old saves), English + Arabic strings, tests, screenshots.
3. Co-op: each player progresses their own track (local), co-op runs give a small bonus.
Owns: new src/data/season.ts, src/game/systems/season.ts, src/ui/seasonScreen.ts, small hooks in meta2 XP awarding and the title screen, save fields (additive), tests/seasonpass.test.ts.
