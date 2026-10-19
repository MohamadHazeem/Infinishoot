# Sound lane — 2026-10-19

Built recorded sample layers over the existing arcade synth, with distinct reports for previously shared weapon cues, heavier elite deaths and boss slams/phases, biome footsteps, nearby projectile whooshes, biome ambience/reverb, and a restrained announcer. Added AMBIENCE volume and ANNOUNCER ON/OFF settings (default on). No dependencies or audio assets added; `src/audio/music.ts` is untouched.

## Decisions and tuning

- First pointer/key gesture unlocks WebAudio and starts optional manifest/MP3 loading. Three background workers decode the 71 existing clips; voice clips load first. Paths use Vite's `BASE_URL`. Missing, offline, malformed or undecodable assets leave effects on their existing synth fallback; unavailable ambience/voice stays silent. No gameplay awaits audio.
- Shared budget: 32 transient entries across sample voices and synth cue groups. A synth group can contain several oscillators/noise sources; the budget counts groups, not individual oscillators. Normal low-priority cues allow two concurrent groups; important synth cues allow four, samples usually three. Important cues steal lower-priority entries, and all transient nodes disconnect on completion. Hum and the bounded five ambience beds are separate persistent sources.
- Sample gain 0.5, synth layer 0.42 when a sample plays; full synth when it does not. Sample pitch varies ±7%, volume by up to 7%. Footsteps use gain 0.1 and ±12% variation. Announcer pitch is fixed, gain 0.85, routed through the UI bus; Effects volume controls ambience as well as its own slider.
- Swarm hit/death spacing grows from 70 ms to 240 ms at 150 enemies. Frequent drone/flame/laser/aura cues have a 180 ms floor; drone events are also capped before host broadcast. Distant weapon cues have lower priority than nearby player weapons.
- Existing VFX position pan/attenuation is preserved; far sounds additionally low-pass from 20 kHz down toward 2.8 kHz. Master compressor: −12 dB threshold, 12:1 ratio, 3 ms attack, 180 ms release. Announcer ducks effects to 40%; bomb/slam moments to 70%. Release is 350 ms; disabling/interruption updates ducking immediately.
- Biome beds crossfade over 1.6 s. Default ambience volume is 0.45 with a 0.3 internal gain; pause/menus further reduce it to 30%. Generated stereo reverb sends: meadow 0.22 s / 7%, dunes 0.12 s / 2.5%, peaks 1.5 s / 13%, magma 0.85 s / 11% with darker filtering. Impulses are cached per biome.
- Local movement plays a recorded pair of footsteps every 3.2 traveled speed-units, without steps during dash, death or pause. Meadow/grass, dunes/sand, peaks/snow, magma/metal; moving conveyors also use metal. Near-pass checks visit at most 32 projectile slots per frame, only width >=0.7 or radius >=0.34, approaching within 3 m and moving over 8 m/s; at most one whoosh every 0.4 s.
- Announcer: run start, boss/elite spawn, legendary pick, evolution, occasional level-up, stage clear, game over, and combo 50/100/150 (great/awesome/unstoppable). Higher priorities interrupt lower ones; no stale announcement queue. 2.5 s spacing after a line, 45 s level-up cooldown, 18 s elite cooldown, 30 s combo-line cooldown, 8 s for other repeated lines.

## Integration for other lanes

- Weather/graphics: `import { ambience } from '../../audio/ambienceAudio'` (adjust relative path), then `ambience.setRain(0..1)` locally on each machine. Existing code has no rain state to consume; the graphics lane supplies intensity and resets it to zero when rain ends.
- Announcer: `announcer.say('parry')` or `announcer.say('vo_parry')`; also supports `perfect`, `rank_s`, `rank_a`, `ultimate`, `overdrive`, and all other recorded voice ids. It respects the persisted toggle and UI/master volume.
- Additional VFX-callable cues ready for other lanes: `parry`, `perfectDash`, `jumpPad`, `coverBreak`, `goldenLaugh`, `bossPhase`, `bossSlam`, `eliteDie`, `hitMetal`. For shared gameplay events use `game.vfx.sound(name, x, z)` so clients replay them.
- Existing weapon/reward/boss sounds still travel over the VFX bus with no codec changes. Ambience, movement, passing projectiles and state-based announcements derive locally from state already available on clients.

## Validation

- `npm run typecheck`, `npm test` (all five files, including new `tests/sound.test.ts`), `npm run smoke` (all modes/heroes and mortal game-over) passed. `npm run build` passed with the existing large-bundle warning.
- Real Chromium check: no pack request before a gesture; all 71 clips decode after unlock. Client-style `vfx.apply` produces audio. A sustained multi-weapon stress test reaches but never exceeds 32 budget entries, then releases all transient entries. Peaks/rain crossfade to magma alone. The announcer toggle persists. Blocking the manifest/MP3 requests leaves audible synth output. Browser checks used actual WebAudio waveform measurements, not a subjective speaker audition; a live two-peer session was not run.
- Screenshot command: `npm run shot -- "?test&stage=2&weapons=drones:5" shots/sound-stage2.png --wait 4`. Inspected it and `shots/sound-settings.png`; new controls fit the existing scrolling menu. Screenshots are intentionally ignored, not committed.
- No new test-link options. Existing biome stage links, weapon loadouts, `boss`, `elite`, and `god` suffice.

## Files touched

- Audio: `src/audio/{sfx,samples,mix,announcer,ambienceAudio}.ts`.
- Local system: `src/game/systems/sound.ts`; two-line hook in `systems/render.ts`.
- Settings: `src/game/settings.ts`, `src/ui/screens.ts`.
- Small cue hooks: `src/game/game.ts`, `src/game/specials.ts`, `src/game/systems/{combat,statuses}.ts`.
- Small weapon hooks/type extension: `src/game/weapons/{aura,base,bouncer,drones,fire,laser,nova,orb,pellets,scatter,starfall,sweeper}.ts`.
- Tests: `tests/sound.test.ts`. Handoff/decision log: this file (kept out of shared PLAN.md to respect lane ownership).
