/**
 * 8-player co-op (eightp lane): the player caps and the pure rules that scale
 * a run from 5 to 8 heroes. Every rule is the identity for 1-4 players, so
 * 2-4 player runs keep their tuning; only teams past four use the "past 4"
 * slopes below. Game wiring lives in src/game/systems/eightp.ts; render LOD
 * in src/render/lod.ts; the teammate weapon mix in src/audio/mix.ts.
 */

/** Online co-op (and weekly co-op) takes up to this many players. */
export const COOP_MAX_PLAYERS = 8;
/** Versus Swarm keeps four (one Overlord against up to three heroes was its tuning). */
export const VERSUS_MAX_PLAYERS = 4;
/** PvP free-for-all (src/game/pvp.ts PVP_MAX_PLAYERS). */
export const PVP_CAP = 8;

/** RACE and RAID lobbies take eight on their own tuning (src/game/systems/race.ts, raid.ts), whatever the co-op cap is. */
export const RACE_CAP = 8;
export const RAID_CAP = 8;

/** How many players a lobby of this kind takes (host included). Every lobby check (hello, start, NetHost.setMax) goes through this. */
export function lobbyCap(kind: string | undefined): number {
  switch (kind) {
    case 'versus': return VERSUS_MAX_PLAYERS;
    case 'pvp': return PVP_CAP;
    case 'race': return RACE_CAP;
    case 'raid': return RAID_CAP;
    default: return COOP_MAX_PLAYERS; // co-op and weekly co-op
  }
}

export const eightpTuning = {
  /** Each player past four counts this much for the enemy count (1 = keep the 2-4 slope). */
  countPast4: 0.5,
  /** ...for enemy life. */
  hpPast4: 0.6,
  /** ...for boss life (bosses keep the linear slope: eight heroes shred them otherwise). */
  bossPast4: 1,
  /** At most this much extra enemy life when the alive cap trims a 5-8 player horde. */
  capHpMax: 1.5,
  /** Team moves and the team ultimate: each hero past four adds this much power / charge rate. */
  teamPast4: 0.5,
  /** Hearts and coin drops: +this per player past four (the horde grows slower than the team). */
  lootPerPlayer: 0.1,
  /** Revive pool: +1 starting life per this many players past four; +maxPer cap per player past four; cost +costPer each. */
  poolStartEvery: 2,
  poolMaxPer: 1,
  poolCostPer: 0.12,
  /** Revives in 5+ teams: each extra helper next to a downed hero speeds it up by this, up to reviveMaxMul. */
  reviveHelper: 0.35,
  reviveMaxMul: 1.7,
  /** Team ultimate in 5+ teams: this share of the living heroes firing inside the window is enough (at least 4). */
  ultQuorum: 0.6,
  /** Team-ultimate radius grows by radiusPerHero only up to this many heroes. */
  ultRadiusHeroes: 6,
  /** Camera (5+ heroes): frame the nearest teammates within this range (m), at most frameMax of them. */
  frameRange: 26,
  frameMax: 5,
  /** Name tags (5+ heroes): healthy on-screen teammates closer than this (m) show a short tag. */
  tagNear: 9,
  /** Tags closer than this (px) stack. */
  tagGapX: 56,
  tagGapY: 15,
  /** Edge pointers closer than this (px) stack. */
  edgeGap: 24,
  /** Short tag length (characters). */
  tagShort: 5,
  /** Pings (5+ heroes): the whole team gets at most pingBurst pings per pingWindow s. */
  pingBurst: 4,
  pingWindow: 2,
  /** Snapshot interest: heroes further than this (m) from a client send their weapon state every farEvery-th snapshot... */
  farHero: 60,
  farEvery: 5,
  /** ...and further than midHero every midEvery-th (drawn at the edge of a zoomed-out view at most). */
  midHero: 36,
  midEvery: 2,
  /** Spread snapshot building over the 3 snapshot steps from this many remote clients (5+ players). */
  staggerFrom: 4,
  /** Teammates' weapon reload (`ready`) in this many steps (your own: 20). */
  mateReadySteps: 4,
};

/** Player count after the past-4 slope: n for n <= 4, else 4 + (n - 4) x slope. */
export function effPlayers(n: number, past4: number): number {
  const k = Math.max(1, n);
  return k <= 4 ? k : 4 + (k - 4) * past4;
}

/** Enemy count, enemy life and boss life multipliers' player factors (director.ts uses `1 + per x (eff - 1)`). */
export function countPlayers(n: number): number {
  return effPlayers(n, eightpTuning.countPast4);
}
export function hpPlayers(n: number): number {
  return effPlayers(n, eightpTuning.hpPast4);
}
export function bossPlayers(n: number): number {
  return effPlayers(n, eightpTuning.bossPast4);
}
/** Heroes as team moves and the team ultimate count them. */
export function teamHeroes(n: number): number {
  return effPlayers(n, eightpTuning.teamPast4);
}

/**
 * Enemy life compensation when the alive cap (directorTuning.aliveCap) cuts
 * a big team's horde: `rawN` / `raw4` are the uncapped alive targets for this
 * team and for four players. Whatever the cap cuts beyond the 4-player cut
 * comes back as enemy life, up to eightpTuning.capHpMax (perf: the cap stays).
 */
export function capHpComp(rawN: number, raw4: number, cap: number): number {
  if (!(rawN > raw4) || raw4 <= 0) return 1;
  const cutN = rawN / Math.min(cap, rawN);
  const cut4 = raw4 / Math.min(cap, raw4);
  return Math.max(1, Math.min(eightpTuning.capHpMax, cutN / cut4));
}

/** Utility drop multiplier (hearts, coins) for a team of n. */
export function lootMul(n: number): number {
  return 1 + eightpTuning.lootPerPlayer * Math.max(0, n - 4);
}

/** Revive pool lives at the start of a run, its cap and its cost multiplier, for a team of n. */
export function poolStartFor(base: number, n: number): number {
  return base + Math.floor(Math.max(0, n - 4) / eightpTuning.poolStartEvery);
}
export function poolMaxFor(base: number, n: number): number {
  return base + eightpTuning.poolMaxPer * Math.max(0, n - 4);
}
export function poolCostMul(n: number): number {
  return 1 + eightpTuning.poolCostPer * Math.max(0, n - 4);
}

/** Revive speed bonus from extra helpers (5+ teams only; 1 otherwise). */
export function reviveHelperMul(helpers: number, team: number): number {
  if (team <= 4 || helpers <= 1) return 1;
  return Math.min(eightpTuning.reviveMaxMul, 1 + eightpTuning.reviveHelper * (helpers - 1));
}

/** How many of `alive` heroes must fire their ultimates together for a team ultimate. */
export function ultQuorum(alive: number): number {
  return alive <= 4 ? alive : Math.max(4, Math.ceil(alive * eightpTuning.ultQuorum));
}

/**
 * Team ultimate participants: the heroes (indices into `fired`) whose last
 * ultimate is newer than `since`, inside `window` of now and of each other.
 * Returns the largest such group if it reaches the quorum, else null. For 2-4
 * heroes the quorum is everyone, which is the old "did everyone fire" rule.
 */
export function ultParticipants(fired: readonly number[], now: number, since: number, window: number): number[] | null {
  const need = ultQuorum(fired.length);
  if (fired.length < 2) return null;
  const fresh: number[] = [];
  for (let i = 0; i < fired.length; i++) if (fired[i] > since && now - fired[i] <= window) fresh.push(i);
  if (fresh.length < need) return null;
  // Largest group whose spread fits the window (sliding window over sorted times).
  fresh.sort((a, b) => fired[a] - fired[b]);
  let best: number[] = [];
  for (let lo = 0, hi = 0; hi < fresh.length; hi++) {
    while (fired[fresh[hi]] - fired[fresh[lo]] > window) lo++;
    if (hi - lo + 1 > best.length) best = fresh.slice(lo, hi + 1);
  }
  return best.length >= need ? best.sort((a, b) => a - b) : null;
}

/** Run start: where hero i of n stands (one line of up to 4, two rows for 5-8). */
export function spawnSpotFor(i: number, n: number): { x: number; z: number } {
  if (n <= 4) return { x: (i - (n - 1) / 2) * 2, z: 0 };
  const front = Math.ceil(n / 2);
  const row = i < front ? 0 : 1;
  const k = row ? i - front : i;
  const m = row ? n - front : front;
  return { x: (k - (m - 1) / 2) * 2.2, z: row * 2.2 };
}

/** Boss chests: hero i's owned chest offset from the boss (a row for up to 4, a ring for 5-8). */
export function ownedChestSpot(i: number, n: number): { x: number; z: number } {
  if (n <= 4) return { x: i * 0.8, z: 0 };
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  const r = 1.7;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/**
 * Camera framing (5+ heroes): which teammates to frame. `xs`/`zs` hold the
 * candidates' positions; writes the chosen ones' indices into `out` (nearest
 * first, within frameRange, at most frameMax) and returns how many.
 */
export function pickFrameMates(lx: number, lz: number, xs: ArrayLike<number>, zs: ArrayLike<number>, count: number, out: Int32Array | number[]): number {
  const T = eightpTuning;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const d = Math.hypot(xs[i] - lx, zs[i] - lz);
    if (d > T.frameRange) continue;
    // Insertion by distance (count is at most 7).
    let k = n;
    while (k > 0 && Math.hypot(xs[out[k - 1]] - lx, zs[out[k - 1]] - lz) > d) {
      out[k] = out[k - 1];
      k--;
    }
    out[k] = i;
    n++;
  }
  return Math.min(n, T.frameMax);
}

/** A name tag as the HUD gets it (src/ui/hud.ts TeamTag), plus the eightp layout fields. */
export interface LayoutTag {
  x: number;
  y: number;
  name: string;
  down: boolean;
  onScreen: boolean;
  dist?: number;
  /** Short label (5+ heroes: near and healthy, or an edge pointer). */
  mini?: boolean;
  /** Extra vertical offset in px (stacked so tags don't overlap). */
  dy?: number;
}

/** Where the HUD pins an off-screen tag (same rule as Hud.setTeam). */
export function edgePin(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const k = Math.min((cx - 90) / Math.abs(dx || 1e-6), (cy - 64) / Math.abs(dy || 1e-6));
  return { x: cx + dx * k, y: cy + dy * k };
}

const pins: { x: number; y: number; i: number }[] = [];

/**
 * Declutter teammate tags for big teams (heroes >= 5; no-op otherwise):
 * near, healthy, on-screen teammates get a short tag (their ground ring and
 * colour already say who they are); tags and edge pointers that would overlap
 * stack upward/downward. Mutates `tags` (sets mini / dy).
 */
export function declutterTags(tags: LayoutTag[], heroes: number, w: number, h: number): void {
  for (const t of tags) {
    t.mini = false;
    t.dy = 0;
  }
  if (heroes < 5) return;
  const T = eightpTuning;
  for (const t of tags) if (!t.onScreen || (!t.down && (t.dist ?? 99) < T.tagNear)) t.mini = true; // edge pointers: short name + distance
  // On-screen: tags over heads that collide move up, nearest hero keeps its place.
  pins.length = 0;
  tags.forEach((t, i) => t.onScreen && pins.push({ x: t.x, y: t.y, i }));
  pins.sort((a, b) => (tags[a.i].dist ?? 0) - (tags[b.i].dist ?? 0));
  for (let a = 0; a < pins.length; a++) {
    const A = tags[pins[a].i];
    for (let guard = 0; guard < 8; guard++) {
      let hit = false;
      for (let b = 0; b < a; b++) {
        const B = tags[pins[b].i];
        if (Math.abs(A.x - B.x) < T.tagGapX && Math.abs(A.y + (A.dy ?? 0) - (B.y + (B.dy ?? 0))) < T.tagGapY) {
          A.dy = (A.dy ?? 0) - T.tagGapY;
          hit = true;
        }
      }
      if (!hit) break;
    }
  }
  // Off-screen: pointers pinned to nearly the same edge spot stack away from the corner.
  pins.length = 0;
  tags.forEach((t, i) => {
    if (t.onScreen) return;
    const p = edgePin(t.x, t.y, w, h);
    pins.push({ x: p.x, y: p.y, i });
  });
  pins.sort((a, b) => (tags[a.i].dist ?? 0) - (tags[b.i].dist ?? 0));
  for (let a = 0; a < pins.length; a++) {
    const A = pins[a];
    let dy = 0;
    for (let guard = 0; guard < 8; guard++) {
      let hit = false;
      for (let b = 0; b < a; b++) {
        const B = pins[b];
        const by = B.y + (tags[B.i].dy ?? 0);
        if (Math.abs(A.x - B.x) < T.edgeGap * 3 && Math.abs(A.y + dy - by) < T.edgeGap) {
          dy += A.y < h / 2 ? T.edgeGap : -T.edgeGap; // away from the nearer corner
          hit = true;
        }
      }
      if (!hit) break;
    }
    tags[A.i].dy = dy;
  }
}

/** A short tag label: the first letters of the name. */
export function shortName(name: string): string {
  return [...name.trim()].slice(0, eightpTuning.tagShort).join('');
}

/** Team-wide ping budget (5+ heroes): times of recent pings in, whether this one may go out. */
export function pingAllowed(recent: number[], now: number, heroes: number): boolean {
  if (heroes < 5) return true;
  const T = eightpTuning;
  while (recent.length && now - recent[0] > T.pingWindow) recent.shift();
  if (recent.length >= T.pingBurst) return false;
  recent.push(now);
  return true;
}

/** Should a far hero's weapon state be refreshed in this client's snapshot? */
export function farHeroFresh(dist: number, snapN: number, heroIndex: number): boolean {
  const T = eightpTuning;
  if (dist <= T.midHero) return true;
  return (snapN + heroIndex) % (dist > T.farHero ? T.farEvery : T.midEvery) === 0;
}
