LANE: music

Goal: the procedural music (src/audio/music.ts) becomes real, structured music.
Build:
1. Song structure: intro, verse, chorus, bridge, with drum fills on section changes and a turnaround, so tracks feel like composed songs instead of loops. Sections follow game intensity where it makes sense (calm verse when few enemies, chorus when the swarm is big).
2. Richer arrangement per area: more instruments/voices per biome (lead, counter-melody, arpeggio, pad, bass, drums with variation), each biome with its own scale/mode, tempo and instrument palette. Better synth patches (detuned saws, FM bells, plucks, noise hats, punchy kick with pitch envelope, snare with noise+tone), light stereo width, sidechain-style ducking of pads on the kick.
3. A key change each stage (stage N transposes), and a final-chorus lift.
4. Boss themes: a dedicated, more intense boss track per boss (King, Rex, Queen, Omega final), with a phase-2/3 escalation (layers added, key up) driven by boss HP phases (expose an API like music.setBossPhase(n) and call it from where boss phase/HP is known; keep that hook tiny).
5. Smooth transitions: calm ↔ fight ↔ boss ↔ victory sting ↔ shop, quantized to the bar, crossfades, a victory/stage-clear stinger and a game-over stinger.
6. Keep the beat API (pulse, beats, beatTimes) working and add `music.beatPhase(): number` (0..1 position in the current beat) and `music.onBeatWindow(ms): boolean` (true if now is within ms of a beat) for the "kill on the beat" bonus another lane builds.
7. Keep CPU low: schedule ahead with the existing lookahead approach; no per-note allocations beyond nodes; total voices bounded. The jukebox screen must still work (add new tracks to it).
Owns: src/audio/music.ts (and new files under src/audio/music/ if you split it), the jukebox list, tests/music.test.ts. Tiny hooks elsewhere only to drive boss phase/victory.
