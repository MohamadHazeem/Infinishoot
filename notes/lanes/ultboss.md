# ultboss — The Architect

## What players get

After the actual Omega kill on stage 12, STANDARD and ENDLESS runs enter a final encounter instead of opening another shop/loop. Stages 4/8, Boss Rush, Gauntlet, weekly/daily, raid and PvP keep their existing flow. Omega must have been observed alive; skipping an empty stage cannot trigger it.

- **Rewrite the World:** 81 floating tiles, two alternating missing-floor layouts, an always-connected blue cross, airborne walls that relocate between patterns, gold warnings, locked aim lanes and slams. Falling damages the hero and returns them to the cross.
- **Echoes of the Overlord:** cyan King/Rex/Queen/Glitch holograms combine two signature attacks: double slam, charge lane, temporary stinger hives and beat laser grid.
- **The First Machine:** enlarged geometric body, three orbiting target proxies, exactly one exposed core at a time, rotating bullet fans with a 60° safe wedge. Breaking all cores exposes the heart. At 10%, four warned expanding rings require dash/parry evasion; the ordinary per-hit cap and defensive mechanics still apply.
- The existing comic finisher uses a unique Architect portrait. Three new EN/AR story frames follow, with `story_ending` and `story_credits` narration on the existing voice bus. Cinematics OFF goes straight to the final card; SHORT shortens the minimum page time, while narration can finish. Menu navigation, back, prompts, UI scaling and live language switching work.
- `true_ending` (**Unwritten Future**) grants free **Blueprint Armour**, a codex entry and a story chapter. Uses existing achievement/reward/discovery fields: no save version change. Test links do not grant these rewards.
- New 180 BPM **The Architect · Unwritten Future** arrangement develops Omega's theme with the densest boss instrumentation. Local offline audio measurement gave −25.3 LUFS / −12.1 dBTP at raw gain 1; correction 0.73282 targets −28 LUFS.

## Rules and tuning

`src/game/architect/model.ts` contains tuning; nine primary controls are exposed in the debug panel.

| Setting | Value |
| --- | --- |
| Solo normal HP | 450,000 |
| Team scaling | `1 + 0.65 × (players − 1)`, clamped to 1–8, fixed at arrival |
| Eight-player normal HP | 2,497,500 |
| Phase gates | 66%, 33%; overkill discarded |
| Each core | 7.5% of boss maximum; three cores leave 10.5% body HP |
| Final damage gate | 10%; immune until all four pulses finish |
| Entrance / transition | 3 s / 2 s |
| Floor warning / pattern cycle | 1.6 s / 8 s |
| Echo / true-form cycle | 6.5 s |
| Floor grid / arena | 9×9 tiles, 4 m pitch, 36 m square |
| Orbit | 5.8 m radius, 0.16 rad/s |
| Bullet speed / damage | 6 m/s (6.6 in phase 3) / 14 before difficulty |
| True-form bullet period | 1.25 s |
| Hazard / fall damage | 25 / 18 before difficulty and normal mitigation |
| Final pulses | 2.8 s initial warning, 0.85 s apart, 16 m/s |

The host owns HP, phases, cores, hazards, hit masks, floor damage, ending and rewards. One snapshot field, `ac`, carries the bounded encounter state; stamped landing revisions correct client-controlled heroes after host-judged falls. Clients predict bounds/walls and render the same field. Existing effects carry audio, banners and portraits. The arena's original arrays, group visibility and camera projection are restored on reset. Rendering uses instanced floor/wall/warning pools; no new per-frame collections in the lane's simulation/view loops.

## Verification

- PASS: `npm run typecheck`, `npx vite build` (existing large-chunk advisory only).
- PASS: `tests/ultboss.test.ts`: eligibility, 1–8 health scaling, floor connectivity, warning geometry, real Omega handoff, damage gates, sealed cores, ordered destruction, real host/client snapshot, host-authoritative landing correction, finisher hold, exactly-once completion, actual persistent rewards, EN/AR codex/ending, reset, 2/8 simultaneous hero parries, lethal undefended finale and full bot clear.
- Fixed seed 42, Rookie, level 40, Scatter/Grenade/Storm, drones/missiles/lightning/fire level 6, no passives: **152.8 seconds** through all phases. God mode disables incoming damage only; normal weapons/aim/controls deal all damage. Both game RNG and the existing weapons' ambient `Math.random` are seeded in the regression test.
- PASS: `npm run smoke`.
- PASS: `npm run coop` including reconnect, party restart, lobby and kick.
- PASS: `COOP_LOW=1 npm run coop -- --offline --only architect --architect --secs 22 --angle metal --out shots/ultboss-coop`. Real WebRTC with the harness's 70±30 ms/2% loss simulation: arrival, host floor rescue, all phases, all cores, desperation, client ending and party reset. Offline only replaces signalling. Largest snapshot in the final targeted run: 2,372 bytes.
- Performance: `npm run bench -- --dev --gpu metal --seconds 8 --warmup 2 --quality high --link '?test&bench&architect&architectphase=3&god&circle&hold=170&bullets=500&season=off' --json shots/ultboss-bench-high.json`: **61.4 fps**, 174 enemies, 485 average / 505 peak bullets, **1.52 ms frame CPU**, **2.13 ms including async clip callbacks**, 60 average draw calls. Low quality: 61.3 fps / 1.29 ms (earlier framing revision).
- Looked at screenshots of every phase, the final pulse, and English/Arabic endings. Adjusted camera projection to keep the complete platform inside the HUD, brightened the body against the floor and kept non-collapsing tiles grounded so warnings remain visible.

### Repository test blockers

Final `npm test`: **3 failing files**, all reproduced on the baseline. Untouched `5071377` was exported to `/tmp/infinishoot-ultboss-baseline`; its tests were bundled independently and reproduced these failures:

- `eightp.test.ts`: existing harness attempts to set `lastHeard` on null.
- `i18n.test.ts`: untranslated existing weekly description, “A shared UTC ISO-week seed, two wild rules, fixed Rookie kit. Your own weekly score table.” New Architect copy passes its own translation checks.
- `raceCoop.test.ts`: old four-player-cap assertions conflict with existing eight-player support.

The first whole-suite run also hit `worldGame.test.ts` (Toy Factory arena equality, reproduced on the untouched baseline) and the randomized `secrets.test.ts` walkable-footprint failure. Both passed in the second full run; the isolated baseline also passed the secret-footprint test. These unrelated files were left to their owning lanes.

## QA links and artifacts

Prefix with the local Vite URL:

- `?test&architect&god&season=off` — full encounter, normal controls.
- `?test&architect&architectphase=2&god` / `architectphase=3` — direct phases.
- `?test&architect&architectphase=3&architectpulse&god` — final pulse.
- `?test&architect&architectending` / append `&lang=ar` — ending preview.
- Append `&architectshot` for a paused composed warning frame. `architectecho=2` selects Queen/Glitch; default is King/Rex. This QA-only pose suppresses unrelated toast/portrait overlays.

Screenshots (ignored per CONTRIBUTING): `shots/ultboss-phase1.png`, `ultboss-phase2.png`, `ultboss-phase3.png`, `ultboss-pulse.png`, `ultboss-ending-en.png`, `ultboss-ending-ar.png`, `ultboss-story-{1,2,3}.png`. Standard command: `npm run shot -- '<link>&quality=low&season=off' shots/<name>.png --wait 6` (7 seconds was needed for cold Arabic startup). Co-op artifacts: `shots/ultboss-coop/`; benchmark JSONs: `shots/ultboss-bench*.json`.

## Files and integration points

- New: `src/game/architect/{model,defs,strings,view,ui}.ts`, `src/game/systems/architect.ts`, `tests/ultboss.test.ts`, this note.
- Additive content: `src/data/{enemies,meta,codex}.ts`, `src/game/story/strings.ts`, `src/i18n/{en,ar}.ts`, `src/audio/music/composition.ts`, `src/audio/loudness.ts`.
- Small hooks: `src/game/game.ts` (stage-clear delegate, simulation, ending step), `src/game/autopilot.ts`, `src/game/systems/{combat,bossFight,bossLane,characters,runFlow,netHost,netClient,render}.ts`, `src/dev/testLinks.ts`, `src/ui/{screens,hudLayout,portraitArt,debugPanel}.ts`, optional scenario in `scripts/coop-test.mjs`, PLAN decision entry. No shared stylesheet, new dependency, audio asset, environment file or save-schema edit.

## Limits / remaining risk

The encounter is complete. Real network coverage uses two browsers; eight heroes are exercised in-process, not eight simultaneous WebRTC tabs. Difficulty and human survival tuning still need playtesting, especially defensive builds and weak stage-12 kits. A true ending intentionally terminates STANDARD/ENDLESS at the third Omega; there is no fourth loop after victory. Echo hives are temporary attack emitters, not loot-bearing enemy summons. The story chapter can be replayed in STORY; the special three-frame ending currently has only the direct QA replay link. The inherited full-suite failures above prevent an all-green repository gate.
