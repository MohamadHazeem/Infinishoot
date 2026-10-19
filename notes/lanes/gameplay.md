# Lane: gameplay (wave 1)

Mech suits, supply crates with super weapons, build-defining relics, enemy mutations, weapon overload, combo cash-ins, the chain-reaction finale and comeback mode.

## What players get

### Mech suit (rare drop)
- A mech suit drops rarely: 0.03% per normal kill (thinned with the horde like hearts and magnets), 4% per elite kill, never while one lies on the map or someone pilots one, and at most one every 90 s. It waits 40 s on the ground (a small spinning mech on a hazard pad with a yellow light pillar; it blinks in its last 5 s). Toast: A MECH SUIT DROPPED!
- Walk into it: you climb into a big yellow mech (two legs on hip pivots, open cockpit with you standing in it, arm cannons, shoulder missile pods, a beacon that blinks in the last 3 s) for **30 s**.
- Its weapons replace **both clicks**: two arm cannons (7 shots a second, alternating arms; your aim while you fire, else the nearest enemy within 20 m), a homing missile salvo every 2.4 s (6 missiles fanned out of the shoulders, 2.2 m blasts), and heavy steps (a thump and a small shake every 0.5 s while walking, every third step a **stomp** shockwave: 3.4 m blast). Your auto weapons keep firing from the mech; your special still works. The dash key parries instead of dashing (you can't dash in it).
- Heavy: x0.72 speed, +8 armour +4 per stage (most small hits do 1 damage).
- HUD: MECH SUIT row with a 10-segment bar and the seconds left (blinks in the last 5 s).
- When the time runs out: **EJECT!** A 6.5 m blast, debris, a flash and 1.2 s of i-frames.

### Supply crates and super weapons
- From 40 s into stage 1 (every 55-85 s after; max 2 on the map) a supply drop lands 8-18 m from a random living hero: SUPPLY DROP INCOMING!, a pulsing ring and orange flare smoke and light column mark the spot for 3 s while the crate falls under a white parachute, then it thumps down (dust, shake) and waits 25 s with a light pillar in its weapon's colour.
- Walk into it for its super weapon, which takes over the **left click** (the left-click weapon idles while it lasts):
  - **Minigun**: spins up from 8 to 30 shots a second while held, 420 rounds, 15 s.
  - **Railgun**: every 0.5 s a 30 m line of lightning that pierces everything in its 0.7 m width (170 damage, Shock), 14 shots, 15 s.
  - **Flamethrower**: a cone of 30 flame puffs a second (pierce 3, Fire: they burn), 12 s of fuel, 15 s.
- HUD: a row with the weapon's icon, its ammo (or fuel) bar and count, the seconds left when under 5. SPENT when it runs out.

### Build-defining relics (6, in src/data/relics.ts; Arsenal entries appear automatically)
- **Trigger Dash** (rare): dashing fires a ring of 10 rounds, and your weapons fire 40% faster for 1.2 s after.
- **Satellite Rounds** (legendary): while you fire, rounds gather in orbit around you (one every 0.3 s, up to 6), circle for 1.2 s, then launch at the nearest enemy.
- **Nova Heart** (rare): every 10th kill sets off a 4.2 m frost nova around you that freezes what it hits (0.5 s; bosses x0.15).
- **Adrenal Gland** (rare): below half life your weapons fire 35% faster and hit 15% harder.
- **Powder Keg** (rare): enemies you kill have a 20% chance to explode (2.4 m); the blast can chain (at most 6 kegs a step).
- **Combo Engine** (legendary): your damage grows with the team combo, +4% per multiplier step (x8 = +28%).

### Enemy mutations
- Any enemy alive for **40 s** mutates (oldest first, at most 30 mutants alive): x2.5 life, x1.25 speed, x1.3 damage, x1.22 size, a lime glow, a ring of six spinning spikes and a crown spike, a lime transformation burst and MUTATED! (rate-limited). Their extra attack: a ring of 6 spit bullets every ~4 s. Killing one pays x3 XP and score.
- Never: bosses, mini-bosses (`bossLike`), the Reaper, the Goldbug, eggs, swarm walls, PvP stand-ins. Elites do mutate. Enemies the director recycles closer keep their age, so stragglers you kite around come back mutated.

### Weapon overload
- **Definition** (`overloadEligible`): all six weapon slots are maxed. That means four auto weapons, each at its last level, partner-evolved, or a fusion; and both clicks with every track rank taken and their evolution chosen (`buildMaxed`), or at their last level for clicks without tracks. The special doesn't count.
- While eligible the hero shimmers gold (body glow plus a small gold ground ring) and the OVERLOAD meter fills over 25 s. Full: **OVERLOAD!** banner, a flash and shake, the special goes off, and for 5 s every weapon fires at x0.35 cooldowns with fire and right-click forced on, while a spinning spiral of star rounds (4 every 0.08 s, pierce 2, about 250 in all) sprays out across the screen. Then the meter starts over.

### Combo cash-in
- Once the team combo reaches the cheapest cost, a CASH IN COMBO panel shows under the combo counter: HEAL (40), BOMB (80), GOLD RAIN (150). Affordable rows light up; the cursor marks the selection.
- **Z** (pad D-pad left) switches the choice, **X** (pad D-pad right) cashes in. Both are rebindable (SETTINGS > CONTROLS: "Cash in combo", "Cash-in choice") and the prompts follow the device.
- Cashing in spends the **whole** combo (multiplier back to x1) for an effect that grows with the combo spent: HEAL gives every living hero 15% of max life +0.1% per combo (max 60%); BOMB is a blast around you (7 m +0.01 per combo, max 12; 40 +0.5 per combo damage) that also clears enemy bullets in it; GOLD RAIN drops 3 + combo/30 coins (max 25). Every cash-in in a stage raises all costs x1.5 (they reset next stage). Being hit still breaks the combo, so it's a push-your-luck call.

### Chain-reaction finale
- **Definition**: the stage's last enemies fall when the stage clears (the boss dies; Endless waves and Boss Rush clear the same way). At that moment every enemy still standing (the stage clear removes them), every corpse still tumbling (anim lane's corpse system) and every kill spot of the last 20 s goes off in a rolling chain of fireworks outward from the last kill (22 m/s, squeezed into 2 s, at least 25 ms apart, at most 90 detonations): coloured bursts, stars, rings and pops, CHAIN REACTION!, then CHAIN xN +score (5 x stage per detonation). Cosmetic plus that score.

### Comeback mode
- At or under 10% of max life (at least 1 life) with **no revives left** (`revivesLeft === 0`; the pet's revive doesn't count), your damage doubles until you heal back above that line. Your screen turns monochrome red (a CSS filter on the game canvas; milder with REDUCE FLASHING; the HUD stays in colour) with a flashing COMEBACK! / x2 DAMAGE UNTIL YOU HEAL line; teammates see a pulsing red ring and red glow on you.
- **For the sound lane**: `hero.comeback` (a getter on Hero, mirrored on clients through the snapshot) is true while it's on. `game.hero.comeback` is this machine's hero.

## Knobs (debug panel > "Gameplay: mech, crates, mutations", src/ui/debugGameplay.ts)
All in src/game/gameplay.ts: `mechTuning` (duration, drop chances, cooldown, speed, armour, cannon/missile/stomp/eject numbers, `powerExp`), `crateTuning`, `SUPERS` (ammo, time, damage per weapon) and `superTuning`, `overloadTuning`, `cashTuning` (tiers, growth, effect numbers), `mutationTuning` (incl. `enabled`), `comebackTuning` (incl. `enabled`), `finaleTuning`, `relicTuning`. `mechLook` (src/game/gameplayView.ts) for the model. Buttons: mech now, drop a mech, supply crate, overload now, comeback, +100 combo.
- **Damage scale**: mech, super weapon, overload, cash-in bomb and relic damage is x `director.hpMul ^ 0.8` (enemy life grows ~x8 by stage 5; this keeps them relevant without matching it), then the hero's stats and Mods as usual (all damage goes through `Game.damage`).

## Test links (src/dev/gameplayLinks.ts)
- `?test&god&nolevel&mech=0.3&spawn=bopper:10,zippy:6&spawnr=7&aim=1,0.3&move=0.3,0` the mech suit walking and firing.
- `?test&god&nolevel&mechdrop&crate=minigun&mutate=6&combo=95&frozen` a mech drop, a supply crate (landed after 3 s), six mutants and the cash-in panel.
- `?test&god&nolevel&crate=railgun&frozen&cam=0.8` with `--wait 1.6`: the falling crate's flare and ring.
- `?test&god&nolevel&super=railgun&swarm=60&aim=1,0&slowmo` the railgun beam (also `super=minigun`, `super=flamer`).
- `?test&god&nolevel&overload=go` a fully maxed kit whose overload fires at once (`overload` alone: the meter fills).
- `?test&god&nolevel&finale=2` with `--wait 2.6`: a crowd, then the stage clears and the chain goes off.
- `?test&nolevel&comeback&spawn=bopper:6&spawnr=8&frozen&aim=1,0` comeback mode.
- `&combo=150&cashgo=1` cash in tier 1 after 1 s; `&mutafter=10`; `&relic=r_orbit,r_keg,...`.

## Co-op / netcode
- Host-authoritative. Per hero, `hero.play.net()` rides the hero snapshot as `gp`: [mech s, super index, super ammo 0..1, super s, overload 0..1, overload s, comeback, overload ready, ...satellite angles]. Team state rides the body as `gpw`: drops/crates `[id, kind, x, z, t]`, mutated enemy uids within interest, cash-ins this stage. Both go through the snapshot codec's generic fallback (no codec change); a few dozen bytes while something is active.
- Clients: draw the mech around any piloting hero, drops and crates (their flare smoke and thumps are host effects on the bus), satellites (angle = run time x 6 + offset on every machine, so they match the host's launch points), mutant spikes and tint (the client sets `mutated` and the scale on the mirror by uid), auras and glows. A client's own hero gets the mech's speed through `you.stats` and switches its dash off (`noDash`) from `gp`.
- Client -> host: `{t:'cash', k}` (Z switches the choice locally). Old hosts ignore it.
- Everything the lane fires is ordinary bullets (colours from the existing `BULLET_COLORS`, shapes from `bulletShapes`) and effects (the railgun beam is a burst with an `arc`). **Bullet kinds** are appended to `BULLET_KINDS` at runtime on first use (`registerKinds`, `GP_KINDS`), so no fixed numbers clash with other lanes' kinds; clients never see kinds.
- In-process host+client test: tests/gameplayCoop.test.ts. `npm run coop` not run (the broker is unreachable here).

## Files
New: src/game/gameplay.ts (tuning, `HeroPlay`, pure rules), src/game/systems/gameplay.ts (Game methods, net, autopilot helper), src/game/gameplayView.ts (meshes), src/game/weapons/super.ts (Minigun, Railgun, Flamethrower, MechArsenal: temporary weapons that only use WeaponCtx and aren't in `WEAPONS`/`hero.weapons`), src/ui/gameplayHud.ts (CSS injected), src/ui/debugGameplay.ts, src/dev/gameplayLinks.ts, tests/gameplay.test.ts, tests/gameplayCoop.test.ts, tests/gpbench.bench.ts (balance harness, not run by `npm test`), notes/lanes/gameplay.md.

Shared hot files, small edits:
- src/game/game.ts: one import, 12 method fields, `this.gameplayPreWeapons(dt)` before the weapons loop, `this.updateGameplay(dt)` after `updateHeroMechs`, `this.gpOnDash(h)` in `onDash`.
- src/game/hero.ts: `play = new HeroPlay()`, `get comeback()`, `play.reset()` and a `noDash` reset in `startRun`, `play.applyLive(stats)` at the end of `refreshLive`.
- src/game/enemies.ts: `mutated` / `mutAge` / `mutT` on Enemy (reset in `reset`), one line in the render flash chain (lime glow for mutants, before the elite-modifier glow).
- src/game/systems/statuses.ts: `this.gpOnKill(e, source, by)` in `killEnemy`, `gpBulletBlast` at the top of `bulletBlast` (mech missiles), a `GP_SOURCE_NAMES` line in `sourceName`.
- src/game/systems/spice.ts: `this.gpFinale()` at the top of `stageClear` (before the leftover horde is removed).
- src/game/systems/netHost.ts: hero `gp`, body `gpw`, `cash` message. src/game/systems/netClient.ts: apply both, `gameplayClientInput(control)`. src/game/systems/render.ts: `renderGameplay` after `renderHeroMechs`.
- src/core/keybinds.ts: actions `cash` (X) and `cashpick` (Z), `PAD_CASH` [15], `PAD_CASHPICK` [14]. src/ui/prompts.ts: pad names for 13-15, `cash`/`cashpick` in `PAD_OF`.
- src/ui/hudLayout.ts: the three panels join the UI SCALE selector list. src/ui/debugPanel.ts: `addGameplayFolder`. src/dev/testLinks.ts: `gameplayLinks`.
- src/game/autopilot.ts: `cash` in `PilotIntent`, `pilotGameplay` bends the move toward a nearby landed crate / mech drop and picks a cash-in. src/dev/bot.ts: presses X with the chosen tier.
- src/data/relics.ts: 6 relics appended. scripts/icons.mjs + regenerated src/data/iconArt.ts: +10 icons (bullet-impacts, orbit, ice-bolt, pulse, barrel, infinity for the relics; minigun, laser-gun, flamethrower, battle-mech for the HUD).
- tests/smoke.test.ts: the mortal run's forced finish also spends the Guardian pet's revive (with this lane the bot can outlive the 900 s budget with the pet's revive unused, and the pet picked it straight back up).

## Verification
BALANCE_PLACEHOLDER

## Unfinished / risky
- **Not played by a person**, and `npm run coop` (two real browsers) not run: co-op is covered by the in-process host+client test only.
- **The mech replaces the clicks, not the auto weapons.** Stopping auto weapons would freeze their meshes mid-air (drones, discs) since only update() moves them; the brief says "its own weapons replacing the hero's". Idling works for clicks because they read the fire buttons. In the mech the dash key parries (the skill layer treats no-dash heroes that way).
- **Super weapons and the mech scale with enemy life** (`hpMul^0.8`), not with the hero's build; strong late builds outdamage them, early they are a big spike (see the boss times). `powerExp` and `SUPERS[].dmg` are the knobs.
- Mutations add pressure in long fights (bosses that drag on, kiting bots); `mutationTuning.after` / `maxAlive` are the knobs. The mortal bot (no real dodging) is not a good judge.
- No minimap/edge pointer for supply crates or mech drops (the light pillars and toasts are the cue). The wave-2 sound lane may want crate/mech/overload/cash-in cues (the lane uses existing ones: telegraph, bossSlam, impact, evolve, powerUp, legendary, jingle).
- The comeback filter is a CSS filter on the game canvas (cheap, but it's a full-screen compositing pass while on).
- Overload forces `ctx.firing`/`ctx.charging` for 5 s; a right-click weapon that fires on release pulses (0.5 s held, 0.2 s released).
- HUD per-frame state object allocations (small; the DOM is only touched on change).

## PLAN.md decision-log paragraph
- 2026-10-19: Gameplay lane (notes/lanes/gameplay.md). Mech suits (rare drop: 0.03% per kill thinned with the horde, 4% per elite, one per 90 s): 30 s in a big mech whose arm cannons, homing missile salvo and stomping steps replace both clicks (auto weapons keep firing), x0.72 speed, +8 +4/stage armour, an eject blast at the end. Supply crates fall from the sky every 55-85 s (flare, parachute, thump) with a Minigun, Railgun or Flamethrower that takes over the left click for 15 s or its ammo. Six rule relics (Trigger Dash, Satellite Rounds, Nova Heart, Adrenal Gland, Powder Keg, Combo Engine). Enemies alive for 40 s mutate (x2.5 life, faster, spiky, lime, spit rings; never bosses; x3 rewards). Weapon overload when all six weapon slots are maxed (4 maxed auto weapons + both clicks fully ranked and evolved): a meter fills over 25 s, then 5 s of x0.35 cooldowns, forced fire and a star-spiral barrage. Combo cash-in (X, choice on Z; D-pad right/left): spend the whole team combo on HEAL 40 / BOMB 80 / GOLD RAIN 150, effects grow with the combo, costs x1.5 per use per stage. A chain-reaction finale of fireworks over the leftover horde, corpses and recent kills at every stage clear. Comeback mode at <= 10% life with no revives: x2 damage and a red screen until healed (`hero.comeback` for the music). Lane damage scales with enemy life ^0.8. Lane bullet kinds register into BULLET_KINDS at runtime (no fixed numbers). BALANCE_LOG_PLACEHOLDER
