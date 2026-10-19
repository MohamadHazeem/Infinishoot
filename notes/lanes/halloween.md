# Halloween lane

## Players get

- A data-driven UTC calendar in `src/data/seasons.ts`. Halloween runs October 15 through November 7 inclusive. `?season=halloween` forces it; `?season=off` disables it for deterministic testing. The host selects the event at run start and keeps that choice across stages and calendar boundaries. Daily/weekly challenges and competitive modes keep their normal content.
- An orange Halloween title, harvest banner, and persistent TRICK-OR-TREAT booth. The booth remains accessible outside the event to equip previously purchased costumes.
- Stage 2 of each four-stage loop becomes Haunted Meadow: purple/orange night grading, fog, dead trees, jack-o’-lanterns, candles, and cobwebs. Static added scenery is baked into one vertex-coloured draw call. The final boss stage remains intact.
- Pumpkin Heads burst into five seed projectiles on defeat. Ghosts pass through walls, hover, and fade with a four-second pixel-dither cycle while remaining targetable. Bats arrive in eight-member swarms. Cauldron Witches spawn as elites and lob marked bubbling-brew blasts.
- PUMPKING replaces the Haunted stage boss. He throws seed fans, summons pumpkins, adds marked vine grabs in phase 2, and sweeps carving blades around a ring in phase 3. The existing phase gate prevents burst damage from skipping phases. His pumpkin portrait, comic finisher, lore entry, recorded roar/intro/phase/defeat, boss duel, and boss rewards use the existing systems.
- Candy drops during seasonal runs, including ordinary stages. Collecting a candy awards its value to every connected teammate and immediately saves it. The three permanent purchases are Pumpkin Helmet, Bat Pet, and Ghost Trail; all are cosmetic, independently equippable, and visible to teammates.
- Midnight Candy Parade: a 116 BPM harmonic-minor arrangement with a sine lead and square arpeggio for theremin/organ flavour. Haunted ambience uses `amb_halloween`; existing recorded pumpkin, ghost, bat, witch, sting, and greeting samples are wired through the effects bus. Boss lines use the voice bus/settings.

## Tuning / decisions

- Haunted stage: 2, 6, 10, 14, etc.; UTC dates avoid players in different zones choosing different calendar days. Network start/stage messages carry the host choice before arena generation.
- Candy: one per five ordinary kills, three per elite, twenty per stage boss. Pickup radius 2.2 m; pool cap 64; wallet cap 999,999. Currency persists between years. Costume costs: helmet 35, bat 55, trail 45 (135 total).
- One pumpkin and ghost every 3 s; bat swarm every 18 s; witch elite every 24 s. Seasonal additions stop at 350 active enemies and during boss encounters. Boss summons use the existing 480-enemy cap and stop during the final duel.
- PUMPKING: base HP 2,500 before existing boss/stage scaling; phase thresholds 66% and 33%; seed fans 9/11/13 bullets at 8/9/10 m/s, 12 base damage. Summons 3/4/5 pumpkins. Vines: radius 2.3 m, warning 1.15 s, 16 damage, grab 1.2 s within 0.65 m; dash breaks the grab. Knives: eight marked strikes at radius 5 m, warning 1.35 s plus 0.09 s stagger, strike radius 1.5 m, 18 damage.
- Ghost fading and pet bobbing respect reduced flashing / OS reduced motion. All costumes use retro materials. The candy HUD follows UI SCALE. Existing boss telegraph sounds remain on the threat bus.
- Candy and costumes use save v5 with `normalizeSeason` migration from v4/older saves; export/import includes them. Co-op snapshots own field `ha` contains shared candy, pickups, grabs, and cosmetic ids. Repeated snapshots are idempotent. Drop-in/reconnect starts with the host's current candy receipt as its baseline: returning players receive future pickups, not replayed historical rewards.

## Files / integration

New: `src/data/seasons.ts`, `src/game/systems/halloween.ts`, `tests/halloween.test.ts`, this note.

Additive content/hooks: biomes, enemies, codex, animation gaits, enemy instanced models/brain, boss phase subtitles, save normalization, music composition, audio samples/ambience/voices, portrait painter, title screen registration, HUD scale/debug tuning, test links. Shared Game hooks are one state object and install/update/context callbacks; run flow and net modules have small isolated seasonal blocks. `coop2.ts` carries season and candy baseline on drop-in. Existing migration/music-count and biome-ambience assertions were updated. The existing Lost Cargo cadence assertion now counts both normal and golden chests; a random jackpot previously made that test fail even when the spawn cadence was correct. `tests/timeCoop.test.ts` now starts from seed 42 so random arena walls cannot shorten its scripted walk and invalidate the rewind-distance assertion. `scripts/coop-test.mjs` accepts optional `--season`, `--angle`, and `--timeout`, and checks shared candy when Halloween is forced.

If another lane also increments save v5, merge the independent normalization fields rather than discarding either migration. No runtime dependencies, generated assets, external API calls for content, or `.env` changes.

## Test links

- `?season=halloween` — title and booth; dismissing the training offer must not remove the booth.
- `?test&season=halloween&stage=2&god&spawn=pumpkin:3,ghost:3,bat:6,witch:1&spawnr=6` — all enemies and scenery.
- `?test&season=halloween&stage=2&bossnow&nointro&god&phase=2&harvestshow` — boss placed near the camera; use phase 1/2/3.
- `?test&season=halloween&stage=2&bossnow&nointro&god&killboss=2&finat=0.7` — pinned PUMPKING finisher.
- `?test&season=halloween&stage=2&candy&costumes` — nearby candy and all cosmetic previews (test profile only).
- `?test&season=halloween&stage=2&treats&costumes` — stand / owned-card preview.
- Add `&calm`, `&quality=low`, or `&season=off` for accessibility / nonseasonal regression checks.

## Verification

- `npm run typecheck` and `npx vite build` pass. Vite reports the existing large-chunk advisory.
- `tests/halloween.test.ts` covers date boundaries, overrides, loop placement, save migration/export/import, purchases, PUMPKING phase gates and attacks, summon suppression during the final duel, identical host/client Haunted collision geometry, PUMPKING snapshot phases, shared/idempotent candy, bounded pickups, stage/reset receipts, seeds, vine escape, targetable ghosts, and cosmetic-only rewards.
- `npm run coop -- --season halloween --angle metal --timeout 120000 --out shots/halloween-coop` exercises real host/client gameplay and shared candy in addition to the existing stage, boss, finisher, revive, and skill scenarios. The final completed run sent 1,571 snapshots averaging 1,950 bytes (maximum 14,275; none over 16 KB). PUMPKING's specific phase/state transfer is also covered in the integration test. Metal and the longer startup timeout avoid slow SwiftShader startup under the parallel build load.
- `npm run bench -- --gpu metal --seconds 12 --warmup 3 --link '?test&bench&season=halloween&stage=2&seed=42&god&circle&aim=0.7,0.7&weapons=drones:6,missiles:6,lightning:6,fire:6&swarm=200&hold=170,24:ghost,12:witch&bullets=500&costumes'`: 61.9 rendered fps; total CPU 2.18 ms average / 2.67 ms p95; simulation 0.60 ms; 173 average / 211 maximum enemies and 491 average / 505 maximum bullets. This is the headless Metal measurement on this machine, not a hardware-independent guarantee.
- Captured with `npm run shot` and browser QA, then opened and visually checked: `shots/halloween-title.png`, `halloween-treats.png`, `halloween-owned.png`, `halloween-enemies.png`, `halloween-phase1.png`, `halloween-phase2.png`, `halloween-phase3.png`, `halloween-finisher.png`, and `halloween-costumes.png`. The final browser passes reported no runtime errors. Shop purchasing, equipped states, all three costumes, reduced-motion presentation, boss portrait/finisher, and arena dressing were inspected. Screenshots remain local as required by CONTRIBUTING.md.

`npm test`: all 58 test files pass. `npm run smoke` and the final Halloween co-op run also pass with no runtime errors. All required checks are complete.

## Known limitations / risks

- Candy is local profile currency, like existing meta cosmetics; it is not a server-backed economy. The host controls awards, clients control their cosmetic appearance. Offline save edits are outside the game's trust model.
- The calendar is frozen at run start. A run started before midnight on November 7 keeps its event until it ends.
- The stand is reached from the title between runs. The bat is a cosmetic follower, separate from the combat-pet slot; the ghost procession is cosmetic and has no damage/slow effect.
- The visual effects use procedural geometry and existing recordings; no additional downloaded art/audio or service is required. Subjective balance and headphone listening still benefit from lead play-testing.
