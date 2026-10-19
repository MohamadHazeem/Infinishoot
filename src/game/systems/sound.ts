/** Local cosmetics only: works with authoritative state and mirrored client snapshots. */
import type { Game } from '../game';
import { sfx } from '../../audio/sfx';
import { ambience } from '../../audio/ambienceAudio';
import { announcer } from '../../audio/announcer';
import { biomeAudio, comboLine, groundAudio, soundTuning } from '../../audio/mix';

interface AudioState {
  mode: string;
  started: boolean;
  steps: number;
  combo: number;
  scan: number;
  pass: number;
  goUntil: number;
  strikes: number;
}
const states = new WeakMap<Game, AudioState>();
export function updateSound(this: Game, dt: number, frozen: boolean): void {
  let state = states.get(this);
  if (!state) {
    state = { mode: 'title', started: false, steps: 0, combo: 0, scan: 0, pass: 0, goUntil: 0, strikes: 0 };
    states.set(this, state);
  }
  const mode = this.mode;
  const active = mode !== 'title' && mode !== 'dead';
  const fighting = this.isCombatMode && !this.paused && !frozen;
  const biome = biomeAudio(this.arenaStage);
  sfx.crowd = this.enemies.activeCount;
  ambience.update(biome, active, !fighting);
  // Rain bed and thunder follow the weather (worked out locally on every machine).
  ambience.setRain(active ? this.ambience.rain : 0);
  if (this.ambience.strikes !== state.strikes) {
    if (active && this.ambience.strikes > state.strikes) sfx.thunder(this.ambience.strikeDist);
    state.strikes = this.ambience.strikes;
  }
  announcer.update();
  if (
    mode === 'title' ||
    (state.mode === 'dead' && mode !== 'dead') ||
    (this.preShop && state.started)
  ) {
    if (state.started) announcer.reset();
    state.started = false;
    state.combo = state.steps = state.goUntil = 0;
  }
  if (fighting && !state.started) {
    state.started = true;
    state.goUntil = 4; // Brief grace if the user gesture is also the run-start click.
  }
  if (state.goUntil > 0) {
    state.goUntil -= dt;
    if (announcer.say('go')) state.goUntil = 0;
  }
  if (mode !== state.mode) {
    if (mode === 'dead') announcer.say('game_over');
    if (mode === 'cleared') announcer.say('stage_clear');
    state.mode = mode;
  }
  if (fighting) {
    const tier = this.combo >= 150 ? 3 : this.combo >= 100 ? 2 : this.combo >= 50 ? 1 : 0;
    if (tier > state.combo) {
      const line = comboLine(this.combo);
      if (line) announcer.say(line);
    }
    state.combo = tier;
  }
  const p = this.hero.player;
  if (!fighting || p.dead) {
    state.steps = 0;
    return;
  }
  if (!p.dashing && p.speed > 0.8) {
    state.steps += Math.min(dt, 0.05) * p.speed;
    if (state.steps >= soundTuning.stepStride) {
      state.steps %= soundTuning.stepStride;
      sfx.footstep(p.ground.pushX || p.ground.pushZ ? 'metal' : groundAudio(biome));
    }
  } else state.steps = 0;
  // Round-robin at most 32 slots/frame and one whoosh/0.4 s. No per-projectile objects.
  state.pass -= dt;
  const b = this.bullets;
  if (state.pass > 0 || b.count === 0) return;
  for (let n = 0, count = Math.min(32, b.count); n < count; n++) {
    const i = state.scan++ % b.count;
    if (b.width[i] < 0.7 && b.radius[i] < 0.34) continue;
    const dx = b.x[i] - p.x,
      dz = b.z[i] - p.z;
    const distance = dx * dx + dz * dz;
    const approach = dx * b.vx[i] + dz * b.vz[i];
    if (distance > 0.8 && distance < 9 && approach < -2 && b.vx[i] ** 2 + b.vz[i] ** 2 > 64) {
      sfx.whoosh(dx / 3);
      state.pass = 0.4;
      break;
    }
  }
}
