# Lane: sets (item set bonuses)

## What players get
Weapons, the Q/E special, passives, relics and Mods belong to 8 themed **SETS**. Holding 2 / 4 / 6 pieces of a set turns on bonuses that build on each other and change how the build plays:

| Set | 2 pieces | 4 pieces | 6 pieces |
|---|---|---|---|
| INFERNO (fire) | +20% on Burning enemies | Burning enemies explode on death (Fire + Explosive blast) | Every hit ignites |
| STORMCALLER (shock/chain) | +20% on Shocked enemies | Hits on Shocked enemies: 12% chance to arc to 2 more | Every 40th hit calls a 5-bolt lightning storm (2 s cooldown) |
| GLACIER (frost) | +25% on Frozen enemies | +6% freeze chance | Frozen kills burst into an ice nova that freezes the crowd |
| BULWARK (armour/life/shields) | +2 armor | Getting hit sends out a knockback shockwave (1.5 s cooldown) | A barrier that blocks one hit completely, re-forms every 12 s |
| SPEEDSTER (dash/move) | +10% move, dash recharges 10% faster | +1 dash in a row, every dash leaves a slipstream blast | After a dash: weapons +35% fire rate, +20% damage for 2 s |
| BOOMSMITH (explosives) | Explosions 20% bigger | What your explosions kill: 25% chance to explode again | Every 12 s a 5-blast carpet bomb lands on the crowd |
| MACHINIST (drones/turrets/recharge) | Weapons recharge 8% faster | Support bot zaps the nearest enemy every 1 s | Bot fires every 0.5 s and chains; +10% more recharge |
| DUELIST (crits/parries) | +8% crit chance | +20% crit damage, crits have a 25% chance to Expose | A parry or perfect dodge: every hit crits for 2 s (once every 8 s) |

- **Chips**: level-up cards (new weapons, items and evolutions), shop Mod cards and relic picks show `INFERNO 2/4` chips. The count is what you'd have after taking the card (lime number); when the card completes a tier, the chip lights up and blinks with **SET BONUS!**. The hover tooltip gives the bonus at the next tier. Upgrades of owned items show the current count.
- **Pause screen**: a SETS column (right side; inline under 1100 px) lists every set you hold pieces of, with 6 pips (gaps at the tier gates) and all three tier lines, active ones lit.
- **Flourish**: when a tier turns on mid-run, you get a coloured ring and particle burst on the hero (effects bus, so teammates see it too), a banner (`INFERNO 4 SET!` plus the bonus text) and a rising square-wave arpeggio on the UI bus (with a noise sparkle at tier 3). Banners queue one at a time, because one piece can be in two sets (Cinder Receipt: Inferno + Boomsmith). Tiers you already hold when a run starts (loadout pieces) take effect silently.
- Damage breakdown names: Inferno Set, Stormcaller Set, Glacier Set, Bulwark Set, Speedster Set, Boomsmith Set, Support Bot.
- English and Arabic strings (src/i18n/sets.ts).

## Design decisions
- Membership is data only: `MEMBERS` in src/data/sets.ts maps item ids to sets, so no item file changed. Piece ids: weapon ids (auto and loadout), `sp_<id>` for the special, passive ids, relic ids, Mod ids. A fused weapon counts as both of its parts. An item can be in at most two sets (checked by a test); each set has 10–17 members, so 6 pieces needs commitment but leaves choices.
- Upgrade levels don't count: one piece per owned item. Sets reward breadth within a theme, which is a different decision from the "level what you have" pressure.
- Loadout clicks count too (Rail and Whip are Duelist, Grenade and Orbital are Boomsmith, Shield is Bulwark, Sentry is Machinist), so the loadout screen nudges a theme without forcing one.
- Static bonuses (armor, move, dash, cooldown, crit, freeze chance) go through `Hero.statsWithPassives` (`applySetStatic`, using the passives being previewed so card stat numbers include set bonuses). Timed buffs (Speedster 6, Duelist 6) go through `Hero.refreshLive` (`applySetLive`). Clients get both with the synced stats.
- Behaviour bonuses run on the host only, from small hooks: `damage()` (multiplier after statuses, plus `setsHit` after the Mod triggers), `killEnemy` (`setsKill`), `blast` (Boomsmith area), `hurtHero` (Bulwark barrier before damage, shockwave after), `onDash`, `mods2Event` (parry / perfect dash) and `updateHero` (`setsStep`: counts, tiers, timers, support bot, carpet bomb). Set-made damage uses `set_*` sources, which never retrigger set hit effects. Set explosions and novas share a budget of 8 per hero per second, so chain reactions stay bounded.
- Co-op: each hero counts its own pieces. No snapshot field: the client counts its own hero from the mirrored weapons, passives and relics plus the Mod list in `game.netMods` (`HeroSets.clientMods`). The flourish rings travel on the effects bus; the banner and sound are local to the hero who got the tier.
- PvP: set damage to stand-in enemies goes through `pvpHit` like everything else; the support bot skips its own stand-in.

## Tuning (`setsTuning`, debug panel > Sets)
Set damage is `base + perStage × stage`: Inferno blast 18+8, storm bolt 30+12, glacier nova 16+7 (freeze 1.2 s, 0.3 s on bosses), Bulwark wave 30+10 (knockback 14), slipstream 20+8, Boomsmith re-explosion 16+8, carpet blast 40+15 (r 2.8), bot 20+8. Every other number is in the table above.

## Balance (bot)
`tests/sets.bench.ts` (bundle with rolldown like the tests; see the header):
- **Probe** (`MODE=probe SET=<id>:<n> [BONUS=0]`): default kit plus the set's auto weapons, 16 respawning 2,500 HP Chonks, 40 s god bot. `BONUS=0` keeps the same pieces with the bonuses off, so the ratio is the set bonus alone. Averages over seeds 1–4 after tuning: Duelist x1.22 / x1.37 / x1.65; Inferno 6 x1.45, Boomsmith 6 x1.43, Machinist x1.11 / x1.45, Storm x1.08 / x1.39 / x1.30, Speedster x0.95 / x1.13 / x1.24 (a mobility set), Glacier x1.12 at 4 and about x1.0 at 6. Glacier is a control set: freezing holds enemies out of reach of a short-range kit, and the value is in safety, which this probe doesn't measure. Single runs are noisy (±20%). For comparison, a single strong Mod measures x1.3–2.1 in the mods2 probes, so a 6-piece set is worth about one good Mod plus a new way to play.
- Changes from the probe: Glacier 6 nova 20+8 dmg / 1.5 s freeze → 16+7 / 1.2 s (it was x2.19 from a freeze-kill chain); Duelist 4 crits always Exposed → 25% chance, crit damage +25% → +20% (x1.51 → x1.37); Duelist 6 3 s window and no cooldown → 2 s once per 8 s (x1.89 → x1.65); support bot 14+6 → 20+8 (x1.04 → x1.11); Boomsmith 4 chance 35% → 25% and set-explosion budget 10/s → 8/s (one natural run had 13% of all damage from Boomsmith re-explosions).
- **Natural** (`MODE=natural SECS=1000`): the god bot picks the first card and ignores sets. Over 3 seeds it reached tier 1 in 3–6 sets by stage 2–3 and tier 2 in one or two sets by stages 3–4, never tier 3. Set damage was 0.4–13% of the total (13% before the Boomsmith trim). So sets show up on their own, but the 6-piece bonuses need a player to aim for them. Attractive, not mandatory.

## Performance
`npm run bench -- --gpu metal` heavy scene plus `&set=inferno:6,storm:6,machinist:6,boomsmith:6`: 3.59 ms CPU/frame, against 3.94 ms for the same scene without sets (shared machine, noise). Per step it's one piece count per hero (Int8Array, no allocation) plus timers; the hooks return early when a hero has no active tier.

## Files
- New: src/data/sets.ts (membership, tiers, tuning), src/game/systems/sets.ts (all behaviour, counting, flourish), src/ui/setsUi.ts (chips, pause panel, CSS injected from the module), src/i18n/sets.ts (EN + AR), src/dev/setsLinks.ts, tests/sets.test.ts, tests/sets.bench.ts.
- Shared, one line or a few each: src/game/game.ts (method bindings, `setsStep` in updateHero, `setsDash` in onDash), src/game/hero.ts (`sets` field, reset, static and live hooks), src/game/systems/combat.ts (damage multiplier, hit hook), src/game/systems/statuses.ts (kill hook, blast area, hurt hooks, source names), src/game/systems/mods2.ts (event hook), src/game/systems/render.ts (`setsFrame`), src/ui/screens.ts (chips on level-up / Mod / relic cards, panel in the pause info), src/ui/debugPanel.ts (Sets folder), src/i18n/en.ts / ar.ts (spread), src/dev/testLinks.ts (one call).

## Test links
- `?test&god&set=inferno:4,storm:2,speedster:6&setpause=2`: pause screen with the SETS panel
- `?test&god&set=boomsmith:3,inferno:1&levelup`: level-up chips
- `?test&god&set=storm:3,inferno:1&shop&gold=60`: shop chips (SET BONUS! on cards that complete a tier)
- `?test&god&set=inferno:4&setat=2`: pieces arrive at 2 s of run time, so the tier banners and sound play (two queued banners)
- `&relics=r_cinder,r_keg` gives relics directly. `&set=<id>:<n>` fills a set from its relics, then items, Mods and auto weapons.

## Verification
- `npm run typecheck`, `npx vite build`, `npm run smoke` and `npm run coop -- --offline` pass. tests/sets.test.ts has 97 checks, all passing.
- `npm test`: 5 files fail (eightp, followups, i18n, raceCoop, spectateCoop). They fail the same way on the untouched base commit d82dd58 (checked in a separate worktree), so they come from earlier merges.
- Screenshots looked at: shots/sets-pause.png, sets-levelup.png, sets-shop.png, sets-banner.png, sets-banner2.png.

## Unfinished / risky
- Not play-tested by a person. Set balance comes from bot probes only, and Bulwark/Speedster/Glacier value (safety, mobility) isn't measured.
- No set chips on EXTRAS > ARSENAL entries or in the HUD slots (only cards and the pause panel).
- Membership in `MEMBERS` is hand-picked. New items from other lanes don't join a set until someone adds them; ids that disappear are caught by the test.
- The client counts Mods from `game.netMods`. If a lane changes that field's shape, the client's chips and banners stop counting Mods (gameplay is unaffected, because it runs on the host).
- `setsFrame` keeps module-level state for the local hero (flourish queue). Local co-op heroes beyond the first don't get their own banners (their bonuses still work).
- Sound is synthesized (`sfx.play('setTier', …)`). No recorded sample.
