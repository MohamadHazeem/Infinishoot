# audio3 — sound and music pass

## Players get

- Measured gain correction for all 303 recorded samples, applied once to decoded PCM. Direct buffer consumers (ambience) and one-shot playback use the same corrected audio. No MP3s are rewritten or downloaded.
- Measured corrections for the synthesized cue families and all 24 procedural music arrangements. Existing designer overrides, voice budgets, distance attenuation, ducking and volume sliders remain effective.
- A memoryless, oversampled master soft ceiling instead of the old broadband compressor: loud hits cannot depress the following music through a release envelope. Ordinary signals pass unchanged below −6 dBFS; the smooth shoulder stays below −1 dBFS. This is peak protection, not loudness automation; sustained overload can still sound distorted.
- Nine authored four-bar hooks: Raid / All Hands, Arena / Face Off, Gauntlet / Never Yield, Insert Coin / After Hours, Pumpking / Pipe Fright, and new hooks for Glitch DJ, Boxer Jack, Admiral Gale and Halloween. The original title track remains in the jukebox. All 24 tracks are listed by the existing jukebox renderer.
- Glitch retains the attack-synced DJ BPM and electro arrangement. Boxer uses the bell music-box patch. Gale uses swung call-and-response with an organ/reed-like lead. Pumpking has a hollow four-pipe organ patch and harmonic-minor motif. Seeded bridges, boss phase lifts and existing adaptive layers remain.
- Menu remix, Gauntlet horde, PvP duel and Pumpking selection happens locally from existing state. Gauntlet bosses retain their own themes. Raid selection supports a future `raid` run-mode id; no raid gameplay exists in this checkout.
- Teammate ping chimes and ping banter originate at the speaker, while the visible marker stays at the requested location. Recorded emotes and banter use the VOICE volume bus, pan/distance and the bounded HRTF route when HEADPHONES 3D AUDIO is on. Synthesized hero speech also carries world coordinates.
- GO HERE / DANGER / ON MY WAY / NICE request the matching recorded banter. Thumbs-up uses “Great shot!” and a revive requests “Thanks for the revive!” from the revived hero. Six banter captions have matching English/Arabic catalog entries. Existing hero-voice toggles and the priority/expiry queue apply.
- Existing chat, lobby countdown-ready, PvP round start and victory, achievements, profile levels, MVP trophies, game-over defeat and page/card flips use their recorded samples. Halloween's existing bat/ghost/witch/pumpkin wiring is preserved.

## Mastering / tuning

`node scripts/audio/loudness.mjs --synth --write --report shots/audio3-loudness.json`

Uses local ffmpeg `ebur128=peak=true` and local Chromium OfflineAudioContext. No external content API, credentials or runtime dependencies. Short effects repeat to at least three seconds for stable gating; these are comparative **LUFS-ish cue measurements**, not programme loudness certification. Stereo measurements retain both channels. Synth noise/pitch tests use seed 42; music uses 20-second arrangements at requested intensity 0.9, seed 42, beginning after the intro.

Targets before caller/bus volume: weapons −23, impacts −24, UI −26, voice −20, ambience −30, music −28 LUFS. Sample boosts cap at +12 dB, synth/music at +6 dB, and correction reserves a −3 dB true-peak ceiling. Quiet incidental sounds can remain below target rather than being aggressively amplified. Speech uses the most conservative correction across the tested hero/bark variants. Unknown future ids use unity until the audit is regenerated.

Default master 0.5, effects 1, music 0.7, UI/voice 0.8 are unchanged. At the measured targets, a sample weapon's normal 0.5 caller gain reaches roughly −35 LUFS after master, versus roughly −37 for music; the short synth layer reinforces the attack. Ambience remains deliberately quiet under its existing 0.45 slider / 0.3 internal bed trim. Random variation and authored cue gain still affect actual play.

The master WaveShaper uses an 8,193-point curve and 4× oversampling. The defensive legacy-host fallback uses a −1 dB threshold, zero knee/attack, 20:1 ratio and 50 ms release; supported Chromium/Electron uses the memoryless path. No extra per-frame WebAudio nodes are created. Sample normalization is one linear pass when each optional clip finishes decoding.

## Integration surface and ownership

New logic lives in `src/game/systems/audio3.ts`. Shared integration changes are small: `systems/render.ts` (track choice, local reward observation, speaker-position ping), `systems/sound.ts` / `coop2.ts` (speaker coordinates), `party.ts` (two cue substitutions), `pvpFlow.ts` (two cue substitutions). No protocol, save shape, gameplay hearing values, settings defaults or public assets change.

Owned audio edits: `loudness.ts`, `samples.ts`, `sfx.ts`, `mix.ts`, `music.ts`, `music/composition.ts`, `music/synth.ts`, `voices.ts`, `heroVoice.ts`, `emoteVoice.ts`, `voiceText.ts`, `crowd.ts`, `surround.ts`, `radio.ts`; new `featureSamples.ts` and `teammateVoice.ts`. Also `scripts/audio/loudness.mjs`, `tests/audio3.test.ts`, and six additive entries in each i18n catalog for the spoken captions. This lane note is the decision log in place of editing shared PLAN.md.

`game.vfx.sound(name, x, z)` supports `achievement`, `questDone`, `profileLevel`, `pageTurn`, `trophy`, `readyDing`, `chatPop`, `coinTransfer`, `reconnect`, `hostMigrate`, `roundBell`, `victoryFanfare`, `defeatSting`, `raidAlarm`, `raidHorn`, `carryLift`, `teammatePing`. Each has an existing recording plus a short offline synth fallback. UI events use the UI bus; raid warnings have an unducked threat synth. `banter:<hero>:<line>` uses the existing effects string and source coordinates; allowed lines are `nicesave`, `behind`, `thanks`, `groupup`, `onmyway`, `greatshot`.

Quest completion, trade/coin transfer, carry, reconnect, host migration and raid events are absent in this worktree. Their named cues are ready for the owning lanes to emit; this lane does not invent their gameplay. A future raid lane must expose its music choice/run mode or call the track directly. Regenerate the gain tables after adding/re-recording assets or changing synth envelopes.

## Validation and test links

- `npm run typecheck` and `npx vite build`: pass (existing bundle-size advisory only).
- Final focused suites `audio3`, `music`, `sound`, `audiomix`, `soundlane`, `voices`, `sound2`: all pass (503 assertions/logged checks). Final `audio3.test.ts` was rerun against the finished tables and passes. Covers every manifest entry, gain/peak policy, the memoryless ceiling, unchanged enemy hearing, authored themes, mode selection, valid event samples, queued spatial speech, VOICE settings, HRTF and stereo routing.
- Mastering audit: 303 recorded files, 326 synthesized variants mapped to 250 runtime gain keys, 24 music arrangements. Corrected measured sample true peaks top out at −3.00 dBFS, synth −6.20, music −9.70 before caller/bus gains. Captured all music arrangements without dropped music voices. Continuous hum/crowd beds retain their existing authored low levels; radio speech is a representative phrase because its script is generated from run highlights.
- Browser visuals: ran the required four-second `npm run shot` links, then used a readiness wait and native Metal for final captures because the busy shared machine was still showing its loading overlay at four seconds. Inspected `audio3-jukebox-ready.png`, `audio3-jukebox-bottom.png`, `audio3-pumpking-ready.png`; all new tracks fit the existing scrollable jukebox, and actual Chromium reported `pumpking` playing with a running AudioContext. No browser page errors.
- Production heavy benchmark with audio unlocked, HIGH quality, Metal: 67.0 rendered fps; 297 average / 345 maximum enemies, 518 average / 683 maximum bullets. Simulation 1.06 ms, game render 1.01 ms, GL submit 1.17 ms: **3.24 ms total CPU/frame** (p95 4.40 ms). The per-frame audio integration is bounded by the hero count and allocates no per-frame objects. This is one shared-build-machine measurement, not a broad hardware guarantee.
- Fresh real-browser co-op: boss phases/finisher, ping, team move, down/revive, route voting and stage transitions ran with matched skill effect counts. 1,826 snapshots, average 1,821 B / maximum 14,718 B, none over 16 KB. **The overall harness failed**: a player with pet `none` remains level 1 while the check requires every pet to be level 4 (host/client pet data matched), and the postgame check requires the legacy `gameover` screen. An earlier attempt was invalidated by Vite reloading while development edits were still in progress; it is not counted as validation.
- Full-suite and smoke completion are recorded in the final validation addendum below. The untouched HEAD archive independently reproduces `firstten.test.ts`'s game-over-screen assertion and `gauntlet.test.ts`'s two Hard Omega / Ascension assertions. These are outside audio ownership; no gameplay or test expectations were changed to suppress them.

- `?test&screen=jukebox&season=off` — all tracks (QA fixture raises the in-memory best-stage/boss count to expose locked labels).
- `?test&mode=gauntlet&god&audio&season=off` — continuous Gauntlet theme.
- `?test&season=halloween&stage=2&bossnow&nointro&god&audio` — Pumpking organ theme.
- `?test&season=off&biome=neon&bossnow&god&audio`, `biome=factory`, `biome=sky` — DJ, Boxer, Gale.
- Existing online co-op lobby / ping wheel / emotes; enable HEADPHONES 3D AUDIO and HERO VOICES.

No human headphone audition or subjective mix review has been performed. Waveform measurements, actual Chromium playback and routing tests do not replace that review.
