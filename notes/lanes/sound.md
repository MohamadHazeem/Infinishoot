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


---

# Sound lane, round 2 (2026-10-19): readable by ear

Seven additions, all synthesized with WebAudio on the existing engine (no new recordings, no dependencies, no new net messages or codec changes).

## Built

1. **Evolution sound layers** (`src/audio/evoLayers.ts`). All 42 evolutions have a layer: 20 loadout weapon evolutions, 10 special evolutions and 12 auto-weapon partner evolutions. Each picks one of 12 synth characters (fire crackle, shock zap, frost chime, blast thump, prism triad, mirror ring, void down-sweep, heavy thud, swarm buzz, radiant rise, cluster pops, thunder crack) plus a pitch, so the two forks of one item always differ. Weapons: `Game` sets `ctx.soundSource` to the weapon it is updating, and `ctx.sound(name)` sends `w:<cue>|<key>` (key `<item>.<evoId>` or `<weapon>.evo`; `weaponCue` / `evoSoundKey` in `systems/sound.ts`). Clients get the layer on the same effects-bus event as the base cue. Specials and the Bomb send `evo:<key>` next to their own cue (`specialEvoCue`). Unknown keys fall back to a sparkle.
2. **Off-screen threat telegraphs** (`src/audio/threats.ts`). Sniper lock-on (three rising beeps, then a held tone), mortar whistle (falling sine), charger wind-up and boss wind-ups (existing cues moved onto the band), Hop Frog crouch (rubbery rise), elite arrival (two-tone horn where the elite lands) and the Reaper toll (low bell that rings every 2.2 s at 40 m and every 0.6 s up close, panned, worked out locally on each machine). They play on a new reserved `threat` bus that goes straight into the limiter: no announcer duck, no hit-stop muffle. Its gain follows the EFFECTS volume. Priority 6 in the voice budget beats every effect (bosses and big moments are 4); only the announcer (10+) is higher. Distance fades bottom out at 0.55, so far telegraphs stay audible. Wind-ups go through `windupCue` (systems/sound.ts), which replaces the inline `onWindup` body in game.ts.
3. **Hero voice** (`voice.ts` composes, `heroVoice.ts` gates). Formant gibberish: each syllable is a consonant tick (plosive noise, hiss or hum) followed by a vowel sung through two formant band-passes that glide between vowels. Voices: Rookie 250 Hz, Bulwark 120 Hz (bigger tract, slower), Dash 330 Hz (fast, square), Ace 195 Hz. Heroes the content lane adds get a voice derived from a hash of their id. Co-op slots shift pitch x1 / 1.13 / 0.88 / 1.26. Barks: hurt (55%, 1.6 s cooldown), low life (under 25%, 18 s), level-up (85%, 5 s), evolution, revive, victory (stage clear), death, dash (22%, 4 s), parry (60%) and perfect dodge (60%). Each hero has its own cooldowns, can't bark while still talking unless the new bark outranks the old one, and routine barks keep 0.25 s apart across all heroes. Every moment is read on each machine from synced state (hp, dead, dashing, evolved count, team level, mode), so remote teammates speak with their own voice, panned and fading over 30 m. Parry and dodge come through `skillAudio`. New `voice` bus (ducked under the announcer like effects). Settings: HERO VOICE on/off and VOICE volume.
4. **Enemy family calls** (`families.ts`). Robot beep-boop, slime squelch, frog ribbit (formant), bug buzz, boss roar layer, ghost moan (Reaper). New optional `EnemyDef.voice`. When it's missing: boss or mini-boss gives boss, the Reaper gives ghost, the leaper and mortar models give frog, the swarmer, golden and hive models give bug, goo deaths give slime, everything else is robot. Calls play on wind-up (always tried) and on director spawns (30%; elites always). The host gates them before they reach the bus: one per family every 1.1 s and one of any family every 0.3 s. Big and elite enemies call lower. Priority 1 (just above swarm hits and deaths).
5. **UI sound kit** (`uiKit.ts`). move, hover (cards), confirm, back, toggle (rises for on, falls for off), slider tick (climbs the scale with the value), tab, card flip, error and purchase all come from one C-major pentatonic square/triangle palette on the menu bus. Wired once in `MenuNav`: focus moves (hover on `.card`/`.mod-card`, tab on `[role=tab]`/`[data-tab]`), clicks (toggle state read after the screen's own handler, error on disabled/locked) and `input` events on sliders (mouse and keys). It also goes through the shared sfx methods (`menuMove/menuSelect/menuBack/deny/buy/reroll`), so screens.ts needed no per-screen sound edits.
6. **Music.** (a) Authored leitmotif as note data (`ThemeNote = [step, degree, len]` in composition.ts): the hero theme on the title track (I to bVII to IV to v, mixolydian), the Omega theme (the same rhythm made dark in phrygian dominant: i to bII to i to bvii) and a victory fanfare that quotes the hero cell, then climbs to a long tonic. The procedural pad, bass, drums, arp and counter keep playing underneath. Theme chords replace the generated progression in verses and choruses, choruses add a third below on the counter layer, and bridges keep the procedural melody for contrast. (b) Style-rank layer: `music.setStyleRank(rank)` (fed every frame from the local hero's synced style meter) and a new `style` layer that changes on the next bar. B adds an off-beat shaker. A adds a harmony a third over the lead. S adds a snare fill every two bars and a high octave bell arp. SS adds a crash on each bar and a doubled bass.
7. **Accessibility** (`captions.ts` hub, `src/ui/audioA11y.ts` overlay). CAPTIONS: a pixel caption strip above the action bar with up to 3 lines, 2.8 s each and stepped fade. It shows announcer lines (text from scripts/audio/sounds.mjs, captioned even when muted) and voice lines ("ROOKIE Ouch!"; remote teammates' routine yelps aren't captioned). SOUND ARROWS: an arrow plus a framed label (SNIPER, MORTAR, CHARGE, BOSS, LEAP, ELITE, REAPER) for each off-screen telegraph. The arrows sit on an ellipse around the hero, which keeps them clear of the corner HUD panels, and use one sprite per threat type that refreshes. Both settings default to off. CSS is injected from the TS module, because the test bundler (rolldown) can't import .css.

## Knobs

`evoTuning`, `threatTuning`, `familyTuning`, `voiceTuning` (+ `HERO_VOICES`, `BARKS`), `uiKitTuning`, `styleLayerTuning`. Debug panel folder "Sound lane" (`src/ui/debugAudio.ts`, one call from debugPanel.ts) has gains and gaps, the caption and arrow switches, and auditions: any evolution layer, bark, family call or UI cue, all telegraphs in a row, and a test caption. It also has a live readout of the music style rank. Test link: `?test&captions&arrows&spawn=sniper:3,mortar:2&spawnr=26&hurt=1`.

## Verification

- `npm run typecheck`, `npm test` (17 files, incl. new `tests/soundlane.test.ts`, ~120 checks) and `npm run smoke` pass.
- Unit tests, against a recording WebAudio fake:
  - Evolutions: every one in WEAPONS and SPECIALS has a layer, sibling forks differ, and evolved cues add sources (rail 3 to 6). Real `createWeapon` objects produce the right cue strings.
  - Threat band: it routes to the master and not the duck, it's panned and keeps its loudness floor, telegraphs steal a swarm voice when the budget is full, and nodes disconnect when they end.
  - Voice: every hero and co-op slot has a distinct pitch, compose stays valid for all heroes and kinds (20 rolls each), level-up rises and death falls, and the gates work (cooldown, busy and priority, chance, global gap, VOICE off, CAPTIONS off). Barks use the voice bus and its volume.
  - Families: every enemy has one, the expected families come out, the override works, and the gate works.
  - UI kit: every cue sounds, and ticks climb.
  - Captions and arrows (jsdom): lines show, dedupe, cap at 3 and fade. Arrows appear only off-screen, expire, and respect the setting. The announcer captions its lines, also when muted.
  - Music: themes have no overlapping notes, land on chord tones on every beat, the victory quotes the hero cell, and Omega keeps its rhythm. The style layer schedules 0 / 103 / 334 events at D / B / SS over 24 s, and themed tracks play their leitmotif.
- Offline renders in headless Chromium (OfflineAudioContext, then spectrograms drawn to a PNG and inspected): Rookie level-up, Bulwark death and Dash hurt barks show separated syllables with formant bands. Sniper shows three beeps and a held tone, mortar a falling whistle, the Reaper a low bell. Dragon's Breath extends the Scattergun report with crackle. All renders were finite with peaks of 0.03 to 0.21 before bus volumes; after this the voice gain went to 0.8 and the sniper and mortar were raised. The render script was temporary and isn't committed.
- Screenshots (fonts fall back in this worktree because node_modules is a symlink outside Vite's allow list): `?test&captions&arrows&spawn=sniper:3,mortar:2&spawnr=26&hurt=1` shows "ROOKIE Oof!" / "ROOKIE Ouch!" above the action bar and SNIPER and MORTAR arrows on the ring around the hero. The settings screen shows the HERO VOICE, VOICE, CAPTIONS and SOUND ARROWS rows in the existing scrolling list.
- Not verified: no one listened to anything (no speakers), so loudness balance against the recorded samples and how "cute" the voices sound are untested. `npm run coop` (two-instance co-op) was not run; remote barks and evolution layers on clients rely on existing synced fields and the existing effects-bus path.

## Shared hot files touched

- `game.ts`: `makeCtx` keeps the ctx in a const, adds `soundSource`, and `sound` uses `weaponCue`. The weapon loop sets and clears `h.ctx.soundSource`. `onWindup` now calls `windupCue`, which holds the same logic plus the new cues.
- `vfx.ts`: `playSound` dispatches through `sfx.named` (same behaviour plus the `evo:` and `call:` prefixes) and reports threat cues to the arrow hub.
- `weapons/base.ts`: optional `WeaponCtx.soundSource`.
- `data/enemies.ts`: optional `voice` field.
- `systems/spawning.ts`: one `spawnCue` call.
- `systems/statuses.ts`: two `specialEvoCue` calls.
- `settings.ts`: `voice`, `voiceVolume`, `captions`, `soundArrows`.
- `screens.ts`: four settings rows and the ToggleKey union.
- `menu.ts`: kit wiring.
- `debugPanel.ts`: two lines.
- `dev/testLinks.ts`: `&captions` / `&arrows`.
- `skillAudio.ts`, `samples.ts` (`canPlay`), `announcer.ts` (captions) and `music*` are lane-owned.

## Unfinished / risky

- Balance is by numbers, not by ear. Formant barks at default gain peak near 0.16 and could feel loud next to the 0.5-gain samples, or cute vs. annoying. The knobs are in the debug panel.
- The threat band bypasses the duck by design, so a boss fight with many wind-ups plus snipers can stack up to 4 groups per telegraph name. It is still bounded by the shared 32-voice budget.
- The style rank and the theme only change at bar boundaries. A rank drop after a hit therefore lingers up to one bar.
- The SS crash and the doubled bass add up to ~3 extra music voices per step. Earlier peak measurements (28 of 96 voices) leave room, but this wasn't re-measured with the style layer at SS during a boss phase 3.
- The WORLD lane's new biomes get footsteps and ambience defaults from the existing maps (meadow fallback) and no family-call changes. The CONTENT lane's new enemies should set `voice` if the default family is wrong.
- Captions only cover the announcer and voice. Threat sounds are covered by the arrows, not by text.

## PLAN.md decision-log paragraph

- 2026-10-19: Sound lane, round 2 (readable by ear, notes/lanes/sound.md). All 42 evolutions add a synth layer (12 characters x pitch) to their base cue. Weapons tag their effects-bus cue as `w:<cue>|<item>.<evo>` via `WeaponCtx.soundSource`, so clients hear it with no protocol change. Off-screen threats (sniper lock-on, mortar whistle, charger and boss wind-ups, leap, elite arrival, a Reaper toll that speeds up from 2.2 s to 0.6 s as it closes in) play on a reserved `threat` bus that skips the announcer duck and the hit-stop muffle, at budget priority 6 (announcer 10+), never quieter than 0.55. Heroes speak in synthesized formant gibberish with per-hero voices (Rookie 250 Hz, Bulwark 120, Dash 330, Ace 195; co-op slots shifted x1.13/0.88/1.26), with rate-limited barks for hurt, low life, level-up, evolution, revive, victory, death, dash, parry and dodge, read from synced state on every machine. Enemy families (robot, slime, frog, bug, boss, ghost; optional `EnemyDef.voice`) call on wind-up and spawn, gated on the host to one per family per 1.1 s and one per 0.3 s overall. One pentatonic UI kit is wired through MenuNav. The title, Omega and victory have an authored leitmotif (victory quotes the hero cell, Omega darkens it) over the procedural layers. A style layer follows the style rank at bar boundaries (B shaker, A harmony, S fills and arp, SS crash and doubled bass). New settings: HERO VOICE, VOICE volume, CAPTIONS (announcer and voice lines) and SOUND ARROWS (labelled pointers on a ring around the hero for off-screen telegraphs); both accessibility switches are off by default.
