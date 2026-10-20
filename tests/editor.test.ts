/**
 * Editor lane: custom arenas.
 * - pure data: piece catalog, normalisation, the reachability check, place/erase/rotate, undo/redo
 * - share codes: round trips (plain and deflated), checksum, truncation, garbage fuzz, inflate bombs
 * - colliders built from the data match the three.js arena the game builds
 * - saved arenas (20 slots) and per-arena best scores
 * - a whole solo run on a custom arena (spawns, boss marker, rules, chests, cleanup)
 * - host + client: the client rebuilds the same arena from the start message
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
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
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
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

const D = await import('../src/editor/arenaData');
const { PIECES, PIECE_ORDER, PIECE_BY_ID, MAX_PIECES } = await import('../src/editor/pieces');
const C = await import('../src/editor/codec');
const O = await import('../src/editor/ops');
const { EditHistory } = await import('../src/editor/history');
const { SAMPLE_IDS, sampleArena } = await import('../src/editor/samples');
const { buildCustomArena } = await import('../src/editor/build');
const S = await import('../src/editor/store');
const { en } = await import('../src/i18n/en');
const { ar } = await import('../src/i18n/ar');
const { ENEMIES } = await import('../src/data/enemies');
const { biomeForce } = await import('../src/data/biomes');

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ catalog and strings
{
  ok(PIECE_ORDER.length === PIECES.length && new Set(PIECE_ORDER).size === PIECE_ORDER.length && PIECES.every((p) => PIECE_ORDER.includes(p.id)), 'every piece has one wire index');
  ok(PIECE_ORDER.length <= 64, 'piece kinds fit the 6-bit wire field');
  const keys = [
    ...PIECES.flatMap((p) => [`editor.piece.${p.id}`, `editor.desc.${p.id}`]),
    ...D.WAVE_IDS.map((w) => `editor.waves.${w}`),
    ...['noHero', 'heroBlocked', 'heroHazard', 'heroSplit', 'bossBlocked', 'bossUnreachable', 'cramped', 'chestUnreachable', 'turretUnreachable', 'gateBlocked', 'noBoss'].map((i) => `editor.issue.${i}`),
    ...D.SIZES.map((s) => `editor.size.${s.id}`),
    ...['prefix', 'base64', 'size', 'checksum', 'format', 'inflate'].map((r) => `editor.bad.${r}`),
    ...['bounds', 'max', 'full', 'overlap'].map((r) => `editor.fail.${r}`),
  ];
  const missing = keys.filter((k) => !(k in en) || !(k in ar));
  ok(missing.length === 0, `editor strings exist in English and Arabic (${missing.join(', ') || 'all'})`);
  const slots = (s: string) => [...s.matchAll(/⟪(\w+)⟫/g)].map((m) => m[1]).sort().join();
  const bad = Object.keys(en).filter((k) => k.startsWith('editor.') && slots((en as any)[k]) !== slots((ar as any)[k] ?? ''));
  ok(bad.length === 0, `Arabic keeps every ⟪slot⟫ (${bad.join(', ') || 'all'})`);
  ok(D.bossChoices().length >= 12 && D.bossChoices().every((id) => id === 'auto' || ENEMIES[id]?.boss), 'boss choices are real bosses (incl. biome, remix and the Titan)');
  ok(D.rosterFoes().length >= 25 && D.rosterFoes().every((d) => !d.boss && !d.hidden && d.weight > 0), 'the custom enemy list is the regular roster');
  for (const w of D.WAVE_PRESETS) ok(w.foes.every((id) => ENEMIES[id] && ENEMIES[id].weight > 0), `wave preset ${w.id}: real enemies`);
}

// ------------------------------------------------------------------ normalisation
{
  const n = D.normalizeArena({ name: '  <b>hi</b>\u0007 there & "you" ', size: 'zz', rules: { biome: 'nope', time: 9999, boss: 'swarmer', difficulty: 'legend', heat: ['armor', 'bogus', 'armor'], waves: 'custom', foes: [] }, pieces: [
    { k: 'wall', x: 0, z: 0, r: 0 },
    { k: 'wall', x: 400, z: 0, r: 0 }, // outside
    { k: 'ghost', x: 2, z: 2, r: 0 }, // unknown
    { k: 'boss', x: 4, z: 4, r: 9 },
    { k: 'boss', x: -4, z: 4, r: 0 }, // over the cap of 1
    { k: 'pillar', x: 'a', z: 1, r: 0 },
    null,
  ] });
  ok(n.name === 'BHI/B THERE YOU', `names lose markup/control characters and are upper-cased (${n.name})`);
  ok(n.size === 'm' && n.rules.biome === 'meadow' && n.rules.time === D.TIME_MAX && n.rules.boss === 'auto' && n.rules.difficulty === 'normal', 'bad sizes and rules fall back');
  ok(n.rules.waves === 'classic', 'custom waves with no enemies fall back to classic');
  ok(same(n.rules.heat, ['armor']), 'heat keeps known ids once');
  ok(n.pieces.length === 2 && n.pieces[1].k === 'boss' && n.pieces[1].r === 3, 'out-of-bounds, unknown, over-cap and malformed pieces are dropped; rotation clamped');
  ok(D.normalizeArena(null).pieces.length === 0 && D.normalizeArena('x').name === 'CUSTOM ARENA', 'garbage normalises to an empty arena');
  const many = { pieces: Array.from({ length: 900 }, (_, i) => ({ k: 'tree', x: (i % 60) - 30, z: Math.floor(i / 60) * 2 - 30, r: 0 })), size: 'xl' };
  ok(D.normalizeArena(many).pieces.length === Math.min(MAX_PIECES, PIECE_BY_ID.tree.max), 'piece caps apply (per kind and overall)');
  ok(!D.insideArena('pad', 30, 0, 0, 34) && D.insideArena('pad', 10, 0, 0, 34), "a jump pad's landing spot must be inside the arena");
}

// ------------------------------------------------------------------ validity
{
  for (const id of SAMPLE_IDS) {
    const v = D.validateArena(sampleArena(id));
    ok(v.ok, `sample ${id} is playable (${v.errors.map((e) => e.id).join(',') || 'no errors'}, ${v.area} m²)`);
  }
  const base = () => D.normalizeArena({ size: 's', pieces: [{ k: 'hero', x: 0, z: 10, r: 0 }, { k: 'boss', x: 0, z: -10, r: 0 }] });
  ok(D.validateArena(base()).ok, 'one hero and a boss on open ground is playable');
  const none = base();
  none.pieces = none.pieces.filter((p) => p.k !== 'hero');
  ok(D.validateArena(none).errors.some((e) => e.id === 'noHero'), 'no hero spawn is an error');
  const boxed = base();
  // A closed ring of cover blocks around the boss.
  const ring = (a: ReturnType<typeof base>, cx: number, cz: number, R: number) => {
    for (let k = -R; k <= R; k += 2) for (const [x, z] of [[cx + k, cz - R], [cx + k, cz + R], [cx - R, cz + k], [cx + R, cz + k]]) O.placePiece(a, { k: 'block', x, z, r: 0 });
  };
  ring(boxed, 0, -10, 4);
  const vb = D.validateArena(boxed);
  ok(!vb.ok && vb.errors.some((e) => e.id === 'bossUnreachable'), 'a boss walled in is unreachable');
  O.placePiece(boxed, { k: 'pad', x: 0, z: 2, r: 3 }); // pad at z=2 launching north 12 m lands at z=-10
  ok(D.validateArena(boxed).ok, 'a jump pad into the box makes the boss reachable');
  const blocked = base();
  blocked.pieces.push({ k: 'pillar', x: 0, z: 10, r: 0 });
  ok(D.validateArena(blocked).errors.some((e) => e.id === 'heroBlocked'), 'a spawn inside cover is blocked');
  const hot = base();
  hot.pieces.push({ k: 'lava', x: 0, z: 10, r: 1 });
  ok(D.validateArena(hot).errors.some((e) => e.id === 'heroHazard'), 'a spawn in lava is an error');
  const split = base();
  split.pieces.push({ k: 'hero', x: 0, z: -18, r: 0 });
  for (let x = -22; x <= 22; x += 2) O.placePiece(split, { k: 'block', x, z: -14, r: 0 });
  ok(D.validateArena(split).errors.some((e) => e.id === 'heroSplit'), 'spawns walled apart are an error');
  const cramped = D.normalizeArena({ size: 's', pieces: [{ k: 'hero', x: 0, z: 0, r: 0 }] });
  ring(cramped, 0, 0, 4);
  ok(D.validateArena(cramped).errors.some((e) => e.id === 'cramped'), 'a tiny pen is too cramped');
}

// ------------------------------------------------------------------ editing ops and history
{
  const a = D.normalizeArena({ size: 'm', pieces: [] });
  ok(O.placePiece(a, { k: 'wall', x: 0, z: 0, r: 0 }) === 'ok', 'place a wall');
  ok(O.placePiece(a, { k: 'crate', x: 1, z: 0, r: 0 }) === 'overlap', 'objects may not overlap');
  ok(O.placePiece(a, { k: 'lava', x: 0, z: 0, r: 1 }) === 'ok', 'ground patches lie under objects');
  ok(O.placePiece(a, { k: 'wall', x: 33, z: 0, r: 0 }) === 'bounds', 'too close to the edge');
  ok(O.placePiece(a, { k: 'boss', x: 10, z: 10, r: 0 }) === 'ok' && O.placePiece(a, { k: 'boss', x: -10, z: 10, r: 0 }) === 'moved' && D.countOf(a, 'boss') === 1, 'the one boss marker moves instead of failing');
  for (let i = 0; i < 8; i++) O.placePiece(a, { k: 'hero', x: -20 + i * 3, z: 20, r: 0 });
  ok(O.placePiece(a, { k: 'hero', x: 0, z: 26, r: 0 }) === 'max', 'piece caps apply when placing');
  ok(O.rotatePieceAt(a, 0, 0) && a.pieces.find((p) => p.k === 'wall')!.r === 1, 'rotate the piece under the cursor (topmost first: the wall over the lava)');
  ok(O.erasePiece(a, 0, 0)?.k === 'wall' && O.erasePiece(a, 0, 0)?.k === 'lava', 'erase takes the object first, then the ground');
  O.placePiece(a, { k: 'tree', x: 30, z: 30, r: 0 });
  ok(O.resizeArena(a, 's') >= 1 && a.pieces.every((p) => D.insideArena(p.k, p.x, p.z, p.r, 24)), 'shrinking drops what no longer fits');
  ok(O.snapPos(3.4, true) === 4 && O.snapPos(3.4, false) === 3, 'grid snap: even metres / whole metres');
  const h = new EditHistory();
  const cur = D.normalizeArena({ pieces: [] });
  h.push(cur);
  cur.pieces.push({ k: 'tree', x: 0, z: 0, r: 0 });
  const back = h.undo(cur)!;
  ok(back.pieces.length === 0 && h.canRedo, 'undo restores the state before the change');
  const fwd = h.redo(back)!;
  ok(fwd.pieces.length === 1 && h.canUndo && !h.canRedo, 'redo brings it back');
  h.push(fwd);
  ok(!h.canRedo, 'a new change drops the redo future');
}

// ------------------------------------------------------------------ share codes
{
  for (const id of SAMPLE_IDS) {
    const a = sampleArena(id);
    const code = C.arenaCode(a);
    const back = C.readArenaCodeSync(code);
    ok(same(back, a), `sample ${id}: plain code round trip (${code.length} chars)`);
    const small = await C.arenaCodeSmall(a);
    ok(same(await C.readArenaCode(small), a), `sample ${id}: short code round trip (${small.length} chars, ${small.startsWith('ISA1z.') ? 'deflated' : 'plain'})`);
    ok(same(await C.readArenaCode(`hey try my arena!\n  ${code.slice(0, 20)}\n${code.slice(20)}  `), a), `sample ${id}: codes survive chat line breaks and surrounding text`);
  }
  const demo = sampleArena('demo');
  ok(C.arenaCode(demo).length < 400, `a 46-piece arena is a short code (${C.arenaCode(demo).length} chars)`);
  const full = D.normalizeArena({ size: 'xl', pieces: Array.from({ length: 400 }, (_, i) => ({ k: PIECE_ORDER[i % 10], x: ((i * 7) % 100) - 50, z: Math.floor(i / 10) * 2 - 50, r: i & 3 })) });
  ok(same(C.readArenaCodeSync(C.arenaCode(full)), full), `a big arena round trips (${full.pieces.length} pieces, ${C.arenaCode(full).length} chars)`);
  const err = (f: () => unknown): string => {
    try {
      f();
      return 'none';
    } catch (e) {
      return e instanceof C.ArenaCodeError ? e.reason : `other:${(e as Error).message}`;
    }
  };
  const code = C.arenaCode(demo);
  const flip = code.slice(0, 40) + (code[40] === 'A' ? 'B' : 'A') + code.slice(41);
  ok(err(() => C.readArenaCodeSync(flip)) === 'checksum', 'one changed character fails the checksum');
  ok(['checksum', 'format', 'size', 'base64'].includes(err(() => C.readArenaCodeSync(code.slice(0, code.length - 9)))), 'a truncated code is rejected');
  ok(err(() => C.readArenaCodeSync('hello')) === 'prefix', 'text without a code is rejected');
  ok(err(() => C.readArenaCodeSync('ISA1.' + 'A'.repeat(20000))) === 'size', 'an oversized code is rejected');
  // A body with a valid checksum but a lying piece count.
  const body = C.packArena(demo);
  const lie = body.slice();
  const n = lie.length - 4;
  lie[n - demo.pieces.length * 3 - 1] = 255;
  const c = C.crc32(lie, n);
  lie[n] = c >>> 24; lie[n + 1] = (c >>> 16) & 255; lie[n + 2] = (c >>> 8) & 255; lie[n + 3] = c & 255;
  ok(err(() => C.unpackArena(lie)) === 'format', 'a valid checksum over a broken body is still rejected');
  // Fuzz: random and mutated codes never throw anything but ArenaCodeError, and anything accepted is normalised.
  let weird = 0;
  let accepted = 0;
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 600; i++) {
    let s: string;
    if (i % 3 === 0) s = 'ISA1.' + Array.from({ length: Math.floor(rnd() * 200) }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Math.floor(rnd() * 64)]).join('');
    else {
      const b = C.packArena(i % 2 ? demo : sampleArena('pit'));
      for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      // Re-sign half of them so the parser (not just the checksum) gets exercised.
      if (i % 2) {
        const m = b.length - 4;
        const cc = C.crc32(b, m);
        b[m] = cc >>> 24; b[m + 1] = (cc >>> 16) & 255; b[m + 2] = (cc >>> 8) & 255; b[m + 3] = cc & 255;
      }
      s = C.CODE_PREFIX + C.b64url(b);
    }
    try {
      const a = C.readArenaCodeSync(s);
      accepted++;
      if (!same(a, D.normalizeArena(a))) weird++;
    } catch (e) {
      if (!(e instanceof C.ArenaCodeError)) weird++;
    }
  }
  ok(weird === 0, `600 garbage/mutated codes: only clean rejections or normalised arenas (${accepted} decoded)`);
  if (typeof CompressionStream !== 'undefined') {
    // An inflate bomb: 1 MB of zeros deflates to ~1 KB.
    const zeros = new Uint8Array(1 << 20);
    const z = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let reason = 'none';
    try {
      await C.readArenaCode(C.CODE_PREFIX_Z + C.b64url(z));
    } catch (e) {
      reason = e instanceof C.ArenaCodeError ? e.reason : 'other';
    }
    ok(reason === 'size', `a deflate bomb stops at the size cap (${z.length} bytes in)`);
    let r2 = 'none';
    try {
      await C.readArenaCode(C.CODE_PREFIX_Z + 'AAAA');
    } catch (e) {
      r2 = e instanceof C.ArenaCodeError ? e.reason : 'other';
    }
    ok(r2 !== 'none' && r2 !== 'other', `a broken deflated code is rejected (${r2})`);
  }
}

// ------------------------------------------------------------------ colliders from data match the built arena
{
  const key = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => [b.minX, b.maxX, b.minZ, b.maxZ].map((v) => v.toFixed(3)).join(',');
  for (const id of SAMPLE_IDS) {
    const a = sampleArena(id);
    const arena = buildCustomArena(a, 1234);
    const want = D.pieceColliders(a).map(key);
    const have = new Set(arena.colliders.map(key));
    ok(want.every((k) => have.has(k)), `${id}: every solid piece is a collider in the built arena (${want.length})`);
    const half = D.SIZE_HALF[a.size];
    const extra = arena.colliders.length - want.length;
    ok(extra === 4 + (half < 54 ? 4 : 0), `${id}: plus the island edge${half < 54 ? ' and the fence' : ''} only (${extra})`);
    ok(arena.halfSize === half, `${id}: halfSize follows the size preset (${half})`);
    const hz = (k: string) => arena.hazards.filter((h) => h.kind === k).length;
    ok(hz('lava') === D.countOf(a, 'lava') && hz('ice') === D.countOf(a, 'ice') && hz('quicksand') === D.countOf(a, 'sand') && hz('thorns') === D.countOf(a, 'thorns') && hz('water') === D.countOf(a, 'water'), `${id}: one hazard zone per patch`);
    ok(arena.conveyors.length === D.countOf(a, 'belt') && arena.turrets.length === D.countOf(a, 'turret') && arena.pads.length === D.countOf(a, 'pad') && arena.chests.length === D.countOf(a, 'chest'), `${id}: belts, turrets, pads and chest spots`);
    ok(arena.props.length === D.countOf(a, 'crate') + D.countOf(a, 'stack') + D.countOf(a, 'topple') && arena.barrels.length === D.countOf(a, 'barrel'), `${id}: breakable props and barrels`);
    ok(arena.spots.length >= 4 && arena.spots.every((s) => !arena.colliders.some((b) => s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.maxZ)), `${id}: objective spots on open ground (${arena.spots.length})`);
    const again = buildCustomArena(a, 1234);
    ok(same(again.colliders, arena.colliders) && same(again.spots, arena.spots), `${id}: same data + seed = same arena (co-op machines agree)`);
    // The water pond comes after every hazard that hurts, so lookups find lava first.
    const firstWater = arena.hazards.findIndex((h) => (h.kind as string) === 'water');
    ok(firstWater < 0 || arena.hazards.slice(firstWater).every((h) => (h.kind as string) === 'water'), `${id}: ponds are listed last`);
  }
}

// ------------------------------------------------------------------ saved arenas and bests
{
  localStorage.clear();
  const ids: string[] = [];
  for (let i = 0; i < S.MAX_SAVED; i++) {
    const id = `a${i}`;
    ids.push(id);
    ok(S.saveArena(id, { ...sampleArena('demo'), name: `ARENA ${i}` }) || i >= S.MAX_SAVED, i === 0 ? 'save arenas' : `save ${i}`);
  }
  ok(S.savedArenas().length === S.MAX_SAVED && !S.saveArena('extra', sampleArena('pit')), `${S.MAX_SAVED} slots; a new one past that is refused`);
  ok(S.saveArena('a3', sampleArena('pit')) && S.savedArenas()[0].id === 'a3' && S.savedArenas()[0].arena.name === 'LAVA PIT', 'saving an existing slot replaces it and moves it to the top');
  S.deleteArena('a5');
  ok(S.savedArenas().length === S.MAX_SAVED - 1 && !S.savedArenas().some((e) => e.id === 'a5'), 'delete');
  localStorage.setItem('infinishoot.arenas.v1', JSON.stringify([{ id: '<x>', arena: { name: 'evil', pieces: 'nope' } }, 5, null, { id: 'ok1', arena: sampleArena('pit') }]));
  const list = S.savedArenas();
  ok(list.length === 2 && list[0].id === 'x' && list[0].arena.pieces.length === 0 && list[1].arena.name === 'LAVA PIT', 'a tampered store is cleaned on load');
  localStorage.setItem('infinishoot.arenas.v1', '{broken');
  ok(S.savedArenas().length === 0, 'a broken store reads as empty');
  const pit = sampleArena('pit');
  ok(S.recordArenaRun(pit, { score: 100, stage: 1, kills: 10, date: '2026-10-20' }) && !S.recordArenaRun(pit, { score: 50, stage: 1, kills: 5, date: '2026-10-20' }) && S.bestFor(pit)!.score === 100, 'per-arena best keeps the higher score');
  const moved = copy(pit);
  moved.pieces.reverse();
  ok(S.bestFor(moved)?.score === 100, 'the best follows the layout, not the order pieces were placed');
  moved.pieces[0].x += 2;
  ok(!S.bestFor(moved), 'a changed layout has its own best');
  localStorage.clear();
}

// ------------------------------------------------------------------ a solo run on a custom arena
const { Input } = await import('../src/core/input');
const { Game, cheats, chestTuning } = await import('../src/game/game');
const { save } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { lookOverrides } = await import('../src/game/systems/look');
const { weatherForce } = await import('../src/game/ambience');
const { windForce } = await import('../src/game/wind');
const { worldEventTuning } = await import('../src/game/worldEvents');
const { editorState, playArenaSolo, pickLobbyArena, editorNet } = await import('../src/game/systems/editor');
const { loadHighScores } = await import('../src/game/highscores');
const { directorTuning } = await import('../src/game/director');

save.training.offered = true;
settings.autoFire = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const g = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const step = (game: InstanceType<typeof Game>, n: number) => {
  for (let i = 0; i < n; i++) game.update(1 / 60);
};
ok(!!document.querySelector('#scr-extras [data-act=ae-open]'), 'EXTRAS has ARENA EDITOR');
ok(!!document.querySelector('#scr-arenas') && !!document.querySelector('#scr-arenaedit'), 'the list and editor screens are registered');
{
  // The editor screen itself: open, place, undo, rules, share.
  const sc = editorState(g).screen;
  sc.openEditor(sampleArena('demo'));
  ok(g.screens.current === 'arenaedit' && sc.validity?.ok === true, 'the editor opens on a sample and says it is playable');
  const n0 = sc.arena.pieces.length;
  sc.setCursor(-16, 26, 'crate');
  (sc as any).place();
  ok(sc.arena.pieces.length === n0 + 1, 'placing from the cursor adds a piece');
  (sc as any).undo();
  ok(sc.arena.pieces.length === n0, 'undo removes it');
  (sc as any).stepRule('time', 1);
  ok(sc.arena.rules.time === 210, 'a rule steps forward');
  (sc as any).stepRule('biome', 1);
  ok(sc.arena.rules.biome !== 'meadow', 'the biome cycles');
  g.leaveToTitle();
}
{
  cheats.god = true;
  const a = sampleArena('demo');
  a.rules.boss = 'kraken';
  a.rules.waves = 'custom';
  a.rules.foes = ['zippy', 'chonk'];
  a.rules.night = true;
  a.rules.rain = true;
  a.rules.wind = true;
  a.rules.events = false;
  a.rules.rings = false;
  a.rules.heat = ['armor'];
  a.rules.difficulty = 'hard';
  const before = { biome: biomeForce.key, night: lookOverrides.night, weather: weatherForce.mode, wind: windForce.on, events: worldEventTuning.enabled };
  playArenaSolo(g, a, false);
  if (g.mode === 'shop') g.closeShop();
  ok(customOk(g), 'a solo custom run starts');
  ok(g.arena.halfSize === 34 && biomeForce.key === 'meadow', 'the arena is the custom one, in its biome');
  ok(lookOverrides.night === true && weatherForce.mode === 'rain' && windForce.on && !worldEventTuning.enabled, 'night, rain, wind and events-off are applied');
  ok(g.difficulty.id === 'normal' || g.difficulty.id === 'hard', `difficulty from the rules (locked ones fall back): ${g.difficulty.id}`);
  ok(Math.abs(g.director.duration - a.rules.time) < 1e-6, `stage time follows the rules (${g.director.duration} s)`);
  ok(g.meta.heat.join() === 'armor', 'heat rules apply');
  ok(g.runLabel.includes('SUNNY PLAZA'), `scores and history name the arena (${g.runLabel})`);
  const h0 = a.pieces.find((p) => p.k === 'hero')!;
  ok(Math.hypot(g.hero.player.x - h0.x, g.hero.player.z - h0.z) < 0.01, 'the hero starts on the first hero spawn');
  const pool = g.director.pool().map((d) => d.id).sort().join();
  ok(pool === 'chonk,zippy', `the enemy mix is the custom list (${pool})`);
  const spawned = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const pos = g.spawnEnemy(g.director.pool()[i % 2]);
    if (pos) spawned.add(`${Math.round(pos.x)},${Math.round(pos.z)}`);
  }
  ok(spawned.size > 5, 'enemies spawn around the heroes and at the gates');
  const ringsBefore = g.enemies.activeCount;
  g.spawnRing(ENEMIES.swarmer, 20);
  ok(g.enemies.activeCount === ringsBefore, 'swarm rings are off');
  // Chests appear on chest spots.
  g.chests.clear();
  g.chestT = chestTuning.every;
  g.updateChestSpawns(0.01);
  const chestSpots = a.pieces.filter((p) => p.k === 'chest');
  ok(g.chests.list.length <= 1 && g.chests.list.every((c) => chestSpots.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.01)), 'timed chests land on chest spots');
  // The boss lands on its marker and is the rules' boss.
  g.enemies.clear();
  g.director.time = g.director.duration;
  step(g, 2);
  const bm = a.pieces.find((p) => p.k === 'boss')!;
  ok(!!g.boss && g.boss.def.id === 'kraken', `the boss is the rules' pick (${g.boss?.def.id})`);
  ok(!!g.boss && Math.hypot(g.boss.x - bm.x, g.boss.z - bm.z) < 3, 'the boss lands on the boss marker');
  // Game over banks to the arena's own table, not the main high scores.
  const mainBefore = JSON.stringify(loadHighScores());
  g.endRun();
  ok(JSON.stringify(loadHighScores()) === mainBefore, 'the main high-score table is untouched');
  ok((editorState(g).newBest || false) === true, 'the run became the arena best');
  // Retry keeps the arena; leaving to the title restores every override.
  g.retry();
  if (g.mode === 'shop') g.closeShop();
  ok(customOk(g) && g.arena.halfSize === 34, 'RETRY replays the same custom arena');
  g.leaveToTitle();
  ok(!editorState(g).active && biomeForce.key === before.biome && lookOverrides.night === before.night && weatherForce.mode === before.weather && windForce.on === before.wind && worldEventTuning.enabled === before.events, 'the title restores biome, night, weather, wind and events');
  g.startSolo();
  ok(!editorState(g).active && g.arena.halfSize === 55, 'a normal run after a custom one is normal');
  if (g.mode === 'shop') g.closeShop();
  g.leaveToTitle();
  // Every boss works on a custom arena.
  for (const id of D.bossChoices().filter((x) => x !== 'auto')) {
    const b = sampleArena('fortress');
    b.rules.boss = id;
    playArenaSolo(g, b, false);
    if (g.mode === 'shop') g.closeShop();
    g.director.time = g.director.duration;
    let crashed = '';
    try {
      step(g, 30);
    } catch (e) {
      crashed = (e as Error).message;
    }
    ok(!crashed && (!!g.boss || g.enemies.list.some((e) => e.alive && e.def.boss)), `boss ${id} spawns and runs on a custom arena${crashed ? `: ${crashed}` : ''}`);
    g.leaveToTitle();
  }
  ok(Math.abs(directorTuning.stageSeconds - 240) < 1e-9, 'director tuning untouched');
}

function customOk(game: InstanceType<typeof Game>): boolean {
  return !!editorState(game).active && game.mode === 'fight';
}

// ------------------------------------------------------------------ host + client
{
  const B = new Game(new Input(canvas), 16 / 9, document.createElement('div'), document.createElement('div'));
  const q: any[] = [];
  const toA: any[] = [];
  (g as any).host = { code: 'TESTA', clientIds: ['peerB'], send: (_id: string, m: any) => q.push(m), broadcast: (m: any) => q.push(m), close() {}, kick() {} };
  (g as any).role = 'host';
  (B as any).role = 'client';
  (B as any).client = { send: (m: any) => toA.push(m), close() {} };
  g.lobbyKind = 'coop';
  g.setHeroes([g.hero, g.makeHero(1, 'Guest', [], 'peerB')]);
  const pit = sampleArena('pit');
  pickLobbyArena(g, { id: 'pit1', arena: pit });
  const flush = () => {
    while (q.length) B.onClientMessage(structuredClone(q.shift()));
    while (toA.length) g.onHostMessage('peerB', structuredClone(toA.shift()));
  };
  flush();
  ok(editorState(B).screen && (document.querySelector('#scr-online .ae-lobby') !== null), 'the lobby has the arena line');
  g.startRun();
  const start = q.find((m) => m.t === 'start');
  ok(typeof start?.arena === 'string' && start.arena.length < 400, `the start message carries the packed arena (${start?.arena?.length} chars)`);
  flush();
  ok(!!editorState(B).active && editorState(B).active!.name === 'LAVA PIT', 'the client has the arena');
  const key = (c: { minX: number; maxX: number; minZ: number; maxZ: number }[]) => c.map((b) => [b.minX, b.maxX, b.minZ, b.maxZ].map((v) => v.toFixed(3)).join(',')).sort().join(';');
  // Other systems may add their own colliders on the host (objective totems, supply drops); the arena's own must match.
  const ka = key(g.arena.colliders).split(';');
  const kb = key(B.arena.colliders).split(';');
  const mine = key(D.pieceColliders(pit)).split(';');
  ok(mine.every((k) => ka.includes(k) && kb.includes(k)) && kb.every((k) => ka.includes(k)), `host and client built the same arena colliders (${mine.length} pieces; host ${ka.length}, client ${kb.length})`);
  ok(B.arena.halfSize === g.arena.halfSize, 'and the same size');
  ok(same(B.arena.hazards, g.arena.hazards) && same(B.arena.pads, g.arena.pads) && same(B.arena.conveyors, g.arena.conveyors), 'and the same hazards, pads and belts');
  ok(biomeForce.key === 'magma' && editorNet(g) === start.arena, 'every machine is on the arena biome');
  if (g.mode === 'shop') g.heroAction(g.hero, 'done', 0, 1);
  flush();
  for (let i = 0; i < 60; i++) {
    g.update(1 / 60);
    flush();
    B.update(1 / 60);
  }
  ok(g.mode === 'fight' || g.mode === 'shop', `the co-op run plays (${g.mode})`);
  // An ordinary start clears the client's custom arena.
  B.onClientMessage({ t: 'start', seed: 5, you: 1, difficulty: 'normal', players: [{ name: 'Host' }, { name: 'Guest' }] });
  ok(!editorState(B).active, 'an ordinary start message clears a stale custom arena on the client');
  B.onClientMessage({ t: 'start', arena: 'garbage!!', seed: 5, you: 1, difficulty: 'normal', players: [{ name: 'Host' }, { name: 'Guest' }] });
  ok(!editorState(B).active, 'a bad arena in a start message is ignored safely');
}
cheats.god = false;
console.log('editor: catalog, codes, validity, colliders, store, solo and co-op passed');
process.exit(process.exitCode ?? 0);
