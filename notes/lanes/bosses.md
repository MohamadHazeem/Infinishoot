# Lane: bosses

## What players get
- **Three-phase bosses.** King Bopper, Rampage Rex and Hive Queen change phase at 66% and 33% life. A phase change is a moment: the boss stops, blinks and roars inside a gold shield ring (invulnerable, 1.4 s), the screen shakes and flashes, a banner names the phase ("PHASE 2! SHOCKWAVE SLAMS: DASH THROUGH THE RINGS", "FINAL PHASE!"), enemy bullets near the boss are blown away, and the boss opens its new attack set with its signature move. Damage can't skip a phase: HP is clamped at the threshold. Omega Overlord keeps its own phases (60% / 25%) with the same treatment and gains shockwaves on phase-3 slams.
  - **King Bopper**: P1 rings, summons, jump slam. P2 slams chain two hops and every landing sends a **shockwave ring wall** that expands across the arena (dash through it: dashing heroes aren't hit). P3 three-hop slams with two rings each, double bullet rings, and a Bopper guard dropped around you.
  - **Rampage Rex**: charges **smash straight through cover** (debris, shake, barrels blow) and leave **burning ground**. P2 **figure-eight rampage**: the whole path is drawn as red dots for 1.1 s, then Rex runs it in 2.8 s. P3 **fire breath**: a red cone telegraph, then a 1.6 s sweep of short-range flames across it, leaving fire.
  - **Hive Queen**: plants **hives** (telegraphed landing) that hatch 3 Swarmers every 5.5 s until destroyed; each standing hive **heals her** (gold threads link them). P3 **swarm walls**: a 34 m line of stingers sweeps across with one gap (start line and gap telegraphed).
- **Arena twists while the boss lives**: King tremors drop rubble strikes around every hero (every 7 s, 5 s in P3); Rex scorched earth (burning ground from charges and breath); Queen hive link (heal per hive); Omega orbital grid (a line of 7 strikes across you every 9 s, 6 s in P3).
- **Mini-bosses** from stage 2, halfway through the stage: a "MINI-BOSS!" banner and a 2.5 s ground warning, then Prince Bopper, Rex Jr. or Hive Princess (never a copy of that stage's boss). Same brains, two phases (50%), smaller, cyan bar under the timer, drops a chest, gears and gold like an elite. No arena twists, no fire trail.
- **Boss entrance cinematic** (~2.2 s): letterbox bars, camera pans and zooms onto the boss, big name card plus subtitle ("RULER OF THE BOUNCE"), roar, world in slow motion, boss idle and invulnerable. Any key, click or pad button skips. SETTINGS > BOSS INTROS turns it off (falls back to the old WARNING banner). The busy HUD bits are hidden during it.
- **Boss bar**: white tick marks at phase thresholds and "PHASE n / 3".

## Key numbers (src/game/bosses.ts `bossTuning`, `bossMoveTuning`; systems/bossFight.ts `miniTuning`; bossIntro.ts `introTuning`)
- Phases: King/Rex/Queen `[0.66, 0.33]`, Omega `[0.6, 0.25]`, minis `[0.5]` (`EnemyDef.phases`). Per-phase speed x1 / 1.12 / 1.25, pause x1 / 0.85 / 0.72 (Omega keeps its old enrage numbers). Roar 1.4 s, entrance idle 1.5 s.
- Shockwave 9 m/s to 22 m, hurt band ±0.55 m, 16 dmg x boss damage scaling. Fire 7 dmg per 0.5 s tick, 6 s (8 s in P3), max 24 patches. Breath ±0.6 rad, ~10 m. Hives max 4 (mini 2), heal 0.2% max HP per hive per second, HP = 180 x stage HP scaling. Swarm wall 6.5 m/s, 16 dmg, 4.6 m gap.
- Minis: arrive at 50% of the stage timer (not in the last 30 s, not in Boss Rush or PvP), HP = def HP (~30% of their boss's) x 0.6 x the stage's boss HP multiplier (~18% of a boss).
- Bot balance (god bot, Scattergun / Grenade / Thunderstorm, one run, numbers vary run to run): King 24 s, Rex 23 s, Queen 46 s, Omega 64 s, loop-2 King 28 s (PLAN baseline 32 / 25 / 33 / 64 / 29). A first pass with 0.6% hive heal and 6 hives let the Queen outheal the bot entirely; Rex with two eights per cycle took 63 s. Both were cut.

## Co-op / sync
- Host runs everything. The snapshot carries `bx` (src/game/bossField.ts `BossNet`): per boss/mini uid, phase, move, roaring flag, entrance seconds left; the mini-boss bar; shockwaves; fire patches. Clients advance shockwaves between snapshots and draw all telegraphs locally from synced enemy state (targetX/Z = figure-eight origin, lunge angle = heading / breath aim, `t` = progress). Roar banners, shakes, flashes, zones and sounds go through the vfx bus. Clients start the entrance from `bx` (each machine respects its own BOSS INTROS setting); a client skip is local, a host skip also ends the slow motion. No codec change (enemy record unchanged).
- Music: `music.setBossPhase?.(n)` is called on every machine when the stage boss's phase changes (1..3, 0 when the boss is gone); guarded, so it's a no-op until the music lane adds it.
- Sounds: uses `sfx.bossRoar` / `bossPhase` / `coverBreak` if the audio lane adds them (the recorded pack has boss_roar.mp3, boss_phase.mp3, cover_break.mp3), else falls back to the synth `boss` / `bossWindup` / `impact` cues.

## Files
- New: src/game/bosses.ts (tuning, phase gate, brains for all bosses, moved out of enemies.ts), src/game/bossField.ts (arena state, net pack/unpack, drawing), src/game/bossIntro.ts (cinematic), src/game/systems/bossFight.ts (Game methods: BossApi, HP gate, shockwave/fire/hive/wall gameplay, mini-bosses, net, HUD bar, render hook), tests/bosses.test.ts.
- Data: src/data/enemies.ts (`phases`, `miniboss`, `title` fields; prince, rexling, princess, hive defs; `MINI_BOSSES`, `miniBossForStage`).
- Small hooks: enemies.ts (boss tuning re-exported from bosses.ts, 3 Enemy fields, one dispatch case, Rex ignores walls while charging, `hive` model, optional `EnemyCtx.boss`), game.ts (method fields, 5 state fields, BossField/BossIntro construction, `boss` in the enemy ctx, `updateBossFight` in simulate), combat.ts (roar invulnerability, phase gate before kills), statuses.ts (minis drop like elites), spawning.ts (spawnBoss starts the entrance), runFlow.ts (clear on world reset), render.ts (render hook before the camera, HUD bar), netHost.ts / netClient.ts (`bx`), hud.ts + style.css (phase ticks, mini bar, cinematic), settings.ts + screens.ts (BOSS INTROS toggle), dev/testLinks.ts, CONTRIBUTING.md.

## Test links
- `?test&stage=1&bossnow&god` entrance; `&nointro` skips it.
- `?test&stage=2&bossnow&god&nointro&phase=2` (Rex figure-eight), `phase=3` (fire breath); stage 1 = King, 3 = Queen, 4 = Omega.
- `?test&stage=3&miniboss&god` the stage's mini-boss lands now.

## Unfinished / risky
- "Smashes through cover": arena props are merged meshes, so Rex passes through walls with debris instead of destroying them (destroying would need per-prop meshes and a wall-grid rebuild like barrels).
- Mini-bosses aren't `def.boss`, so freezes and the Nuke treat them like elites (full freeze time); recycling may teleport a far-away mini-boss closer.
- `EnemyCtx.onEnrage` (game.ts) is no longer called; phase effects live in `bossHpGate`.
- Not play-tested over a real two-machine connection; the net state round trip is unit-tested and the client path shares the solo drawing code.
- Bot boss times vary a lot between runs; the Queen (46 s) is the slowest regular boss now because the bot ignores hives. Tune `bossMoveTuning.hiveHeal` if players find her grindy.
