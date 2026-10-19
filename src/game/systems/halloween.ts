/** Halloween: bounded host simulation, snapshot state, and local presentation. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../../render/geometry';
import { biomeForStage } from '../../data/biomes';
import type { Game } from '../game';
import type { Enemy, EnemyCtx } from '../enemies';
import { ENEMIES, type EnemyDef } from '../../data/enemies';
import {
  seasonAt,
  seasonSession,
  seasonalStage,
  HALLOWEEN_COSMETICS,
  halloweenTuning as T,
  buyCandyCosmetic,
} from '../../data/seasons';
import { save, persist, saveLock } from '../save';
import { createRetroMaterial } from '../../render/retroMaterial';
import { commit } from '../../render/instancing';
import { localize, localizeHtml } from '../../i18n';

export const halloweenMotion = { calm: false };

interface Candy {
  x: number;
  z: number;
  value: number;
}
export class HalloweenState {
  season: string | null = null;
  drops: Candy[] = Array.from({ length: T.candyCap }, () => ({ x: 0, z: 0, value: 0 }));
  earned = 0;
  banked = 0;
  kills = 0;
  spawnT = 3;
  witchT = 12;
  swarmT = 8;
  bossUid = -1;
  phase = 0;
  candies: THREE.InstancedMesh | null = null;
  looks: Record<number, string> = {};
  sentLook = '~';
  costumes: THREE.Group[] = [];
  costumeKeys: string[] = [];
  vines = Array.from({ length: 8 }, () => ({ x: 0, z: 0, t: 0 }));
  grabs = Array.from({ length: 8 }, () => ({ x: 0, z: 0, t: 0 }));
  label: HTMLElement | null = null;
  shop: HTMLElement | null = null;
  matrix = new THREE.Matrix4();
}
export function selectSeason(this: Game, value: unknown): void {
  this.halloween.season = value === 'halloween' ? value : null;
  seasonSession.id = this.halloween.season;
}
export function resetHalloween(this: Game): void {
  const s = this.halloween;
  s.earned = s.banked = s.kills = 0;
  s.sentLook = '~';
  s.looks = {};
  clearHalloween.call(this);
}
export function clearHalloween(this: Game): void {
  const s = this.halloween;
  for (const costume of s.costumes) if (costume) costume.visible = false;
  for (const d of s.drops) d.value = 0;
  for (const v of s.vines) v.t = 0;
  for (const v of s.grabs) v.t = 0;
  s.spawnT = 3;
  s.witchT = 12;
  s.swarmT = 8;
  s.bossUid = -1;
  s.phase = 0;
}
export function halloweenBoss(this: Game, def: EnemyDef): EnemyDef {
  return seasonalStage(this.stage, this.halloween.season) &&
    !this.pvp &&
    !this.versus &&
    def.behavior !== 'titan'
    ? ENEMIES.pumpking
    : def;
}
export function dropCandy(this: Game, x: number, z: number, value: number): void {
  const d = this.halloween.drops.find((d) => !d.value);
  if (d) {
    d.x = x;
    d.z = z;
    d.value = value;
  }
}
export function halloweenKill(this: Game, e: Enemy): void {
  if (!this.halloween.season || saveLock.on || this.pvp || this.versus || !e.active) return;
  const s = this.halloween;
  if (e.def.id === 'pumpkin') {
    this.vfx.sound('pumpkinSquish', e.x, e.z);
    for (let i = 0; i < T.seedCount; i++) {
      const a = (i * Math.PI * 2) / T.seedCount;
      this.enemyCtx.fireBullet(e, Math.cos(a), Math.sin(a), 5, 5);
    }
    this.vfx.burst(e.x, 0.8, e.z, {
      count: 10,
      color: '#ffcd75',
      speed: [2, 5],
      size: [0.1, 0.2],
      life: [0.3, 0.6],
      up: 3,
    });
  }
  if (e.def.boss || e.elite || ++s.kills % T.dropEvery === 0)
    dropCandy.call(this, e.x, e.z, e.def.boss ? 20 : e.elite ? 3 : 1);
}
function bank(g: Game): void {
  const s = g.halloween;
  if (s.earned <= s.banked || saveLock.on) return;
  save.seasonal.candy = Math.min(999999, save.seasonal.candy + s.earned - s.banked);
  s.banked = s.earned;
  persist();
}
export function halloweenStep(this: Game, dt: number): void {
  const s = this.halloween;
  if (this.role === 'client' || !s.season || saveLock.on || this.pvp || this.versus) return;
  for (const v of s.vines)
    if (v.t > 0 && (v.t -= dt) <= 0) {
      this.vfx.scar(v.x, v.z, T.vineRadius, '#38b764', 1.4);
      for (const h of this.heroes)
        if (
          !h.left &&
          !h.player.dead &&
          !h.player.dashing &&
          Math.hypot(h.player.x - v.x, h.player.z - v.z) < T.vineRadius
        ) {
          const grab = s.grabs[h.index];
          if (grab) {
            grab.x = h.player.x;
            grab.z = h.player.z;
            grab.t = 1.2;
          }
        }
    }
  for (const h of this.heroes) applyVineGrab(this, h.index, dt);
  for (const d of s.drops) {
    if (!d.value) continue;
    for (const h of this.heroes) {
      if (
        h.left ||
        h.player.dead ||
        (h.player.x - d.x) ** 2 + (h.player.z - d.z) ** 2 > T.pickupRadius ** 2
      )
        continue;
      s.earned += d.value;
      this.vfx.num(d.x, 1.8, d.z, `+${d.value} CANDY · TEAM`, 'score');
      this.vfx.sound('coin', d.x, d.z);
      d.value = 0;
      bank(this);
      break;
    }
  }
  if (!seasonalStage(this.stage, s.season) || this.mode !== 'fight' || this.bossDuel) return;
  if (!this.director.bossSpawned && this.enemies.activeCount < 350) {
    if ((s.spawnT -= dt) <= 0) {
      s.spawnT = 3;
      this.spawnEnemy(ENEMIES.pumpkin);
      this.spawnEnemy(ENEMIES.ghost);
      if (this.stepN % 3 === 0) this.vfx.sound('ghostWail', NaN, NaN);
    }
    if ((s.swarmT -= dt) <= 0) {
      s.swarmT = T.swarmEvery;
      this.spawnRing(ENEMIES.bat, 8);
      this.vfx.sound('halloweenBats', NaN, NaN);
    }
    if ((s.witchT -= dt) <= 0) {
      s.witchT = T.witchEvery;
      this.spawnEnemy(ENEMIES.witch, true);
      this.vfx.sound('witchCackle', NaN, NaN);
    }
  }
  const b = this.boss;
  if (b?.active && b.def.id === 'pumpking' && (b.uid !== s.bossUid || b.phase !== s.phase)) {
    const intro = b.uid !== s.bossUid;
    s.bossUid = b.uid;
    s.phase = b.phase;
    this.vfx.portrait(
      'boss:pumpking',
      'grinning',
      intro
        ? 'YOUR CANDY IS NOW ROYAL PROPERTY!'
        : b.phase === 2
          ? 'THE VINES ARE HUNGRY!'
          : 'TIME TO CARVE!',
      3,
    );
  }
}
/** Existing enemy timers/action fields are already carried by the enemy codec. */
export function pumpkinBrain(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
): void {
  e.vx = e.vz = 0;
  if (e.roarT > 0) {
    e.roarT = Math.max(0, e.roarT - dt);
    e.state = 'move';
    return;
  }
  if (e.action === 'spiral' && (e.state === 'windup' || e.state === 'recover')) e.facing += dt * 7;
  if (e.state === 'windup' && e.t <= 0) {
    if (e.action === 'volley') {
      const n = 7 + e.phase * 2;
      const aim = Math.atan2(e.lungeZ, e.lungeX);
      for (let i = 0; i < n; i++) {
        const a = aim + (i - (n - 1) / 2) * 0.15;
        ctx.fireBullet(e, Math.cos(a), Math.sin(a), 7 + e.phase, 12);
      }
    } else if (e.action === 'summon') {
      for (let i = 0; i < 2 + e.phase; i++) {
        const a = i * 2.4;
        ctx.spawnChild('pumpkin', e.x + Math.cos(a) * 4, e.z + Math.sin(a) * 4, e);
      }
    }
    e.state = 'recover';
    e.t = 1.6 - e.phase * 0.2;
  }
  if (e.state === 'recover') {
    if (e.t <= 0) e.state = 'move';
    return;
  }
  if (e.state === 'windup') return;
  if (dist > 7) {
    e.vx = nx * speed;
    e.vz = nz * speed;
  }
  e.facing = Math.atan2(nx, nz);
  if ((e.timerA -= dt) > 0) return;
  e.timerA = 2.8 - e.phase * 0.3;
  const move = e.step++ % (e.phase >= 3 ? 4 : e.phase >= 2 ? 3 : 2);
  e.action = move === 0 ? 'volley' : move === 1 ? 'summon' : move === 2 ? 'rain' : 'spiral';
  e.state = 'windup';
  e.t = move === 3 ? T.spinWarning : T.vineWarning;
  e.lungeX = nx;
  e.lungeZ = nz;
  ctx.onWindup(e);
  if (move === 2) {
    for (const t of ctx.targets)
      if (t.alive) {
        ctx.strike(t.x, t.z, T.vineRadius, T.vineWarning, 16);
        ctx.halloweenVine?.(t.x, t.z);
      }
  } else if (move === 3) {
    // Carving blades sweep eight marked points; the middle and outside stay escapable.
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.strike(
        e.x + Math.cos(a) * T.spinRadius,
        e.z + Math.sin(a) * T.spinRadius,
        1.5,
        T.spinWarning + i * 0.09,
        18,
      );
    }
  }
}
export function halloweenNet(this: Game): unknown {
  const s = this.halloween;
  s.looks[this.hero.index] = save.seasonal.equipped.join(',');
  return {
    season: s.season,
    earned: s.earned,
    looks: s.looks,
    grabs: s.grabs,
    drops: s.drops.filter((d) => d.value).map((d) => [d.x, d.z, d.value]),
  };
}
export function applyHalloweenNet(this: Game, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const n = raw as {
    season?: string;
    earned?: number;
    drops?: number[][];
    looks?: Record<number, string>;
    grabs?: { x: number; z: number; t: number }[];
  };
  selectSeason.call(this, n.season);
  const s = this.halloween;
  if (Number.isFinite(n.earned) && n.earned! >= s.earned)
    s.earned = Math.min(999999, Math.floor(n.earned!));
  bank(this);
  if (n.looks) for (const h of this.heroes) s.looks[h.index] = cleanHalloweenLook(n.looks[h.index]);
  if (n.grabs)
    for (let j = 0; j < s.grabs.length; j++) {
      const v = n.grabs[j];
      if (v && Number.isFinite(v.x + v.z + v.t)) Object.assign(s.grabs[j], v);
    }
  const look = save.seasonal.equipped.join(',');
  if (look !== s.sentLook) {
    s.sentLook = look;
    this.client?.send({ t: 'halook', look });
  }
  let i = 0;
  for (const d of n.drops ?? []) {
    if (i >= T.candyCap || d.length !== 3 || !d.every(Number.isFinite)) continue;
    const p = s.drops[i++];
    p.x = d[0];
    p.z = d[1];
    p.value = Math.max(0, Math.min(20, d[2]));
  }
  for (; i < T.candyCap; i++) s.drops[i].value = 0;
}

/** All meshes join the existing per-definition instanced enemy pools. */
export function halloweenModel(
  def: EnemyDef,
  add: (g: THREE.BufferGeometry, c: string, x: number, y: number, z: number) => void,
): boolean {
  const r = def.radius,
    B = def.bodyColor,
    A = def.accentColor;
  if (def.model === 'pumpkin' || def.model === 'pumpking') {
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI * 2) / 7;
      add(
        new THREE.SphereGeometry(r * 0.62, 6, 5).scale(1, 1.4, 1),
        i % 2 ? B : '#ef7d57',
        Math.cos(a) * r * 0.42,
        r,
        Math.sin(a) * r * 0.42,
      );
    }
    add(new THREE.CylinderGeometry(r * 0.13, r * 0.2, r * 0.5, 5), '#38b764', 0, r * 2, 0);
    for (const side of [-1, 1])
      add(new THREE.ConeGeometry(r * 0.25, r * 0.38, 3), A, side * r * 0.4, r * 1.25, r * 0.86);
    add(new THREE.BoxGeometry(r * 0.9, r * 0.18, r * 0.12), '#1a1c2c', 0, r * 0.7, r * 0.98);
    if (def.model === 'pumpking') {
      for (let i = -1; i <= 1; i++)
        add(new THREE.ConeGeometry(r * 0.23, r * 0.7, 4), '#ffcd75', i * r * 0.5, r * 2.1, 0);
      for (const side of [-1, 1]) {
        add(
          new THREE.BoxGeometry(r * 0.2, r * 0.2, r * 0.7),
          '#5d275d',
          side * r * 1.3,
          r * 0.9,
          0,
        );
        add(
          new THREE.BoxGeometry(r * 0.12, r * 0.4, r * 1.25),
          '#c0cbdc',
          side * r * 1.3,
          r * 0.9,
          r * 0.9,
        );
      }
    }
  } else if (def.model === 'ghost') {
    add(new THREE.SphereGeometry(r, 8, 6).scale(1, 1.3, 1), B, 0, r * 1.6, 0);
    for (let i = -1; i <= 1; i++)
      add(
        new THREE.ConeGeometry(r * 0.35, r * 0.8, 5).rotateZ(Math.PI),
        B,
        i * r * 0.6,
        r * 0.4,
        0,
      );
    for (const side of [-1, 1])
      add(
        new THREE.BoxGeometry(r * 0.23, r * 0.35, r * 0.15),
        '#29366f',
        side * r * 0.35,
        r * 1.8,
        r * 0.9,
      );
  } else if (def.model === 'bat') {
    add(new THREE.SphereGeometry(r * 0.65, 6, 5), B, 0, r * 2, 0);
    for (const side of [-1, 1]) {
      add(
        new THREE.ConeGeometry(r, r * 1.8, 3).rotateZ((side * Math.PI) / 2),
        B,
        side * r,
        r * 2,
        0,
      );
      add(new THREE.ConeGeometry(r * 0.25, r * 0.6, 3), A, side * r * 0.4, r * 2.6, 0);
    }
  } else if (def.model === 'witch') {
    add(new THREE.SphereGeometry(r, 8, 6).scale(1.1, 0.7, 1.1), '#333c57', 0, r * 0.7, 0);
    add(new THREE.CylinderGeometry(r * 0.85, r * 0.85, r * 0.08, 8), A, 0, r * 1.2, 0);
    add(new THREE.SphereGeometry(r * 0.5, 6, 5), A, 0, r * 1.9, 0);
    add(new THREE.ConeGeometry(r * 0.75, r * 1.4, 6), B, 0, r * 2.8, 0);
    add(new THREE.CylinderGeometry(r, r, r * 0.12, 8), B, 0, r * 2.2, 0);
  } else return false;
  return true;
}
function mesh(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, createRetroMaterial({ color }));
  m.position.set(x, y, z);
  group.add(m);
  return m;
}
/** Static scenery uses a few shared meshes per stage; no lights or frame allocations. */
export function dressHalloween(this: Game): void {
  if (biomeForStage(this.arenaStage).variant !== 'haunted') return;
  const group = new THREE.Group();
  // Decorations deliberately sit in the starting clearing and don't alter collision.
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      x = Math.cos(a) * 10,
      z = Math.sin(a) * 10;
    halloweenModel(ENEMIES.pumpkin, (g, c, px, py, pz) => mesh(group, g, c, x + px, py, z + pz));
    mesh(group, new THREE.CylinderGeometry(0.1, 0.14, 0.65, 5), '#ffcd75', x + 1.2, 0.35, z);
    mesh(group, new THREE.OctahedronGeometry(0.16), '#ef7d57', x + 1.2, 0.8, z);
  }
  for (const side of [-1, 1]) {
    const web = new THREE.Group();
    web.position.set(side * 7, 1.8, -6);
    for (let i = 0; i < 8; i++) {
      const spoke = mesh(web, new THREE.BoxGeometry(0.035, 3, 0.035), '#c0cbdc', 0, 0, 0);
      spoke.rotation.z = (i * Math.PI) / 4;
    }
    for (const r of [0.5, 1, 1.5])
      mesh(web, new THREE.TorusGeometry(r, 0.025, 3, 8), '#c0cbdc', 0, 0, 0);
    group.add(web);
  }
  mergeDecoration(group);
  this.arena.group.add(group);
}
export function showHalloweenShop(this: Game): void {
  const el = this.halloween.shop;
  if (!el) return;
  const wallet = save.seasonal;
  const active = seasonAt(new Date(), typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('season'))?.id === 'halloween';
  el.innerHTML = localizeHtml(`<h1>TRICK-OR-TREAT</h1><p class="note">${wallet.candy} CANDY · OCT 15 – NOV 7</p><p class="note">Collect candy together. Keep your treats forever.</p><div class="ha-treats">${HALLOWEEN_COSMETICS.map(
    (c) => {
      const owned = wallet.owned.includes(c.id),
        equipped = wallet.equipped.includes(c.id);
      return `<button data-nav data-treat="${c.id}" ${!owned && (!active || wallet.candy < c.cost) ? 'disabled' : ''}><span class="ha-art ha-${c.id}">${treatArt(c.id)}</span><b>${c.name.toUpperCase()}</b><small>${c.desc}</small><strong>${owned ? (equipped ? 'EQUIPPED · REMOVE' : 'OWNED · EQUIP') : c.cost + ' CANDY'}</strong></button>`;
    },
  ).join(
    '',
  )}</div><p class="note">Costumes are cosmetic. Earn 1 candy per 5 defeats, 3 per elite, 20 per boss.<br>Every teammate receives collected candy.</p><div class="menu"><button data-nav data-ha-back>BACK</button></div>`);
  el.querySelectorAll<HTMLButtonElement>('[data-treat]').forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.treat!;
        if (!wallet.owned.includes(id) && !buyCandyCosmetic(wallet, id, active))
          return;
        const i = wallet.equipped.indexOf(id);
        if (i < 0) wallet.equipped.push(id);
        else wallet.equipped.splice(i, 1);
        persist();
        showHalloweenShop.call(this);
      }),
  );
  el.querySelector<HTMLButtonElement>('[data-ha-back]')!.onclick = () => this.screens.show('title');
  this.screens.show('halloween');
}
export function installHalloween(this: Game, root: HTMLElement): void {
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  halloweenMotion.calm = media?.matches ?? false;
  media?.addEventListener('change', (e) => {
    halloweenMotion.calm = e.matches;
  });
  const query =
    typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('season');
  selectSeason.call(this, typeof location === 'undefined' ? null : seasonAt(new Date(), query)?.id);
  const style = document.createElement('style');
  style.textContent = `
  #scr-title.ha-title::before{background-color:rgba(93,39,93,0.4);mask:none;-webkit-mask:none}
  #scr-title.ha-title .logo span:first-child i{color:var(--orange);text-shadow:var(--outline),0 6px var(--red),0 12px var(--plum)}
  #scr-title .ha-booth{position:absolute;right:calc(8 * var(--p));top:53%;width:calc(75 * var(--p));display:flex;align-items:center;flex-direction:column;gap:calc(3 * var(--p));--bg:#5d275d;--hi:#b13e53;--lo:#1a1c2c;--ring:#ef7d57}
  .ha-booth svg{width:72px;height:72px}.ha-booth small{font-size:calc(4 * var(--p))}
  @media(max-width:1000px){#scr-title .ha-booth{position:static;flex-shrink:0}.ha-booth svg{display:none}}
  #scr-title.ha-title .logo{color:var(--orange);text-shadow:calc(2 * var(--p)) calc(2 * var(--p)) var(--plum)}
  .ha-banner{position:absolute;top:0;margin:calc(3 * var(--p));color:var(--yellow);font-family:'Silkscreen',monospace;font-size:calc(5 * var(--p));text-align:center;max-width:90vw}
  #scr-halloween{background:#1a1c2c;color:#f4f4f4;gap:calc(4 * var(--p));padding:calc(8 * var(--p));overflow:auto}
  #scr-halloween h1{color:#ef7d57;margin:0}.ha-treats{display:flex;gap:calc(5 * var(--p));max-width:95vw;flex-wrap:wrap;justify-content:center}
  .ha-treats button{display:flex;flex-direction:column;gap:calc(4 * var(--p));width:calc(90 * var(--p));min-height:calc(85 * var(--p));--bg:#29366f;--hi:#b13e53;--lo:#1a1c2c;--ring:#ef7d57}
  .ha-treats small{white-space:normal}.ha-art{font:calc(25 * var(--p)) 'Jersey 10';color:#ef7d57}.ha-art svg{width:72px;height:72px;image-rendering:pixelated}.ha-bat_pet{color:#b13e53}.ha-ghost_trail{color:#73eff7}
  #ha-candy{position:absolute;bottom:calc(6 * var(--p));left:calc(6 * var(--p));color:#ffcd75;background:#1a1c2c;padding:calc(2 * var(--p));font-family:'Silkscreen';font-size:calc(4 * var(--p));pointer-events:none}
  `;
  document.head.appendChild(style);
  const title = document.querySelector<HTMLElement>('#scr-title');
  if (title) {
    if (this.halloween.season) {
      title.classList.add('ha-title');
      const banner = document.createElement('p');
      banner.className = 'ha-banner';
      banner.textContent = localize('HALLOWEEN · THE HAUNTED HARVEST · OCT 15 – NOV 7');
      title.prepend(banner);
    }
    const button = document.createElement('button');
    button.setAttribute('data-nav', '');
    button.className = 'ha-booth';
    button.innerHTML = localizeHtml(`${treatArt('pumpkin_helmet')}<b>TRICK-OR-TREAT</b><small>CANDY &amp; COSTUMES</small>`);
    button.onclick = () => showHalloweenShop.call(this);
    title.appendChild(button);
  }
  const shop = document.createElement('div');
  shop.id = 'scr-halloween';
  shop.className = 'screen dim';
  this.halloween.shop = shop;
  this.screens.addScreen('halloween', shop, { onBack: () => this.screens.show('title') });
  const label = document.createElement('div');
  label.id = 'ha-candy';
  label.hidden = true;
  root.appendChild(label);
  this.halloween.label = label;
  const candies = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.3),
    createRetroMaterial({ color: '#ef7d57', unlit: 0.6 }),
    T.candyCap,
  );
  candies.frustumCulled = false;
  candies.count = 0;
  this.scene.add(candies);
  this.halloween.candies = candies;
}
export function renderHalloween(this: Game, calm = false): void {
  calm ||= halloweenMotion.calm;
  const s = this.halloween;
  if (s.label) {
    s.label.hidden = !s.season || this.mode === 'title';
    const text = localize(`${save.seasonal.candy} CANDY · +${s.earned} THIS RUN`);
    if (s.label.textContent !== text) s.label.textContent = text;
  }
  if (s.candies) {
    let i = 0;
    if (this.mode !== 'title')
      for (const d of s.drops)
        if (d.value) {
          s.matrix.makeRotationY(this.runTime);
          s.matrix.setPosition(d.x, 0.7, d.z);
          s.candies.setMatrixAt(i++, s.matrix);
        }
    s.candies.count = i;
    commit(s.candies.instanceMatrix, i);
  }
  for (const h of this.heroes) {
    const key = h === this.hero ? save.seasonal.equipped.join(',') : (s.looks[h.index] ?? '');
    let group = s.costumes[h.index];
    if (s.costumeKeys[h.index] !== key || !group) {
      if (group) {
        this.scene.remove(group);
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
      }
      s.costumeKeys[h.index] = key;
      group = s.costumes[h.index] = new THREE.Group();
      this.scene.add(group);
      if (key.includes('pumpkin_helmet')) {
        const g = new THREE.Group();
        halloweenModel(ENEMIES.pumpkin, (geo, c, x, y, z) => mesh(g, geo, c, x, y, z));
        mergeDecoration(g);
        g.scale.setScalar(0.65);
        g.position.y = 1.2;
        // The hero x-ray should not paint the original helmet over this costume.
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.renderOrder = 51;
            const mat = o.material as THREE.Material;
            mat.depthWrite = false;
            mat.depthTest = false;
          }
        });
        group.add(g);
      }
      if (key.includes('bat_pet')) {
        const g = new THREE.Group();
        g.name = 'bat';
        halloweenModel(ENEMIES.bat, (geo, c, x, y, z) => mesh(g, geo, c, x, y, z));
        mergeDecoration(g);
        g.position.set(1.2, 1.3, -0.5);
        group.add(g);
      }
      if (key.includes('ghost_trail'))
        for (let i = 0; i < 3; i++) {
          const g = new THREE.Group();
          halloweenModel(ENEMIES.ghost, (geo, c, x, y, z) => mesh(g, geo, c, x, y, z));
          mergeDecoration(g);
          g.scale.setScalar(0.45 - i * 0.08);
          g.position.set(0, 0.25, -1 - i * 0.6);
          group.add(g);
        }
    }
    const p = h.player;
    group.visible = !p.dead && !h.left && this.mode !== 'title';
    group.position.set(p.x, 0, p.z);
    group.rotation.y = Math.atan2(p.aim.x, p.aim.z);
    const bat = group.getObjectByName('bat');
    if (bat) bat.position.y = 1.3 + (calm ? 0 : Math.sin(this.runTime * 4) * 0.15);
  }
}
/** Bake scenery/accessories into one vertex-coloured mesh; dispose construction materials. */
function mergeDecoration(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as ReturnType<typeof createRetroMaterial>;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    paint(geo, mat.uniforms.uColor.value);
    parts.push(geo);
    o.geometry.dispose();
    mat.dispose();
  });
  group.clear();
  if (parts.length) {
    const geometry = mergeGeometries(parts)!;
    group.add(new THREE.Mesh(geometry, createRetroMaterial({ vertexColors: true })));
    for (const g of parts) g.dispose();
  }
}
/** Pixel-dither fading keeps ghosts legible and avoids transparent-instance sorting. */
export function ghostMaterial(mat: ReturnType<typeof createRetroMaterial>): void {
  mat.uniforms.haCalm = { value: 0 };
  mat.fragmentShader =
    'uniform float haCalm;\nuniform float uTime;\n' +
    mat.fragmentShader.replace(
      'outColor = vec4(col, glow * (1.0 - vFog));',
      `
    float fade = mix(0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * 1.5707963)), 0.65, haCalm);
    if (fract(dot(floor(gl_FragCoord.xy), vec2(0.754877, 0.56984))) > fade) discard;
    outColor = vec4(col, glow * (1.0 - vFog));`,
    );
  mat.needsUpdate = true;
}
export function halloweenLinks(g: Game, q: URLSearchParams): void {
  if (q.has('harvestshow'))
    setTimeout(() => {
      const b = g.boss;
      if (b) {
        b.x = b.px = g.hero.player.x + 5;
        b.z = b.pz = g.hero.player.z - 3;
        b.phase = Number(q.get('phase')) || 1;
        b.hp = b.maxHp * (b.phase === 3 ? 0.3 : b.phase === 2 ? 0.6 : 1);
        b.roarT = 0;
      }
      g.hud.showBanner('', '', 0);
      g.introLeft = 0;
      g.slowMoT = 0;
    }, 1600);
  if (q.has('candy')) dropCandy.call(g, g.hero.player.x + 0.5, g.hero.player.z, 20);
  if (q.has('costumes')) {
    save.seasonal.owned = HALLOWEEN_COSMETICS.map((c) => c.id);
    save.seasonal.equipped = [...save.seasonal.owned];
  }
  if (q.has('treats'))
    setTimeout(() => {
      g.paused = true;
      showHalloweenShop.call(g);
    }, 700);
}

export function cleanHalloweenLook(value: unknown): string {
  if (typeof value !== 'string') return '';
  return HALLOWEEN_COSMETICS.filter((c) => value.split(',').includes(c.id))
    .map((c) => c.id)
    .join(',');
}
export function addHalloweenVine(this: Game, x: number, z: number): void {
  const v = this.halloween.vines.find((v) => v.t <= 0);
  if (v) {
    v.x = x;
    v.z = z;
    v.t = T.vineWarning;
  }
}
/** Dash breaks a grab; otherwise the vine allows 0.65 m of movement for 1.2 s. */
export function applyVineGrab(g: Game, index: number, dt: number): void {
  const v = g.halloween.grabs[index],
    p = g.heroes[index]?.player;
  if (!v || !p || v.t <= 0) return;
  v.t -= dt;
  if (p.dashing || p.dead) {
    v.t = 0;
    return;
  }
  const dx = p.x - v.x,
    dz = p.z - v.z,
    d = Math.hypot(dx, dz);
  if (d > 0.65) {
    p.pos.x = v.x + (dx / d) * 0.65;
    p.pos.z = v.z + (dz / d) * 0.65;
  }
}

function treatArt(id: string): string {
  const art =
    id === 'pumpkin_helmet'
      ? '<path fill="#38b764" d="M11 1h3v5h-3z"/><path fill="#ef7d57" d="M5 5h14v2h3v13h-3v2H5v-2H2V7h3z"/><path fill="#ffcd75" d="M7 8h2v3H5v-2h2zm8 0h2v1h2v2h-4zM6 15h12v2h-2v2H8v-2H6z"/><path fill="#b13e53" d="M10 6h2v8h-2zm3 12h2v3h-2z"/>'
      : id === 'bat_pet'
        ? '<path fill="#b13e53" d="M1 4h2v3h4v3h3V6h4v4h3V7h4V4h2v12h-3v-2h-3v3h-3v3h-4v-3H7v-3H4v2H1z"/><path fill="#ffcd75" d="M10 11h1v2h-1zm3 0h1v2h-1z"/>'
        : '<path fill="#f4f4f4" d="M8 3h8v2h3v3h2v14h-3v-3h-3v3H9v-3H6v3H3V8h2V5h3z"/><path fill="#29366f" d="M7 9h3v4H7zm7 0h3v4h-3zM10 16h4v3h-4z"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges">${art}</svg>`;
}
