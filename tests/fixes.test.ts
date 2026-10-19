/**
 * Fixes lane: pure logic (line of sight, parry rewind, lifesteal cap, TURN
 * config, ping wheel, team combos) plus a few checks in the real game (jsdom).
 */
import { ok } from './check';
import { StaticBoxGrid } from '../src/core/spatialHash';

// ---- Line of sight over the static wall grid ----
{
  const wall = { minX: 4, maxX: 6, minZ: -3, maxZ: 3 };
  const far = { minX: 40, maxX: 42, minZ: 40, maxZ: 42 };
  const g = new StaticBoxGrid([wall, far]);
  ok(!g.segmentClear(0, 0, 10, 0), 'LOS: a wall between blocks the line');
  ok(g.segmentClear(0, 5, 10, 5), 'LOS: a line passing beside the wall is clear');
  ok(!g.segmentClear(0, 3.2, 10, 3.2, 0.3), 'LOS: the pad fattens the line (grazing the wall corner)');
  ok(g.segmentClear(0, 3.2, 10, 3.2, 0), 'LOS: without pad the grazing line is clear');
  ok(!g.segmentClear(10, 0, 0, 0), 'LOS: blocked both ways');
  ok(!g.segmentClear(5, -10, 5, 10), 'LOS: vertical line through the wall');
  ok(g.segmentClear(0, 0, 3.9, 0), 'LOS: stopping short of the wall is clear');
  ok(!g.segmentClear(-20, -20, 50, 50),'LOS: a long diagonal through the far box is blocked');
  ok(g.segmentClear(-20, -20, 30, -5), 'LOS: a long diagonal that misses everything is clear');
  ok(!g.segmentClear(-7.3, 0.1, 13.9, -0.4), 'LOS: negative coordinates and cell crossings');
}
