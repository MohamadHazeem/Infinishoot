# Gate 7 · Overworld campaign

PLAY → CAMPAIGN opens a nine-island pixel chart. In online co-op the host opens CAMPAIGN from the CO-OP lobby after the crew joins. The host can sail again with that crew after each liberation. Each island has an inspectable landmark, a local dispatch and a flag that goes up when the boss falls. Finishing Sky Fortress completes the chart. All liberated ports remain replayable.

## Design decisions · 2026-11-23

- Chart order is Bright Meadow, Sunset Dunes, Frosty Peaks, Neon City, Toy Factory, Candy Kingdom, Sunken Ruins, Magma Isle and Sky Fortress. The nine islands cover the nine base biomes. Seasonal and palette variants share the identity of their home island.
- Bright Meadow takes one stage. On the other islands the coastal route takes two. Surviving the first director timer opens a harbour. Only the last stage summons the island boss. The harbour awards no boss kill, boss chest or clear heal. Native encounter entrances, attack tells and enemy limits apply.
- Freeing the meadow opens the floating market. The dunes open the rest stop. The peaks open the ferry. Choose a passage before departure. On a long crossing, the market spends gold earned on the first leg or the rest stop recovers 20% of maximum life. The ferry takes one stage and bypasses first-leg XP and loot. Liberated facility islands gain buildings and flags. The ferry also adds a gold route to the chart.
- Each departure resets the crew to level 1 with the chosen loadout and the ordinary starting-shop allowance. The campaign retains routes and enemy history. It awards no permanent combat stats. Segment results stay off the Standard scoreboards. The existing telemetry mode field records the underlying Standard rules and actual stage reached.
- The first liberation records how the crew fought. At least eight dashes per present hero per stage sends a fast-elite dispatch to the neighbouring island. Otherwise the dispatch calls for a shielded elite. It replaces the first ordinarily rolled elite modifier per stage, using the existing entrance, visual marker and combat behaviour. The chart announces the response before departure. Replays preserve the first dispatch.
- The Gate 4 hunt system records the first outstanding attributed killer for each island. Retries retain its identity, name, trait and visit count. An environmental death with no attributed foe creates no rival. A defeated or liberated island clears its outstanding hunt. Leaving camp restores the ordinary hunt store.
- The independent normalized key is `infinishoot.campaign.v1`. It retains a contiguous log of at most nine liberations and at most one outstanding rival per known island. The confirmed profile reset clears the chart. The main save export/import does not transport it. Progress is checkpointed on liberation and hunt updates, with no mid-fight resume.
- The host chooses the biome before the stage message creates the client arena. Drop-in and reconnect hellos receive the same setup. Gameplay snapshots carry the host chart, including the liberation screen. Guests inspect it in memory. A guest taking authority can continue that session's chart in memory without overwriting their own. Offline campaign persistence belongs to the original captain's machine.
- All chart controls use native buttons, MenuNav, device-aware prompts and logical layout. The sea retains its geography in RTL while the information panel changes sides. The EN/AR catalog is complete. The other five languages use their existing English fallback.

## Files

| Lane-owned | Purpose |
| --- | --- |
| `src/data/islands.ts` | Chart coordinates, stage counts, facilities and passage eligibility |
| `src/game/overworld.ts` | Store normalization, host simulation hooks, sync, boarding, harbour and liberation |
| `src/ui/overworldUi.ts` | PLAY and lobby entries, chart, landmark art, input, detail panel and local CSS |
| `tests/g7overworld.test.ts` | Progress limits, route gates, run reset, single boss, facilities, returning killer, mirrored chart and guest persistence |
| `notes/lanes/g7-overworld.md` | Decisions, checks and reproducible captures |

Shared edits are the campaign key and hunt-store selection in `src/core/storage.ts`, one import and one installation call in `src/game/game.ts`, the screen name and confirmed wipe in `src/ui/screens.ts`, a title-state setup for the chart QA link in `src/dev/testLinks.ts` and matching EN/AR entries in `src/i18n/menus.ts`.

## Screenshot checks

Managed **headless** Playwright, production Vite preview, six seconds after navigation. The shell screenshot command aborted before drawing when macOS denied Chromium's Mach-port registration. All PNGs below were opened for inspection. The progressed captures start from three liberated ports in disposable browser storage.

| Chart | English 720p | English 1080p | Arabic 720p | Arabic 1080p |
| --- | --- | --- | --- | --- |
| Fresh · `?test&screen=overworld` | [EN 720](../../shots/g7-overworld-after-map-en-720.png) | [EN 1080](../../shots/g7-overworld-after-map-en-1080.png) | [AR 720](../../shots/g7-overworld-after-map-ar-720.png) | [AR 1080](../../shots/g7-overworld-after-map-ar-1080.png) |
| Three liberated · PLAY → CAMPAIGN | [EN 720](../../shots/g7-overworld-after-ports-en-720.png) | [EN 1080](../../shots/g7-overworld-after-ports-en-1080.png) | [AR 720](../../shots/g7-overworld-after-ports-ar-720.png) | [AR 1080](../../shots/g7-overworld-after-ports-ar-1080.png) |

The combat pairs use `?test&seed=42&season=off&god`, plus the query in the first column and `&lang=en` or `&lang=ar`. At 844 × 390 with touch enabled, tapping a locked island showed its prerequisite. Tapping the meadow and SET SAIL opened the starting shop. [Arabic touch capture](../../shots/g7-overworld-touch-ar.png)

| Scene | EN 720p | EN 1080p | AR 720p | AR 1080p |
| --- | --- | --- | --- | --- |
| meadow · `&stage=1` | [before](../../shots/g7-overworld-before-meadow-en-720.png) / [after](../../shots/g7-overworld-after-meadow-en-720.png) | [before](../../shots/g7-overworld-before-meadow-en-1080.png) / [after](../../shots/g7-overworld-after-meadow-en-1080.png) | [before](../../shots/g7-overworld-before-meadow-ar-720.png) / [after](../../shots/g7-overworld-after-meadow-ar-720.png) | [before](../../shots/g7-overworld-before-meadow-ar-1080.png) / [after](../../shots/g7-overworld-after-meadow-ar-1080.png) |
| night · `&stage=2&night&biome=dunes:night` | [before](../../shots/g7-overworld-before-night-en-720.png) / [after](../../shots/g7-overworld-after-night-en-720.png) | [before](../../shots/g7-overworld-before-night-en-1080.png) / [after](../../shots/g7-overworld-after-night-en-1080.png) | [before](../../shots/g7-overworld-before-night-ar-720.png) / [after](../../shots/g7-overworld-after-night-ar-720.png) | [before](../../shots/g7-overworld-before-night-ar-1080.png) / [after](../../shots/g7-overworld-after-night-ar-1080.png) |
| boss · `&stage=4&bossnow&nointro` | [before](../../shots/g7-overworld-before-boss-en-720.png) / [after](../../shots/g7-overworld-after-boss-en-720.png) | [before](../../shots/g7-overworld-before-boss-en-1080.png) / [after](../../shots/g7-overworld-after-boss-en-1080.png) | [before](../../shots/g7-overworld-before-boss-ar-720.png) / [after](../../shots/g7-overworld-after-boss-ar-720.png) | [before](../../shots/g7-overworld-before-boss-ar-1080.png) / [after](../../shots/g7-overworld-after-boss-ar-1080.png) |

## Balance and co-op

Node 22.23.3, base revision `f595dd3`. Ran `npm run skillbot -- --runs 20 --seed 1 --jsdom` before and after with the mortal Rookie on Normal, season off, no pet. All 20 seeds reached death or a loop clear in both cohorts.

| Normal metric | Before | After |
| --- | ---: | ---: |
| Stage 1 / 2 / 3 / 4 clears | 100 / 95 / 90 / 50% | 100 / 95 / 90 / 50% |
| Loop clears | 10/20 | 10/20 |
| Median stage reached | 4 | 4 |
| Mean simulated seconds | 946.1 | 946.1 |

Three further browser runs exercised `window.skillRun` through the actual campaign entry and shops. Each ended on the liberation map with one boss defeated. These single-seed route checks establish that a mortal pilot can finish each passage tested.

| Island / route | Seed | Stages | Simulated seconds | Kills |
| --- | ---: | ---: | ---: | ---: |
| Meadow / coast | 1 | 1 | 267.92 | 5,554 |
| Dunes / market | 3 | 2 | 492.40 | 16,926 |
| Neon / ferry | 5 | 1 | 267.69 | 6,669 |

Two separate browser profiles played campaign over a real WebRTC channel with local signalling. On Neon both peers had seed 2705361981 and 142 arena colliders. The host liberated island four, and both maps showed 4/9. Guest storage stayed at 1/9, and only the host had SET SAIL. The same crew embarked for the factory with seed 1234546590 and 128 colliders on both peers. Both pages completed without runtime errors. The existing offline co-op driver also passed in managed Chromium, including the simulated slow link, reconnect, restart, lobby return and kick. Its 1,905 recorded snapshots averaged 1,862 bytes, peaked at 15,365 bytes, and none exceeded 16 KiB.

## Frame budget

Measured with the stock `measureScene`, `measureLoad` and gate functions in managed headless Chromium on Apple M5 Pro Metal, with production Vite previews. Warm-up was two seconds and sampling five seconds. Before any source edit, HIGH 1080p heavy measured 60.00 fps, frame interval p95 16.8 ms, callback CPU p95 4.2 ms and GPU p95 2.31 ms. On the final paired control and campaign runs, that same scene measured **60.00 → 60.00 fps**, **16.7 → 16.7 ms** frame interval p95, **4.6 → 4.5 ms** callback CPU p95 and **2.34 → 2.44 ms** GPU p95. Median populations in the final pair were 286 → 287 enemies and 500 → 504 projectiles.

The full matrix passed all 48 native-speed stock cases, both 1,000-light renderer cases and all four cold loads. Eight of twelve LOW 4× cases initially failed. Reran those eight against both the original and changed production builds. Three passed on retry. The five remaining failures also failed on the original build. The hardware gate remains **failed**. Each cell below is baseline → campaign, in milliseconds.

| LOW, CPU 4× | Simulation p95 | Frame interval p95 | Callback CPU p95 |
| --- | ---: | ---: | ---: |
| 720p heavy | 12.1 → 12.4 | 33.4 → 33.4 | 21.7 → 23.8 |
| 720p double | 15.8 → 13.4 | 33.4 → 33.4 | 26.5 → 22.9 |
| 720p four heroes | 19.0 → 18.4 | 50.0 → 50.0 | 32.8 → 32.6 |
| 720p night | 12.6 → 12.3 | 33.4 → 33.4 | 23.9 → 24.0 |
| 1080p four heroes | 16.6 → 14.9 | 50.0 → 50.0 | 29.0 → 27.0 |

The 4× limits are 12 ms simulation, 34.5 ms frame interval and 28 ms callback CPU at p95. Recheck with `npm run bench:real -- --check --from-report shots/g7-overworld-bench.json`. [Full report with retries](../../shots/g7-overworld-bench.json) · [First pass](../../shots/g7-overworld-bench-first.json) · [Original revision, paired controls](../../shots/g7-overworld-bench-controls.json)

## Verification and remaining limits

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npx vite build` | Pass |
| `npm test` | Pass, 147 files, including strict EN/AR coverage |
| `npm run smoke` | Pass, including mortal game over and zero runtime errors |
| `npm run skillbot -- --runs 20 --seed 1 --jsdom` | Pass, Normal stayed inside the 40–60% target |
| `npm run coop -- --offline` | Shell launcher failed at macOS Chromium startup. The same driver passed in managed headless Chromium, plus the campaign-specific two-profile test above. |
| `npm run balance` | Shell launcher failed at macOS Chromium startup. The managed four-kit invincible bot cleared two stages with every kit. One of 32 historical comparisons failed: Laser / Well / Meteor stage-one ranks were 8 against a reference of 12. The same comparison also returned 8 on the unmodified revision. |
| `npm run bench:real -- --check` | Shell launcher failed at macOS Chromium startup. The official gate on the managed report returned failure for the five throttled cases listed above. |
| `npm run shot` | Shell launcher failed at macOS Chromium startup. Managed headless Playwright produced the inspected PNGs listed above. |

A separate browser walk-through used stage-clear hooks to sail from an empty chart through all nine named islands and verified the persisted 9/9 ending. A virtual controller selected Sunset Dunes with D-pad down and confirm, then returned to PLAY with back. Android/iOS hardware and physical controllers were not used. The remaining release checks are the five throttled budgets and the existing invincible-bot rank comparison. All lane changes are uncommitted.
