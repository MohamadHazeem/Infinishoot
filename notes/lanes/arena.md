# Lane: arena

The field is now something to play with: things to break, ride and switch on, hazards you can push enemies into, and an optional objective every stage.

## What players get
- **Breakable cover.** Crates and crate stacks (the ones already in crate clusters) take damage from bullets, blasts and beams. When they break they throw splinters and sometimes drop a coin. Enemy bullets still stop on them while they stand.
- **Toppling pillars.** Each stage has 4 tall pillars. Shoot one down and it falls away from the hit ("TIMBER!"), then crushes every non-boss enemy along a 5.4 m strip ("CRASH!"). Bosses lose 8% of their max life. A falling pillar also sets off barrels and breaks other cover it lands on, so pillars can knock each other over like dominoes. The rubble lies there for 6 s and then sinks away.
- **Jump pads.** There are 3 pads per stage, each with a blinking landing ring 10-15 m away. Step on one and the hero somersaults over the horde, invulnerable the whole way. The landing sends out a shockwave (30 + 15 per stage damage, knockback 18, radius 3.8 m) that also throws enemies into hazards.
- **Turrets.** There are 2 turret pads per stage. An idle pad pulses cyan; walk onto it and the turret fires at the nearest enemy for 20 s, then cools down for 40 s. It does 9 + 5 per stage damage per shot, about 5.5 shots per second, credited to the hero who switched it on, so hero damage stats apply.
- **Biome hazards and environmental kills:**
  - Magma: an enemy knocked into lava dies on the spot. Walking in still only sets it alight, as before.
  - Peaks (frozen ponds): knockback keeps sliding on ice, and a fast slide into a wall is a "SPLAT!" for 60% of max life.
  - Dunes: **quicksand** pools (new) slow heroes to 55% and enemies by 55%. Small enemies (xp ≤ 2) that stay in for 2.5 s sink ("GULP!").
  - Meadow: **thorn bushes** (new) scratch enemies inside for 6% of max life every 0.5 s and slow them. An enemy knocked in takes 45% of max life. Heroes are only slowed a little (85%).
  - Elites and the Reaper only lose 25% of max life to the instant-kill hazards. Bosses are immune to hazards.
  - Every kill by lava, thorns, quicksand, an ice splat, a pillar or a barrel is an **environmental kill**. It gives bonus score of (40 + 20 × stage) × the combo multiplier and shows an "ENVIRONMENTAL KILL!" popup, then "ENV KILL x3/x6/x10…" for streaks. Barrel chains show a **CHAIN xN!** counter.
- **Stage objectives.** Each stage rolls one objective from its seed, so every co-op machine agrees on it. A tracker sits top left under the gold, and an edge-of-screen arrow with the distance points to the nearest target. Yellow light beams mark totems, shards and the beacon.
  - Destroy 3 totems: solid and shootable, with 260 × (1 + 0.7 × (stage − 1)) life.
  - Charge the beacon for 30 s by standing in its 4.5 m ring. Enemies in the ring drain its 100 life (1 per enemy per second, counted up to 4 enemies), and the ring blinks while it's under attack. The beacon is lost at 0.
  - Collect 5 relic shards.
  - Get 15 environmental kills, +3 per stage, capped at 30.
  - Completing it gives every hero 8 + 3 × stage gold, 800 × stage score and a treasure chest pickup each (a "TREASURE!" pick).

## Co-op and determinism
- The layout is seeded. Props, pads, turrets, objective spots and the new hazard patches are generated in `createFieldArena` *after* everything else, so existing layouts for a seed are unchanged. The objective kind comes from `pickObjective(arena.seed, stage)`.
- The host simulates and sends the arena state in the snapshot as a small `ar` object (`Interactives.net()`): bitmasks for live props, totems and taken shards, pillar fall angles, turret timers, the objective state and each hero's jump progress. When a client sees a prop or totem break, it removes the collider on its side.
- Clients move their own hero through jumps and quicksand locally (`arenaLocal`) and send `{ t: 'jump', i }`. The host then grants i-frames and fires the landing shockwave. All effects go through `game.vfx`.
- Turret shots are ordinary player bullets (`kind` 12 → source `turret`), so they reach clients through the existing bullet records. They use the existing `#7df9ff` colour, so the codec didn't change.
- In the PvP duel, hazards, turrets and objectives are off, and landings deal no damage.

## Files
- New: `src/game/hazards.ts`, `src/game/objectives.ts`, `src/game/interactives.ts`, `src/game/systems/arena.ts`, `src/ui/objectiveHud.ts` (injects its own CSS using the palette variables), `tests/arena.test.ts`, `tests/arenaCoop.test.ts`.
- Owned and changed: `src/world/fieldArena.ts` (crates became `props`; new `seed`, `props`, `pads`, `turrets`, `spots`; quicksand and thorn patches; `hazards` typed as `HazardZone`), `src/game/barrels.ts` (chain counter).
- Shared files, small additive hooks only:
  - `game.ts`: imports, the ArenaSys method block, the `toys`/`objHud` fields, `updateArena(dt)` in simulate, BULLET_KINDS entry 12, `hitBarrels` also hits toys.
  - `systems/statuses.ts`: bullets hitting walls damage toys, `blast` damages toys, `onEnvKill` in killEnemy, source names.
  - `systems/runFlow.ts`: `loadToys()` in loadArena.
  - `systems/netHost.ts`: `ar` in the snapshot and the `jump` message.
  - `systems/netClient.ts`: `arenaSetNet` and `arenaLocal`.
  - `systems/render.ts`: `renderArena`.
  - `ui/debugPanel.ts`: an Arena folder.
  - `dev/testLinks.ts`: new options.

## Test links
- `objective=totems|beacon|shards|envkills` forces the stage objective.
- `near=pad|turret|pillar|crate|totem|shard|beacon|lava|ice|quicksand|thorns` starts the hero next to the first one (on top of it for a pad).
- `topple` knocks over the pillar nearest the hero.
- Examples: `?test&god&objective=beacon&near=beacon&stage=3`, `?test&god&stage=4&near=lava`, `?test&near=pillar&topple`.

## Tuning
The numbers live in `arenaTuning` (interactives.ts), `hazardTuning` (hazards.ts) and `objectiveTuning` (objectives.ts), and most are in the debug panel's Arena folder. In a headless bot probe (3 god runs × 4 stages, a bot that ignores objectives), there were 29-68 environmental kills per run, mostly from barrels and thorns, plus some quicksand, lava and pillar kills. The bot cleared a few objectives by accident, and the beacon failed when it was left swarmed (that led to capping the drain at 4 enemies). Smoke frame times are unchanged (avg about 0.4-0.6 ms per step).

## Risks / not done
- Thorn ticks make the meadow the easiest biome for environmental kills. If it feels too generous, lower `hazardTuning.thornTick`.
- Hosts remove broken cover colliders by rebuilding the `StaticBoxGrid`, as barrels already did. That's fine for a few breaks a second, but would get slow with hundreds.
- The minimap (not in this lane) doesn't show objective targets. The HUD arrow and light beams cover that.
- Endless mode keeps one arena, so it keeps that arena's objective (done stays done) through later waves.
- Decision-log paragraph for PLAN.md (for the lead to paste):
  > 2026-10-19: Arena toys (lane arena). Crates break, pillars topple and crush, 3 jump pads and 2 turrets per stage, biome hazards that kill (lava knock-ins, ice splats, quicksand, thorns) with ENVIRONMENTAL KILL bonus score, barrel CHAIN counter, and one seeded optional objective per stage (totems, beacon, shards, env kills) paying gold, score and a chest per hero. New arena pieces are generated after the old layout, so seeds keep their maps. Arena state syncs in the snapshot (`ar`). Clients jump locally and tell the host (`jump`).
