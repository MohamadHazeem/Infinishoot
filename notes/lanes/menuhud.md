# menuhud lane: the last menu/HUD overlaps and the tallest menus

Presentation only: no gameplay, balance, save or network changes. Builds on uxpass (menuFit.ts) and hudfit
(hudFit.ts / the dock). Every change was shot in headless Chromium before and after and the PNGs were looked at.

## What players get

1. **No in-run HUD under menus.** While any full-screen menu is open (shop, relic pick, level-up, pause, route map,
   game over, MVP, settings, title...), the life bar and its "100/100", the XP bar, the LV badge / HUD face, the goals
   stack and every docked corner panel are hidden. Before, the life bar, its number and the LV badge drew at the top of
   every menu (over or next to "STAGE 1 SHOP"), and the XP bar ran across the top edge. The shop still needs the life
   for HEAL, so it now shows **LIFE 30/100** next to its gold (red when low).
2. **First-time tips never sit on a menu's cards or buttons.** Over a menu, a tip is placed where the open screen has
   no content: the old top-right corner when it's free, else down the right or left edge, else top/bottom middle, trying
   250, 340 and 460 px widths. If only the title fits, it folds to its title chip (pointer over it opens it, like
   hudfit's chip). If not even the chip fits, it's hidden until the menu changes. "MOD ORDER MATTERS" on the 5-Mod
   shop at 1280x720 is now a title chip in the top-right corner instead of a 128px panel over the curse-deal card.
3. **GAME OVER fits one 720p screen in both languages.** K.O., NEW HIGH SCORE, the NEXT TRY card and RETRY / BUILD CARD
   / TITLE sit on top. Every result panel (score + stats, damage, closest unlocks, run timeline, build, new
   achievements, profile and season strips, highlight clips, high scores) flows into three balanced columns. At 720p
   the run timeline folds to one chip per stage (stage + DPS bar); the full table opens on hover or focus (it's now a
   focusable nav item, with the hint "POINT OR FOCUS FOR DETAILS"). The same column layout applies up to 1080p-class
   windows (with the full timeline). Bigger windows keep the old layout untouched.
4. **The 5-Mod Arabic shop fits 720p** (no text under 13px): wider cards so descriptions take fewer lines, smaller
   card icons, the heading and the gold line share the top row, a one-line order preview, tighter owned row.
5. **Phones (844x390):** PLAY, PLAY SOLO, LOADOUT, the shops and the relic pick keep their primary row (NEXT / START /
   CONTINUE with REROLL and HEAL / BACK) in a sticky bar at the bottom, always on screen; the "▼ MORE" cue sits above
   the bar instead of on its buttons. Cheap height cuts: PLAY's launchers in two columns (PLAY now fits), smaller hero
   buttons, three-column mode cards, smaller loadout and shop cards. Shop cards are still bought by pressing the card
   (no separate BUY button), and focus scrolls the focused card into view.

## Numbers (page scroll height at the window height = fits; headless Chromium, swiftshader)

| Screen | Size | Before | After |
|---|---|---|---|
| Game over, full first run (6 stages, clips, strips, 2 scores) | 1280x720 en / ar | 1305 / 1612 | 720 / 720 (content 608 / 684) |
| Game over, quick death (`?test&die=1&seed=4`, uxpass measured 1140 / 1460) | 1280x720 en / ar | 1159 / 1460 | 720 / 720 |
| Game over, full | 1920x1080 en / ar | 1442 / 1737 | 1080 / 1080 |
| Stage shop, 5 Mods + relics + curse + first-shop help | 1280x720 en / ar | 725 / 924 | 720 / 720 |
| Stage shop / level-up / pause / route / relic | 1280x720 en / ar | 720 (unchanged) | 720 |
| HUD corner panels visible under a menu | every menu | XP bar, life bar + number, LV badge | none |
| PLAY | 844x390 en / ar | 417 / 494 | 390 / 390 |
| PLAY SOLO | 844x390 en / ar | 1222 / 1260 | 942 / 1042, NEXT always on screen |
| LOADOUT | 844x390 en / ar | 729 / 847 | 665 / 783, START always on screen |
| Starting shop | 844x390 en / ar | 1293 / 1370 | 727 / 867, CONTINUE always on screen |
| Stage shop | 844x390 en / ar | 1220 / 1430 | 890 / 1040, CONTINUE always on screen |
| Stage shop, 5 Mods | 844x390 en / ar | 1459 / 1731 | 1175 / 1450, CONTINUE always on screen |

## How it works

- `src/ui/menuHud.ts` (new) holds the lane's logic and CSS; its CSS is appended to menuFit's injected style
  (`menuFitCss()`), so it stays last in `<head>` and the uxpass pixel-rule tests cover it too.
- **HUD under menus:** `menuCoverCss(dock)` builds one `visibility: hidden !important` rule from hudLayout's `HUD_DOCK`
  list (plus `#hudface`, `#xpbar`, `#hp`, `#goals`, `#ob-train`), for `#hud.menu-open X` and `#hud.menu-open ~ X`
  (the voice chip is #hud's sibling). A panel added to the dock list later is covered automatically. Kept visible:
  touch controls and the tip. `injectHudCss()` appends it. style.css's old "only the XP and life bars stay visible"
  rule is now overridden; hudLayout's phone-only xpbar/hp rule is redundant but harmless.
- **Tips:** `MenuTip` lives on the uxpass `MoreCue` (same 0.3 s tick while a menu is open, plus a MutationObserver on
  the tip, so a new tip is placed before it paints). `menuContent()` collects visible boxes of the screen's buttons,
  cards, headings, framed boxes and any element with its own text (wrappers over 45% of the window skipped: their
  children count). `placeTip()` / `freeSpot()` are pure. The placement is written as inline left/top/width (divided
  by the tip's CSS zoom) and `data-mh` / `data-mh-fold`; with no menu the styles are cleared. The dock skips the
  tip while `#hud.menu-open` (and clears its translate), so the two never fight. A chip state hudfit left on the tip
  doesn't fold it under a menu. Tuning: `menuTipTuning` (gap 8, widths 250/340/460, step 8).
- **Shop life:** `syncShopLife()` copies `#hp .num` into a `.mh-life` chip in `.shop-top` on the cue tick (no view
  or network change; it follows heals within 0.3 s).
- **Game over:** the markup now has RETRY / TITLE before a new `.go-body` wrapper that holds `.go-cols` (summary,
  damage, the onboarding lane's `.ob-go`), `.build`, `.unlocked`, `.hiscores` and `.hiscores.global`. Lanes still find
  everything (`querySelector` is deep; meta2/season insert after `.unlocked`, so their strips land inside). On big
  windows `.go-body { display: contents }` keeps the old layout exactly. From 1000px wide and up to 1200px tall,
  `.go-body` is a 3-column multicol (`column-fill: balance`, every panel `break-inside: avoid`, `.go-cols` / `.ob-go`
  `display: contents`). The multicol had to be an inner element: on the fixed-height screen itself, overflow made
  extra columns off to the side instead of a scroll. Build badges get `contain: layout` because their positioned
  level numbers jumped to the next column at a column break.
- **Phones:** `STICKY_BARS` lists the primary rows; at `max-height: 500px` they're `position: sticky; bottom` with
  an ink bar. `stickyBarTop()` lets the MORE cue sit above a stuck bar.

## Files

- New: `src/ui/menuHud.ts`, `tests/menuhudCases.ts` (recorded 720p game-over blocks), this note.
- `src/ui/menuFit.ts`: MoreCue owns a `MenuTip`, calls `syncShopLife`, puts the cue above sticky bars; CSS +
  `MENUHUD_CSS`; `SHOP_PARTS` moved to menuHud.ts (re-exported, avoids an import cycle).
- `src/ui/hudLayout.ts`: appends `menuCoverCss(HUD_DOCK)`; the dock skips `#ob-tip` under menus.
- `src/ui/screens.ts` (small): game-over markup (menu row first, `.go-body` wrapper).
- `src/ui/onboarding.ts` (game-over markup only): the run timeline gets `data-nav tabindex="-1"` and the details hint.
- `src/ui/clipsUi.ts` (outside the lane, 2 lines): the game-over clips panel goes into `.go-body` before
  `:scope > .hiscores` (it used `root.insertBefore(panel, root.querySelector('.hiscores'))`, which would throw once
  the scores moved).
- `src/i18n/uxpass.ts`: `menuhud.life` (LIFE / الحياة), `menuhud.details` (POINT OR FOCUS FOR DETAILS /
  مرّر المؤشر أو حدّده لعرض التفاصيل). Already spread into en/ar; the other five languages fall back to English.
- `tests/uxpass.test.ts`, `tests/uipolish.test.ts`: tests below.

## Tests

- `tests/uxpass.test.ts` (menuhud block):
  - Builds every docked corner panel from `HUD_DOCK` (35+ selectors, plus life, XP, face, goals, training and the voice
    chip beside #hud). Opens shop, relic, level-up, pause, route, game over, settings and title through the real
    `Screens`, and checks that each panel's computed visibility is hidden, then visible again in play.
  - `placeTip` on the recorded 5-Mod shop boxes: folds to a chip in the top-right corner, covering nothing. With room,
    the full tip sits top-right; with the right side taken it moves left; it's hidden when nothing fits.
  - `MenuTip` on a DOM with stubbed boxes: folds, unfolds when room appears, and clears when the menu closes.
  - The shop LIFE chip (low mark, Arabic label).
  - Game-over markup: RETRY before the panels, panels inside `.go-body`, the scores a direct child. CSS rules for the
    columns, the transparent big-window wrapper and the folded timeline. The timeline row is focusable with its hint.
  - **Game over fits 720p:** the recorded en/ar blocks replayed through `columnsHeight()`. The model must match the
    browser's body height within 12px, and header + columns + padding must be ≤ 720. The same blocks in one column
    must not fit, so the check can fail.
  - Phone sticky-bar rules for every listed row.
- `tests/uipolish.test.ts`: the dock nudges the tip in play and leaves it alone (nudge cleared) under a menu.
- Re-record `tests/menuhudCases.ts` after changing the game-over layout: `node shots/menuhud/shoot.mjs
  shots/menuhud/cases-probe.json <out>` prints the `PROBE` objects. The tool is git-ignored with shots/. If the lead
  wants it kept, move it to scripts/.

## Test links

```sh
npm run shot -- "?test&shop&gold=60&seed=42" shots/menuhud-shop.png --wait 6
npm run shot -- "?test&seed=3&stage=2&gold=60&weapons=drones:3,missiles:2&mods=hoarder:2,momentum,echo,kindling,glass_cannon&relics=r_backbeat,r_anchor,r_mercy&shop&lang=ar" shots/menuhud-shop5-ar.png --wait 6
npm run shot -- "?test&die=1&seed=4" shots/menuhud-mvp.png --wait 9    # MVP card first; game over is behind NEXT
npm run shot -- "?test&screen=modes" shots/menuhud-modes-phone.png --wait 5 --size 844x390
npm run shot -- "?test&ftshop&lang=ar" shots/menuhud-preshop-phone.png --wait 6 --size 844x390
```

The full game-over case (fake 6-stage run) is `shots/menuhud/gofull.js`, run through `shots/menuhud/shoot.mjs` with
`cases-gofull.json`. Shots: `shots/menuhud/before/`, `a1`-`a7/` (iterations), `p1/` (phones before), `p2/`, `final/`.

## Unfinished / risky

- **Hiding the HUD under every menu** includes the co-op WAITING screen, the trade screen and the title's live demo. I
  found no menu that meant to show the life or XP bar (style.css kept them on purpose in M2, before the shop had a
  HEAL button). The shop now shows the life itself. Pause doesn't show life any more; easy to add in the same way if
  wanted.
- **The 720p tip often folds to its chip** on busy menus (the 5-Mod shop has no 250x128 free spot), so the text is only
  read by pointing at it. Pads can't open a folded tip, the same as hudfit's chip. The tip still drains and closes on
  its timer.
- **The game-over column order is DOM order**, balanced by the browser: Chrome decides which panel starts a column, so a
  lane adding a panel can move others between columns. If a run produces much more content than the recorded case
  (for example the race lane's challenge line plus a party row), the screen scrolls with the MORE cue as before.
- The folded timeline opens as an overlay above itself and covers the closest-unlocks panel while hovered or focused.
- The phone sticky bar on PLAY SOLO carries six buttons (HEAT, WEEKLY RULES, NEXT, TRIALS, RAID RECORDS, BACK) in one
  row. They fit at 844 wide; much narrower phones would wrap them to two rows.
- The relic pick's sticky row (`#scr-relic > .menu.row:last-of-type`) wasn't shot on a phone (no phone link for it).
- At 1080p the game over uses the 720p header sizes (K.O. 64px, smaller than before); 1440p+ is unchanged and still
  scrolls in Arabic (1694px at 2560x1440). Extending the columns there made everything small, so I left it.
- Numbers are from headless Chromium under heavy shared load. Not checked on real displays, real phones or by a
  person; co-op (`npm run coop`) not run (nothing online changed).

## PLAN.md decision-log paragraph

- 2026-11-12: menuhud lane (notes/lanes/menuhud.md). The in-run corner HUD (life bar and number, XP bar, LV badge, every
  docked panel) now hides under all full-screen menus. The rule is generated from the dock's panel list, and the shop
  shows LIFE next to its gold for HEAL. First-time tips over a menu go where the menu has no content, or fold to their
  title chip, never over a card or button. GAME OVER puts K.O. and RETRY on top and the result panels in three
  balanced columns on 720p/1080p-class windows (the timeline folds to a per-stage strip with details on hover/focus):
  1305 -> 720 px (English) and 1612 -> 720 (Arabic) at 1280x720. The 5-Mod Arabic shop went 924 -> 720 without text
  under 13px. On phones the primary action row of PLAY, PLAY SOLO, LOADOUT and the shops is a sticky bottom bar, and
  PLAY fits.

## Validation

Final run after the last edit, all pass: `npm run typecheck`, `npx vite build` (only the usual large-chunk warning),
`npm test` (all 121 files, including the extended uxpass and uipolish tests) and `npm run smoke`. `npm run coop` was
not run.
