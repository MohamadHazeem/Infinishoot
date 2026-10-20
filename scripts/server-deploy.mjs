// Explicitly invoked only: no install hook, build hook or workflow deploys the Worker.
import { deployServer } from './server-config.mjs';
try { await deployServer(); }
catch (error) { console.error(`Server deploy stopped: ${error.message}`); process.exitCode = 1; }
