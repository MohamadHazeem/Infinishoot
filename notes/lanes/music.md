# Music lane

Built structured, adaptive synth songs instead of repeating four-bar loops. Each area has lead, counter-melody, arpeggio, filtered detuned pad, bass, and varied drums. New patches include FM bells, filter-envelope plucks and detuned saws; drums use noise hats, noise-plus-tone snares and a pitch-envelope kick. Layer panning adds subtle stereo width, and kicks duck the pad.

Added separate King Bopper, Rampage Rex, Hive Queen and Omega themes, a shop tune, and one-shot victory/game-over stingers. The jukebox now has twelve entries, progression-based unlock metadata, and a responsive two-column desktop layout with keyboard/gamepad navigation.

## Tuning and decisions

- Form: 4-bar intro, then 8 verse / 8 chorus / 8 verse / 8 chorus / 4 bridge / 8 final chorus / 4 turnaround; subsequent cycles omit the intro. Fills end each four-bar phrase.
- Arrangement decisions happen every four bars. Intensity below 0.30 keeps ordinary choruses calm; intensity at least 0.72 brings a chorus into the second half of a verse. Bridge, final lift and turnaround remain authored landmarks.
- Area BPM/mode: Meadow 128 major; Dunes 112 Phrygian dominant; Frost 120 Lydian; Magma 140 Dorian. Boss BPM: King 152, Rex 160, Queen 146, Omega 168. Shop 96; title 104.
- Stage transposition: +2 semitones per stage, wrapping every six stages to preserve register. Final chorus adds +2. Boss phases add +2/+4 and counterpoint/arpeggio layers on the next bar. HP thresholds come from existing `bossTuning` / `omegaTuning`, including debug changes.
- Track changes start on the outgoing bar boundary, with 650 ms fades. Stingers last two bars; victory then follows the latest requested scene (normally shop), game-over ends in silence. A level-up interrupting stage-clear cannot replay its sting.
- Scheduling: 150 ms lookahead, 96 voice slots (at most two oscillators per voice), one noise buffer, at most two retiring track graphs. No per-note JS objects/closures. Retiring songs stop scheduling immediately, expire at a fixed deadline, and disconnect. Tests/offline renders peaked at 28 voices with zero drops.
- Pad duck reaches 0.38 and recovers within 180 ms. Existing music/master volume and mute control everything. Pause/level-up still muffle and duck; the dedicated shop arrangement plays at its normal gentle mix.
- Boss selection and phase/cues are local presentation derived from already-synced stage, mode and boss HP. No net protocol or authoritative gameplay changes. Peer audio clocks are intentionally independent.
- The lane decision log is here instead of editing shared PLAN.md, per the task's file-ownership restriction.

## API for the beat-bonus lane

Import `music` from `src/audio/music.ts`.

- `music.beatPhase()` returns the audio-clock beat position in [0, 1), or 0 without an active clock.
- `music.onBeatWindow(ms)` checks within **±ms** of a beat. Returns false before audio unlock, during suspension, after stop, or after the ending expires. It does not change scoring or play sounds.
- `pulse`, `beats`, and `beatTimes` remain available. `beatTimes` contains scheduled future beats; entries are recycled, so do not retain them. `beats` counts audible beats, not lookahead scheduling.
- `music.setBossPhase(1 | 2 | 3)` queues the musical escalation at a bar. Legacy `MusicWant.keyUp` remains supported. Optional `stage` and `cue` fields drive key/stingers.

## Files touched

- `src/audio/music.ts`: player, arrangements, transitions, stingers, beat API.
- `src/audio/music/composition.ts`: pure seeded composition, track metadata and timing helpers.
- `src/audio/music/synth.ts`: bounded synthesis and node lifecycle.
- `src/game/systems/render.ts`: small music-only track/phase/stage/cue hook using existing client/host state.
- `src/ui/screens.ts`: jukebox unlock helper and grid navigation.
- `src/style.css`: one isolated jukebox grid block.
- `tests/music.test.ts`: pure composition/timing tests and fake-WebAudio scheduler/resource regression tests.
- `notes/lanes/music.md`: this handoff.

## Verification and remaining risks

- `npm run typecheck`, `npm test`, and `npm run smoke` pass.
- Unit coverage includes 200 seeds per track, song sections, key changes, beat windows, bar transitions, stinger deduplication, suspension/resume, graph cleanup and voice overload.
- Chromium exercised real Omega phase 1 → 3 from boss HP: stage-four transposition changed to +10 (+6 stage, +4 phase), with no browser errors.
- Real stereo OfflineAudioContext renders covered all twelve tracks, including busy final choruses: finite, non-silent output; peak amplitude 0.080–0.296 before the user's bus volume; zero dropped voices. This is technical audio validation, not a subjective headphone listening review.
- Ran `npm run shot -- "?test&stage=2&weapons=drones:5" shots/music-game.png --wait 4` and inspected it. Also captured and inspected `shots/music-jukebox.png` in Chromium; all twelve entries and Stop/Back fit at 1280×720. Screenshots are intentionally uncommitted.
- No new test-link options. Existing `?test&stage=N&boss&god` exercises each boss; `boss` skips to three seconds before its spawn, so allow time for the spawn and the next musical bar. Jukebox is under Extras.
- No known functional blockers. No runtime dependencies or audio downloads added. Co-op uses the existing snapshot fields; an actual two-peer audio listening session was not performed.
