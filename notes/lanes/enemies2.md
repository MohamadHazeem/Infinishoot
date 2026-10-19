# enemies2 — Burrowers, Mirror Bots, Swarm Queen

## Player-facing changes

- Dirt Diggers tunnel as moving, rumbling dirt mounds. Ordinary targeting, contact damage and bullets ignore them underground; explosions and Nukes still work. They stop at a fixed red ring, erupt, and expose themselves before digging again. Tunnel Bruisers are the large variant; veteran and regular elite modifiers also work.
- Mirror Bots scan the nearest living player's current primary weapon, show its name, lock their aim, then copy its pattern in violet. Supports all five current primaries: Buster fans, Scattergun pellets, Pulse Laser beams, drifting Plasma Orbs with proximity zaps, and Rail Driver beams. Beam damage and drawing stop at cover. Prism Bots copy longer; veterans are tougher. Killing during the copy attack drops an extra 8-gold pickup.
- The Swarm Queen is a special enemy with a compact overhead health bar and a chest reward, not a stage boss. Her screech precedes an arena-spanning wall of stationary swarmers; cut a gap before crossing. She alternates walls with destructible egg clusters. At half life she retreats once, then returns. Killing her never clears the stage.
- Chunky drill-mole, CRT mirror, bright royal insect and egg models; gaits, bestiary tips (including veterans), and positional `burrow`, `mirror_copy`, `swarm_screech` sample cues with synth fallbacks. No new assets or dependencies.

## Tuning and decisions

- Stage 1 stays unchanged. Small diggers start at stage 2, 0:48. Mirrors begin stage 3, 0:24; Tunnel Bruisers at 1:17 and Prisms at 1:46. Later stages inherit the director's existing earlier-introduction curve.
- Digger: 32 base HP, 3.2 s underground, 0.95 s fixed warning, 1.6 m eruption / 12 damage, 2.8 s punish window. Bruiser: 140 HP, 1.15 s warning, 2.3 m / 18 damage, 3.2 s punish window. Elite size scales the ring, but warning time remains generous. Explosive knockback cannot drag an eruption away from its warning.
- Mirrors: 65 / 95 base HP; 1.25 / 1.1 s scan, 2.2 / 3 s copy, 3.2 / 2.8 s cooldown. Last 0.4 s of scan commits aim. Copies read current upgraded weapon parameters; damage is 35%, capped at 12 before enemy stage/elite scaling, shots capped at 9, rate at 4/s, range at 20 m. Copying does not duplicate player Mod triggers. Plasma pulses every 0.5 s, at most 3 m radius and four heroes; normal hero i-frames still apply.
- Queen: 600 base HP with normal director HP scaling. One per stage from stage 2 at 72% of the clock (2:53 on a four-minute stage), deliberately later than the existing 50% mini-boss. 1.4 s warnings, 7 s cooldown between attacks; 3 s retreat at 50% HP followed by 1.2 s return movement. She remains damageable.
- Walls: about 1.5 m spacing, bounded to 81 bodies, hold for 12 s then chase. Walls skip solid cover and stay inside arena bounds. Eggs: three clusters per lay, 24 base HP each, hatch four swarmers once after 6 s; nine clusters maximum. Summons stop at 560 active enemies. Eggs and held wall units do not recycle across the arena.
- Family hot paths reuse enemy fields and instanced pools. Copied orbs reuse the existing bullet pool (host-only kind 250); their pulse visuals use the effects bus. No per-frame vector/array allocations in the new AI.
- Reduced-flash mode makes telegraph pulses steady and suppresses mound rumble/body pulsing. Copied beams/projectiles use white in colorblind mode. Existing SFX voice limits, volume and shake controls apply. No new intense screen flash or camera effect.
- Debug panel: Enemy AI → Burrow / Mirror / Swarm exposes copy damage/cap, Queen timing, egg hatch delay and digger warning.

## Co-op / integration

- Enemy record grows **22 → 28 bytes**, adding separate family-state and copy-pattern bytes (kind + beam-on flag, count, range, arc, width). Existing squad/shield bits are intact; **BOSS_ACTIONS remains eight entries**. Host/client builds must match. Reconcile these six appended bytes with any other codec lane during integration.
- `netClient.ts` applies all new drawing fields. The host alone scans weapons, damages heroes, hatches eggs, lays walls, retreats and awards bonuses. Client geometry uses snapshot state and local cover. Violet and accessibility-white bullet colors are in the codec palette.
- Queen uses the existing elite-bar renderer through `EnemyDef.special`; it does not enter the stage-boss/mini-boss phase machinery or share their actions.

## Files touched

- Core owned files: `src/data/enemies.ts`, `src/data/bestiary.ts`, `src/game/enemies.ts`, `src/game/director.ts`, `src/game/animMath.ts`, `src/game/systems/enemyAi.ts`.
- New brain/helpers: `src/game/systems/enemyFamilies.ts`. Tests: `tests/enemies2.test.ts`.
- Small integration edits: `systems/combat.ts` (target/damage gates), `systems/statuses.ts` (bullet/contact gates and copied-orb callback), `systems/spawning.ts` (Queen announcement and recycle exclusions), `systems/render.ts` (bar and local drawing settings), `systems/netClient.ts`, `src/net/codec.ts`, `src/audio/mix.ts`, `src/audio/sfx.ts`, `src/ui/debugPanel.ts`.
- `src/dev/testLinks.ts`: existing `bench` mode now suppresses chest upgrade cards as well as XP cards. Otherwise Queen/elite chest drops pause stress scenes and invalidate timing. Normal gameplay is unaffected.
- This note. No edits to Game, Hero, HUD, screens, settings, styles, or PLAN.md; the lane decision log is kept here for the integrator.

## Validation

- `npm run typecheck`, `npm test` (17 files, including new mechanic/codec tests), `npm run smoke`: passed.
- `npm run coop`: passed the full two-player scenario, including transition to stage 2, boss phases and down/revive. Final run: 1,349 snapshots, average 5,374 bytes, maximum 22,593; both snapshots above 16 KB passed PeerJS chunking.
- Additional temporary family-focused variant of the co-op harness: all seven new definitions spawned near the client, eight burrow/mirror records checked for exact family and copied-beam fields, two Queens forced through retreat, normal state comparisons continued. Passed; 489 snapshots, average 4,806 bytes, maximum 11,362. The temporary harness lives under ignored `node_modules/.tests`, not in shipped code. An earlier mixed harness hit the unrelated turret-ownership race; the standard full suite and isolated family run above are green.
- Screenshots generated with `npm run shot` and visually inspected: `shots/enemies2-families.png`, `shots/enemies2-burrowers.png`, `shots/enemies2-mirrors.png`, `shots/enemies2-queen-eggs.png` (shows the Queen and swarm wall). Screenshots remain ignored.
- `npm run bench`: production HIGH, 20 s after 4 s warm-up; 272 average enemies / 517 bullets. Simulation 0.28 ms/step, enemy AI 0.112 ms/step, game render 0.70 ms/frame, GL 0.63 ms/frame, CPU at one step/frame 1.61 ms. No page errors.
- Family stress: same production HIGH preset, 20 s after 12 s warm-up, with `hold=140,12:burrower,8:burrower_big,16:mirror,8:mirror_prism,2:swarmqueen,20:swarm_egg,30:swarm_wall&bullets=500`. 301 average / 366 maximum enemies, 498 average / 502 maximum bullets. Simulation 0.26 ms/step, enemy AI 0.107 ms/step, game render 0.64 ms (p95 0.76), GL p95 0.70 ms. No page errors.
- The family run had one **404.62 ms software-WebGL GL-submit outlier**, inflating raw average GL to 2.81 ms and CPU at one step/frame to 3.72 ms. Total CPU p95 was 4.10 ms. This remains a first-use/rendering risk, not a claim of measured 60 fps on hardware. SwiftShader rendered 9.1 fps; simulation stayed at 59.5 steps/s. Hot-loop CPU stayed in the standard scene's range. An earlier family measurement was discarded because chest cards paused combat; the test-link fix above prevents that.
- Benchmark JSON/logs are in `/tmp/enemies2-bench-standard.*` and `/tmp/enemies2-bench-families-warm.*` (uncommitted local artifacts).

## Test links

No new query options are needed; existing `spawn`, `elite`, `loadout`, `hold`, `bench`, `god`, `frozen` and `time` cover these families. Examples:

- `?test&stage=2&god&bench&spawn=burrower:4,burrower_big:2&spawnr=6&day&seed=42`
- `?test&stage=3&god&bench&loadout=laser,charge,bomb&spawn=mirror:2,mirror_prism:2&spawnr=7&day&seed=42` (swap laser for buster/scatter/orb/rail)
- `?test&stage=2&god&bench&spawn=swarmqueen:1,swarm_egg:3&spawnr=6&day&seed=42`
- `?test&stage=3&god&elite=burrower:shielded,mirror:fast`
- `?test&stage=2&god&time=172` (natural Queen arrival shortly afterward)

## Remaining limits

No known gameplay blocker. Copy strength intentionally caps extreme player builds instead of reproducing their Mod chains. Co-op testing used two local browsers, not four players or real packet loss. Audio cues are wired and exercised, but headless validation is not an acoustic listening test. First appearance of an enemy/material can still stall software WebGL; see benchmark figures rather than interpreting SwiftShader's frame rate as hardware performance.
