# Lane: skill (perfect dash, parry, style meter, ultimates, weapon feel)

## What players get
- **Perfect dash.** Dash just before a bullet, a lunge/charge or a telegraphed ground strike would hit you (or dash straight through it): a short slow-mo (solo only), a gold sparkle and "PERFECT!", +25% damage for 3 s, extra i-frames, and the dash charge comes back.
- **Parry** (C, pad B; rebindable in SETTINGS > CONTROLS). Opens a 0.16 s window. Enemy bullets in reach fly back at the nearest enemy as your own cyan shots (damage source "Parry"). Melee attackers that are lunging, charging or touching you get knocked back and stunned for 1.1 s (bosses and the Reaper are only knocked back). A clean parry gives a freeze frame (solo), a flash, "PARRY!", the +25% damage buff and the button straight back. A whiff costs 0.6 s.
- **Style meter D, C, B, A, S, SS** (right side, under the combo). A big tilted letter that pops when you rank up and shakes when you drop, with a progress bar, the score multiplier and a feed of what earned style (PERFECT DODGE, PARRY x3, MIX-UP, MULTI x8, ON BEAT, UNTOUCHED 30s, ELITE DOWN...). The rank multiplies kill score (x1, 1.1, 1.25, 1.5, 1.8, 2.2) and XP a little (up to x1.15). A hit drops two ranks. The game-over screen shows BEST STYLE. The announcer says "Rank A" / "Rank S" for your own rank-ups.
- **Ultimates** (V, pad L3 / R3 / D-pad up). They charge from damage dealt and kills and show as a third meter (ULT) next to DASH and the special:
  - Rookie, **Mega Barrage**: 3 s of bullet time. Enemies within 24 m are slowed 75% while you spray a 3-arm spiral plus aimed fans. Solo also gets 0.5 s of real slow-mo.
  - Bulwark, **Titan Stomp**: three stomps (radius 6, 7.5 and 10 m) that crush, stun and fling enemies and leave craters. The last one heals teammates within 12 m for 25% of their max life.
  - Dash, **Sonic Blitz**: 3.5 s untouchable, 75% faster, dashes refilled. Everything within 2.3 m of you gets smashed (each enemy at most every 0.3 s).
  - Ace, **Lock-On Storm**: locks onto up to 20 enemies within 20 m (bosses and elites first), then a lightning strike hits each. Bosses and elites take two more.
  - Every ultimate except Lock-On Storm makes you invulnerable while it runs.
- **Weapon feel.** Every weapon has its own camera kick, arm recoil, muzzle-flash size, knockback, crit spark size, crit pitch (a sharp pitched hit layered on the crit sound) and hit-stop on heavy hits and crits. Hit-stops only happen in solo: online they would freeze everyone's world.
- **Settings.** SKILL SLOW-MO (ON by default) turns off the perfect-dash and Barrage slow-motion.

## Key numbers (all in exported tuning objects, also in the debug panel's "Skill" folder)
- `skillTuning` (src/game/style.ts):
  - Perfect dash: a threat within 0.35 m (beyond both radii) that would reach you in 0.22 s, or one passing through you in the first 0.2 s of the dash. Gives 0.35 s slow-mo, 0.3 s i-frames, and a 3 s buff of +25% damage.
  - Parry: window 0.16 s (0.26 s for online clients), reach 1.15 m beyond the hero (1.6 m online), 0.6 s cooldown, 1.1 s stun, 0.35 s i-frames, 0.09 s freeze. Reflected bullets do 2.2 x 30 x `power` (director HP scaling).
- `styleTuning` (src/game/style.ts):
  - Thresholds 0 / 80 / 200 / 380 / 620 / 920 (cap 1150). Decay always runs, at 3 / 8 / 14 / 22 / 32 / 45 points per second by rank.
  - Kills: plain kills are worth 2.5 points, at most 6 points per second from plain kills. Each recent kill by the same weapon is worth 12% less (floor 15%). MIX-UP +6 when a weapon that hasn't killed for 5 s scores a kill. A multi-kill of 6 or more pays +1 per kill (max 10) when the burst ends.
  - Bonuses: ON BEAT +7 for a click-weapon kill within 0.09 s of a music beat (once per 0.3 s), elite +45, boss +220, perfect dash +75, parry +90 (+15 per extra bullet or enemy), no-hit +25 every 15 s, ultimate +40.
- `ultTuning` (src/game/ultimates.ts):
  - Charge per hit: 0.0006 x the share of the enemy's life dealt. Per kill: 0.0006. Both are thinned like utility drops by min(1, 70 / the enemies the director wants alive).
  - Other charge: elite kill 0.08, a whole boss's life 0.5, perfect dash 0.03, parry 0.01. Bosses take x0.35 ultimate damage.
  - Damage is in "typical enemies": 30 x `power(g)` (director hpMul x difficulty), so ultimates clear the screen at every stage. Barrage shots 2.2x, stomps 7/7/12x, Blitz 5x per hit, storm bolts 14x.

## Measured (dev bot, headless, `node_modules/.tests/bench.mjs` harness, not committed)
- Ultimate pace with the bot pressing V when ready (god mode, 900 s): Rookie 15 ultimates (one every ~60 s), Dash 11 (~82 s). Before horde thinning it was one every 13 s.
- Style with the bot (it parries perfectly and dashes when cornered): god runs sit mostly at B with some A. Mortal Normal runs without parry/ult spend their time at D/C/B and die in stages 1-2, as before. With the bot's frame-perfect parries, ranks climb to A/S.
- Smoke: the mortal Nightmare bot now reaches stage 2 before dying (it died in stage 1 before), because it parries every close bullet. All smoke runs stay at 0.3-0.5 ms average per step.

## Files
- New: src/game/style.ts (StyleMeter, HeroSkill, skillTuning, bulletThreat), src/game/ultimates.ts (ULTS, ultTuning, the four ultimates), src/game/systems/skill.ts (Game methods: input, perfect dash, parry, ultimate, hooks, net, HUD), src/game/skillAudio.ts (recorded cues + synth fallbacks), src/ui/styleMeter.ts (style meter + ULT meter; injects its own CSS), tests/skill.test.ts, tests/skillGame.test.ts.
- Owned and edited: src/game/player.ts (ultSpeed, skillGlow, refundDash, bounce), src/game/hero.ts (`skill`, reset, damage buff in refreshLive), src/data/heroes.ts (`ult` per hero, desc), src/core/keybinds.ts (parry C, ult V, PAD_PARRY / PAD_ULT), src/data/weapons.ts (`feel`, WeaponFeel, WEAPON_FEEL, feelOf), src/game/weapons/base.ts (feel, shotStarted).
- Shared files, small additive edits:
  - game.ts: system installs; `updateSkill` after the hero loop; `weaponFeel(h)` replaces the old fixed kick line; `skillInput`; `skillDash` in onDash; BULLET_KINDS 12 (parry) and 13 (ult); `localHero()` honours `cheats.unlockAll`.
  - systems/statuses.ts: style score/XP multipliers in killEnemy, `skillKill`, `skillHurt`, source names.
  - systems/combat.ts: knockback x feel, `skillHit`.
  - systems/netHost.ts: `parry`/`ult` messages, snapshot `sk`.
  - systems/netClient.ts: `skillClientInput`, `applySkillNet`.
  - systems/render.ts: muzzle flash scale, `renderSkill`.
  - systems/runFlow.ts: summary `style`.
  - ui/screens.ts: RunSummary `style`, the BEST STYLE row, the SKILL SLOW-MO toggle, the title controls line.
  - settings.ts: `slowMo`.
  - ui/debugPanel.ts: the Skill folder.
  - dev/bot.ts: the bot uses its ultimate and parries.
  - dev/testLinks.ts: the new options below.

## New test-link options
- `ult` charges the ultimate. `ultgo=<s>` charges it and fires it after s seconds.
- `style=<D|C|B|A|S|SS>` starts at that rank (at 90% of its bar).
- `spawn=<enemy>:<n>` puts n enemies in a ring 7 m around you.
- `parrygo=<s>` fires a ring of enemy bullets at you after s seconds and parries them. `dashgo=<s>` fires one bullet at you and dashes (a perfect dash).
- `hero=` now actually applies the hero (it used to be read after the hero was built, and locked heroes fell back to Rookie).
- Example: `?test&stage=2&god&hero=bulwark&ultgo=2&spawn=bopper:16`

## Co-op
- Clients send `{t:'parry'}` and `{t:'ult'}`. The host runs them like its own (remote parries get a longer window and reach to cover latency).
- Perfect dashes for remote heroes are detected on the host when their `dash` message arrives.
- Snapshots carry `sk`: per hero `[style points, best rank, ult charge, ult time left 0..1, buff]`, the receiving hero's style notes, and skill events since that client's last snapshot (`[seq, kind, hero, x, z, extra]`: pd / pa / ul / rk).
- Every machine turns events into sounds (other players' cues fade with distance; announcer lines only for your own moves). Your own events also give local feedback: dash refund, flash, rumble, the ultimate banner, and the Blitz speed and dash refill.
- Ultimate visuals are bullets, enemy state and effects-bus events, so everyone sees them.

## Unfinished / risky
- **Latency.** A remote parry is judged on the host after the input travels, against host-side bullet positions. The longer window and reach (0.26 s, 1.6 m) compensate, but on high ping a bullet can hit before the parry arrives.
- **Online hit-stop.** Weapon hit-stops and the parry freeze are solo-only, and so is slow-mo. Online players get flashes and shake instead.
- **Touch.** There are no touch buttons for parry and ultimate yet (src/ui/touch.ts isn't this lane's).
- **Merge points.**
  - The bot parries every close bullet frame-perfectly, so bot balance reports (`botRun`) now survive longer than a human would. Lower its parry rate if that skews balance work.
  - BULLET_KINDS 12/13 are appended to game.ts. If another lane also appends kinds, renumber one side (ultimates.ts uses kind 13, skill.ts uses kind 12).
  - Score now includes the style multiplier, so old high scores are a little easier to beat.
- **Audio.** Recorded cues are fetched from `audio/<name>.mp3` (public/audio) through `sfx.output('sfx')`, so the volume sliders apply. If the audio lane builds its own sample player, skillAudio.ts should switch to it.
- **PvP.** Ultimates are disabled in the PvP duel; parry and perfect dash work against enemy bullets only.

## Decision-log paragraph for PLAN.md
- 2026-10-19: Skill layer (lane skill).
  - Perfect dash: dash just before a bullet, lunge or strike lands. You get 0.35 s slow-mo in solo, +25% damage for 3 s and the dash back.
  - Parry: C / pad B. A 0.16 s window reflects bullets and stuns melee; a whiff costs 0.6 s.
  - Style meter D-SS: plain kills are capped at 6 points/s and points always decay, so mixing weapons and skill moves drive it. Rank multiplies score x1-2.2 and XP up to x1.15.
  - Per-hero ultimates on V / L3 / R3: Mega Barrage, Titan Stomp, Sonic Blitz, Lock-On Storm. They charge from hits and kills, thinned with horde size like drops, so one comes about every 60-80 s at every stage (it was one every 13 s before thinning).
  - Per-weapon feel data (WEAPON_FEEL).
  - Host-authoritative: clients send presses; snapshots carry style, charge and skill events. Hit-stop and slow-mo are solo-only so online worlds never freeze.
