# uxpass lane: screenshot review of every menu screen, then fixes

Presentation only: no gameplay, balance, save or network changes. Every screen in the brief was shot at 1280x720
and 1920x1080 in English and Arabic (phone 844x390 for the first six), each PNG was looked at, the defects below were
fixed, and the screens were shot and looked at again.

## What players get

- **Menus fit the window.** At 1280x720 the stage shop shows its owned-Mod row (5 slots), REROLL / HEAL / CONTINUE and
  relics; level-up shows its build strip; pause shows the evolutions panel; PLAY SOLO (Arabic), the title (incl. the
  icon-credits line), the 8-player lobby (two columns), jukebox (4 columns) and trials (1080p) no longer run off the
  bottom. Phone title shows the whole main menu; phone story pages show NEXT / SKIP.
- **A visible scroll cue.** Any menu (or its inner list: settings, sets, season, wardrobe, editor palette...) that still
  has content below the fold shows a blinking pixel "▼ MORE" chip at its bottom edge; clicking it scrolls a page.
  It hides at the end of the list. Keyboard/gamepad focus already scrolls into view, so the cue never takes focus.
- **Readable labels.** Shop LOCK labels are white on the blue button (were mist, nearly invisible); Arabic label-font
  text (LOCK, rarity, interest, owned title, preview, settings tabs, pause section titles) is 13-15px instead of the
  10-12px Latin pixel size; the SETTINGS "Q / E · SWITCH TAB" hint is 12px white; the first level-up help's SPECIAL
  chip has white text on plum.
- **No orphan lines.** Card names, descriptions and "UPGRADES IN SHOP TO LV 3" use balanced wrapping (no lone "3").
- **Arabic fixes.** The shop preview's "IF" is translated (it was CSS `content: 'IF '`); the owned-Mod "NEXT LV" line is
  fully Arabic (the word diff split the sentence before translation, leaving "for each", "take"); level-up cards no
  longer glue rarity and label ("أسطوريتطور"); three co-op lobby labels were shifted by one catalog entry (REVIVE POOL showed
  "ROLES", JOIN ANYTIME showed "REVIVE POOL", the team-bonus hint showed "JOIN ANYTIME") and are realigned; the lobby no longer slides under the chat panel in RTL.
- **BACK stays last** in its row when another lane appends a button after it (PLAY SOLO's RAID RECORDS).

## Defects found

| Screen | Size / lang | Defect | Status |
|---|---|---|---|
| Stage shop (0 Mods) | 1280x720 en / ar | YOUR MODS row + slots below the fold (872 / 1009 px tall) | Fixed: 720 / 720 |
| Stage shop (5 Mods, relics, curse) | 1280x720 en | Owned slots, CONTINUE and relics below the fold (1162 px) | Fixed: 725 px with first-shop help (relic strip under the cue); fits without the help, which only new players see |
| Stage shop (5 Mods) | 1280x720 ar | 1395 px | Improved: 924 px, scrolls with the cue (Arabic cards need 4 lines; see unfinished) |
| Stage shop (5 Mods) | 1920x1080 en / ar | Owned row off the bottom even at 1080p (1219 / 1452) | Fixed en (1080); ar 1141, cue |
| Starting shop | 1280x720 en / ar | 951 / 992 px | Fixed en 720; ar 736 (16 px, cue) |
| Shop cards | all | "UPGRADES IN SHOP TO LV" / orphan "3" | Fixed (balanced wrap, no letter-spacing) |
| Shop LOCK buttons | all | Mist label on blue, nearly invisible | Fixed (white + ink shadow; Arabic 15px) |
| Shop owned slots | 720p | Slot heights/controls misaligned, SELL +3 wrapping | Fixed (move/sell row pinned to the slot bottom, nowrap) |
| Shop preview | ar | "IF" hard-coded English in CSS | Fixed (`text.if_de6ee2` span) |
| Shop owned NEXT LV | ar | Half English ("for each", "take x1.8") | Fixed (diff localized sentences) |
| Shop / relic labels | ar | Rarity, interest, owned title, preview in tiny Latin label size | Fixed (13-15px) |
| Hidden shop | all | (introduced and caught here) the 720p grid's `display:grid` beat `.screen[hidden]` and showed the shop behind SETTINGS | Fixed; unit test guards every screen-level display rule |
| Level up | 1280x720 en / ar | Build strip under the cards cut off (756 / 817) | Fixed: 720 / 720 |
| Level up cards | ar | Rarity + label glued: "أسطوريتطور" | Fixed (separate spans) |
| Level up help | all | SPECIAL chip dark text on plum unreadable | Fixed (white text) |
| Pause | 1280x720 en / ar | Evolutions / damage panels below the fold (765 / 840) | Fixed: 720 / 720 |
| Pause labels | ar | RELICS / EVOLUTIONS / SETS titles 10px | Fixed (14px) |
| Title | 1280x720 en / ar | Icon credits line (CC BY attribution) cut by the bottom (749 / 744) | Fixed: 720 / 720 |
| Title | 1920x1080 en / ar | Activity cards in one column pushed quests, footer, credits off (1132 / 1341) | Fixed: 1080 / 1080 (hudLayout's 2-column rule stopped at 900px tall; extended from menuFit) |
| Title | 844x390 en / ar | Only logo + PLAY visible (1203 / 1319) | Fixed: whole menu visible beside the activity cards (598 / 730, rest scrolls with the cue) |
| Title (fresh save) | 1280x720 ar | 792 px | Improved: 732 (12 px, cue) |
| Story intro | 844x390 en | NEXT / SKIP below the fold (419) | Fixed: 390 (the compact rules existed for Arabic only) |
| PLAY SOLO | 1280x720 ar | NEXT / BACK below the fold (837), mode-card lines colliding | Fixed: 720, line-height 1.4 |
| PLAY SOLO | 1920x1080 ar | 1182 | Fixed: 1080 (rule extended to 1080p, larger heading there) |
| PLAY SOLO | all | BACK not last (RAID RECORDS appended after it) | Fixed (`keepBackLast`) |
| SETTINGS | 1280x720 / 1920x1080 (ar 1089 -> 1080) | List in a fixed 46vh box with empty space under it, cut mid-row, no cue | Fixed: list grows into the space (`100vh - 380px`), cue on the list |
| SETTINGS | ar | Tab labels 12px | Fixed (15px) |
| SETTINGS hint | all | "Q / E · SWITCH TAB" 10px mist | Fixed (12px white) |
| Online lobby, 8 players | 1280x720 en / ar | One 1320px column, START GAME at y 1474 (1550 / 1721 px tall); chat panel overlapping the lobby frame | Improved: two columns, 745 / 854 (START row under the cue); chat has its own strip |
| Online lobby, 8 players | 1920x1080 en / ar | 1644 / 1781 | Fixed: 1080 / 1080 |
| Online lobby, 4 players | 1280x720 en | 1374 | Fixed: 720 |
| Lobby | ar | Lobby under the chat (padding on the inline end, chat is physically right) | Fixed (`padding-right`) |
| Lobby | ar | Three labels shifted by one catalog entry: REVIVE POOL = "الأدوار" (ROLES), JOIN ANYTIME = "أرواح الإحياء" (REVIVE POOL), PICK DIFFERENT HEROES… = "الانضمام في أي وقت" (JOIN ANYTIME) | Fixed (realigned; new copy only for the team-bonus hint) |
| Lobby | all | Section labels touching the selected button's yellow ring | Fixed (label margin) |
| Jukebox | 1280x720 / 1920x1080 | 2 columns, 1263-1387 px, BACK far below | Fixed: 4 compact columns, 720 / 1080 |
| Trials | 1920x1080 en / ar | Tile list cap ignored the bigger UI pixel; BACK and footer cut (1120 / 1114) | Fixed: 1080 / 1080 (4 columns from 1500px wide) |
| Route map | all | "STAGE 4 ★" header and biome name 6 px lower than the other columns | Fixed (line box of the fallback star) |
| Season, wardrobe, codex, arsenal, achievements, editor palette | all | Inner lists scroll with no cue | Fixed (cue) |
| Phone PLAY / PLAY SOLO / LOADOUT / shops | 844x390 | Multi-screen scrolls (PLAY SOLO 1463 px, starting shop 1346) | Cue only; see unfinished |
| Game over (run summary) | 1280x720 / 1920x1080 en / ar | 1140 / 1460 (720p), 1259 / 1585 (1080p): profile and season strips, highlight clips and scores below the fold | Partly: RETRY / TITLE, score, closest unlocks and timeline are on the first screen; the rest scrolls with the cue (a two-column game over is a bigger redesign) |
| Game over summary card | ar | Values half a row below their labels; labels far from values in RTL | Fixed (baseline alignment, logical text-align) |
| CUSTOMISE | 1280x720 ar | 747 px | Cue only |
| Victory (ending cinematic), relic pick, run history, story codex, extras, online (host/join form) | all | Nothing wrong found | - |
| `?test&screen=customise` | all | Boot fails ("Could not load"): `show('customise')` runs before the lazily registered screen exists | Not fixed (test-link only; `?test&customise` and EXTRAS > CUSTOMISE work). One-line fix for the dev-links owner: guard `screens.show` for unregistered extra screens |
| Level-up evolution fork | all | Ribbons covered by the pick-lock bar while the "EVOLUTION FORK" tip is up | By design (the lock bar); not changed |
| Story intro | ar | Chapter number may read "10" for "٠١" in the display font | Not verified (glyph fallback in the pixel font); left as is |
| Stage shop | 1280x720 | First-time "MOD ORDER MATTERS" tip (#ob-tip, top right) covers the curse card's header | Not changed: the tip is placed by the HUD dock (hudLayout, another lane) and can be closed; suggest docking tips below the shop offers |
| Title | 1280x720 | In-run XP bar / LV badge drawn over menus top-left | Not changed: hudLayout (owned by the HUD lane) hides it only on phones |

## Numbers (page scroll height; = window height means it fits)

Before (clean HEAD copy) -> after (this lane), 1280x720 en / ar unless noted:
shop 872/1009 -> 720/720 · shop 5 Mods 1162/1395 -> 725/924 · starting shop 951/992 -> 720/736 · level up 756/817 -> 720/720 ·
pause 765/840 -> 720/720 · title 749/744 -> 720/720 · title 1080p 1132/1341 -> 1080/1080 · PLAY SOLO ar 837 -> 720 ·
lobby 4 players 1374 -> 720 · lobby 8 players 1550/1721 -> 745/854 (1080p 1644/1781 -> 1080/1080) · jukebox 1263/1293 -> 720/720 ·
trials 1080p 1120/1114 -> 1080/1080 · story phone 419 -> 390 · title phone: 1 of 4 menu buttons visible -> 4 of 4.

## How it works

- `src/ui/menuFit.ts` (new): `ensureMenuFitCss()` injects the lane's rules and keeps its `<style>` last in `<head>`, so it
  wins ties with hudLayout's / shopUi's injected rules without editing them. Rules are scoped `#hud #scr-...` and to
  `(min-width: 1000px) and (max-height: 820px)` (720p class), `(max-height: 1200px)` (1080p class) or
  `(max-height: 500px)` (phones landscape), so bigger windows keep their layout.
- `MoreCue`: one fixed button in `#hud`; `Screens.show()` calls `watch(screen)`. It finds the scroller (the screen, else
  its tallest scrolling child) and every 0.3 s while a menu is open shows the cue if more than 12 px are hidden below
  (`moreCueTuning`). The interval is `unref`'d so Node tests and the jsdom smoke run aren't held open.
- `keepBackLast(screen)`: like menu.ts's BACK-last pass, but also for BACK buttons that already had a prompt; runs on
  show (before `nav.refresh`) and on the cue's tick, and only moves a BACK whose following siblings are all buttons.
- Shop 720p/1080p: owned Mods put the icon beside the name, clamp description (2 lines) and NEXT LV (1 line at 720p; the
  full text stays in the slot tooltip and the order preview), and pin the move/sell row to the slot bottom. From 1180px
  wide, REROLL / HEAL / CONTINUE stack beside the owned row (CSS grid with named areas). The grid only applies when the
  shop holds just its own parts (`SHOP_PARTS`; the Gauntlet clock or the co-op trade pool keep the plain column) and
  never when hidden. Relics: at these sizes the section title hides and the strip shows its own short label.
- Lobby from 1180px wide: CSS columns inside the lobby box (balanced, section labels kept with their rows), players in a
  2-column grid, a 270px right strip for the fixed chat.

## Files

- New: `src/ui/menuFit.ts`, `src/i18n/uxpass.ts` (`uxpass.more`: MORE / المزيد), `tests/uxpass.test.ts`, this note.
- `src/ui/screens.ts`: mount the cue, call `ensureMenuFitCss` / `keepBackLast` / `moreCue.watch` from `show()`, relic strip
  short label, `nextLevelHtml` exported and diffing localized text, level-up card kind spans.
- `src/ui/shopUi.ts`: localized "IF" span in the order preview (replaces the CSS `::before`).
- `src/i18n/en.ts`, `src/i18n/ar.ts`: spread the uxpass catalog; ar `text.revive_pool_7b151b`, `text.join_anytime_425ffe`, `text.pick_different_heroes_for_a_team_bonus_382364` realigned.
- Not edited: hudLayout.ts, toastQueue.ts, uipolish tests (overridden from menuFit where needed: title activity columns
  at 1080p).

## Tests

`tests/uxpass.test.ts`: cue show/hide/scroll/Arabic label/never focusable; scroller pick; the injected CSS keeps the
pixel rules (no radius, blur, gradient, hex colours; every animation `steps()`); every rule that sets `display` on a
whole screen keeps `:not([hidden])` (and the check catches the old shop selector); LOCK/720p/balance rules present; the
real shop markup with 5 Mods, 3 relics and a curse only has children the 720p grid places, each owned Mod keeps its
`.ctrl` as a direct child, relic short label (en/ar), menu-fit CSS last in `<head>`; `keepBackLast` (incl. PLAY SOLO
after a lane appends a button); Arabic NEXT LV line has no English words; level-up card kind spans and no leading
separator on rarity-less loadout cards.

## Screenshots (shots/uxpass/, git-ignored)

- `before{A,B}/` from a clean `git archive HEAD` copy, `after{A,B}/` from this branch, `final/` the last re-shoot of
  the screens changed after the after pass; `it/` intermediate iterations. File names: `<case>-<WxH>-<lang>.png`.
- Tools: `shots/uxpass/shoot.mjs cases.json <outdir> [regex]` (one dev server, many pages, writes `report.json` with
  scroll heights, scrollers, off-screen and overflowing elements); `probe.mjs` (DOM dump). Cases in `cases.json`.
- Test links used: `?test&shop&gold=60&seed=3`; `?test&seed=3&stage=2&gold=60&weapons=drones:3,missiles:2&mods=hoarder:2,momentum,echo,kindling,glass_cannon&relics=r_backbeat,r_anchor,r_mercy&shop`;
  `?test&ftshop`; `?test&seed=11&loadout=buster,charge,storm&weapons=drones:2,lightning:1&levelup`;
  `?test&weapons=drones:3,aura:2,missiles:2&passives=armor:2&set=inferno:4&relics=r_backbeat&mods=hoarder,echo&setpause=3&god`;
  `?test&lobby8`, `?test&lobbyx`, `?test&mptitle`, `?test&fresh`, `?test&story=intro&storyframe=0&storypin`,
  `?test&screen=settings&settingstab=N`, `?test&screen=jukebox`, `?test&trialscreen=select`, `?test&stage=3&route`, `?test&editor=demo`; add `&lang=ar`.

## Unfinished / risky

- Arabic shop with 5 Mods at 720p (924 px) and 1080p (1141), and the 8-player lobby at 720p (745 en / 854 ar) still
  scroll; the cue shows and focus scrolls. Fitting them needs fewer lines per Arabic card (shorter copy) or a
  denser layout than I wanted to force without a person looking at it.
- Phones (844x390): PLAY, PLAY SOLO, LOADOUT and the shops remain multi-screen scrolls with the cue; only the title and
  the story pages got phone layouts.
- The 720p shop grid moves REROLL / HEAL / CONTINUE beside the owned Mods: up/down gamepad navigation is by position, so
  it works, but nobody has tried it with a pad.
- `keepBackLast` moves DOM nodes on the cue's tick; MenuNav follows the focused element, but a lane that relies on its
  buttons' DOM order after BACK would be affected (none found).
- Numbers come from headless Chromium (swiftshader) under a heavy shared load; not checked on real displays or by a person.

## PLAN.md decision-log paragraph

- 2026-11-12: uxpass lane (notes/lanes/uxpass.md). A screenshot review of every menu at 1280x720, 1920x1080 and phone
  size in English and Arabic found menus running off the bottom (shop, level-up, pause, title, lobby, jukebox, trials),
  faint labels (shop LOCK, Arabic label-font text, the settings hint), orphan wraps and Arabic text left half English
  (shop preview "IF", NEXT LV lines, glued card labels, three lobby labels shifted by one entry). Fixes are CSS from a new
  src/ui/menuFit.ts (scoped to 720p-, 1080p- and phone-class windows, injected last so it overrides other lanes'
  injected rules without editing them) plus a few markup changes; menus that still need a scroll show a pixel
  "▼ MORE" cue. E.g. stage shop 872 -> 720 px at 720p, 5-Mod shop 1162 -> 725, lobby (4 players) 1374 -> 720,
  jukebox 1263 -> 720, title at 1080p 1341 -> 1080 (Arabic).

## Validation

- `npm run typecheck`: pass. `npx vite build`: pass (the usual large-chunk advisory).
- `npm test`: all 120 unit test files pass (incl. the new tests/uxpass.test.ts; i18n, menu, shop, shopCoop, uipolish re-run after the last edits).
- `npm run smoke`: pass.
- `npm run coop` not run: nothing online changed (menus and CSS only; the shop/level-up markup changes are presentation and the shop view fields are unchanged).
- Found on the way and fixed before finishing: the cue's interval kept `tests/menu.test.ts` from exiting (now `unref`'d; uxpass.test.ts no longer calls `process.exit` so it proves this), and the cue used the global `getComputedStyle`, which menu.test's jsdom setup doesn't expose.
