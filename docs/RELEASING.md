# Releasing InfiniShoot

## Build a release

1. Bump `version` in `package.json` (it shows on the title screen).
2. Commit, then tag and push:

   ```
   git tag v0.6.0
   git push origin v0.6.0
   ```

3. GitHub Actions (`.github/workflows/release.yml`) builds `InfiniShoot.exe` on Windows and
   `InfiniShoot-mac-arm64.dmg` / `InfiniShoot-mac-x64.dmg` on macOS, and attaches them to a
   GitHub Release named after the tag.

You can also run the workflow by hand (Actions > Release > Run workflow) to get the files as
build artifacts without publishing a release.

## Code signing (removes the security warnings)

Unsigned builds work, but Windows shows "Windows protected your PC" and macOS asks you to
right-click > Open the first time. Signing needs paid certificates; once you have them, add
these repository secrets (GitHub > Settings > Secrets and variables > Actions) and the next
tagged release is signed automatically. Nothing else needs to change.

### Windows

| Secret | What it is |
|---|---|
| `WIN_CSC_LINK` | Your code-signing certificate (`.pfx`) encoded as base64: `base64 -i cert.pfx` |
| `WIN_CSC_KEY_PASSWORD` | The certificate's password |

Any OV or EV code-signing certificate works (Sectigo, DigiCert, SSL.com...). EV certificates
clear SmartScreen immediately; OV certificates build reputation over a few hundred downloads.
Cloud HSM certificates (for example Azure Trusted Signing) need a different signing step;
ask Claude to switch the workflow over if you pick one.

### Mac (signing + notarization)

| Secret | What it is |
|---|---|
| `MAC_CSC_LINK` | "Developer ID Application" certificate exported from Keychain as `.p12`, base64 encoded |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` export password |
| `APPLE_ID` | The Apple ID of your Apple Developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com > Membership) |

This needs an Apple Developer Program membership (99 USD/year).
