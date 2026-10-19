# Gauntlet lane — 2026-10-19

## What players get

- **Survival Gauntlet** on MODE: one continuous arena, no starting shop, stage shops or portals. Enemy drops are XP only; timed map chests are disabled. Waves scale every 30 combat seconds and add an elite. Mini-bosses warn every 180 seconds; full bosses arrive every 360 seconds, rotating through the registered base boss roster. If a boss is still alive, the next boss queues rather than replacing its reference. Existing boss duels still briefly hold the horde in their final phase.
- Score is `floor(combat seconds × kills)`, without heat, difficulty, combo, or boss-score inflation. A separate local top ten appears in **CHALLENGE RECORDS** and on Gauntlet game over. When built with `VITE_LEADERBOARD_URL`, scores submit to `gauntlet-<difficulty>` and the records screen can browse that board. The worker's existing board allowlist now accepts those ids; deploy that worker change with the optional service.
- **Boss Rush 2.0**: two laps of every registered base boss, currently King / Rex / Queen / Omega / Titan. Future `EnemyDef.boss` entries join automatically; remix variants and Titan body parts do not occupy extra slots. No director horde. Lap two uses the registered remixes and adds a warned bullet ring to every boss, including Omega/Titan. Bonus levels retain the old Rush rule: five initially, three per subsequent boss. The initial loadout shop remains; thereafter a shop appears every second boss, closing automatically after 20 seconds. Timed breaks use normal shops so secret relic choices cannot hide the countdown; pausing freezes it. Odd bosses advance directly after the split card, with no portal. Ten current encounters finish the run. Combat time and the latest split appear in the goals stack; the countdown appears inside the shop screen; all splits from the last run appear in records.
- **Ascension 1–20**: an actual Omega kill in Standard/Endless on Hard or Nightmare unlocks A1. Completing the selected level unlocks the next. Selection applies to Standard/Endless **solo**, forces Hard, and appears in the run label (including history). All earlier modifiers stack. Daily, Weekly, Gauntlet, Rush, PvP and hosted games ignore the saved choice. A5/A10/A15/A20 grant the selectable cosmetic titles Bronze Climber / Sky Climber / Star Climber / Summit Legend, visible in the HUD; TITLE cycles earned titles or turns them off.
- **New Game+**: unlocked by the first normal loop victory; existing `victory` achievements retain access. It keeps the existing profile cosmetics, starts with remixed bosses, adds a boss bonus ring, and multiplies enemy HP ×1.35 and damage ×1.15. It preserves the later-loop Titan rotation.
- **Late-loop mutators**, in Standard and Endless, including host-authoritative standard co-op: loop 5 fast enemies, loop 6 explosive deaths, loop 7 mirror barrage, loop 8 darkness. Further loops add another stack in that order. The stage card and HUD list the active rules. Clients receive the four strengths in snapshot field `gl`; strikes/bullets use the normal authoritative simulation and effect bus.
- Existing recorded `vo_gauntlet` / `vo_ascension` lines are registered with the announcer priority/caption system and requested after combat begins. No audio was downloaded or generated.

## Decisions and tuning

- Timers count **combat simulation time**, excluding upgrade menus, shops, pauses and inter-stage travel. Slow motion slows this clock. Rush splits are combat splits, explicitly labeled that way in the UI.
- Gauntlet target: `min(350, (20 + 12 × wave) × difficulty enemyCount)`, with at most 16 spawns/sec and a four-request budget cap. Wave index is zero-based for this formula. Existing director HP/damage curves advance one effective stage per four waves; content time advances 20 seconds per wave up to 239 seconds. Enemy pools refresh only on wave boundaries; the request array and boss roster are reused. One arena remains loaded throughout.
- Ascension cumulative additions: A1 speed +10%; A2 HP +15%; A3 count +15%; A4 damage +10%; A5 doubled elite modifier effects; A6 map chest cadence ×0.5; A7 extra boss rings; A8 no automatic stage-clear healing; A9 speed +10%; A10 HP +20%; A11 count +20%; A12 damage +15%; A13 chest cadence ×1/3 total; A14 rings grow to 16 bullets; A15 speed +10%; A16 HP +25%; A17 count +25%; A18 damage +20%; A19 chest cadence ×1/6 total; A20 HP +30% and 24-bullet bonus rings. Boss rings have a one-second warning, speed 7, base damage 12, and an eight-second cooldown. Normal boss attacks remain intact.
- Doubled elites: twice the shield, split children, explosion damage, vampire healing/regeneration; half blink cooldown; doubled Fast speed bonus. Shared elite definitions are not mutated.
- Late loops: each Fast stack is +15% movement; Explosive deaths create a radius 2.4, one-second warning blast for 12 damage per stack (maximum 64 pending strikes); Mirror Barrage adds eight bonus boss bullets per stack (combined ring cap 32); Darkness uses a static pixel-framed peripheral mask, with HUD controls above it. Mirror Barrage deliberately uses mirrored attack patterns rather than spawning a second Titan body/controller.
- Knobs are exported as `gauntletTuning` and wired into DEBUG → Gauntlet / Boss Rush. All UI CSS is injected from the lane module; MODE uses a compact three-column layout so its new controls fit at 1280×720. The goals panel inherits UI SCALE. No new dependencies or settings toggles.
- Persistence uses `core/storage.ts`: `infinishoot.gauntlet.profile.v1`, `.scores.v1`, `.splits.v1`. The profile has a strict normalizer; missing/partial profiles start locked and invalid selections clamp. This avoids changing the shared v4 main save shape during parallel builds. **These separate records/progression are local to this browser and are not included in the main save export/import/reset.**

## Files

Core: `src/data/ascension.ts`, additive `src/data/modes.ts`, `src/game/systems/gauntlet.ts`, `tests/gauntlet.test.ts`.

Small integration hooks: `src/game/game.ts` (method adapters, simulation, spawn multipliers, run label); `systems/runFlow.ts` (start/stage/bank/summary); `systems/spawning.ts` (boss selection, elite effects); `systems/statuses.ts` (Gauntlet drops and kill hook); `systems/cinematics.ts` (do not treat challenge boss kills as normal loop endings); `systems/render.ts` (HUD, exact score); `systems/netHost.ts` / `netClient.ts` (`gl`); `src/ui/screens.ts` (MODE controls, extra screen id); `src/ui/debugPanel.ts`; `src/dev/testLinks.ts`; `src/audio/announcer.ts` / `captions.ts`; `server/leaderboard/worker.js` (one regex alternative).

## Test links

- `?test&mode=gauntlet&god&weapons=drones:5`
- `?test&mode=gauntlet&god&gauntlettime=179&bench` — next mini-boss boundary (bench suppresses level-up menus for captures).
- `?test&mode=gauntlet&god&gauntlettime=359&bench` — next full-boss boundary.
- `?test&mode=bossrush&stage=6&god&nointro&bench` — remixed second lap with current five-boss roster.
- `?test&ascension=20&stage=4&bossnow&god&nointro` — cumulative modifiers without changing stored unlocks.
- `?test&ngplus&bossnow&god&nointro`
- `?test&stage=29&god&bench` — all four late-loop mutators.
- `?test&gauntletscreen=modes` / `?test&gauntletscreen=records`.

## Validation

The new real-Game tests cover Gauntlet cadence, XP-only boss drops, continuous arena, exact independent score banking and retry reset; the full current two-lap Rush roster and timed shops; actual Omega unlocks, Ascension combat effects and solo isolation; late-loop snapshots, explosive death gameplay and records navigation. Pure tests cover all 20 cumulative levels, profile normalization, loop boundaries and score math.

- `npm run typecheck` and `npx vite build`: pass (the existing large-chunk warning remains).
- `tests/gauntlet.test.ts`: pass, including repeat-victory title selection, Rush completion history, and visible/ticking/pausable timed shops. Run flow now banks the actual boss count rather than estimating it from the stage number, which matters in a one-stage Gauntlet.
- `npm run smoke`: pass on both runs, including Standard, Endless, Rush, Daily, all hero probes, training, special modes, Versus, local co-op and mortal game-over/history checks. The final run reported no runtime errors.
- Real browser co-op: **pass**, with `COOP_TIMEOUT_MS=120000 COOP_LOAD_TIMEOUT=120000 COOP_LOW=1 COOP_ANGLE=metal npm run coop`. 85.5 seconds, 1,556 snapshots averaging 1,869 bytes, maximum 13,058 bytes; skill effects sent/received match, and finisher/revive/stage transition checks pass. Assertions and the harness are unchanged. SwiftShader attempts could not keep up with page/start deadlines on the shared machine. The first native run hit the existing finisher timing race (the bot had already started it before the forced-kill scenario); the clean final run passed that scenario on both pages.
- Performance: `npm run bench -- --gpu metal --seconds 15 --warmup 4` on the default heavy scene: 259 average enemies / 485 bullets; 0.69 ms simulation, 0.83 ms game render, 0.93 ms GL, **2.46 ms total CPU**, 62.0 fps. Active Gauntlet at 5:00 with the same weapon/hold/bullet stress knobs: 175 average enemies / 500 bullets, 0.57 ms per sim step, **2.34 ms CPU at one step/frame**, 62.7 fps. These are headless native-GPU observations on the shared build machine; the active capture had one 150 ms frame / 78 ms GL outlier.
- Looked at `shots/gauntlet-arena.png`, `gauntlet-modes-static.png`, `gauntlet-modes-compact.png`, `gauntlet-records.png`, `gauntlet-rush.png`, `gauntlet-shop.png`, and `gauntlet-darkness.png`. Fixed the pre-first-tick wave label and compacted MODE so its start/Ascension/NG+ controls fit at 1280×720. The Darkness mask keeps the HUD above it. Standard `npm run shot -- ... --wait 4` was run; under shared SwiftShader load menu captures caught the first animation frame, so the final static menu captures used an untracked copy of the shot harness with Playwright animations disabled. Rush capture skipped its pending starting upgrade picks to expose lap two. No screenshot assets are committed.
- Initial full unit run had one seed-dependent `coop2Coop.test.ts` failure: a joining hero received seven counted ranks against an eight-rank assertion. The exact unchanged test passed on rerun. The clean full rerun passed all **61 test files**. The final shop UI change then passed typecheck, production build and the focused Gauntlet integration suite again.

## Remaining risks

- No human balance or audio audition. Long Gauntlet survival and A20 are intentionally harsh and need playtesting; no claim of hardware 60 fps is based on headless captures.
- Optional remote score service submission needs the updated worker deployed; endpoint calls were not made during implementation.
- The isolated challenge profile export limitation above is deliberate and should be reconciled into a future main-save version by the integration owner.
