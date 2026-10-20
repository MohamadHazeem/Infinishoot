# Casual — easier local play

## What players get

Everything defaults off (GAME SPEED defaults to 100%). SETTINGS > ACCESSIBILITY starts with an ASSISTS section. Each option saves independently on this device; RESET TAB restores ordinary play.

- GAME SPEED: 100%, 85%, 70%. Slows combat simulation for solo and shared-screen local co-op. Menus remain responsive at normal speed.
- ONE-STICK MODE: move with keyboard, controller or touch; automatically aim at the nearest targetable enemy with a clear shot and fire the primary weapon. Mouse users click a destination to move, and can click the existing dash/special HUD meters. Normal action keys, controller buttons and secondary attacks still work. Turning one-stick off restores the previous AUTO-FIRE preference.
- AUTO-DASH, LONGER HIT PROTECTION, HALF DAMAGE TAKEN, SLOW ENEMY BULLETS, BIGGER PICKUP MAGNET are separate toggles.
- The mode screen offers CASUAL PRESET on a fresh save and later visits. It selects standard mode and explicitly enables 85% speed, one-stick, half damage and double magnet; other assists remain off. A green check confirms the bundle is selected. The explanation says achievements count and leaderboard scores do not.
- ASSIST appears in gameplay and run history. Once any casual option is used in combat, that run stays assisted even after every option is turned off. New runs reset the flag. Achievements, profile XP and lifetime progress still count.
- English and Arabic keys are in the base catalogs, with ordinary fallback behavior for future locales. Focus descriptions resolve the current language at read time. CSS comes from assists.ts, uses existing pixel palette/fonts, logical positioning and HUD scaling. The small settings footer wraps rather than stacking individual Arabic letters at 150% text size.

## Tuning and decisions

`assistTuning` is exposed in the debug panel's Casual assists folder:

| Option | Value |
| --- | --- |
| Aim search | 24 m, nearest living/targetable enemy with unobstructed line of sight |
| Damage | x0.5 after the existing armor/cap pipeline; fractional damage preserves exact halves |
| Hit protection | x2 existing hurt i-frames (0.7 → 1.4 seconds); normal dash rules remain |
| Enemy bullets | 65% movement, unchanged velocity and expiry; player/reflected bullets keep normal movement |
| Pickup magnet | x2 radius, applied to collectors without mutating hero stats |
| Automatic dash | At most 3 in a rolling 60 simulation seconds, separately per hero; requires an available normal dash stock |
| Warning threshold | 0.12 seconds before impact/attack; strike circles, fuse explosions, lunges/charges, sniper lanes, leap/standard boss slam landings |
| Click destination | Stop within 0.25 m; slow on approach; manual movement, menu, stage change or death cancels |

Automatic dashes use the ordinary Player.update/onDash path, so collision, invulnerability, skill effects and perfect-dash refunds work normally. The assistance budget still limits automatic dodges even when a perfect dodge refunds a stock. Manual dashes do not consume this budget and remain usable after it is exhausted. Rewind does not restore the budget or erase run eligibility. Local controllers each retain their own click/dash state; temporary input vectors are restored after movement so multiple fixed steps cannot latch injected movement.

All options are disabled online, in PvP (including its solo preparation phase), and in races/hot-seat race turns. Checking only `role === 'solo'` is insufficient: online races and PvP preparation also use that role. The gate additionally checks PvP/race state and retained host/client connections. Settings never enter snapshots or the effects stream; no netHost/netClient or transport changes.

Assisted runs skip local and global score submissions, daily bests, weekly bests/ghost sharing, gauntlet tables and the local co-op weekly board. Ranked PvP/races always use normal settings. Profile progression is deliberately retained. Save v10 adds optional RunRecord.assisted; normalize() migrates missing or malformed flags to false and preserves real true values. The schema addition must be retained when reconciling other lanes' version bumps.

Decision log (kept in this lane note to avoid editing shared PLAN.md): the preset favors fewer controls and more reaction time rather than enabling every automation. One-stick auto-fire is an effective run-time preference, not a destructive change to AUTO-FIRE. Assistance is local and run eligibility is sticky, so players can change settings freely without accidentally publishing an assisted score. No runtime dependencies, audio assets or external APIs were added or called.

## Files touched

- New implementation: `src/game/systems/assists.ts`; tests: `tests/casual.test.ts`.
- Additive settings/UI: `src/game/settings.ts`, `src/ui/settingsScreen.ts`, `src/i18n/en.ts`, `src/i18n/ar.ts`, `src/ui/debugPanel.ts`, `src/ui/hudLayout.ts`.
- Small integration hooks: `src/core/input.ts` (read mouse coordinates on click), `src/game/game.ts` (time/input/fire/magnet), `src/game/systems/statuses.ts` (damage/i-frames/bullet displacement), `src/game/systems/runFlow.ts` and `meta.ts` (reset/eligibility), `src/game/save.ts` (history migration), `src/ui/screens.ts` (preset/history badge), `src/dev/testLinks.ts` (unsaved test preferences).
- No edits to shared style.css, hero.ts, networking, co-op test script, dependency manifests or environment files.

## Test links / screenshots

Unsaved flags: `casual`, `onestick`, `gamespeed=100|85|70`, `assists=dash,iframes,damage,bullets,magnet` (comma list replaces the five assist toggles).

- `?test&screen=modes&lang=en` or `lang=ar`: fresh mode screen / explicit preset.
- `?test&screen=settings&settingstab=4&casual&lang=en` (also Arabic).
- `?test&screen=settings&settingstab=4&casual&lang=ar&textsize=150`: scroll at 640×480.
- `?test&casual&assists=dash,iframes,damage,bullets,magnet&stage=2&weapons=drones:5&god`: gameplay and clickable meters.
- Required screenshot invocation used: `npm run shot -- '?test&screen=settings&settingstab=4&casual' shots/casual-settings-en.png --wait 4` (with a local SHOT_CHROME wrapper selecting Metal).

Viewed local PNGs: `shots/casual-settings-{en,ar}.png`, `casual-assists-{en,ar}.png`, `casual-preset-{en,ar}.png`, `casual-small-ar.png`, `casual-small-footer-ar.png`, `casual-play.png`, `casual-history.png`. UI assertions cover preset persistence, all rows being navigable, language switching, no horizontal overflow at 640×480/150%, normal input from mouse-only dash/special clicks, and both ASSIST badges. Artifacts/harness stay ignored under shots/.

## Validation

The casual implementation is validated; repository-wide unit failures outside this lane remain an integration blocker.

- `npm run typecheck` and `npx vite build` pass on the final source; Vite reports its existing large-chunk advisory.
- Final `npm test`: **103 of 108 test files pass**, including `casual.test.ts` and `settings.test.ts`. Five pre-existing failures remain: `eightp.test.ts`, `followups.test.ts`, `i18n.test.ts`, `raceCoop.test.ts`, `spectateCoop.test.ts`. Each fails the same assertions in an isolated archive of starting commit `2bb9eed`. The full repository unit gate is therefore **not green**. Final log: `/tmp/casual-alltests-final.log`; baseline reproductions: `/tmp/casual-baseline-{eightp,followups,i18n,raceCoop,spectateCoop}.log`.
- Focused casual and settings suites pass, including the final mouse-only controls. Casual coverage includes defaults/migration, speed, online/PvP/race gates, sticky eligibility, exact damage reduction, i-frames, pooled bullet behavior, wall-aware targeting, click cancellation, automatic-dash budgets/landing timing, mouse actions, real local co-op controllers, achievements and score/history banking.
- `npm run smoke` passed all nine heroes, game modes, training, local co-op, race/challenge and mortal game-over/history checks with no runtime errors.
- Offline browser co-op: `npm run coop -- --offline --angle metal` passed the full 80-second scenario plus lobby/restart/reconnect checks. 1,889 snapshots, average 1,397 B, maximum 11,076 B, none above 16 KB; sent/received skill events match. Offline signalling uses the existing harness, and actual WebRTC channels still carry the game. No external broker/API used.
- Performance: `npm run bench -- --gpu metal --seconds 20 --warmup 8` using the heavy scene at HIGH/1280×720. Compare the same link with `&onestick&assists=dash,iframes,damage,bullets,magnet&gamespeed=100`. Each sampled 1,230 frames at a 16.67 ms frame interval. Off/on: simulation 0.78/0.78 ms; frame callback CPU 2.82/2.72 ms; p95 CPU 3.31/3.13 ms. Including asynchronous clip callbacks: 3.67/3.54 ms. Average enemies 318/316 and bullets 519/519. No measured regression; random combat is not a bit-identical workload. Files: `shots/casual-bench-{off,on}.json`.

## Limits and integration risks

- Click-to-move heads directly toward the clicked point and respects wall collision; it does not pathfind around cover. Click another point if obstructed.
- Auto-dash is limited help, not guaranteed safety. It recognizes the shared warning families listed above, not every bespoke boss/world-event telegraph added by other lanes. Permanent floor hazards and ordinary contact are not automatic-dash triggers.
- Native hardware/controller and individual accessibility play-testing remain useful beyond synthetic controllers and browser automation.
- The full unit gate has existing integration failures in the starting commit `2bb9eed`, reproduced independently from a `git archive` checkout without casual changes: `eightp.test.ts`: its harness accesses a null client (`lastHeard`); `followups.test.ts`: its shield assertion expects two bullets but retains four; `i18n.test.ts`: its existing catalog lacks the current shield description; `raceCoop.test.ts` still expects the old four-player co-op cap; `spectateCoop.test.ts` likewise assumes a fifth player must become a spectator and then fails its dependent roster/reconnect assertions. These are outside this lane's owned files. Do not describe the entire repository suite as green until the lead resolves them.
