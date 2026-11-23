# Gate 6 cinematics and photo mode

## What players get

King Bopper, Rampage Rex, Hive Queen and Omega Overlord introduce themselves in the arena. The camera finds each boss from a different angle and the caption changes from its title to its line. Titan Goliath gets a wider shot once its shoulders have cleared the ground. Other full bosses use the same entrance and knockout machinery. The killing blow cuts from the boss to the hero raising their arm. A loadout evolution brings the camera down to the hero, who salutes as the upgrade lands. The card identifies the actual fork and explains what it does.

Solo photo mode adds three poses, shallow focus, a 24-hour lighting slider, an enemy visibility switch, viewfinder and airmail frames, and comet and ringed-planet stickers. Open **Pause → Photo Mode**. Tab cycles controls. On a controller, click the left stick for tools, use left/right to select, up/down to change the hour and confirm to activate a button. The camera, posing and lighting are local. Snap still downloads a composed PNG through the existing desktop/browser path. [English export](../../shots/g6-cinematic/export-en-1280.png) · [Arabic export](../../shots/g6-cinematic/export-ar-1920.png) · [Wide-aspect export](../../shots/g6-cinematic/export-ar-844.png)

## Timing and multiplayer

| Moment | Solo | Online |
| --- | --- | --- |
| Boss entrance | 2.2 s full, 1.1 s short. Freeze combat while the camera is off the hero. Titan's camera waits until 88% of its existing 3 s rise. | 1.1 s local caption over the combat camera. The existing entrance snapshot starts it and the host keeps simulating. Skipping on either screen leaves the team's encounter clock alone. |
| Boss knockout | 2.1 s or 1.5 s with reduced motion. The existing kill-release path pays rewards once. The camera cuts to the hero at 32%. | 0.95 s local caption from the existing F event. The defeated boss becomes untargetable immediately. With finishers on, its zero-health snapshot lasts 0.65 s of combat simulation before reward release. Shots, movement and other enemies continue. A promoted authority can release a zero-health boss from a migration snapshot, including when the remaining player continues solo. The snapshot lacks killer attribution, so recovery credits the arena. A host with finishers off resolves the kill immediately and still sends the event. |
| Loadout evolution | 2.7 s full or 1.5 s short. The new fork's name and effect appear at the 45% landing beat. | A 1.9 s local card. A client that receives its build while the team is choosing cards queues its own reveal until the field is visible. |

The first loop's actual `BOSS_ORDER` contains four entries including Omega. Titan is the fifth authored entrance. Mini-bosses keep their immediate defeat. BOSS INTROS and BOSS FINISHERS retain independent switches. Cinematics Off suppresses the entrance and evolution. Reduced motion, reduced flashing, reduced screen effects and disabling dynamic camera retain the combat viewpoint. Keyboard, pointer, controller confirm and the on-screen skip control dismiss a scene.

The camera player reuses `CinematicCamera` interpolation and restores position, orientation and lens on exit. Fixed-step gameplay owns solo holds, network reward release and evolution detection. Local rendering owns keyframes, poses, captions and letterbox. The photo lens uses a screen-space focus band projected through the hero, with eight surrounding pixel samples and a reusable buffer. The daylight override updates the scene lighting, sky and colour grade for the exposure and restores them after the draw. Enemy render batches keep their existing flat scene placement. Photo mode remembers and restores visibility per draw, including for an already invisible mesh.

## Visual checks

All pairs are seed 42, season off, EN and AR in headless Chromium. The before captures used the unmodified production build. The after captures use actual live scene models and the studio controls. The meadow is photographed at 17:00 and the night scene at 21:00. The baseline photo mode opens in the stage's original light. The [visible boss](../../shots/g6-cinematic/studio-boss-visible.png) and [hidden boss](../../shots/g6-cinematic/studio-boss-hidden.png) exports show the same frozen fight with the at-the-ready pose. Arena markings and already emitted effects remain in the composition. The saved exports above also cover the airmail border and stickers with all controls excluded. Screenshot PNGs and machine reports are in the worktree's ignored `shots/g6-cinematic/` directory.

| Moment | EN 1280×720 | AR 1280×720 | EN 1920×1080 | AR 1920×1080 |
| --- | --- | --- | --- | --- |
| Meadow studio | [before](../../shots/g6-cinematic/before-meadow-en-1280.png) / [after](../../shots/g6-cinematic/after-meadow-en-1280.png) | [before](../../shots/g6-cinematic/before-meadow-ar-1280.png) / [after](../../shots/g6-cinematic/after-meadow-ar-1280.png) | [before](../../shots/g6-cinematic/before-meadow-en-1920.png) / [after](../../shots/g6-cinematic/after-meadow-en-1920.png) | [before](../../shots/g6-cinematic/before-meadow-ar-1920.png) / [after](../../shots/g6-cinematic/after-meadow-ar-1920.png) |
| Night studio | [before](../../shots/g6-cinematic/before-night-en-1280.png) / [after](../../shots/g6-cinematic/after-night-en-1280.png) | [before](../../shots/g6-cinematic/before-night-ar-1280.png) / [after](../../shots/g6-cinematic/after-night-ar-1280.png) | [before](../../shots/g6-cinematic/before-night-en-1920.png) / [after](../../shots/g6-cinematic/after-night-en-1920.png) | [before](../../shots/g6-cinematic/before-night-ar-1920.png) / [after](../../shots/g6-cinematic/after-night-ar-1920.png) |
| King Bopper | [before](../../shots/g6-cinematic/before-king-en-1280.png) / [after](../../shots/g6-cinematic/after-king-en-1280.png) | [before](../../shots/g6-cinematic/before-king-ar-1280.png) / [after](../../shots/g6-cinematic/after-king-ar-1280.png) | [before](../../shots/g6-cinematic/before-king-en-1920.png) / [after](../../shots/g6-cinematic/after-king-en-1920.png) | [before](../../shots/g6-cinematic/before-king-ar-1920.png) / [after](../../shots/g6-cinematic/after-king-ar-1920.png) |
| Rampage Rex | [before](../../shots/g6-cinematic/before-rex-en-1280.png) / [after](../../shots/g6-cinematic/after-rex-en-1280.png) | [before](../../shots/g6-cinematic/before-rex-ar-1280.png) / [after](../../shots/g6-cinematic/after-rex-ar-1280.png) | [before](../../shots/g6-cinematic/before-rex-en-1920.png) / [after](../../shots/g6-cinematic/after-rex-en-1920.png) | [before](../../shots/g6-cinematic/before-rex-ar-1920.png) / [after](../../shots/g6-cinematic/after-rex-ar-1920.png) |
| Hive Queen | [before](../../shots/g6-cinematic/before-queen-en-1280.png) / [after](../../shots/g6-cinematic/after-queen-en-1280.png) | [before](../../shots/g6-cinematic/before-queen-ar-1280.png) / [after](../../shots/g6-cinematic/after-queen-ar-1280.png) | [before](../../shots/g6-cinematic/before-queen-en-1920.png) / [after](../../shots/g6-cinematic/after-queen-en-1920.png) | [before](../../shots/g6-cinematic/before-queen-ar-1920.png) / [after](../../shots/g6-cinematic/after-queen-ar-1920.png) |
| Omega Overlord | [before](../../shots/g6-cinematic/before-omega-en-1280.png) / [after](../../shots/g6-cinematic/after-omega-en-1280.png) | [before](../../shots/g6-cinematic/before-omega-ar-1280.png) / [after](../../shots/g6-cinematic/after-omega-ar-1280.png) | [before](../../shots/g6-cinematic/before-omega-en-1920.png) / [after](../../shots/g6-cinematic/after-omega-en-1920.png) | [before](../../shots/g6-cinematic/before-omega-ar-1920.png) / [after](../../shots/g6-cinematic/after-omega-ar-1920.png) |
| Titan Goliath | [before](../../shots/g6-cinematic/before-titan-en-1280.png) / [after](../../shots/g6-cinematic/after-titan-en-1280.png) | [before](../../shots/g6-cinematic/before-titan-ar-1280.png) / [after](../../shots/g6-cinematic/after-titan-ar-1280.png) | [before](../../shots/g6-cinematic/before-titan-en-1920.png) / [after](../../shots/g6-cinematic/after-titan-en-1920.png) | [before](../../shots/g6-cinematic/before-titan-ar-1920.png) / [after](../../shots/g6-cinematic/after-titan-ar-1920.png) |
| Boss knockout | [before](../../shots/g6-cinematic/before-finisher-en-1280.png) / [after](../../shots/g6-cinematic/after-finisher-en-1280.png) | [before](../../shots/g6-cinematic/before-finisher-ar-1280.png) / [after](../../shots/g6-cinematic/after-finisher-ar-1280.png) | [before](../../shots/g6-cinematic/before-finisher-en-1920.png) / [after](../../shots/g6-cinematic/after-finisher-en-1920.png) | [before](../../shots/g6-cinematic/before-finisher-ar-1920.png) / [after](../../shots/g6-cinematic/after-finisher-ar-1920.png) |
| Flare Buster evolution | [before](../../shots/g6-cinematic/before-evolution-en-1280.png) / [after](../../shots/g6-cinematic/after-evolution-en-1280.png) | [before](../../shots/g6-cinematic/before-evolution-ar-1280.png) / [after](../../shots/g6-cinematic/after-evolution-ar-1280.png) | [before](../../shots/g6-cinematic/before-evolution-en-1920.png) / [after](../../shots/g6-cinematic/after-evolution-en-1920.png) | [before](../../shots/g6-cinematic/before-evolution-ar-1920.png) / [after](../../shots/g6-cinematic/after-evolution-ar-1920.png) |

### Reproduce

Start Vite and append `&lang=ar` for Arabic. Use `npm run shot -- "<query>" shots/g6-cinematic/check.png --wait 6 --size 1920x1080` for a single image.

| Scene | Query |
| --- | --- |
| Entrances | `?test&seed=42&god&season=off&stage=1&bossnow&introat=.95`. Set stage 2, 3 or 4 for Rex, Queen or Omega. Add `&titan` at stage 1 for Goliath. |
| Knockout | `?test&seed=42&god&season=off&stage=2&bossnow&nointro&killboss=1&finat=.85` |
| Evolution | `?test&seed=42&god&season=off&evolution=1&revealat=.66` |
| Meadow studio | `?test&seed=42&god&season=off&day&photo=.6&photocam=.3,30,8&photopose=salute&photofocus&photoquiet&photohour=17&photoframe=viewfinder&stickers=comet@.17,.3;planet@.8,.3` |
| Night studio | Replace `&day` with `&stage=3&night` and use `&photohour=21` in the studio link. |

## Files

- `src/game/cutscene.ts` provides the cue player, three hero poses, boss staging and localized caption strip. `src/game/finisher.ts` replaces the comic rendering path and retains its existing tuning and public helper API. `src/game/systems/cinematics.ts` handles the host kill, evolution queue and local scene clocks.
- `src/ui/photoMode.ts`, `src/ui/photoFilters.ts` and `src/ui/photoSubjects.ts` implement the studio controls, draw-local scene settings, pixel filters and subject visibility.
- Shared `src/game/game.ts` wires the intro, finisher and photo-sky hooks and tags enemy render subjects. Shared `src/dev/testLinks.ts` adds reproducible photo, boss and evolution links and opens the real lazy-loaded photo tool. Shared `src/i18n/arabic2.ts` supplies English and the existing fallback catalogs. Shared `src/i18n/ar.ts` supplies Arabic.
- `tests/g6cinematic.test.ts` covers cue crossing, camera restore, skip, reduced effects, solo protection, co-op reward release, local build reveals, visibility, focus buffers and lighting endpoints.

## Performance

Apple M5 Pro, hardware Metal, managed headless Chromium, production Vite preview. The stock driver measured 62 combat scenes and four cold starts with a 2 s warm-up and 5 s measurement window. The 48 unthrottled legacy rows passed on the updated build. All nine failing updated rows were remeasured once with the same driver, settings and gate.

| 1920×1080 case | Before FPS / p95 frame ms | After FPS / p95 frame ms | After retry FPS / p95 frame ms | After retry simulation / CPU / GPU p95 ms |
| --- | ---: | ---: | ---: | ---: |
| HIGH double, WebGL2 | 60.0 / 16.7 | 60.0 / 16.8 | 60.0 / 16.8 | 2.3 / 4.5 / 1.9 |
| HIGH lights, WebGL2 | 60.0 / 16.7 | 60.0 / 16.7 | 60.0 / 16.7 | 1.6 / 4.1 / 2.5 |
| HIGH lights, WebGPU | 58.6 / 16.8 | 53.8 / 16.8 | 56.6 / 16.8 | 2.5 / 6.5 / 4.8 |
| LOW four heroes, 4× CPU | 26.0 / 50.1 | 30.0 / 50.0 | 32.7 / 49.9 | 17.2 / 29.4 / 0.7 |

The updated HIGH WebGL2 light scene sustained 60.0 fps with median populations of 336 enemies and 1,020 projectiles. The full budget failed on ten rows before, nine after and six after retry. Five remaining failures were 4× CPU-throttled simulation cases. WebGPU's light scene missed sustained FPS and refresh-slot targets on both revisions. All six remaining configurations also missed a budget before the lane changes. The underlying frame, population, CPU, GPU and startup measurements are preserved in the [before](../../shots/g6-cinematic/bench-before.json), [after](../../shots/g6-cinematic/bench-after.json) and [retry](../../shots/g6-cinematic/bench-retry.json) reports. The other graphics lane also recorded existing throttled simulation overruns. [Renderer measurements](g6-renderer.md)

## Gate 2 skilled bot

Normal Rookie, seeds 1–20, season off, no pet, mortal `window.skillRun`, 2,100 s cap and one fresh process per seed. The first two original samples ran before editing. The other eighteen used the same runner with the original source files from revision `95ca29f`. A final fresh-process spot check reproduced seed 1's updated clearance at 1,043.85 s.

| Build | Loop clears | S1 / S2 / S3 / S4 clear % | Median stage | Mean run seconds | Incomplete |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before | 10/20 (50%) | 100 / 95 / 90 / 50 | 4 | 946.1 | 0 |
| After | 9/20 (45%) | 100 / 95 / 90 / 45 | 4 | 959.7 | 0 |

The updated 45% clearance meets the 40–60% Normal target. Combat stats and enemy damage tables were outside this change. [Before seed results](../../shots/g6-cinematic/skill-before.json) · [After seed results](../../shots/g6-cinematic/skill-after.json)

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npx vite build` | Pass |
| `npm test` | Pass, all 146 files. The final full suite passed host migration on its automatic timing retry. The subsequent focused tests also cover a migrating last survivor and closing a photo during a lighting override. |
| `npm run skillbot -- --runs 20 --seed 1 --difficulty normal --jsdom` | Pass, 9/20 updated Normal loop clears. |
| `npm run smoke` | Pass, including the mortal death and game-over path. |
| `npm run coop -- --offline` | Pass. Two real WebRTC peers saw the boss entrance and knockout, and the boss was released. Reconnect and stage progression passed. An earlier run missed the independent ping-portrait window and passed on repeat. |
| `npm run shot` and managed Playwright | Pass. Inspected 36 before/after pairs and PNG downloads. Reduced-motion Arabic kept its original camera and the skip button dismissed the caption. Turning intros off suppressed it. [Reduced-motion capture](../../shots/g6-cinematic/reduced-motion-ar.png) |
| `npm run bench:real -- --check` | Fail before and after, including after the timing retry. See the six configurations above. |
| `npm run balance` | Fail before and after. All four invincible kits cleared two stages and both reports are byte-identical. The laser/well/meteor kit had 8 stage-one ranks against the historical 12, one rank below the allowed lower bound. [Original balance result](../../shots/g6-cinematic/balance-before.json) · [Updated balance result](../../shots/g6-cinematic/balance-after.json) |

The native shell browser launch was unavailable in the macOS sandbox. Screenshot, balance, co-op and benchmark drivers used managed headless Chromium on loopback. Benchmark reports retain the unmodified measurements and budgets. The two outstanding gates are the performance budget and historical balance tolerance.
