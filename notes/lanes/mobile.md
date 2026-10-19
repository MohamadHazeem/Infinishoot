# Mobile lane — phones, tablets and offline installation

## What players get

- Responsive menus at **844×390 landscape** and **390×844 portrait**, including English and Arabic; coarse-pointer tablets receive the same touch-sized controls. Menus scroll vertically, cards wrap, key rebinding and wardrobe grids fit the viewport, and navigation controls have at least 48 px height / 44 px width. Phone menus retain at least 100% scale for usable tap targets; HUD scale and text-size preferences still apply. The HUD has a 48 px pause button, a compact loadout/meters area, and a portrait arrangement that retains HP, level, timer and score.
- **SETTINGS → CONTROLS → TOUCH LAYOUT**. Drag either stick or any action; drag its corner to resize, or use horizontal/vertical/size sliders. Positions are normalized and clamped inside the available area. Separate portrait and landscape layouts are saved automatically to `infinishoot.touch.layout.v1`. RESET LAYOUT restores both orientations. The editor supports mouse, touch, keyboard/gamepad navigation and Arabic.
- Fixed touch sticks plus DASH, R-CLICK, SPECIAL, PARRY, ULT, REWIND, TEAM, CASH IN and REWARD (cycles the cash-in reward). This also fixes the old REWIND button sending D-pad left/cash selection: rewind now sends **12**, reward **14**, cash-in **15**, team **13**.
- **TOUCH OPACITY** defaults to **70%**, adjustable **25–100%** in 5-point steps. **HIDE UNUSED TOUCH BUTTONS** defaults ON: hides solo/PvP team actions, spent rewind, missing loadout actions, cash actions without a combo and dead-player actions. Cooldowns do not make buttons jump around. All controls appear in the editor. Touch actions release on pointer cancellation, blur, visibility changes, resize and menu opening; sticks and buttons work simultaneously through `Input.virtual`.
- Installable app manifest, **192/512 px** pixel icons, fullscreen display and landscape orientation preference. Production installs precache the entire game, including lazy chunks, bundled fonts and recorded audio, for offline solo play. Works under a GitHub Pages subpath and leaves the development server/Electron file build alone.
- AUTO starts at **rung 0 / POTATO on touch phones/tablets**, versus existing desktop rung 1 / LOW, then uses the existing governor. **VIDEO → BATTERY SAVER**, default OFF, caps rendering at **30 fps** while simulation, input and networking continue at **60 Hz**. The governor holds its current rung while capped so intentional 33 ms frames do not look like a performance failure.

## Design decisions and tuning

- Default sticks: **112 px**; default buttons: **60 px**. Resize bounds: sticks **80–160 px**, buttons **48–160 px**. Stick dead zone **18%**. A neutral aim stick does not fire. Layout edges have an **8 px** minimum inset, with live controls also respecting safe-area insets.
- Touch HUD refreshes at **10 Hz**, with no additional animation-frame loop. Render pacing is allocation-free. The fixed simulation and hidden-host worker timer retain their existing semantics.
- Layout data has its own version and deep validation. Partial/corrupt layouts fall back safely; older layout objects gain portrait defaults. Settings use the existing default merge and storage wrapper. No profile/save schema migration, network fields, effects or gameplay balance changes.
- The service-worker version hashes emitted code/assets, public asset contents and the worker itself. Installation succeeds only after all declared files cache successfully. An update waits until old game tabs close: no forced reload or mixed-version run. Activation deletes only obsolete caches for the same deployment path. APIs and outside-origin requests stay network-only. Initial precache in the checked build contained **324 files**; the full build occupied about **8.3 MB**.
- Decision log is kept in this lane file rather than shared PLAN.md to respect parallel-lane ownership. No runtime dependencies or external asset/API integrations were added.

## Files and integration hooks

Owned/new implementation: `src/ui/touch.ts`, `src/ui/touchEditor.ts`, `src/ui/mobileCss.ts`, `src/ui/mobilePwa.ts`, `src/core/mobile.ts`, `public/manifest.webmanifest`, `public/sw.js`, `public/icons/app-192.png`, `public/icons/app-512.png`, `scripts/mobilePwa.ts`, `tests/mobile.test.ts`.

Small shared hooks:

- `src/main.ts`: register the editor, wire touch state, register production PWA and supply the battery preference to the loop.
- `src/core/loop.ts`: render gate only; fixed simulation and hidden-host ticking unchanged.
- `src/game/settings.ts`: three local preferences, normalization, mobile AUTO start and capped-governor guard.
- `src/ui/screens.ts`: one extra screen ID; `src/ui/settingsScreen.ts`: settings rows, editor button and accurate rebind description.
- `src/i18n/en.ts`, `ar.ts`: additive stable mobile keys.
- `src/dev/testLinks.ts`: unsaved `&battery` option; `&touch` is handled by the mobile module.
- `index.html`: viewport safe-area support and manifest/icon/theme metadata; `vite.config.ts`: build plugin registration.

No game.ts, hero.ts, HUD implementation, shared stylesheet, snapshots, netHost/netClient, co-op test harness or save-format edits.

## Test links

```sh
npm run shot -- "?test&stage=2&weapons=drones:5&touch&god&seed=42" shots/mobile-landscape.png --size 844x390 --wait 4
npm run shot -- "?test&stage=2&weapons=drones:5&touch&god&seed=42" shots/mobile-portrait.png --size 390x844 --wait 4
npm run shot -- "?test&screen=touchlayout&touch" shots/mobile-editor.png --size 844x390 --wait 4
npm run shot -- "?test&screen=touchlayout&touch&lang=ar" shots/mobile-editor-ar.png --size 844x390 --wait 4
npm run shot -- "?test&screen=settings&settingstab=2&touch" shots/mobile-controls.png --size 844x390 --wait 4
npm run shot -- "?test&levelup&touch&seed=42" shots/mobile-levelup.png --size 844x390 --wait 4
npm run shot -- "?test&shop&gold=60&lang=ar" shots/mobile-shop-ar.png --size 390x844 --wait 4
```

`&battery` enables the cap without saving. `&touch` shows controls without a physical touch event. Editor registration also makes `&screen=touchlayout` available. The screenshot runner uses desktop pointer hints, so use real touch emulation to check mobile AUTO detection.

## Validation

- `npm run typecheck`: passed.
- `npx vite build`: passed; existing large-bundle advisory only.
- `npm run smoke`: passed, including all heroes/modes, training, local co-op and mortal game-over/history.
- `npm test`: **all 67 test files passed** in the final full-suite run.
- `tests/mobile.test.ts`: passed. Covers device detection, layout migration/validation/clamping, all action bindings, editor persistence/reset, 30 fps pacing on 60/90/120 Hz displays, actual GameLoop simulation preservation, and worker install/offline/scope/version cleanup behavior.
- Real browser input checks passed: settings opens the editor; dragging and corner resizing persist after reload; multi-touch move + aim/fire + dash works; cancellation and menu opening clear all held actions.
- A browser audit of **27 menu states × 2 phone sizes** found no visible controls beyond either horizontal viewport edge after the layout fixes. Captured and inspected phone combat, level-up, settings, title, loadout, editor and Arabic shop/editor PNGs. Scrollable menus intentionally retain full descriptions rather than truncating them.
- Production offline test at `/InfiniShoot/`: full precache, offline navigation into stage 2 with drones, lazy test chunks and recorded audio all passed. A changed worker reaches `installed`/waiting while the old controlled tab stays open; after closing it, the new version activates and removes the old cache.
- `npm run bench -- --gpu metal --warmup 12 --seconds 20`: HIGH quality, heavy meadow/night/rain, **275 enemies / 503 bullets average**, **2.33 ms CPU/frame**, p95 **3.00 ms**, **16.67 ms** frame intervals. Same range as the existing ~2 ms budget.
- Battery benchmark (HIGH, touch controls, heavy stage 5, 12 s): **271 enemies / 496 bullets**, **33.38 ms** mean render interval, **367 renders / 735 simulation steps**. CPU **3.17 ms per rendered frame** including two simulation steps, or **2.49 ms** normalized to one step. This confirms rendering halves while simulation continues at 60 Hz. Metal is a desktop GPU; these measurements are not physical-phone benchmarks.

### Co-op validation

`COOP_TIMEOUT_MS=120000 npm run coop -- --angle metal --size 844x390`: **passed**. All skill-event counts matched, including team move, revival, route vote, party restart, return to lobby and kick. **1,588 snapshots**, average **1,937 B**, maximum **11,739 B**, none over 16 KB.

An earlier stable-source run used `COOP_LOW=1` and completed every scenario except the pet fixture. Investigation found the test harness's LOW initializer replaces `infinishoot.settings.v1` on **every navigation**, so the client's invite-link reload erases its selected pet. Both this branch and unchanged base **1d3eedc** reproduce that fixture problem. The final run omits `COOP_LOW`; no game/network/test code was changed to hide it. A normal-size attempt hit the existing team-meter timing assertion after both peers successfully fired: the meter had already refilled to 2.19%, above its 2% cutoff. The unchanged-source phone run passed. A development-server attempt was invalidated by editing during the test; final runs used stable source.

## Remaining risks / integration

- Do not use the current `COOP_LOW=1` test override when validating pet persistence: it overwrites saved settings on the invite reload. Run the normal command (with Metal on macOS) or have the test-owning lane make that initializer merge existing settings.
- The initial unit run hit the existing unseeded joiner-rank assertion (7 counted picks versus minimum 8); an isolated unchanged-base run counted 8 and a current-source retry counted 9. No related gameplay changes were made. Final full-suite rerun is recorded above.
- Browser install/fullscreen/orientation behavior varies, especially on iOS. The manifest requests landscape; browsers that decline the lock get the tested portrait fallback. No physical iPhone/Android/tablet install, thermal, battery or long-session storage-eviction testing was possible here.
- Offline play requires one successful online installation/precache; co-op still requires connectivity. Updates deliberately require closing old game tabs. Browser storage policy/quota failures leave online play available.
- Arbitrary player layouts can overlap controls; reset and sliders remain available. Layouts are independent of the game profile and survive profile resets unless local browser storage is cleared.
