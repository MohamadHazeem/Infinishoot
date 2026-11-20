// The configured entry point gives only telemetry its Authorization preflight and D1 path.
// The legacy Worker keeps its KV binding, existing preflight and IP cooldowns.
import { isRun, fields as keys, uuid } from '../../src/net/telemetrySchema.ts';
import legacy from './worker.js';
import { readBody } from './validation.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
const json = (body, status = 200) => Response.json(body, { status, headers: {
  ...cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '3600' } : {}),
} });
// Any x.y.z release (the schema checks the shape); a fixed list would reject every later build.
const versions = { has: v => typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) };
const one = choices => v => choices.split(' ').includes(v);
export const validRun = r => isRun(r) && versions.has(r.version);

async function digest(s) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2,'0')).join('');
}
function attachment(value, magic, max) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('attachment');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (!magic.every((b,i) => b === bytes[i]) || bytes.length > max) throw Error('attachment');
  return bytes.buffer;
}
function cursor(url, name) {
  const n = Number(url.searchParams.get(name) ?? 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
async function summary(req, db, env, url) {
  const auth = req.headers.get('Authorization') || '';
  if (!env.TELEMETRY_ADMIN_TOKEN || !auth.startsWith('Bearer ') || await digest(auth.slice(7)) !== await digest(env.TELEMETRY_ADMIN_TOKEN)) return json({error:'unauthorized'},401);
  const part = url.searchParams.get('part');
  if (part) {
    if (!['replay','screenshot'].includes(part)) return json({error:'attachment'},400);
    const row = await db.prepare('SELECT ' + part + ' AS blob FROM telemetry_reports WHERE seq=?').bind(cursor(url,'report')).first();
    if (!row?.blob) return json({error:'not found'},404);
    return new Response(new Uint8Array(row.blob), { headers:{ ...cors, 'Content-Type': part === 'replay' ? 'application/gzip' : 'image/jpeg',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff','Content-Disposition':'attachment' } });
  }
  const page = 100;
  const [runs,reports] = await db.batch([
    db.prepare('SELECT seq,payload FROM telemetry_runs WHERE seq>? ORDER BY seq LIMIT ?').bind(cursor(url,'runAfter'),page),
    db.prepare('SELECT seq,received,category,note,version,replay IS NOT NULL AS replay,screenshot IS NOT NULL AS screenshot FROM telemetry_reports WHERE seq>? ORDER BY seq LIMIT ?').bind(cursor(url,'reportAfter'),page),
  ]);
  return json({ runs:runs.results.map(r => ({seq:r.seq,run:JSON.parse(r.payload)})), reports:reports.results,
    more:runs.results.length === page || reports.results.length === page });
}

export async function telemetryRoute(req, env, url) {
  if (!url.pathname.startsWith('/telemetry/')) return null;
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  const path = url.pathname.slice('/telemetry/'.length);
  if (!['summary','delete','run','report'].includes(path)) return json({error:'not found'},404);
  if (req.method !== (path === 'summary' ? 'GET' : 'POST')) return json({error:'method'},405);
  const db = env.TELEMETRY;
  if (!db) return json({error:'storage unavailable'},503);
  if (path === 'summary') return summary(req,db,env,url);
  let b;
  try { b = await readBody(req, path === 'report' ? 1536 * 1024 : path === 'run' ? 16 * 1024 : 256); }
  catch (e) { return json({error:'bad body'},e.status === 413 ? 413 : 400); }
  if (!uuid(b.install) || !keys(b, path === 'delete' ? 'install' : 'install '+path)) return json({error:'invalid envelope'},400);
  const install = await digest(b.install.toLowerCase()), now = Math.floor(Date.now()/1000);
  if (path === 'delete') {
    const active = await db.prepare('SELECT 1 AS found FROM telemetry_deleted WHERE install=? AND until>?').bind(install,now).first();
    if (!active) await db.batch([
      db.prepare('DELETE FROM telemetry_deleted WHERE until<=?').bind(now),
      db.prepare('INSERT OR REPLACE INTO telemetry_deleted VALUES (?,?)').bind(install,now+86400),
      db.prepare('DELETE FROM telemetry_runs WHERE install=?').bind(install),
      db.prepare('DELETE FROM telemetry_reports WHERE install=?').bind(install),
    ]);
    return json({ok:true});
  }
  const isRun = path === 'run', v = b[path];
  let columns, args;
  if (isRun) {
    if (!validRun(v)) return json({error:'invalid run'},400);
    columns = 'payload'; args = [JSON.stringify(v)];
  } else {
    if (!keys(v,'id version category text replay screenshot') || !uuid(v.id) || !versions.has(v.version)
      || !one('bug too-hard too-easy confusing performance other')(v.category) || typeof v.text !== 'string' || v.text.length > 500) return json({error:'invalid report'},400);
    try { args = [v.version,v.category,v.text,attachment(v.replay,[31,139,8],1152*1024),attachment(v.screenshot,[255,216,255],300*1024)]; }
    catch { return json({error:'invalid attachment'},400); }
    columns = 'version,category,note,replay,screenshot';
  }
  const table = isRun ? 'telemetry_runs' : 'telemetry_reports';
  // Quota check and write are one SQLite statement. Repeated event IDs are acknowledged.
  const result = await db.prepare(`INSERT OR IGNORE INTO ${table}(install,id,received,${columns})
    SELECT ?,?,?,${args.map(() => '?').join(',')} WHERE
    NOT EXISTS(SELECT 1 FROM telemetry_deleted WHERE install=? AND until>?)
    AND (SELECT COUNT(*) FROM ${table} WHERE install=? AND received>=?) < ?`)
    .bind(install,v.id,now,...args,install,now,install,now-3600,isRun ? 60 : 6).run();
  if (result.meta.changes || await db.prepare(`SELECT 1 AS found FROM ${table} WHERE install=? AND id=?`).bind(install,v.id).first()) return json({ok:true});
  if (await db.prepare('SELECT 1 AS found FROM telemetry_deleted WHERE install=? AND until>?').bind(install,now).first()) return json({error:'deleted'},410);
  return json({error:'slow down'},429);
}

export default {
  async fetch(req, env, ctx) {
    try { return await telemetryRoute(req,env,new URL(req.url)) ?? await legacy.fetch(req,env,ctx); }
    catch { return json({error:'storage unavailable'},503); }
  },
};
