# InfiniShoot — Project Plan

Desktop **twin-stick survivors-style roguelike**, endless runs, with a colourful **Mega Man Legends-style** cartoony late-90s 3D look.
Stack: **TypeScript + Vite + Three.js (WebGL2)**. Static hosting, no backend.

Each milestone ends with a playable build. Estimates assume one part-time dev with AI assistance.

---

## Milestone 0 — Foundation and look (≈ 3–4 days)
Goal: empty project that already looks like the target style.
- [x] Scaffold Vite + TS + Three.js, Prettier, folder structure (ESLint deferred; `tsc --noEmit` strict is the gate)
- [x] Game loop: fixed 60 Hz update, interpolated render, pause on tab blur (Esc/P/Start toggles)
- [x] Input manager: keyboard, mouse (ground-plane aim), gamepad (twin sticks), device auto-switch
- [x] Low-res render target (480×270 default) with nearest upscale
- [x] Retro material: vertex colours + nearest textures + Gouraud lighting (warm key, cool ambient), soft cel bands, tunable vertex snap / affine warp
- [x] Sky-tinted fog, blob shadows (sky gradient dropped: the top-down camera never sees the horizon; island-in-sea backdrop instead)
- [x] Debug panel (lil-gui, backquote key) with "Retro strength" slider, FPS/draw-call stats
- [x] Placeholder chunky hero (painted face, helmet, arm buster) with procedural walk anim; basic twin-stick movement + wall collision
- **Playable:** a colourful test arena with a placeholder chunky hero that you can walk around.

## Milestone 1 — Twin-stick feel (≈ 1 week)
Goal: one hero, one gun, one enemy, and it feels great.
- [x] Twin-stick controller: move independently of aim, character faces aim, acceleration and friction tuned
- [x] 3/4 top-down follow camera with aim look-ahead and smoothing (FOV widens on narrow windows so horizontal view is never smaller than 16:9)
- [x] Dash with i-frames and a cooldown indicator (Space / Shift / RMB / LB / LT / A)
- [x] Pooled, instanced projectiles; spatial-hash collision; wall AABBs (static grid for bullets)
- [x] Basic enemy ("Bopper"): spawn ring telegraph, chase, red-flash wind-up, lunge, recover; health, death pop. Instanced: one draw call per enemy type
- [x] Juice: hit-stop, screen shake, white hit flash, squash and stretch, knockback, muzzle flash, particle bursts, damage numbers
- [x] Placeholder SFX (synthesized WebAudio), HUD (HP bar, dash pip, kill counter, K.O. screen). Ammo/heat dropped for now: the buster is infinite
- **Playable:** one arena, endless trickle of enemies, satisfying blasting.

## Milestone 2 — Roguelike and arcade loop (≈ 1–2 weeks)
Goal: the run structure exists end to end.
- [x] Seeded RNG and run state (seed, stage, score, combo, picked upgrades, stats); each stage's arena is seeded from run seed + stage
- [x] Wave director: budget-based waves that scale with stage (HP +12%/stage, more waves, elite stage every 5th)
- [x] Stage clear (bonus tally + small heal), then upgrade choice (1 of 3 cards), then portal to the next stage with a fade transition
- [x] Upgrade system: data-driven additive stat modifiers plus on-kill effects (heal, explode)
- [x] 17 starter upgrades in three rarities (damage, fire rate, multishot, pierce, bounce, homing, crits, lifesteal, Pop Rocks explosions…)
- [x] **Arcade scoring**: kill points, combo multiplier up to x8 with a 2.5 s window, combo break on hit, clear and no-hit bonuses, local top-10 table
- [x] Bomb meter (fills on kills; expanding shockwave; clears enemy bullets)
- [x] Game-over screen with run summary, build badges and high scores; quick retry
- [x] Title screen, pause menu, settings (volume, retro look, screen shake, auto-fire, FPS), all keyboard, mouse and gamepad navigable; settings persisted
- [x] Feel pass: directional recoil kick, arm recoil, comic star hit sparks, kill shockwave rings, bullet glow halos, crits, footstep dust, hurt and low-life vignette, SFX pitch rising with combo
- [x] Two enemy variants to make waves readable: Zippy (fast and fragile, stage 2+) and Chonk (big and heavy, stage 3+)
- **Playable:** full arcade runs from start to death with build choices and a score to beat.

## Milestone 3: Survivors redesign (done, replaces the old M3 enemies milestone)
Goal: hectic, movement-first runs where you get stronger both during and between runs.
- [x] Timed survival stages (5:00) on a large open field (110x110) with sparse cover; boss at the end, then portal
- [x] Survival director: alive-target ramp (15 to 230+), minute-gated enemy types, elite every minute, swarm rings every ~45 s, off-screen spawns biased toward where you run, far enemies recycled ahead
- [x] XP gems with magnet pull, level-up cards (new weapon / weapon level / passive), max 6 weapons + 6 passives, rerolls
- [x] 9 weapons with visible levels: Buster (aimed), Orbit Drones, Zap Field, Chain Zap, Boomer Disc, Seeker Pod, Pop Mines, Frost Nova, Blaze Boots
- [x] 10 passives (stat boosts)
- [x] 10 enemies: Swarmer, Bopper, Zippy, Blaster Bot (shoots), Rhino (charge line), Chonk, Ka-Boomer (fuse), Jelly (splits), Hive Pylon (spawns), King Bopper (boss: ring bursts, summons, jump slam); elites at 1.6x size and 10x HP drop chests
- [x] Contact damage with armor and i-frames; enemy bullets; revive
- [x] Meta progression: Bolts banked per run, Workshop (12 permanent upgrades), 8 achievements (4 unlock weapons). Bolts and the Workshop were later removed (see decision log)
- [x] Saves: auto-save in localStorage, export/import save code with checksum, refund, reset
- [x] New HUD (XP bar, timer, boss bar, loadout), Workshop and save-data screens, game over with damage breakdown
- [x] ~~itch.io packaging~~ replaced by the desktop exe (see decision log)
- [x] Dev autoplay bot (src/dev/bot.ts) for balance and performance runs
- **Playable:** full survivors-style runs with persistent progression.

## Milestone 3.5: Synergies and the shop (done)
Goal: Balatro-style build decisions, where the best pick depends on what you already own.
- [x] Weapon tags (Projectile, Orbit, Area, Chain, Explosive, Fire, Frost, Shock, Trail) shown on level-up cards
- [x] Mods: 32 perks in 5 ordered slots; damage flows left to right as (amount + add) x mult, so order matters; Echo copies the Mod to its right
- [x] Mod kinds: tag synergies, triggers (dash, crit, kill, hurt, every 8th shot, standing still, moving), scaling (Bloodlust, Hoarder, Momentum, Collector), economy (Piggy Bank, Coupon Book), cursed tradeoffs (Glass Cannon, Pacifist Core, Overclocked Heart, Greedy Gremlin)
- [x] Statuses and combos: Burn, Shock (+20% damage taken), Freeze; Burn + Shock = Overload blast, explosion on a burning enemy = Napalm, killing a frozen enemy = Shatter
- [x] Run gold: drops, chests, stage clear, plus interest (1 per 5 held, capped); left-over gold converts to Bolts at run end
- [x] Shop after each boss: 4 Mods, escalating rerolls, heal, buy/sell/reorder with synergy hints ("You have: 2 explosive")
- [x] Level-up Skip for gold
- **Playable:** builds that combo, plus a real spend-vs-save economy.

## Milestone 4: Online co-op (done)
- [x] Host-authoritative co-op over WebRTC with 5-letter invite codes (PeerJS public broker for matchmaking), 2-4 players
- [x] Team XP and level; separate gold, weapons, passives, Mods, level-up cards and shop per player (each player's own Workshop bonuses and unlocks apply)
- [x] Clients move their own hero locally (instant controls) and send position/aim/fire at 30 Hz; host sends 20 Hz snapshots with interest management (only what's within ~34 m of that player): binary enemy/bullet/pickup records plus a recorded effects stream (particles, rings, numbers, sounds, banners)
- [x] Weapons expose net()/setNet() so clients draw everyone's drones, discs, missiles, mines, flames and lightning
- [x] Co-op rules: enemies chase the nearest player, pickups go to whoever is nearest, downed players are revived by standing next to them for 3 s, run ends when everyone is down; enemy count and HP scale with player count
- [x] Lobby (host/join, names, player list), waiting screens while teammates pick, teammate life bars and name tags, per-player colors
- **Playable:** two browsers clear a stage together.

Known limits: some strict networks block direct WebRTC connections (would need a TURN relay).

## Milestone 4b: Biomes, bosses and evolutions
- [x] 4 biomes cycling by stage: Bright Meadow, Sunset Dunes (cacti, sandstone, rocks), Frosty Peaks (pines, ice ruins, frozen ponds), Magma Isle (obsidian, dead trees, lava pools and lava sea). Each sets ground, trail, walls, edge ring, sea, light and fog
- [ ] Per-biome music (no music system yet; see M6)
- [x] 2 more bosses, rotating King Bopper > Rampage Rex > Hive Queen by stage. Rex: chain of 3 telegraphed charges, 3-arm bullet spiral, shockwave rings with a moving gap. Queen: flies at range and circles, aimed 7-bullet fans, telegraphed ground strikes (red danger zones), Zippy summons
- [x] Weapon evolutions: a level 5 weapon plus its partner passive evolves into a stronger form (offered as the first level-up card, or straight from a chest)
- [ ] Bullet-pattern system for shooter variants (spiral, burst, sniper)
- [x] Explosive barrels: shoot them (3 hits) or catch them in a blast; fiery blast that chains to nearby barrels
- [ ] More hazards (conveyor floors)
- **Playable:** each stage looks and plays differently.

## Milestone 4c: Charge shot, economy and UI pass (done)
- [x] Buster charge shot on right click / X: hold to charge, release to fire; damage, size and pierce grow with hold time, full charge explodes on impact; crosshair charge ring
- [x] Charge cards (Capacitor, Plasma Core) and Mods (Quick Draw, Patience, Thunder Shot, Mega Buster, Overcharge)
- [x] Economy Mods: Bounty Hunter, Tip Jar, Lucky Coin, Investor, Golden Ticket, Pawn Shop, Gold Plating
- [x] Stages shortened to 4:00 (enemy types, HP growth and rings keep their 5-minute pacing, compressed)
- [x] UI pass: glossy icons, floating and wiggling card icons, sheen on focused and rare buttons, pop-in menus, dealt shop cards, spinning coins, striped XP bar, on-screen pause button
- [x] Fixes: shop CONTINUE now closes the shop; Esc pause no longer closes itself on the same press

## Pixel-art UI pass (done, v0.4.0)
- [x] Pixel-art UI: Sweetie 16 palette, notched pixel frames with bevels, dithered menu backdrops, stepped animations, blinking selection cursor, segmented bars, pixel crosshair with an 8-segment charge meter
- [x] Item icons from game-icons.net, redrawn as 24x24 pixel sprites with outline and shading
- [x] Bundled pixel fonts (work offline in the exe)
- [x] Fix: XP gems no longer orbit the player; they home straight in (longest flight about 0.4 s)

## Pacing and chests (done, v0.5.0)
- [x] Treasure chests: 6 per stage spread over the map; walk into one for an item applied on the spot (a random passive, else a weapon level, else gold); closed chests bob and sparkle, and an edge-of-screen pointer shows the nearest one with its distance
- [x] Slower levelling: enemies drop 45% less XP and the level curve is steeper (about level 14 at the end of stage 1 instead of 25-30)
- [x] Dash recharge scales with team level: 1.6 s at level 1, down to 0.7 s by level 20

## Milestone 5: Heroes and content
- [ ] 2-3 heroes with different starting weapons and stat quirks, unlocked through achievements; hero art with painted faces
- [ ] More weapons (laser sweep, charge cannon) and passives
- [ ] Elite modifiers (shielded, fast, splitting)
- **Playable:** builds and heroes diverge noticeably.

## Milestone 6: Polish
- [ ] Upbeat music per biome and a final SFX pass
- [ ] Rebindable keys, run history, daily seed challenge
- [ ] Mobile touch twin-stick controls (stretch)

## Milestone 7: Release
- [ ] Performance audit on a range of machines; quality presets
- [ ] Code-sign the exe (removes the SmartScreen warning); optional Mac/Linux builds
- [ ] Publish `InfiniShoot.exe` on GitHub Releases, then gather feedback

---

## Proposed folder structure
```
src/
  main.ts              # bootstrap
  core/                # loop, input, rng, time, events, pool
  render/              # renderer, retro shaders, post, camera, vfx
  ecs/                 # entities, components, systems
  game/
    player/            # twin-stick controller, dash, stats
    weapons/           # weapon logic + data
    bullets/           # projectile sim + pattern system
    enemies/           # ai behaviours + data
    upgrades/          # modifier system + data
    run/               # run state, wave director, scoring, progression
    world/             # arena generation, chunks, biomes, pathfinding
  ui/                  # HUD, menus (HTML/CSS overlay)
  audio/
  data/                # JSON/TS content definitions
public/assets/         # models (glb), textures (png), audio
```

## Key technical decisions
| Area | Choice | Why |
|---|---|---|
| Engine | Three.js | Mature, small, full shader control for the retro look |
| Simulation | 2D on the XZ plane | Twin-stick gameplay is 2D, so it is simpler and faster |
| Physics | Custom (circles + AABB, spatial hash) | Handles hundreds of bullets cheaply |
| Camera | Fixed-angle 3/4 top-down | Readable bullets, no disorientation |
| Pathing | Flow field | Scales to 150+ enemies chasing one target |
| UI | HTML/CSS overlay | Fast to build, crisp text, easy menus |
| Content | Data files | Easy to balance and extend |
| Randomness | Seeded mulberry32 | Reproducible runs, daily seeds, easier debugging |

## Risks and mitigations
- **Feel is wrong:** Milestone 1 is dedicated to feel. Don't add content until shooting is fun.
- **Bullet readability in a colourful world:** keep environments mid-saturation and bullets high-contrast with outlines or glow. Enemy bullets always use a distinct colour family.
- **Performance with many bullets:** instancing and pooling from day one; profile at the end of each milestone.
- **Art bottleneck (anime characters):** start with primitive-based chunky heroes plus painted face textures; use CC0 low-poly packs (Kenney, Quaternius) restyled with our palette and shader.
- **Scope creep:** anything not in the current milestone goes to the backlog below.

## Backlog / later ideas
- Local co-op (2 gamepads), online leaderboards (needs a backend), more heroes with unique specials, mobile twin-stick touch controls, mod support via JSON.

## Decision log
- 2026-10-04: Project started. Stack set to TS + Vite + Three.js.
- 2026-10-04: Changed from third-person over-the-shoulder to **twin-stick top-down** (3/4 camera). Art direction changed from gritty PS1 to **colourful Mega Man Legends-style cartoony anime**, with PS1 effects kept subtle and tunable. Added arcade scoring and combo.
- 2026-10-04: M0 done. WebGL2 has no `noperspective`, so affine mapping uses the uv·w / w varying trick. Colour management is disabled; all colours are authored as display (sRGB) values. Measured ~2 ms/frame at 480×270 on Intel UHD.
- 2026-10-04: M1 done. Buster has no ammo or heat (arcade flow; revisit if weapons need a resource). Only the lunge deals contact damage, so enemies are always readable. Enemies render through per-type InstancedMesh with an `instanceFlash` attribute: 150 enemies take 48 draw calls and 0.23 ms of simulation per step.
- 2026-10-15: M2 done, together with a feel pass. Upgrades are additive stat modifiers (+20% twice = 1.4x), so stacking is predictable. Explosion and bomb hits show no damage numbers because chain explosions buried the screen. The combo survives between stages (it only decays while fighting), which rewards clean clears. Display font is Lilita One from Google Fonts, falling back to Trebuchet. Bopper variants (Zippy, Chonk) were pulled forward from M3 so early waves have variety.
- 2026-10-15: Redesigned as a survivors-style twin-stick roguelike (user request: harder, more hectic, open stages, weapons that level visibly, more enemy variety, progression between runs, deployable with saves). Chosen: timed stages + boss, aimed Buster plus auto weapons, itch.io hosting, local saves plus export code (cloud saves deferred: they need a server and logins).
- 2026-10-15: Performance: static arena props are merged per material (217 to ~70 draw calls), and instance buffers upload only live slots via update ranges (full-capacity uploads were the main frame cost). Simulation with ~270 enemies and every weapon maxed: about 0.5 ms per step.
- 2026-10-15: Boss HP scales by stage only (2,400 at stage 1), and normal spawns drop to 25% during the boss, after bot runs showed the boss was unkillable with minute-scaled HP.
- 2026-10-15: Pushed to GitHub (Mansouralmadi/Infinishoot), committing straight to main per the user. Next big features chosen: synergy perks first (shop between stages, Balatro-style), then online co-op only (no local co-op).
- 2026-10-15: Mods live in a shop rather than in level-ups so level-ups stay about weapons, and gold creates its own spend/save/interest decisions. In-run gold replaced the Bolt pickups; Bolts are now only earned at run end (kills, stages, minutes, left-over gold). Echo shares state with the Mod it copies, so echoed counters (Bloodlust) also stack twice as fast.
- 2026-10-15: Online co-op design (user): separate gold and own shop per player; XP shared as a team (assumed, Vampire Survivors style). Host-authoritative simulation with client-owned movement, chosen over lockstep because JS floating point isn't guaranteed identical across browsers and lockstep adds input delay. Refactored Game into team state plus per-player Hero (src/game/hero.ts); solo is simply one hero. Gameplay timing must never depend on render (the portal used to), because hosts may not render every frame.
- 2026-10-15: Dropped the itch.io build (user: downloads should be plug and play, no command lines). The game now ships as a single portable Windows exe built with Electron + electron-builder (`npm run dist`, about 100 MB). Electron's `backgroundThrottling: false` also fixes the co-op host pausing when its window is in the background. Vite's `base: './'` stays because the app loads dist/index.html from disk. three, peerjs and lil-gui moved to devDependencies since Vite bundles them, so the exe ships no node_modules.
- 2026-10-15: Right click moved from dash to the charge shot (dash keeps Space/Shift/LB/LT/A). Charging suppresses rapid fire, Mega Man style. Charged hits are credited to source 'charge' so Mods key off it. Stages went from 5:00 to 4:00; the director's 'pace minute' scales content so 4 minutes covers what 5 did. Barrels are no longer merged props: they live in Barrels (src/game/barrels.ts) with their own collider that is removed (and the wall grid rebuilt) when they blow; hosts broadcast `barrel` events to clients. Mods gained `addGold`, `freeSlots` and an `onStageClear` hook.
- 2026-10-15: Biomes are data (src/data/biomes.ts) consumed by createFieldArena(seed, biome) and applyBiomeLook(), which sets the shared light and fog uniforms; the clear colour follows the fog every frame. Biome = (stage - 1) mod 4, so clients rebuild the same biome from the stage number without new network messages. Lava pools are decoration only for now (hazards are a separate task).
- 2026-10-15: v0.2.0. Bosses are flagged `boss: true` in their def (boss bar, bounty, no crowd separation) instead of checking behavior === 'boss'. Boss attack telegraphs reach clients as the action index packed into the enemy record's flag bits; strike zones travel on the effects bus ('z' events) and are drawn as filled red discs, since additive rings vanished on snow. The version is injected from package.json (`__APP_VERSION__`) and shown on the title screen.
- 2026-10-15: Removed the Workshop and Bolts (user). Runs now start equal; the in-run shop and Mods carry the build decisions. Achievements stay and still unlock weapons; they now live on an UNLOCKS screen (title menu) with Save Data. Save format v2 drops `bolts`, `workshop` and `boltsEarned`; older saves keep their achievements and lifetime stats. Rerolls and the revive came only from the Workshop, so runs start with none (the level-up Reroll button hides at 0). The co-op `hello` no longer carries Workshop levels.
- 2026-10-15: v0.3.0. Save backup is a file now (user: no codes): SAVE TO FILE writes InfiniShoot-save.json (a Save dialog in the desktop app, starting in Documents), LOAD FROM FILE reads it back. Old ISAVE1 codes still load if pasted into a file. The desktop app keeps its own save in %APPDATA%\InfiniShoot, so new versions of the exe keep progress.
- 2026-10-15: v0.4.0 pixel-art UI (user: "not AI slop"). Rejected glossy gradients and soft shadows; everything is whole UI pixels on one palette. Pixelify Sans was dropped for text because its 5/S and 2/Z look alike at UI sizes; Jersey 15/10 have clear numerals. Icons are game-icons.net silhouettes sampled onto a 24x24 grid at runtime (Path2D, 4x supersampling, coverage > 40%) and coloured from the palette; 15 of the first picks were swapped for bolder icons after a contact-sheet review. Gem magnet: the whole velocity is steered toward the player (no leftover sideways speed), speed ramps to 45 m/s, and a gem is collected if its next step would overshoot.
- 2026-10-15: v0.5.0 (user: levelling too fast and interrupting; dash too spammy early; chests on the map). XP gems are worth 0.55x enemy XP and xpForLevel is now 6 + 8l + 1.4l^2; bot runs reach about level 5/7/10/14 at minutes 1-4 of stage 1 (was 6/10/14/24). A flat XP cut alone barely helped because kill volume peaks in the last minute, hence the steeper curve. Map chests give their item instantly instead of opening the level-up menu, so they add power without another interruption; hosts broadcast `wchest` events and item changes reach clients through the snapshot's passives and weapon lists. The dash cooldown factor comes from the team level in Hero.refreshLive, so clients get it with the synced stats.
- 2026-10-15: Weapon evolutions. Each weapon has one partner passive (Buster + Power Cell = Giga Buster, Orbit Drones + Armor Plate = Aegis Swarm, Zap Field + Big Bang = Thunderdome, Chain Zap + Lucky Star = Storm Caller, Boomer Disc + Magnet = Buzzsaw Halo, Seeker Pod + Rapid Coil = Hellfire Pod, Pop Mines + Nanobots = Nano Minefield, Frost Nova + Heart Container = Glacier Heart, Blaze Boots + Turbo Sneakers = Phoenix Trail). Owning the passive at any level is enough, so evolutions stay reachable with the slower v0.5.0 levelling. The evolved form is stored as level `levels.length + 1` with its own parameter set (`evo` in src/data/weapons.ts), so co-op snapshots and client weapon sync carry it with no protocol change. A ready evolution is always the first level-up card and is what a map chest gives first; the LV 5 card and a new partner passive's card name the recipe. New achievement: Evolution (no unlock).
