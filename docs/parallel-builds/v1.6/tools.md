LANE: tools

Goal: photo mode, leaner co-op, and loose ends.
1. Photo mode: from the pause menu, PHOTO MODE freezes the game, hides the HUD, lets the player move a free camera (pan/zoom/tilt within limits, keyboard/mouse/gamepad), pick filters (normal, retro CRT, sepia, comic ink, neon glow, black & white), add stickers/frames/logo, and save a PNG (canvas toBlob download; in Electron it should also work) with the shutter sample 'photo_shutter'. Solo only or host-paused in co-op (decide sensibly).
2. Leaner co-op network: snapshots average ~5.8 KB and peak 20 KB (~110 KB/s per client), mostly cosmetic effect events (bursts 'b', sounds 'a', numbers 'n', stars 's', corpses 'c' in src/game/vfx.ts recordings). Design a compact binary encoding for the effects bus (quantised positions, palette/colour indices, enum ids, merged bursts) and delta/skip redundant state; target at least -50% bytes with identical visuals. Keep codec tests and `npm run coop` green and report before/after numbers (the coop script prints snapshot sizes).
3. Show other players' parry swings in co-op (a visible swing arc for every parry attempt, not only on success).
4. Weather on/off setting (rain/snow motes/lightning) in SETTINGS, wired to src/game/ambience.ts weather.
Owns: new src/ui/photoMode.ts, src/net/fxCodec.ts, src/game/vfx.ts (encoding parts), systems/netHost.ts/netClient.ts (effects transport), parry swing visuals in systems/skill.ts (small), settings/screens toggles (small), tests/tools.test.ts.
