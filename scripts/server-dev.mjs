import { LOCAL_ID, writeConfig, wrangler } from './server-config.mjs';
try {
  await writeConfig('wrangler.local.toml', LOCAL_ID);
  await wrangler(['d1','migrations','apply','infinishoot-telemetry','--local','--config','wrangler.local.toml']);
  console.log('Local KV and D1. Open the game with ?test&server=http://127.0.0.1:8787');
  console.log('For playtest telemetry, start Vite with VITE_LEADERBOARD_URL=http://127.0.0.1:8787');
  await wrangler(['dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--config', 'wrangler.local.toml']);
} catch (error) { console.error(`Local server stopped: ${error.message}`); process.exitCode = 1; }
