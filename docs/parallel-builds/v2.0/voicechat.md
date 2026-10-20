LANE: voicechat — proximity voice chat

1. Voice over the existing WebRTC connections (PeerJS media calls or adding an audio track): push-to-talk (bindable, default V is taken? pick a free key and gamepad button per CLAUDE.md's prompts system) or open mic with a voice activity threshold; per-player volume and mute, a global VOICE CHAT setting (OFF by default; asks for microphone permission only when turned on).
2. Proximity: volume and stereo pan from in-game distance between heroes (quiet beyond ~25 m, full when close; a TEAM RADIO toggle to hear everyone at full volume); downed/spectating players hear everyone.
3. HUD: speaking indicator on name tags, teammate list and lobby player cards; a mic level meter in settings with a test.
4. Works in the desktop app (Electron microphone permission) and the web; degrades gracefully when no mic or permission denied; host relays nothing (mesh between peers is fine up to 8, or route through the host if simpler).
5. Tests: unit tests for the gain/pan math and state; a headless two-page test with a fake media stream (Chromium --use-fake-device-for-media-stream) proving audio connects and the speaking indicator lights.
Owns: new src/net/voice.ts, src/ui/voiceUi.ts, settings options (additive), small hooks in peer.ts/online.ts, tests/voicechat.test.ts.
