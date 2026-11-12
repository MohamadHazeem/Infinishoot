/** Offline projectile-access audit at a normal 8m boss orbit; no bot steering changes. */
import { titanLayout, titanBoxes, partPos, restAngle } from '../../src/game/titan';
import { StaticBoxGrid } from '../../src/core/spatialHash';
const arms = [restAngle(-1), restAngle(1)];
const p = { x: 0, z: 0 }, q = { x: 0, z: 0 };
console.log('# Titan geometry audit\n');
console.log('| Target | x | z | Body-blocked firing angles at 8m orbit |');
console.log('|---|---|---|---|');
for (let i = 0; i < 6; i++) {
  if (i < 5) partPos(i, 0, 0, arms, p);
  else Object.assign(p, titanLayout.core);
  const grid = new StaticBoxGrid(titanBoxes(0, 0, i < 5));
  const radius = i < 2 ? 1.6 : i < 5 ? 1.5 : 2.2;
  let blocked = 0, walkable = 0;
  for (let k = 0; k < 360; k++) {
    const a = k * Math.PI / 180, ux = Math.cos(a), uz = Math.sin(a);
    if (grid.hitCircle(p.x + ux * 8, p.z + uz * 8, 0.45)) continue;
    walkable++;
    for (let d = 8; d > radius + 0.12; d -= 0.05) {
      if (!grid.hitSolid(p.x + ux * d, p.z + uz * d, 0.12)) continue;
      blocked++; break;
    }
  }
  console.log(`| ${['left plate','right plate','left hand','right hand','eye','core'][i]} | ${p.x.toFixed(2)} | ${p.z.toFixed(2)} | ${blocked}/${walkable} (${(100 * blocked / walkable).toFixed(1)}%) |`);
}
partPos(2, 0, 0, arms, p); partPos(3, 0, 0, arms, q);
console.log(`\nResting hand-to-hand travel: ${Math.hypot(q.x - p.x, q.z - p.z).toFixed(2)}m. Torso width ${titanLayout.torso.hx * 2}m; arms ${titanLayout.arm}m.`);
