/**
 * Netcode lane: the simulated bad connection, the playout buffer, lag
 * compensation, bullet deltas, connection quality, and (in-process host and
 * client) probes, the `nq` field, bullet mirroring, lag-compensated hits and
 * reconnects that reclaim the hero.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { NetSim, deliveryTime, parseNetSim } = await import('../src/net/netsim');
const { Playout, STEP_MS, interpTuning, isTeleport } = await import('../src/net/interp');
const { EnemyHistory, allowedRewind, lagTuning, HISTORY } = await import('../src/net/lagcomp');
const { BulletDeltaEncoder, BulletDeltaDecoder } = await import('../src/net/bulletCodec');
const { ByteWriter } = await import('../src/net/bytes');
const { netLevel, ProbeTracker, netQualityTuning } = await import('../src/net/netQuality');
const { Bullets, Team } = await import('../src/game/bullets');
const { packBullets } = await import('../src/net/codec');

// ---------------------------------------------------------------- netsim
{
  ok(parseNetSim('90,30,0.03')?.latency === 90 && parseNetSim('90,30,0.03')?.loss === 0.03, 'netsim: parses latency, jitter, loss');
  ok(parseNetSim('0,0,0') === null && parseNetSim('') === null && parseNetSim('x') === null, 'netsim: off for zero or junk');
  ok(parseNetSim('99999,5000,0.9')!.latency === 2000 && parseNetSim('99999,5000,0.9')!.loss === 0.5, 'netsim: clamps silly values');
  const c = { latency: 50, jitter: 0, loss: 0 };
  ok(deliveryTime(c, 1000, 0, () => 0.5) === 1050, 'netsim: latency only');
  ok(deliveryTime({ ...c, loss: 1 }, 1000, 0, () => 0) === 1050 + 3 * 200, 'netsim: a lost packet waits a retransmit timeout (at most 3)');
  ok(deliveryTime(c, 1000, 1300, () => 0.5) === 1300, 'netsim: never overtakes an earlier message (ordered)');
  let now = 0;
  const got: number[] = [];
  let r = 0;
  const seq = [0.9, 0.0, 0.9, 0.9, 0.2, 0.9, 0.9, 0.9]; // jitter, loss roll pairs
  const sim = new NetSim<number>((m) => got.push(m), () => ({ latency: 40, jitter: 20, loss: 0.1 }), () => seq[r++ % seq.length], () => now, false);
  for (let i = 0; i < 4; i++) sim.push(i);
  now = 30;
  ok(sim.pump() === 0 && got.length === 0, 'netsim: nothing arrives before the latency');
  now = 2000;
  sim.pump();
  ok(got.join() === '0,1,2,3', `netsim: everything arrives once, in order (${got.join()})`);
  const pass: number[] = [];
  const off = new NetSim<number>((m) => pass.push(m), () => null);
  off.push(7);
  ok(pass[0] === 7, 'netsim: no config passes straight through');
}

// ---------------------------------------------------------------- playout
{
  // Snapshots every 3 host steps, 60 ms one-way, +-0..40 ms jitter, one stall.
  const p = new Playout<number>();
  const applied: number[] = [];
  const arrivals: [number, number][] = [];
  let rnd = 1;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 200; k++) {
    const step = k * 3;
    let at = step * STEP_MS + 60 + rand() * 40;
    if (k === 120) at += 220; // a resent packet...
    arrivals.push([at, step]);
  }
  // ...holds the next ones up (ordered channel).
  for (let i = 1; i < arrivals.length; i++) arrivals[i][0] = Math.max(arrivals[i][0], arrivals[i - 1][0]);
  let ai = 0;
  let maxQueue = 0;
  let alphaBad = 0;
  let minA = 9;
  let frozenFrames = 0;
  let lastRs = -1;
  for (let t = 0; t < 200 * 3 * STEP_MS + 1000; t += 1000 / 60) {
    while (ai < arrivals.length && arrivals[ai][0] <= t) {
      p.push(arrivals[ai][1], arrivals[ai][0], arrivals[ai][1]);
      ai++;
    }
    p.update(t, (s) => applied.push(s));
    const a = p.alpha(t);
    if (t > 1500 && t < 180 * 3 * STEP_MS) {
      if (!(a >= 0 && a <= 1 + interpTuning.extrapMax / STEP_MS / 3 + 1e-9)) alphaBad++;
      minA = Math.min(minA, a);
      if (a > 1.001) frozenFrames++;
    }
    if (p.renderStep < lastRs - 1e-6 && t > 1500) alphaBad++;
    lastRs = p.renderStep;
    maxQueue = Math.max(maxQueue, p.stats.queued);
  }
  ok(applied.length === 200, `playout: every snapshot applied once (${applied.length})`);
  ok(applied.every((s, i) => i === 0 || s > applied[i - 1]), 'playout: in order');
  ok(alphaBad === 0, `playout: alpha stays in range and the clock never runs backwards (${alphaBad} bad)`);
  ok(p.stats.delay >= interpTuning.minDelay && p.stats.delay <= interpTuning.maxDelay, `playout: delay within limits (${p.stats.delay.toFixed(0)} ms)`);
  ok(p.stats.delay > 50 + 30, `playout: delay covers interval + jitter (${p.stats.delay.toFixed(0)} ms, jitter ${p.stats.jitter.toFixed(0)})`);
  ok(frozenFrames < 40, `playout: rarely runs out of snapshots after settling (${frozenFrames} extrapolated frames, 1 stall)`);
  ok(maxQueue <= interpTuning.queueMax, `playout: queue stays bounded (${maxQueue})`);

  // Clean network: small delay, no extrapolation, loss ~0.
  const q = new Playout<number>();
  let n = 0;
  let extra = 0;
  for (let t = 0, k = 0; t < 6000; t += 1000 / 60) {
    while (k * 3 * STEP_MS + 20 <= t) {
      q.push(k * 3, k * 3 * STEP_MS + 20, k);
      k++;
    }
    n += q.update(t, () => {});
    if (t > 1000 && q.alpha(t) > 1.001) extra++;
  }
  ok(q.stats.delay <= 70, `playout: clean network keeps the delay low (${q.stats.delay.toFixed(0)} ms)`);
  ok(extra === 0 && q.stats.loss === 0, `playout: clean network never extrapolates or reports loss (${extra}, ${q.stats.loss})`);
  ok(Math.abs(q.stats.rate - 20) <= 1.5, `playout: snapshot rate measured (${q.stats.rate})`);
  ok(n > 100, 'playout: applies as it goes');
  // Flush applies everything at once; reset after a new host clock.
  const f = new Playout<number>();
  const fl: number[] = [];
  f.push(0, 0, 0);
  f.update(1, (x) => fl.push(x));
  f.push(3, 50, 3);
  f.push(6, 100, 6);
  ok(f.flush((x) => fl.push(x)) === 2 && fl.join() === '0,3,6', 'playout: flush applies what waits');
  ok(isTeleport(0, 0, 7, 0) && !isTeleport(0, 0, 3, 3), 'playout: teleport threshold');
}

// ---------------------------------------------------------------- lag compensation
{
  const hist = new EnemyHistory();
  const e = { uid: 77, x: 0, z: 0, active: true };
  const other = { uid: 78, x: 100, z: 0, active: true };
  for (let s = 100; s < 120; s++) {
    e.x = s - 100; // 1 m per step
    hist.record(s, [e, other]);
  }
  const out = { x: 0, z: 0 };
  ok(hist.at(e, 5, out) && Math.abs(out.x - 14) < 1e-6, `lagcomp: 5 steps back (${out.x})`);
  ok(hist.at(e, 2.5, out) && Math.abs(out.x - 16.5) < 1e-6, `lagcomp: fractional steps interpolate (${out.x})`);
  ok(hist.at(e, 40, out) && out.x === 19 - (HISTORY - 1), `lagcomp: rewind capped at the history (${out.x})`);
  ok(!hist.at({ uid: 999, x: 0, z: 0 }, 3, out), 'lagcomp: unknown enemy falls back to now');
  ok(!hist.at(e, 0, out), 'lagcomp: no rewind for no lag');
  // A new enemy in the same slot doesn't inherit the old one's past.
  const reuse = { uid: 77 + 4096, x: 50, z: 50, active: true };
  hist.record(120, [reuse]);
  ok(!hist.at(e, 3, out), 'lagcomp: a reused slot drops the old uid');
  ok(hist.at(reuse, 3, out) && out.x === 50, 'lagcomp: a new enemy rewinds no further than its first step');
  ok(allowedRewind(12, 150) === 12, 'lagcomp: honest lag allowed');
  ok(allowedRewind(60, 300) === lagTuning.maxRewind * 60, 'lagcomp: capped at maxRewind');
  ok(allowedRewind(15, 20) === Math.min(15, (0.02 + lagTuning.delaySlack) * 60), 'lagcomp: a lag claim beyond the measured ping is cut');
  ok(allowedRewind(15, 0) === lagTuning.unmeasured * 60, 'lagcomp: unmeasured ping allows little');
  ok(allowedRewind(-5, 100) === 0, 'lagcomp: negative claims ignored');
}

// ---------------------------------------------------------------- bullet deltas
{
  const scene = new THREE.Scene();
  const host = new Bullets(scene);
  const cli = new Bullets(scene);
  const enc = new BulletDeltaEncoder();
  const dec = new BulletDeltaDecoder();
  const w = new ByteWriter(4096);
  const spawn = (x: number, vx: number, homing = 0, color = '#fff36b') =>
    host.spawn({ x, z: 0, dirX: vx >= 0 ? 1 : -1, dirZ: 0, speed: Math.abs(vx), life: 3, radius: 0.2, damage: 5, knockback: 0, team: Team.Player, color, width: 0.4, length: 0.6, homing });
  for (let i = 0; i < 40; i++) spawn(i * 0.5, 20 + i);
  const all = () => [...Array(host.count).keys()];
  let newBytes = 0;
  let oldBytes = 0;
  let deltaBytes = 0;
  const send = () => {
    w.reset();
    enc.encode(host, all(), w);
    const bytes = w.bytes();
    dec.decode(bytes, cli);
    return bytes.byteLength;
  };
  newBytes = send();
  oldBytes = packBullets(host, all()).byteLength;
  ok(cli.count === 40, `bullets: client got all 40 (${cli.count})`);
  // Fly for a while: three steps per snapshot on both sides.
  let maxErr = 0;
  for (let snap = 0; snap < 20; snap++) {
    for (let k = 0; k < 3; k++) {
      host.integrate(1 / 60);
      cli.integrate(1 / 60);
    }
    deltaBytes += send();
    oldBytes += packBullets(host, all()).byteLength;
    const byUid = new Map<number, number>();
    for (let i = 0; i < cli.count; i++) byUid.set(cli.uid[i], i);
    for (let i = 0; i < host.count; i++) {
      const j = byUid.get(host.uid[i]);
      if (j === undefined) maxErr = 99;
      else maxErr = Math.max(maxErr, Math.abs(cli.x[j] - host.x[i]), Math.abs(cli.z[j] - host.z[i]));
    }
  }
  ok(maxErr < 0.12, `bullets: straight bullets stay in step without resends (max error ${maxErr.toFixed(3)} m)`);
  ok(deltaBytes < (20 * 40 * 14) / 8, `bullets: straight flight costs little (${deltaBytes} B over 20 snapshots vs ${20 * 40 * 14} B before)`);
  ok(newBytes <= 40 * 20, `bullets: a new bullet is ~17 bytes (${newBytes} B for 40)`);
  // A bullet changes course: the client gets it.
  host.vz[3] = 15;
  for (let k = 0; k < 3; k++) {
    host.integrate(1 / 60);
    cli.integrate(1 / 60);
  }
  send();
  const j3 = [...Array(cli.count).keys()].find((j) => cli.uid[j] === host.uid[3])!;
  ok(Math.abs(cli.vz[j3] - 15) < 0.06 && Math.abs(cli.z[j3] - host.z[3]) < 0.02, 'bullets: a turned bullet is resent with its new velocity');
  // Some die on the host: removed on the client.
  host.kill(0);
  host.kill(5);
  send();
  ok(cli.count === host.count, `bullets: removals mirrored (${cli.count} vs ${host.count})`);
  const hu = new Set([...Array(host.count).keys()].map((i) => host.uid[i]));
  ok([...Array(cli.count).keys()].every((j) => hu.has(cli.uid[j])), 'bullets: the client holds exactly the host bullets');
  // Bullet time on the host (slow motion): no resends needed, the bullet clock carries it.
  let slowBytes = 0;
  for (let snap = 0; snap < 5; snap++) {
    for (let k = 0; k < 3; k++) {
      host.integrate(0.35 / 60);
      cli.integrate(1 / 60); // the client steps at full speed between snapshots
    }
    slowBytes += send();
  }
  let slowErr = 0;
  const byUid = new Map<number, number>();
  for (let i = 0; i < cli.count; i++) byUid.set(cli.uid[i], i);
  for (let i = 0; i < host.count; i++) slowErr = Math.max(slowErr, Math.abs(cli.x[byUid.get(host.uid[i])!] - host.x[i]));
  ok(slowErr < 0.15, `bullets: the client follows the host's bullet clock in slow motion (error ${slowErr.toFixed(3)} m)`);
  ok(slowBytes < 5 * 40, `bullets: slow motion doesn't resend everything (${slowBytes} B)`);
  // Keyframe: a reset message clears and resends.
  enc.reset();
  send();
  ok(cli.count === host.count, 'bullets: keyframe resend keeps the same set');
  // Unknown colours fall back, team/owner bits survive.
  host.clear();
  host.spawn({ x: 1, z: 2, dirX: 0, dirZ: 1, speed: 9, life: 1, radius: 0.2, damage: 1, knockback: 0, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5, owner: 2 });
  send();
  ok(cli.count === 1 && cli.team[0] === Team.Enemy && cli.colorOf(0) === '#ff3df0' && Math.abs(cli.vz[0] - 9) < 0.05, 'bullets: enemy bullet keeps its team, colour and speed');
  console.log(`     bullet bytes: ${oldBytes} B old format vs ${newBytes + deltaBytes} B deltas over 21 snapshots of 40 bullets`);
}

// ---------------------------------------------------------------- quality
{
  ok(netLevel(40, 0, 20) === 'good' && netLevel(150, 0) === 'poor' && netLevel(250, 0) === 'bad' && netLevel(40, 7) === 'bad' && netLevel(40, 0, 8) === 'bad', 'quality: levels');
  const p = new ProbeTracker();
  const a = p.next(0);
  p.answer(a, 80);
  ok(p.rtt === 80 && p.loss === 0, 'quality: probe round trip');
  p.next(1000);
  p.expire(1000 + netQualityTuning.probeLost + 1);
  ok(Math.abs(p.loss - 0.5) < 1e-9, `quality: an unanswered probe counts as lost (${p.loss})`);
  p.answer(999, 5);
  ok(p.rtt === 80, 'quality: junk answers ignored');
}

// ---------------------------------------------------------------- in-process host + client
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const NC = await import('../src/game/systems/netcode');
const C2 = await import('../src/game/systems/coop2');

settings.deathReplay = false;
settings.coopJoinable = false; // reconnects must work even into a run closed to new players
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;
const A = mk();
const B = mk();
const peers = new Map<string, G>();
const q: [G, any, string][] = [];
const lastHeard = new Map<string, number>();
const dropped: string[] = [];
(A as any).role = 'host';
(A as any).host = {
  code: 'NETCD',
  lastHeard,
  send: (id: string, m: any) => {
    const g = peers.get(id);
    if (g) q.push([g, m, '']);
  },
  broadcast: (m: any) => {
    for (const g of new Set(peers.values())) q.push([g, m, '']);
  },
  drop: (id: string) => {
    dropped.push(id);
    if (!peers.has(id)) return;
    peers.delete(id);
    lastHeard.delete(id);
    A.onClientLeft(id);
  },
  close() {},
};
const connect = (g: G, id: string) => {
  peers.set(id, g);
  lastHeard.set(id, performance.now());
  (g as any).role = 'client';
  (g as any).client = { send: (m: any) => q.push([A, m, id]), close() {} };
};
const flush = () => {
  for (let guard = 0; q.length && guard < 5000; guard++) {
    const [g, m, from] = q.shift()!;
    if (g === A) {
      if (lastHeard.has(from)) lastHeard.set(from, performance.now());
      A.onHostMessage(from, structuredClone(m));
    } else if ([...peers.values()].includes(g)) g.onClientMessage(structuredClone(m));
  }
};
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    for (const c of new Set(peers.values())) {
      c.update(1 / 60);
      flush();
    }
    if (A.mode === 'levelup') {
      (A as any).ui('pick', 0);
      for (const c of new Set(peers.values())) (c as any).ui('pick', 0);
      flush();
    }
    if (A.mode === 'shop') {
      (A as any).ui('done');
      for (const c of new Set(peers.values())) (c as any).ui('done');
      flush();
    }
  }
};
// Lobby -> run, like PLAY ONLINE.
A.lobby = [{ peerId: '', name: 'HOST', unlocked: [], loadout: { primary: 'buster', secondary: 'charge', special: 'bomb' }, skin: 'classic', pet: 'none', hero: 'rookie', look: '---00' } as any];
connect(B, 'peerB');
A.onHostMessage('peerB', { t: 'hello', pid: 'pid-bravo', name: 'BRAVO', loadout: { primary: 'buster', secondary: 'charge', special: 'bomb' } });
ok(A.lobby.length === 2, 'game: client in the lobby');
cheats.god = true;
A.hostStart();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
A.xpNext = 1e9;
step(30);
ok(B.mode === 'fight' && B.heroes.length === 2, `game: client in the run (${B.mode})`);
ok(C2.coop2Debug(A).pids[1] === 'pid-bravo', 'game: a lobby player\'s id is kept for reconnects');
// Probes and the nq field.
step(150);
const nqB = NC.netcodeState(B).nq;
ok(Array.isArray(nqB) && nqB.length === 2 && nqB[1][3] === 0, `game: the client gets everyone's connection numbers (${JSON.stringify(nqB)})`);
ok(NC.netcodeState(A).probes.get('peerB')?.rtt !== undefined && (NC.netcodeState(A).probes.get('peerB')!.rtt >= 0), 'game: the host measured the client\'s round trip');
// Bullets mirror through the delta codec.
{
  const hp = A.heroes[1].player;
  A.bullets.clear();
  for (let i = 0; i < 12; i++) A.bullets.spawn({ x: hp.x + 2, z: hp.z + i * 0.3, dirX: 1, dirZ: 0, speed: 6, life: 2, radius: 0.2, damage: 0, knockback: 0, team: 1, color: '#ff3df0', width: 0.4, length: 0.4 });
  step(12);
  const hu = new Set([...Array(A.bullets.count).keys()].filter((i) => A.bullets.team[i] === 1).map((i) => A.bullets.uid[i]));
  let match = 0;
  let err = 0;
  for (let j = 0; j < B.bullets.count; j++) {
    if (!hu.has(B.bullets.uid[j])) continue;
    match++;
    const i = [...Array(A.bullets.count).keys()].find((k) => A.bullets.uid[k] === B.bullets.uid[j])!;
    err = Math.max(err, Math.abs(A.bullets.x[i] - B.bullets.x[j]));
  }
  ok(match >= 10, `game: client mirrors the host's bullets by uid (${match} of ${hu.size})`);
  ok(err < 0.6, `game: mirrored bullets are where the host has them, give or take a snapshot (${err.toFixed(2)} m)`);
}
// Lag compensation: the client looked at an enemy that has since moved; its bullet still hits where it saw it.
{
  const h = A.heroes[1];
  const p = h.player;
  for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
  const e = A.enemies.spawn(ENEMIES.chonk, p.x + 8, p.z, { instant: true });
  e.hp = e.maxHp = 1e9;
  e.speed = 0;
  // History: the enemy stood 6 m higher for the last few steps, then jumped (as if it had walked away).
  const hist = NC.netcodeState(A).history;
  for (let k = 0; k < 10; k++) {
    e.z = p.z + 6;
    hist.record(A.stepN - 12 + k, A.enemies.list);
  }
  e.z = p.z;
  for (let k = 10; k < 12; k++) hist.record(A.stepN - 12 + k, A.enemies.list);
  // The client says it was looking 8 steps back; the host measured a fitting round trip.
  NC.netcodeState(A).probes.get('peerB')!.rtt = 120;
  NC.netcodeState(A).lag[1] = 0;
  for (let k = 0; k < 30; k++) NC.noteViewStep(A, h, A.stepN - 8);
  const lag = NC.lagSteps(A, 1);
  ok(lag > 7 && lag <= 8.01, `game: the host accepts the client's 8-step view lag (${lag.toFixed(2)})`);
  const out = { x: 0, z: 0 };
  ok(hist.at(e, lag, out) && Math.abs(out.z - (p.z + 6)) < 0.01, 'game: the rewound enemy is where the client saw it');
  ok(NC.lagSteps(A, 0) === 0, 'game: the host\'s own shots never rewind');
  lagTuning.enabled = false;
  ok(NC.lagSteps(A, 1) === 0, 'game: lag compensation can be switched off');
  lagTuning.enabled = true;
}
// Reconnect: the old connection hasn't closed yet; the player comes back on a new peer id with the same pid.
{
  const before = A.heroes.length;
  const B2 = mk();
  connect(B2, 'peerB2');
  A.onHostMessage('peerB2', { t: 'hello', pid: 'pid-bravo', name: 'BRAVO', loadout: { primary: 'buster', secondary: 'charge', special: 'bomb' } });
  flush();
  ok(dropped.includes('peerB'), 'reconnect: the stale old connection is dropped');
  step(60);
  ok(A.heroes.length === before && A.heroes[1].peerId === 'peerB2' && !A.heroes[1].left, `reconnect: the same hero is reclaimed, not a new one (${A.heroes.length} heroes, peer ${A.heroes[1].peerId})`);
  ok(B2.mode !== 'title' && B2.local === 1, `reconnect: the client is back in the run as hero 1 (${B2.mode}, local ${B2.local})`);
  // A silent client is dropped after dropMs: autopilot keeps its hero.
  // Game construction above can trigger the host-load grace on a busy machine.
  // This scenario isolates peer silence, after that local stall has ended.
  NC.netcodeState(A).stallUntil = 0;
  NC.netcodeState(A).lastStepAt = performance.now();
  lastHeard.set('peerB2', performance.now() - netQualityTuning.dropMs - 100);
  step(2);
  ok(dropped.includes('peerB2') && C2.coop2Debug(A).grace.some((g) => g.index === 1), 'reconnect: a silent client is dropped and its hero goes on autopilot');
  step(70);
  const nqA = NC.netNq(A);
  ok(!!nqA && nqA[1][3] > 50, `reconnect: everyone sees the hero reconnecting with time left (${JSON.stringify(nqA?.[1])})`);
  // Back again, into a run closed to new players.
  const B3 = mk();
  connect(B3, 'peerB3');
  A.onHostMessage('peerB3', { t: 'hello', pid: 'pid-bravo', name: 'BRAVO', loadout: { primary: 'buster', secondary: 'charge', special: 'bomb' } });
  flush();
  step(60);
  ok(A.heroes[1].peerId === 'peerB3' && B3.local === 1 && !C2.coop2Debug(A).grace.length, 'reconnect: comes back even with JOIN ANYTIME off');
  // A stranger still can't join a closed run.
  const S = mk();
  connect(S, 'peerS');
  let refused = '';
  const orig = S.onClientMessage.bind(S);
  S.onClientMessage = (m: any) => {
    if (m.t === 'full') refused = String(m.reason);
    return orig(m);
  };
  A.onHostMessage('peerS', { t: 'hello', pid: 'pid-stranger', name: 'STRANGER' });
  flush();
  ok(/closed/i.test(refused), `reconnect: a new player is still refused from a closed run (${refused})`);
}
