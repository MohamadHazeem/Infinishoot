# Gate 3 combat controls

## What players get

- A normal dash spends one of three visible stamina pips. They refill in sequence, one per 1.6 seconds at level 1 and one per 0.7 seconds from level 20, before build modifiers. Dash Cells and Speedster still increase capacity. The Duelist keeps its parry meter.
- A dodge within 0.10 seconds of an incoming threat, or a graze in the first 0.10 seconds of the dash, refunds exactly one pip. Skill slow motion runs the world at 35% for 0.4 seconds. Existing slow-motion settings, PvP rules and separate boss close-call effects apply.
- Keep steering after a normal dash to slide for 0.24 seconds. Speed starts at 1.55× running speed and tapers. Release movement to brake. Hitting a solid collider reflects the dash around its contact normal once. A late bounce gets up to 0.09 seconds to move away from the wall. It spends no extra pip and adds no invulnerability.
- The hero hovers for 0.44 seconds from takeoff. This clears arena lava, lava-event puddles, slug trails and burning-ground patches. The regular dash protection expires after 0.22 seconds, so a projectile, blast or contact can still hit a hovering hero. The arena boundary, gaps and boss ring keep their existing rules.
- A standard parry catches attacks for **six fixed simulation frames at 60 Hz** (100 ms, previously about ten frames). The mortal pilot still anticipates the complete 160 ms swing. The Duelist retains its 1.8× active window. Remote presses with unknown ping receive nine frames. Measured-ping presses use the six-frame window plus the existing capped latency allowance and rewind.
- A clean parry heals **4 HP once per press**, including against a volley. Returned rounds carry 3× the incoming projectile's base damage through the ordinary player damage pipeline. A live, identified shooter takes the stun and the return shot even when another enemy stands closer. Returning a shot with no live shooter reverses its travel direction. Ordinary stuns last 1.1 seconds. Bosses flinch for 0.10 seconds and keep their attack state. The Reaper retains its crowd-control immunity.
- At A, S and SS, ordinary kills gain an extra +0.1, +0.2 and +0.3 percentage-point chance of dropping a gold bolt, before the usual horde and team scaling. The existing score multipliers at those ranks are 1.5×, 1.8× and 2.2×. An accepted hit drops two ranks, bounded at D. Gauntlet has its own economy. Healing and chest drop rates stay on their existing paths.

## Inputs and co-op

The new moves compose Dash and Move. Keyboard rebinds, Xbox/PlayStation controls and the touch move stick and dash button use the same physics. Parry uses the existing parry action on all three devices. The onboarding queue shows device-specific prompts in English or Arabic. A save that saw the earlier perfect-dodge tutorial can see the movement lesson once. The existing tips array handles persistence and resetting tips.

The moving client predicts its own spend, slide, bounce and lift. The host debits accepted dash messages, checks threats and incoming damage, refunds stamina, grants healing and spawns drops. The skill snapshot acknowledges the ordered dash count so an older packet cannot restore a freshly spent pip. It also carries authoritative stock, refill time, remote lift and remaining perfect-dodge slow time. Clients scale predicted movement and bullet travel while the network, rhythm and UI clocks keep ticking. Existing snapshot fields and effects carry HP, stun, the returned shot and feedback. Client-owned coordinates and the Ronin's separately validated dash-strike retain their existing protocol.

Shooter attribution uses bullet and enemy generation IDs in bounded arrays. Reusing a pool slot cannot stun its next occupant. Enemy weapon and boss shot callbacks record the source at spawn, including every projectile in a Mirror Bot's copied volley. Scripted field volleys outside those callbacks use the reverse-direction fallback. The movement and wall-reflection math operates on existing vectors.

## Files for integration

- Lane gameplay and tuning in `src/game/player.ts`, `src/game/systems/skill.ts` and `src/game/skillHands.ts`. The skill system registers the timing defaults on the existing live tuning object, shared by the debug controls and pilot.
- Shared edits are one installation call in `src/game/game.ts`, the stamina strip and its changed-value update in `src/ui/hud.ts`, scoped pixel styling in `src/style.css`, localized touch prompt labels in `src/ui/prompts.ts` and the combat tutorial strings in `src/i18n/menus.ts`. The latter supplies the existing English fallback for five other locales.
- Regression scenarios in `tests/g3hands.test.ts` exercise charge depletion, refill, a real wall, slide braking, ground-only protection, shooter identity after a bullet pool swap, a volley heal, the parry expiry frame, one refund, score and gold stakes, prediction reconciliation and a lag-rewound shot through armor.

## Reproduction

Use `?test&stage=2&god&seed=19&tip=perfectdash&tipnow&nointro`. Move and tap dash to spend a pip. Append `&lang=ar`, `&pad=xbox`, `&pad=ps` or `&touch` for the other prompts. Use `&tip=parry&tipnow` for the parry lesson. Use `?test&stage=2&god&dashgo=2` for a forced perfect dodge and `?test&stage=2&god&parrygo=2` for a reflected volley.

The paired mortal-bot cohort uses Normal, Rookie, the starter kit, no pet, season off, seeds 1–10 and the runner's standard 2,100-second cap. Command: `npm run skillbot -- --runs 10 --difficulty normal --seed 1 --jsdom`. The CLI's dated report path already contained the historical Gate 2 study, so both cohorts wrote to temporary directories pointing back at this worktree. The final measurement counted slide starts, wall reflections and otherwise damaging ground contacts in a temporary copy of the runner. The instrumentation observed play through the production entry points.

| Mortal Normal cohort | Stage 1 / 2 / 3 / 4 clear | Loop clears | Median stage reached | Mean game seconds | Incomplete |
| --- | --- | --- | --- | --- | --- |
| Unchanged `1ddb32a` | 60% / 40% / 30% / 20% | 2/10 | 2 | 558.7 | 0 |
| Two-HP parry, shortened pilot anticipation | 80% / 70% / 70% / 20% | 2/10 | 4 | 773.8 | 0 |
| Four-HP parry, full anticipation, before copied-volley attribution | 90% / 90% / 90% / 40% | 4/10 | 4 | 1045.5 | 1 |
| Final build including copied volleys | 90% / 90% / 90% / 40% | **4/10** | **4** | 1029.7 | 1 |

Final clears came on seeds 2, 3, 6 and 10. Of the other six runs, five ended in death and seed 8 reached the simulation cap at the stage-3 portal after killing the Queen. It counts as a non-clear. The 40% result reaches the lower edge of the Gate 2 target on this fixed ten-seed sample. Human clear rates and the combined Gates 3–5 build require separate measurements.

A separate 1,100-second seed-8 replay reproduced the portal stall. At the sample, the pilot was running 1.77 m from the ordinary exit, whose entry radius is 1.3 m. The path to it tested clear, the hero touched no collider, and dash, slide and hover had all expired. The pilot's portal steering is outside this lane.

The mortal pilot made 2,479 dashes and 3,121 parry attempts through the ordinary input system. Those inputs produced 2,478 slides, 163 wall rebounds and four grounded damage ticks avoided during hover after normal invulnerability expired.

## Browser checks

- Inspected `shots/g3-hands-{en,ar}-{720,1080}.png` at 1280×720 and 1920×1080 from the production preview. The tip fits the side panel and the three cells fit the original meter in LTR and RTL. Captures include a spent cell and a perfect dodge returning it.
- The production heavy preset at 1280×720 recorded 891 frames over 15 seconds in managed headless Chromium. Median load was 352 enemies and 521 bullets. Median and p95 frame intervals were both 16.7 ms, and p95 CPU frame work was 4.7 ms. This is a measurement on the shared build machine.
- macOS denied the shell-launched Chromium's Mach port registration before the shot, offline co-op and balance CLI scripts could open a page. The managed browser ran the offline script's actual two-context WebRTC and state comparisons, including reconnect and the post-run party flow. Its low graphics setting and longer load timeout accommodate the shared machine. It also ran the seeded four-kit balance assertions with the same fixed clock and tolerance. All four kits cleared two stages within 25% of the existing baseline.

## Verification and integration limits

- TypeScript, the production Vite build, strict i18n, the new lane tests and the existing skilled-pilot fixtures passed. The lane tests exercise the virtual gamepad and touch input dispatch and check the Arabic touch button names.
- `npm run smoke` passed. The invincible Normal Rookie reached stage 3 with 31,632 kills. The mortal Nightmare run recorded death to King Bopper's shockwave and opened the game-over screen. The runner reported zero runtime errors.
- `npm test` passed 121 of 132 suites after its serial retries. Ten failures are recorded in [the Gate 2 handoff](g2-hardmode.md#unit-fixtures-for-integration): `balance3`, `gameplay`, `gameplayCoop`, `menus`, `meta`, `raid`, `time`, `timeCoop`, `ultboss` and `worldEventsGame`. The additional `hostmig` failure reproduced on untouched commit `1ddb32a` at the same PeerJS constructor during reconnect. These fixtures belong to other lanes. The managed two-browser reconnect scenario passed.
