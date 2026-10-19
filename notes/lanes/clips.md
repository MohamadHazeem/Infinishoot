# Clips — shareable highlights

## What players get

- HIGHLIGHT CLIPS in SETTINGS > VIDEO (on by default). At Medium/High, and Auto above its Low rung, keeps roughly 15 seconds of **silent game-canvas video**. Low/Potato, hidden tabs, title, pause, level-up and shop screens suspend capture. No screen, microphone, account or network permissions.
- Automatic marks: boss finisher, crossing 500 combo (rearmed after dropping below 500), clutch revive, legendary reveal landing, team ultimate, flawless stage. These use existing effects/snapshot playback hooks on each machine; each co-op player records their own view.
- Marks retain up to three seconds after the moment, within a total 15-second window. Pausing/ending the run finalizes a partial post-roll. The most recent eight highlights survive until the next run, with a separate memory cap.
- Thumbnails and SAVE CLIP · WEBM on MVP and game-over screens; VIEW ALL CLIPS opens the registered gallery. Continue/Retry remain the first navigation actions. Keyboard/gamepad menu navigation, UI scale, English/Arabic and static reduced-motion-friendly thumbnails use existing infrastructure.
- **H** selects the last 15 seconds and starts saving; rebind in SETTINGS > CONTROLS > REBIND KEYS. Photo mode keeps its existing H action. The current binding appears in the gallery. Gamepad/touch users save through the result-screen buttons.
- Saving encodes in real time (up to 15 seconds); keep the app visible. Web downloads a `.webm`. Electron's existing download handler opens a save dialog defaulting to **Videos** for WebM, retaining Pictures for PNG. Clips remain available after an export failure/cancellation.

## Implementation / tuning

`src/platform/clips.ts`, exported `clipsTuning`:

- 480×270, target 20 fps, JPEG quality 0.65; letterbox non-16:9 windows.
- One asynchronous JPEG operation in flight; copy only after WebGL submission. No work on the normal simulation path beyond event hooks/manual-key gating. Canvas/context and circular slots are reused; encoded frame objects are the intentional per-capture allocations.
- Ring: 15 seconds, 301 slots, 12 MiB maximum. Marks reference immutable JPEG blobs without copying their contents. Archive: eight clips and 64 MiB conservatively counted (shared frames count twice). No unbounded recording, data URLs, persistent save/profile changes or runtime dependencies.
- 3-second post-roll; 3-second per-kind duplicate suppression. Combo crossings are edge-triggered. New-run/reset generation tokens reject stale asynchronous captures.
- Export: browser `canvas.captureStream(20)` + native MediaRecorder VP8/WebM, 900 kbps target. Only one decoded bitmap at a time; it is closed after drawing. Stream tracks stop on success, error or cancellation. Export aborts on tab hiding/new run. Object URLs are revoked when galleries change and after downloads.
- Rendering is cosmetic and local. `src/game/systems/clips.ts` owns the per-Game WeakMap; no new net messages, snapshot fields, effects codecs or host simulation changes.

## Files / integration

New: `src/platform/clips.ts`, `src/game/systems/clips.ts`, `src/ui/clipsUi.ts`, `tests/clips.test.ts`, `scripts/clips-test.mjs`, this note.

Small additive hooks:

- `src/main.ts`: install UI; capture after the completed renderer pass.
- `src/game/game.ts`: bindable local save input, before the client split.
- `systems/characters.ts`, `cinematics.ts`, `time.ts`, `coop2.ts`: six existing local event/visual paths (combo is read from existing mirrored state).
- `systems/runFlow.ts`, `netClient.ts`: reset on solo/host/client run start.
- `game/settings.ts`, `ui/settingsScreen.ts`: one persisted setting/default; existing settings merging handles older preferences.
- `core/keybinds.ts`: `clip` action and default H. `ui/screens.ts`: `clips` ExtraScreen ID only. CSS is injected from `clipsUi.ts`.
- `i18n/en.ts`, `ar.ts`: matching `clips.*` copy and binding/setting translations.
- `dev/testLinks.ts`: `clips=on|off`; `clipmark` captures actual play, marks at 2 seconds and opens the gallery at 5.5 seconds.
- `electron/main.cjs`: WebM download destination uses Videos. No new filesystem/IPC bridge.

## Test links / commands

- `npm run shot -- '?test&stage=2&quality=medium&god&clipmark&weapons=drones:5' shots/clips-gallery.png --wait 8`
- Same with `&lang=ar` for Arabic, or `--size 640x480` for small layout.
- `?test&quality=medium&god&bossnow&nointro&killboss=3` — real finisher mark.
- `?test&quality=medium&god&reveal=vampire&revealgo=3` — real legendary mark.
- `?test&quality=medium&god&mate&clutchgo=3`, `&mate&teamult=3` — existing time/co-op QA triggers.
- `node scripts/clips-test.mjs` — native capture and all six hooks, a rolling 15-second export decoded through its end, non-black video pixels, WebM download, manual-key rebinding, Low-quality stop, reset, stream cleanup and result-screen screenshots. Uses installed Chromium; `SHOT_CHROME` can override it.
- Local screenshots used the installed Chromium with `--use-angle=metal` through a temporary `SHOT_CHROME` wrapper, as in the desktop/settings lanes. No runner assertions or graphics settings were weakened.

## Validation

- PASS: `npm run typecheck`, `npx vite build` (existing bundle-size advisory), Electron main syntax check, `git diff --check`.
- PASS: new unit suite: chronological ring wrap, time/count/byte eviction, pinned snapshots, all six mark kinds, combo crossings/rearming, duplicate suppression, post-roll, eight-clip/archive byte caps, stop/reset and stale-callback cleanup, unavailable canvas failure.
- PASS: native browser capture/export. A measured ring held 282 frames / 14.999 seconds / 2.38 MB; the exported WebM was 1.30 MB, 480×270, played to 14.983 seconds, and released every track. Both the real SAVE button download and H→J rebinding were exercised. No page errors.
- PASS: `npm run smoke` through all modes, all nine heroes, training, local co-op, a mortal run and real game-over/history checks; no runtime errors.
- PASS: `npm run coop` on final sources. 1,580 snapshots, average 1,232 bytes, maximum 13,252 bytes, none above 16 KiB; sent/received skill-event counts matched. Includes finisher playback, revive, reconnect, party restart, return to lobby and kick. An earlier run exposed the new rail stealing the first MVP action; preserving Continue first fixed it. A subsequent run hit the existing return-to-lobby timing assertion; the unchanged full rerun passed. No test selectors/assertions were changed.
- Visuals inspected: English and Arabic galleries, 640×480 gallery, actual native captured thumbnails, game-over and MVP with a full clip rail. Fixed intrinsic grid sizing that initially let the rail widen MVP. Final native test asserts MVP stays within the viewport; the rail scrolls horizontally and the full gallery wraps. Existing result-screen vertical scrolling remains available.
- `npm test`: 84 unit files ran; the three failing files are the reproduced baseline failures listed below. The clips and i18n suites passed; the final clips unit suite also passed separately after lifecycle/layout polish.
- Bench: production heavy scene, Metal, 20 seconds after 8 seconds warm-up, 1280×720, High, about 316–317 average enemies and 497–500 bullets. **Off: 2.77 ms CPU/frame (p95 3.61); on: 3.49 ms (p95 6.01)**. Both held a 16.67 ms frame interval (~60 fps); capture adds about 0.72 ms average. Measurements include the capture call inside the renderer timing. This was a shared build machine; artifacts are ignored `shots/clips-bench-{on,off}.json`.

## Limits / integration risks

- Clips contain the rendered world only: DOM HUD, comic panels, caption overlays and audio are not captured. Mark metadata/thumbnail titles identify the moment. This deliberately follows the requested canvas capture scope and avoids recording microphones or unrelated screen content.
- GIF export is deferred: no native animated-GIF encoder, and adding a codec/dependency or synchronous quantizer would undermine the cheap capture path. WebM is the shipped export.
- Export is real time and requires a visible app; browsers without WebM MediaRecorder/canvas capture show the unsupported message and do not record. Chromium was exercised; other browser encoders and physical low-end GPUs remain untested.
- Clips are memory-only and bounded: oldest highlights may be evicted, and new runs clear them. Save before retrying. Native Electron save-dialog interaction was not separately automated; the existing tested download mechanism is reused with an additive Videos destination.
- Baseline unit failures on **9fcbafc** were independently reproduced from `git archive` without this lane's changes: `meta2.test.ts` expects 95–110 achievements but has 111; `models.test.ts` finds Ronin/Tinker at 43/44 parts above `MAX_RIG_PARTS`; `story.test.ts` lacks Ronin bilingual story copy. Those owned-by-other-lane files were left unchanged.

## Decision log

2026-10-20: Use a time/count/byte-bounded JPEG frame ring and encode on explicit save. Arbitrarily slicing MediaRecorder chunks does not produce independently playable WebM clips; retaining the complete native recording would grow without bound. The frame ring delivers a real rolling 15-second window, independent clip playback and bounded RAM, with 480×270/20 fps capture and no new dependencies. Reuse existing local event playback for co-op marks and preserve the primary result-screen navigation actions. Defer GIF and audio capture; expose the scope and lifetime in the UI.
