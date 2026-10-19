# MVP — run awards and band mode

## Players get

- Every completed solo/co-op run opens TEAM ENCORE / SOLO ENCORE before the existing run summary. Continue (or Back) leads to the existing retry/history/build-card screen. Training and PvP keep their existing flows; quitting to title does not open awards.
- A per-player table: actual source damage (the existing damage ledger, excluding overkill), attributed kills, assisted revives, saves, accepted HP damage, personal best combo, and gold contributed to other players' revive-pool buy-backs.
- Eight earned award categories: Heavy Hitter, Hoarder, Pacifist Moment, Glass Cannon, Bodyguard, Speed Demon, Most Dramatic Revive, Combo Conductor. Only positive qualifying performances earn awards; categories can share a winner. Deterministic ties favor the earlier run participant. Solo naturally earns fewer categories because no teammate rescues happen.
- Victorious pixel portraits, 32 brief confetti pieces, the existing `vo_mvp.mp3` through the announcer/voice gate, and a timestamped highlight reel (boss/miniboss finishes, clutch revives, legendary finds, fusions). A band line-up lists each participant's instrument families collected during the run.
- English and Arabic copy, safe isolated player names, keyboard/gamepad navigation, scrolling for eight-player/large UI-scale layouts. Existing screen scaling applies automatically. Reduced motion/flash removes confetti; existing announcer, interactive music, music/master volumes and mute settings control audio.
- Nearby teammates' weapon stems join the local song. Each weapon retains its authored patch, rhythm, evolution flourish and rank intensity. Teammates pan spatially and fade with distance. Downed/departed teammates stop playing; a downed listener can still hear living teammates.

## Rules and tuning

`mvpTuning` and `bandTuning` are exposed under debug **MVP & band**.

- Personal combo: 2 s between this player's kills; accepted damage resets that player's chain. Team combo/scoring is unchanged.
- Save: kill an enemy in windup/attack within 3 m + enemy radius of a downed teammate. At most one save per kill. Downed heroes do not take damage in this game's rules: this measures protection of their rescue space, not an imaginary prevented HP hit. The table explains this.
- Revives: every actual proximity helper receives credit. Free stage revives, pets, Second Wind and buy-backs do not masquerade as helper revives. Clutch = last standing rescuer or rescuer at <=25% HP; helpers are checked before revival/healing.
- Shared gold: actual coins paid from a hero's wallet toward another hero's shared-pool revival. Self buy-back contributions do not count. This does not change the economy or add automatic gold sharing.
- Hoarder uses gold held at run end; Speed Demon uses dashes; Pacifist Moment uses longest interval without a personal kill (can include downed time); Glass Cannon uses damage / max(1, HP lost).
- Inventory scan: once every 15 fixed updates (4 Hz), plus finalization. Each legendary/fused item ID is highlighted once per participant. Max 32 highlights; older loot yields to boss finishes and clutch rescues. Counters are event-driven and the scan allocates only when discovering new content/participants.
- Band: full volume within 10 m, linear fade to silence at 28 m. At most 8 preallocated stem slots and 8 nearby players, fair round-robin (one slot each before extra weapons). Larger loadouts rotate through their instrument parts each musical bar. No duplicate-weapon collapsing across players. Existing music synthesis remains capped at 96 voices; the eight-player stress test peaks at 80, with zero drops.
- No save-format changes, runtime dependencies, recordings, external audio calls, or permanent player statistics.

## Integration / files

- New `src/game/systems/mvp.ts`: authoritative counters, awards, bounded moments, final report, UI entry point and deterministic visual fixture. New `src/ui/mvpScreen.ts`: registered screen and injected lane CSS. New `tests/mvp.test.ts`: rules, authority, reset/rejoin, rendering, actual final-message/snapshot round trips, bounded mixing and full synth voice-budget tests.
- Small additive Game bindings/update hook; `systems/statuses.ts` kill/hurt hooks; `systems/coop.ts` helper-revive hook; `systems/coop2.ts` one buy-back contribution hook; `systems/runFlow.ts` reset/finalize/show hooks.
- `RunSummary.mvp` accompanies the reliable `over` message. The host computes the report once before sending anyone's summary. Snapshot field `mvp` also mirrors the immutable final report (generic delta codec, no codec edits). The reliable message opens the screen, after banking exactly once; repeated same-run messages cannot bank twice. Clients never compute awards. Client start clears the previous report.
- `src/audio/stems.ts`: fixed BandMixer plus optional per-stem gain/pan. `systems/audiomix.ts`: local cosmetic mix from existing mirrored hero positions/builds. `announcer.ts` / `captions.ts`: enable the existing MVP recording at results priority, with its recorded caption.
- `src/ui/screens.ts`: only the extra-screen ID and optional summary field; `debugPanel.ts`: a small tuning folder; `dev/testLinks.ts`: a small `mvp` fixture hook.
- Both locale catalogs: MVP copy plus missing existing weapons3/Mods2 names, descriptions and evolutions discovered by the mandatory content tests. Numeric Mod descriptions use interpolation templates for every rank. No gameplay data was changed to fix those baseline catalog gaps.
- `tests/onboarding.test.ts` and `tests/smoke.test.ts`: check the deliberate MVP -> summary navigation before existing summary assertions. `tests/time.test.ts` / `timeCoop.test.ts`: replay completion, skip and replay-disabled paths now reach awards on solo and both peers. `tests/i18n.test.ts`: includes the new screen in the DOM-write/key scanner.
- `scripts/coop-test.mjs`: capture team meter spending immediately after successful activation, before normal proximity recharge during its network wait. Still requires zero at activation and matching host/client move IDs. The former delayed exact-zero assertion failed with a correctly replicated beam and 0.0229 legitimately recharged meter. No game rules or scenario coverage were weakened.

The lane decision log is here instead of changing shared PLAN.md, following the lane ownership restriction.

## Test links / visual checks

- `?test&mvp=4` — all eight award categories, four-player table, highlights and band line-up.
- `?test&mvp=1` — solo awards; `?test&mvp=8&lang=ar&calm` — Arabic, eight participants, reduced motion.
- `?test&die=2` — real solo end-of-run path after death replay (allow about 10 s).
- Existing co-op games automatically use nearby weapon stems when INTERACTIVE MUSIC is enabled. No new setting is necessary.
- Required `npm run shot -- '?test&mvp=4' shots/mvp-final.png --wait 4` passed. A temporary `SHOT_CHROME` wrapper selects Metal instead of SwiftShader; no screenshot runner code was changed.
- Fixture links do not bank runs. The ordinary Continue button still opens a populated standard summary.
- Inspected English team and solo PNGs, Arabic eight-player top/bottom PNGs, and a 640x480 view; no horizontal page overflow. At 1280x720, the four-player Continue button ends at y=686 and is fully visible. Large Arabic/eight-player results intentionally scroll vertically; Continue remains keyboard/gamepad accessible. Screenshots and benchmark JSON are ignored artifacts in `shots/mvp-*`.

## Validation

- PASS: typecheck and production Vite build (existing large-chunk advisory only).
- PASS: targeted MVP integration/audio tests and all catalog/content/scanner checks.
- PASS: browser co-op with `COOP_LOAD_TIMEOUT=120000 COOP_TIMEOUT_MS=120000 COOP_LOW=1 npm run coop -- --angle metal --size 480x270`; jump pad, turret, pet growth, pillar, fusion, team move, boss intro/finisher, ping, parry, revive and route vote all exercised. The final source run passed with 1,548 snapshots, maximum 12,421 bytes, and no lasting desync or page errors.
- PASS: `npm run smoke` across all seven hero/mode cases, training, rhythm/Pacifist/minigames/ghost race, Versus, three-player local co-op, and mortal run -> MVP -> summary/history; zero runtime errors.
- PASS: full `npm test` — all 63 test files. Legacy result-screen expectations were updated to the new MVP entry point. The unchanged bridge fixture also passed on the final rerun (intermittent earlier failure recorded below).
- `npm run bench -- --gpu metal --seconds 12`: 723 frames, 60.3 fps, 266 average enemies / 508 projectiles; 0.70 ms per simulation step, 0.83 ms game render, 0.92 ms GL submission, 2.46 ms total CPU/frame (p95 3.31 ms). This is the existing high-quality heavy scene on this machine, not a guarantee for all hardware.
- The required default SwiftShader benchmark also ran, but competing overnight renderers left only 5 sampled frames; its 1.02 ms/sim-step result is not a useful total-frame comparison. Native GPU was used for reliable visual/co-op/performance validation.

## Remaining limits

- The unchanged `worldEventsGame` bridge-collision fixture failed once during repeated full-suite runs, after passing in both preceding runs. Its run setup is unseeded; the precise cause was not captured. No world-generation code or assertion was changed in this lane.
- Eight-player audio is exercised in unit/synth stress tests; the browser harness uses two peers, and the existing online lobby still caps normal sessions at four. This lane does not change lobby capacity.
- A reconnect reclaiming the same Hero preserves totals across ledger reconstruction. A fully replaced roster slot gets a separate participant entry rather than inheriting someone else's stats; a returning player whose old slot has already been replaced may consequently have separate participation entries.
- Inventory highlights are sampled at 4 Hz. An item acquired and removed inside one sampling interval can be absent from the reel. Boss/kill/hurt/revive/shared-gold counters use direct authoritative hooks.
- Audio validation covers synthesis scheduling, routing and budget; no subjective headphone listening review was performed.
