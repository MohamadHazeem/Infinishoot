/** Local-only mastering audit. Requires ffmpeg; --synth also uses installed Chromium.
 * node scripts/audio/loudness.mjs --synth --write --report shots/audio3-loudness.json
 * Short clips repeat to >=3 s for stable EBU gating (LUFS-ish cue level, not programme LUFS).
 * No asset is rewritten. --write updates only the marked tables in src/audio/loudness.ts.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const targets = { weapons: -23, impacts: -24, ui: -26, voice: -20, ambience: -30, music: -28 };
const extending = args.includes('--extend'); // Add newly registered families to an existing audit.
const report = extending ? JSON.parse(readFileSync(option('--report', 'shots/audio3-loudness.json'), 'utf8')).measurements : [];
const temp = mkdtempSync(join(tmpdir(), 'infinishoot-loudness-'));
const category = id => /^(vo_|boss_.*_(intro|phase|defeat)|bark_|banter_|story_|voice)/.test(id) ? 'voice'
  : /^(amb_|step|eclipseDrone|volcanoRumble)/.test(id) ? 'ambience'
  : /^(w_|w:|evo:)/.test(id) ? 'weapons'
  : /^(menu|achievement|quest|profile|page|trophy|ready|chat|coin|host|reconnect|round|victory|defeat|level_up|evolve|chest|route_select|photo)/.test(id) ? 'ui' : 'impacts';
function measure(kind, id, file, cat = category(id)) {
  // Loop the decoded signal, not its MP3 packets (preserves gapless short transients).
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const repeated = pcm.length < 48000 * 8 * 3 ? Buffer.concat(Array(Math.ceil(48000 * 8 * 3 / pcm.length)).fill(pcm)) : pcm;
  const { spawnSync } = child;
  const measuredFile = join(temp, 'measure.f32');
  writeFileSync(measuredFile, repeated);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', measuredFile, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const summary = r.stderr.toString().split('Summary:').at(-1);
  const lufs = Number(summary.match(/I:\s*([-\d.]+) LUFS/)?.[1]);
  const peak = Number(summary.match(/Peak:\s*([-\d.]+) dBFS/)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error(`Cannot measure ${id}: ${summary}`);
  // Synth transients already have conservative authored envelopes: at most +6 dB.
  const gainDb = lufs <= -69 ? 0 : Math.min(kind === 'sample' ? 12 : 6, targets[cat] - lufs, -3 - peak);
  const gain = Number((10 ** (gainDb / 20)).toFixed(5));
  report.push({ kind, id, category: cat, lufs, peak, target: targets[cat], gain, after: Number((lufs + gainDb).toFixed(2)) });
}
const child = await import('node:child_process');
let browser, server;
try {
  const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8'));
  for (const id of extending ? [] : [...new Set([...manifest.sfx, ...manifest.voice])].sort()) {
    const file = `public/audio/${id}.mp3`;
    if (!existsSync(file)) throw new Error(`Manifest sample missing: ${file}`);
    measure('sample', id, file);
  }
  console.log(`Recorded sample measurements: ${report.filter(r => r.kind === 'sample').length}.`);
  if (args.includes('--synth')) {
    const { chromium } = await import('playwright-core');
    const { createServer } = await import('vite');
    server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    let chrome = process.env.SHOT_CHROME;
    for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
      if (chrome || !existsSync(cache)) continue;
      for (const d of readdirSync(cache).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse())
        for (const sub of readdirSync(join(cache, d))) { const f = join(cache, d, sub, 'chrome-headless-shell'); if (existsSync(f)) chrome ??= f; }
    }
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage();
    // A blank same-origin page avoids booting the game, fetching samples or changing saves.
    await page.route('**/audio3-audit', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    await page.goto(base + '/audio3-audit');
    const source = readFileSync('src/audio/sfx.ts', 'utf8');
    const methods = [...source.slice(source.indexOf('  impact(')).matchAll(/^  (\w+)\(([^)]*)\).*\{/gm)]
      .filter(([, name, params]) => !['weapon', 'bossFinisher'].includes(name) && (!params || params.includes('=') || ['footstep', 'thunder', 'whoosh'].includes(name)))
      .map(([, name]) => name);
    methods.push('tinnitus');
    const cues = await page.evaluate(async methods => {
      const [{ sfx }, { weaponSamples }, { LANE_CUES }, { EVO_LAYERS }, { UI_CUES }, { BARK_KINDS, HERO_VOICES, compose, voiceProfile }, { FEATURE_CUES }] = await Promise.all([
        import('/src/audio/sfx.ts'), import('/src/audio/mix.ts'), import('/src/audio/featureCues.ts'), import('/src/audio/evoLayers.ts'), import('/src/audio/uiKit.ts'), import('/src/audio/voice.ts'), import('/src/audio/featureSamples.ts'),
      ]);
      await import('/src/audio/bosses3Cues.ts');
      window.audit = { sfx, compose, voiceProfile };
      const list = methods.map(name => ({ method: name, args: name === 'footstep' ? ['metal'] : name === 'thunder' || name === 'whoosh' ? [0] : [] }));
      for (const name of new Set([...Object.keys(weaponSamples), 'charge', 'ready', 'mechCannon', 'mechMissile'])) list.push({ method: 'weapon', args: [name] });
      for (const name of Object.keys(LANE_CUES)) list.push({ method: 'named', args: ['s2:' + name] });
      for (const name of Object.keys(FEATURE_CUES)) list.push({ method: 'named', args: [name] });
      for (const name of Object.keys(EVO_LAYERS)) list.push({ method: 'evoLayer', args: [name] });
      for (const name of UI_CUES) list.push({ method: 'ui', args: [name, 0.5] });
      for (const name of ['robot', 'slime', 'frog', 'bug', 'boss', 'ghost']) list.push({ method: 'call', args: [name] });
      for (const name of ['sniper', 'mortar', 'leap', 'elite', 'reaper']) list.push({ method: 'threat', args: [name] });
      for (const hero of Object.keys(HERO_VOICES)) for (const kind of BARK_KINDS) list.push({ method: 'speak', args: [hero, kind] });
      const { CROWD_REACTIONS } = await import('/src/audio/crowd.ts');
      const { SURROUND_IDS } = await import('/src/audio/surround.ts');
      for (const id of CROWD_REACTIONS) list.push({ method: 'crowd', args: [id] });
      for (const id of SURROUND_IDS) list.push({ method: 'surround', args: [id] });
      for (const id of ['rewind', 'play', 'stand', 'standWin', 'standFail', 'bulletTime', 'clutch', 'replay', 'deny', 'vote']) list.push({ method: 'time', args: [id] });
      list.push({ method: 'radio', args: [] });
      return list;
    }, methods);
    for (const cue of cues.filter(c => !extending || ['time', 'radio', 'tinnitus', 'crowd', 'surround'].includes(c.method))) {
      const rendered = await page.evaluate(async cue => {
        const { sfx, compose, voiceProfile } = window.audit;
        let seed = 42; Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
        const ctx = new OfflineAudioContext(1, 48000 * 8, 48000);
        sfx.ctx = ctx; sfx.route = ctx.destination;
        sfx.noiseBuf = ctx.createBuffer(1, 48000, 48000);
        const noise = sfx.noiseBuf.getChannelData(0);
        for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
        let id = '', bus = 'sfx';
        sfx.begin = (name, gap, b = 'sfx') => { id = name; bus = b; return ctx; };
        sfx.track = () => {}; sfx.silenceBeds = () => {}; sfx.duck = () => {};
        if (cue.method === 'crowd' || cue.method === 'surround') {
          const { LaneVoice } = await import('/src/audio/synthGraph.ts');
          // Load modules before creating a LaneVoice: its empty-voice microtask must
          // not run between construction and scheduling the first source.
          const { Crowd } = await import('/src/audio/crowd.ts');
          const { playSurroundRecipe } = await import('/src/audio/surround.ts');
          const v = new LaneVoice(ctx, ctx.destination);
          id = cue.method + ':' + cue.args[0];
          if (cue.method === 'crowd') new Crowd().recipe(v, ctx, cue.args[0], 1);
          else playSurroundRecipe(v, cue.args[0]);
        }
        else if (cue.method === 'time') { const { timeSound } = await import('/src/game/timeAudio.ts'); timeSound(cue.args[0]); }
        else if (cue.method === 'radio') {
          const { RadioDj } = await import('/src/audio/radio.ts');
          const { SYNTH_GAINS } = await import('/src/audio/loudness.ts');
          SYNTH_GAINS.radio = 1;
          const output = sfx.output; sfx.output = () => ({ ctx, node: ctx.destination });
          id = 'radio'; bus = 'voice'; new RadioDj().start(['Welcome back to Radio Infini!']); sfx.output = output;
        }
        else if (cue.method === 'speak') sfx.speak(compose(cue.args[1], voiceProfile(cue.args[0]), cue.args.join(':'), Math.random));
        else sfx[cue.method](...cue.args);
        const result = await ctx.startRendering();
        const pcm = result.getChannelData(0);
        let end = pcm.length - 1;
        while (end >= 0 && Math.abs(pcm[end]) < 0.00001) end--;
        if (!id || end < 0) return null;
        const data = new Uint8Array(pcm.buffer, 0, Math.max(4800, end + 1) * 4);
        let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        return { id, bus, data: btoa(binary) };
      }, cue);
      if (!rendered) { if (cue.method === 'crowd' || cue.method === 'surround') throw new Error('Silent audit cue: ' + cue.args[0]); continue; }
      const raw = join(temp, 'cue.f32'), wav = join(temp, 'cue.wav');
      writeFileSync(raw, Buffer.from(rendered.data, 'base64'));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', '48000', '-ac', '1', '-i', raw, wav]);
      measure('synth', rendered.id, wav, rendered.bus === 'ui' ? 'ui' : rendered.bus === 'voice' ? 'voice' : category(rendered.id));
    }
    console.log(`Measured ${report.filter(x => x.kind === 'synth').length} synth variants (fixed seed 42, pitch 1).`);
    const tracks = await page.evaluate(async () => (await import('/src/audio/music/composition.ts')).TRACKS.map(t => t.id));
    for (const id of extending ? [] : tracks) {
      const data = await page.evaluate(async id => {
        const { Music } = await import('/src/audio/music.ts');
        const { sfx } = window.audit;
        const ctx = new OfflineAudioContext(2, 48000 * 20, 48000);
        sfx.output = () => ({ ctx, node: ctx.destination });
        const music = new Music();
        // Measure raw arrangement gain, independent of any previously generated correction.
        const start = music.start.bind(music);
        music.start = (...args) => { const p = start(...args); p.out.gain.cancelScheduledValues(0); p.out.gain.value = 1; return p; };
        const want = { track: id, seed: 42, stage: 1, intensity: 0.9, duck: false };
        music.update(0, want);
        if (!music.cur) throw new Error('Music did not start: ' + id);
        if (!['victory', 'gameover'].includes(id)) music.cur.step = 64;
        const waits = [];
        for (let t = 0.1; t < 19.9; t += 0.1) waits.push(ctx.suspend(t));
        const done = ctx.startRendering();
        for (const wait of waits) { await wait; music.update(0.1, want); await ctx.resume(); }
        const buffer = await done;
        if (music.synth.droppedVoices) throw new Error('Dropped music voices: ' + id);
        const pcm = new Float32Array(buffer.length * 2);
        for (let i = 0; i < buffer.length; i++) { pcm[i * 2] = buffer.getChannelData(0)[i]; pcm[i * 2 + 1] = buffer.getChannelData(1)[i]; }
        const bytes = new Uint8Array(pcm.buffer); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      }, id);
      const raw = join(temp, 'music.f32'), wav = join(temp, 'music.wav');
      writeFileSync(raw, Buffer.from(data, 'base64'));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, wav]);
      measure('music', id, wav, 'music');
    }
    console.log(`Measured ${tracks.length} music arrangements at intensity 0.9 (20 s, seed 42).`);

  }
  const path = resolve(option('--report', join(temp, 'report.json')));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ method: 'EBU R128; stereo; short cues repeated to >=3 seconds; raw pre-bus levels', targets, measurements: report }, null, 2) + '\n');
  if (args.includes('--write')) {
    const file = 'src/audio/loudness.ts';
    let source = readFileSync(file, 'utf8');
    const table = kind => {
      const values = {};
      for (const r of report.filter(x => x.kind === kind)) { const id = r.id.startsWith('voice:') ? 'voice' : r.id; values[id] = Math.min(values[id] ?? Infinity, r.gain); }
      return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
    };
    const samples = `export const SAMPLE_GAINS: Readonly<Record<string, number>> = ${JSON.stringify(table('sample'), null, 2)};`;
    const synths = args.includes('--synth') ? `export const SYNTH_GAINS: Readonly<Record<string, number>> = ${JSON.stringify(table('synth'), null, 2)};` : source.match(/export const SYNTH_GAINS:[\s\S]*?;/)[0];
    const music = args.includes('--synth') ? `export const MUSIC_GAINS: Readonly<Record<string, number>> = ${JSON.stringify(table('music'), null, 2)};` : source.match(/export const MUSIC_GAINS:[\s\S]*?;/)?.[0] ?? 'export const MUSIC_GAINS: Readonly<Record<string, number>> = {};';
    source = source.replace(/\/\/ BEGIN GENERATED MASTERING[\s\S]*?\/\/ END GENERATED MASTERING/, `// BEGIN GENERATED MASTERING\n${samples}\n${synths}\n${music}\n// END GENERATED MASTERING`);
    writeFileSync(file, source);
  }
  for (const kind of ['sample', 'synth', 'music']) for (const cat of Object.keys(targets)) {
    const rows = report.filter(r => r.kind === kind && r.category === cat);
    if (rows.length) console.log(`${kind.padEnd(6)} ${cat.padEnd(8)} ${rows.length} cues; source ${Math.min(...rows.map(r => r.lufs)).toFixed(1)}..${Math.max(...rows.map(r => r.lufs)).toFixed(1)} LUFS; target ${targets[cat]}`);
  }
  if (args.includes('--report')) console.log(`Report: ${path}`);
} finally { await browser?.close(); await server?.close(); rmSync(temp, { recursive: true, force: true }); }
