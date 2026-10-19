# pets2 — six more companions

## Players get

All six pets appear in EXTRAS → WARDROBE, use the existing per-stage growth (levels 1–5), show their learned/next skills in the pet HUD, and retain profile pet hats. Names, personalities, new skill descriptions and scout labels have English/Arabic entries. No save schema or persistent stat changes.

| Pet / achievement | Level 1 → 5 | Personality and model |
| --- | --- | --- |
| ROBO-PUP / First Steps (300 lifetime kills) | Fetch, Taunt, Fetch II, Shield, Taunt II | Loyal, loud orange robot puppy; floppy ears, metal paws, muzzle and tail. Bark decoy uses the existing taunt targeting. |
| OWL-BOT / Elite Hunter (5 lifetime elites) | Scout, Zap, Scout II, Shield, Revive | Curious cyan owl with goggles, beak, ear tufts and wings. Direction/distance readout prioritizes elites; Scout II also locates unfinished hidden relays and adds a steady night lantern. It does not solve secret puzzles. |
| SLIME BUDDY / Onward (reach stage 2) | Gulp, Fetch, Split, Gulp II, Split II | Cheerful green jelly; absorbs hostile bullets and summons two hopping helpers. |
| DRAGON HATCHLING / Deep Diver (reach stage 3) | Fire Burst, Taunt, Fire Burst II, Shield, Wings | Brave orange dragon with horns, snout and tail. Its wings appear at level 5 and improve fire range/damage. |
| CAT DRONE / Speedster (60 dashes in one run) | Swipe, Fetch, Lucky, Swipe II, Lucky II | Smug plum/gold cat with pointed ears, whiskers and curled tail. Steals from distinct enemies and improves the owner's crit chance. |
| MINI MECH / Field Engineer (12 lifetime elites) | Turret, Shield, Porter, Turret II, Revive | Diligent blue engineer with square arms, feet and backpack. One temporary turret; Porter holds the co-op objective bomb above the pet and removes bomb slowdown. Normal pickup/drop/plant/credit rules remain with the owner. |

## Numbers and decisions

- Existing `petTuning` still controls Fetch, Taunt, Shield, Zap and Revive. The six new trees deliberately do not all grant Revive; companion tests now keep that guarantee only for the three original pets.
- `pets2Tuning` in `src/data/pets.ts`: Scout every 2 s, range 48 m, elite/boss priority. Scout II night radius 17 m, through the existing quality-controlled point-light budget. The compass stays inside the pet panel and uses projected screen directions, including distant/off-screen threats and relays.
- Gulp checks every 0.1 s while ready, deletes at most one hostile projectile within 2.8 m, cooldown 7 / 4 s. Friendly bullets are untouched.
- Split: two helpers for 6 s every 12 s; both attack every 0.9 s in 7 m. Each hit `(9 + 2 × team level) × rank` before ordinary stats/Mods/crits.
- Fire: forward cone (dot ≥ 0.65), 7 m, every 3.2 / 2.2 s, `16 + 4 × team level` damage plus the usual Fire-tag burn. Walls block the cone. Wings add 2 m and ×1.3 damage.
- Swipe: 1 gold from each previously unrobbed enemy within 8 m, every 5 / 3.5 s; 18 gold maximum per stage, plus a small `8 + 2 × team level` hit. Lucky adds 5 percentage points of crit chance per rank (10 at level 5).
- Turret: one emplacement for 7 s every 12 s; fires every 1 / 0.65 s in 11 m for `10 + 2 × team level`. Walls block its shots. It stays where planted and expires before another deploys.
- No new controls or settings. `PET SOUNDS` is checked at playback on each peer. Cues reuse existing synth/sample routes for jump pad, block, flame, coin, mine and shoot. Reduced motion disables pet bob/spin/flap and growth flashes; the panel's pop also honors reduced motion. Pet/team panels now follow UI SCALE.
- Skill updates are host-only; new attacks/theft are disabled in holstered minigames and active new skills are disabled in PvP; Lucky remains a passive build stat like Fetch’s magnet bonus. Timers and the capped theft set reset on a new run or stage. Models merge colored static geometry into one mesh per body; only wings, two helper bodies and one turret add moving meshes. No new runtime dependencies or external content/API requests.

## Network and integration

- Existing pet IDs travel in lobby/start records; levels/ranks remain in `cp.p`. New presentation records live in additive `cp.p2`, one entry per hero (null for legacy pets): split lifetime, turret lifetime/position, threat kind/position, relay flag/position. Existing snapshot codecs handle it without a wire-format change. Old companion payloads remain readable.
- Combat effects use `game.vfx`; `pet2:` sound names map to existing cues at playback, so each client's own PET SOUNDS setting is respected.
- The bomb still belongs to its hero; Porter changes the movement penalty and presentation, not objective authority or fuse/damage/reward behavior.
- Hats retain the existing first-child Group socket. They remain local profile cosmetics, as in the existing meta2 system; this lane does not invent a separate hat protocol.

## Files

- Owned/new: `src/data/pets.ts`, `src/game/pet.ts`, `src/game/pets2.ts`, `src/game/systems/pets2.ts`, `src/ui/pets2Hud.ts`, `src/audio/pets2.ts`, `src/i18n/pets2.ts`, `src/dev/pets2Links.ts`, `tests/pets2.test.ts`, this note.
- Small hooks: `hero.ts` (Lucky), `systems/companion.ts` (step, snapshot, bark, HUD), `systems/coopplay.ts` (Porter), `systems/look.ts` (night light), `systems/render.ts` (motion preference passed to view), `vfx.ts` (pet sound dispatch), `ui/companionHud.ts` (skill list / scoped CSS), `ui/hudLayout.ts` (scale selectors), `ui/debugPanel.ts` (tuning controls), `i18n/{en,ar}.ts` (catalog spreads), `dev/testLinks.ts` (QA hook), `tests/companion.test.ts` (legacy revive assertion), `tests/{coopplayCoop,raceCoop,netcode,biome3}.test.ts` (fixture repairs), `scripts/coop-test.mjs` (`--pets2`), `PLAN.md` (decision).

## QA links

- Existing `pet=robopup|owlbot|slimebuddy|hatchling|catdrone|minimech`, `petlv=1..5`, `mate=<pet>`, `taunt`, `petgrow=<seconds>` work without special ID plumbing.
- `?test&god&pet=hatchling&petlv=5&stage=2&day&dry&season=off&cam=0.55&petpose` gives a quiet, paused model/HUD close-up. `petpose` hides transient banners and poses helpers/turret for inspection; it does not save profile changes.
- `?test&pet=owlbot&petlv=5&night&lang=ar&secret=wall&secretclosed&cam=0.6&m2lv=28&m2equip=hat_tophat` checks Arabic, night vision and hats in live play.
- `?test&pet=minimech&petlv=5&mate=owlbot&coopobj=bomb&cpbomb&cpmate=bomb&cam=0.6&petpose` checks the bomb on the mech.
- `?test&petwardrobe&lang=ar` unlocks all pets in test memory and opens the scrollable picker.
- `npm run coop -- --offline --pets2` uses Mini Mech / Owl-Bot and checks turret/scout records over real local WebRTC with in-process signaling; no external broker/API is contacted.

## Verification

Targeted `tests/pets2.test.ts` passes: all trees/unlocks/translations, growth/reset, hat sockets/disposal, bark, elite/secret scouting, night light, hostile-only bullet absorption/cooldown, helpers, fire cone/burn/wings, crit bonus, theft budget/no repeat theft, turret placement/expiry, Porter slowdown, real snapshot codec and client authority, old/malformed extension handling, holster/PvP and sound settings. Smoke passes across existing modes/heroes and mortal game-over flow. Typecheck and production Vite build pass. Offline real WebRTC passes with `COOP_TIMEOUT_MS=120000 COOP_LOW=1 COOP_ANGLE=metal npm run coop -- --offline --pets2 --netsim off --size 640x360`: 1,572 snapshots, mean 1,711 B / max 13,256 B, no packets over 16 KB; growth, pet extension, reconnect, restart and lobby flows passed. The earlier SwiftShader attempt passed pet replication but exceeded the lobby ping deadline under load; native Metal passed it at 3 ms.

Visual QA used `npm run shot` plus native Metal Playwright captures (the software renderer was too slow for the default wait). Inspected all six level-5 models/HUDs, English/Arabic wardrobe, night scout with a hat, and Porter bomb presentation. Fixed hidden eyes, growth-pop poses and wardrobe overflow. Final captures are ignored local artifacts in `shots/pets2-{robopup,owlbot,slimebuddy,hatchling,catdrone,minimech,wardrobe-en,wardrobe-ar,bomb}.png`.

Production HIGH/Metal heavy benchmark, 1280×720, 15 s after 4 s warmup, seed 42, 200 initial swarm / held spawns / 500 projectiles; same scene and weapons for all runs:

| Pet | Sim ms/frame | Render ms | GL ms | Callback CPU ms | Enemies avg | Bullets avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| None | 0.77 | 0.98 | 0.99 | 2.75 | 300 | 521 |
| Slime Buddy Lv5 | 0.79 | 1.00 | 1.00 | 2.79 | 305 | 505 |
| Mini Mech Lv5 | 0.78 | 1.00 | 1.04 | 2.82 | 302 | 511 |

All three held 16.67 ms frame intervals (60 fps); including existing asynchronous replay callbacks, total CPU was 3.64 ms/frame in each. No new per-frame gameplay allocations; scans and attacks run on bounded timers. JSON/logs retained in `/tmp/pets2-bench-{base,slime,mech}.{json,log}`. `npm test` final rerun: all 96 test files pass (`/tmp/pets2-suite-verified.log`). `npm run smoke`: all checks pass, including mortal game-over and no runtime errors (`/tmp/pets2-smoke.log`). Final typecheck/build and the repeated co-op run also pass (`/tmp/pets2-coop-verified.log`).

Four existing test fixtures needed small repairs while running the required complete suite (gameplay unchanged): `coopplayCoop.test.ts` left the host on the previous zone, which can also be the newly spawned bomb location, and ticked before moving it; the host had already picked up the bomb before the guest's test. Reproduced with the Porter condition removed and both pets `none`; move both heroes away before those initial ticks. `raceCoop.test.ts` manually constructed an outdated PvP object without `rules`/`teams`/`wins`; added the current one-round fixture fields. These are isolated in test commits. `netcode.test.ts` could retain the host’s deliberate 3 s load-stall grace after constructing its reconnect client; the silent-peer fixture now explicitly starts after that local stall. `biome3.test.ts` sampled live bullet count after the ring could have collided with random arena geometry; it now observes the actual ten-shot emission with a bounded wait and removes weapons from both heroes for the isolated check.

## Risks / unfinished

No unfinished lane work. Night vision uses the existing light budget, so POTATO (lights disabled) still gets scout arrows but no extra illumination. The turret is a bounded hitscan support emplacement, not a duplicate of the full Turret Beacon weapon. Skill trees are fixed five-step progressions, matching the original companion system.
