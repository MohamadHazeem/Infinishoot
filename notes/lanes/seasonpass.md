# seasonpass lane: a free cosmetic SEASON track

Free and cosmetic only. There is no money and no power, and every run still starts equal. Each calendar month is a season with 50 tiers. You earn tiers with the profile XP your runs already bank, plus three weekly season challenges. Rewards reuse the existing cosmetic systems: profile titles, banners, HUD themes, trails and pet hats, wardrobe skins, ping-wheel emotes and photo-mode stickers.

## What players get

- **EXTRAS > SEASON** (top-left button of EXTRAS). The screen has:
  - A themed header: month, theme name and tagline, tier, a season XP bar to the next tier, time left in the season, and **CLAIM n**.
  - **The track**: 50 tier cells in a 10×5 grid. Each cell shows its tier number, a pixel icon (8×8 SVG) and the reward name.
    - Earned but unclaimed tiers glow green, with a blinking ring.
    - Claimed tiers get a lime corner pip, or a yellow pip if you're wearing that item.
    - Locked tiers are dim. The next tier shows a mini progress bar.
    - Clicking a lit tier claims up to it. Clicking a claimed cosmetic wears it, and clicking again takes it off.
  - **Detail panel**: follows the focused tier. It shows the kind, where the item shows up, and its state (ready, locked with the XP still needed, worn, wear).
  - **WEEKLY CHALLENGES**: three bars with their season XP and the time to the weekly reset.
  - **HOW TO EARN**.
  - **PAST SEASONS**: month, theme and the tier reached.
- **Claim moment**: claimed cells pop (a 3-step scale with a white flash). A **NEW!** box lists the new cosmetics with their icons, plus any profile XP, with 12 pixel sparks. It plays the `achievement` sample, or `trophy` when the claim includes tier 50 or the champion title. With REDUCE FLASHING on, there is no blink, pop or sparks. If the filler XP raises your profile level, you get meta2's level-up toast and sound.
- **Title banner**: on screens wider than 900 px, a compact card sits under the PROFILE badge at the top right. It shows SEASON, the theme name, "n TO CLAIM!" (blinking), the tier, a bar and the time left. Clicking it opens the track. Below 900 px it flows under the main menu.
- **In-run and game over**:
  - Toasts: "SEASON TIER n! Claim it in EXTRAS > SEASON." and "SEASON CHALLENGE: …" (with the `quest_done` sample).
  - A SEASON strip on the game-over summary, under meta2's PROFILE strip. It shows the tier, theme, bar, +season XP, a CO-OP +10% tag and the claim count. Its tooltip gives the run/challenge split.
- **Month rollover**: tiers you earned but didn't claim are claimed for you. Nothing is lost. The old season goes to PAST SEASONS and a toast says so.

## Themes and rewards (src/data/season.ts)

There are 12 themes:

| | | | |
|---|---|---|---|
| Sunburst Summer | Neon Nights | Frostbite Fest | Jungle Rumble |
| Arcade Fever | Cosmic Drift | Sugar Rush | Pirate Tide |
| Robo Rally | Blossom Breeze | Volcano Party | Thunder Parade |

Each year plays all twelve, in an order shuffled by the year (`themeFor('YYYY-MM')`). October 2026 is Cosmic Drift. Every colour comes from Sweetie 16, and none is the enemy magenta.

Each theme has 11 cosmetics at fixed tiers (`TIER_SLOTS`):

| Tier | Reward | Where it goes |
|---|---|---|
| 1 | Photo sticker (word sticker, e.g. SPLASH!) | Photo mode sticker cycle |
| 4 | Banner colour | PROFILE, lobby card |
| 8 | Title (e.g. Star Pilot) | PROFILE, title panel, lobby cards |
| 12 | Second photo sticker | Photo mode |
| 16 | HUD theme | Timer, level badge, combo tint |
| 20 | Trail | Three colours cycled per dust puff |
| 25 | Skin | WARDROBE: owned season skins appear there |
| 30 | Pet hat | 12 new hat meshes: sun hat, headphones, earmuffs, explorer hat, propeller cap (spins), antenna bobbles, cupcake, tricorn, robo visor, flower crown, viking helm, wizard hat |
| 35 | Emote | Equipped on the SEASON screen, it becomes a **seventh slice** on the ping wheel's EMOTES page. Each has its own 8×8 glyph, bubble line and bark. |
| 40 | Colour set (a second skin) | WARDROBE |
| 50 | Champion title (e.g. Cosmic Champion) | Same as titles |

The other 39 tiers pay profile XP: 100 + 4 × tier, rounded to 10, so 110 to 300. A cosmetic you already own (its theme came round again a year later) pays 250 profile XP instead.

## Tuning (`seasonTuning`, `CHALLENGE_XP`)

| What | Value |
|---|---|
| Tiers | 50 |
| Season XP per tier | 250 for tiers 1-5, then 400 (19,250 for the whole track) |
| Season XP per run | the profile XP the run banked (time, kills, bosses, stages, quests; capped at 4,000 by meta2) |
| Co-op bonus | ×1.1 on top of profile XP's own ×1.25 (online or local co-op, 2+ heroes) |
| Weekly challenges | 3 per ISO week (Monday 00:00 UTC): one feature, one medium, one hard, all on different stats |
| Challenge XP | feature 800, medium 500, hard 700 season XP (2,000 a week) |
| Filler tiers | 100 + 4 × tier profile XP |
| Duplicate cosmetic | 250 profile XP |
| Past seasons kept | 24 |

Expected pace: a ~15-minute run banks about 500 XP. Weekly challenges give about 8,700 season XP a month (about 21 tiers). Finishing the track takes the challenges plus about 20 runs a month. Casual players reach the skin (tier 25) and hat (tier 30).

The challenge pool:

- **Feature**: Clear a raid; Win a race; Reach SS style rank; Win a gold medal in 3 trials (only offered once a lane feeds `trialGolds`).
- **Medium**: 1,500 kills; 3 bosses; 15 elites; 15 chests; 25 parries; 2 co-op stages; a 200 combo; 2 evolutions in one run.
- **Hard**: 5,000 kills; 10 stages; 2 flawless stages; 4 mini-bosses; clear a loop; Endless wave 6; 40 perfect dashes.

Sum stats add up over the week; peak stats keep the best run.

## Co-op

Each player progresses their own track, all locally. Every machine banks its own run through meta2Bank, so clients bank too, with the host's counters merged by meta2. Raid clears are seen locally from `raidRuntime(g).state.phase === 'won'`, which clients mirror via `rd`. Race wins are seen from `g.race.final` (a unique 1st place among 2 or more rows).

Nothing new travels in snapshots:

- Season skins are ordinary `SKINS` ids that already travel in hello/start.
- Season emotes are registered into `EMOTE_BY_ID` on every machine, so the host accepts them and teammates draw their bubbles and glyphs.
- Season titles and banners reach lobby cards through meta2's `pf` summary. The ids resolve on every machine because the catalog is static.
- Hats, trails and HUD themes stay local, as meta2's do.

## Hooks for other lanes

- `seasonCount(g, key, n = 1)` (src/game/systems/season.ts) advances this machine's challenges right away.
- A trials/medal lane should call `seasonFeeds.add('trialGolds')` at module load, then `seasonCount(g, 'trialGolds')` for each gold medal. Until then, the trials challenge is never rolled.

## Save (v9)

`save.seasonPass` holds: season, xp, claimed, owned, emote, week, ch, prog, done, total and past. `normalizeSeasonPass` cleans every field:

- Claims are clamped to the tier reached.
- Unknown items are dropped.
- The equipped emote must be owned.
- Challenge progress is clamped to its goal.
- Past seasons need a known theme.

Older saves load with an empty pass. The first visit to EXTRAS or SEASON, or the first banked run, starts the current season at tier 0.

Ownership hook: `rewardHook.owns` in profile.ts is installed by save.ts. Season profile rewards are owned through the track, never by level. Owned ones are pushed into `PROFILE_REWARDS`, so the PROFILE picker cycles them. All of them are in `REWARD_BY_ID`, so equips and lobby summaries resolve.

The title screen never writes the save: the banner shows `seasonView()`, a rolled copy. This keeps worldGame's "the demo saves nothing" check true.

## Files

- **New**:
  - `src/data/season.ts`: themes, items, calendar, track, challenges, save, and the pure progress rules
  - `src/game/systems/season.ts`: bank, live counters, claims, equips, emote wheel, hats, game-over strip
  - `src/ui/seasonScreen.ts`: SEASON screen and title banner, with its own CSS
  - `src/i18n/season.ts`: 215 en + ar entries
  - `src/dev/seasonLinks.ts`
  - `tests/seasonpass.test.ts`: 80 checks
- **Small shared edits**:
  - `src/game/systems/meta2.ts`:
    - `seasonBank` in meta2Bank
    - `seasonFrame` at the top of meta2Frame
    - season hats ahead of `hatMesh`
    - multi-colour trails through `REWARD_BY_ID[trail].colors`
  - `src/data/profile.ts`: `season` and `colors` on ProfileReward, `rewardHook`, one line in `rewardOpen`
  - `src/game/save.ts`: v9, the `seasonPass` field and normalize, the hook install
  - `src/data/skins.ts`: `season` on SkinDef and `...SEASON_SKINS`
  - `src/ui/screens.ts`:
    - `'season'` in ExtraScreen
    - `skinUnlocked` checks season ownership
    - the wardrobe hides unowned season skins
  - `src/game/teamPlay.ts` and `src/ui/pingWheel.ts`:
    - the EMOTES page comes from `emoteWheel()`
    - `wheelSlice(..., n)`
    - the wheel is rebuilt when the equipped season emote changes
  - `src/ui/photoMode.ts`: owned season word stickers join the sticker cycle and draw as word stickers
  - `src/i18n/en.ts` and `ar.ts`: one import and one spread each
  - `src/dev/testLinks.ts`: one line

## Test links

- `?test&sptier=17&spclaim=12&spweek=0.5&sppast&spscreen=season`: the SEASON screen. Add `&spscroll` for its lower half and `&lang=ar` for Arabic.
- `?test&sptier=31&spclaim=22&spscreen=season&spclickclaim`: the claim reveal.
- `?test&sptier=9&spclaim=4&screen=title`: the title banner.
- `?test&mate&wheel=emotes&spown=all&spequip=sp_storm_emote`: the seven-slice emote wheel.
- `?test&m2pet=bit&spown=all&spequip=sp_arcade_hat,sp_arcade_trail,sp_arcade_skin`: hat, trail and skin in play.
- `?test&photo=2&spown=all&stickers=sp_neon_sticker1@0.3,0.4`: season stickers in photo mode.
- `spmonth=2027-03` pretends it is another month, to see another theme.

Screenshots checked (untracked):

- `shots/sp-screen.png`, `sp-screen2.png`, `sp-screen-ar.png`
- `sp-claim.png`
- `sp-title.png`, `sp-title-ar.png`
- `sp-wheel.png`

## Checks

- `npm run typecheck` and `npx vite build`: pass.
- `npm test`: `seasonpass.test.ts` passes (80 checks), as do meta2, i18n and the rest, except three files:
  - **`coopplayCoop.test.ts`** fails the same way on the untouched base commit. The identical base bundle fails when run from `node_modules/.tests/` (where run-tests puts it) and passes from another path. It is environmental, not this lane.
  - **`raceCoop.test.ts`**: failed once (`rounds` of undefined in pvpOver) and passed on a rerun.
  - **`worldGame.test.ts`**: the first run caught a real issue. The title used to start the season and mutate the save; that is now fixed with `seasonView`. Its remaining occasional failure is the known "demo steps are cheap" timing budget.
- `npm run smoke`: passes.
- `npm run coop`: the host and client played the full scripted session, including a reconnect, with 701 snapshots (average 1,531 B, max 9,041 B). It reported one failure: the **trading** gold check (`host gold [7,13]` vs `client 13 / mate 7`). The untouched base commit fails the same check the same way, so it is not this lane.
- Per-frame cost: `seasonFrame` measures about 0.5 µs per frame in the unit test, with no allocation on ordinary frames.

## Unfinished or risky

- **Photo stickers screenshot**: `?test&photo=2` didn't open photo mode within the screenshot wait on the loaded build machine, so the season stickers were checked by code path only (they reuse the word-sticker renderer).
- **The game-over strip doesn't show in `?test&die=` runs** (meta2's doesn't either: test-link runs don't bank). The unit test covers the strip.
- **Arabic word stickers** use the localized text, like the stock POW!/GG! stickers.
- **Hat sizes**: pet hats are tuned for the default pets and not checked on every pet model, same as meta2.
- **Week boundaries**: weeks reset on ISO weeks (UTC), seasons on local months. A week can straddle two seasons; challenge XP goes to the season that is current when the challenge completes.
- **No server check**: everything is local, so editing the save or clock unlocks cosmetics. That is acceptable for a free, cosmetic-only track.
