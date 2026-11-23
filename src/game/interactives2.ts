import { StaticBoxGrid } from '../core/spatialHash';
import { biomeForStage } from '../data/biomes';
import { machines, MACHINE_KINDS, SET_PIECES, type Machine } from '../data/setPieces';
import { t } from '../i18n';
import { viewCull } from '../render/viewCull';
import type { AABB } from '../world/collision';
import {
  bridgeGap,
  localX,
  localZ,
  pieceColliders,
  placePieces,
  SetPieceView,
  worldX,
  worldZ,
  type MachineState,
  type PlacedPiece,
} from '../world/setPieces';
import { bossLike } from './bossRules';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { hazardTuning } from './hazards';
import type { BurstOptions } from './particles';
import { settings } from './settings';
import { ARENA_SOURCE_NAMES, ENV_SOURCES } from './systems/arena';
import { coopPlayState } from './systems/coopplay';
import { customArenaActive } from './systems/editor';
import { attractRunning } from './systems/attract';

const fixedHit = (source: string) => ({ source, fixed: true, noStatus: true });
const hits = {
  spikes: fixedHit('floor_spikes'),
  bridge: fixedHit('drawbridge'),
  flood: fixedHit('sluice'),
  barrels: fixedHit('fuse_chain'),
};
for (const kind of MACHINE_KINDS) {
  if (kind === 'lure') continue;
  const { source } = hits[kind];
  if (!ENV_SOURCES.includes(source)) ENV_SOURCES.push(source);
  ARENA_SOURCE_NAMES[source] = machines[kind].name;
}
const fuseSparks: BurstOptions = {
  count: 12,
  color: '#ffcd75',
  color2: '#ef7d57',
  speed: [2, 5],
  life: [0.2, 0.45],
  size: [0.14, 0.34],
  up: 4,
};
const phases = ['ready', 'warning', 'active', 'cooldown'] as const;
const counts = () => ({ spikes: 0, bridge: 0, flood: 0, barrels: 0, lure: 0 });
const fresh = (p: PlacedPiece): MachineState => ({
  ...p,
  phase: 'ready',
  owner: -1,
  time: 0,
  pulse: 0,
  occupied: false,
});

function addWalls(g: Game, boxes: AABB[]) {
  const walls = g.arena.colliders;
  // A host can re-install the same vault while its client keeps the original
  // collider. Keep that removable box last on both peers.
  const vault = coopPlayState(g).box;
  const i = vault ? walls.indexOf(vault) : -1;
  walls.splice(i < 0 ? walls.length : i, 0, ...boxes);
}

export class FieldMachines {
  pieces: MachineState[] = [];
  uses = counts();
  previewKind: string | null = null;
  private arena?: Game['arena'];
  private view?: SetPieceView;
  private revision = 0;
  private drawn = -1;
  private visible = 0;
  private relays: AABB[][] = [];
  private gap?: AABB; // one bridge per island
  private hinted = new Set<Machine>();
  private sent = new WeakMap<object, { version: number; step: number }>();
  private pushed = new WeakMap<Enemy, { uid: number; owner: number; until: number }>();

  resetRun() {
    this.uses = counts();
    this.hinted.clear();
    this.previewKind = null;
  }

  private install(g: Game, layout: PlacedPiece[]) {
    this.arena = g.arena;
    this.view = undefined;
    this.drawn = -1;
    this.visible = 0;
    this.gap = undefined;
    this.pushed = new WeakMap();
    this.pieces = layout.map(fresh);
    const boxes: AABB[] = [];
    this.relays = layout.map((p) => pieceColliders(p, boxes));
    if (boxes.length) {
      addWalls(g, boxes);
      g.walls = new StaticBoxGrid(g.arena.colliders);
    }
    this.revision++;
  }

  private bridge(g: Game, p: MachineState, open: boolean) {
    if (open === !!this.gap) return;
    if (open) {
      this.gap = bridgeGap(p);
      addWalls(g, [this.gap]);
    } else {
      const i = g.arena.colliders.indexOf(this.gap!);
      if (i >= 0) g.arena.colliders.splice(i, 1);
      this.gap = undefined;
    }
    g.walls = new StaticBoxGrid(g.arena.colliders);
  }

  update(g: Game, dt: number) {
    if (!g.authority || g.mode !== 'fight') return;
    if (this.arena !== g.arena) {
      const allowed =
        !g.pvp &&
        !g.versus &&
        !g.onboarding.training &&
        !attractRunning(g) &&
        !customArenaActive(g) &&
        g.runMode !== 'raid' &&
        g.runMode !== 'gauntlet' &&
        g.runMode !== 'bossrush';
      this.install(g, allowed ? placePieces(g.arena, g.biomeRules.snapshot(g)?.xy ?? []) : []);
      const p = this.pieces.find((p) => SET_PIECES[p.plan].kind === this.previewKind);
      if (p && g.role === 'solo') g.player.teleport(worldX(p, 0, 4.5), worldZ(p, 0, 4.5));
      this.previewKind = null;
    }
    for (const p of this.pieces) {
      const kind = SET_PIECES[p.plan].kind,
        def = machines[kind];
      if (p.phase === 'ready') {
        let owner = -1;
        for (const h of g.heroes) {
          if (h.left || h.player.dead) continue;
          const x = h.player.x,
            z = h.player.z;
          if (Math.abs(localX(p, x, z)) <= 1.42 && Math.abs(localZ(p, x, z) - 2.65) <= 0.82) {
            owner = h.index;
            break;
          }
        }
        if (owner >= 0 && !p.occupied) this.arm(g, p, owner);
        p.occupied = owner >= 0;
        continue;
      }
      p.time -= dt;
      if (p.time > 0) continue;
      if (p.phase === 'cooldown') {
        p.phase = 'ready';
        p.owner = -1;
        p.pulse = 0;
      } else if (p.pulse < def.pulses) {
        p.phase = 'active';
        if (kind === 'bridge') this.bridge(g, p, true);
        this.fire(g, p, kind);
        p.pulse++;
        p.time += def.spacing;
      } else {
        p.phase = 'cooldown';
        if (kind === 'bridge') this.bridge(g, p, false);
        p.time = def.cooldown;
      }
      this.revision++;
    }
  }

  /** Called only for friendly shots that have already hit solid geometry. */
  hitRelay(g: Game, x: number, z: number, radius: number, owner: number): boolean {
    if (
      !g.authority ||
      this.arena !== g.arena ||
      g.mode !== 'fight' ||
      !g.heroes[owner] ||
      g.heroes[owner].left
    )
      return false;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (p.phase !== 'ready' || Math.abs(p.x - x) > 4 + radius || Math.abs(p.z - z) > 4 + radius)
        continue;
      for (const b of this.relays[i]) {
        const dx = x - Math.max(b.minX, Math.min(x, b.maxX)),
          dz = z - Math.max(b.minZ, Math.min(z, b.maxZ));
        if (dx * dx + dz * dz > radius * radius) continue;
        this.arm(g, p, owner);
        return true;
      }
    }
    return false;
  }

  private arm(g: Game, p: MachineState, owner: number) {
    const kind = SET_PIECES[p.plan].kind,
      def = machines[kind];
    p.occupied = true;
    p.owner = owner;
    p.phase = 'warning';
    p.time = def.warning;
    this.uses[kind]++;
    this.revision++;
    g.vfx.sound('powerUp', p.x, p.z, 1.25);
    if (kind === 'barrels') {
      for (let i = 0; i < 3; i++) {
        const z = 1.5 - i * 1.6;
        g.vfx.ring(
          worldX(p, 0, z),
          worldZ(p, 0, z),
          0.6,
          7.8,
          def.color,
          def.warning + i * def.spacing,
        );
      }
    } else g.vfx.ring(p.x, p.z, 0.8, kind === 'lure' ? 12.5 : 5.5, def.color, def.warning);
  }

  private fire(g: Game, p: MachineState, kind: Machine) {
    const owner = g.heroes[p.owner];
    if (!owner) return;
    const z =
      kind === 'barrels' ? 1.5 - 1.6 * p.pulse : kind === 'flood' ? -1.6 + 1.2 * p.pulse : 0;
    const xw = worldX(p, 0, z),
      zw = worldZ(p, 0, z),
      ink = machines[kind].color;
    g.vfx.ring(xw, zw, kind === 'lure' ? 8 : 0.6, kind === 'lure' ? 0.18 : 4, ink, 0.36);
    if (kind === 'barrels') {
      g.vfx.sound('explode', xw, zw, 1 + p.pulse * 0.15);
      g.vfx.burst(xw, 0.65, zw, fuseSparks);
    } else if (!p.pulse) g.vfx.sound(kind === 'lure' ? 'jumpPad' : 'impact', xw, zw, 1);
    // A bounded pool scan only on a machine pulse. Independent of the combat
    // spatial hash, which precedes enemy movement and can be queried by nested kills.
    for (const e of g.enemies.list) {
      if (
        !e.targetable ||
        e.hp <= 0 ||
        e.pvpOwner >= 0 ||
        bossLike(e) ||
        e.def.behavior === 'reaper'
      )
        continue;
      const dx = e.x - xw,
        dz = e.z - zw,
        r = Math.min(0.6, e.radius);
      if (kind === 'lure') {
        const dist = Math.hypot(dx, dz);
        if (dist < 0.42 || dist > 5 + r) continue;
        this.push(g, e, p.owner, (-dx / dist) * 8, (-dz / dist) * 8);
        continue;
      }
      const x = localX(p, e.x, e.z),
        along = localZ(p, e.x, e.z);
      if (kind === 'barrels' && dx * dx + dz * dz > (2.35 + r) ** 2) continue;
      if (kind === 'spikes' && (Math.abs(x) > 1.7 + r || Math.abs(along) > 1.7 + r)) continue;
      if (kind === 'bridge' && (Math.abs(x) > 1.1 + r || Math.abs(along) > 1.8 + r)) continue;
      if (kind === 'flood') {
        if (Math.abs(x) > 1.65 + r || Math.abs(along - z) > 0.75 + r) continue;
        this.push(g, e, p.owner, (xw - worldX(p, 0, z - 1)) * 9, (zw - worldZ(p, 0, z - 1)) * 9);
      }
      if (kind === 'bridge') {
        // The missing deck exposes the hazard underneath. Elites survive the
        // same capped bite as a knock into a natural hazard.
        const fall = e.elite ? e.maxHp * hazardTuning.eliteFrac : e.hp + e.shield + 1;
        g.damage(e, fall, hits.bridge, owner);
        continue;
      }
      const base = machines[kind].damage;
      g.damage(e, base + (g.stage - 1) * base * 0.16, hits[kind], owner);
    }
  }

  private push(g: Game, e: Enemy, owner: number, x: number, z: number) {
    const scale = 1 - e.def.knockbackResist;
    if (scale <= 0) return;
    e.kx = x * scale;
    e.kz = z * scale;
    const previous = this.pushed.get(e);
    if (previous) {
      previous.uid = e.uid;
      previous.owner = owner;
      previous.until = g.runTime + 0.8;
    } else this.pushed.set(e, { uid: e.uid, owner, until: g.runTime + 0.8 });
  }

  pushOwner(g: Game, e: Enemy) {
    const push = this.pushed.get(e);
    if (push && push.uid === e.uid && push.until >= g.runTime) return g.heroes[push.owner];
  }

  prepareView(g: Game) {
    // Three generates object IDs using Math.random. Allocate once per stage
    // before other rendering, independently of when a room enters the camera.
    if (!this.view && this.arena === g.arena && this.pieces.length)
      this.view = new SetPieceView(g.arena.group);
  }

  render(g: Game) {
    if (!this.view || this.arena !== g.arena) return;
    let visible = 0;
    for (let n = 0; n < this.pieces.length; n++) {
      const p = this.pieces[n];
      if (viewCull.sphere(p.x, 1.1, p.z, 5.5)) visible |= 1 << n;
    }
    if (this.drawn !== this.revision || visible !== this.visible) {
      this.view.draw(this.pieces, visible, biomeForStage(g.arenaStage).rules?.stone ?? '#788d9b');
      this.visible = visible;
      this.drawn = this.revision;
    }
    if (
      this.hinted.size === MACHINE_KINDS.length ||
      !settings.tips ||
      g.hero.player.dead ||
      g.mode !== 'fight' ||
      g.screens.current !== 'none'
    )
      return;
    for (const p of this.pieces) {
      if ((p.x - g.player.x) ** 2 + (p.z - g.player.z) ** 2 < 36) {
        const kind = SET_PIECES[p.plan].kind;
        if (this.hinted.has(kind)) continue;
        this.hinted.add(kind);
        g.hud.toast(t('g7.machine.tip.' + kind), 3);
        break;
      }
    }
  }

  snapshotFor(g: Game, recipient: object): number[] | undefined {
    if (this.arena !== g.arena || !this.pieces.length) return;
    const last = this.sent.get(recipient);
    if (last && last.version === this.revision && g.stepN - last.step < 90) return;
    this.sent.set(recipient, { version: this.revision, step: g.stepN });
    const data = [g.arena.seed];
    for (const p of this.pieces)
      data.push(
        p.plan,
        p.turn,
        p.x,
        p.z,
        phases.indexOf(p.phase),
        p.owner,
        Math.max(0, Math.round(p.time * 60)),
        p.pulse,
        Number(p.occupied),
      );
    return data;
  }

  mirror(g: Game, data: unknown) {
    if (
      !Array.isArray(data) ||
      data[0] !== g.arena.seed ||
      data.length < 10 ||
      data.length > 46 ||
      (data.length - 1) % 9 ||
      !data.every(Number.isSafeInteger)
    )
      return;
    const count = (data.length - 1) / 9;
    const layout: PlacedPiece[] | undefined = this.arena !== g.arena ? [] : undefined;
    if (!layout && count !== this.pieces.length) return;
    // Validate the entire packet before changing geometry or timers. A stale
    // layout with the same seed must never partially advance a different island.
    let seen = 0;
    for (let n = 0; n < count; n++) {
      const i = 1 + n * 9,
        plan = data[i],
        turn = data[i + 1],
        x = data[i + 2],
        z = data[i + 3];
      const phase = phases[data[i + 4]],
        owner = data[i + 5],
        time = data[i + 6],
        pulse = data[i + 7];
      const kind = SET_PIECES[plan]?.kind;
      if (
        !kind ||
        turn < 0 ||
        turn > 3 ||
        Math.max(Math.abs(x), Math.abs(z)) > g.arena.halfSize - 4 ||
        !phase ||
        owner < (phase === 'ready' ? -1 : 0) ||
        owner >= g.heroes.length ||
        time < 0 ||
        time > machines[kind].cooldown * 60 ||
        pulse < 0 ||
        pulse > machines[kind].pulses ||
        (data[i + 8] !== 0 && data[i + 8] !== 1)
      )
        return;
      const bit = 1 << MACHINE_KINDS.indexOf(kind);
      if (seen & bit) return;
      seen |= bit;
      if (layout) layout.push({ plan, turn, x, z });
      else {
        const p = this.pieces[n];
        if (p.plan !== plan || p.turn !== turn || p.x !== x || p.z !== z) return;
      }
    }
    if (layout) this.install(g, layout);
    for (let n = 0; n < count; n++) {
      const p = this.pieces[n],
        i = 1 + n * 9;
      const phase = phases[data[i + 4]],
        pulse = data[i + 7];
      if (p.phase !== phase || p.pulse !== pulse) this.revision++;
      p.phase = phase;
      p.owner = data[i + 5];
      p.time = data[i + 6] / 60;
      p.pulse = pulse;
      p.occupied = !!data[i + 8];
      if (SET_PIECES[p.plan].kind === 'bridge') this.bridge(g, p, phase === 'active');
    }
  }
}
