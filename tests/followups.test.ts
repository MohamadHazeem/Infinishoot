import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

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
const assert = (await import('node:assert/strict')).default;
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { WEAPONS } = await import('../src/data/weapons');
const { heroOf, heroClicks } = await import('../src/data/heroes');
const { LocalLobby, KBM } = await import('../src/game/localCoop');
const { LocalCoopUi } = await import('../src/ui/localCoopUi');
const { Team } = await import('../src/game/bullets');
const { Shield } = await import('../src/game/weapons/shield');
const { hostileBullet, applyFollowupsNet } = await import('../src/game/systems/followups');
const { pvp2Links } = await import('../src/dev/pvp2Links');
const { save, saveLock, unlockedWeapons, exportFile, importFile } = await import('../src/game/save');
const { startMeta2, currentTally, achievementToast, meta2Ui } = await import('../src/game/systems/meta2');
const { challengeState } = await import('../src/game/systems/gauntlet');
const { ACHIEVEMENTS } = await import('../src/data/meta');
const { sfx } = await import('../src/audio/sfx');
const { updateAudio3 } = await import('../src/game/systems/audio3');
const { coopState } = await import('../src/game/systems/coop2');
const { myGhost } = await import('../src/game/coop2');
const { setLanguage, localize, t } = await import('../src/i18n');
const { netcodeHello, netcodeStep, netcodeLost, netcodeClientMsg, netcodeJoined, netcodeSnapshot, helloMsg } = await import('../src/game/systems/netcode');
const { myProfile, lobbyX } = await import('../src/game/systems/party');
const { cleanProfile } = await import('../src/game/lobby');
const { xpForLevel } = await import('../src/data/profile');
const { modSession } = await import('../src/mods/manager');
const { settings } = await import('../src/game/settings');
settings.deathReplay = false;
const mk = () => new Game(new Input(document.getElementById('game') as HTMLCanvasElement), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const g = mk();
saveLock.on = false;
g.startRun({ seed: 42 });
if (g.mode === 'shop') g.closeShop();

// Kit display and editing follow the actual hero, without destroying the stored fallback picks.
const ui = new LocalCoopUi(document.getElementById('hud')!, g, () => []);
for (const id of ['ronin', 'tinker']) {
  const lobby = new LocalLobby(() => ['ronin', 'tinker', 'rookie']);
  lobby.join(KBM, { hero: id, loadout: { primary: 'laser', secondary: 'rail', special: 'bomb' } });
  const slot = lobby.slots[0];
  slot.row = 2; lobby.nav(KBM, 0, 1);
  assert.equal(slot.loadout.secondary, 'rail', 'fixed right click cannot edit the hidden fallback');
  slot.row = 1; lobby.nav(KBM, 0, 1);
  assert.equal(slot.loadout.primary === 'laser', id === 'ronin', 'Tinker retains an editable left click');
  ui.lobby.slots = lobby.slots;
  ui.renderScreen();
  const clicks = heroClicks(heroOf(id), slot.loadout);
  assert(ui.screen.textContent!.includes(WEAPONS[clicks.secondary].name.toUpperCase()));
  assert.equal(ui.screen.querySelectorAll('.lc-row button:disabled').length, id === 'ronin' ? 4 : 2);
  g.hero.setHeroDef(id);
  g.hero.loadoutPick = { ...slot.loadout };
  g.mode = 'fight'; g.hero.player.dead = false;
  g.boss = g.enemies.spawn(ENEMIES.king, 5, 5, { instant: true });
  coopState(g).lastMode = 'fight';
  g.hero.player.dead = true; g.mode = 'dead';
  g.coop2Step(0);
  assert.deepEqual(myGhost()?.kit.slice(0, 3), [clicks.primary, clicks.secondary, 'bomb']);
  g.boss = null; g.enemies.clear();
}
console.log('ok   hero kit labels, locked arrows and saved help ghosts');

save.profile.xp = xpForLevel(100);
assert.equal(myProfile().lv, 100);
assert.equal(cleanProfile(myProfile())!.lv, 100, 'the final XP level survives the lobby wire');
g.screens.show('title');
assert.match(document.querySelector('.menu-profile')!.textContent!, /100/);
meta2Ui(g).profile.renderTitlePanel(() => {});
assert.equal(document.getElementById('m2-title')!.parentElement!.className, 'menu-activity', 'daily quests use the menu column instead of overlapping Play');
save.profile.xp = 0;
console.log('ok   title and lobby use the Profile XP level, including level 100');

// Real duel paths: enemy shots can be reflected; self/allied player shots survive.
pvp2Links(g, new URLSearchParams('pvp=teams&pvpn=4&pvpfight&seed=42'));
g.bullets.clear();
const h = g.hero;
h.player.teleport(0, 0); h.player.aim.x = 1; h.player.aim.z = 0;
const shot = (owner: number, team = Team.Player) => g.bullets.spawn({ x: 0.7, z: 0, dirX: -1, dirZ: 0, speed: 4, life: 4, radius: 0.1, damage: 2, knockback: 0, team, color: '#73eff7', owner });
shot(0); shot(2); shot(1); shot(-1, Team.Enemy);
assert.deepEqual([0, 1, 2, 3].map(i => hostileBullet(g, 0, i)), [false, false, true, true]);
h.skill.parryCd = 0;
g.tryParry(h);
assert.deepEqual(Array.from(g.bullets.owner.slice(0, 4)), [0, 2, 0, 0]);
assert.equal(h.skill.parried, 2);
assert(g.bullets.vx[2] !== -4, 'opponent shot reflected by the real parry');
g.bullets.clear();
shot(0); shot(2); shot(1); shot(-1, Team.Enemy);
const shield = new Shield(WEAPONS.shield, g.scene);
h.ctx.charging = true;
shield.update(0.51, h.ctx);
// The balance lane made the base Aegis Shield reflect (reflect: 1): hostile shots now bounce back as this
// hero's instead of vanishing. Own and allied shots still pass untouched.
assert.equal(g.bullets.count, 4);
assert.deepEqual(Array.from(g.bullets.owner.slice(0, 4)), [0, 2, 0, 0], 'the opponent and enemy shots now belong to the shield owner');
assert.deepEqual([0, 1, 2, 3].map(i => g.bullets.vx[i] > 0), [false, false, true, true], 'own and allied shots fly on, hostile ones bounce back');
shield.dispose();
g.bullets.clear();
g.pvp = null; g.role = 'solo';
shot(1);
assert(!hostileBullet(g, 0, 0), 'co-op player bullets never become hostile');
console.log('ok   PvP parry/shield respect ownership and team allegiance');

// Authoritative team counters round-trip via the actual compact snapshot codec.
g.mode = 'fight'; g.elitesRun = 3; g.bossesRun = 2;
const snap = g.buildSnapshot(g.hero, []);
const wire = snap;
const client = mk(); client.role = 'client';
client.applySnapshot(wire);
assert.equal(client.elitesRun, 3); assert.equal(client.bossesRun, 2);
applyFollowupsNet(client, [3, 2]);
assert.equal(client.elitesRun, 3, 'duplicate snapshots are idempotent');
applyFollowupsNet(client, [-1, NaN]);
assert.equal(client.elitesRun, 3, 'invalid counters ignored');
applyFollowupsNet(client, [0, 0]);
assert.equal(client.elitesRun, 0, 'new runs reset the goals');
console.log('ok   guest FIRST STEPS team counters survive compact snapshots');

// Ascension medals require an actual Omega kill in the Ascension run; Heat stays separate.
g.pvp = null; g.role = 'solo'; g.runMode = 'standard'; g.mode = 'fight';
startMeta2(g); g.meta.heat = (await import('../src/data/heat')).HEAT.map(x => x.id); g.victories = 1;
challengeState(g).ascension = 0;
const omega = g.enemies.spawn(ENEMIES.omega, 20, 20, { instant: true });
g.meta2Kill(omega, 'buster', g.hero);
assert.equal(currentTally(g).ascension ?? 0, 0, 'Heat does not count as Ascension');
challengeState(g).ascension = 6;
g.meta2Kill(omega, 'buster', g.hero);
assert.equal(currentTally(g).ascension, 6);
assert(ACHIEVEMENTS.filter(a => a.id.startsWith('m2_asc')).every(a => a.track?.stat === 'ascension'));
save.profile.stats.ascension = 6;
importFile(exportFile());
assert.equal(save.profile.stats.ascension, 6, 'optional counter round-trips through existing save normalization');
console.log('ok   Ascension achievements track challenge clears and preserve saves');

// A reward event has one sound owner. Rendering cannot play it again or use the old profile formula.
const cues: string[] = [];
const named = sfx.named; sfx.named = (name: string) => { cues.push(name); };
updateAudio3(g);
achievementToast(g, ACHIEVEMENTS[0]);
save.achievements.push('followups-test'); save.lifetime.kills += 100000;
updateAudio3(g);
assert.equal(cues.filter(x => x === 'achievement').length, 1);
assert.equal(cues.filter(x => x === 'profileLevel').length, 0);
sfx.named = named;
console.log('ok   rewards are not replayed by the render observer');

// Roster compaction after a party member leaves must rebind stable reconnect IDs.
g.role = 'host';
g.host = { send() {}, broadcast() {}, close() {}, code: 'TEST1' } as any;
const guest = g.makeHero(1, 'Guest', unlockedWeapons(), 'peer-guest');
g.setHeroes([g.hero, guest]);
netcodeHello(g, 'peer-guest', { t: 'hello', pid: 'guest-stable-id' });
coopState(g).pids[1] = 'departed-player';
netcodeStep(g, true);
assert.equal(coopState(g).pids[1], 'guest-stable-id');
console.log('ok   party roster compaction preserves reconnect identity');

client.mode = 'fight';
client.client = { code: 'TEST1' } as any;
const connectionCues: string[] = [];
client.vfx.sound = (name: string) => { connectionCues.push(name); };
assert(netcodeLost(client, client.client!));
netcodeClientMsg(client, { t: 'start' });
netcodeClientMsg(client, { t: 'start' });
assert.deepEqual(connectionCues, ['reconnect'], 'one cue on successful rejoin, not on repeated start');
console.log('ok   successful reconnect uses the existing cue exactly once');

// Real connections buffer snapshots. A final queued run snapshot must not
// resurrect the run after the party has returned to its lobby.
netcodeJoined(client, client.client!);
let applied = 0;
const applySnapshot = client.applySnapshot;
client.applySnapshot = () => { applied++; };
netcodeSnapshot(client, { hs: 10 });
netcodeSnapshot(client, { hs: 16 });
assert.equal(applied, 1, 'a newer snapshot waits in the real playout buffer');
netcodeClientMsg(client, { t: 'lbtolobby' });
netcodeClientMsg(client, { t: 'stage' }); // flush anything left after returning
assert.equal(applied, 1, 'lobby transition discarded the old run snapshot');
client.applySnapshot = applySnapshot;
console.log('ok   BACK TO LOBBY discards delayed gameplay snapshots');

const vanilla = modSession.hash;
modSession.hash = 'followups-content-hash';
const hello = helloMsg('Returning player');
assert.equal(hello.mods, modSession.hash, 'reconnect uses the same content compatibility check as initial join');
assert.deepEqual(hello.prof, myProfile(), 'reconnect retains the friend/profile card');
assert.equal((hello.pf as { lv: number }).lv, myProfile().lv, 'cosmetic profile summary follows the same level');
modSession.hash = vanilla;
console.log('ok   reconnect hello carries content hash and both profile summaries');

client.mode = 'title';
client.lobbyClientMessage({ t: 'lbx', v: { p: Array.from({ length: 9 }, () => ({ ready: true, hero: 'ronin', prof: myProfile() })), you: 7, cd: -1 } });
assert.equal(lobbyX(client)!.p.length, 8, 'PvP lobby cards retain all eight supported players');
let ready: unknown;
client.client!.send = (m: unknown) => { ready = m; };
client.lobbyReady();
assert.deepEqual(ready, { t: 'lbready', on: false }, 'eighth player can unready using their own card');
console.log('ok   eight-player PvP lobby cards and ready toggles survive validation');

await setLanguage('ar');
(await import('../src/game/systems/halloween')).showHalloweenShop.call(g);
assert(!/[a-z]{3}/i.test(g.halloween.shop!.textContent!.replace(/ESC/g, '')), 'seasonal shop copy and cosmetic names are translated: ' + g.halloween.shop!.textContent);
for (const text of ['FIGHT AS 2 TEAMS', 'FREE-FOR-ALL', 'ROUND 2 · FIRST TO 2', 'RING CLOSES IN 12', 'Thorn Garden', 'Highest Ascension cleared']) assert(!/[a-z]{3}/i.test(localize(text)), text);
assert(t('followups.pvp.wins', { name: '<bdi>BACK</bdi>' }).includes('<bdi>BACK</bdi>'));
await setLanguage('en');
console.log('ok   PvP UI translations retain isolated user names');
