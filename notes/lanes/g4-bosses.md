# Gate 4 · Boss choreography

## What players learn

Each of the four bosses opens every phase with a counter the whole team can solve. The following moves repeat in order, so the opening tells the player what comes next. Ground marks show the target or safe route. A short instruction lives under the boss health bar. The full-screen act title appears during the phase-change roar.

| Boss | Counter | Other moves to learn | Third act |
| --- | --- | --- | --- |
| King Bopper | Step on the blue crown plate. Either teammate can trip it. | Read the gap between rings, follow the locked slam marker and dash through the landing wave. | **The Falling Crown** chains three hops, double rings and guards. Missing the plate marks three staggered strikes. |
| Rampage Rex | Lure Rex through the blue post. When the lane locks, step sideways. | Read the straight charge, the figure-eight tracks and the gap in the waves. | **Runaway Furnace** opens the follow-up with sweeping breath, then gap waves. Watch for burning tracks after the rush. |
| Hive Queen | Cross the middle of the gold tether or destroy its marked hive. | Weave through aimed fans, move between rain markers and prioritise hives that hatch swarmers. | **The Last Hatch** alternates walls with one opening, fans and rain. An unresolved tether calls a warned wall. |
| Omega Overlord | Make space, then stand still through the closing ring's last beat. One eligible survivor is enough. | Thread staggered rings, evade the locked charge and weave between counter-rotating spirals. | **Zero Motion** mixes the spiral and triple slam with another scan. A failed last-phase scan marks a cross of delayed impacts. |

A counter lasts 3.2 s in the first two phases and 2.8 s in the last. Plate and post radius is 1.55 m. Rex gives 0.85 s of locked direction before a 0.5 s rush at 24 m/s. Omega samples the last 0.45 s continuously. Each success opens a 2.4 s attack window and costs the boss 22% of maximum health, rising to 28% in phase three. Recoil passes through the existing damage and phase gates. A threshold crossing starts the next roar. Missing a counter leaves an escape path. If an accessible placement cannot be found, the rotation advances. Each final act has a different three-note phrase, 0.48 s between notes, sounded over the existing phase music.

The Prince marks two dotted firing lanes with a safe centre, then marks and fires down the centre on the next turn. His second phase adds a slower echo. Rex Jr. flanks, marks a lane and charges. In phase two he gives a separate warning before retracing that lane. The Hive Princess places three timed petals around a safe centre. In phase two the centre blooms last. The existing normal roster schedules the Prince on stage 2 and Rex Jr. on stages 3 and 4. The Hive Princess can be played with the link below. Roster selection lives outside this lane.

## Difficulty measurements

The normal-loop sample uses the stock Gate 2 mortal pilot, Normal Rookie, no pet, seasons off and seeds 1–5. Baseline used the unmodified worktree at `684fa1f`. Every seed finished. Run the full loop with `npm run skillbot -- --runs 5 --difficulty normal --seed 1 --jsdom`. The CLI wrote its report in a temporary checkout pointing at this worktree to preserve the historical report.

| Normal loop | Cleared S1 / S2 / S3 / S4 | Loop clears | Mean game seconds | Median stage |
| --- | --- | --- | ---: | ---: |
| Before | 100% / 80% / 80% / 60% | 3/5 (60%) | 889.2 | 4 |
| After | 100% / 100% / 80% / 40% | 2/5 (40%) | 889.9 | 4 |

Before, seeds 1, 2 and 3 cleared. After, seeds 2 and 3 cleared. One run ended at the Golden King rematch and two ended in lava. Both loop estimates fall inside the 40–60% target. One seed changes this estimate by 20 percentage points.

In ordinary runs the equipped survivors killed all four named bosses they reached. Before the change, wins per encounter were King 5/5, Rex 4/4, Queen 4/4 and Omega 3/3. Afterward they were 5/5, 5/5, 4/4 and 2/2. Median kill times in seconds went from 15.54 to 13.28 for King, 15.27 to 14.60 for Rex, 10.32 to 13.31 for Queen and 18.48 to 39.45 for Omega. The under-50% first-try result below applies to the fixed-kit drill.

### Isolated first encounters and practice

The separate encounter drill gives a fresh Rookie the starter kit and Drones at levels 3, 4, 5 and 6 respectively for stages 1–4. The ambient director is held and XP upgrades are disabled. Boss health, biome hazards, boss summons, the duel boundary and damage use the actual game. Each cell is five new processes on the same seeds, with an upper bound of 180 simulated seconds. This isolates the effect of input knowledge from gear and survivor selection. The regular loop above allows the entire upgrade draft.

| Wins per five seeds | Before, first try | After, first try | Practice 1 | Practice 2 | Practice 3 | Practice 4 | Practice 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| King Bopper | 0 | 0 | 1 | 5 | 5 | 5 | 4 |
| Rampage Rex | 0 | 0 | 0 | 0 | 4 | 3 | 4 |
| Hive Queen | 0 | 0 | 3 | 4 | 5 | 5 | 5 |
| Omega Overlord | 0 | 0 | 3 | 2 | 3 | 3 | 4 |

The first column of post-change trials uses `window.skillRun` without coaching. Practice 1 responds late to the boss-specific cue. Practice 2 recognises its opening. Practice 3 adds routes around fire and the arena edge. Practice 4 aims at the visible weak point. Practice 5 also evades follow-ups and gives Omega space before the stop. Coaching drives virtual controls at 10 Hz, with eleven frames of input delay and the usual four-degree aim error. Every post-change trial ended in an actual death or kill. The baseline includes one capped Queen attempt, counted as a loss. Results rise from 0% to 80–100% by the fifth practice. Individual steps fluctuate. These are five-seed measurements of a simulated learning curve. Human first-try win rates remain unmeasured.

After `npm test -- g4bosses`, this command reproduces the fifth Omega practice on seed 1.

```sh
G4_BOSS=omega G4_SEED=1 G4_PRACTICE=5 node node_modules/.tests/g4bosses.test.mjs
```

Use `king`, `rex`, `queen` or `omega`, seeds 1–5 and practice levels 0–5.

## Co-op and implementation

The host evaluates the counters during the normal enemy update. Move and phase use appended identifiers in the existing `bx` boss record. The ordinary enemy record carries target, facing, state and time. A joining client can draw the current mark from one snapshot. The effects bus delivers the title, sound, ring and feedback. Each local co-op hero gets an Omega ring. Host credit goes to the teammate who tripped the counter where the mechanic identifies them. The mesh reuses 160 instanced tiles. No extra snapshot field or persistent store is needed.

| File | Change |
| --- | --- |
| `src/game/bosses.ts` | Phase rotations, appended move identifiers and dispatch into the counter and mini brains. |
| `src/game/bossesActs.ts` | Counter resolution, placement, music, HUD instruction and instanced telegraphs. |
| `src/game/bossesMinis.ts` | Three independent mini-boss move sets. |
| `src/game/game.ts` (shared) | One import and a five-line constructor addition to attach the counter system and draw its marks. |
| `src/i18n/arabic2.ts` and `src/i18n/ar.ts` (shared) | Ten added keys per catalog for the hints, act names and team feedback. The other five languages inherit English. |
| `tests/g4bosses.test.ts` | Rotation order, phase thresholds, snapshot reconstruction, co-op credit, scan timing, hive binding, music, captions, phase-two mini follow-ups and opt-in mortal practice fixture. |
| `notes/lanes/g4-bosses.md` | Tuning, measurements and reproduction details. |

## Browser checks and test links

Use these links on the local Vite server. Add `&lang=ar` for Arabic. For an opening move in phase one, omit `&phase=3`.

| Encounter | Query |
| --- | --- |
| King Bopper | `?test&stage=1&bossnow&phase=3&nointro&god&seed=7&season=off` |
| Rampage Rex | `?test&stage=2&bossnow&phase=3&nointro&god&seed=7&season=off` |
| Hive Queen | `?test&stage=3&bossnow&phase=3&nointro&god&seed=7&season=off` |
| Omega Overlord | `?test&stage=4&bossnow&phase=3&nointro&god&seed=7&season=off` |
| Prince, Rex Jr. | `?test&stage=2&miniboss&god&seed=7&season=off` or switch to stage 3. |
| Hive Princess | `?test&stage=3&hold=1:princess&god&nolevel&seed=7&season=off` |

Inspected all four bosses in English and Arabic at 1280×720 and 1920×1080 on the production preview. Captured all four final-act banners and all three mini tells. The 23 local PNGs are under `shots/g4-bosses-*.png`. A 12-second medium-quality stress sample delivered 720 frames at 59.99 fps, p95 frame interval 16.7 ms and p95 measured CPU work 3.0 ms, with medians of 225 enemies and 920 projectiles. The sample used `?test&stage=2&bossnow&nointro&seed=7&season=off&god&nolevel&hold=80:shooter,90:charger,40:spinner&bullets=550&quality=medium`.


## Validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. Vite reported its bundle-size warning. |
| `npm run smoke` | Passed. All modes and the mortal/death path completed without a runtime error. |
| `npm test` | Passed, 140 files. The final full run retried `heroes3.test.ts` in isolation and passed. The focused `npm test -- g4bosses` also passed. |
| `npm run skillbot -- --runs 5 --difficulty normal --seed 1 --jsdom` | Passed twice on the changed game with identical outcomes. |
| `npm run coop -- --offline` | The shell-launched Chromium process could not register a Mach port in the macOS sandbox. The same offline script assertions passed in managed headless Playwright with two isolated contexts, low graphics and a longer page timeout. In 94.8 s it covered objectives, rejoin and party return. The transport delivered 1,905 snapshots averaging 1,971 bytes with two over 16 KiB, both chunked. |
| Two-peer boss-specific check | Passed on a real WebRTC data channel with offline signalling and simulated latency/jitter/loss. The Arabic client received all four correct move IDs, localized instructions and target coordinates within 0.08 m of the host. The remote teammate triggered King's plate, the host credited the recoil to them and the client cleared the completed tell. |
| `npm run balance` | Same shell launcher restriction. The original four weapon-kit comparisons using the managed browser and `botRun(s, true)` passed all 32 reference metrics at the existing 25% tolerance. Cumulative stage-two kills were 14,578 (Buster), 13,738 (Laser), 13,067 (Scatter) and 13,195 (Rail). |
| `npm run shot` | Same shell launcher restriction. Captured and inspected the screenshots with managed headless Playwright. |

A repeat of the suite intermittently failed the title-demo save assertion in `worldGame.test.ts`. A diagnostic run with the original revision’s lane files reproduced the mutation of the in-memory `save.tips` array when the demo discovered movement or perfect-dash tips. The measured local-storage contents stayed identical.
