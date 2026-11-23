// Wall time and frame counters are independent so a stalled sample cannot pass
// by reporting a few perfectly spaced frames at one end of the window.
import { hardware, matrix, rendererStress, scenes } from './benchRealScenes.mjs';
export function sceneFailures(r) {
  const issues = [];
  const require = (condition, label) => {
    if (!condition) issues.push(label);
  };
  const lowEnd = r.rate === 4;
  require(hardware(r.renderer), 'requires hardware Metal');
  require(r.visible && r.fighting && !r.errors.length, 'scene hidden, interrupted or errored');
  require(r.viewport.join('x') === r.size, 'viewport');
  require(r.quality === (r.preset === 'shadows' ? 'HIGH' : r.preset.toUpperCase()) &&
    r.shadows === (r.preset === 'shadows'), 'preset/shadows');
  require(r.frames >= 100 && r.interval?.n >= 99, 'insufficient samples');
  require(Math.min(r.fps, ((r.frames + 1) * 1000) / r.elapsed) >= (lowEnd ? 30 : 59), 'sustained fps');
  require(r.interval?.p95 <= (lowEnd ? 34.5 : 17.5), 'frame interval p95');
  require(r.interval?.p99 <= (lowEnd ? 51 : 34.5), 'frame interval p99');
  if (!lowEnd) require(r.dropFraction <= 0.02, 'missed refresh slots');
  for (const k of ['simulation', 'render', 'submit']) require(r[k]?.p95 <= (lowEnd ? 12 : 4), k + ' p95');
  require(r.cpu?.p95 <= (lowEnd ? 28 : 10), 'main callback CPU p95');
  if (r.gpuExtension) require(r.gpu?.p95 <= 12, 'GPU p95');
  require(r.calls?.p95 <= 420 && r.triangles?.p95 <= 650000, 'draw budget');
  require(r.heapBytes?.end <= 240 * 1048576, 'JS heap');
  if (r.scene === 'lights') {
    require(r.activeBackend === (r.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'), 'requested backend');
    require(r.friendly?.median >= 1000 && r.localLights?.median >= 1000, 'friendly projectiles and local lights');
  }
  if (r.scene !== 'titan') {
    require(r.enemies?.median >= (['double', 'lights'].includes(r.scene) ? 300 : 150), 'enemy population');
    const target = ['double', 'lights'].includes(r.scene) ? 1000 : 500;
    const minimum = r.scene === 'lights' ? target : target * 0.95;
    require(r.bullets?.median >= minimum && r.bullets?.max >= target, 'projectile population');
  }
  if (r.scene === 'team') require(r.heroes?.min === 4, 'four heroes');
  if (['titan', 'boss'].includes(r.scene))
    require(r.bosses.length === 1 && r.bosses[0] === (r.scene === 'titan' ? 'titan' : 'omega'), 'boss missing');
  return issues;
}

export function loadFailures(row) {
  const failures = [];
  if (!hardware(row.renderer) || row.errors.length || !(row.total > 0 && row.total < 5000000))
    failures.push('initial transfer or renderer');
  if (row.network === 'broadband' && row.target === 'title' && !(row.readyMs < 3000)) failures.push('title readiness');
  return failures;
}

export function gate(report) {
  const failures = [];
  const key = (r) => [r.size, r.preset, r.rate, r.scene].join('/');
  for (const cfg of matrix()) {
    if (!report.rows.some((r) => key(r) === key(cfg))) failures.push(key(cfg) + ': missing');
  }
  if (report.rendererGate) for (const cfg of rendererStress)
    if (!report.extendedRows?.some(r => key(r) === key(cfg) && r.backend === cfg.backend)) failures.push(cfg.backend + '/lights: missing');
  if (report.desktopRequested) {
    for (const scene of Object.keys(scenes)) {
      if (!report.desktop?.rows?.some((r) => r.scene === scene)) failures.push('Electron/' + scene + ': missing');
    }
    if (!(report.desktop?.coldMs > 0)) failures.push('Electron cold start missing');
  }
  for (const r of [...report.rows, ...(report.extendedRows ?? []), ...(report.desktop?.rows ?? [])]) {
    const issues = sceneFailures(r);
    if (issues.length) failures.push((r.runtime ?? 'browser') + '/' + key(r) + ': ' + issues.join(', '));
  }
  for (const network of ['broadband', 'slow4g'])
    for (const target of ['title', 'fight']) {
      const rows = report.loads.filter((r) => r.network === network && r.target === target);
      if (!rows.length || rows.some((r) => loadFailures(r).length))
        failures.push(network + '/' + target + ': load budget or missing');
    }
  return failures;
}
