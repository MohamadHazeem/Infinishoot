import Peer, { type DataConnection } from 'peerjs';
import { hasRelay, iceConfig } from './ice';
import { NetSim } from './netsim';

/**
 * WebRTC transport via PeerJS. The host registers a peer id derived from a
 * short invite code; clients connect to it directly (browser to browser).
 * PeerJS's free public broker is only used to find each other.
 */
const PREFIX = 'infinishoot-v4-'; // v4: bullet deltas and host step stamps (netcode lane); v3: compact snapshots (src/net/snapCodec.ts, fxCodec.ts)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

type Handler = (from: string, msg: unknown) => void;

/** Host side: accepts up to `max` clients. */
export class NetHost {
  readonly code: string;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  /** performance.now() of the last message from each client (netcode lane: silent connections). */
  readonly lastHeard = new Map<string, number>();
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onMessage: Handler = () => {};
  onError: (msg: string) => void = () => {};
  ready: Promise<void>;
  /** PeerJS error type of the last error ('unavailable-id' = the code is taken). */
  errorType = '';

  /** `code`: a fixed room code (the player's friend code, lobby lane); random if absent. */
  constructor(public max = 3, code?: string) {
    this.code = code ? normalizeCode(code) : makeCode();
    this.peer = new Peer(PREFIX + this.code, { debug: 0, config: iceConfig() });
    this.ready = new Promise((resolve, reject) => {
      this.peer.on('open', () => resolve());
      this.peer.on('error', (e) => {
        this.errorType = (e as { type?: string }).type ?? '';
        this.onError(friendlyError(e));
        reject(e);
      });
    });
    this.peer.on('connection', (conn) => {
      // One spare slot: a player reconnecting before their old connection has timed out (netcode lane).
      if (this.conns.size >= this.max + 1) {
        conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 200);
        });
        return;
      }
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.lastHeard.set(conn.peer, performance.now());
        this.onJoin(conn.peer);
      });
      conn.on('data', (d) => {
        if (this.conns.get(conn.peer) !== conn) return; // dropped (drop()): late messages don't count
        this.lastHeard.set(conn.peer, performance.now());
        this.onMessage(conn.peer, d);
      });
      const gone = () => {
        if (this.conns.get(conn.peer) !== conn) return;
        this.conns.delete(conn.peer);
        this.lastHeard.delete(conn.peer);
        this.onLeave(conn.peer);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
  }

  get clientIds(): string[] {
    return [...this.conns.keys()];
  }

  send(id: string, msg: unknown): void {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  broadcast(msg: unknown): void {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  kick(id: string): void {
    this.conns.get(id)?.close();
  }

  /** Treat a client as gone now (it went silent): onLeave fires once, the connection is closed. */
  drop(id: string): void {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    this.lastHeard.delete(id);
    this.onLeave(id);
    try {
      c.close();
    } catch {
      // already closed
    }
  }

  /** The PeerJS peer, for voice chat media calls (src/net/voice.ts). */
  get voicePeer(): Peer {
    return this.peer;
  }

  /** How many clients are connected right now. */
  get size(): number {
    return this.conns.size;
  }

  close(): void {
    this.broadcast({ t: 'end' });
    setTimeout(() => this.peer.destroy(), 150);
  }
}

/** Client side: one connection to the host. */
export class NetClient {
  private peer: Peer;
  private conn: DataConnection | null = null;
  private closed = false;
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  /** ICE state changes ('disconnected' is often a blip that recovers; 'failed' is a drop). */
  onIce: (state: string) => void = () => {};
  ready: Promise<void>;
  /** The invite code this client connected with (reconnects reuse it). */
  readonly code: string;
  /** performance.now() of the last message from the host. */
  lastHeard = 0;
  /** Simulated bad connection (src/net/netsim.ts): both directions, off unless configured. */
  private simIn = new NetSim((d) => this.onMessage(d));
  private simOut = new NetSim((d) => {
    if (this.conn?.open) this.conn.send(d);
  });

  constructor(code: string) {
    this.code = normalizeCode(code);
    this.peer = new Peer({ debug: 0, config: iceConfig() });
    this.ready = new Promise((resolve, reject) => {
      // Signalling worked but no direct route was found: say so (and point at a relay) instead of a vague timeout.
      let signalled = false;
      const timer = setTimeout(() => reject(new Error(signalled ? noRouteError() : 'Could not reach that game. Check the code and try again.')), 12000);
      this.peer.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(friendlyError(e)));
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + normalizeCode(code), { reliable: true });
        this.conn = conn;
        signalled = true;
        (conn as unknown as { on(ev: 'iceStateChanged', fn: (s: string) => void): void }).on('iceStateChanged', (s) => {
          this.onIce(s);
          if (s !== 'failed') return;
          clearTimeout(timer);
          reject(new Error(noRouteError()));
        });
        conn.on('open', () => {
          clearTimeout(timer);
          this.lastHeard = performance.now();
          resolve();
        });
        conn.on('data', (d) => {
          if (this.closed) return;
          this.lastHeard = performance.now();
          this.simIn.push(d);
        });
        const gone = () => {
          if (this.closed) return;
          this.closed = true;
          this.simIn.drop();
          this.simOut.drop();
          this.onClose();
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
    });
  }

  send(msg: unknown): void {
    if (this.conn?.open && !this.closed) this.simOut.push(msg);
  }

  /** The PeerJS peer, for voice chat media calls (src/net/voice.ts). */
  get voicePeer(): Peer {
    return this.peer;
  }

  /** Connected and not closed. */
  get open(): boolean {
    return !this.closed && !!this.conn?.open;
  }

  close(): void {
    this.closed = true;
    this.simIn.drop();
    this.simOut.drop();
    this.conn?.close();
    setTimeout(() => this.peer.destroy(), 150);
  }

  /** The connection went silent: give up on it (onClose fires once). */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    this.simIn.drop();
    this.simOut.drop();
    try {
      this.conn?.close();
    } catch {
      // already gone
    }
    setTimeout(() => this.peer.destroy(), 150);
    this.onClose();
  }
}

/** The host was found but no network path worked (strict NAT or firewall on one side). */
export function noRouteError(relay = hasRelay()): string {
  return relay
    ? 'Found the game but could not connect, even through the relay. Check the relay settings or try another network.'
    : 'Found the game but could not connect: one of your networks blocks direct connections. Set a CUSTOM RELAY (TURN server) below, or try another network.';
}

function friendlyError(e: unknown): string {
  const type = (e as { type?: string }).type;
  if (type === 'peer-unavailable') return 'No game found with that code.';
  if (type === 'unavailable-id') return 'That code is taken, try hosting again.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Could not reach the matchmaking server. Check your internet connection.';
  if (type === 'browser-incompatible') return 'This browser does not support online play.';
  if (type === 'webrtc' || type === 'negotiation-failed') return noRouteError();
  return 'Connection problem. Please try again.';
}
