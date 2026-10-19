// Fixed-step, seeded, frozen-time screenshots. PNG decoding/diff uses browser canvas: no image dependency.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { harness } from './replay.mjs';
const fixtures = [
  ['meadow', 'stage=1'], ['dunes', 'stage=2'], ['peaks', 'stage=3'], ['magma', 'stage=4'],
  ['neon', 'biome=neon'], ['factory', 'biome=factory'], ['sky', 'biome=sky'],
  ['autumn', 'biome=meadow:autumn'], ['aurora', 'biome=peaks:aurora'],
  ['drones', 'stage=2&weapons=drones:5&swarm=24'], ['weapons', 'weapons=lightning:4,missiles:4&swarm=30'],
  ['boss', 'stage=1&bossnow&nointro'], ['rex', 'stage=2&bossnow&nointro'],
  ['elites', 'elite=charger:shielded&swarm=12'], ['shop', 'shop&gold=60'], ['levelup', 'levelup'],
  ['settings', 'screen=settings'], ['help', 'screen=replay-help'],
  ['arabic-settings', 'lang=ar&screen=settings'], ['arabic-shop', 'lang=ar&shop&gold=60'],
];
const update = process.argv.includes('--update');
const only = process.argv.indexOf('--only');
const selected = only >= 0 ? fixtures.filter(([id]) => id === process.argv[only + 1]) : fixtures;
if (!selected.length) throw new Error('Unknown visual fixture');
mkdirSync('tests/visual', { recursive: true }); mkdirSync('shots/visual', { recursive: true });
const h = await harness();
const failures = [];
try {
  for (const [name, link] of selected) {
    const p = await h.page(`test&seed=42&god&day&dry&quality=low&tod=0.3&calm&${link}`);
    await p.addStyleTag({ content: '*,*::before,*::after { animation:none!important; transition:none!important; caret-color:transparent!important; }' });
    await p.evaluate(async () => {
      const { retroGlobals } = await import('/src/render/retroMaterial.ts');
      // Exactly 240 steps and 24 render callbacks. No real-time animation loop starts.
      for (let i = 0; i < 240; i++) { window.input.poll(); window.game.update(1 / 60); if (i % 10 === 0) window.game.render(1, 1 / 6); }
      retroGlobals.uTime.value = 4;
      window.renderer.gl.setClearColor(retroGlobals.uFogColor.value);
      window.renderer.render(window.game.scene, window.game.cam.camera);
      await document.fonts.ready;
    });
    const actual = await p.screenshot({ path: `shots/visual/${name}.png`, animations: 'disabled' });
    const baseline = `tests/visual/${name}.png`;
    if (update) { writeFileSync(baseline, actual); console.log(`UPDATE ${name}`); }
    else if (!existsSync(baseline)) failures.push(`${name}: missing baseline`);
    else {
      const diff = await p.evaluate(async ({ a, b }) => {
        const decode = async str => { const img = new Image(); img.src = 'data:image/png;base64,' + str; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return { c, ctx, data: ctx.getImageData(0, 0, c.width, c.height) }; };
        const x = await decode(a), y = await decode(b);
        if (x.c.width !== y.c.width || x.c.height !== y.c.height) return { ratio: 1, png: a, dimensions: true };
        let changed = 0;
        for (let i = 0; i < x.data.data.length; i += 4) {
          const bad = Math.max(...[0, 1, 2].map(k => Math.abs(x.data.data[i + k] - y.data.data[i + k]))) > 24;
          if (bad) changed++;
          x.data.data[i] = bad ? 255 : y.data.data[i] / 4; x.data.data[i + 1] = bad ? 0 : y.data.data[i + 1] / 4; x.data.data[i + 2] = bad ? 120 : y.data.data[i + 2] / 4;
        }
        x.ctx.putImageData(x.data, 0, 0);
        return { ratio: changed / (x.c.width * x.c.height), png: x.c.toDataURL().split(',')[1] };
      }, { a: actual.toString('base64'), b: readFileSync(baseline).toString('base64') });
      console.log(`${name}: ${(diff.ratio * 100).toFixed(3)}% changed`);
      // 24/255 channel noise, then at most 1% changed pixels (font/platform antialiasing).
      if (diff.ratio > 0.01) { failures.push(`${name}: ${(diff.ratio * 100).toFixed(3)}% > 1%`); writeFileSync(`shots/visual/${name}-diff.png`, Buffer.from(diff.png, 'base64')); }
    }
    await p.close();
  }
  failures.push(...h.errors);
  writeFileSync('shots/visual/results.json', JSON.stringify({ fixtures: selected.length, failures }, null, 2));
  if (failures.length) throw new Error('Visual regression:\n' + failures.join('\n'));
  console.log(`${selected.length} visual fixtures ${update ? 'updated' : 'passed'}.`);
} finally { await h.close(); }
