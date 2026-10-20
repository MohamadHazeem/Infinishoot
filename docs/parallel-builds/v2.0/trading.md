LANE: trading — sharing in co-op

1. Trading: in the shop and during fights (a quick menu), give gold, gears or a relic to a teammate; a POOL button in the shop lets teammates chip gold into one item for someone ('coin_transfer' sample). Host-authoritative, synced, rate-limited, works with 2-8 players.
2. Co-op achievements and titles (coordinate with meta2: add co-op ones to the achievements list in your own data file, merge-friendly) and co-op titles shown on player cards.
3. LEGEND difficulty: co-op only (2+ players), above Nightmare, with special rewards; scaling tuned for 2/3/4 players with bot runs; shows on the lobby difficulty row.
4. Tests and npm run coop scenarios.
Owns: new src/game/systems/trading.ts, shop hooks (small), difficulty data (additive), tests/trading.test.ts.
