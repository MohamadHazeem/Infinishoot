import { allBiomeKeys } from '../data/biomes';
import { DIFFICULTIES, MODES } from '../data/modes';
import { HEROES } from '../data/heroes';
import { WEAPONS } from '../data/weapons';
import { SPECIALS } from '../data/specials';
import { PASSIVES } from '../data/passives';
import { FUSIONS } from '../data/fusions';
import { ENEMIES } from '../data/enemies';
import { ELITE_MOD_IDS } from '../data/eliteMods';
import { STAGE_EVENTS } from '../data/stageEvents';
import { RELICS } from '../data/relics';
import { MODS } from '../data/mods';
import { PETS } from '../data/pets';
import { ROUTE_EVENTS, ROUTE_NODES } from '../data/routeNodes';
import { WORLD_EVENT_KINDS } from '../game/worldEvents';
import { SUPER_IDS } from '../game/gameplay';
import { MINI_GAMES } from '../game/modes/minigames';
import { CROWD_REACTIONS } from '../audio/crowd';
import { INSTRUMENT_IDS } from '../audio/instruments';
import { EMOTES } from '../game/coop2';
import { TIPS } from '../game/tips';
import { OBJECTIVE_KINDS } from '../game/objectives';
import { META_SCREENS } from '../ui/metaScreens';
import type { Game } from '../game/game';

/**
 * Crash fuzzer link generator (scripts/fuzz.mjs, tests/fuzzJsdom.ts): a random but
 * reproducible combination of test-link options (src/dev/testLinks.ts and the lane
 * link modules) from a seed. Only valid ids are used: a crash on a made-up id in a
 * dev link is not a bug worth chasing. Online-only options (real lobbies, browse
 * without `fake`) are left out: the fuzzer runs offline.
 */
export function fuzzLink(seed: number): string {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const sec = (a = 0.5, b = 4) => (a + rnd() * (b - a)).toFixed(1);
  const chance = (p: number) => rnd() < p;
  const some = <T>(a: readonly T[], n: number): T[] => {
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      const x = pick(a);
      if (!out.includes(x)) out.push(x);
    }
    return out;
  };

  const weapons = Object.keys(WEAPONS);
  const autos = weapons.filter((id) => !WEAPONS[id].slot);
  const prim = weapons.filter((id) => WEAPONS[id].slot === 'primary');
  const sec2 = weapons.filter((id) => WEAPONS[id].slot === 'secondary');
  const foes = Object.keys(ENEMIES).filter((id) => !ENEMIES[id].boss && !ENEMIES[id].hidden);
  const legend = [...autos.filter((id) => WEAPONS[id].rarity === 'legendary'), ...Object.keys(PASSIVES).filter((id) => PASSIVES[id].rarity === 'legendary'), ...FUSIONS.map((f) => f.id)];

  const parts: string[] = ['test'];
  const add = (k: string, v?: string | number) => parts.push(v === undefined ? k : `${k}=${v}`);

  // The base situation.
  if (chance(0.8)) add('god');
  if (chance(0.7)) add('stage', int(1, 12));
  if (chance(0.5)) add('biome', pick(allBiomeKeys()));
  if (chance(0.5)) add('mode', pick(MODES).id);
  if (chance(0.5)) add('hero', pick(HEROES).id);
  if (chance(0.4)) add('difficulty', pick(DIFFICULTIES).id);
  if (chance(0.3)) add('seed', int(1, 99999));
  if (chance(0.5)) add('monkey', int(1, 99999)); // random keys and clicks on top of the bot
  if (chance(0.3)) add('loadout', [pick(prim), pick(sec2), pick(Object.keys(SPECIALS))].join(','));

  // Then a handful of features.
  const features: (() => void)[] = [
    () => add('weapons', some([...autos, ...FUSIONS.map((f) => f.id)], int(1, 4)).map((id) => `${id}:${int(1, 7)}`).join(',')),
    () => add('passives', some(Object.keys(PASSIVES), int(1, 4)).map((id) => `${id}:${int(1, 5)}`).join(',')),
    () => add('gold', int(0, 2000)),
    () => add('elite', some(foes, int(1, 3)).map((id) => `${id}:${pick(ELITE_MOD_IDS)}`).join(',')),
    () => add('spawn', some(foes, int(1, 4)).map((id) => `${id}:${int(1, 8)}`).join(',')),
    () => add('event', pick(Object.keys(STAGE_EVENTS))),
    () => (add('wev', pick(WORLD_EVENT_KINDS)), chance(0.5) && add('wevnow'), chance(0.5) && add('wevt', int(2, 20))),
    () => add('wevoff'),
    () => add(pick(['mech', 'mechdrop'])),
    () => add('crate', pick(SUPER_IDS)),
    () => add('super', pick(SUPER_IDS)),
    () => add('mutate', int(2, 10)),
    () => add('overload', chance(0.5) ? 'go' : ''),
    () => (add('combo', int(10, 300)), chance(0.6) && add('cashgo', int(1, 3))),
    () => add('finale', int(1, 4)),
    () => add('comeback'),
    () => add('relic', some(RELICS.map((r) => r.id), int(1, 4)).join(',')),
    () => add(pick(['night', 'day'])),
    () => add(pick(['rain', 'dry'])),
    () => add('tod', rnd().toFixed(2)),
    () => add('scars', `${int(5, 60)}${chance(0.5) ? ':' + pick(['crater', 'scorch', 'frost']) : ''}`),
    () => add('clouds', rnd().toFixed(2)),
    () => (add('photo', sec(1, 3)), add('photofilter', pick(['normal', 'crt', 'sepia', 'comic', 'neon', 'bw'])), add('photoframe', pick(['none', 'snapshot', 'film', 'arcade', 'comic'])), chance(0.5) && add('stickers', 'star@0.3,0.4;pow@0.7,0.3')),
    () => (add('route'), chance(0.5) && add('path', '1,0')),
    () => add('node', pick(Object.keys(ROUTE_NODES))),
    () => add('encounter', pick(ROUTE_EVENTS).id),
    () => add('secretroute'),
    () => (add('minigame', pick(Object.keys(MINI_GAMES))), chance(0.5) && add('mgt', int(1, 8))),
    () => add(pick(['rhythm', 'rhythmoff'])),
    () => (add('pacifist'), chance(0.5) && add('pact', int(10, 60))),
    () => (add('ghost', 'demo'), add('ghostlead', int(-3, 3))),
    () => (add('versus', chance(0.5) ? 'ol' : ''), chance(0.5) && add('vsgo', int(1, 3)), chance(0.4) && add('vstime', int(10, 200)), chance(0.4) && add('vspts', int(0, 500))),
    () => (add('localcoop', 'run'), add('lcpads', int(1, 3)), chance(0.4) && add('lcturn')),
    () => (add('localcoop'), add('lcpads', int(1, 3)), chance(0.5) && add('lcjoin'), chance(0.5) && add('lcready')),
    () => add(pick(['browse', 'teamboard']), 'fake'),
    () => add('lobby', pick(['coop', 'pvp', 'versus', 'weekly'])),
    () => (add('bossnow'), chance(0.5) && add('phase', int(1, 4)), chance(0.5) && add('nointro')),
    () => add('boss'),
    () => add('miniboss'),
    () => (add('bossnow'), add('titan'), chance(0.5) && add('titanphase', int(2, 4)), chance(0.5) && add('titanmove', pick(['sweep', 'sweep2', 'beam', 'debris', 'quake']))),
    () => (add('bossnow'), add(pick(['remix', 'duel'])), chance(0.5) && add('nointro')),
    () => add('killboss', int(1, 5)),
    () => add('clear', int(1, 5)),
    () => (add('mate', chance(0.5) ? pick(PETS).id : ''), chance(0.5) && add('teamfull'), chance(0.5) && add('teamgo', int(1, 3)), chance(0.3) && add('downmate', int(1, 4)), chance(0.3) && add('clutchgo', int(1, 3)), chance(0.3) && add('votego', int(1, 3)), chance(0.3) && add('teamult', int(1, 3)), chance(0.3) && add('mateemote', pick(EMOTES).id), chance(0.3) && add('autopilot')),
    () => (add('pet', pick(PETS).id), add('petlv', int(1, 5)), chance(0.3) && add('petgrow', int(1, 3))),
    () => add('emote', pick(EMOTES).id),
    () => (add('pool'), chance(0.5) && add('downme', int(1, 3))),
    () => add('ghostgo', int(1, 3)),
    () => add(pick(['rewindgo', 'standgo', 'btgo', 'replaygo']), int(1, 4)),
    () => (add('skyfall', int(1, 3)), chance(0.5) && add('skygold')),
    () => (add('ending', int(1, 3)), chance(0.5) && add('endloop', int(1, 3))),
    () => add('reveal', pick(legend)),
    () => (add('jackpot', int(1, 3)), chance(0.5) && add('jackkind', pick(['gold', 'items']))),
    () => add('jackchest'),
    () => (add('flawless', int(1, 3)), chance(0.5) && add('portalnow')),
    () => add('titleplay', sec(1, 3)),
    () => add('cine', pick(['short', 'off', 'full'])),
    () => (add(pick(['anime', 'noanime'])), chance(0.5) && add('impact', int(1, 2))),
    () => add('shatter', int(1, 3)),
    () => add('fog', rnd().toFixed(2)),
    () => add('puddles', int(1, 8)),
    () => add('band', chance(0.3) ? 'all' : some(INSTRUMENT_IDS, int(1, 3)).join(',')),
    () => add('instrument', pick(INSTRUMENT_IDS)),
    () => add(pick(['duelmusic', 'tension', 'djnow'])),
    () => add('crowd', pick(CROWD_REACTIONS)),
    () => add('pad', pick(['xbox', 'ps', 'kbm', 'touch'])),
    () => add('ui', pick([75, 100, 125, 150])),
    () => add('dmgnums', pick(['mine', 'off'])),
    () => add('charge', 'toggle'),
    () => add('noweather'),
    () => add('training', int(1, 6)),
    () => add('trainingdone'),
    () => add('tip', pick(Object.keys(TIPS))),
    () => add('lvlup'),
    () => add('discover', chance(0.5) ? 'all' : int(1, 60)),
    () => (add('recap'), chance(0.5) && add('card')),
    () => add('offer'),
    () => add('mods', some(MODS.map((m) => m.id), int(1, 5)).map((id) => `${id}:${int(1, 3)}`).join(',')),
    () => add(pick(['shop', 'levelup', 'armban'])),
    () => add('swarm', `${int(20, 250)}${chance(0.4) ? ':' + pick(foes) : ''}`),
    () => add('hold', `${int(20, 150)}${chance(0.4) ? ':' + pick(foes) : ''}`),
    () => add('bullets', int(50, 600)),
    () => add('boom'),
    () => add(pick(['circle', 'frozen', 'golden', 'topple', 'calm', 'nofinish', 'pops', 'slowmo', 'nolevel'])),
    () => add('dashes', int(1, 2)),
    () => add('hurt', sec(0.5, 2)),
    () => add('die', int(2, 6)),
    () => add('smash', int(1, 3)),
    () => (add('objective', pick(OBJECTIVE_KINDS)), chance(0.5) && add('near', pick(['pad', 'turret', 'pillar', 'crate', 'totem', 'shard', 'beacon', 'lava', 'ice', 'quicksand', 'thorns']))),
    () => add('at', pick(['holo', 'vent', 'sign', 'flag', 'gap', 'lava', 'water', 'ice', '12,-30'])),
    () => (add('weapons', `${pick(autos)}:6,${pick(autos)}:6`), add('fuse', chance(0.5) ? 'go' : '')),
    () => add(pick(['ultgo', 'parrygo', 'dashgo', 'special']), int(1, 3)),
    () => add('ult'),
    () => add('style', pick(['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'])),
    () => add('zoom', (1 + rnd() * 1.2).toFixed(1)),
    () => add('cam', (0.5 + rnd()).toFixed(1)),
    () => add('time', int(10, 400)),
    () => add('quality', pick(['low', 'medium', 'high', 'auto'])),
    () => add('rclick', sec(0.5, 2)),
    () => add('evo', `${pick([...prim, ...sec2, 'sp'])}:${int(0, 1)}`),
    () => add('foe', `${pick(foes)}:${pick(['windup', 'move', 'attack'])}:${int(1, 6)}`),
    () => add('screen', pick(['settings', 'extras', 'jukebox', 'wardrobe', 'modes', 'controls', 'history', 'bestiary', 'arsenal', 'codex', 'pause'])),
    () => add('metascreen', pick(META_SCREENS)),
    () => add('heat', 'swift,thick'),
    () => add('face', pick(['shocked', 'grinning', 'determined', 'hurt'])),
    () => add('captions'),
    () => add('arrows'),
  ];
  const n = int(2, 8);
  for (let i = 0; i < n; i++) pick(features)();
  return '?' + parts.join('&');
}

const MONKEY_KEYS = ['Escape', 'KeyP', 'Enter', 'Space', 'Digit1', 'Digit2', 'Digit3', 'KeyB', 'KeyX', 'KeyZ', 'KeyG', 'KeyQ', 'KeyE', 'KeyV', 'KeyC', 'KeyR', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'KeyM'];
/** Clicks that leave the sandbox (file dialogs, downloads, links). */
const MONKEY_SKIP = '[data-act="export"], [data-act="import"], a[href], input[type="file"]';

/**
 * `&monkey[=seed]` (crash fuzzer): every 0.4 s, on top of the autoplay bot, a random key press,
 * a click on a random visible button, a pause/resume, a tab hide/show, a resize or a wheel turn.
 */
export function fuzzMonkey(game: Game, seed: number): void {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const noLayout = /jsdom/i.test(navigator.userAgent); // jsdom has no layout: every rect is empty
  const visible = (el: HTMLElement) => el.isConnected && !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled && (noLayout || el.getClientRects().length > 0);
  setInterval(() => {
    const r = rnd();
    if (r < 0.45) {
      const code = MONKEY_KEYS[Math.floor(rnd() * MONKEY_KEYS.length)];
      const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code === 'Space' ? ' ' : code;
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), 60);
    } else if (r < 0.8) {
      const all = [...document.querySelectorAll<HTMLElement>('button, [data-nav], [data-act]')].filter((el) => !el.matches(MONKEY_SKIP) && visible(el));
      all[Math.floor(rnd() * all.length)]?.click();
    } else if (r < 0.88) {
      if (game.paused) game.resume();
      else game.pause();
    } else if (r < 0.93) {
      const hide = rnd() < 0.5;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hide });
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      }, 300);
    } else if (r < 0.97) {
      window.dispatchEvent(new Event('resize'));
    } else {
      document.getElementById('game')?.dispatchEvent(new WheelEvent('wheel', { deltaY: rnd() < 0.5 ? -120 : 120, bubbles: true }));
    }
  }, 400);
}
