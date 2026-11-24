// Run from the repository root after npx vite build. See docs/PRESSKIT.md.
import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, readdir, rename, writeFile, open } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { rolldown } from 'rolldown';
import { captureShot } from './driver.mjs';
import { shots, fps } from './shots.mjs';

const { values } = parseArgs({ options: {
  shot: { type: 'string' }, press: { type: 'boolean' }, verify: { type: 'boolean' },
  list: { type: 'boolean' }, output: { type: 'string' }, chrome: { type: 'string' },
} });
const selected = values.shot ? shots.filter(s => s.id === values.shot) : shots;
if (!selected.length) throw Error('Unknown shot. Use --list for shot IDs.');
const destination = resolve(values.output ?? (values.press ? 'marketing/screens' : 'shots/g10-trailer/frames'));
const number = n => String(n).padStart(5, '0');
const filename = (s, n) => (values.press ? s.id + '-' : '') + number(n) + '.png';
const folder = s => values.press ? destination : join(destination, s.id);

async function verify(dir, shot) {
  const entries = (await readdir(dir)).filter(f => !values.press || f.startsWith(shot.id + '-'));
  const frames = values.press ? shot.selects : Array.from({ length: shot.frames }, (_, i) => i);
  if (entries.length !== frames.length) throw Error(dir + ': expected ' + frames.length + ' files for ' + shot.id);
  const header = Buffer.alloc(24);
  const tail = Buffer.alloc(12);
  const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
  const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');
  for (const n of frames) {
    const name = join(dir, filename(shot, n));
    const file = await open(name);
    try {
      const { bytesRead } = await file.read(header, 0, 24, 0);
      if (bytesRead !== 24 || !header.subarray(0, 8).equals(pngSignature)
          || header.toString('ascii', 12, 16) !== 'IHDR' || header.readUInt32BE(16) !== 1920
          || header.readUInt32BE(20) !== 1080) throw Error('Invalid 1080p PNG header: ' + name);
      const { size } = await file.stat();
      const end = await file.read(tail, 0, tail.length, size - tail.length);
      if (end.bytesRead !== tail.length || !tail.equals(pngEnd)) throw Error('Incomplete PNG: ' + name);
    } finally { await file.close(); }
  }
}

async function record() {
  const bundle = await rolldown({ input: 'src/render/cinematicCamera.ts' });
  let camera;
  try {
    const { output } = await bundle.generate({ format: 'iife', name: 'CaptureCamera', minify: true });
    camera = output[0].code;
  } finally { await bundle.close(); }
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: values.chrome,
      args: ['--enable-gpu', '--force-color-profile=srgb'] });
    const base = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
    for (const shot of selected) {
      const final = folder(shot);
      // Refuse to mix takes. Publish a complete frame directory in one rename.
      if (!values.press) {
        await mkdir(dirname(final), { recursive: true });
        const existing = await readdir(dirname(final));
        if (existing.includes(basename(final))) throw Error(final + ' already exists. Choose another --output.');
      }
      await mkdir(values.press ? final : dirname(final), { recursive: true });
      const stage = values.press ? final : await mkdtemp(final + '.partial-');
      await captureShot(browser, base, shot, camera, async (page, s, n) => {
        const png = await page.screenshot({ type: 'png', caret: 'initial' });
        await writeFile(join(stage, filename(s, n)), png, { flag: 'wx' });
      }, !!values.press);
      await verify(stage, shot);
      if (!values.press) await rename(stage, final);
      console.log(shot.id + ' verified');
    }
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
}

if (values.list) {
  for (const s of selected) console.log(s.id, s.start / fps + 's', s.frames + ' frames', s.subject, s.link);
} else if (values.verify) {
  for (const shot of selected) await verify(folder(shot), shot);
  console.log(selected.length + ' takes verified in ' + destination);
} else await record();
