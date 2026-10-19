import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { Plugin } from 'vite';

/** Every shipped asset, including lazy chunks and recorded audio, is available offline. */
export function mobilePwa(): Plugin {
  return {
    name: 'infinishoot-offline',
    apply: 'build',
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      const assets = Object.keys(bundle).filter((p) => !p.endsWith('.map'));
      for (const name of assets.sort()) {
        const file = bundle[name];
        hash.update(file.type === 'chunk' ? file.code : file.source);
      }
      const publicDir = resolve('public');
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = resolve(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name !== 'sw.js') {
            assets.push(relative(publicDir, path).replaceAll('\\', '/'));
            hash.update(readFileSync(path));
          }
        }
      };
      walk(publicDir);
      const worker = readFileSync(resolve(publicDir, 'sw.js'), 'utf8');
      hash.update(worker);
      const source = worker
        .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
        .replace(
          '/* __PRECACHE__ */ []',
          JSON.stringify([...new Set(['index.html', ...assets])].sort()),
        );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
