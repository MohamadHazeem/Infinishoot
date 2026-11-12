# Ascension cumulative rule audit

Multipliers below stack on Hard. Chest interval uses the normal 30-second cadence. Rings warn for 1 second, every 8 seconds, speed 7, base damage 12.

| Level | Rule | Life | Damage | Speed | Count | Chest frequency | Chest interval | Elite effects | Stage healing | Bonus bullets |
|---|---|---|---|---|---|---|---|---|---|---|
| A0 | Hard baseline | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 | 30s | 1x | on | 0 |
| A1 | Quick Feet | 1.00 | 1.00 | 1.10 | 1.00 | 1.000 | 30s | 1x | on | 0 |
| A2 | Reinforced | 1.15 | 1.00 | 1.10 | 1.00 | 1.000 | 30s | 1x | on | 0 |
| A3 | Crowded | 1.15 | 1.00 | 1.10 | 1.15 | 1.000 | 30s | 1x | on | 0 |
| A4 | Hard Knocks | 1.15 | 1.10 | 1.10 | 1.15 | 1.000 | 30s | 1x | on | 0 |
| A5 | Double Trouble | 1.15 | 1.10 | 1.10 | 1.15 | 1.000 | 30s | 2x | on | 0 |
| A6 | Lost Cargo | 1.15 | 1.10 | 1.10 | 1.15 | 0.500 | 60s | 2x | on | 0 |
| A7 | Encore | 1.15 | 1.10 | 1.10 | 1.15 | 0.500 | 60s | 2x | on | 8 |
| A8 | No Breather | 1.15 | 1.10 | 1.10 | 1.15 | 0.500 | 60s | 2x | off | 8 |
| A9 | Quicker Feet | 1.15 | 1.10 | 1.20 | 1.15 | 0.500 | 60s | 2x | off | 8 |
| A10 | Heavy Armour | 1.35 | 1.10 | 1.20 | 1.15 | 0.500 | 60s | 2x | off | 8 |
| A11 | Overflow | 1.35 | 1.10 | 1.20 | 1.35 | 0.500 | 60s | 2x | off | 8 |
| A12 | Harder Knocks | 1.35 | 1.25 | 1.20 | 1.35 | 0.500 | 60s | 2x | off | 8 |
| A13 | Supply Drought | 1.35 | 1.25 | 1.20 | 1.35 | 0.333 | 90s | 2x | off | 8 |
| A14 | Double Encore | 1.35 | 1.25 | 1.20 | 1.35 | 0.333 | 90s | 2x | off | 16 |
| A15 | Overclocked | 1.35 | 1.25 | 1.30 | 1.35 | 0.333 | 90s | 2x | off | 16 |
| A16 | Fortified | 1.55 | 1.25 | 1.30 | 1.35 | 0.333 | 90s | 2x | off | 16 |
| A17 | Packed House | 1.55 | 1.25 | 1.30 | 1.60 | 0.333 | 90s | 2x | off | 16 |
| A18 | Crushing Blows | 1.55 | 1.40 | 1.30 | 1.60 | 0.333 | 90s | 2x | off | 16 |
| A19 | Last Supplies | 1.55 | 1.40 | 1.30 | 1.60 | 0.200 | 150s | 2x | off | 16 |
| A20 | Summit | 1.75 | 1.40 | 1.30 | 1.60 | 0.200 | 150s | 2x | off | 24 |

Step checks compare successive changes to the same rule (intervening unchanged levels have zero steps).
- hp: 0.15, 0.2, 0.2, 0.2; largest neighbouring step ratio 1.33x (PASS).
- damage: 0.1, 0.15, 0.15; largest neighbouring step ratio 1.50x (PASS).
- speed: 0.1, 0.1, 0.1; largest neighbouring step ratio 1.00x (PASS).
- count: 0.15, 0.2, 0.25; largest neighbouring step ratio 1.33x (PASS).
- chest: 0.5, 0.333, 0.4; largest neighbouring step ratio 1.50x (PASS). Steps are fractional reductions in supply rate, the rule used by gameplay.
- attacks: 1, 1, 1; largest neighbouring step ratio 1.00x (PASS).
- Boolean rules each switch once and remain on; no reversal. Chest intervals: 30 -> 60 -> 90 -> 150s; interval increases 30/30/60s; largest neighbouring increase 2.00x.
