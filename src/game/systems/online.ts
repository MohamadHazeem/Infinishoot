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
import { heatScoreMul, heatTotal } from '../../data/heat';
import { loadHeatPick } from '../runMods';

/** "HEAT 7 · SCORE x1.35" for the lobby ('' at heat 0). */
function lobbyHeat(): string {
  const t = heatTotal(loadHeatPick());
  return t > 0 ? `HEAT ${t} · SCORE x${heatScoreMul(t).toFixed(2)}` : '';
}

export async function hostGame(this: Game, name: string): Promise<void> {
  this.saveName(name);
  this.netName = name.trim().slice(0, 12) || 'Player';
  this.leaveToTitle();
  this.role = 'host';
  const host = new NetHost(3);
  this.host = host;
  this.lobby = [{ peerId: '', name, unlocked: unlockedWeapons(), loadout: validLoadout(settings.loadout, unlockedLoadout()), skin: settings.skin, pet: settings.pet, hero: localHero() }];
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
  const heat = lobbyHeat(); // the host's heat applies to co-op (src/data/heat.ts)
  this.screens.setLobby({ code: this.host.code, players, isHost: true, status: players.length > 1 ? 'Ready when you are!' : 'Share the code with your friends', difficulty, kind, heat });
  this.host.broadcast({ t: 'lobby', players, code: this.host.code, difficulty, kind, heat });
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
  const heroes = this.lobby.map((p, i) => {
    if (i === 0) return this.hero;
    const h = this.makeHero(i, p.name, p.unlocked.filter((id) => WEAPONS[id]), p.peerId, p.skin, p.pet, p.hero);
    h.loadoutPick = p.loadout;
    return h;
  });
  this.hero.name = this.lobby[0].name;
  this.setHeroes(heroes);
  this.local = 0;
  this.startRun();
}

export async function joinGame(this: Game, name: string, code: string): Promise<void> {
  this.saveName(name);
  this.netName = name.trim().slice(0, 12) || 'Player';
  this.leaveToTitle();
  this.role = 'client';
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
  client.send({ t: 'hello', name, unlocked: unlockedWeapons(), loadout: validLoadout(settings.loadout, unlockedLoadout()), skin: settings.skin, pet: settings.pet, hero: localHero() });
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
