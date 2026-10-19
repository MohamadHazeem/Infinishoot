# weapons3 — six weapons, two fusions

## Players get

- **Crosswind Blades**: curved crescent throws, one hit outward and one on return. Five levels increase blade count/size/reach; Jet Thrusters evolves them into six double-edged **Gale Reapers**. Projectile/orbit tags.
- **Tesla Coils**: drops a trail of coils that individually zap and damage enemies crossing their connecting fence. Five levels grow from two coils to four; Battery Pack creates six yellow **Thunder Grid** coils. Trail/chain/shock tags.
- **Swarm Missiles**: small finned homing rockets launch in staggered fans, reacquire targets and explode. Five levels grow from five rockets to ten; Power Cell unlocks fourteen larger **Hornet Armada** rockets. Projectile/explosive tags.
- **Prism Shards**: ricocheting crystals split once into two smaller shards at 45% damage (children cannot split again). Five levels increase crystal count and hops; Cryo Rounds unlocks four crossed **Kaleidoscope** crystals with six hops. Projectile/chain tags.
- **Beam Whip**, left click: alternating broad sweeps; each enemy is hit once per swing. Capacitors / Swing Tempo / Light Links each have four ranks. At eight total ranks choose **Sunlash** (Fire, wider sweep, +25% damage) or **Twinlash** (a second opposite whip, Shock). Unlock: **Light Tamer**, 1,500 lifetime kills.
- **Pocket Sentry**, right click: cursor-positioned autonomous turrets, oldest replaced at capacity. Payload / Quick Servos / Field Battery each have four ranks. At eight ranks choose **Glacier Sentry** (Frost, +2 pierce, +20% damage) or **Ember Battery** (two burning barrels at 70% damage each, +1 sentry capacity). Unlock: **Field Engineer**, 12 lifetime elites.
- Both loadout items use existing Overdrive (all tracks complete, evolved, +8% damage per Overdrive). Existing save normalization grants proven lifetime achievements, so veterans get the unlocks without a save-version change.
- **Glass Gale** fusion combines Crosswind + Prism; **Hornet Grid** combines Tesla + Swarm. Both retain their children's rendering/music and gain the existing fusion bonus machinery.
- Twelve distinct pixel silhouettes (including loadout forks and fusions), six music stems, eight evolved synth layers, hit-feel entries, existing recorded/synthesized attack cues. Arsenal entries, cards, HUD levels, tags, status/Mod interactions and discovery are derived from the normal content tables.

## Tuning

All four autos are uncommon and available in the normal auto-weapon pool. Their partners are unique among the current auto evolution recipes.

| Weapon | Level 1 | Level 5 | Evolution |
| --- | --- | --- | --- |
| Crosswind | 24 damage, 2 blades, 1.6s throw, 7 reach | 44 damage, 4 blades, 1.1s, 10 reach | 58 damage, 6 blades, .95s, 11 reach |
| Tesla | 14 damage, 2 coils, 2.8s deploy, .7s pulse, 6 range | 32 damage, 4 coils, 2s deploy, .5s pulse, 8 range | 54 damage, 6 coils, 1.6s deploy, .4s pulse, 10 range |
| Swarm | 13 damage, 5 rockets, 2s wave, 1.1 blast radius | 28 damage, 10 rockets, 1.5s, 1.5 radius | 36 damage, 14 rockets, 1.25s, 1.8 radius |
| Prism | 15 damage, 1 crystal, 2 hops, 1.8s | 30 damage, 3 crystals, 4 hops, 1.2s | 40 damage, 4 crystals, 6 hops, 1s |

Whip: 48 damage / 2.1 swings/s / 4.8 reach / 120° base; full tracks 134 / 3.2 / 6.7 / 160°. Sunlash adds 40° and .16 width; Twinlash adds .8 reach. Sentry: 22 damage / 3 shots/s / 3s deploy / 6s life / capacity 2; full tracks 61 / 4.7 / 2.3s / 10s / capacity 3. Sentry targeting range 11→14, deployment range 7→8.

Fixed capacities: 32 blades, 6 coils, 96 rockets, 96 crystals, 8 sentries; 512 enemy IDs per blade/whip hit ledger. Render uses reused transforms and InstancedMesh batches; gameplay uses pooled slots, swept collisions and reusable radius-query arrays. Target UIDs prevent homing onto recycled enemy objects. Damage, effects, material impacts and sound go through the existing WeaponCtx pipeline. Cosmetic meshes use retro materials; no added camera shake or full-screen flash. Sound uses the existing volume buses. No settings toggle or runtime dependency was added.

## Balance and performance

Bot methodology: `scripts/weapons3-balance.ts`, normal difficulty, Rookie, no pet, stage 2 at director time 90, 60 seconds per weapon/tier, seeds 42/77/123. Both Game RNG and legacy Math.random rolls are seeded; the bot's right-click hold phase resets for each sample. Existing bot movement/aim/click behavior is unchanged. One tested weapon, fixed build, no XP levels, temporary weapons, cash-ins, chests, event buffs, specials or ultimates. Damage attributed directly to that weapon / elapsed simulation time; shared burn/status damage is excluded. These are crowd DPS comparisons, not single-target DPS or a promise of identical human performance.

Reproduce (optional weapon IDs after the final command):

```sh
npx rolldown scripts/weapons3-balance.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/weapons3-balance.mjs
node node_modules/.tests/weapons3-balance.mjs
```

Mean direct DPS across the three seeds; max means level 5 for autos or all 12 loadout ranks (no Overdrive).

| Weapon | Base | Max | Evolution / fork 0 | Fork 1 |
| --- | ---: | ---: | ---: | ---: |
| Crosswind Blades | 194.2 | 562.9 | 898.6 | — |
| Boomer Disc (reference) | 97.8 | 492 | 675.9 | — |
| Tesla Coils | 55.8 | 468.8 | 769.5 | — |
| Chain Zap (reference) | 61.1 | 689 | 1691.8 | — |
| Swarm Missiles | 84.1 | 383.8 | 777 | — |
| Seeker Pod (reference) | 109.4 | 765.3 | 1270.7 | — |
| Prism Shards | 31.2 | 454.6 | 1354.4 | — |
| Bounce Drone (reference) | 23 | 282.9 | 965.8 | — |
| Beam Whip | 225.3 | 569.9 | 627.5 | 790.2 |
| Pulse Laser (legendary reference) | 255.2 | 1014.2 | 1320.7 | 753.4 |
| Pocket Sentry | 116.3 | 442.2 | 989.6 | 878.1 |
| Grenade Lobber (reference) | 152.6 | 568.8 | 615.7 | 713.8 |

Crosswind and Prism land near their comparable projectile weapons. Swarm trades concentrated Seeker Pod damage for a staggered fan; Tesla is strongest when its fence holds a position, so the constantly moving bot puts it below Chain Zap (especially its powerful evolution). Thunder Grid was raised from five coils / 44 damage / .42s pulse / 9 range to six / 54 / .4s / 10 after the initial comparison. Rare Beam Whip stays below legendary Pulse Laser at full ranks while providing a wide sweep and a rear-coverage fork. Sentry is in the Grenade band with sustained fire and better Frost piercing. Fire-fork totals here exclude burn attributed to the shared status bucket.

Production benchmark, HIGH / 960×540 / 15s after 5s warm-up, same stage-5 meadow stress scene and 500-bullet fixture:

| Kit | Sim / step | Game render | GL submit | Total CPU / frame | Enemies avg | Bullets avg | Draw calls avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Existing drones/missiles/lightning/fire + default click kit | .69 ms | .86 ms | .89 ms | 2.44 ms | 272 | 509 | 161 |
| All six new weapons, evolved/full tracks | .83 ms | .92 ms | .92 ms | 2.67 ms | 267 | 489 | 166 |

949/943 frames sampled, 16.67ms frame intervals in both runs. New-kit CPU is +.23ms (~9%), still in the same range. Weapon/special simulation rose .141→.228ms. This shared build machine's SwiftShader driver stalled repeatedly, so successful browser checks used Chromium ANGLE Metal (`SHOT_CHROME` wrapper for bench/shot; `--angle metal` for co-op). The bench's hard-coded “SwiftShader” label is therefore inaccurate for these runs. Hardware/UI timings are environment-specific; JSONs live in ignored `shots/weapons3-bench-metal-*.json`.

A second stress check raised the fixture to 600 bullets: **267 enemies / 606 bullets average** (297 / 674 max), **2.47ms total CPU**, .78ms simulation, 944 sampled frames at 16.67ms intervals. Its lower timing despite more bullets reflects normal shared-machine/scene variation; it confirms the requested 150+ enemies / 500+ projectiles load stays comfortably within the frame budget.

## Co-op / integration

All damage runs in weapon `update()` on the host. Each class supplies compact, quantized `net()` / `setNet()` state through the existing per-weapon snapshot field; client `render()` never deals damage. Existing effects bus carries attack cues, hits and explosions. Sentry bullets retain owner, shape, source, color and status tags through the real bullet codec and combat path.

Sentry is appended at **BULLET_KINDS index 16**, with `SENTRY_BULLET_KIND` in sentry.ts. **Merge caution:** if another lane appends static bullet kinds, keep this constant aligned with the merged table; do not insert before existing kinds. Dynamic gameplay kinds append after this table. New codec colors are appended (`#a7f070`, `#9fe8ff`); orange uses the existing entry. No snapshot protocol or save-shape change.

`npm run coop -- --weapons3 --angle metal` equips both online heroes with the entire evolved kit and opposite click forks. This optional scenario gives the scheduled boss 10 million HP so the maxed kit cannot end combat before the existing timed ping/parry checks. All existing checks remain enabled. The harness also supports `--angle swiftshader` (default). No gameplay workaround was added for this test.

## Test links / visuals

- `?test&god&weapons3=base`: all six weapons at level 1.
- `?test&god&weapons3=5`: maximum normal levels/tracks, no evolutions.
- `?test&god&weapons3=0`: all evolved, Sunlash + Glacier Sentry.
- `?test&god&weapons3=1`: all evolved, Twinlash + Ember Battery.
- Add `&weapons3lab&spawn=chonk:18&spawnr=6&aim=0,-1&rclick=1&circle&quality=low&day&dry` for the isolated visual range. Lab holds the director, makes initial targets durable and suppresses temporary gameplay effects/levels; it only runs when explicitly requested with `weapons3`.
- Existing `weapons=...`, `loadout=...`, `evo=...`, `aim`, `rclick`, `circle`, and `audio` work normally. Debug panel has a Weapons3 tuning folder.

Inspected the base/max kit, both evolved kits, active whips/coils/sentries/rockets/crystals, and a 24/48/72px icon contact sheet. Improved Prism, Sunlash and Ember icon silhouettes after the first review. PNGs are local ignored artifacts in `shots/weapons3-*.png`.

## Files touched

- New behavior: `src/game/weapons/{crosswind,tesla,swarm,prism,whip,sentry,weapons3Shared}.ts`; registered in `src/game/weapons/index.ts`.
- Content: `src/data/weapons.ts`, `fusions.ts`, `meta.ts`, `unlockProgress.ts`, generated `iconArt.ts`; `scripts/icons.mjs`.
- Audio: `src/audio/stems.ts`, `evoLayers.ts`.
- Small integration additions: `src/game/game.ts` (one bullet kind), `src/game/systems/runFlow.ts` (two unlock checks), `src/net/codec.ts` (two colors), `src/ui/debugPanel.ts` (tuning folder), `src/dev/testLinks.ts` (helper hook).
- New developer helper: `src/dev/weapons3Links.ts`; `scripts/coop-test.mjs` optional kit/renderer scenario; `scripts/weapons3-balance.ts` bot comparison.
- Tests: `tests/weapons3.test.ts` (content, tracks, flags, collisions, split limits, ownership, codec, rendering, disposal, real Game host→client snapshots and sentry combat).
- Documentation: this note and `PLAN.md` decision log.

No changes were needed in tracks.ts, arsenal.ts, hero.ts, netHost.ts or netClient.ts: their generic paths already support the new definitions and weapon state. No new screens, CSS, audio files, dependencies or secrets.

## Validation

- `npm run typecheck` and `npx vite build`: passed (existing bundle-size warning only).
- `npm test`: all **57 files passed**. An earlier run hit the already documented intermittent arenaCoop cover assertion; its unmodified rerun passed. This lane's initial duplicate evolution-partner test failure was corrected before the passing run.
- `tests/weapons3.test.ts`: passed again after final tuning, including real host/client snapshot construction and application, sentry source/owner/status handling, all six active states and both click forks/Overdrive.
- `npm run coop -- --weapons3 --angle metal`: passed; **1,515 snapshots, 2,701 B average, 9,745 B maximum, none over 16 KB**. Skill-event send/receive counts match. The first max-kit attempt exposed the timed boss fixture issue described above; the corrected fixture passed all assertions.
- `npm run bench`: production reference, full kit and 600-bullet stress checks passed; measurements above.
- `npm run shot -- ... --wait 4`: passed through the local Metal launcher; PNGs inspected, plus a scripted contact sheet and both evolved kits.
- `git diff --check`: passed.
- `npm run smoke`: passed again after final tuning, including all modes/heroes, training, three-player local co-op, mortal run, game-over/history and zero runtime errors. All four new autos appeared in naturally chosen bot builds.

## Remaining risks

No planned feature is deferred. Human controller feel and listening on real speakers remain subjective review items. Full-build crowd balance is intentionally bounded by pools, so extreme cooldown/quantity builds can saturate them. Crosswind returns to its launch point (a readable fixed path), not to the moving hero. Coils only link within 1.5× targeting range, so sprinting far away breaks the fence visually and mechanically. Merge the sentry bullet index as described above.
