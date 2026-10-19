# pvp2 lane: PvP that's worth playing

## What players get
- **Formats** (host picks in the PvP lobby, saved locally as `pvp2.rules`): FREE-FOR-ALL (up to 8 players) or 2 TEAMS (players alternate BLUE / ORANGE in lobby order, friendly fire off, team win), ONE ROUND or BEST OF 3 (first to 2 round wins; a round with nobody standing is a draw, no point; a match lasts at most 5 rounds, then the most wins takes it, a tie is a draw).
- **4 dedicated PvP arenas**, one per loop-1 biome, built from authored layouts with 4-way rotational symmetry (every spawn sees the same arena). ROTATE (default) gives a new arena each round.
  - Thorn Garden (meadow): a grove in the middle, broken ruin corners, thorn beds (slow, and they scratch in PvP), crates and barrels, 4 jump pads into the middle.
  - Sandpit Ruins (dunes): a quicksand pit in the middle, 4 long walls, a ring of 8 pillars, quicksand patches outside.
  - Frost Court (peaks): an ice rink in the middle (slide), pine corners, low walls, 4 toppling pillars at the rink's edge, ice ponds outside.
  - Lava Crucible (magma): an obsidian cross splitting the arena into 4 rooms, lava pools on the diagonals (burn; knockback carries you in), 4 jump pads over the lava.
- **Rounds**: everyone back up at full life on their spawn, specials half charged, 3-2-1 (no damage), FIGHT. The red ring waits 20 s, closes to 6 m, holds 15 s, then collapses to nothing (sudden death: ring damage ramps +4%/s every 10 s), so every round ends. Round end: scoreboard (rounds, KOs, damage dealt) for 5 s, then the next round. Match end: winner banner, victory / defeat / draw voice per screen, back to the title.
- **Sound**: `round_bell` at round start and on the scoreboard, `vo_round_fight` / `vo_final_round` at round start, `vo_victory` / `vo_defeat` / `vo_draw` plus `victory_fanfare` / `defeat_sting` at the end (all on the UI bus, captioned, through the shared voice gate).
- **Spectating**: knocked out, you watch someone still standing (click / A / ping cycles, as in co-op) or press DASH for a FREE CAMERA (move to pan, clamped to the field). A bottom panel says who you watch, with prompts.
- **HUD in a duel**: top strip (round, format, players/teams left, win pips per player or team, ring state: RING CLOSES IN n / RING CLOSING / SUDDEN DEATH), the big 3-2-1-FIGHT!, team rings under heroes in 2-team games, the ring drawn as a translucent red wall plus a red tint outside. Co-op-only bits are hidden in a duel (stage timer, YOU'RE DOWN panel, REVIVE ME tags, ULT and REWIND pips) via a `pvp2-duel` body class.
- **Bots**: the host can + ADD BOT / - REMOVE BOT in a PvP lobby (up to 8 seats). Bots skip the stage; at the duel they get the loadout they were given plus automatic level-up picks for the players' average level (`botHero`, the same picks drop-in joiners get). The duel brain (`BotBrain`) strafes round the nearest opponent at ~9 m, leads its shots, stays inside the ring, dashes away from incoming shots, holds right click in bursts and fires the special up close. One human + bots is a playable PvP match.

## Balance decisions
- Specials: ON in duels (they're part of the build), recharge 1.6x slower, start each round half charged.
- Ultimates: OFF in duels (unchanged). They're screen-clearing horde nukes, their code (src/game/ultimates.ts, heroUlts.ts) skips stand-ins on purpose, and an ult that hit players would be a one-button kill.
- Revives: none in a duel (Second Wind and the pet revive are switched off per round); the Frost Totem relic (once per round) stays.
- Damage pacing: hits on a stand-in add to pending damage x `damageScale` x `sourceMul`; pending damage lands at most every 0.25 s (`landEvery`) as one hit, never more than 25%/s of max life (`maxDps`: the fastest kill is ~4 s), armor divides instead of subtracting (`/(1 + 0.04 x armor)`), and anything over the cap carries into the next hits (up to 40% of max life, `carryMax`) so bursts (charge shots, rail) aren't wasted, just spread. I-frames after a PvP hit are 0.2 s (`iframes`, was the PvE 0.7 s, which halved everyone's damage). Dashing still dodges new damage.
- `damageScale` stays 0.03 (tried 0.04-0.1; with the pacing changes 0.03 gives the target lengths), `sourceMul` grenade 0.65, storm 0.7, scatter 0.85, rail 1.1, orb 1.3, shield 1.5 (auto-aimed / area damage can't be strafed, so it dominated bot duels).
- Ring: `zoneDelay` 25 -> 20 s, `zoneSpeed` 0.55 -> 0.45 m/s, `zoneMin` 7 -> 6 m then collapse; start radius per arena (30-32 m) +2.5 m per player beyond 2 (cap 42). Thorns scratch 2%/0.5 s in duels; lava burns as in PvE.

### Bot duel numbers (scripts/pvp-balance.ts, 10 duels per row, final tuning)
```
mirror buster lv5:  TTK median 26.8 s (14.5-42.3), ring decided 0/10
mirror scatter lv5: 30.1 s (25.2-36.0)
mirror buster lv15: 17.8 s (13.0-31.0)        <- stage-1 builds end around level 15-17
mirror scatter lv15: 17.1 s (13.1-19.8)
mirror buster lv25: 11.9 s; scatter lv25: 11.3 s
buster lv20 vs lv10: higher wins 10/10 (14.6 s); lv15 vs lv10: 8/10; lv12 vs lv10: 7/10
kits at lv15, win rate (6 games per pair): buster 38%, scatter 83%, laser 46%, rail 71%, orb 13%
ffa 6 bots lv15: a round lasts ~24 s, ring decided 0/5
```
Before the pass (0.03 scale, 0.7 s i-frames, burst discarded, no aim lead in the bot): a level-5 mirror took ~78 s and the ring decided it every time; level 15 took ~65 s. Kits before the per-source table: scatter 88%, rail 8% (its bursts were clipped).
Caveat: bots strafe perfectly and aim with a lead, people won't; auto-aimed damage (Thunderstorm, Grenade area) beats skill shots against them, so the kit table over-rates the scatter kit. The orb kit's right click (Aegis Shield) blocks enemy bullets only, not players', so it's a weak PvP pick (see unfinished).

## Net
- New host -> client messages: `p2lobby` (rules, sent on every lobby refresh), `p2round` (arena id, arena seed, round, spawn spots per hero), `p2board` (scoreboard). `pvpgo` carries `rules`; `pvpend` carries the winning `team`.
- Snapshot field `p2`: round, wins, teams, ring radius/start/clock, countdown, round-end clock, format, rounds, arena.
- Clients now get their spawn from `p2round` (before, client heroes spawned in a line at the centre because the host's circle teleport was overridden by the client-owned position).
- PvP lobbies accept up to 7 clients (`NetHost.max` is public; set from the lobby kind). Co-op / Versus refuse to start with more than 4.
- Bots have peer ids `bot:<n>:<k>`; the host never builds snapshots for them.

## Files
- New: src/game/systems/pvp2.ts (rounds, bots, net, HUD, ring, spectator camera, lobby rows), src/data/pvpArenas.ts, src/dev/pvp2Links.ts, tests/pvp2.test.ts, scripts/pvp-balance.ts, scripts/pvp-test.mjs, notes/lanes/pvp2.md.
- Rewritten: src/game/pvp.ts (tuning + pure rules: teams, rounds, ring, spawns, pacing), src/game/systems/pvpFlow.ts.
- Small edits: game.ts (PvpState fields, install, friendly-skip in `nearest`/`inRadius`), systems/render.ts (pvp2Frame hook), statuses.ts (bullets pass through teammates' stand-ins), autopilot.ts (teammate skip), hero.ts (HERO_COLORS 4 -> 8), net/peer.ts (`max` public), netHost.ts (`p2`, skip bots), netClient.ts (`p2`, messages, rules), online.ts (rules in `pvpgo`, >4 guard), world/fieldArena.ts (`layout` option + `ArenaLayoutApi`; every random section is skipped by a one-line guard), dev/testLinks.ts (one line).

## Test links
- `?test&pvp=teams&pvpn=4&pvparena=garden&pvpfight` 2v2 against bots in Thorn Garden, straight to the fight
- `?test&pvp=ffa&pvpn=8&pvparena=crucible&pvpzone=55` 8-player free-for-all, the ring already closing
- `?test&pvp=ffa&pvpn=4&pvparena=frost&pvpout` knocked out: spectating (`&pvpfree` free camera)
- `?test&pvp=teams&pvpn=4&pvparena=sandpit&pvpboard` the round-end scoreboard
- `?test&pvp=ffa&pvpn=6&pvpwatch` hands-off bot duel; `pvprounds=1` one round
- `?test&lobby=pvp` the PvP lobby with the rules rows (MP lane link)

## Tests
- `npm test` -> tests/pvp2.test.ts: pure rules, every arena (same cover from any seed, spawns for 2/4/8 in both formats clear and inside the ring, pads clear), a 2v2 best of 3 online in one process (host + 3 clients: same arena and spawns on every screen, 3-2-1, friendly fire off, aim skips teammates, damage pacing, round wins, KOs, scoreboard on every screen, spectating, rotation, final round, match end, back to title) and an 8-player free-for-all (host + 2 clients + 5 bots) that the bots finish (~1.5 ms per step for 3 machines).
- `node scripts/pvp-test.mjs [--format teams|ffa]`: three real headless games over the PeerJS broker (host + 2 clients + a bot), 2 TEAMS best of 3; host vs client checks every 3 s, screenshots in shots/pvp/. Passed (2 rounds, one transient position mismatch, no lasting desync).
- Balance: `npx rolldown scripts/pvp-balance.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/pvp-balance.mjs && node node_modules/.tests/pvp-balance.mjs [quick|sources]` (PVP_SCALE=x tries another damage scale).
- `npm run coop` (co-op, two browsers): two runs here failed on different timing checks each time (run 1: jump pad, fusion; run 2: team move, finisher). The base commit 53ba485 fails the same way on this machine (jump pad, host ping, enemy mirror count), so it's the script's flakiness under load, not PvP; nothing PvP-specific runs in co-op.
- Pre-existing failures on the base commit, not from this lane: firstten.test.ts (missing advice for `pumpking`), halloween.test.ts (v4 migration).

## Unfinished / risky
- Not played by people. Numbers come from bot duels; expect a retune after real matches (`pvpTuning` is all in src/game/pvp.ts).
- Defensive items aimed at enemies don't work against players: Aegis Shield / parry don't block opponents' bullets (they're Team.Player). Making them would touch shield.ts / skill.ts.
- Not in the debug panel yet (`pvpTuning` is exported; add it to src/ui/debugPanel.ts).
- New strings use `localize()` but have no Arabic entries yet (final translation pass).
- Bots only use starter loadouts and heroes the host has unlocked, no Mods or relics.
- With 8 heroes, co-op HUD pieces (teammate list, minimap) list everyone; they fit but are busy.
- The duel still loads the stage-1 field once (via `loadStage`) before the first PvP arena: a one-off cost at the duel start.

## PLAN.md decision log (for the lead)
- 2026-10-20: PvP worth playing (pvp2 lane, notes/lanes/pvp2.md). Formats: free-for-all up to 8 or 2 teams (friendly fire off), one round or best of 3; four authored PvP arenas (Thorn Garden, Sandpit Ruins, Frost Court, Lava Crucible) via a `layout` option on createFieldArena; a ring that closes then collapses so rounds always end; round scoreboard, round voice lines, spectator free camera; host-added bots with matched builds. Balance from bot duels: hits land every 0.25 s with 0.2 s i-frames, at most 25% of max life per second, excess carried; specials on (1.6x slower, half charged per round), ultimates and revives off; a level-15 mirror lasts ~18 s (was ~65 s). Fixed: client heroes spawned at the centre instead of their duel spawn.
