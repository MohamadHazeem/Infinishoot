LANE: spectate — watch your friends play

1. Spectator slots: when an online co-op/PvP/race lobby is full (or by choice: JOIN AS SPECTATOR), extra friends can join as spectators (up to 8 spectators): they receive snapshots like a client but have no hero, and appear in the lobby list as WATCHING. Host bandwidth: spectators get a reduced-rate snapshot (e.g. 10 Hz, larger interest radius, no per-hero private data).
2. Spectator camera: follow any player (cycle with keys/pad, show their name, build and HP), or a free camera (pan/zoom within the arena), or an AUTO DIRECTOR mode that cuts to the most exciting player (boss fights, low HP, big combos) every few seconds.
3. Broadcast overlay (toggle): every player's portrait, HP, level, style rank and weapons along the side; boss bar; event banners; a clean look for streaming.
4. Spectators can switch to playing at the next stage if a slot opens (drop-in rules from coop2) and can send emotes (shown to players, rate-limited).
5. Synced, tested with a headless spectator page in the coop script (a scenario), screenshots, unit tests.
Owns: new src/game/systems/spectate.ts, src/ui/spectateUi.ts, lobby additions (small), net additions (spectator snapshot path in netHost/netClient, careful and additive), tests/spectate.test.ts.
