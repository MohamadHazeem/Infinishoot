/**
 * Level-ups: team XP, level-up cards and picks for every hero.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `gainXp = LevelUps.gainXp;`.
 */
import type { Game } from '../game';
import { scoreTuning, xpForLevel, NetShop } from '../game';
import { type ShopFx } from '../../ui/screens';
import { Hero } from '../hero';
import { activeCombos } from '../../data/weaponCombos';

export function gainXp(this: Game, v: number): void {
  this.xp += v;
  while (this.xp >= this.xpNext) {
    this.xp -= this.xpNext;
    this.level++;
    this.xpNext = xpForLevel(this.level);
    for (const h of this.heroes) {
      if (h.left) continue;
      h.pendingLevels++;
      h.synergy.levelUp();
      // Every level-up tops you up a little (downed heroes stay down).
      if (!h.player.dead) {
        const healed = h.player.heal(scoreTuning.levelUpHeal);
        if (healed > 0) this.vfx.num(h.player.x, 2.4, h.player.z, `+${Math.round(healed)}`, 'heal');
      }
    }
  }
}

export function openLevelUp(this: Game): void {
  if (this.mode !== 'levelup') this.resumeMode = this.mode;
  this.mode = 'levelup';
  this.vfx.sound('levelUp', NaN, NaN);
  for (const h of this.heroes) {
    if (h.left) continue;
    if (h.needsPick) {
      h.offers = h.buildOffers();
      this.presentLevelUp(h);
    } else this.presentWait(h);
  }
}

export function presentLevelUp(this: Game, h: Hero): void {
  const view = { offers: h.offers, title: h.levelUpTitle(this.level), rerolls: h.rerollsLeft, loadout: h.loadout(), skip: h.skipGold };
  if (h === this.hero) this.screens.showLevelUp(view.offers, view.title, view.rerolls, view.loadout, view.skip);
  else this.tell(h, { t: 'lv', ...view });
}

export function presentWait(this: Game, h: Hero): void {
  const who = this.heroes.filter((x) => !x.left && (this.mode === 'shop' ? !x.shopDone : x.needsPick)).map((x) => x.name);
  if (h === this.hero) this.screens.showWait(who);
  else this.tell(h, { t: 'wait', who });
}

export function presentShop(this: Game, h: Hero, focus?: number): void {
  if (h === this.hero) {
    this.screens.showShop(h.shopView(this.stage, this.preShop), focus);
    return;
  }
  const v = h.shopView(this.stage, this.preShop);
  const net: NetShop = {
    ...v,
    offers: v.offers.map((o) => (o ? { id: o.def.id, price: o.price, hint: o.hint } : null)),
    owned: v.owned.map((o) => ({ id: o.def.id, sell: o.sell, readout: o.readout, level: o.level, maxLevel: o.maxLevel, upCost: o.upCost })),
  };
  this.tell(h, { t: 'shop', view: net, focus });
}

/** Send a message to a hero's player (no-op for the local hero). */
export function tell(this: Game, h: Hero, msg: unknown): void {
  if (h.peerId && this.host) this.host.send(h.peerId, msg);
}

/** Menu actions from this machine: applied directly, or sent to the host. */
export function ui(this: Game, a: string, i = 0, d: -1 | 1 = 1): void {
  if (this.role === 'client') {
    this.client?.send({ t: 'ui', a, i, d });
    return;
  }
  this.heroAction(this.hero, a, i, d);
}

/** Level-up and shop actions for any hero (host authority). */
export function heroAction(this: Game, h: Hero, a: string, i: number, d: -1 | 1): void {
  if (this.mode === 'levelup' && h.needsPick) {
    if (a === 'pick') {
      const o = h.offers[i];
      if (!o) return;
      const color = h.applyOffer(o);
      h.consumePick();
      if (h === this.hero && (o.kind === 'evo' || o.kind === 'track')) this.checkAchievements();
      this.vfx.sound('powerUp', h.player.x, h.player.z);
      if (o.kind === 'evolve') this.evolveFx(h, o.name, color);
      else if (o.rarity === 'legendary') this.legendaryFx(h, o.name);
      this.afterPick(h, color);
    } else if (a === 'skip') {
      const g = h.skipGold;
      h.gold += g;
      h.consumePick();
      this.vfx.num(h.player.x, 2.6, h.player.z, `+${g}●`, 'score');
      this.vfx.sound('coin', h.player.x, h.player.z);
      this.afterPick(h, '#ffb627');
    } else if (a === 'reroll' && h.rerollsLeft > 0) {
      h.rerollsLeft--;
      h.offers = h.buildOffers();
      this.presentLevelUp(h);
    }
    return;
  }
  if (this.mode === 'shop' && !h.shopDone) {
    let err = '';
    if (a === 'buy') err = h.buy(i);
    else if (a === 'sell') err = h.sell(i);
    else if (a === 'move') h.moveMod(i, d);
    else if (a === 'mup') err = h.upgradeMod(i);
    else if (a === 'sreroll') err = h.reroll();
    else if (a === 'heal') err = h.heal();
    else if (a === 'curse') err = this.takeCurse(h);
    else if (a === 'relic') {
      err = h.buyRelic();
      if (!err) this.vfx.sound('chest', h.player.x, h.player.z);
    }
    else if (a === 'done') {
      h.shopDone = true;
      if (this.heroes.every((x) => x.left || x.shopDone)) this.closeShop();
      else for (const x of this.heroes) if (x.shopDone && !x.left) this.presentWait(x);
      return;
    }
    if (err) {
      if (h === this.hero) this.hud.toast(err);
      else this.tell(h, { t: 'toast', msg: err });
      this.shopFx(h, 'deny');
      return;
    }
    this.presentShop(h, a === 'buy' ? i : undefined);
    const fx = ({ buy: 'buy', sell: 'sell', sreroll: 'reroll', heal: 'heal', mup: 'upgrade' } as Record<string, ShopFx>)[a];
    if (fx) this.shopFx(h, fx, i);
  }
}

/** The big moment when a weapon evolves (level-up card or chest). */
export function evolveFx(this: Game, h: Hero, name: string, color: string): void {
  const p = h.player;
  this.vfx.ring(p.x, p.z, 1, 9, color, 0.5);
  this.vfx.ring(p.x, p.z, 0.6, 6, '#ffffff', 0.35);
  this.vfx.burst(p.x, 1, p.z, { count: 40, color, color2: '#ffcd75', speed: [4, 10], size: [0.14, 0.34], life: [0.5, 1], up: 8, gravity: 10 });
  this.vfx.shake(p.x, p.z, 0.35);
  this.vfx.flash(0.35);
  this.vfx.sound('evolve', NaN, NaN);
  h.player.happyT = 2.5;
  if (h === this.hero) this.input.rumble(0.4, 0.9, 500);
  this.vfx.banner('EVOLUTION!', (this.role === 'solo' ? '' : `${h.name.toUpperCase()}: `) + name.toUpperCase(), 1.8);
}

/** Picking a legendary: fanfare, golden fountain and a team-wide banner. */
export function legendaryFx(this: Game, h: Hero, name: string): void {
  const p = h.player;
  this.vfx.sound('legendaryPick', p.x, p.z);
  this.legendaryBurst(h);
  this.vfx.banner('LEGENDARY!', this.heroes.length > 1 ? `${h.name}: ${name}` : name, 1.8);
}

/** Golden fountain, rings and shake around a hero. */
export function legendaryBurst(this: Game, h: Hero): void {
  const p = h.player;
  this.vfx.burst(p.x, 1, p.z, { count: 60, color: '#ffcd75', color2: '#ffffff', speed: [4, 12], size: [0.15, 0.4], life: [0.6, 1.2], up: 12, gravity: 9 });
  this.vfx.ring(p.x, p.z, 1, 14, '#ffcd75', 0.6);
  this.vfx.ring(p.x, p.z, 1, 9, '#ef7d57', 0.45);
  this.vfx.shake(p.x, p.z, 0.6);
}

export function afterPick(this: Game, h: Hero, color: string): void {
  const p = h.player;
  p.happyT = 1.4;
  for (const c of activeCombos(h.weapons.map((w) => w.def.id))) {
    if (h.combosSeen.has(c.id)) continue;
    h.combosSeen.add(c.id);
    this.vfx.banner(`COMBO: ${c.name.toUpperCase()}!`, c.desc.toUpperCase(), 2.2);
    this.vfx.sound('jingle', NaN, NaN);
  }
  this.vfx.burst(p.x, 1, p.z, { count: 20, color, color2: '#ffffff', speed: [3, 8], size: [0.12, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
  this.checkAchievements();
  if (h.needsPick) {
    h.offers = h.buildOffers();
    this.presentLevelUp(h);
    return;
  }
  if (this.heroes.some((x) => !x.left && x.needsPick)) {
    for (const x of this.heroes) if (!x.left && !x.needsPick) this.presentWait(x);
    return;
  }
  // Everyone has picked: back to the action with a short grace for each hero.
  this.screens.show('none');
  for (const x of this.heroes) this.tell(x, { t: 'go' });
  this.mode = this.resumeMode;
  for (const x of this.aliveHeroes) {
    const q = x.player;
    q.invuln = Math.max(q.invuln, 0.6);
    this.vfx.ring(q.x, q.z, 1, 8, color, 0.35);
    for (const e of this.enemiesInRadius(q.x, q.z, 4, this.scratch)) {
      const dd = Math.hypot(e.x - q.x, e.z - q.z) || 1;
      e.kx += ((e.x - q.x) / dd) * 14 * (1 - e.def.knockbackResist);
      e.kz += ((e.z - q.z) / dd) * 14 * (1 - e.def.knockbackResist);
    }
  }
}
