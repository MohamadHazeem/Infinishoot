# Lane: trading (sharing in co-op)

## What players get
- **TRADE quick menu** (co-op only: 2+ heroes in the run, never PvP or Versus). Press **Y** (rebindable: SETTINGS > CONTROLS "Trade (co-op)") in a fight, or **PAUSE > TRADE** (the button only shows in co-op; that's the gamepad route, every D-pad direction and face button is taken), or the **TRADE ▸** button in the shop. One card per teammate with their title, gold, gears, relics and DOWN state, and buttons: **GIVE 5●**, **GIVE 25●**, **GIVE HALF**, **GIVE A GEAR**, **GIVE A RELIC ▸** (opens a row of your relics they don't own yet; focus jumps to it). Buttons grey out when they can't apply (no gold, their gear bag is full, they already have all your relics); a refused trade says why in a toast. Online the fight keeps going behind the menu (like PAUSE); solo-with-a-local-teammate pauses. Escape/B/BACK closes it, back to the fight or to the shop.
- **Gifts land at once**, on the host: the giver pays, the receiver gets it (gold whole coins, never more than you hold; a gear only if they have room under MAX_GEARS; a relic only if they don't have it; relic stats move with it via `recomputeStats`). In a fight there's a gold/grey/red burst on both heroes and a ring under the receiver (seen by everyone through the effects bus); the giver and the receiver get a toast ("MIA GAVE YOU 25 GOLD" / "YOU GAVE BO A GEAR") and the recorded **coin_transfer** sample (synth coin fallback). Shops refresh for both if they're shopping.
- **TEAM POOL** in the shop (a panel between CONTINUE and YOUR MODS): "START A POOL FOR ONE OF YOUR OFFERS: [Mod 12●] …" opens a pool on one of your own offers (one pool per player). Everyone sees "■ MIA ✦ SUPERNOVA 7/13● [bar] YOU: 3 [CHIP IN 5●] [CHIP IN 25●] [CHIP THE REST]" (the owner also gets CANCEL). Chipped gold is held by the pool; when it's full the host buys the Mod for the owner ("TEAM POOL! MIA GETS SUPERNOVA", coin sound for everyone, the buy animation on the owner's shop). Refunds: the owner cancels, the offer goes (bought, rerolled, owner left), the buy fails (slots full) or the shop closes. Pools in the **starting shop** aren't refunded when it closes, like the rest of its free gold.
- **Co-op achievements and titles** (src/data/coopAchievements.ts, appended to ACHIEVEMENTS so they show on UNLOCKS and save normally). Each earns a title; the highest-ranked one is your title, shown as a coloured chip on your lobby card, on teammates' team-panel cards (top-left), and in the TRADE menu:

| Achievement | Goal | Title (rank) |
|---|---|---|
| Sharing Is Caring | Give a teammate gold, a gear or a relic | GOOD SPORT (1) |
| Better Together | Defeat a boss in co-op | BUDDY (2) |
| Heirloom | Give a teammate one of your relics | HEIRLOOM KEEPER (3) |
| Crowdfunded | Complete a team pool in the shop (owner or chipper) | FUNDRAISER (4) |
| Patron | Give teammates 150 gold in one run (pool chips for others count) | PATRON (5) |
| Full Squad | Clear a stage in co-op with 4 players | SQUAD LEADER (6) |
| Living Legend | Clear stage 2 on Legend | LEGEND (8) |
| Mythic | Defeat the final boss on Legend | MYTHIC (10, cycling colours) |

- **LEGEND difficulty**: a fifth button on the lobby's difficulty row (yellow text), after Nightmare. Co-op only: locked with fewer than 2 players or a non-co-op game type ("LEGEND needs 2+ players." under the row for a host who has it); same unlock as Nightmare (Hard Boiled). Hidden from the solo MODE screen; a solo run with LEGEND saved as the setting plays Nightmare. Rewards: **score x3**, a **LEGEND BOUNTY** relic for every hero at every boss (an extra rarity-weighted roll with +1.5 luck), **+1 gear** for everyone at each stage clear, and the LEGEND / MYTHIC titles.

## Tuning (src/game/trading.ts)
- `tradeTuning`: goldSteps [5, 25] (+ GIVE HALF), chipSteps [5, 25] (+ CHIP THE REST), minGap 0.25 s and burst 6 per 5 s per player (host clock, refused attempts count), poolsPerHero 1, maxPools 8, eventLife 2 s (how long a trade event stays in snapshots), patronGold 150.
- `legendTuning` (on top of the director's usual co-op scaling: +45% HP and +50% count per extra player, x0.9 co-op ease; index = players, 5+ use the 4-player row): hp [2.6, 2.5, 2.4], dmg [1.9, 2.0, 2.1], count [1.45, 1.4, 1.35] for 2 / 3 / 4 players (see "LEGEND balance"), relicLuck 1.5, clearGears 1, score 3. Bench overrides: LG_HP / LG_DMG / LG_COUNT.
- The LEGEND def in src/data/modes.ts holds the 2-player row; `legendDifficulty(n)` builds the def for n players and the host swaps `game.difficulty` whenever the number of heroes in the run changes (drop-in/out included), rescaling `director.countMul` by the count ratio.

## LEGEND balance
Numbers per team size (multipliers like a difficulty's; the director's own co-op scaling comes on top). Nightmare is 2.0 / 1.6 / 1.3 for every size.

| Players | Enemy HP | Enemy damage | Enemy count | Score |
|---|---|---|---|---|
| 2 | x2.6 | x1.9 | x1.45 | x3 |
| 3 | x2.5 | x2.0 | x1.4 | x3 |
| 4+ | x2.4 | x2.1 | x1.35 | x3 |

How they were picked (tests/legend.bench.ts: a host with N heroes, the dev bot on hero 0 and coop2's autopilot on the rest; Buster / Charge Shot / Bomb; heroes Rookie, Ace, Bulwark, Dash; seeds 1-2; the build machine was heavily loaded, so one seed pair per point):
- **Mortal runs** first (until everyone is down): every team, Nightmare or the first LEGEND draft, died at the stage-1 boss (4:20-4:35), so survival time alone doesn't separate them; the bot doesn't dodge boss attacks.
- **God runs** (620 s, about two stages): boss kill times (King / Rex). Nightmare: 1p 13/52, 20/15 s; 2p 29/–, 9/28; 3p 15/27, 20/25; 4p 21/27, 17/34 (mean 22.9 s for 2-4 players). First draft (2.3/1.75/1.35, 2.2/1.85/1.3, 2.1/1.95/1.25): mean 25.9 s, only x1.13 Nightmare, so it was raised.
- **Final numbers**, god runs: 2p 23/–, 28/22; 3p 28/20, 15/32; 4p 25/37, 29/41 (mean 27.3 s: x1.10 / x1.09 / x1.33 Nightmare's for 2 / 3 / 4 players). Every team still clears two stages in god mode (levels 29-34 by minute 10, no change in level pace).
- **Final numbers, mortal** (seed 3): 2 players died at the stage-1 boss (4:21) on LEGEND but reached stage 2 (8:38) on Nightmare; 4 players 5:17 on LEGEND vs 5:41 on Nightmare.
- Read: LEGEND is clearly above Nightmare at every size and harder still for full teams of four (who revive each other most). The bounty relic per boss and the gear per clear make long runs stronger, which these short runs don't show. Real teams dodge; play-testing should check that 2 players aren't walled at stage 1 (if so, lower `legendTuning.dmg[2]` first).

## Co-op / protocol (backwards compatible; peer prefix unchanged)
- Client -> host: `tr` {a: 'give', k: 'gold'|'gear'|'relic', to: heroIndex, n?, id?} | {a: 'pool', i: offerSlot} | {a: 'chip', p: poolId, n} | {a: 'unpool', p}. The host validates everything (`checkGive`, pool state, shop mode, `TradeLimiter`) and answers refusals with the usual `toast`. `hello` gains `title` (an achievement id; only known co-op title ids are kept, so no markup can travel).
- Snapshot field `tr` (null outside co-op: costs nothing): `w` [[gold, gears] per hero], `p` [[id, owner, slot, mod, price, paid, mine]], `ti` [title id per hero], `e` trade events from the last 2 s ([seq, kind, a, b, n, id]; kinds g gold, r gear, l relic, c chip, p pool funded, x pool closed; clients dedupe by seq), `st` this client's run stats [gold given, gifts, relics given, pools], `ft` team feats [bosses in co-op, 4-player clear, Legend clear 2+, Legend victory]. Clients grant their own achievements from `st`/`ft` into their own save. The lobby broadcast's players gain `title`.
- Old clients ignore `tr` and `title`; old hosts ignore `tr` messages (the menu then does nothing on that client).

## Test links (src/dev/tradingLinks.ts)
- `?test&god&mate&tradedemo&trade=3` the TRADE menu with wallets and titles (shots/trading-menu.png); `&traderelic` with the relic picker open (shots/trading-relic.png)
- `?test&god&mate&tradedemo&shop&gold=40&tradepool` the shop with the TEAM POOL panel and a pool the mate opened and both chipped into (shots/trading-pool.png)
- `?test&tradelobby` the host lobby with titles and LEGEND picked (shots/trading-lobby.png)
- `?test&lang=ar&god&mate&tradedemo&trade=3` Arabic (shots/trading-menu-ar.png)
- `title=<id>`, `matetitle=<id>` pin titles with `tradedemo`.

## Verification
- tests/trading.test.ts (pure): give rules (gold, gear cap, relic duplicates, self, gone, junk amounts), gold moved, the limiter (gap, burst, window), pools (one per player, chip caps, refunds, clear, cap), LEGEND (after Nightmare, per-player rows, clamping, fresh defs, allowed only in co-op 2+), titles (best rank, network ids), the Y binding.
- tests/tradingCoop.test.ts (in-process host + 2 clients): titles from hello (junk dropped) on the lobby card; LEGEND falls back to Nightmare alone and in PvP, is picked with 3; a LEGEND run scaled for 3 players on host, known on clients; a pool opened by a client, seen by another client, chipped by three players with the rate limit holding a double chip, buying the Mod for its owner with everyone's gold accounted; a pool refunded when its offer goes; gifts host -> client and client -> client mirrored on screens; a burst of 10 gives landing once and spaced gives held to the burst cap; gear cap; relic gift and a second give of the same relic refused; junk messages; titles in the snapshot and the TRADE view; the quick menu opening on a client; the LEGEND bounty relic; achievements granted.
- Screenshots checked (1280x720 / 900): trading-menu, trading-relic, trading-pool, trading-lobby, trading-menu-ar.

- `npm run coop` (two headless Chromiums over the PeerJS broker): the two trading scenarios pass (t=22 s: the client gives the host 7 gold and the host gives the client a gear; both screens agree once the client's snapshot catches up; t=25 s: the TRADE menu opens on the client with GIVE buttons; the shots/coop/trade-*.png screenshots were captured after it had closed again, so they show the fight). The run as a whole still reported other lanes' scenarios failing (jump pad, turret, pet levels, down/revive; a different set each of 3 runs): the machine had a load average of 80-110 from the parallel builders, and scenarios ran 50-80 s behind schedule.
- `npm test`: all files pass except tests/i18n.test.ts, which already fails on the base commit (751052c): weapons3 content ("Crosswind Blades", "Slipstream", ...) has no Arabic yet. With those pre-existing gaps skipped locally, the rest of the i18n test passes with this lane's strings (including its DOM-write scanner over screens.ts). `npm run smoke`, `npm run typecheck` and `npx vite build` pass.
- Cost: `tradingStep` about 1.3 µs per step and `tradingNet` 0.2 µs per client snapshot (2 heroes, measured in Node under load); nothing per frame in render. `npm run bench` wasn't run: with a load average of 80 its numbers wouldn't compare.

## Unfinished / risky
- Not played by people or between real machines.
- Pools only buy shop Mods (not Mod upgrades, rerolls or heals).
- Titles are picked automatically (best rank); there's no title chooser.
- A client's new title reaches teammates only on its next `hello` (next lobby / rejoin).
- Trading never asks the receiver (gifts can't hurt them: gold, a gear or a relic; a gift can't overflow a cap).
- The brief says 2-8 players: nothing in this lane assumes a team size (lists are per hero index, LEGEND's last row covers 5+), but runs are still capped at 4 by coop2 (`That run is full (4 players)`), so only 2-4 were exercised.
- The co-op achievements are checked by this lane every 0.5 s (its own list); meta2 (or whoever owns achievements) may want to fold them into `checkAchievements`. They're appended to ACHIEVEMENTS with a push at the bottom of src/data/meta.ts, so a merge only needs to keep those two lines.
- LEGEND balance rests on bot runs (no dodging, one seed pair per point, a loaded machine). The 4-player row may be on the hard side.
- `npm run shot` in this loaded environment sometimes captured the page before the game had run long enough; the shop-pool and Arabic shots were taken with a polling variant of the shot script (not committed).

## Shared files touched (small, additive)
- src/game/game.ts: import, 9 method fields, `this.tradingStep(dt)` after `coop2Step` in `update()`.
- src/game/systems/netHost.ts: `tradingHello` at the top of the `hello` branch, the `tr` message, snapshot field `tr`.
- src/game/systems/netClient.ts: `applyTradingNet(s.tr)`.
- src/game/systems/online.ts: `title` in `hello` and the lobby players; LEGEND fallback in `lobbyDifficulty`.
- src/game/systems/runFlow.ts: LEGEND fallback in `pickDifficulty`.
- src/ui/screens.ts: `'trade'` in ExtraScreen, `title` on lobby players (+ chip), LEGEND lock in the lobby row, coop-only difficulties hidden on the MODE screen, public `refreshNav(focus?)`.
- src/core/keybinds.ts: the `trade` action (Y). src/data/modes.ts: `legend` + `coopOnly`. src/data/meta.ts: import + push of the co-op achievements.
- src/i18n/en.ts / ar.ts: a block of `trading.*` and `text.trading_*` keys after `text.nightmare_113844`.
- src/dev/testLinks.ts: `tradingLinks` call and doc line. scripts/coop-test.mjs: two scenarios (t=22 s, 25 s).
- New: src/game/trading.ts, src/game/systems/trading.ts, src/data/coopAchievements.ts, src/ui/tradeMenu.ts, src/ui/coopTitle.ts, src/dev/tradingLinks.ts, tests/trading.test.ts, tests/tradingCoop.test.ts, tests/legend.bench.ts.

## Decision-log paragraph for PLAN.md
- 2026-10-20: Trading lane (notes/lanes/trading.md). Co-op players can share: the TRADE quick menu (Y, PAUSE > TRADE, or the shop) gives a teammate 5 / 25 / half your gold, a gear (up to their cap) or a relic they don't have; the shop's TEAM POOL lets a player open a pool on one of their offers and teammates chip gold in until the host buys the Mod for them (refunded if cancelled, the offer goes or the shop closes; starting-shop pools vanish like its gold). Host-authoritative (`tr` messages, validated and rate-limited to one trade per 0.25 s and 6 per 5 s per player), mirrored in the snapshot's `tr` field, with the coin_transfer sample. Eight co-op achievements (gifts, relic gifts, pools, 150 gold given in a run, a co-op boss, a 4-player clear, Legend stage 2, a Legend victory) earn titles (GOOD SPORT ... MYTHIC); the best one shows on lobby cards, the team panel and the TRADE menu, sent in `hello` as a known id. LEGEND is a co-op-only difficulty after Nightmare (same unlock, 2+ players, co-op game type) whose numbers follow the team size (HP x2.6/2.5/2.4, damage x1.9/2.0/2.1, count x1.45/1.4/1.35 for 2/3/4 players, on top of the usual co-op scaling; re-applied on drop-in/out), score x3, a bounty relic per hero at every boss and a gear per clear. Bot runs: Legend bosses take x1.1-1.3 as long as Nightmare's and mortal bot teams fall sooner at 2 and 4 players.
