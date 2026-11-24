Lane g345-balance: the Gates 3-5 balance pass. Everything from Gates 2-5 is merged on this branch (hard mode with Assist, pressure director, power ceiling, armour/weak points, threats, stamina dash/parry, nemesis, boss rework, squads, crafting, archetypes, rule cards). Read notes/lanes/g2-close.md, g3-*.md, g4-*.md, g5-*.md first.

Targets (measure with `npm run skillbot`, which now runs samples in parallel; use 40 runs per measurement so noise doesn't decide):
1. Gate 2: the skilled bot clears a Normal loop in 40-60% of runs; Assist clearly easier, Hard clearly harder (20 runs each).
2. Gate 3: average aim deals under 60% of perfect-aim damage on the same build (keep the armour lane's measurement passing).
3. Gate 4: every loop-1 boss has a first-try skilled-bot win rate under 50% that rises over 5 practice runs (keep the boss lane's drill passing).
4. Gate 5: across 40 path-directed and 40 free runs, no single build archetype (use the archetype paths plus the dominant-weapon proxy from notes/lanes/g5-rules.md) exceeds 15% of wins, and the median run triggers 3+ distinct synergies. Storm Drones took 58% of wins in the g5-rules measurement: find out why (numbers, card weights, synergies) and fix it at the cause.
Owns: tuning values only (weapon/item/Mod/synergy/rule-card/archetype numbers and card weights, difficulty and director knobs), plus tests that pin the new numbers, notes/lanes/g345-balance.md with before/after tables. No new features. Also refresh tests/visual/balance.json (`npm run balance` historical comparison) only after the tuning is final, and say so.
Done means typecheck, vite build, npm test, smoke, balance and coop -- --offline pass and the four targets are met or the notes say exactly which is missed and why.
