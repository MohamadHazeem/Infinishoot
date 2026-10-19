# HUD lane

## Player-facing changes

- Combo numbers pop on every visible increment, ramp from white through lime/cyan/gold/orange, shake on crossed ten-kill milestones, and retain the lost combo during a stepped break animation.
- Damage numbers arc, pop and grow with damage. Crits bounce in gold; fire, shock, frost, healing and shields have distinct colours/markers. Rapid nearby hits of the same kind merge, using the existing fixed DOM pool.
- Level-up screens open with a pixel diamond burst and staggered bouncing cards. Rare/legendary cards retain their rarity rings/glow and gain a shine sweep. A detached picked card flies away while the actual pick is applied immediately, including on clients.
- XP fill eases with a sparkle at its head. HP damage leaves a white trailing chunk; low HP pulses. Gold gains roll up, spending updates immediately. Boss bars enter with a bounce and sit below the stage label. The last ten seconds emphasize the clock and stage.
- Title letters bounce in, the dither backdrop drifts, menu screens wipe in, and buttons lift/press. Mouse, keyboard and gamepad selection share one UI-bus sound; pointer navigation now also sounds.

## Tuning and decisions

- Combo colour thresholds: 10 / 25 / 50 / 100. Pop: 180 ms; milestone shake: 300 ms, multiplied by the existing shake slider. Break: 650 ms.
- Damage pool: 48 elements; life: 800 ms. Merge window: 140 ms, radius: 0.35 world units, height tolerance: 0.25; same style only. Merging never extends the original lifetime. Size is logarithmic, capped at 1.65× before the pop and per-style font size.
- HP damage hold: 220 ms, then catch up at 1.4 full bars/sec. XP/gold exponential approach rates: 14/sec. Level changes snap XP to the new level; new runs reset counter/health animation state.
- Cards enter in 420 ms, staggered by 70 ms. Pick fly-away: 380 ms; unconditional cleanup at 420 ms. No added gameplay lock or network delay.
- This checkout has OS `prefers-reduced-motion` and an in-game **Reduce flashes** switch, but no separate motion switch. Both now suppress the new UI motion, particles/reels, shine and burst; counters snap and low-HP feedback stays static. The cached media query still follows live preference changes. Existing volume buses are reused.
- Elemental/shield labels use the existing string-valued effects event, e.g. `42 FIRE`; the UI displays `42` in the appropriate style. No snapshot/event schema changes; old clients can still display the readable label. Crits retain their gold style. Only already-visible hit events are styled; silent damage-over-time ticks remain silent.
- Decision log is kept here instead of editing shared PLAN.md, per the lane ownership constraint.

## Files

Owned files: `src/ui/hud.ts`, `src/ui/damageNumbers.ts`, `src/ui/screens.ts`, `src/ui/menu.ts`, `src/style.css`, `tests/hud.test.ts`.

Minimal shared hooks: `src/game/systems/combat.ts` adds the cosmetic elemental/shield label; `src/game/systems/levelUps.ts` adds one local pick-effect call before the existing host/client action path. No settings rows, gameplay tuning, dependencies or generated assets changed.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: all five test files, including HUD easing, thresholds, pooling/merging/expiry, real effects-bus replay, HP/max-HP updates, reset behaviour, accessibility, shake slider and menu sound tests.
- `npm run smoke` passed through standard/endless/bossrush/daily and mortal game-over runs.
- Captured and inspected `shots/hud-combat.png`, `hud-boss.png`, `hud-title.png`, `hud-feedback.png`, `hud-combo-break.png`, `hud-levelup.png`, `hud-pick.png`, `hud-reduced-motion.png`, `hud-small.png`. Screenshots and the local Playwright review harness remain ignored.
- Browser checks confirmed a pick returns immediately to fight mode, the detached card is removed, and OS reduced motion produces zero running CSS animations with no burst or logo movement. The 800×600 card screen remains scrollable.

## Limits / integration notes

- The existing number event has no enemy ID. Merging is conservatively positional: extremely close enemies of the same height/style can share a number, and a fast-moving enemy can get separate numbers. Exact identity merging would require extending the shared effects event; this lane deliberately preserves that contract.
- No live two-browser PeerJS session was run. The test does exercise recorded host number events through JSON serialization and client `Vfx.apply`, and the pick hook runs before the existing role branch.
- No unfinished implementation beyond the positional-merging limitation above. No new test-link options.

Reproduce the standard captures:

```sh
npm run shot -- "?test&stage=2&weapons=drones:5&god&seed=42" shots/hud-combat.png --wait 4
npm run shot -- "?test&stage=4&boss&god&seed=42" shots/hud-boss.png --wait 4
```
