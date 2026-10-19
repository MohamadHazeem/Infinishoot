# Settings lane — settings and accessibility

## What players get

- SETTINGS has VIDEO, AUDIO, CONTROLS, GAMEPLAY, ACCESSIBILITY and CO-OP tabs. Q/E, LB/RB, tab buttons, keyboard arrows and touch switch categories. Up/down navigates rows; left/right adjusts sliders. Tab/Shift-Tab supports real DOM focus. Screen regions and controls have accessible names, current values and focus descriptions.
- RESET TAB restores only the active category. Key bindings retain their existing separate reset in REBIND KEYS. All old settings keys and valid saved values are retained, including the legacy alternative bullet palette. TIPS and RESET TIPS remain available under GAMEPLAY; ANIME LOOK moves into VIDEO. Existing host rules are exposed under CO-OP, with descriptions that identify them as host rules.
- Colour vision assistance: OFF / PROTANOPIA / DEUTERANOPIA / TRITANOPIA. A single local SVG colour matrix filters the completed scene and DOM together, so enemy bullets, telegraphs, elite glows, team markers/names, rarity labels/cards and future lanes' colour cues are all covered. Neutral greys/white remain neutral. These are assistance palettes, not simulations of impaired vision.
- TEXT SIZE is independent of UI SCALE: 100 / 125 / 150%, default 100. It adjusts stylesheet font sizes, including later injected lane styles, without zooming boxes or icons. Relative `em` sizes inherit enlarged text instead of multiplying the scale again. Settings remains scrollable at 640×480 and 360×640 with 150% text; wrapped rows grow without overlapping.
- REDUCE SCREEN EFFECTS defaults OFF. ON disables camera shake/kicks, screen distortion, motion streaks and anime speed lines, and enables the existing reduced-flash/UI-motion path. It also covers enemy-family and gameplay HUD flashes. Individual preferences are retained and restored when the master is turned off. Auto quality cannot turn streaks back on while it is enabled.
- AIM ASSIST defaults ON for gamepad/touch; MOUSE AIM ASSIST is a separate opt-in, default OFF. It gently bends deliberate aim toward the nearest living, visible enemy inside the aim cone, skipping targets behind walls, spawning/burrowed enemies and hidden PvP proxy enemies. Cursor targeting distance is preserved.
- CHARGE MODE retains HOLD / TOGGLE. Charge latches are now per input/controller, so local co-op players cannot toggle one another's charge. Opening a menu cancels latched charge. Touch button release and controller disconnect clear stale held buttons.
- DASH-RUN MODE: HOLD (default) repeats dashes while held; TOGGLE presses start/stop repeating. Existing dash stocks, cooldowns and direction rules still apply. Menus/death/stage changes cancel the latch.
- REWIND MODE and TEAM MOVE MODE: TOGGLE (default) preserves the existing single-press action. HOLD requires a 350 ms confirmation and fires once until released. This interpretation preserves the one-shot nature of rewind/team moves instead of inventing a sustained gameplay ability. The team key still buys a revive when downed; the spectate button remains available.

## Tuning and co-op

`aimAssistTuning` in `src/game/systems/aimAssist.ts`: range 12 m, cone 25°, blend 0.28, confirmation hold 0.35 s. Aim is corrected after reading the local aim direction and before the existing input packet is sent. No new snapshot fields, effects or network messages are needed. Remote heroes never read this machine's accessibility settings. Local co-op controllers have independent action/charge latches.

All new settings are local preferences. Existing CO-OP host-rule settings retain their original semantics. `settings.v1` still uses the storage helper's default merge; profile/save format is unchanged. Defaults are exported once as `SETTINGS_DEFAULTS` for reset and migration consistency. There are no new dependencies, audio assets or external API integrations.

## Files and integration hooks

Owned implementation: `src/ui/settingsScreen.ts`, `src/game/settings.ts`, `src/render/colorblind.ts`, `src/game/systems/aimAssist.ts`, `tests/settings.test.ts`.

Small required integration edits:

- `src/ui/screens.ts`: removes old settings markup/handlers; registers the external screen and forwards its show/update hooks. `addScreen` accepts an existing MenuNav. Gives menu regions accessible names.
- `src/core/input.ts`, `src/core/padInput.ts`: injected local action presses and consumption; virtual/disconnected buttons release correctly.
- `src/game/chargeMode.ts`: isolates charge latches by input.
- `src/game/game.ts`: prepares accessible input before action consumers; applies local aim assistance.
- `src/game/systems/netClient.ts`, `localCoop.ts`: matching local aim/input hooks for online clients and extra local controllers.
- `src/game/systems/look.ts`, `graphics.ts`, `render.ts`, `gameplay.ts`: one-line effective reduced-effects gates.
- `src/dev/testLinks.ts`: settings visual/performance options.
- `scripts/coop-test.mjs`: optional `COOP_LOAD_TIMEOUT` for slow dev-server page loads; default remains 30 seconds and gameplay/desync assertions are unchanged.

No `style.css`, renderer shader, save schema, network codec or gameplay balance edits. Decision log is here rather than shared PLAN.md, following lane ownership.

## Test links

- `?test&screen=settings&settingstab=0` (0 VIDEO, 1 AUDIO, 2 CONTROLS, 3 GAMEPLAY, 4 ACCESSIBILITY, 5 CO-OP).
- `?test&screen=settings&settingstab=4&textsize=125`.
- `?test&screen=settings&settingstab=2&textsize=150&pad=xbox` at 640×480.
- `?test&stage=2&weapons=drones:5&elite=charger:shielded&vision=deuteranopia&god`.
- `vision=off|protanopia|deuteranopia|tritanopia`, `textsize=100|125|150`, `reduceeffects`, `assist=off|on` are unsaved test-link options.

Example: `npm run shot -- "?test&screen=settings&settingstab=4&textsize=125" shots/settings-accessibility.png --wait 4`.

## Validation

- `npm run typecheck`: passed.
- `npx vite build`: passed (existing large-bundle advisory only).
- `npm test`: all 57 test files passed, including the new settings suite and existing onboarding/co-op suites.
- `npm run smoke`: passed on final input code through all modes/heroes, training, local co-op and mortal game-over/history checks.
- Browser assertions passed: Enter changes a setting exactly once, Q/E and native Tab focus work, text grows from 21 px to 31.5 px while a panel stays 856 px wide, onboarding tips toggle/reset still work, only one tab panel is visible/navigable, small-screen scrolling works, and the effects master disables distortion/speed lines while enabling reduced flashes.
- Captured and inspected `shots/settings-final.png` (ACCESSIBILITY at 125%), controls at 640×480 / 150% text including the scrolled end, gameplay colour captures for all three modes, and the stage-2 shielded-elite/drone scene. Early captures caught the shared CSS overriding `[hidden]`; the explicit hide rule fixes it. Immediate tab-switch captures can catch the existing 240 ms menu-entry animation; settled captures use `--wait 4`.
- `npm run coop`: the full default 80-second scenario passed using Chromium's hardware Metal backend, including boss phases, jump-pad acceptance during combat, finishers, ping, team moves, ultimate, down/revive and stage progression. 1,564 snapshots, average 1,851 B / maximum 13,374 B, none above 16 KB; effect send/receive counts matched. Default viewport and 30-second navigation timeout were retained.
- `npm run bench`: heavy stage-5 scene with 200 added enemies, held population 170 + 24 spinners + 12 bursters, and 500 bullets, measured for 20 seconds after 12 seconds warm-up on Metal. Both configurations averaged **2.58 ms CPU/frame**, with a **16.67 ms frame interval**. Assistance off: simulation 0.72 ms, render 0.88 ms, GL 0.99 ms, total p95 3.36 ms, 270 average enemies / 495 bullets. Assistance on plus deuteranopia correction: simulation 0.68 ms, render 0.86 ms, GL 1.03 ms, total p95 3.27 ms, 272 enemies / 492 bullets. Hero/skill work was 0.026 → 0.039 ms; no observed overall CPU regression.
- Validation backend caveat: default software SwiftShader suffered multi-second GL stalls and startup timeouts on this machine; an isolated pre-lane checkout also timed out loading. Earlier software co-op runs failed startup or a jump-pad/level-up timing check. Hardware Metal completed the full unchanged assertions. Renderer verified as `ANGLE Metal Renderer: Apple M5 Pro`. Reproduce using `SHOT_CHROME` pointing to an executable shell wrapper that invokes the installed Playwright Chromium headless shell with `"$@" --use-angle=metal`, then run the normal coop/bench commands. The benchmark's printed “SwiftShader” heading is hardcoded; these reported measurements used Metal. Raw artifacts are ignored: `shots/settings-bench-metal-off.json`, `shots/settings-bench-metal-on.json`, `shots/coop/`.
- Final settled screenshots cover all six tabs (`shots/settings-tab-0.png` through `-5.png`), `shots/settings-small-final.png`, `shots/settings-small-scrolled.png` and `shots/settings-phone-final.png`. Inspected desktop audio/controls and the 360×640 / 150% phone layout after fixing flex row shrinkage. Controller prompt markup is cached between frames; its reuse has a regression test.

## Limits and integration risks

- Full-page colour correction also recolours scenery and portraits. This deliberately covers every lane's semantic cues without changing authoritative colours or editing dozens of rendering systems. SVG filtering adds compositor work; physical low-end GPU and individual colour-vision user testing remain useful beyond headless validation.
- Text scaling covers stylesheet fonts (including dynamically injected styles). Canvas-rendered text and numeric font sizes assigned directly through inline styles remain under their owning renderer's sizing rules. Very large text/UI combinations can require scrolling.
- Rewind/team HOLD is confirmation, not a cancellable rewind playback or sustained team ability. TOGGLE means the existing single-press activation for these one-shot actions; the setting descriptions make this explicit.
- Keep the explicit `.settings[hidden] { display:none }` rule: the shared `.menu` styling otherwise overrides the browser's default hidden style. Hidden panels stay mounted for onboarding compatibility, but have no `data-nav` controls.
