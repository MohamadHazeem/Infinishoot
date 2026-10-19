import { ok } from './check';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { validateMod, parseMod, MOD_LIMITS } from '../src/mods/schema';
import { planMods, installPlan, hashMods, matchingMods, canonical, type ModFile } from '../src/mods/registry';
import { readModArchive } from '../src/mods/archive';
import { WEAPONS } from '../src/data/weapons';
import { ENEMIES } from '../src/data/enemies';
import { RELIC_BY_ID, RELICS } from '../src/data/relics';
import { MOD_BY_ID, MODS } from '../src/data/mods';
import { biomeForStage, biomeByKey, BIOMES } from '../src/data/biomes';
import { STAGE_EVENTS, EVENT_IDS, eventBehavior } from '../src/data/stageEvents';
import { RunEvents } from '../src/game/runEvents';
import { packEnemies, unpackEnemies } from '../src/net/codec';
import { Rng } from '../src/core/rng';
import { baseStats } from '../src/game/stats';
import { createWeapon } from '../src/game/weapons';
import * as THREE from 'three';

const raw = readFileSync('docs/mods/example.json', 'utf8');
const example = JSON.parse(raw);
const file = (raw: string, enabled = true, key = 'test'): ModFile => ({ key, name: key + '.json', raw, enabled });
const modify = (fn: (x: any) => void) => { const x = JSON.parse(raw); fn(x); return x; };
ok(validateMod(example).ok, 'example covers all six content categories');
for (const [label, fn] of [
  ['schema version', (x: any) => x.schemaVersion = 2],
  ['unknown top-level field', (x: any) => x.script = 'alert(1)'],
  ['unknown category', (x: any) => x.content.scripts = []],
  ['missing content', (x: any) => x.content = {}],
  ['invalid namespace', (x: any) => x.content.enemies[0].id = 'other_foe'],
  ['duplicate id', (x: any) => x.content.enemies.push(x.content.enemies[0])],
  ['unknown template', (x: any) => x.content.enemies[0].base = 'not_shipped'],
  ['prototype template', (x: any) => x.content.enemies[0].base = 'constructor'],
  ['unknown field', (x: any) => x.content.enemies[0].set.hpp = 4],
  ['non-number stats', (x: any) => x.content.enemies[0].set.hp = '40'],
  ['non-finite stats', (x: any) => x.content.enemies[0].set.hp = Infinity],
  ['negative radius', (x: any) => x.content.enemies[0].set.radius = -2],
  ['bad colour', (x: any) => x.content.enemies[0].set.bodyColor = 'red'],
  ['markup', (x: any) => x.name = '<img src=x onerror=alert(1)>'],
  ['silent shipped override', (x: any) => x.content.enemies[0].id = 'bopper'],
  ['invalid override type', (x: any) => x.content.enemies[0].override = 'true'],
  ['behaviour-changing override', (x: any) => { x.content.enemies[0].id = 'zippy'; x.content.enemies[0].override = true; }],
  ['scripted boss', (x: any) => x.content.enemies[0].base = 'king'],
  ['scripted relic', (x: any) => x.content.relics[0].base = 'r_dashbomb'],
  ['unsupported weapon', (x: any) => x.content.weapons[0].base = 'buster'],
  ['unknown weapon parameter', (x: any) => x.content.weapons[0].set.params.invalid = 1],
  ['drone pool overflow', (x: any) => x.content.weapons[0].set.params.count = 9],
  ['fractional drone count', (x: any) => x.content.weapons[0].set.params.count = 1.5],
  ['zero interval', (x: any) => { x.content.weapons[0].base = 'nova'; x.content.weapons[0].set.params = { cd: 0 }; }],
  ['invalid hook flags', (x: any) => x.content.mods[0].set.flags = { nonexistent: 1 }],
  ['unknown stat', (x: any) => x.content.relics[0].set.add.notAStat = 1],
  ['invalid stage', (x: any) => x.content.biomes[0].stages = [0]],
  ['invalid prop', (x: any) => x.content.biomes[0].set.tree = 'javascript'],
  ['empty prop distribution', (x: any) => x.content.biomes[0].set.clusters = [0, 0, 0, 0]],
  ['malformed palette', (x: any) => x.content.biomes[0].set.light = { sun: [1, 2] }],
  ['event duration overflow', (x: any) => x.content.events[0].set.seconds = 10000],
] as const) ok(!validateMod(modify(fn)).ok, `validation rejects ${label}`);
const proto = raw.replace('"hp": 30', '"hp": 30, "__proto__": {"polluted":true}');
ok(!parseMod(proto).ok && !(Object.prototype as any).polluted, 'nested prototype pollution rejected');
ok(!parseMod('{broken').ok && !parseMod(' '.repeat(MOD_LIMITS.bytes + 1)).ok, 'malformed and oversized JSON rejected');
const error = validateMod(modify(x => x.content.enemies[0].set.hp = -1));
ok(!error.ok && error.errors[0].startsWith('content.enemies[0].set.hp:'), 'error identifies exact field path');
const before = { weapons: Object.keys(WEAPONS).length, enemies: Object.keys(ENEMIES).length, biomes: BIOMES.length, relics: RELICS.length, mods: MODS.length };
const plan = planMods([file(raw)]);
ok(plan.active.length === 1 && !WEAPONS.mint_drones, 'planning is side-effect free');
ok(planMods([file(raw, false)]).active.length === 0, 'disabled valid pack contributes nothing');
ok(planMods([file(raw), file(raw, true, 'duplicate')]).results[1].errors[0].includes('Duplicate'), 'duplicate active pack IDs fail clearly');
const bad = planMods([file(JSON.stringify(modify(x => x.content.events[0].set.seconds = -1)))]);
ok(bad.active.length === 0 && !bad.registries.weapons.mint_drones, 'invalid late entry rolls back entire pack');
const override = (id: string, hp: number) => JSON.stringify({ schemaVersion: 1, id, name: id, version: '1', content: { enemies: [{ id: 'bopper', base: 'bopper', override: true, set: { hp } }] } });
const a = file(override('first', 111), true, 'a'), b = file(override('second', 222), true, 'b');
ok(planMods([a, b]).registries.enemies.bopper.hp === 222 && planMods([b, a]).registries.enemies.bopper.hp === 111, 'explicit overrides follow load order');
const hash = await hashMods(plan.active);
ok(hash.length === 64 && hash === await hashMods(planMods([file(JSON.stringify(example))]).active), 'SHA-256 ignores formatting');
ok(canonical({ b: 1, a: 2 }) === canonical({ a: 2, b: 1 }), 'hash normalizes object key order');
ok(await hashMods(planMods([a, b]).active) !== await hashMods(planMods([b, a]).active), 'hash includes load order');
ok(await hashMods(planMods([file(JSON.stringify(modify(x => x.content.enemies[0].set.hp++)))]).active) !== hash, 'same version with changed content changes hash');
ok(matchingMods(hash, hash) && !matchingMods(hash, 'vanilla') && !matchingMods('vanilla', hash) && !matchingMods(hash, undefined) && matchingMods('vanilla', undefined), 'online handshake matches exact content, legacy only with vanilla');
biomeByKey('meadow'); // populate the cache before install
installPlan(plan);
ok(Object.keys(ENEMIES).length === before.enemies + 1 && WEAPONS.mint_drones.behavior === 'drones', 'weapon and enemy definitions registered');
ok(WEAPONS.mint_drones.levels.every(l => l.p.count === 4 && l.p.dmg === 18) && WEAPONS.drones.levels[0].p.count !== 4, 'params patch each level without mutating shipped templates');
ok(RELIC_BY_ID.mint_heart.add?.maxHp === 40 && RELICS.some(r => r.id === 'mint_heart'), 'relic pool and lookup agree');
const stats = baseStats(); MOD_BY_ID.mint_glass.stat!(stats);
ok(stats.maxHp < 100 && MOD_BY_ID.mint_glass.stat === MOD_BY_ID.glass_cannon.stat, 'shop Mod retains the audited hook template');
ok(biomeForStage(2).id === 'mint_island' && biomeForStage(2).rock === 'crystal', 'custom biome selected by stage with existing props');
ok(EVENT_IDS.includes('mint_rush') && eventBehavior('mint_rush') === 'goldrush' && STAGE_EVENTS.mint_rush.seconds === 28, 'stage event registered with existing behaviour');
const enemy = { uid: 7, def: ENEMIES.mint_bopper, state: 'move', x: 2, z: 3, facing: 0, sq: 1, hp: 30, maxHp: 30, lungeX: 0, lungeZ: 1, action: 'none', t: 0, sub: 0 } as any;
let decoded: any; unpackEnemies(packEnemies([enemy]), value => decoded = value);
ok(decoded.def.id === 'mint_bopper' && decoded.x === 2, 'custom enemy survives real binary snapshot codec');
const banners: string[] = [];
const events = new RunEvents({ rng: new Rng(42), stage: 1, dmgMul: 1, targets: () => [], ownedWeapons: () => [], meteor() {}, spawnElite() {}, spawnRing() {}, vacuum() {}, banner: s => banners.push(s), toast() {}, sound() {}, reward() {} });
events.forceEvent('mint_rush');
ok(events.goldRush && events.event?.t === 28 && banners[0] === 'MINT RUSH!', 'custom event actually runs inherited host behaviour');
events.update(29, 0, false); ok(!events.goldRush, 'custom event expires normally');
const novaPack = JSON.stringify({ schemaVersion: 1, id: 'frost', name: 'Frost', version: '1', content: { weapons: [{ id: 'frost_nova', base: 'nova', set: { color: '#a7f070', params: { dmg: 22 } } }] } });
installPlan(planMods([file(raw), file(novaPack)]));
const scene = new THREE.Scene(), nova = createWeapon('frost_nova', scene);
const victim: any = { frozen: 0, shatter: 0, def: { boss: false } };
let source = '', damage = 0, tint = '';
const ctx: any = { player: { dead: false, x: 0, z: 0 }, stats: baseStats(), inRadius: () => [victim], sound() {}, fx: { ring: (_x: number, _z: number, _r: number, _g: number, c: string) => { if (c !== '#ffffff') tint = c; }, scar() {} }, particles: { burst() {} }, damage: (_e: unknown, d: number, o: any) => { source = o.source; damage = d; return d; } };
nova.update(1, ctx);
ok(source === 'frost_nova' && damage === 22 && tint === '#a7f070', 'real custom weapon uses params, colour and its own damage source');
const drones = createWeapon('mint_drones', scene); drones.setNet([2, 1.5]);
ok(drones.net()[0] === 2, 'custom mesh weapon reuses net/setNet'); drones.dispose();
installPlan(planMods([]));
ok(Object.keys(WEAPONS).length === before.weapons && Object.keys(ENEMIES).length === before.enemies && RELICS.length === before.relics && MODS.length === before.mods && BIOMES.length === before.biomes && !EVENT_IDS.includes('mint_rush') && biomeForStage(2).id === 'dunes', 'empty plan fully restores registries, stage routing and codec');

// Build tiny real ZIPs, including raw Deflate, without a runtime ZIP dependency.
function crc32(data: Uint8Array): number { let c = -1; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; }
function zip(name: string, contents: string, deflate = false): Uint8Array {
  const n = Buffer.from(name), data = Buffer.from(contents), packed = deflate ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + packed.length, 16);
  return Buffer.concat([local, n, packed, central, n, end]);
}
for (const compressed of [false, true]) ok((await readModArchive('pack.zip', zip('pack/example.json', raw, compressed)))[0].raw === raw, `ZIP ${compressed ? 'Deflate' : 'stored'} imports JSON`);
async function rejects(label: string, name: string, bytes: Uint8Array) { try { await readModArchive(name, bytes); ok(false, label); } catch { ok(true, label); } }
await rejects('ZIP rejects path traversal', 'bad.zip', zip('../bad.json', raw));
await rejects('ZIP rejects absolute paths', 'bad.zip', zip('/bad.json', raw));
await rejects('ZIP rejects truncated directory', 'bad.zip', zip('bad.json', raw).slice(0, -2));
const corrupt = zip('bad.json', raw); corrupt[40] ^= 1;
await rejects('ZIP verifies checksum', 'bad.zip', corrupt);
await rejects('ZIP rejects expanded zip bomb', 'bomb.zip', zip('bomb.json', 'x'.repeat(MOD_LIMITS.bytes + 1), true));
await rejects('JSON import checks byte limit', 'large.json', new Uint8Array(MOD_LIMITS.bytes + 1));
ok((await readModArchive('example.json', Buffer.from(raw)))[0].raw === raw, 'plain JSON import works');

// Preferences are separate from the profile/save format; restart applies exactly the persisted order.
const saved = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) };
const { ModManager, modSession } = await import('../src/mods/manager');
const manager = new ModManager(); await manager.initialize();
await manager.importFile('example.json', Buffer.from(raw));
ok(!manager.files[0].enabled && modSession.hash === 'vanilla', 'new imports default disabled and do not change live session');
manager.toggle(manager.files[0].key);
ok(manager.pending && modSession.hash === 'vanilla' && !WEAPONS.mint_drones, 'enabling only queues changes for restart');
const restarted = new ModManager(); await restarted.initialize();
ok(modSession.hash === hash && WEAPONS.mint_drones !== undefined, 'restart restores and applies enabled content');
await restarted.importFile('invalid.json', Buffer.from('{invalid'));
ok(restarted.plan.results.some(r => r.errors.length > 0), 'invalid imported JSON retained with visible error');
restarted.toggle(restarted.files[0].key);
const disabled = new ModManager(); await disabled.initialize();
ok(modSession.hash === 'vanilla' && !WEAPONS.mint_drones, 'disabling and restarting returns to vanilla');
// Wrongly typed/corrupt old storage cannot prevent boot.
saved.set('infinishoot.contentMods', '{"version":1,"files":[null,7],"enabled":42}');
await new ModManager().initialize(); ok(modSession.hash === 'vanilla', 'corrupt preferences recover safely');

// The desktop scanner is confined to a temporary mods folder, including hostile/oversized files.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { readMods } = require(process.cwd() + '/electron/mods.cjs');
const { mkdtemp, writeFile, symlink, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const temp = await mkdtemp(join(tmpdir(), 'infinishoot-mods-test-'));
try {
  await writeFile(join(temp, 'example.json'), raw);
  await writeFile(join(temp, 'too-large.json'), 'x'.repeat(MOD_LIMITS.bytes + 1));
  await writeFile(join(temp, 'ignored.txt'), raw);
  await symlink(join(temp, 'example.json'), join(temp, 'linked.json'));
  const scan = await readMods(temp);
  ok(scan.files.length === 3 && scan.files.find((f: any) => f.name === 'example.json').raw === raw, 'desktop discovers only JSON and reads valid files');
  ok(scan.files.find((f: any) => f.name === 'linked.json').error.includes('symlink'), 'desktop refuses symlinks');
  ok(scan.files.find((f: any) => f.name === 'too-large.json').error.includes('size'), 'desktop enforces byte budget before reading');
} finally { await rm(temp, { recursive: true, force: true }); }
