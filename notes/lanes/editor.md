# Editor lane: build your own arena

EXTRAS > ARENA EDITOR. Players build an arena on a top-down map, set its rules, play it solo, host it online, and share it as a text code.

## What players get
- **Arena list** (`arenas` screen): up to 20 saved arenas (newest first) with PLAY / EDIT / HOST / DELETE, their local best, NEW ARENA, three samples (Sunny Plaza, Fortress, Lava Pit) and a paste box for IMPORT CODE.
- **Editor** (`arenaedit` screen): a pixel top-down map of a blank fenced field drawn in the biome's colours, a palette, and BUILD / RULES / SHARE tabs.
  - Pieces (src/editor/pieces.ts, 23 in all): cover (wall 4 m, long wall 8 m, cover block, pillar, toppling pillar, rock, tree, crate, crate stack, barrel), hazards (lava, ice, quicksand, thorns, water pond; R cycles 4 radii), toys (turret, jump pad, conveyor belt; R turns them), markers (hero spawns 1-8, the boss marker, chest spots, enemy gates). Per-piece caps; 320 pieces at most.
  - Mouse: LMB place, RMB erase, wheel rotate, hover shows a ghost. Keyboard/gamepad: TAB/Esc/Start/B leave the map cursor for the menus, Esc/B or EDIT MAP (or a click on the map) go back; on the map WASD/arrows/D-pad/stick move, Enter/Space/A place, X/Delete/gamepad X erase, R/gamepad Y rotate (Shift+R turns the piece under the cursor), Q/E/LB/RB change piece, Z/Y/LT/RT or Ctrl+Z/Ctrl+Shift+Z undo/redo (100 steps), G grid snap (2 m; off = 1 m). Prompts come from src/ui/prompts.ts.
  - Size presets S/M/L/XL (half side 24/34/44/54 m); shrinking drops pieces that no longer fit (undoable).
  - Validity check (live, in the header badge and panel): flood fill on a 1 m grid from the hero spawns with jump pads as one-way links; it needs a hero spawn, a boss marker the heroes can reach, no spawn/chest/gate inside a wall or hazard, and at least 140 m² of walkable floor. Unreachable floor is hatched on the map. PLAY and HOST are blocked with the reason while it fails.
- **Rules**: biome (all biomes incl. remixes and biome3's Candy/Sunken), waves (Classic, Swarm, Shooters, Brutes, Boom, Natives, All, or Custom: up to 8 enemies from the bestiary roster), stage time 1:00-8:00 in 30 s steps, boss (Auto = the stage's own, or any of the 14 bosses incl. Titan, Cake Tyrant and Kraken King), difficulty (locked ones fall back to Medium), night, rain, wind (Sky Fortress wind on any biome), events on/off, swarm rings on/off, heat handicaps.
- **Playing**: PLAY goes through LOADOUT (BACK returns to the editor). Every stage of the run replays the same arena with the usual per-stage scaling. Heroes start on the hero spawns, the boss lands on its marker, enemies also pour in through the gates, timed chests appear on the chest spots. Game over shows the arena's own top-10 (key `infinishoot.arenaBest.v1`, per arena fingerprint); RETRY replays the same arena. Custom runs never reach the normal high scores or online boards, and grant no achievements (it's a sandbox).
- **Online**: HOST ONLINE opens a co-op lobby with the arena picked; the lobby has an ARENA button for the host (clients see the host's pick). The `start` message (normal start and coop2 drop-in) carries `arena`: the packed binary body as base64url (168 chars for the demo, ~1 KB for a full arena). Clients rebuild the identical arena; an ordinary start clears a stale custom arena; a bad payload is ignored.
- **Share codes**: `ISA1.` + base64url(body) or `ISA1z.` + base64url(deflate-raw(body)) whichever is shorter. Body: version, size, name, rules, 3 bytes per piece, CRC-32. Decode checks prefix, length (8 KB code, 4 KB inflated), CRC, every read, then `normalizeArena`. COPY CODE / SHOW CODE / IMPORT CODE on the SHARE tab and the list.
- English and Arabic strings in src/i18n/editor.ts (spread into en.ts / ar.ts).

## Files
- New: src/editor/{arenaData,pieces,codec,build,ops,history,store,samples,mapView}.ts, src/ui/editorScreen.ts, src/game/systems/editor.ts, src/i18n/editor.ts, tests/editor.test.ts, notes/lanes/editor.md.
- Small hooks: game.ts (installEditor), systems/runFlow.ts (`editorArena` in loadArena, `editorNet` in the start message, `editorScores` in bankAndShow), systems/coop2.ts (`arena` in the drop-in start), wind.ts (`windForce`), screens.ts (`arenas`/`arenaedit` in ExtraScreen), testLinks.ts, i18n en/ar spreads. Everything else (rules, spawns, boss placement, pool, lobby button, client start) wraps Game methods at install time, like the trials lane; outside a custom run every wrapper delegates unchanged.
- src/editor/build.ts builds the Arena object from data by reusing fieldArena pieces (walls in the biome style, rocks, trees, crates, pillars, hazards and belts), so colliders, hazard queries, pads and turrets work with every existing system.

## Test links
- `?test&editor=demo` (also `fortress`, `pit`, or a share code), `&editorscreen=rules|share|list|pick`, `&editorcursor=x,z&editorpiece=wall`.
- `?test&arena=pit` plays a sample (or a code) solo; `&arenaboss` jumps to the boss.
- Screens: shots/editor-1.png (build), editor-rules.png, editor-share.png, editor-list.png, editor-play.png, editor-boss.png (Rampage Rex on Lava Pit).

## Tests
tests/editor.test.ts: piece catalog, code round-trip (plain and deflate), CRC/truncation/garbage/oversize rejection, normalisation of hostile data, validity (reachability, pads, blocked spawns, too small), colliders from data equal the map, undo/redo, store limit (20) and bests, solo run on a custom arena with every boss, rules restored on the title, and a two-Game co-op round-trip (same colliders, hazards, pads, belts and biome on host and client; drop-in; stale/bad arenas).

Gates on this branch: typecheck, vite build, smoke and `npm run coop` pass. `npm test`: editor passes; eightp, i18n and raceCoop fail identically on the untouched base commit (5071377); onboarding's "tips come back" check is flaky (failed once, passed 3/3 reruns).

## Unfinished / risky
- Not play-tested by a person; the gamepad cursor was tested only through MenuNav/key events in jsdom.
- The Halloween candy overlay (another lane) floats over the editor screen when the season is on.
- Rules wrap Game methods (spawnBoss, director pool, ring points, chest spawns): if another lane renames those, the wrappers silently fall back to normal behaviour; tests cover each boss spawning on its marker.
- Codes use `CompressionStream` when present (browsers, Electron, Node 18+); without it only plain codes are written, both decode where supported.
- Scores are per machine; no online arena sharing (codes are pasted by hand), by design (no backend).
- Custom difficulty Nightmare needs Hard Boiled on the playing machine; otherwise it plays at Medium.
