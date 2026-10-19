# HUD lane

> **Merge note (v1.6.0 merge):** main's WEATHER setting replaced this lane's (it also covers lightning and rain sounds); the level badge sits right of main's HUD face. DAMAGE NUMBERS: MINE travels through main's binary effects bus (src/net/fxCodec.ts, type byte bit 7).

## Player-facing changes

- Combo numbers pop on every visible increment, ramp from white through lime/cyan/gold/orange, shake on crossed ten-kill milestones, and retain the lost combo during a stepped break animation.
- Damage numbers arc, pop and grow with damage. Crits bounce in gold; fire, shock, frost, healing and shields have distinct colours/markers. Rapid nearby hits of the same kind merge, using the existing fixed DOM pool.
- Level-up screens open with a pixel diamond burst and staggered bouncing cards. Rare/legendary cards retain their rarity rings/glow and gain a shine sweep. A detached picked card flies away while the actual pick is applied immediately, including on clients.
- XP fill eases with a sparkle at its head. HP damage leaves a white trailing chunk; low HP pulses. Gold gains roll up, spending updates immediately. Boss bars enter with a bounce and sit below the stage label. The last ten seconds emphasize the clock and stage.
- Title letters bounce in, the dither backdrop drifts, menu screens wipe in, and buttons lift/press. Mouse, keyboard and gamepad selection share one UI-bus sound; pointer navigation now also sounds.

## Tuning and decisions

- Combo colour thresholds: 10 / 25 / 50 / 100. Pop: 180 ms; milestone shake: 300 ms, multiplied by the existing shake slider. Break: 650 ms.
- Damage pool: 48 elements; life: 800 ms. Merge window: 140 ms, radius: 0.35 world units, height tolerance: 0.25; same style only. Merging never extends the original lifetime. Size is logarithmic, capped at 1.65× before the pop and per-style font size.
- HP damage hold: 220 ms, then catch up at 1.4 full bars/sec. XP/gold exponential approach rates: 14/sec. Level changes snap XP to the new level; new runs reset counter/health animation state.
- Cards enter in 420 ms, staggered by 70 ms. Pick fly-away: 380 ms; unconditional cleanup at 420 ms. No added gameplay lock or network delay.
- This checkout has OS `prefers-reduced-motion` and an in-game **Reduce flashes** switch, but no separate motion switch. Both now suppress the new UI motion, particles/reels, shine and burst; counters snap and low-HP feedback stays static. The cached media query still follows live preference changes. Existing volume buses are reused.
- Elemental/shield labels use the existing string-valued effects event, e.g. `42 FIRE`; the UI displays `42` in the appropriate style. No snapshot/event schema changes; old clients can still display the readable label. Crits retain their gold style. Only already-visible hit events are styled; silent damage-over-time ticks remain silent.
- Decision log is kept here instead of editing shared PLAN.md, per the lane ownership constraint.

## Files

Owned files: `src/ui/hud.ts`, `src/ui/damageNumbers.ts`, `src/ui/screens.ts`, `src/ui/menu.ts`, `src/style.css`, `tests/hud.test.ts`.

Minimal shared hooks: `src/game/systems/combat.ts` adds the cosmetic elemental/shield label; `src/game/systems/levelUps.ts` adds one local pick-effect call before the existing host/client action path. No settings rows, gameplay tuning, dependencies or generated assets changed.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: all five test files, including HUD easing, thresholds, pooling/merging/expiry, real effects-bus replay, HP/max-HP updates, reset behaviour, accessibility, shake slider and menu sound tests.
- `npm run smoke` passed through standard/endless/bossrush/daily and mortal game-over runs.
- Captured and inspected `shots/hud-combat.png`, `hud-boss.png`, `hud-title.png`, `hud-feedback.png`, `hud-combo-break.png`, `hud-levelup.png`, `hud-pick.png`, `hud-reduced-motion.png`, `hud-small.png`. Screenshots and the local Playwright review harness remain ignored.
- Browser checks confirmed a pick returns immediately to fight mode, the detached card is removed, and OS reduced motion produces zero running CSS animations with no burst or logo movement. The 800×600 card screen remains scrollable.

## Limits / integration notes

- The existing number event has no enemy ID. Merging is conservatively positional: extremely close enemies of the same height/style can share a number, and a fast-moving enemy can get separate numbers. Exact identity merging would require extending the shared effects event; this lane deliberately preserves that contract.
- No live two-browser PeerJS session was run. The test does exercise recorded host number events through JSON serialization and client `Vfx.apply`, and the pick hook runs before the existing role branch.
- No unfinished implementation beyond the positional-merging limitation above. No new test-link options.

Reproduce the standard captures:

```sh
npm run shot -- "?test&stage=2&weapons=drones:5&god&seed=42" shots/hud-combat.png --wait 4
npm run shot -- "?test&stage=4&boss&god&seed=42" shots/hud-boss.png --wait 4
```

---

## Round 2: cleanup, button prompts, HUD settings, touch

This round is about clearing up the screen, showing the right button for your device, and four new settings.

### What players get
- **Level badge.** The level now sits in a framed LV badge that hangs under the left end of the XP bar, in big numbers. Before, it was the smallest text on screen, inside the thin bar. Life and the kills/gold/gears row moved right to make room. The badge pops when you level up.
- **Goals stack (top left).** One column holds, from top to bottom: teammate bars (co-op), the stage objective, the stage event ("STAGE EVENT / GOLD RUSH 18"), the side challenge ("★ DEFEAT 2 ELITES 0/2"), power-ups (FRENZY / OVERDRIVE) and the spectate line. Event and challenge lines no longer sit in the middle above the hero. In co-op the teammate bars used to overlap the objective panel; now they stack. Countdown lines only change their text, so they don't slide in again every second.
- **Style meter from C up.** At rank D (the resting state) the meter is hidden. It slides in when you reach C. After a drop back to D it stays up for 0.6 s so the drop shake can be seen, then hides. Feed notes earned while hidden aren't queued.
- **Button prompts follow your device** (src/ui/prompts.ts):
  - **Keyboard and mouse:** keycaps that follow your rebinds (SPACE, Q, V...), and a pixel mouse with the left or right button lit.
  - **Gamepad:** pixel-art glyphs. Xbox is the default (green A, red B, blue X, yellow Y; LB/RB/LT/RT/LS/RS/VIEW/MENU caps). PlayStation pads get cross, circle, square and triangle plus L1/R1/L2/R2/L3/R3/SHARE/OPTIONS. A pad counts as PlayStation when its Gamepad id mentions vendor 054c, Sony, PlayStation, DualShock, DualSense or PS3/4/5.
  - **Touch:** no prompts (the on-screen buttons are labelled).
  - **Where they show:**
    - a tab on each HUD meter (DASH, special, ULT);
    - the title-screen controls line (one chip per action);
    - level-up card keys: 1/2/3 on keyboard; on a pad only the focused card shows A or cross;
    - the reroll button;
    - the SPECIAL slot label on cards and tooltips ("SPECIAL Q/E", "SPECIAL RB", "SPECIAL R1");
    - a gamepad legend on the CONTROLS screen;
    - the co-op spectate line ("CLICK TO SWITCH" or "A TO SWITCH");
    - a menu hint, gamepad only: "A SELECT · B BACK" bottom right while a menu is open.
- **New settings** (SETTINGS screen, saved, old saves load with the defaults):
  - **UI SCALE** 75 / 100 / 125 / 150% (default 100). It zooms the HUD panels and menu contents with CSS `zoom`. Things pinned to the world (name tags, elite bars, pointers, damage numbers) aren't zoomed, and neither is the SETTINGS screen itself, so the slider doesn't move under the pointer while you drag it.
    - Scaling up is capped by the window so the top row never overlaps: 1280x720 allows 120%, 1920x1080 allows the full 150%.
    - Windows under 760 px wide shrink the HUD a little (640x480 gives 84%, never under 75%).
  - **DAMAGE NUMBERS** ALL / MINE / OFF (default ALL). MINE shows only your own hero's hits, for co-op. OFF hides hit and crit numbers but keeps labels (PERFECT!, COMBO!, heals, damage you take).
  - **WEATHER** ON / OFF (default ON). It hides the weather motes (rain streaks, snow, pollen, sand, embers) and the rain's ground splashes and ripples. It changes visuals only: rain still darkens the sky, lightning still flashes (REDUCE FLASHING softens it) and the rain still sounds.
  - **CHARGE MODE** HOLD / TOGGLE (default HOLD), an accessibility option. In TOGGLE, press right click (pad X, touch R-CLICK) once to start charging or firing and again to let go. Weapons only ever see "held or not" (`ctx.charging`), so every right-click weapon, the netcode and the dev bot work unchanged.
- **Touch.** The PARRY and ULT buttons were already there (feeding `Input.virtual` buttons 1 and 10). Now the ULT button fills with the ultimate's charge and glows yellow and hops when ready. PARRY got its own colour, and the off-palette `--purple` fallback is gone.

### Netcode
- DAMAGE NUMBERS MINE needs to know whose hit a number is. `Vfx.num(x, y, z, value, kind, by?)` now takes the hero index. `Game.damage` passes `by.index` for hit and crit numbers. The recorded `'n'` event gets `by` as an optional 7th element, only when it is set.
- Old 6-element events (older hosts) decode unchanged and always show, and older clients ignore the extra element. No codec or snapshot changes. tests/hudLane.test.ts covers the new and old event shapes.

### Tuning knobs (debug panel > HUD)
- `uiScaleTuning` (src/ui/hudLayout.ts): `min` 75, `max` 150, `fitW` 950 / `fitH` 600 (CSS px per 100% when capping upscales), `tinyW` 760 / `tinyMin` 0.75 (shrink for tiny windows).
- `styleHudTuning.linger` 0.6 s (src/ui/styleMeter.ts).
- Debug-only: prompt override (`promptState.force`), damage-number mode and life, life-chunk hold.

### Test links (new options)
- `pad=xbox|ps|kbm|touch` forces the prompt style. `ui=125` sets UI scale. `dmgnums=mine|off`, `charge=toggle`, `noweather`. `levelup` (or `levelup=2`) opens a level-up after 1 (2) s. None of them are saved.
- Examples:
  - `npm run shot -- "?test&god&pad=ps&levelup=2" shots/x.png --wait 6`: PlayStation glyphs on the level-up screen.
  - `npm run shot -- "?test&god&pad=xbox&ui=150&event=goldrush" shots/x.png --size 1920x1080`.
  - `npm run shot -- "?test&god&screen=controls&pad=xbox" shots/x.png`: the pad legend.
  - `npm run shot -- "?test&swarm&time=150&god&style=B" shots/x.png --wait 6`: the busy HUD from the brief.

### How I verified
- `npm run typecheck`, `npm test` (all files, including the new tests/hudLane.test.ts with 46 checks) and `npm run smoke` (every mode and hero, plus the mortal run) pass.
- **Screenshots I looked at:**
  - The busy HUD (`swarm&time=150&style=B`) before and after.
  - Event and challenge panels in the goals stack (`event=goldrush`, `event=fog`).
  - Style meter hidden at D and shown at B/C/A/S.
  - Co-op: two fake teammates (one downed), a revive tag and the YOU'RE DOWN panel. I patched `hud.setTeam`/`setDowned` through `window.game`, because a test link can't make teammates.
  - Boss fight at UI 125% on 1280x720.
  - UI 150% at 1920x1080 with Xbox prompts.
  - UI 75% at 800x600.
  - 640x480 with Xbox prompts.
  - Level-up with PlayStation glyphs, and keyboard keys with the reroll prompt.
  - SETTINGS (top and scrolled to the new rows), SETTINGS at 150% on 1920x1080.
  - CONTROLS with the Xbox legend.
  - Title controls line with keyboard and PlayStation prompts.
  - Touch layer with the ULT button ready.
  - Zoomed crops of the glyph sprites.
- **In-page checks through `window.game` / `botAuto`:**
  - CHARGE MODE TOGGLE: one right click sets `ctx.charging` and it stays on; the next click clears it.
  - WEATHER OFF: the mote count is 0 in the rain, against 47 with it on.
  - DAMAGE NUMBERS OFF: no hit numbers while the bot fights, against a steady stream with ALL.

### Unfinished / risky
- **MINE in a real two-machine game is not tested.** The host side passes `by.index` and the effects bus carries it; unit tests replay recorded events through a client `Vfx`. I didn't run `npm run coop`.
- **CSS `zoom`.** It is standard in Chromium/Electron (the shipped builds) and in current Firefox and Safari. Older browsers ignore it, so UI SCALE does nothing there.
  - Zoomed panels keep their anchors (top-left, top-right, centred), so panels from other lanes that are added later need adding to the zoom list in hudLayout.ts to scale too.
  - The level-up pick "ghost" card isn't zoomed. At 125% and more it is drawn at the card's real size, but its contents look slightly smaller for its 0.4 s fly-away.
- **Pad glyph choice for shared buttons.** The HUD shows one button per action: dash LB (A and LT also dash), special RB (Y too), ultimate RS/R3 (LS and D-pad up too). The CONTROLS legend lists them all.
- **Touch-screen laptops:** once the touch controls have appeared, prompts stay hidden until a real pad connects, because taps also fire mouse events.
- **Other lanes:** onboarding (tutorial) and sound (captions) can use `prompt(id)` / `promptText(id)` from src/ui/prompts.ts to show the right button. Ids are the rebindable actions plus `move`, `aim`, `fire`, `charge`, `confirm`, `back`, `switch`.
- **Shared-file merge points:**
  - game.ts: one import, `rightClickHeld`, and `dmg.localHero`.
  - netClient.ts: one import and `rightClickHeld`.
  - combat.ts: `by.index` on the two hit-number calls.
  - spice.ts: the spectate hint text plus an import.
  - screens.ts:
    - settings rows (WEATHER after NIGHT STAGES; UI SCALE, DAMAGE NUMBERS, CHARGE MODE before CONTROLS...);
    - the `data-cycle` handler and sync;
    - `data-unit` in `rangeLabel`;
    - the title controls line;
    - the CONTROLS pad legend;
    - the level-up key and reroll prompt.
  - settings.ts: 4 keys, `applyUiScale`, `fxQuality.weather`.
  - ambience.ts: the `fxQuality.weather` gate on motes and rain ripples.
  - main.ts: `syncPrompts`.
  - testLinks.ts: one `hudLinks(game, q)` call and 2 doc lines.
  - debugPanel.ts: `addHudFolder`.

### PLAN.md decision-log paragraph
- 2026-10-19: HUD cleanup, button prompts and HUD settings (HUD lane, notes/lanes/hud.md, round 2).
  - The level moved out of the thin XP bar into a big LV badge under its left end.
  - Teammate bars, the objective, the stage event, the side challenge and power-ups share one goals stack top left. Event and challenge lines left the screen centre, and the co-op teammate bars no longer overlap the objective.
  - The style meter hides at rank D and slides in from C.
  - Button prompts follow the last used device: keycaps that follow rebinds, or pixel-art Xbox / PlayStation glyphs picked from the Gamepad id (Sony vendor 054c, DualShock, DualSense), or none on touch. They show on the HUD meters, the title controls line, level-up keys, reroll, the SPECIAL label, a CONTROLS-screen pad legend and a pad-only menu hint.
  - New settings:
    - UI SCALE 75-150%: CSS zoom on HUD panels and menus, capped so the top row fits (1280x720 allows 120%) and trimmed on windows under 760 px.
    - DAMAGE NUMBERS ALL / MINE / OFF: number events carry the hitting hero's index as an optional 7th element; old events still decode.
    - WEATHER on/off: visual only.
    - CHARGE MODE HOLD / TOGGLE: a latch in front of `ctx.charging`, so weapons, netcode and the bot are unchanged.
  - The touch ULT button shows the ultimate's charge.
