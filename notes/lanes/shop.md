# Shop lane

Mod order preview in the shop, real numbers on level-up and shop cards, BANISH on level-up cards and LOCK on shop Mods.

## Built

### 1. Mod order preview (shop)
- A panel between "YOUR MODS" and the slots shows what the current order does to a hit: `EVERY HIT x1.40 +4.2`, one row per owned weapon whose hits a Mod changes (`ORBIT DRONES x2.00`), and condition rows only when a Mod reacts to them: `IF BURNING`, `IF FROZEN`, `IF SHOCKED` (includes the base x1.2 and Static Cling), `IF WITHIN 3.5M`, `IF PROJECTILE 8M+`, `IF CRITS` (includes the crit multiplier), `IF STANDING STILL`.
- Values are `xM +A`: the pipeline is affine in the hit (each slot does `(x + add) * mult` with add/mult independent of x), so `f(x) = M*x + A` and A is the flat damage after the multipliers to its right. Moving Hoarder before Momentum turns `+3` into `+4.2`, and the panel shows it.
- Hovering or focusing a control switches the panel to before -> after: a shop offer or its LOCK (`IF YOU BUY X`), a move arrow (`MOVE X LEFT`), UPGRADE (`UPGRADE X TO LV n`) or SELL. Changed numbers are highlighted (lime better, orange worse). Right after a move the panel shows `NEW ORDER` (old order -> new) until focus moves; focus follows the moved Mod.
- Mods whose number moves during fights (found by perturbing their state, gold and clock, not by id: today Bloodlust, Hoarder, Momentum, Collector, Midas, Turret Mode) are listed as `LIVE IN FIGHTS (SHOWN NOW)`.
- Engine: `Synergy.sandbox(slots, host)` (the one addition to synergy.ts) builds a throwaway engine on copied slot state, so the preview uses the real Echo resolution, levels, flag sums and damage hooks with a no-op host (no gold, blasts, zaps; `chance()` never procs). Static Mod stats (Glass Cannon x2) multiply every row. Code: `src/game/shopPreview.ts`.

### 2. Real numbers on cards
- Level-up cards get up to 3 lines (`cardNumTuning.maxLines`): `DPS 70 ▸ 84`, `DMG 10 ▸ 12`, `SIZE 1 ▸ 1.1`. New items show their numbers without arrows. Tracks, evolutions, Overdrive, ladder levels, partner evolutions and specials (DMG/COOLDOWN plus strikes, meteors, freeze...) all go through a small single-target model per weapon (`MODELS` in `src/game/cardNumbers.ts`): damage per hit, rate or reload, and hits per use, scaled by live damageMul / cooldownMul / chargeDmg / charge speed. It assumes everything connects; it is for comparing before and after, not a benchmark (Buster base 70 DPS = 10 x 7/s).
- Passive cards compare the hero's static stats with and without the extra level (`Hero.statsWithPassives`, which `recomputeStats` now uses too), so caps show honestly: `DAMAGE +10% ▸ +20%`, `RECHARGE 8% FASTER ▸ 16% FASTER`, `CRIT CHANCE 5% ▸ 13%`.
- Shop Mod cards show their damage effect on this build (from the preview: `IF FROZEN x1.00 ▸ x2.00`, `GRENADE LOBBER x1.40 ▸ x1.96`) plus non-damage effects (`INTEREST CAP 10 ▸ 15`, `SHOP PRICES +0% ▸ -25%`, `MAX LIFE 100 ▸ 40`). Mods with nothing computable (pure triggers) show only their text.
- Numbers are computed on the host (`presentLevelUp`, `fullShopView`) and travel with the offer/shop view, so clients see their own.

### 3. Banish and lock
- BANISH ✕n button on the level-up screen (mouse, keyboard/gamepad via MenuNav, number keys): it arms the screen ("BANISH WHICH?", red stamps on banishable cards), and the next pick banishes that card instead. The item (or that track of a loadout item, or that special/Overdrive) leaves this hero's pool for the run; only that card is redrawn (the others don't spin again) and never repeats a card on screen. Evolution forks, partner evolutions and bonus cards can't be banished. Charges: 2 per run, +1 at every stage-clear shop (not the starting shop), cap 5 (`banishTuning`).
- LOCK under each shop offer: a locked Mod stays on its card through rerolls and into the next shop (secret shop included) until bought or unlocked. Cyan ring + "■ LOCKED".
- Run-only state on Hero (`banished`, `banishLeft`, `shopLocked`), cleared by `startRun`. Nothing is saved.
- Co-op: client actions travel as the existing `ui` message (`a: 'banish'` / `'slock'`, `i`); the host applies them in `heroAction` and re-presents (`lv` gained `banish`; shop offers gained `locked`/`nums`; the shop view gained `preview`). Old clients ignore the new fields.
- Dev bot: ignores both (it never arms banish; its shop policy clicks `[data-act=buy]`, untouched).

## Knobs (debug panel > Shop & cards)
- `banishTuning` (src/game/banish.ts): start 2, perShop 1, max 5; "+1 banish" button.
- `cardNumTuning.maxLines` 3 (src/game/cardNumbers.ts).
- `previewTuning` (src/game/shopPreview.ts): sample hit distance 5 m, near 2 m (Brawler), far 10 m (Sniper Scope).

## Test links (src/dev/shopLinks.ts, called from testLinks)
- `&mods=hoarder:2,momentum,echo,kindling` own Mods (id:level) in slot order
- `&shop` open the stage shop now; `&locked=0,2` lock offers
- `&levelup` open a level-up now; `&armban` arm BANISH
- `&focus=buy:1` hover a control after 1.8 s (`mod-left:3`, `mod-up:0`, `sell:1`, `lock:0`, `pick:2`)
- Examples: `?test&seed=21&gold=60&loadout=scatter,grenade,bomb&weapons=drones:3,missiles:2&mods=sniper:2,hive_mind,echo,demolition&shop&locked=1&focus=buy:2`, `?test&seed=3&gold=60&loadout=scatter,grenade,bomb&weapons=drones:3&mods=hoarder,momentum:2,echo,kindling&shop&focus=mod-left:3`, `?test&seed=11&loadout=buster,charge,storm&weapons=drones:2,lightning:1&levelup&armban`

## Verification
- `npm run typecheck`, `npm test` (incl. tests/shop.test.ts and tests/shopCoop.test.ts), `npm run smoke` pass.
- tests/shop.test.ts: every preview row equals `Synergy.damage` on the real slots at 4 sample amounts (every hit, per weapon, burning, crit) with Hoarder + Momentum LV2 + Echo + Kindling LV2 + Hive Mind; preview leaves Mod state untouched; Echo + Kindling LV2 = 1.8 x 1.8; moving Hoarder last changes +4.2 to +3; Glass Cannon, Turret Mode (still row only), Static Cling (shock row); live-Mod detection; card numbers (Heavy Rounds DPS 70 -> 84, Power Cell, evolution, new weapon, Bomb Recharge cooldown, 900 offers over 300 picks without errors); banish (charges, redraw only that card, never returns over 300 draws, forks blocked, shop charge, run reset); lock (rerolls, next shop, buy clears, run reset).
- tests/shopCoop.test.ts: host + client Games in jsdom; the client arms BANISH, picks, the host banishes and redraws, the client gets 1 charge left; the client's LOCK click locks on the host, survives a client reroll, and the client shows the lock and the preview.
- Screenshots looked at: shop with 4 Mods and a move hover (`NEW`/`MOVE KINDLING LEFT: IF BURNING x1.96 ▸ x1.40`), shop with weapon rows and a locked offer, level-up cards with numbers, level-up with BANISH armed.

## Unfinished / risky
- The DPS model is per weapon and simple (all hits connect; Orb counts every zap of every orb in flight; Laser side beams at 60%). Good for before/after, not for comparing two different weapons' absolute numbers. Weapons added later without a model fall back to dmg/cd.
- Condition rows use a plain hit (no tags) under that condition, so combinations (a Fire weapon on a Frozen enemy at range) aren't listed; per-weapon rows cover the tag Mods.
- Shop screen is taller (panel + lock row): at 1280x720 it scrolls (it already did with 5 Mods). Keyboard focus scrolls into view.
- Banish has no hotkey (button + number keys); the HUD lane owns keybinds/glyphs.
- Not verified in two real browsers over PeerJS (`npm run coop`); covered by the in-process host/client test.
- Shared files touched: synergy.ts (static `sandbox`), hero.ts (state, `statsWithPassives`, banish/lock, `buildOffers(keep?)`, `rollShop` keeps locks), screens.ts (Offer.nums, ShopView fields, banish/lock clicks, card/offer markup, preview panel and focus restore), game.ts (one ScreenActions line, NetShop fields), netClient.ts (banish count, offer fields), levelUps.ts (owned), testLinks.ts (one call), debugPanel.ts (one folder).

## PLAN.md decision-log paragraph
- 2026-10-19: Shop lane. The shop shows what the Mod order does: a preview panel runs a sample hit through copies of the slots with the real engine (`Synergy.sandbox`: Echo, levels, flags, damage hooks) and lists `EVERY HIT`, each weapon a Mod changes and each condition a Mod reacts to (burning, frozen, shocked, near, far projectile, crits, standing still) as `xM +A`; hovering a buy, move, upgrade or sell shows before -> after, and Mods whose value moves in fights are flagged LIVE. Level-up cards show up to 3 number lines (DPS, damage, rate/reload, changed params; passives as stat before -> after from the hero's stats), from a simple per-weapon single-target model (everything connects; for comparing before and after). Shop Mod cards show their effect on this build (damage rows plus interest, prices, life...). BANISH: 2 charges per run, +1 per stage-clear shop, max 5; removes the item (or that track) from the hero's pool for the run and redraws only that card; forks and bonus cards can't be banished. LOCK keeps a shop Mod through rerolls and into the next shop. Both are run-only, host-authoritative (`ui` actions `banish` / `slock`), and the dev bot ignores them.
