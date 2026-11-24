LANE g2-hardmode: new difficulty baseline and fewer safety nets ("hard but fair").

Owns: the difficulty table (find it: src/data/modes.ts or wherever Easy/Normal/Hard/Nightmare scale enemy life/damage/count), src/game/timeRules.ts and the rewind/last-stand rules in src/game/systems/time.ts, the comeback rules in src/game/systems/gameplay.ts, playerTuning.maxHitFrac (src/game/player.ts), `levelUpHeal` (src/game/game.ts tuning object), heart/heal offers in the shop (src/game/systems/spice.ts shop code), tests/g2hardmode.test.ts, notes/lanes/g2-hardmode.md. Shared additive: settings, i18n catalogs, src/ui/screens.ts (difficulty labels only).

Build:
1. New baseline: today's Hard numbers become NORMAL (id stays `normal` so saves/boards keep working); today's Normal numbers become a new opt-in ASSIST difficulty (id `assist`), today's Easy stays as EASY below it only if it still makes sense (else merge Easy into Assist and keep the id `easy` mapped to assist). Hard and Nightmare move up one step in the same proportion. Update the difficulty pickers (solo setup and co-op lobby) and labels in EN and AR. Old saved settings with `easy` keep working.
2. Safety nets on Normal and above: rewind once per RUN (not per stage); last stand and comeback mode OFF; no heal on level-up (keep it on Assist/Easy); maxHitFrac 0.35 -> 0.50; Phoenix-style cheat-death relics/Mods once per run. Assist keeps today's nets.
3. Healing is a choice: the shop always offers a HEAL item that competes with Mods for gold (price scales with stage); hearts drop less on Normal+ (halve the heart drop weight).
4. Co-op: the host's difficulty decides all of this; clients see the same rules (snapshot or start message as needed).
5. Unit tests for each rule per difficulty, and for old settings migrating.
Run `npm run balance` and the smoke test; if balance's tolerances fail because the game is intentionally harder, update the balance baseline numbers and say so in notes (never weaken a rule to pass a stale baseline).
