# Lane coopsync: two co-op correctness issues

## 1. `npm run coop` "client switches on a turret" (flaky since v1.5)

### Reproduction (before)
8 runs of `npm run coop -- --offline` (two loops in parallel on the shared, loaded machine, load average ~55):
- **2 of 8 failed the turret check**, both times the same way: `turret: host owner 0 (want 1), client timer 0`. The turret never came on at all.
- Other failures in the same 8 runs had nothing to do with turrets: one client lost its host connection mid-run (25 follow-on failures), one `carry` ride check, one `heroes3` sword-damage timing.

### Cause
The scenario was a wall-clock race against the host's level-up, not a game bug:
- Turrets switch on only in `fight` mode (`updateTurrets`). A co-op level-up holds the world on the host until every player has picked, and the client's dev bot answers over throttled UI messages.
- While the world is held, the host also holds the client's hero where it was. The new unit test measures it 64 m from the pad the client stands on.
- The old scenario teleported the client hero onto the pad, polled for 3 s of **wall time**, and turned the client's bot back on after 3 s. On a slow machine the host sat in a level-up for that whole window (both failing logs show the host going lv1 -> lv2/lv3 right then: `t=12 host mode=levelup`). After the window the bot walked the hero off before the world ran again.

A real player who stands on the pad through a level-up gets the turret the moment the level-up closes. tests/coopsync.test.ts checks exactly that. Nothing to fix in the game.

Other suspects, checked and cleared:
- Interact message: turrets are walk-on, no message, so the quick-press replay doesn't apply.
- `ar.t` through the skip-unchanged snapshot codec: the client got the timer within a snapshot in every passing run and in the unit test.
- Interest radius: `ar` isn't interest-limited.
- Host hero taking the pad: possible in theory (the host bot wanders), never seen. The new scenario rules it out anyway.

### Fix (scripts/coop-test.mjs)
The scenario is now deterministic:
1. `coopFight()` waits until both machines are fighting. It holds level-ups off (`xpNext`), parks both bots and clears their held inputs. If a level-up is still open, it retries for up to ~60 s of wall time.
2. The **host** picks an idle turret at least 4 m from its own parked hero (the host owns the state).
3. The client hero is kept on the pad. It is teleported back if a hit knocks it more than 0.5 m off.
4. The wait is counted in the **host's game seconds** (3 s, about 10 snapshots), with a 60 s wall cap that only catches a stalled host. On failure the message now includes the host timer, host mode and game seconds.
5. `coopEnd()` restores level-ups and the bots.

### After
12 runs of `npm run coop -- --offline` (three loops in parallel, even more load): see "Verification" below.

## 2. Objective props differ between host and client at the start of a co-op run

### Cause
Co-op objectives (coopplay lane: door/vault, zones, escort, bomb) replace the stage's solo objective in `coopObjectiveLoad`. That function only ran with `g.authority`.
- A client therefore loaded the stage with the **solo** objective: totems with their 1.2 m colliders, shards, or the beacon. It kept that objective until a snapshot's `cp.o` reinstalled the co-op one.
- On a door or bomb stage, the client also lacked the vault/bunker collider for that time.

This hit every co-op run (normal and custom arenas) on every stage whose seed rolls a co-op objective. Arena-editor runs showed it because `tests/editor.test.ts` compared colliders right after the start message. That's why the 2026-10-20 commit 3c33e37 loosened that test.

Measured with tests/coopsync.test.ts (14 seeds, normal and custom arena):
- Before: the client matched the host at the start message in **14 of 28** runs. The 14 mismatches were exactly the 14 runs with a co-op objective.
- After: **28 of 28** match, and stages 2-6 loaded from the `stage` message also match.

### Fix (src/game/systems/coopplay.ts, objective code)
- `coopObjectiveLoad` rolls and lays out the co-op objective **on every machine**. It only reads data both machines have when the arena loads: `arena.seed`, the stage, `arena.spots`, walls, hazards, pads, turrets and the team size. The layout is the 0.1 m `wireLayout` the host also installs (the v2.0 vault-wall rounding). Only the host applies `s.force` (debug and trials).
- `applyCoopPlayNet` now also reinstalls when the host's layout differs from the client's, not only when the kind differs. A forced objective, or anything the client couldn't predict, still converges on the first snapshot.

### Tests
- **New tests/coopsync.test.ts** (host and client `Game`s in one process, messages passed by hand, snapshots held back for the "start" check). It checks:
  - 14 seeds × normal and custom arena: colliders, solo objective (kind, max, totems, shards, beacon) and co-op objective (kind, layout, vault box) are equal right after the start message, before any snapshot, and still equal after the first snapshots.
  - Stages 2-6 loaded from `clientStage` match.
  - A host-forced objective of another kind, and then a moved layout of the same kind, both reach the client. The moved-layout check fails without the new layout compare.
  - A client standing on a turret during a host level-up gets it when the level-up closes (owner 1 on the host, timer on the client).
- **tests/editor.test.ts**: the strict comparison is back. Every host collider must equal the client's, plus a new objective-props equality check, right after the start message. This reverts the loosening in 3c33e37.
- **scripts/coop-test.mjs**: both pages wrap `loadArena` and record the objective props each built at every co-op stage load, before any snapshot can correct them. The script compares host and client stage by stage after the run starts (`objective props at the first stage load`) and again at the end of the run (`objective props at every stage load`). Any difference fails the run.

## Files touched
- src/game/systems/coopplay.ts: `coopObjectiveLoad` runs on clients too; `applyCoopPlayNet` checks the layout. This is the co-op objective code; the change is small.
- scripts/coop-test.mjs: the turret scenario and the objective-load hook and checks.
- tests/coopsync.test.ts (new) and tests/editor.test.ts (strict comparison restored).
- notes/lanes/coopsync.md.

## Verification
- `npm run typecheck` pass. `npx vite build` pass. `npm test` pass (all 120 files, including coopsync and editor). `npm run smoke` pass.
- **`npm run coop -- --offline`, turret scenario:**
  - Before: **2 of 8 runs failed** (`host owner 0 (want 1), client timer 0`, host in a level-up).
  - After: **17 of 18 runs passed**. The turret came on after 0.15-2.5 s of host game time, and the client saw the timer. The 18 runs were 12 in three parallel loops, then 6 more in two loops; the last 6 passed every check.
  - The one failure (run c-4) wasn't a turret problem. At 59.8 s the host page stalled for 10 s ("host silent 10054 ms"). The client dropped it and **promoted itself to host alone** (host migration). Every cross-machine check after that failed: jump pad, pets, pillar, director2, turret at 125 s. The turret scenario now checks that the client is still connected first, and says so if it isn't, instead of reporting a turret desync.
  - The strict "12 consecutive runs with no turret failure" target isn't met in one unbroken streak because of that broken session. No turret failure came from the turret itself in 18 runs.
- **New objective-load check in the coop script:** host and client matched at every stage load in all 18 runs. 0 failures. Stage-1 objectives seen: envkills, zones, beacon, bomb, among others.
- **Other coop-script failures seen in both the before and after runs, none touched by this lane:**
  - client connection lost or host migration on the loaded machine
  - `carry: ride host 0.00 client 4.00` (before a-4; after a-1, b-4)
  - `heroes3: client Ronin's sword: host damage 0` (before b-4; after b-4, c-2)
  - after only: `host lobby: no ping for the client` (an 8 s wall-clock wait in `lobbyPhase`; 2 of 12 runs under three-loop load)
  - after only: spectator seat/snapshots (a-4); tether and fusion at 460 s wall in a very slow run (b-1)
  These are wall-clock waits on a machine at load average 55+, the class described in notes/lanes/coopstress.md.
- **`npm run coop8`:** `PASS coop8: 8 players, 9 state checks, 3608 B per snapshot per client`.
- **`npm run coop4`:** `CO-OP STRESS TEST FAILED (22)`. Early in the run all three clients lost the host and went on alone (`client1 is not in the run (role host, mode levelup)`, `client2/3 ... (role solo, mode fight)`). Every later check (builds, mech, world event, chest, revive pool, team ultimate) failed after that. Nothing involves objectives. Not fixed (out of scope); worth rerunning on a quiet machine.

## Test links
- `?test&objective=totems` forces the solo objective. In co-op, compare `window.game.toys.totems` and `coopPlayState(game)` on host and client right after the start.
- `node node_modules/.tests/coopsync.test.mjs` after `npx rolldown tests/coopsync.test.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/coopsync.test.mjs`, or just `npm test`.
- `npm run coop -- --offline --only turret` runs only the turret scenario (the regular checks still run).

## Risks / not done
- If host and client ever disagree on `coopOn` (team size of 2 or more, not PvP or Versus), a client would show a predicted co-op objective that the host's snapshot never corrects: the snapshot omits `o` when the host has none. Both sides count the same heroes when the stage loads (a client always counts itself and the host), so I found no way to get there. Reverting to the solo objective would need a separate objective rebuild in Interactives, which I didn't add.
- Trials force a co-op objective on the host only. Their clients still show a predicted (or no) objective for one snapshot, as before this lane.
- The turret fix changes only the test. Game behaviour is unchanged: a turret still waits for the level-up to close.
