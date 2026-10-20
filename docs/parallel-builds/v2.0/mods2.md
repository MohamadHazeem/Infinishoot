LANE: mods2 — new Mods for the shop

Context: 9 economy Mods were removed (see PLAN.md decision log, 2026-10-19). The shop needs fresh, interesting choices.
1. Design and implement ~12 new Mods (non-economy) that create build decisions: tag synergies for under-served tags, trigger Mods (on parry, on perfect dash, on ultimate, on cash-in, on rewind, on mech exit, on chest open), positional (stand in your own fire, at max range, near walls), risk/reward cursed ones, and ordering puzzles that use the slot pipeline (left-to-right). Each with rarity, level scaling (modDesc(def, lv)), icons (scripts/icons.mjs + npm run icons; bold silhouettes, no reused icons) and shop-preview support.
2. Ally Mods (co-op family, only offered when game.coop): ~6 Mods that buff teammates or combo with them (e.g. "your Burns make allies' hits crit", "allies near you reload faster", "when an ally parries, you fire a nova", "share 10% of your lifesteal"). Host-authoritative, synced.
3. Balance with the bot: measure each Mod in isolation and in its intended combo; no new Mod above the strongest existing ones; record numbers.
Owns: src/data/mods.ts (additive), src/game/synergy.ts / modTypes.ts hooks (additive), icons, new src/game/systems/mods2.ts for new triggers, tests/mods2.test.ts.
