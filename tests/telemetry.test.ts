import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import telemetry, { validRun } from '../server/leaderboard/telemetry.js';
import { provisionD1 } from '../scripts/server-deploy.mjs';
import '../tools/playtest-dashboard/aggregate.js';
import { consent, choose, queue, enqueue, flush, deleteData, fitRun, byteSize, installId, QUEUE_LIMIT, RUN_BYTES, type Run } from '../src/net/telemetryClient';

const dom = new JSDOM('', { url:'http://localhost' });
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage});
const sample = (): Run => ({
  id:crypto.randomUUID(),version:'2.0.1',mode:'standard',difficulty:'normal',hero:'rookie',loadout:['buster','charge','bomb'],ascension:0,heat:0,
  party:'solo',team:1,stage:2,loop:1,clears:0,seconds:129.5,outcome:'death',day:'2026-11-20',stages:[{stage:2,seconds:50,level:5,ranks:{buster:[1,2,-1,0]},damage:{king:21}}],
  offers:[[1,['drones','shield'],0],[2,['drones','shield'],0]],purchases:[[1,'battery',5]],mods:[['battery',1]],relics:[],bosses:[[2,'king','death',18]],
  hits:[[128,'king',21,0]],fatal:['king',21,21],rewinds:0,stands:0,revives:0,avgMs:16,worstMs:25,quality:3,platform:'web',mobile:false,language:'en',omitted:0,
});
assert.equal(consent(),null);
enqueue(sample(),'');assert.equal(queue().length,0);
assert.equal(localStorage.length,0);
choose('yes');const install=installId();assert.equal(installId(),install);
for(let i=0;i<QUEUE_LIMIT+3;i++)enqueue(sample(),'');
assert.equal(queue().length,QUEUE_LIMIT);
let calls=0;
await flush('',async()=>{calls++;return new Response();});assert.equal(calls,0);
await flush('http://localhost',async()=>{throw Error('offline');});assert.equal(queue().length,QUEUE_LIMIT);
await Promise.all([1,2].map(()=>flush('http://localhost',async(_url,init)=>{
  assert.equal(init?.credentials,'omit');assert.equal(JSON.parse(String(init?.body)).install,install);calls++;return new Response();
})));assert.equal(queue().length,0);assert.equal(calls,QUEUE_LIMIT);
enqueue(sample(),'');choose('no');assert.equal(queue().length,0);
await flush('http://localhost',async()=>{throw Error('should never run');});
const long=sample();for(let i=0;i<2000;i++)long.offers.push([1,['drones','charge','buster'],1]);
fitRun(long);assert.ok(byteSize(long)<=RUN_BYTES && long.omitted>0);assert.deepEqual(long.fatal,['king',21,21]);
assert.ok(validRun(long));assert.ok(long.offerIds?.includes('drones'));assert.equal(validRun({...long,room:'room'}),false);
assert.equal(validRun({...long,hits:[{name:'someone'}]}),false);

const { packageReport }=await import('../src/net/telemetryReport');
const secretMarker='private-test-marker';
const replay={version:1,header:{seed:42,role:'solo',mode:'standard',keys:['KeyQ'],settings:{teamName:secretMarker,loadout:{primary:'buster'}},
  lobby:[{peerId:secretMarker,name:secretMarker}],heroes:[{name:secretMarker,peerId:secretMarker}],query:secretMarker,save:{friends:{code:secretMarker},history:[secretMarker]}},
  data:[[1,0,0.016]],steps:0,complete:true,strings:[JSON.stringify(['onHostMessage',[secretMarker,{t:'chat',text:secretMarker}]]),JSON.stringify(['onHostMessage',[secretMarker,{t:'i',x:1,text:secretMarker}]]),JSON.stringify({settings:{teamName:secretMarker}})],checks:{1:secretMarker}};
const report=await packageReport('bug','a'.repeat(700),replay,new Blob([Uint8Array.of(255,216,255,217)],{type:'image/jpeg'}));
assert.equal(report.text.length,500);assert.ok(report.replay && report.screenshot);
const clean=await new Response(new Blob([Buffer.from(report.replay!,'base64')]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
assert.ok(!clean.includes(secretMarker));assert.deepEqual(JSON.parse(clean).data,replay.data);
await assert.rejects(()=>packageReport('bug','',undefined,new Blob([new Uint8Array(307201)],{type:'image/jpeg'})));

// D1-shaped adapter executes the actual migration, constraints and quota SQL against in-memory SQLite.
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('server/leaderboard/migrations/0001_playtest.sql','utf8'));
class Statement {
  args:any[]=[];constructor(readonly query:string){}
  bind(...v:any[]){this.args=v.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return this;}
  first(){return sql.prepare(this.query).get(...this.args);}
  all(){return {results:sql.prepare(this.query).all(...this.args)};}
  run(){return {meta:sql.prepare(this.query).run(...this.args)};}
}
const env={TELEMETRY_ADMIN_TOKEN:crypto.randomUUID(),TELEMETRY:{
  prepare:(s:string)=>new Statement(s),batch:(ss:Statement[])=>{sql.exec('BEGIN');try{const result=ss.map(s=>s.query.startsWith('SELECT')?s.all():s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},
}};
const request=(path:string,body?:unknown,token='')=>telemetry.fetch(new Request('https://example.test/telemetry/'+path,{method:body===undefined?'GET':'POST',
  headers:token?{Authorization:'Bearer '+token}:{},body:body===undefined?undefined:JSON.stringify(body)}),env);
const postRun=(run:Run)=>request('run',{install,run});const first=sample();
assert.equal((await postRun(first)).status,200);assert.equal((await postRun(first)).status,200);
assert.equal((await postRun({...first,version:'v9-beta'})).status,400);
assert.equal((await request('run',{install,run:{...first,x:'x'.repeat(17000)}})).status,413);
assert.equal((await request('report',{install,report})).status,200);
assert.equal((await request('report',{install,report:{...report,replay:'abcd'}})).status,400);
assert.equal((await request('report',{install,report:{...report,text:'x'.repeat(1600000)}})).status,413);
assert.equal((await request('summary')).status,401);
const admin=(query='')=>request('summary'+query,undefined,env.TELEMETRY_ADMIN_TOKEN);
const pre=await telemetry.fetch(new Request('https://example.test/telemetry/summary',{method:'OPTIONS'}),env);
assert.match(pre.headers.get('Access-Control-Allow-Headers')!,/Authorization/);
const res=await (await admin()).json();assert.equal(res.runs.length,1);assert.equal(res.reports[0].replay,1);
assert.ok(!JSON.stringify(res).includes(install) && !JSON.stringify(res).includes(report.replay!));
assert.deepEqual(Buffer.from(await (await admin('?part=replay&report=1')).arrayBuffer()),Buffer.from(report.replay!,'base64'));
for(let i=1;i<6;i++)assert.equal((await request('report',{install,report:{...report,id:crypto.randomUUID()}})).status,200);
assert.equal((await request('report',{install,report:{...report,id:crypto.randomUUID()}})).status,429);
for(let i=1;i<60;i++)assert.equal((await postRun(sample())).status,200);
assert.equal((await postRun(sample())).status,429);assert.equal((await postRun(first)).status,200);
choose('yes');enqueue(sample(),'');
assert.equal(await deleteData('http://localhost',async()=>{throw Error('offline');}),false);
assert.equal(consent(),'no');assert.equal(installId(),install);assert.equal(queue().length,0);
assert.equal(await deleteData('http://localhost',async(_url,init)=>request('delete',JSON.parse(String(init?.body)))),true);
assert.notEqual(installId(),install);
const otherInstall=crypto.randomUUID();assert.equal((await request('run',{install:otherInstall,run:sample()})).status,200);
assert.equal((await request('delete',{install})).status,200);assert.equal((await request('delete',{install})).status,200);
assert.equal((await postRun(sample())).status,410);
const after=await (await admin()).json();assert.equal(after.runs.length,1);assert.equal(after.reports.length,0);
const win=sample();win.outcome='victory';win.seconds=200;win.bosses=[[2,'king','kill',14]];
const stats=(globalThis as any).playtestStats.aggregate([win,first]);
assert.equal(stats.median,164.75);assert.deepEqual(stats.bosses[0],['king',1,1,0,14,0.5]);
assert.deepEqual(stats.items[0],['drones',4,4,1,0.5]);assert.deepEqual(stats.deaths,[[2,'king',1]]);
assert.deepEqual(stats.heroes,[['rookie',2,1,0.5]]);assert.deepEqual(stats.frames,[['web / desktop',2,25,25]]);
let created=false;const dbid=crypto.randomUUID();
const mock=async(a:string[])=>{if(a.includes('create'))created=true;return JSON.stringify(created?[{name:'infinishoot-telemetry',uuid:dbid}]:[]);};
assert.equal(await provisionD1(mock,'local.toml',''),dbid);assert.equal(await provisionD1(mock,'local.toml',dbid),dbid);
await assert.rejects(()=>provisionD1(mock,'local.toml',crypto.randomUUID()));
console.log('PASS consent, bounded queue, retry, report redaction/gzip, SQL quotas, deletion, admin downloads, aggregation and D1 provisioning');
