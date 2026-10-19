# Lane: crashfuzz (stability)

A crash fuzzer and a soak test, then every crash, leak and stall they found fixed at its root, each with a regression test in tests/stability.test.ts.

## Tools
- **`npm run fuzz -- --runs 300`** (scripts/fuzz.mjs): headless Chromium plays random test links, 6-10 s each with the autoplay bot (`botAuto`). It collects page errors, unhandled rejections, console errors and WebGL `GL_INVALID` warnings with the link that caused them, groups them by stack (message without numbers plus the top 3 game frames) and writes shots/fuzz/browser.json. It exits 1 on any error. Each run gets a fresh browser context (clean localStorage), so the link alone reproduces it.
  - The links come from `fuzzLink(seed)` (src/dev/fuzzLinks.ts). They draw from the game's own data tables, so new content gets fuzzed automatically: stage 1-12, every biome key (remixes too), mode, hero, difficulty, loadout, weapons/fusions at random levels, passives, Mods, relics, elites with mods, stage events, world events (+ `wevnow`/`wevt`), mech/crates/supers, mutations, overload, cash-ins, finale, comeback, bosses (`bossnow`, phases, Titan + phases/moves, remix, duel, mini-boss, killboss), night/day/rain/dry/tod/fog/puddles/scars, photo mode with filters/frames/stickers, route map/nodes/encounters/secret route, mini-games, rhythm, Pacifist, ghost race, Versus (both sides), local co-op (run and join screen), fake lobbies/browser/team board, mate/pets/team moves/emotes/revive pool, time-lane moments, cinematics, graphics/sound lane options, HUD settings, onboarding, shop/level-up and more. That is 2-8 features per link on a random base, god mode 80% of the time.
  - `&monkey=<seed>` (half the links) adds random input on top of the bot every 0.4 s: key presses (Esc, P, Enter, digits, B, X, G, Q, V, arrows...), clicks on visible buttons (not file import/export or links), pause/resume, tab hide/show, resize and mouse wheel.
  - Browser mode serves a development-mode bundle (`vite build --mode development`: the dev bot is in) instead of the dev server. A fresh context loading ~1000 dev-server modules took about a minute per page; the bundle takes about a second. On a Mac it uses the GPU through ANGLE Metal (`--use-angle=metal`), because SwiftShader needed ~15 s per boot. `FUZZ_GL=swiftshader` forces software rendering. Every host except 127.0.0.1 fails to resolve (`--host-resolver-rules`), so nothing reaches the PeerJS broker, leaderboard or the web.
- **`npm run fuzz -- --jsdom --runs 1000`**: the same links in jsdom (scripts/fuzz/jsdomRun.ts, one process per link, ~1-3 s each, 8-16 in parallel). Test-link timers run on the simulation clock (`simTimers` in tests/jsdomEnv.ts), so `ultgo=2` fires 2 game seconds in. Math.random is seeded from the link's seed. PeerJS can't be constructed in the Node bundle, so that one error is ignored there (online play needs the browser).
- `--link "<link>"` replays one link in either mode; `--seed`, `--par`, `--secs`, `--out` are also options.
- **`npm run soak -- --minutes 30`** (scripts/soak.mjs): one god bot run in headless Chromium. Each 30 s sample fast-forwards 90 game seconds with `botRun`, then lets the real loop render with `botAuto`. After a forced GC it records:
  - JS heap (CDP `Runtime.getHeapUsage`), DOM nodes and event listeners (`Memory.getDOMCounters`), live intervals/timeouts
  - scene objects, GPU geometries/textures/programs
  - enemies/bullets, and the size of every array/Map/Set on `game` and its systems (two levels down)
  - rAF frame time and sim ms per step

  It flags steady growth (last third vs first third of the samples, linear fit r² > 0.6, above per-metric floors), slowdowns (x1.5) and stalls: the run sitting in a between-fights mode for 4+ samples, with a position/portal/screen dump. Pools that keep their high-water mark (enemy list, corpses, spatial-hash cells) don't count. `--churn` quits to the title and starts a fresh run every sample, to catch per-run teardown leaks. Shared helpers: scripts/fuzz/browser.mjs.

## Bugs found and fixed
| # | Found by | Link / situation | Cause | Fix | Test |
|---|---|---|---|---|---|
| 1 | jsdom fuzz, x10 | `?test&god&biome=magma&lobby=pvp&crate=flamer&levelup&shatter=1&reveal=comet_swarm&mate=bit&teamgo=3&mateemote=help&smash=1&bossnow&remix` | `mateemote` set an interval calling `coopEmote(game.heroes[1])`. Once the dummy teammate was gone (Versus, local co-op, a lobby or the title replace the heroes), it threw `Cannot read properties of undefined (reading 'left')` every 2.5 s. | src/dev/coop2Links.ts: check `game.heroes[1]` on every tick. | stability: "dummy's emote and down timers survive it leaving" |
| 2 | jsdom fuzz | `?test&god&stage=10&biome=sky&hero=rookie&difficulty=normal&seed=27328&mate=&teamfull&downmate=4&teamult=2&mateemote=sorry&versus=&vstime=83&pad=xbox` | `downmate`'s timeout read `game.heroes[1]` after Versus had removed the dummy (`Cannot set properties of undefined (setting 'revivesLeft')`). | src/dev/companionLinks.ts: skip when the dummy is gone. | same test (it fails without the fix) |
| 3 | soak (stall) + stall hunt | God bot, standard run: stuck in `portal` mode for good. Seen at stage 21 in the first soak, then stage 25 (seed 4) and stage 8 (seed 10) in a 16-seed hunt | After a flawless stage (every god-mode stage is flawless) the autopilot heads for the golden portal. That portal is placed clear of the normal portal, not of wherever the hero had kited to, and the autopilot walked in a straight line. The diagnostic dump showed the hero pressed against a 5 m wall with the portal 4 m behind it. This also affects the title attract mode, disconnected co-op players on autopilot and help ghosts, which share `Autopilot`. | src/game/autopilot.ts `steer()`: straight when the line is clear, else the clear 2.5 m step closest to the target's bearing, turning to one side and sticking to it until the way is clear. Used for the portal walk. After the fix, 18 seeds x 19-29 stages had no stall. | stability: "the bot walks round the wall into the portal" (it fails without the fix: 20 s pushing into the wall) |
| 4 | churn soak (+1 listener per run) and a listener tracker (add/removeEventListener diff over 4 runs) | Every shop opening that closes at once, e.g. the starting shop skipped straight away | `replay()` in src/ui/screens.ts restarts the shop title's `slam-in` animation with a once-listener for `animationend`. Hiding the screen mid-animation cancels the animation, so `animationend` never fires, and a new listener piled up on the `<h1>` with each opening. | Keep at most one waiting listener per element and class (a WeakMap of pending classes). Listener count over 45 restarts: 7191 -> 7231 before, 7185 -> 7186 after. | stability: "six quick shop visits add at most one waiting animationend listener" |
| 5 | soak harness + stall hunt | God bot "died" (stage 6 in the first soak attempt, stage ~20 for seed 25) | `botRun(s, true)` set `cheats.god = false` on return, so the live loop between fast-forwards played mortal while the bot wasn't driving. The stack showed `hurtHero` from `GameLoop.frame` with `god: false`. This is a dev-tool bug, not a game one. | src/dev/bot.ts: `botRun` restores the god mode it found (the smoke test's mortal run still runs mortal). | covered by the soak and smoke runs |
| 6 | jsdom fuzz | `?test&god&stage=4&photo=1.1&...&recap&card` | jsdom env: no `Image` global for the BUILD CARD's `loadImage` (a test-harness gap, not a game bug). | tests/jsdomEnv.ts exposes `Image`/`HTMLImageElement`. | - |

Not bugs (triaged):
- jsdom `import_bundler.default is not a constructor` at `new NetHost`: the monkey clicked HOST on the online screen, and PeerJS can't be constructed in the rolldown Node bundle. Ignored in jsdom mode only.
- 2 browser harness timeouts in one run: a soak started at the same time and rebuilt the shared bundle folder mid-load. Fuzz and soak now build into separate folders, and both links replay clean.

## Fuzz totals (final code: 0 errors)
- jsdom: 300 x 8 s (found bugs 1, 2, 6), 1000 x 8 s, 2000 x 20 s, 600 x 20 s with the monkey, final 1000 x 15 s: **0 errors**.
- Browser: 300 (seed 2000), 300 with the monkey (seed 3000), 400 (seed 40000), final 300 (seed 50000) after all fixes: **0 errors**.

## Soak numbers (30 min, god bot, Rookie, standard; first sample after warm-up -> last)
| | stages | heap MB | DOM nodes | listeners | geometries | textures | frame ms | sim ms/step | flags |
|---|---|---|---|---|---|---|---|---|---|
| before | 1 -> 21, stuck in the portal from 25:33 | 21.6 -> 28.2 | 14041 -> 14846 | 7203 -> 7232 | 158 -> 307 | 43 -> 54 | 17.2 -> 16.8 | 0.14 -> 0.02 (stalled) | stall at stage 21 (the stall check was added after this run), pool high-water marks (enemy list) |
| after (autopilot fix) | 1 -> 25 | 22.1 -> 28.6 | 14091 -> 14849 | 7204 -> 7236 | 162 -> 287 | 45 -> 52 | 17.5 -> 18.1 | 0.19 -> 0.35 | none |
| final (all fixes; machine shared with a fuzz run) | 1 -> 17 | 22.2 -> 28.5 | 13986 -> 14771 | 7201 -> 7213 | 194 -> 298 | 43 -> 45 | 17.2 -> 17.2 | 0.13 -> 0.12 | none |
| churn before (45 fresh runs, 15 min) | 1 each | 18.7 -> 20.4 | 13611 -> 13563 | **7191 -> 7231** | 126 -> 169 | 39 -> 40 | 16.8 | 0.03 | (+1 listener per run) |
| churn after | 1 each | 18.6 -> 20.7 | 13620 -> 13589 | 7185 -> 7186 | 157 -> 175 | 39 -> 41 | 16.8 | 0.03 | spatial-hash cells (bounded, now exempt) |

Memory is flat after the first loop. Heap goes 27.2 MB at stage 9 -> 28.2 at stage 13 -> 28.6 at stage 17-25 (second-half slope 0.03-0.05 MB per 30 s sample). Geometries and textures plateau at ~285-300 / ~45-55 once loop 2's biomes have been built, and listeners and timers are flat.

The early growth is warm-up, plus content that grows with the run and is bounded. A DOM diff between stage 4 and stage 14 (+175 elements) found only owned-relic chips on the relic and shop screens (24 relics at most), elite/boss bars and HUD pips. The `route.path` and onboarding stage records grow by one entry per stage. Frame time stays at vsync (16.7-18 ms with the GPU shared). Sim cost follows the horde size (0.1-0.4 ms per step), not elapsed time.

## Unresolved / notes
- No crash is open. The fuzzer can't reach online play (host/join/PvP over PeerJS): it runs offline by design, and `npm run coop` covers those paths.
- The soak drives one hero. It doesn't exercise co-op snapshots, local co-op with pads, or very long sessions of a single biome (Endless mode).
- Browser runs are short (6-10 s), so deep-run bugs rely on the soak and the 20 s jsdom runs.
- `--churn` heap rises ~1.6 MB over 45 restarts, flattening after ~20. It looked like caches (spatial-hash buckets per touched cell, icon/sound caches), not a growing structure. Worth a heap-snapshot diff if it ever shows up in long sessions.
