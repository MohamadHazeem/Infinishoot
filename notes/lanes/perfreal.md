# Gate 1 · real GPU performance

**The M5 Pro met the browser frame and broadband startup targets.** Across 48 native CPU cases, frame p99 stayed at or below 16.8 ms and the game missed zero 60 Hz render slots. The larger horde had median populations of 312–353 enemies and 1,010–1,012 live projectiles across the native and throttled runs. All 12 LOW cases at 4× CPU throttle sustained 30 fps or better. The slowest five-second average was 58.4 fps. A further twenty-second four-hero check sustained 52.9 fps at 4× CPU and 60.0 fps at native CPU with HIGH shadows. [Full report](../perf/real-2026-11-22.md) · [Machine-readable samples](../perf/real-2026-11-22.json) · [Budget and reproduction](../perf/BUDGET.md)

## Changes players get

- Hero x-ray and outline passes reuse a packed matrix buffer. In the four-hero HIGH diagnostic, calls to `Matrix4.toArray` targeting a 48-matrix buffer fell from 64,728 to 2,520 in 180 frames. That counter includes other buffers of the same size. In three 1080p LOW runs at 4× CPU on each build, median-of-run mean GL submission went from 3.19 to 3.04 ms. Overall median fps was 56.2 before and 56.0 after.
- HIGH shadows reuse each compatible hero’s merged geometry for a single depth draw. A repeat of the four-hero 1080p fixture reached 452 draw calls at p95 before the change. Three after runs measured 320, 321 and 323. All 262,144 shadow-map pixels and 230,400 scene pixels matched the original at the same pose. Removing the hero casters in the control changed 1,605 scene pixels. Custom, off-screen or mirrored rigs can use the original casters.
- AUTO now detects sustained CPU deadline pressure even while the frame interval still reads 16.7 ms. Spending at least 14 ms since the rAF timestamp counts as a slow frame. Three consecutive half-second windows with over 20% slow frames trigger the normal descent. The existing recovery requires eight calm seconds and backs off after a failed climb. The measurement accounts for the intentional 30 fps cap. A synthetic 60 Hz deadline test exercises preemptive descent. In the live 4× four-hero test, the old governor stayed on LOW for 10 seconds (569 frames). The new governor stepped down after 1.43 seconds (574 frames).
- The benchmark checks actual viewport, active quality, shadow light state, combat, population and hardware identity. The GPU timer measures command execution asynchronously. CPU simulation, presentation, GL submission, draw calls, triangles, heap, per-phase timing, missed refresh slots and median/p95/p99 are in the JSON. The four-hero fixture uses real local rigs, weapons and teammate bots. Multiplayer protocol coverage comes from separate tests.

## Production load

| Cold entry | Broadband first frame / ready | Slow 4G first frame / ready | Initial bytes |
|---|---:|---:|---:|
| Title | 0.98 / 1.00 s | 8.29 / 8.32 s | 1,500,484 |
| First fight | 1.10 / 1.15 s | 8.64 / 8.67 s | 1,523,863 |

The title transferred 1,445,333 B of JS, 15,128 B of CSS, 39,221 B of other assets and 802 B of HTML. The production preview served gzip. No offline-worker requests began before these marks in the fresh contexts. Existing chunking met both targets, so the production asset graph stays as shipped.

## Costs and open work

- Separate five-second CDP CPU profiles from before shadow batching are included in the JSON. On the 1080p HIGH/shadows team run, clip encoding (`convertToBlob`) accounted for 351 ms of samples and the game's deferred capture phase averaged 1.14 ms per frame. At 4× CPU on LOW, style recalculation averaged 4.24 ms/frame, enemy simulation 1.32 ms/frame and barrel/arena/chest rendering 0.87 ms/frame. The lead can use those profiles if future content exhausts the budget. Clips, gameplay and HUD styling belong to other lanes.
- The six default scenes use seed 42, two seconds of warm-up and five seconds of measurement. The native matrix's closest draw budget was four heroes with shadows at 323 of 420 calls p95. The night fixture drew three fog layers and 90 instanced puddles on HIGH. CPU throttling leaves the M5 Pro GPU active. Absolute results apply to this Mac and these windows. Sustained thermal load, other physical GPUs and presentation at the display panel still need separate measurements.
- The Mac arm64 Electron 44.7.2 app packaged from this worktree. Direct launches aborted in macOS AppKit registration before creating a window or a CDP endpoint. Launch Services also failed to open the bundle. Computer Use was not approved to operate InfiniShoot. Electron cold-start and scene numbers remain unmeasured. The budget document gives the exact command for the packaged executable.
- Chromium launched by shell commands also aborted at Mach-port registration (permission denied). The full performance matrix and visuals used Playwright MCP's GPU-enabled Edge 158 against the worktree's production Vite preview. Each row verified ANGLE Metal / Apple M5 Pro. This allowed real GPU measurements while the standalone local launch and the original co-op CLI remained blocked. A two-page production probe using local PeerJS signaling exchanged offers, answers and ICE candidates, but no WebRTC data channel opened, including on retry.

## Files and visual verification

Gameplay presentation changes are confined to `src/render/quality.ts`, `src/render/renderer.ts`, `src/render/rigOverlay.ts` and `src/render/shadows.ts`. The only shared edit adds the `bench:real` script line to `package.json`. New files are `scripts/benchReal.mjs`, `benchRealScenes.mjs`, `benchRealLoad.mjs`, `benchRealDesktop.mjs`, `benchRealBudget.mjs`, `benchRealReport.mjs` (all under `scripts/`), `tests/perfreal.test.ts`, this note and the three files under `notes/perf/`.

Reviewed the four-hero fight after six seconds in fresh production contexts. The hero overlays and ground rings followed the rigs in both languages. At 720p, overlapping in-world combat labels can obscure part of the crowded fight. The Arabic HUD also shows an occasional English control hint; the HUD lane owns that text. The reviewed PNGs are ignored artifacts.

```text
?test&bench&seed=42&god&heroes=4&matebots&stage=5&night&rain&hold=180&bullets=500&quality=high&shadows&lang=en
?test&bench&seed=42&god&heroes=4&matebots&stage=5&night&rain&hold=180&bullets=500&quality=high&shadows&lang=ar
shots/perfreal/team-1280-en.png   shots/perfreal/team-1280-ar.png
shots/perfreal/team-1920-en.png   shots/perfreal/team-1920-ar.png
```

Each benchmark row includes its full game test link. The budget file documents collecting a new browser/desktop report and checking an existing report.

## Final checks

| Command or measurement | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` and `npx vite build` | PASS. Existing large-chunk warning. |
| `npm test` | PASS, 126 test files including `perfreal.test.ts` |
| `npm run smoke` | PASS, including local co-op and mortal run |
| Real Metal via Playwright MCP | PASS, 48 ordinary rows, 12 throttled rows and two 20-second four-hero runs |
| `npm run bench:real -- --check --from-report notes/perf/real-2026-11-22.json` | PASS. Replaying the actual pre-batching 452-call row instead exits 1 for the draw budget. |
| `npm run bench:real -- --check` directly from this shell | BLOCKED at Chromium launch by macOS Mach-port permissions. The connected Playwright capture used the same scene and load drivers. |
| `npm run coop -- --offline` | FAIL before either page opened, including on the final retry. Chromium Mach-port registration was denied. |
| `npm run coop8` | PASS, eight in-process peers, nine state checks, 3,714 bytes per snapshot per client on average |
| Packaged Electron | Arm64 directory package PASS. Application launch FAIL before the first window. |

The four PNGs above were inspected again on the final build. All lane changes are uncommitted.
