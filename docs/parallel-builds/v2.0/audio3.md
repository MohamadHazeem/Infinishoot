LANE: audio3 — sound and music pass

1. Mastering: measure loudness of every recorded sample and synth cue; normalise to consistent targets per category (weapons, impacts, UI, voice, ambience), music vs effects balance at default volumes, a limiter that never pumps; a script scripts/audio/loudness.mjs reporting LUFS-ish levels (ffmpeg ebur128) and an automatic gain table src/audio/loudness.ts the sample engine applies.
2. New music in the procedural system: a raid boss theme, a PvP arena theme, a Gauntlet theme, a Halloween variant, a menu theme remix, and boss themes for Glitch DJ (electro), Boxer Jack (music-box/circus), Admiral Gale (sea shanty), Pumpking (spooky organ) — styles in src/audio/music/composition.ts; the jukebox lists them.
3. Teammate sounds in space: pings, emotes and banter play from the teammate's position (pan/distance/HRTF if on).
4. Sounds for tonight's new features where lanes left synth placeholders: wire the recorded samples that exist (see public/audio/manifest.json: achievement, quest_done, profile_level, page_turn, trophy, ready_ding, chat_pop, coin_transfer, reconnect, host_migrate, round_bell, victory_fanfare, defeat_sting, raid_alarm, raid_horn, bats, ghost_wail...) to their events if the owning lane didn't.
Owns: src/audio/* (mixing/loudness/music composition; careful with shared files), scripts/audio/loudness.mjs, tests/audio3.test.ts.
