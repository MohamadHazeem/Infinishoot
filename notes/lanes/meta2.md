# meta2 lane: long-term goals (cosmetic only)

Every run still starts equal: nothing here touches stats, loadouts or drops. The lane adds about 100 achievements, a profile level (1-100) with cosmetic rewards, daily quests, and a PROFILE page.

## What players get

- **ACHIEVEMENTS** (EXTRAS > ACHIEVEMENTS): 104 in total, the 21 classic ones plus 83 new ones. Each has a medal (36 bronze, 33 silver, 15 gold among the new ones; the classic ones were given medals too) and sits in one of 11 categories: Item Unlocks, Combat, Bosses, Skill, Builds, Modes, Ascension (heat at a loop clear), Co-op & PvP, Heroes & World, Profile, Secrets. Seven are hidden and show as `???` until earned. Cards show a progress bar for anything measurable (the classic ones reuse `unlockProgress`) and the date they were earned. Earned cards come first (newest first), then the closest to done. UNLOCKS on the title menu now lists only the classic achievements, the ones that unlock items.
- **Unlock toast**: `★ GOLD · Name`, with the recorded `achievement` sample (falls back to the synth power-up). The classic achievements use the same toast now (runFlow.checkAchievements calls `achievementToast`).
- **Profile level**: XP from every finished run, and from quests. Level 100 needs 131,175 XP. A typical 15-minute stage-3 run earns about 500 XP, so level 10 comes after 5-6 runs and level 100 after a few hundred. Levels unlock 46 cosmetics. Five more come from quest totals (3, 10, 20, 45 and 90 quests done). The kinds are:
  - **Titles**: shown on the profile, the title panel, lobby cards and the game-over strip.
  - **Banner colours**: the profile header, title panel and lobby card.
  - **HUD themes**: tint the timer, level badge and combo.
  - **Pet hats**: a cap, party hat, top hat, crown, horns, halo or beanie on your pet.
  - **Trail colours**: dust behind you while you move, including a rainbow.
- **Level-up moment**: at game over the XP is banked. A level-up plays the `profile_level` sample and shows a toast naming the new cosmetics. The game-over screen gets a one-line strip (LV, title, XP bar, +XP, with the breakdown in its tooltip). When you level up, a blinking "PROFILE LEVEL UP!" line is added; it doesn't blink with REDUCE FLASHING on.
- **Daily quests**: three a day (one easy, one medium, one hard, each on a different stat), seeded by the local date, so everyone gets the same three. Progress adds up over the day's runs. A quest that finishes mid-run gets a toast and the `quest_done` sample at once; its XP is paid at game over. Rewards are 120, 220 and 360 XP, plus 250 for doing all three. Doing all three on consecutive days builds a streak. A **QUESTS panel on the title** shows the profile level, the three quests with bars, the time to the next reset and the streak. Clicking it opens PROFILE. It is hidden below 900 px width.
- **PROFILE** (EXTRAS > PROFILE): a banner with the level, title and XP bar, then:
  - a cosmetics picker: click a kind to cycle through what you own; hats and trails can be set to none
  - a "coming up" road showing the next six level rewards
  - 16 lifetime stats
  - favourites: your hero, kit and most-defeated enemy
  - kills by enemy (top 10, veterans folded into their base enemy)
  - bosses beaten
  - co-op & PvP stats
  - your best run per mode
  - a timeline of your best runs (top 12 by score, in date order)
- **Co-op lobby cards** show each player's `LV n TITLE` on their banner colour (`hello` carries `pf`; the host keeps it in `LobbyEntry.pf` and passes it to `LobbyView.players`). The lobby lane can read `profileSummary()` from systems/meta2.ts or `LobbyEntry.pf`.
- **Arabic**: 289 new catalog entries (en + ar) cover every name, description, quest, reward and label. Composite lines are built from separately localized spans, and times are kept LTR.

## How it works

- `src/game/systems/meta2.ts` keeps a **run tally**: a flat record of counters (keys listed in `STAT_NAMES`, src/data/profile.ts).
  - **Host or solo**: `meta2Kill`, called from `killEnemy` (statuses.ts), counts your kills, kills by weapon tag (`k_fire` and the rest), elites, veterans, Goldbugs, Reapers and kills per enemy id (`e:<id>`). Bosses and mini-bosses count for the whole team, per boss (`b_king`, `b_titan`, `b_remix`...). `meta2Event`, called at the top of `mods2Event`, counts parries, perfect dashes, ultimates, cash-ins, mech rides, chests and rewinds.
  - **Every machine** polls its own hero at 10 Hz from `meta2Frame` (render.ts) for:
    - stage clears, flawless clears and co-op clears
    - style rank, combo, gold and level peaks
    - evolutions and fusions held
    - super-weapon crates, comebacks, revives of teammates within 4.5 m, last stands and close calls (`radioEvents`)
    - islands, heroes and modes played, and world events lived through (credited when you clear the stage)
    - rhythm and pacifist stages, mini-games
    - photo mode, the secret merchant, jackpots and golden routes
    - EXTRAS pages opened

    Sets travel in the tally as `s:<set>:<id>` keys.
  - **Clients** get the host's counters for their hero in the game-over summary (`RunSummary.m2`, added in runFlow.summary) and merge them with their own by max. A client that leaves mid-run banks nothing (same as before for lifetime stats).
  - **PvP**: `pvpOver` banks the run, adding a duel and, for the winner, a win. **Versus**: matches, and wins for your side. **Local co-op**: player 1's profile (this machine's hero).
- **Banking** happens once per run, from `bankAndShow` → `meta2Bank` → `bankTally`, which is pure on the save and unit-tested. It adds the sums, keeps the peaks (`PEAK_STATS`), merges sets, counts kills by enemy, runs per hero and per kit, and updates the best run per mode and the timeline. Then it pays XP and quests, grants measured achievements and shows the moments.
- **Achievements** with a `track` are checked every second during a run and at banking (`checkMeta2Achievements`):
  - `life`: lifetime stat + this run
  - `run`: best single run
  - `set`: distinct ids
  - `has`: a specific id
  - `plevel`: profile level

  `grantAchievement` now stamps `save.achDates[id]`.
- The tracker never counts while the title demo runs (`saveLock`), in training, or on the title.
- **Cosmetics are local only.** Teammates don't see your pet hat, trail or HUD theme; they see your title, banner and level on the lobby card. The pet hat is a small mesh group added to `hero.petView.root` (retro materials, created once per change). The trail is `particles.soft.dust` puffs every 0.07 s while you move faster than 2.5 m/s, off on LOW and POTATO graphics. The HUD theme sets `--m2-hud` and an `html.m2-hud` class.

## Tuning (`profileTuning`, `meta2Tuning`, `QUEST_XP`)

| What | Value |
|---|---|
| XP per minute survived | 6 |
| XP per own kill | 0.1 |
| XP per elite | 5 |
| XP per boss | 50 |
| XP per stage cleared | 40 |
| XP per loop cleared | 200 |
| Co-op bonus | ×1.25 (online and local) |
| Most XP from one run | 4,000 |
| XP from level l to l+1 | 100 + 25 × (l − 1); level 100 = 131,175 XP total |
| Quests | easy 120, medium 220, hard 360, all three +250 |
| Tracker cadence | polls the hero at 10 Hz, checks achievements at 1 Hz; ~1 µs per frame measured in the unit test |

## Save (v5)

`save.profile` holds xp, stats, sets, killsBy, heroRuns, kitRuns, best, timeline and equip. `save.quests` holds day, ids, prog, done, all, streak and lastAll. `save.achDates` holds an earned date per achievement.

`normalize()` cleans every field: unknown cosmetics fall back to the default, a cosmetic of the wrong kind is replaced, junk numbers and sets are dropped, dates are kept only for owned achievements.

**Pre-v5 saves** get a seeded profile:
- stats from `lifetime` (runs, kills, elites, bosses, time, best stage and level; stages = bosses beaten)
- retroactive XP at the same rates, capped at level 40
- heroes played and the best-runs timeline from `history`
- islands from the codex's `biome:` entries

Old achievements are kept, but without dates. The meta and onboarding tests now expect version 5.

## Files

- **New**:
  - `src/data/profile.ts` (stat vocabulary, XP curve, rewards, lobby summary)
  - `src/data/quests.ts`
  - `src/game/systems/meta2.ts`
  - `src/ui/profileScreen.ts` (PROFILE and the title panel)
  - `src/ui/achievementsScreen.ts`
  - `src/dev/meta2Links.ts`
  - `tests/meta2.test.ts` (88 checks)
- **Owned**: `src/data/meta.ts` (tiers, categories, hidden, `track`, 83 new achievements, `ACH_BY_ID`) and `src/game/save.ts` (v5 fields, migration, dates).
- **Small shared edits**:
  - game.ts: method fields and `LobbyEntry.pf`
  - render.ts: one `meta2Frame` line
  - statuses.ts: one `meta2Kill` line
  - mods2.ts: one `meta2Event` line
  - pvpFlow.ts: one `meta2PvpOver` line
  - runFlow.ts: `startMeta2`, `m2` in the summary, `meta2Bank`, and the shared toast (its unused `sfx` import was removed)
  - online.ts and netHost.ts: `pf` in hello and the lobby
  - screens.ts:
    - `RunSummary.m2`, `ExtraScreen` names `profile` and `achievements`, `LobbyView.players[].pf`
    - the lobby card badge
    - UNLOCKS filters to the classic achievements
  - testLinks.ts: one line
  - i18n en.ts/ar.ts: an appended block
  - tests/meta.test.ts and tests/onboarding.test.ts: the version number

## Test links

- `?test&m2demo&m2lv=37&m2screen=profile`: PROFILE with filled stats.
- `?test&m2demo&m2screen=achievements`: ACHIEVEMENTS (category tabs; SECRETS shows the hidden cards).
- `?test&m2lv=14&m2quests=0.5&m2equip=b_teal&screen=title`: the title with its quest panel (the screen=title link keeps the test run's HUD behind it).
- `?test&m2lv=50&m2equip=hat_crown,tr_rainbow,h_lime&m2pet=bit`: hat, trail and HUD theme in play.
- `?test&m2lv=9&die=0.5`: the game-over strip.
- Add `&lang=ar` to any of these for Arabic.

Screenshots checked: shots/meta2-title.png, m2-title.png, m2-title-ar.png, m2-prof2/3.png, m2-prof-ar.png, m2-ach.png, m2-ach-ar.png, m2-go.png. They are untracked.

## Checks

- `npm run typecheck`, `npx vite build`, `npm run smoke`: pass. The smoke run plays every mode and hero, including a mortal game over that banks the profile.
- `npm test`: everything passes except:
  - `i18n.test.ts` "data name: Crosswind Blades": the weapons3 lane's untranslated names. It fails the same way on the base commit 751052c. Not touched here.
  - Timing and random checks that failed once each on an overloaded machine (load average over 100) and passed when rerun: `worldGame.test.ts` "demo steps are cheap" (a timing budget; the tracker returns early during the title demo) and `coop2Coop.test.ts` "the joiner's hero is built to the team's level" (7 random level-up picks where it wants 8; three reruns gave 9, 9, 8).
- `tests/meta2.test.ts`:
  - pure checks: XP curve and levels, rewards, quests (seeding, rotation, banking, all-three bonus, streak), achievement data integrity, v4→v5 migration and round trip, junk cleaning, banking sums and peaks
  - a real `Game`: kills by tag and enemy, events, bosses, flawless polling, the title demo not counting, game-over banking (idempotent), a client merging `m2`, all three screens, cosmetic cycling, the lobby summary and the pet hat
- `npm run bench`: not meaningful on this machine tonight (other builders saturate it: GL stalls, ~950 ms "CPU" frames, unrelated to this lane). The tracker itself measures about 1 µs per frame in the unit test, with no allocation except on the 1 Hz check.
- `npm run coop`: CO-OP TEST PASSED (host and client over the PeerJS broker: lobby with the profile card, run, jump pad, turret, pets; 146 snapshots, average 623 B, max 2,029 B). It was a short run because of the machine load.

## Unfinished / risky

- Cosmetics aren't sent over the network beyond the lobby card. Teammates' hats, trails and titles in-game would need a snapshot field (`m2`) for a later pass.
- Pet hats sit at a fixed height over every pet body; check them on each pet model.
- Some measured stats depend on other lanes' internals: `cineState().jack.won` / `goldenRide`, `worldEventOf`, `game.modes.rhythm/pacifist/mg`, `hero.play.superT`, `radioEvents`, `versus.winner`. If a lane renames these, the matching achievements stop progressing (no crash: all reads are optional).
- "Ascension" is the meta lane's heat: the peak `heat` stat is recorded only on runs that cleared a loop. If an Ascension system lands separately, point the four Ascension achievements at it.
- Retroactive XP for old saves stops at level 40, so veterans still have levels to earn. Old achievements show "EARNED" without a date.
- Quests roll over at local midnight (same as the Daily Challenge). Changing the clock can reroll them; nothing is lost but that day's progress.
