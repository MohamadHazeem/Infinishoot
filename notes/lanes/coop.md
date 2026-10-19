# Lane: co-op test and fixes (after the 10-lane big update)

## How it was tested
`npm run coop` (scripts/coop-test.mjs, about 95 s) runs two real game instances in headless Chromium (chrome-headless-shell from Playwright's cache, swiftshader WebGL, the same setup as `npm run shot`) against a Vite dev server on 127.0.0.1:
- Page A hosts online co-op through the real code path (`game.hostGame`, `host.code`, `hostStart`), page B joins with the invite code (`game.joinGame`). Each page has its own browser context (own localStorage).
- Signalling uses PeerJS's public broker, like the shipped game. It was reachable from here, so no local signalling server was needed. If it is ever down, the script fails early with "host could not register with the signalling server". The WebRTC data channel itself is page to page.
- Both pages play with the dev bot. New `botAuto(on)` in src/dev/bot.ts feeds bot input into the live game loop, so the host and the client both run at real time. Clients answer the level-up and shop screens through UI messages (throttled).
- The whole run is at night in the rain (`lookOverrides.night`, `weatherForce`, set on both pages before the first arena loads). Situations forced through the dev handles, in order:
  1. Shield Bots, Medi Bots, Hop Frogs, Mortar Toads, chargers, snipers and splitters near the client, plus a Shielded elite and the Goldbug.
  2. The client takes a jump pad (the host must receive `jump` and start the jump).
  3. The client switches on a turret (host owner = client, client sees the timer).
  4. The host topples the pillar nearest the client (the client sees it fall).
  5. Ultimates charged for both heroes (the bot fires them).
  6. A mini-boss (Prince Bopper).
  7. The stage boss with its entrance (the client plays the same intro), pushed to phase 3.
  8. A ring of enemy bullets around the client (the bot parries).
  9. Ultimates again.
  10. The client hero downed, then revived.
  11. The stage-1 shop, the portal and stage 2.
- Every 4 s the script compares the host and the client: stage, seed, arena stage, team level and kills, enemies in the client's interest box (count, types, positions by uid), boss and mini-boss phase, objective kind/state/progress, arena props and totems alive, and each hero's HP, dead flag, position, style points, ultimate charge/active and weapons (build keys). A difference that lasts two checks in a row fails the run, as does any page error or console error on either page.
- Screenshots of both views go to shots/coop/ (t12, t30, t48 and the end).
- It also counts skill events sent and received (perfect dash, parry, ultimate, rank-up), effect kinds received by the client (corpses 'c', bursts, sounds, scars, zones...) and snapshot sizes.
- `COOP_TRACE=1 npm run coop` prints the client hero's position trail on both pages when they disagree.

Typical clean run: about 1,400 snapshots, average 5-6 KB, max 17-25 KB, 1-11 of them over 16 KB. Every skill event the host sent arrived. The client got ~1,400 corpse events and every other effect kind.

## Bugs found and fixed
1. **Client crash on big snapshots** (src/net/codec.ts). PeerJS splits messages over ~16 KB into chunks. Its reassembly unpacks binary fields as `Uint8Array` views, not `ArrayBuffer`s, so `new DataView(s.en)` threw "First argument to DataView constructor must be an ArrayBuffer" and the client's snapshot handling died. Boss fights with phase effects, corpses and dense hordes push snapshots past 16 KB, so this hit every boss fight. The unpackers now take `ArrayBuffer | ArrayBufferView` (`NetBytes`). tests/netCodec.test.ts runs a record through the real binarypack unpack of a chunked message.
2. **Stale boss reference after the boss dies** (src/game/systems/statuses.ts). Enemies are pooled. When the director spawned something in the same step the boss died (normal spawns keep going at 25% during a boss), it reused the boss's object, and `game.boss` then pointed at a Chonk. Clients got a boss bar for "Chonk", and the stage didn't clear until that Chonk died. The same applied to `bossField.mini`. `killEnemy` now drops both references as soon as the enemy is freed. This bug isn't co-op only (solo had the same stall), but clients show it most clearly.

Test-side only (no game change): build weapons have to be compared by `buildKey`, not `level` (clients only sync the key). a downed client can be back up within ~1.5 s (Phoenix Plume, or a teammate standing close with faster revives), so the script re-hits and polls.

## Checked and found in sync (no change needed)
- Enemy records for the new types and AI bits, elite modifiers and shields, Goldbug blink and escape.
- Boss phases and roars (`bx`), the mini-boss bar, shockwaves and fire patches, the boss entrance on the client, and the kill-cam from the corpse event.
- Arena toys: props, pillars, totems, shards, turrets, jump-pad messages and landing shocks (host only, no double), the objective tracker.
- Skill layer: style points and notes, ultimate charge and active time, Blitz speed on the client, and pd/pa/ul/rk events. A client's parry is simulated once, on the host; the client draws only its own swing.
- Rain is seeded per arena, so it matches on both machines. Lightning timing and footprints/dust are local cosmetics, as designed.
- Down/revive visibility, the shop and level-up flow over UI messages, and the stage transition (same arena and objective on stage 2).

## Not fixed / not verified
- **Jump pad during a host level-up.** If the client steps on a pad in the ~50-250 ms before it learns the host froze for a level-up, the host rejects the `jump` (`isCombatMode` is false in levelup). The client still flies (its movement is its own), but the host copy gets no jump i-frames or landing shock for that jump. Rare and harmless; not changed.
- **Parry swing on other screens.** The host (and other clients) don't see a client's parry *swing*, only the PARRY! burst when it reflects something. This avoids double-drawing it on the parrying client.
- **Snapshot size.** Effects (mainly particle bursts with full option objects) make most of the 5-6 KB average and the 17-25 KB peaks: about 110 KB/s per client at 20 Hz. It works, but a compact burst encoding would cut it a lot. Left for a later pass.
- **Co-op camera framing** (anim lane) can push the local hero close to the top edge when a teammate is far away and the aim lead points the same way (seen in a host screenshot). Cosmetic. Not changed.
- Not exercised: 3-4 players, a client leaving mid-run, PvP duels with the new systems, a hidden host tab, real network latency or loss (both pages share one machine), and audio (headless has no output).
