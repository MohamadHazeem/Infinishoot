# Gate 2 · Build ceilings

Rookie’s first three Power Cells still give +10% damage each. Rank four brings the total to +38%, and rank five to +45%. Upgrade cards give the base effect and the effective before/after totals. Pause → YOUR BUILD shows permanent equipment totals, fire rate, the multiplier on the last Mod-processed hit, and the hero’s kill-heal limit. These readouts work in English and Arabic.

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

Existing cooldown floors can bind first. Five Rapid Coils give 35.87% shorter cooldowns, or ×1.56 fire rate. Five Armour Plates give 4.43 armour. Glass Cannon retains its life tradeoff and ×2 factor, which counts toward the hit ceiling. The standalone 40% Overclock and 50% Adrenaline benefits retain their own knees. Capacitor and charge Mods share a curve with a 50% knee when a charge Mod is present. Runner's High and Adrenaline use the pre-curve cooldown when active. Nearby Rally Banners and Bond of Steel extend the receiver’s existing curve. Time-limited skill rewards, mech abilities and guaranteed-crit windows keep their combat rules.

## Damage and sustain

- The ordered positive Mod hit multiplier stays linear through ×5 and approaches ×8. For example, raw ×14 becomes ×7.25. Each slot applies the ratio of its new and previous effective products. A flat bonus still benefits from the multipliers to its right. Damage penalties keep their full factor. Flat damage, status multipliers and crits have distinct roles in the existing pipeline.
- Echo follows the shipped shop regression. A level-N slot scales its bonus linearly once. Echo copies that resolved slot once in order. For example two level-2 Kindling applications contribute ×1.8 each before the combined ceiling. The shop uses the same engine as combat.
- Overdrive adds **8, 7, 6, 5, 4, 3, 2, 2%** of pre-Overdrive damage. Rank eight gives **+37%**. Maxed items leave the offer pool. Older build keys with excess ranks resolve to eight. Momentum counts the first eight level-ups after purchase, down from twenty. Its per-rank ceiling is ×1.4 / ×1.8 / ×2.2. Legacy counters above eight also use those maxima.
- All healing received during a kill resolves against the recipient’s rolling one-second budget of **min(3 life, 3% of max life)**. A 40-life Glass Cannon can recover at most 1.2 life in that interval. Vampire Fang, Blood Charm, Mercy Coin and ally shares spend the same per-hero budget. Only actual recovery spends it. Rings aggregate same-step kills, include nested explosions, and reset for a fresh run. The existing Fang rate taper still applies inside the hard limit. Hearts and ordinary regeneration keep their existing amounts.
- The host applies every gameplay change. The private snapshot carries one optional, hundredth-precision Mod multiplier for the pause readout. Clients rebuild permanent totals from the mirrored loadout. Snapshot and build readers retain compatibility with earlier data.

## Invincible bot measurement

Paired Normal, Rookie, Buster / Charge Shot / Bomb, seeds 1–3, routes off, natural shop and level-up choices. Both versions use the repository’s single-process sweep runner and real invincible autopilot. The baseline bundle was frozen from `6751d85` before editing. Time is simulated seconds. The stage boss is identified by name so an optional Golden King encounter does not replace the Hive Queen or Boxer Jack measurement.

