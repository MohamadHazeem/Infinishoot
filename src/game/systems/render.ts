import { weeklyChallenge } from '../../data/weekly';
/**
 * Rendering: per-frame presentation, HUD, music and sky.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `eliteTrails = Render.eliteTrails;`.
 */
import type { Game } from '../game';
import { updateSound } from './sound';
import { updateAudioMix } from './audiomix';
import { updateVoiceLines } from './voiceLines';
import { scoreTuning, AIM_HEIGHT, REVIVE_TIME } from '../game';
import * as THREE from 'three';
import { MOD_BY_ID } from '../../data/mods';
import { sfx } from '../../audio/sfx';
import { biomeTrack, bossTrack, music, type TrackId } from '../../audio/music';
import { applyTimeOfDay } from '../../render/biomeLook';
import { retroGlobals } from '../../render/retroMaterial';
import { BULLET_Y } from '../bullets';
import { cameraTuning } from '../cameraRig';
import { Hero } from '../hero';
import { type Player } from '../player';
import { settings } from '../settings';
import { ChargeShot } from '../weapons';
import { bossTuning, omegaTuning } from '../enemies';
import { streaks } from '../streaks';
import { lap, lapStart } from '../../core/prof';
import { viewCull } from '../../render/viewCull';
import { MODE_BY_ID, MODES, today, type ModeId } from '../../data/modes';
import { boardId, fetchTop, leaderboardEnabled } from '../../net/leaderboard';

/** Fast elites leave puffs behind. Cosmetic and derived from synced state, so every machine draws its own. */
export function eliteTrails(this: Game, frameDt: number): void {
  if (this.paused || !this.isCombatMode) return;
  this.trailT += frameDt;
  if (this.trailT < 0.05) return;
  this.trailT = 0;
  for (const e of this.enemies.list) {
    if (!e.active || !e.mod?.trail || e.state === 'spawning' || (e.x === e.px && e.z === e.pz)) continue;
    const s = e.scale;
    this.particles.burst(e.x, e.radius * 0.8, e.z, { count: 2, color: e.mod.color, color2: '#ffcd75', speed: [0.2, 0.9], size: [0.2 * s, 0.38 * s], life: [0.25, 0.45], up: 0.6, drag: 3 });
  }
}

/** The living teammate to watch while downed. */
export function spectateTarget(this: Game): Player | null {
  const alive = this.heroes.filter((x) => x !== this.hero && !x.left && !x.player.dead);
  if (!alive.length) return null;
  return (alive.find((x) => x.index === this.spectate) ?? alive[0]).player;
}

/** Co-op extras for this machine's player: pings, and switching who you watch while downed. */
export function coopInput(this: Game): void {
  const input = this.input;
  const h = this.hero;
  const p = h.player;
  if (!this.isCombatMode || this.screens.current !== 'none' || this.heroes.length < 2) return;
  if (p.dead) {
    if (input.mousePressed(0) || input.padButtonPressed(0) || input.actionPressed('ping')) {
      const alive = this.heroes.filter((x) => x !== h && !x.left && !x.player.dead);
      if (alive.length) {
        const cur = alive.findIndex((x) => x.index === this.spectate);
        this.spectate = alive[(cur + 1) % alive.length].index;
      }
    }
    return;
  }
  if (!(input.actionPressed('ping') || input.padButtonPressed(8))) return;
  let x = p.x + p.aim.x * 6;
  let z = p.z + p.aim.z * 6;
  if (input.device === 'kbm' && this.mouseAimPoint()) {
    x = this.aimHit.x;
    z = this.aimHit.z;
  }
  if (this.role === 'client') this.client?.send({ t: 'ping', x, z });
  else this.ping(h, x, z);
}

/** A teammate pings a spot: a marker and a label everyone sees. */
export function ping(this: Game, h: Hero, x: number, z: number): void {
  if (performance.now() - h.pingAt < 700) return;
  h.pingAt = performance.now();
  let label = 'HERE!';
  const near = (ax: number, az: number, r: number) => Math.hypot(ax - x, az - z) < r;
  if (this.chests.list.some((c) => c.openT < 0 && near(c.x, c.z, 4))) label = 'CHEST!';
  else if (this.portal.active && near(this.portal.x, this.portal.z, 5)) label = 'PORTAL!';
  else {
    const e = this.nearestEnemy(x, z, 4, (en) => !en.elite && !en.def.boss);
    if (e) label = e.def.boss ? 'BOSS!' : 'ELITE!';
  }
  this.vfx.ring(x, z, 0.5, 4, h.color, 0.6);
  this.vfx.ring(x, z, 0.5, 2.5, '#ffffff', 0.45);
  this.vfx.star(x, 2, z, 1.6, h.color, 0.5);
  this.vfx.num(x, 3, z, `${h.name.toUpperCase()}: ${label}`, 'score');
  this.vfx.sound('telegraph', x, z);
  this.pingPortrait(h, label);
}

/** Load the online top scores for the selected mode (no-op when offline). */
export function refreshGlobal(this: Game, board?: string, highlight = -1): void {
  if (!leaderboardEnabled) return;
  const mode = (MODE_BY_ID[settings.mode as ModeId] ?? MODES[0]).id;
  const b = board ?? (mode === 'weekly' ? weeklyChallenge().board : boardId(mode, mode === 'daily' ? 'normal' : this.pickDifficulty().id, today()));
  const title = b.startsWith('daily') ? 'TODAY' : b.replace('-', ' · ').toUpperCase();
  void fetchTop(b).then((list) => this.screens.setGlobalScores(title, list, highlight));
}

/** Midday to sunset over each stage: dusk falls in the second half, the boss fights at sunset. */
export function updateSky(this: Game, frameDt: number): void {
  let want = 0;
  if (this.mode !== 'title') {
    const d = this.director.duration;
    const frac =
      this.role === 'client' ? (this.netTimeLeft >= 0 ? 1 - this.netTimeLeft / d : 1) : this.director.bossSpawned ? 1 : this.director.time / d;
    want = Math.max(0, Math.min(1, (frac - 0.35) / 0.65));
  }
  // A new stage starts back at midday straight away; otherwise ease.
  this.dayK = want < this.dayK - 0.5 ? want : this.dayK + (want - this.dayK) * Math.min(1, frameDt * 0.8);
  applyTimeOfDay(this.dayK);
  // Fog bank event: the fog rolls in close, then lifts.
  const fog = this.role === 'client' ? this.netEvent?.[0] === 'fog' : this.runEvents.fog;
  const k = this.fogK + ((fog ? 1 : 0) - this.fogK) * Math.min(1, frameDt * 1.2);
  if (k > 0.002 || this.fogK > 0.002) {
    // The camera sits ~25 m from the hero: thick fog from 20 m hides everything past the screen's middle.
    retroGlobals.uFogNear.value = 28 + (19 - 28) * k;
    retroGlobals.uFogFar.value = 70 + (33 - 70) * k;
  }
  this.fogK = k < 0.002 ? 0 : k;
}

/** What the music should be doing right now (local to each machine). */
export function updateMusic(this: Game, frameDt: number, boss: { hp01: number } | null): void {
  const m = this.mode;
  const inRun = m !== 'title' && m !== 'dead';
  let track: TrackId | null = null;
  let intensity = 0.6;
  if (!inRun) track = m === 'title' ? 'title' : null;
  else if (boss) {
    track = bossTrack(this.stage);
    intensity = 1;
  } else {
    track = biomeTrack(this.arenaStage);
    intensity = m === 'fight' ? Math.min(1, 0.12 + this.enemies.activeCount / 140 + this.director.time / this.director.duration / 3) : 0.3;
  }
  if (m === 'shop' || m === 'cleared' || m === 'portal') track = 'shop';
  const omega = bossTrack(this.stage) === 'omega';
  music.setBossPhase(!boss ? 1 : omega && boss.hp01 < omegaTuning.phase3At ? 3 : boss.hp01 < (omega ? omegaTuning.phase2At : bossTuning.enrageAt) ? 2 : 1);
  const duck = this.paused || m === 'levelup' || (track !== 'shop' && this.screens.current !== 'none' && inRun);
  music.update(frameDt, { track, seed: track === 'title' ? 1 : (this.seed ^ Math.imul(this.stage, 0x9e3779b1)) >>> 0, intensity, duck, stage: this.stage, cue: m === 'cleared' ? 'victory' : m === 'dead' ? 'gameover' : undefined });
  document.documentElement.style.setProperty('--beat', music.pulse.toFixed(2));
}

/** Sounds only this machine hears: low-life heartbeat and the combo hum. */
export function localAudio(this: Game, frameDt: number, frozen: boolean): void {
  const fighting = this.isCombatMode && !frozen && !this.paused;
  sfx.setHum(fighting ? Math.min(1, this.combo / 150) : 0);
  // Damage hit-stop must not hide the HP drop from the local audio state.
  updateAudioMix.call(this, frameDt, this.isCombatMode && !this.paused);
}

export function render(this: Game, alpha: number, frameDt: number): void {
  lapStart();
  viewCull.update(this.cam.camera); // last frame's view, for the instanced pools' culling
  const client = this.role === 'client';
  const local = this.hero;
  const p = local.player;
  const input = this.input;
  const frozen = (this.paused && this.role === 'solo') || this.mode === 'levelup' || this.mode === 'shop';
  const a = this.juice.hitStop > 0 || frozen ? 1 : alpha;
  // Clients draw remote things between the last two snapshots.
  const netA = client ? Math.min(1, (performance.now() - this.snapTime) / Math.max(16, this.snapInterval)) : a;
  const rdt = frozen ? 0 : frameDt * (this.slowMoT > 0 ? 0.35 : 1);
  this.localAudio(frameDt, frozen);
  updateSound.call(this, frameDt, frozen);
  updateVoiceLines.call(this, frozen); // voice channel + local hero barks
  this.input.rumbleOn = settings.rumble;
  // Boss-kill slow motion (host/solo sim runs at 35%): cosmetic animation slows with it.
  const slow = this.slowMoT > 0 ? 0.35 : 1;
  if (!frozen) {
    this.juice.tick(frameDt);
    this.animTime += frameDt * slow;
  }

  for (const h of this.heroes) {
    if (h.left) {
      h.player.rig.root.visible = false;
      continue;
    }
    h.petView?.render(rdt, h.player.rig.root.position.x, h.player.rig.root.position.z, h.player.rig.root.rotation.y, !h.player.dead && this.mode !== 'transition');
    h.player.cheer = this.mode === 'cleared';
    h.player.focus = h === local && h.ctx.charging;
    h.player.render(h === local || !client ? a : netA, rdt);
  }
  lap('ren.heroes+audio');
  const watch = p.dead && this.heroes.length > 1 ? this.spectateTarget() : null;
  (watch ?? p).renderPos(watch ? netA : a, this.playerPos);
  // Danger zones are cosmetic timers: tick them with the frame (they hold still in menus).
  const zones = this.enemies.zones;
  if (!this.paused && this.mode !== 'levelup' && this.mode !== 'shop') {
    for (let i = zones.length - 1; i >= 0; i--) if ((zones[i].t -= frameDt) <= 0) zones.splice(i, 1);
  }
  this.enemies.renderWalls = this.arena.colliders;
  this.enemies.renderBounds = this.arena.halfSize;
  this.enemies.familyReduceFlash = settings.reduceFlash;
  this.enemies.familyColorblind = settings.colorblind;
  this.enemies.render(client ? netA : a, this.animTime);
  lap('ren.enemies');
  this.eliteTrails(frameDt);
  this.bullets.render(a);
  lap('ren.bullets');
  this.barrels.render(this.animTime);
  this.renderArena(rdt);
  this.chests.render(this.paused ? 0 : frameDt, this.animTime);
  lap('ren.barrels+arena+chests');
  this.particles.render();
  this.scars.render(rdt);
  streaks.render(rdt);
  lap('ren.particles+scars');
  this.ambience.render(rdt, this.playerPos.x, this.playerPos.z, this.heroes.filter((h) => !h.left && !h.player.dead).map((h) => h.player));
  lap('ren.ambience');
  this.pickups.render(this.animTime);
  for (const h of this.heroes) for (const w of h.weapons) w.draw(a, h.ctx);
  this.fx.render(this.cam.camera);
  this.portal.render(rdt);
  this.renderMuzzleFlashes();
  lap('ren.pickups+weapons+fx');

  const inMenu = this.mode === 'title' || this.screens.current !== 'none';
  if (this.mode === 'title') this.lead.set(0, 0, 0);
  else if (input.device === 'pad') {
    const active = input.padAim.x !== 0 || input.padAim.y !== 0;
    this.lead.set(p.aim.x, 0, p.aim.z).multiplyScalar(active ? cameraTuning.padLookAhead : 0);
  } else if (!frozen && this.mouseAimPoint()) {
    this.lead.set(this.aimHit.x - this.playerPos.x, 0, this.aimHit.z - this.playerPos.z).multiplyScalar(cameraTuning.lookAhead);
    if (this.lead.length() > cameraTuning.lookAheadMax) this.lead.setLength(cameraTuning.lookAheadMax);
  }
  this.renderBossFight(frameDt, frozen || this.paused);
  this.juice.shakeOffset(this.shake);
  this.cameraDirector();
  this.cam.update(this.playerPos, this.lead, frameDt, this.shake);

  if (inMenu || p.dead) this.reticle.style.display = 'none';
  else if (input.device === 'pad') {
    this.tmp.set(this.playerPos.x + p.aim.x * 5, AIM_HEIGHT, this.playerPos.z + p.aim.z * 5).project(this.cam.camera);
    this.reticle.style.transform = `translate(${((this.tmp.x + 1) / 2) * innerWidth}px, ${((1 - this.tmp.y) / 2) * innerHeight}px)`;
    this.reticle.style.display = '';
  } else {
    this.reticle.style.transform = `translate(${input.mouse.x}px, ${input.mouse.y}px)`;
    this.reticle.style.display = input.mouse.inside ? '' : 'none';
  }
  // Crosshair meter: the Charge Shot's charge, or the right-click weapon reloading.
  const sec = local.weapons.find((w) => w.def.slot === 'secondary');
  let meter: number;
  let state: string;
  if (sec && !(sec instanceof ChargeShot)) {
    // Ping when a long reload finishes, so you know it's ready without looking.
    if (sec.ready >= 1 && this.lastReady < 1 && !p.dead && this.isCombatMode) {
      this.readyFlashT = 0.4;
      if (sec.p.cd >= 2) sfx.weapon('ready');
    }
    this.lastReady = sec.ready;
    this.readyFlashT = Math.max(0, this.readyFlashT - frameDt);
    meter = this.readyFlashT > 0 ? 1 : sec.ready;
    state = this.readyFlashT > 0 ? 'ready' : sec.ready < 1 ? 'reload' : '';
  } else {
    meter = sec instanceof ChargeShot ? sec.charge : 0;
    state = meter >= 2 ? 'over' : meter >= 1 ? 'full' : meter > 0 ? 'on' : '';
  }
  if (meter !== this.shownCharge || state !== this.reticle.dataset.charge) {
    this.shownCharge = meter;
    this.reticle.style.setProperty('--charge', String(Math.min(1, meter)));
    this.reticle.dataset.charge = state;
  }

  // Client-side stage fade (the host fades itself in updateTransition).
  if (client) {
    if (this.mode === 'transition') this.hud.setFade(Math.min(1, (this.fadeT += frameDt) / 0.35));
    else this.hud.setFade(Math.max(0, this.fadeT / 0.45));
  }

  if (local.loadoutDirty) {
    local.loadoutDirty = false;
    this.hud.setLoadout(local.loadout());
  }
  const mods = client
    ? this.netMods.filter((m) => MOD_BY_ID[m.id]).map((m) => ({ def: MOD_BY_ID[m.id], ro: m.ro }))
    : local.synergy.slots.map((sl, i) => ({ def: sl.def, ro: local.synergy.readout(i) }));
  this.hud.setMods(mods.map((m) => ({ id: m.def.id, icon: m.def.icon, color: m.def.color, name: m.def.name, readout: m.ro, cursed: !!m.def.cursed })));
  lap('ren.camera+reticle');
  this.renderTeam();
  this.renderCompanion(rdt);
  this.renderEliteBars(alpha);
  this.renderMinimap();
  this.hud.setDowned(this.heroes.length > 1 && this.isCombatMode && this.hero.player.dead ? { revive01: Math.min(1, this.hero.reviveT / REVIVE_TIME) } : null);
  this.renderChestPointer();
  lap('ren.hudbits');
  this.dmg.render(rdt, this.cam.camera);
  lap('ren.dmgnums');
  const boss = client ? this.netBoss : this.boss && this.boss.active ? { name: this.boss.def.name, hp01: Math.max(0, this.boss.hp / this.boss.maxHp) } : null;
  this.updateMusic(frameDt, boss);
  this.updateSky(frameDt);
  lap('ren.music+sky');
  this.updateLook(frameDt);
  lap('ren.look');
  this.worldFx(frameDt);
  lap('ren.worldfx');
  this.hud.update(
    {
      hp: p.hp,
      maxHp: p.maxHp,
      dash01: p.dashReady01,
      dashStock: p.dashStock,
      dashMax: p.dashMax,
      bomb01: local.bombCharge,
      special: local.specialDef.short,
      score: this.score * this.meta.multiplier,
      metaLabel: this.meta.label,
      combo: this.combo,
      multiplier: this.multiplier,
      combo01: client ? this.netCombo01 : this.combo > 0 ? Math.max(0, this.comboT / scoreTuning.comboWindow) : 0,
      stage: this.stage,
      level: this.level,
      xp01: this.xp / this.xpNext,
      timeLeft: client ? this.netTimeLeft : !this.director.bossSpawned ? this.director.remaining : this.boss ? -1 : -2,
      kills: this.kills,
      gold: local.gold,
      gears: local.rerollsLeft,
      boss: this.bossHud(boss),
      lowHp: !p.dead && p.hp / p.maxHp <= 0.3 && this.mode !== 'title',
      spice: this.spiceLines(),
    },
    frameDt,
  );
  lap('ren.hud');
  this.renderSkill(frameDt, frozen);
  this.renderCharacters(frameDt);
  lap('ren.skill');
}

export function renderMuzzleFlashes(this: Game): void {
  while (this.flashes.length < this.heroes.length) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: '#fffbe0' }));
    m.visible = false;
    this.scene.add(m);
    this.flashes.push(m);
  }
  this.flashes.forEach((m, i) => {
    const h = this.heroes[i];
    m.visible = !!h && !h.left && h.weapons.some((w) => w.muzzleT > 0) && !h.player.dead;
    if (!m.visible) return;
    h.player.muzzle(this.mz);
    m.position.set(this.mz.x, BULLET_Y, this.mz.z);
    m.scale.setScalar((0.8 + Math.random() * 0.6) * this.muzzleScale(h));
  });
}

/** Point at the nearest closed chest when it is off screen. */
export function renderChestPointer(this: Game): void {
  const p = this.hero.player;
  let best: { x: number; z: number } | null = null;
  let bd = 60;
  if (this.isCombatMode && !p.dead) {
    for (const c of this.chests.list) {
      if (c.openT >= 0) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
  }
  if (!best) {
    this.hud.setChestPointer(null);
    return;
  }
  this.tmp.set(best.x, 0.5, best.z).project(this.cam.camera);
  const sx = ((this.tmp.x + 1) / 2) * innerWidth;
  const sy = ((1 - this.tmp.y) / 2) * innerHeight;
  const m = 70;
  const seen = 10; // any part of the chest on screen: no pointer needed
  if (sx > seen && sx < innerWidth - seen && sy > seen && sy < innerHeight - seen) {
    this.hud.setChestPointer(null);
    return;
  }
  // Clamp onto a rectangle inset from the screen edge, along the line from the centre.
  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const k = Math.min((cx - m) / Math.abs(dx || 1e-6), (cy - m) / Math.abs(dy || 1e-6));
  this.hud.setChestPointer({ x: cx + dx * k, y: cy + dy * k, angle: (Math.atan2(dy, dx) * 180) / Math.PI, dist: bd });
}

/** Teammate bars and name tags (co-op only). */
/** Corner minimap: you, teammates, boss, elites, closed chests, the portal. */
export function renderMinimap(this: Game): void {
  if (!this.isCombatMode) {
    this.hud.setMinimap(null);
    return;
  }
  const me = this.hero;
  const elites: { x: number; z: number }[] = [];
  let boss: { x: number; z: number } | null = null;
  for (const e of this.enemies.list) {
    if (!e.active) continue;
    if (e.def.boss) boss = { x: e.x, z: e.z };
    else if (e.elite || e.def.id === 'reaper') elites.push({ x: e.x, z: e.z });
  }
  this.hud.setMinimap({
    half: this.arena.halfSize,
    me: { x: me.player.x, z: me.player.z, color: me.color },
    mates: this.heroes.filter((h) => h !== me && !h.left).map((h) => ({ x: h.player.x, z: h.player.z, color: h.color, down: h.player.dead })),
    boss,
    elites,
    chests: this.chests.list.filter((c) => c.openT < 0).map((c) => ({ x: c.x, z: c.z })),
    portal: this.portal.active ? { x: this.portal.x, z: this.portal.z } : null,
  });
}

/** Health bars over elites (bosses use the big boss bar). */
export function renderEliteBars(this: Game, alpha: number): void {
  const bars: { x: number; y: number; hp01: number; onScreen: boolean }[] = [];
  if (this.isCombatMode && this.screens.current === 'none') {
    for (const e of this.enemies.list) {
      if (!e.active || !(e.elite || e.def.special || e.def.id === 'reaper') || e.def.boss || e.hp <= 0) continue;
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.pz + (e.z - e.pz) * alpha;
      this.tmp.set(x, e.hopY + e.radius * 2.6, z).project(this.cam.camera);
      bars.push({
        x: ((this.tmp.x + 1) / 2) * innerWidth,
        y: ((1 - this.tmp.y) / 2) * innerHeight,
        hp01: Math.max(0, Math.min(1, e.hp / e.maxHp)),
        onScreen: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.05 && Math.abs(this.tmp.y) < 1.05,
      });
    }
  }
  this.hud.setEliteBars(bars);
}

export function renderTeam(this: Game): void {
  if (this.heroes.length < 2 || this.mode === 'title') {
    this.hud.setTeam([], []);
    return;
  }
  const team = this.heroes
    .filter((h) => h !== this.hero)
    .map((h) => ({ name: h.name, color: h.color, hp01: h.left ? 0 : Math.max(0, h.player.hp / h.player.maxHp), down: h.player.dead, left: h.left }));
  const tags = this.heroes
    .filter((h) => h !== this.hero && !h.left)
    .map((h) => {
      const r = h.player.rig.root.position;
      this.tmp.set(r.x, 2.6, r.z).project(this.cam.camera);
      return {
        x: ((this.tmp.x + 1) / 2) * innerWidth,
        y: ((1 - this.tmp.y) / 2) * innerHeight,
        name: h.name,
        color: h.color,
        down: h.player.dead,
        revive01: h.reviveT / REVIVE_TIME,
        dist: Math.hypot(h.player.x - this.hero.player.x, h.player.z - this.hero.player.z),
        onScreen: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1,
      };
    });
  this.hud.setTeam(team, tags);
}
