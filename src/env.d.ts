/** Game version from package.json, injected by Vite. */
declare const __APP_VERSION__: string;

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Online leaderboard server (server/leaderboard); unset = offline only. */
  readonly VITE_LEADERBOARD_URL?: string;
  /** TURN relay for online play (src/net/ice.ts, docs/TURN.md): comma-separated turn:/turns: URLs and their login. */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  /** URL that returns time-limited TURN credentials (a list of ICE servers or { iceServers }). */
  readonly VITE_TURN_CREDENTIAL_URL?: string;
}
