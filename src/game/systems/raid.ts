import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Hero } from '../hero';
import type { DamageOpts } from '../weapons';
import type { PilotIntent } from '../autopilot';
import { ENEMIES } from '../../data/enemies';
import {
  createRaid,
  raidHeadDamage,
  stepRaid,
  raidPilot,
  raidScale,
  raidTuning,
  HEAD_X,
  HEAD_Z,
  type RaidState,
  type RaidIntent,
} from '../raid/encounter';
import { RaidView } from '../raid/arena';
import { RaidHud, raidReward } from '../raid/ui';
import { t } from '../../i18n';

interface RaidRuntime {
  state: RaidState | null;
  proxies: Enemy[];
  view?: RaidView;
  hud?: RaidHud;
  intent: RaidIntent;
  event: number;
  end: number;
  damage: number[];
  rewarded: boolean;
}
const states = new WeakMap<Game, RaidRuntime>();
export function raidRuntime(g: Game): RaidRuntime {
  let r = states.get(g);
  if (!r) {
    r = {
      state: null,
      proxies: [],
      intent: { x: 0, z: 0, head: -1, parry: false },
      event: -1,
      end: 0,
      damage: Array(8).fill(0),
      rewarded: false,
    };
    states.set(g, r);
  }
  return r;
}
export function resetRaid(this: Game): void {
  const r = raidRuntime(this);
  r.state = null;
  r.proxies.length = 0;
  r.end = 0;
  r.event = -1;
  r.rewarded = false;
  r.damage.fill(0);
  r.view?.render(null, false);
}
export function startRaid(this: Game): void {
  if (this.runMode !== 'raid' || this.role === 'client') return;
  const r = raidRuntime(this);
  r.state = createRaid(this.heroes.filter((h) => !h.left).length, this.difficulty.enemyHp);
  this.preShop = false;
  this.toys.objective.state = 'failed';
  this.enemies.clear();
  this.bullets.clear();
  this.director.bossSpawned = false;
  this.modes.rhythm = this.modes.pacifist = this.modes.holster = false;
  for (let i = 0; i < 3; i++)
    r.proxies.push(this.enemies.spawn(ENEMIES[`hydra_${i}`], HEAD_X[i], HEAD_Z));
  for (const h of this.heroes) {
    h.player.teleport((h.index - 1.5) * 3, 10);
    h.player.invuln = 3;
  }
  this.vfx.banner(t('raid.title'), t('raid.intro'), 5);
  this.vfx.sound('v:b:hydra:intro', NaN, NaN);
  this.vfx.sound('raid_horn', NaN, NaN);
  this.vfx.sound('vo_raid', NaN, NaN);
  this.vfx.portrait('announcer', 'happy', t('raid.intro'), 5);
}
/** Called after normal stats/crit calculation, before the ordinary enemy HP/death path. */
export function damageRaid(
  this: Game,
  e: Enemy,
  amount: number,
  o: DamageOpts,
  by: Hero,
): number | null {
  if (!e.def.id.startsWith('hydra_')) return null;
  const s = raidRuntime(this).state;
  if (!s || this.role === 'client') return 0;
  const i = Number(e.def.id.slice(-1));
  const dealt = raidHeadDamage(
    s,
    i,
    o.fixed ? Math.min(amount, s.heads[i].max * 0.02) : amount * raidTuning.weaponDamage,
    (o.tags ?? by.tagsOf(o.source) ?? []).includes('fire'),
  );
  if (dealt > 0) {
    by.damageBy[o.source] = (by.damageBy[o.source] ?? 0) + dealt;
    e.flash = 0.07;
    if (o.loud) this.vfx.num(e.x, 2, e.z, Math.round(dealt), 'hit', by.index);
  }
  return dealt;
}
export function updateRaid(this: Game, dt: number): void {
  const r = raidRuntime(this),
    s = r.state;
  if (this.runMode !== 'raid' || !s || this.role === 'client' || this.mode !== 'fight') return;
  if (isOver(s)) {
    r.end += dt;
    if (r.end >= 5) {
      this.mode = 'dead';
      this.gameOverShown = true;
      this.endRun();
    }
    return;
  }
  let humans = 0;
  for (const h of this.heroes) if (!h.left) humans++;
  if (humans !== s.players) {
    const scale = raidScale(Math.max(4, humans)),
      ratio = scale / s.scale;
    for (const head of s.heads) {
      head.hp *= ratio;
      head.max *= ratio;
    }
    s.core *= ratio;
    s.scale = scale;
    s.players = humans;
  }
  for (let i = 0; i < 8; i++) {
    const a = s.actors[i],
      h = this.heroes[i];
    if (h && !h.left) {
      a.ghost = false;
      a.alive = !h.player.dead;
      a.x = h.player.x;
      a.z = h.player.z;
      a.parry = h.skill.parryT > 0;
    } else {
      a.ghost = i < 4 && humans < 4;
      a.alive = a.ghost;
      if (a.ghost) {
        raidPilot(s, a, r.intent);
        const dx = r.intent.x - a.x,
          dz = r.intent.z - a.z,
          d = Math.hypot(dx, dz),
          step = Math.min(d, raidTuning.ghostSpeed * dt);
        if (d > 0.05) {
          a.x += (dx / d) * step;
          a.z += (dz / d) * step;
        }
        a.parry = r.intent.parry;
        if (r.intent.head >= 0 && Math.hypot(a.x - HEAD_X[r.intent.head], a.z - HEAD_Z) < 18)
          raidHeadDamage(s, r.intent.head, raidTuning.ghostDps * dt);
      }
    }
  }
  for (let i = 0; i < r.proxies.length; i++) {
    const e = r.proxies[i];
    e.x = e.px = HEAD_X[i];
    e.z = e.pz = HEAD_Z;
    e.hp = e.maxHp = s.heads[i].max; // Real boss health for hit/ultimate scaling; lane owns the damage bank.
  }
  stepRaid(s, dt);
  this.director.time = s.time;
  for (const h of this.heroes) {
    const a = s.actors[h.index];
    if (!a || a.ghost || !a.alive) continue;
    // Accumulate continuous cone damage into readable hits rather than losing it to i-frames every step.
    r.damage[h.index] += a.hit * this.difficulty.enemyDmg;
    if (r.damage[h.index] >= 9) {
      this.hurtHero(h, r.damage[h.index], -8, HEAD_Z, null, t('raid.title'));
      r.damage[h.index] = 0;
    }
  }
  if (s.event !== r.event) {
    r.event = s.event;
    const kind = s.eventKind;
    if (kind === 'fire' || kind === 'volley') {
      this.vfx.sound('telegraph', NaN, NaN);
      this.vfx.sound('raid_alarm', NaN, NaN);
    }
    if (kind === 'parry') {
      this.vfx.ring(8, HEAD_Z, 1, 4, '#73eff7', 0.5);
      this.vfx.sound('parry', 8, HEAD_Z);
    }
    if (kind === 'cut' || kind === 'seal' || kind === 'regrow')
      this.vfx.toast(t(`raid.${kind}`), 3);
    if (kind === 'enrage') {
      this.vfx.banner(t('raid.enraged'), '', 3);
      this.vfx.sound('raid_alarm', NaN, NaN);
    }
    if (kind === 'core' || kind === 'overdrive') {
      this.vfx.banner(t('raid.title'), t(`raid.${kind}`), 4);
      this.vfx.sound('v:b:hydra:phase', NaN, NaN);
    }
    if (kind === 'cannon') {
      this.vfx.ring(0, -10, 2, 10, '#a7f070', 0.6);
      this.vfx.sound('explode', 0, -10);
    }
  }
  if (s.phase === 'won') {
    this.score = Math.max(1, Math.round((raidTuning.wipe - s.time) * 5));
    this.victories++;
    this.bossesRun++;
    for (const e of r.proxies) this.enemies.kill(e);
    this.vfx.banner(t('raid.won'), t('raid.reward'), 5);
    this.vfx.sound('v:b:hydra:defeat', NaN, NaN);
    this.vfx.finisher('hydra', this.hero.index, 0, -10);
    this.vfx.portrait(`hero:${this.hero.index}`, 'happy', t('raid.won'), 5);
    this.vfx.burst(0, 4, -10, {
      count: 70,
      color: '#ffcd75',
      color2: '#73eff7',
      speed: [4, 12],
      size: [0.2, 0.5],
      life: [0.5, 1.5],
      up: 6,
      gravity: 8,
    });
    this.vfx.shake(0, -10, 0.5);
    rewardRaid(this);
    this.host?.broadcast({
      t: 'raidwin',
      time: s.time,
      players: s.players,
      difficulty: this.difficulty.id,
      score: this.score,
    });
  } else if (s.phase === 'lost') {
    this.score = 0;
    this.vfx.banner(t('raid.lost'), '', 4);
  }
}
function rewardRaid(g: Game): void {
  const r = raidRuntime(g),
    s = r.state;
  if (!s || r.rewarded) return;
  r.rewarded = true;
  raidReward(s.time, s.players, g.difficulty.id, g.score);
}
export function raidClientMessage(this: Game, m: Record<string, unknown>): boolean {
  if (m.t !== 'raidwin') return false;
  const r = raidRuntime(this);
  if (this.runMode === 'raid' && r.state) {
    r.state.phase = 'won';
    r.state.time = Number(m.time);
    r.state.players = Number(m.players);
    this.score = Number(m.score);
    rewardRaid(this);
  }
  return true;
}
export function raidNet(this: Game): RaidState | null {
  return this.runMode === 'raid' ? raidRuntime(this).state : null;
}
export function applyRaidNet(this: Game, raw: unknown): void {
  if (!raw || typeof raw !== 'object') {
    if (this.runMode !== 'raid') raidRuntime(this).state = null;
    return;
  }
  const s = raw as RaidState;
  if (
    !Array.isArray(s.heads) ||
    s.heads.length !== 3 ||
    !Array.isArray(s.actors) ||
    s.actors.length !== 8 ||
    !Array.isArray(s.orbs) ||
    s.orbs.length !== 24
  )
    return;
  this.runMode = 'raid';
  raidRuntime(this).state = s;
}
export function renderRaid(this: Game): void {
  const r = raidRuntime(this);
  if (this.runMode === 'raid' && r.state) r.view ??= new RaidView(this.scene);
  r.view?.render(r.state, this.runMode === 'raid' && this.mode !== 'title' && this.mode !== 'dead');
  r.hud ??= new RaidHud(this);
  r.hud.render(
    this.runMode === 'raid' && this.mode !== 'title' && this.mode !== 'dead' ? r.state : null,
  );
}
/** No hidden bot damage: the dev bot uses real weapons, movement and the normal parry action. */
export function pilotRaid(g: Game, o: PilotIntent): void {
  const r = raidRuntime(g),
    s = r.state;
  if (g.runMode !== 'raid' || !s) return;
  const a = s.actors[g.hero.index];
  if (!a) return;
  raidPilot(s, a, r.intent);
  o.mx = r.intent.x - g.player.x;
  o.mz = r.intent.z - g.player.z;
  if (Math.hypot(o.mx, o.mz) < 0.3) o.mx = o.mz = 0;
  o.target =
    r.intent.head >= 0
      ? (r.proxies[r.intent.head] ?? { x: HEAD_X[r.intent.head], z: HEAD_Z })
      : null;
  o.parry = r.intent.parry;
  o.dash = false;
  o.special = g.hero.bombCharge >= 1 && r.intent.head >= 0;
  o.ult = g.hero.skill.ult >= 1;
}

function isOver(s: RaidState): boolean {
  return s.phase === 'won' || s.phase === 'lost';
}

/** Keep the colossal engine and all role stations in the same readable frame. */
export function raidCamera(g: Game): void {
  if (g.runMode !== 'raid' || g.mode === 'title' || g.mode === 'dead') return;
  g.cam.auto = 1;
  g.cam.cine = 0;
  g.cam.frameTeam(-g.playerPos.x, -g.playerPos.z + 2.5, 2.2);
  g.lead.set(0, 0, 0);
}
