# Lane juice: make the core loop feel punchy (feel only, no menus)

Goal: shooting, hitting, killing, levelling up, evolving and beating a boss feel punchy and satisfying, judged from recorded gameplay, not from code. Read notes/lanes/skill.md, anim.md, graphics.md, gfx3.md, readability*.md first. Another lane is reworking all menus at the same time: do not touch menus or screens.

1. Record short gameplay sequences (screenshot sequences at 10-20 fps with the shot tools, or the highlight-clip recorder) of: firing each default weapon into a crowd, a big kill streak, an elite kill, a level-up, an evolution, a boss phase change, a boss kill, taking a big hit, a near-death escape. Keep them under shots/juice/before/.
2. Watch them and improve feedback where it is weak: hit-stop and shake scaled to impact, enemy hit reactions (flinch, knockback read, flash), death pops scaled to enemy size, muzzle flashes and impact effects per weapon family, damage number readability (crit vs normal, colour by source, stacking), kill-streak escalation (sound pitch, effect intensity, announcer at milestones), level-up and evolution "power spike" beats (brief slow-mo, ring, sound), boss phase change and boss kill payoff (finisher, slow-mo, screen flash, crowd), low-life tension (heartbeat, vignette, music filter).
3. Use the existing systems and data (src/game/juice*, src/game/vfx.ts, feel data in src/data, existing sounds in public/audio); add synthesized sounds only where nothing fits. Effects go through game.vfx so co-op clients see them. Respect REDUCE FLASHING, screen-shake and game-speed settings.
4. Readability stays first: enemy bullets must stay visible over every new effect (respect the effects governor; add to it if needed).
5. Record the same sequences after (shots/juice/after/) and describe each change with numbers (durations, intensities, counts) in notes/lanes/juice.md.

Done when: every item in step 2 has a visible or audible improvement in the after sequences, `npm run bench` stays in the same CPU range (report before/after), and co-op still shows the effects on clients (`npm run coop -- --offline`).

Owns: src/game/juice*.ts, src/game/vfx.ts (additive), feel/juice tuning data in src/data, the hit-reaction and death-pop parts of src/game/systems/anim*.ts, src/audio/sfx.ts (additive cues), tests/juice.test.ts, notes/lanes/juice.md. Do not edit menus/screens (menus lane), src/render/** (perf lane), electron/** (steam lane), server/** or telemetry modules (telemetry lane).


CODEX NOTE: you are running in Codex. Use your headless browser (Playwright MCP) against `npx vite preview --port <free port>` or `npm run shot` to look at every screen you change, in English and Arabic, at 1280x720 and 1920x1080, and fix what looks wrong before you finish. Do not start Docker containers. Save the screenshots you reviewed under shots/<lane>/ (git-ignored) and list them in your notes.
