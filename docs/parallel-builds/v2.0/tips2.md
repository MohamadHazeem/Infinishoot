LANE: tips2 — teach every new mechanic

Tonight added many mechanics. A new player meets them with no explanation. Using the existing onboarding systems (first-time tips in src/game/onboarding.ts / firstten, the Arsenal in src/data/arsenal.ts, the Codex & Lore in src/data/codex.ts):
1. First-time tips (one at a time, never piling up, respecting the TIPS setting) for: rewind, last stand, combo cash-in, mech suit, supply crates, mutations, weapon overload, team moves, team ultimate, revive pool, carry a teammate, buddy tether, trading, ping wheel, parry, perfect dash, style meter, ultimates, weapon fusion, route map, heat, Gauntlet, Ascension, raid mechanics, race, PvP formats, secrets hints, Halloween candy, pets learning skills, Ronin's sword combo, Tinker's bots, new enemies and bosses (Glitch DJ, Boxer Jack, Admiral Gale, Pumpking, Hydra Engine...), world events. Short, friendly, with the right button prompts (src/ui/prompts.ts).
2. Arsenal/Codex entries for every new weapon, relic, Mod, enemy, boss, hero and mode that lacks one (check with a test that every data item has an entry).
3. English and Arabic (src/i18n) for everything you add.
Owns: tip data, arsenal/codex data (additive), i18n additions, tests/tips2.test.ts.
