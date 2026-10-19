# modsupport — player-made content

## What players get

- SETTINGS > MODS: JSON/ZIP import, enable/disable, explicit load order, per-file errors, active pack count/hash, and restart. Enabled files that become invalid can still be disabled. Packs start disabled. Changes are queued until restart, including when edited from a paused run or online lobby.
- Desktop: JSON files from `<Electron userData>/mods`, sorted by filename until reordered in the screen. OPEN MODS FOLDER shows the actual folder next to Chromium save storage. Imported packs work on desktop too.
- Schema v1 adds/overrides three auto-weapon templates (`drones`, `aura`, `nova`), regular enemy templates with existing AI/models, stat relics, every existing shop Mod hook template, biome palettes/props/stage assignments and five classic stage-event templates. `docs/MODDING.md` is the complete supported-field reference; `docs/mods/example.json` demonstrates all six categories.
- Matching active content can play online. Mismatches are refused before lobby profile bookkeeping/drop-in admission and again on the client's lobby/start/PvP messages. The error explains how to align packs or return everyone to vanilla.
- English and Arabic controls; author-provided content remains plain text. All buttons use MenuNav. No new effects or sounds; inherited behaviours keep the existing access/quality/audio controls.

## Decisions and limits

- Data only; no eval, JavaScript, downloads, external assets or new runtime dependencies. ZIPs stay in memory; Stored/Deflate, UTF-8, CRC and bounds checks; no encrypted/multi-disk/ZIP64/path traversal/symlink loading. Non-JSON ZIP entries are ignored.
- 512 KiB per JSON, 4 MiB per import/library, 32 imported packs + 32 desktop files, 32 active packs, 64 entries per pack. ZIP: 128 directory entries / 32 JSON entries. Full enemy registry must fit 256 wire IDs; an over-capacity pack contributes nothing.
- Every pack validates before any of its entries apply. Later **explicit** overrides win, each starting from the shipped template. New IDs start with `<pack-id>_`; content and pack IDs are 2–48 lowercase identifier characters. Duplicate enabled pack IDs are errors. Object keys are canonicalized for SHA-256; arrays/load order and all manifest content/version matter. Disabled/broken packs do not enter the hash.
- Register before `new Game`: update live lists/lookups, refresh enemy codec IDs, clear biome cache. The active session is immutable. Preferences use `infinishoot.contentMods` version 1, separately from the profile; corrupt/blocked/full storage cannot crash boot and write failures appear in the screen. No `save.ts` migration needed.
- Weapon parameter patches replace those keys at every level/evolution, preserving other level parameters. Drone count 1–8, size .1–5, spin ≤30, cooldown/tick ≥.05 s, ranges ≤30. Mesh colour and direct damage attribution use the custom definition. The context adapter is cached once per weapon/context, with no new steady-state allocation.
- Enemy HP ≤100000, speed ≤40, radius .1–3, packs 1–12, behaviour projectile counts ≤8; event durations 3–90 s; shop prices 0–100, level caps 1–5. Biomes may assign up to 32 exact stages in 1–1000. See the guide/schema for all bounds.
- Stage events stay host-only and travel through the existing event ID/timer and VFX. Custom enemy models and weapon net state reuse existing simulation/rendering paths. No new frequent snapshot fields.

## Validation

- Node 22.23.3. Typecheck and Vite production build passed (existing large-chunk warning).
- `tests/modsupport.test.ts`: **78 assertions passed** on the final code. Covers validation for every category and unsafe/malformed values; exact field errors; all-or-nothing pack planning; duplicate IDs; explicit load order; stable/content-sensitive SHA-256; legacy/matching/mismatched handshakes; actual weapon params/tint/damage attribution and net/setNet; real custom enemy binary encoding/decoding; actual custom gold-rush execution/expiry; install/reset cache/list consistency; JSON/Stored/Deflate ZIP import and corruption/traversal/bomb limits; persistence/enable/restart/disable/corrupt preferences; desktop JSON scanning, oversize and symlink rejection.
- Final `tests/i18n.test.ts` passed: 2,843 matching catalog entries, placeholders, RTL/switching and existing screen scanner (pre-existing unrelated untranslated-content warnings remain).
- Browser integration exercised the actual file input, enable button, restart and invalid-file UI; then invoked actual host/client message handlers to prove mismatches stop before admission/start. No page exceptions. English, Arabic, error-state and gameplay PNGs inspected in `shots/modsupport-*.png` (not committed).
- Full `npm test`: **69 of 72 files passed; 3 failed (4 assertions)**. All three failing files were also run independently on an untouched temporary worktree and reproduced at untouched commit `ff7c1c3`: `firstten.test.ts` “the run ends on game over”; `lobbyCoop.test.ts` “game over on both”; `gauntlet.test.ts` Hard Omega unlock and selected-Ascension/history assertions. The first two expect gameover directly even though MVP is the shipped first post-run screen. These tests are outside this lane's ownership and are not rewritten here.
- `npm run smoke`: **passed**, every mode/hero, local/online-oriented systems, mortal run, MVP-to-gameover, history and menus; no runtime errors.
- `npm run coop -- --angle metal --modsupport --out shots/coop-modsupport`: **passed** (95.5 s, 1,552 snapshots, 2,010 B mean / 10,445 B max, none above 16 KiB). The passing run used `COOP_LOW=1` and native Metal. The opt-in fixture persists the example on both peers (survives invite reload), verifies matching SHA-256, custom drone parameters/tint/net state and enemy registry, then runs all normal co-op scenarios. The shared runner now continues through the existing MVP screen before asserting GAME OVER/PARTY; no assertions removed. The existing `COOP_LOW=1` initializer now merges the graphics value instead of overwriting settings on invite reload (the previous version lost the client pet and failed its pet assertion).

### Performance

Native Metal, HIGH, 1280×720, 15 seconds after 3 seconds warmup, existing heavy benchmark (seed 42, target 500 bullets). These are two workload captures, not a controlled microbenchmark: example drone parameters differ from shipped drones and the additional enemy enters normal director rolls.

| Metric | Vanilla heavy | Example enabled, custom drones |
| --- | ---: | ---: |
| Simulation / step | 0.82 ms | 0.84 ms |
| Game render | 0.88 ms | 0.91 ms |
| GL submission | 0.95 ms | 0.95 ms |
| Total CPU / frame | 2.66 ms | 2.69 ms |
| CPU p95 | 3.55 ms | 3.64 ms |
| Frame interval avg / p95 | 16.67 / 16.67 ms | 16.67 / 16.67 ms |
| Enemies avg / max | 308 / 347 | 297 / 358 |
| Bullets avg / max | 499 / 563 | 489 / 533 |

Reproduce vanilla: `npm run bench -- --gpu metal --seconds 15 --warmup 3 --dev`.
Active: same, plus `--link '?test&bench&modexample&seed=42&god&circle&aim=0.7,0.7&weapons=mint_drones:6,missiles:6,lightning:6,fire:6&stage=5&biome=meadow&night&rain&boom&swarm=200&hold=170,24:spinner,12:burster&bullets=500'`.

## Test links

- `?test&modexample&screen=contentmods`
- `?test&modexample&lang=ar&screen=contentmods`
- `?test&modexample&stage=2&weapons=mint_drones:5&spawn=mint_bopper:12&god`
- `?test&modexample&event=mint_rush&wevoff&god`

`modexample` is loaded before Game construction and never persists the fixture. Ordinary imports still require restart. On a busy overnight machine, `npm run shot ... --wait 4` sometimes captures the loading overlay; the inspected gameplay capture used `--wait 20`. Browser screenshots waited for boot/menu readiness and the stepped menu transition to finish. Two initial captures hit transient Chromium `ERR_NETWORK_CHANGED`; retries loaded successfully.

## Files and merge hooks

- New core: `src/mods/schema.ts`, `registry.ts`, `manager.ts`, `archive.ts`, `weapon.ts`; new UI `src/ui/modsScreen.ts`; author guide/example; `tests/modsupport.test.ts`; this handoff.
- Small content bridges: `src/data/weapons.ts`, `biomes.ts`, `stageEvents.ts`; `src/game/weapons/index.ts`, `base.ts`; `src/game/runEvents.ts`; `src/game/systems/render.ts`; `src/net/codec.ts`.
- Boot/UI: `src/main.ts` initializes packs **before Game construction**; `src/ui/screens.ts` registers/opens `contentmods`; additive strings in both i18n catalogs. CSS injected from the new screen, no style.css/settings.ts/game.ts/hero.ts edits.
- Online: `systems/netHost.ts`, `netClient.ts`, `online.ts`, `runFlow.ts`, `coop2.ts`, `pvpFlow.ts`; every `start` and `pvpgo` message includes `mods: modSession.hash`. Keep these fields when merging the PvP/co-op lanes.
- Desktop: new `electron/mods.cjs`, `electron/preload.cjs`; tiny `electron/main.cjs` registration/preload hooks. **Desktop lane also owns preload/main:** merge both bridges into its preload, preserving `window.infiniMods.list/openFolder`, and call `registerMods(app)` once before creating a window. Keep its existing context isolation/sandbox choices compatible with the narrow IPC bridge.
- Shared co-op script: additive `--modsupport` fixture/scenario and MVP continuation in party checks. PLAN decision log appended.

## Boundaries / remaining risks

- Schema v1 deliberately exposes supported templates, not every hard-coded game behaviour. Arm/projectile weapons, scripted rule relics, bosses/mini-bosses, new world-event geometry and custom asset packs need additional adapters. Unsupported requests fail with a clear validation error. Original icons/level text, combo/fusion recipes and script-specific identities remain inherited; arbitrary values are not automatically balance-tested. The guide states these boundaries.
- Content pack changes can affect normal progression/history; there is no separate modded save or competitive leaderboard policy in this lane. The hash is compatibility checking, not anti-cheat/authentication. It assumes peers use compatible game builds.
- Desktop scanner/bridge tested in Node and renderer/browser workflow tested, but packaged Windows/macOS binaries were not produced by this lane. Desktop packaging integration belongs with the desktop lane.
- The full unit gate is not green because of the three reproduced baseline failures above. No lane failures remain in targeted, build, smoke or passing co-op checks. Earlier high-quality co-op probes hit transient enemy-count comparisons; the final LOW-quality/native-Metal test passed all existing assertions, while HIGH-quality performance was checked separately.
- No push or merge performed.
