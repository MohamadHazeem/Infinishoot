LANE: firstten — the first 10 minutes of a new player's life

Goal: a brand-new player loves the first 10 minutes. Play it like a newcomer (fresh save: test links / bot / screenshots) and polish everything they meet:
1. Title → TRAINING field (offered once) → MODE → LOADOUT → starting shop → stage 1. Every step clear, quick and juicy; skip-able for veterans; no dead time; first-time tips arrive at the right moment and never pile up.
2. Stage 1 pacing: the first 60-90 s should be a gentle ramp with an early "wow" (first big multi-kill, first chest, first level-up within ~25 s), then a steady climb; the first elite and the first boss are clearly introduced (telegraph tips). Tune only stage-1/first-run values (director, XP of the first levels, first-run tip timing), backed by bot runs (window.botRun) for both a fresh save and the default kit; record before/after numbers.
3. First level-up and first shop: the screens explain themselves (highlight what to look at, short helper text on first visit only), cards readable at a glance.
4. First death: an encouraging game-over with one clear "next try" suggestion (e.g. "Try dashing through the Rhino's charge") chosen from what killed you; quick RETRY.
5. A FIRST-RUN checklist of small goals shown on the title for new saves (play a run, evolve a weapon, beat a boss, try co-op...) with a cosmetic reward.
Owns: src/game/onboarding.ts, new src/game/systems/firstten.ts, first-run bits of director/levelUps (small), tip data, game-over suggestion data, tests/firstten.test.ts.
