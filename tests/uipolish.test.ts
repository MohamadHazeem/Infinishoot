/** uipolish lane: HUD dock (corner panels never overlap), toast queue, one HELP entry. */
import { JSDOM } from 'jsdom';
import { ok } from './check';

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
(globalThis as any).matchMedia = () => ({ matches: false });
const noop: any = new Proxy(function () {}, {
  get: (_t, key) => (key === 'data' ? new Uint8ClampedArray(4 * 96 * 96) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => noop;
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(globalThis as any).Path2D = class {};
(globalThis as any).__APP_VERSION__ = 'test';

const { resolveDock, HUD_DOCK, DOCK_FREE, dockTuning, uiZoom } = await import('../src/ui/hudLayout');
type Box = Parameters<typeof resolveDock>[0][number];
const box = (x: number, y: number, w: number, h: number, dir: -1 | 0 | 1): Box => ({ x, y, w, h, dir, off: 0 });
const top = (b: Box) => b.y + b.off;
const hit = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(top(a) + a.h, top(b) + b.h) - Math.max(top(a), top(b)) > 1;
const anyHit = (bs: Box[]) => bs.some((a, i) => bs.some((b, j) => j > i && hit(a, b)));
const G = dockTuning.gap;

// ---------------------------------------------------------------- dock: the known overlaps of tonight's build
{
  // 1280x720: the weapon slots (anchor) and the Halloween candy line, both bottom-left.
  const loadout = box(20, 632, 186, 68, 0);
  const candy = box(18, 675, 182, 27, -1);
  resolveDock([loadout, candy], 2, G, 720);
  ok(top(candy) + candy.h === loadout.y - G && !hit(loadout, candy), 'candy line moves up above the weapon slots');
}
{
  // A tall goals stack (8 teammates) and the network panel under it.
  const goals = box(18, 84, 190, 236, 1);
  const net = box(20, 302, 236, 150, 1);
  resolveDock([box(0, 0, 1280, 15, 0), goals, net], 3, G, 720);
  ok(goals.off === 0 && top(net) === 84 + 236 + G, 'network panel drops below a tall goals stack (not up over the life bar)');
}
{
  // Panels that don't touch keep their CSS spots.
  const bs = [box(18, 18, 64, 64, 0), box(18, 84, 190, 120, 1), box(1068, 405, 192, 45, -1), box(946, 546, 150, 74, -1)];
  resolveDock(bs, bs.length, G, 720);
  ok(bs.every((b) => b.off === 0), 'panels with room stay where their lane put them');
}
{
  // Toast under the boss bar: pushed below it, never over the boss name.
  const timer = box(602, 24, 76, 72, 0);
  const bossbar = box(390, 100, 500, 40, 0);
  const toast = box(484, 128, 313, 44, 1);
  resolveDock([timer, bossbar, toast], 3, G, 720);
  ok(top(toast) === 140 + G && !anyHit([timer, bossbar, toast]), 'toast drops below the boss bar');
}
{
  // Bottom-anchored panels never get pushed down off screen; top ones never above 0.
  const meters = box(487, 638, 306, 60, 0);
  const team = box(508, 600, 264, 56, -1);
  const pet = box(946, 700, 150, 74, -1);
  resolveDock([meters, team, pet], 3, G, 720);
  ok(top(team) + team.h <= meters.y - G + 0.5 && top(pet) + pet.h <= 720, 'team meter sits above the special meters; a low panel is clamped into the view');
}
{
  // Crowded (phone): with no free spot the panel covers as little as possible, and avoids the anchors.
  const face = box(18, 18, 64, 64, 0);
  const hp = box(90, 27, 200, 40, 0);
  const goals = box(18, 90, 190, 200, 1);
  const tip = box(18, 120, 230, 140, 1);
  resolveDock([face, hp, goals, tip], 4, G, 390);
  ok(!hit(tip, face) && !hit(tip, hp), 'a panel with nowhere to go never covers the life bar or face');
  ok(top(tip) >= 0 && top(tip) + tip.h <= 390, 'and stays inside the view');
}
{
  // Property: random columns of panels that fit end up with no overlaps, at every UI SCALE.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let clean = 0;
  const runs = 200;
  for (let r = 0; r < runs; r++) {
    const z = [0.75, 1, 1.25, 1.5][r % 4];
    const viewH = 1080;
    const bs: Box[] = [box(0, 0, 1920, 15 * z, 0)];
    // A left column of top-anchored panels whose total height fits.
    let room = viewH - 40;
    const n = 2 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const h = Math.round((30 + rnd() * 120) * z);
      if (h + G > room / 2) break;
      room -= h + G;
      bs.push(box(18 + Math.round(rnd() * 20), Math.round(30 + rnd() * 200 * z), Math.round((150 + rnd() * 120) * z), h, 1));
    }
    resolveDock(bs, bs.length, G, viewH);
    if (!anyHit(bs) && bs.every((b) => top(b) >= 0 && top(b) + b.h <= viewH)) clean++;
  }
  ok(clean === runs, `random panel columns at UI SCALE 75-150% resolve without overlaps (${clean}/${runs})`);
}
// ---------------------------------------------------------------- hudfit: columns that don't fit degrade in steps
const { FitEngine, fitDecide, fitFlags, fitTuning, newFitColumn, FIT_MAX, columnOf, centreBox } = await import('../src/ui/hudFit');
{
  const f = [0, 1, 2, 3, 4, FIT_MAX].map(fitFlags);
  ok(!f[0].tight && f[1].tight && !f[1].fold && f[2].fold && !f[2].chip && f[3].chip && f[3].scale === 1, 'fit levels: TIGHT, FOLD, CHIP, in that order');
  ok(f[4].scale === 0.95 && f[5].scale === fitTuning.minScale, `then SCALE steps down to ${fitTuning.minScale * 100}% and no further`);
  ok(columnOf(box(18, 84, 190, 300, 1), 1280) === 0 && columnOf(box(1060, 100, 200, 90, 1), 1280) === 1 && columnOf(box(480, 520, 320, 70, -1), 1280) === -1 && columnOf(box(18, 18, 64, 64, 0), 1280) === -1, 'columns: left, right, middle row and anchors');
}
{
  // Hysteresis: one overlapping pass is not enough, two are; a column steps down only after it has fit for a while.
  const c = newFitColumn();
  ok(fitDecide(c, true, false, 0.1) === 0 && fitDecide(c, true, false, 0.1) === 1 && c.level === 1, 'a column steps up after two overflowing passes');
  ok(fitDecide(c, true, false, 0.1) === 1 && c.level === 2, 'and keeps climbing one pass per step while it overflows');
  let downs = 0;
  for (let i = 0; i < 10; i++) downs += fitDecide(c, false, true, 0.1) < 0 ? 1 : 0;
  ok(downs === 0, 'no step down before minDwell, even when the estimate fits');
  for (let i = 0; i < 12; i++) downs += fitDecide(c, false, true, 0.1) < 0 ? 1 : 0;
  ok(downs === 1 && c.level === 1, 'then one step down once the estimate has fit for downHold');
  // The step down didn't hold: it overflows right away, so step-downs pause for the cooldown.
  fitDecide(c, true, false, 0.1);
  fitDecide(c, true, false, 0.1);
  ok(c.level === 2 && c.cool > 0, 'a step down that overflows again is taken back and starts the cooldown');
  let flips = 0;
  for (let i = 0; i < 40; i++) flips += fitDecide(c, false, true, 0.1) ? 1 : 0;
  ok(flips === 0, `no step down during the ${fitTuning.cooldown} s cooldown`);
  // Content hovering at the limit: overflow blinking every other pass keeps climbing (leaky count), never flips down.
  const d = newFitColumn();
  let ups = 0;
  let back = 0;
  for (let i = 0; i < 200; i++) {
    const s = fitDecide(d, i % 2 === 0, false, 0.1);
    if (s > 0) ups++;
    if (s < 0) back++;
  }
  ok(ups > 0 && back === 0, 'an overlap that blinks on and off still steps up, and the column never flips back while the estimate says no');
}

/** Replay the dock and the fit engine on recorded boxes: each panel takes its box at its column's level. */
function replay(c: { w: number; h: number; panels: { sel: string; dir: -1 | 0 | 1; boxes: (number[] | null)[] }[] }, passes = 400) {
  const eng = new FitEngine();
  const n = c.panels.length;
  const keys = c.panels.map((_, i) => i);
  const bs: Box[] = c.panels.map(() => box(0, 0, 0, 0, 0));
  const levelOf = (i: number) => {
    const col = eng.cols[i];
    return col === 0 || col === 1 ? eng.columns[col].level : 0;
  };
  const place = () => {
    for (let i = 0; i < n; i++) {
      const p = c.panels[i];
      // null: the panel is hidden at that level (HIDE); it takes no room.
      const [x, y, w, h] = p.boxes[Math.min(levelOf(i), p.boxes.length - 1)] ?? [-9999, 0, 0, 0];
      Object.assign(bs[i], { x, y, w, h, dir: p.dir, off: 0, free: DOCK_FREE.has(p.sel) });
    }
    resolveDock(bs, n, G, c.h, centreBox(c.w, c.h));
  };
  const history: string[] = [];
  for (let k = 0; k < passes; k++) {
    place();
    eng.update(bs, keys, n, c.w, c.h, G, 0.1);
    history.push(eng.columns.map((col) => col.level).join('/'));
  }
  place();
  const bad: string[] = [];
  const centre = centreBox(c.w, c.h);
  for (let i = 0; i < n; i++) {
    const a = bs[i];
    if (a.dir && !a.free && hit(a, centre)) bad.push(`${c.panels[i].sel} on the centre`);
    if (a.dir && (top(a) < -0.5 || top(a) + a.h > c.h + 0.5)) bad.push(`${c.panels[i].sel} off screen`);
    for (let j = 0; j < i; j++) if ((a.dir || bs[j].dir) && hit(a, bs[j])) bad.push(`${c.panels[i].sel} on ${c.panels[j].sel}`);
  }
  const tail = new Set(history.slice(-150));
  return { bad, levels: history[history.length - 1], stable: tail.size === 1, anchorsStill: bs.every((b) => b.dir || b.off === 0) };
}
{
  const { HUDFIT_CASES } = await import('../src/ui/hudFitCases');
  const need = ['1280x720 125% en', '1280x720 125% ar', '1280x720 150% en', '1280x720 150% ar', '844x390', '667x375', '1920x1080'];
  ok(need.every((k) => HUDFIT_CASES.some((c) => c.name.includes(k))), 'hudfit fixtures cover the stress combo at 720p 125/150%, 1080p, both phones, English and Arabic');
  for (const c of HUDFIT_CASES) {
    const r = replay(c);
    ok(r.bad.length === 0, `${c.name}: no HUD panel overlaps another, an anchor, the centre or the screen edge (levels ${r.levels})${r.bad.length ? ': ' + r.bad.join('; ') : ''}`);
    ok(r.stable && r.anchorsStill, `${c.name}: the fit settles (no flicker) and anchors never move`);
    if (c.name.startsWith('ordinary')) ok(r.levels === '0/0', `${c.name}: ordinary play keeps the full layout (no fit step taken)`);
  }
  // Without the fit (level 0 everywhere) the stress combo does overlap: the fixtures really exercise it.
  const raw = HUDFIT_CASES.filter((c) => c.name.startsWith('stress')).filter((c) => {
    const bs = c.panels.map((p) => box(p.boxes[0]![0], p.boxes[0]![1], p.boxes[0]![2], p.boxes[0]![3], p.dir));
    resolveDock(bs, bs.length, G, c.h);
    return bs.some((a, i) => bs.some((b, j) => j < i && (a.dir || b.dir) && hit(a, b)));
  });
  ok(raw.length >= 6, `the stress fixtures overlap without the fit (${raw.length} cases), so the check above means something`);
}

ok(new Set(HUD_DOCK.map(([s]) => s)).size === HUD_DOCK.length, 'HUD_DOCK lists each panel once');
let selectorsOk = true;
for (const [s] of HUD_DOCK) {
  try {
    document.querySelectorAll(s);
  } catch {
    selectorsOk = false;
  }
}
ok(selectorsOk && HUD_DOCK.some(([s, d]) => s === '#ha-candy' && d === -1), 'HUD_DOCK selectors are valid and the candy line is a bottom-anchored dock panel');
ok(uiZoom(150, 844, 390) <= 1 && uiZoom(75, 844, 390) === 0.75, 'UI SCALE on a phone never grows the HUD');

// ---------------------------------------------------------------- toast queue
const { ToastQueue, toastTuning } = await import('../src/ui/toastQueue');
{
  const q = new ToastQueue();
  ok(q.push('A', 2, false)?.msg === 'A', 'a toast shows right away when nothing is up');
  ok(q.push('B', 2, false) === null && q.waiting.length === 1, 'a second toast waits instead of replacing the first');
  ok(q.update(toastTuning.minShow / 2, false) === null, 'the first toast keeps at least minShow seconds');
  ok(q.update(toastTuning.minShow, false)?.msg === 'B', 'then the waiting toast shows');
  ok(q.push('B', 2, false) === null && q.waiting.length === 0, 'the same message again does not queue a repeat');
  for (const m of ['C', 'D', 'E', 'F', 'G']) q.push(m, 2, false);
  ok(q.waiting.length === toastTuning.maxQueue && q.waiting[0].msg === 'D', 'a full queue drops the oldest waiting toast');
}
{
  const q = new ToastQueue();
  ok(q.push('FIRST STEPS 1/8 · BEAT A BOSS ✓', 2.6, true) === null, 'a toast during a title card waits');
  ok(q.update(1, true) === null, 'and keeps waiting while the card is up');
  ok(q.update(0.1, false)?.msg.startsWith('FIRST STEPS') === true, 'then shows once the card is gone');
  q.push('OLD NEWS', 2, true);
  for (let i = 0; i < 20; i++) q.update(1, true);
  ok(q.waiting.length === 0, 'stale toasts are dropped after maxWait');
}

// ---------------------------------------------------------------- Hud: toasts wait for the banner
const { Hud } = await import('../src/ui/hud');
const root = document.createElement('div');
root.id = 'hud';
document.body.appendChild(root);
const hud = new Hud(root);
const state = {
  hp: 100, maxHp: 100, dash01: 1, dashStock: 1, dashMax: 1, bomb01: 1, special: 'BOMB',
  score: 0, combo: 0, multiplier: 1, combo01: 1, stage: 2, level: 1, xp01: 0.2,
  timeLeft: 10, kills: 0, gold: 0, gears: 0, boss: null, spice: [], lowHp: false,
} as any;
const toastEl = root.querySelector<HTMLElement>('#toast')!;
hud.showBanner('STAGE 2', 'HAUNTED MEADOW', 2.2);
hud.toast('FIRST STEPS 1/8 · BEAT A BOSS ✓', 2.6);
hud.update(state, 0.5);
ok(!toastEl.classList.contains('show'), 'a FIRST STEPS toast does not cover the STAGE banner');
for (let i = 0; i < 20; i++) hud.update(state, 0.1);
ok(toastEl.classList.contains('show') && toastEl.textContent!.includes('FIRST STEPS'), 'it shows after the banner');
hud.toast('ELITE INCOMING', 2);
hud.update(state, 0.1);
ok(toastEl.textContent!.includes('FIRST STEPS'), 'a new toast waits its turn');
for (let i = 0; i < 30; i++) hud.update(state, 0.1);
ok(toastEl.textContent === 'ELITE INCOMING', 'then follows');
for (let i = 0; i < 30; i++) hud.update(state, 0.1);
ok(!toastEl.classList.contains('show'), 'and the toast hides when the queue is empty');

console.log('uipolish: dock, toast queue');
