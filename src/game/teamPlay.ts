import { SQUAD_ORDERS } from './aisquadBrain';
import { squadOrder } from './systems/aisquad';
/**
 * Co-op team play (fixes lane): team status combos and the ping wheel.
 *
 * Team combos: when one hero's status meets another hero's on the same enemy
 * (my Burn + your Shock = Overload; my blast catching your Burn = Napalm),
 * both heroes are credited: a TEAM COMBO popup, style for both, a gold coin
 * each, team score, and the Overload hits a little harder. Host-only (the
 * statuses run there); everything visible goes through the vfx bus.
 *
 * Ping wheel: tap the ping key (G / pad View) for the contextual ping as
 * before; hold it to open a wheel of six pings (GO HERE, DANGER, NEED HELP,
 * CHEST, ON MY WAY, NICE), pick with the mouse or the right stick, release to
 * send. While it's open, Tab / the mouse wheel / LB or RB flips to the EMOTES
 * page (wave, cheer, thumbs up, laugh, sorry, help: coop2 lane); the wheel
 * opens on the page you used last. Clients send `{ t: 'ping', x, z, k }`; hosts validate the kind and
 * rate-limit as before, so old hosts just ignore `k`.
 */
import type { Game } from './game';
import type { Hero } from './hero';
import type { Enemy } from './enemies';
import { PingWheel } from '../ui/pingWheel';
import { emoteWheel, emoteWheelKey } from './systems/season';

export const teamTuning = {
  /** Overload damage multiplier when two different heroes made it. */
  overloadMul: 1.25,
  /** Style points each partner gets. */
  style: 18,
  /** Gold each partner gets (per combo, at most one coin per hero every goldEvery s). */
  gold: 1,
  goldEvery: 3,
  /** Team score per combo, times the stage. */
  score: 60,
  /** At most one credited team combo this often (s); Napalm can fire on every blast. */
  minGap: 0.4,
  /** Seconds a hero's Shock stays credited to them. */
  shockMemory: 4,
  /** Ping wheel: hold the ping key this long to open the wheel (s). */
  holdTime: 0.2,
  /** Mouse distance (px) / stick deflection that selects a slice. */
  pickPx: 28,
  pickStick: 0.45,
};

// ---------------------------------------------------------------- team combos

/** Who shocked enemy e (pooled enemies: keyed by object, checked by uid). */
const shockers = new WeakMap<Enemy, { uid: number; by: number; at: number }>();

export function noteShock(g: Game, e: Enemy, by: Hero): void {
  shockers.set(e, { uid: e.uid, by: by.index, at: g.runTime });
}

export function shockOwner(g: Game, e: Enemy): number {
  const s = shockers.get(e);
  return s && s.uid === e.uid && g.runTime - s.at <= teamTuning.shockMemory ? s.by : -1;
}

/** Is this a team game where heroes help each other (co-op, not PvP)? */
export function teamGame(g: Game): boolean {
  return g.heroes.length > 1 && !g.pvp;
}

/** Index of the partner whose status on e the hero `by` is about to combine with, or -1. */
export function overloadPartner(g: Game, e: Enemy, by: Hero, adding: 'burn' | 'shock'): number {
  if (!teamGame(g)) return -1;
  const other = adding === 'shock' ? (e.burnT > 0 ? e.burnOwner : -1) : e.shockT > 0 ? shockOwner(g, e) : -1;
  return other >= 0 && other !== by.index && g.heroes[other] && !g.heroes[other].left ? other : -1;
}

interface TeamState {
  count: number;
  lastAt: number;
  goldAt: number[];
  /** Per hero: team combos they took part in (summary, tests). */
  per: number[];
}
const teams = new WeakMap<Game, TeamState>();
export function teamState(g: Game): TeamState {
  let s = teams.get(g);
  if (!s) teams.set(g, (s = { count: 0, lastAt: -99, goldAt: [], per: [] }));
  return s;
}

/** Credit a team combo between heroes a and b at enemy e. Returns false when rate-limited. */
export function teamCombo(g: Game, e: Enemy, a: Hero, b: Hero, kind: string): boolean {
  const s = teamState(g);
  if (a === b || g.runTime - s.lastAt < teamTuning.minGap) return false;
  s.lastAt = g.runTime;
  s.count++;
  const T = teamTuning;
  for (const h of [a, b]) {
    s.per[h.index] = (s.per[h.index] ?? 0) + 1;
    h.skill.style.add(T.style, 'TEAM COMBO');
    if (g.runTime - (s.goldAt[h.index] ?? -99) >= T.goldEvery) {
      s.goldAt[h.index] = g.runTime;
      h.gold += T.gold;
    }
  }
  g.score += T.score * g.stage;
  const label = `TEAM ${kind}!`;
  if (s.count === 1 || s.count % 10 === 0) g.vfx.banner(s.count === 1 ? 'TEAM COMBO!' : `TEAM COMBO x${s.count}`, `${a.name.toUpperCase()} + ${b.name.toUpperCase()}: ${kind}`, 1.2);
  g.vfx.num(e.x, 2.8 * e.scale, e.z, label, 'score');
  g.vfx.ring(e.x, e.z, 0.6, 3.4, a.color, 0.3);
  g.vfx.ring(e.x, e.z, 0.4, 2.6, b.color, 0.3);
  return true;
}

// ---------------------------------------------------------------- pings

export type PingKind = 'go' | 'danger' | 'help' | 'chest' | 'omw' | 'nice';
export const PING_KINDS: { id: PingKind; label: string; color: string; atHero: boolean }[] = [
  { id: 'go', label: 'GO HERE!', color: '#73eff7', atHero: false },
  { id: 'danger', label: 'DANGER!', color: '#ff5e7a', atHero: false },
  { id: 'help', label: 'NEED HELP!', color: '#ef7d57', atHero: true },
  { id: 'chest', label: 'CHEST!', color: '#ffcd75', atHero: false },
  { id: 'omw', label: 'ON MY WAY!', color: '#a7f070', atHero: true },
  { id: 'nice', label: 'NICE!', color: '#f4f4f4', atHero: true },
];
export const PING_BY_ID = Object.fromEntries(PING_KINDS.map((k) => [k.id, k])) as Record<PingKind, (typeof PING_KINDS)[number]>;

export function pingKind(k: unknown): (typeof PING_KINDS)[number] | null {
  return typeof k === 'string' && k in PING_BY_ID ? PING_BY_ID[k as PingKind] : null;
}

/** Which slice (index into PING_KINDS) a pointer offset (dx right, dy down, px or stick units) selects, or -1 inside the dead zone. Slice 0 is straight up, then clockwise. */
export function wheelSlice(dx: number, dy: number, dead: number, n = PING_KINDS.length): number {
  if (Math.hypot(dx, dy) < dead) return -1;
  const a = Math.atan2(dx, -dy); // 0 = up, clockwise positive
  return ((Math.round(a / ((Math.PI * 2) / n)) % n) + n) % n;
}

interface WheelState {
  held: number;
  open: boolean;
  ox: number;
  oz: number;
  mx: number;
  my: number;
  pick: number;
  ui: PingWheel | null;
  /** 0 = pings, 1 = emotes. */
  page: number;
  /** Test links: held open on screen until closed. */
  pinned?: boolean;
}

/** Mouse-wheel notches while the wheel is open (they flip the page instead of zooming). */
let wheelFlips = 0;
let wheelHooked = false;
function hookWheel(isOpen: () => boolean): void {
  if (wheelHooked || typeof document === 'undefined') return;
  wheelHooked = true;
  // Bubbling at the document runs before the window's camera-zoom listener, so the camera stays put.
  document.addEventListener(
    'wheel',
    (e) => {
      if (!isOpen() || e.deltaY === 0) return;
      e.stopPropagation();
      wheelFlips++;
    },
    { passive: true },
  );
}
const wheels = new WeakMap<Game, WheelState>();

/** Per step (this machine's living hero, co-op): tap = contextual ping, hold = wheel. */
export function pingInput(g: Game): void {
  const input = g.input;
  let w = wheels.get(g);
  if (!w) wheels.set(g, (w = { held: -1, open: false, ox: 0, oz: 0, mx: 0, my: 0, pick: -1, ui: null, page: 0 }));
  const ws = w;
  hookWheel(() => ws.open);
  if (w.pinned) return;
  const down = input.actionDown('ping') || input.padButton(8);
  const p = g.hero.player;
  if (down) {
    if (w.held < 0) {
      // Pressed: remember where it was aimed.
      w.held = 0;
      w.pick = -1;
      w.ox = p.x + p.aim.x * 6;
      w.oz = p.z + p.aim.z * 6;
      if (input.device === 'kbm' && g.mouseAimPoint()) {
        w.ox = g.aimHit.x;
        w.oz = g.aimHit.z;
      }
      w.mx = input.mouse.x;
      w.my = input.mouse.y;
    } else w.held += 1 / 60;
    if (!w.open && w.held >= teamTuning.holdTime) {
      w.open = true;
      if (w.ui && w.ui.key !== emoteWheelKey()) w.ui = (w.ui.destroy(), null); // a season emote was equipped since
      w.ui ??= new PingWheel();
      w.ui.squad(g.squadRun);
      if (!g.squadRun && w.page === 2) w.page = 0;
      w.ui.show(input.device === 'pad' ? innerWidth / 2 : w.mx, input.device === 'pad' ? innerHeight / 2 : w.my);
      w.ui.setPage(w.page);
      wheelFlips = 0;
    }
    if (w.open) {
      // Flip between PINGS and EMOTES; the presses don't reach the game (LB dashes, RB fires the special).
      const flip = input.keyPressed('Tab') || input.padButtonPressed(4) || input.padButtonPressed(5) || wheelFlips > 0;
      wheelFlips = 0;
      input.consumePad(4);
      input.consumePad(5);
      if (flip) {
        w.page = (w.page + 1) % (g.squadRun ? 3 : 2);
        w.ui?.setPage(w.page);
      }
      const n = w.page === 2 ? 4 : w.page === 1 ? emoteWheel().length : PING_KINDS.length;
      w.pick = input.device === 'pad' ? wheelSlice(input.padAim.x, input.padAim.y, teamTuning.pickStick, n) : wheelSlice(input.mouse.x - w.mx, input.mouse.y - w.my, teamTuning.pickPx, n);
      w.ui?.select(w.pick);
    }
    return;
  }
  if (w.held < 0) return;
  // Released.
  if (w.open && w.page === 2) {
    if (w.pick >= 0 && SQUAD_ORDERS[w.pick]) squadOrder(g, SQUAD_ORDERS[w.pick]);
    w.held = -1; w.open = false; w.ui?.hide();
    return;
  }
  const emote = w.open && w.page === 1 && w.pick >= 0 ? emoteWheel()[w.pick] : null;
  if (emote) {
    w.held = -1;
    w.open = false;
    w.ui?.hide();
    if (g.role === 'client') g.client?.send({ t: 'emote', k: emote.id });
    else g.coopEmote(g.hero, emote.id);
    return;
  }
  const kind = w.open && w.page === 0 && w.pick >= 0 ? PING_KINDS[w.pick] : null;
  const wasOpen = w.open;
  w.held = -1;
  w.open = false;
  w.ui?.hide();
  if (wasOpen && !kind) return; // opened, then let go in the middle: cancel
  const x = kind?.atHero ? p.x : w.ox;
  const z = kind?.atHero ? p.z : w.oz;
  if (g.role === 'client') g.client?.send(kind ? { t: 'ping', x, z, k: kind.id } : { t: 'ping', x, z });
  else g.ping(g.hero, x, z, kind?.id);
}

/** Test links / screenshots: open the wheel on a page and keep it there. */
export function pinWheel(g: Game, page: number, pick = 1): void {
  let w = wheels.get(g);
  if (!w) wheels.set(g, (w = { held: -1, open: false, ox: 0, oz: 0, mx: 0, my: 0, pick: -1, ui: null, page: 0 }));
  w.ui ??= new PingWheel();
  w.ui.squad(g.squadRun);
  w.ui.show(innerWidth / 2, innerHeight / 2);
  w.ui.setPage(page);
  w.ui.select(pick);
  w.page = page;
  w.open = w.pinned = true;
}

/** Close the wheel (menus, death, leaving). */
export function closePingWheel(g: Game): void {
  const w = wheels.get(g);
  if (!w) return;
  w.held = -1;
  w.open = w.pinned = false;
  w.ui?.hide();
}
