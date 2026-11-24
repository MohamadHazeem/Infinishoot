LANE g2-ceiling: power has a ceiling; no build becomes immortal by stage 3.

Owns: src/game/synergy.ts, src/data/mods.ts (numbers and caps only), src/data/passives (or wherever passive items' per-level stats live), the stat combination in src/game/hero.ts `recomputeStats` (only the diminishing-returns step), src/data/tracks.ts (Overdrive), the Momentum Mod, tests/g2ceiling.test.ts, notes/lanes/g2-ceiling.md.

Build:
1. Diminishing returns: stacking the same stat from several sources (damage %, fire rate, crit chance, crit damage, area, cooldown reduction, life steal, armour, move speed) follows a soft cap (e.g. effective = cap * (1 - exp(-raw/cap)) or a piecewise curve), chosen per stat and documented with a table in notes. The first sources stay as strong as today; the 4th-6th stack is what gets weaker.
2. Mod multipliers: total Mod damage multiplier per hit has a soft ceiling (document it); Echo and levels still never compound (keep existing rules).
3. Overdrive: each repeatable rank gives less (e.g. +8%, +7%, +6% … floor +2%) and is capped at a number of ranks; Momentum cap tightened.
4. Life steal / healing on kill: hard cap per second so sustain cannot outheal a crowd.
5. The pause/build screen and card numbers must show the EFFECTIVE value after the soft cap (players must see why a 5th stack is weaker). EN and AR.
6. Measure with the invincible bot (`npm run sweep`/`botRun`) before and after: report boss kill times per stage and the stage at which a god-bot build stops getting faster. Tests for the curves.
