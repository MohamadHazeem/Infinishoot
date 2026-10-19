# Audiomix lane

## Player-facing changes

- Every one of the 22 weapons contributes an instrument to the local player's current area/boss song. Drones arpeggiate, lightning adds clipped stabs, fire adds gritty bass, missiles add filtered brass-like hits, discs pluck, and lasers sweep a pad. The other clicks/autos have their own rhythm/register. Ranks raise volume and fill the rhythm; evolutions add an upper-register turnaround flourish.
- Music and ambience briefly dip for boss windups/phase changes, bombs, the local ultimate and the final boss explosion sequence, then return sharply. Effects and UI remain readable.
- Below 25% HP, the local player's music/effects progressively muffle and a heartbeat accelerates with danger. Large local hits add a faint short ring. Healing, menus, death and disabling the option release the effect. Hit-stop does not hide damage from the health tracker.
- Optional **HEADPHONES 3D AUDIO** uses actual HRTF panners for both sample and synth layers. The listener follows the local hero and their aim; sounds behind the hero are gently filtered. Default remains the existing stereo positioning.
- Four persisted toggles: weapon music layers, dramatic music dips and low-health audio default on; headphones 3D defaults off. Existing master/music/effects/ambience volume controls continue to apply.

## Tuning and integration decisions

- Stems snapshot the build only on scheduled bar boundaries, using the song's current scale, chord, stage transpose, section lift and boss-phase key. No composition-data edits, so biome additions can merge independently. No stems in title/shop/jukebox/stingers.
- Eight fixed stem routing slots cover the six legal equipped weapons with spare capacity. Intensity rises from 0.4 at rank 1 to 1 at rank 10, then caps. Base gain 0.032, normalized by sqrt(weapon count / 2); extra rhythm appears at intensity 0.6. One evolution flourish per instrument every second bar. All notes share the existing 96-voice music budget. Full Omega final chorus + eight evolved stems peaked at 47 voices, zero drops.
- `music.silence(seconds)` is the public hook for other lanes. It caps duration at 0.6 s and snaps re-entry to a beat when within 80 ms and the result stays between 0.3–0.6 s. Invalid nonfinite requests are ignored; zero restores the beds. Built-in windup/phase/bomb/ultimate/finisher durations are 0.4/0.5/0.35/0.4/0.51 s. Bed gain drops to 0.035 with 18 ms edges; a 650 ms retrigger guard prevents repeated cues from holding the mix down.
- Windups and the final three boss explosions provide anticipation. Instant bomb/ultimate inputs have no pre-activation window: their dip begins at activation, without delaying authoritative gameplay or impact effects. The final boss cue is a string on the existing VFX stream, so clients receive it without codec changes.
- Health pressure runs from 0 at 25% HP toward 1 near death. Logarithmic low-pass 20 kHz → 1.8 kHz; attack time constant 120 ms, healthy release 300 ms. Heartbeat period 1.05 → 0.45 s. Ring threshold is a hit of at least 18% max HP, 3 s cooldown, 650 ms decay, gain 0.018, frequency 3.1 → 2.6 kHz. It shares the effects voice budget and volume. A separate filter avoids fighting the existing hit-stop muffle automation; UI bypasses both.
- At most 12 simultaneous HRTF routing nodes, within the existing combined 32 sample/synth cue budget. Overflow uses stereo and retains rear filtering. Rear cutoff reaches 4.2 kHz; listener position/orientation smooth over 25 ms. Existing distance attenuation is retained, with PannerNode rolloff disabled to avoid double attenuation. Nonpositional/UI sounds remain centered. Existing sound tails finish in their original routing when the setting changes.
- Local cosmetic state lives in new `systems/audiomix.ts`; no new host state or snapshot fields. Existing mirrored weapon builds and HP suffice for clients. Steady frame work allocates no new JS objects; graph allocation happens at song/cue/note boundaries under existing budgets.
- No runtime dependencies, audio downloads, generated assets, or composition edits. This handoff also serves as the lane decision log instead of editing shared PLAN.md.

## Files touched

- Owned audio: `src/audio/music.ts`, `mix.ts`, `sfx.ts`; new `stems.ts`, `lowHealth.ts`, `spatial.ts`.
- New local system: `src/game/systems/audiomix.ts`; small replacement of the existing heartbeat block in `systems/render.ts`.
- Additive hooks: one line each in `systems/skill.ts` (local ultimate) and `systems/combat.ts` (final boss sequence).
- Settings/UI: small additions in `src/game/settings.ts` and `src/ui/screens.ts`.
- Necessary audio plumbing outside the main owned list: `src/audio/samples.ts` routes recorded layers through the same bounded spatial helper; `src/audio/ambienceAudio.ts` changes its output to the dedicated ambience bed; `src/game/vfx.ts` passes existing world coordinates to `sfx.at`. These are narrow changes, with no event/protocol changes.
- `tests/audiomix.test.ts`; this handoff.

## Verification

- `npm run typecheck`, `npm test` (17 files), and `npm run smoke` pass.
- New tests cover all weapon mappings, rank/evolution behavior, bar-latched builds, scale/key conformity, music voice load, health/healing/reset thresholds, front/back placement, HRTF cap/fallback and idempotent lease cleanup, recorded+synth spatial parity, silence automation/toggle/overlap, and filter release.
- Real Chromium WebAudio: unlocked all six equipped layers, measured critical-health cutoff (~4.72 kHz at 10% HP), healed back to ~19.8 kHz after 1.3 s, and verified both bed gains return to 1. All 22 isolated instruments produced finite, nonzero stereo OfflineAudioContext output. Headphones toggle changes live state and persists through reload. No page errors. This is technical waveform/runtime validation, not a subjective headphone listening review.
- Production heavy benchmark (200+ enemies, 500 bullets, high quality): before/after render CPU 0.61/0.68 ms average, estimated CPU at one simulation step per frame 1.42/1.55 ms, allocation ~10.0/9.9 MB/s. SwiftShader is GPU-bound, so its 9–11 fps is not a hardware-GPU framerate claim.
- Additional temporary benchmark with real audio unlocked, HRTF enabled and HP at 10%: render CPU 0.85 ms, one-step CPU 1.81 ms; music peak 28, no drops, effects 29/32 at capture; no browser errors. This used the dev server, so it is supplementary rather than a production before/after comparison.
- Captured and inspected `shots/audiomix-stage2.png`, `shots/audiomix-menu.png`, and `shots/audiomix-headphones.png`. The four toggles fit the existing scrolling settings layout. Screenshots remain uncommitted.
- The unrelated randomized `arenaCoop.test.ts` collider-count assertion failed on early suite runs and also reproduced on an untouched HEAD archive (1 of 35 isolated baseline runs). The complete final suite passes; no arena files were changed.
- `npm run coop` full repeat passed (~93 s), including boss phases, local/client ultimates, down/revive and effect replay: 1,424 snapshots, average 4,883 bytes; all four ultimate events arrived. The first run reached title before its scripted revive and failed on a missing hero; the unchanged baseline and the final branch repeat both passed. No co-op/gameplay logic was changed to work around the harness.

## Test links / remaining risks

No new link options. Useful existing links:

- `?test&stage=2&god&weapons=drones:6,lightning:6,fire:6,missiles:6`
- `?test&stage=2&god&screen=settings`
- `?test&stage=4&bossnow&phase=3&god&nointro`
- `?test&hero=bulwark&ultgo=2&god`

Audio still needs the normal pointer/key gesture to unlock. HRTF perception varies by headphone/listener; it is opt-in. New audio state intentionally follows this machine's hero, not teammates. No known unfinished feature work.
