# Lane: route (branching route map between stages)

## What players get
- After each stage's shop a **ROUTE MAP** screen opens instead of going straight to the portal. It shows the road taken so far (3 stages back), the 2-3 nodes you can pick for the next stage, and 2 more layers ahead. Each column is labelled with its stage and biome; final-boss stages get a red star. One choice card per road sits under the map. Focusing a card lights its node, and you can also click the node itself. Hovering any node shows a pixel tooltip.
- Node kinds (src/data/routeNodes.ts). A node only changes the stage it leads into; the biome and boss order are unchanged:
  - **Elite Hunt**: one extra elite between each pair of the director's elites, so one every 24 s instead of 48 s (more elite chests). Enemies +10% life. Clearing the stage gives everyone a bonus relic.
  - **Merchant Road**: the shop after this stage is always the secret merchant (rare Mods at 25% off, a free relic), plus +20 gold at the stage clear.
  - **Treasure Trove**: 3 chests waiting at the start, the first timed chest after 12 s instead of 30 s, 30% fewer enemies, +1 reroll gear.
  - **Mystery**: once picked, an **ENCOUNTER** screen (same UI) offers a choice before the portal. Six encounters: Blood Altar (lose 30% of current life for a relic), Wandering Gambler (bet 15 gold, 50% chance to win 40), Cursed Idol (25 gold each plus a random team curse), Healing Spring (full heal or 2 gears), Training Dummy (a team level now or a 50% heal), Gear Shrine (10 gold for 2 gears).
  - **Campfire**: applied as soon as it's picked: full heal, downed heroes stand up, +1 gear.
  - **Danger Zone**: enemies +35% life, +25% damage, +20% count. Double score all stage. Stage-clear gold and interest are paid twice, plus 15 gold.
- When a stage starts, a toast names its node. After you pick, a "NEXT: <node>" toast shows as the portal opens.
- **Modes**: on for Standard and Daily solo and for co-op (always Standard). Off for Endless (no portals), Boss Rush (stages skip straight to the boss) and PvP. The free starting shop before stage 1 still goes straight into stage 1.
- **Co-op**: every player sees the map and votes. Small coloured markers on the nodes and name chips on the cards show who voted for what, with a countdown. A strict majority decides at once. Once everyone has voted, the most votes win, and a tie goes to the host's pick. When the 10 s run out, the host's pick decides; failing that, the most votes cast; failing that, the first road. A player who has left doesn't block the vote. Encounters are voted the same way and apply to the whole team.
- Keyboard (left/right + Enter), gamepad (D-pad/stick + A), mouse and touch (tap a card or a node) all work. The `route_select` sample plays when the vote is decided, on every machine.

## Determinism
- src/game/route.ts is pure. Layer `s` (the nodes for stage `s`) is rolled from a hash of (run seed, s) alone. That means the same seed always gives the same map, whatever path was taken, and clients rebuild it from the seed. Stage 1 is the start node. A layer has 2 nodes (55%: 3) in columns {0,2,4} or {0,2}/{1,3}/{2,4}, all of different kinds. Campfires are twice as likely before a final-boss stage; Danger Zone is half as likely on stage 2.
- Links: a node leads to next-layer nodes within 2 columns, and always to at least 2 of them. Tests check 200 seeds x 12 stages: every pick has 2-3 roads and every node can be reached.
- Encounter choice: `routeEventFor(seed, stage)`. Random outcomes (gamble, curse pick) use `game.rng` on the host.

## Tuning
`routeTuning` and `eventTuning` in src/data/routeNodes.ts: vote time 10 s, map window (3 behind, 2 ahead), Elite offset 24 s / +10% HP, Treasure 3 chests / 18 s head start / -30% count / +1 gear, Merchant +20 gold, Campfire +1 gear, Danger +35% HP / +25% damage / +20% count / +100% score / +15 gold. Encounter costs and rewards are in `eventTuning`. Node weights: elite 3, treasure 3, event 3, shop 2, rest 2, hard 2.

## How it's wired (files)
- New: `src/data/routeNodes.ts` (node and encounter data), `src/game/route.ts` (pure layout and vote), `src/game/systems/route.ts` (Game methods: flow, effects, net), `src/ui/routeMap.ts` (screen and its CSS, injected once), `tests/route.test.ts`.
- Small hooks:
  - `game.ts`: install the methods, the `route` state, one `this.updateRoute(dt)` line just before the menu-freeze check in `update()`, and `screens.onRoutePick`.
  - `systems/spice.ts`: `curseSum` adds `routeMod(k)`, so node modifiers flow through the existing enemy HP/damage/count/score plumbing. `openShop` ORs in `routeSecretShop()`. `closeShop` calls `openRoute()` before `openPortal()`.
  - `systems/runFlow.ts`: `routeReset()` in startRun, `routeStageStart()` at the end of loadStage.
  - `screens.ts`: a `route` screen, `MenuNav` and `showRoute()`.
  - `netHost.ts` / `netClient.ts`: `rvote` and `route` messages.
  - `dev/bot.ts`: the bot takes the first road.
  - `dev/testLinks.ts`: route links.
  - `scripts/icons.mjs` + regenerated `src/data/iconArt.ts`: 7 `route_*` icons. **If another lane also regenerated iconArt.ts, re-run `npm run icons` after merging instead of hand-merging.**
  - `tests/smoke.test.ts`: prints the route taken; fails if a standard run reached a stage with no node picked.
  - `scripts/coop-test.mjs`: a forced route vote at 62 s that checks the client sees the map and the vote resolves.
- While the map is open the game stays in mode `'shop'` (every shop is already done). The world freezes exactly as it does in the shop, and no other system needed to learn a new mode. `openRoute()` is idempotent, so a late `closeShop()` (for example when a client leaves) doesn't reopen anything.
- Net: the host broadcasts `{t:'route', open, phase, stage, seed, path, options, votes, tl, ev, so, dec}` whenever the state changes, and once a second for the countdown (`so` = status-only refresh). `{t:'route', open:false}` closes it. Clients vote with `{t:'rvote', i}`. Node effects all run on the host: gold, gears, heals and relics already reach clients through snapshots, and toasts go through `game.vfx`.

## Test links
- `?test&stage=3&route`: open the route map now (the choice for stage 4). Add `&path=1,0` to set the roads taken for stages 2, 3...
- `?test&stage=2&node=treasure`: this stage plays as a node (elite, shop, treasure, event, rest, hard).
- `?test&encounter=altar`: an encounter right away (altar, gambler, idol, spring, dojo, shrine).

## Checks
typecheck, `npm test` (new route.test.ts) and `npm run smoke` pass. The smoke run's standard bot went through 3 route picks, including encounters. `npm run coop` passes: the natural stage-1 clear showed the map on the client, and the forced vote resolved with both bots voting. One earlier co-op run had an unrelated flaky `turret` check, which passed on the rerun. `npm run bench` is unchanged: `routeKind` is cached, so spawns and steps don't allocate. Screenshots were checked at 1280x720 and 960x540.

## Risks / not done
- Danger Zone and Elite Hunt HP bonuses also apply to that stage's boss and mini-boss, through `spawnOpts`. This is intended as part of "a harder stage", but it makes those bosses tougher.
- The Mystery node's encounter happens right after the pick, before the portal, not mid-stage.
- There's no separate "bigger shop" offer count: Merchant Road guarantees the secret merchant (rare/legendary Mods at a discount plus a relic) and adds 20 gold. A real 6-offer shop would need a `Hero.rollShop` change in hero.ts.
- There's no settings toggle to turn the route map off. It only shows between stages and is quick in solo, so it wasn't treated as "intense or noisy".
- Balance hasn't been measured with the bot beyond smoke runs; the numbers are first guesses.

## PLAN.md decision log paragraph (for the lead)
- 2026-10-19: Route map (route lane, notes/lanes/route.md). After each stage's shop the team picks the next stage's node on a seeded branching map (2-3 roads, map drawn 3 stages back and 2 ahead): Elite Hunt (elite every 24 s, +10% HP, bonus relic), Merchant Road (guaranteed secret merchant, +20 gold), Treasure Trove (3 chests at start, -30% enemies, +1 gear), Mystery (one of 6 encounters with a choice), Campfire (full heal, +1 gear) and Danger Zone (+35% HP, +25% damage, +20% count, double score and stage-clear gold). Layers are rolled from (seed, stage) only, so the same seed draws the same map and clients rebuild it. Node modifiers go through `curseSum`, so the existing spawn and score plumbing applies them. Co-op votes: a strict majority decides at once, otherwise the host's pick after 10 s. It is off in Endless, Boss Rush and PvP. While it's open the game stays in mode 'shop', so the world freezes as it does in the shop.
