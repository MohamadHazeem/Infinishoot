LANE: hud

Goal: menus and HUD feel juicy and satisfying (late-90s console game vibe).
Build:
1. Animated combo counter: pops and scales on each increment, colour ramps with combo size, shakes at milestones, dramatic break animation when the combo is lost.
2. Damage numbers (src/ui/damageNumbers.ts): distinct styles for normal, crit (bigger, gold, bounce), elemental (fire/shock/frost colours), heal, shield, and big-hit sizes that scale with damage; numbers arc and pop, merge rapid hits on the same enemy to cut clutter. Keep it pooled and cheap.
3. Level-up flourish: a burst/radial flash and card fly-in with staggered bounces on the level-up choice screen, rarity glow and shine sweep on rare+ cards, a satisfying pick animation.
4. HUD polish: XP bar fill animation with a sparkle at the head, HP bar damage chunk (white trailing segment), low-HP pulse, gold counter roll-up, boss bar entrance animation, wave/timer emphasis in the last 10 seconds.
5. Menus: animated title (logo bounce, subtle background motion), button hover/press animations, screen transitions (slide/wipe), consistent sounds on move/select.
6. Respect reduce-motion: all of these must tone down when the reduce motion setting is on.
Owns: src/ui/hud.ts, src/ui/damageNumbers.ts, src/ui/screens.ts and src/ui/menu.ts (animations only; other lanes may add small settings rows there, keep your edits away from the settings section), src/style.css, tests/hud.test.ts if logic.
