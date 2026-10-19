/**
 * Biome bosses (bosses3 lane): the Game side of Glitch DJ, Boxer Jack and
 * Admiral Gale. Brains are in src/game/bosses3.ts; their arena state and
 * drawing in src/game/bosses3Field.ts. These are Game functions (`this` is the
 * Game), called from src/game/systems/bossFight.ts (boss api, step, net,
 * render) and runFlow.ts (world reset). Per-game state lives in a WeakMap here,
 * so Game gains no fields.
 *
 * Host: the DJ's beat clock, laser-grid and punch-line damage, gusts (heroes
 * are shoved through `tell` on clients, every bullet drifts), boarding parties
 * and lightning. Clients: the snapshot's boss extras carry `g`
 * (Bosses3Net); the clocks run on locally between snapshots. Every machine
 * pulls its music onto the DJ's beat (`music.alignBeat`).
 */
import type { Game } from '../game';
import { ENEMIES } from '../../data/enemies';
import { Bosses3Field, type Bosses3Net } from '../bosses3Field';
import { BOSS3_BEHAVIORS, beatAt, bosses3Tuning, gridDist, segDist3, type Boss3Cue, type Bosses3Api } from '../bosses3';
import { windTuning } from '../wind';
import { Team } from '../bullets';
import { access } from '../settings';
import { music } from '../../audio/music';
import { b3Sound } from '../../audio/bosses3Cues';
import type { Enemy } from '../enemies';

interface Lane3 {
  field: Bosses3Field | null;
  /** Last phase seen per biome boss uid (the REMIX cue). */
  phases: Map<number, number>;
  /** Host: any biome boss on the field this step. */
  live: boolean;
}

const lanes = new WeakMap<Game, Lane3>();
function lane(g: Game): Lane3 {
  let L = lanes.get(g);
  if (!L) lanes.set(g, (L = { field: null, phases: new Map(), live: false }));
  return L;
}

/** The arena (created on first use; tests read it). */
export function bosses3Field(g: Game): Bosses3Field {
  const L = lane(g);
  return (L.field ??= new Bosses3Field(g.scene));
}

const BEAT = { n: 0, f: 0 };

// ------------------------------------------------------------------ api (host)

export function makeBosses3Api(this: Game): Bosses3Api {
  const T = bosses3Tuning;
  const f = () => bosses3Field(this);
  const lim = () => this.arena.halfSize - 2;
  return {
    clock: () => f().clock,
    grid: (e, cx, cz, ang, beats, flip) => {
      const F = f();
      if (F.grids.length >= 4) return;
      const L = lim() - 6;
      beatAt(F.clock, BEAT);
      const mini = !!e.def.miniboss;
      F.grids.push({
        cx: Math.max(-L, Math.min(L, cx)),
        cz: Math.max(-L, Math.min(L, cz)),
        ang,
        n: mini ? 7 : T.gridLines,
        sp: T.gridSpacing,
        len: mini ? T.gridLength * 0.7 : T.gridLength,
        b0: BEAT.n,
        beats,
        flip,
        dmg: T.gridDamage * e.dmgMul,
        hit: 0,
        hitBeat: -1,
      });
      this.vfx.sound(b3Sound('scratch'), e.x, e.z, 1.2);
    },
    beam: (_e, x, z, ang, len, half, tele, life, dmg) => {
      const F = f();
      if (F.beams.length >= 24) return;
      F.beams.push({ x, z, ang, len, half, tele, life, dmg, hit: 0, kind: 0 });
    },
    path: (_e, pts, tele) => {
      const F = f();
      for (let i = 0; i + 3 < pts.length && F.beams.length < 24; i += 2) {
        const dx = pts[i + 2] - pts[i];
        const dz = pts[i + 3] - pts[i + 1];
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        F.beams.push({ x: pts[i], z: pts[i + 1], ang: Math.atan2(dz, dx), len, half: 0.2, tele, life: 0, dmg: 0, hit: 0, kind: 1 });
      }
    },
    gust: (e, dx, dz, tele, life) => {
      const d = Math.hypot(dx, dz) || 1;
      f().gust = { dx: dx / d, dz: dz / d, tele, life, pulse: 0 };
      this.vfx.toast('WIND GUST! BULLETS DRIFT', 1.6);
      this.vfx.sound('whoosh', e.x, e.z, 0.7);
    },
    board: (e, x, z, n) => {
      const F = f();
      const L = lim();
      x = Math.max(-L, Math.min(L, x));
      z = Math.max(-L, Math.min(L, z));
      if (this.walls.hitCircle(x, z, 0.8) || F.boards.length >= 4) return;
      F.boards.push({ x, z, t: 1.1, n, uid: e.uid });
      this.vfx.zone(x, z, 1.6, 1.1);
      this.vfx.sound(b3Sound('horn'), x, z, 1.2);
    },
    bolt: (e, x, z, delay) => {
      const F = f();
      if (F.bolts.length >= 24) return;
      F.bolts.push({ x, z, t: delay, shown: 0, dmg: T.boltDamage * e.dmgMul });
      this.vfx.zone(x, z, T.boltRadius, delay);
    },
    mark: (x, z, r, t) => this.vfx.zone(x, z, r, t),
    cue: (e, kind) => bossCue(this, e, kind),
  };
}

function bossCue(g: Game, e: Enemy, kind: Boss3Cue): void {
  g.vfx.sound(b3Sound(kind), e.x, e.z, e.def.miniboss ? 1.2 : 1);
  if (kind === 'drop') {
    g.vfx.shake(e.x, e.z, e.def.miniboss ? 0.5 : 0.9);
    g.vfx.ring(e.x, e.z, e.radius, 14, '#ff3df0', 0.5);
    g.vfx.ring(e.x, e.z, e.radius, 9, '#73eff7', 0.4);
    g.juice.freeze(0.05);
  } else if (kind === 'scratch') {
    g.vfx.ring(e.x, e.z, e.radius, 5, '#ff3df0', 0.3); // the drop's count-in
  } else if (kind === 'bounce') {
    g.vfx.shake(e.x, e.z, 0.4);
    g.vfx.burst(e.x, 0.6, e.z, { count: 10, color: '#ffcd75', color2: '#ef7d57', speed: [3, 8], size: [0.15, 0.3], life: [0.3, 0.6], up: 4, gravity: 12 });
  } else if (kind === 'cannon') {
    g.vfx.burst(e.x, 1.5 + e.hopY, e.z, { count: 8, color: '#f4f4f4', color2: '#94b0c2', speed: [1, 3], size: [0.3, 0.6], life: [0.4, 0.8], up: 1, gravity: -1 });
  } else if (kind === 'pop') {
    g.vfx.burst(e.x, 2.5, e.z, { count: 16, color: '#ff3d5a', color2: '#ffcd75', speed: [3, 7], size: [0.15, 0.3], life: [0.4, 0.8], up: 6, gravity: 12 });
  }
}

// ------------------------------------------------------------------ host step

/** Host: hazards hurt, gusts blow, boarding parties land, lightning strikes. */
export function updateBosses3(this: Game, dt: number): void {
  const L = lane(this);
  // Which biome bosses are on the field (and is a DJ keeping the beat)?
  let dj = false;
  let any = false;
  for (const e of this.enemies.list) {
    if (!e.active || !BOSS3_BEHAVIORS.includes(e.def.behavior)) continue;
    any = true;
    if (e.def.behavior === 'glitch') dj = true;
    // REMIX! when the DJ's last phase starts.
    const was = L.phases.get(e.uid) ?? 1;
    if (e.phase !== was) {
      L.phases.set(e.uid, e.phase);
      if (e.def.behavior === 'glitch' && e.phase >= 3 && !e.def.miniboss) {
        bossCue(this, e, 'remix');
        this.vfx.toast('REMIX! THE GRID PLAYS BACK AND FORTH', 2.4);
      }
    }
  }
  L.live = any;
  if (!any && !L.field) return;
  const F = bosses3Field(this);
  if (dj && !F.clockOn) F.clock = 0;
  F.clockOn = dj;
  if (dj) F.clock += dt;
  if (!any) {
    // The boss is gone: its hazards go with it (bolts already falling still land).
    F.grids.length = 0;
    F.beams.length = 0;
    F.gust = null;
    F.boards.length = 0;
    L.phases.clear();
  }
  const T = bosses3Tuning;
  const heroes = this.aliveHeroes;
  // Laser grids: lines burn for a moment on each hot beat.
  beatAt(F.clock, BEAT);
  for (let i = F.grids.length - 1; i >= 0; i--) {
    const g = F.grids[i];
    if (BEAT.n > g.b0 + 1 + g.beats) {
      F.grids.splice(i, 1);
      continue;
    }
    const s = F.hotShift(g);
    if (Number.isNaN(s)) continue;
    if (g.hitBeat !== BEAT.n) {
      g.hitBeat = BEAT.n;
      g.hit = 0;
    }
    for (const h of heroes) {
      const p = h.player;
      const bit = 1 << h.index;
      if (g.hit & bit || p.dashing || p.invuln > 0) continue;
      if (gridDist(p.x, p.z, g.cx, g.cz, g.ang, g.n, g.sp, g.len, s) < T.gridHalf + p.radius * 0.5) {
        g.hit |= bit;
        this.hurtHero(h, g.dmg, p.x - Math.cos(g.ang), p.z - Math.sin(g.ang), null, 'Glitch DJ\'s laser grid');
      }
    }
  }
  // Punch lines (and pinball path telegraphs, which only show).
  for (let i = F.beams.length - 1; i >= 0; i--) {
    const b = F.beams[i];
    if (b.tele > 0) {
      b.tele -= dt;
      if (b.tele > 0 || b.kind === 1) {
        if (b.kind === 1 && b.tele <= 0) F.beams.splice(i, 1);
        continue;
      }
      // Just went hot: the glove lands.
      this.vfx.shake(b.x + Math.cos(b.ang) * b.len, b.z + Math.sin(b.ang) * b.len, 0.35);
      this.vfx.burst(b.x + Math.cos(b.ang) * b.len, 1, b.z + Math.sin(b.ang) * b.len, { count: 12, color: '#ffffff', color2: '#ff3d5a', speed: [3, 8], size: [0.2, 0.4], life: [0.2, 0.5], up: 3, gravity: 10 });
    }
    b.life -= dt;
    if (b.life <= 0) {
      F.beams.splice(i, 1);
      continue;
    }
    for (const h of heroes) {
      const p = h.player;
      const bit = 1 << h.index;
      if (b.hit & bit || p.dashing || p.invuln > 0) continue;
      if (segDist3(p.x, p.z, b.x, b.z, b.ang, b.len) < b.half + p.radius * 0.5) {
        b.hit |= bit;
        this.hurtHero(h, b.dmg, b.x, b.z, null, 'Boxer Jack\'s punch');
      }
    }
  }
  // Gust: shoves heroes (dash to hold your ground) and pushes every bullet.
  const w = F.gust;
  if (w) {
    if (w.tele > 0) w.tele -= dt;
    else {
      w.life -= dt;
      if (w.life <= 0) F.gust = null;
      else {
        if ((w.pulse -= dt) <= 0) {
          w.pulse = 0.2;
          for (const h of heroes) {
            const p = h.player;
            if (p.dashing) continue;
            if (h === this.hero) p.shove(w.dx, w.dz, T.gustShove);
            else this.tell(h, { t: 'shove', dx: w.dx, dz: w.dz, f: T.gustShove });
          }
        }
        const b = this.bullets;
        const ax = w.dx * T.gustBullets * dt;
        const az = w.dz * T.gustBullets * dt;
        for (let i = 0; i < b.count; i++) {
          const k = b.team[i] === Team.Enemy ? windTuning.enemyBullets : windTuning.playerBullets;
          b.vx[i] += ax * k;
          b.vz[i] += az * k;
        }
      }
    }
  }
  // Boarding parties drop in.
  for (let i = F.boards.length - 1; i >= 0; i--) {
    const bd = F.boards[i];
    if ((bd.t -= dt) > 0) continue;
    F.boards.splice(i, 1);
    for (let k = 0; k < bd.n; k++) {
      if (this.enemies.activeCount >= 480) break;
      const a = (k / bd.n) * Math.PI * 2;
      const x = bd.x + Math.cos(a) * 1.1;
      const z = bd.z + Math.sin(a) * 1.1;
      if (this.walls.hitCircle(x, z, 0.5)) continue;
      const e = this.enemies.spawn(ENEMIES.deckhand, x, z, this.spawnOpts({ instant: true }));
      e.squash(10);
    }
    this.vfx.burst(bd.x, 0.5, bd.z, { count: 14, color: '#b13e53', color2: '#ffcd75', speed: [3, 7], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, gravity: 14 });
    this.vfx.ring(bd.x, bd.z, 0.8, 3, '#ffcd75', 0.3);
    this.vfx.sound('spawn', bd.x, bd.z);
  }
  // Lightning.
  for (let i = F.bolts.length - 1; i >= 0; i--) {
    const b = F.bolts[i];
    if (b.t > 0) {
      b.t -= dt;
      if (b.t > 0) continue;
      for (const h of heroes) {
        const p = h.player;
        if (Math.hypot(p.x - b.x, p.z - b.z) < T.boltRadius + p.radius * 0.5) this.hurtHero(h, b.dmg, b.x, b.z, null, 'Lightning');
      }
      this.vfx.burst(b.x, 0.4, b.z, { count: 14, color: '#fff6a0', color2: '#73eff7', speed: [4, 10], size: [0.15, 0.3], life: [0.2, 0.45], up: 6, gravity: 10 });
      this.vfx.ring(b.x, b.z, 0.6, T.boltRadius * 2, '#fff6a0', 0.25);
      this.vfx.sound('thunder', b.x, b.z, 1.2);
      this.vfx.scar(b.x, b.z, 1.0, '#333c57', 8);
      if (!access.reduceFlash) this.vfx.flash(0.08);
      continue;
    }
    b.shown += dt;
    if (b.shown > 0.35) F.bolts.splice(i, 1);
  }
}

// ------------------------------------------------------------------ net

/** Host: the boss extras' `g` field (undefined when there's nothing to send). */
export function bosses3Net(this: Game): Bosses3Net | undefined {
  const L = lane(this);
  const F = L.field;
  if (!F || (!L.live && !F.bolts.length)) return undefined;
  return F.pack();
}

/** Client: mirror the arena. */
export function applyBosses3Net(this: Game, n: Bosses3Net | undefined): void {
  if (!n && !lane(this).field) return;
  bosses3Field(this).unpack(n);
}

/** World reset (every machine). */
export function clearBosses3(this: Game): void {
  const L = lane(this);
  L.field?.clear();
  L.phases.clear();
  L.live = false;
}

// ------------------------------------------------------------------ render (every machine)

export function renderBosses3(this: Game, frameDt: number, paused: boolean): void {
  const L = lane(this);
  const F = L.field;
  if (!F) return;
  if (this.role === 'client' && !paused) F.advance(frameDt);
  F.render(this.enemies.list, this.animTime, this.playerPos.x, this.playerPos.z, access.reduceFlash);
  // The DJ's beat drives the music: pull the boss track onto its grid.
  if (F.clockOn && music.playing === 'glitch') {
    beatAt(F.clock, BEAT);
    music.alignBeat(BEAT.f, 0.003);
  }
}
