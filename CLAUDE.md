# InfiniShoot

Project brief and rules: @PROMPT.md
Roadmap and decision log: @PLAN.md

## Commands
- `npm run dev`: dev server at http://localhost:5173
- `npm run typecheck`: strict TypeScript check (must pass)
- `npm run build`: typecheck + production build to `dist/`
- `npm run app`: build and open the Electron desktop app
- `npm run dist`: build the portable Windows exe to `release/InfiniShoot.exe` (Electron, electron/main.cjs).
- `npm run dist:mac`: build unsigned Mac dmgs (arm64 + x64) to `release/`. The exe and the dmgs are the shipped builds; there is no itch.io build.
- CI (`.github/workflows/ci.yml`) typechecks and builds every push; pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the exe and the dmgs and attaches them to a GitHub Release.

## Conventions
- Gameplay simulates in 2D on the XZ plane; meshes are presentation only and interpolate between `prev` and `pos`.
- All scene materials use `createRetroMaterial` (src/render/retroMaterial.ts). Global look values live in `retroGlobals` and are shared by reference, so don't `.clone()` retro materials (cloning breaks the sharing); create new ones with the factory.
- Colour management is off: author colours as the hex values you want on screen.
- Tunable values live in exported `*Tuning` objects and get wired into src/ui/debugPanel.ts.
- In dev builds `window.game`, `window.cheats` and the autoplay bot are exposed: `botRun(seconds, god)` simulates headlessly and returns a balance/perf report. Note `window.game` is the canvas element in production (named access by id).
- Instanced pools must upload only live slots: call `commit(attr, count)` (src/render/instancing.ts) instead of setting `needsUpdate`.
- Many-of-a-kind things (enemies, bullets, particles, decals) render via `InstancedMesh`. Per-instance hit flash uses `createRetroMaterial({ instanceFlash: true })` plus an `instanceFlash` vec4 attribute.
- Content is data in src/data/: weapons (full params per level), passives, Mods, enemies, biomes and achievements. Weapon behaviour lives in src/game/weapons/ (one class per weapon, registered in index.ts) and only touches the game through `WeaponCtx`.
- Mods (src/data/mods.ts) are data plus hook functions typed in src/game/modTypes.ts; src/game/synergy.ts runs the ordered slots (Echo resolution, flag sums, damage pipeline, triggers). New Mod behaviour goes through `ModApi`/`ModFlags`, not direct Game access. Weapons read Mod flags via `ctx.flags`.
- `game.stats` is the live stats object (static + per-step Mod effects); call `recomputeStats()` after passives or Mods change, never reassign it.
- All damage goes through `ctx.damage()` / `Game.damage`, which applies stats, crits and freeze-shatter and tracks the per-weapon damage breakdown.
- The persistent profile (achievements, which unlock weapons, and lifetime stats) is `save` in src/game/save.ts. Bump the version and extend `normalize()` when its shape changes, so old saves keep loading.
- Multiplayer: `Game` holds team state (stage, XP, score, director) and `heroes: Hero[]` (src/game/hero.ts) with per-player weapons, passives, Mods, gold, offers and shop; `game.hero` is this machine's hero. `role` is solo, host or client. Solo and host simulate everything; clients move their own hero and mirror host snapshots (src/net/peer.ts transport, src/net/codec.ts binary records).
- Cosmetic effects go through `game.vfx` (src/game/vfx.ts), never fx/particles/sfx directly, so the host can replay them on clients. Anything gameplay-relevant must run in update(), not render().
- New weapons must implement `net()`/`setNet()` for anything clients need to draw.
- `Game` (src/game/game.ts) owns the session: menus, run state and every system. Its modes are title, fight, levelup, cleared, portal, transition and dead. Juice goes through `game.juice.freeze()` / `.shake()` / `.kick()`.
- UI is plain DOM: HUD in src/ui/hud.ts, menus in src/ui/screens.ts. Anything navigable gets `data-nav` so `MenuNav` handles keyboard and gamepad.
- UI style is pixel art: only the Sweetie 16 colour variables in style.css, sizes in `--p` (one UI pixel), frames from the shared box-shadow recipe (set `--bg`, `--hi`, `--lo`, `--ring`), no border-radius, blur or gradients-as-shading, and `steps()` animations. Fonts: Jersey 15 (text), Jersey 10 (big numbers, headings), Silkscreen (small labels), Pixelify Sans (logo only).
- Item icons come from game-icons.net (CC BY 3.0, credited in README and on the title screen): map an item id to an icon name in scripts/icons.mjs, run `npm run icons`, and render with `iconHtml(id, color, glyph)` from src/ui/pixelIcons.ts.
- Persistence goes through src/core/storage.ts, which never throws. Settings and high scores live in localStorage under the `infinishoot.` prefix.
