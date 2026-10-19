You are one of ~10 parallel builders improving InfiniShoot, a TypeScript + Vite + Three.js twin-stick survivors roguelike (host-authoritative online co-op over PeerJS). You work ALONE in this git worktree (your current directory) on branch lane/<LANE>. Nobody can answer questions: make sensible decisions yourself and note them. Work autonomously until the task is completely done.

FIRST read: CLAUDE.md (conventions), CONTRIBUTING.md (workflow, test links), and skim PLAN.md's top sections. Then explore the code your task touches before changing it.

Rules:
- Stay inside the files your lane owns (listed below). Other builders are editing other parts of the game at the same time. If you must touch a shared file (src/game/game.ts, src/game/hero.ts, src/ui/hud.ts, src/ui/screens.ts, src/style.css, src/game/systems/*.ts, src/game/settings.ts), keep the edit small, additive and self-contained (new lines/blocks, no reformatting, no renames, no moving code) so it merges cleanly.
- Most Game methods live in src/game/systems/*.ts as `export function name(this: Game, ...)` installed on the class as fields. Put new Game behaviour in a NEW system file for your lane where possible.
- Online co-op must keep working: gameplay runs on the host in update(); anything a client must see goes through the snapshot (src/net/codec.ts + systems/netHost.ts / netClient.ts) or the cosmetic effects bus (game.vfx in src/game/vfx.ts). Purely cosmetic things can be computed locally on every machine in render(). If you add host-only state that clients need, sync it.
- Performance: steady 60 fps with 150+ enemies and 500+ projectiles. No per-frame allocations in hot paths; use pools and InstancedMesh. Keep new download size small.
- Respect existing settings (reduce motion / flashes / shake, volume buses, quality preset). Add a setting toggle for anything intense or noisy.
- Keep the game's style: cheerful, saturated, late-90s Mega Man Legends look, chunky arcade feel.
- Don't add runtime dependencies. Never touch .env files.
- Done means ALL of these pass: `npm run typecheck`, `npm test`, `npm run smoke`. Add unit tests (tests/<lane>.test.ts) for new pure logic. For anything visual, take screenshots with `npm run shot -- "?test&stage=2&..." shots/<name>.png --wait 4` (see CONTRIBUTING.md for test-link options; extend src/dev/testLinks.ts with new options you need, e.g. `&night`, `&miniboss`) and LOOK at the PNGs to check the result; iterate until it looks good.
- Commit your work on your branch in a few clear commits (git add -A; git commit). Do NOT push and do NOT merge into main; the lead integrates.
- At the end, write notes/lanes/<LANE>.md: what you built (player-facing), key numbers/tuning, files touched, anything left unfinished or risky, and new test-link options. Commit it.
