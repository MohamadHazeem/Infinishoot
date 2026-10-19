# Lane: modes (wave 2): rhythm stages, the Pacifist road, bonus mini-games, ghost racing

## What players get

### Rhythm stage
- A stage variant where the field moves to the music. It comes from a new route node, **Rhythm Stage** (weight 2), and from a seeded 12% roll on any stage from stage 2 whose node is a plain one (start, elite, shop, treasure, event, rest, hard, arcade). It never rolls on Night Raids, the Pacifist road, Boss Rush or PvP. A toast says so when the stage starts.
- **Enemies step on the beat.** Their move speed pulses with the beat: x2.4 on the beat, falling to x0.3 just before the next one. On average that's x1, so the stage isn't faster or slower, it just lurches in time.
- **Attacks land on beats.** A wind-up that would finish between two beats waits for the next one. That covers every lunge, charge, fuse, shooter volley (spread, burst, sniper and spiral starts), spawner, medic, mortar and leaper, and every boss attack (King's rings, summons and slam take-offs, Rex's charges, spirals and breath, the Queen's fans and strikes, Omega). The only exception is the Reaper. Enemies also squash on every beat.
- **Kills on the beat score big.** A kill within 0.07 s before a beat or 0.13 s after it scores x3 and adds +1 combo. An ON BEAT! pop shows at most once per beat.
- **Seeing the beat:**
  - The floor around you is a disco checker. Tiles light up on each beat, the checker swaps each beat, and the colour cycles through cyan, yellow, green and sky.
  - The crosshair gets a beat frame. Four corner pixels close in on the crosshair as the beat nears, and the frame turns into a solid yellow square in the on-beat window.
  - A RHYTHM STAGE panel in the goals stack shows the BPM, four beat pips (the downbeat in yellow), your on-beat kills and an ON BEAT x3 chip that lights in the window.
- **The tempo is the song's tempo.** It uses the stage's biome song (Meadow 128, Dunes 112, Frost 120, Magma 140, Neon 124, Factory 136, Sky 132), then the boss theme once the boss is out (King 152, Rex 160, Queen 146, Omega 168), with no jump in the beat at the switch.
- **The audio follows the game, never the other way round.** Each frame, `music.alignBeat(phase)` moves the song's beat grid by at most 2 ms toward the game's beat clock, and only while the song the clock follows is the one playing. It locks on within a second or two. After a menu has frozen the world, it locks on again.

### Pacifist road (hidden)
- **A rare, hidden route node** (weight 0.6, against 2-3 for the others). The map shows it as **???** (a grey node, "A hidden road. Nobody knows where it goes") until it's the road taken. Picking it shows NEXT: PACIFIST ROAD.
- **The rules**, shown in a PACIFIST ROAD panel with a big timer, four rule lines and NO KILLS / REWARD LOST:
  - Weapons are holstered. No hero damage of any kind gets through `Game.damage`. Auto weapons, pets and turrets find no target (`nearestEnemy` returns null). The special and the ultimate won't fire. The clicks idle.
  - Dash and parry still work.
  - Enemies keep coming, 40% fewer than usual.
- **The boss is skipped. You survive a timer instead.** The stage lasts 2:00, not 4:00 (`director.lengthMul`), and there's no mini-boss either. When the timer runs out, YOU SURVIVED! shows and the stage clears as usual, with the clear gold, the heal and the shop.
- **Why skip the boss:** a boss can't be beaten without damage, and a survive-the-boss timer on top of the stage timer would only make the stage longer. A shorter, denser dodge stage keeps it tense.
- **The reward**, for each hero who made no kill:
  - 40 + 12 x stage gold
  - a relic (rarity-weighted, Luck helps)
  - a reroll gear
  - 6,000 x stage score
  - a **legendary level-up card**. The next level-up offers the rarest cards this hero can take: legendary auto weapons and items, evolution forks, legendaries from the normal pool, and when there are fewer than three, the rarest other cards. It comes right away, since the reward adds a pending level.
- **What counts as a kill:** any kill credited to a hero forfeits that hero's reward (a Nuke pickup, for example). Kills by the arena don't count (collapses, hazards, enemies' own blasts). The hero gets a toast the moment it happens.

### Bonus mini-games
- **A new route node, Bonus Arcade** (weight 2.5). When it's picked, a 20-second bonus game plays on the spot, after the shop and before the portal opens. Then the next stage is a normal stage.
- **Which game** comes from (seed, stage). They use the real field, camera, controls and HUD, with weapons holstered. A big counter at the top shows the game's name, a 3-2-1 countdown, the seconds left, your gold and your teammates' gold. TIME'S UP! lists everyone's haul.
- **The three games:**
  - **Shooting Gallery.** Boards on posts pop up 5-13 m around you (the spawn area is an oval squashed front to back, so it stays on screen). Aim and hold the left click: you get one hitscan shot every 0.28 s, with a dotted tracer. A target pays 1 gold, a gold target 3, and a dark bomb target costs 2.
  - **Coin Dash.** 4 coins land every 2 s and fade after about 4 s (they blink in their last second). A coin pays 1, a big one 4.
  - **Whack-a-Bot.** Little dome bots pop out of nine holes in a 3x3 grid for 0.9-1.45 s. Walk or dash onto one to whack it for 1 gold. A red bomb bot costs 2.
- **Gold:** values grow +15% per stage. A game's gold never goes below what you made in it.
- **Co-op:** everyone plays at once. Each hero earns their own gold, paid live by the host. Clients draw the game from the snapshot.
- **The dev bot plays them.** It aims at the nearest live target (gold ones first) and fires, runs coins down, and stomps bots that won't duck too soon.

### Ghost racing (Weekly Challenge)
- **What's recorded:** every weekly run records a ghost. That's the hero's position and facing at 10 Hz, stage starts and clears, boss kills, level-ups, death, and the score once a second (as the HUD shows it, heat multiplier included). Recording stops after an hour of play.
- **Your best run per week is kept** (by score, then stage, then time) in `infinishoot.ghosts.v1`, outside the save file. The last 8 weeks are kept. A NEW WEEKLY GHOST SAVED toast says so when a run beats it.
- **The ghost screen: EXTRAS > GHOST RACE.** It shows this week, your best run and who you race. The buttons are:
  - **COPY MY CODE**: copies a packed share code, and the code also appears in the box.
  - **SAVE FILE**: saves `InfiniShoot-ghost-<week>.isghost`.
  - **RACE PASTED CODE**: reads the code in the box. Any text around it is ignored.
  - **LOAD FILE**
  - **RACE MY BEST**: clears the rival.
  - With the optional online board built in, also **UPLOAD MINE** and **BROWSE ONLINE**, which lists the week's top 10 so you can pick one to race.
- **During a weekly run** the rival's ghost (or your own best, when no rival is picked) runs beside you. It's a see-through cyan chunky hero with a dark visor and a ground ring, under a name tag (NAME (GHOST) / YOUR GHOST). It only shows while it's on your stage and still alive. The GHOST RACE panel shows +/- points ahead and +/- seconds. The seconds are how much sooner you reached your current score than the ghost did.
- **A rival from another week** is kept, and the screen says which week it shows in.

## Determinism and co-op
- **The beat clock** is gameplay, so it never reads audio.
  - `beat(t) = b0 + (t - t0) * bpm / 60`. `t` is the stage's rhythm time, which the host advances by real step time in `update()` (`modesTick`). The clock keeps running through hit-stops, finishers and slow motion, like the music does. Only menus that freeze the world stop it.
  - The tempo comes from the same `TRACK_BY_ID[...].style.bpm` the music plays, chosen from the game state (biome song, or the boss theme once a boss is out). `setTempo` keeps the beat position continuous.
  - **Clients** get `md.rh = [bpm, t0, b0, t]` in each snapshot and run the same function. They advance their own `t` between snapshots, but by at most 0.12 s past the last host time, and ease toward the host's `t` on every snapshot. In the in-process test the client stayed within 0.036 beats of the host on a stage, and within 0.043 beats through the boss tempo switch and the entrance slow motion.
- **The host decides** on-beat kills, attack holds, pacifist kills and rewards, and all mini-game outcomes.
- **Snapshot field `md`** (null when nothing is on) goes through the compact snapshot codec's generic fallback, so there's no codec change: `{ rh, ob (on-beat kills per hero), pc: [seconds left, kills per hero], mg: miniNet }`. The mini-game record is [kind, phase, t, centre, gold[], hits[], items (id, kind, x, z, age, life, by, hitT), stage, holes]: under 600 bytes with a full Coin Dash.
- **No new messages.** Clients' fire and aim already reach the host. The route vote decides the Bonus Arcade and the Pacifist road. When the arcade starts, the host closes the map for everyone (`{t:'route', open:false}`).
- **Seeding:** mini-game layouts are seeded from (seed, stage), and the rhythm roll from (seed, stage). The hidden node is a display alias (`secret`) applied in `routeViewFrom`, so `routeLayer` is unchanged and so is the map's determinism.

## Knobs (debug panel > "Modes: rhythm, pacifist, mini-games, ghosts", src/ui/debugModes.ts)
- `rhythmTuning` (src/game/modes/rhythm.ts):
  - `enabled`, `chance` 0.12, `fromStage` 2
  - `early` 0.07, `late` 0.13 (s)
  - `killScore` 3, `comboBonus` 1
  - `low` 0.3, `sharp` 2 (the step pulse)
  - `bob` 2.5, `align` 0.002 (s of music shift per frame)
  - Buttons: Rhythm stage now, Back to rolled.
- `pacifistTuning` (src/game/modes/pacifist.ts):
  - `seconds` 120, `count` -0.4
  - `gold` 40, `goldPerStage` 12, `score` 6000
  - `weight` 0.6 (documentation only: the weight that counts is in `ROUTE_NODES.pacifist`)
  - Button: Pacifist road now.
- `miniTuning` (src/game/modes/minigames.ts):
  - `intro` 2.5, `play` 20, `outro` 3, `stageMul` 0.15, `depth` 0.6
  - Gallery: `galleryEvery` 0.55, `galleryUp` 1.8, `galleryShot` 0.28, `goldShare` 0.12, `bombShare` 0.14, values 1 / 3 / -2
  - Coins: `coinEvery` 2, `coinWave` 4, `coinLife` 4, `bigShare` 0.08, values 1 / 4
  - Whack: `whackEvery` 0.45, `whackUpMin`/`Max` 0.9 / 1.45, `whackBomb` 0.18, value 1
  - Buttons: one per game.
- `ghostTuning` (src/game/modes/ghost.ts): `hz` 10, `scoreHz` 1, `maxSeconds` 3600, `alpha` 0.55. Button: race a demo rival.

## Test links (src/dev/modesLinks.ts)
- `?test&god&rhythm&spawn=shooter:4,bopper:6&spawnr=8&cursor=0.62,0.42`: a rhythm stage. `&cursor=x,y` parks the mouse so the crosshair beat frame shows. `&rhythmoff` forces it off. `&node=rhythm` gives the route node.
- `?test&god&stage=2&pacifist&pact=40&spawn=bopper:8&spawnr=6`: the Pacifist road, 40 s in (`&node=pacifist` works too).
- `?test&god&minigame=gallery&mgt=5` (or `coins`, `whack`): a mini-game now, 5 s into its play time.
- `?test&god&ghost=demo&ghostlead=3`: race a made-up rival. It circles near the start, scores 45 points a second and runs 3 s ahead. Add `&mode=weekly` for the real weekly run.
- `?test&stage=2&secretroute=arcade`: the route map on a run seed whose next roads include the hidden ??? road (and, here, the Bonus Arcade).
- `?test&ghost=demo&modescreen=ghosts`: EXTRAS > GHOST RACE.

## Files
- **New:**
  - `src/game/modes/rhythm.ts`: beat clock, window, pulse, roll
  - `src/game/modes/pacifist.ts`
  - `src/game/modes/minigames.ts`: pure, seeded games and their net form
  - `src/game/modes/ghost.ts`: recorder, binary format, codes, pose and delta
  - `src/game/modes/ghostStore.ts`
  - `src/game/systems/modes.ts`: Game methods, net, autopilot
  - `src/render/modesView.ts`: floor, targets, coins, holes, bots, ghost
  - `src/ui/modesHud.ts`: panel, crosshair beat frame, mini-game counter, ghost tag
  - `src/ui/ghostScreen.ts`
  - `src/ui/debugModes.ts`
  - `src/dev/modesLinks.ts`
  - `src/net/ghostNet.ts`
  - `server/leaderboard/ghosts.js`
  - `tests/modes.test.ts`, `tests/modesCoop.test.ts`
- **Shared files, small additive hooks:**
  - `src/game/game.ts`: an import, the `modes` field and 14 method fields. `this.modesTick(dt)` sits after the menu-freeze return in `update()`, `this.modesPreWeapons(dt)` after `gameplayPreWeapons`, and `this.updateModes(dt)` after `updateWorldEvent`.
  - `src/game/enemies.ts`: `EnemyCtx.beatStep?` / `beatHold?`. The speed line is multiplied by `beatStep`, and one line holds a finished wind-up while `beatHold` is set.
  - `src/game/director.ts`: `lengthMul` (reset in `start()`) scales `duration`.
  - `src/game/systems/combat.ts`: `modes.holster` returns 0 damage, and returns null from `nearestEnemy`.
  - `src/game/systems/statuses.ts`: `modesOnKill` after `gpOnKill`, and a holster check in `tryBomb`.
  - `src/game/systems/skill.ts`: a holster check in `tryUlt`.
  - `src/game/systems/levelUps.ts`: `modesOffers(h)` after `buildOffers` in `openLevelUp`.
  - `src/game/systems/runFlow.ts`: `modesStageStart()` after `routeStageStart()` in `loadStage`, and `modesRunEnd()` at the top of `bankAndShow`.
  - `src/game/systems/route.ts`: `routeMod` gives the pacifist count. `routeAdvance` hands an `arcade` pick to `modesArcade()`. `routeViewFrom` disguises `HIDDEN_NODES` as `secret` unless taken.
  - `src/data/routeNodes.ts`: node kinds `rhythm`, `arcade`, `pacifist` and `secret` (glyph fallbacks ♪ ★ ☮ ??; no icon art, so iconArt.ts isn't regenerated), plus `HIDDEN_NODES`.
  - `src/game/systems/netHost.ts`: `md: this.modesNet()`. `src/game/systems/netClient.ts`: `applyModesNet(s.md)` and `modesLocal(dt)`.
  - `src/game/systems/render.ts`: `renderModes(rdt)` after `renderWorldEvent`.
  - `src/ui/screens.ts`: `'ghosts'` added to `ExtraScreen`. The EXTRAS button is inserted from ghostScreen.ts.
  - `src/audio/music.ts` (the SOUND lane's file): one documented method, `alignBeat(phase, maxShift)`. Nothing else in audio changed.
  - `src/game/autopilot.ts`: `pilotModes(g, mv)` can override the move and aim target.
  - `src/ui/debugPanel.ts`: `addModesFolder`. `src/dev/testLinks.ts`: the `modesLinks` call and a header line.
  - `server/leaderboard/routes.js`: one import and `ROUTES.push(ghostsRoute)`.
  - `tests/smoke.test.ts`: a modes block (a forced rhythm stage, the Pacifist road, all three mini-games, a weekly run racing a demo ghost that is kept on quit), plus `ghosts` in the screen list.

## Verification
- `npm run typecheck` passes.
- `npm test` passes (see the flakes below). My tests:
  - `tests/modes.test.ts`, the pure rules:
    - the beat clock, tempo continuity, the on-beat window, the crossing check
    - the pulse averages x1.000
    - the rhythm roll lands at 12.0% over 4,000 seeds and never on stage 1
    - pacifist rewards and forfeits
    - the gallery's countdown, aimed hits and shot rate
    - mini-game determinism, coin ownership, whack hits and bombs, the net round trip, the end of a game, the seeded kind
    - ghost recording, and the decode round trip (positions exact to the decimetre, facing within one step, events and scores)
    - ghost size: 2,835 B for 90 s, about 32 B/s, so about 38 KB for a 20-minute run
    - the plain and packed codes, bad-code messages, pose interpolation, hiding after death, delta seconds and points both ways, best-run choice, the store and the week filter
  - `tests/modes.test.ts`, a real solo Game:
    - **Rhythm:** 59 wind-ups ended, 0 of them between beats. Beat = time x tempo. An on-beat kill scored x3.0 (60 vs 20). Back to normal the next stage.
    - **Pacifist:** 120 s stage with no mini-boss. Damage is blocked, there are no targets, the special stays holstered, and weapons dealt 0 in 2 s. No boss, and the stage clears at the timer. The reward was +69 gold and a relic, then a level-up with Starfall (legendary), Vampire Fang (legendary) and Lucky Clover (rare). One credited kill forfeits it.
    - **Mini-games:** all three pay gold and then open the portal. A real route pick of the Bonus Arcade starts its game before the portal, and the portal then leads to the arcade's stage.
    - **Route map:** the hidden node reads ??? and shows its name once taken.
    - **Ghosts:** a weekly-style run records a ghost, it's kept at the run's end, and the next run races it.
  - `tests/modesCoop.test.ts`, an in-process host and client:
    - The client stays within 0.036 beats of the host on a 128 BPM stage, and within 0.043 beats through the switch to the boss tempo (152) and the entrance's slow motion.
    - The client sees the Pacifist timer, and its shots hurt nothing.
    - Both see the Coin Dash. The guest earned 56 gold and the host none. The client's HUD and gold match, and the portal opens at the end.
- `npm run smoke` passes. Final run: `modes {"rhythm":true,"onBeat":319,"pacifist":{"kills":0,"gold":74,"stage":2,"mode":"cleared"},"mini":{"gallery":27,"coins":30,"whack":22},"raced":true,"ghost":"392 samples"}`. The gold is the bot's haul per mini-game after the payout trim; it was 37 / 50 / 21 before. An earlier smoke run's standard bot also took a Rhythm Stage node on its own (`route: treasure,rhythm,event`).
- Flaky tests seen once each in full `npm test` runs on the shared machine, both outside this lane: `worldEventsGame.test.ts` ("the enemy on it fell") and `fixes.test.ts` ("with the wall gone it fires"). Both passed on every rerun of the file (3 of 3 and 8 of 8). Both start random-seed solo runs; I didn't dig further.
- Screenshots I looked at (`shots/`, not committed):
  - `modes-rhythm*.png`: the disco floor, after three passes. The first used additive blending, which wrote the bloom mask and washed out the field, so the floor now adds colour and leaves alpha alone. The tiles were also dimmed and shrunk.
  - `modes-cursor.png`: the crosshair beat frame lit in the window.
  - `modes-pacifist.png`: the panel, rules and timer.
  - `modes-mg-gallery.png`, `modes-mg-coins.png`, `modes-mg-whack.png`. Spawn areas became ovals after the first gallery shot put targets off screen. Coins became two-tone after they read as tan blobs.
  - `modes-ghost.png`: the ghost plus its tag and delta. The ghost got a visor and ring after it first read as a smear.
  - `modes-route.png`: ??? and Bonus Arcade cards.
  - `modes-ghostscreen.png`
- `npm run bench -- --dev --seconds 15` ran on a heavily shared machine (1 fps SwiftShader, 4.6 ms per sim step), so the absolute numbers can't be compared with the perf lane's. Draw calls were 131 avg / 137 max (measured before the lane's empty pools were hidden; they're `visible = false` now, so they cost no draw call). The lane shares phases with other systems: `ren.barrels+arena+chests` (which includes `renderModes`) was 0.20 ms, and `sim.hazards+arena` (which includes `updateModes`) was 0.20 ms, with nothing from the lane active in the bench scene.

## Unfinished / risky
- **None of this has been played by a person**, and `npm run coop` (two real browsers) wasn't run, because the broker is unreachable here. Co-op is covered only by the in-process test.
- **Rhythm feel and the music lock haven't been heard.**
  - `music.alignBeat` bends the tempo by up to about 12% while it locks on. That shows most at a stage start and after menus, which freeze the game clock while the music keeps playing.
  - If the SOUND lane changes how the song is scheduled (`p.step` / `p.nextTime`) or adds tempo changes inside a song, the hook needs a look.
  - The boss-duel music the SOUND lane may add isn't followed: the clock only knows the biome song and the stage's boss theme. Alignment simply pauses while another track plays.
  - The beat ignores song sections (verse and chorus) on purpose: sections depend on audio-side intensity.
- **Rhythm rewards on-beat kills, not on-beat hits.** Damage per hit isn't changed (no damage-pipeline edit), so with rapid fire, on-beat kills are partly luck. A deliberate charge release or special on the beat is where the skill shows.
- **On-beat judging is by the host's clock.** Online clients see the world about 50-100 ms late; the window is wider after the beat (0.13 s) to absorb some of that.
- **The Pacifist road is unbalanced so far.** 120 s of dodging with no XP, 40% fewer enemies but swarm rings and elites as usual: survival there hasn't been measured with a mortal bot. The stage objective and side challenge (shoot totems, kill elites) are impossible on that stage. World events and the gameplay lane's supply crates still happen; a Minigun from a crate does nothing either.
- **The legendary card is spent on the next draw.** A REROLL on that card redraws normal cards.
- **Mini-games run in mode `portal`**, with the portal closed and moved to 1e5 so nothing walks into it. Any system that assumes `mode === 'portal'` means the portal is up would be fooled during a game; the autopilot is, and `pilotModes` overrides it. The stage timer still shows during a game.
- **Mini-game balance:** the bot makes 27 / 30 / 22 gold (gallery / coins / whack) with perfect aim and pathing. Against the roughly 80-90 gold a stage-1 player earns, a strong player can take a lot from an arcade. `miniTuning` holds the knobs.
- **Ghost codes are long.** About 50 KB of text for a 20-minute run (packing barely helps; the varints are already tight), so files are the practical way to share. The worker accepts codes up to 200 KB.
- **The worker route** (`server/leaderboard/ghosts.js`) wasn't deployed or exercised. Uploads are only checked for shape and size, as with the score board, which is not real anti-cheat.
- **A ghost shows only on your current stage.** A ghost that died earlier, or is on another stage, is hidden. The delta still compares scores.
- **There is no setting to turn ghosts off.** RACE MY BEST with no saved run of your own shows none.

## PLAN.md decision-log paragraph (for the lead)
- 2026-10-19: Modes lane (notes/lanes/modes.md). **Rhythm stages:**
  - They come from a Rhythm Stage route node and a seeded 12% roll from stage 2.
  - Enemies pulse with the beat (x2.4 on it, x0.3 before the next, x1 on average), and every wind-up that would end between beats waits for the next beat, so lunges, charges, fuses, shooter volleys and boss attacks land on it.
  - Kills within the on-beat window (-0.07 / +0.13 s) score x3 and +1 combo. A disco floor, a crosshair beat frame and a HUD panel show the beat.
  - The beat clock is gameplay: the host derives it from the stage song's tempo (`TRACK_BY_ID` bpm: biome song, then the boss theme) and the stage's real step time. Clients run the same function from `md.rh` and stayed within 0.04 beats in tests. The music is pulled onto the game's beat by `music.alignBeat` (at most 2 ms a frame), never the reverse.

  **The Pacifist road:**
  - It's a rare route node (weight 0.6) drawn as ??? until it's the road taken.
  - Weapons are holstered: no hero damage, no targets for auto weapons, pets or turrets, and no special or ultimate. Dash and parry still work.
  - There are 40% fewer enemies, the stage is 2:00, and there's no mini-boss or boss.
  - Zero kills pays 40 + 12/stage gold, a relic, a gear, 6,000 x stage score and a legendary level-up card. A hero-credited kill forfeits it.
  - The boss was skipped rather than turned into a timer because it can't be beaten without damage.

  **Bonus Arcade road:** a 20-second Shooting Gallery, Coin Dash or Whack-a-Bot (seeded) plays on the field before the portal. It uses the real controls, everyone plays at once, gold is per hero, and it grows +15% per stage. The bot plays it.

  **Weekly ghost racing:**
  - Weekly runs record a ghost: 10 Hz pose, events, and score per second, about 32 B/s.
  - The best run per week is kept in its own storage key.
  - EXTRAS > GHOST RACE copies or saves your code or file, and pastes or loads a friend's. The optional worker gets a `/ghosts` route (top 10 per ISO week).
  - The rival runs beside you as a see-through hero with a name tag and a live points and seconds delta.

  **Protocol:** one snapshot field (`md`) and no new messages.
