/**
 * PvP mode flow (rules in src/game/pvp.ts).
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `pvpBegin = PvpFlow.pvpBegin;`.
 */
import type { Game } from '../game';
import { statusTuning, PVP_WAIT_NOTE, clock, playerName } from '../game';
import { saveJson } from '../../core/storage';
import type { Tag } from '../../data/tags';
import { WEAPONS, isRightClick } from '../../data/weapons';
import { type Enemy } from '../enemies';
import { Hero } from '../hero';
import { type DamageOpts } from '../weapons';
import { PVP_TARGET, applyBuild, exportBuild, pvpTuning } from '../pvp';
import { cleanLook } from '../../data/customise';

/** Everyone: play the shared stage alone, keeping the connection open for the duel. */
export function pvpBegin(this: Game, net: 'host' | 'client', seed: number, difficulty: string): void {
  this.pvp = { phase: 'stage', net, seed, ready: new Map(), progress: new Map(), proxies: [], acc: [], lastHit: [], zoneR: 0, zoneT: 0, zoneTick: 0 };
  this.role = 'solo';
  // Solo stage: nothing to replay on clients, so don't pile up effects for the duel's first snapshot.
  this.vfx.recording = false;
  this.vfx.drain();
  this.runMode = 'standard';
  this.hero.name = this.netName || playerName();
  this.startRun({ seed, difficulty });
  this.vfx.banner('PVP · YOUR STAGE', 'BEAT THE BOSS AND BUILD UP<br>THEN FIGHT EVERYONE ELSE', 3);
}

/** Your stage is over (boss beaten and shop closed, or you died): send your build and wait. */
export function pvpStageDone(this: Game): void {
  const pvp = this.pvp!;
  pvp.phase = 'wait';
  const build = exportBuild(this.hero, this.level);
  this.mode = 'title';
  this.screens.showWait([`${this.hero.name}: READY`], PVP_WAIT_NOTE);
  if (pvp.net === 'client') this.client?.send({ t: 'pvpready', build });
  else {
    pvp.ready.set('', build);
    this.pvpCheckReady();
  }
}

/** Every second: progress for the waiting screen (clients report it, the host shares the list). */
export function pvpTick(this: Game): void {
  const pvp = this.pvp!;
  if (this.stepN % 60 !== 0 || (pvp.phase !== 'stage' && pvp.phase !== 'wait')) return;
  const mine = pvp.phase === 'wait' ? 'READY' : `LV ${this.level} · ${this.boss ? 'BOSS FIGHT' : clock(this.director.duration - this.director.time) + ' LEFT'}`;
  if (pvp.net === 'client') {
    this.client?.send({ t: 'pvpprog', text: mine });
    return;
  }
  pvp.progress.set('', mine);
  const rows = this.lobby.map((p) => `${p.name}: ${pvp.ready.has(p.peerId) ? 'READY' : pvp.progress.get(p.peerId) ?? 'PLAYING'}`);
  this.host?.broadcast({ t: 'pvpstat', rows });
  if (pvp.phase === 'wait') this.screens.showWait(rows, PVP_WAIT_NOTE);
}

/** Host: start the duel once everyone still here has handed in a build. */
export function pvpCheckReady(this: Game): void {
  const pvp = this.pvp;
  if (!pvp || pvp.net !== 'host' || pvp.phase === 'duel' || pvp.phase === 'over') return;
  if (!this.lobby.every((p) => pvp.ready.has(p.peerId))) return;
  this.pvpStartDuel();
}

/** Host: rebuild every hero from its build and drop them all into one arena. */
export function pvpStartDuel(this: Game): void {
  const pvp = this.pvp!;
  pvp.phase = 'duel';
  this.role = 'host';
  this.vfx.drain();
  const heroes = this.lobby.map((p, i) => {
    if (i === 0) return this.hero;
    const h = this.makeHero(i, p.name, p.unlocked.filter((id) => WEAPONS[id]), p.peerId, p.skin, p.pet, p.hero);
    h.player.look = cleanLook(p.look);
    applyBuild(h, pvp.ready.get(p.peerId)!, this.scene);
    return h;
  });
  this.hero.name = this.lobby[0].name;
  this.setHeroes(heroes);
  this.local = 0;
  this.hero.recomputeStats();
  this.hero.player.reset(this.hero.stats);
  this.hero.revivesLeft = pvp.ready.get('')?.revives ?? this.hero.revivesLeft;
  for (const h of heroes) {
    h.left = false;
    h.player.showWhenDead = true;
    h.pendingLevels = h.chestsPending = 0;
    h.bombCharge = 1;
  }
  this.screens.show('none');
  this.hud.setVisible(true);
  for (const h of heroes) {
    if (!h.peerId) continue;
    this.host!.send(h.peerId, { t: 'start', seed: pvp.seed, difficulty: this.difficulty.id, you: h.index, players: heroes.map((x) => ({ name: x.name, skin: x.skin.id, pet: x.pet, hero: x.heroDef.id, look: x.player.look })) });
  }
  this.loadStage(1);
  this.enemies.clear();
  this.pickups.clear?.();
  // Heroes start spread on a circle facing the middle, each with an invisible stand-in the others can hit.
  pvp.proxies = [];
  heroes.forEach((h, i) => {
    const a = (i / heroes.length) * Math.PI * 2;
    h.player.teleport(Math.cos(a) * pvpTuning.spawnRadius, Math.sin(a) * pvpTuning.spawnRadius);
    h.player.setAimDir(-Math.cos(a), -Math.sin(a));
    const e = this.enemies.spawn(PVP_TARGET, h.player.x, h.player.z, { instant: true });
    e.pvpOwner = h.index;
    pvp.proxies[h.index] = e;
  });
  pvp.acc = heroes.map(() => 0);
  pvp.lastHit = heroes.map(() => -1);
  pvp.zoneR = pvpTuning.zoneStart;
  pvp.zoneT = pvp.zoneTick = 0;
  this.vfx.banner('DUEL!', 'LAST ONE STANDING WINS<br>THE RED RING CLOSES IN', 2.8);
  this.vfx.sound('boss', NaN, NaN);
}

/** A hit on a hero's stand-in: the attacker's stats, Mods and crits apply, then it's scaled down to hero damage. */
export function pvpHit(this: Game, e: Enemy, base: number, o: DamageOpts, by: Hero): number {
  const pvp = this.pvp;
  const target = this.heroes[e.pvpOwner];
  if (!pvp || pvp.phase !== 'duel' || !target || target === by || target.player.dead || target.left || target.player.dashing) return 0;
  const tags: readonly Tag[] = o.tags ?? by.tagsOf(o.source) ?? [];
  const crit = !o.fixed && !!o.canCrit && this.rng.chance(by.stats.critChance);
  const ev = { e, source: o.source, tags, dist: Math.hypot(e.x - by.player.x, e.z - by.player.z), crit };
  let amount = o.fixed ? base : by.synergy.damage(ev, base * by.stats.damageMul);
  if (e.exposeT > 0) amount *= 1 + statusTuning.exposeMult;
  if (crit) amount *= by.stats.critMult;
  pvp.acc[target.index] += amount * pvpTuning.damageScale;
  pvp.lastHit[target.index] = by.index;
  if (!o.noStatus) {
    if (isRightClick(o.source)) e.exposeT = statusTuning.exposeTime;
    if (tags.includes('fire')) this.ignite(e, Math.max(3, amount * 0.15), by);
  }
  if (crit) this.vfx.star(target.player.x, 1.4, target.player.z, 1.2, '#fff35c', 0.1);
  return amount;
}

/** Duel step: stand-ins follow their heroes, pending damage lands as hits, the ring closes. */
export function updateDuel(this: Game, dt: number): void {
  const pvp = this.pvp!;
  for (const h of this.heroes) {
    const e = pvp.proxies[h.index];
    if (!e) continue;
    if (h.player.dead || h.left) {
      if (e.active) this.enemies.kill(e);
      pvp.acc[h.index] = 0;
      continue;
    }
    e.x = e.px = h.player.x;
    e.z = e.pz = h.player.z;
    e.vx = e.vz = e.kx = e.kz = 0;
    e.hp = e.maxHp;
    e.frozen = 0;
    // Damage lands as hits, so i-frames and the per-hit cap pace a duel instead of one volley deciding it.
    if (pvp.acc[h.index] >= 1 && h.player.invuln <= 0) {
      const by = this.heroes[pvp.lastHit[h.index]];
      const raw = pvp.acc[h.index];
      pvp.acc[h.index] = 0;
      this.hurtHero(h, raw, by?.player.x ?? h.player.x, by?.player.z ?? h.player.z, null, by ? by.name : 'Opponent');
    }
  }
  // The safe ring closes after a while; outside it you lose life every second.
  pvp.zoneT += dt;
  if (pvp.zoneT > pvpTuning.zoneDelay) pvp.zoneR = Math.max(pvpTuning.zoneMin, pvp.zoneR - pvpTuning.zoneSpeed * dt);
  if (this.stepN % 12 === 0) this.vfx.ring(0, 0, pvp.zoneR * 2, 1.01, '#b13e53', 0.25); // ring sizes are diameters
  pvp.zoneTick -= dt;
  if (pvp.zoneTick <= 0) {
    pvp.zoneTick = 1;
    for (const h of this.aliveHeroes) {
      if (Math.hypot(h.player.x, h.player.z) <= pvp.zoneR) continue;
      this.hurtHero(h, h.player.maxHp * pvpTuning.zoneDps + h.stats.armor, 0, 0, null, 'The ring');
    }
  }
}

/** Host: one hero left (or none): that's the match. */
export function pvpCheckWinner(this: Game): void {
  const pvp = this.pvp;
  if (!pvp || pvp.net !== 'host' || pvp.phase !== 'duel') return;
  const alive = this.aliveHeroes;
  if (alive.length > 1) return;
  const name = alive[0]?.name ?? '';
  this.host?.broadcast({ t: 'pvpend', winner: name });
  this.pvpOver(name);
}

/** Everyone: show the winner, then back to the title a few seconds later. */
export function pvpOver(this: Game, winner: string): void {
  const pvp = this.pvp!;
  pvp.phase = 'over';
  this.vfx.banner(winner ? `${winner.toUpperCase()} WINS!` : 'DRAW!', 'LAST ONE STANDING', 4);
  this.vfx.flash(0.8);
  this.vfx.sound('legendaryPick', NaN, NaN);
  window.setTimeout(() => {
    if (this.pvp !== pvp) return;
    this.leaveToTitle();
    this.hud.toast(winner ? `${winner.toUpperCase()} WON THE DUEL` : 'THE DUEL WAS A DRAW', 4);
  }, 4500);
}

export function saveName(this: Game, name: string): void {
  saveJson('profile', { name: name.trim().slice(0, 12) || 'Player' });
}
