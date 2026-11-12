# hudfit lane: HUD panels fit at 720p 125/150% and on phones

## What players get

When a side column of HUD panels doesn't fit the window, it now degrades in steps, only as far as needed. Before, the dock (`resolveDock`) picked the least-covering spot and panels sat on top of each other. The stress combo: 8 heroes, objective, Night Raid intel, buddy link, network panel, voice chip, tip, Halloween candy, roles, pet panel, style meter.

1. **TIGHT.** Teammate rows go on one line. With 4 or more teammates they form two columns. The voice icon joins the row instead of hanging off its end. A downed teammate keeps a whole row and its DOWN label.
2. **FOLD.** Goal cards fold to their active line:
   - Objective and world event: title, count/timer, progress bar. Escort life stays.
   - Night Raid: header and detection meter. The hint row stays only while someone is hunting you.
   - Buddy link: no sub line.
   - Spice lines: no small heading.
   - Cards from other lanes: their first ~2 lines.

   A card opens for 3 s when its text changes; ticking numbers don't count as a change. The whole stack also opens while the pointer rests on it for 0.35 s.
3. **CHIP.** Low-priority panels shrink to small icon chips:
   - Network panel: a signal glyph plus only the rows with poor or bad ping/loss.
   - Voice chip: icon only.
   - Candy: glyph plus count.
   - Buddy link: header plus bar.
   - Pet panel: name, level and pips.
   - Roles panel: no bonus hint.
   - First-time tip: title and bar once it has been up for 6 s. Pointer over it opens it.
4. **SCALE.** The column's stacked panels zoom down 5% per level, never below 70% of the user's UI SCALE.
5. **HIDE.** This is the last resort, one step beyond the brief. If a column still overflows at the 70% floor, the network, voice, candy and pet chips hide. It only happens on phones in the stress combo: phone side panels already start at 0.72x UI SCALE (uipolish), so SCALE can't shrink them further.

Never moved or shrunk: life/face, XP, timer, boss bar, weapon slots, meters, minimap, touch controls (dock anchors).

New dock rule: **no panel may cover the middle of the field** (35-65% of the window both ways). The exceptions are the top-middle toasts and banners, listed in `DOCK_FREE`. This fixed the Arabic phone teammeter, which used to jump above the special meters onto the hero.

The network panel stays on the left in Arabic. The mirrored right column already holds the goals stack above the minimap and weapon slots; the left one has room. The combo cash-in prompt (`#gp-cash`) now follows the combo to the left in Arabic too; it used to land on the mirrored goals stack.

## How it works (src/ui/hudFit.ts)

- `HudDock.layout()` measures as before, then `HudFit.update()` runs the pure `FitEngine` on the measured boxes. The engine classifies each movable box into a left column (centre x < 40% of the width), a right column (> 60%) or the middle (not fitted). It then checks which columns still overlap after the dock, including side panels over the centre. Finally it decides per column with `fitDecide`.
- **Hysteresis:**
  - A column steps up after 2 overflowing passes. The count is leaky (+1 per overflowing pass, -0.5 per clean one), so a blinking overlap still adds up.
  - A step down is only taken when undoing the top step still fits. The size change of that step is measured on the pass after it was taken (`deltas[level]`, including the full boxes of hidden chips). The check runs the dock on those sizes with +12 px spare (`margin`), and the estimate must fit for 0.5 s, at least 1.5 s after the last change.
  - A step down that overflows again within 1.5 s blocks step-downs for 6 s.
  - Content hovering at the limit therefore never flickers. `tests/uipolish.test.ts` checks every one of these rules.
- **Cheap:**
  - The fit only does arithmetic on the boxes the dock already read.
  - Zooms are read in the same measure pass (`currentCSSZoom`). The translate nudge now reuses that value instead of reading it after other writes.
  - All attribute writes happen after all reads, and only when a value changes.
  - After a change the next dock pass runs on the next frame instead of 0.1 s later, so the climb takes a few frames.
- **Hooks:** the fit writes `data-hf-tight|fold|chip|hide|hot|open` attributes and the `--hf` zoom factor.
  - Data attributes are used because lanes rewrite `className` (voiceUi, objectiveHud).
  - The UI SCALE zoom rules became `calc(var(--ui) * var(--hf, 1))`, and the phone ones `calc(var(--ui) * 0.8|0.72 * var(--hf, 1))`.
  - Only top-anchored (stacked) panels zoom. A corner panel placed by a right/bottom offset slides into its anchor when zoomed, which is how the Arabic pet panel landed on the minimap in a first version.
- **Tuning:** `fitTuning` (upPasses 2, downHold 0.5, minDwell 1.5, margin 12, cooldown 6, hotTime 3, tipHot 6, hoverDelay 0.35, minScale 0.7, scaleStep 0.05, centre 0.35-0.65).
- **Dev:** `window.__hudfit` (dev builds only) exposes:
  - `.engine.columns`: levels and timers.
  - `.engine.force = n`: pin a level.
  - `.quiet = true`: no hot or hover opening.
  - `.debug = true`: `.pairs` lists the overlaps the engine sees.

## Numbers

The panel boxes came from real headless renders at every level (`src/ui/hudFitCases.ts`). "Before" is the old dock at level 0; "after" is the fit's settled state.

| case | before | after | levels L/R |
|---|---|---|---|
| stress 1280x720 125% en | 3 overlaps, 19,260 px² | 0 | 3/0 |
| stress 1280x720 125% ar | 9 overlaps, 51,008 px² | 0 | 3/6 |
| stress 1280x720 150% en | 3 overlaps, 19,260 px² | 0 | 3/0 |
| stress 1280x720 150% ar | 8 overlaps, 47,474 px² | 0 | 3/6 |
| stress 1920x1080 150% en | 4 overlaps, 66,133 px² | 0 | 3/0 |
| stress 1920x1080 150% ar | 6 overlaps, 23,286 px² | 0 | 0/3 |
| stress 844x390 en | 3 overlaps, 10,322 px² | 0 | 3/0 |
| stress 844x390 ar | 9 overlaps, 33,059 px² | 0 | 3/3 |
| stress 667x375 en | 4 overlaps, 12,599 px² | 0 | 3/0 |
| stress 667x375 ar | 8 overlaps, 34,998 px² | 0 | 3/3 |
| stress 4 heroes 1280x720 150% en | 3 overlaps, 41,418 px² | 0 | 3/0 |
| ordinary co-op 1280x720 125% en | 0 | 0 | 0/0 |
| ordinary co-op 844x390 ar | 1 (teammeter on the centre), 8,740 px² | 0 | 0/0 |

(720p at 125% and 150% are the same rows: UI SCALE is capped at 120% on 1280x720 by `uiZoom`.)

Live headless runs, 18-30 s into the busy link: 0 overlaps at 1280x720 100/125/150% and 1920x1080 100-150% in both languages. Live levels run higher than the replay, up to 10 on phones. New first-time tips (6 s in full each) and the growing combo keep a crowded column up, and it unwinds one step per ~2 s afterwards. Ordinary play (solo, 2-player co-op) stays at level 0 at every size.

## Tests

`tests/uipolish.test.ts`:
- Level order, the 70% floor and column classification.
- Every hysteresis rule: two passes to step up, climbing, minDwell, downHold, take-back plus cooldown, and blinking overlap.
- A replay of the dock plus fit engine on the 13 recorded cases (stress at 720p 125/150%, 1080p 150%, 844x390, 667x375, EN and AR, a 4-hero case, ordinary co-op). It **fails on any overlap**: panel on panel, anchor, centre or screen edge. No least-covering tolerance.
- The fit must settle (the levels don't change over the last 15 s) and anchors never move.
- Ordinary play must stay at level 0.
- The stress fixtures must overlap without the fit (all 11 do), so the check can fail.

Re-record the fixtures after a HUD layout change: `node .agent-logs/hudfit-fixtures.mjs > src/ui/hudFitCases.ts` (local script, git-ignored like other agent tooling; it loads each link, pins every level with `__hudfit.engine.force` and records the CSS boxes). The live probe with screenshots is `.agent-logs/hudfit-probe.mjs` (`--only <substr,...> --wait 30 --shots --tag x`, writes shots/hudfit/). If the lead wants these kept, move them to scripts/.

## Test links

```sh
BUSY="?test&bench&god&mate&netdemo&pet=sparky&petlv=2&style=S&spawn=shooter:4&season=halloween&stage=2&voicedemo&weapons=drones:3,aura:2&candy&tether=12&wev=stealth&tip=boss&seed=42&heroes=8"
npm run shot -- "$BUSY&ui=125" shots/hudfit-720-125.png --wait 25
npm run shot -- "$BUSY&ui=150&lang=ar" shots/hudfit-720-150-ar.png --wait 25
npm run shot -- "$BUSY&ui=150" shots/hudfit-1080-150.png --wait 25 --size 1920x1080
npm run shot -- "$BUSY&lang=ar" shots/hudfit-phone-ar.png --wait 30 --size 844x390
npm run shot -- "$BUSY" shots/hudfit-phone-small.png --wait 30 --size 667x375
```

Use long waits: on a loaded machine the headless game runs at 3-6 fps, and the fit climbs one step per dock pass.

## Files

- New:
  - `src/ui/hudFit.ts`: engine, applier, CSS.
  - `src/ui/hudFitCases.ts`: recorded boxes, imported only by the test, not in the bundle (checked).
  - This note.
- `src/ui/hudLayout.ts`:
  - The dock calls the fit and passes the centre keep-out.
  - `DockBox.free` and `DOCK_FREE`.
  - `resolveDock(…, keepOut)`: optional, so old callers behave as before.
  - The zoom rules take `--hf`.
  - The Arabic network panel stays left; the Arabic cash-in prompt moves left.
  - The zoom is read in the measure pass.
- `tests/uipolish.test.ts`: the tests above.
- `src/game/systems/halloween.ts`: an additive hook. The candy label also sets `data-chip` (the count) so the folded chip can show just the number.
- No i18n strings added: the chips show glyphs and numbers.
- `src/ui/toastQueue.ts`: unchanged (toasts are top-middle `free` panels and weren't part of the problem).

## Validation

- `npm run typecheck`: pass.
- `npx vite build`: pass.
- `npm test`: all 119 files pass. `tests/uipolish.test.ts` was rerun after the last CSS-only edit: 66 ok, 0 FAIL.
- `npm run smoke`: pass.

## Unfinished / risky

- **A new first-time tip shows in full for 6 s** (`tipHot`) even when its column is full. On a crowded phone it sits on top (z-index 12) of the roles panel or style meter for those seconds, then folds to its title. The steady state has no overlaps, and the tests run with tips folded (`quiet`).
- **One live residual:** on 844x390 in Arabic, in the full 8-hero stress combo, the combo cash-in prompt (a transient panel shown while a cash-in is available) can sit on the roles panel while it is up. That left column (minimap, combo, style meter, roles, cash-in) has no room left at the floor. All other final live runs had 0 steady-state overlaps (12 cases, 30 s in).
- **HIDE goes one step beyond the brief.** It only triggers on phones in the stress combo, and only for the network, voice, candy and pet chips. Also on phones, the 70% floor is measured against the user's UI SCALE (as the brief says), and phone panels already sit at 0.72-0.8x. So SCALE barely shrinks them: steps 1-3 and HIDE do the work there.
- **"Expand on focus"** isn't implemented: HUD panels aren't focusable during play. Pad players get the open-on-change rule. Pointer hover is a 0.35 s rest, so aiming across the stack doesn't open it.
- **Columns are decided by panel position** (40/60% of the width). A future panel placed mid-screen isn't fitted, but the dock still moves it, and the centre keep-out still applies.
- **Pre-existing, not this lane:** on 667x375 in Arabic, the life number touches the timer (the mobile lane's anchor CSS). Also not this lane: the phone layout puts the special meters (anchors) slightly inside the centre band.
- Not checked on real phones, real GPUs or by a person; headless Chromium only.
