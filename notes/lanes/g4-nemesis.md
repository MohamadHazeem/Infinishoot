# Gate 4 · Adaptive enemies and nemeses

## What players get

In Standard and Endless, a team that relies on a single damage family can encounter enemies that resist it. A returning killer carries a stitched scar, gets a generated name and a defensive trait, and is introduced by a four-second card. Killing it closes its story and drops a marked chest containing the **Vendetta Pin**. One teammate can open it for everybody. It adds 0.2 pickup magnet to each present hero for the run and cannot stack or roll from ordinary loot.

## Rules and tuning

- The host counts actual damage removed from HP and shields. Overkill, invulnerability and fixed damage do not inflate the sample. Each attack contributes to one family. Explicit fire, frost, shock and explosive tags take precedence over area, orbit and trail. Chain without a stronger tag counts as shock. Other hits count as kinetic.
- A family must account for **more than 60%** of damage in each of **twelve consecutive 10-second combat windows**. The next eligible spawn gets 4% resistance. Continued concentration adds 4 percentage points every ten seconds, up to 20%. Early spawns keep their original ceiling. Every mixed or empty window sheds one tier for current enemies and future spawns. A localized announcer line introduces the resistance, a HUD line names the family and current spawn percentage, and individual affected enemies wear a blue shield badge.
- Bosses, minibosses, titan parts, treasure and hidden actors do not get adaptive resistance. PvP, races, training, attract mode and authored challenge modes keep their own rules.
- On a team wipe the host promotes the individual that downed the most distinct seats. The latest confirmed down breaks ties. Automatic rescues do not count. A shot carries its shooter's ID even if the pool slot gets recycled. A delayed hazard with a known enemy species but ambiguous owner can count as an individual down, without combining different enemies' votes. An unattributed environmental death creates no rival. Quitting does not promote a killer.
- Four names and four epithets compose 16 names in both English and Arabic. Riveted Hide adds 50% life, or 8% on a boss/miniboss. Ablative Ward adds a 25% shield, or 5% on a boss/miniboss. Each rival has exactly one trait. It uses its species' original attack timings, damage and tells.
- The earliest outstanding ordinary rival can arrive after 16 seconds in a stage. It spawns on walkable ground 16–21 units out, with clearance of at least 7 units plus its radius from every living teammate. Blocked placements retry after a second. Bosses and scripted enemies can return only in their authored encounter. There is at most one named arrival per stage, including after its death.
- Host decisions travel in the existing gameplay snapshot. Effects use the existing effects bus. Participating clients merge the observed story into their own profile. Spectators do not adopt a host's history. Host migration preserves named encounter identity, its earned trait, the stage cap, outstanding stories and earlier down votes. The adaptive sampler restarts after host migration.
- The independent normalized store uses `infinishoot.nemesis.v1` and retains up to 32 stories, evicting a completed one first. A late snapshot cannot reopen a completed local story. The confirmed profile wipe clears this store. The existing main-save export/import does not transport this separate history.

## Files

| File | Change |
| --- | --- |
| `src/game/adaptive.ts` | Damage families, sampling, resistance tiers and eligibility |
| `src/game/nemesis.ts` | Host rules, story storage normalization, effect and snapshot hooks, migration, relic and measurement runner |
| `src/ui/nemesisUi.ts` | Bilingual card and HUD, announcer, pooled billboard shields, body scar and chest marker |
| `tests/g4nemesis.test.ts` | Boundary, true damage, per-player down vote, pooled projectile, migration, client profile, reward and stage-cap integration tests |
| `src/game/game.ts` (shared) | Two imports, one field, construction, host/client reset and one host fight tick |
| `src/core/storage.ts` (shared) | Independent storage key |
| `src/ui/screens.ts` (shared) | Clear the separate history on confirmed profile wipe |
| `src/dev/testLinks.ts` (shared) | Optional isolated visual fixture |
| `src/i18n/menus.ts` (shared) | English and Arabic vocabulary, contextual name templates, announcements and relic text |

## Reproducing the checks

- `?test&nemesis&god&seed=42` shows the scarred Rhino, its intro card and a resistance badge. `?test&nemesis=resist&god&seed=42` triggers the announcer. `?test&nemesis=trophy&god&seed=42` kills the fixture rival and shows its marked chest. Append `&lang=ar` for Arabic. These fixtures do not write a story.
- Inspected production screenshots in `shots/g4-nemesis-{en,ar}-{720,1080}.png` at 1280 × 720 and 1920 × 1080, `shots/g4-nemesis-resist-ar-720.png`, `shots/g4-nemesis-trophy-en-1080.png` and `shots/g4-nemesis-ar-390.png` at 844 × 390. On short landscape screens the intro sits to the side of the fight and stage timer.
- `NEMESIS_MEASURE=1 npm test -- g4nemesis` runs six consecutive Normal seeds on a disposable profile. The exported `measureHunts(game, runSeconds, beforeSeed?)` takes a synchronous or asynchronous runner. Use the same seeds, reset profile and seed setup when comparing bot versions. Each run stops at a first loop clear, death or 1,500 requested simulation seconds, in ten-second chunks. The measure never injects a synthetic rival.

## Normal measurements

**dev bot, to re-measure with the skilled bot**

This checkout has no `src/dev/skillBot.ts`, `window.skillRun` or `npm run skillbot`. Both samples used the existing mortal `botRun(seconds, false)`, the same six seeds, a fresh starting profile and the repo's seeded random helper. Each sample carried its own earned profile forward. The baseline used the original game at `d2f2456` before installation of the lane hooks.

| Normal seed | Before · last stage / kills | After · last stage / kills | Rival outcome after change |
| --- | --- | --- | --- |
| 41 | 1 / 6,699 | 1 / 6,683 | No appearance |
| 42 | 1 / 4,915 | 2 / 15,786 | Bot defeated rival |
| 43 | 4 / 47,764, cleared | 1 / 5,932 | Bot defeated rival |
| 44 | 3 / 27,756 | 3 / 22,929 | Bot defeated rival |
| 45 | 1 / 4,369 | 2 / 9,179 | No appearance |
| 46 | 1 / 6,536 | 1 / 7,215 | No appearance |

A nemesis appeared in **3/6 runs (50%)** and **3/10 stages reached (30%)**. There were three encounters, three player wins and **zero nemesis wins (0/3)**. A nemesis win here means the returning individual delivered the team-wiping blow. Before the feature there were zero appearances and no defined encounter win rate. The mortal bot cleared one loop in 1/6 baseline runs and 0/6 after the change. These small samples cannot establish the skilled-bot 40–60% Normal target. That measurement remains outstanding on the integrated Gate 2 build.

## Verification

- Node 22.23.3. TypeScript and the production Vite build passed. The focused lane and cooperative tether suites passed together. Arabic, i18n and language-fallback checks passed. The trophy lookup also survived a full mod-registry rebuild and stayed out of the ordinary relic pool.
- Verified the collectible in headless Chromium by moving a hero to the actual dropped chest. The hero acquired the Vendetta Pin and gained 0.2 magnet through the normal pickup update.
- Shield markers use one reusable 700-instance mesh, a shared pose and view culling. Idle runs allocate the meshes only when a marker first becomes visible. In a 1280 × 720 production stress room with 181 enemies and 500 projectiles, six alternating batches of 200 calls per condition gave median CPU times of 0.0005 ms for the existing elite bars without resistance and 0.0090 ms with the whole crowd eligible. These are marker-update timings. Hardware frame rate was not measured.
- Standalone Chromium for the co-op, balance and screenshot scripts failed to launch under the macOS sandbox (`MachPortRendezvous`, permission denied). Managed headless Playwright ran the offline co-op and balance script scenarios against this worktree. The four invincible balance kits passed all 32 existing stage metrics with the existing tolerance. Stage 1 / stage 2 cumulative kills were 4,756 / 15,384 for Buster, 5,763 / 15,491 for Laser, 6,075 / 14,571 for Scatter and 5,677 / 15,298 for Rail.
- The full `npm test` invocation exited red after its automatic isolated retries. The ten fixtures listed in the Gate 2 hardmode handoff also failed here (`balance3`, `gameplay`, `gameplayCoop`, `menus`, `meta`, `raid`, `time`, `timeCoop`, `ultboss` and `worldEventsGame`). They cover former Medium hit caps/labels, comeback and rewind rules, heat/boss scaling, the old mortal raid time limit and a recycled collapse target. The full invocation also caught a cooperative tether fixture changing with eager Three.js UUID allocation. After making the marker meshes lazy, `npm test -- coopplayCoop g4nemesis` passed both files on the final source.
- Final managed offline co-op run passed stage transitions, reconnection, party and snapshot checks. Across 1,908 snapshots the mean was 1,813 bytes, maximum 14,162 bytes, with zero over 16 KB. One preceding run reported divergent stage-2 objective props on the host and client. The same harness passed on retry. An earlier run also passed with 1,896 snapshots.
- `npm run smoke` passed. Three-hero local co-op reached 10,267 kills. The mortal smoke case reached MVP and game over after King Bopper's shockwave at 272 simulated seconds, with 7,874 kills and no runtime errors.
