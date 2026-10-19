LANE: route

Goal: a branching route map between stages (Slay the Spire / Hades style) so players choose their path.
1. After each stage clear (and the shop), show a ROUTE MAP screen: 2-3 next nodes with icons: Elite fight (harder stage with extra elites, better loot), Shop (a bigger shop/merchant), Treasure (bonus chests, fewer enemies), Event (a random run event with a choice, e.g. trade HP for a relic), Rest (heal + free reroll), and a Hard path (danger modifiers, double rewards). The next stage's biome/boss order stays as now; the node only modifies the stage (spawn tuning, rewards, events). A small map view shows the path taken so far and 2-3 layers ahead (seeded).
2. Seeded and deterministic (same seed = same map), works in endless/boss rush sensibly (or disabled where it doesn't fit), in co-op the host chooses (clients see the map and a vote indicator; simple majority or host decides after 10 s).
3. Pleasant UI in the game's pixel style (nodes, connecting lines, hover tooltips, route_select sample exists), keyboard/gamepad/touch navigable.
Owns: new src/game/route.ts, src/data/routeNodes.ts, src/ui/routeMap.ts, a new system file for applying node effects, small hooks in systems/runFlow.ts and screens.ts, tests/route.test.ts.
