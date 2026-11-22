import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import flags from '../../electron/steam-flag.cjs';
import config from './config.json' with { type: 'json' };
import pkg from '../../package.json' with { type: 'json' };

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + ' failed (' + (result.status ?? result.signal) + ')');
}
async function main() {
  const username = process.env.STEAM_USERNAME;
  const app = flags.appId(process.env.STEAM_APP_ID);
  if (!username || !/^[a-z0-9_]+$/i.test(username) || !app || app === config.testAppId)
    throw new Error('Set STEAM_USERNAME and your assigned production STEAM_APP_ID. Spacewar is for local tests.');
  const win = flags.appId(process.env.STEAM_DEPOT_WINDOWS);
  const mac = flags.appId(process.env.STEAM_DEPOT_MACOS);
  if (!win || !mac || new Set([win, mac, app]).size !== 3)
    throw new Error('Set distinct assigned STEAM_DEPOT_WINDOWS and STEAM_DEPOT_MACOS IDs.');
  const branch = process.env.STEAM_BRANCH || '';
  if (branch && (!/^[a-zA-Z0-9_-]{1,64}$/.test(branch) || ['default', 'public'].includes(branch.toLowerCase())))
    throw new Error('STEAM_BRANCH must be a named beta branch. Promote the default branch in Steamworks.');
  if (process.argv.includes('--build')) run('npm', ['run', 'dist:steam']);
  const root = path.resolve('release/steam');
  const receipt = JSON.parse(await readFile(path.join(root, 'complete.json'), 'utf8'));
  if (receipt.version !== pkg.version) throw new Error('Build this version with npm run dist:steam first.');
  await access(path.join(root, 'win-unpacked/InfiniShoot.exe'));
  await access(path.join(root, 'mac-universal/InfiniShoot.app/Contents/MacOS/InfiniShoot'));
  const scripts = path.resolve('release/steampipe/scripts');
  await mkdir(scripts, { recursive: true });
  const vars = { APP_ID: app, WIN_DEPOT: win, MAC_DEPOT: mac, VERSION: pkg.version, BETA_BRANCH: branch };
  for (const file of ['depot_build_windows.vdf', 'depot_build_macos.vdf', 'app_build_template.vdf']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    const target = file.replace('template', String(app));
    await writeFile(path.join(scripts, target), source.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!Object.hasOwn(vars, key)) throw new Error('Unknown template variable ' + key);
      return String(vars[key]);
    }));
  }
  if (process.argv.includes('--prepare')) {
    console.log('Prepared SteamPipe manifests in ' + scripts);
    return;
  }
  run(process.env.STEAMCMD || 'steamcmd', ['+login', username, '+run_app_build', path.join(scripts, 'app_build_' + app + '.vdf'), '+quit']);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
