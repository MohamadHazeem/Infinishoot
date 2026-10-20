LANE: lobby — getting friends together

1. Invite links: the host's lobby shows a COPY INVITE LINK button: <game url>?join=CODE (works on the web build and in the desktop app via a protocol-free fallback: the link opens the web game; the desktop app accepts the code pasted). Opening the link goes straight to the lobby join.
2. Lobby upgrade: READY-UP (run starts when all ready or host forces), host can KICK, player cards (name, hero, level/profile, best stage, cosmetics, ping), QUICK CHAT phrases and a short TEXT CHAT (rate-limited, length-limited, a basic word filter), all keyboard/gamepad navigable.
3. Party stays together after game over: a PARTY screen with run summary and VOTE RESTART / back to lobby without everyone re-joining.
4. Recent players and saved friend codes (local): EXTRAS > FRIENDS lists recent teammates (name, last played) and lets you save a code to re-invite or join.
5. Everything synced and tested in `npm run coop` (add lobby/ready/chat/party-restart scenarios).
Owns: new src/ui/lobbyScreen.ts (move/extend the lobby UI with small hooks in screens.ts), src/game/systems/online.ts (additive), new src/game/systems/party.ts, src/net/peer.ts (only if needed, small), save fields for friends (migrate), tests/lobby.test.ts.
