import { modSession } from '../../mods/manager';
import { matchingMods } from '../../mods/registry';
import { t } from '../../i18n';
import { applySecretsNet } from './secrets';
import { applyGauntletNet } from './gauntlet';
import { createMvp, type MvpReport } from './mvp';
import { assistAim } from './aimAssist';
import { applyPvp2Net, pvp2ClientMessage } from './pvp2';
import { cleanRules } from '../pvp';
import { PVP_ARENAS } from '../../data/pvpArenas';
import { applyHalloweenNet, selectSeason, resetHalloween, applyVineGrab } from './halloween';
import { applyMetaSnapshot, MetaRun } from './meta';
/**
 * Online, client side: messages from the host and applying snapshots.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `onClientMessage = NetClient.onClientMessage;`.
 */
import type { Game } from '../game';
import type { BossNet } from '../bossField';
import { Mode, INPUT_EVERY, REVIVE_TIME, PVP_WAIT_NOTE, NetShop } from '../game';
import { MOD_BY_ID } from '../../data/mods';
import { sfx } from '../../audio/sfx';
import { unpackBullets, unpackEnemies, unpackPickups, type NetBytes } from '../../net/codec';
import { Hud, type LoadoutItem } from '../../ui/hud';
import { type Offer, type RunSummary, type ShopFx, type ShopView } from '../../ui/screens';
import { Hero } from '../hero';
import { markSeen, unlockedWeapons } from '../save';
import { settings } from '../settings';
import { cleanLook } from '../../data/customise';
import { decodeFx } from '../../net/fxCodec';
import { SnapDecoder } from '../../net/snapCodec';
import { createWeapon } from '../weapons';
import { syncSub } from '../biomeFoes';
import { FUSION_BY_ID } from '../../data/fusions';
import { showFusionMerge } from '../../ui/fusionUi';
import { DIFF_BY_ID, type DifficultyId } from '../../data/modes';
import { rightClickHeld } from '../chargeMode';
import { onHeartbeat } from '../netFeel';
import { onCoverMsg } from '../coverBreak';
import { applySoundLaneNet } from './sound2';
import { applyNq, clientViewStep, netcodeBullets, netcodeClientMsg, netcodeSnapshot, netcodeStep, snapIfTeleported } from './netcode';
import { applyHeroes3Net, heroes3ClientStep } from './heroes3';
import { hostmigClientMsg, hostmigTick } from './hostmig';

export function onClientMessage(this: Game, m: Record<string, unknown>): void {
  if (netcodeClientMsg(this, m)) return; // probes; flushes the playout buffer before world changes (systems/netcode.ts)
  if (hostmigClientMsg(this, m)) return; // migration snapshots; a host leaving on purpose (systems/hostmig.ts)
  if ((m.t === 'lobby' || m.t === 'start' || m.t === 'pvpgo') && !matchingMods(modSession.hash, m.mods)) {
    this.leaveToTitle();
    this.hud.toast(t('mods.mismatch'), 6);
    return;
  }
  if (this.coopClientMsg(m)) return; // drop-in join, roster changes, ghosts (systems/coop2.ts)
  if (this.lobbyClientMessage(m)) return; // lobby lane: cards, chat, pings, kick, party (systems/party.ts)
  if (this.mpClientMessage(m)) return; // Versus results and order replies (systems/mp.ts)
  if (pvp2ClientMessage(this, m)) return; // PvP rounds, scoreboard, lobby rules (systems/pvp2.ts)
  switch (m.t) {
    case 'lobby': {
      const players = (m.players as { name: string; color: string }[]) ?? [];
      const kind = (['pvp', 'versus', 'weekly'] as const).find((k) => k === m.kind) ?? 'coop';
      this.screens.setLobby({ code: String(m.code ?? ''), players, isHost: false, status: 'Connected! Waiting for the host to start...', difficulty: String(m.difficulty ?? 'normal'), kind, extra: m.mp });
      break;
    }
    case 'pvpgo':
      this.pvpBegin('client', Number(m.seed), String(m.difficulty ?? 'normal'), cleanRules(m.rules, PVP_ARENAS.map((a) => a.id)));
      break;
    case 'pvpstat':
      if (this.pvp?.phase === 'wait') this.screens.showWait((m.rows as string[]) ?? [], PVP_WAIT_NOTE);
      break;
    case 'pvpend':
      if (this.pvp) this.pvpOver(String(m.winner ?? ''), m.team === undefined ? -2 : Number(m.team));
      break;
    case 'full':
      this.leaveToTitle();
      this.hud.toast(String(m.reason ?? 'THAT GAME IS FULL'), 3);
      break;
    case 'start':
      selectSeason.call(this, m.season);
      resetHalloween.call(this);
      this.halloween.earned = this.halloween.banked = Math.max(0, Number(m.candyBaseline) || 0);
      // PvP: the duel starts; from here on this machine mirrors the host like co-op.
      if (this.pvp) {
        this.role = 'client';
        this.pvp.phase = 'duel';
      }
      this.difficulty = DIFF_BY_ID[m.difficulty as DifficultyId] ?? DIFF_BY_ID.normal;
      snapDecoders.get(this)?.reset(); // a new (or re-)joined game: no baselines from an earlier connection
      this.clientStart(Number(m.seed), Number(m.you), (m.players as { name: string }[]) ?? []);
      applyMetaSnapshot(this, m.meta);
      break;
    case 'wchest':
      this.chests.open(Number(m.i));
      break;
    case 'chestspawn':
      this.chests.add(Number(m.x), Number(m.z), Number(m.f));
      break;
    case 'chestitem':
      this.hud.chestReveal(m.item as Parameters<Hud['chestReveal']>[0]);
      break;
    case 'shopfx':
      this.screens.shopFx(m.kind as ShopFx, Number(m.i));
      break;
    case 'chestsgone':
      this.chests.list = [];
      break;
    case 'barrel': {
      const b = this.barrels.remove(Number(m.i));
      if (b) this.removeBarrelCollider(b);
      break;
    }
    case 'stage':
      selectSeason.call(this, m.season);
      this.clientStage(Number(m.stage), Number(m.seed));
      break;
    case 's':
      netcodeSnapshot(this, m); // through the adaptive playout buffer on a real connection (systems/netcode.ts)
      break;
    case 'lv':
      this.screens.showLevelUp(m.offers as Offer[], String(m.title), Number(m.rerolls), m.loadout as LoadoutItem[], Number(m.skip), Number(m.banish ?? -1));
      break;
    case 'shop':
      this.screens.showShop(this.shopFromNet(m.view as NetShop), m.focus === undefined ? undefined : Number(m.focus));
      break;
    case 'wait':
      this.screens.showWait((m.who as string[]) ?? []);
      break;
    case 'route':
      this.routeFromNet(m);
      break;
    case 'go':
      if (['levelup', 'shop', 'relic', 'wait'].includes(this.screens.current)) this.screens.show('none');
      break;
    case 'toast':
      this.hud.toast(String(m.msg));
      break;
    case 'fusefx': {
      const f = FUSION_BY_ID[String(m.id)];
      if (f) showFusionMerge(f.parts, f.id);
      break;
    }
    case 'hurt':
      this.player.knock(Number(m.dx), Number(m.dz));
      this.hud.hurt();
      this.juice.shake(0.35);
      this.juice.kick(Number(m.dx), Number(m.dz), 6);
      sfx.playerHurt();
      break;
    case 'shove':
      this.player.shove(Number(m.dx), Number(m.dz), Number(m.f));
      this.juice.kick(Number(m.dx), Number(m.dz), 4);
      break;
    case 'over':
      this.mode = 'dead';
      this.bankAndShow(m.sum as RunSummary);
      break;
    case 'cover':
      onCoverMsg(this, m);
      break;
    case 'hb':
      onHeartbeat(this, m);
      break;
    case 'end':
      this.leaveToTitle();
      this.hud.toast('THE HOST ENDED THE GAME', 3);
      break;
  }
}

export function shopFromNet(this: Game, v: NetShop): ShopView {
  return {
    ...v,
    offers: v.offers.map((o) => (o && MOD_BY_ID[o.id] ? { def: MOD_BY_ID[o.id], price: o.price, hint: o.hint, locked: o.locked, nums: o.nums } : null)),
    owned: v.owned.filter((o) => MOD_BY_ID[o.id]).map((o) => ({ def: MOD_BY_ID[o.id], sell: o.sell, readout: o.readout, level: o.level, maxLevel: o.maxLevel, upCost: o.upCost })),
  };
}

export function clientStart(this: Game, seed: number, you: number, players: { name: string; skin?: string; pet?: string; hero?: string; look?: string }[]): void {
  this.meta = new MetaRun();
  this.seed = seed;
  const heroes = players.map((p, i) => {
    const h = this.makeHero(i, p.name, i === you ? unlockedWeapons() : [], '', p.skin, p.pet ?? 'none', p.hero ?? 'rookie');
    h.player.look = cleanLook(p.look); // CUSTOMISE (graphics lane); setHeroes applies it
    return h;
  });
  this.setHeroes(heroes);
  this.local = you;
  for (const h of heroes) {
    h.player.showWhenDead = heroes.length > 1;
    h.recomputeStats();
    h.player.reset(h.stats);
  }
  this.score = this.kills = this.combo = 0;
  this.mvp = createMvp();
  this.level = 1;
  this.hud.resetScore();
  this.hud.setVisible(true);
  this.hud.setFade(0);
  this.screens.show('none');
  this.mode = 'fight';
}

export function clientStage(this: Game, stage: number, seed: number): void {
  this.stage = stage;
  this.seed = seed;
  this.loadArena((seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0, stage);
  this.clearWorld();
  this.heroes.forEach((h, i) => {
    const s = this.spawnSpot(i);
    h.player.teleport(s.x, s.z);
  });
  this.fadeT = 0.45;
}

export function clientUpdate(this: Game, dt: number): void {
  netcodeStep(this); // playout clock, quality reports, reconnects (systems/netcode.ts)
  hostmigTick(this); // the host is gone: elect a new one, or take over (systems/hostmig.ts)
  const input = this.input;
  if (this.isCombatMode && this.screens.current === 'none' && (input.keyPressed('Escape') || input.actionPressed('pause') || input.padButtonPressed(9))) {
    this.pause();
    input.endStep();
    return;
  }
  const before = this.screens.current;
  this.screens.update(input, dt);
  if (this.paused && this.screens.current === 'none') this.paused = false;
  if (this.screens.current === 'levelup' && before === 'levelup') {
    for (let k = 0; k < 3; k++) if (input.keyPressed(`Digit${k + 1}`) && this.screens.canPick(k)) this.ui('pick', k);
    if (input.actionPressed('reroll') || input.padButtonPressed(3)) this.ui('reroll');
  }
  this.runTime += dt;
  const h = this.hero;
  const p = h.player;
  const control = this.isCombatMode && !p.dead && this.screens.current === 'none';
  if (control) {
    if (input.device === 'pad') {
      if (input.padAim.x !== 0 || input.padAim.y !== 0) p.setAimDir(input.padAim.x, input.padAim.y);
      else if (input.move.x !== 0 || input.move.y !== 0) p.setAimDir(input.move.x, input.move.y);
    } else if (this.mouseAimPoint()) p.setAimPoint(this.aimHit.x, this.aimHit.z);
  }
  if (control) assistAim.call(this, h, input);
  const wantDash =
    control &&
    (input.actionPressed('dash') || input.padButtonPressed(4) || input.padButtonPressed(6) || input.padButtonPressed(0));
  const moving = this.isCombatMode && this.mode !== 'levelup';
  this.groundAt(p.x, p.z, p.ground);
  if (moving && p.update(dt, control ? input : null, this.arena.colliders, wantDash)) {
    this.client?.send({ t: 'dash' });
    this.juice.shake(0.05);
  }
  if (moving) applyVineGrab(this, this.hero.index, dt);
  if (moving) this.arenaLocal(dt);
  if (moving) this.worldEventLocal(dt);
  if (moving) this.modesLocal(dt); // the rhythm stage's beat keeps moving between snapshots (systems/modes.ts)
  this.biomeFoesClient(dt);
  const wantBomb = control && (input.actionPressed('bomb') || input.mousePressed(1) || input.padButtonPressed(3) || input.padButtonPressed(5));
  if (wantBomb) this.client?.send({ t: 'bomb' });
  this.skillClientInput(control);
  this.companionClientInput(control);
  this.gameplayClientInput(control);
  heroes3ClientStep(this, dt, control, rightClickHeld(input, control)); // the Ronin's own dash-strike (systems/heroes3.ts)
  const padFiring = input.padAim.x !== 0 || input.padAim.y !== 0 || input.padButton(7);
  const firing = control && (input.mouseDown(0) || padFiring || (settings.autoFire && input.device === 'kbm'));
  const charging = rightClickHeld(input, control);
  if (this.stepN % INPUT_EVERY === 0 && this.client) {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.client.send({ t: 'i', x: r2(p.x), z: r2(p.z), vx: r2(p.vel.x), vz: r2(p.vel.z), ax: r2(p.aim.x), az: r2(p.aim.z), ad: Number.isFinite(p.aimDist) ? r2(p.aimDist) : -1, f: firing, c: charging, d: p.dashing, vt: clientViewStep(this) });
  }
  if (this.mode !== 'levelup' && this.mode !== 'shop') {
    this.bullets.integrate(dt);
    for (let i = 0; i < this.bullets.count; i++) if (this.bullets.life[i] <= 0) this.bullets.kill(i--);
  }
  this.particles.update(dt);
  this.fx.update(dt);
  if (this.fadeT > 0) this.fadeT -= dt;
  input.endStep();
}

/** Snapshot decoders (they keep the baselines the host's deltas refer to), one per game. */
const snapDecoders = new WeakMap<Game, SnapDecoder>();

export function applySnapshot(this: Game, m: Record<string, unknown>): void {
  let dec = snapDecoders.get(this);
  if (!dec) snapDecoders.set(this, (dec = new SnapDecoder()));
  const s = dec.decode(m);
  const now = performance.now();
  if (this.snapTime) this.snapInterval += (Math.min(200, now - this.snapTime) - this.snapInterval) * 0.2;
  this.snapTime = now;
  applyMetaSnapshot(this, s.meta);
  applyHalloweenNet.call(this, s.ha);
  const prevMode = this.mode;
  this.mode = s.mode as Mode;
  if (this.mode === 'transition' && prevMode !== 'transition') this.fadeT = 0;
  this.stage = Number(s.stage);
  this.netTimeLeft = Number(s.tl);
  this.netBoss = (s.boss as { name: string; hp01: number }) ?? null;
  const team = s.team as Record<string, number>;
  this.level = team.level;
  this.xp = team.xp01 * 100;
  this.xpNext = 100;
  this.score = team.score;
  this.combo = team.combo;
  this.netCombo01 = team.combo01;
  this.kills = team.kills;
  this.runTime = team.time;
  this.curses = (s.cu as string[]) ?? [];
  this.netEvent = (s.sev as [string, number] | null) ?? null;
  this.netChallenge = (s.sch as [string, number, number, boolean] | null) ?? null;
  this.netBuffs = (s.bf as [number, number]) ?? [0, 0];

  // Heroes
  for (const hs of s.heroes as Record<string, unknown>[]) {
    const h = this.heroes[Number(hs.i)];
    if (!h) continue;
    const p = h.player;
    const wasDead = p.dead;
    p.dead = !!hs.dead;
    h.left = !!hs.left;
    p.hp = Number(hs.hp);
    h.stats.maxHp = Number(hs.mhp);
    h.reviveT = Number(hs.rv) * REVIVE_TIME;
    h.stats.areaMul = Number(hs.area);
    if (h === this.hero) {
      p.invuln = Math.max(p.invuln, Number(hs.inv));
      if (!p.dead && wasDead) p.rig.root.visible = true;
      p.recoil = Math.max(p.recoil, Number(hs.rec));
    } else {
      p.netSet(Number(hs.x), Number(hs.z), Number(hs.vx), Number(hs.vz), Number(hs.ax), Number(hs.az), !!hs.dash);
      snapIfTeleported(p.prev, p.pos); // a respawn or jump pad landing: no slide across the map
      p.invuln = Number(hs.inv);
      p.recoil = Number(hs.rec);
      p.hurtFlash = Number(hs.hf);
      if (!p.dead) p.rig.root.visible = true;
    }
    this.syncWeapons(h, hs.w as (string | number)[][]);
    h.relics = (hs.rl as string[]) ?? [];
    this.applyHeroMechNet(h, hs.tw);
    this.applyGpHeroNet(h, hs.gp);
  }

  // Private info for this machine's hero
  const you = s.you as Record<string, unknown>;
  const h = this.hero;
  h.gold = Number(you.gold);
  h.rerollsLeft = Number(you.gears ?? 0);
  const sp = you.special as [string, number, string] | undefined;
  if (sp && sp[0] !== h.special.id) h.setSpecial(sp[0]);
  if (sp && sp[1] !== h.special.level) {
    h.special.level = sp[1];
    h.loadoutDirty = true;
  }
  if (sp?.[2]) h.setSpecialBuild(sp[2]);
  h.bombCharge = Number(you.bomb);
  this.netMods = (you.mods as { id: string; ro: string; lv?: number }[]) ?? [];
  const passives = (you.passives as Record<string, number>) ?? {};
  if (JSON.stringify(passives) !== JSON.stringify(h.passives)) {
    h.passives = passives;
    h.loadoutDirty = true;
  }
  Object.assign(h.stats, you.stats as object);

  // Enemies: create, update or remove mirrors by uid.
  const seen = new Set<number>();
  unpackEnemies(s.en as NetBytes, (r) => {
    seen.add(r.uid);
    let e = this.netEnemies.get(r.uid);
    if (!e || !e.active) {
      e = this.enemies.spawn(r.def, r.x, r.z, { instant: true, elite: r.elite, eliteMod: r.eliteMod ?? undefined });
      markSeen(r.def.id);
      this.netEnemies.set(r.uid, e);
      e.px = r.x;
      e.pz = r.z;
    } else {
      e.px = e.x;
      e.pz = e.z;
    }
    e.x = r.x;
    e.z = r.z;
    if (Math.abs(e.x - e.px) > 6 || Math.abs(e.z - e.pz) > 6) {
      e.px = e.x; // teleported (blink, recycled ahead of the team): snap, don't slide
      e.pz = e.z;
    }
    e.state = r.state;
    e.t = r.t;
    e.facing = r.facing;
    e.sq = r.sq;
    e.hopY = r.hopY;
    e.hp = r.hp01 * e.maxHp; // drives elite health bars
    e.frozen = r.frozen ? 1 : 0;
    if (e.def.boss && this.netBoss) e.phase = this.netBoss.hp01 < 0.33 ? 3 : this.netBoss.hp01 < 0.66 ? 2 : 1;
    e.shield = r.shield ? 1 : 0;
    e.aiBits = r.ai;
    e.familyState = r.familyState;
    e.copyKind = r.copyKind;
    e.copyFlash = r.copyFlash ? 1 : 0;
    e.copyShots = r.copyShots;
    e.copyRange = r.copyRange;
    e.copyArc = r.copyArc;
    e.copyWidth = r.copyWidth;
    e.burnT = r.burn ? 1 : 0;
    e.shockT = r.shock ? 1 : 0;
    e.flash = r.flash ? 0.07 : 0;
    e.action = r.action;
    if (e.def.biomes && e.sub !== r.sub) {
      e.sub = r.sub;
      syncSub(e);
    }
    e.lungeX = Math.sin(r.lunge);
    e.lungeZ = Math.cos(r.lunge);
    e.targetX = r.targetX;
    e.targetZ = r.targetZ;
  });
  for (const [uid, e] of this.netEnemies) {
    if (seen.has(uid)) continue;
    this.enemies.kill(e);
    this.netEnemies.delete(uid);
  }
  this.applyBossNet(s.bx as BossNet | undefined);
  this.applyGameplayNet(s.gpw);

  if (s.bd) netcodeBullets(this, s.bd as NetBytes); // bullet deltas (src/net/bulletCodec.ts)
  else if (s.bu) unpackBullets(s.bu as NetBytes, this.bullets);
  applyNq(this, s.nq);
  unpackPickups(s.pk as NetBytes, this.pickups);
  if (s.fx) decodeFx(s.fx as NetBytes, (e) => this.vfx.apply(e));
  this.applySkillNet(s.sk);
  this.applyCompanionNet(s.cp);
  this.applyTimeNet(s.tm);
  this.applyCoopNet(s.co);
  this.applyCineNet(s.cn);
  this.applyVersusNet(s.vs);

  this.arenaSetNet(s.ar as Record<string, unknown> | undefined);
  this.applyDirector2Net(s.d2);
  this.applyWorldEventNet(s.we, s.wt);
  applyGauntletNet(this, s.gl);
  this.applyModesNet(s.md);
  applySoundLaneNet(this, s.s2);
  applySecretsNet(this, s.ss);
  if (s.mvp) this.mvp.report = s.mvp as MvpReport; // the reliable over message opens the screen
  applyHeroes3Net(this, s.h3); // Tinker bots (systems/heroes3.ts)
  applyPvp2Net(this, s.p2); // PvP rounds, teams and ring (systems/pvp2.ts)
  const portal = s.portal as [number, number] | null;
  if (portal && !this.portal.active) this.portal.open(portal[0], portal[1]);
  else if (!portal && this.portal.active) this.portal.close();
}

/** Client: mirror a hero's weapon list (ids/levels) and visual state. */
export function syncWeapons(this: Game, h: Hero, list: (string | number)[][]): void {
  let changed = h.weapons.length !== list.length;
  for (let i = 0; i < list.length; i++) {
    const [id, level, ready, key, ...state] = list[i] as [string, number, number, string, ...number[]];
    let w = h.weapons[i];
    if (!w || w.def.id !== id) {
      w?.dispose();
      w = createWeapon(id, this.scene);
      h.weapons[i] = w;
      changed = true;
    }
    if (w.build) {
      if (w.buildKey !== key) {
        w.setBuildKey(key);
        changed = true;
      }
    } else if (w.level !== level) {
      w.level = level;
      changed = true;
    }
    w.ready = ready;
    w.setNet(state);
  }
  while (h.weapons.length > list.length) h.weapons.pop()!.dispose();
  if (changed) h.loadoutDirty = true;
}
