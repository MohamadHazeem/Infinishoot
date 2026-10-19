# TURN relay for online play

Online co-op and PvP connect players browser to browser (WebRTC through PeerJS). PeerJS's
public broker only introduces the players; the game data flows directly between them. On
most home networks that works with STUN alone, but strict NATs (some mobile networks,
universities, offices, CGNAT) block direct connections. Then the joining player sees:

> Found the game but could not connect: one of your networks blocks direct connections.

A TURN server relays the traffic for those players. PeerJS's own free relay is always
tried, but it's often overloaded, so the game can use your own. The code is in
`src/net/ice.ts`; relays are added after PeerJS's defaults, so direct connections are
still preferred and the relay is only used when nothing else works.

## Option 1: a fixed TURN login baked into the build

Set these when building (`.env.local` for local builds, or GitHub repository
variables/secrets for CI, see below):

| Variable | Example |
|---|---|
| `VITE_TURN_URLS` | `turn:turn.example.com:3478,turns:turn.example.com:5349` |
| `VITE_TURN_USERNAME` | `infinishoot` |
| `VITE_TURN_CREDENTIAL` | `long-random-password` |

The login ships inside the game (it's a public web app), so anyone can read it. Use a
TURN server with a bandwidth cap, or prefer option 2.

A self-hosted [coturn](https://github.com/coturn/coturn) on a small VPS works well:
`listening-port=3478`, `tls-listening-port=5349`, `lt-cred-mech`, `user=infinishoot:<password>`,
`realm=<your domain>`, plus a TLS certificate for `turns:`.

## Option 2: time-limited credentials (recommended)

Set `VITE_TURN_CREDENTIAL_URL` to a URL that returns ICE servers as JSON, either a list
(`[{ "urls": [...], "username": "...", "credential": "..." }]`) or
`{ "iceServers": [...] }` / `{ "iceServers": { ... } }`. The game fetches it right before
hosting or joining (3 s timeout, cached for 10 minutes) and carries on without it if it
fails.

- **metered.ca** (free tier available): create an app, then use
  `https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>` as the URL. The key in
  that URL only issues credentials; metered lets you limit it by domain.
- **Cloudflare Calls TURN**: its credential API needs a secret token, so put a tiny Worker
  in front of it (the leaderboard Worker in `server/leaderboard` is a good home). The
  Worker POSTs to
  `https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_KEY_ID>/credentials/generate` with
  `Authorization: Bearer <TURN_KEY_API_TOKEN>` and `{"ttl": 86400}`, and returns the
  `iceServers` it gets back (add `Access-Control-Allow-Origin` for the game's origin).

## Option 3: players bring their own

PLAY ONLINE has a **CUSTOM RELAY (OPTIONAL)** field under JOIN. It takes
`turn:host:port username password` (several URLs comma-separated, `turns:` for TLS) or the
same JSON as option 2, is saved in the browser (`infinishoot.relay.v1`), and is used the
next time you host or join. Only one side needs a working relay, but it's most reliable
when the host and the joining player both set the same one.

## CI

`.github/workflows/release.yml` (exe and dmgs) and `.github/workflows/pages.yml` (web
build) pass these through, like `VITE_LEADERBOARD_URL`:

- Repository variables (Settings > Secrets and variables > Actions > Variables):
  `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL_URL`
- Repository secret: `VITE_TURN_CREDENTIAL`

Leave them unset for a build that uses only PeerJS's defaults and the player's custom relay.

## Checking it

In Chrome, open `chrome://webrtc-internals` while connecting: the selected candidate pair
of type `relay` means traffic goes through your TURN server. To force the relay path for a
test, temporarily set `iceTransportPolicy: 'relay'` in `iceConfig()`.
