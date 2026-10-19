import { readyFusions } from '../../data/fusions';
import { modeCodexId } from '../../data/codex2';
import { TIP2_IDS, type Tip2Id } from '../../data/tips2';
import { Team } from '../bullets';
import { cashCost, cashTuning } from '../gameplay';
import type { Game } from '../game';
import { MinionKind, minionsOf } from '../heroes3';
import { markCodex, save } from '../save';
import { timeTuning } from '../timeRules';
import { coopState, teamBonus } from './coop2';
import { coopPlayState } from './coopplay';
import { gpWorld } from './gameplay';
import { challengeState } from './gauntlet';
import { raidRuntime } from './raid';
import { secretsState } from './secrets';
import { timeState } from './time';
import { tradingOn } from './trading';
import { worldEventOf } from './worldEvents';

/**
 * tips2 lane: spots the first time this machine's player meets a newer
 * mechanic and queues its tip (text in src/data/tips2.ts). Read-only on game
 * state, run every 10 steps from Onboarding.detectTips on every machine, so
 * clients tip from what their snapshots mirror. A tip whose moment has passed
 * by the time it reaches the front of the queue is dropped (`tip2Still`) and
 * comes back the next time it applies. Also notes Codex/Arsenal discoveries
 * for things the other systems don't track (modes, Titan, Hydra, power-ups).
 */

/** One pass over the enemies, shared by every detector of a poll (reused, no allocation). */
const scan = {
  boss: '',
  remix: false,
  secretBoss: false,
  miniboss: false,
  mutated: false,
  goldbug: false,
  ids: new Set<string>(),
};

function scanEnemies(g: Game): void {
  scan.boss = '';
  scan.remix = false;
  scan.secretBoss = false;
  scan.miniboss = false;
  scan.mutated = false;
  scan.goldbug = false;
  scan.ids.clear();
  const list = g.role === 'client' ? g.netEnemies.values() : g.enemies.list;
  for (const e of list) {
    if (!e.active || e.pvpOwner >= 0) continue;
    const d = e.def;
    if (d.boss && !scan.boss) {
      scan.boss = d.remixOf ?? d.id;
      scan.remix = !!d.remixOf;
      scan.secretBoss = !!d.secret;
    }
    if (d.miniboss) scan.miniboss = true;
    if (e.mutated) scan.mutated = true;
    if (d.id === 'golden') scan.goldbug = true;
    scan.ids.add(d.id.startsWith('v_') ? d.id.slice(2) : d.id);
  }
  // Solo/host: the boss reference is authoritative (hidden Titan parts, remixes).
  if (g.role !== 'client' && g.boss?.active) {
    const d = g.boss.def;
    scan.boss = d.remixOf ?? d.id;
    scan.remix = !!d.remixOf;
    scan.secretBoss = !!d.secret;
  }
}

/** A co-op run with teammates (not PvP, Versus or a race). */
const teamRun = (g: Game) => g.coop && !g.pvp && !g.versus && !g.race;
const fighting = (g: Game) => g.mode === 'fight';

function raidState(g: Game) {
  return g.runMode === 'raid' ? raidRuntime(g).state : null;
}

function rewindReady(g: Game): boolean {
  if (g.pvp || g.versus) return false;
  const s = timeState(g);
  if (g.role === 'client') return !s.net.used && s.net.hist * timeTuning.rewindSeconds >= timeTuning.rewindMin;
  return s.rewindsUsed < timeTuning.rewindPerStage && s.tl.span >= timeTuning.rewindMin;
}

function eventOn(g: Game, kind: string): boolean {
  const ev = worldEventOf(g);
  return !!ev && !ev.done && ev.kind === kind && fighting(g);
}

/** Is this tip's moment now? (Each one reads only state this machine has.) */
const DETECT: Record<Tip2Id, (g: Game) => boolean> = {
  // ---- time and gameplay
  rewind: (g) => fighting(g) && g.runTime > 15 && g.hero.player.hp < g.hero.player.maxHp * 0.6 && !g.hero.player.dead && rewindReady(g),
  laststand: (g) => fighting(g) && !g.pvp && g.combo >= timeTuning.standCombo,
  cashin: (g) => g.isCombatMode && g.combo >= cashCost(cashTuning.tiers[0], gpWorld(g).cashUses),
  mech: (g) => fighting(g) && (gpWorld(g).drops.some((d) => d.kind === 'mech') || g.hero.play.mechT > 0),
  crate: (g) => fighting(g) && (gpWorld(g).drops.some((d) => d.kind !== 'mech') || g.hero.play.superId !== ''),
  mutation: (g) => fighting(g) && scan.mutated,
  overload: (g) => g.isCombatMode && (g.hero.play.overloadReady || g.hero.play.overload01 > 0),
  // ---- co-op
  teammove: (g) => teamRun(g) && fighting(g) && (g.companionState().meter.ready || g.companionState().meter.linked >= 2),
  teamult: (g) => teamRun(g) && fighting(g) && g.hero.skill.ult >= 1,
  revivepool: (g) => teamRun(g) && g.hero.player.dead && (g.role === 'client' ? !!coopState(g).net.pool : coopState(g).pool.on),
  carry: (g) => teamRun(g) && fighting(g) && !g.hero.player.dead && g.heroes.some((o) => o !== g.hero && !o.left && o.player.dead),
  tether: (g) => teamRun(g) && fighting(g) && (coopPlayState(g).link[g.hero.index] ?? 0) >= 2,
  trading: (g) => tradingOn(g) && fighting(g) && g.runTime > 40,
  pingwheel: (g) => g.heroes.length >= 2 && !g.pvp && fighting(g) && g.runTime > 20 && !g.hero.player.dead,
  roles: (g) => teamRun(g) && fighting(g) && g.runTime > 60 && teamBonus(g).scale > 0,
  dropin: (g) => teamRun(g) && (g.role === 'client' ? coopState(g).net.ai.length > 0 : coopState(g).grace.length > 0),
  coopobj: (g) => teamRun(g) && fighting(g) && coopPlayState(g).kind !== null,
  // ---- skill
  parry: (g) => {
    if (!fighting(g) || g.runTime < 20 || g.hero.play.mechT > 0) return false;
    const b = g.bullets;
    for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy) return true;
    return false;
  },
  perfectdash: (g) => fighting(g) && (g.hero.skill.style.notes.some((n) => n.text === 'PERFECT DODGE') || (g.stage >= 2 && g.director.time > 30)),
  // ---- build, run and modes
  fusion: (g) => g.isCombatMode && readyFusions(g.hero.weapons.filter((w) => !w.def.slot).map((w) => ({ id: w.def.id, maxed: w.maxed }))).length > 0,
  route: (g) => g.screens.current === 'route',
  heat: (g) => fighting(g) && g.meta.heat.length > 0,
  gauntlet: (g) => fighting(g) && g.runMode === 'gauntlet',
  ascension: (g) => fighting(g) && challengeState(g).ascension > 0,
  rhythm: (g) => fighting(g) && g.modes.rhythm,
  pacifist: (g) => fighting(g) && g.modes.pacifist,
  minigame: (g) => !!g.modes.mg,
  // ---- raid
  raid: (g) => fighting(g) && !!raidState(g),
  raidparry: (g) => fighting(g) && !!raidState(g)?.orbs.some((o) => o.live && !o.reflected),
  raidstump: (g) => fighting(g) && !!raidState(g)?.heads.some((x) => x.stump > 0),
  raidcore: (g) => fighting(g) && raidState(g)?.phase === 'core',
  raidover: (g) => fighting(g) && raidState(g)?.phase === 'overdrive',
  // ---- competitive
  race: (g) => fighting(g) && g.race?.phase === 'run',
  pvp: (g) => g.pvp?.phase === 'duel',
  pvpteams: (g) => g.pvp?.phase === 'duel' && g.pvp.rules.format === 'teams',
  pvprounds: (g) => g.pvp?.phase === 'duel' && g.pvp.rules.rounds === 3,
  // ---- secrets, seasons, pets
  secret: (g) => {
    const r = secretsState(g).room;
    const p = g.hero.player;
    return fighting(g) && !!r?.kind && !r.done && Math.hypot(r.x - p.x, r.z - p.z) < 20;
  },
  goldbug: (g) => fighting(g) && scan.goldbug,
  candy: (g) => fighting(g) && g.halloween.season === 'halloween' && g.halloween.drops.some((d) => d.value > 0),
  petskill: (g) => g.isCombatMode && g.hero.petState.has && g.hero.petState.level >= 2,
  // ---- heroes
  ronin: (g) => fighting(g) && g.hero.heroDef.id === 'ronin',
  tinker: (g) => fighting(g) && g.hero.heroDef.id === 'tinker' && minionsOf(g).countOf(g.hero.index, MinionKind.Bot) > 0,
  // ---- bosses and enemies
  glitch: (g) => fighting(g) && scan.boss === 'glitch',
  boxer: (g) => fighting(g) && scan.boss === 'boxer',
  gale: (g) => fighting(g) && scan.boss === 'gale',
  pumpking: (g) => fighting(g) && scan.boss === 'pumpking',
  titan: (g) => fighting(g) && scan.boss === 'titan',
  omega: (g) => fighting(g) && scan.boss === 'omega',
  remix: (g) => fighting(g) && scan.remix,
  miniboss: (g) => fighting(g) && scan.miniboss,
  secretboss: (g) => fighting(g) && scan.secretBoss,
  reaper: (g) => fighting(g) && scan.ids.has('reaper'),
  swarmqueen: (g) => fighting(g) && scan.ids.has('swarmqueen'),
  mirror: (g) => fighting(g) && (scan.ids.has('mirror') || scan.ids.has('mirror_prism')),
  burrower: (g) => fighting(g) && (scan.ids.has('burrower') || scan.ids.has('burrower_big')),
  ghost: (g) => fighting(g) && scan.ids.has('ghost'),
  // ---- world events
  collapse: (g) => eventOn(g, 'collapse'),
  flood: (g) => eventOn(g, 'flood'),
  split: (g) => eventOn(g, 'split'),
  giant: (g) => eventOn(g, 'giant'),
  eclipse: (g) => eventOn(g, 'eclipse'),
  flower: (g) => eventOn(g, 'flower'),
  volcano: (g) => eventOn(g, 'volcano'),
  stealth: (g) => eventOn(g, 'stealth'),
};

/** Ids that are about a moment (dropped if it passed before the tip could show). Explainers of a state you keep stay queued. */
const MOMENTS = new Set<Tip2Id>(['rewind', 'laststand', 'cashin', 'mech', 'crate', 'parry', 'carry', 'revivepool', 'teammove', 'teamult', 'raidparry', 'raidstump', 'secret', 'goldbug', 'candy', 'collapse', 'volcano', 'giant', 'flood', 'eclipse', 'flower', 'split', 'reaper', 'swarmqueen', 'mirror', 'burrower', 'ghost', 'glitch', 'boxer', 'gale', 'pumpking', 'titan', 'omega', 'remix', 'miniboss', 'secretboss']);

const IDS = new Set<string>(TIP2_IDS);

/** Should a dequeued tip still show? Only tips2 moments are checked; everything else is always still wanted. */
export function tip2Still(g: Game, id: string): boolean {
  if (!IDS.has(id) || !MOMENTS.has(id as Tip2Id)) return true;
  try {
    scanEnemies(g);
    return DETECT[id as Tip2Id](g);
  } catch {
    return false;
  }
}

/** Every 10 steps (and when a menu opens): queue the tips whose moment it is. */
export function detectTips2(g: Game, want: (id: Tip2Id) => void): void {
  if (g.mode === 'title' || g.mode === 'dead') return;
  scanEnemies(g);
  discover(g);
  const seen = save.tips;
  for (const id of TIP2_IDS) {
    if (seen.includes(id)) continue;
    // Lane state can be missing in odd setups (tests, a lane not installed): a detector that throws just doesn't tip.
    let hit = false;
    try {
      hit = DETECT[id](g);
    } catch {
      hit = false;
    }
    if (hit) want(id);
  }
}

/** Codex/Arsenal discoveries no other system records. */
function discover(g: Game): void {
  if (!fighting(g)) return;
  const h = g.hero;
  markCodex(modeCodexId(g.runMode, { pvp: !!g.pvp, race: !!g.race, versus: !!g.versus, coop: g.coop }));
  if (scan.boss === 'titan') markCodex('boss:titan');
  if (raidState(g)) markCodex('boss:hydra');
  const keys: string[] = [];
  if (h.play.mechT > 0) keys.push('x:mech');
  if (h.play.superId) keys.push(`x:${h.play.superId}`);
  if (g.halloween.season === 'halloween' && g.halloween.drops.some((d) => d.value > 0)) keys.push('x:candy');
  if (keys.length) g.onboarding.note(...keys);
}
