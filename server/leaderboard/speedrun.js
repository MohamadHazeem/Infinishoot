import { hexDigest, insert, limited, list } from './mastery/masteryBoards.js';
import { currentWeek, speedSeed, linkSplit, ReplayChain } from './mastery/speedrunProtocol.js';

const maxBytes = 16 * 1024 * 1024;
const u32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
export function validHeader(h, now = Date.now()) {
  const r = h?.replay;
  if (h?.format !== 1 || r?.version !== 1 || !r.complete || !u32(r.hash) ||
      !Number.isInteger(r.steps) || r.steps <= 0 || r.steps > 648000 ||
      ![currentWeek(now), currentWeek(now - 3600000)].includes(h.week) ||
      h.seed !== speedSeed(h.week) || r.header?.seed !== h.seed || r.header.randomSeed !== h.seed ||
      r.header.difficulty !== 'normal' || r.header.mode !== 'daily' || r.header.role !== 'solo' ||
      r.header.cheats?.god || r.header.cheats?.unlockAll ||
      r.header.heroes?.length !== 1 || r.header.heroes[0]?.hero !== 'rookie' ||
      r.header.heroes[0]?.pet !== 'none' ||
      !Array.isArray(h.splits) || h.splits.length !== 8) return false;
  let previous = h.seed, ms = 0, tick = 0;
  for (let i=0; i<8; i++) {
    const s = h.splits[i];
    if (!s || !u32(s.ms) || !u32(s.tick) || !u32(s.state) || s.ms <= ms ||
        s.ms - ms < (i%2 ? 100 : 30000) || s.ms > 3600000 ||
        s.tick <= tick || s.tick > r.steps || s.ms > s.tick * 17 + 100 ||
        s.link !== linkSplit(previous, i, s.ms, s.tick, s.state)) return false;
    previous = s.link; ms = s.ms; tick = s.tick;
  }
  return h.chain === previous && h.ms === ms && r.steps - tick <= 2;
}
// Content-Length is optional. Bound compressed bytes before hashing, and inflated header bytes before parsing.
async function upload(req) {
  if (+req.headers.get('Content-Length') > maxBytes) throw 413;
  const reader = req.body?.getReader();
  if (!reader) throw 400;
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw 413; }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
  const tape = buf.subarray(64);
  const id = await hexDigest(tape);
  if (id !== new TextDecoder().decode(buf.subarray(0,64)) || tape[0] !== 31 || tape[1] !== 139) throw 400;
  const stream = new Blob([tape]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let h, chain, carry = '', total = 0;
  const decode = new TextDecoder('utf-8',{fatal:true});
  try {
    while (true) {
      const {value, done} = await stream.read();
      if (done) break;
      total += value.length;
      if (total > 192*1024*1024) throw 413;
      const block = carry + decode.decode(value,{stream:true});
      let pos = 0, end;
      while ((end = block.indexOf('\n',pos)) >= 0) {
        if (end-pos > (h ? 1024*1024 : 65536)) throw 413;
        const row = JSON.parse(block.slice(pos,end));
        if (!h) {
          if (!validHeader(row) || !Array.isArray(row.replay.header.keys) || row.replay.header.keys.length > 256) throw 400;
          h = row;
        } else if (!chain) {
          if (!Array.isArray(row) || row.length > 8192 || row.some(s=>typeof s !== 'string' || s.includes('debugSkipToBoss') || s.includes('debugGiveWeapon') || s.includes('debugSpawnElite') || s.startsWith('["loadStage"'))) throw 400;
          chain = new ReplayChain(h.seed,h.replay.header.keys.length,row.length);
        } else chain.chunk(row);
        pos=end+1;
      }
      carry=block.slice(pos);
      if (carry.length > (h ? 1024*1024 : 65536)) throw 413;
    }
    if (carry || !chain || chain.finish(h.replay.steps,h.replay.hash) !== h.tapeChain) throw 400;
    return {id,tape,h};
  } finally { void stream.cancel().catch(()=>{}); }
}
export async function speedrun(req, env, url, { json }) {
  if (url.pathname !== '/speedrun') return null;
  if (!env.TELEMETRY || !env.SCORES) return json({error:'unavailable'},503);
  if (req.method === 'GET') {
    const week = url.searchParams.get('week') ?? currentWeek();
    if (!/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(week)) return json({error:'week'},400);
    return json({rows: await list(env.TELEMETRY,week)});
  }
  if (req.method !== 'POST') return json({error:'method'},405);
  if (await limited(req,env.SCORES,'speedrun')) return json({error:'rate'},429);
  let run;
  try { run = await upload(req); } catch (e) { return json({error:'tape'},e === 413 ? 413 : 400); }
  if (!validHeader(run.h)) return json({error:'header'},400);
  // Publish only after the replay exists. Repeated valid receipts insert a single board row.
  await env.SCORES.put('speedrun:tape:'+run.id,run.tape,{expirationTtl:60*86400});
  await insert(env.TELEMETRY,run.h.week,{id:run.id,ms:run.h.ms,stage:4,score:0});
  return json({accepted:true,id:run.id});
}
