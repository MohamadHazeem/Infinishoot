# weather2 — weather that changes the fight

## Players get

Four 45-second stage events, with host-owned simulation, banners/sound, a compact English/Arabic HUD, persistent lightning warnings, and visible countermeasures:

- **Sandstorm / dunes:** clear sight to 9 m; enemies become dark silhouettes between 9 and 13 m, then bodies and blob shadows disappear. Every living hero contributes a sight bubble (up to eight, including shared-screen co-op). Enemy ground attack warnings and luminous bullets remain readable. Alternating 7-second gusts accelerate bullets sideways, peak 5 m/s², friendly shots at 65% strength.
- **Blizzard / peaks:** ordinary enemies accumulate cold over 7 s and slow up to 65%. Enemies whose resulting speed is at most 1.8 m/s freeze for 2.5 s; the first non-fixed hit shatters their ice using the existing shard damage/VFX and 75% frozen-hit bonus. Bosses, mini-bosses, Titan parts and Reapers are excluded. Thawing/shattering gives a 3 s respite before cold rebuilds. Standing heroes fill CHILL in 5 s, reaching 35% movement reduction; moving or warming thaws in 2 s. Dashes keep full distance. Active Fire-tag weapons, lava edges, and braziers warm within 4 m. Touching a brazier carries warmth for 14 s and lets nearby teammates share it; the pickup returns after 10 s.
- **Lightning storm / meadow or neon:** one random strike near the team every 2.8 s, with a fixed 1.6 s ground warning and threat-bus whistle. Radius 2.2 m, hero damage 18 × stage damage scaling, enemy damage 65 × horde HP scaling. Existing armor, i-frames and max-hit cap apply. Shooting a gold-tipped rod charges three redirects onto enemies nearest that rod within 22 m. Aim positions lock when the warning appears; enemies can move away. Redirected strikes still hurt heroes. Swept bullet collisions catch fast shots; Laser and Rail hitscan shots also charge rods. No enemy nearby means the charges wait rather than being wasted.
- **Heat wave / magma:** visible dark 3 m checker tiles fill HEAT in 10 s. Full heat deals 4 × stage damage scaling once per second. Pale ground, the start plaza, cyan cooling pools, and shade within 1.8 m of solid cover cool in 3 s. A pool is placed near each hero; placement avoids hazards. Ground shimmer follows distortion/quality/reduced-effects settings and cosmetic WEATHER. Burning enemies spread fire every 0.75 s within 3 m, up to 12 new targets per tick at 65% source DPS, preserving owner credit. At most 24 burning-source queries per spread tick; new ignitions cannot cascade within that tick.

**WEATHER EFFECTS** is a new GAMEPLAY setting, enabled by default. In solo/co-op it is the authority's decision. Turning it off cancels gameplay weather; a client's local setting does not override the host. Existing **WEATHER** remains cosmetic. Old settings acquire the default automatically; no profile/save format change.

## Decisions and integration

- Reuse `RunEvents` scheduling/registration. Its optional `eventAllowed` predicate filters the four additions by actual biome and settings. An eligible weather is one entry in the existing classic event pool. Existing world-event priority/suppression stays in place; weather is not an additional independent hazard roll. Random weather is excluded from PvP, training and boss rush; raid does not run it. `&weather=` deliberately permits any biome for QA, while honoring WEATHER EFFECTS.
- One persistent countermeasure per hero at event start, found on reachable space nearby, rather than adding globally shared pickup enum/protocol values. Braziers are collectible; rods are shootable field pickups. Heat creates explicit cooling pools because Magma Isle ordinarily has no water. Pale tiles also cool: there is always nearby relief, even if a pool is off-screen.
- New state uses a per-Game WeakMap. `w2` is the only new snapshot field: kind, remaining time, elapsed time, hero exposure/warmth/shelter, pickup positions/cooldowns/charges, and pending strike positions/times. Generic snapshot codec handles it; late joins reconstruct warnings without needing the original VFX event. Client movement uses host chill while other weather gameplay never runs on clients.
- All enemy damage goes through the existing damage pipeline; lightning kills are credited as environmental kills. Cosmetic effects/audio use `game.vfx`. Rendering does not tick hazards. Sand masking uses shared retro uniforms plus a tiny generic enemy-body visibility hook; attack telegraphs deliberately survive the mask.
- Mesh pools are fixed-capacity InstancedMeshes with live-slot `commit` uploads. Weather HUD inherits UI SCALE through `#goals`; its CSS lives in the lane module, including a smaller Arabic font to fit at 125% scale. No runtime dependencies, generated external assets, network services, save migration, or new controls.
- Debug panel: **Combat weather**, backed by `weather2Tuning` in `src/data/weather2.ts`. Stage duration is initialized from its 45-second default in event data.

## Files touched

Owned: `src/data/weather2.ts`, `src/game/systems/weather2.ts`, `tests/weather2.test.ts`, this note.

Small shared integrations:

- `src/data/stageEvents.ts`, `src/game/runEvents.ts`, `src/game/systems/spice.ts`: additive event registration and eligibility, omit duplicate generic HUD line.
- `src/game/game.ts`: simulation and local movement hooks.
- `src/game/systems/netHost.ts`, `netClient.ts`: `w2` serialization/application and client movement.
- `src/game/systems/combat.ts`: surviving frozen enemies shatter on their first direct hit (lethal hits retain the existing kill/shatter path).
- `src/game/systems/render.ts`, `src/game/enemies.ts`, `src/render/retroMaterial.ts`: weather view, body/shadow visibility predicate, radial sand shader uniforms.
- `src/game/settings.ts`, `src/ui/settingsScreen.ts`, `src/ui/debugPanel.ts`: persisted toggle, setting row and tuning folder.
- `src/i18n/en.ts`, `ar.ts`: paired catalog entries.
- `src/dev/testLinks.ts`: one lane test-link call.
- `scripts/coop-test.mjs`: opt-in `--weather2` scenario; ordinary scenarios unchanged.
- `PLAN.md`: short decision-log entry.

## Repro links and screenshots

Use `?test&god&bench&season=off&wevoff&seed=42` plus:

- `&stage=2&biome=dunes&weather=sandstorm&spawn=shooter:8&spawnr=16&zoom=1.7`
- `&stage=3&biome=peaks&weather=blizzard&spawn=chonk:8&spawnr=9`
- `&biome=meadow&weather=lightning`
- `&stage=4&biome=magma&weather=heatwave`
- `&stage=3&biome=peaks&weather=blizzard&lang=ar&ui=125`
- `&weather=lightning&weatheroff` tests the off switch; `&noweather` turns off cosmetic weather only.

Ran `npm run shot -- "?test&..." shots/weather2-*.png --wait 4` and longer 12/24 s captures on the busy shared machine. Inspected sandstorm, wide sandstorm, blizzard, lightning, heat wave and Arabic at 125%. Images stay in ignored `shots/`.

## Verification

- `npm run typecheck`: PASS.
- `npx vite build`: PASS (existing large-chunk warning).
- Focused `tests/weather2.test.ts`: PASS. Covers eligibility, bounded meters, gusts, swept rod hits, off switch vs cosmetic setting, radial visibility, chill movement/dash exemption, brazier/Fire weapon warmth, freeze/shatter on a surviving enemy, boss exclusions, full strike warning, hero/enemy damage, no double hit, redirection, actual compact Game snapshot hooks, client authority, heat damage/cooling, fire ownership, cleanup and Arabic entries.
- `npm run coop`: PASS, including ordinary boss, arena, spectator, party and trading scenarios; 2,645 snapshots, average 1,964 bytes, max 8,208 bytes.
- `npm run coop -- --offline --weather2 --only weather2 --secs 16 --no-spectate --out shots/weather2-coop`: PASS. Real WebRTC with local signalling, simulated 70 ms latency / 30 ms jitter / 2% loss; all four events, pickup positions, pending lightning warning and cleanup mirrored.
- `npm test`: weather tests pass; the full suite reports five pre-existing failing files, each reproduced separately from an untouched `git archive` of baseline **d82dd58dd59bd23a476978abf3b90d8399ba90dc**, using the same Node 22/dependencies:
  - `eightp.test.ts`: fixture tries to set `lastHeard` on a null client.
  - `followups.test.ts`: shield test expects two bullets left; baseline leaves four.
  - `i18n.test.ts`: the existing Shield weapon description lacks its Arabic catalog entry.
  - `raceCoop.test.ts`: obsolete four-player cap expectations (two assertions).
  - `spectateCoop.test.ts`: fifth-player admission/spectator/drop-in expectations (seven assertions).
  These failures are outside weather's files/behavior and are left for the integrating lanes. The complete repository test gate is therefore **not green**.
- `npm run smoke`: PASS, every mode/hero plus the final mortal run and game-over/history checks; no runtime errors.

Performance: `npm run bench` heavy scenes with ~209 enemies and 726 bullets measured blizzard at **0.40 ms/sim step + 0.97 ms game.render**, versus the equivalent no-weather scene **0.44 + 1.15 ms**. These short SwiftShader runs were on a machine shared by the overnight builders; differences are noise, and the very slow software GPU/frame intervals do not establish native-GPU 60 fps. Final sandstorm with body/shadow culling measured **0.39 ms/sim step + 0.98 ms game.render**. All three game CPU measurements remain in the requested ~2 ms range. No per-frame collection creation in the lane simulation/render mesh work; HUD text and 20 Hz snapshot serialization follow existing UI/network conventions.

## Remaining limits / risks

- Weather is implemented end to end; balance numbers are initial tuning, not a human playtest verdict. Natural appearances inherit the classic-event pool and world-event suppression, so they are intentionally occasional.
- Existing THREAT MORTAR sound/arrow is reused for lightning's incoming warning (the ground rings and WEATHER HUD identify the storm); a dedicated recorded warning/arrow label would be future audio polish.
- Rods accept pooled player bullets and Laser/Rail hitscan. Melee-only Ronin cannot activate a rod with Katana; teammates/other equipped projectile weapons can. Rods are bonuses, never required to escape a strike.
- Heat pools are flat stylized cyan water discs. Cover shade is a gameplay distance band independent of optional dynamic GPU shadows. Sand hides bodies/shadows outside sight while intentionally leaving danger telegraphs and luminous shots visible.
- Short headless screenshots/benchmarks and two-browser tests are complete; no physical gamepad, native GPU, or eight-browser weather playtest was performed.
