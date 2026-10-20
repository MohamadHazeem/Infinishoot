/**
 * heroes4 lane: pure state and tuning for the Medic (healer) and the Brawler
 * (melee grappler). The Game side is src/game/systems/heroes4.ts; the clicks
 * are src/game/weapons/medbeam.ts, revdrone.ts, fists.ts and grab.ts; the
 * ultimates src/game/heroes4Ults.ts.
 *
 * - Medic: a mending beam that damages enemies and heals teammates it passes
 *   through (and mends the Medic per hit), a revive drone that picks a downed
 *   teammate up from range (or shields), a regeneration aura for teammates,
 *   and Field Hospital: a zone that heals, cleanses and keeps allies at 1 life.
 * - Brawler: a 3-punch combo whose haymaker launches enemies, a grab that
 *   carries and throws an enemy through the crowd (bosses: an uppercut), a
 *   shoulder-charge dash, and Wrecking Ball. Launched and thrown enemies keep a
 *   high knockback speed, so lava, thorns, ice walls and pillars finish them.
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { Hero } from './hero';
import type { HeroRig } from './heroModel';

export const heroes4Tuning = {
  medic: {
    auraR: 6, // teammates within this many metres of the Medic regenerate...
    auraRegen: 2, // ...this much life per second (never the Medic itself)
    leechCap: 8, // the beam mends the Medic at most this much life per second
    beamBoss: 1.75, // bosses and mini-bosses take x this from the beam (the Medic's right click deals no damage, so no Expose)
    droneSpeed: 26, // m/s, flying to a downed teammate
    shieldOrbit: 1.25, // m, the shield drone circles its hero
    aimPick: 4, // m: a shield goes to the living teammate this close to the cursor (else the Medic)
    surgeEvery: 6, // Surge Beam: a lightning chain every Nth tick...
    surgeHops: 2, // ...this many hops...
    surgeDmg: 1.5, // ...at this x the tick damage
    lifelineSlow: 0.35,
    guardianDmg: 3, // Guardian Drone: x typical enemy life on the attacker per blocked hit
    guardianR: 3, // and its neighbours this close
    phoenixHeal: 0.3, // Phoenix Drone: share of max life to everyone near the revived hero...
    phoenixR: 6, // ...within this radius; the burst burns enemies (x typical life)
    phoenixBurn: 2,
    lowLife: 0.2, // Lifesaver: clear a stage after dropping below this share of life in it
  },
  brawler: {
    comboReset: 0.7, // seconds without a punch before the combo starts over
    hayRecover: 1.3, // x punch interval after the haymaker
    hayReach: 0.4, // extra reach on the haymaker (m)
    hayStop: 0.07, // hit-stop when the haymaker lands
    hayStagger: 0.45, // s of heavy slow on non-bosses the haymaker hits
    launchMax: 34, // m/s cap on a launch (keeps flights on screen)
    quakeDmg: 0.6, // haymaker shockwave: x the punch damage
    thunderHops: 3, // Thunder Fists: chain hops from the haymaker...
    thunderDmg: 0.8, // ...at this x the haymaker damage
    slamDmg: 1.2, // Meteor Fist: slam blast x the haymaker damage
    holdDist: 1.3, // a held enemy hangs this far in front of the Brawler (+ its radius)
    swingR: 2.4, // Giant Swing: radius of the spin...
    swingSpeed: 9, // ...rad/s...
    swingDmg: 0.6, // ...and x the throw damage per enemy it smashes (each once per 0.4 s)
    throwHitR: 0.9, // a thrown enemy hits others this close (+ radii)
    throwKnock: 16, // and knocks them this hard
    wallDmg: 1.5, // x throw damage to the thrown enemy when it slams into a wall or cover
    landDmg: 1, // x throw damage to the thrown enemy when it lands
    toyDmg: 60, // damage to cover / pillars / barrels a thrown enemy or a charge hits
    boomR: 3, // Piledriver blast radius
    chargeDmg: 22, // shoulder charge: base damage (then the Brawler's stats)...
    chargeR: 1.35, // ...to enemies this close while dashing...
    chargeKnock: 22, // ...knocked this hard along and away from the charge
    envKills: 20, // Wrecking Crew achievement
  },
  hospital: {
    // Field Hospital (Medic ultimate)
    radius: 7,
    healPerSec: 0.1, // share of max life per second inside
    pulse: 0.5, // s between pulses (damage to enemies inside)
    pulseDmg: 1, // x typical enemy life per pulse (bosses take ultTuning.bossMul)
    slow: 0.4, // enemies inside crawl
    floorGrace: 1, // the 1-life floor lasts this long after the zone closes
    reviveAfter: 1.5, // downed teammates inside get up after this many seconds in the zone
  },
  wrecking: {
    // Wrecking Ball (Brawler ultimate)
    speed: 1.7, // x movement speed
    poundR: 6, // the opening ground pound
    poundDmg: 3, // x typical enemy life
    r: 2.6, // the spin smashes everything this close...
    dmg: 3.5, // ...for this x typical enemy life...
    rehit: 0.35, // ...at most every this many seconds per enemy...
    knock: 32, // ...and launches it
    pull: 9, // m/s: enemies within pullR drift into the spin
    pullR: 7,
  },
};

const M = heroes4Tuning.medic;
const B = heroes4Tuning.brawler;

/** Distance from point (px, pz) to the segment (ax, az)-(bx, bz), and how far along it (0..1). */
export function segPoint(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return { d: Math.hypot(px - (ax + vx * t), pz - (az + vz * t)), t };
}

/** Is a circle (x, z, r) on the beam from (ax, az) along angle a for `len` m with half-width w? */
export function onBeam(x: number, z: number, r: number, ax: number, az: number, a: number, len: number, w: number): boolean {
  const s = segPoint(x, z, ax, az, ax + Math.cos(a) * len, az + Math.sin(a) * len);
  return s.d <= w + r && s.t > 0;
}

/** Life the beam may mend the Medic with: `leech` of the damage, within this second's budget. */
export function leechHeal(dealt: number, leech: number, used: number): number {
  return Math.max(0, Math.min(dealt * leech, M.leechCap - used));
}

/** Combo step after `step` (-1 = none), given the seconds since the last punch. */
export function nextPunch(step: number, idle: number): number {
  return step < 0 || step >= 2 || idle > B.comboReset ? 0 : step + 1;
}

/** Punch k (0 jab, 1 cross, 2 haymaker): reach, arc (deg), damage x, knockback (m/s). */
export function punchShape(p: Record<string, number>, k: number, area: number, knockMul: number): { reach: number; arc: number; mul: number; knock: number } {
  const hay = k === 2;
  return {
    reach: (p.reach + (hay ? B.hayReach : 0)) * Math.sqrt(area),
    arc: hay ? Math.min(360, p.arc * 1.25) : p.arc,
    mul: hay ? p.finisher : 1,
    knock: Math.min(B.launchMax, p.knock * (hay ? p.launch : 1) * knockMul),
  };
}

/** Can this enemy be grabbed (not bosses, mini-bosses, the Reaper, hidden PvP stand-ins or burrowed sharks)? */
export function grabbable(e: { def: { boss?: boolean; miniboss?: unknown; behavior: string; hidden?: boolean }; pvpOwner: number; under?: boolean }): boolean {
  return !e.def.boss && !e.def.miniboss && e.def.behavior !== 'reaper' && !e.def.hidden && e.pvpOwner < 0 && !e.under;
}

/** Revive drone: whom it should fly to. The downed teammate closest to the cursor within range of the Medic. */
export function pickDowned<T extends { x: number; z: number; ok: boolean }>(list: readonly T[], mx: number, mz: number, cx: number, cz: number, range: number): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const h of list) {
    if (!h.ok || (h.x - mx) ** 2 + (h.z - mz) ** 2 > range * range) continue;
    const d = (h.x - cx) ** 2 + (h.z - cz) ** 2;
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

/**
 * The 1-life floor and shields (hurtHero): how much of a hit lands.
 * `shield` hits left on this hero's drone shield, `floor` true inside Field Hospital.
 */
export function hitAfterCare(dmg: number, hp: number, shield: number, floor: boolean): { dmg: number; blocked: boolean; saved: boolean } {
  if (shield > 0) return { dmg: 0, blocked: true, saved: false };
  if (floor && dmg >= hp) return { dmg: Math.max(0, Math.ceil(hp) - 1), blocked: false, saved: true };
  return { dmg, blocked: false, saved: false };
}

/**
 * Game services the ultimates need without importing the systems layer (tests
 * import the ultimates headless): set by src/game/systems/heroes4.ts.
 */
export const heroes4Hooks = {
  /** A hero's big-hit hit-stop (systems/skill.ts heroHitStop). */
  stop: (_g: Game, _h: Hero, _seconds: number): void => {},
  /** Field Hospital opened at (x, z) for `seconds` by hero `h`. */
  hospital: (_g: Game, _h: Hero, _x: number, _z: number, _seconds: number): void => {},
};

/**
 * Autopilot (dev bot, co-op drop-out autopilot): the Brawler fights a boss up
 * close (hit and run), like the Ronin, so the melee kit gets used.
 */
export function pilotHeroes4(mech: string | undefined, px: number, pz: number, mv: { mx: number; mz: number }, boss: { x: number; z: number; radius: number; state?: string } | null, ring: { x: number; z: number; r: number } | null = null): void {
  if (mech !== 'brawler' || !boss) return;
  const dx = px - boss.x;
  const dz = pz - boss.z;
  const d = Math.hypot(dx, dz) || 1;
  const busy = boss.state === 'windup' || boss.state === 'attack';
  // Just inside fist reach (it counts the boss's radius) while it walks or recovers, well clear while it winds up or attacks.
  const want = (boss.radius + (busy ? 6 : 1.8) - d) * 0.6;
  mv.mx = mv.mx * 0.5 + (-dz / d) * 0.7 + (dx / d) * want;
  mv.mz = mv.mz * 0.5 + (dx / d) * 0.7 + (dz / d) * want;
  // A boss duel's ring of fire (src/game/bossDuel.ts): backing off never leaves it.
  if (ring) {
    const rx = px - ring.x;
    const rz = pz - ring.z;
    const rd = Math.hypot(rx, rz) || 1;
    const over = rd - (ring.r - 2);
    if (over > 0) {
      mv.mx -= (rx / rd) * (1 + over);
      mv.mz -= (rz / rd) * (1 + over);
    }
  }
}

// ---------------------------------------------------------------- gear (silhouettes)

type Put = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, name?: string) => THREE.Mesh;

/**
 * The Medic's and the Brawler's accessories, added by attachHeroGear
 * (src/game/heroMechs.ts) through its `put`/`mat` helpers.
 * - Medic: a white field cap with a red cross, a head mirror, a white med pack
 *   with a red cross and a green beam lens on the arm cannon.
 * - Brawler: big red boxing gloves, a yellow headband with tails, a spiky
 *   crest and a gold champion belt.
 */
export function heroes4Gear(rig: HeroRig, mech: string | undefined, mat: (color: string, unlit?: number) => THREE.Material, put: Put): void {
  if (mech === 'medic') {
    const white = mat('#f4f4f4');
    const red = mat('#b13e53', 0.4);
    const mint = mat('#a7f070', 0.7);
    const steel = mat('#94b0c2', 0.5);
    // Field cap: a white band round the helmet with a red cross on the front, and a small white
    // crown with a red cross on top (the camera looks down, so the top cross is what reads).
    put(rig.head, new THREE.CylinderGeometry(0.47, 0.49, 0.1, 10), white, 0, 0.28, 0);
    put(rig.head, new THREE.BoxGeometry(0.2, 0.06, 0.04), red, 0, 0.29, 0.48);
    put(rig.head, new THREE.BoxGeometry(0.06, 0.18, 0.04), red, 0, 0.29, 0.48);
    put(rig.head, new THREE.CylinderGeometry(0.26, 0.3, 0.1, 10), white, 0, 0.55, -0.02);
    put(rig.head, new THREE.BoxGeometry(0.3, 0.04, 0.09), red, 0, 0.61, -0.02);
    put(rig.head, new THREE.BoxGeometry(0.09, 0.04, 0.3), red, 0, 0.61, -0.02);
    // A head mirror on the band, tipped up.
    put(rig.head, new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10).rotateX(1.2), steel, 0.3, 0.42, 0.33, 'mirror');
    // A white med pack with a red cross and two little antennae.
    put(rig.body, new THREE.BoxGeometry(0.5, 0.48, 0.26), white, 0, 1.0, -0.33);
    put(rig.body, new THREE.BoxGeometry(0.26, 0.08, 0.03), red, 0, 1.02, -0.47);
    put(rig.body, new THREE.BoxGeometry(0.08, 0.26, 0.03), red, 0, 1.02, -0.47);
    put(rig.body, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4), steel, 0.17, 1.4, -0.33);
    put(rig.body, new THREE.SphereGeometry(0.05, 6, 4), mint, 0.17, 1.62, -0.33, 'lamp');
    // A green lens ring on the arm cannon (the beam comes out of it).
    put(rig.armR, new THREE.CylinderGeometry(0.17, 0.17, 0.08, 10), mint, 0.04, -0.72, 0);
  } else if (mech === 'brawler') {
    const glove = mat('#b13e53');
    const cuff = mat('#f4f4f4');
    const band = mat('#ffcd75', 0.3);
    const gold = mat('#ffcd75', 0.45);
    const dark = mat('#333c57');
    // Big boxing gloves on both fists (the arms hang down: -Y is the hand).
    for (const arm of [rig.armR, rig.armL]) {
      put(arm, new THREE.SphereGeometry(0.26, 8, 6).scale(1, 1.1, 1.05), glove, 0.03, -0.8, 0.03, arm === rig.armR ? 'gloveR' : 'gloveL');
      put(arm, new THREE.CylinderGeometry(0.17, 0.17, 0.12, 8), cuff, 0.03, -0.58, 0.02);
    }
    // A headband with two tails flying back, and a spiky crest.
    put(rig.head, new THREE.CylinderGeometry(0.45, 0.46, 0.09, 10), band, 0, 0.22, 0);
    put(rig.head, new THREE.BoxGeometry(0.08, 0.04, 0.42).rotateX(-0.45).rotateY(0.25), band, 0.12, 0.2, -0.56);
    put(rig.head, new THREE.BoxGeometry(0.07, 0.04, 0.34).rotateX(-0.65).rotateY(-0.2), band, -0.1, 0.18, -0.5);
    for (let i = 0; i < 3; i++) put(rig.head, new THREE.ConeGeometry(0.1, 0.34, 4).rotateX(-0.5), dark, (i - 1) * 0.15, 0.62, -0.08 - Math.abs(i - 1) * 0.06);
    // A gold champion belt.
    put(rig.body, new THREE.BoxGeometry(0.64, 0.12, 0.46), dark, 0, 0.8, 0);
    put(rig.body, new THREE.BoxGeometry(0.3, 0.2, 0.06), gold, 0, 0.8, 0.24);
  }
}

/** Is this hero mechanic one of this lane's (gear merge, net)? */
export function isHeroes4(mech: string | undefined): boolean {
  return mech === 'medic' || mech === 'brawler';
}
