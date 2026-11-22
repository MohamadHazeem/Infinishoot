# Gate 1 · Steam desktop · 2026-11-20

The owner can build both Steam depots on a Mac with Node 22 and Xcode Command Line Tools. After assigning the Steamworks app and depot IDs, `npm run steam:ship` builds and uploads them together and can set a named beta live. Owner setup, import instructions, Cloud paths and the release checklist are in [docs/STEAM.md](../../docs/STEAM.md).

## What players get

- New achievements, existing profile achievements, lifetime grants and imported saves sync to Steam. All 125 game IDs have permanent API names. The exporter produced 125 definition rows, 250 English/Arabic localization rows and 500 PNGs using the game's actual pixel icon renderer (earned/locked × 64/256 px). The separate initial 100-row import accommodates Valve's new-app limit. The full definition set remains available for later publication.
- Friends see the current stage, biome and local hero. The host advertises its five-character PeerJS invite code after its room is ready and while a seat is available. Steam launch parameters and warm join callbacks both call the existing game join path. Status is checked once per second and only changes cross IPC. Players can use Shift+Tab and release held inputs through the game's blur handler.
- Auto-Cloud restores nine existing progression stores before the game loads. One atomic `profile.json` per 32-bit Steam account ID travels between Windows/Proton and macOS. The first signed-in launch adopts existing local progression if there is no Cloud file. In offline launches the depot continues with the last local account. Changed records flush every five seconds and on page exit. A damaged Cloud file stays available for recovery.
- The Deck environment flag or a 1280×800 screen starts the interface with Xbox prompts. Keyboard, mouse, touch and controller input resume normal detection. The usual menus and navigation remain in use.
- Steam builds omit the GitHub release check and rely on Steam updates. The Windows x64 folder is about 387 MiB and the universal Mac folder about 524 MiB. The Mac bundle uses the existing app icon and a verified ad-hoc signature by default. The owner can select a Developer ID identity.

## Implementation decisions and files

- `electron/main.cjs`, `electron/preload.cjs`, `electron/steam-flag.cjs`, `electron/steam.cjs`, `electron/steam-achievements.json` implement startup gating, narrow IPC, account-aware restore, atomic writes and callback handling.
- `src/platform/steam.ts` is the renderer bridge. Shared edits are additive. `src/game/game.ts` adds one import and one constructor call. `src/game/save.ts` adds one import and four award/sync calls. `src/i18n/arabic2.ts` and `src/i18n/ar.ts` each add two presence keys. The existing English fallback supplies the five other languages.
- `package.json` pins the official optional N-API package `steamworks.js` 0.4.0 (the lead replaced an unofficial fork, `@ducky7go/steamworks.js@0.1.5`, published 9 days earlier by an unknown maintainer, because it ships native code in the game). 0.4.0 lacks the warm rich-presence join and overlay-activated callbacks, so `electron/steam.cjs` registers only the callbacks the binding exposes: a friend's Join works through the launch command line (cold start) and the invite code, not into a running game. Normal desktop packages exclude the runtime adapter, achievement mapping and native library. Web bundles contain the renderer bridge.
- `scripts/steam/config.json` owns the Spacewar ID. `dist.mjs` stages a clean Electron app, `entitlements.plist` is for the Mac Steam overlay, and `upload.mjs` resolves `app_build_template.vdf`, `depot_build_windows.vdf` and `depot_build_macos.vdf`. A receipt is written after both depots and the Mac signature verify. A named beta is optional, and the owner promotes the default branch in Steamworks.
- `scripts/steam/achievements.mjs`, `catalog.ts` and the adjacent artwork-only `package.json` / lockfile export the game's data, translations and sprites into ignored `release/steamworks/`. Regenerate with `npm run steam:achievements`. The two `presence-*.vdf` files supply Steam display tokens.
- `marketing/steam/store.md` contains English and Arabic store copy, feature bullets, draft hardware requirements, tags and icon credits. `marketing/steam/captures.md` specifies capsule crops, gameplay shots and a 90-second trailer. `tests/steam.test.ts` covers mapping stability, flag gating, unavailable Steam, award retries, localized presence, launch/warm joins, cloud storage, preload migration/flush and upload refusal.

## Visual and integration QA

Ten inspected PNGs are in ignored `shots/steam-*.png`. Run these local test links with `&seed=42` and each of `&lang=en` and `&lang=ar`. The Deck shots exercised actual resolution detection.

| Size | Links | Observed |
| --- | --- | --- |
| 1280×800 | `?test&mptitle`, `?test&shop&gold=60`, `?test&lobby=coop` | Title actions, shop cards and lobby start row visible. Both languages used gamepad prompts. Keyboard input switched them back. |
| 1280×720 | `?test&screen=settings&pad=xbox` | Video settings scroll cue and pinned action row visible in both languages. |
| 1920×1080 | `?test&levelup&pad=xbox` | All three cards, choice buttons and prompts visible in both languages. |

The shell's Chromium headless launcher was denied macOS Mach bootstrap registration. The supplied connected Playwright browser captured the ten shots against this worktree's Vite server. The offline co-op scenario body ran there with its normal local signaling and real WebRTC. It completed in 98.8 seconds with zero failed assertions, 1,923 snapshots, 1,733 bytes on average and no payload over 16 KiB. A second two-player run with a mock Steam renderer bridge used the advertised code and join callback, showed the guest's stage and hero, forwarded one old and one new award, and cleared the host's connect field on exit.

## Owner validation

Use an assigned app and two Steam accounts to check real Steam achievement notifications, overlay focus, launch/warm invitations, and cross-OS Auto-Cloud conflicts. Check Proton controls, suspend/resume and text size on physical Deck hardware. The store hardware figures are proposals for the hardware pass. The Windows binary is unsigned and the local Mac build is ad-hoc signed. Real SteamPipe upload and branch promotion belong to the owner. All lane changes are uncommitted.

## Final checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. |
| `npm test` | All 123 test files passed on the full retry. On the first run the sound-reactive swarmer movement assertion fell below its threshold. It passed both its isolated retry and the full retry with the same code. |
| `npm run smoke` | Passed, including the local co-op run and the runtime-error check. |
| `npm run coop -- --offline` | Direct launcher failed at Chromium's macOS Mach registration. The connected browser passed all offline scenarios, as recorded above. |
| `npm run shot` | Direct launcher hit the same restriction. The connected browser captured all ten inspected PNGs. |
| `npm run steam:achievements` | Passed. Checked CSV counts, Arabic text and both PNG dimensions. |
| `npm run dist:steam` | Passed. Verified the Windows x64 and universal macOS unpacked depots, both Mac architectures, signature and native module loading. The packaged Mac binding handled Steam being unavailable. Also inspected an ordinary Mac package for SDK exclusion. |
| `npm run steam:upload -- --prepare` | Passed with sample production-format identifiers. Both depot paths resolved. Missing credentials and the Spacewar ID were refused. No SteamCMD execution or upload took place. |
