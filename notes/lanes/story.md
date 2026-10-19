# Story — island recovery crew

## What players get

- A first-launch BEGIN / SKIP STORY gate, then an in-engine fly-over of seven islands, a rising 48-bot swarm and the hero landing. Three original pixel comic panels follow, narrated by the existing `story_intro_1/2/3` recordings, with verbatim captions. EXTRAS > STORY > PLAY INTRO replays it.
- EXTRAS > STORY has HEROES, BOSSES and LORE CHAPTERS tabs: all seven current heroes and all twelve bosses/mini-bosses/rematches, including the hidden Titan body and Pumpking, have portraits and authored bios.
- Each distinct boss defeat recovers its own illustrated chapter. Meeting a boss alone does not unlock it. Rematches have separate chapters. The host sends `C / story-chapter` through the existing effects bus; clients persist their own unlock. Distant teammates receive it, and repeated events are idempotent.
- Omega's existing painted cinematic remains intact. On its normal completion, two comic epilogue pages add `story_ending` narration and one distinct ending for each hero, then the credits roll with `story_credits` and the title theme. Skipping the original painted sequence skips this continuation too. Unlocked hero endings and credits can be replayed in STORY.
- All new copy has English and Arabic catalog keys; the recordings stay English and captions follow the selected language. Portraits reuse the existing pixel portrait painter; comic scenes are local canvas art, not fetched assets.

## Decisions and tuning

- `src/data/story.ts`: fly-over 9 s (three 3 s camera beats); each comic page 8 s, or 5 s with SHORT cinematics, extended to let narration finish +0.4 s; credits 28 s; minimum next-page delay 0.25 s. Intro length is roughly 33 s plus its initial user gesture. The added ending is roughly 16 s plus credits, after the existing painted cinematic.
- CINEMATICS OFF suppresses automatic playback but still records endings; explicit replay remains available. Reduced motion/flashing uses fixed camera shots and a static credits pane; NEXT pages through that pane, and wheel/touch can scroll it. Captions remain visible even with audio muted. No flashes or camera shakes were added.
- Narration uses `sfx.output('voice')`, master/mute/VOICE settings and the shared voice channel (priority 20, gain 0.9, no pitch randomization). A missing/locked recording never blocks progression. The BEGIN gesture unlocks audio; narration is prioritized in the existing sample loader.
- Progress uses namespaced entries in the existing `save.discovered` string list: `story:intro`, `story:boss:<id>`, `story:ending:<hero>`. This keeps progress in normal export/import/reset without competing with the meta lane's save migration. There is no new save shape/version. Existing `normalize()` preserves these strings; old profiles default to unseen. Preview links do not write unlocks.
- Solo story playback holds simulation. Online playback is local and does not stall the team; it closes when the team transitions or starts fighting again. The INTRO never interrupts joining an online lobby. The title attract simulation is barred from chapter unlocks by `saveLock`.
- The 3D intro is built lazily on camera layer 5 with retro materials, reused geometry and an InstancedMesh swarm. The normal gameplay path only checks inactive state; it does not create story geometry or per-frame collections. CSS is injected once, screens use `addScreen`, and controls use MenuNav/data-nav. UI/text scale and RTL are respected.

## Files and integration hooks

New: `src/data/story.ts`, `src/game/story/{strings,art,world,narrator,controller}.ts`, `src/game/systems/story.ts`, `src/ui/storyScreen.ts`, `tests/story.test.ts`, this note.

Small hooks: `game.ts` installs/steps/renders the story object; `systems/render.ts` calls the camera presentation hook; `systems/statuses.ts` emits confirmed boss defeats; `systems/cinematics.ts` forwards story events and appends the epilogue after natural ending completion; `ui/screens.ts` adds the `story` screen id; `dev/testLinks.ts` calls the story preview adapter; `i18n/en.ts` and `ar.ts` spread the story catalogs. PLAN.md receives the required decision paragraph. No gameplay tuning, net host/client, core save schema, settings, audio assets, runtime dependencies or shared stylesheet changes.

## Test links

- `?test&story=codex&lang=en` / `&lang=ar`: portrait library; its tabs expose heroes, bosses and locked/unlocked chapters.
- `?test&story=intro`: full replay, initially at BEGIN.
- `?test&story=intro&storyframe=-1`: fly-over/swarm/landing; `storyframe=0`, `1`, `2` select comic pages.
- `?test&story=intro&storyframe=1&storypin`: hold the Omega/swarmer comic for a screenshot.
- `?test&story=ending&hero=furnace&storyframe=1&storypin`: Furnace epilogue; substitute any hero id.
- `?test&story=credits&calm`: readable static credits, NEXT pages them.
- `?test&stage=4&bossnow&nointro&god&killboss=2`: actual Omega victory path. Do not press anything during the painted cinematic to reach the epilogue.
- Add `lang=ar`, `ui=150`, `textsize=150`, `quality=low` as needed. A clean browser profile without `?test` verifies first launch, skip, and persistence on reload.

## Validation

- PASS: `npm run typecheck`, `npx vite build`, `npm run smoke` (all modes, seven heroes, training, Versus, local co-op, mortal game-over).
- PASS: `tests/story.test.ts`: all characters/chapters/endings, EN/AR parity, exact recording captions/files, old-save normalization, preview/skip behavior, real mini-boss kill unlock, no unlock on encounter/attract, repeated events, distant teammate delivery, binary effects-codec round trip, client persistence, cinematic OFF/skip/natural completion, online continuation, live language switching, chapter UI and title-library ending replay.
- PASS: real browser UI checks in both languages, 390 px mobile layout, all camera beats, actual decoded narration playback after a gesture, skipping with Escape, first-launch reload persistence, and reduced-motion credit pagination. Screenshots in ignored `shots/story-*.png` were inspected. The required `npm run shot` command was run; under concurrent SwiftShader load a 4 s capture can precede a painted frame, so final captures also use a longer wait and a native-Metal browser harness.
- Unit suite: the completed full run had only two existing failures reproduced on the unchanged starting commit `53ba485` using isolated source copies: `firstten.test.ts` lacks death advice for `pumpking`; `halloween.test.ts` expects normalized version 5 although `save.ts` is already version 6. Those unrelated lane files were not modified. A final full rerun received SIGTERM after `lobbyCoop`; its remaining 36 files were resumed with the same bundling/Node runner and all passed. The title-replay fix also passed its targeted unit/browser checks.
- Bench: `npm run bench -- --gpu metal --seconds 10 --warmup 3 --size 640x360`: 616 frames / 61.6 fps, 261 average enemies (307 max), 499 average bullets (573 max), 0.66 ms simulation, 0.80 ms game render, 0.83 ms GL submission, **2.29 ms total CPU per frame**. Default SwiftShader also ran: 1.16 ms per simulation step but only six rendered samples and long GL stalls; that software-rendering result is not a frame-rate signoff.
- Browser co-op gate is **not green**. Both frozen-source Metal runs completed the scenarios and failed only the team-meter assertion: both peers showed the beam, but the host meter had already recharged to 0.021875 / 0.022916666666666665 while the test requires exactly zero after a 200 ms wait. The unchanged starting-revision Metal comparison passed, so this is not claimed as a proven baseline failure. The final default SwiftShader run passed the team move but failed stale pet-level and pillar-state checks under heavy rendering stalls (277 snapshots over the run, versus 1,564+ on Metal). The initial editable-source run was invalidated by a dev reload during its lobby. No story/network exceptions occurred in the frozen-source runs. All in-process co-op tests in the completed suite passed, including the new story effects/codec coverage.

## Remaining risks / lead handoff

- The full unit suite and browser co-op gate are not green. The two unit failures are independently reproduced baseline issues; browser timing/state checks remain unresolved. Re-run co-op on an unloaded machine and review its exact-zero team-meter sampling with the co-op lane before final integration.
- New heroes/bosses from other lanes need corresponding story keys and Arabic copy. Coverage tests deliberately fail if a newly merged character has no authored bio/chapter/ending. Layer 5 is used only for the intro camera.
- In co-op, a player may see only part of the epilogue if teammates immediately continue; the ending remains unlocked for later replay. This deliberately preserves host-authoritative progression.
- No push or merge. No external generation APIs, secrets or `.env` files touched.
