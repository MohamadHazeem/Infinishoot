# Gate 2 · Personal death recap

## What players get

Game over opens on the player's killing blow, its portrait, the strongest hit in the preceding five seconds, a ten-second damage timeline, and one line of advice for the fatal attack. Both hits show life before and after. The final hit also shows whether the attack had a wind-up and whether the player had a dash available. RUN STATS switches back to the existing results and rewards. Couch players can switch between fallen seats. Online players see their own death, including someone who fell early and watched the rest of the fight.

WATCH REPLAY plays up to five seconds from the fallen player's perspective. The tactical view shows the hero, nearby enemies, hostile bullets, marked ground strikes, and HP. A caption identifies hits as they happen. Confirm plays or skips, Back leaves the film, and playback returns to the recap automatically. The prompts use the current input device.

## Recording and attribution decisions

- The host keeps the 20 most recent accepted hits for each hero in memory. Each entry carries simulation time, a catalog source ID and attack type, mitigated damage, life before and after, the attack's warning state and dash availability. The receiving UI resolves the source name in its own language. Prevented damage never enters the ring. A successful gameplay rewind or compensated remote bullet parry removes the hits it undid.
- The breaking hit is the single largest loss of actual HP in the last five seconds, including the endpoints. A hit for 35 against 8 remaining HP contributes 8 to the comparison. The ten-second chart uses the same HP measure. Tips cover the enemy behavior catalog, bosses, projectile patterns, volatile explosions, shockwaves and named environment hazards. The English and Arabic catalogs include the recap and advice.
- Existing bullet spawn hooks associate pool UIDs with their shooters even with telemetry turned off. Source IDs travel over the wire. A shot whose provenance is unavailable uses the localized Enemy fire entry and projectile advice. A wind-up flag describes the attack state or its authored warning. It cannot establish which effects a player actually saw.
- The existing rewind recorder supplies the replay. Death freezes a read-only projection of its 10 Hz snapshots at roughly 5 Hz, including an exact final frame. Each 160 × 88 map frame retains the nearest 12 enemies, 12 hostile bullets and four ground warnings. Projection happens at death. The original world continues independently on every peer. Replays near a history barrier can be shorter, and the play button needs two frames. The map shows the threats present in the recorder, so some arena effects appear only in the hit caption.
- A confirmed remote down sends one bounded, reliable message to that player's seat. An ordinary team wipe adds no duplicate. A reconnected player with a new peer ID can recover the prior down in their private results message. The recap adds no fields to combat snapshots. Live hit rings belong to the authoritative host, so an authority migration can shorten the history available for a subsequent death. A fresh run resets the hero's history.
- Gate 1's opt-in summary retains its existing `fatal` entry. The optional `deathCause` tuple carries the source and attack type. The optional `breaking` tuple carries the source, mitigated damage, HP before impact and seconds before death. The shared telemetry validator accepts both fields. Save formats are unchanged.

## Files and shared hooks

- `src/game/damageLog.ts`, `src/ui/deathRecap.ts` and `tests/g2death.test.ts` implement the recorder, results/replay UI with scoped styles, and lane tests.
- `src/game/hero.ts`, `src/game/systems/statuses.ts`, `src/game/netFeel.ts` and `src/game/timeline.ts` hook run reset, accepted damage, confirmed downs, parry refunds, rewind cleanup and read-only threat access.
- `src/game/systems/netClient.ts` and `src/game/systems/runFlow.ts` deliver the private packet, reconnect fallback and seat-specific summary.
- `src/game/systems/telemetry.ts`, `src/net/telemetryClient.ts` and `src/net/telemetrySchema.ts` connect projectile provenance and the two optional telemetry fields.
- `src/ui/screens.ts` registers the replay screen type and calls the recap during existing game-over setup. `src/i18n/en.ts` and `src/i18n/ar.ts` provide the strings. `src/dev/testLinks.ts` adds the deterministic visual fixture.

## Test links and visual checks

- `?test&deathrecap&seed=42` starts on a Rhino death. Lava takes 12 HP, Ground strike takes 30, and Rhino takes the last 8. Add `&lang=ar` for Arabic or `&pad=xbox` for controller glyphs.
- `?test&replaygo=6` exercises the existing automatic team-wipe replay. Continue from MVP to see results. The new recap replay is available again from that screen after a recorded lethal hit.
- The English and Arabic recap PNGs at 1280 × 720 and 1920 × 1080 were visually inspected. The recap, run controls and stats switch fit at all four settings. The English replay finished naturally, Arabic skip returned to results, and both replay captures show a labeled hit. Artifacts are `shots/g2-death-{en,ar}-{720,1080}.png` and `shots/g2-death-film-{en,ar}.png`.

## Verification

- `npm run typecheck`, `npx vite build` and `npm run smoke` passed. The mortal smoke run reached MVP and game over after a Rampage Rex death. A simulated Xbox pad showed the A glyph, opened the replay on A and returned to the recap on B.
- Standalone Chromium startup for `npm run coop -- --offline`, `npm run balance` and `npm run shot` was blocked by the macOS sandbox at `MachPortRendezvous`. Managed headless Chromium ran the offline harness with its original signaling, WebRTC, reconnect and party assertions. The final run passed with 1,897 snapshots, 1,441 bytes on average, a maximum of 12,058 bytes, and zero over 16 KB. All four invincible balance kits passed their stage comparisons. Screenshots came from managed Chromium against this worktree's production preview.
- A separate two-browser test gave the client a fatal Lava hit and the host a later fatal Crusher hit. Each saw the correct result. The client received exactly one personal packet (1,767 bytes), replayed its early down and returned to the same recap. The unit test also enforces a packet size below 12,000 bytes with a full ring and a crowded recording.
- `npm test` passed all 129 test files on the final run. An earlier run missed the existing co-op help-ghost assertion. That test passed on an isolated retry and in the full rerun. `tests/g2death.test.ts` covers ring wrap, overkill, time windows, catalog and bilingual tip coverage, private delivery, reconnect recovery, reset, rewind, refunded hits, bounded replay data, replay controls and telemetry.
