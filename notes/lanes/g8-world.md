# Gate 8 · Community goals and stream mode

## Playing

The weekly community target is **1,000,000 defeated enemies**. The title shows the shared count and reward. Completing it raises a gold pixel Comet Pennant on the title and beside the fight clock for every connected player who has fetched the unlock. The pennant expires at 00:00 UTC on Monday. It grants no stats or currency.

**Settings → Game → Stream Mode** accepts a public Twitch channel. In solo or host-led Standard and Endless fights, viewers choose **1** Gold Rush, **2** Meteor Shower or **3** Magnet Burst. They can also type `!vote 1`, `!vote 2` or `!vote 3`. Sending `!help` shows the instructions on the broadcast for eight game seconds. A guest connection to Twitch's IRC WebSocket was verified from the production game. The code sends only the IRC handshake, join and heartbeat replies. Anonymous guest reading depends on Twitch continuing to accept guest nicknames. [Twitch IRC protocol](https://dev.twitch.tv/docs/chat/irc/)

## Decisions and limits

- The goal counts all enemies so the existing team kill total in `POST /scores` is sufficient. Eligible solo and host finishes contribute independently of telemetry consent. Each valid run lasting at least ten seconds earns the lesser of its kills, 16 per second and 5,000. The existing scoreboard governs eligibility, score plausibility and its one-submission-per-minute cooldown.
- The Worker route delegates the bounded submission to the existing scorer once and accounts for successful responses. An internal request-identity guard prevents re-entry. This keeps the public score payload and rank response compatible. A D1 outage still allows the original score response. The delegation uses a second slot in the Worker's per-isolate burst limiter.
- The existing D1 binding creates a separate `world_goal` table and tally trigger on first use. A unique receipt and its aggregate increment share one SQLite transaction. The title reads one indexed aggregate, and counting stops at the target. The receipt hashes the board and numeric result fields. It stores no pilot name, chat identity, IP, installation identifier or replay. Two genuinely identical result tuples within a week share a receipt. Earlier weeks are removed on a later contribution.
- The title checks at most once per minute with a 4.5-second timeout. The client checks expiry during a run, hides missing or invalid goal state, and makes no goal request without an online server URL. The pennant is session state. Stream settings use their own normalized `infinishoot.streamMode.v1` key through the storage wrapper.
- Polls open every 75 eligible fight seconds and stay open for 20. One viewer gets one vote. Ties and empty ballots leave the field alone. A winning field event waits for the boss and current event to clear. If that takes another ballot, the latest decisive winner is kept. Menus and disconnects never hold up the simulation.
- The client admits at most 160 chat lines per second, 2,000 distinct voters per poll, 64 KiB per frame and 256 lines per frame. Help has a 15-second cooldown. The guest handshake times out after 15 seconds and failed joins back off from 5 to 120 seconds. The HUD updates at most four times a second in the existing docked goals stack. Viewer names live only in the current in-memory ballot.
- The host resolves votes in its fight update. Gold Rush and Meteor Shower use the existing stage-event snapshot and effects. Meteors retain their 1.3-second warning discs. Magnet Burst uses the existing pickup vacuum and banner. Guests never connect to Twitch or select an outcome. English and Arabic include all new copy. The other five catalogs inherit English through the existing fallback.

## Files

New implementation files are `src/game/worldGoals.ts`, `src/game/streamMode.ts`, `src/ui/streamUi.ts` and `server/leaderboard/goals.js`. New coverage is in `tests/g8world.test.ts`.

Shared edits are additive. `server/leaderboard/routes.js` registers the route. `src/game/game.ts` constructs the feature and calls its run-reset, connection, HUD and authoritative fight hooks. `src/dev/testLinks.ts` adds `&streampoll`, a local recorded ballot preview. `src/i18n/arabic2.ts` and `src/i18n/ar.ts` add 19 keys each. The pre-existing change to `.lane-brief.md` belongs to the worktree setup.

## Gameplay and browser checks

`npm run skillbot -- --runs 10 --seed 1` ran the mortal Rookie on Normal with the default stream setting before and after. Every seed matched its original finish time and outcome. Both cohorts cleared stages 1–4 at **100 / 100 / 100 / 70%**, with **7/10 loop clears**, mean **998.4 game seconds**, and zero incomplete runs. Seeds 4, 6 and 10 died to slug, lava and Golden King's shockwave respectively. The supplied baseline already exceeded the Gate 2 ceiling of 60%. The tracked skillbot report was restored after measurement.

The stock offline co-op scenario passed in managed headless Playwright. It exercised reconnection, objectives, party restart and lobby return, with 1,928 snapshots averaging 1,889 bytes. A separate two-peer test fed a vote through the host's IRC WebSocket. The guest received `meteors` through its normal event snapshot and only the host opened IRC. SQLite-backed tests drive the deployed Worker's entry point, including rejected and duplicate scores, caps, rollover, concurrent finishes, the unlock threshold, and unavailable storage. IRC tests include anonymized recorded welcome, channel join and public-chat line formats.

The direct shell Chromium launch aborted for `npm run shot`, `npm run coop -- --offline`, `npm run balance` and `npm run bench:real -- --check`. The headless shell reported a macOS Mach bootstrap permission denial. Managed headless Chromium ran the screenshot matrix, co-op assertions, seeded balance replay and benchmark scene/load drivers. The balance replay took all four kits to stage three on both builds with identical results. The saved tolerance check failed on both for Buster stage-two kills (9,700 vs 15,414), Laser stage-one ranks (8 vs 12), and Rail kills (4,103 vs 5,677 and 10,622 vs 15,298).

## Visual checks

Use `?test&bench&circle&god&seed=42&streampoll` with `&stage=1&biome=meadow`, `&stage=2&biome=dunes&night`, or `&stage=4&bossnow&nointro`. Add `&lang=ar` for Arabic. The preview never opens a socket. For goal and settings checks use `?test&screen=title&server=<local-worker-url>` and `?test&screen=settings`. The screenshots below used a local goal response at the unlock threshold. Each before/after pair was inspected after a six-second wait.

| Scene | Language | Size | Original at 5de9c3a | Poll and unlocked pennant |
| --- | --- | --- | --- | --- |
| meadow | EN | 1280×720 | [Before](../../shots/g8-world-before-meadow-en-720.png) | [After](../../shots/g8-world-after-meadow-en-720.png) |
| meadow | EN | 1920×1080 | [Before](../../shots/g8-world-before-meadow-en-1080.png) | [After](../../shots/g8-world-after-meadow-en-1080.png) |
| meadow | AR | 1280×720 | [Before](../../shots/g8-world-before-meadow-ar-720.png) | [After](../../shots/g8-world-after-meadow-ar-720.png) |
| meadow | AR | 1920×1080 | [Before](../../shots/g8-world-before-meadow-ar-1080.png) | [After](../../shots/g8-world-after-meadow-ar-1080.png) |
| night | EN | 1280×720 | [Before](../../shots/g8-world-before-night-en-720.png) | [After](../../shots/g8-world-after-night-en-720.png) |
| night | EN | 1920×1080 | [Before](../../shots/g8-world-before-night-en-1080.png) | [After](../../shots/g8-world-after-night-en-1080.png) |
| night | AR | 1280×720 | [Before](../../shots/g8-world-before-night-ar-720.png) | [After](../../shots/g8-world-after-night-ar-720.png) |
| night | AR | 1920×1080 | [Before](../../shots/g8-world-before-night-ar-1080.png) | [After](../../shots/g8-world-after-night-ar-1080.png) |
| boss | EN | 1280×720 | [Before](../../shots/g8-world-before-boss-en-720.png) | [After](../../shots/g8-world-after-boss-en-720.png) |
| boss | EN | 1920×1080 | [Before](../../shots/g8-world-before-boss-en-1080.png) | [After](../../shots/g8-world-after-boss-en-1080.png) |
| boss | AR | 1280×720 | [Before](../../shots/g8-world-before-boss-ar-720.png) | [After](../../shots/g8-world-after-boss-ar-720.png) |
| boss | AR | 1920×1080 | [Before](../../shots/g8-world-before-boss-ar-1080.png) | [After](../../shots/g8-world-after-boss-ar-1080.png) |

Title progress, completion and settings were also inspected in both languages at both sizes. The channel field retained a normalized channel through reload and language switching. [Title meter](../../shots/g8-world-goal-en-720.png) · [Arabic unlock](../../shots/g8-world-won-ar-1080.png) · [Settings](../../shots/g8-world-settings-en-720.png) · [Arabic settings](../../shots/g8-world-settings-ar-720.png) · [In-game pennant](../../shots/g8-world-pennant-en-720.png)

## Performance

Managed Chromium used Metal on the Apple M5 Pro, two seconds of warm-up and five seconds of measurement per scene. The representative row is 1280×720, HIGH WebGL2, heavy meadow.

| Build | FPS | Frame p95 | Mean callback CPU | Callback CPU p95 | Median enemies / projectiles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original | 60.00 | 16.7 ms | 3.57 ms | 5.0 ms | 267 / 499 |
| Lane, stream off | 60.00 | 16.8 ms | 3.44 ms | 4.5 ms | 270 / 500 |
| Lane, active poll | 60.00 | 16.8 ms | 3.28 ms | 4.6 ms | 257 / 500 |

The first matrix passed 52 of 62 render configurations. After the failed rows were repeated, the latest matrix passed **55/62 render configurations and all four cold loads**. All unthrottled configurations passed, including the two 1,000-light renderer cases. Under 4× CPU throttling, heavy, double, team and night missed at 720p. Double, team and night missed at 1080p. Each of those seven configurations also missed the budget when remeasured on the original source. The final four-hero results were 29.3 and 25.4 FPS respectively. The full performance gate remains open. [Initial matrix](../../shots/g8-world-coop/bench-first.json) · [Final measurements](../../shots/g8-world-coop/bench-final.json) · [Original-source controls](../../shots/g8-world-coop/bench-controls.json)

## Release checks

- Typecheck, Vite production build, focused Worker/IRC tests and the strict i18n suite passed (6,194 matching catalog keys).
- `npm test` passed **155/155 files** on the final rerun with `NODE_OPTIONS=--max-semi-space-size=64 TEST_JOBS=4`. Host migration passed on the runner's isolated retry. The first full run had missed its 300 ms reconnect window and reached the real PeerJS constructor. The original source reproduced the same exception.
- `npm run smoke` passed the whole-game test, including local co-op, race, challenges and the mortal game-over flow. Co-op, balance and renderer results appear above.
- Production deployment, live D1 traffic and audience playtesting remain with the release team. The fixtures used local SQLite and locally served builds. All lane changes are uncommitted.
