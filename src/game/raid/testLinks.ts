import type { Game } from '../game';
import { raidRuntime } from '../systems/raid';
import { raidTuning } from './encounter';
export function raidTestLink(g: Game, q: URLSearchParams): void {
  const s = raidRuntime(g).state;
  if (!s) return;
  if (q.get('raidphase') === 'core') {
    s.phase = 'core';
    for (const h of s.heads) h.sealed = true;
  }
  if (q.get('raidphase') === 'overdrive') {
    s.phase = 'overdrive';
    s.time = 600;
  }
  if (q.has('raidstump')) {
    s.heads[0].hp = 0;
    s.heads[0].stump = raidTuning.stumpSeconds;
  }
  if (q.has('raidregrow')) {
    s.heads[0].copies = 2;
    s.regrows = 1;
  }
  if (q.has('raidfire')) {
    s.fireClock = 5;
    s.fireX = 0.7;
    s.fireZ = 0.714;
    s.fireMode = 1;
  }
  g.player.teleport(0, 8);
}
