# Lane: fusion (weapon fusion)

## What players get
- Hold two compatible **auto weapons at max level** (level 5 or evolved) and the next level-up shows a legendary **FUSION!** card (AUTO WEAPON FUSION, "A + B" strip: BOTH FUSE INTO ONE SLOT). Picking it removes both weapons and puts the hybrid in the first one's slot, so **one auto-weapon slot opens up**. The card stays on offer until taken (like evolutions), never pushes out an evolution fork or a ready evolution, and you can skip it to keep both weapons.
- The fusion moment: sparks spiral in from both colours, rings, white star, screen flash and shake, rumble, the `fusion` sample with a synth layer (two arpeggios meeting in a chord), a team banner `FUSION! <name>`, and for the player who fused, a pixel animation where both weapon icons slide in, crash together in a flash and the hybrid's icon pops out (hidden under REDUCE FLASHING except the final icon).
- 10 fusions, every auto weapon in at least one:

| Fusion | Parts | Hybrid behaviour (rider) |
|---|---|---|
| Storm Drones | Orbit Drones + Chain Zap | drone hits chain lightning (40%, 3 hops, 45 dmg, 0.07 s gap); bolts chain 2 more |
| Napalm Rockets | Seeker Pod + Blaze Boots | missile blasts leave burning napalm pools (3 s, r 1.5); every hit Burns |
| Ice Saws | Boomer Disc + Frost Nova | disc hits freeze 0.8 s (bosses x0.15) and set +60% shatter |
| Supernova Field | Zap Field + Frost Nova | field 10% wider; nova hits pop in small blasts (35%, r 2.2, 60%) and Shock |
| Tesla Traps | Pop Mines + Chain Zap | every mine blast chains lightning (5 hops, 50 dmg) |
| Prism Satellites | Laser Sweep + Orbit Drones | rainbow-cycling colours; 4 beams; drone hits pop light bursts (30%) |
| Dragon Cannon | Pellet Turret + Blaze Boots | 18 piercing burning pellets (+1 pierce), fire trail |
| Comet Swarm | Bounce Drone + Starfall | bounces explode (45%, r 1.8, 70%); +1 star |
| Meteor Barrage | Seeker Pod + Starfall | 25% bigger, burning missile blasts; heavier stars |
| Volt Ricochet | Bounce Drone + Chain Zap | +2 bounces; bounce hits arc lightning (55%, 3 hops) |

- Every hit of a hybrid is credited to it (damage breakdown, feel, tags) and carries the fusion's tags, so Fire tags Burn, Shock tags Shock, and tag Mods count the hybrid. Effects of the parts are re-tinted in the fusion's two colours.
- EXTRAS > ENEMY GUIDE ends with a **WEAPON FUSIONS** section listing every recipe (icon, A + B, what it does).

## Balance
A fusion runs **both parts at their evolved numbers** (even if a part wasn't evolved), each with x1.1-1.2 damage and small extras, plus the rider. So by construction it is stronger than the two weapons it replaces and frees a slot (unit test checks each child hits >= 1.09x its evolved part). It needs two maxed weapons, which bot runs reach around stage 3-4, so it's a late-run reward. Numbers live in `FUSIONS` (src/data/fusions.ts): `children[].mul/add` and `rider`. Not measured with `botRun` DPS tables; the bot always takes the fusion card (it picks the first card) whenever one is ready.

## How it works
- `src/data/fusions.ts`: recipes (`FusionDef`: parts, children with param mul/add, rider, colours, tags, feel, optional bullet kind), `readyFusions`, `childParams`, and `fusionWeaponDefs()` which `src/data/weapons.ts` merges into `WEAPONS` (so names, feel, tags and icons resolve by id). `WeaponDef.fusion` marks them: never offered as NEW, not starters, never in the unlock pool.
- `src/game/weapons/fusion.ts` `FusionWeapon`: builds each part through `createWeapon(id, scene, def)` (new optional `def` argument) with a synthetic "partner-evolved" def whose evolution params are the fused ones and colour the fusion's. Children run against a wrapped `WeaponCtx` (`Object.create(ctx)`, built once per ctx): `damage`/`blast` rename the source and tags and run the rider, `fx`/`particles` re-tint, `bullets` (Dragon Cannon only) re-kind. `net()` concatenates length-prefixed child states; clients rebuild by id like any weapon.
- `src/game/fusion.ts`: `fusionCard`, `fusionOfferFor`, `placeFusion` (pure, tested), `fuseWeapons` (swap parts for the hybrid).
- `src/game/systems/fusion.ts`: `Game.fusionFx` (host; tells a remote fusing player `{t:'fusefx', id}` for the icon animation). `src/ui/fusionUi.ts`: card strip, merge overlay, guide section.

## Files touched
New: src/data/fusions.ts, src/game/fusion.ts, src/game/weapons/fusion.ts, src/game/systems/fusion.ts, src/ui/fusionUi.ts, tests/fusion.test.ts, notes/lanes/fusion.md.
Small additive edits to shared files:
- src/data/weapons.ts: `fusion?` field, merge of fusion defs and feel before the feel loop.
- src/game/weapons/index.ts: `createWeapon(id, scene, def?)`, fusion branch. src/game/weapons/fire.ts: `Fire.drop()` (napalm pools).
- src/game/hero.ts: skip `d.fusion` in NEW offers; `buildOffers` returns `placeFusion(...)`; `applyOffer` 'fusion' branch.
- src/game/game.ts: `fusionFx` field; **bullet kind 15 = dragon_cannon** in `BULLET_KINDS` (renumber on merge if another lane took 15; also update `bulletKind` in fusions.ts). Its colour #ff5e3a is already in codec `BULLET_COLORS`.
- src/game/systems/levelUps.ts (fusionFx on pick), src/game/systems/netClient.ts (`fusefx` message).
- src/ui/screens.ts: `Offer.kind` gains 'fusion', `Offer.fuses`, `cardMode` treats fusion as 'evo', strip line, guide section appended.
- src/audio/sfx.ts (`fusion()` synth), src/audio/mix.ts (`fusion` cue -> 'fusion' sample).
- src/style.css: block at the end (fusion card, merge animation, guide rows).
- scripts/icons.mjs + regenerated src/data/iconArt.ts (+10 icons: delivery-drone, missile-swarm, circular-sawblade, sun-radiations, tesla-turret, star-satellites, dragon-head, fireball, burning-meteor, spark-spirit).
- src/dev/testLinks.ts (`fuse`), scripts/coop-test.mjs (fusion scenario at 28 s: host fuses the client's weapons, client must see Storm Drones with both parts and the merge overlay).

## Test links
- `?test&weapons=drones:6,lightning:6&fuse&god`: a level-up with the FUSION card first (after 1 s; `fusein=<s>` changes the delay).
- `?test&weapons=drones:6,lightning:6&fuse=go&god`: takes it (the fusion moment).
- `?test&weapons=storm_drones&god&bench&hold=80&stage=2`: start with any hybrid (`bench` stops level-up menus for screenshots).

## Checks
typecheck, `npm test` (fusion.test.ts: 155 checks: data coverage, ready rules, card placement, fuse on a Hero, chests leave it alone, net round-trip for all 10), `npm run smoke`, `npm run coop` (passes with the fusion scenario; one of three runs failed the existing down/revive "visible" check, which looks flaky and unrelated). Screenshots of all 10 hybrids in a horde: no page errors.

## Not done / risks
- No fusion altar and no fusion from chests (chests never evolve anything; kept that rule).
- The guide screen is still titled ENEMY GUIDE; fusions are a section at its end.
- Rider zaps go through `Game.zap`, so their damage is credited to 'zap' in the breakdown rather than the hybrid.
- Prism Satellites' rainbow re-skins its parts 8 times a second (cheap uniform/colour sets).
- Fused Fire children render in the evolved (yellow-white) flame palette.
- `npm run bench` not run: per-frame cost is one wrapper call per hit; no new meshes beyond the parts'.
- PLAN.md decision-log paragraph (for the lead): "2026-10-19: Weapon fusion (fusion lane, notes/lanes/fusion.md). Two maxed auto weapons fuse into one of 10 hybrids from a level-up card; the hybrid runs both parts at evolved strength (x1.1-1.2) plus a rider linking them, and frees an auto-weapon slot. Loadout weapons never fuse."
