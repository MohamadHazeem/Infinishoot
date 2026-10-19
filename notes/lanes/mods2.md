# mods2 — fresh shop Mods

## What players get

18 new Mods: twelve solo/build choices and six co-op-only choices. Every Mod has a unique generated icon, rarity, two upgrade levels, numerical `modDesc` text, normal buy/sell/lock/reorder behavior, and shop-preview support. No gold generation, prices, interest or save-format changes.

| Mod (id) | Rarity / price | Level 1 → 2; condition |
| --- | --- | --- |
| Riposte Cell (`riposte_cell`) | uncommon / 6 | +3 → +6 flat damage for 2s after a successful parry |
| Slipstream (`slipstream`) | uncommon / 6 | +20% → +40% Orbit/Trail damage for 3s after a perfect dash |
| Encore (`encore`) | rare / 8 | +15% → +30% damage for 6s after an ultimate |
| Cash Capacitor (`cash_capacitor`) | uncommon / 6 | +3 → +6 flat damage for 6s after cashing in any combo tier |
| Second Hand (`second_hand`) | rare / 7 | +20% → +40% damage for 8s after a completed rewind |
| Ejection Seat (`ejection_seat`) | rare / 7 | +25% → +50% damage for 8s after surviving mech exit; includes the eject blast |
| Jack in the Box (`jack_in_box`) | common / 4 | Open a map, elite/boss or jackpot chest: 35 → 70 damage, 4m Area/Shock nova |
| Hearth (`hearth`) | uncommon / 6 | +20% → +40% Fire/Trail damage inside a living patch from your Blaze Boots |
| Wallflower (`wallflower`) | common / 4 | +20% → +40% Orbit/Area damage within 2m of cover |
| Cold Front (`cold_front`) | uncommon / 6 | +25% → +50% Frost/Chain damage at 8m or farther |
| Blood Primer (`blood_primer`) | uncommon / 5, cursed | +3 → +6 every hit; max life x0.85 → x0.7225. Place before multipliers |
| Last Word (`last_word`) | rare / 7, cursed | Subtract 2 → 4 from each hit, then x1.25 → x1.5. Rewards large hits and careful ordering |
| Signal Flare (`signal_flare`) | rare / 8, ally | Your Burns give other living allies +15 → +30 percentage points of crit chance; cap +30 |
| Pit Crew (`pit_crew`) | uncommon / 6, ally | Other allies within 10m get +12% → +24% weapon recharge speed; combined cap +30%. Includes Charge Shot's hold meter |
| Counterchorus (`counterchorus`) | rare / 8, ally | A nearby ally's successful parry fires your 3m Area/Shock nova: 20 → 40 damage; 1s cooldown |
| Blood Bond (`blood_bond`) | uncommon / 6, ally | Share 10% → 20% of actual kill-heal recovery with each ally within 10m; cap 20%, no overheal or recursion |
| Wing Guard (`wing_guard`) | uncommon / 6, ally | A nearby ally's perfect dash grants you 0.15 → 0.30s invulnerability; cap 0.30s, 2s cooldown |
| Standing Ovation (`standing_ovation`) | rare / 8, ally | A nearby ally's ultimate gives you +10% → +20% damage for 6s |

## Rules and decisions

- Mods stay inside ModApi/ModFlags. `systems/mods2.ts` bridges host gameplay events, live fire/cover queries, teammate reload, Burn crit chance and actual lifesteal recovery. Small call sites fire only after success; whiffs, failed cash-ins and unavailable ultimates do nothing.
- New `onEvent` hooks run once per resolved state with an effective copy count. Levels and Echo increase nova damage without emitting duplicate VFX; shared cooldowns cannot be bypassed by Echo. Damage windows use the monotonic Synergy clock; upgrading/Echo never multiplies their duration. Repeated triggers refresh the window. Existing hooks are unchanged.
- Ordering is the real affine pipeline. A 10-damage hit through level-1 Primer → Last Word is 13.75; reversed it is 13. At level 2 the two orders give 18 versus 15. Shop previews show negative offsets and keep other active event windows while previewing a hypothetical trigger.
- All ally effects exclude self, dead and disconnected heroes. Auras/events/heal sharing use 10m. Signal Flare uses the enemy's existing Burn owner (no range restriction after marking). Ally effects are disabled during PvP duels. Locked ally offers disappear when a run becomes solo; owned Mods remain and can be sold.
- No new snapshot field is needed: existing hero HP/invulnerability, weapon state/readiness, local Mod IDs/levels/readouts and shop views carry the results. Novas and heal numbers use `game.vfx`. Clients never simulate the effects.
- Hearth intentionally queries Blaze Boots' real flame pool without allocation. It does not count scenery lava, enemy fire, Burn status, or merely owning a Fire-tagged weapon. Cover checks only run while Wallflower is owned. Auras loop over at most the team; no new enemy scan runs each frame.
- Default aura/position caps live in exported `mods2Tuning`; debug panel **Mods: ally & position** exposes them. Remaining per-card numbers live alongside the Mod definitions.

## Verification and balance

Results and measurements below are from this worktree, not a human playtest.

### Reproducible bot measurements

`tests/mods2.bench.ts` uses the real autoplay bot and simulation, seeded RNG/Math.random = 42, Normal, Rookie, Buster/Charge/Bomb, no pet, and a living support teammate 1m behind. No shopping or level-up choices. All new Mods are measured at their maximum level 2; existing comparators use level 2 or their own lower cap. A single Mod is equipped per run. The combo adds level-3 Blaze Boots, Frost Nova, Orbit Drones and Chain Zap to both heroes. Ally providers are assigned to the support hero when necessary.

Two passes: ordinary hordes for 60 bot seconds; then 12 durable chasing Chonks for 30 bot seconds with director spawns disabled. The second pass avoids damage being hidden by overkill. Each event is injected successfully every 15 seconds to test generous uptime; actual gameplay call sites are independently tested. This deliberately over-represents rare mech exits, rewinds and chest openings. The bot still chooses aim, movement, dash, parry and firing. No simulated `canCrit` or pipeline shortcut replaces combat.

| Mod | Target damage/s, starter / combo | Relative to matched no-Mod, starter / combo | Horde kills, starter / combo |
| --- | ---: | ---: | ---: |
| `none` | 453.0 / 3522.8 | 1.000 / 1.000 | 324 / 673 |
| `glass_cannon` | 906.4 / 5853.0 | 2.001 / 1.661 | 281 / 578 |
| `hive_mind` | 453.0 / 3762.2 | 1.000 / 1.068 | 324 / 605 |
| `patience` | 969.6 / 4133.8 | 2.140 / 1.173 | 332 / 689 |
| `supernova` | 677.4 / 4424.2 | 1.495 / 1.256 | — / — |
| `thunder_shot` | 751.6 / 3150.9 | 1.659 / 0.894 | — / — |
| `riposte_cell` | 465.1 / 3582.8 | 1.027 / 1.017 | 306 / 674 |
| `slipstream` | 453.0 / 3610.7 | 1.000 / 1.025 | 324 / 702 |
| `encore` | 518.7 / 3953.9 | 1.145 / 1.122 | 289 / 704 |
| `cash_capacitor` | 484.1 / 3775.4 | 1.069 / 1.072 | 253 / 632 |
| `second_hand` | 564.6 / 4158.5 | 1.246 / 1.180 | 255 / 686 |
| `ejection_seat` | 593.4 / 4319.8 | 1.310 / 1.226 | 289 / 605 |
| `jack_in_box` | 451.1 / 2906.3 | 0.996 / 0.825 | 282 / 690 |
| `hearth` | 453.0 / 3566.3 | 1.000 / 1.012 | 338 / 673 |
| `wallflower` | 453.0 / 3569.5 | 1.000 / 1.013 | 324 / 673 |
| `cold_front` | 453.0 / 3654.3 | 1.000 / 1.037 | 324 / 673 |
| `blood_primer` | 526.1 / 3909.8 | 1.161 / 1.110 | 312 / 577 |
| `last_word` | 608.7 / 4303.2 | 1.344 / 1.222 | 329 / 681 |
| `signal_flare` | 453.0 / 2795.1 | 1.000 / 0.793 | 324 / 707 |
| `pit_crew` | 444.7 / 3689.7 | 0.982 / 1.047 | 315 / 682 |
| `counterchorus` | 347.4 / 4748.0 | 0.767 / 1.348 | 284 / 719 |
| `blood_bond` | 453.0 / 3522.8 | 1.000 / 1.000 | 324 / 621 |
| `wing_guard` | 453.0 / 3522.8 | 1.000 / 1.000 | 354 / 621 |
| `standing_ovation` | 497.4 / 3809.4 | 1.098 / 1.081 | 324 / 720 |

All eighteen new Mods stay below the strongest existing comparator in both target probes: highest new result is Last Word x1.344 with the starter kit and Counterchorus x1.348 with the combo; existing Patience reaches x2.140 and Glass Cannon reaches x1.661 respectively. Utility Mods are also bounded mechanically: Pit Crew +30% speed, Signal Flare +30 crit points, Blood Bond 20% sharing, Wing Guard 0.3s every 2s. Blood Bond's separate 10-HP/s actual-recovery probe shares exactly 60 HP over 30s at level 2; Wing Guard adds 0.3s of measured invulnerability to the bot's existing 4.2s/3.4s. Overlapping protection intentionally does not add durations.

The positional/tag Mods have no effect on an incompatible starter kit, as intended. Combo probes activate each relevant tag/position (Hearth +1.2% total team damage, Wallflower +1.3%, Cold Front +3.7%); their active-hit bonuses are larger because only matching hits qualify. Signal Flare and nova knockback can reduce measured damage by changing target choice, stun/Overload timing and crit consumption. Horde kills are not a DPS ranking: stronger hits also change movement, RNG consumption and wasted overkill. These are one-seed controlled comparisons, not a claim about every build or human survival.

Reproduce:

```sh
npx rolldown tests/mods2.bench.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/mods2.bench.mjs
MOD=none COMBO=0 LV=2 node node_modules/.tests/mods2.bench.mjs
MOD=hearth COMBO=1 LV=2 PROBE=1 SECS=30 node node_modules/.tests/mods2.bench.mjs
MOD=hearth COMBO=1 PROBE=1 SECS=30 LANE_PERF=1 node node_modules/.tests/mods2.bench.mjs
```

### Performance

- Instrumented bot, two heroes + four auto weapons each + twelve durable enemies: new lane bridges together **0.0163 ms/step**, full bot update **0.71 ms**. This includes event, crit, fire-position, aura and shared-heal bridges; existing Synergy damage-hook cost is inside the full update.
- `npm run bench` ran both the standard heavy scene and a five-Mod version (Hearth, Wallflower, Blood Primer, Last Word, Riposte Cell, all level 2), with 250+ enemies and roughly 500 live bullets. No browser errors. HIGH-quality simulation cost: 0.47 ms/step baseline, 1.10 active; later matched LOW run: 1.53 baseline, 1.24 active. Other builders were testing concurrently, so the reversed ordering is measurement noise, not an optimization claim.
- SwiftShader stalled GL submission for hundreds of milliseconds in the later runs and rendered only 4–7 frames per 8-second capture. These captures cannot establish native-GPU 60fps. The lane has no new persistent meshes and its bridges add no per-frame allocation; fire uses the existing pool and cover uses the existing grid.

### Coverage and visual checks

`tests/mods2.test.ts` covers all 18 definitions/icons/level descriptions; preview equality at multiple hit sizes; negative offsets; preserving overlapping windows; Echo/level aggregation and cooldowns; real successful/failed parry, ultimate, cash-in, mech exit, chest and rewind paths; fire/cover entry and exit; solo/locked-offer gating; ally range and self exclusion; healing, crits and reload; PvP exclusion; and real compact host-to-client HP, protection and readout snapshots. Pure nova/protection choices show numerical current/next descriptions; aura flags also produce shop number lines.

Looked at the 1280×720 shop, the full 1280×1200 shop and a 72px contact sheet of all icons. Replaced the solid-square wall icon and thin/indistinct rewind and bond icons after viewing the sheet. The normal 720px shop scrolls, as it already did with five owned Mods; no new CSS changes its layout. Debug-only contact-sheet CSS lives in `mods2Links.ts`.

Test links (existing `mods=id:level` plus two small new dev options):

- `?test&seed=42&gold=80&weapons=fire:3,drones:3&mods=blood_primer:2,last_word:2,riposte_cell,hearth,wallflower&shop&modoffers=slipstream,encore,second_hand,wing_guard`
- `?test&god&modicons&frozen&quality=low` — all eighteen icons through the actual 24px rasterizer, displayed at 72px.
- `?test&god&mods=riposte_cell:2,slipstream:2,encore:2&weapons=drones:3,fire:3&parrygo=2&ultgo=3` — live trigger readouts.
- `modoffers=id,id,id,id` forces four shop cards for visual inspection, including ally cards in a solo debug scene. Ordinary solo shop rolls remain filtered.

### Final native GPU comparison

Repeated the same HIGH-quality heavy benchmark on native Metal, 20s after 4s warm-up, 1280×720. A temporary `SHOT_CHROME` launcher replaced only `--use-angle=swiftshader` with `--use-angle=metal`; the benchmark's printed “SwiftShader” label is hard-coded, so it does not describe these final captures.

| Metric | No Mods | Five new Mods at level 2 |
| --- | ---: | ---: |
| Simulation / step | 0.77 ms | 0.80 ms |
| Game render | 0.96 ms | 0.97 ms |
| GL submission | 0.94 ms | 0.87 ms |
| Total CPU / frame | 2.68 ms | 2.64 ms |
| CPU p95 | 3.32 ms | 3.38 ms |
| Frame interval avg / p95 | 16.67 / 16.67 ms | 16.67 / 16.67 ms |
| Enemies avg / max | 270 / 345 | 260 / 327 |
| Bullets avg / max | 492 / 550 | 483 / 503 |
| Draw calls avg | 163 | 158 |

No page errors in either capture. The lane preserves the existing CPU range and the fixed 60fps presentation interval; the small difference in total CPU is within workload variation, while simulation rises by about 0.03ms/step. Final targeted tests also verify that gaps/holes do not count as solid cover for Wallflower.

## Files and integration

- Owned/additive: `src/data/mods.ts`, `src/game/modTypes.ts`, `src/game/synergy.ts`, new `src/game/systems/mods2.ts`, `scripts/icons.mjs`, regenerated `src/data/iconArt.ts`, `tests/mods2.test.ts`, `tests/mods2.bench.ts`.
- Small shared bridges: `src/game/game.ts` (system installs + before/after live-stat calls), `hero.ts` (shop filtering), `systems/skill.ts`, `gameplay.ts`, `time.ts`, `statuses.ts`, `cinematics.ts` (successful-event hooks), `combat.ts` (ally crit chance), `weapons/fire.ts` (read-only pool query), `shopPreview.ts` (conditions, active windows, negative offsets and aura numbers).
- Dev/UI: new `src/dev/mods2Links.ts`, one import/call in `dev/testLinks.ts`, one debug folder in `ui/debugPanel.ts`.
- Harness: `scripts/coop-test.mjs` gets opt-in `COOP_TIMEOUT_MS`, `COOP_LOW` and `COOP_ANGLE` for slow shared machines/native GPU testing. Default behavior and all gameplay/desync assertions stay unchanged. No test was weakened or skipped.
- Documentation: this file and an appended `PLAN.md` decision-log paragraph.

## Remaining limitations

- Balance covers one seed, max-level isolated Mods and a representative mixed-tag combo, with generous injected trigger opportunities. Human pacing, larger parties, arbitrary Echo stacks and niche low-damage tick builds still need playtesting.
- Hearth covers Blaze Boots patches; other weapons' fire visuals are not automatically treated as walkable fire zones.
- Native performance is verified on this Mac only; broader hardware and human playtesting remain. The shared machine's software renderer stalled heavily.
- The existing metadata test expects a regular chest and can fail when its unseeded jackpot roll substitutes a golden chest. The first full test run hit this; the isolated rerun passed. No unrelated test source was edited.

## Final validation record

- `npm run typecheck`: passed.
- `npx vite build`: passed (existing large-chunk advisory).
- `npm run smoke`: passed every mode/hero, online-style local co-op, mortal death/history and menus; no runtime errors.
- `tests/mods2.test.ts`: passed, including real host/client snapshots and a completed rewind.
- Icons regenerated with `npm run icons`; shop/contact-sheet screenshots generated with `npm run shot` and visually inspected.
- 44 ordinary-horde bot runs plus 48 sustained-target probes completed; detailed measurements above. `npm run bench` completed with no page errors; GPU limitations above.
- `npm test`: final full run passed **57 test files**. The unseeded metadata chest assertion passed in this full rerun as well as its isolated rerun.
- Real PeerJS/WebRTC browser co-op: **passed** with `COOP_TIMEOUT_MS=120000 COOP_LOW=1 COOP_ANGLE=metal npm run coop`. Full 80-second scenario, all gameplay assertions unchanged; 1,574 snapshots averaged 1,648 bytes (max 14,810; none chunked), all skill events matched, host/client synced through stage 3 and 228 enemies. Jump pad, turret, fusion, team move, boss entrance/finisher, parry, portrait, route and down/revive checks passed.
- Earlier SwiftShader attempts timed out or let a jump-pad fixture race a level-up under multi-second rendering stalls. One attempt was invalidated by a source-edit/HMR reload. Sources were frozen for the successful native-Metal run; default harness behavior is unchanged unless its new environment options are supplied.
