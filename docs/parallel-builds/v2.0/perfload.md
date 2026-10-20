LANE: perfload — fast start, light on old laptops

Goal: the game loads fast and runs well on weak machines.
1. Measure first: production build size (dist/), JS bundle sizes, time to title screen and to first frame of stage 1 in headless Chromium (write scripts/loadtime.mjs, `npm run loadtime`), the audio download size and when it happens. Brief target from PROMPT.md: initial load under 5 MB, under 3 s on broadband.
2. Code-splitting: lazy-load heavy, rarely used modules (photo mode, story/cinematics, debug panel, lil-gui, PvP/Versus, mini-games, raid/ghost screens, Electron-only code, large data tables) with dynamic import() so the title shows fast; keep gameplay hot paths in the main chunk. Audio samples: only a small core set before the first stage, the rest streamed in the background by priority (current biome first).
3. LOW quality must be truly light: audit every quality-scaled feature (lights, outlines, post passes, reflections, fog, shatter, trails, particles, debris, decals, weather, sky, crowd framing) and make LOW drop or simplify the expensive ones; AUTO steps down quickly on weak machines. Add a "Potato" preset below LOW (minimal effects, 216p) for very old PCs.
4. Report before/after: bundle sizes, load times, bench numbers at each quality (npm run bench --quality ...).
Owns: vite.config.ts, src/main.ts (lazy imports), src/render/quality.ts and quality hooks in render systems (small, guarded), src/audio/samples.ts loading order (small), new scripts/loadtime.mjs, tests/perfload.test.ts.
