/**
 * 8-player co-op (eightp lane): Game-side wiring of the rules in
 * src/game/eightp.ts. Everything here is either per-machine presentation
 * (camera framing, name-tag layout, render LOD and the teammate weapon mix,
 * fed every rendered frame) or host-side bookkeeping (the team ping budget,
 * snapshot interest for far heroes). Clients need no new snapshot fields:
 * the bigger roster already travels in `heroes`.
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { VfxEvent } from '../vfx';
import { SNAP_EVERY } from '../game';
import { settings } from '../settings';
import { lodState } from '../../render/lod';
import { teamWeaponMix } from '../../audio/mix';
import { declutterTags, eightpTuning, farHeroFresh, pickFrameMates, pingAllowed, type LayoutTag } from '../eightp';

const CSS = `
/* eightp lane: 5-8 heroes. Teammate rows on one line (name, then bar). */
#team.compact { gap: calc(1 * var(--p)); }
#team.compact .mate { display: flex; align-items: center; gap: calc(2 * var(--p)); font-size: 10px; line-height: 1; }
#team.compact .mate .nm { width: 70px; overflow: hidden; white-space: nowrap; }
#team.compact .mate .bar { width: 64px; height: calc(2 * var(--p)); margin-top: 0; }
#team.compact .mate.left { opacity: 0.3; }
/* Short tags over near, healthy teammates. */
#tags .tag.mini .nm { padding: 1px 3px; font-size: 8px; }
`;

let cssEl: HTMLStyleElement | null = null;
function ensureCss(): void {
  if (cssEl || typeof document === 'undefined') return;
  cssEl = document.createElement('style');
  cssEl.id = 'eightp-css';
  cssEl.textContent = CSS;
  document.head.appendChild(cssEl);
}

function activeCount(g: Game): number {
  let n = 0;
  for (const h of g.heroes) if (!h.left) n++;
  return n;
}

/** Every rendered frame: LOD focus and team size, the teammate weapon mix, lane CSS. */
export function eightpFrame(g: Game): void {
  ensureCss();
  const n = activeCount(g);
  lodState.x = g.playerPos.x;
  lodState.z = g.playerPos.z;
  lodState.heroes = n;
  teamWeaponMix.mates = Math.max(0, n - 1);
  teamWeaponMix.volume = Number.isFinite(settings.mateWeapons) ? Math.max(0, Math.min(1, settings.mateWeapons)) : 0.8;
}

const xs = new Float64Array(8);
const zs = new Float64Array(8);
const pick = new Int32Array(8);

/**
 * Co-op camera framing (systems/anim.ts cameraDirector): writes the teammates
 * to keep in view into `mates` (x, z pairs) and returns how many. CO-OP
 * CAMERA: ME frames nobody. Up to 4 heroes: every living teammate (as before);
 * 5-8: the nearest few within eightpTuning.frameRange, so one hero wandering
 * off doesn't zoom everyone out (they keep their edge arrow).
 */
export function frameMates(g: Game, watch: unknown, mates: Float64Array): number {
  if (settings.coopCamera === 'me') return 0;
  const me = g.hero;
  let c = 0;
  for (const h of g.heroes) {
    if (h === me || h.left || h.player.dead || h.player === watch || c >= 8) continue;
    const r = h.player.rig.root.position;
    xs[c] = r.x;
    zs[c] = r.z;
    c++;
  }
  if (g.heroes.length <= 4) {
    for (let i = 0; i < c && i < 4; i++) {
      mates[i * 2] = xs[i];
      mates[i * 2 + 1] = zs[i];
    }
    return Math.min(c, 4);
  }
  const n = pickFrameMates(g.playerPos.x, g.playerPos.z, xs, zs, c, pick);
  for (let i = 0; i < n; i++) {
    mates[i * 2] = xs[pick[i]];
    mates[i * 2 + 1] = zs[pick[i]];
  }
  return n;
}

/** Name tags (systems/render.ts renderTeam): short tags and stacking for 5-8 heroes. */
export function declutterTeamTags(g: Game, tags: LayoutTag[]): void {
  declutterTags(tags, activeCount(g), innerWidth, innerHeight);
}

const pingTimes = new WeakMap<Game, number[]>();

/** Host: may this ping go out? Teams of 5-8 share a budget (eightpTuning.pingBurst per pingWindow s). */
export function eightpPingOk(g: Game): boolean {
  let list = pingTimes.get(g);
  if (!list) pingTimes.set(g, (list = []));
  return pingAllowed(list, g.runTime, activeCount(g));
}

/** Last weapon list sent for each hero, per receiving client hero. */
const sentWeapons = new WeakMap<Hero, unknown[][]>();

/**
 * Snapshot interest (systems/netHost.ts buildSnapshot): a hero far from the
 * receiving client sends its weapon state (drones, discs, beams: things only
 * drawn near it) every eightpTuning.farEvery-th snapshot; in between the same
 * list is repeated, which the snapshot codec leaves out as unchanged. Within
 * eightpTuning.farHero (and always for the client's own hero) it is fresh.
 */
export function heroWeaponsFor(g: Game, forHero: Hero, h: Hero, build: (readySteps: number) => unknown[]): unknown[] {
  let list = sentWeapons.get(forHero);
  if (!list) sentWeapons.set(forHero, (list = []));
  const prev = list[h.index];
  if (h !== forHero && prev && prev.length === h.weapons.length) {
    const d = Math.hypot(h.player.x - forHero.player.x, h.player.z - forHero.player.z);
    if (!farHeroFresh(d, Math.floor(g.stepN / SNAP_EVERY), h.index)) return prev;
  }
  // Only your own reload meter is drawn: teammates' `ready` goes in quarters, so it rarely changes.
  return (list[h.index] = build(h === forHero ? 20 : eightpTuning.mateReadySteps));
}

/** Effects recorded since each client's last snapshot (staggered sending). */
const pendingFx = new WeakMap<Hero, VfxEvent[]>();
let staggered = false;

/**
 * Host, 5-8 players (4+ remote clients): spread snapshot building over the
 * SNAP_EVERY steps instead of building all of them on one step (7 clients'
 * snapshots on one step was a ~9 ms spike every third frame in the coop8
 * measurement). Client k gets its snapshot on steps where (step + k) % 3 = 0,
 * so every client still gets 20 Hz; effects are drained every step and queued
 * per client until its turn. Returns false (and does nothing) for smaller
 * teams and while menus freeze the world, where hostTick keeps its old path.
 */
export function eightpSnapTick(g: Game, frozen: boolean, isBot: (id: string) => boolean): boolean {
  const host = g.host;
  if (!host) return false;
  const targets = g.heroes.filter((h) => h.peerId && !isBot(h.peerId) && (!h.left || g.versus?.overlord === h.index));
  if (frozen || targets.length < eightpTuning.staggerFrom) {
    if (staggered) {
      // Back to the shared path: queued effects go out with the next regular snapshot.
      staggered = false;
      for (const h of targets) pendingFx.delete(h);
    }
    return false;
  }
  staggered = true;
  const events = g.vfx.drain();
  for (const h of targets) {
    let q = pendingFx.get(h);
    if (!q) pendingFx.set(h, (q = []));
    for (let i = 0; i < events.length; i++) q.push(events[i]);
    if ((g.stepN + h.index) % SNAP_EVERY !== 0) continue;
    host.send(h.peerId, g.buildSnapshot(h, q));
    q.length = 0;
  }
  return true;
}
