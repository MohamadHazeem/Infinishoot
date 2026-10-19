# Meta lane — 2026-10-19

## Player-facing changes / decisions

- MODE → HEAT: nine optional handicaps, also accessible by the co-op host from the lobby. The host's selection applies to everyone and travels in the start message and every snapshot. Daily, weekly and PvP ignore saved heat. HUD, game-over summary and history show heat; best heat for a loop clear is saved per standard/endless/bossrush mode (including immediately on victory).
- WEEKLY: UTC ISO week-year seed, two distinct rules drawn deterministically from five. Rules: double enemy speed, no primary weapon, all normal director spawns elite, lethal unblocked hits, double enemy bullet speed. Week boundary is Monday 00:00 UTC; New Year ISO boundaries are tested. Each entrant starts as Rookie with Buster/Charge/Bomb, no pet and the same auto-weapon pool, independent of profile unlocks. Local best per week is retained for 52 weeks; weekly results do not enter the normal local score board.
- EXTRAS → SOUVENIRS: two armour colour sets, three HUD accent themes and two free starting-kit unlocks. Bolts only buy cosmetics; there are no new permanent stat upgrades. Kits reuse existing weapons/specials and become normal LOADOUT options. Armour ids work in co-op, including on machines that do not own them.
- ENEMY GUIDE → CODEX & LORE: 49 entries spanning enemies, bosses, four islands and four heroes. Encounters/kills, visits and hero selection discover lore. Keyboard/gamepad focus scrolls entries into view. Old bestiary discoveries migrate.
- Save version 4 adds `meta`; old achievements, lifetime stats and history survive. Legacy v1 Workshop/Bolts do not become combat bonuses or cosmetic currency. Export/import round trips meta progress. Run banking is idempotent. Quitting a solo run now also records its history and earned cosmetic Bolts.

## Tuning

| Heat | Points | Effect |
|---|---:|---|
| Hot Wheels | 1 | Enemy movement ×1.25 |
| Heavy Metal | 2 | Enemy HP ×1.35 |
| Hard Knocks | 1 | Enemy damage multiplier ×1.25 |
| Full House | 2 | Director count ×1.25 |
| Fast Forward | 2 | Enemy shot speed ×1.35 |
| No Snacks | 2 | No heart drops; stray hearts cannot heal |
| Lost Cargo | 1 | Map chest cadence 60 s instead of 30 s |
| Inflation | 1 | Shop Mod purchase/upgrade prices ×1.5 (not heals/rerolls) |
| Heavy Boots | 2 | Dash cooldown ×1.5 |

Maximum 14 heat. Score/rewards multiply by `1 + heat × 0.1`, up to ×2.4. Base Bolts = floor(kills / 25) + 10 per defeated stage boss; final reward is floored after multiplication. No change to in-run gold rewards. Score stays raw internally and is multiplied exactly once for HUD/results.

Mint HUD: any achievement + 30 Bolts. Sunset HUD and Relay Gold armour: clear a loop at 4+ heat, then 60 / 80 Bolts. Weekly HUD and Signal Runner armour: 5,000 weekly score, then 60 / 80 Bolts. Free kits use those same heat/weekly conditions: Scatter/Grenade/Storm and Laser/Well/Meteor. A clear means defeating the final boss at stage 4 (or another full loop), not merely finishing one stage. One Hit Wonder retains normal shields/i-frames/revives, but bypasses the normal hit cap and Phoenix save.

## Files

New: `src/data/{heat,weekly,codex}.ts`, `src/game/systems/meta.ts`, `src/ui/metaScreens.ts`, `tests/meta.test.ts`.

Owned: `src/data/modes.ts`, `src/game/save.ts`, `src/game/systems/runFlow.ts`.

Small shared hooks: `src/game/game.ts`, `src/game/hero.ts`, systems `netHost.ts`, `netClient.ts`, `render.ts`, `spawning.ts`, `spice.ts`, `statuses.ts`; `src/ui/screens.ts`, `src/ui/hud.ts`, appended scoped rules in `src/style.css`; `src/dev/testLinks.ts`. Binary entity codec is unchanged: metadata uses the existing JSON snapshot envelope. No new dependencies or downloaded assets.

## Test links / visual checks

- `?test&heat=haste,armor,damage,crowds,bullets,hearts,chests,shop,dash` selects the named heat ids before starting (test profile only).
- `?test&metascreen=heat|weekly|codex|rewards` pauses and opens one new screen; use one value, not the literal pipe list.
- Existing `?test&mode=weekly` launches this week's run.
- Looked at `shots/meta-heat.png`, `meta-weekly.png`, `meta-rewards.png`, `meta-codex.png`, and `meta-hud.png`. Fixed heat overflow and weekly/codex inherited grid styles after looking at the images. Screenshots remain untracked.

## Validation / integration risks

- `npm run typecheck`, `npm test`: pass, including 17 test files. `tests/meta.test.ts` covers migration, ISO boundaries, weekly rotation, purchases, valid kits, real Game heat effects, shop costs, hearts/chests, host-to-client snapshots, skin resolution, score/reward banking, fixed weekly starts, primary suppression, elite conversion, lethal hits and screen navigation.
- `npm run bench`: heavy HIGH preset, 275 average enemies / 503 bullets. Simulation 0.25 ms/step, game.render 0.64 ms, CPU at one step/frame 1.47 ms. Previous perf-lane baseline: 0.24 / 0.63 / 1.43 ms. SwiftShader frame rate is GPU-bound, not a hardware FPS claim.
- **Lead integration required for optional online weekly scores:** the client submits/fetches `weekly-YYYY-Www` using the existing optional leaderboard API and safely keeps local scores on failure. `server/leaderboard/worker.js` currently rejects these board ids. That file is outside this lane's ownership, so it is unchanged. Extend its `BOARD_RE` with `|^weekly-\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$` and redeploy the optional worker. Offline weekly play is complete without this service.
- Weekly rules deliberately use existing mechanics; no giant-enemy codec changes, extra boss attacks, cosmetic trails or pet-hat geometry were added. New cosmetics are armour colours and HUD themes. No new intense/noisy effects need another settings toggle.
- Final `npm run smoke`: pass, all existing modes/heroes plus mortal game-over/history flow. The new weekly mode/rules also have real-Game integration coverage in `meta.test.ts`.
- Final clean `npm run coop`: **pass**, 93 s wall time, 1,388 snapshots averaging 5,776 bytes, skill events match, turret ownership/jump pads/boss phases/revive/stage transition all pass. Earlier attempts: one turret timing failure while benchmarking concurrently; another was invalidated by source edits causing Vite reload. Final validation ran with frozen source.
- Also inspected `shots/meta-gameover.png` (`?test&heat=haste,armor&die=1`): heat and earned Bolts fit the existing result grid; retry/title remain visible.
