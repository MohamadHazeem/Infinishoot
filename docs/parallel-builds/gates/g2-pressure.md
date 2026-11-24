LANE g2-pressure: a pressure director that pushes back on strong players, and boss soft enrage.

Owns: src/game/director.ts and src/game/systems/director2.ts, src/game/systems/spawning.ts, src/game/bossRules.ts, the boss timer logic in src/game/systems/bossFight.ts, tests/g2pressure.test.ts, notes/lanes/g2-pressure.md.

Build:
1. Power score: measured from what the team actually does over a rolling 30-60 s window (kill rate vs spawn rate, damage taken per minute, time at full life, idle time, average time-to-kill of elites). Keep the existing "adaptive pacing from the weakest teammate" for co-op fairness but stop it from making a strong team's game easier than baseline.
2. Push back when the power score is high: more alive enemies (up to the existing caps), more elites and champions, faster ring spawns, more shooters. Ease off only down to the baseline, never below it on Normal+. Bounded and smooth (no sudden spikes); readable (new waves announce themselves).
3. Boss soft enrage: each boss has a target kill time (by stage); after it the boss speeds up, adds an extra attack pattern from its own set every 20 s and its damage rises 10% per step; a visible ENRAGE warning and timer. Assist difficulty: enrage only much later.
4. Co-op: host-only logic; clients get any visible state through the existing boss snapshot/bus.
5. Telemetry hook: expose the power score in the run summary (src/game/systems/telemetry.ts additive one-liner) so playtests can tune it.
6. Tests for the score, the bounds and the enrage timing. Report how the god bot's runs change (alive count, elites per stage, boss times).
