# Menu — first impressions

## Players get

- A clear PLAY button above UNLOCKS, EXTRAS and SETTINGS. PLAY opens solo/modes, online co-op, local co-op and training using the existing action nodes and listeners. Solo and online Back return to PLAY; closing PLAY returns home. The playable title still owns WASD/left stick, with arrows/D-pad/Enter/A reserved for the menu.
- Profile corner uses the **existing online profileLevel() formula**, with cosmetic titles at levels 1 (Cadet), 5 (Ranger), 10 (Ace), 20 (Legend). No new progression, save version or network fields.
- Live slots for the first-time training offer, FIRST STEPS quest checklist, seasonal booth and announcement. The offer takes the news slot while visible. Existing checklist rewards, seasonal purchases, scores, credits and version remain. The quest checklist uses two columns to avoid colliding with the booth.
- EXTRAS is a three-column grid (two columns on narrow phones). Menus share heading/spacing rules, pixel frames and live Back prompts. Controls are touch-sized, the layout follows UI SCALE, new strings have English/Arabic entries, and the title logo retains its Latin reading order in RTL.
- A pixel hero loading card paints **before** the main game graph downloads. Three completed milestones drive 33/67/100%: shell ready, modules/world constructed, first frame paint opportunity. Four gameplay tips rotate between loads. Import failure shows a keyboard-focusable TRY AGAIN button that reloads. The bootstrap honors saved language and `?lang=`.
- Lazy photo/debug imports and gesture-unlocked core audio show a compact non-modal loading panel only after 180 ms. Audio reporting is bounded to 4 seconds; optional samples never block play. Existing sky-fall/cloud transitions already cover synchronous stage generation, so no additional between-stage delay was added.

## Navigation audit

Hidden sections, disabled controls and inert/aria-hidden regions no longer receive menu focus. Mutation observers invalidate a menu only when its content/availability changes; normal gameplay does not scan menus. Focus follows the same surviving element after asynchronous changes, repairs after removal/hiding, and returns to the previous submenu position. Shop preview/focus indices use the same filtered set.

Hidden screens release native text-field focus. Wardrobe uses safe alignment so its heading remains reachable when its content grows. Escape/B works even on empty registered menus, and Escape leaves an editing text field. Tab uses the same focus list; native button activation and slider arrows cannot double the game's input. Game-over Back returns to title. Local co-op retains its specialized join/leave handling. Mandatory run decisions (level-up, relic, route, shop/wait) retain their gameplay rules instead of silently skipping a reward, a vote or a teammate lock.

Screens captured before/after and visually reviewed: title, pause, controls, levelup, online, loadout, relic, wait, shop, unlocks, savedata, modes, extras, history, bestiary, jukebox, wardrobe, gameover, route, heat, weekly, codex, rewards, settings, arsenal, training, halloween, localcoop, mpbrowse, teamboard, friends, party, ghostrace, ghosts and customise; plus the new PLAY and loading states. Captures are ignored in `shots/menu-before/` and `shots/menu-after/`, with contact sheets. Also checked fresh-save title, keyboard/mouse back paths, profile, Arabic/PlayStation prompts, 390×844 layout and 150% UI SCALE. No browser page errors in the UI checks.

## Files and integration

- Owned: `src/ui/menu.ts`, new `src/ui/loadingScreen.ts`, `tests/menu.test.ts`, this note.
- Small shared hooks: `src/ui/screens.ts` (PLAY registration, shell/focus hooks, parent navigation, game-over Back, EXTRAS grid navigation and shop focus mapping); `src/dev/testLinks.ts` (pinned loading QA).
- Required startup wiring: `index.html` loads the font CSS/loading bootstrap then dynamically imports main; `src/main.ts` wraps existing optional imports and observes core-audio readiness. Main remains the game loop entry and its performance marks are preserved.
- Required localization: additive `menu.*` entries in `src/i18n/en.ts` / `ar.ts`; `tests/i18n.test.ts` adds both menu modules to the existing DOM-write scanner.
- CSS is injected by the two modules. No style.css, Game/hero methods, save schemas, netcode, dependencies, secrets or external generation services changed.

## Reproduction

```sh
npm run shot -- '?test&menuload=2' shots/menu-loading.png --wait 4
npm run shot -- '?test&menuload=error' shots/menu-loading-error.png --wait 4
npm run shot -- '?test&mptitle' shots/menu-title.png --wait 4
npm run shot -- '?test&offer&lang=ar&pad=ps' shots/menu-title-ar.png --wait 4
npm run shot -- '?test&screen=play' shots/menu-play.png --wait 4
npm run shot -- '?test&screen=extras' shots/menu-extras.png --wait 4
npm run shot -- '?test&screen=play' shots/menu-phone.png --size 390x844 --wait 4
npm run bench -- --gpu metal --seconds 10 --json shots/menu-bench.json
COOP_TIMEOUT_MS=120000 COOP_LOW=1 npm run coop -- --angle metal --out shots/menu-coop
```

## Validation / integration blockers

- PASS: `npm run typecheck`, `npx vite build`, `npm run smoke`, focused menu tests and the i18n catalog/scanner tests. Build retains the existing large-game-chunk advisory. No runtime errors in the smoke run (all modes/heroes, training, Versus, local co-op, mortal run and history).
- Performance: HIGH/Metal, 10 seconds after 4 seconds warmup: **61.8 fps**, **2.58 ms total CPU/frame** (simulation 0.73, game render 0.90, GL 0.96), p95 3.51 ms; 270 average/319 max enemies, 503 average/524 max projectiles. Shared M5 Pro measurements, not a low-end hardware guarantee.
- `npm test` has baseline failures in **coop2Coop** (joiner's catch-up build gives 7 picks for team level 13), **firstten** (PUMPKING missing from enemy advice), and **halloween** (v4 migration assertion expects an older save version). Each was reproduced by bundling/running the untouched `53ba485` archive: 6 picks, same missing advice, same migration assertion. The full suite completed with exactly these three failed files. Their gameplay/test files are outside menu ownership and were not changed. Logs: `shots/menu-tests.log`, `shots/menu-baseline-{coop2Coop,firstten,halloween}.log`.
- The clean co-op run exercises host/join, invite link, ready countdown, enemies/boss/finisher, skills, revive, route voting, party restart, return to lobby and kick. Both peers agreed throughout, with 1,582 snapshots averaging 2,074 B, maximum 13,894 B, none over 16 KB. The script reports two assertions: the guest's pet is normalized to `none` instead of the fixture's `bit`, and the successful team beam has already recharged its meter to 0.021875 (the timing assertion requires less). These are recorded as test failures, not a green gate. The unchanged co-op script against the untouched archive reproduced both assertions (guest pet `none`, team meter 0.01875). An earlier run was invalidated by Vite reloading during edits and is excluded.

## Decisions / limits

No new gameplay system was needed: all work is DOM/loading presentation. The existing title demo, stage-transition animation, training offer, quests and event controls are reused. Overflow remains scrollable at large UI/text scales and on phones. New future screens still need to supply their own `onBack` when registering; the shared shell and focus repair apply automatically. New progression lanes should keep the profile-level formula shared with online player cards.

For the lead's PLAN.md decision log: menu adds a single PLAY gateway, three-column EXTRAS, existing-profile titles at 1/5/10/20, non-overlapping activity slots, and a milestone-based loading shell before the game import. Optional loading appears after 180 ms without pausing hosts. Navigation repairs hidden/async focus and restores parent focus, with localized device prompts. No gameplay/save/protocol changes; baseline test failures and performance measurements are recorded above.
