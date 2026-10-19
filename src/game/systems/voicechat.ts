/**
 * Voice chat glue (voicechat lane, notes/lanes/voicechat.md): the host's voice
 * roster over the data channel, client "voice on" reports, and the per-tick
 * drive of src/net/voice.ts plus its UI (src/ui/voiceUi.ts).
 *
 * Messages:
 *  - client -> host `vchat` { on }: this player's VOICE CHAT is on/off (sent on change and every 3 s).
 *  - host -> clients `vroster` { r }: [peer id, name, on, hero index][] by lobby index (lobby) or hero index (run).
 * Audio itself never touches the host: players call each other directly (src/net/voice.ts).
 */
import type { Game } from '../game';
import { PAD_TALK } from '../../core/keybinds';
import { settings } from '../settings';
import { voice, voiceTuning, packRoster, unpackRoster, type VoiceRosterEntry, type VoiceWorld } from '../../net/voice';
import { voiceUiTick } from '../../ui/voiceUi';

/** Host: which client peers have voice on. */
const clientOn = new Map<string, boolean>();
let rosterKey = '';
let rosterT = 0;
let anyOnSent = false;
let reportT = 0;
let reported: boolean | null = null;
let lastHost: unknown = null;

function online(g: Game): 'host' | 'client' | null {
  if (g.host) return 'host';
  if (g.client) return 'client';
  return null;
}

/** Host: the roster from the run's heroes, or the lobby before a run (and during PvP's solo stages). */
export function buildRoster(g: Game): VoiceRosterEntry[] {
  const hostId = g.host?.voicePeer?.id ?? '';
  const meOn = voice.enabled;
  if (g.mode !== 'title' && g.heroes.length >= 2) {
    return g.heroes.map((h, i) => {
      const id = i === g.local ? hostId : h.left ? '' : h.peerId;
      return { id, name: h.name, on: id === hostId ? meOn : !!clientOn.get(id), hero: i };
    });
  }
  return g.lobby.map((p, i) => {
    const id = i === 0 ? hostId : p.peerId;
    return { id, name: p.name, on: i === 0 ? meOn : !!clientOn.get(id), hero: -1 };
  });
}

/** Host side `vchat`. Returns true when handled. */
export function voiceHostMsg(_g: Game, from: string, m: Record<string, unknown>): boolean {
  if (m.t !== 'vchat') return false;
  clientOn.set(from, m.on === true);
  rosterT = 0; // rebroadcast now
  return true;
}

/** Client side `vroster`. Returns true when handled. */
export function voiceClientMsg(_g: Game, m: Record<string, unknown>): boolean {
  if (m.t !== 'vroster') return false;
  voice.roster = unpackRoster(m.r);
  return true;
}

/** Index of this machine's player in the roster. */
function myIndex(g: Game): number {
  const myId = (g.host?.voicePeer ?? g.client?.voicePeer)?.id ?? '';
  const i = myId ? voice.roster.findIndex((r) => r.id === myId) : -1;
  if (i >= 0) return i;
  return g.host ? 0 : -1;
}

const world: VoiceWorld = {
  net: null,
  peer: null,
  myIndex: -1,
  heroPos: () => null,
  listenerDown: false,
  talkHeld: false,
};

/** Per fixed step (also in menus and the lobby). Cheap no-op while VOICE CHAT is off and offline. */
export function voiceTick(g: Game, dt: number): void {
  const net = online(g);
  if (!net) {
    clientOn.clear();
    reported = null;
    rosterKey = '';
    anyOnSent = false;
  }
  if (net === 'host' && g.host !== lastHost) clientOn.clear();
  lastHost = g.host;

  if (net === 'host') {
    // Forget players that left.
    const ids = new Set(g.host!.clientIds ?? []);
    for (const id of clientOn.keys()) if (!ids.has(id)) clientOn.delete(id);
    const r = buildRoster(g);
    voice.roster = r;
    const key = JSON.stringify(packRoster(r));
    rosterT -= dt;
    // Nobody uses voice: no traffic at all. Otherwise on every change and every few seconds (late joiners).
    const anyOn = r.some((e) => e.on);
    if ((anyOn || anyOnSent) && (key !== rosterKey || rosterT <= 0)) {
      g.host!.broadcast?.({ t: 'vroster', r: packRoster(r) });
      rosterKey = key;
      rosterT = voiceTuning.rosterEvery;
      anyOnSent = anyOn;
    }
  } else if (net === 'client' && g.client!.open && g.client!.voicePeer) {
    const on = voice.enabled;
    reportT -= dt;
    if (on !== reported || reportT <= 0) {
      if (on || reported !== false) g.client!.send({ t: 'vchat', on });
      reported = on;
      reportT = voiceTuning.rosterEvery;
    }
  }

  world.net = net;
  world.peer = g.host?.voicePeer ?? g.client?.voicePeer ?? null;
  world.myIndex = net ? myIndex(g) : -1;
  const inRun = g.mode !== 'title' && g.heroes.length >= 2;
  world.heroPos = (i) => {
    const h = inRun ? g.heroes[i] : undefined;
    return h && !h.left ? h.player : null;
  };
  world.listenerDown = inRun && (g.hero.player.dead || g.hero.left);
  world.talkHeld = settings.voiceChat && settings.voiceMode === 'ptt' && (g.input.actionDown('talk') || PAD_TALK.some((b) => g.input.padButton(b)));
  voice.tick(world, dt);
  voiceUiTick(g, dt);
}
