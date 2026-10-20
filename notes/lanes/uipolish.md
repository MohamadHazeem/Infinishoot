# uipolish lane: final UI consistency pass

## What players get

- **No more HUD panels on top of each other.** One layout pass (the *HUD dock*, `src/ui/hudLayout.ts`) places every corner panel: goals stack, teammate rows, network panel, roles panel, pet panel, TEAM meter, style meter, Halloween candy line, voice chip, Versus foe card, local co-op player cards, radio/band chips, weather chip, secrets hint, pop-in portraits, toasts, first-time tips. Each lane's CSS spot stays; a panel that would cover an earlier one in the list slides to the nearest free spot on its own side (top panels down, bottom panels up). It measures real screen boxes, so it works at every UI SCALE (75-150%), window size, language and with touch controls.
- **Toasts wait their turn.** A FIRST STEPS tick, an achievement and an elite warning used to replace each other instantly and could land on top of the STAGE / NIGHT RAID title card or a boss intro. Toasts are now queued: one at a time, at least 1.2 s each when others are waiting, repeats dropped, never shown while a title card (big banner, boss intro letterbox, cinematic reveal) is up, stale ones dropped after 12 s. Toasts still drop below the boss bar while a boss is up.
- **Halloween candy line** is a framed chip that sits just above the weapon slots (it used to overlap them bottom-left) and hides under menus with the rest of the HUD.
- **SETTINGS has one HELP.** The replay/crash-log HELP moved into the desktop HELP screen as REPLAYS & CRASH LOGS (its BACK returns to HELP). Footer: MODS · RESET TAB · HELP · BACK.
- **Menus fit at 1280x720.** Title activity cards (training offer, FIRST STEPS, Trick-or-Treat, quests) flow into two columns instead of running off the bottom; the TAKE THE HERO hint moved to the bottom centre (it covered the Halloween booth); LOADOUT keeps each slot on one row so START/BACK show; PLAY SOLO fits on one screen (one hero row, compact mode cards); LEVEL UP cards shrink a little so REROLL/SKIP show.
- **Back behaviour and prompts.** Every BACK button gets the back prompt (also German "ZURÜCK" in SETTINGS, matched by `data-act$=back` / `data-settings-back`) and stays the last button of its row (STORY no longer lands under EXTRAS' BACK; TRIALS after Play Online's BACK). SEASON / PROFILE / ACHIEVEMENTS opened from the title go back to the title, not EXTRAS. The LOADOUT SPECIAL label shows the real bound key / pad button (`prompt('bomb')`) instead of a hard-coded "Q/E".
- **Long languages.** Card slot ribbons stay on one line in DE/FR/ES/PT/TR (AUTOMATISCHE WAFFE wrapped under the pick bar).
- **Arabic (RTL).** Style meter and roles panel follow score/combo to the left; network panel and candy chip follow goals/loadout to the right; on phones pause and score no longer sit on the mirrored face and life bar, and the goals stack starts under the phone minimap. Elite bar names/details are localized at display.
- **Phones (844x390).** Side panels shrink (goals x0.8, others x0.72 of UI SCALE), toasts are smaller, the life/XP bars hide under menus (they hit the headings), the TAKE THE HERO hint hides, title tips sit bottom centre.
- **Palette.** Off-palette colours in the spectate cards, the arena editor backdrop and the FIRST STEPS special chip mapped to Sweetie 16.

## Tuning

- `dockTuning` (src/ui/hudLayout.ts): `every` 0.1 s between passes, `gap` 6 px between panels, `rescan` 1 s between selector scans (panels appear lazily). Moving against a panel's own side costs 6x the distance; covering an anchor (life, clock, sticks, buttons) counts 4x when nothing is free.
- `toastTuning` (src/ui/toastQueue.ts): `minShow` 1.2 s, `maxQueue` 4, `maxWait` 12 s.
- Dock order (`HUD_DOCK`): anchors first (XP bar, face, life, run info, clock, pause, score, weapon slots, meters, minimap, boss bar, touch sticks/buttons), then left column, right column, bottom row, top-middle banners and toasts, then the extra left panels and tips last (they take what room is left).

## How it works

- `resolveDock(boxes, n, gap, viewH)` is pure (unit-tested): for each movable box in order it keeps its CSS spot if that covers nothing earlier, else scores the spots right above/below every box it could touch plus the view edges, and takes the least-covered, nearest one.
- `HudDock.tick(dt)` runs from `Hud.update`; the measuring runs in a `setTimeout(0)` task right after the frame is painted, when layout is clean, so it never forces a synchronous layout inside the game frame. The nudge is the CSS `translate` property (divided by `currentCSSZoom`), so lanes' own `transform` animations keep working.
- `Hud.toast()` goes through `ToastQueue`; `titleCardUp()` checks `#banner.show`, `#bossintro`, `.cn-reveal` and `.cinematic` only while a toast is waiting.
- New corner panel: add its selector and side to `HUD_DOCK`, and to the UI SCALE selector list at the top of hudLayout.ts.

## Performance

`npm run bench -- --gpu metal` (heavy scene, HIGH): game.render 1.03 ms, CPU at 1 step/frame 3.90 ms, style+layout 0.97 ms, versus 1.01 / 3.86 / 0.96 on the untouched base (a8d0b2e) in the same session. A first version that measured inside the frame read 1.19 ms avg / 2.20 p95 for game.render; the after-paint task fixed that.

## Files

- New: `src/ui/toastQueue.ts`, `tests/uipolish.test.ts`, this note.
- `src/ui/hudLayout.ts`: dock, CSS for the candy chip, menu-hiding of lane panels, UI SCALE list additions, 720p/phone/RTL/long-language menu and HUD rules.
- Small edits: `src/ui/hud.ts` (toast queue + dock tick, elite names localized), `src/ui/menu.ts` (BACK prompt/order, title shortcuts), `src/ui/screens.ts` (SPECIAL prompt), `src/ui/storyScreen.ts` (STORY before BACK), `src/platform/help.ts` + `src/game/systems/ci2.ts` (one HELP), `src/ui/spectateUi.ts`, `src/ui/editorScreen.ts`, `src/ui/firstten.ts` (palette), `src/i18n/*.ts` (`replay.menu` in all 7 catalogs).

## Test links (all checked at 1280x720, 1920x1080 and 844x390)

```sh
# everything at once (stress): teammates, network, pet, style S, roles, candy, voice
npm run shot -- "?test&bench&god&mate&netdemo&pet=sparky&petlv=2&style=S&spawn=shooter:4&season=halloween&stage=2&heroes=4&voicedemo&weapons=drones:3,aura:2&ui=125" shots/uipolish-busy.png --wait 7
npm run shot -- "?test&season=halloween&stage=2&candy&god&seed=42" shots/uipolish-candy.png --wait 5
npm run shot -- "?test&stage=2&god&seed=42" shots/uipolish-toast-banner.png --wait 1.6   # NIGHT RAID card, FIRST STEPS waits
npm run shot -- "?test&screen=settings" shots/uipolish-settings.png --wait 5
npm run shot -- "?test&screen=modes" shots/uipolish-modes.png --wait 5
npm run shot -- "?test&lang=de&levelup" shots/uipolish-levelup-de.png --wait 8
npm run shot -- "?test&lang=ar&god&mate&netdemo&pet=sparky&style=S&season=halloween&stage=2" shots/uipolish-ar.png --wait 9 --size 844x390
```

Before/after PNGs of these are in `shots/uipolish/` (gitignored; `before-*` from the base build, `after-*` from this branch).

## Validation

- `npm run typecheck`, `npx vite build`: pass.
- `npm test`: `tests/uipolish.test.ts` passes (tonight's overlaps, 200 random panel columns at UI SCALE 75-150%, toast queue, Hud banner/toast order). The i18n DOM-write scanner failure (`hud: unlocalized DOM write: t.name ?? ''`) present on the merged base is fixed. Six test files fail identically on the untouched base a8d0b2e and on this branch (not caused by this lane): eightp (`lastHeard` of null), elites2 (Arabic guides missing), followups, raceCoop and spectateCoop (player caps), seasonpass (season names not translated).
- `npm run smoke`: passes.
- `npm run coop` was not run: nothing online changed (toasts and the dock are local presentation; the toast queue also applies to toasts replayed on clients).

## Unfinished / risky

- In the deliberate stress combo (4 teammates + objective + Night Raid intel + buddy link + network panel + voice chip + tip + candy) the left column is taller than a 720p or phone screen at 125%+. The dock then picks the least-covering spot (never the life bar/face), but some panels still overlap. Real games rarely show all of these at once; a further step would be to collapse the goals stack (e.g. teammate rows to one line) when it gets tall.
- The dock only moves panels vertically. Panels on the wrong side of the screen for a layout (e.g. a lane adding a new right-column panel) still need a CSS spot.
- Gamepad focus order on screens whose BACK is moved to the end follows the DOM, so BACK is now also last in pad navigation (intended).
- Not checked on real phones or with a person; screenshots only (headless Chromium, swiftshader).
