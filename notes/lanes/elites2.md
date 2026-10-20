# elites2 — Elite modifiers and champions

## Players get

Six weighted modifiers join the existing six. Elites retain their coloured body glow, ground ring and arrival toast. Champions roll two distinct modifiers from stage 3, show a gold name plus both modifier names above their health bar, and drop a chest granting two reward picks and 12 gold. The new modifiers and champions have English/Arabic Enemy Guide and discoverable Codex entries.

| Modifier | Default tuning / counterplay |
| --- | --- |
| Gravity | 6 m field; hero pull capped at 1.1 m/s even with overlapping wells; bullet acceleration 3 m/s². Dashes escape. Violet inward ring. Weight 0.8. |
| Summoner | Two ordinary Swarmers every 6 s, using normal stage scaling/spawn telegraphs; skips blocked/out-of-bounds positions; stops at 560 enemies. Green pulse. Weight 0.8. |
| Mirrored | Every fourth colliding player projectile becomes an enemy projectile. Damage ×0.35, capped at 12; speed capped at 14 m/s, remaining life at 2 s. Strips blast/homing/pierce/bounce, turns pink. Beams/areas bypass reflection. HP ×0.85; weight 0.7. |
| Phasing | Four seconds visible, one second absent. Cannot attack, be targeted, deal contact damage or receive damage while absent; even fixed/Nuke damage is blocked. Phase clock advances through freeze. HP ×0.85; weight 0.7. |
| Berserk | Missing-life fraction adds up to 65% speed and 50% damage, without frame compounding; healing reverses the bonus. Weight 1. |
| Frostbite | A 1.15 m patch every 0.65 s, lasting 3 s. Movement slows 35%; no damage, stacking or dash penalty. 64 reusable patch slots. Weight 0.8. |

Champion chance is 12% **per elite**, starting at stage 3. Additional HP multiplier is 1.25, then both modifiers' authored HP/speed multipliers apply. Existing split/stationary exclusions apply to both rolls. Old modifiers work in either slot, including shield, regen, blinking, death splits/explosions and fast trails. Forced single-mod test/debug spawns remain single; `champion=` explicitly requests a pair.

All knobs are in `elites2Tuning` in `src/data/eliteMods.ts`, exposed under **Elites / Champions** in the debug panel. Existing `spawn`, `portal` and `parry` audio is reused. No dependencies, new audio assets, settings or save-format changes. Title-demo discovery honors `saveLock`.

## Co-op / integration

- Host-only modifier clocks, summons, bullet bending/reflection, rewards and rage. Client movement prediction reads host enemy positions and the authoritative frost field, matching host gravity/slow logic without client spawning or damage.
- Enemy records stay **28 bytes**. Byte 21 is unchanged: primary modifier bits 0–3, squad bits 4–6, shield bit 7.
- Byte 22 now uses **bits 0–2 for family state** (existing values 0–4), **bits 3–6 for secondary modifier**, and **bit 7 for phase immunity**. Both modifier slots allow at most 15 IDs; there are 12. The old test incorrectly allowed 127 and now checks 15. Future enemy-family states must fit three bits. Host/client builds must match.
- Dedicated `el2` snapshot field carries at most 64 `[id, x, z, remainingSeconds]` frost records. Snapshot-derived trail visuals go through Vfx locally, without duplicate effects-bus playback; other cues use the ordinary effects bus. Late joiners get existing trails.
- Champion chest pickup value **2** is reserved below `OWNED_CHEST = 100`; normal chests remain 1. Existing pickup codec and hero reward flow handle it.
- Rewind records/restores secondary identity, phase/cooldown/reflection/rage state and the fixed frost pool. Pooled enemy reset clears every new field. Ordinary transient cosmetic effects retain the existing rewind limitations; gameplay state restores.
- World-anchored gold tags use the existing elite-bar projection/pool and injected lane CSS. No new screen or global stylesheet rules.

## Files

- Main lane: `src/data/eliteMods.ts`, `src/game/systems/elites2.ts`, `tests/elites2.test.ts`.
- Enemy state/codec/rewind: `src/game/enemies.ts`, `src/net/codec.ts`, `tests/netCodec.test.ts`, `src/game/timeline.ts`.
- Small hooks: `src/game/game.ts`, `systems/spawning.ts`, `systems/combat.ts`, `systems/statuses.ts`, `systems/render.ts`, `systems/netHost.ts`, `systems/netClient.ts`.
- Guide/UI/QA: `src/data/codex.ts`, `src/ui/hud.ts`, `src/ui/screens.ts`, `src/ui/debugPanel.ts`, `src/dev/testLinks.ts`.
- Translation: new `src/i18n/elites2.ts` plus catalog imports/spreads in `en.ts`/`ar.ts`.
- This note and one appended PLAN decision-log entry.

## Validation

- Typecheck and Vite production build pass.
- Targeted elites2 test passes: authored roll weights, stage/champion gate, all 132 distinct modifier pairs through raw and delta snapshots, legacy bit coexistence, phase damage/freeze recovery, reflection caps, pull/stack caps, summoning/cap, rage/healing, frost/dash/expiry, pool reuse, old modifier combinations, rewind, chest contents, Arabic copy, title-demo save lock, real host `buildSnapshot` → client `applySnapshot`, client authority guard and bot encounters.
- Smoke: both full runs pass all modes/heroes, local co-op and mortal game-over with no runtime errors, including the final run after the save-lock/parry fixes.
- Full unit suite: 99 of 104 test files pass. Five inherited failures reproduce on the untouched baseline; details below. The real title-demo save test passes after the lane regression fix. Browser co-op passes with local signalling; details below.

### Bot balance

Fixed seed 42, normal difficulty, stage-3-scaled Bopper elites, Buster/Charge plus rank-3 Drones and Zap Field. Real Autopilot, isolated encounters, no director waves; god mode prevents deaths. Seconds to kill:

| Shielded | Fast | Gravity | Summoner | Mirrored | Phasing | Berserk | Frostbite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 14.5 | 4.5 | 8.8 | 11.7 | 16.4 | 15.5 | 6.0 | 6.3 |

These are reproducible ordered encounter checks, not a statistical claim about all kits or champion combinations. Mirrored/Phasing HP reduction keeps their extra defenses close to Shielded kill times.

### Performance

`npm run bench`, native Metal, LOW quality, 960×540, four evolved auto weapons, ~200 enemies and 500 bullets, 10-second sample after four-second warm-up:

| Scene | CPU/frame | Simulation/step | Frames | Enemies / bullets |
| --- | --- | --- | --- | --- |
| Control, no forced elites | 2.04 ms | 0.64 ms | 613 (~60 fps) | 188 / 494 average; 250 / 501 max |
| All six new modifiers | 2.06 ms | 0.65 ms | 613 (~60 fps) | 194 / 500 average; 228 / 514 max |

The hot modifier/ground paths reuse enemy fields and the fixed patch pool. Effects allocate only on pulses/spawns; snapshot arrays are made at network cadence. A separate SwiftShader run had 214 enemies/499 bullets and 0.56 ms simulation/step (control 0.64 ms), but only 2.8–3.4 rendered fps under shared software-GPU load; those GPU timings are not a 60 fps qualification.

## Test links and visual QA

- `?test&god&stage=3&elite=bopper:gravity,shooter:summoner,charger:mirrored&elitenear`
- `?test&god&stage=3&elite=bopper:phasing,charger:berserk,chonk:frostbite&elitenear`
- `?test&god&seed=42&stage=3&biome=meadow&champion=bopper:gravity+frostbite&elitenear&lang=en`
- `?test&god&seed=42&stage=3&biome=meadow&champion=bopper:mirrored+berserk&elite=shooter:phasing&elitenear&lang=ar`
- `?test&codexall&metascreen=codex&lang=en` (also `lang=ar`); Enemy Guide is `screen=bestiary`.
- `elitenear` places forced elites close to the hero for inspection; URL `+` and `%2B` both work for champion pairs.

Captured with `npm run shot` and inspected: `shots/elites2-champion-en.png`, `shots/elites2-champion-ar.png`, `shots/elites2-codex-en.png`, `shots/elites2-codex-ar.png`. Gold labels, both names, cyan trails, Arabic joining/wrapping and the seven new codex cards are readable. Under heavy browser contention a fixed four-second wait sometimes captures the boot overlay; final captures waited for boot completion and the appropriate screen/run state. PNGs and benchmark JSON stay ignored.

## Remaining integration gates

- **Co-op passes:** `npm run coop -- --offline --size 480x270 --out shots/elites2-coop-final`. Real host/client WebRTC with the local test broker and simulated latency/jitter/loss; 2,228 snapshots, average 1,591 bytes, maximum 6,855 bytes, none above PeerJS's 16 KB chunk threshold. Lobby/party, spectator, effects and state checks passed. The earlier default-size/public-broker run failed Ronin sword damage and boss-intro timing checks; the untouched baseline also failed a ping-portrait timing check. No test assertions, game timing or network settings were weakened.
- **Inherited unit gates:** the following failures reproduce in an untouched export of starting commit `d82dd58dd59bd23a476978abf3b90d8399ba90dc`, with the same assertions: `eightp.test.ts` (null client `lastHeard`), `followups.test.ts` (shield test expects two bullets, implementation reflects and keeps four), `i18n.test.ts` (the existing shield description's “bouncing them back” addition has no matching Arabic catalog text), `raceCoop.test.ts` (old four-player cap assertions), and `spectateCoop.test.ts` (four-player lobby assumptions against eight-player co-op). Baseline browser setup only adjusted Vite's temporary cache/asset-serving configuration for symlinked dependencies; baseline gameplay was untouched.
- The first full run also found a real lane regression: title attract-mode elite discovery bypassed `saveLock`. Fixed in `discoverElite`, with a direct regression test; the full repeat verifies the real title-demo test too. An early bot-fixture call omitted the stage argument; that fixture was corrected before the final balance results above.
- No lane gameplay is intentionally unfinished. Global failures in other builders' systems remain explicit integration gates. New family states above 7 or a 16th modifier require a codec layout change. All-champion/elite-heat extremes share the 64-patch frost budget; the oldest patch is replaced when full. Wide-area internet play and all kit/champion combinations remain outside the measured balance sample.
