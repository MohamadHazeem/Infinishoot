/**
 * tips2 lane: first-time tips for the newer mechanics (catalog parity, button
 * prompts, priorities, the stale-moment rule, in-game detection) and the
 * Arsenal/Codex coverage check: every weapon, special, item, Mod, relic, combo,
 * fusion, super weapon, enemy, boss, biome, hero and mode has an entry with real text.
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
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });


const { TIPS, TIP_PRIORITY, tipInsertAt, tipTime } = await import('../src/game/tips');
const { TIP2_IDS, TIPS2, TIP2_MENUS } = await import('../src/data/tips2');
const { tips2En, tips2Ar } = await import('../src/i18n/tips2');
const { en } = await import('../src/i18n/en');
const { ar } = await import('../src/i18n/ar');
const { localize, setLanguage } = await import('../src/i18n');
const { codexEntries } = await import('../src/data/arsenal');
const { CODEX } = await import('../src/data/codex');
const { POWERUPS, EXTRA_CODEX, modeCodexId } = await import('../src/data/codex2');
const { WEAPONS } = await import('../src/data/weapons');
const { SPECIALS } = await import('../src/data/specials');
const { PASSIVES } = await import('../src/data/passives');
const { MODS } = await import('../src/data/mods');
const { RELICS } = await import('../src/data/relics');
const { WEAPON_COMBOS } = await import('../src/data/weaponCombos');
const { FUSIONS } = await import('../src/data/fusions');
const { SUPER_IDS } = await import('../src/game/gameplay');
const { ENEMIES } = await import('../src/data/enemies');
const { BIOMES } = await import('../src/data/biomes');
const { HEROES } = await import('../src/data/heroes');
const { MODES } = await import('../src/data/modes');
const { tip2Still } = await import('../src/game/systems/tips2');

// ---------------------------------------------------------------- tip catalog
{
  const slots = (s: string) => [...s.matchAll(/⟪(\w+)⟫/g)].map((m) => m[1]).sort().join(',');
  let missing = 0;
  for (const id of TIP2_IDS) {
    const tk = `tips2.${id}.title` as keyof typeof tips2En;
    const xk = `tips2.${id}.text` as keyof typeof tips2En;
    if (!tips2En[tk] || !tips2En[xk] || !/[؀-ۿ]/.test(tips2Ar[tk]) || !/[؀-ۿ]/.test(tips2Ar[xk])) missing++;
    if (slots(tips2En[xk]) !== slots(tips2Ar[xk])) missing++;
  }
  ok(missing === 0, `all ${TIP2_IDS.length} new tips have English and Arabic titles and texts with the same button slots`);
  ok(Object.keys(tips2En).every((k) => k in en && k in ar), 'the tips2 catalog is spread into en.ts and ar.ts');
  ok(new Set(TIP2_IDS).size === TIP2_IDS.length && TIP2_IDS.every((id) => TIPS[id] === TIPS2[id]), 'tip ids are unique and every new tip is in TIPS');
  ok(TIP2_IDS.length >= 60, `${TIP2_IDS.length} new tips`);
  const texts = TIP2_IDS.map((id) => TIPS[id].text());
  ok(texts.every((s) => !s.includes('⟪') && s.length > 20 && s.length < 230), 'every tip fills its button prompts and stays short');
  ok(TIPS.rewind.text().includes('B') && TIPS.ronin.text().includes('LMB') === TIPS.ronin.text().includes('LMB'), 'the rewind tip names its key');
  ok(TIP2_IDS.every((id) => tipTime(TIPS[id]) >= 5 && tipTime(TIPS[id]) <= 10), 'tips stay up 5-10 s');
  await setLanguage('ar');
  const arTexts = TIP2_IDS.map((id) => TIPS[id].text());
  const arTitles = TIP2_IDS.map((id) => localize(TIPS[id].title));
  ok(arTexts.every((s) => /[؀-ۿ]/.test(s) && !s.includes('⟪')), 'Arabic tip texts with their prompts');
  ok(arTitles.every((s) => /[؀-ۿ]/.test(s)), 'Arabic tip titles (the tip panel localizes the canonical English): ' + arTitles.filter((s) => !/[؀-ۿ]/.test(s)).join(' | '));
  await setLanguage('en');
  ok(TIP_PRIORITY.collapse === 0 && tipInsertAt('collapse', ['parry', 'mech']) === 0 && tipInsertAt('ghost', ['parry']) === 1, 'danger tips jump ahead of trivia');
  ok(TIP2_MENUS.route === 'route', 'the route map tip belongs to its menu');
}

// ---------------------------------------------------------------- arsenal / codex coverage
{
  const ars = new Map(codexEntries().map((e) => [e.key, e]));
  const lacks: string[] = [];
  const need = (key: string) => {
    const e = ars.get(key);
    if (!e || !e.name || !e.desc || e.desc.length < 8) lacks.push(key);
  };
  for (const w of Object.values(WEAPONS)) need(`w:${w.id}`);
  for (const s of Object.values(SPECIALS)) need(`sp:${s.id}`);
  for (const p of Object.values(PASSIVES)) need(`p:${p.id}`);
  for (const m of MODS) need(`m:${m.id}`);
  for (const r of RELICS) need(`r:${r.id}`);
  for (const c of WEAPON_COMBOS) need(`c:${c.id}`);
  for (const f of FUSIONS) need(`w:${f.id}`);
  for (const id of SUPER_IDS) need(`x:${id}`);
  need('x:mech');
  need('x:candy');
  for (const w of Object.values(WEAPONS)) (w.evos ?? []).forEach((_e, k) => need(`e:${w.id}:${k}`));
  for (const s of Object.values(SPECIALS)) (s.evos ?? []).forEach((_e, k) => need(`e:${s.id}:${k}`));
  ok(lacks.length === 0, 'every weapon, fusion, special, item, Mod, relic, combo, evolution and power-up has an Arsenal entry: ' + lacks.join(' '));

  const cx = new Map(CODEX.map((c) => [c.id, c]));
  const generic = /A veteran of the old island network|Keep moving and watch its wind-up|Another island on the old relay route/;
  const thin: string[] = [];
  const want = (id: string) => {
    const c = cx.get(id);
    if (!c || !c.name || c.text.length < 30 || generic.test(c.text)) thin.push(id);
  };
  for (const e of Object.values(ENEMIES)) if (!e.hidden) want(`enemy:${e.id}`);
  for (const b of BIOMES) want(`biome:${b.id}`);
  for (const h of HEROES) {
    want(`hero:${h.id}`);
    if (cx.get(`hero:${h.id}`)?.text === h.desc) thin.push(`hero:${h.id} (no lore)`);
  }
  for (const m of MODES) want(`mode:${m.id}`);
  for (const id of ['mode:coop', 'mode:pvp', 'mode:race', 'mode:versus', 'boss:titan', 'boss:hydra']) want(id);
  ok(thin.length === 0, 'every enemy, boss, biome, hero and mode has its own Codex entry: ' + thin.join(' '));
  ok(new Set(CODEX.map((c) => c.id)).size === CODEX.length, 'codex ids are unique');
  ok(EXTRA_CODEX.every((c) => cx.get(c.id) === c), 'extra codex entries are in CODEX');
  ok(modeCodexId('standard', { pvp: false, race: false, versus: false, coop: true }) === 'mode:coop' && modeCodexId('gauntlet', { pvp: false, race: false, versus: false, coop: false }) === 'mode:gauntlet' && modeCodexId('standard', { pvp: true, race: false, versus: false, coop: true }) === 'mode:pvp', 'the run picks its mode entry');

  await setLanguage('ar');
  const fresh = [...POWERUPS.flatMap((x) => [x.name, x.desc, x.kind]), 'POWER-UPS', ...EXTRA_CODEX.flatMap((c) => [c.name, c.text, c.kind]), ...CODEX.filter((c) => /^(enemy|biome|hero|mode|boss):/.test(c.id)).map((c) => c.text)];
  // Technical literals (UTC, ISO) stay in Latin letters on purpose (notes/lanes/arabic.md).
  const untranslated = fresh.filter((s) => /[a-z]{3}/i.test(localize(s).replace(/\b(UTC|ISO)\b/g, '')));
  ok(untranslated.length === 0, 'new Arsenal/Codex copy translates to Arabic: ' + untranslated.join(' || '));
  await setLanguage('en');
}

// ---------------------------------------------------------------- in the game
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { save } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');

save.lifetime.runs = 5;
save.training = { offered: true, done: true };
save.tips = [];
save.discovered = [];
settings.tips = true;
cheats.god = true;

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const step = (n: number) => {
  for (let i = 0; i < n; i++) game.update(1 / 60);
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
// Every original tip counts as seen, so the queue only holds this lane's tips.
const original = Object.keys(TIPS).filter((id) => !(TIP2_IDS as readonly string[]).includes(id));
save.tips = [...original];

settings.mode = 'standard';
game.startSolo();
step(10);
if (game.mode === 'shop') game.closeShop();
step(240); // past the stage banner quiet time

// Random content (elites, bullets, crates) can raise other tips: only the ones under test stay unseen.
const underTest = ['laststand', 'cashin', 'rewind', 'mech'];
save.tips = [...original, ...TIP2_IDS.filter((id) => !underTest.includes(id))];
game.onboarding.closeTip();
step(240);
ok(tip2Still(game, 'levelup') && !tip2Still(game, 'collapse'), 'a moment tip whose moment is gone is dropped; other tips always stay wanted');
const holdCombo = (n: number) => {
  for (let i = 0; i < n; i++) {
    game.combo = 80;
    game.comboT = 2;
    game.update(1 / 60);
  }
};
holdCombo(30);
ok(save.tips.includes('laststand') && $('#ob-tip')!.textContent!.includes('LAST STAND'), 'a x50 combo explains the last stand');
ok(save.tips.includes('laststand') && !save.tips.includes('cashin'), 'one tip at a time: the cash-in tip waits its turn');
game.onboarding.closeTip();
holdCombo(260);
ok(save.tips.includes('cashin') && $('#ob-tip')!.textContent!.includes('CASH IN'), 'then the combo cash-in tip shows, after the gap');
game.combo = 0;
game.onboarding.closeTip();

// Tips off: nothing new.
const before = save.tips.length;
settings.tips = false;
game.hero.player.hp = game.hero.player.maxHp * 0.3;
step(260);
ok(save.tips.length === before, 'TIPS OFF: no new tips');
settings.tips = true;

// A low-life moment with rewind history explains the rewind, with its key.
game.hero.player.hp = game.hero.player.maxHp * 0.3;
step(260);
ok(save.tips.includes('rewind') && $('#ob-tip')!.textContent!.includes('REWIND'), 'low life with rewind history: the rewind tip');
game.hero.player.hp = game.hero.player.maxHp;
game.onboarding.closeTip();

// Codex: the run's mode is discovered.
ok(save.meta.codex.includes('mode:standard'), 'playing a Standard run discovers its Codex entry');

// Arabic: the tip panel shows the translated title and text.
await setLanguage('ar');
game.hero.play.mechT = 5;
step(260);
const shown = $('#ob-tip')!.textContent ?? '';
ok(save.tips.includes('mech') && /[؀-ۿ]/.test(shown) && !/MECH SUIT/.test(shown), 'in Arabic the mech tip shows in Arabic: ' + shown.slice(0, 60));
ok(save.discovered.includes('x:mech'), 'piloting the mech discovers its Arsenal entry');
game.hero.play.mechT = 0;
await setLanguage('en');
