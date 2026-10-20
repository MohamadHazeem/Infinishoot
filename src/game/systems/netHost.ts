import { architectNet } from './architect';
import { weather2Net } from './weather2';
import { trialsNet } from './trials';
import { modSession } from '../../mods/manager';
import { matchingMods } from '../../mods/registry';
import { en } from '../../i18n/en';
import { secretsNet } from './secrets';
import { halloweenNet, cleanHalloweenLook } from './halloween';
import { gauntletNet } from './gauntlet';
import { pvp2Net, isBotPeer } from './pvp2';
import { metaSkin } from '../../data/codex';
/**
 * Online, host side: messages from clients and snapshots.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `heroByPeer = NetHost.heroByPeer;`.
 */
import { cleanSummary } from '../../data/profile';
import type { Game } from '../game';
import { scoreTuning, SNAP_EVERY, INTEREST, REVIVE_TIME } from '../game';
import { buildKey } from '../../data/tracks';
import { validLoadout, type Loadout } from '../../data/loadout';
import { packEnemies, packPickups } from '../../net/codec';
import { Hero } from '../hero';
import { playerTuning } from '../player';
import { unlockedWeapons } from '../save';
import { Vfx, type VfxEvent } from '../vfx';
import { FxEncoder, fxRelevant } from '../../net/fxCodec';
import { SnapEncoder } from '../../net/snapCodec';
import { skinOf } from '../../data/skins';
import { cleanLook } from '../../data/customise';
import { heroOf } from '../../data/heroes';
import { type HeroBuild } from '../pvp';
import { noteParryLag } from '../netFeel';
import { soundLaneNet } from './sound2';
import { netcodeHello, netcodeHostMsg, netcodeNote, netcodeStep, netNq, noteViewStep, remoteButtonsIn } from './netcode';
import { heroes3Net, heroes3StrikeMsg } from './heroes3';
import { coopPlayMessage, coopPlayNet } from './coopplay';
import { lobbyCap } from '../eightp';
import { eightpSnapTick, heroWeaponsFor } from './eightp';
import { voiceHostMsg } from './voicechat';
import { spectateHostMessage, spectateHostStep, spectateLeft, spectateNet, spectateSend, type SnapView } from './spectate';

/** Snapshot encoders, one per client hero (they keep that client's baselines), and one effects encoder. */
const snapEncoders = new WeakMap<Hero, SnapEncoder>();
const fxEncoder = new FxEncoder();

/** A hero's player reconnected (coop2 lane): forget that client's baselines so the next snapshot is a keyframe. */
export function resetSnapFor(h: Hero): void {
  snapEncoders.delete(h);
}

export function heroByPeer(this: Game, id: string): Hero | undefined {
  return this.heroes.find((h) => h.peerId === id);
}

export function onHostMessage(this: Game, from: string, m: Record<string, unknown>): void {
  // Check before lobby profile bookkeeping AND drop-in/reconnect admission.
  if (m.t === 'hello' && !matchingMods(modSession.hash, m.mods)) {
    this.host?.send(from, { t: 'full', reason: en['mods.mismatch'] });
    const host = this.host;
    setTimeout(() => host?.kick(from), 250);
    return;
  }
  if (voiceHostMsg(this, from, m)) return; // voice chat roster (systems/voicechat.ts)
  if (spectateHostMessage(this, from, m)) return; // spectator seats, views, emotes, play next stage (systems/spectate.ts)
  if (this.lobbyHostMessage(from, m)) return; // lobby lane: ready, chat, pings, party votes, kicked players (systems/party.ts)
  if (m.t === 'pvpready' && this.pvp) {
    this.pvp.ready.set(from, m.build as HeroBuild);
    this.pvpCheckReady();
    return;
  }
  if (m.t === 'pvpprog' && this.pvp) {
    this.pvp.progress.set(from, String(m.text ?? '').slice(0, 40));
    return;
  }
  if (m.t === 'hello') {
    netcodeHello(this, from, m); // remember the player id; a reconnect drops its stale old connection (systems/netcode.ts)
    this.tradingHello(from, m); // the player's co-op title (systems/trading.ts)
    if (this.coopHello(from, m)) return; // a run in progress: drop-in join (systems/coop2.ts)
    if (this.mode !== 'title' || this.pvp || this.lobby.some((p) => p.peerId === from) || this.lobby.length >= lobbyCap(this.lobbyKind)) {
      this.host?.send(from, { t: 'full', reason: this.mode === 'title' && !this.pvp && this.lobby.length >= lobbyCap(this.lobbyKind) ? 'That game is full.' : 'Game already started.' });
      return;
    }
    this.lobby.push({
      peerId: from,
      name: String(m.name ?? 'Player').slice(0, 12),
      unlocked: Array.isArray(m.unlocked) ? (m.unlocked as string[]) : unlockedWeapons(),
      loadout: validLoadout(m.loadout as Partial<Loadout>),
      skin: (metaSkin(String(m.skin ?? '')) ?? skinOf(String(m.skin ?? ''))).id,
      pet: String(m.pet ?? 'none'),
      hero: heroOf(String(m.hero ?? '')).id,
      look: cleanLook(m.look),
      pf: cleanSummary(m.pf), // profile card (meta2)
    });
    this.refreshLobby();
    return;
  }
  if (m.t === 'loadout') {
    const entry = this.lobby.find((p) => p.peerId === from);
    if (entry && this.mode === 'title') {
      entry.loadout = validLoadout(m.loadout as Partial<Loadout>);
      this.refreshLobby();
    }
    return;
  }
  const h = this.heroByPeer(from);
  if (!h) return;
  h.lastSeen = performance.now();
  if (m.t === 'halook') { this.halloween.looks[h.index] = cleanHalloweenLook(m.look); return; }
  if (netcodeHostMsg(this, from, m)) return; // ping probes and quality reports (systems/netcode.ts)
  if (this.versusHostMessage(h, m)) return; // Versus Overlord orders and camera (systems/versus.ts)
  if (m.t === 'rvote') return this.routeVote(h, Number(m.i)); // route map vote (systems/route.ts)
  if (m.t === 'i') {
    h.remote = {
      x: Number(m.x),
      z: Number(m.z),
      vx: Number(m.vx),
      vz: Number(m.vz),
      ax: Number(m.ax),
      az: Number(m.az),
      ad: Number(m.ad ?? -1),
      firing: !!m.f,
      charging: !!m.c,
      dashing: !!m.d,
    };
    remoteButtonsIn(h, !!m.f, !!m.c); // a click shorter than a bunch of late inputs still reaches the weapons (systems/netcode.ts)
    if (m.vt !== undefined) noteViewStep(this, h, Number(m.vt)); // lag compensation (systems/netcode.ts)
  } else if (m.t === 'ping') {
    if (!h.player.dead && this.isCombatMode) this.ping(h, Number(m.x), Number(m.z), typeof m.k === 'string' ? m.k : undefined);
  } else if (m.t === 'iai') {
    heroes3StrikeMsg(this, h, m); // a client Ronin's dash-strike path (systems/heroes3.ts)
  } else if (m.t === 'dash') {
    if (!h.player.dead && this.isCombatMode) {
      h.player.invuln = Math.max(h.player.invuln, playerTuning.dashTime + playerTuning.dashIframesExtra);
      this.onDash(h);
    }
  } else if (m.t === 'jump') {
    this.arenaJumpMsg(h, Number(m.i));
  } else if (m.t === 'bomb') {
    if (this.isCombatMode) this.tryBomb(h);
  } else if (m.t === 'hb') {
    this.host?.send(from, { t: 'hb', c: m.c }); // round-trip echo (src/game/netFeel.ts)
  } else if (m.t === 'parry' || m.t === 'ult') {
    if (m.t === 'parry') noteParryLag(this, h, Number(m.rtt) || 0);
    this.skillMessage(h, m.t);
  } else if (m.t === 'rw') {
    this.timeMessage(h, m); // time lane: the rewind button
  } else if (m.t === 'team') {
    this.tryTeamMove(h);
  } else if (m.t === 'cash') {
    this.gpCashIn(h, Number(m.k) || 0); // combo cash-in (systems/gameplay.ts)
  } else if (m.t === 'carry') {
    coopPlayMessage(this, h, m); // pick up / put down a downed teammate (systems/coopplay.ts)
  } else if (m.t === 'emote' || m.t === 'cobuy' || m.t === 'bye') {
    this.coopMessage(h, m); // emotes, revive-pool buy-back, leaving on purpose (systems/coop2.ts)
  } else if (m.t === 'tr') {
    this.tradeMessage(h, m); // gifts and shop pools (systems/trading.ts)
  } else if (m.t === 'ui') {
    const d = m.d === -1 ? -1 : 1;
    this.heroAction(h, String(m.a), Number(m.i) || 0, d);
  }
}

export function onClientLeft(this: Game, id: string): void {
  netcodeNote(this, `host: ${id.slice(0, 6)} left`);
  if (spectateLeft(this, id)) return; // a spectator's seat (systems/spectate.ts)
  if (this.coopLeft(id)) return; // mid-run: autopilot grace period, then a clean leave (systems/coop2.ts)
  if (this.pvp && this.pvp.phase !== 'duel' && this.pvp.phase !== 'over') {
    const who = this.lobby.find((p) => p.peerId === id);
    this.lobby = this.lobby.filter((p) => p.peerId !== id);
    this.pvp.ready.delete(id);
    if (who) this.hud.toast(`${who.name.toUpperCase()} LEFT THE MATCH`, 3);
    this.pvpCheckReady();
    return;
  }
  if (this.mode === 'title') {
    this.lobby = this.lobby.filter((p) => p.peerId !== id);
    this.refreshLobby();
    return;
  }
  const h = this.heroByPeer(id);
  if (!h) return;
  h.left = true;
  h.player.dead = true;
  h.player.showWhenDead = false;
  h.pendingLevels = h.chestsPending = 0;
  h.shopDone = true;
  h.disposeWeapons();
  this.vfx.toast(`${h.name.toUpperCase()} LEFT THE GAME`, 3);
  // Don't leave the others stuck on a menu waiting for them.
  if (this.mode === 'levelup' && !this.heroes.some((x) => !x.left && x.needsPick)) this.afterPick(this.hero, '#ffffff');
  if (this.mode === 'shop' && this.heroes.every((x) => x.left || x.shopDone)) this.closeShop();
  if (this.pvp?.phase === 'duel') this.pvpCheckWinner();
  else if (this.aliveHeroes.length === 0 && this.isCombatMode) this.onHeroDown(h);
}

/** Send world snapshots to clients (20 Hz, slower while menus freeze the world). */
export function hostTick(this: Game, frozen: boolean): void {
  netcodeStep(this, frozen); // probes, silent clients, enemy history, tab-reload rejoin (systems/netcode.ts)
  if (this.role !== 'host' || !this.host) return;
  this.vfx.recording = true;
  spectateHostStep(this); // spectators: run starts, roster, play from the next stage (systems/spectate.ts)
  if (eightpSnapTick(this, frozen, isBotPeer)) return; // 5-8 players: snapshots spread over the steps (systems/eightp.ts)
  if (this.stepN % (frozen ? 15 : SNAP_EVERY) !== 0) return;
  const events = this.vfx.drain();
  for (const h of this.heroes) {
    if (!h.peerId || (h.left && this.versus?.overlord !== h.index)) continue; // a Versus Overlord sits out but still watches
    if (isBotPeer(h.peerId)) continue; // PvP bots play on the host (systems/pvp2.ts)
    this.host.send(h.peerId, this.buildSnapshot(h, events));
  }
  spectateSend(this, events); // every 2nd snapshot, reduced, to spectators (systems/spectate.ts)
}

/** `view`: a spectator's snapshot (systems/spectate.ts): its own centre, interest box and encoder, no private data. */
export function buildSnapshot(this: Game, forHero: Hero, events: VfxEvent[], view?: SnapView): Record<string, unknown> {
  const cx = view ? view.x : forHero.player.x;
  const cz = view ? view.z : forHero.player.z;
  const R = view ? view.r : INTEREST;
  const near = (x: number, z: number) => Math.abs(x - cx) < R && Math.abs(z - cz) < R;
  const en = this.enemies.list.filter((e) => e.active && (near(e.x, e.z) || e.def.boss));
  const bi: number[] = [];
  for (let i = 0; i < this.bullets.count; i++) if (near(this.bullets.x[i], this.bullets.z[i])) bi.push(i);
  const pi: number[] = [];
  for (let i = 0; i < this.pickups.count && pi.length < 600; i++) if (near(this.pickups.x[i], this.pickups.z[i])) pi.push(i);
  const keepFx = (e: VfxEvent) => {
    const [x, z] = Vfx.position(e);
    return (Number.isNaN(x) || near(x, z)) && fxRelevant(e, cx, cz);
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const boss = this.boss && this.boss.active ? { name: this.boss.def.name, hp01: r2(Math.max(0, this.boss.hp / this.boss.maxHp)) } : null;
  let enc = view?.enc ?? snapEncoders.get(forHero);
  if (!enc) snapEncoders.set(forHero, (enc = new SnapEncoder((forHero.index * 5) % 40))); // staggered keyframes per client (eightp lane)
  // The body goes through the compact snapshot codec (src/net/snapCodec.ts); records and effects are binary.
  const body: Record<string, unknown> = {
    ha: halloweenNet.call(this),
    mvp: this.mvp.report, // final awards; unchanged reports are omitted by the delta codec
    meta: { heat: this.meta.heat, week: this.meta.week, clears: this.victories },
    mode: this.mode,
    stage: this.stage,
    tl: !this.director.bossSpawned ? r2(this.director.remaining) : this.boss ? -1 : -2,
    boss,
    team: { level: this.level, xp01: r2(this.xp / this.xpNext), score: this.score, combo: this.combo, combo01: r2(this.combo > 0 ? Math.max(0, this.comboT / scoreTuning.comboWindow) : 0), kills: this.kills, time: r2(this.runTime) },
    cu: this.curses,
    sev: this.runEvents.event ? [this.runEvents.event.id, r2(this.runEvents.event.t)] : null,
    sch: this.runEvents.challenge ? [this.runEvents.challenge.text, this.runEvents.challenge.cur, this.runEvents.challenge.max, this.runEvents.challenge.done] : null,
    bf: [r2(this.runEvents.frenzyT), r2(this.runEvents.overdriveT)],
    heroes: this.heroes.map((h) => {
      const p = h.player;
      return {
        i: h.index,
        x: r2(p.x),
        z: r2(p.z),
        vx: r2(p.vel.x),
        vz: r2(p.vel.z),
        ax: r2(p.aim.x),
        az: r2(p.aim.z),
        hp: Math.ceil(p.hp),
        mhp: Math.round(p.maxHp),
        dead: p.dead,
        left: h.left,
        dash: p.dashing,
        inv: r2(p.invuln),
        rec: r2(p.recoil),
        hf: r2(p.hurtFlash),
        rv: r2(h.reviveT / REVIVE_TIME),
        area: r2(h.stats.areaMul),
        w: heroWeaponsFor(this, forHero, h, (q) => h.weapons.map((w) => [w.def.id, w.level, Math.round(w.ready * q) / q, w.buildKey, ...w.net()])), // teammates: coarser reload, far ones refresh less often (systems/eightp.ts)
        rl: h.relics,
        tw: this.heroMechNet(h),
        gp: this.gpHeroNet(h),
      };
    }),
    you: {
      gold: view ? 0 : forHero.gold,
      gears: view ? 0 : forHero.rerollsLeft,
      special: [forHero.special.id, forHero.special.level, forHero.specialBuild ? buildKey(forHero.specialBuild) : ''],
      bomb: r2(forHero.bombCharge),
      mods: view ? [] : forHero.synergy.slots.map((s, i) => ({ id: s.def.id, ro: forHero.synergy.readout(i), lv: s.level })),
      passives: forHero.passives,
      stats: { moveSpeedMul: forHero.stats.moveSpeedMul, dashCooldownMul: forHero.stats.dashCooldownMul, dashCharges: forHero.stats.dashCharges, maxHp: forHero.stats.maxHp, magnet: forHero.stats.magnet, areaMul: forHero.stats.areaMul },
    },
    portal: this.portal.active ? [r2(this.portal.x), r2(this.portal.z)] : null,
    bx: this.bossNet(),
    ac: architectNet(this),
    ar: this.arenaNet(),
    sk: this.skillNet(forHero),
    cp: this.companionNet(),
    d2: this.director2Net(),
    fu: [this.elitesRun, this.bossesRun], // team FIRST STEPS goals on guests, including drop-in
    gpw: this.gameplayNet(forHero),
    ss: secretsNet(this),
    w2: weather2Net(this),
    we: this.worldEventNet(),
    wt: this.worldEventLive(forHero),
    tm: this.timeNet(forHero),
    co: this.coopNet(forHero),
    gl: gauntletNet(this),
    rd: this.raidNet(),
    tr: this.tradingNet(forHero),
    md: this.modesNet(),
    trial: trialsNet(this),
    cn: this.cineNet(),
    vs: this.versusNet(),
    s2: soundLaneNet(this, forHero),
    nq: netNq(this), // everyone's ping / loss / snapshot rate (systems/netcode.ts)
    h3: heroes3Net(this, forHero, R), // Tinker bots (systems/heroes3.ts)
    p2: pvp2Net(this), // PvP rounds, teams and ring (systems/pvp2.ts)
    cy: coopPlayNet(this), // co-op objectives, carried heroes, tethers (systems/coopplay.ts)
    sp: spectateNet(this, view), // watchers and their emotes (systems/spectate.ts)
  };
  // Bullets go as deltas (`bd`, src/net/bulletCodec.ts); `hs` stamps the host step for the client's playout clock.
  return enc.encode(body, { en: packEnemies(en), enN: en.length, pk: packPickups(this.pickups, pi), pkN: pi.length, bu: { b: this.bullets, idx: bi } }, { fx: fxEncoder.encode(events, keepFx), hs: this.stepN });
}
