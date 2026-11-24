import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dom } from './jsdomEnv';
import { installControllerKeyboard } from '../src/platform/keyboard';
import { installPatchNotes } from '../src/ui/patchNotes';
import { promptState, promptText } from '../src/ui/prompts';
import type { Screens } from '../src/ui/screens';
import worker from '../server/leaderboard/telemetry.js';
import { ScoreReplay } from '../src/platform/scoreReplay';
import { verifyReplay } from '../server/leaderboard/replayScores.js';
import { dailySeed } from '../src/data/modes';
import { patchNotes } from '../src/data/patchNotes';
import { setLanguage, t } from '../src/i18n';
import { canShareFile, shareFile } from '../src/platform/share';
import { ModManager } from '../src/mods/manager';
import { sampleArena } from '../src/editor/samples';
import { arenaCodeSmall, readArenaCode } from '../src/editor/codec';

const board = 'daily-2026-11-24';
const replay = new ScoreReplay(board, '3.0.0', 'rookie', dailySeed('2026-11-24'));
replay.record([0,0,1,0,0,0,0,1000,21]);
replay.record([15010,15010,1,60,3,10,-40,850,22]);
replay.record([16620,16620,1,90,6,14,-43,0,23]);
const score = { replay, board, time: 16.62, score: 90, kills: 6, stage: 1 };
assert.equal(verifyReplay(score), true);
for (const edit of [
  (s: typeof score) => { s.replay.rows[1][6]++; },
  (s: typeof score) => { s.score++; },
  (s: typeof score) => { s.time++; },
  (s: typeof score) => { s.replay.rows.splice(1,1); },
  (s: typeof score) => { s.board = 'daily-2026-11-25'; },
  (s: typeof score) => { s.replay.rows[1][9] = -1; },
]) {
  const bad = structuredClone(score); edit(bad);
  assert.equal(verifyReplay(bad), false);
}
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('server/leaderboard/migrations/0010_replay_score.sql','utf8'));
const kv = new Map<string,string>();
const env = {
  TELEMETRY: {
    prepare(query: string) {
      const s = sql.prepare(query);
      return { run: () => Promise.resolve(s.run()), bind: (...v: (string | number)[]) => ({
        run: () => s.run(...v), all: () => ({results:s.all(...v)}), first: () => s.get(...v),
      }) };
    },
    batch: (ss: Array<{all(): unknown}>) => ss.map(s => s.all()),
  },
  SCORES: { get: (k: string) => kv.get(k), put: (k: string,v: string) => kv.set(k,v) },
};
const post = (body: object, ip = 'fixture') => worker.fetch(new Request('https://fixture.test/replay-scores', {
  method:'POST',headers:{'CF-Connecting-IP':ip},body:JSON.stringify(body),
}),env);
assert.equal((await post({...score, replay:null})).status,400);
assert.equal((await post({extra:'x'.repeat(524288)})).status,413);
assert.deepEqual(await (await post(score)).json(),{rank:1});
assert.equal((await post(score)).status,429);
assert.deepEqual(await (await post(score,'retry')).json(),{rank:1});
const listed = await worker.fetch(new Request('https://fixture.test/replay-scores?board=' + board),env);
const rows = (await listed.json()).scores;
assert.equal(rows.length,1); assert.equal(rows[0].name,'rookie'); assert.equal(rows[0].score,90);
assert.equal(sql.prepare("SELECT kills FROM world_goal WHERE receipt=''").get()!.kills,6);
assert.ok([...kv.keys()].every(k => !k.includes('fixture') && !k.includes('retry')));
sql.close();

const requireLocal = createRequire(join(process.cwd(),'package.json'));
const { workshopFor } = requireLocal('./electron/workshop.cjs');
assert.equal(workshopFor({},123),null);
const dir = mkdtempSync(join(tmpdir(),'g10-launch-test-'));
const pack = readFileSync('docs/mods/example.json','utf8');
try {
  const arena = sampleArena('demo');
  const code = await arenaCodeSmall(arena);
  writeFileSync(join(dir,'arena.txt'),code);
  writeFileSync(join(dir,'pack.json'),pack);
  let stage = '', overlay = '', uploads = 0;
  const api = workshopFor({
    workshop:{
      getSubscribedItems:()=>[10n],installInfo:()=>({folder:dir}),
      createItem:async()=>({itemId:10n}),
      updateItem:async(id: bigint, o: {contentPath:string;visibility:number})=>{
        uploads++; assert.equal(id,10n); assert.equal(o.visibility,2);
        stage = o.contentPath; assert.equal(readFileSync(join(stage,'pack.json'),'utf8'),pack);
        return {needsToAcceptAgreement:true};
      },
    },
    overlay:{activateToWebPage:(url:string)=>{overlay=url;}},
  },123);
  const items = await api.list();
  assert.deepEqual(await readArenaCode(items.find((x:any)=>x.kind==='arena').raw),arena);
  window.steamWorkshop = api;
  const manager = new ModManager(); await manager.initialize();
  assert.equal(manager.files[0].key,'workshop/10'); assert.equal(manager.files[0].enabled,false);
  assert.equal(manager.plan.results[0].mod?.id,JSON.parse(pack).id);
  assert.equal(await api.publish('pack','Sample',pack),'agreement'); assert.equal(uploads,1);
  assert.equal(existsSync(stage),false); assert.match(overlay,/filedetails/);
  await assert.rejects(api.publish('../escape','x','{}'));
  await assert.rejects(api.publish('pack','x','x'.repeat(524289)));
  api.browse(); assert.equal(overlay,'https://steamcommunity.com/app/123/workshop/');
  rmSync(join(dir,'pack.json')); symlinkSync(join(dir,'arena.txt'),join(dir,'pack.json'));
  assert.equal((await api.list()).length,1);
} finally { delete window.steamWorkshop; rmSync(dir,{recursive:true,force:true}); }

const file = new File(['PNG'],'daily.png',{type:'image/png'});
assert.equal(canShareFile(file),false);
Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
let shared = false;
Object.defineProperty(navigator,'share',{configurable:true,value:({files}:{files:File[]})=>{
  assert.equal(files[0],file); shared = true; return Promise.resolve();
}});
const handoff = shareFile(file); assert.ok(shared,'share called inside click, before any await');
assert.equal(await handoff,'shared');
Object.defineProperty(navigator,'share',{value:()=>Promise.reject(new DOMException('cancel','AbortError'))});
assert.equal(await shareFile(file),'cancelled');
// Navigate the public collection and use controller text entry via the Steam callback.
document.body.innerHTML = '<div id="scr-extras"><div class="menu"></div></div><section id="scr-online"><input placeholder="Code" maxlength="5"></section>';
let screen = 'extras';
const screens = {
  get current() { return screen; },
  show(name: string) { screen = name; this.onShow(name); },
  onShow(_name: string) {},
  addScreen(_id: string, el: HTMLElement) { document.body.append(el); },
  refreshNav() {},
};
installPatchNotes(screens as unknown as Screens);
document.querySelector<HTMLButtonElement>('#scr-extras button')!.click();
assert.equal(screen,'patchNotes');
const nav = document.querySelectorAll<HTMLButtonElement>('#scr-patchNotes button');
nav[1].click();
assert.match(document.querySelector('#scr-patchNotes h2')!.textContent!, /2\.0\.1/);
nav[2].click(); assert.equal(screen,'extras');
Object.defineProperty(globalThis,'HTMLTextAreaElement',{value:dom.window.HTMLTextAreaElement,configurable:true});
installControllerKeyboard(screens as unknown as Screens);
screens.show('online'); promptState.mode='xbox';
window.steamDeck = true;
assert.equal(promptText('dash','xbox'),'L1'); assert.equal(promptText('fire','xbox'),'R2');
delete window.steamDeck; assert.equal(promptText('dash','xbox'),'LB');
const field = document.querySelector<HTMLInputElement>('#scr-online input')!;
assert.ok(field.hasAttribute('data-nav'));
let changes = 0; field.onchange = () => { changes++; };
window.steamKeyboard = async () => 'ABCDE1';
field.click(); await new Promise(resolve => setTimeout(resolve,0));
assert.equal(field.value,'ABCDE'); assert.equal(changes,1);
window.steamKeyboard = async () => null;
field.click(); await new Promise(resolve => setTimeout(resolve,0));
assert.equal(changes,1); assert.equal(screen,'online');
delete window.steamKeyboard;
field.click(); assert.equal(screen,'desktopKeyboard');
await setLanguage('ar');
for (const p of patchNotes) for (const section of p.sections) for (const key of section) assert.match(t(key),/[\u0600-\u06ff]/);
console.log('ok   score replay chain, Worker storage, Workshop import/publication, file sharing and patch locales');
