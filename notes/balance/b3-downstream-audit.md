# Stage-12 downstream tolerance audit

All eight runs have identical boss and stage records through stage 10; their first gameplay difference is Titan. Omega definitions, attacks and health are unchanged. The earlier Titan finish changes subsequent timing and the random stream. End-of-run relic lists differ in all eight pairs, while Mods, auto-weapon ranks and total ranks match; hero level differs by at most two. This is consistent with a downstream timing/loot effect, not proof that Omega itself was retuned.

| Kit / seed | Omega vulnerable seconds before → after | Stage 12 clear seconds | Level | Ranks | Omega HP |
|---|---|---|---|---|---|
| scatter/grenade/storm / 2 | 3.2 → 3.6 | 261 → 262 | 103 → 103 | 36 → 36 | 4347000 → 4347000 |
| scatter/grenade/storm / 1 | 28 → 17.1 | 303 → 290 | 103 → 102 | 36 → 36 | 4347000 → 4347000 |
| buster/charge/bomb / 2 | 30.1 → 27.7 | 335 → 336 | 103 → 102 | 36 → 36 | 4347000 → 4347000 |
| buster/charge/bomb / 1 | 86.6 → 66.4 | 414 → 392 | 103 → 101 | 36 → 36 | 4347000 → 4347000 |
| laser/well/meteor / 1 | 5.1 → 5 | 265 → 264 | 102 → 102 | 36 → 36 | 4347000 → 4347000 |
| laser/well/meteor / 2 | 7.8 → 16.6 | 288 → 293 | 102 → 102 | 36 → 36 | 4347000 → 4347000 |
| whip/sentry/blizzard / 1 | 19.8 → 34.5 | 304 → 316 | 99 → 99 | 36 → 36 | 4347000 → 4347000 |
| whip/sentry/blizzard / 2 | 28.9 → 17.5 | 311 → 308 | 117 → 117 | 36 → 36 | 4347000 → 4347000 |

Stage 12 median time: 303.5 → 300.5 (-1.0%).

Stage 12 median level: 103 → 102 (-1.0%).

Stage 12 median ranks: 36 → 36 (0.0%).

Stage 12 median kills: 43001 → 42326 (-1.6%).

Omega vulnerable-time median: 23.90 → 17.30s (−27.6%, OUTSIDE the 25% raw TTK tolerance). This is not silently marked PASS. All stage-clear/level/rank/kill medians stay inside 25%. No compensating Omega nerf is applied: its unchanged HP/mechanics and differing relics/timing do not establish an independent Omega tuning defect. The lead should assess this downstream variance with additional seeds if strict raw-boss parity is required; the three requested balance targets pass.
