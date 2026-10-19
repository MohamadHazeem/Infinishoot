/**
 * Cinematics lane: tuning and pure rules (no DOM, no three.js) for the
 * sky-falling stage transition, the painterly ending after Omega, the
 * legendary weapon reveal, the jackpot chest, the flawless-stage reward and
 * the playable title screen. Game methods live in src/game/systems/cinematics.ts,
 * overlays in src/ui/cinematicsUi.ts, 3D pieces in src/game/cineWorld.ts.
 *
 * SETTINGS > CINEMATICS picks FULL, SHORT or OFF. REDUCE FLASHING (or the OS
 * reduced-motion switch) plays the short versions without shakes or flashes.
 */
import type { Rng } from '../core/rng';
import { loadJson, saveJson } from '../core/storage';

export type CineLevel = 'full' | 'short' | 'off';

/** Pins every cinematic at a progress 0..1 (screenshots; -1 = off). */
export const cineDebug = { pin: -1 };

/** Sky-falling transition between stages (replaces the 0.8 s portal fade). */
export const skyfallTuning = {
  /** Lengths (s) of the whole thing, the leap into the portal (the cut) and the touchdown. */
  full: { len: 3.6, cut: 0.7, land: 3.0 },
  short: { len: 2.0, cut: 0.4, land: 1.65 },
  /** Height (m) the fall starts from (full / short). */
  top: 60,
  topShort: 28,
  /** Fall curve: height = top * (1 - u)^exp (above 1: fastest out of the portal). */
  exp: 1.3,
  /** Camera during the fall: distance (m), pitch (deg) and how far it turns around the hero (rad). */
  camDist: 6,
  camPitch: 74,
  camYaw: 0.7,
  /** Camera field of view (deg) while falling. */
  fov: 60,
  /** The leap: arc height (m) and the hero shrinking into the portal from this fraction on. */
  leapArc: 2.2,
  leapShrinkFrom: 0.6,
  /** Seconds before touchdown the camera starts handing back to the follow camera. */
  handBack: 0.7,
  /** Arena assembly: starts this fraction into the fall; a tile drops in over `tileRise` s from `tileDrop` m up. */
  assembleFrom: 0.35,
  tileRise: 0.42,
  tileDrop: 1.8,
  /** Props rise from this far below (m), over `propRise` s. */
  propDrop: 5,
  propRise: 0.55,
  /** Clouds: how many puffs, and the wind streak count. */
  clouds: 46,
  streaks: 28,
  /** Landing dust and shake. */
  dust: 46,
  shake: 0.35,
  /** Skips are ignored for this long (s): keys tapped while walking into the portal don't skip it. */
  minSkip: 0.5,
};

/** The painterly ending after the final boss. */
export const endingTuning = {
  /** Seconds into the VICTORY clear before the ending starts (the K.O., VICTORY! and fireworks play first). */
  delay: 1.6,
  /** Seconds per panel (full; SHORT halves them) and the cross-fade between panels. */
  panel: 3.1,
  fade: 0.7,
  /** The last card ("THE END?") holds this long. */
  endCard: 3.4,
  /** Ken Burns: how much a panel zooms in over its time. */
  zoom: 0.06,
  /** Painted canvas size (CSS scales it up smoothly). */
  width: 480,
  height: 270,
  /** Brush strokes per painted area (more = denser paint, slower to paint). */
  strokes: 1.0,
  minSkip: 0.5,
};

/** First legendary item in a run (or one never revealed on this machine): it descends in a beam of light. */
export const revealTuning = {
  /** Lengths (s): full, short, and online (local only, the world keeps running). */
  full: 2.7,
  short: 1.5,
  online: 1.9,
  /** Fraction of the length when the item lands on the hero (light burst, sound). */
  landAt: 0.45,
  /** The item starts this many metres above the hero. */
  height: 9,
  /** Camera: closer by this fraction at the peak. */
  zoom: 0.35,
  /** Seconds the music drops out. */
  silence: 1.4,
  minSkip: 0.35,
};

/** The jackpot chest: a rare golden map chest with a full-screen slot machine. */
export const jackpotTuning = {
  /** Chance that a map chest spawn is a golden one instead. */
  chance: 0.07,
  /** At most this many golden chests a stage. */
  perStage: 1,
  /** Payout: share of jackpots that are a pile of gold (the rest pay `items` chest items). */
  goldShare: 0.4,
  gold: 30,
  goldPerStage: 12,
  items: 3,
  /** Reel lengths (s): full and short; the reels stop at these fractions. */
  full: 3.8,
  short: 2.1,
  stops: [0.3, 0.45, 0.62] as [number, number, number],
  /** Online: the opener is untouchable while their reels spin (the world keeps going). */
  onlineIframes: 2.4,
  /** Gold-pile coins flying to the HUD gold counter. */
  coins: 34,
  minSkip: 0.35,
};

/** Clearing a stage without a hit: confetti, FLAWLESS! and a golden portal to a bonus. */
export const flawlessTuning = {
  /** Confetti pieces and how long the moment lasts (s). */
  confetti: 140,
  time: 3.2,
  /** Golden route bonus at the next stage: gold for every hero, a treasure chest each, and a chance of a relic. */
  gold: 15,
  goldPerStage: 5,
  relicChance: 0.35,
  /** How close a hero must be to take the golden portal (m). */
  enter: 1.3,
};

/** Playable title screen: WASD / left stick takes the demo hero, idle hands it back to the bot. */
export const titlePlayTuning = {
  enabled: true,
  /** Seconds without input before the autoplay bot takes the hero back. */
  idle: 5,
  /** Stick deflection that counts as taking control. */
  stick: 0.35,
};

// ---------------------------------------------------------------- skyfall

export interface SkyTimes {
  len: number;
  cut: number;
  land: number;
}

export function skyTimes(level: CineLevel): SkyTimes {
  return level === 'short' ? skyfallTuning.short : skyfallTuning.full;
}

export type SkyPhase = 'leap' | 'fall' | 'land' | 'done';

/** Where in the transition we are: phase and progress 0..1 within it. */
export function skyPhase(t: number, T: SkyTimes): { phase: SkyPhase; k: number } {
  if (t < T.cut) return { phase: 'leap', k: Math.max(0, t / T.cut) };
  if (t < T.land) return { phase: 'fall', k: (t - T.cut) / (T.land - T.cut) };
  if (t < T.len) return { phase: 'land', k: (t - T.land) / (T.len - T.land) };
  return { phase: 'done', k: 1 };
}

/** Height of the falling hero (m) at fall progress u (0 = out of the portal, 1 = touchdown). */
export function fallHeight(u: number, top: number): number {
  const c = Math.max(0, Math.min(1, u));
  return top * Math.pow(1 - c, skyfallTuning.exp);
}

/** The leap into the portal: position along the way 0..1, height of the arc, and the hero's scale. */
export function leapPose(k: number): { along: number; y: number; scale: number } {
  const c = Math.max(0, Math.min(1, k));
  const along = 1 - Math.pow(1 - c, 2);
  // Up in an arc, then into the ring's middle (1.5 m up).
  const y = Math.sin(Math.PI * Math.min(1, c * 1.1)) * skyfallTuning.leapArc + c * 1.5;
  const s0 = skyfallTuning.leapShrinkFrom;
  const scale = c < s0 ? 1 : Math.max(0.05, 1 - (c - s0) / (1 - s0));
  return { along, y, scale };
}

/** How thick the cloud layer is at fall progress u: a white-out at the cut that thins as the ground comes up. */
export function cloudCover(u: number): number {
  if (u < 0) return 0;
  if (u < 0.08) return 1;
  return Math.max(0, 1 - (u - 0.08) / 0.42);
}

/** Seconds into the transition a tile (or prop) at distance d from the landing spot starts rising. */
export function assemblyDelay(d: number, T: SkyTimes, maxDist = 60): number {
  const from = T.cut + (T.land - T.cut) * skyfallTuning.assembleFrom;
  const to = T.len - skyfallTuning.tileRise;
  return from + Math.min(1, Math.max(0, d / maxDist)) * (to - from);
}

/** A tile's height offset (m, below 0 = still sunk) `since` seconds after its delay; a little overshoot. */
export function riseOffset(since: number, drop: number, dur: number): number {
  if (since <= 0) return -drop;
  const k = Math.min(1, since / dur);
  if (k >= 1) return 0;
  // Ease out with a small pop above the ground before it settles.
  const e = 1 - Math.pow(1 - k, 3);
  return -drop * (1 - e) + Math.sin(k * Math.PI) * 0.18 * (1 - k);
}

// ---------------------------------------------------------------- ending

export interface EndingPanel {
  id: 'fall' | 'calm' | 'lookout' | 'end';
  caption: string;
}

export const ENDING_PANELS: readonly EndingPanel[] = [
  { id: 'fall', caption: 'THE OVERLORD FALLS.' },
  { id: 'calm', caption: 'ONE BY ONE, THE ISLANDS GO QUIET.' },
  { id: 'lookout', caption: 'BUT OUT PAST THE HORIZON, SOMETHING STIRS...' },
  { id: 'end', caption: '' },
];

export function endingLength(short: boolean): number {
  const T = endingTuning;
  const p = short ? T.panel * 0.55 : T.panel;
  return p * (ENDING_PANELS.length - 1) + (short ? T.endCard * 0.6 : T.endCard);
}

/** Which panel shows at t, how far into it (0..1), and the fade into the next one (0..1). */
export function endingFrame(t: number, short: boolean): { panel: number; k: number; fade: number; done: boolean } {
  const T = endingTuning;
  const p = short ? T.panel * 0.55 : T.panel;
  const last = ENDING_PANELS.length - 1;
  const len = endingLength(short);
  if (t >= len) return { panel: last, k: 1, fade: 0, done: true };
  const i = Math.min(last, Math.floor(t / p));
  const dur = i === last ? len - last * p : p;
  const k = Math.min(1, (t - i * p) / dur);
  const f = short ? T.fade * 0.6 : T.fade;
  const fade = i < last ? Math.max(0, Math.min(1, (t - (i * p + p - f)) / f)) : 0;
  return { panel: i, k, fade, done: false };
}

// ---------------------------------------------------------------- legendary reveal

/** One legendary thing a hero owns: an item, a fusion or an evolution. */
export interface RevealItem {
  /** Unique per item (and per evolution branch): w:<id>, e:<id>:<branch>, p:<id>. */
  key: string;
  /** Pixel icon id, name, colour, short label for the title card. */
  icon: string;
  glyph: string;
  name: string;
  color: string;
  label: string;
  text: string;
}

const SEEN_KEY = 'cine.revealed.v1';
let seen: Set<string> | null = null;

function seenSet(): Set<string> {
  seen ??= new Set(loadJson<string[]>(SEEN_KEY, []));
  return seen;
}

/** Revealed on this machine before (any run). */
export function revealedBefore(key: string): boolean {
  return seenSet().has(key);
}

export function markRevealed(key: string): void {
  const s = seenSet();
  if (s.has(key)) return;
  s.add(key);
  saveJson(SEEN_KEY, [...s]);
}

/** Forget the reveal history (tests). */
export function resetRevealed(): void {
  seen = new Set();
  saveJson(SEEN_KEY, []);
}

/** Should a newly gained legendary play the reveal? The first one of a run always does, later ones only if never seen. */
export function shouldReveal(firstOfRun: boolean, key: string): boolean {
  return firstOfRun || !revealedBefore(key);
}

// ---------------------------------------------------------------- jackpot

export interface JackpotPlan {
  kind: 'gold' | 'items';
  gold: number;
  items: number;
}

/** Decide a jackpot's payout (host, seeded RNG). */
export function jackpotPlan(rng: Rng, stage: number): JackpotPlan {
  const T = jackpotTuning;
  if (rng.next() < T.goldShare) return { kind: 'gold', gold: Math.round(T.gold + T.goldPerStage * stage), items: 0 };
  return { kind: 'items', gold: 0, items: T.items };
}

/** Seconds the reel machine plays for, and when each of the 3 reels stops. */
export function reelTimes(short: boolean): { len: number; stops: [number, number, number] } {
  const len = short ? jackpotTuning.short : jackpotTuning.full;
  const s = jackpotTuning.stops;
  return { len, stops: [s[0] * len, s[1] * len, s[2] * len] };
}

/**
 * A reel's scroll position (in symbols) at t: spins fast, then eases onto `target`
 * (an index into the strip) at `stop`. Never moves backwards.
 */
export function reelScroll(t: number, stop: number, target: number, speed = 14): number {
  if (t >= stop) return target;
  // Constant speed, then the last 0.35 s ease out onto the target (from target - spin distance).
  const ease = Math.min(0.35, stop);
  const spinEnd = stop - ease;
  const easeDist = (speed * ease) / 2;
  const startAt = target - easeDist - speed * spinEnd;
  if (t < spinEnd) return startAt + speed * t;
  const u = (t - spinEnd) / ease;
  return startAt + speed * spinEnd + easeDist * (1 - (1 - u) * (1 - u));
}

/** Chasing frame lights: bulb i of n is lit at time t. */
export function bulbLit(i: number, n: number, t: number, win: boolean): boolean {
  if (win) return Math.floor(t * 8) % 2 === i % 2;
  const head = Math.floor(t * 30) % n;
  const d = (head - i + n) % n;
  return d < 4 || d % 9 === 0;
}

// ---------------------------------------------------------------- flawless

/** Golden route bonus gold per hero at stage `stage`. */
export function goldenGold(stage: number): number {
  return Math.round(flawlessTuning.gold + flawlessTuning.goldPerStage * stage);
}

/** A confetti piece's position 0..1 across the screen at t (deterministic from its index). */
export function confettiAt(i: number, t: number): { x: number; y: number; spin: number; hue: number } {
  const r = (n: number) => {
    const s = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  // Two cannons from the bottom corners, then a slow flutter down.
  const left = i % 2 === 0;
  const vx = (0.25 + r(1) * 0.45) * (left ? 1 : -1);
  const vy = 1.1 + r(2) * 0.7;
  const g = 1.6;
  const tt = Math.max(0, t - r(3) * 0.35);
  const fall = Math.max(0, tt - vy / g);
  const x = (left ? 0.02 : 0.98) + vx * Math.min(tt, 1.2) * 0.6 + Math.sin(tt * (3 + r(4) * 4) + i) * 0.02;
  const up = vy * Math.min(tt, vy / g) - 0.5 * g * Math.min(tt, vy / g) ** 2;
  const y = 1.02 - up * 0.75 + fall * (0.12 + r(5) * 0.08);
  return { x, y, spin: tt * (4 + r(6) * 8), hue: Math.floor(r(7) * 6) };
}
