# Voices lane — 2026-10-19

Characters speak, and impacts sound like what they hit. Built on the recorded pack v1.6 (boss lines and roars, hero barks, material hits, choir stab), the shared sample engine and the announcer. No new dependencies or assets.

## Player-facing

- **Boss voices.** Each boss (King Bopper, Rampage Rex, Hive Queen, Omega Overlord) roars with its own roar at its entrance and says its intro line 0.9 s later; on each phase change it roars, a choir stab hits and it says its phase line 0.55 s later; on death it says its defeat line. Mini-bosses (Prince Bopper, Rex Jr., Hive Princess) use their parent's roar pitched up (x1.3), no lines. While a boss talks, effects duck to 50%.
- **Hero barks.** The local hero says short lines: run start (after the announcer's GO!), level-up (30% chance, 60 s cooldown), low life (below 30%, once per dip: life must climb back over 60% to re-arm, 25 s cooldown), multi-kill (12+ team kills inside 0.8 s, x1.5 per extra co-op hero, 70% chance, 40 s cooldown), boss appears (4.2 s after, so the boss's intro goes first), revived, evolution (a loadout fork or an auto-weapon evolution), stage win (2.4 s after the clear, after the boss's defeat line and STAGE CLEAR). Any two barks are at least 12 s apart (low life and revive: 4.8 s). A simulated 10-minute run with constant triggers barks 35 times at most. Each hero (Rookie, Bulwark, Dash, Ace) has its own voice; skins keep it. Co-op: you only hear your own hero (others' barks at low volume were optional and are not done). **SETTINGS > HERO VOICES** (on by default).
- **Nobody talks over anybody.** One voice channel for boss lines (priority 22-26), the announcer (11-20) and barks (2-5). A higher line cuts a lower one, unless the current line ends within 0.9 s (then it waits); lower lines wait in a short queue (one per priority, max 4, each with an expiry) or are dropped. Lower lines don't start within 1.5 s of a more important queued line. Big announcer lines (priority 5+: GO, stage clear, game over, boss, evolution, legendary...) wait their turn; combo chatter is dropped instead of piling up.
- **Material impacts.** Every enemy has a material: metal (robots, Goldbug, King, Omega, Prince), flesh (Swarmer, Hop Frog, Mortar Toad, Queen, Princess), slime (Jelly, Jellet, Royal Hive), stone (Rhino, Chonk, Hive Pylon, Rex, Rex Jr., Reaper), shield (Shield Bot). Veterans inherit. Hits play hit_metal / hit_flesh / hit_slime / hit_stone / hit_shield with the combo pitch; crits play the bright crit sample plus the material at x1.12 pitch; hits on an elite's shield always clang (hit_shield). Hit thinning is unchanged (one shared hit stream at `swarmGap(crowd)`, crits 40 ms). Without samples the old synth hit/hitMetal/crit plays.
- **Sound designer (dev).** Debug panel (backquote) > Sound designer: every sample from the manifest in a dropdown, Play, live Gain x / Pitch x / Variation / Cooldown sliders saved to localStorage (dev builds only), reset one/all, EXPORT JSON (box + clipboard + console) to paste into `SAMPLE_TUNING` in src/audio/soundTuning.ts, which the game ships with. Every cue (all sfx methods, `w:` weapon cues, `v:` boss voices, `m:` impacts) in a second dropdown with Play cue and the sample it plays (picking a cue selects that sample for tuning). A Voices sub-folder tunes voice gains, ducks, delays, impact gains and bark pacing, and shows samples loaded and who is talking.

## How it works

- `src/audio/voices.ts`: `VoiceChannel` (pure, clock passed in), boss moments, `BarkBrain` (pure bark scheduler), material impacts, `playVoiceCue(name, pitch, pan, gain)`.
- Boss lines travel on the effects bus as sounds named `v:b:<boss>:<intro|phase|defeat>` (`v:m:` for mini-bosses), positioned NaN (heard by everyone), so clients hear them with no codec change. Impacts are `m:<material>` / `m:<material>:c` (crit), positioned like the old hit sound. `Vfx.playSound` hands any `x:`-prefixed name to `playVoiceCue`. Cue names are prebuilt strings (no per-hit allocation).
- Barks are derived locally on every machine from state clients mirror (mode, own hero life/dead, team level and kills, own weapons' `evolved`, boss present via `boss` / `netBoss`) in `src/game/systems/voiceLines.ts`, called from render next to `updateSound`. No network traffic.
- Voices and barks play on the UI (menu sounds) bus like the announcer, so the effects duck doesn't swallow them.
- The announcer asks the channel through `voiceGate` (announcer.ts) and claims it when it speaks.
- `SampleEngine.play` applies `sampleTune(id)` (gain/pitch multiply, variation/cooldown replace). Shipped data: hit_slime 0.9, hit_stone 0.85, hit_shield 0.8, choir_stab 0.75 gain and no variation.
- Tuning objects: `voiceTuning`, `barkTuning` (src/audio/voices.ts), `SAMPLE_TUNING` (src/audio/soundTuning.ts), materials `ENEMY_MATERIALS` (src/data/enemies.ts).

## Checks

- `npm run typecheck`, `npm test` (17 files, new tests/voices.test.ts: channel priorities/queue/reserve, announcer gate, boss cues and pack coverage, bark scheduling incl. a 10-minute spam check, materials for every enemy, sound tuning), `npm run smoke` all pass. `npm run coop` passed (snapshots avg 4.2 KB). `npm run bench`: CPU at 1 step/frame 1.48 ms, game.render 0.66 ms, ~9.9 MB/s allocated (same range as the perf lane's 1.43 ms / ~11 MB/s).
- Real headless Chromium with a sample-play log (scratch script wrapping `samples.play` via Vite's module URL): `?test&stage=3&bossnow&god&phase=3&killboss=14&bench` -> vo_go, boss_phase + roar_queen + choir_stab, bark_rookie_start, boss_queen_phase (waited for the bark), boss_queen_defeat, vo_stage_clear, bark_rookie_win, in that order with no overlap. `?test&stage=2&bossnow&god&hero=bulwark&...` -> boss_rex_intro, boss_rex_defeat, bark_bulwark_win; hits played hit_metal/flesh/shield/stone and crit. Screenshots of the panel, the export box and SETTINGS (shots/voices-*.png, not committed) look right.
- No new test-link options: `bossnow`, `phase=N`, `killboss=N`, `miniboss`, `hero=`, `spawn=` cover it.

## Files touched

- New: src/audio/voices.ts, src/audio/soundTuning.ts, src/game/systems/voiceLines.ts, src/ui/debugSound.ts, tests/voices.test.ts.
- Small hooks: src/audio/samples.ts (apply tuning, 3 lines), src/audio/announcer.ts (`voiceGate`, 2 call lines), src/data/enemies.ts (`material` field, `Material` type, `ENEMY_MATERIALS` table appended), src/game/systems/combat.ts (crit and hit cue lines), src/game/systems/bossFight.ts (intro and phase roar lines now send the boss voice cue, generic roar kept as fallback), src/game/systems/statuses.ts (defeat line, 2 lines), src/game/vfx.ts (prefix branch), src/game/systems/render.ts (1 call), src/game/settings.ts + src/ui/screens.ts (HERO VOICES toggle), src/ui/debugPanel.ts (1 call).
- mix.ts and sfx.ts were not changed (audiomix lane owns them).

## Unfinished / risks

- Synth-only cues (no recorded sample) show in the panel and play, but tuning is per sample, so they can't be tuned there (that would need a gain hook inside sfx.ts `begin`, which audiomix owns).
- Multi-kill uses team kills, so in co-op a teammate's burst can trigger your bark (the threshold rises 50% per extra hero to compensate). If a boss is already present when the run starts (Boss Rush), the boss bark wins and the start bark is skipped.
- If bossFight.ts's roar lines change in another lane, re-apply the two `bossVoiceCue` lines on merge. New enemies from other lanes default to flesh until added to `ENEMY_MATERIALS`.
- Voices share the MENU SOUNDS slider with the announcer; a dedicated VOICE volume slider could come later.
