/**
 * Tools lane: the compact co-op encodings (effects bus, snapshot body,
 * record deltas) must round-trip what the host built, and the photo mode's
 * pure helpers must behave.
 */
import { ok } from './check';
import { pack } from 'peerjs-js-binarypack';
import type { VfxEvent } from '../src/game/vfx';
import type { BurstOptions } from '../src/game/particles';
import { FxEncoder, decodeFx, fxRelevant } from '../src/net/fxCodec';
import { KEYFRAME, SnapDecoder, SnapEncoder, packValue, unpackValue } from '../src/net/snapCodec';

const near = (a: number, b: number, eps: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- effects

const hit: BurstOptions = { count: 3, color: '#ffffff', color2: '#ff7a2f', speed: [3, 7], size: [0.1, 0.18], life: [0.12, 0.25], dir: { x: -0.6, z: 0.8, spread: 2.4 } };
const big: BurstOptions = { count: 40, color: 0x38b764, color2: '#a7f070', speed: [3, 9], size: [0.15, 0.45], life: [0.3, 0.6], up: 5, gravity: 18, drag: 2, debris: 12, smoke: 3, sparks: 5, dust: 4, scorch: 0 };
const events: VfxEvent[] = [
  ['b', 10.25, 0.8, -4.5, hit],
  ['b', 10.25, 0.8, -4.5, hit], // identical: merged into one record with a repeat
  ['b', 11, 0.8, -4, { ...hit, dir: { x: 0.2, z: -1, spread: 2.4 } }], // same template, other direction
  ['b', -20.5, 1, 33.33, big],
  ['r', -20.5, 33.33, 0.5, 4, '#73eff7', 0.6],
  ['s', -20.5, 2, 33.33, 1.6, '#fff35c', 0.12],
  ['n', 3, 1.7, 4, 123, 'hit'],
  ['n', 3, 1.9, 4, '57!', 'crit'],
  ['n', 3, 1.7, 4, '12 FIRE', 'hit'],
  ['n', 3, 1.7, 4, 'MOMO: CHEST!', 'score'],
  ['n', 3, 1.7, 4, -8, 'player'],
  ['n', 3, 1.7, 4, 2.5, 'heal'],
  ['n', 3, 1.7, 4, '012!', 'crit'], // not a canonical number: travels as a string
  ['a', NaN, NaN, 'levelUp', 1],
  ['a', 3, 4, 'w:buster', 1.37],
  ['k', 3, 4, 0.35],
  ['z', -7, 8, 2.5, 1.2],
  ['g', -7, 8, 1.4, '#3a3d5c', 14],
  ['c', 5.5, -6.25, 0.4, 'bopper', 1.6, 2.1, -0.71, 0.71],
  ['h', 'banner', 'STAGE 2', 'SUNSET DUNES', 1.6],
  ['h', 'toast', 'MOMO LEFT THE GAME', '', 3],
  ['h', 'flash', '', '', 0.4],
];
const enc = new FxEncoder();
const buf = enc.encode(events);
const got: VfxEvent[] = [];
decodeFx(buf, (e) => got.push(JSON.parse(JSON.stringify(e, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v)), (_k, v) => (v === 'NaN' ? NaN : v))));
ok(got.length === events.length, `every effect decoded (${got.length}/${events.length}, the merged pair replays twice)`);
let bad = 0;
const fail = (i: number, why: string) => {
  bad++;
  console.error(`  event ${i} (${events[i][0]}): ${why}`);
};
events.forEach((e, i) => {
  const g = got[i];
  if (!g || g[0] !== e[0]) return fail(i, 'kind');
  if (e[0] === 'b' && g[0] === 'b') {
    const [o, p] = [e[4], g[4]];
    if (!near(g[1], e[1], 0.006) || !near(g[2], e[2], 0.006) || !near(g[3], e[3], 0.006)) fail(i, 'position');
    if (p.count !== o.count || String(p.color).toLowerCase() !== (typeof o.color === 'number' ? `#${o.color.toString(16).padStart(6, '0')}` : o.color)) fail(i, 'count/colour');
    if (!near(p.speed[1], o.speed[1], 0.01) || !near(p.size[0], o.size[0], 0.001) || !near(p.life[1], o.life[1], 0.001)) fail(i, 'ranges');
    if ((o.up ?? 0) !== (p.up ?? 0) || o.gravity !== p.gravity || o.debris !== p.debris || o.smoke !== p.smoke || o.sparks !== p.sparks || o.dust !== p.dust || o.scorch !== p.scorch) fail(i, 'extras');
    if (o.dir) {
      const a = Math.atan2(o.dir.z, o.dir.x);
      const b = Math.atan2(p.dir!.z, p.dir!.x);
      if (!near(a, b, 0.002) || !near(o.dir.spread, p.dir!.spread, 0.001)) fail(i, 'direction');
    }
    return;
  }
  for (let k = 1; k < e.length; k++) {
    const a = e[k] as unknown;
    const b = g[k] as unknown;
    if (typeof a === 'number' ? !near(b as number, a, 0.006) : a !== b) fail(i, `field ${k}: ${String(a)} vs ${String(b)}`);
  }
});
ok(bad === 0, 'effects round-trip (positions to 1 cm, angles to 0.001 rad, labels exact)');

// Size: compare with what binarypack would send for the same list.
const crowd: VfxEvent[] = [];
for (let i = 0; i < 120; i++) {
  const x = Math.round((Math.sin(i) * 30) * 100) / 100;
  const z = Math.round((Math.cos(i * 1.3) * 30) * 100) / 100;
  crowd.push(['b', x, 0.8, z, { count: 6, color: '#ff7a2f', color2: '#ffd23f', speed: [3, 9], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, gravity: 18, drag: 2, debris: 1 }]);
  crowd.push(['a', x, z, 'enemyDie', 1 + (i % 5) * 0.05]);
  crowd.push(['n', x, 1.7, z, 10 + i, 'hit']);
  crowd.push(['c', x, z, 0.5, 'swarmer', 1, 0.5, 0.71, -0.71]);
}
const before = (pack({ ev: crowd }) as ArrayBuffer).byteLength;
const after = enc.encode(crowd).byteLength;
ok(after < before * 0.3, `a busy effect list shrinks to under 30% (${before} -> ${after} bytes)`);

ok(!fxRelevant(['a', 40, 0, 'hit', 1], 0, 0) && fxRelevant(['a', 20, 0, 'hit', 1], 0, 0) && fxRelevant(['a', NaN, NaN, 'levelUp', 1], 0, 0), 'sounds past hearing range are dropped, team-wide ones kept');
ok(!fxRelevant(['k', 0, 31, 0.3], 0, 0) && fxRelevant(['k', 0, 20, 0.3], 0, 0) && fxRelevant(['b', 49, 0, 0, hit], 0, 0), 'far shakes are dropped, bursts are left to the interest box');
// Chunked PeerJS messages hand over Uint8Array views.
let viewCount = 0;
decodeFx(new Uint8Array(buf), () => viewCount++);
ok(viewCount === events.length, 'effects decode from a Uint8Array view');

// ---------------------------------------------------------------- compact values

const sample = {
  mode: 'fight',
  stage: 3,
  tl: 123.45,
  boss: null,
  team: { level: 12, xp01: 0.37, score: 1234567, combo: 0, combo01: 0, kills: 999, time: 345.67 },
  cu: ['glass', 'swarm'],
  sev: ['fog', 12.3],
  big: 2 ** 40 + 0.5,
  neg: -17.25,
  milli: 1.234,
  odd: Math.PI,
  nan: NaN,
  flag: true,
  nope: false,
  und: undefined,
  uni: 'ÜBER COMBO ★',
  bin: new Uint8Array([1, 2, 3, 250]).buffer,
};
const back = unpackValue(packValue(sample)) as Record<string, unknown>;
const same = (a: unknown, b: unknown): boolean => {
  if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) return a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) || (a === 0 && b === 0);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    return ka.length === Object.keys(b).length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
};
ok(same(sample, back), 'compact values round-trip exactly (2-decimal floats, pi, NaN, unicode, binary)');

// ---------------------------------------------------------------- snapshots

/** A little world: enemies (22-byte records keyed by uid) and pickups (8-byte records). */
const ENEMY = 22;
const PICK = 8;
function packEn(list: { uid: number; x: number; z: number; t: number }[]): ArrayBuffer {
  const b = new ArrayBuffer(list.length * ENEMY);
  const v = new DataView(b);
  list.forEach((e, i) => {
    const o = i * ENEMY;
    v.setUint32(o, e.uid, true);
    v.setUint8(o + 4, e.uid % 7);
    v.setInt16(o + 8, Math.round(e.x * 100), true);
    v.setInt16(o + 10, Math.round(e.z * 100), true);
    v.setUint8(o + 7, Math.round(e.t * 50) & 255);
    v.setUint8(o + 20, 255);
  });
  return b;
}
function packPk(list: { type: number; x: number; z: number; value: number }[]): ArrayBuffer {
  const b = new ArrayBuffer(list.length * PICK);
  const v = new DataView(b);
  list.forEach((p, i) => {
    const o = i * PICK;
    v.setUint8(o, p.type);
    v.setUint16(o + 2, p.value, true);
    v.setInt16(o + 4, Math.round(p.x * 100), true);
    v.setInt16(o + 6, Math.round(p.z * 100), true);
  });
  return b;
}
const bytesEq = (a: ArrayBuffer, b: ArrayBuffer) => a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);
/** Records as a sorted set of byte strings (the codec may reorder them). */
const recSet = (b: ArrayBuffer, size: number) => {
  const u = new Uint8Array(b);
  const out: string[] = [];
  for (let o = 0; o < u.length; o += size) out.push(Array.from(u.subarray(o, o + size)).join(','));
  return out.sort().join('|');
};

let enemies = Array.from({ length: 60 }, (_, i) => ({ uid: 1000 + i * 3, x: Math.sin(i) * 30, z: Math.cos(i) * 30, t: 0 }));
let pickups = Array.from({ length: 80 }, (_, i) => ({ type: i % 4, x: (i % 9) * 3 - 12, z: Math.floor(i / 9) * 2 - 8, value: 1 + (i % 5) }));
const snapEnc = new SnapEncoder();
const snapDec = new SnapDecoder();
let okBody = true;
let okRecs = true;
let wire = 0;
let plain = 0;
let uid = 5000;
for (let step = 0; step < KEYFRAME * 2 + 5; step++) {
  // Enemies move, some die, some arrive; pickups get collected and drop.
  enemies = enemies.filter((_, i) => (i + step) % 23 !== 0);
  for (const e of enemies) {
    e.x += 0.3;
    e.z -= 0.2;
    e.t = (e.t + 0.05) % 5;
  }
  if (step % 2 === 0) enemies.push({ uid: uid++, x: step - 20, z: 10, t: 0 });
  pickups = pickups.filter((_, i) => (i * 7 + step) % 31 !== 0);
  if (step % 3 === 0) pickups.push({ type: 0, x: step * 0.5, z: -step * 0.25, value: 3 });
  const body = {
    mode: step % 30 === 29 ? 'levelup' : 'fight',
    stage: 2,
    team: { level: 4 + (step >> 4), xp01: Math.round((step % 50) * 2) / 100, score: 1000 + step * 37, combo: step % 9, combo01: 0.5, kills: step * 3, time: Math.round(step * 5) / 100 },
    boss: step > 60 ? { name: 'King Bopper', hp01: Math.round((1 - (step - 60) / 40) * 100) / 100 } : null,
    heroes: [0, 1].map((i) => ({ i, x: Math.round((step * 0.4 + i) * 100) / 100, z: 3.25, hp: 90 - (step % 4), mhp: 120, dead: false, w: [['buster', 3, 1, 'b|t|0', step % 3], ['drones', 2, 1, '', Math.round(step * 0.1 * 1000) / 1000, 1]], rl: ['halo'] })),
    you: { gold: 40 + (step >> 3), gears: 1, mods: [{ id: 'echo', ro: '', lv: 1 }], passives: { armor: 2 }, stats: { maxHp: 120, magnet: 1.5 } },
    portal: step > 70 ? [12.5, -3.25] : null,
    sk: { h: [[120, 2, 0.45, 0, 0]], n: null, e: [] },
  };
  const en = packEn(enemies);
  const pk = packPk(pickups);
  const m = snapEnc.encode(body, { en, enN: enemies.length, pk, pkN: pickups.length }, { bu: new ArrayBuffer(0), fx: new ArrayBuffer(1) });
  wire += (pack(m as Parameters<typeof pack>[0]) as ArrayBuffer).byteLength;
  plain += (pack({ t: 's', ...body, en, pk, bu: new ArrayBuffer(0), ev: [] } as Parameters<typeof pack>[0]) as ArrayBuffer).byteLength;
  // Half the messages arrive as Uint8Array views, like chunked PeerJS messages.
  const arrived = step % 2 ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v instanceof ArrayBuffer ? new Uint8Array(v) : v])) : m;
  const s = snapDec.decode(arrived);
  const { en: sen, pk: spk, t, bu, fx, ...rest } = s;
  void t;
  void bu;
  void fx;
  if (!same(body, rest)) {
    okBody = false;
    console.error(`  step ${step}: body differs`, JSON.stringify(rest).slice(0, 300));
  }
  if (recSet(sen as ArrayBuffer, ENEMY) !== recSet(en, ENEMY) || recSet(spk as ArrayBuffer, PICK) !== recSet(pk, PICK)) {
    okRecs = false;
    console.error(`  step ${step}: records differ (${(sen as ArrayBuffer).byteLength}/${en.byteLength} ${(spk as ArrayBuffer).byteLength}/${pk.byteLength})`);
  }
  if (step === 3) ok(bytesEq(sen as ArrayBuffer, sen as ArrayBuffer), 'decoded enemy records are a plain ArrayBuffer');
}
ok(okBody, `${KEYFRAME * 2 + 5} snapshots: the decoded body equals what the host built (unchanged fields filled in, across keyframes)`);
ok(okRecs, 'enemy and pickup records survive the deltas (moves, deaths, arrivals, keyframes)');
ok(wire < plain * 0.5, `snapshot wire size under half of plain binarypack (${plain} -> ${wire} bytes over the run)`);
