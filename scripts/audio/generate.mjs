// Generates the recorded sound pack with ElevenLabs (one-off, run locally).
// The key comes from .env.local (ELEVENLABS_API_KEY) and never ships with the game.
// Usage: node scripts/audio/generate.mjs [id ...]   (skips files that already exist; --force to redo)
// Output: public/audio/<id>.mp3, mono, small bitrate, listed in public/audio/manifest.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SOUNDS, VOICE_LINES } from './sounds.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = root + 'public/audio/';
mkdirSync(out, { recursive: true });
const env = existsSync(root + '.env.local') ? readFileSync(root + '.env.local', 'utf8') : '';
const KEY = process.env.ELEVENLABS_API_KEY || /ELEVENLABS_API_KEY=(\S+)/.exec(env)?.[1];
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing (.env.local)');

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const want = (id) => !only.length || only.includes(id);

async function post(url, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    const msg = await r.text();
    if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 3000 * (attempt + 1))); continue; }
    throw new Error(`${r.status} ${msg}`);
  }
  throw new Error('retries exhausted');
}

/** Raw mp3 -> trimmed, normalised, mono mp3 at the given bitrate. */
function encode(raw, id, kbps, loop) {
  const tmp = out + id + '.raw.mp3';
  writeFileSync(tmp, raw);
  const filters = loop ? 'loudnorm=I=-20:TP=-2' : 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '44100', '-af', filters, '-b:a', kbps + 'k', out + id + '.mp3']);
  unlinkSync(tmp);
}

let made = 0;
for (const s of SOUNDS) {
  if (!want(s.id) || (!force && existsSync(out + s.id + '.mp3'))) continue;
  process.stdout.write(`sfx ${s.id} ... `);
  const raw = await post('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    text: s.prompt,
    duration_seconds: Math.max(0.5, s.dur),
    prompt_influence: s.influence ?? 0.6,
    ...(s.loop ? { loop: true, model_id: 'eleven_text_to_sound_v2' } : {}),
  });
  encode(raw, s.id, s.loop ? 48 : 64, s.loop);
  made++;
  console.log('ok');
}

// Announcer: one voice, short punchy lines.
const VOICE = process.env.ANNOUNCER_VOICE || 'pNInz6obpgDQGcFmaJgB'; // "Adam", deep and energetic
for (const v of VOICE_LINES) {
  if (!want(v.id) || (!force && existsSync(out + v.id + '.mp3'))) continue;
  process.stdout.write(`voice ${v.id} ... `);
  const raw = await post(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    text: v.text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.3, similarity_boost: 0.8, style: 0.8, use_speaker_boost: true },
  });
  encode(raw, v.id, 64, false);
  made++;
  console.log('ok');
}

const manifest = {
  sfx: SOUNDS.filter((s) => existsSync(out + s.id + '.mp3')).map((s) => s.id),
  voice: VOICE_LINES.filter((v) => existsSync(out + v.id + '.mp3')).map((v) => v.id),
};
writeFileSync(out + 'manifest.json', JSON.stringify(manifest, null, 1) + '\n');
console.log(`generated ${made}; manifest: ${manifest.sfx.length} sfx, ${manifest.voice.length} voice lines`);
