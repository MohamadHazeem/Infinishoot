# Deploykit — optional online server

## What players and the owner get

- `npx wrangler login`, then **`npm run server:deploy`** from the repository root. The script reuses or creates `infinishoot-leaderboard-SCORES`, generates the ignored `wrangler.toml` from a tracked template, deploys explicitly, and lets Wrangler print the server URL, and explains the health path and GitHub variable to set. Deployment keeps the terminal attached for first-use subdomain prompts. Reruns preserve data. Existing SCORES namespace IDs and explicit account IDs are retained; missing/ambiguous storage stops deployment. CLI pinned to Wrangler 4.151.2; no new runtime dependency.
- **`npm run server:dev`** runs Wrangler locally on 127.0.0.1:8787 with separate local KV/config. **`?test&server=http://127.0.0.1:8787`** selects it for every online client; `?test&server=` forces offline. Overrides never persist. Production URLs require HTTPS; HTTP is permitted only on loopback.
- **SETTINGS → HELP** shows OFF, checking, ON, or unavailable, in English and Arabic. Opening HELP performs a four-second health check; no background polling or per-frame work.
- Pages now receives the same `VITE_LEADERBOARD_URL` repository variable already wired to both desktop release jobs. The guide explains the account setup, commands, repository variable, rebuild/release steps, local links, quotas, troubleshooting and limits. No automatic Worker deployment was added.

## Audit and tuning

All six endpoints in this checkout were registered already: scores plus lobbies, teamboard, ranked, ghost and ghosts. Weekly, raid and gauntlet boards use `/scores`, not separate route modules. Kept that contract and the existing `routes.js` registry. The new suite detects unregistered route files and exercises every existing endpoint through `worker.fetch` with `tests/fakeKv.ts`.

- Streaming JSON byte caps: **4,096**, **2,000** for help ghosts, **204,096** for race-ghost uploads (share-code cap stays 200,000 characters). Non-object JSON, malformed UTF-8/JSON, oversized bodies, incorrect scalar types and non-finite/unsafe run numbers are rejected. Invalid submissions do not spend KV write quotas.
- Score stages 1–199, duration >0 and <86,400 s, generous kill ceiling 1,000 + 20,000/second, existing score-per-kill/stage envelope. Team rosters now preserve 2–8 members and reject >8, instead of silently truncating to four. Ghost scores also have a finite safe-integer and time/stage ceiling.
- Existing posting windows retained: scores/teamboard/ghosts 60 s/IP; ranked 20 s/IP; help ghosts 10/hour/IP; new lobbies 6/10 min/IP, heartbeat ≥8 s, lifetime 120 s. **Fixed ranked's invalid 20-second KV TTL:** its value is now a 20-second deadline stored for the required ≥60 seconds. Tests use a strict FakeKV subclass to enforce this platform rule.
- Additional bounded per-isolate guard: **120 requests/minute/IP**, at most **4,096** buckets; OPTIONS exempt. URL cap 2,048 characters. This protects reads/malformed submissions without extra KV writes.
- `/health` verifies the KV binding with one read, no write. Missing/broken storage returns generic JSON 503. Error and success responses retain public wildcard CORS, GET/POST/OPTIONS and Content-Type support, with no credential permission. Pages/forks and Electron's `Origin: null` work. `429`/`503` include a retry hint; JSON is no-store/nosniff.
- Help-ghost short-code collisions retry and never knowingly overwrite an existing code. Weekly ghost board metadata now expires after 60 days alongside payloads.

## Files touched / merge points

Owned: `server/leaderboard/{worker,validation,ghost,ghosts,lobbies,teamboard,ranked}.js`, `README.md`, `.gitignore`, new `wrangler.template.toml` replacing tracked `wrangler.toml`; `scripts/server-{config,deploy,dev}.mjs`; `docs/ONLINE.md`; `tests/deploykit.test.ts`; two additive `package.json` scripts; one Pages workflow env line; this note. `routes.js` and release.yml needed no changes.

Required client integration outside the server files: new `src/net/onlineServer.ts` and `src/ui/onlineStatus.ts`; one import plus one base-URL substitution in each of `src/net/{leaderboard,lobbies,teamboard,rankedBoard,ghostNet,ghostShare}.ts`; six lines of Help-screen integration in `src/platform/help.ts`; four localized keys each in `src/i18n/en.ts` and `ar.ts`. No Game, gameplay, snapshot, effects, save, global stylesheet or settings schema changes. No benchmark needed: no per-frame work was added.

## Test links and visual QA

- `?test&screen=desktopHelp&server=http://127.0.0.1:8787` with `npm run server:dev`: ON.
- `?test&screen=desktopHelp&server=&lang=ar`: Arabic OFF.
- `?test&screen=desktopHelp&server=http://127.0.0.1:8788&god`: unavailable with that port stopped.
- `?test&server=http://127.0.0.1:8787&browse` and `&screen=teamboard`: real local directory/board.

Captured and **looked at** `shots/deploykit-online.png`, `shots/deploykit-off-ar.png`, `shots/deploykit-unavailable.png`. The status fits the existing Help layout and Arabic RTL. The initial 4-second English screenshot caught the boot overlay; retaken at 10 seconds with native Metal (a temporary SHOT_CHROME wrapper). Arabic passed at 4 seconds. The deliberate unavailable-port screenshot shows the correct fallback; its shot command reports the expected connection-refused console messages. No screenshot assets are committed.

## Validation

- `npm run typecheck`: passed.
- `npx vite build`: passed, existing large-chunk advisory only.
- Wrangler 4.151.2 `deploy --dry-run` against the generated local config: passed, ~20.5 KiB uploaded bundle / ~5.4 KiB gzip; no remote deployment.
- `tests/deploykit.test.ts`: 179 checks passed (route registration, CORS including desktop, valid/invalid/oversized requests, quotas, real KV minimum TTL, plausibility, storage errors, collision/expiry, all client URLs, health, mocked first deploy/rerun/recovery/account preservation, workflows).
- Actual `npm run server:dev`/workerd: all six endpoints passed OPTIONS, valid POST and GET; `/health` passed; game displayed ON through the real local service. No login or Cloudflare resource creation was performed.
- `COOP_ANGLE=metal npm run coop`: **passed** the full default two-browser scenario over PeerJS, including reconnect and lobby follow-up; 1,899 snapshots, average 1,785 B, max 12,794 B, none over 16 KB. Gameplay/netcode was unchanged.
- `npm run smoke`: **passed**, all modes/heroes, training, Versus, local co-op, race/challenge and mortal game-over/history checks; no runtime errors.
- `npm test`: completed all 113 files with **five pre-existing failing files**. The other 108 files passed, including this lane's suite and existing MP/Worker clients. Reproduced every failing file from a clean source export of **base commit `7d324a5`**, using the same installed dependencies:
  - `eightp.test.ts`: null client in `tests/eightpHarness.ts` (`lastHeard` assignment during `makeTeam`).
  - `followups.test.ts`: expected 2 but received 4.
  - `i18n.test.ts`: the existing Aegis Shield description lacks a matching Arabic translation ("RIGHT CLICK: deploy a shield toward your aim…"). New deploykit catalog keys have English/Arabic parity.
  - `raceCoop.test.ts`: stale four-player-cap expectations (other game types back to 4; five-player co-op refused).
  - `spectateCoop.test.ts`: stale full-lobby/fifth-player assumptions, followed by spectator reconnect/drop-in/roster assertions.
  These are outside lane ownership and were not changed or skipped. The overall all-green unit gate therefore remains blocked for integration. Logs were kept under `/tmp/deploykit-*.log` during this run.

## Unfinished / risks

The actual cloud deployment is intentionally left to the owner after login; neither a remote Worker nor the GitHub variable was changed. Real account creation/auth/deployment is not exercised by mocks or a dry run. The first npx run downloads the pinned CLI. The namespace-create command in this Wrangler version no longer prefixes the worker name: the script explicitly passes the whole namespace title (verified against installed CLI source).

The API remains public and self-reported. KV cooldowns/lobby ownership checks and read-modify-write boards are eventually consistent, not atomic; concurrent submissions can race. The in-memory burst guard is per isolate, not a global quota. Free KV allows 1,000 writes and 1,000 list calls/day; a public lobby consumes ~80 heartbeat writes/hour and an open browser ~240 list calls/hour. The guide covers these limits; this is suitable for light traffic, not hardened ranked competition. New route modules merged from other lanes must be registered and added to the integration fixtures before deployment.

## Decision log for PLAN.md (kept here to avoid shared-file churn)

2026-10-20: Deploykit makes the optional online service explicit one-command setup with idempotent KV reuse, generated ignored Wrangler config and no automated cloud deployment. All six clients share a validated build URL plus a non-persistent test override. HELP probes a read-only health endpoint on opening (4 s timeout) with English/Arabic states. Pages gains the existing desktop build variable. Audited all six routes, bounded streamed bodies, checked scalar/run plausibility, added a 120/minute isolate guard, fixed ranked's KV minimum-TTL bug while preserving its 20 s posting window, retained wildcard public CORS for Pages and Electron, and documented free-tier/eventual-consistency limits.
