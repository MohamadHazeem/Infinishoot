# AGENTS.md

Instructions for AI coding agents (Codex and others). Follow `CONTRIBUTING.md` for the workflow and `CLAUDE.md` for code conventions; both apply in full.

Essentials:
- TypeScript + Vite + Three.js twin-stick roguelike. Node 22. `npm install` once.
- Must pass before you finish: `npm run typecheck`, `npm test`, `npm run smoke`.
- Visual check: `npm run shot -- "?test&stage=2&weapons=drones:5" shots/x.png` saves a headless screenshot.
- Work only in the files your task names. Keep shared-file edits (game.ts, hero.ts, hud.ts, screens.ts, style.css) minimal.
- Game methods live in `src/game/systems/*.ts` (`export function name(this: Game, ...)`).
- Never commit secrets or `.env*` files. Never push to `main` unless your task says so.
