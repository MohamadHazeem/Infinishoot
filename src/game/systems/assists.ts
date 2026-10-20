/** Local-only casual controls. No settings or assisted simulation cross the network. */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Input } from '../../core/input';
import type { Enemy } from '../enemies';
import { segmentHitsBox } from '../enemies';
import { settings, saveSettings, type Settings } from '../settings';
import { playerTuning } from '../player';
import { Team } from '../bullets';
import { t } from '../../i18n';

export const assistTuning = { aimRange: 24, damage: 0.5, hurtIframes: 2, bulletSpeed: 0.65, magnet: 2, dashLimit: 3, dashWindow: 60, warningLead: 0.12, clickStop: 0.25 };
export const ASSIST_KEYS = ['assistDash', 'assistIframes', 'assistDamage', 'assistBullets', 'assistMagnet'] as const;

/** PvP preparation and races simulate as solo while keeping a network connection. */
export function assistsAllowed(g: Pick<Game, 'role' | 'pvp' | 'race' | 'host' | 'client'>): boolean {
  return g.role === 'solo' && !g.pvp && !g.race && !g.host && !g.client;
}
export function hasCasualOptions(s: Settings = settings): boolean {
  if (s.gameSpeed !== '100' || s.oneStick) return true;
  for (const key of ASSIST_KEYS) if (s[key]) return true;
  return false;
}
export function casualPreset(s: Settings = settings): void {
  s.gameSpeed = '85'; s.oneStick = true;
  s.assistDamage = true; s.assistMagnet = true;
  s.assistDash = false; s.assistIframes = false; s.assistBullets = false;
}
export function oneStickActive(g: Game): boolean { return assistsAllowed(g) && settings.oneStick; }
export function magnetScale(g: Game): number { return assistsAllowed(g) && settings.assistMagnet ? assistTuning.magnet : 1; }
export function assistDamage(g: Game, damage: number): number { return assistsAllowed(g) && settings.assistDamage ? damage * assistTuning.damage : damage; }
export function assistHurtFrames(g: Game, h: Hero): void {
  if (assistsAllowed(g) && settings.assistIframes) h.player.invuln = Math.max(h.player.invuln, playerTuning.hurtIframes * assistTuning.hurtIframes);
}

/** Rolling cap, not a refill burst at minute boundaries. Allocates only at hero creation. */
export class DashBudget {
  private used = new Float64Array(assistTuning.dashLimit).fill(-Infinity);
  take(now: number): boolean {
    for (let i = 0; i < this.used.length; i++) if (now - this.used[i] >= assistTuning.dashWindow) { this.used[i] = now; return true; }
    return false;
  }
}
interface HeroAssist { budget: DashBudget; clicked: boolean; x: number; z: number; mx: number; mz: number; changed: boolean; }
interface AssistState { assisted: boolean; clock: number; stage: number; heroes: Map<Hero, HeroAssist>; badge: HTMLElement | null; controls: HTMLElement[]; clickable: boolean; }
const states = new WeakMap<Game, AssistState>();
function state(g: Game): AssistState {
  let s = states.get(g);
  if (!s) { s = { assisted: false, clock: 0, stage: g.stage, heroes: new Map(), badge: null, controls: [], clickable: false }; states.set(g, s); }
  return s;
}
export function resetAssists(g: Game): void {
  const s = state(g); s.assisted = false; s.clock = 0; s.stage = g.stage; s.heroes.clear();
}
export function assistedRun(g: Game): boolean { return states.get(g)?.assisted ?? false; }

/** Runs before input consumers. Clock is monotonic simulation time, unaffected by rewind. */
export function assistStep(this: Game, dt: number): number {
  const s = state(this);
  const active = assistsAllowed(this) && this.isCombatMode && !this.paused && this.screens.current === 'none' && !this.photo?.active;
  for (const hero of this.heroes) {
    const help = s.heroes.get(hero);
    if (help && (!active || s.stage !== this.stage || hero.player.dead)) help.clicked = false;
  }
  s.stage = this.stage;
  const clickable = active && settings.oneStick && !this.hero.player.dead;
  if (s.clickable !== clickable) {
    s.clickable = clickable;
    for (const control of s.controls) {
      control.classList.toggle('casual-clickable', clickable);
      control.tabIndex = clickable ? 0 : -1;
      if (clickable) control.setAttribute('role', 'button'); else control.removeAttribute('role');
    }
  }
  if (active) {
    if (hasCasualOptions()) s.assisted = true;
    dt *= Number(settings.gameSpeed) / 100;
    s.clock += dt;
  }
  const hide = !s.assisted || !this.isCombatMode || this.screens.current !== 'none';
  if (s.badge && s.badge.hidden !== hide) s.badge.hidden = hide;
  return dt;
}

/** Best target = nearest living, targetable foe with a clear shot. No temporary arrays. */
export function casualTarget(g: Game, h: Hero): Enemy | null {
  const p = h.player;
  let best = assistTuning.aimRange ** 2, target: Enemy | null = null;
  for (const e of g.enemies.list) {
    if (!e.alive || e.def.hidden || e.state === 'spawning' || e.underground) continue;
    const dx = e.x - p.x, dz = e.z - p.z, d2 = dx * dx + dz * dz;
    if (d2 < 0.0001 || d2 >= best) continue;
    const d = Math.sqrt(d2);
    let blocked = false;
    for (const box of g.arena.colliders) if (segmentHitsBox(p.x, p.z, dx / d, dz / d, d, 0, box)) { blocked = true; break; }
    if (!blocked) { best = d2; target = e; }
  }
  return target;
}

/** A warning about to hit this hero. Store an escape vector in existing hero state. */
function warning(g: Game, h: Hero, s: HeroAssist): boolean {
  const p = h.player, lead = assistTuning.warningLead;
  for (const strike of g.strikes) {
    if (strike.dmg <= 0 || strike.t > lead || strike.t < 0) continue;
    const dx = p.x - strike.x, dz = p.z - strike.z;
    if (dx * dx + dz * dz < (strike.r + p.radius) ** 2) { s.x = dx; s.z = dz; return true; }
  }
  for (const e of g.enemies.list) {
    if (!e.alive || e.frozen > 0 || e.t > lead || e.t < 0) continue;
    // Landing warnings persist through the airborne attack; dodging at takeoff is too early.
    const landingRadius = e.def.leap ? e.def.leap.radius * e.scale : e.action === 'slam' ? 3.8 : 0;
    if (landingRadius) {
      const dx = p.x - e.targetX, dz = p.z - e.targetZ;
      if (e.state === 'attack' && dx * dx + dz * dz < (landingRadius + p.radius) ** 2) { s.x = dx; s.z = dz; return true; }
      continue;
    }
    if (e.state !== 'windup') continue;
    const dx = p.x - e.x, dz = p.z - e.z;
    if (e.def.fuse && dx * dx + dz * dz < (e.def.fuse.radius * e.scale + p.radius) ** 2) { s.x = dx; s.z = dz; return true; }
    const charge = e.def.behavior === 'charger' || e.action === 'charge' ? e.def.charge : undefined;
    const lunge = e.def.lunge;
    const len = charge ? charge.speed * charge.duration : lunge ? lunge.speed * lunge.duration : (e.action === 'charge' ? 13 : e.def.shoot?.pattern === 'sniper' ? 20 : 0);
    if (!len) continue;
    const along = dx * e.lungeX + dz * e.lungeZ;
    const across = dx * e.lungeZ - dz * e.lungeX;
    if (along >= 0 && along < len + p.radius && Math.abs(across) < e.radius + p.radius + 0.3) {
      const side = across < 0 ? -1 : 1;
      s.x = e.lungeZ * side; s.z = -e.lungeX * side; return true;
    }
  }
  return false;
}

export function assistInput(this: Game, h: Hero, input: Input, _dt: number): void {
  if (!assistsAllowed(this) || (!settings.oneStick && !settings.assistDash)) return;
  const run = state(this);
  let s = run.heroes.get(h);
  if (!s) { s = { budget: new DashBudget(), clicked: false, x: 0, z: 0, mx: 0, mz: 0, changed: false }; run.heroes.set(h, s); }
  s.mx = input.move.x; s.mz = input.move.y; s.changed = false;
  const p = h.player;
  if (settings.oneStick) {
    if (input.device === 'pad' || input.move.x || input.move.y) s.clicked = false;
    if (input.device === 'kbm' && input.mousePressed(0)) {
      const point = this.mouseAimPoint();
      if (point) { s.x = point.x; s.z = point.z; s.clicked = true; }
    }
    if (s.clicked) {
      const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz);
      if (d <= assistTuning.clickStop) s.clicked = false;
      else { const speed = Math.min(1, d / 1.2); input.move.x = dx / d * speed; input.move.y = dz / d * speed; s.changed = true; }
    }
    const target = casualTarget(this, h);
    if (target) p.setAimPoint(target.x, target.z);
  } else s.clicked = false;
  // Manual dash always wins and does not consume the assistance budget.
  if (!settings.assistDash || p.noDash || p.invuln > 0 || p.dashing || p.dashStock < 1 || input.actionPressed('dash') || input.padButtonPressed(4) || input.padButtonPressed(6) || input.padButtonPressed(0)) return;
  const clickX = s.x, clickZ = s.z;
  if (warning(this, h, s) && s.budget.take(run.clock)) {
    const len = Math.hypot(s.x, s.z);
    input.move.x = len > 0.001 ? s.x / len : -p.aim.x;
    input.move.y = len > 0.001 ? s.z / len : -p.aim.z;
    s.changed = true; input.pressAction('dash');
  }
  s.x = clickX; s.z = clickZ;
}

/** Fixed steps may run several times per Input.poll; never leave synthetic movement latched. */
export function restoreAssistInput(g: Game, h: Hero, input: Input): void {
  const s = states.get(g)?.heroes.get(h);
  if (s?.changed) { input.move.x = s.mx; input.move.y = s.mz; s.changed = false; }
}

/** After integration, before collision. Velocity and lifetime remain unchanged, including reflections. */
export function slowAssistBullets(g: Game): void {
  if (!assistsAllowed(g) || !settings.assistBullets) return;
  const b = g.bullets, k = assistTuning.bulletSpeed;
  for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy) {
    b.x[i] = b.px[i] + (b.x[i] - b.px[i]) * k;
    b.z[i] = b.pz[i] + (b.z[i] - b.pz[i]) * k;
  }
}

export function renderCasualPreset(el: HTMLElement): void {
  let card = el.querySelector<HTMLElement>('.casual-preset');
  if (!card) { card = document.createElement('div'); card.className = 'casual-preset'; el.querySelector('.mode-grid')?.before(card); }
  const on = settings.gameSpeed === '85' && settings.oneStick && settings.assistDamage && settings.assistMagnet && !settings.assistDash && !settings.assistIframes && !settings.assistBullets;
  card.innerHTML = `<button data-nav data-casual-preset class="${on ? 'on' : ''}">${t('casual.preset')}${on ? ' ✓' : ''}</button><small>${t('casual.presetDesc')} ${t('casual.presetScores')}</small>`;
}

export function installAssists(g: Game, root: HTMLElement): void {
  if (!document.getElementById('casual-css')) {
    const css = document.createElement('style'); css.id = 'casual-css';
    css.textContent = `.casual-preset{display:flex;align-items:center;gap:calc(5 * var(--p));max-width:900px;padding:calc(3 * var(--p))}.casual-preset small{font-size:18px;max-width:560px;color:var(--white)}.casual-preset button{--bg:var(--blue);--hi:var(--cyan);flex-shrink:0}.casual-preset button.on{--bg:var(--green);--hi:var(--lime)}.casual-badge{background:var(--ink);color:var(--lime);padding:calc(2 * var(--p)) calc(3 * var(--p));font:12px var(--label);white-space:nowrap}.casual-run-badge{position:absolute;inset-inline-end:calc(8 * var(--p));top:calc(66 * var(--p));pointer-events:none}.casual-run-badge[hidden]{display:none}.casual-clickable{pointer-events:auto;cursor:pointer}.casual-clickable:hover,.casual-clickable:focus-visible{outline:var(--p) solid var(--cyan)}#scr-history .casual-badge{color:var(--lime)}.casual-assists-heading{margin:calc(4 * var(--p)) 0;font-size:24px;color:var(--cyan)}.casual-assists-note{font-size:18px;margin:0 0 calc(4 * var(--p))}@media(max-width:700px){#scr-settings .settings-footer{flex-wrap:wrap;gap:calc(3 * var(--p))}#scr-settings .settings-footer button{flex:1 1 auto;white-space:nowrap}}@media(max-width:640px){.casual-preset{flex-direction:column;align-items:stretch}.casual-preset small{font-size:16px}}`;
    document.head.append(css);
  }
  const badge = document.createElement('span'); badge.className = 'casual-badge casual-run-badge'; badge.hidden = true; badge.textContent = t('casual.badge'); root.append(badge); state(g).badge = badge;
  // Existing meters become real mouse controls in one-stick mode; prompts still follow rebinds.
  for (const [id, action, label] of [['dashpip', 'dash', 'casual.clickDash'], ['bombpip', 'bomb', 'casual.clickSpecial']] as const) {
    const control = root.querySelector<HTMLElement>(`#${id}`);
    if (!control) continue;
    state(g).controls.push(control);
    control.dataset.casualLabel = label;
    control.addEventListener('click', () => {
      if (state(g).clickable && oneStickActive(g) && !g.paused && g.isCombatMode && g.screens.current === 'none' && !g.hero.player.dead) g.input.pressAction(action);
    });
    control.addEventListener('keydown', event => {
      if (state(g).clickable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); control.click(); }
    });
  }
  const before = g.screens.onShow;
  g.screens.onShow = name => {
    before?.(name); badge.textContent = t('casual.badge');
    for (const control of state(g).controls) control.setAttribute('aria-label', t(control.dataset.casualLabel!));
  };
  root.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('[data-casual-preset]')) return;
    casualPreset(); settings.mode = 'standard'; saveSettings();
    g.screens.show('modes'); g.hud.toast(t('casual.applied'), 4);
  });
}

/** Unsaved test-link preferences. */
export function casualLinks(q: URLSearchParams): void {
  if (q.has('casual')) casualPreset();
  if (q.has('onestick')) settings.oneStick = true;
  const speed = q.get('gamespeed');
  if (speed === '100' || speed === '85' || speed === '70') settings.gameSpeed = speed;
  if (q.has('assists')) {
    const ids = (q.get('assists') ?? '').split(',');
    ASSIST_KEYS.forEach((key, i) => settings[key] = ids.includes(['dash', 'iframes', 'damage', 'bullets', 'magnet'][i]));
  }
}
