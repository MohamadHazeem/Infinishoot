# Onboarding lane

Training field, first-time tips, the Codex, unlock progress and the end-of-run recap / build card.

## Built

- **TRAINING field** (title menu entry TRAINING; offered once on a fresh save with a NEW HERE? panel on the title, NO THANKS dismisses it for good). It starts an ordinary solo run (fixed seed, Easy, starting shop skipped) and then holds the director every step (`director.time = 0`, `countMul = 0`, `chestT = 0`), turns god mode on and tops life up. No forked loop: everything runs through `Game.update`. Nine steps, each completes when you do it:
  MOVE (walk 8 m) · AIM AND FIRE (pop 3 target bots) · RIGHT CLICK (Expose the big bot) · DASH (dash with a pink shot within 3 m, or a perfect dash) · PARRY (`skill.parried > 0`) · SPECIAL (meter set full; fire it) · ULTIMATE (charge set full; fire it) · LEVEL UP (XP granted; pick a card) · TREASURE CHEST (one placed nearby; walk in).
  Target bots are swarmers spawned with `speedMul 0.02, dmgMul 0`, placed up the screen so the prompt panel never covers them; training shots are slow enemy bullets (damage 1, god mode anyway). A step done flashes the panel, says NICE!, waits 0.9 s, then the next one starts. SKIP STEP appears after 12 s. After the last step: YOU'RE READY! (statuses and combos, Mod order, style meter, evolutions, where tips and the Codex live) with START A RUN / TITLE. Pause > QUIT RUN leaves training without banking a run (`quitRun` checks `onboarding.training`).
- **First-time tips** (src/game/tips.ts): a pixel panel at the left (top-left while a menu is open) that drains over 5-10 s, closable with its X, never pauses. Shown once per save (`save.tips`), queued one at a time; menu tips (level-up, evolution fork, shop, Mod order) jump the queue and only show while their menu is open. Tips: level-up, evolution fork, shop, Mod order (2+ Mods owned in the shop), elite, Exposed, statuses, status combo (Overload, Shatter or Napalm), boss, chest, special ready, ultimate ready, style rank B, gear, portal, you're down (co-op), teammate down (co-op). Key names come from the player's bindings. SETTINGS > TIPS ON/OFF and RESET TIPS. Detection only reads game state every 10 steps, so it works on solo, host and clients with no messages (clients: combos are only detected for Overload/Shatter that the snapshot shows; see risks).
- **Codex** (EXTRAS > CODEX, src/data/codex.ts): 8 tabs (weapons 22, specials 5, items 26, Mods 54, relics 18, combos 6, evolutions 42, statuses 7 = 180 entries) with icon (`iconHtml`), name, rarity (not for loadout items), kind/slot or recipe, tags and text; undiscovered entries are a dark silhouette of the icon and ???. Each tab shows x/y; the screen shows "x / y DISCOVERED". Discovery (`save.discovered`, keys `w: sp: p: m: r: c: e:<item>:<k|auto> s:`) is noted when you own something (weapons, evolutions, special, passives, Mods, relics, combos), are offered it (level-up cards, shop Mods, the relic offer) or see a status on an enemy.
- **Unlock progress** on game over: the 3 locked achievements you are closest to, with a 10-segment bar, "Rail Driver 18/25 elites" (lifetime stats after banking; one-run feats like Speedster and Full Arsenal read the run that just ended; mode feats only show in that mode). src/data/unlockProgress.ts.
- **Run recap**: `RunRecorder` (src/game/runRecap.ts) samples the run every 10 steps into per-stage rows: level at the end, damage (this hero's `damageBy` total), gold earned (rises only, never the free starting gold), kills, time on the stage and boss kill time (boss seen until it's gone). Game over shows the last 6 stages as a pixel table with DPS and kill bars.
- **BUILD CARD** (game-over button): src/ui/buildCard.ts draws a 640x360 pixel card at 2x on the Sweetie 16 palette (score, stage, level, kills, time; hero and mode/difficulty; loadout with ranks/EVOLVED; auto weapons and items with levels; Mods in slot order; relics) using the same 24 px icon sprites, then saves it as `InfiniShoot-build-<date>-stage<n>.png` via a download. The desktop app already turns downloads into a Save dialog; electron/main.cjs now titles it "Save InfiniShoot build card" and starts in Pictures for PNGs.

## Files

New: src/game/onboarding.ts (controller), src/game/training.ts, src/game/tips.ts, src/game/runRecap.ts, src/data/codex.ts, src/data/unlockProgress.ts, src/ui/onboarding.ts (DOM + injected CSS), src/ui/buildCard.ts, src/dev/onboardingLinks.ts, tests/onboarding.test.ts.

Shared files touched (small):
- src/game/game.ts: import, `readonly onboarding` field, `new Onboarding(this, hudRoot)` in the constructor, `this.onboarding.step(dt)` at the top of `update()` (all roles).
- src/ui/screens.ts: `ExtraScreen = 'codex' | 'training'` added to `ScreenName`; `addScreen(name, el, navOpts)` registry; `onShow` hook called in `show()` before focus; `nav(name)` helper used by `show`/`update`. No markup changes: TRAINING (title), CODEX (extras), TIPS / RESET TIPS (settings), the offer panel, the game-over panels and BUILD CARD are injected by src/ui/onboarding.ts.
- src/game/save.ts: version 4; `tips`, `discovered`, `training: {offered, done}` with defaults and `normalize()` lines.
- src/game/settings.ts: `tips: boolean` (default true, `??=` for old settings).
- src/game/systems/runFlow.ts: `quitRun` leaves training without banking.
- src/game/systems/statuses.ts: Napalm blasts bump `onboarding.napalms` (combo tip and Codex).
- src/dev/testLinks.ts: one call to `onboardingLinks(game, q)` and a header line.
- src/ui/debugPanel.ts: Onboarding folder (start training, skip step, trainingTuning).
- electron/main.cjs: Save dialog title/folder for PNG downloads.
- tests/smoke.test.ts: the bot plays 40 s of training; the codex screen is shown with the others.

## Knobs

`trainingTuning` (src/game/training.ts, debug panel > Onboarding): seed, moveDist 8, targets 3, targetDist 7, shotEvery 1.7 s, shotSpeed 6.5, shotFrom 9 m, bombCluster 6, skipAfter 12 s. Tip times: `TipDef.time` or 5-9 s by length (`tipTime`).

## Test links

- `?test&training` (step 1), `?test&training=6` (start at step 6), `?test&trainingdone` (ready screen)
- `?test&offer` (title with the training offer)
- `?test&tip=boss` (any tip id), `?test&lvlup&tip=levelup` (tip over the level-up cards)
- `?test&screen=codex&discover=60` (or `discover=all`)
- `?test&recap` (made-up 4-stage run, then game over with unlocks + timeline), `?test&recap&card` (the build card drawn on top)

## Verification

- `npm run typecheck`, `npm test` (17 files, including tests/onboarding.test.ts: codex data, unlock progress, tips rules, recorder, v3 -> v4 save migration and file round trip, and in jsdom: offer once, all 9 training steps completed by their actions, ready screen pauses the world, leaving restores god mode, quitting banks nothing, tips (shop, elite, off/on, X), discovery, game-over panels, codex tabs), `npm run smoke` all pass.
- Played the whole training in headless Chromium with real input (keyboard, mouse left/right, Space, C, Q, V, 1, walking into the chest): every step completed and the ready screen showed.
- Screenshots checked: title offer, training steps 1, 2 and 6, chest step, ready screen, boss tip in a run, level-up tip over the cards, codex (weapons tab, mixed discovered/???), game over with unlocks + timeline, build card PNG.

## Unfinished / risky

- Co-op clients: the recap's damage/DPS reads `hero.damageBy`, which only the host fills, so a client's DPS column is 0; Napalm is only noted on the host; level-up/shop offers are only marked "seen" on the host (clients still discover what they own).
- The training uses the normal stage-1 arena, so its stage objective panel, weather and arena toys still show (god mode keeps it safe). A dedicated small arena would need the WORLD lane.
- Tips can overlap the left edge of the level-up cards or shop on narrow windows (they move to the top-left while a menu is open).
- Codex entries are focusable for gamepad scrolling, so the Codex grid has 20-60 nav stops per tab.
- The ready screen's tutorial text is static; if the STYLE/combo numbers change (statusTuning), its wording stays generic on purpose.
- Not verified: the Electron Save dialog for the PNG (no desktop build here), touch input in training.

## PLAN.md decision-log paragraph

- 2026-10-19: Onboarding (onboarding lane, notes/lanes/onboarding.md). New players get a TRAINING field (title menu; offered once on a fresh save): an ordinary solo run with the director held, god mode and nine steps that each complete when you do them (move, aim and fire, right click / Expose, dash through a shot, parry, special, ultimate, pick a level-up card, open a chest), then a "you're ready" screen. First-time tips (17, from first level-up to a co-op teammate down) show once per save in a small panel that never pauses, with SETTINGS > TIPS and RESET TIPS. EXTRAS > CODEX lists all 180 weapons, specials, items, Mods, relics, combos, evolutions and statuses, revealed as you own, pick or are offered them. Game over adds the three closest unlocks with progress bars, a per-stage timeline (level, DPS, kills, gold, time, boss kill time) and a BUILD CARD button that saves a pixel-art PNG of the build. Save v4 adds `tips`, `discovered` and `training`; Screens gained `addScreen`/`onShow` so other modules can add screens without editing its markup.
