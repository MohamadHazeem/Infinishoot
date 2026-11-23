# Gate 2 integration

Assist hosts can register a public lobby and players can find it with the difficulty filter. Assist runs have their own global score boards. Opt-in telemetry, the downloadable report replay header, and its saved control settings all preserve the `assist` ID. The shop's first-visit hint clears the focused Phoenix Plume in English and Arabic.

## Decisions and coverage

- Worker tests register Easy, Assist and Normal lobbies and post distinct scores into the same in-memory KV. Each filter returns its own room and each board returns its own score. The telemetry test posts Assist through the Worker into SQLite and reads it back from the summary. It also decompresses the packaged report and checks both difficulty fields.
- The solo and co-op recovery fixtures select Assist for comeback damage, stage rewind replenishment and last stand. Normal still exercises the exact 50% hit cap and i-frames, Heat's 1.25× crowd multiplier relative to the unheated run, and the difficulty-scaled health of the two- and eight-hero Architect. The default menu summary names Normal.
- Assist supplies the historical 1.0× control for the two pacing benchmarks. The mortal raid pilot cleared in 598.8 and 599.5 simulated seconds across the two suites (target 480–720). The fixed level-40 god bot cleared the 450,000-HP reference Architect in 186.3 seconds (target 120–240).
- The collapse fixture saves the chonk's UID before the floor falls. It checks that the UID has left the active pool and the environmental-kill count has increased, even if the director has reused the slot.
- The shop reserves six UI pixels above offers while the help strip is visible on desktop. Compact layouts use the shared one-UI-pixel focus lift and recover space from the owned-Mod heading margins. At 1280×720 the card's top went from 7.5 CSS pixels inside the banner to 19.5 pixels below it. At 1920×1080 the gap is 28 pixels. Both leave room for the painted frames. The five-Mod layout also fits 720p in both languages.

## Files

- Services and UI: `server/leaderboard/lobbies.js`, `server/leaderboard/worker.js`, `src/net/telemetrySchema.ts`, `src/net/telemetryReport.ts`, `src/ui/shopUi.ts` (additive CSS).
- Service tests: `tests/g2-integrate.test.ts`, `tests/telemetry.test.ts`.
- Game fixtures in `tests/`: `balance3.test.ts`, `gameplay.test.ts`, `gameplayCoop.test.ts`, `time.test.ts`, `timeCoop.test.ts`, `menus.test.ts`, `meta.test.ts`, `ultboss.test.ts`, `raid.test.ts`, `worldEventsGame.test.ts`.
- This handoff is the lane's decision log. All production changes are in the five modules listed above.

## Verification and test links

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npx vite build` | Pass |
| `npm test` | Pass, all 130 files on both full runs. The first passed directly. On the second, the sound-AI movement check in `sound2Game.test.ts` passed on the runner’s isolated retry. |
| `npm run smoke` | Pass. The god bot reached stage 3 on Normal. The mortal Nightmare run recorded a death from King Bopper's shockwave. |
| `npm run coop -- --offline` | Local Chromium launcher failed before game startup. The offline harness passed using managed headless Playwright, with the low graphics option and a 120-second page timeout. Host and client matched stage objectives on both stages, reconnected with the same build, and completed the party restart and return to lobby. |
| `npm run balance` | Same launcher failure. All four kits cleared two stages in managed Chromium with the harness's fixed clock and seed. All 32 stage measurements exactly matched the checked-in baseline. |
| `npm run shot` | Same launcher failure. Captured and inspected the production preview in managed Chromium at 1280×720 and 1920×1080 in English and Arabic. |

macOS denied the shell-launched Chromium process permission to register its Mach port. Direct verification of those three npm browser launchers remains outstanding on a machine that permits Chromium startup. Service verification used local storage doubles and in-memory SQLite.

- Focused Mod and help banner: `?test&stage=4&shop&modoffers=phoenix&relic=r_phoenix&gold=12&seed=42&hurt=0.5`. Append `&lang=ar` for Arabic. The four captures are `shots/g2-integrate-shop.png`, `shots/g2-integrate-shop-ar.png`, `shots/g2-integrate-shop-1080.png` and `shots/g2-integrate-shop-ar-1080.png`.
- Crowded 720p shop: `?test&seed=3&stage=2&gold=60&weapons=drones:3,missiles:2&mods=hoarder:2,momentum,echo,kindling,glass_cannon&relics=r_backbeat,r_anchor,r_mercy&shop`. The scroll height was 720 pixels in both languages.
