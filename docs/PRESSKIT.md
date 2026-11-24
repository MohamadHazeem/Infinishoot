# InfiniShoot press kit

A line of drones keeps firing as you dash through a gap in the swarm. Your arm cannon still points where you aim. In InfiniShoot, that split between what you control and what your build does for you lasts all the way to the boss. Beat it, collect your chest and take the portal to the next island.

## Fact sheet

| | |
| --- | --- |
| Title | InfiniShoot |
| Developer credit | Mansour Almadi |
| Genre | Twin-stick survivors roguelike |
| Platforms | Windows, macOS (Intel and Apple Silicon), browser |
| Players | Solo, shared-screen co-op, online co-op for up to eight |
| Art direction | Bright, chunky low-poly characters, painted faces and a tunable PS1-inspired finish |
| Technology | TypeScript and Three.js, with an Electron desktop build |
| Play and download | [Browser game](https://mohamadhazeem.github.io/Infinishoot/) · [Desktop releases](https://github.com/MohamadHazeem/Infinishoot/releases) |
| Press assets | [30 English gameplay stills, 1920 × 1080 PNG](../marketing/screens/) |

## What to look for

- **One hero, two directions.** Strafe around a warning ring while keeping the arm cannon on a weak point. A well-timed parry sends incoming fire back.
- **A build you can see.** Pick your two click weapons and special before the run. Rank up a weapon, choose an evolution fork, or combine compatible automatic weapons into a fusion. Storm Drones bring lightning to the escort formation.
- **Islands with different fights.** Skid across Frosty Peaks, cross conveyors in the Toy Factory or fight under Neon City's lights. Bosses enter the arena with their own camera cues, tells and changes of phase.
- **A crew on one field.** Share a screen or bring friends online. Carry a downed teammate and time a team ultimate together. Trials, weekly runs and the Hydra Engine raid offer other ways to play.
- **A postcard from the run.** Pause solo play to orbit the camera, pose the hero, choose the hour and add a frame or sticker. Photo mode exports a PNG.
- **Fresh starts.** Unlocks broaden the available kits. Each new run starts on equal footing.

## Default controls

Controller labels below use the Xbox layout. Keyboard bindings can be changed in Settings → Controls.

| Action | Keyboard and mouse | Controller |
| --- | --- | --- |
| Move | WASD or arrows | Left stick |
| Aim and fire the primary | Aim with the mouse, hold left click | Aim with the right stick, RT to fire |
| Secondary weapon | Right click, hold and release for Charge Shot | X |
| Dash | Space or left Shift | A, LB or LT |
| Parry | C | B |
| Special | Q, E or middle click | RB or Y |
| Hero ultimate | V | Press either stick (R3 when L3 is bound to talk) |
| Team move | T | D-pad down |
| Pause | Esc or P | Start |

## Screenshot desk

Filenames begin with the take number and end with the zero-based frame within that take. For a short gallery, lead with the entrance, show a build payoff, then show how the game looks during play.

| Select | Suggested caption |
| --- | --- |
| [King Bopper](../marketing/screens/02-king-bopper-00055.png) | King Bopper takes the field in Bright Meadow. |
| [Flare Buster](../marketing/screens/05-evolution-00154.png) | The hero salutes as the Flare Buster evolution lands. |
| [Storm Drones](../marketing/screens/06-storm-drones-00038.png) | Orbit Drones and Chain Zap fuse into Storm Drones, spreading lightning through the autumn swarm. |
| [Shared-screen crew](../marketing/screens/11-couch-crew-00056.png) | Three heroes cover different directions on the same screen. |
| [Titan Goliath](../marketing/screens/16-titan-beam-00204.png) | The Titan fires from its eye as the hero circles below. |
| [Photo mode](../marketing/screens/20-postcard-00134.png) | A posed hero sends an airmail postcard from Bright Meadow. |

## Credits

Game development by Mansour Almadi. The Sweetie 16 palette is by GrafxKid. Item icons adapt silhouettes by Lorc, Delapouite and contributors into pixel sprites. [Game-icons.net](https://game-icons.net/) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

Jersey 10 and Jersey 15 are by Sarah Cadigan-Fried. Silkscreen is by Jason Kottke. The Arabic interface uses Noto Sans Arabic. The bundled fonts use the SIL Open Font License. Recorded sound effects and the announcer voice were generated with ElevenLabs. [Game credits](../README.md#credits) · [Arabic font licence](../public/fonts/NotoSansArabic-OFL.txt)

## Trailer source for the editor

The silent picture masters run at **60 fps, 1920 × 1080, square pixels**. Import each directory in `shots/g10-trailer/frames/` as a separate five-digit PNG sequence beginning at `00000.png`. Place the takes end to end at the times below for 5,400 frames. Frame zero in each folder already includes its scripted preroll. The final cut, sound mix, titles and release messaging belong to the editor.

| In (seconds) | Length | Take | Cue |
| ---: | ---: | --- | --- |
| 0 | 5 s | `01-first-contact` | Bright Meadow · the dash through the pack |
| 5 | 4 s | `02-king-bopper` | King Bopper · entrance and first attack |
| 9 | 5 s | `03-dune-patrol` | Sunset Dunes · drone escort |
| 14 | 4 s | `04-parry` | Frosty Peaks · return fire |
| 18 | 4 s | `05-evolution` | Flare Buster · the evolution salute |
| 22 | 5 s | `06-storm-drones` | Storm Drones · lightning through the swarm |
| 27 | 5 s | `07-ronin` | Neon City · Ronin draws the katana |
| 32 | 4 s | `08-toy-factory` | Toy Factory · conveyor skirmish |
| 36 | 4 s | `09-boxer-jack` | Boxer Jack · the wind-up |
| 40 | 5 s | `10-sky-fortress` | Sky Fortress · over the chasm |
| 45 | 6 s | `11-couch-crew` | Shared-screen co-op · three kits in one arena |
| 51 | 5 s | `12-team-ultimate` | Team ultimate · the crew closes ranks |
| 56 | 4 s | `13-glitch-dj` | Glitch DJ · neon dance floor |
| 60 | 4 s | `14-hive-queen` | Hive Queen · entrance above the snow |
| 64 | 5 s | `15-titan-rise` | Titan Goliath · the reveal |
| 69 | 5 s | `16-titan-beam` | Titan Goliath · beam and weak points |
| 74 | 4 s | `17-magma` | Magma Isle · rockets in the caldera |
| 78 | 4 s | `18-omega` | Omega Overlord · the last blow |
| 82 | 4 s | `19-golden-route` | Bright Meadow · the golden portal |
| 86 | 4 s | `20-postcard` | Photo mode · airmail from Bright Meadow |

The co-op clips use the real shared-screen session with scripted controller inputs and the team-ultimate test fixture with automated teammates. Both captures run offline.

### Reproduction

From the repository root with Node 22, installed dependencies and a Playwright Chromium available, run:

```sh
npx vite build
node scripts/capture/capture.mjs --list
node scripts/capture/capture.mjs --output shots/new-trailer/frames
node scripts/capture/capture.mjs --verify --output shots/new-trailer/frames
node scripts/capture/capture.mjs --press --output shots/new-trailer/screens
node scripts/capture/capture.mjs --verify --press --output shots/new-trailer/screens
```

Use `--shot 15-titan-rise` to render or verify one take. Use `--chrome /path/to/chromium` for a local browser executable. The renderer opens a headless browser against its own loopback production preview and creates a fresh profile for each take. Recording advances the in-engine clock by one sixtieth of a second for each output frame, even when PNG encoding takes longer. Render to a fresh directory for retakes. The default frame destination is git-ignored. The shot manifest includes the test links, seeds, camera choices, preroll and press frame numbers. [Capture manifest](../scripts/capture/shots.mjs)
