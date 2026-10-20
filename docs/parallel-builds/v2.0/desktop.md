LANE: desktop — the desktop app

1. Auto-update: the Electron app checks GitHub Releases of MohamadHazeem/Infinishoot on start (electron-updater with the GitHub provider, or a simple check of the latest release tag + a "NEW VERSION AVAILABLE - DOWNLOAD" banner that opens the release page if code signing blocks silent updates on Mac/Windows); never blocks play; a setting to turn it off. Release workflow publishes what the updater needs (latest.yml etc.) without breaking the existing exe/dmg assets.
2. Window options: fullscreen/windowed/borderless, resolution scale, vsync/frame cap (30/60/120/unlimited), remember window size; Steam Deck-friendly layout at 1280x800 (check every screen), gamepad-only navigation everywhere.
3. Error log: crashes and errors are caught to a local log (last 200 entries, with version, OS, settings); SETTINGS > HELP > EXPORT ERROR LOG saves a text file to attach to bug reports (desktop: save dialog; web: download).
4. Tests for the update check logic and log ring buffer; verify `npm run dist:mac` still builds locally (unsigned).
Owns: electron/main.cjs (+ preload), package.json build config (careful), .github/workflows/release.yml (careful), new src/platform/*.ts, settings options (additive), tests/desktop.test.ts.
