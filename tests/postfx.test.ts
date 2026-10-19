/** Look pass pure logic: auto-quality governor, light picking, grading maths, night stages. */
import { ok } from './check';
import { QualityGovernor, QUALITY_LEVELS, governorTuning, MANUAL_LEVELS, AUTO } from '../src/render/quality';
import { LightPicker, MAX_LIGHTS } from '../src/render/lights';
import { gradeChannel, mixGrade, NEUTRAL_GRADE } from '../src/render/postfx';
import { isNightStage, BIOME_GRADES } from '../src/render/biomeLook';
import { BIOMES } from '../src/data/biomes';

const run = (g: QualityGovernor, seconds: number, ms: number): number[] => {
  const changes: number[] = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const l = g.sample(ms / 1000);
    if (l >= 0) changes.push(l);
  }
  return changes;
};

// --- Governor
{
  const g = new QualityGovernor(2);
  run(g, 2, 16.7); // warm-up: ignored
  ok(g.level === 2, 'governor holds its start rung during warm-up');
  const down = run(g, 4, 30);
  ok(down.length >= 1 && g.level < 2, `slow frames (30 ms) step quality down (now ${g.level})`);
  const g2 = new QualityGovernor(2);
  run(g2, 60, 33);
  ok(g2.level === 0, 'sustained 30 fps walks down to the lowest rung');
  run(g2, 120, 33);
  ok(g2.level === 0, 'never below the lowest rung');
}
{
  const g = new QualityGovernor(1);
  const ups = run(g, governorTuning.warmup + governorTuning.upAfter + 2, 16.7);
  ok(ups.length === 1 && g.level === 2, '60 fps (vsync 16.7 ms) steps up after a calm period');
  run(g, 60, 16.7);
  ok(g.level === QUALITY_LEVELS.length - 1, 'keeps climbing to the top rung while frames stay smooth');
}
{
  // Hysteresis: a rung that can't hold 60 fps right after stepping up gets blocked with a growing back-off.
  const g = new QualityGovernor(1);
  run(g, governorTuning.warmup + governorTuning.upAfter + 1, 16.7);
  ok(g.level === 2, 'stepped up to rung 2');
  run(g, 3 + governorTuning.cooldown, 25); // rung 2 too heavy
  ok(g.level === 1, 'stepped back down when rung 2 was too slow');
  ok(g.blockedFor(2) > 0, 'rung 2 is blocked after failing its probation');
  let flips = 0;
  let last = g.level;
  // Simulate a machine that runs rung 1 at 60 fps and rung 2 at 40 fps for 3 minutes.
  for (let t = 0; t < 180; t += 1 / 60) {
    const ms = g.level >= 2 ? 25 : 16.7;
    g.sample(ms / 1000);
    if (g.level !== last) {
      flips++;
      last = g.level;
    }
  }
  ok(flips <= 8, `no rapid oscillation between rungs (${flips} changes in 3 min)`);
  ok(g.level === 1, 'settles on the rung that holds 60 fps');
}
{
  const g = new QualityGovernor(2);
  run(g, 4, 16.7);
  for (let i = 0; i < 20; i++) g.sample(0.25); // tab switch / loading hitches
  ok(g.level === 2, 'long hitches (> 200 ms) are ignored');
}
ok(MANUAL_LEVELS.length === 3 && MANUAL_LEVELS.every((l) => l >= 0 && l < QUALITY_LEVELS.length) && AUTO === 3, 'manual LOW/MEDIUM/HIGH map onto the ladder, 3 = AUTO');
ok(QUALITY_LEVELS.every((q, i) => i === 0 || (q.resolution >= QUALITY_LEVELS[i - 1].resolution && q.lights >= QUALITY_LEVELS[i - 1].lights)), 'ladder rungs only get richer');
ok(QUALITY_LEVELS.every((q) => q.lights <= MAX_LIGHTS), 'no rung asks for more lights than the shader holds');

// --- Light picker
{
  const pk = new LightPicker();
  const pos = new Float32Array(MAX_LIGHTS * 4);
  const col = new Float32Array(MAX_LIGHTS * 4);
  pk.begin(0, 0, 30, 5);
  for (let i = 0; i < 40; i++) pk.add(i * 0.5, 1, 0, 3, 1, 1, 1, 0.2 + i * 0.01);
  pk.add(100, 1, 100, 5, 1, 1, 1, 5); // far outside the view: dropped
  pk.add(0, 2, 0, 9, 1, 0.9, 0.7, 0.5, 1000); // lantern
  const n = pk.pick(8, pos, col);
  ok(n === 8, 'picks exactly the light budget');
  ok(pos[0] === 0 && pos[1] === 2 && pos[3] === 9, 'priority light (hero lantern) always wins the first slot');
  let far = false;
  for (let i = 0; i < n; i++) if (pos[i * 4] === 100) far = true;
  ok(!far, 'lights far from the view are ignored');

  pk.begin(0, 0, 30, 5);
  for (let i = 0; i < 300; i++) pk.addSmall(1 + (i % 3) * 0.1, 0.8, 1, 3, 1, 0, 1, 0.3); // 300 bullets in one cell
  const m = pk.pick(16, pos, col);
  ok(m === 1, 'hundreds of small emitters in one cell merge into one light');
  ok(col[0] > 0.3 && col[0] <= 2.3 && col[1] === 0, `merged light keeps the colour and is bounded (r=${col[0].toFixed(2)})`);

  pk.begin(0, 0, 30, 5);
  pk.clearFlashes();
  pk.flash(0, 1, 0, 6, 1, 0.5, 0.2, 1, 0.5);
  pk.tickFlashes(0.05);
  ok(pk.pick(4, pos, col) === 1 && col[0] > 0.5, 'a fresh flash lights up');
  pk.begin(0, 0, 30, 5);
  pk.tickFlashes(0.5);
  ok(pk.pick(4, pos, col) === 0 && pk.flashCount === 0, 'a flash is gone after its life');
}

// --- Grading
ok(Math.abs(gradeChannel(0.37, 0, 1, 1) - 0.37) < 1e-9, 'neutral grade leaves colours alone');
ok(gradeChannel(0, 0.05, 1, 1) > 0 && Math.abs(gradeChannel(1, 0.05, 1, 1) - 1) < 1e-9, 'lift raises blacks, keeps whites');
for (const b of BIOMES) {
  const g = BIOME_GRADES[b.id];
  ok(!!g, `biome ${b.id} has a grade`);
  if (!g) continue;
  // Cheerful: mid grey stays near mid grey and whites stay bright.
  const mid = [0, 1, 2].map((i) => gradeChannel(0.5, g.lift[i], g.gamma[i], g.gain[i]));
  const white = [0, 1, 2].map((i) => gradeChannel(1, g.lift[i], g.gamma[i], g.gain[i]));
  ok(mid.every((v) => v > 0.45 && v < 0.58) && white.every((v) => v > 0.9), `biome ${b.id} grade is gentle (mid ${mid.map((v) => v.toFixed(2)).join('/')})`);
}
{
  const out = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 } as typeof NEUTRAL_GRADE;
  const a = BIOME_GRADES.meadow;
  mixGrade(a, NEUTRAL_GRADE, 0, out);
  ok(out.gain[0] === a.gain[0] && out.saturation === a.saturation, 'grade mix at 0 is the first grade');
}

// --- Night stages
ok(!isNightStage(1) && !isNightStage(2) && isNightStage(3) && isNightStage(6) && !isNightStage(7), 'every third stage is a night stage');
