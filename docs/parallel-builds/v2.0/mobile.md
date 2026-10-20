LANE: mobile — phones and tablets

1. Phone-sized UI: every screen and the HUD usable at 390x844 portrait-locked-to-landscape (and 844x390 landscape): bigger tap targets, compact HUD, cards that fit, no horizontal scrolling; check with screenshots at phone sizes (npm run shot -- ... --size 844x390).
2. Touch layout editor: SETTINGS > CONTROLS > TOUCH LAYOUT lets the player drag and resize the sticks and buttons (dash, right click, special, parry, ult, rewind, team move, cash-in), saved locally; opacity setting; auto-hide unused buttons.
3. Installable web app (PWA): manifest, icons, a service worker that caches the game for offline play (versioned so updates apply), fullscreen display, landscape orientation; works on GitHub Pages under its base path.
4. Performance on phones: AUTO quality starts lower on mobile; battery saver option (30 fps cap).
Owns: src/ui/touch.ts and a new src/ui/touchEditor.ts, public/manifest.webmanifest + service worker, index.html (small), mobile CSS injected from module, tests/mobile.test.ts.
