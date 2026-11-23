# Gate 2 · Build ceilings

Rookie’s first three Power Cells still give +10% damage each. Rank four brings the total to +38%, and rank five to +45%. Upgrade cards give the base effect and the effective before/after totals. Pause → YOUR BUILD shows permanent equipment totals, fire rate, the multiplier on the last Mod-processed hit, and the hero’s combined kill and leech healing limit. These readouts work in English and Arabic.

## Permanent stats

Bonuses add in the existing hero, passive, relic, pet and equipment-set calculation. Up to the knee, effective bonus equals raw bonus. Above it, let `extra = raw − knee` and `room = limit − knee`. The effective bonus is `knee + room × extra / (room + extra)`. The slope is continuous at the knee. Penalties retain their original value. The same calculation supplies combat, passive cards and shop stat previews.

| Stat | Full value through | Limiting bonus |
| --- | ---: | ---: |
| Damage | +30% | +85% |
| Right-click damage | +60% | +130% |
| Weapon cooldown reduction, which drives fire rate | 24% | 70% |
| Right-click charge speed | +45% | +110% |
| Crit chance above the starting 5% | +24 percentage points | +65 points (70% total) |
| Crit damage above the starting ×2 | +0.90 | +2.10 (×4.10 total) |
| Area | +30% | +75% |
| Special cooldown reduction | 36% | 55% |
| Dash cooldown reduction | 30% | 50% |
| Life per kill, as a percentage of max life | 0.15% | 0.24% |
| Armour | 3 | 8 |
| Move speed | +24% | +65% |

Existing cooldown floors can bind first. Five Rapid Coils give 35.87% shorter cooldowns, or ×1.56 fire rate. Five Armour Plates give 4.43 armour. Glass Cannon retains its life tradeoff and ×2 factor, which counts toward the hit ceiling. The standalone 40% Overclock and 50% Adrenaline benefits retain their own knees. Capacitor and charge Mods share a curve with a 50% knee when a charge Mod is present. Runner's High and Adrenaline use the pre-curve cooldown when active. Nearby Rally Banners and Bond of Steel add the marginal gain on the receiver’s permanent curve. A timed buff can coexist with that gain. Time-limited skill rewards, mech abilities and guaranteed-crit windows keep their combat rules.

## Damage and sustain

- The ordered positive Mod hit multiplier stays linear through ×5 and approaches ×8. For example, raw ×14 becomes ×7.25. Each slot applies the ratio of its new and previous effective products. A flat bonus still benefits from the multipliers to its right. Damage penalties keep their full factor. Glass Cannon, Overloader on an Overload reaction, Shatterpoint on a shatter and the equipment share of shock damage all count. Native shock vulnerability and crits apply separately. A weapon firing a special shot or creating extra projectiles still uses its own attack rules.
- Echo follows the shipped shop regression. A level-N slot scales its bonus linearly once. Echo copies that resolved slot once in order. For example two level-2 Kindling applications contribute ×1.8 each before the combined ceiling. The shop uses the same engine as combat.
- Overdrive adds **8, 7, 6, 5, 4, 3, 2, 2%** of pre-Overdrive damage. Rank eight gives **+37%**. At eight ranks the item leaves the Overdrive pool. Black Hole and Gravity Well include collapse damage. Revive Drone has no rank-scaled damage parameter and leaves the pool after its tracks and evolution. Older build keys with excess ranks resolve to eight. Momentum counts the first eight level-ups after purchase, down from twenty. Its per-rank ceiling is ×1.4 / ×1.8 / ×2.2. Legacy counters above eight also use those maxima.
- Medic beam self-leech and healing received during a kill resolve against the recipient’s rolling one-second budget of **min(3 life, 3% of max life)**. A 40-life Glass Cannon can recover at most 1.2 life in that interval. Vampire Fang, Blood Charm, Mercy Coin and ally shares spend the same per-hero budget. Only actual recovery spends it. Rings aggregate same-step kills, include nested explosions, and reset for a fresh run. The existing Fang rate taper still applies inside the hard limit. Hearts and ordinary regeneration keep their existing amounts.
- The host applies every gameplay change. The private snapshot carries one optional, hundredth-precision Mod multiplier for the pause readout. Clients rebuild permanent totals from the mirrored loadout. Snapshot and build readers retain compatibility with earlier data.

## Invincible bot measurement

Paired Normal, Rookie, Buster / Charge Shot / Bomb, seeds 1–3, routes off, natural shop and level-up choices. Both versions use the repository’s single-process sweep runner and real invincible autopilot. The baseline bundle was frozen from `6751d85` before editing. Time is simulated seconds. The stage boss is identified by name so an optional Golden King encounter does not replace the Hive Queen or Boxer Jack measurement.

The first two time columns are median spawn-to-kill time for the actual stage boss. The final columns replay each stage-end build against one stage-3 Hive Queen with 77,280 HP, using the revised rules. “Vulnerable” counts seconds when the Queen could take damage. Each cell is the median of three runs.

| Stage | Stage boss | Before (s) | After (s) | Same Queen (s) | Same Queen vulnerable (s) |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | King Bopper | 19.4 | 19.4 | 125.6 | 119.7 |
| 2 | Rampage Rex | 14.0 | 20.2 | 39.4 | 34.2 |
| 3 | Hive Queen | 50.1 | 48.3 | 22.6 | 17.1 |
| 4 | Omega Overlord | 20.4 | 19.9 | 16.3 | 10.8 |
| 5 | Glitch DJ | 16.5 | 16.6 | 15.6 | 10.2 |
| 6 | Boxer Jack | 16.3 | 19.0 | 12.4 | 6.9 |

All six paired runs cleared six stages. In the revised campaign the fastest median boss kill came at **stage 5**, then stage 6 took 2.4 seconds longer. The stage-3 Queen still took 48.3 seconds in a live run. The fixed-target replay shows equipment gains continued through stage 6. The Buster ended stage 6 at Overdrive ranks 6, 8 and 8 respectively. Those two measurements answer different questions because campaign bosses vary in HP, movement and attack patterns.

**One build stopped getting faster at stage 8.** Extending seed 1 to ten clears, the same Queen took 14.2, 13.6, 13.0, 13.0 and 13.0 seconds with the builds from stages 6–10. The final three each had 7.6 vulnerable seconds. Buster, Charge Shot and Bomb had all reached Overdrive 8 by the end of stage 7. In the actual campaign, that seed took 25.3 seconds on Admiral Gale (7), 22.0 on Omega Overlord (8), 31.3 on Cake Tyrant (9) and 40.4 on Kraken King (10). The plateau is specific to this seed and target.

A separate mortal check replayed the three stage-3 builds against the same Queen. All three won. The first build lost 40 HP to one ground strike, the second lost 5 HP on each of three fire-ring hits, and the third avoided all hits.

To reproduce the campaign measurements, run the following from the repository root on each revision. Repeat with seeds 2 and 3. For the single-seed extension use seed 1, 10 stages and a 4,500-second budget.

```sh
npm run sweep -- --bundle=node_modules/.sweep/ceiling.mjs
SWEEP_CFG='{"kit":["buster","charge","bomb"],"hero":"rookie","diff":"normal","god":true,"seed":1,"secs":2400,"stages":6,"noRoute":true}' node node_modules/.sweep/ceiling.mjs
```

For the fixed target, capture `exportBuild(h, game.level)`, gold and each Mod slot's persistent `st.n` in the sweep runner's `closeStage`. Restore those with `applyBuild` and the saved gold/counters immediately before `debugBoss` in a fresh seed-42 run with `bench: { stage: 3, ranks: 0 }`. The bench keeps team level fixed, starts at full health and suppresses ultimates, level-ups and crate rewards. The original campaign bot and its normal shop decisions are unchanged.

## Review and reproduction

The source changes for this lane, including the paused commit, are listed below.

| Files | Change |
| --- | --- |
| `src/data/passives.ts`, `src/game/synergy.ts` | Permanent and conditional curves, ordered hit calculation, rolling healing window and its lifetime. |
| `src/data/mods.ts`, `src/data/tracks.ts` | Momentum numbers, capped Overdrive progression and legacy build-key handling. |
| `src/game/hero.ts` (shared) | Apply curves once where stat previews and recomputation meet, expose permanent equipment totals, restrict the Overdrive offer. |
| `src/game/game.ts` (shared) | Apply the recipient's budget, combine equipment auras, share shock tuning with the hit calculation, provide the pause totals and carry the last-hit readout in private snapshots. |
| `src/ui/screens.ts`, `src/style.css` (shared) | Effective card numbers and the pause totals panel. |
| `src/i18n/en.ts`, `src/i18n/ar.ts` (shared) | Card labels, cap readouts, Overdrive and Momentum copy. |
| `tests/g2ceiling.test.ts`, `notes/lanes/g2-ceiling.md` | Curve, upgrade, aura, reaction, sustain, snapshot and localization regressions, plus measurements and reproduction details. |

- Fifth Power Cell card — `?test&god&weapons=drones:1,discs:1,mines:1,lightning:1&passives=power_cell:4,rapid_coil:4,lucky_star:4,armor:4,big_bang:4,sneakers:4&levelup&seed=20`.
- Pause totals — `?test&god&seed=42&passives=power_cell:5,rapid_coil:5,armor:5,vampire:3&mods=turret_mode:2,midas:2&gold=50&spawn=bopper:10&setpause=2`. Open **Your Build**. Append `&lang=en` or `&lang=ar` to either link.
- Conditional hit — `?test&god&seed=42&bench&passives=power_cell:5,armor:5,vampire:3&mods=turret_mode:2,midas:2&gold=50&weapons=lightning:2&spawn=chonk:2&spawnr=2&aim=1,0`. Pause after lightning hits and open **Your Build**. Both languages displayed ×6.45.
- Inspected the card and pause screenshots in English and Arabic at 1280×720 and 1920×1080, plus Arabic at 844×390. Both desktop card layouts show +38% → +45%. The short landscape layout uses the existing scrollable card list and “more” prompt. Images are under `shots/g2-ceiling-{card,pause}-*` and `shots/g2-ceiling-hit-*-720.png`.
- Verification on Node 22.23.3 passed for `npm run typecheck`, `npx vite build`, `npm test` (129 files including strict Arabic checks), `npm run smoke`, `npm run coop -- --offline` and `npm run balance`. All four balance kits cleared two stages within the existing 25% tolerance. The co-op run sent 2,280 snapshots averaging 1,820 bytes.
- macOS denied the shell's direct Chromium launch. The browser commands used the headless Playwright MCP browser through a temporary local launch adapter. Gameplay, harness assertions, test tolerances and repository scripts ran as shipped.
- The three-seed sample measures this Rookie kit. An invincible bot cannot measure the Gate 2 first-time-player clear-rate target or prove every mortal build remains vulnerable.
