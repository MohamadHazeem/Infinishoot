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

## Public lobbies and the weekly co-op team board

The same worker (and the same `SCORES` KV namespace) also serves two extra routes, wired in
`routes.js`; nothing else needs deploying:

- `lobbies.js`: `GET /lobbies?region=&difficulty=&mode=&version=` and `POST /lobbies`. Hosts who
  switch **PUBLIC** on in their lobby register it (name, invite code, players, game type,
  difficulty, region from their time zone, game version) and send a heartbeat every 45 s; a lobby
  that misses its heartbeats disappears after 120 s. Each lobby carries a random host token, so only
  that host can refresh or close its code. Listing reads lobby data from KV key metadata, so one
  `list()` call serves the whole BROWSE GAMES screen. Joining still uses the invite code and WebRTC:
  the worker is only a directory.
- `teamboard.js`: `GET /teamboard?week=YYYY-Www` and `POST /teamboard`. One board per ISO week for
  the weekly co-op challenge; a team (its name plus its members) keeps only its best run. Same
  plausibility checks and one-post-per-minute-per-IP limit as `/scores`.

Builds without `VITE_LEADERBOARD_URL` keep working: invite codes as before, BROWSE GAMES explains how
to turn the service on, and the team board shows only this PC's best.

**KV write budget.** Cloudflare's free plan allows 1,000 KV writes a day. A public lobby costs one
write per heartbeat (80 an hour) plus one for each new lobby per IP, so the free plan covers roughly
12 hours of public hosting a day across all players. For more, use the paid Workers plan (or move the
directory to a Durable Object). Note that KV `list()` is eventually consistent: a new lobby can take
up to a minute to show up everywhere, and a closed one can linger as long (its `exp` stamp hides it
once its heartbeats stop).

Test the routes locally without Cloudflare: `tests/mp.test.ts` runs them in Node against an
in-memory KV (`tests/fakeKv.ts`).
