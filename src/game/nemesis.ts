import { loadJson, NEMESIS_HISTORY_KEY, saveJson } from '../core/storage';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { RELIC_BY_ID, type RelicDef } from '../data/relics';
import { AdaptiveResistance, damageFamily, resistanceTuning, resists } from './adaptive';
import { Team } from './bullets';
import { hazards, telemetryDeath } from './damageLog';
import type { Enemy } from './enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import { PickupType } from './pickups';
import { saveLock } from './save';
import { spectating } from './systems/spectate';
import { timeBarrier, timeState } from './systems/time';

export const nemesisTuning = {
  arrival: 16,
  spawnMin: 16,
  spawnMax: 21,
  teammateClearance: 7,
  stories: 32,
  shield: 25,
  bossShield: 5,
  hide: 50,
  bossHide: 8,
};
export function traitPercent(mark: number, def: EnemyDef): number {
  const big = def.boss || def.miniboss;
  return mark & 16
    ? big
      ? nemesisTuning.bossShield
      : nemesisTuning.shield
    : big
      ? nemesisTuning.bossHide
      : nemesisTuning.hide;
}
export const TROPHY_CHEST = 3; // below the owned chest range, distinct from champion chests
const relicId = 'r_vendetta';
// Mod-plan installation rebuilds ordinary loot from enumerable registry entries.
// Keep the trophy available to build/stat lookup across registry rebuilds.
const trophyRelic: RelicDef = {
  id: relicId,
  name: 'Vendetta Pin',
  desc: 'A trophy from your nemesis. Pickups fly 20% farther for the rest of this run.',
  color: '#ffcd75',
  icon: '◆',
  rarity: 'legendary',
  add: { magnet: 0.2 },
};
Object.defineProperty(RELIC_BY_ID, relicId, { value: trophyRelic, configurable: true, writable: true });

export interface Story {
  id: number;
  foe: string;
  mark: number;
  visits: number;
  wins: number;
  ended: boolean;
}
type History = { serial: number; stories: Story[] };
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const known = (id: unknown): id is string =>
  typeof id === 'string' && Object.hasOwn(ENEMIES, id) && !ENEMIES[id].hidden;
export function normalizeHistory(raw: unknown): History {
  const history: History = { serial: 0, stories: [] };
  if (!raw || typeof raw !== 'object') return history;
  const { serial, stories } = raw as Partial<History>;
  if (integer(serial)) history.serial = Math.min(serial, 0xffffffff);
  if (Array.isArray(stories))
    for (const s of stories.slice(-nemesisTuning.stories)) {
      if (
        !s ||
        !integer(s.id) ||
        !s.id ||
        !known(s.foe) ||
        !integer(s.mark) ||
        s.mark > 31 ||
        history.stories.some((row) => row.id === s.id)
      )
        continue;
      const visits = integer(s.visits) ? s.visits : 0;
      history.stories.push({
        id: s.id,
        foe: s.foe,
        mark: s.mark,
        visits,
        wins: integer(s.wins) ? Math.min(visits, s.wins) : 0,
        ended: s.ended === true,
      });
    }
  return history;
}

interface Down {
  uid: number;
  foe: string;
  seat: number;
  time: number;
  story: number;
}
interface HuntNet {
  uid: number;
  stage: number;
  story?: Story;
  promoted?: Story;
  revision?: number;
  trophy?: boolean;
  family: number;
  thresholds: number[];
}
const scripted = (d: EnemyDef) =>
  d.boss || d.miniboss || d.titanPart || d.special || d.minMinute < 0 || d.id === 'reaper';
const allowsHunts = (g: Game) =>
  (g.runMode === 'standard' || g.runMode === 'endless') &&
  !g.pvp &&
  !g.versus &&
  !g.race &&
  !g.onboarding.training &&
  !saveLock.on;

export class Nemesis {
  adaptive = new AdaptiveResistance();
  history = normalizeHistory(null);
  metrics = { appearances: 0, defeated: 0, wins: 0 };
  uid = 0;
  stage = 0; // stage on which a rival last arrived, including a resolved arrival
  story?: Story;
  private promoted?: Story;
  private revision = 0;
  private nextUid = 1;
  private downs: Down[] = [];
  private standBlows = new WeakMap<Hero, Down>();
  private visits = new Map<number, number>();
  private ended = false;
  private demo = false;
  trophy = false;
  private clock = 0;
  private retryAt = 0;
  private ordinary?: Story;
  private lastTime = 0;
  private live?: Enemy;
  private restoreSlot = -1;
  private restored = 0;
  private restoredDowns?: Map<number, Down[]>;
  private readonly shotTags = new Uint32Array(8192);
  private readonly shooters = new Uint32Array(8192);

  constructor(private g: Game) {
    // The existing migration checkpoint copies primitive run-event fields before
    // rebuilding enemies in list order. Ordinals survive that rebuild; pool UIDs do not.
    Object.defineProperty(g.runEvents, 'nemesisCheckpoint', {
      enumerable: true,
      get: () => this.checkpoint(),
      set: (value: string) => this.restore(value),
    });
    const spawn = g.enemies.spawn.bind(g.enemies);
    g.enemies.spawn = (def, x, z, opts) => {
      const e = spawn(def, x, z, opts);
      if (this.restoredDowns) {
        const slot = this.restored++;
        if (slot === this.restoreSlot) {
          this.uid = e.uid;
          this.live = e;
          if (this.story) this.visits.set(e.uid, this.story.id);
        }
        const downs = this.restoredDowns.get(slot);
        if (downs) for (const d of downs) d.uid = e.uid;
      } else if (g.authority) {
        this.nextUid = Math.max(this.nextUid, e.uid + 1);
        // Scripted foes keep their authored encounters, phase gates and entrances.
        if (
          this.history.stories.length &&
          this.stage !== g.stage &&
          scripted(def) &&
          allowsHunts(g) &&
          g.mode === 'fight'
        ) {
          const s = this.history.stories.find((row) => !row.ended && row.foe === def.id);
          if (s) this.arrive(s, e);
        }
      }
      return e;
    };
    const guard = g.guardMul.bind(g);
    g.guardMul = (e, o, by) => {
      let mul = guard(e, o, by);
      if (
        this.adaptive.thresholds.length &&
        resists(e.def) &&
        this.adaptive.family === damageFamily(o.tags ?? by.tagsOf(o.source))
      ) {
        mul *= 1 - resistanceTuning.step * this.adaptive.levels(e.uid);
      }
      return mul;
    };
    const hit = g.skillHit.bind(g);
    g.skillHit = (e, o, dealt, crit, by) => {
      if (g.authority && g.mode === 'fight' && allowsHunts(g) && !o.fixed && e.pvpOwner < 0) {
        this.adaptive.record(damageFamily(o.tags ?? by.tagsOf(o.source)), dealt);
      }
      hit(e, o, dealt, crit, by);
    };
    // Keep the shooter's immutable ID even when the original pool object is reused.
    const fire = g.enemyCtx.fireBullet;
    g.enemyCtx.fireBullet = (e, dx, dz, speed, dmg) => {
      const i = g.bullets.count;
      fire(e, dx, dz, speed, dmg);
      this.markShot(i, e);
    };
    const shot = g.bossApi.shot;
    g.bossApi.shot = (e, dx, dz, speed, dmg, color, life, radius) => {
      const i = g.bullets.count;
      shot(e, dx, dz, speed, dmg, color, life, radius);
      this.markShot(i, e);
    };
    const hurt = g.hurtHero.bind(g);
    g.hurtHero = (h, raw, x, z, src, cause) => {
      const vulnerable = !h.player.dead && h.player.invuln <= 0;
      const uid = src?.uid,
        def = src?.def.id;
      if (vulnerable) this.standBlows.delete(h);
      hurt(h, raw, x, z, src, cause);
      if (!vulnerable || h.left || !g.authority || !allowsHunts(g)) return;
      if (h.player.dead) this.confirmDown(this.attacker(h, uid, def, x, z));
      else if (h.player.hp === 1 && timeState(g).heroes[h.index]?.standT > 0) {
        // On Assist/Easy the killing blow is deferred until the last stand expires.
        const blow = this.attacker(h, uid, def, x, z);
        if (blow) this.standBlows.set(h, blow);
      }
    };
    const down = g.onHeroDown.bind(g);
    g.onHeroDown = (h) => {
      const blow = this.standBlows.get(h);
      this.standBlows.delete(h);
      down(h);
      if (blow && h.player.dead && !h.left && g.authority) this.confirmDown(blow);
    };
    const end = g.endRun.bind(g);
    g.endRun = (quit) => {
      if (!quit && g.authority && allowsHunts(g)) this.finish();
      end(quit);
    };
    const kill = g.mvpKill.bind(g);
    g.mvpKill = (e, by) => {
      if (g.authority && e.uid === this.uid && this.story && !this.story.ended && by) {
        this.story.ended = true;
        this.metrics.defeated++;
        this.trophy = true;
        this.uid = 0;
        this.persist(this.story);
        timeBarrier(g);
        const count = g.pickups.count;
        g.pickups.spawn(PickupType.Chest, e.x, e.z, TROPHY_CHEST);
        if (g.pickups.count === count) this.reward();
        else g.vfx.cine('hunt-drop', 0, 0, 0);
      }
      kill(e, by);
    };
    const collect = g.collect.bind(g);
    g.collect = (h, type, value) => {
      if (g.authority && type === PickupType.Chest && value === TROPHY_CHEST) this.reward();
      else collect(h, type, value);
    };
    const pack = g.gameplayNet.bind(g);
    g.gameplayNet = (h) => {
      const net = pack(h);
      if (this.stage || this.promoted || this.adaptive.thresholds.length) net.hunt = this.snapshot();
      return net;
    };
    const apply = g.applyGameplayNet.bind(g);
    g.applyGameplayNet = (raw) => {
      apply(raw);
      this.receive((raw as { hunt?: HuntNet } | null)?.hunt);
    };
  }

  reset(): void {
    this.adaptive = new AdaptiveResistance();
    this.history = normalizeHistory(this.g.authority && !saveLock.on ? loadJson(NEMESIS_HISTORY_KEY, null) : null);
    this.uid = this.stage = this.lastTime = this.clock = this.retryAt = 0;
    this.promoted = this.story = this.live = this.restoredDowns = undefined;
    this.revision = 0;
    this.ordinary = this.history.stories.find((s) => !s.ended && !scripted(ENEMIES[s.foe]));
    this.downs.length = 0;
    this.standBlows = new WeakMap();
    this.visits.clear();
    this.ended = this.demo = this.trophy = false;
    this.metrics = { appearances: 0, defeated: 0, wins: 0 };
  }

  private persist(s: Story): void {
    if (this.demo || saveLock.on || !this.g.authority) return;
    this.revision++;
    this.storeStory(s);
  }

  private storeStory(s: Story): void {
    // Each participant keeps its own profile, including across an authority change.
    // A reconnect to an older checkpoint cannot reopen a locally completed story.
    const local = normalizeHistory(loadJson(NEMESIS_HISTORY_KEY, null));
    const existing = local.stories.find((row) => row.id === s.id);
    if (existing) {
      existing.visits = Math.max(existing.visits, s.visits);
      existing.wins = Math.max(existing.wins, s.wins);
      existing.ended ||= s.ended;
    } else {
      if (local.stories.length >= nemesisTuning.stories)
        local.stories.splice(
          Math.max(
            0,
            local.stories.findIndex((row) => row.ended),
          ),
          1,
        );
      local.stories.push(s);
    }
    local.serial = Math.max(local.serial, this.history.serial);
    saveJson(NEMESIS_HISTORY_KEY, local);
  }

  private checkpoint(): string {
    if (!this.history.stories.length && !this.downs.length && !this.adaptive.thresholds.length) return '';
    const slots = new Map<number, number>();
    for (const e of this.g.enemies.list) if (e.active && !e.def.hidden) slots.set(e.uid, slots.size);
    return JSON.stringify({
      history: {
        serial: this.history.serial,
        stories: this.history.stories.filter((s) => !s.ended || s === this.story),
      },
      stage: this.stage,
      trophy: this.trophy,
      story: this.story?.id,
      slot: slots.get(this.uid) ?? -1,
      downs: this.downs.map((d) => ({ ...d, slot: slots.get(d.uid) ?? -1 })),
      metrics: this.metrics,
    });
  }

  private restore(value: string): void {
    if (!value || value.length > 64000) {
      this.adaptive = new AdaptiveResistance();
      return;
    }
    try {
      const data = JSON.parse(value);
      this.history = normalizeHistory(data.history);
      this.story = this.history.stories.find((s) => s.id === data.story);
      this.ordinary = this.history.stories.find((s) => !s.ended && !scripted(ENEMIES[s.foe]));
      this.stage = integer(data.stage) ? data.stage : 0;
      this.trophy = data.trophy === true;
      this.restoreSlot = data.slot;
      this.restored = this.uid = 0;
      this.restoredDowns = new Map();
      this.downs = [];
      for (const row of Array.isArray(data.downs) ? data.downs : []) {
        if (!known(row.foe) || !integer(row.seat) || !Number.isSafeInteger(row.uid)) continue;
        const d = { ...row, uid: row.uid < 0 ? row.uid : -0x100000000 - row.uid };
        this.downs.push(d);
        if (row.slot < 0) continue;
        const group = this.restoredDowns.get(row.slot) ?? [];
        group.push(d);
        this.restoredDowns.set(row.slot, group);
      }
      if (
        data.metrics &&
        integer(data.metrics.appearances) &&
        integer(data.metrics.defeated) &&
        integer(data.metrics.wins)
      )
        this.metrics = data.metrics;
    } catch {
      /* An older or malformed optional checkpoint leaves the run playable. */
    }
  }

  private markShot(slot: number, e: Enemy): void {
    const b = this.g.bullets;
    if (slot >= b.count) return;
    const uid = b.uid[slot],
      key = uid % this.shotTags.length;
    this.shotTags[key] = uid;
    this.shooters[key] = e.uid;
  }

  private attacker(h: Hero, uid: number | undefined, foe: string | undefined, x: number, z: number): Down | undefined {
    const g = this.g;
    if (!foe) {
      const fatal = telemetryDeath(h).deathCause;
      if (!fatal) return;
      const source = fatal[0].replace(/^volatile_|_shockwave$/g, '');
      foe = known(source) ? source : hazards[source]?.[3];
      if (!known(foe)) return;
      if (fatal[1] === 'bullet') {
        const b = g.bullets;
        for (let i = 0; i < b.count; i++) {
          if (b.team[i] !== Team.Enemy || b.px[i] !== x || b.pz[i] !== z) continue;
          const id = b.uid[i],
            key = id % this.shotTags.length;
          if (this.shotTags[key] === id) {
            uid = this.shooters[key];
            break;
          }
        }
      } else {
        // Splash may arrive after death. Only credit a live individual when unambiguous.
        let match = 0;
        for (const e of g.enemies.list)
          if (e.active && e.def.id === foe) {
            if (e.x === x && e.z === z) {
              match = e.uid;
              break;
            }
            match = match ? -1 : e.uid;
          }
        if (match > 0) uid = match;
      }
    }
    if (!known(foe)) return;
    return {
      uid: uid ?? -(this.downs.length + 1),
      foe,
      seat: h.index,
      time: g.runTime,
      story: uid ? (this.visits.get(uid) ?? 0) : 0,
    };
  }

  private confirmDown(d?: Down): void {
    if (d) {
      d.time = this.g.runTime;
      this.downs.push(d);
    }
    if (this.g.mode === 'dead') this.finish(d);
  }

  private finish(fatal?: Down): void {
    if (this.ended) return;
    this.ended = true;
    const tally = new Map<number, Set<number>>();
    let winner: Down | undefined,
      best = 0;
    for (const d of this.downs) {
      let seats = tally.get(d.uid);
      if (!seats) tally.set(d.uid, (seats = new Set()));
      seats.add(d.seat);
      if (seats.size >= best) {
        winner = d;
        best = seats.size;
      }
    }
    if (!winner) return;
    if (fatal?.story && this.story?.id === fatal.story && !this.story.ended) {
      this.metrics.wins++;
      this.story.wins++;
      this.persist(this.story);
    }
    if (!winner.story) {
      const s = this.history;
      if (s.stories.length >= nemesisTuning.stories) {
        const old = s.stories.findIndex((row) => row.ended);
        s.stories.splice(Math.max(0, old), 1);
      }
      const seq = ++s.serial;
      const id = (this.g.seed >>> 0) * 0x100000 + (seq % 0x100000) + 1;
      const mark = (this.g.seed ^ Math.imul(seq, 2654435761) ^ Math.imul(winner.foe.length, 31)) >>> 0;
      const promoted = { id, foe: winner.foe, mark: (mark ^ (mark >>> 16)) & 31, visits: 0, wins: 0, ended: false };
      s.stories.push(promoted);
      this.promoted = promoted;
      this.persist(promoted);
    }
  }

  private arrive(s: Story, e: Enemy): void {
    this.uid = e.uid;
    this.live = e;
    this.story = s;
    this.stage = this.g.stage;
    this.visits.set(e.uid, s.id);
    s.visits++;
    this.metrics.appearances++;
    const bonus = Math.max(1, Math.round((e.maxHp * traitPercent(s.mark, e.def)) / 100));
    if (s.mark & 16) e.shield += bonus;
    else e.hp = e.maxHp += bonus;
    this.persist(s);
    timeBarrier(this.g);
    this.g.vfx.ring(e.x, e.z, e.radius, e.radius * 3, '#ffcd75', 1.2);
    this.g.vfx.sound('elite', e.x, e.z);
  }

  private reward(): void {
    this.trophy = false;
    for (const h of this.g.heroes)
      if (!h.left && !h.hasRelic(relicId)) {
        h.relics.push(relicId);
        h.recomputeStats();
      }
    timeBarrier(this.g);
    this.g.vfx.sound('chest', NaN, NaN);
    this.g.vfx.cine('hunt-earned', 0, 0, 0);
  }

  step(dt: number): void {
    const g = this.g;
    if (!allowsHunts(g)) return;
    if (this.restoredDowns) {
      this.restoredDowns = undefined;
      this.adaptive = new AdaptiveResistance();
      for (const e of g.enemies.list) if (e.active) this.nextUid = Math.max(this.nextUid, e.uid + 1);
    }
    if (this.uid && (!this.live?.active || this.live.uid !== this.uid)) this.uid = 0;
    if (this.ordinary?.ended) this.ordinary = this.history.stories.find((s) => !s.ended && !scripted(ENEMIES[s.foe]));
    if (g.runTime < this.lastTime) this.downs = this.downs.filter((d) => d.time <= g.runTime);
    this.lastTime = g.runTime;
    if (this.adaptive.step(dt, this.nextUid)) g.vfx.cine('hunt-resist', this.adaptive.family, 0, 0);
    if (this.stage !== g.stage) this.uid = 0;
    if (
      this.stage === g.stage ||
      !this.ordinary ||
      g.director.bossSpawned ||
      g.bossDuel ||
      g.boss ||
      g.director.time < nemesisTuning.arrival
    )
      return;
    this.clock += dt;
    if (this.clock < this.retryAt) return;
    this.retryAt = this.clock + 1;
    const def = ENEMIES[this.ordinary.foe],
      pos = g.ringPoint(nemesisTuning.spawnMin, nemesisTuning.spawnMax, def.radius);
    if (!pos) return;
    // The ring is relative to one hero. Leave space around the rest of the party too.
    for (const h of g.heroes)
      if (
        !h.left &&
        !h.player.dead &&
        Math.hypot(h.player.x - pos.x, h.player.z - pos.z) < nemesisTuning.teammateClearance + def.radius
      )
        return;
    this.arrive(this.ordinary, g.enemies.spawn(def, pos.x, pos.z, g.spawnOpts()));
  }

  snapshot(): HuntNet {
    return {
      uid: this.uid,
      stage: this.stage,
      trophy: this.trophy,
      story: this.demo && !this.uid ? undefined : this.story,
      promoted: this.promoted,
      revision: this.revision,
      family: this.adaptive.family,
      thresholds: this.adaptive.thresholds,
    };
  }

  private receive(net?: HuntNet): void {
    this.trophy = !!net?.trophy;
    this.uid = net?.uid ?? 0;
    this.stage = net?.stage ?? 0;
    this.story = net?.story && known(net.story.foe) ? net.story : undefined;
    if (
      this.g.role === 'client' &&
      net?.revision &&
      net.revision !== this.revision &&
      !saveLock.on &&
      !spectating(this.g)
    ) {
      const changes = normalizeHistory({ stories: [net.story, net.promoted] });
      for (const s of changes.stories) this.storeStory(s);
      this.revision = net.revision;
    }
    this.adaptive.family = net?.family ?? -1;
    const thresholds = this.adaptive.thresholds,
      incoming = net?.thresholds;
    thresholds.length = incoming?.length ?? 0;
    if (incoming) for (let i = 0; i < incoming.length; i++) thresholds[i] = incoming[i];
  }

  /** Isolated visual fixture. Neither the seeded story nor its reward is saved. */
  preview(mode = ''): void {
    this.demo = true;
    this.history = normalizeHistory(null);
    this.adaptive.family = 1;
    this.adaptive.thresholds.push(this.nextUid);
    const g = this.g,
      p = g.player;
    if (mode === 'resist') {
      g.enemies.spawn(ENEMIES.bopper, p.x + 4, p.z + 2, g.spawnOpts());
      g.vfx.cine('hunt-resist', this.adaptive.family, 0, 0);
      return;
    }
    const story = { id: 1, foe: 'charger', mark: 21, visits: 0, wins: 0, ended: false };
    this.history.stories.push(story);
    const e = g.enemies.spawn(ENEMIES.charger, p.x + 3.5, p.z - 1, g.spawnOpts());
    this.arrive(story, e);
    e.state = 'recover';
    e.t = 4;
    if (mode === 'trophy') g.damage(e, e.maxHp * 10, { source: 'buster', fixed: true }, g.hero);
  }
}

/** Six consecutive seeded runs on one disposable profile, so actual kills can
 * produce later encounters. Pass the installed mortal runner (sync or async). */
export async function measureHunts(g: Game, run: (seconds: number) => unknown, beforeSeed?: (seed: number) => void) {
  const rows = [];
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    beforeSeed?.(seed);
    g.startRun({ seed, difficulty: 'normal' });
    for (let n = 0; n < 150 && g.mode !== 'dead' && !g.victories; n++) await run(10);
    rows.push({
      seed,
      stage: g.stage,
      clear: !!g.victories,
      dead: g.mode === 'dead',
      kills: g.kills,
      ...g.nemesis.metrics,
    });
  }
  return rows;
}
