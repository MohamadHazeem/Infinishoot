LANE: arabic2 — translate everything added tonight

The arabic lane built src/i18n (English base + Arabic, RTL). Since then ~40 lanes added content and UI: new weapons, heroes (Ronin, Tinker), bosses (Glitch DJ, Boxer Jack, Admiral Gale, Pumpking, Hydra Engine), Mods, relics, enemies, events, modes (Gauntlet, Ascension, Raid, Race, PvP formats), lobby/party/chat, settings tabs and descriptions (src/ui/settingsScreen.ts), achievements, quests, profile, story, MVP awards, Halloween, tips, toasts and banners.
1. Run the i18n test with I18N_STRICT=1 and the main-screen scanner; translate every missing string into natural, gamer-friendly Arabic (src/i18n/ar.ts, add English keys where strings are hard-coded: route them through t()/localize as documented in CONTRIBUTING.md).
2. Screenshot every screen in Arabic (?lang=ar, every &screen=..., HUD in fights, raid/race/PvP HUDs, MVP, story) at 1280x720 and 844x390: fix RTL layout problems, overflow and clipped text.
3. Make I18N_STRICT=1 the default in tests/i18n.test.ts again so missing translations fail from now on, and document how to add strings.
Owns: src/i18n/*, string routing edits (small, surgical), tests/i18n.test.ts.
