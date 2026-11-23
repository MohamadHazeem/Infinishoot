# Gates 3–5 balance pass

## Starting point

The integrated branch at `291b5f8` cleared 31 of 40 mortal Rookie runs on Normal (77.5%). All 40 cleared stages one and two, and 38 cleared stage three. The most frequent causes of death were lava (3) and Golden King's shockwave (2). The Gate 5 rules-only checkout had cleared 12/40. Its seven Storm Drones wins represented 58.3% of wins. The same seven leading-weapon wins represented 22.6% on the merged branch.

| Integrated Rookie baseline, seeds 1–40 | Result |
| --- | ---: |
| Buster / Storm Drones / Chain Zap / Glass Gale / Hornet Grid leading wins | 14 / 7 / 5 / 4 / 1 |
| Runs equipping Storm Drones / loop clears with it / clears it led | 10 / 8 / 7 |
| Median Storm Drones damage in its eight clears | 3,010,809 |
| Runs with a crafted weapon / runs triggering at least three journal entries | 11 / 4 |
| Distinct crafting interactions, median over all starts | 0 |
| Average aim / perfect aim on the same Laser, 40 matched seeds | 65,159 / 134,441 (48.47%) |

### Why Storm Drones wins

- In the starting profile, Drones and Chain Zap were both common. A new common auto had weight 2.4, or 3.2 if it completed a weapon combo. Its next ranks had weight 3. A compatible max-rank pair reserves a fusion card even without either evolution item. In 40 runs, the pilot saw 11 Storm Drones cards and took 10. The other rules bind separately. The seven proxy wins included several different rules and an unbound run.
- Fusion uses each parent's **evolved** parameters. Evolved Chain Zap supplied five bolts every 0.64 seconds, ten jumps plus the first target, and 66.44 damage per hit. Storm Drones adds two more jumps and multiplies per-hit damage by 1.1. Its lightning child alone could deliver 7,422.6 base damage per second in a fully packed field. This is a theoretical ceiling before armour, Mods and finite targets. Its Shock and Chain tags give it counters against plated, ethereal and swarm enemies. The drone rider could also roll a three-hop, 45-damage zap every 0.07 seconds. Those extra hits are credited to `zap`. The proxy's Storm Drones total includes the two children.
- All 40 baseline Rookies finished with Quick Draw, Pyromaniac and Hair Trigger. The curated first shop sold all three for 14 of the 15 starting gold. The Buster was therefore a piercing mega-shot and ignition build from the opening shop, with its entire run credited to the same weapon ID. A fusion starts its own damage counter when its parents are consumed.

## Method

Each loop sample starts in a fresh jsdom process. The Gate 2 pilot uses 60 simulation steps per second, 10 Hz decisions, 180 ms reactions, four degrees of aim error, no pet, seasons off and the 2,100-second cap. All stage rates and discovery medians include every start. The wins denominator includes only confirmed stage-four boss kills followed by a clear. Report files went to a temporary directory to preserve the checked-in Gate 2 history.

For the free and path-directed hero cohorts, seed `s` selects hero `(s-1) % 11` in roster order. Each pass through the roster alternates the intended path for the directed cohort, starting with the first path. Only the selected hero's unlock is granted. Both arms use their hero's normal starting kit. The directed adapter picks the first offered card with a progress diamond for its assigned path and prefers its affordable support Mod when the pilot buys. The free arm keeps the stock menu decisions. Combat, healing, routes, costs and RNG use the game. This measures offered paths without forcing gear or granting money.

The leading-weapon proxy compares actual damage credited to equipped weapon IDs and breaks ties by acquisition order, as in the Gate 5 rules lane. The crafting metric counts distinct triggered entries in the fresh profile's Synergy Journal. It includes zeroes for players who never take a frame. The stock shop policy can buy Mods and healing but does not select workbench parts. It can take an offered treasure frame and use gear or chest salvage.

Eight of the eleven heroes use the profile's primary, which is Buster on a fresh profile. Ronin, Medic and Brawler have their own primary. The stock pilot scores left-click ranks at 7, auto ranks at 6 and right-click ranks at 5 before bonuses. Each of Buster's three eligible track cards also had weight 4 at common rarity. This gives the opening weapon three draws' worth of representation before the pilot even scores the hand. Eight journal interactions exist. A fixed recipe can qualify for at most one frame, one core and one modifier interaction. The three-discovery target consequently requires all three matching parts to actually hit, or a re-fit. Merely equipping a frame does not count.

The armour drill uses the armour lane's fixed 12-second encounter, with `window.skillRun` as its mortal seconds runner. The boss drill uses the boss lane's starter Rookie, stage-scaled Drones, held director and 180-second cap. The uncoached arm and practices one through five share the same seeds. Each practice changes the knowledge available to the virtual controller.

## Tuning decisions

| Setting | Before | This pass |
| --- | ---: | ---: |
| Normal enemy health multiplier | 1.15 | 1.25 |
| Normal enemy damage multiplier | 1.05 | 1.30 |
| Each eligible Buster track at common rarity | 4 | 4/3 |
| Random chest part chance after fitting a frame | 45% | 20% |
| Hair Trigger base shop price | 5 | 7 |
| Chain Zap fresh/upgrade rarity weight at zero Luck | 1.0 | 0.6 |
| Evolved Chain Zap targets per bolt, including its first hit | 11 | 10 |
| Storm Drones lightning cooldown | 0.64 s | 0.704 s |
| Storm Drones rider chance / base damage / minimum gap | 40% / 45 / 0.07 s | 30% / 30 / 0.20 s |
| New ordinary auto card weight with 0 / 1 / 2 / 3 auto slots occupied | 2.4 at each step | 2.4 / 1.8 / 1.2 / 0.6 |
| New combo-completing auto card weight at those steps | 3.2 at each step | 3.2 / 2.4 / 1.6 / 0.8 |

The rarity multiplier applies after the new-auto weight. Owned weapons retain their rank weights. A frame still costs an auto slot. Its treasure card now takes the first ordinary slot so it can survive the late two-card draft. Previously, both a ready fusion and the scarcity pass could remove it from the tail of a hand. Evolution forks retain their priority. The last-slot weight also gives players time to decide whether they want to commit it to a standard auto or a frame.

Storm Drones now has a packed-field ceiling of 6,228.75 base lightning damage/second, down 16.1%. Its two extra chain jumps, two evolved children, freed slot and drone rider remain. The 10% fused per-hit bonus pays for a 10% longer cooldown, so its first-target lightning DPS matches evolved Chain Zap. The evolved parent's nine jumps plus the first target now match its advertised ten enemies. The existing fusion description says “every enemy they bonk” even though the rider rolls a chance in both versions. The measured chance is 30% in this pass.

The first 40-seed trial used a flat 0.625 multiplier for new autos, common-to-uncommon Chain Zap and lower standalone evolved lightning damage (54 every 0.78 s). It cleared 19/40 Normal loops, equipped a frame in 25/40 runs and reached a median of two journal entries. Storm Drones led 1/19 wins, Buster 12/19. The Architect regression's fixed Assist kit took 246.3 seconds, past its 240-second limit. A partial restoration (60 every 0.72 s) took 246.8 seconds. Restoring the original single-target rate (66.44 every 0.64 s) and tuning the number of targets instead brought that fight back to its control time of 232.2 seconds. The encounter test and reference HP stayed intact.

With the fitted-slot weighting, first-position treasure and restored single-target Chain Zap, the next 40 Rookies cleared 29/40 at Normal HP 1.15 and damage 1.30. The run median reached three journal entries. Of 40 starters, 31 equipped a frame and 21 triggered three entries. Storm Drones led one clear, while Buster led 21. That was the reason to test the Normal health curve and the three simultaneous Buster rank cards.

At HP 1.40 those same draft settings cleared 19/40, with 15 Buster-led clears and a median of two discoveries. Buster offered three distinct common track cards, each as heavy as a whole click family. Sharing one weight of four across the three tracks keeps their damage, alternate builds and rank limits while making space for other weapons. The random treasure drop rate after fitting a frame also fell from 45% to 20%. A random core or modifier fills an empty socket permanently until the player pays to refit it. The existing gear-salvage selection already checks how many interactions each candidate can make with the equipped tags.

A trial with the shared Buster weight, 1.25 HP and earlier salvage levels (4/8) cleared 18/40. Buster led five of the eighteen wins, and seven distinct weapons led at least one. Median discoveries stayed at two. The delivered tuning uses levels 6/12 as described in the workbench and treasure cards. Both languages display those levels. No new strings were needed.

## Measured outcomes

### Difficulty and aim

| Rookie difficulty | Before clears | Final clears | Stage 1 / 2 / 3 / 4 clears before | Stage 1 / 2 / 3 / 4 clears after |
| --- | ---: | ---: | ---: | ---: |
| Assist | 18/20 (90.0%) | 18/20 (90.0%) | 20 / 20 / 20 / 18 | 20 / 20 / 20 / 18 |
| Normal | 31/40 (77.5%) | 19/40 (47.5%) | 40 / 40 / 38 / 31 | 40 / 38 / 35 / 19 |
| Hard | 5/20 (25.0%) | 4/20 (20.0%) | 19 / 15 / 13 / 5 | 19 / 15 / 12 / 4 |

The final 19 Normal clears used seven different leading weapons. Buster led five, Glass Gale and Chain Zap four each, Prism and Charge Shot two each, and Hornet Grid and Tesla one each. Storm Drones was offered four times, taken three times and equipped in one winning run. It led zero wins. The stock Rookie median moved from zero to two journal entries, with 28/40 fitting a frame and 14/40 discovering three interactions.

| Mortal fixed-Laser fixture, 40 matched seeds | Before | Final |
| --- | ---: | ---: |
| Average damage / perfect damage | 65,159 / 134,441 | 65,279 / 134,801 |
| Average hits / perfect hits | 2,448 / 2,551 | 2,453 / 2,556 |
| Average share of perfect-aim damage | 48.47% | 48.43% |

### Boss practice

Each cell gives wins out of 40 for the uncoached encounter followed by practices 1, 2, 3, 4 and 5. Each side of the comparison covers 960 mortal encounters.

| Boss | Before, first / 1 / 2 / 3 / 4 / 5 | Final, first / 1 / 2 / 3 / 4 / 5 |
| --- | ---: | ---: |
| King | 20 / 30 / 39 / 40 / 40 / 40 | 15 / 24 / 39 / 40 / 40 / 40 |
| Rex | 1 / 2 / 29 / 31 / 29 / 30 | 0 / 1 / 27 / 23 / 19 / 24 |
| Queen | 4 / 9 / 36 / 40 / 40 / 40 | 2 / 7 / 37 / 40 / 40 / 40 |
| Omega | 0 / 24 / 22 / 28 / 24 / 30 | 0 / 25 / 21 / 26 / 22 / 25 |

All four first attempts finished below half. By practice five King rose from 37.5% to 100%, Rex from 0% to 60%, Queen from 5% to 100% and Omega from 0% to 62.5%. The intermediate counts show the effect of each coach setting on the same seeds.

### Build spread and discoveries

| Normal cohort, 40 starts per arm | Clears before → after | Frames equipped | Runs with 3 journal entries | Median entries | Buster-led wins | Storm Drones-led wins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Free | 25 → 20 | 5 → 28 | 4 → 16 | 0 → 2 | 8 → 8 | 4 → 3 |
| Path-directed | 20 → 24 | 4 → 25 | 4 → 19 | 0 → 2 | 12 → 9 | 2 → 3 |
| Both, 80 starts | 45 → 44 | 9 → 53 | 8 → 35 | 0 → 2 | 20 → 17 | 6 → 6 |

**Archetype share passes when completed paths identify the build.** A capstone was active on 35/44 final wins (36/45 before). Counting every completed path independently, the most frequent was Bastion at 5/44 (11.4%). The pre-tune maximum was 4/45 (8.9%). When a win with two paths shares credit evenly and a win without a path uses its leading weapon, the maximum is again 5/44, this time Buster. The pre-tune maximum for that classification was 4/45, shared by Vent and Binary.

**The independent leading-weapon proxy still misses 15%.** Buster led 17/44 wins (38.6%, down from 20/45 or 44.4%). Chain Zap and Storm Drones each led 6/44 (13.6%). Hornet Grid and Medic Beam each led three, Glass Gale led two, and seven other weapon IDs led one each. The old top five comprised the entire 45-win sample. Thirteen different weapon IDs led at least one final win. Twelve of the seventeen Buster winners had an active hero-specific capstone. Its opening availability, whole-run damage credit and the stock pilot's preference for left-click ranks still aggregate several builds under the same ID.

Across the matched roster, Storm Drones offers fell from 14 to 13 and picks from 12 to 9. Its leading wins stayed at six. All six final Storm Drones wins had a capstone. Three used no rule, and the other three used Salvage, Pawn and Kiln. The 58.3% from the rules lane describes seven of its twelve Rookie wins. On this integrated branch the fusion's clearest reduction is in the fixed Rookie sample, from seven leading wins to zero.

**The median misses three by one discovery.** Of 80 final starts, 28 triggered zero interactions, 4 triggered one, 13 triggered two and 35 triggered three. Before tuning, those counts were 71, 0, 1 and 8. Across both arms, all 104 treasure hands with room for a new frame showed it, and the pilot accepted 53. Fifty-two runs finished with a complete three-part recipe. A fitted part still needs a matching partner tag and an actual interaction to enter the journal. Reaching a median of three on 80 starts would require 41 three-discovery runs, six more than observed. These are fresh-profile bot cohorts with default click loadouts.

### Files and integration

- Weapon, fusion, Mod, difficulty and crafting numbers live in `src/data/weapons.ts`, `fusions.ts`, `mods.ts`, `modes.ts` and `craftParts.ts`.
- Shared edit in `src/game/hero.ts`: two draft weights inside `buildOffers`. They run when a hand opens. `src/game/crafting.ts` sets the position of the existing treasure card.
- `tests/g345-balance.test.ts` pins the lightning ceiling and rider, starting-shop budget, drop chance, actual first-draw weight ratios and treasure priority. `tests/g2hardmode.test.ts` pins the difficulty table. `tests/g2-close.test.ts` measures exactly one charge spent on a successful opening dodge. Its old empty-meter assertion assumed the pre-Gate-3 one-charge starter.
- The host continues to resolve cards, purchases, damage and drops. The offline two-client test included a reconnect and sent 1,918 snapshots averaging 1,731 bytes, maximum 12,274 bytes. Both clients finished the lobby scenarios.

### Reproduction

- Use `npm run skillbot -- --difficulty normal --seed 1 --runs 40` for the stock loop. Pass `--difficulty assist --runs 20` and `--difficulty hard --runs 20` for the brackets. Assist has its own ID, separate from Easy. The runner writes a dated perf file, so run comparisons in a temporary copy to preserve the historical report.
- To reproduce build attribution in that runner, observe `game.hero` immediately after `window.skillRun(2100)`. Compare `hero.damageBy[w.def.id] ?? 0` in equipment order. Read the two bits of `hero.paths.active` in `hero.heroDef.paths` order. Count keys in `readJournal()` on a fresh profile. For directed picks, test `offer.paths` against the assigned ID before applying the ordinary host action. Each unchosen card stays available under the game's usual hand rules.
- Use `measureArmourAim` from `tests/g3armour.test.ts` with `window.skillRun` in place of the fixture's fallback runner. Run both arms on each seed 1–40. Use the sum of damage across seeds for the ratio. For the practice drill, bundle with `npm test -- g4bosses`, then run `G4_BOSS=queen G4_SEED=1 G4_PRACTICE=5 node node_modules/.tests/g4bosses.test.mjs`. Vary the boss over king, rex, queen and omega, the seed over 1–40 and the practice number over 0–5.
- Shop QA link: `?test&god&seed=42&stage=2&shop&modoffers=hair_trigger,pyromaniac,quick_draw&weapons=lightning:3&gold=15&nointro&season=off`. Use `&lang=ar` for Arabic. Live fusion link: `?test&stage=2&weapons=storm_drones&god&nointro&season=off&seed=42`.

### Invincible historical comparison

All four original kits cleared two stages before the refresh. Two old checks exceeded the 25% tolerance: stage-one Buster ranks fell from 11 to 7, and stage-one Scatter kills fell from 6,075 to 4,257. The draft weight directly reduces Buster rank offers, and Normal enemies now have more HP. After freezing the tuning, `npm run balance -- --update` refreshed `tests/visual/balance.json`. A separate `npm run balance` passed against it with the existing tolerance.

| Kit | Stage-two cumulative kills, old → refreshed | Stage-two ranks, old → refreshed | Stage-two finish seconds, old → refreshed |
| --- | ---: | ---: | ---: |
| Buster / Charge / Bomb | 15,414 → 11,984 | 22 → 18 | 559 → 573 |
| Laser / Well / Meteor | 15,491 → 14,140 | 20 → 24 | 547 → 537 |
| Scatter / Grenade / Blizzard | 14,571 → 11,029 | 21 → 21 | 538 → 552 |
| Rail / Shield / Storm | 15,298 → 12,790 | 21 → 22 | 572 → 565 |

### Release and visual checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. Vite reported its existing config-loader and chunk-size warnings. |
| `npm test` | Passed all 145 files. The runner retried `hostmig.test.ts` alone. |
| `npm run smoke` | Passed every mode, the mortal game-over path and three-player local co-op. The invincible Normal Rookie reached stage three. |
| `npm run coop -- --offline` | Passed with the real WebRTC channel, low graphics and a 120-second page timeout. |
| `npm run balance` | Passed on the refreshed four-kit reference. The pre-refresh differences are tabulated above. |
| `npm run shot` | Passed all eight final shop and live-fusion captures, English and Arabic at 1280×720 and 1920×1080. |
| `git diff --check` | Passed. |

Headless Chromium came from the session's Playwright browser. The local adapter connected the stock CLI harnesses to that browser. A cold production preview requested the absent `/favicon.ico`; the first shop capture reported that 404. After visiting the preview once, all eight final screenshot commands exited zero. The inspected shop PNGs show the 7/5/4 prices and reversed Arabic order. The live PNGs show the orbit ring and bolt effects in the stage-two arena. The files are in the ignored `shots/` directory under `g345-balance-{shop,storm}-{en,ar}-{720,1080}.png`.

The final full unit run used six workers and Node's compile cache after the measurement jobs finished. On earlier loaded runs the host-migration fixture reached the real PeerJS constructor in Node. The untouched baseline reproduced it. Its mock sets the retry time to infinity, but the migration room switch replaces that with a real 300 ms deadline. A diagnostic observed 476 ms before the fixture took its next step. The stock fixture passed on the final runner's isolated retry. All gameplay and migration assertions in the release run came from the repository tests.
