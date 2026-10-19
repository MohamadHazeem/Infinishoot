# Raid lane — The Hydra Engine

## What players get

RAID is available on the solo mode screen and the host's online lobby. It supports one to eight human heroes; autonomous cyan helpers fill vacant roles in a crew smaller than four. The lobby transport accepts seven guests while ordinary co-op/PvP still enforce their four-player limit. Drop-in/out uses the existing co-op reconnect system and rescales remaining raid health. The encounter runs only on the host; clients reconstruct the same drydock and receive the dedicated `rd` snapshot field.

The drydock contains a three-headed mechanical engine, a cyan pressure plate, a central brazier, two green energy racks and two blue cannons. The whole objective area fits in the camera frame. A dedicated English/Arabic HUD shows each head, stump deadlines, phase, carried cell/torch and enrage clock. Controls use the player's remapped parry prompt.

- **Furnace:** locks its cone toward the nearest hero/helper, shows a 2.4-second warning, then breathes fire. Bait it away from the other roles.
- **Aegis:** shields the other heads until someone holds the pressure plate or destroys Aegis. Its own head remains shootable.
- **Interceptor:** ordinary shots cannot penetrate its armour. Parry the pink homing missiles; they turn cyan, travel back, and damage it on arrival. The existing host-authoritative parry action is used, including remote input.
- **Stumps:** a severed head has ten seconds to be burned. Fire-tagged damage works; every loadout can instead touch the centre brazier and then the stump. Baited breath also burns stumps. A missed deadline regrows two smaller lobes; a second miss produces four. Lobes share their role's health bank and attack cycle; the geometry and encounter remain bounded at twelve lobes total.
- **Heart core:** after all three stumps are sealed, carry twelve cells to the cannons. Pickup and delivery happen by walking onto the stations. Each rack replenishes every five seconds. Dead heroes drop their carried state, so cells cannot become permanently lost. The reactor continues telegraphing attacks during deliveries.
- **Overdrive:** the heads return at 70% of their original health, attacking 30% faster. Seal all three again to win. At 13 minutes, attacks accelerate to 180% and breath damage rises; at 15 minutes the reactor melts down.
- **Finish:** the existing comic finisher/portrait system, a machinery explosion, Hydra defeat voice, and five-second victory beat precede results. A clear grants the Engine Breakers achievement plus Hydra Armour and Hydra Ember Armour, available through existing cosmetic rewards. No persistent save shape was added: old saves retain their normal achievement/reward lists.
- **Records:** RAID RECORDS on the mode screen stores the ten fastest local clears, with party size/difficulty/date. When the leaderboard service is configured, clear scores use the existing `/scores` endpoint on `raid-<difficulty>` boards; the worker's board allowlist is extended. Score is `round((900 - clearSeconds) * 5)`, minimum one, so the existing server plausibility rules accept zero-kill raid clears. Failed raids do not submit online. No service was deployed or external asset-generation API called.

Audio reuses `amb_raid` as a proper ambience loop with the ambience volume control; `raid_alarm`, `raid_horn`, `roar_hydra`, the three `boss_hydra_*` lines, and `vo_raid`. Dangerous cues also play the existing un-ducked telegraph. Music uses the existing Omega boss arrangement. Finisher portraits use the existing mechanical boss/hero portrait renderer. Motion/flash/finishers, voice, SFX, ambience, music, UI scale, and prompts follow existing preferences.

## Tuning and implementation choices

Tuning is exported from `src/game/raid/encounter.ts`; key knobs are exposed under **Hydra raid** in the debug panel.

| Setting | Value |
| --- | --- |
| Minimum effective crew | 4, filled with helpers |
| Health scale | `1 + 0.7 * (crew - 1)`, crew capped at 8 |
| Head HP | `4400 * healthScale * difficulty.enemyHp` each |
| Medium four-role head HP | 13,640 each |
| Weapon damage | Normal stats/crit pipeline, then ×0.16 |
| Fixed/percentage proxy damage | Capped at 2% of actual head max HP per hit |
| Helper damage / movement | 24 DPS / 7 m/s |
| Parry return | `260 * healthScale` damage; projectile returns at 10 m/s |
| Outbound missile | 5 m/s; pooled cap 24; homing target, 10-second lifetime |
| Volley / breath cycle | 8 / 9 seconds before phase/enrage acceleration |
| Fire warning / active | 2.4 / 2.1 seconds; 24 m reach |
| Fire damage | 18 / 30 / 48 per second in normal / overdrive / enrage |
| Plate / brazier / stump reach | 2.4 / 1.8 / 2.8 m |
| Torch duration | 14 seconds |
| Failed stump recovery | 45% original HP; 2 then 4 smaller lobes |
| Core / cannon | 6000 / 500 × healthScale; exactly 12 deliveries |
| Rack cooldown | 5 seconds per rack |
| Enrage / meltdown | 780 / 900 seconds |

The raid bypasses the survival director, ordinary boss flow, random stage objectives, chest spawns, seasonal encounters, ascension and heat. It keeps player weapons, specials, pets, co-op revives, role bonuses and existing menu/input behavior. Cells are self-contained because the existing optional stage-objective system is a different objective model. The lane adds no runtime dependencies.

Gameplay state uses fixed arrays of three heads, eight actors and 24 missiles. Geometry is built once; static arena/part geometry is merged by material. Missiles use an InstancedMesh with live-slot uploads. Gameplay never depends on render timing. Proxy enemies route weapon damage after the normal stats/crit calculation without entering ordinary enemy death/drop logic. Proxy health cannot inflate percentage-damage attacks.

## Test links

- `?test&mode=raid&god&day&dry` — initial three heads and role helpers.
- `?test&mode=raid&god&raidfire` — cone telegraph.
- `?test&mode=raid&god&raidstump` — ten-second stump deadline.
- `?test&mode=raid&god&raidregrow` — smaller replacement heads.
- `?test&mode=raid&god&raidphase=core` — heart and cell deliveries.
- `?test&mode=raid&god&raidphase=overdrive` — final phase.
- Add `&lang=ar` for Arabic/RTL.
- `npm run coop -- --raid` — normal browser co-op coverage followed by raid start/arena, carried cell, core, overdrive and finisher snapshot checks.

Visuals inspected at 1280×720: `shots/raid-heads.png`, `raid-core.png`, `raid-ar.png`, `raid-modes-ar.png`, `raid-modes-footer-ar.png`, `raid-records-ar.png`. The records footer scrolls into view and opens the translated records screen. The screenshot command was exercised; final QA also waits for the game clock before capturing, because this shared build machine can remain on the loading screen after the ordinary four-second delay.

## Validation

- Dedicated `tests/raid.test.ts`: deterministic roles, shielding, reflected missile travel/hit, brazier fallback, stump deadline/regrowth/sealing, core pickup/delivery, meltdown, full bot clears at 1/2/4/8 humans, real solo autoplay with three helpers and no god mode, eight-slot host/client start and actual snapshot codec, client authority boundary, phase deltas, dropout scaling, percentage-damage guard, completion ordering, both cosmetics/achievement, old-save normalization, local records and in-memory worker POST/GET.
- Medium role simulation: 633.0 s with four actors, 584.3 s with eight. Actual default Buster/Charge solo autopilot plus three helpers: 598.83 s on the final run (about 599–605 s across reruns), no god mode, no damage taken. The test asserts the real clear remains within 480–720 seconds.
- Stress benchmark (`npm run bench`, native Metal, HIGH 360p, 1280×720, 8 s after 2 s warm-up): raid 1.96 ms average CPU, 2.40 ms p95, 0.51 ms simulation, 60 fps, 161 average / 209 peak enemies, 485 average / 501 peak bullets, 139 average draw calls. Standard heavy baseline: 2.67 ms average CPU, 3.66 ms p95, 0.89 ms simulation, 60 fps. Arenas/populations differ; this establishes performance headroom rather than an isolated microbenchmark.
- Passed `npm run typecheck`, `npx vite build`, `npm test` (all 72 files), `npm run smoke`, and the final dedicated raid test including ultimate-charge regression coverage. Production build retains the existing large-chunk advisory. Browser co-op passed with `COOP_LOW=1 COOP_ANGLE=metal COOP_TIMEOUT_MS=120000 npm run coop -- --raid`: ordinary scenarios plus raid start/carry/phases/finisher, party restart, return to lobby and kick. The final run sent 1,688 snapshots averaging 2,012 B (maximum 14,288 B), with no page errors or sustained desync. Earlier SwiftShader runs on the shared machine hit timing failures; native Metal passed after the two harness fixes described below.

## Files / integration points

New lane files: `src/game/raid/{encounter,arena,defs,ui,testLinks}.ts`, `src/game/systems/raid.ts`, `tests/raid.test.ts`, this note.

Small shared hooks: `game.ts` (methods, simulation gate), `systems/{runFlow,combat,netHost,netClient,render,online,coop2,party,meta,gauntlet,sound}.ts`, `autopilot.ts`, `data/{modes,enemies,meta,codex}.ts`, `ui/{screens,coopHud,debugPanel}.ts`, `dev/testLinks.ts`, both i18n catalogs, `audio/{ambienceAudio,announcer,captions,sfx,voiceText}.ts`, and the leaderboard worker's existing board regex. These are needed for mode selection, eight-player bounds, persistence recognition, captions, settings, and existing lifecycle/snapshot integration; no shared file was reformatted. `scripts/coop-test.mjs` gets an opt-in raid scenario disables HMR so development reloads cannot invalidate running page handles, corrects the existing party MVP helper from `p.evaluate` to `p.page.evaluate`, and preserves saved settings when applying the low-quality test override on invite reload (previously the client pet became `none`).

## Limits / integration risks

- Regrown lobes share each role's health and attack cycle, capped at four per role. This avoids unbounded objects and damage density after repeated missed burns.
- Helpers are untargetable support actors, not full network Hero instances. They hold plates, bait, parry, seal and carry; they do not consume revive lives or provide extra loadouts. Their strength is included in the minimum four-role health scale.
- Difficulty and player count are recorded locally; the optional online board separates difficulty but combines party sizes. It is the existing client-submitted board, not a trusted server simulation.
- The Omega arrangement and existing mechanical portrait art are reused; there is no newly recorded music or bespoke three-headed portrait asset.
- Rewind does not rewind raid objective progress; the raid clock remains authoritative. This prevents duplicated cells/cannon deliveries.
- Eight-player state/capacity is covered in-process through the actual snapshot codec; real browser transport coverage uses two connected pages, not eight physical machines.
- Bot tuning was exercised on Medium/default kit; Hard/Nightmare and unusual hero/loadout combinations still need human balance feedback.
- Shared integration edits should be merged additively with other lanes. In particular keep `start`'s `runMode`, the `rd` field, eight-player capacity guards, and the meta snapshot's preservation of raid mode together; otherwise clients could construct an ordinary field arena.
