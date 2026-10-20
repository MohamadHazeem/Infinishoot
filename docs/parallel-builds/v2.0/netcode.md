LANE: netcode — online play that survives the real internet

1. Reconnect: a client that drops (network blip, tab reload within 60 s) can rejoin the same run with the same hero/build (host keeps the hero as autopilot/AFK meanwhile — coop2 has drop-in/out with autopilot and reclaim: build on it). Host shows "X reconnecting…".
2. Network overlay: per-player ping, packet loss and snapshot rate (toggle in settings, plus a small warning icon next to a teammate with a bad connection on everyone's HUD).
3. Lag compensation: the client's own shots/hits resolve against where enemies were on the client's screen (host keeps ~250 ms of enemy position history and rewinds for client-authored hits within limits); keep it cheat-safe within reason.
4. Smoother remote players and enemies at high ping: better interpolation buffer (adaptive delay), extrapolation caps, snap-vs-blend thresholds.
5. Bullets on the wire: bullet records are now the largest snapshot field; compact them (delta/quantise/skip predictable straight-line bullets) like the effects bus; report before/after bytes from `npm run coop`.
6. Extend scripts/coop-test.mjs with simulated latency/jitter/packet loss (e.g. delay + drop in the transport for the client) and a reconnect scenario; it must pass.
Owns: src/net/* (peer.ts, codec.ts, snapCodec.ts, new src/net/lagcomp.ts, src/net/netsim.ts), systems/netHost.ts / netClient.ts (careful, additive), new src/ui/netOverlay.ts, scripts/coop-test.mjs scenarios, tests/netcode.test.ts.
