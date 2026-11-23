# Gate 2 closeout

## Opening King and duel

Stage-one King Bopper's phase-two and phase-three slam volleys now release one shockwave on the final landing. A gold warning contracts to the starting radius of the wave over 0.4 seconds. It uses the existing protected telegraph layer and effects bus. The old phase-three sequence fired six rings over three landings, with only 0.45 seconds between paired rings. The base dash recharges in 0.7–1.6 seconds depending on level. The new wave still expands at 9 m/s, reaches 22 m and deals the same base 16 damage. Later Kings and other bosses retain their patterns.

The death report's `the_ring_of_fire` is the final-phase duel boundary. Flames mark the circumference, the exterior is tinted, and the boss announces that the player must stay inside. The ring waits 1.4 seconds and shrinks over 11 seconds. Its boundary checks every 0.5 seconds. On baseline seed 4, the last five accepted hits came from remaining outside for over four seconds. The skilled pilot evades moving shockwaves but has no explicit steering rule for this boundary.

## Calibration

All Normal cohorts use the same 20 seeds, the default mortal Rookie, starter loadout, 60 Hz simulation and unchanged pilot. Each stage percentage uses all starts. The archived merged-branch cohort is the control. The runner writes to a temporary report directory to preserve the November 23 historical report in the repository.

| Normal cohort | HP / damage / count | Stage 1 | Stage 2 | Stage 3 | Loop |
| --- | --- | ---: | ---: | ---: | ---: |
| Merged branch | 1.40 / 1.30 / 1.15 | 75% | 55% | 55% | 30% |
| Opening King change alone | 1.40 / 1.30 / 1.15 | 95% | 65% | 60% | 15% |
| Lower damage | 1.40 / 1.10 / 1.15 | 80% | 50% | 50% | 35% |
| Lower health and damage | 1.20 / 1.10 / 1.15 | 75% | 65% | 65% | 35% |
| Base damage | 1.40 / 1.00 / 1.15 | 95% | 55% | 55% | 25% |
| Lighter horde | 1.15 / 1.05 / 1.10 | 95% | 80% | 80% | 30% |
| **Final, with surplus-based late crowd bonus** | **1.15 / 1.05 / 1.10** | **95%** | **80%** | **70%** | **50%** |

Baseline deaths were led by `king_shockwave` ×3, `the_ring_of_fire` ×3, `shooter` ×2, `slug` ×2 and `burster` ×1. Reducing enemy multipliers did not reliably increase loop clears on its own. The lighter horde let 16 players reach stage four, where ten then died.

In stages three and later, the old cruising rule requested an extra 18% crowd as soon as the power score reached 0.65, even if the field was already over capacity. The late Normal+ cruising bonus now scales continuously with the existing surplus, which accounts for the 45-second score, team life and space on the field. A score below the threshold or occupancy at 150% of target earns zero extra bodies. A healthy team clearing a sparse field can still reach the full 1.27× ceiling. Assist retains its historical cruising rule.

The final ten clears came on seeds 2, 3, 10, 11, 12, 13, 15, 16, 18 and 20. Rex, slugs and the Colossus accounted for two deaths each. Burning ground, Golden King's shockwave, the opening King's shockwave and lava accounted for one each. No Normal sample timed out. The ring of fire fell from three final blows to zero. Normal retains the 1.5× score, 50% single-hit cap, one team rewind per run, paid healing and the existing limits on Phoenix, comeback, last stand and level-up healing.

### Difficulty separation

These runs used `npm run skillbot -- --difficulty <id> --runs <count>`. The short cohorts used the same first ten seeds as Normal. Every sample ended in a death or loop clear.

| Difficulty and seeds | Stage 1 | Stage 2 | Stage 3 | Loop |
| --- | ---: | ---: | ---: | ---: |
| Assist 1–10 | 100% | 100% | 90% | 70% (7/10) |
| Normal 1–10, matched subset | 90% | 80% | 70% | 30% (3/10) |
| Hard 1–10 | 20% | 20% | 20% | 10% (1/10) |
| Normal 1–20, exit criterion | 95% | 80% | 70% | 50% (10/20) |

Assist deaths were Golden King ×2 and lava ×1. Hard deaths were led by bursters and the duel boundary at two each. Seed 3 was the sole Hard clear. Single seeds move the twenty-run Normal result by five percentage points.

## Four-player diagnosis

The archived Gate 2 coop4 retry had already lost all three guests at its first four-second simulation checkpoint. By the buy-back, client 1's hero had left. The four reported chest values were all 1 (ordinary) and the King was still fighting after earlier scenario waits overran the boss schedule. Owned boss chests start at 100. The archived migration retry shows Charlie becoming a second host after 15.6 seconds of silence while Bravo was still simulating. The two hosts then levelled and shopped independently. The supplied pre-Gate-2 comparison reproduces the same split before the shop, including a guest wallet of 6 becoming 7.

The reconnect probe now lets its first pending WebRTC handshake finish within the transport's existing 12-second deadline. A host goodbye still initiates the election immediately. Failed reconnect and split-recovery connections are closed, and callbacks from superseded attempts cannot install a stale connection or delay the active attempt.

A promoted host restores a shop checkpoint's wallet, life, offers and HEAL flag together. A combat snapshot already on the screen can predate the purchase. Wallet and HEAL changes now contribute to the shop checkpoint fingerprint. The shared hero build also preserves the amount actually paid for each Mod, including upgrades, so its sell value survives. Older builds without that field retain their historical zero paid amount.

The migration harness now funds one guest purchase, verifies the debit, sell receipt and sold offer on the authoritative host, then compares the builds across the handoff. Previously `buy` was reported as successful even when the host had rejected it. The focused unit test covers paid healing with a deliberately stale display snapshot, a Mod receipt, one starter dash through the King wave, later King pairs and a slow first reconnect.

## Files and reproduction

- `src/data/modes.ts`, `src/game/director.ts` and `tests/g2hardmode.test.ts` contain the Normal table, crowd tuning and matching table assertion.
- `src/game/bosses.ts` and `src/game/systems/bossFight.ts` contain the opening King's warning and volley.
- `src/game/systems/hostmig.ts`, `src/game/systems/netcode.ts` and `src/game/pvp.ts` contain the election, reconnect cleanup, shop restoration and Mod receipt fixes.
- `scripts/migrate-test.mjs` checks the purchase through the guest UI. `tests/g2-close.test.ts` covers the new behavior. This handoff is the only documentation change. There are no edits to the listed shared files, new player-facing strings or save-format changes.
- To see the opening King, use `?test&stage=1&bossnow&duel&nointro&bench&god&day&season=off&seed=42&lang=en`. Use `&lang=ar` in place of `&lang=en` for Arabic. The warning and wave share the authoritative boss position.

## Release checks

- `npm run typecheck`, `npx vite build` and `npm run smoke` passed. `npm test` passed all 135 files. The existing in-process host migration fixture passed on the runner's isolated retry after attempting to create a real PeerJS connection under parallel load.
- `npm run balance` passed. The invincible pilot carried all four standard kits through two stages within the existing 25% tolerance.
- `npm run coop -- --offline` passed, including down/revive and reconnect. `npm run coop4` passed with public signaling. A down and buy-back appeared on both machines (pool 3 → 2), all three guests registered the team ultimate, and zero owned chests remained after the King. The host ran 60 updates/s, p95 2.2 ms, with at most 0.1 s guest snapshot lag.
- `npm run migrate -- --runs 2` passed twice consecutively. Each run lost a host in combat and a second host in the shop. The guest bought a six-gold Mod in both runs. Remaining wallets of 2 and 7, respectively, survived alongside builds and offers. Each surviving team reached stage two together.
- Four `npm run shot` images were captured and inspected using managed headless Chromium. At 1280×720 the solid gold tell is visible around the landing, inside the flame-lined duel boundary. At 1920×1080 the expanding wave has a segmented bright edge. The “stay inside” instruction is readable in English and Arabic at both sizes. Captures are under `shots/g2-close-king-{en,ar}-{720,1080}.png`. The captures pause a live attack to show both phases. The repository's browser scripts used the same managed Chromium because a standalone browser launch was denied the macOS graphics bootstrap port in this sandbox. Visual baselines were left alone.

The isolated control used an archive of `6b41aae`, the first Gate 2 merge's first parent, and the same headless browser. Its original `npm run coop4` and one original `npm run migrate -- --runs 1` both passed. The archived migration control on that same parent had a split host. Together these runs show why load alone cannot establish a Gate 2 rules regression. The controlled stale-shop unit fixture and the new receipt check exercise the two state-loss bugs independently of transport timing. The original migration control used fallback fonts because the temporary checkout symlinked its font dependency.


## Remaining release evidence

The automated Normal loop target is met. The roadmap also calls for fewer than 30% of first-time Normal runs to clear stage four and at least 80% of feedback to rate deaths fair. Both require human playtests on this build. Seeded bot runs and the four visual captures cannot measure these outcomes. The isolated network checks exercised four local headless players with simulated latency and loss, including both host departures. Real-world network reachability depends on the connection between peers.
