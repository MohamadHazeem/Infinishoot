You are one of ~12 parallel builders in an overnight build of InfiniShoot, a TypeScript + Vite + Three.js twin-stick survivors roguelike with host-authoritative online co-op (PeerJS/WebRTC). You work ALONE in this git worktree (your current directory) on branch lane/<LANE>. Nobody can answer questions: make sensible decisions yourself and write them down. Work autonomously until the whole task is done, end to end.

FIRST read CLAUDE.md fully (it lists every convention and system: loadouts, rarity, co-op snapshots, effects bus, biomes, screens, prompts, saves, Milestone 9-11 systems), CONTRIBUTING.md (workflow, test links) and the top of PLAN.md. Look at notes/lanes/*.md for the system you touch. Then read the code you will change before changing it.

Rules:
- Own the files your lane lists. Other builders edit other parts at the same time. Shared files (src/game/game.ts, hero.ts, ui/hud.ts, ui/screens.ts, style.css, settings.ts, dev/testLinks.ts, systems/netHost.ts, netClient.ts, scripts/coop-test.mjs): keep edits small and additive (new lines/blocks; no reformatting, renames or moving code) so merges stay clean. Put new Game behaviour in a NEW src/game/systems/<lane>.ts; inject lane CSS from your module (CLAUDE.md); register screens via screens.addScreen.
- Co-op must keep working: gameplay on the host in update(); clients get state via the snapshot (own field per lane) or the effects bus (game.vfx). Cosmetic-only things can be local.
- Performance: steady 60 fps with 150+ enemies and 500+ projectiles; pools, InstancedMesh, no per-frame allocations. Run `npm run bench` if you add per-frame work and keep CPU per frame in the same range (~2 ms).
- Respect settings (reduce motion/flash, volume buses, quality, UI scale, prompts). New toggles go in SETTINGS with sensible defaults.
- Style: cheerful, saturated late-90s Mega Man Legends look; pixel-art UI rules in CLAUDE.md.
- Recorded audio: public/audio/*.mp3 (ids in public/audio/manifest.json, prompts in scripts/audio/sounds.mjs). Use existing samples where they fit; otherwise synthesize via sfx.ts. Never touch .env files or call external APIs.
- No new runtime dependencies unless essential. Save format changes must migrate old saves (src/game/save.ts normalize()).
- Done means ALL pass: `npm run typecheck`, `npx vite build`, `npm test`, `npm run smoke`, and `npm run coop` if anything online/co-op is touched. Add unit tests (tests/<lane>.test.ts) for new logic. Check visuals with `npm run shot -- "?test&..." shots/<lane>-x.png --wait 4` (extend src/dev/testLinks.ts with options you need) and LOOK at the PNGs; iterate until it looks good.
- Commit on your branch in a few clear commits. Do NOT push or merge; the lead integrates.
- Finish with notes/lanes/<LANE>.md: what players get, tuning numbers, files touched, test links, what is unfinished or risky. Commit it.
