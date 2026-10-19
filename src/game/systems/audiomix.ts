/** Render-side audio state: local hero and existing co-op snapshots are sufficient. */
import type { Game } from '../game';
import { LowHealthState } from '../../audio/lowHealth';
import { audioSettings, sfx } from '../../audio/sfx';
import { music } from '../../audio/music';

const states = new WeakMap<Game, { health: LowHealthState; player: object; seed: number }>();
const EMPTY_WEAPONS = [] as const;
export function updateAudioMix(this: Game, dt: number, active: boolean): void {
  const hero = this.hero;
  const p = hero.player;
  let state = states.get(this);
  if (!state) {
    state = { health: new LowHealthState(), player: p, seed: this.seed };
    states.set(this, state);
  }
  if (state.player !== p || state.seed !== this.seed) {
    state.health.reset();
    state.player = p;
    state.seed = this.seed;
  }
  music.setWeapons(this.mode !== 'title' && !p.dead ? hero.weapons : EMPTY_WEAPONS);
  sfx.listener(p.x, p.z, p.aim.x, p.aim.z);
  state.health.update(dt, p.hp, p.maxHp, active && !p.dead && audioSettings.lowHealth);
  sfx.setLowHealth(state.health.pressure);
  if (state.health.beat) sfx.heartbeat();
  if (state.health.ring) sfx.tinnitus();
}
