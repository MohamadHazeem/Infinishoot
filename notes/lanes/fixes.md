# Lane: fixes (after the 10-lane big update)

Open items from the other lanes' "Unfinished / risky" notes, online polish, two co-op features and a balance check.

## What players get
- **Mini-bosses play by boss rules.** Prince Bopper, Rex Jr. and Hive Princess resist freezes like bosses (x0.15 freeze time; Cryo Sphere chill, Cryo Mines, Flash Freeze, Titan Stomp and parry stuns skip them), the Nuke takes its fixed 15% bite instead of killing them, far-away mini-bosses are never recycled closer, lava/ice/pillars take 25% / 8% instead of one-shotting them, and Medi Bots don't heal them. They still use their own cyan bar and never clear the stage (`def.boss` is unchanged).
- **Shooters don't shoot walls.** Blaster, Burst and Sniper Bots check line of sight to their target against the wall grid before winding up. Blocked, they keep strafing out of cover and look again 0.25 s later (Spin Bots still spray). Cover spots are only taken if the sidestep peek spot sees the target.
- **Online hit-stop feel.** Online, heavy hits and parries hold the picture on the hitter's own screen (enemies, bullets, particles and animation pause for the hit-stop's length, max 0.1 s) while the shared simulation keeps running. The host gets it for its own hits; a client gets it for its hero's hits (host sends an `hs` skill event).
- **Laggy parries are judged fairly.** Clients measure their round trip and send it with each parry. The host rewinds by half the round trip plus snapshot interpolation (capped at 0.25 s): a bullet whose path came within reach during that time is reflected, and a bullet that already hit within it is undone (life refunded) and reflected. Reach and window grow a little with ping (capped at the old fixed allowance). The client shows its parry instantly (sound, flash, shake, hit-stop, bullets flip) from its own view.
- **Rex really smashes cover.** Ruin walls, ruin pillars, trees and rocks that Rampage Rex (or Rex Jr.) charges into break: the prop disappears, its collider goes, the wall grid is rebuilt, with debris, smoke, a crater, CRASH! and a shake. Crates and pillar toys in his path take a full hit (pillars topple).
- **TURN relay support.** Builds can ship a TURN relay (fixed login or time-limited credentials from a URL), and players can enter their own under PLAY ONLINE > CUSTOM RELAY. A join that finds the host but can't connect now fails fast with "one of your networks blocks direct connections. Set a CUSTOM RELAY ..." instead of a 12 s "could not reach that game". Setup: docs/TURN.md.
- **Team combos (co-op).** My Burn + your Shock (either order) = a team Overload (x1.25 damage); my blast catching your Burn = a team Napalm. Both heroes get style (+18), a coin (at most one per 3 s each) and team score (60 x stage); "TEAM OVERLOAD!" pops on the enemy, and a TEAM COMBO banner shows on the first and every 10th.
- **Ping wheel (co-op).** Tap G / pad View for the old contextual ping. Hold it (0.2 s) for a wheel of GO HERE, DANGER, NEED HELP, CHEST, ON MY WAY and NICE; pick with the mouse or right stick, release to send, let go in the middle to cancel. NEED HELP / ON MY WAY / NICE mark the hero, the others the aimed spot.
- **Vampire Fang can't make you immortal.** Its heal scales with max life (0.05% per kill per level), and only 12 kills a second heal in full; the rest heal 10%.

## Knobs (debug panel > "Fixes: online, team, balance", src/ui/fixesPanel.ts)
- `bossRuleTuning` (src/game/bossRules.ts): freezeMul 0.15. `bossLike(e)` / `freezeMul(e)` are the helpers.
- `aiTuning.losPad` 0.3 m, `aiTuning.losRetry` 0.25 s (src/game/enemies.ts). `StaticBoxGrid.segmentClear(x0, z0, x1, z1, pad)` (src/core/spatialHash.ts) walks only the cells the segment crosses.
- `netFeelTuning` (src/game/netFeel.ts): stopScale 1, stopMax 0.1 s, heartbeat 1 s, rttBlend 0.3, interp 0.05 s, maxRewind 0.25 s, reachPerSec 2 (max +0.45 m), windowPerSec 0.5 (max +0.1 s).
- `coverTuning` (src/game/coverBreak.ts): reach 0.4 m, maxSize 6 m.
- `iceTuning` (src/net/ice.ts): fetchTimeout 3 s, cacheFor 10 min.
- `teamTuning` (src/game/teamPlay.ts): overloadMul 1.25, style 18, gold 1 per 3 s, score 60 x stage, minGap 0.4 s, shockMemory 4 s, holdTime 0.2 s, pickPx 28, pickStick 0.45.
- `lifestealTuning` (src/game/lifesteal.ts): killsPerSec 12, overflow 0.1.

## Test links
- `?test&stage=2&god&smash=2` stands you next to the nearest smashable cover and smashes it after 2 s.
- `?test&stage=2&bossnow&god&nointro` Rex charging through cover. `?test&stage=3&miniboss&god` a mini-boss (try a Nuke via the debug panel).

## Co-op / protocol (all backwards compatible)
- Client -> host: `{t:'hb', c}` (host echoes `{t:'hb', c}` to that client); `parry` gains `rtt` (ms); `ping` gains `k` (ping kind, validated against `PING_KINDS`). Old hosts ignore `hb`, `rtt` and `k`; old clients ignore `hb` replies.
- Host -> clients: `{t:'cover', i, s}` (index into the seeded cover list, arena stage; ignored for another arena) like the `barrel` message; skill event kind `hs` (extra = stop seconds) in the snapshot's `sk.e`; old clients ignore unknown kinds.
- No codec change.

## Verification
- `npm run typecheck`, `npm test` (18 files, incl. tests/fixes.test.ts and tests/fixesCoop.test.ts: LOS cases, mini-boss Nuke/recycling, shooter holding fire behind a wall and firing without it, parry lag maths, rewound bullet reflected, landed hit refunded/old hit kept, online hit-stop on the right machine and never a sim freeze, cover smash + client message + arena-stage guard, Rex rampage, relay parsing/credential shapes/build-time vars, team Overload both orders, team Napalm, solo Overload not a team combo, ping-wheel slices and validation, heartbeat echo), `npm run smoke`.
- Screenshots: shots/smash1.png (cover gone, smoke and crater), shots/relay_bad.png / relay_good.png (PLAY ONLINE with the relay field), shots/pingwheel.png.
- Shooter LOS cost: `segmentClear` takes ~0.5 us per 4-20 m check over an arena-like grid (200k random checks, loaded machine); shooters make about one or two a second each. `npm run bench` (heavy scene, HIGH, 15 s; the machine was shared with other lanes so absolute numbers are ~10x the perf lane's): `sim.enemies` 1.02 / 1.20 ms per step at this lane's head vs 1.16 / 0.98 ms at the base commit, i.e. no measurable change.

## Balance (dev bot, jsdom harness, Normal, numbers vary run to run)
Vampire Fang / Glass Cannon (mortal bot, Buster / Charge Shot / Bomb, Fang 3 and/or Glass Cannon given at the start, seeds 1-4, up to 1500 s):
| | survival time (s) per seed | mean | stage reached | healed / taken (longest run) |
|---|---|---|---|---|
| no Fang, no Glass | 418, 265, 821, 730 | 559 | 2, 1, 4, 3 | 469 / 569 |
| Glass Cannon only | 403, 463, 420, 483 | 442 | 2, 2, 2, 2 | 111 / 151 |
| Fang 3, before | 1300, 793, 1162, 528 | 946 | 5, 4, 5, 2 | 1636 / 1736 (94%) |
| Fang 3, after | 263, 509, 258, 811 | 460 | 1, 2, 1, 4 | 246 / 346 |
| Fang 3 + Glass, before | 253, 1317, 1394 (alive), 254 | 805+ | 1, 6, 6, 1 | 1496 / 1536 (97%) |
| Fang 3 + Glass, after | 260, 466, 1029, 392 | 537 | 1, 2, 4, 2 | 306 / 346 (mostly level-up heals) |
The bot mostly dies to boss bursts (35% hits), so its survival is noisy; the clear signal is that before the change Fang healed back 94-97% of all damage in long runs, and with Glass Cannon it refilled 40 max life in seconds. Fang 3 healing per 100 max life, before -> after: 13 kills/s (stage 1) 1.95 -> 1.82 life/s; 35 kills/s (stage 3) 5.3 -> 2.1; 60 kills/s (stage 5) 9.0 -> 2.5. Early game is unchanged, the late-game snowball is gone, and Glass Cannon's x0.4 life now also means x0.4 healing.

New-enemy sweep (enemies lane: Shield Bot, Medi Bot, Hop Frog, Mortar Toad, elite squads were never bot-measured). "Legacy" switches the four new enemies and the squads off in the same build:
- Stage 1, mortal bot, Buster / Charge Shot / Bomb, seeds 11-16 (330 s): current 5/6 clear stage 1, damage taken in stage 1 by survivors 0-119 (mean 63), level 17-19 at the end; legacy 5/6 clear, 60-159 (mean 112), level 16-20. Stage 1 is not harder than before the enemies lane (survivors took less damage with them on, within the noise), so `squadSize` and Shield Bot `frontMul`/weight are unchanged.
- God bot, Scattergun / Grenade / Thunderstorm (the PLAN v1.2.1 kit), seeds 1-2: levels at stage clears 17 / 24-25 / 32 (v1.2.1: 17 / 23 / 30); bosses King 17 / 17 s, Rex 27 / 12 s, Queen 35 / 38 s (v1.2.1: 32 / 25 / 33; bosses lane: 24 / 23 / 46). Legacy: levels 15-17 / 22-24 / 29-30; King 19 / 15 s, Rex 18 / 18 s, Queen 49 / 80 s.
- God bot, Pulse Laser / Gravity Well / Meteor Shower: levels 19 / 27 / 35 / 43; King 15 s, Rex 22 s, Queen 24 s, Omega 45 s.
- God bot, Rail Driver / Orbital Strike / Blizzard: levels 17 / 25 / 32 / 41 / 50; King 10 s, Rex 9 s, Queen 10 s, Omega 14 s, loop-2 King 6 s. This kit melts bosses (3-5x faster than the others); worth a look by whoever owns weapon balance (not changed here).

## Unfinished / risky
- `npm run coop` could not run here: the egress proxy refuses 0.peerjs.com (403), so the real two-browser test over the public broker wasn't possible. The new messages are covered by the in-process host/client test (tests/fixesCoop.test.ts). The TURN path itself (a real relay, ICE failing over to it) is untested; `iceStateChanged` 'failed' detection relies on PeerJS 1.5's DataConnection event.
- Online hit-stop holds the picture while the world moves on, so the frame after a stop jumps ~0.05-0.1 s ahead. It reads as a crunch at these lengths; set `netFeelTuning.stopScale` 0 to turn it off.
- Parry refunds can't undo everything a hit did: the combo break, style drop and knockback stay; only life comes back.
- Breakable cover: if a later lane gives static props outlines or other derived meshes, they need hiding too (`hideMergedRanges`). Smashed cover doesn't come back in Endless (same arena).
- Team combos only cover Overload and Napalm; Shatter would need freeze ownership at every freeze site.
- The ping wheel has no touch button (src/ui/touch.ts isn't this lane's).
- Vampire Fang's new numbers are a proportional cut, not playtested by people.

## Decision-log paragraph for PLAN.md
> 2026-10-19: Fixes lane. Mini-bosses follow boss rules (freeze x0.15, the Nuke's fixed bite, never recycled, no hazard/pillar one-shots or Medi Bot heals) without the boss bar (`bossLike`, src/game/bossRules.ts). Aimed shooters check line of sight on the wall grid before firing and only take cover they can peek out of (`StaticBoxGrid.segmentClear`, ~0.5 us a check). Online feel: heavy hits and parries hold the picture on the hitter's own screen (render-side, the shared simulation never freezes; `hs` skill event for clients), and parries are judged with lag compensation: clients measure their round trip (`hb` echo) and send it with `parry`, the host rewinds bullets by RTT/2 + 50 ms (max 0.25 s), refunds and reflects hits inside that window, and the client predicts its parry for instant feedback. Rampage Rex smashes ruin walls, pillars, trees and rocks for real (mergeStatic records each prop's triangle range; collider and wall grid rebuilt; `cover` message for clients). TURN relays: build-time VITE_TURN_* variables, a credentials URL (metered.ca / a Worker in front of Cloudflare Calls) and a CUSTOM RELAY field on PLAY ONLINE, with a clear error when a join finds the host but can't connect (docs/TURN.md). Co-op team combos (my Burn + your Shock, my blast on your Burn: both credited, x1.25 Overload, style, a coin, score) and a hold-to-open ping wheel (GO HERE, DANGER, NEED HELP, CHEST, ON MY WAY, NICE). Vampire Fang heals per 100 max life and only 12 kills a second heal in full (it healed back 94-97% of damage in long bot runs; late-game healing 9 -> 2.5 life/s, stage 1 unchanged). Bot sweep of the enemies lane's additions: stage 1 isn't harder (5/6 mortal clears either way, less damage taken than with them switched off), so their knobs stay; Rail Driver / Orbital Strike / Blizzard kills bosses 3-5x faster than other kits.
