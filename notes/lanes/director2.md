# director2 — a smarter run

## What players get

- An adaptive survival director that watches the weakest teammate's HP, actual damage taken, normalized kill rate, lethal hits and near-deaths. It changes horde targets and refill rate, and briefly postpones elite/ring spikes. It never changes enemy HP, damage, boss HP or the boss arrival timer. No player-facing pressure meter; values and tuning are in Debug > Director > Adaptive pacing.
- Six additional classic stage events, using the existing one-event schedule and banners/sounds. World events still replace classic events as before. Every completed new event pays **6 + 2 × stage gold per present hero** and **500 × stage score**, exactly once. Interrupted/replaced events do not pay.
- Twelve rule relics, all in the existing rarity-weighted boss/secret-merchant pool, with unique generated pixel icons and the existing shop/pause relic chips. No persistent save schema changes.
- Three regular stage-2+ enemies with distinctive merged models, retro materials, existing suitable gaits, damage materials and Enemy Guide/codex entries.

## Pacing and tuning

`adaptiveTuning` in `src/game/director.ts`:

- Pressure bounds **0.78–1.18**. Rise **0.018/s**, fall **0.22/s**.
- An actual hit leaving a hero at **25% HP or below** starts a **6 s** breather, with **28 s** cooldown. Lethal hits count even when a revive saves the hero.
- While breathing, an imminent elite moves at least **2 s** ahead; a ring at least **5 s** ahead. They do not stack into a catch-up burst.
- Cruising requires every present hero at **75%+ HP**, fewer than **0.35 max-life fractions of damage/minute/player**, and at least **0.8 kills/s/player**, with **15 s** exponential memory.
- Lost pressure accumulates as a bounded debt (at most **8 pressure-seconds**); after the weakest hero recovers above **50% HP**, neutral pacing adds **0.08** until debt is repaid. Cruising also pays it down. Stage starts reset telemetry; the boss phase returns pressure to 1.
- Existing difficulty, curse, co-op count and HP multipliers remain in force. PvP/Versus, training and holstered challenge modes do not run this lane's simulation.

`director2Tuning` in `src/game/systems/director2.ts` is also exposed in the debug folder:

| Event | Duration | Behavior |
| --- | --- | --- |
| Meteor Garden (`garden`) | 24 s | Every 2.4 s, a 2.2 m meteor circle warns for 1.5 s. Hits heroes for 14 × stage damage and enemies for 45 × horde HP scaling; a 6-life heart appears after impact (a coin when Famine/no-hearts forbids hearts). Blocked landing sites are skipped. |
| Robot Rebellion (`rebellion`) | 20 s | Up to 12 robots per 0.8 s attack a nearby enemy within 5 m for 12 × horde HP scaling. Participating robots redirect through the existing lure API and stop aiming at players. Bosses, hidden targets, Reapers and frozen attackers are excluded. |
| Gravity Storm (`gravity`) | 22 s | A stationary 10 m vortex at the starting hero position pulls regular enemies at 2.8 m/s, respecting walls. Bosses and Reapers resist it. Move out, then shoot into the gathered horde. |
| Treasure Goblin Parade (`goblins`) | 24 s | Three Goldbugs, 7 s apart, with their normal chase/escape timer and jackpot rewards. |
| Blackout (`blackout`) | 20 s | Smoothly raises the existing night look to 0.85; keeps hero lanterns and readable aim lines. Sends two Blink Rangers 7 s apart. No screen flash. |
| Turret Party (`turrets`) | 24 s | Three friendly green/gold sentries 5 m around the event anchor. Each shoots every 1.2 s within 12 m for 30 × horde HP scaling. Blocked stations are skipped. One instanced batch renders the three persistent models. |

## Relics

| Relic | Rarity | Rule |
| --- | --- | --- |
| Backbeat Battery | Common | Every third dash restores 12% special charge. |
| Rescue Relay | Rare | Dash heals living teammates within 7 m for 8, or yourself for 4 in solo; 6 s cooldown. |
| Pain Capacitor | Uncommon | Successful incoming hit restores 15% special charge if still alive. |
| Mercy Coin | Uncommon | Every 12 credited kills: heal 8 below half HP, otherwise +2 gold; 6 s cooldown. |
| Anchor Badge | Rare | Stand still 1 s for +4 armor and cooldown ×0.85; moving cancels it. |
| Glass Clock | Rare | Full HP: cooldown ×0.8. Otherwise damage ×0.9. |
| Salvage Permit | Common | Your elite kills drop a reroll gear; existing pickup cap remains in force. |
| Cold Snap Soles | Rare | Dash freezes regular enemies in 3 m for 1 s; 4 s cooldown; excludes bosses/Reapers. |
| Reserve Dynamo | Legendary | Hold full special charge for double pickup range and damage ×1.15. |
| Forty Winks | Legendary | Every 40 credited kills refills the special. |
| Cinder Receipt | Uncommon | Every second dash leaves a 3 m enemy-only blast after 0.8 s, 35 × horde HP scaling. Guest damage credits the guest. |
| Pacemaker | Rare | After 10 s without a hit, the next hit clears hostile bullets within 4 m. |

Counters persist between stages and reset between runs. Conditional stat effects recompute from base stats, never compound. Existing shop and pause screens display all metadata without new screen code.

## Enemies

- **Bastion Porter (`bastion`)**: 110 HP, speed 1.8, radius 0.75, cap 3, weight 0.9. Wide green gate silhouette; shield arc 80° each side, front damage ×0.2, ally cover range 5.2 m (existing rear damage ×0.5), turn 0.9 rad/s. A slow 0.85 s shield-bash telegraph. Stage 2, content minute 3 (about 72 s into stage 2).
- **Blink Ranger (`blinksniper`)**: 38 HP, speed 2, cap 3, weight 0.8. Cyan relay halo and long rifle. Every 6 s (first staggered by uid), marks a walkable destination 10 m from a living hero for 0.9 s, then blinks. Never interrupts a wind-up; landing waits another 0.6 s before starting the normal sniper aim line. Freezing cancels the pending teleport and requires a fresh warning after thaw. 18-damage shot, speed 22, interval 4.5 s. Stage 2, content minute 3.7 (about 106 s into stage 2).
- **Bomb Courier (`bombcourier`)**: 24 HP, speed 5.8, radius 0.48, cap 6, weight 1.4. Orange courier with a dark backpack and twin yellow bomb canisters. Arms within 2.8 m, visibly fuses for 1.25 s, explodes in 3.4 m for 24 damage. Stage 2, content minute 2.8 (about 62 s into stage 2).

They reuse the shielder, shooter and exploder brains/gaits while adding new silhouettes and the Ranger's tactic. This avoids another parallel enemy-state/netcode implementation. They are regular director picks, not bosses or new veteran families.

## Co-op, performance and settings

- Host owns all gameplay. Event id/time uses existing `sev`; ordinary enemies/pickups, relic inventory and effects use the existing transport. Lane field `d2` is `[pressure, breatherSeconds, nearDeaths, deaths, anchorX, anchorZ]`, through the snapshot codec's generic fallback.
- The client derives Blackout from `sev` and renders Turret Party at the replicated anchor. Late joiners receive the anchor and current event without depending on a past effect.
- All sounds/telegraphs/particles use `game.vfx`; existing audio buses and visual accessibility settings apply. Blink and meteor warnings use the threat bus. No new user settings, audio downloads, APIs or dependencies.
- Reused hero/enemy scratch arrays and matrices; enemy scans are linear; rebellion attacks are capped spatial-hash queries. New turrets use one InstancedMesh with live-range uploads. Geometry/materials are created only when first needed.
- Optional hooks in `enemies.ts` and `HeroWorld` preserve browser-free imports for pure tests. The lane is installed when Game loads it.
- Small strike fix: `dmg: 0` now skips hero damage rather than being raised to the minimum one-point hit. Optional strike owner preserves guest credit for Cinder Receipt. Heart pickups now honor explicit values greater than one (Meteor Garden uses 6); ordinary hearts retain their existing 30-life heal.

## Verification

- `npm run typecheck` and `npx vite build`: pass. Vite reports the existing large-bundle advisory.
- `npm test`: all 61 test files pass on the final source.
- `npm run smoke`: pass on the final source: seven hero/mode combinations, training, rhythm/Pacifist/mini-games/ghosts, Versus, three-player local co-op, mortal run, game over/history and all menu screens; no runtime errors.
- `COOP_LOW=1 COOP_TIMEOUT_MS=120000 COOP_LOAD_TIMEOUT=120000 COOP_ANGLE=metal npm run coop -- --out shots/coop-director2`: pass twice. Latest full run: 1,568 snapshots, average 1,514 bytes, maximum 12,086, none over 16 KB. Added assertions cover all six event IDs, guest relic inventory, finite pressure and matching turret anchors, alongside the existing boss/revive/route scenarios.
- `npm run bench -- --dev --gpu metal --seconds 20 --json /tmp/director2-bench-metal.json`: **61.5 FPS**, 1,229 measured frames, **310 average / 402 peak enemies**, **512 average / 579 peak bullets**, HIGH quality. Simulation **0.73 ms average / 1.14 ms p95**; total CPU including game rendering and GL **2.50 ms average / 3.19 ms p95**, no runtime errors. The preceding software-GL before/after runs were heavily renderer-limited and too sparse for an FPS comparison (12 and 4 frames). The isolated 200-enemy lane update measured **0.0073 ms** across 20,000 iterations on the final source.
- `tests/director2.test.ts`: pacing bounds/debt/recovery/reset; boss invariants; all relic rules and icons; event expiry/rewards; explicit six-life versus ordinary 30-life hearts; Mercy Coin cooldown; Famine substitution; robot friendly fire; gravity; freeze-safe blink warning/landing; guest blast credit; departed-teammate telemetry; real snapshot encode/decode and client application.
- Ran the required `npm run shot` test link and inspected its PNG. Also inspected all six event views, the three enemy silhouettes, all twelve icons, pause inventory and shop inventory. Images are in ignored `shots/director2-*.png`; co-op host/client captures are in `shots/coop-director2/`.

### Bot A/B

The opt-in real-Game test runs three matched arena seeds (42, 912, 731), Normal Rookie, 240 seconds each, with adaptation off/on. At 40 s it injects the same low-health hit to measure recovery from a known spike. This compares pacing, not different content builds. Reproduce after bundling the lane test:

```sh
npx rolldown tests/director2.test.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/director2.test.mjs
DIRECTOR2_BALANCE=1 node node_modules/.tests/director2.test.mjs
```

All six runs survived all 240 measured seconds. Values below are **off / on**:

| Seed | Kills | Mean horde target | Mean pressure | Minimum pressure after spike |
| --- | --- | --- | --- | --- |
| 42 | 4301 / 4598 | 99.2 / 114.7 | 1.000 / 1.144 | 1.00 / 0.78 |
| 912 | 3542 / 4329 | 98 / 114 | 1.000 / 1.135 | 1.00 / 0.78 |
| 731 | 3294 / 3343 | 98.7 / 111.4 | 1.000 / 1.126 | 1.00 / 0.78 |

Adaptation cut pressure to 0.78 at the injected spike in all three runs, while full-run average pressure rose to 1.126–1.144 and mean horde targets rose from 98.0–99.2 to 111.4–114.7. All three adaptive runs killed more enemies. This supports smoothing a local spike without lowering total scheduled pressure in this sample.

The runs establish a short local pressure reduction plus higher full-run pressure/exposure in this sample. They are not a guarantee of identical win rates across all builds/difficulties; no human balance playtest was available. HP, drops and XP gained through different kill totals can still change downstream build strength.

## Test links

- `?test&god&stage=2&wevoff&d2event=garden&spawn=bastion:2,blinksniper:2,bombcourier:3&spawnr=7`
- Replace `d2event` with `rebellion`, `gravity`, `goblins`, `blackout`, or `turrets`. Existing `event=<id>` also works.
- `?test&god&stage=2&wevoff&spawn=blinksniper:3&spawnr=10` — watch the cyan destination and fresh aim line after landing.
- `?test&god&relic=r_backbeat,r_relay,r_capacitor,r_mercy,r_anchor,r_glassclock,r_salvage,r_coldsnap,r_reserve,r_jackpot,r_cinder,r_pacemaker`
- `&adaptive=off` / `&adaptive=on` — A/B toggle; current pressure is in Debug > Director > Adaptive pacing.
- Screenshot command used: `npm run shot -- "?test&god&stage=2&wevoff&d2event=garden&spawn=bastion:2,blinksniper:2,bombcourier:3&spawnr=7" shots/director2-garden.png --wait 4`.

## Files and integration

Owned: `src/game/director.ts`, new `src/game/systems/director2.ts`, additive `src/data/stageEvents.ts`, `relics.ts`, `enemies.ts`, new `tests/director2.test.ts`, this note.

Necessary additive hooks: `game.ts` (method installs/update/dash/strike owner), `hero.ts` (optional live-stat hook), `game/enemies.ts` (optional model/lure hooks), `systems/statuses.ts` (hurt/kill/strike hooks and explicit heart healing), `systems/render.ts` (turret view), `systems/look.ts` (Blackout), `systems/netHost.ts`/`netClient.ts` (one field/call), `ui/debugPanel.ts`, `dev/testLinks.ts`. Content registration: `data/bestiary.ts`, `data/codex.ts`, `scripts/icons.mjs`, generated `data/iconArt.ts`. `scripts/coop-test.mjs` adds the three types and the six-event/guest-relic/anchor scenario. No reformatting of shared files, no CSS or screen changes, no save changes.

## Limits / follow-up

- Event assists credit the host hero; owned Cinder blasts explicitly credit their owner. Event-assisted kills produce the existing rewards and can advance the host's kill relics.
- Gravity moves enemies, not heroes or player bullets, avoiding client movement prediction corrections.
- Turrets are temporary support stations, not damageable arena props. Their visual barrels face outward; hit tracers show the actual selected target.
- Relic live modifiers are authoritative; clients see inventory, effects, charge and the existing synced stats, not a new buff HUD.
- The fallback benchmark uses software GL, so its rendered FPS is not a hardware FPS claim. CPU simulation is the useful comparison.
- No unfinished requested feature. Human tuning and larger cross-difficulty bot samples are sensible follow-up work.

## Decision-log paragraph for the lead

2026-10-19 — director2 adds bounded 0.78–1.18 adaptive horde pressure with 6 s near-death breathers and deferred-pressure repayment, without changing boss HP/difficulty curves; six rewarded classic events; twelve rule relics with unique icons; and Bastion Porter, Blink Ranger and Bomb Courier. The host owns gameplay and sends a small `d2` snapshot beside existing event/effect records. Existing instancing, gaits, threat cues, relic UI and snapshot codecs are reused. See `notes/lanes/director2.md` for tuning, tests, A/B reports and integration hooks.
