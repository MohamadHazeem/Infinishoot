LANE g2-skillbot: the "skilled bot", a mortal autopilot that plays like a good human, and the harness that measures the game with it. Every later balance decision is measured with this, never with the invincible bot again.

Owns (new files): src/dev/skillBot.ts, scripts/skillbot.mjs, tests/skillbot.test.ts, notes/lanes/g2-skillbot.md. Shared, additive only: src/dev/bot.ts (register `window.skillRun`), package.json (one script line `"skillbot": "node scripts/skillbot.mjs"`). Do NOT change the existing bot's or src/game/autopilot.ts's behaviour (the balance sweep and co-op autopilot depend on them); read them and reuse helpers.

Build:
1. A mortal skilled bot (god mode OFF) that: dodges telegraphed attacks (lunge flash, charge lines, fuse rings, boss slam/strike zones, sniper aim lines, enemy bullets on a collision course) using the dash and movement; kites crowds instead of standing in them; parries when a parry is possible; uses its special and right click sensibly; picks level-up cards and shop Mods with a simple build plan (synergy with owned tags) instead of always the first card; routes on the route map. It must read only game state a human could see (positions, telegraphs, bullets), not future RNG.
2. Reaction realism knobs: reaction delay (default 180 ms), aim error (default small), decision rate (default 10 Hz). Export a `skillTuning` object.
3. `window.skillRun(seconds, opts)` returns a report like botRun's plus: died (bool), stage reached, cause of death (enemy/boss/hazard id and the last 5 hits taken), damage taken per stage, boss fight durations, dashes/parries used.
4. `npm run skillbot -- --runs 20 [--difficulty normal] [--seed N] [--jsdom]` runs N runs (jsdom by default like the smoke test: fast, no browser) with different seeds and prints a table: clear rate per stage, loop clear rate (stage 4 boss beaten), median stage reached, top 5 causes of death, mean run time. Writes a JSON report to notes/perf/skillbot-<date>.json.
5. Calibrate: on today's game (before Gate 2 makes it harder), report the numbers for Easy, Normal and Hard with 20 runs each. The bot must die sometimes (if it never dies on Hard, it is too strong; lower its skill until Hard clears a loop in roughly 50-80% of runs today, since Gate 2 will make the game harder and target 40-60% on the NEW Normal).
6. Unit test: the bot dodges a scripted lunge/charge that the idle bot would be hit by; skillRun returns all report fields.

Report the calibration table in your notes and summary.
