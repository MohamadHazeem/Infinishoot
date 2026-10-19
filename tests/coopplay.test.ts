/**
 * Coopplay lane, pure rules (src/game/coopplay.ts): co-op objective roll and
 * layout, the door / zones / core / escort steps, the buddy tether, the banter
 * cooldowns, the objective HUD lines, and the banter voice cue.
 */
import { ok } from './check';
import {
  BANTER_LINES,
  BanterBrain,
  COOP_OBJECTIVE_KINDS,
  banterCue,
  banterSample,
  banterTuning,
  coopObjTuning,
  coreStep,
  doorStep,
  escortPercent,
  isCoopKind,
  layoutCoop,
  linkStep,
  linkStrength,
  needHeld,
  pairLinked,
  pickCoopObjective,
  steerCore,
  tetherBonus,
  tetherTuning,
  zonesStep,
} from '../src/game/coopplay';
import { Objective, OBJECTIVE_KINDS } from '../src/game/objectives';

const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

// ---- the roll: seeded, never on solo kinds' list, about `chance` of stages
{
  ok(pickCoopObjective(1234, 3) === pickCoopObjective(1234, 3), 'roll is seeded (same seed and stage, same answer)');
  const counts: Record<string, number> = { none: 0, door: 0, escort: 0, zones: 0, bomb: 0 };
  for (let seed = 0; seed < 400; seed++) for (let st = 1; st <= 5; st++) counts[pickCoopObjective(seed * 7919, st) ?? 'none']++;
  const share = 1 - counts.none / 2000;
  ok(Math.abs(share - coopObjTuning.chance) < 0.06, `about ${coopObjTuning.chance * 100}% of co-op stages roll a co-op objective (${(share * 100).toFixed(1)}%)`);
  ok(COOP_OBJECTIVE_KINDS.every((k) => counts[k] > 200), 'all four co-op kinds come up: ' + JSON.stringify(counts));
  ok(!OBJECTIVE_KINDS.some((k) => isCoopKind(k)), 'solo stages never roll a co-op kind');
  ok(isCoopKind('door') && isCoopKind('bomb') && !isCoopKind('beacon'), 'isCoopKind');
}

// ---- layout on a synthetic field
{
  const spots = [
    { x: 14, z: 0 },
    { x: 0, z: 20 },
    { x: -22, z: 4 },
    { x: 30, z: 26 },
    { x: -30, z: -30 },
    { x: 8, z: -36 },
  ];
  const free = () => true;
  const door = layoutCoop('door', spots, free, 7)!;
  ok(!!door && near(Math.hypot(door.a.x - door.v.x, door.a.z - door.v.z), coopObjTuning.switchGap, 1e-3) && near(Math.hypot(door.b.x - door.v.x, door.b.z - door.v.z), coopObjTuning.switchGap, 1e-3), 'door: a switch either side of the vault');
  ok(Math.hypot(door.a.x - door.b.x, door.a.z - door.b.z) > coopObjTuning.switchRadius * 2 + 8, 'door: one hero can never hold both switches');
  ok(door.v.x === 14 && door.v.z === 0, 'door: the vault takes the spot nearest the middle');
  const esc = layoutCoop('escort', spots, free, 7)!;
  const d = Math.hypot(esc.a.x - esc.b.x, esc.a.z - esc.b.z);
  ok(d >= coopObjTuning.escortMin && d <= coopObjTuning.escortMax, `escort: road length in range (${d.toFixed(1)} m)`);
  ok(Math.hypot(esc.a.x, esc.a.z) <= Math.hypot(esc.b.x, esc.b.z), 'escort: the core starts at the end nearer the middle');
  const zones = layoutCoop('zones', spots, free, 7)!;
  const dz = Math.hypot(zones.a.x - zones.b.x, zones.a.z - zones.b.z);
  ok(dz >= coopObjTuning.zoneGapMin && dz <= coopObjTuning.zoneGapMax, `zones: far enough apart to need two heroes (${dz.toFixed(1)} m)`);
  const bomb = layoutCoop('bomb', spots, free, 7)!;
  const db = Math.hypot(bomb.a.x - bomb.v.x, bomb.a.z - bomb.v.z);
  ok(db >= coopObjTuning.bombGapMin && db <= coopObjTuning.bombGapMax, `bomb: a real walk to the bunker (${db.toFixed(1)} m)`);
  ok(layoutCoop('door', spots, () => false, 7) === null && layoutCoop('escort', [{ x: 10, z: 10 }], free, 1) === null, 'no room: no layout (the stage keeps its solo objective)');
  // A blocked side makes the door turn until both switches are free.
  const blocked = (x: number, z: number) => !(x > 18 && Math.abs(z) < 3);
  const turned = layoutCoop('door', spots, blocked, 3)!;
  ok(!!turned && blocked(turned.a.x, turned.a.z) && blocked(turned.b.x, turned.b.z), 'door: switches avoid blocked ground');
}

// ---- door, zones, core
{
  ok(needHeld(1) === 1 && needHeld(2) === 2 && needHeld(4) === 2, 'pieces to hold: 1 for a lone hero (someone left), else 2');
  let h = 0;
  for (let i = 0; i < 60; i++) h = doorStep(h, 2, 2, 1 / 60);
  ok(near(h, 1, 1e-6) && h < coopObjTuning.holdTime, 'door: both held for a second builds the hold (opens at holdTime)');
  let h2 = 0;
  for (let i = 0; i < 120; i++) h2 = doorStep(h2, 1, 2, 1 / 60);
  ok(h2 === 0, 'door: one switch alone never opens it');
  h = doorStep(1, 1, 2, 0.25);
  ok(near(h, 0.5), 'door: letting go drains the hold twice as fast');
  let z = 0;
  for (let i = 0; i < 600; i++) z = zonesStep(z, 2, 2, false, 1 / 60);
  ok(near(z, 10, 1e-6), 'zones: both held charge 1 s per second');
  const zc = zonesStep(10, 2, 2, true, 1);
  ok(near(zc, 10 + coopObjTuning.zoneContested), 'zones: enemies in a held zone slow it');
  ok(near(zonesStep(10, 1, 2, false, 2), 10 - coopObjTuning.zoneDecay * 2), 'zones: one zone only decays');
  ok(zonesStep(coopObjTuning.zoneTime - 0.01, 2, 2, false, 1) === coopObjTuning.zoneTime, 'zones: capped at the goal');
  ok(near(coreStep(100, 2, 1), 100 - coopObjTuning.coreDrain * 2), 'core: two enemies chew 2x drain');
  ok(near(coreStep(100, 50, 1), 100 - coopObjTuning.coreDrain * coopObjTuning.coreDrainMax), 'core: drain capped at coreDrainMax enemies');
  ok(coreStep(50, 0, 1) > 50 && coreStep(100, 0, 1) === 100, 'core: heals slowly when left alone, up to full');
  ok(coreStep(1, 5, 10) === 0, 'core: can be destroyed');
  ok(near(escortPercent(0, 0, 10, 0, 5, 0), 50) && escortPercent(0, 0, 10, 0, -5, 0) === 0 && escortPercent(0, 0, 10, 0, 10, 0) === 100, 'escort: percent along the road');
  // Steering: straight when free, around a wall when not.
  const s1 = steerCore(0, 0, 10, 0, 1, () => false);
  ok(near(s1.x, 1) && near(s1.z, 0), 'core: rolls straight at the beacon');
  const wall = (x: number, z: number) => x > 0.5 && x < 2 && Math.abs(z) < 0.5;
  let p = { x: 0, z: 0, side: 1 };
  for (let i = 0; i < 60; i++) p = steerCore(p.x, p.z, 10, 0, 0.5, wall, p.side);
  ok(p.x > 5, `core: steers around a block (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  // A long wall across the road: it follows the wall to its end instead of dithering.
  const long = (x: number, z: number) => x > 2 && x < 3 && z > -6 && z < 6;
  p = { x: 0, z: 0, side: 1 };
  for (let i = 0; i < 200; i++) p = steerCore(p.x, p.z, 10, 0, 0.3, long, p.side);
  ok(p.x > 8, `core: follows a long wall around (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  const stuck = steerCore(0, 0, 10, 0, 1, () => true);
  ok(stuck.x === 0 && stuck.z === 0, 'core: boxed in, it waits');
}

// ---- tether
{
  ok(pairLinked(6.9, false) && !pairLinked(7.2, false), 'tether: links within 7 m');
  ok(pairLinked(7.5, true) && !pairLinked(8, true), 'tether: holds up to 7.8 m once linked (no flicker at the edge)');
  ok(linkStrength(0) === 0 && near(linkStrength(0.01), tetherTuning.base, 0.01) && linkStrength(tetherTuning.ramp) === 1 && linkStrength(999) === 1, 'tether: strength base 25% -> 100% over the ramp');
  let t = 0;
  for (let i = 0; i < 600; i++) t = linkStep(t, true, 1 / 60);
  ok(near(t, 10, 1e-6), 'tether: link time grows while linked');
  const b = tetherBonus(t);
  ok(b.damage > tetherTuning.damage * 0.5 && b.damage < tetherTuning.damage && b.regen > 0, `tether: half way the bonus is +${(b.damage * 100).toFixed(1)}% damage, +${b.regen.toFixed(2)} life/s`);
  ok(near(tetherBonus(tetherTuning.ramp).damage, tetherTuning.damage) && near(tetherBonus(tetherTuning.ramp).regen, tetherTuning.regen), 'tether: full bonus at the end of the ramp');
  ok(tetherBonus(0).damage === 0, 'tether: no link, no bonus');
  ok(near(linkStep(10, false, 1), 10 - tetherTuning.decay), 'tether: a broken link drains fast');
  ok(linkStep(0.1, false, 1) === 0 && linkStep(1e9, true, 1) === tetherTuning.ramp * 2, 'tether: link time stays in range');
}

// ---- banter cooldowns and cues
{
  const br = new BanterBrain();
  ok(br.say(0, 'thanks', 0), 'banter: first line plays');
  ok(!br.say(1, 'behind', banterTuning.gap - 0.1), 'banter: nobody talks over the last line (team gap)');
  ok(br.say(1, 'behind', banterTuning.gap + 0.1), 'banter: after the gap another hero can talk');
  ok(!br.can(1, 'greatshot', banterTuning.gap + 0.1 + banterTuning.perHero - 1), 'banter: per-hero gap');
  ok(!br.can(0, 'thanks', banterTuning.perLine - 1), 'banter: the same hero does not repeat a line soon');
  ok(br.can(0, 'thanks', 100), 'banter: ...but can later');
  br.reset();
  ok(br.can(0, 'thanks', 0), 'banter: reset clears it');
  ok(banterSample('dash', 'onmyway') === 'banter_dash_onmyway' && banterSample('mystery', 'thanks') === 'banter_rookie_thanks', 'banter: per-hero samples, unknown heroes use the Rookie');
  ok(banterCue('twin', 'greatshot') === 'v:t:twin:greatshot', 'banter: effects-bus cue');
  ok(BANTER_LINES.length === 6, 'banter: six lines');
}

// ---- Objective with co-op kinds
{
  const door = new Objective('door', 2);
  ok(door.max === 2 && door.title === 'OPEN THE VAULT TOGETHER' && door.count === '0/2 ON' && door.hint.startsWith('One hero'), 'objective: door HUD lines');
  door.cur = 1;
  ok(door.hint.includes('buddy'), 'objective: door asks for a buddy with one switch held');
  const esc = new Objective('escort', 1);
  esc.cur = 42.7;
  esc.attacked = true;
  ok(esc.max === 100 && esc.count === '42%' && esc.hint.includes('Keep enemies off'), 'objective: escort HUD lines');
  const z = new Objective('zones', 1);
  ok(z.max === coopObjTuning.zoneTime && z.count === `0/${coopObjTuning.zoneTime} S`, 'objective: zones HUD lines');
  const bomb = new Objective('bomb', 1);
  bomb.charging = true;
  ok(bomb.hint.includes('bunker'), 'objective: bomb points at the bunker');
  bomb.boss = true;
  ok(bomb.hint.includes('boss'), 'objective: ...or at the boss while one is up');
  ok(bomb.progress() && bomb.state === 'done' && bomb.count === 'BOOM', 'objective: bomb completes in one go');
  const n = door.net();
  const copy = new Objective('door', 2);
  copy.setNet(n);
  ok(copy.cur === 1 && copy.state === 'active', 'objective: net round trip');
}

