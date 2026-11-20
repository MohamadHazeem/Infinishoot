// A clean, dependency-free app directory keeps npm dev tools and native binaries out of app.asar.
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build, Platform, Arch } from 'electron-builder';
const require = createRequire(import.meta.url);
const root = process.cwd();
const pkg = require('../../package.json');
const binding = path.dirname(require.resolve('steamworks.js/package.json'));
if (process.platform !== 'darwin') throw new Error('Build both Steam depots on macOS with Xcode Command Line Tools.');
const output = path.resolve('release/steam');
await mkdir(output, { recursive: true });
await rm(path.join(output, 'complete.json'), { force: true });
const staging = await mkdtemp(path.resolve('release/steam-work-'));
try {
  await cp('dist', path.join(staging, 'dist'), { recursive: true });
  await cp('electron', path.join(staging, 'electron'), { recursive: true });
  const { name, version, author, description, main } = pkg;
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({ name, version, author, description, main, steamDistribution: true }));
  function resources(platform) {
    return [{ from: binding, to: 'steamworks.js', filter: ['package.json', 'index.js', 'LICENSE', 'dist/' + platform + '/**/*', '!**/*.lib'] }];
  }
  await build({
    projectDir: staging,
    targets: new Map([[Platform.WINDOWS, new Map([[Arch.x64, ['dir']]])], [Platform.MAC, new Map([[Arch.universal, ['dir']]])]]),
    publish: 'never',
    config: {
      extends: null, appId: pkg.build.appId, productName: pkg.build.productName,
      ...(process.env.ELECTRON_CACHE ? { electronDownload: { cache: process.env.ELECTRON_CACHE } } : {}),
      electronVersion: require('electron/package.json').version, npmRebuild: false,
      directories: { output }, icon: path.join(root, 'public/icons/app-512.png'), files: ['electron/**', 'dist/**'],
      win: { target: 'dir', signExecutable: false, extraResources: resources('win64') },
      mac: { ...pkg.build.mac, identity: process.env.STEAM_MAC_IDENTITY || '-', target: 'dir', extraResources: resources('osx'), x64ArchFiles: '**/steamworksjs.darwin-*.node',
        entitlements: path.join(root, 'scripts/steam/entitlements.plist'), entitlementsInherit: path.join(root, 'scripts/steam/entitlements.plist') },
    },
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', path.join(output, 'mac-universal/InfiniShoot.app')]);
  // Publish a receipt only after both complete. The uploader rejects a stale or partial rebuild.
  await writeFile(path.join(output, 'complete.json'), JSON.stringify({ version, targets: ['win-unpacked', 'mac-universal'] }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
