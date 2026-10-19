# Lane: run (routes, heat, Weekly Challenge)

## What players get
- **Routes between stages.** After the post-boss shop closes, a PICK A ROUTE screen deals route cards for the next stage (3 cards; 2 before the final boss stage, never CURSED there). Pick with a click, Enter or 1-3. The route shows on the portal banner, the next stage's banner and under the HUD stage label (`◆ TREASURE · HEAT 4`).
  - **Treasure**: map chests every 16.5 s instead of 30 s and up to 6 closed at once; elites 1.6x rarer.
  - **Elite Hunt**: elites twice as often; each drops +1 gear and +2 gold; the boss relic roll gets +4 Luck.
  - **Eventful**: a second, early stage event (8-18% into the stage) on top of the usual one; the side challenge starts at 8 s instead of 18 s and pays 2.5x gold and score.
  - **Bargain**: Mod prices x0.7 in the shop after this stage, +8 gold each at its stage clear.
  - **Cursed**: right away the team takes a random curse it doesn't have (no gold), everyone gets a relic (normal boss roll), +2,000 x stage score. The stage banner names the curse.
- **Co-op vote.** Everyone sees the same cards and who voted for what (coloured dots), 15 s timer; majority wins, a tie goes to the host's pick (else the leftmost tied card), no votes = first card. Votes can be changed until it closes. A player leaving mid-vote doesn't block it.
- **Heat** (MODE screen > HEAT button > HEAT screen): 11 modifiers with 2-3 ranks each, 32 heat max, score x(1 + 0.05 x heat) (x2.6 at max). Click a modifier to step its rank (wraps to 0); RESET clears. The MODE screen button shows heat, score multiplier and the best heat cleared with the chosen hero.
  | Modifier | Per rank | Max | Heat/rank |
  |---|---|---|---|
  | Thick Hides | enemy life +15% | 3 | 1 |
  | Hasty Foes | enemy speed +8% | 3 | 1 |
  | Hard Hitters | enemy damage +12% | 3 | 1 |
  | Horde | +10% enemies alive | 3 | 1 |
  | Elite Patrol | seconds between elites x(1 - 0.2 r) | 2 | 2 |
  | Boss Fury | boss and mini-boss life +25% | 2 | 1 |
  | Thin Skin | i-frames after a hit -30% | 2 | 1 |
  | Hunger | r1 level-ups don't heal; r2 also no hearts | 2 | 2 |
  | Volatile | 8% of slain enemies leave a telegraphed blast (1.6 m, 0.9 s fuse, 12 x stage damage) | 2 | 2 |
  | Heavy Boots | dash recharge +25% | 2 | 1 |
  | Tight Purse | shop prices +15% | 2 | 1 |
  - A run counts as **cleared** when the final boss (stage 4) falls. The best heat cleared is stored per hero (save v4 `heat`). Milestones are achievements that only unlock skins: Warming Up (heat 4, Ember), Hot Seat (heat 10, Inferno), Meltdown (heat 20, Solar). Never stats.
  - Heat is off in Daily, Weekly and PvP. Co-op uses the host's heat: the lobby's difficulty note says "HEAT 7 · SCORE x1.35 (the host's, set on PLAY SOLO)", and `start` carries the ranks so clients know them. High-score labels add "HEAT n".
- **Weekly Challenge** (5th MODE card): the seed comes from the ISO week (`weeklySeed('2026-W43')`), Medium, no heat, routes fixed by the seed like the Daily, and 2 mutators picked from the week's seed out of 9: Mitosis (non-swarmer kills burst into 2 Swarmers), One-Armed (no right click, specials recharge x2), Glass World (everyone deals and takes x2), Giants (enemies x1.35 size, +60% life, -15% speed), Gold Rain (kill gold x3), Horde (+50% enemies, -35% life), Turbo (enemies +25% speed, dash recharge -30%), Elite Army (elites x2), Gear Head (+2 gears per stage, no hearts). The MODE screen shows the week, its mutators and your best this week (`weekly.v1` in storage, like `daily.v1`). Score label "WEEKLY CHALLENGE"; leaderboard board `weekly-2026-W43` (worker regex extended).

## Mode decisions
- Standard and co-op: route vote every stage (from stage 2). Endless: a vote between waves too (all knobs work in place). Daily and Weekly: no vote, the first rolled card (seed + stage) is the route for everyone. Boss Rush and PvP: no routes. Stage 1 never has a route; the starting shop is unchanged.
- Route cards are a pure function of (run seed, stage) (`rollRoutes`), so the run's own RNG isn't touched and a seed reproduces its offers.

## Knobs (debug panel: "Routes, heat & mutators")
`routeTuning` (src/data/routes.ts), `heatTuning` (src/data/heat.ts), `mutatorTuning` (src/data/mutators.ts).

## How it's wired
- State: `RunMods` (src/game/runMods.ts) on `game.runMods`: route, heat, mutators, open vote, and getters every system reads (eliteMul, chest knobs, priceMul, iframeMul, noHearts, damageMul, enemyScale, eventMods...). Heat and mutator stat changes go through the existing curse sums: `Game.curseSum(k)` adds `runMods.sum(k)`, so enemy life/speed/count/damage, damage taken, dash cooldown and score work everywhere curses already do.
- Game methods: src/game/systems/runMods.ts (`runModsStart/Stage/Step/Kill/Bank`, `offerRoutes`, `routeVote`, `routeTick`, `applyRoute`, `clientRoute`, `heatWants`).
- UI: src/ui/runUi.ts (route screen, heat screen, MODE screen extras via `Screens.modesHook`, HUD tag inside `#timer`; injected CSS, no style.css edits).
- Flow: `closeShop()` -> `offerRoutes()` (returns true while voting; the world stays in mode 'shop', so it's frozen with shop music everywhere) -> votes -> `applyRoute()` -> `closeShop()` again -> portal / next Endless wave.
- Protocol: host -> client `{t:'route', view}` (cards, voters, my vote, seconds left) and `{t:'route', done}`; client -> host is the existing `{t:'ui', a:'route', i}`. `start` gains `heat`, `lobby` gains `heat` (display string). Snapshot unchanged.

### Shared hot files touched (all small)
- game.ts: imports, method fields, `runMods`/`runUi` fields + construction, `routeTick` in update() while mode is 'shop', `runModsStep` after `updateSkill`, Giants scale in `spawnOpts`, heat in `runLabel`, Glass World in `damageBuff`, `priceMul` getter.
- screens.ts: `ScreenName` += 'route' | 'heat', `addScreen()`/`refresh()`/`modesHook`/`onShow`, `navs` cast, MODE template gets `.modes-extra` in the button row, Weekly disables difficulty like the Daily, `LobbyView.heat` appended to the lobby difficulty note.
- spice.ts: `curseSum` adds heat/mutators; relic luck; Bargain clear gold; `closeShop` asks `offerRoutes`; `endlessNextWave` calls `runModsStage`; portal banner names the route.
- statuses.ts: Gold Rain / Hunger in kill drops, `runModsKill` hook after `onEnemyKilled`, Thin Skin after `p.hurt`, Treasure chest timing.
- levelUps.ts: `heroAction` 'route' line, Hunger blocks the level-up heal.
- director.ts: `mods = { elite, bossHp }`. runEvents.ts: `mods` (extra event, reward multiplier, challenge start). enemies.ts: `SpawnOpts.scale`. hero.ts: optional `HeroWorld.priceMul` in `price()`. save.ts: v4 `heat` + `recordHeat`. netClient.ts: 'route' case, heat on 'start'/'lobby'. online.ts: lobby heat. leaderboard.ts + server worker: weekly boards. meta.ts / skins.ts: 3 achievements, 3 skins. bot.ts: votes the first card. testLinks.ts, debugPanel.ts, smoke.test.ts (Weekly run, heat on, heat screen).

## Test links
- `?test&routes` the route vote opens now; `?test&routevote` a co-op vote mid-way (voter dots, timer; display only); `&route=treasure&stage=2` play a stage on a route.
- `?test&heat=hp:3,volatile:2` run with heat; `?test&heatpick=hp:2,hunger:2&screen=heat` store a pick and show the HEAT screen.
- `?test&mode=weekly&screen=modes` MODE screen with the Weekly note; `&mutators=giants,mitosis` force mutators.

## Verification
- `npm run typecheck`, `npm test` (new tests/run.test.ts: route rolls, votes, ISO weeks, mutators, heat, knobs, Eventful; tests/runGame.test.ts: solo/Daily/Boss Rush/Weekly flows, heat in a run, Thin Skin, Hunger, Volatile, heat milestones, co-op host vote with tie/timer/leaver, client messages, save v4), `npm run smoke` (adds a Weekly run and all heat modifiers at rank 1 on the non-challenge runs; the bot votes the first card).
- Screenshots: route screen, MODE screen (Weekly note, heat button), HEAT screen, HUD route/heat/mutator tags.

## Unfinished / risky
- Not tested over a real two-machine connection (`npm run coop` not run); the host/client message paths are unit-tested in one jsdom game.
- Heat clears only count on the host (or solo); a co-op client's save doesn't record the host's heat.
- One-Armed blocks right-click weapons by forcing `ctx.charging` off on the host; the client-side crosshair could still show a charge ring (Weekly is solo-only, so only cosmetic).
- Balance is by inspection, not bot-measured: Elite Hunt at x2 elites plus Elite Patrol 2 plus Elite Army can stack to elites every ~5-10 s (clamped at x0.2 of the interval).
- The HUD tag sits in `#timer` under the stage label; if the HUD lane moves `#spice` up, three lines (route+heat, mutators) may touch it.
- MODE screen at 720p: fits with the heat button in the bottom row; tighter if more heroes or modes are added.

## PLAN.md decision-log paragraph
- 2026-10-19: Routes, heat and the Weekly Challenge (run lane, notes/lanes/run.md). After each post-boss shop the team picks the next stage's route from 3 cards rolled from the run seed and stage (2 before the final boss, never CURSED there): Treasure (chests every 16.5 s, up to 6, fewer elites), Elite Hunt (x2 elites with +1 gear and +2 gold each, +4 Luck on the boss relic), Eventful (a second early event, challenge at 8 s paying x2.5), Bargain (next shop x0.7, +8 clear gold), Cursed (a random curse now, a relic each, +2,000 x stage). Co-op votes with a 15 s timer, majority wins, ties go to the host; Endless votes between waves; Daily and Weekly take the seed's first card; Boss Rush and PvP have none. Routes only turn existing knobs (director elite timing, chest spawns, stage events, shop prices, curses, relics). Heat: 11 ranked modifiers on the MODE screen (32 heat max, score +5% per heat), applied through the curse sums plus a few hooks (elite timing, boss life, i-frames, level-up heal, hearts, death blasts, shop prices); off in Daily, Weekly and PvP; co-op uses the host's. Beating the final boss stores the best heat per hero (save v4) and heat 4/10/20 unlock three skins, never stats. Weekly Challenge: ISO-week seed, Medium, two of nine mutators from the seed, best-of-week in `weekly.v1`, leaderboard board `weekly-YYYY-Www`.
