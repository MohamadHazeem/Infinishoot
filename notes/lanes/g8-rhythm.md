# Gate 8 rhythm combat and Maestro

## Playing on the beat

Two cyan ticks above the crosshair close around a white pixel on the beat. A gold accent confirms a successful action. Settings → Game → Advanced → Beat Combat switches the optional rewards and their cue off for that player. The cue works with music muted and uses a fixed tick spacing with Reduce Flash. English and Arabic cover the option, cue, boss, phase instructions, cause of death, bestiary and theme.

- The host judges a window of 45 ms on either side of the beat. A qualifying manual projectile carries 8% more base damage throughout its flight. The direct laser, rail and medical beam paths receive the same damage multiplier. Autonomous weapons and later field ticks retain their usual damage.
- On-beat dashes advance dash recharge by 0.22 s, successful parries advance it by 0.45 s, and a manual gadget deployment can advance it by 0.12 s. Recovery stops at the normal stamina cap.
- The musical clock advances from real simulation time through hit-stop. Peers receive the beat quantized to 1/256, BPM, last accent and preference flags. A client can extrapolate for up to 120 ms between snapshots. Remote actions use the existing bounded latency estimate. Beat Combat is a personal setting in the existing settings store. Rewards expire with the run.

## Maestro

A toy parade conductor with a drum body, white gloves, plumed red shako and gold-tipped baton appears on 25% of eligible seeded Rhythm Road bosses from stage two on the Standard route map. The Omega slot and existing special boss overrides keep their precedence. The 256-entry enemy wire table keeps its previous indices. A mod pack filling all slots retains its existing roster.

Maestro has 2,100 base HP and zero contact damage. At 66% and 33% HP a roar cancels the old phrase and gives the player a new count-in. The four-bar theme *Brass Buttons* goes from 108 to 126 to 144 BPM. Its raw 20 s offline recording measured −27.1 LUFS / −10.1 dBTP. The theme gain of 0.90157 brings it to the catalog target of −28 LUFS. In a live audible encounter, 100 active frames per phase gave p95 absolute audio-to-game phase errors of 4.7, 4.7 and 5.3 ms after 2.3 seconds of settling, inside the 45 ms reward window.

Each bar fixes the nearest living hero’s position on beat one. A 1.8 m disc strikes that position on beat three. Later phases add one or two side discs 4.8 m away on beat four. All discs are visible together from the downbeat, including on a late snapshot. Base impact damage is 16 before encounter scaling. The final tempo gives about 0.83 s to leave the center and 1.25 s to leave a side disc. A simulation interruption skips an overdue accent. The standard duel boundary and enrage timer still apply.

## Test links and visual comparison

Use `?test&stage=2&bossnow&maestro&nointro` for the boss, append `&beatcombat=off` for the opt-out, and append `&lang=ar` for Arabic. The captures use the production preview, high quality, seed 42, season off, circle movement, fixed aim and six seconds of live play. The meadow query uses `&stage=1&day`, the night query uses `&stage=2&night`, and the boss uses `&stage=2&bossnow&nointro` with `&maestro` on the new build. The original boss is Rex. The batch used the managed headless Playwright browser after the shell screenshot launcher failed to launch Chromium.

| Scene | Language | Viewport | Before | After |
| --- | --- | --- | --- | --- |
| Meadow | EN | 1280×720 | [before](../../shots/g8-rhythm-before-meadow-en-1280.png) | [after](../../shots/g8-rhythm-after-meadow-en-1280.png) |
| Meadow | EN | 1920×1080 | [before](../../shots/g8-rhythm-before-meadow-en-1920.png) | [after](../../shots/g8-rhythm-after-meadow-en-1920.png) |
| Meadow | AR | 1280×720 | [before](../../shots/g8-rhythm-before-meadow-ar-1280.png) | [after](../../shots/g8-rhythm-after-meadow-ar-1280.png) |
| Meadow | AR | 1920×1080 | [before](../../shots/g8-rhythm-before-meadow-ar-1920.png) | [after](../../shots/g8-rhythm-after-meadow-ar-1920.png) |
| Night | EN | 1280×720 | [before](../../shots/g8-rhythm-before-night-en-1280.png) | [after](../../shots/g8-rhythm-after-night-en-1280.png) |
| Night | EN | 1920×1080 | [before](../../shots/g8-rhythm-before-night-en-1920.png) | [after](../../shots/g8-rhythm-after-night-en-1920.png) |
| Night | AR | 1280×720 | [before](../../shots/g8-rhythm-before-night-ar-1280.png) | [after](../../shots/g8-rhythm-after-night-ar-1280.png) |
| Night | AR | 1920×1080 | [before](../../shots/g8-rhythm-before-night-ar-1920.png) | [after](../../shots/g8-rhythm-after-night-ar-1920.png) |
| Boss | EN | 1280×720 | [before](../../shots/g8-rhythm-before-boss-en-1280.png) | [after](../../shots/g8-rhythm-after-boss-en-1280.png) |
| Boss | EN | 1920×1080 | [before](../../shots/g8-rhythm-before-boss-en-1920.png) | [after](../../shots/g8-rhythm-after-boss-en-1920.png) |
| Boss | AR | 1280×720 | [before](../../shots/g8-rhythm-before-boss-ar-1280.png) | [after](../../shots/g8-rhythm-after-boss-ar-1280.png) |
| Boss | AR | 1920×1080 | [before](../../shots/g8-rhythm-before-boss-ar-1920.png) | [after](../../shots/g8-rhythm-after-boss-ar-1920.png) |

Inspected all 24 images. The reticle clears the charge meter, the new boss silhouette reads against the ochre arena, and the fixed red discs remain visible in the encounter. The Arabic boss bar displayed المايسترو, الطور and the enrage countdown, with the beat cue labelled توقيت النبضة. Both settings controls toggled and exposed their localized help and keyboard navigation state. [English settings](../../shots/g8-rhythm-settings-en.png) · [Arabic settings](../../shots/g8-rhythm-settings-ar.png). Shots are ignored local QA artifacts.

## Files

- New modules are `src/game/beatCombat.ts`, `src/ui/beatAccuracyHud.ts`, `src/game/bossesMaestro.ts` and `src/game/bossesMaestroTheme.ts`.
- Boss integration adds Maestro’s movement in `src/game/bosses.ts` and instanced model parts in `src/game/bosses3Models.ts`. Music registration and calibration use `src/audio/music/composition.ts` and `src/audio/loudness.ts`. The scheduler in `src/audio/music.ts` accepts the encounter tempo and aligns the upcoming bar to the shared clock.
- Shared edits in `src/game/game.ts` connect the update loop, manual releases, dashes, parries, snapshots, preferences and presentation. `src/game/hero.ts` adds per-hero timing state. `src/game/settings.ts` supplies the default and normalization, `src/ui/settingsScreen.ts` adds the Gameplay row, and `src/dev/testLinks.ts` adds the two QA switches. `src/i18n/en.ts` and `src/i18n/ar.ts` add the copy.
- Regression and optional mortal-pilot fixtures are in `tests/g8rhythm.test.ts`. This lane log is `notes/lanes/g8-rhythm.md`.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. Vite emitted its chunk-size advisory. |
| `npm test` | Passed, 149 files. The title-demo save check in worldGame passed on the runner’s isolated retry. The focused rhythm, music and host-migration checks also passed after the final clock and preference edits. |
| `npm run smoke` | Passed, including the existing invincible bot and the mortal run. |
| `npm run balance` | Shell Chromium launch failed. The four-kit replay harness passed in managed headless Playwright. All kits reached stage three within the existing 25% tolerances. |
| `npm run shot` | Shell Chromium launch failed. All 24 production screenshots were captured and inspected with managed headless Playwright. |
| `npm run bench:real -- --check` | Shell Chromium launch failed. The managed-browser report failed the repository gate in 6 of 62 render cases. All four load checks passed. |

The shell browser launchers hit a macOS Chromium Mach rendezvous permission denial. The managed browser used Apple M5 Pro Metal, fresh contexts, the production preview and the repository's actual scene, load and budget functions. The complete matrix and the final per-case samples are in [the benchmark report](../../shots/g8-rhythm-bench.json). Recheck it with `npm run bench:real -- --check --from-report shots/g8-rhythm-bench.json`.

| 1080p High WebGL2, heavy meadow | FPS | Frame p99 | Mean callback CPU | Median enemies / projectiles |
| --- | ---: | ---: | ---: | ---: |
| Before | 56.99 | 66.6 ms | 4.78 ms | 287 / 501 |
| After | 60.00 | 16.8 ms | 3.73 ms | 289 / 503 |

Both use 2 s warm-up and 5 s samples. Every unthrottled WebGL2 and WebGPU scene passed on the final measurements. After the other lane-specific measurements finished, six 4× CPU-throttled scenes still missed budget. Double and four-hero loads failed at both sizes. Heavy and night also failed at 1080p. In a separate same-session 1080p four-hero comparison, the unmodified source already missed the frame p95 and CPU budgets at 30.3 FPS. The lane sample ran at 26.6 FPS, and its last two retries reached 28.6 and 25.4 FPS. Shared-machine timing leaves the full performance gate open.

**Offline co-op.** The direct `npm run coop -- --offline` launcher hit the same Chromium permission error. On managed Playwright the ordinary scenario sometimes sent the portrait ping during the level-up wait screen. The host rejected that ping because combat was paused. A diagnostic run waiting for combat before sending the ping passed all the original assertions, including reconnect, party restart, effects and lobby return. An earlier diagnostic run also reported a stage-two beacon/door mismatch, which did not recur on retry. The repository harness was left as supplied.

A separate two-player WebRTC check spawned Maestro and observed the muted guest receive 108, 126 and 144 BPM, a named boss bar and warning-disc snapshots. Switching the guest preference off and on reached the host in both directions and restored the guest crosshair. The lane tests check that the host retains its own setting and a client cannot award damage or stamina locally.

## Mortal skilled-bot measurements

Ran `npm run skillbot -- --difficulty normal --seed 1 --runs 20 --jsdom` on the lane and `--seed 21` for the fresh cohort. The original source was measured in two batches covering seeds 1–6 and 7–20. All runs used the standard 180 ms reaction, 4° aim error, 10 Hz decisions, Rookie, no pet and season off. The runner's pre-existing tracked report was restored after measurement.

| Normal cohort | Loop clears | Stage clear percentages, 1 / 2 / 3 / 4 | Mean game seconds |
| --- | ---: | --- | ---: |
| Before, seeds 1–20 | 16/20 (80%) | 100 / 100 / 100 / 80 | 1,029.2 |
| After, seeds 1–20 | 13/20 (65%) | 100 / 100 / 95 / 65 | 997.3 |
| After, fresh seeds 21–40 | 13/20 (65%) | 100 / 100 / 100 / 65 | 1,071.6 |

The combined result is 26/40 (65%), five percentage points above the Gate 2 ceiling. Seed 25 reached the simulation cap in the portal and counts in the denominator. A 6% shot bonus produced 15/20 clears on seeds 1–20. The lane retains 8%. Ordinary enemy damage, director budgets and global difficulty settings were outside this lane. In the two post-change cohorts, the pilot met Maestro naturally three times and won in 10.65, 13.57 and 11.33 seconds.

The matched encounter fixture uses `G8_PILOT=off|stock|timed|rex npm test -- g8rhythm` (choose one value). The mortal seed-14 pilot earned the same stage-two build in every case. Beat bonuses begin when the boss is active. The coached pilot only holds an already-full charge until the next visible pulse and retains its normal aim, movement, parry and upgrade decisions. All four finished with 130 HP.

| Encounter | Kill time | Charged volleys rewarded / fired | Extra charged base damage | Total extra base damage |
| --- | ---: | ---: | ---: | ---: |
| Maestro, option off | 18.33 s | 0/13 | 0 | 0 |
| Maestro, stock pilot | 18.31 s | 1/13 | 11.2 | 259.6 |
| Maestro, coached charge release | 15.01 s | 9/9 | 100.8 | 363.0 |
| Rex, stock pilot | 17.94 s | 4/12 | 44.8 | 465.4 |

The coached pilot earned 103.4 more base damage and finished 3.30 s sooner than the stock pilot on Maestro. Damage is counted at projectile emission or direct cast before armour, crits and misses. The fixture records the starting and final kit to catch upgrade differences.
