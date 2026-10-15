/** Stage events, side challenges and combo power-ups (src/game/runEvents.ts). */
import { ok } from './check';
import { RunEvents } from '../src/game/runEvents';
import { Rng } from '../src/core/rng';
const log: string[] = [];
let gold = 0, score = 0, meteors = 0, elites = 0, rings = 0;
const host = { rng: new Rng(3), stage: 1, dmgMul: 1, targets: () => [{ x: 0, z: 0 }], ownedWeapons: () => ['buster', 'fire'],
  meteor: () => meteors++, spawnElite: () => elites++, spawnRing: () => rings++, vacuum: () => log.push('vacuum'),
  banner: (t: string) => log.push('banner ' + t), toast: (t: string) => log.push('toast ' + t), sound: () => {}, reward: (g: number, s: number) => { gold += g; score += s; } };
let allGood = true;
for (let seed = 1; seed < 40; seed++) {
  host.rng = new Rng(seed);
  const r = new RunEvents(host as any);
  r.reset(); r.startStage(240);
  let sawEvent = false;
  for (let t = 0; t < 240; t += 1 / 60) { r.update(1 / 60, t, false); if (r.event) sawEvent = true; }
  if (!sawEvent || !r.challenge) { allGood = false; console.log('seed', seed, 'event', sawEvent, 'challenge', r.challenge); }
}
const r = new RunEvents(host as any);
r.startStage(240);
for (let c = 1; c <= 760; c++) r.onKill('buster', c);
ok(r.frenzyT > 0 && r.fireRateMul === 0.6, 'FRENZY active after 100 combo');
ok(r.overdriveT > 0 && r.damageMul === 2, 'OVERDRIVE active after 500 combo');
ok(log.filter((l) => /FRENZY|MAGNET|OVERDRIVE/.test(l)).length === 4, 'one banner per power-up (100, 250, 500, 750)');
ok(allGood, 'every stage gets an event and a challenge');
ok(meteors + elites + rings > 0 && gold > 0, 'events act and challenges pay out');
void score;
