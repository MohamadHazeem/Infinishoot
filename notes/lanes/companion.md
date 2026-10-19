# Lane: companion (growing pets, co-op team moves, high-five revives)

## What players get
- **Pets that grow.** Every pet starts a run at level 1 and grows a level per stage cleared (max 5). Each level teaches the skill at that step of its tree; a skill learned again ranks up (II, III):
  - **Bit** (the fetcher): Fetch, Zap, Shield, Revive, Fetch II.
  - **Guardian** (the protector): Revive (from level 1, like before), Shield, Taunt, Shield II, Taunt II.
  - **Sparky** (the fighter): Zap, Taunt, Zap II, Revive, Zap III.
  - Skills: **Fetch** +60% pickup range per rank, and every 2.5 s (1.5 s) grabs up to 4 (8) gems and coins within 10 m (14 m) and sends them flying to you. **Zap** hits the nearest enemy in 9 m every 1.5 / 1.2 / 0.9 s and chains to 1 / 2 more at ranks II / III (damage 10 + 3 x team level, x1.15 / x1.3). **Taunt** flies the pet out 2 m past the middle of a nearby crowd (3+ enemies within 8 m) every 12 s (9 s) and hovers there as a decoy for 2.5 s (3.5 s); enemies nearer the pet than any hero chase it. **Shield** blocks one big hit per stage (12%+ of max life, or a lethal one) with 1 s of i-frames; rank II also knocks nearby enemies back (25 + 5 x team level). **Revive** gets you back up once per run with 60% life and 2.5 s of i-frames ("BIT TO THE RESCUE!"); it fires after relic/passive revives.
  - **Growth you can see:** the pet gets 12% bigger per level, grows a tail fin (Lv 2), a spinning ring (Lv 3), a crown (Lv 4) and a pulsing glow (Lv 5). It wears a golden halo while its revive is ready and an orbiting blue gem while its shield is up. Taunting pets fly out, spin and flash red.
  - **Level-up moment:** after a stage clear the growth waits for a calm moment (the portal walk after the shop, or 2.6 s into the next wave in Endless) so the STAGE CLEAR banner and the shop don't hide it: `pet_level` sample, ring and sparkles in the pet's colour, the pet spins and swells, "SPARKY LV 3: ZAP+!" over the hero, a toast for its owner saying what it learned, and the HUD pet panel pops.
  - **HUD pet panel** (bottom right, left of the minimap): name, LV, level pips, learned skills (Shield and Revive struck through once spent), next skill.
- **Co-op TEAM meter** (bottom centre above DASH / SPECIAL / ULT; never shown solo or in PvP). Two or more living heroes within 6 m of each other (chained) for 1.5 s, with 3+ enemies within 15 m of the group, charge one shared meter: 16 s for two heroes, 35% faster per extra hero. The bar says STAND TOGETHER TO CHARGE / LINKING... / CHARGING x2, linked heroes throw cyan sparks, and `team_charge` chimes when a link starts charging and again (with a toast) when it is full.
- **Team moves** (T, pad D-pad down; rebindable as "Team move (co-op)"). Anyone can fire a full meter if a teammate is within 12 m (else a hint toast). Moves rotate, the next one is named on the meter:
  - **Unity Beam:** every hero in the group fires a beam (in their colour) into the spot the caller aims at for 1.4 s, then the meeting point bursts.
  - **Team Nova:** three expanding shockwaves from the group's centre with knockback (radius 8 m + 2 m per hero past two).
  - **Meteor Call:** 5 + 3 per hero meteors over 1.8 s onto the crowds within 14 m of the group, each telegraphed 0.7 s.
  - Power scales with heroes in the move (+40% per hero past two). Banner "UNITY BEAM! / X CALLS IT · 2 HEROES", flash, shake.
- **High-five revive.** Finishing a co-op revive (stand next to a downed teammate for 3 s) ends in a high-five: both heal 25% of max life, confetti and a star between them, "HIGH FIVE!", the `high_five` sample, happy faces, and +25% on the TEAM meter.
- **Settings:** PET SOUNDS (on by default) mutes pet zap sounds, which get frequent at Zap III. Team move flashes go through the HUD flash (REDUCE FLASHING applies) and shake through `juice` (SCREEN SHAKE applies).

## Key numbers
- `petTuning` (src/data/pets.ts), `teamTuning` (src/game/teamMoves.ts), `highFiveTuning` (src/game/systems/companion.ts). Debug panel folder "Pets & team moves" (plus Fill TEAM meter, Pet level up).
- Team move damage: 90 x (1 + 0.8 (s - 1) + 0.2 (s - 1)^2) x (1 + 0.4 (heroes - 2)), then the caller's / each beamer's own stats and Mods (source `team`, shown as "Team Moves" in the damage breakdown; pets are "Pet"). Beam 0.22x per 0.1 s tick along each beam (1.3 m wide) + a 2.5x burst (r 3.5 m); Nova 2.4x split over 3 waves; Meteors 1.5x each (r 2.8 m). At stage 1 that is ~20 per beam tick and a 225 burst, 72 per nova wave, 135 per meteor, before stats. A full meter takes ~17.5 s of standing together in a fight, so expect one team move every 20-40 s when a team plays together.

## How it works (host-authoritative)
- `Hero.petState` (`PetState`, src/game/pet.ts): level, ranks, shield/revive state, timers and two cosmetic counters (zaps, fetches). Reset in `Hero.startRun()`. Bit's old +60% magnet is now Fetch rank 1 (`magnetBonus` in `recomputeStats`); the Guardian's old extra `revivesLeft` is now its level-1 Revive skill.
- src/game/systems/companion.ts (Game methods): `updatePets` (replaces the old Sparky-only one in combat.ts; fetch, zap, taunt on the host), `companionTargets` (taunting pets join `game.targets`, the list enemies pick the nearest from), `companionStageClear` + `petGrowth`, `petShield` (hook at the top of `hurtHero`), `petRevive` (hook in `onHeroDown`), `highFive` (hook in `updateRevives`), `updateCompanion` (meter, host input, running move), `tryTeamMove` (host; clients send `{t:'team'}`), `companionNet` / `applyCompanionNet` (snapshot field `cp`: per hero `[level, flags, tauntX, tauntZ, zaps, fetches, zapX, zapZ]`, meter `[charge, linked, linkT, next]`, move `[id, t, x, z, mask, by]` or null; ~100 bytes), `renderCompanion` (HUD, zap/fetch cosmetics from the counters, taunt pulses, link sparks, Unity Beam meshes; every machine). The per-Game state lives in a WeakMap (`game.companionState()`), so Game needs no new fields.
- One-off moments (level-ups, shield blocks, revives, taunt starts, team move hits, high-fives) go through `game.vfx`; frequent ones (zaps, fetches) are replayed locally from synced counters so they cost no effects traffic and PET SOUNDS can mute them.
- src/game/teamMoves.ts: pure `TeamMeter`, `linkedCount`, `segDist2`, `teamScale`, `moveTime`, plus `TeamMoveView` (4 beams + an orb, built on first use).
- src/ui/companionHud.ts: `#petpanel` and `#teammeter`, styles injected once (no style.css edits).
- New sfx cues `petLevel`, `teamCharge`, `highFive` mapped to the existing `pet_level`, `team_charge`, `high_five` samples (mix.ts), with synth fallbacks.

## Test links (src/dev/companionLinks.ts)
- `pet=bit|guardian|sparky`, `petlv=1..5`
- `mate` / `mate=sparky`: a standing dummy teammate with that pet next to you (shows the TEAM meter and high-fives in a solo test)
- `teamfull`, `teammove=beam|nova|meteor`, `teamgo=<s>` (fire once), `teamloop=<s>` (refill and fire every <s> s; also stops level-up menus)
- `taunt` (taunt now; add enemies e.g. `spawn=chonk:4,bopper:8&spawnr=7`), `downmate=<s>` (the dummy goes down; stand by it for the high-five), `petgrow=<s>` (the growth moment every <s> s, from `petlv`)
- e.g. `npm run shot -- "?test&god&pet=sparky&petlv=2&mate=bit&teammove=beam&teamloop=0.6&spawn=chonk:8,bopper:10&spawnr=7&frozen&dry" shots/beam.png --wait 5`

## Verification
- `npm run typecheck`, `npm test` (17 files incl. new tests/companion.test.ts, 64 checks: trees and ranks, meter math and rotation, an in-process host + client game for pet levels, zap, shield, revive, meter charge/hold, a client-fired team move, all three moves, the alone case, the high-five, solo has no meter, Bit fetching far gems), `npm run smoke` all pass. `npm run coop` passes, now with pets on both players (Sparky host, Bit client), pet records and the TEAM meter compared every 4 s, pets grown to level 4 and the client firing a team move through the host (shots/coop/teammove-*.png). `npm run bench` (12 s): garbage ~12 MB/s, same range as the perf lane's numbers; sim phases unchanged.
- Screenshots checked at 1280x720 and 960x540: pet panel, TEAM meter in every state, the three moves, taunt, high-five, growth moment, pets at levels 1-5.

## Files touched
- Owned/new: src/data/pets.ts, src/game/pet.ts, src/game/teamMoves.ts, src/game/systems/companion.ts, src/ui/companionHud.ts, src/dev/companionLinks.ts, tests/companion.test.ts, notes/lanes/companion.md.
- Small hooks in shared files: game.ts (import, installs, `updatePets` now from companion, `companionTargets()` after the hero targets, `updateCompanion(dt)` after revives), hero.ts (`petState`, reset, magnet from Fetch, Guardian revive moved to the pet, `sparkyT` removed), systems/combat.ts (old `updatePets` removed), statuses.ts (shield and revive hooks, source names), coop.ts (high-five hook), spice.ts (stage-clear hook), netHost.ts (`cp` + `team` message), netClient.ts (apply + client input), render.ts (`renderCompanion`), core/keybinds.ts (`team` action, `PAD_TEAM`), settings.ts + screens.ts (PET SOUNDS), audio/mix.ts + sfx.ts (3 cues), dev/testLinks.ts (one call), ui/debugPanel.ts (folder), scripts/coop-test.mjs (pets, checks, team move scenario).

## Risks and leftovers
- Taunt reuses the "chase the nearest target" rule, so a decoy only pulls enemies that are nearer to it than to a hero, and a boss near a decoy will chase it too (briefly). A true aggro override would need a change in src/game/enemies.ts.
- Pets don't zap or taunt PvP stand-ins (no pet damage between players); shield and revive still work in a duel.
- The dev bot never presses the team button, so `npm run smoke` doesn't exercise team moves; the unit test and `npm run coop` do.
- Old saves keep their pet choice; Bit and Guardian change behaviour (Guardian's revive is the same, Bit's +60% range is now Fetch I plus active fetching).
- tests/arenaCoop.test.ts failed once in about 13 runs ("colliders gone"); it uses random arenas and doesn't involve pets or team moves (pets are off there), so it looks like an existing flake.

## Decision-log paragraph for PLAN.md
- 2026-10-19: Companion lane (notes/lanes/companion.md). Pets grow: level 1 each run, +1 per stage clear (max 5), a skill per level from a per-pet tree (Bit Fetch/Zap/Shield/Revive, Guardian Revive/Shield/Taunt, Sparky Zap/Taunt/Revive; repeats rank up), visible growth (size, fin, ring, crown, glow, revive halo, shield gem), a level-up moment once the stage-clear banner and shop are out of the way, and a HUD pet panel. Co-op: heroes standing together (6 m) in a fight charge a shared TEAM meter (16 s for two) spent with T / D-pad down on a rotating team move (Unity Beam, Team Nova, Meteor Call; +40% per hero past two); finishing a revive ends in a high-five (both heal 25%, +25% meter). Host-authoritative; pets and the meter travel in the snapshot's `cp` field, frequent pet zaps are replayed from counters. Taunt works by adding the pet as an extra chase target rather than changing enemy AI.
