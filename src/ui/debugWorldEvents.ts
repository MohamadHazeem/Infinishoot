import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { startWorldEvent, worldEventForce } from '../game/systems/worldEvents';
import { WORLD_EVENT_KINDS, worldEventTuning, type WorldEventKind } from '../game/worldEvents';

/** Debug panel folder for the world-events lane: start any event now, force one per stage, main knobs. */
export function addWorldEventsFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('World events').close();
  const T = worldEventTuning;
  f.add(T, 'enabled').name('Mid-stage events');
  f.add(T, 'chance', 0, 1, 0.05).name('Chance per stage');
  f.add(T, 'stealthNight', 0, 1, 0.05).name('Night Raid chance (night)');
  const pick = { force: worldEventForce.kind ?? 'rolled' };
  f.add(pick, 'force', ['rolled', ...WORLD_EVENT_KINDS])
    .name('Force (next stages)')
    .onChange((v: string) => (worldEventForce.kind = v === 'rolled' ? null : (v as WorldEventKind)));
  for (const k of WORLD_EVENT_KINDS) f.add({ go: () => game.role !== 'client' && game.isCombatMode && startWorldEvent(game, k) }, 'go').name(`Start ${k} now`);
  f.add(T, 'crackTime', 1, 8, 0.1).name('Collapse warning (s)');
  f.add(T, 'collapseHeroDmg', 0, 40, 1).name('Collapse hero damage');
  f.add(T, 'floodHeroSlow', 0.3, 1, 0.05).name('Hero speed in water');
  f.add(T, 'floodEnemySlow', 0, 0.9, 0.05).name('Enemy slow in water');
  f.add(T, 'giantStepT', 0.8, 3, 0.1).name('Colossus step (s)');
  f.add(T, 'giantWarn', 0.5, 2.5, 0.05).name('Footprint warning (s)');
  f.add(T, 'giantHeroDmg', 0, 60, 1).name('Stomp hero damage');
  f.add(T, 'eclipseDark', 5, 60, 1).name('Eclipse length (s)');
  f.add(T, 'eclipseSpeed', 0, 0.5, 0.01).name('Eclipse enemy speed');
  f.add(T, 'flowerHeal', 0, 0.15, 0.005).name('Flower heal (/s)');
  f.add(T, 'bombEvery', 0.2, 2, 0.05).name('Lava bomb every (s)');
  f.add(T, 'bombHeroDmg', 0, 40, 1).name('Lava bomb damage');
  f.add(T, 'litSight', 4, 25, 0.5).name('Stealth: sight lit (m)');
  f.add(T, 'darkSight', 1, 8, 0.1).name('Stealth: sight dark (m)');
  f.add(T, 'noiseFire', 0, 25, 0.5).name('Stealth: firing noise (m)');
  f.add(T, 'notice', 0.2, 5, 0.1).name('Stealth: notice speed');
  f.add(T, 'alertTime', 2, 30, 0.5).name('Stealth: alert time (s)');
}
