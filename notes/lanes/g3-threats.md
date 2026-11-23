# Gate 3 spatial threats

On Normal and the other run difficulties, shooters trade one round of an existing volley for a shot with a recognizable silhouette. An elite or mini-boss can lay down a temporary danger zone during its existing windup. Health and director multipliers stay at their Gate 2 values.

| First stage | Source | Tell and response |
| --- | --- | --- |
| 1 | Blaster Bot | An hourglass hangs for 0.8 s, harmless, with its heading locked. Step across its line. |
| 2 | Elite or mini | A broken perimeter marks a 2 m pool for 1.2 s. The solid pool lasts 3.2 s and checks damage every 0.8 s. |
| 3 | Burst Bot | A hollow square banks off one solid wall or boundary. Give its reflected line room. |
| 4 | Elite or mini | A cross and circular fuse mark the full 2.35 m mine radius for 1.6 s before a 0.28 s detonation. |
| 5 | Spin Bot | A crescent turns at 0.85 radians/s. Cut across the inside of the curve. |
| 6 | Elite or mini | A split laser warns for 1.4 s. Its two rails frame a 3.3 m opening. The 13 m wall sweeps 6 m in 3 s. |
| 7 | Blaster Bot | A fork divides after 0.85 s into two ordinary rounds at ±0.48 radians, 6.5 m/s and 70% parent damage. The middle opens. |
| 8 | Elite or mini | The 6.3 m ring warns for 1.4 s, then closes to 1.26 m over 2.6 s. Its 60° opening stays on the same bearing. |
| 9 | Sniper Bot | A chevron brakes after 0.85 s and reverses over 0.6 s. The return pass follows the locked heading. |

Later stages retain the latest pattern for each source. Each shooter can replace one round every 2.5 s, after its existing windup, with a 4 m minimum distance from every living hero. Patterned rounds last 3.2 s and cap at 11 m/s. Forks consume pooled capacity and can be parried or erased like other bullets. Split children retain the firing enemy's damage-recap identity.

The team shares a 6 s zone cooldown and two slots. A caster must be within 14 m of a living target, with a clear 3.4 m escape segment for the target's collision radius. A zone takes a snapshot of the target's position and plays the existing spatial mortar warning. It never tracks the hero after that. Zone damage is 8 × caster damage multiplier through the normal hit pipeline. Each non-pool zone can hit each hero once. The source name in the recap uses the existing localized enemy name.

## Rendering and co-op

Five projectile silhouettes share one instanced draw. All four floor markings share a second draw. Both upload live slots, draw above friendly effects with ink outlines, and use the client's own accessibility settings. Stationary fuses burn down geometrically. Reduced flashing disables the enemy pulse. High contrast brightens the core, and the existing final-composite colour-vision filters still apply. No new UI or catalog strings.

The host simulates nonlinear flight, solid-wall reflection, forks and hits. Full and delta bullet records both carry shape in the existing three bits. The delta encoder predicts the hold interval and sends a fresh appearance on an in-place parry or reflection. Player/mech/relic kind IDs keep their original indices. Zones ride the existing boss-field snapshot, including position, orientation and age for a late join. Clients advance the visuals between snapshots. World clear clears the slots. As with the existing transient boss fields, the zone lifetime is scoped to the current arena.

## Bot measurement

**Dev bot, to re-measure with the skilled bot.** This worktree has neither `src/dev/skillBot.ts` nor the `skillbot` npm script. `src/game/enemyBulletMeasure.ts` exports `measureThreatDamage(game, runSeconds, seconds)`. Pass a runner bound to the same live game. It observes actual HP lost inside `hurtHero`, attributing it to the current stage, and restores the original hook afterward. `dodgeThreats(game, movement)` is the shared movement hook for the incoming runner. The existing Autopilot calls it for both mortal and god dev runs. It evaluates the current heading and eight alternatives at 0.18, 0.36 and 0.54 s and skips routes blocked by terrain.

Reproduce with `THREAT_MEASURE=1 npm test -- g3threats`. Both samples use seeds 42, 128 and 305, new Normal, Rookie and the default kit. Stage 1 starts a normal run with a budget of 1,600 bot seconds. Stages 2–4 also have independent fresh-build starts with 120 bot seconds, so an early death cannot erase the later-stage observations. The numbers are cumulative HP lost until death or cutoff, including HP subsequently healed. A short-lived run can take less total damage. Fresh-build stage starts measure exposure. The reusable measurement also records any later-loop stage a runner reaches.

## QA links

- `?test&god&seed=42&stage=2&threats=pool&threathold&lang=en&nocine`
- `?test&god&seed=42&stage=2&threats=mine&threathold&lang=ar&nocine`
- `?test&god&seed=42&stage=2&threats=wall&threathold&lang=ar&nocine`
- `?test&god&seed=42&stage=2&threats=ring&threathold&lang=en&nocine`

Remove `threathold` to play the patterns. Production-preview screenshots inspected through headless Playwright MCP are under `shots/g3-threats-{pool-en,mine-ar,wall-ar,ring-en}.png`. Pool/mine are 1280×720, wall/ring are 1920×1080. The local shell's standalone Chrome launch for `npm run shot` was denied macOS Mach-port registration.

## Files

- Pattern rules, glyphs, steering and simulation in `src/data/patterns.ts`, `src/game/enemyBullets.ts`, `enemyBulletView.ts`, `enemyBulletDodge.ts`, `enemyBulletMeasure.ts` and `denial.ts`.
- Shooter pattern fields in `src/data/enemies.ts`. Projectile pool, collision, parent-shot credit and snapshot handling in `src/game/bullets.ts`, `src/game/systems/statuses.ts`, `src/game/damageLog.ts`, `src/game/bossField.ts` and `src/net/bulletCodec.ts`.
- Shared integration in `src/game/game.ts` adds kind registration, accessibility references and shot, windup and authoritative zone-update hooks. `src/game/autopilot.ts` adds a movement hook. `src/dev/testLinks.ts` adds the QA link dispatch.
- `tests/g3threats.test.ts` and this handoff. The pre-existing change to `.lane-brief.md` belongs to the worktree setup.

## Damage observations

Entries are HP lost for seeds **42 / 128 / 305** in that order. Full runs start on stage 1. The other rows start the bot directly on the named stage with the default build.

| Starting stage | Before | After | Median before → after |
| --- | --- | --- | --- |
| 1, damage on stage 1 | 142 / 133 / 75 | 193 / 238 / 142 | 133 → 193 |
| 2, fresh build | 71 / 26 / 60 | 66 / 100 / 57 | 60 → 66 |
| 3, fresh build | 209 / 129 / 138 | 170 / 175 / 150 | 138 → 170 |
| 4, fresh build | 135 / 166 / 119 | 307 / 231 / 184 | 135 → 231 |

Full-run damage by reached stage, including later stages with their carried builds:

| Seed | Before | After |
| --- | --- | --- |
| 42 | S1 142; died at 264 s | S1 193; died at 269 s |
| 128 | S1 133; died at 265 s | S1 238; died at 275 s |
| 305 | S1 75, S2 212, S3 109; died at 707 s | S1 142; died at 269 s |

Full-loop clears were 0/3 before and 0/3 after. All three final runs died on stage 1. Median HP lost increased across all four first-loop stages, with the largest change on stage 4 (135 to 231). These small mortal-dev-bot samples cannot establish the Gate 2 skilled-runner target of 40–60%. No global difficulty tuning or balance fixture was changed.

## Browser checks and performance

- The standalone launches for `npm run coop -- --offline`, `npm run balance` and `npm run shot` stopped before game startup at Chromium's macOS Mach-port registration. A managed headless Playwright browser could reach this worktree's local Vite server.
- The offline co-op harness passed in two isolated managed browser contexts on low graphics. The original signaling, WebRTC, host/client, reconnect, party restart and kick assertions ran. The peers reached stage 3 and agreed on all three stage objective layouts. They exchanged 1,902 snapshots, averaging 1,783 bytes. One snapshot crossed the 16,000-byte chunk threshold. Host/client skill-event totals matched.
- The invincible `botRun(s, true)` balance scenario passed all 32 existing stage measurements across the four original kits at seed 4242, within the checked-in 25% tolerance. All reached stage 3 with their requested loadouts. Stage-2 cumulative kills were 14,634 Buster, 13,935 Laser, 14,832 Scatter and 12,913 Rail. The harness' fixed clock, UTC timezone, seeded RNG and isolated pages were preserved.
- A managed-browser 1280×720 LOW stress capture held at least 150 enemies and replenished the pool to 500 shots of mixed patterned kinds before each update. A closing ring also ran. Across 220 warmed samples, median simulation plus render preparation was 0.70 ms and p95 was 1.30 ms. GL submission sampled every 15th step peaked at 89.3 ms on the shared headless machine. This is CPU timing, and does not certify sustained on-device frame rate.
- Final visual captures show the pool tell, a partially burned mine fuse, the active ring and the sweeping wall mid-crossing. The Arabic 1080p wall capture uses local high contrast and reduced flashing. The five shot shapes remain distinguishable in white.
- An initial eager creation of the two render pools shifted the pre-run random stream through Three's UUID generator and failed the existing co-op bomb-placement fixture. That fixture passed when bundled against untouched HEAD. Allocating on first draw fixed it. The same fixture and the lane regression test both passed after the fix.

## Final verification

- `npm run typecheck` and `npx vite build` passed. Vite reported the existing large-chunk warning.
- `npm run smoke` passed across modes, heroes and co-op checks with no runtime errors. The mortal Nightmare run reached game over from King Bopper's shockwave.
- `npm test` passed 121 of 131 files. The ten failures persisted on the runner's isolated retries and match the list documented in [the Gate 2 handoff](g2-hardmode.md). They are `balance3`, `gameplay`, `gameplayCoop`, `menus`, `meta`, `raid`, `time`, `timeCoop`, `ultboss` and `worldEventsGame`. The lane test, co-op bomb fixture and strict i18n passed. The focused lane test also passed after extending the measurement callback to record later-loop damage.
- The 40–60% skilled Normal loop-clear target and sustained 60 fps on player hardware remain unverified. The stage 4 dev-bot damage increase warrants a repeat with the incoming skilled runner.
