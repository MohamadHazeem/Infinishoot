# Finisher lane

## Player-facing changes

- **Boss finishers.** The killing blow on a stage boss (King, Rex, Queen) or Omega plays a short comic finisher before the boss dies: a freeze-frame (the world dims under an ink screen with manga focus lines on the boss), then the screen splits into two comic panels over ink bursts and focus lines: the hero close-up on the left (determined, then grinning as the shot lands), the boss on the right (shocked, then a white hit flash and a hurt face with a starburst). An arm-cannon beam crosses the seam, the screen shakes, and a big **K.O.!** title slams in with "<BOSS> DEFEATED!" (Omega: **FINAL K.O.!** / "OMEGA OVERLORD FALLS!"). Yellow caption boxes name the hero and the boss. Then the panels slide off and the existing boss death plays as before: explosion chain, kill-cam, STAGE CLEAR / VICTORY. Samples `finisher_whoosh` (panels in) and `finisher_hit` (the hit), with synth fallbacks; the music ducks while it plays; controller rumble on the hit.
- Any key (except Esc, which pauses), click or pad button skips to the exit wipe after 0.3 s.
- **Character portraits.** Painted 32x32 pixel busts generated on canvas (no image files): the four heroes in any skin (and in co-op armour colours), King Bopper, Rampage Rex, Hive Queen, Omega Overlord (mini-bosses reuse their parent's design in their own colours, anything else gets a generic one-eyed blob) and the announcer, "MC Tube", a TV-headed robot host. Six expressions each: neutral, determined, hurt, grinning, shocked, victorious, plus a blink.
- **HUD face** next to the life bar (life bar, gold row and co-op team list move right to make room). It blinks, and reacts: hurt for 0.5 s after a hit (with a shake), shocked under 30% life (red ring), grinning at S rank or better, a 50+ combo or during an ultimate, determined while a boss is up or while charging, victorious on stage clear / shop / during the finisher, grey and hurt while downed.
- **Pop-ins**: a framed portrait with a speech bubble that types out, sliding in from the side (heroes and announcer on the left, bosses on the right, at most two per side, the same speaker updates in place):
  - the announcer whenever it speaks (GO GO GO!, PARRY!, S RANK! STYLISH!, STAGE CLEAR!, ...),
  - a boss when it arrives (after its intro card), on each phase change, and gloating when you go down,
  - co-op pings: the pinging player's face with the ping label (HERE!, CHEST!, ELITE!, BOSS!, PORTAL!) on every screen.
- **Settings**: BOSS FINISHERS and CHARACTER POP-INS (both on by default).
- **Accessibility**: REDUCE FLASHING (also the game's reduced-motion switch) or the OS reduced-motion preference gives a calm 1.5 s finisher: no white flash, no shake, panels and title appear without slams; pop-ins appear and leave without sliding and their text shows at once.

## How it works

- `src/game/systems/characters.ts` (Game methods): `finisherCatch` is the first line of `killEnemy`. On the host, for a stage boss (not mini-bosses, not PvP, mode `fight`, setting on) it keeps the boss alive at 0 HP, records who landed it and sends a team-wide `'F'` effects event (`game.vfx.finisher(bossId, heroIndex, x, z)`). `finisherHold` runs in `Game.update` right after the hit-stop block: while the finisher plays it skips the simulation (snapshots keep flowing), then calls `killEnemy` for real, so everything after it (drops, corpse and kill-cam, `bossBoom`, slow-mo, relics, stage clear) is unchanged. A second kill of the held boss is swallowed. The host's own skip shortens the hold to the exit wipe.
- Every machine plays the overlay locally when the `'F'` event arrives (`onFinisher`); clients' views of the boss stay frozen because the host is holding. The overlay is `src/game/finisher.ts`: a low-res canvas (about 320x180, one canvas pixel = 4-6 screen pixels, pixelated, palette colours, rebuilt per pixel each frame from precomputed angle/distance tables, so lines and bursts stay crisp) plus DOM title and captions. It pauses with the solo pause menu.
- Portraits: `src/ui/portraitArt.ts` paints pure RGBA (sphere-shaded shapes lit from the top left, hue-shifted ramps, checker dither at band edges, ink outline) and caches canvases; `src/ui/portraits.ts` is the HUD face and pop-in layer. **API for other lanes: `portraits.popIn(who, expression, text?, seconds?)`** with `who` = `'announcer'`, `'boss:<enemy id>'`, `'hero:<player index>'` (or `'hero:<hero id>'`). It is local; for a team-wide pop-in from the host use `game.vfx.portrait(who, expression, text, seconds)` (`'P'` effects event).
- Announcer pop-ins hook `announcer.onSay` (new, called when a line starts playing; so they only appear when the voice actually plays). Boss entrance/phase/gloat pop-ins are worked out locally from synced state (boss def and phase), so co-op needs nothing new. Boss lines are in `BOSS_LINES`, announcer texts in `ANNOUNCER_LINES` (characters.ts).

## Tuning

- `finisherTuning` (finisher.ts): length 2.1 s (calm 1.5 s), freeze-frame 0.14 s, panels in over 0.2 s (4 steps), hit at 0.36 s, title at 0.5 s, exit wipe 0.3 s, skips ignored for 0.3 s, shake 3 canvas pixels x the SCREEN SHAKE slider.
- `portraitTuning` (portraits.ts): pop-ins 2.6 s by default, typing 48 chars/s, 2 per side, blink every 3.4 s (0.13 s, a double blink every third), hurt face held 0.5 s.
- Both are in the debug panel (Camera > Finisher & portraits).
- Cost: the HUD face and pop-in tick is in `ren.skill` in the bench (0.011 ms with it); the finisher canvas only draws while it plays (gameplay is frozen then). No per-frame allocations on the HUD face path (art is looked up only when look/expression/blink change).

## Files

- New: `src/game/finisher.ts`, `src/game/systems/characters.ts`, `src/ui/portraitArt.ts`, `src/ui/portraits.ts`, `tests/finisher.test.ts`, this file. CSS is injected by the modules (no style.css edits).
- Small hooks in shared files: `src/game/game.ts` (system fields, two effects-bus targets, the hold check in `update`), `src/game/vfx.ts` (`'F'` and `'P'` events, `finisher()` / `portrait()`), `src/game/systems/statuses.ts` (one line at the top of `killEnemy`), `src/game/systems/render.ts` (`renderCharacters` after `renderSkill`; `pingPortrait` in `ping`), `src/audio/announcer.ts` (`onSay`), `src/game/settings.ts` + `src/ui/screens.ts` (two toggles), `src/ui/debugPanel.ts` (tuning folder), `src/dev/testLinks.ts` (options below), `scripts/coop-test.mjs` (two scenarios: client ping portrait on both machines, boss finisher on both machines).

## Test links

- `?test&stage=2&bossnow&nointro&god&killboss=2&finat=0.7`: the boss finisher pinned 0.7 s in (try 0.1 freeze-frame, 0.3 panels, 0.42 the hit, 0.9 title, 1.9 exit). Without `finat` it plays through into the normal kill. `&calm` turns on REDUCE FLASHING, `&nofinish` turns finishers off. `stage=4` for Omega, `hero=ace` etc. for other heroes.
- `?test&face=shocked`: force the HUD face's expression. `&pops`: pop in the announcer, the boss and a ping (they stay 30 s).

## Checks

- `npm run typecheck`, `npm test` (17 files, including tests/finisher.test.ts: timeline, drawing helpers, all portraits paint, differ per expression, are crisp and outlined, HUD expression priorities, blink, typing, the host hold/skip/opt-out/mini-boss rules in the real game, effects-bus JSON round trip, ping and boss pop-ins, pop-ins setting), `npm run smoke` all pass.
- `npm run coop`: the finisher scenario passes every time (overlay playing on host and client, boss held, then gone, both cleared) and so does the ping portrait; the bots' own boss kill also went through the finisher with the client in sync. 3 of 5 runs passed; the 2 failures were early, timing-sensitive scenarios from other lanes (enemy mirror count at 18 s, jump pad at 24 s) while other builders loaded the machine; the base commit passed 2 of 2 runs at a quieter moment, so I can't fully rule it out, but neither failure touches anything this lane changes.
- Screenshots checked: freeze-frame, panels, hit, title, exit, after (kill-cam + STAGE CLEAR, HUD face victorious), Omega FINAL K.O. with Ace, King with Bulwark, Queen with Dash in calm mode, pop-ins (announcer, ping, boss), boss entrance pop-in, co-op client HUD face in the player colour.

## Notes for integration / risks

- While the finisher holds (2.1 s), the host doesn't move remote heroes; a client that keeps walking under the overlay is smoothed back in after the release (a one-off "desync?" line in the co-op log, not a failure).
- The host's REDUCE FLASHING setting sets the hold length (1.5 s calm); a client with full finishers then sees its exit cut 0.6 s short. Each machine's BOSS FINISHERS setting only hides its own overlay; the host's setting decides whether the finisher (and hold) happens.
- Boss defeat voice lines (`boss_<id>_defeat`) are left to the voices lane: the boss now dies 2.1 s after the killing blow, at the end of the finisher, so hooking them on the corpse/kill keeps them after the K.O. Boss pop-in text is in `BOSS_LINES`; if the voices lane pops bosses in itself with the same `who`, it replaces the text in place.
- Existing layout issue (not from this lane): in co-op the team list (`#team`, top 78 px) sits under the objective box (`#objective`, top 87 px), so teammates' bars are mostly hidden. The HUD face moves the team list right with the life bar but doesn't fix that overlap.
- PLAN.md decision log not edited (shared file); the lead can lift a paragraph from this file.
