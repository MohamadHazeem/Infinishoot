/** Budget envelopes and real render pools: cosmetic suppression must never suppress danger or wire events. */
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { ok } from './check';
import { NoiseGovernor, crowdPressure, noiseFor, noiseTuning } from '../src/render/noiseGovernor';

ok(crowdPressure(20, 0, 1) === 0 && crowdPressure(300, 500, 8) === 1, 'pressure spans calm solo to crowded eight-player combat');
ok(crowdPressure(100, 300, 4) > crowdPressure(100, 0, 1), 'projectiles and teammates contribute to density');
const g = new NoiseGovernor();
g.begin(0, 300, 500, 8, 2, 3);
let emitted = g.take('particles', 10000);
for (let i = 0; i < 60; i++) { g.begin(1 / 60, 300, 500, 8, 2, 3); emitted += g.take('particles', 10000); }
ok(emitted <= noiseTuning.crowdedParticles * (1 + noiseTuning.burstSeconds) && emitted >= noiseTuning.crowdedParticles, 'one-second particle flood obeys rate plus bounded burst allowance');
ok(g.take('particles', 10000) === 0 && g.take('particles', -2) === 0, 'exhaustion and negative requests never mint particles');
const runRate = (fps: number) => {
  const n = new NoiseGovernor(); n.begin(0, 300, 500, 4, 0, 0);
  let total = n.take('smoke', 1000);
  for (let i = 0; i < fps; i++) { n.begin(1 / fps, 300, 500, 4, 0, 0); total += n.take('smoke', 1000); }
  return total;
};
ok(Math.abs(runRate(30) - runRate(144)) <= 1, 'emission budgets use seconds, not frames');
ok(g.alpha(2, 3) < 0.11 && g.alpha(20, 20) > 0.5, 'effects clear the local hero while remaining readable farther away');
g.begin(0.1, 0, 0, 1, 2, 3);
ok(g.pressure > 0.9, 'crowd release eases instead of flickering budgets');
ok(g.flash(10) <= 0.09 && g.flash(10) === 0, 'stacked flashes share intensity and frequency caps');
for (let i = 0; i < 6; i++) g.begin(0.1, 300, 500, 8, 2, 3);
ok(g.flash(1) > 0, 'flash allowance recovers');
g.begin(0, 300, 500, 8, 2, 3, true);
ok(g.flashCap <= 0.0121, 'reduced flashing further lowers the ceiling');
const scene = new THREE.Scene();
ok(noiseFor(scene) === noiseFor(scene) && noiseFor(new THREE.Scene()) !== noiseFor(scene), 'all emitters share their scene budget without leaking into other games');

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event']) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
(globalThis as any).matchMedia = () => ({ matches: false });
const noop: any = new Proxy(function () {}, { get: (_t, k) => k === 'data' ? new Uint8ClampedArray(4 * 96 * 96) : noop, apply: () => noop, set: () => true });
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => noop;
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(globalThis as any).Path2D = class {};
(globalThis as any).__APP_VERSION__ = 'test';
const { DamageNumbers, showDamageNumber } = await import('../src/ui/damageNumbers');
const { settings } = await import('../src/game/settings');
const { Juice, juiceTuning } = await import('../src/game/juice');
const { Bullets, Team } = await import('../src/game/bullets');
const { Enemies } = await import('../src/game/enemies');
const { ENEMIES } = await import('../src/data/enemies');
const { Particles } = await import('../src/game/particles');
const { Fx } = await import('../src/game/fx');
const { Vfx } = await import('../src/game/vfx');
const root = document.createElement('div');
const numbers = new DamageNumbers(root);
const ng = numbers.noise = new NoiseGovernor();
const live = () => [...root.children].filter(e => (e as HTMLElement).style.display !== 'none');
settings.damageNumbers = 'auto';
ng.begin(0, 160, 0, 1, 0, 0);
numbers.spawn(0, 1, 0, 20, 'hit', 0);
numbers.spawn(0.8, 1, 0, 30, 'hit', 1);
ok(live().length === 1 && live()[0].textContent === '50', 'AUTO clusters nearby hits across heroes as density rises');
numbers.clear();
ng.begin(0, 300, 500, 8, 0, 0);
numbers.spawn(0, 1, 0, 10, 'hit', 0);
numbers.spawn(0, 1, 0, 100, 'hit', 0);
numbers.spawn(1, 1, 0, 20, 'crit', 0);
for (let i = 0; i < 100; i++) numbers.spawn(i * 3, 1, 0, 100, 'crit', 1);
numbers.spawn(0, 1, 0, 'DANGER', 'score');
numbers.spawn(0, 1, 0, 8, 'player');
numbers.spawn(0, 1, 0, 12, 'heal');
ok(live().some(e => e.textContent === '100') && !live().some(e => e.textContent === '10'), 'crowded AUTO preserves big hits and drops small hits');
ok(live().length <= 6 && live().some(e => e.textContent === 'DANGER') && live().some(e => e.textContent === '+12'), 'hit flood is bounded without suppressing messages, hero damage or healing');
settings.damageNumbers = 'all'; numbers.clear();
for (let i = 0; i < 20; i++) numbers.spawn(i * 3, 1, 0, 10, 'hit', 1);
ok(live().length === 20, 'ALL remains an explicit unthinned choice');
ok(showDamageNumber('auto', 1, 0) && !showDamageNumber('mine', 1, 0) && !showDamageNumber('off', 0, 0), 'AUTO, MINE and OFF retain their attribution semantics');
const camera = new THREE.PerspectiveCamera(); numbers.render(1, camera);
ok(live().length === 0, 'clusters do not extend lifetime');

const juice = new Juice(); juice.noise = ng;
const out = { x: 0, z: 0 };
for (let i = 0; i < 1000; i++) { juice.shake(10); juice.kick(1, 1, 10); }
juice.tick(1 / 60); juice.shakeOffset(out);
ok(Math.hypot(out.x, out.z) <= ng.shakeCap + 1e-9, 'stacked shakes and directional kicks share a final displacement ceiling');
juiceTuning.shakeScale = 0; juice.shakeOffset(out);
ok(out.x === 0 && out.z === 0, 'zero shake setting also clears residual kicks');
juiceTuning.shakeScale = 1;
const noise = noiseFor(scene); noise.begin(0, 300, 500, 8, 0, 0);
const bullets = new Bullets(scene);
for (let i = 0; i < 500; i++) bullets.spawn({ x: i / 10, z: 0, dirX: 1, dirZ: 0, speed: 5, life: 3, radius: 0.2, damage: 9, knockback: 0, team: Team.Enemy, color: '#ffffff', width: 0.5, length: 0.5 });
noise.take('particles', 10000); noise.take('impacts', 10000);
bullets.render(1);
const core = scene.children.find(o => o.renderOrder === 111) as THREE.InstancedMesh;
const rim = scene.children.find(o => o.renderOrder === 110) as THREE.InstancedMesh;
ok(bullets.count === 500 && core.count === 500 && rim.count === 500 && bullets.damage[499] === 9, '500 enemy bullets survive budget exhaustion without changing collision/damage records');
ok(!(core.material as THREE.Material).depthTest && (core.material as THREE.ShaderMaterial).uniforms.uColor.value.getHex() === 0xff3df0, 'enemy cores retain danger magenta, ignore depth, and never inherit friendly skins');
const enemies = new Enemies(scene);
enemies.zones.push({ x: 0, z: 0, r: 3, t: 1, life: 1 });
enemies.render(1, 0);
const warnings = scene.children.filter(o => o.renderOrder === 100) as THREE.InstancedMesh[];
ok(warnings.some(m => m.count > 0) && warnings.every(m => !(m.material as THREE.Material).depthTest), 'telegraphs render above weather even with an empty cosmetic budget');
for (let i = 0; i < 300; i++) {
  const e = enemies.spawn(ENEMIES.charger, i % 20, Math.floor(i / 20), { instant: true });
  if (e) { e.state = 'windup'; e.t = 1; e.lungeX = 1; e.lungeZ = 0; }
}
enemies.render(1, 0);
ok(warnings.some(m => m.count >= 300) && warnings.every(m => m.count <= m.instanceMatrix.count), '300 simultaneous charge telegraphs fit their pools without buffer overflow');
const particles = new Particles(scene); const fx = new Fx(scene);
for (let i = 0; i < 300; i++) fx.ring(i, 0, 2, 3, '#ffffff');
fx.ring(0, 0, 3, 0.1, '#ff2d4a', 1);
fx.render(camera);
const warning = scene.children.filter(o => o.renderOrder === 100).at(-1) as THREE.InstancedMesh;
ok(warning.count === 1, 'shrinking warning rings have reserved capacity and bypass friendly fading');
const bus = new Vfx({ particles, fx } as any); bus.recording = true;
bus.burst(0, 1, 0, { count: 1000, color: '#fff', speed: [1, 2], size: [0.1, 0.2], life: [1, 2] });
particles.render();
const wire = bus.drain();
ok(particles.mesh.count === 0 && wire.length === 1, 'local suppression leaves the original effects event on the wire');
const otherScene = new THREE.Scene(); const otherParticles = new Particles(otherScene);
new Vfx({ particles: otherParticles } as any).apply(wire[0]);
otherParticles.render();
ok(otherParticles.mesh.count === 1000, 'another client applies its own budget to the intact event');
