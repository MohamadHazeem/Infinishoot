# Lane: netcode (online play that survives the real internet)

## What players get
- **Reconnect.** If a client's connection drops mid-run (a network blip, ICE failure, the host going quiet for 10 s), the client keeps the run on screen with a **CONNECTION LOST · RECONNECTING... 54S** banner and retries every 2 s for 60 s with the same player id. The host keeps the hero on the coop2 autopilot for **60 s** (was 45) and everyone sees **RECONNECTING... 42S** over it. When the client gets back in, it reclaims the same hero and build ("WELCOME BACK!"), even if the host has JOIN ANYTIME switched off. A **reloaded or reopened tab** within 60 s rejoins on its own ("REJOINING YOUR RUN...", `infinishoot.net.rejoin` in localStorage). Leaving on purpose still leaves at once.
  - Host side: a client silent for 2.5 s shows NOT RESPONDING; after 12 s its connection is dropped (not while this machine's own loop has just stalled) and its hero goes on autopilot. A reconnecting player whose old connection hasn't closed yet gets in anyway (the host keeps a spare connection slot and drops the stale one when the new hello carries the same player id).
  - Fixed on the way: coop2 only kept player ids for mid-run joiners, so a player who was in the lobby at the start never matched their hero on rejoin (they came back as an extra hero). Lobby players' ids are now kept.
- **Network overlay.** SETTINGS > NETWORK STATS (off by default) shows a NETWORK panel on the left: each player's ping, packet loss and snapshot rate, and for a client its playout buffer and jitter. Whatever the setting, online, a teammate with a poor or bad connection (or reconnecting) gets a signal-bars tag over their hero on everyone's HUD ("265MS 7% LOSS", "NOT RESPONDING", "RECONNECTING... 42S").
- **Lag compensation.** A client's bullets (Buster, Scattergun, Charge Shot, pellets, every shot in the bullet pool) hit enemies where they were on that client's screen. The host keeps 16 steps (267 ms) of enemy positions; each client input carries the host step it was looking at (`vt`).
- **Smoother remote players and enemies.** Snapshots play out through an adaptive jitter buffer instead of being shown the moment they land: the picture is always between two known snapshots, the delay grows with jitter and shrinks on a clean link, extrapolation is capped, and teleports snap instead of sliding.
- **Bullets on the wire.** Bullets are sent once when they appear, then only when they stop matching what the client predicts, and when they go away. Bullet bytes went from the largest-but-one field to almost nothing (numbers below).

## How it works
- `src/net/netsim.ts`: a bad connection in a box for a client (both directions): one-way latency, jitter, and "loss". The data channel is reliable and ordered (SCTP), so a lost packet arrives late and holds up everything behind it (a retransmit timeout, 2x latency + 100 ms, up to 3 in a row); messages always arrive once and in order, so the codecs' deltas stay valid. `?netsim=90,30,0.03` (latency ms, jitter ms, loss) or `window.netsim({latency, jitter, loss})` in dev builds.
- `src/net/interp.ts` (`Playout`): every snapshot carries `hs`, the host's step. Offset = arrival - step time; the base is the minimum over the last 64 snapshots (~3 s), the jitter its 90th percentile spread. Delay = interval + 1.1 x jitter + 12 ms, clamped 50-250 ms. The playout clock aims at host-now minus the delay and steers by at most ±8% (jumps if 400 ms off). A snapshot is applied when the clock passes the previous one; alpha between the two applied snapshots drives `netA` (render.ts), up to 100 ms of extrapolation. Snapshots are only buffered on a real PeerJS connection (in-process test transports apply them at once, as before). World-changing messages (`stage`, `cojoin`, `over`, `end`) flush the buffer first; `start` drops it.
- Loss estimate: the channel never loses messages, so loss is counted as **stall onsets** (a snapshot much later than usual right after one that wasn't: a resent packet), plus the host's probes not answered within 1.5 s. Displayed loss is the larger of the two.
- `src/net/lagcomp.ts` (`EnemyHistory`): a fixed table by `uid & 4095` x 16 rows, recorded in `hostTick` every non-frozen combat step while someone remote plays (no allocation). `updateBullets` (systems/statuses.ts) asks `lagSteps(owner)`; for a remote hero it widens the hash query by 3 m and tests each candidate's rewound position. Only the hit test rewinds; damage, knockback and statuses land on the enemy as it is now.
  - Cheat-safety: the claimed rewind (host step at input arrival - `vt`) is clamped to 250 ms and to the host-measured round trip + 150 ms (100 ms before the host has measured one), smoothed (25% per input). A client can't claim hits; it can only make the host look up to 250 ms into the past.
- `src/net/bulletCodec.ts`: bullets got a `uid` and the pool a `simTime` bullet clock (seconds integrated; src/game/bullets.ts). Per client the host remembers the quantised position/velocity it sent and when (bullet clock), predicts the client's copy, and resends position (6 B) or position+velocity (10 B) when off by 6 cm or 0.06 m/s; new bullets cost ~17 B, removals ~1-2 B. The client corrects its untouched bullets by the difference between its bullet clock and the host's, so hit-stops, menus and slow motion need no resends. Keyframes (every 40 snapshots) and rejoins reset (flag bit). Field `bd`; the old `bu` path is still decoded.
- `src/game/systems/netcode.ts`: the glue (host probes `np` every 1 s, client reports `nst` every 2 s, the `nq` snapshot field `[rtt, loss %, snaps/s, reconnect]` per hero, silence detection, reconnect loop, tab-reload rejoin, lag hooks, HUD). `src/ui/netOverlay.ts`: the panel, tags and banner (CSS injected, pixel frames, Sweetie 16, `--ui` zoom, stepped blink off with REDUCE FLASHING).

## Numbers (`npm run coop`, wire bytes per snapshot)
- Before (base commit, clean link): avg 1361 B; bullets `bu` 290 B per snapshot on average (14 B per bullet per snapshot).
- After: see "Verification" (filled from the run).
- Unit test (40 straight bullets, 21 snapshots): 11,760 B old format vs 742 B deltas.

## Tuning
- `interpTuning` (src/net/interp.ts): minDelay 50, maxDelay 250, margin 12, jitterCover 1.1, extrapMax 100 ms, warp 0.08, snapErr 400 ms, queueMax 30, window 64, stallMs 70. `SNAP_DIST` 6 m (teleport snap).
- `lagTuning` (src/net/lagcomp.ts): maxRewind 0.25 s, delaySlack 0.15 s, unmeasured 0.1 s, blend 0.25, pad 3 m, `enabled`.
- `bulletNetTuning` (src/net/bulletCodec.ts): posTol 0.06 m, velTol 0.06 m/s.
- `netQualityTuning` (src/net/netQuality.ts): probes every 1 s, lost after 1.5 s, window 20; reports every 2 s; poor/bad at ping 130/220 ms, loss 2/6%, snapshot rate 14/9 per s; host staleMs 2.5 s, dropMs 12 s; client hostSilentMs 10 s (the coop script raises both to 30 s: its headless pages stall for seconds on a busy machine), reconnectFor 60 s, retryEvery 2 s.
- `joinTuning.grace` (src/game/coop2.ts): 60 s.
- Setting: `netOverlay` (SETTINGS > NETWORK STATS, off).

## Test links (src/dev/netcodeLinks.ts)
- `?test&god&mate&netdemo` the NETWORK panel and a bad-connection tag over the dummy teammate (shots/netcode-panel.png)
- `?test&god&mate&netdemo=rc` the teammate reconnecting (shots/netcode-rc.png)
- `?test&god&mate&netdemo=lost` this player's CONNECTION LOST banner (shots/netcode-lost.png)
- `?netsim=90,30,0.03` a simulated bad link for this machine when it joins

## Co-op script (`npm run coop`)
- The client's link is simulated by default: `--netsim 70,30,0.02` (`--netsim off` for a clean link). Position checks allow 4.5 m instead of 3 m on the slow link.
- New scenario at 66 s: the client's connection is cut (`client.drop()`); the script checks the CONNECTION LOST banner, that the host still has 2 heroes, that hero 1 is reclaimed on a new peer id, and that the client's build is intact.
- `--reload`: at 74 s the client's tab is reloaded and must rejoin as hero 1 within 60 s.
- The end of the log prints the client's playout stats and the host's `nq` numbers; the bytes table includes `bd`.
- Scenarios that failed on a slow machine before this lane (jump pad landing during a level-up, pillar and fusion checks after a fixed wait) now poll.

## Protocol (not compatible with v1.6: peer prefix `infinishoot-v4-`)
- Host -> client: `np` {n} probes; snapshot extras `hs` (host step) and `bd` (bullet deltas, replaces `bu`); snapshot field `nq`.
- Client -> host: `np` {n} echo; `nst` {r rate, l loss 0..1, j jitter ms, d delay ms}; `i` gains `vt` (host step on screen).

## Files
- New: src/net/netsim.ts, src/net/interp.ts, src/net/lagcomp.ts, src/net/bulletCodec.ts, src/net/netQuality.ts, src/game/systems/netcode.ts, src/ui/netOverlay.ts, src/dev/netcodeLinks.ts, tests/netcode.test.ts.
- Changed (small, additive): src/net/peer.ts (prefix, spare slot, lastHeard, drop(), netsim, ICE callback), src/net/snapCodec.ts (bullet encoder in SnapEncoder, `bd`), src/net/codec.ts (export BULLET_COLORS), src/game/bullets.ts (uid, simTime), systems/netHost.ts, systems/netClient.ts, systems/online.ts (onClose -> reconnect, netcodeJoined), systems/render.ts (netA from the playout, renderNetcode), systems/statuses.ts (rewound hit test), src/game/coop2.ts (grace 60), systems/coop2.ts (reclaims into closed runs), settings.ts + screens.ts (NETWORK STATS), dev/testLinks.ts, scripts/coop-test.mjs.

## Unfinished / risky
- **Real internet not tested.** Only the simulated link and two headless pages on one machine. Real WebRTC reconnection timing (how long ICE takes to fail, TURN) is untested.
- **Lag compensation covers the bullet pool only.** Beams (Pulse Laser, Rail Driver), lobbed and area weapons, drones and auras still hit host-current positions. They test through `ctx` queries; extending means passing the hero's rewind to `WeaponCtx` queries.
- Lag compensation favours the shooter: a fast enemy can be hit up to 250 ms "behind" where the host has it. Enemy bullets hitting a client are not compensated (the client's own movement is local, so they already land where the client was on the host).
- **Background tabs.** A browser host in a hidden tab stops its game loop (no snapshots): clients see the host silent for 6 s and start reconnecting; they get back in when the host's tab is visible again (the Electron app never throttles). A hidden client keeps answering probes (event-driven), so it isn't dropped.
- The tab-reload rejoin relies on localStorage; two tabs of the same browser in the same game would share the record (only the first to load uses it).
- The loss figure is an estimate (stalls + late probes): a reliable channel never reports real packet loss to JavaScript.
- Snapshots on a real connection now arrive ~50-120 ms later on screen than before (the playout delay), in exchange for even motion. Menus and private info (`you`) wait in the same buffer.
- The machine running this lane had a load average of ~100 (a dozen builders at once): headless pages ran at a few frames per second, which makes `npm run coop` slow and its timing-sensitive scenarios touchy.
