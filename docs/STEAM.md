# Shipping InfiniShoot on Steam

Once the app, depots and build account are configured, run **`npm run steam:ship`** from the repository on macOS. It builds Windows x64 and universal macOS, then uploads both depots as one SteamPipe build. Set `STEAM_BRANCH=playtest` to make the build available to testers in the same command. Steam manages updates for these builds.

## Build and play locally

Use Node 22, npm, macOS and Xcode Command Line Tools. From the repository root run `npm ci --include=optional`, then `npm run dist:steam`. The unpacked games are:

| Depot | Local output | Steam launch executable |
| --- | --- | --- |
| Windows x64, including Deck through Proton | `release/steam/win-unpacked/` | `InfiniShoot.exe` |
| macOS Intel and Apple Silicon | `release/steam/mac-universal/` | `InfiniShoot.app` |

The Mac build uses an ad-hoc signature by default. For a Developer ID build, set `STEAM_MAC_IDENTITY` to your installed distribution identity. The Steam entitlements cover the overlay, JIT and voice chat. Verify the signed bundle on a clean Mac before public release. For Windows, the product executable is unsigned. The ordinary desktop release workflow is described in [RELEASING.md](RELEASING.md).

For local API testing, start the Steam client and run the following from the repository:

```sh
STEAM_APP_ID="$(node -p "require('./scripts/steam/config.json').testAppId")" npm run app
```

The test ID in that config belongs to Valve's Spacewar. It can exercise client initialization and the overlay. InfiniShoot achievement definitions and presence tokens need the owner's app. For either the development wrapper or an unpacked Steam depot, you can also put the numeric ID in `steam_appid.txt` beside the executable (inside `Contents/MacOS/` on Mac). Keep local test files outside the shipping depots. When Steam launches an installed depot it provides `SteamAppId`, which that depot promotes to `STEAM_APP_ID`. Running without the client still allows local play.

The main process loads the optional N-API binding `steamworks.js` 0.4.0, the official package ([source](https://github.com/ceifa/steamworks.js)), chosen over a newer unofficial fork because it ships native code inside the game. It registers only the callbacks the binding exposes: 0.4.0 has no warm rich-presence join or overlay-activated callback, so "Join game" from the Steam friends list works when Steam launches InfiniShoot (the launch command line carries the invite code), but not into an already running game; players can always use the invite code. The renderer receives only achievement, status and join operations.

## Configure the owner app once

1. Complete partner onboarding, including identity, bank and tax information. Pay the Steam Direct fee of USD 100 or the regional equivalent, activate the app credit, create InfiniShoot and record its App ID. Allow time for Valve's first-release waiting period, Coming Soon page and store/build review. [Steam Direct](https://partner.steamgames.com/doc/gettingstarted/appfee) · [Release process](https://partner.steamgames.com/doc/store/releasing)
2. In **SteamPipe → Depots**, create a Windows depot restricted to Windows and a macOS depot restricted to macOS. Record both assigned depot IDs. Add both to the developer package and the customer package. In **Installation → General Installation**, set the install folder to InfiniShoot and create the two OS-specific launch options from the table above. Select the app bundle on Mac so Steam launches the appropriate architecture. Publish the configuration. [Depots and launch options](https://partner.steamgames.com/doc/sdk/uploading)
3. In **Stats & Achievements**, enable English and Arabic. Set `STEAM_APP_ID` to the assigned ID, then run `npm run steam:achievements`. The exporter uses the current achievement catalog, game translations and pixel icon renderer. Under **Bulk Import/Export**, select the definitions CSV, localization CSV and PNGs from `release/steamworks/icons-256/` together. Each icon pair uses the permanent API name with `_ACHIEVED` and `_UNACHIEVED` suffixes. The 64 px alternatives are in `icons-64/`. Review the pending rows, save, then publish. Keep the existing API names when updating descriptions. [Valve's CSV and icon formats](https://partner.steamgames.com/doc/features/achievements/ach_guide)
4. The catalog has **125** achievements. Valve normally limits a new app to **100** initially. Use the CSV pair in `release/steamworks/launch-100/` for that import. It includes every classic unlock and co-op award. The importer matches icons to definitions in the selected CSV. When the app qualifies for additional achievements, import the full CSV pair from the parent folder. The game syncs existing earned achievements at startup, including awards earned before their Steam definitions were published. [Initial achievement limit](https://partner.steamgames.com/doc/features/achievements)
5. Under **Community → Rich Presence**, upload `scripts/steam/presence-english.vdf` and `presence-arabic.vdf` for their respective languages and publish. Enable **Use launch command line** on **Installation → General** for Steam-delivered invites. The game supplies the localized stage, biome and hero through the status field. A host with a joinable slot publishes a connect string such as `?join=ABCDE`. The Steam join callback and launch parameters feed the same PeerJS join path as web invite links. [Rich presence](https://partner.steamgames.com/doc/features/enhancedrichpresence) · [Friends and invites](https://partner.steamgames.com/doc/api/ISteamFriends) · [Launch parameters](https://partner.steamgames.com/doc/api/ISteamApps#GetLaunchCommandLine)
6. Configure Auto-Cloud as below. Add a password-protected `playtest` beta branch under **SteamPipe → Betas**. Give testers access to the app and both depots. Select the branch in the Steam client for the first install. [Branches](https://partner.steamgames.com/doc/store/application/branches)
7. Set Windows and macOS support, use a standard gamepad Steam Input layout, and fill in store assets, content survey, supported languages and pricing. Submit the store page and playable build for review. The store copy, requirements and capture plans are in [the store kit](../marketing/steam/store.md) and [the capture sheet](../marketing/steam/captures.md).

## Steam Auto-Cloud

Set a per-user quota of **16 MiB and 4 files**. Add one root with a macOS override so a Windows or Proton player can continue on Mac. Publish the settings. [Auto-Cloud fields and cross-platform overrides](https://partner.steamgames.com/doc/features/cloud)

| Steamworks field | Value |
| --- | --- |
| Root | `WinAppDataRoaming` |
| Subdirectory | `InfiniShoot/SteamCloud/{Steam3AccountID}` |
| Pattern | `profile.json` |
| OS restriction | Cross-Platform |
| Recursive | Off |
| Root override | Original root `WinAppDataRoaming`, OS macOS, new root `MacAppSupport`, additional path empty, Replace Path off |

On Windows the file is `%APPDATA%\InfiniShoot\SteamCloud\<accountID>\profile.json`. On Mac it is `~/Library/Application Support/InfiniShoot/SteamCloud/<accountID>/profile.json`. The numeric folder is the 32-bit account ID. The shipped Windows version uses the Windows path inside the Proton prefix on Deck.

The file carries the game profile, lifetime achievements, highscores, daily record, Trials, raid results, Gauntlet records and cinematic reveals. The preload restores them before game systems read storage, copies changes every five seconds, and flushes on page exit. The main process replaces the file atomically. The first launch can seed from the existing local profile. The device keeps its graphics, microphone, keybinds, mods, replays and network settings locally.

## Upload and promote

Install the Steamworks SDK ContentBuilder on the Mac build machine. Bootstrap its macOS SteamCMD and log in once with a dedicated build account that has **Edit App Metadata** for this app and the branch-publishing permission if setting a beta live. Complete Steam Guard in its interactive prompt. Set the following environment in your shell or build runner. Supply identifiers assigned by Steamworks.

```sh
export STEAM_APP_ID='<game App ID>'
export STEAM_DEPOT_WINDOWS='<Windows depot ID>'
export STEAM_DEPOT_MACOS='<macOS depot ID>'
export STEAM_USERNAME='<build account name>'
export STEAM_BRANCH='playtest'
export STEAMCMD='/absolute/path/to/ContentBuilder/builder_osx/steamcmd.sh'
npm run steam:ship
```

To inspect the resolved manifests locally, run `npm run steam:upload -- --prepare`. For an already-built pair of depots, `npm run steam:upload` uploads that build. Both commands validate the IDs and username before invoking SteamCMD. The scripts write resolved VDFs under `release/steampipe/scripts/` and retain the chunk cache in `release/steampipe/cache/`. Authentication stays in SteamCMD. [ContentBuilder and build accounts](https://partner.steamgames.com/doc/sdk/uploading)

In **SteamPipe → Builds**, verify the resulting BuildID on `playtest`. With `STEAM_BRANCH` unset, the upload leaves branch assignment to the owner. On two accounts check a fresh install, an existing profile unlock, a new unlock, Shift+Tab with a movement key held, and Friends → Join Game with the guest both closed and already playing. Close the lobby or a mid-run join slot and check that the join action clears. Quit after earning a medal and verify it on the other OS using the same account. On hardware, check Deck sleep/resume, controller navigation, Arabic text and voice-chat permissions. Promote the tested BuildID to the default branch in Steamworks when the owner is ready.
