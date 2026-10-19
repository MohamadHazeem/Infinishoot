/**
 * PvP mode flow (rules in src/game/pvp.ts).
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `pvpBegin = PvpFlow.pvpBegin;`.
 * Rounds, teams, arenas, bots, the scoreboard and the spectator camera live in
 * src/game/systems/pvp2.ts (pvp2 lane).
 */
import type { Game } from '../game';
import { statusTuning, PVP_WAIT_NOTE, clock, playerName } from '../game';
import { saveJson } from '../../core/storage';
import type { Tag } from '../../data/tags';
import { WEAPONS, isRightClick } from '../../data/weapons';
import { type Enemy } from '../enemies';
import { Hero } from '../hero';
import { type DamageOpts } from '../weapons';
import { applyBuild, exportBuild, pvpTuning, teamsFor, roundState, pvpLanding, pvpCarry, pvpFriendly, zoneRadius, zoneDpsAt, DEFAULT_PVP_RULES, type PvpRules } from '../pvp';
import { cleanLook } from '../../data/customise';
import { isBotPeer, botHero, pvpNextRound, pvpRoundOver, pvpDuelStep, pvpMatchEndFx, pvpRulesNote } from './pvp2';
import { hazardAt } from '../hazards';

/** Everyone: play the shared stage alone, keeping the connection open for the duel. */
export function pvpBegin(this: Game, net: 'host' | 'client', seed: number, difficulty: string, rules: PvpRules = DEFAULT_PVP_RULES): void {
  this.pvp = {
    phase: 'stage', net, seed, ready: new Map(), progress: new Map(), proxies: [], acc: [], lastHit: [], zoneR: 0, zoneT: 0, zoneTick: 0,
    rules, teams: [], round: 0, wins: [], arena: '', zoneStart: pvpTuning.zoneStart, countdown: 0, roundEnd: 0, landT: [], stats: [], done: false,
  };
  this.role = 'solo';
  // Solo stage: nothing to replay on clients, so don't pile up effects for the duel's first snapshot.
  this.vfx.recording = false;
  this.vfx.drain();
  this.runMode = 'standard';
  this.hero.name = this.netName || playerName();
  this.startRun({ seed, difficulty });
  this.vfx.banner('PVP · YOUR STAGE', `BEAT THE BOSS AND BUILD UP<br>THEN ${pvpRulesNote(rules)}`, 3);
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
  const rows = this.lobby.map((p) => `${p.name}: ${isBotPeer(p.peerId) ? 'BOT · READY' : pvp.ready.has(p.peerId) ? 'READY' : pvp.progress.get(p.peerId) ?? 'PLAYING'}`);
  this.host?.broadcast({ t: 'pvpstat', rows });
  if (pvp.phase === 'wait') this.screens.showWait(rows, PVP_WAIT_NOTE);
}

/** Host: start the duel once everyone still here has handed in a build (bots build theirs at the start). */
export function pvpCheckReady(this: Game): void {
  const pvp = this.pvp;
  if (!pvp || pvp.net !== 'host' || pvp.phase === 'duel' || pvp.phase === 'over') return;
  if (!this.lobby.every((p) => isBotPeer(p.peerId) || pvp.ready.has(p.peerId))) return;
  this.pvpStartDuel();
}

/** Host: rebuild every hero from its build and drop them all into the first round. */
export function pvpStartDuel(this: Game): void {
  const pvp = this.pvp!;
  pvp.phase = 'duel';
  this.role = 'host';
  this.vfx.drain();
  const levels = [...pvp.ready.values()].map((b) => b.level);
  const avgLevel = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : this.level;
  const heroes = this.lobby.map((p, i) => {
    if (i === 0) return this.hero;
    const h = this.makeHero(i, p.name, p.unlocked.filter((id) => WEAPONS[id]), p.peerId, p.skin, p.pet, p.hero);
    h.player.look = cleanLook(p.look);
    if (isBotPeer(p.peerId)) botHero(this, h, p.loadout, avgLevel);
    else applyBuild(h, pvp.ready.get(p.peerId)!, this.scene);
    return h;
  });
  this.hero.name = this.lobby[0].name;
  this.setHeroes(heroes);
  this.local = 0;
  this.hero.recomputeStats();
  this.hero.player.reset(this.hero.stats);
  for (const h of heroes) {
    h.left = false;
    h.player.showWhenDead = true;
    h.pendingLevels = h.chestsPending = 0;
    // A duel is one life per round: no Second Wind, no pet revive.
    h.revivesLeft = 0;
    h.petState.reviveUsed = true;
  }
  pvp.teams = teamsFor(heroes.length, pvp.rules.format);
  pvp.wins = Array.from({ length: Math.max(...pvp.teams) + 1 }, () => 0);
  pvp.stats = heroes.map(() => ({ dealt: 0, taken: 0, kos: 0, out: false }));
  pvp.round = 0;
  pvp.done = false;
  this.screens.show('none');
  this.hud.setVisible(true);
  for (const h of heroes) {
    if (!h.peerId || isBotPeer(h.peerId)) continue;
    this.host!.send(h.peerId, { t: 'start', seed: pvp.seed, difficulty: this.difficulty.id, you: h.index, players: heroes.map((x) => ({ name: x.name, skin: x.skin.id, pet: x.pet, hero: x.heroDef.id, look: x.player.look })) });
  }
  this.loadStage(1);
  pvpNextRound(this);
}

/** A hit on a hero's stand-in: the attacker's stats, Mods and crits apply, then it's scaled down to hero damage. */
export function pvpHit(this: Game, e: Enemy, base: number, o: DamageOpts, by: Hero): number {
  const pvp = this.pvp;
  const target = this.heroes[e.pvpOwner];
  if (!pvp || pvp.phase !== 'duel' || !target || target === by || target.player.dead || target.left || target.player.dashing) return 0;
  // Friendly fire is off (teams), and nothing counts during the 3-2-1 or after the round is decided.
  if (pvpFriendly(pvp.teams, e.pvpOwner, by.index) || pvp.countdown > 0 || pvp.roundEnd > 0) return 0;
  const tags: readonly Tag[] = o.tags ?? by.tagsOf(o.source) ?? [];
  const crit = !o.fixed && !!o.canCrit && this.rng.chance(by.stats.critChance);
  const ev = { e, source: o.source, tags, dist: Math.hypot(e.x - by.player.x, e.z - by.player.z), crit };
  let amount = o.fixed ? base : by.synergy.damage(ev, base * by.stats.damageMul);
  if (e.exposeT > 0) amount *= 1 + statusTuning.exposeMult;
  if (crit) amount *= by.stats.critMult;
  pvp.acc[target.index] += amount * pvpTuning.damageScale * (pvpTuning.sourceMul[o.source] ?? 1);
  pvp.lastHit[target.index] = by.index;
  if (!o.noStatus) {
    if (isRightClick(o.source)) e.exposeT = statusTuning.exposeTime;
    if (tags.includes('fire')) this.ignite(e, Math.max(3, amount * 0.15), by);
  }
  if (crit) this.vfx.star(target.player.x, 1.4, target.player.z, 1.2, '#fff35c', 0.1);
  return amount;
}

/** Duel step: stand-ins follow their heroes, pending damage lands as hits, the ring closes, rounds turn over. */
export function updateDuel(this: Game, dt: number): void {
  const pvp = this.pvp!;
  pvpDuelStep(this, dt); // bots, the round clock, specials pacing (systems/pvp2.ts)
  if (this.pvp !== pvp || pvp.phase !== 'duel') return;
  const T = pvpTuning;
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
    // Damage lands as hits a few times a second (short i-frames, a cap per second), so no single volley decides a duel.
    pvp.landT[h.index] = (pvp.landT[h.index] ?? 0) - dt;
    if (pvp.acc[h.index] >= 1 && pvp.landT[h.index] <= 0 && h.player.invuln <= 0) {
      const by = this.heroes[pvp.lastHit[h.index]];
      const dmg = pvpLanding(pvp.acc[h.index], h.stats.armor, h.player.maxHp);
      pvp.acc[h.index] = pvpCarry(pvp.acc[h.index], dmg, h.stats.armor, h.player.maxHp);
      pvp.landT[h.index] = T.landEvery;
      const hp0 = h.player.hp;
      this.hurtHero(h, dmg + h.stats.armor, by?.player.x ?? h.player.x, by?.player.z ?? h.player.z, null, by ? by.name : 'Opponent');
      const lost = Math.max(0, hp0 - (h.player.dead ? 0 : h.player.hp));
      if (lost > 0) {
        h.player.invuln = Math.min(h.player.invuln, T.iframes);
        pvp.stats[h.index].taken += lost;
        if (by) pvp.stats[by.index].dealt += lost;
      }
    }
  }
  if (pvp.countdown > 0 || pvp.roundEnd > 0) return;
  // The safe ring closes after a while, then collapses (sudden death); outside it you lose life every second.
  pvp.zoneT += dt;
  pvp.zoneR = zoneRadius(pvp.zoneT, pvp.zoneStart);
  pvp.zoneTick -= dt;
  if (pvp.zoneTick <= 0) {
    pvp.zoneTick = 1;
    const dps = zoneDpsAt(pvp.zoneT, pvp.zoneStart);
    for (const h of this.aliveHeroes) {
      if (Math.hypot(h.player.x, h.player.z) <= pvp.zoneR) continue;
      this.hurtHero(h, h.player.maxHp * dps + h.stats.armor, 0, 0, null, 'The ring');
      h.player.invuln = Math.min(h.player.invuln, T.iframes);
    }
  }
  // Thorn patches scratch (PvP arenas): heroes, unlike enemies, only get scratched.
  if (this.stepN % 30 === 0 && this.arena.hazards.length) {
    for (const h of this.aliveHeroes) {
      const p = h.player;
      if (p.dashing || p.invuln > 0 || hazardAt(this.arena.hazards, p.x, p.z, 'thorns') < 0) continue;
      this.hurtHero(h, p.maxHp * T.thornHero + h.stats.armor, p.x, p.z, null, 'Thorns');
      p.invuln = Math.min(p.invuln, T.iframes);
    }
  }
}

/** Host: at most one team standing: the round is over (the next starts, or the match ends). */
export function pvpCheckWinner(this: Game): void {
  const pvp = this.pvp;
  if (!pvp || pvp.net !== 'host' || pvp.phase !== 'duel') return;
  // Credit knockouts once per hero per round.
  for (const h of this.heroes) {
    const st = pvp.stats[h.index];
    if (!st || st.out || !(h.player.dead || h.left)) continue;
    st.out = true;
    const by = pvp.lastHit[h.index];
    if (by >= 0 && by !== h.index && pvp.stats[by] && !h.left) pvp.stats[by].kos++;
  }
  if (pvp.roundEnd > 0) return;
  const alive = this.aliveHeroes.map((h) => h.index);
  const r = roundState(alive, pvp.teams);
  if (!r.over) return;
  pvpRoundOver(this, r.team);
}

/** Everyone: show the winner, then back to the title a few seconds later. `team`: the winning team (-1 draw). */
export function pvpOver(this: Game, winner: string, team = -2): void {
  const pvp = this.pvp!;
  pvp.phase = 'over';
  this.vfx.banner(winner ? `${winner.toUpperCase()} WINS!` : 'DRAW!', pvp.rules.rounds === 1 ? 'LAST ONE STANDING' : `MATCH OVER · ${pvp.wins.join(' - ')}`, 4);
  this.vfx.flash(0.8);
  this.vfx.sound('legendaryPick', NaN, NaN);
  pvpMatchEndFx(this, team);
  window.setTimeout(() => {
    if (this.pvp !== pvp) return;
    this.leaveToTitle();
    this.hud.toast(winner ? `${winner.toUpperCase()} WON THE DUEL` : 'THE DUEL WAS A DRAW', 4);
  }, 6500);
}

export function saveName(this: Game, name: string): void {
  saveJson('profile', { name: name.trim().slice(0, 12) || 'Player' });
}
