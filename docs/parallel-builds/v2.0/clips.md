LANE: clips — shareable highlight clips

1. A rolling recorder keeps the last ~15 s of gameplay cheaply: capture the game canvas at reduced resolution and frame rate (e.g. 480x270 at 20-30 fps) via canvas.captureStream + MediaRecorder in short chunks, or a ring buffer of frames encoded on demand; must not cost noticeable frame time (measure with npm run bench); OFF on LOW/POTATO quality and togglable in settings (HIGHLIGHT CLIPS).
2. Automatic highlights: on a boss finisher, a 500+ combo, a clutch revive, a legendary reveal, a team ultimate, or a perfect flawless stage, the clip is marked; the game-over/MVP screen shows the run's highlights with thumbnails and a SAVE CLIP button (downloads .webm; also an animated GIF export option at small size if feasible without dependencies) plus a manual "save last 15 s" key (bindable).
3. Desktop app: save dialog into Videos/Pictures; web: download.
4. Tests for the ring-buffer logic and highlight triggers; a headless check that recording starts/stops without errors.
Owns: new src/platform/clips.ts, src/ui/clipsUi.ts, small hooks on the highlight events and the game-over/MVP screens, settings option (additive), tests/clips.test.ts.
