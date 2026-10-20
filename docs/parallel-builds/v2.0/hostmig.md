LANE: hostmig — host migration

If the host leaves, crashes or loses connection, the run continues with a new host instead of ending for everyone.
1. Clients keep an up-to-date "migration snapshot" (enough to rebuild the authoritative state: run state, team XP/level, stage/time/director, every hero's full build/gold/stats, enemies, pickups, chests, boss state, lane snapshot fields). Prefer reusing the existing snapshot/build export paths (exportBuild/applyBuild, snapshot decoders) over a new format; fill gaps.
2. On host loss: all clients agree on the new host deterministically (lowest join order still connected), the new host promotes itself (role -> host, rebuilds simulation from the last migration snapshot), the others reconnect to it (PeerJS new connection with a derived id or a short handshake via a fallback), a banner "NEW HOST: X" + 'host_migrate' sample + vo_host_migrated; the previous host's hero becomes AI/autopilot or leaves per drop-out rules.
3. Edge cases: host leaves during a level-up/shop/route/boss intro/finisher/mini-game; two quick migrations; a migration with lag; solo fallback when only one player remains.
4. scripts/coop-test.mjs (or a new scripts/migrate-test.mjs, `npm run migrate`) with 3 headless players: kill the host page mid-fight and mid-shop; the run must continue for the other two with matching state. Must pass 3 times in a row; npm run coop still passes.
Owns: new src/net/migration.ts, src/game/systems/hostmig.ts, small hooks in online.ts/netHost/netClient/peer.ts, the test script, tests/hostmig.test.ts.
