# aisquad — offline AI teammates

## What players get

MODE has **SQUAD: 0–3 BOTS**, followed by a hero selector for each enabled slot. Each selector cycles RANDOM and the profile's unlocked heroes. The selection persists in settings; the default is zero. Squads are available in Standard, Endless and Boss Rush. Daily, Weekly, Gauntlet and Raid retain their authored challenge rules.

Bots are real Heroes on the existing local-authority co-op simulation path (`role: solo`, like localCoop), with no Host, Client, peer id or signalling connection. The normal co-op enemy scaling, shared XP, proximity revives, team auras, role bonuses, owned boss chests, individual wallets and build limits apply. The player's camera and input stay on hero 0.

- Follow a loose formation, spread out, hold a location or focus the boss. Hold the existing ping action and change to the third wheel page, **SQUAD ORDERS**. Four slices: FOLLOW / SPREAD OUT / HOLD HERE / FOCUS BOSS. The normal pings and emotes retain their six slices and online behavior.
- Fight with both clicks, dodge enemies, projectiles and ground telegraphs, dash/parry, spend specials and ultimates, join a human ultimate, and use a charged team move.
- The nearest available rescuer approaches and stays by a downed teammate, including the human. Revives use the existing co-op timer and rewards; bots have no instant-rescue cheat.
- Help on nearby switches/zones and escorts; collect and plant the objective bomb using ordinary proximity rules. Carrying the objective bomb retains its normal movement penalty.
- Go/help/chest pings temporarily redirect them; danger pings repel them. Revives and imminent hazards take precedence. Explicit boss focus skips incidental objectives/loot, except finishing a carried bomb delivery.
- Chase nearby useful loot, yield unowned loot to closer teammates and hearts to an injured human, ignore full gear stacks, and never chase another hero's owned boss chest. The existing pickup ownership filter remains the final authority.
- Auto-pick level-ups using stable hero/role preferences: evolutions/fusions, loadout tracks and matching evolution partners; tanks favor armor/life, medics team support, damage heroes damage, supports speed/cooldown. Bots buy useful affordable non-cursed Mods, heal when hurt, upgrade owned Mods and take free relics with their own gold. They follow the human's route/encounter vote and agree to a team rewind.
- Teammate bars and nameplates carry localized BOT prefixes. A small SQUAD/order/ping-prompt line lives inside the existing UI-scaled goals stack. New labels have English and Arabic entries; CSS is injected by the lane module.

`game.squadRun`, the `SQUAD` history/score label and optional `RunSummary.squad` mark the run. Real-player co-op run/stage/revive counters and trading/co-op titles exclude squads. Squad runs do not submit to global or weekly team boards. Ordinary personal progression and locally labeled scores remain available. No save-format bump is needed: settings merge new defaults and existing history accepts the label.

## Tuning

`src/game/aisquadBrain.ts` exports `squadTuning`; common knobs are exposed in Debug > AI squad.

| Knob | Default |
| --- | --- |
| Sensing | Every 6 fixed steps, staggered by hero (10 Hz per bot) |
| Formation radius | 3.5 m follow, 7 m spread |
| Loot leash from human | 9 m |
| Loot search radius | 7 m |
| Go/danger ping lifetime | 8 s |
| Danger-ping avoidance radius | 6 m |
| Stuck detection | 1.2 s, then alternating tangent detours |
| Objective assistance | Human within 22 m of objective origin, or bot carrying bomb |
| Boss orbit | 8 m, boss within 22 m of human |
| Heal in shop | Below 65% HP |
| Right-click rhythm | 1.4 s hold / 0.2 s release |
| Team move fallback | Every 2 s when aiming at an enemy; normal meter/nearby-team checks |

Movement uses the real Player physics, colliders, ground effects and ordinary dash/ability methods. Intents, input vectors and navigation points are reused; sensing is throttled rather than running another whole enemy/projectile scan for every bot at 60 Hz. Existing Autopilot supplies combat decisions; the squad layer changes movement priorities. Gameplay is in update/simulate, not render.

## Files and merge points

New: `src/game/aisquadBrain.ts`, `src/game/systems/aisquad.ts`, `tests/aisquad.test.ts`, this note.

Small shared edits:

- `game.ts`: import, squad marker/start/reset fields, update/menu hook, one movement branch, run label.
- `systems/runFlow.ts`: start/leave/quit cleanup, summary marker and board exclusion.
- `settings.ts`: `squadBots: 0`, `squadHeroes: 'random,random,random'`.
- `screens.ts`: mode-row render hook and optional summary field. No new screen, no change to other screen registration.
- `teamPlay.ts`, `ui/pingWheel.ts`: optional third page, variable slice count (default remains six), release dispatch.
- `systems/render.ts`: notify squad of a validated local human ping.
- `systems/meta2.ts`, `systems/trading.ts`, `systems/mp.ts`: real-co-op achievement/board guards.
- `ui/debugPanel.ts`: tuning folder (aliased import avoids the existing enemy `squadTuning`).
- `i18n/en.ts`, `i18n/ar.ts`: matching squad keys. Also translated the pre-existing literal UTC in the Arabic Weekly description; it failed the existing no-untranslated-copy test.
- `dev/testLinks.ts`: `squad`, `squadheroes`, `squadwheel`.
- `scripts/coop-test.mjs`: stationary co-op scenarios release the dev bot's held inputs/focused strike when stopping it. Trade assertions temporarily suspend unrelated pickup collection. These repair observed fixture races without changing assertion criteria or game/network behavior.

No network codec/snapshot changes, new dependencies, recorded audio, environment files or shared gameplay reformatting.

## Test links and visual checks

- `?test&squad=3&squadheroes=rookie,bulwark,ace&stage=2&god&weapons=drones:5` — four heroes, BOT bars and squad HUD.
- `?test&squad=3&squadwheel&god&quality=low&season=none` — English order wheel.
- `?test&squad=3&squadwheel&god&lang=ar` — Arabic order wheel.
- `?test&squad=3&screen=modes` — configuration; `&lang=ar` for Arabic.
- `?test&squad=3&coopobj=bomb&god` — co-op objective with live bots.

Inspected `shots/aisquad-fight.png`, `aisquad-modes.png`, `aisquad-modes-ar.png`, `aisquad-orders.png`, `aisquad-orders-ar.png`. First two 4-second captures were still loading under concurrent validation; recaptured with a 10-second wait. Arabic mode screen also checked at 1280×960. The existing full MODE page scrolls at 720px height; the squad row wraps normally. Screenshots and bench JSON are ignored, not committed.

## Validation

- Typecheck and production Vite build: pass.
- `tests/aisquad.test.ts`: decision rules plus real-game checks for four peerless heroes, co-op scaling/XP, separate menus/wallets, ownership, orders/pings, real proximity revival, specials/ultimate/team meter, charge cadence, objective pads/bomb planting, achievement exclusion, quit/reset and a dev-bot + three-bot smoke run. The 360-second run reached stage 2 / level 27 / 14,961 kills, checking progression through boss/shop/route; all focused assertions passed.
- `npm run smoke`: pass across the existing solo, local-co-op, modes, race, training and mortal-run cases.
- Final browser co-op: **pass** with `COOP_LOW=1 COOP_TIMEOUT_MS=120000 COOP_ANGLE=metal npm run coop`, default 70 ms / 30 ms jitter / 2% loss simulation. Carry, turret, trading, reconnect and party restart/lobby/kick checks passed; no page errors or lasting desync. Vault/route scenarios were phase-skipped on this final browser run; they passed on the earlier browser runs and are also covered by in-process co-op tests.
- **Full unit gate remains blocked:** the final `npm test` run passed **96/97 test files**; only `worldGame.test.ts` failed its stage-6 host/client Toy Factory arena-signature assertion. The same failure reproduced on untouched pre-squad commit `a604aa4`, and another baseline run passed, confirming a pre-existing intermittent failure. All squad assertions passed on every run. Final log: `/tmp/aisquad-unit-complete.log`; baseline reproduction: `/tmp/aisquad-baseline-world.log`. No unit-test assertions were weakened or skipped. Repeated full-suite retries do not resolve this upstream issue; the lead should track it when integrating.
- Localization test: pass, 4096 matching keys, placeholders/content/RTL/switching/scanner.
- Production HIGH, 1280×720, native Metal, 10 s after 3 s warm-up: solo heavy baseline 62.2 fps, simulation **0.82 ms** average / **1.55 ms** p95; squad 62.0 fps, simulation **1.13 ms** average / **1.97 ms** p95. Squad averaged **380 enemies / 511 projectiles** (max 446 / 549). Whole frame callback CPU was 3.81 ms versus 2.81 ms solo; GL, UI and clip-capture costs are included separately in the benchmark. No 60-fps regression in this capture.

## Decisions / remaining risks

- This is deliberately offline solo + bots, not mixed online/pad/bot parties. `role: solo` means this machine is authoritative and can pause normally; starting a PeerJS host would violate the offline requirement.
- The three authored challenge modes and Raid do not accept this squad configuration. They retain their existing special party/score rules.
- Local obstacle avoidance is heuristic, not a navmesh. Bots can hesitate around dense cover or complicated island routes. They never teleport through walls or skip revive timers. Long human playtesting of pathfinding/build feel remains advisable.
- Bots use unlocked heroes, default loadouts (with the hero's signature replacements), and existing abilities. Random picks are resolved once at run creation. They do not independently redesign loadouts or gamble in shared shop pools.
- One full unit rerun hit the existing secret-room QA footprint flake (`tests/secrets.test.ts` sets `A.seed = 42` before `startRun()` replaces it). Its isolated rerun passed; that other lane's file is unchanged. Another concurrent rerun hit the existing jellyfish wind-up assertion in `biome3.test.ts`; all 72 checks passed when rerun alone. Failed concurrent runs were stopped before retrying without the extra test workload. One subsequent full run passed those but hit the existing host/client Toy Factory arena signature assertion in `worldGame.test.ts`; the earlier full run had passed it. A further run passed 96/97 files but hit the local-pad leash assertion in `mpCoop.test.ts` (17.0 m versus 15.2 m); squads are disabled in that scenario, and previous runs passed it. The Toy Factory failure also reproduced in an isolated archive of the untouched pre-squad commit `a604aa4` (`/tmp/aisquad-baseline-world.log`), confirming it predates this lane. No world/secret/biome/local-pad test assertions were changed.
- The first co-op browser runs exposed unrelated turret/carry and trade fixture races under concurrent testing. The input/pickup fixture corrections above preserve all assertions; the final browser run passed as recorded above.
