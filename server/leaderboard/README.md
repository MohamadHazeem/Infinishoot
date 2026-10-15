# Online leaderboard (optional)

The game works fully offline. To turn on global high scores, deploy this tiny server once
(free on Cloudflare) and build the game with its address.

## 1. Deploy the server (about 5 minutes)

You need a free Cloudflare account.

```
cd server/leaderboard
npx wrangler login
npx wrangler kv namespace create SCORES
```

Copy the `id` it prints into `wrangler.toml` (replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`), then:

```
npx wrangler deploy
```

It prints the server address, for example `https://infinishoot-leaderboard.<you>.workers.dev`.

## 2. Point the game at it

Create a file named `.env.production` in the repository root (it is not committed):

```
VITE_LEADERBOARD_URL=https://infinishoot-leaderboard.<you>.workers.dev
```

For release builds on GitHub, add the same value as a repository **variable** (not a secret)
named `VITE_LEADERBOARD_URL` (Settings > Secrets and variables > Actions > Variables).

Builds made with the address show a GLOBAL table on the title and game-over screens and
submit each finished run to the board for its mode and difficulty (Daily Challenge runs go
to that day's board).

## Limits

Scores are sanity-checked and each IP can submit once a minute, but the game runs on the
player's machine, so a determined cheater can still post a fake score. You can clear a
board from the Cloudflare dashboard (KV > SCORES > delete `board:<id>`).
