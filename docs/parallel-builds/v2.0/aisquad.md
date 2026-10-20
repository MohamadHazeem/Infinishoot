LANE: aisquad — play co-op with AI teammates

Solo players can bring up to 3 AI teammates (offline, no network): MODE screen option SQUAD: 0-3 BOTS with hero picks for each (or random). Build on the existing autopilot (src/game/autopilot.ts, coop2 drop-out autopilot) and the local co-op lane (src/game/systems/localCoop.ts) so the game runs as a host with extra heroes that have no peer.
1. Bot brains that feel like good teammates: follow the player loosely (leash), fight, dodge telegraphs, revive downed allies (incl. the player), pick up items sensibly (not stealing owned boss chests), use specials/ultimates/team moves with the team meter, join co-op objectives and carry the bomb, respond to pings (go here / danger), take level-up picks with a simple build plan per hero, shop with their own gold.
2. Difficulty scaling as co-op with N heroes (reuse the co-op scaling), team XP shared; achievements that require "real co-op" don't count bots (mark runs as squad runs).
3. HUD: bots shown as teammates with a BOT tag; a SQUAD ORDERS quick menu (FOLLOW / SPREAD OUT / HOLD HERE / FOCUS BOSS) using the ping wheel.
4. Tests with the dev bot playing alongside the squad (smoke run with 3 bots), screenshots, English + Arabic strings.
Owns: new src/game/systems/aisquad.ts, src/game/aisquadBrain.ts, mode screen option (small), tests/aisquad.test.ts.
