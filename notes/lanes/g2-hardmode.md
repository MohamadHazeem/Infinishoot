# Gate 2 difficulty and recovery

## What players get

Normal now plays at the previous Hard enemy and score multipliers. Assist is an explicit choice in solo setup and the host's co-op lobby. Easy still gives newer players a gentler setting than Assist. The existing Easy and Normal save and board IDs carry forward, including the daily and weekly use of Normal.

| Setting | Enemy HP | Damage | Enemy count | Score |
| --- | ---: | ---: | ---: | ---: |
| Easy | 0.70 | 0.60 | 0.80 | 0.60 |
| Assist | 1.00 | 1.00 | 1.00 | 1.00 |
| Normal | 1.40 | 1.30 | 1.15 | 1.50 |
| Hard | 2.00 | 1.60 | 1.30 | 2.20 |
| Nightmare | 2.86 | 1.97 | 1.47 | 3.23 |
| Legend, two players | 3.71 | 2.34 | 1.64 | 4.40 |

Hard takes the former Nightmare row. Nightmare extends the former Hard-to-Nightmare ratio separately for each stat, rounded to two decimals. The same ratios lift Legend's actual co-op table so it stays above Nightmare at every team size. Legend's three-player HP/damage/count are 3.57/2.46/1.58 and its four-to-eight-player values are 3.43/2.58/1.53. Existing unlock conditions apply.

- Normal through Legend give one five-second rewind per run. Co-op shares that charge and still requires agreement from all standing players. Starting another run refreshes it. A stage change or a clock correction cannot refresh it. The rewind meter on a promoted host keeps the charge from its most recent time snapshot.
- Normal and higher disable last stand, automatic comeback damage and the free level-up heal. A hit can take up to 50% of max HP through the usual armor, curse and i-frame pipeline. Easy and Assist retain the 35% cap, 10 HP per level, stage rewind, last stand and comeback.
- Frost Totem and Phoenix Plume share one lethal-hit rescue **per hero per run** on Normal and higher. Buying the Plume again, copying it with Echo or acquiring the Totem later uses the same charge. The existing co-op migration checkpoint already stores that hero flag. The host remembers an expenditure by stable player ID across a stashed build returning on a new seat. Easy and Assist retain the two items' independent stage charges. Both item descriptions and the rewind and last-stand tips explain the distinction.
- The existing HEAL button buys 40% max life once per shop visit on all difficulties. It costs 3 gold on stage 1 plus 1 for each subsequent stage. The host computes both the displayed price and the debit. A full or already-healed hero spends nothing. Ordinary enemy heart chance goes from 0.004 to 0.002 on Normal and higher, before the existing horde and team scaling. Stage-clear recovery, paid healing, seasonal/event rewards and revive mechanics retain their existing values.

## Files and integration

- Difficulty tables live in `src/data/modes.ts` and the live Legend team-size rows in `src/game/trading.ts`. Shared `src/game/settings.ts` normalizes the persisted difficulty with the same table.
- Shared `src/game/game.ts` binds the existing kill, hit and XP methods to the executing game's difficulty and resets the time system at run start. The three synchronous actions scope the legacy numeric tuning reads, restoring the previous difficulty in a finally block even for nested callbacks. `src/game/player.ts` supplies the hit cap. `src/game/timeRules.ts`, `src/game/systems/time.ts` and `src/game/systems/gameplay.ts` contain the time and comeback changes.
- The actual shop purchase and shop-view code is in shared `src/game/hero.ts`. Its additions cover the price, permanent Phoenix charge and the Plume's existing Mod state hooks. `src/game/systems/spice.ts` supplies the shared item descriptions and respects the charge on Endless wave transitions.
- Shared `src/ui/screens.ts` resolves both pickers' default by the Normal ID. Both already enumerate the difficulty table. Shared catalogs `src/i18n/menus.ts` and `src/i18n/tips2.ts` contain the English and Arabic wording. The normal start, drop-in and migration messages already carry the host's difficulty ID. Shop views and the time/comeback snapshots already carry what clients display.
- `tests/g2hardmode.test.ts` covers all six difficulties, old stored Easy settings, invalid IDs, real hit/XP/drop/rewind/Mod/shop paths, the client start message and rewind snapshot. `tests/visual/balance.json` contains the refreshed four-kit measurements.

## Verification and handoff

- Typecheck, Vite production build, dedicated Gate 2 unit test and whole-game smoke pass. The invincible bot still clears stages. The smoke test's mortal run also reached game over and recorded the death.
- The shell launchers for screenshots, offline co-op and balance stop before game startup because macOS denies Chromium's Mach port registration in this sandbox. The managed headless Playwright browser ran the production preview for visual checks and the Vite dev build for the existing co-op scenarios and balance simulation.
- The full offline co-op scenario script passed with its browser-launch and cleanup plumbing adapted for two isolated managed-browser contexts. This included invite, ready-up, gameplay, stage transitions, reconnect, party restart and host/client comparisons.
- Two stage-2 kill counts exceeded the old balance tolerance. Buster/Charge/Bomb went from 11,738 to 15,414 kills and Rail/Shield/Storm from 12,005 to 15,298. All four kits cleared both stages and their measurements reproduced on a second browser run. The tolerance stays 25%. This is the existing invincible-bot regression check. Human win rates and the mortal skilled-bot target still need measurement across the integrated lanes.
- The optional Worker and telemetry schemas enumerate difficulty IDs independently. Direct-code co-op works with Assist. Assist needs adding to the public lobby directory, ranked board and telemetry allowlists before those services can accept it. The relevant owners are `server/leaderboard/lobbies.js`, `server/leaderboard/worker.js`, `src/net/telemetrySchema.ts` and `src/net/telemetryReport.ts`. The Worker imports the same telemetry schema as the game. No backend files or deployed services were changed.

## Visual QA

The 12 screenshots in `shots/g2-hardmode-{solo,lobby,shop}-{en,ar}-{720,1080}.png` were inspected at 1280×720 and 1920×1080. Both difficulty rows fit. The shop showed the Phoenix description, its 12-gold price and the 6-gold stage-4 HEAL action, including in RTL. Append `&lang=ar` to these links for Arabic.

- `?test&screen=modes&difficulty=assist`
- `?test&lobby`
- `?test&stage=4&shop&modoffers=phoenix&relic=r_phoenix&gold=12&seed=42`
- `?test&difficulty=assist&standgo=2` and `?test&difficulty=normal&standgo=2` exercise the same killing blow under the two rules.
