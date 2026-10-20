import { spawn } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const serverDir = fileURLToPath(new URL('../server/leaderboard/', import.meta.url));
export const KV_TITLE = 'infinishoot-leaderboard-SCORES';
export const LOCAL_ID = '00000000000000000000000000000000';

export function renderConfig(template, id, account = '') {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Expected a 32-character KV namespace ID.');
  if (!template.includes('{{KV_ID}}')) throw new Error('Missing KV_ID in Wrangler template.');
  if (account && !/^[a-f0-9]{32}$/.test(account)) throw new Error('Expected a 32-character Cloudflare account ID.');
  return template.replace('{{KV_ID}}', id).replace('{{ACCOUNT}}', account ? `account_id = "${account}"` : '');
}

export function configId(config) {
  const blocks = [...config.matchAll(/\[\[kv_namespaces\]\]([\s\S]*?)(?=\n\s*\[|$)/g)]
    .filter(match => /^binding\s*=\s*"SCORES"\s*$/m.test(match[1]));
  if (blocks.length !== 1) return '';
  return blocks[0][1].match(/^id\s*=\s*"([a-f0-9]{32})"\s*$/m)?.[1] ?? '';
}

export function parseNamespaces(output) {
  // `kv namespace list` emits JSON; ignore a possible CLI banner preceding it.
  const start = output.indexOf('['), end = output.lastIndexOf(']');
  const rows = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(rows) || rows.some(row => typeof row.title !== 'string' || !/^[a-f0-9]{32}$/.test(row.id))) throw new Error('Unexpected namespace list. No deployment attempted.');
  return rows;
}

export function pickNamespace(rows, existing = '') {
  if (existing && existing !== LOCAL_ID) {
    if (!rows.some(row => row.id === existing)) throw new Error('Configured KV is missing in this account. Check CLOUDFLARE_ACCOUNT_ID; the script will not replace existing storage.');
    return existing;
  }
  const matches = rows.filter(row => row.title === KV_TITLE);
  if (matches.length > 1) throw new Error('Multiple matching namespaces. Set the intended ID in server/leaderboard/wrangler.toml.');
  return matches[0]?.id ?? '';
}

export async function readConfig(name = 'wrangler.toml') {
  try { return await readFile(new URL(`../server/leaderboard/${name}`, import.meta.url), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

export async function writeConfig(name, id, account = '') {
  const template = await readConfig('wrangler.template.toml');
  const path = `${serverDir}${name}`;
  await writeFile(`${path}.tmp`, renderConfig(template, id, account), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export function wrangler(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    // No shell interpolation; only script-owned arguments. Wrangler owns login credentials.
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'wrangler@4.151.2', ...args], {
      cwd: serverDir, shell: process.platform === 'win32',
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
    });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`Wrangler exited with ${code}. See the message above; if logged out, run npx wrangler login.`)));
  });
}

// Injectable runner makes first deploy / rerun / failures testable without Cloudflare access.
export async function deployServer({ run = wrangler, read = readConfig, write = writeConfig, log = console.log } = {}) {
  const current = await read();
  const existing = configId(current);
  const account = current.match(/^account_id\s*=\s*"([a-f0-9]{32})"\s*$/m)?.[1] ?? '';
  if (/^account_id\s*=/m.test(current) && !account) throw new Error('Unrecognized account_id. Set CLOUDFLARE_ACCOUNT_ID in your shell and remove that line.');
  if (current && !existing && !current.includes('REPLACE_WITH_YOUR_KV_NAMESPACE_ID')) throw new Error('Unrecognized Wrangler config. Back it up and remove it before using the template.');
  // Local placeholder config is never deployed; it only gives Wrangler the correct worker name.
  await write('wrangler.local.toml', LOCAL_ID, account);
  const config = existing ? 'wrangler.toml' : 'wrangler.local.toml';
  let rows = parseNamespaces(await run(['kv', 'namespace', 'list', '--config', config], { capture: true }));
  let id = pickNamespace(rows, existing);
  if (!id) {
    log(`Creating KV namespace ${KV_TITLE} (once).`);
    await run(['kv', 'namespace', 'create', KV_TITLE, '--config', config, '--update-config=false']);
    rows = parseNamespaces(await run(['kv', 'namespace', 'list', '--config', config], { capture: true }));
    id = pickNamespace(rows);
    if (!id) throw new Error('Namespace creation finished but its ID was not found. Rerun server:deploy; no Worker was deployed.');
  }
  await write('wrangler.toml', id, account);
  log('Deploying infinishoot-leaderboard with the existing SCORES namespace.');
  // Keep the terminal attached: a first deployment can ask for a workers.dev subdomain.
  // Wrangler itself prints the deployed URL; piping stdout would silently disable these prompts.
  await run(['deploy', '--config', 'wrangler.toml']);
  log('\nCopy the workers.dev URL printed above into the GitHub Actions repository variable VITE_LEADERBOARD_URL.\nOpen that URL + /health to verify storage, then rebuild Pages and desktop releases. See docs/ONLINE.md.');
}
