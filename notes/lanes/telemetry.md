# Gate 1 playtest telemetry

Players choose Yes or No on first launch, including the first launch after upgrading an existing save. Settings → Gameplay has **Share Playtest Data** and **Delete My Data**. With sharing off, a player can still choose **Report a Problem** from pause or game over, review the attachments, and send the report or save it to a file. Both flows have English and Arabic UI.

## Collection and privacy

- A consenting solo player or co-op host contributes one summary per completed run. The host records the local hero’s decisions and damage, team size and party type. The instrumentation observes gameplay and leaves network snapshots and the effects bus untouched.
- The summary includes UTC start day, build, mode, difficulty, ascension, heat, hero, starting gear, stages, loop clears, duration, ranks, level-up alternatives and pick, purchases, Mods and relics, boss results and times, damage by source, last ten seconds of hits, the killing hit and prior life, rescues, language, platform, quality, and average/worst visible combat frame intervals. Training and replay playback are excluded. The payload uses catalog IDs. Bullets whose shooter cannot be attributed use `enemy_fire`.
- Versus, PvP and race use their own result screens. Their summaries use the competitive mode ID. A match loss without a fatal hit and a drawn duel have separate outcomes so those results do not inflate the death counts. Race completion measures whether the local runner finished the stage.
- The 8,000-byte client budget first compacts repeated offer IDs. If necessary, it trims older detail and counts omitted records. The local queue keeps the latest 24 summaries and drains asynchronously at startup, on connectivity or after a run. A repeated event ID counts once. A build without a configured server keeps consenting runs locally. Only the build-time `VITE_LEADERBOARD_URL` can receive telemetry or deletion requests.
- The installation UUID is created with `crypto.randomUUID()` and retained locally. D1 stores its SHA-256 digest. Gameplay deletion turns off sharing, clears the queue and removes runs, reports and attachments for that installation. A digest blocks late uploads for 24 hours. Expired digests are pruned on subsequent deletions. Offline deletion can be retried. Clearing client storage first loses the ability to identify earlier submissions.
- Reports allow six categories and up to 500 characters of player-entered text. Replay is preselected on the recording host or solo game. Optional JPEG captures the game canvas, up to 800 × 600 and 300 KiB. The file fallback packages the same selected attachments without the install ID. A failed capture or replay can be unchecked and retried.
- Shareable ISR files keep input and checksum data and replace player and peer identities with numbered seats. Unknown commands are omitted from playback via a deterministic no-op. Unusual custom or reconnect scenarios may diverge after privacy filtering. A normal solo recording replayed through all 125 steps with matching checksums. The existing recorder runs on the host. Co-op clients can attach their own screenshot and note.

## Backend and dashboard

The migration creates indexed D1 tables for runs, reports and deletion markers. The Worker accepts build **2.0.1**. Update the exact allowlist for subsequent playtests. Streaming input caps are 16 KiB for runs and 1.5 MiB for reports including base64. A rolling hourly quota accepts 60 unique runs and six unique reports per installation. Gzip replay and JPEG bytes share one report row, with the wire cap keeping that row below D1’s 2 MB limit. The upload response acknowledges duplicate submissions for safe retries.

The standalone dashboard in `tools/playtest-dashboard/index.html` opens directly from disk. The server URL and admin credential are held in sessionStorage for the tab. Only bearer-authenticated reads list summaries or download attachments. The dashboard covers UTC volume, median duration, stage distribution, top deaths by stage, boss outcomes, choices and wins, difficulty, platform frame times, and the report inbox. Definitions and setup are in [ONLINE.md](../../docs/ONLINE.md#playtest-telemetry).

`npm run server:dev` binds real local D1 and applies the migration. The explicit owner deploy command reuses or creates `infinishoot-telemetry`, binds it, migrates it and prints the admin-secret setup command. The template selects the telemetry entry point so its Authorization preflight and IP-free routes are handled before the existing KV Worker; all other routes delegate to the existing implementation. Remote provisioning was tested with a mock. No remote environment was changed.

## Files

- Client and UI — `src/game/systems/telemetry.ts`, `src/net/telemetryClient.ts`, `src/net/telemetrySchema.ts`, `src/net/telemetryReport.ts`, `src/ui/consent.ts`, `src/ui/report.ts`.
- Backend — `server/leaderboard/telemetry.js`, `server/leaderboard/migrations/0001_playtest.sql`, `server/leaderboard/wrangler.template.toml`, `scripts/server-dev.mjs`, `scripts/server-deploy.mjs`.
- Dashboard — `tools/playtest-dashboard/index.html`, `aggregate.js` and `dashboard.js` in that directory.
- Verification and documentation — `tests/telemetry.test.ts`, `tests/telemetryGame.test.ts`, `docs/ONLINE.md` and this note.
- Shared additions — `src/game/game.ts` imports and installs the observer, `src/game/systems/runFlow.ts` finalizes before banking/title teardown, `src/ui/screens.ts` registers two screen IDs, `src/i18n/en.ts` and `ar.ts` add 32 catalog entries each, and `server/leaderboard/routes.js` registers the route. The owned UI modules add the settings and menu buttons through existing screen APIs.

## Reproducing the checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed, with Vite’s chunk-size advisory. |
| `npm test` | All 124 test files passed. The full rerun includes the regression check for multiple Game instances sharing a document. |
| `npm run smoke` | Passed on the final code, including mortal run, game over, co-op, race and Versus. |
| `npm run coop -- --offline` | CLI browser launch blocked by the macOS sandbox. The full offline suite passed in managed Chromium. |
| `npm run shot` | CLI browser launch blocked by the same restriction. The managed-browser visual checks are described below. |
| `npm run server:dev` | Verified local migrations, actual D1 writes, admin reads, attachments and deletion. |

- Use a fresh browser profile and the ordinary title URL for the real first-launch choice. Use `?test&screen=consent`, `?test&screen=pause`, `?test&screen=report&god`, and `?test&screen=settings&settingstab=3` for direct menu views. `?test&recap` opens the MVP recap; continue to game over. Append `&lang=ar` for Arabic. A configured build explicitly pointed at localhost is required to test real telemetry uploads.
- Local Chromium and Wrangler verified a report sent with sharing off, a 50-step ISR download and a nonblank 21,940-byte JPEG. After opt-in the first finished run appeared in the dashboard, and Gameplay deletion removed the run, report and both attachments. Unauthenticated summary access returned 401 and a late upload after deletion returned 410.
- Inspected English and Arabic consent, report, Gameplay, pause and game-over views at 1280 × 720 and 1920 × 1080. The ignored PNGs match `shots/telemetry-*.png`. Also inspected dashboard images with local data in both languages.
- The ordinary screenshot and offline co-op commands were blocked at Chromium launch by the macOS sandbox. Ran the full offline co-op assertions in managed Chromium with the same signaling mocks, simulated disconnect and lobby return. It passed with 1,905 snapshots, 1,658 bytes average and 12,613 bytes maximum. The same managed browser supplied the screenshots.
