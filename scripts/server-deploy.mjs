// Explicit owner action only. Keep KV provisioning and interactive Wrangler deploy in server-config.
import { deployServer, readConfig, wrangler, writeConfig, serverDir } from './server-config.mjs';
import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
const database = 'infinishoot-telemetry';
const local = '00000000-0000-4000-8000-000000000000';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function provisionD1(run, config, previous) {
  const args = ['--config',config];
  const list = async () => JSON.parse(await run(['d1','list','--json',...args], {capture:true}));
  const find = rows => rows.find(r => r.name === database)?.uuid;
  let id = find(await list());
  if (previous && previous !== local && previous !== id) throw Error('Configured telemetry database differs in this account. Check the account and binding.');
  if (!id) {
    await run(['d1','create',database,'--update-config=false',...args]);
    id = find(await list());
  }
  if (!uuid.test(id) || id === local) throw Error('Could not resolve the telemetry database ID.');
  return id;
}

async function deploy() {
  const previous = (await readConfig()).match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
  await deployServer({ write: async (name, kv, account) => {
    if (name !== 'wrangler.toml') return writeConfig(name,kv,account);
    const id = await provisionD1(wrangler,'wrangler.local.toml',previous);
    const { renderConfig } = await import('./server-config.mjs');
    const contents = renderConfig(await readConfig('wrangler.template.toml'),kv,account).replace(local,id);
    await writeFile(serverDir + name + '.tmp',contents,{mode:0o600});
    await rename(serverDir + name + '.tmp',serverDir + name);
    await wrangler(['d1','migrations','apply',database,'--remote','--config',name]);
  } });
  console.log('In server/leaderboard, set the dashboard secret with: npx wrangler secret put TELEMETRY_ADMIN_TOKEN');
}
if (basename(process.argv[1] ?? '') === 'server-deploy.mjs' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await deploy(); } catch (error) { console.error('Server deploy stopped:',error.message); process.exitCode = 1; }
}
