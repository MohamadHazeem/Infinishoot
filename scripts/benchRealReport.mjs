import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gate } from './benchRealBudget.mjs';

export function writeReport(stem, report) {
  const failures = gate(report);
  const f = (n, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
  const rows = [...report.rows, ...(report.extendedRows ?? []), ...(report.desktop?.rows ?? [])];
  const out = [
    '# Real GPU performance · ' + report.date,
    '',
    report.host + ' · ' + report.browser + ' · ' + report.rows[0]?.renderer,
    '',
    'Production build based on ' +
      report.revision +
      '. ' +
      report.warmup +
      ' s warm-up followed by ' +
      report.seconds +
      ' s per scene. ' +
      report.conditions,
    '',
    '**Measured performance budgets ' +
      (failures.length ? 'failed' : 'passed') +
      '.** ' +
      (report.desktop?.status ?? 'Desktop unmeasured.'),
    '',
    '## Frame delivery',
    '',
    'Frame intervals and GPU times are milliseconds. Drops are missed 60 Hz render slots. CPU includes simulation, presentation and GL submission. Calls and triangles include all passes. The JSON includes per-system timings, live entity counts, actual drawing-buffer sizes and every test link.',
    '',
    '| Runtime | Viewport | Preset | CPU rate | Scene | FPS | Frame median / p95 / p99 | Drops | CPU p95 | GPU p95 | Calls p95 | Triangles p95 | End heap MiB |',
    '|---|---|---|---:|---|---:|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows)
    out.push(
      '| ' +
        [
          (r.runtime ?? 'Chromium') + (r.seconds ? ' · ' + r.seconds + ' s' : ''),
          r.size,
          r.preset,
          r.rate + '×',
          r.scene + (r.backend ? ' · ' + r.activeBackend : ''),
          f(r.fps, 1),
          ['median', 'p95', 'p99'].map((k) => f(r.interval?.[k])).join(' / '),
          r.drops,
          f(r.cpu?.p95),
          f(r.gpu?.p95),
          r.calls?.p95,
          r.triangles?.p95,
          f(r.heapBytes.end / 1048576, 1),
        ].join(' | ') +
        ' |',
    );
  out.push(
    '',
    '## Cold startup',
    '',
    'Fresh browser storage for each navigation. The readiness column includes fonts and two animation frames. Bytes are CDP transfer lengths for requests initiated by the first submitted frame, including HTML.',
    '',
    '| Network | Target | First frame ms | Ready ms | HTML B | JS B | CSS B | Other B | Total B |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const r of report.loads)
    out.push(
      '| ' +
        [
          r.network,
          r.target,
          f(r.firstMs, 0),
          f(r.readyMs, 0),
          r.bytes.html,
          r.bytes.js,
          r.bytes.css,
          r.bytes.assets,
          r.total,
        ].join(' | ') +
        ' |',
    );
  if (report.desktop?.coldMs != null)
    out.push('', 'Packaged process launch to the first title frame took ' + f(report.desktop.coldMs, 0) + ' ms.');
  if (report.findings) out.push('', '## Findings', '', ...report.findings.flatMap((s) => [s, '']));
  if (failures.length) out.push('', '## Budget failures', '', ...failures.map((s) => '- ' + s));
  out.push(
    '',
    'Run `npm run bench:real -- --check` to collect a new matrix. See [the measurement protocol and budgets](BUDGET.md).',
    '',
  );
  mkdirSync(dirname(stem), { recursive: true });
  writeFileSync(stem + '.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync(stem + '.md', out.join('\n'));
  return failures;
}
