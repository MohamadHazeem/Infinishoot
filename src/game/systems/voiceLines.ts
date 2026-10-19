/**
 * Local voice lines: the shared voice channel's clock and queue, and the local
 * hero's barks. Runs in render() on every machine from state clients mirror too,
 * so co-op players only ever hear their own hero. Boss lines arrive on the effects
 * bus instead (src/audio/voices.ts `bossVoiceCue`).
 */
import type { Game } from '../game';
import { BarkBrain, heroBark, resetVoices, updateVoices, type BarkInput } from '../../audio/voices';

interface VoiceState {
  brain: BarkBrain;
  mode: string;
  started: boolean;
  input: BarkInput;
}
const states = new WeakMap<Game, VoiceState>();

export function updateVoiceLines(this: Game, frozen: boolean): void {
  let s = states.get(this);
  if (!s) {
    s = {
      brain: new BarkBrain(),
      mode: 'title',
      started: false,
      input: { now: 0, fighting: false, hp01: 1, dead: false, level: 1, kills: 0, evolved: 0, boss: false, cleared: false, heroes: 1 },
    };
    states.set(this, s);
  }
  updateVoices();
  const mode = this.mode;
  // New run, quit to title, or the starting shop: silence and start over.
  if (mode === 'title' || (s.mode === 'dead' && mode !== 'dead') || (this.preShop && s.started)) {
    if (s.started) resetVoices();
    s.brain.reset();
    s.started = false;
  }
  s.mode = mode;
  const fighting = this.isCombatMode && !this.paused && !frozen;
  if (fighting) s.started = true;
  if (!s.started) return;
  const h = this.hero;
  const p = h.player;
  let evolved = 0;
  for (const w of h.weapons) if (w.evolved) evolved++;
  if (h.specialBuild && h.specialBuild.evo >= 0) evolved++;
  const boss = this.role === 'client' ? !!this.netBoss : !!(this.boss && this.boss.active && this.boss.def.boss);
  const i = s.input;
  i.now = performance.now() / 1000;
  i.fighting = fighting;
  i.hp01 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  i.dead = p.dead;
  i.level = this.level;
  i.kills = this.kills;
  i.evolved = evolved;
  i.boss = boss;
  i.cleared = mode === 'cleared';
  i.heroes = this.heroes.length;
  const call = s.brain.step(i, Math.random);
  if (call) heroBark(h.heroDef.id, call.kind, call.delay, call.wait);
}
