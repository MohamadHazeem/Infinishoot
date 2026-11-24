# Gate 9 mastery, hardcore and weekly speedruns

Players can open **Collection → Mastery** from the title. Each hero and weapon has a separate track. The title unlocks at 500 attributed final blows or three stage clears while equipped. Enamel armour unlocks after the title plus either a boss defeated without taking HP damage or an evolution in stage 2. A hero earns the evolution mark for their build, and a weapon earns it for its own evolution. The two marks may be earned in either order. Players can equip or remove one title and one armour finish. The title and enamel are displayed on the wearer’s device. The co-op lobby continues to advertise its ordinary wardrobe skin and team colour. Neither reward modifies a stat, unlock pool or shop price.

**Hardcore** has its own cosmetic collection and life receipt. Pick a pilot, then confirm the one-life warning. All pilots start on Normal with Buster, Charge Shot and Bomb, no pet, and the base offer pool. Retire alive through Pause → Quit to bank progress. A lethal hit clears the life immediately, before results, including equipped rewards. A stale result from an earlier life cannot re-bank that collection. Rewind and Phoenix are spent at entry, and the death path bypasses extra lives and pet revives. Each run temporarily fills the main save with fresh defaults, disables normal save writes and restores the original contents on exit. Previous hardcore results remain on the anonymous board after a death. Competitive records exclude assisted games, content mods, cheats and test links.

**Weekly speedrun** uses an ISO UTC week, Rookie, Normal, the starter kit, a fresh profile and four stages with bosses. The fixed course disables route voting because the Pacifist road has no boss. The regular shops and build decisions remain. The clock accumulates simulated play, independently of the rewindable run clock. The eight cumulative splits mark each boss's arrival and stage clear. During a race the HUD shows time, latest split and difference from the best. A completed personal best supplies the next attempt's stage-aware, non-interacting 10 Hz ghost. Menus, warnings, results, live labels and board status have EN/AR text, RTL layout and native menu navigation.

## Storage, co-op and Worker

- All new persistence uses the guarded storage wrapper under `mastery.v1`, `hardcore.life.v1`, `hardcore.board.v1` and `speedrun.best.v1`. Unknown tracks, invalid counts, unearned equipment and malformed ghosts are discarded. Ordinary save format and migrations are unchanged.
- The host attributes kills to the attacking hero. Final summaries carry each player's own marks. Every three seconds the host includes the tallies across the full three-step snapshot window, covering the staggered seats in five-to-eight-player rooms. A promoted guest continues the roster’s tallies. A disconnect between checkpoints can cost recent unbanked progress. Special modes are solo. No extra enemies, projectiles, damage sources, render-loop gameplay or persistent stat power.
- With no Worker URL, local results and the ghost work and online board controls stay hidden. Online boards use existing SCORES KV and TELEMETRY D1 bindings, an opaque receipt per run, top ten results, uniqueness on (board, receipt) and a short-lived hashed submission cooldown. Hardcore orders by score, then stage and elapsed time. Weekly speedruns order by elapsed time. The table and indexes are created on first use.
- A speedrun POST starts with the SHA-256 hex digest of its gzip archive. Inside are newline-delimited header, sanitized string table and numeric replay chunks. The header identifies the game version, format, week, seed, fixed rules, eight split hashes and terminal hash. The Worker checks the digest, fixed kit, time/tick plausibility, split links and final state against the replay header, and walks the event framing and recorded 60-step checksums. Commands that skip stages, enable assistance or issue debugging actions are rejected. Numeric chunk boundaries can fall inside an event. Archive limits are 16 MiB compressed and 192 MiB inflated. KV keeps accepted tapes for 60 days under `speedrun:tape:<digest>`. The board advertises replay checks. Gate 10 still owns authoritative resimulation. Production Worker CPU/quota behaviour is unmeasured.

## Files

- Feature code in `src/data/mastery.ts`, `src/game/mastery.ts`, `src/game/hardcore.ts`, `src/game/speedrun.ts`, `src/ui/masteryUi.ts` and `src/i18n/mastery.ts`.
- Shared edits in `src/game/game.ts` install the controller, attribute confirmed kills, carry the occasional checkpoint, update the special clock and route finished-run input. `src/ui/screens.ts` declares the screen and optional summary field. `src/dev/testLinks.ts` adds preview entry points. `src/i18n/en.ts` and `ar.ts` include the lane dictionaries. The five existing fallback catalogs (`de.ts`, `es.ts`, `fr.ts`, `pt-BR.ts` and `tr.ts`) each add two lines to provide the English mastery keys. `server/leaderboard/routes.js` appends the two endpoints.
- Worker modules are `server/leaderboard/hardcore.js`, `speedrun.js`, and `mastery/{masteryBoards.js,speedrunProtocol.js,speedrunProtocol.d.ts}`. `tests/g9mastery.test.ts` exercises gameplay hooks, collection normalization, death, stale writes, EN/AR navigation, checkpoint transfer, ghost selection, the actual replay writer and SQLite-backed Worker requests.

## Reproduction and screenshots

Use `?test&screen=mastery` for tracks, append `&mastery=hardcore`, `&mastery=warning` or `&mastery=speedrun` for those views. `?test&masteryrun=speedrun` starts a practice race. Append `&lang=ar` for Arabic. The before/after combat pairs below use a real headless browser, six seconds, both locales and both sizes. The control is the pre-lane production bundle. The control seed was 1175000092 (2026-W48), the same weekly course as the lane capture. Both use fixed circle movement, season off, god mode, and the bench link to keep level-up menus out of the picture.

| Scene | Test-link additions | Before → after file pair in shots/ |
| --- | --- | --- |
| Meadow | `stage=1&biome=meadow&day` | `g9-mastery-control-meadow-{en,ar}-{720,1080}.png` → `g9-mastery-after-meadow-{en,ar}-{720,1080}.png` |
| Night | `stage=2&night` | `g9-mastery-control-night-{en,ar}-{720,1080}.png` → `g9-mastery-after-night-{en,ar}-{720,1080}.png` |
| Boss | `stage=4&bossnow&nointro` | `g9-mastery-control-boss-{en,ar}-{720,1080}.png` → `g9-mastery-after-boss-{en,ar}-{720,1080}.png` |

The menu captures are `g9-mastery-after-{tracks,warning,speedrun}-{en,ar}-{720,1080}.png`. The original paused run's files named `before` showed the workbench, so the visual comparison uses the replacement `control` captures.

The review covered 12 combat pairs and 12 menu views. **Keep collection** had initial focus in both languages. The pace label cleared the Arabic boss name at 720p. A practice fixture advanced the four boss arrival and clear hooks for six additional captures at 1280×720, 1920×1080 and 844×390. All eight rows and the return button fit in the Arabic landscape result. These captures use synthetic split times and are stored as `shots/g9-mastery-results-{en,ar}-{720,1080,390}.png`.

## Release checks

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Pass | Final TypeScript sources. |
| `npx vite build` | Pass | Final production build, including all five fallback catalogs. |
| `npm test` | **Fail, 156/157** | Mastery and Worker tests passed. Both strict language suites and the title-demo save check passed on isolated retry. Only `hostmig.test.ts` failed again. |
| `npm run smoke` | Pass | Solo hero runs, local co-op, race, friend challenge and mortal game-over/history completed with no runtime errors. |
| `npm run coop -- --offline` | Pass | Two real WebRTC players, spectator, reconnect, party restart, lobby return and kick. The host sent 1,866 snapshots, averaging 1,683 bytes and peaking at 14,261 bytes. |
| `npm run skillbot -- --difficulty normal --runs 20` | Pass (difficulty target missed on both revisions) | Same outcomes and times for every seed. |
| `npm run balance` | **Fail, four golden comparisons** | All four active kits finished both stages. |
| `npm run bench:real -- --check` | **Fail, eight scenes** | 54 of 62 scenes passed, along with all four load checks. |

The Node host-migration fixture reached a reconnect path where Rolldown’s bundled PeerJS default could not be constructed. The unchanged fixture, bundled with the pre-lane integration sources at `3b35432`, failed at the same `new NetClient` call. The real WebRTC reconnect passed. An earlier browser run timed out on spectator join. A diagnostic run then completed spectating but hit an optional trace callback after the kick. The passing stock run used tracing off.

The invincible-bot golden differences match the Gate 8 control. Buster stage-two kills were 9,700 against 15,414. Laser stage-one ranks were 8 against 12. Rail stage-one and stage-two kills were 4,103 and 10,622 against 5,677 and 15,298. [Gate 8 control](g8-roles.md) · [Measured kits](../../shots/g9-mastery-balance.json)

## Difficulty and frame times

The pre-lane and final Normal cohorts used Rookie, no pet, season off and seeds 1–20. Both cleared **15/20 loops (75%)**, above the Gate 2 target of 40–60%. Each seed matched its original outcome, death cause and simulated time. Stage clear rates were 100 / 100 / 100 / 75%, median stage was 4, mean time was 1,016.1 game seconds and every run finished. [Before](../../shots/g9-mastery-skillbot-before.json) · [After](../../shots/g9-mastery-skillbot-after.json)

The CLI browser harnesses attached to an isolated headless Apple M5 Pro Metal instance over local CDP. The initial GPU command timed out warming the 720p shadows boss after 20 scenes under shared load. A full checkpointed run used the stock drivers, two-second warm-up and five-second sample, then repeated the failed cases. The official budget checker still rejected seven 4× CPU-throttled LOW scenes (720p heavy, double, team and night, plus 1080p double, team and night) and the 1080p WebGPU lights scene (53.6 FPS, missed refresh slots). Every unthrottled WebGL scene passed. [Initial full matrix](../../shots/g9-mastery-bench.json) · [Retried report](../../shots/g9-mastery-bench-retry.md)

The original 720p LOW heavy reference measured 60.0 FPS with median 277 enemies and 500 projectiles. Frame intervals were 16.7/16.8/16.8 ms at median/p95/p99 and callback CPU was 2.7/3.9/5.2 ms. The final budget sample measured 60.0 FPS with median 262 enemies and 500 projectiles, intervals of 16.7/16.7/16.8 ms and callback CPU of 3.3/4.7/6.7 ms.

These additional paired samples alternate the pre-lane and final production builds on the same browser. [Matched samples](../../shots/g9-mastery-perf-pair.json)

| Scene | FPS before → after | Frame interval p95, ms before → after | Callback CPU p95, ms before → after |
| --- | --- | --- | --- |
| 720p LOW heavy | 60.0 → 60.0 | 16.7 → 16.7 | 4.6 → 4.5 |
| 1080p HIGH four-player | 60.0 → 60.0 | 16.7 → 16.8 | 6.4 → 6.0 |
| 720p LOW night, 4× throttle | 35.4 → 35.0 | 33.4 → 33.4 | 26.9 → 26.2 |
| 1080p LOW four-player, 4× throttle | 31.3 → 30.4 | 50.0 → 50.0 | 35.7 → 31.2 |
