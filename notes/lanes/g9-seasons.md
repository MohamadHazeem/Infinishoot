# Gate 9 ranked seasons

Open **Collection → Your progress → Cosmetic Track → Ranked Seasons**. Standard (Normal and above), Daily (its usual Normal seed), and Abyss have separate six-week boards. On a connected installation the screen shows public standings, personal placement progress and final rewards. With no Worker URL it shows the season rules and this device’s history. The old monthly track still has its own XP, 50 tiers, weekly challenges and claims.

## Rules and rewards

- Season 1 runs from 23 November 2026 at 00:00 UTC up to 4 January 2027 at 00:00 UTC. The following seasons are contiguous 42-day intervals. A run keeps the rules it started with. A run crossing the cutoff can still enter its original local history, but the closed online board is immutable.
- A dedicated season seed selects one rule from each of three pairs for all three boards. An exposed target or an enemy in windup pays 60 extra ranked points. A kill within four metres or at least nine metres away pays 30. The first boss killed in each stage gives each present pilot either one reroll gear (up to the existing cap) or two gold. Combat telegraphs, damage, standard score and starting equipment are unchanged. All rewards for rank are cosmetic.
- Five distinct accepted finishes qualify a pilot. Placement uses the sum of the highest five scores, including the season points. Further low scores and inactivity cannot reduce it. Equal totals share competition rank and its reward. The public list shows the first 50 pilots. Personal history also covers pilots below the display cutoff.
- First place earns Comet Captain, places 2–10 Nova Ace, 11–50 Orbit Ranger and 51+ Star Scout. Each has its own frame. Closed boards show the title next to the pilot. Opening Ranked Seasons retrieves earned awards, which can be worn or removed on the device. The equipped framed title appears on the title-screen footer.
- Normal run completion or death banks the score once. A positive score and ten seconds of play are required. Assisted, custom, training, test-link, god-mode, stream-influenced, PvP, race and AI-squad runs are excluded. The host scores kills. A five-number checkpoint travels only to teammates and lets a promoted host carry the season, scoring bonus and once-per-stage supply forward. The finishing host enters the team score. No pilot credential travels with a snapshot.
- Local storage uses the normalized `rankedSeasons.v1` history and a separate random `rankedPilot.v1` device credential through the existing storage wrapper. The monthly track and the main save schema are independent. Offline finishes stay local. They cannot retrospectively qualify for server rewards.

## Worker and integration

The additive `/seasons2` route accepts a finish or returns a public board. `POST /seasons2/history` returns only the requesting pilot’s placements. D1 stores a digest of the device credential and score evidence. The public identifier is eight hexadecimal characters. The route accepts no player name or chat. Its per-IP KV cooldown uses a rotating digest with a 60-second TTL. The shared burst and body limits also apply. D1 enforces one accepted finish per pilot per 60 seconds and the finish deadline at insert time.

The receipt records the existing replay state checksum, replay format version, seed, release, mode, difficulty, stage, kills, duration, base score, rule bonus and a checksum over the submitted summary. The Worker checks eligibility, numeric bounds, bonus plausibility and the Daily date/seed. A unique seed/checksum pair prevents the same finish moving to another board, season or pilot. Retries of an identical accepted receipt are idempotent. A checkpoint supplied by a client is an anti-cheat hook. Full server-side replay simulation remains the Gate 10 verifier’s responsibility.

The lead must apply `server/leaderboard/migrations/0003_seasonal_finish.sql` to the existing TELEMETRY D1 binding when deploying the Worker. Nothing was deployed. This branch registers no playable Abyss mode. The seasonal board, placement, Worker route and tests accept the canonical `abyss` mode ID. An actual descent depends on the separate Abyss implementation using the normal start and finish hooks.

## Files

- Season rules, run lifecycle, storage and network client in `src/data/seasons2.ts` and `src/game/seasons2.ts`.
- UI and cosmetic track integration in `src/ui/rankedSeasons.ts`, `src/ui/seasonScreen.ts` and `src/game/systems/season.ts`.
- Worker route, registration and migration in `server/leaderboard/seasons2.js`, `server/leaderboard/routes.js` and `server/leaderboard/migrations/0003_seasonal_finish.sql`.
- English and Arabic copy in `src/i18n/seasons2.ts`. Small shared catalog registrations in `src/i18n/ar.ts` and `src/i18n/arabic2.ts` also supply the established English fallbacks.
- Small shared hooks in `src/game/game.ts` for run start, bank installation, kills, fair-play state and snapshot send/receive. The screen ID is registered in `src/ui/screens.ts` and the test link in `src/dev/testLinks.ts`. No shared stylesheet edits.
- `tests/g9seasons.test.ts` exercises real game banking, real SQLite via the Worker entry, calendar boundaries, qualification, cooldowns, duplicates, board separation, ties, awards, offline retention, snapshot handoff and Arabic navigation.
- The paused commit already replaced the tracked `notes/perf/skillbot-2026-11-23.json` with its ten-run measurement. This continuation leaves that inherited file untouched and keeps new measurement artifacts outside tracked files.

## Visual evidence

The paired files live under `shots/g9-seasons-`. For each row below, substitute `en-720`, `ar-720`, `en-1080` and `ar-1080` for `LANG-SIZE`. Each pair compares the previous season destination with the ranked screen reached from it. The 720 and 1080 images are 1280×720 and 1920×1080.

| Scene | Test link (append `&lang=en` or `&lang=ar`) | Before / after file suffixes |
| --- | --- | --- |
| Meadow | `?test&seed=42&god&stage=1&biome=meadow&day&rankedseason` | `before-meadow-LANG-SIZE.png` / `after-meadow-LANG-SIZE.png` |
| Night | `?test&seed=42&god&stage=2&biome=dunes&night&rankedseason` | `before-night-LANG-SIZE.png` / `after-night-LANG-SIZE.png` |
| Boss | `?test&seed=42&god&stage=4&bossnow&nointro&rankedseason` | `before-boss-LANG-SIZE.png` / `after-boss-LANG-SIZE.png` |

Replace `rankedseason` with `spscreen=season` for the cosmetic track. Additional captures include the track at both desktop sizes, the Arabic 844×390 scrollable sheet, and closed-board award and worn-title screenshots (`archive-{en,ar}-{720,1080}.png`, `title-{en,ar}-{720,1080}.png`, plus Arabic at 390). The archive/title browser fixture furnished a previous-season first place, exercised wear and return-to-title, and checked the visible frame and page errors. The Worker unit test independently produces that award from submitted runs. The desktop and phone Back buttons remain available while the list scrolls. The headless screenshot runner used Vite preview with an empty response for Chromium’s optional, otherwise missing favicon.

## Measurements

The resumed WIP production build was sampled first with the full headless Metal matrix (Apple M5 Pro, Chrome 159). Worst ordinary unthrottled p95 frame interval was 16.8 ms. At 1080p HIGH the double-horde scene delivered 60.0 fps and 16.7 ms p95. At 1080p LOW with 4× CPU throttling it delivered 22.7 fps and 66.7 ms p95. The original performance gate failed before the continuation. Complete original timings are in `/private/tmp/g9-seasons-resume-before.json`.

Typecheck and production build passed. The focused ranked season test passed. The paired Normal comparison uses the pre-feature parent `3b35432` and the final worktree, with fresh-process mortal Rookie runs, seeds 1–20, no pet, 2,100 game seconds per seed and the default skill settings. The earlier builder’s pre-feature seeds 1–10 recorded 7/10 loop clears (70%) and 998.4 mean game seconds.

Offline co-op passed with real WebRTC and local signaling. The client received all recorded hero skill events. The harness counted 2,738 snapshots averaging 1,954 bytes, with a 7,344-byte maximum and none over 16 KB.

The invincible balance harness still takes all four prescribed kits through stage two. Its stored tolerance check fails on the same numbers recorded before this lane in `notes/lanes/g8-world.md`: Buster stage-two kills 9,700 versus 15,414, Laser stage-one ranks 8 versus 12, Rail stage-one kills 4,103 versus 5,677, and Rail stage-two kills 10,622 versus 15,298. This deterministic fixture uses a pre-season date, explicit seed and cheats. Its reference file was left intact.
