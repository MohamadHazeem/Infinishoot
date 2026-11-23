import type { Game } from './game';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Enemy } from './enemies';
import { customArenaActive, editorState, playArenaSolo } from './systems/editor';
import { trialActive } from './systems/trials';
import { loadJson, saveJson } from '../core/storage';
import { onlineServer } from '../net/onlineServer';
import { saveLock } from './save';
import {
  decodeBoss,
  encodeBoss,
  resolveLayout,
  tellTime,
  restTime,
  wallGap,
  type Cue,
  type Design,
} from './bossMakerCode';
import { en } from '../i18n/en';
import { localize, t } from '../i18n';
import { iconHtml } from '../ui/pixelIcons';

const libraryKey = 'bossMaker.v1';
export function localDesigns(): string[] {
  const raw = loadJson<unknown>(libraryKey, []);
  return Array.isArray(raw)
    ? [...new Set(raw.slice(0, 12).filter((s): s is string => !!decodeBoss(s)))]
    : [];
}
export function keepDesign(code: string, previous?: string): boolean {
  if (!decodeBoss(code) || saveLock.on) return false;
  const list = localDesigns().filter((s) => s !== code && s !== previous);
  if (list.length >= 12) return false;
  saveJson(libraryKey, [code, ...list]);
  return localDesigns().includes(code);
}
export function removeDesign(code: string): void {
  if (!saveLock.on)
    saveJson(
      libraryKey,
      localDesigns().filter((s) => s !== code),
    );
}
export const weekIndex = () => Math.floor((Date.now() - 4 * 86400000) / 604800000);
export interface BoardRow {
  id: string;
  code: string;
  rating: number;
  votes: number;
}
export async function boardRequest(path: string, body?: object) {
  if (!onlineServer) throw Error('offline');
  const response = await fetch(onlineServer + path, {
    credentials: 'omit',
    signal: AbortSignal.timeout(5000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw Error(String(response.status));
  return response.json();
}
export async function bossList(weekly = false, page = 0): Promise<BoardRow[]> {
  const res = await boardRequest(weekly ? '/bosses/weekly' : '/bosses?page=' + page);
  if (!Array.isArray(res.designs) || res.week !== weekIndex()) throw Error('board');
  return res.designs
    .slice(0, weekly ? 3 : 30)
    .filter(
      (r: BoardRow) =>
        r &&
        /^[a-f0-9]{24}$/.test(r.id) &&
        Number.isSafeInteger(r.votes) &&
        r.votes >= 0 &&
        Number.isFinite(r.rating) &&
        r.rating >= 0 &&
        r.rating <= 5 &&
        decodeBoss(r.code),
    );
}
export function ballotId(): string {
  const id = loadJson<unknown>('bossBallot.v1', '');
  if (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) return id;
  const fresh = crypto.randomUUID().replace(/-/g, '');
  saveJson('bossBallot.v1', fresh);
  return fresh;
}
type Slot = ReturnType<typeof slot>;
function slot(code: string, stage: number) {
  const design = decodeBoss(code);
  if (!design) throw Error('invalid design');
  return { code, design, stage, arena: resolveLayout(design.arena) };
}

/** Each body borrows its model, loot and phase gates. The inert chase body has no native
 * attack or contact damage. This conductor owns every damaging action, including charges. */
export class BossMaker {
  offer: Slot | null = null;
  active: Slot | null = null;
  private rotation: BoardRow[] = [];
  private rotationWeek = -1;
  private testing = false;
  private uid = -1;
  private phase = 0;
  private cursor = 0;
  private clock = 0;
  private action: 'wait' | 'tell' | 'rush' = 'wait';
  private cue: Cue | null = null;
  private x = 0;
  private z = 0;
  private dx = 0;
  private dz = 1;
  private hit = 0;
  private lastTime = 0;
  private definition: EnemyDef | null = null;
  onReturn?: (won: boolean) => void;

  install(g: Game): void {
    const reset = () => {
      this.offer = this.active = null;
      this.testing = false;
      this.uid = -1;
    };
    const title = g.goTitle.bind(g);
    g.goTitle = () => {
      reset();
      title();
    };
    const resetRoute = g.routeReset.bind(g);
    g.routeReset = () => {
      reset();
      resetRoute();
      if (g.runMode === 'standard' && onlineServer) {
        const week = weekIndex();
        void bossList(true)
          .then((rows) => {
            this.rotation = rows;
            this.rotationWeek = week;
          })
          .catch(() => {
            this.rotationWeek = -1;
          });
      }
    };
    const begin = g.routeBeginVote.bind(g);
    g.routeBeginVote = () => {
      this.offer = null;
      if (
        g.route.phase === 'map' &&
        g.runMode === 'standard' &&
        !customArenaActive(g) &&
        !trialActive(g) &&
        !g.pvp &&
        g.stage % 4 === 1 &&
        g.route.options.length > 1
      ) {
        const codes =
          this.rotationWeek === weekIndex() && this.rotation.length
            ? this.rotation.map((r) => r.code)
            : localDesigns();
        if (codes.length)
          this.offer = slot(codes[(weekIndex() + (g.stage - 1) / 4) % codes.length], g.stage + 1);
      }
      g.host?.broadcast({
        t: 'makerOffer',
        seed: g.seed,
        code: this.offer?.code,
        stage: g.stage + 1,
      });
      begin();
    };
    const decide = g.routeDecide.bind(g);
    g.routeDecide = (pick) => {
      if (this.offer && g.route.phase === 'map' && pick === g.route.options.length - 1) {
        this.active = this.offer;
        g.host?.broadcast({
          t: 'makerStage',
          seed: g.seed,
          code: this.active.code,
          stage: this.active.stage,
        });
      }
      decide(pick);
    };
    const kind = g.routeKind.bind(g);
    g.routeKind = (stage = g.stage) => (this.active?.stage === stage ? 'start' : kind(stage));
    const close = g.closeRoute.bind(g);
    g.closeRoute = () => {
      if (this.active?.stage !== g.stage + 1) return close();
      g.route.open = false;
      if (g.screens.current === 'route') g.screens.show('none');
      g.host?.broadcast({ t: 'route', open: false });
      g.openPortal();
      g.vfx.toast(en['maker.weekly'], 2.5);
    };
    const host = g.onHostMessage.bind(g);
    let receivedSeed: number | null = null;
    g.onHostMessage = (from, m) => {
      if (m.t === 'hello' && g.host) {
        if (this.active)
          g.host.send(from, {
            t: 'makerStage',
            seed: g.seed,
            stage: this.active.stage,
            code: this.active.code,
          });
        if (this.offer && g.route.open)
          g.host.send(from, {
            t: 'makerOffer',
            seed: g.seed,
            stage: this.offer.stage,
            code: this.offer.code,
          });
      }
      host(from, m);
    };
    const client = g.onClientMessage.bind(g);
    g.onClientMessage = (m) => {
      if (m.t === 'start' && receivedSeed !== Number(m.seed)) reset();
      if (m.t === 'makerOffer' || m.t === 'makerStage') {
        receivedSeed = Number(m.seed);
        const stage = Number(m.stage);
        const validStage = Number.isSafeInteger(stage) && stage >= 2;
        if (m.t === 'makerOffer') {
          this.offer = validStage && decodeBoss(m.code) ? slot(String(m.code), stage) : null;
        } else if (validStage) {
          // An unreliable stage snapshot can arrive before its reliable design message.
          this.mirror(g, m.code, stage);
        }
        return;
      }
      client(m);
    };
    const route = g.screens.onRoutePacts;
    g.screens.onRoutePacts = (el, v) => {
      route?.(el, v);
      const s = this.offer;
      if (v.phase !== 'map' || s?.stage !== v.stage + 1) return;
      const i = v.options.length - 1;
      const title = t('maker.weekly'),
        sub = localize(ENEMIES[s.design.body].name);
      for (const n of el.querySelectorAll<HTMLElement>(`[data-ri="${i}"]`)) {
        const name = n.querySelector('.nm,.rtip b'),
          desc = n.querySelector('.sh,.rtip em');
        if (name) name.textContent = title;
        if (desc) desc.textContent = sub;
        n.style.setProperty('--c', 'var(--purple)');
        const pic = iconHtml('route_hard', '#ffcd75', '★');
        if (n.matches('button')) {
          const ic = n.querySelector('.ic');
          if (ic) ic.innerHTML = pic;
          n.querySelector('ul')?.remove();
        } else {
          n.querySelector('img,.glyph')?.remove();
          n.insertAdjacentHTML('afterbegin', pic);
        }
      }
    };
    const load = g.loadArena.bind(g);
    g.loadArena = (seed, stage = 1) => {
      if (!this.active || this.active.stage !== stage) {
        if (this.active && stage > this.active.stage) this.active = null;
        return load(seed, stage);
      }
      // Borrow only the editor's geometry hook, without applying designer-selected run rules.
      const editor = editorState(g),
        old = editor.active;
      editor.active = this.active.arena;
      try {
        load(seed, stage);
      } finally {
        editor.active = old;
      }
    };
    const spot = g.spawnSpot.bind(g);
    g.spawnSpot = (i) => {
      if (!this.active || this.active.stage !== g.stage) return spot(i);
      const editor = editorState(g),
        old = editor.active;
      editor.active = this.active.arena;
      try {
        return spot(i);
      } finally {
        editor.active = old;
      }
    };
    const spawn = g.spawnBoss.bind(g);
    g.spawnBoss = (def) => {
      if (this.active?.stage !== g.stage || !g.authority) return spawn(def);
      const s = this.active,
        template = ENEMIES[s.design.body];
      const pos = s.arena.pieces.find((p) => p.k === 'boss')!;
      const opts = g.spawnOpts({ hpMul: g.director.bossHpMul });
      this.definition = {
        ...template,
        behavior: 'chase',
        contactDamage: 0,
        speed: 0,
        hp: this.testing ? 430 : 1750,
      };
      g.boss = g.enemies.spawn(this.definition, pos.x, pos.z, opts);
      this.uid = g.boss.uid;
      this.phase = 0;
      g.startBossIntro(g.boss);
    };
    const end = g.endRun.bind(g),
      clear = g.stageClear.bind(g);
    const finish = (won: boolean) => {
      g.leaveToTitle();
      this.onReturn?.(won);
    };
    const retry = g.retry.bind(g);
    g.retry = () => (this.testing && this.active ? this.test(g, this.active.design) : retry());
    g.stageClear = () => (this.testing ? finish(true) : clear());
    g.endRun = (quit) => (this.testing ? finish(false) : end(quit));
  }

  test(g: Game, design: Design): void {
    if (g.role !== 'solo') return;
    const s = slot(encodeBoss(design), 1);
    playArenaSolo(
      g,
      {
        ...s.arena,
        rules: { ...s.arena.rules, difficulty: 'normal', boss: 'auto', events: false, heat: [] },
      },
      false,
    );
    this.active = s;
    this.testing = true;
    if (g.mode === 'shop') g.closeShop();
    g.director.bossSpawned = g.director.hold = true;
    g.spawnBoss(ENEMIES[design.body]);
  }

  // Reliable stage messages serve current peers. A sparse snapshot repairs drop-in / reconnect.
  mirror(g: Game, code: unknown, stage: number): void {
    if (
      typeof code !== 'string' ||
      (this.active?.code === code && this.active.stage === stage) ||
      !decodeBoss(code)
    )
      return;
    this.active = slot(code, stage);
    if (g.arenaStage === stage) g.loadArena((g.seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0, stage);
  }

  step(g: Game, dt: number): void {
    const b = g.boss,
      s = this.active;
    if (
      !s ||
      s.stage !== g.stage ||
      !b?.alive ||
      g.mode !== 'fight' ||
      !g.authority ||
      b.def.id !== s.design.body
    )
      return;
    if (b.uid !== this.uid || b.def !== this.definition || this.lastTime > g.runTime) {
      // Rewind and migration rebuild a pooled enemy from its wire body. Start a fresh tell.
      this.definition = {
        ...ENEMIES[s.design.body],
        behavior: 'chase',
        contactDamage: 0,
        speed: 0,
      };
      b.def = this.definition;
      this.uid = b.uid;
      this.phase = 0;
    }
    this.lastTime = g.runTime;
    if (this.phase !== b.phase) {
      this.phase = b.phase;
      this.cursor = 0;
      this.clock = 0.45;
      this.action = 'wait';
      this.cue = null;
    }
    if (b.roarT > 0) {
      b.roarT = Math.max(0, b.roarT - dt);
      return;
    }
    if (b.frozen > 0) {
      // A warning can expire while the body is frozen. Cancel its queued release.
      if (this.cue && this.action !== 'wait') this.recover(g, b);
      return;
    }
    this.clock -= dt;
    if (this.action === 'rush') {
      const x = b.x + this.dx * dt * 18,
        z = b.z + this.dz * dt * 18;
      if (this.clock <= 0 || !g.bossApi.open(x, z, b.radius)) {
        this.recover(g, b);
        return;
      }
      b.x = x;
      b.z = z;
      for (const h of g.heroes) {
        if (
          h.left ||
          h.player.dead ||
          this.hit & (1 << h.index) ||
          Math.hypot(x - h.player.x, z - h.player.z) > b.radius + h.player.radius
        )
          continue;
        this.hit |= 1 << h.index;
        g.hurtHero(h, this.damage(g, b), x, z, b);
      }
      return;
    }
    if (this.clock > 0) return;
    if (this.action === 'tell' && this.cue) {
      const move = this.cue.move;
      if (move === 'charge') {
        this.action = 'rush';
        this.clock = 0.48;
        this.hit = 0;
        b.state = 'attack';
        return;
      }
      if (move === 'ring' || move === 'fan') {
        const n = move === 'ring' ? 10 : 5;
        for (let i = 0; i < n; i++) {
          const a =
            Math.atan2(this.dz, this.dx) +
            (move === 'ring' ? (i * Math.PI * 2) / n : (i - 2) * 0.2);
          g.bossApi.shot(
            b,
            Math.cos(a),
            Math.sin(a),
            7,
            this.damage(g, b) / b.dmgMul,
            '#ff3df0',
            2.2,
            0.26,
          );
        }
      } else if (
        move === 'summon' &&
        g.enemies.countOf('swarmer') < 3 &&
        !g.heroes.some(
          (h) =>
            !h.left && !h.player.dead && Math.hypot(this.x - h.player.x, this.z - h.player.z) < 3,
        )
      ) {
        g.enemyCtx.spawnChild('swarmer', this.x, this.z, b);
      }
      this.recover(g, b);
      return;
    }
    let distance = Infinity,
      target = g.hero.player;
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const d = Math.hypot(h.player.x - b.x, h.player.z - b.z);
      if (d < distance) {
        target = h.player;
        distance = d;
      }
    }
    if (!Number.isFinite(distance)) return;
    const order = s.design.phases[b.phase - 1];
    const cue = (this.cue = order[this.cursor++ % order.length]);
    const delay = (this.clock = tellTime(cue));
    this.dx = distance ? (target.x - b.x) / distance : 1;
    this.dz = distance ? (target.z - b.z) / distance : 0;
    b.lungeX = this.dx;
    b.lungeZ = this.dz;
    b.facing = Math.atan2(this.dx, this.dz);
    b.state = 'windup';
    b.t = delay;
    b.action = cue.move === 'charge' ? 'charge' : 'summon';
    this.action = 'tell';
    this.x = target.x;
    this.z = target.z;
    g.vfx.sound('bossWindup', b.x, b.z);
    if (cue.move === 'strike') {
      g.strikes.push({
        x: this.x,
        z: this.z,
        r: 2,
        t: delay,
        dmg: this.damage(g, b),
        cause: b.def.name,
      });
      g.vfx.zone(this.x, this.z, 2, delay);
    } else if (cue.move === 'wall') {
      // Align a reachable gap with the targeted hero. Skip the wall beside solid cover.
      const cx = this.x - this.dx * 8,
        cz = this.z - this.dz * 8;
      if (g.bossApi.open(cx, cz, wallGap) && g.walls.segmentClear(cx, cz, this.x, this.z, 0.75)) {
        g.bossField.pendingWalls.push({
          cx,
          cz,
          dx: this.dx,
          dz: this.dz,
          gap: 0,
          t: delay,
          dmg: this.damage(g, b) / b.dmgMul,
          src: b,
        });
        for (let i = -3; i <= 3; i++)
          if (i) g.vfx.zone(cx - this.dz * i * 4, cz + this.dx * i * 4, 1.5, delay);
        g.vfx.ring(cx, cz, wallGap, 0, '#a7f070', delay);
      }
    } else if (cue.move === 'summon') {
      this.x = b.x - this.dz * 3.5;
      this.z = b.z + this.dx * 3.5;
      g.vfx.zone(this.x, this.z, 1.1, delay);
    } else if (cue.move === 'charge') {
      for (let i = 0; i <= 4; i++)
        g.vfx.zone(b.x + this.dx * i * 2.2, b.z + this.dz * i * 2.2, b.radius, delay);
    } else {
      const ring = cue.move === 'ring',
        n = ring ? 10 : 5;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(this.dz, this.dx) + (ring ? (i * 2 * Math.PI) / n : (i - 2) * 0.2);
        g.vfx.zone(
          b.x + Math.cos(a) * (b.radius + 1.3),
          b.z + Math.sin(a) * (b.radius + 1.3),
          0.46,
          delay,
        );
      }
    }
  }
  private damage(g: Game, b: Enemy): number {
    return Math.min(12 * b.dmgMul, 16 + 2 * Math.min(g.stage, 8));
  }
  private recover(g: Game, b: Enemy): void {
    this.action = 'wait';
    this.clock = restTime(this.cue!) / (1 + Math.min(0.4, g.director.enrageStep * 0.08));
    b.state = 'recover';
    b.t = this.clock;
  }
}
