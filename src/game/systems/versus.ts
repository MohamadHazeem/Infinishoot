/**
 * Versus Swarm (MP lane): the Game side of src/game/versus.ts.
 * Game methods (`this` is the Game), installed on the class as fields.
 *
 * The match is one stage. The Overlord (a lobby player, host or client, or the
 * AI) spends points on cards instead of the director spawning anything; the
 * heroes win by surviving the timer and beating the boss, the Overlord by
 * downing every hero. The host validates and rate-limits every command
 * (`vcmd`), mirrors the Overlord's purse to clients in the snapshot field `vs`,
 * and announces the result with `vsend`. The Overlord's own hero object is kept
 * `left` and dead (it never takes part), but still gets snapshots so its
 * command view sees the field; its camera focus (`vcam`) drives its interest box.
 */
import type { Game } from '../game';
import { playerName } from '../game';
import { ENEMIES, bossForStage, type EnemyDef } from '../../data/enemies';
import type { SpawnRequest } from '../director';
import { Team } from '../bullets';
import { access } from '../settings';
import type { Hero } from '../hero';
import { spawnCue } from './sound';
import { OverlordState, aiOverlordPick, markersFor, packOverlord, unpackOverlord, validateCommand, versusTuning, CARD_BY_ID, OVERLORD_CARDS, type OverlordCmd, type VersusWorld, type VsPoint } from '../versus';

export interface VersusRun {
  /** Who simulates: solo (vs the AI, or local), host, or a client mirroring the host. */
  net: 'solo' | 'host' | 'client';
  /** Hero index of the Overlord player; -1 = the AI Overlord. */
  overlord: number;
  st: OverlordState;
  markers: VsPoint[];
  markersFor: unknown;
  pending: { x: number; z: number; t: number; dmg: number }[];
  winner: '' | 'heroes' | 'overlord';
  /** Seconds left on the result banner (counts down, then everyone goes to the title). */
  endT: number;
  aiT: number;
  /** This machine's command view: camera focus, selected card, last message. */
  camX: number;
  camZ: number;
  sel: number;
  note: string;
  noteT: number;
  camSendT: number;
  /** Host: names for the result banner. */
  overlordName: string;
}

export function newVersusRun(net: VersusRun['net'], overlord: number, name = 'THE AI'): VersusRun {
  return { net, overlord, st: new OverlordState(), markers: [], markersFor: null, pending: [], winner: '', endT: -1, aiT: 1.5, camX: 0, camZ: 0, sel: 0, note: '', noteT: 0, camSendT: 0, overlordName: name };
}

/** Is this machine the Overlord? */
export function isOverlord(g: Game): boolean {
  const v = g.versus;
  return !!v && v.overlord >= 0 && v.overlord === g.local;
}

/** Host/solo: start the match. Call after startRun() so the Overlord's hero can be taken out of play. */
export function versusBegin(this: Game, overlord: number, name?: string): void {
  const v = newVersusRun(this.role === 'host' ? 'host' : 'solo', overlord, name);
  this.versus = v;
  const ol = this.heroes[overlord];
  if (ol) {
    v.overlordName = ol.name;
    benchOverlord(ol);
    // It got the starting shop like everyone; it doesn't shop.
    if (ol.peerId) this.tell(ol, { t: 'go' });
    else if (['shop', 'wait'].includes(this.screens.current)) this.screens.show('none');
    if (this.mode === 'shop' && this.heroes.every((x) => x.left || x.shopDone)) this.closeShop();
  }
  this.director.players = Math.max(1, this.heroes.filter((h) => !h.left).length);
  this.runEvents.suppressEvent(); // no stage event: the Overlord is the event
  this.vfx.banner('VERSUS SWARM', `${v.overlordName.toUpperCase()} IS THE OVERLORD<br>SURVIVE THE TIMER AND BEAT THE BOSS`, 3);
}

/** Solo practice (PLAY ONLINE > VERSUS VS AI, test links, the smoke bot): you are the heroes, the AI is the Overlord. */
export function versusSolo(this: Game): void {
  this.leaveToTitle();
  this.hero.name = playerName();
  this.applyLocalSkin();
  this.runMode = 'standard';
  this.startRun();
  this.versusBegin(-1);
}

/** The Overlord's hero sits the match out: never simulated, hit or revived, but still sent snapshots. */
function benchOverlord(h: Hero): void {
  h.left = true;
  h.player.dead = true;
  h.player.showWhenDead = false;
  h.shopDone = true;
  h.pendingLevels = h.chestsPending = 0;
  h.disposeWeapons();
}

/** Markers depend on the arena; rebuilt on any machine when the arena changes. */
function markers(g: Game, v: VersusRun): VsPoint[] {
  if (v.markersFor !== g.arena) {
    v.markersFor = g.arena;
    v.markers = markersFor(g.arena.halfSize, (x, z) => !g.walls.hitCircle(x, z, 1.2));
  }
  return v.markers;
}

export function versusWorld(this: Game): VersusWorld {
  const v = this.versus!;
  const half = this.arena.halfSize;
  let alive = 0;
  for (const e of this.enemies.list) if (e.active) alive++;
  // Clients don't run the director: their clock comes from the snapshot's time left (negative once the boss is out).
  const client = this.role === 'client';
  const duration = this.director.duration;
  return {
    time: client ? (this.netTimeLeft >= 0 ? duration - this.netTimeLeft : duration) : this.director.time,
    duration,
    half,
    heroes: this.aliveHeroes.map((h) => ({ x: h.player.x, z: h.player.z })),
    markers: markers(this, v),
    alive,
    bossOut: client ? this.netTimeLeft < 0 || v.st.bossUsed : this.director.bossSpawned,
    walkable: (x, z) => Math.abs(x) < half - 1 && Math.abs(z) < half - 1 && !this.walls.hitCircle(x, z, 1.2),
  };
}

/** Director hook (Game.simulate): in Versus only the end-of-timer boss gets through, if the Overlord hasn't sent it. */
export function versusReqs(this: Game, reqs: SpawnRequest[]): SpawnRequest[] {
  const v = this.versus;
  if (!v) return reqs;
  const out: SpawnRequest[] = [];
  for (const r of reqs) {
    if (r.kind !== 'boss' || v.st.bossUsed) continue;
    v.st.bossUsed = true;
    this.vfx.toast("TIME'S UP! THE BOSS IS COMING", 3);
    out.push(r);
  }
  return out;
}

/** Simulation hook (host/solo): the purse, the AI, delayed hazards, and the win check. */
export function versusStep(this: Game, dt: number): void {
  const v = this.versus;
  if (!v || v.net === 'client') return;
  if (!v.winner) {
    // The Overlord's player left: the AI takes over its purse.
    const ol = this.heroes[v.overlord];
    if (ol?.peerId && this.host && !this.host.clientIds.includes(ol.peerId)) {
      v.overlord = -1;
      v.aiT = 1;
      this.vfx.toast('THE OVERLORD LEFT: THE AI TAKES OVER', 3);
    }
    if (this.mode === 'fight' && this.aliveHeroes.length) {
      v.st.tick(dt, this.director.time, this.director.duration);
      if (v.overlord < 0 && (v.aiT -= dt) <= 0) {
        v.aiT = versusTuning.aiThink;
        const w = this.versusWorld();
        const vel = this.aliveHeroes.map((h) => ({ x: h.player.vel.x, z: h.player.vel.z }));
        const cmd = aiOverlordPick(v.st, w, this.rng, vel);
        if (cmd) this.versusCommand(-1, cmd);
      }
    }
    for (let i = v.pending.length - 1; i >= 0; i--) {
      const n = v.pending[i];
      if ((n.t -= dt) > 0) continue;
      v.pending.splice(i, 1);
      novaBurst(this, n.x, n.z, n.dmg);
    }
    // Heroes win once the boss is down (stage clear); the Overlord wins when every hero is down.
    if (this.mode === 'cleared') versusEnd.call(this, 'heroes');
    else if (this.mode === 'dead') versusEnd.call(this, 'overlord');
  }
}

/** Host/solo: apply one Overlord command. `by` is the commanding hero index (-1 = AI). Returns '' or why it was refused. */
export function versusCommand(this: Game, by: number, cmd: Partial<OverlordCmd>): string {
  const v = this.versus;
  if (!v || v.net === 'client' || v.winner) return 'no match';
  if (by !== v.overlord) return 'not the overlord';
  if (this.mode !== 'fight') return 'wait for the fight';
  const res = validateCommand(v.st, cmd, this.versusWorld(), this.director.time);
  if (!res.ok) return res.reason;
  const { card, spot } = res;
  v.st.spend(card, this.director.time);
  const color = card.color;
  if (card.kind === 'group') dropGroup(this, ENEMIES[card.enemy!], card.count ?? 1, spot);
  else if (card.kind === 'elite') {
    const def = ENEMIES[this.rng.pick(card.pool ?? ['bopper'])];
    this.spawnEnemy(def, true, spot);
  } else if (card.hazard === 'meteor') {
    const t = versusTuning;
    for (let i = 0; i < t.meteorCount; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = i === 0 ? 0 : this.rng.range(1, t.meteorSpread);
      const x = spot.x + Math.cos(a) * d;
      const z = spot.z + Math.sin(a) * d;
      const delay = 1 + i * 0.15;
      this.strikes.push({ x, z, r: t.meteorRadius, t: delay, dmg: t.meteorDamage * this.director.dmgMul, cause: 'The Overlord' });
      this.vfx.zone(x, z, t.meteorRadius, delay);
    }
  } else if (card.hazard === 'nova') {
    v.pending.push({ x: spot.x, z: spot.z, t: versusTuning.novaDelay, dmg: versusTuning.novaDamage * this.director.dmgMul });
    this.vfx.zone(spot.x, spot.z, 1.6, versusTuning.novaDelay);
  } else if (card.kind === 'boss') {
    this.director.bossSpawned = true;
    this.spawnBoss(bossForStage(this.stage));
  }
  this.vfx.ring(spot.x, spot.z, 1, 7, color, 0.5);
  this.vfx.ring(spot.x, spot.z, 0.6, 4, '#b13e53', 0.35);
  this.vfx.sound(card.kind === 'boss' ? 'boss' : card.kind === 'elite' ? 'elite' : 'wave', spot.x, spot.z);
  this.vfx.toast(`${v.overlord < 0 ? 'THE AI OVERLORD' : 'THE OVERLORD'} SENDS ${card.name.toUpperCase()}!`, 1.8);
  return '';
}

function dropGroup(g: Game, def: EnemyDef | undefined, n: number, spot: VsPoint): void {
  if (!def) return;
  let placed = 0;
  for (let i = 0; i < n * 3 && placed < n; i++) {
    const a = g.rng.range(0, Math.PI * 2);
    const d = placed === 0 ? 0 : g.rng.range(0.8, 2.6);
    const x = spot.x + Math.cos(a) * d;
    const z = spot.z + Math.sin(a) * d;
    if (g.walls.hitCircle(x, z, def.radius)) continue;
    g.enemies.spawn(def, x, z, g.spawnOpts());
    placed++;
  }
  if (placed) spawnCue(g, def, spot.x, spot.z, false);
}

/** A ring of enemy bullets from a point (the Bullet Nova card). */
function novaBurst(g: Game, x: number, z: number, dmg: number): void {
  const n = versusTuning.novaBullets;
  const a0 = g.rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    g.bullets.spawn({
      x,
      z,
      dirX: Math.cos(a),
      dirZ: Math.sin(a),
      speed: 9,
      life: 3.5,
      radius: 0.26,
      damage: dmg,
      knockback: 6,
      team: Team.Enemy,
      color: access.colorblind ? '#ffffff' : '#ff3df0',
      width: access.colorblind ? 0.62 : 0.5,
      length: access.colorblind ? 0.62 : 0.5,
    });
  }
  g.vfx.ring(x, z, 1, 6, '#ff3df0', 0.35);
  g.vfx.sound('enemyShoot', x, z);
}

/** Host/solo: the match is decided. */
export function versusEnd(this: Game, winner: 'heroes' | 'overlord'): void {
  const v = this.versus!;
  if (v.winner) return;
  v.winner = winner;
  v.endT = versusTuning.endHold;
  // Not a normal run end: no game over screen, nothing banked.
  this.mode = 'dead';
  this.modeT = 0;
  this.gameOverShown = true;
  this.host?.broadcast({ t: 'vsend', w: winner, name: v.overlordName });
  versusResult(this, winner, v.overlordName);
}

function versusResult(g: Game, winner: 'heroes' | 'overlord', name: string): void {
  const ol = isOverlord(g);
  const title = winner === 'heroes' ? (ol ? 'THE HEROES WIN' : 'HEROES WIN!') : ol ? 'YOU WIN, OVERLORD!' : 'THE OVERLORD WINS';
  const sub = winner === 'heroes' ? 'THE BOSS IS DOWN' : `${name.toUpperCase()} WIPED THE TEAM`;
  g.vfx.banner(title, sub, versusTuning.endHold);
  g.vfx.flash(0.6);
  g.vfx.sound('legendaryPick', NaN, NaN);
}

/** Every update (any role): the result countdown, and this machine's command view input. */
export function versusTick(this: Game, dt: number): void {
  const v = this.versus;
  if (!v) return;
  if (v.endT >= 0) {
    v.endT -= dt;
    if (v.endT < 0) {
      const w = v.winner;
      this.leaveToTitle();
      this.hud.toast(w === 'heroes' ? 'VERSUS: THE HEROES WON' : 'VERSUS: THE OVERLORD WON', 4);
    }
    return;
  }
  if (v.noteT > 0) v.noteT -= dt;
  if (!isOverlord(this) || this.paused || this.screens.current !== 'none' || !this.isCombatMode) return;
  const input = this.input;
  const half = this.arena.halfSize;
  // Pan the command view: WASD / arrows / left stick.
  v.camX = Math.max(-half, Math.min(half, v.camX + input.move.x * versusTuning.camPan * dt));
  v.camZ = Math.max(-half, Math.min(half, v.camZ + input.move.y * versusTuning.camPan * dt));
  const n = OVERLORD_CARDS.length;
  for (let k = 0; k < Math.min(9, n); k++) if (input.keyPressed(`Digit${k + 1}`)) v.sel = k;
  if (n >= 10 && input.keyPressed('Digit0')) v.sel = 9;
  if (input.padButtonPressed(4) || input.keyPressed('KeyQ')) v.sel = (v.sel + n - 1) % n;
  if (input.padButtonPressed(5) || input.keyPressed('KeyE') || input.mousePressed(2)) v.sel = (v.sel + 1) % n;
  let at: VsPoint | null = null;
  if (input.mousePressed(0) && input.device === 'kbm' && this.mouseAimPoint()) at = { x: this.aimHit.x, z: this.aimHit.z };
  else if (input.padButtonPressed(0) || input.keyPressed('Space')) at = { x: v.camX, z: v.camZ };
  if (at) versusOrder(this, { c: OVERLORD_CARDS[v.sel].id, x: Math.round(at.x * 10) / 10, z: Math.round(at.z * 10) / 10 });
  // Clients tell the host where they look, so their snapshots cover it.
  if (this.role === 'client' && (v.camSendT -= dt) <= 0) {
    v.camSendT = 0.2;
    this.client?.send({ t: 'vcam', x: Math.round(v.camX), z: Math.round(v.camZ) });
  }
}

/** This machine's Overlord gives an order: applied here (host/solo) or sent to the host. */
export function versusOrder(g: Game, cmd: OverlordCmd): void {
  const v = g.versus!;
  if (g.role === 'client') {
    g.client?.send({ t: 'vcmd', ...cmd });
    return;
  }
  const err = g.versusCommand(v.overlord, cmd);
  if (err) versusNote(g, err);
}

export function versusNote(g: Game, msg: string): void {
  const v = g.versus;
  if (!v) return;
  v.note = msg.toUpperCase();
  v.noteT = 1.6;
}

/** Host: Versus messages from a client. Returns true if handled. */
export function versusHostMessage(this: Game, h: Hero, m: Record<string, unknown>): boolean {
  const v = this.versus;
  if (!v || (m.t !== 'vcmd' && m.t !== 'vcam')) return false;
  if (h.index !== v.overlord) return true;
  if (m.t === 'vcam') {
    const half = this.arena.halfSize;
    const x = Math.max(-half, Math.min(half, Number(m.x) || 0));
    const z = Math.max(-half, Math.min(half, Number(m.z) || 0));
    h.player.teleport(x, z); // the bench hero stands where its player looks: snapshots cover that area
    return true;
  }
  const err = this.versusCommand(h.index, { c: String(m.c ?? ''), x: Number(m.x), z: Number(m.z) });
  if (err) this.tell(h, { t: 'vsres', r: err });
  return true;
}

/** Client: Versus messages from the host. Returns true if handled. */
export function versusClientMessage(this: Game, m: Record<string, unknown>): boolean {
  if (m.t === 'vsres') {
    versusNote(this, String(m.r ?? ''));
    return true;
  }
  if (m.t === 'vsend') {
    const v = this.versus ?? (this.versus = newVersusRun('client', -1));
    if (!v.winner) {
      v.winner = m.w === 'heroes' ? 'heroes' : 'overlord';
      v.endT = versusTuning.endHold;
      versusResult(this, v.winner, String(m.name ?? 'The Overlord'));
    }
    return true;
  }
  return false;
}

/** Snapshot field `vs` (null outside Versus). */
export function versusNet(this: Game): number[] | null {
  const v = this.versus;
  return v ? packOverlord(v.st, v.overlord, v.winner) : null;
}

export function applyVersusNet(this: Game, raw: unknown): void {
  if (!raw) return;
  const v = this.versus ?? (this.versus = newVersusRun('client', -1));
  const r = unpackOverlord(raw, v.st);
  if (r) v.overlord = r.overlord;
}

/** Render hook: the Overlord's camera looks down on its focus point from far up. */
export function versusCamera(g: Game): void {
  const v = g.versus;
  if (!v || !isOverlord(g) || g.mode === 'title') return;
  g.playerPos.set(v.camX, 0, v.camZ);
  g.lead.set(0, 0, 0);
  g.cam.frameTeam(0, 0, versusTuning.camZoom);
  g.cam.auto = 1; // no swarm auto-zoom or calm crowd framing: a steady view from above
  g.cam.cine = 0;
}

export { CARD_BY_ID };
