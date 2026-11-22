import type { ReplayFile } from '../dev/replay';
import { ACTIONS } from '../core/keybinds';
import { validLoadout } from '../data/loadout';
import { RELIC_BY_ID } from '../data/relics';
import { SEASONS } from '../data/seasons';
import { cleanHeat } from '../data/heat';
import { ACHIEVEMENTS } from '../data/meta';
import { WEAPONS } from '../data/weapons';
import { HERO_BY_ID } from '../data/heroes';
import { SKIN_BY_ID } from '../data/skins';
import { PET_BY_ID } from '../data/pets';
import { SETTINGS_DEFAULTS } from '../game/settings';
import { categories, type Category, VERSION } from './telemetryClient';

const inList = (v: unknown, choices: string[], fallback = '') => typeof v === 'string' && choices.includes(v) ? v : fallback;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const numbers = (v: unknown) => Array.isArray(v) ? v.map(n => finite(n) ? n : 0) : [];
const scalars = (o: Record<string, unknown> | undefined, keys: string[]) => Object.fromEntries(keys
  .filter(k => finite(o?.[k]) || typeof o?.[k] === 'boolean').map(k => [k, o![k]]));
const keyCode = (s: unknown) => typeof s === 'string' && /^(Key[A-Z]|Digit\d|F(?:[1-9]|1[0-9]|2[0-4])|Numpad(?:\d|Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(?:Up|Down|Left|Right)|(?:Shift|Alt|Control|Meta)(?:Left|Right)|Escape|Enter|Space|Tab|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Insert|Delete|Home|End|PageUp|PageDown)$/.test(s) ? s : '';
const actions = 'pick skip reroll banish buy sell move mup sreroll heal curse slock relic done'.split(' ');
const modes = 'standard endless bossrush daily weekly gauntlet raid'.split(' ');
const difficulties = 'easy normal hard nightmare legend'.split(' ');
const screens = ('none title pause settings levelup shop gameover unlocks savedata online wait loadout extras jukebox wardrobe modes controls history bestiary relic route '
  + 'trials trialintro trialresult arsenal training customise ghosts ghostrace localcoop mpbrowse teamboard halloween party friends gauntlet mvp play profile achievements story '
  + 'desktopKeyboard desktopHelp contentmods touchlayout compete raceres tourney raid trade replay-help clips voicechat architect-ending season arenas arenaedit report consent '
  + 'heat weekly codex cosmetics').split(' ');

function controls(raw: Record<string, any>) {
  const s = raw.settings ?? {};
  const settings = { ...SETTINGS_DEFAULTS, ...scalars(s, Object.keys(SETTINGS_DEFAULTS)),
    hero: inList(s.hero, Object.keys(HERO_BY_ID), 'rookie'), skin: inList(s.skin, Object.keys(SKIN_BY_ID), 'classic'),
    pet: inList(s.pet, Object.keys(PET_BY_ID), 'none'), loadout: validLoadout(s.loadout), mode: inList(s.mode, modes, 'standard'),
    difficulty: inList(s.difficulty, difficulties, 'normal'), squadHeroes: String(s.squadHeroes ?? '').split(',').slice(0, 3).map(x => inList(x, Object.keys(HERO_BY_ID), 'random')).join(','),
  };
  const values = 'hold toggle full short off on auto all mine team me 100 85 70 30 60 120 unlimited'.split(' ');
  for (const k of ['gameSpeed', 'rewindMode', 'dashRunMode', 'teamMoveMode', 'chargeMode', 'cinematics', 'damageNumbers', 'coopCamera', 'frameCap'] as const) {
    Object.assign(settings, { [k]: inList(s[k], values, SETTINGS_DEFAULTS[k]) });
  }
  const binds = Object.fromEntries(ACTIONS.map(({ id }) => [id, [keyCode(raw.binds?.[id]?.[0]), keyCode(raw.binds?.[id]?.[1])]]));
  return { settings, binds };
}

/** Construct the shareable tape by projection. Never serialize the recorder's raw header,
 * diagnostics, query, chat or unrecognized commands. String table indices stay stable. */
export function shareReplay(file: ReplayFile): ReplayFile {
  const h = file.header;
  if (!h || file.version !== 1 || !Array.isArray(h.heroes)) throw Error('replay');
  const peers = new Map<string, string>();
  const peer = (v: string) => {
    if (!v) return '';
    if (!peers.has(v)) peers.set(v, 'seat-' + (peers.size + 1));
    return peers.get(v)!;
  };
  const roster = (x: Record<string, any>, i: number) => ({
    name: 'P' + (i + 1), peerId: peer(x.peerId), unlocked: Object.keys(WEAPONS).filter(k => x.unlocked?.includes(k)),
    hero: inList(x.hero, Object.keys(HERO_BY_ID), 'rookie'), skin: inList(x.skin, Object.keys(SKIN_BY_ID), 'classic'),
    pet: inList(x.pet, Object.keys(PET_BY_ID), 'none'), loadout: validLoadout(x.loadout), aim: numbers(x.aim),
    remote: x.remote ? scalars(x.remote, 'x z vx vz ax az ad firing charging dashing'.split(' ')) : null,
  });
  const season = inList(new URLSearchParams(h.query).get('season'), ['off', ...SEASONS.map(s => s.id)]);
  const header = {
    ...scalars(h, 'seed randomSeed firstUid stepN date initialRandom origin'.split(' ')), ...controls(h),
    query: season ? '?season=' + season : '', keys: h.keys.map(keyCode), camera: numbers(h.camera), projection: numbers(h.projection),
    heroes: h.heroes.map(roster), lobby: (h.lobby ?? []).map(roster), lobbyKind: inList(h.lobbyKind, ['coop', 'raid', 'weekly', 'pvp'], 'coop'),
    firstten: { ...scalars(h.firstten, 'guided runs0 lastRunTime stageSeen chestDone ringDone eliteWarned bossWarned curating curatedSeed n'.split(' ')), lastMode: inList(h.firstten?.lastMode, screens) },
    mode: inList(h.mode, modes, 'standard'), difficulty: inList(h.difficulty, difficulties, 'normal'), role: inList(h.role, ['solo', 'host'], 'solo'),
    cheats: scalars(h.cheats, ['god', 'unlockAll', 'oneShot', 'freeShop']),
    save: { achievements: ACHIEVEMENTS.map(a => a.id).filter(k => h.save?.achievements?.includes(k)),
      lifetime: scalars(h.save?.lifetime, 'runs kills elites bosses bestStage bestLevel playTime'.split(' ')),
      meta: { heat: cleanHeat(h.save?.meta?.heat), bolts: 0, bestHeat: {}, weekly: [], codex: [], rewards: [], theme: '' } },
  };
  const noop = JSON.stringify(['heroAction', [0, '', 0, 1]]);
  const sanitize = (s: string): string => {
    if (!s.startsWith('[') && !s.startsWith('{')) {
      if (screens.includes(s)) return s;
      return s.split(',').filter(x => ACTIONS.some(a => a.id === x)).join(',');
    }
    const cmd = JSON.parse(s);
    if (!Array.isArray(cmd)) return JSON.stringify(controls(cmd));
    const [name, a] = cmd;
    if (!Array.isArray(a)) return noop;
    let args: unknown[];
    if (name === 'onHostMessage') {
      const m = a[1] ?? {};
      const kind = inList(m.t, 'i ping iai dash jump bomb parry ult rw team cash carry cobuy bye ui rvote hb tr'.split(' '));
      if (!kind) return noop;
      const msg: Record<string, unknown> = { t: kind, ...scalars(m, 'x z vx vz ax az ad f c d vt i rtt k sx sz ex ez to n'.split(' ')), a: inList(m.a, actions) };
      if (kind === 'tr') { msg.a = inList(m.a, ['give','pool','unpool','chip']); msg.k = inList(m.k, ['gold','gear','relic']); msg.id = inList(m.id, Object.keys(RELIC_BY_ID)); }
      args = [peer(a[0]), msg];
    } else if (name === 'onClientLeft') args = [peer(a[0])];
    else if (name === 'heroAction') args = [Number(a[0]) || 0, inList(a[1], actions), Number(a[2]) || 0, a[3] === -1 ? -1 : 1];
    else if (name === 'debugGiveWeapon') args = [inList(a[0], Object.keys(WEAPONS), 'buster'), ...numbers(a.slice(1))];
    else if (['routeVote', 'loadStage', 'autoFireToggle', 'closeShop', 'pause', 'resume', 'quitRun', 'leaveToTitle', 'debugSkipToBoss', 'debugSpawnElite'].includes(name)) args = numbers(a);
    else return noop;
    return JSON.stringify([name, args]);
  };
  return { version: 1, header, strings: file.strings.map(sanitize), data: file.data, steps: file.steps, complete: file.complete, hash: file.hash };
}

export async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export async function packageReport(category: Category, message: string, replay?: ReplayFile, screenshot?: Blob) {
  if (!categories.includes(category) || (screenshot && (screenshot.size > 300 * 1024 || screenshot.type !== 'image/jpeg'))) throw Error('attachment');
  const packed = replay && await new Response(new Blob([JSON.stringify(shareReplay(replay))]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { id: crypto.randomUUID(), version: VERSION, category, text: message.slice(0, 500),
    replay: packed ? await base64(packed) : null, screenshot: screenshot ? await base64(screenshot) : null };
}
