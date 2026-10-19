# Lane: enemies

## What players get
- **Four new enemies**, each with its own chunky model, a veteran version (stage 3+) and an Enemy Guide tip:
  - **Shield Bot** (stage 1 from about 1:46): carries a big riot shield. Hits from its front arc (70° either side) do x0.15 damage and pop a BLOCK. Allies standing up to 3.6 m behind it take x0.5 from that side and get a faint cyan tint. It turns slowly (1.5 rad/s), so you beat it by getting round the side. Up close it does a short shield bash. At most 8 alive.
  - **Medi Bot** (stage 1 from 2:24): hangs back about 10 m away. Every 3.6 s a green ring grows under it for 0.8 s, then it heals every ally within 6 m by 15% of their max life (elites heal at half that, bosses and Reapers not at all). It's the priority target: 6 XP, 300 score, at most 3 alive.
  - **Hop Frog** (stage 2 from 1:12, packs of 2-3): crouches for 0.6 s while a red landing ring follows you, then the ring locks. It hops 3.2 m high over cover (walls don't stop it in the air) and the ring fills red while it flies. Landing hurts heroes inside 1.8 m for 16 damage. It hops every 2-3 s.
  - **Mortar Toad** (stage 2 from 2:00): keeps 12 m away and hides behind cover. Every ~3.6 s it lobs 3 shells (5 for elites): one at you and two scattered around you. Each one shows as a red strike zone 1.2 s before it lands (the same synced strike system the bosses use).
- **Smarter crowds**
  - Chasers (chase and lunge enemies, Hop Frogs) each approach from their own angle. The bend is full beyond 14 m and fades to nothing inside 3 m, so hordes close in from all sides instead of queueing. A quarter of them circle wide (57-77°) before spiralling in.
  - Shooters (Blaster/Spin/Burst/Sniper Bots) and Mortar Toads look for a small box (≤ 7 m across) within 9 m about once a second. Between shots they wait on the far side of it from you, and they step out 0.8 s before firing.
  - Rhinos test the charge line against the walls before winding up. If a wall is in the way they sidestep for 0.45 s and try again (turning round if they bump into something), instead of charging into the wall.
- **Elite squads**: every elite arrives with an escort: 3 on stage 1, +1 every 2 stages, at most 6. The escort type matches the elite (`squadOf` in src/data/enemies.ts: shooters bring Boppers, snipers and mortars bring Shield Bots, Rhinos and Chonks bring Zippies, veteran elites bring veterans). Escorts march in a V behind the elite, each with a small gold ring underfoot, and break off to attack inside 7 m. Every 6 s the elite RALLIES them: +15% life and +25% speed for 3 s, shown as a gold tint and a big gold ring. When the elite dies the squad SCATTERs and runs away for 2.5 s.
- **Goldbug** (treasure enemy): one per stage, at a random time between 20% and 80% of the stage, never in stage 1's first minute. It appears on screen (9-12 m away) with a toast, a laugh and sparkles. It is gold and shimmering, zig-zags away from you, turns back from the arena edge, and gets a 1.15x speed burst inside 4.5 m (base speed 6.4 vs a hero's 7). After 12 s it blinks for 2 s, then escapes with a laugh ("THE GOLDBUG GOT AWAY!"). Catching it is a JACKPOT banner with a flash, gold rings and a burst, plus 6 coins worth (3 + stage) gold each, a big XP gem (12 x stage), a chest and 5000 score.

## Files touched
- Lane files: src/data/enemies.ts (5 defs, new `guard`/`leap`/`heal`/`mortar`/`treasure` fields, veterans, `squadOf`, `squadSize`), src/data/bestiary.ts (tips), src/game/enemies.ts (behaviours, AI helpers, models, telegraph decals, `aiTuning`/`squadTuning`/`goldenTuning`; boss functions untouched), src/game/director.ts (Goldbug timing: `goldenTime`, `directorTuning.golden*`).
- New: src/game/systems/enemyAi.ts (EnemyCtx callbacks, `guardMul`, `spawnSquad`, `spawnGolden`, `onEnemyKilled`), tests/enemies.test.ts (60 checks, including headless behaviour sims).
- Small additive edits to shared files:
  - game.ts: an import, 4 method fields, and a `...EnemyAiSys.enemyCtxExtras.call(this)` spread in makeEnemyCtx.
  - systems/combat.ts: 1 line in `damage` (`guardMul`).
  - systems/statuses.ts: 1 line in `killEnemy` (`onEnemyKilled`).
  - systems/spawning.ts: the Goldbug branch, plus elites spawn their squad.
  - systems/netClient.ts: 1 line (`e.aiBits = r.ai`).
  - net/codec.ts: enemy record byte 21.
  - ui/debugPanel.ts: an "Enemy AI" folder.
  - dev/testLinks.ts: new options.

## Co-op
- New enemy kinds use the existing record (def index, state, timer, targetX/Z for the Hop Frog's landing ring, hopY). The Medi Bot's heal ring is drawn from its synced wind-up state, and Mortar shells go through `ctx.strike`, which already syncs.
- Byte 21 of the enemy record is now: bits 0-3 elite modifier (index + 1, so **at most 15 elite modifiers**, was 127), bits 4-6 `Enemy.aiBits` (squad escort, rallied, guarded), bit 7 shield. The record size is unchanged (22 bytes).
- The Goldbug's remaining life rides in the state timer byte so clients can blink it. Every effect (rally, heal, jackpot, escape, BLOCK) goes through `game.vfx`.

## Tuning (debug panel > Enemy AI)
- `aiTuning`: flankMax 0.7, wideShare 0.25, wideMin/Max 1.0/1.35, flankNear/Far 3/14, coverSearch 1 s, coverRange 9, coverPeek 0.8 s, rerouteTime 0.45 s.
- `squadTuning`: spacing 1.7, engage 7, catchUp 1.35, rallyEvery 6, rallyTime 3, rallySpeed 1.25, rallyHeal 0.15, rallyRange 10, scatter 2.5.
- `goldenTuning`: panic 4.5 m, panicSpeed 1.15, edge 8. `treasureTuning` (enemyAi.ts): coins 6, goldBase 3, goldPerStage 1, gemPerStage 12. `directorTuning`: goldenChance 1, goldenFrom 0.2, goldenTo 0.8, goldenEarliest 60.

## Test links
- `spawn=shielder:3,medic:1` puts enemies in a ring around you. `spawnr=4` sets the ring radius (default 9 m).
- `golden` spawns the Goldbug.
- `time=90` sets the stage clock in seconds.
- `zoom=2.2` zooms the camera out (1-2.2).
- Examples: `?test&god&spawn=shielder:1,medic:1,leaper:1,mortar:1,golden:1&spawnr=4` (all models up close), `?test&god&elite=shooter:fast&zoom=2.2` (an elite squad).

## Sound hooks
- The Goldbug calls `vfx.sound('goldenLaugh', ...)` on spawn and escape. That sfx method doesn't exist yet: the sound lane should add `goldenLaugh` (public/audio/golden_laugh.mp3). Until then nothing plays for it, though the spawn also plays `jingle` and the escape also plays `portal`.

## Risks and unfinished
- Balance isn't bot-measured. Squads add 3-6 bodies per elite (one elite every 48 s), and Medi Bots and Shield Bots make crowds tankier. If stage 1 feels harder, lower `squadSize` or Shield Bot `frontMul`/weight first.
- Shield Bot protection uses the hit's push direction when the weapon gives one, otherwise the attacking hero's position. Area weapons centred on you (Zap Field and friends) are blocked from the front, which is intended. Explosions behind the shield get through.
- Cover-seeking only considers small boxes and doesn't check line of sight, so shooters can still fire into a wall when they step out late.
- The Goldbug runs into walls (it gets stuck, which makes it easier to catch). That's intended charm, not pathfinding.
- The AI uses `Math.random` like the existing enemy code (host only), so runs aren't seed-deterministic in enemy movement (they weren't before either).

## Suggested PLAN.md decision-log entry
- 2026-10-19: Enemies lane. Added four enemies, each with a telegraph you can read:
  - Shield Bot: frontal shield x0.15, covers allies behind it at x0.5, turns slowly so you flank it.
  - Medi Bot: green-ring heal pulse, 15% every 3.6 s.
  - Hop Frog: hops over cover onto a landing ring.
  - Mortar Toad: lobs shells onto strike zones.
  
  Crowd AI: chasers spread their approach so hordes surround you (25% circle wide), shooters hide behind small cover between shots, Rhinos don't charge into walls. Elites bring a squad of 3-6 in a V that rallies every 6 s and scatters when the elite dies. One Goldbug per stage (not in stage 1's first minute) flees for 12 s and drops a jackpot when caught. AI state for clients rides in 3 spare bits of enemy record byte 21, which caps elite modifiers at 15.
