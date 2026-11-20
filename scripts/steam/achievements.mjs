import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas';
import config from './config.json' with { type: 'json' };

const app = process.env.STEAM_APP_ID ?? String(config.testAppId);
if (!/^[1-9]\d{0,9}$/.test(app) || Number(app) > 0xffffffff) throw new Error('Invalid STEAM_APP_ID');
const build = await rolldown({ input: 'scripts/steam/catalog.ts', platform: 'node' });
const { output } = await build.generate({ format: 'esm', codeSplitting: false });
await build.close();
const { ACHIEVEMENTS, localize, setLanguage, pixelIconUrl } = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));
await setLanguage('ar');
globalThis.Path2D = Path2D;
globalThis.document = { createElement: () => createCanvas(24, 24) };

const out = 'release/steamworks';
for (const size of [64, 256]) await mkdir(path.join(out, 'icons-' + size), { recursive: true });
const defs = [['api_name', 'setid', 'permission', 'spoiler', 'archived', 'progress_stat_name', 'progress_stat_min', 'progress_stat_max']];
const localization = [['api_name', 'field', 'english', 'arabic']];
const names = {};
const colors = { bronze: '#ef7d57', silver: '#94b0c2', gold: '#ffcd75' };
const badges = { combat: 'buster', bosses: 'r_crown', modes: 'route_event', ascension: 'route_hard', coop: 'rally_banner', skill: 'riposte_cell', builds: 'power_cell', world: 'route_start', profile: 'lucky_star', secrets: 'world_chest', classic: 'lucky_star' };
for (const a of [...ACHIEVEMENTS].sort((a, b) => a.id < b.id ? -1 : 1)) {
  if (!/^[a-z0-9_]+$/.test(a.id) || Object.hasOwn(names, a.id)) throw new Error('Invalid or duplicate achievement ID: ' + a.id);
  const api = names[a.id] = 'ACH_' + a.id.toUpperCase();
  defs.push([api, '', 'Client', !!a.hidden, false, '', '', '']);
  localization.push([api, 'name', a.name, localize(a.name)], [api, 'description', a.desc, localize(a.desc)]);
  const item = a.unlockLoadout ?? a.unlockWeapon;
  for (const unlocked of [true, false]) {
    const color = unlocked ? colors[a.tier ?? 'bronze'] : '#566c86';
    const url = (item && (pixelIconUrl(item, color) || pixelIconUrl('sp_' + item, color))) || pixelIconUrl(badges[a.cat], color);
    if (!url) throw new Error('Missing pixel icon for ' + a.id);
    const icon = await loadImage(url);
    for (const size of [64, 256]) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      const scale = size / 32;
      ctx.drawImage(icon, 4 * scale, 4 * scale, 24 * scale, 24 * scale);
      const file = api + (unlocked ? '_ACHIEVED.png' : '_UNACHIEVED.png');
      await writeFile(path.join(out, 'icons-' + size, file), canvas.toBuffer('image/png'));
    }
  }
}
function csv(rows) {
  return rows.map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
}
await writeFile('electron/steam-achievements.json', JSON.stringify(names, null, 2) + '\n');
await writeFile(path.join(out, app + '-achievements-definitions.csv'), csv(defs));
await writeFile(path.join(out, app + '-achievements-localization.csv'), csv(localization));
// Valve initially caps new apps at 100. Keep every item unlock and co-op award in the launch import.
const launch = new Set(ACHIEVEMENTS.filter(a => !a.id.startsWith('m2_')).slice(0, 100).map(a => names[a.id]));
for (const row of defs.slice(1)) if (launch.size < 100) launch.add(row[0]);
const limited = path.join(out, 'launch-100');
await mkdir(limited, { recursive: true });
for (const [filename, rows] of [['definitions', defs], ['localization', localization]]) {
  await writeFile(path.join(limited, app + '-achievements-' + filename + '.csv'), csv(rows.filter((row, i) => i === 0 || launch.has(row[0]))));
}
console.log(ACHIEVEMENTS.length + ' achievements, English/Arabic CSVs and both icon sizes in ' + out);
