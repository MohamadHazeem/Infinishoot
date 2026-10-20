# Turn on InfiniShoot's online features

The optional Cloudflare Worker provides global/daily/weekly/raid/gauntlet scores, public lobby discovery, weekly team scores, shared help ghosts, ghost races and the ranked ladder. Invite-code co-op uses PeerJS/WebRTC and works without this Worker. This is not a gameplay server or TURN relay.

## First deployment

1. Create a **free Cloudflare account** at <https://dash.cloudflare.com/sign-up>. In **Workers & Pages**, complete the first-use setup and choose your `workers.dev` subdomain if prompted. No domain purchase is needed. Keep the Workers Free plan unless you intentionally want to upgrade.
2. Install **Node.js 22**. In this repository's root, run `npm install` once if dependencies are not installed.
3. Log in through the browser:

   ```sh
   npx wrangler login
   ```

4. Deploy explicitly:

   ```sh
   npm run server:deploy
   ```

   The script downloads a pinned Wrangler 4 CLI with `npx` (development tooling only), lists KV namespaces, reuses `infinishoot-leaderboard-SCORES` or creates it once, writes `server/leaderboard/wrangler.toml` from `wrangler.template.toml`, and deploys `infinishoot-leaderboard`. Wrangler can ask you to choose a `workers.dev` subdomain on first use; the terminal stays interactive. It prints a URL such as:

   ```text
   https://infinishoot-leaderboard.YOUR-SUBDOMAIN.workers.dev
   ```

5. Append `/health` to the printed URL and open it. Expect `{"ok":true,"service":"infinishoot-online","version":1}`. This checks that KV can be read, without writing a record. A `503` means the binding/storage is unavailable (including an exhausted read quota).

**Nothing deploys on install, build, push or release.** Rerun `npm run server:deploy` to publish later Worker changes; the existing namespace and scores are retained. The script never deletes a namespace or its keys. If namespace creation succeeds but deployment fails, rerunning recovers the namespace by name.

If you belong to multiple Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` in your shell before running the command (Wrangler also remembers previous account selections). If an existing configured namespace is missing in that account, deployment stops rather than silently switching data stores. For an older manual deployment, preserve its valid namespace ID in `server/leaderboard/wrangler.toml`; the script validates and reuses it, even if its namespace has another name. A valid existing `account_id` is preserved. For this first-use setup, Worker configuration belongs in the template; the generated file is replaced on each deploy. This command always targets the Worker named `infinishoot-leaderboard` in the selected account.

The generated config and local KV state are ignored by Git. Wrangler stores login credentials outside the repository. No Cloudflare token, password or `.env` file belongs in a commit. This workflow needs no Cloudflare credential in GitHub Actions.

## Enable the website and downloads

In the **GitHub repository**:

1. Open **Settings → Secrets and variables → Actions → Variables → New repository variable**.
2. Name: **`VITE_LEADERBOARD_URL`**.
3. Value: the printed **HTTPS server URL**, without `/health`, `/scores`, quotes, or a query string. This URL is public configuration, not a secret.
4. Rebuild the clients. Vite embeds the URL **at build time**; changing the variable cannot update an already downloaded app or an already built site.

Where the variable is read:

| Client | Workflow | Build environment |
| --- | --- | --- |
| GitHub Pages | `.github/workflows/pages.yml` | `npm run build` step's `env.VITE_LEADERBOARD_URL` |
| Windows portable EXE | `.github/workflows/release.yml` | `windows` job's `env.VITE_LEADERBOARD_URL`, inherited by `npm run dist` |
| macOS DMGs | `.github/workflows/release.yml` | `mac` job's `env.VITE_LEADERBOARD_URL`, inherited by signed and unsigned builds |

For Pages, run **Actions → Deploy to GitHub Pages → Run workflow** on the integrated branch, or let the next push to `main` rebuild it. The existing workflow skips private repositories. For downloads, publish the next `v*` release tag following [RELEASING.md](RELEASING.md). A manual **Release** run produces build artifacts but the workflow only publishes a GitHub Release on a tag push. Users must download the new build.

For a local production build, set `VITE_LEADERBOARD_URL` in the environment before `npm run build` / `npm run dist` / `npm run dist:mac`. The URL is public and may appear in compiled JavaScript. Do not place an API key in a `VITE_*` variable.

Open **SETTINGS → HELP** in the rebuilt game:

- **OFF**: no valid server URL in this build. Invite codes still work.
- **checking…**: the health request is pending (4-second timeout).
- **ON**: this server's health check passed.
- **unavailable**: configured, but the health check failed. Reopen HELP to retry.

The status checks only on opening HELP, without background polling. ON confirms service availability, not a particular upload's quota or authenticity. Invalid URLs disable the features; production URLs must use HTTPS.

## Local Worker, no login or deployment

In one terminal at the repo root:

```sh
npm run server:dev
```

This runs `wrangler dev --local` at **http://127.0.0.1:8787**, with its own generated `wrangler.local.toml` and local KV in `server/leaderboard/.wrangler/`. It never reads or writes production KV and does not require Cloudflare login. The first run needs Internet access to download the CLI. Stop with Ctrl+C.

In another terminal:

```sh
npm run dev
```

Open these links (adjust Vite's port if necessary):

- `http://localhost:5173/?test&server=http://127.0.0.1:8787&screen=desktopHelp` — health status.
- `http://localhost:5173/?test&server=http://127.0.0.1:8787&browse` — real local lobby directory (initially empty).
- `http://localhost:5173/?test&server=http://127.0.0.1:8787&screen=teamboard` — local team board.
- `http://localhost:5173/?test&server=&screen=desktopHelp` — force OFF for this page, even in a configured build.

`server=` works **only with `?test`**, overrides the build URL for all six clients, and is never saved. HTTPS URLs and HTTP loopback (`127.0.0.1`, `localhost`, `[::1]`) are accepted; credentials, queries and fragments are rejected. Use a local Vite page for local testing; hosted HTTPS pages can impose mixed-content or local-network access restrictions. Test-link runs are QA sessions and may suppress ordinary score banking; test endpoint writes directly or finish a normal run in a locally configured build.

A local endpoint smoke check:

```sh
curl http://127.0.0.1:8787/health
curl 'http://127.0.0.1:8787/scores?board=standard-normal'
curl -X POST http://127.0.0.1:8787/scores \
  -H 'Content-Type: application/json' \
  --data '{"board":"standard-normal","name":"Local","score":1000,"stage":2,"kills":100,"time":120}'
```

Local posting limits still apply. To reset test data, stop the Worker and remove **only** the ignored `server/leaderboard/.wrangler/state` directory. Keep `wrangler.toml` if you have deployed.

## Routes and safeguards

All feature modules are explicitly registered in `server/leaderboard/routes.js`; `/scores` and `/health` live in `worker.js`. New lanes must register their module and extend `tests/deploykit.test.ts` before integration.

| Endpoint | Validation / limits | Storage |
| --- | --- | --- |
| `GET /health` | Read-only KV probe; no account details | No writes |
| `GET/POST /scores` | Valid mode/difficulty or daily/weekly board, finite safe scores, stages 1–199, duration under 24 h, kill/score plausibility; 1 post/minute/IP | Top 100 per board, show 20 |
| `GET/POST /lobbies` | Invite code + private host token, 1–8 players, enums/filters; 6 new lobbies/10 min/IP, 8 s minimum heartbeat interval | Expire at 120 s, show 50; tokens never listed |
| `GET/POST /teamboard` | Valid week, 2–8 members, same score plausibility; 1 post/minute/IP | Best per team, top 100, show 20 |
| `GET/POST /ranked` | Valid month/save ID, rating 100–4000, wins ≤ games, rating-change plausibility; 1 post/20 s/IP | Top 200, show 50; IDs never listed |
| `GET/POST /ghost` | Sanitized build, levels/stages 1–999; 10 uploads/hour/IP | Random 6-character code, 30 days; collisions retried |
| `GET/POST /ghosts` | Valid week, finite safe score/time/stage, share-code shape and ≤200,000 characters; 1 upload/minute/IP | Top 10; board and codes expire in 60 days |

POST streams are capped **before JSON parsing** at 4,096 bytes, except `/ghost` (2,000) and `/ghosts` (204,096). Null, arrays and malformed JSON return `400`; oversized bodies `413`. URLs over 2,048 characters return `414`. A bounded per-isolate burst guard permits 120 requests/minute/IP (including GETs and invalid submissions); OPTIONS is exempt. Invalid submissions do not consume persistent KV write quotas. Error responses retain CORS, and `429`/`503` include a retry hint.

The API deliberately allows `Access-Control-Allow-Origin: *`, `GET, POST, OPTIONS`, and the `Content-Type` header **without credentials**. This supports the GitHub Pages origin (including forks), local Vite, and Electron's opaque `Origin: null` from `file://`. There are no cookies or private reads. CORS is not authentication; lobby ownership uses a random host token, and score/rating submissions are self-reported. Do not deploy this as an authenticated or private service.

## Free tier and known limits

Cloudflare's KV Free plan currently includes **1,000 writes/day**, **100,000 reads/day**, and **1,000 list operations/day**; the Worker also has its own request quota. Public lobby heartbeats cost 80 writes/hour per host, plus creation/quota records. A browser refreshes the directory every 15 seconds while open: about 240 list operations/hour (more if pagination is needed). Score/team/ranked submissions each use a cooldown write plus a board write; accepted ghost uploads can cost three writes. These limits suit light use, not a busy public launch. Inspect usage in the dashboard and make any paid-plan decision explicitly. See [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

KV is eventually consistent and board updates are read/modify/write: simultaneous submissions can overwrite one another, and lists/heartbeats/cooldowns may lag between regions. The per-isolate guard and KV cooldowns are best-effort abuse controls, not a global atomic rate limiter. Lobby codes, team identities and ladder save IDs are not authenticated accounts. Ghost payloads are shape-checked, not simulated. For a competitive service or sustained traffic, move mutable boards/quotas to a Durable Object or transactional store. See [how KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

If deployment fails, first check login (`npx wrangler login`), account selection, and the `workers.dev` first-use setup. If health fails, check the Worker's SCORES binding, namespace existence, and quotas. If health works in a tab but the game stays OFF, rebuild with the GitHub variable. If the game says unavailable, inspect its network request to `/health` and verify the full HTTPS URL. Existing clients built without the URL stay offline until rebuilt.

CLI/config reference: [Wrangler KV commands](https://developers.cloudflare.com/kv/reference/kv-commands/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), and [KV TTL rules](https://developers.cloudflare.com/kv/api/write-key-value-pairs/). The ranked cooldown stores an expiry timestamp for 20 seconds with a **60-second KV TTL**, the platform minimum.
