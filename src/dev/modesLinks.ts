import type { Game } from '../game/game';
import { modesForce } from '../game/systems/modes';
import { MINI_GAMES, type MiniKind } from '../game/modes/minigames';
import { GhostEv, GhostRecorder, type Ghost } from '../game/modes/ghost';
import { ghostStore } from '../game/modes/ghostStore';
import { routeChoices, routeLayer } from '../game/route';
import { LOOP_STAGES } from '../game/game';

/**
 * Modes lane test links (called from src/dev/testLinks.ts):
 *   &rhythm / &rhythmoff        this stage is (isn't) a rhythm stage. Also &node=rhythm (the route node).
 *   &pacifist                   this stage is the Pacifist road (same as &node=pacifist); &pact=<s> jumps its clock
 *   &node=arcade&route          the route map with the Bonus Arcade road on offer (route lane's link)
 *   &minigame=gallery|coins|whack   a bonus mini-game right now; &mgt=<s> jumps into its play time
 *   &ghost=demo                 race a made-up rival ghost (runs circles, scores steadily); &ghostlead=<s> moves it
 *                               ahead (+) or behind (-) in time. Works in any mode; add &mode=weekly for the real thing.
 *   &secretroute                the route map now, on a run seed whose next roads include the hidden ??? road
 *                               (with &arcade and/or &rhythm in the name: one that also offers those roads)
 *   &cursor=<x>,<y>             park the mouse at that fraction of the screen (screenshots of the crosshair beat frame)
 *   &modescreen=ghosts          open EXTRAS > GHOST RACE
 * Examples: ?test&god&rhythm&spawn=bopper:10,blaster:4&spawnr=8   ?test&god&stage=2&pacifist&pact=40
 *           ?test&god&minigame=gallery&mgt=6   ?test&god&ghost=demo&ghostlead=3
 */
export function modesLinks(game: Game, q: URLSearchParams): void {
  const node = q.get('node');
  if (node === 'rhythm' || node === 'pacifist' || node === 'arcade') game.modes.stage = 0; // re-decide the stage on the next step
  if (q.has('rhythm')) modesForce.rhythm = true;
  if (q.has('rhythmoff')) modesForce.rhythm = false;
  if (q.has('rhythm') || q.has('rhythmoff')) game.modes.stage = 0;
  if (q.has('pacifist')) {
    game.route.force = 'pacifist';
    game.modes.stage = 0;
  }
  const pact = Number(q.get('pact'));
  if (pact > 0) game.director.time = Math.max(game.director.time, pact);
  const mg = q.get('minigame') as MiniKind | null;
  if (mg && MINI_GAMES[mg]) {
    game.startMiniGame(mg);
    const jump = Number(q.get('mgt'));
    if (jump > 0 && game.modes.mg) {
      // Skip the countdown and run the game that many seconds (deterministic, no rendering).
      const steps = Math.round((2.6 + jump) * 60);
      for (let i = 0; i < steps && game.modes.mg; i++) game.update(1 / 60);
    }
  }
  if (q.get('ghost') === 'demo') {
    modesForce.ghostAnyMode = true;
    const week = game.meta.week || 'test';
    ghostStore.setRival(demoGhost(week, Number(q.get('ghostlead')) || 0, game.hero.player.x, game.hero.player.z));
    game.modes.stage = 0;
  }
  if (q.has('secretroute')) {
    const st = game.stage;
    const want = (q.get('secretroute') ?? '').split(',').filter(Boolean);
    for (let seed = 1; seed < 20000; seed++) {
      const kinds = routeChoices(seed, st, game.route.path[st] ?? 0, LOOP_STAGES).map((i) => routeLayer(seed, st + 1, LOOP_STAGES).nodes[i].kind);
      if (!kinds.includes('pacifist') || !want.every((k) => kinds.includes(k as never))) continue;
      game.seed = seed;
      game.route.on = true;
      game.route.open = false;
      game.mode = 'shop';
      game.openRoute();
      break;
    }
  }
  const cur = (q.get('cursor') ?? '').split(',').map(Number);
  if (cur.length === 2 && cur.every((v) => v >= 0 && v <= 1)) {
    (game.input as unknown as { setMouse(x: number, y: number): void }).setMouse(cur[0] * innerWidth, cur[1] * innerHeight);
  }
  if (q.get('modescreen') === 'ghosts') {
    game.render(1, 0); // the screen is built on the first frame
    game.modes.screen?.open();
  }
}

/** A made-up rival: circles near the start, about 45 points a second, `lead` seconds ahead. */
export function demoGhost(week: string, lead: number, x0: number, z0: number): Ghost {
  const rec = new GhostRecorder(week, 'Rival', 'ace');
  rec.event(0, GhostEv.StageStart, 1);
  for (let t = 0; t <= 600; t += 0.1) {
    const k = t + lead;
    const a = k * 0.45;
    rec.step(t, x0 + 3 + Math.cos(a) * 6, z0 + Math.sin(a) * 6, a + Math.PI / 2, Math.max(0, k) * 45, 1);
  }
  return rec.finish(600 * 45, 1, 600);
}
