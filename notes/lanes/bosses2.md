# Lane: bosses (wave 1): the Titan, boss rematches, the boss duel

(The first bosses lane, phases / mini-bosses / entrances, is notes/lanes/bosses.md.)

## What players get
- **Titan Goliath**, an arena-sized boss. In loop 2 it takes one boss slot per loop (stage 6 = Rex's slot in loop 2, stage 11 = the Queen's in loop 3, stage 13 = the King's in loop 4, and so on). Omega always ends the loop, so endings and VICTORY don't change.
  - **Entrance**: the usual title card ("TITAN GOLIATH · THE MOUNTAIN THAT WOKE UP"), while a colossal stone golem climbs out of the ground about 12 m north of the heroes over 3 s. Cover where it comes up is smashed, and dust, debris and shakes play.
  - **Its body is terrain.** The torso and the head are wall colliders: you run around them, enemies path around them, and shots hit the stone. The arms lie across the field as low walkable bridges until one lifts to sweep.
  - **Five weak points, broken in order**, each an enemy with its own HP: phase 1 two gold **armour plates** on the shoulders; phase 2 two cyan **hand cores** riding on the fists, which move with the sweeps; phase 3 the red **eye**. Then the **head cracks open** (its wall goes away) and phase 4 exposes the gold **core**, the boss itself. Weak points of later phases are sealed (dim, can't be hit) until their phase, so auto weapons don't waste shots on them. A broken one explodes, drops 3 gold and shows "WEAK POINT!", and each group that breaks gives a phase banner ("ARMOUR BROKEN: SMASH THE HAND CORES", "HANDS DOWN: SHOOT THE EYE", "THE CORE IS EXPOSED!").
  - **Attacks**, all telegraphed. **Arm sweep**: the arm rises for 1.3 s under a red sector showing the arc it will cover, then slams down and drags across the ground in front of the Titan; dash through it or get out of reach. **Double sweep**: both arms, staggered 0.75 s. **Eye beam**: a red aim line tracks you for 1.1 s and locks just before firing, then a 36 m beam fires for 1.7 s and turns slowly toward you; once the eye is gone the beam fires from the core. **Debris rain**: telegraphed ground strikes around every hero. **Quake** (phase 2+): both arms rise, then the chest slam sends shockwave rings out (one ring in phase 2, two from phase 3); dash through them.
  - **Boss bar**: "TITAN GOLIATH · 3 WEAK POINTS" (or "CORE EXPOSED"), PHASE n / 4, ticks where each group's share ends, and a row of **weak-point pips** under the bar (lit = can be hit, dim = sealed, dark = broken, gold = the core).
  - **Camera**: while it stands, the auto zoom pulls out to at least x1.7, and in solo the view leans up to 6 m toward the body so the weak points stay on screen. Co-op keeps its team framing and only gets the zoom.
- **Boss rematches.** From loop 2, a regular boss you already beat this run comes back remixed, with its own palette, name, entrance subtitle, phase subtitles and a "REMATCH!" toast:
  - **King Bopper EX** ("THE BOUNCE STRIKES BACK", plum and gold): shockwave rings from phase 1, a 12-bullet ring on every landing, veteran Boppers and Swarmers.
  - **Rampage Rex: Inferno** ("EVERYTHING BURNS", red and gold): fire breath already in phase 2, burning ground from every charge, a 4-arm spiral.
  - **Hive Queen: Nightshade** ("THE SWARM REMEMBERS", night blue and lime): swarm walls from phase 2, 9-bullet fans, one extra hive per planting, veteran Zippies.
  - Each has x1.15 the original's HP (stage scaling still applies) and x1.5 XP and score. They keep their original's voice, portrait art (in their own colours), boss lines and arena dressing.
- **Boss duel.** When a stage boss (not the Titan) enters its last phase: "SHOWDOWN! <BOSS> · ONE ON ONE". The horde vanishes in a puff (no drops; pickups on the ground stay; the boss's hives stay), enemy bullets clear, the director stops sending more, and a **ring of fire** flares up around the boss and the heroes. After 1.4 s it closes over 11 s down to 9 m (or 3.5x the boss's radius, if that's bigger). Outside the ring you burn for 5% of max life every 0.5 s, through armour. The boss is held inside it. Stage events (Elite Parade, swarm rings) can't send anyone in either. Camera beat: a shake as the ring flares up, then the auto zoom pulls back to frame the whole ring and eases in as it closes. A "SHOWDOWN · STAY IN THE RING" tag sits under the boss bar. In co-op the ring starts big enough to hold every living hero (capped at 30 m). With REDUCE FLASHING the ring, sector telegraphs, beam and pips don't flicker, and flashes go through the HUD's reduced flash.

## For other lanes
- `game.bossDuel` (src/game/game.ts, type `BossDuel` in src/game/bossDuel.ts) is non-null on **every machine** while a duel plays: `{ uid, x, z, r, r0, r1, t }`, where `t` = seconds since it began. The wave-2 sound lane can switch the music to a call-and-response duel while it's set. The music boss-phase API keeps working: `music.setBossPhase` gets 1..3 (the Titan's phase 4 reports as 3).
- `director.hold` (src/game/director.ts): no trickle spawns while true (the duel sets it, `start()` clears it). `spawnEnemy` and `spawnRing` (systems/spawning.ts) also refuse while `game.bossDuel` is set, which covers stage events; boss summons (`spawnChild`) still work.
- `bossLike()` now also covers Titan weak points (`EnemyDef.titanPart`): they take the Nuke's 15% bite, aren't recycled and resist freezes.
- `EnemyDef.remixOf` / `remix` / `remixLines`: a rematch's original and its brain flags. The boss dressing (src/world/worldRender.ts) builds from `remixOf ?? id`.
- Hidden enemy defs no longer leave corpses (systems/anim.ts onCorpse); the Titan draws its own fall.

## Key numbers (tuning objects, all in the debug panel's "Titan, rematches & duel" folder)
- `titanTuning` (src/game/titan.ts): rise 3 s; walls from 35% risen; zoom x1.7; lean 6 m; pace between attacks 2.0 / 1.6 / 1.3 / 1.05 s per phase; 2.2 s pause after a group breaks; sweep telegraph 1.3 s, swing 0.7 s, arc 1.75 rad, half-width 1.3 m, 22 damage; double-sweep stagger 0.75 s; beam aim 1.1 s, firing 1.7 s, turning 0.55 rad/s, 36 m long, 1 m half-width, 9 damage per 0.2 s tick; debris 4 / 5 / 6 / 8 strikes around each hero, 20 damage; quake shockwaves use `bossMoveTuning.shockDamage`. All damage is x the Titan's damage scaling.
- Titan HP (src/data/bossRemix.ts): def 8,500 (x the stage's boss HP curve, like every boss). Shares: plates 12% each, hand cores 12% each, eye 16%, core 36% (`TITAN_PARTS`, `TITAN_CORE_SHARE`). The boss-bar ticks (0.76 / 0.52 / 0.36) come from the shares.
- `remixTuning`: rematches from loop 2; Titan from loop 2; `titanSlot(loop)` rotates its slot.
- `duelTuning` (src/game/bossDuel.ts): delay 1.4 s, closing 11 s, final radius 9 m (or boss radius x3.5), start radius = farthest hero + 4 m (capped at 30), burn 10% max life per second in 0.5 s ticks, camera pull-back up to x1.8 to frame the ring.

## Co-op / sync
- The host simulates everything. The boss extras in the snapshot (`bx`, src/game/bossField.ts `BossNet`) gain `t` (`TitanNet`: uid, body centre, rise, phase, arm angles and lifts, sweep clocks, beam mode and angle, weak-point life and uids) and `d` (`DuelNet`). They go through the snapshot codec's generic fallback, so there are no codec changes and the enemy record is unchanged.
- The Titan core and its weak points are ordinary (hidden) enemy records, so clients get their HP and hit flashes. Clients rebuild the same body colliders from the synced centre (rounded to 0.1 m on the host), so their own movement collides locally; they drop the head wall in phase 4. Sweep clocks and the duel radius run on between snapshots.
- Banners, toasts, sounds, bursts, shakes and flashes go through the vfx bus. The camera beat and the ring's look are local.
- Tested in-process (tests/bossLane.test.ts): host and client walls, sealed and open weak points, every phase, the head wall going, the core kill clearing the stage on both, and the duel reaching the client and ending on both.

## Files
- New: src/data/bossRemix.ts (remix table, Titan defs and shares, the stage-boss rotation `stageBossId`), src/game/titan.ts (layout, pure geometry, state, net, TitanView), src/game/bossDuel.ts (ring math, net, DuelView), src/game/systems/bossLane.ts (Game functions: which boss, Titan spawn and brain, weak points and phases, walls, duel, net, render, camera, HUD), src/ui/bossLaneHud.ts (pips and duel tag, CSS injected), src/ui/debugBosses.ts, src/dev/bossLinks.ts, tests/bossLane.test.ts.
- Small hooks in shared files: data/enemies.ts (2 behaviours, 4 optional def fields, one registration line, remix materials), enemies.ts (one dispatch case), bosses.ts (Titan pass-through, remix flags in the King/Rex/Queen brains, a `titan` entry on BossApi), bossField.ts (2 optional BossNet fields), systems/bossFight.ts (hook calls: boss api, step, HP gate, intro toast, net, render, HUD bar, music phase clamp, Inferno's fire rate), bossRules.ts (`titanPart` in bossLike), director.ts (`hold`), game.ts (`bossDuel` field), spawning.ts (2 lines in spawnBoss, a duel guard in spawnEnemy and spawnRing), runFlow.ts (clearWorld hook), render.ts (camera hook after the camera director), anim.ts (no corpses for hidden defs), autopilot.ts (the bot aims at open weak points), world/worldRender.ts (dressing for remixes), debugPanel.ts and testLinks.ts (one line each), CONTRIBUTING.md (test links), tests/worldGame.test.ts (its dressing check moved from stage 6, now the Titan's, to stage 5).

## Test links
- `?test&stage=6&bossnow&god`: the Titan the normal way, entrance included (add `&nointro` to skip it).
- `?test&stage=6&bossnow&god&nointro&titanmove=sweep2`: double arm sweeps only. `titanmove=beam|sweep|debris|quake` work the same way.
- `?test&stage=6&bossnow&god&nointro&titanphase=4`: the earlier weak points break once it has risen, so the core is exposed. `titanphase=2|3` work the same way.
- `?test&stage=2&bossnow&titan&god`: the Titan on any stage.
- `?test&stage=5&bossnow&remix&god`: King Bopper EX. Stage 2 gives Rex: Inferno, stage 3 Nightshade.
- `?test&stage=2&bossnow&duel&god&nointro`: straight into Rex's last phase, which starts the duel.
- Screenshots read best with `&biome=meadow&day&nolevel&noweather`.

## How it was verified
- Screenshots, each one looked at:
  - Titan entrance: the title card while the mossy back and crystal spikes break the surface.
  - Titan in phase 1: head, eye, gold plates and both arms on screen with the camera pulled back.
  - A double sweep: the red sector, then the arm swinging across the front.
  - The eye beam in phase 2: the beam from the eye through the hero.
  - Phase 4: the head tipped open with the glowing core inside, the pips all dark except the core.
  - King Bopper EX: its title card, plum body, phase-1 shockwave ring and its own pop-in portrait.
  - Rex's duel: the SHOWDOWN banner and the ring of fire, then the closed ring.
- `npm run typecheck`, `npm test` (40 files; bossLane.test.ts has 69 checks) and `npm run smoke` pass. One `npm test` run failed tests/arenaCoop.test.ts "client mirrors broken cover and falling pillars". It passed on the rerun and on 6 more runs, so it looks like a random-layout flake in that test, not something this lane touches.
- `npm run bench`: the build machine was saturated (other lanes were benching and building at the same time; SwiftShader drew 1.5 fps), so the absolute numbers mean nothing. The base commit and this branch were run back to back: draw calls 132 / 130 avg, and `sim.boss+recycle` (which now includes this lane's step) 0.021 / 0.016 ms. Every other phase swung by up to 15x between the two runs, including phases this lane doesn't touch, so the frame time can't be compared. **Re-bench on a quiet machine before merging.** None of the new code runs in the bench scene (no Titan, no duel) apart from a few per-frame null checks.
- God-bot balance runs: standard mode, normal difficulty, Scattergun / Grenade / Thunderstorm, one run each with random seeds, so the numbers vary a lot run to run. Times run from the boss spawning to it dying, so the Titan's include its 3 s rise.

  | Run | King | Rex | Queen | Omega | King EX | Titan | Nightshade |
  |---|---|---|---|---|---|---|---|
  | Titan HP 3,400 | 15 s | 12 s | 8 s | 21 s | 27 s | 17 s | 13 s |
  | Titan HP 8,500 | 12 s | 12 s | 11 s | 15 s | 5 s | 23 s | – |
  | Duel turned off | 19 s | 9 s | 10 s | 15 s | – | – | – |

  The Titan now takes about twice as long as a regular boss in the same run. The duel shows no clear effect on boss times. Nothing errored in any of the runs.
- The duel framing: a probe of `cam.auto` showed the duel pulling the zoom out to 1.43 at r = 13 m, then 1.17 at r = 10.6 m. A first version reused the boss kill-cam, which held a x0.6 close-up for 2.6 s and hid the ring; it was replaced.

## Unfinished / risky
- No person has played any of this. The Titan's attack damage and pacing come from reading the code and from god-bot runs; the bot doesn't dodge, so how fair the sweeps and beams feel is untested.
- The Titan always faces south (toward the camera) and stands north of the heroes. It's clamped to the arena, so heroes right at the north edge can end up beside or behind it. Behind it they are out of reach of the sweeps, which is a safe spot.
- Heroes standing where the torso comes up are pushed out by the wall collision; nothing teleports them. Gems under the torso stay there until the magnet pulls them out.
- The arms are walkable visually only: there's no height, so heroes walk through the low arm slabs.
- The Titan has no portrait art (it gets the generic boss blob), no recorded voice, no boss lines, no arena dressing and no music of its own. It uses the stage's rotation boss track (Rex's on stage 6). The sound and cinematics lanes could add these.
- The Titan is hidden from the Codex (hidden defs are filtered out); the Enemy Guide lists its parts once met.
- The duel removes the horde for the last phase. Bot boss times showed no clear change (table above), but its feel (the ring's damage and closing speed) has only been seen in screenshots. A mini-boss still alive when the duel starts stays (it's boss-like).
- One headless screenshot during the eye beam came out blank (HUD fine, 3D scene empty). Three re-runs of the same link (8 more frames) never reproduced it and no error was logged; it looks like a SwiftShader hiccup, but it isn't proven.
- The `?duel` link and the existing `phase=` link push the boss through the debug phase path. Setting it above the boss's last phase sets its HP to 0 without killing it (an old quirk); `duel` uses 3.

## PLAN.md decision-log paragraph (ready to paste)
- 2026-10-19: Bosses lane, wave 1 (notes/lanes/bosses2.md). **Titan Goliath**: an arena-sized boss that takes one boss slot per loop from loop 2 (stage 6, then 11, 13...; Omega always ends the loop). It climbs out of the ground north of the heroes. Its torso and head are wall colliders on every machine (clients rebuild them from the synced centre); its arms are walkable bridges until they sweep. Five weak points are hidden enemies pinned to the body and break in order: 2 armour plates, 2 hand cores that ride the sweeping arms, then the eye. Later ones stay sealed until their phase, then the head opens and the core (the boss enemy) can be hit. Shares of its life: 12/12/12/12/16% plus a 36% core, so the boss-bar ticks fall at 0.76/0.52/0.36 and pips under the bar show each weak point. Attacks: telegraphed arm sweeps (dash through), a tracking eye beam, debris strikes and quake shockwaves. The camera pulls out to x1.7 and, solo, leans 6 m toward the body. Def HP 8,500 (x the boss stage curve): at 3,400 a god bot killed it in 17 s, because area damage hits two weak points at once. **Rematches**: from loop 2 a boss beaten this run returns remixed as data (src/data/bossRemix.ts), with brain flags in bosses.ts and x1.15 HP. King Bopper EX gets shockwaves from phase 1, bullet rings on landing and veteran summons. Rex: Inferno gets fire breath from phase 2, burning charges and a 4-arm spiral. Hive Queen: Nightshade gets swarm walls from phase 2, 9-bullet fans and an extra hive per planting. **Boss duel**: a stage boss's last phase clears the horde (no drops), holds the director (`director.hold`) and closes a ring of fire from around everyone to 9 m over 11 s. Outside it burns 10% max life per second through armour, and the boss is held inside. `game.bossDuel` is set on every machine for the music. Both travel in the snapshot's boss extras, with no codec change. God bot (Scattergun / Grenade / Thunderstorm, single runs): King 12-15 s, Rex 12 s, Queen 8-11 s, Omega 15-21 s, King EX 5-27 s, Titan 23 s at HP 8,500, so about twice a regular boss in the same run. A run with the duel turned off showed no clear change in boss times.
