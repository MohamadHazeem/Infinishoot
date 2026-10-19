/**
 * Online lobby: hosting, joining and starting co-op games.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `hostGame = Online.hostGame;`.
 */
import type { Game } from '../game';
import { localHero, kitText } from '../game';
import { randomSeed } from '../../core/rng';
import { WEAPONS } from '../../data/weapons';
import { validLoadout } from '../../data/loadout';
import { NetClient, NetHost } from '../../net/peer';
import { HERO_COLORS } from '../hero';
import { save, unlockedLoadout, unlockedWeapons } from '../save';
import { settings } from '../settings';
import { DIFF_BY_ID, type DifficultyDef, type DifficultyId } from '../../data/modes';
import { prefetchIce } from '../../net/ice';
import { cleanLook } from '../../data/customise';
import { coopPlayerId } from '../coop2';
import { versusOverlordIndex } from './mp';

export async function hostGame(this: Game, name: string): Promise<void> {
  this.saveName(name);
  this.netName = name.trim().slice(0, 12) || 'Player';
  this.leaveToTitle();
  this.role = 'host';
  await prefetchIce(); // time-limited relay credentials, if the build has a credential URL (src/net/ice.ts)
  if (this.role !== 'host' || this.host) return;
  const host = new NetHost(3);
  this.host = host;
  this.lobby = [{ peerId: '', name, unlocked: unlockedWeapons(), loadout: validLoadout(settings.loadout, unlockedLoadout()), skin: settings.skin, pet: settings.pet, hero: localHero(), look: cleanLook(settings.look) }];
  this.screens.setLobby({ code: '', players: [], isHost: true, status: 'Creating game...' });
  host.onMessage = (from, msg) => this.onHostMessage(from, msg as Record<string, unknown>);
  host.onLeave = (id) => this.onClientLeft(id);
  host.onError = (msg) => this.screens.setLobby({ code: '', players: [], isHost: true, status: msg });
  try {
    await host.ready;
  } catch {
    return;
  }
  if (this.host !== host) return;
  this.refreshLobby();
}

export function refreshLobby(this: Game): void {
  if (!this.host) return;
  const players = this.lobby.map((p, i) => ({ name: p.name, color: HERO_COLORS[i], kit: kitText(p.loadout) }));
  const difficulty = this.lobbyDifficulty().id;
  const kind = this.lobbyKind;
  const extra = this.mpLobbyExtra(); // Versus Overlord, weekly team, PUBLIC (systems/mp.ts)
  this.screens.setLobby({ code: this.host.code, players, isHost: true, status: players.length > 1 ? 'Ready when you are!' : 'Share the code with your friends', difficulty, kind, extra: extra.mp });
  this.host.broadcast({ t: 'lobby', players, code: this.host.code, difficulty, kind, ...extra, co: this.coopLobby() }); // co: roles, revive pool, join anytime (systems/coop2.ts)
}

/** Co-op difficulty: the host's pick, if their save has it unlocked. */
export function lobbyDifficulty(this: Game): DifficultyDef {
  const d = DIFF_BY_ID[settings.difficulty as DifficultyId] ?? DIFF_BY_ID.normal;
  return d.unlock && !save.achievements.includes(d.unlock) ? DIFF_BY_ID.normal : d;
}

export function hostStart(this: Game): void {
  if (this.role !== 'host' || !this.host) return;
  if (this.lobbyKind === 'pvp') {
    if (this.lobby.length < 2) {
      this.hud.toast('PVP NEEDS AT LEAST 2 PLAYERS', 2.5);
      return;
    }
    const seed = randomSeed();
    const difficulty = this.lobbyDifficulty().id;
    this.host.broadcast({ t: 'pvpgo', seed, difficulty });
    this.pvpBegin('host', seed, difficulty);
    return;
  }
  // Versus Swarm: a player Overlord needs at least one hero to play against (or pick the AI Overlord).
  const overlord = this.lobbyKind === 'versus' ? versusOverlordIndex(this) : -1;
  if (overlord >= 0 && this.lobby.length < 2) {
    this.hud.toast('VERSUS NEEDS A HERO: WAIT FOR A FRIEND OR PICK THE AI OVERLORD', 3);
    return;
  }
  this.runMode = this.lobbyKind === 'weekly' ? 'weekly' : 'standard'; // weekly co-op: this week's seed and rules for the whole team
  const heroes = this.lobby.map((p, i) => {
    if (i === 0) return this.hero;
    const h = this.makeHero(i, p.name, p.unlocked.filter((id) => WEAPONS[id]), p.peerId, p.skin, p.pet, p.hero);
    h.player.look = cleanLook(p.look);
    h.loadoutPick = p.loadout;
    return h;
  });
  this.hero.name = this.lobby[0].name;
  this.setHeroes(heroes);
  this.local = 0;
  this.startRun();
  if (this.lobbyKind === 'versus') this.versusBegin(overlord);
}

export async function joinGame(this: Game, name: string, code: string): Promise<void> {
  this.saveName(name);
  this.netName = name.trim().slice(0, 12) || 'Player';
  this.leaveToTitle();
  this.role = 'client';
  await prefetchIce();
  if (this.role !== 'client' || this.client) return;
  const client = new NetClient(code);
  this.client = client;
  this.screens.setLobby({ code: code.toUpperCase(), players: [], isHost: false, status: 'Connecting...' });
  client.onMessage = (m) => this.onClientMessage(m as Record<string, unknown>);
  client.onClose = () => {
    if (this.client !== client) return;
    this.leaveToTitle();
    this.hud.toast('DISCONNECTED FROM HOST', 3);
  };
  try {
    await client.ready;
  } catch (err) {
    if (this.client !== client) return;
    this.client = null;
    this.role = 'solo';
    this.screens.setLobby({ code: '', players: [], isHost: false, status: (err as Error).message });
    return;
  }
  client.send({ t: 'hello', pid: coopPlayerId(), name, unlocked: unlockedWeapons(), loadout: validLoadout(settings.loadout, unlockedLoadout()), skin: settings.skin, pet: settings.pet, hero: localHero(), look: cleanLook(settings.look) });
  this.screens.setLobby({ code: code.toUpperCase(), players: [], isHost: false, status: 'Connected! Waiting for the host to start...' });
}

/** Online lobby: share a new loadout pick (the host's own is read at start). */
export function onLoadoutChanged(this: Game): void {
  const loadout = validLoadout(settings.loadout, unlockedLoadout());
  if (this.role === 'client') this.client?.send({ t: 'loadout', loadout });
  else if (this.role === 'host' && this.lobby[0]) {
    this.lobby[0].loadout = loadout;
    this.refreshLobby();
  }
}
