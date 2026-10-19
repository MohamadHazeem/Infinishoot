/** Host-owned discoveries. `ss` snapshots carry the room and durable run receipts;
 * clients draw the same props, rebuild the ice barrier, and bank their own profile. */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { AABB } from '../../world/collision';
import { StaticBoxGrid } from '../../core/spatialHash';
import { ENEMIES } from '../../data/enemies';
import { RELICS } from '../../data/relics';
import { SECRET_BOSSES, SECRET_ORDER, SECRET_PUZZLES, konamiStep, secretBeat, secretPlan, secretSequence, secretsTuning as T, type SecretBoss, type SecretPuzzle } from '../../data/secrets';
import { grantAchievement, markCodex, persist, saveLock, unlockMeta } from '../save';
import { createRetroMaterial } from '../../render/retroMaterial';
import { commit } from '../../render/instancing';
import { isNightStage } from '../../render/biomeLook';
import { beamReach } from './enemyFamilies';
import { reduceMotion } from '../../ui/hud';
import { localize, t } from '../../i18n';

export interface SecretRoom {
  x: number; z: number; kind: SecretPuzzle | null; open: boolean; done: boolean;
  progress: number; mask: number; occupied: number; clock: number; ice: number; blocked: boolean;
}
export interface SecretsNet {
  stage: number; room: SecretRoom | null; bugs: number; bosses: number; receipts: number;
}
interface SecretsState extends SecretsNet {
  arena: unknown; cooldown: number[]; charge: number[]; attuned: boolean[];
  stageTime: number; beat: number; pendingShadow: boolean; activeBoss: number; hold: boolean;
  banked: number; blocker: AABB | null; view: SecretView | null; code: number; wired: boolean;
}
const states = new WeakMap<Game, SecretsState>();
export function secretsState(g: Game): SecretsState {
  let s = states.get(g);
  if (!s) {
    s = { stage: 0, room: null, bugs: 0, bosses: 0, receipts: 0, arena: null, cooldown: [], charge: [], attuned: [], stageTime: 0, beat: -1, pendingShadow: false, activeBoss: -1, hold: false, banked: 0, blocker: null, view: null, code: 0, wired: false };
    states.set(g, s);
  }
  return s;
}
function enabled(g: Game): boolean { return !g.pvp && !g.versus && !g.onboarding.training && !saveLock.on && (g.runMode === 'standard' || g.runMode === 'endless'); }
export function resetSecrets(g: Game): void {
  const s = secretsState(g);
  clearSecrets(g);
  s.bugs = s.bosses = s.receipts = s.banked = 0;
  s.arena = null;
}
export function clearSecrets(g: Game): void {
  const s = states.get(g);
  if (!s) return;
  barrier(g, s, false);
  s.room = null; s.arena = null; s.pendingShadow = false; s.activeBoss = -1;
  s.cooldown.length = s.charge.length = s.attuned.length = 0;
  if (s.view) s.view.mesh.visible = false;
}
function findRoom(g: Game, kind: SecretPuzzle | null): SecretRoom | null {
  // Entire footprint must be walkable. Never clear another lane's props or terrain.
  const lim = g.arena.halfSize - 10;
  for (let n = 0; n < 100; n++) {
    const a = (n * 2.39996 + (g.seed % 100) * 0.1);
    const d = 17 + (n % 5) * 6;
    const x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d);
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (g.arena.hazards.some(h => Math.hypot(x - h.x, z - h.z) < h.r + 9)) continue;
    let clear = true;
    for (let dx = -7; dx <= 7 && clear; dx += 2) for (let dz = -6; dz <= 6; dz += 2) if (g.walls.hitCircle(x + dx, z + dz, 1.5)) { clear = false; break; }
    if (clear) return { x, z, kind, open: false, done: false, progress: 0, mask: 0, occupied: 0, clock: 0, ice: 0, blocked: false };
  }
  return null;
}
function prepare(g: Game, s: SecretsState): void {
  if (s.arena === g.arena) return;
  barrier(g, s, false);
  s.arena = g.arena; s.stage = g.stage; s.beat = -1; s.stageTime = 0;
  s.room = enabled(g) ? findRoom(g, secretPlan(g.seed, g.stage)) : null;
  s.cooldown.length = s.charge.length = s.attuned.length = 0;
}
function barrier(g: Game, s: SecretsState, closed: boolean): void {
  const r = s.room;
  if (r) r.blocked = closed;
  if (closed === !!s.blocker || (closed && !r)) return;
  if (closed) {
    s.blocker = { minX: r!.x - 4, maxX: r!.x + 4, minZ: r!.z - 2, maxZ: r!.z + 1, gap: true };
    g.arena.colliders.push(s.blocker);
  } else if (s.blocker) {
    const i = g.arena.colliders.indexOf(s.blocker);
    if (i >= 0) g.arena.colliders.splice(i, 1);
    s.blocker = null;
  }
  g.walls = new StaticBoxGrid(g.arena.colliders);
  g.enemyCtx.colliders = g.arena.colliders;
}
/** Uses the host's accepted input and aim; all click weapons can operate switches.
 * No projectile scan, and a wall between the player and switch blocks the interaction. */
function aimed(g: Game, h: Hero, x: number, z: number): boolean {
  if (!h.ctx.firing && !h.ctx.charging) return false;
  const p = h.player, dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  return d > 0.1 && d <= T.reach && (dx * p.aim.x + dz * p.aim.z) / d > 0.982 && beamReach(p.x, p.z, dx / d, dz / d, d, g.arena.colliders) >= d - 0.2;
}
function cue(g: Game, r: SecretRoom, good = true): void {
  g.vfx.sound(good ? 'chest' : 'hit', r.x, r.z, good ? 1.2 : 0.65);
  g.vfx.ring(r.x, r.z, 0.5, 4, good ? '#73eff7' : '#ef7d57', 0.35);
}
function bank(g: Game, s: SecretsState): void {
  if (saveLock.on) return;
  const fresh = s.receipts & ~s.banked;
  if (!fresh) return;
  s.banked |= fresh;
  const achieve = (id: string) => { if (grantAchievement(id)) g.newAchievements.push(id); };
  if (fresh & 1) { achieve('secret_room'); markCodex('secret:relay'); }
  if (fresh & 2) achieve('secret_golden');
  if (fresh & 4) achieve('secret_shadow');
  if (fresh & 8) markCodex('secret:developers');
  unlockMeta(); persist();
}
function reward(g: Game, s: SecretsState): void {
  const r = s.room;
  if (!r || r.done) return;
  r.done = true; r.ice = T.iceSeconds; s.receipts |= 1;
  barrier(g, s, false);
  for (const h of g.heroes) {
    if (h.left) continue;
    const pool = RELICS.filter(v => (v.rarity === 'rare' || v.rarity === 'legendary') && !h.relics.includes(v.id));
    const relic = pool.length ? pool[Math.floor(g.rng.next() * pool.length)] : null;
    if (relic) { h.relics.push(relic.id); h.recomputeStats(); h.loadoutDirty = true; }
    else h.gold += 25;
  }
  bank(g, s); cue(g, r);
  g.vfx.banner('SECRET FOUND!', 'RARE RELIC · RELAY ARMOUR · LORE', 2.5);
}
export function spawnSecretBoss(g: Game, id: SecretBoss): boolean {
  const s = secretsState(g), bit = id === 'golden_king' ? 1 : 2;
  if (!g.authority || !enabled(g) || g.mode !== 'fight' || g.boss || (s.bosses & bit)) return false;
  const pos = g.ringPoint(11, 14, ENEMIES[id].radius + 0.5);
  if (!pos) return false;
  s.bosses |= bit; s.hold = g.director.hold; g.director.hold = true;
  const boss = g.enemies.spawn(ENEMIES[id], pos.x, pos.z, g.spawnOpts({ hpMul: g.director.bossHpMul * T.bossHp }));
  g.boss = boss; s.activeBoss = boss.uid;
  g.startBossIntro(boss);
  g.vfx.portrait(`boss:${id}`, 'determined', id === 'golden_king' ? 'THREE COLLECTORS. ONE KING.' : 'I KNOW YOUR EVERY MOVE.', 3);
  return true;
}
/** Called once after the ordinary kill has released its boss reference. */
export function secretsKill(g: Game, e: Enemy): void {
  if (!g.authority || !enabled(g)) return;
  const s = secretsState(g);
  if (e.def.id === 'golden') s.bugs++;
  if (e.def.id === 'golden_king' || e.def.id === 'shadow_hero') {
    s.receipts |= e.def.id === 'golden_king' ? 2 : 4;
    s.activeBoss = -1; g.director.hold = s.hold;
    bank(g, s);
  } else if (e.def.boss && s.stageTime >= g.director.duration - 1 && !g.damagedThisStage && isNightStage(g.arenaStage) && !(s.bosses & 2)) s.pendingShadow = true;
}
/** Runs before stage-clear detection; a flawless night's encore can't be skipped by the shop. */
export function updateSecrets(g: Game, dt: number): void {
  if (!g.authority || g.mode !== 'fight' || !enabled(g)) return;
  const s = secretsState(g);
  prepare(g, s);
  s.stageTime += dt;
  if (s.pendingShadow && !g.boss) {
    if (spawnSecretBoss(g, 'shadow_hero')) s.pendingShadow = false;
  }
  const r = s.room;
  if (!r) return;
  r.clock += dt;
  if (r.ice > 0 && !r.done) r.ice = Math.max(0, r.ice - dt);
  // Never refreeze the barrier around a hero already crossing the water.
  const crossing = g.heroes.some(h => !h.left && !h.player.dead && Math.abs(h.player.x - r.x) < 4.6 && h.player.z > r.z - 2.6 && h.player.z < r.z + 1.6);
  barrier(g, s, r.open && r.kind === 'ice' && !r.done && r.ice <= 0 && !crossing);
  let occupied = 0;
  const beat = Math.floor(r.clock / T.beatSeconds);
  if (r.open && r.kind === 'runes' && !r.done && beat !== s.beat && g.aliveHeroes.some(h => Math.hypot(h.player.x - r.x, h.player.z - r.z) < 13)) {
    s.beat = beat; g.vfx.sound('gem', r.x, r.z, beat % 4 === 0 ? 1.2 : 0.8);
  }
  for (const h of g.heroes) {
    if (h.left || h.player.dead) continue;
    const p = h.player, i = h.index;
    s.cooldown[i] = Math.max(0, (s.cooldown[i] ?? 0) - dt);
    if (Math.abs(p.x - r.x) > 18 || Math.abs(p.z - r.z) > 18) continue;
    if (s.cooldown[i] <= 0 && aimed(g, h, r.x + 6, r.z + 3)) {
      s.cooldown[i] = 0.7;
      if (s.bugs >= T.goldbugs && !(s.bosses & 1)) spawnSecretBoss(g, 'golden_king');
      else g.vfx.toast('THREE GOLDBUGS WAKE THE KING', 2);
    }
    if (r.kind && !r.open && s.cooldown[i] <= 0 && aimed(g, h, r.x, r.z + 4)) {
      r.open = true; s.cooldown[i] = 0.7; cue(g, r);
      g.vfx.toast('A HIDDEN RELAY! LEFT · RIGHT · MIDDLE', 3);
    }
    if (!r.open) continue;
    if (r.done) {
      if (!(s.receipts & 8) && Math.hypot(p.x - r.x, p.z - (r.z - 4)) < 1.8) {
        s.receipts |= 8; bank(g, s); g.vfx.toast('THE NIGHT SHIFT · THANK YOU FOR PLAYING', 4);
      }
      continue;
    }
    const elemental = r.kind === 'braziers' || r.kind === 'ice';
    if (elemental) {
      // A free relay pad gives non-elemental builds a room-only elemental charge.
      const on = Math.hypot(p.x - (r.x - 4), p.z - (r.z + 3)) < 1.1;
      s.charge[i] = on ? Math.min(T.chargeSeconds, (s.charge[i] ?? 0) + dt) : 0;
      if (s.charge[i] >= T.chargeSeconds && !s.attuned[i]) { s.attuned[i] = true; cue(g, r); }
      const tag = r.kind === 'ice' ? 'frost' : 'fire';
      const has = s.attuned[i] || h.weapons.some(w => w.tags.includes(tag));
      if (r.kind === 'ice') {
        if (has && s.cooldown[i] <= 0 && aimed(g, h, r.x, r.z + 1.5)) {
          r.ice = T.iceSeconds; s.cooldown[i] = 0.7; barrier(g, s, false); cue(g, r);
        }
        if (r.ice > 0 && Math.abs(p.x - r.x) < 2 && p.z < r.z - 2.5 && p.z > r.z - 5) reward(g, s);
        continue;
      }
      if (!has) continue;
    }
    for (let j = 0; j < 3; j++) {
      const x = r.x + (j - 1) * 3, z = r.z;
      if (r.kind === 'plates') {
        if (Math.hypot(p.x - x, p.z - z) < T.plateRadius) occupied |= 1 << j;
      } else if (s.cooldown[i] <= 0 && aimed(g, h, x, z)) {
        s.cooldown[i] = T.shotCooldown;
        if (r.kind === 'braziers') { if (!(r.mask & (1 << j))) { r.mask |= 1 << j; cue(g, r); } }
        else if (secretBeat(r.clock)) { r.progress = secretSequence(r.progress, j); cue(g, r, r.progress > 0); }
        else cue(g, r, false);
        break;
      }
    }
  }
  if (r.kind === 'plates') {
    const edges = occupied & ~r.occupied;
    // Simultaneous teammates cannot advance more than one step in a frame.
    if (edges && !(edges & (edges - 1))) {
      const j = edges === 1 ? 0 : edges === 2 ? 1 : 2;
      r.progress = secretSequence(r.progress, j); cue(g, r, r.progress > 0);
    }
    r.occupied = occupied;
  }
  if (!r.done && (r.progress >= 3 || r.mask === 7)) reward(g, s);
}
export function secretsNet(g: Game): SecretsNet {
  const s = secretsState(g);
  return { stage: s.stage, room: s.room ? { ...s.room } : null, bugs: s.bugs, bosses: s.bosses, receipts: s.receipts };
}
export function applySecretsNet(g: Game, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const m = raw as SecretsNet, s = secretsState(g);
  if (m.stage !== g.stage) return;
  s.stage = m.stage; s.bugs = m.bugs; s.bosses = m.bosses; s.receipts = m.receipts;
  s.room = m.room ? { ...m.room } : null;
  barrier(g, s, !!s.room?.blocked);
  bank(g, s);
}

/** One small instanced prop batch, no per-frame mesh/material churn. */
class SecretView {
  mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial(), 160);
  private matrix = new THREE.Matrix4();
  private color = new THREE.Color();
  panel: HTMLDivElement;
  private n = 0;
  private ox = 0; private oz = 0;
  constructor(g: Game) {
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.scene.add(this.mesh);
    this.panel = document.createElement('div'); this.panel.id = 'secret-hint';
    document.getElementById('goals')?.append(this.panel);
    if (!document.getElementById('secrets-css')) {
      const css = document.createElement('style'); css.id = 'secrets-css';
      css.textContent = '#secret-hint{max-width:calc(94 * var(--p));padding:calc(2 * var(--p)) calc(3 * var(--p));background:var(--navy);color:var(--white);font:18px var(--font);white-space:pre-line;--hi:var(--cyan);--lo:var(--ink);--ring:var(--ink);box-shadow:inset var(--p) var(--p) 0 var(--hi),inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--lo),0 0 0 var(--p) var(--ring)}#secret-hint:empty{display:none}';
      document.head.append(css);
    }
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: string): void {
    this.matrix.makeScale(w, h, d).setPosition(x + this.ox, y, z + this.oz);
    this.mesh.setMatrixAt(this.n, this.matrix); this.mesh.setColorAt(this.n++, this.color.set(c));
  }
  draw(r: SecretRoom, time: number): void {
    this.mesh.visible = true; this.n = 0; this.ox = r.x; this.oz = r.z;
    // Crown statue: a silhouette players can recognise even before learning its clue.
    this.box(6, 0.3, 3, 2, 0.6, 2, '#29366f');
    this.box(6, 1.3, 3, 1.1, 1.6, 0.8, '#ffcd75');
    this.box(6, 2.3, 3, 1.5, 0.5, 0.9, '#ef7d57');
    for (let i = 0; i < 3; i++) this.box(5.4 + i * 0.6, 2.75, 3, 0.25, 0.5, 0.7, '#ffcd75');
    this.box(6, 1.65, 3.42, 0.65, 0.15, 0.08, '#1a1c2c');
    if (r.kind) {
      this.box(0, 0.25, 4, 2.4, 0.5, 1.3, '#566c86');
      if (!r.open) {
        this.box(0, 1.5, 4, 2.1, 2, 0.7, '#94b0c2');
        this.box(-0.25, 1.8, 4.4, 0.15, 0.6, 0.05, '#73eff7');
        this.box(0, 1.4, 4.4, 0.4, 0.15, 0.05, '#73eff7');
        this.box(0.2, 1.1, 4.4, 0.15, 0.6, 0.05, '#73eff7');
      } else {
        this.box(0, 0.04, 0, 11, 0.08, 10, '#29366f');
        for (let i = -5; i <= 5; i += 2) {
          this.box(i, 0.12, -4.8, 0.7, 0.18, 0.4, '#73eff7');
          this.box(-5.4, 0.35, i * 0.85, 0.35, 0.7, 0.7, '#94b0c2');
          this.box(5.4, 0.35, i * 0.85, 0.35, 0.7, 0.7, '#94b0c2');
        }
        // Three lamps are a permanent, colour-independent left / right / middle clue.
        for (let j = 0; j < 3; j++) {
          const order = SECRET_ORDER.indexOf(j as 0 | 1 | 2) + 1;
          const lit = r.kind === 'braziers' ? !!(r.mask & (1 << j)) : r.progress >= order;
          const c = lit || r.done ? '#a7f070' : r.kind === 'braziers' ? '#ef7d57' : '#73eff7';
          if (r.kind !== 'ice') {
            this.box((j - 1) * 3, 0.2, 0, 2, 0.3, 2, '#566c86');
            this.box((j - 1) * 3, r.kind === 'plates' ? 0.4 : 1.2, 0, 1.35, r.kind === 'plates' ? 0.15 : 1.5, 1.35, c);
            if (r.kind === 'runes' && secretBeat(time)) this.box((j - 1) * 3, 2.2, 0, 0.5, 0.25, 0.5, '#ffcd75');
            for (let k = 0; k < order; k++) this.box((j - 1) * 3 + (k - (order - 1) / 2) * 0.35, 0.46, 1.1, 0.2, 0.12, 0.35, '#f4f4f4');
            if (r.kind === 'braziers' && lit) this.box((j - 1) * 3, 2.3, 0, 0.55, 0.9, 0.55, '#ffcd75');
          }
        }
        if (r.kind === 'ice') {
          this.box(0, 0.16, -0.5, 8, 0.16, 3, r.ice > 0 || r.done ? '#73eff7' : '#3b5dc9');
          for (let j = -3; j <= 3; j++) this.box(j, 0.26, -0.5, 0.08, 0.06, 2.8, '#94b0c2');
          this.box(0, 0.7, 1.5, 0.8, 1.2, 0.8, '#73eff7');
        }
        if (r.kind === 'ice' || r.kind === 'braziers') {
          this.box(-4, 0.16, 3, 1.9, 0.2, 1.9, '#ffcd75');
          this.box(-4, 0.3, 3, 0.6, 0.2, 0.6, r.kind === 'ice' ? '#73eff7' : '#ef7d57');
        }
        // The developer nook and harmless dancing maintenance robot.
        this.box(0, 0.5, -4, 2.8, 0.8, 0.7, '#566c86');
        this.box(0, 1.1, -4, 1.4, 0.6, 0.3, '#a7f070');
        const dance = reduceMotion() ? 0 : Math.sin(time * 4) * 0.18;
        this.box(3 + dance, 0.9, -3.8, 0.65, 1, 0.6, '#41a6f6');
        this.box(3 + dance, 1.7, -3.8, 0.85, 0.65, 0.7, '#73eff7');
        this.box(3 + dance, 1.7, -3.4, 0.5, 0.16, 0.08, '#1a1c2c');
        this.box(2.4 + dance, 1.15 + dance, -3.8, 0.35, 0.7, 0.35, '#ffcd75');
        this.box(3.6 + dance, 1.15 - dance, -3.8, 0.35, 0.7, 0.35, '#ffcd75');
      }
    }
    this.mesh.count = this.n; commit(this.mesh.instanceMatrix, this.n); commit(this.mesh.instanceColor!, this.n);
  }
}
export function renderSecrets(g: Game): void {
  const s = secretsState(g);
  if (!s.wired) {
    s.wired = true;
    window.addEventListener('keydown', e => {
      if (g.mode !== 'title' || e.repeat || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) { s.code = 0; return; }
      s.code = konamiStep(s.code, e.code);
      if (s.code === 10) {
        s.code = 0;
        if (!saveLock.on && grantAchievement('secret_code')) { unlockMeta(); persist(); g.hud.toast(localize('OLD SCHOOL! PIXEL RELAY ARMOUR UNLOCKED'), 4); }
      }
    });
  }
  const r = s.room;
  if (!r || !g.isCombatMode) { if (s.view) { s.view.mesh.visible = false; s.view.panel.textContent = ''; } return; }
  s.view ??= new SecretView(g);
  s.view.draw(r, r.clock);
  const p = g.hero.player;
  let text = '';
  if (Math.hypot(p.x - r.x, p.z - r.z) < 15) {
    if (r.open) {
      text = r.done ? t('secrets.done') : t(`secrets.${r.kind!}`);
      if (!r.done && r.kind !== 'ice') text += '\n' + t('secrets.progress', { count: r.kind === 'braziers' ? ((r.mask & 1) + ((r.mask >> 1) & 1) + ((r.mask >> 2) & 1)) : r.progress });
    } else if (r.kind) text = t('secrets.wall');
    if (Math.hypot(p.x - (r.x + 6), p.z - (r.z + 3)) < 6) text = t('secrets.king', { count: Math.min(T.goldbugs, s.bugs) });
  }
  if (s.view.panel.textContent !== text) s.view.panel.textContent = text;
}
/** Deterministic QA links; no completion/reward bypass in normal play. */
export function secretsLinks(g: Game, q: URLSearchParams): void {
  const kind = q.get('secret');
  if (!kind && !q.has('secretboss')) return;
  const s = secretsState(g); prepare(g, s);
  if (kind && SECRET_PUZZLES.includes(kind as SecretPuzzle)) {
    s.room = findRoom(g, kind as SecretPuzzle);
    if (s.room) {
      s.room.open = !q.has('secretclosed');
      g.hero.player.teleport(s.room.x, s.room.z + 3);
      g.cam.zoom = Math.max(g.cam.zoom, 1.3);
      if (q.has('secretsolved')) reward(g, s);
    }
  }
  const boss = q.get('secretboss');
  if (SECRET_BOSSES.includes(boss as SecretBoss)) spawnSecretBoss(g, boss as SecretBoss);
}

export function secretsHolding(g: Game): boolean { const s = states.get(g); return !!s && (s.pendingShadow || (s.activeBoss >= 0 && g.boss?.uid === s.activeBoss)); }
const shadowScans = new WeakMap<Enemy, { uid: number; next: number }>();
/** Re-scan each held weapon including its current tracks/evolution. Enemy copy caps
 * keep the reflection fair even against a heavily upgraded co-op build. */
export function shadowWeapon(e: Enemy, h: Hero) {
  let scan = shadowScans.get(e);
  if (!scan || scan.uid !== e.uid) { scan = { uid: e.uid, next: 0 }; shadowScans.set(e, scan); }
  const slot = scan.next++ % (h.weapons.length + 1);
  const w = h.weapons[slot];
  if (!w) return { def: { id: h.special.id === 'blizzard' || h.special.id === 'well' ? 'orb' : 'scatter' }, p: { ...h.specialP, pellets: 9, spread: 320, rate: 0.75 } };
  const id = ['buster', 'scatter', 'laser', 'orb', 'rail'].includes(w.def.id) ? w.def.id
    : w.tags.includes('orbit') || w.tags.includes('chain') ? 'orb'
    : w.tags.includes('area') || w.tags.includes('trail') ? 'laser' : 'scatter';
  return { def: { id }, p: w.p };
}
