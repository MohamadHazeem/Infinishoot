LANE: menu — first impressions

1. Main menu redesign: the playable/animated title (already exists) gets a cleaner layout: big PLAY (solo/co-op/modes), clear sub-menus, news/quests/event banner slots, profile corner (level, title), version; consistent sounds and animations; works with keyboard, gamepad, mouse and touch; UI SCALE.
2. A proper loading screen (shown while lazy chunks/audio load and between stages if needed) with tips, hero art and a progress bar.
3. Consistency audit of every screen added in Milestones 9-11 and tonight: same frames, spacing, fonts, button prompts (src/ui/prompts.ts), back behaviour (Esc/B always goes back), focus never lost; fix what's off. Screenshot every screen before/after.
Owns: title/menu screens (src/ui/menu.ts, title parts of screens.ts with small hooks), new src/ui/loadingScreen.ts, CSS injected from modules, tests/menu.test.ts.
