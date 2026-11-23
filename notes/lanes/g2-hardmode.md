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

- Normal through Legend give one five-second rewind per run. Co-op shares that charge and still requires agreement from all standing players. Starting another run refreshes it. A stage change or a clock correction cannot refresh it. The host spends the charge when playback starts. Its very first playback snapshot marks the charge spent, including if the host changes during playback. A backwards clock correction clears invalid history. A fresh start also clears the client meter, vote, stand and pending time effects.
- Normal and higher disable last stand, automatic comeback damage and the free level-up heal. A hit can take up to 50% of max HP through the usual armor, curse and i-frame pipeline. Easy and Assist retain the 35% cap, 10 HP per level, stage rewind, last stand and comeback.
- Frost Totem and Phoenix Plume share one lethal-hit rescue **per hero per run** on Normal and higher. Buying the Plume again, copying it with Echo or acquiring the Totem later uses the same charge. The existing co-op migration checkpoint already stores that hero flag. The host remembers a spent charge by stable player ID across a stashed build returning on a new seat. A promoted host reads that ID from the migration checkpoint while its roster is being rebuilt. Older guests without an ID retain the existing name-based reconnect behavior during autopilot. Easy and Assist retain the two items' independent stage charges. Both item descriptions and the rewind and last-stand tips explain the distinction.
- The existing HEAL button buys 40% max life once per shop visit on all difficulties. It costs 3 gold on stage 1 plus 1 for each subsequent stage. The host computes both the displayed price and the debit. A full or already-healed hero spends nothing. Ordinary enemy heart chance goes from 0.004 to 0.002 on Normal and higher, before the existing horde and team scaling. Stage-clear recovery, paid healing, seasonal/event rewards and revive mechanics retain their existing values.

## Files and integration

- Difficulty tables live in `src/data/modes.ts` and the live Legend team-size rows in `src/game/trading.ts`. Shared `src/game/settings.ts` normalizes the persisted difficulty with the same table.
- Shared `src/game/game.ts` binds the existing kill, hit and XP methods to the executing game's difficulty and resets the time system at run start. The three synchronous actions scope the legacy numeric tuning reads, restoring the previous difficulty in a finally block even for nested callbacks. `src/game/player.ts` supplies the hit cap. `src/game/timeRules.ts`, `src/game/systems/time.ts` and `src/game/systems/gameplay.ts` contain the time and comeback changes.
- The actual shop purchase and shop-view code is in shared `src/game/hero.ts`. Its additions cover the price, permanent Phoenix charge and the Plume's existing Mod state hooks. `src/game/systems/spice.ts` supplies the shared item descriptions and respects the charge on Endless wave transitions.
- Shared `src/ui/screens.ts` resolves both pickers' default by the Normal ID. Both already enumerate the difficulty table. Shared catalogs `src/i18n/menus.ts` and `src/i18n/tips2.ts` contain the English and Arabic wording. The normal start, drop-in and migration messages already carry the host's difficulty ID. Shop views and the time/comeback snapshots already carry what clients display.
- `tests/g2hardmode.test.ts` covers all six difficulties, old stored Easy settings, invalid IDs, real hit/XP/drop/rewind/Mod/shop paths, the client start message and rewind snapshot. `tests/visual/balance.json` contains the refreshed four-kit measurements.

## Verification on 2026-11-23

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npx vite build` | Pass |
| `npm test` | **Fail**. 119 of 129 test files passed, including strict i18n and `g2hardmode.test.ts`. |
| `npm run smoke` | Pass. The invincible bot reached stage 3 on Normal. King Bopper ended the mortal Nightmare run and the game recorded the death. |
| `npm run balance` | Shell launcher failed before game startup. The same four kits, fixed seed, clock and assertions passed with managed headless Chromium. All 32 stage measurements match the WIP baseline exactly. |
| `npm run coop -- --offline` | Shell launcher failed before game startup. The full offline scenario passed in two isolated managed Chromium contexts, including ready-up, stage transition, host/client comparisons, reconnect and party restart. |
| `npm run shot` | Shell launcher failed before game startup. Managed headless Playwright captured and checked the production preview in both languages and resolutions. |

macOS denied the local Chromium shell's Mach port registration. The managed browser used this worktree's Vite server for the gameplay checks and its built preview for screenshots. The co-op check used the script's low graphics option and longer page timeout for the shared machine.

The WIP refreshed `tests/visual/balance.json` because two stage-2 kill counts exceeded the old tolerance. Buster/Charge/Bomb went from 11,738 to 15,414 and Rail/Shield/Storm from 12,005 to 15,298. All four kits cleared both stages. The tolerance remains 25%. Human clear rates, fairness feedback and skilled-bot clear rates require the integrated Gate 2 build.

### Unit fixtures for integration

The lane owns `tests/g2hardmode.test.ts`. The following failures are in other owners' fixtures.

| Failing fixture(s) | Observed failure and expected adjustment |
| --- | --- |
| `balance3` | Expects at least 65% HP after a capped Normal hit. Exercise that original case on Assist, or assert the 50% Normal cap. |
| `gameplay`, `gameplayCoop` | Expect comeback damage on Normal. Assist exercises the host and mirrored comeback behavior. |
| `time`, `timeCoop` | Expect stage rewind replenishment or last stand on Normal. Assist exercises the original recovery scenarios. The lane tests cover both policies. |
| `menus` | Expects the default run summary to end in “Medium”. The current label is “Normal”. |
| `meta`, `ultboss` | Heat crowd and Architect HP assertions use the former 1.0 base. Apply the selected difficulty multiplier to those assertions, or pin Assist for a 1.0 control. |
| `raid` | The mortal autopilot won in 795.45 simulated seconds, then in 800.73 on retry. The fixture asks for the old Medium 480–720 s target. Use Assist for that benchmark. |
| `worldEventsGame` | The collapse assertion failed on retry. A diagnostic run recorded one environmental kill. The stored enemy reference originally had UID 11 and had already been recycled as swarmer UID 22 at assertion time. Track the original UID across the fall. |

### Service compatibility

Direct-code co-op carries Assist through the host start message. The optional Worker rejects `assist` in public lobby registration/filtering and global score boards. The telemetry validator rejects Assist runs, and report sanitization substitutes Normal in shared replay headers. The allowlists are in `server/leaderboard/lobbies.js`, `server/leaderboard/worker.js`, `src/net/telemetrySchema.ts` and `src/net/telemetryReport.ts`, outside this lane. Existing `easy` and `normal` IDs keep their boards and stored settings.

## Visual QA

Inspected 16 captures in `shots/g2-hardmode-{solo,normal,lobby,shop}-{en,ar}-{720,1080}.png`. Solo setup highlights Assist and Normal on separate captures. The co-op picker fits all six buttons, including the locked difficulties. Both languages show the stage-4 shop with a 12-gold Phoenix Plume and a six-gold heal. Purchasing the heal with 12 gold leaves six and makes the Plume unaffordable. At 720p the raised, focused Mod card can overlap the lower edge of the first-shop help banner by eight pixels. The prices and purchase controls remain readable.

Append `&lang=ar` for Arabic. For the shop capture, allow the injury timer to tick, toggle the offer lock twice to refresh the view, then focus HEAL.

- `?test&screen=modes&difficulty=assist`
- `?test&screen=modes&difficulty=normal`
- `?test&lobby`
- `?test&stage=4&shop&modoffers=phoenix&relic=r_phoenix&gold=12&seed=42&hurt=0.5`
- `?test&difficulty=assist&standgo=2` and `?test&difficulty=normal&standgo=2` exercise the same killing blow under the two rules.
