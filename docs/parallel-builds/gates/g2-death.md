LANE g2-death: a death screen that teaches. Every death should feel earned and understood.

Owns: new src/ui/deathRecap.ts (and its injected CSS), the game-over panel hook in src/ui/screens.ts (additive), a damage-history ring buffer (new src/game/damageLog.ts, recorded where heroes take damage: additive hook in the existing hero-hit code), tests/g2death.test.ts, notes/lanes/g2-death.md. Reuse the existing death replay from the time lane (src/game/systems/time.ts: read only, add at most a small accessor).

Build:
1. Damage log per hero: the last 20 hits with source (enemy/boss/hazard/bullet type and its display name), amount, life before/after, whether it was telegraphed and whether a dash was available.
2. On game over: WHAT KILLED YOU (the killing blow with the enemy's portrait/icon), THE HIT THAT BROKE YOU (the largest hit or burst in the last 5 s), a small damage timeline of the last 10 s, and a one-line tip derived from the cause ("Rhino charges telegraph with a red line: dash sideways", from a data table covering every enemy family and boss, EN and AR).
3. A 5-second replay of the death from the existing death replay system, playable from the death screen (button + gamepad prompt), skippable.
4. Co-op: each player sees their own recap; the host records hits for everyone and sends a client its own log at death (one message, bounded size).
5. Works with the Gate 1 telemetry: add cause of death and the breaking hit to the run summary (additive one-liner in telemetry).
6. Fits 720p and 1080p in EN and AR (menuFit rules), no overlap with the existing game-over content. Tests for the log, the recap data and the tip table coverage.
