# Lane: content (biome foes, mechanic heroes, evolution shapes)

> **Merge note (v1.6.0 merge):** main added its own burrower, so the Sand Shark's behaviour is `shark` and its data field `shark` (was `burrower` / `burrow`). The Gust Kite lives on main's Sky Fortress (`biomes: ['sky']`).

## What players get

### Biome-native enemies (one per biome)
Each joins only its own biome (`EnemyDef.biomes`, honoured by the director's pool, so elites too), has a readable telegraph, a veteran version and an Enemy Guide tip ("BRIGHT MEADOW ONLY" etc. instead of "FROM MINUTE").
- **Bumble Bee** (meadow, stage 1 from ~0:38, packs of 3-5): circles you at 6 m, then an orange dive line shows for 0.75 s and it dives straight through you (17 m/s for 0.6 s). Bees within 4 m fall in behind it on the same line, 0.14 s apart, so packs dive in columns.
- **Sand Shark** (dunes, stage 2 from ~0:24): swims under the sand where nothing can hit or touch it (`Enemy.under`, `alive` is false). Only a fin and a sand ripple show. In range it marks a red ring under you (follows you for half the 0.8 s wind-up), bursts out in a 0.45 s leap (bite: 16 damage within 2 m), then lies exposed for 2.2 s before diving again.
- **Snowball Roller** (peaks, stage 3 from ~0:24): rolls in wide arcs (1.4 rad/s turn, less as it grows) and grows a step every 2.6 m rolled, up to 7 steps (x2.4 size; life and damage grow with it). From step 3 a pale heading line shows, and it shatters on cover or on you (18 damage within 2.4 m x size, freezes enemies nearby for 1.2 s).
- **Lava Slug** (magma, stage 4 from ~0:24): leaves a burning puddle every 0.45 s it moves (0.85 m, 4 s, 12 dps); every ~6 s it swells for 0.9 s (orange ring closing in) and spills a 2.4 m puddle that lasts 6 s. Puddles burn heroes every 0.4 s (dash to cross safely).
- **Wind-up Soldier** (factory, loop 2, packs of 4-6): rewinds for 0.9 s (shakes, its march line lights up), marches straight for 4.2 s at 4.6 m/s, then winds down for 2.2 s, slumped and Exposed (+30% damage taken). Soldiers within 4 m that aren't busy fall into rank on the same heading, so squads march in formation.
- **Gust Kite** (sky ruins, loop 2): floats and keeps 7 m away. Every ~3.8 s a pale cyan wind cone (9 m, 32° either side) shows for 0.9 s, then a gust shoves heroes ~2 m (no damage) and other enemies in the cone along with it.

### Mechanic heroes (MODE screen, unlocked by new achievements)
- **Duelist** (Riposte: parry 25 times in one run). Slim and tall, red scarf and white plume. No dash: the dash key parries (also on clients). Parry window x1.8, whiff cooldown 0.4 s (normal 0.6). Every landed parry adds a chain stack: +12% damage each, up to 6, lasting 4 s without another parry ("CHAIN x3"). +5% crit. Ultimate BLADE DANCE (2.5 s, untouchable): every enemy bullet within 6 m flies back, the 4 closest enemies within 4.5 m are slashed every 0.15 s (4 x typical enemy life each), chain set to full.
- **Furnace** (Immovable: stand still for 20 s during a stage). Wide and squat, back chimney with a glowing mouth, shoulder plates. Heat builds while standing still (full in 3.3 s) and vents fast when moving (2.5/s). Damage +60% at full heat; from 30% heat a burning aura (2 to 4.5 m) hits every 0.5 s and ignites. Orange glow on the hero, aura ring, embers, chimney smoke. +30 life, 15% slower. Ultimate MELTDOWN (1.9 s, untouchable): full heat and four growing fire novas (4/6/8/10 m) that ignite.
- **Twin** (Double Trouble: evolve both your left and right click in one run). Small, cyan visor. A mini mirror twin stands at your other side (1.5 m, opposite the arm cannon) and fires its own copy of your left-click weapon (same level/build) at half damage. -10 life. Ultimate MIRROR STORM (3 s, untouchable): you and the twin alternate spinning rings (mirrored) and aimed fans.

### Evolutions that change shape, not just colour
- New bullet silhouettes (`src/game/bulletShapes.ts`), picked from the bullet kind, so every weapon that already fires those kinds gets them: Flare Buster, Dragon's Breath and Scorch Turret fire flickering **flames**; Flak Cannon and Star Cannon fire spinning **stars**; Volt Buster fires zig-zag **bolts**; Lance Shot fires a barbed **spear**.
- Storm Rail: forked lightning branches crackle off each trace (re-rolled 24 times a second).
- Cryo Sphere: the rings give way to a tilted snowflake of six ice crystals; the glow shrinks so they read.
- Cryo Well: a crown of ten ice spikes round the rim (held still while the swirl spins).
- Pyre Aegis: a fringe of flickering flame tongues licking outward from the shield's edge (solid colours so the glow pass doesn't wash them out).
- Thunder Mortar: a crackling ring with two spark prongs spins round each shell.
- Black Hole: Supermassive is a heavier ink-black swirl with dark dust and a violet core; White Hole a white-gold core with sparks (plain stays violet).
- Auto weapons: Buzzsaw Halo discs become red blades with 12 big white teeth; Aegis Swarm drones become hex shield plates (and their ring is gold-white, it was the enemy-bullet magenta); Hellfire Pod missiles get a nose cone and tail fins; Thunderdome crackles with seven zig-zag arcs.
- Already shape-distinct, left alone: Prism Lance (5 beams), Scorch Ray (one thick beam), Cluster Mortar (finned rounds), Event Horizon (black hole + disc), Mirror Aegis (dome), Sun Lance / Storm Barrage, Halo Beam (full circle), Storm Caller and the specials' other evolutions.

## Files
- New: src/game/biomeFoes.ts (behaviours, models, `biomeFoeTuning`, `LavaPuddles`, `syncSub`), src/game/biomeFoeView.ts (telegraphs, shark fins, puddles), src/game/systems/biomeFoes.ts (EnemyCtx `foe` api: puffs, snowball crash, kite gust; puddle burns; director biome), src/game/heroMechs.ts (`HeroMech`, `heroMechTuning`, `TwinClone`, hero gear), src/game/systems/heroMechs.ts (aura, chain, twin update/net/render, achievements), src/game/heroUlts.ts (three ultimates), src/game/bulletShapes.ts, src/dev/contentLinks.ts, src/ui/debugContent.ts, tests/content.test.ts.
- Owned data: src/data/heroes.ts (3 heroes, `mech`), src/data/enemies.ts (6 defs, `biomes`/`dive`/`burrow`/`roll`/`ooze`/`march`/`gust`, veterans, squads, `biomeAllows`), src/data/bestiary.ts (tips, `enemyHome`), src/data/meta.ts (3 achievements).
- Weapons (visuals only): buster/scatter/charge unchanged (shapes come from bullet kinds); rail.ts, orb.ts, well.ts, shield.ts, grenade.ts, discs.ts, drones.ts, missiles.ts, aura.ts; specials.ts (black hole swirl).
- Shared hot files, small edits:
  - game.ts: 2 system imports, 10 method fields, `foe:` in makeEnemyCtx, `this.updateHeroMechs(dt)` after the weapon loop, `this.updateBiomeFoes(dt)` after updateHazards.
  - enemies.ts: imports, `aggro` exported, `default:` model and behaviour cases, `Enemy.sub` / `Enemy.under` (+ `alive` checks `under`), `EnemyCtx.foe`, `!ignoresWalls(e)` in the wall check, the view's begin/enemy/end calls in render.
  - director.ts: `biome` field, `pool()` public and biome-filtered.
  - bullets.ts: `shape` array, shape meshes, render partition. codec.ts: enemy flag bits 5-7 also carry `sub`; bullet byte 11 carries the shape in bits 1-3.
  - hero.ts: `mech`, gear in setHeroDef, reset in startRun, `damageMul` in refreshLive, dispose. player.ts: `heatGlow`, `noDash`, `shove()`.
  - systems/skill.ts: dash key parries for no-dash heroes, window/whiff from the hero, `onParryLanded`. ultimates.ts: 3 ULTS entries + switch cases.
  - netHost.ts / netClient.ts: hero `tw` (twin weapon net), `shove` message, `syncSub`, `biomeFoesClient(dt)`. render.ts: `renderHeroMechs`. runFlow.ts: achievements + hero toast. statuses.ts: source names. screens.ts: biome label in the Enemy Guide. animMath.ts: gaits. debugPanel.ts: folder. testLinks.ts: `contentLinks`. tests/smoke.test.ts: three hero runs (the Twin with the Pulse Laser so the clone's own weapon instance runs).

## Co-op and PvP
- Biome foes: state, timer, lunge angle and target point were already synced; the new 3-bit `Enemy.sub` rides in the enemy record's flag bits 5-7 (boss action for bosses; biome foes never set an action, so the bits are free): shark underground (1), snowball size step (0-7). Clients apply it with `syncSub` (shark `under`, snowball scale/radius). Unit-tested.
- Lava puddles cost no traffic: every machine derives them from the synced slugs (`LavaPuddles.tick`); only the host burns heroes.
- Gusts shove remote heroes through a `shove` message (clients move themselves); the host shoves its own hero directly.
- Furnace heat is derived on every machine from the hero's synced velocity; damage is the host's. Duelist's `noDash` is set from the hero def everywhere, and the client sends `parry` on the dash key. Twin: the host runs the clone's weapon; its `net()` travels as the hero snapshot's `tw` and clients draw it with their own clone (position derived from the hero's position and aim). Bullets from the clone are ordinary bullets.
- Bullet shapes travel in the bullet record (unit-tested). PvP: the furnace aura and clone context skip the hero's own stand-in.

## Tuning (debug panel > Biome foes & heroes)
- `biomeFoeTuning`: puddleCap 160, puddleTick 0.4 s, crashFreeze 1.2 s, gustEnemies 0.6, sharkFin 1.3. Per-enemy numbers are in the defs (`dive`, `burrow`, `roll`, `ooze`, `march`, `gust`).
- `heroMechTuning`: duelist parryWindowMul 1.8, whiffCooldown 0.4, chainMax 6, chainDamage 0.12, chainTime 4; furnace stillSpeed 1.2, heatRise 0.3, heatDrop 2.5, damageMax 0.6, auraFrom 0.3, auraMin/Max 2/4.5, auraTick 0.5, auraDamage 8 (x power^0.9 x heat), burnDps 3; twin damage 0.5, side 1.5, back 0.35, follow 10, scale 0.62.
- `heroUltTuning` (heroUlts.ts): Blade Dance reach 6, slash 4.5 m / 0.15 s / 4 targets / 4x; Meltdown at 0.2/0.7/1.2/1.7 s, radii 4/6/8/10, 5/5/6/9x; Mirror Storm every 0.12 s, ring of 10, 1.6x.

## Test links (src/dev/contentLinks.ts)
- `foe=<id>:<state>[:n[:sub]]` spawns n (default 4) and pins them in a state aimed at you: `?test&god&stage=2&foe=shark:windup:3:1`, `?test&god&stage=3&foe=roller:move:3:6`, `?test&god&foe=bee:windup:6`, `?test&god&foe=soldier:windup:5`, `?test&god&foe=kite:windup:3`, `?test&god&stage=4&foe=slug:windup:3`.
- `evo=<weapon>:<0|1>` (or `evo=sp:0` for the special) takes a loadout evolution: `?test&god&loadout=scatter,charge,bomb&evo=scatter:1&aim=0,-1&nolevel`.
- `rclick=<s>` holds right click, releasing every s seconds; `special=<s>` fires the special after s seconds; `slowmo` runs the world at 35%; `nolevel` stops level-up menus.
- Heroes: `?test&god&hero=furnace&spawn=bopper:8&spawnr=4&nolevel`, `?test&god&hero=twin&aim=0,-1&loadout=laser,charge,bomb`, `?test&god&hero=duelist&parrygo=2`.

## Verification
- `npm run typecheck` clean. Unit tests all pass (tests/content.test.ts: 59 checks: data, director biome filter incl. elites over a full stage, codec sub-state and bullet shapes, snowball growth, shark burrow/bite cycle, puddles, heat, chain, heroes/unlocks). tests/arenaCoop.test.ts failed once in one full run ("client mirrors broken cover...") and passed three reruns: looks flaky and unrelated.
- Smoke (`npm run smoke` logic, run into a lane-local bundle dir): passes with three new runs: duelist (standard normal, stage 1, level 15), furnace (endless easy), twin (standard hard, laser; clone instance running). The existing heroes' skill test now covers the three new ultimates (each kills 12-34 of the test ring).
- Screenshots looked at: all six foes in their telegraph states (bee dive lines, shark fins + ripples + bite ring, big snowballs with heading lines, slug swell rings, soldier march lines, kite wind cones); Furnace hot with aura ring and glow; Twin clone firing a second laser; Duelist silhouette; Flak stars, Flare flames, Volt bolts, Lance spear; Storm Rail forks vs plain rail; Cryo Sphere snowflake; Cryo Well spikes; Pyre Aegis flames; Thunder Mortar ring; Supermassive vs plain Black Hole; Buzzsaw Halo, Aegis Swarm plates and Thunderdome arcs together.

## Unfinished / risky
- **Not run online.** `npm run coop` wasn't run (slow, and the shared node_modules/test bundles collide between lanes). Co-op paths are unit-tested at the codec level only: worth a two-instance check of a Twin client (clone weapon via `tw`), a Duelist client (dash key parry), gusts on a remote hero and sharks/snowballs on a client.
- **HUD**: the Duelist still shows the DASH pip (it never fills a purpose); the HUD lane may want to show the parry chain there instead. No HUD readout for heat or the chain beyond the glow and the "CHAIN xN" popups.
- **Balance is first-pass**: no bot balance runs per hero. The furnace aura and the twin (half a left click) are the likeliest to need tuning. The new enemies' numbers are guesses checked only in god-mode smoke runs.
- **Factory / Sky Ruins** don't exist in this worktree: soldiers and kites compile, are tested through the director filter with those ids, and only spawn once the world lane's biomes land with ids `factory` / `skyruins` (via `biomeForStage(arenaStage).id`).
- **Director biome** is set from `biomeForStage(this.arenaStage)` every step in `updateBiomeFoes`; if the world lane changes how the arena's biome is chosen (e.g. per loop), that call must follow it.
- Shark: its blob shadow still shows while it is under the sand (it reads as its position).
- Enemy codec: bits 5-7 are shared between the boss action and `sub`. A future non-boss behaviour that sets `e.action` and also uses `sub` would collide.
- Bullet shapes are chosen by bullet kind (`KIND_SHAPE`); if another lane renumbers kinds on merge, update that table.

## PLAN.md decision-log paragraph
- 2026-10-19: Content lane (notes/lanes/content.md).
  - Biome-native enemies, one per biome, filtered by a new `EnemyDef.biomes` in the director (elites too): Bumble Bee (meadow, dives in columns along a shown line), Sand Shark (dunes, untargetable under the sand, bites out of a red ring, then lies exposed), Snowball Roller (peaks, grows as it rolls, can barely turn, big ones shatter), Lava Slug (magma, burning puddle trail plus telegraphed spills), Wind-up Soldier (factory, rewinds then marches in rank, Exposed while wound down), Gust Kite (sky ruins, a wind cone that shoves you ~2 m). Clients see it through a 3-bit sub-state in the enemy record's boss-action bits; puddles are derived on every machine.
  - Three mechanic heroes with their own ultimates: Duelist (no dash, the dash key parries, longer window, parry chains up to +72% damage; Blade Dance), Furnace (heat while standing still: up to +60% damage and a burning aura; Meltdown), Twin (a mirror twin fires a copy of your left click at half damage; Mirror Storm). Unlocked by Riposte (25 parries in a run), Immovable (stand still 20 s), Double Trouble (evolve both clicks).
  - Evolutions now change shape: flame, star, bolt and spear bullet silhouettes by bullet kind (synced in the bullet record), Storm Rail forks, Cryo Sphere crystals, Cryo Well spikes, Pyre Aegis flame fringe, Thunder Mortar spark ring, a darker Supermassive swirl, buzzsaw blades, hex Aegis Swarm plates (no longer magenta), finned Hellfire missiles and Thunderdome arcs.
