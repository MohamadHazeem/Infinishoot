/** Game version from package.json, injected by Vite. */
declare const __APP_VERSION__: string;

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Online leaderboard server (server/leaderboard); unset = offline only. */
  readonly VITE_LEADERBOARD_URL?: string;
}
