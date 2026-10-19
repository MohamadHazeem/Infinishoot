# Lane: eightp (8-player online co-op)

## What players get
- **Up to 8 players online.** PLAY ONLINE > HOST takes 8 in CO-OP and WEEKLY (PvP already took 8); VERSUS SWARM stays at 4 (its Overlord tuning). The lobby refuses a 9th ("That game is full."), drop-in/reconnect admit up to 8 ("That run is full (8 players)."), the public lobby browser lists `n/8`, the worker accepts `max` up to 8, the HUD's JOINABLE badge reads `n/8`. Starting a Versus game with more than 4 in the lobby is refused with a toast. Players 5-8 use HERO_COLORS 5-8 (pink, violet, cyan, lime), which already existed for PvP; the clutch-revive high-five hands got sleeve colours for them too.
- **Scaling for 5-8 (2-4 player runs are unchanged: every rule below is the identity up to 4).**
  - Enemy count: players past four count 0.5 each (8 players = 3.5x solo instead of 4.5x). Enemy life: past four count 0.6 each (8 = x3.43 instead of x4.15). Boss life keeps the linear 2-4 slope (8 = x5.2): eight heroes melt bosses otherwise.
  - The alive cap (450) already trims 4-player hordes late in a stage; whatever it cuts from a 5-8 team beyond the 4-player cut comes back as enemy life (`capHpComp`, at most x1.5). Result (stage 3, minute 2): horde "work" (alive x life) per hero at 8 players is ~1.0x the 4-player level; plain linear scaling would have been ~1.6x (and over the cap), the past-4 slopes alone ~0.73x.
  - Hearts and coins: +10% per player past four (8 = x1.4): the horde grows slower than the team, so per-player drops would have thinned.
  - Revives: in 5-8 teams each extra hero standing by a downed teammate speeds the revive up 35% (cap x1.7): 3 helpers revive in ~106 steps vs 181 with one.
  - Revive pool (when on): +1 starting life per 2 players past four (8 = 5 lives), cap +1 per player past four (8 = 10), buy-back cost +12% per player past four (it is split between more people).
  - Boss chests: still one owned chest per hero; 5-8 heroes get them in a ring (r 1.7 m) around the boss instead of a 6 m row.
  - Run start: 5-8 heroes stand in two rows (2.2 m apart) instead of one long line.
  - TEAM meter and team moves: heroes past four count half for charge rate and power (8 heroes = 6 "effective": x2.6 power, x2.4 charge rate, instead of x3.4 / x3.1).
  - Team ultimate: up to 4 heroes it still needs everyone; with 5-8 alive, a quorum of 60% (at least 4) firing inside the 2 s window is enough and only they take part. Damage per wave counts heroes past four half; the radius stops growing at 6 heroes.
  - Pings: 5-8 teams share a budget of 4 pings per 2 s (on top of the 0.7 s per-player limit) so the field doesn't fill with labels.
- **HUD for 8.** With 5+ heroes the teammate list (top left) turns into one-line rows (name, then a short bar). Name tags declutter: near (< 9 m), healthy, on-screen teammates show a short tag (first 5 letters, smaller); overlapping tags stack upward (nearest stays put); off-screen edge pointers show the short name and distance and stack when they point the same way. Downed teammates keep their full tag and REVIVE bar. The minimap draws teammates as 2x2 dots (yours stays 3x3 and blinks).
- **Camera.** CO-OP CAMERA (SETTINGS > CO-OP): TEAM (default) frames teammates as before; with 5-8 heroes it frames only the nearest 5 within 26 m, so one player wandering off doesn't zoom everyone out (they keep their edge pointer). ME is a "follow me" camera: no team framing at all.
- **Performance with 8 heroes.**
  - Hero overlays (merged outline hull + x-ray, readability lane) draw with frustum culling off; teammates off screen now skip them (3 draw calls each).
  - Particle LOD (src/render/lod.ts): with 3+ heroes, bursts further than 14 m from you thin out (to x0.45 at 42 m) and by team size (1 / (1 + 0.07 x (heroes - 2))), never below x0.25; near you nothing changes; solo and 2-player games are untouched.
  - Teammate weapon mix (src/audio/mix.ts `TeamWeaponMix`): your own weapon cues always play in full. Teammates' weapon cues ('w:' sounds) get a per-cue minimum gap that grows with the number of teammates and with distance, a gain cut (7% per teammate past one, floor 50%), a duck to x0.7 for 90 ms after your own shot, and at most 6 teammate weapon cues per 100 ms overall. New AUDIO slider TEAMMATE WEAPONS (0.8). Same-cue spam from 7 teammates every 10 ms plays ~5 of 100.
- **Netcode for 8.** No new snapshot fields (the roster already travels in `heroes`); bullet records carry the owner hero in 3 bits (was 2: heroes 5-8 drew with heroes 1-4's weapon skins); the rewind timeline holds 8 heroes.
  - Teammates' weapon state in a client's snapshot: within 36 m every snapshot (as before), 36-60 m every 2nd, beyond 60 m every 5th (the codec leaves the repeated list out). Teammates' reload meters (`ready`) go in quarters (only your own meter is drawn).
  - Each client's snapshot keyframes are staggered (phase = hero index x 5 of the 40-snapshot cycle) instead of all 7 landing on one step.
  - With 4+ remote clients the host spreads snapshot building over the 3 snapshot steps (client k on steps where (step + k) % 3 = 0, effects queued per client), still 20 Hz each. 2-4 player games keep the old path.

## Measurements (`npm run coop8`, host + 7 clients as in-process jsdom peers, autopilot on every machine, seed 8, 30-40 s with a forced 200-450 enemy horde, a boss and its chests; on a heavily loaded shared machine, so CPU numbers are noisy)
| | 4 players | 8 players |
|---|---|---|
| snapshot bytes per client (binarypack, avg / p95 / max) | 3035 / 5961 / 14689 | ~3900-4200 / ~6700 / ~18000 |
| per client | ~59 KB/s | ~68-82 KB/s |
| host upload, all clients | ~180 KB/s | ~480-570 KB/s (~4-4.5 Mbit/s) |
| snapshot body / enemies / pickups / bullets / effects per snapshot (B) | 1283 / 983 / 237 / 50 / 444 | ~2050 / ~860 / ~250 / ~100 / ~700 |
| snapshot build per client (jsdom) | ~1.0 ms | ~1.0-1.2 ms |
| client -> host input, all clients | | ~21 KB/s |
- The biggest snapshots are keyframes in a capped 450-enemy horde (~10 KB of enemy records alone); PeerJS chunks anything over 16 KB (handled since the coop lane's fix), so the budget is 24 KB max, 6 KB average.
- Snapshot body: teammates' weapon state (`heroes.w`) is the largest share (~1.2-1.7 KB per snapshot with 8 bots who stay close together; Blaze Boots trails, the Buster and Charge Shot change every step), then other lanes' fields (`ha` halloween ~300 B, `ss`, `s2`, `sk`).
- Staggered building: snapshot work per host step p90 5.8 -> 4.75 ms, p95 12.6 -> 9.5 ms in jsdom (noisy machine).
- Browser bench (`npm run bench`, heavy scene, swiftshader; the machine was too loaded for frame times, the per-phase CPU sums are the comparable part): solo 2.6 ms (production build), 4 heroes on autopilot 3.07 ms, 8 heroes 3.11 ms (dev builds). Draw calls 121 solo / 215 with 4 heroes / 259 avg (357 max) with 8.

- Final run (40 s, seed 8): 3881 B per snapshot per client (p95 6861, max 18309), ~70 KB/s per client, host update 4.4 ms avg in jsdom (incl. the bots), snapshot work per host step p50 0.95 / p90 3.7 ms, 9 of 9 state checks ok, boss killed, 8 owned chests.

## `npm run coop` (real 2-browser WebRTC check)
- Fails here with 7 timing failures (turret owner/timer, director2 events one step late, party/kick screens) after the client's connection stalled under the machine's load ("connection lost, reconnecting" at 121 s). The same script on the untouched base commit (9fcbafc) also fails with 7 of the same kinds (turret, director2, ping portrait, party BACK TO LOBBY, kick; "host silent 13151 ms" at 188 s), so these come from the loaded machine, not this lane. Rerun on a quiet machine before merging. Everything 2-4 player in this lane is the identity (rules) or keeps the old code path (snapshot sending); the only change a 2-player game sees on the wire is the owner hero in 3 bullet bits, teammates' reload in quarters and a keyframe phase.

## Knobs
- `eightpTuning` (src/game/eightp.ts): countPast4 0.5, hpPast4 0.6, bossPast4 1, capHpMax 1.5, teamPast4 0.5, lootPerPlayer 0.1, poolStartEvery 2, poolMaxPer 1, poolCostPer 0.12, reviveHelper 0.35, reviveMaxMul 1.7, ultQuorum 0.6, ultRadiusHeroes 6, frameRange 26, frameMax 5, tagNear 9, tagGapX 56, tagGapY 15, edgeGap 24, tagShort 5, pingBurst 4, pingWindow 2, farHero 60 / farEvery 5, midHero 36 / midEvery 2, staggerFrom 4, mateReadySteps 4.
- `lodTuning` (src/render/lod.ts): near 14, far 42, farMul 0.45, perHero 0.07, minMul 0.25, fromHeroes 3, screenMargin 1.25.
- `teamMixTuning` (src/audio/mix.ts): ownRadius 1.4, gap 0.035, gapPerMate 0.018, gapDist 18, perMate 0.07, minGain 0.5, duck 0.7, duckTime 0.09, window 0.1, windowMax 6.
- Debug panel folder "8-player co-op" (src/ui/debugEightp.ts). Settings: `coopCamera` ('team' | 'me', SETTINGS > CO-OP > CO-OP CAMERA), `mateWeapons` (0.8, SETTINGS > AUDIO > TEAMMATE WEAPONS).

## Test links (src/dev/eightpLinks.ts, with the readability lane's `heroes=<n>` dummies)
- `?test&heroes=8&matebots&spread=16&matenames&god&seed=42&spawn=swarmer:30` 8 heroes fighting: compact team list, short tags, minimap dots (shots/eightp-team.png)
- `?test&heroes=8&matebots&spread=45&matenames&god&seed=42&matedown=2` a spread-out team: edge pointers with short names and distances, two downed teammates (shots/eightp-spread.png)
- `?test&lobby8` the host lobby with 8 players (shots/eightp-lobby.png)
- `matebots`: every dummy plays on the autopilot brain; `spread=<m>`; `matenames`; `matedown=<k>`.

## Tests
- `tests/eightp.test.ts`: pure rules (identity up to 4, director slopes and cap compensation, pool/revive/loot/team-move numbers, ultimate quorum equals the old rule for 2-4 on 400 random cases, spawn rows, chest ring, frame picking, tag declutter, ping budget, far-hero refresh, teammate mix, particle LOD), then a whole 8-player team in one process: lobby of 8, a 9th refused, Versus refused, hostStart with 8 heroes on every machine, clients moving on their own input and mirrored by the host and each other, snapshots to all 7, far/near weapon refresh, a 5-of-8 team ultimate, faster revives with 3 helpers, 8 owned boss chests in a ring.
- `tests/eightpHarness.ts`: the shared in-process team (used by the test and `npm run coop8`).
- `tests/coop2Coop.test.ts` (shared, small edit): players 5-8 now join; a 9th is refused; they quit again so the rest of the test plays with four. The team-ultimate beat check now waits for the next snapshot (every 15 steps while a hit-stop freezes the world) instead of exactly 3 steps.
- `npm run coop8` (scripts/coop8.mjs + scripts/coop8-run.ts): fails on runtime errors, lasting desyncs (two failed 4 s checks in a row: own hero > 3 m, a teammate > 4 m, mirrored enemies off by more than max(12, 25%)), avg snapshot > 6 KB, max > 24 KB, build > 3 ms per client, or fewer owned chests than heroes. Options: `--players 4`, `--seconds 90`, `--seed 3`, `--json out.json`, `--no-stagger`; `COOP8_BODY=1` prints which body fields cost the most.

## Files
- New: src/game/eightp.ts, src/game/systems/eightp.ts, src/render/lod.ts, src/dev/eightpLinks.ts, src/ui/debugEightp.ts, scripts/coop8.mjs, scripts/coop8-run.ts, tests/eightp.test.ts, tests/eightpHarness.ts.
- Small edits: src/audio/mix.ts (additive TeamWeaponMix), src/game/vfx.ts (gate 'w:' cues), src/game/particles.ts (particleLod), src/render/rigOverlay.ts + systems/readability.ts (`detail`), src/game/director.ts (past-4 slopes, cap compensation), src/game/coop2.ts + systems/coop2.ts (caps, pool, quorum, `pilotHero` exported), systems/coop.ts (revive helpers), teamMoves.ts + systems/companion.ts (team heroes), systems/statuses.ts (chest ring, loot), systems/runFlow.ts (spawn rows), systems/online.ts, systems/pvp2.ts, systems/netHost.ts, systems/mp.ts (caps, weapons interest, stagger, keyframe phase), src/net/snapCodec.ts (keyframe phase), src/net/codec.ts + bulletCodec.ts (owner 3 bits), src/game/timeline.ts (MAX_HEROES 8), systems/anim.ts (frameMates), systems/render.ts (frame hook, tag declutter, ping budget), src/ui/hud.ts (compact list, mini/dy tags, minimap dots), src/ui/coopHud.ts (n/8), src/ui/timeHud.ts (sleeves), settings + settingsScreen, i18n en/ar (`eightp.*`), server/leaderboard/lobbies.js (max 8), dev/testLinks.ts, ui/debugPanel.ts, package.json (`coop8`).

## Unfinished / risky
- Not played by people; 8 real browsers over WebRTC were never connected (8 Chromium pages are too heavy here). `npm run coop` still runs the real 2-browser check; `coop8` checks 8 players' game logic and bandwidth in one process (no WebRTC, no binarypack chunking, no latency).
- Host upload for 8 is ~4-4.5 Mbit/s with bots that stay close together; a spread-out team is cheaper (far heroes' weapons refresh less). Hosts on slow uplinks will struggle; the next step would be thinning teammates' weapon state further or delta-coding weapon lists per weapon.
- The CPU numbers come from a machine running ~12 builders at once (load ~84 on 18 cores): bench frame times were meaningless, only per-phase sums and draw calls were compared. A real-GPU check with 8 heroes is still needed.
- Balance for 5-8 comes from the scaling model (horde work per hero kept at the 4-player level), not from long bot runs per player count; the dev bot runs solo. Watch boss times and wipe rates in real 8-player runs.
- Edge pointers can still sit under HUD panels (minimap, objective) at the screen edges; that predates this lane but is more visible with 7 pointers.
- Local co-op stays at 4 (one machine, four pads).
