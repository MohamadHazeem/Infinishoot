# Lane: balance

A repeatable balance sweep (`npm run sweep`), an analysis of every loadout kit, hero, difficulty and the Milestone 11 systems, and a small, evidence-based tuning pass on the loadout data.

## The sweep

`npm run sweep` (scripts/balance-sweep.mjs) bundles scripts/balance/sweepRunner.ts with rolldown and runs it in parallel child processes, one headless game per config (jsdom, the real `Game`, the dev bot from src/dev/bot.ts driving it, like tests/smoke.test.ts). It writes `notes/balance/sweep-<date>[-tag].md` (tables) and `.json` (every run).

Sets (all by default, `--sets=` to pick):
- **bench**: the boss bench. Straight to each loop-1 boss with every loadout item at the same ranks (round-robin over its tracks): King at stage 1 with 3 ranks, Rex at 2 with 5, Queen at 3 with 7, Omega at 4 with 9 plus evolution 1 or 2. No auto weapons, Mods, ultimate, mech, crates, cash-ins, chests or Nuke, god mode. This measures the kit alone and is the main yardstick for kit fairness.
- **herobench**: the same bench for all 7 heroes with the default kit, ultimate on.
- **kits**: full god runs, Medium, Rookie, one loop (to the Omega kill).
- **mortal**: the same kits as mortal runs (one more seed than the others).
- **heroes**: all 7 heroes with the default kit, god and mortal.
- **diff**: 3 kits x Easy / Medium / Hard, god and mortal.

Kits: the default kit (Buster / Charge Shot / Bomb), each item swapped into the default kit (13 kits), and a 5x5 Latin square (every left x right pair once, specials rotated so every left x special and right x special pair shows up once): 37 kits.

Reported per kit: boss kill times per boss (vulnerable seconds: entrance and phase roars don't count), stage reached and death causes (mortal), level and loadout ranks per stage, DPS by source over the run and on bosses, first evolution, gold earned, and the Milestone 11 counters (mechs, super weapons, cash-ins, mutant kills, comeback seconds, overloads, relics, Mods). A speed index (geometric mean over bosses of median-kit time / kit time) flags kits outside the 0.63-1.60 band; item main effects average the index over every kit holding the item.

Options: `--seeds=2` (seeds per config), `--jobs=` (parallel processes, default half the cores), `--kits=rail/charge/bomb,...`, `--tag=`, `--quick` (bench only, 1 seed), `--from=x.json` (rebuild a report), `--compare=before.json,after.json [--out=x.md]` (before/after summary), `--merge=` / `--append=` / `--seed0=` (add sets or seeds to an earlier sweep), `--bundle=out.mjs` / `--runner=out.mjs` (bundle a runner from one source state and run it later, e.g. to measure the old data with today's harness: `git stash` the data, `--bundle`, `git stash pop`).

Cost: a full sweep is ~720 runs. On an idle machine a full god run takes ~25 s and a bench fight ~7 s of wall time; on the shared build machine (load 60-150) the full sweep took ~2 h with 6 jobs, the bench alone ~25 min.

### Making the bot measure kits, not its own blind spots
The runner adds a few player-like habits on top of the dev bot (all in sweepRunner.ts, nothing in src/ changed):
- **Deterministic**: `Math.random` is seeded and `performance.now()` is a simulated clock (music-beat timing, rewind and voice gates read it, so runs used to depend on machine speed: the same config gave King times of 18.8 s and 25.1 s). Same seed, same data, same run; any data change then shows up as a real difference.
- **Specials at the boss**: the bot only fired its special into crowds, so specials barely touched bosses; it now also fires when the boss is within 12 m.
- **Charge Shot is released when full** (the bot held right click on a fixed 1.4 s beat, so Quick Charge did nothing and a held full charge blocked the left click).
- **Aegis Shield closes in**: the bot circles bosses 8 m out, where a contact shield never touches them (or Exposes them); with the shield up or ready it moves in to ~2.5 m.
- **Mortal runs dodge telegraphs**: dash through boss shockwave rings and step out of red ground-strike circles. Before this, "King Bopper's shockwave" and "Ground strike" caused 22 and 21 of the deaths in 111 mortal runs (the top two): the bot walked through every telegraph.
- **Portal unstick** (added after the final sweep): the bot walks straight at the portal and about 1 god run in 50 hung on a wall in front of it for the rest of its time (stage times of 700-1200 s in the tables); after 15 s it now steps onto the portal.

## Findings (before)

Final "before" = today's harness with the original data (`notes/balance/sweep-2026-10-19-before.md`).

1. **The known outlier did not reproduce.** Rail Driver, Orbital Strike and Blizzard kits do not kill bosses 3-5x faster. Full god runs (4 seeds): rail 0.80, orbital 0.96, blizzard 0.98 item index (rail is the *slowest* left click); bench: rail 0.96, orbital 1.06, blizzard 0.98. All 37 kits were already inside the 1.6x band in full runs (0.66-1.46), because since that note the bosses lane added phase clamps and roars (a burst can't skip a phase) and the hero ultimate does ~30% of all boss damage whatever the kit.
2. **The real kit outliers** (bench, kit alone, index 0.65-1.38, spread 2.12):
   - **Aegis Shield** was the weakest item: 3-25 boss DPS (it's a contact weapon and only blocked bullets), so shield kits also never Exposed bosses (+30% damage from everything for 4 s after a right-click hit). Bench 0.79; Buster / Shield / Bomb 0.65.
   - **Buster** (the default left click) was the weakest left click: 217-824 boss DPS vs Pulse Laser 401-1827, bench 0.89, full runs 0.88. The default kit (Buster / Charge Shot / Bomb) was among the slowest kits everywhere (bench 0.92; full god 0.66).
   - **Pulse Laser** was the strongest (bench 1.19, full runs 1.23), mostly Prism Lance: 1827 boss DPS vs Scorch Ray 853 (the two evolutions should be a choice, not a trap).
   - **Rail Driver**: Ion Rail 1512 vs Storm Rail 827; rail kits were the slowest left click in full runs (0.80) and in mortal runs (2.11 stages cleared vs 2.89 overall), where its 1.6 shots a second leave crowds standing.
   - **Bomb** special: 8-44 boss DPS (flat 80 damage per wave every ~15 s), the weakest special on bosses.
3. **Heroes** (hero bench, default kit, ultimate on): Twin 1.66 (out of band), Rookie 1.43, Duelist 1.11, Ace 1.01, Dash 0.81, Bulwark 0.76, Furnace 0.75. Rookie's Mega Barrage and Twin's Mirror Storm do ~48% of all boss damage (the other ultimates 6-16%): their bullets bypass `ultTuning.bossMul` (0.35), which only `hitUlt` applies, bullet ultimates deal full damage to bosses (src/game/systems/statuses.ts bullet hits). Not changed here (code, not data); see Unresolved.
4. **Milestone 11 systems are not outliers.** Per god run (one loop): 2.7 mechs (87 s piloted), 12.5 super weapons, 36 cash-ins, 66 mutant kills, 4.3 relics. Shares of all / boss damage: mech 2.8% / 1.9%, super weapons 2.4% / 3.1%, cash-in bomb 2.1% / 1.7%, the gameplay-lane relics 2.8% / 0.6%. Comeback mode fires rarely (4.7 s per mortal run). Weapon overload never fired in any run: it needs all six weapon slots maxed, which takes past loop 1 (loadout ranks at stage 4: 24-31 of 36 plus evolutions). The cash-in bomb's damage is uncapped (`bombDmg + 0.5 x combo`), but the x1.5 cost growth per cash-in keeps it to ~2-3% of boss damage. No change.
5. **Economy after the 9 economy Mods went**: 75-175 gold per stage (god runs 463 per loop, mortal 367), the bot fills all 5 Mod slots by stage 3-4 (4.8 Mods per mortal run) and gold piles up from stage 4 (it never upgrades Mods). Gold isn't scarce for a Mod build, and isn't a balance outlier. No change.
6. **Difficulty**: mortal stages cleared (3 kits x 2 seeds) Easy 3.7, Medium 3.0, Hard 2.0; god boss times on Hard are ~1.5x Medium. Within a run, mortal deaths spread over stages 1-4 as 9 / 10 / 12 / 33 of 111 runs (stage 4 is the wall: Omega, its shockwaves and the ring-of-fire duel). The ring of fire (boss duel) is the single biggest killer (10 deaths, any stage).
7. **The Hive Queen with a kit alone is a heal race**: her hives heal ~0.8% of her life a second, about what a 7-rank kit deals, so bench Queen times swing from 80 s to 300 s on the same kit. Full runs (auto weapons, Mods) kill her as fast as the other bosses (median 12.7 s), so the bench index leaves her out.

## Changes (all data; src/data/weapons.ts and src/data/specials.ts)

| item | change | reason |
|---|---|---|
| Buster | base damage 10 -> 11; Heavy Rounds +2/+2/+2/+3 -> +3 each; Rapid Fire +1/+1/+1.2/+1.3 -> +1.2/+1.2/+1.4/+1.6 fire rate; Flare Buster x1.15 -> x1.25 damage | weakest left click and the default kit; its boss DPS was ~55% of the Pulse Laser's |
| Aegis Shield | bounces bullets back from rank 0 (`reflect` 0 -> 1; Mirror Aegis keeps the full dome); damage 30 -> 40; Shield Bash +12/15/18/22 -> +15/18/22/26; cooldown 5 -> 4.5 s | reflected boss bullets now hurt and Expose the boss, so shield kits stop losing the +30% Expose bonus; weakest right click |
| Pulse Laser | Prism Lance x1.15 -> x1 damage; Scorch Ray x1.35 -> x1.5 damage; Focus +70/80/90/110 -> +60/70/80/100 | strongest left click; Prism Lance was 2.1x Scorch Ray on bosses |
| Rail Driver | fire rate 1.6 -> 1.8; Coil Power +30/35/40/45 -> +35/40/45/50; Storm Rail x1.1 -> x1.25 damage | slowest left click in full and mortal runs; Storm Rail was 0.55x Ion Rail |
| Bomb | damage 80 -> 100; Payload +30/30/30/40 -> +40/40/45/55 | weakest special on bosses and part of the default kit |

Card texts follow the numbers (Flare Buster, Prism Lance, Scorch Ray and Storm Rail state their multipliers; the shield says it bounces bullets back). tests/shop.test.ts now derives the Buster card's expected DPS from the data instead of hard-coding 70 / 84.

Rounds (bench, 2 seeds, against the same harness): round 1 (Buster, shield reflect, laser evolutions, Storm Rail) lifted the default kit 0.74 -> 1.02 but the shield barely moved (the bot never got close: the shield policy above came from this); round 2 (shield damage, bomb) took the bench spread 2.23 -> 1.78; round 3 (Rapid Fire, Flare) and round 4 (Shield Bash, shield cooldown, Coil Power, Focus) to 1.65; round 5 (rail fire rate) after the full sweep still showed rail last in full and mortal runs.

## Before -> after

Full tables: notes/balance/sweep-2026-10-19-before.md, notes/balance/sweep-2026-10-19-after.md (and .json); summary: notes/balance/compare-2026-10-19.md. Seeds: bench 2, herobench 3, kits 4, mortal 3, heroes 2, diff 2.

- **Boss bench (kit alone)**: spread 2.12 -> 1.65, range 0.65-1.38 -> 0.76-1.25, 37/37 kits in the band before and after. Item main effects 0.79-1.19 -> 0.91-1.13: Buster 0.89 -> 0.92, Laser 1.19 -> 1.08, Rail 0.96 -> 0.97, Shield 0.79 -> 0.91, Grenade 1.17 -> 1.09, Bomb 0.97 -> 0.95. Default kit 0.92 -> 0.99 (Buster / Shield / Bomb 0.65 -> 0.76, the slowest kit). Boss DPS of the item itself: Buster 217/260/308/722/824 -> 259/363/443/991/1104; Shield 15/25/3/99/56 -> 76/76/79/134/149; Prism Lance / Scorch Ray 1827/853 -> 1569/950; Ion / Storm Rail 1512/827 -> 1748/1115.
- **Full god runs (4 seeds)**: kit index range 0.66-1.46 -> 0.72-1.50, spread 2.19 -> 2.10, 37/37 in band both. Item main effects 0.80-1.23 -> 0.87-1.11 (Laser 1.23 -> 0.98, Rail 0.80 -> 0.95, Buster 0.88 -> 0.96, Shield 0.87 -> 0.87). Median boss times King 13.5 -> 13.3 s, Rex 13.1 -> 12.1 s, Queen 12.7 -> 12.6 s, Omega 17.6 -> 21.2 s.
- **Mortal runs (Medium)**: 2.89 -> 2.86 stages cleared of 4 (a wash, as intended: the buffs went to the weak items, the laser nerf to the strongest). Rail 2.11 -> 2.44; Shield 2.39 -> 2.33. Run-to-run noise is about +-0.4 stages per item (Blizzard, unchanged, moved 3.17 -> 2.72).
- **Heroes** (hero bench): Rookie 1.43 -> 1.11, Twin 1.66 -> 1.27, Duelist 1.11 -> 1.20, Ace 1.01 -> 1.00, Furnace 0.75 -> 0.85, Bulwark 0.76 -> 0.77, Dash 0.81 -> 0.74; all in band now (the Buster buff makes the default kit carry more, so the ultimate matters less).

## Unresolved / risky
- **Bullet ultimates ignore `ultTuning.bossMul`**: Mega Barrage (Rookie) and Mirror Storm (Twin) do full damage to bosses; ultimates are ~27-30% of all boss damage in full runs. A one-line fix in the bullet-hit path (x `ultTuning.bossMul` for source 'ult' on bosses) would bring them in line with the other ultimates but lengthen every Rookie boss fight; left for the skill/ultimates owner to decide.
- **Noise**: per-kit numbers from full runs move +-30% between seeds (one changed card pick snowballs); trust item main effects and the bench over single full-run kits. Mortal results need many more seeds than were affordable here.
- **The bot is still a bot**: it kites at 8 m, picks the first card, never upgrades Mods, doesn't rush chests. Melee and positional kits (shield, Furnace's stand-still heat, Gravity Well's pull) are still measured imperfectly.
- **Ring of fire** (the boss duel) is now the top killer of the mortal bot (10-11 deaths); the bot doesn't understand the ring. Not tuned.
- Not changed, but worth a look by their owners: the Queen's hive heal against weak builds (a heal race below ~0.8% of her life per second), weapon overload never firing in loop 1, and the bot hanging on a wall in front of the portal (~1 god run in 50; real players may hit it too if the portal opens behind cover). The sweep covers Standard mode only (not Endless, Boss Rush or the route-map special nodes beyond the bot's first road).
- No person played the changes; feel (shield reflection, faster Buster) is unverified.

## Files
New: scripts/balance-sweep.mjs, scripts/balance/sweepRunner.ts, notes/balance/ (before/after sweeps, compare), notes/lanes/balance.md. Changed: package.json (`sweep` script), src/data/weapons.ts, src/data/specials.ts, tests/shop.test.ts (Buster card numbers from data).

## Verification
`npm run typecheck`, `npx vite build`, `npm test` (56 files) and `npm run smoke` pass.

## PLAN.md decision-log paragraph
- 2026-10-19: Balance lane (notes/lanes/balance.md). `npm run sweep` runs the dev bot headlessly over 37 loadout kits (each item in the default kit plus a Latin square of left x right x special), 7 heroes and Easy/Medium/Hard, god and mortal, plus a boss bench (each loop-1 boss with only the kit at fixed ranks), and writes notes/balance/sweep-<date>.md/.json. Runs are deterministic (seeded random and a simulated clock), and the bot gained player habits for measuring (special at the boss, release a full charge, close in with the shield, mortal runs dodge shockwaves and strike circles). The Rail/Orbital/Blizzard 3-5x outlier did not reproduce (all kits were inside 1.6x of the median in full runs; rail was the slowest left click). Tuned the real outliers: Buster (base 11 damage, stronger Heavy Rounds and Rapid Fire, Flare x1.25), Aegis Shield (bounces bullets from rank 0, damage 40, Shield Bash up, cooldown 4.5 s), Pulse Laser (Prism Lance x1, Scorch Ray x1.5, Focus -10/rank), Rail Driver (1.8 shots/s, Coil Power +5/rank, Storm Rail x1.25), Bomb (100 damage, Payload +40/40/45/55). Boss bench spread 2.12 -> 1.65 (item effects 0.79-1.19 -> 0.91-1.13), full-run item effects 0.80-1.23 -> 0.87-1.11, mortal stages unchanged (2.89 -> 2.86), hero bench 0.75-1.66 -> 0.74-1.27. Open: bullet ultimates (Mega Barrage, Mirror Storm) skip the boss damage multiplier.
