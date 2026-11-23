# InfiniShoot roadmap: 10 gates to 3.0

Agreed with the owner on 2026-11-20. Each gate closes on its exit criteria ("Done when"), not on a feature count.
Order: Gate 1, then Gate 2 (difficulty first: everything else is tuned on top of it), then Gates 3, 4 and 5 in
parallel, then 6 and 7, then 8, 9 and 10.

Status: Gate 1 built (PR #5). Gate 2 in progress.

First, why it feels easy today. Over v1.5–v2.0 we added a lot of safety nets:
- **Survive-anything systems:** rewind, last stand, comeback mode, clutch revive, Phoenix relics, and a 10-life heal at every level-up.
- **Softened damage:** one hit can never take more than 35% of your life, and enemy damage scales gently.
- **Late-run collapse:** auto weapons and Mods stack without limits, so builds snowball, and the pacing system eases off to suit the weakest teammate.
- **Tuning blind spot:** balance was measured with an invincible bot that never dodges, so "hard" was never actually tested.

Gate 2 fixes that first, and every later gate keeps it in mind.

---

### Gate 1 — Players in hands (approved)
- Playtest build with opt-in telemetry and in-game feedback.
- First-10-minutes and juice pass.
- Online server live.
- Steam page and signed builds.
- Performance check on real devices.
- Housekeeping: the v2.0.1 downloads and the follow-ups list.

### Gate 2 — Hard by design: "fair, brutal, readable"
**Goal:** every death feels earned and every win feels like an achievement.

- **New baseline:** today's Hard becomes Normal, and today's Normal becomes an opt-in "Assist" mode.
- **Safety nets cut back:** in Normal and above, rewind is once per run, last stand and comeback mode are off, there's no heal on level-up, and the per-hit damage cap rises from 35% to 50%. Healing becomes scarce and must be chosen (a heart competes with gold in the shop).
- **Power has a ceiling:** stacking Mods and items gives diminishing returns, and the Overdrive and Momentum caps tighten. No build becomes immortal by stage 3.
- **A pressure director:** it measures your actual power (kill speed, damage taken, time spent idle) and pushes back with more enemies, more elites and faster spawns. Stronger players face harder runs.
- **Bosses with a soft enrage:** after a target time each boss speeds up and adds attacks, so stalling isn't a strategy.
- **A "skilled bot" as the yardstick:** a mortal bot that dodges telegraphs, kites and parries. All balance gets measured against it, never against the invincible bot again.
- **Death screen:** shows what killed you, the hit that broke you, and a 5-second replay, so a death teaches you something.

**Done when:**
- First-time playtesters clear stage 4 on Normal in under 30% of runs.
- The skilled bot clears a loop in 40–60% of runs.
- At least 80% of feedback calls deaths "fair".

### Gate 3 — Combat depth and skill ceiling
**Goal:** the hands matter as much as the build.

- **Weak points:** enemies have armoured fronts, exposed backs and glowing cores, so aim and positioning multiply damage.
- **Enemy armour types:** plated, ethereal, shielded and swarm. Each counters some weapons, so the build has to answer the fight.
- **Dash economy:** stamina-based, with perfect-dash rewards (time slow, refund). Parry windows tighten, with a heavy payoff when you land one.
- **Active reload / overheat** on the clicks: a skill timing that rewards rhythm.
- **Style meter with stakes:** high style raises drops and score, and taking a hit drops you two ranks.
- **Movement tech:** slide, wall-bounce dash, a short hover over hazards.
- **Spatial threats instead of damage sponges:** projectiles you have to read (curving, bouncing, delayed), plus area denial, so dodging becomes the core skill.

**Done when:** the skilled bot with average aim does under 60% of the damage it does with perfect aim on the same build, so mechanics matter.

### Gate 4 — Enemies that think, bosses you remember
**Goal:** every enemy has a job, and every boss is a fight people talk about.

- **Enemy squads with roles:** commanders buff, snipers suppress, shield-walls advance, baiters lure you into traps. They coordinate through a shared "squad brain".
- **Adaptive enemies:** if you rely on one damage type, enemies gradually gain resistance to it, so you have to diversify.
- **Nemesis system:** the enemy that kills you is promoted. It gets a name, a scar and a new trait, and hunts you in later runs. Beat it for a unique relic.
- **Boss redesign:** each boss gets a learnable choreography with readable tells, a mechanic that isn't just damage (a puzzle, an arena shift, positioning), and a phase-3 "desperation" act.
- **Mini-boss variety:** distinct move sets instead of shrunken copies of the big bosses.
- **Hunters:** rare enemies that stalk you through a stage before they engage.

**Done when:**
- Every boss has at least 3 mechanics a player must learn to win.
- The skilled bot's first-try boss win rate is under 50% and rises clearly with practice runs.

### Gate 5 — Build-crafting reinvented (Balatro-level decisions)
**Goal:** every run feels unique, and every choice hurts a little.

- **Rule cards:** rare picks that change the game's rules, for example "your bullets bounce off walls but you can't stop moving" or "every 10th kill heals, but healing is otherwise disabled".
- **Weapon crafting:** combine a frame, a core and a modifier into your own weapon, with emergent results instead of fixed evolutions only.
- **Pacts:** risky deals with a clear catch; the more danger you accept, the better the loot (Heat folded into the run itself).
- **Synergy discovery:** hidden interactions you find by experimenting, recorded in a codex as "discovered by you".
- **Scarcity:** fewer, more meaningful picks per level-up, and banish and reroll cost something real.
- **Run archetypes:** each hero has 2–3 signature build paths with their own capstone.

**Done when:**
- Across playtest telemetry, no single build archetype exceeds 15% of wins.
- The median run uses 3+ distinct synergies.

### Gate 6 — The graphics leap
**Goal:** a screenshot sells it; still unmistakably Mega Man Legends charm, but premium.

- **WebGPU renderer** (WebGL2 as fallback): hundreds of dynamic lights, so every bullet lights the world.
- **GPU particles and destruction:** debris, sparks, smoke and fluid-like effects at 10x today's counts.
- **Art bible plus a hero and enemy model refresh:** hand-painted textures, expressive faces, and procedural animation (IK feet, lean, recoil, flinch).
- **Stylised lighting:** rim light, soft volumetric light shafts, ambient occlusion, painterly fog. Day and night and weather affect visibility and gameplay.
- **Living arenas:** foliage that reacts, water that ripples, lasting battle damage (craters, scorch, broken cover).
- **Cinematic moments:** boss intros, finishers and evolutions in real-time in-engine cutscenes; a photo mode upgrade.
- **Readability rules:** enemy shots always readable over effects (outline, colour family, a cap on how many effects play at once).

**Done when:**
- 60 fps holds on a mid-range laptop with 300 enemies and 1,000 bullets.
- A blind A/B screenshot test prefers the new look by at least 80%.

### Gate 7 — World and level design
**Goal:** places, not flat fields.

- **Verticality:** ramps, bridges, ledges and drop-downs; enemies on high ground; jump pads as routes.
- **Handcrafted set pieces stitched into procedural arenas:** ruins, fortresses, arenas within arenas.
- **Interactive environment:** traps you can trigger on enemies, collapsible bridges, flood gates, explosive chains, lure points.
- **Biomes with rules:** ice slides, darkness only lit by your shots, low gravity, rising lava with a timer.
- **Secrets:** hidden rooms, vaults, puzzle shrines, and a rare boss lair per biome.
- **Overworld campaign:** a map of islands you liberate one by one; each island changes, and the world remembers.

**Done when:** each biome has at least 3 terrain mechanics, and telemetry shows at least 25% of runs finding a secret.

### Gate 8 — Innovation: things no survivors game does
**Goal:** the features that get InfiniShoot talked about.

- **Echo runs:** your previous run's ghost fights you as a mirror boss (it uses your old build and moves).
- **Time-loop stage:** die and replay the same 60 seconds with knowledge carried over; perfect it to break the loop.
- **Asymmetric co-op roles:** one player pilots a mech or turret, another scouts, another commands a drone swarm.
- **Player-made bosses:** an editor to design a boss's moves and arena, shared and rated by the community. The best ones enter the weekly rotation.
- **Sound-reactive and rhythm hybrids:** attacks on the beat do more damage; a boss that fights to the music.
- **Living world events:** server-wide goals (the community kills 1M of an enemy, and a new biome unlocks for everyone).
- **Stream mode:** chat votes on events, spawns and blessings and curses during a run.

**Done when:** at least 3 of these ship, and each one is the most-mentioned feature in at least one playtest round.

### Gate 9 — Endgame and mastery
**Goal:** a reason to play for 100+ hours.

- **Ascension rebuilt** as 20 handcrafted challenge tiers (rule changes, not just bigger numbers), each with a unique reward.
- **Weapon and hero mastery tracks:** cosmetic and challenge-based, never stat power. Every run still starts equal.
- **Seasons:** ranked leaderboards per season, seasonal modifiers, end-of-season titles.
- **Hardcore profile:** one life; a death wipes the profile's unlocks; separate leaderboard.
- **Speedrun mode** with splits, ghosts and a verified board (replays already have checksums).
- **The Abyss:** an endless post-game descent where each floor adds a stacking mutation; world-first race boards.

**Done when:** median playtime per active player passes 20 hours in telemetry, and at least 15% of players reach Ascension 10.

### Gate 10 — Launch "InfiniShoot 3.0"
**Goal:** a real launch, not a release.

- **Steam 1.0:** Steam Deck verified, Steam achievements, cloud saves, Workshop for mods and arenas, friends invites.
- **Next Fest demo, trailer and press kit:** a 90-second trailer from in-engine footage, plus screenshots and a press kit.
- **Community:** Discord, bug tracker, roadmap page; patch notes in game.
- **Leaderboard anti-cheat:** replays verified server-side.
- **Accessibility and localisation pass:** colour-blind modes, remapping, subtitles; 7 languages kept complete.
- **Marketing hooks:** a daily challenge share card, highlight clips with one-tap sharing.

**Done when:** the Steam page reaches a wishlist target you set, the demo hits a 90% positive rating, and 3.0 ships with no known crash.

---
