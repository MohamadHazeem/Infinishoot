import { Vector3 } from 'three';
import type { Input } from '../core/input';
import { ENEMIES } from '../data/enemies';
import { Autopilot } from '../game/autopilot';
import { bossMoveTuning } from '../game/bosses';
import { Team } from '../game/bullets';
import type { Enemy } from '../game/enemies';
import { cheats, type Game } from '../game/game';
import { economyTuning } from '../game/hero';
import { PickupType } from '../game/pickups';
import { bulletThreat, skillTuning as combat } from '../game/style';
import { goldenPortalAt } from '../game/systems/cinematics';
import { pilotModes } from '../game/systems/modes';
import { ChargeShot } from '../game/weapons/charge';

export const skillTuning = { reactionMs: 180, aimErrorDeg: 4, decisionHz: 10 };
type SkillOptions = Partial<typeof skillTuning>;
const dt = 1 / 60;
// Rex's brain supplies these in code. The ground line in Enemies.render uses the same fallback.
const rexCharge = { speed: 24, duration: 0.5 };
const command = () => ({
  mx: 0,
  mz: 0,
  ax: 0,
  az: 0,
  charge: false,
  special: false,
  parry: false,
  dash: false,
  ult: false,
});
type Command = ReturnType<typeof command>;

/** Only the command computed from the old observation goes into the delay line.
 * In particular, it cannot follow a mutable enemy position during reaction time. */
class SkilledPilot {
  private readonly nav = new Autopilot();
  private readonly ndc = new Vector3();
  private readonly queue: Command[];
  private readonly delay: number;
  private readonly interval: number;
  private readonly error: number;
  private frame = 0;
  private nextSample = 0;
  private readonly held = command();
  private urgency = Infinity;

  constructor(opts: SkillOptions) {
    const { reactionMs, decisionHz, aimErrorDeg } = { ...skillTuning, ...opts };
    if (!(
      decisionHz > 0 &&
      decisionHz <= 60 &&
      reactionMs >= 0 &&
      reactionMs <= 2000 &&
      aimErrorDeg >= 0 &&
      aimErrorDeg <= 180
    ))
      throw new RangeError('Invalid skill tuning');
    this.delay = Math.ceil(reactionMs * 0.06);
    this.interval = 60 / decisionHz;
    this.error = (aimErrorDeg * Math.PI) / 180;
    this.queue = Array.from({ length: this.delay + 1 }, command);
  }

  step(g: Game): Command {
    const i = this.frame;
    const slot = this.queue[i % this.queue.length];
    // NaN marks a frame without a new observation.
    slot.mx = NaN;
    if (i >= this.nextSample) {
      this.observe(g, slot);
      this.nextSample += this.interval;
    }
    const delayed = this.queue[(i + 1) % this.queue.length];
    this.held.parry = this.held.dash = this.held.ult = this.held.special = false;
    if (i >= this.delay && Number.isFinite(delayed.mx)) Object.assign(this.held, delayed);
    this.frame++;
    return this.held;
  }

  private visible(g: Game, x: number, z: number): boolean {
    const v = this.ndc.set(x, 0.6, z).project(g.cam.camera);
    return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1;
  }

  /** Choose the most urgent intersecting tell. Move perpendicular to lines,
   * out of discs, and into approaching wave fronts to cross them quickly. */
  private evade(o: Command, mx: number, mz: number, eta: number, parry = false): void {
    if (eta >= this.urgency) return;
    this.urgency = eta;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      o.mx = mx / len;
      o.mz = mz / len;
    }
    o.parry = parry && eta <= this.delay * dt + combat.parryWindow;
    o.dash = eta <= this.delay * dt + 0.23;
  }

  private disc(g: Game, o: Command, x: number, z: number, r: number, eta: number): void {
    const dx = g.player.x - x,
      dz = g.player.z - z;
    if (dx * dx + dz * dz < (r + g.player.radius + 0.4) ** 2) this.evade(o, dx, dz, eta);
  }

  private seesEnemy(g: Game, e: Enemy): boolean {
    return (
      e.targetable &&
      (!e.def.hidden || !!e.def.titanPart || e.def.behavior === 'titan') &&
      (!g.enemies.bodyVisible || g.enemies.bodyVisible(e.x, e.z)) &&
      this.visible(g, e.x, e.z)
    );
  }

  private line(g: Game, o: Command, e: Enemy): void {
    if (e.frozen > 0) return;
    const def = e.def;
    if (def.fuse) this.disc(g, o, e.x, e.z, def.fuse.radius, e.t);
    if (e.action === 'slam' || def.leap)
      this.disc(g, o, e.targetX, e.targetZ, def.leap ? def.leap.radius * e.scale : 3.8, e.t);
    let strike: { speed: number; duration: number } | undefined = def.lunge;
    if (!strike && (def.behavior === 'charger' || e.action === 'charge'))
      strike = def.charge ?? (def.behavior === 'rex' ? rexCharge : undefined);
    const sniper = def.shoot?.pattern === 'sniper';
    if (!strike && !sniper) return;
    const dx = g.player.x - e.x,
      dz = g.player.z - e.z;
    const lx = e.lungeX,
      lz = e.lungeZ;
    const along = dx * lx + dz * lz,
      across = dz * lx - dx * lz;
    const reach = strike ? strike.speed * strike.duration + e.radius : 20;
    if (
      along < -0.2 ||
      along > reach ||
      Math.abs(across) > g.player.radius + (sniper ? 0.35 : e.radius) + 0.6
    )
      return;
    const side = Math.sign(Math.abs(across) > 0.15 ? across : o.mz * lx - o.mx * lz) || 1;
    const eta =
      (e.state === 'windup' ? e.t : 0) +
      Math.max(0, along - e.radius) / (strike?.speed ?? def.shoot!.speed);
    this.evade(o, -lz * side, lx * side, eta, !sniper);
  }

  private observe(g: Game, o: Command): void {
    const p = g.player,
      h = g.hero;
    this.urgency = Infinity;
    o.ax = o.az = 0;
    o.charge = o.special = o.ult = o.dash = o.parry = false;
    const radial = Math.hypot(p.x, p.z) || 1;
    const inward = (12 - radial) * 0.12;
    o.mx = (-p.z + p.x * inward) / radial;
    o.mz = (p.x + p.z * inward) / radial;
    if (!o.mx && !o.mz) o.mx = 1;
    if (g.mode === 'portal') {
      const to = goldenPortalAt(g) ?? g.portal;
      [o.mx, o.mz] = this.nav.steer(g, p.x, p.z, to.x, to.z);
      this.normalize(o);
      return;
    }
    let best: Enemy | null = null;
    let score = -Infinity,
      crowd = 0,
      near = Infinity,
      awayX = 0,
      awayZ = 0;
    for (const e of g.enemies.list) {
      if (!this.seesEnemy(g, e)) continue;
      const dx = p.x - e.x,
        dz = p.z - e.z;
      const d = Math.hypot(dx, dz),
        gap = d - e.radius;
      near = Math.min(near, gap);
      if (gap < 5) {
        const force = (5 - gap) / (Math.max(0.5, d) * 2);
        awayX += dx * force;
        awayZ += dz * force;
        crowd++;
      }
      const priority = (e.def.boss || e.def.titanPart ? 24 : e.elite ? 2 : 0) - d;
      if (priority > score) {
        best = e;
        score = priority;
      }
    }
    if (best?.def.boss || best?.def.titanPart) {
      const dx = p.x - best.x,
        dz = p.z - best.z,
        d = Math.hypot(dx, dz) || 1;
      const want = (7 - d) * 0.4;
      o.mx = (-dz + dx * want) / d;
      o.mz = (dx + dz * want) / d;
    }
    // A nearby heart or magnet is worth a detour if there is room.
    let lootDistance = 9;
    for (let i = 0; i < g.pickups.count; i++) {
      const t = g.pickups.type[i];
      if (t !== PickupType.Magnet && !(t === PickupType.Heart && p.hp < p.maxHp * 0.85)) continue;
      const x = g.pickups.x[i],
        z = g.pickups.z[i],
        d = Math.hypot(x - p.x, z - p.z);
      if (d < lootDistance && this.visible(g, x, z)) {
        lootDistance = d;
        o.mx = (x - p.x) / (d || 1);
        o.mz = (z - p.z) / (d || 1);
      }
    }
    o.mx += awayX;
    o.mz += awayZ;
    const modeTarget = pilotModes(g, o);
    const target = modeTarget === undefined ? best : modeTarget;
    if (target) {
      const a =
        Math.atan2(target.z - p.z, target.x - p.x) + this.error * Math.sin(this.frame * 0.137);
      o.ax = Math.cos(a);
      o.az = Math.sin(a);
      const right = h.weapons.find((w) => w.def.slot === 'secondary');
      o.charge =
        right instanceof ChargeShot ? right.charge < (h.synergy.flags.overcharge ? 2 : 1) : true;
    }
    o.special = h.bombCharge >= 1 && (crowd >= 3 || !!best?.def.boss || near < 1.5);
    o.ult = h.skill.ult >= 1 && (crowd >= 4 || !!best?.def.boss);
    // Ordinary melee can only be parried at contact; windups and bullets below
    // get the wider predictive window. Avoid mashing parry beside a harmless foe.
    o.parry = near < p.radius + 0.35;
    o.dash = near < 0.95 && crowd >= 2;
    for (const e of g.enemies.list) {
      if ((e.state === 'windup' || e.state === 'attack') && this.seesEnemy(g, e))
        this.line(g, o, e);
    }
    for (const st of g.strikes)
      if (st.dmg > 0 && this.visible(g, st.x, st.z)) this.disc(g, o, st.x, st.z, st.r, st.t);
    for (const w of g.bossField.waves) {
      if (w.delay > 0 || w.r <= 0) continue; // the ring has not appeared yet
      const dx = w.x - p.x,
        dz = w.z - p.z;
      const d = Math.hypot(dx, dz),
        gap = d - w.r;
      if (gap < 0 || gap > 4.5) continue;
      const eta = gap / bossMoveTuning.shockSpeed;
      if (eta <= this.delay * dt + 0.17) this.evade(o, dx, dz, eta);
    }
    const b = g.bullets;
    for (let i = 0; i < b.count; i++) {
      if (b.team[i] !== Team.Enemy || !this.visible(g, b.x[i], b.z[i])) continue;
      const vx = b.vx[i] - p.vel.x,
        vz = b.vz[i] - p.vel.z;
      const dx = p.x - b.x[i],
        dz = p.z - b.z[i];
      const eta = (dx * vx + dz * vz) / (vx * vx + vz * vz || 1);
      if (
        eta < 0 ||
        !bulletThreat(p.x, p.z, b.x[i], b.z[i], vx, vz, p.radius + b.radius[i] + 0.2, 0.48)
      )
        continue;
      const side = Math.sign(vx * o.mz - vz * o.mx) || 1;
      this.evade(o, -vz * side, vx * side, eta, true);
    }
    this.normalize(o);
    // A missed parry still has a visible cooldown. Use the dash instead if ready.
    if (h.skill.parryCd > 0) o.parry = false;
    if (p.dashReady01 < 1) o.dash = false;
    if (!g.walls.segmentClear(p.x, p.z, p.x + 2 * o.mx, p.z + 2 * o.mz, p.radius)) {
      [o.mx, o.mz] = this.nav.steer(g, p.x, p.z, p.x + 3 * o.mx, p.z + 3 * o.mz);
      this.normalize(o);
    }
  }

  private normalize(o: Command): void {
    const len = Math.hypot(o.mx, o.mz) || 1;
    o.mx /= len;
    o.mz /= len;
  }
}

function bestIndex<T>(items: readonly T[], value: (item: T) => number): number {
  let index = -1,
    best = -Infinity;
  items.forEach((item, i) => {
    const score = value(item);
    if (score > best) {
      best = score;
      index = i;
    }
  });
  return index;
}

function menus(g: Game): void {
  const h = g.hero;
  const act = (a: string, i = 0) => g.heroAction(h, a, i, 1);
  if (g.mode === 'levelup' && h.needsPick) {
    const pick = bestIndex(h.offers, (card) => {
      const synergy = card.tags?.reduce((n, tag) => n + h.synergy.tagCount(tag), 0) ?? 0;
      if (card.kind === 'heal' && h.player.hp < h.player.maxHp * 0.45) return 18;
      if (card.kind === 'fusion' || card.kind === 'evo' || card.kind === 'evolve') return 16;
      if (card.id === 'vampire' || card.id === 'armor' || card.id === 'nanobots')
        return h.player.hp < h.player.maxHp * 0.75 ? 12 : 6;
      const base =
        card.slot === 'left' ? 7 : card.slot === 'auto' ? 6 : card.slot === 'right' ? 5 : 1;
      return (
        base + Math.min(4, synergy) + (card.partner?.haveWeapon && !card.partner.haveItem ? 3 : 0)
      );
    });
    if (pick >= 0) act('pick', pick);
  } else if (g.mode === 'shop') {
    if (g.route.open) {
      if (g.route.decided >= 0 || g.route.votes[g.local] >= 0) return;
      let pick = 0;
      if (g.route.phase === 'map') {
        const r = g.route;
        const view = g.routeViewFrom(
          {
            phase: r.phase,
            stage: g.stage,
            seed: g.seed,
            path: r.path,
            options: r.options,
            votes: r.votes,
            tl: -1,
            ev: r.event,
          },
          -1,
        );
        const layer = view.layers.find((layer) => layer.stage === g.stage + 1)!;
        const order = ['treasure', 'shop', 'rest', 'rhythm', 'event', 'elite', 'hard'];
        if (g.player.hp < g.player.maxHp * 0.7) order.unshift('rest');
        pick = bestIndex(g.route.options, (i) => {
          const rank = order.indexOf(layer.nodes[i].kind);
          return rank < 0 ? -10 : -rank;
        });
      }
      g.routePick(pick);
    } else if (!h.shopDone) {
      if (h.relicOffers.length) {
        act('relic');
        return;
      }
      if (!h.shopHealed && h.gold >= economyTuning.healCost && h.player.hp < h.player.maxHp * 0.8)
        act('heal');
      const buy = bestIndex(h.shopOffers, (mod) => {
        if (!mod || mod.cursed || h.synergy.full || h.price(mod) > h.gold) return -Infinity;
        return (
          (mod.synergy?.reduce((n, t) => n + h.synergy.tagCount(t), 0) ?? 0) * 3 -
          h.price(mod) * 0.02
        );
      });
      if (buy >= 0) act('buy', buy);
      else act('done');
    }
  }
}

const sourceIds = new Map<string, string>();
for (const def of Object.values(ENEMIES)) {
  sourceIds.set(def.name, def.id);
  sourceIds.set(def.name + "'s shockwave", def.id + '_shockwave');
  sourceIds.set('Volatile ' + def.name, 'volatile_' + def.id);
}

type Hit = { stage: number; seconds: number; source: string; damage: number; hp: number };
type Fight = { stage: number; id: string; seconds: number; killed: boolean };
const rounded = (n: number) => Math.round(n * 100) / 100;

// A synchronous caller can advance a run in slices. Keep the reaction queue,
// bullet provenance and hit history across adjacent slices; a new run or an
// intervening live-game step starts a fresh measurement.
function measurement(g: Game, options: typeof skillTuning) {
  return {
    run: g.mvp,
    step: g.stepN,
    start: g.runTime,
    frames: 0,
    options,
    pilot: new SkilledPilot(options),
    lastHits: [] as Hit[],
    log: [] as string[],
    stages: [] as string[],
    clearedStages: [] as number[],
    damageByStage: { [g.stage]: 0 },
    seenBosses: new Map<number, { fight: Fight; start: number }>(),
    uids: new Uint32Array(8192),
    shooters: [] as string[],
    dashes: 0,
    parries: 0,
    maxAlive: 0,
    totalMs: 0,
    worstMs: 0,
    firstEvo: '',
  };
}

/** Attribute accepted damage and actions at the same callbacks the game uses for
 * MVP and telemetry. These hooks only observe and are removed after each slice. */
function observeRun(g: Game, m: ReturnType<typeof measurement>) {
  const { lastHits, damageByStage, seenBosses, shooters, uids } = m;
  let fromX = 0,
    fromZ = 0,
    attacker = '';
  const hit = g.hurtHero,
    hurt = g.mvpHurt,
    dash = g.onDash,
    parry = g.tryParry,
    kill = g.mvpKill;
  const fire = g.enemyCtx.fireBullet,
    shot = g.bossApi.shot;
  const family = g.enemyCtx.family;
  const copiedShot = family?.fire;
  const bossStep = g.updateBossFight;
  // Bullets swap pool slots; use their monotonic UID to retain shooter identity.
  const b = g.bullets;
  const mark = (slot: number, source: string) => {
    for (let i = slot; i < b.count; i++) {
      if (b.team[i] !== Team.Enemy) continue;
      const uid = b.uid[i],
        key = uid % uids.length;
      if (uids[key] === uid) continue;
      uids[key] = uid;
      shooters[key] = source;
    }
  };
  const beginBoss = (e: Enemy) => {
    if (seenBosses.has(e.uid)) return;
    const fight = { stage: g.stage, id: e.def.id, seconds: 0, killed: false };
    seenBosses.set(e.uid, { fight, start: g.runTime });
  };
  g.enemyCtx.fireBullet = (e, dx, dz, speed, dmg) => {
    const slot = b.count;
    fire(e, dx, dz, speed, dmg);
    mark(slot, e.def.id);
  };
  g.bossApi.shot = (e, dx, dz, speed, dmg, color, life, radius) => {
    const slot = b.count;
    shot(e, dx, dz, speed, dmg, color, life, radius);
    mark(slot, e.def.id);
  };
  if (family && copiedShot) {
    family.fire = (e) => {
      const slot = b.count;
      copiedShot.call(family, e);
      mark(slot, e.def.id);
    };
  }
  // The Queen's delayed swarm wall emits directly from the boss field rather
  // than either firing API. Preserve any individually attributed shots.
  g.updateBossFight = (dt) => {
    const slot = b.count;
    let source = '';
    for (const wall of g.bossField.pendingWalls) {
      if (wall.t <= dt)
        source = source && source !== wall.src.def.id ? 'swarm_wall' : wall.src.def.id;
    }
    bossStep.call(g, dt);
    if (source) mark(slot, source);
  };
  const hitSource = () => {
    if (attacker === 'Enemy fire') {
      for (let i = 0; i < b.count; i++) {
        if (b.team[i] !== Team.Enemy || fromX !== b.px[i] || fromZ !== b.pz[i]) continue;
        const uid = b.uid[i],
          key = uid % uids.length;
        if (uids[key] === uid && shooters[key]) return shooters[key];
      }
      return 'enemy_fire';
    }
    return sourceIds.get(attacker) ?? attacker.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  };
  g.hurtHero = (h, raw, x, z, enemy, cause) => {
    // Thorns or on-kill effects can produce another hit before this one lands.
    const outerX = fromX,
      outerZ = fromZ,
      outerSource = attacker;
    fromX = x;
    fromZ = z;
    attacker = enemy?.def.id ?? (cause || 'Enemy fire');
    try {
      hit.call(g, h, raw, x, z, enemy, cause);
    } finally {
      fromX = outerX;
      fromZ = outerZ;
      attacker = outerSource;
    }
  };
  g.mvpHurt = (h, amount) => {
    if (h === g.hero) {
      if (lastHits.length === 5) lastHits.shift();
      lastHits.push({
        stage: g.stage,
        seconds: rounded(g.runTime),
        source: hitSource(),
        damage: rounded(amount),
        hp: rounded(h.player.hp),
      });
      damageByStage[g.stage] = (damageByStage[g.stage] ?? 0) + amount;
    }
    hurt.call(g, h, amount);
  };
  g.onDash = (h) => {
    if (h === g.hero) m.dashes++;
    dash.call(g, h);
  };
  g.tryParry = (h) => {
    if (h === g.hero && h.skill.parryCd <= 0 && !h.player.dead && g.isCombatMode) m.parries++;
    parry.call(g, h);
  };
  g.mvpKill = (e, by) => {
    if (e.def.boss) {
      beginBoss(e);
      const rec = seenBosses.get(e.uid)!;
      rec.fight.killed = true;
      rec.fight.seconds = rounded(g.runTime - rec.start);
    }
    kill.call(g, e, by);
  };
  return {
    beginBoss,
    restore() {
      g.hurtHero = hit;
      g.mvpHurt = hurt;
      g.onDash = dash;
      g.tryParry = parry;
      g.mvpKill = kill;
      g.enemyCtx.fireBullet = fire;
      g.bossApi.shot = shot;
      g.updateBossFight = bossStep;
      if (family && copiedShot) family.fire = copiedShot;
    },
  };
}

export function createSkillRun(g: Game, input: Input) {
  let previous: ReturnType<typeof measurement> | undefined;
  return (seconds: number, opts: SkillOptions = {}) => {
    if (g.online || g.coop || g.host || g.client) throw new Error('skillRun requires a solo run');
    const frameCount = Math.round(seconds * 60);
    if (seconds < 0 || !Number.isSafeInteger(frameCount))
      throw new RangeError('Invalid simulation duration');
    const options = { ...skillTuning, ...opts };
    if (!previous || previous.run !== g.mvp || previous.step !== g.stepN)
      previous = measurement(g, options);
    const m = previous;
    if (
      m.options.reactionMs !== options.reactionMs ||
      m.options.decisionHz !== options.decisionHz ||
      m.options.aimErrorDeg !== options.aimErrorDeg
    ) {
      m.pilot = new SkilledPilot(options);
      m.options = options;
    }
    const { pilot, lastHits, log, stages, clearedStages, damageByStage, seenBosses } = m;
    const rankCount = () => {
      let ranks = 0,
        evos = 0;
      for (const build of [...g.hero.weapons.map((w) => w.build), g.hero.specialBuild]) {
        if (!build) continue;
        for (const rank of build.ranks) ranks += rank;
        if (build.evo >= 0) evos++;
      }
      return { ranks, evos };
    };
    const observer = observeRun(g, m);
    const god = cheats.god;
    const pad = input.virtual;
    const oldPad = {
      active: pad.active,
      mx: pad.move.x,
      mz: pad.move.y,
      ax: pad.aim.x,
      az: pad.aim.y,
      buttons: [...pad.buttons],
      device: input.device,
    };
    try {
      cheats.god = false;
      if (g.paused) g.resume();
      pad.active = true;
      const limit = clearedStages.includes(4) ? 0 : frameCount;
      for (let step = 0; step < limit && g.mode !== 'dead' && g.mode !== 'title'; step++) {
        const t = window.performance.now();
        const stage = g.stage,
          clears = g.bossesRun,
          mode = g.mode,
          level = g.level;
        if (g.boss?.active) observer.beginBoss(g.boss);
        if (mode === 'levelup' || mode === 'shop') menus(g);
        const o = pilot.step(g);
        pad.move.x = o.mx;
        pad.move.y = o.mz;
        pad.aim.x = o.ax;
        pad.aim.y = o.az;
        pad.buttons[2] = o.charge;
        input.poll();
        if (o.parry) input.pressAction('parry');
        else if (o.dash) input.pressAction('dash');
        if (o.special) input.pressAction('bomb');
        if (o.ult) input.pressAction('ult');
        g.update(dt);
        damageByStage[g.stage] ??= 0;
        if (g.bossesRun > clears && g.mode === 'cleared') {
          clearedStages.push(stage);
          const { ranks, evos } = rankCount();
          stages.push(`st${stage}: lv${g.level} ranks ${ranks} evos ${evos}`);
        }
        if (!m.firstEvo && (mode === 'levelup' || level !== g.level) && rankCount().evos)
          m.firstEvo = `st${stage} lv${g.level}`;
        if (m.frames % 10 === 0) g.render(1, 10 * dt);
        if (m.frames % 1800 === 0)
          log.push(
            `st${g.stage} t=${Math.round(g.director.time)} lv=${g.level} hp=${Math.round(g.player.hp)}`,
          );
        m.maxAlive = Math.max(m.maxAlive, g.enemies.activeCount);
        const ms = window.performance.now() - t;
        m.totalMs += ms;
        m.worstMs = Math.max(m.worstMs, ms);
        m.frames++;
        if (stage === 4 && g.bossesRun > clears && g.mode === 'cleared') break;
      }
    } finally {
      cheats.god = god;
      pad.active = oldPad.active;
      pad.move.x = oldPad.mx;
      pad.move.y = oldPad.mz;
      pad.aim.x = oldPad.ax;
      pad.aim.y = oldPad.az;
      pad.buttons.splice(0, pad.buttons.length, ...oldPad.buttons);
      observer.restore();
      input.poll();
      input.device = oldPad.device;
    }
    m.step = g.stepN;
    const bosses = Array.from(seenBosses.values(), ({ fight, start }) => ({
      ...fight,
      seconds: fight.killed ? fight.seconds : rounded(g.runTime - start),
    }));
    const stageDamage = Object.fromEntries(
      Object.entries(damageByStage).map(([stage, damage]) => [stage, rounded(damage)]),
    );
    const died = g.player.dead && g.mode === 'dead';
    const loopCleared = clearedStages.includes(4) && bosses.some((f) => f.stage === 4 && f.killed);
    return {
      seed: g.seed,
      difficulty: g.difficulty.id,
      tuning: { ...m.options },
      log: [...log],
      mode: g.mode,
      stage: g.stage,
      stageReached: g.stage,
      t: Math.round(g.director.time),
      level: g.level,
      kills: g.kills,
      alive: g.enemies.activeCount,
      maxAlive: m.maxAlive,
      hp: rounded(g.player.hp),
      weapons: g.hero.weapons.map((w) => w.def.id + w.level).join(' '),
      passives: JSON.stringify(g.hero.passives),
      avgMs: rounded(m.totalMs / (m.frames || 1)),
      worstMs: rounded(m.worstMs),
      ranks: rankCount().ranks,
      stages: [...stages],
      firstEvo: m.firstEvo,
      bosses,
      died,
      causeOfDeath: died ? (lastHits.at(-1)?.source ?? 'unknown') : null,
      lastHits: lastHits.map((hit) => ({ ...hit })),
      damageByStage: stageDamage,
      dashes: m.dashes,
      parries: m.parries,
      clearedStages: [...clearedStages],
      loopCleared,
      runSeconds: rounded(g.runTime - m.start),
      simulatedSeconds: rounded(m.frames * dt),
    };
  };
}

declare global {
  interface Window {
    skillRun: ReturnType<typeof createSkillRun>;
  }
}
