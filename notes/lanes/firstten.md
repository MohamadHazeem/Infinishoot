# Firstten lane: the first 10 minutes of a new player

Played the path a new player takes on a fresh save (title, training offer, PLAY SOLO, loadout, starting shop, stage 1, first level-up, first death) in headless Chromium with `scripts/firstten-flow.mjs`, screenshot every step, then fixed what got in the way.

## What players get

- **FIRST STEPS checklist** on the title (right side) for new saves: FINISH TRAINING, PLAY A RUN, REACH LEVEL 5, OPEN A CHEST, BEAT AN ELITE, BEAT A BOSS, EVOLVE AN ITEM, TRY CO-OP. Each row has a one-line hint, a segmented progress bar and the reward shown as swatches. Goals tick during a run with a toast ("FIRST STEPS 3/8 · OPEN A CHEST ✓"), or from lifetime stats on the title. All eight grant the new **Graduate** achievement, which unlocks the **Star Cadet** skin (WARDROBE). The title then shows ALL DONE! once; AWESOME! closes it for good. HIDE closes it early. Saves from before this lane with 5+ runs start with it hidden.
- **QUICK START** on PLAY SOLO for the first 3 runs: a strip under the title (first focus) that picks Rookie / Standard / Medium and goes to the loadout. At 720p the PLAY SOLO screen overflows (the difficulty row and NEXT button are below the fold), so a new player never has to scroll it.
- **First starting shop** (guided run): simple Mods that work with any kit (Pyromaniac, Hair Trigger, Patience, Quick Draw; Generalist as a spare) instead of niche ones like Shatterpoint or Overloader, with a GOOD FIRST PICK badge on Pyromaniac (visible flames on the first enemies). Rerolls use the normal pool. A helper strip: "FREE GOLD! Buy a Mod or two..." The first post-boss shop gets its own one-line strip (interest).
- **First level-up**: a side panel left of the cards (no vertical room at 720p; it falls back to a line above the cards below 1180 px wide): PICK 1 CARD, the five slot ribbons as coloured chips, NEW vs UPGRADE. The ribbons on the cards blink three times.
- **Helpers replace tips**: the level-up and shop helper strips mark the matching first-time tips as seen, so the tip panel and the strip never show together.
- **Tip pacing** (src/game/onboarding.ts): in-fight tips wait 3.5 s after the previous one and never show in the first 3 s of a stage (the stage banner). They queue by priority: boss and teammate down, boss incoming, elite, special, chest, then everything else. Menu tips still jump the queue.
- **Stage 1, every run**: the first chest lands 8 m in front of where you aim, 12 s in (rays fanned out until a clear spot). The regular 30 s chest clock restarts after it, so stage 1 keeps the same number of chests (8). Host broadcasts `chestspawn` as usual, so co-op clients see it.
- **Stage 1, guided runs** (solo Standard, lifetime runs < 3): the SPECIAL tip waits for the first swarm ring (21.6 s), with a "SURROUNDED! PRESS Q FOR YOUR SPECIAL" toast, so the first special lands on a crowd: the first big multi-kill. A heads-up toast 4 s before the first elite ("AN ELITE IS COMING! BEAT IT FOR A CHEST"), then the elite tip jumps the queue. A new BOSS INCOMING tip 20 s before the timer ends; the existing boss tip and the boss entrance follow.
- **Early levels for everyone**: level 1→2 costs 3 XP (was 6), 2→3 12 (was 15), 3→4 25 (was 28), the rest unchanged (`EARLY_XP` in src/game/firstten.ts, applied in `xpForLevel`).
- **Game over**: a NEXT TRY card under the K.O.: one encouraging line (first run: "FIRST RUN DONE! THAT WAS THE HARD PART.", reached the boss, later stage, or how long you lasted) and one suggestion picked from what killed you (`hero.lastHitBy`): every enemy behaviour, every boss, hazards and 'Enemy fire' have one, all with the player's real key names. Died in the first 75 s with fewer than 3 dashes: the lesson is dashing, whatever hit you. RETRY / TITLE moved right under the card (they were below the fold at 720p); RETRY has focus. Quits get no card.

## Stage-1 numbers (dev bot, default kit Buster / Charge Shot / Bomb, fresh save, 5 seeds each, mortal and god)

`tests/firstten.pacing.ts` (see its header for the command). Averages, mortal bot:

| | before | after |
|---|---|---|
| first level-up | 22.7 s (16.7-28.5) | 13.4 s |
| first chest on the map | 30 s, random spot | 12 s, 8 m ahead |
| first 8 kills within 1 s | 12.4 s | 7 s |
| level at 0:30 / 1:00 / 1:30 / 2:00 | 2 / 3.6 / 5.4 / 8.8 | 2.8 / 4.2 / 6.2 / 8.4 |
| level-ups in the first 90 s | 4.4 | 5.2 |
| enemies alive at 0:30 / 1:00 | 31 / 53 | 31 / 56 |
| first elite | 48 s | 48 s (now with a heads-up) |
| deaths in stage 1 | 0 / 5 | 0 / 5 |

The director's ramp (15 → 230 alive over the stage) was already gentle in the first 90 s, so it is unchanged; the early "wow" comes from the earlier first level-up, the chest in view and the special on the first ring. Levels at 2:00 and later converge back to the old curve.

## Knobs

`firstTenTuning` (src/game/firstten.ts): guidedRuns 3, firstChestAt 12 s, firstChestDist 8 m, ringPromptBy 40 s, eliteWarn 4 s, bossWarn 20 s, tipGap 3.5 s, stageQuiet 3 s. `EARLY_XP` [0.55, 0.75, 0.9]. `FIRST_SHOP` Mod ids. `TIP_PRIORITY` (src/game/tips.ts).

## Files

New: src/game/firstten.ts (rules and data: goals, next-try advice, tuning), src/game/systems/firstten.ts (`FirstTen` controller, `game.firstten`), src/ui/firstten.ts (DOM + injected CSS), src/dev/firsttenLinks.ts, tests/firstten.test.ts, tests/firstten.pacing.ts (bench, not in `npm test`), scripts/firstten-flow.mjs (walks the menus and screenshots them), scripts/firstten-probe.mjs (open a link, evaluate an expression).

Shared files (small, additive):
- src/game/game.ts: imports, `readonly firstten`, constructed after `onboarding`, `this.firstten.step(dt)` after `onboarding.step`, `earlyXpMul(level)` in `xpForLevel`.
- src/game/director.ts: `ringsSent` counter and a `nextEliteAt` getter.
- src/game/onboarding.ts: tip gap, stage quiet time and priority queue; the SPECIAL tip asks `firstten.specialTipReady()`.
- src/game/tips.ts: `bosssoon` tip, `TIP_PRIORITY`, `tipInsertAt`.
- src/game/save.ts: `firstten` field (fresh + `normalize()`, no version bump: missing field migrates).
- src/data/meta.ts: `graduate` achievement. src/data/skins.ts: `cadet` skin.
- src/dev/testLinks.ts: one `firsttenLinks(game, q)` call and a header line.
- The game-over screen's RETRY/TITLE row is moved under the NEXT TRY card at runtime (src/ui/firstten.ts), not in screens.ts markup.

## Test links

- `?test&fresh` title as a brand-new player (training offer + FIRST STEPS); `&ftgoals=run,chest` or `&ftgoals=all` (reward panel)
- `?test&ftmodes` PLAY SOLO with QUICK START
- `?test&ftshop` first starting shop (curated Mods, badge, strip)
- `?test&ftlvl` first level-up helper
- `?test&ftdie=Rhino` game over with the NEXT TRY card (`&ftat=50` stage time, `&ftdash=10` dashes; any cause, e.g. `ftdie=Enemy%20fire`, `ftdie=King%20Bopper`)

## Verification

`npm run typecheck`, `npx vite build`, `npm test` (incl. tests/firstten.test.ts: rules, migration, every enemy behaviour has advice, tip order and gap, and in jsdom a guided run end to end: curated shop, reroll, first chest at 12 s 8 m away, ring and elite heads-ups, level-up helper, goals ticking, game-over card with RETRY under it, reward and claim), `npm run smoke` (all 57 test files and the smoke test pass). `npm run coop` connected and played through, but the build machine was at load average ~120 (other builders), so its page load needed a longer timeout (temporary copy) and two timing-sensitive scenarios failed (jump pad, team move); the base commit 6e0a7e0 failed the same way under the same load (5 failures), so they are load, not this lane. Worth a re-run on a quiet machine. Screenshots checked at 1280x720: title (fresh, with goals, all done), PLAY SOLO, first starting shop, first level-up, game over.

## Unfinished / risky

- Not played by a person; the copy and timings are guesses checked only with the bot.
- The first chest is for every run's stage 1 (economy neutral: same count, first one earlier and closer). If veterans dislike it, gate it behind `firstten.guided`.
- Goals tick from whole-team state on co-op clients (a chest anyone opened, `elitesRun` only counts on the host). Online the "open a chest" goal can tick for a teammate's chest.
- `guided` uses lifetime runs, so quitting three runs early ends the guidance.
- PLAY SOLO still overflows at 720p for everyone; QUICK START only hides that for new players (screens.ts layout is shared).
- tests/meta.test.ts "lost cargo spawns a chest at twice normal cadence" is flaky on its own (a golden-chest roll from a random run seed); it failed once in a full run and passed 4/4 alone.
- tests/onboarding.test.ts was updated for the new rules: the first shop may show the helper strip instead of the tip, and the elite tip waits out the 3 s stage banner.
- GOOD FIRST PICK sits slightly left of the card centre (it is centred on the offer slot).

## PLAN.md decision-log paragraph

- 2026-10-19: First ten minutes (firstten lane, notes/lanes/firstten.md). Walked a fresh save through title, PLAY SOLO, loadout, starting shop and stage 1 with screenshots and the bot. New: a FIRST STEPS checklist on the title (8 small goals; all of them unlock the Star Cadet skin via the Graduate achievement), QUICK START on PLAY SOLO for the first 3 runs, a curated first starting shop with a GOOD FIRST PICK, one-time helper strips on the first level-up and shop (they replace the matching tips), tips spaced 3.5 s apart and queued by priority, and a NEXT TRY card on game over with one suggestion from what killed you (RETRY moved up under it). Stage 1: the first chest lands 8 m ahead at 12 s (the 30 s clock restarts, same chest count) and the first three levels cost less (3/12/25 XP, was 6/15/28); guided runs get a "use your special" moment on the first swarm ring and heads-ups before the first elite and the boss. Bot (5 seeds, default kit): first level-up 22.7 s -> 13.4 s, first chest 30 s -> 12 s, first 8-kill second 12.4 s -> 7 s, level at 2:00 unchanged (8.8 -> 8.4), no stage-1 deaths before or after.
