import { readBody, saneRun } from './validation.js';
import { limited, list, insert } from './mastery/masteryBoards.js';

export async function hardcore(req, env, url, { json }) {
  if (url.pathname !== '/hardcore') return null;
  if (!env.TELEMETRY || !env.SCORES) return json({ error:'unavailable' },503);
  if (req.method === 'GET') return json({ rows: await list(env.TELEMETRY,'hardcore') });
  if (req.method !== 'POST') return json({ error:'method' },405);
  let r;
  try { r = await readBody(req); } catch(e) { return json({ error:'body' }, e.status ?? 400); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.id) ||
      !Number.isSafeInteger(r.ms) || !saneRun(r.score,r.stage,r.kills,r.ms/1000) ||
      r.score > (r.ms/1000+1)*100000*r.stage || (r.stage-1)*30000 > r.ms)
    return json({ error:'invalid run' },400);
  if (await limited(req,env.SCORES,'hardcore')) return json({ error:'rate' },429);
  await insert(env.TELEMETRY,'hardcore',r);
  return json({ accepted:true });
}
