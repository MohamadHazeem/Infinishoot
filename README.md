# InfiniShoot

A colorful twin-stick survivors-style roguelike for Windows. You aim an arm cannon while automatic weapons build up around you, survive timed stages against swarms, beat the boss, and dive through the portal to a harder stage. Every run starts equal; achievements unlock new weapons for future runs.

Built with TypeScript, Vite and Three.js, with a Mega Man Legends-inspired low-poly look and subtle PS1-style effects.

## Play it

Download `InfiniShoot.exe` from the [Releases page](https://github.com/Mansouralmadi/Infinishoot/releases) and double-click it. No install needed. The first launch takes a few seconds while it unpacks.

The exe isn't code-signed yet, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**.

Press F11 for fullscreen. Progress saves automatically on your PC. To back it up or move it to another PC, use UNLOCKS > SAVE DATA > SAVE TO FILE, then LOAD FROM FILE on the other PC.

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
| `npm run app` | Build and open the desktop app |
| `npm run dist` | Build `release/InfiniShoot.exe` (single portable exe) |

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

Title screen > PLAY ONLINE. One player hosts and shares the 5-letter code; up to 3 friends join with it. Each player has their own weapons, gold, Mods and shop; XP and score are shared. Stand next to a downed teammate to revive them.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Aim and shoot | Mouse, hold left click | Right stick / RT |
| Charge shot (hold, release to fire) | Right click | X |
| Dash | Space, Shift | LB / LT / A |
| Bomb | Q, E, middle click | RB / Y |
| Pause | Esc / P / pause button | Start |
| Auto-fire | F | |
| Debug panel (dev) | ` | |

## Project docs

- [PROMPT.md](PROMPT.md): design brief and rules
- [PLAN.md](PLAN.md): roadmap and decision log
- [CLAUDE.md](CLAUDE.md): code conventions

## Credits

- Item icons: [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The game redraws them as pixel sprites (src/ui/pixelIcons.ts).
- Fonts: Jersey 10 and Jersey 15 (Sarah Cadigan-Fried), Pixelify Sans (Stefie Justprince), Silkscreen (Jason Kottke), all SIL Open Font License, bundled via Fontsource.
- Palette: Sweetie 16 by GrafxKid.
