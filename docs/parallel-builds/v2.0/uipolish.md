LANE: uipolish — final UI consistency pass

Tonight ~40 lanes added screens, HUD panels and settings. Make the whole UI feel like one game:
1. Screenshot every screen and HUD state (title, all menus, settings tabs, lobby, MVP, profile, achievements, quests, raid/race/PvP/gauntlet HUDs, story, mods, photo mode, shop/level-up/route) at 1280x720, 1920x1080 and 844x390 (phone).
2. Fix inconsistencies: frames, spacing, fonts, colours (Sweetie 16 only), prompts (src/ui/prompts.ts), focus/back behaviour, overlapping HUD panels (goals stack, teammate list, minimap, style meter, pet panel, net overlay, voice indicators), text overflow (also in Arabic if src/i18n exists: RTL).
3. HUD layout: one layout system that places all corner panels without overlap at every UI SCALE (src/ui/hudLayout.ts).
Owns: CSS and layout fixes across src/ui (small, surgical edits), src/ui/hudLayout.ts, tests/uipolish.test.ts.

Known issues seen tonight (fix these first):
- SETTINGS footer shows two HELP buttons (desktop lane's help and another lane's); keep one entry point that offers both.
- The FIRST STEPS checklist toast ("FIRST STEPS 1/8 · BEAT A BOSS ✓") overlaps big stage titles and boss/announcer banners; queue toasts so they never cover a title card, and keep the goals stack readable.
- The Halloween candy line ("0 CANDY · +0 THIS RUN") overlaps the weapon slots bottom-left; give it a slot in the HUD layout.
- Elite/announcer toasts vs the boss bar (an older fix moves toasts below the boss bar: keep it working with all the new panels).
- With many new panels (objective, Night Raid intel, goals, style meter, pet panel, team meter, network overlay, voice indicators, spectator badge, squad orders, season banner), check every combination at 1280x720, 1920x1080 and 844x390 and at UI SCALE 75-150%.
- German/French text is long: check menus with ?lang=de / ?lang=fr (wait ~6 s for the lazy catalog) for overflow.
