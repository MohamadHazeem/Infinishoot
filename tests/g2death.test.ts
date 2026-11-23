import './jsdomEnv';
import assert from 'node:assert/strict';
import { DamageLog, hazards, personalDeaths, recapHits, type DeathPacket, type Hit } from '../src/game/damageLog';
import { ENEMIES } from '../src/data/enemies';
import { hitName, tipFor } from '../src/ui/deathRecap';
import { setLanguage, t } from '../src/i18n';

const hit = (at: number, before: number, after: number): Hit => ({
  at, before, after, amount: before - after, source: 'charger', attack: 'contact', warned: true, dash: true,
});
const ring = new DamageLog();
for (let i = 1; i <= 45; i++) ring.push(hit(i, 10, 9));
assert.deepEqual(ring.hits().map(h => h.at), Array.from({ length: 20 }, (_, i) => i + 26));
ring.clear(); assert.deepEqual(ring.hits(), []);
const hits = [hit(1, 100, 5), hit(10, 90, 29), hit(14.99, 100, 45), hit(15, 50, 15), hit(19, 15, 5), hit(20, 5, 0)];
hits[5].amount = 99;
const recap = recapHits(hits)!;
assert.equal(recap.breaking, hits[3], 'a large overkill cannot eclipse the loss of 35 life, five seconds before death');
assert.equal(recap.fatal, hits[5]);
assert.deepEqual(recap.timeline, hits.slice(1));
assert.equal(recapHits(hits.slice(0, -1)), undefined);

for (const lang of ['en', 'ar'] as const) {
  await setLanguage(lang);
  for (const source of [...Object.keys(ENEMIES), ...Object.keys(hazards)]) {
    const h = { ...hits[0], source };
    const key = 'death.' + tipFor(h);
    const tip = t(key);
    assert.ok(tip && tip !== key, source + ': no advice');
    if (lang === 'ar') {
      assert.match(tip, /[\u0600-\u06ff]/, source);
      assert.doesNotMatch(hitName(h), /[a-z]{3}/i, source + ': Arabic cause name');
    }
  }
}
await setLanguage('en');

(globalThis as any).__APP_VERSION__ = '2.0.1';
const { Game, cheats } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { choose, queue } = await import('../src/net/telemetryClient');
const { timeState } = await import('../src/game/systems/time');
const { resetDamageLog, receiveDeath, deathForReconnect, hurtFromBullet, forgetRewoundDamage, refundBulletHit } = await import('../src/game/damageLog');
const g = new Game(new Input(document.querySelector('canvas')!), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
choose('yes'); g.startSolo(); g.closeShop();
const h = g.hero;
const mate = g.makeHero(1, 'Mate', [], 'peer-1');
g.setHeroes([h, mate]);
const p = h.player, mp = mate.player;
const shooter = g.enemies.spawn(ENEMIES.sniper, 3, 3, { instant: true });
const sent: DeathPacket[] = [];
g.role = 'host';
g.tell = (who, m) => {
  if ((m as any).t !== 'deathRecap') return;
  assert.equal(who, mate);
  sent.push((m as any).packet);
};
const tl = timeState(g).tl;
for (let i = 0; i < 15; i++) {
  g.enemies.spawn(ENEMIES.swarmer, 2, i / 5, { instant: true });
  g.enemyCtx.fireBullet(shooter, 1, 0, 10, 12);
  g.strikes.push({ x: 2, z: i / 5, r: 2, t: 1, dmg: 10 });
}
for (let i = 0; i <= 49; i++) {
  g.runTime = i / 10; mp.pos.x = i / 20;
  if (i < 24) { mp.invuln = 0; g.hurtHero(mate, 1, 2, 2, null, 'Burning ground'); }
  tl.record(g);
}
g.runTime = 5;
mp.hp = 8; mp.invuln = 0; mate.revivesLeft = 0;
shooter.state = 'windup';
g.enemyCtx.fireBullet(shooter, 1, 0, 10, 50);
cheats.god = true; hurtFromBullet(g, mate, g.bullets.count - 1);
assert.equal(mp.hp, 8); assert.equal(sent.length, 0);
cheats.god = false;
hurtFromBullet(g, mate, g.bullets.count - 1);
assert.equal(sent.length, 1); assert.equal(sent[0].hits.length, 20);
assert.equal(sent[0].hits.at(-1)?.source, 'sniper'); assert.equal(sent[0].hits.at(-1)?.attack, 'bullet');
assert.equal(sent[0].hits.at(-1)?.warned, true); assert.equal(sent[0].frames.at(-1)?.ms, 5000);
assert.ok(sent[0].frames.length <= 28); assert.ok(JSON.stringify(sent[0]).length < 12000);
assert.equal(deathForReconnect(mate), undefined, 'ordinary game over sends no duplicate payload');
Object.assign(mate, { peerId: 'reconnected-peer' });
assert.equal(deathForReconnect(mate), sent[0]);
g.runTime = 25; tl.clear(); tl.record(g);
g.role = 'solo';
p.invuln = 0; hurtFromBullet(g, h, 0); refundBulletHit(h, g.runTime);
g.runTime = 25.1; p.invuln = 0; g.hurtHero(h, 9, 0, 1, null, 'Lightning');
forgetRewoundDamage(h, 25);
g.runTime = 25;
p.invuln = 0; p.hp = 34; h.revivesLeft = 0;
g.hurtHero(h, 30, 1, 1, null, 'Ground strike');
p.invuln = 0; p.dashStock = 0; g.runTime = 27;
g.hurtHero(h, 20, 1, 1, null, 'Lava');
const mine = personalDeaths(g, true)[0];
assert.equal(mine.hits.length, 2);
assert.equal(mine.hits[1].dash, false); assert.equal(mine.hits[0].warned, true);
assert.equal(mine.hits[1].warned, false);
g.endRun();
const r = queue().at(-1)!;
assert.deepEqual(r.deathCause, ['lava', 'hazard']);
assert.equal(r.fatal?.[0], 'lava'); assert.equal(r.breaking?.[0], 'ground_strike'); assert.equal(r.breaking?.[3], 2);
g.screens.show('gameover');
const panel = document.querySelector('#scr-gameover .death-panel')!;
assert.match(panel.textContent!, /Lava/);
panel.querySelector<HTMLButtonElement>('button')!.click();
assert.equal(g.screens.current, 'death-film');
document.querySelector<HTMLButtonElement>('#death-film button')!.click();
assert.equal(g.screens.current, 'gameover');
g.role = 'client'; g.local = 1;
resetDamageLog(mate); receiveDeath(mate, mine); assert.deepEqual(personalDeaths(g, true), []);
g.onClientMessage({ t: 'deathRecap', packet: JSON.parse(JSON.stringify(sent[0])) });
assert.equal(personalDeaths(g, true)[0].hits.at(-1)?.source, 'sniper');
assert.equal(personalDeaths(g, true)[0].frames.at(-1)?.ms, 5000, 'early fall survives a later wipe');
assert.deepEqual(personalDeaths(g, false), []);
mate.startRun(); assert.deepEqual(personalDeaths(g, true), []);
console.log('PASS damage ring, time windows, bilingual family and hazard advice, actual hits, private replay, controls, reset and telemetry');
