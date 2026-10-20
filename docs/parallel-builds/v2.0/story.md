LANE: story — a light story

1. Intro: on first launch (and from EXTRAS), an in-engine intro (camera fly-over of the islands, swarm rising, hero landing) plus 3 comic-style story frames narrated with story_intro_1/2/3 (public/audio), skippable, captions.
2. Character bios for all heroes and bosses (EXTRAS > CODEX or a STORY tab), with portraits.
3. Endings: after beating Omega, a short ending per hero (comic frames + narration story_ending, hero-specific text), and a credits roll (story_credits narration, the credits from README, the team) with music.
4. Lore chapters: one short chapter unlocked per boss defeated (text + portrait), read in the codex.
5. Arabic: route all new text through the i18n system if src/i18n exists (another lane is adding it tonight; if not merged yet, keep strings in one data file so they're easy to translate).
Owns: new src/game/story/*.ts, src/ui/storyScreen.ts, src/data/story.ts, small hooks in the title/victory flow, tests/story.test.ts.
