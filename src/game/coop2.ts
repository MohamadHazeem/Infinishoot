/**
 * Co-op, wave 2 (coop2 lane): the pure rules behind drop-in/drop-out co-op,
 * the shared revive pool, the synced team ultimate, emotes and help ghosts.
 * Game-facing code lives in src/game/systems/coop2.ts; this file has no Game
 * access so it can be unit-tested on its own.
 */
import { loadJson, saveJson } from '../core/storage';
import type { Offer } from '../ui/screens';

/** Damage sources this lane adds (names for the damage breakdown, statuses.ts sourceName). */
export const COOP2_SOURCE_NAMES: Record<string, string> = { teamult: 'Team Ultimate', ghost: 'Help Ghost' };

// ---------------------------------------------------------------- knobs

/** Drop-in / drop-out. */
export const joinTuning = {
  /** Seconds a disconnected player's hero stays in the run on autopilot, waiting for them to come back. */
  grace: 60, // netcode lane: a full minute to reconnect (was 45)
  /** Invulnerability for a hero joining (or coming back) mid-run. */
  spawnProtect: 3,
  /** A new hero gets this share of the team's level-ups, picked automatically. */
  fairShare: 0.85,
  maxAutoPicks: 45,
  /** A new hero's gold: this share of the team's average gold. */
  goldShare: 0.6,
  /** Give up on a joiner still waiting for a safe moment after this long (s). */
  waitMax: 90,
  /** How far from the teammate they spawn next to (m). */
  spawnDist: 2.2,
};

/** Shared revive pool (host lobby option). */
export const poolTuning = {
  /** Lives in the pool at the start of a run. */
  start: 3,
  /** Lives added at each stage clear, up to `max`. */
  perStage: 1,
  max: 6,
  /** A downed hero must wait this long (with nobody reviving them) before buying back in. */
  wait: 5,
  /** Gold a buy-back costs the team: base + perStage x stage, split between everyone (see splitCost). */
  costBase: 12,
  costPerStage: 6,
  /** Life and i-frames on getting back up. */
  hp: 0.5,
  iframes: 3,
};

/** Team ultimate: everyone fires their ultimate within `window` seconds. */
export const teamUltTuning = {
  window: 2,
  /** Shock rings from the team's centre. */
  waves: 3,
  waveGap: 0.35,
  radius: 16,
  radiusPerHero: 3,
  /** Damage per wave in "typical enemies" (ultimates.ts power()); one hero's ultimate is roughly 30 of these. */
  dmg: 26,
  /** Bigger than the sum: x(heroes) x this. */
  synergy: 1.5,
  bossMul: 0.35,
  /** Team heal (share of max life) and i-frames when it lands. */
  heal: 0.3,
  iframes: 2.5,
  /** Enemies left standing are stunned (frozen) this long; bosses x0.15. */
  stun: 1.6,
  /** Cooldown between team ultimates (s). */
  cooldown: 8,
};

/** Emotes and voice lines. */
export const emoteTuning = {
  /** Host rate limit per player: at least this far apart, and at most `burst` per `burstWindow` s. */
  minGap: 1,
  burst: 4,
  burstWindow: 8,
  /** Bubble time over the hero (s). */
  bubble: 2.4,
};

/** Help ghosts (asynchronous help from friends who fell at a boss). */
export const ghostTuning = {
  /** Seconds a ghost fights alongside you. */
  duration: 30,
  /** Ghosts per run (from your inbox). */
  perRun: 1,
  /** Seconds after a boss appears before a ghost turns up (its entrance plays first). */
  bossDelay: 3,
  /** Hard moment: a hero under this share of life with this many enemies within 8 m. */
  hardHp: 0.3,
  hardCrowd: 12,
  /** Ghost bolts: one every `rate` s at the nearest enemy within `range` m. */
  rate: 0.16,
  range: 15,
  /** Damage per bolt in "typical enemies" (ultimates.ts power()), x(1 + level x perLevel). */
  bolt: 0.35,
  perLevel: 0.015,
  /** A spirit nova every `novaEvery` s (radius m, damage in typical enemies). */
  novaEvery: 3.2,
  novaRadius: 4.5,
  nova: 2.2,
  bossMul: 0.5,
  /** Stays within this distance of the hero it helps (m). */
  leash: 6,
  inboxMax: 6,
};

// ---------------------------------------------------------------- drop-in

/** How many level-up picks a hero joining at team level `level` gets automatically. */
export function autoPickCount(level: number, share = joinTuning.fairShare): number {
  return Math.max(0, Math.min(joinTuning.maxAutoPicks, Math.round((level - 1) * share)));
}

/** The card an automatic pick takes: loadout growth and weapons first, filler (gold, snacks) last. */
export function autoPickIndex(offers: readonly Pick<Offer, 'kind' | 'rarity'>[]): number {
  const rank = (o: Pick<Offer, 'kind' | 'rarity'>) => {
    if (o.kind === 'evo' || o.kind === 'evolve' || o.kind === 'fusion') return 6;
    if (o.kind === 'track') return 5;
    if (o.kind === 'weapon' || o.kind === 'special') return 4;
    if (o.kind === 'passive') return 3;
    if (o.kind === 'overdrive') return 2;
    return 0;
  };
  let best = 0;
  for (let i = 1; i < offers.length; i++) if (rank(offers[i]) > rank(offers[best])) best = i;
  return best;
}

/** A stable id per player (survives reconnecting and new peer ids), kept in localStorage. */
export function coopPlayerId(): string {
  let id = loadJson<string>('coop.pid', '');
  if (!/^[a-z0-9]{8,16}$/.test(id)) {
    id = '';
    for (let i = 0; i < 12; i++) id += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    saveJson('coop.pid', id);
  }
  return id;
}

// ---------------------------------------------------------------- revive pool

/** Gold a buy-back costs the team on this stage. */
export function poolCost(stage: number): number {
  return poolTuning.costBase + poolTuning.costPerStage * Math.max(1, stage);
}

/**
 * The split rule: the cost is shared as evenly as possible by everyone in the
 * run (the downed hero included). Anyone who can't cover their share pays all
 * they have and the rest is split evenly between the others, repeated until it
 * adds up; whole gold only, odd coins go to whoever holds the most. Returns what
 * each hero pays, or null if the whole team together can't afford it.
 */
export function splitCost(golds: readonly number[], cost: number): number[] | null {
  const n = golds.length;
  const pay = golds.map(() => 0);
  if (cost <= 0) return pay;
  const have = golds.map((g) => Math.max(0, Math.floor(g)));
  if (n === 0 || have.reduce((a, b) => a + b, 0) < cost) return null;
  let left = cost;
  let open = have.map((_, i) => i);
  while (left > 0 && open.length) {
    const share = Math.floor(left / open.length);
    if (share === 0) {
      // Odd coins: the richest (by what they still hold) pay one more each.
      const rich = [...open].sort((a, b) => have[b] - pay[b] - (have[a] - pay[a]) || a - b);
      for (const i of rich) {
        if (left <= 0) break;
        if (have[i] - pay[i] <= 0) continue;
        pay[i]++;
        left--;
      }
      open = open.filter((i) => have[i] - pay[i] > 0);
      continue;
    }
    const next: number[] = [];
    for (const i of open) {
      const take = Math.min(share, have[i] - pay[i]);
      pay[i] += take;
      left -= take;
      if (have[i] - pay[i] > 0) next.push(i);
    }
    open = next;
  }
  return left > 0 ? null : pay;
}

// ---------------------------------------------------------------- team ultimate

/**
 * Did everyone fire inside the window? `fired` holds each living hero's last
 * ultimate time (-Infinity = not yet); `since` is the last team ultimate, so
 * one set of ultimates combines once.
 */
export function teamUltDue(fired: readonly number[], now: number, since: number, window = teamUltTuning.window): boolean {
  if (fired.length < 2) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of fired) {
    if (!(t > since) || now - t > window) return false;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return hi - lo <= window;
}

/** Team ultimate damage per wave, in typical enemies, for `n` heroes. */
export function teamUltDamage(n: number): number {
  return teamUltTuning.dmg * n * teamUltTuning.synergy;
}

// ---------------------------------------------------------------- emotes

export type EmoteId = 'wave' | 'cheer' | 'thumbs' | 'laugh' | 'sorry' | 'help';

export interface EmoteDef {
  id: EmoteId;
  label: string;
  /** Bubble text. */
  say: string;
  color: string;
  /** Recorded bark (src/audio/voices.ts BarkKind) and synthesized bark (src/audio/voice.ts) to speak. */
  rec: 'start' | 'win' | 'revive' | 'bigkill' | 'lowhp' | 'level';
  synth: 'levelUp' | 'victory' | 'revive' | 'dodge' | 'hurt' | 'lowLife';
  /** 8x8 pixel glyph, '#' = ink, 'o' = colour. */
  glyph: string[];
}

export const EMOTES: EmoteDef[] = [
  { id: 'wave', label: 'WAVE', say: 'HI!', color: '#73eff7', rec: 'start', synth: 'levelUp', glyph: ['..o.o...', '.oo.oo..', '.oooooo.', '.ooooooo', '.ooooooo', '..ooooo.', '...ooo..', '........'] },
  { id: 'cheer', label: 'CHEER', say: 'WOO-HOO!', color: '#ffcd75', rec: 'win', synth: 'victory', glyph: ['o..oo..o', '.o.oo.o.', '...oo...', '.oooooo.', '...oo...', '..o..o..', '.o....o.', '........'] },
  { id: 'thumbs', label: 'THUMBS UP', say: 'NICE ONE!', color: '#a7f070', rec: 'revive', synth: 'revive', glyph: ['...oo...', '...oo...', '...oo...', 'oooooo..', 'ooooooo.', 'ooooooo.', 'oooooo..', '........'] },
  { id: 'laugh', label: 'LAUGH', say: 'HA HA HA!', color: '#ffcd75', rec: 'bigkill', synth: 'dodge', glyph: ['..oooo..', '.oooooo.', 'o#oo#oo.', 'oooooooo', 'o######o', '.o####o.', '..oooo..', '........'] },
  { id: 'sorry', label: 'SORRY', say: 'OOPS, SORRY!', color: '#94b0c2', rec: 'lowhp', synth: 'hurt', glyph: ['..oooo..', '.oooooo.', 'o#oo#ooo', 'oooooooo', 'ooo##ooo', '.o#oo#o.', '..oooo..', '........'] },
  { id: 'help', label: 'HELP', say: 'HELP ME!', color: '#ef7d57', rec: 'lowhp', synth: 'lowLife', glyph: ['...oo...', '...oo...', '...oo...', '...oo...', '...oo...', '........', '...oo...', '........'] },
];

export const EMOTE_BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e])) as Record<EmoteId, EmoteDef>;

export function emoteOf(k: unknown): EmoteDef | null {
  return typeof k === 'string' && k in EMOTE_BY_ID ? EMOTE_BY_ID[k as EmoteId] : null;
}

/** Host-side rate limit for one player's emotes. */
export class EmoteLimiter {
  private times: number[] = [];
  allow(now: number): boolean {
    const T = emoteTuning;
    const last = this.times[this.times.length - 1];
    if (last !== undefined && now - last < T.minGap) return false;
    while (this.times.length && now - this.times[0] > T.burstWindow) this.times.shift();
    if (this.times.length >= T.burst) return false;
    this.times.push(now);
    return true;
  }
  reset(): void {
    this.times.length = 0;
  }
}

// ---------------------------------------------------------------- help ghosts

/** A friend who fell at a boss: enough to draw them and size their help. */
export interface HelpGhost {
  v: 1;
  name: string;
  /** Hero id (src/data/heroes.ts), armour colour and CUSTOMISE code. */
  hero: string;
  color: string;
  look: string;
  /** Team level, stage and the boss that got them. */
  level: number;
  stage: number;
  boss: string;
  /** Left click, right click, special and up to four auto weapons (ids). */
  kit: string[];
  /** Day it was recorded (YYYY-MM-DD). */
  date: string;
}

const clampStr = (s: unknown, n: number, re = /[^\p{L}\p{N} _.'!-]/gu) => String(s ?? '').replace(re, '').slice(0, n);

/** Check and clean a ghost from outside (a code, a file, the worker, a teammate). */
export function cleanGhost(x: unknown): HelpGhost | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const name = clampStr(o.name, 12).trim();
  const level = Math.floor(Number(o.level));
  const stage = Math.floor(Number(o.stage));
  if (!name || !(level >= 1 && level <= 999) || !(stage >= 1 && stage <= 999)) return null;
  const color = /^#[0-9a-f]{6}$/i.test(String(o.color)) ? String(o.color) : '#73eff7';
  const kit = Array.isArray(o.kit) ? o.kit.slice(0, 7).map((k) => clampStr(k, 24, /[^a-z0-9_]/g)).filter(Boolean) : [];
  return {
    v: 1,
    name,
    hero: clampStr(o.hero, 16, /[^a-z0-9_]/g) || 'rookie',
    color,
    look: clampStr(o.look, 8, /[^A-Za-z0-9_-]/g) || '---00',
    level,
    stage,
    boss: clampStr(o.boss, 24).trim() || 'a boss',
    kit,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date)) ? String(o.date) : '',
  };
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sum16(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 251;
    b = (b + a) % 251;
  }
  return (b << 8) | a;
}

const GHOST_PREFIX = 'GHOST1-';

/** Share code for a ghost: "GHOST1-" + base64url(JSON + 2 checksum bytes). Works offline. */
export function encodeGhost(g: HelpGhost): string {
  const body = new TextEncoder().encode(JSON.stringify([g.name, g.hero, g.color, g.look, g.level, g.stage, g.boss, g.kit, g.date]));
  const s = sum16(body);
  const all = new Uint8Array(body.length + 2);
  all.set(body);
  all[body.length] = s >> 8;
  all[body.length + 1] = s & 255;
  return GHOST_PREFIX + b64url(all);
}

/** Read a share code (or a pasted file's JSON); null if it's not a valid ghost. */
export function decodeGhost(code: string): HelpGhost | null {
  const t = code.trim();
  try {
    if (t.startsWith('{')) return cleanGhost(JSON.parse(t));
    if (!t.toUpperCase().startsWith(GHOST_PREFIX)) return null;
    const all = unb64url(t.slice(GHOST_PREFIX.length));
    if (all.length < 3) return null;
    const body = all.subarray(0, all.length - 2);
    if (((all[all.length - 2] << 8) | all[all.length - 1]) !== sum16(body)) return null;
    const a = JSON.parse(new TextDecoder().decode(body)) as unknown[];
    if (!Array.isArray(a)) return null;
    return cleanGhost({ name: a[0], hero: a[1], color: a[2], look: a[3], level: a[4], stage: a[5], boss: a[6], kit: a[7], date: a[8] });
  } catch {
    return null;
  }
}

/** Same ghost (one person falling at one boss on one day)? */
export function sameGhost(a: HelpGhost, b: HelpGhost): boolean {
  return a.name === b.name && a.stage === b.stage && a.boss === b.boss && a.date === b.date && a.hero === b.hero;
}

const INBOX = 'ghosts.inbox';
const MINE = 'ghosts.mine';

/** Ghosts waiting to help you (newest first). */
export function ghostInbox(): HelpGhost[] {
  const list = loadJson<unknown[]>(INBOX, []);
  return (Array.isArray(list) ? list : []).map(cleanGhost).filter((g): g is HelpGhost => !!g);
}

export function saveInbox(list: HelpGhost[]): void {
  saveJson(INBOX, list.slice(0, ghostTuning.inboxMax));
}

/** Add a ghost to the inbox (no duplicates). Returns false if it was already there. */
export function addToInbox(g: HelpGhost): boolean {
  const list = ghostInbox();
  if (list.some((x) => sameGhost(x, g))) return false;
  saveInbox([g, ...list]);
  return true;
}

/** Take the oldest ghost out of the inbox (it helps once). */
export function takeFromInbox(): HelpGhost | null {
  const list = ghostInbox();
  const g = list.pop() ?? null;
  saveInbox(list);
  return g;
}

/** Your own latest ghost (to share with friends). */
export function myGhost(): HelpGhost | null {
  return cleanGhost(loadJson<unknown>(MINE, null));
}

export function saveMyGhost(g: HelpGhost): void {
  saveJson(MINE, g);
}
