import './jsdomEnv';
import assert from 'node:assert/strict';

const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { ENEMIES } = await import('../src/data/enemies');
const { Team } = await import('../src/game/bullets');
const { PickupType } = await import('../src/game/pickups');
const { settings } = await import('../src/game/settings');
const { skillTuning, styleTuning } = await import('../src/game/style');
const { handsTuning } = await import('../src/game/skillHands');
const { promptText } = await import('../src/ui/prompts');
const { setLanguage } = await import('../src/i18n');
const { noteParryLag } = await import('../src/game/netFeel');

settings.tips = false;
const input = new Input(document.querySelector('canvas')!);
const g = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
g.startRun({ seed: 47, difficulty: 'normal' });
g.closeShop();
const h = g.hero, p = h.player, dt = 1 / 60;
input.move.x = 1;
const move = (dash = false) => p.update(dt, input, [], dash);
assert.equal(p.dashStock, 3);
for (let i = 0; i < 3; i++) {
  assert.ok(move(true), 'can chain each pip');
  while (p.dashing) move();
}
assert.ok(!move(true), 'empty stamina cannot dash');
const left = p.dashCd;
for (let i = 0; i < Math.ceil(left / dt); i++) move();
assert.equal(p.dashStock, 1, 'only one pip refilled');
assert.ok(p.dashCd > 0);
p.refundDash(true);
p.teleport(0, 0);
const wall = [{ minX: 1.3, maxX: 2, minZ: -5, maxZ: 5 }];
assert.ok(p.update(dt, input, wall, true));
while (p.dashing) {
  p.update(dt, input, wall, false);
  assert.ok(p.x <= wall[0].minX - p.radius + 1e-6);
}
assert.ok(p.x < 0 && p.slideT > 0 && p.hoverT > 0, 'a solid wall redirects the dash into a slide');
move();
assert.ok(p.vel.x < -7, 'slide retains reflected momentum');
input.move.x = 0;
move();
assert.equal(p.slideT, 0, 'release movement to brake');

p.invuln = 0;
const hp = p.hp;
for (const cause of ['Lava', 'Burning ground', 'Lava Slug']) g.hurtHero(h, 8, p.x, p.z, null, cause);
assert.equal(p.hp, hp);
g.hurtHero(h, 8, p.x, p.z, null, 'Enemy fire');
assert.ok(p.hp < hp, 'airborne after dash i-frames still takes a projectile');
while (p.hoverT > 0) move();
p.invuln = 0;
const landingHp = p.hp;
g.hurtHero(h, 8, p.x, p.z, null, 'Lava');
assert.ok(p.hp < landingHp);

p.teleport(0, 0);
const b = g.bullets;
g.enemies.clear();
b.clear();
const shooter = g.enemies.spawn(ENEMIES.shooter, -8, 0, g.spawnOpts({ instant: true }));
const decoy = g.enemies.spawn(ENEMIES.bopper, 3, 0, g.spawnOpts({ instant: true }));
shooter.state = decoy.state = 'move';
g.enemyCtx.fireBullet(shooter, 1, 0, 10, 12);
g.enemyCtx.fireBullet(shooter, 1, 0, 10, 16);
g.enemyCtx.fireBullet(shooter, 1, 0, 10, 20);
b.kill(0); // force a pool swap
for (let i = 0; i < b.count; i++) { b.x[i] = -1; b.z[i] = 0; }
const raw = b.damage[0];
const parryHp = p.hp;
g.tryParry(h);
assert.equal(b.damage[0], Math.fround(raw * 3));
assert.ok(b.vx[0] < 0 && shooter.frozen > 1 && decoy.frozen === 0, 'returns to the actual shooter after compaction');
assert.equal(p.hp, parryHp + handsTuning.parryHeal, 'one heal per swing across a volley');
assert.equal(h.skill.parryT, 6 / 60);
for (let i = 0; i < 6; i++) g.updateSkill(dt);
assert.equal(h.skill.parryT, 0, 'boss and raid checks see the parry expire');
g.enemyCtx.fireBullet(shooter, 1, 0, 10, 12);
b.x[b.count - 1] = -1;
g.updateSkill(dt);
assert.equal(b.team[b.count - 1], Team.Enemy, 'seventh frame is outside the window');

b.clear();
shooter.copyKind = 0;
shooter.copyShots = 3;
shooter.copyRange = shooter.copySpeed = 10;
shooter.copyWidth = 0.25;
shooter.copyDamage = 6;
g.enemyCtx.family!.fire(shooter);
assert.equal(b.count, 3);
for (let i = 0; i < b.count; i++) { b.x[i] = -1; b.z[i] = 0; }
shooter.frozen = h.skill.parryCd = 0;
g.tryParry(h);
assert.ok(shooter.frozen > 1 && b.vx[2] < 0 && b.team[2] === Team.Player, 'all pellets of a copied weapon retain their shooter');

b.clear();
g.enemyCtx.fireBullet(shooter, 1, 0, 20, 12);
b.x[0] = -1.7;
p.dashStock = 0;
g.skillDash(h);
assert.equal(p.dashStock, 1);
assert.equal(g.slowMoT, 0.4);
g.perfectDash(h);
assert.equal(p.dashStock, 1, 'the same dash cannot pay twice');
assert.equal(skillTuning.reflectDmg, 3);

const oldChance = g.rng.chance;
g.rng.chance = () => true;
g.pickups.clear();
h.skill.style.points = styleTuning.thresholds[3];
g.skillKill(shooter, 'buster', h);
assert.equal(g.pickups.count, 1);
assert.equal(g.pickups.type[0], PickupType.Bolt);
assert.equal(g.styleScoreMul(h), 1.5);
g.skillHurt(h);
assert.equal(h.skill.style.rank, 1);
g.skillKill(shooter, 'buster', h);
assert.equal(g.pickups.count, 1);
g.rng.chance = oldChance;

// A client's dash is immediately predicted. An older host snapshot must not
// restore the pip spent on a second dash while its message is still in flight.
b.clear();
const guest = g.makeHero(1, 'Guest', h.unlocked, 'g3-peer');
g.setHeroes([h, guest]);
g.role = 'host';
g.onHostMessage('g3-peer', { t: 'i', x: 0, z: 0, vx: 0, vz: 0, ax: 1, az: 0 });
g.onHostMessage('g3-peer', { t: 'dash' });
assert.equal(guest.player.dashStock, guest.player.dashMax - 1);
assert.ok(guest.player.hoverT > 0);
const count = guest.dashes;
g.onHostMessage('g3-peer', { t: 'dash' });
assert.equal(guest.dashes, count, 'duplicate press during a dash earns no reward');
const snap = g.skillNet(guest);
g.role = 'client';
p.dashSerial = guest.player.dashSerial + 1;
p.hoverT = handsTuning.hoverTime;
p.dashStock = 0;
g.applySkillNet(snap);
assert.equal(p.dashStock, 0);
p.hoverT = 0;
g.applySkillNet(snap);
assert.equal(p.dashStock, guest.player.dashStock);

g.role = 'host';
b.clear();
guest.player.teleport(0, 0);
guest.player.hp = 45;
guest.player.invuln = 0;
guest.stats.armor = 3;
g.enemyCtx.fireBullet(shooter, 1, 0, 10, 12);
b.x[0] = b.z[0] = 0;
p.teleport(20, 20);
const hitRaw = b.damage[0];
g.updateBullets(0);
assert.ok(guest.player.hp < 45, 'remote hit registered before the parry arrives');
noteParryLag(g, guest, 160);
g.tryParry(guest);
assert.equal(b.team[b.count - 1], Team.Player);
assert.equal(b.damage[b.count - 1], Math.fround(hitRaw * 3), 'rewind uses pre-armour projectile damage');
assert.equal(guest.player.hp, 45 + handsTuning.parryHeal);

// Touch feeds standard pad edges. Drive both actions through the real input
// and hero dispatch, including a continued stick movement into a slide.
g.role = 'solo';
g.setHeroes([h]);
g.startRun({ seed: 47, difficulty: 'normal' });
g.closeShop();
input.virtual.active = true;
input.virtual.move.x = 1;
input.virtual.buttons[0] = true;
input.poll();
g.updateHero(h, dt, true);
assert.ok(p.dashing && p.dashStock === 2);
input.endStep();
input.virtual.buttons[0] = false;
input.poll();
while (p.dashing) g.updateHero(h, dt, true);
assert.ok(p.slideT > 0);
input.virtual.buttons[1] = true;
input.poll();
g.skillInput(h, true);
assert.equal(h.skill.parryT, 6 / 60);

await setLanguage('ar');
assert.equal(promptText('dash', 'touch'), 'اندفاع');
assert.equal(promptText('parry', 'touch'), 'صد');
assert.equal(promptText('dash', 'xbox'), 'LB');
console.log('Stamina, movement, hover, parry, loot, input and remote authority passed.');
process.exit(0);
