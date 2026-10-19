# InfiniShoot

A colorful twin-stick survivors-style roguelike for Windows and Mac. You aim an arm cannon while automatic weapons build up around you, survive timed stages against swarms, beat the boss, and dive through the portal to a harder stage. Every run starts equal; achievements unlock new weapons for future runs.

Built with TypeScript, Vite and Three.js, with a Mega Man Legends-inspired low-poly look and subtle PS1-style effects.

## Play it

**In your browser:** [mohamadhazeem.github.io/Infinishoot](https://mohamadhazeem.github.io/Infinishoot/). No download; progress saves in that browser. It updates automatically on every push to `main`.

**Desktop:** download from the [Releases page](https://github.com/MohamadHazeem/Infinishoot/releases):

- **Windows:** `InfiniShoot.exe`. Double-click it; no install needed. The first launch takes a few seconds while it unpacks. The exe isn't code-signed yet, so Windows may show "Windows protected your PC": click **More info**, then **Run anyway**.
- **Mac:** `InfiniShoot-mac-arm64.dmg` (Apple Silicon) or `InfiniShoot-mac-x64.dmg` (Intel). Open it and drag InfiniShoot to Applications. The app isn't signed yet, so the first time, right-click it and choose **Open**, then **Open** again.

Press F11 (Ctrl+Cmd+F on a Mac) for fullscreen. Progress saves automatically on your computer. To back it up or move it to another computer, use UNLOCKS > SAVE DATA > SAVE TO FILE, then LOAD FROM FILE on the other one.

## Build it

Requires Node.js 20+.

```
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm test` | Unit tests |
| `npm run smoke` | Plays every mode headlessly with the autoplay bot and fails on any error |
| `npm run app` | Build and open the desktop app |
| `npm run dist` | Build `release/InfiniShoot.exe` (single portable exe, run on Windows) |
| `npm run dist:mac` | Build the Mac apps `release/InfiniShoot-mac-*.dmg` (run on a Mac) |

Every push and pull request is typechecked and built on GitHub (`.github/workflows/ci.yml`). To publish a release, push a version tag (`git tag v0.6.0 && git push origin v0.6.0`): `.github/workflows/release.yml` builds the Windows exe and both Mac dmgs and attaches them to a GitHub Release.

## Weapon evolutions

Get a weapon to level 5 while holding its partner item, and the next level-up (or treasure chest) evolves it into a much stronger form. The level 5 card tells you which item it needs.

| Weapon | + Item | Evolves into |
|---|---|---|
| Buster | Power Cell | Giga Buster |
| Orbit Drones | Armor Plate | Aegis Swarm |
| Zap Field | Big Bang | Thunderdome |
| Chain Zap | Lucky Star | Storm Caller |
| Boomer Disc | Magnet | Buzzsaw Halo |
| Seeker Pod | Rapid Coil | Hellfire Pod |
| Pop Mines | Nanobots | Nano Minefield |
| Frost Nova | Heart Container | Glacier Heart |
| Blaze Boots | Turbo Sneakers | Phoenix Trail |

## Online co-op

Title screen > PLAY ONLINE. One player hosts and shares the 5-letter code; up to 3 friends join with it. The host picks the difficulty (Easy, Medium or Hard) in the lobby. Each player has their own weapons, gold, Mods and shop; XP and score are shared. Stand next to a downed teammate to revive them. Co-op enemies scale with the number of players, 10% gentler than before.

## What's in it

- **Modes** (PLAY SOLO): Standard, Endless (one arena, a boss every 4 minutes), Boss Rush, and a Daily Challenge with the same seed for everyone. Difficulty: Easy, Medium or Hard, plus Nightmare once you reach stage 3 on Hard.
- **Loadouts** (Mansour's v1.x): pick a left click, right click and Q/E special before the run, then grow them through upgrade trees with a two-way evolution fork.
- **Heroes**: Rookie, Bulwark, Dash and Ace, each with a starting auto weapon and quirks. Skins and pets in EXTRAS > WARDROBE.
- **12 weapons**, each with an evolution, plus **weapon combos** when you hold the right pair.
- **Shop between stages**: Mods, optional **curse deals**, and now and then a **secret merchant**. Bosses drop **relics**.
- **Every stage**: a random event (meteor shower, gold rush, fog bank, elite parade, stampede), a side challenge, and combo power-ups (FRENZY, MAGNET BURST, OVERDRIVE).
- **Skill**: perfect dashes (dash through an attack at the last moment), parries that send bullets back, a style meter from D to SS that multiplies your score, and an ultimate per hero.
- **Enemies that think**: crowds surround and flank, shooters hide behind cover, elites lead squads. Shield Bots, Medi Bots, Hop Frogs, Mortar Toads, and the rare Goldbug that runs off with treasure.
- **Bosses** with three phases, arena twists and entrance cinematics, plus a mini-boss mid-stage.
- **Arena toys**: turrets to switch on, jump pads, breakable cover, pillars to topple, hazards to knock enemies into, and an optional objective every stage.
- **Night stages and rain**, dynamic lights, outlines, shockwaves, smoke and debris, with automatic quality to hold 60 fps.
- **Sound**: recorded effects layered on the synths, positional audio, ambience per area, footsteps, and an announcer.
- **Route map** between stages: pick elite fights, shops, treasure, events, rest or the hard path. **Weapon fusion** turns two maxed weapons into one of 10 hybrids.
- **Pets that level up** and learn skills; in co-op, a **TEAM meter** for team moves and **high-five revives**.
- **Heat modifiers** for harder runs, a **weekly challenge** with weird rules, cosmetic unlocks and a **codex**.
- **Boss finishers**, character portraits with expressions, boss voices and hero voice lines.
- **Neon City** and **Sky Fortress** areas, sunsets and cloud shadows, craters that stay, weapon trails, and **photo mode** (PAUSE > PHOTO MODE).
- **Music** that adds an instrument for each weapon you hold, plus an optional 3D headphones mode.
- **Elites** roll a modifier (Shielded, Fast, Splitting, Vampiric, Blinking, Volatile); bosses enrage as they lose life.
- **Arenas**: four biomes with weather, swaying grass, lava that burns, slippery ice and conveyor belts, going from midday to sunset over each stage.
- **Music** composed on the fly per area, with verses, choruses and boss themes that build with the fight; a jukebox in EXTRAS.
- **Extras**: run history, enemy guide, rebindable keys, controller rumble, touch controls, colour-blind and reduced-flashing options, quality presets.
- **Online co-op** for up to 4 players, with pings, spectating and revive bonuses. An optional **online leaderboard** can be switched on (see [server/leaderboard](server/leaderboard/README.md)).

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Aim and shoot | Mouse, hold left click | Right stick / RT |
| Right-click weapon (Charge Shot, Grenade Lobber, ...) | Right click | X |
| Dash | Space, Shift | LB / LT / A |
| Special (Bomb, Thunderstorm, Blizzard, Meteor Shower) | Q, E, middle click | RB / Y |
| Parry (just as a bullet or attack lands) | C | B |
| Hero ultimate (when the ULT meter is full) | V | L3 / R3 / D-pad up |
| Team move (co-op, when the TEAM meter is full) | T | D-pad down |
| Ping (co-op) | G | View / Back |
| Pause | Esc / P / pause button | Start |
| Auto-fire | F | |
| Debug panel (dev) | ` | |

Keys can be changed in SETTINGS > CONTROLS. On a touch screen, on-screen sticks and buttons appear on the first touch.

## Project docs

- [PROMPT.md](PROMPT.md): design brief and rules
- [PLAN.md](PLAN.md): roadmap and decision log
- [CLAUDE.md](CLAUDE.md): code conventions
- [docs/RELEASING.md](docs/RELEASING.md): building releases and code signing

## Credits

- Item icons: [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The game redraws them as pixel sprites (src/ui/pixelIcons.ts).
- Fonts: Jersey 10 and Jersey 15 (Sarah Cadigan-Fried), Silkscreen (Jason Kottke), all SIL Open Font License, bundled via Fontsource.
- Palette: Sweetie 16 by GrafxKid.
- Recorded sound effects and announcer voice generated with [ElevenLabs](https://elevenlabs.io) (scripts/audio/generate.mjs).
