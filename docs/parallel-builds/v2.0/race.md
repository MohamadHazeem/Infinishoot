LANE: race — competitive extras

1. RACE mode (online lobby option, 2-8 players): everyone plays the same seed at the same time in their own world (like PvP's solo stage, reuse it); the HUD shows live rival progress bars (stage, boss HP, time) synced through the connection; first to beat the stage boss (or furthest when time runs out) wins; vo_race_go, round/victory stingers.
2. CHALLENGE A FRIEND (async, works offline): export a finished run as a short code (seed, mode, difficulty, loadout, hero, score); a friend pastes it to play the same setup and see your score/ghost marker to beat.
3. LOCAL TOURNAMENT: a bracket screen for 4-8 friends (names), playing race or PvP matches in turn on one machine or online, with a winner screen and 'trophy' sample.
4. RANKED (local rating): an Elo-style rating for online PvP/race results stored in the save, seasons by month, rank badges (Bronze to Legend) on player cards; a shared online ladder only if VITE_LEADERBOARD_URL is set (add a route module in server/leaderboard/routes.js, keep it optional).
Owns: new src/game/systems/race.ts, src/data/ranked.ts, src/ui/raceUi.ts + tournament screen, lobby options (small), save fields (migrate), tests/race.test.ts.
