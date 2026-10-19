import type { Game } from '../game/game';
import { isCoopKind, type BanterLine, BANTER_LINES, banterCue } from '../game/coopplay';
import { coopPlayState, forceCoopObjective, toggleCarry } from '../game/systems/coopplay';
import { settings, applySettings } from '../game/settings';

/**
 * Test-link options for the coopplay lane (called from applyTestLink after the
 * companion lane's `mate`, a standing dummy teammate). Times are seconds of play:
 * - `coopobj=door|escort|zones|bomb`: this stage's objective is that co-op objective
 *   (needs `mate` or `heroes=2+`; later stages keep rolling it)
 * - `cpme=a|b|v|bomb|core` and `cpmate=a|b|v|bomb|core`: put your hero / the dummy on a piece
 *   (a/b: switch or zone A/B, or the core and its beacon; v: the vault or bunker)
 * - `cpcore=<pct>`: escort: the core starts that far along its road
 * - `cpopen`: door: opens at once when both switches are held (screenshots)
 * - `cpbomb`: bomb: you hold the bomb; `cpboss`: and the stage boss is up (`nointro`)
 * - `carry=<s>`: the dummy goes down after s seconds and you pick it up (`carry` alone: at once)
 * - `tether=<s>`: the dummy stands 4 m away with a link already s seconds old
 * - `banter=<line>|cycle`: the dummy calls a banter line every 3 s (nicesave, behind, thanks, groupup, onmyway, greatshot)
 * - `notether`: BUDDY TETHER off (the visual only)
 */
export function coopplayLinks(game: Game, q: URLSearchParams): void {
  const s = coopPlayState(game);
  const later = (sec: number, fn: () => void) => {
    const t0 = game.runTime;
    const id = setInterval(() => {
      if (game.runTime - t0 < sec) return;
      clearInterval(id);
      fn();
    }, 16);
  };
  if (q.has('notether')) {
    settings.tetherVisual = false;
    applySettings();
  }
  const kind = q.get('coopobj');
  if (kind && isCoopKind(kind) && game.heroes.length > 1) {
    forceCoopObjective(game, kind);
    const L = s.lay;
    const spot = (k: string | null): { x: number; z: number } | null => {
      if (!L || !k) return null;
      if (k === 'a') return L.a;
      if (k === 'b') return L.b;
      if (k === 'v') return { x: L.v.x, z: L.v.z + 2.4 };
      if (k === 'bomb') return { x: s.bomb.x + 0.6, z: s.bomb.z };
      if (k === 'core') return { x: s.core.x + 2, z: s.core.z + 1 };
      return null;
    };
    const pct = Number(q.get('cpcore'));
    if (L && kind === 'escort' && pct > 0) {
      s.core.x = s.core.rx = L.a.x + (L.b.x - L.a.x) * Math.min(0.95, pct / 100);
      s.core.z = s.core.rz = L.a.z + (L.b.z - L.a.z) * Math.min(0.95, pct / 100);
    }
    const me = spot(q.get('cpme'));
    if (me) game.hero.player.teleport(me.x, me.z);
    const mate = spot(q.get('cpmate'));
    if (mate && game.heroes[1]) game.heroes[1].player.teleport(mate.x, mate.z);
    if (q.has('cpopen') && kind === 'door') s.hold = 99; // opens on the first step with both switches held
    if (q.has('cpbomb') && kind === 'bomb') {
      game.hero.player.teleport(s.bomb.x, s.bomb.z);
      if (q.has('cpboss')) game.debugSkipToBoss();
    }
  }
  const tether = Number(q.get('tether'));
  const mate = game.heroes[1];
  if (tether > 0 && mate) {
    mate.player.teleport(game.hero.player.x + 4, game.hero.player.z + 0.6);
    s.link[0] = s.link[1] = tether;
  }
  const carry = q.get('carry');
  if (carry !== null && mate) {
    const go = () => {
      mate.revivesLeft = 0;
      mate.petState.reviveUsed = true;
      mate.player.invuln = 0;
      if (!mate.player.dead && mate.player.hurt(mate.player.hp + 1, 1, 0)) game.onHeroDown(mate);
      game.hero.player.teleport(mate.player.x + 1, mate.player.z);
    };
    const sec = Number(carry);
    if (sec > 0) later(sec, () => (go(), later(0.6, () => toggleCarry(game, s, game.hero))));
    else {
      go();
      toggleCarry(game, s, game.hero); // carry (no value): picked up at once
    }
  }
  const ban = q.get('banter');
  if (ban && mate) {
    let k = 0;
    setInterval(() => {
      const line: BanterLine = ban === 'cycle' ? BANTER_LINES[k++ % BANTER_LINES.length] : (ban as BanterLine);
      if (BANTER_LINES.includes(line)) game.vfx.sound(banterCue(mate.heroDef.id, line), NaN, NaN);
    }, 3000);
  }
}
