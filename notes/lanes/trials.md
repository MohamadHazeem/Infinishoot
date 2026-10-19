# Trials lane — 2026-10-20

## What players get

MODE > TRIALS opens 24 seeded challenges, grouped by basics, skill, heroes, world, bosses and pairs. The online lobby and pause menu also have an entry. Each card shows its tier, medal and local best; the intro explains the fixed hero/kit, objective, controls and medal targets. Results have a reduced-motion-aware medal animation, the existing achievement sound, immediate RETRY and trial selection. All copy is English/Arabic; Arabic layout was inspected.

Twenty-one trials are solo; three require exactly two heroes (local co-op or an online host plus guest). The host selects/retries. Clients receive the setup before arena creation and mirror the authoritative clock, progress and result; reconnect bootstrap includes the same setup. A third participant or loss of the second hero after the existing reconnect grace period fails a pair attempt.

## Authored scenarios and tuning

All attempts use Normal difficulty, a stable per-ID seed and a named biome. No shops, XP levels, pets, random chests, specials, ultimates, rewind, cash-ins or revives. Dash/parry remain available; the mech retains its normal inability to dash. Weapon ranks are fixed, Tinker starts at level 12 for its bot kit, ordinary heroes at level 1. Hero intrinsic mechanics remain active. Direct weapon damage is suppressed for the environmental challenge; unarmed challenges cannot damage enemies.

Time/damage thresholds are maxima; kills/combo thresholds are minima. Complete the objective before the limit to qualify. Rex is an intentionally binary perfect challenge: completing the entire phase without a hit earns gold; any hit fails. Thus its three displayed damage thresholds coincide at zero.

| ID | Objective | Limit (s) | Medal metric | Bronze / Silver / Gold |
|---|---|---:|---|---|
| buster | Survive with only base Buster | 90 | damage | 90 / 35 / 0 |
| king | Defeat King Bopper | 90 | seconds | 90 / 60 / 40 |
| parry | Reflect 20 actual shots | 120 | seconds | 120 / 80 / 50 |
| gems | Collect 30 of 40 gems in gravity wind | 120 | seconds | 120 / 80 / 50 |
| ronin | 60 sword-kit defeats | 120 | seconds | 120 / 85 / 55 |
| combo | Survive 90 seconds | 90 | best combo | 15 / 35 / 60 |
| rhino | Perfect-dash 10 nearby Rhino charges | 120 | seconds | 120 / 85 / 55 |
| rex | Survive Rex phase 2 with no hit | 60 | damage | 0 / 0 / 0 |
| environment | 20 environmental defeats | 150 | seconds | 150 / 100 / 65 |
| escort | Escort the core | 150 | seconds | 150 / 110 / 75 |
| tinker | 80 bot-kit defeats | 150 | seconds | 150 / 105 / 70 |
| rhythm | 25 perfect-beat attacks | 120 | seconds | 120 / 90 / 60 |
| mech | 150 mech defeats | 90 | seconds | 90 / 65 / 45 |
| puzzle | Walk six numbered pads in order | 120 | seconds | 120 / 75 / 45 |
| rush | King, Rex, Queen | 180 | seconds | 180 / 135 / 95 |
| night | Collect all three stealth caches | 150 | seconds | 150 / 105 / 70 |
| bulwark | Survive 120 seconds | 120 | damage | 100 / 40 / 0 |
| furnace | 100 fire-kit defeats | 120 | seconds | 120 / 90 / 60 |
| queen | Defeat Queen with Ace's fixed kit | 120 | seconds | 120 / 80 / 50 |
| clean | Survive 90 seconds without a hit | 90 | kills | 20 / 45 / 75 |
| dance | 40 perfect-beat attacks | 150 | seconds | 150 / 110 / 80 |
| pair-core | Two-player core escort | 180 | seconds | 180 / 120 / 80 |
| pair-zones | Hold both zones | 120 | team damage | 180 / 70 / 0 |
| pair-rush | Two-player King, Rex, Queen | 180 | seconds | 180 / 135 / 90 |

Enemy batches: two every 0.8 seconds, four for mech, bounded by each definition's alive cap (3–65). Boss base HP multiplier: 4, through normal spawn scaling. Parry training fires one aimed shot every 2 seconds (speed 6, damage 8). Gravity changes direction at 0.45 radians/second with shove strength 24/second. Puzzle order: 1 → 3 → 5 → 2 → 4 → 6; wrong pads reset progress. Pads are seeded, spaced and checked against walls. HUD text updates at 5 Hz.

Tier unlocks require 0 / 6 / 18 / 36 total medal points. Each trial contributes its best medal (1 / 2 / 3), maximum 72. Unlocks can be reached without online play. Each newly attained medal step grants 100 profile XP (300 for first gold, maximum 7,200); faster replays cannot farm XP. Existing profile levels unlock cosmetics. Achievements: first medal and ten different gold medals. Existing achievement bonuses remain managed by the achievement system.

Best records prioritize medal, then its metric, then completion time. Separate normalized storage `infinishoot.trials.v1` avoids a shared save migration. Test links, god mode and save lock mark attempts as practice and bank nothing. Trials bypass ordinary run/quest/high-score banking.

## Integration and files

- New `src/data/trials.ts`: definitions, validation/normalization, medal and progression rules, achievement definitions.
- New `src/game/systems/trials.ts`: isolated lifecycle, seeded setup, authoritative objectives/rewards and client state; wrappers delegate outside trials.
- New `src/ui/trialsScreen.ts`: three screens registered via `screens.addScreen`, menu entry buttons, HUD and module-injected pixel UI CSS.
- New `src/i18n/trials.ts`, additive imports/spreads in `src/i18n/en.ts` and `ar.ts`.
- Additive achievement registry spread in `src/data/meta.ts`.
- Small hooks in `game.ts` (install), `runFlow.ts` and `coop2.ts` (start/reconnect setup), `netHost.ts`/`netClient.ts` (snapshot), `skill.ts` (actual reflected-shot count), `ui/screens.ts` (screen IDs), `dev/testLinks.ts` (QA links).
- New `tests/trials.test.ts`; this handoff and the required PLAN decision log.

Network field is **`trial`**, not `tl` (already the game's time-left field). It uses the existing generic snapshot codec. Fields: ID, attempt serial, elapsed time, progress, damage, result and practice status. Effects use `game.vfx`; no direct client gameplay. No new runtime dependencies, remote services, audio assets or settings.

## Test links and visuals

All links are practice, with normal progression disabled:

- `?test&trialscreen=select` / `?test&lang=ar&trialscreen=select`
- `?test&trial=rex&trialscreen=intro&lang=ar`
- `?test&trial=buster&trialscreen=result`
- `?test&trial=puzzle&god`
- `?test&trial=king`, `?test&trial=parry`, `?test&trial=rhino`, `?test&trial=mech`, `?test&trial=rush`
- Stress: `?test&trial=buster&god&swarm=200&hold=180&bullets=500&bench&clips=off`

Ran the required shot command and inspected PNGs. The software renderer sometimes captured its loading overlay; final screenshots used Playwright/Metal and waited for the actual screen and loading overlay removal. Inspected `shots/trials-select.png`, `trials-select-ar.png`, `trials-intro-ar.png`, `trials-result.png`, `trials-puzzle.png`, plus the two-browser pair result captures. Artifacts stay ignored, not committed.

## Validation

- `npm run typecheck`, `npx vite build`: pass (existing large-chunk build warning).
- `tests/trials.test.ts`: pass. Covers all 24 definitions and bilingual copy, every solo setup, actual parry reflection, damage restrictions, gems, no-hit, healing accounting, ordered/wrong puzzle pads, boss sequence, retry/cleanup, monotonic once-only rewards, host/client start/snapshot/codec/results, result delivery when completion falls between snapshot ticks, and menu entries.
- `npm run smoke`: pass, including every mode/hero, local co-op, race/challenge and mortal run.
- `npm test`: three failing files in the full run. `coopplayCoop` has five bomb pickup/carry/plant/fuse assertions; `raceCoop` has an obsolete PvP fixture missing `pvp.rules.rounds`. Both reproduce on an isolated archive of the untouched parent of the first trials commit. `worldGame` factory arena equality failed once in the full run, then the entire file passed in isolation on both current and untouched source. The same intermittent arena comparison is documented by perf2. These unrelated tests were not weakened or edited.
- General browser co-op: passed with `COOP_TIMEOUT_MS=120000 COOP_LOW=1 npm run coop -- --offline --angle metal --netsim off --out shots/trials-coop-low`, including reconnect, party restart/back-to-lobby and kick. The final repeat (`--out shots/trials-coop-final`) also passed: 1,580 snapshots, average 1,861 bytes, maximum 14,488 bytes. Software-rendered default runs suffered multi-second renderer stalls and failed; Metal avoids that test-machine limitation.
- Two-browser trial probe uses the real lobby menu, starts pair-zones, accelerates the authored objective for transport testing, checks both result cards and RETRY, then reloads/rejoins the guest. Passed after fixing a result-freeze bug: results must keep advancing `stepN` for the existing snapshot cadence. Both result cards were visually inspected. This is network lifecycle coverage, not a claim that a person completed the challenge.
- Active-trial HIGH Metal benchmark: 61.2 fps, 189 enemies + 500 bullets, 734 frames over 12 seconds. Simulation 0.38 ms, total measured frame CPU 1.44 ms average / 1.65 ms p95 / 2.24 ms worst. Command: `npm run bench -- --dev --gpu metal --seconds 12 --warmup 3 --link '?test&trial=buster&god&swarm=200&hold=180&bullets=500&bench&clips=off' --json shots/trials-active-bench.json`.
- Invulnerable auto-aim balance probes: King 19.17 s, Ronin 38.35 s, Tinker 37.40 s, Mech 32.58 s, three-boss Rush 36.86 s, Rhythm 28.23 s. These establish completion and headroom, not human difficulty.

## Remaining risks / integration decisions

- Main-profile export/import/reset does not yet include the independent trial record key (same deliberate schema-isolation approach as Gauntlet). Integrator can migrate it into a consolidated profile schema later; do not silently discard existing records.
- Human balance and controller/WAN feel remain unverified, especially deliberate Rhino-dash/parry positioning, environmental kills, stealth and escort. The generic combat bot kites instead of practicing those actions. The 1–3-minute limits are hard caps; skilled players can clear speed trials in under a minute.
- Client result rewards trust the authoritative host, as other local co-op progression does. They are local achievements, not competitive server-verified records.
- The three outstanding repository unit-test failures prevent claiming a green full-suite gate. Their evidence is above; fixes belong to the owning integration lanes.
