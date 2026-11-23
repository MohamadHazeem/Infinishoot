# Gate 7 · Vertical routes

Each procedural stage has two to four elevated routes. Lime treads lead up a ramp, gold chevrons mark a one-way drop, and orange jump pads land on matching bridge decks. Heroes can fight above a bridge while enemies or teammates cross underneath. On the local screen, the bridge grate opens when the player walks below it. The rails still show the footprint overhead.

## Rules and decisions

- The simulation still moves actors in XZ. A one-metre cell map gives the available floor at each position. A four-metre ramp rises to a 2.4 m deck. Side ledges stop a grounded actor and let it slide along the wall. A marked far edge permits a drop. Each bridge has a four-metre lower crossing and a pad four metres beyond its landing.
- An elevated shooter gains 15% target-acquisition range and 6% direct projectile damage. The bonus also applies to player rail and laser hits. The Rail Driver retains its established ability to pierce cover on the same firing plane. The uphill face still protects an elevated target. Uphill shots can follow a ramp, a solid ledge absorbs incoming low fire, and shots can leave the deck toward lower ground. Opposite floors at a bridge protect against direct shots and ordinary contact. Loot settles through bridge grates. The existing magnet and boss reward vacuum can retrieve it across floors.
- Snipers within four metres of a perch can seek its ramp if their target will be in firing range. They remember the approach while circling the retaining wall. If a target leaves firing range, a perched sniper can take the marked drop and resume pursuit. On top, they hold position and use the existing visible windup and a 23 m sight line. Snipers trace sight from their own floor even on a grate with an open route directly below. Chargers and ordinary chasers approach a raised target by its ramp. Bosses and flying or burrowing enemies can cross the structures. Dropping introduces no fall damage. The feature adds no new attack or cooldown.
- A separate seeded stream chooses orientation and placement. Route centers remain at least 16 m apart to keep space for kiting. Features reserve the approach, deck and pad, avoid the central encounter area and leave room for existing cover, hazards, interactives and machinery. Authored layouts keep their authored collision. There are no new UI strings, settings or save keys.
- The host resolves movement and combat. Clients reconstruct the same map from the stage seed and predict local hero motion. Existing snapshots carry an optional sparse floor field for ambiguous bridge cells and airborne heroes. Enemy and bullet entries use existing UIDs. The height geometry uses one indexed mesh per stage, pooled bullets retain floor through swap-removal, and the grate cutaway only updates the index buffer on entry and exit. Each route has its own conservative visibility bounds, so the shared mesh skips submission when every route is offscreen.

## Files and shared hooks

| Files | Change |
| --- | --- |
| `src/world/height.ts`, `src/world/heightPlay.ts` | Seeded layout and floor queries, movement, route and line-of-sight tests, portal placement, host and client floor state. |
| `src/world/heightView.ts`, `src/world/heightPools.ts` | Terrain mesh, grate cutaway, hero and shadow height, pooled shots and loot. |
| `src/world/fieldArena.ts`, `src/world/setPieces.ts` | Install routes and pad destinations, reserve the space when laying out machinery. |
| `src/game/enemies.ts` | Store enemy floor, route grounded chasers and snipers, and lift bodies and attack markers. |
| Shared `src/game/game.ts` | Instantiate the terrain-aware pools. Hook existing movement, wall and portal queries, weapon contexts, combat damage, enemy targets, snapshots, aiming and rendering. |
| Shared `src/game/hero.ts`, `src/dev/testLinks.ts` | Hold/reset the hero floor, retain the detached shadow, and expose the height test position. |
| `tests/g7vertical.test.ts`, `notes/lanes/g7-vertical.md` | Regression coverage and these measurements. |

## Try it

Open `?test&season=off&seed=11&stage=1&height=ramp&god`. Walk toward the stripes to climb, continue past both chevrons to drop, then step on the pad facing the drop to return to the deck. Use `height=under` for the lower crossing or `height=deck` for the top. For night, append `&biome=dunes:night&night&lang=ar`. For Rex, use `?test&season=off&seed=11&stage=2&height=deck&bossnow&nointro&god`.

## Visual verification

The headless production previews used the original revision `a87a401` and the delivered scene at identical positions. Seed 11, season off, six seconds of play per screenshot. Meadow uses stage 1 at (10, 26.8), night uses the lower passage at (10, 24.2), and stage 2 places the hero at (−2, 27.8) with Rex three metres west and five metres north. All 24 before/after captures were inspected in both languages and both sizes. The review led to a local cutaway and a correction to the hero’s foot marker.

| Scene | English 1280×720 | Arabic 1280×720 | English 1920×1080 | Arabic 1920×1080 |
| --- | --- | --- | --- | --- |
| Meadow deck | [before](../../shots/g7-vertical-before-meadow-en-720.png) / [after](../../shots/g7-vertical-after-meadow-en-720.png) | [before](../../shots/g7-vertical-before-meadow-ar-720.png) / [after](../../shots/g7-vertical-after-meadow-ar-720.png) | [before](../../shots/g7-vertical-before-meadow-en-1080.png) / [after](../../shots/g7-vertical-after-meadow-en-1080.png) | [before](../../shots/g7-vertical-before-meadow-ar-1080.png) / [after](../../shots/g7-vertical-after-meadow-ar-1080.png) |
| Dunes at night, under the bridge | [before](../../shots/g7-vertical-before-night-en-720.png) / [after](../../shots/g7-vertical-after-night-en-720.png) | [before](../../shots/g7-vertical-before-night-ar-720.png) / [after](../../shots/g7-vertical-after-night-ar-720.png) | [before](../../shots/g7-vertical-before-night-en-1080.png) / [after](../../shots/g7-vertical-after-night-en-1080.png) | [before](../../shots/g7-vertical-before-night-ar-1080.png) / [after](../../shots/g7-vertical-after-night-ar-1080.png) |
| Rex at the drop | [before](../../shots/g7-vertical-before-boss-en-720.png) / [after](../../shots/g7-vertical-after-boss-en-720.png) | [before](../../shots/g7-vertical-before-boss-ar-720.png) / [after](../../shots/g7-vertical-after-boss-ar-720.png) | [before](../../shots/g7-vertical-before-boss-en-1080.png) / [after](../../shots/g7-vertical-after-boss-en-1080.png) | [before](../../shots/g7-vertical-before-boss-ar-1080.png) / [after](../../shots/g7-vertical-after-boss-ar-1080.png) |

A [perched sniper targeting a hero on the lower floor](../../shots/g7-vertical-sniper-windup.png) was checked with 0.27 seconds of its windup remaining. The warning follows the outgoing bolt down from the grate and crosses the hero’s feet. A grounded charger’s warning ends at a retaining wall. Both cases reuse the existing line instance buffer and have regression assertions.

The stock screenshot command also captured the [Arabic underpass at 1280×720](../../shots/g7-vertical-under-ar-720.png). macOS sandboxing blocked a separate Chromium launch from the shell. The stock drivers attached to a managed headless Chromium over loopback CDP.

## Gate 2 difficulty

The unmodified revision and the delivered build ran the same 40 consecutive seeds on Normal with Rookie, no pet, season off and a cap of 2,100 simulated seconds. Both runs used the Gate 2 skilled bot with its stock reaction, aim and decision settings.

| Build and seeds | Stage 1 | Stage 2 | Stage 3 | Loop | Mean run time | Timed out |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original, 1–20 | 20/20 | 20/20 | 20/20 | 12/20 (60%) | 1,021.0 s | 0 |
| Vertical routes, 1–20 | 20/20 | 19/20 | 16/20 | 10/20 (50%) | 933.9 s | 0 |
| Original, 21–40 | 20/20 | 20/20 | 20/20 | 12/20 (60%) | 1,008.5 s | 0 |
| Vertical routes, 21–40 | 20/20 | 18/20 | 14/20 | 7/20 (35%) | 867.7 s | 0 |
| Original, 1–40 | 40/40 | 40/40 | 40/40 | 24/40 (60%) | 1,014.8 s | 0 |
| Vertical routes, 1–40 | 40/40 | 37/40 | 30/40 | 17/40 (42.5%) | 900.8 s | 0 |

The delivered clear rate was 42.5%, within the 40–60% Normal target. The pilot reached a deck 71 times across 26 seeds and spent 59.3 simulated seconds there.

An earlier version cleared 15 of the first 20 seeds and 10 of the next 20. On seed 28 its stage-2 portal opened during a jump. Walking from the landing to the portal sent the hero back onto the same pad until timeout. Checking the path from the committed landing fixed the loop. The seed-28 regression cleared the four-stage loop in 1,067.0 simulated seconds immediately after the portal fix. Snipers now check a perch’s view of the target before climbing and resume movement when an obstacle screens the shot. Other elevated shooters also get the 15% range increase. Replaying seeds 3 and 4 against the working tree reproduced their per-stage damage, kills, parries, loadouts, deck time, outcome and simulated duration from the 40-seed run. The regular windups and projectile speeds stay in force.

All four invincible balance kits reached stage 3 within their original 25% tolerances. Their cumulative stage-2 kill counts were buster 13,729, laser 13,800, scatter 12,224, rail 12,475.

## Co-op and coverage

The final stock offline WebRTC suite passed across three stages, a portal vote, a guest jump, a vault and a forced reconnect. It sent 1,920 snapshots averaging 1,927 bytes. One reached 16,835 bytes and was chunked by PeerJS. Host and guest matched the objective layout at all three stage loads. An additional two-browser probe checked that both peers built identical height sites, then placed both heroes in the same bridge cell. Both screens showed the host at 2.4 m and the guest at ground level. After only the host exchanged their floor assignments, the guest received the new ordering through the live connection.

Prior runs intermittently missed the timed ping portrait, boss intro or carry. One run observed different objective props at the second stage load. A separate diagnostic saw the carry synchronized on both machines, and the final uninstrumented scenario passed all assertions with its default simulated latency, jitter and loss. The dedicated height regression exercises actual snapshot construction and application, empty floor deltas, both bridge orientations, ramp routing, one-way travel, a host-authoritative pad landing, damage, collectible floor selection and the existing sniper windup. It checks 100 synthetic placement seeds and 12 generated stages. Additional tests cover a diagonal exit around a bridge abutment, actual sniper ascent and pursuit after leaving a perch, and same-level rail penetration.

## Scope and limitations

The floor rule covers grounded travel, direct projectiles, rail/laser damage and ordinary contact. Existing area effects retain their XZ footprint. The old hit sparks, muzzle flourishes and some beam visuals still use their original effect heights. Bridge bullet visuals use quarter-metre cells for overlap; coincident upper and lower shots in one cell can share a rendered height. Authoritative damage uses each bullet’s stored floor. Rewinds and deliberate long teleports select the destination’s default floor. Ordinary network snapshots reconstruct actor floors. The separate host-migration format rebuilds enemies by type and XZ, so an enemy standing on an ambiguous grate can return below it after a host handoff.

## Hardware performance

Apple M5 Pro, headless Chromium 159.0.8154.6 on ANGLE Metal. The stock benchmark used two seconds of warm-up and five seconds per scene, 60 workload rows, the two additional WebGL/WebGPU light workloads, and four cold loads. In the full matrix, the 1080p HIGH heavy scene ran at 60.0 fps with 282 enemies and 506 bullets at the median. Its p95 frame interval was 16.8 ms. HIGH double at the same resolution ran at 60.0 fps with 326 enemies and 1,008 bullets at the median.

The table compares the original build with the delivered one. Each row used a fresh browser context on the same GPU. The driver alternated the order of the two revisions, repeated each failed workload once, and measured a native HIGH heavy control at each resolution. Each value shows original → delivered.

| Scene, quality and CPU rate | FPS | Frame interval p95 (ms) | Simulation p95 (ms) | Main CPU p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1280x720 HIGH ×1 heavy | 60.0 → 60.0 | 16.8 → 16.8 | 2.0 → 2.3 | 4.9 → 5.3 |
| 1280x720 LOW ×4 heavy | 33.7 → 35.1 | 50.0 → 49.9 | 16.9 → 16.8 | 30.6 → 27.9 |
| 1280x720 LOW ×4 double | 32.8 → 30.9 | 50.0 → 50.0 | 19.8 → 22.7 | 31.0 → 34.2 |
| 1280x720 LOW ×4 team | 24.2 → 24.8 | 66.6 → 66.6 | 24.6 → 25.1 | 38.8 → 40.4 |
| 1280x720 LOW ×4 night | 32.7 → 30.2 | 50.0 → 50.0 | 14.1 → 19.9 | 26.5 → 32.6 |
| 1920x1080 HIGH ×1 heavy | 60.0 → 60.0 | 16.7 → 16.7 | 2.7 → 2.4 | 5.8 → 5.5 |
| 1920x1080 LOW ×4 heavy | 33.7 → 33.7 | 50.0 → 33.4 | 16.3 → 17.3 | 28.3 → 29.1 |
| 1920x1080 LOW ×4 double | 34.7 → 35.7 | 49.9 → 49.9 | 18.0 → 17.2 | 30.8 → 28.2 |
| 1920x1080 LOW ×4 team | 29.2 → 25.3 | 50.1 → 66.6 | 17.3 → 23.8 | 31.3 → 37.6 |
| 1920x1080 LOW ×4 night | 32.4 → 31.1 | 50.0 → 50.0 | 15.6 → 16.4 | 29.1 → 29.7 |
| 1920x1080 HIGH ×1 lights (webgpu) | 60.0 → 60.0 | 16.7 → 16.7 | 1.6 → 2.0 | 5.5 → 6.0 |

**The hardware gate remains open.** After one paired retry, 54 of 62 workloads and all four cold loads passed. Both builds missed budgets for LOW ×4 heavy, double, team and night at both resolutions. The native lighting workloads passed on WebGL at 60.0 fps and WebGPU at 59.8 fps. WebGPU submission p95 fell from 7.3 to 2.8 ms after adding route-level visibility bounds. A separate test of the earlier build measured p95 submission at 7.6–7.7 ms with the offscreen mesh submitted and 3.0–3.3 ms when it was hidden. Broadband title readiness was 1.16 s. All reported gate measurements use the complete scene and the original thresholds. A further paired run after the unit and bot workloads subsided still failed 1080p LOW ×4 team. Original and delivered both had a 50.1 ms p95 frame interval, with 21.5 and 22.3 ms simulation p95 respectively against a 12 ms budget.

## Final checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed on Node 22.23.3. |
| `npx vite build` | Passed. Vite reported its existing large-chunk advisory. |
| `npm test` | All 150 files passed. The host-migration test passed on its isolated retry and in a separate stock invocation. Under load, its 300 ms reconnect timer also expired on the unmodified revision. |
| `npm run smoke` | Passed all scenarios, including the mortal run and save history, with no runtime errors. |
| `npm run coop -- --offline` | Passed the final three-stage, two-browser run, including the forced reconnect. |
| `npm run balance` | Passed all four invincible-bot kits. |
| `npm run skillbot` | Passed the Normal clear-rate target with 17 clears in 40 runs and zero timeouts. |
| `npm run bench:real -- --check` | Failed eight LOW ×4 workload rows after paired retries. All 54 other rows and all four cold loads passed. |
| `npm run shot` and headless production previews | Passed. The dedicated Arabic shot used the production preview after the dev-server screenshot logged an HTTP 404. All 26 linked PNGs were inspected. |

Changes are uncommitted. The worktree also had a pre-existing modification to `.lane-brief.md` outside this lane’s changes.
